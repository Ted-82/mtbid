'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{applyApprovedCost}=require('../sync/feed-approved-cost.cjs');
const {accountAllowance}=require('../sync/feed-account-budget.cjs');
const now=Date.parse('2026-11-26T15:30:00Z');
test('owner authorization adds exactly five million writes to each billing cycle without changing usage',async()=>{
 const policy={version:2,billingDay:6,days:[]},state={accountBudget:policy};
 const plain=accountAllowance(policy,'2026-11-06','2026-11-26');
 const receipt={version:1,scope:'monthly-account-usage',monthlyTotalUsd:8,d1WriteUsd:5,authorizedAt:new Date(now-1000).toISOString()};
 const store={task:async()=>({status:'complete',cursor:JSON.stringify(receipt)})};
 assert.equal((await applyApprovedCost({state,store,now})).enabled,true);
 assert.equal(accountAllowance(policy,'2026-11-06','2026-11-26').writeLimit,plain.writeLimit+5000000);
 assert.equal(accountAllowance(policy,'2026-12-06','2026-12-20').writeLimit-accountAllowance({...policy,additionalWriteBudgetUsd:0},'2026-12-06','2026-12-20').writeLimit,5000000);
});
test('missing, excessive, future or incomplete authorization cannot enable spending',async()=>{
 for(const change of [{d1WriteUsd:6},{monthlyTotalUsd:9},{authorizedAt:'2030-01-01T00:00:00Z'},{scope:'other'}]){
  const state={accountBudget:{version:2}},p={version:1,scope:'monthly-account-usage',monthlyTotalUsd:8,d1WriteUsd:5,authorizedAt:new Date(now-1000).toISOString(),...change};
  const result=await applyApprovedCost({state,store:{task:async()=>({status:'complete',cursor:JSON.stringify(p)})},now});
  assert.equal(result.enabled,false);assert.equal(state.accountBudget.additionalWriteBudgetUsd,undefined);
 }
});
