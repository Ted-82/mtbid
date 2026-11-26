const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { JSDOM } = require('jsdom');
const api = require('../public/rexbid-saved-vehicles.js');
const source = fs.readFileSync(require.resolve('../public/rexbid-saved-vehicles.js'), 'utf8');
const storageSource = fs.readFileSync(require.resolve('../public/rexbid-storage.js'), 'utf8');
const favoritesSource = fs.readFileSync(require.resolve('../public/ulubione.html'), 'utf8');
const inline = [...favoritesSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
const VIN = '5YJ3E1EA3PF683202';
const car = (patch = {}) => ({ vin: VIN, platform: 'copart', lot_number: '57660876', title: 'Saved Tesla', pricing: { current_bid_usd: 5000 }, auction: { state: 'open' }, read: { source: 'd1', last_synced_at: '2026-10-08T10:00:00Z' }, ...patch });
const response = data => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const turn = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 5; i++) await turn(); }

test('saved view validates exact VIN, platform and LOT without calling another provider', async () => {
  const saved = car(), calls = [];
  const result = await api.read(saved, async (url, options) => { calls.push({ url, options }); return response(car({ pricing: { current_bid_usd: 0 } })); });
  assert.equal(result.car.pricing.current_bid_usd, 0);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/car/57660876?platform=copart'); assert.equal(calls[0].options.credentials, 'omit');
  for (const patch of [{ lot_number: '11111111' }, { platform: 'iaai' }, { vin: '5YJ3E1EA3PF683203' }, { vin: '' }]) {
    assert.equal((await api.read(saved, async () => response(car(patch)))).code, 'identity');
  }
  assert.equal((await api.read({ vin: VIN }, () => { throw new Error('must not fetch'); })).code, 'identifier');
});

test('older and undated catalog records never replace a newer favorite observation', async () => {
  const saved = car({ read: { last_synced_at: '2026-10-20T12:00:00Z' } });
  for (const read of [{ last_synced_at: '2026-10-08T10:00:00Z' }, {}]) {
    assert.equal((await api.read(saved, async () => response(car({ read })))).code, 'older');
  }
  const fresh = await api.read(saved, async () => response(car({ read: { last_synced_at: '2026-10-21T08:00:00Z' } })));
  assert.equal(fresh.car.read.last_synced_at, '2026-10-21T08:00:00Z');
  assert.equal(saved.read.last_synced_at, '2026-10-20T12:00:00Z');
});

test('404, failed JSON and timeout preserve failure rather than inventing auction outcome', async () => {
  const missing = await api.read(car(), async () => ({ ok: false, status: 404 }));
  assert.equal(missing.status, 404); assert.match(missing.error, /Nie oznacza to sprzedaży/);
  assert.equal((await api.read(car(), async () => ({ ok: true, json: async () => { throw Error('bad'); } }))).code, 'unavailable');
  assert.equal((await api.read(car(), () => new Promise(() => {}), 5)).code, 'unavailable');
});

test('price model separates null, zero, positive bid, Buy Now and terminal results', () => {
  const facts = patch => api.facts(car(patch));
  assert.equal(facts({ pricing: { current_bid_usd: null, price: 9999 } }).amount, null);
  assert.equal(facts({ pricing: { current_bid_usd: 0, current_bid2_usd: 950 } }).amount, null);
  assert.equal(facts({ pricing: { current_bid2_usd: 950 } }).amount, 950);
  assert.equal(facts({ pricing: { current_bid_usd: 0 } }).amount, null);
  assert.equal(facts({ pricing: { current_bid_usd: 25, buy_now_usd: 2000 } }).amount, 25);
  assert.equal(facts({ pricing: { current_bid_usd: 25, buy_now_usd: 2000 } }).buyNow, 2000);
  assert.equal(facts({ pricing: { buy_now_usd: 0 } }).buyNow, null);
  const approval = facts({ auction: { state: 'finished', outcome_status: 'Sold on Approval' }, pricing: { sale_price_usd: 2975, final_price_usd: 2975, source_price_usd: 2975 } });
  assert.equal(approval.label, 'Oferta warunkowa'); assert.equal(approval.amount, 2975); assert.match(approval.status, /niepotwierdzony/);
  const unsold = facts({ auction: { state: 'finished', outcome_status: 'Not Sold' }, pricing: { sale_price_usd: 10000, final_price_usd: 10000 } });
  assert.equal(unsold.amount, null); assert.equal(unsold.status, 'Nie sprzedano');
  const unknown = facts({ auction: { state: 'finished' }, pricing: { final_price_usd: 10000, last_sold_price_usd: 10000 } });
  assert.equal(unknown.amount, null);
  const sold = facts({ auction: { state: 'sold' }, pricing: { sale_price_usd: 9100, current_bid_usd: 5000, buy_now_usd: 12000 } });
  assert.equal(sold.amount, 9100); assert.equal(sold.buyNow, null); assert.equal(sold.label, 'Cena sprzedaży');
});

