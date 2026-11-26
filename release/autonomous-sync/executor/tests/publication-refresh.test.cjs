"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");
const {createApibaraProvider} = require("../providers/apibara.js");
const {D1SyncRepository} = require("../sync/d1-repository.js");
const {PUBLICATION_DB, MAX_PUBLICATION_REQUESTS, availabilityOf, validateApproval, runPublicationRefresh} = require("../sync/publication-refresh.cjs");

const CAPTURED = Date.parse("2026-10-01T10:00:00.000Z");
const NOW = Date.parse("2026-10-07T17:00:00.000Z");
const policy = {hotIntervalMs: 3600000, warmIntervalMs: 86400000, coldIntervalMs: 604800000, hotWindowMs: 3600000};
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/apibara-discovery-page-shape.json"), "utf8"));

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(fs.readFileSync(path.join(__dirname, "../docs/proposals/0004_d1_sync_2.sql"), "utf8"));
  let tail = Promise.resolve();
  const db = {
    prepare(sql) {
      return {bind(...params) {
        return {sql, params, async run() {const result = sqlite.prepare(sql).run(...params); return {meta: {changes: Number(result.changes)}};},
          async first() {return sqlite.prepare(sql).get(...params) ?? null;}, async all() {return {results: sqlite.prepare(sql).all(...params)};}};
      }};
    },
    batch(statements) {
      const result = tail.then(() => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const results = statements.map(item => {
            if (/^\s*(SELECT|PRAGMA)/i.test(item.sql)) return {results: sqlite.prepare(item.sql).all(...item.params)};
            const change = sqlite.prepare(item.sql).run(...item.params); return {meta: {changes: Number(change.changes)}};
          });
          sqlite.exec("COMMIT"); return results;
        } catch (error) {sqlite.exec("ROLLBACK"); throw error;}
      });
      tail = result.catch(() => {}); return result;
    }
  };
  return {sqlite, db};
}
function raw(platform = "copart", lot = "TEST-001", bid = 4100) {
  const value = structuredClone(fixture.response.data[0]);
  value.platform = platform; value.lot_number = lot; value.vehicle_id = `${platform}:${lot}`;
  value.pricing.current_bid_usd = bid;
  return value;
}
function page(records, next = null) {return {response: {data: records, meta: {next_cursor: next}}};}
function transport(responses, observedAt = CAPTURED) {
  let index = 0;
  const specs = [];
  const adapter = createApibaraProvider({fetch: async () => {throw new Error("NETWORK_FORBIDDEN");}});
  return {...adapter, specs, async obtain(spec) {
    specs.push(structuredClone(spec));
    const response = responses[index++];
    if (response instanceof Error) throw response;
    if (!response) throw new Error("UNEXPECTED_CALL");
    return {response, observedAt};
  }};
}
function approval(campaignId = "test", total = 20, own = 10, maxAttempts = 1) {
  return {approved: true, campaignId, totalRequests: total, platformRequests: {copart: own, iaai: own}, maxAttempts};
}
async function run(db, provider, overrides = {}) {
  return runPublicationRefresh({db, target: PUBLICATION_DB, provider, approval: approval(), platform: "copart", mode: "discovery", maxPages: 1,
    freshnessPolicy: policy, now: () => NOW, ...overrides});
}
function rows(sqlite, table) {return sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();}

test("publication approval accepts at most 1000 aggregate attempts and rejects invalid boundaries before transport", async () => {
  const {sqlite, db} = database();
  const provider = transport([page([])]);
  assert.equal(MAX_PUBLICATION_REQUESTS, 1000);
  assert.deepEqual(validateApproval(approval("approved-1000", 1000, 1000), "copart"), {total: 1000, own: 1000, attempts: 1});
  assert.deepEqual(validateApproval(approval("approved-one", 1, 1), "iaai"), {total: 1, own: 1, attempts: 1});
  for (const total of [0, -1, 1001, 1000.5, NaN, Infinity, "1000"]) {
    await assert.rejects(run(db, provider, {approval: approval("invalid-total", total, 1)}), /INVALID_APPROVED_BUDGET/);
  }
  for (const own of [0, -1, 1001, 1.5, NaN, Infinity, "1000"]) {
    await assert.rejects(run(db, provider, {approval: approval("invalid-platform", 1000, own)}), /INVALID_APPROVED_BUDGET/);
  }
  assert.equal(provider.specs.length, 0);
  assert.equal(rows(sqlite, "provider_request_budgets").length, 0);
  sqlite.close();
});

test("1000 campaign budget persists across resumptions, filters and platforms; the 1001st attempt cannot reach transport", async () => {
  const {sqlite, db} = database();
  const consent = approval("stage-1000", 1000, 1000);
  const first = await run(db, transport([page([raw()], "second-page")]), {approval: consent});
  assert.equal(first.budget.normal_limit, 1000); assert.equal(first.budget.normal_consumed, 1);
  assert.equal(first.scope.cursor, "second-page");
  // Seed the preceding campaign attempts to exercise the exact upper boundary
  // without making 997 redundant synthetic calls. Neither counter is reset by
  // a new run, a new discovery filter or a different platform.
  sqlite.prepare("UPDATE provider_request_budgets SET normal_consumed=998 WHERE provider LIKE ? AND budget_day='campaign'")
    .run("apibara:publication:stage-1000%");
  const resumedProvider = transport([page([raw("copart", "TEST-002")], "third-page")], CAPTURED + 1000);
  const resumed = await run(db, resumedProvider, {approval: consent});
  assert.equal(resumed.ok, true); assert.equal(resumed.budget.normal_consumed, 999);
  assert.equal(resumedProvider.specs[0].params.cursor, "second-page");
  const otherProvider = transport([page([raw("iaai")], "iaai-second-page")]);
  const other = await run(db, otherProvider, {platform: "iaai", approval: consent});
  assert.equal(other.ok, true); assert.equal(other.budget.normal_consumed, 1000);
  assert.equal(other.budget.normal_reserved, 0); assert.equal(otherProvider.specs.length, 1);
  for (const scope of [{}, {platform: "iaai"}, {filters: {lot_status: "Buy Now"}}]) {
    const blockedProvider = transport([page([raw(scope.platform || "copart")])]);
    const blocked = await run(db, blockedProvider, {approval: consent, ...scope});
    assert.equal(blocked.stopReason, "budget_exhausted"); assert.equal(blockedProvider.specs.length, 0);
    assert.equal(blocked.budget.normal_consumed, 1000); assert.equal(blocked.budget.normal_reserved, 0);
  }
  assert.equal(rows(sqlite, "auction_listings").length, 3);
  sqlite.close();
});

