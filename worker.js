const APIBARA_BASE =
  "https://apibara.tech/api/v1/vehicle-auction";

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
 * - prawdziwa historia sprzedaży Apibara
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

function vehicleMatchesIdentifier(
  vehicle,
  identifier
) {
  if (
    !vehicle ||
    typeof vehicle !== "object"
  ) {
    return false;
  }

  const wanted =
    normalizeIdentifier(identifier);

  if (!wanted) {
    return false;
  }


  const vinCandidates = [
    vehicle.vin,
    vehicle.VIN,
    vehicle.slug_vin,
    vehicle.slugVin,

    getNested(vehicle, [
      ["vehicle", "vin"]
    ]),

    getNested(vehicle, [
      ["vehicle", "VIN"]
    ]),

    getNested(vehicle, [
      ["details", "vin"]
    ]),

    getNested(vehicle, [
      ["details", "VIN"]
    ])
  ];


  for (const candidate of vinCandidates) {
    if (
      normalizeIdentifier(candidate) ===
      wanted
    ) {
      return true;
    }
  }


  const lotCandidates = [
    vehicle.lot_number,
    vehicle.lot,
    vehicle.stock_number,
    vehicle.stock,
    vehicle.stock_no,
    vehicle.stockNo,

    getNested(vehicle, [
      ["vehicle", "lot_number"]
    ]),

    getNested(vehicle, [
      ["vehicle", "lot"]
    ]),

    getNested(vehicle, [
      ["vehicle", "stock_number"]
    ]),

    getNested(vehicle, [
      ["details", "lot_number"]
    ])
  ];


  for (const candidate of lotCandidates) {
    if (
      normalizeIdentifier(candidate) ===
      wanted
    ) {
      return true;
    }
  }

  return false;
}


/* ============================================================
 * APiBARA REQUEST
 * ============================================================
 */

const APIBARA_TIMEOUT_MS = 10000;
const APIBARA_MAX_PER_PAGE = 20;

const APIBARA_LIST_PARAMS = new Set([
  "s", "platform", "auction_type", "lot_status", "lot_sub_status", "upcoming",
  "make", "series", "model", "generation_id", "generation", "type", "body_style",
  "year_from", "year_to", "price_min", "price_max", "odometer_from", "odometer_to",
  "fuel_type", "transmission", "drive_type", "run_cond", "damage", "color",
  "engine_size_from", "engine_size_to", "engine_type", "cylinders", "has_key",
  "sale_document_pending", "sale_document_type", "seller_type", "zip", "radius",
  "units", "facility_id", "loc_state", "office_name", "auction_date_from",
  "auction_date_to", "today_only", "has_shipping_price", "include_total",
  "per_page", "cursor", "updated_within_minutes"
]);

