'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
const inline = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .find(match => !/\bsrc=/.test(match[1]))[2];
const startup = inline.lastIndexOf('  restoreFiltersFromUrl();');
assert.ok(startup > 0);
const flush = async () => {for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
const car = title => ({title, year: 2023, vin: '1HGCM82633A004352', lot_number: '12345678',
  platform: 'copart', auction: {state: 'open', schedule_status: 'unassigned'},
  pricing: {current_bid_usd: 0, buy_now_usd: null}});
const result = (title = 'CURRENT', cursor = null) => ({ok: true, data: [car(title)], meta: {next_cursor: cursor}});
const response = body => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
const metadata = () => ({ok: true, data: {models: [{make: 'HONDA', model: 'CIVIC'},
  {make: 'TESLA', model: 'MODEL 3'}]}, meta: {read_source: 'd1', known_rows_only: true}});

function page(t, route = '/?catalog=1') {
  const dom = new JSDOM(html, {url: 'https://rexbid.pl' + route, runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const win = dom.window, requests = [], metadataRequests = [], scrolls = [];
  const node = id => win.document.getElementById(id);
  win.RexBidMarket = require('../public/rexbid-market');
  win.RexBidStorage = {safeImageUrl: () => '', isFavorite: () => false, refreshCounts() {}};
  win.matchMedia = () => ({matches: false});
  win.IntersectionObserver = class {observe() {} unobserve() {} disconnect() {}};
  win.requestAnimationFrame = callback => callback();
  win.scrollTo = options => {scrolls.push(options); win.scrollY = options.top;};
  win.HTMLElement.prototype.scrollIntoView = function() {};
  win.console.error = () => {};
  win.console.warn = () => {};
  let filterReply = () => response(metadata());
  win.fetch = (url, options) => {
    const parsed = new URL(url, 'https://rexbid.pl');
    assert.equal(parsed.origin, 'https://rexbid.pl');
    assert.equal(options?.method || 'GET', 'GET');
    assert.equal(options?.credentials,'omit','public catalogue reads must not send account cookies');
    if (parsed.pathname === '/api/filters') {
      metadataRequests.push(parsed);
      return filterReply(parsed,options);
    }
    assert.equal(parsed.pathname, '/api/cars');
    const pending = deferred();
    requests.push({url: parsed, options, resolve: body => pending.resolve(response(body)), reject: pending.reject});
    return pending.promise;
  };
  win.eval(inline.slice(0, startup) + '\nwindow.catalogApi={load:loadCars,restore:restoreFiltersFromUrl,metadata:loadFilterMetadata};');
  win.catalogApi.restore();
  return {win, node, requests, metadataRequests, scrolls, api: win.catalogApi,
    filters(fn) {filterReply = fn;},
    change(id, value) {node(id).value = value; node(id).dispatchEvent(new win.Event('change', {bubbles: true}));}};
}

test('real make change followed by Filtruj shares only the current pending request', async t => {
  const p = page(t);
  p.change('make', 'HONDA');
  p.node('filterButton').click();
  p.node('filterButton').click();
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].url.search, '?make=HONDA&per_page=20&view=cards');
  assert.equal(p.node('cars').getAttribute('aria-busy'), 'true');
  const shared = p.api.load();
  p.requests[0].resolve(result('HONDA', 'next-2'));
  assert.equal(await shared, true);
  assert.equal(p.node('cars').querySelectorAll('article').length, 1);
  assert.equal(p.node('cars').getAttribute('aria-busy'), 'false');
  assert.equal(p.node('loadMoreButton').hidden, false);
  assert.equal(p.win.location.search, '?catalog=1&make=HONDA');
  assert.equal(p.win.history.state.rexBidCatalog.cars.length, 1);
  const later = p.api.load();
  assert.equal(p.requests.length, 2, 'completed results are not cached by this guard');
  p.requests[1].resolve(result('FRESH'));
  await later;
  assert.match(p.node('cars').textContent, /FRESH/);
});

test('A → B → A starts three requests and older completions cannot clear or overwrite the latest A', async t => {
  const p = page(t);
  p.node('make').value = 'HONDA'; const first = p.api.load();
  p.node('make').value = 'TESLA'; const second = p.api.load();
  p.node('make').value = 'HONDA'; const third = p.api.load();
  assert.equal(p.requests.length, 3);
  p.requests[0].resolve(result('OLD HONDA'));
  p.requests[1].resolve(result('OLD TESLA'));
  await Promise.all([first, second]);
  const shared = p.api.load();
  assert.equal(p.requests.length, 3, 'old finally must not evict the current pending entry');
  assert.equal(p.node('cars').getAttribute('aria-busy'), 'true');
  p.requests[2].resolve(result('NEW HONDA'));
  assert.deepEqual(await Promise.all([third, shared]), [true, true]);
  assert.match(p.node('cars').textContent, /NEW HONDA/);
  assert.doesNotMatch(p.node('cars').textContent, /OLD/);
  assert.equal(p.win.location.search, '?catalog=1&make=HONDA');
});

test('a failed current request releases its entry and the same query can retry', async t => {
  const p = page(t);
  const one = p.api.load(), two = p.api.load();
  assert.equal(p.requests.length, 1);
  p.requests[0].reject(Error('Synthetic failure'));
  assert.deepEqual(await Promise.all([one, two]), [false, false]);
  assert.equal(p.node('cars').getAttribute('aria-busy'), 'false');
  const retry = p.api.load();
  assert.equal(p.requests.length, 2);
  p.requests[1].resolve(result());
  assert.equal(await retry, true);
});

test('restored cursor and updateUrl behavior are part of the request identity', async t => {
  const p = page(t, '/?catalog=1&make=HONDA&cursor=page-2');
  const restored = p.api.load({updateUrl: false});
  const duplicate = p.api.load({updateUrl: false});
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].url.searchParams.get('cursor'), 'page-2');
  const fresh = p.api.load();
  assert.equal(p.requests.length, 2);
  assert.equal(p.requests[1].url.searchParams.has('cursor'), false);
  p.requests[0].resolve(result('OLD PAGE'));
  await Promise.all([restored, duplicate]);
  p.requests[1].resolve(result('FIRST PAGE'));
  await fresh;
  assert.match(p.node('cars').textContent, /FIRST PAGE/);
  assert.equal(p.win.location.search, '?catalog=1&make=HONDA');
});