test("single-attempt campaign counts authorization, throttling and timeout failures without injected backoff or another call", async () => {
  for (const code of ["AUTH", "RATE_LIMITED", "TIMEOUT", "INVALID_RESPONSE"]) {
    const {sqlite, db} = database();
    const failure = Object.assign(new Error("safe provider failure"), {code, retryAfter: 1});
    const provider = transport([failure, page([raw()])]);
    const delays = [];
    const result = await run(db, provider, {approval: approval("single-attempt", 1000, 1000), maxPages: 4,
      retryWait: async delay => delays.push(delay)});
    assert.equal(result.ok, false); assert.equal(result.stopReason, code);
    assert.equal(result.requests, 1); assert.equal(result.retries, 0); assert.equal(provider.specs.length, 1);
    assert.equal(result.budget.normal_consumed, 1); assert.equal(result.budget.normal_reserved, 0);
    assert.equal(result.scope.cursor, null); assert.equal(result.scope.status, "failed");
    assert.deepEqual(delays, []); assert.equal(rows(sqlite, "auction_listings").length, 0);
    assert.equal(rows(sqlite, "provider_request_reservations").filter(row => row.state === "finished").length, 2);
    sqlite.close();
  }
});

test("negative current, secondary, buy-now, final or source prices stop the whole response without rewriting its previous observation", async () => {
  const fields = ["current_bid_usd", "current_bid2_usd", "buy_now_usd", "last_sold_price_usd", "price_usd"];
  for (const [fieldIndex, field] of fields.entries()) {
    for (const [valueIndex, value] of [-1, "-1"].entries()) {
      for (const mode of ["discovery", "known"]) {
        const {sqlite, db} = database();
        await run(db, transport([page([raw()])]));
        const before = rows(sqlite, "auction_listings"), snapshots = rows(sqlite, "auction_listing_snapshots");
        const listing = before[0];
        const unsafe = raw("copart", listing.lot, 5000); unsafe.pricing[field] = value;
        const provider = transport([mode === "known" ? {response: {data: unsafe}} : page([raw("copart", "TEST-NEW"), unsafe])], CAPTURED + 1000);
        const result = await run(db, provider, {mode, maxPages: 4, approval: approval(`negative-${fieldIndex}-${valueIndex}-${mode}`, 1000, 1000, 2),
          targets: mode === "known" ? [{platform: "copart", lot: listing.lot, listingId: listing.listing_id}] : []});
        assert.equal(result.ok, false); assert.equal(result.stopReason, "NEGATIVE_PROVIDER_PRICE");
        assert.equal(result.requests, 1); assert.equal(result.retries, 0); assert.equal(provider.specs.length, 1);
        assert.equal(result.budget.normal_consumed, 1); assert.equal(result.budget.normal_reserved, 0);
        assert.equal(result.scope.cursor, null); assert.equal(result.scope.status, "failed");
        assert.deepEqual(rows(sqlite, "auction_listings"), before);
        assert.deepEqual(rows(sqlite, "auction_listing_snapshots"), snapshots);
        assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sync_page_commits WHERE scope_key=?").get(result.scopeKey).n, 0);
        sqlite.close();
      }
    }
  }
});

test("genuinely observed zero prices remain valid for every persisted price field", async () => {
  const {sqlite, db} = database();
  const zero = raw(); zero.pricing = {current_bid_usd: 0, current_bid2_usd: 0, buy_now_usd: 0, last_sold_price_usd: 0, price_usd: 0};
  const result = await run(db, transport([page([zero])]));
  assert.equal(result.ok, true); assert.equal(result.availability.active, 1);
  const listing = rows(sqlite, "auction_listings")[0];
  for (const field of ["current_bid_usd", "current_bid2_usd", "buy_now_usd", "final_price_usd", "source_price_usd"]) {
    assert.equal(listing[field], 0, field);
  }
  assert.equal(listing.summary_synced_at, new Date(CAPTURED).toISOString());
  sqlite.close();
});

