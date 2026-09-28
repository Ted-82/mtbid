const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../providers/contract.js');
const { createApibaraProvider } = require('../providers/apibara.js');
const {
  createSyncIdentity,
  createHistoryEventIdentity,
  mergeCanonical,
  InMemorySyncRepository
} = require('../sync/core.js');
const {
  calculateDailyRequestPlan,
  RequestBudgetGuard,
  planFreshness
} = require('../sync/planning.js');

const providerBFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/provider-b-vehicle.json'), 'utf8'));
const NOW = Date.parse('2026-09-28T12:00:00.000Z');

function canonicalVehicle(overrides = {}) {
  return contract.createRexVehicle({
    provider: 'apibara', provider_vehicle_id: 'provider-vehicle-1', platform: 'copart',
    vin: '1HGCM82633A123456', lot: 'LOT-1', make: 'Honda', model: 'Accord', year: 2021,
    auction: contract.createRexAuction({state: 'upcoming', auction_at: '2026-10-01T12:00:00.000Z', source_listing_id: 'listing-1'}),
    pricing: contract.createRexPricing({current_bid: 1000, buy_now: 2500}),
    seller: contract.createRexSeller({name: 'Seller A', type: 'insurance'}),
    condition: contract.createRexCondition({primary_damage: 'Front End', run_state: 'run_drive', keys_present: true, airbags: 'intact'}),
    document: contract.createRexDocument({name: 'Salvage', registration: null, export: true}),
    media: contract.createRexMedia({items: ['https://img.example/car.jpg'], thumbs: ['https://img.example/thumb.jpg'], has_video: true}),
    location: {display: 'Austin, TX'}, odometer: {value: 42000, unit: 'mi'},
    raw_payload: {secretish: 'fixture raw'} , ...overrides
  });
}

function identity(vehicle, overrides = {}) {
  return createSyncIdentity(vehicle, {observationKey: 'feed:page:first:row:0', ...overrides});
}

function sourceRecord(vehicle, identityOptions = {}) {
  return {vehicle, identity: identity(vehicle, identityOptions)};
}

function providerBVehicle(raw) {
  return contract.createRexVehicle({
    provider: 'provider-b', provider_vehicle_id: raw.vehicleRef, platform: raw.market.toLowerCase(),
    vin: raw.identity.chassis, lot: raw.identity.stock, year: raw.description.modelYear,
    make: raw.description.manufacturer, model: raw.description.nameplate, trim: raw.description.trimName,
    auction: contract.createRexAuction({state: raw.sale.phase, source_status: raw.sale.phase,
      auction_at: raw.sale.startsAt, timed: raw.sale.timed, timed_end_at: raw.sale.timedClose,
      source_listing_id: raw.vehicleRef}),
    pricing: contract.createRexPricing({current_bid: raw.money.leadingOffer,
      buy_now: raw.money.instantPurchase, final_price: raw.money.settledAmount}),
    seller: contract.createRexSeller({name: raw.sellerRecord.legalName, type: raw.sellerRecord.category}),
    condition: contract.createRexCondition({primary_damage: raw.vehicleState.mainDamage,
      secondary_damage: raw.vehicleState.additionalDamage, run_state: raw.vehicleState.operation,
      keys_present: raw.vehicleState.keysIncluded}),
    document: contract.createRexDocument({name: raw.paperwork.display,
      registration: raw.paperwork.registrationPossible, export: raw.paperwork.exportPossible}),
    media: contract.createRexMedia({items: raw.images.primary, thumbs: raw.images.small,
      has_video: raw.images.videoAvailable, has_360: raw.images.rotationAvailable}),
    location: raw.place.displayName, odometer: raw.distance.miles, raw_payload: raw
  });
}

