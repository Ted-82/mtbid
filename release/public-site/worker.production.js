import rexWorker from "./worker.js";
import readRepository from "./sync/d1-read-repository.js";
import readUtils from "./sync/public-read-utils.cjs";

const {D1ReadRepository, toPublicVehicleDTO} = readRepository;
const {coverageMetadata, queryOptions} = readUtils;
const ORIGIN = "https://rexbid.pl";
const DATABASE = "rexbid-db";
const DATABASE_ID = "971879fe-04ed-4e8c-9dc6-5306980bb872";
const DEFAULT_MAX_AGE_MS = 86400000;
const ZERO_BUDGETS = ["DAILY_LIMIT", "CATALOG_DAILY_LIMIT", "DETAIL_DAILY_LIMIT", "HISTORY_DAILY_LIMIT",
  "DISCOVERY_DAILY_LIMIT", "MEDIA_DAILY_LIMIT"];
const SCHEMA_READS = [
  "SELECT source_key,provider,platform,provider_vehicle_id FROM vehicle_sources LIMIT 0",
  `SELECT listing_id,source_key,platform,listing_identity_kind,identity_state,source_listing_id,listing_generation,
    vin_normalized,lot,vehicle_title,make,model,trim,year,body_style,fuel_type,transmission,drive_type,engine_size_l,
    odometer_value,odometer_unit,auction_state,source_status,auction_at,is_timed,timed_end_at,current_bid_usd,
    current_bid2_usd,buy_now_usd,final_price_usd,source_price_usd,price_currency,seller_name,seller_type,primary_damage,
    secondary_damage,run_state,keys_present,airbags,document_name,document_type,registration_allowed,export_allowed,
    location_display,location_state,location_postal_code,has_video,has_360,media_urls_json,media_thumbs_json,
    source_updated_at,last_seen_at,summary_synced_at,freshness_class,updated_at FROM auction_listings LIMIT 0`,
  `SELECT event_id,listing_id,provider,provider_event_id,event_key,vin_normalized,platform,lot,auction_date,sale_date,
    source_status,canonical_status,current_bid_usd,buy_now_usd,source_price_usd,final_price_usd,seller_name,seller_type,
    observed_at FROM auction_events LIMIT 0`,
  `SELECT snapshot_id,listing_id,observed_at,auction_state,auction_at,timed_end_at,current_bid_usd,buy_now_usd,
    fingerprint,normalizer_version FROM auction_listing_snapshots LIMIT 0`,
  "SELECT provider,platform,operation,status,cursor,last_complete_at FROM provider_sync_scopes LIMIT 0"
];

function enabled(request, env) {
  return new URL(request.url).origin === ORIGIN
    && env?.REXBID_PRODUCTION_RELEASE_ENABLED === "enabled"
    && env?.REXBID_RELEASE_ORIGIN === ORIGIN && env?.REXBID_CANONICAL_ORIGIN === ORIGIN
    && env?.REXBID_RELEASE_D1_TARGET === DATABASE && env?.REXBID_RELEASE_D1_DATABASE_ID === DATABASE_ID
    && env?.AUTH_ENABLED === "false" && env?.REXBID_LEGACY_SYNC_ENABLED === "false"
    && env?.REXBID_PROVIDER_ENABLED === "false" && env?.REXBID_PROVIDER_BUDGET_MODE === "required"
    && ZERO_BUDGETS.every(name => env?.[`REXBID_PROVIDER_BUDGET_${name}`] === "0");
}

function indexingEnabled(env) { return env?.REXBID_RELEASE_INDEXING === "enabled"; }

function secure(response, request, env, {privateResponse = false} = {}) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
  if (!indexingEnabled(env) || privateResponse) headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (privateResponse || response.status >= 400) {
    headers.set("Cache-Control", "private, no-store");
    headers.set("Pragma", "no-cache");
  }
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return new Response(request.method === "HEAD" ? null : response.body,
    {status: response.status, statusText: response.statusText, headers});
}

function json(body, request, env, status = 200) {
  return secure(new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json; charset=UTF-8"}}),
    request, env, {privateResponse: true});
}

function error(message, code, status, request, env) {
  return json({ok: false, error: message, code, release: {read_only: true, provider_fallback: false}}, request, env, status);
}

