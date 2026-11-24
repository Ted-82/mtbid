'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {LIMITS,COSTS,classifyServerFeedGroup:kind,selectServerFeedGroups:select}=require('../sync/feed-server-batch-policy.cjs');
const group=(id,extra={})=>({platform:'iaai',lot:String(id),quarantinedSequences:[],events:[{event:'bid.changed',terminal:false,
 changed_fields:['pricing.current_bid_usd'],before:{'pricing.current_bid_usd':100},after:{'pricing.current_bid_usd':200},...extra}]});
const many=(n,extra)=>Array.from({length:n},(_,i)=>group(i,extra));
test('activated 300 validated price groups preserve exact prefix and fixed reservation ceilings',()=>{
 const groups=many(401),r=select({groups,activated:true});assert.equal(r.groups.length,300);assert.equal(r.nextOffset,300);
 assert.deepEqual(r.estimate,{rowsWritten:4144,rowsRead:11700,statements:460});assert.equal(r.reason,'group_limit');
 r.groups.forEach((g,i)=>assert.equal(g,groups[i]));assert.equal(LIMITS.statements,970);assert.equal(LIMITS.rowsWritten,5000);
 assert.equal(LIMITS.rowsRead,50000);assert.equal(LIMITS.baselineGuardBytes,1500000);
});
test('buy-now and secondary prices use safe12-write class without changing their values',()=>{
 for(const field of ['pricing.buy_now_usd','pricing.current_bid2_usd']){
  const g=group(1,{event:'buy_now.changed',changed_fields:[field],before:{[field]:null},after:{[field]:0}});
  assert.equal(kind(g),'price');assert.equal(g.events[0].after[field],0);
 }assert.equal(COSTS.price.rowsWritten,12);
});
test('complex prefix budgets include current measured usage and both fixed reserves',()=>{
 const groups=many(300,{event:'lot.removed',terminal:true});
 const r=select({groups,activated:true,usage:{rowsWritten:1000,rowsRead:100,statements:30},priorWork:true});
 assert.equal(r.groups.length,54);assert.deepEqual(r.projectedUsage,{rowsWritten:5000,rowsRead:16024,statements:244});
 assert.equal(r.reason,'budget_headroom');assert.equal(r.groups[53],groups[53]);
});
test('mixed prefix stops before unaffordable next group, never skips it for cheaper later groups',()=>{
 const groups=[group(1),group(2,{event:'lot.removed',terminal:true}),group(3,{record:{media:'large'}}),group(4)];
 const r=select({groups,activated:true,usage:{rowsWritten:4252},priorWork:true});assert.equal(r.groups.length,3);
 assert.equal(r.nextOffset,3);assert.equal(r.projectedUsage.rowsWritten,5000);assert.deepEqual(r.classes,{price:1,complex:1,record:1});
});
test('full record groups use conservative hydration weights and <=40 record bound',()=>{
 const r=select({groups:many(100,{record:{media:'x'.repeat(2100000)}}),activated:true});
 assert.equal(r.groups.length,34);assert.equal(r.classes.record,34);assert.equal(r.estimate.rowsWritten,4896);
 assert.equal(r.estimate.rowsRead,36916);assert.equal(r.estimate.statements,840);assert.ok(r.classes.record<=40);
 // Raw media was accepted by the historical one-record hydration path and is
 // not a new 2MB whole-file rejection at this selection-only seam.
 assert.equal(r.groups[0].events[0].record.media.length,2100000);
});
test('100k event ceiling is inclusive and cannot split a complete vehicle group',()=>{
 const a=group(1),b=group(2);a.events=Array(99999).fill(a.events[0]);b.events=Array(2).fill(b.events[0]);
 const r=select({groups:[a,b],activated:true});assert.deepEqual(r.groups,[a]);assert.equal(r.events,99999);assert.equal(r.reason,'event_limit');
 a.events.push(a.events[0]);assert.equal(select({groups:[a],activated:true}).events,100000);
});
test('invalid/unsupported/quarantined/state evidence is always conservatively complex',()=>{
 for(const g of [null,{},group(1,{after:{'pricing.current_bid_usd':'2'}}),group(1,{terminal:0}),
  group(1,{event:'auction.rescheduled'}),group(1,{changed_fields:['pricing.current_bid_usd','auction.last_sold_at'],
   after:{'pricing.current_bid_usd':1,'auction.last_sold_at':'2026-11-04T12:00:00Z'}}),
  {...group(1),quarantinedSequences:[12]},group(1,{changed_fields:['pricing.current_bid_usd','unknown.field']}),
  group(1,{after:{'pricing.current_bid_usd':1,hidden:'bad'}})])assert.equal(kind(g),'complex');
 assert.equal(kind(group(1,{record:{}})),'record');
});
test('auxiliary validation is narrow, including invalid calendar time and flags',()=>{
 for(const [value,expected] of [['2026-11-04T12:00:00Z','price'],['2026-02-30T12:00:00Z','complex']]){
  assert.equal(kind(group(1,{changed_fields:['pricing.current_bid_usd','pricing.current_bid_at'],
   after:{'pricing.current_bid_usd':1,'pricing.current_bid_at':value}})),expected);
 }assert.equal(kind(group(1,{changed_fields:['pricing.current_bid_usd','auction.upcoming'],
  after:{'pricing.current_bid_usd':1,'auction.upcoming':2}})),'complex');
});
test('zero headroom after prior work requests continuation, fresh exhaustion fails explicitly',()=>{
 const input={groups:many(3),activated:true,usage:{rowsWritten:5000},priorWork:true};const r=select(input);
 assert.equal(r.groups.length,0);assert.equal(r.nextOffset,0);assert.equal(r.needContinuation,true);
 assert.throws(()=>select({...input,priorWork:false}),/HEADROOM_INSUFFICIENT/);
 assert.throws(()=>select({...input,usage:{unknown:true},priorWork:false}),/USAGE_UNKNOWN/);
 assert.equal(select({...input,usage:{unknown:true}}).needContinuation,true);
});
test('read and970-statement headroom independently limit the selected prefix',()=>{
 assert.equal(select({groups:many(20),activated:true,usage:{rowsRead:47868},priorWork:true}).groups.length,1);
 assert.equal(select({groups:many(20),activated:true,usage:{statements:809},priorWork:true}).groups.length,1);
});
test('legacy selection is literally100 and does not add new source or usage validation',()=>{
 const groups=many(150,{terminal:true});for(const activated of [false,undefined,'enabled']){
  const r=select({groups,offset:7,activated,usage:{unknown:true,rowsWritten:-1}});
  assert.deepEqual(r.groups,groups.slice(7,107));assert.equal(r.nextOffset,107);assert.equal(r.estimate,null);
 }assert.equal(select({groups:[],activated:true}).nextOffset,0);
});
test('malformed usage or offset never silently grants budget or drops source',()=>{
 for(const usage of [{rowsWritten:-1},{rowsRead:NaN},{statements:1.5},{unknown:'false'}])
  assert.throws(()=>select({groups:many(1),activated:true,usage}),/USAGE_INVALID/);
 assert.throws(()=>select({groups:many(1),offset:2}),/SELECTION_INVALID/);
});
