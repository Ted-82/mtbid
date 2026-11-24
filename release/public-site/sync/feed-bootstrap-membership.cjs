'use strict';
const {createHash, randomUUID}=require('node:crypto');
const {canonicalCaptureTime,captureChronologyCutoff}=require('./feed-bootstrap-capture-time.cjs');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const key=s=>typeof s==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(s);
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const time=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code){throw Error('FEED_MEMBERSHIP_'+code);}
function canonicalPlan(input){
 let p;try{p=structuredClone(input);}catch{fail('PLAN_INVALID');}
 if(p?.version!==1||!key(p.baselineId)||!['production','staging'].includes(p.scope)
  ||!integer(p.capture?.sequence)||!sha(p.capture?.responseSha256)
  ||!integer(p.snapshot?.generationId)||p.snapshot.generationId<1||!sha(p.snapshot?.sha256)
  ||!integer(p.snapshot?.records)||p.snapshot.records<1||p.snapshot.records>1000000
  ||!time(p.snapshot?.requestStartedAt)||!time(p.snapshot?.observedAt)
  ||typeof p.snapshot?.generatedAtKnown!=='boolean'
  ||(p.snapshot.generatedAtKnown?!time(p.snapshot.generatedAt):p.snapshot.generatedAt!==null))fail('PLAN_INVALID');
 const evidence=p.sourceEvidence??{kind:'unknown',sha256:null};
 if(!evidence||!['unknown','fresh-generation','provider-checkpoint'].includes(evidence.kind)
  ||(evidence.kind==='unknown'?evidence.sha256!==null:!sha(evidence.sha256))
  ||evidence.kind==='provider-checkpoint'&&(!integer(evidence.replayStartSequence)||!sha(evidence.snapshotSha256)))fail('PLAN_INVALID');
 let capture;try{capture=canonicalCaptureTime({...p,sourceEvidence:evidence});}catch{fail('PLAN_INVALID');}
 // Fixed order/whitelist: unrelated caller properties never enter persistence.
 return {version:1,baselineId:p.baselineId,scope:p.scope,
  sourceEvidence:{kind:evidence.kind,sha256:evidence.sha256,
   ...(evidence.kind==='provider-checkpoint'?{replayStartSequence:evidence.replayStartSequence,snapshotSha256:evidence.snapshotSha256}:{})},
  capture,
  snapshot:{generationId:p.snapshot.generationId,sha256:p.snapshot.sha256,records:p.snapshot.records,
   requestStartedAt:p.snapshot.requestStartedAt,observedAt:p.snapshot.observedAt,
   generatedAtKnown:p.snapshot.generatedAtKnown,generatedAt:p.snapshot.generatedAt}};
}
function stateOf(row){
 if(!row)fail('BASELINE_MISSING');let plan,state;
 try{plan=canonicalPlan(JSON.parse(row.plan_json));state=JSON.parse(row.checkpoint_json);}catch{fail('CHECKPOINT_INVALID');}
 if(plan.baselineId!==row.baseline_id||digest(plan)!==row.plan_sha256||!integer(row.revision)
  ||!state||state.version!==1||!['building','replaying','ready'].includes(state.status)
  ||!['offset','resolved','excluded','unresolved','replaySequence'].every(k=>integer(state[k]))
  ||state.offset>plan.snapshot.records||state.resolved+state.excluded+state.unresolved!==state.offset
  ||state.replaySequence<plan.capture.sequence||state.offset<plan.snapshot.records&&state.status!=='building'
  ||state.offset===plan.snapshot.records&&state.status==='building'
  ||typeof state.replayVerified!=='boolean'||!integer(state.deltaUnresolved)||!integer(state.reviewedUnresolved)
  ||state.reviewedUnresolved>state.excluded+state.unresolved+state.deltaUnresolved
  ||state.status==='ready'&&(!state.replayVerified||state.offset!==plan.snapshot.records||state.reviewedUnresolved!==state.excluded+state.unresolved+state.deltaUnresolved)
  ||state.reviewedUnresolved>0&&!sha(state.reviewSha256)
  ||state.lastBatch!==null&&(!state.lastBatch||!['snapshot','delta','delta-fragment'].includes(state.lastBatch.kind)
   ||!integer(state.lastBatch.from)||!integer(state.lastBatch.through)||state.lastBatch.through<state.lastBatch.from||!sha(state.lastBatch.sha256))
  ||state.pendingDelta!=null&&(!integer(state.pendingDelta.after)||!integer(state.pendingDelta.through)
   ||state.pendingDelta.after!==state.replaySequence||state.pendingDelta.through<=state.pendingDelta.after
   ||typeof state.pendingDelta.resumeReady!=='boolean'||state.replayVerified||state.status!=='replaying'
   ||state.lastBatch?.kind!=='delta-fragment'||state.lastBatch.from!==state.pendingDelta.after||state.lastBatch.through!==state.pendingDelta.through))fail('CHECKPOINT_INVALID');
 return {plan,state,revision:row.revision,checkpointJson:row.checkpoint_json,planSha256:row.plan_sha256};
}
function identities(rows,max,{delta=false,after=0,through=0}={}){
 if(!Array.isArray(rows)||rows.length>max)fail('IDENTITIES_INVALID');const seen=new Set();
 return rows.map(row=>{
  if(!row||typeof row.listingId!=='string'||!row.listingId.length||row.listingId.length>1000
   ||typeof row.sourceKey!=='string'||!row.sourceKey.length||row.sourceKey.length>1000
   ||!['copart','iaai'].includes(row.platform)||!/^\d{1,20}$/.test(row.lot)
   ||typeof row.vin!=='string'||!/^[A-HJ-NPR-Z0-9]{17}$/.test(row.vin)
   ||seen.has(row.listingId)||delta&&(!integer(row.sequence)||row.sequence<=after||row.sequence>through||typeof row.active!=='boolean'))fail('IDENTITIES_INVALID');
  if(row.expected!==undefined&&(!row.expected||!['updatedAt','sourceUpdatedAt','summarySyncedAt','detailSyncedAt','auctionState'].every(k=>Object.hasOwn(row.expected,k)&&(row.expected[k]===null||typeof row.expected[k]==='string'))))fail('IDENTITIES_INVALID');
  seen.add(row.listingId);return {listingId:row.listingId,sourceKey:row.sourceKey,platform:row.platform,lot:row.lot,vin:row.vin,
   ...(delta?{sequence:row.sequence,active:row.active?1:0}:{}),...(row.expected===undefined?{}:{expected:structuredClone(row.expected)})};
 });
}
// This guard runs AFTER canonical writes when composed with the existing importer.
// Exact canonical identity is rechecked, including rows skipped as already newer.
const IDENTITY_GUARD=`NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(
 SELECT 1 FROM auction_listings l JOIN vehicle_sources s ON s.source_key=l.source_key
 WHERE l.listing_id=json_extract(e.value,'$.listingId') AND l.source_key=json_extract(e.value,'$.sourceKey')
 AND l.platform=json_extract(e.value,'$.platform') AND l.lot=json_extract(e.value,'$.lot')
 AND l.vin_normalized=json_extract(e.value,'$.vin') AND l.identity_state='resolved'
 AND s.provider='apibara' AND s.platform=l.platform
 AND (json_type(e.value,'$.expected') IS NULL OR
  (l.updated_at IS json_extract(e.value,'$.expected.updatedAt')
   AND l.source_updated_at IS json_extract(e.value,'$.expected.sourceUpdatedAt')
   AND l.summary_synced_at IS json_extract(e.value,'$.expected.summarySyncedAt')
   AND l.detail_synced_at IS json_extract(e.value,'$.expected.detailSyncedAt')
   AND l.auction_state IS json_extract(e.value,'$.expected.auctionState')))))`;
