const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');
const { createSupabaseAuthProvider, verifySupabaseJwt } = require('../auth/supabase.js');
const { createAccountsHandler } = require('../auth/routes.js');
const { openCookiePayload, readCookie, sessionCookieName, flowCookie } = require('../auth/session.js');
const { createRexIdentity, createAuthProviderRegistry } = require('../auth/identity.js');

const root = path.resolve(__dirname, '..');
const env = {
  AUTH_ENABLED: 'true',
  AUTH_D1_SCHEMA_VERSION: '0003',
  AUTH_CANONICAL_ORIGIN: 'https://rex.test',
  AUTH_ALLOWED_ORIGINS: 'https://rex.test',
  AUTH_RATE_LIMITING_MODE: 'cloudflare',
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  REXBID_DB: {},
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
  assert.equal(new Headers(calls[0].init.headers).has('Authorization'), false, 'JWKS lookup does not use the publishable key as Bearer');
  assert.equal(new Headers(calls[1].init.headers).get('Authorization'), `Bearer ${token}`, 'session validation uses the real user access token');
  assert.equal(new Headers(calls[1].init.headers).get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
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
  assert.equal(calls[0].init.redirect, 'manual');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'auth/supabase.js'), 'utf8'), /redirect:\s*["']error["']/);
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

test('Supabase Auth treats 302, 307 and 308 as unexpected redirects and never follows or forwards credentials', async () => {
  for (const status of [302, 307, 308]) {
    const calls = [];
    const originalWarn = console.warn;
    const logs = [];
    console.warn = (...args) => logs.push(args.join(' '));
    const stagingEnv = { ...env, REXBID_AUTH_DIAGNOSTICS: 'enabled', REXBID_AUTH_TEST_UI: 'enabled', REXBID_AUTH_TEST_HOST: 'rexbid-auth-test.tedn828.workers.dev' };
    const provider = createSupabaseAuthProvider({ fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status, headers: { Location: 'https://redirect-target.test/path?token=private-location-marker' } });
    } });
    try {
      await assert.rejects(provider.login(stagingEnv, { email: 'user@example.test', password: 'private-password-marker' }), error => error.code === 'AUTH_UNEXPECTED_REDIRECT' && error.status === 502);
    } finally { console.warn = originalWarn; }
    assert.equal(calls.length, 1, `HTTP ${status} must not cause a second request`);
    assert.equal(calls[0].init.redirect, 'manual');
    assert.equal(new Headers(calls[0].init.headers).get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(new Headers(calls[0].init.headers).has('Authorization'), false);
    assert.equal(calls[0].url, `${issuer}/token?grant_type=password`);
    assert.doesNotMatch(logs.join('\n'), /redirect-target|private-location|user@example|private-password|sb_publishable_test_public_id|Authorization|Bearer/);
    assert.match(logs[0], new RegExp(`"upstream_status":${status}`));
    assert.match(logs[0], /"safe_error_code":"unexpected_redirect"/);
  }
});

test('JWKS validation also uses manual redirects and rejects 3xx without following', async () => {
  const keys = await makeSigningKeys();
  const token = await signJwt(keys.pair, { iss: issuer, sub: 'redirect-jwks', aud: 'authenticated', exp: 2000000000 });
  const calls = [];
  const provider = createSupabaseAuthProvider({ now: () => 1800000000, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 307, headers: { Location: 'https://redirect-target.test/jwks' } });
  } });
  await assert.rejects(provider.verifyIdentity(env, token), error => error.code === 'AUTH_UNEXPECTED_REDIRECT' && error.status === 502);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.match(calls[0].url, /\.well-known\/jwks\.json$/);
});

