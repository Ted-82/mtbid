'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planInventoryChangeGroup}=require('../sync/inventory-change-group.cjs');
const {BASELINE_FIELDS}=require('../sync/inventory-change-patch.cjs');
const VIN='1FTFW6L83TFA85737',LOT='46208127',AT='2026-11-18T21:10:54.201Z';
const row=()=>({...Object.fromEntries(BASELINE_FIELDS.map(k=>[k,null])),listing_id:'listing-test',source_key:'source-test',platform:'iaai',lot:LOT,vin_normalized:VIN,identity_state:'resolved',auction_state:'ended',source_status:'Ended',is_timed:0,current_bid_usd:21300,buy_now_usd:null,source_updated_at:'2026-11-12T12:57:09Z',summary_synced_at:'2026-11-12T12:57:09Z',last_seen_at:'2026-11-12T12:57:09Z',updated_at:'2026-11-12T12:57:09Z'});
const event=()=>({sequence:105297387,event_id:'chg_105297387',event:'auction.rescheduled',terminal:false,vehicle:{platform:'iaai',lot_number:LOT,vin:VIN},recorded_at:'2026-11-18T21:05:34Z',vehicle_updated_at:'2026-11-18T21:05:34Z',before:{},after:{'auction.auction_at':'2026-11-25T13:30:00Z','auction.is_buy_now':1,'pricing.buy_now_usd':30075,'auction.has_status':0,'auction.last_sold_day':null,'auction.last_sold_status':null,'pricing.last_sold_price_usd':null,'auction.auction_date_pending':false}});
const run=(r,e)=>{e.changed_fields=Object.keys(e.after);return planInventoryChangeGroup({row:r,events:[e],observedAt:AT});};
test('verified IAAI result reset reopens the lot and restores date/buy-now without changing bid or freshness',()=>{
 const e=event(),original=JSON.stringify(e.after),p=run(row(),e);assert.equal(p.assignments.auction_state,'open');assert.equal(p.assignments.source_status,'Open');assert.equal(p.assignments.buy_now_usd,30075);assert.equal(p.assignments.auction_at,'2026-11-25T13:30:00.000Z');assert.equal(p.acceptedEligibility.active,true);assert.equal(p.requiresDetail,false);assert.equal(p.assignments.current_bid_usd,undefined);assert.equal(p.assignments.last_seen_at,undefined);assert.equal(JSON.stringify(e.after),original);
});
for(const kind of ['missing_result_reset','already_sold','past_date','removed','copart','extra_field'])test('does not infer reopening for '+kind,()=>{
 const r=row(),e=event();if(kind==='missing_result_reset')delete e.after['auction.last_sold_status'];if(kind==='already_sold')e.after['auction.has_status']=1;if(kind==='past_date')e.after['auction.auction_at']='2026-11-17T13:30:00Z';if(kind==='removed')r.source_status='Removed';if(kind==='copart'){r.platform='copart';e.vehicle.platform='copart';}if(kind==='extra_field')e.after['auction.lot_removed']=1;assert.notEqual(run(r,e).assignments.auction_state,'open');
});
