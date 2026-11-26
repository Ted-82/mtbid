'use strict';

// Bounded recovery of legacy missing LOTs. Known rows remain outside this path,
// independently of optional active-detail eligibility and the global stream.
const {randomUUID}=require('node:crypto');
const {D1SyncRepository}=require('./d1-repository.js');
const {saveAutomaticObservation}=require('./automatic-refresh.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
const SCAN_KEY='server-feed-missing-scan',SCAN_LIMIT=20,HOUR=3600000,DAY=24*HOUR;
const iso=n=>new Date(n).toISOString();
const fullVin=value=>typeof value==='string'&&/^[A-HJ-NPR-Z0-9]{17}$/i.test(value);
const fail=code=>{throw Error(code);};
const codeOf=error=>error?.code||error?.message;
const IDENTITY=new Set(['FEED_MISSING_IDENTITY_INVALID','FEED_MISSING_IDENTITY_MISMATCH','AUTOMATIC_REFRESH_IDENTITY_INVALID',
 'AUTOMATIC_REFRESH_IDENTITY_MISMATCH','CANONICAL_IDENTITY_INVALID','AMBIGUOUS_PLATFORM_LOT','KNOWN_TARGET_CHANGED',
 'PLATFORM_LOT_VIN_MISMATCH','DETAIL_TARGET_MISMATCH','NEGATIVE_PROVIDER_PRICE','SOURCE_VERSION_TIME_INVALID']);
const BUDGET=new Set(['AUTOMATIC_REFRESH_BUDGET_STOP','AUTOMATIC_REFRESH_RUN_LIMIT','AUTOMATIC_REFRESH_DAY_CHANGED',
 'AUTOMATIC_REFRESH_QUOTA_RESERVE','SERVER_FEED_API_AUTH_BLOCKED','SERVER_FEED_API_RATE_PAUSED']);
const SYSTEM=new Set(['AUTH','CONFIGURATION','RATE_LIMITED','TIMEOUT','UPSTREAM','INVALID_REQUEST','INVALID_RESPONSE',
 'AUTOMATIC_REFRESH_RESPONSE_INVALID','SERVER_FEED_API_RESPONSE']);
function taskGuard(db,task,id,{absent=false,budgetKey=null}={}){
 return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
  SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform IS ? AND listing_id IS NULL AND cursor IS ?
   AND status='pending' AND next_due_at IS ? AND last_attempt_at IS ? AND failures IS ? AND last_error_code IS ?)
  ${absent?'AND NOT EXISTS(SELECT 1 FROM auction_listings WHERE platform=? AND lot=?)':''}
  ${budgetKey?'AND EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key=? AND consumed<limit_count)':''}
  THEN 1 ELSE 0 END)`).bind(id,task.task_key,task.platform,task.cursor,task.next_due_at,task.last_attempt_at,task.failures,task.last_error_code,
  ...(absent?[task.platform,task.cursor]:[]),...(budgetKey?[budgetKey]:[]));
}
const cleanup=(db,id)=>db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id);
const renew=(db,store,now)=>db.prepare('UPDATE automatic_refresh_state SET lease_until=? WHERE singleton=1 AND lease_owner=? AND lease_until>?')
 .bind(iso(now+10*60000),store.owner,iso(now));
async function postpone(db,store,task,now,code,identity=false,delay=HOUR){
 const id=randomUUID();await store.guarded([taskGuard(db,task,id),renew(db,store,now),
  db.prepare("UPDATE automatic_refresh_tasks SET status=?,next_due_at=?,last_attempt_at=?,failures=failures+1,last_error_code=? WHERE task_key=?")
   .bind(identity?'identity_error':'pending',iso(now+delay),iso(now),code,task.task_key),cleanup(db,id)]);
}
async function processMissingFeedReconciliation({db,store,request,adapter=createApibaraProvider(),now=store?.now?.bind(store),maxRequests=2}={}){
 if(!db?.prepare||!db?.batch||store?.db!==db||!store.owner||typeof store.guarded!=='function'||typeof now!=='function'
  ||typeof request!=='function'||typeof adapter.vehicleDetailRecord!=='function'||!Number.isSafeInteger(maxRequests)||maxRequests<0||maxRequests>2)
  fail('FEED_MISSING_CONFIG_INVALID');
 const report={scanned:0,attempted:0,completed:0,deferred:0,failed:0,identityErrors:0,reason:null};
 if(!maxRequests)return report;
 const started=now(),day=iso(started).slice(0,10),budgetKey=`new:${day}`;
 const scan=await db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').bind(SCAN_KEY).first();
 if(scan&&(scan.platform!=='all'||scan.listing_id!==null||scan.status!=='scan'||typeof scan.cursor!=='string'
  ||scan.cursor!==''&&!/^reconcile:[^\u0000-\u001f]{1,220}$/.test(scan.cursor)))fail('FEED_MISSING_SCAN_INVALID');
 const readWindow=after=>db.prepare(`SELECT t.*,EXISTS(SELECT 1 FROM auction_listings l WHERE l.platform=t.platform AND l.lot=t.cursor) AS known
  FROM automatic_refresh_tasks t WHERE t.task_key GLOB 'reconcile:*' AND t.task_key>? ORDER BY t.task_key LIMIT ?`).bind(after,SCAN_LIMIT).all();
 let rows=(await readWindow(scan?.cursor||'')).results;
 if(!Array.isArray(rows))fail('FEED_MISSING_READ_INVALID');
 if(!rows.length&&scan?.cursor)rows=(await readWindow('')).results;
 if(!Array.isArray(rows)||rows.length>SCAN_LIMIT)fail('FEED_MISSING_READ_INVALID');
 const repo=new D1SyncRepository(db);let after=rows.length?scan?.cursor||'':'';
 for(const task of rows){
  if(report.attempted>=maxRequests)break;
  report.scanned++;after=task.task_key;
  if(task.known||task.listing_id!==null||task.status!=='pending'||!Number.isFinite(Date.parse(task.next_due_at))||Date.parse(task.next_due_at)>now())continue;
  if(!['copart','iaai'].includes(task.platform)||typeof task.cursor!=='string'||!/^\d{1,20}$/.test(task.cursor)
    ||task.task_key!==`reconcile:${task.platform}:${task.cursor}`){
   await postpone(db,store,task,now(),'FEED_MISSING_IDENTITY_INVALID',true,7*DAY);report.identityErrors++;continue;
  }
  if(iso(now()).slice(0,10)!==day)fail('AUTOMATIC_REFRESH_DAY_CHANGED');
  const budget=await db.prepare('SELECT consumed,limit_count FROM automatic_refresh_budgets WHERE budget_key=?').bind(budgetKey).first();
  if(!budget||budget.consumed>=budget.limit_count){report.deferred++;report.reason='new_listing_budget';break;}
  try{
   const id=randomUUID();await store.guarded([taskGuard(db,task,id,{absent:true,budgetKey}),renew(db,store,now()),cleanup(db,id)]);
   report.attempted++;
   const obtained=await request({operation:'vehicleByIdentifier',identifier:task.cursor,platform:task.platform},null);
   const observedAt=obtained?.observedAt,raw=adapter.vehicleDetailRecord(obtained?.response);
   if(typeof observedAt!=='string'||!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>now())fail('FEED_MISSING_OBSERVATION_TIME_INVALID');
   if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.platform!==task.platform
    ||String(raw.lot_number??raw.lot??'')!==task.cursor||!fullVin(raw.vin))fail('FEED_MISSING_IDENTITY_MISMATCH');
   // The absence/admission check runs before the canonical writer's statements.
   // It also prevents a newly appeared known row from being refreshed in a race.
   const insertionStore=Object.create(store);
   insertionStore.guarded=statements=>{
    if(iso(now()).slice(0,10)!==day)fail('AUTOMATIC_REFRESH_DAY_CHANGED');
    const guardId=randomUUID();return store.guarded([taskGuard(db,task,guardId,{absent:true,budgetKey}),...statements,cleanup(db,guardId)]);
   };
   const saved=await saveAutomaticObservation({db,store:insertionStore,repo,adapter,report:{inserted:0,updated:0,skipped:0},now},raw,task.platform,observedAt,null,record=>{
    if(record?.vehicle?.platform!==task.platform||record.vehicle.lot!==task.cursor||!fullVin(record.vehicle.vin)||!record.identity?.listingId)
     fail('FEED_MISSING_IDENTITY_MISMATCH');
    return[db.prepare('UPDATE auction_listings SET detail_synced_at=? WHERE listing_id=?').bind(observedAt,record.identity.listingId),
     db.prepare("UPDATE automatic_refresh_tasks SET listing_id=?,status='complete',next_due_at=?,last_attempt_at=?,last_success_at=?,failures=0,last_error_code=NULL WHERE task_key=?")
      .bind(record.identity.listingId,iso(now()+DAY),observedAt,observedAt,task.task_key)];
   });
   if(saved.saved)report.completed++;
   else{await postpone(db,store,task,now(),'FEED_MISSING_DEFERRED');report.deferred++;}
  }catch(error){
   const code=codeOf(error);
   // A possibly committed canonical transaction must never get a guessed retry checkpoint.
   if(code==='AUTOMATIC_REFRESH_WRITE_FAILED'||code==='FEED_MISSING_READ_INVALID')throw error;
   if(IDENTITY.has(code)){await postpone(db,store,task,now(),code,true,7*DAY);report.identityErrors++;continue;}
   if(code==='NOT_FOUND'){await postpone(db,store,task,now(),code,false,7*DAY);report.failed++;continue;}
   if(SYSTEM.has(code))await postpone(db,store,task,now(),code);
   if(BUDGET.has(code)||SYSTEM.has(code))throw error;
   throw error;
  }
 }
 const id=randomUUID(),at=iso(now());
 await store.guarded([db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
  (? IS NULL AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)) OR EXISTS(
   SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='scan' AND cursor IS ?)
  THEN 1 ELSE 0 END)`).bind(id,scan?.cursor??null,SCAN_KEY,SCAN_KEY,scan?.cursor??null),
  db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,status)
   VALUES(?,'all',?,?,?,'scan') ON CONFLICT(task_key) DO UPDATE SET cursor=excluded.cursor,next_due_at=excluded.next_due_at,last_attempt_at=excluded.last_attempt_at`)
   .bind(SCAN_KEY,after,at,at),cleanup(db,id)]);
 return report;
}
module.exports={processMissingFeedReconciliation,SCAN_KEY,SCAN_LIMIT};