"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), {DatabaseSync} = require("node:sqlite");
const {createApibaraProvider} = require("../providers/apibara.js");
const {D1SyncRepository, knownObservationStatements} = require("../sync/d1-repository.js");
const {prepareObservation} = require("../sync/publication-refresh.cjs");
const {MAX_PAGE_RECORDS, prepareInventoryPage} = require("../sync/inventory-page.cjs");

const OLD = "2026-10-20T10:00:00.000Z", OBSERVED = "2026-10-26T10:00:00.000Z", NOW = "2026-10-26T10:01:00.000Z";
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
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(fs.readFileSync(path.join(__dirname, "../docs/proposals/0004_d1_sync_2.sql"), "utf8"));
  const reads = [];
  const db = {prepare(sql) {return {bind(...params) {return {sql, params,
    async all() {reads.push({sql, params}); return {results: sqlite.prepare(sql).all(...params)};},
    async first() {reads.push({sql, params}); return sqlite.prepare(sql).get(...params) || null;}
  };}};}, batch() {throw Error("DATABASE_WRITE_FORBIDDEN");}};
  return {sqlite, db, reads};
}
async function seed(db, sqlite, value, observedAt = OLD) {
  const prepared = await prepareObservation({repo: new D1SyncRepository(db), provider: adapter,
    raw: value, platform: value.platform, observedAt, processedAt: NOW, freshnessPolicy: policy});
  const built = await knownObservationStatements(db, prepared.record);
  for (const statement of built.statements) sqlite.prepare(statement.sql).run(...statement.params);
  return prepared.record.identity.listingId;
}
const prepare = (db, records, extra = {}) => prepareInventoryPage({db, provider: adapter, records,
  observedAt: OBSERVED, processedAt: NOW, freshnessPolicy: policy, ...extra});

test("one SELECT prepares twenty mixed existing/new observations without transport or database writes", async () => {
  const {db, sqlite, reads} = database();
  await seed(db, sqlite, raw()); reads.length = 0;
  const before = sqlite.prepare("SELECT * FROM auction_listings").all();
  const records = Array.from({length: MAX_PAGE_RECORDS}, (_, index) => raw("copart", String(10000001 + index), index));
  const result = await prepare(db, records);
  assert.equal(result.prepared.length, 20); assert.deepEqual(result.rejected, []);
  assert.equal(result.prepared.filter(item => item.inserted).length, 19);
  assert.equal(result.prepared[0].previous.current_bid_usd, 100);
  assert.equal(result.prepared[0].record.vehicle.pricing.current_bid, 0);
  assert.equal(reads.length, 1); assert.equal(reads[0].params.length, 40);
  assert.deepEqual(sqlite.prepare("SELECT * FROM auction_listings").all(), before);
  sqlite.close();
});

test("batch lookup retains the same rows and order as findListingsByLot", async () => {
  const {db, sqlite, reads} = database();
  await seed(db, sqlite, raw());
  const existing = (await new D1SyncRepository(db).findListingsByLot({platform: "copart", lot: "10000001", limit: 2})).results[0];
  reads.length = 0;
  const result = await prepare(db, [raw()]);
  assert.deepEqual(result.prepared[0].previous, existing); assert.equal(reads.length, 1);
  sqlite.close();
});

test("the same LOT on two platforms is matched independently", async () => {
  const {db, sqlite, reads} = database();
  const copartId = await seed(db, sqlite, raw("copart"));
  const iaaiId = await seed(db, sqlite, raw("iaai")); reads.length = 0;
  const result = await prepare(db, [raw("copart", "10000001", 200), raw("iaai", "10000001", 300)]);
  assert.deepEqual(result.prepared.map(item => item.record.identity.listingId), [copartId, iaaiId]);
  assert.deepEqual(result.prepared.map(item => item.record.vehicle.pricing.current_bid), [200, 300]);
  assert.equal(reads.length, 1); assert.deepEqual(result.rejected, []); sqlite.close();
});

