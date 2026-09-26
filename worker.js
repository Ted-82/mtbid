import apibaraModule from "./providers/apibara.js";
import contract from "./providers/contract.js";

const { createApibaraProvider, ProviderError } = apibaraModule;
const { createProviderRegistry, validateRexVehicle, validateRexHistoryEvent } = contract;
const apibaraProvider = createApibaraProvider({
  fetch: (...args) => fetch(...args),
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  console
});
const providerRegistry = createProviderRegistry([apibaraProvider]);
const DEFAULT_PROVIDER = "apibara";

function getProviderAdapter(env) {
  const requestedId = cleanString(env?.REXBID_PROVIDER_ID).trim() || DEFAULT_PROVIDER;
  const provider = providerRegistry.get(requestedId);
  if (!provider) throw new ProviderError("rex", "CONFIGURATION", 500);
  return provider;
}

const CACHE_TTL_SECONDS = 60;
const HISTORY_CACHE_TTL_SECONDS = 300;
const FILTERS_CACHE_TTL_SECONDS = 21600;
const MAX_SYNC_HISTORY_PAGES = 100;
const MAX_SYNC_VEHICLE_PAGES = 100;

/*
 * ============================================================
 * REX.BID WORKER
 * ============================================================
 *
 * API:
 *   /api/cars
 *   /api/car/VIN
 *   /api/car/VIN/history
 *   /api/database
 *   POST /api/sync/vehicle/VIN (requires REXBID_SYNC_TOKEN)
 *
 * D1:
 *   REXBID_DB
 *
 * Najważniejsze:
 * - dokładne wyszukiwanie VIN / LOT
 * - brak wybierania pierwszego wyniku
 * - lokalne zapisywanie pojazdów
 * - snapshoty zmian
 * - provider-agnostic vehicle/history normalization and explicit persistence
 * - cache ograniczający liczbę requestów
 *
 * ============================================================
 */


/* ============================================================
 * JSON HELPERS
 * ============================================================
 */

function json(
  data,
  status = 200,
  cacheStatus = null,
  cacheSeconds = CACHE_TTL_SECONDS
) {
  const headers = {
    "Content-Type": "application/json; charset=UTF-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control":
      cacheSeconds > 0
        ? `public, max-age=${cacheSeconds}`
        : "no-store"
  };

  if (cacheStatus) {
    headers["X-RexBid-Cache"] = cacheStatus;
  }

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers
    }
  );
}


function errorJson(
  message,
  status = 502
) {
  return json(
    {
      ok: false,
      error: message
    },
    status,
    "ERROR",
    0
  );
}


/* ============================================================
 * GENERIC HELPERS
 * ============================================================
 */

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "{}";
  }
}


function cleanString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}


function firstValue(
  object,
  keys
) {
  if (
    !object ||
    typeof object !== "object"
  ) {
    return null;
  }

  for (const key of keys) {
    if (
      object[key] !== undefined &&
      object[key] !== null &&
      object[key] !== ""
    ) {
      return object[key];
    }
  }

  return null;
}


function getNested(
  object,
  paths
) {
  for (const path of paths) {
    let current = object;

    for (const part of path) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== "object"
      ) {
        current = null;
        break;
      }

      current = current[part];
    }

    if (
      current !== null &&
      current !== undefined &&
      current !== ""
    ) {
      return current;
    }
  }

  return null;
}


function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function boolToDb(value) {
  if (
    value === true ||
    value === 1 ||
    value === "true" ||
    value === "1"
  ) {
    return 1;
  }

  if (
    value === false ||
    value === 0 ||
    value === "false" ||
    value === "0"
  ) {
    return 0;
  }

  return null;
}


/* ============================================================
 * IDENTIFIER
 * ============================================================
 */

function normalizeIdentifier(value) {
  return cleanString(value)
    .toUpperCase()
    .replace(/[\s-]/g, "");
}


/* ============================================================
 * EXACT VEHICLE MATCH
 * ============================================================
 */

function vehicleMatchesIdentifier(vehicle, identifier, providerId = DEFAULT_PROVIDER) {
  return Boolean(providerRegistry.get(providerId)?.matchesIdentifier(vehicle, identifier));
}


/* ============================================================
 * PROVIDER ADAPTER BOUNDARY
 * ============================================================
 */

/* ============================================================
 * PROVIDER READ LAYER
 * ============================================================
 * These helpers perform upstream reads only. They never access D1;
 * endpoint handlers decide separately whether to persist the result.
 */

async function fetchProviderVehicle(env, identifier) {
  return getProviderAdapter(env).fetchVehicle(env, identifier);
}

async function searchProviderVehicles(env, search, perPage = 20) {
  return getProviderAdapter(env).searchVehicles(env, search, perPage);
}

async function fetchProviderHistory(env, identifier, { per_page = 20, cursor = null } = {}) {
  return getProviderAdapter(env).fetchHistory(env, identifier, { per_page, cursor });
}

async function fetchProviderVehicles(env, params = {}) {
  return getProviderAdapter(env).listVehicles(env, params);
}

function normalizeProviderVehicleList(result, providerId = DEFAULT_PROVIDER) {
  const provider = providerRegistry.get(providerId);
  if (!provider) return [];
  return provider.vehicleListRecords(result)
    .map(raw => {
      const normalized = normalizeVehicle(raw, providerId);
      const canonical = normalized ? provider.toCanonicalVehicle(raw, normalized) : null;
      return { raw, normalized, canonical };
    })
    .filter(item => item.normalized && validateRexVehicle(item.canonical).valid);
}

function providerErrorResponse(error) {
  if (!(error instanceof ProviderError)) return errorJson("Nie udało się pobrać danych.", 502);
  const status = error.code === "INVALID_REQUEST" ? 400
    : error.code === "NOT_FOUND" ? 404
    : error.code === "RATE_LIMITED" ? 429
    : error.code === "TIMEOUT" ? 504
    : error.code === "CONFIGURATION" ? 500 : 502;
  const response = errorJson(error.message, status);
  if (error.code === "RATE_LIMITED" && error.retryAfter !== null) {
    response.headers.set("Retry-After", String(error.retryAfter));
  }
  return response;
}


/* ============================================================
 * VEHICLE NORMALIZATION
 * ============================================================
 */

function normalizeVehicle(vehicle, providerId = DEFAULT_PROVIDER) {
  const provider = providerRegistry.get(providerId);
  const normalized = provider?.normalizeVehicle(vehicle);
  if (!normalized) return null;
  if (provider.toCanonicalVehicle) Object.defineProperty(normalized, "rex", { value: provider.toCanonicalVehicle(vehicle, normalized), enumerable: false });
  return normalized;
}

/* ============================================================
 * HASH
 * ============================================================
 */

