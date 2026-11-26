'use strict';
// Explicit operator handoff. Canonical data, generation completion, outbox and
// financial counters are untouched. The shared lease fences one atomic switch.
const {createHash,randomUUID}=require('node:crypto');
const {FeedBootstrapMembership}=require('./feed-bootstrap-membership.cjs');
const {captureChronologyCutoff}=require('./feed-bootstrap-capture-time.cjs');
const {validateFeedArchiveManifest}=require('./feed-worker-archive.cjs');
const {readRaw,pagePlan}=require('./feed-gap-repair.cjs');
const {verifyBootstrapArchiveReplay,taskKey:archiveTaskKey,MAX_GUARD_BYTES}=require('./feed-bootstrap-archive-replay.cjs');
// Activation verifies the retained archive chain and its final bucket states
// together. This limit is specific to that single atomic pointer change.
const MAX_ACTIVATION_PROOF_GUARDS=40;
// Same immutable deployment identities as the operator bridge; avoid importing
// its filesystem-capable operator dependencies into the Worker read path.
const OPERATOR_TARGETS={staging:{id:'acb3cb8e-69a2-459f-8a46-0f2f5b9004be',name:'rexbid-auth-test-db'},
 production:{id:'c8a30088-70af-43a6-9a7f-c4018279d37d',name:'rexbid-production-preflight-db'}};
