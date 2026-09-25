const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const storageSource = fs.readFileSync(path.join(root, 'public/rexbid-storage.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const carSource = fs.readFileSync(path.join(root, 'public/car.html'), 'utf8');
const favoritesSource = fs.readFileSync(path.join(root, 'public/ulubione.html'), 'utf8');
const accountSource = fs.readFileSync(path.join(root, 'public/konto.html'), 'utf8');

function createStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  const localStorage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
  const window = {
    localStorage, URL,
    location: { origin: 'https://rex.bid' },
    document: { querySelectorAll() { return []; } },
    addEventListener() {}
  };
  const context = { window, URL, URLSearchParams, Date, Intl, Number, String, JSON, Set, Array, Object, Math };
  vm.createContext(context);
  vm.runInContext(storageSource, context);
  return { api: window.RexBidStorage, data, reload() { return createStorage(Object.fromEntries(data)); } };
}

function car(overrides = {}) {
  return {
    vin: '1HGCM82633A004352', lot_number: '12345678', platform: 'copart',
    year: 2020, make: 'Honda', model: 'Accord',
    pricing: { current_bid_usd: 3200, current_bid2_usd: null, buy_now_usd: 4500, sale_price_usd: null, last_sold_price_usd: null, estimated_cost: 99999 },
    auction: { state: 'live', full_date: '2026-11-02', is_timed: false },
    media: { items: [{ type: 'image', thumb: 'https://img.example/thumb.jpg', large: 'https://img.example/full.jpg' }] },
    condition: { primary_damage: 'Front end', secondary_damage: 'Minor dents' },
    vehicle_description: { engine: '2.0L', fuel: 'Gasoline', transmission: 'Automatic', drivetrain: 'FWD' },
    odometer: { formatted: '20,000 mi' }, location: { formatted: 'Dallas, TX' }, seller: 'Insurance company',
    ...overrides
  };
}

test('favorites add/remove are idempotent by case-insensitive VIN and persist across reload', () => {
  const store = createStorage();
  assert.equal(store.api.toggleFavorite(car()).saved, true);
  assert.equal(store.api.getFavorites().length, 1);
  assert.equal(store.api.isFavorite(car({ vin: '1hgcm82633a004352' })), true);
  const reloaded = store.reload();
  assert.equal(reloaded.api.getFavorites().length, 1);
  assert.equal(reloaded.api.removeFavorite('1HGCM82633A004352'), true);
  assert.equal(reloaded.api.getFavorites().length, 0);
});

test('VIN is primary identity and LOT-only vehicles produce exact lot= detail links', () => {
  const store = createStorage();
  assert.equal(store.api.snapshotFromVehicle(car()).id, 'vin:1HGCM82633A004352');
  const lotOnly = store.api.snapshotFromVehicle({ lot_number: 'LOT-88', platform: 'iaai', title: 'Lot only' });
  assert.equal(lotOnly.id, 'lot:iaai:LOT-88');
  assert.equal(store.api.detailHref(lotOnly), '/car.html?lot=LOT-88');
  assert.equal(store.api.detailHref({ vin: 'VIN 123', lot: 'LOT 7' }), '/car.html?vin=VIN%20123');
});

test('versioned storage keeps only curated favorite fields and rejects executable image schemes', () => {
  const store = createStorage();
  store.api.toggleFavorite(car({ secret: 'should not persist', api_raw: { secret: 'no' }, image: 'javascript:alert(1)' }));
  const serialized = store.data.get(store.api.STORAGE_KEY);
  assert.doesNotMatch(serialized, /should not persist|api_raw|estimated_cost/);
  const item = store.api.getFavorites()[0];
  assert.equal(item.image, 'https://img.example/thumb.jpg');
  assert.equal(item.pricing.current_bid_usd, 3200);
  assert.equal(item.pricing.buy_now_usd, 4500);
  assert.equal(item.pricing.sale_price_usd, null);
  assert.equal(item.auction.is_timed, false);
  assert.equal(store.api.safeImageUrl('javascript:alert(1)'), '');
  assert.equal(store.api.safeImageUrl('data:image/svg+xml,<svg onload=alert(1)>'), '');
  assert.match(store.api.escapeHtml('<img src=x onerror=alert(1)>'), /^&lt;img/);
});

test('legacy favorites migrate once and retired comparison state is discarded without losing favorites', () => {
  const legacy = JSON.stringify([{ vin: 'LEGACY-VIN', platform: 'copart', arbitrary: '<script>bad</script>' }, { vin: 'DEMO-VIN', is_demo: true }]);
  const priorVersioned = JSON.stringify({ schema: 'rex-bid-local', version: 1, legacy_migrated: true, favorites: [{ vin: 'SAVED-VIN' }], compare: [{ vin: 'COMPARE-ONLY' }] });
  const store = createStorage({ mtbid_favorites: legacy, rex_bid_local_v1: priorVersioned });
  assert.deepEqual(JSON.parse(JSON.stringify(store.api.getFavorites())).map(item => item.vin), ['SAVED-VIN']);
  const rewritten = JSON.parse(store.data.get(store.api.STORAGE_KEY));
  assert.equal(rewritten.version, 1);
  assert.equal(rewritten.compare, undefined);
  assert.equal(store.reload().api.getFavorites().length, 1);
  const legacyOnly = createStorage({ mtbid_favorites: legacy });
  assert.equal(legacyOnly.api.getFavorites()[0].vin, 'LEGACY-VIN');
  assert.equal(legacyOnly.api.getFavorites()[0].arbitrary, undefined);
});

test('favorite page safely renders hostile persisted fields, supports removal and has no comparison UI', () => {
  const store = createStorage();
  store.api.toggleFavorite(car({ vin: 'XSS-VIN', title: '<svg onload=alert(1)>', seller: '<img src=x onerror=alert(1)>' }));
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } });
    return nodes.get(id);
  };
  const document = { getElementById: element, querySelectorAll() { return []; } };
  const window = { RexBidStorage: store.api, document };
  const script = [...favoritesSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  vm.runInNewContext(script, { window, document, Intl, Number, String, Array, Set });
  const html = element('content').innerHTML;
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<svg onload|<img src=x onerror/i);
  assert.match(html, /data-action="remove"/);
  assert.doesNotMatch(html, /compare|porównaj/i);
  assert.match(favoritesSource, /Ulubione zapisane na tym urządzeniu/);
  assert.match(favoritesSource, /detailHref\(car\)/);
  assert.doesNotMatch(favoritesSource, /onclick=/i);
});