test("operator stop latch blocks the transport and records thrown state failures or unsafe refresh results without real I/O", async () => {
  const vm = require("node:vm");
  const {TARGETS, safeHttpStatus, safeOperatorDiagnostic} = require("../scripts/d1-operator-bridge.cjs");
  const filename = path.join(__dirname, "../scripts/operator-publication-refresh.cjs");
  const source = fs.readFileSync(filename, "utf8");
  for (const scenario of ["latch-before-fetch", "state-failure", "unsafe-result", "d1-after-upstream-success"]) {
    let latchChecks = 0, providerCalls = 0, refreshCalls = 0;
    let d1DiagnosticCallback, upstreamLogger;
    const writes = new Map();
    const fakeDb = {identity: TARGETS.publication, prepare(sql) {return {async all() {
      if (sql.includes(" AS sources")) return {results: [{sources: 0, listings: 0, snapshots: 0, events: 0, entities: 0}]};
      if (sql.includes("COUNT(*) AS n")) return {results: [{n: 0}]};
      return {results: []};
    }};}};
    const fakeFs = {
      mkdirSync() {},
      existsSync(file) {
        if (path.basename(file) === "campaign-stop.json") return scenario === "latch-before-fetch" && ++latchChecks >= 2;
        return ["preflight.json", "gate.json"].includes(path.basename(file));
      },
      readFileSync(file) {
        const name = path.basename(file);
        if (name === "manifest.json") return JSON.stringify({databases: [{database_id: TARGETS.publication.id, roundtrip: true}]});
        if (name === "preflight.json") return JSON.stringify({batch_atomicity_verified: true});
        if (name === "gate.json") return JSON.stringify({passed: true});
        if (name === ".env") return "APIBARA_API_KEY=offline-key";
        throw Error("UNEXPECTED_OFFLINE_FILE_READ");
      },
      writeFileSync(file, value) {writes.set(path.basename(file), JSON.parse(value));},
      appendFileSync(file, value) {
        assert.equal(path.basename(file), "transport-ledger.ndjson");
        assert.equal(JSON.parse(value).upstream_request, true);
      }
    };
    const mockRequire = name => {
      if (name === "node:fs") return fakeFs;
      if (name === "node:path" || name === "node:crypto") return require(name);
      if (name === "node:child_process") return {spawnSync() {return {status: 0, stdout: JSON.stringify({token: "offline-token"})};}};
      if (name === "./d1-operator-bridge.cjs") return {TARGETS, safeHttpStatus, safeOperatorDiagnostic,
        async connectD1(options) {d1DiagnosticCallback = options.onDiagnostic; return fakeDb;}};
      if (name === "dotenv") return {parse() {return {APIBARA_API_KEY: "offline-key"};}};
      if (name === "../providers/apibara.js") return {createApibaraProvider(options) {upstreamLogger = options.console.info; return {
        async request() {providerCalls++; throw Error("NETWORK_FORBIDDEN");}
      };}};
      if (name === "../sync/publication-refresh.cjs") return {async runPublicationRefresh(args) {
        refreshCalls++;
        assert.equal(args.approval.totalRequests, 1000); assert.equal(args.approval.maxAttempts, 1);
        if (scenario === "latch-before-fetch") return args.provider.obtain({operation: "listVehicles"});
        if (scenario === "state-failure") throw Error("SIMULATED_D1_STATE_FAILURE");
        if (scenario === "d1-after-upstream-success") {
          upstreamLogger("safe mock receipt", JSON.stringify({upstream_request: true, status: 200}));
          const failure = Object.assign(new Error("PRIVATE_SQL_AND_TOKEN"), {code: "OPERATOR_D1_FAILED", status: 503,
            d1_request: true, d1_http_status: 503, d1_transport_stage: "response", d1_operation: "query"});
          d1DiagnosticCallback(safeOperatorDiagnostic(failure));
          throw failure;
        }
        return {ok: false, platform: "copart", mode: "discovery", requests: 1, retries: 0, pages: 0,
          availability: {active: 0, ended: 0, unknown: 0}, stopReason: "NEGATIVE_PROVIDER_PRICE"};
      }};
      throw Error("UNEXPECTED_OFFLINE_MODULE");
    };
    const sandbox = {require: mockRequire, module: {exports: {}}, __dirname: path.dirname(filename),
      process: {execPath: process.execPath, env: {}, argv: []}, console: {log() {}, error() {}},
      fetch() {throw Error("NETWORK_FORBIDDEN");}};
    vm.runInNewContext(source, sandbox, {filename});
    await assert.rejects(sandbox.module.exports.main(["discovery", "copart", "open", "1"]),
      scenario === "unsafe-result" ? /CAMPAIGN_STOPPED/ : /REFRESH_STATE_RECOVERY_REQUIRED/);
    assert.equal(providerCalls, 0); assert.equal(refreshCalls, 1);
    const stop = writes.get("campaign-stop.json");
    assert.equal(stop.safe_error_code, scenario === "unsafe-result" ? "NEGATIVE_PROVIDER_PRICE"
      : scenario === "latch-before-fetch" ? "CAMPAIGN_STOP_LATCH"
      : scenario === "d1-after-upstream-success" ? "OPERATOR_D1_FAILED" : "REFRESH_STATE_RECOVERY_REQUIRED");
    assert.equal(stop.state_recovery_required, scenario !== "unsafe-result");
    assert.equal(stop.d1_http_status, scenario === "d1-after-upstream-success" ? 503 : null);
    assert.equal(stop.upstream_http_status, scenario === "d1-after-upstream-success" ? 200 : null);
    assert.equal(stop.upstream_request, scenario === "d1-after-upstream-success");
    assert.equal(JSON.stringify([...writes.values()]).includes("PRIVATE_SQL_AND_TOKEN"), false);
    if (scenario === "latch-before-fetch") assert.equal(latchChecks, 2);
  }
});

