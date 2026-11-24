'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {replayBid,timedBidReplay} = require('../staging/timed-bid-replay.cjs');
const link = 'https://test.invalid/audyt/cena-timed';

test('dated Timed replay applies the verified individual bid and keeps the final price unknown', () => {
  const result = replayBid();
  assert.equal(result.vin,'WAUC4DF58JA064291');
  assert.equal(result.sequence,118801774);
  assert.equal(result.before,8000);
  assert.equal(result.bid,8100);
  assert.equal(result.finalPrice,null);
  assert.equal(result.observedAt,'2026-11-24T20:07:24.000Z');
});

test('staging distinguishes the historical bid from a sale', async () => {
  const response = timedBidReplay(new Request(link));
  const html = await response.text();
  assert.equal(response.status,200);
  assert.match(html,/Odtworzenie na kopii z 24 listopada 2026/);
  assert.match(html,/21:07:24/);
  assert.match(html,/Cena sprzedaży w tej obserwacji pozostaje niepotwierdzona/);
  assert.equal(await timedBidReplay(new Request(link, {method:'HEAD'})).text(),'');
});
