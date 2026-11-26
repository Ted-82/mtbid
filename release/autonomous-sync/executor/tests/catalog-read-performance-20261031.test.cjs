'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{performance}=require('node:perf_hooks');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const INDEX_SQL=fs.readFileSync(path.join(__dirname,'../docs/proposals/0013_identifier_read_indexes.sql'),'utf8');
const COLUMNS=['make','model','year','location_state','auction_state','body_style','fuel_type','transmission','drive_type','run_state','primary_damage','seller_type','document_type','document_name'];
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(`
  CREATE TABLE auction_listings(listing_id TEXT PRIMARY KEY,source_key TEXT,platform TEXT,vin_normalized TEXT,lot TEXT,source_listing_id TEXT,last_seen_at TEXT,
   ${COLUMNS.map(c=>c==='year'?'year INTEGER':c+' TEXT COLLATE NOCASE').join(',')});
  CREATE TABLE vehicle_sources(source_key TEXT PRIMARY KEY,provider TEXT,provider_vehicle_id TEXT,last_attempt_at TEXT,last_success_at TEXT,last_error_code TEXT);
  CREATE TABLE provider_sync_scopes(provider TEXT,platform TEXT,status TEXT,cursor TEXT,last_complete_at TEXT,operation TEXT);
  CREATE INDEX idx_listings_public_recent ON auction_listings(last_seen_at DESC,listing_id ASC);
  CREATE INDEX idx_listings_vin_recent ON auction_listings(vin_normalized,platform,last_seen_at DESC);
  CREATE INDEX idx_listings_lot_recent ON auction_listings(platform,lot,last_seen_at DESC);`);
 for(const platform of ['copart','iaai'])sql.prepare("INSERT INTO provider_sync_scopes VALUES('apibara',?,'partial',NULL,NULL,'discovery')").run(platform);
 const inserts=sql.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,vin_normalized,lot,source_listing_id,last_seen_at,${COLUMNS}) VALUES(${Array(7+COLUMNS.length).fill('?')})`);
 let ordinal=0;const insert=row=>{const n=++ordinal,id=row.id||'r'+n;inserts.run(id,'s'+id,row.platform||'copart',row.vin??null,row.lot??String(n),row.sourceId??'src-'+n,row.seen||'2026-10-01',...COLUMNS.map(k=>row[k]??null));
  sql.prepare("INSERT INTO vehicle_sources VALUES(?,'apibara',?,NULL,NULL,NULL)").run('s'+id,'provider-'+n);};
 const queries=[],transfers=[];
 const db={prepare(query){assert.match(query,/^SELECT\b/,'repository performs reads only');queries.push(query);const stmt=sql.prepare(query);
  const methods=params=>({async all(){const results=stmt.all(...params);transfers.push({sql:query,rows:results.length,bytes:Buffer.byteLength(JSON.stringify(results))});return{results};},async first(){return stmt.get(...params)||null;}});
  return{...methods([]),bind(...params){return methods(params);}};
 }};
 return{sql,db,repo:new D1ReadRepository(db),insert,queries,transfers};
}
// Differential oracle: the previous all-row public metadata transformation.
// It deliberately retains its raw-row transfer and normalization order.
async function legacyMetadata(db,platform=null){
 const result=await (platform?db.prepare(`SELECT ${COLUMNS.slice(0,-1)},trim(document_name) AS document_name FROM auction_listings WHERE platform=?`).bind(platform):db.prepare(`SELECT ${COLUMNS.slice(0,-1)},trim(document_name) AS document_name FROM auction_listings`)).all();
 const rows=result.results||[],repo=new D1ReadRepository(db),coverage=await repo.getCoverage(platform);
 const families=[['LUCID','LUCID MOTORS'],['FISKER','FISKER AUTOMOTIVE'],['MCLAREN','MCLAREN AUTOMOTIVE'],['MERCEDES-BENZ','MERCEDES BENZ','MERCEDES']];
 const makeLabel=value=>{const text=String(value||'').trim();return families.find(names=>names.includes(text.toUpperCase()))?.[0]||text;};
 const unique=(key,sort=(a,b)=>String(a).localeCompare(String(b)))=>[...new Set(rows.map(r=>r[key]).filter(v=>v!==null&&v!==undefined&&v!==''))].sort(sort);
 const bodies={
  'kind:car':{label:'Samochody',values:['sedan','sedan 4dr','sedan 4d','sedan 4 door','hatchback','hatchback 2dr','hatchback 4dr','hatchback 4 door','coupe','coupe 2 door','convertible','convertible 2 door','wagon','station wagon','wagon/hatchback','sedan/hatchback','suv','suv 2 door','suv 4 door','sport utility','sport utility vehicle','4dr sport utility','suv/crossover']},
  'kind:motorcycle':{label:'Motocykle',values:['motorcycle','cruiser']},'kind:atv':{label:'ATV / quady',values:['atv','quad']}};
 const documents=new Map();for(const row of rows){const name=row.document_name;if(typeof name!=='string'||!name.trim())continue;const key=name.replace(/[A-Z]/g,c=>c.toLowerCase());if(!documents.has(key))documents.set(key,{value:name,label:name});}
 return{values:{
  makes:[...new Set(unique('make').map(makeLabel))].sort().map(value=>({value,label:value})),
  models:[...new Map(rows.filter(r=>r.make&&r.model).map(r=>[makeLabel(r.make)+'\0'+r.model,{make:makeLabel(r.make),model:r.model}])).values()],
  years:unique('year',(a,b)=>Number(a)-Number(b)),states:unique('location_state'),auction_states:unique('auction_state'),body_styles:unique('body_style'),fuel_types:unique('fuel_type'),
  vehicle_types:[...Object.entries(bodies).filter(([,g])=>rows.some(r=>g.values.includes(String(r.body_style||'').trim().toLowerCase()))).map(([value,g])=>({value,label:g.label})),...unique('body_style').map(value=>({value,label:'Nadwozie: '+value}))],
  transmissions:unique('transmission'),drive_types:unique('drive_type'),run_conditions:unique('run_state'),damages:unique('primary_damage'),seller_types:unique('seller_type'),sale_document_types:unique('document_type'),
  sale_document_names:[...documents.values()].sort((a,b)=>a.label.localeCompare(b.label))},
  read:{source:'d1',coverage,metadata_complete:coverage.complete,known_rows_only:true,row_count:rows.length}};
}
test('single-scan distinct metadata exactly matches the former contract for case, aliases, nulls, models, documents and platforms',async t=>{
 const f=fixture(t),rows=[
  {make:'MERCEDES BENZ',model:'C 300',year:2025,document_name:' CLEAR ',body_style:'sedan'},
  {make:'MERCEDES-BENZ',model:'C 300',year:2025,document_name:'clear',body_style:'SUV'},
  {make:'LUCID MOTORS',model:'Air',year:2024,document_name:'ÉTAT',body_style:'Motorcycle'},
  {make:'LUCID',model:'Air',year:2024,document_name:'état',body_style:'quad'},
  {make:' Tesla ',model:' Model 3',year:2026,document_name:"OWNER'S TITLE",body_style:' SPORT '},
  {make:'TESLA',model:'Model 3',year:2026,document_name:'  CLEAR  ',body_style:'SUV'},
  {make:'',model:'',year:0,document_name:'\t ',body_style:'motorcycle'},
  {make:null,model:'missing make',year:null,document_name:'\t',body_style:null},
  {make:'0',model:'0',year:1886,document_name:'0',body_style:'atv'},
  {make:'mercedes',model:'C 300',year:2025,document_name:'Clear',body_style:'sedan'},
  {make:'Tesla',model:'Model 3',year:2026,document_name:'clear',body_style:'suv'}];
 for(let n=0;n<rows.length;n++)f.insert({...rows[n],platform:n%2?'iaai':'copart',location_state:n%3?'TX':'tx',auction_state:n%2?'Open':'open',
  fuel_type:n%2?'Electric':'electric',transmission:n%2?'Automatic':'automatic',drive_type:n%2?'AWD':'awd',run_state:n%2?'Runs':'runs',primary_damage:n%2?'Rear':'rear',seller_type:n%2?'Insurance':'insurance',document_type:n%2?'Clean':'clean'});
 const before=f.sql.prepare('SELECT total_changes() n').get().n;
 for(const platform of [null,'copart','iaai','missing','COPART']){
  const expected=await legacyMetadata(f.db,platform);f.queries.length=0;f.transfers.length=0;
  assert.deepEqual(await f.repo.getFilterMetadata({platform}),expected,platform||'all');
  const aggregate=f.queries.filter(q=>q.includes('FROM auction_listings'));
  assert.equal(aggregate.length,1);assert.match(aggregate[0],/COUNT\(\*\)/);assert.match(aggregate[0],/json_group_array\(DISTINCT/);
  const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+aggregate[0]).all(...(platform?[platform]:[])).map(r=>r.detail);
  assert.equal(plan.filter(line=>/SCAN auction_listings|SEARCH auction_listings/.test(line)).length,1,'one source-table scan/search, not one per distinct field');
  assert.equal(f.transfers.find(r=>r.sql.includes('FROM auction_listings')).rows,1);
 }
 assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before,'metadata never changes source rows');
});
test('empty metadata retains exact empty arrays/count and malformed aggregate or database errors fail explicitly',async t=>{
 const f=fixture(t);assert.deepEqual(await f.repo.getFilterMetadata(),await legacyMetadata(f.db));
 const bad={prepare(){return{async all(){return{results:[{row_count:0,make_values:'not-json'}]};}};}};
 await assert.rejects(new D1ReadRepository(bad).getFilterMetadata());
 const unavailable={prepare(){throw Error('OFFLINE_DB_UNAVAILABLE');}};
 await assert.rejects(new D1ReadRepository(unavailable).getFilterMetadata(),/OFFLINE_DB_UNAVAILABLE/);
});
async function identifierQuery(value,platform){let captured;const mock={prepare(sql){return{bind(...params){return{async all(){captured={sql,params};return{results:[]};}};}};}};await new D1ReadRepository(mock).getListingByIdentifier(value,{platform});return captured;}
test('three nonunique expression indexes preserve all identifier match/ambiguity cases and select searches instead of a recent scan',async t=>{
 const f=fixture(t);
 const rows=[
  {id:'vin',vin:'AbCdEf12345678901',lot:'10000001',sourceId:'provider-vin',seen:'2026-10-05'},
  {id:'lot',vin:'VINVAL12345678901',lot:'MiXeD-LOT',sourceId:'provider-lot',seen:'2026-10-06'},
  {id:'source',vin:'VINVAL12345678902',lot:'10000002',sourceId:'MiXeD-SOURCE',seen:'2026-10-07'},
  {id:'ambiguous-a',platform:'copart',vin:'VINVAL12345678903',lot:'shared',sourceId:'source-a',seen:'2026-10-08'},
  {id:'ambiguous-b',platform:'iaai',vin:'VINVAL12345678904',lot:'SHARED',sourceId:'source-b',seen:'2026-10-09'},
  {id:'same-row',vin:'SAME',lot:'SAME',sourceId:'SAME',seen:'2026-10-10'},
  {id:'source-collision',lot:'other',sourceId:'shared',seen:'2026-10-08'}];
 rows.forEach(r=>f.insert(r));
 const cases=[['abcdef12345678901',null],['mixed-lot','COPART'],['mixed-source',null],['shared',null],['shared','copart'],['shared','iaai'],['same',null],['absent',null],["' OR 1=1 --",null]];
 const queries=await Promise.all(cases.map(([v,p])=>identifierQuery(v,p))),before=queries.map(q=>f.sql.prepare(q.sql).all(...q.params));
 const planBefore=f.sql.prepare('EXPLAIN QUERY PLAN '+queries[0].sql).all(...queries[0].params).map(r=>r.detail);
 assert.ok(planBefore.some(s=>s.startsWith('SCAN l')));
 const changes=f.sql.prepare('SELECT total_changes() n').get().n;f.sql.exec(INDEX_SQL);f.sql.exec(INDEX_SQL);
 const after=queries.map(q=>f.sql.prepare(q.sql).all(...q.params));assert.deepEqual(after,before);
 assert.equal(before[3].length,2,'ambiguity keeps two matches');assert.equal(before[6].length,1,'one row matching three branches remains one row');
 assert.equal(before[4].length,2,'same-platform source/lot collision remains ambiguous');assert.equal(before[5].length,1);
 const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+queries[0].sql).all(...queries[0].params).map(r=>r.detail);
 for(const name of ['idx_listings_public_vin_upper','idx_listings_public_lot_upper','idx_listings_public_source_listing_upper'])assert.ok(plan.some(s=>s.includes('SEARCH l USING INDEX '+name)),name);
 assert.ok(!plan.some(s=>s.startsWith('SCAN l')));assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,changes);
 const indexes=f.sql.prepare("PRAGMA index_list('auction_listings')").all().filter(r=>r.name.startsWith('idx_listings_public_')&&r.name.endsWith('_upper'));
 assert.equal(indexes.length,3);assert.ok(indexes.every(r=>r.unique===0));
 t.diagnostic(JSON.stringify({identifierPlanBefore:planBefore,identifierPlanAfter:plan}));
});
test('large synthetic metadata transfers one bounded aggregate row instead of200000 rows without truncating results',async t=>{
 const f=fixture(t),insert=f.sql.prepare(`INSERT INTO auction_listings(listing_id,platform,${COLUMNS}) VALUES(${Array(2+COLUMNS.length).fill('?')})`);
 f.sql.exec('BEGIN');for(let n=0;n<200000;n++)insert.run('bulk-'+n,n%2?'iaai':'copart',
  ['LUCID MOTORS','LUCID','MERCEDES BENZ','MERCEDES-BENZ','Tesla','TESLA'][n%6],'Model '+n%317,2000+n%28,
  n%2?'TX':'FL',n%3?'open':'ended',['Sedan','SUV','motorcycle','ATV'][n%4],n%2?'Electric':'Gasoline','Automatic','AWD','Runs','Rear','Insurance','Clear',['CLEAR','clear',"OWNER'S TITLE",'ÉTAT','état'][n%5]);f.sql.exec('COMMIT');
 const beforeChanges=f.sql.prepare('SELECT total_changes() n').get().n;
 f.transfers.length=0;let cpu=process.cpuUsage(),start=performance.now();const old=await legacyMetadata(f.db),oldMs=performance.now()-start,oldCpu=process.cpuUsage(cpu);
 const oldTransfer=f.transfers.find(r=>r.sql.includes('FROM auction_listings'));
 f.transfers.length=0;cpu=process.cpuUsage();start=performance.now();const updated=await f.repo.getFilterMetadata(),newMs=performance.now()-start,newCpu=process.cpuUsage(cpu);
 const newTransfer=f.transfers.find(r=>r.sql.includes('FROM auction_listings'));
 assert.deepEqual(updated,old);assert.equal(updated.read.row_count,200000);assert.equal(oldTransfer.rows,200000);assert.equal(newTransfer.rows,1);
 assert.ok(updated.values.models.length>1000,'metadata is not capped to a listing page or a small option limit');
 assert.ok(newTransfer.bytes<oldTransfer.bytes/20,'distinct data transfer is not a full catalog disguised as one row');
 assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,beforeChanges);
 t.diagnostic(JSON.stringify({syntheticRows:200000,old:{elapsedMs:oldMs,cpuMs:(oldCpu.user+oldCpu.system)/1000,transferRows:oldTransfer.rows,transferBytes:oldTransfer.bytes},
  aggregate:{elapsedMs:newMs,cpuMs:(newCpu.user+newCpu.system)/1000,transferRows:newTransfer.rows,transferBytes:newTransfer.bytes},
  publicPayloadBytes:Buffer.byteLength(JSON.stringify(updated)),semanticEquality:true}));
});
