"use strict";


function cleanString(value) { return value === null || value === undefined ? "" : String(value); }
function firstValue(obj, keys) { for (const key of keys) { if (obj?.[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key]; } return null; }
function numberOrNull(value) { if (value === null || value === undefined || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function getNested(obj, paths) { for (const path of paths) { let value = obj; for (const key of path) value = value && typeof value === "object" ? value[key] : null; if (value !== null && value !== undefined && value !== "") return value; } return null; }
function simpleHash(value) { let hash = 2166136261; for (let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);} return (hash>>>0).toString(16); }
function historyDate(value) { if(value===null||value===undefined||value==="") return null; if(typeof value==="string"){const raw=value.trim();if(/^\d{4}-\d{2}-\d{2}(?:[Tt ].*)?$/.test(raw))return raw;} return String(value).trim(); }
function historyIdentityPart(value) { return cleanString(value).trim().toUpperCase(); }
function rawJsonValueCount(value) { if(value===null||value===undefined||value==="")return 0;if(Array.isArray(value))return value.reduce((n,x)=>n+rawJsonValueCount(x),0);if(typeof value==="object")return Object.values(value).reduce((n,x)=>n+rawJsonValueCount(x),0);return 1; }

const contract = require("./contract.js");

const BASE = "https://apibara.tech/api/v1/vehicle-auction";
const MAX_PER_PAGE = 20;
const LIST_PARAMS = new Set([
  "s", "platform", "auction_type", "lot_status", "lot_sub_status", "upcoming", "make", "series", "model", "generation_id", "generation", "type", "body_style", "year_from", "year_to", "price_min", "price_max", "odometer_from", "odometer_to", "fuel_type", "transmission", "drive_type", "run_cond", "damage", "color", "engine_size_from", "engine_size_to", "engine_type", "cylinders", "has_key", "sale_document_pending", "sale_document_type", "seller_type", "zip", "radius", "units", "facility_id", "loc_state", "office_name", "auction_date_from", "auction_date_to", "today_only", "has_shipping_price", "include_total", "per_page", "cursor", "updated_within_minutes"
]);

class ProviderError extends Error {
  constructor(provider, code, status = null, retryAfter = null) {
    const messages = {
      CONFIGURATION: "Usługa danych pojazdów jest niedostępna.", INVALID_REQUEST: "Nieprawidłowe parametry zapytania.",
      TIMEOUT: "Usługa danych pojazdów nie odpowiedziała na czas.", RATE_LIMITED: "Usługa danych pojazdów chwilowo ogranicza zapytania.",
      NOT_FOUND: "Nie znaleziono danych pojazdu.", AUTH: "Usługa danych pojazdów jest niedostępna.",
      UPSTREAM: "Usługa danych pojazdów zwróciła błąd.", INVALID_RESPONSE: "Usługa danych pojazdów zwróciła nieprawidłową odpowiedź."
    };
    super(messages[code] || "Nie udało się pobrać danych pojazdu.");
    this.name = "ProviderError";
    this.provider = provider;
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function boundedPage(value, fallback = 20) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new ProviderError("apibara", "INVALID_REQUEST", 400);
  return Math.min(MAX_PER_PAGE, Math.max(1, Number(value)));
}

function buildRequestUrl(spec) {
  if (!spec || typeof spec !== "object") throw new ProviderError("apibara", "INVALID_REQUEST", 400);
  const params = new URLSearchParams();
  let pathname;
  const identifier = String(spec.identifier ?? "");
  switch (spec.operation) {
    case "vehicleByIdentifier":
      if (!identifier || /^[a-z][a-z0-9+.-]*:\/\//i.test(identifier) || /[\u0000-\u001f]/.test(identifier)) throw new ProviderError("apibara", "INVALID_REQUEST", 400);
      pathname = `/vehicles/${encodeURIComponent(identifier)}`; break;
    case "searchVehicles":
      if (!String(spec.search ?? "").trim()) throw new ProviderError("apibara", "INVALID_REQUEST", 400);
      pathname = "/vehicles"; params.set("s", String(spec.search).trim()); params.set("per_page", String(boundedPage(spec.per_page))); break;
    case "listVehicles":
      pathname = "/vehicles";
      for (const [key, value] of Object.entries(spec.params || {})) {
        if (LIST_PARAMS.has(key) && value !== null && value !== undefined && value !== "") params.set(key, key === "per_page" ? String(boundedPage(value)) : String(value));
      }
      if (!params.has("per_page")) params.set("per_page", "20");
      break;
    case "vehicleFilters":
      pathname = "/vehicles/filters";
      for (const key of ["make", "series", "model"]) if (spec.params?.[key] != null && String(spec.params[key]).trim()) params.set(key, String(spec.params[key]).trim().slice(0, 120));
      break;
    case "vehicleHistory":
      if (!identifier || /^[a-z][a-z0-9+.-]*:\/\//i.test(identifier) || /[\u0000-\u001f]/.test(identifier)) throw new ProviderError("apibara", "INVALID_REQUEST", 400);
      pathname = `/vehicles/${encodeURIComponent(identifier)}/history`; params.set("per_page", String(boundedPage(spec.per_page)));
      if (spec.cursor !== null && spec.cursor !== undefined && spec.cursor !== "") params.set("cursor", String(spec.cursor));
      break;
    default: throw new ProviderError("apibara", "INVALID_REQUEST", 400);
  }
  const base = new URL(`${BASE}/`);
  const url = new URL(pathname.replace(/^\/+/, ""), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new ProviderError("apibara", "INVALID_REQUEST", 400);
  url.search = params.toString();
  return url;
}

function safeText(value, key) {
  if (value == null) return null;
  return String(value).split(String(key || "\u0000")).join("[REDACTED]").replace(/(x-api-key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]").slice(0, 500);
}

function createApibaraProvider(options = {}) {
  const fetchImpl = options.fetch || ((...args) => fetch(...args));
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const logger = options.console || console;
  const timeoutMs = options.timeoutMs || 10000;

  async function request(env, spec) {
    const key = env?.APIBARA_API_KEY;
    if (!key) throw new ProviderError("apibara", "CONFIGURATION", 500);
    let url;
    try { url = buildRequestUrl(spec); }
    catch (error) {
      logger.error("Provider request diagnostic", JSON.stringify({ provider: "apibara", operation: spec?.operation || null, stage: "URL", errorName: safeText(error?.name, key), errorMessage: safeText(error?.message, key), causeType: typeof error?.cause, cause: null }));
      throw error;
    }
    const controller = new AbortController();
    const timer = setTimer(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), { method: "GET", redirect: "manual", headers: { Accept: "application/json", "X-API-Key": key }, signal: controller.signal });
      if (!response.ok) {
        const code = response.status === 404 ? "NOT_FOUND" : response.status === 401 || response.status === 403 ? "AUTH" : response.status === 429 ? "RATE_LIMITED" : "UPSTREAM";
        const rawRetry = response.headers.get("Retry-After");
        const retryAfter = rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry) : null;
        logger.warn("Provider HTTP response error", JSON.stringify({ provider: "apibara", operation: spec.operation, status: response.status, code, contentType: response.headers.get("Content-Type") || null }));
        try { await response.body?.cancel(); } catch {}
        throw new ProviderError("apibara", code, response.status, retryAfter);
      }
      try { return await response.json(); } catch { throw new ProviderError("apibara", "INVALID_RESPONSE", response.status); }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const cause = error?.cause;
      logger.error("Provider transport diagnostic", JSON.stringify({ provider: "apibara", operation: spec.operation, stage: "fetch", errorName: safeText(error?.name, key), errorMessage: safeText(error?.message, key), causeType: typeof cause, cause: cause && typeof cause === "object" ? { name: safeText(cause.name, key), code: safeText(cause.code, key), errno: safeText(cause.errno, key), syscall: safeText(cause.syscall, key) } : safeText(cause, key) }));
      if (controller.signal.aborted || error?.name === "AbortError") throw new ProviderError("apibara", "TIMEOUT", 504);
      throw new ProviderError("apibara", "UPSTREAM");
    } finally { clearTimer(timer); }
  }

function normalizeApibaraVehicle(vehicle) {
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


  const runConditionValue = firstValue(condition, ["run_condition", "runCondition"]);
  const runCondition = cleanString(
    runConditionValue && typeof runConditionValue === "object"
      ? firstValue(runConditionValue, ["value", "label", "name"])
      : runConditionValue
  ) || cleanString(getNested(vehicle, [["details", "vehicle_information", "StartCode"], ["details", "attributes", "RunAndDrive"]]));


  const hasKey =
    firstValue(condition, [
      "has_key",
      "hasKey"
    ]) ?? getNested(vehicle, [["details", "vehicle_information", "KeySlashFob"], ["details", "attributes", "KeyFob"]]);


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


  const sellerNameCandidates = [
    getNested(vehicle, [["details", "attributes", "ProviderName"]]),
    getNested(vehicle, [["details", "attributes", "provider_name"]]),
    getNested(vehicle, [["details", "sale_information", "Seller"]]),
    getNested(vehicle, [["details", "sale_information", "seller"]]),
    getNested(vehicle, [["details", "vehicle_information", "Seller"]]),
    getNested(vehicle, [["sale_information", "Seller", "displayName"], ["sale_information", "Seller", "name"], ["sale_information", "Seller", "seller_name"], ["sale_information", "Seller"], ["details", "sale_information", "Seller", "name"]]),
    ...["displayName", "name", "seller_name", "sellerName", "companyName", "company_name", "providerName", "provider_name", "display"].map(key => seller[key]),
    ...["seller_display_name", "sellerDisplayName", "provider_name", "providerName", "company_name", "companyName"].map(key => vehicle[key])
  ].map(value => typeof value === "string" || typeof value === "number" ? cleanString(value) : "").filter(value => value && !/^(?:[*#•\s]+|unknown(?: seller)?|seller unknown|n\/?a|not available|name unavailable|nazwa niedostępna|brak danych|unavailable|null|none|masked|[-—])$/i.test(value));
  const sellerName = sellerNameCandidates[0] || "";


  const sellerTypeCandidates = [
    vehicle.details?.attributes?.ProviderType,
    vehicle.details?.attributes?.ProviderTypeTimedAuction,
    getNested(vehicle, [["details", "sale_information", "SellerType"]]),
    getNested(vehicle, [["details", "sale_information", "seller_type"]]),
    getNested(vehicle, [["sale_information", "SellerType"]]),
    ...["type", "normalized_type", "seller_type", "sellerType"].map(key => seller[key])
  ].map(cleanString).filter(value => value && !/^(?:unknown|n\/?a|not available|unavailable|null|none|-)$/i.test(value));
  const sellerType = sellerTypeCandidates[0] || "";

  const sellerTypeNormalized = /^(?:ins|insurance)$/i.test(sellerType) ? "insurance"
    : /^(?:nins|non[_ -]?insurance)$/i.test(sellerType) ? "non_insurance" : sellerType;


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
    sellerType: sellerTypeNormalized,
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
    sellerType: sellerTypeNormalized,

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

  function normalizeVehicle(raw) {
  return normalizeApibaraVehicle(raw);
}

  function fingerprintNormalizedVehicle(value) {
    return simpleHash(JSON.stringify({
      platform: value.platform, vin: value.vin, lot: value.lot, auctionState: value.auctionState,
      auctionAt: value.auctionAt, auctionEnd: value.auctionEnd, currentBid: value.currentBid,
      buyNow: value.buyNow, lastSoldPrice: value.lastSoldPrice, locationDisplay: value.locationDisplay,
      damage: value.damage, secondaryDamage: value.secondaryDamage, mileage: value.mileage,
      sellerName: value.sellerName, sellerType: value.sellerType,
      documentName: value.documentName, documentType: value.documentType
    }));
  }

  function toCanonicalVehicle(raw, normalized) {
    const pricing = raw?.pricing || {}, auction = raw?.auction || {};
    return contract.createRexVehicle({
      provider: "apibara", provider_vehicle_id: raw?.source_vehicle_id ?? raw?.vehicle_id ?? raw?.slug_vin ?? raw?.lot_number ?? raw?.vin ?? null,
      platform: normalized.platform, vin: normalized.vin, lot: normalized.lot, title: normalized.title, year: normalized.year,
      make: normalized.make, model: normalized.model, trim: raw?.trim ?? raw?.series ?? null,
      auction: contract.createRexAuction({ state: normalized.auctionState, source_status: auction.formatted ?? normalized.auctionState, auction_at: normalized.auctionAt, timed: auction.is_timed ?? null, timed_end_at: auction.timed_end_at ?? null, source_listing_id: normalized.lot || normalized.slugVin }),
      pricing: contract.createRexPricing({ current_bid: normalized.currentBid, current_bid_secondary: pricing.current_bid2_usd ?? null, buy_now: normalized.buyNow, final_price: normalized.lastSoldPrice, source_price: pricing.price_usd ?? pricing.price ?? null }),
      seller: contract.createRexSeller({ name: normalized.sellerName, type: normalized.sellerType, source: normalized.sellerName ? "apibara" : null }),
      condition: contract.createRexCondition({ primary_damage: normalized.damage, secondary_damage: normalized.secondaryDamage, loss_type: normalized.lossType, run_state: normalized.runCondition, keys_present: normalized.hasKey, airbags: raw?.condition?.airbags ?? null }),
      document: contract.createRexDocument({ name: normalized.documentName, type: normalized.documentType, registration: normalized.registrationAllowed, export: normalized.exportAllowed, pending: raw?.sale_document?.pending ?? null }),
      media: contract.createRexMedia({ items: raw?.media?.items, thumbs: raw?.media?.thumbs, has_video: normalized.hasVideo, has_360: normalized.has360 }),
      location: normalized.locationDisplay || null, odometer: normalized.mileage, source_updated_at: raw?.updated_at ?? null, raw_payload: raw
    });
  }

function normalizeApibaraHistoryRecord(
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
  const sellerCandidates = [
    getNested(record, [["details", "attributes", "ProviderName"]]),
    getNested(record, [["details", "attributes", "provider_name"]]),
    getNested(record, [["details", "sale_information", "Seller"]]),
    getNested(record, [["details", "sale_information", "seller"]]),
    getNested(record, [["details", "vehicle_information", "Seller"]]),
    getNested(record, [["sale_information", "Seller", "displayName"], ["sale_information", "Seller", "name"], ["sale_information", "Seller", "seller_name"], ["sale_information", "Seller"], ["details", "sale_information", "Seller", "name"]]),
    ...["displayName", "name", "companyName", "company_name", "providerName", "provider_name", "display", "provider"].map(key => record.seller && typeof record.seller === "object" ? record.seller[key] : null),
    ...["seller_name", "sellerName", "seller_display_name", "provider_name", "providerName", "company_name", "companyName"].map(key => record[key]),
    typeof record.seller === "string" ? record.seller : null
  ].map(value => typeof value === "string" || typeof value === "number" ? cleanString(value) : "").filter(value => value && !/^(?:[*#•\s]+|unknown(?: seller)?|seller unknown|n\/?a|not available|name unavailable|nazwa niedostępna|brak danych|unavailable|null|none|masked|[-—])$/i.test(value));
  const seller = sellerCandidates[0] || "";
  const sellerTypeRaw = [
    getNested(record, [["details", "attributes", "ProviderType"]]),
    getNested(record, [["details", "attributes", "ProviderTypeTimedAuction"]]),
    getNested(record, [["details", "sale_information", "SellerType"]]),
    getNested(record, [["sale_information", "Seller", "type"]]),
    ...["seller_type", "sellerType"].map(key => record[key]),
    ...["type", "normalized_type", "seller_type", "sellerType"].map(key => record.seller && typeof record.seller === "object" ? record.seller[key] : null)
  ].map(cleanString).find(value => value && !/^(?:unknown|n\/?a|not available|unavailable|null|none|-)$/i.test(value)) || "";
  const sellerType = /^(?:ins|insurance)$/i.test(sellerTypeRaw) ? "insurance"
    : /^(?:nins|non[_ -]?insurance)$/i.test(sellerTypeRaw) ? "non_insurance" : sellerTypeRaw;

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
  const isConditional = /sold\s+on\s+approval|on\s+approval|sale\s+pending\s+approval|pending\s+approval/.test(statusLower);
  const isUnsold = isConditional || /not sold|no sale|unsold|failed/.test(statusLower);

  const auctionDateRaw = firstValue(record, ["auction_date", "auctionDate", "auction_at", "auctionAt", "full_date"])
    || getNested(record, [["auction", "auction_at"], ["auction", "auctionAt"], ["auction", "full_date"], ["vehicle", "auction", "auction_at"]]);
  const saleDateRaw = firstValue(record, ["sale_date", "saleDate", "sold_date", "sold_at", "soldAt", "last_sold_day", "lastSoldDay"])
    || getNested(record, [["auction", "last_sold_day"], ["sale", "date"], ["sale", "sold_at"], ["vehicle", "auction", "last_sold_day"]]);
  const genericDate = firstValue(record, ["date"]);
  // The upstream history schema supplies a single event `date`; it does not
  // label that date as a sale date. Preserve it as the auction/event date and
  // only populate sale_date from an explicitly named sale field.
  const auctionDate = historyDate(auctionDateRaw || genericDate);
  const saleDate = historyDate(saleDateRaw);

  const pricing = record.pricing && typeof record.pricing === "object" ? record.pricing
    : vehicle.pricing && typeof vehicle.pricing === "object" ? vehicle.pricing : {};
  const auction = record.auction && typeof record.auction === "object" ? record.auction
    : vehicle.auction && typeof vehicle.auction === "object" ? vehicle.auction : {};
  const currentBid = numberOrNull(firstValue(pricing, ["current_bid_usd", "current_bid2_usd", "current_bid", "currentBidUsd", "currentBid"])
    ?? firstValue(record, ["current_bid_usd", "current_bid", "currentBidUsd", "currentBid", "bid"])
    ?? firstValue(auction, ["current_bid_usd", "current_bid"]));
  const buyNow = numberOrNull(firstValue(pricing, ["buy_now_usd", "buy_now", "buyNowUsd", "buyNow"])
    ?? firstValue(record, ["buy_now_usd", "buy_now", "buyNowUsd", "buyNow"]));

  // A generic `price` remains source_price. Only explicitly named sale/final
  // fields can populate final_price, and a not-sold status always clears it.
  const explicitFinalPrice = firstValue(pricing, ["sale_price_usd", "last_sold_price_usd", "final_price_usd", "final_bid_usd", "sold_price_usd"])
    ?? firstValue(record, ["sale_price_usd", "sale_price", "final_price_usd", "final_price", "final_bid_usd", "final_bid", "sold_price_usd", "sold_price"]);
  // Apibara's real history event has `{ date, price, status }`. On an event
  // whose source status is exactly Sold, its event-scoped price is the sale
  // amount; on Not Sold / Sold on Approval / unknown records it remains only
  // source_price. Legacy D1 rows use the default path and are never inferred.
  const confirmedEventPrice = vehicleContext.apibaraEvent === true && statusLower === "sold"
    ? firstValue(record, ["price", "price_usd"])
    : null;
  const finalPrice = isUnsold ? null : numberOrNull(explicitFinalPrice ?? confirmedEventPrice);
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
    seller_type: sellerType && !/^(?:unknown|n\/?a|not available|null)$/i.test(sellerType) ? sellerType : null,
    status: status || null,
    raw_json: record
  };
}

  function normalizeHistoryRecord(record, vehicleContext = {}) {
  return normalizeApibaraHistoryRecord(record, { ...vehicleContext, apibaraEvent: vehicleContext.provider === "apibara" || vehicleContext.apibaraEvent === true });
  }

  function toCanonicalHistoryEvent(record, vehicleContext = {}) {
    const normalized = normalizeApibaraHistoryRecord(record, { ...vehicleContext, apibaraEvent: vehicleContext.provider === "apibara" || vehicleContext.apibaraEvent === true });
    if (!normalized) return null;
    return contract.createRexHistoryEvent({
      provider: "apibara", provider_event_id: normalized.source_event_id, event_key: normalized.event_key,
      vin: normalized.vin, platform: normalized.platform, lot: normalized.lot,
      auction_date: normalized.auction_date, sale_date: normalized.sale_date,
      status: normalized.status, source_status: normalized.status,
      pricing: contract.createRexPricing({ current_bid: normalized.current_bid, buy_now: normalized.buy_now,
        final_price: normalized.final_price, source_price: normalized.source_price }),
      seller: contract.createRexSeller({ name: normalized.seller, type: normalized.seller_type, source: normalized.seller ? "apibara" : null }),
      raw_payload: record
    });
  }

  function normalizeFilterMetadata(payload) {
    const source = payload?.response?.data ?? payload?.data ?? payload ?? {};
    return contract.createRexFilterMetadata({ provider: "apibara", values: source, raw_payload: payload });
  }


/* ============================================================
 * HISTORY EVENT HASH
 * ============================================================
 */

  function historyRecords(response) {
    const data = response?.response?.data ?? response?.data;
    if (Array.isArray(data?.history)) return data.history;
    if (Array.isArray(data?.history?.data)) return data.history.data;
    if (Array.isArray(data)) return data;
    return [];
  }

  function vehicleListRecords(response) {
    const data = response?.response?.data ?? response?.data;
    return Array.isArray(data) ? data : Array.isArray(data?.vehicles) ? data.vehicles : [];
  }

  function vehicleDetailRecord(response) {
    const data = response?.response?.data ?? response?.data;
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  }

  function matchesIdentifier(raw, identifier) {
    const normalize = value => String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "");
    const target = normalize(identifier);
    if (!target || !raw || typeof raw !== "object") return false;
    const values = [raw.vin, raw.VIN, raw.slug_vin, raw.slugVin, raw.lot_number, raw.lot,
      raw.stock_number, raw.stock, raw.vehicle?.vin, raw.vehicle?.lot_number, raw.details?.lot_number];
    return values.some(value => value !== null && value !== undefined && normalize(value) === target);
  }

  function publicVehicleRecord(raw) { return raw; }
  function publicVehicleRecords(response) { return vehicleListRecords(response); }
  function publicHistoryData(response) { return response?.response?.data ?? response?.data ?? null; }
  function historyVehicleRecord(response) { return publicHistoryData(response)?.vehicle ?? null; }
  function responseMeta(response) { return response?.response?.meta ?? response?.meta ?? null; }
  function listParams(searchParams) {
    const output = {};
    for (const [key, value] of searchParams.entries()) if (LIST_PARAMS.has(key) && value !== "") output[key] = value;
    return output;
  }
  function filterParams(searchParams) {
    const output = {};
    for (const key of ["make", "series", "model", "generation_id"]) {
      const value = searchParams.get(key);
      if (value && value.trim()) output[key] = value.trim().slice(0, 120);
    }
    return output;
  }
  function responseOk(response) { return response?.ok !== false; }
  function publicFilterData(response) { return normalizeFilterMetadata(response).values; }
  function publicFilterMeta(response) { return responseMeta(response); }

  return Object.freeze({
    id: "apibara", capabilities: Object.freeze(["vehicle.lookup", "vehicle.search", "vehicle.list", "vehicle.history", "vehicle.filters"]),
    request, buildRequestUrl, validatePerPage: boundedPage, normalizeVehicle, fingerprintNormalizedVehicle, toCanonicalVehicle, normalizeHistoryRecord, toCanonicalHistoryEvent, normalizeFilterMetadata, historyRecords, vehicleListRecords,
    vehicleDetailRecord, matchesIdentifier, publicVehicleRecord, publicVehicleRecords,
    publicHistoryData, historyVehicleRecord, responseMeta, listParams, filterParams,
    responseOk, publicFilterData, publicFilterMeta,
    async fetchVehicle(env, identifier) { return request(env, { operation: "vehicleByIdentifier", identifier }); },
    async searchVehicles(env, search, per_page = 20) { return request(env, { operation: "searchVehicles", search, per_page }); },
    async listVehicles(env, params = {}) { return request(env, { operation: "listVehicles", params }); },
    async fetchHistory(env, identifier, { per_page = 20, cursor = null } = {}) {
      const response = await request(env, { operation: "vehicleHistory", identifier, per_page, cursor });
      return { response, records: historyRecords(response), nextCursor: response?.meta?.next_cursor ?? response?.data?.meta?.next_cursor ?? response?.response?.meta?.next_cursor ?? response?.response?.data?.meta?.next_cursor ?? null };
    },
    async fetchFilters(env, params = {}) { return request(env, { operation: "vehicleFilters", params }); }
  });
}

module.exports = { ProviderError, boundedPage, buildRequestUrl, createApibaraProvider, MAX_PER_PAGE };
