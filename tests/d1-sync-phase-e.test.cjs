const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {D1ReadRepository, toPublicVehicleDTO} = require('../sync/d1-read-repository.js');
const {decideReadSource} = require('../sync/read-policy.js');
const {readDetail} = require('../sync/read-service.js');
const {handleD1ReadRequest} = require('../staging/d1-read-routes.cjs');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-09-29T18:00:00.000Z');

class D1Fixture {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    const db = this.sqlite;
    return {bind(...params) { return {
      async first() { return db.prepare(sql).get(...params) ?? null; },
      async all() { return {results: db.prepare(sql).all(...params)}; },
      async run() { const r = db.prepare(sql).run(...params); return {success:true,meta:{changes:Number(r.changes)}}; }
    }; },
    async first(...params) { return db.prepare(sql).get(...params) ?? null; },
    async all(...params) { return {results: db.prepare(sql).all(...params)}; },
    async run(...params) { const r = db.prepare(sql).run(...params); return {success:true,meta:{changes:Number(r.changes)}}; }};
  }
}

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of ['migrations/0000_rexbid_base.sql','migrations/0001_auction_history_events.sql',
    'migrations-staging/0003_accounts_foundation.sql','docs/proposals/0004_d1_sync_2.sql']) {
    sqlite.exec(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  sqlite.prepare(`INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,last_attempt_at,updated_at)
    VALUES('scope-copart','apibara','copart','discovery','partial','opaque-next-page','2026-09-29T17:00:00.000Z','2026-09-29T17:00:00.000Z')`).run();
  const source = sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,provider_vehicle_id,identity_kind,identity_state,
    first_seen_at,last_seen_at,last_attempt_at,last_success_at,sync_status,created_at,updated_at)
    VALUES(?,?,?,?,?,'resolved',?,?,?,?, 'idle',?,?)`);
  const listing = sqlite.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,listing_identity_kind,identity_state,
    source_listing_id,vin_normalized,lot,vehicle_title,make,model,year,auction_state,source_status,auction_at,is_timed,timed_end_at,
    current_bid_usd,buy_now_usd,seller_name,seller_type,primary_damage,run_state,keys_present,document_name,location_display,
    location_state,odometer_value,odometer_unit,first_seen_at,last_seen_at,summary_synced_at,freshness_class,fingerprint,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const snapshot = sqlite.prepare(`INSERT INTO auction_listing_snapshots(listing_id,observed_at,auction_state,auction_at,timed_end_at,
    current_bid_usd,buy_now_usd,fingerprint,normalizer_version) VALUES(?,?,?,?,?,?,?,?,1)`);
  for (let i=1;i<=3;i++) {
    const id = `listing-${i}`; const sourceKey = `source-${i}`; const seen = `2026-09-29T17:00:0${i}.000Z`;
    const vehicleId = `provider-id-${i}`;
    source.run(sourceKey,'apibara','copart',vehicleId,'provider_vehicle_id',`2026-09-29T17:00:00.000Z`,seen,seen,seen,`2026-09-29T17:00:00.000Z`,`2026-09-29T17:00:00.000Z`);
    listing.run(id,sourceKey,'copart','source_listing_id','resolved',`LOT-${i}`,`TESTVIN00000000000${i}`,`LOT-${i}`,
      `Test Car ${i}`,'TestMake','TestModel',2020+i,'upcoming','Upcoming',`2026-10-0${i}T12:00:00.000Z`,0,null,
      1000*i,null,'Seller','insurance','Front End','run_and_drive',1,'Salvage','Test City, TX','TX',1234+i,'mi',
      '2026-09-29T17:00:00.000Z',seen,seen,'warm',`fingerprint-${i}`,'2026-09-29T17:00:00.000Z',seen);
    snapshot.run(id,seen,'upcoming',`2026-10-0${i}T12:00:00.000Z`,null,1000*i,null,`snapshot-fingerprint-${i}`);
  }
  return {sqlite, d1:new D1Fixture(sqlite)};
}

test('D1 list read is canonical, filterable and never claims partial scope is a full catalog', async () => {
  const {sqlite,d1} = setup();
  const repo = new D1ReadRepository(d1,{now:()=>NOW,maxAgeMs:24*60*60*1000});
  const page = await repo.listCatalog({platform:'copart',make:'TestMake',limit:2});
  assert.equal(page.records.length,2);
  assert.equal(page.records[0].vehicle.provider,'apibara');
  assert.equal(page.records[0].vehicle.pricing.current_bid,3000);
  assert.equal(page.read.source,'d1');
  assert.equal(page.read.coverage.complete,false);
  assert.equal(page.read.catalog_complete,false);
  assert.equal(page.read.coverage.platforms[0].next_page_available,true);
  assert.ok(page.page.next_cursor);
  const next = await repo.listCatalog({platform:'copart',make:'TestMake',limit:2,cursor:page.page.next_cursor});
  assert.equal(next.records.length,1);
  assert.notEqual(next.records[0].listing_id,page.records[0].listing_id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,3);
  sqlite.close();
});

test('D1 detail read resolves listing/source without requiring a vehicle entity and maps the public API DTO', async () => {
  const {sqlite,d1} = setup();
  const repo = new D1ReadRepository(d1,{now:()=>NOW});
  const record = await repo.getListingById('listing-1');
  assert.ok(record);
  assert.equal(record.vehicle.vin,'TESTVIN000000000001');
  assert.equal(record.identity.provider_listing_id,'LOT-1');
  assert.equal(record.freshness.status,'fresh');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM vehicle_entities').get().n,0);
  const dto = toPublicVehicleDTO(record.vehicle);
  for (const key of ['vin','lot_number','platform','auction','pricing','seller','condition','sale_document','media']) assert.ok(Object.hasOwn(dto,key));
  assert.equal(dto.pricing.current_bid_usd,1000);
  assert.deepEqual(dto.media.items,[]);
  assert.equal((await repo.getListingBySource({provider:'apibara',platform:'copart',providerVehicleId:'provider-id-1'})).listing_id,'listing-1');
  sqlite.close();
});

test('D1 snapshot history returns observed states separately and does not fabricate auction events', async () => {
  const {sqlite,d1} = setup();
  const repo = new D1ReadRepository(d1,{now:()=>NOW});
  const result = await repo.getSnapshotPage({listingId:'listing-1',limit:1});
  assert.equal(result.events.length,0);
  assert.equal(result.read.history_kind,'snapshots_only');
  assert.equal(result.read.confirmed_event_count,0);
  assert.equal(result.snapshots.length,1);
  assert.equal(result.snapshots[0].kind,'observed_snapshot');
  sqlite.prepare(`INSERT INTO auction_listing_snapshots(listing_id,observed_at,auction_state,current_bid_usd,fingerprint,normalizer_version)
    VALUES('listing-1','2026-09-29T17:30:00.000Z','live',1500,'later-snapshot',1)`).run();
  const first = await repo.getSnapshotPage({listingId:'listing-1',limit:1});
  const second = await repo.getSnapshotPage({listingId:'listing-1',limit:1,cursor:first.page.next_cursor});
  assert.equal(first.snapshots[0].auction_state,'live');
  assert.equal(second.snapshots[0].auction_state,'upcoming');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
  sqlite.close();
});

test('D1 filter metadata is derived from known rows and explicitly remains partial', async () => {
  const {sqlite,d1} = setup();
  const result = await new D1ReadRepository(d1).getFilterMetadata({platform:'copart'});
  assert.deepEqual(result.values.makes.map(item=>item.value),['TestMake']);
  assert.equal(result.values.models[0].model,'TestModel');
  assert.equal(result.read.metadata_complete,false);
  assert.equal(result.read.known_rows_only,true);
  sqlite.close();
});

test('read-source policy uses fresh D1 without provider and falls back on stale/missing data or partial catalog', async () => {
  const fresh = decideReadSource({kind:'detail',d1Exists:true,d1Fresh:true,providerFallbackEnabled:true});
  assert.deepEqual(fresh,{source:'d1',useD1:true,useProvider:false,complete:null,reason:null});
  let providerCalls=0;
  const fakeRepository={getListingById:async()=>({vehicle:{provider:'apibara',platform:'copart',pricing:{current_bid:3}},freshness:{status:'fresh'}})};
  const freshResult=await readDetail({repository:fakeRepository,listingId:'x',providerFallbackEnabled:true,providerRead:async()=>{providerCalls++;}});
  assert.equal(freshResult.read.source,'d1');
  assert.equal(providerCalls,0);
  const partial=decideReadSource({kind:'catalog',d1Exists:true,scopeComplete:false,providerFallbackEnabled:true});
  assert.equal(partial.source,'provider');
  assert.equal(partial.complete,null);
  assert.equal(decideReadSource({kind:'catalog',d1Exists:true,scopeComplete:false}).complete,false);
});

test('staging D1 read API is host/flag gated, read-only, no-store and exposes partial coverage', async () => {
  const {sqlite,d1}=setup();
  const env={REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev',
    REXBID_D1_READ_DIAGNOSTICS:'enabled',REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_DB:d1};
  const response=await handleD1ReadRequest(new Request('https://rexbid-auth-test.tedn828.workers.dev/__staging/d1-read/catalog?platform=copart&per_page=2'),env);
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.ok,true);
  assert.equal(body.data.length,2);
  assert.equal(body.meta.read_source,'d1');
  assert.equal(body.meta.catalog_complete,false);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.match(response.headers.get('X-Robots-Tag'),/noindex/);
  const detail=await handleD1ReadRequest(new Request('https://rexbid-auth-test.tedn828.workers.dev/__staging/d1-read/detail?listing_id=listing-1'),env);
  const detailBody=await detail.json();
  assert.equal(detail.status,200);
  assert.equal(detailBody.source,'d1');
  assert.equal(detailBody.data.vin,'TESTVIN000000000001');
  assert.equal(detail.headers.get('Cache-Control'),'private, no-store');
  const history=await handleD1ReadRequest(new Request('https://rexbid-auth-test.tedn828.workers.dev/__staging/d1-read/history?listing_id=listing-1'),env);
  const historyBody=await history.json();
  assert.equal(history.status,200);
  assert.deepEqual(historyBody.history,[]);
  assert.equal(historyBody.rex_history.kind,'snapshots_only');
  assert.deepEqual(historyBody.rex_history.records,[]);
  assert.equal(historyBody.rex_history.snapshots.length,1);
  assert.equal(historyBody.source,'d1');
  assert.equal(historyBody.meta.has_more,false);
  assert.equal(historyBody.read.confirmed_event_count,0);
  const filters=await handleD1ReadRequest(new Request('https://rexbid-auth-test.tedn828.workers.dev/__staging/d1-read/filters?platform=copart'),env);
  const filtersBody=await filters.json();
  assert.equal(filters.status,200);
  assert.equal(filtersBody.meta.metadata_complete,false);
  assert.equal(filtersBody.meta.known_rows_only,true);
  const denied=await handleD1ReadRequest(new Request('https://rexbid-auth-test.tedn828.workers.dev/__staging/d1-read/catalog'),{...env,REXBID_D1_READ_DIAGNOSTICS:'disabled'});
  assert.equal(denied.status,404);
  const method=await handleD1ReadRequest(new Request('https://rexbid-auth-test.tedn828.workers.dev/__staging/d1-read/catalog',{method:'POST'}),env);
  assert.equal(method.status,405);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,3);
  sqlite.close();
});