function maxAge(env) {
  const value = Number(env?.REXBID_RELEASE_MAX_AGE_MS);
  return Number.isSafeInteger(value) && value >= 0 && value <= 7 * DEFAULT_MAX_AGE_MS ? value : DEFAULT_MAX_AGE_MS;
}

function observationStatus(timestamp, env, now = Date.now()) {
  const observed = Date.parse(timestamp || "");
  // A future auction date is valid; a substantially future observation cannot
  // establish that an auction's current state was actually refreshed.
  if (!Number.isFinite(observed) || observed > now + 60000) return "unknown";
  return Math.max(0, now - observed) <= maxAge(env) ? "fresh" : "stale";
}

function observationRead(record, env) {
  return {source: "d1", freshness: observationStatus(record.freshness.last_synced_at, env),
    last_seen_at: record.freshness.last_seen_at, last_synced_at: record.freshness.last_synced_at};
}

async function currentCoverage(repository, env) {
  const stored = await repository.getCoverage();
  const metadata = coverageMetadata(stored);
  const scopes = (await env.REXBID_DB.prepare(`SELECT platform,status,cursor,last_complete_at FROM provider_sync_scopes
    WHERE operation='discovery'`).all()).results || [];
  const now = Date.now();
  const platforms = metadata.platform_coverage.map(platform => {
    const matching = scopes.filter(scope => scope.platform === platform.platform);
    const statuses = matching.map(scope => observationStatus(scope.last_complete_at, env, now));
    const freshness = statuses.length && statuses.every(status => status === "fresh") ? "fresh"
      : statuses.some(status => status === "stale") ? "stale" : "unknown";
    const complete = platform.complete && matching.length > 0 && matching.every(scope =>
      scope.status === "complete" && scope.cursor === null && observationStatus(scope.last_complete_at, env, now) === "fresh");
    return {...platform, stored_complete: platform.complete, complete, scope_freshness: freshness,
      status: platform.complete && !complete ? freshness : platform.status};
  });
  const complete = platforms.length > 0 && platforms.every(platform => platform.complete);
  return {...metadata, stored_catalog_complete: metadata.catalog_complete, catalog_complete: complete,
    scope_status: complete ? "complete" : platforms.some(platform => platform.status === "stale") ? "stale"
      : platforms.some(platform => platform.stored_complete && platform.status === "unknown") ? "unknown" : metadata.scope_status,
    platform_coverage: platforms};
}

async function verifyReadSchema(env) {
  if (!env?.REXBID_DB || typeof env.REXBID_DB.prepare !== "function") throw new Error("release_schema_unavailable");
  // The declaration of a migration/version cannot establish that the bound DB
  // actually contains the columns consumed by every read route.
  for (const sql of SCHEMA_READS) await env.REXBID_DB.prepare(sql).all();
}

async function storedCount(env) {
  const row = await env.REXBID_DB.prepare(`SELECT COUNT(*) AS count FROM auction_listings l
    JOIN vehicle_sources s ON s.source_key=l.source_key`).first();
  return Number(row?.count) || 0;
}

function publicVehicle(record, env) {
  const vehicle = toPublicVehicleDTO(record.vehicle);
  vehicle.read = observationRead(record, env);
  if (vehicle.read.freshness !== "fresh") {
    vehicle.auction = {...vehicle.auction, state: "unknown", formatted: "Stan aukcji wymaga aktualizacji",
      auction_at: null, timed_end_at: null, schedule_status: "unknown", schedule_precision: "unknown", is_timed: false};
  }
  return vehicle;
}

function contactConfig(request, env) {
  const email = String(env?.REXBID_CONTACT_EMAIL || "").trim();
  const valid = email.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  return json({email: valid ? email : null, mode: valid ? "email_draft" : "local_draft"}, request, env);
}

