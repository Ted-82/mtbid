const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { webcrypto } = require("node:crypto");
const { createAccountSessionResolver } = require("../auth/routes.js");
const { createSupabaseAuthProvider } = require("../auth/supabase.js");
const { sealCookiePayload, openCookiePayload, sessionCookieName } = require("../auth/session.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://rexbid.pl";
const NOW = 1800000000;
const ISSUER = "https://portalsessiontestabc.supabase.co/auth/v1";
const SECRET = "offline-only-portal-cookie-encryption-fixture-secret-43-plus";
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const b64 = value => Buffer.from(value).toString("base64url");
let signingKeys;

async function keys() {
  if (!signingKeys) signingKeys = webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
  }, true, ["sign", "verify"]).then(async pair => ({
    pair, jwk: { ...await webcrypto.subtle.exportKey("jwk", pair.publicKey), kid: "portal-fixture", alg: "RS256", use: "sig" }
  }));
  return signingKeys;
}

async function token(subject = "owner-subject", overrides = {}) {
  const { pair } = await keys();
  const input = `${b64(JSON.stringify({ alg: "RS256", kid: "portal-fixture", typ: "JWT" }))}.${b64(JSON.stringify({
    iss: ISSUER, sub: subject, aud: "authenticated", exp: NOW + 3600, aal: "aal2", ...overrides
  }))}`;
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

async function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(fs.readFileSync(path.join(ROOT, "docs/proposals/0003_accounts_foundation.sql"), "utf8"));
  const created = "2026-10-06T00:00:00Z";
  for (const subject of ["owner", "other"]) sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, 'email', 1, ?, ?)")
    .run(`account-${subject}`, ISSUER, `${subject}-subject`, created, created);
  const queries = [], calls = [], limiterKeys = [];
  const state = { userStatus: 200, confirmed: true, refreshStatus: 200, databaseDown: false };
  const { jwk } = await keys();
  const provider = createSupabaseAuthProvider({ cryptoImpl: webcrypto, now: () => NOW, fetchImpl: async (url, init = {}) => {
    const endpoint = new URL(url);
    calls.push(endpoint.pathname);
    if (endpoint.pathname.endsWith("/.well-known/jwks.json")) return response({ keys: [jwk] });
    if (endpoint.pathname.endsWith("/token") && endpoint.searchParams.get("grant_type") === "refresh_token") {
      if (state.refreshStatus !== 200) return response({ error: "fixture-refresh-error" }, state.refreshStatus);
      assert.equal(JSON.parse(init.body).refresh_token, "private-owner-refresh-marker");
      return response({ access_token: await token(), refresh_token: "private-rotated-refresh-marker", expires_at: NOW + 7200 });
    }
    if (endpoint.pathname.endsWith("/user")) {
      if (state.userStatus !== 200) return response({ error: "fixture-user-error" }, state.userStatus);
      const jwt = new Headers(init.headers).get("Authorization").slice("Bearer ".length);
      const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
      return response({ id: claims.sub, email: "private-email@example.test", email_confirmed_at: state.confirmed ? created : null, app_metadata: { provider: "email" } });
    }
    throw new Error("unexpected fixture endpoint");
  } });
  const env = {
    AUTH_ENABLED: "true", AUTH_D1_SCHEMA_VERSION: "0003",
    AUTH_CANONICAL_ORIGIN: ORIGIN, AUTH_ALLOWED_ORIGINS: ORIGIN,
    AUTH_RATE_LIMITING_MODE: "cloudflare",
    AUTH_RATE_LIMITER: { limit: async ({ key }) => { limiterKeys.push(key); return { success: true }; } },
    SUPABASE_URL: ISSUER.replace("/auth/v1", ""), SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture-public-key",
    REXBID_PRODUCTION_SUPABASE_PROJECT_REF: "portalsessiontestabc", AUTH_RECOVERY_MODE: "email-token",
    REXBID_AUTH_COOKIE_SECRET: SECRET,
    REXBID_DB: {
      prepare(sql) {
        assert.match(sql.trim(), /^SELECT\b/i, "portal session lookup may not mutate accounts");
        let args = [];
        return {
          bind(...values) { args = values; return this; },
          async first() {
            if (state.databaseDown) throw new Error("private-database-diagnostic-marker");
            queries.push({ sql, args });
            return sqlite.prepare(sql).get(...args) || null;
          }
        };
      }
    }
  };
  const resolve = createAccountSessionResolver({ provider, cryptoImpl: webcrypto, now: () => NOW });
  return {
    sqlite, env, provider, resolve, state, calls, queries, limiterKeys,
    async cookie(subject = "owner-subject", overrides = {}) {
      const payload = {
        access_token: await token(subject), refresh_token: "private-owner-refresh-marker", expires_at: NOW + 3600, ...overrides
      };
      return `${sessionCookieName}=${await sealCookiePayload(payload, SECRET, webcrypto)}`;
    }
  };
}

