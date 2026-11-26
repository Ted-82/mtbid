'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{Readable}=require('node:stream'),{DatabaseSync}=require('node:sqlite');
const {spawnSync}=require('node:child_process');
const indexes=require('../scripts/reliability-indexes.cjs');
const runnerApi=require('../scripts/reliability-index-run.cjs');
const benchmark=require('../scripts/reliability-d1-benchmark.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const NOW=Date.parse('2026-10-25T20:00:00Z');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rexbid-paused-index-'));
  const directory=path.join(root,'new'),originalDirectory=path.join(root,'original'),backup=path.join(root,'backup');
  for(const folder of [directory,originalDirectory,backup,path.join(originalDirectory,'campaign')])fs.mkdirSync(folder,{recursive:true});
  const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
  const files={ledger:path.join(originalDirectory,'campaign/improvement-ledger.ndjson'),stop:path.join(originalDirectory,'campaign/improvement-stop.json'),recovery:path.join(directory,'cached-replay-complete.json'),readback:path.join(directory,'cached-replay-readback.json')};
  const ledger=Array.from({length:2262},(_,i)=>({kind:'attempt',number:i+1,combined:5031+i+1,at:'2026-10-20T19:00:00Z'}));
  ledger.push({kind:'response',number:2262,at:'2026-10-20T19:01:00Z',ok:true,status:200,sha256:'a'.repeat(64)});
  fs.writeFileSync(files.ledger,ledger.map(row=>JSON.stringify(row)).join('\n')+'\n');
  save(files.stop,{at:'2026-10-20T19:02:00Z',code:'IMPROVEMENT_WRITE_FAILED',attempts:2262,targetId:indexes.TARGETS.publication.id});
  save(files.recovery,{at:'2026-10-25T19:00:00Z',passed:true,apibaraRequests:0,backup_sha256:'b'.repeat(64),response_sha256:'a'.repeat(64),result:{status:'committed',cachedResponse:2262,providerRequests:0,listingId:'public-lot',vin:'VIN-ONLY-FIXTURE',observedAt:'2026-10-20T19:01:00Z'}});
  save(files.readback,{at:'2026-10-25T19:01:00Z',passed:true,provider_requests:0,state:{blocked_reason:'OPERATOR_STOP',lease_owner:null,attempts:3254},listing:{listing_id:'public-lot',vin_normalized:'VIN-ONLY-FIXTURE',detail_synced_at:'2026-10-20T19:01:00Z'},receipt:{status:'complete',last_complete_at:'2026-10-20T19:01:00Z'}});
  const closeout={format:'rexbid-paused-campaign-closeout-v1',at:'2026-10-25T19:02:00Z',passed:true,campaignComplete:false,automatic_attempts:3254,manual_attempts:2262,combined_attempts:7293,pending_before:1,pending_after:0,provider_requests:0,files,...Object.fromEntries(Object.entries(files).map(([name,file])=>[name+'_sha256',hash(fs.readFileSync(file))]))};
  save(path.join(directory,'paused-campaign-closeout.json'),closeout);
  save(path.join(originalDirectory,'cron-pause.json'),{attempts:3254,after:{blocked_reason:'OPERATOR_STOP',lease_owner:null,lease_until:null}});
  const sql=fs.readFileSync(runnerApi.ROOT+'/docs/proposals/0004_d1_sync_2.sql','utf8')+'\n'+indexes.PRIVATE.map(table=>`CREATE TABLE ${table}(id TEXT PRIMARY KEY,value TEXT);INSERT INTO ${table} VALUES('private-fixture','DO_NOT_PRINT_PRIVATE_ROWS');`).join('\n');
  const bytes=Buffer.from(sql),dbs={};
  for(const target of ['staging','publication']){dbs[target]=new DatabaseSync(':memory:');dbs[target].exec(sql);}
  const manifest={mode:'publication_and_staging_after_improvement',created_at:'2026-10-25T19:05:00Z',provider_requests:0,databases:Object.values(indexes.TARGETS).map(identity=>({database:identity.name,database_id:identity.id,roundtrip:true,bytes:bytes.length,plaintext_sha256:hash(bytes),ciphertext_sha256:'c'.repeat(64)}))};
  const protectedTables=Object.fromEntries(indexes.PRIVATE.map(table=>{const rows=dbs.staging.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();return[table,{matches:true,after_count:rows.length,after_sha256:hash(JSON.stringify(rows))}];}));
  const preservation={mode:'offline_before_after_backup_preservation',at:'2026-10-25T19:06:00Z',passed:true,targets:Object.fromEntries(Object.entries(indexes.TARGETS).map(([target,identity])=>[target,{database:identity,passed:true,after_created_at:manifest.created_at,plaintext_hashes:{verified:true,after:hash(bytes)},ciphertext_hashes:{verified:true,after:'c'.repeat(64)},health:{after:{integrity:true,foreign_key_violations:0}},preservation:{passed:true},protected_tables:protectedTables}]))};
  save(path.join(backup,'manifest.json'),manifest);save(path.join(directory,'preservation.json'),preservation);
  let tick=NOW,liveAttempts=3254,stopped=true,exhausted=false;
  const calls={runtime:0,tokens:0,ddl:[],queries:[],usage:0};
  const metrics=rows=>({results:rows,success:true,meta:{rows_read:rows.length+5,rows_written:0,changed_db:false,duration:1.5,timings:{sql_duration_ms:1}}});
  const query=(target,sql,params)=>{calls.queries.push({target,sql,params});return sql===indexes.PAUSE_SQL?[{blocked_reason:stopped?'OPERATOR_STOP':null,lease_owner:null,attempts:liveAttempts}]:dbs[target].prepare(sql).all(...params);};
  const services={token(){calls.tokens++;return 'synthetic-token';},async usage(){calls.usage++;return {account:runnerApi.ACCOUNT,day:'2026-10-25',at:new Date(tick).toISOString(),rowsRead:1000,rowsWritten:exhausted?49000000:100};},
    openWriteBudget(options){return require(runnerApi.ROOT+'/scripts/d1-write-budget.cjs').openWriteBudget({...options,now:()=>tick});},
    async connectD1(options){assert.equal(options.readOnly,true);return {identity:indexes.TARGETS[options.target],metadataVerified:true,prepare(sql){return{bind(...params){return{async all(){const value=metrics(query(options.target,sql,params));options.writeBudget?.recordRead([value]);return value;}};}};}};},
    async connectIndexes(options){return{identity:indexes.TARGETS[options.target],async query(sql,params=[]){const rows=query(options.target,sql,params);options.writeBudget.recordRead([metrics(rows)]);return rows;},async executeIndex(name){const index=indexes.INDEXES.find(item=>item.name===name);const ticket=await options.writeBudget.beforeWrite([{sql:index.sql,params:[]}],options.target);dbs[options.target].exec(index.sql);calls.ddl.push({target:options.target,name});options.writeBudget.complete(ticket,[{success:true,meta:{rows_read:1,rows_written:1}}]);}};}
  };
  const runtime=()=>{calls.runtime++;return services;};
  const runner=runnerApi.createRunner({directory,originalDirectory,backup,now:()=>tick,loadRuntime:runtime});
  const bench=benchmark.createRunner({directory,originalDirectory,now:()=>tick,loadRuntime:runtime});
  t.after(()=>{Object.values(dbs).forEach(db=>db.close());bytes.fill(0);const resolved=path.resolve(root),allowed=path.resolve(os.tmpdir())+path.sep;if(!resolved.startsWith(allowed)||!path.basename(resolved).startsWith('rexbid-paused-index-'))throw Error('CLEANUP_OUTSIDE_FIXTURE');fs.rmSync(resolved,{recursive:true,force:true});});
  return {root,directory,originalDirectory,backup,files,closeout,manifest,preservation,bytes,dbs,calls,services,runner,bench,save,
    evidence(target='staging'){return {target,afterManifest:manifest,preservation,pausedCloseout:closeout};},
    attest(target){return runner.run(['attest','--target',target,'--manifest-sha256',hash(fs.readFileSync(path.join(backup,'manifest.json')))],Readable.from([Buffer.from(bytes)]));},
    live(value){liveAttempts=value;},unpause(){stopped=false;},exhaust(){exhausted=true;},advance(ms){tick+=ms;}};
}

