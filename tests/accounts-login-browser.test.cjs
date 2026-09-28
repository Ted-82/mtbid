const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const authSource = fs.readFileSync(path.join(root, 'public/rexbid-auth.js'), 'utf8');

function response(status, body, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), json: async () => body };
}

function makePage(fetchImpl, kind = 'login', pathname = '') {
  const html = fs.readFileSync(path.join(root, `public/${kind === 'login' ? 'logowanie' : 'rejestracja'}.html`), 'utf8');
  const ids = new Map();
  class Element {
    constructor(id, tagName = 'div') {
      this._id = id; this.tagName = tagName.toUpperCase(); this.value = ''; this.required = false;
      this.type = ''; this.noValidate = false; this.disabled = false; this.hidden = false;
      this.textContent = ''; this.dataset = {}; this.style = {}; this.listeners = {}; this.children = [];
      this.attributes = {}; this.parentElement = null; this.href = ''; this.defaultPrevented = false;
    }
    get id() { return this._id; }
    set id(value) { this._id = value; if (this.map && value) this.map.set(value, this); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...items) { for (const item of items) { if (item && typeof item === 'object') item.parentElement = this; this.children.push(item); } }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    after(item) { this.afterItem = item; }
    querySelector(selector) { return selector === 'button[type="submit"]' ? this.children.find(child => child.type === 'submit') || null : null; }
    get validity() {
      const value = String(this.value || '');
      return { valueMissing: this.required && !value, typeMismatch: this.type === 'email' && !!value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), valid: !(this.required && !value) && !(this.type === 'email' && !!value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) };
    }
    async emit(type, event = {}) {
      const emitted = { preventDefault() { this.defaultPrevented = true; }, ...event, defaultPrevented: false };
      for (const fn of this.listeners[type] || []) await fn(emitted);
      return emitted;
    }
    async click() {
      if (this.disabled) return;
      const event = await this.emit('click');
      if (event.defaultPrevented) return { clicked: true, prevented: true };
      if (this.type === 'submit' && this.form) return this.form.requestSubmit(this);
      return event;
    }
    async pressEnter() {
      const event = await this.emit('keydown', { key: 'Enter' });
      if (event.defaultPrevented) return { keyPrevented: true };
      return this.form?.requestSubmit(this);
    }
    async requestSubmit(submitter = null) {
      if (!this.noValidate) {
        const controls = [ids.get('email'), ids.get('password')].filter(Boolean);
        const invalid = controls.filter(control => !control.validity.valid);
        if (invalid.length) {
          for (const control of invalid) await control.emit('invalid');
          return { submitted: false, invalid: true };
        }
      }
      const event = await this.emit('submit', { submitter });
      return { submitted: true, prevented: event.defaultPrevented, invalid: false };
    }
  }

  const formId = kind === 'login' ? 'loginForm' : 'registerForm';
  const form = new Element(formId, 'form'); form.map = ids;
  const input = id => {
    const tag = new RegExp(`<input\\b(?=[^>]*\\bid="${id}")([^>]*)>`, 'is').exec(html)?.[1] || '';
    const el = new Element(id, 'input'); el.map = ids;
    el.type = /\btype="([^"]+)"/i.exec(tag)?.[1] || 'text'; el.required = /\brequired\b/i.test(tag);
    return el;
  };
  const name = kind === 'signup' ? input('name') : null;
  const email = input('email');
  const password = input('password');
  const terms = kind === 'signup' ? input('terms') : null;
  if (terms) terms.checked = false;
  const message = new Element('message');
  const submit = new Element('login-submit', 'button'); submit.type = 'submit'; submit.form = form;
  form.append(...[name,email,password,terms,submit].filter(Boolean));
  for (const control of [name,email,password,terms].filter(Boolean)) control.form = form;
  for (const el of [form, name, email, password, terms, message].filter(Boolean)) ids.set(el.id, el);
  const header = new Element('header-inner'), main = new Element('main'), body = new Element('body');
  const document = {
    readyState: 'complete', body,
    getElementById: id => ids.get(id) || null,
    createElement: tag => { const element = new Element('', tag); element.map = ids; return element; },
    createTextNode: value => ({ textContent: String(value) }),
    querySelector: selector => selector === 'header .header-inner, header .container' ? header : selector === 'main' ? main : null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const windowListeners = {};
  const location = { hostname: 'rexbid-auth-test.tedn828.workers.dev', pathname: pathname || (kind === 'login' ? '/logowanie.html' : '/rejestracja.html'), search: '', origin: 'https://rexbid-auth-test.tedn828.workers.dev', assigned: '', assign(value) { this.assigned = value; } };
  const window = { location, document, fetch: fetchImpl, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => false,
    dispatchEvent(event) { for (const fn of windowListeners[event.type] || []) fn(event); },
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); } };
  const context = { window, document, location, fetch: fetchImpl, localStorage: window.localStorage, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    URL, URLSearchParams, Headers, Promise, JSON, String, Number, Date, Error, console };

  vm.runInNewContext(authSource, context);
  // Run the actual inline fallback handler from logowanie.html in its source order.
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => match[1]).find(source => source.includes(`getElementById("${formId}")`));
  assert.ok(inline, 'actual account-page inline fallback is present');
  vm.runInNewContext(inline, context);
  return { form, name, email, password, terms, message, submit, location, document, auth: window.RexBidAuth, get diagnostic() { return message.afterItem; } };
}

