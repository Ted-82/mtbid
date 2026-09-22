const APIBARA_BASE =
  "https://apibara.tech/api/v1/vehicle-auction";

const CACHE_TTL_SECONDS = 60;

/*
 * ============================================================
 * REX.BID WORKER
 * ============================================================
 *
 * API:
 *
 * /api/cars
 * /api/car/VIN
 * /api/car/VIN/history
 * /api/database
 *
 * D1:
 *
 * REXBID_DB
 *
 * Ważne:
 * - wyszukiwanie VIN wymaga dokładnego dopasowania
 * - nie wybieramy pierwszego wyniku
 * - historia aukcji pochodzi bezpośrednio z endpointu
 *   Apibara /vehicles/{VIN}/history
 * - historia jest zapisywana lokalnie w D1
 * - historia nie jest mieszana ze snapshotami zmian pojazdu
 */

/*
 * ============================================================
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
    "Content-Type":
      "application/json; charset=UTF-8",

    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",

    "Cache-Control":
      cacheSeconds > 0
        ? `public, max-age=${cacheSeconds}`
        : "no-store"
  };

  if (cacheStatus) {
    headers["X-RexBid-Cache"] =
      cacheStatus;
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


/*
 * ============================================================
 * GENERIC HELPERS
 * ============================================================
 */

