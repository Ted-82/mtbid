'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBootstrapDeltaExtension}=require('../sync/feed-bootstrap-delta.cjs');
const {planInventoryChangeGroup}=require('../sync/inventory-change-group.cjs');
const AT='2026-11-01T13:00:00.000Z',OLD='2026-10-31T12:00:00.000Z',EVENT='2026-11-01T12:00:00.000Z',VIN='1HGCM82633A004352';
const base=(extra={})=>({listing_id:'listing-1',source_key:'source-1',platform:'copart',lot:'10000001',vin_normalized:VIN,identity_state:'resolved',provider:'apibara',source_platform:'copart',source_identity_state:'resolved',source_updated_at:OLD,summary_synced_at:OLD,detail_synced_at:null,last_seen_at:OLD,updated_at:OLD,auction_state:'open',source_status:'Open',auction_at:null,is_timed:0,timed_end_at:null,current_bid_usd:50,current_bid2_usd:null,buy_now_usd:1000,...extra});
const event=(sequence,after={'pricing.current_bid_usd':99},extra={})=>({sequence,event_id:'chg_'+sequence,event:'bid.changed',terminal:false,vehicle:{platform:'copart',lot_number:'10000001',vin:VIN},before:{},after,changed_fields:Object.keys(after),recorded_at:EVENT,vehicle_updated_at:EVENT,...extra});
function harness(prior=[]){
 const calls={queries:[],fragments:[]},store={},db={prepare(sql){return{bind(...params){return{async all(){calls.queries.push({sql,params});return{results:structuredClone(prior)};}};}};}};
 const membership={db,store,async deltaFragmentStatements(input){calls.fragments.push(input);return{statements:[1,2,3,4]};}};
 return {calls,db,store,membership,extension:createBootstrapDeltaExtension({membership,baselineId:'fresh-1',after:100,through:900})};
}
async function run(h,events,{row=base(),identityError=false,quarantinedSequences=[]}={}){
 const group={platform:'copart',lot:'10000001',events,quarantinedSequences},plan=planInventoryChangeGroup({row,events,quarantinedSequences,observedAt:AT});
 return h.extension.prepare({db:h.db,store:h.store,receipt:{groups:[group],batchSha256:'a'.repeat(64),observedAt:AT},decisions:[{}],plannedRows:[{platform:group.platform,lot:group.lot,row,afterRow:identityError?row:row?{...row,...plan.assignments}:null,identityError,requiresDetail:plan.requiresDetail,plan}]});
}
const last=h=>h.calls.fragments.at(-1);

