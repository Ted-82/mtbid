"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {DatabaseSync} = require("node:sqlite");
const {prepareInventoryChangePatch, BASELINE_FIELDS} = require("../sync/inventory-change-patch.cjs");
const AT = "2026-10-26T12:05:00.000Z";
function row(patch = {}) {
  return {listing_id: "listing-1", source_key: "source-1", platform: "copart", lot: "63118776",
    vin_normalized: "3NSNAE927LF797453", identity_state: "resolved",
    source_updated_at: "2026-10-26T11:00:00.000Z", summary_synced_at: "2026-10-26T11:01:00.000Z",
    detail_synced_at: "2026-10-25T10:00:00.000Z", last_seen_at: "2026-10-26T11:01:00.000Z",
    updated_at: "2026-10-26T11:01:00.000Z", auction_state: "open", source_status: "Open",
    auction_at: "2026-10-27T10:00:00.000Z", is_timed: 0, timed_end_at: null,
    current_bid_usd: 15, current_bid2_usd: 100, buy_now_usd: 12000,
    final_price_usd: null, make: "POLARIS", model: "RZR", media_urls_json: '["https://example.invalid/car.jpg"]',
    fingerprint: "full-snapshot-fingerprint", freshness_class: "hot", ...patch};
}
function change(patch = {}) {
  return {provider: "apibara", sequence: 12345, eventId: "chg_12345", eventType: "bid.changed", terminal: false,
    platform: "copart", lotNumber: "63118776", vin: "3NSNAE927LF797453", reason: null,
    recordedAt: "2026-10-26T12:00:00.000Z", vehicleUpdatedAt: "2026-10-26T12:00:00.000Z",
    changedFields: ["pricing.current_bid_usd", "pricing.previous_bid_usd"],
    before: {"pricing.current_bid_usd": 15, "pricing.previous_bid_usd": 15},
    after: {"pricing.current_bid_usd": 30, "pricing.previous_bid_usd": 30}, ...patch};
}
function plan(event = change(), previous = row(), options = {}) {
  return prepareInventoryChangePatch({row: previous, change: event, observedAt: AT, ...options});
}
function fieldEvent(field, value, extra = {}) {
  return change({changedFields: [field], before: {}, after: {[field]: value}, ...extra});
}
function database(previous = row(), provider = "apibara") {
  const db = new DatabaseSync(":memory:");
  const numeric = new Set(["current_bid_usd", "current_bid2_usd", "buy_now_usd", "is_timed", "final_price_usd"]);
  db.exec(`CREATE TABLE auction_listings (${Object.keys(previous).map(column => `${column} ${numeric.has(column) ? "REAL" : "TEXT"}`).join(",")});
    CREATE TABLE vehicle_sources(source_key TEXT, provider TEXT, platform TEXT);
    CREATE TABLE guards(allowed INTEGER CHECK(allowed=1));`);
  db.prepare(`INSERT INTO auction_listings VALUES (${Object.keys(previous).map(() => "?").join(",")})`).run(...Object.values(previous));
  db.prepare("INSERT INTO vehicle_sources VALUES (?,?,?)").run(previous.source_key, provider, previous.platform);
  return db;
}

test("actual file integer flags and nonpersistent source labels do not force a detail fetch for each bid", () => {
  const event=change({changedFields:['auction.upcoming','details.source_sale_type','pricing.current_bid_usd'],
    before:{'auction.upcoming':0,'details.source_sale_type':'O','pricing.current_bid_usd':15},
    after:{'auction.upcoming':1,'details.source_sale_type':'On Minimum Bid','pricing.current_bid_usd':30}});
  const output=plan(event);
  assert.deepEqual(output.assignments,{current_bid_usd:30});assert.equal(output.requiresDetail,false);
  assert.deepEqual(output.ignoredFields,['auction.upcoming','details.source_sale_type']);
  for(const value of [2,-1,'1',{},[]]) assert.throws(()=>plan(fieldEvent('auction.upcoming',value)),/INVENTORY_CHANGE_PATCH_INVALID/);
  assert.throws(()=>plan(fieldEvent('details.source_sale_type',{})),/INVENTORY_CHANGE_PATCH_INVALID/);
  const closed=plan(fieldEvent('auction.upcoming',1),row({auction_state:'ended',source_status:'Sold'}));
  assert.deepEqual(closed.assignments,{});assert.equal(closed.status,'ignored');
});