test('Supabase publishable key is apikey-only; user access tokens are the only Bearer credentials', async () => {
  const calls = [];
  const sensitiveMarkers = ['access-login-marker', 'refresh-login-marker', 'access-exchange-marker', 'refresh-exchange-marker', 'access-refresh-marker', 'refresh-refresh-marker'];
  const originalLog = console.log, originalError = console.error, originalWarn = console.warn;
  const consoleOutput = [];
  console.log = (...args) => consoleOutput.push(args.join(' '));
  console.error = (...args) => consoleOutput.push(args.join(' '));
  console.warn = (...args) => consoleOutput.push(args.join(' '));
  const provider = createSupabaseAuthProvider({ fetchImpl: async (url, init = {}) => {
    const headers = new Headers(init.headers || {});
    calls.push({ url: String(url), method: init.method || 'GET', headers, body: init.body || '', redirect: init.redirect });
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/signup')) return responseJson({ user: { id: 'signup-user' }, session: null });
    if (path.endsWith('/token')) {
      const grant = new URL(String(url)).searchParams.get('grant_type');
      const marker = grant === 'password' ? 'login' : grant === 'pkce' ? 'exchange' : 'refresh';
      return responseJson({ access_token: `access-${marker}-marker`, refresh_token: `refresh-${marker}-marker`, expires_in: 3600 });
    }
    return responseJson({});
  } });

  try {
    await provider.signup(env, { email: 'signup@example.test', password: 'secure-password', redirectTo: 'https://rex.test/callback', codeChallenge: 'test-challenge' });
    await provider.login(env, { email: 'login@example.test', password: 'secure-password' });
    await provider.exchangeCode(env, { code: 'one-time-code', codeVerifier: 'pkce-verifier' });
    await provider.refresh(env, { access_token: 'access-refresh-marker', refresh_token: 'refresh-refresh-marker', expires_at: 2000000000 });
    await provider.logout(env, 'real-user-access-token');
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  const authCalls = calls.filter(call => new URL(call.url).pathname.startsWith('/auth/v1/'));
  assert.equal(authCalls.length, 5);
  for (const call of authCalls) {
    assert.equal(call.headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
    assert.notEqual(call.headers.get('Authorization'), `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`);
    assert.equal(call.redirect, 'manual');
  }
  for (const call of authCalls.filter(call => ['/signup', '/token'].includes(new URL(call.url).pathname))) {
    assert.equal(call.headers.has('Authorization'), false, `${new URL(call.url).pathname} must not send the publishable key as Bearer`);
  }
  assert.equal(authCalls.find(call => new URL(call.url).searchParams.get('grant_type') === 'refresh_token').headers.has('Authorization'), false);
  const logoutCall = authCalls.find(call => new URL(call.url).pathname.endsWith('/logout'));
  assert.equal(logoutCall.headers.get('Authorization'), 'Bearer real-user-access-token');
  assert.ok(calls.find(call => new URL(call.url).searchParams.get('grant_type') === 'refresh_token').body.includes('refresh-refresh-marker'));

  assert.equal(consoleOutput.some(line => sensitiveMarkers.some(marker => line.includes(marker))), false);
  assert.deepEqual(consoleOutput, []);
  assert.doesNotMatch(JSON.stringify(authCalls.map(({ url, method, headers }) => ({ url, method, apikey: headers.get('apikey'), authorization: headers.get('Authorization') }))), /refresh-refresh-marker|secure-password|one-time-code|pkce-verifier/);
});

test('Supabase recovery, resend and password update use fixed endpoints and only real user tokens as Bearer', async () => {
  const calls=[];
  const provider=createSupabaseAuthProvider({fetchImpl:async(url,init={})=>{calls.push({url:new URL(String(url)),init});return responseJson({});}});
  const callback='https://rex.test/api/auth/callback?state=opaque-state';
  await provider.requestPasswordReset(env,{email:'person@example.test',redirectTo:callback,codeChallenge:'opaque-challenge'});
  await provider.resendConfirmation(env,{email:'person@example.test',redirectTo:callback,codeChallenge:'resend-challenge'});
  await provider.updatePassword(env,'real-user-access-token','new-secure-password');
  await provider.logout(env,'real-user-access-token','global');
  assert.deepEqual(calls.map(({url,init})=>[url.pathname,url.searchParams.get('redirect_to'),url.searchParams.get('scope'),init.method]),[
    ['/auth/v1/recover',callback,null,'POST'],['/auth/v1/resend',callback,null,'POST'],['/auth/v1/user',null,null,'PUT'],['/auth/v1/logout',null,'global','POST']
  ]);
  const [recover,resend,password,logout]=calls.map(call=>({headers:new Headers(call.init.headers),body:call.init.body?JSON.parse(call.init.body):{}}));
  for(const call of [recover,resend]){assert.equal(call.headers.get('apikey'),env.SUPABASE_PUBLISHABLE_KEY);assert.equal(call.headers.has('Authorization'),false);}
  assert.equal(recover.body.code_challenge,'opaque-challenge');
  assert.equal(resend.body.type,'signup');
  assert.equal(password.headers.get('Authorization'),'Bearer real-user-access-token');
  assert.equal(logout.headers.get('Authorization'),'Bearer real-user-access-token');
  assert.equal(JSON.stringify(calls).includes(env.REXBID_AUTH_COOKIE_SECRET),false);
});

test('staging Supabase diagnostics report only safe request metadata and are disabled outside the staging wrapper', async () => {
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...args) => logs.push(args.join(' '));
  const provider = createSupabaseAuthProvider({ fetchImpl: async (url, init) => {
    assert.equal(new URL(String(url)).pathname, '/auth/v1/signup');
    assert.equal(init.method, 'POST');
    const target = new URL(String(url));
    if (target.searchParams.has('redirect_to')) assert.equal(target.searchParams.get('redirect_to'), 'https://rexbid-auth-test.tedn828.workers.dev/api/auth/callback?state=state-secret-marker');
    const signupBody = JSON.parse(init.body);
    assert.deepEqual(Object.keys(signupBody).sort(), ['code_challenge', 'code_challenge_method', 'email', 'password']);
    assert.equal(signupBody.code_challenge_method, 's256');
    return responseJson({ code: 'signup_disabled', message: 'private-email@example.test password-secret-marker token-secret-marker' }, 422);
  } });
  const stagingEnv = { ...env, REXBID_AUTH_DIAGNOSTICS: 'enabled', REXBID_AUTH_TEST_UI: 'enabled', REXBID_AUTH_TEST_HOST: 'rexbid-auth-test.tedn828.workers.dev' };
  try {
    await assert.rejects(provider.signup(stagingEnv, { email: 'private-email@example.test', password: 'password-secret-marker', redirectTo: 'https://rexbid-auth-test.tedn828.workers.dev/api/auth/callback?state=state-secret-marker', codeChallenge: 'challenge-secret-marker' }), error => error.status === 401);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /"operation":"signup"/);
    assert.match(logs[0], /"method":"POST"/);
    assert.match(logs[0], /"stage":"response"/);
    assert.match(logs[0], /"upstream_path":"\/auth\/v1\/signup"/);
    assert.match(logs[0], /"upstream_status":422/);
    assert.match(logs[0], /"upstream_content_type":"application\/json"/);
    assert.match(logs[0], /"safe_error_code":"signup_disabled"/);
    assert.match(logs[0], /"publishable_key_kind":"sb_publishable"/);
    assert.match(logs[0], /"auth_header_mode":"apikey_only"/);
    assert.match(logs[0], /"supabase_url_format":"valid_https_project_root"/);
    assert.match(logs[0], /"redirect_target_path":"\/api\/auth\/callback"/);
    assert.match(logs[0], /"signup_user_returned":false/);
    assert.doesNotMatch(logs.join('\n'), /private-email|password-secret|token-secret|state-secret|challenge-secret|sb_publishable_test_public_id|Authorization|Bearer/);

    logs.length = 0;
    await assert.rejects(provider.signup(env, { email: 'private-email@example.test', password: 'password-secret-marker', codeChallenge: 'challenge-secret-marker', redirectTo: 'https://rexbid-auth-test.tedn828.workers.dev/api/auth/callback?state=state-secret-marker' }), error => error.status === 401);
    assert.deepEqual(logs, []);
  } finally { console.warn = originalWarn; }
});

