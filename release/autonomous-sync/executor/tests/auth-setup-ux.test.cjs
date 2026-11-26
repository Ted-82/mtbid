'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const OWNER = '63dddc72-e565-4a82-a593-a1bff6df9722';
const response = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
async function settle(predicate) {
  const end = Date.now() + 2000;
  while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(predicate(), 'expected DOM/network state was not reached');
}
async function page(t, file, {authenticated = false, authEnabled = true, portal = {ok: true, enabled: false, uploads_enabled: false}, download} = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'public', file), 'utf8'), {
    url: 'https://rexbid-auth-test.tedn828.workers.dev/' + file, runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document, requests = [];
  win.RexBidStorage = {getGuestFavorites: () => [], refreshCounts() {}};
  if (download) win.RexBidDataExport = {download};
  win.fetch = async (url, options = {}) => {
    requests.push({url, method: options.method || 'GET', body: options.body});
    if (url === '/api/auth/config') return response({ok: true, enabled: authEnabled});
    if (url === '/api/me') return authenticated ? response({ok: true, user: {id: OWNER, email: 'fixture@example.test', email_verified: true}}) : response({ok: false}, 401);
    if (url === '/api/me/favorites') return response({ok: true, favorites: []});
    if (url === '/api/portal/config') {
      if (typeof portal === 'function') return portal();
      if (portal instanceof Error) throw portal;
      return response(portal);
    }
    if (url === '/api/auth/signup') return response({ok: true, confirmation_required: true}, 202);
    if (url === '/api/auth/logout') {authenticated = false; return response({ok: true});}
    throw Error('unexpected route: ' + url);
  };
  win.eval(fs.readFileSync(path.join(ROOT, 'public/rexbid-auth.js'), 'utf8'));
  await win.RexBidAuth.ready;
  await win.RexBidAuth.initialize();
  return {win, doc, requests};
}

test('registration asks only for used credentials; terms acceptance links to actual terms with separate privacy information', async t => {
  const p = await page(t, 'rejestracja.html');
  assert.equal(p.doc.querySelector('#name,input[autocomplete="given-name"]'), null);
  const terms = p.doc.querySelector('label[for="terms"]');
  assert.equal(terms.querySelector('a').getAttribute('href'), '/warunki');
  assert.doesNotMatch(terms.textContent, /prywatno/i);
  assert.equal(p.doc.querySelector('input#terms').required, true);
  assert.ok(p.doc.querySelector('a[href="/prywatnosc"]'));
  assert.equal(p.doc.querySelectorAll('input[type="checkbox"]').length, 1);
  p.doc.getElementById('email').value = 'client@example.test';
  p.doc.getElementById('password').value = 'synthetic-test-password';
  p.doc.getElementById('passwordConfirm').value = 'synthetic-test-password';
  const form = p.doc.getElementById('registerForm');
  form.dispatchEvent(new p.win.Event('submit', {bubbles: true, cancelable: true}));
  await settle(() => p.doc.getElementById('message').textContent.includes('Zaakceptuj warunki'));
  assert.equal(p.requests.some(item => item.url === '/api/auth/signup'), false);
  assert.equal(p.doc.getElementById('terms').getAttribute('aria-invalid'), 'true');
  assert.doesNotMatch(p.doc.getElementById('message').textContent, /politykę prywatności/);
  p.doc.getElementById('terms').checked = true;
  p.doc.getElementById('terms').dispatchEvent(new p.win.Event('change', {bubbles: true}));
  form.dispatchEvent(new p.win.Event('submit', {bubbles: true, cancelable: true}));
  await settle(() => p.doc.getElementById('message').textContent.includes('wysłaliśmy'));
  const signup = p.requests.filter(item => item.url === '/api/auth/signup');
  assert.equal(signup.length, 1);
  assert.deepEqual(JSON.parse(signup[0].body), {email: 'client@example.test', password: 'synthetic-test-password'});
  assert.equal(p.doc.getElementById('password').value, '');
  assert.equal(p.doc.getElementById('passwordConfirm').value, '');
});

test('registration fails closed if the required terms control is missing', async t => {
  const p = await page(t, 'rejestracja.html');
  // A control removed after mounting still retains its unchecked state.
  p.doc.getElementById('terms').remove();
  p.doc.getElementById('email').value = 'client@example.test';
  p.doc.getElementById('password').value = p.doc.getElementById('passwordConfirm').value = 'synthetic-test-password';
  p.doc.getElementById('registerForm').dispatchEvent(new p.win.Event('submit', {bubbles: true, cancelable: true}));
  await settle(() => p.doc.getElementById('message').textContent.includes('Zaakceptuj warunki'));
  assert.equal(p.requests.some(item => item.url === '/api/auth/signup'), false);
});

