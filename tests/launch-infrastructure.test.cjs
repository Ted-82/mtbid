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
    .replace("export default {", "globalThis.__worker = {");
  const context = {
    URL, URLSearchParams, Request, Response, Headers, AbortController,
    crypto: require("node:crypto").webcrypto,
    __apibara: require("../providers/apibara.js"), __contract: require("../providers/contract.js"),
    __authProvider: require("../auth/supabase.js"), __accounts: require("../auth/routes.js"),
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
  for (const configName of ["wrangler.jsonc", "wrangler.staging.jsonc"]) {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, configName), "utf8"));
    for (const route of ["/", "/*.html", "/konto", "/ulubione", "/logowanie", "/rejestracja", "/reset-hasla", "/robots.txt", "/sitemap.xml", "/rexbid-door-estimator.js", "/rexbid-door-estimator-rates.js"]) {
      assert.ok(config.assets.run_worker_first.includes(route), `${configName} must invoke Worker before ${route}`);
    }
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

test("real car HTML receives SEO metadata and hides the unapproved door estimator unless explicitly staging-enabled", async () => {
  const carHtml = fs.readFileSync(path.join(ROOT, "public/car.html"), "utf8");
  const context = loadWorker({ assets: { fetch: async () => new Response(carHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }) } });
  const production = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/car.html?vin=TESTVIN"), context.__env);
  const productionHtml = await production.text();
  assert.doesNotMatch(productionHtml, /id="estimatedDoorCalculator"|rexbid-door-estimator(?:-rates)?\.js/);
  assert.match(productionHtml, /property="og:title"/);
  assert.match(productionHtml, /name="description"/);
  assert.equal(production.headers.get("Cache-Control"), "no-cache");
  const staging = await context.__worker.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/car.html"), { ...context.__env, REXBID_DOOR_ESTIMATOR_PROTOTYPE: "enabled" });
  const stagingHtml = await staging.text();
  assert.match(stagingHtml, /id="estimatedDoorCalculator"/);
  assert.match(stagingHtml, /rexbid-door-estimator\.js/);
  const prototypeAsset = await context.__worker.fetch(new Request("https://mtbid.tedn828.workers.dev/rexbid-door-estimator.js"), context.__env);
  assert.equal(prototypeAsset.status, 404, "prototype bundles must not be publicly fetched in production");
  const stagingAsset = await context.__worker.fetch(new Request("https://rexbid-auth-test.tedn828.workers.dev/rexbid-door-estimator.js"), { ...context.__env, REXBID_DOOR_ESTIMATOR_PROTOTYPE: "enabled" });
  assert.equal(stagingAsset.status, 200, "explicit staging configuration may serve the prototype asset");
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
    .replace('import phaseD from "./staging/phase-d-discovery.cjs";', "const phaseD = globalThis.__phaseD;")
    .replace('import phaseF from "./staging/phase-f-backfill.cjs";', "const phaseF = globalThis.__phaseF;")
    .replace('import d1Read from "./staging/d1-read-routes.cjs";', "const d1Read = globalThis.__d1Read;")
    .replace("export default {", "globalThis.__staging = {");
  const context = {
    URL, Request, Response, Headers,
    __baseWorker: { fetch: async () => new Response("ok", { status: 200 }) },
    __correlation: { authOperation: () => "", correlateRequest: request => ({ request, requestId: "" }), correlateResponse: response => response },
    __phaseD: { handlePhaseDRequest: async () => null },
    __phaseF: { handlePhaseFRequest: async () => null },
    __d1Read: { handleD1ReadRequest: async () => null }
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

test("production pages mark the door-to-door calculator as a prototype and public SEO files exclude private pages", () => {
  const car = fs.readFileSync(path.join(ROOT, "public/car.html"), "utf8");
  const robots = fs.readFileSync(path.join(ROOT, "public/robots.txt"), "utf8");
  const sitemap = fs.readFileSync(path.join(ROOT, "public/sitemap.xml"), "utf8");
  assert.match(car, /Orientacyjne widełki|Orientacyjna kalkulacja/);
  assert.match(car, /to nie jest oferta transportowa ani rozliczenie celne/i);
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
