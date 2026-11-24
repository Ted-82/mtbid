'use strict';
const UNMETERED_WRITES_PER_DAY=160000, UNMETERED_READS_PER_DAY=120000000;
const DAY_MS=86400000;
const STORAGE_RESERVE=8000000;
const MAX_CATALOG_BYTES=8000000000;
const PUBLISH_WRITES_PER_DAY=1_100_000;
const fail=()=>{throw Error('SERVER_FEED_ACCOUNT_POLICY_INVALID');};
function utcDay(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return NaN;
 const date=new Date(day+'T00:00:00Z');
 return Number.isFinite(+date)&&date.toISOString().slice(0,10)===day?+date:NaN;
}
function renewal(policy,firstDay){
 const start=new Date(firstDay+'T00:00:00Z');
 return Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,policy.billingDay);
}
function parseAccountBudget(env,version=1){
 let p;try{p=JSON.parse(env.REXBID_FEED_ACCOUNT_BUDGET);}catch{fail();}
 if(!p||p.version!==version||!Array.isArray(p.days)||p.days.length>31||!Number.isFinite(Date.parse(p.measuredAt))
  ||!Number.isSafeInteger(p.databaseMaxBytes)||p.databaseMaxBytes<1||p.databaseMaxBytes>MAX_CATALOG_BYTES)fail();
 if(version===2&&(!Number.isInteger(p.billingDay)||p.billingDay<1||p.billingDay>28))fail();
 if(p.prioritizePublication!==undefined&&(version!==2||typeof p.prioritizePublication!=='boolean'))fail();
 if(p.writeMeter!==undefined){
  const meter=p.writeMeter,from=utcDay(meter?.from),through=utcDay(meter?.through);
  if(version!==2||!Number.isFinite(from)||!Number.isFinite(through)||new Date(from).getUTCDate()!==p.billingDay
   ||through<from||through>=renewal(p,meter.from)||Date.parse(p.measuredAt)<through+DAY_MS
   ||!Number.isSafeInteger(meter.outsideWrites)||meter.outsideWrites<0||meter.outsideWrites>50_000_000)fail();
 }
 const seen=new Set();for(const d of p.days){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.day)||!Number.isFinite(Date.parse(d.day+'T00:00:00Z'))||seen.has(d.day)
   ||!Number.isSafeInteger(d.writes)||d.writes<0||!Number.isSafeInteger(d.reads)||d.reads<0)fail();
  seen.add(d.day);
 }
 return p;
}
function accountWindowStart(policy,day){
 const at=Date.parse(day+'T00:00:00Z'),date=new Date(at);
 if(policy?.version!==2)return new Date(at-30*DAY_MS).toISOString().slice(0,10);
 // Count the entire renewal day in both cycles because the account meter is aggregated by UTC date.
 const month=date.getUTCMonth()-Number(date.getUTCDate()<=policy.billingDay);
 return new Date(Date.UTC(date.getUTCFullYear(),month,policy.billingDay)).toISOString().slice(0,10);
}
function accountAllowance(policy,firstDay,day){
 const included=policy.days.filter(d=>d.day>=firstDay&&d.day<=day);
 let writes=0,reads=0;
 if(policy.version===2){
  const days=(renewal(policy,firstDay)-utcDay(firstDay))/DAY_MS+1;
  writes=days*UNMETERED_WRITES_PER_DAY;
  reads=days*UNMETERED_READS_PER_DAY;
 }
 const meter=policy.writeMeter;
 // Closed dates already have an account-wide estimate for outside-ledger
 // writes. Only uncovered dates need the daily reserve. Unsettled reservations
 // still count in D1. Never carry a measurement into a different billing cycle.
 const reconciled=!!meter&&meter.from===firstDay&&meter.through<day;
 if(reconciled){
  writes=meter.outsideWrites+(renewal(policy,firstDay)-utcDay(meter.through))/DAY_MS*UNMETERED_WRITES_PER_DAY;
 }
 for(const entry of included){
  if(!reconciled||entry.day>meter.through)writes+=Math.max(0,entry.writes-(policy.version===2?UNMETERED_WRITES_PER_DAY:0));
  reads+=Math.max(0,entry.reads-(policy.version===2?UNMETERED_READS_PER_DAY:0));
 }
 // In addition to estimated traffic outside the ledger, retain 1M writes and 2B reads.
 return {writeLimit:Math.max(0,49000000-writes),readLimit:Math.max(0,23000000000-reads)};
}
function allowSupplementalWrites(policy,window){
 if(!policy?.prioritizePublication)return true;
 if(!window)return false;
 const days=(renewal(policy,window.firstDay)-utcDay(window.day))/DAY_MS+1;
 return window.writeLimit-window.writes>=days*PUBLISH_WRITES_PER_DAY;
}
function assertAccountStorage(policy,bytes){
 if(!Number.isSafeInteger(bytes)||bytes<=0)fail();
 // Per-run reserve avoids crossing the cap within a bounded 970-statement job.
 if(bytes+STORAGE_RESERVE>policy.databaseMaxBytes)throw Error('SERVER_FEED_STORAGE_BUDGET_STOP');
}
module.exports={parseAccountBudget,accountWindowStart,accountAllowance,allowSupplementalWrites,assertAccountStorage,STORAGE_RESERVE};