test('staging auth diagnostics distinguish configuration and fetch failures without values', async () => {
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...args) => logs.push(args.join(' '));
  const provider = createSupabaseAuthProvider({ fetchImpl: async () => { throw new Error('private-fetch-message@example.test'); } });
  const stagingEnv = { ...env, REXBID_AUTH_DIAGNOSTICS: 'enabled', REXBID_AUTH_TEST_UI: 'enabled', REXBID_AUTH_TEST_HOST: 'rexbid-auth-test.tedn828.workers.dev' };
  try {
    await assert.rejects(provider.signup(stagingEnv, { email: 'user@example.test', password: 'super-secret' }), error => error.status === 503);
    assert.match(logs[0], /"stage":"fetch"/);
    assert.match(logs[0], /"safe_error_code":"transport_error"/);
    assert.match(logs[0], /"upstream_status":null/);
    assert.doesNotMatch(logs[0], /user@example|super-secret|private-fetch-message/);

    logs.length = 0;
    await assert.rejects(provider.signup({ ...stagingEnv, SUPABASE_URL: 'https://project.supabase.co/rest/v1' }, { email: 'user@example.test', password: 'super-secret' }));
    assert.match(logs[0], /"stage":"configuration"/);
    assert.match(logs[0], /"safe_error_code":"invalid_supabase_configuration"/);
    assert.match(logs[0], /"supabase_url_format":"invalid"/);
    assert.doesNotMatch(logs[0], /user@example|super-secret|rest\/v1/);
  } finally { console.warn = originalWarn; }
});

test('staging transport diagnostics classify fetch causes without logging messages or credentials', async () => {
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...args) => logs.push(args.join(' '));
  const provider = createSupabaseAuthProvider({ fetchImpl: async () => {
    const cause = Object.assign(new Error('lookup private-project.supabase.co failed for user@example.test'), { code: 'EAI_AGAIN' });
    throw Object.assign(new TypeError('fetch failed with private-password-marker and sb_secret_marker'), { cause });
  } });
  const stagingEnv = { ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_private-key-marker', REXBID_AUTH_DIAGNOSTICS: 'enabled', REXBID_AUTH_TEST_UI: 'enabled', REXBID_AUTH_TEST_HOST: 'rexbid-auth-test.tedn828.workers.dev' };
  try {
    await assert.rejects(provider.signup(stagingEnv, { email: 'user@example.test', password: 'private-password-marker' }), error => error.status === 503 && !error.message.includes('private-project') && !error.message.includes('private-password-marker'));
    assert.equal(logs.length, 1);
    const line = logs[0];
    assert.match(line, /"operation":"signup"/);
    assert.match(line, /"stage":"fetch"/);
    assert.match(line, /"error_name":"TypeError"/);
    assert.match(line, /"transport_category":"dns"/);
    assert.match(line, /"cause_type":"object"/);
    assert.match(line, /"cause_code":"EAI_AGAIN"/);
    assert.match(line, /"hostname":"rex-test\.supabase\.co"/);
    assert.match(line, /"upstream_status":null/);
    assert.doesNotMatch(line, /user@example|private-password|private-key-marker|sb_secret_marker|lookup |fetch failed|Authorization|Bearer|cookie/i);

    logs.length = 0;
    const timeoutProvider = createSupabaseAuthProvider({ timeoutMs: 2, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('private timeout message marker', 'AbortError')), { once: true });
    }) });
    await assert.rejects(timeoutProvider.signup(stagingEnv, { email: 'user@example.test', password: 'private-password-marker' }), error => error.code === 'AUTH_TIMEOUT');
    assert.equal(logs.length, 1);
    assert.match(logs[0], /"operation":"signup"/);
    assert.match(logs[0], /"stage":"fetch"/);
    assert.match(logs[0], /"error_name":"AbortError"/);
    assert.match(logs[0], /"transport_category":"timeout"/);
    assert.match(logs[0], /"cause_type":"undefined"/);
    assert.doesNotMatch(logs[0], /user@example|private-password|private timeout message|private-key-marker|Authorization|Bearer|cookie/i);
  } finally { console.warn = originalWarn; }
});

test('staging connectivity probe performs only a bounded, sanitized GET to Supabase Auth health', async () => {
  const calls = [];
  const provider = createSupabaseAuthProvider({ fetchImpl: async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body, headers: init.headers });
    return responseJson({ version: 'private-upstream-version-marker', service: 'auth' }, 200);
  } });
  const result = await provider.healthCheck(env);
  assert.deepEqual(result, { ok: true, stage: 'response', upstream_status: 200, safe_error_code: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://rex-test.supabase.co/auth/v1/health');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(calls[0].headers.has('Authorization'), false);
  assert.doesNotMatch(JSON.stringify(result), /private-upstream-version-marker|sb_publishable_test_public_id/);

  const unavailableProvider = createSupabaseAuthProvider({ fetchImpl: async () => responseJson({ error: 'private-upstream-error-marker' }, 503) });
  assert.deepEqual(await unavailableProvider.healthCheck(env), { ok: false, stage: 'response', upstream_status: 503, safe_error_code: 'upstream_http_error' });
  const redirectProvider = createSupabaseAuthProvider({ fetchImpl: async (_url, init) => {
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://redirect-target.test/path?token=private-marker' } });
  } });
  assert.deepEqual(await redirectProvider.healthCheck(env), { ok: false, stage: 'response', upstream_status: 302, safe_error_code: 'unexpected_redirect' });
});

