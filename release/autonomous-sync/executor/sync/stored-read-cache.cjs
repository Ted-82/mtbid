"use strict";

const {MAX_AGE: TAXONOMY_MAX_AGE_MS} = require("./catalog-taxonomy-cache.cjs");

const MAX_TTL_SECONDS = 30;
const FILTER_TTL_SECONDS = 15 * 60;
const FRESHNESS_MAX_AGE_MS = 86_400_000;
const STORED_AT = "X-RexBid-Stored-Cache-Time";
const CACHE_TTL = "X-RexBid-Stored-Cache-TTL";
const FILTER_FIELDS = new Set(["makes","models","years","states","auction_states","body_styles","fuel_types","vehicle_types",
  "transmissions","drive_types","run_conditions","damages","seller_types","sale_document_types","sale_document_names"]);
const FILTER_OBJECT_FIELDS = new Set(["makes","vehicle_types","sale_document_names"]);
const FILTER_META_FIELDS = new Set(["read_source","catalog_complete","scope_status","platform_coverage","metadata_complete","known_rows_only","row_count","provider_fallback_enabled","freshness","catalog","taxonomy_as_of"]);
function catalogMetadata(value){
  const keys=new Set(['kind','baseline_id','pointer_revision','snapshot_records','replay_sequence','replay_status','unresolved_records','reviewed_unresolved_records','coverage_status','verified_at','snapshot_generated_at']);
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.has(k))
    &&value.kind==='verified_baseline'&&typeof value.baseline_id==='string'
    &&['pointer_revision','snapshot_records','replay_sequence','unresolved_records','reviewed_unresolved_records'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0)
    &&['verified','in_progress'].includes(value.replay_status)&&['verified','replaying','quarantine_review'].includes(value.coverage_status)
    &&['verified_at','snapshot_generated_at'].every(k=>value[k]===null||typeof value[k]==='string'&&Number.isFinite(Date.parse(value[k])));
}
function taxonomyAsOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'from,paged,replayEnd,replayStart,to'
    && value.paged === true && ['from','to'].every(k => typeof value[k] === 'string' && Number.isFinite(Date.parse(value[k])))
    && Date.parse(value.from) <= Date.parse(value.to)
    && ['replayStart','replayEnd'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0)
    && value.replayStart <= value.replayEnd;
}
function taxonomyBody(body) {
  if (body.ok !== true || Object.keys(body).some(key => !["ok","data","meta"].includes(key))
      || !body.meta || body.meta.read_source !== "d1" || body.meta.known_rows_only !== true
      || Object.keys(body.meta).some(key => !FILTER_META_FIELDS.has(key))
      || Object.hasOwn(body.meta,"catalog")&&!catalogMetadata(body.meta.catalog)
      || Object.hasOwn(body.meta,"taxonomy_as_of")&&(!taxonomyAsOf(body.meta.taxonomy_as_of)||body.meta.metadata_complete!==false)
      || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) return false;
  return Object.entries(body.data).every(([key,items]) => FILTER_FIELDS.has(key) && Array.isArray(items) && items.every(item => {
    if (key === "models") return item && typeof item === "object" && !Array.isArray(item)
      && Object.keys(item).sort().join(',') === 'make,model' && typeof item.make === 'string' && typeof item.model === 'string';
    if (FILTER_OBJECT_FIELDS.has(key)) return item && typeof item === "object" && !Array.isArray(item)
      && Object.keys(item).sort().join(',') === 'label,value' && typeof item.label === 'string' && typeof item.value === 'string';
    return typeof item === 'string' || typeof item === 'number' && Number.isFinite(item);
  }));
}

function publicStoredPath(pathname) {
  return pathname === "/api/cars" || pathname === "/api/filters"
    || /^\/api\/car\/[^/]+(?:\/history)?$/.test(pathname);
}

function cacheKey(request, namespace, storedTaxonomy = false) {
  if (!namespace || typeof namespace !== "string" || namespace.length > 200
    || /[\u0000-\u001f\u007f]/.test(namespace)) return null;
  const url = new URL(request.url);
  if (request.method !== "GET" || !["http:", "https:"].includes(url.protocol)
    || !publicStoredPath(url.pathname) || request.headers.has("Authorization")
    || request.headers.has("Cookie") || request.headers.has("Range")) return null;
  for (const key of url.searchParams.keys()) {
    if (/^(?:access_token|refresh_token|token|authorization|session|email|password|code)$/i.test(key)) return null;
  }
  // Only the explicitly selected stored-D1 taxonomy ignores make/model. Its
  // repository predicate is platform only; provider-compatible callers retain
  // exact queries. Do not merge unsupported/case-sensitive platform inputs.
  const platforms = url.searchParams.getAll("platform");
  const taxonomyKeys = [...url.searchParams.keys()];
  const canonicalTaxonomy = storedTaxonomy === true && url.pathname === "/api/filters"
    && taxonomyKeys.every(key => ["make", "model", "platform"].includes(key) && url.searchParams.getAll(key).length === 1)
    && platforms.length <= 1 && [null, "", "copart", "iaai"].includes(url.searchParams.get("platform"));
  // All other routes preserve their exact encoded path and complete query.
  const keyUrl = new URL(url.origin);
  keyUrl.pathname = "/__rexbid-stored-cache/" + (canonicalTaxonomy ? "v3-stored-taxonomy/" : url.pathname === "/api/filters" ? "v2-taxonomy/" : "v1/") + encodeURIComponent(namespace) + url.pathname;
  if (canonicalTaxonomy) {
    const platform = url.searchParams.get("platform");
    if (platform) keyUrl.searchParams.set("platform", platform);
  } else keyUrl.search = url.search;
  return new Request(keyUrl.href, {method:"GET"});
}