async function catalogRead(request, env) {
  const url = new URL(request.url);
  const isCatalog = url.pathname === "/api/cars";
  const isFilters = url.pathname === "/api/filters";
  const match = url.pathname.match(/^\/api\/car\/([^/]+)(\/history)?$/);
  if (!isCatalog && !isFilters && !match) return error("Nie znaleziono endpointu.", "release_route_not_found", 404, request, env);
  try { await verifyReadSchema(env); }
  catch { return error("Katalog nie jest jeszcze gotowy do odczytu.", "release_schema_unavailable", 503, request, env); }
  try {
    const repository = new D1ReadRepository(env.REXBID_DB, {maxAgeMs: maxAge(env)});
    const coverage = await currentCoverage(repository, env);
    const release = {read_only: true, provider_fallback: false, catalog_source: "production_d1"};
    if (isCatalog) {
      const result = await repository.listCatalog(queryOptions(url));
      const vehicles = result.records.map(record => publicVehicle(record, env));
      const statuses = vehicles.map(vehicle => vehicle.read.freshness);
      const freshness = {...result.read.freshness, status: statuses.length && statuses.every(status => status === "fresh") ? "fresh"
        : statuses.some(status => status === "stale") ? "stale" : "unknown"};
      return json({ok: true, data: vehicles, release,
        meta: {...result.page, ...coverage, read_source: "d1", known_rows_only: true, metadata_complete: false,
          stored_row_count: await storedCount(env), page_returned_rows: result.records.length,
          freshness}}, request, env);
    }
    if (isFilters) {
      const result = await repository.getFilterMetadata({platform: url.searchParams.get("platform")});
      return json({ok: true, data: result.values, release, meta: {...coverage, read_source: "d1", known_rows_only: true,
        metadata_complete: false, row_count: result.read.row_count}}, request, env);
    }
    let identifier;
    try { identifier = decodeURIComponent(match[1]); }
    catch { return error("Nieprawidłowy identyfikator pojazdu.", "invalid_identifier", 400, request, env); }
    if (!identifier || identifier.length > 100 || /[\\/?#]/.test(identifier)) {
      return error("Nieprawidłowy identyfikator pojazdu.", "invalid_identifier", 400, request, env);
    }
    const stored = await repository.getListingByIdentifier(identifier, {platform: url.searchParams.get("platform")});
    if (stored?.ambiguous) return error("Wskaż platformę aukcji dla tego numeru LOT lub VIN.", "release_identifier_ambiguous", 409, request, env);
    if (!stored) return error("Tego pojazdu nie ma w zapisanym katalogu.", "release_vehicle_not_stored", 404, request, env);
    const read = {...observationRead(stored, env), ...coverage};
    if (!match[2]) return json({ok: true, data: publicVehicle(stored, env), source: "d1", read_source: "d1",
      match: "exact", fallback_reason: null, release, read}, request, env);
    const snapshots = await repository.getSnapshotPage({listingId: stored.listing_id,
      limit: queryOptions(url).limit, cursor: url.searchParams.get("cursor")});
    const events = await repository.getConfirmedEvents({listingId: stored.listing_id, limit: 100});
    const historyAvailability = await repository.getHistoryAvailability({listingId: stored.listing_id, events});
    const kind = events.length && snapshots.snapshots.length ? "events_and_snapshots"
      : events.length ? "confirmed_events" : snapshots.snapshots.length ? "snapshots_only" : "empty";
    const latestObservation = historyAvailability.fetched_at;
    const historyFreshness = observationStatus(latestObservation, env);
    return json({ok: true, data: null, source: "d1", read_source: "d1", fallback_reason: null,
      history: events, release, meta: {...snapshots.page, read_source: "d1", history_kind: kind, history_availability: historyAvailability,
        freshness: historyFreshness, ...coverage},
      rex_history: {count: events.length, records: events, events, snapshots: snapshots.snapshots, kind},
      read: {...read, freshness: historyFreshness, last_history_observed_at: latestObservation,
        history_kind: kind, observed_snapshot_count: snapshots.snapshots.length,
        confirmed_event_count: events.length}}, request, env);
  } catch (failure) {
    if (failure instanceof TypeError || failure instanceof RangeError) {
      return error("Nieprawidłowe parametry katalogu.", "release_invalid_query", 400, request, env);
    }
    return error("Katalog jest chwilowo niedostępny.", "release_d1_read_failed", 503, request, env);
  }
}

async function readiness(request, env) {
  const checks = {read_schema: "unavailable", assets: "unavailable", provider: "disabled", auth: "disabled", sync: "disabled"};
  let catalog = null;
  try {
    await verifyReadSchema(env);
    checks.read_schema = "ok";
    const repository = new D1ReadRepository(env.REXBID_DB, {maxAgeMs: maxAge(env)});
    catalog = {...await currentCoverage(repository, env), stored_row_count: await storedCount(env), known_rows_only: true};
  } catch { checks.read_schema = "unavailable"; }
  try {
    const asset = await env?.ASSETS?.fetch?.(new Request(`${ORIGIN}/`));
    checks.assets = asset?.ok && (asset.headers.get("Content-Type") || "").includes("text/html") ? "ok" : "unavailable";
  } catch { checks.assets = "unavailable"; }
  const ready = checks.read_schema === "ok" && checks.assets === "ok";
  return json({ok: ready, status: ready ? "read_ready" : "not_ready", read_only: true, checks, catalog}, request, env, ready ? 200 : 503);
}

async function decorateHtml(response, request, env) {
  if (!(response.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) return secure(response, request, env);
  let html = await response.text();
  if (!indexingEnabled(env)) {
    const notice = '<aside class="rexbid-d1-partial-badge" role="status">REXBID • wersja do sprawdzenia przed publikacją • konta i wysyłka zapytań jeszcze niedostępne</aside>';
    html = html.replace(/<body\b[^>]*>/i, body => `${body}${notice}`);
  }
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  return secure(new Response(html, {status: response.status, statusText: response.statusText, headers}), request, env);
}

export default {
  async fetch(request, env, executionContext) {
    if (!enabled(request, env)) return error("Wersja produkcyjna nie jest jeszcze aktywna.", "release_not_enabled", 503, request, {...env, REXBID_RELEASE_INDEXING: "disabled"});
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__") || url.pathname === "/auth-test.html") return error("Nie znaleziono zasobu.", "release_route_not_found", 404, request, env);
    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/me" || url.pathname.startsWith("/api/me/")) {
      if (["GET", "HEAD"].includes(request.method) && url.pathname === "/api/auth/config") {
        return json({ok: true, enabled: false, reason: "release_accounts_disabled",
          message: "Konta nie są jeszcze dostępne. Ulubione zapisujesz w tej przeglądarce."}, request, env);
      }
      return error("Konta nie są jeszcze dostępne. Ulubione zapisujesz w tej przeglądarce.", "release_accounts_disabled", 503, request, env);
    }
    if (!["GET", "HEAD"].includes(request.method)) return error("Ta wersja obsługuje wyłącznie odczyt.", "release_read_only", 405, request, env);
    if (url.pathname === "/health") return json({ok: true, status: "alive", read_only: true}, request, env);
    if (url.pathname === "/ready") return readiness(request, env);
    if (url.pathname === "/api/contact/config") return contactConfig(request, env);
    if (url.pathname === "/robots.txt") {
      const body = indexingEnabled(env) ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /konto\nDisallow: /ulubione\nDisallow: /logowanie\nDisallow: /rejestracja\nDisallow: /reset-hasla\n\nSitemap: ${ORIGIN}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n";
      return secure(new Response(body, {headers: {"Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "no-cache"}}), request, env);
    }
    if (url.pathname === "/sitemap.xml") {
      if (!indexingEnabled(env)) return error("Mapa witryny będzie dostępna po publikacji.", "release_indexing_disabled", 404, request, env);
      const paths = ["/", "/jak-to-dziala.html", "/o-nas.html", "/kontakt.html"];
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${ORIGIN}${path}</loc></url>`).join("")}\n</urlset>`;
      return secure(new Response(body, {headers: {"Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "no-cache"}}), request, env);
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return catalogRead(request, env);
    // No API/diagnostic path reaches the shared Worker. Its renderer is used
    // only for HTML/assets, with provider and account credentials removed.
    const renderEnv = {...env, AUTH_ENABLED: "false", REXBID_LEGACY_SYNC_ENABLED: "false",
      REXBID_DOOR_ESTIMATOR_PROTOTYPE: "disabled"};
    delete renderEnv.APIBARA_API_KEY;
    delete renderEnv.SUPABASE_URL;
    delete renderEnv.SUPABASE_PUBLISHABLE_KEY;
    delete renderEnv.REXBID_AUTH_COOKIE_SECRET;
    const getRequest = request.method === "HEAD" ? new Request(request, {method: "GET"}) : request;
    try { return await decorateHtml(await rexWorker.fetch(getRequest, renderEnv, executionContext), request, env); }
    catch { return error("Strona jest chwilowo niedostępna.", "release_assets_unavailable", 503, request, env); }
  }
};
