const { createRexIdentity } = require("./identity.js");
const {
  clearFlowCookie, clearSessionCookie, flowCookie, flowCookieName, isSameOriginWrite,
  openCookiePayload, readCookie, safeReturnPath, sessionCookie, sessionCookieMaxAge,
  sessionCookieName, sealCookiePayload
} = require("./session.js");

const jsonHeaders = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "private, no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };
const AUTH_PREFIX = "/api/auth/";
const FAVORITES_PATH = "/api/me/favorites";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MERGE_ITEMS = 100;
const nowSeconds = () => Math.floor(Date.now() / 1000);

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
function configured(env) {
  return typeof env?.REXBID_AUTH_COOKIE_SECRET === "string" && env.REXBID_AUTH_COOKIE_SECRET.length >= 43
    && typeof env?.SUPABASE_URL === "string" && typeof env?.SUPABASE_PUBLISHABLE_KEY === "string";
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
  if (!rawCookie) return { identity: null, session: null, cookies: [] };
  let session = await openCookiePayload(rawCookie, cookieSecret(env), cryptoImpl);
  if (!session || typeof session.access_token !== "string" || typeof session.refresh_token !== "string" || !Number.isFinite(session.expires_at)) {
    return { identity: null, session: null, cookies: [clearSessionCookie()] };
  }
  let cookieUpdate = null;
  if (session.expires_at <= now() + 45) {
    try {
      session = await provider.refresh(env, session);
      cookieUpdate = await sessionCookieFor(session, env, cryptoImpl);
    } catch (error) {
      if (error?.status >= 500) return { identity: null, session: null, cookies: [], unavailable: true };
      return { identity: null, session: null, cookies: [clearSessionCookie()] };
    }
  }
  try {
    const identity = await provider.verifyIdentity(env, session.access_token);
    if (!identity.email_verified) return { identity: null, session: null, cookies: [clearSessionCookie()] };
    return { identity, session, cookies: cookieUpdate ? [cookieUpdate] : [] };
  } catch (error) {
    if (error?.status >= 500) return { identity: null, session: null, cookies: [], unavailable: true };
    return { identity: null, session: null, cookies: [clearSessionCookie()] };
  }
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

  async function finishSession(request, env, session, returnPath = "/konto.html") {
    const cookie = await sessionCookieFor(session, env, cryptoImpl);
    const identity = await provider.verifyIdentity(env, session.access_token);
    if (!identity.email_verified) return reply({ ok: false, error: "Potwierdź adres e-mail, aby korzystać z konta." }, 403, [clearSessionCookie()]);
    const db = accountDb(env);
    if (!db) return reply({ ok: false, error: "Konta są chwilowo niedostępne." }, 503, [clearSessionCookie()]);
    const user = await upsertAccount(db, createRexIdentity(identity), cryptoImpl);
    return reply({ ok: true, user: { id: user.id, auth_provider: user.auth_provider, email_verified: !!user.email_verified } }, 200, [cookie]);
  }

  async function handle(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(AUTH_PREFIX) && url.pathname !== "/api/me" && url.pathname !== FAVORITES_PATH && !url.pathname.startsWith(`${FAVORITES_PATH}/`)) return null;
    if (!configured(env)) return reply({ ok: false, error: "Uwierzytelnianie nie jest skonfigurowane." }, 503);
    if (request.method === "OPTIONS") return reply({ ok: false, error: "Metoda niedozwolona." }, 405);

    const path = url.pathname;
    const method = request.method.toUpperCase();
    const write = method !== "GET";
    if (write && !isSameOriginWrite(request)) return reply({ ok: false, error: "Żądanie odrzucone." }, 403);

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
      if (!flow || flow.expires_at <= now() || !code || code.length > 2048 || state !== flow.state || url.searchParams.has("access_token") || url.searchParams.has("refresh_token")) {
        return redirect("/logowanie.html?auth=failed", [clearFlowCookie(), clearSessionCookie()]);
      }
      try {
        const session = await provider.exchangeCode(env, { code, codeVerifier: flow.verifier });
        const verified = await provider.verifyIdentity(env, session.access_token);
        if (!verified.email_verified) return redirect("/logowanie.html?auth=verify-email", [clearFlowCookie(), clearSessionCookie()]);
        if (!accountDb(env)) return redirect("/logowanie.html?auth=unavailable", [clearFlowCookie(), clearSessionCookie()]);
        await upsertAccount(accountDb(env), createRexIdentity(verified), cryptoImpl);
        const value = await sealCookiePayload(session, cookieSecret(env), cryptoImpl);
        if (value.length > 3800) throw new Error("SESSION_COOKIE_TOO_LARGE");
        return redirect(safeReturnPath(flow.return_path), [sessionCookie(value), clearFlowCookie()]);
      } catch {
        return redirect("/logowanie.html?auth=failed", [clearFlowCookie(), clearSessionCookie()]);
      }
    }

    if (path === `${AUTH_PREFIX}signup` && method === "POST") {
      const body = await readJson(request), email = safeEmail(body?.email), password = safePassword(body?.password);
      if (!email || !password || Object.hasOwn(body || {}, "user_id")) return reply({ ok: false, error: "Sprawdź dane rejestracji." }, 400);
      try {
        const verifier = randomB64Url(cryptoImpl, 48), state = randomB64Url(cryptoImpl), challenge = await pkceChallenge(verifier, cryptoImpl);
        const callback = new URL("/api/auth/callback", url.origin); callback.searchParams.set("state", state);
        const flow = await sealCookiePayload({ state, verifier, return_path: "/konto.html", expires_at: now() + 86400 }, cookieSecret(env), cryptoImpl);
        const result = await provider.signup(env, { email, password, redirectTo: callback.href, codeChallenge: challenge });
        if (result.session) return await finishSession(request, env, result.session);
        return reply({ ok: true, confirmation_required: true, message: "Jeśli można utworzyć konto, wyślemy wiadomość z potwierdzeniem." }, 202, [flowCookie(flow, 86400)]);
      } catch (error) {
        return reply({ ok: false, error: error?.status === 401 ? "Nie udało się utworzyć konta." : "Rejestracja jest chwilowo niedostępna." }, error?.status === 401 ? 400 : 503);
      }
    }

    if (path === `${AUTH_PREFIX}login` && method === "POST") {
      const body = await readJson(request), email = safeEmail(body?.email), password = safePassword(body?.password);
      if (!email || !password || Object.hasOwn(body || {}, "user_id")) return reply({ ok: false, error: "Nieprawidłowy e-mail lub hasło." }, 401);
      try { return await finishSession(request, env, await provider.login(env, { email, password })); }
      catch (error) { return reply({ ok: false, error: error?.status === 401 ? "Nieprawidłowy e-mail lub hasło." : "Logowanie jest chwilowo niedostępne." }, error?.status === 401 ? 401 : 503); }
    }

    if (path === `${AUTH_PREFIX}logout` && method === "POST") {
      const state = await resolveSession(request, env, provider, { cryptoImpl, now });
      try { if (state.session) await provider.logout(env, state.session.access_token); } catch { /* local cookie invalidation still logs out this browser */ }
      return reply({ ok: true }, 200, [clearSessionCookie(), clearFlowCookie()]);
    }

    if (path === `${AUTH_PREFIX}refresh` && method === "POST") {
      const state = await resolveSession(request, env, provider, { cryptoImpl, now });
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

    if (path === "/api/me" && method === "GET") return reply({ ok: true, user: { id: user.id, auth_provider: user.auth_provider, email_verified: !!user.email_verified, created_at: user.created_at } }, 200, auth.cookies);
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

module.exports = { createAccountsHandler, favoriteInput, validFavoriteKey, pkceChallenge };
