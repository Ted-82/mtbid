'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto'),{gunzipSync}=require('node:zlib');
const {archiveFeedAudits,TASK,START,SUPPLEMENT_TASK}=require('../sync/feed-audit-archive.cjs');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const now=Date.parse('2026-11-13T12:00:00Z'),sha=x=>createHash('sha256').update(x).digest('hex');
const key='server-feed-batch:'+'a'.repeat(64)+':0',manifest='b'.repeat(64),cursor=JSON.stringify({test:'archive the exact content'});
async function setup(t){
 const d=new DatabaseSync(':memory:');t.after(()=>d.close());
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql'])
  d.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 d.exec("CREATE TABLE auction_history_test (id TEXT); INSERT INTO auction_history_test VALUES ('keep');");
 d.prepare('INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,200,?,?)').run('{}',START);
 d.prepare(`INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,observed_at,status,manifest_sha256,first_sequence,last_sequence,bucket_index,created_at,updated_at)
 VALUES(1,?,'raw/1',1,?,'complete',?,100,199,128,?,?)`).run('c'.repeat(64),START,manifest,START,START);
 const addTask=d.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES(?,'all',?,?,'complete')");
 addTask.run(key,cursor,START);addTask.run('reconcile:other','{}',START);
 const p=JSON.stringify({generationId:1,manifestSha256:manifest,receipts:[{taskKey:key,cursorSha256:sha(cursor)}]});
 d.prepare('INSERT INTO server_feed_receipts VALUES(?,?,?,?,?)').run('1:0:0',1,sha(p),p,START);
 const db={prepare(sql){return{bind(...params){const s=d.prepare(sql);return{s,params,async first(){return s.get(...params)||null;},async all(){return{results:s.all(...params)};},async run(){return{meta:{changes:Number(s.run(...params).changes)}};}};}};},
  async batch(ss){d.exec('BEGIN');try{const rs=ss.map(x=>({meta:{changes:Number(x.s.run(...x.params).changes)}}));d.exec('COMMIT');return rs;}catch(e){d.exec('ROLLBACK');throw e;}}};
 const store=new RefreshStore(db,'audit-archive-test',()=>now);await store.acquire();
 const blobs=new Map(),bucket={async put(k,b){if(!blobs.has(k))blobs.set(k,Buffer.from(b));},
  async get(k){const b=blobs.get(k);if(!b)return null;return{size:b.length,arrayBuffer:async()=>b};}};
 const run=extra=>archiveFeedAudits({db,store,bucket,now:()=>now,...extra});
 const task=k=>d.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(k);
 return {d,run,bucket,blobs,task};
}
test('archive is verified and restorable before the bounded removal, with idempotent follow-up',async t=>{
 const f=await setup(t),r=await f.run();a.equal(r.rows,1);a.equal(f.task(key),undefined);
 const m=JSON.parse(f.task(TASK).cursor),b=f.blobs.get(m.last.key);a.equal(sha(b),m.last.sha256);
 a.equal(JSON.parse(gunzipSync(b)).items[0].task.cursor,cursor);
 a.equal(f.d.prepare('SELECT id FROM auction_history_test').get().id,'keep');a.ok(f.task('reconcile:other'));
 a.equal(f.d.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,200);
 a.equal((await f.run()).rows,0);a.equal(f.blobs.size,1);
});
test('corrupt readback, lost lease and changed task leave the cursor and audit untouched',async t=>{
 for(const variant of ['corrupt','lease','changed']){
  const f=await setup(t),get=f.bucket.get;
  f.bucket.get=async k=>{
   const v=await get(k);
   if(variant==='corrupt')return{...v,arrayBuffer:async()=>Buffer.alloc(v.size)};
   if(variant==='lease')f.d.exec("UPDATE automatic_refresh_state SET lease_owner='different'");
   if(variant==='changed')f.d.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('new',key);
   return v;
  };
  await a.rejects(f.run());a.equal(f.task(TASK),undefined);a.equal(f.task(key).cursor,variant==='changed'?'new':cursor);
 }
});
test('recent or active generation and insufficient budget never write archive or delete rows',async t=>{
 for(const scenario of ['recent','active','budget']){
  const f=await setup(t);
  if(scenario==='recent')f.d.prepare('UPDATE server_feed_generations SET updated_at=?').run(new Date(now).toISOString());
  if(scenario==='active')f.d.exec('UPDATE server_feed_state SET active_generation=1');
  const r=await f.run({writeAdmitted:()=>scenario!=='budget'});
  a.equal(r.rows,0);a.equal(f.blobs.size,0);a.equal(f.task(key).cursor,cursor);
 }
});
test('only fully published proofs older than two hours move to the archive',async t=>{
 for(const [age,expected] of [[2*3600000-1,0],[2*3600000,1]]){
  const f=await setup(t);
  f.d.prepare('UPDATE server_feed_generations SET updated_at=?').run(new Date(now-age).toISOString());
  const result=await f.run();
  a.equal(result.rows,expected);
  a.equal(f.task(key)===undefined,expected===1);
  a.equal(f.blobs.size,expected);
 }
});
test('supplement restores both source-window and hydration records without changing core audit progress',async t=>{
 const f=await setup(t);
 const window='server-feed-window:'+'c'.repeat(64)+':0';
 const hydration='file-hydration:'+'d'.repeat(64)+':0:0';
 const add=f.d.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES(?,'all',?,?,'complete')");
 add.run(window,'{"window":true}',START);add.run(hydration,'{"hydration":true}',START);
 const payload=JSON.stringify({generationId:1,manifestSha256:manifest,receipts:[key,window,hydration].map(taskKey=>({taskKey,cursorSha256:sha(f.task(taskKey).cursor)}))});
 f.d.prepare('UPDATE server_feed_receipts SET payload_json=?,receipt_sha256=?').run(payload,sha(payload));
 const core=await f.run();
 a.equal(core.rows,1);a.equal(f.task(SUPPLEMENT_TASK),undefined);
 const options={supplement:true};
 const supplement=await f.run(options);
 a.equal(supplement.rows,2);a.equal(f.task(window),undefined);a.equal(f.task(hydration),undefined);
 const backup=JSON.parse(gunzipSync(f.blobs.get(JSON.parse(f.task(SUPPLEMENT_TASK).cursor).last.key)));
 a.deepEqual(backup.items.map(x=>x.task.task_key),[window,hydration]);
 a.equal(JSON.parse(f.task(TASK).cursor).rows,1);
 a.equal(f.d.prepare('SELECT payload_json FROM server_feed_receipts').get().payload_json,payload);
 a.equal((await f.run(options)).rows,0);
});