test('account header avoids duplicate auction action and allows compact controls to wrap', async t => {
  const p = await page(t, 'konto.html', {authenticated: true});
  assert.equal(p.doc.querySelector('header .header-inner > .btn'), null);
  assert.ok(p.doc.body.classList.contains('rex-account-page'));
  assert.match(p.doc.querySelector('style').textContent, /body\.rex-account-page header \.header-inner\s*\{\s*flex-wrap: wrap/);
});

test('account portal OFF hides unavailable imports and describes only account/favorites export', async t => {
  const p = await page(t, 'konto.html', {authenticated: true, download: async ({getIdentity}) => {
    assert.equal(getIdentity(), OWNER); return {ok: true, scope: 'account_favorites_only'};
  }});
  await settle(() => p.doc.getElementById('accountExportNotice')?.textContent.includes('Panel importów jest obecnie niedostępny'));
  assert.equal(p.doc.querySelector('[data-rexbid-account-portal]').hidden, true);
  assert.equal(p.requests.filter(item => item.url === '/api/portal/config').length, 1);
  assert.ok(p.requests.filter(item => item.url === '/api/portal/config').every(item => item.method === 'GET' && item.body === undefined));
  assert.doesNotMatch(p.doc.getElementById('accountExportNotice').textContent, /pobierzesz.*panelu/);
  p.doc.getElementById('accountDownload').click();
  await settle(() => p.doc.getElementById('accountExportStatus').textContent.includes('Pobrano dane konta i ulubione'));
  assert.match(p.doc.getElementById('accountExportStatus').textContent, /nie są objęte tym eksportem/);
  assert.equal(p.requests.some(item => /^\/api\/portal\/(?!config$)/.test(item.url)), false);
});

test('account portal ON retains staging imports and separates attachment availability from the export contents', async t => {
  for (const uploads_enabled of [false, true]) {
    const p = await page(t, 'konto.html', {authenticated: true, portal: {ok: true, enabled: true, uploads_enabled}, download: async () => ({ok: true, scope: 'authenticated_account_and_own_customer_orders'})});
    await settle(() => p.doc.querySelector('[data-rexbid-account-portal]').hidden === false);
    const link = p.doc.querySelector('[data-rexbid-account-portal] a');
    assert.equal(link.getAttribute('href'), '/panel.html');
    assert.equal(link.textContent.includes('dokumenty'), uploads_enabled);
    const notice = p.doc.getElementById('accountExportNotice').textContent;
    assert.match(notice, /Nie zawiera treści załączników/);
    assert.equal(notice.includes('pobierzesz osobno'), uploads_enabled);
    p.doc.getElementById('accountDownload').click();
    await settle(() => p.doc.getElementById('accountExportStatus').textContent.includes('własne importy'));
    assert.match(p.doc.getElementById('accountExportStatus').textContent, /metadanymi plików/);
    assert.equal(p.requests.filter(item => item.url === '/api/portal/config').length, 1);
  }
});

test('unknown portal configuration and anonymous/disabled sessions never expose a portal link or promise downloadable files', async t => {
  for (const options of [{authenticated: true, portal: new Error('unavailable')}, {authenticated: true, portal: {ok: true, enabled: 'true'}}, {}, {authEnabled: false}]) {
    const p = await page(t, 'konto.html', options);
    await settle(() => p.doc.getElementById('accountAuthMount').textContent !== 'Sprawdzam status konta…');
    assert.equal(p.doc.querySelector('[data-rexbid-account-portal]').hidden, true);
    assert.doesNotMatch(p.doc.getElementById('accountExportNotice')?.textContent || '', /pobierzesz osobno/);
    if (!options.authenticated) assert.equal(p.requests.some(item => item.url === '/api/portal/config'), false);
  }
});

test('a late portal capability response cannot reopen account features after logout removes the identity', async t => {
  let completePortal;
  const p = await page(t, 'konto.html', {authenticated: true, portal: () => new Promise(resolve => {completePortal = resolve;})});
  await settle(() => typeof completePortal === 'function');
  assert.equal(p.doc.querySelector('[data-rexbid-account-portal]').hidden, true);
  await p.win.RexBidAuth.logout();
  completePortal(response({ok: true, enabled: true, uploads_enabled: true}));
  await settle(() => p.win.RexBidAuth.status === 'anonymous' && p.doc.getElementById('accountDownload') === null);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(p.doc.querySelector('[data-rexbid-account-portal]').hidden, true);
  assert.equal(p.doc.getElementById('accountExportNotice'), null);
  assert.match(p.doc.getElementById('accountAuthMount').textContent, /Zaloguj się do konta/);
});

test('account closure is an explicit contact request rather than an automatic deletion control', async t => {
  const p = await page(t, 'konto.html');
  const section = p.doc.getElementById('accountClosureTitle').closest('section');
  assert.match(section.querySelector('a').getAttribute('href'), /^mailto:kontakt@rexbid\.pl\?/);
  assert.match(section.textContent, /nie usuwa automatycznie konta ani danych/);
  assert.match(section.textContent, /Nie przesyłaj hasła ani kodów/);
  assert.equal(section.querySelector('form,button'), null);
  assert.equal(section.querySelector('a[href="/prywatnosc"]').textContent, 'polityka prywatności');
  assert.equal(p.requests.some(item => /delete|closure/.test(item.url)), false);
});
