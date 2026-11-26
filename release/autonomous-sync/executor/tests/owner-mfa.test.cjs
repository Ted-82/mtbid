const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { webcrypto } = require("node:crypto");
const { createOwnerMfaHandler, createAccountSessionResolver } = require("../auth/routes.js");
const { createSupabaseAuthProvider } = require("../auth/supabase.js");
const { sealCookiePayload, openCookiePayload, sessionCookieName } = require("../auth/session.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://rexbid.pl";
const NOW = 1800000000;
const PROJECT = "ownermfafixtureabcde";
const ISSUER = `https://${PROJECT}.supabase.co/auth/v1`;
const SECRET = "offline-only-owner-mfa-cookie-encryption-fixture-secret-43-plus";
const FACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER_FACTOR = "22222222-2222-4222-8222-222222222222";
const CHALLENGE = "33333333-3333-4333-8333-333333333333";
const MFA_COOKIE = "__Host-rexbid_mfa_challenge";
const TOTP_SECRET = "ABCDEFGHIJKLMNOP234567ABCDEFGHIJKLMNOP";
const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>';
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let keyPromise;

async function keys() {
  if (!keyPromise) keyPromise = webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
  }, true, ["sign", "verify"]).then(async pair => ({ pair,
    jwk: { ...await webcrypto.subtle.exportKey("jwk", pair.publicKey), kid: "owner-mfa-fixture", alg: "RS256", use: "sig" }
  }));
  return keyPromise;
}
async function token(subject = "owner-subject", aal = "aal1") {
  const { pair } = await keys();
  const input = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "owner-mfa-fixture" })).toString("base64url")}.${Buffer.from(JSON.stringify({
    iss: ISSUER, sub: subject, aud: "authenticated", exp: NOW + 3600, ...(aal === undefined ? {} : { aal })
  })).toString("base64url")}`;
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

async function fixture(t, { verified = false } = {}) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(fs.readFileSync(path.join(ROOT, "docs/proposals/0003_accounts_foundation.sql"), "utf8"));
  for (const subject of ["owner", "other"]) sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, 'email', 1, '2026-10-06', '2026-10-06')")
    .run(`account-${subject}`, ISSUER, `${subject}-subject`);
  const calls = [], queries = [], limiterKeys = [];
  const state = {
    factors: verified ? [{ id: FACTOR, factor_type: "totp", status: "verified", friendly_name: "Primary" }] : [],
    verifySubject: "owner-subject", verifyAal: "aal2", verifyStatus: 200,
    verifiedFactorStatus: "verified", enrollStatus: 200, challengeStatus: 200, time: NOW, qrCode: QR_SVG
  };
  const { jwk } = await keys();
  const provider = createSupabaseAuthProvider({ cryptoImpl: webcrypto, now: () => state.time, fetchImpl: async (url, init = {}) => {
    const endpoint = new URL(url), headers = new Headers(init.headers);
    calls.push({ path: endpoint.pathname, method: init.method || "GET" });
    assert.equal(endpoint.origin, `https://${PROJECT}.supabase.co`);
    assert.equal(init.redirect, "manual", "MFA credentials cannot follow an upstream redirect");
    if (endpoint.pathname.endsWith("/.well-known/jwks.json")) return response({ keys: [jwk] });
    const jwt = headers.get("Authorization")?.slice("Bearer ".length);
    assert.ok(jwt, "online identity/MFA calls use the existing real user token");
    assert.equal(headers.get("apikey"), "sb_publishable_mfa-fixture-public-key");
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    if (endpoint.pathname.endsWith("/user")) {
      state.onUserRead?.(calls.filter(call => call.path.endsWith("/user")).length);
      return response({ id: claims.sub, email: "private-owner-email@example.test", email_confirmed_at: "2026-10-06",
        app_metadata: { provider: "email", role: "owner", aal: "aal2" }, factors: claims.sub === "owner-subject" ? state.factors : [] });
    }
    if (endpoint.pathname === `/auth/v1/factors/${FACTOR}` && init.method === "DELETE") {
      assert.equal(claims.aal, "aal1");
      assert.equal(init.body, undefined);
      if (state.deleteStatus) return response({code: "unexpected_failure"}, state.deleteStatus);
      if (state.factors.some(factor => factor.status === "verified")) return response({code: "insufficient_aal"}, 422);
      assert.equal(state.factors.length, 1);
      assert.equal(state.factors[0].id, FACTOR);
      assert.equal(state.factors[0].status, "unverified");
      state.factors = [];
      return response({id: FACTOR});
    }
    if (endpoint.pathname === "/auth/v1/factors") {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { factor_type: "totp", issuer: "REXBID", friendly_name: "Administrator REXBID" });
      if (state.enrollStatus !== 200) return response({ code: state.enrollCode, error: "private-enroll-error" }, state.enrollStatus);
      state.factors.push({ id: FACTOR, factor_type: "totp", status: "unverified", friendly_name: "Administrator REXBID", secret: "must-never-leak-via-list" });
      return response({ id: FACTOR, type: "totp", totp: { secret: TOTP_SECRET,
        uri: `otpauth://totp/REXBID:owner?secret=${TOTP_SECRET}&issuer=REXBID`,
        qr_code: state.qrCode } });
    }
    if (endpoint.pathname === `/auth/v1/factors/${FACTOR}/challenge`) {
      assert.equal(init.method, "POST"); assert.deepEqual(JSON.parse(init.body), {});
      if (state.challengeStatus !== 200) return response({ error: "private-challenge-error" }, state.challengeStatus);
      return response({ id: CHALLENGE, type: "totp", expires_at: state.time + 300 });
    }
    if (endpoint.pathname === `/auth/v1/factors/${FACTOR}/verify`) {
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body); assert.equal(body.challenge_id, CHALLENGE);
      if (state.verifyStatus !== 200) return response({ error: "private-verify-error" }, state.verifyStatus);
      if (body.code !== "123456") return response({ error: "invalid_totp" }, 422);
      state.factors[0].status = state.verifiedFactorStatus;
      return response({ access_token: await token(state.verifySubject, state.verifyAal),
        refresh_token: "private-mfa-rotated-refresh-marker", expires_at: state.time + 3600 });
    }
    throw new Error("unexpected fixture upstream endpoint");
  } });
  const env = {
    AUTH_ENABLED: "true", AUTH_D1_SCHEMA_VERSION: "0003",
    AUTH_CANONICAL_ORIGIN: ORIGIN, AUTH_ALLOWED_ORIGINS: ORIGIN,
    AUTH_RATE_LIMITING_MODE: "cloudflare", AUTH_RATE_LIMITER: { limit: async ({ key }) => { limiterKeys.push(key); return { success: true }; } },
    SUPABASE_URL: `https://${PROJECT}.supabase.co`, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_mfa-fixture-public-key",
    REXBID_PRODUCTION_SUPABASE_PROJECT_REF: PROJECT, AUTH_RECOVERY_MODE: "email-token",
    REXBID_AUTH_COOKIE_SECRET: SECRET, REXBID_OWNER_USER_ID: "account-owner",
    REXBID_PORTAL_ENABLED: "enabled", REXBID_PORTAL_SCHEMA_VERSION: "0006",
    REXBID_DB: { prepare(sql) {
      assert.match(sql.trim(), /^SELECT\b/i, "MFA must not modify application accounts");
      let args = [];
      return { bind(...values) { args = values; return this; }, async first() {
        queries.push({ sql, args }); return sqlite.prepare(sql).get(...args) || null;
      } };
    } }
  };
  const handler = createOwnerMfaHandler({ provider, cryptoImpl: webcrypto, now: () => state.time });
  return { state, calls, queries, limiterKeys, env, provider, handler,
    async cookie(subject = "owner-subject", aal = "aal1") {
      return `${sessionCookieName}=${await sealCookiePayload({ access_token: await token(subject, aal), refresh_token: "private-owner-refresh-marker", expires_at: NOW + 3600 }, SECRET, webcrypto)}`;
    },
    async challenge(cookie) {
      const result = await handler(request("/challenge", { cookie, body: { factor_id: FACTOR } }), env);
      assert.equal(result.status, 200);
      const body = await result.json();
      const receipt = result.headers.getSetCookie().find(value => value.startsWith(`${MFA_COOKIE}=`)).split(";")[0];
      return { body, receipt };
    }
  };
}

