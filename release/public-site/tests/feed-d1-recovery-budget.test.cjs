'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {ServerFeedState}=require('../sync/feed-server-state.cjs');
const recovery=require('../sync/feed-d1-recovery-budget.cjs');
const NOW=Date.parse('2026-10-31T21:00:00.000Z'),AT=new Date(NOW).toISOString(),DAY='2026-10-31';
const CONFIG={REXBID_FEED_D1_RECOVERY_ID:recovery.ID,REXBID_FEED_D1_RECOVERY_WRITE_LIMIT:String(recovery.WRITE_LIMIT),
 REXBID_FEED_D1_RECOVERY_READ_LIMIT:String(recovery.READ_LIMIT),REXBID_FEED_D1_RECOVERY_THROUGH:String(recovery.THROUGH)};
const SCOPE={generationId:5644,lastSequence:46529371,status:'prepared'};
const REQUEST={rowsWritten:5000,rowsRead:50000,recoveryScope:SCOPE};
async function harness(t,options={}){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql'])sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 const calls={clock:NOW,batches:[],beforeBatch:null,afterCommit:null,fault:null,prepared:[]};
 sqlite.function('date',value=>(value==='now'?new Date(calls.clock):new Date(value)).toISOString().slice(0,10));
 sqlite.function('julianday',value=>(value==='now'?calls.clock:Date.parse(value))/86400000+2440587.5);
 const db={prepare(sql){calls.prepared.push(sql);return{bind(...params){return{sql,params,
  async all(){return{results:sqlite.prepare(sql).all(...params)};},async first(){return sqlite.prepare(sql).get(...params)||null;},
  async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}};}};},async batch(statements){
  calls.batches.push(statements);await calls.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');let result;
  try{result=statements.map(statement=>{if(calls.fault?.(statement))throw Error('INJECTED_FAILURE');return{meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.params).changes)}};});sqlite.exec('COMMIT');}
  catch(error){sqlite.exec('ROLLBACK');throw error;}await calls.afterCommit?.(statements);return result;
 }};
 sqlite.prepare('INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,46335880,?,?)').run('{}',AT);
 for(const [id,last,status]of [[5644,46529371,'prepared'],[6698,recovery.THROUGH,'prepared'],[6710,null,'downloaded'],[6711,recovery.THROUGH+100,'prepared']]){
  sqlite.prepare('INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,observed_at,status,first_sequence,last_sequence,manifest_key,manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(id,String(id).padStart(64,'a'),'raw/'+id+'.gz',100,AT,status,last===null?null:last-100,last,'manifest/'+id,String(id).padStart(64,'b'),AT,AT);
 }
 const store=new RefreshStore(db,'d1-recovery-test',()=>calls.clock),state=new ServerFeedState({db,store,...options});await store.acquire();
 const h={sqlite,db,store,state,calls};h.activate=()=>state.configureD1Recovery(CONFIG);return h;
}
function daily(h,changes={}){
 const row={day_key:DAY,write_limit:1000000,read_limit:50000000,reserved_writes:0,reserved_reads:0,consumed_writes:0,consumed_reads:0,updated_at:AT,...changes};
 h.sqlite.prepare(`INSERT INTO server_feed_daily_budgets(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));return budget(h,row.day_key);
}
const budget=(h,day=DAY)=>h.sqlite.prepare('SELECT * FROM server_feed_daily_budgets WHERE day_key=?').get(day);
const counter=(h,key)=>h.sqlite.prepare('SELECT * FROM automatic_refresh_budgets WHERE budget_key=?').get(key);
const counters=(h,day=DAY)=>recovery.counterKeys(day).map(key=>counter(h,key)?.consumed??null);
const reservation=(h,key)=>h.sqlite.prepare('SELECT * FROM server_feed_reservations WHERE reservation_key=?').get(key);
const binding=(h,key)=>h.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(recovery.bindingKey(key));
const changes=h=>h.sqlite.prepare('SELECT total_changes() n').get().n;
function clean(h){for(const table of ['server_feed_guards','automatic_refresh_guards'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);}

test('candidate defaults OFF; exact fixed config rejects zero, raised bounds and unrelated recovery target',async t=>{
 const h=await harness(t);assert.deepEqual(await h.state.configureD1Recovery({}),{enabled:false});
 await h.state.reserveBudget('ordinary',{rowsWritten:5000,rowsRead:50000});await h.state.settleBudget('ordinary',{rowsWritten:12,rowsRead:72});
 assert.equal(h.sqlite.prepare('SELECT task_key FROM automatic_refresh_tasks WHERE task_key=?').get(recovery.PLAN_KEY),undefined);
 assert.equal(budget(h).consumed_writes,12);assert.equal(budget(h).read_limit,50000000);
 for(const modified of [{REXBID_FEED_D1_RECOVERY_ID:'other'},{REXBID_FEED_D1_RECOVERY_WRITE_LIMIT:'0'},
  {REXBID_FEED_D1_RECOVERY_WRITE_LIMIT:'12000001'},{REXBID_FEED_D1_RECOVERY_READ_LIMIT:'200000001'},
  {REXBID_FEED_D1_RECOVERY_THROUGH:'51292006'}])assert.throws(()=>recovery.configuration({...CONFIG,...modified}),/CONFIG/);
 assert.throws(()=>recovery.configuration({REXBID_FEED_D1_RECOVERY_ID:recovery.ID}),/CONFIG/);clean(h);
});

test('activation seals one immutable frozen plan without rewriting original daily counters or base limits',async t=>{
 const h=await harness(t);const before=daily(h,{consumed_writes:287418,consumed_reads:42000000,reserved_writes:5000,reserved_reads:50000});
 const result=await h.activate();assert.equal(result.through,51573763);assert.equal(result.lifetimeWriteLimit,12000000);assert.equal(result.lifetimeReadLimit,200000000);
 const row=h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(recovery.PLAN_KEY),plan=JSON.parse(row.cursor);
 assert.equal(plan.startFileCursor,46335880);assert.equal(plan.frozenGenerationId,6698);assert.equal(plan.expiresAt,'2026-11-03T00:00:00.000Z');
 assert.deepEqual(budget(h),before);assert.deepEqual(counters(h),[0,0,null,null]);const beforeReplay=changes(h);
 await h.activate();assert.equal(changes(h),beforeReplay);assert.equal(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(recovery.PLAN_KEY).cursor,row.cursor);clean(h);
});

test('credited reserve/settle preserve zero or nonzero ordinary usage and refund only unused estimates',async t=>{
 for(const ordinary of [0,900000]){
  const h=await harness(t);daily(h,{consumed_writes:ordinary,consumed_reads:2000000});await h.activate();
  await h.state.reserveBudget('recover',REQUEST);assert.deepEqual(counters(h),[5000,50000,5000,50000]);
  assert.equal(budget(h).consumed_writes,ordinary);assert.equal(budget(h).reserved_writes,5000);assert.equal(budget(h).read_limit,50000000);
  const cursor=binding(h,'recover').cursor;assert.equal(JSON.parse(cursor).scope.generationId,5644);
  await h.state.settleBudget('recover',{rowsWritten:3000,rowsRead:20000});assert.deepEqual(counters(h),[3000,20000,3000,20000]);
  assert.equal(budget(h).consumed_writes,ordinary+3000);assert.equal(budget(h).consumed_reads,2020000);assert.equal(budget(h).reserved_writes,0);
  assert.equal(binding(h,'recover').status,'settled');assert.equal(binding(h,'recover').cursor,cursor);clean(h);
 }
});

test('recovery credits coexist with existing100M one-day read allowance without modifying either base CHECK',async t=>{
 const h=await harness(t);daily(h,{consumed_reads:90000000});
 await h.state.applyReadAllowance({REXBID_FEED_READ_ALLOWANCE_DAY:DAY,REXBID_FEED_READ_ALLOWANCE_LIMIT:'100000000'});await h.activate();
 await h.state.reserveBudget('coexist',REQUEST);assert.equal(h.state.readPolicy().effectiveReadLimit,100050000);
 await h.state.settleBudget('coexist',{rowsWritten:3000,rowsRead:60000});
 assert.equal(h.state.readPolicy().effectiveReadLimit,100060000);assert.equal(budget(h).read_limit,50000000);assert.equal(budget(h).write_limit,1000000);
 assert.deepEqual(counters(h),[3000,60000,3000,60000]);clean(h);
});

test('unknown usage and reserve replay keep lifetime+origin-day estimates charged exactly once',async t=>{
 const h=await harness(t);await h.activate();await h.state.reserveBudget('unknown',REQUEST);
 assert.deepEqual(await h.state.settleBudget('unknown',null),{settled:false,reason:'unknown_usage_keeps_reservation'});
 const before=counters(h),beforeChanges=changes(h);assert.equal((await h.state.reserveBudget('unknown',REQUEST)).alreadyReserved,true);
 assert.deepEqual(counters(h),before);assert.equal(changes(h),beforeChanges);assert.equal(reservation(h,'unknown').status,'reserved');assert.equal(binding(h,'unknown').status,'reserved');clean(h);
});

test('lifetime charges never reset at midnight; late settlement adjusts origin-day credit and preserves current-day credit',async t=>{
 const h=await harness(t);await h.activate();await h.state.reserveBudget('oct31',REQUEST);
 h.calls.clock+=86400000;await h.store.acquire();await h.activate();await h.state.reserveBudget('nov1',REQUEST);
 assert.deepEqual(counters(h,'2026-11-01'),[10000,100000,5000,50000]);
 await h.state.settleBudget('oct31',{rowsWritten:3000,rowsRead:20000});
 assert.deepEqual(counters(h),[8000,70000,3000,20000]);assert.deepEqual(counters(h,'2026-11-01'),[8000,70000,5000,50000]);
 assert.equal(budget(h).consumed_writes,3000);assert.equal(budget(h,'2026-11-01').reserved_writes,5000);
 assert.equal(h.state.d1RecoveryPolicy().dayCreditWrites,5000);assert.equal(h.state.readPolicy().effectiveReadLimit,50050000);clean(h);
});

test('completion or removed opt-in stops new credits but legitimate daily credits keep ordinary headroom available',async t=>{
 const h=await harness(t);daily(h,{consumed_writes:900000});await h.activate();await h.state.reserveBudget('recover',REQUEST);
 await h.state.settleBudget('recover',{rowsWritten:3000,rowsRead:20000});h.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=?').run(recovery.THROUGH);
 await h.state.configureD1Recovery({});assert.equal(h.state.d1RecoveryPolicy().dayCreditWrites,3000);
 await h.state.reserveBudget('ordinary',{rowsWritten:100000,rowsRead:1000});assert.equal(JSON.parse(binding(h,'ordinary').cursor).credited,false);
 assert.deepEqual(counters(h),[3000,20000,3000,20000]);await assert.rejects(h.state.reserveBudget('no-base-left',{rowsWritten:1,rowsRead:0}),/DAILY_BUDGET_STOP/);
 await h.state.settleBudget('ordinary',{rowsWritten:100000,rowsRead:1000});assert.equal(budget(h).consumed_writes,1003000);assert.deepEqual(counters(h),[3000,20000,3000,20000]);clean(h);
});

test('hard expiry disables additional credits; origin-day reserved work can settle after expiry without clipping',async t=>{
 const h=await harness(t);await h.activate();h.calls.clock=Date.parse('2026-11-02T23:50:00.000Z');await h.store.acquire();await h.activate();
 await h.state.reserveBudget('before-expiry',REQUEST);h.calls.clock=Date.parse('2026-11-03T00:01:00.000Z');await h.store.acquire();await h.activate();
 await h.state.reserveBudget('after-expiry',REQUEST);assert.equal(JSON.parse(binding(h,'after-expiry').cursor).credited,false);
 assert.deepEqual(counters(h,'2026-11-03'),[5000,50000,0,0]);
 await h.state.settleBudget('before-expiry',{rowsWritten:7000,rowsRead:60000});assert.deepEqual(counters(h,'2026-11-02'),[7000,60000,7000,60000]);
 assert.equal(h.state.d1RecoveryPolicy().dayCreditWrites,0);assert.equal(h.state.readPolicy().effectiveReadLimit,50000000);clean(h);
});

test('scope must match an independently verified prepared/applying generation at or below frozen target',async t=>{
 const h=await harness(t);daily(h,{consumed_writes:1000000});await h.activate();
 for(const scope of [null,{generationId:6710,lastSequence:recovery.THROUGH,status:'downloaded'},
  {generationId:6711,lastSequence:recovery.THROUGH+100,status:'prepared'},
  {generationId:6711,lastSequence:recovery.THROUGH,status:'prepared'},
  {...SCOPE,lastSequence:SCOPE.lastSequence-1},{...SCOPE,status:'applying'}]){
  await assert.rejects(h.state.reserveBudget('bad-'+String(scope?.generationId||0)+'-'+String(scope?.lastSequence||0)+'-'+String(scope?.status||'none'),{...REQUEST,recoveryScope:scope}),/DAILY_BUDGET_STOP/);
 }
 assert.deepEqual(counters(h),[0,0,null,null]);await h.state.reserveBudget('frozen-file',{...REQUEST,recoveryScope:{generationId:6698,lastSequence:recovery.THROUGH,status:'prepared'}});
 assert.equal(JSON.parse(binding(h,'frozen-file').cursor).credited,true);assert.equal(budget(h).write_limit,1000000);clean(h);
});

test('lifetime maxima stop further credit across days and actual overrun is fully recorded, never clipped',async t=>{
 const h=await harness(t);await h.activate();const keys=recovery.counterKeys(DAY);
 await h.state.reserveBudget('earlier-work',REQUEST);await h.state.settleBudget('earlier-work',{rowsWritten:recovery.WRITE_LIMIT-5000,rowsRead:0});
 await h.state.reserveBudget('last-estimate',REQUEST);await h.state.settleBudget('last-estimate',{rowsWritten:6000,rowsRead:55000});
 assert.equal(counter(h,keys[0]).consumed,12001000);assert.equal(counter(h,keys[1]).consumed,55000);assert.equal(budget(h).consumed_writes,12001000);
 await assert.rejects(h.state.reserveBudget('over-cap',REQUEST),/D1_RECOVERY_BUDGET_STOP/);
 h.calls.clock+=86400000;await h.store.acquire();await h.activate();await assert.rejects(h.state.reserveBudget('next-day-still-full',REQUEST),/D1_RECOVERY_BUDGET_STOP/);
 await h.state.reserveBudget('ordinary-after-cap',{rowsWritten:1,rowsRead:1});assert.equal(JSON.parse(binding(h,'ordinary-after-cap').cursor).credited,false);clean(h);
});

test('read lifetime cap, lower custom base caps and pre-existing ordinary deficit fail closed',async t=>{
 const h=await harness(t);await h.activate();await h.state.reserveBudget('read-history',REQUEST);await h.state.settleBudget('read-history',{rowsWritten:0,rowsRead:recovery.READ_LIMIT});
 await assert.rejects(h.state.reserveBudget('read-full',REQUEST),/D1_RECOVERY_BUDGET_STOP/);
 const lower=await harness(t,{dailyReads:100});await lower.activate();await assert.rejects(lower.state.reserveBudget('lower',{...REQUEST,rowsRead:100}),/POLICY_CONFLICT/);
 const deficit=await harness(t);daily(deficit,{consumed_writes:1000001});await deficit.activate();await assert.rejects(deficit.state.reserveBudget('no-retro-refund',REQUEST),/DAILY_BUDGET_STOP/);
 assert.deepEqual(counters(deficit),[0,0,null,null]);assert.equal(budget(deficit).consumed_writes,1000001);clean(h);clean(lower);clean(deficit);
});

test('reserve/settle and plan lost acknowledgements replay without duplicate credits or resetting counters',async t=>{
 const h=await harness(t);let fired=false;h.calls.afterCommit=statements=>{if(!fired&&statements.some(s=>s.params?.[0]===recovery.PLAN_KEY)){fired=true;throw Error('PLAN_ACK_LOST');}};
 await assert.rejects(h.activate(),/WRITE_FAILED/);h.calls.afterCommit=null;await h.activate();
 h.calls.afterCommit=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO server_feed_reservations')))throw Error('RESERVE_ACK_LOST');};
 await assert.rejects(h.state.reserveBudget('lost',REQUEST),/WRITE_FAILED/);h.calls.afterCommit=null;
 assert.equal((await h.state.reserveBudget('lost',REQUEST)).alreadyReserved,true);assert.deepEqual(counters(h),[5000,50000,5000,50000]);
 h.calls.afterCommit=statements=>{if(statements.some(s=>s.sql.includes("UPDATE server_feed_reservations SET status='settled'")))throw Error('SETTLE_ACK_LOST');};
 await assert.rejects(h.state.settleBudget('lost',{rowsWritten:2000,rowsRead:12000}),/WRITE_FAILED/);h.calls.afterCommit=null;
 const before=counters(h),beforeChanges=changes(h);assert.equal((await h.state.settleBudget('lost',{rowsWritten:2000,rowsRead:12000})).alreadySettled,true);
 assert.deepEqual(counters(h),before);assert.equal(changes(h),beforeChanges);assert.deepEqual(before,[2000,12000,2000,12000]);
 await assert.rejects(h.state.settleBudget('lost',{rowsWritten:2001,rowsRead:12000}),/SETTLEMENT_CONFLICT/);clean(h);
});

test('failed server reservation or settlement atomically rolls back all four ledger counters, binding and original counters',async t=>{
 const h=await harness(t);daily(h);await h.activate();
 h.calls.fault=s=>s.sql.includes('INSERT INTO server_feed_reservations');await assert.rejects(h.state.reserveBudget('rollback',REQUEST),/WRITE_FAILED/);
 assert.deepEqual(counters(h),[0,0,null,null]);assert.equal(binding(h,'rollback'),undefined);assert.equal(budget(h).reserved_writes,0);
 h.calls.fault=null;await h.state.reserveBudget('rollback',REQUEST);const before=counters(h),base=budget(h);
 h.calls.fault=s=>s.sql.includes("UPDATE server_feed_reservations SET status='settled'");
 await assert.rejects(h.state.settleBudget('rollback',{rowsWritten:1,rowsRead:2}),/WRITE_FAILED/);
 assert.deepEqual(counters(h),before);assert.deepEqual(budget(h),base);assert.equal(binding(h,'rollback').status,'reserved');clean(h);
});

test('receipt/binding/counter tampering and missing bindings fail closed instead of treating credited work as ordinary',async t=>{
 for(const kind of ['binding-missing','binding-tampered','counter-missing','plan-tampered']){
  const h=await harness(t);await h.activate();await h.state.reserveBudget('tamper',REQUEST);const base=budget(h);
  if(kind==='binding-missing')h.sqlite.prepare('DELETE FROM automatic_refresh_tasks WHERE task_key=?').run(recovery.bindingKey('tamper'));
  if(kind==='binding-tampered')h.sqlite.prepare("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key=?").run(recovery.bindingKey('tamper'));
  if(kind==='counter-missing')h.sqlite.prepare('DELETE FROM automatic_refresh_budgets WHERE budget_key=?').run(recovery.counterKeys(DAY)[2]);
  if(kind==='plan-tampered')h.sqlite.prepare("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key=?").run(recovery.PLAN_KEY);
  await assert.rejects(h.state.settleBudget('tamper',{rowsWritten:1,rowsRead:2}),/D1_RECOVERY_(BINDING|RECEIPT)/);assert.deepEqual(budget(h),base);clean(h);
 }
});

test('scope/cursor/expiry races and lost lease reject the entire credited transaction',async t=>{
 for(const kind of ['cursor','generation','expiry','lease']){
  const h=await harness(t);await h.activate();
  if(kind==='expiry'){h.calls.clock=Date.parse('2026-11-02T23:59:59.990Z');await h.store.acquire();await h.activate();}
  h.calls.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO server_feed_reservations')))return;
   if(kind==='cursor')h.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=?').run(recovery.THROUGH);
   if(kind==='generation')h.sqlite.prepare("UPDATE server_feed_generations SET status='blocked' WHERE generation_id=5644").run();
   if(kind==='expiry')h.calls.clock=Date.parse('2026-11-03T00:00:00.001Z');
   if(kind==='lease')h.sqlite.prepare("UPDATE automatic_refresh_state SET lease_owner='other-owner'").run();
  };
  await assert.rejects(h.state.reserveBudget('race',REQUEST),/WRITE_FAILED/);assert.equal(reservation(h,'race'),undefined);assert.equal(binding(h,'race'),undefined);
  assert.equal(counter(h,recovery.counterKeys(DAY)[0]).consumed,0);clean(h);
 }
});

test('pre-plan reservations settle compatibly; all post-plan ordinary reservations receive a binding',async t=>{
 const h=await harness(t);await h.state.reserveBudget('legacy',{rowsWritten:5000,rowsRead:50000});h.calls.clock+=1;await h.activate();
 await h.state.settleBudget('legacy',{rowsWritten:100,rowsRead:200});assert.deepEqual(counters(h),[0,0,null,null]);
 await h.state.reserveBudget('new-ordinary',{rowsWritten:100,rowsRead:200});assert.equal(JSON.parse(binding(h,'new-ordinary').cursor).credited,false);
 await h.state.settleBudget('new-ordinary',{rowsWritten:50,rowsRead:100});assert.deepEqual(counters(h),[0,0,0,0]);clean(h);
});

test('lifetime counter recreation or in-place reset cannot replenish credit across UTC days',async t=>{
 for(const kind of ['new-timestamp','original-timestamp','in-place']){
  const h=await harness(t);await h.activate();await h.state.reserveBudget('charged',REQUEST);await h.state.settleBudget('charged',{rowsWritten:3000,rowsRead:20000});
  const key=recovery.counterKeys(DAY)[0],prior=counter(h,key),base=budget(h);h.calls.clock+=86400000;await h.store.acquire();
  if(kind==='in-place')h.sqlite.prepare('UPDATE automatic_refresh_budgets SET consumed=0 WHERE budget_key=?').run(key);
  else{h.sqlite.prepare('DELETE FROM automatic_refresh_budgets WHERE budget_key=?').run(key);
   const at=kind==='new-timestamp'?new Date(h.calls.clock).toISOString():prior.created_at;
   h.sqlite.prepare('INSERT INTO automatic_refresh_budgets(budget_key,limit_count,consumed,created_at,updated_at) VALUES(?,?,0,?,?)').run(key,recovery.WRITE_LIMIT,at,at);}
  await assert.rejects(h.activate(),/D1_RECOVERY_RECEIPT/);assert.deepEqual(budget(h),base);assert.equal(reservation(h,'new-credit'),undefined);clean(h);
 }
});

test('day timestamps, day counter values and checkpoint receipt are bound and fail closed on damage',async t=>{
 for(const kind of ['day-timestamp','day-consumed','day-receipt-missing','ledger-missing','ledger-tampered']){
  const h=await harness(t);await h.activate();await h.state.reserveBudget('charged',REQUEST);const base=budget(h),dayCounter=recovery.counterKeys(DAY)[2];
  if(kind==='day-timestamp')h.sqlite.prepare('UPDATE automatic_refresh_budgets SET created_at=? WHERE budget_key=?').run('2026-10-31T22:00:00.000Z',dayCounter);
  if(kind==='day-consumed')h.sqlite.prepare('UPDATE automatic_refresh_budgets SET consumed=0 WHERE budget_key=?').run(dayCounter);
  if(kind==='day-receipt-missing')h.sqlite.prepare('DELETE FROM automatic_refresh_tasks WHERE task_key=?').run(recovery.dayKey(DAY));
  if(kind==='ledger-missing')h.sqlite.prepare('DELETE FROM automatic_refresh_tasks WHERE task_key=?').run(recovery.LEDGER_KEY);
  if(kind==='ledger-tampered')h.sqlite.prepare("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key=?").run(recovery.LEDGER_KEY);
  await assert.rejects(h.state.settleBudget('charged',{rowsWritten:1,rowsRead:2}),/D1_RECOVERY_RECEIPT/);assert.deepEqual(budget(h),base);assert.equal(binding(h,'charged').status,'reserved');clean(h);
 }
});

test('checkpoint updates are atomic CAS and three credited days never block ordinary work after expiry',async t=>{
 const h=await harness(t);await h.activate();
 for(let day=0;day<3;day++){
  h.calls.clock=NOW+day*86400000;await h.store.acquire();await h.activate();
  await h.state.reserveBudget('day-'+day,REQUEST);await h.state.settleBudget('day-'+day,{rowsWritten:3000,rowsRead:20000});
 }
 let ledger=JSON.parse(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(recovery.LEDGER_KEY).cursor);
 assert.equal(Object.keys(ledger.days).length,3);assert.equal(ledger.revision,6);assert.equal(ledger.chargedWrites,9000);
 h.calls.clock=NOW+3*86400000;await h.store.acquire();await h.activate();
 await h.state.reserveBudget('ordinary-fourth-day',REQUEST);await h.state.settleBudget('ordinary-fourth-day',{rowsWritten:3000,rowsRead:20000});
 const after=JSON.parse(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(recovery.LEDGER_KEY).cursor);
 assert.deepEqual(after,ledger);assert.deepEqual(counters(h,'2026-11-03'),[9000,60000,0,0]);assert.equal(budget(h,'2026-11-03').consumed_writes,3000);clean(h);
 const race=await harness(t);await race.activate();
 race.calls.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO server_feed_reservations')))
  race.sqlite.prepare("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key=?").run(recovery.LEDGER_KEY);};
 await assert.rejects(race.state.reserveBudget('checkpoint-race',REQUEST),/WRITE_FAILED/);
 assert.equal(reservation(race,'checkpoint-race'),undefined);assert.deepEqual(counters(race),[0,0,null,null]);clean(race);
});

test('lower persisted base caps and midnight crossing cannot receive a new recovery or ordinary reservation',async t=>{
 for(const dimension of ['write_limit','read_limit']){
  const h=await harness(t);daily(h,{[dimension]:1});await h.activate();
  await assert.rejects(h.state.reserveBudget('persisted-lower',REQUEST),/POLICY_CONFLICT/);assert.deepEqual(counters(h),[0,0,null,null]);clean(h);
  const race=await harness(t);daily(race);await race.activate();
  race.calls.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO server_feed_reservations')))race.sqlite.prepare('UPDATE server_feed_daily_budgets SET '+dimension+'=1').run();};
  await assert.rejects(race.state.reserveBudget('persisted-cap-race',REQUEST),/WRITE_FAILED/);assert.equal(reservation(race,'persisted-cap-race'),undefined);assert.deepEqual(counters(race),[0,0,null,null]);clean(race);
 }
 const midnight=await harness(t);await midnight.activate();
 midnight.calls.clock=Date.parse('2026-10-31T23:59:59.990Z');await midnight.store.acquire();
 midnight.calls.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO server_feed_reservations')))midnight.calls.clock+=20;};
 await assert.rejects(midnight.state.reserveBudget('ordinary-midnight',{rowsWritten:10,rowsRead:10}),/WRITE_FAILED/);
 assert.equal(reservation(midnight,'ordinary-midnight'),undefined);assert.deepEqual(counters(midnight),[0,0,null,null]);clean(midnight);
});