class ApibaraRequestError extends Error {
  constructor(code, status = null, retryAfter = null) {
    const message = ({
      CONFIGURATION: "Usługa danych pojazdów jest niedostępna.",
      INVALID_REQUEST: "Nieprawidłowe parametry zapytania.",
      TIMEOUT: "Usługa danych pojazdów nie odpowiedziała na czas.",
      RATE_LIMITED: "Usługa danych pojazdów chwilowo ogranicza zapytania.",
      NOT_FOUND: "Nie znaleziono danych pojazdu.",
      AUTH: "Usługa danych pojazdów jest niedostępna.",
      UPSTREAM: "Usługa danych pojazdów zwróciła błąd.",
      INVALID_RESPONSE: "Usługa danych pojazdów zwróciła nieprawidłową odpowiedź."
    })[code] || "Nie udało się pobrać danych pojazdu.";
    super(message);
    this.name = "ApibaraRequestError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function apibaraPerPage(value, defaultValue = 20) {
  if (value === null || value === undefined || value === "") return defaultValue;
  if (!/^\d+$/.test(String(value))) throw new ApibaraRequestError("INVALID_REQUEST", 400);
  return Math.min(APIBARA_MAX_PER_PAGE, Math.max(1, Number(value)));
}

function buildApibaraUrl(requestSpec) {
  if (!requestSpec || typeof requestSpec !== "object") {
    throw new ApibaraRequestError("INVALID_REQUEST", 400);
  }

  let pathname;
  const params = new URLSearchParams();
  const identifier = cleanString(requestSpec.identifier).trim();

  switch (requestSpec.operation) {
    case "vehicleByIdentifier":
      if (!identifier) throw new ApibaraRequestError("INVALID_REQUEST", 400);
      pathname = `/vehicles/${encodeURIComponent(identifier)}`;
      break;

    case "searchVehicles":
      pathname = "/vehicles";
      if (!cleanString(requestSpec.search).trim()) throw new ApibaraRequestError("INVALID_REQUEST", 400);
      params.set("s", cleanString(requestSpec.search).trim());
      params.set("per_page", String(apibaraPerPage(requestSpec.per_page, 20)));
      break;

    case "listVehicles": {
      pathname = "/vehicles";
      const input = requestSpec.params && typeof requestSpec.params === "object" ? requestSpec.params : {};
      for (const [name, value] of Object.entries(input)) {
        if (!APIBARA_LIST_PARAMS.has(name) || value === null || value === undefined || value === "") continue;
        if (name === "per_page") params.set(name, String(apibaraPerPage(value, 20)));
        else params.set(name, String(value));
      }
      if (!params.has("per_page")) params.set("per_page", "20");
      break;
    }

    case "vehicleFilters": {
      pathname = "/vehicles/filters";
      const input = requestSpec.params && typeof requestSpec.params === "object" ? requestSpec.params : {};
      for (const name of ["make", "series", "model"]) {
        const value = input[name];
        if (value !== null && value !== undefined && String(value).trim()) {
          params.set(name, String(value).trim().slice(0, 120));
        }
      }
      break;
    }

    case "vehicleHistory": {
      if (!identifier) throw new ApibaraRequestError("INVALID_REQUEST", 400);
      pathname = `/vehicles/${encodeURIComponent(identifier)}/history`;
      params.set("per_page", String(apibaraPerPage(requestSpec.per_page, 20)));
      // Cursor is opaque: only URL-encode it, never parse, trim, or derive it.
      if (requestSpec.cursor !== null && requestSpec.cursor !== undefined && requestSpec.cursor !== "") {
        params.set("cursor", String(requestSpec.cursor));
      }
      break;
    }

    default:
      throw new ApibaraRequestError("INVALID_REQUEST", 400);
  }

  const base = new URL(`${APIBARA_BASE.replace(/\/+$/, "")}/`);
  const url = new URL(pathname.replace(/^\/+/, ""), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new ApibaraRequestError("INVALID_REQUEST", 400);
  }
  url.search = params.toString();
  return url;
}

function safeApibaraDiagnosticText(value, apiKey) {
  if (value === null || value === undefined) return null;
  let text = String(value);
  if (apiKey) text = text.split(String(apiKey)).join("[REDACTED]");
  text = text.replace(/(x-api-key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  return text.slice(0, 500);
}

function safeApibaraCauseDescription(cause, apiKey, depth = 0) {
  if (cause === null || cause === undefined) return null;
  if (typeof cause !== "object") return safeApibaraDiagnosticText(cause, apiKey);

  const description = {};
  for (const field of ["name", "code", "errno", "syscall", "hostname", "message"]) {
    const value = cause[field];
    if (["string", "number", "boolean"].includes(typeof value)) {
      description[field] = safeApibaraDiagnosticText(value, apiKey);
    }
  }
  if (depth < 1 && cause.cause !== undefined) {
    description.cause = safeApibaraCauseDescription(cause.cause, apiKey, depth + 1);
  }
  return Object.keys(description).length ? description : { type: "object" };
}

function logApibaraRequestDiagnostic(error, stage, apiKey, requestSpec) {
  const cause = error?.cause;
  console.error("Apibara request diagnostic", JSON.stringify({
    operation: requestSpec?.operation || null,
    stage,
    errorName: safeApibaraDiagnosticText(error?.name || "UnknownError", apiKey),
    errorMessage: safeApibaraDiagnosticText(error?.message || "", apiKey),
    causeType: typeof cause,
    cause: safeApibaraCauseDescription(cause, apiKey)
  }));
}

async function requestApibara(env, requestSpec) {
  const apiKey = env?.APIBARA_API_KEY;
  if (!apiKey) throw new ApibaraRequestError("CONFIGURATION", 500);

  let url;
  try {
    url = buildApibaraUrl(requestSpec);
  } catch (error) {
    logApibaraRequestDiagnostic(error, "URL", apiKey, requestSpec);
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APIBARA_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      // Workers fetch supports "manual" but not "error". Never follow upstream
      // redirects so the API key cannot be sent to a different host.
      redirect: "manual",
      headers: { "Accept": "application/json", "X-API-Key": apiKey },
      signal: controller.signal
    });

    if (!response.ok) {
      const code = response.status === 404 ? "NOT_FOUND"
        : response.status === 401 || response.status === 403 ? "AUTH"
        : response.status === 429 ? "RATE_LIMITED" : "UPSTREAM";
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfter = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : null;
      console.warn("Apibara HTTP response error", JSON.stringify({
        operation: requestSpec.operation,
        stage: "fetch",
        status: response.status,
        code,
        contentType: response.headers.get("Content-Type") || null
      }));
      // Consume but never include upstream error bodies in exceptions or logs.
      try { await response.body?.cancel(); } catch {}
      throw new ApibaraRequestError(code, response.status, retryAfter);
    }

    try {
      return await response.json();
    } catch {
      throw new ApibaraRequestError("INVALID_RESPONSE", response.status);
    }
  } catch (error) {
    if (error instanceof ApibaraRequestError) throw error;
    logApibaraRequestDiagnostic(error, "fetch", apiKey, requestSpec);
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new ApibaraRequestError("TIMEOUT", 504);
    }
    throw new ApibaraRequestError("UPSTREAM", null);
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
 * APiBARA READ LAYER
 * ============================================================
 * These helpers perform upstream reads only. They never access D1;
 * endpoint handlers decide separately whether to persist the result.
 */

async function fetchApibaraVehicle(env, identifier) {
  return requestApibara(env, {
    operation: "vehicleByIdentifier",
    identifier
  });
}

async function searchApibaraVehicles(env, search, perPage = 20) {
  return requestApibara(env, {
    operation: "searchVehicles",
    search,
    per_page: perPage
  });
}

async function fetchApibaraHistory(env, identifier, { per_page = 20, cursor = null } = {}) {
  const response = await requestApibara(env, {
    operation: "vehicleHistory",
    identifier,
    per_page,
    cursor
  });
  return {
    response,
    records: getApibaraHistoryRecords(response),
    nextCursor: response?.meta?.next_cursor ?? response?.data?.meta?.next_cursor ?? null
  };
}

async function fetchApibaraVehicles(env, params = {}) {
  return requestApibara(env, {
    operation: "listVehicles",
    params
  });
}

function normalizeApibaraVehicleList(result) {
  if (!Array.isArray(result?.data)) return [];
  return result.data
    .map(raw => ({ raw, normalized: normalizeVehicle(raw) }))
    .filter(item => item.normalized);
}

function apibaraErrorResponse(error) {
  if (!(error instanceof ApibaraRequestError)) return errorJson("Nie udało się pobrać danych.", 502);
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

function normalizeVehicle(vehicle) {
  if (
    !vehicle ||
    typeof vehicle !== "object"
  ) {
    return null;
  }


  const vin =
    cleanString(
      firstValue(vehicle, [
        "vin",
        "VIN"
      ])
    );


  const slugVin =
    cleanString(
      firstValue(vehicle, [
        "slug_vin",
        "slugVin"
      ])
    );


  const platform =
    cleanString(
      firstValue(vehicle, [
        "platform"
      ])
    ).toLowerCase();


  const lot =
    cleanString(
      firstValue(vehicle, [
        "lot_number",
        "lot",
        "stock_number",
        "stock"
      ])
    );


  const title =
    cleanString(
      firstValue(vehicle, [
        "title",
        "name"
      ])
    );


  const year =
    numberOrNull(
      firstValue(vehicle, [
        "year"
      ])
    );


  const make =
    cleanString(
      firstValue(vehicle, [
        "make"
      ])
    );


  const model =
    cleanString(
      firstValue(vehicle, [
        "model"
      ])
    );


  /* AUCTION */

  const auction =
    vehicle.auction &&
    typeof vehicle.auction === "object"
      ? vehicle.auction
      : {};


  const auctionState =
    cleanString(
      firstValue(auction, [
        "state",
        "status"
      ])
    );


  const auctionAt =
    firstValue(auction, [
      "auction_at",
      "auctionAt",
      "full_date",
      "date",
      "start_at",
      "startAt"
    ]);


  const auctionEnd =
    firstValue(auction, [
      "end_at",
      "endAt",
      "ends_at",
      "endsAt",
      "timed_end_at"
    ]);


  /* PRICING */

  const pricing =
    vehicle.pricing &&
    typeof vehicle.pricing === "object"
      ? vehicle.pricing
      : {};


  const currentBid =
    numberOrNull(
      firstValue(pricing, [
        "current_bid_usd",
        "current_bid",
        "bid_usd",
        "current_bid2_usd"
      ])
    );


  const buyNow =
    numberOrNull(
      firstValue(pricing, [
        "buy_now_usd",
        "buy_now"
      ])
    );


  const lastSoldPrice =
    numberOrNull(
      firstValue(pricing, [
        "last_sold_price_usd",
        "last_sold_price",
        "sold_price_usd",
        "sold_price"
      ])
    );


  /* LOCATION */

  const location =
    vehicle.location &&
    typeof vehicle.location === "object"
      ? vehicle.location
      : {};


  const locationDisplay =
    cleanString(
      firstValue(location, [
        "display",
        "name",
        "city"
      ])
    );


  /* CONDITION */

  const condition =
    vehicle.condition &&
    typeof vehicle.condition === "object"
      ? vehicle.condition
      : {};


  const damage =
    cleanString(
      firstValue(condition, [
        "primary_damage",
        "damage"
      ])
    );


  const secondaryDamage =
    cleanString(
      firstValue(condition, [
        "secondary_damage"
      ])
    );


  const lossType =
    cleanString(
      firstValue(condition, [
        "loss_type",
        "lossType",
        "loss"
      ])
    );


  const runCondition =
    cleanString(
      firstValue(condition, [
        "run_condition",
        "runCondition"
      ])
    );


  const hasKey =
    firstValue(condition, [
      "has_key",
      "hasKey"
    ]);


  /* ODOMETER */

  const odometer =
    vehicle.odometer &&
    typeof vehicle.odometer === "object"
      ? vehicle.odometer
      : {};


  const mileage =
    numberOrNull(
      firstValue(odometer, [
        "mi",
        "miles"
      ])
    );


  /* SELLER */

  const seller =
    vehicle.seller &&
    typeof vehicle.seller === "object"
      ? vehicle.seller
      : {};


  const sellerName =
    cleanString(
      firstValue(seller, [
        "name",
        "seller_name",
        "sellerName"
      ])
    );


  const sellerType =
    cleanString(
      firstValue(seller, [
        "type",
        "normalized_type",
        "seller_type",
        "sellerType"
      ])
    );


  /* SALE DOCUMENT */

  const saleDocument =
    vehicle.sale_document &&
    typeof vehicle.sale_document === "object"
      ? vehicle.sale_document
      : {};


  const documentName =
    cleanString(
      firstValue(saleDocument, [
        "name",
        "document_name",
        "documentName"
      ])
    );


  const documentType =
    cleanString(
      firstValue(saleDocument, [
        "type",
        "normalized_type",
        "document_type",
        "documentType"
      ])
    );


  const exportAllowed =
    firstValue(saleDocument, [
      "export_allowed",
      "exportAllowed",
      "export"
    ]);


  const registrationAllowed =
    firstValue(saleDocument, [
      "registration_allowed",
      "registrationAllowed",
      "registration",
      "can_register"
    ]);


  /* MEDIA */

  const media =
    vehicle.media &&
    typeof vehicle.media === "object"
      ? vehicle.media
      : {};


  const hasVideo =
    firstValue(media, [
      "has_video",
      "hasVideo"
    ]);


  const has360 =
    firstValue(media, [
      "has_360",
      "has360",
      "has_360_view",
      "has360View"
    ]);


  /* AUCTION URL */

  const auctionUrl =
    cleanString(
      firstValue(vehicle, [
        "auction_url",
        "auctionUrl",
        "source_url",
        "sourceUrl",
        "url",
        "listing_url",
        "listingUrl"
      ])
    );


  const identity =
    vin ||
    slugVin ||
    lot ||
    "";


  if (!identity) {
    return null;
  }


  const vehicleKey =
    (
      platform ||
      "unknown"
    ) +
    ":" +
    identity;


  const fingerprintSource = {
    platform,
    vin,
    lot,
    auctionState,
    auctionAt,
    auctionEnd,
    currentBid,
    buyNow,
    lastSoldPrice,
    locationDisplay,
    damage,
    secondaryDamage,
    mileage,
    sellerName,
    sellerType,
    documentName,
    documentType
  };


  const fingerprint =
    simpleHash(
      JSON.stringify(
        fingerprintSource
      )
    );


  return {
    vehicleKey,
    vin,
    slugVin,
    platform,
    lot,
    title,
    year,
    make,
    model,

    auctionState,
    auctionAt,
    auctionEnd,

    currentBid,
    buyNow,
    lastSoldPrice,

    locationDisplay,

    damage,
    secondaryDamage,
    lossType,
    runCondition,
    hasKey,

    mileage,

    sellerName,
    sellerType,

    documentName,
    documentType,
    exportAllowed,
    registrationAllowed,

    hasVideo,
    has360,

    auctionUrl,

    fingerprint
  };
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
          fingerprint
        FROM vehicles
        WHERE vehicle_key = ?
        LIMIT 1
      `)
      .bind(vehicle.vehicleKey)
      .first();


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

        vin = excluded.vin,
        slug_vin = excluded.slug_vin,
        platform = excluded.platform,
        lot = excluded.lot,

        title = excluded.title,
        year = excluded.year,
        make = excluded.make,
        model = excluded.model,

        auction_state = excluded.auction_state,
        auction_at = excluded.auction_at,
        auction_end = excluded.auction_end,

        current_bid = excluded.current_bid,
        buy_now = excluded.buy_now,
        last_sold_price = excluded.last_sold_price,

        location_display = excluded.location_display,

        damage = excluded.damage,
        secondary_damage = excluded.secondary_damage,
        loss_type = excluded.loss_type,
        run_condition = excluded.run_condition,
        has_key = excluded.has_key,

        mileage = excluded.mileage,

        seller_name = excluded.seller_name,
        seller_type = excluded.seller_type,

        document_name = excluded.document_name,
        document_type = excluded.document_type,
        export_allowed = excluded.export_allowed,
        registration_allowed = excluded.registration_allowed,

        has_video = excluded.has_video,
        has_360 = excluded.has_360,

        auction_url = excluded.auction_url,

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

      safeJson(rawVehicle)
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

        safeJson(rawVehicle)
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
  if (
    !result ||
    !Array.isArray(result.data)
  ) {
    return {
      saved: false,
      count: 0
    };
  }


  let count = 0;


  for (
    const vehicle of result.data
  ) {
    const normalized =
      normalizeVehicle(vehicle);


    if (!normalized) {
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
  const perPage = apibaraPerPage(options.per_page, 20);
  let rawVehicle = null;

  try {
    const direct = await fetchApibaraVehicle(env, identifier);
    if (direct?.data && vehicleMatchesIdentifier(direct.data, identifier)) {
      rawVehicle = direct.data;
    } else if (direct?.data) {
      const search = await searchApibaraVehicles(env, identifier, 20);
      rawVehicle = Array.isArray(search?.data)
        ? search.data.find(item => vehicleMatchesIdentifier(item, identifier)) || null
        : null;
    }
  } catch (error) {
    if (error?.code !== "NOT_FOUND") {
      return { ok: false, completed: false, phase: "vehicle", error: error?.code || "UPSTREAM" };
    }
  }

  if (!rawVehicle) {
    try {
      const search = await searchApibaraVehicles(env, identifier, 20);
      rawVehicle = Array.isArray(search?.data)
        ? search.data.find(item => vehicleMatchesIdentifier(item, identifier)) || null
        : null;
    } catch (error) {
      return { ok: false, completed: false, phase: "vehicle", error: error?.code || "UPSTREAM" };
    }
  }

  const normalizedVehicle = normalizeVehicle(rawVehicle);
  if (!normalizedVehicle) {
    return { ok: false, completed: false, phase: "vehicle", error: "NOT_FOUND" };
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
        fetched = await fetchApibaraHistory(env, identifier, { per_page: perPage, cursor });
      } catch (error) {
        return { ok: false, completed: false, phase: "history", error: error?.code || "UPSTREAM", pagesFetched };
      }

      pagesFetched++;
      historyRecords.push(...normalizeApibaraHistory(fetched.response, {
        vin: normalizedVehicle.vin,
        platform: normalizedVehicle.platform,
        lot: normalizedVehicle.lot
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
      ? await saveOfficialHistory(env, normalizedVehicle.vehicleKey, historyRecords)
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
      response = await fetchApibaraVehicles(env, { ...params, ...(cursor ? { cursor } : {}) });
    } catch (error) {
      return { ok: false, completed: false, error: error?.code || "UPSTREAM", pagesFetched: pages.length };
    }
    pages.push(response);
    const nextCursor = response?.meta?.next_cursor ?? response?.data?.meta?.next_cursor ?? null;
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
    for (const item of normalizeApibaraVehicleList(response)) {
      byKey.set(item.normalized.vehicleKey, item);
    }
  }

  try {
    await ensureDatabase(env);
    const result = await saveApiVehicle(env, { data: [...byKey.values()].map(item => item.raw) });
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
 * NORMALIZE APiBARA HISTORY
 * ============================================================
 *
 * Apibara zwraca:
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

function getApibaraHistoryRecords(
  result
) {
  if (!result) {
    return [];
  }


  const data =
    result.data;


  if (!data) {
    return [];
  }


  if (
    Array.isArray(data.history)
  ) {
    return data.history;
  }


  if (
    data.history &&
    Array.isArray(data.history.data)
  ) {
    return data.history.data;
  }


  if (
    Array.isArray(data)
  ) {
    return data;
  }


  return [];
}

function normalizeApibaraHistory(result, vehicleContext = {}) {
  return getApibaraHistoryRecords(result)
    .map(record => normalizeHistoryRecord(record, vehicleContext))
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

function normalizeHistoryRecord(
  record,
  vehicleContext = {}
) {
  if (
    !record ||
    typeof record !== "object"
  ) {
    return null;
  }


  const vehicle = record.vehicle && typeof record.vehicle === "object" ? record.vehicle : {};
  const platform = cleanString(firstValue(record, ["platform", "source"]) || firstValue(vehicle, ["platform", "source"]) || vehicleContext.platform).toLowerCase();
  const vin = cleanString(firstValue(record, ["vin", "VIN"]) || firstValue(vehicle, ["vin", "VIN"]) || vehicleContext.vin).toUpperCase();
  const lot = cleanString(firstValue(record, ["lot_number", "lotNumber", "lot", "stock_number", "stockNumber"])
    || firstValue(vehicle, ["lot_number", "lotNumber", "lot", "stock_number", "stockNumber"]) || vehicleContext.lot);
  const seller = cleanString(firstValue(record, ["seller_name", "sellerName"])
    || getNested(record, [["seller", "name"], ["seller", "displayName"]])
    || (typeof record.seller === "string" ? record.seller : null)
    || firstValue(record, ["seller_type", "sellerType"])
    || getNested(record, [["seller", "type"]]));

  // Only semantically explicit event identifiers are accepted. A generic `id`
  // may identify the vehicle/listing rather than this historical auction.
  // The current public Apibara schema does not name a stable event-ID field.
  // Accept only an explicitly named source_event_id if a response supplies it;
  // do not guess that generic `id` or undocumented aliases identify an event.
  const sourceEventId = cleanString(firstValue(record, ["source_event_id"])
    || getNested(record, [["auction", "source_event_id"]]));
  const explicitEventKey = cleanString(firstValue(record, ["event_key"])
    || getNested(record, [["auction", "event_key"]]));

  const status = cleanString(firstValue(record, ["status", "sale_status", "saleStatus", "auction_status", "auctionStatus", "lot_sub_status", "state"])
    || getNested(record, [["auction", "last_sold_status"], ["auction", "status"], ["auction", "lot_sub_status"], ["sale", "status"], ["vehicle", "auction", "status"], ["vehicle", "auction", "lot_sub_status"]]));
  const statusLower = status.toLowerCase();
  const isUnsold = /not sold|no sale|unsold|failed/.test(statusLower);
  const isSold = /sold|sale complete|completed|won|approved/.test(statusLower) && !isUnsold;

  const auctionDateRaw = firstValue(record, ["auction_date", "auctionDate", "auction_at", "auctionAt", "full_date"])
    || getNested(record, [["auction", "auction_at"], ["auction", "auctionAt"], ["auction", "full_date"], ["vehicle", "auction", "auction_at"]]);
  const saleDateRaw = firstValue(record, ["sale_date", "saleDate", "sold_date", "sold_at", "soldAt", "last_sold_day", "lastSoldDay"])
    || getNested(record, [["auction", "last_sold_day"], ["sale", "date"], ["sale", "sold_at"], ["vehicle", "auction", "last_sold_day"]]);
  const genericDate = firstValue(record, ["date"]);
  const auctionDate = historyDate(auctionDateRaw || (!isSold ? genericDate : null));
  const saleDate = historyDate(saleDateRaw || (isSold ? genericDate : null));

  const pricing = record.pricing && typeof record.pricing === "object" ? record.pricing
    : vehicle.pricing && typeof vehicle.pricing === "object" ? vehicle.pricing : {};
  const auction = record.auction && typeof record.auction === "object" ? record.auction
    : vehicle.auction && typeof vehicle.auction === "object" ? vehicle.auction : {};
  const currentBid = numberOrNull(firstValue(pricing, ["current_bid_usd", "current_bid", "currentBidUsd", "currentBid"])
    ?? firstValue(record, ["current_bid_usd", "current_bid", "currentBidUsd", "currentBid", "bid"])
    ?? firstValue(auction, ["current_bid_usd", "current_bid"]));
  const buyNow = numberOrNull(firstValue(pricing, ["buy_now_usd", "buy_now", "buyNowUsd", "buyNow"])
    ?? firstValue(record, ["buy_now_usd", "buy_now", "buyNowUsd", "buyNow"]));

  // A generic `price` remains source_price. Only explicitly named sale/final
  // fields can populate final_price, and a not-sold status always clears it.
  const explicitFinalPrice = firstValue(pricing, ["sale_price_usd", "final_price_usd", "final_bid_usd", "sold_price_usd"])
    ?? firstValue(record, ["sale_price_usd", "sale_price", "final_price_usd", "final_price", "final_bid_usd", "final_bid", "sold_price_usd", "sold_price"]);
  const finalPrice = isUnsold ? null : numberOrNull(explicitFinalPrice);
  const sourcePrice = numberOrNull(firstValue(record, ["price", "price_usd"])
    ?? firstValue(pricing, ["price", "price_usd"]));

  let eventKey = "";
  if (sourceEventId) {
    eventKey = `source:${platform || "unknown"}:${sourceEventId}`;
  } else if (explicitEventKey) {
    eventKey = /^(source|fallback):/.test(explicitEventKey)
      ? explicitEventKey
      : `source:${platform || "unknown"}:${explicitEventKey}`;
  } else {
    const identityDate = auctionDate || saleDate;
    const identity = lot ? `lot:${historyIdentityPart(lot)}` : vin ? `vin:${historyIdentityPart(vin)}` : "";
    const identityDay = String(identityDate || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || identityDate;
    if (identity && identityDay) {
      eventKey = `fallback:${platform || "unknown"}:${identity}:date:${identityDay}`;
    }
  }

  if (!platform && !vin && !lot && !auctionDate && !saleDate && !status && currentBid === null && finalPrice === null && buyNow === null && sourcePrice === null) {
    return null;
  }

  return {
    event_key: eventKey || null,
    source_event_id: sourceEventId || null,
    vin: vin || null,
    platform: platform || null,
    lot: lot || null,
    auction_date: auctionDate,
    sale_date: saleDate,
    current_bid: currentBid,
    final_price: finalPrice,
    buy_now: buyNow,
    source_price: sourcePrice,
    seller: seller || null,
    status: status || null,
    raw_json: record
  };
}


/* ============================================================
 * HISTORY EVENT HASH
 * ============================================================
 */

function historyEventHash(
  record
) {
  // event_hash is retained for compatibility with the existing schema. Its
  // input is now the stable event key, never mutable price/status fields.
  return simpleHash(record.event_key || safeJson(record.raw_json));
}


/* ============================================================
 * SAVE OFFICIAL APiBARA HISTORY
 * ============================================================
 */

async function saveOfficialHistory(
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
      const explicitlyUnsold = /not sold|no sale|unsold|failed/i.test(normalized.status || "");
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
  const encoded =
    encodeURIComponent(identifier);

  let upstreamFailure = null;
  let shouldSearch = false;

  /* DIRECT APiBARA */

  try {
    const result = await fetchApibaraVehicle(env, identifier);


    if (
      result &&
      result.data
    ) {
      const normalized =
        normalizeVehicle(
          result.data
        );


      if (
        vehicleMatchesIdentifier(
          result.data,
          identifier
        )
      ) {
        return json(
          {
            ok:
              result.ok !== false,

            data:
              result.data,

            source:
              "apibara",

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
        "Apibara direct result does not match:",
        identifier
      );
    }

  } catch (error) {
    if (error?.code === "NOT_FOUND") {
      shouldSearch = true;
    } else {
      upstreamFailure = error;
      console.warn("Apibara direct lookup failed", error?.code || "UNKNOWN", error?.status || "");
    }
  }


  /* FALLBACK SEARCH */

  if (shouldSearch || !upstreamFailure) try {
    const searchResult = await searchApibaraVehicles(env, identifier, 20);


    if (
      searchResult &&
      Array.isArray(searchResult.data)
    ) {
      const exact =
        searchResult.data.find(
          item =>
            vehicleMatchesIdentifier(
              item,
              identifier
            )
        );


      if (exact) {
        const normalized =
          normalizeVehicle(exact);


        return json(
          {
            ok: true,

            data:
              exact,

            source:
              "apibara-search",

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
    console.warn("Apibara fallback failed", error?.code || "UNKNOWN", error?.status || "");
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

  let apibaraHistory = null;
  let apibaraNextCursor = null;

  let apibaraError = null;


  /*
   * Najważniejsza zmiana:
   *
   * Pobieramy pełne 20 rekordów.
   * Apibara dokumentuje maksymalnie 20 na request
   * dla tego endpointu.
   */

  try {
    const historyPage = await fetchApibaraHistory(env, identifier, {
      per_page: perPage,
      cursor
    });
    apibaraHistory = historyPage.response;
    apibaraNextCursor = historyPage.nextCursor;

  } catch (error) {
    apibaraError =
      error.message;

    console.warn(
      "Rex.Bid Apibara history error:",
      error.message
    );
  }


  /* GET performs D1 SELECTs only for the existing history/snapshot fallback. */
  let localVehicle = null;
  if (env.REXBID_DB) {
    try {
      localVehicle = await findLocalVehicle(env, identifier);

      if (!localVehicle && apibaraHistory?.data?.vehicle) {
        const vehicle = normalizeVehicle(apibaraHistory.data.vehicle);
        if (vehicle) {
          localVehicle = await findLocalVehicle(
            env,
            vehicle.vin || vehicle.lot || vehicle.slugVin
          );
        }
      }
    } catch (dbError) {
      console.error("Rex.Bid official history lookup error:", dbError);
    }
  }

  const vehicleContext = {
    vin: localVehicle?.vin || apibaraHistory?.data?.vehicle?.vin,
    platform: localVehicle?.platform || apibaraHistory?.data?.vehicle?.platform,
    lot: localVehicle?.lot || apibaraHistory?.data?.vehicle?.lot_number
  };
  let officialHistory = apibaraHistory
    ? normalizeApibaraHistory(apibaraHistory, vehicleContext)
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

  const finalHistory = apibaraHistory ? officialHistory : savedHistory;
  const nextCursor = apibaraHistory ? apibaraNextCursor : null;


  /*
   * Zwracamy jednocześnie:
   *
   * data        -> oryginalna odpowiedź Apibara
   * history     -> prosta tablica do wyświetlenia
   * rex_history -> nasza historia D1
   */

  return json(
    {
      ok: true,

      data:
        apibaraHistory
          ? apibaraHistory.data || null
          : null,

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

      source:
        apibaraHistory
          ? "apibara"
          : "d1",

      error:
        apibaraError
          ? apibaraError
          : null
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


  const allowedParams = [
    "s",
    "platform",
    "auction_type",
    "lot_status",
    "lot_sub_status",
    "upcoming",
    "make",
    "series",
    "model",
    "generation_id",
    "generation",
    "type",
    "body_style",
    "year_from",
    "year_to",
    "price_min",
    "price_max",
    "odometer_from",
    "odometer_to",
    "fuel_type",
    "transmission",
    "drive_type",
    "run_cond",
    "damage",
    "color",
    "engine_size_from",
    "engine_size_to",
    "engine_type",
    "cylinders",
    "has_key",
    "sale_document_pending",
    "sale_document_type",
    "seller_type",
    "zip",
    "radius",
    "units",
    "facility_id",
    "loc_state",
    "office_name",
    "auction_date_from",
    "auction_date_to",
    "today_only",
    "has_shipping_price",
    "include_total",
    "per_page",
    "cursor",
    "updated_within_minutes"
  ];


  for (
    const name of allowedParams
  ) {
    const value =
      incoming.searchParams.get(name);


    if (
      value !== null &&
      value !== ""
    ) {
      params.set(
        name,
        value
      );
    }
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

  const result = await fetchApibaraVehicles(env, Object.fromEntries(params.entries()));


  const response =
    json(
      {
        ok:
          result.ok !== false,

        data:
          Array.isArray(result.data)
            ? result.data
            : [],

        meta:
          result.meta ||
          null
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

async function fetchApibaraVehicleFilters(env, params = {}) {
  return requestApibara(env, { operation: "vehicleFilters", params });
}

async function getVehicleFilters(request, env) {
  const incoming = new URL(request.url);
  const params = new URLSearchParams();
  for (const name of ["make", "series", "model"]) {
    const value = incoming.searchParams.get(name);
    if (value && value.trim()) params.set(name, value.trim().slice(0, 120));
  }
  const cacheKey = new Request(`https://rex-bid-cache.invalid/api/filters?${params.toString()}`, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-RexBid-Cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers });
  }

  const upstream = await fetchApibaraVehicleFilters(env, Object.fromEntries(params.entries()));
  const payload = upstream && typeof upstream === "object" ? upstream : {};
  const response = json({
    ok: payload.ok !== false,
    data: payload.data && typeof payload.data === "object" ? payload.data : payload,
    meta: payload.meta || null
  }, 200, "MISS", FILTERS_CACHE_TTL_SECONDS);
  await cache.put(cacheKey, response.clone());
  return response;
}
