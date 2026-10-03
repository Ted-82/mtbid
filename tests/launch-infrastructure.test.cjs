const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { validateWorkerConfigs } = require("../scripts/validate-worker-config.cjs");

const ROOT = path.resolve(__dirname, "..");
const workerSource = fs.readFileSync(path.join(ROOT, "worker.js"), "utf8");

function loadWorker({ assets, db, logs = [], fetchImpl = async () => { throw new Error("no network in test"); } } = {}) {
  const source = workerSource
    .replace('import apibaraModule from "./providers/apibara.js";', "const apibaraModule = globalThis.__apibara;")
    .replace('import contract from "./providers/contract.js";', "const contract = globalThis.__contract;")
    .replace('import authProviderModule from "./auth/supabase.js";', "const authProviderModule = globalThis.__authProvider;")
    .replace('import accountsModule from "./auth/routes.js";', "const accountsModule = globalThis.__accounts;")
    .replace('import providerBudgetModule from "./providers/request-budget.js";', "const providerBudgetModule = globalThis.__providerBudget;")
    .replace("export default {", "globalThis.__worker = {");
  const context = {
    URL, URLSearchParams, Request, Response, Headers, AbortController,
    crypto: require("node:crypto").webcrypto,
    __apibara: require("../providers/apibara.js"), __contract: require("../providers/contract.js"),
    __authProvider: require("../auth/supabase.js"), __accounts: require("../auth/routes.js"),
    __providerBudget: require("../providers/request-budget.js"),
    fetch: fetchImpl,
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    caches: { default: { match: async () => null, put: async () => {} } }
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__workerInternals={applySecurityHeaders,safeRoute,safeErrorCode};`, context);
  context.__env = {
    APIBARA_API_KEY: "fixture-key-never-log",
    REXBID_DB: db || { prepare(sql) { return { first: async () => /SELECT 1/.test(sql) ? { ready: 1 } : null }; } },
    ASSETS: assets || { fetch: async request => new Response(request.url.endsWith("robots.txt") ? "User-agent: *" : "<!doctype html><html><head><title>Fixture</title></head><body><script>window.ok=true</script></body></html>", { status: 200, headers: { "Content-Type": request.url.endsWith("robots.txt") ? "text/plain" : "text/html; charset=utf-8" } }) }
  };
  return context;
}

test("Worker live/config files keep production and staging bindings isolated and staging-only routes out of production", () => {
  const result = validateWorkerConfigs(ROOT);
  assert.equal(result.ok, true, result.issues.join(", "));
  assert.equal(result.production.worker, "mtbid");
  assert.equal(result.production.database, "rexbid-db");
  assert.equal(result.staging.worker, "rexbid-auth-test");
  assert.equal(result.staging.database, "rexbid-auth-test-db");
  assert.equal(result.staging.prototype_enabled, false);
  assert.equal(result.production.provider_traffic_fail_closed, true);
  assert.equal(result.production.provider_budget_configured, true);
  assert.equal(result.production.provider_budget_schema_prepared, true);
  assert.deepEqual(result.production.provider_operation_limits, {catalog:"250",detail:"150",history:"60",discovery:"0",media:"0"});
  assert.equal(result.production.d1_primary_reads_enabled, false);
  assert.equal(result.production.cron_enabled, false);
  assert.equal(result.staging.provider_budget_configured, true);
  assert.equal(result.staging.provider_daily_limit, "500");
  const productionConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8"));
  const stagingConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "wrangler.staging.jsonc"), "utf8"));
  assert.notEqual(productionConfig.vars?.REXBID_PHASE_G_MULTIPLATFORM, "enabled", "Phase G runner must remain unavailable in production");
  assert.equal(productionConfig.vars?.REXBID_D1_PRIMARY_READS, "false", "production must explicitly default to provider-backed reads");
  assert.equal(productionConfig.vars?.REXBID_LEGACY_SYNC_ENABLED, "false", "legacy provider-backed writes stay disabled until Sync schema is installed");
  assert.equal(stagingConfig.vars?.REXBID_PHASE_G_MULTIPLATFORM, "enabled", "multi-platform continuation is explicitly enabled only on isolated staging");
  for (const configName of ["wrangler.jsonc", "wrangler.staging.jsonc"]) {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, configName), "utf8"));
    for (const route of ["/", "/car*", "/*.html", "/konto", "/ulubione", "/logowanie", "/rejestracja", "/reset-hasla", "/robots.txt", "/sitemap.xml", "/rexbid-door-estimator.js", "/rexbid-door-estimator-rates.js", "/rexbid-transport-rates.js", "/rexbid-transport-engine.js", "/rexbid-calculator-v3-rates.js"]) {
      assert.ok(config.assets.run_worker_first.includes(route), `${configName} must invoke Worker before ${route}`);
    }
    if (configName === "wrangler.jsonc") assert.notEqual(config.vars?.REXBID_TRANSPORT_CALCULATOR_ENABLED, "enabled", "partner calculator must not be activated on production config");
    if (configName === "wrangler.jsonc") assert.notEqual(config.vars?.REXBID_CALCULATOR_V3_ENABLED, "enabled", "Calculator V3 must remain disabled in production config");
    if (configName === "wrangler.staging.jsonc") assert.equal(config.vars?.REXBID_CALCULATOR_V3_ENABLED, "enabled", "Calculator V3 is explicitly enabled for staging verification only");
  }
});

test("health is liveness-only and readiness reports D1/assets/provider/Auth state without secrets", async () => {
  const logs = [];
  let d1Queries = 0;
  const context = loadWorker({ logs, db: { prepare(sql) { d1Queries++; return { first: async () => ({ ready: 1 }) }; } } });
  const health = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/health"), context.__env);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, status: "alive" });
  assert.equal(d1Queries, 0);
  const ready = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/ready"), context.__env);
  const payload = await ready.json();
  assert.equal(ready.status, 200);
  assert.equal(payload.checks.d1, "ok");
  assert.equal(payload.checks.assets, "ok");
  assert.equal(payload.checks.provider, "configured");
  assert.deepEqual(payload.checks.auth, { enabled: false, configured: null });
  assert.doesNotMatch(JSON.stringify(payload), /fixture-key-never-log|SUPABASE|secret/i);
  assert.equal(d1Queries, 1);
});

test("readiness fails closed on missing D1/provider and enabled but incomplete Auth", async () => {
  const context = loadWorker({ db: { prepare() { return { first: async () => { throw new Error("private db error"); } }; } } });
  const env = { ...context.__env, APIBARA_API_KEY: "", AUTH_ENABLED: "true" };
  const response = await context.__worker.fetch(new Request("https://rex.test/ready"), env);
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.status, "not_ready");
  assert.equal(payload.checks.d1, "unavailable");
  assert.equal(payload.checks.provider, "not_configured");
  assert.equal(payload.checks.auth.enabled, true);
  assert.equal(payload.checks.auth.configured, false);
  assert.doesNotMatch(JSON.stringify(payload), /private db error|fixture-key/);
});

test("bounded pre-Sync budget/schema failure is a safe 503 before provider fetch for public reads and sync writes stay disabled", async () => {
  let upstreamCalls = 0;
  const logs = [];
  const context = loadWorker({
    logs,
    db: { prepare() { return { first: async () => null, run: async () => ({success:true}) }; } },
    fetchImpl: async () => { upstreamCalls++; return new Response("unexpected upstream"); }
  });
  const env = {
    ...context.__env,
    REXBID_PROVIDER_BUDGET_MODE: "required",
    REXBID_PROVIDER_BUDGET_DAILY_LIMIT: "500",
    REXBID_PROVIDER_BUDGET_CATALOG_DAILY_LIMIT: "250",
    REXBID_PROVIDER_BUDGET_DETAIL_DAILY_LIMIT: "150",
    REXBID_PROVIDER_BUDGET_HISTORY_DAILY_LIMIT: "60",
    REXBID_PROVIDER_BUDGET_DISCOVERY_DAILY_LIMIT: "0",
    REXBID_PROVIDER_BUDGET_MEDIA_DAILY_LIMIT: "0",
    REXBID_LEGACY_SYNC_ENABLED: "false",
    REXBID_SYNC_TOKEN: "s".repeat(40)
  };
  for (const [route, expectedStatus] of [["/api/cars",503],["/api/filters",503],["/api/cars?search=1HGCM82633A004352",503],["/api/cars?search=64693505",503],["/api/car/64693505?platform=copart",503],["/api/car/64693505/history?platform=copart",200]]) {
    const response = await context.__worker.fetch(new Request(`https://mtbid.tedn828.workers.dev${route}`), env);
    const body = await response.text();
    assert.equal(response.status, expectedStatus, `${route}: ${body}; ${JSON.stringify(logs)}`);
    assert.match(body, /dostępny|chwilowo niedostępny|"error":"Dane historii są chwilowo niedostępne\."/iu);
  }
  const sync = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/api/sync/vehicle/64693505", {
    method: "POST", headers: {Authorization: `Bearer ${env.REXBID_SYNC_TOKEN}`}
  }), env);
  assert.equal(sync.status, 503);
  assert.equal(upstreamCalls, 0);
});