function simpleHash(value) {
  let hash = 2166136261;

  for (
    let i = 0;
    i < value.length;
    i++
  ) {
    hash ^= value.charCodeAt(i);

    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);

    hash >>>= 0;
  }

  return String(hash >>> 0);
}

function parseJsonValue(value) {
  try { return typeof value === "string" ? JSON.parse(value) : value ?? null; } catch { return null; }
}

function mergeProviderPayload(previous, incoming) {
  if (incoming === null || incoming === undefined || incoming === "") return previous ?? incoming;
  if (Array.isArray(incoming)) return incoming.length ? incoming : (previous ?? incoming);
  if (typeof incoming !== "object") return incoming;
  const oldObject = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
  const merged = { ...oldObject };
  for (const [key, value] of Object.entries(incoming)) merged[key] = mergeProviderPayload(oldObject[key], value);
  return merged;
}

function mergeNormalizedVehicle(previous, incoming) {
  if (!previous) return incoming;
  const merged = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined && value !== "") merged[key] = value;
  }
  merged.fingerprint = getProviderAdapter({}).fingerprintNormalizedVehicle(merged);
  return merged;
}


/* ============================================================
 * D1 DATABASE
 * ============================================================
 */

async function ensureDatabase(env) {
  if (!env.REXBID_DB) {
    return false;
  }


  await env.REXBID_DB.prepare(`
    CREATE TABLE IF NOT EXISTS vehicles (
      vehicle_key TEXT PRIMARY KEY,

      vin TEXT,
      slug_vin TEXT,
      platform TEXT,
      lot TEXT,

      title TEXT,
      year INTEGER,
      make TEXT,
      model TEXT,

      auction_state TEXT,
      auction_at TEXT,
      auction_end TEXT,

      current_bid REAL,
      buy_now REAL,
      last_sold_price REAL,

      location_display TEXT,

      damage TEXT,
      secondary_damage TEXT,
      loss_type TEXT,
      run_condition TEXT,
      has_key INTEGER,

      mileage REAL,

      seller_name TEXT,
      seller_type TEXT,

      document_name TEXT,
      document_type TEXT,
      export_allowed INTEGER,
      registration_allowed INTEGER,

      has_video INTEGER,
      has_360 INTEGER,

      auction_url TEXT,

      first_seen_at TEXT,
      last_seen_at TEXT,

      fingerprint TEXT,

      raw_json TEXT
    )
  `).run();


  await env.REXBID_DB.prepare(`
    CREATE TABLE IF NOT EXISTS vehicle_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      vehicle_key TEXT NOT NULL,

      captured_at TEXT NOT NULL,

      auction_state TEXT,
      auction_at TEXT,
      auction_end TEXT,

      current_bid REAL,
      buy_now REAL,
      last_sold_price REAL,

      fingerprint TEXT NOT NULL,

      raw_json TEXT
    )
  `).run();


  await env.REXBID_DB.prepare(`
    CREATE TABLE IF NOT EXISTS auction_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      vehicle_key TEXT NOT NULL,

      event_key TEXT,
      source_event_id TEXT,
      vin TEXT,
      platform TEXT,
      lot TEXT,
      auction_date TEXT,
      sale_date TEXT,
      current_bid REAL,
      final_price REAL,
      buy_now REAL,
      price REAL,
      seller TEXT,
      status TEXT,

      event_hash TEXT NOT NULL,

      captured_at TEXT NOT NULL,

      raw_json TEXT
    )
  `).run();


  await env.REXBID_DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_vehicles_vin
    ON vehicles(vin)
  `).run();


  await env.REXBID_DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_vehicles_lot
    ON vehicles(lot)
  `).run();


  await env.REXBID_DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_vehicles_platform
    ON vehicles(platform)
  `).run();


  await env.REXBID_DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_vehicle
    ON vehicle_snapshots(vehicle_key)
  `).run();


  await env.REXBID_DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_history_vehicle
    ON auction_history(vehicle_key)
  `).run();


  await env.REXBID_DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_history_date
    ON auction_history(auction_date)
  `).run();


  return true;
}


/* ============================================================
 * SAVE VEHICLE
 * ============================================================
 */

