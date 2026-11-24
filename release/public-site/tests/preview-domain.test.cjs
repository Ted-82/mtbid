const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {DatabaseSync} = require("node:sqlite");
const readRepository = require("../sync/d1-read-repository.js");
const readTools = require("../staging/d1-primary-reads.cjs");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://preview.rexbid.pl";
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "wrangler.preview.jsonc"), "utf8"));

function loadWorker(delegations = []) {
  const source = fs.readFileSync(path.join(ROOT, "worker.preview.js"), "utf8")
    .replace('import rexWorker from "./worker.js";', "const rexWorker = globalThis.__renderer;")
    .replace('import readRepository from "./sync/d1-read-repository.js";', "const readRepository = globalThis.__readRepository;")
    .replace('import readTools from "./staging/d1-primary-reads.cjs";', "const readTools = globalThis.__readTools;")
    .replace("export default {", "globalThis.__worker = {");
  const context = {URL, Request, Response, Headers, TypeError, RangeError, console,
    __readRepository: readRepository, __readTools: readTools,
    fetch: async () => { throw new Error("Network is forbidden in preview tests"); },
    __renderer: {async fetch(request, env) {
      delegations.push({path: new URL(request.url).pathname, auth: env.AUTH_ENABLED, sync: env.REXBID_LEGACY_SYNC_ENABLED});
      if (new URL(request.url).pathname === "/api/contact/config") return new Response(JSON.stringify({ok: true, email: null, mode: "local_draft"}), {headers: {"Content-Type": "application/json"}});
      return new Response("<!doctype html><html lang=\"pl\"><body><main>REXBID</main></body></html>",
        {headers: {"Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'nonce-test'"}});
    }}};
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.__worker;
}

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["migrations/0000_rexbid_base.sql", "migrations/0001_auction_history_events.sql",
    "migrations-staging/0003_accounts_foundation.sql", "docs/proposals/0004_d1_sync_2.sql"]) {
    sqlite.exec(fs.readFileSync(path.join(ROOT, file), "utf8"));
  }
  const seen = new Date(Date.now() - 60000).toISOString();
  for (const [platform, n] of [["copart", 1], ["iaai", 2]]) {
    sqlite.prepare(`INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,updated_at)
      VALUES(?,'apibara',?,'discovery','partial','stored-next',?)`).run(`scope-${platform}`, platform, seen);
    sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,provider_vehicle_id,identity_kind,identity_state,
      first_seen_at,last_seen_at,last_attempt_at,last_success_at,sync_status,created_at,updated_at)
      VALUES(?,'apibara',?,?,'provider_vehicle_id','resolved',?,?,?,?,'idle',?,?)`)
      .run(`source-${platform}`, platform, `provider-${platform}`, seen, seen, seen, seen, seen, seen);
    sqlite.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,listing_identity_kind,identity_state,
      source_listing_id,vin_normalized,lot,vehicle_title,make,model,year,auction_state,source_status,auction_at,
      is_timed,current_bid_usd,buy_now_usd,fuel_type,first_seen_at,last_seen_at,summary_synced_at,freshness_class,fingerprint,created_at,updated_at)
      VALUES(?,?,?,'source_listing_id','resolved','SHARED-LOT',?,'SHARED-LOT',?,'Honda','Civic',2022,
      'open','Open','2099-10-05T10:00:00Z',0,1000,5000,'Gasoline',?,?,?,'warm',?,?,?)`)
      .run(`listing-${platform}`, `source-${platform}`, platform, `TESTVIN00000000000${n}`, `${platform} Honda Civic`,
        seen, seen, seen, `fp-${platform}`, seen, seen);
    sqlite.prepare(`INSERT INTO auction_listing_snapshots(listing_id,observed_at,auction_state,auction_at,
      current_bid_usd,fingerprint,normalizer_version) VALUES(?,?,'open','2099-10-05T10:00:00Z',1000,?,1)`)
      .run(`listing-${platform}`, seen, `snap-${platform}`);
  }
  const statements = [];
  const d1 = {prepare(sql) {
    statements.push(sql);
    assert.match(sql.trim(), /^SELECT\b/i, "preview is physically read-only at the D1 adapter");
    const query = parameters => ({
      async first() { return sqlite.prepare(sql).get(...parameters) ?? null; },
      async all() { return {results: sqlite.prepare(sql).all(...parameters)}; }
    });
    return {...query([]), bind(...parameters) { return query(parameters); }};
  }};
  const env = {...config.vars, REXBID_DB: d1,
    ASSETS: {async fetch() { return new Response("User-agent: *\nDisallow: /\n"); }}};
  return {sqlite, d1, env, statements};
}

const request = (route, options, origin = ORIGIN) => new Request(origin + route, options);

