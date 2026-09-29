const { createRexIdentity } = require("./identity.js");
const {
  clearFlowCookie, clearSessionCookie, flowCookie, flowCookieName, isSameOriginWrite,
  openCookiePayload, readCookie, safeReturnPath, sessionCookie, sessionCookieMaxAge,
  sessionCookieName, sealCookiePayload, callbackDiagnosticCookie, callbackDiagnosticCookieName, clearCallbackDiagnosticCookie
} = require("./session.js");

const jsonHeaders = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "private, no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };
const AUTH_PREFIX = "/api/auth/";
const CALLBACK_DIAGNOSTIC_PATH = `${AUTH_PREFIX}callback-diagnostic`;
const FAVORITES_PATH = "/api/me/favorites";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MERGE_ITEMS = 100;
const nowSeconds = () => Math.floor(Date.now() / 1000);
// A Worker isolate may serve /api/me and favorites concurrently. Share one
// refresh promise per opaque token inside that isolate; never log/map the key.
const refreshFlights = new Map();

function reply(data, status = 200, cookies = []) {
  const headers = new Headers(jsonHeaders);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}
function redirect(location, cookies = []) {
  const headers = new Headers({ "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "Location": location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
function cookieSecret(env) { return env?.REXBID_AUTH_COOKIE_SECRET; }
function configured(env, requestUrl) {
  if (env?.AUTH_ENABLED !== "true" || typeof env?.REXBID_AUTH_COOKIE_SECRET !== "string" || env.REXBID_AUTH_COOKIE_SECRET.length < 43
    || typeof env?.SUPABASE_URL !== "string" || typeof env?.SUPABASE_PUBLISHABLE_KEY !== "string" || !env.SUPABASE_PUBLISHABLE_KEY.trim() || !env?.REXBID_DB
    || env?.AUTH_D1_SCHEMA_VERSION !== "0003") return false;
  let canonical;
  try {
    const supabase = new URL(env.SUPABASE_URL);
    if (supabase.protocol !== "https:" || supabase.username || supabase.password || supabase.pathname !== "/" || supabase.search || supabase.hash) return false;
    canonical = new URL(env.AUTH_CANONICAL_ORIGIN);
    if (canonical.protocol !== "https:" || canonical.origin !== env.AUTH_CANONICAL_ORIGIN || canonical.username || canonical.password || canonical.pathname !== "/") return false;
    const origins = String(env.AUTH_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
    if (!origins.includes(canonical.origin) || !origins.every(value => { try { const parsed = new URL(value); return parsed.protocol === "https:" && parsed.origin === value && !parsed.username && !parsed.password && parsed.pathname === "/"; } catch { return false; } })) return false;
    if (requestUrl && new URL(requestUrl).origin !== canonical.origin) return false;
  } catch { return false; }
  if (env.AUTH_RATE_LIMITING_MODE === "cloudflare") return !!env.AUTH_RATE_LIMITER && typeof env.AUTH_RATE_LIMITER.limit === "function";
  if (env.AUTH_RATE_LIMITING_MODE === "staging-bypass") {
    return env.REXBID_AUTH_TEST_UI === "enabled" && env.REXBID_AUTH_TEST_HOST === AUTH_TEST_HOST && canonical.hostname === AUTH_TEST_HOST;
  }
  return false;
}
const AUTH_TEST_HOST = "rexbid-auth-test.tedn828.workers.dev";
const SAFE_AUTH_ERROR_CODES = new Set([
  "AUTH_TIMEOUT", "AUTH_UNAVAILABLE", "AUTH_UNEXPECTED_REDIRECT", "AUTH_REJECTED",
  "AUTH_RATE_LIMITED", "INVALID_SESSION", "INVALID_IDENTITY", "INVALID_TOKEN",
  "SESSION_COOKIE_TOO_LARGE"
]);
function logStagingAuthRoute(request, env, fields) {
  if (!stagingCallbackDiagnosticsEnabled(request, env)) return;
  const requestId = request.headers.get("X-RexBid-Request-ID") || "";
  console.info("Rex.Bid staging auth route", JSON.stringify({ ...fields, ...( /^[0-9a-f-]{36}$/i.test(requestId) ? { request_id: requestId } : {}) }));
}
function stagingCallbackDiagnosticsEnabled(request, env) {
  if (env?.REXBID_AUTH_DIAGNOSTICS !== "enabled"
    || env?.REXBID_AUTH_TEST_UI !== "enabled"
    || env?.REXBID_AUTH_TEST_HOST !== AUTH_TEST_HOST) return false;
  let hostname = "";
  try { hostname = new URL(request.url).hostname; } catch { return false; }
  return hostname === AUTH_TEST_HOST;
}
function safeAuthError(error) {
  return SAFE_AUTH_ERROR_CODES.has(error?.code) ? error.code : "unexpected_error";
}
async function allowAuthRequest(env, request, operation, scope = "ip") {
  if (env?.AUTH_RATE_LIMITING_MODE === "staging-bypass"
    && env?.REXBID_AUTH_TEST_UI === "enabled"
    && env?.REXBID_AUTH_TEST_HOST === AUTH_TEST_HOST) return true;
  const limiter = env?.AUTH_RATE_LIMITER;
  if (env?.AUTH_RATE_LIMITING_MODE !== "cloudflare" || typeof limiter?.limit !== "function") return false;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  try {
    const key = scope.startsWith("user:") ? `${operation}:${scope}` : `${operation}:ip:${ip}`;
    const result = await limiter.limit({ key });
    return result?.success === true;
  } catch { return false; }
}
function randomB64Url(cryptoImpl, bytes = 32) {
  const data = cryptoImpl.getRandomValues(new Uint8Array(bytes));
  let binary = ""; for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function pkceChallenge(verifier, cryptoImpl) {
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = ""; for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function safeEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
function safePassword(value) { return typeof value === "string" && value.length >= 8 && value.length <= 1024 ? value : ""; }

async function readJson(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return null;
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch { return null; }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(merged);
  try { const value = JSON.parse(text); return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
  catch { return null; }
}

function favoriteInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const vin = typeof input.vin === "string" ? input.vin.trim().toUpperCase() : "";
  const lot = typeof input.lot === "string" ? input.lot.trim().toUpperCase() : "";
  const platform = typeof input.platform === "string" ? input.platform.trim().toLowerCase() : "";
  if (vin && !/^[A-Z0-9-]{1,64}$/.test(vin)) return null;
  if (lot && !/^[A-Z0-9-]{1,80}$/.test(lot)) return null;
  if (platform && !/^[a-z0-9_-]{1,40}$/.test(platform)) return null;
  if (!vin && !(lot && platform)) return null;
  return { favorite_key: vin ? `vin:${vin}` : `lot:${platform}:${lot}`, vin: vin || null, lot: lot || null, platform: platform || null };
}

function validFavoriteKey(value) {
  if (typeof value !== "string" || value.length > 140) return false;
  return /^vin:[A-Z0-9-]{1,64}$/.test(value) || /^lot:[a-z0-9_-]{1,40}:[A-Z0-9-]{1,80}$/.test(value);
}

async function resolveSession(request, env, provider, { cryptoImpl, now }) {
  const rawCookie = readCookie(request, sessionCookieName);
  if (!rawCookie) {
    logStagingAuthRoute(request, env, { operation: "session_resolve", stage: "cookie", outcome: "missing", cookie_present: false });
    return { identity: null, session: null, cookies: [] };
  }
  let session = await openCookiePayload(rawCookie, cookieSecret(env), cryptoImpl);
  if (!session || typeof session.access_token !== "string" || typeof session.refresh_token !== "string" || !Number.isFinite(session.expires_at)) {
    logStagingAuthRoute(request, env, { operation: "session_resolve", stage: "cookie", outcome: "invalid", cookie_present: true });
    return { identity: null, session: null, cookies: [clearSessionCookie()] };
  }
  let cookieUpdate = null;
  if (session.expires_at <= now() + 45) {
    try {
      session = await refreshOnce(env, session, provider);
      cookieUpdate = await sessionCookieFor(session, env, cryptoImpl);
      logStagingAuthRoute(request, env, { operation: "session_resolve", stage: "refresh", outcome: "success", cookie_present: true, session_cookie_rotated: true });
    } catch (error) {
      logStagingAuthRoute(request, env, { operation: "session_resolve", stage: "refresh", outcome: "failure", cookie_present: true, upstream_status: Number.isInteger(error?.status) ? error.status : null, safe_error_code: safeAuthError(error) });
      // A competing tab/isolate can win refresh-token rotation. Verify the old
      // access token before clearing anything; transient/ambiguous failures
      // preserve a still-valid session and never emit a clearing cookie.
      try {
        const identity = await provider.verifyIdentity(env, session.access_token);
        if (identity.email_verified && session.expires_at > now()) return { identity, session, cookies: [] };
      } catch (verifyError) {
        if (verifyError?.status >= 500 || verifyError?.code === "AUTH_UNAVAILABLE" || verifyError?.code === "AUTH_TIMEOUT") return { identity: null, session: null, cookies: [], unavailable: true };
      }
      if (error?.status >= 500 || error?.code === "AUTH_UNAVAILABLE" || error?.code === "AUTH_TIMEOUT") return { identity: null, session: null, cookies: [], unavailable: true };
      return { identity: null, session: null, cookies: [clearSessionCookie()] };
    }
  }
  try {
    const identity = await provider.verifyIdentity(env, session.access_token);
    if (!identity.email_verified) {
      logStagingAuthRoute(request, env, { operation: "session_resolve", stage: "identity", outcome: "email_unverified", cookie_present: true });
      return { identity: null, session: null, cookies: [clearSessionCookie()] };
    }
    logStagingAuthRoute(request, env, { operation: "session_resolve", stage: "identity", outcome: "verified", cookie_present: true, email_verified: true });
    return { identity, session, cookies: cookieUpdate ? [cookieUpdate] : [] };
  } catch (error) {
    logStagingAuthRoute(request, env, { operation: "session_resolve", stage: "identity", outcome: "failure", cookie_present: true, upstream_status: Number.isInteger(error?.status) ? error.status : null, safe_error_code: safeAuthError(error) });
    if (error?.status >= 500) return { identity: null, session: null, cookies: [], unavailable: true };
    return { identity: null, session: null, cookies: [clearSessionCookie()] };
  }
}

async function refreshOnce(env, session, provider) {
  const key = session.refresh_token;
  let current = refreshFlights.get(key);
  if (!current) {
    current = Promise.resolve().then(() => provider.refresh(env, session));
    refreshFlights.set(key, current);
  }
  try { return await current; }
  finally { if (refreshFlights.get(key) === current) refreshFlights.delete(key); }
}

async function sessionCookieFor(session, env, cryptoImpl) {
  const value = await sealCookiePayload(session, cookieSecret(env), cryptoImpl);
  if (value.length > 3800) throw new Error("SESSION_COOKIE_TOO_LARGE");
  return sessionCookie(value, sessionCookieMaxAge);
}

async function upsertAccount(db, identity, cryptoImpl) {
  const id = cryptoImpl.randomUUID();
  const now = new Date().toISOString();
  const row = await db.prepare(`
    INSERT INTO users (id, auth_issuer, auth_subject, auth_provider, email_verified, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(auth_issuer, auth_subject) DO UPDATE SET
      auth_provider = excluded.auth_provider,
      email_verified = 1,
      updated_at = excluded.updated_at
    RETURNING id, auth_provider, email_verified, created_at
  `).bind(id, identity.issuer, identity.subject, identity.auth_provider, now, now).first();
  if (!row) throw new Error("ACCOUNT_NOT_AVAILABLE");
  return row;
}

async function findAccount(db, identity) {
  return db.prepare("SELECT id, auth_provider, email_verified, created_at FROM users WHERE auth_issuer = ? AND auth_subject = ?")
    .bind(identity.issuer, identity.subject).first();
}

async function insertFavorite(db, userId, item) {
  await db.prepare(`
    INSERT INTO user_favorites (user_id, favorite_key, vin, lot, platform, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, favorite_key) DO NOTHING
  `).bind(userId, item.favorite_key, item.vin, item.lot, item.platform, new Date().toISOString(), new Date().toISOString()).run();
}

function accountDb(env) { return env?.REXBID_DB || null; }

function createAccountsHandler({ provider, cryptoImpl = globalThis.crypto, now = nowSeconds } = {}) {
  if (!provider || typeof provider.verifyIdentity !== "function") throw new TypeError("An auth provider is required");

  async function finishSession(request, env, session, returnPath = "/konto.html", operation = "session") {
    const cookie = await sessionCookieFor(session, env, cryptoImpl);
    logStagingAuthRoute(request, env, { operation, stage: "identity_verification", outcome: "started", session_received: true });
    let identity;
    try { identity = await provider.verifyIdentity(env, session.access_token); }
    catch (error) {
      logStagingAuthRoute(request, env, { operation, stage: "identity_verification", outcome: "failure", safe_error_code: safeAuthError(error), upstream_status: Number.isInteger(error?.status) ? error.status : null });
      throw error;
    }
    logStagingAuthRoute(request, env, { operation, stage: "identity_verification", outcome: identity.email_verified ? "verified" : "email_unverified", email_verified: !!identity.email_verified });
    if (!identity.email_verified) return reply({ ok: false, error: "Potwierdź adres e-mail, aby korzystać z konta." }, 403, [clearSessionCookie()]);
    const db = accountDb(env);
    if (!db) {
      logStagingAuthRoute(request, env, { operation, stage: "account_persistence", outcome: "database_unavailable" });
      return reply({ ok: false, error: "Konta są chwilowo niedostępne." }, 503, [clearSessionCookie()]);
    }
    const user = await upsertAccount(db, createRexIdentity(identity), cryptoImpl);
    const response = reply({ ok: true, user: { id: user.id, auth_provider: user.auth_provider, email_verified: !!user.email_verified } }, 200, [cookie]);
    logStagingAuthRoute(request, env, { operation, stage: "session_cookie", outcome: "created", session_cookie_created: true, response_status: response.status });
    return response;
  }

  async function handle(request, env) {
    const url = new URL(request.url);
    const stagingDiagnostics = stagingCallbackDiagnosticsEnabled(request, env);
    if (url.pathname === CALLBACK_DIAGNOSTIC_PATH && !stagingDiagnostics) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (url.pathname === `${AUTH_PREFIX}config` && request.method === "GET") return reply({ ok: true, enabled: configured(env, request.url) }, 200);
    if (!url.pathname.startsWith(AUTH_PREFIX) && url.pathname !== "/api/me" && url.pathname !== "/api/me/export" && url.pathname !== FAVORITES_PATH && !url.pathname.startsWith(`${FAVORITES_PATH}/`)) return null;
    if (!configured(env, request.url)) return reply({ ok: false, error: "Uwierzytelnianie nie jest skonfigurowane." }, 503);
    if (request.method === "OPTIONS") return reply({ ok: false, error: "Metoda niedozwolona." }, 405);

    const path = url.pathname;
    const method = request.method.toUpperCase();
    if (path === CALLBACK_DIAGNOSTIC_PATH) {
      if (method !== "GET") return reply({ ok: false, error: "Metoda niedozwolona." }, 405);
      if ((request.headers.get("Sec-Fetch-Site") || "same-origin") !== "same-origin") return reply({ ok: false, error: "Żądanie odrzucone." }, 403);
      const id = url.searchParams.get("id") || "";
      const receipt = await openCookiePayload(readCookie(request, callbackDiagnosticCookieName), cookieSecret(env), cryptoImpl);
      if (!/^[A-Za-z0-9_-]{16}$/.test(id) || !receipt || receipt.id !== id || receipt.expires_at <= now()) return reply({ ok: false, error: "Brak diagnostyki callbacku." }, 404);
      const diagnostic = {
        id: receipt.id, flow_type: receipt.flow_type, state_present: receipt.state_present === true,
        state_valid: receipt.state_valid === true, flow_cookie_present: receipt.flow_cookie_present === true,
        verifier_present: receipt.verifier_present === true, code_present: receipt.code_present === true,
        exchange_attempted: receipt.exchange_attempted === true,
        upstream_status: Number.isInteger(receipt.upstream_status) ? receipt.upstream_status : null,
        safe_error_code: typeof receipt.safe_error_code === "string" ? receipt.safe_error_code : null,
        identity_verified: receipt.identity_verified === true, session_created: receipt.session_created === true,
        final_redirect_target: receipt.final_redirect_target, failure_stage: receipt.failure_stage || null
      };
      return reply({ ok: true, diagnostic }, 200, [clearCallbackDiagnosticCookie()]);
    }
    const write = method !== "GET";
    if (write && (!isSameOriginWrite(request) || (request.headers.get("Sec-Fetch-Site") && request.headers.get("Sec-Fetch-Site") !== "same-origin"))) return reply({ ok: false, error: "Żądanie odrzucone." }, 403);
    const limitedOperation = path === `${AUTH_PREFIX}signup` ? "signup"
      : path === `${AUTH_PREFIX}login` ? "login"
      : path === `${AUTH_PREFIX}recovery` ? "recovery"
      : path === `${AUTH_PREFIX}resend-confirmation` ? "resend_confirmation"
      : path === `${AUTH_PREFIX}callback` ? "callback"
      : path === `${AUTH_PREFIX}refresh` ? "refresh"
      : path === `${AUTH_PREFIX}logout` ? "logout"
      : path === "/api/me" && method === "GET" ? "session_read"
      : path === "/api/me/export" && method === "GET" ? "account_export"
      : path === FAVORITES_PATH && method === "GET" ? "favorites_read" : "";
    if (limitedOperation && !await allowAuthRequest(env, request, limitedOperation)) return reply({ ok: false, error: "Zbyt wiele prób. Spróbuj ponownie później." }, 429);

    if (path === `${AUTH_PREFIX}google` && method === "GET") {
      try {
        const state = randomB64Url(cryptoImpl);
        const verifier = randomB64Url(cryptoImpl, 48);
        const challenge = await pkceChallenge(verifier, cryptoImpl);
        const returnPath = safeReturnPath(url.searchParams.get("return_to"));
        const callback = new URL("/api/auth/callback", url.origin);
        callback.searchParams.set("state", state);
        const flow = await sealCookiePayload({ state, verifier, return_path: returnPath, expires_at: now() + 600 }, cookieSecret(env), cryptoImpl);
        const location = provider.oauthUrl(env, { redirectTo: callback.href, codeChallenge: challenge });
        return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": flowCookie(flow) } });
      } catch { return reply({ ok: false, error: "Logowanie jest chwilowo niedostępne." }, 503); }
    }

    if (path === `${AUTH_PREFIX}callback` && method === "GET") {
      const flowText = readCookie(request, flowCookieName);
      const flow = await openCookiePayload(flowText, cookieSecret(env), cryptoImpl);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const callbackId = randomB64Url(cryptoImpl, 12);
      const callbackType = url.searchParams.get("type");
      const flowKind = flow?.purpose === "recovery" ? "recovery"
        : flow?.purpose === "confirmation" ? "confirmation"
        : callbackType === "recovery" ? "recovery"
        : callbackType === "signup" ? "confirmation"
        : flow ? "other" : "unknown";
      const diagnostic = {
        id: callbackId, flow_type: flowKind, state_present: !!state,
        state_valid: !!flow && flow.expires_at > now() && !!state && state === flow.state,
        flow_cookie_present: !!flowText, verifier_present: !!flow?.verifier, code_present: !!code,
        exchange_attempted: false, upstream_status: null, safe_error_code: null,
        identity_verified: false, session_created: false, final_redirect_target: null, failure_stage: null,
        expires_at: now() + 300
      };
      const callbackRedirect = async (location, cookies = []) => {
        const safeLocation = safeReturnPath(location);
        const target = new URL(safeLocation, url.origin);
        diagnostic.final_redirect_target = `${target.pathname}${target.search}`;
        if (stagingDiagnostics) {
          const sealed = await sealCookiePayload(diagnostic, cookieSecret(env), cryptoImpl);
          target.searchParams.set("cbdiag", callbackId);
          cookies.push(callbackDiagnosticCookie(sealed, 300));
        }
        return redirect(`${target.pathname}${target.search}${target.hash}`, cookies);
      };
      const callbackFacts = {
        operation: "callback", callback_id: callbackId, flow_kind: flowKind, stage: "validation", flow_cookie_present: !!flowText,
        flow_valid: !!flow, code_present: !!code, state_present: !!state,
        state_matches: !!flow && state === flow.state,
        verifier_present: !!flow?.verifier,
        flow_expired: !!flow && flow.expires_at <= now(),
        token_in_url: url.searchParams.has("access_token") || url.searchParams.has("refresh_token")
      };
      logStagingAuthRoute(request, env, callbackFacts);
      if (!flow || flow.expires_at <= now() || !code || code.length > 2048 || state !== flow.state || url.searchParams.has("access_token") || url.searchParams.has("refresh_token")) {
        const reason = !flowText ? "flow_cookie_missing" : !flow ? "flow_cookie_invalid" : flow.expires_at <= now() ? "flow_expired" : !code || code.length > 2048 ? "code_missing_or_invalid" : state !== flow.state ? "state_mismatch" : "token_in_url";
        logStagingAuthRoute(request, env, { operation: "callback", callback_id: callbackId, flow_kind: flowKind, stage: "validation", outcome: "rejected", reason });
        diagnostic.failure_stage = "validation";
        diagnostic.safe_error_code = `callback_${reason}`;
        return callbackRedirect("/logowanie.html?auth=failed", [clearFlowCookie(), clearSessionCookie()]);
      }
      let callbackStage = "code_exchange";
      try {
        diagnostic.exchange_attempted = true;
        logStagingAuthRoute(request, env, { operation: "callback", callback_id: callbackId, flow_kind: flowKind, stage: callbackStage, outcome: "started", verifier_present: !!flow.verifier });
        let session;
        if (typeof provider.exchangeCodeWithStatus === "function") {
          const exchanged = await provider.exchangeCodeWithStatus(env, { code, codeVerifier: flow.verifier });
          session = exchanged?.session;
          diagnostic.upstream_status = Number.isInteger(exchanged?.upstream_status) ? exchanged.upstream_status : null;
        } else {
          session = await provider.exchangeCode(env, { code, codeVerifier: flow.verifier });
        }
        diagnostic.session_created = !!session?.access_token && !!session?.refresh_token;
        logStagingAuthRoute(request, env, { operation: "callback", callback_id: callbackId, flow_kind: flowKind, stage: callbackStage, outcome: "success", session_received: !!session?.access_token && !!session?.refresh_token });
        callbackStage = "identity_verification";
        const verified = await provider.verifyIdentity(env, session.access_token);
        diagnostic.identity_verified = true;
        if (!verified.email_verified) {
          logStagingAuthRoute(request, env, { operation: "callback", callback_id: callbackId, flow_kind: flowKind, stage: callbackStage, outcome: "email_unverified" });
          diagnostic.failure_stage = callbackStage;
          diagnostic.safe_error_code = "email_unverified";
          return callbackRedirect("/logowanie.html?auth=verify-email", [clearFlowCookie(), clearSessionCookie()]);
        }
        logStagingAuthRoute(request, env, { operation: "callback", callback_id: callbackId, flow_kind: flowKind, stage: callbackStage, outcome: "success", email_verified: true });
        callbackStage = "account_persistence";
        if (!accountDb(env)) {
          logStagingAuthRoute(request, env, { operation: "callback", callback_id: callbackId, flow_kind: flowKind, stage: callbackStage, outcome: "database_unavailable" });
          diagnostic.failure_stage = callbackStage;
          diagnostic.safe_error_code = "account_database_unavailable";
          return callbackRedirect("/logowanie.html?auth=unavailable", [clearFlowCookie(), clearSessionCookie()]);
        }
        await upsertAccount(accountDb(env), createRexIdentity(verified), cryptoImpl);
        callbackStage = "session_cookie";
        const value = await sealCookiePayload(session, cookieSecret(env), cryptoImpl);
        if (value.length > 3800) throw new Error("SESSION_COOKIE_TOO_LARGE");
        const callbackReturnPath = flow.purpose === "recovery" ? "/reset-hasla.html?recovery=ready" : flow.return_path;
        const response = await callbackRedirect(callbackReturnPath, [sessionCookie(value), clearFlowCookie()]);
        logStagingAuthRoute(request, env, { operation: "callback", callback_id: callbackId, flow_kind: flowKind, stage: callbackStage, outcome: "created", session_cookie_created: true, response_status: response.status });
        return response;
      } catch (error) {
        logStagingAuthRoute(request, env, { operation: "callback", callback_id: callbackId, flow_kind: flowKind, stage: callbackStage, outcome: "failure", safe_error_code: safeAuthError(error), upstream_status: Number.isInteger(error?.status) ? error.status : Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null });
        diagnostic.failure_stage = callbackStage;
        diagnostic.safe_error_code = safeAuthError(error);
        if (!Number.isInteger(diagnostic.upstream_status)) diagnostic.upstream_status = Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null;
        else if (Number.isInteger(error?.upstreamStatus)) diagnostic.upstream_status = error.upstreamStatus;
        return callbackRedirect("/logowanie.html?auth=failed", [clearFlowCookie(), clearSessionCookie()]);
      }
    }

    if (path === `${AUTH_PREFIX}signup` && method === "POST") {
      const body = await readJson(request), email = safeEmail(body?.email), password = safePassword(body?.password);
      if (!email || !password || Object.hasOwn(body || {}, "user_id")) return reply({ ok: false, error: "Sprawdź dane rejestracji." }, 400);
      try {
        const verifier = randomB64Url(cryptoImpl, 48), state = randomB64Url(cryptoImpl), challenge = await pkceChallenge(verifier, cryptoImpl);
        const callback = new URL("/api/auth/callback", url.origin); callback.searchParams.set("state", state);
        const flow = await sealCookiePayload({ state, verifier, return_path: "/konto.html", expires_at: now() + 86400 }, cookieSecret(env), cryptoImpl);
        logStagingAuthRoute(request, env, { operation: "signup", stage: "upstream_request", outcome: "started" });
        const result = await provider.signup(env, { email, password, redirectTo: callback.href, codeChallenge: challenge });
        logStagingAuthRoute(request, env, { operation: "signup", stage: "upstream_response", outcome: "success", session_received: !!result.session });
        if (result.session) return await finishSession(request, env, result.session, "/konto.html", "signup");
        logStagingAuthRoute(request, env, { operation: "signup", stage: "complete", outcome: "confirmation_required" });
        return reply({ ok: true, confirmation_required: true, message: "Jeśli można utworzyć konto, wyślemy wiadomość z potwierdzeniem." }, 202, [flowCookie(flow, 86400)]);
      } catch (error) {
        logStagingAuthRoute(request, env, { operation: "signup", stage: "upstream_or_session", outcome: "failure", safe_error_code: safeAuthError(error), upstream_status: Number.isInteger(error?.status) ? error.status : Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null });
        if (error?.status === 401) return reply({ ok:true, confirmation_required:true, message:"Jeśli można utworzyć konto, wyślemy wiadomość z potwierdzeniem." }, 202, [clearFlowCookie()]);
        return reply({ ok: false, error: "Rejestracja jest chwilowo niedostępna." }, 503);
      }
    }

    if ([`${AUTH_PREFIX}recovery`, `${AUTH_PREFIX}resend-confirmation`].includes(path) && method === "POST") {
      const body = await readJson(request), email = safeEmail(body?.email);
      if (!email || Object.hasOwn(body || {}, "user_id")) return reply({ ok:false, error:"Jeśli adres jest powiązany z kontem, wyślemy wiadomość." }, 202);
      let encryptedFlow = "";
      try {
        const verifier = randomB64Url(cryptoImpl, 48), state = randomB64Url(cryptoImpl), challenge = await pkceChallenge(verifier, cryptoImpl);
        const callback = new URL(`${AUTH_PREFIX}callback`, env.AUTH_CANONICAL_ORIGIN); callback.searchParams.set("state", state);
        const isRecovery = path.endsWith("/recovery");
        const flow = await sealCookiePayload({ state, verifier, purpose:isRecovery ? "recovery" : "confirmation", return_path:isRecovery ? "/reset-hasla.html" : "/konto.html", expires_at:now() + 3600 }, cookieSecret(env), cryptoImpl);
        encryptedFlow = flow;
        const operation = path.endsWith("/recovery") ? "requestPasswordReset" : "resendConfirmation";
        if (typeof provider[operation] === "function") await provider[operation](env, { email, redirectTo:callback.href, codeChallenge:challenge });
      } catch { /* Neutral success prevents account enumeration, including provider-side rejection. */ }
      return reply({ ok:true, message:"Jeśli adres jest powiązany z kontem, wyślemy wiadomość." }, 202, encryptedFlow ? [flowCookie(encryptedFlow, 3600)] : [clearFlowCookie()]);
    }

    if (path === `${AUTH_PREFIX}login` && method === "POST") {
      const body = await readJson(request), email = safeEmail(body?.email), password = safePassword(body?.password);
      if (!email || !password || Object.hasOwn(body || {}, "user_id")) return reply({ ok: false, error: "Nieprawidłowy e-mail lub hasło." }, 401);
      logStagingAuthRoute(request, env, { operation: "login", stage: "upstream_request", outcome: "started" });
      try {
        const session = await provider.login(env, { email, password });
        logStagingAuthRoute(request, env, { operation: "login", stage: "upstream_response", outcome: "success", session_received: !!session?.access_token && !!session?.refresh_token });
        return await finishSession(request, env, session, "/konto.html", "login");
      } catch (error) {
        logStagingAuthRoute(request, env, { operation: "login", stage: "upstream_or_session", outcome: "failure", safe_error_code: safeAuthError(error), upstream_status: Number.isInteger(error?.status) ? error.status : Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null });
        return reply({ ok: false, error: error?.status === 401 ? "Nieprawidłowy e-mail lub hasło." : "Logowanie jest chwilowo niedostępne." }, error?.status === 401 ? 401 : 503);
      }
    }

    if (path === `${AUTH_PREFIX}logout` && method === "POST") {
      const state = await resolveSession(request, env, provider, { cryptoImpl, now });
      try { if (state.session) await provider.logout(env, state.session.access_token); } catch { /* local cookie invalidation still logs out this browser */ }
      const response = reply({ ok: true }, 200, [clearSessionCookie(), clearFlowCookie()]);
      logStagingAuthRoute(request, env, { operation: "logout", stage: "complete", outcome: "session_cleared", session_present: !!state.session, response_status: response.status });
      return response;
    }

    if (path === `${AUTH_PREFIX}refresh` && method === "POST") {
      const state = await resolveSession(request, env, provider, { cryptoImpl, now });
      logStagingAuthRoute(request, env, { operation: "refresh_endpoint", stage: "complete", outcome: state.unavailable ? "provider_unavailable" : state.identity ? "authenticated" : "anonymous", session_cookie_update: state.cookies.some(value => value.startsWith(`${sessionCookieName}=`) && !value.includes("Max-Age=0")) });
      if (state.unavailable) return reply({ ok: false, error: "Usługa logowania jest chwilowo niedostępna." }, 503);
      if (!state.identity) return reply({ ok: false, error: "Sesja wygasła." }, 401, state.cookies);
      return reply({ ok: true }, 200, state.cookies);
    }

    if (method !== "GET" && method !== "POST" && method !== "DELETE") return reply({ ok: false, error: "Metoda niedozwolona." }, 405);
    const auth = await resolveSession(request, env, provider, { cryptoImpl, now });
    if (auth.unavailable) return reply({ ok: false, error: "Usługa logowania jest chwilowo niedostępna." }, 503);
    if (!auth.identity) return reply({ ok: false, error: "Wymagane logowanie." }, 401, auth.cookies);
    const db = accountDb(env);
    if (!db) return reply({ ok: false, error: "Konta są chwilowo niedostępne." }, 503, auth.cookies);
    const user = await findAccount(db, auth.identity);
    if (!user) return reply({ ok: false, error: "Konto nie jest dostępne." }, 401, [...auth.cookies, clearSessionCookie()]);

    if (write && (path === FAVORITES_PATH || path.startsWith(`${FAVORITES_PATH}/`) || path === `${AUTH_PREFIX}password`)) {
      const operation = path === `${AUTH_PREFIX}password` ? "password_update" : "favorites";
      if (!await allowAuthRequest(env, request, operation, `user:${user.id}`)) return reply({ ok:false, error:"Zbyt wiele prób. Spróbuj ponownie później." }, 429, auth.cookies);
    }

    if (path === `${AUTH_PREFIX}password` && method === "POST") {
      const body = await readJson(request), password = safePassword(body?.password);
      if (!password || Object.hasOwn(body || {}, "user_id")) return reply({ ok:false, error:"Hasło nie spełnia wymagań." }, 400, auth.cookies);
      if (typeof provider.updatePassword !== "function") return reply({ ok:false, error:"Zmiana hasła jest chwilowo niedostępna." }, 503, auth.cookies);
      try {
        await provider.updatePassword(env, auth.session.access_token, password);
        let sessionsRevoked = false;
        try { await provider.logout(env, auth.session.access_token, "global"); sessionsRevoked = true; } catch { /* report local logout; provider may not revoke other sessions */ }
        return reply({ ok:true, other_sessions_revoked:sessionsRevoked }, 200, [clearSessionCookie(), clearFlowCookie()]);
      } catch { return reply({ ok:false, error:"Nie udało się zmienić hasła. Spróbuj ponownie." }, 400, auth.cookies); }
    }

    if (path === "/api/me" && method === "GET") return reply({ ok: true, user: { id: user.id, auth_provider: user.auth_provider, email_verified: !!user.email_verified, created_at: user.created_at } }, 200, auth.cookies);
    if (path === "/api/me/export" && method === "GET") {
      const rows = await db.prepare("SELECT favorite_key, vin, lot, platform, created_at, updated_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all();
      return reply({ ok:true, exported_at:new Date().toISOString(), profile:{ id:user.id, auth_provider:user.auth_provider, email_verified:!!user.email_verified, created_at:user.created_at }, favorites:(rows?.results || []).map(row => ({ key:row.favorite_key, vin:row.vin, lot:row.lot, platform:row.platform, created_at:row.created_at, updated_at:row.updated_at })) }, 200, auth.cookies);
    }
    if (path === FAVORITES_PATH && method === "GET") {
      const rows = await db.prepare("SELECT favorite_key, vin, lot, platform, created_at, updated_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC")
        .bind(user.id).all();
      return reply({ ok: true, favorites: (rows?.results || []).map(row => ({ key: row.favorite_key, vin: row.vin, lot: row.lot, platform: row.platform, created_at: row.created_at, updated_at: row.updated_at })) }, 200, auth.cookies);
    }
    if (path === FAVORITES_PATH && method === "POST") {
      const body = await readJson(request);
      if (!body || Object.hasOwn(body, "user_id")) return reply({ ok: false, error: "Nieprawidłowe dane ulubionego auta." }, 400, auth.cookies);
      const favorite = favoriteInput(body);
      if (!favorite) return reply({ ok: false, error: "Nieprawidłowe dane ulubionego auta." }, 400, auth.cookies);
      await insertFavorite(db, user.id, favorite);
      return reply({ ok: true, key: favorite.favorite_key }, 201, auth.cookies);
    }
    if (path === `${FAVORITES_PATH}/merge` && method === "POST") {
      const body = await readJson(request);
      if (!body || Object.hasOwn(body, "user_id") || !Array.isArray(body.favorites) || body.favorites.length > MAX_MERGE_ITEMS) return reply({ ok: false, error: "Nieprawidłowa lista ulubionych." }, 400, auth.cookies);
      const sanitized = [], seen = new Set();
      for (const input of body.favorites) {
        const favorite = favoriteInput(input);
        if (!favorite) return reply({ ok: false, error: "Lista ulubionych zawiera nieprawidłowe dane." }, 400, auth.cookies);
        if (!seen.has(favorite.favorite_key)) { seen.add(favorite.favorite_key); sanitized.push(favorite); }
      }
      if (typeof db.batch === "function" && sanitized.length) {
        const statements = sanitized.map(item => db.prepare(`INSERT INTO user_favorites (user_id, favorite_key, vin, lot, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, favorite_key) DO NOTHING`)
          .bind(user.id, item.favorite_key, item.vin, item.lot, item.platform, new Date().toISOString(), new Date().toISOString()));
        await db.batch(statements);
      } else for (const item of sanitized) await insertFavorite(db, user.id, item);
      return reply({ ok: true, merged: sanitized.length, keys: sanitized.map(item => item.favorite_key) }, 200, auth.cookies);
    }
    if (path.startsWith(`${FAVORITES_PATH}/`) && method === "DELETE") {
      let key = "";
      try { key = decodeURIComponent(path.slice(`${FAVORITES_PATH}/`.length)); } catch { /* invalid key */ }
      if (!validFavoriteKey(key)) return reply({ ok: false, error: "Nieprawidłowy klucz ulubionego auta." }, 400, auth.cookies);
      await db.prepare("DELETE FROM user_favorites WHERE user_id = ? AND favorite_key = ?").bind(user.id, key).run();
      return reply({ ok: true }, 200, auth.cookies);
    }
    return reply({ ok: false, error: "Nie znaleziono endpointu." }, 404, auth.cookies);
  }

  return handle;
}

module.exports = { createAccountsHandler, favoriteInput, validFavoriteKey, pkceChallenge, isAuthConfigurationComplete: configured };
