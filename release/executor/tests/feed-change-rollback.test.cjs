'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {importChangeBatch,hashReceipt}=require('../sync/feed-change-import.cjs');
const {buildChangeRollback,LISTING_COLUMNS,TASK_COLUMNS,MUTABLE_LISTING_COLUMNS}=require('../sync/feed-change-rollback.cjs');
const {assertStatement}=require('../scripts/d1-operator-bridge.cjs');
const NOW=Date.parse('2026-10-29T12:00:00.000Z'),AT=new Date(NOW).toISOString(),OLD='2026-10-27T12:00:00.000Z';
const VIN='1HGCM82633A004352',LOT='10000001';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const writes=new Set(['auction_listings','automatic_refresh_tasks','automatic_refresh_state','automatic_refresh_guards','sync_batch_guards']);
function database(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',name),'utf8'));
 sqlite.exec("CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT); INSERT INTO users VALUES('private','unchanged')");
 const hooks={beforeBatch:null,fault:null,batches:[]};
 const db={prepare(sql){return{bind(...params){return{sql,params,
  async all(){return{results:sqlite.prepare(sql).all(...params)};},async first(){return sqlite.prepare(sql).get(...params)||null;},
  async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}};}};},async batch(statements){
  hooks.batches.push(statements);assert.ok(statements.length<=250);
  for(const item of statements)assertStatement(item.sql,writes);
  await hooks.beforeBatch?.();sqlite.exec('BEGIN IMMEDIATE');
  try{const result=statements.map(item=>{if(hooks.fault?.(item))throw Error('INJECTED_DATABASE_FAILURE');return{meta:{changes:Number(sqlite.prepare(item.sql).run(...item.params).changes)}};});sqlite.exec('COMMIT');return result;}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
 }};
 return{sqlite,db,hooks,store:new RefreshStore(db,'file-rollback-test',()=>NOW)};
}
function seed(sqlite,lot=LOT,platform='copart'){
 const source=`source-${platform}-${lot}`,id=`listing-${platform}-${lot}`;
 sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,identity_state,first_seen_at,last_seen_at,created_at,updated_at)
 VALUES(?,'apibara',?,'resolved',?,?,?,?)`).run(source,platform,OLD,OLD,OLD,OLD);
 sqlite.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,lot,identity_state,vin_normalized,source_updated_at,
 summary_synced_at,detail_synced_at,first_seen_at,last_seen_at,created_at,updated_at,auction_state,source_status,auction_at,
 is_timed,timed_end_at,current_bid_usd,current_bid2_usd,buy_now_usd,media_urls_json)
 VALUES(?,?,?,?,'resolved',?,?,?,?,?,?,?,?,'open','Open','2026-10-30T12:00:00.000Z',0,NULL,100,NULL,15000,'["original-photo"]')`)
 .run(id,source,platform,lot,VIN,OLD,OLD,OLD,OLD,OLD,OLD,OLD);
}
function event(sequence,lot=LOT,after={'pricing.current_bid_usd':200,make:'Changed'},extra={}){
 return{sequence,event_id:`chg_${sequence}`,event:'bid.changed',terminal:false,vehicle:{platform:'copart',lot_number:lot,vin:VIN},
 changed_fields:Object.keys(after),before:{},after,recorded_at:'2026-10-28T12:00:00.000Z',...extra};
}
const group=events=>({platform:events[0].vehicle.platform,lot:events[0].vehicle.lot_number,events,quarantinedSequences:[]});
function receipt(groups=[group([event(1)])],extra={}){
 const sequences=groups.flatMap(g=>g.events.map(e=>e.sequence));
 const sources=[{generationId:1,sha256:'a'.repeat(64),records:sequences.length,firstSequence:Math.min(...sequences),lastSequence:Math.max(...sequences)}];
 const dataset={identity:hash({version:1,sources}),databaseSha256:'d'.repeat(64),sources,records:sequences.length,quarantined:0,
 firstSequence:Math.min(...sequences),lastSequence:Math.max(...sequences),uniqueLots:groups.length};
 const value={version:1,dataset,observedAt:AT,offset:0,eventOffset:0,quarantineOffset:0,groups,...extra};value.batchSha256=hashReceipt(value);return value;
}
function capture(env,input){
 const groups=new Set(input.groups.map(g=>`${g.platform}:${g.lot}`));
 const keys=new Set([...groups].map(key=>`reconcile:${key}`).concat(`file-changes:${input.dataset.databaseSha256}`,`file-change-batch:${input.dataset.databaseSha256}:${input.offset}`));
 return{listings:env.sqlite.prepare('SELECT * FROM auction_listings ORDER BY listing_id').all().filter(row=>groups.has(`${row.platform}:${row.lot}`)).map(row=>({...row})),
 tasks:env.sqlite.prepare('SELECT * FROM automatic_refresh_tasks ORDER BY task_key').all().filter(row=>keys.has(row.task_key)).map(row=>({...row}))};
}
const apply=(env,input)=>importChangeBatch({db:env.db,store:env.store,receipt:input});
const undo=(env,plan)=>env.store.guarded(plan.statements.map(item=>env.db.prepare(item.sql).bind(...item.params)));
const allRows=env=>env.sqlite.prepare('SELECT * FROM auction_listings ORDER BY listing_id').all();
const allTasks=env=>env.sqlite.prepare('SELECT * FROM automatic_refresh_tasks ORDER BY task_key').all();
function clean(env){for(const name of ['automatic_refresh_guards','sync_batch_guards'])assert.equal(env.sqlite.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n,0);assert.deepEqual(env.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);}
async function setup(t,input=receipt()){
 const env=database(t);for(const g of input.groups)seed(env.sqlite,g.lot,g.platform);await env.store.acquire();
 const before=capture(env,input);await apply(env,input);const after=capture(env,input);return{env,input,before,after};
}

