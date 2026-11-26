"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {exchangeRatesResponse} = require("../providers/exchange-rates.cjs");

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const SOURCE_URL = "https://api.nbp.pl/api/exchangerates/tables/A/?format=json";
test.beforeEach(context => { context.mock.method(console, "warn", () => {}); });
const request = (method = "GET", url = "https://rexbid.pl/api/exchange-rates") => new Request(url, {method});
const table = (extra = {}) => [{table: "A", no: "206/A/NBP/2026", effectiveDate: "2026-10-23", rates: [
  {currency: "dolar amerykański", code: "USD", mid: 3.9247}, {currency: "euro", code: "EUR", mid: 4.3917},
  {currency: "frank szwajcarski", code: "CHF", mid: 4.67}
], ...extra}];
const upstream = (data = table(), headers = {}) => new Response(JSON.stringify(data), {status: 200, headers});
const fresh = (extra = {}) => ({fetchImpl: async () => upstream(), cache: null, now: () => NOW, ...extra});
function memoryCache() {
  const map = new Map();
  return {map, matches: [], writes: [],
    async match(key) { this.matches.push(key); return map.get(key.url)?.clone(); },
    async put(key, value) { this.writes.push(key); map.set(key.url, value.clone()); }};
}
async function cachedBody(extra = {}) {
  return {...await (await exchangeRatesResponse(request(), fresh())).json(), ...extra};
}
async function assertUnavailable(res) {
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("Retry-After"), "60");
  const result = await res.json();
  assert.equal(result.ok, false);
  assert.equal(result.error, "exchange_rates_unavailable");
  assert.equal(Object.hasOwn(result, "usdPln"), false);
  assert.equal(Object.hasOwn(result, "eurPln"), false);
  assert.deepEqual(Object.keys(result).sort(), ["error", "message", "ok"]);
  return result;
}

test("NBP fresh table produces an attributed numeric response from fixed official URL", async () => {
  const calls = [];
  const req = new Request("https://rexbid.pl/api/exchange-rates?url=https://attacker.invalid", {headers: {Authorization: "Bearer client-secret", Cookie: "session=private"}});
  const res = await exchangeRatesResponse(req, fresh({fetchImpl: async (...args) => { calls.push(args); return upstream(); }}));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=21600");
  assert.match(res.headers.get("Content-Type"), /application\/json/);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(await res.json(), {ok: true, usdPln: 3.9247, eurPln: 4.3917, effectiveDate: "2026-10-23", table: "206/A/NBP/2026",
    source: "NBP Table A", sourceUrl: SOURCE_URL, checkedAt: "2026-10-26T12:00:00.000Z", stale: false});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], SOURCE_URL);
  assert.equal(calls[0][1].redirect, "manual");
  assert.deepEqual(calls[0][1].headers, {Accept: "application/json"});
  assert.ok(calls[0][1].signal instanceof AbortSignal);
});

test("same-origin fixed cache key drops query, fragment and client headers; HEAD shares GET cache", async () => {
  const cache = memoryCache();
  let calls = 0;
  const options = fresh({cache, fetchImpl: async () => { calls++; return upstream(); }});
  await exchangeRatesResponse(request("GET", "https://rexbid.pl/api/exchange-rates?x=1#private"), options);
  const head = await exchangeRatesResponse(request("HEAD", "https://rexbid.pl/api/exchange-rates?x=2"), options);
  assert.equal(calls, 1);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.deepEqual(cache.writes.map(x => x.url), ["https://rexbid.pl/api/exchange-rates"]);
  assert.ok(cache.matches.every(x => x.method === "GET" && Array.from(x.headers).length === 0));
});

test("HEAD miss fetches and caches a complete GET response, while returning no body", async () => {
  const cache = memoryCache();
  const head = await exchangeRatesResponse(request("HEAD"), fresh({cache}));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const saved = await cache.map.get("https://rexbid.pl/api/exchange-rates").json();
  assert.equal(saved.usdPln, 3.9247);
});

test("valid cache preserves checkedAt and uses only remaining TTL", async () => {
  const cache = memoryCache();
  await exchangeRatesResponse(request(), fresh({cache}));
  const res = await exchangeRatesResponse(request(), fresh({cache, now: () => NOW + 3600000, fetchImpl: async () => { throw Error("must not fetch"); }}));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=18000");
  assert.equal((await res.json()).checkedAt, "2026-10-26T12:00:00.000Z");
});

