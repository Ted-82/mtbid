const { AuthConfigurationError, AuthProviderError, createRexIdentity } = require("./identity.js");

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const nowSeconds = () => Math.floor(Date.now() / 1000);

function b64url(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new AuthProviderError("INVALID_TOKEN", 401);
  const text = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(text + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function decodeJsonPart(value) {
  try { return JSON.parse(decoder.decode(fromB64url(value))); }
  catch { throw new AuthProviderError("INVALID_TOKEN", 401); }
}

const AUTH_TEST_HOST = "rexbid-auth-test.tedn828.workers.dev";
function authDiagnosticsEnabled(env) {
  return env?.REXBID_AUTH_DIAGNOSTICS === "enabled"
    && env?.REXBID_AUTH_TEST_UI === "enabled"
    && env?.REXBID_AUTH_TEST_HOST === AUTH_TEST_HOST;
}
function authKeyKind(value) {
  if (typeof value !== "string" || !value) return "missing";
  if (value.startsWith("sb_publishable_")) return "sb_publishable";
  if (value.split(".").length === 3) return "legacy_jwt_format";
  return "other";
}
function safeUrlPath(value) {
  try { return new URL(value).pathname; } catch { return null; }
}
function safeAuthErrorCode(payload) {
  for (const key of ["error_code", "code", "error"]) {
    const value = payload?.[key];
    if (typeof value === "string" && /^[a-z0-9_-]{1,64}$/i.test(value)) return value;
  }
  return null;
}
function safeContentType(value) {
  const mediaType = typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType) ? mediaType : null;
}
function safeTransportFacts(error, timedOut) {
  const name = typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "Error";
  const cause = error && typeof error === "object" ? error.cause : undefined;
  const causeType = typeof cause;
  const rawCode = cause && typeof cause === "object" ? cause.code : undefined;
  const causeCode = typeof rawCode === "string" && /^(?:ENOTFOUND|EAI_[A-Z0-9_]+|ECONN[A-Z0-9_]*|ETIMEDOUT|EHOST[A-Z0-9_]*|ENETUNREACH|CERT_[A-Z0-9_]+|ERR_TLS_[A-Z0-9_]+|ERR_SSL_[A-Z0-9_]+|ERR_[A-Z0-9_]+|UND_ERR_[A-Z0-9_]+|ABORT_ERR)$/i.test(rawCode) ? rawCode : null;
  const signals = [error?.message, cause && typeof cause === "object" ? cause.message : cause, rawCode, causeCode]
    .filter(value => typeof value === "string").join(" ").toLowerCase();
  let category = "unknown";
  if (timedOut || /\b(?:etimedout|timeout|timed out)\b/.test(signals)) category = "timeout";
  else if (/\b(?:enotfound|eai_[a-z0-9_]+|dns|name resolution)\b/.test(signals)) category = "dns";
  else if (/\b(?:cert_[a-z0-9_]+|err_tls_[a-z0-9_]+|err_ssl_[a-z0-9_]+|tls|ssl|certificate)\b/.test(signals)) category = "tls";
  else if (name === "AbortError" || /\b(?:abort_err|aborted)\b/.test(signals)) category = "abort";
  else if (/\b(?:econn[a-z0-9_]*|ehost[a-z0-9_]*|enetunreach|connection|socket)\b/.test(signals)) category = "connection";
  return { name, category, causeType, causeCode };
}
function logAuthDiagnostic(env, fields) {
  if (!authDiagnosticsEnabled(env)) return;
  // Keep this structured log on a strict allowlist. Never pass upstream text, request data or tokens.
  console.warn("Rex.Bid staging auth diagnostic", JSON.stringify({ provider: "supabase", ...fields }));
}

async function boundedFetch(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try { response = await fetchImpl(url, { ...init, signal: controller.signal, redirect: "manual" }); }
  catch { throw new AuthProviderError(controller.signal.aborted ? "AUTH_TIMEOUT" : "AUTH_UNAVAILABLE", 503); }
  finally { clearTimeout(timer); }
  if (response.status >= 300 && response.status < 400) throw new AuthProviderError("AUTH_UNEXPECTED_REDIRECT", 502);
  return response;
}

async function verifySupabaseJwt(token, config, { fetchImpl = fetch, cryptoImpl = globalThis.crypto, now = nowSeconds, timeoutMs = 7000 } = {}) {
  if (typeof token !== "string" || token.length > 8192) throw new AuthProviderError("INVALID_TOKEN", 401);
  const pieces = token.split(".");
  if (pieces.length !== 3) throw new AuthProviderError("INVALID_TOKEN", 401);
  const header = decodeJsonPart(pieces[0]);
  const claims = decodeJsonPart(pieces[1]);
  if (!header || !["ES256", "RS256", "HS256"].includes(header.alg)) throw new AuthProviderError("INVALID_TOKEN", 401);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== config.issuer || !audience.includes("authenticated") || typeof claims.sub !== "string" || !claims.sub || !Number.isFinite(claims.exp) || claims.exp <= now() || (Number.isFinite(claims.nbf) && claims.nbf > now() + 60)) {
    throw new AuthProviderError("INVALID_TOKEN", 401);
  }

  // Supabase's legacy shared-secret JWTs have no JWKS public key. Verify them
  // online at /user instead of keeping the project signing secret in Workers.
  if (header.alg === "HS256") {
    const userResponse = await boundedFetch(fetchImpl, `${config.issuer}/user`, { headers: { Accept: "application/json", apikey: config.publishableKey, Authorization: `Bearer ${token}` } }, timeoutMs);
    if (!userResponse.ok) throw new AuthProviderError(userResponse.status === 401 || userResponse.status === 403 ? "INVALID_TOKEN" : "AUTH_UNAVAILABLE", userResponse.status === 401 || userResponse.status === 403 ? 401 : 503);
    let user;
    try { user = await userResponse.json(); } catch { throw new AuthProviderError("AUTH_UNAVAILABLE", 502); }
    if (user?.id !== claims.sub) throw new AuthProviderError("INVALID_TOKEN", 401);
    return { claims, user };
  }
  if (typeof header.kid !== "string") throw new AuthProviderError("INVALID_TOKEN", 401);
  const response = await boundedFetch(fetchImpl, config.jwksUrl, { headers: { Accept: "application/json" } }, timeoutMs);
  if (!response.ok) throw new AuthProviderError("AUTH_UNAVAILABLE", response.status === 429 ? 503 : 502);
  let body;
  try { body = await response.json(); } catch { throw new AuthProviderError("AUTH_UNAVAILABLE", 502); }
  const jwk = Array.isArray(body?.keys) ? body.keys.find(key => key?.kid === header.kid && (!key.alg || key.alg === header.alg) && (!key.use || key.use === "sig")) : null;
  if (!jwk) throw new AuthProviderError("INVALID_TOKEN", 401);
  const signingInput = encoder.encode(`${pieces[0]}.${pieces[1]}`);
  const signature = fromB64url(pieces[2]);
  try {
    const algorithm = header.alg === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
      : { name: "ECDSA", namedCurve: "P-256" };
    const key = await cryptoImpl.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
    const verifyAlgorithm = header.alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" };
    if (!await cryptoImpl.subtle.verify(verifyAlgorithm, key, signature, signingInput)) throw new Error("INVALID_SIGNATURE");
  } catch { throw new AuthProviderError("INVALID_TOKEN", 401); }
  return { claims, user: null };
}