function apibaraCanonical() {
  const adapter = createApibaraProvider({fetch: async () => { throw new Error('offline fixture: fetch forbidden'); }});
  const raw = {
    vin: '1HGCM82633A123456', lot_number: 'LOT-1', platform: 'copart', vehicle_id: 'provider-vehicle-1',
    year: 2021, make: 'Honda', model: 'Accord',
    auction: {state: 'upcoming', auction_at: '2026-10-01T12:00:00.000Z', source_listing_id: 'listing-1'},
    pricing: {current_bid_usd: 1000, buy_now_usd: 2500}, seller: {name: 'Seller A', type: 'INS'},
    condition: {primary_damage: 'Front End', run_condition: 'Run & Drive', has_key: true},
    media: {items: ['https://img.example/car.jpg'], thumbs: ['https://img.example/thumb.jpg']}
  };
  return adapter.toCanonicalVehicle(raw, adapter.normalizeVehicle(raw));
}

test('identity rozdziela tożsamość pojazdu, source, listing i event; VIN nie jest kluczem listingu', () => {
  const sameVin = canonicalVehicle();
  const lotOne = identity(sameVin, {listingGeneration: 1});
  const lotTwoVehicle = contract.createRexVehicle({...sameVin, lot: 'LOT-2', auction: contract.createRexAuction({source_listing_id: 'listing-2'})});
  const lotTwo = identity(lotTwoVehicle, {listingGeneration: 1});
  assert.equal(lotOne.vinCandidate, lotTwo.vinCandidate);
  assert.notEqual(lotOne.listingId, lotTwo.listingId);
  assert.equal(lotOne.entityId, null, 'source ID nie dowodzi fizycznej tożsamości auta');
  assert.equal(lotOne.vehicleIdentityState, 'unresolved');
  assert.equal(lotOne.vehicleCandidateKey, lotTwo.vehicleCandidateKey);
  assert.equal(createSyncIdentity(sameVin, {confirmedEntityId: 'rex-entity-1'}).entityId, 'rex-entity-1');

  const reusedLotA = identity(sameVin, {listingGeneration: 1});
  const reusedLotB = identity(sameVin, {listingGeneration: 2});
  assert.notEqual(reusedLotA.listingId, reusedLotB.listingId, 'LOT reused in a new generation starts another listing');

  const copart = identity(sameVin);
  const iaai = identity(contract.createRexVehicle({...sameVin, provider: 'apibara', platform: 'iaai', provider_vehicle_id: 'iaai-v-1'}));
  assert.equal(copart.vinCandidate, iaai.vinCandidate);
  assert.notEqual(copart.sourceKey, iaai.sourceKey);
  assert.notEqual(copart.listingId, iaai.listingId);
  assert.equal(copart.entityId, null, 'cross-provider VIN match remains a candidate, not an automatic entity merge');

  const relisted = identity(sameVin, {listingGeneration: 2});
  assert.notEqual(lotOne.listingId, relisted.listingId);
});

test('brak VIN, brak listing ID i niejednoznaczny VIN-only nie powodują automatycznego scalenia', () => {
  const noVin = canonicalVehicle({vin: null, provider_vehicle_id: 'vehicle-no-vin', auction: contract.createRexAuction({source_listing_id: 'listing-no-vin'})});
  const noVinIdentity = createSyncIdentity(noVin);
  assert.equal(noVinIdentity.vinCandidate, null);
  assert.equal(noVinIdentity.vehicleIdentityState, 'unresolved');
  assert.equal(noVinIdentity.listingIdentityState, 'resolved');

  const noListingId = canonicalVehicle({auction: contract.createRexAuction({auction_at: '2026-10-01T12:00:00Z'})});
  const firstObservation = createSyncIdentity(noListingId, {observationKey: 'scope:p1:0'});
  const laterObservation = createSyncIdentity(noListingId, {observationKey: 'scope:p2:0'});
  assert.equal(firstObservation.listingIdentityState, 'ambiguous');
  assert.notEqual(firstObservation.listingId, laterObservation.listingId);

  const vinOnly = canonicalVehicle({provider_vehicle_id: null, lot: null, auction: contract.createRexAuction({source_listing_id: null})});
  const vinOnlyIdentity = createSyncIdentity(vinOnly, {observationKey: 'scope:first:0'});
  assert.equal(vinOnlyIdentity.sourceIdentityState, 'ambiguous');
  assert.equal(vinOnlyIdentity.entityId, null);
  assert.equal(vinOnlyIdentity.vinCandidate, '1HGCM82633A123456');
  assert.notEqual(vinOnlyIdentity.listingId, `listing|apibara|copart|vin|${vinOnly.vin}`);
});