test('Supabase Worker timeout uses Web-standard AbortController rather than Node-only AbortSignal.timeout', () => {
  const source = fs.readFileSync(path.join(root, 'auth/supabase.js'), 'utf8');
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/);
  assert.doesNotMatch(source, /AbortSignal\.timeout|node:timers|require\(['"]node:/);
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

test('staging callback diagnostics expose PKCE/session stages without state, code, verifier, cookie or tokens', async () => {
  const db = new MemoryD1();
  const diagnostics = [];
  const originalInfo = console.info;
  console.info = (...args) => diagnostics.push(args);
  try {
    const provider = {
      exchangeCode: async (_env, input) => {
        assert.equal(input.code, 'callback-code-secret-marker');
        assert.equal(input.codeVerifier, 'pkce-verifier-secret-marker');
        return { access_token: 'callback-access-secret-marker', refresh_token: 'callback-refresh-secret-marker', expires_at: 2000000000 };
      },
      verifyIdentity: async () => identityFor('callback-user'),
      refresh: async () => { throw new Error('must not refresh'); }
    };
    const stagingEnv = { ...env, AUTH_CANONICAL_ORIGIN:'https://rexbid-auth-test.tedn828.workers.dev', AUTH_ALLOWED_ORIGINS:'https://rexbid-auth-test.tedn828.workers.dev', REXBID_DB: db, REXBID_AUTH_DIAGNOSTICS: 'enabled', REXBID_AUTH_TEST_UI: 'enabled', REXBID_AUTH_TEST_HOST: 'rexbid-auth-test.tedn828.workers.dev' };
    const flow = { state: 'callback-state-secret-marker', verifier: 'pkce-verifier-secret-marker', purpose: 'recovery', return_path: '/reset-hasla.html', expires_at: 2000000000 };
    const encrypted = await require('../auth/session.js').sealCookiePayload(flow, env.REXBID_AUTH_COOKIE_SECRET);
    const flowCookieHeader = flowCookie(encrypted).split(';')[0];
    const handler = createAccountsHandler({ provider, now: () => 1800000000 });
    const callback = await handler(request('/api/auth/callback?state=callback-state-secret-marker&code=callback-code-secret-marker', {
      method: 'GET', origin: null, cookie: flowCookieHeader,
      host: 'https://rexbid-auth-test.tedn828.workers.dev'
    }), stagingEnv);
    assert.equal(callback.status, 303);
    assert.ok(callback.headers.getSetCookie().some(value => value.startsWith(`${sessionCookieName}=`)));
    const entries = diagnostics.map(args => JSON.parse(args[1]));
    const callbackEntries = entries.filter(item => item.operation === 'callback');
    const callbackId = callbackEntries[0]?.callback_id;
    assert.match(callbackId || '', /^[A-Za-z0-9_-]{16}$/);
    assert.ok(callbackEntries.every(item => item.callback_id === callbackId && item.flow_kind === 'recovery'));
    assert.ok(callbackEntries.some(item => item.stage === 'validation' && item.state_matches === true && item.verifier_present === true));
    assert.ok(callbackEntries.some(item => item.stage === 'code_exchange' && item.outcome === 'success'));
    assert.ok(callbackEntries.some(item => item.stage === 'session_cookie' && item.session_cookie_created === true));
    const serialized = JSON.stringify(diagnostics);
    for (const marker of ['callback-state-secret-marker', 'callback-code-secret-marker', 'pkce-verifier-secret-marker', 'callback-access-secret-marker', 'callback-refresh-secret-marker', 'callback-user']) assert.ok(!serialized.includes(marker));
  } finally { console.info = originalInfo; }
});

test('staging callback logs safe PKCE failure stage and refresh logs anonymous cookie state', async () => {
  const diagnostics = [];
  const originalInfo = console.info;
  console.info = (...args) => diagnostics.push(args);
  try {
    const stagingEnv = { ...env, AUTH_CANONICAL_ORIGIN:'https://rexbid-auth-test.tedn828.workers.dev', AUTH_ALLOWED_ORIGINS:'https://rexbid-auth-test.tedn828.workers.dev', REXBID_DB: new MemoryD1(), REXBID_AUTH_DIAGNOSTICS: 'enabled', REXBID_AUTH_TEST_UI: 'enabled', REXBID_AUTH_TEST_HOST: 'rexbid-auth-test.tedn828.workers.dev' };
    const flow = { state: 'state-private', verifier: 'verifier-private', purpose: 'recovery', return_path: '/reset-hasla.html', expires_at: 2000000000 };
    const encrypted = await require('../auth/session.js').sealCookiePayload(flow, env.REXBID_AUTH_COOKIE_SECRET);
    const handler = createAccountsHandler({ provider: {
      exchangeCode: async () => { throw Object.assign(new Error('upstream body private'), { code: 'AUTH_REJECTED', status: 401 }); },
      verifyIdentity: async () => { throw new Error('must not verify'); }
    }, now: () => 1800000000 });
    const callback = await handler(request('/api/auth/callback?state=state-private&code=code-private', { method: 'GET', origin: null, cookie: flowCookie(encrypted).split(';')[0], host: 'https://rexbid-auth-test.tedn828.workers.dev' }), stagingEnv);
    assert.equal(callback.status, 303);
    const refresh = await handler(request('/api/auth/refresh', { method: 'POST', host: 'https://rexbid-auth-test.tedn828.workers.dev', origin: 'https://rexbid-auth-test.tedn828.workers.dev' }), stagingEnv);
    assert.equal(refresh.status, 401);
    const entries = diagnostics.map(args => JSON.parse(args[1]));
    const callbackEntries = entries.filter(item => item.operation === 'callback');
    assert.ok(callbackEntries.length > 0 && callbackEntries.every(item => item.flow_kind === 'recovery' && /^[A-Za-z0-9_-]{16}$/.test(item.callback_id)));
    assert.ok(callbackEntries.some(item => item.stage === 'code_exchange' && item.outcome === 'failure' && item.safe_error_code === 'AUTH_REJECTED' && item.upstream_status === 401));
    assert.ok(entries.some(item => item.operation === 'session_resolve' && item.stage === 'cookie' && item.outcome === 'missing'));
    assert.ok(entries.some(item => item.operation === 'refresh_endpoint' && item.stage === 'complete' && item.outcome === 'anonymous'));
    const serialized = JSON.stringify(diagnostics);
    for (const marker of ['state-private', 'verifier-private', 'code-private', 'upstream body private']) assert.ok(!serialized.includes(marker));
  } finally { console.info = originalInfo; }
});

test('one-time staging callback receipt captures a complete sanitized recovery result and expires after read', async () => {
  const db = new MemoryD1();
  const stagingEnv = { ...env, AUTH_CANONICAL_ORIGIN:'https://rexbid-auth-test.tedn828.workers.dev', AUTH_ALLOWED_ORIGINS:'https://rexbid-auth-test.tedn828.workers.dev', REXBID_DB:db, REXBID_AUTH_DIAGNOSTICS:'enabled', REXBID_AUTH_TEST_UI:'enabled', REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev' };
  const handler = createAccountsHandler({ provider:{
    exchangeCodeWithStatus:async (_env,input)=>{assert.equal(input.code,'never-log-this-code');assert.equal(input.codeVerifier,'never-log-this-verifier');return {session:{access_token:'never-log-access',refresh_token:'never-log-refresh',expires_at:2000000000},upstream_status:200};},
    verifyIdentity:async()=>identityFor('recovery-result-user')
  },now:()=>1800000000 });
  const flow={state:'never-log-state',verifier:'never-log-this-verifier',purpose:'recovery',return_path:'/reset-hasla.html',expires_at:1800003600};
  const encrypted=await require('../auth/session.js').sealCookiePayload(flow,env.REXBID_AUTH_COOKIE_SECRET);
  const flowHeader=flowCookie(encrypted).split(';')[0];
  const start=await handler(request('/api/auth/callback?state=never-log-state&code=never-log-this-code&type=recovery',{method:'GET',origin:null,cookie:flowHeader,host:'https://rexbid-auth-test.tedn828.workers.dev'}),stagingEnv);
  assert.equal(start.status,303);
  const location=new URL(start.headers.get('Location'),'https://rexbid-auth-test.tedn828.workers.dev');
  assert.equal(location.pathname,'/reset-hasla.html'); assert.equal(location.searchParams.get('recovery'),'ready');
  const id=location.searchParams.get('cbdiag'); assert.match(id,/^[A-Za-z0-9_-]{16}$/);
  const setCookies=start.headers.getSetCookie();
  const receiptCookie=setCookies.find(value=>value.startsWith('__Host-rexbid_callback_diag='));
  assert.ok(receiptCookie); for(const flag of ['Path=/','Max-Age=300','Secure','HttpOnly','SameSite=Lax'])assert.ok(receiptCookie.includes(flag));
  const result=await handler(request(`/api/auth/callback-diagnostic?id=${id}`,{method:'GET',origin:null,cookie:receiptCookie.split(';')[0],host:'https://rexbid-auth-test.tedn828.workers.dev'}),stagingEnv);
  const body=await result.json();
  assert.equal(result.status,200);
  assert.deepEqual(body.diagnostic,{id,flow_type:'recovery',state_present:true,state_valid:true,flow_cookie_present:true,verifier_present:true,code_present:true,exchange_attempted:true,upstream_status:200,safe_error_code:null,identity_verified:true,session_created:true,final_redirect_target:'/reset-hasla.html?recovery=ready',failure_stage:null});
  assert.ok(result.headers.getSetCookie().some(value=>value.startsWith('__Host-rexbid_callback_diag=')&&value.includes('Max-Age=0')));
  const replay=await handler(request(`/api/auth/callback-diagnostic?id=${id}`,{method:'GET',host:'https://rexbid-auth-test.tedn828.workers.dev'}),stagingEnv);
  assert.equal(replay.status,404,'diagnostic result is one-time read');
  const serialized=JSON.stringify({startHeaders:setCookies,location:start.headers.get('Location'),result:body});
  for(const secret of ['never-log-this-code','never-log-state','never-log-this-verifier','never-log-access','never-log-refresh','recovery-result-user',encrypted])assert.ok(!serialized.includes(secret));
});

test('staging callback receipt pinpoints missing browser cookie, invalid state, absent code and PKCE exchange errors',async()=>{
  const stagingEnv={...env,AUTH_CANONICAL_ORIGIN:'https://rexbid-auth-test.tedn828.workers.dev',AUTH_ALLOWED_ORIGINS:'https://rexbid-auth-test.tedn828.workers.dev',REXBID_DB:new MemoryD1(),REXBID_AUTH_DIAGNOSTICS:'enabled',REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev'};
  const provider={exchangeCodeWithStatus:async()=>{throw Object.assign(new Error('private provider response'),{code:'AUTH_REJECTED',status:401,upstreamStatus:422});},verifyIdentity:async()=>{throw new Error('must not verify');}};
  const handler=createAccountsHandler({provider,now:()=>1800000000});
  async function diagnosticFor(path,cookie=''){
    const callback=await handler(request(path,{method:'GET',origin:null,cookie,host:'https://rexbid-auth-test.tedn828.workers.dev'}),stagingEnv);
    assert.equal(callback.status,303);
    const location=new URL(callback.headers.get('Location'),'https://rexbid-auth-test.tedn828.workers.dev');
    const receipt=callback.headers.getSetCookie().find(value=>value.startsWith('__Host-rexbid_callback_diag='));
    assert.ok(receipt);
    const response=await handler(request(`/api/auth/callback-diagnostic?id=${location.searchParams.get('cbdiag')}`,{method:'GET',cookie:receipt.split(';')[0],host:'https://rexbid-auth-test.tedn828.workers.dev'}),stagingEnv);
    return {location,body:await response.json()};
  }
  const noCookie=await diagnosticFor('/api/auth/callback?state=state&code=code&type=recovery');
  assert.equal(noCookie.body.diagnostic.flow_type,'recovery'); assert.equal(noCookie.body.diagnostic.flow_cookie_present,false);
  assert.equal(noCookie.body.diagnostic.state_valid,false);
  assert.equal(noCookie.body.diagnostic.verifier_present,false); assert.equal(noCookie.body.diagnostic.exchange_attempted,false);
  assert.equal(noCookie.body.diagnostic.safe_error_code,'callback_flow_cookie_missing');
  const flow={state:'expected-state',verifier:'opaque-verifier',purpose:'recovery',expires_at:1800003600};
  const sealed=await require('../auth/session.js').sealCookiePayload(flow,env.REXBID_AUTH_COOKIE_SECRET);
  const cookie=flowCookie(sealed).split(';')[0];
  const mismatch=await diagnosticFor('/api/auth/callback?state=other-state&code=code',cookie);
  assert.equal(mismatch.body.diagnostic.flow_type,'recovery'); assert.equal(mismatch.body.diagnostic.state_valid,false);
  assert.equal(mismatch.body.diagnostic.safe_error_code,'callback_state_mismatch'); assert.equal(mismatch.body.diagnostic.exchange_attempted,false);
  const noCode=await diagnosticFor('/api/auth/callback?state=expected-state',cookie);
  assert.equal(noCode.body.diagnostic.state_valid,true); assert.equal(noCode.body.diagnostic.code_present,false);
  assert.equal(noCode.body.diagnostic.safe_error_code,'callback_code_missing_or_invalid');
  const exchangeFailure=await diagnosticFor('/api/auth/callback?state=expected-state&code=one-time-code',cookie);
  assert.equal(exchangeFailure.body.diagnostic.exchange_attempted,true); assert.equal(exchangeFailure.body.diagnostic.upstream_status,422);
  assert.equal(exchangeFailure.body.diagnostic.safe_error_code,'AUTH_REJECTED'); assert.equal(exchangeFailure.body.diagnostic.identity_verified,false);
  assert.equal(exchangeFailure.body.diagnostic.session_created,false); assert.equal(exchangeFailure.body.diagnostic.failure_stage,'code_exchange');
  assert.equal(exchangeFailure.location.pathname,'/logowanie.html');
});

test('callback diagnostic endpoint is unavailable outside the exact staging diagnostic host',async()=>{
  const handler=createAccountsHandler({provider:{verifyIdentity:async()=>identityFor('x')}});
  const response=await handler(request('/api/auth/callback-diagnostic?id=AAAAAAAAAAAAAAAA',{method:'GET',host:'https://rex.test'}),env);
  assert.equal(response.status,404);
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

test('parallel /api/me and favorites share one refresh and both receive the same rotated cookie', async () => {
  const db = new MemoryD1(); const now = 1800000000; let refreshCalls = 0;
  const provider = {
    login: async () => ({ access_token: 'parallel-old-access', refresh_token: 'parallel-old-refresh', expires_at: now + 3600 }),
    verifyIdentity: async () => identityFor('parallel-refresh-user'),
    refresh: async () => { refreshCalls++; await new Promise(resolve => setTimeout(resolve, 8)); return { access_token: 'parallel-new-access', refresh_token: 'parallel-new-refresh', expires_at: now + 3600 }; }
  };
  const handler = createAccountsHandler({ provider, now: () => now });
  const login = await handler(request('/api/auth/login', { method:'POST', body:{ email:'parallel@example.test', password:'secure-password' } }), { ...env, REXBID_DB:db });
  const cookie = bearerCookieFrom(login);
  const decoded = await openCookiePayload(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)), env.REXBID_AUTH_COOKIE_SECRET);
  const expiring = await require('../auth/session.js').sealCookiePayload({ ...decoded, expires_at:now + 10 }, env.REXBID_AUTH_COOKIE_SECRET);
  const sharedCookie = `${sessionCookieName}=${encodeURIComponent(expiring)}`;
  const [me, favorites] = await Promise.all([
    handler(request('/api/me', { cookie:sharedCookie }), { ...env, REXBID_DB:db }),
    handler(request('/api/me/favorites', { cookie:sharedCookie }), { ...env, REXBID_DB:db })
  ]);
  assert.equal(refreshCalls, 1);
  assert.equal(me.status, 200); assert.equal(favorites.status, 200);
  const meCookie = me.headers.getSetCookie().find(value => value.startsWith(`${sessionCookieName}=`));
  const favoritesCookie = favorites.headers.getSetCookie().find(value => value.startsWith(`${sessionCookieName}=`));
  assert.ok(meCookie && favoritesCookie);
  const rotated = await openCookiePayload(decodeURIComponent(meCookie.split(';')[0].split('=').slice(1).join('=')), env.REXBID_AUTH_COOKIE_SECRET);
  const rotatedParallel = await openCookiePayload(decodeURIComponent(favoritesCookie.split(';')[0].split('=').slice(1).join('=')), env.REXBID_AUTH_COOKIE_SECRET);
  assert.equal(rotated.refresh_token, 'parallel-new-refresh');
  assert.equal(rotatedParallel.refresh_token, 'parallel-new-refresh');
});

test('parallel refresh across simulated Worker isolates preserves the winning session and never clears the loser cookie', async () => {
  const db=new MemoryD1(), now=1800000000; let refreshCalls=0, releaseBarrier;
  const barrier=new Promise(resolve=>{releaseBarrier=resolve;});
  const provider={
    login:async()=>({access_token:'isolate-old-access',refresh_token:'isolate-old-refresh',expires_at:now+3600}),
    verifyIdentity:async()=>identityFor('cross-isolate-refresh'),
    refresh:async()=>{const call=++refreshCalls;if(call===2)releaseBarrier();await barrier;if(call===1)return{access_token:'isolate-new-access',refresh_token:'isolate-new-refresh',expires_at:now+3600};throw Object.assign(new Error('rotated by other isolate'),{status:401});}
  };
  const firstHandler=createAccountsHandler({provider,now:()=>now});
  const login=await firstHandler(request('/api/auth/login',{method:'POST',body:{email:'isolated@example.test',password:'secure-password'}}),{...env,REXBID_DB:db});
  const loginCookie=bearerCookieFrom(login),decoded=await openCookiePayload(decodeURIComponent(loginCookie.split(';')[0].split('=').slice(1).join('=')),env.REXBID_AUTH_COOKIE_SECRET);
  const expiring=await require('../auth/session.js').sealCookiePayload({...decoded,expires_at:now+10},env.REXBID_AUTH_COOKIE_SECRET);
  const cookie=`${sessionCookieName}=${encodeURIComponent(expiring)}`;
  delete require.cache[require.resolve('../auth/routes.js')];
  const isolatedModule=require('../auth/routes.js');
  const secondHandler=isolatedModule.createAccountsHandler({provider,now:()=>now});
  const [first,second]=await Promise.all([
    firstHandler(request('/api/me',{cookie}),{...env,REXBID_DB:db}),
    secondHandler(request('/api/me',{cookie}),{...env,REXBID_DB:db})
  ]);
  assert.equal(refreshCalls,2);
  assert.equal(first.status,200); assert.equal(second.status,200);
  const setCookies=[...first.headers.getSetCookie(),...second.headers.getSetCookie()];
  assert.equal(setCookies.filter(value=>value.startsWith(`${sessionCookieName}=`)&&!value.includes('Max-Age=0')).length,1);
  assert.equal(setCookies.some(value=>value.startsWith(`${sessionCookieName}=`)&&value.includes('Max-Age=0')),false);
});

test('fail-closed auth configuration and Sec-Fetch-Site reject cross-origin use without activating auth', async () => {
  const handler = createAccountsHandler({ provider:{ verifyIdentity:async () => identityFor('x') } });
  const noFlag = await handler(request('/api/me'), { ...env, AUTH_ENABLED:'false' });
  assert.equal(noFlag.status, 503);
  const wrongOrigin = await handler(request('/api/me', { host:'https://other.test' }), { ...env, AUTH_CANONICAL_ORIGIN:'https://rex.test' });
  assert.equal(wrongOrigin.status, 503);
  const crossSite = await handler(new Request('https://rex.test/api/auth/logout', { method:'POST', headers:{ Origin:'https://rex.test', 'Sec-Fetch-Site':'cross-site' } }), env);
  assert.equal(crossSite.status, 403);
  const configuration = await handler(request('/api/auth/config'), { ...env, AUTH_ENABLED:'false' });
  assert.deepEqual(await configuration.json(), { ok:true, enabled:false });
  const schemaNotDeclared = await handler(request('/api/auth/config'), { ...env, AUTH_D1_SCHEMA_VERSION:undefined });
  assert.deepEqual(await schemaNotDeclared.json(), { ok:true, enabled:false });
  const supabasePath = await handler(request('/api/auth/config'), { ...env, SUPABASE_URL:'https://rex-test.supabase.co/auth/v1' });
  assert.deepEqual(await supabasePath.json(), { ok:true, enabled:false });
  let providerCalls = 0;
  const rateLimited = await createAccountsHandler({provider:{login:async()=>{providerCalls++;},verifyIdentity:async()=>identityFor('rate-limited')}})(request('/api/auth/login',{method:'POST',body:{email:'a@example.test',password:'secure-password'}}), { ...env, AUTH_RATE_LIMITER:{limit:async()=>({success:false})} });
  assert.equal(rateLimited.status,429);
  assert.equal(providerCalls,0);
  let identityCalls=0;
  const limitedRead=await createAccountsHandler({provider:{verifyIdentity:async()=>{identityCalls++;return identityFor('limited-read');}}})(request('/api/me'),{...env,AUTH_RATE_LIMITER:{limit:async()=>({success:false})}});
  assert.equal(limitedRead.status,429);
  assert.equal(identityCalls,0);
});

test('every state-changing account route rejects cross-site Origin and Fetch Metadata before provider access', async () => {
  let providerCalls=0;
  const handler=createAccountsHandler({provider:{login:async()=>{providerCalls++;},signup:async()=>{providerCalls++;},refresh:async()=>{providerCalls++;},logout:async()=>{providerCalls++;},requestPasswordReset:async()=>{providerCalls++;},resendConfirmation:async()=>{providerCalls++;},verifyIdentity:async()=>{providerCalls++;return identityFor('csrf-route');}}});
  const cases=[
    ['/api/auth/signup','POST',{email:'a@example.test',password:'secure-password'}],
    ['/api/auth/login','POST',{email:'a@example.test',password:'secure-password'}],
    ['/api/auth/recovery','POST',{email:'a@example.test'}],
    ['/api/auth/resend-confirmation','POST',{email:'a@example.test'}],
    ['/api/auth/refresh','POST',{}],
    ['/api/auth/logout','POST',{}],
    ['/api/auth/password','POST',{password:'secure-password'}],
    ['/api/me/favorites','POST',{vin:'1HGCM82633A004352'}],
    ['/api/me/favorites/merge','POST',{favorites:[]}],
    ['/api/me/favorites/vin%3A1HGCM82633A004352','DELETE',undefined]
  ];
  for(const [path,method,body] of cases){
    const headers={Origin:'https://attacker.test','Sec-Fetch-Site':'cross-site'};
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await handler(new Request('https://rex.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{...env,REXBID_DB:new MemoryD1()});
    assert.equal(response.status,403,path);
  }
  assert.equal(providerCalls,0);
});

test('password recovery is enumeration-neutral, PKCE-bound, and ends by updating password then revoking sessions', async () => {
  const db = new MemoryD1(); let capturedFlow, updated = 0, logoutScope = '', failRecovery = false;
  const provider = {
    requestPasswordReset: async (_env, input) => { assert.equal(input.redirectTo, 'https://rex.test/api/auth/callback?state=' + new URL(input.redirectTo).searchParams.get('state')); assert.ok(input.codeChallenge); if (failRecovery) throw new Error('provider account-specific failure'); },
    exchangeCode: async (_env, value) => { assert.equal(value.code, 'safe-one-time-code'); assert.ok(value.codeVerifier); return { access_token:'recovery-access-marker', refresh_token:'recovery-refresh-marker', expires_at:2000000000 }; },
    verifyIdentity: async () => identityFor('recovery-account'),
    updatePassword: async (_env, token, password) => { assert.equal(token,'recovery-access-marker'); assert.equal(password,'new-safe-password'); updated++; },
    logout: async (_env, token, scope) => { assert.equal(token,'recovery-access-marker'); logoutScope=scope; }
  };
  const handler=createAccountsHandler({ provider, now:()=>1800000000 });
  const recovery=await handler(request('/api/auth/recovery',{method:'POST',body:{email:'owner@example.test'}}),{...env,REXBID_DB:db});
  assert.equal(recovery.status,202); const recoveryBody=await recovery.json(); assert.doesNotMatch(JSON.stringify(recoveryBody),/owner@example|recovery-access/);
  failRecovery=true;
  const failedRecovery=await handler(request('/api/auth/recovery',{method:'POST',body:{email:'other@example.test'}}),{...env,REXBID_DB:db});
  assert.equal(failedRecovery.status,202);
  assert.equal((await failedRecovery.json()).message,recoveryBody.message);
  assert.ok(failedRecovery.headers.getSetCookie().some(value=>value.startsWith('__Host-rexbid_auth_flow=')));
  const flowCookieValue=recovery.headers.getSetCookie().find(value=>value.startsWith('__Host-rexbid_auth_flow=')); assert.ok(flowCookieValue);
  for(const flag of ['Path=/','Secure','HttpOnly','SameSite=Lax'])assert.ok(flowCookieValue.includes(flag));
  assert.doesNotMatch(flowCookieValue,/\bDomain=/i);
  const flowCookieHeader=flowCookieValue.split(';')[0];
  const flow=await openCookiePayload(decodeURIComponent(flowCookieHeader.split('=').slice(1).join('=')),env.REXBID_AUTH_COOKIE_SECRET);
  assert.equal(flow.purpose,'recovery'); assert.ok(flow.verifier);
  capturedFlow=flow;
  const callback=await handler(request(`/api/auth/callback?state=${encodeURIComponent(flow.state)}&code=safe-one-time-code`,{method:'GET',origin:null,cookie:flowCookieHeader}),{...env,REXBID_DB:db});
  assert.equal(callback.status,303); assert.equal(callback.headers.get('Location'),'/reset-hasla.html?recovery=ready');
  const sessionCookie=bearerCookieFrom(callback);
  const changed=await handler(request('/api/auth/password',{method:'POST',body:{password:'new-safe-password'},cookie:sessionCookie}),{...env,REXBID_DB:db});
  assert.equal(changed.status,200); assert.equal(updated,1); assert.equal(logoutScope,'global');
  assert.match(changed.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.doesNotMatch(JSON.stringify({flow:capturedFlow,response:await changed.clone().text()}),/safe-one-time-code|recovery-access-marker|recovery-refresh-marker/);
});

test('authenticated account export contains only the active user profile and their favorites', async () => {
  const db=new MemoryD1();
  const provider={ login:async()=>({access_token:'export-access',refresh_token:'export-refresh',expires_at:2000000000}), verifyIdentity:async()=>identityFor('export-user') };
  const handler=createAccountsHandler({provider});
  const login=await handler(request('/api/auth/login',{method:'POST',body:{email:'export@example.test',password:'safe-password'}}),{...env,REXBID_DB:db});
  const cookie=bearerCookieFrom(login);
  await handler(request('/api/me/favorites',{method:'POST',cookie,body:{lot:'TEST-LOT',platform:'iaai'}}),{...env,REXBID_DB:db});
  const exported=await handler(request('/api/me/export',{cookie}),{...env,REXBID_DB:db});
  const body=await exported.json(); assert.equal(exported.status,200); assert.equal(body.favorites.length,1); assert.equal(body.favorites[0].lot,'TEST-LOT');
  assert.doesNotMatch(JSON.stringify(body),/export-access|export-refresh|secret|token/i);
});

test('temporary Supabase outage preserves a still-valid access session without clearing its cookie', async () => {
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
  assert.equal(unavailable.status, 200);
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
    .replace('import providerBudgetModule from "./providers/request-budget.js";', 'const providerBudgetModule = globalThis.__providerBudgetModule;')
    .replace('export default {', 'globalThis.__worker = {');
  const context = {
    URL, URLSearchParams, Request, Response, Headers, AbortController, crypto: webcrypto,
    __apibaraModule: require('../providers/apibara.js'), __providerContract: require('../providers/contract.js'),
    __authProviderModule: require('../auth/supabase.js'), __accountsModule: require('../auth/routes.js'),
    __providerBudgetModule: require('../providers/request-budget.js'),
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