function safeJson(value) {
  try {
    return JSON.stringify(
      value ?? null
    );
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

      current =
        current[part];
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

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


/*
 * ============================================================
 * IDENTIFIER
 * ============================================================
 */

function normalizeIdentifier(value) {
  return cleanString(value)
    .toUpperCase()
    .replace(/[\s-]/g, "");
}


/*
 * ============================================================
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
    normalizeIdentifier(
      identifier
    );

  if (!wanted) {
    return false;
  }

  const vinCandidates = [
    vehicle.vin,
    vehicle.VIN,
    vehicle.slug_vin,
    vehicle.slugVin,

    getNested(
      vehicle,
      [["vehicle", "vin"]]
    ),

    getNested(
      vehicle,
      [["vehicle", "VIN"]]
    ),

    getNested(
      vehicle,
      [["details", "vin"]]
    ),

    getNested(
      vehicle,
      [["details", "VIN"]]
    )
  ];

  for (
    const candidate of vinCandidates
  ) {
    if (
      normalizeIdentifier(
        candidate
      ) === wanted
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

    getNested(
      vehicle,
      [["vehicle", "lot_number"]]
    ),

    getNested(
      vehicle,
      [["vehicle", "lot"]]
    ),

    getNested(
      vehicle,
      [["vehicle", "stock_number"]]
    ),

    getNested(
      vehicle,
      [["details", "lot_number"]]
    )
  ];

  for (
    const candidate of lotCandidates
  ) {
    if (
      normalizeIdentifier(
        candidate
      ) === wanted
    ) {
      return true;
    }
  }

  return false;
}


/*
 * ============================================================
 * APiBARA API KEY
 * ============================================================
 *
 * Obsługujemy obie nazwy:
 *
 * APIBARA_API_KEY
 * APIBARA_KEY
 *
 * Dzięki temu nie rozwalimy obecnej konfiguracji.
 */

function getApibaraKey(env) {
  return (
    env.APIBARA_API_KEY ||
    env.APIBARA_KEY ||
    ""
  );
}


/*
 * ============================================================
 * APiBARA REQUEST
 * ============================================================
 */

async function fetchApibara(
  endpoint,
  env
) {
  const apiKey =
    getApibaraKey(env);

  if (!apiKey) {
    throw new Error(
      "Brak klucza Apibara. Ustaw APIBARA_API_KEY albo APIBARA_KEY."
    );
  }

  const url =
    APIBARA_BASE +
    endpoint;

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "Accept":
            "application/json",

          "X-API-Key":
            apiKey
        }
      }
    );

  const text =
    await response.text();

  let result;

  try {
    result =
      JSON.parse(text);
  } catch {
    throw new Error(
      `Apibara zwróciła nie-JSON. HTTP ${response.status}. Odpowiedź: ${text.substring(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      result.message ||
      result.error ||
      `Apibara HTTP ${response.status}`
    );
  }

  return result;
}


/*
 * ============================================================
 * VEHICLE NORMALIZATION
 * ============================================================
 */

function normalizeVehicle(
  vehicle
) {
  if (
    !vehicle ||
    typeof vehicle !== "object"
  ) {
    return null;
  }

  const vin =
    cleanString(
      firstValue(
        vehicle,
        [
          "vin",
          "VIN"
        ]
      )
    );

  const slugVin =
    cleanString(
      firstValue(
        vehicle,
        [
          "slug_vin",
          "slugVin"
        ]
      )
    );

  const platform =
    cleanString(
      firstValue(
        vehicle,
        [
          "platform"
        ]
      )
    ).toLowerCase();

  const lot =
    cleanString(
      firstValue(
        vehicle,
        [
          "lot_number",
          "lot",
          "stock_number",
          "stock"
        ]
      )
    );

  const title =
    cleanString(
      firstValue(
        vehicle,
        [
          "title",
          "name"
        ]
      )
    );

  const year =
    numberOrNull(
      firstValue(
        vehicle,
        [
          "year"
        ]
      )
    );

  const make =
    cleanString(
      firstValue(
        vehicle,
        [
          "make"
        ]
      )
    );

  const model =
    cleanString(
      firstValue(
        vehicle,
        [
          "model"
        ]
      )
    );


  /*
   * AUCTION
   */

  const auction =
    vehicle.auction &&
    typeof vehicle.auction === "object"
      ? vehicle.auction
      : {};

  const auctionState =
    cleanString(
      firstValue(
        auction,
        [
          "state",
          "status"
        ]
      )
    );

  const auctionAt =
    firstValue(
      auction,
      [
        "auction_at",
        "auctionAt",
        "full_date",
        "date",
        "start_at",
        "startAt"
      ]
    );

  const auctionEnd =
    firstValue(
      auction,
      [
        "end_at",
        "endAt",
        "ends_at",
        "endsAt",
        "timed_end_at"
      ]
    );


  /*
   * PRICING
   */

  const pricing =
    vehicle.pricing &&
    typeof vehicle.pricing === "object"
      ? vehicle.pricing
      : {};

  const currentBid =
    numberOrNull(
      firstValue(
        pricing,
        [
          "current_bid_usd",
          "current_bid",
          "bid_usd"
        ]
      )
    );

  const buyNow =
    numberOrNull(
      firstValue(
        pricing,
        [
          "buy_now_usd",
          "buy_now"
        ]
      )
    );

  const lastSoldPrice =
    numberOrNull(
      firstValue(
        pricing,
        [
          "last_sold_price_usd",
          "last_sold_price",
          "sold_price_usd",
          "sold_price"
        ]
      )
    );


  /*
   * LOCATION
   */

  const location =
    vehicle.location &&
    typeof vehicle.location === "object"
      ? vehicle.location
      : {};

  const locationDisplay =
    cleanString(
      firstValue(
        location,
        [
          "display",
          "name",
          "city"
        ]
      )
    );


  /*
   * CONDITION
   */

  const condition =
    vehicle.condition &&
    typeof vehicle.condition === "object"
      ? vehicle.condition
      : {};

  const damage =
    cleanString(
      firstValue(
        condition,
        [
          "primary_damage",
          "damage"
        ]
      )
    );

  const lossType =
    cleanString(
      firstValue(
        condition,
        [
          "loss_type",
          "lossType"
        ]
      )
    );

  const runCondition =
    cleanString(
      firstValue(
        condition,
        [
          "run_condition",
          "runCondition"
        ]
      )
    );


  /*
   * ODOMETER
   */

  const odometer =
    vehicle.odometer &&
    typeof vehicle.odometer === "object"
      ? vehicle.odometer
      : {};

  const mileage =
    numberOrNull(
      firstValue(
        odometer,
        [
          "mi",
          "miles"
        ]
      )
    );


  /*
   * SELLER
   */

  const seller =
    vehicle.seller &&
    typeof vehicle.seller === "object"
      ? vehicle.seller
      : {};

  const sellerName =
    cleanString(
      firstValue(
        seller,
        [
          "name",
          "seller_name",
          "sellerName"
        ]
      )
    );

  const sellerType =
    cleanString(
      firstValue(
        seller,
        [
          "type",
          "normalized_type",
          "seller_type",
          "sellerType"
        ]
      )
    );


  /*
   * SALE DOCUMENT
   */

  const saleDocument =
    vehicle.sale_document &&
    typeof vehicle.sale_document === "object"
      ? vehicle.sale_document
      : {};

  const documentName =
    cleanString(
      firstValue(
        saleDocument,
        [
          "name",
          "document_name",
          "documentName"
        ]
      )
    );

  const documentType =
    cleanString(
      firstValue(
        saleDocument,
        [
          "type",
          "normalized_type",
          "document_type",
          "documentType"
        ]
      )
    );

  const exportAllowed =
    firstValue(
      saleDocument,
      [
        "export_allowed",
        "exportAllowed"
      ]
    );

  const registrationAllowed =
    firstValue(
      saleDocument,
      [
        "registration_allowed",
        "registrationAllowed",
        "can_register"
      ]
    );


  /*
   * MEDIA
   */

  const media =
    vehicle.media &&
    typeof vehicle.media === "object"
      ? vehicle.media
      : {};

  const hasVideo =
    firstValue(
      media,
      [
        "has_video",
        "hasVideo"
      ]
    );

  const has360 =
    firstValue(
      media,
      [
        "has_360",
        "has360",
        "has_360_view",
        "has360View"
      ]
    );


  /*
   * ORIGINAL AUCTION URL
   */

  const auctionUrl =
    cleanString(
      firstValue(
        vehicle,
        [
          "auction_url",
          "auctionUrl",
          "source_url",
          "sourceUrl",
          "url",
          "listing_url",
          "listingUrl"
        ]
      )
    );


  /*
   * VEHICLE KEY
   */

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


  /*
   * FINGERPRINT
   */

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
    mileage,
    sellerName,
    sellerType
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
    lossType,
    runCondition,

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


/*
 * ============================================================
 * SIMPLE HASH
 * ============================================================
 */

function simpleHash(
  value
) {
  let hash =
    2166136261;

  for (
    let i = 0;
    i < value.length;
    i++
  ) {
    hash ^=
      value.charCodeAt(i);

    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);

    hash >>>=
      0;
  }

  return String(
    hash >>> 0
  );
}


/*
 * ============================================================
 * D1 SCHEMA
 * ============================================================
 */

async function ensureDatabase(
  env
) {
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
      loss_type TEXT,
      run_condition TEXT,

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


  /*
   * Prawdziwa historia aukcji z Apibara.
   *
   * To NIE jest snapshot.
   * Jeden rekord = jedna historyczna aukcja.
   */

  await env.REXBID_DB.prepare(`
    CREATE TABLE IF NOT EXISTS auction_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      vehicle_key TEXT NOT NULL,

      platform TEXT,
      lot TEXT,

      auction_date TEXT,

      price REAL,

      status TEXT,

      source_json TEXT,

      captured_at TEXT NOT NULL,

      UNIQUE (
        vehicle_key,
        platform,
        lot,
        auction_date,
        price,
        status
      )
    )
  `).run();


  await env.REXBID_DB.prepare(`
    CREATE TABLE IF NOT EXISTS auction_history_cache (
      vehicle_key TEXT PRIMARY KEY,

      captured_at TEXT NOT NULL,

      records_json TEXT NOT NULL,

      next_cursor TEXT
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
    CREATE INDEX IF NOT EXISTS idx_snapshots_time
    ON vehicle_snapshots(captured_at)
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


/*
 * ============================================================
 * BOOLEAN
 * ============================================================
 */

function boolToDb(
  value
) {
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


/*
 * ============================================================
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

  await ensureDatabase(
    env
  );

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
      .bind(
        vehicle.vehicleKey
      )
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
        loss_type,
        run_condition,

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
        ?, ?, ?,
        ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?,
        ?, ?,
        ?,
        ?, ?, ?, ?
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
        loss_type = excluded.loss_type,
        run_condition = excluded.run_condition,

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
      vehicle.lossType,
      vehicle.runCondition,

      vehicle.mileage,

      vehicle.sellerName,
      vehicle.sellerType,

      vehicle.documentName,
      vehicle.documentType,

      boolToDb(
        vehicle.exportAllowed
      ),

      boolToDb(
        vehicle.registrationAllowed
      ),

      boolToDb(
        vehicle.hasVideo
      ),

      boolToDb(
        vehicle.has360
      ),

      vehicle.auctionUrl,

      firstSeen,
      now,

      vehicle.fingerprint,

      safeJson(
        rawVehicle
      )
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

        safeJson(
          rawVehicle
        )
      )
      .run();
  }

  return {
    saved: true,
    changed
  };
}


/*
 * ============================================================
 * SAVE APiBARA RESULT
 * ============================================================
 */

async function saveApiVehicle(
  env,
  result
) {
  if (
    !result ||
    !Array.isArray(
      result.data
    )
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
      normalizeVehicle(
        vehicle
      );

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
 * ============================================================
 * LOCAL VEHICLE LOOKUP
 * ============================================================
 */

async function findLocalVehicle(
  env,
  identifier
) {
  const value =
    cleanString(
      identifier
    );

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

  return result ||
    null;
}


/*
 * ============================================================
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
        .bind(
          vehicleKey
        )
        .first();

    return result ||
      null;

  } catch {
    return null;
  }
}


/*
 * ============================================================
 * GET CURRENT VEHICLE
 * ============================================================
 */

async function getCar(
  request,
  env,
  identifier
) {
  const encoded =
    encodeURIComponent(
      identifier
    );


  /*
   * 1. DIRECT APiBARA
   */

  try {
    const result =
      await fetchApibara(
        "/vehicles/" +
        encoded,
        env
      );

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
        if (normalized) {
          try {
            await saveVehicle(
              env,
              normalized,
              result.data
            );
          } catch (dbError) {
            console.error(
              "Rex.Bid D1 save error:",
              dbError
            );
          }
        }

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
        "Rex.Bid direct endpoint returned non-matching vehicle:",
        identifier
      );
    }

  } catch (directError) {
    console.warn(
      "Rex.Bid direct vehicle lookup failed:",
      directError.message
    );
  }


  /*
   * 2. FALLBACK SEARCH
   */

  try {
    const searchResult =
      await fetchApibara(
        "/vehicles?" +
        new URLSearchParams({
          s: identifier,
          per_page: "20"
        }).toString(),
        env
      );

    if (
      searchResult &&
      Array.isArray(
        searchResult.data
      ) &&
      searchResult.data.length
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
          normalizeVehicle(
            exact
          );

        if (normalized) {
          try {
            await saveVehicle(
              env,
              normalized,
              exact
            );
          } catch (dbError) {
            console.error(
              "Rex.Bid D1 fallback save error:",
              dbError
            );
          }
        }

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

  } catch (searchError) {
    console.warn(
      "Rex.Bid VIN fallback failed:",
      searchError.message
    );
  }


  /*
   * 3. LOCAL D1
   */

  if (env.REXBID_DB) {
    try {
      await ensureDatabase(
        env
      );

      const local =
        await findLocalVehicle(
          env,
          identifier
        );

      if (local) {
        let localData =
          local;

        if (
          local.raw_json
        ) {
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
          normalizeIdentifier(
            local.vin
          ) ===
            normalizeIdentifier(
              identifier
            ) ||
          normalizeIdentifier(
            local.lot
          ) ===
            normalizeIdentifier(
              identifier
            ) ||
          normalizeIdentifier(
            local.slug_vin
          ) ===
            normalizeIdentifier(
              identifier
            )
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

    } catch (dbError) {
      console.error(
        "Rex.Bid local vehicle lookup error:",
        dbError
      );
    }
  }


  /*
   * 4. NOT FOUND
   */

  return errorJson(
    `Nie znaleziono dokładnego pojazdu ${identifier} w bieżących danych aukcyjnych ani w bazie Rex.Bid.`,
    404
  );
}


/*
 * ============================================================
 * AUCTION HISTORY
 * ============================================================
 *
 * Apibara:
 *
 * data.vehicle
 * data.history[]
 *
 * Każdy rekord może zawierać:
 * platform
 * date
 * price
 * status
 *
 * Obsługujemy również warianty nazw pól,
 * żeby nie uzależniać frontendu od jednej wersji API.
 */

function normalizeAuctionHistoryRecord(
  record,
  fallbackPlatform = "",
  fallbackLot = ""
) {
  if (
    !record ||
    typeof record !== "object"
  ) {
    return null;
  }

  const platform =
    cleanString(
      firstValue(
        record,
        [
          "platform",
          "source",
          "auction"
        ]
      )
    ).toLowerCase() ||
    fallbackPlatform;


  const lot =
    cleanString(
      firstValue(
        record,
        [
          "lot",
          "lot_number",
          "lotNumber",
          "stock",
          "stock_number"
        ]
      )
    ) ||
    fallbackLot;


  const auctionDate =
    firstValue(
      record,
      [
        "date",
        "auction_date",
        "auctionDate",
        "sale_date",
        "saleDate",
        "sold_at",
        "soldAt",
        "auction_at",
        "auctionAt"
      ]
    );


  /*
   * Apibara dokumentuje pole "price"
   * jako cenę historycznego rekordu.
   *
   * Nie używamy current_bid tutaj,
   * ponieważ aktualna oferta nie jest
   * ceną zakończenia poprzedniej aukcji.
   */

  const price =
    numberOrNull(
      firstValue(
        record,
        [
          "price",
          "sale_price",
          "salePrice",
          "sold_price",
          "soldPrice",
          "final_price",
          "finalPrice"
        ]
      )
    );


  const status =
    cleanString(
      firstValue(
        record,
        [
          "status",
          "sale_status",
          "saleStatus",
          "auction_status",
          "auctionStatus"
        ]
      )
    );


  if (
    !auctionDate &&
    price === null &&
    !status &&
    !platform &&
    !lot
  ) {
    return null;
  }

  return {
    platform,
    lot,
    auction_date:
      auctionDate || null,
    price,
    status,
    source:
      record
  };
}


/*
 * ============================================================
 * EXTRACT HISTORY FROM APiBARA
 * ============================================================
 */

function extractApibaraHistory(
  result
) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    return {
      vehicle: null,
      records: [],
      meta: null
    };
  }

  /*
   * Oficjalna struktura:
   *
   * data:
   * {
   *   vehicle: {...},
   *   history: [...]
   * }
   */

  const data =
    result.data &&
    typeof result.data === "object"
      ? result.data
      : {};


  const vehicle =
    data.vehicle &&
    typeof data.vehicle === "object"
      ? data.vehicle
      : null;


  const rawHistory =
    Array.isArray(
      data.history
    )
      ? data.history
      : Array.isArray(
          result.history
        )
        ? result.history
        : Array.isArray(
            result.data
          )
          ? result.data
          : [];


  const fallbackPlatform =
    cleanString(
      vehicle?.platform
    ).toLowerCase();


  const fallbackLot =
    cleanString(
      vehicle?.lot_number ||
      vehicle?.lot
    );


  const records = [];


  for (
    const item of rawHistory
  ) {
    const normalized =
      normalizeAuctionHistoryRecord(
        item,
        fallbackPlatform,
        fallbackLot
      );

    if (normalized) {
      records.push(
        normalized
      );
    }
  }


  const meta =
    result.meta ||
    data.meta ||
    null;


  return {
    vehicle,
    records,
    meta
  };
}


/*
 * ============================================================
 * HISTORY DEDUPLICATION
 * ============================================================
 */

function historyRecordKey(
  record
) {
  return [
    cleanString(
      record.platform
    ).toLowerCase(),

    cleanString(
      record.lot
    ),

    cleanString(
      record.auction_date
    ),

    record.price === null ||
    record.price === undefined
      ? ""
      : String(record.price),

    cleanString(
      record.status
    ).toLowerCase()
  ].join("|");
}


function deduplicateHistory(
  records
) {
  const map =
    new Map();

  for (
    const record of records
  ) {
    const key =
      historyRecordKey(
        record
      );

    if (!map.has(key)) {
      map.set(
        key,
        record
      );
    }
  }

  return Array.from(
    map.values()
  );
}


/*
 * ============================================================
 * SORT HISTORY
 * ============================================================
 */

function sortAuctionHistory(
  records
) {
  return [
    ...records
  ].sort(
    (a, b) => {

      const aTime =
        a.auction_date
          ? Date.parse(
              a.auction_date
            )
          : 0;

      const bTime =
        b.auction_date
          ? Date.parse(
              b.auction_date
            )
          : 0;

      /*
       * Najnowsze pierwsze.
       */

      return bTime - aTime;
    }
  );
}


/*
 * ============================================================
 * SAVE REAL AUCTION HISTORY
 * ============================================================
 */

async function saveAuctionHistory(
  env,
  vehicleKey,
  records
) {
  if (
    !env.REXBID_DB ||
    !vehicleKey
  ) {
    return;
  }

  await ensureDatabase(
    env
  );

  const now =
    new Date().toISOString();


  for (
    const record of records
  ) {
    await env.REXBID_DB
      .prepare(`
        INSERT OR IGNORE INTO auction_history (
          vehicle_key,
          platform,
          lot,
          auction_date,
          price,
          status,
          source_json,
          captured_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)
      .bind(

        vehicleKey,

        record.platform ||
          null,

        record.lot ||
          null,

        record.auction_date ||
          null,

        record.price === null ||
        record.price === undefined
          ? null
          : record.price,

        record.status ||
          null,

        safeJson(
          record.source
        ),

        now
      )
      .run();
  }
}


/*
 * ============================================================
 * READ LOCAL AUCTION HISTORY
 * ============================================================
 */

async function getLocalAuctionHistory(
  env,
  vehicleKey
) {
  if (
    !env.REXBID_DB ||
    !vehicleKey
  ) {
    return [];
  }

  const rows =
    await env.REXBID_DB
      .prepare(`
        SELECT
          id,
          vehicle_key,
          platform,
          lot,
          auction_date,
          price,
          status,
          source_json,
          captured_at
        FROM auction_history
        WHERE vehicle_key = ?
        ORDER BY
          auction_date DESC,
          id DESC
      `)
      .bind(
        vehicleKey
      )
      .all();

  return (
    rows.results ||
    []
  );
}


/*
 * ============================================================
 * HISTORY CACHE
 * ============================================================
 *
 * 30 minut.
 *
 * Nie odpytujemy Apibary przy każdym
 * wejściu / odświeżeniu strony.
 */

const HISTORY_CACHE_TTL_MS =
  30 * 60 * 1000;


async function getHistoryCache(
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
    const row =
      await env.REXBID_DB
        .prepare(`
          SELECT
            vehicle_key,
            captured_at,
            records_json,
            next_cursor
          FROM auction_history_cache
          WHERE vehicle_key = ?
          LIMIT 1
        `)
        .bind(
          vehicleKey
        )
        .first();

    if (!row) {
      return null;
    }

    const captured =
      Date.parse(
        row.captured_at
      );

    if (
      !Number.isFinite(
        captured
      )
    ) {
      return null;
    }

    const age =
      Date.now() -
      captured;

    if (
      age >
      HISTORY_CACHE_TTL_MS
    ) {
      return null;
    }

    let records = [];

    try {
      records =
        JSON.parse(
          row.records_json ||
          "[]"
        );
    } catch {
      records = [];
    }

    return {
      records:
        Array.isArray(records)
          ? records
          : [],

      captured_at:
        row.captured_at,

      next_cursor:
        row.next_cursor ||
        null
    };

  } catch (error) {
    console.warn(
      "Rex.Bid history cache read error:",
      error.message
    );

    return null;
  }
}


/*
 * ============================================================
 * SAVE HISTORY CACHE
 * ============================================================
 */

async function saveHistoryCache(
  env,
  vehicleKey,
  records,
  nextCursor = null
) {
  if (
    !env.REXBID_DB ||
    !vehicleKey
  ) {
    return;
  }

  const now =
    new Date().toISOString();

  await env.REXBID_DB
    .prepare(`
      INSERT INTO auction_history_cache (
        vehicle_key,
        captured_at,
        records_json,
        next_cursor
      )
      VALUES (?, ?, ?, ?)

      ON CONFLICT(vehicle_key)
      DO UPDATE SET

        captured_at =
          excluded.captured_at,

        records_json =
          excluded.records_json,

        next_cursor =
          excluded.next_cursor
    `)
    .bind(

      vehicleKey,

      now,

      safeJson(
        records
      ),

      nextCursor ||
        null
    )
    .run();
}


/*
 * ============================================================
 * FETCH COMPLETE APiBARA HISTORY
 * ============================================================
 *
 * Maksymalnie 20 rekordów na stronę.
 *
 * Pobieramy kolejne strony przez
 * meta.next_cursor.
 */

async function fetchCompleteAuctionHistory(
  env,
  identifier
) {
  const allRecords =
    [];

  let cursor =
    null;

  let page =
    0;

  const MAX_HISTORY_PAGES =
    20;


  while (
    page <
    MAX_HISTORY_PAGES
  ) {
    page++;


    const params =
      new URLSearchParams();

    params.set(
      "per_page",
      "20"
    );

    if (cursor) {
      params.set(
        "cursor",
        cursor
      );
    }


    const encoded =
      encodeURIComponent(
        identifier
      );


    const result =
      await fetchApibara(
        "/vehicles/" +
        encoded +
        "/history?" +
        params.toString(),
        env
      );


    const extracted =
      extractApibaraHistory(
        result
      );


    allRecords.push(
      ...extracted.records
    );


    const nextCursor =
      extracted.meta?.next_cursor ||
      extracted.meta?.nextCursor ||
      null;


    if (
      !nextCursor ||
      nextCursor === cursor
    ) {
      return {
        vehicle:
          extracted.vehicle,

        records:
          deduplicateHistory(
            allRecords
          ),

        meta:
          extracted.meta ||
          null,

        pages:
          page
      };
    }


    cursor =
      nextCursor;
  }


  /*
   * Zabezpieczenie przed nieskończoną
   * paginacją przy błędnych danych API.
   */

  return {
    vehicle: null,

    records:
      deduplicateHistory(
        allRecords
      ),

    meta: {
      warning:
        "Osiągnięto maksymalną liczbę stron historii."
    },

    pages:
      page
  };
}


/*
 * ============================================================
 * GET HISTORY
 * ============================================================
 */

async function getHistory(
  request,
  env,
  identifier
) {
  if (!env.REXBID_DB) {
    /*
     * Jeżeli D1 nie jest podłączone,
     * pobieramy historię bezpośrednio.
     */

    try {
      const result =
        await fetchCompleteAuctionHistory(
          env,
          identifier
        );

      return json(
        {
          ok: true,

          data: {
            vehicle:
              result.vehicle,

            history:
              sortAuctionHistory(
                result.records
              )
          },

          meta:
            result.meta,

          rex_history: {
            count:
              result.records.length,

            records:
              sortAuctionHistory(
                result.records
              )
          },

          source:
            "apibara",

          pages:
            result.pages
        },
        200,
        "HISTORY-LIVE",
        300
      );

    } catch (error) {
      return errorJson(
        error.message
      );
    }
  }


  await ensureDatabase(
    env
  );


  /*
   * Najpierw próbujemy znaleźć pojazd
   * w naszej bazie.
   */

  let localVehicle =
    null;

  try {
    localVehicle =
      await findLocalVehicle(
        env,
        identifier
      );
  } catch (error) {
    console.warn(
      "Rex.Bid history local vehicle lookup error:",
      error.message
    );
  }


  /*
   * Jeżeli nie ma pojazdu w D1,
   * rozwiążemy go przez Apibara.
   */

  if (!localVehicle) {
    try {
      const carResult =
        await fetchApibara(
          "/vehicles/" +
          encodeURIComponent(
            identifier
          ),
          env
        );

      if (
        carResult &&
        carResult.data &&
        vehicleMatchesIdentifier(
          carResult.data,
          identifier
        )
      ) {
        const normalized =
          normalizeVehicle(
            carResult.data
          );

        if (normalized) {
          await saveVehicle(
            env,
            normalized,
            carResult.data
          );

          localVehicle =
            await findLocalVehicle(
              env,
              identifier
            );
        }
      }

    } catch (error) {
      console.warn(
        "Rex.Bid history vehicle resolve error:",
        error.message
      );
    }
  }


  const vehicleKey =
    localVehicle?.vehicle_key ||
    (
      localVehicle?.platform &&
      (
        localVehicle?.vin ||
        localVehicle?.slug_vin ||
        localVehicle?.lot
      )
        ? (
            localVehicle.platform +
            ":" +
            (
              localVehicle.vin ||
              localVehicle.slug_vin ||
              localVehicle.lot
            )
          )
        : null
    );


  /*
   * ----------------------------------------------------------
   * 1. CACHE
   * ----------------------------------------------------------
   */

  if (vehicleKey) {
    const cached =
      await getHistoryCache(
        env,
        vehicleKey
      );

    if (cached) {
      const cachedRecords =
        sortAuctionHistory(
          deduplicateHistory(
            cached.records
          )
        );

      return json(
        {
          ok: true,

          data: {
            vehicle:
              localVehicle
                ? {
                    vin:
                      localVehicle.vin,

                    platform:
                      localVehicle.platform,

                    lot_number:
                      localVehicle.lot
                  }
                : null,

            history:
              cachedRecords
          },

          meta: {
            cached:
              true,

            captured_at:
              cached.captured_at
          },

          rex_history: {
            count:
              cachedRecords.length,

            records:
              cachedRecords
          },

          source:
            "rexbid-history-cache"
        },
        200,
        "HISTORY-CACHE",
        300
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * 2. APiBARA — PEŁNA HISTORIA
   * ----------------------------------------------------------
   */

  let result;

  try {
    result =
      await fetchCompleteAuctionHistory(
        env,
        identifier
      );

  } catch (error) {
    /*
     * Apibara chwilowo niedostępna.
     * Jeżeli mamy starą historię w D1,
     * lepiej pokazać ją niż pustą stronę.
     */

    if (vehicleKey) {
      try {
        const oldRecords =
          await getLocalAuctionHistory(
            env,
            vehicleKey
          );

        if (
          oldRecords.length
        ) {
          return json(
            {
              ok: true,

              data: {
                vehicle:
                  localVehicle
                    ? {
                        vin:
                          localVehicle.vin,

                        platform:
                          localVehicle.platform,

                        lot_number:
                          localVehicle.lot
                      }
                    : null,

                history:
                  oldRecords
              },

              meta: {
                stale:
                  true,

                error:
                  error.message
              },

              rex_history: {
                count:
                  oldRecords.length,

                records:
                  oldRecords
              },

              source:
                "rexbid-history-stale"
            },
            200,
            "HISTORY-D1",
            300
          );
        }

      } catch {
        /*
         * Nic więcej nie robimy.
         */
      }
    }

    throw error;
  }


  const finalRecords =
    sortAuctionHistory(
      deduplicateHistory(
        result.records
      )
    );


  /*
   * ----------------------------------------------------------
   * 3. ZAPIS DO D1
   * ----------------------------------------------------------
   */

  if (vehicleKey) {
    try {
      await saveAuctionHistory(
        env,
        vehicleKey,
        finalRecords
      );

      await saveHistoryCache(
        env,
        vehicleKey,
        finalRecords,
        null
      );

    } catch (dbError) {
      console.error(
        "Rex.Bid auction history D1 save error:",
        dbError
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * 4. ODPOWIEDŹ DLA car.html
   * ----------------------------------------------------------
   */

  return json(
    {
      ok: true,

      data: {
        vehicle:
          result.vehicle ||
          (
            localVehicle
              ? {
                  vin:
                    localVehicle.vin,

                  platform:
                    localVehicle.platform,

                  lot_number:
                    localVehicle.lot
                }
              : null
          ),

        history:
          finalRecords
      },

      meta:
        result.meta ||
        null,

      rex_history: {
        count:
          finalRecords.length,

        records:
          finalRecords
      },

      source:
        "apibara+d1",

      pages:
        result.pages
    },
    200,
    "HISTORY-LIVE",
    300
  );
}


/*
 * ============================================================
 * LISTA SAMOCHODÓW
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
    "model",
    "type",
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
    "color",
    "per_page",
    "cursor",
    "updated_within_minutes"
  ];

  for (
    const name of allowedParams
  ) {
    const value =
      incoming.searchParams.get(
        name
      );

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

  if (
    !params.has("per_page")
  ) {
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
    await cache.match(
      cacheKey
    );

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

  const result =
    await fetchApibara(
      "/vehicles?" +
      params.toString(),
      env
    );


  /*
   * D1
   */

  try {
    await saveApiVehicle(
      env,
      result
    );

  } catch (dbError) {
    console.error(
      "Rex.Bid D1 list save error:",
      dbError
    );
  }


  const response =
    json(
      {
        ok:
          result.ok !== false,

        data:
          Array.isArray(
            result.data
          )
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


/*
 * ============================================================
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
    await ensureDatabase(
      env
    );


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


    const auctionHistory =
      await env.REXBID_DB
        .prepare(`
          SELECT COUNT(*) AS count
          FROM auction_history
        `)
        .first();


    const historyCache =
      await env.REXBID_DB
        .prepare(`
          SELECT COUNT(*) AS count
          FROM auction_history_cache
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
          auctionHistory?.count || 0,

        history_cache:
          historyCache?.count || 0
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


/*
 * ============================================================
 * WORKER
 * ============================================================
 */

export default {

  async fetch(
    request,
    env
  ) {

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
     * Tylko GET
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


    const url =
      new URL(
        request.url
      );


    /*
     * --------------------------------------------------------
     * LISTA
     * --------------------------------------------------------
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
     * --------------------------------------------------------
     * D1 STATUS
     * --------------------------------------------------------
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
     * --------------------------------------------------------
     * HISTORIA
     *
     * MUSI BYĆ PRZED /api/car/
     * --------------------------------------------------------
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
     * --------------------------------------------------------
     * POJEDYNCZY SAMOCHÓD
     * --------------------------------------------------------
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
     * --------------------------------------------------------
     * ASSETS
     * --------------------------------------------------------
     */

    return env.ASSETS.fetch(
      request
    );
  }
};
