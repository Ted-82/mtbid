const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const contract = require('../providers/contract.js');
const {createSyncIdentity} = require('../sync/core.js');
const {D1SyncRepository} = require('../sync/d1-repository.js');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const providerBFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/provider-b-vehicle.json'), 'utf8'));

class DisposableD1 {
  constructor(database) {
    this.database = database;
    this.batchTail = Promise.resolve();
  }

  prepare(sql) {
    const database = this.database;
    return {
      bind(...params) {
        const execute = () => database.prepare(sql);
        return {
          sql,
          params,
          async run() {
            const result = execute().run(...params);
            return {success: true, meta: {changes: Number(result.changes)}};
          },
          async first() { return execute().get(...params) ?? null; },
          async all() { return {results: execute().all(...params)}; }
        };
      }
    };
  }

  batch(statements) {
    const run = this.batchTail.then(() => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => {
          const prepared = this.database.prepare(statement.sql);
          if (/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(statement.sql)) return {success: true, results: prepared.all(...statement.params)};
          const result = prepared.run(...statement.params);
          return {success: true, meta: {changes: Number(result.changes)}};
        });
        this.database.exec('COMMIT');
        return results;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    });
    this.batchTail = run.catch(() => undefined);
    return run;
  }
}

function setupDisposableDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const d1 = new DisposableD1(sqlite);
  const sql = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
  sqlite.exec(sql('migrations/0000_rexbid_base.sql'));
  sqlite.prepare(`INSERT INTO vehicles(vehicle_key,vin,platform,lot,current_bid,first_seen_at,last_seen_at,raw_json)
    VALUES(?,?,?,?,?,?,?,?)`).run('legacy-key', 'LEGACYVIN001', 'copart', 'OLD-1', 99, '2026-01-01', '2026-01-02', '{"legacy":true}');
  sqlite.prepare(`INSERT INTO auction_history(vehicle_key,platform,auction_date,price,status,event_hash,captured_at,raw_json)
    VALUES(?,?,?,?,?,?,?,?)`).run('legacy-key', 'copart', '2025-12-01', 88, 'legacy', 'legacy-hash', '2026-01-02', '{"history":true}');
  sqlite.exec(sql('migrations/0001_auction_history_events.sql'));
  const legacyBefore = {
    vehicle: sqlite.prepare(`SELECT * FROM vehicles WHERE vehicle_key='legacy-key'`).get(),
    history: sqlite.prepare(`SELECT * FROM auction_history WHERE event_hash='legacy-hash'`).get(),
    vehiclePk: sqlite.prepare(`PRAGMA table_info(vehicles)`).all().filter(row => row.pk).map(row => row.name),
    historyPk: sqlite.prepare(`PRAGMA table_info(auction_history)`).all().filter(row => row.pk).map(row => row.name)
  };
  sqlite.exec(sql('docs/proposals/0004_d1_sync_2.sql'));
  sqlite.exec(sql('docs/proposals/0004_d1_sync_2.sql'));
  return {sqlite, d1, repo: new D1SyncRepository(d1), legacyBefore};
}

function vehicle(overrides = {}) {
  return contract.createRexVehicle({
    provider: 'apibara', provider_vehicle_id: 'vehicle-source-1', platform: 'copart',
    vin: '1HGCM82633A123456', lot: 'LOT-100', title: '2021 Honda Accord', year: 2021,
    make: 'Honda', model: 'Accord', trim: 'Sport', body_style: 'Sedan', fuel_type: 'Gasoline',
    transmission: 'Automatic', drive_type: 'FWD', engine_size_l: 2.0,
    auction: contract.createRexAuction({state: 'upcoming', source_status: 'Upcoming', auction_at: '2026-10-10T10:00:00Z', timed: false, source_listing_id: 'listing-100'}),
    pricing: contract.createRexPricing({currency: 'USD', current_bid: 1500, current_bid_secondary: 1600, buy_now: 4500}),
    seller: contract.createRexSeller({name: 'Seller Company', type: 'insurance'}),
    condition: contract.createRexCondition({primary_damage: 'Front End', run_state: 'run_drive', keys_present: true, airbags: 'intact'}),
    document: contract.createRexDocument({name: 'Salvage', type: 'SALVAGE', registration: null, export: true}),
    media: contract.createRexMedia({items: ['https://img.example/a.jpg'], thumbs: ['https://img.example/a-sm.jpg'], has_video: true, has_360: false}),
    location: {display: 'Austin, TX', state: 'TX', postal_code: '78701'}, odometer: {value: 42000, unit: 'mi'},
    raw_payload: {shouldNotPersist: 'fixture'}, ...overrides
  });
}

