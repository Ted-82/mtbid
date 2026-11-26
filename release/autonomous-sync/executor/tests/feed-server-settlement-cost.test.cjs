'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {ServerFeedState}=require('../sync/feed-server-state.cjs');
const recovery=require('../sync/feed-d1-recovery-budget.cjs');
const {SETTLEMENT_WRITE_OVERHEAD}=require('../sync/feed-server-runner.cjs');
// Read-only production schema captured 2026-11-04. No row data or credentials.
// Evidence SHA256 d2dbb00926c3d7febffa00bc8887842d82ea7904f0b24892b42549d821ed4555.
const CONTROL_SCHEMA=[
  {
    "type": "index",
    "name": "automatic_refresh_tasks_due",
    "tbl_name": "automatic_refresh_tasks",
    "sql": "CREATE INDEX automatic_refresh_tasks_due ON automatic_refresh_tasks(next_due_at,platform)"
  },
  {
    "type": "table",
    "name": "automatic_refresh_budgets",
    "tbl_name": "automatic_refresh_budgets",
    "sql": "CREATE TABLE automatic_refresh_budgets (\n  budget_key TEXT PRIMARY KEY,\n  limit_count INTEGER NOT NULL CHECK(limit_count>=0),\n  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0),\n  created_at TEXT NOT NULL, updated_at TEXT NOT NULL\n)"
  },
  {
    "type": "table",
    "name": "automatic_refresh_guards",
    "tbl_name": "automatic_refresh_guards",
    "sql": "CREATE TABLE automatic_refresh_guards (\n  guard_id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1)\n)"
  },
  {
    "type": "table",
    "name": "automatic_refresh_state",
    "tbl_name": "automatic_refresh_state",
    "sql": "CREATE TABLE automatic_refresh_state (\n  singleton INTEGER PRIMARY KEY CHECK (singleton=1),\n  lease_owner TEXT, lease_until TEXT,\n  blocked_reason TEXT, pause_until TEXT,\n  last_started_at TEXT, last_finished_at TEXT, last_success_at TEXT,\n  quota_checked_at TEXT, quota_limit INTEGER, quota_used INTEGER,\n  quota_left INTEGER, quota_allowance INTEGER,\n  quota_plan TEXT, last_report_json TEXT\n)"
  },
  {
    "type": "table",
    "name": "automatic_refresh_tasks",
    "tbl_name": "automatic_refresh_tasks",
    "sql": "CREATE TABLE automatic_refresh_tasks (\n  task_key TEXT PRIMARY KEY, platform TEXT NOT NULL,\n  listing_id TEXT REFERENCES auction_listings(listing_id),\n  cursor TEXT, scan_started_at TEXT, scan_pages INTEGER NOT NULL DEFAULT 0,\n  scan_errors INTEGER NOT NULL DEFAULT 0,\n  next_due_at TEXT NOT NULL,\n  last_attempt_at TEXT, last_success_at TEXT,\n  status TEXT NOT NULL DEFAULT 'due',\n  failures INTEGER NOT NULL DEFAULT 0,\n  last_error_code TEXT\n)"
  },
  {
    "type": "table",
    "name": "server_feed_daily_budgets",
    "tbl_name": "server_feed_daily_budgets",
    "sql": "CREATE TABLE server_feed_daily_budgets (\n day_key TEXT PRIMARY KEY,\n write_limit INTEGER NOT NULL CHECK(write_limit BETWEEN 1 AND 1000000),\n read_limit INTEGER NOT NULL CHECK(read_limit BETWEEN 1 AND 50000000),\n reserved_writes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_writes>=0),\n reserved_reads INTEGER NOT NULL DEFAULT 0 CHECK(reserved_reads>=0),\n consumed_writes INTEGER NOT NULL DEFAULT 0 CHECK(consumed_writes>=0),\n consumed_reads INTEGER NOT NULL DEFAULT 0 CHECK(consumed_reads>=0),\n updated_at TEXT NOT NULL\n)"
  },
  {
    "type": "table",
    "name": "server_feed_guards",
    "tbl_name": "server_feed_guards",
    "sql": "CREATE TABLE server_feed_guards (\n guard_id TEXT PRIMARY KEY,\n allowed INTEGER NOT NULL CHECK(allowed=1)\n)"
  },
  {
    "type": "table",
    "name": "server_feed_reservations",
    "tbl_name": "server_feed_reservations",
    "sql": "CREATE TABLE server_feed_reservations (\n reservation_key TEXT PRIMARY KEY,\n day_key TEXT NOT NULL REFERENCES server_feed_daily_budgets(day_key),\n reserved_writes INTEGER NOT NULL CHECK(reserved_writes>=0),\n reserved_reads INTEGER NOT NULL CHECK(reserved_reads>=0),\n status TEXT NOT NULL CHECK(status IN ('reserved','settled')),\n actual_writes INTEGER, actual_reads INTEGER,\n created_at TEXT NOT NULL, settled_at TEXT\n)"
  }
];
const CONTROL_TABLES=["server_feed_daily_budgets","server_feed_reservations","server_feed_guards","automatic_refresh_guards","automatic_refresh_state","automatic_refresh_tasks","automatic_refresh_budgets"];