test("captured discovery timestamps survive offline replay; same payload creates no snapshot, change and reversion do", async () => {
  const {sqlite, db} = database();
  const first = await run(db, transport([page([raw()])]));
  assert.equal(first.ok, true); assert.equal(first.inserted, 1);
  const initial = rows(sqlite, "auction_listings")[0];
  assert.equal(initial.summary_synced_at, new Date(CAPTURED).toISOString());
  assert.equal(initial.first_seen_at, initial.summary_synced_at);
  assert.equal(rows(sqlite, "auction_listing_snapshots")[0].observed_at, initial.summary_synced_at);
  await run(db, transport([page([raw()])], CAPTURED + 1000), {approval: approval("same")});
  assert.equal(rows(sqlite, "auction_listing_snapshots").length, 1);
  await run(db, transport([page([raw("copart", "TEST-001", 5000)])], CAPTURED + 2000), {approval: approval("changed")});
  await run(db, transport([page([raw()])], CAPTURED + 3000), {approval: approval("reverted")});
  assert.equal(rows(sqlite, "auction_listings").length, 1);
  assert.equal(rows(sqlite, "vehicle_sources").length, 1);
  assert.deepEqual(rows(sqlite, "auction_listing_snapshots").map(row => row.current_bid_usd), [4100, 5000, 4100]);
  assert.equal(rows(sqlite, "auction_events").length, 0);
  assert.equal(rows(sqlite, "vehicle_entities").length, 0);
  assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  sqlite.close();
});

test("known LOT refresh retains stable identity, fuller fields and platform separation even with same VIN", async () => {
  const {sqlite, db} = database();
  await run(db, transport([page([raw()])]));
  await run(db, transport([page([raw("iaai")])]), {platform: "iaai"});
  const original = rows(sqlite, "auction_listings").find(row => row.platform === "copart");
  const patch = raw("copart", "TEST-001", 4500);
  patch.vehicle_id = "new-provider-detail-id"; delete patch.seller; delete patch.media; delete patch.sale_document;
  const updated = await run(db, transport([{response: {data: patch}}], CAPTURED + 1000), {mode: "known", approval: approval("known"),
    targets: [{platform: "copart", lot: original.lot, listingId: original.listing_id}]});
  assert.equal(updated.ok, true); assert.equal(updated.updated, 1);
  const after = rows(sqlite, "auction_listings").find(row => row.platform === "copart");
  assert.equal(after.listing_id, original.listing_id); assert.equal(after.source_key, original.source_key);
  assert.equal(after.seller_name, original.seller_name); assert.equal(after.media_urls_json, original.media_urls_json);
  assert.equal(after.document_name, original.document_name); assert.equal(after.current_bid_usd, 4500);
  assert.equal(rows(sqlite, "auction_listings").find(row => row.platform === "iaai").current_bid_usd, 4100);
  assert.equal(rows(sqlite, "vehicle_sources").length, 2);
  assert.equal(rows(sqlite, "vehicle_entities").length, 0);
  assert.deepEqual(rows(sqlite, "provider_sync_scopes").map(row => row.operation), ["discovery", "discovery", "detail_refresh"]);
  sqlite.close();
});

test("404, 429 and 5xx never delete rows, infer ended or mark previous observations fresh; default is no retry", async () => {
  const {sqlite, db} = database();
  await run(db, transport([page([raw()])]));
  const before = rows(sqlite, "auction_listings");
  for (const code of ["NOT_FOUND", "RATE_LIMITED", "UPSTREAM"]) {
    const adapter = transport([Object.assign(new Error("safe provider failure"), {code})], NOW);
    const failed = await run(db, adapter, {approval: approval(`failure-${code.toLowerCase().replace(/_/g, "-")}`)});
    assert.equal(failed.ok, false); assert.equal(failed.stopReason, code); assert.equal(failed.requests, 1);
    assert.equal(adapter.specs.length, 1); assert.equal(failed.scope.status, "failed");
    assert.deepEqual(rows(sqlite, "auction_listings"), before);
  }
  sqlite.close();
});

test("global campaign cap counts the permitted retry and subsequent platforms; exhaustion blocks before transport", async () => {
  const {sqlite, db} = database();
  const failure = Object.assign(new Error("retryable"), {code: "TIMEOUT"});
  const delays = [];
  const adapter = transport([failure, page([raw()], "cursor-2"), page([raw("copart", "TEST-002")])]);
  const capped = await run(db, adapter, {approval: approval("retry", 2, 2, 2), maxPages: 3, retryWait: async delay => delays.push(delay)});
  assert.equal(capped.ok, true); assert.equal(capped.stopReason, "budget_exhausted");
  assert.equal(capped.requests, 2); assert.equal(capped.retries, 1); assert.equal(adapter.specs.length, 2);
  assert.equal(capped.budget.normal_consumed, 2); assert.equal(capped.budget.normal_reserved, 0);
  assert.equal(capped.scope.status, "partial"); assert.equal(capped.scope.cursor, "cursor-2");
  assert.deepEqual(delays, [1000]);
  const other = transport([page([raw("iaai")])]);
  const blocked = await run(db, other, {platform: "iaai", approval: approval("retry", 2, 2)});
  assert.equal(blocked.stopReason, "budget_exhausted"); assert.equal(other.specs.length, 0);
  sqlite.close();
});

