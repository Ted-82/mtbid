const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {DatabaseSync} = require("node:sqlite");
const {webcrypto} = require("node:crypto");
const {validateProductionRelease, validateProductionReleaseConfig} = require("../scripts/validate-production-release.cjs");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://rexbid.pl";
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "wrangler.release.jsonc"), "utf8"));

function setup(t, {schema = true, rows = true} = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  if (schema) sqlite.exec(fs.readFileSync(path.join(ROOT, "docs/proposals/0004_d1_sync_2.sql"), "utf8"));
  const seen = new Date(Date.now() - 60000).toISOString();
  if (schema && rows) {
    for (const [platform, n] of [["copart", 1], ["iaai", 2]]) {
      sqlite.prepare(`INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,updated_at)
        VALUES(?,'apibara',?,'discovery','partial','opaque-cursor-not-public',?)`).run(`scope-${platform}`, platform, seen);
      sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,provider_vehicle_id,identity_kind,identity_state,
        first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,'apibara',?,?,'provider_vehicle_id','resolved',?,?,?,?)`)
        .run(`source-${platform}`, platform, `provider-${platform}`, seen, seen, seen, seen);
      sqlite.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,listing_identity_kind,identity_state,
        source_listing_id,vin_normalized,lot,vehicle_title,make,model,year,auction_state,source_status,auction_at,
        is_timed,timed_end_at,current_bid_usd,buy_now_usd,fuel_type,media_urls_json,media_thumbs_json,
        first_seen_at,last_seen_at,summary_synced_at,freshness_class,fingerprint,created_at,updated_at)
        VALUES(?,?,?,'source_listing_id','resolved','SHARED-LOT',?,'SHARED-LOT',?,'Honda','Civic',2022,
        'live','Live','2099-10-05T10:00:00Z',1,'2099-10-05T12:00:00Z',1000,5000,'Gasoline',
        '["https://images.example/car.jpg"]','["https://images.example/thumb.jpg"]',?,?,?,'hot',?,?,?)`)
        .run(`listing-${platform}`, `source-${platform}`, platform, `TESTVIN00000000000${n}`, `${platform} Honda Civic`,
          seen, seen, seen, `fp-${platform}`, seen, seen);
      sqlite.prepare(`INSERT INTO auction_listing_snapshots(listing_id,observed_at,auction_state,auction_at,
        current_bid_usd,fingerprint,normalizer_version) VALUES(?,?,'live','2099-10-05T10:00:00Z',1000,?,1)`)
        .run(`listing-${platform}`, seen, `snap-${platform}`);
    }
  }
  const statements = [], delegations = [], logs = [];
  let networkCalls = 0;
  const d1 = {prepare(sql) {
    statements.push(sql);
    assert.match(sql.trim(), /^SELECT\b/i, "the release physically permits only SELECT statements");
    const statement = sqlite.prepare(sql);
    const query = args => ({
      async first() { return statement.get(...args) || null; },
      async all() { return {results: statement.all(...args)}; }
    });
    return {...query([]), bind(...args) { return query(args); }};
  }};
  const baseContext = {
    URL, URLSearchParams, Request, Response, Headers, AbortController, setTimeout, clearTimeout,
    crypto: webcrypto,
    __apibara: require("../providers/apibara.js"), __contract: require("../providers/contract.js"),
    __authProvider: require("../auth/supabase.js"), __accounts: require("../auth/routes.js"),
    __providerBudget: require("../providers/request-budget.js"),
    fetch: async () => { networkCalls++; throw new Error("network forbidden in release tests"); },
    console: {info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args)},
    caches: {default: {match: async () => null, put: async () => { throw new Error("unexpected cache write"); }}}
  };
  let source = fs.readFileSync(path.join(ROOT, "worker.js"), "utf8")
    .replace('import apibaraModule from "./providers/apibara.js";', "const apibaraModule = globalThis.__apibara;")
    .replace('import contract from "./providers/contract.js";', "const contract = globalThis.__contract;")
    .replace('import authProviderModule from "./auth/supabase.js";', "const authProviderModule = globalThis.__authProvider;")
    .replace('import accountsModule from "./auth/routes.js";', "const accountsModule = globalThis.__accounts;")
    .replace('import providerBudgetModule from "./providers/request-budget.js";', "const providerBudgetModule = globalThis.__providerBudget;")
    .replace("export default {", "globalThis.__renderer = {");
  vm.createContext(baseContext);
  vm.runInContext(source, baseContext);
  const context = {
    URL, Request, Response, Headers, TypeError, RangeError, console,
    __readRepository: require("../sync/d1-read-repository.js"), __readUtils: require("../sync/public-read-utils.cjs"),
    __renderer: {async fetch(request, env, executionContext) {
      delegations.push({path: new URL(request.url).pathname, auth: env.AUTH_ENABLED, sync: env.REXBID_LEGACY_SYNC_ENABLED,
        hasProviderKey: Object.hasOwn(env, "APIBARA_API_KEY"), hasCookieSecret: Object.hasOwn(env, "REXBID_AUTH_COOKIE_SECRET")});
      assert.ok(!new URL(request.url).pathname.startsWith("/api/"), "no API is delegated to the shared Worker");
      return baseContext.__renderer.fetch(request, env, executionContext);
    }}
  };
  source = fs.readFileSync(path.join(ROOT, "worker.production.js"), "utf8")
    .replace('import rexWorker from "./worker.js";', "const rexWorker = globalThis.__renderer;")
    .replace('import readRepository from "./sync/d1-read-repository.js";', "const readRepository = globalThis.__readRepository;")
    .replace('import readUtils from "./sync/public-read-utils.cjs";', "const readUtils = globalThis.__readUtils;")
    .replace("export default {", "globalThis.__worker = {");
  vm.createContext(context);
  vm.runInContext(source, context);
  const env = {...config.vars, REXBID_PRODUCTION_RELEASE_ENABLED: "enabled", REXBID_DB: d1,
    ASSETS: {async fetch(request) {
      let pathname = new URL(request.url).pathname;
      pathname = pathname === "/" ? "/index.html" : pathname === "/car" ? "/car.html" : pathname;
      const filename = path.join(ROOT, "public", pathname);
      if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return new Response("Not Found", {status: 404});
      const type = filename.endsWith(".html") ? "text/html; charset=UTF-8" : filename.endsWith(".js") ? "text/javascript" : "text/plain";
      return new Response(fs.readFileSync(filename), {headers: {"Content-Type": type}});
    }}};
  return {sqlite, env, statements, delegations, logs, renderer: baseContext.__renderer,
    worker: context.__worker, networkCalls: () => networkCalls};
}

