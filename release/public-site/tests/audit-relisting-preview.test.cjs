'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readReplay,stagingReplay}=require('../staging/relisting-replay.cjs');
const url='https://rexbid-audit-staging.tedn828.workers.dev/audyt/ponowne-wystawienie';
test('the frozen staging replay derives eligibility and amounts from the identified source observations',()=>{
  const result=readReplay();
  assert.equal(result.previouslyVisible,false);
  assert.equal(result.previousDate,null);
  assert.equal(result.vin,'1B7GG32X82S697320');
  assert.equal(result.lot,'65917836');
  assert.equal(result.generation,23248);
  assert.equal(result.sequence,118299636);
  assert.equal(result.eligible,true);
  assert.equal(result.auctionAt,'2026-12-01T02:00:00.000Z');
  assert.equal(result.bid,225);
  assert.equal(result.buyNow,468);
});
test('staging replay identifies the observation as historic and HEAD sends no body',async()=>{
  const response=stagingReplay(new Request(url));
  const html=await response.text();
  assert.equal(response.status,200);
  assert.match(html,/Odtworzenie zmiany z 24 listopada 2026 na kopii/);
  assert.match(html,/1 grudnia 2026.*03:00 czasu polskiego/);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(await stagingReplay(new Request(url,{method:'HEAD'})).text(),'');
});
