'use strict';
// Replay a verified retained whole feed file into an isolated fresh baseline.
// No transport, live cursor, generation completion, pointer switch or budget
// increase occurs here. The caller owns the ordinary lease/budget reservation.
const {createHash,randomUUID}=require('node:crypto');
const {readFeedBucket,validateFeedArchiveManifest}=require('./feed-worker-archive.cjs');
const {FeedBootstrapMembership}=require('./feed-bootstrap-membership.cjs');
const {createBootstrapDeltaExtension}=require('./feed-bootstrap-delta.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
const {applyFeedRecordHydration}=require('./feed-record-hydration.cjs');
const {importChangeBatch,hashReceipt,changeKeys,validateDataset}=require('./feed-change-import.cjs');
const {POLICY}=require('./automatic-refresh.cjs');
const {readRaw,pagePlan}=require('./feed-gap-repair.cjs');
const MAX_HYDRATION=40,MAX_PARTIAL_BATCHES=3,MAX_BUCKETS=8;
const MAX_GUARD_BYTES=256*1024,MAX_PROOF_GUARDS=16;
const MAX_ARCHIVE_CHAIN=96;
const digest=x=>createHash('sha256').update(x).digest('hex'),hash=x=>digest(JSON.stringify(x));
const integer=x=>Number.isSafeInteger(x)&&x>=0,hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const key=x=>typeof x==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(x);
const fail=code=>{throw Object.assign(Error('FEED_BOOTSTRAP_ARCHIVE_'+code),{code:'FEED_BOOTSTRAP_ARCHIVE_'+code});};
const check=(x,c)=>{if(!x)fail(c);};
const cleanup=(db,id)=>db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id);
const taskKey=(baselineId,generationId)=>`bootstrap-archive-replay:${baselineId}:${generationId}`;
const bucketKey=(baselineId,generationId,index)=>`${taskKey(baselineId,generationId)}:bucket:${index}`;
const task=(db,k)=>db.prepare('SELECT task_key,platform,listing_id,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(k).first();
const completed=r=>r?.platform==='all'&&r.listing_id===null&&r.status==='complete'&&typeof r.cursor==='string';
const parse=r=>{try{return JSON.parse(r.cursor);}catch{fail('CHECKPOINT_INVALID');}};
const ref=r=>({taskKey:r.task_key,cursorSha256:digest(r.cursor)});
const GEN_FIELDS={generationId:'generation_id',rawSha256:'sha256',rawKey:'raw_key',manifestKey:'manifest_key',manifestSha256:'manifest_sha256',firstSequence:'first_sequence',lastSequence:'last_sequence',compressedBytes:'compressed_bytes',observedAt:'observed_at'};
const boundary=row=>Object.fromEntries(Object.entries(GEN_FIELDS).map(([out,input])=>[out,row[input]]));
const genMatch=(row,g)=>row&&Object.entries(GEN_FIELDS).every(([out,input])=>row[input]===g[out]);
async function loadBoundary(db,bucket,generationId){
 const row=await db.prepare('SELECT * FROM server_feed_generations WHERE generation_id=?').bind(generationId).first();
 check(row?.status==='prepared'&&row.retired_at===null&&row.bucket_index===0&&row.group_offset===0
  &&hex(row.sha256)&&hex(row.manifest_sha256)&&integer(row.first_sequence)&&row.first_sequence>0
  &&integer(row.last_sequence)&&row.last_sequence>=row.first_sequence,'GENERATION_INVALID');
 const object=await bucket.get(row.manifest_key);check(object?.body?.getReader,'MANIFEST_MISSING');
 if(integer(object.size)&&object.size>1024*1024){await object.body.cancel().catch(()=>{});fail('MANIFEST_TOO_LARGE');}
 const reader=object.body.getReader(),parts=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;check(next.value instanceof Uint8Array,'MANIFEST_INVALID');
  size+=next.value.length;check(size<=1024*1024,'MANIFEST_TOO_LARGE');parts.push(next.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=Buffer.concat(parts,size);check(digest(bytes)===row.manifest_sha256,'MANIFEST_HASH');
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('MANIFEST_INVALID');}
 const root=validateFeedArchiveManifest(manifest,{rawSha256:row.sha256,rawKey:row.raw_key,bucketCount:128});
 check(row.manifest_key===root+'/manifest.json'&&manifest.firstSequence===row.first_sequence
  &&manifest.lastSequence===row.last_sequence&&manifest.compressedBytes===row.compressed_bytes
  &&manifest.observedAt===row.observed_at&&manifest.databaseApplied===false&&manifest.continuityVerified===false,'MANIFEST_CONFLICT');
 return {row,manifest,boundary:boundary(row)};
}
function datasetFor(descriptor,data){
 const sources=[{generationId:descriptor.generation.generationId,sha256:data.bucketSha256,records:data.records,
  firstSequence:data.firstSequence,lastSequence:data.lastSequence}];
 return {identity:hash({version:1,sources}),databaseSha256:hash({kind:'bootstrap-archive',baselineId:descriptor.baselineId,
  planSha256:descriptor.planSha256,generationId:descriptor.generation.generationId,bucketSha256:data.bucketSha256}),sources,
  records:data.records,quarantined:data.quarantined,firstSequence:data.firstSequence,lastSequence:data.lastSequence,uniqueLots:data.uniqueLots};
}
function validateCheckpoint(saved,current,g){
 check(saved?.platform==='all'&&saved.listing_id===null&&['pending','complete'].includes(saved.status),'CHECKPOINT_INVALID');
 const p=parse(saved),d=p?.descriptor;
 check(p?.version===1&&d?.version===1&&d.kind==='bootstrap-archive-replay'&&d.baselineId===current.plan.baselineId
  &&d.planSha256===current.planSha256&&d.sourceSequence===current.plan.capture.sequence
  &&d.snapshotSha256===current.plan.snapshot.sha256&&genMatch(g.row,d.generation)
  &&integer(d.after)&&d.after>=d.sourceSequence&&d.generation.firstSequence===d.after+1
  &&d.through===g.manifest.lastSequence&&integer(p.bucketIndex)&&p.bucketIndex<=128&&integer(p.groupOffset)
  &&Array.isArray(p.buckets)&&p.buckets.length===p.bucketIndex&&Array.isArray(p.currentReceipts)
  &&p.currentReceipts.length<=10000&&(p.bucketIndex!==128||p.groupOffset===0&&p.currentReceipts.length===0)
  &&(saved.status==='complete'?(p.bucketIndex===128&&p.proof&&current.state.replaySequence>=d.through)
   :current.state.replaySequence===d.after&&!p.proof),'CHECKPOINT_INVALID');
 check(saved.task_key===taskKey(d.baselineId,d.generation.generationId),'CHECKPOINT_INVALID');return p;
}
// All mutable writes bind both the original source and the exact outer cursor.
function replayGuard(db,p,saved,id){
 const d=p.descriptor,g=d.generation;
 return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
  SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND plan_sha256=?
   AND json_extract(checkpoint_json,'$.replaySequence')=?
   AND json_extract(checkpoint_json,'$.offset')=json_extract(plan_json,'$.snapshot.records'))
  AND EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND status='prepared' AND retired_at IS NULL
   AND bucket_index=0 AND group_offset=0 AND sha256=? AND raw_key=? AND manifest_key=? AND manifest_sha256=?
   AND first_sequence=? AND last_sequence=? AND compressed_bytes=? AND observed_at=?)
  AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='pending' AND cursor=?)
  AND NOT EXISTS(SELECT 1 FROM feed_catalog_pointer WHERE baseline_id=?)
  THEN 1 ELSE 0 END)`).bind(id,d.baselineId,d.planSha256,d.after,g.generationId,g.rawSha256,g.rawKey,g.manifestKey,
   g.manifestSha256,g.firstSequence,g.lastSequence,g.compressedBytes,g.observedAt,saved.task_key,saved.cursor,d.baselineId);
}
function rowsGuard(db,id,rows){return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN NOT EXISTS(
 SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks t
  WHERE (t.task_key,t.platform,t.listing_id,t.status,t.cursor) IS
   (json_extract(r.value,'$.task_key'),'all',NULL,'complete',json_extract(r.value,'$.cursor')))) THEN 1 ELSE 0 END)`)
 .bind(id,JSON.stringify(rows));}