test("expired cache is refreshed rather than extended or returned after outage", async () => {
  const cache = memoryCache();
  await exchangeRatesResponse(request(), fresh({cache}));
  let calls = 0;
  await assertUnavailable(await exchangeRatesResponse(request(), fresh({cache, now: () => NOW + 21600000,
    fetchImpl: async () => { calls++; throw Error("upstream secret"); }})));
  assert.equal(calls, 1);
});

test("cached effective date and stale status are revalidated on every read", async () => {
  const cache = memoryCache();
  const beforeMidnight = Date.parse("2026-10-26T23:00:00.000Z");
  await exchangeRatesResponse(request(), fresh({cache, now: () => beforeMidnight, fetchImpl: async () => upstream(table({effectiveDate: "2026-10-22"}))}));
  const res = await exchangeRatesResponse(request(), fresh({cache, now: () => beforeMidnight + 7200000, fetchImpl: async () => { throw Error("unexpected"); }}));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).stale, true);
});

test("even a recent cache is rejected when the underlying table becomes older than ten days", async () => {
  const cache = memoryCache();
  const beforeMidnight = Date.parse("2026-10-26T23:00:00.000Z");
  await exchangeRatesResponse(request(), fresh({cache, now: () => beforeMidnight, fetchImpl: async () => upstream(table({effectiveDate: "2026-10-16"}))}));
  await assertUnavailable(await exchangeRatesResponse(request(), fresh({cache, now: () => beforeMidnight + 7200000, fetchImpl: async () => { throw Error("outage"); }})));
});

test("dates five to ten UTC calendar days old are served explicitly stale", async () => {
  for (const date of ["2026-10-21", "2026-10-16"]) {
    const res = await exchangeRatesResponse(request(), fresh({fetchImpl: async () => upstream(table({effectiveDate: date}))}));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stale, true);
  }
  const fourDays = await exchangeRatesResponse(request(), fresh({fetchImpl: async () => upstream(table({effectiveDate: "2026-10-22"}))}));
  assert.equal((await fourDays.json()).stale, false);
});

test("canonical dates enforce ten-day maximum and one-day future tolerance", async () => {
  for (const date of ["2026-10-15", "2026-10-28", "2026-02-30", "2026-13-01", "2026-1-01", "26/10/2026", "2026-10-26T00:00:00Z", null]) {
    await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => upstream(table({effectiveDate: date}))})));
  }
  const tomorrow = await exchangeRatesResponse(request(), fresh({fetchImpl: async () => upstream(table({effectiveDate: "2026-10-27"}))}));
  assert.equal(tomorrow.status, 200);
});

test("malformed JSON, wrong table and invalid official table number fail closed", async () => {
  const responses = [new Response("not-json"), upstream({}), upstream([]), upstream([...table(), ...table()]),
    upstream(table({table: "B"})), upstream(table({no: "secret <script>"})), upstream(table({no: "206/A/NBP/2025"})),
    upstream(table({rates: null})), new Response(new Uint8Array([255, 255]))];
  for (const value of responses) await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => value})));
});

test("USD and EUR must each occur once with numeric rates within 0.1..20", async () => {
  const valid = table()[0].rates;
  const invalidSets = [valid.slice(1), valid.filter(x => x.code !== "EUR"), [...valid, {...valid[0]}], [...valid, {...valid[1]}]];
  for (const mid of [0, -1, 0.0999, 20.0001, null, "3.9247", true]) invalidSets.push([{code: "USD", mid}, valid[1]]);
  for (const rates of invalidSets) await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => upstream(table({rates}))})));
  const edge = await exchangeRatesResponse(request(), fresh({fetchImpl: async () => upstream(table({rates: [{code: "USD", mid: 0.1}, {code: "EUR", mid: 20}]}))}));
  assert.equal(edge.status, 200);
});

test("64 KiB limit applies to Content-Length and streamed bodies", async () => {
  await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => upstream(table(), {"Content-Length": "65537"})})));
  let cancelled = false;
  const stream = new ReadableStream({pull(controller) { controller.enqueue(new Uint8Array(32769)); }, cancel() { cancelled = true; }});
  await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => new Response(stream)})));
  assert.equal(cancelled, true);
  const json = JSON.stringify(table());
  const exact = json + " ".repeat(65536 - Buffer.byteLength(json));
  assert.equal((await exchangeRatesResponse(request(), fresh({fetchImpl: async () => new Response(exact)}))).status, 200);
});

test("upstream outage, redirect or non-200 status never leaks upstream messages or fabricated rates", async () => {
  for (const status of [204, 301, 401, 403, 429, 500, 503]) {
    await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => new Response(status === 204 ? null : "private detail", {status})})));
  }
  const result = await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => { throw Error("SECRET_TOKEN database credentials"); }})));
  assert.doesNotMatch(JSON.stringify(result), /SECRET_TOKEN|credentials|database/);
});

