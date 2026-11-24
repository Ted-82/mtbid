'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{performance}=require('node:perf_hooks');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const VIN='JF2BURLD0TY492729',AT='2026-11-04T19:00:00.000Z',BASELINE='fresh-exact-test';
function harness(t,{count=0,active=true,indexes=true}={}){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());for(const f of ['0004_d1_sync_2.sql','0009_public_catalog_read_indexes.sql',...(indexes?['0013_identifier_read_indexes.sql']:[]),'0014_feed_catalog_membership.sql'])sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',f),'utf8'));
 for(const platform of ['copart','iaai'])sql.prepare("INSERT INTO vehicle_sources(source_key,provider,platform,identity_state,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,'apibara',?,'resolved',?,?,?,?)").run('s-'+platform,platform,AT,AT,AT,AT);
 const captured=[],db={prepare(text){const methods=params=>({async all(){captured.push({sql:text,params});return{results:sql.prepare(text).all(...params)};},async first(){captured.push({sql:text,params});return sql.prepare(text).get(...params)||null;}});return{...methods([]),bind(...params){return methods(params);}};}};
 const membership=active?{async view(){return{active:true,baselineId:BASELINE,revision:1};},async coverage(){return{complete:true,partial:false,platforms:[]};}}:null;
 const repo=new D1ReadRepository(db,{membership,now:()=>Date.parse(AT)});
 const insert=sql.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,identity_state,vin_normalized,lot,vehicle_title,make,model,year,auction_state,source_status,is_timed,current_bid_usd,buy_now_usd,first_seen_at,last_seen_at,summary_synced_at,created_at,updated_at)
  VALUES(?,?,?,'resolved',?,?,?,?,?,?,?, ?,1,1000,5000,?,?,?,?,?)`);
 function add(id,{platform='copart',vin=VIN,lot='71858106',title='2026 SUBARU OUTBACK',make='SUBARU',model='OUTBACK',year=2026,state='open',member=1,seen=AT}={}){
  insert.run(id,'s-'+platform,platform,vin,lot,title,make,model,year,state,state==='open'?'Open':state,AT,seen,AT,AT,AT);
  if(member!==null)sql.prepare('INSERT INTO feed_catalog_membership(baseline_id,listing_id,active,last_sequence) VALUES(?,?,?,100)').run(BASELINE,id,member);
 }
 // Read-only repository tests need only membership rows, not a forged proof.
 sql.exec('PRAGMA foreign_keys=OFF');sql.exec('BEGIN');for(let i=0;i<count;i++)add('background-'+String(i).padStart(6,'0'),{vin:'1HGCM82633A'+String(i).padStart(6,'0'),lot:String(80000000+i),title:'2020 HONDA OTHER',make:'HONDA',model:'OTHER',year:2020,seen:'2026-11-04T20:00:00.000Z'});sql.exec('COMMIT');
 return{sql,db,repo,captured,add,query:()=>captured.filter(q=>q.sql.includes('SELECT l.*')).at(-1)};
}
const ids=result=>result.records.map(r=>r.listing_id);
const explain=(h,q)=>h.sql.prepare('EXPLAIN QUERY PLAN '+q.sql).all(...q.params).map(r=>r.detail);
test('full mixed-case VIN uses existing expression index and retains active membership, status and client filters',async t=>{
 const h=harness(t);h.add('match');h.add('other-platform',{platform:'iaai'});h.add('inactive',{member:0});h.add('absent',{member:null});h.add('ended',{state:'ended'});h.add('wrong-vin',{vin:'1HGCM82633A004352',title:VIN});
 const r=await h.repo.listCatalog({search:VIN.toLowerCase(),platform:'copart',make:'subaru',yearFrom:2025,yearTo:2027,timed:true,buyNow:true});assert.deepEqual(ids(r),['match']);
 const q=h.query();assert.match(q.sql,/upper\(vin_normalized\)=upper\(\?\)/);assert.doesNotMatch(q.sql,/instr\(/);const plan=explain(h,q);
 assert.ok(plan.some(s=>/SEARCH auction_listings USING INDEX idx_listings_public_vin_upper/.test(s)),plan.join('\n'));assert.ok(plan.some(s=>/SEARCH cm .*PRIMARY KEY/.test(s)));assert.equal(plan.some(s=>/SCAN l USING INDEX idx_listings_public_recent/.test(s)),false);
 assert.deepEqual(ids(await h.repo.listCatalog({search:VIN,yearFrom:2027})),[]);assert.deepEqual(ids(await h.repo.listCatalog({search:VIN,platform:'iaai'})),['other-platform']);
});
test('eight-digit LOT search uses its existing index, preserves leading zeros and platform ambiguity as result rows',async t=>{
 const h=harness(t);h.add('copart',{lot:'00123456'});h.add('iaai',{platform:'iaai',lot:'00123456'});h.add('different',{lot:'123456'});h.add('longer',{lot:'100123456'});
 assert.deepEqual(ids(await h.repo.listCatalog({search:'00123456'})),['copart','iaai']);const plan=explain(h,h.query());assert.ok(plan.some(s=>/SEARCH auction_listings USING INDEX idx_listings_public_lot_upper/.test(s)),plan.join('\n'));assert.equal(plan.some(s=>/SCAN l USING INDEX idx_listings_public_recent/.test(s)),false);
 assert.deepEqual(ids(await h.repo.listCatalog({search:'00123456',platform:'iaai'})),['iaai']);
});
test('partial VIN, short numeric and make/model/title terms keep literal global substring semantics',async t=>{
 const h=harness(t);h.add('partial');h.add('title-only',{vin:'1HGCM82633A004352',title:'Special JF2BURLD0TY demonstration'});
 for(const search of ['JF2BURLD0TY','71858','subaru outback','OUTBACK']){const r=await h.repo.listCatalog({search});assert.ok(r.records.length>0,search);assert.match(h.query().sql,/instr\(/);}
 assert.deepEqual(ids(await h.repo.listCatalog({search:"%' OR 1=1 --"})),[]);assert.match(h.query().sql,/instr\(/);assert.ok(h.query().params.includes("%' OR 1=1 --"));
});
test('identifier pagination and every catalog sort keep exact scope without stale/duplicate rows',async t=>{
 const h=harness(t);for(let i=0;i<5;i++)h.add('same-'+i,{platform:i%2?'iaai':'copart',seen:new Date(Date.parse(AT)-i*1000).toISOString(),year:2022+i});
 for(const search of [VIN,'71858106'])for(const sort of ['recent','year_asc','year_desc','bid_asc']){const seen=[],options={search,sort,limit:2};let cursor=null;
  for(let p=0;p<4;p++){const r=await h.repo.listCatalog({...options,cursor});seen.push(...ids(r));cursor=r.page.next_cursor;if(!cursor)break;}
  assert.equal(seen.length,5);assert.equal(new Set(seen).size,5);assert.ok(seen.every(id=>id.startsWith('same-')));
 }
});
test('legacy NULL-membership mode retains archived exact matches and needs no new schema or index',async t=>{
 for(const indexes of [false,true]){const h=harness(t,{active:false,indexes});h.add('active');h.add('archived',{state:'ended',member:null});assert.deepEqual(ids(await h.repo.listCatalog({search:VIN})),['active','archived']);assert.deepEqual(ids(await h.repo.listCatalog({search:'71858106'})),['active','archived']);}
});
test('large-catalog EXPLAIN replaces recent full scan with indexed search without widening matching rows',async t=>{
 const h=harness(t,{count:20000});h.add('actual-subaru');const started=performance.now(),result=await h.repo.listCatalog({search:VIN}),elapsed=performance.now()-started;assert.deepEqual(ids(result),['actual-subaru']);
 const current=h.query(),old={sql:current.sql.replace('(SELECT * FROM auction_listings WHERE upper(vin_normalized)=upper(?) LIMIT -1 OFFSET 0)','auction_listings').replace('WHERE l.auction_state',"WHERE (instr(upper(COALESCE(l.vin_normalized,'')),upper(?))>0 OR instr(upper(COALESCE(l.lot,'')),upper(?))>0 OR instr(upper(COALESCE(l.vehicle_title,'')),upper(?))>0 OR instr(upper(COALESCE(l.make,'')||' '||COALESCE(l.model,'')),upper(?))>0) AND l.auction_state"),params:[VIN,VIN,VIN,VIN,BASELINE,21]};
 const before=explain(h,old),after=explain(h,current);assert.ok(before.some(s=>/SCAN l USING INDEX idx_listings_public_recent/.test(s)),before.join('\n'));assert.ok(after.some(s=>/SEARCH auction_listings USING INDEX idx_listings_public_vin_upper/.test(s)));assert.deepEqual(h.sql.prepare(old.sql).all(...old.params).map(r=>r.listing_id),h.sql.prepare(current.sql).all(...current.params).map(r=>r.listing_id));
 console.log(JSON.stringify({kind:'exact-vin-search-offline-proof',backgroundRows:20000,matchingRows:result.records.length,indexedQueryMs:Number(elapsed.toFixed(3)),before,after}));
});