test("public provider reads fail safely without an API key before any upstream fetch", async () => {
  let upstreamCalls = 0;
  const context = loadWorker({
    db: { prepare() { return { first: async () => null, run: async () => ({success:true}) }; } },
    fetchImpl: async () => { upstreamCalls++; return new Response("unexpected upstream body", {status: 200}); }
  });
  const env = {
    ...context.__env,
    APIBARA_API_KEY: "",
    REXBID_PROVIDER_BUDGET_MODE: "required",
    REXBID_PROVIDER_BUDGET_DAILY_LIMIT: "500",
    REXBID_PROVIDER_BUDGET_CATALOG_DAILY_LIMIT: "250",
    REXBID_PROVIDER_BUDGET_DETAIL_DAILY_LIMIT: "150",
    REXBID_PROVIDER_BUDGET_HISTORY_DAILY_LIMIT: "60",
    REXBID_PROVIDER_BUDGET_DISCOVERY_DAILY_LIMIT: "0",
    REXBID_PROVIDER_BUDGET_MEDIA_DAILY_LIMIT: "0"
  };
  for (const route of ["/api/cars", "/api/filters", "/api/cars?search=64693505"]) {
    const response = await context.__worker.fetch(new Request(`https://mtbid.tedn828.workers.dev${route}`), env);
    assert.equal(response.status, 503, route);
    assert.match(await response.text(), /dostawca danych jest niedostępny/iu);
  }
  assert.equal(upstreamCalls, 0, "missing API key must be rejected before upstream fetch");
});