test("all duplicate page identities are rejected while other valid rows survive", async () => {
  const {db, sqlite, reads} = database();
  const result = await prepare(db, [raw(), raw("copart", "10000001", 999), raw("iaai", "20000002")]);
  assert.equal(result.prepared.length, 1);
  assert.deepEqual(result.rejected, Array.from({length: 2}, () => ({platform: "copart", lot: "10000001", code: "AUTOMATIC_REFRESH_DUPLICATE_PAGE_IDENTITY"})));
  assert.equal(reads.length, 1); assert.equal(reads[0].params.length, 2); sqlite.close();
});

test("one invalid price, source timestamp or identity does not discard other valid records", async () => {
  const {db, sqlite} = database();
  const price = raw("copart", "10000002"); price.pricing.current_bid_usd = -1;
  const future = raw("copart", "10000003"); future.updated_at = "2026-10-27T00:00:00.000Z";
  const missingVin = raw("copart", "10000004"); missingVin.vin = null;
  const result = await prepare(db, [raw(), price, future, missingVin]);
  assert.equal(result.prepared.length, 1);
  assert.deepEqual(result.rejected.map(item => item.code), ["NEGATIVE_PROVIDER_PRICE", "SOURCE_VERSION_TIME_INVALID", "AUTOMATIC_REFRESH_IDENTITY_INVALID"]);
  assert.ok(result.rejected.every(item => Object.keys(item).join() === "platform,lot,code")); sqlite.close();
});

test("different VINs cannot reuse one provider identity in the same page", async () => {
  const {db, sqlite} = database();
  const first = raw(), second = raw("copart", "10000002"); second.vehicle_id = first.vehicle_id;
  second.vin = "3NSNAE927LF797453";
  const result = await prepare(db, [first, second, raw("iaai", "20000002")]);
  assert.equal(result.prepared.length, 1);
  assert.deepEqual(result.rejected.map(item => item.code), Array(2).fill("INVENTORY_PAGE_CANONICAL_IDENTITY_COLLISION"));
  sqlite.close();
});

test("same-platform relisted LOTs may share one vehicle source with a matching complete VIN", async () => {
  const {db, sqlite} = database();
  const first = raw(), second = raw("copart", "10000002"); second.vehicle_id = first.vehicle_id;
  const result = await prepare(db, [first, second]);
  assert.deepEqual(result.rejected, []); assert.equal(result.prepared.length, 2);
  assert.equal(result.prepared[0].record.identity.sourceKey, result.prepared[1].record.identity.sourceKey);
  assert.notEqual(result.prepared[0].record.identity.listingId, result.prepared[1].record.identity.listingId);
  sqlite.close();
});

test("existing complete, masked or missing VIN evidence uses the strict saved-lot guard", async () => {
  const {db, sqlite} = database(); await seed(db, sqlite, raw());
  for (const vin of ["1HGCM82633A004353", "1HGCM82633A******", null, "NOVIN"]) {
    const value = raw(); value.vin = vin;
    const result = await prepare(db, [value]);
    assert.equal(result.prepared.length, 0);
    assert.equal(result.rejected[0].code, "AUTOMATIC_REFRESH_IDENTITY_MISMATCH");
  }
  sqlite.close();
});

test("an existing resolved VIN-less listing preserves its identity; a new VIN-less listing is rejected", async () => {
  const {db, sqlite} = database();
  const value = raw(); value.vin = null;
  const id = await seed(db, sqlite, value);
  const newer = raw("copart", "10000002"); newer.vin = null;
  const result = await prepare(db, [value, newer]);
  assert.equal(result.prepared.length, 1); assert.equal(result.prepared[0].record.identity.listingId, id);
  assert.equal(result.prepared[0].inserted, false); assert.equal(result.prepared[0].record.vehicle.vin, null);
  assert.equal(result.rejected[0].code, "AUTOMATIC_REFRESH_IDENTITY_INVALID"); sqlite.close();
});