const request = (route, options, origin = ORIGIN) => new Request(origin + route, options);

test("production release candidate is separate, inactive and bound only to the existing production D1", () => {
  const result = validateProductionRelease(ROOT);
  assert.equal(result.ok, true, result.issues.join(", "));
  assert.equal(result.launch_ready, false);
  assert.equal(result.status, "inactive_release_candidate");
  assert.equal(config.vars.REXBID_PRODUCTION_RELEASE_ENABLED, "disabled");
  assert.equal(config.vars.REXBID_RELEASE_INDEXING, "disabled");
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.d1_databases.length, 1);
  assert.doesNotMatch(JSON.stringify(config), /rexbid-auth-test|acb3cb8e|staging-bypass|migrations_dir|APIBARA_API_KEY|SUPABASE/);
  for (const override of [{d1_databases: [{binding: "REXBID_DB", database_name: "rexbid-auth-test-db", database_id: "acb3cb8e"}]},
    {vars: {...config.vars, REXBID_PRODUCTION_RELEASE_ENABLED: "enabled"}},
    {assets: {...config.assets, run_worker_first: false}}, {triggers: {crons: ["* * * * *"]}},
    {vars: {...config.vars, REXBID_PROVIDER_BUDGET_DETAIL_DAILY_LIMIT: "1"}}]) {
    assert.equal(validateProductionReleaseConfig({...config, ...override}).ok, false);
  }
});

