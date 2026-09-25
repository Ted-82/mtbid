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
const compareSource = fs.readFileSync(path.join(root, 'public/compare.html'), 'utf8');

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
    pricing: { current_bid_usd: 3200, buy_now_usd: 4500, sale_price_usd: null, last_sold_price_usd: null, estimated_cost: 99999 },
    auction: { state: 'live', full_date: '2026-11-02' },
    media: { items: [{ type: 'image', thumb: 'https://img.example/thumb.jpg', large: 'https://img.example/full.jpg' }] },
    condition: { primary_damage: 'Front end', secondary_damage: 'Minor dents' },
    vehicle_description: { engine: '2.0L', fuel: 'Gasoline', transmission: 'Automatic', drivetrain: 'FWD' },
    odometer: { formatted: '20,000 mi' }, location: { formatted: 'Dallas, TX' }, seller: 'Insurance company',
    ...overrides
  };
}

test('favorites add/remove are idempotent by case-insensitive VIN and persist across reload', () => {
  const store = createStorage();
  const first = store.api.toggleFavorite(car());
  assert.equal(first.ok, true);
  assert.equal(first.saved, true);
  assert.equal(store.api.toggleFavorite(car({ vin: '1hgcm82633a004352' })).saved, false);
  assert.equal(store.api.getFavorites().length, 0);
  store.api.toggleFavorite(car());
  const reloaded = store.reload();
  assert.equal(reloaded.api.getFavorites().length, 1);
  assert.equal(reloaded.api.removeFavorite('1HGCM82633A004352'), true);
  assert.equal(reloaded.api.getFavorites().length, 0);
});

test('VIN is primary identity and LOT-only vehicles produce lot= detail links', () => {
  const store = createStorage();
  const both = car();
  assert.equal(store.api.snapshotFromVehicle(both).id, 'vin:1HGCM82633A004352');
  const lotOnly = store.api.snapshotFromVehicle({ lot_number: 'LOT-88', platform: 'iaai', title: 'Lot only' });
  assert.equal(lotOnly.id, 'lot:iaai:LOT-88');
  assert.equal(store.api.detailHref(lotOnly), '/car.html?lot=LOT-88');
  assert.equal(store.api.detailHref({ vin: 'VIN 123', lot: 'LOT 7' }), '/car.html?vin=VIN%20123');
});

test('local storage persists only curated fields and rejects executable image schemes', () => {
  const store = createStorage();
  store.api.toggleFavorite(car({ secret: 'should not persist', api_raw: { secret: 'no' }, image: 'javascript:alert(1)' }));
  const serialized = store.data.get(store.api.STORAGE_KEY);
  assert.doesNotMatch(serialized, /should not persist|api_raw|estimated_cost/);
  const item = store.api.getFavorites()[0];
  assert.equal(item.image, 'https://img.example/thumb.jpg');
  assert.equal(item.pricing.current_bid_usd, 3200);
  assert.equal(item.pricing.buy_now_usd, 4500);
  assert.equal(item.pricing.sale_price_usd, null);
  assert.equal(store.api.safeImageUrl('javascript:alert(1)'), '');
  assert.equal(store.api.safeImageUrl('data:image/svg+xml,<svg onload=alert(1)>'), '');
  assert.match(store.api.escapeHtml('<img src=x onerror=alert(1)>'), /^&lt;img/);
});

test('compare accepts two and three distinct cars, blocks a fourth, and removes entries', () => {
  const store = createStorage();
  const cars = [
    car({ vin: 'VIN-1', lot_number: '1' }),
    car({ vin: 'VIN-2', lot_number: '2' }),
    car({ vin: 'VIN-3', lot_number: '3' }),
    car({ vin: 'VIN-4', lot_number: '4' })
  ];
  assert.equal(store.api.toggleCompare(cars[0]).saved, true);
  assert.equal(store.api.toggleCompare(cars[1]).saved, true);
  assert.equal(store.api.getCompare().length, 2);
  assert.equal(store.api.toggleCompare(cars[2]).saved, true);
  assert.equal(store.api.toggleCompare(cars[3]).reason, 'limit');
  assert.equal(store.api.getCompare().length, 3);
  assert.equal(store.api.removeCompare('vin:VIN-2'), true);
  assert.equal(store.api.getCompare().length, 2);
});

