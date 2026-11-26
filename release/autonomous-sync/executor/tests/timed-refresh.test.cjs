"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), {DatabaseSync} = require("node:sqlite");
const {createApibaraProvider} = require("../providers/apibara.js");
const {D1SyncRepository, knownObservationStatements} = require("../sync/d1-repository.js");
const {prepareObservation} = require("../sync/publication-refresh.cjs");
const {runAutomaticRefresh, POLICY, TARGETS} = require("../sync/automatic-refresh.cjs");
const {validateTimedPage,processTimedRefresh,HORIZON} = require("../sync/timed-refresh.cjs");
const NOW = Date.parse("2026-10-26T16:00:00.000Z"), OLD = "2026-10-20T10:00:00.000Z";
const at = n => new Date(n).toISOString();
const adapter = createApibaraProvider({fetch:async()=>{throw Error("NETWORK_FORBIDDEN");}});
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/apibara-discovery-page-shape.json"),"utf8")).response.data[0];
function raw(platform="iaai",lot="20000001",bid=0) {
  const record=structuredClone(fixture);
  Object.assign(record,{platform,lot_number:lot,vehicle_id:`${platform}-${lot}`,vin:"1HGCM82633A004352",updated_at:"2026-10-26T15:55:00.000Z"});
  record.auction={state:"open",is_timed:true,is_buy_now:false,auction_at:"2026-10-27T01:19:00+00:00",timed_end_at:"2026-10-27T01:19:00+00:00"};
  record.pricing={current_bid_usd:bid,buy_now_usd:null};return record;
}
const params = (platform="iaai",extra={}) => ({platform,lot_status:"Timed",lot_sub_status:"Open",per_page:20,include_total:true,...extra});
// Same envelope and metadata as the saved first/continuation pages, with wholly
// synthetic vehicle identities and opaque cursors. No live provider calls.
function page(p,records=[],next=null,total=records.length) {
  const echo={platform:p.platform,lot_status:"Timed",lot_sub_status:"Open",per_page:String(p.per_page),upcoming:"all",view:"full"};
  if(p.include_total)echo.include_total="true";
  return {ok:true,data:records,meta:{per_page:p.per_page,next_cursor:next,prev_cursor:p.cursor?"opaque-previous":null,has_more:next!==null,
    total:p.include_total?total:null,total_is_exact:p.include_total?true:null,
    updated_within_minutes:null,updated_since:null,updated_at_order:null,upcoming:"all",platform:p.platform,view:"full",applied_filters:echo,unknown_filters:[]}};
}
function database() {
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  for(const file of ["0004_d1_sync_2.sql","0008_automatic_refresh.sql"])sqlite.exec(fs.readFileSync(path.join(__dirname,"../docs/proposals",file),"utf8"));
  const queries={count:0};
  const db={prepare(sql){return {bind(...values){return {sql,values,
    async run(){queries.count++;return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};},
    async first(){queries.count++;return sqlite.prepare(sql).get(...values)||null;},
    async all(){queries.count++;return {results:sqlite.prepare(sql).all(...values)};}};}};},
    async batch(statements){queries.count+=statements.length;sqlite.exec("BEGIN IMMEDIATE");try{const result=statements.map(s=>/^\s*SELECT/i.test(s.sql)?
      {results:sqlite.prepare(s.sql).all(...s.values)}:{meta:{changes:Number(sqlite.prepare(s.sql).run(...s.values).changes)}});sqlite.exec("COMMIT");return result;
    }catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  sqlite.prepare("UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=30000,quota_used=6000,quota_left=24000,quota_allowance=23000,quota_plan='Basic'").run(at(NOW));
  for(const platform of ["copart","iaai"])sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,next_due_at) VALUES(?,?,?)")
    .run(`inventory:${platform}`,platform,at(NOW+2*86400000));
  return {db,sqlite,queries};
}
function provider(handler) {return {...adapter,calls:[],async request(_env,spec){this.calls.push(structuredClone(spec));return handler(spec,this.calls.length);}};}
const settings={REXBID_AUTO_REFRESH_ENABLED:"enabled",REXBID_AUTO_REFRESH_DATABASE_ID:TARGETS[0],REXBID_AUTO_REFRESH_TIMED_ENABLED:"enabled"};
const run=(db,p,extra={},time=NOW)=>runAutomaticRefresh({db,provider:p,env:{...settings,...extra},now:()=>time,wait:async()=>{}});
async function seed(db,record) {
  const saved=structuredClone(record);saved.updated_at=OLD;
  const prepared=await prepareObservation({repo:new D1SyncRepository(db),provider:adapter,raw:saved,platform:saved.platform,observedAt:OLD,processedAt:OLD,freshnessPolicy:POLICY});
  await db.batch((await knownObservationStatements(db,prepared.record)).statements);
  return (await db.prepare("SELECT * FROM auction_listings WHERE platform=? AND lot=?").bind(saved.platform,saved.lot_number).first());
}
const task=(sqlite,key)=>sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key=?").get(key);
const listing=(sqlite,lot)=>sqlite.prepare("SELECT * FROM auction_listings WHERE lot=?").get(lot);
function skipTimed(sqlite,platform) {sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,next_due_at) VALUES(?,?,?)").run(`timed:${platform}`,platform,at(NOW+2*86400000));}