function record(v, options = {}) {
  return {vehicle: v, identity: createSyncIdentity(v, {observationKey: 'feed/page/row', ...options})};
}

function canonicalProviderB(raw) {
  return contract.createRexVehicle({
    provider: 'provider-b', provider_vehicle_id: raw.vehicleRef, platform: raw.market.toLowerCase(),
    vin: raw.identity.chassis, lot: raw.identity.stock, year: raw.description.modelYear,
    make: raw.description.manufacturer, model: raw.description.nameplate, trim: raw.description.trimName,
    auction: contract.createRexAuction({state: raw.sale.phase, source_status: raw.sale.phase,
      auction_at: raw.sale.startsAt, timed: raw.sale.timed, timed_end_at: raw.sale.timedClose,
      source_listing_id: raw.vehicleRef}),
    pricing: contract.createRexPricing({currency: raw.money.currencyCode, current_bid: raw.money.leadingOffer,
      buy_now: raw.money.instantPurchase, final_price: raw.money.settledAmount}),
    seller: contract.createRexSeller({name: raw.sellerRecord.legalName, type: raw.sellerRecord.category}),
    condition: contract.createRexCondition({primary_damage: raw.vehicleState.mainDamage,
      secondary_damage: raw.vehicleState.additionalDamage, run_state: raw.vehicleState.operation,
      keys_present: raw.vehicleState.keysIncluded}),
    document: contract.createRexDocument({name: raw.paperwork.display,
      registration: raw.paperwork.registrationPossible, export: raw.paperwork.exportPossible}),
    media: contract.createRexMedia({items: raw.images.primary, thumbs: raw.images.small,
      has_video: raw.images.videoAvailable, has_360: raw.images.rotationAvailable}),
    location: raw.place.displayName, odometer: {value: raw.distance.miles, unit: 'mi'}, raw_payload: raw
  });
}

async function startScope(repo, options = {}) {
  const values = {scopeKey: 'scope-main', provider: 'apibara', platform: 'copart', operation: 'discovery', owner: 'worker-a', token: 'lease-token-a', now: NOW, ttlMs: 60_000, ...options};
  const lease = await repo.acquireLease(values);
  assert.equal(lease.acquired, true);
  const runId = values.runId || 'run-a';
  await repo.createRun({runId, scopeKey: values.scopeKey, provider: values.provider, platform: values.platform, operation: values.operation, now: values.now});
  return {...values, ...lease, runId};
}

test('0004 jest addytywne i wielokrotne założenie disposable DB nie zmienia legacy rows ani kluczy', () => {
  const {sqlite, legacyBefore} = setupDisposableDatabase();
  assert.deepEqual(sqlite.prepare(`SELECT * FROM vehicles WHERE vehicle_key='legacy-key'`).get(), legacyBefore.vehicle);
  assert.deepEqual(sqlite.prepare(`SELECT * FROM auction_history WHERE event_hash='legacy-hash'`).get(), legacyBefore.history);
  assert.deepEqual(sqlite.prepare(`PRAGMA table_info(vehicles)`).all().filter(row => row.pk).map(row => row.name), legacyBefore.vehiclePk);
  assert.deepEqual(sqlite.prepare(`PRAGMA table_info(auction_history)`).all().filter(row => row.pk).map(row => row.name), legacyBefore.historyPk);
  for (const table of ['vehicle_entities','vehicle_sources','auction_listings','auction_events','provider_sync_scopes','sync_runs','sync_page_commits','sync_batch_guards','provider_request_budgets','provider_request_reservations']) {
    assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${table} starts empty`);
  }
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='vehicles'`).get().n, 1);
  sqlite.close();
});

