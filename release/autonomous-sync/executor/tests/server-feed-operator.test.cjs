'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertServerStatement,connectServerFeed}=require('../scripts/server-feed-operator.cjs');
const {TARGETS}=require('../scripts/d1-operator-bridge.cjs');
const good='UPDATE server_feed_state SET committed_sequence=? WHERE singleton=1';
function setup(options={}){
 const calls=[],ledger={reserved:0,completed:0,reads:0};
 const budget={limits:{maxBatchWrites:5000},beforeWrite:async()=>{ledger.reserved++;return {writes:5000};},complete:()=>{ledger.completed++;},recordRead:()=>{ledger.reads++;}};
 const fetchImpl=async(url,o)=>{calls.push({url,options:o});if(!o.body)return {ok:true,json:async()=>({success:true,result:{uuid:TARGETS.staging.id,name:TARGETS.staging.name,...options.identity}})};
  if(options.failure)throw Error('SECRET_PRIVATE_URL_OR_TOKEN');const body=JSON.parse(o.body),ss=body.batch||[body];return {ok:true,json:async()=>({success:true,result:ss.map(()=>({success:true,results:[],meta:{rows_written:1,rows_read:0}}))})};};
 return {calls,ledger,budget,connect:(overrides={})=>connectServerFeed({target:'staging',token:'private-test-token',fetchImpl,writeBudget:budget,...overrides})};
}
test('allowlist permits bounded shared lease and metadata writes; denies catalogue/customer/DDL',()=>{
 assert.equal(assertServerStatement(good).write,true);
 assert.equal(assertServerStatement("UPDATE automatic_refresh_state SET lease_owner=?,lease_until=? WHERE singleton=1 AND blocked_reason IS NULL AND (pause_until IS NULL OR pause_until<=?) AND (lease_owner IS NULL OR lease_until<=?)").write,true);
 assert.equal(assertServerStatement("INSERT INTO server_feed_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND status='complete') THEN 1 ELSE 0 END)").write,true);
 for(const sql of ['UPDATE auction_listings SET current_bid_usd=0','DELETE FROM users','CREATE TABLE server_feed_bad(a)','DROP TABLE server_feed_state',
  'UPDATE server_feed_outbox SET status=\'complete\'','UPDATE server_feed_outbox SET status=\'complete\' WHERE job_key=? OR 1=1',
  'DELETE FROM server_feed_outbox WHERE job_key=? AND 1=1 OR 1=1','INSERT INTO server_feed_outbox(job_key) SELECT task_key FROM automatic_refresh_tasks',
  'INSERT INTO server_feed_guards(guard_id,allowed) VALUES(?,1),(?,1)','SELECT 1; DELETE FROM server_feed_state',
  'UPDATE server_feed_state SET committed_sequence=0 WHERE singleton=1 --x','PRAGMA writable_schema=1'])assert.throws(()=>assertServerStatement(sql));
});
test('exact remote metadata verified before SQL; writes need durable bounded budget',async()=>{
 const env=setup({identity:{uuid:TARGETS.publication.id}});await assert.rejects(env.connect(),/IDENTITY_MISMATCH/);assert.equal(env.calls.length,1);
 await assert.rejects(setup().connect({writeBudget:null}),/BUDGET_REQUIRED/);
 await assert.rejects(setup().connect({target:'other'}),/TARGET_REQUIRED/);
});
test('statement params and batch size are validated; calls reserve and settle before next writes',async()=>{
 const env=setup(),db=await env.connect();await db.prepare(good).bind(42).run();assert.equal(env.ledger.reserved,1);assert.equal(env.ledger.completed,1);
 await assert.rejects(db.batch(Array.from({length:251},()=>db.prepare(good).bind(42))),/BATCH_INVALID/);
 await assert.rejects(db.prepare(good).bind({bad:1}).run(),/PARAMS_INVALID/);
 await assert.rejects(db.prepare(good).bind(Infinity).run(),/PARAMS_INVALID/);assert.equal(env.ledger.reserved,1);
 await db.batch(Array.from({length:250},()=>db.prepare(good).bind(42)));assert.equal(env.ledger.completed,2);
});
test('transport uncertainty is sanitized and leaves reservation pending without retry',async()=>{
 const env=setup({failure:true}),db=await env.connect();await assert.rejects(db.prepare(good).bind(1).run(),e=>e.message==='SERVER_OPERATOR_TRANSPORT_UNCERTAIN');
 assert.equal(env.ledger.reserved,1);assert.equal(env.ledger.completed,0);assert.equal(env.calls.length,2);
});
test('read-only connection can inspect data but cannot mutate any allowlisted table',async()=>{
 const env=setup(),db=await env.connect({readOnly:true,writeBudget:null});await db.prepare('SELECT COUNT(*) n FROM auction_listings').all();
 assert.throws(()=>db.prepare(good));assert.equal(env.ledger.reserved,0);
});
