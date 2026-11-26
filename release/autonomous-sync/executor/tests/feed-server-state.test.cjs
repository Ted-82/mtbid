'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), {DatabaseSync} = require('node:sqlite');
const {RefreshStore} = require('../sync/automatic-refresh.cjs');
const {ServerFeedState, SEED_SEQUENCE, digest} = require('../sync/feed-server-state.cjs');
const {gzipSync} = require('node:zlib');
const {prepareFeedArchive} = require('../sync/feed-worker-archive.cjs');
const NOW = Date.parse('2026-10-29T11:00:00.000Z'), AT = new Date(NOW).toISOString();
function harness(t, options = {}) {
 const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
 for (const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql'])
  sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 const calls={fault:null,beforeBatch:null,afterCommit:null,clock:NOW};
 const db={prepare(sql){return {bind(...params){return {sql,params,
  async first(){return sqlite.prepare(sql).get(...params)||null;},
  async all(){return {results:sqlite.prepare(sql).all(...params)};},
  async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}
 };}};},async batch(statements){
  calls.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');let result;
  try{result=statements.map(s=>{if(calls.fault?.(s))throw Error('INJECTED_FAILURE');
   return {meta:{changes:Number(sqlite.prepare(s.sql).run(...s.params).changes)}};});sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
  calls.afterCommit?.();return result;
 }};
 const store=new RefreshStore(db,'state-test',()=>calls.clock), state=new ServerFeedState({db,store,...options});
 return {sqlite,db,store,state,calls};
}
function putReceipt(env,taskKey,payload){
 const cursor=JSON.stringify(payload);
 env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES(?,'all',?,?,'complete')").run(taskKey,cursor,AT);
 return {taskKey,cursorSha256:digest(cursor)};
}
// Actual audited aggregate receipts only; no customer rows, credentials or feed URLs.
const LEGACY_STATES = [
 {
  "version": 1,
  "dataset": {
   "identity": "78120012aeb609ee4b75bc6cbba316e4fb0f8cafeefbf4b49eb2700cdbcd1974",
   "databaseSha256": "3fda74d196098cdc94d4d21c36d40e917b231dc784ffee3f01f985d7e7019c85",
   "sources": [
    {
     "generationId": 4948,
     "sha256": "8f938db182ee11fabd32dce2d8a83ccfeb7bf09f4ffaa61bec40a09f55d07311",
     "records": 3052000,
     "firstSequence": 40563105,
     "lastSequence": 43658631
    },
    {
     "generationId": 4959,
     "sha256": "813f5aba735063d1d9bae1bea22d6f7d353c436cd4fb70c3f27654a4e0d54ee1",
     "records": 113806,
     "firstSequence": 43658632,
     "lastSequence": 43772525
    },
    {
     "generationId": 4972,
     "sha256": "e6ee2c40c25027097caf195d0406278acb9a4c1665801026a9eb200e6871aaf0",
     "records": 96000,
     "firstSequence": 43772526,
     "lastSequence": 43870243
    },
    {
     "generationId": 4985,
     "sha256": "592c3cef4c04548394016b9b9cb973e702bf0e8dea7e852a1fa5cca701d36a76",
     "records": 78483,
     "firstSequence": 43870244,
     "lastSequence": 43948965
    },
    {
     "generationId": 4996,
     "sha256": "758043741b9f23896ea4e0b611681575e30497896ee96f8b02576c40ad6e9f5f",
     "records": 65435,
     "firstSequence": 43948966,
     "lastSequence": 44014660
    },
    {
     "generationId": 5006,
     "sha256": "e09da4c9a9a37b805e6d6744b0e205d4e5c3e5d7678686bc8e5089908c321fd8",
     "records": 88725,
     "firstSequence": 44014661,
     "lastSequence": 44103402
    },
    {
     "generationId": 5017,
     "sha256": "4a0fc01c7611d45c03566c8249085e48c8ac37b1cd11bc404bc3363d96bf917a",
     "records": 71522,
     "firstSequence": 44103403,
     "lastSequence": 44174933
    },
    {
     "generationId": 5029,
     "sha256": "88f0b0d4adfe8fa2cb2b06a7af57a08ce107377db819106209556c867c165125",
     "records": 90905,
     "firstSequence": 44174934,
     "lastSequence": 44267593
    }
   ],
   "records": 3656876,
   "quarantined": 13,
   "firstSequence": 40563105,
   "lastSequence": 44267593,
   "uniqueLots": 180435
  },
  "observedAt": "2026-10-29T08:38:43.421Z",
  "offset": 180435,
  "groupedEvents": 3656876,
  "quarantined": 13,
  "updatedGroups": 134135,
  "queuedGroups": 123349,
  "identityErrors": 2060,
  "ignoredEvents": 538455,
  "plannedPatches": 2733631,
  "lastIdentity": "iaai:46476267",
  "firstSequence": 40563105,
  "lastSequence": 44267593,
  "continuityVerified": false,
  "globalCursorEstablished": false
 },
 {
  "version": 1,
  "dataset": {
   "identity": "eb5ee43267e571bde106eba465748d54963e5919fb3e5af3bf49d1f9a68b262e",
   "databaseSha256": "a5afcc99992ffb1a22606ded8badf0ff67c0069b3747d616ab431c9f6990f7a3",
   "sources": [
    {
     "generationId": 2026102901,
     "sha256": "c14b7daf6c4de02b597ae4348d148889139aeddc19d853b4ddefa94b7f8ac943",
     "records": 506602,
     "firstSequence": 44267594,
     "lastSequence": 44779759
    },
    {
     "generationId": 5202,
     "sha256": "947aa00676f251b5d6e5cfc184aa71ecaf33783226dadd4ddf5b48a042c24974",
     "records": 4221,
     "firstSequence": 44779760,
     "lastSequence": 44783983
    },
    {
     "generationId": 5214,
     "sha256": "8ca43b2b06610c4f9ff750d60b76f9f64ab7b54c676bd6555968032b2c6fa990",
     "records": 7236,
     "firstSequence": 44783984,
     "lastSequence": 44794918
    },
    {
     "generationId": 5226,
     "sha256": "8ba43ffb5a7bff8b47931487d6eeab549f4999eb68e1b613617ab5247f1f6f8e",
     "records": 5942,
     "firstSequence": 44794919,
     "lastSequence": 44800863
    },
    {
     "generationId": 5238,
     "sha256": "03b4db5489a4490247b7c868e846058d72cb9c64a7209b52313a18ec20b27f2e",
     "records": 31496,
     "firstSequence": 44800864,
     "lastSequence": 44836990
    },
    {
     "generationId": 5250,
     "sha256": "ff05fdef864df0b377d769887139562ea4d7838f2a097408cec54a5a9412179e",
     "records": 86000,
     "firstSequence": 44836991,
     "lastSequence": 44926591
    },
    {
     "generationId": 5262,
     "sha256": "2ea23d6b9ebb2f2d39a98d503970d5350c39251afcf188b52f83490ba30a4233",
     "records": 112000,
     "firstSequence": 44926592,
     "lastSequence": 45038647
    },
    {
     "generationId": 5273,
     "sha256": "760910211180a9e4115dd387603876bca71eb14364975037f6c7d0de825ed790",
     "records": 111000,
     "firstSequence": 45038648,
     "lastSequence": 45149669
    },
    {
     "generationId": 5285,
     "sha256": "335d5e5e11c0926796dca5e518def7840e4cc9ebfd92278e2aa47dd2418c391f",
     "records": 130000,
     "firstSequence": 45149670,
     "lastSequence": 45279706
    },
    {
     "generationId": 5296,
     "sha256": "49f304b44cb7f9cea6eae079a1aee14f7d6b7825302bdc634ebd9d3f924fd6c8",
     "records": 125000,
     "firstSequence": 45279707,
     "lastSequence": 45404724
    },
    {
     "generationId": 5308,
     "sha256": "0c7e6bb95973f4cbafe3c64b4ce2bf7d3eb87bdd2a1b8985ee0827210388e245",
     "records": 103793,
     "firstSequence": 45404725,
     "lastSequence": 45508546
    },
    {
     "generationId": 5320,
     "sha256": "530832bb3ad4b90b73718960f2982c03ed326c2c0b3cb441aaf1a4c9829b2a8b",
     "records": 61690,
     "firstSequence": 45508547,
     "lastSequence": 45570246
    }
   ],
   "records": 1284980,
   "quarantined": 24,
   "firstSequence": 44267594,
   "lastSequence": 45570246,
   "uniqueLots": 127807
  },
  "observedAt": "2026-10-29T09:48:54.668Z",
  "offset": 127807,
  "groupedEvents": 1284980,
  "quarantined": 24,
  "updatedGroups": 58941,
  "queuedGroups": 51292,
  "identityErrors": 1782,
  "ignoredEvents": 320648,
  "plannedPatches": 722991,
  "lastIdentity": "iaai:46488776",
  "firstSequence": 44267594,
  "lastSequence": 45570246,
  "continuityVerified": false,
  "globalCursorEstablished": false
 }
];
function seedEvidence(env){
 return {sequence:SEED_SEQUENCE,evidenceId:'verified-legacy-two-imports-20261029',legacyReceipts:LEGACY_STATES.map(state=>
  putReceipt(env,'file-changes:'+state.dataset.databaseSha256,structuredClone(state)))};
}
async function setup(env,counts=[2,...Array(127).fill(0)],generationId=12,firstSequence=SEED_SEQUENCE+1,lastSequence=SEED_SEQUENCE+100){
 await env.store.acquire();if(!await env.state.getState())await env.state.seed(seedEvidence(env));
 await env.state.register({compressedBytes:100,generationId,sha256:String(generationId).padStart(64,'a'),rawKey:`raw/${generationId}.gz`,observedAt:AT});
 await env.state.prepare({archiveBytes:1000,generationId,manifestKey:`manifest/${generationId}.json`,manifestSha256:String(generationId).padStart(64,'b'),firstSequence,lastSequence,bucketGroups:counts});
 return env.state.start(generationId);
}
const cp=(env,args)=>env.state.checkpoint({generationId:12,bucketIndex:0,groupOffset:0,nextOffset:2,...args});
function clean(env){
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_guards').get().n,0);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM automatic_refresh_guards').get().n,0);
 assert.deepEqual(env.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
}
async function emptyProof(env,generationId=21,{seed=true}={}){
 await env.store.acquire();if(seed&&!await env.state.getState())await env.state.seed(seedEvidence(env));
 const bytes=gzipSync(''),rawKey=`raw/${generationId}.gz`,rawSha256=digest(bytes),objects=new Map([[rawKey,bytes]]);
 const bucket={async get(key){const data=objects.get(key);if(!data)return null;return{size:data.length,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(data));c.close();}})};},
  async put(key,body,options){if(options?.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;const value=Buffer.from(body);objects.set(key,value);return{key,size:value.length};}};
 const prepared=await prepareFeedArchive({bucket,rawKey,rawSha256,prefix:'empty-test',observedAt:AT,bucketCount:128});
 await env.state.register({generationId,sha256:rawSha256,rawKey,compressedBytes:bytes.length,observedAt:AT});
 const archiveBytes=[...objects].filter(([key])=>key!==rawKey).reduce((n,[,value])=>n+value.length,0);
 return{generationId,manifestKey:prepared.manifestKey,manifestSha256:prepared.manifestSha256,archiveBytes,manifest:prepared.manifest};
}
function resealEmpty(proof,change){const value=structuredClone(proof);change(value.manifest);delete value.manifest.sha256;value.manifest.sha256=digest(JSON.stringify(value.manifest)+'\n');value.manifestSha256=digest(JSON.stringify(value.manifest)+'\n');return value;}
test('real empty gzip completes without advancing cursor or market freshness; replay has no writes',async t=>{
 const env=harness(t),proof=await emptyProof(env),before=await env.state.getState();env.calls.clock+=1000;
 const result=await env.state.completeEmpty(proof);assert.equal(result.alreadyApplied,false);assert.equal(result.generation.status,'complete');
 assert.equal(result.generation.first_sequence,null);assert.equal(result.generation.last_sequence,null);assert.equal(result.generation.bucket_index,128);
 assert.deepEqual(JSON.parse(result.generation.bucket_groups_json),Array(128).fill(0));assert.deepEqual(await env.state.getState(),before);
 assert.equal(await env.state.getNextGeneration(),null);assert.equal((await env.state.storageUsage()).archiveBytes,proof.archiveBytes);
 env.calls.beforeBatch=()=>{throw Error('REPLAY_MUST_NOT_WRITE');};assert.equal((await env.state.completeEmpty(proof)).alreadyApplied,true);
 await assert.rejects(env.state.completeEmpty({...proof,archiveBytes:proof.archiveBytes+1}),/CONFLICT/);clean(env);
});
test('empty completion requires explicit zero counts and null boundaries in sealed root and every bucket',async t=>{
 const env=harness(t),proof=await emptyProof(env);
 const changes=[m=>m.records=1,m=>m.quarantined=1,m=>m.uniqueLots=1,m=>m.decodedBytes=1,m=>m.firstSequence=1,m=>m.lastSequence=1,
  m=>m.firstRecordedAt=AT,m=>m.lastRecordedAt=AT,m=>delete m.records,m=>m.buckets.pop(),m=>m.bucketCount=64,
  m=>m.buckets[10].records=1,m=>m.buckets[10].quarantined=1,m=>m.buckets[10].uniqueLots=1,m=>m.buckets[10].decodedBytes=1,
  m=>m.buckets[10].chunkCount=1,m=>m.buckets[10].firstSequence=1,m=>m.buckets[10].lastSequence=1,m=>m.buckets[10].bucketSha256='a'.repeat(64),
  m=>m.databaseApplied=true,m=>m.continuityVerified=true];
 for(const change of changes)await assert.rejects(env.state.completeEmpty(resealEmpty(proof,change)),/EMPTY_MANIFEST_INVALID/);
 await assert.rejects(env.state.completeEmpty({...proof,manifestSha256:'a'.repeat(64)}),/EMPTY_MANIFEST_INVALID/);
 await assert.rejects(env.state.completeEmpty({...proof,archiveBytes:0}),/EMPTY_MANIFEST_INVALID/);
 assert.equal((await env.state.getGeneration(proof.generationId)).status,'downloaded');clean(env);
});
test('empty proof is bound to immutable raw identity, compressed bytes and original observation',async t=>{
 const env=harness(t),proof=await emptyProof(env);
 for(const change of [m=>m.rawKey='raw/different.gz',m=>m.compressedBytes++,m=>m.observedAt='2026-10-29T10:00:00.000Z'])
  await assert.rejects(env.state.completeEmpty(resealEmpty(proof,change)),/CONFLICT/);
 await assert.rejects(env.state.completeEmpty({...proof,generationId:99}),/STATE_INVALID/);clean(env);
});
test('empty completion requires seeded cursor, downloaded state and no active generation',async t=>{
 const unseeded=harness(t),missing=await emptyProof(unseeded,21,{seed:false});await assert.rejects(unseeded.state.completeEmpty(missing),/STATE_INVALID/);clean(unseeded);
 const env=harness(t);await setup(env);const proof=await emptyProof(env);await assert.rejects(env.state.completeEmpty(proof),/STATE_INVALID/);
 env.sqlite.prepare('UPDATE server_feed_state SET active_generation=NULL').run();await env.state.block(proof.generationId,'BAD_FILE');
 await assert.rejects(env.state.completeEmpty(proof),/STATE_INVALID/);clean(env);
});
test('empty completion is atomic before commit and idempotent after a lost response',async t=>{
 const env=harness(t),proof=await emptyProof(env),before=await env.state.getState();
 env.calls.fault=s=>s.sql.includes("SET status='complete',manifest_key");await assert.rejects(env.state.completeEmpty(proof),/WRITE_FAILED/);
 assert.equal((await env.state.getGeneration(proof.generationId)).manifest_key,null);assert.deepEqual(await env.state.getState(),before);
 env.calls.fault=null;env.calls.afterCommit=()=>{throw Error('SIMULATED_TIMEOUT');};await assert.rejects(env.state.completeEmpty(proof),/WRITE_FAILED/);
 env.calls.afterCommit=null;assert.equal((await env.state.completeEmpty(proof)).alreadyApplied,true);assert.deepEqual(await env.state.getState(),before);clean(env);
});
test('empty completion rejects expired lease and an active-generation race in atomic guard',async t=>{
 const env=harness(t),proof=await emptyProof(env);env.sqlite.prepare("UPDATE automatic_refresh_state SET lease_until='2020-01-01T00:00:00.000Z'").run();
 await assert.rejects(env.state.completeEmpty(proof),/WRITE_FAILED/);await env.store.acquire();
 env.calls.beforeBatch=()=>env.sqlite.prepare('UPDATE server_feed_state SET active_generation=99').run();
 await assert.rejects(env.state.completeEmpty(proof),/WRITE_FAILED/);assert.equal((await env.state.getGeneration(proof.generationId)).status,'downloaded');clean(env);
});
test('explicit seed requires two complete contiguous evidence receipts; never touches API global cursor',async t=>{
 const env=harness(t);await env.store.acquire();const evidence=seedEvidence(env);
 env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('stream:changes','all','123',?,'complete')").run(AT);
 await assert.rejects(env.state.seed({...evidence,sequence:SEED_SEQUENCE+1}),/SEED_INVALID/);
 await assert.rejects(env.state.seed({...evidence,legacyReceipts:[evidence.legacyReceipts[0],{...evidence.legacyReceipts[1],cursorSha256:'c'.repeat(64)}]}),/UNVERIFIED/);
 assert.equal(await env.state.getState(),null);
 const result=await env.state.seed(evidence);assert.equal(result.state.committed_sequence,SEED_SEQUENCE);
 assert.equal((await env.state.seed(evidence)).alreadyApplied,true);
 await assert.rejects(env.state.seed({...evidence,evidenceId:'different'}),/CONFLICT/);
 assert.equal(env.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='stream:changes'").get().cursor,'123');clean(env);
});
test('seed detects proof mutation between hash check and guarded transaction',async t=>{
 const env=harness(t);await env.store.acquire();const evidence=seedEvidence(env);
 env.calls.beforeBatch=()=>env.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=cursor||? WHERE task_key=?').run(' ',evidence.legacyReceipts[0].taskKey);
 await assert.rejects(env.state.seed(evidence),/WRITE_FAILED/);assert.equal(await env.state.getState(),null);clean(env);
});
test('seed rejects arbitrary completed imports, changed dataset identity and incomplete event accounting',async t=>{
 for(const variant of ['key','dataset','events']){
  const env=harness(t);await env.store.acquire();const evidence=seedEvidence(env), receipt=evidence.legacyReceipts[0];
  let cursor=env.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(receipt.taskKey).cursor;
  if(variant==='key'){
   const newKey='file-changes:'+'f'.repeat(64);env.sqlite.prepare('UPDATE automatic_refresh_tasks SET task_key=? WHERE task_key=?').run(newKey,receipt.taskKey);receipt.taskKey=newKey;
  }else{
   const state=JSON.parse(cursor);if(variant==='dataset')state.dataset.sources[0].sha256='f'.repeat(64);else state.groupedEvents--;
   cursor=JSON.stringify(state);env.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(cursor,receipt.taskKey);receipt.cursorSha256=digest(cursor);
  }
  await assert.rejects(env.state.seed(evidence),/SEED_INVALID/);assert.equal(await env.state.getState(),null);clean(env);
 }
});
test('generation and manifest metadata are immutable; duplicate registration is harmless',async t=>{
 const env=harness(t);await env.store.acquire();
 const input={compressedBytes:100,generationId:12,sha256:'a'.repeat(64),rawKey:'raw/12.gz',observedAt:AT};
 await env.state.register(input);assert.equal((await env.state.register(input)).alreadyApplied,true);
 await assert.rejects(env.state.register({compressedBytes:100,...input,rawKey:'raw/other.gz'}),/CONFLICT/);
 const manifest={archiveBytes:1000,generationId:12,manifestKey:'manifest/12.json',manifestSha256:'b'.repeat(64),firstSequence:1,lastSequence:100,bucketGroups:[2,...Array(127).fill(0)]};
 await env.state.prepare(manifest);assert.equal((await env.state.prepare(manifest)).alreadyApplied,true);
 await assert.rejects(env.state.prepare({...manifest,lastSequence:101}),/CONFLICT/);
 assert.equal((await env.state.getNextGeneration()).generation_id,12);clean(env);
});
test('start refuses cross-generation gaps, overlaps and concurrent active generation',async t=>{
 const env=harness(t);await setup(env);await env.state.register({compressedBytes:100,generationId:13,sha256:'c'.repeat(64),rawKey:'raw/13.gz',observedAt:AT});
 await env.state.prepare({archiveBytes:1000,generationId:13,manifestKey:'manifest/13.json',manifestSha256:'d'.repeat(64),firstSequence:SEED_SEQUENCE+101,lastSequence:SEED_SEQUENCE+200,bucketGroups:[1,...Array(127).fill(0)]});
 await assert.rejects(env.state.start(13),/CONTINUITY_GAP/);
 assert.equal((await env.state.start(12)).alreadyApplied,true);
 env.sqlite.exec('UPDATE server_feed_state SET active_generation=NULL');
 await assert.rejects(env.state.start(13),/CONTINUITY_GAP/);clean(env);
});
test('work ordering prepares downloads then prioritizes sequence over large synthetic repair IDs',async t=>{
 const env=harness(t);await setup(env);const active=await env.state.getGeneration(12);
 const synthetic=9000000000000+SEED_SEQUENCE+101;
 await env.state.register({generationId:15,sha256:'f'.repeat(64),rawKey:'raw/15.gz',compressedBytes:10,observedAt:AT});
 await env.state.prepare({generationId:15,manifestKey:'m/15.json',manifestSha256:'e'.repeat(64),archiveBytes:20,
  firstSequence:SEED_SEQUENCE+201,lastSequence:SEED_SEQUENCE+300,bucketGroups:[1,...Array(127).fill(0)]});
 await env.state.register({generationId:synthetic,sha256:'d'.repeat(64),rawKey:`raw/${synthetic}.gz`,compressedBytes:10,observedAt:AT});
 assert.equal((await env.state.getNextGeneration()).generation_id,12);
 // Fixture models prior generation already committed; production uses finish.
 env.sqlite.prepare("UPDATE server_feed_generations SET status='complete',bucket_index=128 WHERE generation_id=12").run();
 env.sqlite.prepare('UPDATE server_feed_state SET active_generation=NULL,committed_sequence=?').run(active.last_sequence);
 assert.equal((await env.state.getNextGeneration()).generation_id,synthetic);
 await env.state.prepare({generationId:synthetic,manifestKey:`m/${synthetic}.json`,manifestSha256:'c'.repeat(64),archiveBytes:20,
  firstSequence:SEED_SEQUENCE+101,lastSequence:SEED_SEQUENCE+200,bucketGroups:[1,...Array(127).fill(0)]});
 assert.equal((await env.state.getNextGeneration()).generation_id,synthetic);
 await env.state.start(synthetic);assert.equal((await env.state.getState()).active_generation,synthetic);clean(env);
});
test('download order uses creation time and blocked work never hides a ready generation',async t=>{
 const env=harness(t);await env.store.acquire();
 await env.state.register({generationId:9000000000001,sha256:'a'.repeat(64),rawKey:'raw/old.gz',compressedBytes:1,observedAt:AT});
 env.calls.clock+=1000;
 await env.state.register({generationId:1,sha256:'b'.repeat(64),rawKey:'raw/new.gz',compressedBytes:1,observedAt:AT});
 assert.equal((await env.state.getNextGeneration()).generation_id,9000000000001);
 await env.state.block(9000000000001,'BAD_FILE');assert.equal((await env.state.getNextGeneration()).generation_id,1);clean(env);
});
test('storage accounting includes raw and derived bytes, complete and blocked until explicit retirement',async t=>{
 const env=harness(t);await env.store.acquire();assert.deepEqual(await env.state.storageUsage(),{generations:0,compressedBytes:0,archiveBytes:0,totalBytes:0});
 await setup(env);assert.deepEqual(await env.state.storageUsage(),{generations:1,compressedBytes:100,archiveBytes:1000,totalBytes:1100});
 await env.state.register({generationId:13,sha256:'c'.repeat(64),rawKey:'raw/13.gz',compressedBytes:300,observedAt:AT});
 await env.state.block(13,'BAD_FILE');env.sqlite.prepare("UPDATE server_feed_generations SET status='complete' WHERE generation_id=12").run();
 assert.equal((await env.state.storageUsage()).totalBytes,1400);
 await assert.rejects(env.state.register({generationId:13,sha256:'c'.repeat(64),rawKey:'raw/13.gz',compressedBytes:301,observedAt:AT}),/CONFLICT/);
 await assert.rejects(env.state.register({generationId:14,sha256:'d'.repeat(64),rawKey:'raw/14.gz',observedAt:AT}),/INVALID/);clean(env);
});
test('all128 buckets required; internal sequence gaps do not prevent complete cursor advancement',async t=>{
 const env=harness(t);await setup(env);
 await assert.rejects(env.state.finish(12),/INCOMPLETE/);
 const receipts=[putReceipt(env,'server-feed-batch:abc:0',{version:1,offset:0,end:2}),putReceipt(env,'file-hydration:abc:0',{version:1,done:true})];
 await cp(env,{receipts});assert.equal((await env.state.getGeneration(12)).bucket_index,1);
 assert.equal((await env.state.getState()).committed_sequence,SEED_SEQUENCE);
 for(let bucketIndex=1;bucketIndex<128;bucketIndex++)await cp(env,{bucketIndex,groupOffset:0,nextOffset:0});
 assert.equal((await env.state.getGeneration(12)).bucket_index,128);
 const result=await env.state.finish(12);assert.equal(result.state.committed_sequence,SEED_SEQUENCE+100);
 assert.equal(result.state.active_generation,null);assert.equal((await env.state.finish(12)).alreadyApplied,true);clean(env);
});
test('partial checkpoint requires complete import receipt and exact current offset',async t=>{
 const env=harness(t);await setup(env);
 const receipts=[putReceipt(env,'server-feed-batch:abc:0',{offset:0,end:1})];
 await assert.rejects(cp(env,{nextOffset:1,receipts:[{...receipts[0],taskKey:'missing'}]}),/UNVERIFIED/);
 await assert.rejects(cp(env,{bucketIndex:1,groupOffset:0,nextOffset:0}),/GAP/);
 await cp(env,{nextOffset:1,receipts});const row=await env.state.getGeneration(12);assert.equal(row.bucket_index,0);assert.equal(row.group_offset,1);
 assert.equal((await cp(env,{nextOffset:1,receipts})).alreadyApplied,true);
 await assert.rejects(cp(env,{nextOffset:2,receipts}),/CONFLICT/);
 await assert.rejects(cp(env,{groupOffset:0,nextOffset:1,receipts:[]}),/INVALID/);clean(env);
});
test('checkpoint accepts8 proof receipts and rejects9 before advancing',async t=>{
 const env=harness(t);await setup(env);const receipts=Array.from({length:9},(_,i)=>putReceipt(env,`file-hydration:test:${i}`,{done:true,index:i}));
 await assert.rejects(cp(env,{receipts}),/RECEIPT_INVALID/);assert.equal((await env.state.getGeneration(12)).bucket_index,0);
 await cp(env,{receipts:receipts.slice(0,8)});assert.equal((await env.state.getGeneration(12)).bucket_index,1);clean(env);
});
test('checkpoint transaction failure leaves offset, receipt and outbox unchanged',async t=>{
 const env=harness(t);await setup(env);const receipts=[putReceipt(env,'server-feed-batch:abc:0',{done:true})];
 const outbox=[{jobKey:'apply:12:1:0',kind:'apply',payload:{generationId:12,bucketIndex:1,groupOffset:0}}];
 env.calls.fault=s=>s.sql.startsWith('UPDATE server_feed_generations SET bucket_index');
 await assert.rejects(cp(env,{receipts,outbox}),/WRITE_FAILED/);
 assert.equal((await env.state.getGeneration(12)).group_offset,0);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_receipts').get().n,0);
 assert.equal((await env.state.pendingOutbox()).length,0);
 env.calls.fault=null;await cp(env,{receipts,outbox});assert.equal((await env.state.pendingOutbox()).length,1);clean(env);
});
test('timeout after committed checkpoint replays without advancing or queuing twice',async t=>{
 const env=harness(t);await setup(env);const receipts=[putReceipt(env,'server-feed-batch:abc:0',{done:true})];
 env.calls.afterCommit=()=>{throw Error('SIMULATED_TIMEOUT');};await assert.rejects(cp(env,{receipts}),/WRITE_FAILED/);
 env.calls.afterCommit=null;const replay=await cp(env,{receipts});assert.equal(replay.alreadyApplied,true);assert.equal(replay.generation.bucket_index,1);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_receipts').get().n,1);clean(env);
});
test('receipt changed after validation rolls entire checkpoint back',async t=>{
 const env=harness(t);await setup(env);const receipts=[putReceipt(env,'server-feed-batch:abc:0',{done:true})];
 env.calls.beforeBatch=()=>env.sqlite.prepare("UPDATE automatic_refresh_tasks SET status='pending' WHERE task_key=?").run(receipts[0].taskKey);
 await assert.rejects(cp(env,{receipts}),/WRITE_FAILED/);assert.equal((await env.state.getGeneration(12)).bucket_index,0);clean(env);
});
test('expired, stolen, blocked global leases prevent state writes',async t=>{
 for(const mutation of ["lease_until='2020-01-01T00:00:00.000Z'","lease_owner='other'","blocked_reason='BLOCKED'"]){
  const env=harness(t);await env.store.acquire();env.sqlite.exec(`UPDATE automatic_refresh_state SET ${mutation}`);
  await assert.rejects(env.state.register({compressedBytes:100,generationId:1,sha256:'a'.repeat(64),rawKey:'raw/1.gz',observedAt:AT}),/WRITE_FAILED/);
  assert.equal(await env.state.getGeneration(1),null);clean(env);
 }
});
test('outbox dispatch timeout remains rediscoverable; immutable payload and bounded retries',async t=>{
 const env=harness(t);await env.store.acquire();const entry={jobKey:'prepare:12',kind:'prepare',payload:{generationId:12}};
 await env.state.enqueue(entry);await env.state.enqueue(entry);assert.equal((await env.state.pendingOutbox()).length,1);
 await assert.rejects(env.state.enqueue({...entry,payload:{generationId:13}}),/WRITE_FAILED/);
 await env.state.markDispatched(entry.jobKey,1000);assert.equal((await env.state.pendingOutbox()).length,0);
 env.calls.clock+=1001;assert.equal((await env.state.pendingOutbox()).length,1);
 await env.state.retry(entry.jobKey,'UPSTREAM',1000,2);env.calls.clock+=1001;assert.equal((await env.state.pendingOutbox()).length,1);
 await env.state.retry(entry.jobKey,'UPSTREAM',1000,2);env.calls.clock+=1001;assert.equal((await env.state.pendingOutbox()).length,0);
 assert.equal(env.sqlite.prepare('SELECT status FROM server_feed_outbox').get().status,'blocked');clean(env);
});
test('daily reservation is atomic, idempotent, capped; unknown usage keeps capacity reserved',async t=>{
 const env=harness(t,{dailyWrites:10,dailyReads:100});await env.store.acquire();
 assert.equal((await env.state.reserveBudget('job1',{rowsWritten:8,rowsRead:70})).alreadyReserved,false);
 assert.equal((await env.state.reserveBudget('job1',{rowsWritten:8,rowsRead:70})).alreadyReserved,true);
 await assert.rejects(env.state.reserveBudget('job1',{rowsWritten:8,rowsRead:71}),/CONFLICT/);
 await assert.rejects(env.state.reserveBudget('job2',{rowsWritten:3,rowsRead:1}),/WRITE_FAILED|BUDGET_STOP/);
 const unknown=await env.state.settleBudget('job1',null);assert.equal(unknown.settled,false);
 assert.equal(env.sqlite.prepare('SELECT reserved_writes FROM server_feed_daily_budgets').get().reserved_writes,8);
 await env.state.settleBudget('job1',{rowsWritten:5,rowsRead:40});await env.state.reserveBudget('job2',{rowsWritten:5,rowsRead:60});
 const row=env.sqlite.prepare('SELECT * FROM server_feed_daily_budgets').get();assert.equal(row.consumed_writes,5);assert.equal(row.reserved_writes,5);
 assert.equal((await env.state.settleBudget('job1',{rowsWritten:5,rowsRead:40})).alreadySettled,true);
 await assert.rejects(env.state.settleBudget('job1',{rowsWritten:4,rowsRead:40}),/CONFLICT/);clean(env);
});
test('reservation timeout after commit retains spent capacity; real overrun stops later jobs',async t=>{
 const env=harness(t,{dailyWrites:10,dailyReads:100});await env.store.acquire();
 env.calls.afterCommit=()=>{throw Error('TIMEOUT');};await assert.rejects(env.state.reserveBudget('a',{rowsWritten:8,rowsRead:10}),/WRITE_FAILED/);
 env.calls.afterCommit=null;assert.equal((await env.state.reserveBudget('a',{rowsWritten:8,rowsRead:10})).alreadyReserved,true);
 await env.state.settleBudget('a',{rowsWritten:11,rowsRead:10});
 assert.equal(env.sqlite.prepare('SELECT consumed_writes FROM server_feed_daily_budgets').get().consumed_writes,11);
 await assert.rejects(env.state.reserveBudget('b',{rowsWritten:1,rowsRead:1}),/WRITE_FAILED|BUDGET_STOP/);clean(env);
});
test('settlement after midnight credits original day; unknown prior day is never refunded',async t=>{
 const env=harness(t,{dailyWrites:10,dailyReads:100});await env.store.acquire();
 await env.state.reserveBudget('yesterday',{rowsWritten:8,rowsRead:10});env.calls.clock+=86400000;await env.store.acquire();
 await env.state.reserveBudget('today',{rowsWritten:10,rowsRead:100});await env.state.settleBudget('yesterday',{rowsWritten:7,rowsRead:9});
 const rows=env.sqlite.prepare('SELECT * FROM server_feed_daily_budgets ORDER BY day_key').all();
 assert.equal(rows[0].consumed_writes,7);assert.equal(rows[0].reserved_writes,0);assert.equal(rows[1].reserved_writes,10);clean(env);
});

const ALLOWANCE={REXBID_FEED_READ_ALLOWANCE_DAY:'2026-10-31',REXBID_FEED_READ_ALLOWANCE_LIMIT:'100000000'};
const ALLOWANCE_KEY='server-feed-read-allowance:2026-10-31';
function allowanceHarness(t,options={}){
 const h=harness(t,options);h.calls.clock=Date.parse('2026-10-31T12:00:00.000Z');
 // Test the SQL UTC-date fence using the same injected clock as the state/store.
 h.sqlite.function('date',value=>value==='now'?new Date(h.calls.clock).toISOString().slice(0,10):new Date(value).toISOString().slice(0,10));
 return h;
}
function allowanceBudget(h,changes={}){
 const row={day_key:'2026-10-31',write_limit:1000000,read_limit:50000000,reserved_writes:12,reserved_reads:9000,
  consumed_writes:26927,consumed_reads:50086825,updated_at:'2026-10-31T11:00:00.000Z',...changes};
 h.sqlite.prepare(`INSERT INTO server_feed_daily_budgets(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
 return h.sqlite.prepare('SELECT * FROM server_feed_daily_budgets WHERE day_key=?').get(row.day_key);
}
const allowanceRow=h=>h.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(ALLOWANCE_KEY);
const currentBudget=h=>h.sqlite.prepare("SELECT * FROM server_feed_daily_budgets WHERE day_key='2026-10-31'").get();

const FLEX={REXBID_FEED_D1_BUDGET_MODE:'rolling-31d-v1'};
const accountConfig=(days=[])=>({REXBID_FEED_D1_BUDGET_MODE:'account-31d-v1',REXBID_FEED_ACCOUNT_BUDGET:JSON.stringify({version:1,measuredAt:'2026-10-31T10:00:00Z',databaseMaxBytes:1400000000,days})});
test('the approved 8 GB catalogue keeps the existing reserve and rejects larger budgets',()=>{
 const {parseAccountBudget,assertAccountStorage,accountAllowance}=require('../sync/feed-account-budget.cjs');
 const original=accountConfig(),p=JSON.parse(original.REXBID_FEED_ACCOUNT_BUDGET);
 const configured=bytes=>parseAccountBudget({REXBID_FEED_ACCOUNT_BUDGET:JSON.stringify({...p,databaseMaxBytes:bytes})});
 const enlarged=configured(8000000000);
 assert.doesNotThrow(()=>assertAccountStorage(enlarged,7992000000));
 assert.throws(()=>assertAccountStorage(enlarged,7992000001),/STORAGE_BUDGET_STOP/);
 assert.throws(()=>configured(8000000001),/ACCOUNT_POLICY_INVALID/);
 assert.deepEqual(accountAllowance(enlarged,'2026-10-01','2026-10-31'),accountAllowance(p,'2026-10-01','2026-10-31'));
});
test('account allowance resumes beyond 1M without resetting persisted counters and preserves unresolved writes',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h,{consumed_writes:995363,reserved_writes:0,reserved_reads:0,consumed_reads:14000000});
 await h.store.acquire();h.state.configureFlexibleBudget(accountConfig([{day:'2026-10-30',writes:34000000,reads:5500000000}]));
 await h.state.reserveBudget('account-resume',{rowsWritten:5000,rowsRead:50000});
 assert.equal(currentBudget(h).consumed_writes,995363);assert.equal(currentBudget(h).reserved_writes,5000);
 assert.equal((await h.state.flexibleBudgetUsage()).writeLimit,15000000);
 await h.state.settleBudget('account-resume',null);assert.equal(currentBudget(h).reserved_writes,5000);
 clean(h);
});
test('account allowance enforces other-database usage atomically and only releases dated historic usage after 31 days',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h,{consumed_writes:995000,reserved_writes:0,reserved_reads:0,consumed_reads:0});
 await h.store.acquire();h.state.configureFlexibleBudget(accountConfig([{day:'2026-10-01',writes:48000000,reads:0}]));
 h.calls.beforeBatch=()=>h.sqlite.exec("UPDATE server_feed_daily_budgets SET consumed_writes=999999");
 await assert.rejects(h.state.reserveBudget('account-race',{rowsWritten:5000,rowsRead:1}),/WRITE_FAILED/);
 h.calls.beforeBatch=null;
 assert.equal(h.sqlite.prepare("SELECT 1 FROM server_feed_reservations WHERE reservation_key='account-race'").get(),undefined);
 await assert.rejects(h.state.reserveBudget('account-full',{rowsWritten:5000,rowsRead:1}),/ROLLING_BUDGET_STOP/);
 h.calls.clock+=86400000;await h.store.acquire();
 assert.equal((await h.state.flexibleBudgetUsage()).writeLimit,49000000);
 await h.state.reserveBudget('account-aged',{rowsWritten:5000,rowsRead:1});clean(h);
});
test('account policy rejects missing or malformed evidence and unknown storage measurement',()=>{
 const {parseAccountBudget,assertAccountStorage}=require('../sync/feed-account-budget.cjs');
 assert.throws(()=>parseAccountBudget({}),/ACCOUNT_POLICY_INVALID/);
 assert.throws(()=>parseAccountBudget(accountConfig([{day:'2026-10-31',writes:-1,reads:0}])),/ACCOUNT_POLICY_INVALID/);
 const p=parseAccountBudget(accountConfig());
 assert.doesNotThrow(()=>assertAccountStorage(p,1292312576));
 assert.throws(()=>assertAccountStorage(p,1392000001),/STORAGE_BUDGET_STOP/);
 assert.throws(()=>assertAccountStorage(p,NaN),/ACCOUNT_POLICY_INVALID/);
});
test('account cycle counts the UTC renewal day in both periods and ignores usage from earlier billing cycles',async t=>{
 const h=allowanceHarness(t);
 h.calls.clock=Date.parse('2026-11-06T13:00:00Z');
 allowanceBudget(h,{day_key:'2026-10-05',consumed_writes:40000000});
 allowanceBudget(h,{day_key:'2026-11-05',consumed_writes:28000000,reserved_writes:1000000});
 allowanceBudget(h,{day_key:'2026-11-06',consumed_writes:230000,reserved_writes:5000});
 const p={version:2,billingDay:6,measuredAt:'2026-11-06T10:00:00Z',databaseMaxBytes:2200000000,
   days:[{day:'2026-11-05',writes:25000000,reads:1}]};
 h.state.configureFlexibleBudget({REXBID_FEED_D1_BUDGET_MODE:'account-cycle-v2',REXBID_FEED_ACCOUNT_BUDGET:JSON.stringify(p)});
 await h.store.acquire();
 const request={rowsWritten:5000,rowsRead:50000};
 const before=await h.state.flexibleBudgetUsage();
 assert.equal(before.firstDay,'2026-10-06');
 assert.equal(before.writes,29235000);
 await assert.rejects(h.state.reserveBudget('renewal-day-stop',request),/ROLLING_BUDGET_STOP/);
 h.calls.clock+=86400000;await h.store.acquire();
 const after=await h.state.flexibleBudgetUsage();
 assert.equal(after.firstDay,'2026-11-06');
 assert.equal(after.writes,235000);
 assert.equal(after.writeLimit,49000000-31*160000);
 await h.state.reserveBudget('after-renewal',request);clean(h);
});
test('a closed account measurement replaces past write estimates only for its own cycle',()=>{
 const {parseAccountBudget,accountAllowance,allowSupplementalWrites}=require('../sync/feed-account-budget.cjs');
 const measured={version:2,billingDay:6,measuredAt:'2026-11-22T19:00Z',databaseMaxBytes:8e9,
  days:[{day:'2026-11-09',writes:19e6,reads:500e6}],prioritizePublication:true,
  writeMeter:{from:'2026-11-06',through:'2026-11-20',outsideWrites:17.1e6}};
 const read=policy=>parseAccountBudget({REXBID_FEED_ACCOUNT_BUDGET:JSON.stringify(policy)},2);
 const config=read(measured),prior=read({...measured,writeMeter:undefined});
 const allowance=accountAllowance(config,'2026-11-06','2026-11-22');
 assert.equal(allowance.writeLimit,49e6-17.1e6-16*160000);
 assert.equal(allowance.readLimit,accountAllowance(prior,'2026-11-06','2026-11-22').readLimit);
 for(const [from,day] of [['2026-11-06','2026-11-20'],['2026-12-06','2026-12-07']])
  assert.deepEqual(accountAllowance(config,from,day),accountAllowance(prior,from,day));
 const window={...allowance,firstDay:'2026-11-06',day:'2026-11-22'};
 assert.equal(allowSupplementalWrites(config,{...window,writes:window.writeLimit-15*1.1e6}),true);
 assert.equal(allowSupplementalWrites(config,{...window,writes:window.writeLimit-15*1.1e6+1}),false);
 for(const patch of [{from:'2026-11-07'},{through:'2026-11-31'},{through:'2026-11-22'},{outsideWrites:-1}])
  assert.throws(()=>read({...measured,writeMeter:{...measured.writeMeter,...patch}}),/ACCOUNT_POLICY_INVALID/);
});
test('rolling feed budget uses unused capacity past the ordinary day cap and preserves a burst ceiling',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h,{consumed_writes:995311,consumed_reads:49990000,reserved_writes:0,reserved_reads:0});
 await h.store.acquire();
 const request={rowsWritten:5000,rowsRead:50000};
 await assert.rejects(h.state.reserveBudget('daily-stop',request),/DAILY_BUDGET_STOP/);
 h.state.configureFlexibleBudget(FLEX);
 await h.state.reserveBudget('burst',request);
 assert.equal((await h.state.reserveBudget('burst',request)).alreadyReserved,true);
 assert.equal((await h.state.flexibleBudgetUsage()).writes,1000311);
 assert.equal((await h.state.flexibleBudgetUsage()).reads,50040000);
 assert.equal(currentBudget(h).write_limit,1000000);
 await h.state.settleBudget('burst',{rowsWritten:4000,rowsRead:30000});
 h.sqlite.exec("UPDATE server_feed_daily_budgets SET consumed_writes=2995001");
 await assert.rejects(h.state.reserveBudget('burst-stop',request),/DAILY_BUDGET_STOP/);
 h.state.configureFlexibleBudget({});
 await assert.rejects(h.state.reserveBudget('after-rollback',request),/DAILY_BUDGET_STOP/);
 clean(h);
});
test('rolling cap charges unresolved reservations across midnight and ages out whole UTC days',async t=>{
 const h=allowanceHarness(t);
 allowanceBudget(h,{day_key:'2026-10-01',consumed_writes:10000,consumed_reads:0,reserved_writes:0,reserved_reads:0});
 for(let day=2;day<=30;day++)allowanceBudget(h,{day_key:`2026-10-${String(day).padStart(2,'0')}`,
   consumed_writes:1200000+(day===2?186000:0),consumed_reads:0,reserved_writes:0,reserved_reads:0});
 await h.store.acquire();h.state.configureFlexibleBudget(FLEX);
 const request={rowsWritten:1000000,rowsRead:0};
 await h.state.reserveBudget('unresolved',request);
 assert.equal((await h.state.settleBudget('unresolved',null)).settled,false);
 assert.equal((await h.state.flexibleBudgetUsage()).writes,35996000);
 await assert.rejects(h.state.reserveBudget('over',{rowsWritten:5000,rowsRead:0}),/ROLLING_BUDGET_STOP/);
 h.calls.clock+=86400000;await h.store.acquire();
 assert.equal((await h.state.flexibleBudgetUsage()).writes,35986000);
 await h.state.reserveBudget('new-day',{rowsWritten:10000,rowsRead:0});
 await assert.rejects(h.state.reserveBudget('still-over',{rowsWritten:5000,rowsRead:0}),/ROLLING_BUDGET_STOP/);
 assert.equal(h.sqlite.prepare("SELECT reserved_writes FROM server_feed_daily_budgets WHERE day_key='2026-10-31'").get().reserved_writes,1000000);
 clean(h);
});
test('rolling read ceiling is enforced inside the batch even if usage changes after the initial read',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h,{day_key:'2026-10-30',consumed_writes:0,consumed_reads:1549900000,
  reserved_writes:0,reserved_reads:0});
 await h.store.acquire();h.state.configureFlexibleBudget(FLEX);
 h.calls.beforeBatch=()=>h.sqlite.exec("UPDATE server_feed_daily_budgets SET consumed_reads=1549999999");
 await assert.rejects(h.state.reserveBudget('raced',{rowsWritten:1,rowsRead:50000}),/WRITE_FAILED/);
 h.calls.beforeBatch=null;
 assert.equal(currentBudget(h),undefined);
 assert.equal(h.sqlite.prepare("SELECT 1 FROM server_feed_reservations WHERE reservation_key='raced'").get(),undefined);
 await assert.rejects(h.state.reserveBudget('still-over',{rowsWritten:1,rowsRead:50000}),/ROLLING_BUDGET_STOP/);
 clean(h);
});
test('rolling mode preserves lower daily limits, forbids stacking allowances and rejects a reservation across midnight',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h,{read_limit:40000000,consumed_reads:39999999});
 await h.store.acquire();h.state.configureFlexibleBudget(FLEX);
 await assert.rejects(h.state.reserveBudget('lower',{rowsWritten:1,rowsRead:2}),/DAILY_BUDGET_STOP/);
 assert.throws(()=>h.state.configureFlexibleBudget({...FLEX,REXBID_FEED_D1_RECOVERY_ID:'old'}),/FLEX_BUDGET_CONFIG/);
 assert.throws(()=>h.state.configureFlexibleBudget({REXBID_FEED_D1_BUDGET_MODE:'typo'}),/FLEX_BUDGET_CONFIG/);
 clean(h);
 const next=allowanceHarness(t);next.calls.clock=Date.parse('2026-10-31T23:59:59Z');
 await next.store.acquire();await next.state.applyReadAllowance(ALLOWANCE);
 assert.throws(()=>next.state.configureFlexibleBudget(FLEX),/FLEX_BUDGET_CONFIG/);
 next.state.readAllowance=null;next.state.configureFlexibleBudget(FLEX);
 const before=currentBudget(next);
 next.calls.beforeBatch=()=>{next.calls.clock+=1500;};
 await assert.rejects(next.state.reserveBudget('midnight',{rowsWritten:1,rowsRead:1}),/WRITE_FAILED/);
 assert.deepEqual(currentBudget(next),before);
 clean(next);
});

test('explicit one-day read allowance preserves base50M and all counters, exposes effective100M, never raises writes',async t=>{
 const h=allowanceHarness(t);const before=allowanceBudget(h);await h.store.acquire();
 assert.equal((await h.state.applyReadAllowance({})).effectiveReadLimit,50000000);
 await assert.rejects(h.state.reserveBudget('stopped-before',{rowsWritten:5000,rowsRead:50000}),/BUDGET_STOP/);
 const policy=await h.state.applyReadAllowance(ALLOWANCE);assert.deepEqual(policy,{day:'2026-10-31',baseReadLimit:50000000,effectiveReadLimit:100000000,allowanceActive:true});
 assert.deepEqual(currentBudget(h),before,'activation does not reset, clamp, refund or rewrite counters');
 const receipt=JSON.parse(allowanceRow(h).cursor);assert.equal(receipt.effectiveReadLimit,100000000);assert.equal(receipt.before.consumed_reads,before.consumed_reads);
 await h.state.reserveBudget('allowed',{rowsWritten:5000,rowsRead:50000});
 const after=currentBudget(h);assert.equal(after.read_limit,50000000);assert.equal(after.write_limit,1000000);
 assert.equal(after.consumed_reads,before.consumed_reads);assert.equal(after.consumed_writes,before.consumed_writes);
 assert.equal(after.reserved_reads,before.reserved_reads+50000);assert.equal(after.reserved_writes,before.reserved_writes+5000);
 const immutableCursor=allowanceRow(h).cursor;await h.state.applyReadAllowance(ALLOWANCE);
 await h.state.settleBudget('allowed',{rowsWritten:10,rowsRead:72});await h.state.applyReadAllowance(ALLOWANCE);
 assert.equal(allowanceRow(h).cursor,immutableCursor,'policy replay does not compare against obsolete initial counters');
 assert.equal(currentBudget(h).consumed_reads,before.consumed_reads+72);assert.equal(currentBudget(h).reserved_reads,before.reserved_reads);
 assert.equal(currentBudget(h).consumed_writes,before.consumed_writes+10);assert.equal(currentBudget(h).reserved_writes,before.reserved_writes);clean(h);
});

test('day-scoped allowance configuration validates ISO day and strict100M maximum before any mutation',async t=>{
 const h=allowanceHarness(t);await h.store.acquire();
 const {readAllowancePolicy}=require('../sync/feed-server-state.cjs');
 for(const change of [{REXBID_FEED_READ_ALLOWANCE_DAY:'2026-02-31'}, {REXBID_FEED_READ_ALLOWANCE_DAY:'2026-11-01'},
  {REXBID_FEED_READ_ALLOWANCE_LIMIT:'100000001'},{REXBID_FEED_READ_ALLOWANCE_LIMIT:'50000000'},
  {REXBID_FEED_READ_ALLOWANCE_LIMIT:'1e8'},{REXBID_FEED_READ_ALLOWANCE_LIMIT:100000000}]){
  assert.throws(()=>readAllowancePolicy({...ALLOWANCE,...change},h.calls.clock),/CONFIG_INVALID/);
 }
 assert.throws(()=>readAllowancePolicy({REXBID_FEED_READ_ALLOWANCE_DAY:'2026-10-31'},h.calls.clock),/CONFIG_INVALID/);
 assert.equal(readAllowancePolicy({...ALLOWANCE,REXBID_FEED_READ_ALLOWANCE_DAY:'2026-10-30'},h.calls.clock),null);
 const before=h.sqlite.prepare('SELECT total_changes() n').get().n;
 await assert.rejects(h.state.applyReadAllowance({...ALLOWANCE,REXBID_FEED_READ_ALLOWANCE_LIMIT:'100000001'}),/CONFIG_INVALID/);
 assert.equal(h.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(allowanceRow(h),undefined);clean(h);
});

test('allowance receipt replay is immutable and lost activation acknowledgement cannot create another allowance',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h);await h.store.acquire();h.calls.afterCommit=()=>{throw Error('LOST_ACK');};
 await assert.rejects(h.state.applyReadAllowance(ALLOWANCE),/WRITE_FAILED/);const receipt=allowanceRow(h).cursor,before=currentBudget(h);
 h.calls.afterCommit=null;const changes=h.sqlite.prepare('SELECT total_changes() n').get().n;
 await h.state.applyReadAllowance(ALLOWANCE);await h.state.applyReadAllowance(ALLOWANCE);
 assert.equal(h.sqlite.prepare('SELECT total_changes() n').get().n,changes);assert.equal(allowanceRow(h).cursor,receipt);assert.deepEqual(currentBudget(h),before);
 await assert.rejects(h.state.applyReadAllowance({...ALLOWANCE,REXBID_FEED_READ_ALLOWANCE_LIMIT:'75000000'}),/RECEIPT_CONFLICT/);
 assert.equal(h.state.readPolicy().allowanceActive,false);clean(h);
});

test('old allowance is ignored on new UTC day and default50M resumes without touching previous counters',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h);await h.store.acquire();await h.state.applyReadAllowance(ALLOWANCE);
 await h.state.reserveBudget('old-day',{rowsWritten:5000,rowsRead:50000});const before=currentBudget(h),receipt=allowanceRow(h).cursor;
 h.calls.clock+=86400000;await h.store.acquire();
 assert.deepEqual(await h.state.applyReadAllowance(ALLOWANCE),{day:'2026-11-01',baseReadLimit:50000000,effectiveReadLimit:50000000,allowanceActive:false});
 await h.state.reserveBudget('new-day',{rowsWritten:5000,rowsRead:50000});
 assert.deepEqual(currentBudget(h),before);assert.equal(allowanceRow(h).cursor,receipt);
 const next=h.sqlite.prepare("SELECT * FROM server_feed_daily_budgets WHERE day_key='2026-11-01'").get();assert.equal(next.read_limit,50000000);assert.equal(next.reserved_reads,50000);clean(h);
});

test('read allowance cannot bypass write cap, lower custom read budgets or lower persisted read limits',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h,{consumed_writes:999999,reserved_writes:0});await h.store.acquire();await h.state.applyReadAllowance(ALLOWANCE);
 await assert.rejects(h.state.reserveBudget('write-stop',{rowsWritten:2,rowsRead:1}),/BUDGET_STOP/);
 assert.equal(currentBudget(h).consumed_writes,999999);assert.equal(currentBudget(h).reserved_writes,0);
 const custom=allowanceHarness(t,{dailyReads:100});await custom.store.acquire();await assert.rejects(custom.state.applyReadAllowance(ALLOWANCE),/POLICY_CONFLICT/);
 assert.equal(allowanceRow(custom),undefined);
 const lower=allowanceHarness(t);allowanceBudget(lower,{read_limit:40000000});await lower.store.acquire();await assert.rejects(lower.state.applyReadAllowance(ALLOWANCE),/POLICY_CONFLICT/);clean(h);clean(custom);clean(lower);
});

test('tampered receipt and receipt race fail JS and atomicSQL checks without reserving new capacity',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h);await h.store.acquire();await h.state.applyReadAllowance(ALLOWANCE);
 const original=allowanceRow(h).cursor,before=currentBudget(h);
 h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}',ALLOWANCE_KEY);
 await assert.rejects(h.state.reserveBudget('bad-js',{rowsWritten:1,rowsRead:1}),/RECEIPT_CONFLICT/);assert.deepEqual(currentBudget(h),before);
 h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(original,ALLOWANCE_KEY);
 h.calls.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO server_feed_reservations')))h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}',ALLOWANCE_KEY);};
 await assert.rejects(h.state.reserveBudget('bad-sql',{rowsWritten:1,rowsRead:1}),/WRITE_FAILED/);assert.deepEqual(currentBudget(h),before);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_reservations').get().n,0);clean(h);
});

test('counter CAS and expired shared lease prevent audit activation without altering counters',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h);await h.store.acquire();
 h.calls.beforeBatch=()=>h.sqlite.exec("UPDATE server_feed_daily_budgets SET consumed_reads=consumed_reads+7 WHERE day_key='2026-10-31'");
 await assert.rejects(h.state.applyReadAllowance(ALLOWANCE),/WRITE_FAILED/);assert.equal(allowanceRow(h),undefined);assert.equal(currentBudget(h).consumed_reads,50086832);
 h.calls.beforeBatch=null;h.calls.clock+=11*60000;await assert.rejects(h.state.applyReadAllowance(ALLOWANCE),/WRITE_FAILED/);assert.equal(allowanceRow(h),undefined);clean(h);
});

test('absolute100M ceiling and midnight SQL date fence cannot be bypassed by cached allowance',async t=>{
 const h=allowanceHarness(t);allowanceBudget(h,{consumed_reads:99999999,reserved_reads:0});await h.store.acquire();await h.state.applyReadAllowance(ALLOWANCE);
 await assert.rejects(h.state.reserveBudget('read-stop',{rowsWritten:1,rowsRead:2}),/BUDGET_STOP/);
 const midnight=allowanceHarness(t);allowanceBudget(midnight);await midnight.store.acquire();await midnight.state.applyReadAllowance(ALLOWANCE);const before=currentBudget(midnight);
 midnight.calls.beforeBatch=()=>{midnight.calls.clock=Date.parse('2026-11-01T00:00:00.001Z');};
 await assert.rejects(midnight.state.reserveBudget('cross-midnight',{rowsWritten:1,rowsRead:1}),/WRITE_FAILED/);
 assert.deepEqual(currentBudget(midnight),before);assert.equal(midnight.state.readPolicy().effectiveReadLimit,50000000);clean(h);clean(midnight);
});

function feedWork(generationId,phase='prepare',bucketIndex=0,groupOffset=0){
 return{jobKey:`feed:${generationId}:${phase}:${bucketIndex}:${groupOffset}`,kind:'feed',payload:{generationId,phase,bucketIndex,groupOffset}};
}
async function queuedGeneration(env,generationId,{prepared=false,first=SEED_SEQUENCE+1,last=SEED_SEQUENCE+100}={}){
 const prepare=feedWork(generationId);await env.state.register({generationId,compressedBytes:100,sha256:String(generationId).padStart(64,'a'),rawKey:`raw/${generationId}.gz`,observedAt:AT,outbox:[prepare]});
 if(prepared){await env.state.prepare({generationId,archiveBytes:1000,manifestKey:`manifest/${generationId}.json`,manifestSha256:String(generationId).padStart(64,'b'),
  firstSequence:first,lastSequence:last,bucketGroups:[2,...Array(127).fill(0)],outbox:[feedWork(generationId,'apply')]});await env.state.completeOutbox(prepare.jobKey);}
 return feedWork(generationId,prepared?'apply':'prepare');
}
const outbox=(env,key)=>env.sqlite.prepare('SELECT * FROM server_feed_outbox WHERE job_key=?').get(key);

test('backed-off prepare cannot starve older prepared recovery or another due preparation',async t=>{
 const env=harness(t);await env.store.acquire();await env.state.seed(seedEvidence(env));
 const older=await queuedGeneration(env,12,{prepared:true,first:SEED_SEQUENCE+101,last:SEED_SEQUENCE+200});env.calls.clock+=1000;
 const bad=await queuedGeneration(env,13);await env.state.retry(bad.jobKey,'UPSTREAM',60000,8);
 assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,12);
 assert.equal((await env.state.getNextGeneration({readyOnly:true,includeJobKey:bad.jobKey})).generation_id,12,'pending retry cannot bypass backoff');
 assert.equal(await env.state.getBlockingGeneration(12),null);env.calls.clock+=1000;
 await queuedGeneration(env,14);assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,14);
 env.calls.clock+=60000;await env.store.acquire();assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,13);clean(env);
});

test('only dispatched canonical current delivery bypasses delivery timeout; stale completed jobs do not suppress current checkpoint',async t=>{
 const env=harness(t);await env.store.acquire();const job=await queuedGeneration(env,12);
 await env.state.markDispatched(job.jobKey);assert.equal(await env.state.getNextGeneration({readyOnly:true}),null);
 assert.equal((await env.state.getNextGeneration({readyOnly:true,includeJobKey:job.jobKey})).generation_id,12);
 assert.equal(await env.state.getNextGeneration({readyOnly:true,includeJobKey:'feed:12:apply:0:0'}),null);
 await env.state.prepare({generationId:12,archiveBytes:1000,manifestKey:'manifest/12.json',manifestSha256:'b'.repeat(64),firstSequence:SEED_SEQUENCE+1,lastSequence:SEED_SEQUENCE+100,
  bucketGroups:[2,...Array(127).fill(0)],outbox:[feedWork(12,'apply')]});
 await env.state.retry(job.jobKey,'STALE_PREPARE',1000,1);
 assert.equal((await env.state.getGeneration(12)).status,'prepared');assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,12);clean(env);
});

test('terminal current prepare failure atomically blocks generation and outbox without losing immutable raw or cursor',async t=>{
 const env=harness(t);await env.store.acquire();await env.state.seed(seedEvidence(env));const job=await queuedGeneration(env,12),before=await env.state.getGeneration(12),cursor=await env.state.getState();
 await env.state.retry(job.jobKey,'UPSTREAM',1000,2);assert.equal((await env.state.getGeneration(12)).status,'downloaded');
 const result=await env.state.retry(job.jobKey,'BAD_ARCHIVE',1000,2);assert.deepEqual(result,{attempts:2,blocked:true,generationBlocked:true,generationId:12});
 const after=await env.state.getGeneration(12);assert.equal(after.status,'blocked');assert.equal(after.last_error_code,'BAD_ARCHIVE');
 for(const field of ['raw_key','sha256','compressed_bytes','manifest_key','first_sequence','last_sequence','retired_at'])assert.equal(after[field],before[field]);
 assert.deepEqual(await env.state.getState(),cursor);assert.equal(outbox(env,job.jobKey).status,'blocked');assert.equal(await env.state.getNextGeneration({readyOnly:true}),null);
 env.calls.clock+=1000;await queuedGeneration(env,13);assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,13);clean(env);
});

test('legacy terminal outbox never monopolizes downloaded generation even before its generation status is repaired',async t=>{
 const env=harness(t);await env.store.acquire();const bad=await queuedGeneration(env,12);
 env.sqlite.prepare("UPDATE server_feed_outbox SET status='blocked',attempts=8 WHERE job_key=?").run(bad.jobKey);env.calls.clock+=1000;
 await queuedGeneration(env,13);assert.equal((await env.state.getGeneration(12)).status,'downloaded');assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,13);clean(env);
});

test('terminal retry rollback, lost acknowledgement, CAS and stolen lease cannot split generation/outbox status',async t=>{
 for(const kind of ['rollback','ack-lost','attempt-race','lease']){
  const env=harness(t);await env.store.acquire();const job=await queuedGeneration(env,12);
  if(kind==='rollback')env.calls.fault=statement=>statement.sql.includes('UPDATE server_feed_generations AS g');
  if(kind==='ack-lost')env.calls.afterCommit=()=>{throw Error('ACK_LOST');};
  if(kind==='attempt-race')env.calls.beforeBatch=()=>env.sqlite.prepare('UPDATE server_feed_outbox SET attempts=1 WHERE job_key=?').run(job.jobKey);
  if(kind==='lease')env.sqlite.exec("UPDATE automatic_refresh_state SET lease_owner='other'");
  await assert.rejects(env.state.retry(job.jobKey,'BAD_ARCHIVE',1000,1),/WRITE_FAILED/);
  const committed=kind==='ack-lost';assert.equal((await env.state.getGeneration(12)).status,committed?'blocked':'downloaded');
  assert.equal(outbox(env,job.jobKey).status,committed?'blocked':'pending');
  assert.equal((await env.state.getGeneration(12)).retired_at,null);clean(env);
 }
});

test('unknown older archive fences later import but permits later preparation and never advances cursor',async t=>{
 const env=harness(t);await env.store.acquire();await env.state.seed(seedEvidence(env));const old=await queuedGeneration(env,12);
 await env.state.retry(old.jobKey,'BAD_ARCHIVE',1000,1);env.calls.clock+=1000;
 await queuedGeneration(env,13,{prepared:true});const before=await env.state.getState();
 assert.equal((await env.state.getBlockingGeneration(13)).generation_id,12);assert.equal(await env.state.getNextGeneration({readyOnly:true}),null);
 await assert.rejects(env.state.start(13),/UNKNOWN_ARCHIVE_BLOCKED/);assert.deepEqual(await env.state.getState(),before);
 env.calls.clock+=1000;const next=await queuedGeneration(env,14);assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,14);
 await env.state.prepare({generationId:14,archiveBytes:1000,manifestKey:'manifest/14.json',manifestSha256:'e'.repeat(64),firstSequence:SEED_SEQUENCE+101,lastSequence:SEED_SEQUENCE+200,
  bucketGroups:[1,...Array(127).fill(0)],outbox:[feedWork(14,'apply')]});await env.state.completeOutbox(next.jobKey);
 assert.equal(await env.state.getNextGeneration({readyOnly:true}),null);assert.deepEqual(await env.state.getState(),before);
 assert.equal((await env.state.getGeneration(12)).retired_at,null);assert.equal((await env.state.getGeneration(13)).status,'prepared');clean(env);
});

test('unknown start fence survives a newly blocked older archive race; active import remains selectable with failed later preparation',async t=>{
 const env=harness(t);await env.store.acquire();await env.state.seed(seedEvidence(env));
 const old=await queuedGeneration(env,11,{prepared:true,first:SEED_SEQUENCE+301,last:SEED_SEQUENCE+400});env.calls.clock+=1000;
 await queuedGeneration(env,12,{prepared:true});
 env.calls.beforeBatch=()=>env.sqlite.prepare("UPDATE server_feed_generations SET status='blocked',first_sequence=NULL,last_sequence=NULL WHERE generation_id=11").run();
 await assert.rejects(env.state.start(12),/WRITE_FAILED/);assert.equal((await env.state.getState()).committed_sequence,SEED_SEQUENCE);
 assert.equal((await env.state.getGeneration(12)).status,'prepared');env.calls.beforeBatch=null;
 env.sqlite.prepare("UPDATE server_feed_generations SET status='prepared',first_sequence=?,last_sequence=? WHERE generation_id=11").run(SEED_SEQUENCE+301,SEED_SEQUENCE+400);
 await env.state.start(12);env.calls.clock+=1000;const bad=await queuedGeneration(env,13);await env.state.retry(bad.jobKey,'BAD_ARCHIVE',1000,1);
 const active=await env.state.getGeneration(12);assert.equal(active.status,'applying');assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,12);
 assert.equal(await env.state.getBlockingGeneration(12),null);assert.equal((await env.state.getState()).active_generation,12);assert.equal(outbox(env,old.jobKey).status,'pending');clean(env);
});

test('terminal apply failure preserves active checkpoint fence and known blocked range cannot be jumped',async t=>{
 const env=harness(t);await env.store.acquire();await env.state.seed(seedEvidence(env));const active=await queuedGeneration(env,12,{prepared:true});await env.state.start(12);
 const before=await env.state.getState();await env.state.retry(active.jobKey,'BAD_BUCKET',1000,1);assert.deepEqual(await env.state.getState(),before);
 const row=await env.state.getGeneration(12);assert.equal(row.status,'blocked');assert.equal(row.bucket_index,0);assert.equal(row.group_offset,0);assert.equal(row.retired_at,null);
 env.calls.clock+=1000;await queuedGeneration(env,13,{prepared:true,first:SEED_SEQUENCE+101,last:SEED_SEQUENCE+200});
 await assert.rejects(env.state.start(13),/CONTINUITY_GAP/);assert.equal((await env.state.getState()).active_generation,12);assert.equal((await env.state.getState()).committed_sequence,SEED_SEQUENCE);clean(env);
});


test('production ready-only scheduling excludes orphan metadata and requires the canonical checkpoint outbox',async t=>{
 const env=harness(t);await env.store.acquire();
 await env.state.register({generationId:11,sha256:'c'.repeat(64),rawKey:'raw/orphan.gz',compressedBytes:100,observedAt:AT});env.calls.clock+=1000;
 const job=await queuedGeneration(env,12);assert.equal((await env.state.getNextGeneration()).generation_id,11,'inspection compatibility');
 assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,12);
 env.sqlite.prepare('DELETE FROM server_feed_outbox WHERE job_key=?').run(job.jobKey);
 assert.equal(await env.state.getNextGeneration({readyOnly:true}),null);assert.equal((await env.state.getNextGeneration()).generation_id,11);
 await env.state.enqueue(feedWork(12,'apply'));assert.equal(await env.state.getNextGeneration({readyOnly:true}),null,'wrong phase is never a ready preparation');
 await env.state.enqueue(job);assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,12);clean(env);
});

test('readiness and unknown-fence queries use generation status indexes and direct outbox primary-key lookup',async t=>{
 const env=harness(t);await env.store.acquire();await queuedGeneration(env,12,{prepared:true});
 const original=env.db.prepare,observed=[];env.db.prepare=sql=>({bind(...params){observed.push({sql,params});return original(sql).bind(...params);}});
 await env.state.getNextGeneration({readyOnly:true});await env.state.getBlockingGeneration(12);
 const selector=observed.find(q=>q.sql.startsWith('SELECT g.* FROM server_feed_generations g'));
 const blocker=observed.find(q=>q.sql.startsWith('SELECT u.* FROM server_feed_generations g'));
 for(const query of [selector,blocker]){
  assert.ok(query);const plan=env.sqlite.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.params).map(row=>row.detail).join('\n');
  assert.match(plan,/SEARCH u USING INDEX server_feed_generations_pending/);assert.doesNotMatch(plan,/SCAN [guo]\b/);
  if(query===selector)assert.match(plan,/SEARCH o USING INDEX sqlite_autoindex_server_feed_outbox_1 \(job_key=\?\)/);
 }clean(env);
});


test('active import backoff or terminal failure fences other prepared work while due preparations continue',async t=>{
 for(const terminal of [false,true]){
  const env=harness(t);await env.store.acquire();await env.state.seed(seedEvidence(env));const active=await queuedGeneration(env,12,{prepared:true});await env.state.start(12);
  await env.state.retry(active.jobKey,'UPSTREAM',60000,terminal?1:8);env.calls.clock+=1000;
  await queuedGeneration(env,13,{prepared:true,first:SEED_SEQUENCE+101,last:SEED_SEQUENCE+200});
  assert.equal(await env.state.getNextGeneration({readyOnly:true}),null,'later prepared work cannot consume retries against active cursor');
  env.calls.clock+=1000;await queuedGeneration(env,14);assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,14);
  assert.equal((await env.state.getState()).active_generation,12);assert.equal((await env.state.getState()).committed_sequence,SEED_SEQUENCE);
  if(!terminal){env.calls.clock+=60000;await env.store.acquire();assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,12);}clean(env);
 }
});


test('terminal stale apply retry cannot block a durable newer checkpoint and its canonical continuation',async t=>{
 const env=harness(t);await env.store.acquire();await env.state.seed(seedEvidence(env));const old=await queuedGeneration(env,12,{prepared:true});await env.state.start(12);
 const receipts=[putReceipt(env,'server-feed-batch:stale:0',{offset:0,end:1})],next=feedWork(12,'apply',0,1);
 await cp(env,{nextOffset:1,receipts,outbox:[next]});
 const result=await env.state.retry(old.jobKey,'STALE_CHECKPOINT',1000,1);assert.equal(result.blocked,true);assert.equal(result.generationBlocked,false);
 assert.equal(outbox(env,old.jobKey).status,'blocked');assert.equal(outbox(env,next.jobKey).status,'pending');
 const row=await env.state.getGeneration(12);assert.equal(row.status,'applying');assert.equal(row.bucket_index,0);assert.equal(row.group_offset,1);
 assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,12);assert.equal((await env.state.getState()).committed_sequence,SEED_SEQUENCE);clean(env);
});


test('prepared gap target stays serialized while its canonical job backs off, but new raw preparation may continue',async t=>{
 const env=harness(t);await env.store.acquire();await env.state.seed(seedEvidence(env));
 const first=await queuedGeneration(env,12,{prepared:true,first:SEED_SEQUENCE+101,last:SEED_SEQUENCE+200});env.calls.clock+=1000;
 await queuedGeneration(env,13,{prepared:true,first:SEED_SEQUENCE+201,last:SEED_SEQUENCE+300});
 await env.state.retry(first.jobKey,'UPSTREAM',60000,null);assert.equal(await env.state.getNextGeneration({readyOnly:true}),null);
 assert.equal((await env.state.getBlockingGeneration(13)).generation_id,12);
 env.calls.clock+=1000;await queuedGeneration(env,14);assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,14);
 env.calls.clock+=60000;await env.store.acquire();assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,14,'unknown raw is inspected first');
 await env.state.block(14,'BAD_FILE');assert.equal((await env.state.getNextGeneration({readyOnly:true})).generation_id,12);clean(env);
});
test('transient provider failures remain durably retryable beyond eight attempts without changing raw data or cursor',async t=>{
 const env=harness(t);await env.store.acquire();await env.state.seed(seedEvidence(env));const work=await queuedGeneration(env,12,{prepared:true}),before=await env.state.getGeneration(12),cursor=await env.state.getState();
 for(let n=1;n<=25;n++){const r=await env.state.retry(work.jobKey,n%2?'UPSTREAM':'TIMEOUT',3600000,null);assert.equal(r.attempts,n);assert.equal(r.blocked,false);assert.equal(r.generationBlocked,false);}
 assert.equal((await env.state.getGeneration(12)).status,'prepared');assert.equal((await env.state.getGeneration(12)).sha256,before.sha256);assert.deepEqual(await env.state.getState(),cursor);
 await assert.rejects(env.state.retry(work.jobKey,'BAD_ARCHIVE',1000,null),/SERVER_FEED_OUTBOX_INVALID/);clean(env);
});
