const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {handlePrimaryRead, enabledFor} = require('../staging/d1-primary-reads.cjs');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
class D1Fixture {
  constructor(sqlite) { this.sqlite=sqlite; }
  prepare(sql) { const db=this.sqlite; return {bind(...p){return {
    async first(){return db.prepare(sql).get(...p)??null;},
    async all(){return {results:db.prepare(sql).all(...p)};},
    async run(){const r=db.prepare(sql).run(...p);return {success:true,meta:{changes:Number(r.changes)}};}
  };},async first(...p){return db.prepare(sql).get(...p)??null;},async all(...p){return {results:db.prepare(sql).all(...p)};},async run(...p){const r=db.prepare(sql).run(...p);return {success:true,meta:{changes:Number(r.changes)}};}}; }
}
function setup(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of ['migrations/0000_rexbid_base.sql','migrations/0001_auction_history_events.sql','migrations-staging/0003_accounts_foundation.sql','docs/proposals/0004_d1_sync_2.sql'])sqlite.exec(fs.readFileSync(path.join(ROOT,file),'utf8'));
  const d1=new D1Fixture(sqlite);const seen=new Date(NOW-60_000).toISOString();
  for(const platform of ['copart','iaai'])sqlite.prepare(`INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,last_complete_at,updated_at)
    VALUES(?,?,?,'discovery','partial',?,NULL,?)`).run(`scope-${platform}`,'apibara',platform,`opaque-${platform}`,seen);
  for(const [platform,n] of [['copart',1],['iaai',2]]){
    const sourceKey=`source-${platform}`,listingId=`listing-${platform}`,lot=`LOT-${platform.toUpperCase()}`;
    sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,provider_vehicle_id,identity_kind,identity_state,first_seen_at,last_seen_at,last_attempt_at,last_success_at,sync_status,created_at,updated_at)
      VALUES(?, 'apibara', ?, ?, 'provider_vehicle_id','resolved',?,?,?,?,'idle',?,?)`).run(sourceKey,platform,`provider-${platform}`,seen,seen,seen,seen,seen,seen);
    sqlite.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,listing_identity_kind,identity_state,source_listing_id,vin_normalized,lot,vehicle_title,make,model,year,auction_state,source_status,auction_at,is_timed,current_bid_usd,buy_now_usd,seller_name,primary_damage,run_state,keys_present,document_name,location_display,location_state,location_postal_code,first_seen_at,last_seen_at,summary_synced_at,freshness_class,fingerprint,created_at,updated_at)
      VALUES(?,?,?,'source_listing_id','resolved',?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,'warm',?,?,?)`).run(listingId,sourceKey,platform,lot,`TESTVIN00000000000${n}`,lot,'2022 Honda Civic','Honda','Civic',2022,'open','Oct 01, 2026 16:30','2099-10-05T10:00:00.000Z',1000*n,5000,'Seller','Front End','run_and_drive',1,'Salvage','Houston, TX','TX','77001',seen,seen,seen,'fingerprint-'+platform,seen,seen);
    sqlite.prepare(`INSERT INTO auction_listing_snapshots(listing_id,observed_at,auction_state,auction_at,current_bid_usd,fingerprint,normalizer_version) VALUES(?,?,'upcoming','2026-10-05T10:00:00.000Z',?,'snap-'+?,1)`).run(listingId,seen,1000*n,platform);
  }
  return {sqlite,d1};
}
const envFor=d1=>({REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev',REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_D1_PRIMARY_READS:'true',REXBID_D1_DETAIL_MAX_AGE_MS:'86400000',REXBID_D1_HISTORY_MAX_AGE_MS:'21600000',REXBID_DB:d1});
const request=(path,host='rexbid-auth-test.tedn828.workers.dev')=>new Request(`https://${host}${path}`);
function providerDelegate(calls,{status=200,body=null}={}){return async req=>{calls.push(new URL(req.url).pathname);return new Response(JSON.stringify(body||{ok:true,data:{vin:'PROVIDER-VIN',lot_number:'PROVIDER-LOT',platform:'copart',year:2021,make:'Provider',model:'Fresh'},source:'apibara',meta:{next_cursor:null}}),{status,headers:{'content-type':'application/json'}});};}

test('staging guard requires exact host, staging flags, target D1 and explicit primary-read switch',()=>{
  const {d1}=setup(),env=envFor(d1);
  assert.equal(enabledFor(request('/api/cars'),env),true);
  assert.equal(enabledFor(request('/api/cars','mtbid.tedn828.workers.dev'),env),false);
  assert.equal(enabledFor(request('/api/cars'),{...env,REXBID_D1_PRIMARY_READS:'false'}),false);
  assert.equal(enabledFor(request('/api/cars'),{...env,REXBID_D1_READ_TARGET:'rexbid-db'}),false);
  const productionConfig=fs.readFileSync(path.join(ROOT,'wrangler.jsonc'),'utf8');
  const productionWorker=fs.readFileSync(path.join(ROOT,'worker.js'),'utf8');
  assert.doesNotMatch(productionConfig,/REXBID_D1_PRIMARY_READS\s*"\s*:\s*"true"/);
  assert.doesNotMatch(productionWorker,/d1-primary-reads|REXBID_D1_PRIMARY_READS/);
});

test('/api/cars and /api/filters use known D1 data and disclose partial coverage without provider calls',async()=>{
  const {sqlite,d1}=setup(),env=envFor(d1),calls=[];const delegate=providerDelegate(calls);
  const cars=await handlePrimaryRead(request('/api/cars?platform=iaai&per_page=10'),env,null,delegate),body=await cars.json();
  assert.equal(cars.status,200);assert.equal(body.data.length,1);assert.equal(body.data[0].platform,'iaai');
  assert.equal(body.meta.read_source,'d1');assert.equal(body.meta.catalog_complete,false);assert.equal(body.meta.scope_status,'partial');assert.equal(body.meta.platform_coverage.length,2);
  assert.equal(body.meta.next_cursor,null);assert.equal(cars.headers.get('Cache-Control'),'private, no-store');
  const filters=await handlePrimaryRead(request('/api/filters?platform=copart'),env,null,delegate),filterBody=await filters.json();
  assert.equal(filterBody.meta.read_source,'d1');assert.equal(filterBody.meta.metadata_complete,false);assert.equal(filterBody.meta.known_rows_only,true);
  assert.deepEqual(calls,[]);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,2);sqlite.close();
});

test('D1-first catalog applies search and supported vehicle filters to known rows only',async()=>{
  const {sqlite,d1}=setup(),env=envFor(d1),calls=[],delegate=providerDelegate(calls);
  sqlite.prepare("UPDATE auction_listings SET run_state='run_and_drive',location_state='TX',body_style='Sedan' WHERE platform='copart'").run();
  sqlite.prepare("UPDATE auction_listings SET run_state='not_running' WHERE platform='iaai'").run();
  const cases=[
    ['/api/cars?s=LOT-COPART',1],
    ['/api/cars?search=Honda%20Civic',2],
    ['/api/cars?loc_state=TX&run_cond=run_and_drive',1],
    ['/api/cars?type=SUV',0],
    ['/api/cars?price_min=9999',0]
  ];
  for(const [path,count] of cases){
    const response=await handlePrimaryRead(request(path),env,null,delegate),body=await response.json();
    assert.equal(response.status,200,path);assert.equal(body.data.length,count,path);
    assert.equal(body.meta.catalog_complete,false,path);assert.equal(body.meta.known_rows_only,true,path);
  }
  assert.deepEqual(calls,[]);sqlite.close();
});

test('D1 listing returns only safe stored media URL references in the canonical DTO',async()=>{
  const {sqlite,d1}=setup(),env=envFor(d1),calls=[],delegate=providerDelegate(calls);
  sqlite.prepare("UPDATE auction_listings SET media_urls_json=?,media_thumbs_json=? WHERE platform='copart'")
    .run(JSON.stringify(['https://images.example/copart.jpg','http://unsafe.example/no.jpg','javascript:alert(1)']),JSON.stringify(['https://images.example/copart-small.jpg']));
  const response=await handlePrimaryRead(request('/api/car/LOT-COPART'),env,null,delegate),body=await response.json();
  assert.equal(body.read_source,'d1');assert.deepEqual(body.data.media.items,['https://images.example/copart.jpg']);
  assert.deepEqual(body.data.media.thumbs,['https://images.example/copart-small.jpg']);assert.deepEqual(calls,[]);sqlite.close();
});

test('D1 catalog preserves public filters when source_status is a formatted source label/date, not the canonical Open state',async()=>{
  const {sqlite,d1}=setup(),env=envFor(d1),calls=[],delegate=providerDelegate(calls);
  sqlite.prepare("UPDATE auction_listings SET is_timed=1 WHERE platform='iaai'").run();
  const cases=[
    ['/api/cars?lot_sub_status=Open',2],
    ['/api/cars?lot_status=Open',2],
    ['/api/cars?lot_status=Buy%20Now',2],
    ['/api/cars?platform=iaai&lot_status=Timed',1],
    ['/api/cars?upcoming=only',2],
    ['/api/cars?upcoming=without',0]
  ];
  for(const [path,count] of cases){
    const response=await handlePrimaryRead(request(path),env,null,delegate),body=await response.json();
    assert.equal(response.status,200,path);assert.equal(body.data.length,count,path);
    assert.equal(body.meta.catalog_complete,false,path);assert.equal(body.meta.known_rows_only,true,path);
  }
  assert.deepEqual(calls,[]);sqlite.close();
});

test('fresh Copart and IAAI detail are D1 reads with the same public envelope and no provider call',async()=>{
  const {sqlite,d1}=setup(),env=envFor(d1),calls=[],delegate=providerDelegate(calls);
  for(const [platform,lot] of [['copart','LOT-COPART'],['iaai','LOT-IAAI']]){
    const response=await handlePrimaryRead(request(`/api/car/${lot}`),env,null,delegate),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.match,'exact');assert.equal(body.source,'d1');
    assert.equal(body.read_source,'d1');assert.equal(body.data.platform,platform);assert.equal(body.data.lot_number,lot);
    assert.equal(body.read.catalog_complete,false);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  }
  assert.deepEqual(calls,[]);sqlite.close();
});

test('missing detail uses guarded provider fallback and reports reason without pretending D1 completeness',async()=>{
  const {sqlite,d1}=setup(),env=envFor(d1),calls=[],delegate=providerDelegate(calls);
  const response=await handlePrimaryRead(request('/api/car/NOT-IN-D1'),env,null,delegate),body=await response.json();
  assert.equal(calls.length,1);assert.equal(body.read_source,'provider');assert.equal(body.fallback_reason,'d1_record_missing');
  assert.equal(body.data.vin,'PROVIDER-VIN');assert.equal(body.read.catalog_complete,false);sqlite.close();
});

test('stale D1 detail becomes hybrid and fills nulls without erasing useful D1 fields',async()=>{
  const {sqlite,d1}=setup(),env=envFor(d1),calls=[],delegate=providerDelegate(calls,{body:{ok:true,data:{vin:null,lot_number:'LOT-IAAI',platform:'iaai',year:2022,make:'FreshMake',model:null,media:{items:['https://img.example/a.jpg']}},source:'apibara',match:'exact'}});
  sqlite.prepare("UPDATE auction_listings SET summary_synced_at='2026-09-01T00:00:00.000Z' WHERE listing_id='listing-iaai'").run();
  const response=await handlePrimaryRead(request('/api/car/LOT-IAAI'),env,null,delegate),body=await response.json();
  assert.equal(calls.length,1);assert.equal(body.read_source,'hybrid');assert.equal(body.fallback_reason,'d1_detail_stale');
  assert.equal(body.data.vin,'TESTVIN000000000002');assert.equal(body.data.make,'FreshMake');assert.equal(body.data.model,'Civic');
  assert.deepEqual(body.data.media.items,['https://img.example/a.jpg']);sqlite.close();
});

test('D1 history separates observed snapshots from confirmed events and does not invent sale history',async()=>{
  const {sqlite,d1}=setup(),env={...envFor(d1),REXBID_D1_HISTORY_MAX_AGE_MS:String(365*24*60*60*1000)},calls=[],delegate=providerDelegate(calls);
  let response=await handlePrimaryRead(request('/api/car/LOT-IAAI/history'),env,null,delegate),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.read_source,'d1');assert.equal(body.rex_history.kind,'snapshots_only');
  assert.equal(body.rex_history.snapshots.length,1);assert.equal(body.rex_history.events.length,0);assert.deepEqual(body.history,[]);
  sqlite.prepare(`INSERT INTO auction_events(event_id,listing_id,source_key,provider,platform,provider_event_id,event_key,vin_normalized,lot,auction_date,sale_date,source_status,canonical_status,final_price_usd,observed_at,created_at,updated_at)
    VALUES('event-confirmed','listing-iaai','source-iaai','apibara','iaai','source-event','event-key','TESTVIN000000000002','LOT-IAAI','2026-09-01','2026-09-01','Sold','sold',2800,? ,? ,?)`).run(new Date(NOW-10_000).toISOString(),new Date(NOW-10_000).toISOString(),new Date(NOW-10_000).toISOString());
  response=await handlePrimaryRead(request('/api/car/LOT-IAAI/history'),env,null,delegate);body=await response.json();
  assert.equal(body.rex_history.kind,'events_and_snapshots');assert.equal(body.rex_history.events.length,1);
  assert.equal(body.history[0].kind,'confirmed_auction_event');assert.equal(body.history[0].final_price,2800);assert.deepEqual(calls,[]);sqlite.close();
});

test('history missing from D1 falls back; D1 errors and the OFF rollback switch delegate to provider',async()=>{
  const {sqlite,d1}=setup(),env=envFor(d1),calls=[],delegate=providerDelegate(calls);
  const missing=await handlePrimaryRead(request('/api/car/UNKNOWN/history'),env,null,delegate),missingBody=await missing.json();
  assert.equal(missingBody.read_source,'provider');assert.equal(missingBody.fallback_reason,'d1_record_missing');
  const rolledBack=await handlePrimaryRead(request('/api/cars'),{...env,REXBID_D1_PRIMARY_READS:'false'},null,delegate);
  assert.equal(rolledBack,null,'flag OFF restores original provider-backed Worker path');
  const brokenDb={prepare(){throw new Error('schema unavailable');}};
  const fallbackResponse=await handlePrimaryRead(request('/api/filters'),{...env,REXBID_DB:brokenDb},null,delegate),fallbackBody=await fallbackResponse.json();
  assert.equal(fallbackBody.read_source,'provider');assert.equal(fallbackBody.fallback_reason,'d1_unavailable_or_schema_mismatch');
  assert.equal(calls.length,2);sqlite.close();
});