test("integer removed/timed flags preserve their meaning and buy-now removal wins over companion price", () => {
  assert.deepEqual(plan(fieldEvent('auction.is_timed',1)).assignments,{is_timed:1,auction_at:null});
  assert.equal(plan(fieldEvent('auction.lot_removed',1)).assignments.source_status,'Removed');
  assert.deepEqual(plan(fieldEvent('auction.lot_removed',0)).assignments,{});
  const output=plan(change({changedFields:['auction.is_buy_now','pricing.buy_now_usd'],before:{},after:{'auction.is_buy_now':0,'pricing.buy_now_usd':100}}));
  assert.deepEqual(output.assignments,{buy_now_usd:null});assert.equal(output.requiresDetail,false);
  assert.deepEqual(plan(fieldEvent('auction.is_buy_now',1),row({auction_state:'ended',buy_now_usd:null})).assignments,{});
  assert.equal(plan(fieldEvent('auction.is_buy_now',null)).requiresDetail,true);
});

test("offsetless source dates queue detail while preserving known schedule and applying independent safe price", () => {
  for(const field of ['auction.auction_at','auction.timed_end_at']){
    const output=plan(change({changedFields:[field,'pricing.current_bid_usd'],before:{},after:{[field]:'2026-10-28 18:00:00','pricing.current_bid_usd':30}}));
    assert.deepEqual(output.assignments,{current_bid_usd:30});assert.equal(output.requiresDetail,true);
    assert.deepEqual(output.unsupportedFields,[field]);
    assert.throws(()=>plan(fieldEvent(field,'2026-02-30 18:00:00')),/INVENTORY_CHANGE_PATCH_INVALID/);
  }
});

test("known bid+previous-bid event updates only current bid and never queues detail", () => {
  const previous = row(), event = change(), output = plan(event, previous);
  assert.equal(output.status, "patch");
  assert.equal(output.requiresDetail, false);
  assert.deepEqual(output.assignments, {current_bid_usd: 30});
  assert.deepEqual(output.ignoredFields, ["pricing.previous_bid_usd"]);
  assert.deepEqual(output.unsupportedFields, []);
  assert.equal(previous.current_bid_usd, 15);
  assert.equal(event.after["pricing.current_bid_usd"], 30);
  const db = database(previous);
  assert.ok(db.prepare(output.match.sql).get(...output.match.params));
  assert.equal(db.prepare(output.statement.sql).run(...output.statement.params).changes, 1);
  const updated = {...db.prepare("SELECT * FROM auction_listings").get()};
  assert.deepEqual(updated, {...previous, current_bid_usd: 30});
  db.close();
});

test("explicit null clears a supplied price; missing values never clear unrelated fields", () => {
  assert.deepEqual(plan(fieldEvent("pricing.buy_now_usd", null)).assignments, {buy_now_usd: null});
  assert.deepEqual(plan(fieldEvent("pricing.current_bid2_usd", 0)).assignments, {current_bid2_usd: 0});
  const missing = plan(change({changedFields: ["pricing.buy_now_usd"], before: {"pricing.buy_now_usd": 12000}, after: {}}));
  assert.equal(missing.status, "requires_detail");
  assert.deepEqual(missing.assignments, {});
});

test("critical unsupported descriptions queue detail while safe companion price can be patched", () => {
  const unsupported = plan(fieldEvent("make", "BMW", {eventType: "lot.updated"}));
  assert.equal(unsupported.status, "requires_detail");
  assert.equal(unsupported.requiresDetail, true);
  assert.deepEqual(unsupported.unsupportedFields, ["make"]);
  assert.equal(unsupported.statement, null);
  const mixed = plan(change({changedFields: ["make", "pricing.current_bid_usd"], after: {make: "BMW", "pricing.current_bid_usd": 30}}));
  assert.equal(mixed.status, "patch");
  assert.equal(mixed.requiresDetail, true);
  assert.deepEqual(mixed.assignments, {current_bid_usd: 30});
  assert.deepEqual(mixed.unsupportedFields, ["make"]);
});

test("nonpersistent source metadata alone does not queue or refresh a row", () => {
  for (const [field, value] of [["pricing.previous_bid_usd", 55], ["pricing.current_bid_at", AT],
    ["auction.last_sold_day", "2026-10-26"], ["auction.sold_timed", false]]) {
    const output = plan(fieldEvent(field, value));
    assert.equal(output.status, "ignored");
    assert.equal(output.requiresDetail, false);
    assert.equal(output.statement, null);
    assert.deepEqual(output.ignoredFields, [field]);
  }
});