test("preview configuration contains only the review subdomain and isolated staging D1", () => {
  assert.equal(config.name, "rexbid-preview");
  assert.equal(config.main, "./worker.preview.js");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{pattern: "preview.rexbid.pl", custom_domain: true}]);
  assert.equal(config.assets.run_worker_first, true, "all paths must pass the read-only guard");
  assert.equal(config.d1_databases.length, 1);
  assert.equal(config.d1_databases[0].database_name, "rexbid-auth-test-db");
  assert.equal(config.d1_databases[0].database_id, "acb3cb8e-69a2-459f-8a46-0f2f5b9004be");
  assert.equal(config.vars.AUTH_ENABLED, "false");
  assert.equal(config.vars.REXBID_LEGACY_SYNC_ENABLED, "false");
  assert.equal(config.vars.REXBID_CALCULATOR_V4_ALLOWED_ORIGINS, ORIGIN);
  assert.equal(config.triggers, undefined);
  assert.doesNotMatch(JSON.stringify(config), /staging-bypass|APIBARA_API_KEY|SUPABASE|971879fe|migrations_dir/);
});

test("preview rejects wrong HTTPS origin, HTTP, missing flags and production target", async () => {
  const worker = loadWorker();
  const {sqlite, env, statements} = setup();
  for (const origin of ["http://preview.rexbid.pl", "https://rexbid.pl", "https://preview.rexbid.pl.evil.example",
    "https://rexbid-auth-test.tedn828.workers.dev", "https://preview.rexbid.pl:444"]) {
    const response = await worker.fetch(request("/api/cars", undefined, origin), env);
    assert.equal(response.status, 404, origin);
  }
  for (const override of [{REXBID_PREVIEW_ENABLED: "disabled"}, {REXBID_PREVIEW_ORIGIN: "https://rexbid.pl"},
    {REXBID_PREVIEW_D1_TARGET: "rexbid-db"}, {REXBID_PREVIEW_D1_DATABASE_ID: "971879fe-04ed-4e8c-9dc6-5306980bb872"},
    {AUTH_ENABLED: "true"}, {REXBID_LEGACY_SYNC_ENABLED: "true"}]) {
    assert.equal((await worker.fetch(request("/api/cars"), {...env, ...override})).status, 404);
  }
  assert.equal(statements.length, 0);
  sqlite.close();
});

test("catalog, filtered pagination and metadata use SELECT only and preserve partial scope", async () => {
  const delegations = [];
  const worker = loadWorker(delegations);
  const {sqlite, env, statements} = setup();
  const first = await worker.fetch(request("/api/cars?per_page=1"), env);
  const body = await first.json();
  assert.equal(first.status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.meta.catalog_complete, false);
  assert.equal(body.meta.known_rows_only, true);
  assert.equal(body.preview.provider_fallback, false);
  assert.ok(body.meta.next_cursor);
  const next = await (await worker.fetch(request(`/api/cars?per_page=1&cursor=${encodeURIComponent(body.meta.next_cursor)}`), env)).json();
  assert.equal(next.data.length, 1);
  assert.notEqual(next.data[0].platform, body.data[0].platform);
  const filtered = await (await worker.fetch(request("/api/cars?platform=iaai&search=SHARED-LOT"), env)).json();
  assert.equal(filtered.data.length, 1);
  assert.equal(filtered.data[0].platform, "iaai");
  const filters = await (await worker.fetch(request("/api/filters?platform=copart"), env)).json();
  assert.equal(filters.meta.metadata_complete, false);
  assert.equal(filters.data.makes[0].value, "Honda");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_listings").get().n, 2);
  assert.ok(statements.length > 0);
  assert.deepEqual(delegations, []);
  sqlite.close();
});

test("exact LOT/platform and VIN resolve while ambiguous or missing data never invoke a provider", async () => {
  const delegations = [];
  const worker = loadWorker(delegations);
  const {sqlite, env} = setup();
  assert.equal((await worker.fetch(request("/api/car/SHARED-LOT"), env)).status, 409);
  const lot = await (await worker.fetch(request("/api/car/SHARED-LOT?platform=iaai"), env)).json();
  assert.equal(lot.data.platform, "iaai");
  assert.equal(lot.match, "exact");
  const vin = await (await worker.fetch(request("/api/car/TESTVIN000000000001"), env)).json();
  assert.equal(vin.data.platform, "copart");
  const missing = await worker.fetch(request("/api/car/NOT-STORED?platform=copart"), env);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "preview_vehicle_not_stored");
  assert.equal((await worker.fetch(request("/api/car/%2F"), env)).status, 400);
  assert.deepEqual(delegations, []);
  sqlite.close();
});

