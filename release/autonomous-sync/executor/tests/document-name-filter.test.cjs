'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const reads=require('../staging/d1-primary-reads.cjs');
const publicReads=require('../sync/public-read-utils.cjs');
function fixture(t){
 const sql=new DatabaseSync(':memory:');
 const fields='make,model,year,location_state,auction_state,body_style,fuel_type,transmission,drive_type,run_state,primary_damage,seller_type'.split(',');
 sql.exec(`CREATE TABLE auction_listings(listing_id TEXT,source_key TEXT,platform TEXT,lot TEXT,document_name TEXT,document_type TEXT,last_seen_at TEXT,${fields.map(x=>x+' TEXT').join(',')});
 CREATE TABLE vehicle_sources(source_key TEXT,provider TEXT,provider_vehicle_id TEXT,last_attempt_at TEXT,last_success_at TEXT,last_error_code TEXT);
 CREATE TABLE provider_sync_scopes(provider TEXT,platform TEXT,status TEXT,cursor TEXT,last_complete_at TEXT,operation TEXT);`);
 const rows=[['a','iaai',' CLEAR ','success'],['b','iaai','clear','danger'],['c','iaai','CLEAR','success'],['d','copart','CLEAR','success'],['e','iaai','CLEAR - PARTS ONLY','danger'],['f','copart',"OWNER'S TITLE",'success'],['g','copart',null,'success'],['h','copart','ÉTAT','other'],['i','copart','état','other']];
 for(const [id,platform,name,type] of rows){
  sql.prepare('INSERT INTO auction_listings(listing_id,source_key,platform,lot,document_name,document_type,last_seen_at) VALUES(?,?,?,?,?,?,?)').run(id,id,platform,id,name,type,'2026-10-01');
  sql.prepare("INSERT INTO vehicle_sources VALUES(?,'apibara',?,NULL,NULL,NULL)").run(id,id);
 }
 const queries=[];
 const db={prepare(query){assert.match(query,/^SELECT\b/);queries.push(query);const stmt=sql.prepare(query);
  const methods=params=>({async all(){return {results:stmt.all(...params)};},async first(){return stmt.get(...params)||null;}});
  return {...methods([]),bind(...params){return methods(params);}};
 }};
 const before=sql.prepare('SELECT total_changes() n').get().n;
 t.after(()=>{assert.equal(sql.prepare('SELECT total_changes() n').get().n,before);sql.close();});
 return {db,queries,repo:new D1ReadRepository(db),env:{REXBID_RELEASE_D1_TARGET:'rexbid-production-preflight-db',REXBID_RELEASE_D1_DATABASE_ID:'c8a30088-70af-43a6-9a7f-c4018279d37d',REXBID_PUBLIC_CATALOG_MODE:'stored',REXBID_DB:db}};
}
const ids=result=>result.records.map(row=>row.listing_id);
test('names filter before cursor pagination, preserve platform, and never substitute colour codes',async t=>{
 const {repo}=fixture(t);const first=await repo.listCatalog({platform:'iaai',saleDocumentName:' clear ',limit:2});
 assert.deepEqual(ids(first),['a','b']);assert.equal(first.page.has_more_stored_rows,true);
 const second=await repo.listCatalog({platform:'iaai',saleDocumentName:'CLEAR',limit:2,cursor:first.page.next_cursor});
 assert.deepEqual(ids(second),['c']);assert.equal(second.page.next_cursor,null);
 assert.deepEqual(ids(await repo.listCatalog({saleDocumentName:'CLEAR',saleDocumentType:'success'})),['a','c','d']);
 assert.deepEqual(ids(await repo.listCatalog({saleDocumentName:'success'})),[]);
 assert.deepEqual(ids(await repo.listCatalog({saleDocumentType:'success'})),['a','c','d','f','g']);
 assert.deepEqual(ids(await repo.listCatalog({saleDocumentName:'CLEAR - PARTS ONLY'})),['e']);
});
test('names are bound values, with exact matching and bounded input',async t=>{
 const {repo,queries}=fixture(t);
 assert.deepEqual(ids(await repo.listCatalog({saleDocumentName:"OWNER'S TITLE"})),['f']);
 assert.deepEqual(ids(await repo.listCatalog({saleDocumentName:"' OR 1=1 --"})),[]);
 assert.ok(queries.every(q=>!q.includes("' OR 1=1 --")));
 for(const value of [' '.repeat(3),'x'.repeat(257),{},42])await assert.rejects(repo.listCatalog({saleDocumentName:value}),TypeError);
 assert.equal((await repo.listCatalog({saleDocumentName:''})).records.length,9);
});
test('metadata exposes names separately, folds only SQLite-equivalent ASCII, and scopes the platform',async t=>{
 const {repo}=fixture(t);const all=await repo.getFilterMetadata();
 assert.deepEqual(all.values.sale_document_names.map(x=>x.value).sort(),['CLEAR','CLEAR - PARTS ONLY',"OWNER'S TITLE",'ÉTAT','état'].sort());
 assert.deepEqual(all.values.sale_document_types,['danger','other','success']);
 const iaai=await repo.getFilterMetadata({platform:'iaai'});
 assert.deepEqual(iaai.values.sale_document_names.map(x=>x.value),['CLEAR','CLEAR - PARTS ONLY']);
 assert.equal(all.read.row_count,9);assert.equal(all.read.known_rows_only,true);assert.equal(all.read.metadata_complete,false);
 for(const name of all.values.sale_document_names)assert.ok((await repo.listCatalog({saleDocumentName:name.value})).records.length>0);
});
test('both public query parsers preserve separate document constraints',()=>{
 const url=new URL('https://rexbid.pl/api/cars?'+new URLSearchParams({sale_document_name:'CLEAR',sale_document_type:'success'}));
 for(const module of [reads,publicReads]){const result=module.queryOptions(url);assert.equal(result.saleDocumentName,'CLEAR');assert.equal(result.saleDocumentType,'success');}
 const market=require('../public/rexbid-market.js');assert.ok(market.returnPath(new URL('https://rexbid.pl/?sale_document_name=CLEAR')).includes('sale_document_name=CLEAR'));
});
test('actual public stored route returns matching document DTOs and invalid input is 400, without network',async t=>{
 const {env}=fixture(t);const network=t.mock.method(globalThis,'fetch',async()=>{throw Error('NO NETWORK');});t.mock.method(console,'info',()=>{});
 for(const [value,status] of [['CLEAR',200],[' '.repeat(3),400],['x'.repeat(257),400]]){
  const response=await reads.handleStoredRead(new Request('https://rexbid.pl/api/cars?'+new URLSearchParams({sale_document_name:value,platform:'iaai'})),env);
  assert.equal(response.status,status);const body=await response.json();
  if(status===200){assert.equal(body.data.length,3);assert.ok(body.data.every(row=>row.sale_document.name.toLowerCase()==='clear'));assert.equal(body.meta.read_source,'d1');}
 }
 assert.equal(network.mock.callCount(),0);
});
test('D1-only name constraint never falls back to an unfiltered provider when D1 fails',async t=>{
 t.mock.method(console,'info',()=>{});let calls=0;
 const env={REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:reads.STAGING_HOST,REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_D1_PRIMARY_READS:'true',REXBID_D1_PROVIDER_FALLBACK:'enabled'};
 const response=await reads.handlePrimaryRead(new Request('https://'+reads.STAGING_HOST+'/api/cars?sale_document_name=CLEAR'),env,{},()=>{calls++;throw Error('unexpected provider');});
 assert.equal(response.status,503);assert.equal(calls,0);
});
test('shared provider entry rejects the unsupported name filter before selecting an adapter',async()=>{
 const src=fs.readFileSync(require.resolve('../worker.js'),'utf8');
 const start=src.indexOf('async function getCars('),end=src.indexOf('const params =',start);
 const context={URL,errorJson:(error,status)=>({error,status})};vm.createContext(context);
 vm.runInContext(src.slice(start,end)+'throw Error("provider reached"); };globalThis.run=getCars;',context);
 assert.equal((await context.run({url:'https://rexbid.pl/api/cars?sale_document_name=CLEAR'},{})).status,503);
});
