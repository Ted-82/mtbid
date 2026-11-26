'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planInventoryChangeGroup}=require('../sync/inventory-change-group.cjs');
const event={sequence:120217745,event_id:'chg_120217745',event:'auction.rescheduled',terminal:false,reason:null,
  vehicle:{id:4588630,platform:'iaai',platform_id:2,lot_number:'45516116',vin:'1FTNX21S11EA69796'},
  changed_fields:['auction.auction_at'],before:{'auction.auction_at':'2026-11-24T15:30:00+00:00','auction.auction_date_pending':false},
  after:{'auction.auction_at':'2026-12-03T05:30:00+00:00','auction.auction_date_pending':false},
  vehicle_updated_at:'2026-11-25T09:22:26+02:00',recorded_at:'2026-11-25T07:22:26+00:00'};
const oldDate='2026-11-24T15:30:00.000Z', newDate='2026-12-03T05:30:00.000Z';
const oldSeen='2026-11-24T18:00:28.000Z', received='2026-11-25T07:40:51.461Z';
function fixture(overrides={}) {
  return {listing_id:'fixture-ford',source_key:'fixture-source',platform:'iaai',lot:event.vehicle.lot_number,vin_normalized:event.vehicle.vin,identity_state:'resolved',
    auction_state:'live',source_status:'in_progress',is_timed:0,timed_end_at:null,auction_at:oldDate,source_updated_at:oldSeen,summary_synced_at:oldSeen,detail_synced_at:null,
    last_seen_at:oldSeen,updated_at:oldSeen,current_bid_usd:null,current_bid2_usd:null,buy_now_usd:null,...overrides};
}
function plan(row,record=event,observedAt=received) {
  return planInventoryChangeGroup({row,events:[record],observedAt,trackTimedBid:true});
}
test('23864 IAAI Ford date assignment replaces the stale session label without synthesising membership, a bid or a sale',()=>{
  const row=fixture(), first=plan(row);
  assert.deepEqual(first.assignments,{auction_state:'open',source_status:'Open',auction_at:newDate});
  assert.equal(first.acceptedEligibility,null); assert.equal(first.requiresDetail,false);
  assert.equal(first.confirmedTimedSales,undefined); assert.equal(first.lateBidObservations,undefined);
  assert.ok(first.statement.sql.startsWith('UPDATE auction_listings SET'));
  assert.ok(first.match.sql.includes('EXISTS'));
  const replay=plan({...row,...first.assignments}); assert.equal(replay.statement,null);
  assert.equal(plan(fixture({auction_at:newDate})).assignments.source_status,'Open');
});
test('a date alone cannot reopen a terminal, pending, Timed, different or later observed session',()=>{
  for(const [row,record,at] of [
    [fixture({auction_state:'ended',source_status:'Sold'})], [fixture({is_timed:1,timed_end_at:oldDate})],
    [fixture({auction_at:'2026-11-27T18:05:00Z'})], [fixture({last_seen_at:'2026-11-25T07:25:00Z'})],
    [fixture(),{...event,after:{...event.after,'auction.auction_date_pending':true}}],
    [fixture(),{...event,vehicle:{...event.vehicle,vin:'2HGFA16598H000001'}}],
    [fixture(),event,'2026-12-03T05:05:00Z']
  ]) {
    const result=plan(row,record,at);
    assert.notEqual(result.assignments.auction_state,'open');
    assert.equal(result.confirmedTimedSales,undefined);
  }
});

test('ordinary Live-only transitions preserve a same-session assigned start or a still-running Timed deadline',()=>{
  const start='2026-11-25T07:00:00.000Z', end='2026-11-25T07:50:00.000Z';
  const stateChange={...event,event:'lot.updated',before:{'auction.lot_sub_status':'Open'},after:{'auction.lot_sub_status':'Live'},changed_fields:['auction.lot_sub_status']};
  const regular=fixture({auction_state:'open',source_status:'scheduled',auction_at:start});
  const timed=fixture({...regular,auction_at:null,source_status:'Open',is_timed:1,timed_end_at:end});
  const merge=(row,record=stateChange)=>({...row,...plan(row,record).assignments});
  assert.equal(merge(regular).auction_state,'live');
  assert.equal(merge(regular).auction_at,start);
  assert.equal(merge(timed).is_timed,1);
  assert.equal(merge(timed).timed_end_at,end);
  assert.equal(merge({...regular,auction_at:oldDate}).auction_at,null);
  assert.equal(merge({...regular,auction_at:newDate}).auction_at,null);
  assert.equal(merge({...regular,source_status:'unscheduled'}).auction_at,null);
  assert.equal(merge({...timed,timed_end_at:oldDate}).timed_end_at,null);
  const clearing={...stateChange,changed_fields:[...stateChange.changed_fields,'auction.auction_at'],after:{...stateChange.after,'auction.auction_at':null}};
  assert.equal(merge(regular,clearing).auction_at,null);
});