function privateKey(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^(?:private|internal|auth|session|password|secret|token|apikey|accesskey|refreshkey|keyring|supabase|customer|client|account|user|admin|portal|personal|pii)/.test(normalized)
    || /^owner(?:$|id|name|email|phone|address|data|profile|token|key|secret|role|subject)/.test(normalized)
    || /(?:email|phone|telephone|password|secret|token|cookie)$/.test(normalized)
    || new Set(["mobile", "ssn", "nationalid", "passport", "roles", "permissions", "orders", "order", "messages", "attachments", "raw", "rawpayload", "providerpayload"]).has(normalized);
}

function inspectPublicBody(body, maxAgeMs, now, taxonomy = false) {
  if (!body || typeof body !== "object" || Array.isArray(body) || body.ok === false) return {safe:false, ttl:0};
  // The longer policy is only for explicit stored taxonomy, never offers or a
  // loosely shaped provider response accidentally returned on this route.
  if (taxonomy && !taxonomyBody(body)) return {safe:false,ttl:0};
  const asOf = taxonomy ? body.meta.taxonomy_as_of : null;
  if (asOf && (Date.parse(asOf.from) > now || Date.parse(asOf.to) > now + 5000)) return {safe:false,ttl:0};
  // Edge cache age cannot extend the 24h lifetime of the oldest build page.
  let safe = true, remaining = asOf ? TAXONOMY_MAX_AGE_MS - (now - Date.parse(asOf.from)) : Infinity, inspected = 0;
  const walk = (item, depth = 0) => {
    if (!item || typeof item !== "object" || !safe) return;
    if (depth > 24 || ++inspected > 50000) { safe = false; return; }
    if (Array.isArray(item)) { item.forEach(value => walk(value, depth + 1)); return; }
    const freshness = typeof item.freshness === "object" ? item.freshness : null;
    const status = freshness?.status || item.freshness_status || (typeof item.freshness === "string" ? item.freshness : "");
    if (status === "fresh") {
      if (typeof freshness?.age_ms === "number" && Number.isFinite(freshness.age_ms) && freshness.age_ms >= 0)
        remaining = Math.min(remaining, maxAgeMs - freshness.age_ms);
      const stamp = freshness?.last_synced_at || item.last_synced_at;
      if (typeof stamp === "string" && Number.isFinite(Date.parse(stamp)))
        remaining = Math.min(remaining, maxAgeMs - Math.max(0, now - Date.parse(stamp)));
    }
    for (const [key, value] of Object.entries(item)) {
      if (privateKey(key) || (key === "provider_fallback_enabled" && value === true)
        || (["read_source", "source"].includes(key) && ["provider", "hybrid"].includes(value))) { safe = false; return; }
      walk(value, depth + 1);
    }
  };
  walk(body);
  return {safe, ttl:Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining / 1000)) : taxonomy ? FILTER_TTL_SECONDS : MAX_TTL_SECONDS};
}

