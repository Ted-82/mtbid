'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {gzipSync}=require('node:zlib');
const {RefreshStore,POLICY}=require('../sync/automatic-refresh.cjs');
const {ServerFeedState,SEED_SEQUENCE,digest}=require('../sync/feed-server-state.cjs');
const {runMessage,dispatchDue,workSpec,configuration,measuredDatabase}=require('../sync/feed-server-runner.cjs');
const {prepareFeedArchive}=require('../sync/feed-worker-archive.cjs');
const {prepareInventoryPage}=require('../sync/inventory-page.cjs');
const {commitInventoryBatch}=require('../sync/inventory-commit.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
const {FeedBootstrapMembership}=require('../sync/feed-bootstrap-membership.cjs');
const {replayBootstrapPage}=require('../sync/feed-bootstrap-replay.cjs');
const {activateBootstrap,readBootstrapActivation}=require('../sync/feed-bootstrap-activation.cjs');
const NOW=Date.parse('2026-10-29T12:00:00.000Z'),AT=new Date(NOW).toISOString();
const VIN='1HGCM82633A004352',GENERATION=6001;
const base=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8')).response.data[0];
// Reuse the existing audited aggregate seed fixture, without executing its tests.
// These receipts contain no listing records, secrets, or private feed URLs.
const seedSource=fs.readFileSync(path.join(__dirname,'feed-server-state.test.cjs'),'utf8');
const legacy=JSON.parse(seedSource.match(/const LEGACY_STATES = (\[[\s\S]*?\n\]);/)[1]);
function fullRecord(lot='10000001',updated='2026-10-29T10:00:00.000Z'){
 const value=structuredClone(base);Object.assign(value,{vehicle_id:`synthetic-${lot}`,lot_number:lot,platform:'iaai',vin:VIN,updated_at:updated});
 value.auction.state='open';value.pricing={current_bid_usd:200,current_bid2_usd:null,buy_now_usd:6200};return value;
}
function event(offset,lot='10000001',extra={}){
 const sequence=SEED_SEQUENCE+offset;return{sequence,event_id:`opaque-${sequence}`,event:'bid.changed',terminal:false,
  vehicle:{platform:'iaai',lot_number:lot,vin:VIN},changed_fields:['pricing.current_bid_usd'],before:{'pricing.current_bid_usd':200},
  after:{'pricing.current_bid_usd':500},recorded_at:'2026-10-29T11:00:00.000Z',vehicle_updated_at:'2026-10-29T11:00:00.000Z',...extra};
}
const created=(offset,lot='10000001',record=fullRecord(lot))=>event(offset,lot,{event:'lot.created',changed_fields:['lot.created'],before:[],after:{},record});
const {MemoryR2}=require('./fixtures/feed-capture-memory.cjs');
const captureJournal=require('../sync/feed-capture-journal.cjs');
async function harness(t,events=[created(1),event(2),created(3,'10000002')]){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql','0012_server_feed_reconcile.sql'])
  sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 const calls={clock:NOW,beforeBatch:null,afterCommit:null,sends:[],sendOptions:[],fetches:0,sql:0,prepared:[]};
 // Exercise SQL time guards using the same simulated clock as the Worker.
 // Otherwise these fixtures silently expire when the real calendar advances.
 const clockSql=sql=>sql.replace(/\b(date|julianday)\('now'\)/g,(_,fn)=>`${fn}('${new Date(calls.clock).toISOString()}')`);
 // SQLite harness units are deliberately not advertised as D1 billing totals.
 const meta=(changes=0,read=0)=>({changes,rows_written:changes,rows_read:read});
 const db={prepare(sql){calls.prepared.push(sql);const statement=params=>({sql,params,bind(...values){return statement(values);},
  async all(){calls.sql++;const results=sqlite.prepare(clockSql(sql)).all(...params);return{success:true,results,meta:meta(0,results.length)};},
  async first(){return(await this.all()).results[0]||null;},
  async run(){calls.sql++;const result=sqlite.prepare(clockSql(sql)).run(...params);return{success:true,meta:meta(Number(result.changes))};}
 });return statement([]);},async batch(statements){
  await calls.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');let result;
  try{result=statements.map(item=>{calls.sql++;return{success:true,meta:meta(Number(sqlite.prepare(clockSql(item.sql)).run(...item.params).changes))};});sqlite.exec('COMMIT');}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
  await calls.afterCommit?.(statements);return result;
 }};
 const store=new RefreshStore(db,'integration-seed',()=>calls.clock),state=new ServerFeedState({db,store});
 await store.acquire();const proofs=legacy.map(value=>{
  const cursor=JSON.stringify(value),taskKey='file-changes:'+value.dataset.databaseSha256;
  sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES(?,'all',?,?,'complete')").run(taskKey,cursor,AT);
  return{taskKey,cursorSha256:digest(cursor)};
 });await state.seed({sequence:SEED_SEQUENCE,evidenceId:'runner-integration-fixture',legacyReceipts:proofs});
 sqlite.exec('UPDATE automatic_refresh_state SET lease_owner=NULL,lease_until=NULL');
 const bucket=new MemoryR2(),queue=[];
 const env={REXBID_FEED_ENABLED:'enabled',REXBID_FEED_TARGET:'staging',REXBID_FEED_DATABASE_ID:'acb3cb8e-69a2-459f-8a46-0f2f5b9004be',
  REXBID_FEED_ID:'20',REXBID_FEED_URL:'https://apibara.tech/data-feeds/synthetic-integration/latest',REXBID_DB:db,REXBID_FEED_ARCHIVE:bucket,
  REXBID_FEED_QUEUE:{async send(body,options){calls.sends.push(structuredClone(body));calls.sendOptions.push(structuredClone(options||{}));queue.push(structuredClone(body));}}};
 const bytes=gzipSync(events.map(JSON.stringify).join('\n')+(events.length?'\n':''));
 const fetchImpl=async()=>{calls.fetches++;return new Response(bytes,{status:200,headers:{'content-type':'application/gzip',
  'content-length':String(bytes.length),'content-disposition':`attachment; filename="apibara-feed-20-${calls.generationId||GENERATION}.jsonl.gz"`}});};
 const h={sqlite,db,store,state,calls,bucket,env,queue,events,bytes,fetchImpl};
 h.capture=()=>captureJournal.captureLatest({bucket,url:env.REXBID_FEED_URL,now:()=>calls.clock,fetchImpl});
 h.run=async body=>{if(body.kind==='poll')await h.capture();return runMessage({env,body,now:()=>calls.clock,fetchImpl:h.fetchImpl});};
 h.row=()=>sqlite.prepare('SELECT * FROM server_feed_generations WHERE generation_id=?').get(GENERATION);
 h.outbox=key=>sqlite.prepare('SELECT * FROM server_feed_outbox WHERE job_key=?').get(key);
 h.count=table=>sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
 h.release=()=>sqlite.exec('UPDATE automatic_refresh_state SET lease_owner=NULL,lease_until=NULL');
 return h;
}
async function begin(h){assert.equal((await h.run({version:1,kind:'poll'})).ok,true);const job=h.queue.shift();assert.match(job.jobKey,/:prepare:/);
 let result=await h.run(job),steps=1;assert.equal(result.ok,true,JSON.stringify(result));
 while(result.preparing){assert.ok(++steps<=20);const next=h.queue.shift();assert.equal(next.jobKey,job.jobKey);result=await h.run(next);assert.equal(result.ok,true,JSON.stringify(result));}
 assert.equal(h.row().status,'prepared');return job;}
// Stage-boundary fixture: exercise apply/replay independently of intake bugs.
// Real archive preparation still validates the gzip and builds all128 buckets.
async function preparedState(h){
 const rawKey='raw/integration/source.jsonl.gz',sha256=digest(h.bytes);h.bucket.objects.set(rawKey,h.bytes);
 const prepared=await prepareFeedArchive({bucket:h.bucket,rawKey,rawSha256:sha256,prefix:'prepared',observedAt:AT});
 await h.store.acquire();await h.state.register({generationId:GENERATION,sha256,rawKey,compressedBytes:h.bytes.length,observedAt:AT});
 const spec=workSpec(GENERATION,'apply');
 await h.state.prepare({generationId:GENERATION,manifestKey:prepared.manifestKey,manifestSha256:prepared.manifestSha256,
  archiveBytes:[...h.bucket.objects].filter(([key])=>key!==rawKey).reduce((sum,[,value])=>sum+value.length,0),
  firstSequence:prepared.manifest.firstSequence,lastSequence:prepared.manifest.lastSequence,
  bucketGroups:prepared.manifest.buckets.map(item=>item.uniqueLots),outbox:[spec]});
 h.release();h.queue.push({version:1,jobKey:spec.jobKey});
}
async function drain(h,until){
 let guard=0;while(h.queue.length){assert.ok(++guard<=260,'queue made no bounded progress');const body=h.queue.shift();
  if(until?.(body)){h.queue.unshift(body);return;}
  const result=await h.run(body);assert.equal(result.ok||result.ignored,true,JSON.stringify({body,result}));
 }
}
function catalog(h){return JSON.stringify(h.sqlite.prepare('SELECT * FROM auction_listings ORDER BY listing_id').all());}
function clean(h){for(const name of ['automatic_refresh_guards','sync_batch_guards','server_feed_guards'])assert.equal(h.count(name),0);
 assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);}
const matches=(statements,fragment)=>statements.some(item=>item.sql.includes(fragment));

test('poll, immutable prepare, all 128 buckets and finish survive duplicate delivery without duplicate catalogue writes',async t=>{
 const h=await harness(t);await begin(h);assert.ok(h.row().archive_bytes>0);await drain(h);
 assert.equal(h.row().status,'complete');assert.equal(h.row().bucket_index,128);
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+3);assert.equal(h.count('server_feed_receipts'),128);
 assert.equal(h.count('auction_listings'),2);assert.equal(h.sqlite.prepare("SELECT current_bid_usd FROM auction_listings WHERE lot='10000001'").get().current_bid_usd,500);
 const before=catalog(h),receipts=h.count('server_feed_receipts'),objects=h.bucket.objects.size;
 for(const body of h.calls.sends.slice())assert.equal((await h.run(body)).ignored,true);
 assert.equal(catalog(h),before);assert.equal(h.count('server_feed_receipts'),receipts);assert.equal(h.bucket.objects.size,objects);
 const poll=await h.run({version:1,kind:'poll'});assert.equal(poll.downloaded,false);assert.equal(h.bucket.objects.size,objects);
 assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM server_feed_outbox WHERE status<>'complete'").get().n,0);clean(h);
});

test('lost acknowledgement after catalogue commit replays receipts and advances the checkpoint exactly once',async t=>{
 const h=await harness(t);await preparedState(h);let fired=false;
 h.calls.afterCommit=statements=>{if(!fired&&matches(statements,'scan_pages=automatic_refresh_tasks.scan_pages+1')){fired=true;throw Error('SIMULATED_LOST_REPLY');}};
 let body,result;while(h.queue.length&&!fired){body=h.queue.shift();result=await h.run(body);if(!fired)assert.equal(result.ok,true);}
 assert.equal(fired,true);assert.equal(result.retry,true);const before=catalog(h),prior=h.row().bucket_index;
 const reservations=h.sqlite.prepare("SELECT COUNT(*) n FROM server_feed_reservations WHERE status='reserved'").get().n;assert.equal(reservations,1);
 h.calls.afterCommit=null;assert.equal((await h.run(body)).ok,true);assert.ok(h.row().bucket_index>prior);assert.equal(catalog(h),before);
 await drain(h);assert.equal(h.row().status,'complete');assert.equal(h.count('server_feed_receipts'),128);clean(h);
});

