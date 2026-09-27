const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');
const { createSupabaseAuthProvider, verifySupabaseJwt } = require('../auth/supabase.js');
const { createAccountsHandler } = require('../auth/routes.js');
const { openCookiePayload, readCookie, sessionCookieName } = require('../auth/session.js');
const { createRexIdentity, createAuthProviderRegistry } = require('../auth/identity.js');

const root = path.resolve(__dirname, '..');
const env = {
  SUPABASE_URL: 'https://rex-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_id',
  REXBID_AUTH_COOKIE_SECRET: 'local-test-cookie-encryption-secret-32-bytes-minimum-entropy'
};
const issuer = `${env.SUPABASE_URL}/auth/v1`;
const encoder = new TextEncoder();
const b64url = value => Buffer.from(value).toString('base64url');

async function makeSigningKeys() {
  const pair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, jwk: { ...jwk, kid: 'rex-test-key', alg: 'RS256', use: 'sig' } };
}

async function signJwt(pair, claims, header = { alg: 'RS256', kid: 'rex-test-key', typ: 'JWT' }) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function identityFor(subject, emailVerified = true, provider = 'google') {
  return createRexIdentity({ issuer, subject, email_verified: emailVerified, auth_provider: provider });
}

class MemoryD1 {
  constructor() { this.users = new Map(); this.favorites = new Map(); }
  prepare(sql) {
    const db = this; let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() {
        if (/INSERT INTO users/i.test(sql)) {
          const [newId, authIssuer, authSubject, authProvider, createdAt, updatedAt] = args;
          let row = [...db.users.values()].find(item => item.auth_issuer === authIssuer && item.auth_subject === authSubject);
          if (row) { row.auth_provider = authProvider; row.email_verified = 1; row.updated_at = updatedAt; }
          else { row = { id: newId, auth_issuer: authIssuer, auth_subject: authSubject, auth_provider: authProvider, email_verified: 1, created_at: createdAt, updated_at: updatedAt }; db.users.set(row.id, row); }
          return { id: row.id, auth_provider: row.auth_provider, email_verified: row.email_verified, created_at: row.created_at };
        }
        if (/FROM users/i.test(sql)) {
          const row = [...db.users.values()].find(item => item.auth_issuer === args[0] && item.auth_subject === args[1]);
          return row ? { id: row.id, auth_provider: row.auth_provider, email_verified: row.email_verified, created_at: row.created_at } : null;
        }
        return null;
      },
      async all() {
        if (!/FROM user_favorites/i.test(sql)) return { results: [] };
        return { results: [...db.favorites.values()].filter(item => item.user_id === args[0]).map(item => ({ ...item })) };
      },
      async run() {
        if (/INSERT INTO user_favorites/i.test(sql)) {
          const [user_id, favorite_key, vin, lot, platform, created_at, updated_at] = args;
          const key = `${user_id}|${favorite_key}`;
          if (!db.favorites.has(key)) db.favorites.set(key, { user_id, favorite_key, vin, lot, platform, created_at, updated_at });
        } else if (/DELETE FROM user_favorites/i.test(sql)) db.favorites.delete(`${args[0]}|${args[1]}`);
        return { success: true };
      }
    };
  }
  async batch(statements) { for (const statement of statements) await statement.run(); return []; }
}

