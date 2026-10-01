"use strict";

const {D1ReadRepository, toPublicVehicleDTO} = require("../sync/d1-read-repository.js");

const STAGING_HOST = "rexbid-auth-test.tedn828.workers.dev";
const DETAIL_MAX_AGE_DEFAULT = 86_400_000;
const HISTORY_MAX_AGE_DEFAULT = 21_600_000;

function enabledFor(request, env) {
  const url = new URL(request.url);
  return url.protocol === "https:" && url.hostname === STAGING_HOST
    && env?.REXBID_AUTH_TEST_UI === "enabled"
    && env?.REXBID_AUTH_TEST_HOST === STAGING_HOST
    && env?.REXBID_D1_READ_TARGET === "rexbid-auth-test-db"
    && env?.REXBID_D1_PRIMARY_READS === "true";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {
    "Content-Type": "application/json; charset=UTF-8",
    "Cache-Control": "private, no-store", "Pragma": "no-cache",
    "X-Robots-Tag": "noindex, nofollow, noarchive", "X-RexBid-Cache": "BYPASS"
  }});
}

function safeRoute(path) {
  if (path === "/api/cars") return "/api/cars";
  if (path === "/api/filters") return "/api/filters";
  if (/^\/api\/car\/[^/]+\/history$/.test(path)) return "/api/car/:identifier/history";
  return "/api/car/:identifier";
}

function logRead({route, source, hit, freshness, fallbackReason, started, cache = "bypass", status}) {
  console.info("Rex.Bid staging public read", JSON.stringify({
    request_id: crypto.randomUUID(), route, read_source: source, d1_hit: hit, freshness,
    fallback_reason: fallbackReason || null, cache,
    duration_ms: Math.max(0, Date.now() - started), status
  }));
}