test('account favorite counter reads the shared versioned storage module', () => {
  assert.match(accountSource, /<script src="\/rexbid-storage\.js"><\/script>/);
  assert.match(accountSource, /window\.RexBidStorage\?\.getFavorites\?\.\(\)\.length/);
  assert.doesNotMatch(accountSource, /localStorage\.getItem\("mtbid_favorites"/);
});

test('product pages retain favorites and dynamic-filter routes, while comparison product is removed', () => {
  assert.match(indexSource, /data-local-action="favorite"/);
  assert.match(indexSource, /\/filters\?/);
  assert.match(indexSource, /meta\?\.next_cursor/);
  assert.match(indexSource, /loadFilterMetadata/);
  assert.match(indexSource, /make\.addEventListener\("change"/);
  assert.match(indexSource, /model\.addEventListener\("change"/);
  assert.match(indexSource, /vin \? `\/car\.html\?vin=/);
  assert.match(indexSource, /lot \? `\/car\.html\?lot=/);
  assert.match(carSource, /id="toggleFavorite"/);
  assert.doesNotMatch(indexSource + carSource + favoritesSource + storageSource, /compare\.html|data-local-action="compare"|toggleCompare|data-rexbid-count="compare"/i);
  assert.doesNotMatch(carSource, /Obserwuj · wkrótce|Porównaj · wkrótce/);
});

test('favorites never show zero Buy Now or infer sale/current price from generic fields', () => {
  const inline = [...favoritesSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  const priceBlock = inline.slice(inline.indexOf('  function priceInfo('), inline.indexOf('  function render()'));
  const context = { car: {} };
  vm.createContext(context);
  vm.runInContext(`${priceBlock}\nglobalThis.priceInfo = priceInfo;`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.priceInfo({ auction: { state: 'open' }, pricing: { current_bid_usd: null, current_bid2_usd: 1200, buy_now_usd: 0, price: 9900, estimated_cost: 12000 } }))), ['Aktualna oferta', 1200]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.priceInfo({ auction: { state: 'finished' }, pricing: { sale_price_usd: null, last_sold_price_usd: 2300, current_bid_usd: 1800 } }))), ['Ostatnia cena sprzedaży', 2300]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.priceInfo({ auction: { state: 'open' }, pricing: { current_bid_usd: null, current_bid2_usd: null, buy_now_usd: 0, price: 9900, estimated_cost: 12000 } }))), ['Cena aukcji', null]);
});

test('inline JavaScript remains syntactically valid across touched pages and storage', () => {
  for (const [file, source] of [['index.html', indexSource], ['car.html', carSource], ['ulubione.html', favoritesSource], ['rexbid-storage.js', storageSource]]) {
    const scripts = file.endsWith('.js') ? [source] : [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
    for (const sourceText of scripts) assert.doesNotThrow(() => new vm.Script(sourceText, { filename: file }));
  }
});