test('legacy favorites migrate once into versioned storage without carrying arbitrary properties', () => {
  const legacy = JSON.stringify([{ vin: 'LEGACY-VIN', platform: 'copart', arbitrary: '<script>bad</script>' }, { vin: 'DEMO-VIN', is_demo: true }]);
  const store = createStorage({ mtbid_favorites: legacy });
  assert.equal(store.api.getFavorites().length, 1);
  assert.equal(store.api.getFavorites()[0].vin, 'LEGACY-VIN');
  assert.equal(store.api.getFavorites()[0].arbitrary, undefined);
  assert.equal(JSON.parse(store.data.get(store.api.STORAGE_KEY)).version, 1);
  assert.equal(store.reload().api.getFavorites().length, 1);
});

test('local pages expose real favorite/compare actions and render untrusted storage through escaping', () => {
  assert.match(indexSource, /data-local-action="favorite"/);
  assert.match(indexSource, /data-local-action="compare"/);
  assert.match(indexSource, /meta\?\.next_cursor/);
  assert.match(indexSource, /vin \? `\/car\.html\?vin=/);
  assert.match(indexSource, /lot \? `\/car\.html\?lot=/);
  assert.match(carSource, /id="toggleFavorite"/);
  assert.match(carSource, /id="toggleCompare"/);
  assert.doesNotMatch(carSource, /Obserwuj · wkrótce|Porównaj · wkrótce/);
  assert.match(favoritesSource, /storage\.escapeHtml/);
  assert.match(favoritesSource, /storage\.safeImageUrl/);
  assert.doesNotMatch(favoritesSource, /onclick=/i);
  assert.doesNotMatch(favoritesSource, /demoCars/);
  assert.match(compareSource, /max-width:640px/);
  assert.match(compareSource, /storage\.escapeHtml/);
  assert.match(compareSource, /Cena sprzedaży/);
});