test('paused index and benchmark plans are offline, exact targets and seven unchanged SQL indexes',async()=>{
  const run=runnerApi.createRunner({loadRuntime(){throw Error('AUTH_LOADED');}});
  const plan=await run.run(['plan','--target','staging']);
  assert.equal(plan.offline,true);assert.equal(plan.statements.length,7);assert.equal(plan.required_attempts,3254);
  assert.deepEqual(plan.statements,indexes.statementsFromProposal());
  assert.match(plan.backup,/reliability-after-20261025/);
  const bench=benchmark.createRunner({now:()=>NOW,loadRuntime(){throw Error('AUTH_LOADED');}});
  const b=await bench.run(['--plan','--phase','before','--target','publication']);
  assert.equal(b.repeats,3);assert.equal(b.queries.length,7);assert.equal(b.limits.queries,27);
  assert.ok(b.queries.find(q=>q.name==='timed_platform').params.includes('iaai'));
  assert.ok(!(b.queries.find(q=>q.name==='timed_platform').params.includes('copart')));
});

test('closeout binds actual raw evidence and does not declare the campaign complete',t=>{
  const f=fixture(t);assert.deepEqual(indexes.validatePausedCloseout(f.closeout),{passed:true,campaignComplete:false,provider_requests:0});
  assert.doesNotThrow(()=>indexes.validateEvidence(f.evidence()));
  assert.equal(fs.existsSync(path.join(f.directory,'campaign-complete.json')),false);
  fs.appendFileSync(f.files.ledger,'\n');assert.throws(()=>indexes.validatePausedCloseout(f.closeout),/INDEX_PAUSED_BINDING_CHANGED/);
});