test('bid-only existing member remains unchanged; absent historical Open row is unresolved and never revived',async()=>{
 const existing=harness([{listing_id:'listing-1',active:1,last_sequence:100}]);await run(existing,[event(200)]);assert.deepEqual(last(existing).changes,[]);assert.equal(last(existing).unresolvedCount,0);
 const absent=harness();assert.deepEqual(await run(absent,[event(200)]),[1,2,3,4]);assert.deepEqual(last(absent).changes,[]);assert.equal(last(absent).unresolvedCount,1);assert.match(absent.calls.queries[0].sql,/WHERE baseline_id=\? AND listing_id IN/);
});
test('fresh explicit equal Open is eligible, while stale Open/terminal events preserve existing membership',async()=>{
 const h=harness();await run(h,[event(200,{'auction.state':'Open'})]);assert.equal(last(h).changes[0].active,true);assert.equal(last(h).changes[0].sequence,200);
 const newer=base({source_updated_at:AT,summary_synced_at:AT,last_seen_at:AT});const prior=harness([{listing_id:'listing-1',active:1,last_sequence:100}]);await run(prior,[event(200,{}, {event:'lot.sold',terminal:true})],{row:newer});assert.deepEqual(last(prior).changes,[]);assert.equal(last(prior).unresolvedCount,0);
 const staleAbsent=harness();await run(staleAbsent,[event(200,{'auction.state':'Open'})],{row:newer});assert.deepEqual(last(staleAbsent).changes,[]);assert.equal(last(staleAbsent).unresolvedCount,1);
});
test('accepted terminal removes known membership, and unknown terminal never invents a canonical row',async()=>{
 const h=harness([{listing_id:'listing-1',active:1,last_sequence:100}]);await run(h,[event(200,{}, {event:'lot.sold',terminal:true})]);assert.equal(last(h).changes[0].active,false);assert.equal(last(h).changes[0].expected.auctionState,'ended');
 const unknown=harness();await run(unknown,[event(200,{}, {event:'lot.removed',terminal:true})],{row:null});assert.deepEqual(last(unknown).changes,[]);assert.equal(last(unknown).unresolvedCount,0);
});
test('identity errors/quarantine and unresolved eligibility are counted, never replaced with an empty success',async()=>{
 for(const options of [{identityError:true},{quarantinedSequences:[200]}]){const h=harness();await run(h,[event(200)],options);assert.equal(last(h).unresolvedCount,1);assert.deepEqual(last(h).changes,[]);}
 const h=harness();await run(h,[event(200,{'auction.state':'mystery','pricing.current_bid_usd':99})]);assert.equal(last(h).unresolvedCount,1);assert.deepEqual(last(h).changes,[]);
});
test('fresh complete created record needs exact hydrated version/state; older source or newer canonical observation cannot revive',async()=>{
 const record={platform:'copart',lot_number:'10000001',vin:VIN,updated_at:EVENT,auction:{state:'Open'},pricing:{current_bid_usd:99,current_bid2_usd:null,buy_now_usd:1000}};
 const input=event(200,{}, {event:'lot.created',record});
 const h=harness();await run(h,[input],{row:base({source_updated_at:EVENT,summary_synced_at:EVENT,last_seen_at:EVENT})});assert.equal(last(h).changes[0].active,true);
 for(const row of [base({source_updated_at:AT,summary_synced_at:AT,last_seen_at:AT}),base({source_updated_at:EVENT,summary_synced_at:EVENT,last_seen_at:AT}),base({source_updated_at:EVENT,summary_synced_at:EVENT,last_seen_at:EVENT,auction_state:'ended'})]){const h=harness();await run(h,[input],{row});assert.deepEqual(last(h).changes,[]);assert.equal(last(h).unresolvedCount,1);}
 const incomplete=harness();await run(incomplete,[event(200,{}, {event:'lot.created',record:{...record,pricing:{}}})],{row:base({source_updated_at:EVENT,summary_synced_at:EVENT,last_seen_at:EVENT})});assert.equal(last(incomplete).unresolvedCount,1);
});
test('later accepted terminal overrides created full record; conflicting later eligibility remains unresolved',async()=>{
 const h=harness();await run(h,[event(200,{'auction.state':'Open'}),event(300,{}, {event:'lot.sold',terminal:true})]);assert.equal(last(h).changes[0].active,false);assert.equal(last(h).changes[0].sequence,300);
 const bad=harness();await run(bad,[event(200,{'auction.state':'Open'}),event(300,{'auction.state':'mystery','pricing.current_bid_usd':70})]);assert.equal(last(bad).unresolvedCount,1);assert.deepEqual(last(bad).changes,[]);
});
test('extension validates exact scope and immutable input; a newer membership sequence is preserved',async()=>{
 const h=harness([{listing_id:'listing-1',active:0,last_sequence:800}]);await run(h,[event(200,{'auction.state':'Open'})]);assert.deepEqual(last(h).changes,[]);assert.equal(last(h).unresolvedCount,0);
 assert.equal(h.extension.key,'membership:fresh-1');assert.throws(()=>createBootstrapDeltaExtension({membership:h.membership,baselineId:'fresh-1',after:900,through:100}));
 await assert.rejects(h.extension.prepare({db:{},store:h.store,receipt:{groups:[]}}),/DELTA_INVALID/);
});
test('reducer eligibility evidence leaves legacy assignments intact, ignores stale evidence and suppresses group identity conflicts',()=>{
 const fresh=planInventoryChangeGroup({row:base(),events:[event(200,{'auction.state':'Open'})],observedAt:AT});assert.equal(fresh.statement,null);assert.deepEqual(fresh.assignments,{});assert.equal(fresh.acceptedEligibility.active,true);
 const stale=planInventoryChangeGroup({row:base({summary_synced_at:AT,last_seen_at:AT}),events:[event(200,{'auction.state':'Open'})],observedAt:AT});assert.equal(stale.acceptedEligibility,null);
 const conflict=event(300);conflict.vehicle.vin='SALZP2FX8PH185647';assert.equal(planInventoryChangeGroup({row:base(),events:[event(200,{'auction.state':'Open'}),conflict],observedAt:AT}).acceptedEligibility,null);
});

test('a missing changed eligibility value remains unresolved even for an existing member',async()=>{
 const h=harness([{listing_id:'listing-1',active:1,last_sequence:100}]);
 await run(h,[event(200,{}, {changed_fields:['auction.state']})]);assert.equal(last(h).unresolvedCount,1);assert.deepEqual(last(h).changes,[]);
});