function request(pathname, { method = 'GET', body, cookie = '', origin = 'https://rex.test', host = 'https://rex.test' } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  if (origin) headers.set('Origin', origin);
  if (body !== undefined) { headers.set('Content-Type', 'application/json'); headers.set('Content-Length', String(Buffer.byteLength(JSON.stringify(body)))); }
  return new Request(`${host}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function bearerCookieFrom(response) {
  const cookies = response.headers.getSetCookie();
  const set = cookies.find(value => value.startsWith(`${sessionCookieName}=`));
  assert.ok(set, 'session cookie is set');
  return set.split(';')[0];
}

test('Supabase adapter validates JWKS JWT and maps verified identity without email identity keys', async () => {
  const keys = await makeSigningKeys();
  const subject = 'user-7f59';
  const token = await signJwt(keys.pair, { iss: issuer, sub: subject, aud: 'authenticated', exp: 2000000000, email: 'person@example.test' });
  const calls = [];
  const provider = createSupabaseAuthProvider({ now: () => 1800000000, fetchImpl: async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === `${issuer}/.well-known/jwks.json`) return responseJson({ keys: [keys.jwk] });
    if (String(url) === `${issuer}/user`) return responseJson({ id: subject, email: 'person@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'google' } });
    return responseJson({});
  } });
  const identity = await provider.verifyIdentity(env, token);
  assert.deepEqual(identity, { issuer, subject, email_verified: true, auth_provider: 'google' });
  assert.equal(calls.length, 2);
  assert.match(calls[1].init.headers.get('Authorization'), /^Bearer /);
  assert.equal(identity.subject, subject);
  assert.notEqual(identity.subject, identity.email);
});

test('forged, expired, wrong-issuer, and wrong-audience JWTs fail verification', async () => {
  const keys = await makeSigningKeys();
  const config = { issuer, jwksUrl: `${issuer}/.well-known/jwks.json` };
  const fetchImpl = async () => responseJson({ keys: [keys.jwk] });
  const base = { iss: issuer, sub: 'subject-1', aud: 'authenticated', exp: 2000000000 };
  for (const claims of [
    { ...base, exp: 1700000000 },
    { ...base, iss: `${issuer}-other` },
    { ...base, aud: 'anon' }
  ]) {
    await assert.rejects(verifySupabaseJwt(await signJwt(keys.pair, claims), config, { fetchImpl, now: () => 1800000000 }), error => error.status === 401);
  }
  const forged = await signJwt(keys.pair, base, { alg: 'RS256', kid: 'not-the-jwks-key', typ: 'JWT' });
  await assert.rejects(verifySupabaseJwt(forged, config, { fetchImpl, now: () => 1800000000 }), error => error.status === 401);
});

test('legacy HS256 sessions are checked online through Supabase /user without a signing secret in Worker', async () => {
  const subject = 'legacy-subject';
  const claims = { iss: issuer, sub: subject, aud: 'authenticated', exp: 2000000000 };
  const token = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.opaque-signature`;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === `${issuer}/user`) return responseJson({ id: subject, email: 'person@example.test', email_confirmed_at: '2026-01-01', app_metadata: { provider: 'email' } });
    return responseJson({ keys: [] });
  };
  const provider = createSupabaseAuthProvider({ fetchImpl, now: () => 1800000000 });
  const identity = await provider.verifyIdentity(env, token);
  assert.equal(identity.subject, subject);
  assert.equal(identity.auth_provider, 'email');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${issuer}/user`);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].init.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
});

test('issuer registry canonicalizes identity and rejects malformed issuer', () => {
  const fake = { id: 'fake-auth', verifyIdentity: async () => identityFor('test-subject') };
  const registry = createAuthProviderRegistry([fake]);
  assert.equal(registry.get('fake-auth'), fake);
  assert.deepEqual(registry.ids(), ['fake-auth']);
  assert.throws(() => createRexIdentity({ issuer: 'http://untrusted.test', subject: 's', email_verified: true, auth_provider: 'test' }));
  assert.throws(() => createAuthProviderRegistry([fake, fake]));
});

test('provider enforces fixed Supabase endpoints and keeps tokens out of error messages', async () => {
  const calls = [];
  const provider = createSupabaseAuthProvider({ fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return responseJson({ access_token: 'access-marker', refresh_token: 'refresh-marker', expires_in: 3600 }); } });
  const session = await provider.login(env, { email: 'person@example.test', password: 'secure-password' });
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/auth/v1/token']);
  assert.equal(new URL(calls[0].url).searchParams.get('grant_type'), 'password');
  assert.equal(calls[0].init.headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(session.access_token, 'access-marker');
  const oauth = new URL(provider.oauthUrl(env, { redirectTo: 'https://rex.test/api/auth/callback?state=random-state', codeChallenge: 'only-pkce-challenge' }));
  assert.equal(oauth.pathname, '/auth/v1/authorize');
  assert.equal(oauth.searchParams.get('provider'), 'google');
  assert.equal(oauth.searchParams.get('code_challenge'), 'only-pkce-challenge');
  assert.equal(oauth.searchParams.has('apikey'), false);
  assert.throws(() => provider.config({ ...env, SUPABASE_URL: 'https://attacker.test/path?redirect=1' }));
  const failed = createSupabaseAuthProvider({ fetchImpl: async () => responseJson({ message: 'refresh-marker' }, 401) });
  await assert.rejects(failed.refresh(env, session), error => error.status === 401 && !error.message.includes('refresh-marker'));
});

test('provider 429, 5xx and timeout are bounded, do not retry, and redact upstream details', async () => {
  const originalError = console.error, originalWarn = console.warn, output = [];
  console.error = (...args) => output.push(args.join(' ')); console.warn = (...args) => output.push(args.join(' '));
  try {
  for (const status of [429, 503]) {
    let calls = 0;
    const provider = createSupabaseAuthProvider({ fetchImpl: async () => { calls++; return responseJson({ message: 'private-upstream-body-marker' }, status); } });
    await assert.rejects(provider.login(env, { email: 'user@example.test', password: 'secure-password' }), error => error.status === 503 && !error.message.includes('private-upstream-body-marker'));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const timeoutProvider = createSupabaseAuthProvider({ timeoutMs: 2, fetchImpl: async (_url, init) => {
    calls++;
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private-timeout-marker')), { once: true }));
  } });
  await assert.rejects(timeoutProvider.login(env, { email: 'user@example.test', password: 'secure-password' }), error => error.code === 'AUTH_TIMEOUT' && !error.message.includes('private-timeout-marker'));
  assert.equal(calls, 1);
  } finally { console.error = originalError; console.warn = originalWarn; }
  assert.deepEqual(output, []);
});

test('JWKS verification request also has a bounded timeout', async () => {
  const keys = await makeSigningKeys();
  const token = await signJwt(keys.pair, { iss: issuer, sub: 'jwks-timeout', aud: 'authenticated', exp: 2000000000 });
  let calls = 0;
  const provider = createSupabaseAuthProvider({ timeoutMs: 2, now: () => 1800000000, fetchImpl: async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout-secret-marker')), { once: true }));
  } });
  await assert.rejects(provider.verifyIdentity(env, token), error => error.code === 'AUTH_TIMEOUT' && error.status === 503 && !error.message.includes('timeout-secret-marker'));
  assert.equal(calls, 1);
});

test('Google PKCE start stores verifier in encrypted HttpOnly cookie and emits only code challenge in URL', async () => {
  const db = new MemoryD1();
  const provider = {
    id: 'supabase',
    oauthUrl(_env, { redirectTo, codeChallenge }) {
      const target = new URL(`${issuer}/authorize`); target.searchParams.set('provider', 'google'); target.searchParams.set('redirect_to', redirectTo); target.searchParams.set('code_challenge', codeChallenge); target.searchParams.set('code_challenge_method', 's256'); return target.href;
    },
    verifyIdentity: async (_env, token) => identityFor(token),
    exchangeCode: async (_env, input) => { provider.exchanged = input; return { access_token: 'oauth-access-marker', refresh_token: 'oauth-refresh-marker', expires_at: 2000000000 }; }
  };
  const handler = createAccountsHandler({ provider });
  const start = await handler(request('/api/auth/google?return_to=%2Fulubione.html', { method: 'GET', origin: null }), { ...env, REXBID_DB: db });
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get('Location'));
  assert.equal(location.searchParams.get('provider'), 'google');
  assert.equal(location.searchParams.get('code_challenge_method'), 's256');
  assert.ok(location.searchParams.get('code_challenge'));
  assert.equal(location.searchParams.has('code_verifier'), false);
  assert.equal(location.searchParams.has('access_token'), false);
  const flowSetCookie = start.headers.get('Set-Cookie');
  assert.match(flowSetCookie, /HttpOnly/); assert.match(flowSetCookie, /Secure/); assert.match(flowSetCookie, /SameSite=Lax/); assert.match(flowSetCookie, /Path=\//);
  const flowCookie = flowSetCookie.split(';')[0];
  const flowEncoded = decodeURIComponent(flowCookie.slice(flowCookie.indexOf('=') + 1));
  const flow = await openCookiePayload(flowEncoded, env.REXBID_AUTH_COOKIE_SECRET);
  assert.ok(flow.verifier);
  assert.equal(location.searchParams.get('code_challenge'), await require('../auth/routes.js').pkceChallenge(flow.verifier, webcrypto));
  const callback = await handler(request(`/api/auth/callback?state=${encodeURIComponent(flow.state)}&code=one-time-code-marker`, { method: 'GET', origin: null, cookie: flowCookie }), { ...env, REXBID_DB: db });
  assert.equal(callback.status, 303);
  assert.equal(new URL(callback.headers.get('Location'), 'https://rex.test').pathname, '/ulubione.html');
  assert.deepEqual(provider.exchanged, { code: 'one-time-code-marker', codeVerifier: flow.verifier });
  const setCookies = callback.headers.getSetCookie();
  const sessionSet = setCookies.find(value => value.startsWith(`${sessionCookieName}=`));
  assert.ok(sessionSet);
  assert.match(sessionSet, /HttpOnly/); assert.match(sessionSet, /Secure/); assert.match(sessionSet, /SameSite=Lax/);
  assert.ok(!sessionSet.includes('oauth-access-marker'));
  assert.ok(!callback.headers.get('Location').includes('one-time-code-marker'));
});

test('HttpOnly session cookie, /api/me and favorites are account-isolated, idempotent and token-free', async () => {
  const db = new MemoryD1();
  let currentSubject = 'account-a';
  const logs = [];
  const provider = {
    login: async () => ({ access_token: `access-${currentSubject}-marker`, refresh_token: `refresh-${currentSubject}-marker`, expires_at: 2000000000 }),
    verifyIdentity: async (_env, token) => identityFor(token.replace(/^access-/, '').replace(/-marker$/, '')),
    refresh: async (_env, session) => session,
    logout: async () => {}
  };
  const handler = createAccountsHandler({ provider });
  const aLogin = await handler(request('/api/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'password-a' } }), { ...env, REXBID_DB: db });
  assert.equal(aLogin.status, 200);
  const aCookie = bearerCookieFrom(aLogin);
  assert.match(aLogin.headers.get('Set-Cookie'), /__Host-rexbid_session=/);
  for (const flag of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(aLogin.headers.get('Set-Cookie').includes(flag));
  assert.equal(aLogin.headers.get('Cache-Control'), 'private, no-store');
  assert.doesNotMatch(await aLogin.text(), /access-account|refresh-account/);
  const session = await openCookiePayload(decodeURIComponent(aCookie.slice(aCookie.indexOf('=') + 1)), env.REXBID_AUTH_COOKIE_SECRET);
  assert.equal(session.access_token, 'access-account-a-marker');
  const me = await handler(request('/api/me', { cookie: aCookie }), { ...env, REXBID_DB: db });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.auth_provider, 'google');
  const add = await handler(request('/api/me/favorites', { method: 'POST', body: { vin: '1HGCM82633A004352', lot: 'L-77', platform: 'iaai' }, cookie: aCookie }), { ...env, REXBID_DB: db });
  assert.equal(add.status, 201);
  const firstMerge = await handler(request('/api/me/favorites/merge', { method: 'POST', body: { favorites: [{ vin: '1HGCM82633A004352', lot: 'L-77', platform: 'iaai', title: '<img src=x>', raw_json: { credentials: 'no' } }, { lot: '991', platform: 'copart' }] }, cookie: aCookie }), { ...env, REXBID_DB: db });
  assert.equal(firstMerge.status, 200);
  const secondMerge = await handler(request('/api/me/favorites/merge', { method: 'POST', body: { favorites: [{ vin: '1HGCM82633A004352', lot: 'L-77', platform: 'iaai' }, { lot: '991', platform: 'copart' }] }, cookie: aCookie }), { ...env, REXBID_DB: db });
  assert.equal(secondMerge.status, 200);
  assert.equal(db.favorites.size, 2);
  assert.ok(db.favorites.has(`${session.access_token ? [...db.users.values()][0].id : ''}|vin:1HGCM82633A004352`));
  const listA = await handler(request('/api/me/favorites', { cookie: aCookie }), { ...env, REXBID_DB: db });
  const listJson = await listA.json();
  assert.equal(listJson.favorites.length, 2);
  assert.equal(listJson.favorites.find(item => item.key.startsWith('lot:')).key, 'lot:copart:991');
  assert.doesNotMatch(JSON.stringify(listJson), /access-account|refresh-account|raw_json|<img/);

  const spoof = await handler(request('/api/me/favorites', { method: 'POST', body: { user_id: 'victim', vin: '5YJ3E1EA7KF317000' }, cookie: aCookie }), { ...env, REXBID_DB: db });
  assert.equal(spoof.status, 400);
  const csrf = await handler(request('/api/me/favorites', { method: 'POST', body: { vin: '5YJ3E1EA7KF317000' }, cookie: aCookie, origin: 'https://evil.test' }), { ...env, REXBID_DB: db });
  assert.equal(csrf.status, 403);

  currentSubject = 'account-b';
  const bLogin = await handler(request('/api/auth/login', { method: 'POST', body: { email: 'b@example.test', password: 'password-b' } }), { ...env, REXBID_DB: db });
  const bCookie = bearerCookieFrom(bLogin);
  const listB = await handler(request('/api/me/favorites', { cookie: bCookie }), { ...env, REXBID_DB: db });
  assert.deepEqual((await listB.json()).favorites, []);
  const aUserId = [...db.users.values()].find(user => user.auth_subject === 'account-a').id;
  const deleteResponse = await handler(request(`/api/me/favorites/${encodeURIComponent('vin:1HGCM82633A004352')}`, { method: 'DELETE', cookie: aCookie }), { ...env, REXBID_DB: db });
  assert.equal(deleteResponse.status, 200);
  assert.equal(db.favorites.has(`${aUserId}|vin:1HGCM82633A004352`), false);
  assert.deepEqual(logs, []);
});

test('unverified email identity cannot provision an account or receive a session', async () => {
  const db = new MemoryD1();
  const handler = createAccountsHandler({ provider: {
    login: async () => ({ access_token: 'access-unverified', refresh_token: 'refresh-unverified', expires_at: 2000000000 }),
    verifyIdentity: async () => identityFor('unverified-user', false, 'email')
  } });
  const response = await handler(request('/api/auth/login', { method: 'POST', body: { email: 'unverified@example.test', password: 'secure-password' } }), { ...env, REXBID_DB: db });
  assert.equal(response.status, 403);
  assert.equal(db.users.size, 0);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.doesNotMatch(await response.text(), /access-unverified|refresh-unverified/);
});

test('refresh failure clears the cookie; logout revokes locally and clears both cookies', async () => {
  const db = new MemoryD1();
  let revoked = false;
  const provider = {
    login: async () => ({ access_token: 'access-refresh-case', refresh_token: 'refresh-refresh-case', expires_at: 2000000000 }),
    verifyIdentity: async () => identityFor('refresh-case'),
    refresh: async () => { throw Object.assign(new Error('private upstream error'), { status: 401 }); },
    logout: async () => { revoked = true; }
  };
  const handler = createAccountsHandler({ provider, now: () => 1800000000 });
  const login = await handler(request('/api/auth/login', { method: 'POST', body: { email: 'x@example.test', password: 'secure-password' } }), { ...env, REXBID_DB: db });
  const cookie = bearerCookieFrom(login);
  const decoded = await openCookiePayload(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)), env.REXBID_AUTH_COOKIE_SECRET);
  const expiredValue = await require('../auth/session.js').sealCookiePayload({ ...decoded, expires_at: 1800000000 }, env.REXBID_AUTH_COOKIE_SECRET);
  const refresh = await handler(request('/api/auth/refresh', { method: 'POST', cookie: `${sessionCookieName}=${encodeURIComponent(expiredValue)}` }), { ...env, REXBID_DB: db });
  assert.equal(refresh.status, 401);
  assert.match(refresh.headers.get('Set-Cookie'), /Max-Age=0/);
  const logout = await handler(request('/api/auth/logout', { method: 'POST', cookie }), { ...env, REXBID_DB: db });
  assert.equal(logout.status, 200);
  assert.equal(revoked, true);
  assert.equal(logout.headers.getSetCookie().filter(value => value.includes('Max-Age=0')).length, 2);
});

test('temporary Supabase outage does not erase the browser session cookie', async () => {
  const db = new MemoryD1();
  const now = 1800000000;
  const provider = {
    login: async () => ({ access_token: 'access-during-outage', refresh_token: 'refresh-during-outage', expires_at: now + 10 }),
    verifyIdentity: async () => identityFor('outage-user'),
    refresh: async () => { throw Object.assign(new Error('private outage details'), { status: 503 }); }
  };
  const handler = createAccountsHandler({ provider, now: () => now });
  const login = await handler(request('/api/auth/login', { method: 'POST', body: { email: 'outage@example.test', password: 'secure-password' } }), { ...env, REXBID_DB: db });
  const cookie = bearerCookieFrom(login);
  const unavailable = await handler(request('/api/me', { cookie }), { ...env, REXBID_DB: db });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('Set-Cookie'), null);
  assert.doesNotMatch(await unavailable.text(), /private outage details|refresh-during-outage|access-during-outage/);
});

test('successful refresh rotates the encrypted cookie and returns no token material in JSON', async () => {
  const db = new MemoryD1();
  const baseNow = 1800000000;
  const provider = {
    login: async () => ({ access_token: 'old-access-marker', refresh_token: 'old-refresh-marker', expires_at: baseNow + 10 }),
    verifyIdentity: async (_env, token) => identityFor(token.includes('new-') ? 'rotated-user' : 'rotated-user'),
    refresh: async () => ({ access_token: 'new-access-marker', refresh_token: 'new-refresh-marker', expires_at: baseNow + 3600 })
  };
  const handler = createAccountsHandler({ provider, now: () => baseNow });
  const login = await handler(request('/api/auth/login', { method: 'POST', body: { email: 'rotate@example.test', password: 'secure-password' } }), { ...env, REXBID_DB: db });
  const oldCookie = bearerCookieFrom(login);
  const refreshed = await handler(request('/api/auth/refresh', { method: 'POST', cookie: oldCookie }), { ...env, REXBID_DB: db });
  assert.equal(refreshed.status, 200);
  const rotatedCookie = bearerCookieFrom(refreshed);
  const encoded = decodeURIComponent(rotatedCookie.slice(rotatedCookie.indexOf('=') + 1));
  const session = await openCookiePayload(encoded, env.REXBID_AUTH_COOKIE_SECRET);
  assert.equal(session.access_token, 'new-access-marker');
  assert.equal(session.refresh_token, 'new-refresh-marker');
  assert.doesNotMatch(await refreshed.text(), /new-access-marker|new-refresh-marker/);
});

test('Worker routes account endpoints through the BFF handler and fails closed without Supabase configuration', async () => {
  const source = fs.readFileSync(path.join(root, 'worker.js'), 'utf8')
    .replace('import apibaraModule from "./providers/apibara.js";', 'const apibaraModule = globalThis.__apibaraModule;')
    .replace('import contract from "./providers/contract.js";', 'const contract = globalThis.__providerContract;')
    .replace('import authProviderModule from "./auth/supabase.js";', 'const authProviderModule = globalThis.__authProviderModule;')
    .replace('import accountsModule from "./auth/routes.js";', 'const accountsModule = globalThis.__accountsModule;')
    .replace('export default {', 'globalThis.__worker = {');
  const context = {
    URL, URLSearchParams, Request, Response, Headers, AbortController, crypto: webcrypto,
    __apibaraModule: require('../providers/apibara.js'), __providerContract: require('../providers/contract.js'),
    __authProviderModule: require('../auth/supabase.js'), __accountsModule: require('../auth/routes.js'),
    fetch: async () => { throw new Error('Unexpected upstream request'); }, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    caches: { default: { match: async () => null, put: async () => {} } }
  };
  const vm = require('node:vm'); vm.createContext(context); vm.runInContext(source, context);
  const response = await context.__worker.fetch(new Request('https://rex.test/api/me'), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await response.json()).ok, false);
});

test('missing D1/auth config fails closed and refresh/HTTP errors never leak upstream body', async () => {
  const handler = createAccountsHandler({ provider: { verifyIdentity: async () => identityFor('x') } });
  const noConfig = await handler(request('/api/me'), {});
  assert.equal(noConfig.status, 503);
  assert.doesNotMatch(await noConfig.text(), /token|secret/i);
  const configuredWithoutDb = await handler(request('/api/auth/login', { method: 'POST', body: { email: 'x@example.test', password: 'secure-password' } }), env);
  assert.equal(configuredWithoutDb.status, 503);
  for (const file of ['routes.js', 'supabase.js', 'session.js']) {
    const source = fs.readFileSync(path.join(root, 'auth', file), 'utf8');
    assert.doesNotMatch(source, /localStorage/);
  }
});

test('additive accounts proposal applies after existing migrations and leaves legacy data intact', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of ['0000_rexbid_base.sql', '0001_auction_history_events.sql']) db.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'));
  db.prepare(`INSERT INTO vehicles (vehicle_key, vin, lot, platform, first_seen_at, last_seen_at, fingerprint, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('vin:LEGACY1', 'LEGACY1', '101', 'copart', '2026-01-01', '2026-01-02', 'fp', '{"legacy":true}');
  db.prepare(`INSERT INTO vehicle_snapshots (vehicle_key, captured_at, fingerprint, raw_json) VALUES (?, ?, ?, ?)`)
    .run('vin:LEGACY1', '2026-01-02', 'fp', '{"snapshot":true}');
  db.prepare(`INSERT INTO auction_history (vehicle_key, event_hash, captured_at, raw_json) VALUES (?, ?, ?, ?)`)
    .run('vin:LEGACY1', 'evt-old', '2026-01-02', '{"event":true}');
  db.exec(fs.readFileSync(path.join(root, 'docs/proposals/0003_accounts_foundation.sql'), 'utf8'));
  assert.equal(db.prepare('SELECT count(*) AS count FROM vehicles').get().count, 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM vehicle_snapshots').get().count, 1);
  assert.equal(db.prepare('SELECT raw_json FROM auction_history').get().raw_json, '{"event":true}');
  const user = db.prepare('INSERT INTO users (id, auth_issuer, auth_subject, auth_provider, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run('user-a', issuer, 'subject-a', 'google', '2026-09-27', '2026-09-27');
  assert.equal(Number(user.changes), 1);
  db.prepare('INSERT INTO user_favorites (user_id, favorite_key, vin, lot, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('user-a', 'vin:VIN123', 'VIN123', 'LOT9', 'iaai', '2026-09-27', '2026-09-27');
  db.prepare('INSERT INTO user_favorites (user_id, favorite_key, lot, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('user-a', 'lot:copart:LOT10', 'LOT10', 'copart', '2026-09-27', '2026-09-27');
  assert.equal(db.prepare('SELECT count(*) AS count FROM user_favorites').get().count, 2);
  assert.throws(() => db.prepare('INSERT INTO user_favorites (user_id, favorite_key, lot, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('user-a', 'lot:iaai:LOT11', 'LOT11', 'copart', '2026-09-27', '2026-09-27'));
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map(row => row.name);
  const favoriteColumns = db.prepare('PRAGMA table_info(user_favorites)').all().map(row => row.name);
  assert.deepEqual(userColumns, ['id', 'auth_issuer', 'auth_subject', 'auth_provider', 'email_verified', 'created_at', 'updated_at']);
  assert.deepEqual(favoriteColumns, ['user_id', 'favorite_key', 'vin', 'lot', 'platform', 'created_at', 'updated_at']);
  assert.equal(userColumns.some(name => /password|token|email$/i.test(name)), false);
  db.close();
});
