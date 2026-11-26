'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {isProvenReconcileNoise}=require('../sync/feed-reconcile-noise.cjs');
const {planInventoryChangeGroup}=require('../sync/inventory-change-group.cjs');
const VIN='1HGCM82633A004352',PRIMARY='pricing.current_bid_usd',AT='2026-11-04T20:00:00.000Z';
const raw=(sequence=1,before=null,after=0)=>({sequence,event_id:'noise-'+sequence,event:'bid.changed',terminal:false,
 vehicle:{platform:'copart',lot_number:'59093416',vin:VIN},changed_fields:[PRIMARY],before:{[PRIMARY]:before},after:{[PRIMARY]:after},
 recorded_at:'2026-11-04T19:59:00.000Z',vehicle_updated_at:'2026-11-04T19:59:00.000Z'});
const group=(events=[raw()])=>({platform:'copart',lot:'59093416',events,quarantinedSequences:[]});
const accepts=g=>isProvenReconcileNoise(g,{queued:false});
const row=()=>({listing_id:'one',source_key:'source',platform:'copart',lot:'59093416',vin_normalized:VIN,identity_state:'resolved',
 source_updated_at:'2026-11-03T12:00:00Z',summary_synced_at:null,detail_synced_at:null,last_seen_at:null,updated_at:null,
 auction_state:'open',source_status:'Open',auction_at:null,is_timed:0,timed_end_at:null,current_bid_usd:1300,current_bid2_usd:25,buy_now_usd:2500});
test('explicit empty primary transitions plus validated known auxiliary fields are eligible for no-revival only',()=>{
 for(const before of [null,0])for(const after of [null,0])assert.equal(accepts(group([raw(1,before,after)])),true);
 const e=raw();for(const [field,before,after]of [['pricing.previous_bid_usd',1000,1300],['auction.upcoming',false,true],['details.source_sale_type',null,'Timed']]){
  e.changed_fields.push(field);e.before[field]=before;e.after[field]=after;
 }const g=group([e,raw(2,0,null)]),original=structuredClone(g);assert.equal(accepts(g),true);assert.deepEqual(g,original);
 const plan=planInventoryChangeGroup({row:row(),events:g.events,observedAt:AT});assert.equal(plan.statement,null);assert.equal(plan.requiresDetail,false);assert.equal(plan.eventCount,2);assert.equal(plan.lastSequence,2);
});
test('newly queued work and missing explicit queued proof always retain eligibility path',()=>{
 for(const options of [undefined,{}, {queued:true},{queued:null},{queued:0}])assert.equal(isProvenReconcileNoise(group(),options),false);
});
test('true positive clear, positive bid, absent before and secondary price always retain eligibility',()=>{
 for(const [before,after]of [[1300,0],[1300,null],[null,25],[25,10]])assert.equal(accepts(group([raw(1,before,after)])),false);
 const absent=raw();delete absent.before[PRIMARY];assert.equal(accepts(group([absent])),false);
 const other=raw();other.after['pricing.current_bid2_usd']=0;assert.equal(accepts(group([other])),false);
 const clear=planInventoryChangeGroup({row:row(),events:[raw(1,1300,null)],observedAt:AT});assert.equal(clear.assignments.current_bid_usd,null);
});
test('only explicitly present buy-now NULL to NULL is price noise, alone or with primary empty noise',()=>{
 const field='pricing.buy_now_usd';
 const e=raw();e.changed_fields.push(field);e.before[field]=null;e.after[field]=null;
 const g=group([e]),copy=structuredClone(g);assert.equal(accepts(g),true);assert.deepEqual(g,copy);
 const plan=planInventoryChangeGroup({row:{...row(),buy_now_usd:null},events:g.events,observedAt:AT});assert.equal(plan.statement,null);
 for(const [before,after]of [[1000,null],[null,1000],[0,null],[null,0],[0,0],[1000,1000]]){
  const changed=structuredClone(e);changed.before[field]=before;changed.after[field]=after;assert.equal(accepts(group([changed])),false);
 }
 for(const side of ['before','after']){const missing=structuredClone(e);delete missing[side][field];assert.equal(accepts(group([missing])),false);}
 const flag=structuredClone(e);flag.after['auction.is_buy_now']=false;assert.equal(accepts(group([flag])),false);
 const only=structuredClone(e);delete only.before[PRIMARY];delete only.after[PRIMARY];only.changed_fields=[field];only.event='buy_now.changed';assert.equal(accepts(group([only])),true);
 assert.equal(isProvenReconcileNoise(group([only]),{queued:true}),false);
 for(const [before,after]of [[1000,null],[null,1000],[0,null],[null,0],[0,0],[1000,1000]]){
  const changed=structuredClone(only);changed.before[field]=before;changed.after[field]=after;assert.equal(accepts(group([changed])),false);
 }
 for(const side of ['before','after']){const missing=structuredClone(only);delete missing[side][field];assert.equal(accepts(group([missing])),false);}
 assert.equal(isProvenReconcileNoise(g,{queued:true}),false);
 const actualClear=structuredClone(e);actualClear.before[field]=2500;
 const clearing=planInventoryChangeGroup({row:row(),events:[actualClear],observedAt:AT});assert.equal(clearing.assignments.buy_now_usd,null);assert.equal(accepts(group([actualClear])),false);
});
test('record, quarantine, identity conflict, unknown identity retain original path',()=>{
 for(const change of [g=>g.events[0].record={},g=>g.quarantinedSequences.push(1),g=>g.events[0].vehicle.vin=null,
  g=>g.events.push({...raw(2),vehicle:{...raw().vehicle,vin:'1HGCM82633A004353'}}),g=>g.events[0].vehicle.platform='iaai']){
  const g=group();change(g);assert.equal(accepts(g),false);
 }
 const unknown=planInventoryChangeGroup({row:null,events:group().events,observedAt:AT});assert.equal(unknown.requiresDetail,true);assert.equal(isProvenReconcileNoise(group(),{queued:unknown.requiresDetail}),false);
});
test('state, schedule, terminal, unsupported and outcome metadata are outside narrow optimization',()=>{
 for(const [field,value]of [['auction.state','Open'],['auction.auction_at',AT],['details.color','Red'],['auction.sold_timed',true],['pricing.buy_now_usd',null]]){
  const e=raw();e.changed_fields.push(field);e.after[field]=value;assert.equal(accepts(group([e])),false);
 }
 for(const kind of ['lot.created','lot.sold','auction.ended','auction.rescheduled']){
  const e=raw();e.event=kind;e.terminal=kind==='lot.sold';assert.equal(accepts(group([e])),false);
 }
});
test('invalid numeric and auxiliary domains are rejected even when canonical version guards might ignore event',()=>{
 for(const value of [-1,NaN,Infinity,'0',{},undefined]){const e=raw();e.before[PRIMARY]=value;assert.equal(accepts(group([e])),false);}
 for(const [field,value]of [['pricing.previous_bid_usd',-1],['pricing.previous_bid_usd','25'],['auction.upcoming','true'],['details.source_sale_type','bad\u0000text']]){
  const e=raw();e.after[field]=value;assert.equal(accepts(group([e])),false);
 }
});
test('duplicate/order/parser failures retain path; no primary signal is not classified by this optimization',()=>{
 assert.equal(accepts(group([raw(),raw()])),false);const e=raw();e.recorded_at='invalid';assert.equal(accepts(group([e])),false);
 const aux=raw();aux.changed_fields=['auction.upcoming'];aux.before={'auction.upcoming':false};aux.after={'auction.upcoming':true};assert.equal(accepts(group([aux])),false);
});
