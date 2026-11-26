'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {openWriteBudget,validatedLimits,LIMITS}=require('../scripts/d1-write-budget.cjs');
const {ACCOUNT,TARGETS}=require('../scripts/d1-operator-bridge.cjs');
const {canonicalPlan,digest}=require('../sync/feed-bootstrap-membership.cjs');
const {validatePaidBootstrapProof}=require('../scripts/d1-paid-bootstrap-proof.cjs');
const hash=x=>createHash('sha256').update(x).digest('hex');
const LIMIT={writes:6000000,reads:1000000000,writeReserve:20000,readReserve:500000,maxBatchWrites:5000};
const statements=[{sql:'INSERT INTO auction_events(event_id) VALUES(?)',params:['not-in-ledger']}];
const meta=(w=100,r=1000)=>[{success:true,meta:{rows_written:w,rows_read:r}}];
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rexbid-paid-bootstrap-')),directory=path.join(root,'budget');let clock=Date.parse('2026-11-01T12:00:00.000Z');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 function write(name,obj){const bytes=Buffer.from(JSON.stringify(obj));const file=path.join(root,name);fs.writeFileSync(file,bytes);return {path:file,sha256:hash(bytes)};}
 const sourceEvidenceArtifact=write('source-evidence.json',{kind:'provider-confirmed-checkpoint',additionalFee:0,n:100,snapshotSha256:'b'.repeat(64)});
 let plan=canonicalPlan({version:1,baselineId:'fresh-1',scope:'production',capture:{sequence:100,capturedAt:'2026-11-01T11:50:00.000Z',responseSha256:'a'.repeat(64)},snapshot:{generationId:7001,sha256:'b'.repeat(64),records:250000,requestStartedAt:'2026-11-01T11:51:00.000Z',observedAt:'2026-10-31T00:00:00.000Z',generatedAtKnown:false,generatedAt:null},sourceEvidence:{kind:'provider-checkpoint',sha256:sourceEvidenceArtifact.sha256,replayStartSequence:100,snapshotSha256:'b'.repeat(64)}});
 let usage={at:new Date(clock).toISOString(),readOnly:true,providerRequests:0,fixedPlan:'Existing Workers Paid; no purchase',newFeeActivated:false,daily:{account:ACCOUNT,day:'2026-11-01',from:'2026-11-01',to:'2026-11-01',at:new Date(clock).toISOString(),rowsRead:600000000,rowsWritten:100000},rolling31days:{account:ACCOUNT,day:'2026-11-01',from:'2026-10-01',to:'2026-11-01',at:new Date(clock).toISOString(),rowsRead:3774651139,rowsWritten:10648667}};
 let proof={version:1,kind:'paid_fresh_catalog_bootstrap',account:ACCOUNT,directory,target:'publication',scope:'production',databaseId:TARGETS.publication.id,databaseName:TARGETS.publication.name,operatorReviewed:true,additionalFee:0,newSubscription:false,createdAt:new Date(clock).toISOString(),expiresAt:'2026-11-02T00:00:00.000Z',sourcePlan:null,sourcePlanSha256:digest(plan),snapshotSha256:plan.snapshot.sha256,sourceEvidenceArtifact,monthlyUsage:null,job:{id:'fresh-bootstrap-20261101',maxWrites:6000000,maxReads:200000000},limits:{...LIMIT}};
 const f={root,directory,plan,usage,proof,clock:()=>clock,setClock:n=>{clock=n;},write,refresh(){proof.sourcePlan=write('membership-plan.json',plan);proof.sourcePlanSha256=digest(plan);proof.snapshotSha256=plan.snapshot.sha256;proof.monthlyUsage=write('account-preflight.json',usage);const ref=write('paid-proof.json',proof);return {proofPath:ref.path,proofSha256:ref.sha256};}};
 f.options=()=>({directory,now:()=>clock,readUsage:async()=>({...usage.daily,at:new Date(clock).toISOString()}),estimate:()=>({writes:100,reads:1000}),limits:{...LIMIT},paidBootstrapProof:f.refresh()});return f;
}

