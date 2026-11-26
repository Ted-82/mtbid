'use strict';
const DAY=86400000;
// A provider reporting date is never treated as the subscription renewal.
// With no authenticated renewal field, spread remaining resources over 31 days.
function allocation({quota,pending,now,renewal}) {
 const age=now-Date.parse(quota?.quota_checked_at);
 if(!Number.isFinite(age)||age<0||age>DAY||!Number.isSafeInteger(pending)||pending<0||
    !Number.isSafeInteger(quota?.quota_left)||!Number.isSafeInteger(quota?.quota_limit)||
    !Number.isSafeInteger(quota?.quota_allowance))return null;
 const reserve=Math.max(1000,Math.ceil(quota.quota_limit*.1));
 const usable=Math.max(0,Math.min(quota.quota_allowance,quota.quota_left-reserve));
 const until=Date.parse(renewal),days=Number.isFinite(until)&&until>now&&until-now<=32*DAY?Math.max(1,Math.ceil((until-now)/DAY)):31;
 const sustainable=Math.floor(usable/days);
 const burst=Math.min(Math.ceil(pending/7),Math.floor(usable/7));
 const daily=Math.min(usable,Math.max(sustainable,burst));
 return {usable,reserve,daily,pending,catchingUp:pending>daily,renewalKnown:days!==31||Number.isFinite(until)};
}
async function configureQuota(store,db,now) {
 const quota=await store.state();
 const row=await db.prepare("SELECT count(*) AS pending FROM (SELECT 1 FROM automatic_refresh_tasks WHERE task_key>='feed-verify-relist:v1:' AND task_key<'feed-verify-relist:v1:~' AND status='pending' LIMIT 5000)").bind().first();
 let pending=row?.pending;
 const monitor=await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='sync_monitor_samples'").bind().first();
 if(monitor){
  const sample=await db.prepare('SELECT measured_at,pending FROM sync_monitor_samples ORDER BY slot DESC LIMIT 1').bind().first();
  if(sample&&now-Date.parse(sample.measured_at)>=0&&now-Date.parse(sample.measured_at)<1800000&&Number.isSafeInteger(sample.pending)&&sample.pending>=0)
   pending=Math.max(pending||0,sample.pending);
 }
 const period=await store.task('feed-adaptive-provider-period:v1');
 let renewal;
 try{renewal=JSON.parse(period?.cursor)?.subscriptionTo;}catch{}
 const plan=allocation({quota,pending,now,renewal});
 if(!plan)return null;
 const at=new Date(now).toISOString(),keys=['day:'+at.slice(0,10),'month:'+at.slice(0,7)];
 const budgets=await store.budgets(),day=budgets.find(x=>x.budget_key===keys[0]),month=budgets.find(x=>x.budget_key===keys[1]),newBudget=budgets.find(x=>x.budget_key==='new:'+at.slice(0,10));
 if(!day||!month)return null;
 let catchup=null;
 if(plan.pending>0&&typeof renewal==='string'&&/^\d{4}-\d\d-\d\d$/.test(renewal)&&Date.parse(renewal)>now){
  const key='relist-catchup:'+renewal;
  // One non-resetting grant per authenticated provider period. Keep half the
  // usable pool for future ordinary operations, in addition to the quota reserve.
  await store.guarded([db.prepare('INSERT INTO automatic_refresh_budgets(budget_key,limit_count,consumed,created_at,updated_at) VALUES(?,?,0,?,?) ON CONFLICT(budget_key) DO NOTHING')
    .bind(key,Math.floor(plan.usable/2),at,at)]);
  const row=await db.prepare('SELECT limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key=?').bind(key).first();
  if(Number.isSafeInteger(row?.limit_count)&&Number.isSafeInteger(row?.consumed)&&row.limit_count>=row.consumed)
   catchup={key,limit:row.limit_count,consumed:row.consumed,remaining:row.limit_count-row.consumed};
 }
 store.catchupBudgetKey=catchup?.remaining>0?catchup.key:null;
 const dayLimit=catchup?.remaining>0?Math.max(plan.daily,day.consumed+Math.min(catchup.remaining,plan.usable)):plan.daily;
 // Extend existing consumed ledgers under their shared lease. Never reset usage.
 // The provider quota guard still precedes every actual request.
 const newLimit=Math.max(newBudget?.consumed||0,plan.pending,Math.ceil(plan.daily*20));
 await store.guarded([
  db.prepare('UPDATE automatic_refresh_budgets SET limit_count=?,updated_at=? WHERE budget_key=?')
    .bind(Math.max(day.consumed,Math.min(dayLimit,day.consumed+plan.usable)),at,keys[0]),
  db.prepare('UPDATE automatic_refresh_budgets SET limit_count=?,updated_at=? WHERE budget_key=?')
    .bind(month.consumed+plan.usable,at,keys[1]),
  db.prepare('UPDATE automatic_refresh_budgets SET limit_count=?,updated_at=? WHERE budget_key=?')
    .bind(newLimit,at,'new:'+at.slice(0,10)),
  store.taskStatement({key:'feed-adaptive-policy:v1',platform:'all',status:'complete',success:true,due:now+DAY,
    cursor:JSON.stringify({version:1,day:at.slice(0,10),daily:dayLimit,normalDaily:plan.daily,monthly:month.consumed+plan.usable,newPerDay:newLimit,catchup,checkedAt:at,reserve:plan.reserve})})
 ]);
 return plan;
}
module.exports={allocation,configureQuota};
