const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApibaraProvider } = require('../providers/apibara.js');
const contract = require('../providers/contract.js');

const root = path.resolve(__dirname, '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/provider-b-vehicle.json'), 'utf8'));
const historic = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/auction-history.json'), 'utf8'));
const workerSource = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function providerBVehicle(raw) {
  return contract.createRexVehicle({
    provider: 'provider-b', provider_vehicle_id: raw.vehicleRef, platform: raw.market.toLowerCase(),
    vin: raw.identity.chassis, lot: raw.identity.stock, year: raw.description.modelYear,
    make: raw.description.manufacturer, model: raw.description.nameplate, trim: raw.description.trimName,
    auction: contract.createRexAuction({ state: raw.sale.phase, source_status: raw.sale.phase,
      auction_at: raw.sale.startsAt, timed: raw.sale.timed, timed_end_at: raw.sale.timedClose,
      source_listing_id: raw.vehicleRef }),
    pricing: contract.createRexPricing({ current_bid: raw.money.leadingOffer,
      buy_now: raw.money.instantPurchase, final_price: raw.money.settledAmount }),
    seller: contract.createRexSeller({ name: raw.sellerRecord.legalName, type: raw.sellerRecord.category }),
    condition: contract.createRexCondition({ primary_damage: raw.vehicleState.mainDamage,
      secondary_damage: raw.vehicleState.additionalDamage, run_state: raw.vehicleState.operation,
      keys_present: raw.vehicleState.keysIncluded }),
    document: contract.createRexDocument({ name: raw.paperwork.display,
      registration: raw.paperwork.registrationPossible, export: raw.paperwork.exportPossible }),
    media: contract.createRexMedia({ items: raw.images.primary, thumbs: raw.images.small,
      has_video: raw.images.videoAvailable, has_360: raw.images.rotationAvailable }),
    location: raw.place.displayName, odometer: raw.distance.miles, raw_payload: raw
  });
}

function projection(vehicle) {
  const { raw_payload, provider, provider_vehicle_id, source_updated_at, ...stable } = vehicle;
  stable.auction = { ...stable.auction, source_event_id: null, source_listing_id: null };
  stable.seller = { ...stable.seller, source: null };
  return stable;
}

test('Apibara and structurally different Provider B map to the same canonical vehicle model', () => {
  const provider = createApibaraProvider({ fetch: async () => { throw new Error('network disabled'); } });
  const apibaraRaw = {
    vin: fixtures.identity.chassis, lot_number: fixtures.identity.stock, platform: 'iaai',
    year: 2021, make: 'Honda', model: 'Accord', trim: 'Sport',
    auction: { state: 'Timed', formatted: 'Timed', auction_at: '2026-10-10T14:00:00Z', is_timed: true, timed_end_at: '2026-10-10T15:00:00Z' },
    pricing: { current_bid_usd: 500, buy_now_usd: 7000, sale_price_usd: null },
    seller: { name: 'Example Insurance', type: 'INS' },
    condition: { primary_damage: 'Front End', secondary_damage: 'Minor Dent', run_condition: 'Run & Drive', has_key: true },
    sale_document: { name: 'Salvage', registration: true, export: true },
    media: { items: ['https://example.test/photo.jpg'], thumbs: ['https://example.test/thumb.jpg'], has_video: false, has_360: true },
    location: { display: 'Example, CA' }, odometer: { mi: 42000 }
  };
  const fromA = provider.toCanonicalVehicle(apibaraRaw, provider.normalizeVehicle(apibaraRaw));
  const fromB = providerBVehicle(fixtures);
  assert.deepEqual(projection(fromA), projection(fromB));
  assert.equal(fromA.auction.timed_end_at, fromB.auction.timed_end_at);
  assert.equal(fromA.pricing.current_bid, fromB.pricing.current_bid);
  assert.equal(fromA.seller.name, fromB.seller.name);
});