test("known checkpoint resumes next LOT without replaying previous transport; discovery filters/cursors are independent", async () => {
  const {sqlite, db} = database();
  await run(db, transport([page([raw(), raw("copart", "TEST-002")])]));
  const targets = rows(sqlite, "auction_listings").map(row => ({platform: row.platform, lot: row.lot, listingId: row.listing_id}));
  const adapter = transport([{response: {data: raw()}}, {response: {data: raw("copart", "TEST-002")}}], CAPTURED + 1000);
  const first = await run(db, adapter, {mode: "known", targets, approval: approval("resumable")});
  assert.equal(first.scope.cursor, "1"); assert.equal(first.scope.status, "partial");
  const second = await run(db, adapter, {mode: "known", targets, approval: approval("resumable")});
  assert.equal(second.ok, true); assert.equal(second.scope.status, "complete"); assert.equal(second.stopReason, "known_targets_complete");
  assert.deepEqual(adapter.specs.map(spec => spec.identifier), targets.map(target => target.lot));
  const buy = await run(db, transport([page([], "buy-next")]), {filters: {lot_status: "Buy Now"}, approval: approval("filters")});
  const timed = await run(db, transport([page([], "timed-next")]), {filters: {lot_status: "Timed"}, approval: approval("filters")});
  assert.notEqual(buy.scopeKey, timed.scopeKey); assert.equal(buy.scope.cursor, "buy-next"); assert.equal(timed.scope.cursor, "timed-next");
  sqlite.close();
});

test("crash inside atomic batch consumes attempted provider budget but preserves rows/snapshots/cursor for resume", async () => {
  const {sqlite, db} = database();
  const failed = await run(db, transport([page([raw()], "next")]), {crashAt: "inside_batch"});
  assert.equal(failed.ok, false); assert.equal(failed.requests, 1);
  assert.equal(rows(sqlite, "auction_listings").length, 0); assert.equal(rows(sqlite, "auction_listing_snapshots").length, 0);
  assert.equal(rows(sqlite, "sync_page_commits").length, 0); assert.equal(failed.scope.cursor, null);
  assert.equal(failed.budget.normal_consumed, 1);
  const resumed = await run(db, transport([page([raw()], "next")]));
  assert.equal(resumed.ok, true); assert.equal(resumed.scope.cursor, "next");
  assert.equal(rows(sqlite, "auction_listings").length, 1); assert.equal(resumed.budget.normal_consumed, 2);
  sqlite.close();
});

test("availability uses explicit source evidence; unknown clears actionable data, ended never creates a fake sale event", async () => {
  const {sqlite, db} = database();
  await run(db, transport([page([raw()])]));
  const unknown = raw(); unknown.auction = {}; unknown.pricing = {};
  assert.equal(availabilityOf({auction: {state: null}, pricing: {buy_now: 999}}).status, "unknown");
  const result = await run(db, transport([page([unknown])], CAPTURED + 1000), {approval: approval("unknown")});
  assert.equal(result.availability.unknown, 1);
  const saved = rows(sqlite, "auction_listings")[0];
  assert.equal(saved.auction_state, "unknown"); assert.equal(saved.buy_now_usd, null); assert.equal(saved.auction_at, null);
  assert.equal(saved.current_bid_usd, null); assert.equal(saved.seller_name, "Synthetic Seller");
  assert.equal(rows(sqlite, "auction_listing_snapshots")[0].current_bid_usd, 4100);
  assert.equal(rows(sqlite, "auction_listing_snapshots")[1].current_bid_usd, null);
  assert.equal(rows(sqlite, "auction_listing_snapshots")[1].buy_now_usd, null);
  const ended = raw(); ended.auction.state = "Sold";
  const terminal = await run(db, transport([page([ended])], CAPTURED + 2000), {approval: approval("ended")});
  assert.equal(terminal.availability.ended, 1); assert.equal(rows(sqlite, "auction_events").length, 0);
  assert.equal(rows(sqlite, "auction_listings")[0].buy_now_usd, null);
  sqlite.close();
});

test("unapproved 200 proposal, wrong database, invalid capture/source times and malformed pagination fail closed", async () => {
  const {sqlite, db} = database();
  const provider = transport([page([raw()])]);
  await assert.rejects(run(db, provider, {approval: {...approval(), approved: false, totalRequests: 200}}), /OWNER_REQUEST_BUDGET_APPROVAL_REQUIRED/);
  await assert.rejects(run(db, provider, {target: {name: "rexbid-db", id: "971879fe-04ed-4e8c-9dc6-5306980bb872"}}), /PUBLICATION_TARGET_REQUIRED/);
  assert.equal(provider.specs.length, 0);
  for (const observation of [null, "invalid", NOW + 1000]) {
    const result = await run(db, transport([page([raw()])], observation), {approval: approval(`bad-${String(observation).replace(/[^a-z0-9-]/g, "").slice(0, 30)}`)});
    assert.equal(result.ok, false); assert.equal(rows(sqlite, "auction_listings").length, 0);
  }
  const bad = raw(); bad.updated_at = "not-a-date";
  const wrongTime = await run(db, transport([page([bad])]), {approval: approval("source-time")});
  assert.equal(wrongTime.stopReason, "SOURCE_VERSION_TIME_INVALID");
  const incomplete = await run(db, transport([{response: {data: []}}]), {approval: approval("pagination")});
  assert.equal(incomplete.ok, false); assert.equal(incomplete.stopReason, "PAGINATION_COMPLETENESS_UNKNOWN");
  assert.equal(incomplete.scope.status, "failed"); assert.equal(incomplete.scope.last_complete_at, null);
  sqlite.close();
});

test("older observed response/source version skips without moving freshness or overwriting price", async () => {
  const {sqlite, db} = database();
  const latest = raw(); latest.updated_at = "2026-10-01T09:00:00.000Z";
  await run(db, transport([page([latest])], CAPTURED + 10000));
  const before = rows(sqlite, "auction_listings");
  const old = raw("copart", "TEST-001", 100); old.updated_at = "2026-09-29T09:00:00.000Z";
  const oldSource = await run(db, transport([page([old])], CAPTURED + 20000), {approval: approval("older-source")});
  assert.equal(oldSource.skipped, 1); assert.deepEqual(rows(sqlite, "auction_listings"), before);
  const oldCapture = await run(db, transport([page([latest])], CAPTURED), {approval: approval("older-capture")});
  assert.equal(oldCapture.skipped, 1); assert.deepEqual(rows(sqlite, "auction_listings"), before);
  sqlite.close();
});

