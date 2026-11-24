'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const {buildPublicationConfig, buildAutomaticPublicationConfig, validatePublicationConfig, inspectPublicationEvidence, generatedProfileConsistent, BASE_EVIDENCE, OWNER_EVIDENCE,
  PORTAL_EVIDENCE} = require('../scripts/prepare-production-publication.cjs');
const base = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'wrangler.production-preflight.jsonc'), 'utf8'));
const request = (pathname, options = {}, origin = 'https://rexbid.pl') => new Request(origin + pathname, options);

// Exercise the native HTMLRewriter handler contract against real page DOM.
// Cloudflare streaming itself is not a browser/provider production E2E test.
class PageHtmlRewriter {
  constructor() { this.handlers = []; }
  on(selector, handler) { this.handlers.push([selector, handler]); return this; }
  transform(response) {
    const handlers = this.handlers;
    const body = new ReadableStream({async start(controller) {
      try {
        const {JSDOM} = require('jsdom');
        const dom = new JSDOM(await response.text());
        for (const [selector, handler] of handlers) {
          for (const node of dom.window.document.querySelectorAll(selector)) {
            handler.element({getAttribute: name => node.getAttribute(name), setAttribute: (name, value) => node.setAttribute(name, value), remove: () => node.remove()});
          }
        }
        controller.enqueue(new TextEncoder().encode(dom.serialize()));
        dom.window.close(); controller.close();
      } catch (error) { controller.error(error); }
    }});
    return new Response(body, {status: response.status, headers: response.headers});
  }
}

function wrapper(config = buildPublicationConfig(base()), sharedFetch = null, automaticModule = require('../sync/automatic-refresh.cjs'), stored = require("../staging/d1-primary-reads.cjs")) {
  const calls = [], context = {URL, Request, Response, Headers, setTimeout: callback => callback(), console:{info(){},warn(){},error(){}}, __accountReadiness:require('../auth/routes.js'), __automatic:automaticModule, HTMLRewriter: PageHtmlRewriter, __cache: require("../sync/stored-read-cache.cjs"), __stored: stored, crypto:require("node:crypto").webcrypto, __shared: {async fetch(req, env, executionContext) {
    calls.push({request: req, env, executionContext});
    if (sharedFetch) return sharedFetch(req, env, executionContext);
    return new Response('shared-existing-worker', {headers: {'Cache-Control': 'private, no-store'}});
  }}};
  vm.createContext(context);
  context.__traffic = require('../portal/traffic.cjs');
  context.__live = require('../portal/live-auction.cjs');
  context.__archive = require('../sync/auction-archive-public.cjs');
  context.__contactDelivery = require('../portal/contact-delivery.cjs');
  context.__transactionalMail = require('../portal/transactional-mail.cjs');
  context.__fileDeletion = require('../portal/file-deletions.cjs');
  context.__publicBackup = require('../sync/catalog-backup.cjs');
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'worker.publication.js'), 'utf8')
    .replace('import rexWorker from "./worker.js";', 'const rexWorker = globalThis.__shared;')
    .replace('import storedReads from "./staging/d1-primary-reads.cjs";', 'const storedReads = globalThis.__stored;')
    .replace('import savedReadCache from "./sync/stored-read-cache.cjs";', 'const savedReadCache = globalThis.__cache;')
    .replace('import automaticRefreshModule from "./sync/automatic-refresh.cjs";', 'const automaticRefreshModule = globalThis.__automatic;')
    .replace('import accountsReadinessModule from "./auth/routes.js";', 'const accountsReadinessModule = globalThis.__accountReadiness;')
    .replace('import trafficModule from "./portal/traffic.cjs";', 'const trafficModule = globalThis.__traffic;')
    .replace('import liveModule from "./portal/live-auction.cjs";', 'const liveModule = globalThis.__live;')
    .replace('import archiveModule from "./sync/auction-archive-public.cjs";', 'const archiveModule = globalThis.__archive;')
    .replace('import contactDelivery from "./portal/contact-delivery.cjs";', 'const contactDelivery = globalThis.__contactDelivery;')
    .replace('import transactionalMail from "./portal/transactional-mail.cjs";', 'const transactionalMail = globalThis.__transactionalMail;')
    .replace('import fileDeletion from "./portal/file-deletions.cjs";', 'const fileDeletion = globalThis.__fileDeletion;')
    .replace('import publicBackup from "./sync/catalog-backup.cjs";', 'const publicBackup = globalThis.__publicBackup;')
    .replace('import {CatalogBackup, refreshCatalogBackup} from "./sync/catalog-backup-service.mjs";', 'const refreshCatalogBackup = async () => {};')
    .replace('export {CatalogBackup};', '')
    .replace('export const RexBidLive', 'const RexBidLive')
    .replace('export const RexBidTraffic', 'const RexBidTraffic')
    .replace('export default {', 'globalThis.__worker = {'), context);
  return {worker: context.__worker, env: {...config.vars}, calls};
}

function sharedWorker() {
  let providerCalls = 0;
  const context = {URL, URLSearchParams, Request, Response, Headers, AbortController, setTimeout, clearTimeout,
    crypto: require('node:crypto').webcrypto, __apibara: require('../providers/apibara.js'), __contract: require('../providers/contract.js'),
    __authProvider: require('../auth/supabase.js'), __accounts: require('../auth/routes.js'), __providerBudget: require('../providers/request-budget.js'),
    fetch: async () => {providerCalls++; throw new Error('network_forbidden_in_test');},
    console: {info() {}, warn() {}, error() {}}, caches: {default: {match: async () => null, put: async () => {}}}};
  let source = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
  for (const [module, name, variable] of [['./providers/apibara.js', 'apibaraModule', '__apibara'],
    ['./providers/contract.js', 'contract', '__contract'], ['./auth/supabase.js', 'authProviderModule', '__authProvider'],
    ['./auth/routes.js', 'accountsModule', '__accounts'], ['./providers/request-budget.js', 'providerBudgetModule', '__providerBudget']]) {
    source = source.replace(`import ${name} from "${module}";`, `const ${name} = globalThis.${variable};`);
  }
  vm.createContext(context);
  vm.runInContext(source.replace('export default {', 'globalThis.__worker = {'), context);
  const config = buildPublicationConfig(base());
  const env = {...config.vars, ASSETS: {async fetch(req) {
    const pathname = new URL(req.url).pathname;
    return new Response(pathname === '/car.html' ? fs.readFileSync(path.join(ROOT, 'public/car.html'), 'utf8') : '/* fixture asset */',
      {headers: {'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=UTF-8' : 'text/javascript'}});
  }}};
  return {worker: context.__worker, env, providerCalls: () => providerCalls};
}

test('production public list uses the R2 copy after D1 returns 503',async()=>{
  let reads=0;
  const stored={
    async catalogMembershipNamespace(){return 'test';},
    async handleStoredRead(){reads++;return new Response(null,{status:503});}
  };
  const {worker,env}=wrapper(undefined,null,undefined,stored);
  const created=new Date().toISOString();
  const bundle={v:1,generation:10,sequence:12,observed:created,created,pages:{'list:all':{first:{
    ok:true,data:[{platform:'copart',lot_number:'12345678'}],meta:{}
  }}}};
  const bindings={...env,REXBID_PUBLIC_CATALOG_BACKUP:'enabled',REXBID_ACTIVE_CATALOG:{prepare(){}},
    REXBID_AUCTION_ARCHIVE:{get:async()=>({size:500,json:async()=>bundle})}};
  const response=await worker.fetch(request('/api/cars?view=cards'),bindings);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('X-RexBid-Read-Source'),'r2-backup');
  assert.equal((await response.json()).data[0].read.data_status,'last_known');
  assert.equal(reads,1);
});