test("HTML gets nonce CSP/security headers; private pages are no-store and noindex", async () => {
  const context = loadWorker();
  const home = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/"), { ...context.__env, REXBID_CANONICAL_ORIGIN: "https://mtbid.tedn828.workers.dev" });
  const html = await home.text();
  const policy = home.headers.get("Content-Security-Policy");
  const nonce = policy.match(/'nonce-([a-f0-9]+)'/)[1];
  assert.match(html, new RegExp(`<script nonce="${nonce}">`));
  assert.equal(home.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(home.headers.get("X-Frame-Options"), "DENY");
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.match(html, /rel="canonical" href="https:\/\/mtbid\.tedn828\.workers\.dev\/"/);
  const privatePage = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/konto.html"), context.__env);
  assert.equal(privatePage.headers.get("Cache-Control"), "private, no-store");
  assert.equal(privatePage.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.match(privatePage.headers.get("Vary"), /Cookie/);
  const cleanUrlPrivatePage = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/konto"), context.__env);
  assert.equal(cleanUrlPrivatePage.headers.get("Cache-Control"), "private, no-store");
  assert.equal(cleanUrlPrivatePage.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

test("real car HTML gates partner transport and Calculator V3 behind explicit staging flags", async () => {
  const carHtml = fs.readFileSync(path.join(ROOT, "public/car.html"), "utf8");
  const context = loadWorker({ assets: { fetch: async () => new Response(carHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }) } });
  const production = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/car.html?vin=TESTVIN"), { ...context.__env, REXBID_CALCULATOR_V3_ENABLED: "enabled" });
  const productionHtml = await production.text();
  assert.doesNotMatch(productionHtml, /id="partnerTransportCalculator"|rexbid-transport-(?:rates|engine)\.js|rexbid-calculator-v3-rates\.js|data-calculator-v3-only|RexBidCalculatorV3Enabled=true/);
  assert.match(productionHtml, /property="og:title"/);
  assert.match(productionHtml, /name="description"/);
  assert.equal(production.headers.get("Cache-Control"), "no-cache");
  const staging = await context.__worker.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/car.html"), { ...context.__env, REXBID_TRANSPORT_CALCULATOR_ENABLED: "enabled", REXBID_CALCULATOR_V3_ENABLED: "enabled" });
  const stagingHtml = await staging.text();
  assert.match(stagingHtml, /id="partnerTransportCalculator"/);
  assert.match(stagingHtml, /rexbid-transport-engine\.js/);
  assert.match(stagingHtml, /rexbid-calculator-v3-rates\.js/);
  assert.match(stagingHtml, /RexBidCalculatorV3Enabled=true/);
  assert.match(stagingHtml, /data-calculator-v3-only/);
  assert.match(stagingHtml, /id="calculatorV3Summary"/);
  assert.doesNotMatch(stagingHtml, /id="estimatedDoorCalculator"|rexbid-door-estimator(?:-rates)?\.js/);
  const stagingExtensionless = await context.__worker.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/car?vin=TESTVIN"), { ...context.__env, REXBID_TRANSPORT_CALCULATOR_ENABLED: "enabled", REXBID_CALCULATOR_V3_ENABLED: "enabled" });
  const stagingExtensionlessHtml = await stagingExtensionless.text();
  assert.match(stagingExtensionlessHtml, /rexbid-calculator-v3-rates\.js/);
  assert.match(stagingExtensionlessHtml, /RexBidCalculatorV3Enabled=true/);
  assert.match(stagingExtensionlessHtml, /data-calculator-v3-only/);
  const productionExtensionless = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/car?vin=TESTVIN"), { ...context.__env, REXBID_TRANSPORT_CALCULATOR_ENABLED: "enabled", REXBID_CALCULATOR_V3_ENABLED: "enabled" });
  const productionExtensionlessHtml = await productionExtensionless.text();
  assert.doesNotMatch(productionExtensionlessHtml, /rexbid-calculator-v3-rates\.js|data-calculator-v3-only|RexBidCalculatorV3Enabled=true/);
  const prototypeAsset = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/rexbid-door-estimator.js"), context.__env);
  assert.equal(prototypeAsset.status, 404, "prototype bundles must not be publicly fetched in production");
  const stagingAsset = await context.__worker.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/rexbid-door-estimator.js"), { ...context.__env, REXBID_DOOR_ESTIMATOR_PROTOTYPE: "enabled" });
  assert.equal(stagingAsset.status, 200, "explicit staging configuration may serve the prototype asset");
  const productionTransportAsset = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/rexbid-transport-engine.js"), context.__env);
  assert.equal(productionTransportAsset.status, 404, "partner transport calculator bundle is disabled on production by default");
  const stagingTransportAsset = await context.__worker.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/rexbid-transport-engine.js"), { ...context.__env, REXBID_TRANSPORT_CALCULATOR_ENABLED: "enabled" });
  assert.equal(stagingTransportAsset.status, 200);
  const productionV3Rates = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/rexbid-calculator-v3-rates.js"), { ...context.__env, REXBID_CALCULATOR_V3_ENABLED: "enabled" });
  assert.equal(productionV3Rates.status, 404, "V3 rate config cannot be fetched from production unless explicitly enabled");
  const stagingV3Rates = await context.__worker.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/rexbid-calculator-v3-rates.js"), { ...context.__env, REXBID_CALCULATOR_V3_ENABLED: "enabled" });
  assert.equal(stagingV3Rates.status, 200);
});

test("unknown routes return a safe branded 404 rather than a blank/stack page", async () => {
  const context = loadWorker({ assets: { fetch: async () => new Response("asset miss", { status: 404 }) } });
  const response = await context.__worker.fetch(new Request("https://rex.test/does-not-exist"), context.__env);
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.match(body, /Nie znaleziono strony/);
  assert.doesNotMatch(body, /stack|TypeError|asset miss/);
});

test("Worker converts an asset/runtime exception into a generic no-store 500 without leaking details", async () => {
  const context = loadWorker({ assets: { fetch: async () => { throw new Error("PRIVATE_ASSET_FAILURE_MARKER"); } } });
  const response = await context.__worker.fetch(new Request("https://rex.test/"), context.__env);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.text();
  assert.match(body, /Chwilowa niedostępność|chwilowy problem/iu);
  assert.doesNotMatch(body, /PRIVATE_ASSET_FAILURE_MARKER|stack|Error:/);
});

test("staging wrapper applies noindex to every response and serves blocking robots policy", async () => {
  let stagingSource = fs.readFileSync(path.join(ROOT, "worker.staging.js"), "utf8")
    .replace('import rexWorker from "./worker.js";', "const rexWorker = globalThis.__baseWorker;")
    .replace('import authTestHtml from "./staging/auth-test-page.js";', 'const authTestHtml = "<!doctype html><html><head><title>Auth test</title></head><body>test</body></html>";')
    .replace('import requestCorrelation from "./staging/request-correlation.cjs";', "const requestCorrelation = globalThis.__correlation;")
    .replace('import phaseG from "./staging/phase-g-multiplatform-backfill.cjs";', "const phaseG = globalThis.__phaseG;")
    .replace('import d1Read from "./staging/d1-read-routes.cjs";', "const d1Read = globalThis.__d1Read;")
    .replace('import d1Primary from "./staging/d1-primary-reads.cjs";', "const d1Primary = globalThis.__d1Primary;")
    .replace("export default {", "globalThis.__staging = {");
  const context = {
    URL, Request, Response, Headers,
    __baseWorker: { fetch: async () => new Response("ok", { status: 200 }) },
    __correlation: { authOperation: () => "", correlateRequest: request => ({ request, requestId: "" }), correlateResponse: response => response },
    __phaseG: { handlePhaseGRequest: async () => null },
    __d1Read: { handleD1ReadRequest: async () => null },
    __d1Primary: { handlePrimaryRead: async () => null }
  };
  vm.createContext(context); vm.runInContext(stagingSource, context);
  const env = { REXBID_AUTH_TEST_UI: "enabled", REXBID_AUTH_TEST_HOST: "rexbid-auth-test.tedn828.workers.dev" };
  const page = await context.__staging.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/"), env);
  assert.equal(page.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  const robots = await context.__staging.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/robots.txt"), env);
  assert.equal(robots.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  assert.match(await robots.text(), /Disallow: \/$/m);
  const sitemap = await context.__staging.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/sitemap.xml"), env);
  assert.equal(sitemap.status, 404);
  assert.equal(sitemap.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  const testUi = await context.__staging.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/auth-test.html"), env);
  assert.equal(testUi.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  const wrongHost = await context.__staging.fetch(new Request("https://mtbid.tedn828.workers.dev/auth-test.html"), env);
  assert.equal(wrongHost.status, 404);
});

test("request logs use route templates and never include VIN, auth values, body or provider secrets", async () => {
  const logs = [];
  const context = loadWorker({ logs, fetchImpl: async () => { throw new Error("provider failure fixture-key-never-log private@example.invalid"); } });
  const response = await context.__worker.fetch(new Request("https://rex.test/api/car/1HGCM82633A004352"), context.__env);
  assert.ok(response.status >= 400);
  const serialized = JSON.stringify(logs);
  assert.match(serialized, /request_id/);
  assert.match(serialized, /route/);
  assert.match(serialized, /duration_ms/);
  assert.doesNotMatch(serialized, /1HGCM82633A004352|fixture-key-never-log|private@example\.invalid|provider failure/);
});

test("car page uses the partner transport model instead of superseded public estimates and SEO excludes private pages", () => {
  const car = fs.readFileSync(path.join(ROOT, "public/car.html"), "utf8");
  const robots = fs.readFileSync(path.join(ROOT, "public/robots.txt"), "utf8");
  const sitemap = fs.readFileSync(path.join(ROOT, "public/sitemap.xml"), "utf8");
  assert.match(car, /Stawki partnera Rex\.Bid/);
  assert.match(car, /nie gwarantowana oferta ani rozliczenie celne/i);
  assert.doesNotMatch(car, /Orientacyjne widełki dostawy auta|Orientacyjna kalkulacja na podstawie publicznych danych rynkowych/i);
  assert.match(robots, /Disallow: \/konto\.html/);
  assert.doesNotMatch(sitemap, /konto|ulubione|logowanie|rejestracja|reset-hasla/);
  assert.equal(fs.existsSync(path.join(ROOT, "public/auth-test.html")), false);
});

test("real public HTML contains no inline event handlers blocked by the production CSP", () => {
  const publicDir = path.join(ROOT, "public");
  const pages = fs.readdirSync(publicDir).filter(file => file.endsWith(".html"));
  const offenders = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    if (/\son[a-z]+\s*=/i.test(html)) offenders.push(page);
  }
  assert.deepEqual(offenders, []);
});