test("cross-platform or wrong known LOT response aborts without touching either identity or performing retries", async () => {
  const {sqlite, db} = database();
  await run(db, transport([page([raw()])]));
  const before = rows(sqlite, "auction_listings");
  const row = before[0];
  const targets = [{platform: "copart", lot: row.lot, listingId: row.listing_id}];
  for (const wrong of [raw("iaai"), raw("copart", "WRONG-LOT")]) {
    const adapter = transport([{response: {data: wrong}}], CAPTURED + 1000);
    const result = await run(db, adapter, {mode: "known", targets, approval: approval(`wrong-${wrong.platform}-${wrong.lot_number.toLowerCase()}`, 20, 10, 2)});
    assert.equal(result.ok, false); assert.equal(adapter.specs.length, 1); assert.deepEqual(rows(sqlite, "auction_listings"), before);
  }
  sqlite.close();
});

test("a reused platform LOT with a different full VIN stops both discovery and known refresh before any page write", async () => {
  const {sqlite, db} = database();
  const original = raw(); original.vin = "1HGCM82633A004352";
  await run(db, transport([page([original])]));
  const beforeListings = rows(sqlite, "auction_listings"), beforeSources = rows(sqlite, "vehicle_sources");
  const beforeSnapshots = rows(sqlite, "auction_listing_snapshots");
  const listing = beforeListings[0];
  for (const mode of ["discovery", "known"]) {
    const reused = raw("copart", original.lot_number, 9999); reused.vin = "1HGCM82633A004353";
    const provider = transport([mode === "known" ? {response: {data: reused}} : page([raw("copart", "TEST-NEW"), reused])], CAPTURED + 1000);
    const result = await run(db, provider, {mode, approval: approval(`vin-mismatch-${mode}`, 1000, 1000), maxPages: 4,
      targets: mode === "known" ? [{platform: "copart", lot: listing.lot, listingId: listing.listing_id}] : []});
    assert.equal(result.ok, false); assert.equal(result.stopReason, "PLATFORM_LOT_VIN_MISMATCH");
    assert.equal(result.requests, 1); assert.equal(result.retries, 0); assert.equal(provider.specs.length, 1);
    assert.equal(result.budget.normal_consumed, 1); assert.equal(result.scope.cursor, null);
    assert.deepEqual(rows(sqlite, "auction_listings"), beforeListings);
    assert.deepEqual(rows(sqlite, "vehicle_sources"), beforeSources);
    assert.deepEqual(rows(sqlite, "auction_listing_snapshots"), beforeSnapshots);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sync_page_commits WHERE scope_key=?").get(result.scopeKey).n, 0);
  }
  sqlite.close();
});

test("missing, masked and incomplete VINs allow a normal partial update while preserving the known full VIN", async () => {
  const {sqlite, db} = database();
  const original = raw(); original.vin = "1HGCM82633A004352";
  await run(db, transport([page([original])]));
  const listing = rows(sqlite, "auction_listings")[0];
  const targets = [{platform: "copart", lot: listing.lot, listingId: listing.listing_id}];
  for (const [index, vin] of [null, "1HGCM82633A******", "PARTIAL", " 1hgcm82633a004352 "].entries()) {
    const partial = raw("copart", original.lot_number, 4500 + index); partial.vin = vin;
    const result = await run(db, transport([{response: {data: partial}}], CAPTURED + (index + 1) * 1000),
      {mode: "known", targets, approval: approval(`partial-vin-${index}`, 1000, 1000)});
    assert.equal(result.ok, true); assert.equal(result.updated, 1);
    const saved = rows(sqlite, "auction_listings")[0];
    assert.equal(saved.listing_id, listing.listing_id); assert.equal(saved.vin_normalized, original.vin);
    assert.equal(saved.current_bid_usd, 4500 + index);
  }
  sqlite.close();
});

test("detail freshness uses its receipt time; subsequent discovery and older detail replay cannot relabel it", async () => {
  const {sqlite, db} = database();
  await run(db, transport([page([raw()])]));
  const listing = rows(sqlite, "auction_listings")[0];
  assert.equal(listing.detail_synced_at, null);
  const targets = [{platform: "copart", lot: listing.lot, listingId: listing.listing_id}];
  const detail = await run(db, transport([{response: {data: raw("copart", listing.lot, 4500)}}], CAPTURED + 1000),
    {mode: "known", targets, approval: approval("detail-clock")});
  assert.equal(detail.ok, true);
  assert.equal(rows(sqlite, "auction_listings")[0].detail_synced_at, new Date(CAPTURED + 1000).toISOString());
  await run(db, transport([page([raw("copart", listing.lot, 5000)])], CAPTURED + 2000), {approval: approval("later-discovery")});
  const afterDiscovery = rows(sqlite, "auction_listings")[0];
  assert.equal(afterDiscovery.summary_synced_at, new Date(CAPTURED + 2000).toISOString());
  assert.equal(afterDiscovery.detail_synced_at, new Date(CAPTURED + 1000).toISOString());
  const old = await run(db, transport([{response: {data: raw("copart", listing.lot, 100)}}], CAPTURED + 1500),
    {mode: "known", targets, approval: approval("older-detail")});
  assert.equal(old.ok, true); assert.equal(old.skipped, 1);
  assert.deepEqual(rows(sqlite, "auction_listings")[0], afterDiscovery);
  const fresh = await run(db, transport([{response: {data: raw("copart", listing.lot, 5500)}}], CAPTURED + 3000),
    {mode: "known", targets, approval: approval("newer-detail")});
  assert.equal(fresh.ok, true);
  assert.equal(rows(sqlite, "auction_listings")[0].detail_synced_at, new Date(CAPTURED + 3000).toISOString());
  sqlite.close();
});