const NOW=Date.parse('2026-10-31T21:00:00.000Z'),AT=new Date(NOW).toISOString(),DAY='2026-10-31';
const CONFIG={REXBID_FEED_D1_RECOVERY_ID:recovery.ID,REXBID_FEED_D1_RECOVERY_WRITE_LIMIT:String(recovery.WRITE_LIMIT),REXBID_FEED_D1_RECOVERY_READ_LIMIT:String(recovery.READ_LIMIT),REXBID_FEED_D1_RECOVERY_THROUGH:String(recovery.THROUGH)};
function profile(sqlite,names=CONTROL_TABLES){return Object.fromEntries(names.map(name=>[name,{columns:sqlite.prepare('PRAGMA table_info('+name+')').all().map(({name,type,pk})=>({name,type,pk})),indexes:sqlite.prepare('PRAGMA index_list('+name+')').all().map(({name,unique,partial})=>({name,unique,partial,columns:sqlite.prepare('PRAGMA index_info('+name+')').all().map(row=>row.name)})).sort((a,b)=>a.name.localeCompare(b.name)),triggers:sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=? ORDER BY name").all(name)}]));}
function schemaDb(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec('CREATE TABLE auction_listings(listing_id TEXT PRIMARY KEY)');for(const item of CONTROL_SCHEMA.filter(s=>s.type==='table'))sqlite.exec(item.sql);for(const item of CONTROL_SCHEMA.filter(s=>s.type==='index'))sqlite.exec(item.sql);return sqlite;}
// Count a conservative row/index upper bound, rather than mislabel SQLite's
// changes() as D1 billing. INSERT/DELETE touch each index once; UPDATE charges
// a delete+insert for each index whose key changes. Unchanged PKs add no writes.
function writeBound(sql,changes,indexes){
 const match=/^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/i.exec(sql);if(!match)throw Error('UNREVIEWED_POSTLUDE_SQL');
 const table=match[2],list=indexes[table];assert.ok(list,'unreviewed mutation table '+table);
 if(/^UPDATE/i.test(match[1])){
  const set=sql.match(/\bSET\s+([\s\S]+?)\s+WHERE\b/i)?.[1];assert.ok(set);const columns=[...set.matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*=/gi)].map(m=>m[1]);assert.ok(columns.length);
  return changes*(1+2*list.filter(index=>index.some(column=>columns.includes(column))).length);
 }
 return changes*(1+list.length);
}
async function harness(t){
 const sqlite=schemaDb();t.after(()=>sqlite.close());
 // Remaining state used only to exercise the real optional recovery code.
 sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0011_d1_server_feed.sql'),'utf8'));
 const calls={clock:NOW,trace:[],fault:null,lostReply:false};
 sqlite.function('date',value=>(value==='now'?new Date(calls.clock):new Date(value)).toISOString().slice(0,10));sqlite.function('julianday',value=>(value==='now'?calls.clock:Date.parse(value))/86400000+2440587.5);
 const shape=profile(sqlite);assert.ok(Object.values(shape).every(v=>v.triggers.length===0));
 const indexes=Object.fromEntries(Object.entries(shape).map(([table,value])=>{assert.ok(value.indexes.every(i=>!i.partial&&i.columns.every(c=>typeof c==='string')));return[table,value.indexes.map(i=>i.columns)];}));
 function run(sql,params){if(calls.fault?.(sql))throw Error('INJECTED_FAILURE');const changed=Number(sqlite.prepare(sql).run(...params).changes),bound=writeBound(sql,changed,indexes);calls.trace.push({sql,changes:changed,bound});return{meta:{changes:changed}};}
 const db={prepare(sql){return{bind(...params){return{sql,params,async all(){return{results:sqlite.prepare(sql).all(...params)};},async first(){return sqlite.prepare(sql).get(...params)||null;},async run(){return run(sql,params);}};}};},async batch(statements){sqlite.exec('BEGIN IMMEDIATE');let result;try{result=statements.map(s=>run(s.sql,s.params));sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}if(calls.lostReply){calls.lostReply=false;throw Error('SIMULATED_LOST_REPLY');}return result;}};
 sqlite.prepare('INSERT INTO automatic_refresh_state(singleton) VALUES(1)').run();
 sqlite.prepare('INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,46335880,?,?)').run('{}',AT);
 for(const [id,last]of [[5644,46529371],[6698,recovery.THROUGH]])sqlite.prepare('INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,observed_at,status,first_sequence,last_sequence,manifest_key,manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,String(id).padStart(64,'a'),'raw/'+id+'.gz',100,AT,'prepared',last-100,last,'manifest/'+id,String(id).padStart(64,'b'),AT,AT);
 const store=new RefreshStore(db,'settlement-proof',()=>calls.clock),state=new ServerFeedState({db,store});await store.acquire();
 const release=()=>db.prepare('UPDATE automatic_refresh_state SET lease_owner=NULL,lease_until=NULL WHERE singleton=1 AND lease_owner=?').bind(store.owner).run();
 return{sqlite,db,calls,store,state,release,reset(){calls.trace=[];},bound(){return calls.trace.reduce((n,r)=>n+r.bound,0);},reservation:key=>sqlite.prepare('SELECT * FROM server_feed_reservations WHERE reservation_key=?').get(key),budget:()=>sqlite.prepare('SELECT * FROM server_feed_daily_budgets WHERE day_key=?').get(DAY)};
}
async function reserve(h,kind='normal'){
 await h.state.configureD1Recovery(kind==='normal'?{}:CONFIG);
 await h.state.reserveBudget('cost-proof',{rowsWritten:5000,rowsRead:50000,...(kind==='credited'?{recoveryScope:{generationId:5644,lastSequence:46529371,status:'prepared'}}:{})});h.reset();
}
async function finish(h,usage){try{return await h.state.settleBudget('cost-proof',usage);}finally{await h.release();}}
function assertCovered(h,expected){assert.equal(h.bound(),expected,JSON.stringify(h.calls.trace));assert.ok(h.bound()<=SETTLEMENT_WRITE_OVERHEAD);assert.ok(SETTLEMENT_WRITE_OVERHEAD<=32);}

test('production control schema and current migrations retain exactly the reviewed index/trigger shape',t=>{
 const actual=schemaDb(),repo=new DatabaseSync(':memory:');t.after(()=>{actual.close();repo.close();});for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql'])repo.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));assert.deepEqual(profile(repo),profile(actual));
});
test('normal known usage is fully charged, with settlement and release bounded to11 row/index writes',async t=>{
 const h=await harness(t);await reserve(h);await finish(h,{rowsWritten:1234+SETTLEMENT_WRITE_OVERHEAD,rowsRead:1234+100});assertCovered(h,11);assert.equal(h.budget().consumed_writes,1234+SETTLEMENT_WRITE_OVERHEAD);assert.equal(h.budget().reserved_writes,0);assert.equal(h.reservation('cost-proof').status,'settled');
});
test('credited recovery refund and overrun settlement both retain all four counters and fit19 writes',async t=>{
 for(const writes of [1234,7000]){const h=await harness(t);await reserve(h,'credited');await finish(h,{rowsWritten:writes+SETTLEMENT_WRITE_OVERHEAD,rowsRead:60000});assertCovered(h,19);assert.equal(h.budget().consumed_writes,writes+SETTLEMENT_WRITE_OVERHEAD);const counters=h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key IN(?,?,?,?)').all(...recovery.counterKeys(DAY)).map(r=>r.consumed);assert.deepEqual(counters.sort((a,b)=>a-b),[writes+SETTLEMENT_WRITE_OVERHEAD,writes+SETTLEMENT_WRITE_OVERHEAD,60000,60000].sort((a,b)=>a-b));}
});
test('ordinary work with a retained recovery binding fits14 writes and never receives new credit',async t=>{
 const h=await harness(t);await reserve(h,'uncredited');const binding=JSON.parse(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(recovery.bindingKey('cost-proof')).cursor);assert.equal(binding.credited,false);await finish(h,{rowsWritten:1500,rowsRead:2000});assertCovered(h,14);
});
test('unknown usage retains the entire reservation; only its owner lease is released',async t=>{
 const h=await harness(t);await reserve(h);assert.equal((await finish(h,null)).settled,false);assertCovered(h,1);assert.equal(h.budget().reserved_writes,5000);assert.equal(h.budget().consumed_writes,0);assert.equal(h.reservation('cost-proof').status,'reserved');
});
test('rolled-back or lost-response settlement never clears an uncommitted reservation or duplicates a committed one',async t=>{
 for(const lost of [false,true]){const h=await harness(t);await reserve(h,'credited');if(lost)h.calls.lostReply=true;else h.calls.fault=sql=>/^UPDATE server_feed_reservations SET status=/.test(sql);await assert.rejects(finish(h,{rowsWritten:1500,rowsRead:2000}));assert.ok(h.bound()<=SETTLEMENT_WRITE_OVERHEAD);assert.equal(h.reservation('cost-proof').status,lost?'settled':'reserved');assert.equal(h.budget().reserved_writes,lost?0:5000);if(lost){h.reset();assert.equal((await finish(h,{rowsWritten:1500,rowsRead:2000})).alreadySettled,true);assertCovered(h,0);}}
});
test('expired owner lease rejects the settlement atomically without refunding reserved usage',async t=>{
 const h=await harness(t);await reserve(h);h.sqlite.prepare('UPDATE automatic_refresh_state SET lease_owner=?').run('another-owner');await assert.rejects(finish(h,{rowsWritten:1500,rowsRead:2000}));assertCovered(h,0);assert.equal(h.reservation('cost-proof').status,'reserved');assert.equal(h.budget().reserved_writes,5000);assert.equal(h.sqlite.prepare('SELECT lease_owner FROM automatic_refresh_state').get().lease_owner,'another-owner');
});