test('strona discovery + run progress + opaque cursor zapisują się atomowo; replay jest idempotentny', async () => {
  const {sqlite, repo} = setupDisposableDatabase();
  const lease = await startScope(repo);
  const first = {scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: null, nextCursor: 'opaque/page-2',
    records: [record(vehicle())], now: NOW};
  const committed = await repo.persistDiscoveryPage(first);
  assert.equal(committed.complete, false);
  assert.equal((await repo.getScope(lease.scopeKey)).cursor, 'opaque/page-2');
  assert.equal((await repo.getScope(lease.scopeKey)).last_complete_at, null);
  assert.equal((await repo.getRun(lease.runId)).pages_completed, 1);
  assert.equal((await repo.getListing(first.records[0].identity.listingId)).seller_name, 'Seller Company');
  assert.equal(await repo.getSource({provider: 'apibara', platform: 'copart', providerVehicleId: 'vehicle-source-1'}).then(Boolean), true);
  assert.equal((await repo.persistDiscoveryPage(first)).replayed, true);
  await assert.rejects(repo.persistDiscoveryPage({...first, nextCursor: 'unexpected/cursor'}), /CURSOR_REPLAY_MISMATCH/);
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM auction_listings`).get().n, 1);

  const secondVehicle = vehicle({provider_vehicle_id: 'vehicle-source-2', lot: 'LOT-200', auction: contract.createRexAuction({source_listing_id: 'listing-200'})});
  const second = {...first, cursor: 'opaque/page-2', nextCursor: null, records: [record(secondVehicle)], now: NOW + 1000};
  await assert.rejects(repo.persistDiscoveryPage({...second, crashAt: 'before_batch'}), /SIMULATED_CRASH_BEFORE_BATCH/);
  assert.equal((await repo.getScope(lease.scopeKey)).cursor, 'opaque/page-2');
  assert.equal(await repo.getListing(second.records[0].identity.listingId), null);
  await assert.rejects(repo.persistDiscoveryPage({...second, crashAt: 'inside_batch'}), /STALE_LEASE_CURSOR_OR_RUN/);
  assert.equal(await repo.getListing(second.records[0].identity.listingId), null, 'D1 batch failure rolls back source/listing writes');
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM sync_page_commits`).get().n, 1);
  assert.equal((await repo.getRun(lease.runId)).pages_completed, 1);

  const final = await repo.persistDiscoveryPage(second);
  assert.equal(final.complete, true);
  const scope = await repo.getScope(lease.scopeKey);
  assert.equal(scope.cursor, null);
  assert.equal(scope.status, 'complete');
  assert.equal(scope.last_complete_at, new Date(NOW + 1000).toISOString());
  assert.equal((await repo.getRun(lease.runId)).status, 'completed');
  assert.equal((await repo.getScope(lease.scopeKey)).lease_token, null);
  assert.equal((await repo.listDiscoveryDue({provider: lease.provider, platform: lease.platform, status: 'complete', now: NOW + 1001})).results.length, 1,
    'kompletny scope może wrócić do planowania po terminie next_due');
  const nextLease = await repo.acquireLease({...lease, owner: 'worker-b', token: 'lease-token-b', now: NOW + 2000});
  assert.equal(nextLease.acquired, true);
  await repo.createRun({runId: 'run-next-day', scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, now: NOW + 2000});
  const nextRunPage = await repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform,
    runId: 'run-next-day', owner: 'worker-b', token: 'lease-token-b', leaseGeneration: nextLease.leaseGeneration,
    cursor: null, nextCursor: 'opaque/page-2', records: [record(vehicle())], now: NOW + 2001});
  assert.equal(nextRunPage.replayed, false, 'ten sam initial cursor jest dopuszczalny w nowym runie');
  assert.equal((await repo.getRun('run-next-day')).pages_completed, 1);
  sqlite.close();
});

