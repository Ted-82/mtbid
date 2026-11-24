"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), {DatabaseSync} = require("node:sqlite");
const {createApibaraProvider} = require("../providers/apibara.js");
const {D1SyncRepository, knownObservationStatements} = require("../sync/d1-repository.js");
const {prepareObservation} = require("../sync/publication-refresh.cjs");
const {runAutomaticRefresh, configuration, pacedRunLimit, parseUsage, queryBudgetDatabase, RefreshStore, POLICY, TARGETS} = require("../sync/automatic-refresh.cjs");
const NOW = Date.parse("2026-10-14T16:00:00.000Z"), OLD = "2026-10-08T10:00:00.000Z";
const env = extra => ({REXBID_AUTO_REFRESH_ENABLED:"enabled", REXBID_AUTO_REFRESH_DATABASE_ID:TARGETS[0], ...extra});
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/apibara-discovery-page-shape.json"),"utf8")).response.data[0];
const adapter = createApibaraProvider({fetch:async()=>{throw Error("NETWORK_FORBIDDEN");}});
function raw(platform="copart", lot="10000001", bid=0) {
  const r=structuredClone(fixture);r.platform=platform;r.lot_number=lot;r.vehicle_id=`${platform}-${lot}`;
  r.vin="1HGCM82633A004352";r.pricing.current_bid_usd=bid;return r;
}
const page = (records=[],next=null) => ({ok:true,data:records,meta:{next_cursor:next}});
const usage = (left=24164) => ({ok:true,data:{plan:{name:"Basic",per_page_limit:20},quota:{used:30000-left,limit:30000,left}}});
function database() {
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  for(const file of ["0004_d1_sync_2.sql","0008_automatic_refresh.sql"])sqlite.exec(fs.readFileSync(path.join(__dirname,"../docs/proposals",file),"utf8"));
  const queries={count:0};
  const db={prepare(sql){return {bind(...params){return {sql,params,
    async run(){queries.count++;return {meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};},
    async first(){queries.count++;return sqlite.prepare(sql).get(...params)||null;},async all(){queries.count++;return {results:sqlite.prepare(sql).all(...params)};}};}};},
    async batch(statements){queries.count+=statements.length;sqlite.exec("BEGIN IMMEDIATE");try{const results=statements.map(s=>/^\s*SELECT/i.test(s.sql)?{results:sqlite.prepare(s.sql).all(...s.params)}:{meta:{changes:Number(sqlite.prepare(s.sql).run(...s.params).changes)}});sqlite.exec("COMMIT");return results;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  return {sqlite,db,queries};
}
function provider(responses){let i=0;const calls=[];return {...adapter,calls,async request(_env,spec){calls.push(structuredClone(spec));const response=responses[i++];if(response instanceof Error)throw response;if(response===undefined)throw Error("UNEXPECTED_PROVIDER_CALL");return response;}};}
async function seed(db,record=raw()){
  const p=await prepareObservation({repo:new D1SyncRepository(db),provider:adapter,raw:record,platform:record.platform,observedAt:OLD,processedAt:isoNow(),freshnessPolicy:POLICY});
  await db.batch((await knownObservationStatements(db,p.record)).statements);return (await db.prepare("SELECT * FROM auction_listings WHERE platform=? AND lot=?").bind(record.platform,record.lot_number).first());
}
const isoNow=()=>new Date(NOW).toISOString();
const run=(db,p,settings={},clock=()=>NOW)=>runAutomaticRefresh({db,provider:p,env:env(settings),now:clock,wait:async()=>{}});
const rows=(sqlite,table)=>sqlite.prepare(`SELECT * FROM ${table}`).all();
function noLists(sqlite){for(const platform of ["copart","iaai"])sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,next_due_at) VALUES(?,?,?)").run(`inventory:${platform}`,platform,"2026-10-15T00:00:00.000Z");}

test("disabled and invalid target cannot access database or provider",async()=>{
  const p=provider([]);assert.equal((await runAutomaticRefresh({env:{},provider:p})).stopReason,"disabled");
  assert.throws(()=>configuration(env({REXBID_AUTO_REFRESH_DATABASE_ID:"current-mtbid"})),/TARGET_INVALID/);
  assert.throws(()=>configuration(env({REXBID_AUTO_REFRESH_MONTHLY_LIMIT:"500",REXBID_AUTO_REFRESH_DAILY_LIMIT:"501"})),/CONFIG_INVALID/);
  assert.equal(p.calls.length,0);
  assert.equal(configuration(env()).timedEnabled,false);
  assert.equal(configuration(env({REXBID_AUTO_REFRESH_TIMED_ENABLED:"enabled"})).timedEnabled,true);
});

test("persisted OPERATOR_STOP blocks even quota reads after a new scheduler instance",async()=>{
  const {db,sqlite}=database();
  sqlite.exec("UPDATE automatic_refresh_state SET blocked_reason='OPERATOR_STOP',lease_owner=NULL,lease_until=NULL WHERE singleton=1");
  const before=JSON.stringify(rows(sqlite,'automatic_refresh_state'));
  for(let invocation=0;invocation<2;invocation++){
    const p=provider([]),result=await run(db,p);
    assert.equal(result.attempts,0);assert.equal(result.stopReason,'lease_or_pause');assert.equal(p.calls.length,0);
  }
  assert.equal(JSON.stringify(rows(sqlite,'automatic_refresh_state')),before);
  assert.equal(rows(sqlite,'automatic_refresh_attempts').length,0);sqlite.close();
});
test("usage validation uses observed allowance and never guesses a renewal date",()=>{
  assert.deepEqual(parseUsage(usage(),500),{limit:30000,used:5836,left:24164,allowance:23663,plan:"Basic"});
  const bad=usage();bad.data.quota.left=24165;assert.throws(()=>parseUsage(bad,500),/QUOTA_RESPONSE_INVALID/);
  const missing=usage();delete missing.data.plan;assert.throws(()=>parseUsage(missing,500),/QUOTA_RESPONSE_INVALID/);
});

test("daily requests are paced across remaining 15-minute ticks without increasing the hard ceiling",()=>{
 const config={perRun:8};
 const budgets=[{budget_key:'day:2026-10-26',limit_count:500,consumed:160}];
 assert.equal(pacedRunLimit(config,budgets,Date.parse('2026-10-26T09:00:00Z')),5);
 assert.equal(pacedRunLimit(config,[{...budgets[0],consumed:0}],Date.parse('2026-10-26T00:00:00Z')),5);
 assert.equal(pacedRunLimit(config,budgets,Date.parse('2026-10-26T23:59:00Z')),8);
 assert.equal(pacedRunLimit(config,[{...budgets[0],consumed:500}],Date.parse('2026-10-26T12:00:00Z')),1);
 assert.equal(config.perRun,8);
});
test("realistic usage and two platform pages persist zero, identities and snapshots",async()=>{
  const {db,sqlite}=database(),p=provider([usage(),page([raw()]),page([raw("iaai","20000002",25)])]);
  const result=await run(db,p);
  assert.equal(result.ok,true);assert.equal(result.attempts,3);assert.equal(result.responses,3);assert.equal(result.inserted,2);
  assert.deepEqual(rows(sqlite,"auction_listings").map(r=>[r.platform,r.lot,r.current_bid_usd]),[["copart","10000001",0],["iaai","20000002",25]]);
  assert.equal(rows(sqlite,"auction_listing_snapshots").length,2);
  assert.equal(rows(sqlite,"automatic_refresh_attempts").length,3);
  assert.equal(rows(sqlite,"automatic_refresh_state")[0].quota_allowance,23661);
  assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length,0);
  assert.equal(rows(sqlite,"automatic_refresh_guards").length,0);
});
test("daily budget is durable across invocations and reserves usage plus failures",async()=>{
  const {db,sqlite}=database(),p=provider([usage()]);
  const first=await run(db,p,{REXBID_AUTO_REFRESH_DAILY_LIMIT:"1"});
  assert.equal(first.attempts,1);assert.equal(first.stopReason,"AUTOMATIC_REFRESH_BUDGET_STOP");
  const second=await run(db,provider([]),{REXBID_AUTO_REFRESH_DAILY_LIMIT:"500"});
  assert.equal(second.attempts,0);assert.equal(second.stopReason,"AUTOMATIC_REFRESH_BUDGET_STOP");
  assert.equal(sqlite.prepare("SELECT limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key='day:2026-10-14'").get().consumed,1);
});
test("calendar month ceiling survives the next day and a process restart",async()=>{
  const {db}=database();const first=await run(db,provider([usage()]),{REXBID_AUTO_REFRESH_DAILY_LIMIT:"1",REXBID_AUTO_REFRESH_MONTHLY_LIMIT:"1"});
  assert.equal(first.attempts,1);
  const next=await run(db,provider([]),{REXBID_AUTO_REFRESH_DAILY_LIMIT:"1",REXBID_AUTO_REFRESH_MONTHLY_LIMIT:"1"},()=>NOW+DAY);
  assert.equal(next.attempts,0);assert.equal(next.stopReason,"AUTOMATIC_REFRESH_BUDGET_STOP");
});
const DAY=86400000;
test("concurrent cron events share one exclusive lease",async()=>{
  const {db,sqlite}=database();let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const p=provider([usage(),page(),page()]);const request=p.request;p.request=async(...args)=>{if(!p.calls.length){entered();await gate;}return request(...args);};
  const first=run(db,p);await ready;const second=await run(db,provider([]));
  assert.equal(second.stopReason,"lease_or_pause");release();assert.equal((await first).attempts,3);
  assert.equal(rows(sqlite,"automatic_refresh_attempts").length,3);
});
test("expired lease fences a delayed response before any catalogue write",async()=>{
  const {db,sqlite}=database();const p=provider([usage(),page([raw()])]);const request=p.request;
  p.request=async(...args)=>{const response=await request(...args);if(args[1].operation==="listVehicles")sqlite.prepare("UPDATE automatic_refresh_state SET lease_owner='another-worker'").run();return response;};
  const report=await run(db,p);assert.equal(report.ok,false);assert.equal(rows(sqlite,"auction_listings").length,0);assert.equal(p.calls.length,2);
});
test("sparse fresh price clears current amount but preserves old snapshot and media",async()=>{
  const {db,sqlite}=database();const old=await seed(db,raw("copart","10000001",1234));noLists(sqlite);
  const r=raw();r.pricing={current_bid_usd:null};delete r.media;
  const p=provider([usage(),{ok:true,data:r}]);const result=await run(db,p);
  assert.equal(result.updated,1);
  const current=sqlite.prepare("SELECT * FROM auction_listings WHERE listing_id=?").get(old.listing_id);
  assert.equal(current.current_bid_usd,null);assert.equal(current.summary_synced_at,isoNow());assert.equal(current.media_urls_json,old.media_urls_json);
  assert.deepEqual(sqlite.prepare("SELECT observed_at,current_bid_usd FROM auction_listing_snapshots ORDER BY observed_at").all().map(r=>[r.observed_at,r.current_bid_usd]),[[OLD,1234],[isoNow(),null]]);
});

test("open offers with no assigned date are refreshed before older past-date offers",async()=>{
  const {db,sqlite}=database();noLists(sqlite);
  const past=await seed(db,raw('iaai','10000001',100)),undated=await seed(db,raw('iaai','20000002',200));
  sqlite.prepare("UPDATE auction_listings SET auction_state='open',auction_at='2026-10-10T12:00:00Z',timed_end_at=NULL,summary_synced_at='2026-10-01',detail_synced_at='2026-10-01' WHERE listing_id=?").run(past.listing_id);
  sqlite.prepare("UPDATE auction_listings SET auction_state='open',auction_at=NULL,timed_end_at=NULL,summary_synced_at='2026-10-08',detail_synced_at=NULL WHERE listing_id=?").run(undated.listing_id);
  const p=provider([usage(),{ok:true,data:raw('iaai','20000002',250)}]);
  const report=await run(db,p,{REXBID_AUTO_REFRESH_MAX_PER_RUN:'2'});
  assert.equal(report.updated,1);assert.equal(p.calls[1].identifier,'iaai-20000002');
  assert.equal(sqlite.prepare('SELECT current_bid_usd FROM auction_listings WHERE listing_id=?').get(past.listing_id).current_bid_usd,100);
  assert.equal(sqlite.prepare('SELECT current_bid_usd FROM auction_listings WHERE listing_id=?').get(undated.listing_id).current_bid_usd,250);sqlite.close();
});
test("newer observation supersedes an older successful task schedule but preserves error backoff",async()=>{
  for(const status of ['complete','error','older_source_ignored']){
    const {db,sqlite}=database();noLists(sqlite);const old=await seed(db,raw('iaai','20000002',100));
    sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,next_due_at,last_attempt_at,status,last_error_code) VALUES(?,?,?,?,?,?,?)")
      .run(`detail:${old.listing_id}`,'iaai',old.listing_id,'2026-10-20T00:00:00Z','2026-10-01T00:00:00Z',status,status==='error'?'AUTOMATIC_REFRESH_IDENTITY_MISMATCH':null);
    const p=provider(status==='complete'?[usage(),{ok:true,data:raw('iaai','20000002',250)}]:[usage()]);
    const report=await run(db,p);assert.equal(report.updated,status==='complete'?1:0);assert.equal(report.attempts,status==='complete'?2:1);sqlite.close();
  }
});

test("404 preserves observation, is not a sale or empty history and delays this lot",async()=>{
  const {db,sqlite}=database();const old=await seed(db,raw("iaai","20000002",0));noLists(sqlite);
  const error=Object.assign(Error("missing"),{code:"NOT_FOUND",status:404});const report=await run(db,provider([usage(),error]));
  assert.equal(report.ok,true);assert.equal(report.detailFailures,1);
  const current=sqlite.prepare("SELECT * FROM auction_listings WHERE listing_id=?").get(old.listing_id);
  assert.equal(current.current_bid_usd,0);assert.equal(current.summary_synced_at,OLD);assert.equal(current.auction_state,old.auction_state);
  assert.equal(rows(sqlite,"auction_events").length,0);assert.equal(rows(sqlite,"provider_sync_scopes").length,0);
  assert.equal(rows(sqlite,"vehicle_sources")[0].last_error_code,"NOT_FOUND");
  assert.equal(rows(sqlite,"automatic_refresh_tasks").find(t=>t.listing_id===old.listing_id).status,"error");
});
test("wrong LOT/VIN is quarantined while an independent vehicle is refreshed",async()=>{
  const {db,sqlite}=database();const first=await seed(db,raw("copart","10000001",50));await seed(db,raw("iaai","20000002",30));noLists(sqlite);
  const mismatch=raw("copart","99999999",5000);const p=provider([]);
  p.request=async(_env,spec)=>{p.calls.push(structuredClone(spec));return spec.operation==="apiUsage"?usage():{ok:true,data:spec.platform==="copart"?mismatch:raw("iaai","20000002",0)};};
  const result=await run(db,p);assert.equal(result.detailFailures,1);assert.equal(result.updated,1);assert.equal(result.attempts,3);
  assert.equal(sqlite.prepare("SELECT current_bid_usd FROM auction_listings WHERE listing_id=?").get(first.listing_id).current_bid_usd,50);
  assert.equal(rows(sqlite,"auction_listings").length,2);
});
test("one transient retry is counted; authorization blocks future runs",async()=>{
  const {db,sqlite}=database();const timeout=Object.assign(Error("timeout"),{code:"TIMEOUT",status:504});
  const auth=Object.assign(Error("forbidden"),{code:"AUTH",status:403});
  const p=provider([timeout,usage(),auth]);const report=await run(db,p);
  assert.equal(report.attempts,3);assert.equal(report.retries,1);assert.equal(report.responses,1);assert.equal(report.stopReason,"AUTH");
  assert.equal(rows(sqlite,"automatic_refresh_state")[0].blocked_reason,"AUTH");
  assert.equal((await run(db,provider([]))).attempts,0);
});
test("429 is not automatically retried and leaves all known values intact",async()=>{
  const {db,sqlite}=database();const old=await seed(db);noLists(sqlite);
  const limited=Object.assign(Error("rate"),{code:"RATE_LIMITED",status:429,retryAfter:2});
  const report=await run(db,provider([usage(),limited]));assert.equal(report.attempts,2);assert.equal(report.retries,0);
  assert.equal(report.stopReason,"RATE_LIMITED");assert.equal(rows(sqlite,"auction_listings")[0].summary_synced_at,old.summary_synced_at);
  assert.ok(rows(sqlite,"automatic_refresh_state")[0].pause_until);
});
test("quota reserve stops before any data request and malformed usage blocks",async()=>{
  const {db}=database(),p=provider([usage(500)]);const result=await run(db,p);
  assert.equal(result.stopReason,"AUTOMATIC_REFRESH_QUOTA_RESERVE");assert.equal(p.calls.length,1);
  const second=database();const report=await run(second.db,provider([{ok:true,data:{}}]));
  assert.equal(report.stopReason,"AUTOMATIC_REFRESH_QUOTA_RESPONSE_INVALID");
  assert.equal(rows(second.sqlite,"automatic_refresh_state")[0].blocked_reason,"AUTOMATIC_REFRESH_QUOTA_RESPONSE_INVALID");
});
test("discovery cursor is durable; incomplete page does not claim complete inventory",async()=>{
  const {db,sqlite}=database();const p=provider([usage(),page([raw()],"opaque-next"),page()]);const first=await run(db,p);
  assert.equal(first.listPages,2);assert.equal(rows(sqlite,"automatic_refresh_tasks").find(t=>t.task_key==="inventory:copart").status,"partial");
  const second=provider([page([raw("copart","10000003",25)])]);await run(db,second,{},()=>NOW+16*60000);
  assert.equal(second.calls[0].params.cursor,"opaque-next");assert.equal(second.calls[0].params.per_page,20);
  assert.equal(rows(sqlite,"automatic_refresh_tasks").find(t=>t.task_key==="inventory:copart").status,"complete");
});
test("new-listing ceiling cannot stop updates to existing vehicles",async()=>{
  const {db,sqlite}=database();await seed(db);const p=provider([usage(),{ok:true,data:raw("copart","10000001",200)}]);
  const report=await run(db,p,{REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT:"0"});
  assert.equal(report.updated,1);assert.equal(report.inserted,0);assert.equal(report.listPages,0);assert.equal(rows(sqlite,"auction_listings").length,1);
  assert.deepEqual(p.calls.map(x=>x.operation),["apiUsage","vehicleByIdentifier"]);
});
test("exhausted new-listing budget preserves discovery cursor and resumes only the next day",async()=>{
  const {db,sqlite}=database();const p=provider([usage(),page([raw()],"saved-discovery-cursor")]);
  const settings={REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT:"1"};
  const first=await run(db,p,settings);assert.equal(first.inserted,1);assert.equal(first.listPages,1);assert.equal(p.calls.length,2);
  const stopped=provider([]);const second=await run(db,stopped,settings,()=>NOW+16*60000);
  assert.equal(second.attempts,0);assert.equal(sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='inventory:copart'").get().cursor,"saved-discovery-cursor");
  const tomorrow=provider([usage(),page()]);await run(db,tomorrow,{...settings,REXBID_AUTO_REFRESH_MAX_PER_RUN:"2"},()=>NOW+DAY);
  assert.equal(tomorrow.calls[1].params.cursor,"saved-discovery-cursor");
});
test("hot listing task uses the canonical 30 minute interval, not the warm six hours",async()=>{
  const {db,sqlite}=database();const r=raw();r.auction.state="open";r.auction.formatted="Open";r.auction.auction_at=new Date(NOW+3600000).toISOString();await seed(db,r);noLists(sqlite);
  const report=await run(db,provider([usage(),{ok:true,data:r}]));assert.equal(report.updated,1);
  assert.equal(rows(sqlite,"automatic_refresh_tasks").find(t=>t.listing_id).next_due_at,new Date(NOW+30*60000).toISOString());
  const later=await run(db,provider([{ok:true,data:r}]),{},()=>NOW+31*60000);assert.equal(later.updated,1);
});
test("source Open without an assigned date remains warm rather than a seven day cold interval",async()=>{
  const {db,sqlite}=database();const r=raw();r.auction={state:"open",formatted:"Open",lot_status:"active"};await seed(db,r);noLists(sqlite);
  const report=await run(db,provider([usage(),{ok:true,data:r}]));assert.equal(report.updated,1);
  assert.equal(rows(sqlite,"automatic_refresh_tasks").find(t=>t.listing_id).next_due_at,new Date(NOW+6*3600000).toISOString());
});
test("conflicting masked VIN on a list response cannot replace a known observation",async()=>{
  const {db,sqlite}=database();const old=await seed(db);const r=raw();r.vin="9HGCM82633A******";
  const report=await run(db,provider([usage(),page([r]),page()]),{REXBID_AUTO_REFRESH_MAX_PER_RUN:"3"});
  assert.equal(report.rejected,1);assert.equal(report.updated,0);assert.equal(rows(sqlite,"auction_listings")[0].summary_synced_at,old.summary_synced_at);
});
test("database persistence failure stops before the next provider call and keeps the previous snapshot",async()=>{
  const {db,sqlite}=database();const old=await seed(db);noLists(sqlite);
  sqlite.exec("CREATE TRIGGER reject_listing BEFORE UPDATE ON auction_listings BEGIN SELECT RAISE(ABORT,'synthetic write outage'); END");
  const p=provider([usage(),{ok:true,data:raw("copart","10000001",999)}]);const report=await run(db,p);
  assert.equal(report.stopReason,"AUTOMATIC_REFRESH_WRITE_FAILED");assert.equal(report.ok,false);assert.equal(p.calls.length,2);
  assert.equal(rows(sqlite,"auction_listings")[0].current_bid_usd,old.current_bid_usd);assert.equal(rows(sqlite,"auction_listing_snapshots").length,1);
  assert.equal(rows(sqlite,"automatic_refresh_state")[0].blocked_reason,"AUTOMATIC_REFRESH_WRITE_FAILED");
});
test("midnight boundary stops the run before counting calls against the wrong day",async()=>{
  const {db}=database();let now=Date.parse("2026-10-14T23:59:59Z");const p=provider([usage()]);const request=p.request;
  p.request=async(...args)=>{const r=await request(...args);now+=2000;return r;};
  const report=await run(db,p,{},()=>now);assert.equal(report.attempts,1);assert.equal(report.stopReason,"AUTOMATIC_REFRESH_DAY_CHANGED");
});
test("database read failure while preparing a page halts before another platform request",async()=>{
  const {db,sqlite}=database();const prepare=db.prepare.bind(db);db.prepare=sql=>{
    if(sql.includes("SELECT * FROM auction_listings WHERE platform=?"))throw Error("synthetic D1 read unavailable");
    return prepare(sql);
  };
  const p=provider([usage(),page([raw()])]);const result=await run(db,p);
  assert.equal(result.stopReason,"AUTOMATIC_REFRESH_WRITE_FAILED");assert.equal(p.calls.length,2);assert.equal(rows(sqlite,"auction_listings").length,0);
});
test("future and older source dates cannot refresh prices or cause an immediate repeat loop",async()=>{
  const {db,sqlite}=database();const original=raw();original.updated_at="2026-10-08T09:00:00Z";const seeded=await seed(db,original);noLists(sqlite);
  const older=raw("copart","10000001",200);older.updated_at="2026-10-07T09:00:00Z";
  const result=await run(db,provider([usage(),{ok:true,data:older}]));assert.equal(result.skipped,1);assert.equal(result.updated,0);
  assert.equal(rows(sqlite,"auction_listings")[0].summary_synced_at,seeded.summary_synced_at);
  const again=await run(db,provider([]));assert.equal(again.attempts,0);
});
test("monthly pacing spreads the 12000 ceiling across remaining calendar days",async()=>{
  const {db,sqlite}=database();await run(db,provider([usage(),page(),page()]),{},()=>Date.parse("2026-11-01T12:00:00Z"));
  assert.equal(sqlite.prepare("SELECT limit_count FROM automatic_refresh_budgets WHERE budget_key='day:2026-11-01'").get().limit_count,400);
});
test("provider outage marks only its attempted listing failed without changing observation time",async()=>{
  const {db,sqlite}=database();const row=await seed(db);noLists(sqlite);
  const error=Object.assign(Error("unavailable"),{code:"UPSTREAM",status:503});
  const result=await run(db,provider([usage(),error,error]));assert.equal(result.attempts,3);assert.equal(result.stopReason,"UPSTREAM");
  assert.equal(rows(sqlite,"vehicle_sources")[0].last_error_code,"UPSTREAM");
  assert.equal(rows(sqlite,"auction_listings")[0].summary_synced_at,row.summary_synced_at);
});
test("known healthy active lots precede historical unresolved lots in the same priority class",async()=>{
  const {db,sqlite}=database();const unresolved=await seed(db);await seed(db,raw("iaai","20000002",10));noLists(sqlite);
  sqlite.prepare("UPDATE vehicle_sources SET last_error_code='NOT_FOUND' WHERE source_key=?").run(unresolved.source_key);
  const p=provider([usage(),{ok:true,data:raw("iaai","20000002",20)}]);
  const report=await run(db,p,{REXBID_AUTO_REFRESH_MAX_PER_RUN:"2"});assert.equal(report.updated,1);
  assert.equal(p.calls[1].platform,"iaai");assert.equal(sqlite.prepare("SELECT summary_synced_at FROM auction_listings WHERE listing_id=?").get(unresolved.listing_id).summary_synced_at,OLD);
});

test("verified details precede old unresolved imports even when source errors were not copied",async()=>{
  const {db,sqlite}=database();const unresolved=await seed(db);const verified=await seed(db,raw("iaai","20000002",10));noLists(sqlite);
  sqlite.prepare("UPDATE auction_listings SET summary_synced_at='2026-09-29T10:00:00.000Z',detail_synced_at=NULL WHERE listing_id=?").run(unresolved.listing_id);
  sqlite.prepare("UPDATE auction_listings SET detail_synced_at=? WHERE listing_id=?").run(OLD,verified.listing_id);
  const p=provider([usage(),{ok:true,data:raw("iaai","20000002",20)}]);
  const report=await run(db,p,{REXBID_AUTO_REFRESH_MAX_PER_RUN:"2"});assert.equal(report.updated,1);
  assert.equal(p.calls[1].platform,"iaai");
});

test("operator STOP invalidates an in-flight lease and retains its counted attempt",async()=>{
  const {db,sqlite}=database();const p=provider([usage(),page([raw()])]);const request=p.request;
  p.request=async(...args)=>{const response=await request(...args);if(args[1].operation==="listVehicles"){
    sqlite.exec("UPDATE automatic_refresh_state SET blocked_reason='OPERATOR_STOP',lease_owner=NULL,lease_until=NULL WHERE singleton=1");
  }return response;};
  const report=await run(db,p);assert.equal(report.ok,false);assert.equal(p.calls.length,2);
  assert.equal(rows(sqlite,"auction_listings").length,0);assert.equal(rows(sqlite,"automatic_refresh_attempts").length,2);
  assert.equal(rows(sqlite,"automatic_refresh_state")[0].blocked_reason,"OPERATOR_STOP");
  assert.equal((await run(db,provider([]))).attempts,0);
});

test('inventory bootstrap covers all Open dates and keeps its cursor beyond one day',async()=>{
 const {db,sqlite}=database();
 const p=provider([usage(),page([], 'inventory-page-2'),page()]);
 await run(db,p);
 assert.equal(p.calls[1].params.lot_sub_status,'Open');
 assert.equal(Object.hasOwn(p.calls[1].params,'updated_within_minutes'),false);
 sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at) VALUES('list:copart','copart','old-delta-cursor',?)").run(isoNow());
 const next=provider([usage(),page([], 'inventory-page-3')]);
 const result=await run(db,next,{REXBID_AUTO_REFRESH_MAX_PER_RUN:'2'},()=>NOW+2*DAY);
 assert.equal(result.ok,true);assert.equal(next.calls[1].params.cursor,'inventory-page-2');
 assert.equal(Object.hasOwn(next.calls[1].params,'updated_within_minutes'),false);
 assert.equal(sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='list:copart'").get().cursor,'old-delta-cursor');
 sqlite.close();
});

test('completed inventory switches to independently checkpointed recent changes',async()=>{
 const {db,sqlite}=database();await run(db,provider([usage(),page(),page()]));
 const p=provider([page([], 'delta-next'),page()]);const r=await run(db,p,{},()=>NOW+31*60000);
 assert.equal(r.ok,true);assert.equal(p.calls[0].params.updated_within_minutes,1440);
 assert.equal(p.calls[0].params.cursor,undefined);
 assert.equal(sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='list:copart'").get().cursor,'delta-next');sqlite.close();
});

test('admission cap sizes the final page so no returned row is discarded',async()=>{
 const {db,sqlite}=database();const p=provider([usage(),page([raw()],'next-after-one')]);
 const r=await run(db,p,{REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT:'1'});
 assert.equal(r.inserted,1);assert.equal(r.skipped,0);assert.equal(p.calls[1].params.per_page,1);
 assert.equal(sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='inventory:copart'").get().cursor,'next-after-one');sqlite.close();
});

test('larger inventory allowance never raises durable API request budgets',async()=>{
 const {db,sqlite}=database();
 const r=await run(db,provider([usage()]),{REXBID_AUTO_REFRESH_DAILY_LIMIT:'1',REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT:'2000'});
 assert.equal(r.attempts,1);assert.equal(r.stopReason,'AUTOMATIC_REFRESH_BUDGET_STOP');
 assert.equal(sqlite.prepare("SELECT limit_count FROM automatic_refresh_budgets WHERE budget_key='new:2026-10-14'").get().limit_count,2000);
 assert.throws(()=>configuration(env({REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT:'2001'})),/CONFIG_INVALID/);sqlite.close();
});

function seedStream(sqlite, cursor="0") {
  sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('stream:changes','all',?,?,'catching_up')")
    .run(cursor,OLD);
}
function changePage(count=500,hasMore=true,unsupported=true) {
  const data=Array.from({length:count},(_,index)=>{
    const platform=index%2?"iaai":"copart",lot=platform==="iaai"?"20000002":"10000001";
    return {sequence:index+1,event_id:`change_${index+1}`,event:"bid.changed",terminal:false,
      vehicle:{platform,lot_number:lot,vin:"1HGCM82633A004352"},
      changed_fields:["pricing.current_bid_usd",...(unsupported?["make"]:[])],before:{},
      after:{"pricing.current_bid_usd":index+101,...(unsupported?{make:"Updated"}:{})},
      recorded_at:new Date(NOW-1000).toISOString(),vehicle_updated_at:new Date(NOW-1000).toISOString()};
  });
  return {ok:true,data,meta:{after:0,next_cursor:count,has_more:hasMore,count,ordering:"sequence_asc",
    schema_version:"2026-10-04.beta1",retention_days:14,oldest_available_sequence:1,latest_available_sequence:count+Number(hasMore)}};
}

test("seeded stream runs before discovery and 500 mixed changes plus quota and two details stay below 1000 D1 queries",async(t)=>{
  const {db,sqlite,queries}=database();await seed(db);await seed(db,raw("iaai","20000002",10));seedStream(sqlite);
  const p=provider([usage(),changePage(),{ok:true,data:raw("copart","10000001",1000)},{ok:true,data:raw("iaai","20000002",2000)}]);
  queries.count=0;const report=await run(db,p,{REXBID_AUTO_REFRESH_MAX_PER_RUN:"4"});
  assert.equal(report.ok,true);assert.equal(report.changes.events,500);assert.equal(report.changes.patched,500);
  assert.equal(report.changes.queued,500);assert.equal(report.changes.hasMore,true);assert.equal(report.reconciliation.completed,2);
  assert.equal(report.listPages,0);assert.deepEqual(p.calls.map(call=>call.operation),["apiUsage","vehicleChanges","vehicleByIdentifier","vehicleByIdentifier"]);
  assert.equal(report.d1Queries,queries.count);assert.ok(report.d1Queries<1000,`D1 statements: ${report.d1Queries}`);
  t.diagnostic(`500 changes + quota + two full details + scheduler cleanup: ${report.d1Queries} D1 statements`);
  assert.equal(sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='stream:changes'").get().cursor,"500");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM automatic_refresh_tasks WHERE task_key LIKE 'reconcile:%' AND status='complete'").get().n,2);
  assert.equal(rows(sqlite,"automatic_refresh_state")[0].lease_owner,null);
  assert.equal(rows(sqlite,"automatic_refresh_state")[0].last_success_at,isoNow());sqlite.close();
});

test("a full final stream page also bounds discovery and keeps unused discovery cursors intact",async(t)=>{
  const {db,sqlite,queries}=database();await seed(db);await seed(db,raw("iaai","20000002",10));seedStream(sqlite);
  const records=Array.from({length:20},(_,index)=>raw("copart",String(30000000+index),index));
  const p=provider([usage(),changePage(500,false,false),page(records,"next-list-page")]);
  queries.count=0;const report=await run(db,p,{REXBID_AUTO_REFRESH_MAX_PER_RUN:"3"});
  assert.equal(report.ok,true);assert.equal(report.changes.hasMore,false);assert.equal(report.listPages,1);
  assert.equal(report.d1Queries,queries.count);assert.ok(report.d1Queries<1000);
  t.diagnostic(`500 changes + quota + full 20-record discovery page + cleanup: ${report.d1Queries} D1 statements`);
  assert.equal(sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='inventory:copart'").get().cursor,"next-list-page");
  assert.equal(sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key='inventory:iaai'").get(),undefined);
  assert.equal(rows(sqlite,"automatic_refresh_state")[0].blocked_reason,null);sqlite.close();
});

test("coalesced stream bids leave SQL capacity for Timed pages without raising the run budget",async(t)=>{
  const {db,sqlite,queries}=database();await seed(db);await seed(db,raw("iaai","20000002",10));seedStream(sqlite);noLists(sqlite);
  const timedPage=platform=>({ok:true,data:[],meta:{platform,view:'full',upcoming:'all',per_page:20,next_cursor:null,has_more:false,total:0,total_is_exact:true,unknown_filters:[],
    applied_filters:{platform,view:'full',upcoming:'all',per_page:'20',lot_status:'Timed',lot_sub_status:'Open',include_total:'true'}}});
  const p=provider([usage(),changePage(500,false,false),timedPage('copart'),timedPage('iaai'),{ok:true,data:raw("copart","10000001",1000)},{ok:true,data:raw("iaai","20000002",2000)}]);
  queries.count=0;const report=await run(db,p,{REXBID_AUTO_REFRESH_TIMED_ENABLED:"enabled"});
  assert.equal(report.ok,true);assert.equal(report.changes.events,500);
  assert.equal(report.timed.pages,2);assert.deepEqual(report.timed.completed,['copart','iaai']);
  assert.deepEqual(p.calls.map(call=>call.operation),["apiUsage","vehicleChanges","listVehicles","listVehicles","vehicleByIdentifier","vehicleByIdentifier"]);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM automatic_refresh_tasks WHERE task_key LIKE 'timed:%' AND status='complete'").get().n,2);
  assert.equal(report.d1Queries,queries.count);assert.ok(report.d1Queries<1000);
  t.diagnostic(`500 coalesced stream changes, two Timed pages and details: ${report.d1Queries} SQL statements`);sqlite.close();
});

test("catching-up stream skips list discovery even when request allowance remains",async()=>{
  const {db,sqlite}=database();seedStream(sqlite);const p=provider([usage(),changePage(0,true,false)]);
  // An empty advancing response is legal and avoids inventing unknown rows.
  p.request=async function(_env,spec){this.calls.push(structuredClone(spec));
    if(spec.operation==="apiUsage")return usage();
    assert.equal(spec.operation,"vehicleChanges");const response=changePage(0,true,false);
    response.meta.next_cursor=10;response.meta.latest_available_sequence=11;return response;};
  const report=await run(db,p);assert.equal(report.ok,true);assert.equal(report.attempts,2);assert.equal(report.listPages,0);
  assert.equal(report.changes.cursor,10);assert.equal(report.reconciliation.attempted,0);sqlite.close();
});

test("no stream seed preserves legacy discovery and does not process stray reconciliation jobs",async()=>{
  const {db,sqlite,queries}=database();
  sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('reconcile:copart:10000001','copart','10000001',?,'pending')").run(OLD);
  const p=provider([usage(),page(),page()]);queries.count=0;const report=await run(db,p);
  assert.equal(report.ok,true);assert.equal(report.changes,undefined);assert.equal(report.reconciliation,undefined);
  assert.deepEqual(p.calls.map(call=>call.operation),["apiUsage","listVehicles","listVehicles"]);
  assert.equal(report.d1Queries,queries.count);sqlite.close();
});

test("an expired stream checkpoint latches rebootstrap and never silently falls back to ordinary list scans",async()=>{
  const {db,sqlite}=database();seedStream(sqlite,"1000");
  const p=provider([usage(),Object.assign(Error("cursor expired"),{code:"CURSOR_EXPIRED",status:410})]);
  const report=await run(db,p);assert.equal(report.ok,true);assert.equal(report.changes.rebootstrapRequired,true);
  assert.equal(report.attempts,2);assert.equal(report.listPages,0);assert.equal(report.reconciliation,undefined);
  assert.equal(sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='stream:changes'").get().cursor,"1000");sqlite.close();
});

test("D1 budget fences a whole oversized transaction before execution and retains finalization capacity",async()=>{
  const {db:original,sqlite,queries}=database(),{db,budget}=queryBudgetDatabase(original);
  await db.batch(Array.from({length:968},()=>db.prepare("SELECT 1").bind()));
  assert.equal(budget.used,968);assert.equal(queries.count,968);
  await assert.rejects(async()=>db.batch([db.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,next_due_at) VALUES('never','all',?)").bind(OLD),
    db.prepare("SELECT 1").bind(),db.prepare("SELECT 1").bind()]),/AUTOMATIC_REFRESH_QUERY_LIMIT/);
  assert.equal(queries.count,968);assert.equal(sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key='never'").get(),undefined);
  budget.limit=1000;await db.batch([db.prepare("SELECT 1").bind(),db.prepare("SELECT 1").bind(),db.prepare("SELECT 1").bind()]);
  assert.equal(budget.used,971);assert.equal(queries.count,971);sqlite.close();
});

test("query ceiling remains a safe scheduling stop rather than a persistence failure",async()=>{
  const {db:original,sqlite}=database(),{db,budget}=queryBudgetDatabase(original);
  const store=new RefreshStore(db,"query-limit-test",()=>NOW);await store.acquire();budget.limit=budget.used+2;
  await assert.rejects(store.guarded([db.prepare("UPDATE automatic_refresh_state SET last_success_at=?").bind(isoNow())]),
    {message:"AUTOMATIC_REFRESH_QUERY_LIMIT"});
  assert.equal(rows(sqlite,"automatic_refresh_state")[0].last_success_at,null);
  assert.equal(rows(sqlite,"automatic_refresh_guards").length,0);sqlite.close();
});