test('lost checkpoint acknowledgement replays the outbox without applying its bucket again',async t=>{
 const h=await harness(t);await preparedState(h);const body=h.queue.shift();let fired=false;
 h.calls.afterCommit=statements=>{if(!fired&&matches(statements,'INSERT INTO server_feed_receipts')){fired=true;throw Error('SIMULATED_LOST_REPLY');}};
 const result=await h.run(body);assert.equal(result.retry,true);assert.equal(h.row().bucket_index,1);assert.equal(h.count('server_feed_receipts'),1);
 h.calls.afterCommit=null;assert.equal((await h.run(body)).alreadyApplied,true);assert.equal(h.count('server_feed_receipts'),1);
 await drain(h);assert.equal(h.row().status,'complete');clean(h);
});

test('lost finish acknowledgement closes the old outbox entry on redelivery',async t=>{
 const h=await harness(t);await preparedState(h);await drain(h,body=>body.jobKey.includes(':finish:'));const body=h.queue.shift();assert.ok(body);
 let fired=false;h.calls.afterCommit=statements=>{if(!fired&&matches(statements,"SET status='complete',updated_at=? WHERE generation_id=?")){fired=true;throw Error('SIMULATED_LOST_REPLY');}};
 assert.equal((await h.run(body)).retry,true);assert.equal(h.row().status,'complete');assert.notEqual(h.outbox(body.jobKey).status,'complete');
 h.calls.afterCommit=null;await h.run(body);assert.equal(h.outbox(body.jobKey).status,'complete');assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+3);clean(h);
});

test('shared lease excludes a concurrent D1 consumer before reserving budget',async t=>{
 const h=await harness(t);assert.equal(await h.store.acquire(),true);const result=await runMessage({env:h.env,body:{version:1,kind:'poll'},now:()=>h.calls.clock,fetchImpl:async()=>{throw Error('NETWORK_FORBIDDEN');}});
 assert.deepEqual(result,{retry:true,reason:'lease_busy'});assert.equal(h.calls.fetches,0);assert.equal(h.count('server_feed_reservations'),0);
 assert.equal((await h.store.state()).lease_owner,'integration-seed');clean(h);
});

test('lease loss between read and commit rolls back the write and leaves the durable job retryable',async t=>{
 const h=await harness(t);await preparedState(h);let fired=false;
 h.calls.beforeBatch=statements=>{if(!fired&&matches(statements,'INSERT INTO server_feed_receipts')){
  fired=true;h.sqlite.prepare('UPDATE automatic_refresh_state SET lease_owner=?,lease_until=?').run('another-owner','2026-10-29T12:10:00.000Z');
 }};const body=h.queue.shift(),result=await h.run(body);assert.equal(result.retry,true);assert.equal(h.count('server_feed_receipts'),0);
 assert.equal(h.row().bucket_index,0);assert.equal((await h.store.state()).lease_owner,'another-owner');
 h.calls.beforeBatch=null;h.release();assert.equal((await h.run(body)).ok,true);await drain(h);assert.equal(h.row().status,'complete');clean(h);
});

test('queue accepted send followed by lost dispatch commit resends the same immutable job',async t=>{
 const h=await harness(t);let fired=false;h.calls.afterCommit=statements=>{if(!fired&&matches(statements,"SET status='dispatched'")){fired=true;throw Error('SIMULATED_LOST_REPLY');}};
 const result=await h.run({version:1,kind:'poll'});assert.equal(result.retry,true);assert.equal(h.queue.length,1);
 const first=h.queue.shift();h.calls.afterCommit=null;h.calls.clock+=300001;assert.equal((await h.run({version:1,kind:'poll'})).ok,true);
 assert.deepEqual(h.queue.shift(),first);assert.equal(h.outbox(first.jobKey).status,'dispatched');assert.equal(h.count('server_feed_generations'),1);clean(h);
});

test('daily D1 budget stops import while independent scheduled capture preserves the pending raw file',async t=>{
 const h=await harness(t);h.sqlite.prepare('INSERT INTO server_feed_daily_budgets(day_key,write_limit,read_limit,consumed_writes,updated_at) VALUES(?,?,?,?,?)')
  .run(AT.slice(0,10),1000000,50000000,999999,AT);
 const result=await h.run({version:1,kind:'poll'});assert.equal(result.errorCode,'SERVER_FEED_DAILY_BUDGET_STOP');
 assert.equal(h.calls.fetches,1);assert.ok(h.bucket.objects.size>0);assert.equal(h.count('server_feed_reservations'),0);
 assert.equal(h.count('server_feed_generations'),0);const pending=await captureJournal.readPendingCapture(h.bucket);assert.equal(pending.ready,true);
 assert.ok(h.bucket.objects.has(pending.capture.rawKey));clean(h);
});

test('rolling mode publishes a complete captured file after the ordinary daily limit, then stops at the rolling cap',async t=>{
 const h=await harness(t);
 const put=h.sqlite.prepare('INSERT INTO server_feed_daily_budgets(day_key,write_limit,read_limit,consumed_writes,updated_at) VALUES(?,1000000,50000000,?,?)');
 put.run(AT.slice(0,10),995311,AT);
 const poll={version:1,kind:'poll'};
 assert.equal((await h.run(poll)).errorCode,'SERVER_FEED_DAILY_BUDGET_STOP');
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE);
 h.env.REXBID_FEED_D1_BUDGET_MODE='rolling-31d-v1';
 assert.equal((await h.run(poll)).d1BudgetMode,'rolling-31d-v1');
 await drain(h);
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+h.events.length);
 assert.equal(h.row().status,'complete');
 const consumed=h.sqlite.prepare('SELECT SUM(consumed_writes+reserved_writes) n FROM server_feed_daily_budgets').get().n;
 put.run('2026-10-28',36000000-consumed,AT);
 h.calls.generationId=GENERATION+1;
 assert.equal((await h.run(poll)).errorCode,'SERVER_FEED_ROLLING_BUDGET_STOP');
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+h.events.length);
 assert.ok((await captureJournal.readPendingCapture(h.bucket)).ready);
 clean(h);
});
test('replacement drain finishes an active generation and holds the next while capture stays independent',async t=>{
 const h=await harness(t);await preparedState(h);
 assert.equal((await h.run(h.queue.shift())).ok,true);
 assert.equal((await h.state.getState()).active_generation,GENERATION);
 h.env.REXBID_FEED_REBASE_DRAIN='enabled';
 h.env.REXBID_FEED_REBASE_DRAIN_UNTIL=new Date(h.calls.clock+20*60000).toISOString();
 await drain(h);
 assert.equal(h.row().status,'complete');assert.equal((await h.state.getState()).active_generation,null);
 const through=(await h.state.getState()).committed_sequence;
 h.calls.generationId=GENERATION+1;
 const result=await h.run({version:1,kind:'poll'});
 assert.deepEqual(result,{ok:true,rebaseDrained:true});
 assert.ok((await captureJournal.readPendingCapture(h.bucket)).ready);
 assert.equal(h.sqlite.prepare('SELECT status FROM server_feed_generations WHERE generation_id=?').get(GENERATION+1),undefined);
 assert.equal((await h.state.getState()).committed_sequence,through);
 h.calls.clock+=21*60000;
 assert.equal((await h.run({version:1,kind:'poll'})).rebaseDrained,undefined);
 clean(h);
});

test('conflicting full records quarantine the whole LOT, including later partial price events',async t=>{
 const one=fullRecord(),two=fullRecord();two.pricing.current_bid_usd=999;
 const h=await harness(t,[created(1,'10000001',one),created(2,'10000001',two),event(3)]);
 await h.store.acquire();const raw=fullRecord('10000001','2026-10-28T10:00:00.000Z');
 const prepared=await prepareInventoryPage({db:h.db,provider:createApibaraProvider(),records:[raw],observedAt:raw.updated_at,processedAt:AT,freshnessPolicy:POLICY,observationTimeBasis:'source_updated_at'});
 assert.equal(prepared.prepared.length,1);await commitInventoryBatch({db:h.db,store:h.store,prepared:prepared.prepared});h.release();
 const before=catalog(h);await preparedState(h);await drain(h);
 assert.equal(catalog(h),before,'hydration quarantine must prohibit partial price writes');
 const task=h.sqlite.prepare("SELECT status FROM automatic_refresh_tasks WHERE task_key='reconcile:iaai:10000001'").get();assert.equal(task?.status,'identity_error');clean(h);
});

test('dispatch does not starve current work behind 100 older completed-generation outbox entries',async t=>{
 const h=await harness(t);await preparedState(h);h.queue.length=0;await h.store.acquire();
 h.sqlite.prepare("UPDATE server_feed_outbox SET next_due_at=? WHERE status<>'complete'").run(AT);
 for(let i=0;i<100;i++){
  h.sqlite.prepare("INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,observed_at,status,bucket_index,created_at,updated_at) VALUES(?,?,?,1,?,'complete',128,?,?)")
   .run(100+i,digest(String(i)),`raw/old/${i}.gz`,AT,AT,AT);
  h.sqlite.prepare("INSERT INTO server_feed_outbox(job_key,kind,payload_json,next_due_at,created_at,updated_at,status) VALUES(?,'feed',?,?,?,?,'dispatched')")
   .run(`feed:${100+i}:finish:128:0`,JSON.stringify({generationId:100+i,phase:'finish',bucketIndex:128,groupOffset:0}),'2026-10-28T00:00:00.000Z',AT,AT);
 }
 assert.equal(await dispatchDue(h.env,h.state),1);assert.equal(h.queue.length,1);assert.match(h.queue[0].jobKey,/^feed:6001:/);clean(h);
});

test('empty generation and identical gzip under a new generation do not advance market freshness',async t=>{
 const h=await harness(t,[]);const before=await h.state.getState();
 assert.equal((await h.run({version:1,kind:'poll'})).ok,true);
 let result=await h.run(h.queue.shift());let steps=0;
 while(result.preparing){assert.ok(++steps<10);result=await h.run(h.queue.shift());}
 assert.equal(result.empty,true);assert.equal(h.row().status,'complete');
 assert.deepEqual(await h.state.getState(),before);assert.equal(h.count('auction_listings'),0);
 h.calls.generationId=GENERATION+1;
 const duplicate=await h.run({version:1,kind:'poll'});assert.equal(duplicate.duplicateOf,GENERATION);
 assert.equal(h.count('server_feed_generations'),1);assert.deepEqual(await h.state.getState(),before);clean(h);
});
test('long archive preparation renews only its owned lease before the initial lease expires',async t=>{
 const h=await harness(t),original=h.bucket.put.bind(h.bucket);
 h.bucket.put=async(...args)=>{const result=await original(...args);h.calls.clock+=35000;return result;};
 await begin(h);assert.ok(h.calls.clock-NOW>10*60000);assert.equal(h.row().status,'prepared');clean(h);
});
test('approved cleanup runs from poll and retains all catalogue data after file retirement',async t=>{
 const h=await harness(t);await begin(h);await drain(h);const before=catalog(h);
 h.calls.clock+=8*86400000;
 for(let i=0;i<4&&!h.row().retired_at;i++)assert.equal((await h.run({version:1,kind:'poll'})).ok,true);
 assert.ok(h.row().retired_at);assert.equal(h.row().archive_bytes,0);assert.equal(catalog(h),before);clean(h);
});