test('isolated publication delegates the canonical request unchanged to the working shared Worker', async () => {
  const f = wrapper(), req = request('/api/me'), context = {waitUntil() {}};
  const response = await f.worker.fetch(req, f.env, context);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'shared-existing-worker');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].request, req);
  assert.equal(f.calls[0].env, f.env); assert.equal(f.calls[0].executionContext, context);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('catalogue pages and their errors stay on the active database while archived details and accounts remain accessible', async () => {
  const primary = {prepare() {}}, legacy = {prepare() {}};
  const reads = [];
  const recoveryAttempts = new Set();
  const stored = {
    async handleStoredRead(req, env) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith('/api/car') && url.pathname !== '/api/filters') return null;
      const active = env.REXBID_DB === primary;
      reads.push(active ? 'active' : 'legacy');
      if (active && url.pathname === '/api/car/awaiting-date') {
        return Response.json({ok: false, error: 'auction_date_pending'}, {
          status: 404, headers: {'X-RexBid-Auction-Visibility': 'awaiting-date'}
        });
      }
      if (active && url.searchParams.has('throw')) throw new Error('read unavailable');
      if (active && url.searchParams.has('recover')) {
        assert.equal(url.searchParams.get('cursor'), 'active-page');
        assert.ok(!recoveryAttempts.has(req));
        recoveryAttempts.add(req);
        const ok = recoveryAttempts.size === 3;
        return Response.json({ok}, {status: ok ? 200 : 503});
      }
      const status = active && url.pathname === '/api/car/old' ? 404
        : active && url.searchParams.has('fail') ? 503
        : active && url.searchParams.has('cursor') ? 400 : 200;
      return Response.json({ok: status === 200}, {status});
    }
  };
  const f = wrapper(undefined, null, undefined, stored);
  Object.assign(f.env, {REXBID_DB: legacy, REXBID_ACTIVE_CATALOG: primary});
  for (const [path, status, expected] of [
    ['/api/cars', 200, ['active']], ['/api/filters', 200, ['active']],
    ['/api/car/old', 200, ['active', 'legacy']], ['/api/car/old/history', 200, ['active', 'legacy']],
    ['/api/car/awaiting-date', 404, ['active']],
    ['/api/cars?make=SUBARU&year_from=2025&fail=1', 503, ['active', 'active', 'active']],
    ['/api/cars?category=electric&cursor=active-page&fail=1', 503, ['active', 'active', 'active']],
    ['/api/cars?category=electric&cursor=active-page&recover=1', 200, ['active', 'active', 'active']],
    ['/api/cars?category=electric&cursor=expired', 400, ['active']],
    ['/api/cars?category=electric&cursor=active-page&throw=1', 503, ['active', 'active', 'active']]
  ]) {
    const response = await f.worker.fetch(request(path), f.env);
    assert.equal(response.status, status);
    assert.deepEqual(reads.splice(0), expected);
    assert.equal(response.headers.get('X-RexBid-Catalog'), expected.at(-1) === 'active' ? 'active-10733' : null);
  }
  await f.worker.fetch(request('/api/me'), f.env);
  assert.equal(f.calls.at(-1).env.REXBID_DB, legacy);
});

test('only active catalog lists use a new primary-pinned D1 read session', async () => {
  const databases = [];
  const session = {prepare() {}};
  const active = {prepare() {}, withSession(mode) {
    assert.equal(mode, 'first-primary');
    return session;
  }};
  const f = wrapper(undefined, null, undefined, {handleStoredRead(_request, env) {
    databases.push(env.REXBID_DB);
    return Response.json({ok: true});
  }});
  Object.assign(f.env, {REXBID_ACTIVE_CATALOG: active});
  await f.worker.fetch(request('/api/cars?view=cards'), f.env);
  await f.worker.fetch(request('/api/cars?view=cards&cursor=page2'), f.env);
  await f.worker.fetch(request('/api/filters'), f.env);
  await f.worker.fetch(request('/api/car/70267306'), f.env);
  assert.deepEqual(databases, [session, session, active, active]);
});

test('catalog publication renders real public pages without dead Auth/portal links while retaining contact and local favorites', async () => {
  const {JSDOM} = require('jsdom');
  const privatePath = pathname => /^\/(?:konto|logowanie|rejestracja|reset-hasla|panel|administracja)(?:\.html)?\/?$/.test(pathname);
  for (const file of ['index.html', 'car.html', 'ulubione.html', 'kontakt.html', 'jak-to-dziala.html', 'o-nas.html', 'prywatnosc.html', 'warunki.html']) {
    const f = wrapper(undefined, async () => new Response(fs.readFileSync(path.join(ROOT, 'public', file), 'utf8'), {
      headers: {'Content-Type': 'text/html; charset=UTF-8', 'Content-Security-Policy': "script-src 'nonce-kept'", 'Cache-Control': 'no-cache'}
    }));
    const response = await f.worker.fetch(request('/' + file), f.env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Security-Policy'), "script-src 'nonce-kept'");
    const dom = new JSDOM(await response.text(), {url: 'https://rexbid.pl/' + file, runScripts: 'outside-only'});
    assert.equal(dom.window.document.documentElement.dataset.rexbidPublicationPhase, 'catalog');
    dom.window.eval(fs.readFileSync(path.join(ROOT, 'public/rexbid-mobile-nav.js'), 'utf8'));
    // Regression: the real menu bootstrap previously recreated the removed Konto link.
    const links = [...dom.window.document.querySelectorAll('a[href]')];
    assert.equal(links.filter(node => new URL(node.href).origin === 'https://rexbid.pl' && privatePath(new URL(node.href).pathname)).length, 0, file);
    assert.ok(links.some(node => new URL(node.href).pathname === '/ulubione'), file + ': local favorites remains available');
    if (file === 'kontakt.html') {
      assert.ok(links.some(node => node.getAttribute('href') === 'mailto:kontakt@rexbid.pl'));
      assert.ok(dom.window.document.querySelector('#inquiryForm button[type="submit"]'));
    }
    if (file === 'car.html') {
      assert.ok(dom.window.document.querySelector('#page'));
      assert.match(dom.window.document.querySelector('script[src*="rexbid-calculator-v4.js"]').getAttribute('src'), /rexbid-calculator-v4/);
    }
    dom.window.close(); assert.equal(f.calls.length, 1);
  }
});

test('unlaunched private page URLs have a useful unavailable HTML state, no login form and no account lookup', async () => {
  const f = wrapper();
  for (const route of ['konto', 'logowanie', 'rejestracja', 'reset-hasla', 'panel', 'administracja']) {
    for (const suffix of ['', '.html', '/']) {
      const response = await f.worker.fetch(request('/' + route + suffix), f.env);
      assert.equal(response.status, 404); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      const html = await response.text();
      assert.match(html, /Konta i panel nie są jeszcze dostępne/);
      assert.match(html, /href="\/kontakt.html"/); assert.doesNotMatch(html, /<form|type="password"|token|cookie/i);
    }
  }
  const head = await f.worker.fetch(request('/konto.html', {method: 'HEAD'}), f.env);
  assert.equal(head.status, 404); assert.equal(await head.text(), '');
  assert.equal(f.calls.length, 0);
});

test('later approved Auth phase retains the exact account forms and navigation without catalog-only suppression', async () => {
  const config = buildPublicationConfig(base(), 'auth-setup', Object.fromEntries(BASE_EVIDENCE.map(key => [key, true])));
  const html = fs.readFileSync(path.join(ROOT, 'public/logowanie.html'), 'utf8');
  const f = wrapper(config, async () => new Response(html, {headers: {'Content-Type': 'text/html; charset=UTF-8'}}));
  const response = await f.worker.fetch(request('/logowanie.html'), f.env);
  assert.equal(response.status, 200); assert.equal(await response.text(), html); assert.equal(f.calls.length, 1);
});

test('www GET and HEAD redirect to the exact apex with path/query intact and no Auth/D1/provider access or cookies', async () => {
  const f = wrapper();
  for (const method of ['GET', 'HEAD']) {
    const response = await f.worker.fetch(request('/car.html?lot=sample%2Fpart&platform=iaai', {
      method, headers: {Cookie: '__Host-rexbid_session=untrusted-fixture'}
    }, 'https://www.rexbid.pl'), f.env);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('Location'), 'https://rexbid.pl/car.html?lot=sample%2Fpart&platform=iaai');
    assert.equal(response.headers.get('Set-Cookie'), null); assert.equal(await response.text(), '');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  }
  assert.equal(f.calls.length, 0);
});