class FeedBootstrapMembership{
 constructor({db,store}={}){
  if(!db?.prepare||store?.db!==db||typeof store.guarded!=='function')fail('STORE_REQUIRED');
  this.db=db;this.store=store;
 }
 at(){const n=typeof this.store.now==='function'?Number(this.store.now()):Date.now();if(!Number.isFinite(n))fail('CLOCK_INVALID');return new Date(n).toISOString();}
 async read(baselineId){if(!key(baselineId))fail('PLAN_INVALID');return stateOf(await this.db.prepare('SELECT * FROM feed_catalog_baselines WHERE baseline_id=?').bind(baselineId).first());}
 async begin(input){
  const plan=canonicalPlan(input),planJson=JSON.stringify(plan),planSha256=digest(plan),at=this.at(),id=randomUUID();
  if(plan.snapshot.observedAt>at||plan.snapshot.requestStartedAt>at||plan.snapshot.generatedAtKnown&&plan.snapshot.generatedAt>at)fail('PLAN_INVALID');
  const state={version:1,status:'building',offset:0,resolved:0,excluded:0,unresolved:0,deltaUnresolved:0,
   reviewedUnresolved:0,reviewSha256:null,replayVerified:false,replaySequence:plan.capture.sequence,pendingDelta:null,lastBatch:null};
  await this.store.guarded([
   this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN NOT EXISTS(
    SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND (plan_sha256<>? OR plan_json<>?)) THEN 1 ELSE 0 END)`).bind(id,plan.baselineId,planSha256,planJson),
   this.db.prepare(`INSERT INTO feed_catalog_baselines(baseline_id,plan_sha256,plan_json,checkpoint_json,revision,created_at,updated_at)
    VALUES(?,?,?,?,0,?,?) ON CONFLICT(baseline_id) DO NOTHING`).bind(plan.baselineId,planSha256,planJson,JSON.stringify(state),at,at),
   this.db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id)]);
  return this.read(plan.baselineId);
 }
 mutation(current,next,rows,{snapshot=false}={}){
  const {plan,revision,checkpointJson,planSha256}=current,id=randomUUID(),at=this.at(),data=JSON.stringify(rows);
  // Keep the bounded JSON page outermost. SQLite otherwise scans every earlier
  // member for each page item, making a full snapshot quadratic in row reads.
  const duplicate=snapshot?`AND NOT EXISTS(SELECT 1 FROM json_each(?) e CROSS JOIN feed_catalog_membership m
   ON m.baseline_id=? AND m.listing_id=json_extract(e.value,'$.listingId'))`:'';
  const params=[id,plan.baselineId,planSha256,revision,checkpointJson,data];if(snapshot)params.push(data,plan.baselineId);
  return [this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
   SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND plan_sha256=? AND revision=? AND checkpoint_json=?)
   AND ${IDENTITY_GUARD} ${duplicate} THEN 1 ELSE 0 END)`).bind(...params),
   this.db.prepare(`INSERT INTO feed_catalog_membership(baseline_id,listing_id,active,last_sequence)
    SELECT ?,json_extract(value,'$.listingId'),${snapshot?'1':"json_extract(value,'$.active')"},${snapshot?'?':"json_extract(value,'$.sequence')"}
    FROM json_each(?) WHERE 1 ON CONFLICT(baseline_id,listing_id) DO UPDATE SET
     active=excluded.active,last_sequence=excluded.last_sequence
     WHERE excluded.last_sequence>feed_catalog_membership.last_sequence`).bind(...(snapshot?[plan.baselineId,plan.capture.sequence,data]:[plan.baselineId,data])),
   this.db.prepare('UPDATE feed_catalog_baselines SET checkpoint_json=?,revision=revision+1,updated_at=? WHERE baseline_id=? AND revision=?')
    .bind(JSON.stringify(next),at,plan.baselineId,revision),
   this.db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id)];
 }
 /** Return four statements. Caller MUST append them to the canonical import's
  * SAME store.guarded/db.batch transaction, never run after commit. */
 async snapshotStatements({baselineId,offset,endOffset,batchSha256,resolved=[],excludedCount=0,unresolvedCount=0}={}){
  resolved=structuredClone(resolved);
  const current=await this.read(baselineId),{state,plan}=current;
  const rows=identities(resolved,60);
  if(!integer(offset)||!integer(endOffset)||endOffset<=offset||endOffset-offset>60||endOffset>plan.snapshot.records
   ||!sha(batchSha256)||!integer(excludedCount)||!integer(unresolvedCount)
   ||rows.length+excludedCount+unresolvedCount!==endOffset-offset||state.offset!==offset||state.status!=='building')fail('SNAPSHOT_CHECKPOINT_MISMATCH');
  const next={...state,offset:endOffset,resolved:state.resolved+rows.length,excluded:state.excluded+excludedCount,
   unresolved:state.unresolved+unresolvedCount,status:endOffset===plan.snapshot.records?'replaying':'building',
   lastBatch:{kind:'snapshot',from:offset,through:endOffset,sha256:batchSha256}};
  return {statements:this.mutation(current,next,rows,{snapshot:true}),state:next};
 }
 /** through is a verified provider cursor, not an integer-contiguous event count.
  * Caller collapses repeated identities to their final proven decision per page. */
 async deltaStatements(input={}){return this.deltaMutation(input,false);}
 /** Grouped files are not sequence-ordered across groups/buckets. Fragment
  * decisions share the canonical batch transaction while the cursor stays put.
  * Canonical audit replay MUST omit this extension to avoid double accounting. */
 async deltaFragmentStatements(input={}){return this.deltaMutation(input,true);}
 async deltaMutation({baselineId,after,through,batchSha256,changes=[],unresolvedCount=0}={},fragment=false){
  changes=structuredClone(changes);
  const current=await this.read(baselineId),{state,plan}=current;
  if(!integer(after)||!integer(through)||through<after||after!==state.replaySequence||!sha(batchSha256)
   ||!integer(unresolvedCount)||state.offset!==plan.snapshot.records)fail('DELTA_CHECKPOINT_MISMATCH');
  const rows=identities(changes,2000,{delta:true,after,through}),pending=state.pendingDelta??null;
  if(through===after&&(fragment||rows.length||unresolvedCount)
   ||pending&&(pending.after!==after||pending.through!==through)
   ||pending&&!fragment&&(rows.length||unresolvedCount))fail('DELTA_CHECKPOINT_MISMATCH');
  if(!integer(state.deltaUnresolved+unresolvedCount))fail('DELTA_CHECKPOINT_MISMATCH');
  const deltaUnresolved=state.deltaUnresolved+unresolvedCount;
  const finalStatus=pending
   ?pending.resumeReady&&state.reviewedUnresolved===state.excluded+state.unresolved+deltaUnresolved?'ready':'replaying'
   :unresolvedCount?'replaying':state.status;
  const next={...state,replayVerified:!fragment,replaySequence:fragment?after:through,deltaUnresolved,
   pendingDelta:fragment?(pending??{after,through,resumeReady:state.status==='ready'}):null,
   status:fragment?'replaying':finalStatus,
   lastBatch:{kind:fragment?'delta-fragment':'delta',from:after,through,sha256:batchSha256}};
  return {statements:this.mutation(current,next,rows),state:next};
 }
 async seal({baselineId,through,sourceProofSha256,reviewedUnresolved=0,reviewSha256=null}={}){
  const current=await this.read(baselineId),{state,plan}=current;
  const e=plan.sourceEvidence,sourceReady=e.kind==='fresh-generation'
   ?plan.snapshot.generatedAtKnown&&plan.snapshot.generatedAt>=captureChronologyCutoff(plan)
   :e.kind==='provider-checkpoint'?e.replayStartSequence===plan.capture.sequence&&e.snapshotSha256===plan.snapshot.sha256
   :false;
  if(!sourceReady||!sha(sourceProofSha256)||sourceProofSha256!==e.sha256)fail('SOURCE_ORDER_UNPROVEN');
  if(state.pendingDelta!=null||!state.replayVerified||!integer(through)||state.replaySequence!==through||state.offset!==plan.snapshot.records
   ||!integer(reviewedUnresolved)||reviewedUnresolved!==state.excluded+state.unresolved+state.deltaUnresolved
   ||reviewedUnresolved>0&&!sha(reviewSha256)||reviewedUnresolved===0&&reviewSha256!==null)fail('NOT_READY');
  const next={...state,status:'ready',reviewedUnresolved,reviewSha256};
  // Empty membership mutation still CAS-fences the exact checkpoint under lease.
  await this.store.guarded(this.mutation(current,next,[]));return this.read(baselineId);
 }
 async pointer(){
  const row=await this.db.prepare('SELECT baseline_id,revision,updated_at FROM feed_catalog_pointer WHERE singleton=1').bind().first();
  if(!row||row.baseline_id!==null&&!key(row.baseline_id)||!integer(row.revision))fail('POINTER_INVALID');return row;
 }
 /** NULL restores the legacy public view. A non-NULL pointer can select only a
  * sealed baseline; historical canonical records are never deleted or restored. */
 async switchPointer({baselineId,expectedBaselineId,expectedRevision,checkpointStatements=[]}={}){
  if(baselineId!==null&&!key(baselineId)||expectedBaselineId!==null&&!key(expectedBaselineId)
   ||!integer(expectedRevision)||!Array.isArray(checkpointStatements)||checkpointStatements.length>6)fail('POINTER_INVALID');
  checkpointStatements=checkpointStatements.slice();
  let target=null;if(baselineId!==null){target=await this.read(baselineId);if(target.state.status!=='ready')fail('NOT_READY');}
  const id=randomUUID(),at=this.at();
  const targetGuard=target?`AND EXISTS(SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND plan_sha256=? AND revision=? AND checkpoint_json=?)`:'';
  const params=[id,expectedBaselineId,expectedRevision];if(target)params.push(baselineId,target.planSha256,target.revision,target.checkpointJson);
  await this.store.guarded([
   this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM feed_catalog_pointer WHERE singleton=1 AND baseline_id IS ? AND revision=?) ${targetGuard} THEN 1 ELSE 0 END)`).bind(...params),
   this.db.prepare('UPDATE feed_catalog_pointer SET baseline_id=?,revision=revision+1,updated_at=? WHERE singleton=1 AND revision=?')
    .bind(baselineId,at,expectedRevision),...checkpointStatements,
   this.db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id)]);
  return this.pointer();
 }
}
module.exports={FeedBootstrapMembership,canonicalPlan,digest,captureChronologyCutoff};