test("realistic Timed contract accepts a first page and continuation without cursor/include_total echo",()=>{
  const first=params(),continuation=params("iaai",{cursor:"next-A",include_total:undefined});
  assert.equal(validateTimedPage(page(first,[raw()],"next-A",148),adapter,first).total,148);
  const result=validateTimedPage(page(continuation,[raw()],null),adapter,continuation);
  assert.equal(result.records.length,1);assert.equal(result.total,null);
});

for(const [name,mutate] of [
  ["wrong filter",r=>r.meta.applied_filters.lot_status="All"],
  ["missing Open echo",r=>delete r.meta.applied_filters.lot_sub_status],
  ["unknown filters",r=>r.meta.unknown_filters=["lot_status"]],
  ["unexpected scope",r=>r.meta.applied_filters.updated_within_minutes="1440"],
  ["wrong platform meta",r=>r.meta.platform="copart"],
  ["wrong platform record",r=>r.data[0].platform="copart"],
  ["not Timed",r=>r.data[0].auction.is_timed=false],
  ["not Open",r=>r.data[0].auction.state="sold"],
  ["missing end time",r=>r.data[0].auction.timed_end_at=null],
  ["masked identity",r=>r.data[0].vin="1HGCM82633*******"],
  ["wrong page size",r=>r.meta.per_page=200],
  ["incorrect more flag",r=>r.meta.has_more=true],
  ["invalid exact total",r=>r.meta.total_is_exact=false],
  ["duplicate LOT",r=>r.data.push(structuredClone(r.data[0]))]
]) test(`rejects ${name} before writing any page record`,async()=>{
  const {db,sqlite}=database();skipTimed(sqlite,"copart");
  const p=provider(spec=>{const response=page(spec.params,[raw()]);mutate(response);return response;});
  const report=await run(db,p);assert.equal(report.ok,false);assert.equal(report.attempts,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM auction_listings").get().n,0);
  assert.equal(task(sqlite,"timed:iaai").status,"error");assert.equal(task(sqlite,"timed:iaai").cursor,null);
  assert.equal(task(sqlite,"timed:iaai").last_success_at,null);sqlite.close();
});

test("two Timed pages checkpoint independently and precede ordinary discovery without changing SQL/request ceilings",async(t)=>{
  const {db,sqlite,queries}=database();sqlite.prepare("DELETE FROM automatic_refresh_tasks WHERE task_key LIKE 'inventory:%'").run();
  const p=provider(spec=>spec.params.lot_status==="Timed"?page(spec.params,spec.params.platform==="copart"?[]:Array.from({length:20},(_,i)=>raw("iaai",String(20000000+i),i)),spec.params.platform==="iaai"?"page-2":null,148):{ok:true,data:[],meta:{next_cursor:null}});
  const report=await run(db,p,{REXBID_AUTO_REFRESH_MAX_PER_RUN:"3"});
  assert.equal(report.ok,true);assert.equal(report.timed.pages,2);assert.equal(report.timed.saved,20);assert.equal(report.attempts,3);
  assert.deepEqual(p.calls.map(x=>x.params.lot_status||"ordinary"),["Timed","Timed","ordinary"]);
  assert.equal(task(sqlite,"timed:iaai").cursor,"page-2");assert.equal(task(sqlite,"timed:iaai").next_due_at,at(NOW+15*60000));
  assert.equal(task(sqlite,"timed:copart").next_due_at,at(NOW+30*60000));
  assert.equal(report.d1Queries,queries.count);assert.ok(report.d1Queries<1000);
  assert.equal(listing(sqlite,"20000000").current_bid_usd,0);assert.equal(listing(sqlite,"20000000").is_timed,1);
  assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length,0);
  assert.equal(report.budgets.find(b=>b.budget_key.startsWith("day:")).limit_count,500);
  assert.equal(report.budgets.find(b=>b.budget_key.startsWith("month:")).limit_count,12000);
  t.diagnostic(`20 full Timed records + empty platform + ordinary page: ${report.d1Queries} SQL statements`);sqlite.close();
});