test("release rejects disabled flag, wrong domain/database/flags before D1, renderer or provider access", async t => {
  const f = setup(t);
  assert.equal((await f.worker.fetch(request("/api/cars"), {...f.env, ...config.vars})).status, 503);
  for (const origin of ["http://rexbid.pl", "https://www.rexbid.pl", "https://rexbid.pl:444", "https://rexbid.pl.evil.example",
    "https://preview.rexbid.pl", "https://mtbid.tedn828.workers.dev", "https://rexbid-auth-test.tedn828.workers.dev"]) {
    assert.equal((await f.worker.fetch(request("/api/cars", undefined, origin), f.env)).status, 503, origin);
  }
  for (const override of [{REXBID_RELEASE_ORIGIN: "https://preview.rexbid.pl"}, {REXBID_CANONICAL_ORIGIN: "https://www.rexbid.pl"},
    {REXBID_RELEASE_D1_TARGET: "rexbid-auth-test-db"}, {REXBID_RELEASE_D1_DATABASE_ID: "acb3cb8e"},
    {AUTH_ENABLED: "true"}, {REXBID_LEGACY_SYNC_ENABLED: "true"}, {REXBID_PROVIDER_ENABLED: "true"},
    {REXBID_PROVIDER_BUDGET_HISTORY_DAILY_LIMIT: "1"}]) {
    const response = await f.worker.fetch(request("/api/cars"), {...f.env, ...override});
    assert.equal(response.status, 503);
    assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
  }
  assert.equal(f.statements.length, 0);
  assert.deepEqual(f.delegations, []);
  assert.equal(f.networkCalls(), 0);
});

test("release catalog filters and paginates known D1 rows without implying full-market coverage", async t => {
  const f = setup(t);
  const first = await f.worker.fetch(request("/api/cars?per_page=1"), f.env);
  const body = await first.json();
  assert.equal(first.status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.meta.stored_row_count, 2);
  assert.equal(body.meta.page_returned_rows, 1);
  assert.equal(body.meta.catalog_complete, false);
  assert.equal(body.meta.scope_status, "partial");
  assert.equal(body.meta.known_rows_only, true);
  assert.equal(body.meta.metadata_complete, false);
  assert.equal(body.release.catalog_source, "production_d1");
  assert.equal(body.release.provider_fallback, false);
  assert.ok(body.meta.next_cursor);
  const next = await (await f.worker.fetch(request(`/api/cars?per_page=1&cursor=${encodeURIComponent(body.meta.next_cursor)}`), f.env)).json();
  assert.equal(next.data.length, 1);
  assert.notEqual(next.data[0].platform, body.data[0].platform);
  const filtered = await (await f.worker.fetch(request("/api/cars?platform=iaai&search=SHARED-LOT"), f.env)).json();
  assert.equal(filtered.data.length, 1);
  assert.equal(filtered.data[0].platform, "iaai");
  const filters = await (await f.worker.fetch(request("/api/filters?platform=copart"), f.env)).json();
  assert.equal(filters.meta.row_count, 1);
  assert.equal(filters.meta.metadata_complete, false);
  assert.equal(filters.data.makes[0].value, "Honda");
  assert.doesNotMatch(JSON.stringify({body, next, filtered, filters}), /opaque-cursor-not-public/);
  assert.deepEqual(f.delegations, []);
  assert.equal(f.networkCalls(), 0);
});

test("release exact LOT/platform and VIN resolve without missing/ambiguous provider fallbacks", async t => {
  const f = setup(t);
  assert.equal((await f.worker.fetch(request("/api/car/SHARED-LOT"), f.env)).status, 409);
  const lot = await (await f.worker.fetch(request("/api/car/SHARED-LOT?platform=iaai"), f.env)).json();
  assert.equal(lot.data.platform, "iaai");
  assert.equal(lot.match, "exact");
  const vin = await (await f.worker.fetch(request("/api/car/TESTVIN000000000001"), f.env)).json();
  assert.equal(vin.data.platform, "copart");
  assert.equal(vin.data.read.source, "d1");
  assert.equal(vin.data.read.freshness, "fresh");
  assert.ok(vin.data.read.last_synced_at);
  assert.equal(vin.data.preview, undefined);
  assert.equal(vin.data.auction.state, "live", "fresh source-confirmed auction facts are preserved");
  assert.equal(vin.data.auction.timed_end_at, "2099-10-05T12:00:00Z");
  assert.equal(vin.data.pricing.current_bid_usd, 1000);
  assert.equal(vin.data.pricing.buy_now_usd, 5000);
  assert.equal((await f.worker.fetch(request("/api/car/NOT-STORED"), f.env)).status, 404);
  assert.equal((await f.worker.fetch(request("/api/car/%2F"), f.env)).status, 400);
  assert.equal((await f.worker.fetch(request("/api/cars?cursor=not-valid-cursor"), f.env)).status, 400);
  assert.deepEqual(f.delegations, []);
  assert.equal(f.networkCalls(), 0);
});