test("older observation, detail capture and provider version cannot replace newer data", async () => {
  for (const type of ["summary", "detail", "source"]) {
    const {db, sqlite} = database(); const value = raw(); value.updated_at = "2026-10-20T09:00:00.000Z";
    const id = await seed(db, sqlite, value);
    if (type === "summary") sqlite.prepare("UPDATE auction_listings SET summary_synced_at=? WHERE listing_id=?").run(NOW, id);
    if (type === "detail") sqlite.prepare("UPDATE auction_listings SET detail_synced_at=? WHERE listing_id=?").run(NOW, id);
    if (type === "source") value.updated_at = "2026-10-19T09:00:00.000Z";
    const result = await prepare(db, [value]);
    assert.equal(result.prepared.length, 0); assert.deepEqual(result.rejected, []);
    assert.equal(result.skipped[0].code, type === "source" ? "older_source_version" : "older_observation"); sqlite.close();
  }
});

test("fresh missing prices clear volatile fields and retain existing media and observations", async () => {
  const {db, sqlite} = database(); await seed(db, sqlite, raw());
  const before = sqlite.prepare("SELECT * FROM auction_listing_snapshots").all();
  const value = raw(); value.pricing = {current_bid_usd: null}; delete value.media;
  const result = await prepare(db, [value]); const item = result.prepared[0];
  assert.equal(item.record.vehicle.pricing.current_bid, null); assert.equal(item.record.vehicle.pricing.buy_now, null);
  assert.ok(item.record.explicitClears.includes("pricing.current_bid"));
  assert.ok(item.record.vehicle.media.items.length > 0);
  assert.deepEqual(sqlite.prepare("SELECT * FROM auction_listing_snapshots").all(), before); sqlite.close();
});

test("ambiguous database identities are rejected without discarding an unrelated lot", async () => {
  const {db, sqlite} = database();
  const first = raw(); await seed(db, sqlite, first);
  const second = raw("copart", "10000002"); const id = await seed(db, sqlite, second);
  sqlite.prepare("UPDATE auction_listings SET lot='10000001' WHERE listing_id=?").run(id);
  const result = await prepare(db, [raw(), raw("iaai", "20000002")]);
  assert.equal(result.prepared.length, 1); assert.equal(result.rejected[0].code, "AMBIGUOUS_PLATFORM_LOT"); sqlite.close();
});

test("platform scope, size and malformed diagnostics are bounded before reads", async () => {
  const {db, sqlite, reads} = database();
  await assert.rejects(prepare(db, Array(21).fill(raw())), /INVENTORY_PAGE_SIZE_INVALID/);
  await assert.rejects(prepare(db, [], {platform: "other"}), /INVENTORY_PAGE_PLATFORM_INVALID/);
  assert.deepEqual(await prepare(db, []), {prepared: [], rejected: [], skipped: []});
  const result = await prepare(db, [raw("iaai"), {platform: "secret-token", lot: "secret-token"}], {platform: "copart"});
  assert.deepEqual(result.rejected, [{platform: "iaai", lot: "10000001", code: "AUTOMATIC_REFRESH_IDENTITY_MISMATCH"},
    {platform: null, lot: null, code: "AUTOMATIC_REFRESH_IDENTITY_INVALID"}]);
  assert.equal(reads.length, 0); sqlite.close();
});

test("failed database reads cannot become new listings and adapter errors cannot leak arbitrary text", async () => {
  const failingDb = {prepare() {throw Error("private database context");}};
  await assert.rejects(prepare(failingDb, [raw()]), {message: "INVENTORY_PAGE_READ_FAILED"});
  const {db, sqlite} = database();
  const brokenAdapter = {...adapter, normalizeVehicle() {throw Error("secret-token");}};
  const result = await prepare(db, [raw()], {provider: brokenAdapter});
  assert.deepEqual(result.rejected, [{platform: "copart", lot: "10000001", code: "INVENTORY_OBSERVATION_INVALID"}]); sqlite.close();
});
