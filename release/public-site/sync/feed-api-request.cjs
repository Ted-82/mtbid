'use strict';
const {createApibaraProvider,buildRequestUrl,ProviderError}=require('../providers/apibara.js');
const {parseUsage}=require('./automatic-refresh.cjs');
const {recoveryBudget,recoveryAttemptCount,REFRESH_ATTEMPTS}=require('./feed-api-recovery-budget.cjs');
const DAY=86400000;
const GAP_LIMITS=[500,100,25];
function fail(code){throw Object.assign(Error(code),{code});}
const canonicalTime=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
 &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
// Read at most four indexed attempts. Any unrelated request, unknown outcome,
// success, other status, or changed cursor keeps the ordinary500-page policy.
// The state comparison binds old failure evidence to the current gap; it is not
// an additional request allowance and never alters quota, backoff or the cursor.
async function safeAdaptiveGapLimit({db,committedSequence,updatedAt}={}){
 if(!db?.prepare||!Number.isSafeInteger(committedSequence)||committedSequence<0||!canonicalTime(updatedAt))return 500;
 const response=await db.prepare(`SELECT operation,attempted_at,completed_at,outcome,http_status,error_code
  FROM automatic_refresh_attempts INDEXED BY automatic_refresh_attempts_time
  WHERE attempted_at>? AND EXISTS(SELECT 1 FROM server_feed_state
   WHERE singleton=1 AND committed_sequence=? AND updated_at=? AND active_generation IS NULL)
  ORDER BY attempted_at DESC LIMIT 4`).bind(updatedAt,committedSequence,updatedAt).all();
 const rows=response?.results;
 if(!Array.isArray(rows)||rows.length<2||rows.length>4)return 500;
 if(rows.some(row=>row.operation!=='vehicleChanges'||row.outcome!=='error'||row.http_status!==500||row.error_code!=='UPSTREAM'
  ||!canonicalTime(row.attempted_at)||!canonicalTime(row.completed_at)||row.attempted_at<=updatedAt||row.completed_at<row.attempted_at))return 500;
 return rows.length===4?25:100;
}
// Shared account reservation precedes every request, including quota lookup.
// No retries here: the queue retries after backoff with a new counted attempt.
async function countedFeedRequest({env,db,store,now=store.now.bind(store),fetchImpl=fetch,checkpointOnly=false}={}){
 if(typeof checkpointOnly!=='boolean')fail('SERVER_FEED_API_CONFIG');
 const adapter=createApibaraProvider({fetch:fetchImpl,console:{info(){},warn(){},error(){}}});
 const health=await db.prepare('SELECT status,next_due_at,last_error_code FROM automatic_refresh_tasks WHERE task_key=?').bind('server-api-health').first();
 if(health?.status==='blocked')fail('SERVER_FEED_API_AUTH_BLOCKED');
 if(health?.status==='paused'&&Date.parse(health.next_due_at)>now())fail('SERVER_FEED_API_RATE_PAUSED');
 await store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
 const recovery=checkpointOnly?null:await recoveryBudget({env,db,store,now});
 async function refreshQuota(){
  const{response,observedAt}=await request({operation:'apiUsage'},true),quota=parseUsage(response,10000);
  await store.guarded([db.prepare('UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=?,quota_used=?,quota_left=?,quota_allowance=?,quota_plan=? WHERE singleton=1')
   .bind(observedAt,quota.limit,quota.used,quota.left,quota.allowance,quota.plan)]);
  if(!quota.allowance)fail('AUTOMATIC_REFRESH_QUOTA_RESERVE');
 }
 async function request(spec,quotaRefresh=false){
  if(!['apiUsage','vehicleChanges','vehicleByIdentifier'].includes(spec?.operation))fail('SERVER_FEED_API_OPERATION');
  if(checkpointOnly&&spec.operation!=='apiUsage'&&!(spec.operation==='vehicleChanges'&&spec.after===0&&spec.limit===1))fail('SERVER_FEED_API_CONFIG');
  if(spec.operation==='vehicleChanges'&&!(checkpointOnly&&spec.after===0&&spec.limit===1)&&!GAP_LIMITS.includes(spec.limit))fail('SERVER_FEED_API_CONFIG');
  if(recovery&&spec.operation==='vehicleChanges'){
   const previous=await store.state();
   if(!previous.quota_checked_at||Date.parse(previous.quota_checked_at)<=now()-DAY
    ||await recoveryAttemptCount(db,previous.quota_checked_at)>=REFRESH_ATTEMPTS)await refreshQuota();
  }
  if(spec.operation!=='apiUsage'){
   const quota=await store.state();
   if(!quota.quota_checked_at||Date.parse(quota.quota_checked_at)<=now()-DAY)fail('AUTOMATIC_REFRESH_QUOTA_RESERVE');
   const attempts=recovery&&spec.operation==='vehicleChanges'
    ?{count:await recoveryAttemptCount(db,quota.quota_checked_at)}
    :await db.prepare('SELECT COUNT(*) AS count FROM automatic_refresh_attempts WHERE attempted_at>=?').bind(quota.quota_checked_at).first();
   if(!Number.isSafeInteger(attempts?.count)||attempts.count<0)fail('SERVER_FEED_API_QUOTA_INVALID');
   const remaining=Math.min(quota.quota_allowance,quota.quota_left-1-attempts.count-10000);
   if(remaining<=0)fail('AUTOMATIC_REFRESH_QUOTA_RESERVE');
   await store.guarded([db.prepare('UPDATE automatic_refresh_state SET quota_allowance=MIN(quota_allowance,?) WHERE singleton=1').bind(remaining)]);
  }
  const attempt=recovery&&(spec.operation==='vehicleChanges'||spec.operation==='apiUsage'&&quotaRefresh)
   ?await recovery.reserve(spec):await store.reserve(spec,null,spec.operation==='apiUsage');
  if(!attempt)fail('AUTOMATIC_REFRESH_BUDGET_STOP');
  let response;
  try{
   if(spec.operation!=='vehicleChanges')response=await adapter.request(env,spec);
   else{
    if(!env.APIBARA_API_KEY)fail('SERVER_FEED_API_CONFIG');
    // The gap reducer validates the complete contract, retaining malformed VIN
    // evidence in quarantine instead of losing the whole response at transport.
    const changesUrl=new URL(buildRequestUrl(spec));
    changesUrl.searchParams.set('include_record','created');
    let obtained;
    try{obtained=await fetchImpl(changesUrl,{redirect:'manual',signal:AbortSignal.timeout(20000),
     headers:{Accept:'application/json','X-API-Key':env.APIBARA_API_KEY}});}catch(error){
      throw new ProviderError('apibara',['AbortError','TimeoutError'].includes(error?.name)?'TIMEOUT':'UPSTREAM',null,60);}
    if(!obtained.ok){await obtained.body?.cancel();const status=obtained.status;
     const text=obtained.headers.get('retry-after')||'',seconds=/^\d+$/.test(text)?Number(text):60;
     const retryAfter=Number.isSafeInteger(seconds)?Math.max(1,Math.min(86400,seconds)):60;
     throw new ProviderError('apibara',status===410?'CURSOR_EXPIRED':status===401||status===403?'AUTH':status===429?'RATE_LIMITED':'UPSTREAM',status,retryAfter);}
    if(!obtained.body)fail('SERVER_FEED_API_RESPONSE');
    const reader=obtained.body.getReader(),parts=[];let size=0;
    try{while(true){const{done,value}=await reader.read();if(done)break;if((size+=value.byteLength)>4*1024*1024)fail('SERVER_FEED_API_SIZE');parts.push(value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    try{response=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,size)));}catch{fail('SERVER_FEED_API_RESPONSE');}
   }
   if(!adapter.responseOk(response)||response?.response?.ok===false)fail('SERVER_FEED_API_RESPONSE');
  }catch(caught){
   const error=caught instanceof ProviderError||/^SERVER_FEED_API_[A-Z_]+$/.test(caught?.code||'')
    ?caught:new ProviderError('apibara',['AbortError','TimeoutError'].includes(caught?.name)?'TIMEOUT':'UPSTREAM',null,60);
   if(error.code==='RATE_LIMITED')error.retryAfter=Number.isSafeInteger(error.retryAfter)?Math.max(1,Math.min(86400,error.retryAfter)):60;
   if(spec.operation==='vehicleChanges')error.requestLimit=spec.limit;
   await store.finishAttempt(attempt,error);
   if(['AUTH','CONFIGURATION','RATE_LIMITED'].includes(error?.code)){
    const blocked=error.code!=='RATE_LIMITED',seconds=Number.isFinite(error.retryAfter)?Math.max(60,Math.min(86400,error.retryAfter)):60;
    await store.guarded([store.taskStatement({key:'server-api-health',platform:'all',due:now()+seconds*1000,
     status:blocked?'blocked':'paused',error:error.code})]);
   }
   throw error;
  }
  // A lost finish acknowledgement must not rewrite a possibly committed success.
  await store.finishAttempt(attempt);return{response,observedAt:new Date(now()).toISOString()};
 }
 const state=await store.state();
 if(!state.quota_checked_at||Date.parse(state.quota_checked_at)<=now()-DAY
  ||recovery&&await recoveryAttemptCount(db,state.quota_checked_at)>=REFRESH_ATTEMPTS)await refreshQuota();
 else if(state.quota_left<=10000||state.quota_allowance<=0)fail('AUTOMATIC_REFRESH_QUOTA_RESERVE');
 const countedRequest=spec=>request(spec);
 Object.defineProperty(countedRequest,'recoveryActive',{value:!!recovery,writable:false,configurable:false,enumerable:true});
 return countedRequest;
}
module.exports={countedFeedRequest,safeAdaptiveGapLimit};
