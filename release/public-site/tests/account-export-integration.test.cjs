const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const { webcrypto } = require("node:crypto");
const { sealCookiePayload, sessionCookieName } = require("../auth/session.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://rexbid.pl";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(fs.readFileSync(path.join(ROOT, "docs/proposals/0003_accounts_foundation.sql"), "utf8"));
  const createdAt = "2026-10-05T12:00:00Z";
  const issuer = "https://exporttestabcdefghij.supabase.co/auth/v1";
  for (const user of ["owner", "other"]) {
    sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, 'email', 1, ?, ?)")
      .run(user, issuer, user, createdAt, createdAt);
    sqlite.prepare("INSERT INTO user_favorites VALUES (?, ?, NULL, ?, 'copart', ?, ?)")
      .run(user, `lot:copart:${user.toUpperCase()}-LOT`, `${user.toUpperCase()}-LOT`, createdAt, createdAt);
  }
  const queries = [], logs = [], verificationCalls = [];
  let assetCalls = 0, upstreamCalls = 0;
  const db = {
    prepare(sql) {
      assert.match(sql.trim(), /^SELECT\b/i, "account export must only read D1");
      const statement = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { queries.push({ sql, args }); return statement.get(...args) || null; },
        async all() { queries.push({ sql, args }); return { results: statement.all(...args) }; }
      };
    }
  };
  const provider = {
    async verifyIdentity(_env, token) {
      verificationCalls.push(token);
      if (!["owner-access-private-marker", "other-access-private-marker"].includes(token)) {
        throw Object.assign(new Error("invalid fixture session"), { status: 401 });
      }
      return { issuer, subject: token.startsWith("owner-") ? "owner" : "other", email_verified: true, auth_provider: "email" };
    }
  };
  const context = {
    URL, URLSearchParams, Request, Response, Headers, AbortController, setTimeout, clearTimeout,
    crypto: webcrypto,
    __apibara: require("../providers/apibara.js"),
    __contract: require("../providers/contract.js"),
    __authProvider: { createSupabaseAuthProvider: () => provider },
    __accounts: require("../auth/routes.js"),
    __providerBudget: require("../providers/request-budget.js"),
    fetch: async () => { upstreamCalls++; throw new Error("no network in account export test"); },
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    caches: { default: { match: async () => null, put: async () => { throw new Error("private export cannot populate cache"); } } }
  };
  const source = fs.readFileSync(path.join(ROOT, "worker.js"), "utf8")
    .replace('import apibaraModule from "./providers/apibara.js";', "const apibaraModule = globalThis.__apibara;")
    .replace('import contract from "./providers/contract.js";', "const contract = globalThis.__contract;")
    .replace('import authProviderModule from "./auth/supabase.js";', "const authProviderModule = globalThis.__authProvider;")
    .replace('import accountsModule from "./auth/routes.js";', "const accountsModule = globalThis.__accounts;")
    .replace('import providerBudgetModule from "./providers/request-budget.js";', "const providerBudgetModule = globalThis.__providerBudget;")
    .replace("export default {", "globalThis.__worker = {");
  vm.createContext(context);
  vm.runInContext(source, context);
  const env = {
    AUTH_ENABLED: "true", AUTH_D1_SCHEMA_VERSION: "0003",
    AUTH_CANONICAL_ORIGIN: ORIGIN, AUTH_ALLOWED_ORIGINS: ORIGIN,
    AUTH_RATE_LIMITING_MODE: "cloudflare", AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    SUPABASE_URL: "https://exporttestabcdefghij.supabase.co", SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
    REXBID_PRODUCTION_SUPABASE_PROJECT_REF: "exporttestabcdefghij", AUTH_RECOVERY_MODE: "email-token",
    REXBID_AUTH_COOKIE_SECRET: "offline-only-export-cookie-encryption-fixture-secret-43-plus",
    REXBID_DB: db,
    ASSETS: { fetch: async () => { assetCalls++; return new Response("Not Found", { status: 404 }); } }
  };
  return {
    env, queries, logs, verificationCalls,
    fetch: (request, overrides = {}) => context.__worker.fetch(request, { ...env, ...overrides }),
    async cookie(user = "owner") {
      const value = await sealCookiePayload({
        access_token: `${user}-access-private-marker`, refresh_token: `${user}-refresh-private-marker`,
        expires_at: Math.floor(Date.now() / 1000) + 3600
      }, env.REXBID_AUTH_COOKIE_SECRET, webcrypto);
      return `${sessionCookieName}=${value}`;
    },
    counts: () => ({ assetCalls, upstreamCalls })
  };
}

function request(pathname = "/api/me/export", { cookie = "", method = "GET", origin = ORIGIN } = {}) {
  return new Request(`${origin}${pathname}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: origin } });
}

test("Worker dispatches private account export to the real Accounts handler, preserving user isolation", async t => {
  const f = fixture(t);
  const response = await f.fetch(request("/api/me/export?user_id=other", { cookie: await f.cookie() }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.profile.id, "owner");
  assert.equal(body.favorites.length, 1);
  assert.equal(body.favorites[0].lot, "OWNER-LOT");
  assert.equal(body.favorites[0].key, "lot:copart:OWNER-LOT");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("Vary"), /Cookie/);
  assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
  assert.equal(f.queries.length, 2, "profile and favorites are read without writes");
  assert.deepEqual(f.queries[1].args, ["owner"]);
  assert.deepEqual(f.counts(), { assetCalls: 0, upstreamCalls: 0 });
  assert.doesNotMatch(JSON.stringify({ body, logs: f.logs }), /private-marker|fixture-public-key|fixture-secret|OTHER-LOT|user_id/);
});

test("Worker account export keeps disabled, anonymous and malformed-session requests fail closed", async t => {
  const f = fixture(t);
  assert.equal((await f.fetch(request(), { AUTH_ENABLED: "false" })).status, 503);
  assert.equal((await f.fetch(request())).status, 401);
  const malformed = await f.fetch(request("/api/me/export", { cookie: `${sessionCookieName}=invalid-cookie` }));
  assert.equal(malformed.status, 401);
  assert.match(malformed.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal(f.queries.length, 0);
  assert.deepEqual(f.counts(), { assetCalls: 0, upstreamCalls: 0 });
});

test("Worker account export enforces the existing origin and limiter gates", async t => {
  const f = fixture(t);
  const cookie = await f.cookie();
  assert.equal((await f.fetch(request("/api/me/export", { cookie, origin: "https://untrusted.example" }))).status, 503);
  assert.equal((await f.fetch(request("/api/me/export", { cookie }), {
    AUTH_RATE_LIMITER: { limit: async () => ({ success: false }) }
  })).status, 429);
  assert.equal(f.verificationCalls.length, 0);
  assert.equal(f.queries.length, 0);
  assert.deepEqual(f.counts(), { assetCalls: 0, upstreamCalls: 0 });
});

test("Worker export dispatch remains exact and does not expose sibling paths", async t => {
  const f = fixture(t);
  const cookie = await f.cookie();
  for (const pathname of ["/api/me/export/other", "/api/me/exported"]) {
    assert.equal((await f.fetch(request(pathname, { cookie }))).status, 404);
  }
  assert.equal(f.verificationCalls.length, 0);
  assert.equal(f.queries.length, 0);
  assert.equal(f.counts().upstreamCalls, 0);
});