test('normal login browser click reaches one BFF POST with valid email and password', async () => {
  const calls = []; let meCalls = 0;
  const page = makePage(async (url, options = {}) => {
    calls.push([url, options]);
    if (url === '/api/me') return ++meCalls === 1 ? response(401, { ok: false }) : response(200, { ok: true, user: { id: 'u1', auth_provider: 'supabase', email_verified: true } });
    if (url === '/api/auth/login') return response(200, { ok: true }, { 'X-RexBid-Request-ID': '00000000-0000-4000-8000-000000000001', 'X-RexBid-Set-Cookie': 'present' });
    return response(200, { ok: true, favorites: [] });
  });
  await page.auth.ready;
  page.email.value = 'verified@example.test'; page.password.value = 'correct-horse-battery';
  await page.submit.click();
  assert.equal(calls.filter(([url, options]) => url === '/api/auth/login' && options.method === 'POST').length, 1);
  assert.equal(page.location.assigned, '/konto.html');
});

test('extensionless Cloudflare asset routes initialize the actual login and registration forms', async () => {
  for (const [kind, route, operation] of [['login','/logowanie','/api/auth/login'],['signup','/rejestracja','/api/auth/signup']]) {
    const calls=[];
    const page=makePage(async(url,options={})=>{calls.push([url,options]);if(url==='/api/me')return response(401,{ok:false});return operation.endsWith('signup')?response(202,{ok:true,confirmation_required:true}):response(401,{ok:false});},kind,route);
    await page.auth.ready;
    if(kind==='signup'){page.name.value='Test';page.terms.checked=true;page.email.value='valid@example.test';page.password.value='safe-password';page.document.getElementById('passwordConfirm').value='safe-password';}
    else {page.email.value='bad-email';page.password.value='safe-password';}
    await page.submit.click();
    assert.equal(calls.some(([url])=>url===operation),kind==='signup');
    assert.ok(page.message.textContent,'extensionless route must initialize an explicit, visible validation/result state');
  }
});

test('normal login browser validation reports invalid email visibly and sends no request', async () => {
  const calls = [];
  const page = makePage(async (url, options = {}) => { calls.push([url, options]); return response(401, { ok: false }); });
  await page.auth.ready;
  page.email.value = 'not-an-email'; page.password.value = 'valid-password';
  await page.submit.click();
  assert.equal(calls.some(([url]) => url === '/api/auth/login'), false);
  assert.match(page.message.textContent, /e-mail|email/i);
  assert.equal(page.message.style.display, 'block');
  assert.match(page.diagnostic.textContent, /validation error/);
});