test("stale and unknown production observations retain dated price/media while suppressing LIVE and countdown", async t => {
  const f = setup(t);
  f.sqlite.prepare("UPDATE auction_listings SET summary_synced_at='2020-01-01T00:00:00Z' WHERE platform='copart'").run();
  f.sqlite.prepare("UPDATE auction_listings SET summary_synced_at=NULL WHERE platform='iaai'").run();
  for (const [platform, freshness] of [["copart", "stale"], ["iaai", "unknown"]]) {
    const body = await (await f.worker.fetch(request(`/api/car/SHARED-LOT?platform=${platform}`), f.env)).json();
    assert.equal(body.read.freshness, freshness);
    assert.equal(body.data.read.freshness, freshness);
    assert.equal(body.data.preview, undefined);
    assert.equal(body.data.auction.state, "unknown");
    assert.equal(body.data.auction.auction_at, null);
    assert.equal(body.data.auction.timed_end_at, null);
    assert.equal(body.data.auction.schedule_status, "unknown");
    assert.equal(body.data.auction.is_timed, false);
    assert.equal(body.data.pricing.current_bid_usd, 1000);
    assert.equal(body.data.media.items[0], "https://images.example/car.jpg");
    assert.equal(body.release.provider_fallback, false);
  }
  const list = await (await f.worker.fetch(request("/api/cars"), f.env)).json();
  assert.ok(list.data.every(car => car.auction.state === "unknown" && car.auction.timed_end_at === null));
  assert.equal(f.networkCalls(), 0);
});

test("future and invalid observation timestamps cannot establish LIVE while legitimate future auction dates remain valid", async t => {
  const f = setup(t);
  const futureObservation = new Date(Date.now() + 3600000).toISOString();
  for (const observedAt of [futureObservation, "invalid-observation-date"]) {
    f.sqlite.prepare("UPDATE auction_listings SET summary_synced_at=? WHERE platform='iaai'").run(observedAt);
    const body = await (await f.worker.fetch(request("/api/car/SHARED-LOT?platform=iaai"), f.env)).json();
    assert.equal(body.data.read.freshness, "unknown");
    assert.equal(body.data.read.last_synced_at, observedAt, "preserve original timestamp for diagnostics/display");
    assert.equal(body.read.freshness, "unknown");
    assert.equal(body.data.auction.state, "unknown");
    assert.equal(body.data.auction.timed_end_at, null);
  }
  const fresh = await (await f.worker.fetch(request("/api/car/SHARED-LOT?platform=copart"), f.env)).json();
  assert.equal(fresh.data.read.freshness, "fresh");
  assert.equal(fresh.data.auction.state, "live");
  assert.equal(fresh.data.auction.timed_end_at, "2099-10-05T12:00:00Z");
  f.sqlite.prepare(`UPDATE auction_listings SET summary_synced_at=?,auction_state='upcoming',source_status='Upcoming',
    is_timed=0,timed_end_at=NULL WHERE platform='iaai'`).run(new Date(Date.now() - 60000).toISOString());
  const upcoming = await (await f.worker.fetch(request("/api/car/SHARED-LOT?platform=iaai"), f.env)).json();
  assert.equal(upcoming.data.read.freshness, "fresh");
  assert.equal(upcoming.data.auction.state, "upcoming");
  assert.equal(Date.parse(upcoming.data.auction.auction_at), Date.parse("2099-10-05T10:00:00Z"));
  assert.equal(f.networkCalls(), 0);
});