test('detail eligibility follows only its exact enabled flag while feed prices, queued needs and checkpoints stay durable',async t=>{
 for(const flag of [undefined,'disabled','ENABLED','enabled']){
  const changes={changed_fields:['pricing.current_bid_usd','details.color'],after:{'pricing.current_bid_usd':500,'details.color':'Red'}};
  const h=await harness(t,[created(1),event(2,'10000001',changes),event(3,'10000002',changes)]);
  if(flag!==undefined)h.env.REXBID_FEED_DETAIL_ENABLED=flag;
  await preparedState(h);
  h.sqlite.prepare(`INSERT INTO server_feed_reconcile_eligibility(platform,lot,generation_id,last_sequence,recorded_at,observed_at,expected_vin,terminal,identity_error,group_sha256,updated_at)
   VALUES('iaai','10000001',?,?,?,?,?,0,0,?,?)`).run(GENERATION,SEED_SEQUENCE+1,'2026-10-29T11:00:00.000Z',AT,VIN,'a'.repeat(64),AT);
  const before=h.sqlite.prepare('SELECT * FROM server_feed_reconcile_eligibility').all();
  h.calls.prepared.length=0;
  await drain(h);
  assert.equal(h.row().status,'complete',String(flag));
  assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+3);
  assert.equal(h.sqlite.prepare("SELECT current_bid_usd FROM auction_listings WHERE lot='10000001'").get().current_bid_usd,500);
  assert.equal(h.count('auction_listings'),1,'unknown LOT remains a durable need instead of a fabricated listing');
  for(const lot of ['10000001','10000002']){
   const queued=h.sqlite.prepare('SELECT status FROM automatic_refresh_tasks WHERE task_key=?').get('reconcile:iaai:'+lot);
   assert.equal(queued?.status,'pending','unsupported and missing detail needs remain queued');
  }
  assert.equal(h.count('server_feed_receipts'),128);
  assert.ok(h.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key GLOB 'server-feed-batch:*' AND status='complete'").get().n>0,'import audits stay durable');
  const eligibilitySql=h.calls.prepared.filter(sql=>sql.includes('server_feed_reconcile_eligibility'));
  if(flag==='enabled'){
   assert.ok(eligibilitySql.some(sql=>sql.startsWith('SELECT e.platform,e.lot')),'enabled retains prior eligibility lookup');
   assert.ok(eligibilitySql.some(sql=>sql.startsWith('INSERT INTO server_feed_reconcile_eligibility')),'enabled retains eligibility writes');
   const rows=h.sqlite.prepare('SELECT * FROM server_feed_reconcile_eligibility ORDER BY lot').all();
   assert.equal(rows.length,2);
   assert.equal(rows[0].last_sequence,SEED_SEQUENCE+2);assert.equal(rows[1].last_sequence,SEED_SEQUENCE+3);
  }else{
   assert.equal(eligibilitySql.length,0,'disabled or missing flag issues no eligibility reads or writes');
   assert.deepEqual(h.sqlite.prepare('SELECT * FROM server_feed_reconcile_eligibility').all(),before,'existing eligibility is preserved unchanged');
  }
  clean(h);
 }
});