test('normal login Enter submits exactly once and stages progress through redirect', async () => {
  const calls = []; let meCalls = 0;
  const page = makePage(async (url, options = {}) => {
    calls.push([url, options]);
    if (url === '/api/me') return ++meCalls === 1 ? response(401, {}) : response(200, { ok: true, user: { id: 'u1', auth_provider: 'supabase', email_verified: true } });
    if (url === '/api/auth/login') return response(200, { ok: true }, { 'X-RexBid-Request-ID': '00000000-0000-4000-8000-000000000002', 'X-RexBid-Set-Cookie': 'present' });
    return response(200, { ok: true, favorites: [] });
  });
  await page.auth.ready;
  page.email.value = 'verified@example.test'; page.password.value = 'correct-horse-battery';
  await page.password.pressEnter();
  assert.equal(calls.filter(([url, options]) => url === '/api/auth/login' && options.method === 'POST').length, 1);
  assert.equal(page.location.assigned, '/konto.html');
  assert.match(page.diagnostic.textContent, /Login #1: redirecting to account/);
});

test('normal registration uses the same direct action flow and validates required fields without real signup', async () => {
  const calls = [];
  const page = makePage(async (url, options = {}) => { calls.push([url, options]); return url === '/api/auth/signup' ? response(202, { ok: true, confirmation_required: true }) : response(401, {}); }, 'signup');
  await page.auth.ready;
  page.email.value = 'owner@example.test'; page.password.value = 'safe-test-password'; page.name.value = 'Test'; page.terms.checked = true;
  const confirm = page.document.getElementById('passwordConfirm');
  assert.ok(confirm, 'signup confirmation input is created by the real auth client'); confirm.value = page.password.value;
  await page.submit.click();
  assert.equal(calls.filter(([url, options]) => url === '/api/auth/signup' && options.method === 'POST').length, 1);
  assert.match(page.message.textContent, /potwierdź adres e-mail/);
  assert.equal(page.location.assigned, '');
});

test('missing password is reported visibly and does not send a request', async () => {
  const calls = [];
  const page = makePage(async (url, options = {}) => { calls.push([url, options]); return response(401, {}); });
  await page.auth.ready;
  page.email.value = 'verified@example.test'; page.password.value = '';
  await page.submit.click();
  assert.equal(calls.some(([url]) => url === '/api/auth/login'), false);
  assert.match(page.message.textContent, /hasło/i);
  assert.equal(page.message.style.display, 'block');
});

test('normal login handles 401 safely without redirect', async () => {
  const calls = [];
  const page = makePage(async (url, options = {}) => { calls.push([url, options]); return response(401, { ok: false, error: 'private upstream detail' }); });
  await page.auth.ready;
  page.email.value = 'verified@example.test'; page.password.value = 'correct-horse-battery';
  await page.submit.click();
  assert.equal(calls.filter(([url]) => url === '/api/auth/login').length, 1);
  assert.equal(page.location.assigned, '');
  assert.match(page.message.textContent, /Nie udało się zalogować/);
  assert.equal(page.message.style.display, 'block');
  assert.doesNotMatch(page.message.textContent, /private upstream detail/);
});

test('normal login handles network failure and can be retried', async () => {
  const calls = []; let fail = true, meCalls = 0;
  const page = makePage(async (url, options = {}) => {
    calls.push([url, options]);
    if (url === '/api/me') return ++meCalls === 1 ? response(401, {}) : response(200, { ok: true, user: { id: 'u1', auth_provider: 'supabase', email_verified: true } });
    if (url === '/api/auth/login' && fail) throw new TypeError('private transport detail');
    if (url === '/api/auth/login') return response(200, { ok: true });
    return response(200, { ok: true, favorites: [] });
  });
  await page.auth.ready;
  page.email.value = 'verified@example.test'; page.password.value = 'correct-horse-battery';
  await page.submit.click();
  assert.match(page.message.textContent, /chwilowo niedostępne/);
  assert.match(page.diagnostic.textContent, /network or session error/);
  fail = false; page.password.value = 'correct-horse-battery';
  await page.submit.click();
  assert.equal(calls.filter(([url]) => url === '/api/auth/login').length, 2);
  assert.equal(page.location.assigned, '/konto.html');
});

test('double click during pending login sends only one POST', async () => {
  const calls = []; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const page = makePage(async (url, options = {}) => {
    calls.push([url, options]);
    if (url === '/api/me') return response(401, {});
    if (url === '/api/auth/login') { await pending; return response(401, {}); }
    return response(200, {});
  });
  await page.auth.ready;
  page.email.value = 'verified@example.test'; page.password.value = 'correct-horse-battery';
  const first = page.submit.click();
  const second = page.submit.click();
  await Promise.resolve();
  assert.equal(calls.filter(([url]) => url === '/api/auth/login').length, 1);
  release(); await Promise.all([first, second]);
});

test('pending initial /api/me bootstrap does not block login submit', async () => {
  const calls = []; let releaseInitial;
  const initialMe = new Promise(resolve => { releaseInitial = resolve; });
  const page = makePage(async (url, options = {}) => {
    calls.push([url, options]);
    if (url === '/api/me' && calls.filter(([path]) => path === '/api/me').length === 1) return initialMe;
    if (url === '/api/auth/login') return response(401, {});
    return response(401, {});
  });
  page.email.value = 'verified@example.test'; page.password.value = 'correct-horse-battery';
  const submit = page.submit.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(([url]) => url === '/api/auth/login').length, 1);
  releaseInitial(response(401, {})); await submit;
});