test('dates preserve date-only auction day and never claim read time as observation time', () => {
  assert.equal(api.date('2026-10-01'), '01.10.2026');
  assert.equal(api.facts(car({ read: {}, saved_at: '2026-10-25T20:00:00Z' })).observed, 'nieustalona');
  assert.match(api.date('2026-10-20T08:30:00Z'), /20\.10\.2026.*10:30/);
});

test('loader caps concurrency, deduplicates completed and failed reads, and applies hard request cap', async () => {
  let active = 0, peak = 0, calls = 0;
  const loader = api.createLoader({ limit: 14, fetchImpl: async url => { calls++; active++; peak = Math.max(peak, active); await turn(); active--; return response(car({ lot_number: url.match(/car\/(\d+)/)[1] })); } });
  const cars = Array.from({ length: 20 }, (_, i) => car({ lot_number: String(i + 1) }));
  const values = await Promise.all(cars.map(c => loader.get(c)));
  assert.equal(calls, 14); assert.equal(loader.attempts, 14); assert.equal(peak, 3);
  assert.equal(values.filter(x => x.code === 'limit').length, 6);
  await loader.get(cars[0]); assert.equal(calls, 14);
  let failedCalls = 0;
  const failed = api.createLoader({ fetchImpl: async () => { failedCalls++; return { ok: false, status: 503 }; } });
  await failed.get(car()); await failed.get(car()); assert.equal(failedCalls, 1);
});