test('pure builder restores only importer fields and affected tasks under the shared lease',async t=>{
 const env=database(t);seed(env.sqlite);await env.store.acquire();
 const due=new Date(NOW+86400000).toISOString();
 env.sqlite.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor,next_due_at,last_attempt_at,status,failures,last_error_code)
 VALUES(?,'copart',?,?,?,?,'pending',2,'TIMEOUT')`).run(`reconcile:copart:${LOT}`,`listing-copart-${LOT}`,LOT,due,OLD);
 env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('stream:changes','all','900',?,'complete')").run(OLD);
 const input=receipt([group([event(1)]),group([event(2,'10000002')])]);
 const before=capture(env,input),sources=env.sqlite.prepare('SELECT * FROM vehicle_sources').all(),tasksBefore=allTasks(env);
 await apply(env,input);const after=capture(env,input),saved=structuredClone({receipt:input,before,after});
 const plan=buildChangeRollback(saved);assert.deepEqual(saved,{receipt:input,before,after});assert.deepEqual(plan,buildChangeRollback(saved));
 assert.equal(plan.restoredListings,1);assert.equal(plan.restoredTasks,1);assert.equal(plan.deletedTasks,3);
 for(const item of plan.statements){assert.ok(!/INSERT INTO auction_listings|DELETE FROM auction_listings|UPDATE vehicle_sources|UPDATE automatic_refresh_state|stream:changes/.test(item.sql));assertStatement(item.sql,new Set(['auction_listings','automatic_refresh_tasks','sync_batch_guards']));}
 await undo(env,plan);assert.deepEqual(capture(env,input),before);assert.deepEqual(allTasks(env),tasksBefore);
 assert.deepEqual(env.sqlite.prepare('SELECT * FROM vehicle_sources').all(),sources);
 assert.equal(env.sqlite.prepare("SELECT name FROM users WHERE id='private'").get().name,'unchanged');clean(env);
 await assert.rejects(undo(env,plan),/FAILED|COMMIT/);assert.deepEqual(capture(env,input),before);clean(env);
});

test('last batch undo restores the earlier file checkpoint and retains its earlier audit',async t=>{
 const env=database(t);seed(env.sqlite);seed(env.sqlite,'10000002');await env.store.acquire();
 const groups=[group([event(1)]),group([event(2,'10000002')])],all=receipt(groups).dataset;
 await apply(env,receipt(groups.slice(0,1),{dataset:all}));
 const input=receipt(groups.slice(1),{dataset:all,offset:1,eventOffset:1}),before=capture(env,input),earlierTasks=allTasks(env);
 await apply(env,input);const plan=buildChangeRollback({receipt:input,before,after:capture(env,input)});
 await undo(env,plan);assert.deepEqual(capture(env,input),before);assert.deepEqual(allTasks(env),earlierTasks);clean(env);
});

test('upgraded catalogue rollback preserves color and rejects a concurrent correction',async t=>{
 const env=database(t),input=receipt();
 env.sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0019_catalog_exterior_color.sql'),'utf8'));
 seed(env.sqlite);await env.store.acquire();const before=capture(env,input);await apply(env,input);
 const after=capture(env,input),plan=buildChangeRollback({receipt:input,before,after});
 env.sqlite.prepare('UPDATE auction_listings SET exterior_color=?').run('White');
 await assert.rejects(undo(env,plan),/FAILED|COMMIT/);assert.equal(allRows(env)[0].exterior_color,'White');
 assert.throws(()=>buildChangeRollback({receipt:input,before,after:capture(env,input)}),/NON_IMPORT_CHANGE/);
});

test('newer listing price, detail timestamp or unrelated full-record field aborts every undo effect',async t=>{
 for(const [field,value] of [['current_bid_usd',900],['detail_synced_at',AT],['media_urls_json','["new-photo"]'],['vehicle_title','Newer title']]){
  const {env,input,before,after}=await setup(t),plan=buildChangeRollback({receipt:input,before,after}),tasks=allTasks(env);
  env.hooks.beforeBatch=()=>env.sqlite.prepare(`UPDATE auction_listings SET ${field}=?`).run(value);
  await assert.rejects(undo(env,plan),/FAILED|COMMIT/);assert.deepEqual(allTasks(env),tasks);
  assert.equal(allRows(env)[0][field],value);if(field!=='current_bid_usd')assert.equal(allRows(env)[0].current_bid_usd,200);clean(env);
 }
});

test('a concurrent task mutation or deletion aborts rollback of listing prices',async t=>{
 for(const mutation of ["UPDATE automatic_refresh_tasks SET failures=failures+1 WHERE task_key LIKE 'reconcile:%'",
  "UPDATE automatic_refresh_tasks SET cursor=cursor||' ' WHERE task_key LIKE 'file-changes:%'",
  "UPDATE automatic_refresh_tasks SET last_error_code='NEW' WHERE task_key LIKE 'file-change-batch:%'",
  "DELETE FROM automatic_refresh_tasks WHERE task_key LIKE 'reconcile:%'"]){
  const {env,input,before,after}=await setup(t),plan=buildChangeRollback({receipt:input,before,after});
  env.hooks.beforeBatch=()=>env.sqlite.exec(mutation);await assert.rejects(undo(env,plan),/FAILED|COMMIT/);
  assert.equal(allRows(env)[0].current_bid_usd,200);clean(env);
 }
});

test('absence guards reject a newly appeared LOT or previously absent reconciliation task',async t=>{
 for(const kind of ['listing','task']){
  const env=database(t);seed(env.sqlite);await env.store.acquire();
  const input=receipt([group([event(1,LOT,{'pricing.current_bid_usd':200})]),group([event(2,'10000002',{}, {event:'lot.removed',terminal:true})])]);
  const before=capture(env,input);await apply(env,input);const after=capture(env,input),plan=buildChangeRollback({receipt:input,before,after});
  env.hooks.beforeBatch=()=>kind==='listing'?seed(env.sqlite,'10000002'):env.sqlite.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status)
   VALUES('reconcile:copart:10000002','copart','10000002',?,'pending')`).run(AT);
  await assert.rejects(undo(env,plan),/FAILED|COMMIT/);assert.equal(allRows(env)[0].current_bid_usd,200);clean(env);
 }
});

