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
  win.eval(inline.slice(0, startup) + '\nwindow.catalogLoads=0;loadCars=async()=>{window.catalogLoads++;};window.metadataApi={load:loadFilterMetadata,advanced:loadAdvancedFilterMetadata};');
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

test('base options contain makes, and models load only when a make is chosen', async t => {
  const p = page(t);
  p.node('yearFrom').value = '2020';
  await p.load('');
  assert.deepEqual(p.models(),[]);
  assert.deepEqual(p.requests.map(x=>x.url.search),['?view=basic']);
  await p.load('HONDA');
  assert.deepEqual(p.models(),['CIVIC']);
  assert.equal(p.requests[1].url.search,'?view=models&make=HONDA');
  await p.load('BMW','X5');
  assert.deepEqual(p.models(),['X5']);
  assert.equal(p.node('model').value,'X5');
  assert.equal(p.node('yearFrom').value,'2020');
  await p.load(' honda ');
  assert.deepEqual(p.models(),['CIVIC']);
  assert.equal(p.requests.length,3);
  await p.load('');
  assert.deepEqual(p.models(),[]);
  assert.equal(p.requests.length,3);
});

test('typing invalidates previous models; commit fetches only the final make',async t=>{
  const p=page(t),clock=p.clock();
  await p.load('HONDA','CIVIC');
  p.change('input','B');p.change('input','BM');p.change('input','BMW');
  await clock.flush();
  assert.deepEqual(p.models(),[]);
  assert.equal(p.node('model').value,'');
  assert.equal(p.requests.length,2);
  p.change('change','BMW');p.change('change','BMW');
  await clock.flush();
  assert.deepEqual(p.models(),['X5']);
  assert.equal(p.requests.length,3);
  assert.equal(p.requests[2].url.searchParams.get('make'),'BMW');
  p.change('input','');p.change('change','');
  await clock.flush();
  assert.deepEqual(p.models(),[]);
  assert.equal(p.requests.length,3);
});

test('requests for each make coalesce; a late make cannot overwrite the selected one',async t=>{
  const p=page(t),older=deferred(),newer=deferred();
  p.respond(url=>url.searchParams.get('make')==='HONDA'?older.promise:
    url.searchParams.get('make')==='BMW'?newer.promise:response(stored()));
  const first=p.load('HONDA'),same=p.load('HONDA'),latest=p.load('BMW','X5');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(p.requests.map(r=>r.url.searchParams.get('make')),[null,'HONDA','BMW']);
  newer.resolve(response(stored()));
  await latest;
  older.resolve(response(stored()));
  await Promise.all([first,same]);
  assert.deepEqual(p.models(),['X5']);
  assert.equal(p.node('model').value,'X5');
});

test('metadata TTL is per make and a cache hit cannot extend it',async t=>{
  const p=page(t);
  await p.load('HONDA');p.advance(29_999);
  await p.load('HONDA');
  assert.equal(p.requests.length,2);
  p.advance(1);await p.load('HONDA');
  assert.equal(p.requests.length,4);
  p.advance(-1);await p.load('HONDA');
  assert.equal(p.requests.length,6);
});

test('HTTP, JSON, application and network failures permit retry and keep manual input',async t=>{
  const errors=[()=>new Response('',{status:503}),()=>new Response('{'),()=>response({ok:false}),
    ()=>Promise.reject(Error('offline')),()=>{throw Error('sync failure');}];
  for(const fail of errors){
    const p=page(t);
    await p.load('HONDA');
    p.respond(fail);
    await assert.rejects(p.load('BMW','X5'));
    assert.deepEqual(p.models(),[]);
    assert.equal(p.node('make').value,'BMW');
    assert.equal(p.node('model').disabled,false);
    p.respond(()=>response(stored()));
    await p.load('BMW','X5');
    assert.deepEqual(p.models(),['X5']);
    assert.equal(p.requests.length,4);
  }
});

test('provider, hybrid and malformed models are not retained in the paged suggestion cache',async t=>{
  for(const body of [
    {...stored(),meta:{read_source:'provider'}},{...stored(),meta:{read_source:'hybrid',known_rows_only:true}},
    {...stored(),meta:{read_source:'d1'}},{...stored(),data:[]}
  ]){
    const p=page(t);
    await p.load('');
    p.respond(()=>response(body));
    await p.load('BMW');await p.load('BMW');
    assert.equal(p.requests.length,3);
  }
});

test('platform and model scope stay independent when previous platform responds last',async t=>{
  const p=page(t),old=deferred();
  p.respond(url=>url.searchParams.get('platform')==='iaai'?old.promise.then(reply=>reply.clone()):response(stored({sale_document_names:['CERTIFICATE OF TITLE']})));
  p.node('platform').value='iaai';const pending=p.load('HONDA');
  p.node('platform').value='copart';await p.load('BMW','X5');
  old.resolve(response(stored({sale_document_names:['CLEAR']})));await pending;
  assert.deepEqual(p.models(),['X5']);
  assert.deepEqual(p.requests.map(r=>r.url.search),[
    '?view=basic&platform=iaai','?view=models&make=HONDA&platform=iaai',
    '?view=basic&platform=copart','?view=models&make=BMW&platform=copart'
  ]);
});

test('advanced options wait for expansion, are shared on reopen and keep a selected document',async t=>{
 const p=page(t);
 p.respond(url=>response(stored({sale_document_names:['KEEP','OTHER'],states:['CA','TX']})));
 await p.load('');
 assert.equal(p.node('saleDocument').options.length,1);
 assert.deepEqual(p.requests.map(r=>r.url.searchParams.get('view')),['basic']);
 const details=p.node('advancedFilters');
 details.open=true;
 details.dispatchEvent(new p.win.Event('toggle'));
 await p.api.advanced();
 assert.equal(p.node('saleDocument').options[1].value,'KEEP');
 assert.equal(p.node('locationState').options[1].value,'CA');
 p.node('saleDocument').value='KEEP';
 details.open=false;
 await p.api.advanced();
 details.open=true;
 await p.api.advanced();
 assert.equal(p.node('saleDocument').value,'KEEP');
 assert.deepEqual(p.requests.map(r=>r.url.searchParams.get('view')),['basic','advanced']);
});

test('stale advanced options from the previous platform cannot replace current choices',async t=>{
 const p=page(t),old=deferred();
 p.respond(url=>url.searchParams.get('platform')==='iaai'?old.promise:response(stored({sale_document_names:['NEW'],states:['CA']})));
 p.node('advancedFilters').open=true;
 p.node('platform').value='iaai';
 const earlier=p.api.advanced();
 p.node('platform').value='copart';
 await p.api.advanced();
 old.resolve(response(stored({sale_document_names:['OLD'],states:['TX']})));await earlier;
 assert.equal(p.node('saleDocument').options[1].value,'NEW');
 assert.equal(p.node('locationState').options[1].value,'CA');
});