async function inspectResponse(response, maxAgeMs, now, taxonomy = false) {
  if (!(response instanceof Response) || response.status !== 200 || response.headers.has("Set-Cookie")
    || !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(response.headers.get("Content-Type") || "")) return {safe:false, ttl:0};
  const vary = (response.headers.get("Vary") || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (vary.some(value => value !== "accept-encoding")) return {safe:false, ttl:0};
  try {
    const text = await response.clone().text();
    if (text.length > 2 * 1024 * 1024) return {safe:false, ttl:0};
    return inspectPublicBody(JSON.parse(text), maxAgeMs, now, taxonomy);
  } catch (_) { return {safe:false, ttl:0}; }
}

function clientResponse(response, status, ttl = 0, metadata = null) {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.delete(STORED_AT); headers.delete(CACHE_TTL);
  headers.set("X-RexBid-Cache", status);
  headers.set("Cache-Control", ttl > 0 ? `public, max-age=${ttl}, s-maxage=${ttl}` : "private, no-store");
  if (ttl > 0) { headers.delete("Pragma"); headers.delete("Expires"); }
  if (metadata) {
    headers.set("X-RexBid-Metadata-Generated-At", new Date(metadata.generatedAt).toISOString());
    headers.set("X-RexBid-Metadata-Expires-At", new Date(metadata.expiresAt).toISOString());
    headers.set("X-RexBid-Metadata-Max-Age", String(metadata.maxAge));
  }
  return new Response(response.body, {status:response.status,statusText:response.statusText,headers});
}

/** Cache only controlled public stored-read callbacks. Never fetches a provider,
 * logs identity/query data, mutates observation timestamps or caches accounts.
 * A missing/failing Cache API cannot prevent the supplied loader from running. */
async function cachedStoredRead(request, cache, load, {namespace, maxAgeSeconds,
  maxAgeMs = FRESHNESS_MAX_AGE_MS, context, revalidateClient = false, storedTaxonomy = false} = {}) {
  if (typeof load !== "function") throw new TypeError("Stored read loader is required.");
  const taxonomy = new URL(request.url).pathname === "/api/filters";
  const maximum = taxonomy ? FILTER_TTL_SECONDS : MAX_TTL_SECONDS;
  const requestedTtl = maxAgeSeconds === undefined ? maximum : Number(maxAgeSeconds);
  const limit = Number.isFinite(requestedTtl) ? Math.max(0, Math.min(maximum, Math.floor(requestedTtl))) : 0;
  const freshnessLimit = Number.isFinite(Number(maxAgeMs)) ? Math.max(0, Math.min(FRESHNESS_MAX_AGE_MS, Number(maxAgeMs))) : FRESHNESS_MAX_AGE_MS;
  // Run an async namespace lookup only after all public/private request gates.
  // Failure must not fall back to a stale unversioned cache key.
  let resolvedNamespace=namespace;
  if(typeof namespace==='function'){
    if(limit<=0||!cacheKey(request,'public-eligibility'))return clientResponse(await load(),'BYPASS');
    try{resolvedNamespace=await namespace();}catch{return clientResponse(await load(),'BYPASS');}
  }
  const respond=(response,status,ttl=0,metadata=null)=>{
    const result=clientResponse(response,status,ttl,metadata);
    if(revalidateClient&&ttl>0&&result instanceof Response)result.headers.set('Cache-Control',`public, max-age=0, s-maxage=${ttl}, must-revalidate`);
    return result;
  };
  const key = limit > 0 ? cacheKey(request, resolvedNamespace, storedTaxonomy) : null;
  const storage = cache || globalThis.caches?.default;
  if (!key) return respond(await load(), "BYPASS");
  if (storage?.match) {
    try {
      const cached = await storage.match(key);
      if (cached instanceof Response) {
        const savedAt = Number(cached.headers.get(STORED_AT));
        const savedTtl = Number(cached.headers.get(CACHE_TTL));
        const current = Date.now(), elapsed = Math.max(0, current - savedAt);
        const available = Number.isFinite(savedAt) && savedAt > 0 && savedAt <= current && Number.isFinite(savedTtl)
          ? Math.floor((Math.min(limit, savedTtl) * 1000 - elapsed) / 1000) : 0;
        const inspection = available > 0 ? await inspectResponse(cached, freshnessLimit, Date.now(), taxonomy) : {safe:false,ttl:0};
        const ttl = Math.min(available, inspection.ttl);
        if (inspection.safe && ttl > 0) return respond(cached.clone(), "HIT", ttl,
          taxonomy ? {generatedAt:savedAt,expiresAt:savedAt + Math.min(limit,savedTtl) * 1000,maxAge:Math.min(limit,savedTtl)} : null);
      }
    } catch (_) { /* cache lookup failure falls through to the stored loader */ }
  }
  const response = await load();
  const generatedAt = Date.now();
  const inspection = await inspectResponse(response, freshnessLimit, generatedAt, taxonomy);
  const ttl = Math.min(limit, inspection.ttl);
  if (!inspection.safe || ttl <= 0) return respond(response, "BYPASS");
  const result = respond(response, storage?.put ? "MISS" : "BYPASS", ttl,
    taxonomy ? {generatedAt,expiresAt:generatedAt + ttl * 1000,maxAge:ttl} : null);
  if (storage?.put) {
    const headers = new Headers(result.headers);
    headers.set(STORED_AT, String(generatedAt)); headers.set(CACHE_TTL, String(ttl));
    const cached = new Response(result.clone().body,{status:result.status,statusText:result.statusText,headers});
    const write = Promise.resolve().then(() => storage.put(key, cached)).catch(() => {});
    if (typeof context?.waitUntil === "function") {
      try { context.waitUntil(write); } catch (_) { await write; }
    } else await write;
  }
  return result;
}

module.exports = {cachedStoredRead};
