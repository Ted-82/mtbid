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

function stored(extra = {}) {
  return {ok: true, data: {
    makes: [{value: 'HONDA', label: 'HONDA'}, {value: 'BMW', label: 'BMW'}],
    models: [{make: 'HONDA', model: 'CIVIC'}, {make: 'BMW', model: 'X5'}],
    years: [2022], fuel_types: ['Gasoline', 'Electric'], ...extra
  }, meta: {read_source: 'd1', known_rows_only: true}};
}
const response = body => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};

function page(t) {
  const dom = new JSDOM(html, {url: 'https://rexbid.pl/?catalog=1', runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const win = dom.window, requests = [];
  let now = Date.parse('2026-10-20T16:00:00Z'), respond = () => response(stored());
  win.Date.now = () => now;
  win.RexBidMarket = require('../public/rexbid-market');
  win.RexBidStorage = {safeImageUrl: () => '', isFavorite: () => false, refreshCounts() {}};
  for (const key of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(win, key, {get() {throw Error('Metadata must not use persistent storage');}});
  }
  win.fetch = (url, options) => {
    const parsed = new URL(url, 'https://rexbid.pl');
    assert.equal(parsed.origin, 'https://rexbid.pl');
    assert.equal(parsed.pathname, '/api/filters');
    requests.push({url: parsed, options});
    return respond(parsed);
  };
  win.eval(inline.slice(0, startup) + '\nwindow.catalogLoads=0;loadCars=async()=>{window.catalogLoads++;};window.metadataApi={load:loadFilterMetadata};');
  const node = id => win.document.getElementById(id);
  return {win, requests, node, api: win.metadataApi,
    respond(fn) {respond = fn;},
    advance(ms) {now += ms;},
    models() {return [...node('modelOptions').querySelectorAll('option')].map(option => option.value);},
    async load(make, selectedModel = '') {node('make').value = make; return win.metadataApi.load(selectedModel);},
    change(type, make) {node('make').value = make; node('make').dispatchEvent(new win.Event(type, {bubbles:true}));},
    clock() {
      let sequence=0;
      const pending=new Map();
      win.setTimeout=(callback,ms)=>{const id=++sequence;pending.set(id,{callback,ms});return id;};
      win.clearTimeout=id=>pending.delete(id);
      return {pending,async flush() {
        const callbacks=[...pending.entries()].filter(([,item])=>item.ms<1000);
        callbacks.forEach(([id,item])=>{pending.delete(id);item.callback();});
        for(let turn=0;turn<2;turn++)await new Promise(resolve=>setImmediate(resolve));
      }};
    }
  };
}

test('confirmed D1 metadata is reused across makes and models are filtered locally', async t => {
  const p = page(t);
  p.node('yearFrom').value = '2020';
  await p.load('HONDA');
  assert.deepEqual(p.models(), ['CIVIC']);
  assert.equal(p.requests[0].url.searchParams.get('make'), 'HONDA');
  await p.load('BMW', 'X5');
  assert.deepEqual(p.models(), ['X5']);
  assert.equal(p.node('model').value, 'X5');
  assert.equal(p.node('yearFrom').value, '2020');
  assert.equal(p.requests.length, 1);
  await p.load('Unknown');
  assert.deepEqual(p.models(), []);
  assert.equal(p.node('make').value, 'Unknown');
  assert.equal(p.requests.length, 1);
});

test('native make input immediately clears the old model and debounces locally filtered D1 models', async t => {
  const p=page(t),clock=p.clock();
  p.respond(()=>response(stored({models:[{make:'HONDA',model:'CIVIC'},{make:'TESLA',model:'MODEL 3'}]})));
  await p.load('HONDA','CIVIC');
  assert.equal(p.node('model').value,'CIVIC');
  p.change('input','TESLA');
  assert.deepEqual(p.models(),[]);
  assert.equal(p.node('model').value,'');
  assert.equal(clock.pending.size,1);
  assert.equal([...clock.pending.values()][0].ms,250);
  assert.equal(p.requests.length,1);
  await clock.flush();
  assert.deepEqual(p.models(),['MODEL 3']);
  assert.equal(p.requests.length,1,'confirmed D1 response reused');
  p.change('change','TESLA');
  await clock.flush();
  assert.deepEqual(p.models(),['MODEL 3']);
  assert.equal(p.requests.length,1);
  assert.equal(p.win.catalogLoads,1);
});

test('native change flushes pending typing once; repeated change shares the already started request', async t => {
  const p=page(t),clock=p.clock(),pending=deferred();
  p.respond(()=>pending.promise);
  p.change('input','T');
  p.change('input','TE');
  p.change('input','TESLA');
  assert.equal(clock.pending.size,1);
  assert.equal(p.requests.length,0);
  p.change('change','TESLA');
  assert.equal([...clock.pending.values()].filter(item=>item.ms===250).length,0,'typing debounce was flushed');
  assert.equal([...clock.pending.values()].filter(item=>item.ms===15000).length,1,'request body deadline remains active');
  assert.equal(p.requests.length,1);
  p.change('change','TESLA');
  assert.equal(p.requests.length,1);
  pending.resolve(response({ok:true,data:{models:['MODEL Y']},meta:{read_source:'provider'}}));
  await clock.flush();
  assert.deepEqual(p.models(),['MODEL Y']);
  assert.equal(p.requests[0].url.searchParams.get('make'),'TESLA');
});

test('rapid native input invalidates an in-flight old make before the debounce fires', async t => {
  const p=page(t),clock=p.clock(),old=deferred(),latest=deferred();
  p.respond(url=>url.searchParams.get('make')==='HONDA'?old.promise:latest.promise);
  p.change('change','HONDA');
  p.node('model').value='CIVIC';
  p.node('modelOptions').innerHTML='<option value="CIVIC"></option>';
  p.change('input','TE');
  p.change('input','TES');
  p.change('input',' TESLA ');
  assert.equal(p.node('model').value,'');
  assert.deepEqual(p.models(),[]);
  old.resolve(response({ok:true,data:{models:['OLD CIVIC']},meta:{read_source:'provider'}}));
  for(let turn=0;turn<2;turn++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(p.models(),[],'old response cannot refill the cleared list');
  assert.equal(p.requests.length,1);
  await clock.flush();
  assert.equal(p.requests.length,2);
  assert.equal(p.requests[1].url.searchParams.get('make'),'TESLA');
  latest.resolve(response(stored({models:[{make:'HONDA',model:'CIVIC'},{make:'TESLA',model:'MODEL S'}]})));
  await clock.flush();
  assert.deepEqual(p.models(),['MODEL S'],'trimmed make is used for local filtering too');
});

test('native change without input refreshes models and input can return to an earlier make', async t => {
  const p=page(t),clock=p.clock();
  p.change('change','HONDA');
  await clock.flush();
  assert.deepEqual(p.models(),['CIVIC']);
  await p.load('BMW'); // URL/filter restoration can update controls separately.
  assert.deepEqual(p.models(),['X5']);
  p.change('input','HONDA');
  assert.deepEqual(p.models(),[]);
  p.change('change','HONDA');
  await clock.flush();
  assert.deepEqual(p.models(),['CIVIC']);
  assert.equal(p.requests.length,1);
});

test('reuse expires at 30 seconds and cache hits do not extend its lifetime', async t => {
  const p = page(t);
  await p.load('HONDA');
  p.advance(29_999);
  await p.load('BMW');
  assert.equal(p.requests.length, 1);
  p.advance(1);
  await p.load('HONDA');
  assert.equal(p.requests.length, 2);
});

test('slow responses and clock rollback cannot extend the reuse window', async t => {
  const p = page(t), pending = deferred();
  p.respond(() => pending.promise);
  const first = p.load('HONDA');
  p.advance(30_000);
  pending.resolve(response(stored()));
  await first;
  p.respond(() => response(stored()));
  await p.load('BMW');
  assert.equal(p.requests.length, 2);
  p.advance(-1);
  await p.load('HONDA');
  assert.equal(p.requests.length, 3);
});

test('provider, hybrid, incomplete and malformed contracts are never retained', async t => {
  const variants = [
    {...stored(), meta: {read_source: 'provider', known_rows_only: true}},
    {...stored(), meta: {read_source: 'hybrid', known_rows_only: true}},
    {...stored(), meta: {read_source: 'd1'}},
    {...stored(), meta: {read_source: 'd1', known_rows_only: 'true'}},
    {...stored(), meta: undefined, read_source: 'd1', known_rows_only: true},
    {...stored(), ok: undefined},
    {...stored(), data: []},
    {...stored(), data: null}
  ];
  for (const body of variants) {
    const p = page(t);
    p.respond(() => response(body));
    await p.load('HONDA');
    await p.load('BMW');
    await p.load('BMW');
    assert.equal(p.requests.length, 3);
    assert.deepEqual(p.requests.map(item => item.url.searchParams.get('make')), ['HONDA', 'BMW', 'BMW']);
  }
});

test('simultaneous requests for the same make share one pending request', async t => {
  const p = page(t), pending = deferred();
  p.respond(() => pending.promise);
  const first = p.load('HONDA'), second = p.load('HONDA');
  assert.equal(p.requests.length, 1);
  pending.resolve(response(stored()));
  await Promise.all([first, second]);
  assert.deepEqual(p.models(), ['CIVIC']);
  await p.load('BMW');
  assert.equal(p.requests.length, 1);
  assert.deepEqual(p.models(), ['X5']);
});

test('unconfirmed concurrent makes stay separate and an older response cannot replace the latest UI or cache', async t => {
  const p = page(t), honda = deferred(), bmw = deferred();
  p.respond(url => url.searchParams.get('make') === 'HONDA' ? honda.promise : bmw.promise);
  const first = p.load('HONDA'), second = p.load('BMW');
  assert.equal(p.requests.length, 2);
  bmw.resolve(response(stored({models: [{make: 'BMW', model: 'LATEST'}, {make: 'HONDA', model: 'LATEST HONDA'}]})));
  await second;
  assert.deepEqual(p.models(), ['LATEST']);
  honda.resolve(response(stored({models: [{make: 'HONDA', model: 'OLD'}]})));
  await first;
  assert.deepEqual(p.models(), ['LATEST']);
  await p.load('HONDA');
  assert.deepEqual(p.models(), ['LATEST HONDA']);
  assert.equal(p.requests.length, 2);
});

test('provider responses remain specific to their requested make during concurrent requests', async t => {
  const p = page(t), honda = deferred(), bmw = deferred();
  p.respond(url => url.searchParams.get('make') === 'HONDA' ? honda.promise : bmw.promise);
  const first = p.load('HONDA'), second = p.load('BMW');
  bmw.resolve(response({ok: true, data: {models: ['BMW ONLY']}, meta: {read_source: 'provider'}}));
  await second;
  honda.resolve(response({ok: true, data: {models: ['HONDA ONLY']}, meta: {read_source: 'provider'}}));
  await first;
  assert.deepEqual(p.models(), ['BMW ONLY']);
  p.respond(() => response({ok: true, data: {models: ['NEW BMW']}, meta: {read_source: 'provider'}}));
  await p.load('BMW');
  assert.equal(p.requests.length, 3);
  assert.deepEqual(p.models(), ['NEW BMW']);
});

test('HTTP, JSON, application and network errors clear pending state and leave manual input available', async t => {
  const errors = [
    () => new Response('', {status: 503}),
    () => new Response('{'),
    () => response({ok: false, meta: {read_source: 'd1', known_rows_only: true}}),
    () => Promise.reject(Error('offline network failure')),
    () => {throw Error('synchronous failure');}
  ];
  for (const fail of errors) {
    const p = page(t);
    await p.load('HONDA');
    p.advance(30_000);
    p.respond(fail);
    await assert.rejects(p.load('BMW'));
    assert.deepEqual(p.models(), []);
    assert.equal(p.node('make').value, 'BMW');
    assert.equal(p.node('make').disabled, false);
    p.respond(() => response(stored()));
    await p.load('BMW');
    assert.equal(p.requests.length, 3);
    assert.deepEqual(p.models(), ['X5']);
  }
});

test('an older failed request cannot erase a newer confirmed cache entry', async t => {
  const p = page(t), older = deferred();
  p.respond(url => url.searchParams.get('make') === 'HONDA' ? older.promise : response(stored()));
  const first = p.load('HONDA'), rejected = assert.rejects(first, /old request failed/);
  await p.load('BMW');
  older.reject(Error('old request failed'));
  await rejected;
  await p.load('HONDA');
  assert.equal(p.requests.length, 2);
  assert.deepEqual(p.models(), ['CIVIC']);
});

test('a provider response after expiry is never replaced with an expired D1 entry', async t => {
  const p = page(t);
  await p.load('HONDA');
  p.advance(30_000);
  p.respond(() => response({ok: true, data: {models: ['PROVIDER']}, meta: {read_source: 'provider'}}));
  await p.load('BMW');
  await p.load('HONDA');
  assert.equal(p.requests.length, 3);
  assert.deepEqual(p.models(), ['PROVIDER']);
});

test('metadata cache is isolated by platform while make changes within it reuse D1 data',async t=>{
 const p=page(t);
 p.respond(url=>response(stored({sale_document_names:[url.searchParams.get('platform')==='iaai'?'CLEAR':'CERTIFICATE OF TITLE']})));
 p.node('platform').value='iaai';await p.load('HONDA');
 assert.equal(p.requests[0].url.searchParams.get('platform'),'iaai');
 assert.equal(p.node('saleDocument').options[1].value,'CLEAR');
 await p.load('BMW');assert.equal(p.requests.length,1);
 p.node('platform').value='copart';await p.load('BMW');
 assert.equal(p.requests[1].url.searchParams.get('platform'),'copart');
 assert.equal(p.node('saleDocument').options[1].value,'CERTIFICATE OF TITLE');
 p.node('platform').value='';await p.load('BMW');
 assert.equal(p.requests[2].url.searchParams.get('platform'),null);
});

test('late metadata for a previous platform cannot overwrite current document choices',async t=>{
 const p=page(t),old=deferred();
 p.respond(url=>url.searchParams.get('platform')==='iaai'?old.promise:response(stored({sale_document_names:['CERTIFICATE OF TITLE'],drive_types:[]})));
 p.node('platform').value='iaai';const pending=p.load('HONDA');
 p.node('platform').value='copart';await p.load('HONDA');
 old.resolve(response(stored({sale_document_names:['CLEAR']})));await pending;
 assert.equal(p.node('saleDocument').options[1].value,'CERTIFICATE OF TITLE');
 await p.load('BMW');assert.equal(p.requests.length,2);
});