test('www mutations and unknown/non-HTTPS hosts stop before every shared-handler operation', async () => {
  const f = wrapper();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await f.worker.fetch(request('/api/auth/login', {method}, 'https://www.rexbid.pl'), f.env);
    assert.equal(response.status, 421); assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('Location'), null);
  }
  for (const origin of ['http://rexbid.pl', 'https://rexbid.pl:444', 'https://rexbid.pl.evil.example',
    'https://mtbid.tedn828.workers.dev', 'https://rexbid-auth-test.tedn828.workers.dev', 'https://preview.rexbid.pl']) {
    const response = await f.worker.fetch(request('/api/auth/callback?untrusted=sample', {}, origin), f.env);
    assert.equal(response.status, 421); assert.equal(response.headers.get('Set-Cookie'), null);
    assert.doesNotMatch(await response.text(), /untrusted|sample/);
  }
  assert.equal(f.calls.length, 0);
});

test('publication runtime rejects a wrong resource pair and inconsistent feature phases before delegation', async () => {
  const f = wrapper();
  for (const patch of [{REXBID_RELEASE_D1_TARGET: 'rexbid-db'},
    {REXBID_RELEASE_D1_DATABASE_ID: '971879fe-04ed-4e8c-9dc6-5306980bb872'},
    {REXBID_RELEASE_D1_TARGET: 'rexbid-auth-test-db'}, {REXBID_RELEASE_ORIGIN: 'https://www.rexbid.pl'},
    {AUTH_ENABLED: 'true'}, {REXBID_PORTAL_ENABLED: 'enabled'}, {REXBID_PORTAL_FILES_ENABLED: 'enabled'},
    {REXBID_D1_PRIMARY_READS: 'true'}, {REXBID_LEGACY_SYNC_ENABLED: 'true'},
    {REXBID_PUBLICATION_PHASE: 'unknown'}, {REXBID_PRIVATE_FILES: {get() {}}}]) {
    const response = await f.worker.fetch(request('/'), {...f.env, ...patch});
    assert.equal(response.status, 503); assert.equal(response.headers.get('Set-Cookie'), null);
  }
  assert.equal(f.calls.length, 0);
});

test('owner-setup permits only the real existing MFA routes while orders/messages/files and TOTP reset stay closed', async () => {
  const config = buildPublicationConfig(base(), 'owner-setup', Object.fromEntries(OWNER_EVIDENCE.map(key => [key, true])));
  const f = wrapper(config);
  const settings = await f.worker.fetch(request('/api/portal/config'), f.env);
  assert.equal(settings.status, 200); assert.deepEqual(await settings.json(), {ok: true, enabled: false, uploads_enabled: false});
  for (const [pathname, method] of [['/api/portal/security', 'GET'], ['/api/portal/security/enroll', 'POST'],
    ['/api/portal/security/challenge', 'POST'], ['/api/portal/security/verify', 'POST'], ['/api/me', 'GET']]) {
    assert.equal((await f.worker.fetch(request(pathname, {method}), f.env)).status, 200);
  }
  const delegatedCount = f.calls.length;
  for (const [pathname, method] of [['/api/portal/orders', 'GET'], ['/api/portal/me', 'GET'],
    ['/api/portal/orders/test/messages', 'POST'], ['/api/portal/orders/test/files', 'GET'],
    ['/api/portal/security/restart-pending', 'POST'], ['/api/portal/security/enroll', 'GET'], ['/api/portal/security', 'DELETE']]) {
    const response = await f.worker.fetch(request(pathname, {method}), f.env);
    assert.equal(response.status, 503); assert.equal(response.headers.get('Set-Cookie'), null);
  }
  assert.equal(f.calls.length, delegatedCount);
});

test('isolated D1 identity enables the real Calculator V4 car renderer/assets without weakening exact production guards', async () => {
  const f = sharedWorker();
  let response = await f.worker.fetch(request('/car.html'), f.env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /window\.RexBidCalculatorV4Enabled=true/);
  assert.match(response.headers.get('Content-Security-Policy'), /nonce-/);
  for (const asset of ['/rexbid-calculator-v4.js', '/rexbid-calculator-v4-rates.js', '/rexbid-import-budget.js',
    '/rexbid-calculator-v3-rates.js', '/rexbid-transport-engine.js']) {
    assert.equal((await f.worker.fetch(request(asset), f.env)).status, 200);
  }
  for (const patch of [{REXBID_RELEASE_D1_TARGET: 'rexbid-db'},
    {REXBID_RELEASE_D1_DATABASE_ID: '971879fe-04ed-4e8c-9dc6-5306980bb872'},
    {REXBID_RELEASE_D1_TARGET: 'rexbid-auth-test-db', REXBID_RELEASE_D1_DATABASE_ID: 'acb3cb8e-69a2-459f-8a46-0f2f5b9004be'},
    {REXBID_RELEASE_D1_TARGET: 'unknown', REXBID_RELEASE_D1_DATABASE_ID: 'unknown'},
    {REXBID_PRODUCTION_UI_ENABLED: 'disabled'}, {REXBID_CALCULATOR_V4_ALLOWED_ORIGINS: 'https://www.rexbid.pl'}]) {
    response = await f.worker.fetch(request('/car.html'), {...f.env, ...patch});
    assert.doesNotMatch(await response.text(), /window\.RexBidCalculatorV4Enabled=true/);
    assert.equal((await f.worker.fetch(request('/rexbid-calculator-v4.js'), {...f.env, ...patch})).status, 404);
  }
  response = await f.worker.fetch(request('/car.html', {}, 'https://www.rexbid.pl'), f.env);
  assert.doesNotMatch(await response.text(), /window\.RexBidCalculatorV4Enabled=true/);
  assert.equal(f.providerCalls(), 0);
});