async function saveVehicle(
  env,
  vehicle,
  rawVehicle
) {
  if (
    !env.REXBID_DB ||
    !vehicle
  ) {
    return {
      saved: false,
      changed: false
    };
  }


  await ensureDatabase(env);


  const now =
    new Date().toISOString();


  const existing =
    await env.REXBID_DB
      .prepare(`
        SELECT
          vehicle_key,
          first_seen_at,
          fingerprint,
          raw_json
        FROM vehicles
        WHERE vehicle_key = ?
        LIMIT 1
      `)
      .bind(vehicle.vehicleKey)
      .first();

  const previousRaw = parseJsonValue(existing?.raw_json);
  const persistedRaw = mergeProviderPayload(previousRaw, rawVehicle);
  const previousNormalized = previousRaw ? normalizeVehicle(previousRaw) : null;
  vehicle = mergeNormalizedVehicle(previousNormalized, vehicle);


  const firstSeen =
    existing &&
    existing.first_seen_at
      ? existing.first_seen_at
      : now;


  const changed =
    !existing ||
    existing.fingerprint !==
      vehicle.fingerprint;


  await env.REXBID_DB
    .prepare(`
      INSERT INTO vehicles (
        vehicle_key,

        vin,
        slug_vin,
        platform,
        lot,

        title,
        year,
        make,
        model,

        auction_state,
        auction_at,
        auction_end,

        current_bid,
        buy_now,
        last_sold_price,

        location_display,

        damage,
        secondary_damage,
        loss_type,
        run_condition,
        has_key,

        mileage,

        seller_name,
        seller_type,

        document_name,
        document_type,
        export_allowed,
        registration_allowed,

        has_video,
        has_360,

        auction_url,

        first_seen_at,
        last_seen_at,

        fingerprint,

        raw_json
      )

      VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?,
        ?, ?, ?, ?, ?,
        ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?,
        ?, ?,
        ?,
        ?, ?, ?,
        ?
      )

      ON CONFLICT(vehicle_key)
      DO UPDATE SET

        vin = COALESCE(NULLIF(excluded.vin, ''), vehicles.vin),
        slug_vin = COALESCE(NULLIF(excluded.slug_vin, ''), vehicles.slug_vin),
        platform = COALESCE(NULLIF(excluded.platform, ''), vehicles.platform),
        lot = COALESCE(NULLIF(excluded.lot, ''), vehicles.lot),

        title = COALESCE(NULLIF(excluded.title, ''), vehicles.title),
        year = COALESCE(excluded.year, vehicles.year),
        make = COALESCE(NULLIF(excluded.make, ''), vehicles.make),
        model = COALESCE(NULLIF(excluded.model, ''), vehicles.model),

        auction_state = COALESCE(NULLIF(excluded.auction_state, ''), vehicles.auction_state),
        auction_at = COALESCE(NULLIF(excluded.auction_at, ''), vehicles.auction_at),
        auction_end = COALESCE(NULLIF(excluded.auction_end, ''), vehicles.auction_end),

        current_bid = COALESCE(excluded.current_bid, vehicles.current_bid),
        buy_now = COALESCE(excluded.buy_now, vehicles.buy_now),
        last_sold_price = COALESCE(excluded.last_sold_price, vehicles.last_sold_price),

        location_display = COALESCE(NULLIF(excluded.location_display, ''), vehicles.location_display),

        damage = COALESCE(NULLIF(excluded.damage, ''), vehicles.damage),
        secondary_damage = COALESCE(NULLIF(excluded.secondary_damage, ''), vehicles.secondary_damage),
        loss_type = COALESCE(NULLIF(excluded.loss_type, ''), vehicles.loss_type),
        run_condition = COALESCE(NULLIF(excluded.run_condition, ''), vehicles.run_condition),
        has_key = COALESCE(excluded.has_key, vehicles.has_key),

        mileage = COALESCE(excluded.mileage, vehicles.mileage),

        seller_name = COALESCE(NULLIF(excluded.seller_name, ''), vehicles.seller_name),
        seller_type = COALESCE(NULLIF(excluded.seller_type, ''), vehicles.seller_type),

        document_name = COALESCE(NULLIF(excluded.document_name, ''), vehicles.document_name),
        document_type = COALESCE(NULLIF(excluded.document_type, ''), vehicles.document_type),
        export_allowed = COALESCE(excluded.export_allowed, vehicles.export_allowed),
        registration_allowed = COALESCE(excluded.registration_allowed, vehicles.registration_allowed),

        has_video = COALESCE(excluded.has_video, vehicles.has_video),
        has_360 = COALESCE(excluded.has_360, vehicles.has_360),

        auction_url = COALESCE(NULLIF(excluded.auction_url, ''), vehicles.auction_url),

        last_seen_at = excluded.last_seen_at,

        fingerprint = excluded.fingerprint,

        raw_json = excluded.raw_json
    `)
    .bind(
      vehicle.vehicleKey,

      vehicle.vin,
      vehicle.slugVin,
      vehicle.platform,
      vehicle.lot,

      vehicle.title,
      vehicle.year,
      vehicle.make,
      vehicle.model,

      vehicle.auctionState,
      vehicle.auctionAt,
      vehicle.auctionEnd,

      vehicle.currentBid,
      vehicle.buyNow,
      vehicle.lastSoldPrice,

      vehicle.locationDisplay,

      vehicle.damage,
      vehicle.secondaryDamage,
      vehicle.lossType,
      vehicle.runCondition,

      boolToDb(vehicle.hasKey),

      vehicle.mileage,

      vehicle.sellerName,
      vehicle.sellerType,

      vehicle.documentName,
      vehicle.documentType,

      boolToDb(vehicle.exportAllowed),
      boolToDb(vehicle.registrationAllowed),

      boolToDb(vehicle.hasVideo),
      boolToDb(vehicle.has360),

      vehicle.auctionUrl,

      firstSeen,
      now,

      vehicle.fingerprint,

      safeJson(persistedRaw)
    )
    .run();


  if (changed) {
    await env.REXBID_DB
      .prepare(`
        INSERT INTO vehicle_snapshots (
          vehicle_key,
          captured_at,

          auction_state,
          auction_at,
          auction_end,

          current_bid,
          buy_now,
          last_sold_price,

          fingerprint,

          raw_json
        )

        VALUES (
          ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?,
          ?
        )
      `)
      .bind(
        vehicle.vehicleKey,
        now,

        vehicle.auctionState,
        vehicle.auctionAt,
        vehicle.auctionEnd,

        vehicle.currentBid,
        vehicle.buyNow,
        vehicle.lastSoldPrice,

        vehicle.fingerprint,

        safeJson(persistedRaw)
      )
      .run();
  }


  return {
    saved: true,
    changed
  };
}


/* ============================================================
 * SAVE API VEHICLE LIST
 * ============================================================
 */

async function saveApiVehicle(
  env,
  result
) {
  const provider = getProviderAdapter(env);
  const providerVehicles = Array.isArray(result) ? result : result ? provider.vehicleListRecords(result) : [];
  if (!providerVehicles.length) {
    return {
      saved: false,
      count: 0
    };
  }


  let count = 0;


  for (
    const vehicle of providerVehicles
  ) {
    const normalized =
      normalizeVehicle(vehicle, provider.id);


    if (!normalized || !validateRexVehicle(provider.toCanonicalVehicle(vehicle, normalized)).valid) {
      continue;
    }


    await saveVehicle(
      env,
      normalized,
      vehicle
    );


    count++;
  }


  return {
    saved: true,
    count
  };
}


/*
 * Explicit synchronization operations. Triggers (manual, scheduled, or queue)
 * can call these later; GET handlers must never call them.
 */