function request({ cookie = "", method = "GET", origin = ORIGIN, host = ORIGIN, site = "same-origin", query = "", headers = {} } = {}) {
  return new Request(`${host}/api/portal/orders${query}`, { method, headers: {
    "CF-Connecting-IP": "192.0.2.42", ...(cookie ? { Cookie: cookie } : {}),
    ...(origin ? { Origin: origin } : {}), ...(site ? { "Sec-Fetch-Site": site } : {}), ...headers
  } });
}

test("portal resolver uses a real encrypted cookie, verified Supabase JWT and issuer/subject SQLite mapping", async t => {
  const f = await fixture(t);
  const result = await f.resolve(request({ cookie: await f.cookie(), query: "?user_id=account-other&role=owner", headers: { "X-User-ID": "account-other" } }), f.env);
  assert.equal(result.status, 200);
  assert.deepEqual(result.user, { id: "account-owner", auth_provider: "email", email_verified: true, created_at: "2026-10-06T00:00:00Z" });
  assert.equal(result.notification_email,"private-email@example.test");
  assert.deepEqual(result.cookies, []);
  assert.equal(result.assurance_level, "aal2", "portal uses the optional adapter method exposing only server-verified AAL");
  assert.deepEqual(f.queries[0].args, [ISSUER, "owner-subject"]);
  assert.deepEqual(f.limiterKeys, ["portal_access:ip:192.0.2.42"]);
  assert.doesNotMatch(JSON.stringify(result), /private-|refresh_token|access_token|subject|issuer|role/);
  const other = await f.resolve(request({ cookie: await f.cookie("other-subject") }), f.env);
  assert.equal(other.user.id, "account-other");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 2);
});

test("portal configuration and canonical origin gates run before cookie verification", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  for (const overrides of [
    { AUTH_ENABLED: "false" }, { AUTH_D1_SCHEMA_VERSION: "wrong" },
    { REXBID_AUTH_COOKIE_SECRET: "short" }, { AUTH_RATE_LIMITER: null },
    { SUPABASE_URL: "http://unsafe.example" }, { REXBID_DB: null }
  ]) assert.equal((await f.resolve(request({ cookie }), { ...f.env, ...overrides })).status, 503);
  assert.equal((await f.resolve(request({ cookie, host: "https://other.example" }), f.env)).status, 503);
  assert.equal(f.calls.length, 0);
  assert.equal(f.queries.length, 0);
  assert.equal(f.limiterKeys.length, 0);
});

test("portal writes reject missing/cross-origin requests before limiter, cookie and database", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  for (const value of [
    { origin: null }, { origin: "https://attacker.example" },
    { origin: `${ORIGIN}/` }, { site: "cross-site" }
  ]) assert.equal((await f.resolve(request({ cookie, method: "POST", ...value }), f.env)).status, 403);
  assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0); assert.equal(f.limiterKeys.length, 0);
  const sameOrigin = await f.resolve(request({ cookie, method: "POST" }), f.env);
  assert.equal(sameOrigin.status, 200);
});

test("portal limiter denies or fails closed without contacting identity provider", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  for (const limit of [async () => ({ success: false }), async () => { throw new Error("private-limiter-failure-marker"); }]) {
    const result = await f.resolve(request({ cookie }), { ...f.env, AUTH_RATE_LIMITER: { limit } });
    assert.equal(result.status, 429); assert.equal(result.user, null); assert.deepEqual(result.cookies, []);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
});

