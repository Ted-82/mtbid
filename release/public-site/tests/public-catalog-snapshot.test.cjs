'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {buildPublicCatalogSnapshot,PUBLIC_COLUMNS}=require('../scripts/public-catalog-snapshot.cjs');
const schema=fs.readFileSync(path.join(__dirname,'../docs/proposals/0004_d1_sync_2.sql'),'utf8');
const WHEN='2026-10-03T10:11:12.000Z',CAPTURED='2026-10-07T15:00:00.000Z';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);
  const columns=Object.fromEntries(Object.keys(PUBLIC_COLUMNS).map(table=>[table,sqlite.prepare('PRAGMA table_info('+table+')').all()]));sqlite.close();
  return {columns,capturedAt:CAPTURED,tables:{
    vehicle_sources:[{source_key:'apibara:copart:source1',provider:'apibara',platform:'copart',provider_vehicle_id:'real-source1',identity_kind:'provider_vehicle_id',identity_state:'resolved',entity_id:'do-not-reconcile-this-entity',source_updated_at:WHEN,first_seen_at:WHEN,last_seen_at:WHEN,normalizer_version:2,source_fingerprint:'real-source-fingerprint',created_at:WHEN,updated_at:WHEN,last_success_at:CAPTURED,sync_status:'running',lease_owner:'PRIVATE LEASE',last_error_code:'PRIVATE ERROR',auth_token:'PRIVATE TOKEN'}],
    auction_listings:[{listing_id:'listing1',source_key:'apibara:copart:source1',platform:'copart',listing_identity_kind:'source_listing_id',identity_state:'resolved',source_listing_id:'real-listing1',vin_normalized:'5YJ3E1EA0LF000001',lot:'12345678',vehicle_title:'Original public title',year:2020,current_bid_usd:1234,source_price_usd:2222,final_price_usd:null,media_urls_json:JSON.stringify(['https://media.example/original.jpg','http://unsafe.example/photo.jpg','data:image/png;base64,PRIVATE']),media_thumbs_json:JSON.stringify([{thumb:'https://media.example/thumb.jpg',raw:'PRIVATE EXTRA'}]),source_updated_at:WHEN,first_seen_at:WHEN,last_seen_at:WHEN,summary_synced_at:WHEN,detail_synced_at:WHEN,freshness_class:'warm',fingerprint:'listing-fingerprint',normalizer_version:2,created_at:WHEN,updated_at:WHEN,next_refresh_at:CAPTURED,private_customer_email:'PRIVATE ACCOUNT'}],
    auction_listing_snapshots:[{snapshot_id:7,listing_id:'listing1',observed_at:WHEN,auction_state:'open',current_bid_usd:1200,buy_now_usd:null,fingerprint:'snapshot-fingerprint',normalizer_version:2,raw_payload:'PRIVATE RAW'}],
    auction_events:[{event_id:'event1',listing_id:'listing1',source_key:'apibara:copart:source1',provider:'apibara',platform:'copart',provider_event_id:'real-event1',event_key:'real-event-key',vin_normalized:'5YJ3E1EA0LF000001',lot:'12345678',sale_date:'2026-10-02',source_status:'sold',canonical_status:'sold',source_price_usd:9999,final_price_usd:null,observed_at:WHEN,fingerprint:'event-fingerprint',normalizer_version:2,identity_state:'resolved',created_at:WHEN,updated_at:WHEN}],
    users:[{email:'PRIVATE ACCOUNT',password:'PRIVATE PASSWORD'}],sync_runs:[{run_id:'PRIVATE RUN'}],provider_request_budgets:[{token:'PRIVATE BUDGET'}],provider_sync_scopes:[{cursor:'PRIVATE CURSOR',status:'complete',last_complete_at:CAPTURED}]
  }};
}
function rows(plan,table){return plan.statements.filter(item=>item.table===table).map(item=>Object.fromEntries(item.columns.map((column,index)=>[column,item.params[index]])));}
function rehearsal(plan){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');db.exec(schema);db.exec('BEGIN');try{for(const item of plan.statements)db.prepare(item.sql).run(...item.params);db.exec('COMMIT');return db;}catch(error){db.exec('ROLLBACK');db.close();throw error;}}

test('public snapshot plan rehearses against actual schema 0004 without private tables or false success',()=>{
  const input=fixture(),before=JSON.stringify(input),plan=buildPublicCatalogSnapshot(input),db=rehearsal(plan);
  try{
    assert.equal(JSON.stringify(input),before);assert.deepEqual(plan.manifest.counts,{vehicle_sources:1,auction_listings:1,auction_listing_snapshots:1,auction_events:1});assert.equal(plan.manifest.accounts_included,false);assert.equal(plan.manifest.catalog_complete,false);assert.equal(plan.manifest.status,'partial');
    assert.doesNotMatch(JSON.stringify(plan),/PRIVATE|auth_token|lease_owner|last_error_code|sync_runs|private_customer_email|provider_request_budgets/);
    assert.equal(db.prepare('SELECT entity_id,last_success_at,lease_owner,last_error_code FROM vehicle_sources').get().entity_id,null);
    assert.equal(db.prepare('SELECT last_success_at FROM vehicle_sources').get().last_success_at,null);
    const scope=db.prepare('SELECT * FROM provider_sync_scopes').get();assert.equal(scope.status,'partial');assert.equal(scope.cursor,null);assert.equal(scope.last_complete_at,null);assert.equal(scope.last_success_at,null);assert.match(scope.scope_key,/^public-snapshot:apibara:copart:/);
    for(const table of ['vehicle_entities','sync_runs','sync_page_commits','sync_batch_guards','provider_request_budgets','provider_request_reservations'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});

test('public snapshot preserves real timestamps and prices and sanitizes only media with existing policy',()=>{
  const plan=buildPublicCatalogSnapshot(fixture()),listing=rows(plan,'auction_listings')[0],event=rows(plan,'auction_events')[0];
  for(const field of ['created_at','updated_at','source_updated_at','first_seen_at','last_seen_at','summary_synced_at','detail_synced_at'])assert.equal(listing[field],WHEN);
  assert.equal(event.sale_date,'2026-10-02');assert.equal(event.observed_at,WHEN);assert.equal(event.final_price_usd,null);assert.equal(event.source_price_usd,9999);assert.equal(listing.final_price_usd,null);
  assert.deepEqual(JSON.parse(listing.media_urls_json),['https://media.example/original.jpg']);assert.deepEqual(JSON.parse(listing.media_thumbs_json),['https://media.example/thumb.jpg']);assert.deepEqual(plan.manifest.media,{input_references:4,retained_references:2});
  assert.equal(rows(plan,'auction_listing_snapshots')[0].snapshot_id,7);assert.equal(rows(plan,'vehicle_sources')[0].provider_vehicle_id,'real-source1');
});

test('same VIN on different LOTs remains distinct while exact platform/LOT collisions stop the plan',()=>{
  const input=fixture(),listing=input.tables.auction_listings[0];input.tables.auction_listings.push({...listing,listing_id:'listing2',source_listing_id:'real-listing2',lot:'87654321'});
  assert.equal(buildPublicCatalogSnapshot(input).manifest.counts.auction_listings,2);
  input.tables.auction_listings[1].lot=listing.lot;assert.throws(()=>buildPublicCatalogSnapshot(input),/LOT\/platform collision/);
  const existing=fixture();existing.existingListings=[{platform:'copart',lot:listing.lot}];assert.throws(()=>buildPublicCatalogSnapshot(existing),/LOT\/platform collision/);
});

test('same LOT on Copart and IAAI is retained with two separate partial scopes',()=>{
  const input=fixture(),source=input.tables.vehicle_sources[0],listing=input.tables.auction_listings[0];
  input.tables.vehicle_sources.push({...source,source_key:'apibara:iaai:source2',platform:'iaai'});
  input.tables.auction_listings.push({...listing,listing_id:'listing2',source_key:'apibara:iaai:source2',platform:'iaai'});
  const plan=buildPublicCatalogSnapshot(input),db=rehearsal(plan);try{assert.equal(db.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM provider_sync_scopes WHERE status=? AND cursor IS NULL').get('partial').n,2);}finally{db.close();}
});

test('only Apibara Copart/IAAI and actual parent associations are accepted',()=>{
  for(const mutate of [input=>input.tables.vehicle_sources[0].provider='provider-b',input=>input.tables.vehicle_sources[0].platform='other',input=>input.tables.auction_listings[0].source_key='missing',input=>input.tables.auction_listings[0].platform='iaai',input=>input.tables.auction_listing_snapshots[0].listing_id='missing',input=>input.tables.auction_events[0].listing_id='missing',input=>input.tables.auction_events[0].provider='provider-b',input=>input.tables.auction_events[0].source_key='missing']){
    const input=fixture();mutate(input);assert.throws(()=>buildPublicCatalogSnapshot(input),/Nieprawidłowy publiczny snapshot/);
  }
  const input=fixture();input.tables.auction_events[0].listing_id=null;const plan=buildPublicCatalogSnapshot(input),db=rehearsal(plan);try{assert.equal(db.prepare('SELECT listing_id FROM auction_events').get().listing_id,null);}finally{db.close();}
});

test('schema whitelist ignores new private columns and every value is passed as a bound parameter',()=>{
  const input=fixture();for(const table of Object.keys(PUBLIC_COLUMNS)){input.columns[table].push({name:'secret_added_column'});for(const row of input.tables[table])row.secret_added_column='PRIVATE SECRET';}
  input.tables.auction_listings[0].vehicle_title="Vehicle'); DROP TABLE users; --";
  const plan=buildPublicCatalogSnapshot(input);assert.doesNotMatch(JSON.stringify(plan),/PRIVATE SECRET|secret_added_column/);for(const item of plan.statements){assert.equal(item.sql.includes('DROP TABLE'),false);assert.equal(item.columns.length,item.params.length);assert.equal((item.sql.match(/\?/g)||[]).length,item.params.length);}
  const db=rehearsal(plan);try{assert.equal(db.prepare('SELECT vehicle_title FROM auction_listings').get().vehicle_title,input.tables.auction_listings[0].vehicle_title);}finally{db.close();}
});

test('required missing schema/data, duplicate keys, malformed media and invalid timestamps fail without partial plan',()=>{
  for(const mutate of [input=>input.columns.auction_listings=input.columns.auction_listings.filter(column=>column.name!=='listing_id'),input=>delete input.tables.auction_listings[0].lot,input=>input.tables.auction_events.push({...input.tables.auction_events[0]}),input=>input.tables.auction_listing_snapshots[0].snapshot_id=0,input=>input.tables.auction_listings[0].media_urls_json='{bad',input=>input.tables.auction_listings[0].updated_at='invalid',input=>input.tables.auction_listings[0].vehicle_title={private:'PRIVATE'},input=>input.tables.auction_listings[0].current_bid_usd=Infinity]){
    const input=fixture();mutate(input);assert.throws(()=>buildPublicCatalogSnapshot(input),/Nieprawidłowy publiczny snapshot/);
  }
});

test('manifest hashes are deterministic, ignore private input and distinguish public data or capture time changes',()=>{
  const input=fixture(),first=buildPublicCatalogSnapshot(input);input.tables.users[0].password='OTHER SECRET';input.tables.provider_sync_scopes[0].cursor='OTHER CURSOR';input.tables.vehicle_sources[0].lease_owner='OTHER LEASE';
  assert.deepEqual(buildPublicCatalogSnapshot(input).manifest,first.manifest);
  input.capturedAt='2026-10-08T15:00:00.000Z';const later=buildPublicCatalogSnapshot(input);assert.equal(later.manifest.content_sha256,first.manifest.content_sha256);assert.notEqual(later.manifest.plan_sha256,first.manifest.plan_sha256);
  input.tables.auction_listings[0].vehicle_title='Different public title';assert.notEqual(buildPublicCatalogSnapshot(input).manifest.content_sha256,first.manifest.content_sha256);
});

test('offline builder makes no fetch calls and empty source input never claims a complete catalog',()=>{
  const input=fixture();for(const table of Object.keys(PUBLIC_COLUMNS))input.tables[table]=[];
  const saved=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw new Error('Network forbidden');};
  try{const result=buildPublicCatalogSnapshot(input);assert.equal(calls,0);assert.equal(result.statements.length,0);assert.equal(result.manifest.catalog_complete,false);assert.equal(result.manifest.status,'partial');assert.deepEqual(result.manifest.scope_keys,[]);}finally{globalThis.fetch=saved;}
});


test('listing observation range excludes future auction dates and preserves original non-ISO source values',()=>{
  const input=fixture(),listing=input.tables.auction_listings[0];listing.auction_at='2030-01-01T12:00:00.000Z';listing.last_seen_at='2026-10-04 10:11:12';
  const plan=buildPublicCatalogSnapshot(input);assert.equal(rows(plan,'auction_listings')[0].last_seen_at,'2026-10-04 10:11:12');assert.equal(plan.manifest.all_timestamp_range.latest,listing.auction_at);assert.deepEqual(plan.manifest.listing_observed_at_range,{earliest:WHEN,latest:'2026-10-04 10:11:12'});
  for(const table of Object.keys(PUBLIC_COLUMNS))input.tables[table]=[];assert.deepEqual(buildPublicCatalogSnapshot(input).manifest.listing_observed_at_range,{earliest:null,latest:null});
});