test('publication generator preserves isolated Worker/D1/limiter and provider-backed V4 without R2 or mutation of private preflight', () => {
  const input = base(), before = JSON.stringify(input), config = buildPublicationConfig(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(validatePublicationConfig(config).ok, true);
  assert.equal(config.name, input.name); assert.deepEqual(config.d1_databases, input.d1_databases);
  assert.deepEqual(config.ratelimits, input.ratelimits);
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.equal(config.r2_buckets, undefined); assert.equal(config.triggers, undefined);
  assert.equal(config.vars.AUTH_ENABLED, 'false'); assert.equal(config.vars.REXBID_PORTAL_ENABLED, 'disabled');
  assert.equal(config.vars.REXBID_PORTAL_FILES_ENABLED, 'disabled'); assert.equal(config.vars.REXBID_CALCULATOR_V4_ENABLED, 'enabled');
  assert.equal(validatePublicationConfig(config).approval_verified, false);
  assert.equal(validatePublicationConfig(config).production_runtime_verified, false);
});

test('publication validator rejects staging or current production resource substitution, secrets, weakened guards and budgets', () => {
  const changes = [config => {config.name = 'mtbid';}, config => {config.main = './worker.production.js';},
    config => {config.d1_databases[0].database_id = '971879fe-04ed-4e8c-9dc6-5306980bb872';},
    config => {config.d1_databases[0].database_name = 'rexbid-auth-test-db';},
    config => {config.routes = [{pattern: '*.rexbid.pl', custom_domain: true}];},
    config => {config.workers_dev = true;}, config => {config.preview_urls = true;}, config => {config.account_id = 'other-account';},
    config => {config.assets.run_worker_first = false;}, config => {config.r2_buckets = [{binding: 'REXBID_PRIVATE_FILES', bucket_name: 'rexbid-production-private-files'}];},
    config => {config.triggers = {crons: ['0 * * * *']};}, config => {config.queues = {};},
    config => {config.env = {preview: {name: 'rexbid-auth-test'}};},
    config => {config.services = [{binding: 'PRIVATE_SERVICE', service: 'other-service'}];},
    config => {config.vars.REXBID_PROVIDER_BUDGET_CATALOG_DAILY_LIMIT = '1000';},
    config => {config.vars.REXBID_PROVIDER_BUDGET_DISCOVERY_DAILY_LIMIT = '1';},
    config => {config.vars.REXBID_PROVIDER_BUDGET_MODE = 'optional';},
    config => {config.vars.REXBID_D1_PRIMARY_READS = 'true';}, config => {config.vars.AUTH_ENABLED = 'true';},
    config => {config.vars.REXBID_PUBLIC_PREVIEW_ENABLED = 'enabled';}, config => {config.vars.REXBID_AUTH_TEST_ENABLED = 'enabled';},
    config => {config.vars.REXBID_AUTH_COOKIE_SECRET = 'fixture-secret-do-not-print';}];
  for (const change of changes) {
    const config = buildPublicationConfig(base()); change(config);
    const checked = validatePublicationConfig(config);
    assert.equal(checked.ok, false); assert.doesNotMatch(JSON.stringify(checked), /fixture-secret-do-not-print/);
  }
  const badSource = base(); badSource.d1_databases[0].database_name = 'rexbid-db';
  assert.throws(() => buildPublicationConfig(badSource), /invalid_isolated_preflight_profile/);
});

test('later publication phases need explicit isolated evidence and owner setup cannot skip verified subject/E2E/MFA gates', () => {
  for (const phase of ['auth-setup', 'owner-setup', 'portal-no-files']) {
    assert.throws(() => buildPublicationConfig(base(), phase), /activation_evidence_missing/);
  }
  const auth = buildPublicationConfig(base(), 'auth-setup', Object.fromEntries(BASE_EVIDENCE.map(key => [key, true])));
  assert.equal(auth.vars.AUTH_ENABLED, 'true'); assert.equal(auth.vars.REXBID_PORTAL_ENABLED, 'disabled');
  assert.equal(auth.vars.AUTH_RECOVERY_MODE, 'email-token'); assert.equal(auth.vars.AUTH_ALLOWED_ORIGINS, 'https://rexbid.pl');
  const ownerEvidence = Object.fromEntries(OWNER_EVIDENCE.map(key => [key, true]));
  assert.throws(() => buildPublicationConfig(base(), 'portal-no-files', ownerEvidence), /production_owner_mfa_verified/);
  assert.throws(() => buildPublicationConfig(base(), 'owner-setup', {...ownerEvidence, production_owner_subject_confirmed: false}), /production_owner_subject_confirmed/);
  const portal = buildPublicationConfig(base(), 'portal-no-files', Object.fromEntries(PORTAL_EVIDENCE.map(key => [key, true])));
  assert.equal(portal.vars.REXBID_PORTAL_ENABLED, 'enabled'); assert.equal(portal.vars.REXBID_PORTAL_FILES_ENABLED, 'disabled');
  assert.equal(portal.r2_buckets, undefined); assert.equal(portal.vars.REXBID_PORTAL_OWNER_SETUP_ONLY, undefined);
  for (const config of [auth, portal]) assert.deepEqual(config.d1_databases, base().d1_databases);
  assert.throws(() => inspectPublicationEvidence({APIBARA_API_KEY: 'must-not-read'}), /unknown_or_secret_evidence/);
  assert.throws(() => inspectPublicationEvidence({worker: 'mtbid'}), /unknown_or_secret_evidence/);
  assert.throws(() => inspectPublicationEvidence({owner_cutover_approved: 'yes'}), /unknown_or_secret_evidence/);
});

test('tracked portal without files matches confirmed recovery and owner MFA evidence and preserves the automatic recipe', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'wrangler.production-publication.jsonc'), 'utf8'));
  const evidencePath = path.join(ROOT, 'config/rexbid-accounts-readiness-20261014.json');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.deepEqual(config, buildAutomaticPublicationConfig(base(), 'portal-no-files', evidence, {catalogMembership: true, taxonomyCache: true}));
  assert.equal(evidence.legal_retention_reviewed, true);
  assert.equal(evidence.production_owner_subject_confirmed, true);
  assert.equal(evidence.smtp_confirmation_recovery_verified, true);
  assert.equal(evidence.production_owner_mfa_verified, true);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/prepare-production-publication.cjs'), '--check', '--evidence', evidencePath], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.generated_file_consistent, true); assert.equal(report.approval_verified, false);
  assert.equal(report.current_production_modified, false); assert.equal(report.files_enabled, false);
  assert.equal(report.secret_presence_verified, false); assert.deepEqual(report.required_secret_names, ['APIBARA_API_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'REXBID_AUTH_COOKIE_SECRET', 'REXBID_OWNER_USER_ID', 'REXBID_PORTAL_DATA_KEYS', 'REXBID_PORTAL_ACTIVE_KEY_ID']);
  assert.equal(report.automatic_refresh_enabled, true);
  const template = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rexbid-production-publication-evidence.template.json'), 'utf8'));
  assert.ok(Object.values(template).every(value => value === false));
  assert.equal(inspectPublicationEvidence(template, 'portal-no-files').ok, false);
});

test('explicit automatic recipe preserves stored public reads and isolated resource boundaries', () => {
  const config=buildAutomaticPublicationConfig(base());
  assert.equal(validatePublicationConfig(config).ok,true);
  assert.deepEqual(config.triggers,{crons:['*/15 * * * *']});
  assert.equal(config.vars.REXBID_PUBLIC_CATALOG_MODE,'stored');
  assert.equal(config.vars.REXBID_LEGACY_SYNC_ENABLED,'false');
  assert.equal(config.vars.AUTH_ENABLED,'false');assert.equal(config.vars.REXBID_PORTAL_ENABLED,'disabled');
  assert.equal(config.vars.REXBID_PORTAL_FILES_ENABLED,'disabled');assert.equal(config.r2_buckets,undefined);
  for(const mutate of [
    c=>{delete c.triggers;},c=>{c.triggers.crons=['* * * * *'];},c=>{c.triggers.crons.push('0 * * * *');},
    c=>{c.vars.REXBID_AUTO_REFRESH_DATABASE_ID='acb3cb8e-69a2-459f-8a46-0f2f5b9004be';},
    c=>{c.vars.REXBID_AUTO_REFRESH_DAILY_LIMIT='501';},c=>{c.vars.REXBID_AUTO_REFRESH_MONTHLY_LIMIT='12001';},
    c=>{c.vars.REXBID_AUTO_REFRESH_MAX_PER_RUN='9';},c=>{c.vars.REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT='2001';},
    c=>{c.vars.REXBID_AUTO_REFRESH_QUOTA_RESERVE='499';},c=>{c.vars.REXBID_AUTO_REFRESH_ENABLED='disabled';},
    c=>{delete c.vars.REXBID_AUTO_REFRESH_DAILY_LIMIT;},c=>{c.vars.REXBID_PUBLIC_CATALOG_MODE='provider';},
    c=>{c.vars.REXBID_PUBLICATION_PHASE='auth-setup';c.vars.AUTH_ENABLED='true';c.vars.AUTH_D1_SCHEMA_VERSION='0003';c.vars.REXBID_PORTAL_ENABLED='enabled';}
  ]){const changed=structuredClone(config);mutate(changed);assert.equal(validatePublicationConfig(changed).ok,false);}
});