test("historic scope completeness is distinguished from fresh coverage across every discovery scope", async t => {
  const f = setup(t);
  const freshComplete = new Date(Date.now() - 60000).toISOString();
  f.sqlite.prepare("UPDATE provider_sync_scopes SET status='complete',cursor=NULL,last_complete_at=?").run(freshComplete);
  let body = await (await f.worker.fetch(request("/api/cars"), f.env)).json();
  assert.equal(body.meta.stored_catalog_complete, true);
  assert.equal(body.meta.catalog_complete, true);
  f.sqlite.prepare(`INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,last_complete_at,updated_at)
    VALUES('older-copart-scope','apibara','copart','discovery','complete',NULL,'2020-01-01T00:00:00Z',?)`).run(freshComplete);
  body = await (await f.worker.fetch(request("/api/cars"), f.env)).json();
  assert.equal(body.meta.stored_catalog_complete, true, "all stored scans completed historically");
  assert.equal(body.meta.catalog_complete, false, "one stale scan is not repaired by another scope's newer date");
  assert.equal(body.meta.scope_status, "stale");
  const copart = body.meta.platform_coverage.find(platform => platform.platform === "copart");
  assert.equal(copart.scope_count, 2);
  assert.equal(copart.stored_complete, true);
  assert.equal(copart.complete, false);
  assert.equal(copart.scope_freshness, "stale");
  f.sqlite.prepare("UPDATE provider_sync_scopes SET last_complete_at=NULL WHERE scope_key='older-copart-scope'").run();
  body = await (await f.worker.fetch(request("/api/filters"), f.env)).json();
  assert.equal(body.meta.catalog_complete, false);
  assert.equal(body.meta.scope_status, "unknown");
});

test("release history distinguishes snapshots from confirmed source events and keeps cursor pagination", async t => {
  const f = setup(t);
  const first = await (await f.worker.fetch(request("/api/car/SHARED-LOT/history?platform=iaai"), f.env)).json();
  assert.deepEqual(first.history, []);
  assert.equal(first.rex_history.kind, "snapshots_only");
  assert.equal(first.rex_history.snapshots[0].kind, "observed_snapshot");
  assert.equal(first.read.confirmed_event_count, 0);
  const earlier = new Date(Date.now() - 120000).toISOString();
  f.sqlite.prepare(`INSERT INTO auction_listing_snapshots(listing_id,observed_at,auction_state,current_bid_usd,fingerprint)
    VALUES('listing-iaai',?,'open',500,'earlier-snapshot')`).run(earlier);
  const page = await (await f.worker.fetch(request("/api/car/SHARED-LOT/history?platform=iaai&per_page=1"), f.env)).json();
  assert.ok(page.meta.next_cursor);
  const next = await (await f.worker.fetch(request(`/api/car/SHARED-LOT/history?platform=iaai&per_page=1&cursor=${encodeURIComponent(page.meta.next_cursor)}`), f.env)).json();
  assert.notEqual(page.rex_history.snapshots[0].snapshot_id, next.rex_history.snapshots[0].snapshot_id);
  f.sqlite.prepare(`INSERT INTO auction_events(event_id,listing_id,source_key,provider,platform,lot,sale_date,
    canonical_status,final_price_usd,observed_at,created_at,updated_at)
    VALUES('confirmed-event','listing-iaai','source-iaai','apibara','iaai','SHARED-LOT',?,'sold',4500,?,?,?)`)
    .run(earlier, earlier, earlier, earlier);
  const confirmed = await (await f.worker.fetch(request("/api/car/SHARED-LOT/history?platform=iaai"), f.env)).json();
  assert.equal(confirmed.rex_history.kind, "events_and_snapshots");
  assert.equal(confirmed.history[0].final_price, 4500);
  assert.equal(confirmed.history[0].kind, "confirmed_auction_event");
  assert.equal(f.networkCalls(), 0);
});