test('partial failure i powtarzający się cursor nie awansują checkpointu ani completed run', async () => {
  const {repo} = setupDisposableDatabase();
  const lease = await startScope(repo, {scopeKey: 'partial', runId: 'run-partial'});
  const v = vehicle();
  await repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: null, nextCursor: 'cursor-A', records: [record(v)], now: NOW});
  await assert.rejects(repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: 'cursor-A', nextCursor: 'cursor-A', records: [record(v)], now: NOW + 1}), /REPEATED_CURSOR/);
  assert.equal((await repo.getScope(lease.scopeKey)).cursor, 'cursor-A');
  await repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: 'cursor-A', nextCursor: 'cursor-B', records: [record(v)], now: NOW + 1});
  await assert.rejects(repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: 'cursor-B', nextCursor: 'cursor-A', records: [record(v)], now: NOW + 2}), /STALE_LEASE_CURSOR_OR_RUN/);
  assert.equal((await repo.getScope(lease.scopeKey)).cursor, 'cursor-B', 'powrót do wcześniej odwiedzonego kursora nie przesuwa checkpointu');
  assert.equal((await repo.getScope(lease.scopeKey)).last_complete_at, null);
  assert.equal((await repo.getRun(lease.runId)).status, 'running');
  await repo.failRun({...lease, errorCode: 'PARTIAL_PAGE_FAILURE', now: NOW + 3});
  assert.equal((await repo.getScope(lease.scopeKey)).status, 'failed');
  assert.equal((await repo.getScope(lease.scopeKey)).last_success_at, null);
  assert.equal((await repo.getRun(lease.runId)).status, 'failed');
});

test('lease acquisition serializuje workerów, odzyskuje expiry i blokuje stale owner przez token+generation', async () => {
  const {sqlite, repo} = setupDisposableDatabase();
  const leaseA = await startScope(repo, {scopeKey: 'lease-race', runId: 'run-old', owner: 'worker-a', token: 'token-old'});
  const blocked = await repo.acquireLease({scopeKey: leaseA.scopeKey, provider: leaseA.provider, platform: leaseA.platform,
    owner: 'worker-b', token: 'token-blocked', now: NOW + 1, ttlMs: 60_000});
  assert.equal(blocked.acquired, false);
  const recovered = await repo.acquireLease({scopeKey: leaseA.scopeKey, provider: leaseA.provider, platform: leaseA.platform,
    owner: 'worker-b', token: 'token-new', now: NOW + 60_001, ttlMs: 60_000});
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.leaseGeneration, leaseA.leaseGeneration + 1);
  assert.equal((await repo.getRun(leaseA.runId)).status, 'interrupted', 'recover lease oznacza poprzedni niedokończony run jako interrupted');
  await repo.createRun({runId: 'run-new', scopeKey: leaseA.scopeKey, provider: leaseA.provider, platform: leaseA.platform, now: NOW + 60_001});
  const v = vehicle();
  await assert.rejects(repo.persistDiscoveryPage({scopeKey: leaseA.scopeKey, provider: leaseA.provider, platform: leaseA.platform,
    runId: leaseA.runId, owner: leaseA.owner, token: leaseA.token, leaseGeneration: leaseA.leaseGeneration,
    cursor: null, nextCursor: null, records: [record(v)], now: NOW + 60_002}), /STALE_LEASE_CURSOR_OR_RUN/);
  assert.equal(await repo.releaseLease({...leaseA, now: NOW + 60_003}), false);
  await assert.rejects(repo.failRun({...leaseA, errorCode: 'STALE', now: NOW + 60_004}), /STALE_LEASE_OR_RUN/);
  assert.equal(await repo.getListing(record(v).identity.listingId), null);
  assert.equal((await repo.getScope(leaseA.scopeKey)).lease_token, 'token-new');
  assert.equal(await repo.releaseLease({scopeKey: leaseA.scopeKey, owner: 'worker-b', token: 'token-new', leaseGeneration: recovered.leaseGeneration, now: NOW + 60_005}), true);
  sqlite.close();
});