test('automatic recipe composes with every evidence-gated Auth phase without changing targets, budgets or private feature gates', () => {
  const catalog = buildAutomaticPublicationConfig(base());
  for (const [phase, keys] of [['auth-setup', BASE_EVIDENCE], ['owner-setup', OWNER_EVIDENCE], ['portal-no-files', PORTAL_EVIDENCE]]) {
    const evidence = Object.fromEntries(keys.map(key => [key, true]));
    const config = buildAutomaticPublicationConfig(base(), phase, evidence);
    assert.equal(validatePublicationConfig(config).ok, true, phase);
    assert.equal(config.vars.REXBID_PUBLICATION_PHASE, phase);
    assert.deepEqual(config.d1_databases, catalog.d1_databases);
    assert.deepEqual(config.ratelimits, catalog.ratelimits);
    assert.deepEqual(config.triggers, catalog.triggers);
    for (const key of Object.keys(catalog.vars).filter(key => key.startsWith('REXBID_AUTO_REFRESH_'))) {
      assert.equal(config.vars[key], catalog.vars[key], phase + ': exact scheduler recipe');
    }
    assert.equal(config.vars.AUTH_ENABLED, 'true');
    assert.equal(config.vars.REXBID_PORTAL_ENABLED, phase === 'auth-setup' ? 'disabled' : 'enabled');
    assert.equal(config.vars.REXBID_PORTAL_OWNER_SETUP_ONLY, phase === 'owner-setup' ? 'true' : undefined);
    assert.equal(config.vars.REXBID_PORTAL_FILES_ENABLED, 'disabled');
    assert.equal(config.r2_buckets, undefined);
    assert.equal(config.vars.REXBID_PUBLIC_CATALOG_MODE, 'stored');
    assert.equal(config.vars.REXBID_LEGACY_SYNC_ENABLED, 'false');
    // Composition must never satisfy an Auth/owner/MFA evidence requirement.
    for (const key of keys) assert.throws(() => buildAutomaticPublicationConfig(base(), phase, {...evidence, [key]: false}), /activation_evidence_missing/);
    const rollback = buildPublicationConfig(base(), phase, evidence);
    assert.equal(rollback.triggers, undefined);
    assert.equal(Object.keys(rollback.vars).some(key => key.startsWith('REXBID_AUTO_REFRESH_')), false);
  }
});

test('phase CLI opts into bounded refresh explicitly and refuses incomplete evidence without creating an output', t => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'rexbid-publication-test-'));
  const evidenceFile = path.join(dir, 'evidence.json'), output = path.join(dir, 'auth.jsonc');
  t.after(() => {for (const file of [evidenceFile, output]) if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir);});
  const args = [path.join(ROOT, 'scripts/prepare-production-publication.cjs'), '--phase', 'auth-setup', '--evidence', evidenceFile, '--output', output, '--automatic-refresh'];
  fs.writeFileSync(evidenceFile, JSON.stringify(Object.fromEntries(BASE_EVIDENCE.map(key => [key, false]))));
  const rejected = spawnSync(process.execPath, args, {encoding: 'utf8'});
  assert.equal(rejected.status, 1); assert.match(rejected.stderr, /activation_evidence_missing/);
  assert.equal(fs.existsSync(output), false);
  const evidence = Object.fromEntries(BASE_EVIDENCE.map(key => [key, true]));
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence));
  const generated = spawnSync(process.execPath, args, {encoding: 'utf8'});
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), buildAutomaticPublicationConfig(base(), 'auth-setup', evidence));
  const report = JSON.parse(generated.stdout);
  assert.equal(report.automatic_refresh_enabled, true); assert.equal(report.files_enabled, false);
  assert.equal(report.production_runtime_verified, false); assert.equal(report.secrets_written, false);
});

test('approved Auth phases keep the scheduled handler working but HTTP catalogue reads remain read-only without fallback', async t => {
  const {DatabaseSync} = require('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(fs.readFileSync(path.join(ROOT, 'docs/proposals/0004_d1_sync_2.sql'), 'utf8'));
  const queries = [];
  const db = {prepare(sql) {
    assert.match(sql, /^\s*SELECT\b/i, 'public browsing must not reserve provider budget or change D1');
    queries.push(sql);
    const query = sqlite.prepare(sql);
    const methods = params => ({async first() {return query.get(...params) || null;}, async all() {return {results: query.all(...params)};}});
    return {...methods([]), bind(...params) {return methods(params);}};
  }};
  const network = t.mock.method(globalThis, 'fetch', async () => {throw Error('network forbidden in phase browsing fixture');});
  t.mock.method(console, 'info', () => {});
  const actual = require('../sync/automatic-refresh.cjs');
  let scheduled = 0;
  const automatic = {configuration: actual.configuration, async runAutomaticRefresh({env}) {
    scheduled++; assert.equal(env.REXBID_DB, db); return {ok: true, attempts: 0, stopReason: 'fixture_no_due_work'};
  }};
  for (const [phase, keys] of [['auth-setup', BASE_EVIDENCE], ['owner-setup', OWNER_EVIDENCE], ['portal-no-files', PORTAL_EVIDENCE]]) {
    const config = buildAutomaticPublicationConfig(base(), phase, Object.fromEntries(keys.map(key => [key, true])));
    const f = wrapper(config, null, automatic); f.env.REXBID_DB = db;
    const before = scheduled;
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const [route, status] of [['/api/cars', 200], ['/api/filters', 200], ['/api/car/12345678?platform=iaai', 404], ['/api/car/12345678/history?platform=copart', 404]]) {
        const response = await f.worker.fetch(request(route), f.env);
        assert.equal(response.status, status, phase + ': ' + route);
        assert.equal(response.headers.get('X-RexBid-Read-Source'), 'd1');
        assert.equal(response.headers.get('Set-Cookie'), null);
        const body = await response.json();
        if (route === '/api/filters') assert.equal(body.meta.known_rows_only, true);
        else assert.equal((body.meta || body.read).provider_fallback_enabled, false);
      }
    }
    assert.equal(scheduled, before); assert.equal(f.calls.length, 0);
    const pending = [];
    assert.equal((await f.worker.scheduled({cron: '*/15 * * * *'}, f.env, {waitUntil: task => pending.push(task)})).ok, true);
    await Promise.all(pending); assert.equal(pending.length, 1); assert.equal(scheduled, before + 1);
  }
  assert.ok(queries.length > 0); assert.equal(network.mock.callCount(), 0);
});

test('scheduled handler alone dispatches refresh; HTTP browsing never enters provider scheduler',async()=>{
  const calls=[],actual=require('../sync/automatic-refresh.cjs');
  const automatic={configuration:actual.configuration,async runAutomaticRefresh({env}){calls.push(env);return {ok:true,attempts:3,stopReason:'due_work_complete'};}};
  const f=wrapper(buildAutomaticPublicationConfig(base()),null,automatic),pending=[];
  await f.worker.fetch(request('/'),f.env,{waitUntil:p=>pending.push(p)});
  await f.worker.fetch(request('/ready'),f.env,{waitUntil:p=>pending.push(p)});
  assert.equal(calls.length,0);
  const result=await f.worker.scheduled({cron:'*/15 * * * *'},f.env,{waitUntil:p=>pending.push(p)});
  assert.equal(result.ok,true);assert.equal(calls.length,1);assert.equal(calls[0],f.env);assert.equal(pending.length,1);
  await Promise.all(pending);
});

test('scheduled handler fails closed for disabled, mistargeted, unbounded and wrong cadence configurations',async()=>{
  const actual=require('../sync/automatic-refresh.cjs');let calls=0;
  const automatic={configuration:actual.configuration,async runAutomaticRefresh(){calls++;throw Error('must not run');}};
  const good=buildAutomaticPublicationConfig(base());
  for(const [mutate,cron] of [
    [c=>{delete c.vars.REXBID_AUTO_REFRESH_ENABLED;},'*/15 * * * *'],
    [c=>{c.vars.REXBID_AUTO_REFRESH_DATABASE_ID='acb3cb8e-69a2-459f-8a46-0f2f5b9004be';},'*/15 * * * *'],
    [c=>{c.vars.REXBID_AUTO_REFRESH_MONTHLY_LIMIT='20000';},'*/15 * * * *'],
    [c=>{c.vars.REXBID_AUTO_REFRESH_MAX_PER_RUN='9';},'*/15 * * * *'],
    [c=>{c.vars.REXBID_AUTO_REFRESH_QUOTA_RESERVE='1';},'*/15 * * * *'],
    [c=>{c.vars.REXBID_PUBLICATION_PHASE='owner-setup';},'*/15 * * * *'],
    [()=>{},'* * * * *']
  ]){const config=structuredClone(good);mutate(config);const f=wrapper(config,null,automatic);const r=await f.worker.scheduled({cron},f.env,{waitUntil(){}});assert.equal(r.ok,false);}
  assert.equal(calls,0);
});