test('pending, false completion, altered counts, missing files and unverified recovery are rejected',t=>{
  const f=fixture(t);
  for(const patch of [{pending_after:1},{campaignComplete:true},{automatic_attempts:7293},{manual_attempts:2263},{combined_attempts:0},{provider_requests:1},{passed:false},{files:{...f.files,readback:path.join(f.root,'missing.json')}}])assert.throws(()=>indexes.validatePausedCloseout({...f.closeout,...patch}));
  const recovery=JSON.parse(fs.readFileSync(f.files.recovery));recovery.passed=false;f.save(f.files.recovery,recovery);
  const changed={...f.closeout,recovery_sha256:hash(fs.readFileSync(f.files.recovery))};
  assert.throws(()=>indexes.validatePausedCloseout(changed),/INDEX_PAUSED_RECOVERY_INVALID/);
});

test('original campaign lock, new transfer/recovery locks and stale local automatic count block before auth',async t=>{
  const f=fixture(t);
  for(const file of [path.join(f.originalDirectory,'campaign/improvement.lock'),path.join(f.directory,'transfer-operator.lock'),path.join(f.directory,'recovery.lock')]){
    fs.writeFileSync(file,'fixture');await assert.rejects(f.attest('staging'),/INDEX_CAMPAIGN_RUNNING/);fs.unlinkSync(file);assert.equal(f.calls.runtime,0);
  }
  f.save(path.join(f.originalDirectory,'cron-pause.json'),{attempts:7293,after:{blocked_reason:'OPERATOR_STOP'}});
  await assert.rejects(f.attest('staging'),/INDEX_RUN_EXCLUSIVE_STATE_REQUIRED/);assert.equal(f.calls.runtime,0);
});

