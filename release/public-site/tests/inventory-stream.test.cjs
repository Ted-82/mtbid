"use strict";

const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), {DatabaseSync} = require("node:sqlite");
const {createApibaraProvider} = require("../providers/apibara.js");
const {RefreshStore} = require("../sync/automatic-refresh.cjs");
const {prepareInventoryPage} = require("../sync/inventory-page.cjs");
const {commitInventoryBatch} = require("../sync/inventory-commit.cjs");
const {processInventoryChanges} = require("../sync/inventory-stream.cjs");

const NOW = Date.parse("2026-10-26T12:00:00.000Z"), OLD = "2026-10-25T12:00:00.000Z";
const RECEIVED = "2026-10-26T11:59:59.000Z", EVENT_AT = "2026-10-26T11:59:00.000Z";
const VIN = "1HGCM82633A004352", LOT = "10000001";
const policy = {hotIntervalMs: 3600000, warmIntervalMs: 86400000, coldIntervalMs: 604800000, hotWindowMs: 3600000};
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/apibara-discovery-page-shape.json"), "utf8")).response.data[0];
const adapter = createApibaraProvider({fetch: async () => {throw Error("NETWORK_FORBIDDEN");}});

function database() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["0004_d1_sync_2.sql", "0008_automatic_refresh.sql"]) {
    sqlite.exec(fs.readFileSync(path.join(__dirname, "../docs/proposals", file), "utf8"));
  }
  const calls = {reads: [], batches: [], beforeBatch: null};
  const db = {prepare(sql) {return {bind(...params) {return {sql, params,
    async all() {calls.reads.push({sql, params}); return {results: sqlite.prepare(sql).all(...params)};},
    async first() {calls.reads.push({sql, params}); return sqlite.prepare(sql).get(...params) || null;},
    async run() {return {meta: {changes: Number(sqlite.prepare(sql).run(...params).changes)}};}
  };}};}, async batch(statements) {
    calls.batches.push(statements);
    if (calls.beforeBatch) await calls.beforeBatch(statements);
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = statements.map(item => /^\s*SELECT/i.test(item.sql)
        ? {results: sqlite.prepare(item.sql).all(...item.params)}
        : {meta: {changes: Number(sqlite.prepare(item.sql).run(...item.params).changes)}});
      sqlite.exec("COMMIT"); return result;
    } catch (error) {sqlite.exec("ROLLBACK"); throw error;}
  }};
  const store = new RefreshStore(db, "inventory-stream-test", () => NOW);
  return {db, sqlite, store, calls};
}
function raw(platform = "copart", lot = LOT, bid = 100) {
  const value = structuredClone(fixture);
  value.platform = platform; value.lot_number = lot; value.vehicle_id = `${platform}-${lot}`;
  value.vin = VIN; value.pricing.current_bid_usd = bid; return value;
}
async function setup(records = [raw()], cursor = "0") {
  const context = database(), {db, sqlite, store, calls} = context;
  assert.equal(await store.acquire(), true);
  for (let index = 0; index < records.length; index += 20) {
    const result = await prepareInventoryPage({db, provider: adapter, records: records.slice(index, index + 20),
      observedAt: OLD, processedAt: new Date(NOW).toISOString(), freshnessPolicy: policy});
    assert.deepEqual(result.rejected, []); assert.deepEqual(result.skipped, []);
    await commitInventoryBatch({db, store, prepared: result.prepared});
  }
  if (cursor !== null) sqlite.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status)
    VALUES('stream:changes','all',?,?,'catching_up')`).run(cursor, OLD);
  calls.reads.length = 0; calls.batches.length = 0; return context;
}
function event(sequence = 1, patch = {}) {
  return {sequence, event_id: `chg_${sequence}`, event: "bid.changed", terminal: false,
    vehicle: {platform: "copart", lot_number: LOT, vin: VIN}, changed_fields: ["pricing.current_bid_usd"],
    before: {}, after: {"pricing.current_bid_usd": sequence + 100},
    recorded_at: EVENT_AT, vehicle_updated_at: EVENT_AT, ...patch};
}
function response(events, after = 0, meta = {}) {
  const next = events.at(-1)?.sequence ?? after;
  return {ok: true, data: events, meta: {after, next_cursor: next, has_more: false, count: events.length,
    ordering: "sequence_asc", schema_version: "2026-10-04.beta1", retention_days: 14,
    oldest_available_sequence: 1, latest_available_sequence: Math.max(next, 1), ...meta}};
}
function transport(responses) {
  const specs = [], request = async spec => {
    specs.push(spec); const value = responses.shift();
    if (value instanceof Error) throw value;
    assert.ok(value, "unexpected provider request"); return {response: value, observedAt: RECEIVED};
  };
  return {request, specs};
}
const task = sqlite => sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key='stream:changes'").get();
const listing = (sqlite, lot = LOT, platform = "copart") => sqlite.prepare("SELECT * FROM auction_listings WHERE platform=? AND lot=?").get(platform, lot);
const queue = sqlite => sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key LIKE 'reconcile:%' ORDER BY task_key").all();
const patches = statements => statements.some(item => /UPDATE auction_listings SET/.test(item.sql));
const run = (context, request, options = {}) => processInventoryChanges({db: context.db, store: context.store,
  adapter, request, now: () => NOW, ...options});
function assertClean(sqlite) {
  for (const table of ["sync_batch_guards", "automatic_refresh_guards"]) assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
}

test("a repeated change preserves a failed detail's future retry delay and error code", async()=>{
  for(const [error,hours] of [["NOT_FOUND",168],["TIMEOUT",1]]) {
    const context=await setup(), {sqlite}=context, row=listing(sqlite);
    const due=new Date(NOW+hours*3600000).toISOString();
    sqlite.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor,next_due_at,last_attempt_at,status,failures,last_error_code)
      VALUES(?,?,?,?,?,?,'pending',1,?)`).run(`reconcile:copart:${LOT}`,"copart",row.listing_id,LOT,due,OLD,error);
    const call=transport([response([event(1,{changed_fields:["make"],after:{make:"Changed"}})])]);
    const result=await run(context,call.request), job=queue(sqlite)[0];
    assert.equal(result.queued,1);assert.equal(job.status,"pending");assert.equal(job.next_due_at,due);
    assert.equal(job.last_error_code,error);assert.equal(job.failures,1);assertClean(sqlite);sqlite.close();
  }
});