test('scheduled handler reports a safe failure without copying thrown secret-bearing details',async()=>{
  const actual=require('../sync/automatic-refresh.cjs'),f=wrapper(buildAutomaticPublicationConfig(base()),null,
    {configuration:actual.configuration,async runAutomaticRefresh(){throw Error('fixture-private-value');}});
  const pending=[];const r=await f.worker.scheduled({cron:'*/15 * * * *'},f.env,{waitUntil:p=>pending.push(p)});
  assert.equal(r.stopReason,'publication_scheduler_unavailable');assert.doesNotMatch(JSON.stringify(r),/fixture-private-value/);
  const completed=await Promise.allSettled(pending);assert.equal(completed[0].status,'fulfilled');
});

// This executes the complete real page and both browser scripts through the
// publication wrapper and actual MFA handler. Only the provider/session
// capabilities are synthetic. It is not production/Supabase/browser-layout QA.
async function ownerSetupDom(t, {actor = 'owner', alreadyVerified = false} = {}) {
  const {JSDOM, VirtualConsole} = require('jsdom');
  const {createOwnerMfaRouteHandler} = require('../auth/owner-mfa.cjs');
  const factor = '6b6d030f-0a58-4d23-aa81-424dc5b47adf', challenge = '681eed99-3844-42b5-b0a2-70412a855654';
  const fixtureTotp = 'JBSWY3DPEHPK3PXP';
  const state = {level: 'aal1', factors: alreadyVerified ? [{id: factor, factor_type: 'totp', status: 'verified'}] : []};
  const providerCalls = [], requests = [], verifiedEvents = [], runtimeErrors = [];
  const config = buildPublicationConfig(base(), 'owner-setup', Object.fromEntries(OWNER_EVIDENCE.map(key => [key, true])));
  const handler = createOwnerMfaRouteHandler({
    provider: {
      async enrollTotp() {
        providerCalls.push('enroll');
        state.factors = [{id: factor, factor_type: 'totp', status: 'unverified'}];
        return {id: factor, type: 'totp', totp: {secret: fixtureTotp, uri: 'otpauth://totp/fixture?secret=' + fixtureTotp,
          qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect x="0" y="0" width="1" height="1" fill="black"/></svg>'}};
      },
      async challengeTotp(_env, _access, selected) {
        assert.equal(selected, factor); providerCalls.push('challenge');
        return {id: challenge, expires_at: Math.floor(Date.now() / 1000) + 300};
      },
      async verifyTotp(_env, _access, payload) {
        assert.equal(payload.factorId, factor); assert.equal(payload.challengeId, challenge);
        assert.equal(payload.code, '123456'); providerCalls.push('verify');
        return {fixture_assurance_level: 'aal2'};
      },
      async unenrollPendingTotp() {throw new Error('MFA reset forbidden in this fixture');}
    },
    async resolveOwnerSession() {
      // Trusted server capability, not a role supplied by the browser. Existing
      // owner-mfa/session suites cover signed JWT/identity/CSRF verification.
      if (actor !== 'owner') return {status: actor === 'anonymous' ? 401 : 403, cookies: []};
      return {status: 200, cookies: [], user: {id: 'owner-fixture'}, session: {access_token: 'synthetic-session-capability'},
        identity: {issuer: 'https://fixture.invalid', subject: 'owner-fixture-subject', assurance_level: state.level, mfa_factors: state.factors}};
    },
    async verifiedSessionCookie(_env, previous, session, selected) {
      assert.equal(previous.user.id, 'owner-fixture'); assert.equal(selected, factor);
      assert.equal(session.fixture_assurance_level, 'aal2');
      state.level = 'aal2'; state.factors = [{id: factor, factor_type: 'totp', status: 'verified'}];
      return '__Host-rexbid_session=synthetic-aal2-cookie; Path=/; Secure; HttpOnly; SameSite=Lax';
    },
    readJson: req => req.json(), cryptoImpl: require('node:crypto').webcrypto
  });
  const f = wrapper(config, async (req, env) => {
    const result = await handler(req, env);
    if (!result) throw new Error('Unexpected shared route in owner setup DOM fixture');
    return result;
  });
  Object.assign(f.env, {REXBID_AUTH_COOKIE_SECRET: 'synthetic-cookie-encryption-key-only-for-owner-setup-dom-regression',
    REXBID_DB: {prepare() {throw new Error('business D1 access forbidden during this fixture');}}});
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {
    // The actual verified event requests a page reload; jsdom cannot navigate.
    if (!/Not implemented: navigation/.test(error.message)) runtimeErrors.push(error);
  });
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'public/administracja.html'), 'utf8'), {
    url: 'https://rexbid.pl/administracja.html', runScripts: 'outside-only', virtualConsole
  });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document;
  if (doc.readyState === 'loading') await new Promise(resolve => doc.addEventListener('DOMContentLoaded', resolve, {once: true}));
  win.addEventListener('error', event => runtimeErrors.push(event.error));
  doc.addEventListener('rexbid:owner-mfa-verified', event => verifiedEvents.push(event));
  Object.defineProperty(win, 'localStorage', {get() {throw new Error('Private setup must not use localStorage');}});
  Object.defineProperty(win, 'sessionStorage', {get() {throw new Error('Private setup must not use sessionStorage');}});
  win.fetch = async (pathname, options = {}) => {
    const url = new URL(pathname, win.location.href).href;
    const headers = new Headers(options.headers || {}), cookies = dom.cookieJar.getCookieStringSync(url);
    if (cookies) headers.set('Cookie', cookies);
    // The real browser keeps AbortSignal in its own realm. Node's Request
    // rejects jsdom's signal; omit it only at this in-process HTTP adapter.
    const {signal: _browserSignal, ...requestOptions} = options;
    const req = new Request(url, {...requestOptions, headers});
    const record = {path: new URL(url).pathname, method: req.method}; requests.push(record);
    const result = await f.worker.fetch(req, f.env);
    record.status = result.status;
    for (const cookie of result.headers.getSetCookie()) dom.cookieJar.setCookieSync(cookie, url);
    return result;
  };
  // Use the real ordered <script> references, not a simplified test page.
  const scripts = [...doc.querySelectorAll('script[src]')].map(node => new URL(node.src).pathname);
  assert.deepEqual(scripts, ['/rexbid-owner-mfa.js', '/rexbid-client-portal.js', '/rexbid-archive-owner.js']);
  for (const script of scripts) win.eval(fs.readFileSync(path.join(ROOT, 'public', script), 'utf8'));
  await win.RexBidClientPortal.ready;
  const settle = async predicate => {
    // A bounded harness wait for real async body/crypto/DOM work; it changes
    // no production timeout or application fallback and must fail if pending.
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(predicate(), 'actual owner setup UI did not reach the expected settled stage');
  };
  const element = doc.getElementById('rexbid-owner-mfa');
  await settle(() => element.querySelector('button:not([disabled]),a') !== null);
  return {win, doc, element, requests, providerCalls, verifiedEvents, runtimeErrors, settle};
}