test("stale stored details remain explicitly dated and suppress live countdown facts", async () => {
  const worker = loadWorker();
  const {sqlite, env} = setup();
  sqlite.prepare("UPDATE auction_listings SET summary_synced_at='2020-01-01T00:00:00Z' WHERE platform='copart'").run();
  const response = await worker.fetch(request("/api/car/SHARED-LOT?platform=copart"), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.read.freshness, "stale");
  assert.equal(body.data.preview.last_synced_at, "2020-01-01T00:00:00Z");
  assert.equal(body.data.auction.state, "unknown");
  assert.equal(body.data.auction.auction_at, null);
  assert.equal(body.data.auction.timed_end_at, null);
  assert.equal(body.data.pricing.current_bid_usd, 1000, "retain observed price with preview freshness");
  assert.equal(body.preview.provider_fallback, false);
  sqlite.close();
});

test("preview history keeps observed snapshots distinct from confirmed sale events", async () => {
  const worker = loadWorker();
  const {sqlite, env} = setup();
  const response = await worker.fetch(request("/api/car/SHARED-LOT/history?platform=iaai"), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.history, []);
  assert.equal(body.rex_history.kind, "snapshots_only");
  assert.equal(body.rex_history.snapshots[0].kind, "observed_snapshot");
  assert.equal(body.read.confirmed_event_count, 0);
  sqlite.close();
});

test("all mutations, operator paths and unknown API routes are stopped before the shared Worker", async () => {
  const delegations = [];
  const worker = loadWorker(delegations);
  const {sqlite, env, statements} = setup();
  for (const route of ["/api/cars", "/api/sync/vehicle/SHARED-LOT", "/", "/kontakt.html"]) {
    assert.equal((await worker.fetch(request(route, {method: "POST"}), env)).status, 405, route);
  }
  for (const route of ["/__staging/owner-review", "/__staging/d1-sync-multiplatform", "/auth-test.html", "/api/database", "/api/sync/vehicle/SHARED-LOT"]) {
    assert.equal((await worker.fetch(request(route), env)).status, 404, route);
  }
  assert.deepEqual(delegations, []);
  assert.equal(statements.length, 0);
  sqlite.close();
});

test("auth config explains disabled accounts and every account API fails without cookie handling", async () => {
  const delegations = [];
  const worker = loadWorker(delegations);
  const {sqlite, env, statements} = setup();
  const configResponse = await worker.fetch(request("/api/auth/config"), env);
  const body = await configResponse.json();
  assert.equal(configResponse.status, 200);
  assert.equal(body.enabled, false);
  assert.equal(body.reason, "preview_read_only");
  assert.match(body.message, /wyłączone w podglądzie/);
  for (const [route, method] of [["/api/auth/login", "POST"], ["/api/auth/callback?code=anything", "GET"],
    ["/api/me", "GET"], ["/api/me/favorites", "POST"]]) {
    const response = await worker.fetch(request(route, {method, headers: {Cookie: "rex_bid_session=untrusted"}}), env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal((await response.json()).code, "preview_accounts_disabled");
  }
  assert.deepEqual(delegations, []);
  assert.equal(statements.length, 0);
  sqlite.close();
});

test("preview HTML/assets retain renderer CSP, display notice and never advertise indexing", async () => {
  const delegations = [];
  const worker = loadWorker(delegations);
  const {sqlite, env} = setup();
  const response = await worker.fetch(request("/car?lot=SHARED-LOT&platform=iaai"), env);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Podgląd REXBID/);
  assert.match(html, /bez odświeżania aukcji/);
  assert.match(response.headers.get("Content-Security-Policy"), /nonce-test/);
  assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(delegations[0].auth, "false");
  assert.equal(delegations[0].sync, "false");
  const robots = await worker.fetch(request("/robots.txt"), env);
  assert.equal(await robots.text(), "User-agent: *\nDisallow: /\n");
  assert.equal((await worker.fetch(request("/sitemap.xml"), env)).status, 404);
  const ready = await worker.fetch(request("/ready"), env);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, "preview_ready");
  sqlite.close();
});

test("D1 failure is a safe unavailable response with no API delegation", async () => {
  const delegations = [];
  const worker = loadWorker(delegations);
  const {sqlite, env} = setup();
  const response = await worker.fetch(request("/api/cars"), {...env, REXBID_DB: {prepare() {throw new Error("private database detail");}}});
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.doesNotMatch(text, /private database detail/);
  assert.deepEqual(delegations, []);
  sqlite.close();
});

test("only the public contact config can reach the shared configuration handler", async () => {
  const delegations = [];
  const worker = loadWorker(delegations);
  const {sqlite, env, statements} = setup();
  const response = await worker.fetch(request("/api/contact/config"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, "local_draft");
  assert.deepEqual(delegations.map(item => item.path), ["/api/contact/config"]);
  assert.equal((await worker.fetch(request("/api/contact/config", {method: "POST"}), env)).status, 405);
  assert.equal((await worker.fetch(request("/api/contact/send"), env)).status, 404);
  assert.equal(delegations.length, 1);
  assert.equal(statements.length, 0);
  sqlite.close();
});