test('history event identity jest provider/platform/listing-scoped; jawny event aktualizuje ten sam rekord', () => {
  const vehicle = canonicalVehicle();
  const listing = identity(vehicle);
  const event = contract.createRexHistoryEvent({provider: 'apibara', platform: 'copart', lot: vehicle.lot,
    provider_event_id: 'event-9', auction_date: '2026-09-20', status: 'Sold on Approval',
    pricing: contract.createRexPricing({source_price: 9000, final_price: null})});
  const eventIdentity = createHistoryEventIdentity(event, listing);
  assert.throws(() => createHistoryEventIdentity({...event, platform: 'iaai'}, listing), /różne scope/);
  const repo = new InMemorySyncRepository();
  assert.equal(repo.upsertHistoryEvent(eventIdentity, event, NOW).inserted, true);
  const changed = contract.createRexHistoryEvent({...event, status: 'Sold', pricing: contract.createRexPricing({source_price: 9000, final_price: 9000})});
  assert.equal(repo.upsertHistoryEvent(createHistoryEventIdentity(changed, listing), changed, NOW + 1000).updated, true);
  assert.equal(repo.events.size, 1);
  assert.equal(repo.events.get(eventIdentity.eventId).event.pricing.final_price, 9000);
});

test('Apibara i strukturalnie inny Provider B przechodzą przez ten sam provider-neutral repository', () => {
  const repo = new InMemorySyncRepository();
  const fromApibara = apibaraCanonical();
  const fromProviderB = providerBVehicle(providerBFixture);
  const records = [
    {vehicle: fromApibara, identity: createSyncIdentity(fromApibara, {observationKey: 'feed:1:0'})},
    {vehicle: fromProviderB, identity: createSyncIdentity(fromProviderB, {observationKey: 'feed:1:1'})}
  ];
  const result = repo.completeDiscoveryPage({scopeKey: 'apibara:copart:feed', records: [records[0]], now: NOW, nextCursor: null});
  const resultB = repo.completeDiscoveryPage({scopeKey: 'provider-b:iaai:feed', records: [records[1]], now: NOW, nextCursor: null});
  assert.equal(result.inserted, 1);
  assert.equal(resultB.inserted, 1);
  assert.equal(repo.listings.size, 2);
  assert.equal([...repo.listings.values()].some(row => row.vehicle.provider === 'apibara'), true);
  assert.equal([...repo.listings.values()].some(row => row.vehicle.provider === 'provider-b'), true);
  assert.equal([...repo.listings.values()].every(row => row.vehicle.raw_payload === undefined), true);
  assert.deepEqual([...repo.listings.values()].map(row => row.vehicle.media.items), [[], []]);
});

