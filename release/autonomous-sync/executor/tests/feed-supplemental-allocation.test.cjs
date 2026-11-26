'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{decide}=require('../sync/feed-supplemental-allocation.cjs');
const policy={version:2,billingDay:6,prioritizePublication:true},window={firstDay:'2026-11-06',day:'2026-11-26',writeLimit:29293208,writes:23500000};
const rows=[{day_key:'2026-11-25',consumed_writes:2420810},{day_key:'2026-11-24',consumed_writes:2248211},{day_key:'2026-11-23',consumed_writes:609516}];
test('measured reserve unblocks optional work without raising the account spending limit',()=>{
 const plan=decide(policy,window,rows);assert.equal(plan.reserveWrites,4846620);assert.equal(plan.allowed,true);
 assert.equal(decide(policy,{...window,writes:window.writeLimit-plan.reserveWrites+1},rows).allowed,false);
 assert.equal(window.writeLimit,29293208);
});
test('insufficient or invalid daily evidence retains the original conservative policy',()=>{
 assert.equal(decide(policy,window,rows.slice(0,2)).allowed,false);
 assert.equal(decide(policy,window,rows.map(r=>({...r,consumed_writes:NaN}))).basis,'insufficient_measurements');
 assert.equal(decide(policy,window,rows.map(r=>({...r,consumed_writes:0}))).reserveWrites,2205000);
});