test('strukturalnie inny Provider B przechodzi przez ten sam canonical D1 repository bez utrwalania raw/media', async () => {
  const {sqlite, repo} = setupDisposableDatabase();
  const canonical = canonicalProviderB(providerBFixture);
  const lease = await startScope(repo, {scopeKey: 'provider-b-iaai', runId: 'provider-b-run', provider: 'provider-b', platform: 'iaai', owner: 'worker-b', token: 'provider-b-token'});
  await repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: null, nextCursor: null,
    records: [record(canonical)], now: NOW});
  const row = await repo.getListing(record(canonical).identity.listingId);
  assert.equal(row.make, 'Honda');
  assert.equal(row.platform, 'iaai');
  assert.equal(row.auction_state, 'Timed');
  assert.equal(row.current_bid_usd, 500);
  assert.equal(row.seller_name, 'Example Insurance');
  assert.equal(row.timed_end_at, '2026-10-10T15:00:00Z');
  assert.equal('raw_payload' in row, false);
  assert.equal('media_items' in row, false);
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM auction_listing_snapshots`).get().n, 0);
  sqlite.close();
});

test('utrwalona identity rozdziela VIN, provider/platform, LOT reuse, relisting i przypadki niejednoznaczne', async () => {
  const {sqlite, repo} = setupDisposableDatabase();
  const lease = await startScope(repo, {scopeKey: 'identity', runId: 'run-identity'});
  const sameVin = vehicle();
  const sameVinOtherLot = vehicle({lot: 'LOT-101', auction: contract.createRexAuction({source_listing_id: 'listing-101'})});
  const relisting = vehicle({lot: 'LOT-100', auction: contract.createRexAuction({source_listing_id: 'listing-100-relist'})});
  const lotReuse = vehicle({provider_vehicle_id: 'vehicle-source-lot-reuse', auction: contract.createRexAuction({source_listing_id: null})});
  const noVin = vehicle({provider_vehicle_id: 'vehicle-no-vin', vin: null, lot: 'LOT-NOVIN', auction: contract.createRexAuction({source_listing_id: 'listing-no-vin'})});
  const ambiguous = vehicle({provider_vehicle_id: null, lot: null, auction: contract.createRexAuction({source_listing_id: null})});
  const records = [
    record(sameVin), record(sameVinOtherLot), record(relisting),
    record(lotReuse, {listingGeneration: 1}), record(lotReuse, {listingGeneration: 2}), record(noVin),
    record(ambiguous, {observationKey: 'identity/page/ambiguous'})
  ];
  await assert.rejects(repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: null, nextCursor: null,
    records: [record(vehicle({platform: 'iaai'}))], now: NOW}), /Identity nie zgadza się/);
  await repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: null, nextCursor: null, records, now: NOW});
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM auction_listings`).get().n, 7);
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM vehicle_sources`).get().n, 4);
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM auction_listings WHERE vin_normalized=?`).get(sameVin.vin).n, 6);
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM auction_listings WHERE lot='LOT-100'`).get().n, 4);
  assert.equal(sqlite.prepare(`SELECT count(DISTINCT listing_id) AS n FROM auction_listings WHERE lot='LOT-100'`).get().n, 4);
  assert.equal(sqlite.prepare(`SELECT identity_state FROM auction_listings WHERE vin_normalized IS NULL AND lot='LOT-NOVIN'`).get().identity_state, 'resolved');
  assert.equal(sqlite.prepare(`SELECT identity_state FROM auction_listings WHERE lot IS NULL`).get().identity_state, 'ambiguous');

  // A feed scope is provider/platform-specific; the same VIN at IAAI is persisted
  // in its own scope and cannot be accidentally accepted into Copart's page.
  const iaai = vehicle({platform: 'iaai', lot: 'LOT-100', auction: contract.createRexAuction({source_listing_id: 'iaai-listing-100'})});
  const iaaiLease = await startScope(repo, {scopeKey: 'identity-iaai', runId: 'run-identity-iaai', provider: 'apibara', platform: 'iaai', owner: 'worker-iaai', token: 'token-iaai'});
  await repo.persistDiscoveryPage({scopeKey: iaaiLease.scopeKey, provider: iaaiLease.provider, platform: iaaiLease.platform, runId: iaaiLease.runId,
    owner: iaaiLease.owner, token: iaaiLease.token, leaseGeneration: iaaiLease.leaseGeneration, cursor: null, nextCursor: null,
    records: [record(iaai)], now: NOW});
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM auction_listings WHERE vin_normalized=?`).get(sameVin.vin).n, 7);
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM auction_listings WHERE vin_normalized=? AND platform='iaai'`).get(sameVin.vin).n, 1);
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM auction_listings WHERE lot='LOT-100'`).get().n, 5);
  sqlite.close();
});