test("a repeated change can requeue an expired delay or a completed detail without retaining old error",async()=>{
  for(const status of ["pending","complete"]) {
    const context=await setup(),{sqlite}=context,row=listing(sqlite);
    sqlite.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor,next_due_at,last_attempt_at,status,failures,last_error_code)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(`reconcile:copart:${LOT}`,"copart",row.listing_id,LOT,
        status==="complete"?new Date(NOW+86400000).toISOString():OLD,OLD,status,status==="pending"?1:0,status==="pending"?"NOT_FOUND":null);
    await run(context,transport([response([event(1,{changed_fields:["make"],after:{make:"Changed"}})])]).request);
    const job=queue(sqlite)[0];assert.equal(job.status,"pending");assert.equal(job.next_due_at,new Date(NOW).toISOString());
    assert.equal(job.last_error_code,null);assertClean(sqlite);sqlite.close();
  }
});

test("unseeded stream is disabled without transport, lease or cursor invention", async () => {
  const context = await setup([], null), {sqlite, db, calls} = context;
  const result = await processInventoryChanges({db});
  assert.equal(result.disabled, true); assert.equal(result.cursor, null); assert.equal(task(sqlite), undefined);
  assert.equal(calls.batches.length, 0); sqlite.close();
});

test("invalid cursor and non-global checkpoints fail before provider calls", async () => {
  for (const cursor of ["bad", "-1", "1.5", "01", "9007199254740992"]) {
    const context = await setup([], cursor), call = transport([]);
    await assert.rejects(run(context, call.request), /INVENTORY_STREAM_CHECKPOINT_INVALID/);
    assert.equal(call.specs.length, 0); context.sqlite.close();
  }
  const context = await setup([]), call = transport([]);
  context.sqlite.exec("UPDATE automatic_refresh_tasks SET platform='copart'");
  await assert.rejects(run(context, call.request), /INVENTORY_STREAM_CHECKPOINT_INVALID/);
  assert.equal(call.specs.length, 0); context.sqlite.close();
});

