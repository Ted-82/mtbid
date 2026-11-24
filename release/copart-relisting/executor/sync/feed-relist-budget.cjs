'use strict';
const DAY=86400000;
function relistWorkFits({window,storageBytes,storageLimit,usage,remainingStatements}){
 // Existing reservation: the absolute account guard is checked before work and all
 // actual SQL use is settled against that same reservation. Keep at least two
 // publication days plus this invocation, and 64 MB of catalog storage in reserve.
 return window && Number.isSafeInteger(window.writes)&&Number.isSafeInteger(window.writeLimit)&&
  window.writeLimit-window.writes>=2205000&&window.readLimit-window.reads>=100000&&
  Number.isSafeInteger(storageBytes)&&storageBytes>0&&storageLimit-storageBytes>=64000000&&
  !usage.unknown&&usage.rowsWritten<800&&usage.rowsRead<12000&&remainingStatements>=160;
}
function relistRequestCapacity({quota,budgets,now}){
 const day=new Date(now).toISOString().slice(0,10),period=day.slice(0,7);
 const left=(key)=>{const entry=budgets.find(r=>r.budget_key===key);
  return entry && Number.isSafeInteger(entry.limit_count)&&Number.isSafeInteger(entry.consumed)?Math.max(0,entry.limit_count-entry.consumed):0;};
 const age=now-Date.parse(quota?.quota_checked_at);
 if(!Number.isFinite(age)||age<0||age>DAY||!Number.isSafeInteger(quota?.quota_allowance)||!Number.isSafeInteger(quota?.quota_left))return 0;
 // Leave room inside the already approved ledger for source gaps and ordinary
 // detail work. Cap the actual calls including identity fallbacks, not just lots.
 return Math.max(0,Math.min(8,left('day:'+day)-100,left('month:'+period)-1000,
  quota.quota_allowance,quota.quota_left-30000));
}
module.exports={relistWorkFits,relistRequestCapacity};