test('partial merge distinguishes missing, null and explicit values; source-confirmed clear is opt-in', () => {
  const previous = canonicalVehicle();
  const patch = contract.createRexVehicle({provider: 'apibara', provider_vehicle_id: 'provider-vehicle-1', platform: 'copart'});
  delete patch.seller.name;
  patch.document.name = null;
  patch.pricing.current_bid = null;
  patch.auction.auction_at = null;
  patch.condition.primary_damage = null;
  patch.odometer = null;
  patch.media.items = null;
  const merged = mergeCanonical(previous, patch);
  assert.equal(merged.value.seller.name, 'Seller A');
  assert.equal(merged.value.document.name, 'Salvage');
  assert.equal(merged.value.pricing.current_bid, 1000);
  assert.equal(merged.value.auction.auction_at, '2026-10-01T12:00:00.000Z');
  assert.equal(merged.value.condition.primary_damage, 'Front End');
  assert.deepEqual(merged.value.odometer, {value: 42000, unit: 'mi'});
  assert.deepEqual(merged.value.media.items, ['https://img.example/car.jpg']);
  assert.ok(merged.missingFields.includes('seller.name'));
  assert.ok(merged.nullFields.includes('document.name'));
  assert.notDeepEqual(merged.missingFields, merged.nullFields);

  const explicit = contract.createRexVehicle({
    provider: 'apibara', provider_vehicle_id: 'provider-vehicle-1', platform: 'copart',
    seller: contract.createRexSeller({name: 'Seller B'}),
    document: contract.createRexDocument({name: 'Clean'}),
    pricing: contract.createRexPricing({current_bid: 0}),
    auction: contract.createRexAuction({auction_at: '2026-10-02T12:00:00Z'}),
    condition: contract.createRexCondition({primary_damage: 'Rear End'}),
    odometer: {value: 0, unit: 'mi'},
    media: contract.createRexMedia({items: ['https://img.example/new.jpg']})
  });
  const changed = mergeCanonical(merged.value, explicit).value;
  assert.equal(changed.seller.name, 'Seller B');
  assert.equal(changed.document.name, 'Clean');
  assert.equal(changed.pricing.current_bid, 0);
  assert.equal(changed.auction.auction_at, '2026-10-02T12:00:00Z');
  assert.equal(changed.condition.primary_damage, 'Rear End');
  assert.equal(changed.odometer.value, 0);
  assert.deepEqual(changed.media.items, ['https://img.example/new.jpg']);

  const clearPatch = structuredClone(explicit);
  clearPatch.seller.name = null;
  clearPatch.document.name = null;
  const cleared = mergeCanonical(changed, clearPatch, {explicitClears: ['seller.name', 'document.name']});
  assert.equal(cleared.value.seller.name, null);
  assert.equal(cleared.value.document.name, null);
  assert.deepEqual(cleared.clearedFields, ['seller.name', 'document.name']);
});

test('discovery page jest idempotent, a relisting tworzy nowy listing, a repository nie zachowuje raw/media', () => {
  const repo = new InMemorySyncRepository();
  const vehicle = canonicalVehicle();
  vehicle.catalog_metadata = {items: ['retained non-media data']};
  const firstIdentity = identity(vehicle, {listingGeneration: 1});
  const firstPage = {scopeKey: 'scope', cursor: null, nextCursor: 'cursor-2', records: [{vehicle, identity: firstIdentity}], now: NOW};
  assert.equal(repo.completeDiscoveryPage(firstPage).inserted, 1);
  assert.equal(repo.completeDiscoveryPage(firstPage).replayed, true);
  assert.equal(repo.listings.size, 1);
  assert.equal(repo.listings.get(firstIdentity.listingId).vehicle.raw_payload, undefined);
  assert.deepEqual(repo.listings.get(firstIdentity.listingId).vehicle.media.items, []);
  assert.deepEqual(repo.listings.get(firstIdentity.listingId).vehicle.catalog_metadata.items, ['retained non-media data']);

  const relistIdentity = identity(vehicle, {listingGeneration: 2});
  repo.completeDiscoveryPage({scopeKey: 'scope-relist', records: [{vehicle, identity: relistIdentity}], now: NOW, nextCursor: null});
  assert.notEqual(firstIdentity.listingId, relistIdentity.listingId);
  assert.equal(repo.listings.size, 2);
});