test('real owner-setup administration bootstrap keeps portal closed but allows one QR enrollment and verification through the actual MFA handler', async t => {
  const p = await ownerSetupDom(t);
  assert.equal(p.requests.find(item => item.path === '/api/portal/security')?.status, 200);
  assert.equal(p.doc.getElementById('portalWorkspace').hidden, true);
  assert.equal(p.doc.getElementById('portalGate').hidden, false);
  assert.match(p.doc.getElementById('portalGateTitle').textContent, /przygotowywany/);
  const enroll = [...p.element.querySelectorAll('button')].find(node => node.textContent === 'Skonfiguruj ochronę konta');
  assert.ok(enroll); assert.equal(enroll.disabled, false); enroll.click();
  await p.settle(() => p.requests.find(item => item.path === '/api/portal/security/enroll')?.status !== undefined);
  assert.equal(p.requests.find(item => item.path === '/api/portal/security/enroll')?.status, 201);
  await p.settle(() => p.element.querySelector('input[name="owner_mfa_code"]') && p.element.querySelector('button[type="submit"]')?.disabled === false);
  assert.ok(p.element.querySelector('img.portal-mfa-qr'));
  const input = p.element.querySelector('input[name="owner_mfa_code"]');
  input.value = '123456'; input.form.dispatchEvent(new p.win.Event('submit', {bubbles: true, cancelable: true}));
  await p.settle(() => p.verifiedEvents.length === 1);
  assert.match(p.element.textContent, /zweryfikowane drugim składnikiem/);
  assert.equal(p.element.querySelector('img,.portal-mfa-secret'), null);
  assert.equal(p.doc.getElementById('portalWorkspace').hidden, true);
  assert.equal(p.doc.querySelector('[data-portal-form="create"],[data-portal-form="upload"]'), null);
  assert.deepEqual(p.providerCalls, ['enroll', 'challenge', 'verify']);
  assert.ok(p.requests.every(item => ['/api/portal/config', '/api/portal/security', '/api/portal/security/enroll',
    '/api/portal/security/challenge', '/api/portal/security/verify'].includes(item.path)));
  assert.deepEqual(p.runtimeErrors, []);
});

test('real owner-setup page preserves an already verified TOTP and completes only challenge/verify without reenrollment or reset', async t => {
  const p = await ownerSetupDom(t, {alreadyVerified: true});
  assert.equal(p.requests.find(item => item.path === '/api/portal/security')?.status, 200);
  assert.equal(p.element.querySelector('img,.portal-mfa-secret'), null);
  assert.doesNotMatch(p.element.textContent, /Skonfiguruj ochronę konta|od nowa/);
  const input = p.element.querySelector('input[name="owner_mfa_code"]');
  assert.ok(input); input.value = '123456';
  input.form.dispatchEvent(new p.win.Event('submit', {bubbles: true, cancelable: true}));
  await p.settle(() => p.verifiedEvents.length === 1);
  assert.deepEqual(p.providerCalls, ['challenge', 'verify']);
  assert.equal(p.doc.getElementById('portalWorkspace').hidden, true);
  assert.equal(p.requests.some(item => /enroll|restart-pending/.test(item.path) || item.method === 'DELETE'), false);
  assert.deepEqual(p.runtimeErrors, []);
});

test('real owner-setup page denies anonymous and ordinary client MFA without QR, inputs or private portal requests', async t => {
  for (const actor of ['anonymous', 'client']) {
    const p = await ownerSetupDom(t, {actor});
    assert.equal(p.doc.getElementById('portalWorkspace').hidden, true);
    assert.equal(p.element.querySelector('input,img,.portal-mfa-secret'), null);
    assert.doesNotMatch(p.element.textContent, /Skonfiguruj ochronę konta/);
    assert.deepEqual(p.providerCalls, []);
    assert.ok(p.requests.every(item => ['/api/portal/config', '/api/portal/security'].includes(item.path)));
    assert.deepEqual(p.runtimeErrors, []);
  }
});


test('publication generator tolerates Git Windows line endings but rejects changed rates, targets and extra values', () => {
  const config = buildPublicationConfig(base());
  const generated = JSON.stringify(config, null, 2) + '\n';
  assert.equal(generatedProfileConsistent(generated, config), true);
  assert.equal(generatedProfileConsistent(generated.replace(/\n/g, '\r\n'), config), true);
  for (const [before, after] of [['"500"', '"501"'], ['"rexbid-production-preflight"', '"mtbid"']]) {
    assert.equal(generatedProfileConsistent(generated.replace(before, after), config), false);
  }
  assert.equal(generatedProfileConsistent(generated + 'extra', config), false);
  assert.equal(generatedProfileConsistent(null, config), false);
});

