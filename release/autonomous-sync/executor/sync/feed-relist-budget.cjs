'use strict';
const DAY=86400000;
// Keep capacity for other consumers of the shared ledger; the account limits
// themselves and the separate inventory recovery budget are unchanged.
const DAILY_SHARED_RESERVE=50;
function relistWorkFits({window,storageBytes,storageLimit,usage,remainingStatements}){
 // Existing reservation: the absolute account guard is checked before work and all
 // actual SQL use is settled against that same reservation. Keep at least two
 // publication days plus this invocation, and 64 MB of catalog storage in reserve.
 return window && Number.isSafeInteger(window.writes)&&Number.isSafeInteger(window.writeLimit)&&
  window.writeLimit-window.writes>=2205000&&window.readLimit-window.reads>=100000&&
  Number.isSafeInteger(storageBytes)&&storageBytes>0&&storageLimit-storageBytes>=64000000&&
  !usage.unknown&&usage.rowsWritten<800&&usage.rowsRead<42000&&remainingStatements>=160;
}
function relistLedgerKeys(now){
 const date=new Date(now).toISOString().slice(0,10);
 return ['day:'+date,'month:'+date.slice(0,7)];
}
function ledgerCapacity(budgets,now,missing){
 const [day,month]=relistLedgerKeys(now);
 function room(key,reserve){
  const entry=budgets.find(r=>r.budget_key===key);
  if(!entry) return missing;
  if(!Number.isSafeInteger(entry.limit_count)||!Number.isSafeInteger(entry.consumed)) return 0;
  return Math.max(0,entry.limit_count-entry.consumed-reserve);
 }
 return Math.min(room(day,DAILY_SHARED_RESERVE),room(month,1000));
}
function providerCapacity(quota,now,unknown){
 const age=now-Date.parse(quota?.quota_checked_at);
 if(!Number.isFinite(age)||age<0||age>DAY||!Number.isSafeInteger(quota?.quota_allowance)||!Number.isSafeInteger(quota?.quota_left))return unknown;
 const reserve=Number.isSafeInteger(quota.quota_limit)&&quota.quota_limit>0
  ?Math.max(1000,Math.ceil(quota.quota_limit*.1)):30000;
 return Math.max(0,Math.min(quota.quota_allowance,quota.quota_left-reserve));
}
async function alreadyAtRelistReserve(db,now){
 const rows=(await db.prepare(`SELECT b.budget_key,b.limit_count,b.consumed,
   s.quota_checked_at,s.quota_allowance,s.quota_left,s.quota_limit FROM automatic_refresh_state s
   LEFT JOIN automatic_refresh_budgets b ON b.budget_key IN (?,?) WHERE s.singleton=1`)
   .bind(...relistLedgerKeys(now)).all()).results;
 // Missing rows at UTC rollover and an expired provider reading must still allow initialization.
 const quota=rows[0],mayRefresh=now-Date.parse(quota?.quota_checked_at)>=DAY;
 return Math.min(ledgerCapacity(rows,now,Infinity),mayRefresh?Infinity:providerCapacity(quota,now,Infinity))===0;
}
function relistRequestCapacity({quota,budgets,now}){
 // Leave room inside the already approved ledger for source gaps and ordinary
 // detail work. Cap the actual calls including identity fallbacks, not just lots.
 return Math.min(8,ledgerCapacity(budgets,now,0),providerCapacity(quota,now,0));
}
module.exports={relistWorkFits,relistRequestCapacity,alreadyAtRelistReserve};