test("a newer detail writer between preparation and commit aborts the whole page and preserves detail freshness", async () => {
  const {sqlite, db} = database();
  await run(db, transport([page([raw()])]));
  const listing = rows(sqlite, "auction_listings")[0];
  const originalBatch = db.batch;
  let injected = false;
  db.batch = function(statements) {
    if (!injected && statements.some(item => /INSERT INTO auction_listings/.test(item.sql))) {
      injected = true;
      sqlite.prepare("UPDATE auction_listings SET detail_synced_at=?,current_bid_usd=9999").run(new Date(NOW).toISOString());
    }
    return originalBatch.call(db, statements);
  };
  const result = await run(db, transport([{response: {data: raw("copart", listing.lot, 4500)}}], CAPTURED + 1000),
    {mode: "known", targets: [{platform: "copart", lot: listing.lot, listingId: listing.listing_id}], approval: approval("detail-race")});
  assert.equal(result.ok, false); assert.equal(result.stopReason, "STALE_LEASE_CURSOR_OR_RUN");
  const saved = rows(sqlite, "auction_listings")[0];
  assert.equal(saved.current_bid_usd, 9999); assert.equal(saved.detail_synced_at, new Date(NOW).toISOString());
  assert.equal(saved.summary_synced_at, listing.summary_synced_at);
  assert.equal(rows(sqlite, "auction_listing_snapshots").length, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sync_page_commits WHERE scope_key=?").get(result.scopeKey).n, 0);
  sqlite.close();
});

test("lease conflict and raising same campaign proposal cannot obtain additional transport or silently extend its approved cap", async () => {
  const {sqlite, db} = database();
  const first = await run(db, transport([page([raw()], "next")]), {approval: approval("fixed", 1, 1)});
  const next = transport([page([raw("copart", "TEST-002")])]);
  const capped = await run(db, next, {approval: approval("fixed", 10, 10)});
  assert.equal(capped.stopReason, "budget_exhausted"); assert.equal(next.specs.length, 0);
  assert.equal(capped.budget.normal_limit, 1);
  const repo = new D1SyncRepository(db);
  const lease = await repo.acquireLease({scopeKey: first.scopeKey, provider: "apibara", platform: "copart", operation: "discovery",
    owner: "another-operator", token: "other-token", now: NOW, ttlMs: 600000});
  assert.equal(lease.acquired, true);
  const busy = await run(db, next, {approval: approval("fixed", 10, 10)});
  assert.equal(busy.stopReason, "lease_conflict"); assert.equal(next.specs.length, 0);
  await assert.rejects(run(db, next, {maxPages: 5}), /INVALID_PAGE_LIMIT/);
  sqlite.close();
});

test("explicit lot-status Open reopens a known ended listing without inheriting its old terminal state", async () => {
  const {sqlite, db} = database();
  const ended = raw(); ended.auction = {state: "sold", formatted: "Sold"};
  await run(db, transport([page([ended])]));
  const opened = raw(); opened.auction = {lot_sub_status: "Open"};
  const result = await run(db, transport([page([opened])], CAPTURED + 1000), {approval: approval("reopen")});
  assert.equal(result.availability.active, 1);
  const saved = rows(sqlite, "auction_listings")[0];
  assert.equal(saved.auction_state, "active"); assert.equal(saved.source_status, "Open");
  assert.equal(rows(sqlite, "auction_events").length, 0);
  sqlite.close();
});

test("a newer writer between preparation and batch commit aborts atomically instead of moving observed time backwards", async () => {
  const {sqlite, db} = database();
  const originalBatch = db.batch;
  let injected = false;
  await run(db, transport([page([raw()])]));
  db.batch = function(statements) {
    if (!injected && statements.some(item => /INSERT INTO auction_listings/.test(item.sql))) {
      injected = true;
      // Simulate another committed writer after preparation. The production
      // transaction guard must reject the complete old page.
      sqlite.prepare("UPDATE auction_listings SET summary_synced_at=?,last_seen_at=?,current_bid_usd=9999").run(new Date(NOW).toISOString(), new Date(NOW).toISOString());
    }
    return originalBatch.call(db, statements);
  };
  const result = await run(db, transport([page([raw("copart", "TEST-001", 4500)])], CAPTURED + 1000), {approval: approval("race")});
  assert.equal(result.ok, false); assert.equal(result.stopReason, "STALE_LEASE_CURSOR_OR_RUN");
  assert.equal(rows(sqlite, "auction_listings")[0].current_bid_usd, 9999);
  assert.equal(rows(sqlite, "auction_listing_snapshots").length, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sync_page_commits WHERE scope_key=?").get(result.scopeKey).n, 0);
  sqlite.close();
});

test("an Open partial response clears unobserved volatile prices instead of promoting old prices to a new observation", async () => {
  const {sqlite, db} = database();
  const initialRaw = raw(); initialRaw.pricing.current_bid2_usd = 4200;
  await run(db, transport([page([initialRaw])]));
  const previous = rows(sqlite, "auction_listings")[0];
  const partial = raw(); partial.auction = {state: "open", formatted: "Open"}; partial.pricing = {};
  delete partial.seller; delete partial.media; delete partial.sale_document;
  const result = await run(db, transport([page([partial])], CAPTURED + 1000), {approval: approval("partial-prices")});
  assert.equal(result.ok, true); assert.equal(result.availability.active, 1);
  const saved = rows(sqlite, "auction_listings")[0];
  assert.equal(saved.summary_synced_at, new Date(CAPTURED + 1000).toISOString());
  for (const field of ["current_bid_usd", "current_bid2_usd", "buy_now_usd"]) assert.equal(saved[field], null, field);
  assert.equal(saved.seller_name, previous.seller_name); assert.equal(saved.document_name, previous.document_name);
  assert.equal(saved.media_urls_json, previous.media_urls_json); assert.equal(saved.make, previous.make);
  const snapshots = rows(sqlite, "auction_listing_snapshots");
  assert.deepEqual(snapshots.map(row => row.current_bid_usd), [4100, null]);
  assert.deepEqual(snapshots.map(row => row.buy_now_usd), [6200, null]);
  assert.equal(snapshots[0].observed_at, new Date(CAPTURED).toISOString());
  assert.equal(snapshots[1].observed_at, new Date(CAPTURED + 1000).toISOString());
  sqlite.close();
});

test("ended partial response does not reobserve old bids but preserves supplied final/history price semantics", async () => {
  const {sqlite, db} = database();
  await run(db, transport([page([raw()])]));
  const ended = raw(); ended.auction = {state: "sold", formatted: "Sold"}; ended.pricing = {last_sold_price_usd: 5150};
  const result = await run(db, transport([page([ended])], CAPTURED + 1000), {approval: approval("ended-prices")});
  assert.equal(result.ok, true); assert.equal(result.availability.ended, 1);
  const saved = rows(sqlite, "auction_listings")[0];
  assert.equal(saved.final_price_usd, 5150); assert.equal(saved.current_bid_usd, null); assert.equal(saved.buy_now_usd, null);
  assert.deepEqual(rows(sqlite, "auction_listing_snapshots").map(row => row.current_bid_usd), [4100, null]);
  assert.equal(rows(sqlite, "auction_events").length, 0);
  sqlite.close();
});

test("malformed discovery list shapes cannot complete a scope; genuinely empty documented arrays can", async () => {
  const {sqlite, db} = database();
  const malformed = [
    {response: {data: {}, meta: {next_cursor: null}}},
    {response: {meta: {next_cursor: null}}},
    {data: {vehicles: "[]"}, meta: {next_cursor: null}},
    {data: "", meta: {next_cursor: null}}
  ];
  for (const [index, response] of malformed.entries()) {
    const result = await run(db, transport([response]), {approval: approval(`malformed-shape-${index}`)});
    assert.equal(result.ok, false); assert.equal(result.stopReason, "INVALID_PROVIDER_LIST_SHAPE");
    assert.equal(result.scope.status, "failed"); assert.equal(result.scope.last_complete_at, null);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sync_page_commits WHERE scope_key=?").get(result.scopeKey).n, 0);
  }
  for (const [index, response] of [page([]), {data: {vehicles: []}, meta: {next_cursor: null}}].entries()) {
    const result = await run(db, transport([response]), {approval: approval(`valid-empty-${index}`)});
    assert.equal(result.ok, true); assert.equal(result.scope.status, "complete");
    assert.equal(result.stopReason, "scope_complete"); assert.equal(result.inserted, 0);
    assert.equal(result.scope.last_complete_at, new Date(NOW).toISOString());
  }
  assert.equal(rows(sqlite, "auction_listings").length, 0);
  sqlite.close();
});

test("invalid secondary bid values clear old 4200 instead of inheriting it under a fresh timestamp; numeric zero remains observed", async () => {
  for (const [index, invalid] of ["", NaN, Infinity, -Infinity, {}, [], "4200"].entries()) {
    const {sqlite, db} = database();
    const initial = raw(); initial.pricing.current_bid2_usd = 4200;
    await run(db, transport([page([initial])]));
    assert.equal(rows(sqlite, "auction_listings")[0].current_bid2_usd, 4200);
    const newer = raw(); newer.pricing.current_bid2_usd = invalid;
    const result = await run(db, transport([page([newer])], CAPTURED + 1000), {approval: approval(`invalid-secondary-${index}`)});
    assert.equal(result.ok, true);
    const saved = rows(sqlite, "auction_listings")[0];
    assert.equal(saved.current_bid2_usd, null, `invalid case ${index}`);
    assert.equal(saved.current_bid_usd, 4100); assert.equal(saved.buy_now_usd, 6200);
    assert.equal(saved.summary_synced_at, new Date(CAPTURED + 1000).toISOString());
    assert.equal(rows(sqlite, "auction_listing_snapshots").length, 1);
    assert.equal(rows(sqlite, "auction_listing_snapshots")[0].current_bid_usd, 4100);
    const zero = raw(); zero.pricing = {current_bid_usd: 0, current_bid2_usd: 0, buy_now_usd: 0};
    const zeroResult = await run(db, transport([page([zero])], CAPTURED + 2000), {approval: approval(`zero-secondary-${index}`)});
    assert.equal(zeroResult.ok, true);
    const savedZero = rows(sqlite, "auction_listings")[0];
    assert.equal(savedZero.current_bid_usd, 0); assert.equal(savedZero.current_bid2_usd, 0); assert.equal(savedZero.buy_now_usd, 0);
    sqlite.close();
  }
});