test("unknown lots and uncertain identities require detail without inserting a partial vehicle", () => {
  assert.equal(plan(change(), null).reason, "unknown_lot");
  assert.equal(plan(change(), row({identity_state: "ambiguous"})).reason, "unresolved_listing_identity");
  assert.equal(plan(change(), row({vin_normalized: null})).reason, "unverified_vin");
  assert.equal(plan(change({vin: "NOVIN"})).reason, "unverified_vin");
  assert.equal(plan(change({vin: null})).status, "patch");
});

test("VIN/platform/LOT/provider conflicts never produce update plans", () => {
  for (const patch of [{vin: "1HGCM82633A004352"}, {platform: "iaai"}, {lotNumber: "99999999"}]) {
    assert.throws(() => plan(change(patch)), /INVENTORY_CHANGE_IDENTITY_CONFLICT/);
  }
  assert.throws(() => plan(change(), row({provider: "other"})), /INVENTORY_CHANGE_IDENTITY_CONFLICT/);
  assert.throws(() => plan(change({lotNumber: "63118776 OR 1=1"})), /INVENTORY_CHANGE_PATCH_INVALID/);
});

test("older or duplicate events are ignored without promoting any freshness field", () => {
  assert.equal(plan(change(), row(), {lastAppliedSequence: 12345}).reason, "already_applied_sequence");
  assert.equal(plan(change(), row(), {lastAppliedSequence: 20000}).reason, "already_applied_sequence");
  for (const field of ["summary_synced_at", "detail_synced_at", "last_seen_at"]) {
    const output = plan(change(), row({[field]: "2026-10-26T12:01:00.000Z"}));
    assert.equal(output.reason, "older_observation");
    assert.equal(output.statement, null);
  }
  assert.equal(plan(change(), row({source_updated_at: "2026-10-26T12:01:00.000Z"})).reason, "older_source_version");
  assert.equal(plan(change(), row({current_bid_usd: 30})).reason, "no_material_change");
});

test("invalid money, timestamps and missing CAS fields fail closed", () => {
  for (const value of [-1, "30", NaN, Infinity, {}, true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => plan(fieldEvent("pricing.current_bid_usd", value)), /INVENTORY_CHANGE_PATCH_INVALID/);
    assert.throws(() => plan(fieldEvent("pricing.previous_bid_usd", value)), /INVENTORY_CHANGE_PATCH_INVALID/);
  }
  for (const patch of [{recordedAt: "tomorrow"}, {recordedAt: "2026-10-26T13:00:00Z"},
    {vehicleUpdatedAt: "2026-02-30T10:00:00Z"}, {vehicleUpdatedAt: "2026-10-26T14:00:00Z"}]) {
    assert.throws(() => plan(change(patch)), /INVENTORY_CHANGE_TIME_INVALID/);
  }
  const incomplete = row(); delete incomplete.summary_synced_at;
  assert.throws(() => plan(change(), incomplete), /INVENTORY_CHANGE_BASELINE_INVALID/);
  assert.throws(() => plan(change(), row({source_updated_at: "invalid"})), /INVENTORY_CHANGE_BASELINE_INVALID/);
  assert.throws(() => plan(change(), row(), {lastAppliedSequence: "123"}), /INVENTORY_CHANGE_PATCH_INVALID/);
});

test("explicit terminal events close availability without inventing final prices or history", () => {
  for (const [eventType, label] of [["lot.sold", "Sold"], ["lot.not_sold", "Not Sold"], ["lot.removed", "Removed"], ["auction.ended", "Ended"]]) {
    const output = plan(change({eventType, terminal: eventType.startsWith("lot."), changedFields: [], before: {}, after: {}}));
    assert.deepEqual(output.assignments, {auction_state: "ended", source_status: label, buy_now_usd: null, auction_at: null});
    assert.equal(OWN(output.assignments, "final_price_usd"), false);
    assert.doesNotMatch(output.statement.sql, /INSERT INTO|auction_events/);
    const previous = row(), db = database(previous);
    db.prepare(output.statement.sql).run(...output.statement.params);
    const updated = {...db.prepare("SELECT * FROM auction_listings").get()};
    assert.equal(updated.current_bid_usd, previous.current_bid_usd);
    assert.equal(updated.final_price_usd, previous.final_price_usd);
    for (const field of ["source_updated_at", "summary_synced_at", "detail_synced_at", "last_seen_at", "updated_at", "fingerprint"]) assert.equal(updated[field], previous[field]);
    db.close();
  }
});
function OWN(object, key) { return Object.hasOwn(object, key); }

