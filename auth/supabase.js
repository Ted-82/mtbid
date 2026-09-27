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

async function boundedFetch(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: controller.signal, redirect: "error" }); }
  catch { throw new AuthProviderError(controller.signal.aborted ? "AUTH_TIMEOUT" : "AUTH_UNAVAILABLE", 503); }
  finally { clearTimeout(timer); }
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
  async function request(env, operation, { method = "GET", body, accessToken, redirectTo } = {}) {
    const config = makeConfig(env);
    const paths = {
      signup: "/signup", password: "/token?grant_type=password", pkce: "/token?grant_type=pkce",
      refresh: "/token?grant_type=refresh_token", user: "/user", logout: "/logout?scope=local"
    };
    const path = paths[operation];
    if (!path) throw new AuthProviderError("AUTH_OPERATION_UNSUPPORTED", 500);
    const headers = new Headers({ Accept: "application/json", apikey: config.publishableKey });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    else if (operation === "signup" || operation === "password" || operation === "pkce" || operation === "refresh") headers.set("Authorization", `Bearer ${config.publishableKey}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const endpoint = new URL(`${config.baseUrl}${path}`);
      if (operation === "signup" && redirectTo) endpoint.searchParams.set("redirect_to", redirectTo);
      response = await fetchImpl(endpoint.href, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: "error" });
    } catch {
      throw new AuthProviderError(controller.signal.aborted ? "AUTH_TIMEOUT" : "AUTH_UNAVAILABLE", 503);
    } finally { clearTimeout(timer); }
    let payload = null;
    try { payload = response.status === 204 ? null : await response.json(); } catch { /* don't surface upstream response text */ }
    if (!response.ok) {
      const status = response.status === 429 ? 503
        : response.status === 400 || response.status === 401 || response.status === 403 || response.status === 422 ? 401
        : response.status >= 500 ? 503 : 502;
      const code = response.status === 429 ? "AUTH_RATE_LIMITED"
        : status === 401 ? "AUTH_REJECTED" : "AUTH_UNAVAILABLE";
      throw new AuthProviderError(code, status);
    }
    return { config, payload };
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
    }
  });
}

module.exports = { createSupabaseAuthProvider, verifySupabaseJwt };