test("continuation completes after restart and preserves real observations without duplicate listings",async()=>{
  const {db,sqlite}=database();skipTimed(sqlite,"copart");
  const p=provider(spec=>page(spec.params,[raw()],"page-2",2));
  const first=await run(db,p,{REXBID_AUTO_REFRESH_MAX_PER_RUN:"2"});assert.equal(first.timed.pages,1);
  const second=provider(spec=>{assert.equal(spec.params.cursor,"page-2");assert.equal(spec.params.include_total,undefined);return page(spec.params,[raw("iaai","20000002",25)]);});
  const report=await run(db,second,{},NOW+16*60000);assert.equal(report.ok,true);assert.equal(report.inserted,1);
  assert.equal(task(sqlite,"timed:iaai").status,"complete");assert.equal(task(sqlite,"timed:iaai").cursor,null);
  assert.equal(task(sqlite,"timed:iaai").next_due_at,at(NOW+46*60000));
  assert.equal(listing(sqlite,"20000001").summary_synced_at,at(NOW));assert.equal(listing(sqlite,"20000002").summary_synced_at,at(NOW+16*60000));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM auction_listings").get().n,2);sqlite.close();
});

test("two full Timed pages in one run remain below 1000 SQL and stop after two pages",async(t)=>{
  const {db,sqlite,queries}=database();skipTimed(sqlite,"copart");
  const p=provider(spec=>page(spec.params,Array.from({length:20},(_,index)=>raw("iaai",String((spec.params.cursor?30000000:20000000)+index),index)),spec.params.cursor?"page-3":"page-2",148));
  const report=await run(db,p);assert.equal(report.ok,true);assert.equal(report.timed.pages,2);assert.equal(report.inserted,40);
  assert.equal(report.attempts,2);assert.equal(task(sqlite,"timed:iaai").cursor,"page-3");
  assert.equal(report.d1Queries,queries.count);assert.ok(report.d1Queries<1000);
  t.diagnostic(`40 Timed records + accounting/checkpoints: ${report.d1Queries} SQL statements`);sqlite.close();
});