test('favorite and comparison renderers escape hostile persisted vehicle fields', () => {
  const store = createStorage();
  store.api.toggleFavorite(car({ vin: 'XSS-VIN', title: '<svg onload=alert(1)>', seller: '<img src=x onerror=alert(1)>' }));
  store.api.toggleCompare(car({ vin: 'XSS-VIN', title: '<svg onload=alert(1)>', seller: '<img src=x onerror=alert(1)>' }));
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } });
    return nodes.get(id);
  };
  const document = { getElementById: element, querySelectorAll() { return []; } };
  const window = { RexBidStorage: store.api, document };
  const favoritesScript = [...favoritesSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  vm.runInNewContext(favoritesScript, { window, document, Intl, Number, String, Array, Set });
  const favoritesHtml = element('content').innerHTML;
  assert.match(favoritesHtml, /&lt;svg onload=alert\(1\)&gt;/);
  assert.match(favoritesHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(favoritesHtml, /<svg onload|<img src=x onerror/i);

  const compareTarget = { innerHTML: '', listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } };
  const compareDocument = { getElementById() { return compareTarget; }, querySelectorAll() { return []; } };
  const compareWindow = { RexBidStorage: store.api, document: compareDocument };
  const compareScript = [...compareSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  vm.runInNewContext(compareScript, { window: compareWindow, document: compareDocument, Intl, Number, String, Array, Set });
  assert.match(compareTarget.innerHTML, /&lt;svg onload=alert\(1\)&gt;/);
  assert.match(compareTarget.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(compareTarget.innerHTML, /<svg onload|<img src=x onerror/i);
});

test('listing card actions toggle favorites and comparison through the shared store', async () => {
  const store = createStorage();
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', innerHTML: '', textContent: '', hidden: false, disabled: false, style: {}, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }, scrollIntoView() {} });
    return nodes.get(id);
  };
  const document = { getElementById: element };
  const location = { href: 'https://rex.bid/', pathname: '/', search: '', hash: '' };
  const window = { RexBidStorage: store.api, location, addEventListener() {}, alert() {}, history: { pushState() {} } };
  const fetch = async () => new Response(JSON.stringify({ ok: true, data: [car()], meta: { next_cursor: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const context = { document, window, URLSearchParams, Response, fetch, console: { error() {}, warn() {}, log() {} } };
  vm.createContext(context);
  const inline = [...indexSource.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => !/\bsrc\s*=/.test(match[1]))[0][2];
  const runnable = inline.replace(/\n\s*loadCars\((?:\{\s*updateUrl:\s*false\s*\})?\);\s*$/, '\n  globalThis.initialLoad = loadCars({ updateUrl: false });');
  vm.runInContext(runnable, context);
  await context.initialLoad;
  const target = element('cars');
  const click = action => target.listeners.click({ target: { closest: () => ({ dataset: { localAction: action, carIndex: '0' } }) }, preventDefault() {}, stopPropagation() {} });
  click('favorite');
  assert.equal(store.api.getFavorites().length, 1);
  assert.match(target.innerHTML, /Usuń z obserwowanych|Obserwujesz/);
  click('compare');
  assert.equal(store.api.getCompare().length, 1);
  assert.match(target.innerHTML, /W porównaniu/);
});

test('vehicle detail actions toggle the current car without changing its VIN/LOT lookup', () => {
  const store = createStorage();
  const buttons = new Map();
  const node = id => {
    if (!buttons.has(id)) buttons.set(id, { id, textContent: '', attributes: {}, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }, setAttribute(name, value) { this.attributes[name] = value; } });
    return buttons.get(id);
  };
  const document = { getElementById: node };
  const window = { RexBidStorage: store.api, alert() {} };
  const start = carSource.indexOf('  function bindPageEvents(video,image360) {');
  const end = carSource.indexOf('\n  function openLightbox()', start);
  assert.ok(start >= 0 && end > start, 'detail event-binding function exists');
  const bindBlock = carSource.slice(start, end);
  const context = { document, window, car: car({ vin: 'DETAIL-VIN' }), photos: [], page: {}, location: { href: 'https://rex.bid/car.html?vin=DETAIL-VIN' }, openLightbox() {} };
  vm.createContext(context);
  vm.runInContext(`${bindBlock}\nglobalThis.bind = bindPageEvents;`, context);
  context.bind(null, null);
  assert.equal(node('toggleFavorite').textContent, '♡ Obserwuj auto');
  node('toggleFavorite').listeners.click();
  assert.equal(store.api.getFavorites()[0].vin, 'DETAIL-VIN');
  assert.equal(node('toggleFavorite').textContent, '♥ Usuń z obserwowanych');
  node('toggleCompare').listeners.click();
  assert.equal(store.api.getCompare()[0].vin, 'DETAIL-VIN');
});

test('saved/compare price data never maps generic price or estimated cost to auction sale price', () => {
  const store = createStorage();
  const snapshot = store.api.snapshotFromVehicle({ vin: 'PRICE-VIN', price: 12345, estimated_cost: 45678, pricing: { estimated_cost: 45678 } });
  assert.equal(snapshot.pricing.current_bid_usd, null);
  assert.equal(snapshot.pricing.sale_price_usd, null);
  assert.equal(snapshot.pricing.buy_now_usd, null);
  assert.equal(snapshot.price, undefined);
  assert.equal(snapshot.estimated_cost, undefined);
});

test('comparison labels confirmed sale, last sale, current bid and Buy Now without substituting a missing bid', () => {
  const store = createStorage();
  store.api.toggleCompare(car({ vin: 'SOLD', auction: { state: 'finished' }, pricing: { sale_price_usd: 12500, current_bid_usd: 7000, buy_now_usd: 14000 } }));
  store.api.toggleCompare(car({ vin: 'BUY-NOW', auction: { state: 'live' }, pricing: { current_bid_usd: null, buy_now_usd: 4200 } }));
  store.api.toggleCompare(car({ vin: 'LAST-SOLD', auction: { state: 'closed' }, pricing: { last_sold_price_usd: 3100 } }));
  const target = { innerHTML: '', addEventListener() {} };
  const document = { getElementById() { return target; }, querySelectorAll() { return []; } };
  const window = { RexBidStorage: store.api, document };
  const script = [...compareSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  vm.runInNewContext(script, { window, document, Intl, Number, String, Array, Set });
  assert.match(target.innerHTML, /Cena sprzedaży/);
  assert.match(target.innerHTML, /\$12,500/);
  assert.match(target.innerHTML, /Kup teraz/);
  assert.match(target.innerHTML, /\$4,200/);
  assert.match(target.innerHTML, /Ostatnia cena sprzedaży/);
  assert.match(target.innerHTML, /\$3,100/);
  assert.doesNotMatch(target.innerHTML, /Aktualna oferta/);
});

test('inline JavaScript remains syntactically valid across touched pages', () => {
  for (const [file, source] of [['index.html', indexSource], ['car.html', carSource], ['ulubione.html', favoritesSource], ['compare.html', compareSource], ['rexbid-storage.js', storageSource]]) {
    const scripts = file.endsWith('.js') ? [source] : [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
    for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script, { filename: file }));
  }
});