function request(suffix = "", { cookie = "", body, method = body === undefined ? "GET" : "POST", origin = ORIGIN, site = "same-origin", target = ORIGIN } = {}) {
  return new Request(`${target}/api/portal/security${suffix}`, { method, headers: {
    "CF-Connecting-IP": "192.0.2.77", ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
    ...(site ? { "Sec-Fetch-Site": site } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" })
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("owner MFA state accepts only the configured verified application owner and exposes no secrets", async t => {
  const f = await fixture(t, { verified: true });
  const owner = await f.handler(request("", { cookie: await f.cookie() }), f.env);
  assert.equal(owner.status, 200);
  const body = await owner.json();
  assert.deepEqual(body, { ok: true, owner: true, assurance_level: "aal1", factors: [{ id: FACTOR, factor_type: "totp", status: "verified", friendly_name: "Primary" }], has_verified_factor: true });
  assert.match(owner.headers.get("Cache-Control"), /private, no-store/);
  assert.match(owner.headers.get("X-Robots-Tag"), /noindex/);
  assert.doesNotMatch(JSON.stringify(body), /token|private-|issuer|subject|email|secret/);
  assert.equal((await f.handler(request("", { cookie: await f.cookie("other-subject") }), f.env)).status, 403);
  assert.equal((await f.handler(request(), f.env)).status, 401);
  assert.equal(f.calls.some(call => call.path.includes("/factors")), false);
});

test("owner MFA fails closed before cookies on disabled configuration, cross-site writes and limiter failure", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  for (const overrides of [{ AUTH_ENABLED: "false" }, { REXBID_PORTAL_ENABLED: "disabled" }, { REXBID_PORTAL_SCHEMA_VERSION: "wrong" },
    { REXBID_OWNER_USER_ID: "" }, { REXBID_OWNER_USER_ID: " account-owner" }, { REXBID_OWNER_USER_ID: "owner\u0000" }, { REXBID_OWNER_USER_ID: "x".repeat(81) }]) {
    assert.equal((await f.handler(request("", { cookie }), { ...f.env, ...overrides })).status, 503);
  }
  for (const values of [{ origin: null }, { origin: "https://attacker.example" }, { site: "cross-site" }]) {
    assert.equal((await f.handler(request("/enroll", { cookie, body: {}, ...values }), f.env)).status, 403);
  }
  assert.equal((await f.handler(request("", { cookie, site: "cross-site" }), f.env)).status, 403);
  assert.equal((await f.handler(request("", { cookie }), { ...f.env, AUTH_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
  assert.equal((await f.handler(request("/enroll", { cookie }), f.env)).status, 405);
  assert.equal(await f.handler(request("/delete", { cookie, body: {} }), f.env), null);
});

test("real owner enroll/challenge/verify flow rotates only an encrypted HttpOnly AAL2 session", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  const enrollment = await f.handler(request("/enroll", { cookie, body: {} }), f.env);
  assert.equal(enrollment.status, 201);
  const setup = await enrollment.json();
  assert.equal(setup.factor.id, FACTOR); assert.equal(setup.factor.secret, TOTP_SECRET);
  assert.match(setup.factor.qr_code, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.doesNotMatch(JSON.stringify(setup), /access_token|refresh_token|private-owner/);
  const challenge = await f.challenge(cookie);
  assert.equal(challenge.body.challenge_id, CHALLENGE);
  assert.doesNotMatch(challenge.receipt, /owner-subject|account-owner/);
  const result = await f.handler(request("/verify", { cookie: `${cookie}; ${challenge.receipt}`, body: { factor_id: FACTOR, challenge_id: CHALLENGE, code: "123456" } }), f.env);
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true, assurance_level: "aal2" });
  const cookies = result.headers.getSetCookie();
  const rotatedCookie = cookies.find(value => value.startsWith(`${sessionCookieName}=`));
  assert.match(rotatedCookie, /Secure; HttpOnly; SameSite=Lax/);
  assert.match(cookies.find(value => value.startsWith(`${MFA_COOKIE}=`)), /Max-Age=0; Secure; HttpOnly; SameSite=Strict/);
  const payload = await openCookiePayload(decodeURIComponent(rotatedCookie.split(";")[0].slice(`${sessionCookieName}=`.length)), SECRET, webcrypto);
  assert.equal(payload.refresh_token, "private-mfa-rotated-refresh-marker");
  const resolver = createAccountSessionResolver({ provider: f.provider, cryptoImpl: webcrypto, now: () => f.state.time });
  const ownerSession = await resolver(request("", { cookie: rotatedCookie.split(";")[0] }), f.env);
  assert.equal(ownerSession.assurance_level, "aal2"); assert.equal(ownerSession.user.id, "account-owner");
  assert.equal(f.queries.every(query => query.args[1] === "owner-subject"), true);
  assert.ok(f.limiterKeys.every(key => /^owner_mfa_(?:enroll|challenge|verify):ip:192\.0\.2\.77$|^portal_access:ip:192\.0\.2\.77$/.test(key)));
});

test("owner enrollment normalizes raw SVG and exact SVG data URI formats without losing the QR", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  const svg = QR_SVG.replace("<rect", "<title>REXBID — test</title><rect");
  const expected = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  for (const [label, value] of [
    ["raw SVG", svg],
    ["percent-encoded SVG data URI", `data:image/svg+xml,${encodeURIComponent(svg)}`],
    ["UTF-8 percent-encoded SVG data URI", expected],
    ["base64 SVG data URI", `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`],
    ["UTF-8 base64 SVG data URI", `data:image/svg+xml;charset=utf-8;base64,${Buffer.from(svg).toString("base64")}`],
    ["plain SVG inside data URI", `data:image/svg+xml,${svg}`],
    ["case-insensitive MIME and charset", `DATA:IMAGE/SVG+XML;CHARSET=UTF-8,${encodeURIComponent(svg)}`]
  ]) {
    f.state.factors = []; // Independent synthetic enrollment for each format.
    f.state.qrCode = value;
    const result = await f.handler(request("/enroll", { cookie, body: {} }), f.env);
    assert.equal(result.status, 201, label);
    const body = await result.json();
    assert.equal(body.factor.qr_code, expected, label);
    assert.equal(body.factor.secret, TOTP_SECRET, label);
    assert.doesNotMatch(JSON.stringify(body), /access_token|refresh_token|private-owner/, label);
    assert.match(result.headers.get("Cache-Control"), /private, no-store/, label);
  }
});

test("owner enrollment preserves manual setup when QR input is unsupported, malformed or too large", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  for (const [label, value] of [
    ["missing QR", undefined], ["non-string QR", { svg: QR_SVG }],
    ["external image", "https://example.invalid/qr.svg"],
    ["foreign MIME", `data:text/html,${encodeURIComponent(QR_SVG)}`],
    ["unsupported SVG parameter", `data:image/svg+xml;name=qr.svg,${encodeURIComponent(QR_SVG)}`],
    ["malformed percent encoding", "data:image/svg+xml,%3Csvg%ZZ"],
    ["invalid base64 alphabet", "data:image/svg+xml;base64,%%%%"],
    ["invalid base64 UTF-8", "data:image/svg+xml;base64,/w=="],
    ["unbounded raw SVG", `<svg>${" ".repeat(524288)}</svg>`],
    ["unbounded encoded image", `data:image/svg+xml,${"%20".repeat(350000)}`],
    ["processing instruction", '<?xml-stylesheet href="https://example.invalid/style"?><svg/>'],
    ["nonstandard XML preamble", '<?xml version="1.0" evil="yes"?><svg/>'],
    ["document type", `<svg><!DOCTYPE svg></svg>`],
    ["entity declaration", `<svg><!ENTITY remote SYSTEM 'https://example.invalid/'></svg>`]
  ]) {
    f.state.factors = []; // Independent synthetic enrollment for each format.
    f.state.qrCode = value;
    const result = await f.handler(request("/enroll", { cookie, body: {} }), f.env);
    assert.equal(result.status, 201, label);
    const body = await result.json();
    assert.equal(body.factor.qr_code, null, label);
    assert.equal(body.factor.secret, TOTP_SECRET, label);
    assert.match(body.factor.uri, /^otpauth:\/\/totp\//, label);
  }
});

test("Supabase REST SVGo QR reaches the real browser sanitizer at realistic size without reenrollment", async t => {
  const { JSDOM } = require("jsdom");
  const svg = require("./fixtures/supabase-qr.cjs")();
  assert.ok(svg.length > 128000, "fixture exercises the former raw size limit");
  const f = await fixture(t), cookie = await f.cookie();
  f.state.qrCode = svg;
  const result = await f.handler(request("/enroll", { cookie, body: {} }), f.env);
  assert.equal(result.status, 201);
  const setup = await result.json();
  assert.ok(setup.factor.qr_code?.length > 180000, "fixture exercises former frontend limit");
  assert.doesNotMatch(decodeURIComponent(setup.factor.qr_code), /<\?xml|Generated by SVGo/);
  const dom = new JSDOM('<div id="rexbid-owner-mfa"></div>', { url: ORIGIN, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const calls = [];
  dom.window.fetch = async url => {
    calls.push(url);
    return response(url.endsWith("/enroll") ? setup : { ok: true, owner: true, assurance_level: "aal1", factors: [] });
  };
  dom.window.eval(fs.readFileSync(path.join(ROOT, "public/rexbid-owner-mfa.js"), "utf8"));
  const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
  await flush();
  dom.window.document.querySelector("button").click();
  await flush();
  const img = dom.window.document.querySelector("img");
  assert.ok(img, "backend result must survive actual frontend validation");
  const rendered = decodeURIComponent(img.src.slice(img.src.indexOf(",") + 1));
  assert.doesNotMatch(rendered, /style=|xmlns:xlink/);
  assert.equal((rendered.match(/<rect\b/g) || []).length, 57 * 57);
  assert.match(rendered, /fill="black"/);
  assert.match(rendered, /fill="white"/);
  assert.equal(calls.filter(url => url.endsWith("/enroll")).length, 1);
  assert.equal(f.calls.filter(call => call.method === "DELETE").length, 0);
});

test("existing verified MFA cannot be replaced from AAL1 even using a newly enrolled factor", async t => {
  const f = await fixture(t, { verified: true });
  const denied = await f.handler(request("/enroll", { cookie: await f.cookie(), body: {} }), f.env);
  assert.equal(denied.status, 403); assert.equal(f.calls.some(call => call.path === "/auth/v1/factors"), false);
  // Signing in with the existing factor remains available.
  const cookie = await f.cookie(), challenge = await f.challenge(cookie);
  const verified = await f.handler(request("/verify", { cookie: `${cookie}; ${challenge.receipt}`, body: { factor_id: FACTOR, challenge_id: CHALLENGE, code: "123456" } }), f.env);
  assert.equal(verified.status, 200);
  f.state.factors.push({ id: OTHER_FACTOR, factor_type: "totp", status: "unverified" });
  const bypass = await f.handler(request("/challenge", { cookie, body: { factor_id: OTHER_FACTOR } }), f.env);
  assert.equal(bypass.status, 403, "AAL1 may challenge only a verified factor when verified MFA already exists");
  f.state.factors = Array.from({ length: 20 }, (_, index) => ({
    id: `${String(index).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, factor_type: "totp", status: "unverified"
  }));
  f.state.factors.push({ id: FACTOR, factor_type: "totp", status: "verified" });
  const boundedList = await f.handler(request("/enroll", { cookie, body: {} }), f.env);
  assert.equal(boundedList.status, 403, "bounded display lists cannot hide an existing verified factor from the MFA gate");
});

test("owner MFA rejects foreign factors, forged role/IDs and missing or mismatched browser challenge receipts", async t => {
  const f = await fixture(t, { verified: true }), cookie = await f.cookie();
  for (const body of [{ factor_id: OTHER_FACTOR }, { factor_id: "../user" }, { factor_id: FACTOR, user_id: "account-owner" }]) {
    assert.equal((await f.handler(request("/challenge", { cookie, body }), f.env)).status, 400);
  }
  const verify = { factor_id: FACTOR, challenge_id: CHALLENGE, code: "123456" };
  assert.equal((await f.handler(request("/verify", { cookie, body: verify }), f.env)).status, 403);
  const challenge = await f.challenge(cookie);
  assert.equal((await f.handler(request("/verify", { cookie: `${cookie}; ${challenge.receipt}`, body: { ...verify, challenge_id: OTHER_FACTOR } }), f.env)).status, 403);
  const wrongOwner = await sealCookiePayload({ challenge_id: CHALLENGE, factor_id: FACTOR, user_id: "account-other", issuer: ISSUER, subject: "owner-subject", expires_at: NOW + 300 }, SECRET, webcrypto);
  assert.equal((await f.handler(request("/verify", { cookie: `${cookie}; ${MFA_COOKIE}=${wrongOwner}`, body: verify }), f.env)).status, 403);
  f.state.time = NOW + 301;
  assert.equal((await f.handler(request("/verify", { cookie: `${cookie}; ${challenge.receipt}`, body: verify }), f.env)).status, 403);
  assert.equal(f.calls.some(call => call.path.endsWith("/verify")), false);
});

test("MFA verify rejects wrong codes and never accepts wrong-identity, lower-AAL or unverified-factor sessions", async t => {
  const f = await fixture(t, { verified: true }), cookie = await f.cookie(), challenge = await f.challenge(cookie);
  const verify = (code = "123456") => request("/verify", { cookie: `${cookie}; ${challenge.receipt}`, body: { factor_id: FACTOR, challenge_id: CHALLENGE, code } });
  const wrong = await f.handler(verify("654321"), f.env);
  assert.equal(wrong.status, 400); assert.equal(wrong.headers.getSetCookie().some(value => value.startsWith(`${sessionCookieName}=`)), false);
  for (const updates of [
    { verifySubject: "other-subject", verifyAal: "aal2", verifiedFactorStatus: "verified" },
    { verifySubject: "owner-subject", verifyAal: "aal1", verifiedFactorStatus: "verified" },
    { verifySubject: "owner-subject", verifyAal: "aal2", verifiedFactorStatus: "unverified" }
  ]) {
    Object.assign(f.state, updates);
    const invalid = await f.handler(verify(), f.env);
    assert.equal(invalid.status, 503); assert.equal(invalid.headers.getSetCookie().some(value => value.startsWith(`${sessionCookieName}=`)), false);
    assert.doesNotMatch(await invalid.text(), /private-|token|subject|email|654321|123456/);
  }
});

test("provider MFA endpoints validate UUIDs and never follow redirects or leak upstream errors", async t => {
  const f = await fixture(t), accessToken = await token();
  await assert.rejects(f.provider.challengeTotp(f.env, accessToken, "../user"), error => error.status === 401);
  await assert.rejects(f.provider.verifyTotp(f.env, accessToken, { factorId: FACTOR, challengeId: "../user", code: "123456" }), error => error.status === 401);
  assert.equal(f.calls.length, 0);
  const redirected = createSupabaseAuthProvider({ cryptoImpl: webcrypto, now: () => NOW, fetchImpl: async (_url, init) => {
    assert.equal(init.redirect, "manual"); return new Response(null, { status: 302, headers: { Location: "https://attacker.example" } });
  } });
  await assert.rejects(redirected.enrollTotp(f.env, accessToken), error => error.code === "AUTH_UNEXPECTED_REDIRECT");
  f.state.enrollStatus = 503;
  const unavailable = await f.handler(request("/enroll", { cookie: await f.cookie(), body: {} }), f.env);
  assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /private-|token|subject/);
});

test("pending owner TOTP resumes verification without reenrollment, deletion or reset", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  f.state.factors = [{ id: FACTOR, factor_type: "totp", status: "unverified", friendly_name: "Administrator REXBID" }];
  const before = JSON.stringify(f.state.factors);
  const pending = await f.handler(request("/enroll", { cookie, body: {} }), f.env);
  assert.equal(pending.status, 409);
  assert.equal((await pending.json()).code, "MFA_ENROLLMENT_PENDING");
  assert.equal(JSON.stringify(f.state.factors), before);
  assert.equal(f.calls.some(c => c.path === "/auth/v1/factors" || c.method === "DELETE"), false);
  const listing = await f.handler(request("", { cookie }), f.env);
  assert.equal((await listing.json()).factors[0].status, "unverified");
  const challenge = await f.challenge(cookie);
  const verified = await f.handler(request("/verify", { cookie: `${cookie}; ${challenge.receipt}`, body: {
    factor_id: FACTOR, challenge_id: CHALLENGE, code: "123456"
  } }), f.env);
  assert.equal(verified.status, 200);
  assert.equal(f.state.factors.length, 1);
  assert.equal(f.state.factors[0].status, "verified");
  assert.equal(f.calls.some(c => c.path === "/auth/v1/factors" || c.method === "DELETE"), false);
});

test("real Supabase error mapping preserves a safe conflict/rate/configuration reason instead of generic 503", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  const staging = "https://rexbid-auth-test.tedn828.workers.dev";
  Object.assign(f.env, { AUTH_CANONICAL_ORIGIN: staging, AUTH_ALLOWED_ORIGINS: staging,
    REXBID_AUTH_DIAGNOSTICS: "enabled", REXBID_AUTH_TEST_UI: "enabled", REXBID_AUTH_TEST_HOST: new URL(staging).hostname });
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  for (const [upstream, code, expected] of [
    [422, "mfa_factor_name_conflict", 409], [422, "mfa_factor_limit_reached", 409],
    [429, "over_request_rate_limit", 429], [422, "mfa_totp_enroll_not_enabled", 503],
    [401, "session_expired", 401], [500, "unexpected_failure", 503],
    [500, "private_upstream_marker", 503]
  ]) {
    f.state.enrollStatus = upstream; f.state.enrollCode = code;
    const result = await f.handler(request("/enroll", { cookie, body: {}, target: staging, origin: staging }), f.env);
    assert.equal(result.status, expected, code);
    const body = await result.json();
    assert.equal(body.diagnostic.operation, "enroll");
    assert.equal(body.diagnostic.stage, "upstream_enroll");
    assert.equal(body.diagnostic.upstream_status, upstream);
    assert.equal(body.diagnostic.safe_code, code === "private_upstream_marker" ? "AUTH_UNAVAILABLE" : code);
    assert.match(body.diagnostic.request_id, /^[a-f0-9-]{36}$/);
    assert.doesNotMatch(JSON.stringify(body), /private|token|secret|email|cookie|otpauth/i);
    assert.match(result.headers.get("Cache-Control"), /private, no-store/);
  }
  assert.doesNotMatch(JSON.stringify(logs), /private_upstream_marker|private-enroll-error|private-owner-email|ABCDEFGHIJKLMNOP/);
  // Flags copied accidentally to production do not enable diagnostic output.
  f.env.AUTH_CANONICAL_ORIGIN = ORIGIN; f.env.AUTH_ALLOWED_ORIGINS = ORIGIN;
  const production = await f.handler(request("/enroll", { cookie, body: {} }), f.env);
  assert.equal(Object.hasOwn(await production.json(), "diagnostic"), false);
});

test("staging MFA diagnostics distinguish configuration, account lookup and pending enrollment without identifiers", async t => {
  const f = await fixture(t), cookie = await f.cookie();
  const target = "https://rexbid-auth-test.tedn828.workers.dev";
  Object.assign(f.env, { AUTH_CANONICAL_ORIGIN: target, AUTH_ALLOWED_ORIGINS: target,
    REXBID_AUTH_DIAGNOSTICS: "enabled", REXBID_AUTH_TEST_UI: "enabled", REXBID_AUTH_TEST_HOST: new URL(target).hostname });
  t.mock.method(console, "warn", () => {});
  const get = () => f.handler(request("", { cookie, target, origin: target }), f.env);
  f.env.REXBID_PORTAL_SCHEMA_VERSION = "missing";
  const disabled = await get();
  assert.equal(disabled.status, 503); assert.equal((await disabled.json()).diagnostic.stage, "configuration");
  f.env.REXBID_PORTAL_SCHEMA_VERSION = "0006";
  const db = f.env.REXBID_DB;
  f.env.REXBID_DB = { prepare() { throw new Error("private-db-error"); } };
  const unavailable = await get();
  assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).diagnostic.stage, "account_lookup");
  f.env.REXBID_DB = db;
  f.state.factors = [{ id: FACTOR, factor_type: "totp", status: "unverified", secret: "private-secret" }];
  const body = await (await get()).json();
  assert.equal(body.diagnostic.stage, "factor_state");
  assert.equal(body.diagnostic.pending_totp_count, 1);
  assert.equal(body.diagnostic.verified_totp_count, 0);
  assert.doesNotMatch(JSON.stringify(body.diagnostic), /11111111|private|email|secret|token/);
  const blocked = await f.handler(request("/enroll", { cookie, body: {}, target, origin: target }), f.env);
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).diagnostic.stage, "enrollment_guard");
});

const STAGING = "https://rexbid-auth-test.tedn828.workers.dev";
const pendingFactor = (overrides = {}) => ({id: FACTOR, factor_type: "totp", status: "unverified",
  created_at: new Date((NOW - 100) * 1000).toISOString(), ...overrides});
function enablePendingRestart(f) {
  Object.assign(f.env, {AUTH_CANONICAL_ORIGIN: STAGING, AUTH_ALLOWED_ORIGINS: STAGING,
    REXBID_AUTH_TEST_UI: "enabled", REXBID_AUTH_TEST_HOST: new URL(STAGING).hostname,
    REXBID_OWNER_MFA_PENDING_RESTART: "enabled",
    REXBID_OWNER_MFA_PENDING_BEFORE: new Date(NOW * 1000).toISOString(),
    REXBID_OWNER_MFA_PENDING_UNTIL: new Date((NOW + 86400) * 1000).toISOString()});
}
const restartRequest = (cookie, extra = {}) => request("/restart-pending", {
  cookie, target: STAGING, origin: STAGING, body: {factor_id: FACTOR}, ...extra
});

test("approved staging restart rechecks owner and complete factors, removes exactly one old pending TOTP and confirms zero", async t => {
  const f = await fixture(t), cookie = await f.cookie(); enablePendingRestart(f);
  f.state.factors = [pendingFactor()];
  const initial = await f.handler(request("", {cookie, target: STAGING, origin: STAGING}), f.env);
  assert.equal((await initial.json()).restart_pending_available, true);
  const result = await f.handler(restartRequest(cookie), f.env);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {ok: true, removed_pending: true});
  assert.ok(result.headers.getSetCookie().some(c => c.startsWith(MFA_COOKIE) && c.includes("Max-Age=0")));
  assert.equal(f.state.factors.length, 0);
  const deletes = f.calls.filter(c => c.method === "DELETE");
  assert.deepEqual(deletes, [{path: `/auth/v1/factors/${FACTOR}`, method: "DELETE"}]);
  const deletion = f.calls.indexOf(deletes[0]);
  assert.equal(f.calls[deletion - 1].path, "/auth/v1/user", "authoritative factor check immediately before deletion");
  assert.equal(f.calls.slice(deletion + 1).find(c => !c.path.endsWith("/jwks.json")).path, "/auth/v1/user", "readback after deletion, including JWT verification");
  assert.ok(f.queries.length >= 4, "owner D1 account rechecked before mutation and after it");
  assert.equal(f.calls.some(c => c.method === "POST"), false, "reset itself neither verifies nor enrolls");
  assert.equal((await f.handler(restartRequest(cookie), f.env)).status, 409, "same operation cannot delete another factor");
  f.state.time = NOW + 10;
  f.state.factors = [pendingFactor({created_at: new Date((NOW + 1) * 1000).toISOString()})];
  assert.equal((await f.handler(restartRequest(cookie), f.env)).status, 409, "new QR enrollment is outside approval cutoff");
  assert.equal(f.calls.filter(c => c.method === "DELETE").length, 1);
});

test("pending restart refuses any verified factor, AAL2, multiple/malformed factors and uncertain creation time", async t => {
  const f = await fixture(t), cookie = await f.cookie(); enablePendingRestart(f);
  for (const factors of [
    [pendingFactor({status:"verified"})],
    [pendingFactor(), {id:OTHER_FACTOR, factor_type:"phone", status:"verified"}],
    [pendingFactor(), {id:OTHER_FACTOR, factor_type:"webauthn", status:"verified"}],
    [...Array.from({length:21}, (_, i) => pendingFactor({id:`${String(i).padStart(8,"0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`})), {id:OTHER_FACTOR, factor_type:"totp", status:"verified"}],
    [pendingFactor(), pendingFactor({id:OTHER_FACTOR})], [pendingFactor({created_at:null})],
    [pendingFactor({created_at:"invalid"})], [pendingFactor({factor_type:"phone"})],
    [pendingFactor(), {id:"invalid", factor_type:"totp", status:"unverified"}], [], null
  ]) {
    f.state.factors = factors;
    assert.equal((await f.handler(restartRequest(cookie), f.env)).status, 409);
  }
  f.state.factors = [pendingFactor()];
  assert.equal((await f.handler(restartRequest(await f.cookie("owner-subject", "aal2")), f.env)).status, 409);
  assert.equal(f.calls.some(c => c.method === "DELETE"), false);
});

test("restart is exact-host/owner/CSRF/expiry gated even if staging flags are copied to production", async t => {
  const f = await fixture(t), cookie = await f.cookie(); enablePendingRestart(f);
  f.state.factors = [pendingFactor()];
  assert.equal((await f.handler(restartRequest(""), f.env)).status, 401);
  assert.equal((await f.handler(restartRequest(await f.cookie("other-subject")), f.env)).status, 403);
  assert.equal((await f.handler(restartRequest(cookie, {site:"cross-site", origin:"https://evil.example"}), f.env)).status, 403);
  assert.equal((await f.handler(restartRequest(cookie, {body:{factor_id:OTHER_FACTOR}}), f.env)).status, 409);
  assert.equal((await f.handler(restartRequest(cookie, {body:{factor_id:FACTOR, user_id:"account-owner"}}), f.env)).status, 409);
  assert.equal((await f.handler(restartRequest(cookie, {target:ORIGIN, origin:ORIGIN}), f.env)).status, 404);
  f.env.REXBID_OWNER_MFA_PENDING_RESTART = "disabled";
  assert.equal((await f.handler(restartRequest(cookie), f.env)).status, 404);
  f.env.REXBID_OWNER_MFA_PENDING_RESTART = "enabled";
  f.state.time = NOW + 86401;
  assert.equal((await f.handler(restartRequest(cookie), f.env)).status, 404);
  assert.equal(f.calls.some(c => c.method === "DELETE"), false);
});

test("factor verified during either pre-delete recheck aborts pending restart without mutation", async t => {
  for (const changedOnRead of [2,3]) {
    const f = await fixture(t), cookie = await f.cookie(); enablePendingRestart(f);
    f.state.factors = [pendingFactor()];
    f.state.onUserRead = n => { if (n === changedOnRead) f.state.factors[0].status = "verified"; };
    assert.equal((await f.handler(restartRequest(cookie), f.env)).status, 409);
    assert.equal(f.calls.some(c => c.method === "DELETE"), false);
    assert.equal(f.state.factors[0].status, "verified");
  }
});

test("failed unenrollment is not retried and never triggers a new QR enrollment", async t => {
  const f = await fixture(t), cookie = await f.cookie(); enablePendingRestart(f);
  f.state.factors = [pendingFactor()]; f.state.deleteStatus = 500;
  const result = await f.handler(restartRequest(cookie), f.env);
  assert.equal(result.status, 503);
  assert.equal(f.state.factors.length, 1);
  assert.equal(f.calls.filter(c => c.method === "DELETE").length, 1);
  assert.equal(f.calls.some(c => c.method === "POST"), false);
  assert.doesNotMatch(await result.text(), /secret|token|email|ABCDEFGHIJKLMNOP/);
});
