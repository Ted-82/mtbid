"use strict";

const {D1ReadRepository, toPublicVehicleDTO} = require("../sync/d1-read-repository.js");

const STAGING_HOST = "rexbid-auth-test.tedn828.workers.dev";
const PATH_PREFIX = "/__staging/d1-read/";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {
    "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "private, no-store",
    "Pragma": "no-cache", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer"
  }});
}

function positiveInteger(value, fallback, max) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= max ? number : null;
}

async function handleD1ReadRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PATH_PREFIX)) return null;
  const enabled = url.protocol === "https:" && url.hostname === STAGING_HOST
    && env?.REXBID_AUTH_TEST_UI === "enabled"
    && env?.REXBID_AUTH_TEST_HOST === STAGING_HOST
    && env?.REXBID_D1_READ_DIAGNOSTICS === "enabled"
    && env?.REXBID_D1_READ_TARGET === "rexbid-auth-test-db";
  if (!enabled) return json({ok: false, error: "not_found"}, 404);
  if (request.method !== "GET") return json({ok: false, error: "method_not_allowed"}, 405);
  const db = env?.REXBID_DB;
  if (!db || typeof db.prepare !== "function") return json({ok: false, error: "d1_unavailable"}, 503);
  const repo = new D1ReadRepository(db, {maxAgeMs: positiveInteger(env.REXBID_D1_READ_MAX_AGE_MS, 86_400_000, 31_536_000_000)});
  const operation = url.pathname.slice(PATH_PREFIX.length).replace(/\/$/, "");
  try {
    let payload;
    if (operation === "catalog") {
      const limit = positiveInteger(url.searchParams.get("per_page"), 20, 50);
      if (!limit) return json({ok: false, error: "invalid_page_size"}, 400);
      const page = await repo.listCatalog({
        platform: url.searchParams.get("platform"), make: url.searchParams.get("make"), model: url.searchParams.get("model"),
        yearFrom: url.searchParams.has("year_from") ? Number(url.searchParams.get("year_from")) : null,
        yearTo: url.searchParams.has("year_to") ? Number(url.searchParams.get("year_to")) : null,
        timed: url.searchParams.has("timed") ? url.searchParams.get("timed") === "true" : null,
        buyNow: url.searchParams.get("buy_now") === "true", auctionState: url.searchParams.get("status"),
        limit, cursor: url.searchParams.get("cursor")
      });
      payload = {ok: true, data: page.records.map(record => toPublicVehicleDTO(record.vehicle)),
        meta: {...page.page, read_source: page.read.source, catalog_complete: page.read.catalog_complete,
          coverage: page.read.coverage, freshness: page.read.freshness}};
    } else if (operation === "detail") {
      const listingId = url.searchParams.get("listing_id");
      if (!listingId) return json({ok: false, error: "listing_id_required"}, 400);
      const listing = await repo.getListingById(listingId);
      if (!listing) return json({ok: false, error: "not_found", read_source: "d1"}, 404);
      const coverage = await repo.getCoverage(listing.vehicle.platform);
      payload = {ok: true, data: toPublicVehicleDTO(listing.vehicle), source: "d1", match: "exact",
        read: {source: "d1", freshness: listing.freshness, freshness_class: listing.freshness_class,
          last_seen_at: listing.freshness.last_seen_at, last_synced_at: listing.freshness.last_synced_at,
          catalog_complete: coverage.complete, scope: coverage.platforms}};
    } else if (operation === "history") {
      const listingId = url.searchParams.get("listing_id");
      const limit = positiveInteger(url.searchParams.get("per_page"), 20, 50);
      if (!listingId || !limit) return json({ok: false, error: "invalid_request"}, 400);
      const listing = await repo.getListingById(listingId);
      if (!listing) return json({ok: false, error: "not_found", read_source: "d1"}, 404);
      const page = await repo.getSnapshotPage({listingId, limit, cursor: url.searchParams.get("cursor")});
      payload = {ok: true, data: null, history: [], source: "d1",
        rex_history: {count: 0, records: [], events: [], snapshots: page.snapshots,
          meta: page.page, kind: "snapshots_only"},
        meta: {next_cursor: page.page.next_cursor, per_page: page.page.per_page,
          has_more: page.page.has_more_stored_rows}, read: page.read};
    } else if (operation === "filters") {
      const result = await repo.getFilterMetadata({platform: url.searchParams.get("platform")});
      payload = {ok: true, data: result.values, meta: {read_source: result.read.source,
        metadata_complete: result.read.metadata_complete, known_rows_only: true, coverage: result.read.coverage}};
    } else {
      return json({ok: false, error: "not_found"}, 404);
    }
    const requestId = crypto.randomUUID();
    const source = payload.read?.source || payload.meta?.read_source || "d1";
    const freshness = payload.read?.freshness?.status || "partial_or_unknown";
    console.info("Rex.Bid staging D1 read", JSON.stringify({request_id: requestId, operation,
      read_source: source, cache: "bypass", freshness, fallback_reason: "diagnostic_d1_only"}));
    return json({...payload, request_id: requestId});
  } catch (error) {
    const code = error instanceof RangeError ? "invalid_page_size" : error instanceof TypeError ? "invalid_request" : "d1_read_failed";
    console.warn("Rex.Bid staging D1 read", JSON.stringify({operation, read_source: "d1", error_code: code}));
    return json({ok: false, error: code}, code === "invalid_request" || code === "invalid_page_size" ? 400 : 503);
  }
}

module.exports = {handleD1ReadRequest, STAGING_HOST, PATH_PREFIX};
