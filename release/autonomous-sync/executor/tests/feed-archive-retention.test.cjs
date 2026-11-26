'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {ServerFeedState}=require('../sync/feed-server-state.cjs');
const {cleanupCompletedArchives,DERIVED_AGE_MS,RAW_AGE_MS}=require('../sync/feed-archive-retention.cjs');
const NOW=Date.parse('2026-10-29T12:00:00.000Z'),DAY=86400000;
const iso=n=>new Date(n).toISOString(),sha=s=>createHash('sha256').update(String(s)).digest('hex');
class MemoryR2{
 constructor(){this.objects=new Map();this.calls=[];this.onList=null;this.onDelete=null;this.onHead=null;this.delayed=false;}
 async list(options){
  this.calls.push(['list',options]);assert.ok(options.limit<=1000);await this.onList?.(options);
  if(this.listResponse)return this.listResponse;
  const keys=[...this.objects.keys()].filter(key=>key.startsWith(options.prefix)).sort();
  return{objects:keys.slice(0,options.limit).map(key=>({key,size:this.objects.get(key).length})),truncated:keys.length>options.limit};
 }
 async delete(keys){
  assert.ok(Array.isArray(keys)&&keys.length>0&&keys.length<=1000);this.calls.push(['delete',keys]);
  await this.onDelete?.(keys);if(!this.delayed)for(const key of keys)this.objects.delete(key);
 }
 async head(key){this.calls.push(['head',key]);await this.onHead?.(key);return this.objects.has(key)?{key,size:this.objects.get(key).length}:null;}
 async get(key){this.calls.push(['get',key]);return this.objects.has(key)?{body:{cancel:async()=>{this.cancelled=true;}}}:null;}
}
async function harness(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql'])
  sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 const calls={clock:NOW,beforeBatch:null,afterCommit:null};
 const db={prepare(sql){return{bind(...params){return{sql,params,
  async all(){return{results:sqlite.prepare(sql).all(...params)};},async first(){return sqlite.prepare(sql).get(...params)||null;},
  async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}
 };}};},async batch(statements){
  await calls.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');let results;
  try{results=statements.map(s=>({meta:{changes:Number(sqlite.prepare(s.sql).run(...s.params).changes)}}));sqlite.exec('COMMIT');}
  catch(error){sqlite.exec('ROLLBACK');throw error;}await calls.afterCommit?.(statements);return results;
 }};
 const store=new RefreshStore(db,'retention-test',()=>calls.clock),state=new ServerFeedState({db,store}),bucket=new MemoryR2();
 await store.acquire();sqlite.prepare('INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,1000000,?,?)').run('{}',iso(NOW));
 const h={sqlite,db,store,state,bucket,calls};
 h.row=id=>sqlite.prepare('SELECT * FROM server_feed_generations WHERE generation_id=?').get(id);
 h.run=options=>cleanupCompletedArchives({db,store,bucket,...options});
 h.renew=async()=>{sqlite.exec('UPDATE automatic_refresh_state SET lease_owner=NULL,lease_until=NULL');await store.acquire();};
 h.add=(id=1,{age=3*DAY,status='complete',chunks=3,bootstrap=false,archiveBytes=1000}={})=>{
  const hash=sha(id),prefix=`prepared/${hash}/`,updated=iso(calls.clock-age);
  const raw=bootstrap?`raw/${id}/bootstrap-${hash}.jsonl.gz`:`raw/${id}/00000000-0000-4000-8000-${String(id).padStart(12,'0')}.jsonl.gz`;
  sqlite.prepare(`INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,archive_bytes,observed_at,status,
   manifest_key,manifest_sha256,first_sequence,last_sequence,bucket_groups_json,bucket_index,group_offset,created_at,updated_at)
   VALUES(?,?,?,100,?,?,?,?,?,?,?, ?,128,0,?,?)`)
   .run(id,hash,raw,archiveBytes,iso(calls.clock-age-3600000),status,`${prefix}v1-b128/manifest.json`,sha('manifest'+id),id*100,id*100+99,JSON.stringify(Array(128).fill(1)),updated,updated);
  bucket.objects.set(raw,Buffer.from('synthetic raw'));
  if(archiveBytes){bucket.objects.set(`${prefix}v1-b128/manifest.json`,Buffer.from('{}'));bucket.objects.set(`${prefix}v1-b128/capture.json`,Buffer.from('{}'));
   for(let i=0;i<chunks;i++)bucket.objects.set(`${prefix}v1-b128/buckets/0/chunk-${i}-${sha('chunk'+i)}.json`,Buffer.from('{}\n'));
  }
  return{prefix,raw,hash,updated,id};
 };
 return h;
}
function clean(h){
 for(const name of ['server_feed_guards','automatic_refresh_guards'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n,0);
 assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
}

test('48-hour derived cleanup and seven-day raw retirement preserve original completion time and storage accounting',async t=>{
 const h=await harness(t),f=h.add(1,{age:DERIVED_AGE_MS-1});assert.equal((await h.run()).selected,0);assert.equal(h.bucket.calls.length,0);
 h.calls.clock++;const result=await h.run();assert.equal(result.derivedCleared,1);assert.equal(result.retired,0);assert.equal(result.generations[0].status,'raw_retained');
 assert.equal(h.row(1).archive_bytes,0);assert.equal(h.row(1).updated_at,f.updated);assert.equal(h.row(1).retired_at,null);assert.ok(h.bucket.objects.has(f.raw));
 assert.equal((await h.state.storageUsage()).totalBytes,100);assert.equal((await h.run()).selected,0);
 h.calls.clock=Date.parse(f.updated)+RAW_AGE_MS;await h.renew();const retired=await h.run();assert.equal(retired.retired,1);
 assert.equal(h.row(1).retired_at,iso(h.calls.clock));assert.equal(h.row(1).updated_at,f.updated);assert.equal((await h.state.storageUsage()).totalBytes,0);
 assert.equal(h.bucket.objects.size,0);assert.equal((await h.run()).selected,0);clean(h);
});

test('non-complete, active, uncommitted, young and already-retired generations never touch R2',async t=>{
 const h=await harness(t);for(const [i,status] of ['downloaded','prepared','applying','blocked'].entries())h.add(i+1,{status,age:8*DAY});
 h.add(10,{age:8*DAY});h.sqlite.exec('UPDATE server_feed_state SET active_generation=10');
 h.add(11,{age:8*DAY});h.sqlite.exec('UPDATE server_feed_generations SET last_sequence=1000001 WHERE generation_id=11');
 h.add(12,{age:DERIVED_AGE_MS-1});h.add(13,{age:8*DAY});h.sqlite.prepare('UPDATE server_feed_generations SET retired_at=? WHERE generation_id=13').run(iso(NOW));
 assert.equal((await h.run({maxGenerations:10})).selected,0);assert.equal(h.bucket.calls.length,0);clean(h);
});

test('large prefixes resume without cursor skips, within 100 R2 operations and 1000-key list/delete limits',async t=>{
 const h=await harness(t),f=h.add(1,{chunks:1105});const first=await h.run({maxOperations:10});
 assert.equal(first.operations,10);assert.equal(first.generations[0].status,'operation_budget');assert.equal(h.row(1).archive_bytes,1000);
 let result,attempts=0;do{result=await h.run();assert.ok(result.operations<=100);assert.ok(++attempts<20);}while(h.row(1).archive_bytes!==0);
 assert.equal([...h.bucket.objects.keys()].filter(key=>key.startsWith(f.prefix)).length,0);assert.ok(h.bucket.objects.has(f.raw));
 assert.ok(h.bucket.calls.filter(([kind])=>kind==='list').every(([,options])=>options.limit<=1000));
 assert.ok(h.bucket.calls.filter(([kind])=>kind==='delete').every(([,keys])=>keys.length<=1000));clean(h);
});

test('a partly applied delete throwing an unknown reply keeps full derived accounting until retry proves zero',async t=>{
 const h=await harness(t);h.add();let fired=false;h.bucket.onDelete=keys=>{if(!fired){fired=true;h.bucket.objects.delete(keys[0]);throw Error('PRIVATE_REMOTE_REPLY');}};
 const failed=await h.run();assert.equal(failed.generations[0].errorCode,'FEED_RETENTION_STORAGE_FAILED');assert.equal(h.row(1).archive_bytes,1000);
 h.bucket.onDelete=null;assert.equal((await h.run()).derivedCleared,1);assert.equal(h.row(1).archive_bytes,0);clean(h);
});

test('resolved delete promises without actual disappearance do not clear either accounting tier',async t=>{
 const h=await harness(t),f=h.add(1,{age:8*DAY});h.bucket.delayed=true;
 assert.equal((await h.run()).generations[0].status,'delete_pending');assert.equal(h.row(1).archive_bytes,1000);assert.equal(h.row(1).retired_at,null);
 h.bucket.delayed=false;h.bucket.onDelete=keys=>{if(keys.includes(f.raw))h.bucket.delayed=true;};
 const partial=await h.run();assert.equal(partial.derivedCleared,1);assert.equal(partial.generations[0].status,'delete_pending');
 assert.equal(h.row(1).archive_bytes,0);assert.equal(h.row(1).retired_at,null);assert.equal((await h.state.storageUsage()).totalBytes,100);
 h.bucket.delayed=false;h.bucket.onDelete=null;assert.equal((await h.run()).retired,1);clean(h);
});

test('failed deletion verification retains derived cost even when objects already disappeared',async t=>{
 const h=await harness(t);h.add();h.bucket.onHead=()=>{throw Error('HEAD_TIMEOUT');};
 assert.equal((await h.run()).generations[0].status,'retry_required');assert.equal(h.row(1).archive_bytes,1000);
 h.bucket.onHead=null;assert.equal((await h.run()).derivedCleared,1);clean(h);
});

test('foreign manifest/raw keys, mismatched bootstrap hashes and malformed listings fail closed',async t=>{
 for(const variant of ['manifest','raw','bootstrap','listing','traversal']){
  const h=await harness(t),f=h.add(1,{age:8*DAY});
  if(variant==='manifest')h.sqlite.prepare('UPDATE server_feed_generations SET manifest_key=?').run(`other/${f.hash}/v1-b128/manifest.json`);
  if(variant==='raw')h.sqlite.prepare('UPDATE server_feed_generations SET raw_key=?').run(f.raw.replace('raw/1/','raw/2/'));
  if(variant==='bootstrap')h.sqlite.prepare('UPDATE server_feed_generations SET raw_key=?').run(`raw/1/bootstrap-${'b'.repeat(64)}.jsonl.gz`);
  if(variant==='listing')h.bucket.listResponse={objects:[{key:'foreign/customer/data.json'}],truncated:false};
  if(variant==='traversal')h.bucket.listResponse={objects:[{key:f.prefix+'../foreign'}],truncated:false};
  const result=await h.run();assert.equal(result.generations[0].status,'retry_required');assert.equal(h.bucket.calls.filter(([kind])=>kind==='delete').length,0);
  assert.equal(h.row(1).archive_bytes,1000);assert.equal(h.row(1).retired_at,null);clean(h);
 }
});

test('activation or lease takeover after listing prevents the next destructive call',async t=>{
 for(const variant of ['active','lease','status']){
  const h=await harness(t);h.add();h.bucket.onList=()=>{
   if(variant==='active')h.sqlite.exec('UPDATE server_feed_state SET active_generation=1');
   if(variant==='status')h.sqlite.exec("UPDATE server_feed_generations SET status='applying'");
   if(variant==='lease')h.sqlite.exec("UPDATE automatic_refresh_state SET lease_owner='other-owner'");
  };
  assert.equal((await h.run()).generations[0].status,'retry_required');assert.equal(h.bucket.calls.filter(([kind])=>kind==='delete').length,0);
  assert.equal(h.row(1).archive_bytes,1000);clean(h);
 }
});

test('generation CAS rejects metadata mutation after R2 deletion, preserving its DB cost until a valid retry',async t=>{
 for(const column of ['sha256','manifest_sha256','raw_key','updated_at']){
  const h=await harness(t),f=h.add();const original=h.row(1)[column];let fired=false;
  h.bucket.onDelete=()=>{if(!fired){fired=true;const value=column==='updated_at'?iso(NOW):column==='raw_key'?'raw/foreign':'f'.repeat(64);
   h.sqlite.prepare(`UPDATE server_feed_generations SET ${column}=? WHERE generation_id=1`).run(value);}};
  assert.equal((await h.run()).generations[0].status,'retry_required');assert.equal(h.row(1).archive_bytes,1000);
  h.sqlite.prepare(`UPDATE server_feed_generations SET ${column}=? WHERE generation_id=1`).run(original);h.bucket.onDelete=null;
  assert.equal((await h.run()).derivedCleared,1);assert.ok(h.bucket.objects.has(f.raw));clean(h);
 }
});

test('failed guarded finalization is retryable; a lost committed raw-retirement response is idempotent',async t=>{
 const h=await harness(t);h.add(1,{age:8*DAY});let fired=false;
 h.calls.beforeBatch=statements=>{if(!fired&&statements.some(s=>s.sql.includes('SET archive_bytes=0'))){fired=true;throw Error('SIMULATED_DB_FAILURE');}};
 assert.equal((await h.run()).generations[0].status,'retry_required');assert.equal(h.row(1).archive_bytes,1000);assert.equal(h.row(1).retired_at,null);
 h.calls.beforeBatch=null;h.calls.afterCommit=statements=>{if(statements.some(s=>s.sql.includes('SET retired_at=')))throw Error('SIMULATED_REPLY_LOSS');};
 assert.equal((await h.run()).generations[0].status,'retry_required');assert.equal(h.row(1).archive_bytes,0);assert.equal(h.row(1).retired_at,iso(NOW));
 h.calls.afterCommit=null;assert.equal((await h.run()).selected,0);clean(h);
});

test('bootstrap deletion is exact, leaves other raw keys alone, and supports get-only verification',async t=>{
 const h=await harness(t),f=h.add(1,{age:8*DAY,bootstrap:true,archiveBytes:0});h.bucket.head=undefined;
 const other=f.raw.replace('bootstrap-','unrelated-');h.bucket.objects.set(other,Buffer.from('keep'));
 const result=await h.run();assert.equal(result.retired,1);assert.ok(result.gets>=2);assert.equal(result.heads,0);assert.equal(h.bucket.cancelled,true);
 assert.equal(h.bucket.objects.has(f.raw),false);assert.ok(h.bucket.objects.has(other));clean(h);
});

test('maximum generation selection is bounded and missing lease or invalid limits reject before R2',async t=>{
 const h=await harness(t);h.add(1);h.add(2);assert.equal((await h.run()).selected,1);assert.equal(h.row(2).archive_bytes,1000);
 for(const config of [{maxOperations:501},{maxOperations:0},{maxGenerations:0},{maxGenerations:11},{now:NOW+1}])await assert.rejects(h.run(config),/FEED_RETENTION_(CONFIG|TIME)_INVALID/);
 const calls=h.bucket.calls.length;h.sqlite.exec('UPDATE automatic_refresh_state SET lease_owner=NULL');await assert.rejects(h.run(),/LEASE_REQUIRED/);
 assert.equal(h.bucket.calls.length,calls);clean(h);
});


test('bounded gzip preparation cleanup accepts only exact completed-source keys and retains unrelated prefixes',async t=>{
 const h=await harness(t),f=h.add(1,{age:8*DAY});
 const nextPrefix='prepared-bounded/'+f.hash+'/';
 for(const key of [...h.bucket.objects.keys()])if(key.startsWith(f.prefix)){h.bucket.objects.set(key.replace(f.prefix,nextPrefix),h.bucket.objects.get(key));h.bucket.objects.delete(key);}
 h.sqlite.prepare('UPDATE server_feed_generations SET manifest_key=? WHERE generation_id=1').run(nextPrefix+'v1-b128/manifest.json');
 for(const key of ['progress.json','spool/manifest.json','spool/chunk-0-'+sha('spool')+'.jsonl.gz','windows/0.json'])h.bucket.objects.set(nextPrefix+'v1-b128/'+key,Buffer.from('{}'));
 const foreign='prepared-bounded/'+sha('other')+'/v1-b128/manifest.json';h.bucket.objects.set(foreign,Buffer.from('{}'));
 const r=await h.run({maxOperations:400});assert.equal(r.retired,1);assert.equal(h.bucket.objects.size,1);assert.ok(h.bucket.objects.has(foreign));assert.ok(r.operations<400);clean(h);
});
test('bounded cleanup rejects invalid bucket indices and unexpected working files without deleting anything',async t=>{
 for(const suffix of ['buckets/128/chunk-0-'+sha('x')+'.json','windows/01.json','spool/credentials.json']){
  const h=await harness(t),f=h.add();const prefix='prepared-bounded/'+f.hash+'/';
  h.sqlite.prepare('UPDATE server_feed_generations SET manifest_key=? WHERE generation_id=1').run(prefix+'v1-b128/manifest.json');h.bucket.objects.set(prefix+'v1-b128/'+suffix,Buffer.from('{}'));
  const r=await h.run({maxOperations:400});assert.equal(r.generations[0].errorCode,'FEED_RETENTION_PREFIX_INVALID');assert.equal(h.bucket.calls.filter(c=>c[0]==='delete').length,0);assert.equal(h.row(1).archive_bytes,1000);clean(h);
 }
});


test('packed completed archive cleanup accepts sealed binary windows while preserving unfinished source and foreign paths',async t=>{
 const h=await harness(t),f=h.add(1,{age:8*DAY}),prefix='prepared-packed-gzip/'+f.hash+'/';
 for(const key of [...h.bucket.objects.keys()])if(key.startsWith(f.prefix))h.bucket.objects.delete(key);
 h.sqlite.prepare('UPDATE server_feed_generations SET manifest_key=? WHERE generation_id=1').run(prefix+'v1-b128/manifest.json');
 for(const key of ['capture.json','progress.json','manifest.json','spool/manifest.json','spool/chunk-0-'+sha('spool')+'.jsonl.gz','windows/0.json','windows/pack-0-'+sha('pack')+'.bin','buckets/127/manifest-'+sha('b')+'.json'])h.bucket.objects.set(prefix+'v1-b128/'+key,Buffer.from('{}'));
 const unfinished=h.add(2,{status:'downloaded',age:8*DAY});const r=await h.run({maxOperations:400});assert.equal(r.retired,1);
 assert.equal([...h.bucket.objects.keys()].filter(k=>k.startsWith(prefix)).length,0);assert.ok(h.bucket.objects.has(unfinished.raw));assert.equal(h.row(2).retired_at,null);clean(h);
});

const {cleanupBaselineCoveredArchives,coveredKey}=require('../sync/feed-archive-retention.cjs');
const {canonicalPlan}=require('../sync/feed-bootstrap-membership.cjs');
const {LIMITS}=require('../sync/feed-worker-archive.cjs');
const bytesHash=b=>createHash('sha256').update(b).digest('hex'),jsonHash=v=>bytesHash(JSON.stringify(v));
async function coveredHarness(t){
 const h=await harness(t);h.sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0014_feed_catalog_membership.sql'),'utf8'));
 h.db.identity={id:'c8a30088-70af-43a6-9a7f-c4018279d37d',name:'rexbid-production-preflight-db'};h.db.metadataVerified=true;
 h.bucket.get=async key=>{h.bucket.calls.push(['get',key]);const bytes=h.bucket.objects.get(key);return bytes?{size:bytes.length,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(bytes));c.close();}})}:null;};
 const before=iso(NOW-3600000),baselineId='fresh-retention',snapshotSha='b'.repeat(64);
 const plan=canonicalPlan({version:1,baselineId,scope:'production',sourceEvidence:{kind:'provider-checkpoint',sha256:'d'.repeat(64),replayStartSequence:900000,snapshotSha256:snapshotSha},
  capture:{sequence:900000,capturedAt:before,responseSha256:'a'.repeat(64)},snapshot:{generationId:8731,sha256:snapshotSha,records:1,requestStartedAt:before,observedAt:before,generatedAtKnown:false,generatedAt:null}});
 const checkpoint={version:1,status:'ready',offset:1,resolved:1,excluded:0,unresolved:0,replaySequence:1000000,replayVerified:true,deltaUnresolved:0,reviewedUnresolved:0,pendingDelta:null,lastBatch:{kind:'delta',from:900000,through:1000000,sha256:'f'.repeat(64)}};
 h.sqlite.prepare('INSERT INTO feed_catalog_baselines VALUES(?,?,?,?,1,?,?)').run(baselineId,jsonHash(plan),JSON.stringify(plan),JSON.stringify(checkpoint),before,before);
 h.sqlite.prepare('UPDATE feed_catalog_pointer SET baseline_id=?,revision=1').run(baselineId);
 const boundary=h.add(8888,{status:'prepared'});h.sqlite.prepare('UPDATE server_feed_generations SET first_sequence=900001,last_sequence=1000000,bucket_index=0 WHERE generation_id=8888').run();
 const b=h.row(8888),body={version:1,kind:'feed-bootstrap-activation',baselineId,planSha256:jsonHash(plan),sourceProofSha256:'d'.repeat(64),sourceEvidenceSha256:jsonHash(plan.sourceEvidence),sourceSequence:900000,floorSequence:1000000,
  boundary:{generationId:8888,rawSha256:b.sha256,rawKey:b.raw_key,manifestKey:b.manifest_key,manifestSha256:b.manifest_sha256,firstSequence:900001,lastSequence:1000000,compressedBytes:b.compressed_bytes},
  replay:{proofSha256:'f'.repeat(64)},prior:{baselineId:null,pointerRevision:0,serverSequence:77},target:h.db.identity,activatedAt:before};
 const activationCursor=JSON.stringify({...body,sha256:jsonHash(body)});h.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,cursor,next_due_at) VALUES(?,'all','complete',?,?)").run('bootstrap-activation:'+baselineId,activationCursor,before);
 h.covered=options=>cleanupBaselineCoveredArchives({db:h.db,store:h.store,bucket:h.bucket,...options});h.baselineId=baselineId;
 h.coveredAdd=(id=1,options={})=>{const f=h.add(id,{status:'prepared',age:9*DAY,...options});h.sqlite.prepare('UPDATE server_feed_generations SET bucket_index=0 WHERE generation_id=?').run(id);
  h.bucket.objects.set(f.raw,Buffer.alloc(100));const row=h.row(id),root=f.prefix+'v1-b128',buckets=Array.from({length:128},(_,index)=>({index,manifestKey:root+'/buckets/'+index+'/manifest-'+sha('b'+index)+'.json',manifestSha256:sha('b'+index),bucketSha256:sha('bucket'+index),records:index===0?2:0,quarantined:0,uniqueLots:index===0?1:0,decodedBytes:index===0?20:0,chunkCount:index===0?1:0,firstSequence:index===0?row.first_sequence:null,lastSequence:index===0?row.last_sequence:null}));
  const m={version:1,kind:'apibara-feed-archive',state:'ready',prefix:'prepared',rawSha256:row.sha256,rawKey:row.raw_key,bucketCount:128,observedAt:row.observed_at,limits:LIMITS,buckets,records:2,quarantined:0,uniqueLots:1,decodedBytes:20,compressedBytes:100,firstSequence:row.first_sequence,lastSequence:row.last_sequence,databaseApplied:false,continuityVerified:false};
  const content=Buffer.from(JSON.stringify({...m,sha256:bytesHash(JSON.stringify(m)+'\n')})+'\n');h.bucket.objects.set(row.manifest_key,content);h.sqlite.prepare('UPDATE server_feed_generations SET manifest_sha256=? WHERE generation_id=?').run(bytesHash(content),id);return f;};
 h.advance=async age=>{h.calls.clock=NOW+age;await h.renew();};
 return h;
}
const retainedReceipt=(h,id=1)=>h.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(coveredKey(h.baselineId,id));
test('baseline-covered sources get a distinct immutable retention receipt and fresh48h/7d window without fake completion',async t=>{
 const h=await coveredHarness(t),f=h.coveredAdd(),before={...h.row(1)},server={...h.sqlite.prepare('SELECT * FROM server_feed_state').get()};
 const classified=await h.run();assert.equal(classified.baselineCovered.classified,1);assert.equal(h.bucket.calls.filter(c=>c[0]==='delete').length,0);assert.deepEqual({...h.row(1)},before);
 const receipt=JSON.parse(retainedReceipt(h).cursor);assert.equal(receipt.kind,'baseline-superseded-source-retention');assert.equal(receipt.databaseApplied,false);assert.equal(receipt.classifiedAt,iso(NOW));
 await h.advance(DERIVED_AGE_MS-1);assert.equal((await h.covered()).selected,0);await h.advance(DERIVED_AGE_MS);
 const derived=await h.covered();assert.equal(derived.derivedCleared,1);assert.equal(h.row(1).archive_bytes,0);assert.ok(h.bucket.objects.has(f.raw));assert.equal(h.row(1).status,'prepared');assert.equal(h.row(1).bucket_index,0);assert.equal(h.row(1).updated_at,before.updated_at);
 await h.advance(RAW_AGE_MS);assert.equal((await h.covered()).retired,1);assert.equal(h.row(1).retired_at,iso(h.calls.clock));assert.equal(h.row(1).status,'prepared');assert.equal(h.bucket.objects.has(f.raw),false);assert.deepEqual({...h.sqlite.prepare('SELECT * FROM server_feed_state').get()},server);assert.equal(retainedReceipt(h).cursor,JSON.stringify(receipt));clean(h);
});
test('young classified source does not monopolize classification of remaining covered sources',async t=>{const h=await coveredHarness(t);h.coveredAdd(1);h.coveredAdd(2);assert.equal((await h.covered()).classified,1);assert.equal((await h.covered()).classified,1);assert.ok(retainedReceipt(h,1));assert.ok(retainedReceipt(h,2));assert.equal((await h.covered()).selected,0);});
test('active boundary, unknown/new ranges, active generation and any pending bootstrap proof are protected',async t=>{
 for(const mode of ['boundary','unknown','beyond','active','pending']){const h=await coveredHarness(t);h.coveredAdd();if(mode==='boundary')h.sqlite.prepare('DELETE FROM server_feed_generations WHERE generation_id=1').run();
  if(mode==='unknown')h.sqlite.prepare('UPDATE server_feed_generations SET first_sequence=NULL,last_sequence=NULL WHERE generation_id=1').run();if(mode==='beyond')h.sqlite.prepare('UPDATE server_feed_generations SET last_sequence=1000001 WHERE generation_id=1').run();if(mode==='active')h.sqlite.prepare('UPDATE server_feed_state SET active_generation=1').run();
  if(mode==='pending')h.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,cursor,next_due_at) VALUES('bootstrap-archive-replay:next:1','all','pending','{}',?)").run(iso(NOW));
  assert.equal((await h.covered({maxGenerations:10})).selected,0);assert.equal(h.bucket.calls.length,0);assert.equal(retainedReceipt(h),undefined);}
});
test('intake pending descriptor and wrong manifest/hash prevent coverage classification',async t=>{
 for(const mode of ['pending','hash','manifest','raw']){const h=await coveredHarness(t),f=h.coveredAdd();if(mode==='pending')h.bucket.objects.set('intake/v1/pending/'+String(1).padStart(20,'0')+'.json',Buffer.from('{}'));
  if(mode==='hash')h.bucket.objects.set(h.row(1).manifest_key,Buffer.from('{}'));if(mode==='manifest')h.sqlite.prepare('UPDATE server_feed_generations SET manifest_key=? WHERE generation_id=1').run('foreign/manifest');if(mode==='raw')h.bucket.objects.delete(f.raw);
  const r=await h.covered();assert.ok(['intake_pending','retry_required'].includes(r.generations[0].status));assert.equal(retainedReceipt(h),undefined);assert.equal(h.bucket.calls.filter(c=>c[0]==='delete').length,0);assert.equal(h.row(1).archive_bytes,1000);}
});
test('covered cleanup rechecks pointer, activation, lease, source, pending intake and bootstrap work before deletion',async t=>{
 for(const mode of ['pointer','activation','lease','source','intake','pending']){const h=await coveredHarness(t);h.coveredAdd();await h.covered();await h.advance(DERIVED_AGE_MS);
  h.bucket.onList=()=>{if(mode==='pointer')h.sqlite.exec('UPDATE feed_catalog_pointer SET baseline_id=NULL');if(mode==='activation')h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}','bootstrap-activation:'+h.baselineId);if(mode==='lease')h.sqlite.exec("UPDATE automatic_refresh_state SET lease_owner='other'");if(mode==='source')h.sqlite.prepare('UPDATE server_feed_generations SET raw_key=? WHERE generation_id=1').run('foreign');
   if(mode==='intake')h.bucket.objects.set('intake/v1/pending/'+String(1).padStart(20,'0')+'.json',Buffer.from('{}'));if(mode==='pending')h.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,cursor,next_due_at) VALUES('bootstrap-archive-replay:next:1','all','pending','{}',?)").run(iso(NOW));};
  const r=await h.covered();assert.equal(r.generations[0].status,'retry_required');assert.equal(h.bucket.calls.filter(c=>c[0]==='delete').length,0);assert.equal(h.row(1).archive_bytes,1000);}
});
test('covered deletion preserves accounting on delayed/unknown deletion and safely resumes bounded cleanup',async t=>{
 const h=await coveredHarness(t),f=h.coveredAdd(1,{chunks:150});await h.covered();await h.advance(DERIVED_AGE_MS);h.bucket.delayed=true;
 assert.equal((await h.covered()).generations[0].status,'delete_pending');assert.equal(h.row(1).archive_bytes,1000);h.bucket.delayed=false;
 for(let i=0;i<30&&h.row(1).archive_bytes!==0;i++){const r=await h.covered({maxOperations:20});assert.ok(r.operations<=20);}assert.equal(h.row(1).archive_bytes,0);assert.ok(h.bucket.objects.has(f.raw));
 await h.advance(RAW_AGE_MS);let fired=false;h.bucket.onDelete=keys=>{if(keys.includes(f.raw)&&!fired){fired=true;h.bucket.objects.delete(f.raw);throw Error('UNKNOWN');}};
 assert.equal((await h.covered()).generations[0].status,'retry_required');assert.equal(h.row(1).retired_at,null);h.bucket.onDelete=null;assert.equal((await h.covered()).retired,1);assert.equal((await h.covered()).selected,0);clean(h);
});
test('covered receipt tampering and source/receipt races preserve original accounting',async t=>{
 for(const mode of ['receipt','metadata','race']){const h=await coveredHarness(t);h.coveredAdd();await h.covered();await h.advance(DERIVED_AGE_MS);
  if(mode==='receipt'){const r=JSON.parse(retainedReceipt(h).cursor);r.activationSha256='f'.repeat(64);h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(r),coveredKey(h.baselineId,1));}
  if(mode==='metadata')h.sqlite.prepare('UPDATE server_feed_generations SET updated_at=? WHERE generation_id=1').run(iso(NOW));
  if(mode==='race')h.bucket.onDelete=()=>h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}',coveredKey(h.baselineId,1));
  const r=await h.covered();assert.equal(r.generations[0].status,'retry_required');assert.equal(h.row(1).archive_bytes,1000);assert.equal(h.row(1).retired_at,null);}
});
test('manifestless8019 requires the exact guarded strict-range receipt and retains blocked/error/progress history',async t=>{
 for(const valid of [false,true]){const h=await coveredHarness(t),f=h.add(8019,{status:'blocked',age:9*DAY,archiveBytes:0});h.bucket.objects.set(f.raw,Buffer.alloc(100));
  h.sqlite.prepare("UPDATE server_feed_generations SET first_sequence=100,last_sequence=199,manifest_key=NULL,manifest_sha256=NULL,bucket_index=0,last_error_code='FEED_CAPTURE_STORAGE_LIST_LIMIT',updated_at=? WHERE generation_id=8019").run(iso(NOW));
  const row=h.row(8019),before={...row,first_sequence:null,last_sequence:null,updated_at:iso(NOW-3600000)},activation=h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get('bootstrap-activation:'+h.baselineId);
  const body={version:1,kind:'covered-range-classification',generationId:8019,baselineId:h.baselineId,activationSha256:bytesHash(activation.cursor),sourceSha256:row.sha256,compressedBytes:100,firstSequence:100,lastSequence:199,scanSha256:'a'.repeat(64),records:84,before,classifiedAt:iso(NOW)};
  if(valid)h.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,status,cursor,next_due_at) VALUES(?,'all',NULL,'complete',?,?)").run('covered-range-classification:8019:'+h.baselineId,JSON.stringify({...body,sha256:jsonHash(body)}),iso(NOW));
  const r=await h.covered();if(!valid){assert.equal(r.generations[0].status,'retry_required');assert.equal(retainedReceipt(h,8019),undefined);continue;}
  assert.equal(r.classified,1);await h.advance(RAW_AGE_MS);assert.equal((await h.covered()).retired,1);assert.equal(h.row(8019).status,'blocked');assert.equal(h.row(8019).bucket_index,0);assert.equal(h.row(8019).last_error_code,'FEED_CAPTURE_STORAGE_LIST_LIMIT');assert.equal(h.bucket.objects.has(f.raw),false);
 }
});
test('baseline-covered source and receipt guards reject post-delete metadata mutation and recover from a lost DB acknowledgement',async t=>{
 for(const mode of ['metadata','ack']){const h=await coveredHarness(t);h.coveredAdd();await h.covered();await h.advance(DERIVED_AGE_MS);
  if(mode==='metadata'){let fired=false;h.bucket.onDelete=()=>{if(!fired){fired=true;h.sqlite.prepare('UPDATE server_feed_generations SET compressed_bytes=101 WHERE generation_id=1').run();}};}
  else h.calls.afterCommit=ss=>{if(ss.some(s=>s.sql.includes('SET archive_bytes=0')))throw Error('ACK_LOST');};
  const r=await h.covered();assert.equal(r.generations[0].status,'retry_required');assert.equal(h.row(1).archive_bytes,mode==='metadata'?1000:0);assert.equal(h.row(1).retired_at,null);
  if(mode==='metadata'){h.sqlite.prepare('UPDATE server_feed_generations SET compressed_bytes=100 WHERE generation_id=1').run();h.bucket.onDelete=null;assert.equal((await h.covered()).derivedCleared,1);}else{h.calls.afterCommit=null;assert.equal((await h.covered()).selected,0);}
 }
});