test('cursor replay odzyskuje crash przed checkpoint i po zapisie strony; complete timestamp czeka na koniec', () => {
  const repo = new InMemorySyncRepository();
  const vehicle = canonicalVehicle();
  const listingIdentity = identity(vehicle);
  const page1 = {scopeKey: 'feed', cursor: null, nextCursor: 'opaque/A', records: [{vehicle, identity: listingIdentity}], now: NOW};
  repo.completeDiscoveryPage(page1);
  assert.equal(repo.getScope('feed').lastCompleteAt, null);
  const crashBeforeCheckpoint = {...page1, scopeKey: 'crash-before-checkpoint', crashAt: 'before_checkpoint'};
  assert.throws(() => repo.completeDiscoveryPage(crashBeforeCheckpoint), /SIMULATED_CRASH/);
  assert.equal(repo.getScope('crash-before-checkpoint'), null, 'niezapisany checkpoint nie tworzy stanu świeżości');
  assert.equal(repo.completeDiscoveryPage({...page1, scopeKey: 'crash-before-checkpoint'}).updated, 1,
    'powtórzenie strony po zapisie rekordów wykonuje idempotentny upsert');
  assert.equal(repo.getScope('crash-before-checkpoint').lastCompleteAt, null,
    'strona z next cursor pozostaje partial, nawet po replay');
  assert.equal(repo.getScope('feed').cursor, 'opaque/A');
  assert.equal(repo.listings.size, 1);

  const page2 = {scopeKey: 'feed', cursor: 'opaque/A', nextCursor: 'opaque/B', records: [{vehicle, identity: listingIdentity}], now: NOW + 1000};
  assert.throws(() => repo.completeDiscoveryPage({...page2, crashAt: 'before_checkpoint'}), /SIMULATED_CRASH/);
  assert.equal(repo.getScope('feed').cursor, 'opaque/A');
  assert.equal(repo.listings.size, 1, 'row upsert before checkpoint does not duplicate');
  assert.equal(repo.completeDiscoveryPage(page2).updated, 1);
  assert.equal(repo.getScope('feed').cursor, 'opaque/B');
  assert.equal(repo.getScope('feed').lastCompleteAt, null);

  const lastPage = {...page2, cursor: 'opaque/B', nextCursor: null, now: NOW + 2000};
  assert.equal(repo.completeDiscoveryPage(lastPage).complete, true);
  assert.equal(repo.getScope('feed').lastCompleteAt, NOW + 2000);
  assert.equal(repo.getScope('feed').lastSuccessAt, NOW + 2000);
});

test('repeated cursor jest blokowany bez checkpointu; replay ukończonej strony niczego nie zmienia', () => {
  const repo = new InMemorySyncRepository();
  const vehicle = canonicalVehicle();
  const listingIdentity = identity(vehicle);
  const first = {scopeKey: 'repeat', cursor: null, nextCursor: 'same', records: [{vehicle, identity: listingIdentity}], now: NOW};
  repo.completeDiscoveryPage(first);
  const repeated = {scopeKey: 'repeat', cursor: 'same', nextCursor: 'same', records: [{vehicle, identity: listingIdentity}], now: NOW + 1};
  assert.throws(() => repo.completeDiscoveryPage(repeated), /REPEATED_CURSOR/);
  assert.throws(() => repo.completeDiscoveryPage({...repeated, nextCursor: ''}), /REPEATED_CURSOR/);
  assert.equal(repo.getScope('repeat').cursor, 'same');
  assert.equal(repo.completeDiscoveryPage(first).replayed, true);
  assert.equal(repo.listings.size, 1);
});