test('persisted partial merge zachowuje seller/document/prices/mileage/auction, 0/false i jawny clear', async () => {
  const {sqlite, repo} = setupDisposableDatabase();
  const lease = await startScope(repo, {scopeKey: 'merge-one', runId: 'run-merge-one'});
  const original = vehicle();
  const originalRecord = record(original);
  await repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: null, nextCursor: null,
    records: [originalRecord], now: NOW});

  const nextLease = await startScope(repo, {scopeKey: 'merge-two', runId: 'run-merge-two', now: NOW + 1000, owner: 'worker-b', token: 'token-b'});
  const partial = vehicle({
    seller: contract.createRexSeller({name: null, type: null}),
    document: contract.createRexDocument({name: null, type: null, registration: null, export: null}),
    pricing: contract.createRexPricing({current_bid: null, current_bid_secondary: null, buy_now: null}),
    auction: contract.createRexAuction({state: null, source_status: null, auction_at: null, timed: null, timed_end_at: null, source_listing_id: 'listing-100'}),
    condition: contract.createRexCondition({primary_damage: null, run_state: null, keys_present: false}),
    odometer: {value: 0, unit: 'mi'}, media: contract.createRexMedia({items: [], thumbs: [], has_video: false})
  });
  await repo.persistDiscoveryPage({scopeKey: nextLease.scopeKey, provider: nextLease.provider, platform: nextLease.platform, runId: nextLease.runId,
    owner: nextLease.owner, token: nextLease.token, leaseGeneration: nextLease.leaseGeneration, cursor: null, nextCursor: null,
    records: [record(partial)], now: NOW + 1000});
  const listingId = originalRecord.identity.listingId;
  let row = await repo.getListing(listingId);
  assert.equal(row.seller_name, 'Seller Company');
  assert.equal(row.document_name, 'Salvage');
  assert.equal(row.current_bid_usd, 1500);
  assert.equal(row.auction_at, '2026-10-10T10:00:00Z');
  assert.equal(row.auction_state, 'upcoming');
  assert.equal(row.odometer_value, 0);
  assert.equal(row.odometer_unit, 'mi');
  assert.equal(row.keys_present, 0);
  assert.equal(row.has_video, 0);
  assert.equal(row.buy_now_usd, 4500);

  const clearLease = await startScope(repo, {scopeKey: 'merge-three', runId: 'run-merge-three', now: NOW + 2000, owner: 'worker-c', token: 'token-c'});
  const clear = vehicle({seller: contract.createRexSeller({name: null})});
  await repo.persistDiscoveryPage({scopeKey: clearLease.scopeKey, provider: clearLease.provider, platform: clearLease.platform, runId: clearLease.runId,
    owner: clearLease.owner, token: clearLease.token, leaseGeneration: clearLease.leaseGeneration, cursor: null, nextCursor: null,
    records: [{...record(clear), explicitClears: ['seller.name']}], now: NOW + 2000});
  row = await repo.getListing(listingId);
  assert.equal(row.seller_name, null);
  assert.equal(row.seller_type, 'insurance');
  sqlite.close();
});