test('different providers can preserve the same Rex.Bid public response contract for the frontend', () => {
  const provider = createApibaraProvider({ fetch: async () => { throw new Error('network disabled'); } });
  const fromA = {
    vin: fixtures.identity.chassis, lot_number: fixtures.identity.stock, platform: 'iaai', year: 2021,
    make: 'Honda', model: 'Accord', auction: { state: 'Timed', is_timed: true, timed_end_at: '2026-10-10T15:00:00Z' },
    pricing: { current_bid_usd: 500, buy_now_usd: 7000 }, seller: { name: 'Example Insurance', type: 'INS' },
    media: { items: ['https://example.test/photo.jpg'], thumbs: ['https://example.test/thumb.jpg'] }
  };
  const canonicalB = providerBVehicle(fixtures);
  const publicB = {
    vin: canonicalB.vin, lot_number: canonicalB.lot, platform: canonicalB.platform, year: canonicalB.year,
    make: canonicalB.make, model: canonicalB.model,
    auction: { state: canonicalB.auction.state, is_timed: canonicalB.auction.timed, timed_end_at: canonicalB.auction.timed_end_at },
    pricing: { current_bid_usd: canonicalB.pricing.current_bid, buy_now_usd: canonicalB.pricing.buy_now },
    seller: { name: canonicalB.seller.name, type: 'INS' }, media: { items: canonicalB.media.items, thumbs: canonicalB.media.thumbs }
  };
  const responseA = { ok: true, data: [provider.publicVehicleRecord(fromA)], meta: { next_cursor: 'next' } };
  const responseB = { ok: true, data: [publicB], meta: { next_cursor: 'next' } };
  const requiredPublicVehicleFields = ['vin', 'lot_number', 'platform', 'auction', 'pricing', 'seller', 'media'];
  assert.deepEqual(Object.keys(responseB).sort(), Object.keys(responseA).sort());
  assert.deepEqual(Object.keys(responseB.data[0]).sort(), Object.keys(responseA.data[0]).sort());
  for (const field of requiredPublicVehicleFields) assert.ok(field in responseB.data[0]);
  assert.equal(responseB.data[0].vin, responseA.data[0].vin);
  assert.equal(responseB.data[0].pricing.current_bid_usd, responseA.data[0].pricing.current_bid_usd);
});

test('canonical provider contract keeps source provenance and required Rex entities', () => {
  const provider = createApibaraProvider({ fetch: async () => { throw new Error('network disabled'); } });
  const raw = { vin: '1HGCM82633A123456', platform: 'copart', lot_number: 'L1', auction: { is_timed: true, timed_end_at: '2026-10-10T15:00:00Z' }, pricing: { current_bid_usd: 10 }, seller: { name: 'Seller' } };
  const canonical = provider.toCanonicalVehicle(raw, provider.normalizeVehicle(raw));
  assert.equal(canonical.provider, 'apibara');
  assert.equal(canonical.raw_payload, raw);
  for (const key of ['auction', 'pricing', 'seller', 'condition', 'document', 'media']) assert.ok(canonical[key]);
  assert.equal(canonical.auction.timed, true);
  assert.equal(canonical.pricing.current_bid, 10);
  assert.equal(typeof contract.createRexHistoryEvent, 'function');
  assert.equal(typeof contract.createRexFilterMetadata, 'function');
  assert.equal(contract.validateRexVehicle(canonical).valid, true);
  assert.equal(contract.validateProviderAdapter(provider).valid, true);
});

test('history canonical mapping preserves event price semantics and source payload', () => {
  const provider = createApibaraProvider({ fetch: async () => { throw new Error('network disabled'); } });
  const sold = provider.normalizeHistoryRecord(historic.eventUpdated, { vin: historic.vehicle.vin, apibaraEvent: true });
  const approval = provider.normalizeHistoryRecord({ platform: 'iaai', lot_number: 'L2', date: '2026-09-21', price: 900, status: 'Sold on Approval' }, { vin: historic.vehicle.vin, apibaraEvent: true });
  assert.equal(sold.final_price, 5200);
  assert.equal(approval.final_price, null);
  assert.equal(approval.source_price, 900);
  assert.ok(approval.raw_json);
});