test("release readiness probes all consumed read schemas and real HTML assets, never just SELECT 1", async t => {
  const f = setup(t);
  const response = await f.worker.fetch(request("/ready"), f.env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "read_ready");
  assert.equal(body.checks.read_schema, "ok");
  assert.equal(body.checks.assets, "ok");
  assert.equal(body.checks.provider, "disabled");
  assert.equal(body.catalog.stored_row_count, 2);
  assert.equal(body.catalog.catalog_complete, false);
  for (const table of ["vehicle_sources", "auction_listings", "auction_events", "auction_listing_snapshots", "provider_sync_scopes"]) {
    assert.ok(f.statements.some(sql => sql.includes(`FROM ${table} LIMIT 0`)), table);
  }
  assert.ok(!f.statements.some(sql => /SELECT 1\b/.test(sql)));
  const unavailableAsset = await f.worker.fetch(request("/ready"), {...f.env,
    ASSETS: {fetch: async () => new Response("not a page", {status: 200, headers: {"Content-Type": "text/plain"}})}});
  assert.equal(unavailableAsset.status, 503);
  const countBefore = f.statements.length;
  const health = await f.worker.fetch(request("/health"), f.env);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "alive");
  assert.equal(f.statements.length, countBefore, "health does not touch D1");
  assert.equal(f.networkCalls(), 0);
});

test("missing tables or columns yield safe 503 with no provider or renderer fallback", async t => {
  const absent = setup(t, {schema: false});
  for (const route of ["/ready", "/api/cars", "/api/car/SHARED-LOT?platform=iaai", "/api/filters"]) {
    const response = await absent.worker.fetch(request(route), absent.env);
    assert.equal(response.status, 503, route);
    assert.doesNotMatch(await response.text(), /no such table|sqlite|auction_listings|vehicle_sources/i);
  }
  const missingColumn = setup(t);
  missingColumn.sqlite.exec("ALTER TABLE auction_listings DROP COLUMN media_urls_json");
  const response = await missingColumn.worker.fetch(request("/api/cars"), missingColumn.env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "release_schema_unavailable");
  assert.deepEqual(absent.delegations, []);
  assert.deepEqual(missingColumn.delegations, []);
  assert.equal(absent.networkCalls() + missingColumn.networkCalls(), 0);
});

test("empty prepared D1 reports zero stored rows and missing scope instead of staging inventory", async t => {
  const f = setup(t, {rows: false});
  const body = await (await f.worker.fetch(request("/api/cars"), f.env)).json();
  assert.deepEqual(body.data, []);
  assert.equal(body.meta.stored_row_count, 0);
  assert.equal(body.meta.catalog_complete, false);
  assert.equal(body.meta.scope_status, "missing");
  assert.equal(body.release.catalog_source, "production_d1");
});

test("operator endpoints and mutations are rejected before any D1 or renderer access", async t => {
  const f = setup(t);
  for (const route of ["/api/cars", "/api/sync/vehicle/SHARED-LOT", "/", "/kontakt.html"]) {
    assert.equal((await f.worker.fetch(request(route, {method: "POST"}), f.env)).status, 405, route);
  }
  for (const route of ["/__staging/owner-review", "/__staging/d1-sync-multiplatform", "/auth-test.html", "/api/database",
    "/api/sync/vehicle/SHARED-LOT", "/api/contact/send", "/api/unknown"]) {
    assert.equal((await f.worker.fetch(request(route), f.env)).status, 404, route);
  }
  assert.equal(f.statements.length, 0);
  assert.deepEqual(f.delegations, []);
  assert.equal(f.networkCalls(), 0);
});

