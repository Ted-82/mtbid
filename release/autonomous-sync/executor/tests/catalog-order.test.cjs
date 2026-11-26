'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {D1ReadRepository,encodeCursor,decodeCursor}=require('../sync/d1-read-repository.js');
const {ORDERS}=require('../sync/catalog-order.cjs');
const reads=require('../staging/d1-primary-reads.cjs');
function fixture(t){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE auction_listings(listing_id TEXT,source_key TEXT,last_seen_at TEXT,platform TEXT,lot TEXT,year INTEGER,current_bid_usd REAL,buy_now_usd REAL,odometer_value REAL,odometer_unit TEXT,auction_state TEXT,source_status TEXT,make TEXT,document_name TEXT,final_price_usd REAL,source_price_usd REAL);
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
  sql.prepare('INSERT INTO auction_listings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,id,'2026-10-20',platform,id,year,bid,buy,mileage,unit,state,status,'TEST','CLEAR',99999,88888);
  sql.prepare("INSERT INTO vehicle_sources VALUES(?,'apibara',?,NULL,NULL,NULL)").run(id,id);
 }
 const before=sql.prepare('SELECT total_changes() n').get().n;
 const db={prepare(query){assert.match(query,/^SELECT\b/);const stmt=sql.prepare(query);const bound=params=>({async all(){return {results:stmt.all(...params)};},async first(){return stmt.get(...params)||null;}});return {...bound([]),bind(...params){return bound(params);}};}};
 t.after(()=>{assert.equal(sql.prepare('SELECT total_changes() n').get().n,before);sql.close();});
 return {repo:new D1ReadRepository(db),db,sql};
}
const expected={recent:'abcdefghij',year_desc:'hbcjadegfi',year_asc:'gedajbchfi',mileage_asc:'cgdijbaefh',bid_asc:'agbcdefhij',bid_desc:'bcgadefhij',buy_now_asc:'cagbdefhij'};
for(const sort of Object.keys(ORDERS))test('stored sort '+sort+' has exact stable order, NULL last and complete cursor pages',async t=>{
 const {repo}=fixture(t);let cursor=null,ids=[],pages=0;
 do{const r=await repo.listCatalog({sort,limit:2,cursor});assert.equal(r.page.sort,sort);ids.push(...r.records.map(x=>x.listing_id));cursor=r.page.next_cursor;pages++;assert.ok(pages<9);}while(cursor);
 assert.equal(ids.join(''),expected[sort]);assert.equal(new Set(ids).size,10);assert.equal(pages,5);
});
test('all sorts apply platform and document constraints before pagination',async t=>{
 const {repo}=fixture(t);
 for(const sort of Object.keys(ORDERS)){
  let cursor=null,ids=[];do{const r=await repo.listCatalog({sort,platform:'copart',saleDocumentName:'CLEAR',limit:2,cursor});ids.push(...r.records.map(x=>x.listing_id));assert.ok(r.records.every(x=>x.vehicle.platform==='copart'));cursor=r.page.next_cursor;}while(cursor);
  assert.equal(ids.join(''),[...expected[sort]].filter(id=>'acfgij'.includes(id)).join(''));
 }
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
 const {db}=fixture(t);t.mock.method(console,'info',()=>{});const network=t.mock.method(globalThis,'fetch',async()=>{throw Error('NO NETWORK');});
 const env={REXBID_RELEASE_D1_TARGET:'rexbid-production-preflight-db',REXBID_RELEASE_D1_DATABASE_ID:'c8a30088-70af-43a6-9a7f-c4018279d37d',REXBID_PUBLIC_CATALOG_MODE:'stored',REXBID_DB:db};
 const r=await reads.handleStoredRead(new Request('https://rexbid.pl/api/cars?sort=bid_asc&per_page=2'),env),b=await r.json();assert.equal(r.status,200);assert.equal(b.meta.sort,'bid_asc');assert.deepEqual(b.data.map(x=>x.lot_number),['a','g']);
 for(const query of ['sort=bad',new URLSearchParams({sort:'bid_desc',cursor:b.meta.next_cursor})])assert.equal((await reads.handleStoredRead(new Request('https://rexbid.pl/api/cars?'+query),env)).status,400);
 assert.equal(network.mock.callCount(),0);
});
test('D1-only sort cannot use an unfiltered provider fallback on database failure',async t=>{
 t.mock.method(console,'info',()=>{});let calls=0;
 const env={REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:reads.STAGING_HOST,REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_D1_PRIMARY_READS:'true',REXBID_D1_PROVIDER_FALLBACK:'enabled'};
 const r=await reads.handlePrimaryRead(new Request('https://'+reads.STAGING_HOST+'/api/cars?sort=bid_asc'),env,{},()=>{calls++;throw Error('provider');});assert.equal(r.status,503);assert.equal(calls,0);
});