test("zero admission cap updates known Timed rows, preserves unknown page cursor and never claims completion",async()=>{
  const {db,sqlite}=database();skipTimed(sqlite,"copart");await seed(db,raw());
  const p=provider(spec=>page(spec.params,[raw("iaai","20000001",250),raw("iaai","20000002",50)],"next-after-cap",2));
  const report=await run(db,p,{REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT:"0",REXBID_AUTO_REFRESH_MAX_PER_RUN:"2"});
  assert.equal(report.updated,1);assert.equal(report.inserted,0);assert.equal(report.timed.capDeferred,1);assert.equal(listing(sqlite,"20000001").current_bid_usd,250);
  assert.equal(task(sqlite,"timed:iaai").cursor,null);assert.equal(task(sqlite,"timed:iaai").scan_pages,0);assert.equal(task(sqlite,"timed:iaai").status,"partial");
  assert.equal(task(sqlite,"timed:iaai").last_success_at,null);assert.deepEqual(report.timed.completed,[]);sqlite.close();
});

test("remaining new capacity shortens page, while an empty result never ends old offers or proves market absence",async()=>{
  const {db,sqlite}=database();await seed(db,raw());
  // Avoid a separate detail refresh: the assertion concerns an empty Timed page.
  sqlite.prepare("UPDATE auction_listings SET next_refresh_at=?").run(at(NOW+86400000));
  const p=provider(spec=>{assert.equal(spec.params.per_page,1);return page(spec.params,[]);});
  const report=await run(db,p,{REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT:"1"});
  assert.equal(report.timed.pages,2);assert.equal(report.updated,0);assert.equal(report.inserted,0);
  assert.equal(listing(sqlite,"20000001").summary_synced_at,OLD);assert.equal(listing(sqlite,"20000001").auction_state,"open");
  assert.equal(report.timed.sourceTotals.iaai.total,0);assert.equal(report.timed.marketComplete,undefined);sqlite.close();
});

test("older provider source version cannot receive a new observation time",async()=>{
  const {db,sqlite}=database();skipTimed(sqlite,"copart");await seed(db,raw());
  sqlite.prepare("UPDATE auction_listings SET next_refresh_at=?").run(at(NOW+86400000));
  const older=raw("iaai","20000001",999);older.updated_at="2026-10-19T00:00:00Z";
  const report=await run(db,provider(spec=>page(spec.params,[older])));
  assert.equal(report.updated,0);assert.equal(report.skipped,1);assert.equal(listing(sqlite,"20000001").summary_synced_at,OLD);
  assert.equal(listing(sqlite,"20000001").current_bid_usd,0);sqlite.close();
});

test("VIN mismatch retains correct data and scan is partial rather than empty or complete",async()=>{
  const {db,sqlite}=database();skipTimed(sqlite,"copart");await seed(db,raw());
  sqlite.prepare("UPDATE auction_listings SET next_refresh_at=?").run(at(NOW+86400000));
  const other=raw();other.vin="1HGCM82633A004353";
  const report=await run(db,provider(spec=>page(spec.params,[other])));
  assert.equal(report.ok,true);assert.equal(report.rejected,1);assert.equal(report.timed.rejected,1);
  assert.equal(task(sqlite,"timed:iaai").status,"partial");assert.equal(task(sqlite,"timed:iaai").scan_errors,1);
  assert.equal(listing(sqlite,"20000001").summary_synced_at,OLD);assert.deepEqual(report.timed.completed,[]);sqlite.close();
});

test("saved cursor history rejects a non-adjacent cycle before overwriting any observation",async()=>{
  const {db,sqlite}=database();skipTimed(sqlite,"copart");
  const first=provider(spec=>page(spec.params,[raw()],spec.params.cursor?"page-B":"page-A",3));
  const r1=await run(db,first);assert.equal(r1.timed.pages,2);assert.equal(task(sqlite,"timed:iaai").cursor,"page-B");
  const p=provider(spec=>page(spec.params,[raw("iaai","20000001",999)],"page-A"));
  const r2=await run(db,p,{},NOW+16*60000);assert.equal(r2.ok,false);assert.equal(r2.stopReason,"AUTOMATIC_REFRESH_TIMED_CURSOR_CYCLE");
  assert.equal(task(sqlite,"timed:iaai").cursor,"page-B");assert.equal(listing(sqlite,"20000001").current_bid_usd,0);
  assert.equal(listing(sqlite,"20000001").summary_synced_at,at(NOW));sqlite.close();
});

