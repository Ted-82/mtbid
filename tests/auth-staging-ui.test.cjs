const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const correlation = require('../staging/request-correlation.cjs');

const root = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'staging/auth-test-page.js'), 'utf8');
const html = pageSource.match(/String\.raw`([\s\S]*)`;\s*export default/)[1];
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function pageHarness(fetchImpl, hostname = 'rexbid-auth-test.tedn828.workers.dev', { omitIds = [] } = {}) {
  const elements = new Map();
  class Element {
    constructor(id = '') { this.id = id; this.dataset = {}; this.listeners = {}; this.value = ''; this.disabled = false; this.textContent = ''; this.children = []; this.type = ''; this.form = null; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
    async click() {
      if (this.disabled) return;
      if (this.type === 'submit' && this.form) {
        let prevented = false;
        const event = { submitter: this, preventDefault() { prevented = true; } };
        await this.form.listeners.submit(event);
        this.form.lastSubmitPrevented = prevented;
        return;
      }
      await this.listeners.click?.({ target: this });
    }
  }
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) if (!omitIds.includes(id)) elements.set(id, new Element(id));
  const credentials = elements.get('credentials');
  for (const [, attributes] of html.matchAll(/<button\b([^>]*)>/g)) {
    const id = attributes.match(/\bid="([^"]+)"/)?.[1];
    if (!id || !elements.has(id)) continue;
    const button = elements.get(id);
    button.type = attributes.match(/\btype="([^"]+)"/)?.[1] || 'submit';
    if (button.type === 'submit') button.form = credentials;
  }
  elements.get('favorite-platform').value = 'copart';
  const document = { body: new Element('body'), getElementById: id => elements.get(id), createElement: tag => new Element(tag) };
  const window = { listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } };
  vm.runInNewContext(script, { document, window, location: { hostname }, fetch: fetchImpl, JSON, String, Error, Promise });
  return { elements, document, html, script, window };
}

function response(status, data, headers = {}) { return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), json: async () => data }; }

test('staging wrapper and embedded page modules parse; correlation helper parses as CommonJS', () => {
  for (const relative of ['worker.staging.js', 'staging/auth-test-page.js']) {
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: fs.readFileSync(path.join(root, relative), 'utf8'),
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }
  execFileSync(process.execPath, ['--check', path.join(root, 'staging/request-correlation.cjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
});

test('staging Wrangler config binds only the isolated Worker and D1; production config is untouched', () => {
  const staging = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.staging.jsonc'), 'utf8'));
  const production = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));
  assert.equal(staging.name, 'rexbid-auth-test');
  assert.equal(staging.main, './worker.staging.js');
  assert.equal(staging.d1_databases[0].binding, 'REXBID_DB');
  assert.equal(staging.d1_databases[0].database_name, 'rexbid-auth-test-db');
  assert.equal(staging.d1_databases[0].database_id, 'acb3cb8e-69a2-459f-8a46-0f2f5b9004be');
  assert.equal(staging.vars.REXBID_AUTH_TEST_UI, 'enabled');
  assert.equal(staging.vars.REXBID_AUTH_TEST_HOST, 'rexbid-auth-test.tedn828.workers.dev');
  assert.equal(staging.vars.REXBID_AUTH_DIAGNOSTICS, 'enabled');
  assert.equal(production.name, 'mtbid');
  assert.equal(production.main, './worker.js');
  assert.equal(production.d1_databases[0].database_name, 'rexbid-db');
  assert.equal(production.d1_databases[0].database_id, '971879fe-04ed-4e8c-9dc6-5306980bb872');
  assert.equal(production.vars?.REXBID_AUTH_DIAGNOSTICS, undefined);
});

test('test UI and safe auth diagnostics remain staging-only; obsolete connectivity probes are removed', () => {
  const wrapper = fs.readFileSync(path.join(root, 'worker.staging.js'), 'utf8');
  assert.match(wrapper, /REQUIRED_TEST_HOST\s*=\s*"rexbid-auth-test\.tedn828\.workers\.dev"/);
  assert.doesNotMatch(wrapper, /raw-connectivity|__staging\/(?:auth-connectivity|raw-supabase-connectivity|raw-control-connectivity|fetch-option-sequence)/);
  assert.match(wrapper, /import authTestHtml from "\.\/staging\/auth-test-page\.js"/);
  assert.match(wrapper, /REXBID_AUTH_TEST_UI\s*===\s*"enabled"/);
  assert.match(wrapper, /url\.hostname\s*===\s*REQUIRED_TEST_HOST/);
  assert.match(wrapper, /url\.pathname\s*===\s*"\/auth-test\.html"/);
  assert.match(wrapper, /headers\.set\("Location", "\/auth-test\.html"\)/);
  assert.match(wrapper, /requestCorrelation\.correlateRequest/);
  assert.match(wrapper, /requestCorrelation\.correlateResponse/);
  assert.match(wrapper, /getSetCookie\(\)/);
  assert.match(wrapper, /script-src 'unsafe-inline'/);
  assert.match(wrapper, /connect-src 'self'/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'worker.js'), 'utf8'), /auth-test\.html/);
  assert.match(fs.readFileSync(path.join(root, 'auth/routes.js'), 'utf8'), /X-RexBid-Request-ID/);
  assert.doesNotMatch(fs.readdirSync(path.join(root, 'public')).join('\n'), /auth-test\.html/);
});