test("sequential zero/null patches use one lookup, preserve snapshots and all full-record freshness", async () => {
  const context = await setup(), {sqlite, calls} = context;
  const before = listing(sqlite), snapshots = sqlite.prepare("SELECT * FROM auction_listing_snapshots").all();
  const call = transport([response([
    event(1, {after: {"pricing.current_bid_usd": 0}}),
    event(2, {changed_fields: ["pricing.buy_now_usd"], after: {"pricing.buy_now_usd": null}}),
    event(3, {after: {"pricing.current_bid_usd": 25}})
  ], 0, {next_cursor: 8, latest_available_sequence: 8})]);
  const result = await run(context, call.request);
  assert.deepEqual(result, {pages: 1, events: 3, patched: 3, queued: 0, ignored: 0, cursor: 8, latest: 8, hasMore: false});
  assert.deepEqual({...listing(sqlite)}, {...before, current_bid_usd: 25, buy_now_usd: null});
  assert.deepEqual(sqlite.prepare("SELECT * FROM auction_listing_snapshots").all(), snapshots);
  assert.deepEqual(call.specs, [{operation: "vehicleChanges", after: 0, limit: 500}]);
  assert.equal(calls.reads.filter(call => call.sql.includes("FROM auction_listings")).length, 1);
  assert.equal(calls.batches.flat().filter(statement => /UPDATE auction_listings SET/.test(statement.sql)).length, 1);
  assert.equal(task(sqlite).cursor, "8"); assert.equal(task(sqlite).status, "complete");
  assert.equal(task(sqlite).last_success_at, RECEIVED); assert.equal(task(sqlite).scan_pages, 1);
  assertClean(sqlite); sqlite.close();
});

test("forty bids for one LOT commit only its final value once with the checkpoint", async () => {
  const context=await setup(),{sqlite,calls}=context;
  const events=Array.from({length:40},(_,i)=>event(i+1));
  const result=await run(context,transport([response(events)]).request);
  assert.equal(result.patched,40);assert.equal(listing(sqlite).current_bid_usd,140);
  assert.equal(calls.batches.flat().filter(statement=>/UPDATE auction_listings SET/.test(statement.sql)).length,1);
  assert.equal(task(sqlite).cursor,'40');assertClean(sqlite);sqlite.close();
});

test("a price returning to its baseline performs no listing write but still fences the original row", async () => {
  const context=await setup(),{sqlite,calls}=context,before=listing(sqlite);
  const events=[event(1),event(2,{after:{'pricing.current_bid_usd':before.current_bid_usd}})];
  const result=await run(context,transport([response(events)]).request);
  assert.equal(result.patched,2);assert.deepEqual(listing(sqlite),before);
  assert.equal(calls.batches.flat().filter(statement=>/UPDATE auction_listings SET/.test(statement.sql)).length,0);
  assert.equal(task(sqlite).cursor,'2');assertClean(sqlite);sqlite.close();
});

