import rexWorker from "./worker.js";
import readRepository from "./sync/d1-read-repository.js";
import readTools from "./staging/d1-primary-reads.cjs";

const {D1ReadRepository, toPublicVehicleDTO} = readRepository;
const {coverageMetadata, queryOptions} = readTools;
const PREVIEW_ORIGIN = "https://preview.rexbid.pl";
const PREVIEW_DATABASE = "rexbid-auth-test-db";
const PREVIEW_DATABASE_ID = "acb3cb8e-69a2-459f-8a46-0f2f5b9004be";
const DEFAULT_MAX_AGE_MS = 86400000;

// This entrypoint has no provider fallback and never delegates an API route,
// mutation, health check or diagnostics endpoint to the production Worker.
function enabled(request, env) {
  return new URL(request.url).origin === PREVIEW_ORIGIN
    && env?.REXBID_PREVIEW_ENABLED === "enabled"
    && env?.REXBID_PREVIEW_ORIGIN === PREVIEW_ORIGIN
    && env?.REXBID_PREVIEW_D1_TARGET === PREVIEW_DATABASE
    && env?.REXBID_PREVIEW_D1_DATABASE_ID === PREVIEW_DATABASE_ID
    && env?.AUTH_ENABLED === "false"
    && env?.REXBID_LEGACY_SYNC_ENABLED === "false";
}

