'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.REXBID_TEST_ROOT || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/car.html'), 'utf8');
const start = source.indexOf('  async function loadOlderAuctionHistory()');
const end = source.indexOf('  function auctionRefreshIntervalMs(', start);
assert.ok(start >= 0 && end > start, 'Use the real history pagination handler');

function historyPage(fetchPage) {
  const button = {hidden:false, disabled:false, textContent:'Załaduj starsze obserwacje'};
  const originalEvent = {event_key:'SAVED-EVENT', final_price:2500};
  const originalSnapshot = {snapshot_id:1, current_bid_usd:0};
  const context = {
    auctionHistoryNextCursor:'OPAQUE-CURSOR',
    auctionHistoryLoading:false,
    auctionHistoryRecords:[originalEvent],
    observedHistoryRecords:[originalSnapshot],
    auctionHistorySeenCursors:new Set(['OPAQUE-CURSOR']),
    document:{getElementById:id => id === 'loadOlderAuctionHistory' ? button : null},
    getLot:() => 'SAVED-LOT',
    getVin:() => null,
    fetchAuctionHistoryPage:fetchPage,
    historyRecordsForRender:records => records,
    observedRecordsForRender:records => records,
    renderAuctionHistory(){},
    updateHistoryMoreButton(){button.hidden = !context.auctionHistoryNextCursor;},
    console:{warn(){}}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.loadOlder = loadOlderAuctionHistory;', context);
  return {context, button, originalEvent, originalSnapshot};
}

test('failed older-history read keeps its retry message, saved records and exact cursor until a successful retry', async () => {
  const calls = [];
  let offline = true;
  const view = historyPage(async (lot, cursor) => {
    calls.push({lot,cursor});
    if (offline) throw new Error('HTTP 503');
    return {records:[],snapshots:[{snapshot_id:2,current_bid_usd:null}],nextCursor:null};
  });
  await view.context.loadOlder();
  assert.match(view.button.textContent, /Nie udało się pobrać.*spróbuj ponownie/);
  assert.equal(view.button.disabled, false);
  assert.equal(view.button.hidden, false);
  assert.equal(view.context.auctionHistoryLoading, false);
  assert.equal(view.context.auctionHistoryNextCursor, 'OPAQUE-CURSOR');
  assert.equal(view.context.auctionHistoryRecords[0], view.originalEvent);
  assert.equal(view.context.observedHistoryRecords[0], view.originalSnapshot);
  assert.equal(view.context.observedHistoryRecords.length, 1);

  offline = false;
  await view.context.loadOlder();
  assert.deepEqual(calls, [
    {lot:'SAVED-LOT',cursor:'OPAQUE-CURSOR'},
    {lot:'SAVED-LOT',cursor:'OPAQUE-CURSOR'}
  ]);
  assert.equal(view.context.auctionHistoryRecords[0], view.originalEvent);
  assert.equal(view.context.observedHistoryRecords.length, 2);
  assert.equal(view.context.auctionHistoryNextCursor, null);
  assert.equal(view.button.hidden, true);
  assert.equal(view.button.disabled, false);
});

test('retry clears the error only after success and blocks a duplicate in-flight request', async () => {
  let calls = 0;
  let resolvePage;
  const view = historyPage(() => {
    calls++;
    return new Promise(resolve => {resolvePage = resolve;});
  });
  view.button.textContent = 'Nie udało się pobrać — spróbuj ponownie';
  const pending = view.context.loadOlder();
  await view.context.loadOlder();
  assert.equal(calls, 1);
  assert.equal(view.button.textContent, 'Ładowanie…');
  assert.equal(view.button.disabled, true);
  resolvePage({records:[],snapshots:[],nextCursor:'NEXT-CURSOR'});
  await pending;
  assert.equal(view.button.textContent, 'Załaduj starsze zapisy');
  assert.equal(view.context.auctionHistoryNextCursor, 'NEXT-CURSOR');
  assert.equal(view.button.hidden, false);
  assert.equal(view.button.disabled, false);
});