test("8-second timeout also bounds a fetch implementation that ignores AbortSignal", async context => {
  context.mock.timers.enable({apis: ["setTimeout"]});
  let signal;
  const pending = exchangeRatesResponse(request(), fresh({fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); }}));
  context.mock.timers.tick(8000);
  await assertUnavailable(await pending);
  assert.equal(signal.aborted, true);
});

test("8-second timeout includes waiting for a response body", async context => {
  context.mock.timers.enable({apis: ["setTimeout"]});
  const pending = exchangeRatesResponse(request(), fresh({fetchImpl: async () => new Response(new ReadableStream({start() {}}))}));
  await Promise.resolve();
  context.mock.timers.tick(8000);
  await assertUnavailable(await pending);
});

test("cache match/put errors do not prevent a valid official response", async () => {
  const cache = {async match() { throw Error("cache unavailable"); }, async put() { throw Error("cache unavailable"); }};
  const res = await exchangeRatesResponse(request(), fresh({cache}));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).usdPln, 3.9247);
});

test("corrupt cached values, source substitution and future checkedAt force a source refresh", async () => {
  const valid = await cachedBody();
  for (const alteration of [{usdPln: 0}, {eurPln: "4"}, {sourceUrl: "https://attacker.invalid"}, {source: "Other"},
    {effectiveDate: "2026-02-30"}, {checkedAt: "2026-10-26T12:00:01.000Z"}, {checkedAt: "today"}, {table: "<script>"}]) {
    let calls = 0;
    const cache = {async match() { return new Response(JSON.stringify({...valid, ...alteration})); }, async put() {}};
    const res = await exchangeRatesResponse(request(), fresh({cache, fetchImpl: async () => { calls++; return upstream(); }}));
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
  }
});

test("only GET and HEAD are allowed; unsupported methods do not access cache or upstream", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const res = await exchangeRatesResponse(request(method), {fetchImpl: async () => { assert.fail("fetch called"); },
      cache: {async match() { assert.fail("cache called"); }}, now: () => { assert.fail("clock called"); }});
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("Allow"), "GET, HEAD");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
  const headFailure = await exchangeRatesResponse(request("HEAD"), fresh({fetchImpl: async () => { throw Error("outage"); }}));
  assert.equal(headFailure.status, 503);
  assert.equal(await headFailure.text(), "");
});

test("module has no dependencies on database, secrets or auction provider", () => {
  const source = fs.readFileSync(path.join(__dirname, "../providers/exchange-rates.cjs"), "utf8");
  assert.doesNotMatch(source, /require\(|process\.env|\bD1\b|APIBARA|apibara|SUPABASE|api[_-]?key|Authorization/);
  assert.deepEqual(Object.keys(require("../providers/exchange-rates.cjs")), ["exchangeRatesResponse"]);
});

test("fetch uses Workers-supported manual redirect mode and never follows a redirect", async () => {
  let calls = 0;
  const workerFetch = async (_url, options) => {
    calls++;
    if (options.redirect === "error") throw new TypeError("Unsupported redirect mode");
    assert.equal(options.redirect, "manual");
    return upstream();
  };
  assert.equal((await exchangeRatesResponse(request(), fresh({fetchImpl: workerFetch}))).status, 200);
  assert.equal(calls, 1);
  calls = 0;
  await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    return new Response(null, {status: 302, headers: {Location: "https://attacker.invalid/private"}});
  }})));
  assert.equal(calls, 1);
});

test("server diagnostics log only a fixed marker and an allowlisted error code", async context => {
  const logs = [];
  context.mock.method(console, "warn", (...args) => logs.push(args));
  await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => { throw Object.assign(Error("PRIVATE KEY and body"), {fxCode:"PRIVATE_KEY"}); }})));
  await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => new Response("private body", {status: 429})})));
  await assertUnavailable(await exchangeRatesResponse(request(), fresh({fetchImpl: async () => new Response("private JSON secret")})));
  const cache = {async match() { throw Error("cache private detail"); }, async put() { throw Error("cache secret"); }};
  assert.equal((await exchangeRatesResponse(request(), fresh({cache}))).status, 200);
  assert.deepEqual(logs, [
    ["REXBID_FX", "UPSTREAM_FETCH_FAILED"], ["REXBID_FX", "UPSTREAM_HTTP_429"], ["REXBID_FX", "JSON_INVALID"],
    ["REXBID_FX", "CACHE_READ_FAILED"], ["REXBID_FX", "CACHE_WRITE_FAILED"]
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|private|secret|attacker|https/);
});
