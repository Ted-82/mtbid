'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {RefreshStore,POLICY}=require('../sync/automatic-refresh.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
const {countedFeedRequest}=require('../sync/feed-api-request.cjs');
const {prepareInventoryPage}=require('../sync/inventory-page.cjs');
const {commitInventoryBatch}=require('../sync/inventory-commit.cjs');
const {processMissingFeedReconciliation,SCAN_KEY,SCAN_LIMIT}=require('../sync/feed-missing-reconcile.cjs');
const NOW=Date.parse('2026-10-31T12:00:00.000Z'),AT=new Date(NOW).toISOString(),OLD='2026-10-30T12:00:00.000Z';
const VIN='1HGCM82633A004352',LOT='10000001';
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8')).response.data[0];
function raw(lot=LOT){const value=structuredClone(fixture);Object.assign(value,{vehicle_id:'missing-'+lot,platform:'copart',lot_number:lot,vin:VIN,updated_at:AT});value.pricing.current_bid_usd=0;return value;}
async function harness(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 const calls={sql:[],batches:[],beforeBatch:null,afterCommit:null,fetches:[],clock:NOW};
 const db={prepare(sql){calls.sql.push(sql);return{bind(...params){return{sql,params,
  async all(){return{results:sqlite.prepare(sql).all(...params)};},async first(){return sqlite.prepare(sql).get(...params)||null;},
  async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}};}};},async batch(statements){
  calls.batches.push(statements);await calls.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');let results;
  try{results=statements.map(statement=>({meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.params).changes)}}));sqlite.exec('COMMIT');}
  catch(error){sqlite.exec('ROLLBACK');throw error;}await calls.afterCommit?.(statements);return results;
 }};
 const store=new RefreshStore(db,'missing-test',()=>calls.clock);await store.acquire();
 sqlite.prepare("UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=100000,quota_used=10000,quota_left=90000,quota_allowance=89499,quota_plan='pro'").run(AT);
 const h={sqlite,db,store,calls,adapter:createApibaraProvider(),reply:null};
 h.reply=(_url,lot)=>new Response(JSON.stringify({ok:true,data:raw(lot)}),{headers:{'content-type':'application/json'}});
 h.request=await countedFeedRequest({db,store,env:{APIBARA_API_KEY:'offline-test-key'},now:()=>calls.clock,fetchImpl:async url=>{
  const parsed=new URL(url),lot=decodeURIComponent(parsed.pathname.split('/').at(-1));calls.fetches.push(parsed.pathname);return h.reply(parsed,lot);
 }});
 h.run=(extra={})=>processMissingFeedReconciliation({...h,now:()=>calls.clock,...extra});
 return h;
}
function enqueue(h,lot=LOT,changes={}){
 const row={task_key:'reconcile:copart:'+lot,platform:'copart',listing_id:null,cursor:lot,next_due_at:OLD,last_attempt_at:OLD,status:'pending',failures:0,last_error_code:null,...changes};
 h.sqlite.prepare(`INSERT INTO automatic_refresh_tasks(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
}
const task=(h,lot=LOT)=>h.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get('reconcile:copart:'+lot);
const count=(h,table)=>h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
async function seed(h,lot=LOT){
 const record=raw(lot);record.updated_at=OLD;
 const plan=await prepareInventoryPage({db:h.db,provider:h.adapter,records:[record],observedAt:OLD,processedAt:AT,freshnessPolicy:POLICY});
 assert.equal(plan.prepared.length,1,JSON.stringify(plan.rejected));
 await commitInventoryBatch({db:h.db,store:h.store,prepared:plan.prepared});
}
function clean(h){for(const table of ['sync_batch_guards','automatic_refresh_guards'])assert.equal(count(h,table),0);assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);}

test('unseeded legacy missing task creates canonical full car and atomically completes its existing task',async t=>{
 const h=await harness(t);enqueue(h);
 assert.equal(h.sqlite.prepare("SELECT task_key FROM automatic_refresh_tasks WHERE task_key='stream:changes'").get(),undefined);
 const result=await h.run();assert.equal(result.attempted,1);assert.equal(result.completed,1);
 assert.equal(h.calls.fetches.length,1);assert.equal(count(h,'auction_listings'),1);assert.equal(count(h,'auction_listing_snapshots'),1);
 const listing=h.sqlite.prepare('SELECT * FROM auction_listings').get();assert.equal(listing.current_bid_usd,0);assert.equal(listing.vin_normalized,VIN);
 assert.equal(listing.detail_synced_at,AT);assert.equal(task(h).listing_id,listing.listing_id);assert.equal(task(h).status,'complete');
 assert.equal(h.sqlite.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='new:2026-10-31'").get().consumed,1);
 await h.run();assert.equal(h.calls.fetches.length,1);assert.equal(count(h,'auction_listing_snapshots'),1);clean(h);
});

test('known rows, linked tasks, future work and identity quarantines never consume detail requests',async t=>{
 const h=await harness(t);await seed(h);enqueue(h);enqueue(h,'10000002',{status:'identity_error'});
 enqueue(h,'10000003',{next_due_at:'2026-11-01T00:00:00Z'});
 enqueue(h,'10000004',{listing_id:h.sqlite.prepare('SELECT listing_id FROM auction_listings').get().listing_id});
 const before=h.sqlite.prepare('SELECT * FROM auction_listings').all();
 const result=await h.run();assert.equal(result.attempted,0);assert.equal(h.calls.fetches.length,0);
 assert.deepEqual(h.sqlite.prepare('SELECT * FROM auction_listings').all(),before);assert.equal(task(h).status,'pending');clean(h);
});

test('bounded rotating discovery inspects20 indexed keys and admits at most2 requests per invocation',async t=>{
 const h=await harness(t);for(let n=0;n<25;n++)enqueue(h,String(10000000+n),{status:n<20?'complete':'pending'});
 const first=await h.run();assert.equal(first.scanned,SCAN_LIMIT);assert.equal(first.attempted,0);
 const second=await h.run();assert.equal(second.scanned,2);assert.equal(second.completed,2);assert.equal(h.calls.fetches.length,2);
 const third=await h.run();assert.equal(third.completed,2);assert.equal(h.calls.fetches.length,4);
 const query=h.calls.sql.find(sql=>sql.includes('AS known'));
 const plan=h.sqlite.prepare('EXPLAIN QUERY PLAN '+query).all('',SCAN_LIMIT).map(row=>row.detail);
 assert.ok(plan.some(detail=>/SEARCH t USING INDEX sqlite_autoindex_automatic_refresh_tasks_1/.test(detail)),plan.join('\n'));
 assert.ok(plan.some(detail=>/SEARCH l USING COVERING INDEX idx_listings_lot_recent/.test(detail)),plan.join('\n'));
 const sqlBefore=h.calls.sql.length;await h.run({maxRequests:0});assert.equal(h.calls.sql.length,sqlBefore);clean(h);
});

test('platform/LOT/VIN mismatch is quarantined without creating any guessed listing',async t=>{
 for(const kind of ['platform','lot','vin']){
  const h=await harness(t);enqueue(h);const bad=raw();if(kind==='platform')bad.platform='iaai';if(kind==='lot')bad.lot_number='99999999';if(kind==='vin')bad.vin='BAD';
  h.reply=()=>new Response(JSON.stringify({ok:true,data:bad}),{headers:{'content-type':'application/json'}});
  const result=await h.run();assert.equal(result.identityErrors,1);assert.equal(task(h).status,'identity_error');
  assert.equal(count(h,'auction_listings'),0);assert.equal(count(h,'auction_listing_snapshots'),0);assert.equal(h.calls.fetches.length,1);clean(h);
 }
});

test('not-found has seven-day durable backoff while transport failure remains retryable and never completes',async t=>{
 for(const kind of ['missing','transport']){
  const h=await harness(t);enqueue(h);h.reply=()=>{if(kind==='transport')throw Error('private transport diagnostic');return new Response('{}',{status:404});};
  if(kind==='missing'){const result=await h.run();assert.equal(result.failed,1);}else await assert.rejects(h.run(),error=>error.code==='UPSTREAM');
  assert.equal(task(h).status,'pending');assert.equal(task(h).failures,1);assert.equal(count(h,'auction_listings'),0);
  assert.equal(Date.parse(task(h).next_due_at)-NOW,kind==='missing'?7*86400000:3600000);
  await h.run();assert.equal(h.calls.fetches.length,1);clean(h);
 }
});

test('new-listing admission and existing API budgets stop before spending any provider request',async t=>{
 const h=await harness(t);enqueue(h);h.sqlite.exec("UPDATE automatic_refresh_budgets SET consumed=limit_count WHERE budget_key='new:2026-10-31'");
 const report=await h.run();assert.equal(report.reason,'new_listing_budget');assert.equal(h.calls.fetches.length,0);assert.equal(task(h).status,'pending');
 const api=await harness(t);enqueue(api);api.sqlite.exec("UPDATE automatic_refresh_budgets SET consumed=limit_count WHERE budget_key='day:2026-10-31'");
 await assert.rejects(api.run(),/AUTOMATIC_REFRESH_BUDGET_STOP/);assert.equal(api.calls.fetches.length,0);assert.equal(task(api).status,'pending');clean(h);clean(api);
});

test('lost canonical write acknowledgement retries without a second request, duplicate car or snapshot',async t=>{
 const h=await harness(t);enqueue(h);let crashed=false;
 h.calls.afterCommit=statements=>{if(!crashed&&statements.some(statement=>statement.sql.startsWith('INSERT INTO auction_listings'))){crashed=true;throw Error('LOST_REPLY');}};
 await assert.rejects(h.run(),/AUTOMATIC_REFRESH_WRITE_FAILED/);
 assert.equal(task(h).status,'complete');assert.equal(count(h,'auction_listings'),1);assert.equal(count(h,'auction_listing_snapshots'),1);
 h.calls.afterCommit=null;await h.run();assert.equal(h.calls.fetches.length,1);assert.equal(count(h,'auction_listing_snapshots'),1);clean(h);
});

test('task mutation during full write rolls back listing, snapshot, admission and completion together',async t=>{
 const h=await harness(t);enqueue(h);
 h.calls.beforeBatch=statements=>{if(statements.some(statement=>statement.sql.startsWith('INSERT INTO auction_listings'))){h.sqlite.exec("UPDATE automatic_refresh_tasks SET status='identity_error' WHERE task_key='reconcile:copart:10000001'");}};
 await assert.rejects(h.run(),/AUTOMATIC_REFRESH_WRITE_FAILED/);
 assert.equal(task(h).status,'identity_error');assert.equal(count(h,'auction_listings'),0);assert.equal(count(h,'auction_listing_snapshots'),0);
 assert.equal(h.sqlite.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='new:2026-10-31'").get().consumed,0);clean(h);
});

test('a row appearing after paid response cannot be refreshed through the missing-only path',async t=>{
 const h=await harness(t);enqueue(h);let injected=false;
 h.calls.beforeBatch=async statements=>{if(!injected&&statements.some(statement=>statement.sql.startsWith('INSERT INTO auction_listings'))){injected=true;h.calls.beforeBatch=null;await seed(h);}};
 await assert.rejects(h.run(),/AUTOMATIC_REFRESH_WRITE_FAILED/);
 assert.equal(count(h,'auction_listings'),1);assert.equal(count(h,'auction_listing_snapshots'),1);assert.equal(task(h).status,'pending');
 assert.equal(h.calls.fetches.length,1);await h.run();assert.equal(h.calls.fetches.length,1);clean(h);
});

test('expired lease and new-budget races prevent canonical mutation and preserve unresolved need',async t=>{
 for(const kind of ['lease','new-budget']){
  const h=await harness(t);enqueue(h);
  if(kind==='lease')h.sqlite.exec("UPDATE automatic_refresh_state SET lease_until='2026-10-31T11:00:00Z'");
  else h.calls.beforeBatch=statements=>{if(statements.some(statement=>statement.sql.startsWith('INSERT INTO auction_listings'))){h.sqlite.exec("UPDATE automatic_refresh_budgets SET consumed=limit_count WHERE budget_key='new:2026-10-31'");}};
  await assert.rejects(h.run(),/AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(count(h,'auction_listings'),0);assert.equal(task(h).status,'pending');assert.equal(h.calls.fetches.length,kind==='lease'?0:1);clean(h);
 }
});

test('ambiguous existing duplicate LOTs remain outside missing-only recovery and spend no request',async t=>{
 const h=await harness(t);await seed(h);enqueue(h);
 const duplicate={...h.sqlite.prepare('SELECT * FROM auction_listings').get()};
 duplicate.listing_id+='-duplicate';duplicate.source_listing_id=(duplicate.source_listing_id||LOT)+'-duplicate';
 h.sqlite.prepare(`INSERT INTO auction_listings(${Object.keys(duplicate)}) VALUES(${Object.keys(duplicate).map(()=>'?')})`).run(...Object.values(duplicate));
 assert.equal(count(h,'auction_listings'),2);
 const report=await h.run();assert.equal(report.attempted,0);assert.equal(h.calls.fetches.length,0);
 assert.equal(task(h).status,'pending');assert.equal(count(h,'auction_listing_snapshots'),1);clean(h);
});