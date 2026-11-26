'use strict';
const {allowSupplementalWrites}=require('./feed-account-budget.cjs');
function decide(policy,window,days){
 if(!policy?.prioritizePublication)return {allowed:true,reserveWrites:0,basis:'publication_priority_disabled'};
 const complete=days.filter(x=>x.day_key<window.day&&Number.isSafeInteger(x.consumed_writes)&&x.consumed_writes>=0).slice(0,3);
 if(complete.length<3)return {allowed:allowSupplementalWrites(policy,window),reserveWrites:null,basis:'insufficient_measurements'};
 // Retain two complete peak days from the last three observed days and one
 // maximum transaction. The hard account-cycle budget is never enlarged.
 const peak=Math.max(...complete.map(x=>x.consumed_writes));
 const reserveWrites=Math.max(2200000,peak*2)+5000;
 return {allowed:window.writeLimit-window.writes>=reserveWrites,reserveWrites,basis:'two_observed_peak_days',sampleDays:complete.map(x=>x.day_key)};
}
async function allocation({db,store,policy,window,now}){
 if(!policy?.prioritizePublication)return decide(policy,window,[]);
 const rows=(await db.prepare('SELECT day_key,consumed_writes FROM server_feed_daily_budgets WHERE day_key<? ORDER BY day_key DESC LIMIT 3').bind(window.day).all()).results;
 const plan=decide(policy,window,rows||[]),key='feed-supplemental-allocation:v1';
 const previous=await store.task(key);
 if(!previous?.last_success_at||now-Date.parse(previous.last_success_at)>900000){
  await store.guarded([store.taskStatement({key,platform:'all',status:'complete',success:true,due:now+900000,
   cursor:JSON.stringify({...plan,checkedAt:new Date(now).toISOString(),remainingWrites:window.writeLimit-window.writes})})]);
 }
 return plan;
}
module.exports={decide,allocation};