test('D1 persisted budget serializuje planery; retry reserve jest oddzielny, started work może checkpointować', async () => {
  const {sqlite, repo} = setupDisposableDatabase();
  await repo.initializeBudget({provider: 'apibara', budgetDay: '2026-09-29', normalLimit: 1, retryLimit: 1, now: NOW});
  const [first, second] = await Promise.all([
    repo.reserveBudget({reservationId: 'normal-a', provider: 'apibara', budgetDay: '2026-09-29', bucket: 'normal', count: 1, now: NOW}),
    repo.reserveBudget({reservationId: 'normal-b', provider: 'apibara', budgetDay: '2026-09-29', bucket: 'normal', count: 1, now: NOW})
  ]);
  assert.equal([first, second].filter(value => value.allowed).length, 1);
  assert.equal([first, second].filter(value => !value.allowed && value.reason === 'BUDGET_EXHAUSTED').length, 1);
  assert.equal((await repo.reserveBudget({reservationId: 'retry-a', provider: 'apibara', budgetDay: '2026-09-29', bucket: 'retry', count: 1, now: NOW})).allowed, true);

  const acceptedId = first.allowed ? 'normal-a' : 'normal-b';
  assert.equal(await repo.startBudgetReservation({reservationId: acceptedId, now: NOW + 1}), true);
  assert.deepEqual(await repo.reserveBudget({reservationId: acceptedId, provider: 'apibara', budgetDay: '2026-09-29', bucket: 'normal', count: 1, now: NOW + 1}),
    {allowed: false, replayed: true, reason: 'BUDGET_RESERVATION_ALREADY_USED', state: 'started'});
  assert.equal((await repo.reserveBudget({reservationId: 'normal-c', provider: 'apibara', budgetDay: '2026-09-29', bucket: 'normal', count: 1, now: NOW + 2})).allowed, false);
  assert.equal(await repo.finishBudgetReservation({reservationId: acceptedId, now: NOW + 3}), true);
  assert.deepEqual(await repo.reserveBudget({reservationId: acceptedId, provider: 'apibara', budgetDay: '2026-09-29', bucket: 'normal', count: 1, now: NOW + 4}),
    {allowed: false, replayed: true, reason: 'BUDGET_RESERVATION_ALREADY_USED', state: 'finished'});
  assert.equal(sqlite.prepare(`SELECT normal_consumed,retry_reserved FROM provider_request_budgets WHERE provider='apibara'`).get().normal_consumed, 1);
  assert.equal(sqlite.prepare(`SELECT retry_reserved FROM provider_request_budgets WHERE provider='apibara'`).get().retry_reserved, 1);

  const lease = await startScope(repo, {scopeKey: 'budget-checkpoint', runId: 'budget-run'});
  const v = vehicle();
  const checkpoint = await repo.persistDiscoveryPage({scopeKey: lease.scopeKey, provider: lease.provider, platform: lease.platform, runId: lease.runId,
    owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration, cursor: null, nextCursor: null, records: [record(v)], now: NOW + 4});
  assert.equal(checkpoint.complete, true, 'wyczerpanie planowania nie anuluje już rozpoczętej, bezpiecznej pracy');
  sqlite.close();
});

test('minimalne query paths używają istniejących indeksów, bez nowych indeksów katalogowych', () => {
  const {sqlite} = setupDisposableDatabase();
  const explain = (sql, ...params) => sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => row.detail).join(' | ');
  const checks = [
    ["SELECT scope_key FROM provider_sync_scopes WHERE status='partial' AND next_due_at<=? ORDER BY next_due_at LIMIT ?", ['2026-09-30', 10], 'idx_sync_scopes_due'],
    ['SELECT listing_id FROM auction_listings WHERE next_refresh_at<=? AND freshness_class=? ORDER BY next_refresh_at LIMIT ?', ['2026-09-30', 'hot', 10], 'idx_listings_refresh_due'],
    ['SELECT source_key FROM vehicle_sources WHERE provider=? AND platform=? AND provider_vehicle_id=?', ['apibara', 'copart', 'source-1'], 'idx_vsync_provider_vehicle'],
    ['SELECT listing_id FROM auction_listings WHERE platform=? AND lot=? ORDER BY last_seen_at DESC LIMIT ?', ['copart', 'LOT-1', 10], 'idx_listings_lot_recent'],
    ['SELECT scope_key FROM provider_sync_scopes WHERE scope_key=?', ['scope'], 'sqlite_autoindex_provider_sync_scopes_1'],
    ['SELECT run_id FROM sync_runs WHERE scope_key=? AND status=? ORDER BY started_at DESC LIMIT ?', ['scope', 'running', 10], 'idx_sync_runs_scope_status'],
    ['SELECT run_id FROM sync_runs WHERE run_id=?', ['run'], 'sqlite_autoindex_sync_runs_1'],
    ['SELECT run_id FROM sync_page_commits WHERE scope_key=? AND run_id=? AND cursor_hash=?', ['scope', 'run', 'hash'], 'sqlite_autoindex_sync_page_commits_1'],
    ['SELECT * FROM provider_request_budgets WHERE provider=? AND budget_day=?', ['apibara', '2026-09-29'], 'sqlite_autoindex_provider_request_budgets_1']
  ];
  for (const [sql, params, expectedIndex] of checks) {
    const plan = explain(sql, ...params);
    assert.match(plan, new RegExp(expectedIndex), `${sql}: ${plan}`);
    assert.doesNotMatch(plan, /SCAN (?!.*USING INDEX)/, `${sql}: unexpected scan ${plan}`);
  }
  sqlite.close();
});