test('public discovery uses exact rexbid.pl only and never accesses catalog, assets, accounts or provider', async () => {
  const f=wrapper(); f.env.REXBID_DB={prepare(){throw Error('D1 forbidden for discovery');}};
  for(const method of ['GET','HEAD']) {
    for(const route of ['/robots.txt','/sitemap.xml']) {
      const response=await f.worker.fetch(request(route,{method}),f.env);
      assert.equal(response.status,200); assert.equal(response.headers.get('Set-Cookie'),null);
      assert.equal(response.headers.get('X-Robots-Tag'),null);
      const body=await response.text();
      if(method==='HEAD'){assert.equal(body,'');continue;}
      assert.match(body,/https:\/\/rexbid\.pl/);
      assert.doesNotMatch(body,/mtbid|workers\.dev|rexbid-auth-test|lastmod/);
      if(route==='/robots.txt'){assert.match(body,/Disallow: \/api\//);assert.match(body,/Disallow: \/administracja/);}
      else {const {JSDOM}=require('jsdom');const doc=new JSDOM(body,{contentType:'application/xml'}).window.document;assert.equal(doc.querySelectorAll('parsererror').length,0);assert.equal(doc.querySelectorAll('loc').length,7);assert.ok([...doc.querySelectorAll('loc')].every(x=>new URL(x.textContent).origin==='https://rexbid.pl'));assert.ok([...doc.querySelectorAll('loc')].some(x=>x.textContent==='https://rexbid.pl/pomoc'));}
    }
  }
  const alias=await f.worker.fetch(request('/sitemap.xml?x=1',{},'https://www.rexbid.pl'),f.env);
  assert.equal(alias.status,308);assert.equal(alias.headers.get('Location'),'https://rexbid.pl/sitemap.xml?x=1');
  const mutation=await f.worker.fetch(request('/robots.txt',{method:'POST'}),f.env);assert.equal(mutation.status,405);
  assert.equal(f.calls.length,0);
});
test('catalog readiness needs saved observations and real HTML assets but no provider credential or network', async () => {
  const f=wrapper(); let queries=0,assets=0;
  f.env.REXBID_DB={prepare(sql){assert.match(sql,/JOIN auction_listing_snapshots/);return{async first(){queries++;return {listing_id:'test-listing'};}};}};
  f.env.ASSETS={async fetch(req){assets++;assert.equal(new URL(req.url).pathname,'/index.html');return new Response('<html></html>',{headers:{'Content-Type':'text/html'}});}};
  for(const method of ['GET','HEAD']){const response=await f.worker.fetch(request('/ready',{method}),f.env);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Frame-Options'),'DENY');assert.equal(response.headers.get('Strict-Transport-Security'),'max-age=31536000');assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors/);if(method==='GET'){const body=await response.json();assert.equal(body.checks.provider,'disabled');assert.equal(body.checks.catalog,'ok');}else assert.equal(await response.text(),'');}
  assert.equal(queries,2);assert.equal(assets,2);assert.equal(f.calls.length,0);
});
test('readiness fails for empty D1, unavailable schema or broken HTML and keeps diagnostic details private', async () => {
  for(const kind of ['empty','query-error','missing-assets','wrong-content-type']) {
    const f=wrapper();f.env.REXBID_DB={prepare(){return{async first(){if(kind==='query-error')throw Error('sensitive-diagnostic-fixture');return kind==='empty'?null:{listing_id:'fixture'};}};}};
    f.env.ASSETS={async fetch(){return new Response('fixture',{status:kind==='missing-assets'?404:200,headers:{'Content-Type':kind==='wrong-content-type'?'text/plain':'text/html'}});}};
    const response=await f.worker.fetch(request('/ready'),f.env);assert.equal(response.status,503);const body=await response.text();assert.doesNotMatch(body,/sensitive|listing_id|fixture/);assert.equal(f.calls.length,0);
  }
});

test('automatic readiness exposes only schedule state and safe timestamps without provider calls or writes',async()=>{
  const now=Date.now(),recent=new Date(now-60000).toISOString(),old=new Date(now-3600000).toISOString(),future=new Date(now+60000).toISOString();
  const cases=[
    [{last_started_at:recent,last_finished_at:recent,last_success_at:recent},'scheduled'],
    [{last_started_at:old,last_finished_at:old,last_success_at:old},'due'],
    [{},'awaiting'],
    [{last_started_at:recent,lease_active:1,lease_until:future},'running'],
    [{last_started_at:recent,pause_until:future},'paused'],
    [{blocked:1,lease_active:1,lease_until:future},'blocked'],
    [null,'unavailable'],
    [new Error('secret-sensitive-diagnostic'),'unavailable']
  ];
  for(const [row,status] of cases){
    let scheduleQueries=0;const f=wrapper(buildAutomaticPublicationConfig(base()),null,{runAutomaticRefresh(){throw Error('provider-forbidden');}});
    f.env.REXBID_DB={prepare(sql){assert.match(sql,/^SELECT /);return{async first(){
      if(sql.includes('automatic_refresh_state')){scheduleQueries++;assert.doesNotMatch(sql,/quota|budget|SELECT \*/);if(row instanceof Error)throw row;return row;}
      return {listing_id:'private-listing-id'};
    }};}};
    f.env.ASSETS={async fetch(){return new Response('<html></html>',{headers:{'Content-Type':'text/html'}});}};
    const response=await f.worker.fetch(request('/ready'),f.env);assert.equal(response.status,200);
    const text=await response.text(),body=JSON.parse(text);assert.equal(body.ok,true);assert.equal(body.checks.provider,'scheduled_only');
    assert.equal(body.refresh.status,status);assert.equal(scheduleQueries,1);assert.equal(f.calls.length,0);
    assert.doesNotMatch(text,/secret|sensitive|quota|budget|lease_owner|private-listing|error_code|blocked_reason/);
    assert.deepEqual(Object.keys(body.refresh).sort(),['last_finished_at','last_success_at','status']);
  }
});

test('Auth rollout readiness retains catalogue and Cron checks and validates Auth without contacting providers',async()=>{
  const evidence=Object.fromEntries(PORTAL_EVIDENCE.map(key=>[key,true]));
  for(const phase of ['auth-setup','owner-setup','portal-no-files']){
    const f=wrapper(buildAutomaticPublicationConfig(base(),phase,evidence));
    let reads=0;
    Object.assign(f.env,{
      REXBID_AUTH_COOKIE_SECRET:'synthetic-readiness-cookie-secret-not-used-on-any-service',
      SUPABASE_URL:'https://kkwbqzndildovbblbkcx.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-readiness-key',
      AUTH_RATE_LIMITER:{limit(){throw Error('readiness_must_not_consume_auth_limit');}},
      REXBID_DB:{prepare(sql){assert.match(sql,/^SELECT /);return{async first(){reads++;return sql.includes('automatic_refresh_state')?{last_started_at:new Date().toISOString(),last_success_at:new Date().toISOString(),last_finished_at:new Date().toISOString()}:{listing_id:'fixture'};}};}},
      ASSETS:{async fetch(){return new Response('<html>fixture</html>',{headers:{'Content-Type':'text/html'}});}}
    });
    const response=await f.worker.fetch(request('/ready'),f.env),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.checks.auth.configured,true);assert.equal(body.checks.provider,'scheduled_only');assert.equal(body.refresh.status,'scheduled');assert.equal(reads,2);assert.equal(f.calls.length,0);
    const invalid=await f.worker.fetch(request('/ready'),{...f.env,SUPABASE_URL:'https://ydfsuncohsntqwmtmnhe.supabase.co'});
    assert.equal(invalid.status,503);assert.equal((await invalid.json()).checks.auth.configured,false);
    const head=await f.worker.fetch(request('/ready',{method:'HEAD'}),f.env);assert.equal(head.status,200);assert.equal(await head.text(),'');
    const post=await f.worker.fetch(request('/ready',{method:'POST'}),f.env);assert.equal(post.status,405);
  }
});

test('readiness never reflects malformed stored timestamps and HEAD has no diagnostic body',async()=>{
  const f=wrapper(buildAutomaticPublicationConfig(base()));
  f.env.REXBID_DB={prepare(sql){return {async first(){return sql.includes('automatic_refresh_state')
    ?{last_started_at:'secret-string',last_success_at:'secret-string',last_finished_at:'secret-string'}:{listing_id:'private-id'};}};}};
  f.env.ASSETS={async fetch(){return new Response('<html></html>',{headers:{'Content-Type':'text/html'}});}};
  const body=await (await f.worker.fetch(request('/ready'),f.env)).json();
  assert.deepEqual(body.refresh,{status:'awaiting',last_success_at:null,last_finished_at:null});
  const head=await f.worker.fetch(request('/ready',{method:'HEAD'}),f.env);assert.equal(head.status,200);assert.equal(await head.text(),'');
});


test('catalog membership requires an explicit opt-in without changing the default automatic publication recipe',()=>{
 const legacy=buildAutomaticPublicationConfig(base());assert.equal(legacy.vars.REXBID_CATALOG_MEMBERSHIP_ENABLED,undefined);
 const opted=buildAutomaticPublicationConfig(base(),'catalog',{}, {catalogMembership:true});assert.equal(opted.vars.REXBID_CATALOG_MEMBERSHIP_ENABLED,'enabled');assert.equal(validatePublicationConfig(opted).ok,true);
 assert.throws(()=>buildAutomaticPublicationConfig(base(),'catalog',{}, {catalogMembership:'enabled'}),/invalid_catalog_membership_opt_in/);
 const wrong=structuredClone(opted);wrong.vars.REXBID_CATALOG_MEMBERSHIP_ENABLED='disabled';assert.equal(validatePublicationConfig(wrong).ok,false);
});


test('private attachment publication accepts its exact production profile and preserves scheduled feed authority',async()=>{
 const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'wrangler.active-catalog-cutover.jsonc')));
 assert.equal(cfg.vars.REXBID_PUBLICATION_PHASE,'portal-files');
 assert.equal(cfg.vars.REXBID_PORTAL_FILES_ENABLED,'enabled');
 assert.deepEqual(cfg.r2_buckets.find(x=>x.binding==='REXBID_PRIVATE_FILES'),{binding:'REXBID_PRIVATE_FILES',bucket_name:'rexbid-production-private-files'});
 const f=wrapper(cfg,null,require('../sync/automatic-refresh.cjs'),{handleStoredRead:async()=>null,scheduledCatalogAuthority:async()=>({feed:20})});
 f.env.REXBID_PRIVATE_FILES={put(){},get(){},delete(){}};
 const response=await f.worker.fetch(request('/api/portal/config'),f.env,{});
 assert.equal(response.status,200);assert.equal(f.calls.length,1);
 const result=await f.worker.scheduled({cron:'*/15 * * * *'},f.env,{});
 assert.equal(result.stopReason,'server_feed_owns_updates');assert.equal(result.attempts,0);
});
test('private attachment publication rejects missing storage, partial storage and inconsistent rollout flags before routing',async()=>{
 const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'wrangler.active-catalog-cutover.jsonc')));
 for(const patch of [{REXBID_PRIVATE_FILES:undefined},{REXBID_PRIVATE_FILES:{get(){}}},{REXBID_PORTAL_FILES_ENABLED:'disabled'},{AUTH_ENABLED:'false'},{REXBID_PORTAL_ENABLED:'disabled'},{REXBID_PORTAL_OWNER_SETUP_ONLY:'true'},{REXBID_PUBLICATION_PHASE:'portal-no-files'}]){
  const f=wrapper(cfg);Object.assign(f.env,{REXBID_PRIVATE_FILES:{put(){},get(){},delete(){}}},patch);
  const response=await f.worker.fetch(request('/api/portal/config'),f.env,{});
  assert.equal(response.status,503);assert.equal(f.calls.length,0);
 }
});