test("portal never accepts Bearer headers, URL IDs or plaintext/tampered cookies as sessions", async t => {
  const f = await fixture(t);
  const bearer = await f.resolve(request({ headers: { Authorization: `Bearer ${await token()}` }, query: "?user_id=account-owner" }), f.env);
  assert.equal(bearer.status, 401); assert.deepEqual(bearer.cookies, []);
  const cookie = await f.cookie();
  const [version, iv, ciphertext] = cookie.split(".");
  const tampered = `${version}.${iv}.${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;
  for (const value of [`${sessionCookieName}=plaintext-private-marker`, tampered]) {
    const invalid = await f.resolve(request({ cookie: value }), f.env);
    assert.equal(invalid.status, 401); assert.match(invalid.cookies[0], /Max-Age=0/);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
});

test("portal rejects unverified, revoked, expired and unmapped identities without account creation", async t => {
  const f = await fixture(t);
  f.state.confirmed = false;
  const unverified = await f.resolve(request({ cookie: await f.cookie() }), f.env);
  assert.equal(unverified.status, 401); assert.match(unverified.cookies[0], /Max-Age=0/);
  f.state.confirmed = true; f.state.userStatus = 401;
  const revoked = await f.resolve(request({ cookie: await f.cookie() }), f.env);
  assert.equal(revoked.status, 401); assert.match(revoked.cookies[0], /Max-Age=0/);
  f.state.userStatus = 200;
  const expiredToken = await f.resolve(request({ cookie: await f.cookie("owner-subject", { access_token: await token("owner-subject", { exp: NOW - 1 }) }) }), f.env);
  assert.equal(expiredToken.status, 401);
  const unmapped = await f.resolve(request({ cookie: await f.cookie("unknown-subject") }), f.env);
  assert.equal(unmapped.status, 401); assert.match(unmapped.cookies[0], /Max-Age=0/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 2);
  f.sqlite.prepare("UPDATE users SET email_verified=0 WHERE id='account-owner'").run();
  const unverifiedAccount = await f.resolve(request({ cookie: await f.cookie() }), f.env);
  assert.equal(unverifiedAccount.status, 401); assert.match(unverifiedAccount.cookies[0], /Max-Age=0/);
});

test("portal preserves cookies on identity-provider or account-database outage and exposes no upstream error", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  f.state.userStatus = 503;
  const providerDown = await f.resolve(request({ cookie }), f.env);
  assert.equal(providerDown.status, 503); assert.deepEqual(providerDown.cookies, []); assert.equal(providerDown.user, null);
  f.state.userStatus = 200; f.state.databaseDown = true;
  const databaseDown = await f.resolve(request({ cookie }), f.env);
  assert.equal(databaseDown.status, 503); assert.deepEqual(databaseDown.cookies, []);
  assert.doesNotMatch(JSON.stringify({ providerDown, databaseDown }), /private-|error|token|supabase/);
});

test("portal returns encrypted rotated cookies while limiting public profile fields", async t => {
  const f = await fixture(t);
  const result = await f.resolve(request({ cookie: await f.cookie("owner-subject", { expires_at: NOW + 10 }) }), f.env);
  assert.equal(result.status, 200); assert.equal(result.cookies.length, 1);
  assert.match(result.cookies[0], /Secure; HttpOnly; SameSite=Lax/);
  const value = result.cookies[0].split(";", 1)[0].slice(`${sessionCookieName}=`.length);
  const rotated = await openCookiePayload(decodeURIComponent(value), SECRET, webcrypto);
  assert.equal(rotated.refresh_token, "private-rotated-refresh-marker");
  assert.equal(rotated.expires_at, NOW + 7200);
  assert.doesNotMatch(result.cookies[0], /private-rotated-refresh-marker/);
  assert.doesNotMatch(JSON.stringify(result.user), /token|email@|subject|issuer/);
});

test("portal preserves valid session after transient refresh failure and preserves outage state after expiration", async t => {
  const f = await fixture(t); f.state.refreshStatus = 503;
  const stillValid = await f.resolve(request({ cookie: await f.cookie("owner-subject", { expires_at: NOW + 10 }) }), f.env);
  assert.equal(stillValid.status, 200); assert.deepEqual(stillValid.cookies, []);
  const expired = await f.resolve(request({ cookie: await f.cookie("owner-subject", { expires_at: NOW - 10 }) }), f.env);
  assert.equal(expired.status, 503); assert.deepEqual(expired.cookies, []);
});

test("portal resolver accepts assurance only when the verified identity provider explicitly exposes it", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  const verifiedProvider = {
    verifyIdentity: async (env, jwt) => ({ ...await f.provider.verifyIdentity(env, jwt), assurance_level: "aal2" })
  };
  const resolve = createAccountSessionResolver({ provider: verifiedProvider, cryptoImpl: webcrypto, now: () => NOW });
  const result = await resolve(request({ cookie }), f.env);
  assert.equal(result.assurance_level, "aal2");
  const unknownProvider = {
    verifyIdentity: async (env, jwt) => ({ ...await f.provider.verifyIdentity(env, jwt), assurance_level: "mfa-enabled-in-profile" })
  };
  const unknown = await createAccountSessionResolver({ provider: unknownProvider, cryptoImpl: webcrypto, now: () => NOW })(request({ cookie }), f.env);
  assert.equal(unknown.assurance_level, null);
});

test("Supabase portal assurance rejects forged AAL claims and never elevates unknown or absent AAL to MFA", async t => {
  const f = await fixture(t);
  for (const [aal, expected] of [["aal1", "aal1"], [undefined, "aal1"], ["profile-mfa-enabled", null]]) {
    const result = await f.resolve(request({ cookie: await f.cookie("owner-subject", { access_token: await token("owner-subject", { aal }) }) }), f.env);
    assert.equal(result.status, 200); assert.equal(result.assurance_level, expected);
  }
  const pieces = (await token("owner-subject", { aal: "aal1" })).split(".");
  const claims = JSON.parse(Buffer.from(pieces[1], "base64url").toString());
  pieces[1] = Buffer.from(JSON.stringify({ ...claims, aal: "aal2" })).toString("base64url");
  const forged = await f.resolve(request({ cookie: await f.cookie("owner-subject", { access_token: pieces.join(".") }) }), f.env);
  assert.equal(forged.status, 401); assert.equal(forged.assurance_level, null); assert.match(forged.cookies[0], /Max-Age=0/);
  const existing = await f.provider.verifyIdentity(f.env, await token());
  assert.deepEqual(Object.keys(existing).sort(), ["auth_provider", "email_verified", "issuer", "subject"], "legacy identity behavior remains unchanged");
});
