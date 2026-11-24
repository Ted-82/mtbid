"use strict";

const SOURCE_URL = "https://api.nbp.pl/api/exchangerates/tables/A/?format=json";
const SOURCE = "NBP Table A";
const DAY_MS = 86400000;
const CACHE_SECONDS = 6 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;
const TIMEOUT_MS = 8000;
const DIAGNOSTIC_CODES = new Set([
  "DATE_INVALID", "DATE_OUTSIDE_WINDOW", "RATE_INVALID", "TABLE_INVALID", "BODY_TOO_LARGE", "BODY_MISSING",
  "BODY_INVALID", "BODY_READ_FAILED", "JSON_INVALID", "TABLE_RESPONSE_INVALID", "CURRENCY_DUPLICATE",
  "CACHE_INVALID", "CACHE_EXPIRED", "CACHE_READ_FAILED", "CACHE_WRITE_FAILED", "UPSTREAM_FETCH_FAILED",
  "UPSTREAM_TIMEOUT", "CLOCK_INVALID", "INTERNAL"
]);
function fault(code) { const error = new Error("Exchange rates unavailable"); error.fxCode = code; return error; }
function diagnostic(error, fallback = "INTERNAL") {
  const code = DIAGNOSTIC_CODES.has(error?.fxCode) || /^UPSTREAM_HTTP_[1-5]\d\d$/.test(error?.fxCode || "") ? error.fxCode : fallback;
  // Never include exception messages, request URLs, upstream bodies or credentials.
  try { console.warn("REXBID_FX", code); } catch {}
}

function response(body, status, method, headers = {}) {
  return new Response(method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: {"Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers}
  });
}

function dateStatus(value, nowMs) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fault("DATE_INVALID");
  const dateMs = Date.parse(value + "T00:00:00.000Z");
  if (!Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== value) throw fault("DATE_INVALID");
  const age = Math.floor(nowMs / DAY_MS) - Math.floor(dateMs / DAY_MS);
  if (age < -1 || age > 10) throw fault("DATE_OUTSIDE_WINDOW");
  return {stale: age > 4};
}

function validateRate(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.1 || value > 20) throw fault("RATE_INVALID");
  return value;
}

function validateTable(value, effectiveDate) {
  if (typeof value !== "string" || !/^\d{3}\/A\/NBP\/\d{4}$/.test(value) || value.slice(-4) !== effectiveDate.slice(0, 4)) {
    throw fault("TABLE_INVALID");
  }
  return value;
}

async function boundedJson(res) {
  const declaredLength = res.headers.get("Content-Length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
    try { await res.body?.cancel(); } catch {}
    throw fault("BODY_TOO_LARGE");
  }
  if (!res.body || typeof res.body.getReader !== "function") throw fault("BODY_MISSING");
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      let part;
      try { part = await reader.read(); } catch { throw fault("BODY_READ_FAILED"); }
      const {done, value} = part;
      if (done) break;
      if (!(value instanceof Uint8Array)) throw fault("BODY_INVALID");
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch {}
        throw fault("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)); }
  catch { throw fault("JSON_INVALID"); }
}

function fromNbp(data, nowMs) {
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.table !== "A" || !Array.isArray(data[0]?.rates)) {
    throw fault("TABLE_RESPONSE_INVALID");
  }
  const item = data[0];
  const {stale} = dateStatus(item.effectiveDate, nowMs);
  const selected = {};
  for (const row of item.rates) {
    if (row?.code !== "USD" && row?.code !== "EUR") continue;
    if (Object.prototype.hasOwnProperty.call(selected, row.code)) throw fault("CURRENCY_DUPLICATE");
    selected[row.code] = validateRate(row.mid);
  }
  return {
    ok: true,
    usdPln: validateRate(selected.USD),
    eurPln: validateRate(selected.EUR),
    effectiveDate: item.effectiveDate,
    table: validateTable(item.no, item.effectiveDate),
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    checkedAt: new Date(nowMs).toISOString(),
    stale
  };
}

function fromCache(data, nowMs) {
  if (!data || data.ok !== true || data.source !== SOURCE || data.sourceUrl !== SOURCE_URL || typeof data.checkedAt !== "string") {
    throw fault("CACHE_INVALID");
  }
  const checkedAtMs = Date.parse(data.checkedAt);
  if (!Number.isFinite(checkedAtMs) || new Date(checkedAtMs).toISOString() !== data.checkedAt || checkedAtMs > nowMs || nowMs - checkedAtMs >= CACHE_SECONDS * 1000) {
    throw fault("CACHE_EXPIRED");
  }
  const {stale} = dateStatus(data.effectiveDate, nowMs);
  return {
    body: {ok: true, usdPln: validateRate(data.usdPln), eurPln: validateRate(data.eurPln), effectiveDate: data.effectiveDate,
      table: validateTable(data.table, data.effectiveDate), source: SOURCE, sourceUrl: SOURCE_URL, checkedAt: data.checkedAt, stale},
    maxAge: Math.max(0, CACHE_SECONDS - Math.ceil((nowMs - checkedAtMs) / 1000))
  };
}

async function fetchRates(fetchImpl, nowMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        let upstream;
        try {
          // Workers supports manual/follow, but throws for the Fetch-standard
          // "error" mode. Manual + status-200 validation also rejects redirects.
          upstream = await fetchImpl(SOURCE_URL, {method: "GET", headers: {Accept: "application/json"}, redirect: "manual", signal: controller.signal});
        } catch { throw fault("UPSTREAM_FETCH_FAILED"); }
        if (!upstream || upstream.status !== 200) {
          const status = upstream?.status;
          throw fault(Number.isInteger(status) && status >= 100 && status <= 599 ? `UPSTREAM_HTTP_${status}` : "UPSTREAM_FETCH_FAILED");
        }
        return fromNbp(await boundedJson(upstream), nowMs);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fault("UPSTREAM_TIMEOUT")); }, TIMEOUT_MS); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeRatesResponse(request, {fetchImpl = fetch, cache = globalThis.caches?.default, now = Date.now} = {}) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return response({ok: false, error: "method_not_allowed"}, 405, method, {Allow: "GET, HEAD", "Cache-Control": "no-store"});
  }
  try {
    const nowMs = now();
    if (!Number.isFinite(nowMs)) throw fault("CLOCK_INVALID");
    const key = new Request(new URL("/api/exchange-rates", request.url).href, {method: "GET"});
    if (cache) {
      try {
        const cached = await cache.match(key);
        if (cached?.status === 200) {
          const result = fromCache(await boundedJson(cached), nowMs);
          return response(result.body, 200, method, {"Cache-Control": `public, max-age=${result.maxAge}`});
        }
      } catch (error) { diagnostic(error, "CACHE_READ_FAILED"); } // Cache failure must not disable the official source.
    }
    const body = await fetchRates(fetchImpl, nowMs);
    const headers = {"Cache-Control": `public, max-age=${CACHE_SECONDS}`};
    if (cache) {
      try { await cache.put(key, response(body, 200, "GET", headers)); } catch (error) { diagnostic(error, "CACHE_WRITE_FAILED"); }
    }
    return response(body, 200, method, headers);
  } catch (error) {
    diagnostic(error);
    return response({ok: false, error: "exchange_rates_unavailable", message: "Kursy walut są chwilowo niedostępne. Spróbuj ponownie później."},
      503, method, {"Cache-Control": "no-store", "Retry-After": "60"});
  }
}

module.exports = {exchangeRatesResponse};