test("approval, explicit sold prices and conflicting terminal evidence require careful handling", () => {
  const approval = plan(fieldEvent("auction.outcome_status", "Sold on Approval"));
  assert.equal(approval.assignments.auction_state, "ended");
  assert.equal(approval.assignments.source_status, "Sold on Approval");
  assert.equal(OWN(approval.assignments, "final_price_usd"), false);
  const salePrice = plan(fieldEvent("pricing.sale_price_usd", 15000));
  assert.equal(salePrice.requiresDetail, true);
  assert.equal(salePrice.statement, null);
  const conflict = plan(fieldEvent("auction.state", "open", {eventType: "lot.sold", terminal: true}));
  assert.equal(conflict.status, "requires_detail");
  assert.equal(conflict.reason, "conflicting_auction_state");
});

test("auction schedule patches preserve date semantics and clear stale actionable timing when live", () => {
  const date = plan(fieldEvent("auction.auction_at", "2026-10-28T12:00:00+02:00", {eventType: "auction.rescheduled"}));
  assert.deepEqual(date.assignments, {auction_at: "2026-10-28T10:00:00.000Z"});
  assert.deepEqual(plan(fieldEvent("auction.auction_at", null)).assignments, {auction_at: null});
  const live = plan(fieldEvent("auction.lot_sub_status", "Live"));
  assert.deepEqual(live.assignments, {auction_state: "live", source_status: "Live", auction_at: null});
  const timed = plan(fieldEvent("auction.lot_status", "Timed"));
  assert.deepEqual(timed.assignments, {is_timed: 1, auction_at: null});
  const upcoming = plan(fieldEvent("auction.state", "upcoming"));
  assert.equal(upcoming.assignments.auction_at, null);
  assert.equal(plan(fieldEvent("auction.auction_at", "2026-10-28T10:00:00Z"), row({auction_state: "ended"})).reason, "schedule_on_inactive_lot");
});

test("CAS detects another update, LOT ambiguity and a wrong source provider", () => {
  const output = plan(), db = database();
  db.exec("UPDATE auction_listings SET current_bid_usd=99");
  assert.equal(db.prepare(output.match.sql).get(...output.match.params), undefined);
  assert.equal(db.prepare(output.statement.sql).run(...output.statement.params).changes, 0);
  db.close();
  const ambiguous = database();
  ambiguous.exec("INSERT INTO auction_listings SELECT * FROM auction_listings");
  assert.equal(ambiguous.prepare(output.statement.sql).run(...output.statement.params).changes, 0);
  ambiguous.close();
  const other = database(row(), "other");
  assert.equal(other.prepare(output.statement.sql).run(...output.statement.params).changes, 0);
  other.close();
});

test("sequential same-lot changes work with updated row baselines and transactional guards", () => {
  const previous = row(), first = plan(change(), previous);
  const next = change({sequence: 12346, eventId: "chg_12346", after: {"pricing.current_bid_usd": 45, "pricing.previous_bid_usd": 45}});
  const second = plan(next, {...previous, ...first.assignments}, {lastAppliedSequence: 12345});
  const db = database(previous);
  db.exec("BEGIN");
  for (const output of [first, second]) {
    db.prepare(`INSERT INTO guards SELECT CASE WHEN EXISTS(${output.match.sql}) THEN 1 ELSE 0 END`).run(...output.match.params);
    assert.equal(db.prepare(output.statement.sql).run(...output.statement.params).changes, 1);
  }
  db.exec("COMMIT");
  assert.equal(db.prepare("SELECT current_bid_usd FROM auction_listings").get().current_bid_usd, 45);
  assert.equal(db.prepare("SELECT summary_synced_at FROM auction_listings").get().summary_synced_at, previous.summary_synced_at);
  db.close();
});

test("CAS guard failure rolls back the patch before a consumer can advance a checkpoint", () => {
  const output = plan(), db = database();
  db.exec("CREATE TABLE checkpoint(cursor INTEGER); INSERT INTO checkpoint VALUES (12344); UPDATE auction_listings SET current_bid_usd=99");
  db.exec("BEGIN");
  assert.throws(() => db.prepare(`INSERT INTO guards SELECT CASE WHEN EXISTS(${output.match.sql}) THEN 1 ELSE 0 END`).run(...output.match.params), /CHECK constraint failed/);
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT cursor FROM checkpoint").get().cursor, 12344);
  assert.equal(db.prepare("SELECT current_bid_usd FROM auction_listings").get().current_bid_usd, 99);
  assert.equal(BASELINE_FIELDS.includes("summary_synced_at"), true);
  db.close();
});