async function syncVehicle(env, identifier, options = {}) {
  const maxPages = Math.min(
    MAX_SYNC_HISTORY_PAGES,
    Math.max(1, Number.isInteger(options.maxPages) ? options.maxPages : 100)
  );
  const perPage = getProviderAdapter(env).validatePerPage(options.per_page, 20);
  let rawVehicle = null;
  const provider = getProviderAdapter(env);

  try {
    const direct = await fetchProviderVehicle(env, identifier);
    const directVehicle = provider.vehicleDetailRecord(direct);
    if (directVehicle && vehicleMatchesIdentifier(directVehicle, identifier, provider.id)) {
      rawVehicle = directVehicle;
    } else if (directVehicle) {
      const search = await searchProviderVehicles(env, identifier, 20);
      rawVehicle = provider.vehicleListRecords(search).find(item => vehicleMatchesIdentifier(item, identifier, provider.id)) || null;
    }
  } catch (error) {
    if (error?.code !== "NOT_FOUND") {
      return { ok: false, completed: false, phase: "vehicle", error: error?.code || "UPSTREAM" };
    }
  }

  if (!rawVehicle) {
    try {
      const search = await searchProviderVehicles(env, identifier, 20);
      rawVehicle = provider.vehicleListRecords(search).find(item => vehicleMatchesIdentifier(item, identifier, provider.id)) || null;
    } catch (error) {
      return { ok: false, completed: false, phase: "vehicle", error: error?.code || "UPSTREAM" };
    }
  }

  const normalizedVehicle = normalizeVehicle(rawVehicle, provider.id);
  if (!normalizedVehicle) {
    return { ok: false, completed: false, phase: "vehicle", error: "NOT_FOUND" };
  }
  const canonicalVehicle = provider.toCanonicalVehicle(rawVehicle, normalizedVehicle);
  const vehicleValidation = validateRexVehicle(canonicalVehicle);
  if (!vehicleValidation.valid) {
    return { ok: false, completed: false, phase: "validation", error: "INVALID_CANONICAL_VEHICLE" };
  }

  const includeHistory = options.includeHistory !== false;
  const historyRecords = [];
  let pagesFetched = 0;

  if (includeHistory) {
    const seenCursors = new Set();
    let cursor = null;
    let historyComplete = false;

    for (let page = 0; page < maxPages; page++) {
      let fetched;
      try {
        fetched = await fetchProviderHistory(env, identifier, { per_page: perPage, cursor });
      } catch (error) {
        return { ok: false, completed: false, phase: "history", error: error?.code || "UPSTREAM", pagesFetched };
      }

      pagesFetched++;
      historyRecords.push(...normalizeProviderHistory(fetched.response, {
        vin: normalizedVehicle.vin,
        platform: normalizedVehicle.platform,
        lot: normalizedVehicle.lot,
        provider: provider.id
      }));

      const nextCursor = fetched.nextCursor;
      if (nextCursor === null || nextCursor === undefined || nextCursor === "") {
        historyComplete = true;
        break;
      }
      if (seenCursors.has(String(nextCursor))) {
        return { ok: false, completed: false, phase: "history", error: "REPEATED_CURSOR", pagesFetched };
      }
      seenCursors.add(String(nextCursor));
      cursor = nextCursor;
    }

    if (!historyComplete) {
      return { ok: false, completed: false, phase: "history", error: "PAGE_LIMIT", pagesFetched };
    }
  }

  if (!env.REXBID_DB) {
    return { ok: false, completed: false, phase: "persistence", error: "D1_UNAVAILABLE", pagesFetched };
  }

  try {
    // Schema preparation belongs to this explicit operation, never to GET.
    await ensureDatabase(env);
    const vehicleResult = await saveVehicle(env, normalizedVehicle, rawVehicle);
    const historyResult = includeHistory
      ? await saveAuctionHistory(env, normalizedVehicle.vehicleKey, historyRecords)
      : [];
    return {
      ok: true,
      completed: true,
      vehicleKey: normalizedVehicle.vehicleKey,
      vehicleChanged: vehicleResult.changed,
      historyPages: pagesFetched,
      historyRecords: historyResult.length
    };
  } catch (error) {
    console.error("Rex.Bid sync persistence error", error?.name || "Error");
    return { ok: false, completed: false, phase: "persistence", error: "D1_WRITE_FAILED", pagesFetched };
  }
}

async function syncVehicleList(env, params = {}, options = {}) {
  const provider = getProviderAdapter(env);
  const maxPages = Math.min(
    MAX_SYNC_VEHICLE_PAGES,
    Math.max(1, Number.isInteger(options.maxPages) ? options.maxPages : 100)
  );
  const pages = [];
  const seenCursors = new Set();
  let cursor = params.cursor ?? null;
  let complete = false;

  for (let page = 0; page < maxPages; page++) {
    let response;
    try {
      response = await fetchProviderVehicles(env, { ...params, ...(cursor ? { cursor } : {}) });
    } catch (error) {
      return { ok: false, completed: false, error: error?.code || "UPSTREAM", pagesFetched: pages.length };
    }
    pages.push(response);
    const nextCursor = provider.responseMeta(response)?.next_cursor ?? null;
    if (nextCursor === null || nextCursor === undefined || nextCursor === "") {
      complete = true;
      break;
    }
    if (seenCursors.has(String(nextCursor))) {
      return { ok: false, completed: false, error: "REPEATED_CURSOR", pagesFetched: pages.length };
    }
    seenCursors.add(String(nextCursor));
    cursor = nextCursor;
  }

  if (!complete) {
    return { ok: false, completed: false, error: "PAGE_LIMIT", pagesFetched: pages.length };
  }
  if (!env.REXBID_DB) {
    return { ok: false, completed: false, error: "D1_UNAVAILABLE", pagesFetched: pages.length };
  }

  const byKey = new Map();
  for (const response of pages) {
    for (const item of normalizeProviderVehicleList(response, provider.id)) {
      byKey.set(item.normalized.vehicleKey, item);
    }
  }

  try {
    await ensureDatabase(env);
    const result = await saveApiVehicle(env, [...byKey.values()].map(item => item.raw));
    return { ok: true, completed: true, pagesFetched: pages.length, vehicles: result.count };
  } catch (error) {
    console.error("Rex.Bid list sync persistence error", error?.name || "Error");
    return { ok: false, completed: false, error: "D1_WRITE_FAILED", pagesFetched: pages.length };
  }
}


/* ============================================================
 * FIND LOCAL VEHICLE
 * ============================================================
 */

async function findLocalVehicle(
  env,
  identifier
) {
  const value =
    cleanString(identifier);


  const result =
    await env.REXBID_DB
      .prepare(`
        SELECT *
        FROM vehicles
        WHERE
          UPPER(vin) = UPPER(?)
          OR UPPER(lot) = UPPER(?)
          OR UPPER(slug_vin) = UPPER(?)
        ORDER BY
          last_seen_at DESC
        LIMIT 1
      `)
      .bind(
        value,
        value,
        value
      )
      .first();


  return result || null;
}


/* ============================================================
 * LOCAL HISTORY SUMMARY
 * ============================================================
 */

async function getLocalHistorySummary(
  env,
  vehicleKey
) {
  if (
    !env.REXBID_DB ||
    !vehicleKey
  ) {
    return null;
  }


  try {
    const result =
      await env.REXBID_DB
        .prepare(`
          SELECT
            COUNT(*) AS count,
            MIN(captured_at) AS first_snapshot,
            MAX(captured_at) AS last_snapshot
          FROM vehicle_snapshots
          WHERE vehicle_key = ?
        `)
        .bind(vehicleKey)
        .first();


    return result || null;

  } catch {
    return null;
  }
}


/* ============================================================
 * NORMALIZE PROVIDER HISTORY
 * ============================================================
 *
 * The active provider adapter returns source records in its provider contract.
 *
 * data: {
 *   vehicle: {...},
 *   history: [
 *     {
 *       platform: "copart",
 *       date: "2026-07-08",
 *       price: 3300,
 *       status: "Sold"
 *     }
 *   ]
 * }
 *
 * To jest właściwa struktura.
 * ============================================================
 */