test("a concurrent price change still rejects a coalesced net-zero batch without advancing its cursor", async () => {
  const context=await setup(),{sqlite,calls}=context,before=listing(sqlite);
  calls.beforeBatch=statements=>{
    if(statements.some(item=>/INSERT INTO sync_batch_guards/.test(item.sql))){calls.beforeBatch=null;sqlite.exec('UPDATE auction_listings SET current_bid_usd=999');}
  };
  const events=[event(1),event(2,{after:{'pricing.current_bid_usd':before.current_bid_usd}})];
  await assert.rejects(run(context,transport([response(events)]).request),/AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(listing(sqlite).current_bid_usd,999);assert.equal(task(sqlite).cursor,'0');assertClean(sqlite);sqlite.close();
});

test("platform and LOT matching cannot cross-update the same LOT on another platform", async () => {
  const context = await setup([raw(), raw("iaai")]), {sqlite} = context;
  const call = transport([response([event(1), event(2, {vehicle: {platform: "iaai", lot_number: LOT, vin: VIN}})])]);
  assert.equal((await run(context, call.request)).patched, 2);
  assert.equal(listing(sqlite).current_bid_usd, 101); assert.equal(listing(sqlite, LOT, "iaai").current_bid_usd, 102);
  assertClean(sqlite); sqlite.close();
});

test("unknown nonterminal queues durable detail; unknown terminal never creates a partial vehicle", async () => {
  const context = await setup([]), {sqlite} = context;
  const call = transport([response([event(1), event(2, {event: "lot.sold", terminal: true,
    vehicle: {platform: "iaai", lot_number: "99999999", vin: VIN}, changed_fields: [], after: {}})])]);
  const result = await run(context, call.request);
  assert.equal(result.queued, 1); assert.equal(result.ignored, 1); assert.equal(result.patched, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_listings").get().n, 0);
  assert.equal(queue(sqlite).length, 1); assert.equal(queue(sqlite)[0].task_key, `reconcile:copart:${LOT}`);
  assert.equal(queue(sqlite)[0].listing_id, null); assert.equal(queue(sqlite)[0].cursor, LOT);
  assert.equal(queue(sqlite)[0].status, "pending"); assert.equal(task(sqlite).cursor, "2");
  assertClean(sqlite); sqlite.close();
});

test("unsupported companion fields queue detail atomically with the supported patch", async () => {
  const context = await setup(), {sqlite} = context;
  const call = transport([response([event(1, {changed_fields: ["make", "pricing.current_bid_usd"],
    after: {make: "BMW", "pricing.current_bid_usd": 450}})])]);
  const before = listing(sqlite), result = await run(context, call.request);
  assert.equal(result.patched, 1); assert.equal(result.queued, 1);
  assert.equal(listing(sqlite).make, before.make); assert.equal(listing(sqlite).current_bid_usd, 450);
  assert.equal(queue(sqlite)[0].listing_id, before.listing_id); assert.equal(task(sqlite).cursor, "1");
  assertClean(sqlite); sqlite.close();
});

test("VIN conflict is isolated in a durable safe-code error task without blocking valid companion lots", async () => {
  const context = await setup([raw(), raw("iaai", "20000002")]), {sqlite} = context;
  const before = listing(sqlite), call = transport([response([
    event(1, {vehicle: {platform: "copart", lot_number: LOT, vin: "3NSNAE927LF797453"}}),
    event(2, {vehicle: {platform: "iaai", lot_number: "20000002", vin: VIN}})
  ])]);
  const result = await run(context, call.request);
  assert.equal(result.queued, 1); assert.equal(result.patched, 1); assert.deepEqual(listing(sqlite), before);
  assert.equal(queue(sqlite)[0].status, "identity_error");
  assert.equal(queue(sqlite)[0].last_error_code, "INVENTORY_CHANGE_IDENTITY_CONFLICT");
  assert.equal(task(sqlite).scan_errors, 1); assert.equal(task(sqlite).cursor, "2");
  assertClean(sqlite); sqlite.close();
});

test("known terminal state clears active actions without inventing a final sale price", async () => {
  const context = await setup(), {sqlite} = context;
  const before = listing(sqlite), call = transport([response([event(1, {event: "lot.sold", terminal: true, changed_fields: [], after: {}})])]);
  assert.equal((await run(context, call.request)).patched, 1);
  assert.deepEqual({...listing(sqlite)}, {...before, auction_state: "ended", source_status: "Sold",
    auction_at: null, timed_end_at: null, is_timed: 0, buy_now_usd: null});
  assertClean(sqlite); sqlite.close();
});

test("explicit malformed VIN is quarantined but an omitted VIN preserves the established platform/LOT identity", async () => {
  for (const vin of ["MASKED************", null]) {
    const context = await setup(), {sqlite} = context;
    const call = transport([response([event(1, {vehicle: {platform: "copart", lot_number: LOT, vin}})])]);
    const result = await run(context, call.request);
    assert.equal(result.patched, vin === null ? 1 : 0);
    assert.equal(result.queued, vin === null ? 0 : 1);
    assert.equal(listing(sqlite).current_bid_usd, vin === null ? 101 : 100);
    if (vin !== null) assert.equal(queue(sqlite)[0].status, "identity_error");
    assert.equal(task(sqlite).cursor, "1"); assertClean(sqlite); sqlite.close();
  }
});

test("old events and nonpersistent previous-bid metadata advance only the stream checkpoint", async () => {
  const context = await setup(), {sqlite} = context;
  const before = listing(sqlite), call = transport([response([
    event(1, {recorded_at: OLD, vehicle_updated_at: OLD}),
    event(2, {changed_fields: ["pricing.previous_bid_usd"], after: {"pricing.previous_bid_usd": 123}})
  ])]);
  const result = await run(context, call.request);
  assert.equal(result.ignored, 2); assert.equal(result.queued, 0); assert.equal(result.patched, 0);
  assert.deepEqual(listing(sqlite), before); assert.equal(task(sqlite).cursor, "2"); assertClean(sqlite); sqlite.close();
});

test("empty advancing responses and multiple request pages preserve numeric sequence checkpoints", async () => {
  const context = await setup(), {sqlite} = context;
  const call = transport([response([], 0, {next_cursor: 50, latest_available_sequence: 100, has_more: true}),
    response([event(90)], 50, {next_cursor: 100, latest_available_sequence: 100})]);
  const result = await run(context, call.request, {maxPages: 2});
  assert.equal(result.pages, 2); assert.equal(result.events, 1); assert.equal(result.cursor, 100);
  assert.deepEqual(call.specs.map(spec => spec.after), [0, 50]); assert.equal(task(sqlite).scan_pages, 2);
  assertClean(sqlite); sqlite.close();
});

test("crash after the first chunk replays from committed sequence and never double-applies earlier changes", async () => {
  const context = await setup(), {sqlite, calls} = context;
  const events = Array.from({length: 85}, (_, index) => event(index + 1));
  let chunk = 0;
  calls.beforeBatch = statements => {if (patches(statements) && ++chunk === 2) throw Error("SIMULATED_CRASH");};
  await assert.rejects(run(context, transport([response(events)]).request), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(task(sqlite).cursor, "40"); assert.equal(task(sqlite).scan_pages, 0);
  assert.equal(task(sqlite).status, "catching_up"); assert.equal(listing(sqlite).current_bid_usd, 140);
  calls.beforeBatch = null;
  const retry = transport([response(events.slice(40), 40)]), result = await run(context, retry.request);
  assert.equal(retry.specs[0].after, 40); assert.equal(result.events, 45); assert.equal(result.patched, 45);
  assert.equal(task(sqlite).cursor, "85"); assert.equal(task(sqlite).scan_pages, 1);
  assert.equal(listing(sqlite).current_bid_usd, 185); assertClean(sqlite); sqlite.close();
});

test("a racing row writer aborts the entire chunk and keeps its independent newer state", async () => {
  const context = await setup(), {sqlite, calls} = context;
  calls.beforeBatch = statements => {
    if (patches(statements)) {
      calls.beforeBatch = null; sqlite.prepare("UPDATE auction_listings SET current_bid_usd=999 WHERE lot=?").run(LOT);
    }
  };
  const call = transport([response([event(1), event(2, {vehicle: {platform: "iaai", lot_number: "20000002", vin: VIN}})])]);
  await assert.rejects(run(context, call.request), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(listing(sqlite).current_bid_usd, 999); assert.equal(task(sqlite).cursor, "0");
  assert.equal(queue(sqlite).length, 0); assertClean(sqlite); sqlite.close();
});

test("cursor CAS prevents a concurrent checkpoint advance from being overwritten", async () => {
  const context = await setup(), {sqlite, calls} = context;
  calls.beforeBatch = statements => {
    if (patches(statements)) {
      calls.beforeBatch = null; sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='77' WHERE task_key='stream:changes'");
    }
  };
  await assert.rejects(run(context, transport([response([event(1)])]).request), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(task(sqlite).cursor, "77"); assert.equal(listing(sqlite).current_bid_usd, 100);
  assertClean(sqlite); sqlite.close();
});

test("one initial-row guard fences every critical timestamp, identity, price and auction-state baseline", async () => {
  const fields = ["vin_normalized", "identity_state", "source_updated_at", "summary_synced_at", "detail_synced_at",
    "last_seen_at", "updated_at", "auction_state", "source_status", "auction_at", "is_timed", "timed_end_at",
    "current_bid_usd", "current_bid2_usd", "buy_now_usd"];
  for (const field of fields) {
    const context = await setup(), {sqlite, calls} = context;
    const changed = field === "identity_state" ? "ambiguous" : field === "is_timed" ? 1
      : ["current_bid_usd", "current_bid2_usd", "buy_now_usd"].includes(field) ? 999 : "changed-baseline";
    calls.beforeBatch = statements => {
      if (patches(statements)) {
        calls.beforeBatch = null; sqlite.prepare(`UPDATE auction_listings SET ${field}=? WHERE lot=?`).run(changed, LOT);
      }
    };
    await assert.rejects(run(context, transport([response([event(1), event(2)])]).request), /AUTOMATIC_REFRESH_WRITE_FAILED/);
    assert.equal(task(sqlite).cursor, "0"); assert.equal(listing(sqlite)[field], changed);
    if (field !== "current_bid_usd") assert.equal(listing(sqlite).current_bid_usd, 100);
    assertClean(sqlite); sqlite.close();
  }
});

test("lost lease blocks patch and cursor together and initial expired lease blocks the provider call", async () => {
  for (const beforeRequest of [false, true]) {
    const context = await setup(), {sqlite, calls} = context, call = transport([response([event(1)])]);
    if (beforeRequest) sqlite.prepare("UPDATE automatic_refresh_state SET lease_until=?").run(new Date(NOW).toISOString());
    else calls.beforeBatch = statements => {
      if (patches(statements)) {calls.beforeBatch = null; sqlite.exec("UPDATE automatic_refresh_state SET lease_owner='another-owner'");}
    };
    await assert.rejects(run(context, call.request), /AUTOMATIC_REFRESH_WRITE_FAILED/);
    assert.equal(call.specs.length, beforeRequest ? 0 : 1); assert.equal(task(sqlite).cursor, "0");
    assert.equal(listing(sqlite).current_bid_usd, 100); assertClean(sqlite); sqlite.close();
  }
});

test("checkpoint write failure rolls back earlier patches and reconciliation queue writes", async () => {
  const context = await setup(), {sqlite} = context;
  sqlite.exec(`CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF cursor ON automatic_refresh_tasks
    WHEN NEW.task_key='stream:changes' BEGIN SELECT RAISE(ABORT,'checkpoint rejected'); END`);
  const call = transport([response([event(1, {changed_fields: ["make", "pricing.current_bid_usd"],
    after: {make: "BMW", "pricing.current_bid_usd": 450}})])]);
  await assert.rejects(run(context, call.request), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(listing(sqlite).current_bid_usd, 100); assert.equal(task(sqlite).cursor, "0");
  assert.equal(queue(sqlite).length, 0); assertClean(sqlite); sqlite.close();
});

test("expired provider cursor requires bootstrap without resetting or re-requesting the stream", async () => {
  const context = await setup([], "1234"), {sqlite} = context;
  const error = Object.assign(Error("expired"), {code: "CURSOR_EXPIRED"}), call = transport([error]);
  const result = await run(context, call.request);
  assert.equal(result.rebootstrapRequired, true); assert.equal(task(sqlite).cursor, "1234");
  assert.equal(task(sqlite).status, "rebootstrap_required"); assert.equal(task(sqlite).last_error_code, "CURSOR_EXPIRED");
  assert.equal(task(sqlite).failures, 1); assert.equal(task(sqlite).last_success_at, null);
  assert.equal((await run(context, call.request)).rebootstrapRequired, true); assert.equal(call.specs.length, 1);
  assertClean(sqlite); sqlite.close();
});

test("500 changes remain under per-batch statement and lookup binding limits", async () => {
  const records = Array.from({length: 40}, (_, index) => raw("copart", String(10000001 + index)));
  const context = await setup(records), {sqlite, calls} = context;
  const events = Array.from({length: 500}, (_, index) => event(index + 1, {
    vehicle: {platform: "copart", lot_number: String(10000001 + index % 40), vin: VIN},
    changed_fields: ["make", "pricing.current_bid_usd"], after: {make: "BMW", "pricing.current_bid_usd": index + 101}
  }));
  const result = await run(context, transport([response(events)]).request);
  assert.equal(result.patched, 500); assert.equal(result.queued, 500); assert.equal(task(sqlite).cursor, "500");
  const lookups = calls.reads.filter(call => call.sql.includes("FROM auction_listings"));
  assert.equal(lookups.length, 13); assert.ok(lookups.every(call => call.params.length <= 80));
  assert.ok(calls.batches.every(batch => batch.length <= 47));
  // Includes lease guards, queue writes, checkpoints, SELECTs and cleanups.
  // This is the worst case: all 500 events both patch and enqueue detail.
  assert.equal(calls.batches.reduce((total, batch) => total + batch.length, 0) + calls.reads.length, 608);
  assert.ok(calls.batches.flat().every(statement => statement.params.length <= 100));
  assert.equal(queue(sqlite).length, 40); assertClean(sqlite); sqlite.close();
});

test("invalid response, future observation and unsafe LOT do not advance cursor or mutate vehicles", async () => {
  for (const mode of ["duplicate", "unordered", "future", "unsafe-lot"]) {
    const context = await setup(), {sqlite} = context, before = listing(sqlite);
    const events = mode === "duplicate" ? [event(1), event(1)] : mode === "unordered" ? [event(2), event(1)] : [event(1)];
    if (mode === "unsafe-lot") events[0].vehicle.lot_number = "bad/lot";
    const request = async () => ({response: response(events), observedAt: mode === "future" ? "2026-10-27T12:00:00.000Z" : RECEIVED});
    await assert.rejects(run(context, request)); assert.deepEqual(listing(sqlite), before);
    assert.equal(task(sqlite).cursor, "0"); assert.equal(queue(sqlite).length, 0); assertClean(sqlite); sqlite.close();
  }
});