const PROJECTED_TARGET=Object.freeze({id:'b9733ac7-8da3-40ac-b163-8d4a592f6e13',name:'rexbid-active-catalog-meter-20261110'});
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const key=v=>typeof v==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(v);
const digest=v=>createHash('sha256').update(v).digest('hex');
const hash=v=>digest(JSON.stringify(v));
const fail=code=>{throw Object.assign(Error('FEED_BOOTSTRAP_ACTIVATION_'+code),{code:'FEED_BOOTSTRAP_ACTIVATION_'+code});};
const check=(v,c)=>{if(!v)fail(c);};
const receiptKey=id=>'bootstrap-activation:'+id;
const task=(db,k)=>db.prepare('SELECT task_key,platform,listing_id,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(k).first();
const completed=row=>row?.platform==='all'&&row.listing_id===null&&row.status==='complete'&&typeof row.cursor==='string';
const parsed=row=>{try{return JSON.parse(row.cursor);}catch{fail('EVIDENCE_INVALID');}};
function sourceProof(plan){
 const e=plan.sourceEvidence;
 check(e&&hex(e.sha256)&&(e.kind==='fresh-generation'?plan.snapshot.generatedAtKnown
   &&plan.snapshot.generatedAt>=captureChronologyCutoff(plan):e.kind==='provider-checkpoint'
   &&e.replayStartSequence===plan.capture.sequence&&e.snapshotSha256===plan.snapshot.sha256),'SOURCE_UNPROVEN');
 return e.sha256;
}
function assertIdentity(db,expected,{allowDeploymentBinding=false}={}){
 if(db.identity!==undefined||db.bindingIdentity!==undefined||expected!==null){
  const identity=db.identity!==undefined?(db.metadataVerified===true?db.identity:null)
   :allowDeploymentBinding&&db.bindingIdentityVerified===true?db.bindingIdentity:null;
  check(identity&&typeof identity.id==='string'&&typeof identity.name==='string','TARGET_UNVERIFIED');
  if(expected)check(identity.id===expected.id&&identity.name===expected.name,'TARGET_MISMATCH');}
}
function boundarySame(row,b){return row&&row.generation_id===b.generationId&&row.sha256===b.rawSha256&&row.raw_key===b.rawKey
 &&row.manifest_key===b.manifestKey&&row.manifest_sha256===b.manifestSha256&&row.first_sequence===b.firstSequence
 &&row.last_sequence===b.lastSequence&&row.compressed_bytes===b.compressedBytes;}
async function readBootstrapActivation({db,baselineId}={}){
 check(db?.prepare&&key(baselineId),'CONFIG_INVALID');
 const saved=await task(db,receiptKey(baselineId));if(!saved)return null;
 check(completed(saved),'RECEIPT_INVALID');const receipt=parsed(saved),{sha256,...body}=receipt||{};
 const projected=receipt?.kind==='feed-projected-catalog-activation';
 check(receipt?.version===1&&(receipt.kind==='feed-bootstrap-activation'||projected)&&receipt.baselineId===baselineId
  &&hex(sha256)&&hash(body)===sha256&&hex(receipt.planSha256)&&hex(receipt.sourceProofSha256)
  &&integer(receipt.floorSequence)&&integer(receipt.sourceSequence)&&receipt.floorSequence>=receipt.sourceSequence
  &&hex(receipt.replay?.proofSha256)&&hex(receipt.boundary?.rawSha256)
  &&(projected?receipt.boundary.manifestSha256===null:hex(receipt.boundary?.manifestSha256))
  &&receipt.boundary.lastSequence===receipt.floorSequence&&integer(receipt.boundary.generationId)
  &&receipt.boundary.generationId>0&&integer(receipt.prior?.serverSequence)&&receipt.prior.serverSequence<=receipt.floorSequence,'RECEIPT_INVALID');
 if(projected)check(receipt.target?.id===PROJECTED_TARGET.id&&receipt.target.name===PROJECTED_TARGET.name
  &&receipt.replay.kind==='compact-import'&&receipt.prior.serverSequence===receipt.floorSequence
  &&receipt.boundary.manifestKey===null&&hex(receipt.boundary.captureSha256),'RECEIPT_INVALID');
 assertIdentity(db,receipt.target,{allowDeploymentBinding:true});
 const membership=new FeedBootstrapMembership({db,store:{db,guarded:async()=>{fail('READ_ONLY');}}});
 const current=await membership.read(baselineId),pointer=await membership.pointer();
 check(current.planSha256===receipt.planSha256&&sourceProof(current.plan)===receipt.sourceProofSha256
  &&hash(current.plan.sourceEvidence)===receipt.sourceEvidenceSha256&&current.plan.capture.sequence===receipt.sourceSequence
  &&current.state.replaySequence>=receipt.floorSequence&&pointer.baseline_id===baselineId
  &&integer(receipt.prior.pointerRevision)&&pointer.revision>=receipt.prior.pointerRevision+1,'RECEIPT_UNVERIFIED');
 const state=await db.prepare('SELECT * FROM server_feed_state WHERE singleton=1').bind().first();
 const generation=await db.prepare('SELECT * FROM server_feed_generations WHERE generation_id=?').bind(receipt.boundary.generationId).first();
 check(integer(state?.committed_sequence)&&state.committed_sequence>=receipt.floorSequence
  &&boundarySame(generation,receipt.boundary),'RECEIPT_UNVERIFIED');
 return {baselineId,floorSequence:receipt.floorSequence,planSha256:receipt.planSha256,receiptKey:saved.task_key,
  receiptCursor:saved.cursor,receiptSha256:digest(saved.cursor),receipt};
}
async function objectJson(bucket,k,expectedHash){
 const object=await bucket.get(k);check(object?.body?.getReader,'MANIFEST_MISSING');
 if(integer(object.size)&&object.size>1024*1024){await object.body.cancel().catch(()=>{});fail('MANIFEST_TOO_LARGE');}
 const reader=object.body.getReader(),parts=[];let bytes=0;
 try{for(;;){const next=await reader.read();if(next.done)break;check(next.value instanceof Uint8Array,'MANIFEST_INVALID');
  bytes+=next.value.length;check(bytes<=1024*1024,'MANIFEST_TOO_LARGE');parts.push(next.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const content=Buffer.concat(parts,bytes);check(digest(content)===expectedHash,'MANIFEST_HASH');
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content));}catch{fail('MANIFEST_INVALID');}
}
async function activateBootstrap({db,store,bucket,baselineId,expectedBaselineId,expectedPointerRevision,expectedServerSequence,boundaryGenerationId,expectedSourceHead}={}){
 check(db?.prepare&&db?.batch&&store?.db===db&&typeof store.guarded==='function'&&typeof store.now==='function'
  &&store.owner&&bucket?.get&&key(baselineId)&&(expectedBaselineId===null||key(expectedBaselineId))
  &&integer(expectedPointerRevision)&&integer(expectedServerSequence)&&integer(boundaryGenerationId)&&boundaryGenerationId>0,'CONFIG_INVALID');
 check(db.metadataVerified===true&&db.identity&&typeof db.identity.id==='string'&&typeof db.identity.name==='string','TARGET_UNVERIFIED');
 const membership=new FeedBootstrapMembership({db,store}),current=await membership.read(baselineId);
 const expectedTarget=OPERATOR_TARGETS[current.plan.scope];check(expectedTarget,'TARGET_MISMATCH');assertIdentity(db,expectedTarget);
 const existing=await task(db,receiptKey(baselineId));
 if(existing){const activation=await readBootstrapActivation({db,baselineId});
  check(activation.receipt.boundary.generationId===boundaryGenerationId
    &&activation.receipt.prior.baselineId===expectedBaselineId&&activation.receipt.prior.pointerRevision===expectedPointerRevision
    &&activation.receipt.prior.serverSequence===expectedServerSequence,'RECEIPT_CONFLICT');
  return {...activation,alreadyApplied:true};}
 const T=current.state.replaySequence,N=current.plan.capture.sequence;
 check(current.state.status==='ready'&&current.state.replayVerified===true&&current.state.pendingDelta===null
  &&current.state.offset===current.plan.snapshot.records&&current.state.lastBatch?.kind==='delta'
  &&current.state.lastBatch.through===T&&integer(T)&&T>=N&&expectedServerSequence<=T,'BASELINE_NOT_READY');
 const sourceProofSha256=sourceProof(current.plan);
 const generation=await db.prepare('SELECT * FROM server_feed_generations WHERE generation_id=?').bind(boundaryGenerationId).first();
 check(generation?.status==='prepared'&&generation.retired_at===null&&generation.bucket_index===0&&generation.group_offset===0
  &&generation.last_sequence===T&&integer(generation.first_sequence)&&generation.first_sequence>0&&generation.first_sequence<=T
  &&hex(generation.sha256)&&hex(generation.manifest_sha256),'BOUNDARY_INVALID');
 if(current.plan.scope==='production'&&expectedBaselineId!==null){
  const age=store.now()-Date.parse(expectedSourceHead?.observedAt);
  check(expectedSourceHead?.generationId===boundaryGenerationId&&expectedSourceHead.sha256===generation.sha256
    &&Date.parse(expectedSourceHead.observedAt)===Date.parse(generation.observed_at)
    &&age>=0&&age<=60*60000,'REBASE_SOURCE_HEAD_UNVERIFIED');
 }
 const manifest=await objectJson(bucket,generation.manifest_key,generation.manifest_sha256);
 check(typeof validateFeedArchiveManifest==='function','MANIFEST_VALIDATOR_REQUIRED');
 const root=validateFeedArchiveManifest(manifest,{rawSha256:generation.sha256,rawKey:generation.raw_key,bucketCount:128});
 check(generation.manifest_key===root+'/manifest.json'&&manifest.firstSequence===generation.first_sequence&&manifest.lastSequence===T
  &&manifest.compressedBytes===generation.compressed_bytes&&manifest.observedAt===generation.observed_at
  &&Date.parse(manifest.observedAt)<=store.now()&&manifest.databaseApplied===false&&manifest.continuityVerified===false,'BOUNDARY_CONFLICT');
 let rows,replay;
 const archiveTask=await task(db,archiveTaskKey(baselineId,boundaryGenerationId));
 if(archiveTask){
  const verified=await verifyBootstrapArchiveReplay({db,bucket,baselineId,generationId:boundaryGenerationId,wholeChain:true,now:store.now.bind(store)});
  check(completed(verified.descriptorTask)&&verified.proof.planSha256===current.planSha256
    &&verified.proof.sourceSequence===N&&verified.proof.snapshotSha256===current.plan.snapshot.sha256
    &&verified.proof.after===current.state.lastBatch.from&&verified.proof.through===T
    &&hash(verified.proof)===current.state.lastBatch.sha256&&boundarySame(generation,verified.boundary),'ARCHIVE_PROOF_INVALID');
  rows=verified.rows;replay={kind:'archive',descriptorKey:verified.descriptorTask.task_key,
    descriptorCursorSha256:digest(verified.descriptorTask.cursor),proofSha256:hash(verified.proof),
    bucketProofCount:verified.proof.buckets.length};
 }else{
 const descriptor=await task(db,'bootstrap-replay:'+baselineId),d=parsed(descriptor);
 check(completed(descriptor)&&d.version===1&&d.baselineId===baselineId&&d.planSha256===current.planSha256
  &&d.sourceSequence===N&&d.snapshotSha256===current.plan.snapshot.sha256&&d.target?.sequence===T
  &&hex(d.target.responseSha256)&&typeof d.target.observedAt==='string'&&new Date(d.target.observedAt).toISOString()===d.target.observedAt
  &&d.target.observedAt>=captureChronologyCutoff(current.plan)&&Date.parse(d.target.observedAt)<=store.now(),'REPLAY_TARGET_INVALID');
 const page=await task(db,'bootstrap-replay:'+baselineId+':page:'+current.state.lastBatch.from),p=parsed(page),proof=p.proof;
 check(completed(page)&&p.baselineId===baselineId&&p.planSha256===current.planSha256&&p.after===current.state.lastBatch.from
  &&p.through===T&&p.targetFirstSequence===T+1&&p.requiredLatestSequence===T&&p.allowNoProgress===(p.after===T)
  &&proof?.version===1&&proof.baselineId===baselineId&&proof.planSha256===current.planSha256
  &&proof.sourceSequence===N&&proof.targetSequence===T&&proof.after===p.after&&proof.through===T
  &&hash(proof)===current.state.lastBatch.sha256&&proof.globalCursorEstablished===false
  &&Array.isArray(proof.batchReceipts)&&proof.batchReceipts.length<=100&&hex(proof.responseSha256)
  &&proof.responseSha256===p.responseSha256&&proof.rawKey===p.rawKey&&proof.rawKey==='server-feed/gaps/'+proof.responseSha256+'.json'
  &&proof.observedAt===p.observedAt&&proof.requestLimit===p.requestLimit&&[25,100,500].includes(proof.requestLimit),'REPLAY_PROOF_INVALID');
 const response=await readRaw(bucket,proof.responseSha256),plan=pagePlan(response,{after:proof.after,targetFirstSequence:T+1,
   requiredLatestSequence:T,allowNoProgress:proof.after===T,observedAt:proof.observedAt,requestLimit:proof.requestLimit},store.now());
 check(plan.through===T&&proof.receivedEvents===response.data.length&&proof.appliedEvents===plan.events.length
  &&proof.groups===plan.groups.length&&proof.providerNextCursor===plan.parsed.nextCursor
  &&proof.providerLatestSequence===plan.parsed.latestAvailableSequence&&proof.providerHasMore===plan.parsed.hasMore,'REPLAY_PROOF_INVALID');
 rows=[descriptor,page];const seen=new Set(rows.map(row=>row.task_key));
 for(const item of proof.batchReceipts){
  check(item&&typeof item.taskKey==='string'&&/^(file-hydration:|server-feed:|server-feed-batch:)/.test(item.taskKey)
    &&hex(item.cursorSha256)&&!seen.has(item.taskKey),'REPLAY_RECEIPT_INVALID');seen.add(item.taskKey);
  const row=await task(db,item.taskKey);check(completed(row)&&digest(row.cursor)===item.cursorSha256,'REPLAY_RECEIPT_INVALID');rows.push(row);
 }

 replay={descriptorKey:descriptor.task_key,descriptorCursorSha256:digest(descriptor.cursor),pageKey:page.task_key,
   pageCursorSha256:digest(page.cursor),proofSha256:hash(proof),rawResponseSha256:proof.responseSha256};
 }
 // A single SQL guard keeps the membership switch within its six-statement
 // extension contract. Each bound JSON value stays at most256KiB, including
 // a real128-bucket archive proof with all canonical-state markers.
 const evidenceChunks=[];let currentRows=[],currentBytes=2;
 for(const row of rows){const size=Buffer.byteLength(JSON.stringify(row),'utf8')+1;
  check(size+2<=MAX_GUARD_BYTES,'EVIDENCE_TOO_LARGE');
  if(currentBytes+size>MAX_GUARD_BYTES){evidenceChunks.push(JSON.stringify(currentRows));currentRows=[];currentBytes=2;}
  currentRows.push(row);currentBytes+=size;
 }
 if(currentRows.length)evidenceChunks.push(JSON.stringify(currentRows));
 check(evidenceChunks.length>0&&evidenceChunks.length<=MAX_ACTIVATION_PROOF_GUARDS,'EVIDENCE_TOO_LARGE');
 const proofCondition=evidenceChunks.map(()=>`AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks t
      WHERE (t.task_key,t.platform,t.listing_id,t.status,t.cursor) IS
      (json_extract(r.value,'$.task_key'),'all',NULL,'complete',json_extract(r.value,'$.cursor'))))`).join('\n');
 const boundary={generationId:boundaryGenerationId,rawSha256:generation.sha256,rawKey:generation.raw_key,
  manifestKey:generation.manifest_key,manifestSha256:generation.manifest_sha256,firstSequence:generation.first_sequence,
  lastSequence:T,compressedBytes:generation.compressed_bytes};
 const body={version:1,kind:'feed-bootstrap-activation',baselineId,planSha256:current.planSha256,
  sourceProofSha256,sourceEvidenceSha256:hash(current.plan.sourceEvidence),sourceSequence:N,floorSequence:T,boundary,
  replay,
  prior:{baselineId:expectedBaselineId,pointerRevision:expectedPointerRevision,serverSequence:expectedServerSequence},
  target:db.identity?{id:db.identity.id,name:db.identity.name}:null,activatedAt:new Date(store.now()).toISOString()};
 const receipt={...body,sha256:hash(body)},cursor=JSON.stringify(receipt),id=randomUUID(),at=body.activatedAt;
 await membership.switchPointer({baselineId,expectedBaselineId,expectedRevision:expectedPointerRevision,checkpointStatements:[
  db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM server_feed_state WHERE singleton=1 AND committed_sequence=? AND active_generation IS NULL)
    AND EXISTS(SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND plan_sha256=? AND revision=? AND checkpoint_json=?)
    AND EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND status='prepared' AND retired_at IS NULL
      AND bucket_index=0 AND group_offset=0 AND sha256=? AND raw_key=? AND manifest_key=? AND manifest_sha256=?
      AND first_sequence=? AND last_sequence=? AND compressed_bytes=? AND observed_at=?)
    AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)
    ${proofCondition}
    AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key>=? AND task_key<? AND status='pending')
    AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key>=? AND task_key<? AND status='pending')
    THEN 1 ELSE 0 END)`).bind(id,expectedServerSequence,baselineId,current.planSha256,current.revision,current.checkpointJson,
      boundaryGenerationId,generation.sha256,generation.raw_key,generation.manifest_key,generation.manifest_sha256,
      generation.first_sequence,T,generation.compressed_bytes,generation.observed_at,receiptKey(baselineId),...evidenceChunks,
      'bootstrap-replay:'+baselineId+':page:','bootstrap-replay:'+baselineId+':page:\uffff',
      'bootstrap-archive-replay:'+baselineId+':','bootstrap-archive-replay:'+baselineId+':\uffff'),
  db.prepare('UPDATE server_feed_state SET committed_sequence=?,updated_at=? WHERE singleton=1').bind(T,at),
  db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
    VALUES(?,'all',?,?,?,?,'complete')`).bind(receiptKey(baselineId),cursor,at,at,at),
  db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id)]});
 const activation=await readBootstrapActivation({db,baselineId});check(activation?.receiptCursor===cursor,'READBACK_FAILED');
 return {...activation,alreadyApplied:false};
}
module.exports={activateBootstrap,readBootstrapActivation,PROJECTED_TARGET};