test("release contact configuration stays sanitized and auth never handles cookies or external callbacks", async t => {
  const f = setup(t);
  let response = await f.worker.fetch(request("/api/contact/config"), f.env);
  assert.deepEqual(await response.json(), {email: null, mode: "local_draft"});
  response = await f.worker.fetch(request("/api/contact/config"), {...f.env, REXBID_CONTACT_EMAIL: "office@example.com"});
  assert.deepEqual(await response.json(), {email: "office@example.com", mode: "email_draft"});
  response = await f.worker.fetch(request("/api/contact/config"), {...f.env, REXBID_CONTACT_EMAIL: "office@example.com\r\nBcc:evil@example.com"});
  assert.equal((await response.json()).email, null);
  const authConfig = await (await f.worker.fetch(request("/api/auth/config"), f.env)).json();
  assert.equal(authConfig.enabled, false);
  assert.equal(authConfig.reason, "release_accounts_disabled");
  for (const [route, method] of [["/api/auth/login", "POST"], ["/api/auth/callback?code=private-code", "GET"],
    ["/api/me", "GET"], ["/api/me/export", "GET"], ["/api/me/favorites", "POST"]]) {
    response = await f.worker.fetch(request(route, {method, headers: {Cookie: "__Host-rexbid_session=untrusted"}}), f.env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.doesNotMatch(await response.text(), /private-code|untrusted/);
  }
  assert.equal(f.statements.length, 0);
  assert.deepEqual(f.delegations, []);
  assert.equal(f.networkCalls(), 0);
});

test("real car renderer permits V4 only through independent exact production activation, retaining CSP", async t => {
  const f = setup(t);
  const response = await f.worker.fetch(request("/car?lot=SHARED-LOT&platform=iaai"), {...f.env,
    APIBARA_API_KEY: "provider-private-marker", REXBID_AUTH_COOKIE_SECRET: "cookie-private-marker"});
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /window\.RexBidCalculatorV4Enabled=true/);
  assert.match(html, /\/rexbid-import-budget\.js/);
  assert.match(html, /wersja do sprawdzenia przed publikacją/);
  assert.match(response.headers.get("Content-Security-Policy"), /nonce-/);
  assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
  assert.equal(f.delegations[0].hasProviderKey, false);
  assert.equal(f.delegations[0].hasCookieSecret, false);
  for (const override of [{REXBID_PRODUCTION_RELEASE_ENABLED: "disabled"}, {REXBID_RELEASE_ORIGIN: "https://preview.rexbid.pl"},
    {REXBID_RELEASE_D1_TARGET: "rexbid-auth-test-db"}, {REXBID_RELEASE_D1_DATABASE_ID: "acb3cb8e"}]) {
    const denied = await f.renderer.fetch(request("/car"), {...f.env, ...override});
    assert.doesNotMatch(await denied.text(), /window\.RexBidCalculatorV4Enabled=true|<script[^>]+src="\/rexbid-import-budget/);
  }
  assert.equal(f.networkCalls(), 0);
});

test("review remains noindex while explicit indexing emits only canonical production public URLs", async t => {
  const f = setup(t);
  assert.equal(await (await f.worker.fetch(request("/robots.txt"), f.env)).text(), "User-agent: *\nDisallow: /\n");
  assert.equal((await f.worker.fetch(request("/sitemap.xml"), f.env)).status, 404);
  const indexedEnv = {...f.env, REXBID_RELEASE_INDEXING: "enabled"};
  const home = await f.worker.fetch(request("/"), indexedEnv);
  const html = await home.text();
  assert.equal(home.headers.get("X-Robots-Tag"), null);
  assert.match(html, /rel="canonical" href="https:\/\/rexbid\.pl\/"/);
  assert.doesNotMatch(html, /wersja do sprawdzenia przed publikacją/);
  const robots = await (await f.worker.fetch(request("/robots.txt"), indexedEnv)).text();
  assert.match(robots, /Sitemap: https:\/\/rexbid\.pl\/sitemap\.xml/);
  const sitemap = await (await f.worker.fetch(request("/sitemap.xml"), indexedEnv)).text();
  assert.match(sitemap, /https:\/\/rexbid\.pl\/kontakt\.html/);
  assert.doesNotMatch(sitemap, /workers\.dev|preview\.|konto|rejestracja/);
  const privatePage = await f.worker.fetch(request("/konto.html"), indexedEnv);
  assert.match(privatePage.headers.get("X-Robots-Tag"), /noindex/);
  const api = await f.worker.fetch(request("/api/cars"), indexedEnv);
  assert.match(api.headers.get("X-Robots-Tag"), /noindex/);
});

test("HEAD has correct status/security headers without response bodies", async t => {
  const f = setup(t);
  for (const route of ["/", "/health", "/ready", "/api/cars", "/api/contact/config", "/api/auth/config", "/robots.txt"]) {
    const response = await f.worker.fetch(request(route, {method: "HEAD"}), f.env);
    assert.equal(response.status, 200, route);
    assert.equal(await response.text(), "", route);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(f.networkCalls(), 0);
});