test('changed source ownership and stale lease reject the full undo transaction',async t=>{
 for(const mutation of ["UPDATE vehicle_sources SET provider='other'","UPDATE vehicle_sources SET identity_state='ambiguous'",
  "UPDATE automatic_refresh_state SET lease_owner='other'","UPDATE automatic_refresh_state SET lease_until='2026-10-29T11:00:00.000Z'"]){
  const {env,input,before,after}=await setup(t),plan=buildChangeRollback({receipt:input,before,after});
  env.sqlite.exec(mutation);await assert.rejects(undo(env,plan),/FAILED|COMMIT/);
  assert.deepEqual(capture(env,input),after);clean(env);
 }
});

test('late task-write failure rolls back earlier restored prices and retry succeeds',async t=>{
 const {env,input,before,after}=await setup(t),plan=buildChangeRollback({receipt:input,before,after});
 env.hooks.fault=item=>item.sql==='DELETE FROM automatic_refresh_tasks WHERE task_key=?';
 await assert.rejects(undo(env,plan),/FAILED|DATABASE/);assert.deepEqual(capture(env,input),after);clean(env);
 env.hooks.fault=null;await undo(env,plan);assert.deepEqual(capture(env,input),before);clean(env);
});

test('full column lists match the actual schema; 100 group undo stays below 250 statements',async t=>{
 const groups=Array.from({length:100},(_,i)=>group([event(i+1,String(10000000+i))]));
 const {env,input,before,after}=await setup(t,receipt(groups));
 assert.deepEqual(env.sqlite.prepare('PRAGMA table_info(auction_listings)').all().map(row=>row.name),LISTING_COLUMNS);
 assert.deepEqual(env.sqlite.prepare('PRAGMA table_info(automatic_refresh_tasks)').all().map(row=>row.name),TASK_COLUMNS);
 const plan=buildChangeRollback({receipt:input,before,after});assert.equal(plan.statements.length+2,206);
 assert.ok(plan.statements[0].sql.includes(') IS ('));assert.ok(!plan.statements[0].sql.includes('l.listing_id IS'));
 assert.ok(plan.statements.every(item=>item.params.length<=100));await undo(env,plan);assert.deepEqual(capture(env,input),before);clean(env);
});