function makeConfig(env) {
  const rawUrl = typeof env?.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim().replace(/\/$/, "") : "";
  const publishableKey = typeof env?.SUPABASE_PUBLISHABLE_KEY === "string" ? env.SUPABASE_PUBLISHABLE_KEY.trim() : "";
  let base;
  try { base = new URL(rawUrl); } catch { throw new AuthConfigurationError(); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/" || !publishableKey) throw new AuthConfigurationError();
  const issuer = `${base.origin}/auth/v1`;
  return { baseUrl: `${base.origin}/auth/v1`, issuer, jwksUrl: `${issuer}/.well-known/jwks.json`, publishableKey };
}

function createSupabaseAuthProvider({ fetchImpl = (...args) => fetch(...args), cryptoImpl = globalThis.crypto, now = nowSeconds, timeoutMs = 7000 } = {}) {
  async function request(env, operation, { method = "GET", body, accessToken, redirectTo, allowNonOk = false } = {}) {
    const paths = {
      signup: "/signup", password: "/token?grant_type=password", pkce: "/token?grant_type=pkce",
      refresh: "/token?grant_type=refresh_token", user: "/user", logout: "/logout?scope=local", connectivity: "/health"
    };
    const path = paths[operation];
    if (!path) throw new AuthProviderError("AUTH_OPERATION_UNSUPPORTED", 500);
    let config;
    try {
      config = makeConfig(env);
    } catch (error) {
      logAuthDiagnostic(env, {
        operation, method, stage: "configuration", upstream_path: `/auth/v1${path.split("?")[0]}`,
        upstream_status: null, upstream_content_type: null, safe_error_code: "invalid_supabase_configuration",
        supabase_url_format: "invalid", publishable_key_kind: authKeyKind(env?.SUPABASE_PUBLISHABLE_KEY)
      });
      throw error;
    }
    // Publishable keys are opaque API keys, not JWTs: send them only as `apikey`.
    const headers = new Headers({ Accept: "application/json", apikey: config.publishableKey });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let endpoint;
    try {
      endpoint = new URL(`${config.baseUrl}${path}`);
      if (operation === "signup" && redirectTo) endpoint.searchParams.set("redirect_to", redirectTo);
    } catch {
      clearTimeout(timer);
      logAuthDiagnostic(env, {
        operation, method, stage: "URL", upstream_path: `/auth/v1${path.split("?")[0]}`,
        upstream_status: null, upstream_content_type: null, safe_error_code: "invalid_upstream_url",
        supabase_url_format: "valid_https_project_root", publishable_key_kind: authKeyKind(config.publishableKey),
        auth_header_mode: accessToken ? "user_access_token" : "apikey_only"
      });
      throw new AuthProviderError("AUTH_UNAVAILABLE", 503);
    }
    try {
      response = await fetchImpl(endpoint.href, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: "manual" });
    } catch (error) {
      clearTimeout(timer);
      const transport = safeTransportFacts(error, controller.signal.aborted);
      logAuthDiagnostic(env, {
        operation, method, stage: "fetch", upstream_path: endpoint.pathname,
        upstream_status: null, upstream_content_type: null,
        safe_error_code: transport.category === "timeout" ? "timeout" : "transport_error",
        error_name: transport.name, transport_category: transport.category,
        cause_type: transport.causeType, cause_code: transport.causeCode,
        supabase_url_format: "valid_https_project_root", hostname: endpoint.hostname,
        publishable_key_kind: authKeyKind(config.publishableKey), auth_header_mode: accessToken ? "user_access_token" : "apikey_only"
      });
      throw new AuthProviderError(controller.signal.aborted ? "AUTH_TIMEOUT" : "AUTH_UNAVAILABLE", 503);
    } finally { clearTimeout(timer); }
    if (response.status >= 300 && response.status < 400) {
      logAuthDiagnostic(env, {
        operation, method, stage: "response", upstream_path: endpoint.pathname,
        upstream_status: response.status, upstream_content_type: safeContentType(response.headers.get("Content-Type")),
        safe_error_code: "unexpected_redirect", supabase_url_format: "valid_https_project_root",
        upstream_host: endpoint.hostname, publishable_key_kind: authKeyKind(config.publishableKey),
        auth_header_mode: accessToken ? "user_access_token" : "apikey_only"
      });
      const error = new AuthProviderError("AUTH_UNEXPECTED_REDIRECT", 502);
      error.upstreamStatus = response.status;
      throw error;
    }
    let payload = null;
    try { payload = response.status === 204 ? null : await response.json(); } catch { /* don't surface upstream response text */ }
    logAuthDiagnostic(env, {
      operation, method, stage: "response", upstream_path: endpoint.pathname,
      upstream_status: response.status, upstream_content_type: safeContentType(response.headers.get("Content-Type")),
      safe_error_code: response.ok ? null : safeAuthErrorCode(payload),
      supabase_url_format: "valid_https_project_root", upstream_host: new URL(config.baseUrl).hostname,
      publishable_key_kind: authKeyKind(config.publishableKey), auth_header_mode: accessToken ? "user_access_token" : "apikey_only",
      redirect_target_path: operation === "signup" && redirectTo ? safeUrlPath(redirectTo) : null,
      signup_user_returned: operation === "signup" ? !!(payload?.user?.id || payload?.id) : null,
      signup_session_returned: operation === "signup" ? !!payload?.access_token : null
    });
    if (!response.ok) {
      if (allowNonOk) return { config, payload, status: response.status };
      const status = response.status === 429 ? 503
        : response.status === 400 || response.status === 401 || response.status === 403 || response.status === 422 ? 401
        : response.status >= 500 ? 503 : 502;
      const code = response.status === 429 ? "AUTH_RATE_LIMITED"
        : status === 401 ? "AUTH_REJECTED" : "AUTH_UNAVAILABLE";
      throw new AuthProviderError(code, status);
    }
    return { config, payload, status: response.status };
  }

  function normalizeSession(payload) {
    if (!payload || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") throw new AuthProviderError("INVALID_SESSION", 502);
    const expiresIn = Number(payload.expires_in);
    const expiresAt = Number.isFinite(Number(payload.expires_at)) ? Number(payload.expires_at) : now() + (Number.isFinite(expiresIn) ? expiresIn : 3600);
    return { access_token: payload.access_token, refresh_token: payload.refresh_token, expires_at: expiresAt };
  }

  async function resolveIdentity(env, accessToken) {
    const config = makeConfig(env);
    const verified = await verifySupabaseJwt(accessToken, config, { fetchImpl, cryptoImpl, now, timeoutMs });
    const claims = verified.claims;
    const user = verified.user || (await request(env, "user", { accessToken })).payload;
    if (!user || user.id !== claims.sub) throw new AuthProviderError("INVALID_IDENTITY", 401);
    const authProvider = typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "email";
    return createRexIdentity({ issuer: claims.iss, subject: claims.sub, email_verified: !!(user.email_confirmed_at || user.confirmed_at), auth_provider: authProvider });
  }

  return Object.freeze({
    id: "supabase",
    config: makeConfig,
    oauthUrl(env, { redirectTo, codeChallenge }) {
      const config = makeConfig(env);
      const url = new URL(`${config.baseUrl}/authorize`);
      url.searchParams.set("provider", "google");
      url.searchParams.set("redirect_to", redirectTo);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "s256");
      return url.href;
    },
    async signup(env, { email, password, redirectTo, codeChallenge }) {
      const { payload } = await request(env, "signup", { method: "POST", redirectTo, body: { email, password, code_challenge: codeChallenge, code_challenge_method: "s256" } });
      return { session: payload?.access_token ? normalizeSession(payload) : null, user: payload?.user || payload || null, redirectTo };
    },
    async login(env, { email, password }) {
      const { payload } = await request(env, "password", { method: "POST", body: { email, password } });
      return normalizeSession(payload);
    },
    async exchangeCode(env, { code, codeVerifier }) {
      const { payload } = await request(env, "pkce", { method: "POST", body: { auth_code: code, code_verifier: codeVerifier } });
      return normalizeSession(payload);
    },
    async refresh(env, session) {
      const { payload } = await request(env, "refresh", { method: "POST", body: { refresh_token: session.refresh_token } });
      return normalizeSession(payload);
    },
    async verifyIdentity(env, accessToken) { return resolveIdentity(env, accessToken); },
    async logout(env, accessToken) {
      if (!accessToken) return;
      await request(env, "logout", { method: "POST", accessToken });
    },
    async healthCheck(env) {
      try {
        const result = await request(env, "connectivity", { method: "GET", allowNonOk: true });
        return { ok: result.status >= 200 && result.status < 300, stage: "response", upstream_status: result.status, safe_error_code: result.status >= 200 && result.status < 300 ? null : "upstream_http_error" };
      } catch (error) {
        const safeCode = error instanceof AuthConfigurationError ? "invalid_supabase_configuration"
          : error instanceof AuthProviderError && error.code === "AUTH_TIMEOUT" ? "timeout"
          : error instanceof AuthProviderError && error.code === "AUTH_UNEXPECTED_REDIRECT" ? "unexpected_redirect"
          : error instanceof AuthProviderError ? "transport_error" : "probe_failed";
        return {
          ok: false,
          stage: error instanceof AuthConfigurationError ? "configuration" : error instanceof AuthProviderError && error.code === "AUTH_UNEXPECTED_REDIRECT" ? "response" : "fetch",
          upstream_status: Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null,
          safe_error_code: safeCode
        };
      }
    }
  });
}

module.exports = { createSupabaseAuthProvider, verifySupabaseJwt };
