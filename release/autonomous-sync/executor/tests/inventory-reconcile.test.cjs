"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), {DatabaseSync} = require("node:sqlite");
const {createApibaraProvider} = require("../providers/apibara.js");
const {D1SyncRepository} = require("../sync/d1-repository.js");
const {RefreshStore, saveAutomaticObservation} = require("../sync/automatic-refresh.cjs");
const {prepareInventoryPage} = require("../sync/inventory-page.cjs");
const {commitInventoryBatch} = require("../sync/inventory-commit.cjs");
const {processInventoryReconciliation} = require("../sync/inventory-reconcile.cjs");
const NOW = Date.parse("2026-10-26T12:00:00.000Z"), OLD = "2026-10-25T12:00:00.000Z", RECEIVED = "2026-10-26T11:59:59.000Z";
const VIN = "1HGCM82633A004352", LOT = "10000001";
const policy = {hotIntervalMs: 3600000, warmIntervalMs: 86400000, coldIntervalMs: 604800000, hotWindowMs: 3600000};
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/apibara-discovery-page-shape.json"), "utf8")).response.data[0];
const adapter = createApibaraProvider({fetch: async () => {throw Error("NETWORK_FORBIDDEN");}});
function raw(platform = "copart", lot = LOT, bid = 100) {
  const value = structuredClone(fixture); value.platform = platform; value.lot_number = lot;
  value.vehicle_id = `${platform}-${lot}`; value.vin = VIN; value.pricing.current_bid_usd = bid; return value;
}
async function setup(records = []) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["0004_d1_sync_2.sql", "0008_automatic_refresh.sql"]) sqlite.exec(fs.readFileSync(path.join(__dirname, "../docs/proposals", file), "utf8"));
  const calls = {beforeBatch: null, reads: 0, batches: []};
  const db = {prepare(sql) {return {bind(...params) {return {sql, params,
    async all() {calls.reads++; return {results: sqlite.prepare(sql).all(...params)};},
    async first() {calls.reads++; return sqlite.prepare(sql).get(...params) || null;},
    async run() {return {meta: {changes: Number(sqlite.prepare(sql).run(...params).changes)}};}
  };}};}, async batch(statements) {
    calls.batches.push(statements); if (calls.beforeBatch) await calls.beforeBatch(statements);
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(item => /^\s*SELECT/i.test(item.sql)
        ? {results: sqlite.prepare(item.sql).all(...item.params)}
        : {meta: {changes: Number(sqlite.prepare(item.sql).run(...item.params).changes)}});
      sqlite.exec("COMMIT"); return results;
    } catch (error) {sqlite.exec("ROLLBACK"); throw error;}
  }};
  const store = new RefreshStore(db, "reconcile-test", () => NOW), repo = new D1SyncRepository(db);
  await store.acquire(); await store.initializeBudgets({daily: 100, monthly: 30000, newPerDay: 2000});
  if (records.length) {
    const result = await prepareInventoryPage({db, provider: adapter, records, observedAt: OLD,
      processedAt: new Date(NOW).toISOString(), freshnessPolicy: policy});
    assert.deepEqual(result.rejected, []); await commitInventoryBatch({db, store, prepared: result.prepared});
  }
  const saveReport = {skipped: 0, inserted: 0, updated: 0};
  const saveRecord = (...args) => saveAutomaticObservation({store, repo, adapter, db, report: saveReport, now: () => NOW}, ...args);
  calls.reads = 0; calls.batches.length = 0;
  return {db, sqlite, store, repo, calls, saveReport, saveRecord};
}
function enqueue(sqlite, platform = "copart", lot = LOT, status = "pending", listingId = null) {
  sqlite.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor,next_due_at,last_attempt_at,status)
    VALUES(?,?,?,?,?,?,?)`).run(`reconcile:${platform}:${lot}`, platform, listingId, lot, OLD, OLD, status);
}
const task = (sqlite, platform = "copart", lot = LOT) => sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key=?").get(`reconcile:${platform}:${lot}`);
const listing = (sqlite, platform = "copart", lot = LOT) => sqlite.prepare("SELECT * FROM auction_listings WHERE platform=? AND lot=?").get(platform, lot);
const run = (context, request, extra = {}) => processInventoryReconciliation({...context, adapter, request, now: () => NOW, ...extra});
function transport(records) {
  const specs = [], request = async (spec, listingId) => {
    specs.push({spec, listingId}); const record = records.shift();
    if (record instanceof Error) throw record;
    assert.ok(record, "unexpected provider call"); return {response: {ok: true, data: record}, observedAt: RECEIVED};
  }; return {request, specs};
}
function clean(sqlite) {
  for (const table of ["sync_batch_guards", "automatic_refresh_guards"]) assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
}

test("only due pending tasks run, at most two detail calls, with zero-budget no reads", async () => {
  const context = await setup(), {sqlite, calls} = context;
  enqueue(sqlite, "copart", LOT, "identity_error"); enqueue(sqlite, "copart", "10000002", "complete");
  enqueue(sqlite, "copart", "10000003"); sqlite.prepare("UPDATE automatic_refresh_tasks SET next_due_at=? WHERE cursor='10000003'").run("2026-10-27T00:00:00Z");
  const none = transport([]); assert.equal((await run(context, none.request)).attempted, 0);
  calls.reads = 0; await run(context, none.request, {maxRequests: 0}); assert.equal(calls.reads, 0);
  for (const lot of ["10000004", "10000005", "10000006"]) enqueue(sqlite, "copart", lot);
  const call = transport([raw("copart", "10000004"), raw("copart", "10000005")]);
  const result = await run(context, call.request); assert.equal(result.attempted, 2); assert.equal(result.completed, 2);
  assert.equal(task(sqlite, "copart", "10000006").status, "pending");
  assert.equal(task(sqlite).status, "identity_error"); clean(sqlite); sqlite.close();
});

test("unknown LOT detail creates a full listing and commits its linked completion checkpoint atomically", async () => {
  const context = await setup(), {sqlite, saveReport} = context; enqueue(sqlite);
  const call = transport([raw("copart", LOT, 0)]), result = await run(context, call.request);
  assert.deepEqual(result, {attempted: 1, completed: 1, deferred: 0, failed: 0, identityErrors: 0});
  assert.deepEqual(call.specs, [{spec: {operation: "vehicleByIdentifier", identifier: LOT, platform: "copart"}, listingId: null}]);
  assert.equal(saveReport.inserted, 1); assert.equal(listing(sqlite).current_bid_usd, 0);
  assert.equal(listing(sqlite).summary_synced_at, RECEIVED); assert.equal(listing(sqlite).detail_synced_at, RECEIVED);
  assert.equal(task(sqlite).listing_id, listing(sqlite).listing_id);
  assert.equal(task(sqlite).status, "complete"); assert.equal(task(sqlite).last_success_at, RECEIVED);
  assert.equal(task(sqlite).cursor, LOT); clean(sqlite); sqlite.close();
});

test("known LOT uses its source identifier and preserves old snapshot while marking actual detail receipt", async () => {
  const context = await setup([raw()]), {sqlite, saveReport} = context, before = listing(sqlite);
  enqueue(sqlite, "copart", LOT, "pending", before.listing_id);
  const call = transport([raw("copart", LOT, 250)]); assert.equal((await run(context, call.request)).completed, 1);
  assert.equal(call.specs[0].spec.identifier, `copart-${LOT}`); assert.equal(call.specs[0].listingId, before.listing_id);
  assert.equal(saveReport.updated, 1); assert.equal(listing(sqlite).detail_synced_at, RECEIVED);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_listing_snapshots").get().n, 2);
  assert.equal(task(sqlite).last_success_at, RECEIVED); clean(sqlite); sqlite.close();
});

test("wrong platform, wrong LOT or conflicting VIN quarantines only that task", async () => {
  for (const bad of [raw("iaai"), raw("copart", "99999999"), {...raw(), vin: "3NSNAE927LF797453"}]) {
    const context = await setup([raw()]), {sqlite} = context, before = listing(sqlite);
    enqueue(sqlite, "copart", LOT, "pending", before.listing_id); enqueue(sqlite, "iaai", "20000002");
    const call = transport([bad, raw("iaai", "20000002")]), result = await run(context, call.request);
    assert.equal(result.identityErrors, 1); assert.equal(result.completed, 1); assert.deepEqual(listing(sqlite), before);
    assert.equal(task(sqlite).status, "identity_error"); assert.equal(task(sqlite).last_success_at, null);
    assert.equal(task(sqlite).last_error_code, "INVENTORY_RECONCILE_IDENTITY_MISMATCH"); clean(sqlite); sqlite.close();
  }
});

test("404 keeps saved data, delays retry and never invents a terminal sale", async () => {
  const context = await setup([raw()]), {sqlite} = context, before = listing(sqlite); enqueue(sqlite);
  const call = transport([Object.assign(Error("missing"), {code: "NOT_FOUND"})]);
  const result = await run(context, call.request); assert.equal(result.failed, 1); assert.deepEqual(listing(sqlite), before);
  assert.equal(task(sqlite).status, "pending"); assert.equal(task(sqlite).last_success_at, null);
  assert.equal(task(sqlite).next_due_at, "2026-11-02T12:00:00.000Z"); clean(sqlite); sqlite.close();
});

test("new-listing admission budget defers reconciliation without a completed or fresh checkpoint", async () => {
  const context = await setup(), {sqlite, store} = context; enqueue(sqlite);
  sqlite.prepare("UPDATE automatic_refresh_budgets SET consumed=limit_count WHERE budget_key=?").run(store.keys[2]);
  const result = await run(context, transport([raw()]).request);
  assert.equal(result.deferred, 1); assert.equal(result.completed, 0); assert.equal(listing(sqlite), undefined);
  assert.equal(task(sqlite).status, "pending"); assert.equal(task(sqlite).last_success_at, null);
  assert.equal(task(sqlite).last_error_code, "INVENTORY_RECONCILE_DEFERRED"); clean(sqlite); sqlite.close();
});

test("older source snapshots remain untouched and cannot complete a reconciliation task", async () => {
  const context = await setup([raw()]), {sqlite} = context;
  sqlite.prepare("UPDATE auction_listings SET summary_synced_at=?,last_seen_at=?").run(new Date(NOW).toISOString(), new Date(NOW).toISOString());
  const before = listing(sqlite); enqueue(sqlite, "copart", LOT, "pending", before.listing_id);
  const result = await run(context, transport([raw("copart", LOT, 2)]).request);
  assert.equal(result.deferred, 1); assert.deepEqual(listing(sqlite), before); assert.equal(task(sqlite).last_success_at, null);
  clean(sqlite); sqlite.close();
});

test("failed checkpoint rolls back inserted vehicle, snapshot, budget and completion as one transaction", async () => {
  const context = await setup(), {sqlite, store} = context; enqueue(sqlite);
  const budget = sqlite.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?").get(store.keys[2]).consumed;
  sqlite.exec(`CREATE TRIGGER reject_reconcile BEFORE UPDATE OF status ON automatic_refresh_tasks
    WHEN NEW.status='complete' BEGIN SELECT RAISE(ABORT,'checkpoint fail'); END`);
  await assert.rejects(run(context, transport([raw()]).request), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(listing(sqlite), undefined); assert.equal(task(sqlite).status, "pending"); assert.equal(task(sqlite).last_success_at, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_listing_snapshots").get().n, 0);
  assert.equal(sqlite.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?").get(store.keys[2]).consumed, budget);
  clean(sqlite); sqlite.close();
});

test("racing queue state prevents vehicle writes and cannot be overwritten by a stale completion", async () => {
  const context = await setup(), {sqlite, calls} = context; enqueue(sqlite);
  calls.beforeBatch = statements => {
    if (statements.some(item => /INSERT INTO auction_listings/.test(item.sql))) {
      calls.beforeBatch = null; sqlite.prepare("UPDATE automatic_refresh_tasks SET last_attempt_at=? WHERE task_key=?").run(RECEIVED, `reconcile:copart:${LOT}`);
    }
  };
  await assert.rejects(run(context, transport([raw()]).request), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(listing(sqlite), undefined); assert.equal(task(sqlite).last_attempt_at, RECEIVED); assert.equal(task(sqlite).status, "pending");
  clean(sqlite); sqlite.close();
});

test("expired lease blocks before provider request and system budget stops do not alter pending work", async () => {
  for (const code of ["expired", "AUTOMATIC_REFRESH_RUN_LIMIT"]) {
    const context = await setup(), {sqlite} = context; enqueue(sqlite); const before = task(sqlite);
    const call = transport([Object.assign(Error(code), {code})]);
    if (code === "expired") sqlite.prepare("UPDATE automatic_refresh_state SET lease_until=?").run(new Date(NOW).toISOString());
    await assert.rejects(run(context, call.request), code === "expired" ? /AUTOMATIC_REFRESH_WRITE_FAILED/ : /AUTOMATIC_REFRESH_RUN_LIMIT/);
    assert.equal(call.specs.length, code === "expired" ? 0 : 1); assert.deepEqual(task(sqlite), before); clean(sqlite); sqlite.close();
  }
});

test("provider failure is retried only by the counted transport and stops this helper after its first failed task", async () => {
  const context = await setup(), {sqlite} = context; enqueue(sqlite); enqueue(sqlite, "iaai", "20000002");
  const call = transport([Object.assign(Error("outage"), {code: "UPSTREAM"})]);
  await assert.rejects(run(context, call.request), error => error.code === "UPSTREAM");
  assert.equal(call.specs.length, 1); assert.equal(task(sqlite).last_error_code, "UPSTREAM");
  assert.equal(task(sqlite).last_success_at, null); assert.equal(task(sqlite, "iaai", "20000002").last_error_code, null);
  clean(sqlite); sqlite.close();
});

test("future receipt or malformed task identity never writes a vehicle or successful checkpoint", async () => {
  const context = await setup(), {sqlite} = context; enqueue(sqlite);
  await assert.rejects(run(context, async () => ({response: {ok: true, data: raw()}, observedAt: "2026-10-27T00:00:00Z"})), /OBSERVATION_TIME_INVALID/);
  assert.equal(listing(sqlite), undefined); assert.equal(task(sqlite).last_success_at, null);
  sqlite.prepare("UPDATE automatic_refresh_tasks SET next_due_at=?,cursor='unsafe' WHERE task_key=?").run(OLD, `reconcile:copart:${LOT}`);
  const call = transport([]), result = await run(context, call.request);
  assert.equal(result.identityErrors, 1); assert.equal(call.specs.length, 0); assert.equal(task(sqlite).status, "identity_error");
  clean(sqlite); sqlite.close();
});