function boundedRowsGuards(db,rows){
 const groups=[];let current=[],bytes=2;
 for(const row of rows){const size=Buffer.byteLength(JSON.stringify(row),'utf8')+1;
  check(size+2<=MAX_GUARD_BYTES,'PROOF_TOO_LARGE');
  if(bytes+size>MAX_GUARD_BYTES){groups.push(current);current=[];bytes=2;}
  current.push(row);bytes+=size;
 }
 if(current.length)groups.push(current);check(groups.length<=MAX_PROOF_GUARDS,'PROOF_TOO_LARGE');
 const ids=groups.map(()=>randomUUID());return {guards:groups.map((rows,i)=>rowsGuard(db,ids[i],rows)),cleanup:ids.map(id=>cleanup(db,id))};
}
async function receiptRows(db,refs){
 check(Array.isArray(refs)&&refs.length<=20000&&new Set(refs.map(r=>r?.taskKey)).size===refs.length,'RECEIPT_INVALID');
 if(!refs.length)return [];
 check(refs.every(r=>typeof r?.taskKey==='string'&&hex(r.cursorSha256)),'RECEIPT_INVALID');
 const found=[];let bytes=0;
 for(let offset=0;offset<refs.length;offset+=32){const chunk=refs.slice(offset,offset+32),result=await db.prepare(
  `SELECT t.task_key,t.platform,t.listing_id,t.status,t.cursor FROM json_each(?) r
   JOIN automatic_refresh_tasks t ON t.task_key=json_extract(r.value,'$.taskKey')`).bind(JSON.stringify(chunk)).all();
  check(Array.isArray(result.results)&&result.results.length===chunk.length,'RECEIPT_UNVERIFIED');
  for(const row of result.results){bytes+=Buffer.byteLength(row.cursor||'','utf8');check(bytes<=MAX_GUARD_BYTES*MAX_PROOF_GUARDS,'PROOF_TOO_LARGE');found.push(row);}
 }
 const map=new Map(found.map(r=>[r.task_key,r]));return refs.map(want=>{const row=map.get(want.taskKey);
  check(completed(row)&&digest(row.cursor)===want.cursorSha256,'RECEIPT_UNVERIFIED');return row;});
}
// An optional short API prefix is accepted only with its retained raw response
// and completed canonical receipts. A bare baseline cursor is not gap proof.
async function verifyPrefix(db,bucket,descriptor,expected=null,now=Date.now()){
 if(descriptor.after===descriptor.sourceSequence){check(expected===null,'PREFIX_PROOF_INVALID');return {proof:null,rows:[]};}
 const dk=`bootstrap-replay:${descriptor.baselineId}`,dr=await task(db,dk);
 check(completed(dr),'PREFIX_PROOF_INVALID');const d=parse(dr);
 check(d?.version===1&&d.baselineId===descriptor.baselineId&&d.planSha256===descriptor.planSha256
  &&d.sourceSequence===descriptor.sourceSequence&&d.snapshotSha256===descriptor.snapshotSha256
  &&d.target?.sequence===descriptor.after&&hex(d.target.responseSha256),'PREFIX_PROOF_INVALID');
 // The completed pages form a contiguous cursor chain, never an inferred
 // sequence derived from a generation identifier or event timestamp.
 const prefix=`bootstrap-replay:${descriptor.baselineId}:page:`;
 const found=await db.prepare(`SELECT task_key,platform,listing_id,status,cursor FROM automatic_refresh_tasks
  WHERE task_key>=? AND task_key<? ORDER BY json_extract(cursor,'$.after')`).bind(prefix,prefix+'\uffff').all();
 check(Array.isArray(found.results)&&found.results.length>0&&found.results.length<=100,'PREFIX_PROOF_INVALID');
 let after=descriptor.sourceSequence;const rows=[dr],pages=[];
 for(const row of found.results){check(completed(row),'PREFIX_PROOF_INVALID');const p=parse(row),proof=p.proof;
  check(p.baselineId===descriptor.baselineId&&p.planSha256===descriptor.planSha256&&p.after===after&&integer(p.through)
   &&p.through>after&&p.through<=descriptor.after&&p.targetFirstSequence===descriptor.after+1&&p.requiredLatestSequence===descriptor.after
   &&p.allowNoProgress===false&&row.task_key===prefix+after&&proof?.version===1&&proof.baselineId===descriptor.baselineId
   &&proof.planSha256===descriptor.planSha256&&proof.sourceSequence===descriptor.sourceSequence&&proof.targetSequence===descriptor.after
   &&proof.after===after&&proof.through===p.through&&proof.globalCursorEstablished===false&&proof.rawKey===p.rawKey
   &&proof.responseSha256===p.responseSha256&&proof.observedAt===p.observedAt&&proof.requestLimit===p.requestLimit
   &&hex(proof.responseSha256)&&[25,100,500].includes(proof.requestLimit)&&Array.isArray(proof.batchReceipts)
   &&proof.batchReceipts.length<=100,'PREFIX_PROOF_INVALID');
  const response=await readRaw(bucket,proof.responseSha256),plan=pagePlan(response,p,now);
  check(plan.through===p.through&&proof.receivedEvents===response.data.length&&proof.appliedEvents===plan.events.length
   &&proof.groups===plan.groups.length&&proof.providerNextCursor===plan.parsed.nextCursor
   &&proof.providerLatestSequence===plan.parsed.latestAvailableSequence&&proof.providerHasMore===plan.parsed.hasMore,'PREFIX_PROOF_INVALID');
  rows.push(row,...await receiptRows(db,proof.batchReceipts));pages.push({...ref(row),proofSha256:hash(proof)});after=p.through;
 }
 check(after===descriptor.after,'PREFIX_PROOF_INVALID');const proof={descriptor:ref(dr),pages};
 if(expected!==null)check(JSON.stringify(proof)===JSON.stringify(expected),'PREFIX_PROOF_INVALID');return {proof,rows};
}
// Each completed archive binds its exact predecessor. The first archive may
// still start at the snapshot or at the end of the already supported API prefix.
async function readArchivePredecessor(db,d,link){
 check(link?.kind==='archive'&&integer(link.generationId)&&link.generationId>0&&link.generationId!==d.generation.generationId
  &&link.taskKey===taskKey(d.baselineId,link.generationId)&&hex(link.cursorSha256)&&hex(link.proofSha256),'PREFIX_PROOF_INVALID');
 const row=await task(db,link.taskKey);check(completed(row)&&digest(row.cursor)===link.cursorSha256,'PREFIX_PROOF_INVALID');
 const p=parse(row),prev=p?.descriptor,proof=p?.proof;
 check(p?.version===1&&p.bucketIndex===128&&p.groupOffset===0&&Array.isArray(p.currentReceipts)&&p.currentReceipts.length===0
  &&Array.isArray(p.buckets)&&p.buckets.length===128&&prev?.version===1&&prev.kind===d.kind&&prev.baselineId===d.baselineId
  &&prev.planSha256===d.planSha256&&prev.sourceSequence===d.sourceSequence&&prev.snapshotSha256===d.snapshotSha256
  &&integer(prev.after)&&prev.after>=d.sourceSequence&&prev.after<d.after&&prev.through===d.after
  &&prev.generation?.generationId===link.generationId&&prev.generation.firstSequence===prev.after+1&&prev.generation.lastSequence===d.after
  &&proof?.version===1&&proof.kind===d.kind&&proof.baselineId===d.baselineId&&proof.planSha256===d.planSha256
  &&proof.sourceSequence===d.sourceSequence&&proof.snapshotSha256===d.snapshotSha256
  &&proof.after===prev.after&&proof.through===prev.through&&proof.globalCursorEstablished===false
  &&JSON.stringify(proof.generation)===JSON.stringify(prev.generation)&&JSON.stringify(proof.prefixReplay)===JSON.stringify(prev.prefixReplay)
  &&JSON.stringify(proof.buckets)===JSON.stringify(p.buckets)&&hash(proof)===link.proofSha256,'PREFIX_PROOF_INVALID');
 return {row,descriptor:prev};
}
async function replayPrefix(db,bucket,d,now,{wholeChain=false}={}){
 if(d.prefixReplay?.kind!=='archive')return verifyPrefix(db,bucket,d,d.prefixReplay,now);
 const rows=[];let next=d,bytes=0;
 do{
  check(rows.length<MAX_ARCHIVE_CHAIN,'PREFIX_PROOF_TOO_LARGE');
  const prev=await readArchivePredecessor(db,next,next.prefixReplay);
  bytes+=Buffer.byteLength(prev.row.cursor,'utf8');
  check(bytes<=MAX_GUARD_BYTES*MAX_PROOF_GUARDS,'PROOF_TOO_LARGE');
  rows.push(prev.row);next=prev.descriptor;
 }while(wholeChain&&next.prefixReplay?.kind==='archive');
 if(wholeChain)rows.push(...(await verifyPrefix(db,bucket,next,next.prefixReplay,now)).rows);
 return {proof:d.prefixReplay,rows};
}
async function startReplayPrefix(db,bucket,d,state,now){
 if(d.after!==d.sourceSequence){
  check(state.replayVerified&&state.lastBatch?.kind==='delta'&&state.lastBatch.through===d.after,'PREFIX_PROOF_INVALID');
  const rows=await db.prepare(`SELECT g.generation_id,t.task_key,t.platform,t.listing_id,t.status,t.cursor
    FROM server_feed_generations g JOIN automatic_refresh_tasks t ON t.task_key=?||g.generation_id
    WHERE g.last_sequence=? AND t.platform='all' AND t.listing_id IS NULL AND t.status='complete' LIMIT 2`)
   .bind(`bootstrap-archive-replay:${d.baselineId}:`,d.after).all();
  check(Array.isArray(rows.results)&&rows.results.length<=1,'PREFIX_PROOF_INVALID');
  if(rows.results.length){
   const row=rows.results[0], link={kind:'archive',generationId:row.generation_id,...ref(row),proofSha256:state.lastBatch.sha256};
   const prev=await readArchivePredecessor(db,d,link);
   check(prev.descriptor.after===state.lastBatch.from,'PREFIX_PROOF_INVALID');
   return {proof:link,rows:[prev.row]};
  }
 }
 const prefix=await verifyPrefix(db,bucket,d,null,now);
 if(prefix.proof)check(state.lastBatch.sha256===prefix.proof.pages.at(-1).proofSha256,'PREFIX_PROOF_INVALID');
 return prefix;
}
function validateBucketMarker(marker,descriptor,expected,index){
 check(marker?.version===1&&marker.kind==='bootstrap-archive-bucket'&&marker.baselineId===descriptor.baselineId
  &&marker.planSha256===descriptor.planSha256&&marker.generationId===descriptor.generation.generationId&&marker.bucketIndex===index
  &&['bucketSha256','records','quarantined','uniqueLots','firstSequence','lastSequence'].every(k=>marker[k]===expected[k])
  &&integer(marker.batchReceiptCount)&&marker.batchReceiptCount<=10000&&hex(marker.batchReceiptsSha256),'BUCKET_PROOF_INVALID');
 if(expected.records){validateDataset(marker.dataset);check(JSON.stringify(marker.dataset)===JSON.stringify(datasetFor(descriptor,expected))
   &&marker.canonicalState?.taskKey===changeKeys(marker.dataset.databaseSha256,'server').key&&hex(marker.canonicalState.cursorSha256),'BUCKET_PROOF_INVALID');}
 else check(marker.dataset===null&&marker.canonicalState===null&&marker.batchReceiptCount===0&&marker.batchReceiptsSha256===hash([]),'BUCKET_PROOF_INVALID');
}
// Returns exact task rows for the caller's atomic activation CAS, without
// reparsing the already verified compressed file or issuing provider calls.
async function verifyBootstrapArchiveReplay({db,bucket,baselineId,generationId,allowPending=false,wholeChain=false,now=Date.now}={}){
 check(db?.prepare&&bucket?.get&&key(baselineId)&&integer(generationId)&&generationId>0&&typeof now==='function'&&Number.isFinite(now()),'CONFIG_INVALID');
 const membership=new FeedBootstrapMembership({db,store:{db,guarded:async()=>fail('READ_ONLY')}}),current=await membership.read(baselineId);
 const g=await loadBoundary(db,bucket,generationId),saved=await task(db,taskKey(baselineId,generationId));
 const p=validateCheckpoint(saved,current,g),d=p.descriptor;
 check(p.bucketIndex===128&&p.groupOffset===0&&p.currentReceipts.length===0
  &&(saved.status==='complete'||allowPending===true),'REPLAY_INCOMPLETE');
 const prefix=await replayPrefix(db,bucket,d,now(),{wholeChain});
 const bucketRows=await receiptRows(db,p.buckets.map((r,index)=>{
  check(r.bucketIndex===index&&r.taskKey===bucketKey(baselineId,generationId,index),'BUCKET_PROOF_INVALID');return r;}));
 const markers=bucketRows.map((row,index)=>{const marker=parse(row);validateBucketMarker(marker,d,g.manifest.buckets[index],index);return marker;});
 const stateRows=await receiptRows(db,markers.flatMap(m=>m.canonicalState?[m.canonicalState]:[]));
 const map=new Map(stateRows.map(r=>[r.task_key,r]));
 for(const m of markers)if(m.canonicalState){const s=parse(map.get(m.canonicalState.taskKey));
  check(s?.version===1&&JSON.stringify(s.dataset)===JSON.stringify(m.dataset)&&s.observedAt===d.generation.observedAt
   &&s.offset===m.uniqueLots&&s.groupedEvents===m.records&&s.quarantined===m.quarantined
   &&s.firstSequence===m.firstSequence&&s.lastSequence===m.lastSequence&&s.globalCursorEstablished===false
   &&s.continuityVerified===false,'CANONICAL_STATE_INVALID');}
 // Each compact bucket marker was committed under exact audit/hydration and
 // canonical-state guards. These append-only application receipts form the
 // transitive proof; finish guards 128 markers/states, never all vehicle audits.
 const proof={version:1,kind:'bootstrap-archive-replay',baselineId,planSha256:d.planSha256,sourceSequence:d.sourceSequence,
  snapshotSha256:d.snapshotSha256,after:d.after,through:d.through,generation:d.generation,prefixReplay:d.prefixReplay,buckets:p.buckets,
  records:g.manifest.records,quarantined:g.manifest.quarantined,uniqueLots:g.manifest.uniqueLots,globalCursorEstablished:false};
 if(saved.status==='complete')check(JSON.stringify(p.proof)===JSON.stringify(proof)
  &&current.state.lastBatch?.sha256===hash(proof)&&current.state.lastBatch.from===d.after
  &&current.state.lastBatch.through===d.through&&current.state.replayVerified&&current.state.pendingDelta===null,'COMPLETE_UNVERIFIED');
 return {descriptorTask:saved,proof,rows:[saved,...prefix.rows,...bucketRows,...stateRows],boundary:d.generation,manifest:g.manifest};
}
async function replayBootstrapArchive({db,store,bucket,baselineId,generationId,maxBuckets=MAX_BUCKETS}={}){
 check(db?.prepare&&db?.batch&&store?.db===db&&store.owner&&typeof store.guarded==='function'&&typeof store.now==='function'
  &&Number.isFinite(store.now())&&bucket?.get&&key(baselineId)&&integer(generationId)&&generationId>0
  &&integer(maxBuckets)&&maxBuckets>0&&maxBuckets<=MAX_BUCKETS,'CONFIG_INVALID');
 if(db.identity!==undefined)check(db.metadataVerified===true&&typeof db.identity.id==='string'&&typeof db.identity.name==='string','TARGET_UNVERIFIED');
 const membership=new FeedBootstrapMembership({db,store}),current=await membership.read(baselineId),now=store.now.bind(store);
 check(current.state.offset===current.plan.snapshot.records&&current.state.status!=='building','SNAPSHOT_INCOMPLETE');
 const g=await loadBoundary(db,bucket,generationId);check(Date.parse(g.manifest.observedAt)<=now(),'SOURCE_TIME_INVALID');
 const k=taskKey(baselineId,generationId);let saved=await task(db,k);
 if(!saved){
  check(!current.state.pendingDelta&&g.manifest.firstSequence===current.state.replaySequence+1,'CONTINUITY_GAP');
  const d={version:1,kind:'bootstrap-archive-replay',baselineId,planSha256:current.planSha256,sourceSequence:current.plan.capture.sequence,
   snapshotSha256:current.plan.snapshot.sha256,after:current.state.replaySequence,through:g.manifest.lastSequence,generation:g.boundary};
  const prefix=await startReplayPrefix(db,bucket,d,current.state,now());d.prefixReplay=prefix.proof;
  const initial={version:1,descriptor:d,bucketIndex:0,groupOffset:0,buckets:[],currentReceipts:[],proof:null},id=randomUUID(),at=new Date(now()).toISOString();
  const prefixGuards=boundedRowsGuards(db,prefix.rows);await store.guarded([...prefixGuards.guards,db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND plan_sha256=? AND revision=? AND checkpoint_json=?)
    AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)
    AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key>=? AND task_key<? AND status='pending')
    AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key>=? AND task_key<? AND status='pending')
    AND NOT EXISTS(SELECT 1 FROM feed_catalog_pointer WHERE baseline_id=?) THEN 1 ELSE 0 END)`)
   .bind(id,baselineId,current.planSha256,current.revision,current.checkpointJson,k,`bootstrap-archive-replay:${baselineId}:`,
    `bootstrap-archive-replay:${baselineId}:\uffff`,`bootstrap-replay:${baselineId}:page:`,`bootstrap-replay:${baselineId}:page:\uffff`,baselineId),
   db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,status)
    VALUES(?,'all',?,?,?,'pending')`).bind(k,JSON.stringify(initial),at,at),cleanup(db,id),...prefixGuards.cleanup]);saved=await task(db,k);
 }
 let p=validateCheckpoint(saved,current,g);const d=p.descriptor;
 if(saved.status==='complete'){const verified=await verifyBootstrapArchiveReplay({db,bucket,baselineId,generationId,now});
  return {complete:true,resumed:true,bucketIndex:128,groupOffset:0,newHydrationGroups:0,newPartialBatches:0,requests:0,proof:verified.proof,globalCursorEstablished:false};}
 const resumed=p.bucketIndex!==0||p.groupOffset!==0;
 const fenced={db,owner:store.owner,now,async guarded(statements){const id=randomUUID();
  return store.guarded([replayGuard(db,p,saved,id),...statements,cleanup(db,id)]);}};
 let newHydrationGroups=0,newPartialBatches=0,finishedBuckets=0;
 const result=phase=>({complete:false,resumed,phase,bucketIndex:p.bucketIndex,groupOffset:p.groupOffset,
  after:d.after,through:d.after,requestedThrough:d.through,newHydrationGroups,newPartialBatches,requests:0,globalCursorEstablished:false});
 const provider=createApibaraProvider(),checkpointExtension=createBootstrapDeltaExtension({
  membership:new FeedBootstrapMembership({db,store:fenced}),baselineId,after:d.after,through:d.through});
 while(p.bucketIndex<128&&finishedBuckets<maxBuckets){
  const index=p.bucketIndex,data=await readFeedBucket({bucket,manifest:g.manifest,bucketIndex:index});
  check(p.groupOffset<=data.uniqueLots,'CHECKPOINT_INVALID');
  const dataset=data.records?datasetFor(d,data):null,offset=p.groupOffset,groups=data.groups.slice(offset,offset+100);
  const hydrationGroups=groups.filter(group=>group.events.some(event=>event.record!=null)),proofRows=[],blocked=[];
  const hydrationHash=hash({kind:'bootstrap-archive-hydration',descriptor:d,bucketIndex:index,bucketSha256:data.bucketSha256});
  for(let i=0;i<hydrationGroups.length;i+=20){const slice=hydrationGroups.slice(i,i+20),receiptKey=`file-hydration:${hydrationHash}:${offset}:${i}`;
   const existing=await task(db,receiptKey);if(!existing&&newHydrationGroups+slice.length>MAX_HYDRATION)return result('hydrate');
   const hydrated=await applyFeedRecordHydration({db,store:fenced,provider,groups:slice,observedAt:g.manifest.observedAt,receiptKey,freshnessPolicy:POLICY});
   if(!hydrated.alreadyApplied)newHydrationGroups+=slice.length;
   blocked.push(...hydrated.quarantined.map(x=>`${x.platform}:${x.lot}`));const row=await task(db,receiptKey);
   check(completed(row)&&parse(row).inputHash===hydrated.inputHash,'RECEIPT_UNVERIFIED');proofRows.push(row);
  }
  let canonical=null;
  if(groups.length){const preceding=data.groups.slice(0,offset),receipt={version:1,dataset,observedAt:g.manifest.observedAt,offset,
    eventOffset:preceding.reduce((n,x)=>n+x.events.length,0),quarantineOffset:preceding.reduce((n,x)=>n+x.quarantinedSequences.length,0),groups};
   receipt.batchSha256=hashReceipt(receipt);const batchKey=changeKeys(dataset.databaseSha256,'server').batchKey(offset);
   if(newPartialBatches>=MAX_PARTIAL_BATCHES&&!await task(db,batchKey))return result('apply');
   const imported=await importChangeBatch({db,store:fenced,receipt,namespace:'server',blockedIdentities:blocked,checkpointExtension});
   if(!imported.alreadyApplied)newPartialBatches++;
   const audit=await task(db,batchKey);check(completed(audit)&&audit.cursor===JSON.stringify(imported.audit),'RECEIPT_UNVERIFIED');proofRows.push(audit);
   if(offset+groups.length===data.uniqueLots){canonical=await task(db,changeKeys(dataset.databaseSha256,'server').key);
    check(completed(canonical)&&canonical.cursor===JSON.stringify(imported.state),'RECEIPT_UNVERIFIED');}
  }
  const end=offset+groups.length,done=end===data.uniqueLots,receipts=[...p.currentReceipts,...proofRows.map(ref)];
  check(new Set(receipts.map(r=>r.taskKey)).size===receipts.length,'RECEIPT_INVALID');
  const next={...p,groupOffset:done?0:end,bucketIndex:done?index+1:index,currentReceipts:done?[]:receipts};
  const statements=[],at=new Date(now()).toISOString();let guardedProofRows=proofRows;
  if(done){
   // Full receipt readback occurs once per bucket and is checked atomically
   // with its compact marker. Later buckets do not re-read the growing ledger.
   guardedProofRows=await receiptRows(db,receipts);
   const marker={version:1,kind:'bootstrap-archive-bucket',baselineId,planSha256:d.planSha256,generationId,bucketIndex:index,
    bucketSha256:data.bucketSha256,records:data.records,quarantined:data.quarantined,uniqueLots:data.uniqueLots,
    firstSequence:data.firstSequence,lastSequence:data.lastSequence,dataset,canonicalState:canonical?ref(canonical):null,
    batchReceiptCount:receipts.length,batchReceiptsSha256:hash(receipts)};
   const cursor=JSON.stringify(marker),bk=bucketKey(baselineId,generationId,index);
   statements.push(db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
    VALUES(?,'all',?,?,?,?,'complete')`).bind(bk,cursor,at,at,at));
   next.buckets=[...p.buckets,{bucketIndex:index,taskKey:bk,cursorSha256:digest(cursor)}];
  }
  const proofGuards=boundedRowsGuards(db,[...guardedProofRows,...(canonical?[canonical]:[])]);
  await fenced.guarded([...proofGuards.guards,...statements,
   db.prepare('UPDATE automatic_refresh_tasks SET cursor=?,last_attempt_at=? WHERE task_key=?').bind(JSON.stringify(next),at,k),...proofGuards.cleanup]);
  saved=await task(db,k);check(saved?.cursor===JSON.stringify(next),'READBACK_FAILED');p=next;if(done)finishedBuckets++;
  if(newPartialBatches>=MAX_PARTIAL_BATCHES||newHydrationGroups>=MAX_HYDRATION)break;
 }
 if(p.bucketIndex!==128)return result('apply');
 const verified=await verifyBootstrapArchiveReplay({db,bucket,baselineId,generationId,allowPending:true,now}),proof=verified.proof;
 const final=await membership.deltaStatements({baselineId,after:d.after,through:d.through,batchSha256:hash(proof),changes:[],unresolvedCount:0});
 const at=new Date(now()).toISOString(),complete={...p,proof},proofGuards=boundedRowsGuards(db,verified.rows.slice(1));
 await fenced.guarded([...proofGuards.guards,...final.statements,
  db.prepare("UPDATE automatic_refresh_tasks SET status='complete',cursor=?,last_success_at=?,next_due_at=? WHERE task_key=?")
   .bind(JSON.stringify(complete),at,at,k),...proofGuards.cleanup]);
 const finalState=await membership.read(baselineId),readback=await task(db,k);
 check(finalState.state.replaySequence===d.through&&finalState.state.lastBatch?.sha256===hash(proof)&&!finalState.state.pendingDelta
  &&completed(readback)&&readback.cursor===JSON.stringify(complete),'READBACK_FAILED');
 return {complete:true,resumed,phase:'complete',bucketIndex:128,groupOffset:0,after:d.after,through:d.through,newHydrationGroups,
  newPartialBatches,requests:0,proof,globalCursorEstablished:false};
}
module.exports={replayBootstrapArchive,verifyBootstrapArchiveReplay,taskKey,bucketKey,MAX_HYDRATION,MAX_PARTIAL_BATCHES,MAX_BUCKETS,MAX_GUARD_BYTES,MAX_PROOF_GUARDS};