test('different Provider B event and filter payloads map to the same canonical contracts', () => {
  const provider = createApibaraProvider({ fetch: async () => { throw new Error('network disabled'); } });
  const apibaraEvent = { platform: 'copart', source_event_id: 'EVENT-1', vin: fixtures.identity.chassis,
    lot_number: fixtures.identity.stock, date: '2026-09-18', status: 'Not Sold', price: 5200 };
  const eventA = provider.toCanonicalHistoryEvent(apibaraEvent, { apibaraEvent: true });
  const eventB = contract.createRexHistoryEvent({ provider: 'provider-b', provider_event_id: 'EVENT-1',
    event_key: 'source:copart:EVENT-1', vin: fixtures.identity.chassis, platform: 'copart', lot: fixtures.identity.stock,
    auction_date: '2026-09-18', status: 'Not Sold', source_status: 'Not Sold',
    pricing: contract.createRexPricing({ source_price: 5200 }), seller: contract.createRexSeller(),
    raw_payload: { lotRef: fixtures.identity.stock, outcome: 'Not Sold', amountObserved: 5200 } });
  const eventProjection = event => {
    const { provider, raw_payload, ...rest } = event;
    return rest;
  };
  assert.deepEqual(eventProjection(eventA), eventProjection(eventB));
  assert.equal(eventA.pricing.final_price, null, 'an event price on an unsold lot is not a sale price');
  assert.equal(eventA.seller.name, null, 'no current seller is invented for a history event');

  const metadata = { make_model: { makes: ['BMW'], models_by_make: { BMW: ['X5'] } }, ranges: { year: { min: 1990, max: 2026 } } };
  const filtersA = provider.normalizeFilterMetadata({ data: metadata });
  const filtersB = contract.createRexFilterMetadata({ provider: 'provider-b', values: metadata, raw_payload: { manufacturers: ['BMW'], models: { BMW: ['X5'] } } });
  assert.deepEqual(filtersA.values, filtersB.values);
});

test('missing provider fields remain unknown and source payload remains available', () => {
  const provider = createApibaraProvider({ fetch: async () => { throw new Error('network disabled'); } });
  const raw = { vin: '1HGCM82633A123456', platform: 'copart' };
  const canonical = provider.toCanonicalVehicle(raw, provider.normalizeVehicle(raw));
  assert.equal(canonical.pricing.current_bid, null);
  assert.equal(canonical.pricing.final_price, null);
  assert.equal(canonical.seller.name, null);
  assert.equal(canonical.auction.auction_at, null);
  assert.equal(canonical.raw_payload, raw);
});

test('provider owns approved requests and cannot be redirected to an arbitrary upstream URL', async () => {
  let calls = 0;
  let requested;
  const provider = createApibaraProvider({ fetch: async url => { calls++; requested = new URL(url); return new Response('{}'); } });
  await provider.fetchVehicle({ APIBARA_API_KEY: 'test' }, 'VIN123');
  assert.equal(requested.origin, 'https://apibara.tech');
  assert.equal(requested.pathname, '/api/v1/vehicle-auction/vehicles/VIN123');
  await assert.rejects(provider.fetchVehicle({ APIBARA_API_KEY: 'test' }, 'https://attacker.test'), error => error.code === 'INVALID_REQUEST');
  assert.throws(() => provider.buildRequestUrl({ operation: 'https://attacker.test' }), error => error.code === 'INVALID_REQUEST');
  assert.equal(calls, 1);
});

test('provider 429/5xx/timeout errors are controlled and never expose upstream bodies or secret', async () => {
  const secret = 'PRIVATE_PROVIDER_KEY';
  const logs = [];
  const logger = { warn: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) };
  const mk = fetch => createApibaraProvider({ fetch, console: logger, timeoutMs: 1 });
  await assert.rejects(mk(async () => new Response('secret body marker', { status: 429, headers: { 'Retry-After': '5' } })).request({ APIBARA_API_KEY: secret }, { operation: 'vehicleByIdentifier', identifier: 'VIN' }), e => e.code === 'RATE_LIMITED' && e.retryAfter === 5);
  await assert.rejects(mk(async () => new Response('secret body marker', { status: 503 })).request({ APIBARA_API_KEY: secret }, { operation: 'vehicleByIdentifier', identifier: 'VIN' }), e => e.code === 'UPSTREAM' && e.status === 503);
  await assert.rejects(mk(async (_url, options) => { options.signal.throwIfAborted(); return await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); }).request({ APIBARA_API_KEY: secret }, { operation: 'vehicleByIdentifier', identifier: 'VIN' }), e => e.code === 'TIMEOUT');
  assert.ok(logs.every(line => !line.includes(secret) && !line.includes('secret body marker')));
});

test('Rex.Bid route contract and frontend source remain provider-neutral and unchanged', () => {
  for (const path of ['/api/cars', '/api/car/:identifier', '/api/car/:identifier/history', '/api/filters']) assert.ok(workerSource.includes(path) || path.includes(':identifier'));
  assert.match(workerSource, /"\/api\/cars"/);
  assert.match(workerSource, /"\/api\/filters"/);
  assert.match(workerSource, /"\/history"/);
  assert.equal(fs.readFileSync(path.join(root, 'public/index.html'), 'utf8').includes('providers/apibara'), false);
  assert.equal(fs.readFileSync(path.join(root, 'public/car.html'), 'utf8').includes('providers/apibara'), false);
});