test('native queue import preserves stale pending material eligibility for pure noise while unknown work and true bid clears keep eligibility',async t=>{
 const empty={changed_fields:['pricing.current_bid_usd','pricing.buy_now_usd'],
  before:{'pricing.current_bid_usd':null,'pricing.buy_now_usd':null},after:{'pricing.current_bid_usd':0,'pricing.buy_now_usd':null}},
  reset={before:{'pricing.current_bid_usd':1300},after:{'pricing.current_bid_usd':null}},
  buyEmpty={event:'buy_now.changed',changed_fields:['pricing.buy_now_usd'],before:{'pricing.buy_now_usd':null},after:{'pricing.buy_now_usd':null}},
  primaryEmpty={before:{'pricing.current_bid_usd':null},after:{'pricing.current_bid_usd':0}},
  buyClear={event:'buy_now.changed',changed_fields:['pricing.buy_now_usd'],before:{'pricing.buy_now_usd':2500},after:{'pricing.buy_now_usd':null}};
 const h=await harness(t,[event(1,'10000001',empty),event(2,'10000002',empty),event(3,'10000003',reset),
  event(4,'10000004',buyEmpty),event(5,'10000005',primaryEmpty),event(6,'10000006',buyEmpty),event(7,'10000007',buyClear)]);
 h.env.REXBID_FEED_DETAIL_ENABLED='enabled';
 await h.store.acquire();
 const knownLots=['10000001','10000003','10000004','10000005','10000007'],noiseLots=['10000001','10000004','10000005'];
 const records=knownLots.map(lot=>{const record=fullRecord(lot,'2026-10-28T10:00:00.000Z');record.pricing.current_bid_usd=1300;record.pricing.buy_now_usd=lot==='10000007'?2500:null;return record;});
 const prepared=await prepareInventoryPage({db:h.db,provider:createApibaraProvider(),records,observedAt:records[0].updated_at,
  processedAt:AT,freshnessPolicy:POLICY,observationTimeBasis:'source_updated_at'});
 assert.equal(prepared.prepared.length,5);await commitInventoryBatch({db:h.db,store:h.store,prepared:prepared.prepared});h.release();
 await preparedState(h);
 const old='2026-10-29T09:00:00.000Z';
 h.sqlite.prepare(`INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,observed_at,status,
  first_sequence,last_sequence,bucket_index,created_at,updated_at) VALUES(5999,?,'raw/old/5999.gz',1,?,'complete',?,?,128,?,?)`)
  .run(digest('prior-material-evidence'),old,SEED_SEQUENCE-1,SEED_SEQUENCE,old,old);
 for(const lot of knownLots)h.sqlite.prepare(`INSERT INTO server_feed_reconcile_eligibility(platform,lot,generation_id,
  last_sequence,recorded_at,observed_at,expected_vin,terminal,identity_error,group_sha256,updated_at)
  VALUES('iaai',?,5999,?,?,?,?,0,0,?,?)`).run(lot,SEED_SEQUENCE,old,old,VIN,digest('old-'+lot),old);
 for(const lot of noiseLots){const listing=h.sqlite.prepare('SELECT listing_id FROM auction_listings WHERE lot=?').get(lot);
  h.sqlite.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor,next_due_at,status)
   VALUES(?,'iaai',?,?,?,'pending')`).run('reconcile:iaai:'+lot,listing.listing_id,lot,old);}
 const before=noiseLots.map(lot=>({lot,e:h.sqlite.prepare('SELECT * FROM server_feed_reconcile_eligibility WHERE lot=?').get(lot),
  task:h.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get('reconcile:iaai:'+lot)}));
 await drain(h);
 assert.equal(h.row().status,'complete');assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+7);
 assert.equal(h.count('server_feed_receipts'),128);
 for(const prior of before){assert.deepEqual(h.sqlite.prepare('SELECT * FROM server_feed_reconcile_eligibility WHERE lot=?').get(prior.lot),prior.e,
   'all3 technical empty variants must not renew generation, sequence, hash or90minute material freshness');
  assert.ok(Date.parse(prior.e.recorded_at)<h.calls.clock-90*60000);assert.ok(Date.parse(prior.e.observed_at)<h.calls.clock-90*60000);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get('reconcile:iaai:'+prior.lot),prior.task);
  const canonical=h.sqlite.prepare('SELECT current_bid_usd,buy_now_usd FROM auction_listings WHERE lot=?').get(prior.lot);
  assert.equal(canonical.current_bid_usd,1300);assert.equal(canonical.buy_now_usd,null);}
 for(const [lot,offset]of [['10000002',2],['10000006',6]]){const unknown=h.sqlite.prepare('SELECT * FROM server_feed_reconcile_eligibility WHERE lot=?').get(lot);
  assert.equal(unknown.generation_id,GENERATION);assert.equal(unknown.last_sequence,SEED_SEQUENCE+offset);
  assert.equal(h.sqlite.prepare('SELECT status FROM automatic_refresh_tasks WHERE task_key=?').get('reconcile:iaai:'+lot).status,'pending');
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE lot=?').get(lot).n,0);}
 const clear=h.sqlite.prepare("SELECT * FROM server_feed_reconcile_eligibility WHERE lot='10000003'").get();
 assert.equal(clear.generation_id,GENERATION);assert.equal(clear.last_sequence,SEED_SEQUENCE+3);assert.equal(clear.recorded_at,'2026-10-29T11:00:00.000Z');
 assert.equal(h.sqlite.prepare("SELECT current_bid_usd FROM auction_listings WHERE lot='10000003'").get().current_bid_usd,null);
 const clearBuy=h.sqlite.prepare("SELECT * FROM server_feed_reconcile_eligibility WHERE lot='10000007'").get();
 assert.equal(clearBuy.generation_id,GENERATION);assert.equal(clearBuy.last_sequence,SEED_SEQUENCE+7);
 assert.equal(h.sqlite.prepare("SELECT buy_now_usd FROM auction_listings WHERE lot='10000007'").get().buy_now_usd,null);
 const audits=h.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key GLOB 'server-feed-batch:*' AND status='complete'").all().map(row=>JSON.parse(row.cursor));
 assert.equal(audits.reduce((n,a)=>n+a.events,0),7,'every original event is retained in durable import audit');
 assert.ok(audits.some(a=>a.decisions.some(d=>d.lot==='10000002'&&d.queued)),'unknown initialization still queues core reconciliation');clean(h);
});

test('lost D1 registration acknowledgement retains pending capture until verified replay; original descriptor and raw survive',async t=>{
 const h=await harness(t);let crashed=false;
 h.calls.afterCommit=statements=>{if(!crashed&&matches(statements,'INSERT INTO server_feed_generations')){crashed=true;throw Error('LOST_REGISTRATION_ACK');}};
 const first=await h.run({version:1,kind:'poll'});assert.equal(first.retry,true);
 const pending=await captureJournal.readPendingCapture(h.bucket);assert.equal(pending.ready,true);assert.equal(h.count('server_feed_generations'),1);
 h.calls.afterCommit=null;const retried=await h.run({version:1,kind:'poll'});assert.equal(retried.ok,true);
 assert.equal(await captureJournal.readPendingCapture(h.bucket),null);assert.equal(h.count('server_feed_generations'),1);
 assert.ok(h.bucket.objects.has(pending.capture.rawKey));assert.ok(h.bucket.objects.has(captureJournal.completedKey(GENERATION)));clean(h);
});

test('unfinished older intent does not strand newer ready generation registration or advance the file cursor',async t=>{
 const h=await harness(t,[created(10)]);const put=h.bucket.put.bind(h.bucket);let failed=false;
 h.bucket.put=async(key,...args)=>{if(!failed&&key.startsWith('raw/')){failed=true;throw Error('CAPTURE_WRITE_FAILED');}return put(key,...args);};
 await assert.rejects(h.capture());h.bucket.put=put;h.calls.generationId=GENERATION+1;
 const result=await h.run({version:1,kind:'poll'});assert.equal(result.downloaded,true);assert.equal(result.generationId,GENERATION+1);
 assert.equal(h.count('server_feed_generations'),1);assert.ok(h.bucket.objects.has(captureJournal.intentKey(GENERATION)));
 assert.equal(h.bucket.objects.has(captureJournal.pendingKey(GENERATION)),false);
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE,'registration cannot bypass missing sequence prefix');
 assert.equal(h.sqlite.prepare('SELECT status FROM server_feed_generations WHERE generation_id=?').get(GENERATION+1).status,'downloaded');clean(h);
});
test('completed-only retention never deletes an unregistered captured raw file even after eight days',async t=>{
 const h=await harness(t);await h.capture();const pending=await captureJournal.readPendingCapture(h.bucket);
 assert.equal(h.count('server_feed_generations'),0);h.calls.clock+=8*86400000;await h.store.acquire();
 const {cleanupCompletedArchives}=require('../sync/feed-archive-retention.cjs');
 const cleaned=await cleanupCompletedArchives({db:h.db,store:h.store,bucket:h.bucket,now:()=>h.calls.clock});
 assert.equal(cleaned.selected,0);assert.ok(h.bucket.objects.has(pending.capture.rawKey));
 assert.ok(h.bucket.objects.has(captureJournal.pendingKey(GENERATION)));assert.ok(h.bucket.objects.has(captureJournal.completedKey(GENERATION)));clean(h);
});

test('private executor exposes day-scoped effective100M while base row/counters and write cap remain unchanged',async t=>{
 const h=await harness(t);h.calls.clock=Date.parse('2026-10-31T12:00:00.000Z');
 h.sqlite.function('date',value=>value==='now'?new Date(h.calls.clock).toISOString().slice(0,10):new Date(value).toISOString().slice(0,10));
 Object.assign(h.env,{REXBID_FEED_READ_ALLOWANCE_DAY:'2026-10-31',REXBID_FEED_READ_ALLOWANCE_LIMIT:'100000000'});
 h.sqlite.prepare('INSERT INTO server_feed_daily_budgets(day_key,write_limit,read_limit,consumed_writes,consumed_reads,updated_at) VALUES(?,?,?,?,?,?)')
  .run('2026-10-31',1000000,50000000,26927,50086825,'2026-10-31T11:00:00.000Z');
 const result=await h.run({version:1,kind:'poll'});assert.equal(result.ok,true);
 assert.deepEqual(result.readPolicy,{day:'2026-10-31',baseReadLimit:50000000,effectiveReadLimit:100000000,allowanceActive:true});
 const row=h.sqlite.prepare("SELECT * FROM server_feed_daily_budgets WHERE day_key='2026-10-31'").get();
 assert.equal(row.read_limit,50000000);assert.equal(row.write_limit,1000000);assert.ok(row.consumed_reads>=50086825);assert.ok(row.consumed_writes>=26927);
 assert.equal(h.sqlite.prepare("SELECT status FROM automatic_refresh_tasks WHERE task_key='server-feed-read-allowance:2026-10-31'").get().status,'complete');clean(h);
});

test('invalid private allowance settings cannot block independent capture and never create an allowance audit',async t=>{
 const h=await harness(t);Object.assign(h.env,{REXBID_FEED_READ_ALLOWANCE_DAY:'bad-day',REXBID_FEED_READ_ALLOWANCE_LIMIT:'100000000'});
 const result=await h.run({version:1,kind:'poll'});assert.equal(result.ok,false);assert.equal(result.errorCode,'SERVER_FEED_READ_ALLOWANCE_CONFIG_INVALID');
 assert.equal(result.readPolicy.effectiveReadLimit,50000000);assert.equal(result.readPolicy.allowanceActive,false);
 const pending=await captureJournal.readPendingCapture(h.bucket);assert.equal(pending.ready,true);
 assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key GLOB 'server-feed-read-allowance:*'").get().n,0);
 assert.equal(h.count('server_feed_generations'),0);clean(h);
});

function stubGapApi(h,events,nextOffset){
 h.env.APIBARA_API_KEY='offline-gap-fixture';
 h.sqlite.prepare("UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=100000,quota_used=10000,quota_left=90000,quota_allowance=80000,quota_plan='pro'").run(AT);
 let requests=0;
 h.fetchImpl=async(url,options)=>{
  requests++;const parsed=new URL(url);
  assert.equal(parsed.pathname,'/api/v1/vehicle-auction/changes');assert.equal(parsed.searchParams.get('after'),String(SEED_SEQUENCE));
  assert.equal(parsed.searchParams.get('limit'),'500');assert.equal(parsed.searchParams.get('include_record'),'created');
  assert.equal(options.headers['X-API-Key'],'offline-gap-fixture');
  return Response.json({ok:true,data:events,meta:{after:SEED_SEQUENCE,next_cursor:SEED_SEQUENCE+nextOffset,has_more:true,count:events.length,
   ordering:'sequence_asc',schema_version:'offline-gap-runner',retention_days:14,oldest_available_sequence:1,latest_available_sequence:SEED_SEQUENCE+1000}});
 };
 return()=>requests;
}
async function runGapContinuations(h,requestCount,{phase,throughOffset,expectedHydrationMarkers}){
 const firstBody=h.queue.shift(),sqlBefore=h.calls.sql;
 const first=await h.run(firstBody);assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.gapRepaired,false);
 assert.equal(first.gapPhase,phase);assert.equal(first.through,SEED_SEQUENCE);assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE);
 assert.equal(h.row().status,'prepared');assert.equal(h.calls.sendOptions.at(-1).delaySeconds,1);
 assert.ok(first.databaseUsage.statements<970);assert.ok(h.calls.sql-sqlBefore<970);
 const pointerKey='server-feed-gap:'+SEED_SEQUENCE;
 assert.equal(h.sqlite.prepare('SELECT status FROM automatic_refresh_tasks WHERE task_key=?').get(pointerKey).status,'pending');
 assert.equal(requestCount(),1);
 const snapshots=h.count('auction_listing_snapshots'),resume=h.queue.shift(),nextSql=h.calls.sql;
 const completed=await h.run(resume);assert.equal(completed.ok,true,JSON.stringify(completed));assert.equal(completed.gapRepaired,true);
 assert.equal(completed.gapPhase,'complete');assert.equal(completed.through,SEED_SEQUENCE+throughOffset);
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+throughOffset);
 assert.equal(h.calls.sendOptions.at(-1).delaySeconds,10);assert.ok(completed.databaseUsage.statements<970);assert.ok(h.calls.sql-nextSql<970);
 assert.equal(requestCount(),1,'archive replay makes no second provider request');
 const pointer=h.sqlite.prepare('SELECT status,cursor FROM automatic_refresh_tasks WHERE task_key=?').get(pointerKey);
 assert.equal(pointer.status,'complete');const proof=JSON.parse(pointer.cursor).proof;
 assert.equal(proof.batchReceipts.filter(row=>row.taskKey.startsWith('file-hydration:')).length,expectedHydrationMarkers);
 for(const receipt of proof.batchReceipts){
  const saved=h.sqlite.prepare('SELECT platform,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').get(receipt.taskKey);
  assert.equal(saved.platform,'all');assert.equal(saved.status,'complete');assert.equal(digest(saved.cursor),receipt.cursorSha256);
 }
 clean(h);return{first,completed,snapshots};
}

test('runMessage hydrates archived gap continuation at1s, commits all proofs then uses10s, with one API page',async t=>{
 const h=await harness(t,[created(83,'20000001')]);await preparedState(h);
 const events=Array.from({length:81},(_,index)=>created(index+1,String(10000000+index)));
 const requests=stubGapApi(h,events,82);
 const result=await runGapContinuations(h,requests,{phase:'hydrate',throughOffset:82,expectedHydrationMarkers:5});
 assert.equal(result.snapshots,80);assert.equal(h.count('auction_listing_snapshots'),81);assert.equal(h.count('auction_listings'),81);
 assert.equal(h.sqlite.prepare('SELECT active_generation FROM server_feed_state').get().active_generation,null);
 t.diagnostic('hydration continuation SQL: '+result.first.databaseUsage.statements+' then '+result.completed.databaseUsage.statements+'; one changes fetch; delays1s/10s');
});

test('runMessage partial apply continuation keeps file cursor fenced and replays receipts without refetch before10s page completion',async t=>{
 const h=await harness(t,[created(502,'20000001')]);await h.store.acquire();
 const known=Array.from({length:440},(_,index)=>fullRecord(String(10000060+index),'2026-10-28T10:00:00.000Z'));
 for(let offset=0;offset<known.length;offset+=20){
  const prepared=await prepareInventoryPage({db:h.db,provider:createApibaraProvider(),records:known.slice(offset,offset+20),observedAt:'2026-10-28T10:00:00.000Z',processedAt:AT,freshnessPolicy:POLICY});
  assert.equal(prepared.prepared.length,Math.min(20,known.length-offset));await commitInventoryBatch({db:h.db,store:h.store,prepared:prepared.prepared});
 }
 h.release();await preparedState(h);
 const events=Array.from({length:500},(_,index)=>{
  const lot=String(10000000+index),extra={changed_fields:['pricing.current_bid_usd','details.color'],after:{'pricing.current_bid_usd':1500+index,'details.color':'Red'}};
  if(index>=60)return event(index+1,lot,extra);
  const raw=fullRecord(lot,'2026-10-28T10:00:00.000Z');return{...created(index+1,lot,raw),...extra};
 });
 const requests=stubGapApi(h,events,501);
 const result=await runGapContinuations(h,requests,{phase:'apply',throughOffset:501,expectedHydrationMarkers:3});
 assert.equal(h.count('auction_listings'),500);assert.equal(h.count('auction_listing_snapshots'),500);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE current_bid_usd BETWEEN 1500 AND 1999').get().n,500);
 assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key GLOB 'reconcile:*' AND status='pending'").get().n,500);
 t.diagnostic('partial continuation SQL: '+result.first.databaseUsage.statements+' then '+result.completed.databaseUsage.statements+'; one changes fetch; delays1s/10s');
});


test('only a validated active recovery allowance uses2s between pages, with counters and cursor committed',async t=>{
 const h=await harness(t,[created(3,'20000001')]);await preparedState(h);
 const requests=stubGapApi(h,[event(1)],2);
 Object.assign(h.env,{REXBID_FEED_API_RECOVERY_ID:'2026-10-31-gap',REXBID_FEED_API_RECOVERY_LIMIT:'12000',REXBID_FEED_API_RECOVERY_THROUGH:'51292006'});
 const result=await h.run(h.queue.shift());assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.gapPhase,'complete');assert.equal(result.through,SEED_SEQUENCE+2);
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+2);
 assert.equal(h.calls.sendOptions.at(-1).delaySeconds,2);assert.equal(requests(),1);
 assert.equal(h.sqlite.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='feed-api-recovery:2026-10-31-gap'").get().consumed,1);
 assert.ok(result.databaseUsage.statements<970);clean(h);
});


test('older unknown archive is prepared before deferred apply and does not retain a five-minute timeout',async t=>{
 const h=await harness(t,[created(2)]);await preparedState(h);const original=h.queue.shift();
 const bytes=gzipSync(JSON.stringify(created(1,'20000002'))+'\n'),rawKey='raw/integration/older-priority.jsonl.gz';
 h.bucket.objects.set(rawKey,bytes);await h.store.acquire();
 const older=GENERATION-1;await h.state.register({generationId:older,sha256:digest(bytes),rawKey,compressedBytes:bytes.length,observedAt:AT,
  outbox:[workSpec(older,'prepare')]});
 h.sqlite.prepare('UPDATE server_feed_generations SET created_at=? WHERE generation_id=?').run(new Date(NOW-1000).toISOString(),older);h.release();
 const deferred=await h.run(original);assert.equal(deferred.ok,true);assert.equal(deferred.deferred,true);
 assert.equal(h.outbox(original.jobKey).next_due_at,new Date(h.calls.clock+1000).toISOString());
 const preparation=h.queue.shift();assert.equal(preparation.jobKey,workSpec(older,'prepare').jobKey);
 h.calls.clock+=2000;let prepared=await h.run(preparation);assert.equal(prepared.ok,true,JSON.stringify(prepared));let steps=0;
 while(prepared.preparing){assert.ok(++steps<20);const continuation=h.queue.shift();assert.equal(continuation.jobKey,preparation.jobKey);prepared=await h.run(continuation);assert.equal(prepared.ok,true,JSON.stringify(prepared));}
 assert.equal(prepared.prepared,true);assert.ok(h.queue.some(body=>body.jobKey===workSpec(older,'apply').jobKey));
 assert.ok(Date.parse(h.outbox(original.jobKey).next_due_at)<=h.calls.clock,'deferred recovery is already due, not waiting five minutes');
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE);clean(h);
});


function enableD1RecoveryFixture(h){
 h.calls.clock=Date.parse('2026-10-31T21:00:00.000Z');
 h.sqlite.function('date',value=>value==='now'?new Date(h.calls.clock).toISOString().slice(0,10):new Date(value).toISOString().slice(0,10));
 const frozen={...h.row(),generation_id:6698,sha256:digest('frozen-generation-fixture'),raw_key:'raw/fixture/frozen',first_sequence:51500000,last_sequence:51573763};
 const fields=Object.keys(frozen);h.sqlite.prepare('INSERT INTO server_feed_generations('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...Object.values(frozen));
 h.sqlite.prepare('INSERT INTO server_feed_daily_budgets(day_key,write_limit,read_limit,consumed_writes,consumed_reads,updated_at) VALUES(?,?,?,?,?,?)')
  .run('2026-10-31',1000000,50000000,999500,0,new Date(h.calls.clock).toISOString());
 Object.assign(h.env,{REXBID_FEED_D1_RECOVERY_ID:'2026-10-31-gap',REXBID_FEED_D1_RECOVERY_WRITE_LIMIT:'12000000',REXBID_FEED_D1_RECOVERY_READ_LIMIT:'200000000',REXBID_FEED_D1_RECOVERY_THROUGH:'51573763'});
}
test('reviewed D1 opt-in credits eligible apply and preserves the pre-existing ordinary budget',async t=>{
 const h=await harness(t);await preparedState(h);enableD1RecoveryFixture(h);
 const result=await h.run(h.queue.shift());assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.d1Recovery.enabled,true);assert.ok(result.d1Recovery.chargedWrites>0);assert.ok(result.d1Recovery.chargedWrites<=12000000);
 const day=h.sqlite.prepare("SELECT * FROM server_feed_daily_budgets WHERE day_key='2026-10-31'").get();
 assert.equal(day.write_limit,1000000);assert.equal(day.read_limit,50000000);assert.ok(day.consumed_writes>=999500);
 assert.equal(day.reserved_writes,0);assert.ok(day.consumed_writes-result.d1Recovery.dayCreditWrites>=999500);
 assert.ok(result.databaseUsage.statements<970);clean(h);
});
test('retried prepare cannot claim D1 recovery credit even when its generation is already prepared',async t=>{
 const h=await harness(t);await preparedState(h);enableD1RecoveryFixture(h);
 const spec=workSpec(GENERATION,'prepare');await h.store.acquire();await h.state.enqueue(spec);h.release();
 const result=await h.run({version:1,jobKey:spec.jobKey});assert.equal(result.ok,false);assert.equal(result.errorCode,'SERVER_FEED_DAILY_BUDGET_STOP');
 assert.equal(result.d1Recovery.chargedWrites,0);assert.equal(result.d1Recovery.dayCreditWrites,0);
 assert.equal(h.sqlite.prepare("SELECT consumed_writes FROM server_feed_daily_budgets WHERE day_key='2026-10-31'").get().consumed_writes,999500);clean(h);
});
test('D1 recovery guard errors remain safe named stop codes',()=>{
 const {safeCode}=require('../sync/feed-server-runner.cjs');assert.equal(safeCode(Error('SERVER_FEED_D1_RECOVERY_BUDGET_STOP')),'SERVER_FEED_D1_RECOVERY_BUDGET_STOP');
 assert.equal(safeCode(Error('secret-value')),'SERVER_FEED_OPERATION_FAILED');
});


test('dispatch selects exact current checkpoint instead of stale earlier pending jobs',async t=>{
 const h=await harness(t);await preparedState(h);h.queue.length=0;await h.store.acquire();
 h.sqlite.prepare("UPDATE server_feed_generations SET status='applying',group_offset=1 WHERE generation_id=?").run(GENERATION);
 h.sqlite.prepare('UPDATE server_feed_state SET active_generation=?').run(GENERATION);
 const current=workSpec(GENERATION,'apply',0,1);await h.state.enqueue(current);
 h.sqlite.prepare("UPDATE server_feed_outbox SET status='pending',next_due_at=?").run(AT);
 assert.equal(await dispatchDue(h.env,h.state),1);assert.equal(h.queue.length,1);assert.equal(h.queue[0].jobKey,current.jobKey);
 assert.equal(h.outbox(workSpec(GENERATION,'apply').jobKey).status,'pending');clean(h);
});


test('recorded repeated supplier500 uses smaller request at identical cursor and commits only verified response',async t=>{
 const h=await harness(t,[created(3,'20000001')]);await preparedState(h);
 h.calls.clock+=10000;h.env.APIBARA_API_KEY='offline-gap-fixture';
 h.sqlite.prepare("UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=100000,quota_used=10000,quota_left=90000,quota_allowance=80000,quota_plan='pro'").run(new Date(h.calls.clock).toISOString());
 for(let n=1;n<=4;n++)h.sqlite.prepare("INSERT INTO automatic_refresh_attempts(attempt_id,operation,attempted_at,completed_at,outcome,http_status,error_code) VALUES(?,'vehicleChanges',?,?,'error',500,'UPSTREAM')")
  .run('prior-500-'+n,new Date(NOW+n*100).toISOString(),new Date(NOW+n*100+1).toISOString());
 let requests=0;h.fetchImpl=async url=>{requests++;const parsed=new URL(url);assert.equal(parsed.searchParams.get('after'),String(SEED_SEQUENCE));assert.equal(parsed.searchParams.get('limit'),'25');assert.equal(parsed.searchParams.get('include_record'),'created');
  return Response.json({ok:true,data:[event(1)],meta:{after:SEED_SEQUENCE,next_cursor:SEED_SEQUENCE+2,has_more:true,count:1,ordering:'sequence_asc',schema_version:'offline-gap-runner',retention_days:14,oldest_available_sequence:1,latest_available_sequence:SEED_SEQUENCE+1000}});};
 const result=await h.run(h.queue.shift());assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.gapPageLimit,25);assert.equal(requests,1);assert.equal(result.through,SEED_SEQUENCE+2);
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+2);assert.ok(result.databaseUsage.statements<970);clean(h);
});


test('only transient HTTP failures survive eight attempts; malformed HTTP4xx remains terminal with safe diagnostics',async t=>{
 for(const status of [400,404,422,500,502]){
  const h=await harness(t,[created(3)]);await preparedState(h);stubGapApi(h,[event(1)],2);const body=h.queue.shift();
  h.sqlite.prepare('UPDATE server_feed_outbox SET attempts=7 WHERE job_key=?').run(body.jobKey);
  h.fetchImpl=async()=>new Response('source unavailable',{status});const result=await h.run(body);
  assert.equal(result.ok,false);assert.equal(result.errorCode,'UPSTREAM');assert.equal(result.httpStatus,status);assert.equal(result.gapPageLimit,500);
  assert.equal(result.retryOutcome.blocked,status<500);assert.equal(h.row().status,status<500?'blocked':'prepared');
  assert.equal(h.outbox(body.jobKey).attempts,8);assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE);clean(h);
 }
});

async function bootstrapSelected(h,{operatorIdentity={id:'acb3cb8e-69a2-459f-8a46-0f2f5b9004be',name:'rexbid-auth-test-db'}}={}){
 h.sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0014_feed_catalog_membership.sql'),'utf8'));
 await preparedState(h);await h.store.acquire();
 const provider=createApibaraProvider(),prepared=await prepareInventoryPage({db:h.db,provider,records:[fullRecord()],observedAt:AT,
  processedAt:AT,freshnessPolicy:POLICY,observationTimeBasis:'source_updated_at'});
 await commitInventoryBatch({db:h.db,store:h.store,prepared:prepared.prepared});
 const row=h.sqlite.prepare("SELECT * FROM auction_listings WHERE platform='iaai' AND lot='10000001'").get();
 const membership=new FeedBootstrapMembership({db:h.db,store:h.store}),baselineId='fresh-runner';
 await membership.begin({version:1,baselineId,scope:'staging',sourceEvidence:{kind:'provider-checkpoint',sha256:'d'.repeat(64),replayStartSequence:SEED_SEQUENCE,snapshotSha256:'b'.repeat(64)},
  capture:{sequence:SEED_SEQUENCE,capturedAt:'2026-10-29T09:00:00.000Z',responseSha256:'a'.repeat(64)},
  snapshot:{generationId:7001,sha256:'b'.repeat(64),records:1,requestStartedAt:'2026-10-29T09:01:00.000Z',observedAt:'2026-10-29T10:00:00.000Z',generatedAtKnown:false,generatedAt:null}});
 await h.store.guarded((await membership.snapshotStatements({baselineId,offset:0,endOffset:1,batchSha256:'c'.repeat(64),resolved:[{
  listingId:row.listing_id,sourceKey:row.source_key,platform:'iaai',lot:row.lot,vin:row.vin_normalized}]})).statements);
 const target={sequence:SEED_SEQUENCE+3,observedAt:AT,responseSha256:'e'.repeat(64)};
 const replay=await replayBootstrapPage({db:h.db,store:h.store,bucket:h.bucket,baselineId,target,
  request:async()=>({observedAt:AT,response:{ok:true,data:h.events,meta:{after:SEED_SEQUENCE,next_cursor:target.sequence,
   has_more:false,count:h.events.length,ordering:'sequence_asc',schema_version:'test',retention_days:14,
   oldest_available_sequence:SEED_SEQUENCE,latest_available_sequence:target.sequence}}})});
 assert.equal(replay.complete,true);await membership.seal({baselineId,through:target.sequence,sourceProofSha256:'d'.repeat(64)});
 if(operatorIdentity)Object.assign(h.db,{metadataVerified:true,identity:{...operatorIdentity}});
 const activation=await activateBootstrap({db:h.db,store:h.store,bucket:h.bucket,baselineId,expectedBaselineId:null,
  expectedPointerRevision:0,expectedServerSequence:SEED_SEQUENCE,boundaryGenerationId:GENERATION});
 h.env.REXBID_CATALOG_MEMBERSHIP_ENABLED='enabled';h.release();return{baselineId,membership,activation};
}
async function nextWholeFile(h,generationId,events){
 const bytes=gzipSync(events.map(JSON.stringify).join('\n')+'\n'),rawKey=`raw/integration/${generationId}.jsonl.gz`,sha256=digest(bytes);
 h.bucket.objects.set(rawKey,bytes);const prepared=await prepareFeedArchive({bucket:h.bucket,rawKey,rawSha256:sha256,prefix:'prepared',observedAt:AT});
 await h.store.acquire();await h.state.register({generationId,sha256,rawKey,compressedBytes:bytes.length,observedAt:AT});
 const spec=workSpec(generationId,'apply');await h.state.prepare({generationId,manifestKey:prepared.manifestKey,
  manifestSha256:prepared.manifestSha256,archiveBytes:1,firstSequence:prepared.manifest.firstSequence,lastSequence:prepared.manifest.lastSequence,
  bucketGroups:prepared.manifest.buckets.map(x=>x.uniqueLots),outbox:[spec]});h.release();h.queue.push({version:1,jobKey:spec.jobKey});
 return spec;
}
test('sealed fresh baseline hands off to two complete future files; covered raw/generation and old pending gap remain intact',async t=>{
 const h=await harness(t),{baselineId,membership,activation}=await bootstrapSelected(h);
 h.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('server-feed-gap:1','all','{}',?,'pending')").run(AT);
 const boundaryBefore={...h.row()},oldGap=h.sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key='server-feed-gap:1'").get();
 const covered=await h.run(h.queue.shift());assert.equal(covered.ok,true,JSON.stringify(covered));assert.equal(covered.coveredByBaseline,baselineId);
 assert.deepEqual({...h.row()},boundaryBefore);assert.equal(h.outbox(workSpec(GENERATION,'apply').jobKey).status,'complete');
 await nextWholeFile(h,6002,[event(4,'10000001',{event:'lot.sold',terminal:true,changed_fields:[],after:{}}),event(5,'10000002')]);
 await drain(h);assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+5);
 assert.equal((await membership.read(baselineId)).state.replaySequence,SEED_SEQUENCE+5);
 const first=h.sqlite.prepare("SELECT m.active FROM feed_catalog_membership m JOIN auction_listings l ON l.listing_id=m.listing_id WHERE m.baseline_id=? AND l.lot='10000001'").get(baselineId);
 assert.equal(first.active,0);
 await nextWholeFile(h,6003,[created(6,'10000003'),event(7,'10000003')]);await drain(h);
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+7);assert.equal((await membership.read(baselineId)).state.replaySequence,SEED_SEQUENCE+7);
 assert.equal((await membership.read(baselineId)).state.status,'ready');assert.equal((await readBootstrapActivation({db:h.db,baselineId})).floorSequence,activation.floorSequence);
 assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM server_feed_generations WHERE generation_id IN(6002,6003) AND status='complete'").get().n,2);
 assert.deepEqual({...h.row()},boundaryBefore);assert.deepEqual(h.sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key='server-feed-gap:1'").get(),oldGap);
 assert.equal(h.calls.fetches,0);clean(h);
});
test('membership flag enabled with NULL pointer retains legacy mode; missing activation receipt fails before canonical mutation',async t=>{
 const h=await harness(t);h.sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0014_feed_catalog_membership.sql'),'utf8'));
 h.env.REXBID_CATALOG_MEMBERSHIP_ENABLED='enabled';await preparedState(h);await drain(h);assert.equal(h.row().status,'complete');clean(h);
 const other=await harness(t);await bootstrapSelected(other);other.sqlite.exec("DELETE FROM automatic_refresh_tasks WHERE task_key='bootstrap-activation:fresh-runner'");
 const before=catalog(other),result=await other.run(other.queue.shift());assert.equal(result.ok,false);assert.equal(result.errorCode,'SERVER_FEED_MEMBERSHIP_INVALID');
 assert.equal(catalog(other),before);assert.equal(other.row().status,'prepared');clean(other);
});
test('membership finish failure cannot advance either cursor; retry finishes without duplicate member accounting',async t=>{
 const h=await harness(t),{baselineId,membership}=await bootstrapSelected(h);await h.run(h.queue.shift());
 await nextWholeFile(h,6002,[event(4),event(5)]);await drain(h,body=>body.jobKey==='feed:6002:finish:128:0');const body=h.queue.shift();
 const before=(await membership.read(baselineId)).state;assert.equal(before.replaySequence,SEED_SEQUENCE+3);assert.ok(before.pendingDelta);
 h.calls.beforeBatch=ss=>{if(matches(ss,"UPDATE server_feed_generations SET status='complete'"))throw Error('INJECTED');};
 const failed=await h.run(body);assert.equal(failed.ok,false);assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+3);
 assert.equal((await membership.read(baselineId)).state.replaySequence,SEED_SEQUENCE+3);h.calls.beforeBatch=null;
 const retried=await h.run(body);assert.equal(retried.ok,true,JSON.stringify(retried));assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+5);
 assert.equal((await membership.read(baselineId)).state.replaySequence,SEED_SEQUENCE+5);assert.equal((await membership.read(baselineId)).state.deltaUnresolved,before.deltaUnresolved);clean(h);
});
test('only known covered ranges leave scheduling; unknown older archives still require preparation before future apply',async t=>{
 const h=await harness(t),{baselineId,membership,activation}=await bootstrapSelected(h);await h.run(h.queue.shift());
 await nextWholeFile(h,6002,[event(4),event(5)]);await h.store.acquire();
 const state=new ServerFeedState({db:h.db,store:h.store});state.configureMembership({membership,activation});
 const old=workSpec(4999,'prepare');await state.register({generationId:4999,sha256:'f'.repeat(64),rawKey:'raw/unknown-old.gz',compressedBytes:12,observedAt:AT,outbox:[old]});
 assert.equal((await state.getNextGeneration({readyOnly:true})).generation_id,4999);assert.equal((await state.getBlockingGeneration(6002)).generation_id,4999);
 await state.prepare({generationId:4999,manifestKey:'unknown/manifest.json',manifestSha256:'a'.repeat(64),archiveBytes:1,
  firstSequence:SEED_SEQUENCE-10,lastSequence:SEED_SEQUENCE-1,bucketGroups:[1,...Array(127).fill(0)],outbox:[workSpec(4999,'apply')]});
 assert.equal((await state.getNextGeneration({readyOnly:true})).generation_id,6002);assert.equal(await state.getBlockingGeneration(6002),null);
 assert.equal((await state.getGeneration(4999)).status,'prepared');assert.equal(h.row().status,'prepared');
 assert.equal((await membership.read(baselineId)).state.replaySequence,activation.floorSequence);h.release();clean(h);
});
test('covered completion is fenced against a raced range change and cannot falsely finish its outbox',async t=>{
 const h=await harness(t);await bootstrapSelected(h);const body=h.queue.shift();let fired=false;
 h.calls.beforeBatch=ss=>{if(!fired&&matches(ss,"UPDATE server_feed_outbox SET status='complete'")){fired=true;h.sqlite.prepare('UPDATE server_feed_generations SET last_sequence=? WHERE generation_id=?').run(SEED_SEQUENCE+999,GENERATION);}};
 const result=await h.run(body);assert.equal(result.ok,false);assert.equal(fired,true);
 assert.equal(h.outbox(body.jobKey).status,'pending');assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+3);clean(h);
});
test('opaque Worker binding reads real operator-target activation and continues a future file from trusted deployment configuration',async t=>{
 const h=await harness(t),operatorIdentity={id:'acb3cb8e-69a2-459f-8a46-0f2f5b9004be',name:'rexbid-auth-test-db'};
 const {activation,membership,baselineId}=await bootstrapSelected(h,{operatorIdentity});assert.deepEqual(activation.receipt.target,operatorIdentity);
 delete h.db.identity;delete h.db.metadataVerified;assert.equal(Object.hasOwn(h.env.REXBID_DB,'identity'),false);
 const body=h.queue.shift();body.bindingIdentity={id:'c8a30088-70af-43a6-9a7f-c4018279d37d',name:'rexbid-production-preflight-db'};
 const result=await h.run(body);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.coveredByBaseline,baselineId);
 await nextWholeFile(h,6002,[event(4),event(5)]);await drain(h);
 assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+5);assert.equal((await membership.read(baselineId)).state.replaySequence,SEED_SEQUENCE+5);
 const config=configuration(h.env),measured=measuredDatabase(h.env.REXBID_DB,config.bindingIdentity);
 assert.deepEqual(measured.db.bindingIdentity,operatorIdentity);assert.equal(measured.db.bindingIdentityVerified,true);
 assert.equal(measured.db.metadataVerified,undefined);assert.equal(measured.db.identity,undefined);
 assert.equal((await readBootstrapActivation({db:measured.db,baselineId})).floorSequence,activation.floorSequence);
 const operatorStore=new RefreshStore(measured.db,'must-verify-live-metadata',()=>h.calls.clock);
 await assert.rejects(activateBootstrap({db:measured.db,store:operatorStore,bucket:h.bucket,baselineId,expectedBaselineId:null,
  expectedPointerRevision:0,expectedServerSequence:SEED_SEQUENCE,boundaryGenerationId:GENERATION}),/TARGET_UNVERIFIED/);
 Object.assign(measured.db,{identity:operatorIdentity,metadataVerified:false});
 await assert.rejects(readBootstrapActivation({db:measured.db,baselineId}),/TARGET_UNVERIFIED/);clean(h);
});
test('wrong operator-target receipt or contradictory deployment configuration cannot be overridden by message metadata',async t=>{
 const h=await harness(t),operatorIdentity={id:'c8a30088-70af-43a6-9a7f-c4018279d37d',name:'rexbid-production-preflight-db'};
 // Create a real, strictly verified staging activation first. The negative
 // case is a subsequently corrupted/resealed receipt, not an invalid operator
 // activation that bypasses the target/scope checks being tested elsewhere.
 const {activation}=await bootstrapSelected(h);const {sha256,...wrongReceipt}=structuredClone(activation.receipt);
 wrongReceipt.target=operatorIdentity;
 h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?')
  .run(JSON.stringify({...wrongReceipt,sha256:digest(JSON.stringify(wrongReceipt))}),activation.receiptKey);
 delete h.db.identity;delete h.db.metadataVerified;
 const before=catalog(h),body=h.queue.shift();body.identity=operatorIdentity;body.metadataVerified=true;
 const result=await h.run(body);assert.equal(result.ok,false);assert.equal(result.errorCode,'FEED_BOOTSTRAP_ACTIVATION_TARGET_MISMATCH');
 assert.equal(catalog(h),before);assert.equal(h.row().status,'prepared');assert.equal(h.calls.fetches,0);
 const queries=h.calls.sql;h.env.REXBID_FEED_DATABASE_ID='wrong';await assert.rejects(h.run(body),/SERVER_FEED_CONFIG_INVALID/);
 assert.equal(h.calls.sql,queries);assert.throws(()=>measuredDatabase(h.db,{id:'wrong',name:'rexbid-auth-test-db'}),/SERVER_FEED_CONFIG_INVALID/);clean(h);
});


function bucketLots(index,count,start=20000000){const {createHash}=require('node:crypto'),lots=[];for(let n=start;lots.length<count;n++){const lot=String(n),bytes=createHash('sha256').update('iaai:'+lot).digest();if((bytes.readUInt32BE(0)&127)===index)lots.push(lot);}return lots;}
async function activatedContinuation(t,{index=0,count=1}={}){const h=await harness(t);await bootstrapSelected(h);await h.run(h.queue.shift());const lots=bucketLots(index,count),events=lots.map((lot,i)=>event(i+4,lot,{event:'lot.removed',terminal:true,changed_fields:[],after:{}}));const spec=await nextWholeFile(h,6002,events);return{h,spec,lots};}
test('activated invocation checkpoints at most two buckets; legacy keeps one and all128 original receipts finish',async t=>{
 const {h}=await activatedContinuation(t,{index:2});const body=h.queue.shift(),first=await h.run(body);assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.bucketsVisited,2);assert.equal(first.bucketIndex,2);assert.equal(h.count('server_feed_receipts'),2);
 await drain(h);assert.equal(h.sqlite.prepare('SELECT status FROM server_feed_generations WHERE generation_id=6002').get().status,'complete');assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_receipts WHERE generation_id=6002').get().n,128);assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+4);clean(h);
 const old=await harness(t,[created(1,bucketLots(2,1)[0])]);await preparedState(old);const legacy=await old.run(old.queue.shift());assert.equal(legacy.bucketsVisited,1);assert.equal(legacy.bucketIndex,1);clean(old);
});
test('failure reading second bucket retries actual persisted continuation, not completed original job',async t=>{
 const {h}=await activatedContinuation(t,{index:2});const row=h.sqlite.prepare('SELECT manifest_key FROM server_feed_generations WHERE generation_id=6002').get(),manifest=JSON.parse(h.bucket.objects.get(row.manifest_key).toString()),badKey=manifest.buckets[1].manifestKey,originalGet=h.bucket.get.bind(h.bucket);let injected=false;
 h.bucket.get=async(key,options)=>{if(key===badKey&&!injected){injected=true;throw Error('FEED_ARCHIVE_OBJECT_MISSING');}return originalGet(key,options);};
 const initial=h.queue.shift(),result=await h.run(initial);assert.equal(result.ok,false);assert.equal(result.databaseUsage.unknown,false);assert.equal(h.outbox(initial.jobKey).status,'complete');assert.equal(h.outbox(initial.jobKey).attempts,0);
 const current=workSpec(6002,'apply',1,0).jobKey;assert.equal(h.outbox(current).attempts,1);assert.equal(h.outbox(current).status,'pending');assert.equal(h.sqlite.prepare('SELECT bucket_index FROM server_feed_generations WHERE generation_id=6002').get().bucket_index,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_receipts WHERE generation_id=6002').get().n,1);
 h.calls.clock+=61000;assert.equal((await h.run({version:1,jobKey:current})).ok,true);await drain(h);clean(h);
});
test('lost second checkpoint ACK retains first bucket and unknown reservation, then exact replay finishes once',async t=>{
 const {h}=await activatedContinuation(t,{index:2});let lost=false;h.calls.afterCommit=statements=>{const update=statements.find(s=>s.sql.startsWith('UPDATE server_feed_generations SET bucket_index='));if(update&&update.params[0]===2&&!lost){lost=true;throw Error('SECOND_BUCKET_ACK_LOST');}};
 const body=h.queue.shift(),result=await h.run(body);assert.equal(result.ok,false);assert.equal(result.databaseUsage.unknown,true);assert.equal(h.sqlite.prepare('SELECT bucket_index FROM server_feed_generations WHERE generation_id=6002').get().bucket_index,2);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_receipts WHERE generation_id=6002').get().n,2);assert.equal(h.outbox(workSpec(6002,'apply',1,0).jobKey).status,'complete');assert.equal(h.outbox(workSpec(6002,'apply',2,0).jobKey).status,'pending');assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM server_feed_reservations WHERE status='reserved'").get().n,1);
 h.calls.afterCommit=null;assert.equal((await h.run({version:1,jobKey:workSpec(6002,'apply',2,0).jobKey})).ok,true);await drain(h);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_receipts WHERE generation_id=6002').get().n,128);clean(h);
});

test('activated cheap price prefix admits300 exact groups without dropping a group',async t=>{
 const h=await harness(t);h.env.REXBID_FEED_DETAIL_ENABLED='enabled';await bootstrapSelected(h);await h.run(h.queue.shift());const initialAuditKeys=new Set(h.sqlite.prepare("SELECT task_key FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").all().map(x=>x.task_key));const lots=bucketLots(0,401),events=lots.map((lot,i)=>event(i+4,lot));await nextWholeFile(h,6002,events);
 const body=h.queue.shift(),first=await h.run(body);assert.equal(first.ok,true,JSON.stringify(first));const audits=h.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").all().map(x=>JSON.parse(x.cursor)).filter(a=>a.checkpointExtension);
 assert.ok(audits.some(a=>a.end-a.offset===300),'actual core import must acknowledge a300-group prefix');assert.ok(audits.every(a=>a.end-a.offset<=300));await drain(h);
 const row=h.sqlite.prepare('SELECT * FROM server_feed_generations WHERE generation_id=6002').get();assert.equal(row.status,'complete');assert.equal(row.bucket_index,128);assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+404);
 const completeAudits=h.sqlite.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").all().filter(x=>!initialAuditKeys.has(x.task_key)).map(x=>JSON.parse(x.cursor)).filter(a=>a.checkpointExtension);assert.equal(completeAudits.reduce((n,a)=>n+a.events,0),401);assert.equal(h.sqlite.prepare("SELECT COUNT(DISTINCT json_extract(payload_json,'$.bucketIndex')) n FROM server_feed_receipts WHERE generation_id=6002").get().n,128);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_receipts WHERE generation_id=6002').get().n,129);clean(h);
});

async function compatibility100Chunk(h,generationId,activation,count=100){
 const {readFeedBucket}=require('../sync/feed-worker-archive.cjs'),{bucketDataset}=require('../sync/feed-server-runner.cjs'),{importChangeBatch,hashReceipt,changeKeys}=require('../sync/feed-change-import.cjs'),{createBootstrapDeltaExtension}=require('../sync/feed-bootstrap-delta.cjs');
 await h.store.acquire();h.state.configureMembership({membership:new FeedBootstrapMembership({db:h.db,store:h.store}),activation});let generation=await h.state.getGeneration(generationId);if(generation.status==='prepared')generation=(await h.state.start(generationId)).generation;
 const manifest=JSON.parse(h.bucket.objects.get(generation.manifest_key).toString()),data=await readFeedBucket({bucket:h.bucket,manifest,bucketIndex:generation.bucket_index}),dataset=bucketDataset(generation,data,activation.baselineId),offset=generation.group_offset,groups=data.groups.slice(offset,offset+count),preceding=data.groups.slice(0,offset),canonicalStore=h.state.canonicalStore();
 const receipt={version:1,dataset,observedAt:manifest.observedAt,offset,eventOffset:preceding.reduce((n,g)=>n+g.events.length,0),quarantineOffset:preceding.reduce((n,g)=>n+g.quarantinedSequences.length,0),groups};receipt.batchSha256=hashReceipt(receipt);
 const state=await h.state.getState(),checkpointExtension=createBootstrapDeltaExtension({membership:new FeedBootstrapMembership({db:h.db,store:canonicalStore}),baselineId:activation.baselineId,after:state.committed_sequence,through:generation.last_sequence});await importChangeBatch({db:h.db,store:canonicalStore,receipt,namespace:'server',checkpointExtension});
 const taskKey=changeKeys(dataset.databaseSha256,'server').batchKey(offset),cursor=h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(taskKey).cursor,end=offset+groups.length,done=end===data.uniqueLots,current=workSpec(generationId,'apply',generation.bucket_index,offset),next=workSpec(generationId,done&&generation.bucket_index===127?'finish':'apply',done?generation.bucket_index+1:generation.bucket_index,done?0:end);
 await h.state.checkpoint({generationId,bucketIndex:generation.bucket_index,groupOffset:offset,nextOffset:end,receipts:[{taskKey,cursorSha256:digest(cursor)}],outbox:[next]});await h.state.completeOutbox(current.jobKey);h.sqlite.prepare('UPDATE automatic_refresh_state SET lease_owner=NULL,lease_until=NULL WHERE singleton=1 AND lease_owner=?').run(h.store.owner);return next;
}
test('old100 then new300 then old100 resume share unchanged receipt/hash formats and source checkpoint',async t=>{
 const h=await harness(t),{activation}=await bootstrapSelected(h);await h.run(h.queue.shift());const initialKeys=new Set(h.sqlite.prepare("SELECT task_key FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").all().map(r=>r.task_key)),lots=bucketLots(0,500);await nextWholeFile(h,6002,lots.map((lot,i)=>event(i+4,lot)));h.queue.shift();const after100=await compatibility100Chunk(h,6002,activation);assert.equal(after100.payload.groupOffset,100);
 let lost=false;h.calls.afterCommit=statements=>{const step=statements.find(s=>s.sql.startsWith('UPDATE server_feed_generations SET bucket_index='));if(step&&step.params[1]===400&&!lost){lost=true;throw Error('AFTER_NEW300_CHECKPOINT');}};
 const result=await h.run({version:1,jobKey:after100.jobKey});assert.equal(lost,true);assert.equal(result.databaseUsage.unknown,true);assert.equal(h.sqlite.prepare('SELECT group_offset FROM server_feed_generations WHERE generation_id=6002').get().group_offset,400);h.calls.afterCommit=null;
 const final100=await compatibility100Chunk(h,6002,activation);assert.equal(final100.payload.bucketIndex,1);h.queue.push({version:1,jobKey:final100.jobKey});await drain(h);
 const audits=h.sqlite.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").all().filter(r=>!initialKeys.has(r.task_key)).map(r=>JSON.parse(r.cursor)).sort((a,b)=>a.offset-b.offset);assert.deepEqual(audits.map(a=>[a.offset,a.end]),[[0,100],[100,400],[400,500]]);assert.equal(audits.reduce((n,a)=>n+a.events,0),500);assert.equal(h.sqlite.prepare('SELECT status FROM server_feed_generations WHERE generation_id=6002').get().status,'complete');assert.equal((await h.state.getState()).committed_sequence,SEED_SEQUENCE+503);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_receipts WHERE generation_id=6002').get().n,130);clean(h);
});

test('enlarged width falls back before hydration keys, preserves full-record source and finishes exact prefix',async t=>{
 const h=await harness(t);await bootstrapSelected(h);await h.run(h.queue.shift());const lots=bucketLots(0,201).sort(),record=fullRecord(lots[0]);record.source_extension='x'.repeat(400000);
 const events=lots.map((lot,i)=>i===0?created(i+4,lot,record):event(i+4,lot));await nextWholeFile(h,6002,events);const initialKeys=new Set(h.sqlite.prepare("SELECT task_key FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").all().map(r=>r.task_key));
 const result=await h.run(h.queue.shift());assert.equal(result.ok,true,JSON.stringify(result));await drain(h);const audits=h.sqlite.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").all().filter(r=>!initialKeys.has(r.task_key)).map(r=>JSON.parse(r.cursor)).sort((a,b)=>a.offset-b.offset);assert.deepEqual(audits.map(a=>[a.offset,a.end]),[[0,100],[100,201]]);assert.equal(audits.reduce((n,a)=>n+a.events,0),201);assert.equal(h.sqlite.prepare('SELECT status FROM server_feed_generations WHERE generation_id=6002').get().status,'complete');assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE lot=?').get(lots[0]).n,1);clean(h);
});

async function priceWindowFixture(t,count=401){const h=await harness(t);await bootstrapSelected(h);await h.run(h.queue.shift());const lots=bucketLots(0,count);await nextWholeFile(h,6002,lots.map((lot,i)=>event(i+4,lot)));return{h,lots,body:h.queue.shift()};}
function windowRows(h){return h.sqlite.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-window:%'").all().map(r=>({...r,plan:JSON.parse(r.cursor)}));}
test('sticky window plan lostACK pins300 before any canonical write and ignores changed width on retry',async t=>{
 const {h,lots,body}=await priceWindowFixture(t);let lost=false;h.calls.afterCommit=statements=>{if(!lost&&statements.some(s=>s.sql.startsWith('INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,status,cursor,')&&String(s.params[0]).startsWith('server-feed-window:'))){lost=true;throw Error('WINDOW_PLAN_ACK_LOST');}};
 const first=await h.run(body);assert.equal(first.databaseUsage.unknown,true);assert.equal(h.sqlite.prepare('SELECT group_offset FROM server_feed_generations WHERE generation_id=6002').get().group_offset,0);const pinned=windowRows(h).find(r=>r.plan.source.generationId===6002);assert.equal(pinned.plan.end,300);const auditCount=h.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").get().n;
 h.calls.afterCommit=null;await h.store.acquire();const records=await prepareInventoryPage({db:h.db,provider:createApibaraProvider(),records:[fullRecord(lots[0],'2026-10-28T10:00:00.000Z')],observedAt:AT,processedAt:AT,freshnessPolicy:POLICY});await commitInventoryBatch({db:h.db,store:h.store,prepared:records.prepared});h.release();h.sqlite.prepare('UPDATE auction_listings SET source_status=? WHERE lot=?').run('X'.repeat(400000),lots[0]);const widthReads=h.calls.prepared.filter(s=>s.includes('serialized_bytes')).length;
 const retry=await h.run(body);assert.equal(retry.ok,true,JSON.stringify(retry));assert.equal(h.calls.prepared.filter(s=>s.includes('serialized_bytes')).length,widthReads+1,'only the remaining new101-group window may inspect width');assert.equal(windowRows(h).find(r=>r.task_key===pinned.task_key).cursor,pinned.cursor);assert.ok(h.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").get().n>auditCount);await drain(h);clean(h);
});
test('sticky selectedwindow coreACKloss reuses300 exact receipt despite different retry accounting',async t=>{
 const {h,body}=await priceWindowFixture(t);let lost=false;h.calls.afterCommit=statements=>{if(!lost&&statements.some(s=>s.sql.includes('scan_pages=automatic_refresh_tasks.scan_pages+1'))){lost=true;throw Error('CORE_ACK_AFTER_PIN');}};const first=await h.run(body);assert.equal(first.databaseUsage.unknown,true);const before=windowRows(h).find(r=>r.plan.source.generationId===6002);assert.equal(before.plan.end,300);assert.equal(h.sqlite.prepare('SELECT group_offset FROM server_feed_generations WHERE generation_id=6002').get().group_offset,0);h.calls.afterCommit=null;const retry=await h.run(body);assert.equal(retry.ok,true,JSON.stringify(retry));assert.equal(windowRows(h).find(r=>r.task_key===before.task_key).cursor,before.cursor);await drain(h);clean(h);
});
test('sticky window firsthydrationACKloss reuses original100 fallback and immutable hydration receipt',async t=>{
 const h=await harness(t);await bootstrapSelected(h);await h.run(h.queue.shift());const lots=bucketLots(0,201).sort(),record=fullRecord(lots[0]);record.source_extension='x'.repeat(400000);await nextWholeFile(h,6002,lots.map((lot,i)=>i===0?created(i+4,lot,record):event(i+4,lot)));const body=h.queue.shift();let lost=false;
 h.calls.afterCommit=statements=>{if(!lost&&statements.some(s=>String(s.params?.[0]).startsWith('file-hydration:'))){lost=true;throw Error('HYDRATION_ACK_AFTER_PIN');}};const first=await h.run(body);assert.equal(first.databaseUsage.unknown,true);const pinned=windowRows(h).find(r=>r.plan.source.generationId===6002);assert.equal(pinned.plan.end,100);const receipts=h.sqlite.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'file-hydration:%'").all();h.calls.afterCommit=null;const retry=await h.run(body);assert.equal(retry.ok,true,JSON.stringify(retry));for(const r of receipts)assert.equal(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(r.task_key).cursor,r.cursor);await drain(h);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE lot=?').get(lots[0]).n,1);clean(h);
});
test('old100 canonicalACK legacy receipt is adopted before adaptive selection and stays exact100',async t=>{
 const {h,body}=await priceWindowFixture(t),activation=await readBootstrapActivation({db:h.db,baselineId:'fresh-runner'});let lost=false;h.calls.afterCommit=statements=>{if(!lost&&statements.some(s=>s.sql.includes('scan_pages=automatic_refresh_tasks.scan_pages+1'))){lost=true;throw Error('LEGACY_CORE_ACK');}};await assert.rejects(compatibility100Chunk(h,6002,activation));h.calls.afterCommit=null;h.calls.clock+=11*60000;const retry=await h.run(body);assert.equal(retry.ok,true,JSON.stringify(retry));const plan=windowRows(h).find(r=>r.plan.source.generationId===6002);assert.equal(plan.plan.origin,'legacy-core');assert.equal(plan.plan.end,100);await drain(h);clean(h);
});
test('corrupt sticky plan fails closed before hydration/core and cannot silently resize',async t=>{
 const {h,body}=await priceWindowFixture(t);let lost=false;h.calls.afterCommit=statements=>{if(!lost&&statements.some(s=>String(s.params?.[0]).startsWith('server-feed-window:'))){lost=true;throw Error('PIN_ACK_FOR_TAMPER');}};await h.run(body);h.calls.afterCommit=null;const pinned=windowRows(h).find(r=>r.plan.source.generationId===6002),changed={...pinned.plan,end:100};h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(changed),pinned.task_key);const count=h.count('auction_listings'),result=await h.run(body);assert.equal(result.ok,false);assert.equal(result.errorCode,'SERVER_FEED_WINDOW_PLAN_INVALID');assert.equal(h.count('auction_listings'),count);assert.equal(h.sqlite.prepare('SELECT group_offset FROM server_feed_generations WHERE generation_id=6002').get().group_offset,0);clean(h);
});
test('window creation is atomically fenced against foreign lease and changed active source',async t=>{
 for(const kind of ['lease','active','observed']){const {h,body}=await priceWindowFixture(t);let changed=false;h.calls.beforeBatch=statements=>{if(!changed&&statements.some(s=>String(s.params?.[0]).startsWith('server-feed-window:'))){changed=true;if(kind==='lease')h.sqlite.exec("UPDATE automatic_refresh_state SET lease_owner='foreign' WHERE singleton=1");else if(kind==='active')h.sqlite.exec('UPDATE server_feed_state SET active_generation=NULL WHERE singleton=1');else h.sqlite.prepare('UPDATE server_feed_generations SET observed_at=? WHERE generation_id=6002').run('2026-10-29T11:59:59Z');}};const result=await h.run(body);assert.equal(result.ok,false,kind);assert.equal(windowRows(h).filter(r=>r.plan.source.generationId===6002).length,0,kind);assert.equal(h.sqlite.prepare('SELECT group_offset FROM server_feed_generations WHERE generation_id=6002').get().group_offset,0);if(kind==='lease')assert.equal(h.sqlite.prepare('SELECT lease_owner FROM automatic_refresh_state').get().lease_owner,'foreign');clean(h);}
});

test('legacy hydration without window pin adopts exact old100 before new adaptive width',async t=>{
 const h=await harness(t),{activation}=await bootstrapSelected(h);await h.run(h.queue.shift());const lots=bucketLots(0,201).sort();await nextWholeFile(h,6002,lots.map((lot,i)=>i===0||i===150?created(i+4,lot,fullRecord(lot)):event(i+4,lot)));const body=h.queue.shift();await h.store.acquire();h.state.configureMembership({membership:new FeedBootstrapMembership({db:h.db,store:h.store}),activation});const generation=(await h.state.start(6002)).generation,manifest=JSON.parse(h.bucket.objects.get(generation.manifest_key).toString()),data=await require('../sync/feed-worker-archive.cjs').readFeedBucket({bucket:h.bucket,manifest,bucketIndex:0}),hydration=data.groups.slice(0,100).filter(g=>g.events.some(e=>e.record!=null));const key='file-hydration:'+data.bucketSha256+':0:0';await require('../sync/feed-record-hydration.cjs').applyFeedRecordHydration({db:h.db,store:h.state.canonicalStore(),provider:createApibaraProvider(),groups:hydration,observedAt:manifest.observedAt,receiptKey:key,freshnessPolicy:POLICY});const cursor=h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(key).cursor;h.release();assert.equal(windowRows(h).filter(r=>r.plan.source.generationId===6002).length,0);
 const result=await h.run(body);assert.equal(result.ok,true,JSON.stringify(result));const pin=windowRows(h).find(r=>r.plan.source.generationId===6002);assert.equal(pin.plan.origin,'legacy-hydration');assert.equal(pin.plan.end,100);assert.equal(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(key).cursor,cursor);await drain(h);for(const lot of [lots[0],lots[150]])assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE lot=?').get(lot).n,1);clean(h);
});
test('pinned window insufficient first-request headroom defers exact300 without retry attempts or resize',async t=>{
 const {h,body}=await priceWindowFixture(t);let lost=false;h.calls.afterCommit=statements=>{if(!lost&&statements.some(s=>String(s.params?.[0]).startsWith('server-feed-window:'))){lost=true;throw Error('PIN_BEFORE_HEADROOM');}};await h.run(body);h.calls.afterCommit=null;const before=windowRows(h).find(r=>r.plan.source.generationId===6002);await h.store.acquire();const state=new ServerFeedState({db:h.db,store:h.store}),activation=await readBootstrapActivation({db:h.db,baselineId:'fresh-runner'});state.configureMembership({membership:new FeedBootstrapMembership({db:h.db,store:h.store}),activation});const usage={rowsWritten:4500,rowsRead:49000,statements:850,unknown:false},job=h.outbox(body.jobKey),result=await require('../sync/feed-server-runner.cjs').processJob({env:h.env,state,db:h.db,store:h.store,job,usage,now:()=>h.calls.clock});assert.equal(result.batches,0);assert.equal(result.continuationReason,'pinned_window_headroom');assert.equal(h.outbox(body.jobKey).attempts,0);assert.equal(windowRows(h).find(r=>r.task_key===before.task_key).cursor,before.cursor);assert.equal(h.sqlite.prepare('SELECT group_offset FROM server_feed_generations WHERE generation_id=6002').get().group_offset,0);h.release();assert.equal((await h.run(body)).ok,true);await drain(h);clean(h);
});

test('fresh near-budget full-record window includes plan overhead and proceeds without avoidable admission bounce',async t=>{
 const h=await harness(t);await bootstrapSelected(h);await h.run(h.queue.shift());const lots=bucketLots(0,34);await nextWholeFile(h,6002,lots.map((lot,i)=>created(i+4,lot,fullRecord(lot))));const result=await h.run(h.queue.shift());assert.equal(result.ok,true,JSON.stringify(result));assert.ok(result.batches>=1);assert.notEqual(result.continuationReason,'pinned_window_headroom');const pin=windowRows(h).find(r=>r.plan.source.generationId===6002);assert.ok(pin.plan.end>0&&pin.plan.end<=34);assert.equal(h.sqlite.prepare('SELECT group_offset FROM server_feed_generations WHERE generation_id=6002').get().group_offset,0);await drain(h);assert.equal(h.sqlite.prepare('SELECT status FROM server_feed_generations WHERE generation_id=6002').get().status,'complete');for(const lot of lots)assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE lot=?').get(lot).n,1);clean(h);
});