test('unsupported tables, global stream tasks, wrong file identities and contradictory listing identity are refused',async t=>{
 const {input,before,after}=await setup(t);
 const mutations=[
  value=>{value.after.tasks[0].task_key='stream:changes';},
  value=>{value.after.tasks[0].task_key='file-changes:'+'e'.repeat(64);},
  value=>{value.after.tasks[0].platform='iaai';},
  value=>{value.after.listings[0].listing_id='different';},
  value=>{value.after.listings[0].source_key='other-source';},
  value=>{value.after.listings[0].lot='10000002';},
  value=>{value.after.listings.push({...value.after.listings[0],listing_id:'duplicate'});},
  value=>{value.after.listings=[];},
  value=>{value.before.listings=[];},
  value=>{value.after.tasks.find(row=>row.task_key.startsWith('reconcile:')).cursor='10000009';},
  value=>{delete value.after.listings[0].media_urls_json;},
  value=>{value.after.listings[0]['evil)']=null;},
  value=>{value.after.tasks.push({...value.after.tasks[0]});}
 ];
 for(const mutate of mutations){const value=structuredClone({receipt:input,before,after});mutate(value);assert.throws(()=>buildChangeRollback(value),/FEED_ROLLBACK/);}
});

test('snapshots containing changes beyond this import or stale audit binding cannot authorize undo',async t=>{
 const {input,before,after}=await setup(t);
 const mutations=[
  value=>{value.after.listings[0].detail_synced_at=AT;},
  value=>{value.after.listings[0].current_bid_usd=777;},
  value=>{value.after.tasks.find(row=>row.task_key.startsWith('reconcile:')).failures++;},
  value=>{const row=value.after.tasks.find(row=>row.task_key.startsWith('file-change-batch:'));const data=JSON.parse(row.cursor);data.batchSha256='f'.repeat(64);row.cursor=JSON.stringify(data);},
  value=>{const row=value.after.tasks.find(row=>row.task_key.startsWith('file-changes:'));const data=JSON.parse(row.cursor);data.offset++;row.cursor=JSON.stringify(data);},
  value=>{value.before.tasks.push({...value.after.tasks.find(row=>row.task_key.startsWith('file-change-batch:'))});}
 ];
 for(const mutate of mutations){const value=structuredClone({receipt:input,before,after});mutate(value);assert.throws(()=>buildChangeRollback(value),/FEED_ROLLBACK/);}
 const tooMany=receipt(Array.from({length:101},(_,i)=>group([event(i+1,String(10000000+i))])));
 assert.throws(()=>buildChangeRollback({receipt:tooMany,before,after}),/FEED_CHANGE_RECEIPT_INVALID/);
});

test('terminal changes restore nulls and original active fields without touching prices outside importer scope',async t=>{
 const input=receipt([group([event(1,LOT,{}, {event:'lot.sold',terminal:true})])]);
 const {env,before,after}=await setup(t,input),plan=buildChangeRollback({receipt:input,before,after});
 const update=plan.statements.find(item=>item.sql.startsWith('UPDATE auction_listings'));
 assert.ok(update.sql.includes('buy_now_usd=?'));assert.ok(!update.sql.includes('final_price_usd='));
 await undo(env,plan);assert.deepEqual(capture(env,input),before);clean(env);
});

test('net-zero and identity-error groups undo only their tasks and still fence untouched rows',async t=>{
 for(const kind of ['netzero','identity']){
  const events=kind==='netzero'?[event(1),event(2,LOT,{'pricing.current_bid_usd':100})]:[event(1,LOT,{'pricing.current_bid_usd':300},{vehicle:{platform:'copart',lot_number:LOT,vin:'SALZP2FX8PH185647'}})];
  const {env,input,before,after}=await setup(t,receipt([group(events)])),plan=buildChangeRollback({receipt:input,before,after});
  assert.equal(plan.restoredListings,0);assert.ok(!plan.statements.some(item=>item.sql.startsWith('UPDATE auction_listings')));
  env.sqlite.exec('UPDATE auction_listings SET current_bid_usd=777');
  await assert.rejects(undo(env,plan),/FAILED|COMMIT/);
  assert.equal(allRows(env)[0].current_bid_usd,777);assert.deepEqual(capture(env,input).tasks,after.tasks);clean(env);
  env.sqlite.exec('UPDATE auction_listings SET current_bid_usd=100');
  await undo(env,plan);assert.deepEqual(capture(env,input),before);clean(env);
 }
 assert.deepEqual(MUTABLE_LISTING_COLUMNS,['auction_state','source_status','auction_at','is_timed','timed_end_at','current_bid_usd','current_bid2_usd','buy_now_usd']);
});
