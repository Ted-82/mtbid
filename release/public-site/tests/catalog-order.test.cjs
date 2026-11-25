'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {D1ReadRepository,encodeCursor,decodeCursor}=require('../sync/d1-read-repository.js');
const reads=require('../staging/d1-primary-reads.cjs');
function fixture(t, active=false, midnight=false, live=false){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE auction_listings(listing_id TEXT,source_key TEXT,last_seen_at TEXT,platform TEXT,lot TEXT,year INTEGER,current_bid_usd REAL,buy_now_usd REAL,odometer_value REAL,odometer_unit TEXT,auction_state TEXT,source_status TEXT,make TEXT,document_name TEXT,final_price_usd REAL,source_price_usd REAL);
 ALTER TABLE auction_listings ADD COLUMN auction_at TEXT;
 ALTER TABLE auction_listings ADD COLUMN timed_end_at TEXT;
 ALTER TABLE auction_listings ADD COLUMN is_timed INTEGER;
 CREATE TABLE vehicle_sources(source_key TEXT,provider TEXT,provider_vehicle_id TEXT,last_attempt_at TEXT,last_success_at TEXT,last_error_code TEXT);
 CREATE TABLE provider_sync_scopes(provider TEXT,platform TEXT,status TEXT,cursor TEXT,last_complete_at TEXT,operation TEXT);`);
 const rows=[
 ['a','copart',2020,0,5000,1609.344,'km','open','Open'],
 ['b','iaai',2022,100,10000,100,'mi','open','Open'],
 ['c','copart',2022,100,2500,0,'mi','open','Open'],
 ['d','iaai',2018,1,1,10,'mi','sold','Sold'],
 ['e','iaai',2015,2,2,100,'unknown','finished','Sold on Approval'],
 ['f','copart',null,null,0,50,null,'open','Open'],
 ['g','copart',2010,50,6000,5,'mi','unknown','Unknown'],
 ['h','iaai',2023,3,3,-1,'mi','open','Sold on Approval'],
 ['i','copart',0,4,null,20,'km','cancelled','Cancelled'],
 ['j','copart',2021,-1,null,30,'mi','open','Open']];
 for(const [id,platform,year,bid,buy,mileage,unit,state,status] of rows){
  sql.prepare('INSERT INTO auction_listings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)').run(id,id,'2026-10-20',platform,id,year,bid,buy,mileage,unit,state,status,'TEST','CLEAR',99999,88888);
  sql.prepare("INSERT INTO vehicle_sources VALUES(?,'apibara',?,NULL,NULL,NULL)").run(id,id);
 }
 const date=sql.prepare('UPDATE auction_listings SET auction_at=?,timed_end_at=?,is_timed=? WHERE listing_id=?');
 date.run('2026-11-17T10:00:00Z',null,0,'a');
 date.run('2026-11-17T11:00:00+01:00',null,0,'b');
 date.run('2026-11-17',null,0,'c');
 date.run('2026-11-17T08:00:00Z',null,0,'h'); // terminal source trumps future-looking date
 date.run('2026-11-17T13:00:00Z','2026-11-17T11:00:00Z',1,'j');
 date.run('2026-11-16T09:00:00Z',null,0,'g');
 date.run('2103-11-21T21:47:27Z',null,0,'f');
 if(midnight){
  date.run('2026-11-16T23:20:00Z',null,0,'a');
  date.run('2026-11-16',null,0,'c');
 }
 if(active){
  sql.exec(require('../sync/catalog-order.cjs').auctionIndexSql);
  sql.exec(`CREATE INDEX idx_listings_public_recent ON auction_listings(last_seen_at DESC,listing_id ASC);
    CREATE INDEX idx_listings_public_timed_recent ON auction_listings(last_seen_at DESC,listing_id ASC) WHERE is_timed=1;
    CREATE INDEX idx_listings_public_buy_now_recent ON auction_listings(last_seen_at DESC,listing_id ASC) WHERE buy_now_usd>0;`);
  sql.exec("CREATE TABLE feed_catalog_membership(baseline_id TEXT,listing_id TEXT,active INTEGER); INSERT INTO feed_catalog_membership SELECT 'active',listing_id,1 FROM auction_listings");
 }
 if(live){
  sql.exec("UPDATE auction_listings SET auction_state='live' WHERE listing_id='a'; UPDATE auction_listings SET source_status='LiVe' WHERE listing_id='b'");
 }
 const before=sql.prepare('SELECT total_changes() n').get().n;
 const db={prepare(query){assert.match(query,/^SELECT\b/);const stmt=sql.prepare(query);const bound=params=>({async all(){return {results:stmt.all(...params)};},async first(){return stmt.get(...params)||null;}});return {...bound([]),bind(...params){return bound(params);}};}};
 t.after(()=>{assert.equal(sql.prepare('SELECT total_changes() n').get().n,before);sql.close();});
 return {repo:new D1ReadRepository(db),db,sql};
}
const expected={recent:'abcdefghij',year_desc:'hbcjadegfi',year_asc:'gedajbchfi',mileage_asc:'cgdijbaefh',bid_asc:'agbcdefhij',bid_desc:'bcgadefhij',buy_now_asc:'cagbdefhij'};
test('session filter uses a sparse index and keeps normalized and raw Live offers across pages',async t=>{
 const {db,sql}=fixture(t,true,false,true);
 const plans=[];
 const traced={prepare(query){
  const statement=db.prepare(query);
  return {...statement,bind(...params){
   if(query.startsWith('SELECT l.*'))plans.push(sql.prepare('EXPLAIN QUERY PLAN '+query).all(...params).map(row=>row.detail));
   return statement.bind(...params);
  }};
 }};
 const repo=new D1ReadRepository(traced);
 const options={auctionState:' LiVe ',assignedOnly:true,limit:1,sort:'recent',nowIso:'2026-11-17T10:12:00Z'};
 const before=await repo.listCatalog(options);
 sql.exec("CREATE INDEX idx_listings_public_live_recent ON auction_listings(last_seen_at DESC,listing_id ASC) WHERE (lower(auction_state)='live' OR lower(COALESCE(source_status,''))='live')");
 const after=await repo.listCatalog(options);
 assert.deepEqual(after,before);
 assert.ok(plans.at(-1).some(step=>step.includes('idx_listings_public_live_recent')));
 const next=await repo.listCatalog({...options,cursor:after.page.next_cursor});
 assert.deepEqual([...after.records,...next.records].map(row=>row.listing_id),['a','b']);
 assert.equal(next.page.next_cursor,null);
});
test('platform Live window scans the existing sparse session index with either platform selected',async t=>{
 const {db,sql}=fixture(t,true,false,true);
 sql.exec("CREATE INDEX idx_listings_public_platform_recent ON auction_listings(platform,last_seen_at DESC,listing_id ASC)");
 sql.exec("CREATE INDEX idx_listings_public_live_recent ON auction_listings(last_seen_at DESC,listing_id ASC) WHERE (lower(auction_state)='live' OR lower(COALESCE(source_status,''))='live')");
 let plan;
 const traced={prepare(query){
  const stmt=db.prepare(query);
  return {...stmt,bind(...params){
   if(query.startsWith('SELECT l.*'))plan=sql.prepare('EXPLAIN QUERY PLAN '+query).all(...params).map(row=>row.detail).join('\n');
   return stmt.bind(...params);
  }};
 }};
 const repo=new D1ReadRepository(traced,{membership:{view:async()=>({active:true,baselineId:'active',revision:1}),coverage:async()=>null}});
 for(const [platform,id] of [['copart','a'],['iaai','b']]){
  const url=new URL('/api/cars?lot_sub_status=Live&view=cards&per_page=20&platform='+platform,'https://rexbid.pl');
  const page=await repo.listCatalog(reads.queryOptions(url,Date.parse('2026-11-17T10:12:00Z'),true));
  assert.deepEqual(page.records.map(row=>row.listing_id),[id]);
  assert.match(plan,/idx_listings_public_live_recent/);
 }
});
for(const sort of Object.keys(expected))test('stored sort '+sort+' has exact stable order, NULL last and complete cursor pages',async t=>{
 const {repo}=fixture(t);let cursor=null,ids=[],pages=0;
 do{const r=await repo.listCatalog({sort,limit:2,cursor});assert.equal(r.page.sort,sort);ids.push(...r.records.map(x=>x.listing_id));cursor=r.page.next_cursor;pages++;assert.ok(pages<9);}while(cursor);
 assert.equal(ids.join(''),expected[sort]);assert.equal(new Set(ids).size,10);assert.equal(pages,5);
});
test('all sorts apply platform and document constraints before pagination',async t=>{
 const {repo}=fixture(t);
 for(const sort of Object.keys(expected)){
  let cursor=null,ids=[];do{const r=await repo.listCatalog({sort,platform:'copart',saleDocumentName:'CLEAR',limit:2,cursor});ids.push(...r.records.map(x=>x.listing_id));assert.ok(r.records.every(x=>x.vehicle.platform==='copart'));cursor=r.page.next_cursor;}while(cursor);
  assert.equal(ids.join(''),[...expected[sort]].filter(id=>'acfgij'.includes(id)).join(''));
 }
});
test('future date sorts include timed deadlines, validate membership index and page across ties',async t=>{
 const {repo}=fixture(t,true);
 repo.membership={view:async()=>({active:true,baselineId:'active',revision:1}),coverage:async()=>null};
 for(const [sort,wanted] of [['auction_next','cabj'],['auction_later','jbac']]) {
  const options={sort,limit:2,nowIso:'2026-11-16T17:30:00.000Z'};
  const first=await repo.listCatalog(options);
  const second=await repo.listCatalog({...options,nowIso:'2026-11-17T19:00:00.000Z',cursor:first.page.next_cursor});
  assert.equal([...first.records,...second.records].map(x=>x.listing_id).join(''),wanted);
  assert.equal(second.page.next_cursor,null);
 }
});
test('the home week preserves the scheduled and timed candidates across membership pages',async t=>{
 const {repo}=fixture(t,true);
 repo.membership={view:async()=>({active:true,baselineId:'active',revision:1}),coverage:async()=>null};
 const options={homeWeek:true,platform:'copart',sort:'recent',limit:2,nowIso:'2026-11-16T17:30:00.000Z'};
 const first=await repo.listCatalog(options);
 const second=await repo.listCatalog({...options,cursor:first.page.next_cursor});
 assert.deepEqual(first.records.map(x=>x.listing_id),['a','c']);
 assert.deepEqual(second.records.map(x=>x.listing_id),['j']);
 assert.equal(second.page.next_cursor,null);
 const timed=await repo.listCatalog({...options,timed:true});
 assert.deepEqual(timed.records.map(x=>x.listing_id),['j']);
});
test('the public home profiles are the only requests that opt into the showcase indexes',()=>{
 const now=Date.parse('2026-11-16T17:30:00.000Z');
 const paths=require('../sync/catalog-backup.cjs').profiles(now).filter(profile=>profile.key.startsWith('home:'));
 assert.equal(paths.length,4);
 for (const {path} of paths){
  const url=new URL(path,'https://rexbid.pl');
  assert.equal(reads.queryOptions(url,now,true).homeShowcase,true);
  assert.equal(reads.queryOptions(url,now,false).homeShowcase,false);
  assert.equal(reads.queryOptions(new URL(url.href+'&sort=auction_next'),now,true).homeShowcase,false);
  assert.equal(reads.queryOptions(new URL(url.href+'&make=FORD'),now,true).homeShowcase,false);
 }
});
test('each showcase index preserves the original ordering and pagination anchor',async t=>{
 const {repo}=fixture(t,true);
 repo.membership={view:async()=>({active:true,baselineId:'active',revision:1}),coverage:async()=>null};
 const options={homeWeek:true,assignedOnly:true,datedOnly:true,sort:'recent',limit:2,nowIso:'2026-11-16T17:30:00.000Z'};
 for (const scenario of [{},{buyNow:true},{timed:true}]){
  const before=await repo.listCatalog({...options,...scenario});
  const after=await repo.listCatalog({...options,...scenario,homeShowcase:true});
  assert.deepEqual(after,before);
 }
});
test('browse defaults to auction date while exact identifiers and active session endpoint remain accessible',()=>{
 for(const path of ['?view=cards','?view=cards&make=FORD&model=C-MAX']){
  const options=reads.queryOptions(new URL('/api/cars'+path,'https://rexbid.pl'));
  assert.equal(options.sort,'auction_next');assert.equal(options.datedOnly,true);
 }
 for(const path of ['?view=cards&s=12345678','?view=cards&lot_sub_status=Live','?view=showcase&category=current&home_week=1']) assert.equal(reads.queryOptions(new URL('/api/cars'+path,'https://rexbid.pl')).datedOnly,false);
 for(const identifier of ['12345678','1FADP5AU8DL509002']){
  const options=reads.queryOptions(new URL('https://rexbid.pl/api/cars?s='+identifier), Date.now(), true);
  assert.equal(options.datedOnly,true);
  assert.equal(options.assignedOnly,true);
 }
 assert.equal(reads.queryOptions(new URL('https://rexbid.pl/api/cars?view=cards&s=12345678&sort=auction_later')).sort,'recent');
});
test('future date accepts a precisely scheduled auction after Polish midnight before UTC midnight',async t=>{
 const {repo}=fixture(t,false,true);
 const results=await repo.listCatalog({sort:'auction_next',nowIso:'2026-11-16T23:01:00.000Z'});
 assert.equal(results.records.map(x=>x.listing_id).join(''),'abj');
});
test('sorted cursor carries its anchor values and cannot cross sorting modes',async t=>{
 const {repo}=fixture(t);const first=await repo.listCatalog({sort:'bid_asc',limit:1});
 const anchor=JSON.parse(decodeCursor(first.page.next_cursor));assert.deepEqual(anchor,{v:1,sort:'bid_asc',value:0,id:'a'});
 for(const sort of ['bid_desc','recent'])await assert.rejects(repo.listCatalog({sort,cursor:first.page.next_cursor}),{code:'INVALID_CATALOG_CURSOR'});
 await assert.rejects(repo.listCatalog({sort:'year_asc',cursor:encodeCursor(['listing','a'])}),{code:'INVALID_CATALOG_CURSOR'});
 for(const value of ['x',-1,{},true])await assert.rejects(repo.listCatalog({sort:'bid_asc',cursor:encodeCursor(['listing',JSON.stringify({...anchor,value})])}),{code:'INVALID_CATALOG_CURSOR'});
});
test('untrusted sorting names cannot become SQL; unknown sort fails closed',async t=>{
 const {repo}=fixture(t);for(const sort of ['year; DROP TABLE auction_listings','constructor','__proto__',{},['year_desc']])await assert.rejects(repo.listCatalog({sort}),{code:'INVALID_CATALOG_SORT'});
 assert.equal((await repo.listCatalog()).records.length,10);
});
test('actual public route returns order metadata; invalid sort/cursor is 400 without provider fetch',async t=>{
 const {db}=fixture(t);t.mock.method(Date,'now',()=>Date.parse('2026-11-16T17:30:00Z'));t.mock.method(console,'info',()=>{});const network=t.mock.method(globalThis,'fetch',async()=>{throw Error('NO NETWORK');});
 const env={REXBID_RELEASE_D1_TARGET:'rexbid-production-preflight-db',REXBID_RELEASE_D1_DATABASE_ID:'c8a30088-70af-43a6-9a7f-c4018279d37d',REXBID_PUBLIC_CATALOG_MODE:'stored',REXBID_DB:db};
 const r=await reads.handleStoredRead(new Request('https://rexbid.pl/api/cars?sort=bid_asc&per_page=2'),env),b=await r.json();assert.equal(r.status,200);assert.equal(b.meta.sort,'bid_asc');assert.deepEqual(b.data.map(x=>x.lot_number),['a','b']);
 for(const query of ['sort=bad',new URLSearchParams({sort:'bid_desc',cursor:b.meta.next_cursor})])assert.equal((await reads.handleStoredRead(new Request('https://rexbid.pl/api/cars?'+query),env)).status,400);
 assert.equal(network.mock.callCount(),0);
});
test('D1-only sort cannot use an unfiltered provider fallback on database failure',async t=>{
 t.mock.method(console,'info',()=>{});let calls=0;
 const env={REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:reads.STAGING_HOST,REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_D1_PRIMARY_READS:'true',REXBID_D1_PROVIDER_FALLBACK:'enabled'};
 const r=await reads.handlePrimaryRead(new Request('https://'+reads.STAGING_HOST+'/api/cars?sort=bid_asc'),env,{},()=>{calls++;throw Error('provider');});assert.equal(r.status,503);assert.equal(calls,0);
});