test('default and normal500M ceilings stay unchanged; only verified proof admits1B account policy',async t=>{
 assert.equal(validatedLimits(undefined),LIMITS);assert.equal(validatedLimits({...LIMITS,reads:500000000}).reads,500000000);assert.throws(()=>validatedLimits({...LIMITS,reads:500000001}),/LIMITS_INVALID/);assert.throws(()=>validatedLimits(LIMIT,{}),/LIMITS_INVALID/);
 const f=fixture(t),config=f.options(),guard=openWriteBudget(config);try{assert.equal(guard.limits.reads,1000000000);const ticket=await guard.beforeWrite(statements,'publication');guard.complete(ticket,meta());assert.match(fs.readFileSync(path.join(f.directory,'ledger.ndjson'),'utf8'),/paidBootstrapPolicySha256/);}finally{guard.close();}
});
test('stale, tampered, free/unconfirmed or insufficient monthly evidence fails before creating a budget lock',t=>{
 for(const damage of ['stale','tamper','account','plan','headroomWrites','headroomReads','window']){const f=fixture(t);if(damage==='stale')f.usage.at='2026-11-01T11:00:00.000Z';if(damage==='account')f.usage.rolling31days.account='other';if(damage==='plan')f.usage.fixedPlan='Free';if(damage==='headroomWrites')f.usage.rolling31days.rowsWritten=49000000;if(damage==='headroomReads')f.usage.rolling31days.rowsRead=24900000000;if(damage==='window')f.usage.rolling31days.from='2026-10-15';const config=f.options();if(damage==='tamper')fs.appendFileSync(f.proof.monthlyUsage.path,' ');assert.throws(()=>openWriteBudget(config),/PAID_BOOTSTRAP_PROOF_INVALID/);assert.equal(fs.existsSync(path.join(f.directory,'account.lock')),false);}
});
test('source proof must bind exact scope, snapshot, provider checkpoint and reviewed zero-fee artifact',t=>{
 for(const damage of ['unknown','checkpoint','snapshot','scope','fee','job','oldSource','artifact']){const f=fixture(t);if(damage==='unknown')f.plan.sourceEvidence={kind:'unknown',sha256:null};if(damage==='checkpoint')f.plan.sourceEvidence.replayStartSequence=99;if(damage==='snapshot')f.plan.sourceEvidence.snapshotSha256='f'.repeat(64);if(damage==='scope')f.proof.scope='staging';if(damage==='fee')f.proof.additionalFee=1;if(damage==='job')f.proof.job.maxWrites=6000001;if(damage==='oldSource')f.plan.snapshot.requestStartedAt='2026-10-31T10:00:00.000Z';const config=f.options();if(damage==='artifact')fs.appendFileSync(f.proof.sourceEvidenceArtifact.path,' ');assert.throws(()=>openWriteBudget(config),/PAID_BOOTSTRAP_PROOF_INVALID/);}
});
test('same folder source/scope/limits stay pinned; removing optional proof or deleting pin cannot reset work binding',async t=>{
 const f=fixture(t),config=f.options();let guard=openWriteBudget(config);const ticket=await guard.beforeWrite(statements,'publication');guard.complete(ticket,meta());guard.close();
 assert.throws(()=>openWriteBudget({...config,limits:{...LIMIT,reads:500000000},paidBootstrapProof:undefined}),/PROOF_REQUIRED/);
 f.proof.limits.reads=900000000;let changed={...f.options(),limits:{...f.proof.limits}};assert.throws(()=>openWriteBudget(changed),/POLICY_MISMATCH/);assert.equal(fs.existsSync(path.join(f.directory,'account.lock')),false);
 fs.unlinkSync(path.join(f.directory,'paid-bootstrap-policy.json'));f.plan.baselineId='changed';f.proof.limits={...LIMIT};changed=f.options();assert.throws(()=>openWriteBudget(changed),/LEDGER_INVALID/);
});
test('job cumulative actual usage persists across resumes without relabeling account baseline as job usage',async t=>{
 const f=fixture(t);f.proof.job.maxWrites=150;const config=f.options();let guard=openWriteBudget(config);let ticket=await guard.beforeWrite(statements,'publication');guard.complete(ticket,meta());guard.close();
 guard=openWriteBudget(config);try{await assert.rejects(guard.beforeWrite(statements,'publication'),/JOB_STOP/);}finally{guard.close();}
 const ledger=fs.readFileSync(path.join(f.directory,'ledger.ndjson'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(ledger.find(e=>e.kind==='baseline').reads,600000000);assert.equal(ledger.find(e=>e.kind==='complete').reads,1000);
});
test('unknown reservations, actual metadata overrun, wrong target, expiry and account daily reserves remain failclosed',async t=>{
 for(const scenario of ['pending','overrun','target','expiry','reads']){const f=fixture(t),config=f.options();if(scenario==='reads')config.readUsage=async()=>({...f.usage.daily,rowsRead:999500000,at:new Date(f.clock()).toISOString()});let guard=openWriteBudget(config);
  try{if(scenario==='target'){await assert.rejects(guard.beforeWrite(statements,'staging'),/SCOPE_STOP/);continue;}if(scenario==='expiry'){f.setClock(Date.parse(f.proof.expiresAt));await assert.rejects(guard.beforeWrite(statements,'publication'),/SCOPE_STOP/);continue;}if(scenario==='reads'){await assert.rejects(guard.beforeWrite(statements,'publication'),/READ_BUDGET_STOP/);continue;}const ticket=await guard.beforeWrite(statements,'publication');if(scenario==='overrun')assert.throws(()=>guard.complete(ticket,meta(101)),/ESTIMATE_EXCEEDED/);guard.close();guard=openWriteBudget(config);await assert.rejects(guard.beforeWrite(statements,'publication'),/RECONCILIATION_REQUIRED/);}finally{guard.close();}
 }
});
test('proof validation contexts and nested policy cannot be mutated after validation',t=>{
 const f=fixture(t),options=f.options(),context=validatePaidBootstrapProof(options.paidBootstrapProof,{directory:f.directory,now:f.clock(),limits:LIMIT});assert.equal(Object.isFrozen(context.pin.job),true);assert.equal(Object.isFrozen(context.pin.limits),true);assert.throws(()=>{context.pin.job.maxWrites=10000000;},TypeError);assert.equal(validatedLimits(LIMIT,context).reads,1000000000);
});

test('a separately reopened UTC day retains cumulative job usage and requires newly fresh monthly evidence',async t=>{
 const f=fixture(t);f.proof.job.maxWrites=150;let config=f.options(),guard=openWriteBudget(config);let ticket=await guard.beforeWrite(statements,'publication');guard.complete(ticket,meta());guard.close();
 f.setClock(Date.parse('2026-11-02T00:01:00.000Z'));f.proof.createdAt=new Date(f.clock()).toISOString();f.proof.expiresAt='2026-11-02T11:00:00.000Z';
 f.usage.at=new Date(f.clock()).toISOString();Object.assign(f.usage.daily,{day:'2026-11-02',from:'2026-11-02',to:'2026-11-02',at:f.usage.at,rowsRead:0,rowsWritten:0});Object.assign(f.usage.rolling31days,{day:'2026-11-02',from:'2026-10-02',to:'2026-11-02',at:f.usage.at});
 config=f.options();guard=openWriteBudget(config);try{await assert.rejects(guard.beforeWrite(statements,'publication'),/JOB_STOP/);}finally{guard.close();}
});
test('verified context admits only the exact pinned above500M policy',t=>{
 const f=fixture(t),options=f.options(),context=validatePaidBootstrapProof(options.paidBootstrapProof,{directory:f.directory,now:f.clock(),limits:LIMIT});assert.throws(()=>validatedLimits({...LIMIT,reads:900000000},context),/LIMITS_INVALID/);assert.equal(validatedLimits({...LIMIT,reads:500000000}).reads,500000000);
});


function withBoundProof(f){
 const start=f.plan.snapshot.requestStartedAt,ready='2026-11-01T11:52:00.000Z',confirmation=f.write('confirmation.json',{provider:'apibara',N:100,startedAt:start});const artifact=f.write('bound-attestation.json',{version:1,kind:'provider-confirmed-pre-snapshot-checkpoint',provider:'apibara',checkpoint:100,snapshotSha256:f.plan.snapshot.sha256,generationId:f.plan.snapshot.generationId,snapshotStartedAt:start,snapshotReadyAt:ready,capturedNoLaterThan:start,checkpointCapturedBeforeSnapshot:true,confirmedAt:new Date(f.clock()).toISOString(),confirmation});
 const p=canonicalPlan({...f.plan,capture:{sequence:100,capturedAt:null,capturedNoLaterThan:start,timeBasis:'provider-before-start-bound',responseSha256:'a'.repeat(64)},snapshot:{...f.plan.snapshot,generatedAtKnown:true,generatedAt:ready},sourceEvidence:{...f.plan.sourceEvidence,sha256:artifact.sha256}});for(const k of Object.keys(f.plan))delete f.plan[k];Object.assign(f.plan,p);f.proof.sourceEvidenceArtifact=artifact;return {confirmation,artifact};
}
test('bound paid proof uses fresh actual generation and pinned provider attestation without inventing capture age',t=>{const f=fixture(t);withBoundProof(f);const options=f.options(),ctx=validatePaidBootstrapProof(options.paidBootstrapProof,{directory:f.directory,now:f.clock(),limits:LIMIT});assert.equal(ctx.pin.snapshotSha256,f.plan.snapshot.sha256);assert.equal(f.plan.capture.capturedAt,null);assert.equal(validatedLimits(LIMIT,ctx).reads,1000000000);});
test('bound paid proof rejects stale or mismatched attestation and tampered raw confirmation',t=>{
 for(const mode of ['time','beforeReady','N','SHA','generation','start','ready','order','kind','tamper','unboundArtifact']){const f=fixture(t),{confirmation}=withBoundProof(f);if(mode==='tamper')fs.appendFileSync(confirmation.path,' ');else{const a=JSON.parse(fs.readFileSync(f.proof.sourceEvidenceArtifact.path,'utf8'));if(mode==='time')a.confirmedAt='2026-10-30T12:00:00.000Z';if(mode==='beforeReady')a.confirmedAt=a.snapshotStartedAt;if(mode==='N')a.checkpoint=99;if(mode==='SHA')a.snapshotSha256='f'.repeat(64);if(mode==='generation')a.generationId=2;if(mode==='start')a.snapshotStartedAt='2026-11-01T11:50:00.000Z';if(mode==='ready')a.snapshotReadyAt='2026-11-01T11:53:00.000Z';if(mode==='order')a.checkpointCapturedBeforeSnapshot=false;if(mode==='kind')a.kind='unknown';if(mode==='unboundArtifact')delete a.confirmation;const ref=f.write('bound-attestation.json',a);f.proof.sourceEvidenceArtifact=ref;f.plan.sourceEvidence.sha256=ref.sha256;}const options=f.options();assert.throws(()=>openWriteBudget(options),/PAID_BOOTSTRAP_PROOF_INVALID/);assert.equal(fs.existsSync(path.join(f.directory,'account.lock')),false);}
});

function withReplayProof(f,breakMode){
 withBoundProof(f);
 const day=86400000, now=f.clock(), ago=n=>new Date(now-n).toISOString(), start=ago(30*3600000), ready=ago(30*3600000-120000);
 const {capture,snapshot,sourceEvidence}=f.plan, digest='8'.repeat(64), generationId=snapshot.generationId;
 const confirmation=f.write('archive-confirmation.json',{checkpoint:capture.sequence,startedAt:start});
 const attestation=f.write('archive-attestation.json',{version:1,kind:'provider-confirmed-pre-snapshot-checkpoint',provider:'apibara',
  checkpoint:capture.sequence,snapshotSha256:snapshot.sha256,generationId,snapshotStartedAt:start,snapshotReadyAt:ready,
  capturedNoLaterThan:start,checkpointCapturedBeforeSnapshot:true,confirmedAt:ago(12*3600000),confirmation});
 const updated=canonicalPlan({...f.plan,capture:{...capture,capturedNoLaterThan:start},snapshot:{...snapshot,requestStartedAt:start,
  observedAt:ready,generatedAt:ready},sourceEvidence:{...sourceEvidence,sha256:attestation.sha256}});
 Object.assign(f.plan,updated);f.proof.sourceEvidenceArtifact=attestation;
 const files=[{generation:9101,first:95,last:110,afterAnchor:10,observedAt:ago(30*3600000-240000),sha256:'7'.repeat(64)},
  {generation:9102,first:breakMode==='gap'?112:111,last:121,afterAnchor:11,observedAt:ago(breakMode==='stale'?2*3600000:600000),sha256:digest}];
 const range=f.write('verified-range.json',{N:capture.sequence,snapshotGeneration:generationId,strictAdjacency:true,productionWrites:0,
  gaps:[],scans:files,relevantFiles:2,afterAnchorEvents:21,last:files[1]});
 const applied=f.write('offline-applied.json',{snapshotGeneration:generationId,snapshotSha256:snapshot.sha256,
  sourceSequence:capture.sequence,through:121,productionWrites:0,providerRequests:0,foreignKeysPassed:true,protectedCountsUnchanged:true,
  reports:[{generation:9101,after:100,through:110,events:10,bucketProofs:128},
   {generation:9102,after:110,through:121,events:11,bucketProofs:breakMode==='partial'?127:128}]});
 const head=f.write('capture-head.json',{at:ago(3000),readOnly:true,remoteConfirmed:true,remoteWrites:0,providerRequests:0,
  latestDescriptors:[{generationId:breakMode==='head'?9103:9102,observedAt:files[1].observedAt,sha256:digest}]});
 f.proof.replayContinuity=f.write('reviewed-replay.json',{version:1,kind:'reviewed-offline-bootstrap-replay',
  snapshotGeneration:generationId,snapshotSha256:snapshot.sha256,sourceSequence:capture.sequence,checkedAt:ago(3000),
  operatorReviewed:true,range,applied,head});
}
test('provider-bound snapshot older than one day requires a completed adjacent replay through the verified source head',t=>{
 const f=fixture(t);withReplayProof(f);
 const ctx=validatePaidBootstrapProof(f.options().paidBootstrapProof,{directory:f.directory,now:f.clock(),limits:LIMIT});
 assert.equal(ctx.pin.sourceAgePolicy,'verified-replay-72h-v1');
 delete f.proof.replayContinuity;
 assert.throws(()=>openWriteBudget(f.options()),/PAID_BOOTSTRAP_PROOF_INVALID/);
});
test('verified-replay admission does not accept an old head, a gap, a partial replay or a different last file',t=>{
 for(const mode of ['gap','stale','partial','head']){
  const f=fixture(t);withReplayProof(f,mode);
  assert.throws(()=>openWriteBudget(f.options()),/PAID_BOOTSTRAP_PROOF_INVALID/);
 }
});