test('lease blokuje drugiego wykonawcę, wygasa, zwalnia się po complete, a failure nie odświeża freshness', () => {
  const repo = new InMemorySyncRepository();
  assert.equal(repo.acquireLease('lease', 'worker-a', NOW, 1000), true);
  assert.equal(repo.acquireLease('lease', 'worker-b', NOW + 10, 1000), false);
  assert.equal(repo.acquireLease('lease', 'worker-b', NOW + 1001, 1000), true, 'expired lease is recoverable');
  const vehicle = canonicalVehicle();
  const listingIdentity = identity(vehicle);
  repo.completeDiscoveryPage({scopeKey: 'lease', leaseOwner: 'worker-b', records: [{vehicle, identity: listingIdentity}], now: NOW + 1002, nextCursor: null});
  assert.equal(repo.getScope('lease').leaseOwner, null);
  const lastSuccess = repo.getScope('lease').lastSuccessAt;
  repo.acquireLease('lease', 'worker-c', NOW + 2000, 1000);
  repo.failRun('lease', 'worker-c', 'UPSTREAM_503', NOW + 2050);
  assert.equal(repo.getScope('lease').status, 'failed');
  assert.equal(repo.getScope('lease').lastSuccessAt, lastSuccess);
  assert.equal(repo.getScope('lease').lastCompleteAt, lastSuccess);
  assert.equal(repo.getScope('lease').leaseOwner, null);
});

test('request plan odtwarza 1k/10k/50k; guard blokuje nowe zadania, nie anuluje rozpoczęte', () => {
  assert.deepEqual([1000, 10000, 50000].map(n => calculateDailyRequestPlan(n).totalRequestsPerDay), [98, 956, 4778]);
  assert.throws(() => calculateDailyRequestPlan(1000, {hotShare: 1.2}), /zakresu 0\.\.1/);
  const configured = calculateDailyRequestPlan(1000, {pageSize: 10, metadataRequestsPerDay: 2, retryReserveRate: 0});
  assert.equal(configured.categories.discovery, 100);
  assert.equal(configured.categories.metadata, 2);

  const guard = new RequestBudgetGuard({limit: 2});
  const first = guard.reserve('discovery');
  assert.equal(first.allowed, true);
  assert.equal(guard.start(first.reservation.id), true);
  assert.equal(guard.complete(first.reservation.id), true);
  const second = guard.reserve('detail');
  assert.equal(second.allowed, true);
  assert.equal(guard.canSchedule, false);
  assert.deepEqual(guard.reserve('history'), {allowed: false, reason: 'BUDGET_EXHAUSTED', remaining: 0});
  assert.equal(guard.consumed, 1, 'in-flight request remains counted and is not cancelled');
  assert.equal(guard.reserved, 1);
  assert.equal(guard.cancel(second.reservation.id), true);
  assert.equal(guard.remaining, 1);
  const third = guard.reserve('retry');
  guard.start(third.reservation.id);
  assert.equal(guard.complete(third.reservation.id), true);
  assert.equal(guard.reservations.size, 0, 'zakończone rezerwacje nie rosną bez końca');
  assert.equal(guard.consumed, 2);
});

test('freshness planner używa jawnego now/policy dla HOT/WARM/COLD i watched listing', () => {
  const policy = {hotIntervalMs: 5 * 60_000, warmIntervalMs: 6 * 60 * 60_000, coldIntervalMs: 7 * 86400_000, hotWindowMs: 60 * 60_000};
  const hot = planFreshness({auction: {state: 'upcoming', auction_at: new Date(NOW + 30 * 60_000).toISOString()}}, NOW, policy);
  const warm = planFreshness({auction: {state: 'upcoming', auction_at: new Date(NOW + 3 * 86400_000).toISOString()}, lastSyncedAt: NOW}, NOW, policy);
  const cold = planFreshness({auction: {state: 'finished'}, lastSyncedAt: NOW}, NOW, policy);
  const watched = planFreshness({auction: {state: 'upcoming'}, watched: true}, NOW, policy);
  assert.equal(hot.freshnessClass, 'HOT');
  assert.equal(warm.freshnessClass, 'WARM');
  assert.equal(cold.freshnessClass, 'COLD');
  assert.equal(watched.freshnessClass, 'HOT');
  assert.equal(warm.due, false);
  assert.equal(planFreshness({auction: {state: 'upcoming'}, lastSyncedAt: NOW - policy.warmIntervalMs}, NOW, policy).due, true);
  assert.throws(() => planFreshness({auction: {}}, NOW), /policy/);
});
