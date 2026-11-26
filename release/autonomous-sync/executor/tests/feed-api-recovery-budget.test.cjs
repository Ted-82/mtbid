'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {recoveryBudget,configuration,recoveryAttemptCount}=require('../sync/feed-api-recovery-budget.cjs');
const KEY='feed-api-recovery:2026-10-31-gap',AT='2026-10-31T12:00:00.000Z';
async function harness(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 sqlite.exec('CREATE TABLE server_feed_state(singleton INTEGER PRIMARY KEY,committed_sequence INTEGER,active_generation INTEGER); INSERT INTO server_feed_state VALUES(1,46286377,NULL)');
 const db={prepare(sql){return{bind(...params){return{sql,params,async first(){return sqlite.prepare(sql).get(...params)||null;},
  async all(){return{results:sqlite.prepare(sql).all(...params)};},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}};}};},
  async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>({meta:{changes:Number(sqlite.prepare(s.sql).run(...s.params).changes)}}));sqlite.exec('COMMIT');return result;}
  catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const now=()=>Date.parse(AT),store=new RefreshStore(db,'recovery-test',now);await store.acquire();
 await store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
 sqlite.prepare('UPDATE automatic_refresh_state SET quota_checked_at=?,quota_left=88917,quota_allowance=78916').run(AT);
 const env={REXBID_FEED_API_RECOVERY_ID:'2026-10-31-gap',REXBID_FEED_API_RECOVERY_LIMIT:'12000',REXBID_FEED_API_RECOVERY_THROUGH:'51292006'};
 const h={env,db,store,now,sqlite};h.create=()=>recoveryBudget(h);return h;
}
const spec={operation:'vehicleChanges',after:46286377,limit:500};
test('disabled recovery creates no rows; malformed activation cannot enable an allowance',async t=>{
 const h=await harness(t);assert.equal(configuration({}),null);assert.equal(await recoveryBudget({...h,env:{}}),null);
 assert.equal(h.sqlite.prepare('SELECT count(*) n FROM automatic_refresh_tasks').get().n,0);
 for(const env of [{REXBID_FEED_API_RECOVERY_ID:'other'}, {...h.env,REXBID_FEED_API_RECOVERY_LIMIT:'0'}, {...h.env,REXBID_FEED_API_RECOVERY_THROUGH:'51292007'}])
  assert.throws(()=>configuration(env),/SERVER_FEED_RECOVERY_CONFIG/);
});
test('immutable activation receipt and counter survive restarts and tightening cannot later extend them',async t=>{
 const h=await harness(t),r=await h.create();await r.reserve(spec);
 const before=h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(KEY).cursor;
 assert.deepEqual(JSON.parse(before),{version:1,id:'2026-10-31-gap',startAfter:46286377,through:51292006});
 h.env.REXBID_FEED_API_RECOVERY_LIMIT='1';await h.create();
 h.env.REXBID_FEED_API_RECOVERY_LIMIT='12000';const resumed=await h.create();await assert.rejects(resumed.reserve(spec),/RECOVERY_BUDGET_STOP/);
 assert.equal(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(KEY).cursor,before);
 assert.deepEqual(h.sqlite.prepare('SELECT limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(KEY),Object.assign(Object.create(null),{limit_count:1,consumed:1}));
});
test('lost lease fences initialization and reservation; transaction failure cannot leave a partial receipt',async t=>{
 const h=await harness(t);h.sqlite.exec("CREATE TRIGGER reject_recovery_counter BEFORE INSERT ON automatic_refresh_budgets WHEN NEW.budget_key LIKE 'feed-api-recovery:%' BEGIN SELECT RAISE(ABORT,'offline failure'); END");
 await assert.rejects(h.create());assert.equal(h.sqlite.prepare('SELECT count(*) n FROM automatic_refresh_tasks WHERE task_key=?').get(KEY).n,0);
 h.sqlite.exec('DROP TRIGGER reject_recovery_counter');const r=await h.create();
 h.sqlite.exec("UPDATE automatic_refresh_state SET lease_owner='other'");await assert.rejects(r.reserve(spec));
 assert.equal(h.sqlite.prepare('SELECT count(*) n FROM automatic_refresh_attempts').get().n,0);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(KEY).consumed,0);
});
test('attempt insert and all counters roll back together, while replay is a new charged attempt',async t=>{
 const h=await harness(t),r=await h.create();
 h.sqlite.exec("CREATE TRIGGER reject_recovery_debit BEFORE UPDATE ON automatic_refresh_budgets WHEN NEW.budget_key LIKE 'feed-api-recovery:%' BEGIN SELECT RAISE(ABORT,'offline failure'); END");
 await assert.rejects(r.reserve(spec));assert.equal(h.sqlite.prepare('SELECT count(*) n FROM automatic_refresh_attempts').get().n,0);
 assert.equal(h.sqlite.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key LIKE 'day:%'").get().consumed,0);
 h.sqlite.exec('DROP TRIGGER reject_recovery_debit');const one=await r.reserve(spec),two=await r.reserve(spec);assert.notEqual(one,two);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(KEY).consumed,2);
 assert.equal(h.sqlite.prepare('SELECT quota_allowance FROM automatic_refresh_state').get().quota_allowance,78914);
});
test('only exact current file cursor and supported scope can reserve, even while another generation applies',async t=>{
 const h=await harness(t),r=await h.create();
 for(const s of [{...spec,after:46286376},{...spec,limit:50},{operation:'vehicleByIdentifier'}])await assert.rejects(r.reserve(s),/RECOVERY_SCOPE|RECOVERY_OPERATION/);
 h.sqlite.exec('UPDATE server_feed_state SET active_generation=6635');await assert.rejects(r.reserve(spec),/RECOVERY_SCOPE/);
 assert.equal(h.sqlite.prepare('SELECT count(*) n FROM automatic_refresh_attempts').get().n,0);
});
test('bounded100/25 pages charge one unchanged lifetime reservation each and preserve fixed scope, reserve and caps',async t=>{
 const h=await harness(t),r=await h.create();
 const original=h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(KEY).cursor;
 for(const limit of [100,25])await r.reserve({...spec,limit});
 assert.equal(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(KEY).cursor,original);
 const counter=h.sqlite.prepare('SELECT limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(KEY);
 assert.equal(counter.limit_count,12000);assert.equal(counter.consumed,2);
 assert.equal(h.sqlite.prepare('SELECT count(*) n FROM automatic_refresh_attempts').get().n,2);
 assert.equal(h.sqlite.prepare('SELECT quota_allowance FROM automatic_refresh_state').get().quota_allowance,78914);
 for(const limit of [0,1,24,26,50,99,101,499,501,2000,'100',null])await assert.rejects(r.reserve({...spec,limit}),/RECOVERY_SCOPE/);
 await assert.rejects(r.reserve({...spec,limit:25,after:46286378}),/RECOVERY_SCOPE/);
 h.sqlite.prepare('UPDATE automatic_refresh_budgets SET consumed=12000 WHERE budget_key=?').run(KEY);
 await assert.rejects(r.reserve({...spec,limit:25}),/RECOVERY_BUDGET_STOP/);
 assert.equal(h.sqlite.prepare('SELECT count(*) n FROM automatic_refresh_attempts').get().n,2);
});
test('bounded indexed quota count saturates201 and atomic recovery guard rejects unrefreshed windows',async t=>{
 const h=await harness(t),r=await h.create();
 for(let n=0;n<1000;n++)h.sqlite.prepare("INSERT INTO automatic_refresh_attempts(attempt_id,operation,attempted_at) VALUES(?,'vehicleChanges',?)").run(`seed-${n}`,AT);
 assert.equal(await recoveryAttemptCount(h.db,AT),201);
 await assert.rejects(r.reserve(spec),/RECOVERY_BUDGET_STOP/);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(KEY).consumed,0);
 const plan=h.sqlite.prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) FROM (SELECT 1 FROM automatic_refresh_attempts WHERE attempted_at>=? LIMIT 201)').all(AT);
 assert.ok(plan.some(row=>/USING COVERING INDEX automatic_refresh_attempts_time/.test(row.detail)));
});
test('terminal constructor preserves receipt and returns normal policy even when activation remains configured',async t=>{
 const h=await harness(t),r=await h.create();await r.reserve(spec);
 const cursor=h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(KEY).cursor;
 h.sqlite.exec('UPDATE server_feed_state SET committed_sequence=51292006');assert.equal(await h.create(),null);
 assert.equal(h.sqlite.prepare('SELECT status FROM automatic_refresh_tasks WHERE task_key=?').get(KEY).status,'complete');
 h.sqlite.exec('UPDATE server_feed_state SET committed_sequence=46286377');assert.equal(await h.create(),null);
 assert.equal(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(KEY).cursor,cursor);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(KEY).consumed,1);
 const fresh=await harness(t);fresh.sqlite.exec('UPDATE server_feed_state SET committed_sequence=51292006');assert.equal(await fresh.create(),null);
 assert.equal(fresh.sqlite.prepare('SELECT COUNT(*) n FROM automatic_refresh_budgets WHERE budget_key=?').get(KEY).n,0);
});
