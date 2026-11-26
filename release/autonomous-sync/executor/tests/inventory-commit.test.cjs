"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), {DatabaseSync} = require("node:sqlite");
const {createApibaraProvider} = require("../providers/apibara.js");
const {RefreshStore} = require("../sync/automatic-refresh.cjs");
const {prepareInventoryPage} = require("../sync/inventory-page.cjs");
const {commitInventoryBatch} = require("../sync/inventory-commit.cjs");

const NOW = Date.parse("2026-10-26T12:00:00.000Z"), OLD = "2026-10-25T12:00:00.000Z";
const CURRENT = "2026-10-26T11:59:00.000Z";
const policy = {hotIntervalMs: 3600000, warmIntervalMs: 86400000, coldIntervalMs: 604800000, hotWindowMs: 3600000};
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/apibara-discovery-page-shape.json"), "utf8")).response.data[0];
const adapter = createApibaraProvider({fetch: async () => {throw Error("NETWORK_FORBIDDEN");}});
function raw(platform = "copart", lot = "10000001", bid = 100) {
  const value = structuredClone(fixture);
  value.platform = platform; value.lot_number = lot; value.vehicle_id = `${platform}-${lot}`;
  value.vin = "1HGCM82633A004352"; value.pricing.current_bid_usd = bid;
  return value;
}
function database() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["0004_d1_sync_2.sql", "0008_automatic_refresh.sql"]) {
    sqlite.exec(fs.readFileSync(path.join(__dirname, "../docs/proposals", file), "utf8"));
  }
  const calls = {reads: 0, batches: []};
  const db = {prepare(sql) {return {bind(...params) {return {sql, params,
    async all() {calls.reads++; return {results: sqlite.prepare(sql).all(...params)};},
    async first() {calls.reads++; return sqlite.prepare(sql).get(...params) || null;},
    async run() {return {meta: {changes: Number(sqlite.prepare(sql).run(...params).changes)}};}
  };}};}, async batch(statements) {
    calls.batches.push(statements); sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(item => /^\s*SELECT/i.test(item.sql)
        ? {results: sqlite.prepare(item.sql).all(...item.params)}
        : {meta: {changes: Number(sqlite.prepare(item.sql).run(...item.params).changes)}});
      sqlite.exec("COMMIT"); return results;
    } catch (error) {sqlite.exec("ROLLBACK"); throw error;}
  }};
  const store = new RefreshStore(db, "inventory-commit-test", () => NOW);
  return {db, sqlite, store, calls};
}
async function prepared(db, records = [raw()], observedAt = CURRENT) {
  const result = await prepareInventoryPage({db, provider: adapter, records, observedAt,
    processedAt: new Date(NOW).toISOString(), freshnessPolicy: policy});
  assert.deepEqual(result.rejected, []); assert.deepEqual(result.skipped, []); return result.prepared;
}
const checkpoint = (db, cursor = "page-2") => db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at)
  VALUES('inventory:copart','copart',?,?) ON CONFLICT(task_key) DO UPDATE SET cursor=excluded.cursor`).bind(cursor, CURRENT);
const rows = (sqlite, table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const snapshot = sqlite => Object.fromEntries(["vehicle_sources", "auction_listings", "auction_listing_snapshots",
  "automatic_refresh_tasks", "sync_batch_guards", "automatic_refresh_guards"].map(table => [table, rows(sqlite, table)]));

test("atomic inventory insert preserves original capture times, zero prices and checkpoint; no readback requests", async () => {
  const {db, sqlite, store, calls} = database(); assert.equal(await store.acquire(), true);
  const values = await prepared(db, [raw("copart", "10000001", 0), raw("iaai", "20000002", 25)], OLD);
  calls.reads = 0;
  const result = await commitInventoryBatch({db, store, prepared: values, checkpointStatements: [checkpoint(db)]});
  assert.equal(result.committed, 2); assert.equal(result.inserted, 2); assert.equal(result.statementCount, 11);
  assert.equal(calls.batches.length, 1); assert.equal(calls.reads, 0);
  assert.deepEqual(rows(sqlite, "auction_listings").map(row => [row.summary_synced_at, row.current_bid_usd]), [[OLD, 0], [OLD, 25]]);
  assert.equal(rows(sqlite, "automatic_refresh_tasks")[0].cursor, "page-2");
  for (const expected of result.expected) {
    const actual = sqlite.prepare("SELECT * FROM auction_listing_snapshots WHERE listing_id=?").get(expected.listingId);
    assert.equal(actual.fingerprint, expected.fingerprint); assert.equal(actual.observed_at, OLD);
  }
  assert.equal(rows(sqlite, "sync_batch_guards").length, 0); assert.equal(rows(sqlite, "automatic_refresh_guards").length, 0);
  assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length, 0); sqlite.close();
});

test("fresh missing volatile prices clear current amounts while old snapshots and media survive", async () => {
  const {db, sqlite, store} = database(); await store.acquire();
  await commitInventoryBatch({db, store, prepared: await prepared(db, [raw()], OLD)});
  const before = rows(sqlite, "auction_listings")[0], oldSnapshot = rows(sqlite, "auction_listing_snapshots")[0];
  const value = raw(); value.pricing = {current_bid_usd: null}; delete value.media;
  const result = await commitInventoryBatch({db, store, prepared: await prepared(db, [value])});
  const after = rows(sqlite, "auction_listings")[0];
  assert.equal(result.updated, 1); assert.equal(after.current_bid_usd, null); assert.equal(after.buy_now_usd, null);
  assert.equal(after.summary_synced_at, CURRENT); assert.equal(after.media_urls_json, before.media_urls_json);
  assert.deepEqual(rows(sqlite, "auction_listing_snapshots")[0], oldSnapshot);
  assert.equal(rows(sqlite, "auction_listing_snapshots").length, 2); sqlite.close();
});

test("a newer writer between preparation and commit preserves its values and rolls back the whole page checkpoint", async () => {
  const {db, sqlite, store} = database(); await store.acquire();
  await commitInventoryBatch({db, store, prepared: await prepared(db, [raw()], OLD)});
  const values = await prepared(db, [raw("copart", "10000001", 200), raw("iaai", "20000002")]);
  sqlite.prepare("UPDATE auction_listings SET current_bid_usd=999,summary_synced_at=? WHERE lot='10000001'").run(new Date(NOW).toISOString());
  const before = snapshot(sqlite);
  await assert.rejects(commitInventoryBatch({db, store, prepared: values, checkpointStatements: [checkpoint(db)]}), {message: "INVENTORY_COMMIT_STALE_BASELINE"});
  assert.deepEqual(snapshot(sqlite), before); sqlite.close();
});

test("every expected baseline field is compared with exact null-aware IS semantics", async () => {
  for (const field of ["listing_id", "source_key", "vin_normalized", "summary_synced_at", "detail_synced_at", "source_updated_at", "updated_at"]) {
    const {db, sqlite, store} = database(); await store.acquire();
    await commitInventoryBatch({db, store, prepared: await prepared(db, [raw(), raw("iaai", "20000002")], OLD)});
    const values = await prepared(db, [raw()]);
    // Alter the supplied stale baseline, including null -> empty string. The
    // current DB must not be accepted merely because both timestamps are old.
    const original = values[0].previous[field];
    if (["listing_id", "source_key"].includes(field)) {
      const other = rows(sqlite, "auction_listings")[1];
      if (field === "listing_id") {
        sqlite.prepare("UPDATE auction_listing_snapshots SET listing_id=? WHERE listing_id=?").run(other.listing_id, original);
        sqlite.prepare("UPDATE auction_listings SET listing_id=? WHERE listing_id=?").run("changed-listing-id", original);
      } else sqlite.prepare("UPDATE auction_listings SET source_key=? WHERE lot='10000001'").run(other.source_key);
    } else sqlite.prepare(`UPDATE auction_listings SET ${field}=? WHERE lot='10000001'`).run(original === null ? "" : `${original}-changed`);
    const before = snapshot(sqlite);
    await assert.rejects(commitInventoryBatch({db, store, prepared: values}), {message: "INVENTORY_COMMIT_STALE_BASELINE"});
    assert.deepEqual(snapshot(sqlite), before); sqlite.close();
  }
});

test("unexpected existing LOT rows, ambiguous matches and listing-ID reuse cannot be upserted", async () => {
  for (const collision of ["unexpected", "duplicate", "listing-id"]) {
    const {db, sqlite, store} = database(); await store.acquire();
    const first = await prepared(db, [raw()]);
    await commitInventoryBatch({db, store, prepared: await prepared(db, [raw()], OLD)});
    let values = first;
    if (collision === "duplicate") {
      values = await prepared(db, [raw()]);
      const second = await prepared(db, [raw("copart", "10000002")]);
      await commitInventoryBatch({db, store, prepared: second});
      sqlite.prepare("UPDATE auction_listings SET lot='10000001' WHERE lot='10000002'").run();
    } else if (collision === "listing-id") {
      values = await prepared(db, [raw("copart", "10000002")]);
      values[0].record.identity = {...values[0].record.identity, listingId: first[0].record.identity.listingId};
    }
    const before = snapshot(sqlite);
    await assert.rejects(commitInventoryBatch({db, store, prepared: values}), {message: "INVENTORY_COMMIT_STALE_BASELINE"});
    assert.deepEqual(snapshot(sqlite), before); sqlite.close();
  }
});

test("source keys cannot cross platforms or refer to mismatched source metadata", async () => {
  for (const collision of ["lot", "source-platform"]) {
    const {db, sqlite, store} = database(); await store.acquire();
    const first = await prepared(db, [raw()]);
    await commitInventoryBatch({db, store, prepared: first});
    const second = await prepared(db, [raw("iaai", "20000002")]);
    if (collision === "lot") second[0].record.identity = {...second[0].record.identity, sourceKey: first[0].record.identity.sourceKey};
    else {
      // An orphan source row is enough to reject a cross-platform identity.
      sqlite.exec("DELETE FROM auction_listing_snapshots; DELETE FROM auction_listings");
      sqlite.prepare("UPDATE vehicle_sources SET source_key=?,platform='copart' WHERE source_key=?")
        .run(second[0].record.identity.sourceKey, first[0].record.identity.sourceKey);
    }
    const before = snapshot(sqlite);
    await assert.rejects(commitInventoryBatch({db, store, prepared: second}), {message: "INVENTORY_COMMIT_STALE_BASELINE"});
    assert.deepEqual(snapshot(sqlite), before); sqlite.close();
  }
});

test("a verified same-VIN relist shares only its vehicle source and preserves the older auction and snapshot", async () => {
  const {db, sqlite, store} = database(); await store.acquire();
  const first = raw("copart", "91040025", 2500); first.vehicle_id = "2023-lucid-motors-air-pure-50EA1PFA8PA006512"; first.vin = "50EA1PFA8PA006512";
  await commitInventoryBatch({db,store,prepared:await prepared(db,[first],OLD)});
  const original = rows(sqlite,"auction_listings")[0], originalSnapshot = rows(sqlite,"auction_listing_snapshots")[0];
  const relisted = {...structuredClone(first),lot_number:"73143876"}; relisted.pricing.current_bid_usd = 500;
  const result = await commitInventoryBatch({db,store,prepared:await prepared(db,[relisted])});
  assert.equal(result.inserted,1); assert.equal(rows(sqlite,"vehicle_sources").length,1);
  assert.equal(rows(sqlite,"auction_listings").length,2);
  assert.deepEqual(sqlite.prepare("SELECT * FROM auction_listings WHERE lot='91040025'").get(),original);
  assert.deepEqual(rows(sqlite,"auction_listing_snapshots")[0],originalSnapshot);
  assert.equal(sqlite.prepare("SELECT current_bid_usd FROM auction_listings WHERE lot='73143876'").get().current_bid_usd,500);
  assert.equal(rows(sqlite,"auction_listing_snapshots").length,2);sqlite.close();
});

test("the source guard uses both indexes and rejects conflicts for VIN suffixes, opaque keys and missing VINs", async () => {
  for (const kind of ["suffix", "opaque", "missing"]) {
    const {db, sqlite, store, calls} = database();
    try {
      sqlite.exec(fs.readFileSync(path.join(__dirname, "../docs/proposals/catalog-source-key-exceptions.sql"), "utf8"));
      await store.acquire();
      const first = raw("copart", "10002001");
      first.vehicle_id = kind === "opaque" ? "provider-opaque-key" : "car-" + first.vin;
      await commitInventoryBatch({db,store,prepared:await prepared(db,[first],OLD)});
      const initialGuard = calls.batches.flat().find(s => s.sql.includes("UNION ALL") && s.sql.includes("substr("));
      assert.ok(initialGuard);
      const plan = sqlite.prepare("EXPLAIN QUERY PLAN "+initialGuard.sql).all(...initialGuard.params).map(x=>x.detail);
      for (const name of ["idx_listings_vin_recent", "idx_listings_source_key_exceptions"]) {
        assert.ok(plan.some(line=>line.includes("SEARCH l USING INDEX "+name)), plan.join("\n"));
      }
      if (kind === "missing") sqlite.exec("UPDATE auction_listings SET vin_normalized=NULL");
      const relist = {...first, lot_number:"10002002", vin:"1HGCM82633A004353"};
      await assert.rejects(commitInventoryBatch({db,store,prepared:await prepared(db,[relist])}),
        error=>error.guardRejected===true);
      assert.equal(rows(sqlite,"auction_listings").length,1);
    } finally { sqlite.close(); }
  }
});

test("multiple separate relisted auctions can commit in one batch with complete matching VINs", async () => {
  const {db, sqlite, store} = database();await store.acquire();
  const first=raw(),second=raw("copart","10000002",300);second.vehicle_id=first.vehicle_id;
  const result=await commitInventoryBatch({db,store,prepared:await prepared(db,[first,second])});
  assert.equal(result.inserted,2);assert.equal(rows(sqlite,"vehicle_sources").length,1);
  assert.equal(rows(sqlite,"auction_listings").length,2);assert.equal(rows(sqlite,"auction_listing_snapshots").length,2);
  assert.deepEqual(rows(sqlite,"auction_listings").map(row=>row.current_bid_usd),[100,300]);sqlite.close();
});

test("cross-LOT source reuse with conflicting, missing or unresolved existing VIN evidence remains rejected",async()=>{
  for(const mode of ["different-vin","missing-vin","ambiguous"]){
    const {db,sqlite,store}=database();await store.acquire();const first=raw();
    await commitInventoryBatch({db,store,prepared:await prepared(db,[first],OLD)});
    if(mode==="different-vin")sqlite.exec("UPDATE auction_listings SET vin_normalized='3NSNAE927LF797453'");
    if(mode==="missing-vin")sqlite.exec("UPDATE auction_listings SET vin_normalized=NULL");
    if(mode==="ambiguous")sqlite.exec("UPDATE auction_listings SET identity_state='ambiguous'");
    const next=raw("copart","10000002");next.vehicle_id=first.vehicle_id;
    const batch=await prepared(db,[next]),before=snapshot(sqlite);
    await assert.rejects(commitInventoryBatch({db,store,prepared:batch}),{message:"INVENTORY_COMMIT_STALE_BASELINE"});
    assert.deepEqual(snapshot(sqlite),before);sqlite.close();
  }
});

test("different VINs sharing a source across separately prepared pages are rejected before any write",async()=>{
  const {db,sqlite,store,calls}=database();await store.acquire();const first=raw(),second=raw("copart","10000002");
  second.vehicle_id=first.vehicle_id;second.vin="3NSNAE927LF797453";
  const batch=[...await prepared(db,[first]),...await prepared(db,[second])];
  await assert.rejects(commitInventoryBatch({db,store,prepared:batch}),/INVENTORY_COMMIT_DUPLICATE_IDENTITY/);
  assert.equal(calls.batches.length,0);sqlite.close();
});

test("an older relist capture inserts its separate auction without downgrading shared source timestamps",async()=>{
  const {db,sqlite,store}=database();await store.acquire();const first=raw();
  await commitInventoryBatch({db,store,prepared:await prepared(db,[first])});
  const source=rows(sqlite,"vehicle_sources")[0],next=raw("copart","10000002");next.vehicle_id=first.vehicle_id;
  await commitInventoryBatch({db,store,prepared:await prepared(db,[next],OLD)});
  assert.deepEqual(rows(sqlite,"vehicle_sources")[0],source);
  assert.equal(sqlite.prepare("SELECT summary_synced_at FROM auction_listings WHERE lot='10000002'").get().summary_synced_at,OLD);
  assert.equal(rows(sqlite,"auction_listings").length,2);sqlite.close();
});

test("expired, replaced or blocked global leases reject before any catalogue or checkpoint mutation", async () => {
  for (const change of ["lease_until='2020-01-01T00:00:00Z'", "lease_owner='another-owner'", "blocked_reason='OPERATOR_STOP'"]) {
    const {db, sqlite, store} = database(); await store.acquire(); const values = await prepared(db);
    sqlite.exec(`UPDATE automatic_refresh_state SET ${change}`); const before = snapshot(sqlite);
    await assert.rejects(commitInventoryBatch({db, store, prepared: values, checkpointStatements: [checkpoint(db)]}), {message: "INVENTORY_COMMIT_LEASE_REJECTED"});
    assert.deepEqual(snapshot(sqlite), before); sqlite.close();
  }
});

test("checkpoint failure rolls back earlier source, listing and snapshot writes", async () => {
  const {db, sqlite, store} = database(); await store.acquire();
  const before = snapshot(sqlite);
  const invalidCheckpoint = db.prepare("INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,0)").bind("checkpoint-failure");
  await assert.rejects(commitInventoryBatch({db, store, prepared: await prepared(db), checkpointStatements: [checkpoint(db), invalidCheckpoint]}));
  assert.deepEqual(snapshot(sqlite), before); sqlite.close();
});

test("all data is validated before the first transaction; duplicate records and stale observation objects are rejected", async () => {
  const {db, sqlite, store, calls} = database(); await store.acquire();
  const first = await prepared(db);
  await assert.rejects(commitInventoryBatch({db, store, prepared: [first[0], first[0]]}), /INVENTORY_COMMIT_DUPLICATE_IDENTITY/);
  const bad = structuredClone(first[0]); bad.record.vehicle.pricing.current_bid = -1;
  await assert.rejects(commitInventoryBatch({db, store, prepared: [first[0], bad]}), /INVENTORY_COMMIT_RECORD_INVALID/);
  const future = structuredClone(first[0]); future.record.observedAt = "2026-10-27T00:00:00.000Z";
  await assert.rejects(commitInventoryBatch({db, store, prepared: [future]}), /INVENTORY_COMMIT_RECORD_INVALID/);
  await assert.rejects(commitInventoryBatch({db, store, prepared: Array(61).fill(first[0])}), /INVENTORY_COMMIT_BATCH_INVALID/);
  await assert.rejects(commitInventoryBatch({db, store, prepared: [], checkpointStatements: Array(11).fill(checkpoint(db))}), /INVENTORY_COMMIT_BATCH_INVALID/);
  await assert.rejects(commitInventoryBatch({db, store: {...store, db: {}}, prepared: first}), /INVENTORY_COMMIT_STORE_REQUIRED/);
  assert.equal(calls.batches.length, 0);
  await commitInventoryBatch({db, store, prepared: first});
  const update = await prepared(db, [raw()], new Date(NOW).toISOString());
  update[0].record.observedAt = OLD;
  await assert.rejects(commitInventoryBatch({db, store, prepared: update}), /INVENTORY_COMMIT_OLDER_OBSERVATION/);
  assert.equal(calls.batches.length, 1); sqlite.close();
});

test("sixty records and ten checkpoints stay below the guarded statement ceiling", async () => {
  const {db, sqlite, store, calls} = database(); await store.acquire();
  const values = [];
  for (let page = 0; page < 3; page++) values.push(...await prepared(db,
    Array.from({length: 20}, (_, i) => raw("copart", String(10000001 + page * 20 + i)))));
  calls.reads = 0;
  const result = await commitInventoryBatch({db, store, prepared: values,
    checkpointStatements: Array.from({length: 10}, (_, i) => checkpoint(db, `page-${i}`))});
  assert.equal(result.statementCount, 194); assert.equal(calls.batches[0].length, 194);
  assert.equal(result.committed, 60); assert.equal(calls.reads, 0); sqlite.close();
});

test("empty terminal pages can checkpoint atomically and distinct guards are cleaned up", async () => {
  const {db, sqlite, store, calls} = database(); await store.acquire();
  for (let i = 0; i < 2; i++) {
    const result = await commitInventoryBatch({db, store, prepared: [], checkpointStatements: [checkpoint(db, `empty-${i}`)]});
    assert.equal(result.committed, 0); assert.deepEqual(result.expected, []);
  }
  const ids = calls.batches.map(batch => batch[1].params[0]); assert.equal(new Set(ids).size, 2);
  assert.equal(rows(sqlite, "sync_batch_guards").length, 0); sqlite.close();
});

test("fingerprinting retains an input snapshot and transport uncertainty is not reported as a rejected guard", async () => {
  const {db, sqlite, store} = database(); await store.acquire();
  const values = await prepared(db); const committing = commitInventoryBatch({db, store, prepared: values});
  values[0].record.vehicle.pricing.current_bid = 999;
  const result = await committing;
  assert.equal(result.expected[0].currentBid, 100); assert.equal(rows(sqlite, "auction_listings")[0].current_bid_usd, 100);
  const second = await prepared(db, [raw("iaai", "20000002")]);
  store.guarded = async () => {throw Error("OPERATOR_D1_TIMEOUT");};
  await assert.rejects(commitInventoryBatch({db, store, prepared: second}), error => {
    assert.equal(error.message, "INVENTORY_COMMIT_FAILED"); assert.equal(error.guardRejected, false); return true;
  });
  sqlite.close();
});