test('staging page runs only on staging host, calls same-origin BFF routes, and has no token/storage/XSS code paths', async () => {
  const calls = [];
  const { elements } = pageHarness(async (url, options) => { calls.push([url, options]); return response(401, { ok: false, error: 'Wymagane logowanie.' }); });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0][0], '/api/me');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(elements.get('auth-state').textContent, 'Anonymous');
  assert.doesNotMatch(script, /localStorage|sessionStorage|innerHTML|access_token|refresh_token|Authorization|console\./i);
  assert.match(html, /type="password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(script, /\/api\/auth\/signup/);
  assert.match(html, /<form id="credentials"[\s\S]*?<button id="signup" type="button"/);
  assert.match(html, /<button id="login" type="button"/);
  assert.match(script, /byId\("signup"\)\.addEventListener\("click"/);
  assert.match(script, /byId\("login"\)\.addEventListener\("click"/);
  assert.doesNotMatch(script, /event\.submitter/);
  assert.match(html, /id="signup-diagnostic"[^>]*data-stage="Ready"/);
  assert.match(script, /\/api\/auth\/login/);
  assert.match(script, /"\/api\/auth\/"\s*\+\s*operation/);
  assert.match(script, /\["refresh", "logout"\]/);
  assert.match(script, /\/api\/me\/favorites/);
  assert.match(html, /Sprawdź pocztę i potwierdź adres e-mail\./);
  assert.match(script, /textContent\s*=/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  pageHarness(async () => response(401, {}), 'mtbid.tedn828.workers.dev');
  assert.match(script, /location\.hostname\s*!==\s*requiredHost/);
});

test('signup UI shows confirmation state and clears password without rendering raw provider fields', async () => {
  const calls = [];
  const { elements } = pageHarness(async (url, options) => {
    calls.push([url, options]);
    return response(202, { ok: true, confirmation_required: true, message: 'Sprawdź pocztę i potwierdź adres e-mail.', access_token: 'must-not-render' });
  });
  await new Promise(resolve => setImmediate(resolve));
  elements.get('email').value = 'owner-test@example.invalid';
  elements.get('password').value = 'test-only-password';
  await elements.get('signup').click();
  const signup = calls.find(([url]) => url === '/api/auth/signup');
  assert.ok(signup);
  assert.equal(signup[1].method, 'POST');
  assert.equal(JSON.parse(signup[1].body).password, 'test-only-password');
  assert.equal(elements.get('password').value, '');
  assert.equal(elements.get('auth-state').textContent, 'Awaiting email confirmation');
  assert.equal(elements.get('auth-message').textContent, 'Sprawdź pocztę i potwierdź adres e-mail.');
  assert.equal(elements.get('signup-diagnostic').dataset.stage, 'response received');
  assert.match(elements.get('signup-diagnostic').textContent, /^Signup #1: response received — HTTP 202/);
  assert.doesNotMatch(elements.get('auth-message').textContent + elements.get('me-facts').textContent, /must-not-render|access_token/);
});

test('rendered signup click sends POST and reports a resolved 2xx response', async () => {
  const calls = [];
  const { elements, window } = pageHarness(async (url, options) => {
    calls.push([url, options]);
    return url === '/api/me' ? response(401, {ok:false}) : response(202, {ok:true,confirmation_required:true});
  });
  await new Promise(resolve => setImmediate(resolve));
  elements.get('email').value = 'owner-test@example.invalid';
  elements.get('password').value = 'test-only-password';
  await elements.get('signup').click();
  assert.ok(calls.some(([url, options]) => url === '/api/auth/signup' && options.method === 'POST'));
  assert.equal(elements.get('signup-diagnostic').textContent, 'Signup #1: response received — HTTP 202 · Request: unavailable · Set-Cookie: absent');
  assert.equal(elements.get('auth-state').textContent, 'Awaiting email confirmation');
  assert.equal(typeof window.listeners.error, 'function');
  assert.equal(typeof window.listeners.unhandledrejection, 'function');
});

test('resolved 4xx signup shows response-received status and safe generic error', async () => {
  const calls = [];
  const { elements } = pageHarness(async (url, options) => {
    calls.push([url, options]);
    return url === '/api/me' ? response(401, {ok:false}) : response(422, {ok:false,error:'private provider detail'});
  });
  await new Promise(resolve => setImmediate(resolve));
  elements.get('email').value = 'owner-test@example.invalid';
  elements.get('password').value = 'test-only-password';
  await elements.get('signup').click();
  assert.ok(calls.some(([url]) => url === '/api/auth/signup'));
  assert.equal(elements.get('signup-diagnostic').dataset.stage, 'response received');
  assert.equal(elements.get('auth-message').textContent, 'Rejestracja nie powiodła się. Sprawdź ustawienia staging Auth.');
  assert.doesNotMatch(elements.get('signup-diagnostic').textContent + elements.get('auth-message').textContent, /private provider detail|owner-test|test-only-password/);
});

test('rejected signup fetch reports a safe network UI error', async () => {
  const calls = [];
  const { elements } = pageHarness(async (url, options) => {
    calls.push([url, options]);
    if (url === '/api/me') return response(401, {ok:false});
    throw new TypeError('sensitive network detail');
  });
  await new Promise(resolve => setImmediate(resolve));
  elements.get('email').value = 'owner-test@example.invalid';
  elements.get('password').value = 'test-only-password';
  await elements.get('signup').click();
  assert.ok(calls.some(([url]) => url === '/api/auth/signup'));
  assert.equal(elements.get('signup-diagnostic').dataset.stage, 'UI error');
  assert.equal(elements.get('signup-diagnostic').textContent, 'Signup #1: UI exception sending (TypeError)');
  assert.doesNotMatch(elements.get('signup-diagnostic').textContent + elements.get('auth-message').textContent, /sensitive network detail|owner-test|test-only-password/);
});

test('runtime error before fetch is visible as sanitized signup UI error and sends no signup request', async () => {
  const calls = [];
  const { elements } = pageHarness(async (url, options) => {
    calls.push([url, options]);
    return response(401, {ok:false});
  }, 'rexbid-auth-test.tedn828.workers.dev', { omitIds: ['email'] });
  await new Promise(resolve => setImmediate(resolve));
  elements.get('password').value = 'test-only-password';
  await elements.get('signup').click();
  assert.equal(calls.some(([url]) => url === '/api/auth/signup'), false);
  assert.equal(elements.get('signup-diagnostic').dataset.stage, 'UI error');
  assert.equal(elements.get('signup-diagnostic').textContent, 'Signup #1: UI exception preparing (TypeError)');
  assert.doesNotMatch(elements.get('signup-diagnostic').textContent, /test-only-password|undefined|email/i);
});

test('rendered Log in click clears stale signup state and performs exactly one correlated BFF POST', async () => {
  const calls = [];
  const requestId = 'a7f3d604-71bc-4fd5-9b07-0bb3f457c245';
  const { elements } = pageHarness(async (url, options) => {
    calls.push([url, options]);
    if (url === '/api/me' && calls.length === 1) return response(401, {ok:false});
    if (url === '/api/auth/login') return response(200, {ok:true}, { 'X-RexBid-Request-ID': requestId, 'X-RexBid-Set-Cookie': 'present' });
    if (url === '/api/me') return response(200, {ok:true,user:{id:'safe-user-id',auth_provider:'supabase',email_verified:true}});
    return response(404, {ok:false});
  });
  await new Promise(resolve => setImmediate(resolve));
  elements.get('auth-state').textContent = 'Awaiting email confirmation';
  elements.get('auth-state').dataset.state = 'Awaiting email confirmation';
  elements.get('signup-diagnostic').textContent = 'Signup response received';
  elements.get('signup-diagnostic').dataset.stage = 'response received';
  elements.get('email').value = 'owner-test@example.invalid';
  elements.get('password').value = 'test-only-password';

  await elements.get('login').click();

  const loginCalls = calls.filter(([url]) => url === '/api/auth/login');
  assert.equal(loginCalls.length, 1);
  assert.equal(loginCalls[0][1].method, 'POST');
  assert.equal(JSON.parse(loginCalls[0][1].body).password, 'test-only-password');
  assert.equal(calls.some(([url]) => url === '/api/auth/signup'), false);
  assert.equal(elements.get('auth-state').textContent, 'Authenticated');
  assert.match(elements.get('signup-diagnostic').textContent, new RegExp(`^Login #1: response received — HTTP 200 · Request: ${requestId} · Set-Cookie: present$`));
  assert.doesNotMatch(elements.get('signup-diagnostic').textContent, /Signup response received|Awaiting email confirmation|test-only-password|owner-test/);
  assert.equal(elements.get('password').value, '');
});

test('logout clears rendered private user and favorite data before anonymous session check', async () => {
  const calls = [];
  let loggedOut = false;
  const { elements } = pageHarness(async (url, options) => {
    calls.push([url, options]);
    if (url === '/api/me') return loggedOut ? response(401, {ok:false}) : response(200, {ok:true,user:{id:'staging-user',auth_provider:'supabase',email_verified:true}});
    if (url === '/api/me/favorites') return response(200, {ok:true,favorites:[{key:'lot:copart:99999999',platform:'copart'}]});
    if (url === '/api/auth/logout') { loggedOut = true; return response(200, {ok:true}); }
    return response(404, {ok:false});
  });
  await new Promise(resolve => setImmediate(resolve));
  await elements.get('favorite-list').click();
  assert.equal(elements.get('favorite-list-output').children.length, 1);
  assert.match(elements.get('me-facts').textContent, /staging-user/);

  await elements.get('logout').click();

  assert.equal(loggedOut, true);
  assert.equal(elements.get('auth-state').textContent, 'Anonymous');
  assert.equal(elements.get('me-facts').textContent, '');
  assert.equal(elements.get('favorite-list-output').children.length, 0);
  assert.equal(elements.get('favorite-message').textContent, '');
  assert.ok(calls.some(([url]) => url === '/api/auth/logout'));
  assert.ok(calls.filter(([url]) => url === '/api/me').length >= 2);
});

test('401 from cloud favorites clears stale rendered private data immediately', async () => {
  const { elements } = pageHarness(async url => url === '/api/me'
    ? response(200, {ok:true,user:{id:'staging-user',auth_provider:'supabase',email_verified:true}})
    : response(401, {ok:false}));
  await new Promise(resolve => setImmediate(resolve));
  elements.get('me-facts').textContent = 'cached private user';
  const item = {textContent:'lot:copart:99999999'};
  elements.get('favorite-list-output').append(item);

  await elements.get('favorite-list').click();

  assert.equal(elements.get('auth-state').textContent, 'Anonymous');
  assert.equal(elements.get('me-facts').textContent, '');
  assert.equal(elements.get('favorite-list-output').children.length, 0);
});

test('staging BFF correlation IDs are random, round-trip in headers, and logs omit request data', async () => {
  const id = 'a7f3d604-71bc-4fd5-9b07-0bb3f457c245';
  const original = new Request('https://rexbid-auth-test.tedn828.workers.dev/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:'private@example.invalid',password:'private-password'})});
  const originalBody = await original.clone().text();
  assert.equal(correlation.authOperation(new URL(original.url).pathname), 'login');
  assert.equal(correlation.authOperation('/api/auth/login/extra'), '');
  const correlated = correlation.correlateRequest(original.clone(), 'login', {randomUUID:()=>id});
  assert.equal(correlated.request.headers.get('X-RexBid-Request-ID'), id);
  assert.equal(await correlated.request.text(), originalBody);
  const lines = [];
  const responseWithId = correlation.correlateResponse(new Response(JSON.stringify({ok:true}), {status:200, headers:{'Set-Cookie':'__Host-rexbid_session=secret-cookie; HttpOnly'}}), id, 'login', (...args)=>lines.push(args));
  assert.equal(responseWithId.headers.get('X-RexBid-Request-ID'), id);
  assert.equal(responseWithId.headers.get('X-RexBid-Set-Cookie'), 'present');
  assert.match(responseWithId.headers.get('Set-Cookie'), /HttpOnly/);
  assert.deepEqual(JSON.parse(lines[0][1]), {operation:'login',stage:'response',request_id:id,http_status:200,set_cookie_present:true});
  assert.doesNotMatch(lines.flat().join(' '), /private@example|private-password|secret-cookie/);
});

test('test UI exercises favorite add/list/delete/merge through BFF and safely renders keys', async () => {
  const calls = [], records = new Map();
  const { elements } = pageHarness(async (url, options) => {
    calls.push([url, options]);
    if (url === '/api/me') return response(401, {ok:false});
    if (url === '/api/me/favorites' && options.method === 'POST' || url.endsWith('/merge')) {
      const body = JSON.parse(options.body), items = url.endsWith('/merge') ? body.favorites : [body];
      for (const item of items) { const key = item.vin ? 'vin:' + item.vin.toUpperCase() : 'lot:' + item.platform.toLowerCase() + ':' + item.lot.toUpperCase(); records.set(key, {key, platform:item.platform}); }
      return response(url.endsWith('/merge') ? 200 : 201, {ok:true, merged:items.length});
    }
    if (url === '/api/me/favorites' && options.method === 'GET') return response(200, {ok:true,favorites:[...records.values()]});
    if (url.startsWith('/api/me/favorites/') && options.method === 'DELETE') { records.delete(decodeURIComponent(url.split('/').pop())); return response(200,{ok:true}); }
    return response(404,{ok:false});
  });
  await new Promise(resolve => setImmediate(resolve));
  elements.get('favorite-lot').value = 'AUTH-E2E-123';
  await elements.get('favorite-add').click();
  await elements.get('favorite-merge').click();
  await elements.get('favorite-list').click();
  assert.equal(elements.get('favorite-list-output').children.length, 1);
  assert.equal(elements.get('favorite-list-output').children[0].textContent, 'lot:copart:AUTH-E2E-123 · copart');
  await elements.get('favorite-delete').click();
  assert.equal(records.size, 0);
  assert.deepEqual(calls.filter(([url]) => url.startsWith('/api/me/favorites')).map(([url,opts]) => [url,opts.method]), [
    ['/api/me/favorites','POST'], ['/api/me/favorites/merge','POST'], ['/api/me/favorites','GET'], ['/api/me/favorites/lot%3Acopart%3AAUTH-E2E-123','DELETE']
  ]);
  assert.doesNotMatch(script, /localStorage|sessionStorage|\.innerHTML/);
});
