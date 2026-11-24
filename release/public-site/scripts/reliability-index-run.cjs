'use strict';

// No network, session access or decryption at import time. Remote apply is an
// explicit command, after the PS wrapper has saved an attestation from raw bytes.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const indexes=require('./reliability-indexes.cjs');
const ROOT=path.resolve(__dirname,'..');
const OPERATOR_BASE=indexes.OPERATOR_BASE;
const DIRECTORY=path.join(OPERATOR_BASE,'REXBID_RELIABILITY_20261025');
const BACKUP=path.join(OPERATOR_BASE,'private-backups/rexbid/reliability-after-20261025');
const ACCOUNT='7ff5a57444667c4eda2a6a7f0fc4120d';
const EXPECTED_ATTEMPTS=3254;
const LIMITS=Object.freeze({writes:2000000,reads:100000000,writeReserve:20000,readReserve:500000,maxBatchWrites:5000});
const SHA=/^[a-f0-9]{64}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonHash=value=>hash(JSON.stringify(value));
const fail=code=>{throw Error(code);};
const safeCode=error=>/^[A-Z][A-Z0-9_]{1,100}$/.test(error?.message||'')?error.message:'INDEX_RUN_FAILED';
function parseArgs(argv) {
  if (![3,5].includes(argv.length) || !['plan','attest','apply'].includes(argv[0])
    || argv[1]!=='--target' || !Object.hasOwn(indexes.TARGETS,argv[2])) fail('INDEX_RUN_ARGUMENTS_INVALID');
  if (argv[0]==='attest' ? argv.length!==5 || argv[3]!=='--manifest-sha256' || !SHA.test(argv[4]||'') : argv.length!==3) {
    fail('INDEX_RUN_ARGUMENTS_INVALID');
  }
  return {mode:argv[0],target:argv[2],manifestHash:argv[4]};
}
function atomicJson(file,value) {
  const temporary=file+'.next';
  let fd;
  try {fd=fs.openSync(temporary,'wx');fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}
  finally {if(fd!==undefined)fs.closeSync(fd);}
  fs.renameSync(temporary,file);
}
function readJson(file) {
  const bytes=fs.readFileSync(file);
  return {value:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),sha256:hash(bytes)};
}
function validateMonthlyUsage(value,now=Date.now()) {
  const day=new Date(now).toISOString().slice(0,10);
  if (value?.account!==ACCOUNT || value.day!==day || !Number.isFinite(Date.parse(value.at))
    || Date.parse(value.at)>now+5000 || now-Date.parse(value.at)>300000
    || !['rowsWritten','rowsRead'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)) fail('INDEX_RUN_MONTHLY_USAGE_INVALID');
  if (value.rowsWritten+LIMITS.writes>=50000000 || value.rowsRead+LIMITS.reads>=25000000000) fail('INDEX_RUN_PAID_ALLOWANCE_EXHAUSTED');
}
function createConnections({target,token,budget,connectIndexes,connectD1,now=Date.now}) {
  if (!Object.hasOwn(indexes.TARGETS,target) || typeof token!=='function') fail('INDEX_RUN_CONNECTION_CONFIGURATION');
  let writer,reader;
  async function getWriter() {
    if (!writer || now()-writer.at>=210000) {
      const db=await connectIndexes({target,token:token(),writeBudget:budget});
      if(db.identity?.id!==indexes.TARGETS[target].id || db.identity?.name!==indexes.TARGETS[target].name) fail('INDEX_RUN_TARGET_MISMATCH');
      writer={db,at:now()};
    }
    return writer.db;
  }
  async function getPublicationReader() {
    if(target==='publication')return getWriter();
    if (!reader || now()-reader.at>=210000) {
      const db=await connectD1({target:'publication',token:token(),readOnly:true,writeBudget:budget});
      if(db.identity?.id!==indexes.TARGETS.publication.id || db.identity?.name!==indexes.TARGETS.publication.name) fail('INDEX_RUN_TARGET_MISMATCH');
      reader={db,at:now()};
    }
    return reader.db;
  }
  return {
    db:{identity:indexes.TARGETS[target],
      async query(sql,params=[]){return (await getWriter()).query(sql,params);},
      async executeIndex(name){return (await getWriter()).executeIndex(name);}},
    publicationDb:{identity:indexes.TARGETS.publication,async query(sql,params=[]) {
      if(sql!==indexes.PAUSE_SQL || params.length)fail('INDEX_RUN_GUARD_QUERY_INVALID');
      const db=await getPublicationReader();
      if(target==='publication')return db.query(sql,params);
      const result=await db.prepare(sql).bind(...params).all();
      if(!Array.isArray(result.results))fail('INDEX_RUN_GUARD_RESULT_INVALID');
      return result.results;
    }}
  };
}
function runtime() {
  const session=require(path.join(OPERATOR_BASE,'rexbid-catalog-session.cjs'));
  const {usage}=require(path.join(OPERATOR_BASE,'rexbid-improvement-usage-20261020.cjs'));
  const {openWriteBudget}=require(ROOT+'/scripts/d1-write-budget.cjs');
  const {connectD1}=require(ROOT+'/scripts/d1-operator-bridge.cjs');
  return {token:()=>session.token(),usage,openWriteBudget,connectD1,connectIndexes:indexes.connectIndexes};
}
function createRunner({directory=DIRECTORY,backup=BACKUP,originalDirectory=indexes.ORIGINAL_DIRECTORY,loadRuntime=runtime,now=Date.now}={}) {
  if(!path.isAbsolute(directory)||!path.isAbsolute(backup)||!path.isAbsolute(originalDirectory))fail('INDEX_RUN_PATH_INVALID');
  const file=name=>path.join(directory,name);
  function localPause() {
    indexes.checkLocalLocks(directory,{originalDirectory});
    const pause=readJson(path.join(originalDirectory,'cron-pause.json')).value;
    if(pause.attempts!==EXPECTED_ATTEMPTS || pause.after?.blocked_reason!=='OPERATOR_STOP'
      || pause.after.lease_owner || pause.after.lease_until
      || fs.existsSync(file('campaign/improvement.lock')) || fs.existsSync(file('transfer-operator.lock'))) fail('INDEX_RUN_EXCLUSIVE_STATE_REQUIRED');
    return pause;
  }
  function evidence(target) {
    const files={
      after_manifest:readJson(path.join(backup,'manifest.json')),
      preservation:readJson(file('preservation.json')),
      paused_closeout:readJson(file('paused-campaign-closeout.json')),
      cron_pause:readJson(path.join(originalDirectory,'cron-pause.json'))
    };
    const value={target,afterManifest:files.after_manifest.value,preservation:files.preservation.value,
      pausedCloseout:files.paused_closeout.value};
    indexes.validateEvidence(value);localPause();
    return {value,bindings:Object.fromEntries(Object.entries(files).map(([key,item])=>[key,item.sha256]))};
  }
  function attestation(target,expected) {
    const saved=readJson(file('index-attestation-'+target+'.json')).value;
    if(saved.format!=='rexbid-index-run-attestation-v1' || saved.target!==target
      || saved.proof_sha256!==jsonHash(saved.proof) || jsonHash(saved.bindings)!==jsonHash(expected.bindings)
      || saved.private_rows_saved!==false)fail('INDEX_RUN_ATTESTATION_BINDING_INVALID');
    indexes.validateProof(saved.proof,expected.value);
    return saved;
  }
  async function attest(target,manifestHash,input) {
    const current=evidence(target);
    if(current.bindings.after_manifest!==manifestHash)fail('INDEX_RUN_MANIFEST_HASH_MISMATCH');
    const record=current.value.afterManifest.databases.find(item=>item.database_id===indexes.TARGETS[target].id);
    const chunks=[];let size=0,bytes;
    try {
      for await(const chunk of input) {
        if(!Buffer.isBuffer(chunk))fail('INDEX_RUN_RAW_BYTES_REQUIRED');
        chunks.push(chunk);size+=chunk.length;
        if(size>record.bytes)fail('INDEX_RUN_BACKUP_LENGTH_INVALID');
      }
      bytes=Buffer.concat(chunks);
      const proof=await indexes.attestAfterBackup({...current.value,bytes});
      if(jsonHash(evidence(target).bindings)!==jsonHash(current.bindings))fail('INDEX_RUN_EVIDENCE_CHANGED');
      const location=file('index-attestation-'+target+'.json');
      let saved;
      if(fs.existsSync(location)) {
        saved=attestation(target,current);
        if(saved.proof.fingerprints.sha256!==proof.fingerprints.sha256)fail('INDEX_RUN_ATTESTATION_CHANGED');
      } else {
        saved={format:'rexbid-index-run-attestation-v1',at:new Date(now()).toISOString(),target,
          bindings:current.bindings,proof,proof_sha256:jsonHash(proof),private_rows_saved:false,provider_requests:0};
        atomicJson(location,saved);
      }
      return {mode:'attest',passed:true,target,identity:indexes.TARGETS[target],file:location,
        proof_sha256:saved.proof_sha256,public_tables:5,private_tables:8,private_rows_saved:false,provider_requests:0};
    } finally {chunks.forEach(chunk=>chunk.fill(0));bytes?.fill(0);}
  }
  async function apply(target) {
    const current=evidence(target),saved=attestation(target,current),proof=saved.proof;
    indexes.statementsFromProposal();
    if(target==='publication') {
      const staged=readJson(file('index-journal/indexes-staging.json')).value;
      if(staged.passed!==true || staged.phase!=='complete' || staged.completed_indexes!==7
        || staged.proposal_sha256!==indexes.PROPOSAL_HASH || staged.evidence_sha256!==proof.evidence_sha256) fail('INDEX_RUN_STAGING_SUCCESS_REQUIRED');
    }
    // No session helper or token is touched until every local gate has passed.
    const services=loadRuntime();
    const monthly=await services.usage(services.token(),true);
    validateMonthlyUsage(monthly,now());
    atomicJson(file('index-monthly-usage-'+target+'.json'),monthly);
    const budget=services.openWriteBudget({directory:file('index-d1-budget'),
      readUsage:()=>services.usage(services.token()),estimate:indexes.createIndexEstimator(proof),limits:LIMITS});
    try {
      const connections=createConnections({target,token:services.token,budget,now,
        connectIndexes:services.connectIndexes,connectD1:services.connectD1});
      const guard=async()=>{
        if(jsonHash(evidence(target).bindings)!==jsonHash(current.bindings))fail('INDEX_RUN_EVIDENCE_CHANGED');
        return indexes.checkExclusive({publicationDb:connections.publicationDb,
          campaignDirectory:path.join(originalDirectory,'campaign'),attempts:EXPECTED_ATTEMPTS,
          originalDirectory,evidenceDirectory:directory});
      };
      await guard();
      const result=await indexes.applyIndexes({...current.value,db:connections.db,proof,
        journalDirectory:file('index-journal'),assertExclusive:guard});
      await guard();
      const report={format:'rexbid-index-run-report-v1',at:new Date(now()).toISOString(),target,
        passed:result.passed,completed_indexes:result.completed_indexes,bindings:current.bindings,
        proof_sha256:saved.proof_sha256,report_sha256:jsonHash(result),result,
        private_rows_saved:false,provider_requests:0};
      atomicJson(file('index-run-'+target+'.json'),report);
      return {mode:'apply',target,identity:indexes.TARGETS[target],passed:report.passed,
        completed_indexes:report.completed_indexes,created_this_journal:result.applied.length,
        table_hashes_unchanged:result.before.sha256===result.after.sha256,
        expected_indexes_used:Object.values(result.explain_after).filter(item=>item.expected_index_used).length,
        journal:file('index-journal/indexes-'+target+'.json'),report:file('index-run-'+target+'.json'),
        report_sha256:report.report_sha256,provider_requests:0,private_rows_saved:false};
    } finally {budget.close();}
  }
  async function run(argv,input=process.stdin) {
    const args=parseArgs(argv);
    if(args.mode==='plan')return {mode:'plan',offline:true,target:args.target,identity:indexes.TARGETS[args.target],
      statements:indexes.statementsFromProposal(),required_attempts:EXPECTED_ATTEMPTS,limits:LIMITS,
      backup:path.join(backup,'manifest.json'),preservation:file('preservation.json'),
      shared_budget:file('index-d1-budget'),shared_journal:file('index-journal')};
    fs.mkdirSync(directory,{recursive:true});
    const lock=file('index-run.lock');
    let descriptor;
    try {descriptor=fs.openSync(lock,'wx');}catch{fail('INDEX_RUN_OPERATOR_LOCKED');}
    try {
      return args.mode==='attest'?await attest(args.target,args.manifestHash,input):await apply(args.target);
    } catch(error) {
      atomicJson(file('index-run-last-error-'+args.target+'.json'),{at:new Date(now()).toISOString(),
        mode:args.mode,target:args.target,passed:false,code:safeCode(error),private_rows_saved:false,provider_requests:0});
      throw error;
    } finally {fs.closeSync(descriptor);fs.unlinkSync(lock);}
  }
  return {run,evidence,attestation,localPause};
}
module.exports={OPERATOR_BASE,ROOT,DIRECTORY,BACKUP,ACCOUNT,EXPECTED_ATTEMPTS,LIMITS,parseArgs,
  validateMonthlyUsage,createConnections,createRunner,safeCode};
if(require.main===module)createRunner().run(process.argv.slice(2)).then(result=>{
  process.stdout.write(JSON.stringify(result)+'\n');
}).catch(error=>{process.stdout.write(JSON.stringify({passed:false,code:safeCode(error)})+'\n');process.exitCode=1;});
