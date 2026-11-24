'use strict';
const {createHash, randomUUID}=require('node:crypto');
const {RefreshStore,POLICY,saveAutomaticObservation}=require('./automatic-refresh.cjs');
const {D1SyncRepository}=require('./d1-repository.js');
const {ServerFeedState,digest}=require('./feed-server-state.cjs');
const {readPendingCapture,acknowledgeCapture,assertStorageCapacity,PREPARE_RESERVE}=require('./feed-capture-journal.cjs');
const {prepareFeedArchivePackedStep,readFeedBucket}=require('./feed-worker-archive.cjs');
const {applyFeedRecordHydration}=require('./feed-record-hydration.cjs');
const {importChangeBatch,hashReceipt,changeKeys}=require('./feed-change-import.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
const {repairFeedGap}=require('./feed-gap-repair.cjs');
const {countedFeedRequest,safeAdaptiveGapLimit}=require('./feed-api-request.cjs');
const {recordFeedEligibility,processActiveFeedReconciliation}=require('./feed-active-reconcile.cjs');
const {cleanupCompletedArchives}=require('./feed-archive-retention.cjs');
const {FeedBootstrapMembership}=require('./feed-bootstrap-membership.cjs');
const {createBootstrapDeltaExtension}=require('./feed-bootstrap-delta.cjs');
const {readBootstrapActivation}=require('./feed-bootstrap-activation.cjs');
const {TaxonomyCacheBuilder}=require('./catalog-taxonomy-cache.cjs');
const {isProvenReconcileNoise}=require('./feed-reconcile-noise.cjs');
const {selectServerFeedGroups}=require('./feed-server-batch-policy.cjs');
const {boundFeedBatchWidth}=require('./feed-server-batch-width.cjs');
const {resolveFeedWindowPlan}=require('./feed-server-window-plan.cjs');
const {releaseOwnedLease}=require('./feed-owned-lease-release.cjs');
// Reviewed control schema: normal finalization <=11 row/index writes; optional
// recovery <=19. Keep a32-write reserve; reads retain their separate100 reserve.
const SETTLEMENT_WRITE_OVERHEAD=32;
const fail=code=>{throw Object.assign(Error(code),{code});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const TARGETS={staging:'acb3cb8e-69a2-459f-8a46-0f2f5b9004be',production:'c8a30088-70af-43a6-9a7f-c4018279d37d'};
const TARGET_NAMES={staging:'rexbid-auth-test-db',production:'rexbid-production-preflight-db'};
function configuration(env){
 if(env?.REXBID_FEED_ENABLED!=='enabled')return{enabled:false};
 if(!Object.hasOwn(TARGETS,env.REXBID_FEED_TARGET)||env.REXBID_FEED_DATABASE_ID!==TARGETS[env.REXBID_FEED_TARGET]
   ||!env.REXBID_DB?.prepare||!env.REXBID_FEED_ARCHIVE?.get||!env.REXBID_FEED_QUEUE?.send||env.REXBID_FEED_ID!=='20')fail('SERVER_FEED_CONFIG_INVALID');
 return{enabled:true,target:env.REXBID_FEED_TARGET,bindingIdentity:Object.freeze({
  id:TARGETS[env.REXBID_FEED_TARGET],name:TARGET_NAMES[env.REXBID_FEED_TARGET]})};
}
function measuredDatabase(binding,trustedBindingIdentity=null){
 if(trustedBindingIdentity!==null&&!Object.keys(TARGETS).some(target=>trustedBindingIdentity?.id===TARGETS[target]
  &&trustedBindingIdentity?.name===TARGET_NAMES[target]))fail('SERVER_FEED_CONFIG_INVALID');
 const usage={rowsWritten:0,rowsRead:0,statements:0,unknown:false},control={limit:970};
 function count(n){if(usage.statements+n>control.limit)fail('SERVER_FEED_QUERY_BUDGET');usage.statements+=n;}
 function account(results){for(const result of Array.isArray(results)?results:[results]){
  if(result?.success===false)fail('SERVER_FEED_DATABASE_RESULT');
  if(!Number.isSafeInteger(result?.meta?.rows_read)||!Number.isSafeInteger(result?.meta?.rows_written)) {usage.unknown=true;continue;}
  usage.rowsRead+=result.meta.rows_read;usage.rowsWritten+=result.meta.rows_written;
 }}
 function wrap(stmt){return{native:stmt,bind(...args){return wrap(stmt.bind(...args));},
  async all(){count(1);try{const result=await stmt.all();account(result);return result;}catch(e){usage.unknown=true;throw e;}},
  async first(column){const row=(await this.all()).results?.[0]??null;return column&&row?row[column]:row;},
  async run(){count(1);try{const result=await stmt.run();account(result);return result;}catch(e){usage.unknown=true;throw e;}}};}
 const db={prepare:sql=>wrap(binding.prepare(sql)),async batch(statements){count(statements.length);try{
  const results=await binding.batch(statements.map(s=>s.native));account(results);return results;
 }catch(e){usage.unknown=true;throw e;}}};
 // Workers expose an opaque D1 binding, not the operator's live metadata API.
 // This identity comes ONLY from validated deployment configuration above.
 // Keep it distinct: it is sufficient to READ a matching activation receipt,
 // but must never masquerade as metadataVerified for a new operator activation.
 if(trustedBindingIdentity!==null)Object.defineProperties(db,{
  bindingIdentity:{value:Object.freeze({...trustedBindingIdentity}),enumerable:true},
  bindingIdentityVerified:{value:true,enumerable:true}});
 return{db,usage,control};
}
function workSpec(generationId,phase,bucketIndex=0,groupOffset=0){
 return{jobKey:`feed:${generationId}:${phase}:${bucketIndex}:${groupOffset}`,kind:'feed',payload:{generationId,phase,bucketIndex,groupOffset}};
}
async function getJob(db,key){return db.prepare('SELECT * FROM server_feed_outbox WHERE job_key=?').bind(key).first();}
function parseJob(row){
 let p;try{p=JSON.parse(row.payload_json);}catch{fail('SERVER_FEED_JOB_INVALID');}
 if(row.kind!=='feed'||!Number.isSafeInteger(p?.generationId)||p.generationId<1||!['prepare','apply','finish'].includes(p.phase)
  ||!Number.isSafeInteger(p.bucketIndex)||p.bucketIndex<0||p.bucketIndex>128||!Number.isSafeInteger(p.groupOffset)||p.groupOffset<0
  ||row.job_key!==workSpec(p.generationId,p.phase,p.bucketIndex,p.groupOffset).jobKey)fail('SERVER_FEED_JOB_INVALID');
 return p;
}
async function loadManifest(bucket,generation){
 const object=await bucket.get(generation.manifest_key);
 if(!object||object.size>1024*1024)fail('SERVER_FEED_MANIFEST_MISSING');
 const text=await object.text();if(digest(text)!==generation.manifest_sha256)fail('SERVER_FEED_MANIFEST_HASH');
 let manifest;try{manifest=JSON.parse(text);}catch{fail('SERVER_FEED_MANIFEST_INVALID');}
 if(manifest.rawSha256!==generation.sha256||manifest.rawKey!==generation.raw_key||manifest.observedAt!==generation.observed_at
  ||manifest.bucketCount!==128||manifest.firstSequence!==generation.first_sequence||manifest.lastSequence!==generation.last_sequence)fail('SERVER_FEED_MANIFEST_INVALID');
 return manifest;
}
function bucketDataset(generation,data,baselineId=null){
 const sources=[{generationId:generation.generation_id,sha256:data.bucketSha256,records:data.records,
  firstSequence:data.firstSequence,lastSequence:data.lastSequence}];
 return{identity:hash({version:1,sources}),databaseSha256:baselineId?hash({kind:'server-feed-membership',baselineId,bucketSha256:data.bucketSha256}):data.bucketSha256,sources,records:data.records,quarantined:data.quarantined,
  firstSequence:data.firstSequence,lastSequence:data.lastSequence,uniqueLots:data.uniqueLots};
}
async function receiptProof(db,taskKey){
 const row=await db.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND status='complete'").bind(taskKey).first();
 if(!row?.cursor)fail('SERVER_FEED_WRITE_RECEIPT_MISSING');return{taskKey,cursorSha256:digest(row.cursor)};
}
async function dispatchDue(env,state){
 const next=await state.getNextGeneration({readyOnly:true});if(!next)return 0;
 const phase=next.status==='downloaded'?'prepare':next.status==='applying'&&next.bucket_index===128?'finish':'apply';
 const key=workSpec(next.generation_id,phase,phase==='prepare'?0:next.bucket_index,phase==='prepare'?0:next.group_offset).jobKey;
 const job=await getJob(state.db,key);
 if(!job||!['pending','dispatched'].includes(job.status)||job.next_due_at>state.at())return 0;
 const p=parseJob(job);if(p.generationId!==next.generation_id)return 0;
 await env.REXBID_FEED_QUEUE.send({version:1,jobKey:job.job_key});
 // Resend only the canonical current checkpoint; stale outbox rows cannot
 // monopolize dispatch after a lost reply has already advanced the generation.
 await state.markDispatched(job.job_key);return 1;
}
async function pollLatest({env,state,fetchImpl,now}){
 // Owner approved this exact48h/7d completed-file retention on29Oct2026.
 await cleanupCompletedArchives({db:state.db,store:state.store,bucket:env.REXBID_FEED_ARCHIVE,now,maxGenerations:1,maxOperations:400});
 const pending=await readPendingCapture(env.REXBID_FEED_ARCHIVE);
 if(!pending)return{downloaded:false,capturedPending:0};
 if(!pending.ready)return{downloaded:false,capturePending:true,generationId:pending.generationId};
 const capture=pending.capture;
 if(capture.feedId!==Number(env.REXBID_FEED_ID))fail('SERVER_FEED_SOURCE_MISMATCH');
 const existing=await state.getGeneration(capture.generationId);
 if(existing){
  if(existing.sha256!==capture.sha256)fail('SERVER_FEED_GENERATION_CHANGED');
  await acknowledgeCapture(env.REXBID_FEED_ARCHIVE,capture);
  return{downloaded:false,generationId:capture.generationId};
 }
 const identical=await state.db.prepare('SELECT generation_id,raw_key FROM server_feed_generations WHERE sha256=?').bind(capture.sha256).first();
 if(identical){
  await acknowledgeCapture(env.REXBID_FEED_ARCHIVE,capture);
  return{downloaded:false,generationId:capture.generationId,duplicateOf:identical.generation_id};
 }
 const registered=await state.register({...capture,outbox:[workSpec(capture.generationId,'prepare')]});
 const checked=registered.generation;
 if(!checked||checked.generation_id!==capture.generationId||checked.sha256!==capture.sha256||checked.raw_key!==capture.rawKey
   ||checked.compressed_bytes!==capture.compressedBytes||checked.observed_at!==capture.observedAt)fail('SERVER_FEED_CAPTURE_UNVERIFIED');
 await acknowledgeCapture(env.REXBID_FEED_ARCHIVE,capture);
 return{downloaded:true,generationId:capture.generationId};
}
async function processJob({env,state,db,store,job,usage,now=store.now.bind(store),fetchImpl=fetch,attemptContext=null}){
 if(attemptContext)attemptContext.job=job;
 let p=parseJob(job),generation=await state.getGeneration(p.generationId);
 if(!generation)fail('SERVER_FEED_GENERATION_MISSING');
 if(generation.status==='complete'){await state.completeOutbox(job.job_key);return{alreadyApplied:true};}
 if(state.coveredByBaseline(generation)){
  await state.completeCoveredOutbox(job.job_key,generation);return{coveredByBaseline:state.activation.baselineId,
   floorSequence:state.activation.floorSequence,generationId:generation.generation_id};
 }
 const next=await state.getNextGeneration({readyOnly:true,includeJobKey:job.job_key});
 if(next?.generation_id!==p.generationId){
  // Another archive is being prepared first. Its completion dispatches this
  // deferred job; don't retain the old5min delivery timeout after acknowledging
  // the only message, or every newly captured file stalls recovery untilCron.
  await state.markDispatched(job.job_key,1000);return{deferred:true};
 }
 if(p.phase==='prepare'){
  let archiveMetrics;
  if(generation.status==='downloaded'){
   if((await state.storageUsage()).totalBytes+258*1024*1024>5*1024*1024*1024)fail('SERVER_FEED_STORAGE_BUDGET');
   let lastPulse=now(),lastReported=0;
   const prepared=await prepareFeedArchivePackedStep({bucket:env.REXBID_FEED_ARCHIVE,rawKey:generation.raw_key,rawSha256:generation.sha256,
    prefix:'prepared-packed-gzip',observedAt:generation.observed_at,limits:{operations:950},signal:AbortSignal.timeout(12*60000),
    beforePhaseWrite:async({reserveBytes})=>assertStorageCapacity({bucket:env.REXBID_FEED_ARCHIVE,reserveBytes:Math.max(PREPARE_RESERVE,reserveBytes)}),
    onProgress:async progress=>{
     if(now()-lastPulse>=30000){
      await store.guarded([db.prepare('UPDATE automatic_refresh_state SET lease_until=? WHERE singleton=1 AND lease_owner=?')
       .bind(new Date(now()+10*60000).toISOString(),store.owner)]);lastPulse=now();
     }
     if(progress.operations-lastReported>=50){lastReported=progress.operations;console.log(JSON.stringify({component:'server-feed-prepare',generationId:p.generationId,operations:progress.operations}));}
    }});
   if(prepared.pending){
    await env.REXBID_FEED_QUEUE.send({version:1,jobKey:job.job_key},{delaySeconds:1});
    await state.markDispatched(job.job_key);
    return{preparing:true,preparationPhase:prepared.phase,windowsComplete:prepared.windowsComplete,windowsTotal:prepared.windowsTotal,
     archiveMetrics:{operations:prepared.operations,gets:prepared.gets,puts:prepared.puts,archiveBytesBound:prepared.archiveBytes}};
   }
   if(prepared.manifest.records===0){
    await state.completeEmpty({generationId:p.generationId,manifestKey:prepared.manifestKey,manifestSha256:prepared.manifestSha256,
     archiveBytes:prepared.archiveBytes,manifest:prepared.manifest});
    await state.completeOutbox(job.job_key);return{empty:true,complete:true};
   }
   await state.prepare({generationId:p.generationId,manifestKey:prepared.manifestKey,manifestSha256:prepared.manifestSha256,
    firstSequence:prepared.manifest.firstSequence,lastSequence:prepared.manifest.lastSequence,
    archiveBytes:prepared.archiveBytes,
    bucketGroups:prepared.manifest.buckets.map(item=>item.uniqueLots),
    outbox:[workSpec(p.generationId,'apply')]});
   archiveMetrics={operations:prepared.operations,gets:prepared.gets,puts:prepared.puts,peakBufferedBytes:prepared.peakBufferedBytes,reused:prepared.reused,archiveBytes:prepared.archiveBytes};
  }
  await state.completeOutbox(job.job_key);return{prepared:true,archiveMetrics};
 }
 if(p.phase==='finish'){
  await state.finish(p.generationId);await state.completeOutbox(job.job_key);return{complete:true};
 }
 if(generation.status==='prepared'){
  const cursor=await state.getState();
  if(cursor&&generation.first_sequence>cursor.committed_sequence+1){
   const maxChangesLimit=await safeAdaptiveGapLimit({db,committedSequence:cursor.committed_sequence,updatedAt:cursor.updated_at});
   const request=await countedFeedRequest({env,db,store,now,fetchImpl});
   const repaired=await repairFeedGap({db,store:state.canonicalStore(),request,bucket:env.REXBID_FEED_ARCHIVE,
    targetFirstSequence:generation.first_sequence,maxChangesLimit,baselineId:state.activation?.baselineId??null});
   // Archived continuations make no provider call. Only the validated,
   // owner-authorized recovery allowance uses2s for its next new API page;
   // ordinary operation retains10s and all provider rate-limit backoff.
   const archivedContinuation=['hydrate','apply'].includes(repaired.phase);
   const nextDelay=archivedContinuation?1:request.recoveryActive===true?2:10;
   await env.REXBID_FEED_QUEUE.send({version:1,jobKey:job.job_key},{delaySeconds:nextDelay});
   await state.markDispatched(job.job_key);
   return{gapRepaired:repaired.repaired===true,gapPhase:repaired.phase,through:repaired.through,target:generation.first_sequence-1,gapPageLimit:maxChangesLimit};
  }
  generation=(await state.start(p.generationId)).generation;
 }
 if(generation.bucket_index>p.bucketIndex||generation.bucket_index===p.bucketIndex&&generation.group_offset>p.groupOffset){
  await state.completeOutbox(job.job_key);return{alreadyApplied:true};
 }
 if(generation.status!=='applying'||generation.bucket_index!==p.bucketIndex||generation.group_offset!==p.groupOffset)fail('SERVER_FEED_JOB_ORDER');
 const manifest=await loadManifest(env.REXBID_FEED_ARCHIVE,generation);
 let data=await readFeedBucket({bucket:env.REXBID_FEED_ARCHIVE,manifest,bucketIndex:p.bucketIndex,limits:{materialized:16*1024*1024}});
 let dataset=data.records?bucketDataset(generation,data,state.activation?.baselineId??null):null;const provider=createApibaraProvider();
 const canonicalStore=state.canonicalStore(),liveState=state.activation?await state.getState():null;
 const checkpointExtension=state.activation?createBootstrapDeltaExtension({membership:new FeedBootstrapMembership({db,store:canonicalStore}),
  baselineId:state.activation.baselineId,after:liveState.committed_sequence,through:generation.last_sequence}):null;
 let batches=0,bucketsVisited=1,continuationReason=null;
 do{
  if(state.activation&&usage.unknown){if(!batches)fail('SERVER_FEED_BATCH_USAGE_UNKNOWN');continuationReason='usage_unknown';break;}
  const offset=generation.group_offset,proofs=[],blockedIdentities=[];
  const select=async()=>{const selectionUsage=state.activation?{...usage,rowsWritten:usage.rowsWritten+64,rowsRead:usage.rowsRead+128,statements:usage.statements+32}:usage;
   const selected=selectServerFeedGroups({groups:data.groups,offset,activated:!!state.activation,usage:selectionUsage,priorWork:batches>0});
   return state.activation&&selected.groups.length>100?{...selected,groups:(await boundFeedBatchWidth({db,groups:selected.groups})).groups}:selected;};
  const window=state.activation&&data.groups.length?await resolveFeedWindowPlan({db,state,generation,data,dataset,offset,observedAt:manifest.observedAt,select}):await select();
  const groups=window.groups;
  if(!groups.length&&window.needContinuation){continuationReason=window.reason;break;}
  if(window.pinned&&window.origin==='selected'&&!window.coreCommitted){
   // A pinned prefix is indivisible. Defer it; never change its receipt hash.
   const admitted=selectServerFeedGroups({groups,activated:true,usage,priorWork:true});
   if(admitted.groups.length!==groups.length){continuationReason='pinned_window_headroom';break;}
  }
  if(window.pinned){const proof=await receiptProof(db,window.planKey);if(proof.cursorSha256!==hash(window.plan))fail('SERVER_FEED_WINDOW_PLAN_INVALID');proofs.push(proof);}
  const hydrationGroups=groups.filter(group=>group.events.some(event=>event.record!=null));
  for(let i=0;i<hydrationGroups.length;i+=20){
   const key=`file-hydration:${data.bucketSha256}:${offset}:${i}`;
   const hydrated=await applyFeedRecordHydration({db,store:canonicalStore,provider,groups:hydrationGroups.slice(i,i+20),observedAt:manifest.observedAt,receiptKey:key,freshnessPolicy:POLICY});
   blockedIdentities.push(...hydrated.quarantined.map(item=>`${item.platform}:${item.lot}`));
   proofs.push(await receiptProof(db,key));
  }
  if(groups.length){
   const preceding=data.groups.slice(0,offset),receipt={version:1,dataset,observedAt:manifest.observedAt,offset,
    eventOffset:preceding.reduce((n,g)=>n+g.events.length,0),quarantineOffset:preceding.reduce((n,g)=>n+g.quarantinedSequences.length,0),groups};
   receipt.batchSha256=hashReceipt(receipt);
   const imported=await importChangeBatch({db,store:canonicalStore,receipt,namespace:'server',blockedIdentities,checkpointExtension});
   // Retain core import receipts/tasks while optional detail eligibility is disabled.
   if(env.REXBID_FEED_DETAIL_ENABLED==='enabled'){
    const priorEligibility=(await db.prepare("SELECT e.platform,e.lot FROM json_each(?) j JOIN server_feed_reconcile_eligibility e ON e.platform=json_extract(j.value,'$.platform') AND e.lot=json_extract(j.value,'$.lot')")
     .bind(JSON.stringify(groups.map(({platform,lot})=>({platform,lot})))).all()).results;
    const queuedKeys=new Set(imported.audit.decisions.filter(d=>d.queued).map(d=>`${d.platform}:${d.lot}`));
    const eligibleKeys=new Set([...queuedKeys,...priorEligibility.map(e=>`${e.platform}:${e.lot}`)]);
    // Core import and its receipts/checkpoints always run. Empty initialization
    // noise cannot renew an older material reconciliation observation.
    const eligibilityGroups=groups.filter(g=>eligibleKeys.has(`${g.platform}:${g.lot}`)
      && !isProvenReconcileNoise(g,{queued:queuedKeys.has(`${g.platform}:${g.lot}`)}));
    if(eligibilityGroups.length)await recordFeedEligibility({db,store,groups:eligibilityGroups,generationId:p.generationId,observedAt:manifest.observedAt,namespace:'server'});
   }
   proofs.push(await receiptProof(db,changeKeys(dataset.databaseSha256,'server').batchKey(offset)));
  }
  const end=offset+groups.length,bucketDone=end===data.uniqueLots;
  const nextSpec=workSpec(p.generationId,bucketDone&&p.bucketIndex===127?'finish':'apply',bucketDone?p.bucketIndex+1:p.bucketIndex,bucketDone?0:end);
  generation=(await state.checkpoint({generationId:p.generationId,bucketIndex:p.bucketIndex,groupOffset:offset,nextOffset:end,
   receipts:proofs,outbox:[nextSpec],completeJobKey:state.activation ? job.job_key : null})).generation;
  if (!state.activation) await state.completeOutbox(job.job_key);
  batches++;
  const nextJob=await getJob(db,nextSpec.jobKey);if(!nextJob)fail('SERVER_FEED_JOB_ORDER');
  if(attemptContext)attemptContext.job=nextJob;
  if(usage.unknown||usage.statements>550||usage.rowsWritten>3000||usage.rowsRead>30000||batches>=4)break;
  if(bucketDone&&(!state.activation||p.bucketIndex===127||bucketsVisited>=2))break;
  job=nextJob;p=parseJob(job);
  if(bucketDone){
   // Discard the previous bounded materialization; never hold a whole file.
   data=null;dataset=null;
   data=await readFeedBucket({bucket:env.REXBID_FEED_ARCHIVE,manifest,bucketIndex:p.bucketIndex,limits:{materialized:16*1024*1024}});
   dataset=data.records?bucketDataset(generation,data,state.activation.baselineId):null;bucketsVisited++;
  }
 }while(true);
 return{batches,bucketsVisited,bucketIndex:generation.bucket_index,groupOffset:generation.group_offset,...(continuationReason?{continuationReason}:{})};
}
function safeCode(error){const value=error?.code||error?.message;return typeof value==='string'&&(/^(?:SERVER_FEED(?:_D1_RECOVERY)?|FEED|AUTOMATIC_REFRESH)_[A-Z_]{1,75}$/.test(value)||['AUTH','RATE_LIMITED','CURSOR_EXPIRED','TIMEOUT','UPSTREAM'].includes(value))?value:'SERVER_FEED_OPERATION_FAILED';}
// One bounded derived-metadata page inside the caller's existing lease and reservation.
async function maintainTaxonomy({env,body,db,store,usage,control,now=Date.now,builderFactory=options=>new TaxonomyCacheBuilder(options)}) {
 if(body.kind!=='poll'||env.REXBID_TAXONOMY_BUILD_ENABLED!=='enabled')return null;
 // Leave room for the indexed 5001-row window, membership probes and settlement.
 if(usage.unknown||usage.rowsRead>25000||usage.rowsWritten>4750||control.limit-usage.statements<32)return{skipped:true,reason:'reservation_headroom'};
 try{return await builderFactory({db,store,scope:env.REXBID_FEED_TARGET,now}).step();}
 catch(error){if(!usage.unknown&&/^TAXONOMY_[A-Z_]+$/.test(error?.code||''))return{available:false,reason:error.code};throw error;}
}
async function runMessage({env,body,now=Date.now,fetchImpl=fetch}={}){
 const config=configuration(env);if(!config.enabled)return{disabled:true};
 if(body?.version!==1||!(body.kind==='poll'||typeof body.jobKey==='string'&&/^feed:\d+:(prepare|apply|finish):\d+:\d+$/.test(body.jobKey)))fail('SERVER_FEED_MESSAGE_INVALID');
 const measured=measuredDatabase(env.REXBID_DB,config.bindingIdentity),{db,usage,control}=measured;
 const owner=`server-feed:${randomUUID()}`,store=new RefreshStore(db,owner,now),state=new ServerFeedState({db,store});
 if(!await store.acquire())return{retry:true,reason:'lease_busy'};
 const reservationKey=`run:${randomUUID()}`,attemptContext={job:null};let reserved=false,result,job;
 try{
  if(env.REXBID_CATALOG_MEMBERSHIP_ENABLED==='enabled'){
   const membership=new FeedBootstrapMembership({db,store}),pointer=await membership.pointer();
   if(pointer.baseline_id!==null){const activation=await readBootstrapActivation({db,baselineId:pointer.baseline_id});
    state.configureMembership({membership,activation});}
  }
  if(body.jobKey){job=await getJob(db,body.jobKey);if(!job||job.status==='complete'||job.status==='blocked')return{ignored:true};
   if(job.status==='pending'&&Date.parse(job.next_due_at)>now())return{deferred:true};}
  // A catalogue replacement may let the current archive finish and then hold
  // at its committed boundary. Independent scheduled R2 capture stays live.
  const rebaseDrainUntil=Date.parse(env.REXBID_FEED_REBASE_DRAIN_UNTIL);
  if(env.REXBID_FEED_REBASE_DRAIN==='enabled'&&Number.isFinite(rebaseDrainUntil)
    &&rebaseDrainUntil>now()&&rebaseDrainUntil<=now()+30*60000){
   const live=await state.getState();
   if(live?.active_generation==null)return{ok:true,rebaseDrained:true};
   if(job&&parseJob(job).generationId!==live.active_generation)return{ok:true,rebaseDeferred:true};
  }
  await state.applyReadAllowance(env);
  // The extra lifetime allowance remains OFF without the exact reviewed opt-in.
  // Preparation/intake/future generations never receive recovery credit.
  await state.configureD1Recovery(env);
  state.configureFlexibleBudget(env);
  const workPhase=job?parseJob(job).phase:null;
  const workGeneration=['apply','finish'].includes(workPhase)?await state.getGeneration(parseJob(job).generationId):null;
  const recoveryScope=workGeneration&&['prepared','applying'].includes(workGeneration.status)
    ?{generationId:workGeneration.generation_id,lastSequence:workGeneration.last_sequence,status:workGeneration.status}:undefined;
  const reservation=await state.reserveBudget(reservationKey,{rowsWritten:5000,rowsRead:50000,recoveryScope});
  if(reservation.alreadyReserved)fail('SERVER_FEED_RESERVATION_REUSED');reserved=true;
  result=body.kind==='poll'?await pollLatest({env,state,fetchImpl,now}):await processJob({env,state,db,store,job,usage,now,fetchImpl,attemptContext});
  if(body.kind==='poll'&&env.REXBID_FEED_DETAIL_ENABLED==='enabled'&&!await state.getNextGeneration()){
   const adapter=createApibaraProvider(),request=await countedFeedRequest({env,db,store,now,fetchImpl});
   const repo=new D1SyncRepository(db),report={inserted:0,updated:0,unchanged:0,rejected:0,skipped:0};
   const saveRecord=(...args)=>saveAutomaticObservation({store,repo,adapter,db,report,now},...args);
   result.reconciliation=await processActiveFeedReconciliation({db,store,request,saveRecord,adapter,now,maxRequests:2});
  }
  const taxonomy = await maintainTaxonomy({env,body,db,store,usage,control,now});
  if(taxonomy)result.taxonomy=taxonomy;
  await dispatchDue(env,state);
  result={ok:true,...result};return result;
 }catch(error){
  job=attemptContext.job||job;
  const errorCode=safeCode(error);
  const budgetStop=['SERVER_FEED_D1_RECOVERY_BUDGET_STOP','SERVER_FEED_DAILY_BUDGET_STOP','SERVER_FEED_ROLLING_BUDGET_STOP','AUTOMATIC_REFRESH_BUDGET_STOP','AUTOMATIC_REFRESH_QUOTA_RESERVE','SERVER_FEED_API_AUTH_BLOCKED','SERVER_FEED_API_RATE_PAUSED','SERVER_FEED_RECOVERY_BUDGET_STOP'].includes(errorCode);
  if(job&&!usage.unknown&&budgetStop){try{await state.markDispatched(job.job_key,3600000);}catch{}}
  let retryOutcome,blockingGenerationId;
  const transientProvider=errorCode==='TIMEOUT'||errorCode==='UPSTREAM'&&(error.status==null||Number.isInteger(error.status)&&error.status>=500&&error.status<=599);
  const continuityStop=['SERVER_FEED_CONTINUITY_GAP','SERVER_FEED_UNKNOWN_ARCHIVE_BLOCKED','SERVER_FEED_PRECEDING_ARCHIVE_BLOCKED'].includes(errorCode);
  if(job&&!usage.unknown&&continuityStop){
   try{const blocking=await state.getBlockingGeneration(parseJob(job).generationId);blockingGenerationId=blocking?.generation_id;}catch{}
   try{await state.markDispatched(job.job_key,60000);}catch{}
  }else if(job&&!usage.unknown&&!budgetStop){
   try{retryOutcome=await state.retry(job.job_key,errorCode,Math.min(3600000,60000*2**Math.min(6,job.attempts)),transientProvider?null:8);}catch{}
  }
  result={ok:false,errorCode,retry:usage.unknown||!job&&!budgetStop,retryAfter:error.retryAfter||60,
   ...(retryOutcome?{retryOutcome}:{}),...(blockingGenerationId?{blockingGenerationId}:{}),
   ...(Number.isInteger(error.status)&&error.status>=100&&error.status<=599?{httpStatus:error.status}:{}),
   ...([25,100,500].includes(error.requestLimit)?{gapPageLimit:error.requestLimit}:{})};return result;
 }finally{
  control.limit=1000;
  if(reserved){try{await state.settleBudget(reservationKey,usage.unknown?null:{rowsWritten:usage.rowsWritten+SETTLEMENT_WRITE_OVERHEAD,rowsRead:usage.rowsRead+100});}catch{}}
  // Only this owner can release its lease; never unpause another subsystem.
  const leaseCleanup=await releaseOwnedLease({db,owner});
  if(result)result.leaseCleanup=leaseCleanup;
  if(result){result.databaseUsage={...usage};result.readPolicy=state.readPolicy();result.d1Recovery=state.d1RecoveryPolicy();
   if(state.flexibleBudget)result.d1BudgetMode='rolling-31d-v1';}
 }
}
module.exports={SETTLEMENT_WRITE_OVERHEAD,configuration,measuredDatabase,workSpec,bucketDataset,runMessage,processJob,pollLatest,dispatchDue,safeCode,maintainTaxonomy};