test('append retains its own guard and a new filter invalidates an outstanding append', async t => {
  const p = page(t);
  const first = p.api.load();
  p.requests[0].resolve(result('FIRST', 'page-2'));
  await first;
  const append = p.api.load({append: true});
  await p.api.load({append: true});
  assert.equal(p.requests.length, 2);
  assert.equal(p.requests[1].url.searchParams.get('cursor'), 'page-2');
  p.node('make').value = 'TESLA';
  const next = p.api.load();
  const shared = p.api.load();
  assert.equal(p.requests.length, 3);
  p.requests[1].resolve(result('STALE PAGE'));
  await append;
  p.requests[2].resolve(result('TESLA'));
  await Promise.all([next, shared]);
  assert.equal(p.node('cars').querySelectorAll('article').length, 1);
  assert.doesNotMatch(p.node('cars').textContent, /FIRST|STALE PAGE/);
  assert.equal(p.node('loadMoreButton').disabled, false);
});

test('Home invalidation prevents reuse of a request from the old view', async t => {
  const p = page(t);
  const old = p.api.load();
  p.win.history.pushState({}, '', '/');
  p.win.dispatchEvent(new p.win.PopStateEvent('popstate'));
  const current = p.api.load();
  assert.equal(p.requests.length, 2);
  p.requests[0].resolve(result('OLD'));
  await old;
  p.requests[1].resolve(result('CURRENT'));
  await current;
  assert.doesNotMatch(p.node('cars').textContent, /OLD/);
  assert.equal(p.scrolls.length, 0);
});

