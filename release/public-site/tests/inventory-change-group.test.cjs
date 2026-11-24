'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {planInventoryChangeGroup} = require('../sync/inventory-change-group.cjs');
const {BASELINE_FIELDS} = require('../sync/inventory-change-patch.cjs');
const AT = '2026-10-28T13:00:00.000Z';
const row = (extra = {}) => ({listing_id:'lot-1', source_key:'source-1',platform:'iaai',lot:'45787870',vin_normalized:'SALZP2FX8PH185647',identity_state:'resolved',
  source_updated_at:'2026-10-27T12:00:00.000Z',summary_synced_at:'2026-10-27T12:01:00.000Z',detail_synced_at:null,
  last_seen_at:'2026-10-27T12:01:00.000Z',updated_at:'2026-10-27T12:01:00.000Z',auction_state:'open',source_status:'Open',
  auction_at:'2026-10-29T12:00:00.000Z',is_timed:0,timed_end_at:null,current_bid_usd:50,current_bid2_usd:null,buy_now_usd:10000,...extra});
const event = (sequence, after = {'pricing.current_bid_usd':sequence*10}, extra = {}) => ({sequence,event_id:`chg_${sequence}`,event:'bid.changed',terminal:false,
  vehicle:{platform:'iaai',lot_number:'45787870',vin:'SALZP2FX8PH185647'},before:{},after,changed_fields:Object.keys(after),recorded_at:'2026-10-28T12:00:00Z',...extra});
const plan = (events, extra = {}) => planInventoryChangeGroup({row:row(),events,observedAt:AT,...extra});
function database(t, source) {
  const db = new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE auction_listings(${BASELINE_FIELDS.join(',')});CREATE TABLE vehicle_sources(source_key,provider,platform);`);
  db.prepare(`INSERT INTO auction_listings VALUES(${BASELINE_FIELDS.map(()=>'?').join(',')})`).run(...BASELINE_FIELDS.map(k=>source[k]));
  db.prepare('INSERT INTO vehicle_sources VALUES(?,?,?)').run(source.source_key,'apibara',source.platform);return db;
}

test('40 ordered bids become one final write with original baseline and unchanged freshness',t=>{
  const original=row(),before=structuredClone(original),events=Array.from({length:40},(_,i)=>event(i+1));
  const result=plan(events,{row:original}),db=database(t,original);
  assert.deepEqual(result.assignments,{current_bid_usd:400});assert.equal(result.eventCount,40);
  assert.equal(result.requiresDetail,false);assert.equal(result.databaseApplied,false);assert.equal(result.globalCursorEstablished,false);
  assert.equal(db.prepare(result.match.sql).get(...result.match.params).listing_id,original.listing_id);
  assert.equal(db.prepare(result.statement.sql).run(...result.statement.params).changes,1);
  const actual=db.prepare('SELECT * FROM auction_listings').get();assert.equal(actual.summary_synced_at,original.summary_synced_at);
  assert.equal(actual.current_bid_usd,400);assert.deepEqual(original,before);
});

test('net-zero prices still retain an original-state guard',t=>{
  const result=plan([event(1),event(2,{'pricing.current_bid_usd':50})]);assert.equal(result.statement,null);assert.ok(result.match);
  const db=database(t,row());db.exec('UPDATE auction_listings SET current_bid_usd=77');
  assert.equal(db.prepare(result.match.sql).get(...result.match.params),undefined);
});

test('a newer full observation is never overwritten by an old event group',()=>{
  const result=plan([event(1),event(2)],{row:row({summary_synced_at:AT,last_seen_at:AT})});
  assert.equal(result.patches,0);assert.equal(result.ignored,2);assert.equal(result.statement,null);
});

test('one unsupported field keeps its durable reconciliation requirement alongside independent price',()=>{
  const result=plan([event(1,{'auction.auction_at':'2026-10-29 12:00:00'}),event(2,{'pricing.current_bid_usd':300})]);
  assert.equal(result.requiresDetail,true);assert.deepEqual(result.assignments,{current_bid_usd:300});
  assert.ok(result.reasons.includes('unsupported_fields'));
});

test('identity conflict or explicit quarantine suppresses all writes for that vehicle',()=>{
  const conflicting=event(2);conflicting.vehicle.vin='1HGCM82633A004352';
  const result=plan([event(1),conflicting]);assert.equal(result.identityError,true);assert.equal(result.statement,null);assert.equal(result.match,null);
  const invalid=event(2);invalid.vehicle.vin='3\u001a6TRVDG1KE508499';
  const quarantined=plan([event(1),invalid],{quarantinedSequences:[2]});
  assert.equal(quarantined.identityError,true);assert.deepEqual(quarantined.assignments,{});assert.equal(quarantined.requiresDetail,true);
  assert.throws(()=>plan([invalid]));
});

test('terminal sale clears buy-now and dates after prior price changes',()=>{
  const result=plan([event(1),event(2,{}, {event:'lot.sold',terminal:true})]);
  assert.equal(result.assignments.auction_state,'ended');assert.equal(result.assignments.source_status,'Sold');
  assert.equal(result.assignments.buy_now_usd,null);assert.equal(result.assignments.auction_at,null);
});

test('absent vehicles produce one requirement; an unknown terminal event needs no invented listing',()=>{
  assert.equal(plan([event(1),event(2)],{row:null}).requiresDetail,true);
  const result=plan([event(2,{}, {event:'lot.removed',terminal:true})],{row:null});
  assert.equal(result.statement,null);assert.equal(result.requiresDetail,false);assert.equal(result.ignored,1);
});

test('mixed identities, duplicate IDs and out-of-order sequences stop the group',()=>{
  const other=event(2);other.vehicle.platform='copart';
  for(const events of [[event(2),event(1)],[event(1),event(1)],[event(1),{...event(2),event_id:'chg_1'}],[event(1),other]])
    assert.throws(()=>plan(events),/INVENTORY_GROUP_ORDER_INVALID/);
});
