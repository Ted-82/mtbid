'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('catalogue controls show the effective session order and preserve manual and ordinary sorting', async t => {
  const root = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {url: 'https://rexbid.pl/?catalog=1', runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const win = dom.window;
  const doc = win.document;
  const node = id => doc.getElementById(id);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  win.RexBidMarket = require(path.join(root, 'rexbid-market.js'));
  win.matchMedia = () => ({matches: false});
  win.scrollTo = () => {};
  win.HTMLElement.prototype.scrollIntoView = () => {};
  const requests = [];
  win.fetch = async url => {
    const {pathname, searchParams} = new URL(url, win.location.href);
    let response;
    if (pathname === '/api/filters') {
      response = {ok: true, data: {}};
    } else {
      assert.equal(pathname, '/api/cars');
      requests.push(searchParams);
      const effective = searchParams.get('sort') || (searchParams.get('lot_sub_status') === 'Live' ? 'recent' : 'auction_next');
      response = {ok: true, data: [], meta: {sort: effective}};
    }
    return new Response(JSON.stringify(response), {headers: {'content-type': 'application/json'}});
  };
  win.eval([...doc.scripts].find(script => !script.src).textContent);
  await settle();
  const select = node('catalogSort');
  const label = () => select.selectedOptions[0].textContent;
  const note = () => node('catalogSortNote').textContent;
  const change = (field, value) => {
    field.value = value;
    field.dispatchEvent(new win.Event('change', {bubbles: true}));
  };

  assert.match(label(), /najbliższe/);
  change(node('lotSubStatus'), 'Live');
  node('advancedFilterButton').click();
  await settle();
  assert.equal(requests.at(-1).get('lot_sub_status'), 'Live');
  assert.equal(requests.at(-1).has('sort'), false);
  assert.match(label(), /ostatnio zapisane/i);
  assert.match(note(), /ostatniego zapisu/);
  const sessionUrl = win.location.href;
  const sessionHistory = win.history.state;

  node('clearFiltersButton').click();
  await settle();
  assert.equal(requests.at(-1).has('lot_sub_status'), false);
  assert.equal(requests.at(-1).has('sort'), false);
  assert.match(label(), /najbliższe/);
  assert.match(note(), /najbliższej licytacji/);

  const requestCount = requests.length;
  win.history.replaceState(sessionHistory, '', sessionUrl);
  win.dispatchEvent(new win.PopStateEvent('popstate', {state: sessionHistory}));
  await settle();
  assert.equal(requests.length, requestCount, 'browser back uses its saved catalogue page');
  assert.match(label(), /ostatnio zapisane/i);
  change(select, 'year_desc');
  await settle();
  assert.equal(requests.at(-1).get('sort'), 'year_desc');
  assert.match(label(), /Rocznik/);
  assert.match(note(), /Rocznik od najnowszych/);
  node('clearFiltersButton').click();
  await settle();
  assert.equal(requests.at(-1).has('lot_sub_status'), false);
  assert.equal(requests.at(-1).get('sort'), 'year_desc');
  assert.equal(select.value, 'year_desc');
  change(select, '');
  await settle();
  assert.equal(requests.at(-1).has('sort'), false);
  assert.match(label(), /najbliższe/);
});
