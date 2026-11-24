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

test('favorites retain existing storage identity but detail links preserve LOT and platform', () => {
  const store = createStorage();
  assert.equal(store.api.snapshotFromVehicle(car()).id, 'vin:1HGCM82633A004352');
  assert.equal(store.api.detailHref(store.api.snapshotFromVehicle(car())), '/car.html?vin=1HGCM82633A004352&lot=12345678&platform=copart');
  const lotOnly = store.api.snapshotFromVehicle({ lot_number: 'LOT-88', platform: 'iaai', title: 'Lot only' });
  assert.equal(lotOnly.id, 'lot:iaai:LOT-88');
  assert.equal(store.api.detailHref(lotOnly), '/car.html?lot=LOT-88&platform=iaai');
  assert.equal(store.api.detailHref({ vin: 'VIN 123', lot: 'LOT 7' }), '/car.html?vin=VIN%20123&lot=LOT%207');
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

test('favorite snapshots preserve source observation through sanitization and reload without persisting read secrets', () => {
  const store = createStorage();
  const vehicle = car({read:{source:'d1',freshness:'stale',last_synced_at:'2026-10-06T13:30:00Z',last_seen_at:'2026-10-06T14:00:00Z',private_token:'must-not-persist'},pricing:{current_bid_usd:75},lot_number:'44140937',platform:'iaai'});
  store.api.toggleLocalFavorite(vehicle);
  const item = store.reload().api.getGuestFavorites()[0];
  assert.equal(item.lot,'44140937'); assert.equal(item.platform,'iaai'); assert.equal(item.pricing.current_bid_usd,75);
  assert.deepEqual(JSON.parse(JSON.stringify(item.read)),{source:'d1',freshness:'stale',read_only:true,last_synced_at:'2026-10-06T13:30:00.000Z',last_seen_at:'2026-10-06T14:00:00.000Z',observed_at:''});
  assert.doesNotMatch(store.data.get(store.api.STORAGE_KEY),/must-not-persist|private_token/);
  const legacy = store.api.snapshotFromVehicle(car({saved_at:'2026-10-07T17:00:00Z'}));
  assert.equal(legacy.read.freshness,'unknown'); assert.equal(legacy.read.last_synced_at,''); assert.equal(legacy.read.last_seen_at,''); assert.equal(legacy.read.observed_at,'');
  const preview = store.api.snapshotFromVehicle(car({preview:{read_only:true,freshness:'fresh',last_seen_at:'2026-10-06T14:00:00Z'}}));
  assert.equal(preview.read.freshness,'fresh'); assert.equal(preview.read.read_only,true); assert.equal(preview.read.last_seen_at,'2026-10-06T14:00:00.000Z');
  const invalid = store.api.snapshotFromVehicle(car({read:{source:'d1',freshness:'fresh',last_synced_at:'2026-02-30T00:00:00Z',last_seen_at:'not-a-date'}}));
  assert.equal(invalid.read.last_synced_at,''); assert.equal(invalid.read.last_seen_at,'');
});

test('guest favorite card shows observed stale IAAI price, dated snapshot and unconfirmed schedule after reload', () => {
  const store = createStorage();
  store.api.toggleLocalFavorite(car({vin:'WBA5R1C06MFK00001',lot_number:'44140937',platform:'iaai',read:{source:'d1',freshness:'stale',last_synced_at:'2026-10-06T13:30:00Z'},pricing:{current_bid_usd:75},auction:{state:'open',auction_at:'2026-10-06T14:00:00Z'}}));
  const nodes = new Map();
  const element = id => {if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',addEventListener(){}});return nodes.get(id);};
  const document = {getElementById:element,querySelectorAll(){return [];}};
  const script = [...favoritesSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  vm.runInNewContext(script,{window:{RexBidStorage:store.reload().api},document,Date,Intl,Number,String,Array,Set});
  const html = element('content').innerHTML;
  assert.match(html,/Ostatnia zapisana oferta/); assert.match(html,/\$75/);
  assert.match(html,/Status do potwierdzenia/); assert.match(html,/Termin z zapisu/);
  assert.match(html,/Zapis danych aukcji z .*6.*paź.*2026.*15:30/);
  assert.match(html,/Cenę, termin i dostępność potwierdź w oryginalnej aukcji/);
  assert.doesNotMatch(html,/Aktualna oferta|Przed licytacją|Termin minął|Nadchodząca|Trwa/);
  assert.match(html,/vin=WBA5R1C06MFK00001&amp;lot=44140937&amp;platform=iaai/);
});

test('legacy favorite without observation metadata remains usable with no current price or auction claim', () => {
  const store = createStorage({rex_bid_local_v1:JSON.stringify({legacy_migrated:true,favorites:[{vin:'LEGACY-VIN',lot:'777',platform:'copart',pricing:{current_bid_usd:250},auction:{state:'live',date:'2026-11-02T14:00:00Z'},saved_at:'2026-10-07T17:00:00Z'}]})});
  const nodes = new Map();
  const element = id => {if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',addEventListener(){}});return nodes.get(id);};
  const document = {getElementById:element,querySelectorAll(){return [];}};
  const script = [...favoritesSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  vm.runInNewContext(script,{window:{RexBidStorage:store.api},document,Date,Intl,Number,String,Array,Set});
  const html = element('content').innerHTML;
  assert.match(html,/LEGACY-VIN/); assert.match(html,/Ostatnia zapisana oferta/); assert.match(html,/\$250/);
  assert.match(html,/Data obserwacji nieustalona/); assert.match(html,/Status do potwierdzenia/);
  assert.doesNotMatch(html,/Aktualna oferta|Zapis danych aukcji z|Przed licytacją|Trwa/);
  assert.equal(store.reload().api.getFavorites().length,1,'existing stored favorite remains present');
  assert.equal(store.api.detailHref(store.api.getFavorites()[0]),'/car.html?vin=LEGACY-VIN&lot=777&platform=copart');
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

test('favorite page safely renders hostile persisted fields, supports removal and separate comparison controls', () => {
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
  assert.match(html, /data-compare-lot="12345678" data-compare-platform="copart"/);
  assert.match(favoritesSource, /Ulubione zapisane na tym urządzeniu/);
  assert.match(favoritesSource, /detailHref\(car\)/);
  assert.doesNotMatch(favoritesSource, /onclick=/i);
});

test('favorite page auth bootstrap may dispatch before mounting and safely falls back to a guest card', async () => {
  const store = createStorage();
  store.api.toggleFavorite(car({
    vin: 'APPROVAL-VIN',
    auction: { state: 'finished', outcome_status: 'Sold on Approval' },
    pricing: { sale_price_usd: 950, last_sold_price_usd: 950 }
  }));
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } });
    return nodes.get(id);
  };
  const document = { getElementById: element, querySelectorAll() { return []; } };
  let authStateListener;
  const window = {
    RexBidStorage: store.api,
    RexBidAuth: { enabled: true, status: 'anonymous', mountFavoritesPage() { return Promise.resolve(false); } }
  };
  const script = [...favoritesSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  vm.runInNewContext(script, { window, document, Intl, Number, String, Array, Set, addEventListener(_name, callback) { authStateListener = callback; callback(); } });
  await Promise.resolve();
  const html = element('content').innerHTML;
  assert.match(html, /APPROVAL-VIN/);
  assert.match(html, /Oferta warunkowa · wynik niepotwierdzony/);
  assert.match(html, /Cena sprzedaży niepotwierdzona/);
  assert.doesNotMatch(html, /\$950/);
  assert.equal(typeof authStateListener, 'function');
});

test('account page loads shared storage for auth flows without exposing guest counts as cloud account data', () => {
  assert.match(accountSource, /<script src="\/rexbid-storage\.js(?:\?v=[a-f0-9]+)?"><\/script>/);
  assert.match(accountSource, /id="accountAuthMount"/);
  assert.doesNotMatch(accountSource, /window\.RexBidStorage\?\.getFavorites\?\.\(\)\.length/);
  assert.doesNotMatch(accountSource, /localStorage\.getItem\("mtbid_favorites"/);
});

test('product pages retain favorites and dynamic-filter routes, while comparison product is removed', () => {
  assert.match(indexSource, /data-local-action="favorite"/);
  assert.match(indexSource, /\/filters\?/);
  assert.match(indexSource, /meta\?\.next_cursor/);
  assert.match(indexSource, /loadFilterMetadata/);
  assert.match(indexSource, /make\.addEventListener\("change"/);
  assert.match(indexSource, /model\.addEventListener\("change"/);
  assert.match(indexSource, /vin \? `\/car\?vin=/);
  assert.match(indexSource, /lot \? `\/car\?lot=/);
  assert.match(carSource, /id="toggleFavorite"/);
  assert.doesNotMatch(indexSource + carSource + favoritesSource + storageSource, /compare\.html|data-local-action="compare"|toggleCompare|data-rexbid-count="compare"/i);
  assert.doesNotMatch(carSource, /Obserwuj · wkrótce|Porównaj · wkrótce/);
});

test('favorites never show zero Buy Now or infer sale/current price from generic fields', () => {
  const inline = [...favoritesSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  const approvalBlock = inline.match(/  const approvalPending = auction => [\s\S]*?;\n/)?.[0];
  const priceBlock = inline.slice(inline.indexOf('  function priceInfo('), inline.indexOf('  function render()'));
  assert.ok(approvalBlock);
  const context = { car: {} };
  vm.createContext(context);
  vm.runInContext(`${approvalBlock}\n${priceBlock}\nglobalThis.priceInfo = priceInfo;`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.priceInfo({ auction: { state: 'open' }, pricing: { current_bid2_usd: 1200, buy_now_usd: 0, price: 9900, estimated_cost: 12000 } }))), ['Ostatnia zapisana oferta', 1200]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.priceInfo({ auction: { state: 'finished' }, pricing: { sale_price_usd: null, last_sold_price_usd: 2300, current_bid_usd: 1800 } }))), ['Ostatnia cena sprzedaży', 2300]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.priceInfo({ auction: { state: 'open' }, pricing: { current_bid_usd: null, current_bid2_usd: null, buy_now_usd: 0, price: 9900, estimated_cost: 12000 } }))), ['Brak danych o ofercie', null]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.priceInfo({ auction: { state: 'finished', outcome_status: 'Sold on Approval' }, pricing: { sale_price_usd: 950, last_sold_price_usd: 950 } }))), ['Cena sprzedaży niepotwierdzona', null]);
});

test('favorite cards do not present elapsed unconfirmed auctions as upcoming and format dates for readers', () => {
  const inline = [...favoritesSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  const approvalBlock = inline.match(/  const approvalPending = auction => [\s\S]*?;\n/)?.[0];
  const statusBlock = inline.match(/  const statusLabel = \(auction, now = Date\.now\(\)\) => \{[\s\S]*?\n  \};/)?.[0];
  const dateBlock = inline.match(/  const auctionDateLabel = value => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(approvalBlock);
  assert.ok(statusBlock);
  assert.ok(dateBlock);
  const context = { Date, Intl, Number, String };
  vm.createContext(context);
  vm.runInContext(`${approvalBlock}\n${statusBlock}\n${dateBlock}\nglobalThis.statusLabel = statusLabel; globalThis.auctionDateLabel = auctionDateLabel;`, context);
  const now = Date.parse('2026-10-03T12:00:00Z');
  assert.equal(context.statusLabel({ state: 'open', date: '2026-10-02T13:30:00Z' }, now), 'Termin minął · wynik do potwierdzenia');
  assert.equal(context.statusLabel({ state: 'open', date: '2026-10-04T13:30:00Z' }, now), 'Przed licytacją');
  assert.equal(context.statusLabel({ state: 'live', date: '2026-10-02T13:30:00Z' }, now), 'Trwa');
  assert.equal(context.statusLabel({ state: 'sold', date: '2026-10-02T13:30:00Z' }, now), 'Sprzedana');
  assert.equal(context.auctionDateLabel('not-a-date'), '—');
  assert.doesNotMatch(context.auctionDateLabel('2026-10-02T13:30:00Z'), /^2026-10-02T/);
  assert.match(favoritesSource, /auctionDateLabel\(car\.auction\?\.date \|\| car\.auction\?\.full_date\)/);
});

test('inline JavaScript remains syntactically valid across touched pages and storage', () => {
  for (const [file, source] of [['index.html', indexSource], ['car.html', carSource], ['ulubione.html', favoritesSource], ['rexbid-storage.js', storageSource]]) {
    const scripts = file.endsWith('.js') ? [source] : [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
    for (const sourceText of scripts) assert.doesNotThrow(() => new vm.Script(sourceText, { filename: file }));
  }
});