test('backup chronology, private preservation and raw SQL attestation remain mandatory',async t=>{
  const f=fixture(t);
  assert.throws(()=>indexes.validateEvidence({...f.evidence(),afterManifest:{...f.manifest,created_at:'2026-10-24T00:00:00Z'}}),/INDEX_FINAL_BACKUP_AND_PRESERVATION_REQUIRED/);
  const bad=structuredClone(f.preservation);bad.targets.staging.protected_tables.users.matches=false;
  assert.throws(()=>indexes.validateEvidence({...f.evidence(),preservation:bad}),/INDEX_PRESERVATION_PROOF_INVALID/);
  await assert.rejects(indexes.attestAfterBackup({...f.evidence(),bytes:Buffer.from('wrong')}),/INDEX_BACKUP_BYTES_MISMATCH/);
  await f.attest('staging');const proof=fs.readFileSync(path.join(f.directory,'index-attestation-staging.json'),'utf8');
  assert.doesNotMatch(proof,/DO_NOT_PRINT_PRIVATE_ROWS|synthetic-token/);assert.equal(f.calls.runtime,0);
});

test('paused stage then production apply use full hashes, exact index readback and unchanged row data',async t=>{
  const f=fixture(t);await f.attest('staging');await f.attest('publication');
  await assert.rejects(f.runner.run(['apply','--target','publication']));assert.equal(f.calls.runtime,0);
  for(const target of ['staging','publication']){
    const result=await f.runner.run(['apply','--target',target]);assert.equal(result.passed,true);assert.equal(result.completed_indexes,7);assert.equal(result.table_hashes_unchanged,true);
    const report=JSON.parse(fs.readFileSync(path.join(f.directory,'index-run-'+target+'.json')));
    assert.deepEqual(report.result.before,report.result.after);assert.equal(report.result.indexes.length,7);
  }
  assert.equal(f.calls.ddl.length,14);assert.ok(f.calls.ddl.slice(0,7).every(x=>x.target==='staging'));
});

test('changed closeout file binding, live auto count and insufficient monthly allowance prevent writes',async t=>{
  for(const mode of ['changed','live','quota']){
    const f=fixture(t);await f.attest('staging');
    if(mode==='changed')fs.appendFileSync(f.files.stop,'\n');if(mode==='live')f.live(3255);if(mode==='quota')f.exhaust();
    await assert.rejects(f.runner.run(['apply','--target','staging']));assert.equal(f.calls.ddl.length,0);
    if(mode==='changed')assert.equal(f.calls.runtime,0);
  }
});

test('before and after benchmark reuse exact frozen clock, SQL, results and three samples',async t=>{
  const f=fixture(t);
  const before=await f.bench.run(['--phase','before','--target','staging']);assert.equal(before.passed,true);assert.equal(before.counters.queries,27);
  indexes.INDEXES.forEach(index=>f.dbs.staging.exec(index.sql));f.advance(86400000);
  const after=await f.bench.run(['--phase','after','--target','staging']);assert.equal(after.passed,true);assert.ok(after.summaries.every(x=>x.ordered_rows_match_before));
  const a=JSON.parse(fs.readFileSync(after.file)),b=JSON.parse(fs.readFileSync(before.file));assert.equal(a.as_of,b.as_of);assert.deepEqual(a.queries,b.queries);assert.equal(a.samples.length,21);
  assert.equal(a.provider_requests,0);assert.equal(a.row_payloads_saved,false);assert.doesNotMatch(JSON.stringify(a),/DO_NOT_PRINT_PRIVATE_ROWS/);
});

test('unpaused or wrong live state prevents benchmark queries and no malformed metrics become results',async t=>{
  const f=fixture(t);f.unpause();await assert.rejects(f.bench.run(['--phase','before','--target','staging']),/BENCHMARK_EXCLUSIVE_STATE_REQUIRED/);
  assert.equal(f.calls.queries.filter(q=>q.sql.includes('SELECT l.*')).length,0);
  assert.throws(()=>benchmark.metrics({results:[],meta:{rows_read:1,rows_written:1,duration:1}},1),/BENCHMARK_D1_METRICS_REQUIRED/);
});