test("expired scan starts a bounded new horizon without reusing its old cursor or claiming the old scan complete",async()=>{
  const {db,sqlite}=database();skipTimed(sqlite,"copart");
  sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,scan_started_at,scan_pages,next_due_at,status) VALUES('timed:iaai','iaai','expired',?,12,?,'partial')")
    .run(at(NOW-HORIZON),OLD);
  const p=provider(spec=>{assert.equal(spec.params.cursor,undefined);return page(spec.params,[]);});
  const report=await run(db,p);assert.equal(report.ok,true);assert.equal(report.timed.restarted,1);
  assert.equal(task(sqlite,"timed:iaai").scan_pages,1);assert.equal(task(sqlite,"timed:iaai").cursor,null);sqlite.close();
});

test("SQL safety threshold makes no provider call when a full page cannot fit",async()=>{
  let requested=0,saved=0;
  const report=await processTimedRefresh({store:{task:async()=>null},adapter,request:async()=>{requested++;},saveRecord:async()=>{saved++;},now:()=>NOW,
    queryBudget:{used:371,limit:970},canRequest:()=>true});
  assert.equal(report.stopReason,"sql_reserve");assert.equal(requested,0);assert.equal(saved,0);
});

test("reserved request also applies to retry, and a provider failure does not become an empty scan",async()=>{
  const {db,sqlite}=database();skipTimed(sqlite,"copart");
  const p=provider(()=>{throw Object.assign(Error("timeout"),{code:"TIMEOUT",status:504});});
  const report=await run(db,p,{REXBID_AUTO_REFRESH_MAX_PER_RUN:"2"});
  assert.equal(report.attempts,1);assert.equal(report.retries,0);assert.equal(report.stopReason,"TIMEOUT");
  assert.equal(task(sqlite,"timed:iaai").status,"error");assert.equal(task(sqlite,"timed:iaai").last_success_at,null);sqlite.close();
});

test("write failure stops transport and leaves the main Timed cursor unadvanced",async()=>{
  const {db,sqlite}=database();skipTimed(sqlite,"copart");
  sqlite.exec("CREATE TRIGGER reject_timed_insert BEFORE INSERT ON auction_listings BEGIN SELECT RAISE(ABORT,'simulated write failure'); END;");
  const p=provider(spec=>page(spec.params,[raw()],"should-not-save",2));
  const report=await run(db,p);assert.equal(report.ok,false);assert.equal(report.stopReason,"AUTOMATIC_REFRESH_WRITE_FAILED");
  assert.equal(report.attempts,1);assert.equal(task(sqlite,"timed:iaai"),undefined);
  assert.equal(sqlite.prepare("SELECT blocked_reason FROM automatic_refresh_state").get().blocked_reason,"AUTOMATIC_REFRESH_WRITE_FAILED");sqlite.close();
});

test("disabled Timed flag preserves legacy discovery and creates no Timed cursor",async()=>{
  const {db,sqlite}=database();sqlite.prepare("DELETE FROM automatic_refresh_tasks").run();
  const p=provider(spec=>{assert.equal(spec.params.lot_status,undefined);return {ok:true,data:[],meta:{next_cursor:null}};});
  const report=await run(db,p,{REXBID_AUTO_REFRESH_TIMED_ENABLED:"disabled"});assert.equal(report.ok,true);
  assert.equal(report.timed,undefined);assert.equal(report.listPages,2);assert.equal(task(sqlite,"timed:iaai"),undefined);sqlite.close();
});