function maxAge(env, name, fallback) {
  const value = Number(env?.[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function d1Repo(env, {history = false} = {}) {
  const binding = env?.REXBID_DB;
  if (!binding || typeof binding.prepare !== "function") throw new Error("D1_UNAVAILABLE");
  return new D1ReadRepository(binding, {maxAgeMs: maxAge(env,
    history ? "REXBID_D1_HISTORY_MAX_AGE_MS" : "REXBID_D1_DETAIL_MAX_AGE_MS",
    history ? HISTORY_MAX_AGE_DEFAULT : DETAIL_MAX_AGE_DEFAULT)});
}

function coverageMetadata(coverage) {
  const platforms = coverage?.platforms || [];
  return {catalog_complete: Boolean(coverage?.complete), scope_status: coverage?.complete ? "complete"
      : platforms.some(item => item.status === "failed") ? "failed"
      : platforms.some(item => item.status === "stale") ? "stale"
      : platforms.every(item => item.status === "not_synced") ? "missing" : "partial",
    platform_coverage: platforms.map(item => ({platform: item.platform, status: item.status,
      complete: item.complete, scope_count: item.scope_count, cursor_present: item.next_page_available,
      last_complete_at: item.last_complete_at}))};
}

function readMeta(repoResult, coverage, extras = {}) {
  return {read_source: "d1", ...coverageMetadata(coverage), freshness: repoResult?.freshness || null,
    ...extras};
}

function providerMeta(reason, coverage = null) {
  return {read_source: "provider", fallback_reason: reason,
    catalog_complete: false, scope_status: coverageMetadata(coverage).scope_status,
    platform_coverage: coverageMetadata(coverage).platform_coverage};
}

function mergeNonNull(base, newer) {
  if (newer === null || newer === undefined || newer === "") return base;
  if (Array.isArray(newer)) return newer.length ? newer : base;
  if (typeof newer !== "object") return newer;
  const out = base && typeof base === "object" && !Array.isArray(base) ? {...base} : {};
  for (const [key, value] of Object.entries(newer)) out[key] = mergeNonNull(out[key], value);
  return out;
}

async function fallback(request, env, executionContext, delegate, {reason, coverage = null, staleDto = null, route, started, hit}) {
  const response = await delegate(request, env, executionContext);
  let body;
  try { body = await response.clone().json(); } catch {
    logRead({route, source: "provider", hit, freshness: "unknown", fallbackReason: reason, started, status: response.status});
    return response;
  }
  const meta = providerMeta(reason, coverage);
  if (staleDto && response.status === 200 && body?.ok === true && body.data) {
    body.data = mergeNonNull(staleDto, body.data);
    body.source = "hybrid";
    body.read_source = "hybrid";
    body.fallback_reason = reason;
    body.read = {...(body.read || {}), source: "hybrid", freshness: "stale", fallback_reason: reason,
      catalog_complete: meta.catalog_complete, scope_status: meta.scope_status, platform_coverage: meta.platform_coverage};
    logRead({route, source: "hybrid", hit, freshness: "stale", fallbackReason: reason, started, status: response.status});
  } else {
    body.read_source = "provider";
    body.fallback_reason = reason;
    body.read = {...(body.read || {}), ...meta};
    if (body.meta && typeof body.meta === "object") body.meta = {...body.meta, ...meta};
    logRead({route, source: "provider", hit, freshness: "unknown", fallbackReason: reason, started, status: response.status});
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-RexBid-Read-Source", staleDto && response.status === 200 && body?.source === "hybrid" ? "hybrid" : "provider");
  return new Response(JSON.stringify(body), {status: response.status, statusText: response.statusText, headers});
}

function queryOptions(url, now = Date.now()) {
  const q = url.searchParams;
  const intOrNull = value => value !== null && /^\d+$/.test(value) ? Number(value) : null;
  const numberOrNull = value => value !== null && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
  const status = (q.get("lot_status") || "").trim();
  const statusLower = status.toLowerCase();
  const lotSubStatus = q.get("lot_sub_status");
  const timed = statusLower === "timed" ? true : q.has("timed") ? q.get("timed") === "true" : null;
  const buyNow = statusLower === "buy now" || q.get("buy_now") === "true";
  const auctionState = lotSubStatus || (status && !["timed", "buy now"].includes(statusLower) ? status : null);
  return {platform: q.get("platform"), make: q.get("make"), model: q.get("model"), search: q.get("s") || q.get("search"),
    yearFrom: intOrNull(q.get("year_from")), yearTo: intOrNull(q.get("year_to")),
    timed, buyNow, auctionState,
    // lot_sub_status maps to the canonical auction state, not the provider's
    // display/raw source_status (which can be an auction date or formatted label).
    sourceStatus: q.get("source_status"),
    upcoming: ["only", "without"].includes(q.get("upcoming")) ? q.get("upcoming") : null,
    bodyStyle: q.get("type"), fuelType: q.get("fuel_type"), transmission: q.get("transmission"),
    driveType: q.get("drive_type"), runCondition: q.get("run_cond"), damage: q.get("damage"),
    sellerType: q.get("seller_type"), saleDocumentType: q.get("sale_document_type"), locationState: q.get("loc_state"),
    priceMin: numberOrNull(q.get("price_min")), priceMax: numberOrNull(q.get("price_max")),
    odometerFrom: numberOrNull(q.get("odometer_from")), odometerTo: numberOrNull(q.get("odometer_to")),
    nowIso: new Date(now).toISOString(),
    limit: q.has("per_page") && /^\d+$/.test(q.get("per_page")) ? Math.min(50, Math.max(1, Number(q.get("per_page")))) : 20,
    cursor: q.get("cursor")};
}

async function handlePrimaryRead(request, env, executionContext, delegate) {
  if (!enabledFor(request, env)) return null;
  const url = new URL(request.url);
  const isList = url.pathname === "/api/cars";
  const isFilters = url.pathname === "/api/filters";
  const isHistory = /^\/api\/car\/[^/]+\/history$/.test(url.pathname);
  const isDetail = /^\/api\/car\/[^/]+$/.test(url.pathname);
  if (!isList && !isFilters && !isHistory && !isDetail) return null;
  if (request.method !== "GET") return null;

  const started = Date.now();
  const route = safeRoute(url.pathname);
  let repo;
  let coverage = null;
  try {
    repo = d1Repo(env, {history: isHistory});
    coverage = await repo.getCoverage();
  } catch {
    return fallback(request, env, executionContext, delegate, {reason: "d1_unavailable_or_schema_mismatch",
      route, started, hit: false});
  }

  try {
    if (isList) {
      const options = queryOptions(url, Date.now());
      const result = await repo.listCatalog(options);
      // Report both platform scopes even when the listing query filters to one
      // platform. A filtered page must not make a partial global catalog look complete.
      const coverageInfo = coverageMetadata(coverage);
      const body = {ok: true, data: result.records.map(item => toPublicVehicleDTO(item.vehicle)),
        meta: {...result.page, ...coverageInfo, read_source: "d1", metadata_complete: false,
          known_rows_only: true, freshness: result.read.freshness}};
      logRead({route, source: "d1", hit: result.records.length > 0, freshness: result.read.freshness.status,
        started, status: 200});
      return json(body);
    }

    if (isFilters) {
      const result = await repo.getFilterMetadata({platform: url.searchParams.get("platform")});
      // Filter values are derived from known rows only; global scope coverage
      // remains visible even when metadata is requested for one platform.
      const coverageInfo = coverageMetadata(coverage);
      logRead({route, source: "d1", hit: result.read.row_count > 0, freshness: "partial_or_unknown", started, status: 200});
      return json({ok: true, data: result.values, meta: {read_source: "d1", ...coverageInfo,
        metadata_complete: false, known_rows_only: true, row_count: result.read.row_count}});
    }

    const historyMatch = isHistory ? url.pathname.match(/^\/api\/car\/([^/]+)\/history$/) : null;
    const detailMatch = isDetail ? url.pathname.match(/^\/api\/car\/([^/]+)$/) : null;
    let identifier;
    try { identifier = decodeURIComponent((historyMatch || detailMatch)?.[1] || ""); }
    catch { return json({ok: false, error: "invalid_identifier"}, 400); }
    if (!identifier) return json({ok: false, error: "identifier_required"}, 400);
    const stored = await repo.getListingByIdentifier(identifier, {platform: url.searchParams.get("platform")});
    if (stored?.ambiguous) return fallback(request, env, executionContext, delegate, {reason: "d1_identifier_ambiguous",
      coverage, route, started, hit: false});
    if (!stored) return fallback(request, env, executionContext, delegate, {reason: "d1_record_missing",
      coverage, route, started, hit: false});

    if (isDetail) {
      const vehicle = stored.vehicle;
      const hasMinimumSummary = Boolean(vehicle.platform && (vehicle.vin || vehicle.lot)
        && (vehicle.make || vehicle.model || vehicle.year));
      if (stored.freshness.status !== "fresh" || !hasMinimumSummary) {
        return fallback(request, env, executionContext, delegate, {reason: stored.freshness.status !== "fresh" ? "d1_detail_stale" : "d1_detail_incomplete",
          coverage, staleDto: toPublicVehicleDTO(vehicle), route, started, hit: true});
      }
      const body = {ok: true, data: toPublicVehicleDTO(vehicle), source: "d1", match: "exact",
        read_source: "d1", fallback_reason: null,
        read: {source: "d1", freshness: stored.freshness.status, last_seen_at: stored.freshness.last_seen_at,
          last_synced_at: stored.freshness.last_synced_at, ...coverageMetadata(await repo.getCoverage(vehicle.platform))}};
      logRead({route, source: "d1", hit: true, freshness: stored.freshness.status, started, status: 200});
      return json(body);
    }

    const snapshots = await repo.getSnapshotPage({listingId: stored.listing_id,
      limit: queryOptions(url).limit, cursor: url.searchParams.get("cursor")});
    const events = await repo.getConfirmedEvents({listingId: stored.listing_id, limit: 100});
    const latestObservation = snapshots.snapshots[0]?.observed_at || stored.freshness.last_synced_at;
    const age = latestObservation ? Math.max(0, Date.now() - Date.parse(latestObservation)) : null;
    const historyFreshness = age !== null && age <= maxAge(env, "REXBID_D1_HISTORY_MAX_AGE_MS", HISTORY_MAX_AGE_DEFAULT) ? "fresh" : "stale";
    if (historyFreshness === "stale") return fallback(request, env, executionContext, delegate, {
      reason: "d1_history_stale", coverage, route, started, hit: true});
    const kind = events.length && snapshots.snapshots.length ? "events_and_snapshots"
      : events.length ? "confirmed_events" : snapshots.snapshots.length ? "snapshots_only" : "empty";
    const body = {ok: true, data: null, source: "d1", read_source: "d1", fallback_reason: null,
      history: events, meta: {...snapshots.page, per_page: snapshots.page.per_page, next_cursor: snapshots.page.next_cursor,
        read_source: "d1", history_kind: kind, freshness: historyFreshness, ...coverageMetadata(coverage)},
      rex_history: {count: events.length, records: events, events, snapshots: snapshots.snapshots, kind},
      read: {source: "d1", history_kind: kind, freshness: historyFreshness,
        observed_snapshot_count: snapshots.snapshots.length, confirmed_event_count: events.length, ...coverageMetadata(coverage)}};
    logRead({route, source: "d1", hit: true, freshness: historyFreshness, started, status: 200});
    return json(body);
  } catch {
    return fallback(request, env, executionContext, delegate, {reason: "d1_query_failed_or_schema_mismatch",
      coverage, route, started, hit: false});
  }
}

module.exports = {STAGING_HOST, enabledFor, handlePrimaryRead, coverageMetadata, queryOptions, mergeNonNull};