test('row cap remains 5000 and existing index conflicts cannot be ignored',async t=>{
  const f=fixture(t),proof=await indexes.attestAfterBackup({...f.evidence(),bytes:f.bytes});
  const fake=structuredClone(proof);fake.fingerprints.tables.auction_listings.count=4937;
  assert.throws(()=>indexes.createIndexEstimator(fake)([{sql:indexes.INDEXES[0].sql,params:[]}],'staging'),/INDEX_BUILD_ROW_LIMIT/);
  await f.attest('staging');f.dbs.staging.exec('CREATE INDEX idx_listings_public_recent ON auction_listings(lot)');
  await assert.rejects(f.runner.run(['apply','--target','staging']),/INDEX_EXISTING_DEFINITION_CONFLICT/);assert.equal(f.calls.ddl.length,0);
});

test('an uncertain index write leaves a durable pending journal and stops replay without retries',async t=>{
  const f=fixture(t);await f.attest('staging');
  const original=f.services.connectIndexes;
  f.services.connectIndexes=async options=>{
    const db=await original(options);
    return {...db,async executeIndex(name){await db.executeIndex(name);throw Error('SYNTHETIC_UNCERTAIN');}};
  };
  await assert.rejects(f.runner.run(['apply','--target','staging']),/SYNTHETIC_UNCERTAIN/);
  assert.equal(f.calls.ddl.length,1);
  const pending=JSON.parse(fs.readFileSync(path.join(f.directory,'index-journal/indexes-staging.json')));
  assert.equal(pending.pending,indexes.INDEXES[0].name);assert.equal(pending.passed,false);
  await assert.rejects(f.runner.run(['apply','--target','staging']),/INDEX_PENDING_RECONCILIATION_REQUIRED/);
  assert.equal(f.calls.ddl.length,1);
});

test('portable offline plans load with an absent operator directory and no Windows project dependencies',()=>{
  const absent=path.join(os.tmpdir(),'rexbid-operator-not-present-'+process.pid);
  assert.equal(fs.existsSync(absent),false);
  for(const [file,args] of [
    ['reliability-index-run.cjs',['plan','--target','staging']],
    ['reliability-d1-benchmark.cjs',['--plan','--phase','before','--target','publication']],
    ['reliability-indexes.cjs',['plan']]
  ]){
    const result=spawnSync(process.execPath,[path.join(runnerApi.ROOT,'scripts',file),...args],{
      cwd:os.tmpdir(),env:{...process.env,REXBID_OPERATOR_DIRECTORY:absent},encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(result.status,0,result.stderr||result.error?.message);
    assert.equal(JSON.parse(result.stdout).offline,true);
  }
  assert.equal(fs.existsSync(absent),false,'offline plans do not create an operator directory');
  for(const file of ['reliability-indexes.cjs','reliability-index-run.cjs','reliability-d1-benchmark.cjs']){
    const source=fs.readFileSync(path.join(runnerApi.ROOT,'scripts',file),'utf8');
    assert.doesNotMatch(source,/C:\/Users\/nowic|rexbid-improvement-preservation-20261020/);
  }
  assert.equal(typeof benchmark.safeCode,'function');
});

test('portable raw SQL verification preserves in-memory read-only and unsafe import guards',()=>{
  const db=indexes.restoreInMemory(Buffer.from('CREATE TABLE sample(id INTEGER); INSERT INTO sample VALUES(1);'));
  try {assert.equal(db.prepare('SELECT id FROM sample').get().id,1);assert.throws(()=>db.exec('INSERT INTO sample VALUES(2)'));}
  finally {db.close();}
  for(const sql of ["ATTACH DATABASE 'unexpected.sqlite' AS other",'PRAGMA writable_schema=ON','PRAGMA temp_store_directory=\'outside\'']){
    assert.throws(()=>indexes.restoreInMemory(Buffer.from(sql)),/PRESERVATION_UNSAFE_SQL_BLOCKED/);
  }
});