function secure(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

function json(body, status = 200) {
  return secure(new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json; charset=UTF-8"}}));
}

function error(message, code, status) {
  return json({ok: false, error: message, code, preview: {read_only: true, provider_fallback: false}}, status);
}

function maxAge(env) {
  const value = Number(env?.REXBID_PREVIEW_MAX_AGE_MS);
  return Number.isSafeInteger(value) && value >= 0 && value <= 7 * DEFAULT_MAX_AGE_MS ? value : DEFAULT_MAX_AGE_MS;
}

function publicVehicle(record) {
  const vehicle = toPublicVehicleDTO(record.vehicle);
  vehicle.preview = {read_only: true, freshness: record.freshness.status,
    last_seen_at: record.freshness.last_seen_at, last_synced_at: record.freshness.last_synced_at};
  if (record.freshness.status !== "fresh") {
    // A stored future timestamp cannot establish that an auction is still open.
    // Preserve observed prices/photos, while suppressing live/upcoming countdowns.
    vehicle.auction = {...vehicle.auction, state: "unknown", formatted: "Stan aukcji wymaga aktualizacji",
      auction_at: null, timed_end_at: null, schedule_status: "unknown", is_timed: false};
  }
  return vehicle;
}

async function catalogRead(request, env) {
  const url = new URL(request.url);
  const isCatalog = url.pathname === "/api/cars";
  const isFilters = url.pathname === "/api/filters";
  const match = url.pathname.match(/^\/api\/car\/([^/]+)(\/history)?$/);
  if (!isCatalog && !isFilters && !match) return error("Nie znaleziono zasobu podglądu.", "preview_route_not_found", 404);
  if (!env?.REXBID_DB || typeof env.REXBID_DB.prepare !== "function") return error("Katalog podglądu jest chwilowo niedostępny.", "preview_d1_unavailable", 503);
  try {
    const repository = new D1ReadRepository(env.REXBID_DB, {maxAgeMs: maxAge(env)});
    const coverage = coverageMetadata(await repository.getCoverage());
    const preview = {read_only: true, provider_fallback: false, catalog_source: "staging_d1"};
    if (isCatalog) {
      const result = await repository.listCatalog(queryOptions(url));
      return json({ok: true, data: result.records.map(publicVehicle), preview,
        meta: {...result.page, ...coverage, read_source: "d1", known_rows_only: true,
          metadata_complete: false, freshness: result.read.freshness}});
    }
    if (isFilters) {
      const result = await repository.getFilterMetadata({platform: url.searchParams.get("platform")});
      return json({ok: true, data: result.values, preview, meta: {...coverage, read_source: "d1",
        known_rows_only: true, metadata_complete: false, row_count: result.read.row_count}});
    }
    let identifier;
    try { identifier = decodeURIComponent(match[1]); } catch { return error("Nieprawidłowy identyfikator pojazdu.", "invalid_identifier", 400); }
    if (!identifier || identifier.length > 100 || /[\\/?#]/.test(identifier)) return error("Nieprawidłowy identyfikator pojazdu.", "invalid_identifier", 400);
    const stored = await repository.getListingByIdentifier(identifier, {platform: url.searchParams.get("platform")});
    if (stored?.ambiguous) return error("Wskaż platformę aukcji dla tego numeru LOT lub VIN.", "preview_identifier_ambiguous", 409);
    if (!stored) return error("Tego pojazdu nie ma w częściowym katalogu podglądu.", "preview_vehicle_not_stored", 404);
    const read = {source: "d1", freshness: stored.freshness.status,
      last_seen_at: stored.freshness.last_seen_at, last_synced_at: stored.freshness.last_synced_at, ...coverage};
    if (!match[2]) return json({ok: true, data: publicVehicle(stored), source: "d1", read_source: "d1",
      match: "exact", fallback_reason: null, preview, read});
    const snapshots = await repository.getSnapshotPage({listingId: stored.listing_id,
      limit: queryOptions(url).limit, cursor: url.searchParams.get("cursor")});
    const events = await repository.getConfirmedEvents({listingId: stored.listing_id, limit: 100});
    const historyAvailability = await repository.getHistoryAvailability({listingId: stored.listing_id, events});
    const kind = events.length && snapshots.snapshots.length ? "events_and_snapshots"
      : events.length ? "confirmed_events" : snapshots.snapshots.length ? "snapshots_only" : "empty";
    return json({ok: true, data: null, source: "d1", read_source: "d1", fallback_reason: null,
      history: events, preview, meta: {...snapshots.page, read_source: "d1", history_kind: kind, history_availability: historyAvailability,
        freshness: stored.freshness.status, ...coverage},
      rex_history: {count: events.length, records: events, events, snapshots: snapshots.snapshots, kind},
      read: {...read, history_kind: kind, observed_snapshot_count: snapshots.snapshots.length, confirmed_event_count: events.length}});
  } catch (failure) {
    if (failure instanceof TypeError || failure instanceof RangeError) return error("Nieprawidłowe parametry katalogu podglądu.", "preview_invalid_query", 400);
    return error("Katalog podglądu jest chwilowo niedostępny.", "preview_d1_read_failed", 503);
  }
}

async function addPreviewNotice(response) {
  if (!(response.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) return secure(response);
  const html = await response.text();
  const notice = '<aside class="rexbid-d1-partial-badge" role="status">Podgląd REXBID • częściowy katalog • dane zapisane, bez odświeżania aukcji i składania ofert</aside>';
  const updated = html.replace(/<body\b[^>]*>/i, body => `${body}${notice}`);
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  return secure(new Response(updated, {status: response.status, statusText: response.statusText, headers}));
}

export default {
  async fetch(request, env, executionContext) {
    if (!enabled(request, env)) return error("Podgląd nie jest dostępny pod tym adresem.", "preview_not_enabled", 404);
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__staging") || url.pathname === "/auth-test.html") return error("Nie znaleziono zasobu.", "preview_route_not_found", 404);
    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/me" || url.pathname.startsWith("/api/me/")) {
      if (request.method === "GET" && url.pathname === "/api/auth/config") return json({ok: true, enabled: false,
        reason: "preview_read_only", message: "Konta i logowanie są wyłączone w podglądzie. Ulubione możesz zapisywać lokalnie."});
      return error("Konta i logowanie są wyłączone w podglądzie. Ulubione możesz zapisywać lokalnie.", "preview_accounts_disabled", 503);
    }
    if (url.pathname === "/api/contact/config" && ["GET", "HEAD"].includes(request.method)) {
      // Explicit configuration-only exception: the shared handler sanitizes a
      // public contact address and does not send messages or persist inquiries.
      return secure(await rexWorker.fetch(request, {...env, AUTH_ENABLED: "false", REXBID_LEGACY_SYNC_ENABLED: "false"}, executionContext));
    }
    if (request.method !== "GET") return error("Podgląd obsługuje wyłącznie odczyt.", "preview_read_only", 405);
    if (url.pathname === "/health") return json({ok: true, status: "preview", read_only: true});
    if (url.pathname === "/ready") {
      try {
        const probe = await env?.REXBID_DB?.prepare?.("SELECT 1 AS ready").first();
        const asset = await env?.ASSETS?.fetch?.(new Request(`${PREVIEW_ORIGIN}/robots.txt`));
        const ready = probe?.ready === 1 && asset?.ok === true;
        return json({ok: ready, status: ready ? "preview_ready" : "preview_not_ready", read_only: true}, ready ? 200 : 503);
      } catch { return error("Podgląd jest chwilowo niedostępny.", "preview_not_ready", 503); }
    }
    if (url.pathname === "/robots.txt") return secure(new Response("User-agent: *\nDisallow: /\n", {headers: {"Content-Type": "text/plain; charset=UTF-8"}}));
    if (url.pathname === "/sitemap.xml") return error("Podgląd nie udostępnia mapy witryny.", "preview_route_not_found", 404);
    if (url.pathname.startsWith("/api/")) return catalogRead(request, env);
    // Only HTML/assets reach the shared renderer; API/provider paths cannot.
    const renderEnv = {...env, AUTH_ENABLED: "false", REXBID_LEGACY_SYNC_ENABLED: "false"};
    return addPreviewNotice(await rexWorker.fetch(request, renderEnv, executionContext));
  }
};
