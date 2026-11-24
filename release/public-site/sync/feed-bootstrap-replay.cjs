'use strict';

// One retained, counted API page at a time. Bootstrap state is deliberately
// independent of both live stream cursors; activation belongs to the caller.
const {createHash, randomUUID}=require('node:crypto');
const {createApibaraProvider}=require('../providers/apibara.js');
const {FeedBootstrapMembership}=require('./feed-bootstrap-membership.cjs');
const {captureChronologyCutoff}=require('./feed-bootstrap-capture-time.cjs');
const {createBootstrapDeltaExtension}=require('./feed-bootstrap-delta.cjs');
const {pagePlan,receiptsFor,readRaw,rawKey,MAX_RESPONSE_BYTES}=require('./feed-gap-repair.cjs');
const {applyFeedRecordHydration}=require('./feed-record-hydration.cjs');
const {importChangeBatch,hashReceipt,changeKeys,validateReceipt}=require('./feed-change-import.cjs');
const {POLICY}=require('./automatic-refresh.cjs');
const LIMITS=[500,100,25], MAX_HYDRATION=40, MAX_PARTIAL_BATCHES=3;
const digest=v=>createHash('sha256').update(v).digest('hex');
const hash=v=>digest(JSON.stringify(v));
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=code=>{throw Object.assign(Error('FEED_BOOTSTRAP_REPLAY_'+code),{code:'FEED_BOOTSTRAP_REPLAY_'+code});};
const iso=n=>new Date(n).toISOString();
const validTime=(value,now)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&iso(Date.parse(value))===value&&Date.parse(value)<=now;
const cleanup=(db,id)=>db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id);
const taskKeys=id=>({target:`bootstrap-replay:${id}`,prefix:`bootstrap-replay:${id}:page:`,page:after=>`bootstrap-replay:${id}:page:${after}`});
function targetOf(value,current,now){
 if(!value||!integer(value.sequence)||value.sequence<current.plan.capture.sequence||value.sequence>=Number.MAX_SAFE_INTEGER
  ||!validTime(value.observedAt,now)||value.observedAt<captureChronologyCutoff(current.plan)||!hex(value.responseSha256))fail('TARGET_INVALID');
 return {sequence:value.sequence,observedAt:value.observedAt,responseSha256:value.responseSha256};
}
function assertBaseline(current){
 if(current.state.offset!==current.plan.snapshot.records||current.state.status==='building')fail('SNAPSHOT_INCOMPLETE');
}
function replayGuard(db,{descriptor,descriptorCursor,keys,pointer=null,pointerCursor=null},id){
 const args=[id,descriptor.baselineId,descriptor.planSha256,pointer?.after??descriptor.sourceSequence,
  keys.target,descriptorCursor];
 const page=pointer?`AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all'
    AND listing_id IS NULL AND status='pending' AND cursor=?)`:'';
 if(pointer)args.push(keys.page(pointer.after),pointerCursor);
 args.push(keys.prefix,keys.prefix+'\uffff',keys.page(pointer?.after??descriptor.sourceSequence));
 return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
   SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND plan_sha256=?
    AND json_extract(checkpoint_json,'$.replaySequence')=?
    AND json_extract(checkpoint_json,'$.offset')=json_extract(plan_json,'$.snapshot.records'))
   AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL
    AND status='pending' AND cursor=?) ${page}
   AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key>=? AND task_key<?
    AND status='pending' AND task_key<>?)
   THEN 1 ELSE 0 END)`).bind(...args);
}
function parsePointer(task,descriptor,current,now){
 let p;try{p=JSON.parse(task.cursor);}catch{fail('POINTER_INVALID');}
 const fields=['version','baselineId','planSha256','after','through','targetFirstSequence','requiredLatestSequence',
  'allowNoProgress','responseSha256','rawKey','observedAt','requestLimit'];
 if(!p||Object.keys(p).length!==fields.length||fields.some(k=>!Object.hasOwn(p,k))||p.version!==1
  ||p.baselineId!==descriptor.baselineId||p.planSha256!==descriptor.planSha256||p.after!==current.state.replaySequence
  ||!integer(p.through)||p.through<p.after||p.through>descriptor.target.sequence
  ||p.through===p.after&&p.after!==descriptor.target.sequence
  ||p.targetFirstSequence!==descriptor.target.sequence+1||p.requiredLatestSequence!==descriptor.target.sequence
  ||p.allowNoProgress!==(p.after===descriptor.target.sequence)||!hex(p.responseSha256)
  ||p.rawKey!==rawKey(p.responseSha256)||!validTime(p.observedAt,now)||!LIMITS.includes(p.requestLimit)
  ||task.task_key!==taskKeys(descriptor.baselineId).page(p.after)||task.status!=='pending'
  ||task.platform!=='all'||task.listing_id!==null)fail('POINTER_INVALID');
 return p;
}
function scopedReceipts(plan,pointer,now){
 return receiptsFor(plan,pointer,now).map(original=>{
  const receipt=structuredClone(original);
  // A canonical receipt from another baseline cannot suppress its membership
  // extension on a fresh replay of otherwise identical source events.
  receipt.dataset.databaseSha256=hash({kind:'bootstrap-replay',baselineId:pointer.baselineId,
   planSha256:pointer.planSha256,source:receipt.dataset.databaseSha256});
  receipt.batchSha256=hashReceipt(receipt);validateReceipt(receipt,now);return receipt;
 });
}
async function savedTask(db,key){return db.prepare('SELECT task_key,platform,listing_id,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(key).first();}
async function verifyHydration(db,key,result){
 const row=await savedTask(db,key);let marker;try{marker=JSON.parse(row?.cursor);}catch{fail('RECEIPT_UNVERIFIED');}
 if(row?.platform!=='all'||row.listing_id!==null||row.status!=='complete'||marker.inputHash!==result.inputHash)fail('RECEIPT_UNVERIFIED');return row;
}

async function replayBootstrapPage({db,store,bucket,request,baselineId,target,maxChangesLimit=100,maxPages=1}={}){
 if(!db?.prepare||!db?.batch||store?.db!==db||!store.owner||typeof store.guarded!=='function'
  ||typeof store.now!=='function'||!Number.isFinite(store.now())||typeof request!=='function'
  ||!bucket?.get||!bucket?.put||maxPages!==1||!LIMITS.includes(maxChangesLimit))fail('CONFIG_INVALID');
 const membership=new FeedBootstrapMembership({db,store}),now=store.now.bind(store);
 let current=await membership.read(baselineId);assertBaseline(current);
 target=targetOf(target,current,now());
 const keys=taskKeys(baselineId),descriptor={version:1,baselineId,planSha256:current.planSha256,
  sourceSequence:current.plan.capture.sequence,snapshotSha256:current.plan.snapshot.sha256,target};
 const descriptorCursor=JSON.stringify(descriptor),base={descriptor,descriptorCursor,keys};
 let targetTask=await savedTask(db,keys.target);
 if(!targetTask){
  if(current.state.replaySequence!==descriptor.sourceSequence||current.state.pendingDelta)fail('UNBOUND_PROGRESS');
  const id=randomUUID(),at=iso(now());
  await store.guarded([db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND plan_sha256=? AND revision=? AND checkpoint_json=?)
    AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?) THEN 1 ELSE 0 END)`)
   .bind(id,baselineId,current.planSha256,current.revision,current.checkpointJson,keys.target),
   db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,status)
    VALUES(?,'all',?,?,?,'pending')`).bind(keys.target,descriptorCursor,at,at),cleanup(db,id)]);
  targetTask=await savedTask(db,keys.target);
 }
 if(!targetTask||targetTask.cursor!==descriptorCursor||targetTask.platform!=='all'||targetTask.listing_id!==null
  ||!['pending','complete'].includes(targetTask.status))fail('TARGET_CONFLICT');
 if(targetTask.status==='complete'){
  if(current.state.replaySequence!==target.sequence||!current.state.replayVerified||current.state.pendingDelta
   ||current.state.lastBatch?.kind!=='delta')fail('COMPLETE_UNVERIFIED');
  const saved=await savedTask(db,keys.page(current.state.lastBatch.from));let marker;
  try{marker=JSON.parse(saved?.cursor);}catch{fail('COMPLETE_UNVERIFIED');}
  if(saved?.status!=='complete'||saved.platform!=='all'||saved.listing_id!==null||marker?.proof?.through!==target.sequence
   ||marker.proof.baselineId!==baselineId||hash(marker.proof)!==current.state.lastBatch.sha256)fail('COMPLETE_UNVERIFIED');
  return {complete:true,resumed:true,phase:'complete',after:target.sequence,through:target.sequence,requests:0,
   proof:marker.proof,globalCursorEstablished:false};
 }
 if(current.state.replaySequence>target.sequence)fail('TARGET_CONFLICT');
 const pending=(await db.prepare(`SELECT * FROM automatic_refresh_tasks WHERE task_key>=? AND task_key<? AND status='pending' LIMIT 2`)
  .bind(keys.prefix,keys.prefix+'\uffff').all()).results;
 if(!Array.isArray(pending)||pending.length>1)fail('POINTER_INVALID');
 let pointer,pointerCursor,response,plan;const resumed=pending.length===1;
 if(resumed){
  pointer=parsePointer(pending[0],descriptor,current,now());pointerCursor=pending[0].cursor;
  response=await readRaw(bucket,pointer.responseSha256);plan=pagePlan(response,pointer,now());
  if(plan.through!==pointer.through)fail('POINTER_CONFLICT');
 }else{
  if(current.state.pendingDelta)fail('POINTER_MISSING');
  const obtained=await request({operation:'vehicleChanges',after:current.state.replaySequence,limit:maxChangesLimit});
  if(!validTime(obtained?.observedAt,now()))fail('RESPONSE_TIME_INVALID');
  let encoded;try{encoded=JSON.stringify(obtained.response);}catch{fail('RESPONSE_INVALID');}
  if(typeof encoded!=='string')fail('RESPONSE_INVALID');const bytes=Buffer.from(encoded);
  if(bytes.length>MAX_RESPONSE_BYTES)fail('RESPONSE_TOO_LARGE');response=JSON.parse(encoded);
  pointer={version:1,baselineId,planSha256:current.planSha256,after:current.state.replaySequence,
   through:0,targetFirstSequence:target.sequence+1,requiredLatestSequence:target.sequence,
   allowNoProgress:current.state.replaySequence===target.sequence,responseSha256:digest(bytes),rawKey:rawKey(digest(bytes)),
   observedAt:obtained.observedAt,requestLimit:maxChangesLimit};
  plan=pagePlan(response,pointer,now());pointer.through=plan.through;
  if(pointer.through===pointer.after&&pointer.after!==target.sequence)fail('NO_PROGRESS');
  await bucket.put(pointer.rawKey,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'},
   customMetadata:{sha256:pointer.responseSha256}});await readRaw(bucket,pointer.responseSha256);
  pointerCursor=JSON.stringify(pointer);
  // Initial guard binds current replay progress without touching the old live
  // cursor. All subsequent batches require this exact retained pending page.
  const id=randomUUID(),at=iso(now());
  const before={...base,descriptor:{...descriptor,sourceSequence:pointer.after}};
  await store.guarded([replayGuard(db,before,id),
   db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,status)
    VALUES(?,'all',?,?,?,'pending')`).bind(keys.page(pointer.after),pointerCursor,at,at),cleanup(db,id)]);
 }
 const context={...base,pointer,pointerCursor};
 const fencedStore={db,owner:store.owner,now,async guarded(statements){const id=randomUUID();
  return store.guarded([replayGuard(db,context,id),...statements,cleanup(db,id)]);}};
 const receipts=scopedReceipts(plan,pointer,now()),saved=[],blockedIdentities=[];
 const hydrationGroups=plan.groups.filter(group=>group.events.some(event=>event.record!=null));
 const hydrationHash=hash({version:1,kind:'bootstrap-replay-hydration',pointer});
 const provider=createApibaraProvider();let newHydrationGroups=0,newPartialBatches=0,lastResult;
 const partialResult=phase=>({complete:false,resumed,phase,after:pointer.after,through:pointer.after,
  requestedThrough:pointer.through,requests:resumed?0:1,newHydrationGroups,newPartialBatches,globalCursorEstablished:false});
 for(let offset=0;offset<hydrationGroups.length;offset+=20){
  const groups=hydrationGroups.slice(offset,offset+20),key=`file-hydration:${hydrationHash}:0:${offset}`;
  const existing=await savedTask(db,key);
  if(!existing&&newHydrationGroups+groups.length>MAX_HYDRATION)return partialResult('hydrate');
  const result=await applyFeedRecordHydration({db,store:fencedStore,provider,groups,observedAt:pointer.observedAt,
   receiptKey:key,freshnessPolicy:POLICY});
  if(!result.alreadyApplied)newHydrationGroups+=groups.length;
  blockedIdentities.push(...result.quarantined.map(item=>`${item.platform}:${item.lot}`));
  saved.push(await verifyHydration(db,key,result));
 }
 const checkpointExtension=receipts.length?createBootstrapDeltaExtension({
  membership:new FeedBootstrapMembership({db,store:fencedStore}),baselineId,after:pointer.after,through:pointer.through}):null;
 for(const receipt of receipts){
  const key=changeKeys(receipt.dataset.databaseSha256,'server').batchKey(receipt.offset);
  if(newPartialBatches>=MAX_PARTIAL_BATCHES&&!await savedTask(db,key))return partialResult('apply');
  const blocked=blockedIdentities.filter(key=>receipt.groups.some(group=>key===`${group.platform}:${group.lot}`));
  lastResult=await importChangeBatch({db,store:fencedStore,receipt,namespace:'server',blockedIdentities:blocked,checkpointExtension});
  if(!lastResult.alreadyApplied)newPartialBatches++;
  const row=await savedTask(db,key);
  if(row?.platform!=='all'||row.listing_id!==null||row.status!=='complete'||row.cursor!==JSON.stringify(lastResult.audit))fail('RECEIPT_UNVERIFIED');
  saved.push(row);
 }
 if(receipts.length){
  const row=await savedTask(db,changeKeys(receipts[0].dataset.databaseSha256,'server').key);
  if(row?.platform!=='all'||row.listing_id!==null||row.status!=='complete'||row.cursor!==JSON.stringify(lastResult.state))fail('RECEIPT_UNVERIFIED');saved.push(row);
 }
 const proof={version:1,baselineId,planSha256:descriptor.planSha256,sourceSequence:descriptor.sourceSequence,
  targetSequence:target.sequence,after:pointer.after,through:pointer.through,responseSha256:pointer.responseSha256,
  rawKey:pointer.rawKey,observedAt:pointer.observedAt,requestLimit:pointer.requestLimit,
  receivedEvents:response.data.length,appliedEvents:plan.events.length,groups:plan.groups.length,
  providerNextCursor:plan.parsed.nextCursor,providerLatestSequence:plan.parsed.latestAvailableSequence,
  providerHasMore:plan.parsed.hasMore,batchReceipts:saved.map(row=>({taskKey:row.task_key,cursorSha256:digest(row.cursor)})),
  globalCursorEstablished:false};
 const final=await membership.deltaStatements({baselineId,after:pointer.after,through:pointer.through,
  batchSha256:hash(proof),changes:[],unresolvedCount:0});
 const id=randomUUID(),at=iso(now());
 await fencedStore.guarded([
  db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN NOT EXISTS(
   SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks t
    WHERE (t.task_key,t.platform,t.status,t.cursor) IS (json_extract(r.value,'$.task_key'),'all','complete',json_extract(r.value,'$.cursor'))))
   THEN 1 ELSE 0 END)`).bind(id,JSON.stringify(saved)),...final.statements,
  db.prepare("UPDATE automatic_refresh_tasks SET status='complete',cursor=?,last_success_at=?,next_due_at=? WHERE task_key=?")
   .bind(JSON.stringify({...pointer,completedAt:at,proof}),at,at,keys.page(pointer.after)),
  ...(pointer.through===target.sequence?[db.prepare("UPDATE automatic_refresh_tasks SET status='complete',last_success_at=?,next_due_at=? WHERE task_key=?")
   .bind(at,at,keys.target)]:[]),cleanup(db,id)]);
 current=await membership.read(baselineId);
 if(current.state.replaySequence!==pointer.through||current.state.lastBatch?.sha256!==hash(proof)||current.state.pendingDelta)fail('READBACK_FAILED');
 return {complete:pointer.through===target.sequence,resumed,phase:'complete',after:pointer.after,through:pointer.through,
  requests:resumed?0:1,newHydrationGroups,newPartialBatches,proof,globalCursorEstablished:false};
}
module.exports={replayBootstrapPage,MAX_HYDRATION,MAX_PARTIAL_BATCHES};