for (const clear of ['clear-all', 'remove-make']) {
  test(`${clear} keeps manual model input enabled and clears stale model suggestions`, async t => {
    const p = page(t), stale = deferred();
    p.node('make').value = 'HONDA';
    await p.api.metadata('CIVIC');
    assert.equal(p.node('model').value, 'CIVIC');
    // Invalidate the cache clock; a slow older response must not refill after clearing.
    p.win.Date.now = () => Date.now() + 60_000;
    p.filters(() => stale.promise.then(reply => reply.clone()));
    const oldMetadata = p.api.metadata();
    p.change('model', 'CIVIC');
    if (clear === 'clear-all') p.node('clearFiltersButton').click();
    else p.node('activeFilterChips').querySelector('[data-filter-id="make"]').click();
    assert.equal(p.node('model').disabled, false);
    assert.equal(p.node('model').value, '');
    assert.equal(p.node('modelOptions').children.length, 0);
    stale.resolve(response(metadata()));
    await oldMetadata;
    assert.equal(p.node('modelOptions').children.length, 0);
    p.change('model', 'MANUAL MODEL');
    assert.equal(p.requests.at(-1).url.searchParams.get('model'), 'MANUAL MODEL');
    assert.equal(p.requests.at(-1).url.searchParams.has('make'), false);
    p.filters(() => response(metadata()));
    p.change('make', 'TESLA');
    await flush();
    assert.equal(p.node('model').disabled, false);
    assert.deepEqual([...p.node('modelOptions').children].map(option => option.value), ['MODEL 3']);
    for (const request of p.requests) request.resolve(result());
    await flush();
  });
}


test('obsolete filters and append are aborted while the current shared request survives',async t=>{
 const p=page(t);p.node('make').value='HONDA';const first=p.api.load();
 const shared=p.api.load();assert.equal(p.requests[0].options.signal.aborted,false);assert.equal(p.requests.length,1);
 p.node('make').value='TESLA';const next=p.api.load();assert.equal(p.requests[0].options.signal.aborted,true);assert.equal(p.requests[1].options.signal.aborted,false);
 p.requests[0].resolve(result('STALE'));await Promise.all([first,shared]);p.requests[1].resolve(result('TESLA','p2'));await next;
 const append=p.api.load({append:true});const appendSignal=p.requests[2].options.signal;
 p.node('make').value='HONDA';const current=p.api.load();assert.equal(appendSignal.aborted,true);assert.equal(p.requests[3].options.signal.aborted,false);
 p.requests[2].resolve(result('OLD APPEND'));await append;p.requests[3].resolve(result('NEW HONDA'));await current;
 assert.match(p.node('cars').textContent,/NEW HONDA/);assert.doesNotMatch(p.node('cars').textContent,/OLD APPEND|STALE/);
});

test('metadata deadline includes a stalled body, releases the pending key and permits retry',async t=>{
 const p=page(t),body=deferred();let deadline,cleared=false,signal;
 p.win.setTimeout=(callback,ms)=>{assert.equal(ms,15000);deadline=callback;return 42;};
 p.win.clearTimeout=id=>{assert.equal(id,42);cleared=true;};
 p.filters((_url,options)=>{signal=options.signal;signal.addEventListener('abort',()=>body.reject(new p.win.DOMException('Deadline','AbortError')));return {ok:true,json:()=>body.promise};});
 const pending=p.api.metadata();await flush();assert.equal(cleared,false);assert.equal(signal.aborted,false);deadline();await assert.rejects(pending,/Deadline/);assert.equal(cleared,true);
 p.filters(()=>response(metadata()));await p.api.metadata();assert.equal(p.metadataRequests.length,2);assert.equal(p.node('model').disabled,false);
});

test('only the first catalogue image gets eager high priority; following images remain lazy',async t=>{
 const p=page(t);p.win.RexBidStorage.safeImageUrl=value=>value;
 const pending=p.api.load();p.requests[0].resolve({ok:true,data:[0,1,2].map(i=>({...car('IMAGE '+i),lot_number:String(10000000+i),image:'https://images.example/car-'+i+'.jpg'})),meta:{next_cursor:null}});await pending;
 const images=[...p.node('cars').querySelectorAll('.car-image img')];assert.equal(images.length,3);
 assert.equal(images[0].getAttribute('loading'),'eager');assert.equal(images[0].getAttribute('fetchpriority'),'high');
 for(const image of images.slice(1)){assert.equal(image.getAttribute('loading'),'lazy');assert.equal(image.getAttribute('fetchpriority'),'auto');}
});