function getProviderHistoryRecords(
  result,
  providerId = DEFAULT_PROVIDER
) {
  const provider = providerRegistry.get(providerId);
  return provider ? provider.historyRecords(result) : [];
}

function normalizeProviderHistory(result, vehicleContext = {}) {
  const providerId = vehicleContext.provider || DEFAULT_PROVIDER;
  const provider = providerRegistry.get(providerId);
  if (!provider) return [];
  return getProviderHistoryRecords(result, providerId)
    .map(record => {
      const providerContext = { ...vehicleContext, provider: providerId };
      const normalized = provider.normalizeHistoryRecord(record, providerContext);
      if (normalized) {
        const canonical = provider.toCanonicalHistoryEvent(record, providerContext);
        if (!validateRexHistoryEvent(canonical).valid) return null;
        Object.defineProperty(normalized, "rex", { value: canonical, enumerable: false });
      }
      return normalized;
    })
    .filter(Boolean);
}


function historyDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  // Keep date-only values as calendar dates. Do not round-trip them through
  // Date, which would interpret YYYY-MM-DD as UTC and can shift the day.
  if (typeof value === "string") {
    const raw = value.trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[Tt ].*)?$/);
    if (match) return raw;
  }

  return String(value).trim();
}


function historyIdentityPart(value) {
  return cleanString(value).trim().toUpperCase();
}


function rawJsonValueCount(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (Array.isArray(value)) return value.reduce((count, item) => count + rawJsonValueCount(item), 0);
  if (typeof value === "object") return Object.values(value).reduce((count, item) => count + rawJsonValueCount(item), 0);
  return 1;
}


/* ============================================================
 * NORMALIZE ONE HISTORY RECORD
 * ============================================================
 */

function normalizeHistoryRecord(record, vehicleContext = {}) {
  const providerId = vehicleContext.provider || DEFAULT_PROVIDER;
  const provider = providerRegistry.get(providerId);
  const normalized = provider?.normalizeHistoryRecord(record, vehicleContext);
  if (!normalized) return null;
  if (provider.toCanonicalHistoryEvent) Object.defineProperty(normalized, "rex", { value: provider.toCanonicalHistoryEvent(record, vehicleContext), enumerable: false });
  return normalized;
}

function historyEventHash(
  record
) {
  // event_hash is retained for compatibility with the existing schema. Its
  // input is now the stable event key, never mutable price/status fields.
  return simpleHash(record.event_key || safeJson(record.raw_json));
}


/* ============================================================
 * SAVE AUCTION HISTORY
 * ============================================================
 */

