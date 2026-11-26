'use strict';
// Local evidence validation only. No network, provider calls, purchase or SQL.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalPlan,digest}=require('../sync/feed-bootstrap-membership.cjs');
const {isProviderCaptureBound,captureChronologyCutoff}=require('../sync/feed-bootstrap-capture-time.cjs');
const {ACCOUNT,TARGETS}=require('./d1-operator-bridge.cjs');
const contexts=new WeakSet(),MAX_READS=1000000000,MAX_JOB_WRITES=6000000,MAX_JOB_READS=200000000;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('D1_PAID_BOOTSTRAP_PROOF_INVALID');};
function artifact(ref,max=1000000){
 if(!ref||!path.isAbsolute(ref.path||'')||!hex(ref.sha256))fail();
 let bytes;try{const stat=fs.lstatSync(ref.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)fail();bytes=fs.readFileSync(ref.path);}catch{fail();}
 if(hash(bytes)!==ref.sha256)fail();return bytes;
}
const parse=bytes=>JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
function fresh(value,now,age){const t=Date.parse(value);return Number.isFinite(t)&&t<=now+5000&&now-t<=age;}
// This admission proof permits staging only. The live catalogue pointer still
// requires its own verified database replay and atomic switch.
function verifyReplayContinuity(ref,plan,now){
 let proof,range,applied,head;
 try{
  proof=parse(artifact(ref));range=parse(artifact(proof.range));
  applied=parse(artifact(proof.applied));head=parse(artifact(proof.head));
 }catch{fail();}
 const N=plan.capture.sequence,S=plan.snapshot,latest=head.latestDescriptors?.at(-1);
 if(proof.version!==1||proof.kind!=='reviewed-offline-bootstrap-replay'||proof.snapshotSha256!==S.sha256
  ||proof.snapshotGeneration!==S.generationId||proof.sourceSequence!==N||proof.operatorReviewed!==true
  ||!fresh(proof.checkedAt,now,30*60000)||!fresh(head.at,now,90*60000)||head.readOnly!==true
  ||head.remoteConfirmed!==true||head.remoteWrites!==0||head.providerRequests!==0
  ||!latest||!integer(latest.generationId)||!fresh(latest.observedAt,now,90*60000)
  ||range.N!==N||range.snapshotGeneration!==S.generationId||range.strictAdjacency!==true||range.productionWrites!==0
  ||!Array.isArray(range.gaps)||range.gaps.length||!Array.isArray(range.scans)
  ||applied.snapshotSha256!==S.sha256||applied.snapshotGeneration!==S.generationId||applied.sourceSequence!==N
  ||applied.productionWrites!==0||applied.providerRequests!==0||applied.foreignKeysPassed!==true
  ||applied.protectedCountsUnchanged!==true||!Array.isArray(applied.reports))fail();
 const files=range.scans.filter(x=>x.last>N);
 if(files.length<1||files.length>96||files.length!==range.relevantFiles||files.length!==applied.reports.length)fail();
 let through=N,previousId=0,records=0;
 for(let i=0;i<files.length;i++){
  const f=files[i],a=applied.reports[i];
  if(!integer(f.generation)||f.generation<=previousId||!hex(f.sha256)||!integer(f.first)||!integer(f.last)||f.last<=through
    ||!integer(f.afterAnchor)||f.afterAnchor<1||(i===0?f.first>through+1:f.first!==through+1)
    ||a?.generation!==f.generation||a.after!==through||a.through!==f.last||a.events!==f.afterAnchor||a.bucketProofs!==128)fail();
  through=f.last;previousId=f.generation;records+=a.events;
 }
 const last=files.at(-1);
 if(through!==applied.through||through!==range.last?.last||records!==range.afterAnchorEvents
  ||last.generation!==latest.generationId||last.sha256!==latest.sha256||last.observedAt!==latest.observedAt
  ||!fresh(S.requestStartedAt,now,72*3600000)||!fresh(S.generatedAt,now,72*3600000)
  ||latest.observedAt<S.generatedAt)fail();
 return true;
}
function validatePaidBootstrapProof(options,{directory,now,limits}={}){
 if(!options||!path.isAbsolute(options.proofPath||'')||!hex(options.proofSha256)||!path.isAbsolute(directory||'')||!Number.isFinite(now))fail();
 let proof,plan,usage,sourceBytes;
 try{
  proof=parse(artifact({path:options.proofPath,sha256:options.proofSha256}));
  plan=canonicalPlan(parse(artifact(proof.sourcePlan)));
  usage=parse(artifact(proof.monthlyUsage));
  sourceBytes=artifact(proof.sourceEvidenceArtifact,10000000);
 }catch{fail();}
 const boundedCapture=isProviderCaptureBound(plan);
 const replayBacked=proof.replayContinuity!==undefined;
 if(replayBacked&&(!boundedCapture||!verifyReplayContinuity(proof.replayContinuity,plan,now)))fail();
 if(boundedCapture){
  // This branch proves source order, not an invented exact capture clock time.
  // Both actual generation times and the independently pinned provider
  // attestation must be recent. The exact-time branch below is unchanged.
  let attestation;try{attestation=parse(sourceBytes);artifact(attestation.confirmation,10000000);}catch{fail();}
  if(attestation.version!==1||attestation.kind!=='provider-confirmed-pre-snapshot-checkpoint'||attestation.provider!=='apibara'
   ||attestation.checkpoint!==plan.capture.sequence||attestation.snapshotSha256!==plan.snapshot.sha256
   ||attestation.generationId!==plan.snapshot.generationId||attestation.checkpointCapturedBeforeSnapshot!==true
   ||attestation.snapshotStartedAt!==plan.snapshot.requestStartedAt||attestation.snapshotReadyAt!==plan.snapshot.generatedAt
   ||attestation.capturedNoLaterThan!==plan.capture.capturedNoLaterThan
   ||!fresh(attestation.confirmedAt,now,replayBacked?72*3600000:86400000)||new Date(attestation.confirmedAt).toISOString()!==attestation.confirmedAt
   ||attestation.confirmedAt<attestation.snapshotReadyAt||!replayBacked&&(!fresh(attestation.snapshotStartedAt,now,86400000)
   ||!fresh(attestation.snapshotReadyAt,now,86400000)))fail();
 }
 const target=TARGETS[proof.target],scope=proof.target==='publication'?'production':proof.target==='staging'?'staging':null;
 if(proof.version!==1||proof.kind!=='paid_fresh_catalog_bootstrap'||proof.account!==ACCOUNT||!target||proof.scope!==scope
  ||proof.operatorReviewed!==true||proof.additionalFee!==0||proof.newSubscription!==false
  ||!path.isAbsolute(proof.directory||'')||path.resolve(proof.directory)!==path.resolve(directory)
  ||!fresh(proof.createdAt,now,600000)||!Number.isFinite(Date.parse(proof.expiresAt))
  ||Date.parse(proof.expiresAt)<=now||Date.parse(proof.expiresAt)>Date.parse(proof.createdAt)+86400000
  ||proof.databaseId!==target.id||proof.databaseName!==target.name||plan.scope!==scope
  ||proof.sourcePlanSha256!==digest(plan)||proof.snapshotSha256!==plan.snapshot.sha256
  ||proof.sourceEvidenceArtifact.sha256!==plan.sourceEvidence.sha256
  ||!replayBacked&&(!fresh(plan.snapshot.requestStartedAt,now,86400000)||!boundedCapture&&!fresh(plan.capture.capturedAt,now,86400000)
  ||plan.snapshot.generatedAtKnown&&!fresh(plan.snapshot.generatedAt,now,86400000))
  ||!proof.job||typeof proof.job.id!=='string'||!/^fresh-bootstrap-[A-Za-z0-9_-]{1,120}$/.test(proof.job.id)
  ||!integer(proof.job.maxWrites)||proof.job.maxWrites<1||proof.job.maxWrites>MAX_JOB_WRITES
  ||!integer(proof.job.maxReads)||proof.job.maxReads<1||proof.job.maxReads>MAX_JOB_READS
  ||!limits||!proof.limits||Object.keys(proof.limits).length!==5||['writes','reads','writeReserve','readReserve','maxBatchWrites'].some(k=>proof.limits[k]!==limits[k]))fail();
 const evidence=plan.sourceEvidence;
 const sourceValid=evidence.kind==='fresh-generation'
  ?plan.snapshot.generatedAtKnown&&plan.snapshot.generatedAt>=captureChronologyCutoff(plan)
  :evidence.kind==='provider-checkpoint'&&evidence.replayStartSequence===plan.capture.sequence&&evidence.snapshotSha256===plan.snapshot.sha256;
 if(!sourceValid)fail();
 const daily=usage.daily,monthly=usage.rolling31days;
 if(usage.readOnly!==true||usage.providerRequests!==0||usage.fixedPlan!=='Existing Workers Paid; no purchase'||usage.newFeeActivated!==false
  ||!fresh(usage.at,now,600000)||![daily,monthly].every(x=>x&&x.account===ACCOUNT&&fresh(x.at,now,600000)&&integer(x.rowsRead)&&integer(x.rowsWritten))
  ||daily.day!==new Date(now).toISOString().slice(0,10)||daily.from!==daily.day||daily.to!==daily.day
  ||monthly.to!==daily.day||!/^\d{4}-\d{2}-\d{2}$/.test(monthly.from||'')
  ||Date.parse(monthly.to)-Date.parse(monthly.from)<31*86400000||Date.parse(monthly.to)-Date.parse(monthly.from)>32*86400000
  ||monthly.rowsWritten<daily.rowsWritten||monthly.rowsRead<daily.rowsRead)fail();
 // A rolling >=31-day sum is a conservative upper bound for the current paid
 // renewal window. Account usage and local job usage are never interchangeable.
 const futureWrites=Math.max(proof.job.maxWrites,limits.writes-daily.rowsWritten)+limits.writeReserve;
 const futureReads=Math.max(proof.job.maxReads,limits.reads-daily.rowsRead)+limits.readReserve;
 if(!integer(futureWrites)||!integer(futureReads)||monthly.rowsWritten+futureWrites>50000000||monthly.rowsRead+futureReads>25000000000)fail();
 const pin={version:1,kind:proof.kind,account:ACCOUNT,directory:path.resolve(directory),target:proof.target,scope,
  databaseId:target.id,databaseName:target.name,sourcePlanSha256:proof.sourcePlanSha256,snapshotSha256:proof.snapshotSha256,
  sourceEvidenceSha256:proof.sourceEvidenceArtifact.sha256,...(replayBacked?{sourceAgePolicy:'verified-replay-72h-v1'}:{}),
  job:Object.freeze({id:proof.job.id,maxWrites:proof.job.maxWrites,maxReads:proof.job.maxReads}),limits:Object.freeze({...limits})};
 const result=Object.freeze({pin:Object.freeze(pin),pinSha256:digest(pin),expiresAt:proof.expiresAt,
  proofSha256:options.proofSha256,monthlyUsageSha256:proof.monthlyUsage.sha256});contexts.add(result);return result;
}
function permitsPaidBootstrap(context){return context&&contexts.has(context);}
function pinPaidBootstrap(directory,context){
 const file=path.join(directory,'paid-bootstrap-policy.json');
 if(!context){if(fs.existsSync(file))throw Error('D1_PAID_BOOTSTRAP_PROOF_REQUIRED');return;}
 if(!permitsPaidBootstrap(context))fail();
 const serialized=JSON.stringify({sha256:context.pinSha256,policy:context.pin});
 if(fs.existsSync(file)){
  let saved;try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1000000)fail();saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail();}
  if(saved.sha256!==context.pinSha256||digest(saved.policy)!==saved.sha256||JSON.stringify(saved.policy)!==JSON.stringify(context.pin))throw Error('D1_PAID_BOOTSTRAP_POLICY_MISMATCH');
  return;
 }
 const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,serialized+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
module.exports={validatePaidBootstrapProof,permitsPaidBootstrap,pinPaidBootstrap,MAX_READS,MAX_JOB_WRITES,MAX_JOB_READS};