function domSetup(t, items, fetchImpl) {
  const dom = new JSDOM('<main><p class="device-note"></p><div id="counter"></div><div id="content"></div></main>', { url: 'https://rexbid.pl/ulubione', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.fetch = fetchImpl;
  w.eval(storageSource);
  items.slice().reverse().forEach(c => w.RexBidStorage.toggleLocalFavorite(c));
  const before = w.localStorage.getItem(w.RexBidStorage.STORAGE_KEY);
  w.eval(source);
  const originalMount = w.RexBidSavedVehicles.mount;
  let controller;
  w.RexBidSavedVehicles.mount = options => (controller = originalMount(options));
  w.eval(inline);
  return { w, before, content: w.document.getElementById('content'), get controller() { return controller; } };
}

test('guest view updates from D1 while persistent favorite snapshot remains byte-for-byte intact', async t => {
  const p = domSetup(t, [car()], async () => response(car({ pricing: { sale_price_usd: 9100 }, auction: { state: 'sold' }, read: { last_synced_at: '2026-10-20T08:00:00Z' } })));
  await settle();
  assert.match(p.content.textContent, /Cena sprzedaży.*9\s?100 USD/s);
  assert.match(p.content.textContent, /20\.10\.2026/); assert.doesNotMatch(p.content.textContent, /5\s?000 USD/);
  assert.equal(p.w.localStorage.getItem(p.w.RexBidStorage.STORAGE_KEY), p.before);
  assert.equal(p.content.querySelectorAll('[data-action="remove"]').length, 1);
  assert.equal(p.content.querySelectorAll('[data-compare-lot="57660876"]').length, 1);
  assert.equal(new URL(p.content.querySelector('.saved-car-link').href).searchParams.get('lot'), '57660876');
});

test('guest failed read keeps earlier snapshot, real date, and explicit failure without retry loop', async t => {
  let calls = 0;
  const p = domSetup(t, [car()], async () => { calls++; return { ok: false, status: 503 }; });
  await settle();
  assert.match(p.content.textContent, /Zachowano wcześniejszy zapis/); assert.match(p.content.textContent, /5\s?000 USD/); assert.match(p.content.textContent, /08\.10\.2026/);
  p.content.append(p.w.document.createElement('div')); await settle(); assert.equal(calls, 1);
  assert.equal(p.w.localStorage.getItem(p.w.RexBidStorage.STORAGE_KEY), p.before);
});

test('favorites pagination performs at most 12 new reads until next explicit click', async t => {
  const cars = Array.from({ length: 28 }, (_, i) => car({ vin: VIN.slice(0, -2) + String(i).padStart(2, '0'), lot_number: String(i + 1) }));
  let calls = 0;
  const p = domSetup(t, cars, async url => { calls++; const lot = url.match(/car\/(\d+)/)[1]; return response(cars[Number(lot) - 1]); });
  await settle(); assert.equal(calls, 12); assert.equal(p.content.querySelectorAll('.card:not([hidden])').length, 12);
  p.content.querySelector('.saved-pagination button').click(); await settle(); assert.equal(calls, 24);
  p.content.querySelector('.saved-pagination button').click(); await settle(); assert.equal(calls, 28);
  assert.equal(p.content.querySelector('.saved-pagination button').hidden, true);
  assert.equal(p.w.RexBidStorage.getFavorites().length, 28);
});

test('cloud favorites existing controls are retained and public reads omit authentication', async t => {
  const dom = new JSDOM('<main><p class="device-note"></p><div id="counter"></div><div id="content"></div></main>', { url: 'https://rexbid.pl/ulubione', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window; const calls = [];
  w.fetch = async (url, options) => {
    calls.push({ url, method: options?.method || 'GET', credentials: options?.credentials });
    if (url === '/api/auth/config') return { ok: true, status: 200, json: async () => ({ ok: true, enabled: true }) };
    if (url === '/api/me') return { ok: true, status: 200, json: async () => ({ ok: true, user: { id: 'test-only-user' } }) };
    if (url === '/api/me/favorites') return { ok: true, status: 200, json: async () => ({ ok: true, favorites: [{ vin: VIN, platform: 'copart', lot: '57660876' }] }) };
    assert.equal(url, '/api/car/57660876?platform=copart'); return response(car({ pricing: { current_bid_usd: 0 } }));
  };
  w.eval(storageSource); w.eval(fs.readFileSync(require.resolve('../public/rexbid-auth.js'), 'utf8')); w.eval(source); w.eval(inline);
  await w.RexBidAuth.ready; await settle();
  const content = w.document.getElementById('content');
  assert.equal(content.querySelectorAll('.cloud-favorite').length, 1);
  assert.match(content.textContent, /Brak danych o ofercie/); assert.doesNotMatch(content.textContent, /0 USD/); assert.match(content.textContent, /Usuń/);
  assert.equal(content.querySelector('[data-compare-lot]').dataset.compareLot, '57660876');
  assert.equal(calls.filter(x => x.url.startsWith('/api/car/')).length, 1);
  assert.equal(calls.find(x => x.url.startsWith('/api/car/')).credentials, 'omit');
  assert.ok(calls.every(x => x.method === 'GET'));
  assert.deepEqual(Object.keys(w.RexBidAuth.getFavorites()[0].pricing), [], 'public view is not written into private account cache');
});

test('provider text remains escaped, source images fail safely, and elapsed open date is not declared sold', async t => {
  const title = '<svg onload="bad()">';
  const p = domSetup(t, [car()], async () => response(car({ title, auction: { state: 'open', full_date: '2026-10-01' }, pricing: { current_bid_usd: 0 }, media: { thumbs: ['https://example.test/image.jpg'] } })));
  await settle(); assert.equal(p.content.querySelector('svg'), null); assert.match(p.content.textContent, /<svg onload=/); assert.match(p.content.textContent, /Dostępność do potwierdzenia/); assert.match(p.content.textContent, /01\.10\.2026/);
  p.content.querySelector('img').dispatchEvent(new p.w.Event('error')); assert.match(p.content.textContent, /Zdjęcie niedostępne/);
});

test('removal during an in-flight read never restores the removed favorite or repeats remaining reads', async t => {
  const other = car({ vin: '5YJ3E1EA3PF683203', lot_number: '57660877', title: 'Second Tesla' });
  const pending = new Map(); let calls = 0;
  const p = domSetup(t, [car(), other], url => { calls++; return new Promise(resolve => pending.set(url, resolve)); });
  await turn();
  p.content.querySelector('[data-action="remove"]').click(); await turn();
  pending.get('/api/car/57660876?platform=copart')(response(car()));
  pending.get('/api/car/57660877?platform=copart')(response(other));
  await settle();
  assert.equal(calls, 2); assert.equal(p.w.RexBidStorage.getFavorites().length, 1);
  assert.equal(p.content.querySelectorAll('.card').length, 1);
  assert.match(p.content.textContent, /Second Tesla/); assert.doesNotMatch(p.content.textContent, /57660876/);
});

test('leaving favorites stops queued requests and keeps completed reads in memory only', async () => {
  let calls = 0; const pending = [];
  const loader = api.createLoader({ fetchImpl: url => { calls++; return new Promise(resolve => pending.push(() => resolve(response(car({ lot_number: url.match(/car\/(\d+)/)[1] }))))); } });
  const jobs = Array.from({ length: 9 }, (_, i) => loader.get(car({ lot_number: String(i + 1) })));
  assert.equal(calls, 3); loader.stop(); pending.forEach(resolve => resolve());
  const values = await Promise.all(jobs); assert.equal(calls, 3); assert.equal(values.filter(x => x.code === 'stopped').length, 6);
  assert.equal((await loader.get(car())).code, 'stopped');
});

test('BFCache preserves pending reads and pagination, while a later definitive pagehide still stops work', async t => {
  const cars = Array.from({ length: 25 }, (_, i) => car({ vin: VIN.slice(0, -2) + String(i).padStart(2, '0'), lot_number: String(i + 1) }));
  const pending = []; let calls = 0;
  const p = domSetup(t, cars, url => {
    calls++;
    const saved = cars[Number(url.match(/car\/(\d+)/)[1]) - 1];
    return new Promise(resolve => pending.push(() => resolve(response(saved))));
  });
  await turn(); assert.equal(calls, 3);
  p.w.dispatchEvent(new p.w.PageTransitionEvent('pagehide', { persisted: true }));
  p.w.dispatchEvent(new p.w.PageTransitionEvent('pageshow', { persisted: true }));
  for (let round = 0; round < 4; round++) { pending.splice(0).forEach(resolve => resolve()); await settle(); }
  assert.equal(calls, 12);
  assert.equal(p.content.querySelectorAll('.saved-view-ready').length, 12);
  assert.doesNotMatch(p.content.textContent, /Sprawdzam zapis katalogu/);
  p.content.querySelector('.saved-pagination button').click(); await turn();
  assert.equal(calls, 15, 'explicit next page still starts bounded reads after BFCache return');
  for (let round = 0; round < 4; round++) { pending.splice(0).forEach(resolve => resolve()); await settle(); }
  assert.equal(calls, 24); assert.equal(p.content.querySelectorAll('.saved-view-ready').length, 24);
  p.w.dispatchEvent(new p.w.PageTransitionEvent('pagehide', { persisted: false }));
  assert.equal((await p.controller.loader.get(cars[24])).code, 'stopped');
  assert.equal(calls, 24, 'later definitive pagehide is still handled after earlier persisted event');
  assert.equal(p.w.localStorage.getItem(p.w.RexBidStorage.STORAGE_KEY), p.before);
});

test('hidden controls stay hidden despite button and navigation display styles', t => {
  const html=fs.readFileSync(require.resolve('../public/ulubione.html'),'utf8');
  const dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,oldLogin=w.document.querySelector('header .auth a');
  oldLogin.hidden=true;
  const next=w.document.createElement('button');next.className='btn btn-outline';next.hidden=true;
  w.document.getElementById('content').append(next);
  assert.equal(w.getComputedStyle(oldLogin).display,'none');
  assert.equal(w.getComputedStyle(next).display,'none');
});