test('shared real public auth client completes login, cloud favorites, logout and clears private state', async () => {
  const calls = []; let loggedIn = false; let cloud = [];
  const page = makePage(async (url, options = {}) => {
    calls.push([url, options]);
    if (url === '/api/auth/login') { loggedIn = true; return response(200, { ok: true }, { 'X-RexBid-Set-Cookie': 'present' }); }
    if (url === '/api/auth/logout') { loggedIn = false; return response(200, { ok: true }); }
    if (url === '/api/me') return loggedIn ? response(200, { ok: true, user: { id: 'account-1', auth_provider: 'supabase', email_verified: true } }) : response(401, { ok: false });
    if (url === '/api/me/favorites' && options.method === 'GET') return response(200, { ok: true, favorites: cloud });
    if (url === '/api/me/favorites' && options.method === 'POST') { const value = JSON.parse(options.body); cloud = [{ ...value, key: value.vin ? `vin:${value.vin}` : `lot:${value.platform}:${value.lot}` }]; return response(201, { ok: true }); }
    if (url.startsWith('/api/me/favorites/') && options.method === 'DELETE') { cloud = []; return response(200, { ok: true }); }
    return response(404, { ok: false });
  });
  await page.auth.ready;
  page.email.value = 'verified@example.test'; page.password.value = 'correct-horse-battery';
  await page.submit.click();
  assert.equal(page.auth.status, 'authenticated');
  assert.equal(page.auth.user.id, 'account-1');
  assert.equal(page.auth.getFavorites().length, 0);
  const added = await page.auth.addFavoriteIdentity({ lot: 'LOT-1', platform: 'copart' });
  assert.equal(added.ok, true); assert.equal(added.status, 201);
  assert.equal(page.auth.getFavorites().length, 1);
  assert.equal(page.auth.getFavorites()[0].id, 'lot:copart:LOT-1');
  assert.equal(await page.auth.removeFavorite('lot:copart:LOT-1'), true);
  assert.equal(page.auth.getFavorites().length, 0);
  await page.auth.logout();
  assert.equal(page.auth.status, 'anonymous');
  assert.equal(page.auth.user, null);
  assert.equal(page.auth.getFavorites().length, 0);
  assert.deepEqual(calls.filter(([url]) => ['/api/auth/login','/api/auth/logout','/api/me','/api/me/favorites'].some(path => url === path) || url.startsWith('/api/me/favorites/')).map(([url,options]) => [url,options.method || 'GET']), [
    ['/api/me','GET'], ['/api/auth/login','POST'], ['/api/me','GET'], ['/api/me/favorites','GET'], ['/api/me/favorites','POST'], ['/api/me/favorites','GET'], ['/api/me/favorites/lot%3Acopart%3ALOT-1','DELETE'], ['/api/me/favorites','GET'], ['/api/auth/logout','POST']
  ]);
});
