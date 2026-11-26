'use strict';
// A durable owner authorization adds a bounded monetary allowance to each
// account cycle. It never resets consumed rows or raises any provider API pool.
async function applyApprovedCost({state,store,now}){
 if(state.accountBudget?.version!==2)return {enabled:false};
 const row=await store.task('feed-approved-cost:v1');if(row?.status!=='complete')return {enabled:false};
 let p;try{p=JSON.parse(row.cursor);}catch{return {enabled:false,reason:'invalid_authorization'};}
 if(p?.version!==1||p.scope!=='monthly-account-usage'||p.monthlyTotalUsd!==8||p.d1WriteUsd!==5||
  !Number.isFinite(Date.parse(p.authorizedAt))||Date.parse(p.authorizedAt)>now)return {enabled:false,reason:'invalid_authorization'};
 state.accountBudget.additionalWriteBudgetUsd=p.d1WriteUsd;
 return {enabled:true,d1WriteUsd:p.d1WriteUsd,monthlyTotalUsd:p.monthlyTotalUsd,otherReserveUsd:p.monthlyTotalUsd-p.d1WriteUsd};
}
module.exports={applyApprovedCost};