async function saveAuctionHistory(
  env,
  vehicleKey,
  normalizedRecords
) {
  if (
    !env.REXBID_DB ||
    !vehicleKey ||
    !Array.isArray(normalizedRecords)
  ) {
    return [];
  }


  const persistedRecords = [];

  for (const normalized of normalizedRecords) {
    if (!normalized || typeof normalized !== "object") {
      continue;
    }


    const now =
      new Date().toISOString();

    const eventHash = historyEventHash(normalized);
    const existingRows = await env.REXBID_DB.prepare(`
      SELECT id, event_key, source_event_id, vin, platform, lot, auction_date, sale_date,
             current_bid, final_price, buy_now, price, status, event_hash, captured_at, raw_json
      FROM auction_history
      WHERE vehicle_key = ?
    `).bind(vehicleKey).all();

    const matches = (existingRows.results || []).filter(row => {
      if (normalized.event_key && row.event_key === normalized.event_key) return true;
      // Stable identifiers are authoritative: different IDs always mean
      // different events, even when LOT and date happen to match.
      if (normalized.event_key && row.event_key) return false;
      if (!normalized.event_key) return row.event_hash === eventHash;
      let existing = null;
      try {
        const oldRaw = JSON.parse(row.raw_json || "null");
        existing = normalizeHistoryRecord(oldRaw, { vin: row.vin, platform: row.platform, lot: row.lot });
      } catch {
        existing = null;
      }
      if (normalized.event_key && existing?.event_key) return existing.event_key === normalized.event_key;
      const oldPlatform = row.platform || existing?.platform;
      const oldLot = row.lot || existing?.lot;
      if (oldPlatform !== normalized.platform || oldLot !== normalized.lot) return false;
      const rowDate = row.auction_date || row.sale_date || existing?.auction_date || existing?.sale_date;
      const normalizedDate = normalized.auction_date || normalized.sale_date;
      if (rowDate && normalizedDate && rowDate === normalizedDate) return true;
      return Boolean(existing && existing.event_key === normalized.event_key);
    });

    // Ambiguous legacy rows are kept untouched. Do not silently merge or
    // delete history; a later data audit can resolve the collision explicitly.
    if (matches.length > 1) {
      console.warn("Rex.Bid ambiguous legacy auction history match", vehicleKey, normalized.event_key);
      persistedRecords.push(normalized);
      continue;
    }

    if (matches.length === 1) {
      const row = matches[0];
      let rawJson = safeJson(normalized.raw_json);
      try {
        const previousRaw = JSON.parse(row.raw_json || "null");
        if (rawJsonValueCount(normalized.raw_json) < rawJsonValueCount(previousRaw)) {
          rawJson = row.raw_json;
        }
      } catch {
        // Keep the latest valid source record when the old JSON cannot be read.
      }
      const explicitlyUnsold = /sold\s+on\s+approval|on\s+approval|sale\s+pending\s+approval|pending\s+approval|not sold|no sale|unsold|failed/i.test(normalized.status || "");
      await env.REXBID_DB.prepare(`
        UPDATE auction_history SET
          event_key = COALESCE(?, event_key),
          source_event_id = COALESCE(?, source_event_id),
          vin = COALESCE(?, vin),
          platform = COALESCE(?, platform),
          lot = COALESCE(?, lot),
          auction_date = COALESCE(?, auction_date),
          sale_date = COALESCE(?, sale_date),
          current_bid = COALESCE(?, current_bid),
          final_price = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, final_price) END,
          buy_now = COALESCE(?, buy_now),
          price = COALESCE(?, price),
          seller = COALESCE(?, seller),
          status = COALESCE(?, status),
          event_hash = ?,
          captured_at = ?,
          raw_json = ?
        WHERE id = ? AND vehicle_key = ?
      `).bind(
        normalized.event_key, normalized.source_event_id, normalized.vin, normalized.platform,
        normalized.lot, normalized.auction_date, normalized.sale_date, normalized.current_bid,
        explicitlyUnsold ? 1 : 0, normalized.final_price, normalized.buy_now, normalized.source_price, normalized.seller, normalized.status,
        eventHash, now, rawJson, row.id, vehicleKey
      ).run();
    } else {
      await env.REXBID_DB.prepare(`
        INSERT INTO auction_history (
          vehicle_key, event_key, source_event_id, vin, platform, lot, auction_date, sale_date,
          current_bid, final_price, buy_now, price, seller, status, event_hash, captured_at, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        vehicleKey, normalized.event_key, normalized.source_event_id, normalized.vin,
        normalized.platform, normalized.lot, normalized.auction_date,
        normalized.sale_date, normalized.current_bid, normalized.final_price, normalized.buy_now,
        normalized.source_price, normalized.seller, normalized.status, eventHash, now, safeJson(normalized.raw_json)
      ).run();
    }

    persistedRecords.push(normalized);
  }


  return persistedRecords;
}


/* ============================================================
 * GET SAVED AUCTION HISTORY
 * ============================================================
 */

async function getSavedAuctionHistory(
  env,
  vehicleKey
) {
  if (
    !env.REXBID_DB ||
    !vehicleKey
  ) {
    return [];
  }


  let rows = null;
  try {
    const result = await env.REXBID_DB.prepare(`
      SELECT id, event_key, source_event_id, vin, platform, lot, auction_date, sale_date,
             current_bid, final_price, buy_now, price, seller, status, captured_at, raw_json
      FROM auction_history
      WHERE vehicle_key = ?
      ORDER BY auction_date DESC, captured_at DESC
    `).bind(vehicleKey).all();
    rows = result.results || [];
  } catch {
    // Read-only compatibility with the pre-0001 D1 schema. Never run DDL here.
    try {
      const legacy = await env.REXBID_DB.prepare(`
        SELECT id, platform, auction_date, price, status, captured_at, raw_json
        FROM auction_history
        WHERE vehicle_key = ?
        ORDER BY auction_date DESC, captured_at DESC
      `).bind(vehicleKey).all();
      rows = legacy.results || [];
    } catch {
      return [];
    }
  }

  return rows.map(row => {
      let source = null;
      try { source = JSON.parse(row.raw_json || "null"); } catch { source = null; }
      const normalized = normalizeHistoryRecord(source || row, { vin: row.vin, platform: row.platform, lot: row.lot }) || {};
      return {
        ...normalized,
        event_key: row.event_key || normalized.event_key || null,
        source_event_id: row.source_event_id || normalized.source_event_id || null,
        vin: row.vin || normalized.vin || null,
        platform: row.platform || normalized.platform || null,
        lot: row.lot || normalized.lot || null,
        auction_date: row.auction_date || normalized.auction_date || null,
        sale_date: row.sale_date || normalized.sale_date || null,
        current_bid: row.current_bid ?? normalized.current_bid ?? null,
        final_price: row.final_price ?? normalized.final_price ?? null,
        buy_now: row.buy_now ?? normalized.buy_now ?? null,
        // Legacy `price` is source data only; never reinterpret it as final_price.
        source_price: row.price ?? normalized.source_price ?? null,
        seller: row.seller || normalized.seller || null,
        status: row.status || normalized.status || null,
        raw_json: source,
        captured_at: row.captured_at || null
      };
    });
}


/* ============================================================
 * GET VEHICLE
 * ============================================================
 */

async function getCar(
  request,
  env,
  identifier
) {
  const provider = getProviderAdapter(env);
  const encoded =
    encodeURIComponent(identifier);

  let upstreamFailure = null;
  let shouldSearch = false;

  /* Provider adapter owns upstream lookup and compatibility serialization. */

  try {
    const result = await fetchProviderVehicle(env, identifier);
    const vehicleRecord = provider.vehicleDetailRecord(result);


    if (
      vehicleRecord
    ) {
      const normalized =
        normalizeVehicle(
          vehicleRecord,
          provider.id
        );


      if (
        vehicleMatchesIdentifier(
        vehicleRecord,
          identifier,
          provider.id
        )
      ) {
        return json(
          {
            ok: provider.responseOk(result),

            data:
              provider.publicVehicleRecord(vehicleRecord),

            source:
              provider.id,

            match:
              "exact",

            rex_history:
              normalized
                ? await getLocalHistorySummary(
                    env,
                    normalized.vehicleKey
                  )
                : null
          },
          200,
          "LIVE",
          0
        );
      }


      console.warn(
        "Provider direct result does not match:",
        identifier
      );
    }

  } catch (error) {
    if (error?.code === "NOT_FOUND") {
      shouldSearch = true;
    } else {
      upstreamFailure = error;
      console.warn("Provider direct lookup failed", error?.code || "UNKNOWN", error?.status || "");
    }
  }


  /* FALLBACK SEARCH */

  if (shouldSearch || !upstreamFailure) try {
    const searchResult = await searchProviderVehicles(env, identifier, 20);


    if (searchResult) {
      const searchRecords = provider.vehicleListRecords(searchResult);
      const exact =
        searchRecords.find(
          item =>
            vehicleMatchesIdentifier(
              item,
              identifier,
              provider.id
            )
        );


      if (exact) {
        const normalized =
          normalizeVehicle(exact, provider.id);


        return json(
          {
            ok: true,

            data:
              provider.publicVehicleRecord(exact),

            source:
              `${provider.id}-search`,

            match:
              "exact",

            rex_history:
              normalized
                ? await getLocalHistorySummary(
                    env,
                    normalized.vehicleKey
                  )
                : null
          },
          200,
          "LIVE",
          0
        );
      }
    }

  } catch (error) {
    if (error?.code !== "NOT_FOUND") upstreamFailure = error;
    console.warn("Provider fallback failed", error?.code || "UNKNOWN", error?.status || "");
  }


  /* LOCAL DATABASE */

  if (env.REXBID_DB) {
    try {
      const local =
        await findLocalVehicle(
          env,
          identifier
        );


      if (local) {
        let localData =
          local;


        if (local.raw_json) {
          try {
            localData =
              JSON.parse(
                local.raw_json
              );
          } catch {
            localData =
              local;
          }
        }


        if (
          vehicleMatchesIdentifier(
            localData,
            identifier
          ) ||
          normalizeIdentifier(local.vin) ===
            normalizeIdentifier(identifier) ||
          normalizeIdentifier(local.lot) ===
            normalizeIdentifier(identifier) ||
          normalizeIdentifier(local.slug_vin) ===
            normalizeIdentifier(identifier)
        ) {
          return json(
            {
              ok: true,

              data:
                localData,

              source:
                "rexbid-database",

              match:
                "exact",

              local_record:
                local,

              rex_history:
                await getLocalHistorySummary(
                  env,
                  local.vehicle_key
                )
            },
            200,
            "D1",
            0
          );
        }
      }

    } catch (error) {
      console.error(
        "Rex.Bid local lookup error:",
        error
      );
    }
  }


  if (upstreamFailure) throw upstreamFailure;

  return errorJson(
    `Nie znaleziono dokładnego pojazdu ${identifier}.`,
    404
  );
}


/* ============================================================
 * GET HISTORY
 * ============================================================
 */

async function getHistory(
  request,
  env,
  identifier
) {
  const incoming = new URL(request.url);
  const rawPerPage = incoming.searchParams.get("per_page");
  let perPage = 20;

  if (rawPerPage !== null) {
    if (!/^\d+$/.test(rawPerPage)) {
      return errorJson("Nieprawidłowy parametr per_page.", 400);
    }
    perPage = Math.min(20, Math.max(1, Number(rawPerPage)));
  }

  // Keep this token opaque. URLSearchParams handles only URL encoding while
  // forwarding it; Rex.Bid does not decode or derive cursor contents.
  const cursor = incoming.searchParams.has("cursor")
    ? incoming.searchParams.get("cursor")
    : null;

  const provider = getProviderAdapter(env);
  let providerHistory = null;
  let providerNextCursor = null;
  let providerErrorMessage = null;


  /*
   * Najważniejsza zmiana:
   *
   * Pobieramy pełne 20 rekordów.
   * The selected provider adapter enforces its supported page-size limit.
   */

  try {
    const historyPage = await fetchProviderHistory(env, identifier, {
      per_page: perPage,
      cursor
    });
    providerHistory = historyPage.response;
    providerNextCursor = historyPage.nextCursor;

  } catch (error) {
    providerErrorMessage = error.message;

    console.warn(
      "Rex.Bid provider history error:",
      error.message
    );
  }


  /* GET performs D1 SELECTs only for the existing history/snapshot fallback. */
  let localVehicle = null;
  if (env.REXBID_DB) {
    try {
      localVehicle = await findLocalVehicle(env, identifier);

      const historyVehicle = provider.historyVehicleRecord(providerHistory);
      if (!localVehicle && historyVehicle) {
        const vehicle = normalizeVehicle(historyVehicle, provider.id);
        if (vehicle) {
          localVehicle = await findLocalVehicle(
            env,
            vehicle.vin || vehicle.lot || vehicle.slugVin
          );
        }
      }
    } catch (dbError) {
      console.error("Rex.Bid provider history lookup error:", dbError);
    }
  }

  const vehicleContext = {
    vin: localVehicle?.vin || provider.normalizeVehicle(provider.historyVehicleRecord(providerHistory))?.vin,
    platform: localVehicle?.platform || provider.normalizeVehicle(provider.historyVehicleRecord(providerHistory))?.platform,
    lot: localVehicle?.lot || provider.normalizeVehicle(provider.historyVehicleRecord(providerHistory))?.lot,
    provider: provider.id
  };
  let upstreamHistoryRecords = providerHistory
    ? normalizeProviderHistory(providerHistory, vehicleContext)
    : [];

  /*
   * Odczyt historii już zapisanej.
   */

  let savedHistory = [];


  if (
    env.REXBID_DB &&
    localVehicle
  ) {
    savedHistory =
      await getSavedAuctionHistory(
        env,
        localVehicle.vehicle_key
      );
  }


  /*
   * Oficjalna historia ma pierwszeństwo.
   *
   * Nie mieszamy jej z naszymi snapshotami.
   * Snapshot to obserwacja pojazdu,
   * a historia sprzedaży to prawdziwe aukcje.
   */

  const finalHistory = providerHistory ? upstreamHistoryRecords : savedHistory;
  const nextCursor = providerHistory ? providerNextCursor : null;


  /*
   * Zwracamy jednocześnie:
   *
   * data        -> public compatibility representation owned by the adapter
   * history     -> prosta tablica do wyświetlenia
   * rex_history -> nasza historia D1
   */

  return json(
    {
      ok: true,

      data: providerHistory ? provider.publicHistoryData(providerHistory) : null,

      meta: {
        per_page: perPage,
        next_cursor: nextCursor,
        has_more: Boolean(nextCursor)
      },

      history:
        finalHistory,

      rex_history: {
        count:
          finalHistory.length,

        records:
          finalHistory,

        snapshots:
          localVehicle
            ? await getLocalSnapshotHistory(
                env,
                localVehicle.vehicle_key
              )
            : []
      },

      source: providerHistory ? provider.id : "d1",

      error: providerErrorMessage
    },
    200,
    "HISTORY",
    0
  );
}


/* ============================================================
 * LOCAL SNAPSHOT HISTORY
 * ============================================================
 */

async function getLocalSnapshotHistory(
  env,
  vehicleKey
) {
  if (
    !env.REXBID_DB ||
    !vehicleKey
  ) {
    return [];
  }


  try {
    const rows =
      await env.REXBID_DB
        .prepare(`
          SELECT
            id,
            captured_at,
            auction_state,
            auction_at,
            auction_end,
            current_bid,
            buy_now,
            last_sold_price,
            fingerprint
          FROM vehicle_snapshots
          WHERE vehicle_key = ?
          ORDER BY captured_at ASC
        `)
        .bind(vehicleKey)
        .all();


    return rows.results || [];

  } catch {
    return [];
  }
}


/* ============================================================
 * LIST CARS
 * ============================================================
 */

async function getCars(
  request,
  env
) {
  const incoming =
    new URL(request.url);


  const params =
    new URLSearchParams();


  const provider = getProviderAdapter(env);
  for (const [name, value] of Object.entries(provider.listParams(incoming.searchParams))) {
    params.set(name, value);
  }


  if (!params.has("per_page")) {
    params.set(
      "per_page",
      "20"
    );
  }


  /*
   * CACHE
   */

  const cache =
    caches.default;


  const cacheKey =
    new Request(
      request.url,
      {
        method: "GET"
      }
    );


  const cached =
    await cache.match(cacheKey);


  if (cached) {
    const headers =
      new Headers(
        cached.headers
      );


    headers.set(
      "X-RexBid-Cache",
      "HIT"
    );


    return new Response(
      cached.body,
      {
        status:
          cached.status,

        headers
      }
    );
  }


  /*
   * APiBARA
   */

  const result = await fetchProviderVehicles(env, Object.fromEntries(params.entries()));


  const response =
    json(
      {
        ok: provider.responseOk(result),

        data: provider.publicVehicleRecords(result).map(record => provider.publicVehicleRecord(record)),

        meta: provider.responseMeta(result)
      },
      200,
      "MISS",
      CACHE_TTL_SECONDS
    );


  const cacheResponse =
    response.clone();


  await cache.put(
    cacheKey,
    cacheResponse
  );


  return response;
}


/* ============================================================
 * DATABASE STATUS
 * ============================================================
 */

async function getDatabaseStatus(
  env
) {
  if (!env.REXBID_DB) {
    return json(
      {
        ok: false,

        database:
          false,

        error:
          "REXBID_DB nie jest podłączone."
      },
      503,
      "NO-D1",
      0
    );
  }


  try {
    const vehicles =
      await env.REXBID_DB
        .prepare(`
          SELECT COUNT(*) AS count
          FROM vehicles
        `)
        .first();


    const snapshots =
      await env.REXBID_DB
        .prepare(`
          SELECT COUNT(*) AS count
          FROM vehicle_snapshots
        `)
        .first();


    const history =
      await env.REXBID_DB
        .prepare(`
          SELECT COUNT(*) AS count
          FROM auction_history
        `)
        .first();


    return json(
      {
        ok: true,

        database:
          true,

        vehicles:
          vehicles?.count || 0,

        snapshots:
          snapshots?.count || 0,

        auction_history:
          history?.count || 0
      },
      200,
      "D1",
      0
    );

  } catch (error) {
    return errorJson(
      "Błąd D1: " +
      error.message,
      500
    );
  }
}


/* ============================================================
 * WORKER
 * ============================================================
 */

export default {

  async fetch(
    request,
    env
  ) {

    const url = new URL(request.url);

    /*
     * CORS
     */

    if (
      request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,

          headers: {
            "Access-Control-Allow-Origin":
              "*",

            "Access-Control-Allow-Methods":
              "GET, OPTIONS",

            "Access-Control-Allow-Headers":
              "Content-Type"
          }
        }
      );
    }


    /*
     * JAWNA, CHRONIONA SYNCHRONIZACJA PERSISTENCE
     *
     * Operacja ręczna dla operatora. GET-y pozostają wyłącznie odczytowe.
     * Token REXBID_SYNC_TOKEN należy skonfigurować jako osobny sekret.
     */

    const syncPrefix = "/api/sync/vehicle/";
    if (url.pathname.startsWith(syncPrefix)) {
      if (request.method !== "POST") {
        return errorJson("Metoda niedozwolona.", 405);
      }

      const configuredToken = env?.REXBID_SYNC_TOKEN;
      if (!configuredToken || String(configuredToken).length < 32) {
        return errorJson("Synchronizacja nie jest skonfigurowana.", 503);
      }

      const authorization = request.headers.get("Authorization") || "";
      const suppliedToken = authorization.startsWith("Bearer ")
        ? authorization.slice(7)
        : "";
      if (!constantTimeTokenEqual(suppliedToken, configuredToken)) {
        return errorJson("Brak autoryzacji.", 401);
      }

      let identifier;
      try {
        identifier = decodeURIComponent(url.pathname.slice(syncPrefix.length));
      } catch {
        return errorJson("Nieprawidłowy identyfikator samochodu.", 400);
      }
      if (!identifier || identifier.length > 100 || /[\\/?#]/.test(identifier)) {
        return errorJson("Nieprawidłowy identyfikator samochodu.", 400);
      }

      const result = await syncVehicle(env, identifier);
      const status = result.completed ? 200
        : result.error === "NOT_FOUND" ? 404
        : result.error === "D1_UNAVAILABLE" ? 503
        : result.error === "D1_WRITE_FAILED" ? 500 : 502;
      return new Response(JSON.stringify(result), {
        status,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });
    }


    /*
     * TYLKO GET
     */

    if (
      request.method !==
      "GET"
    ) {
      return errorJson(
        "Metoda niedozwolona.",
        405
      );
    }

    if (url.pathname === "/api/filters") {
      try {
        return await getVehicleFilters(request, env);
      } catch (error) {
        console.error("Rex.Bid filters error:", error);
        return errorJson(error.message);
      }
    }


    /*
     * LISTA SAMOCHODÓW
     */

    if (
      url.pathname ===
      "/api/cars"
    ) {
      try {
        return await getCars(
          request,
          env
        );

      } catch (error) {
        console.error(
          "Rex.Bid cars error:",
          error
        );

        return errorJson(
          error.message
        );
      }
    }


    /*
     * STATUS BAZY
     */

    if (
      url.pathname ===
      "/api/database"
    ) {
      try {
        return await getDatabaseStatus(
          env
        );

      } catch (error) {
        return errorJson(
          error.message,
          500
        );
      }
    }


    /*
     * HISTORIA
     *
     * Musi być przed /api/car/
     */

    if (
      url.pathname.startsWith(
        "/api/car/"
      ) &&
      url.pathname.endsWith(
        "/history"
      )
    ) {

      const identifier =
        decodeURIComponent(
          url.pathname
            .substring(
              "/api/car/".length
            )
            .replace(
              /\/history$/,
              ""
            )
        );


      if (!identifier) {
        return errorJson(
          "Brak identyfikatora samochodu",
          400
        );
      }


      try {
        return await getHistory(
          request,
          env,
          identifier
        );

      } catch (error) {
        console.error(
          "Rex.Bid history error:",
          error
        );

        return errorJson(
          error.message
        );
      }
    }


    /*
     * POJEDYNCZY SAMOCHÓD
     */

    if (
      url.pathname.startsWith(
        "/api/car/"
      )
    ) {

      const identifier =
        decodeURIComponent(
          url.pathname.substring(
            "/api/car/".length
          )
        );


      if (!identifier) {
        return errorJson(
          "Brak identyfikatora samochodu",
          400
        );
      }


      try {
        return await getCar(
          request,
          env,
          identifier
        );

      } catch (error) {
        console.error(
          "Rex.Bid vehicle error:",
          error
        );

        return errorJson(
          error.message
        );
      }
    }


    /*
     * ASSETS
     */

    return env.ASSETS.fetch(
      request
    );
  }
};

function constantTimeTokenEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0 && a.length > 0;
}

async function fetchProviderFilters(env, params = {}) {
  return getProviderAdapter(env).fetchFilters(env, params);
}

async function getVehicleFilters(request, env) {
  const provider = getProviderAdapter(env);
  const incoming = new URL(request.url);
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(provider.filterParams(incoming.searchParams))) params.set(name, value);
  const cacheKey = new Request(`https://rex-bid-cache.invalid/api/filters?${params.toString()}`, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-RexBid-Cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers });
  }

  const upstream = await fetchProviderFilters(env, Object.fromEntries(params.entries()));
  const payload = upstream && typeof upstream === "object" ? upstream : {};
  const sourceData = provider.publicFilterData(payload);
  const response = json({
    ok: provider.responseOk(payload),
    data: sourceData && typeof sourceData === "object" ? sourceData : {},
    meta: provider.publicFilterMeta(payload)
  }, 200, "MISS", FILTERS_CACHE_TTL_SECONDS);
  await cache.put(cacheKey, response.clone());
  return response;
}
