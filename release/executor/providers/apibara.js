"use strict";


function cleanString(value) { return value === null || value === undefined ? "" : String(value); }
function firstValue(obj, keys) { for (const key of keys) { if (obj?.[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key]; } return null; }
function numberOrNull(value) { if (value === null || value === undefined || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function booleanOrNull(value) { if (value === true || value === 1 || /^(?:true|1|yes)$/i.test(String(value ?? ""))) return true; if (value === false || value === 0 || /^(?:false|0|no)$/i.test(String(value ?? ""))) return false; return null; }
function textOrNull(value) {
  if (value && typeof value === "object") value = firstValue(value, ["value", "name", "label", "description", "code"]);
  const text = cleanString(value).trim();
  return text || null;
}
function getNested(obj, paths) { for (const path of paths) { let value = obj; for (const key of path) value = value && typeof value === "object" ? value[key] : null; if (value !== null && value !== undefined && value !== "") return value; } return null; }
function simpleHash(value) { let hash = 2166136261; for (let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);} return (hash>>>0).toString(16); }
function historyDate(value) { if(value===null||value===undefined||value==="") return null; if(typeof value==="string"){const raw=value.trim();if(/^\d{4}-\d{2}-\d{2}(?:[Tt ].*)?$/.test(raw))return raw;} return String(value).trim(); }
function historyIdentityPart(value) { return cleanString(value).trim().toUpperCase(); }
function rawJsonValueCount(value) { if(value===null||value===undefined||value==="")return 0;if(Array.isArray(value))return value.reduce((n,x)=>n+rawJsonValueCount(x),0);if(typeof value==="object")return Object.values(value).reduce((n,x)=>n+rawJsonValueCount(x),0);return 1; }

const contract = require("./contract.js");
const { safeMediaReferences } = require("../sync/core.js");

function apibaraPhotoFields(media) {
  const items = Array.isArray(media?.items) ? media.items : [];
  const photos = Array.isArray(media?.photos) ? media.photos : [];
  return { items: safeMediaReferences([...items, ...photos]), thumbs: safeMediaReferences(media?.thumbs, "thumb") };
}

const BASE = "https://apibara.tech/api/v1/vehicle-auction";
const MAX_PER_PAGE = 20;
const MAX_CHANGES_LIMIT = 500;
// The /changes operation documents reserve.changed even though the beta
// VehicleChangeEvent enum currently omits it.
const CHANGE_EVENT_TYPES = new Set([
  "lot.created", "lot.updated", "lot.sold", "lot.not_sold", "lot.removed",
  "auction.rescheduled", "auction.ended", "bid.changed", "buy_now.changed", "reserve.changed"
]);
const TERMINAL_CHANGE_TYPES = new Set(["lot.sold", "lot.not_sold", "lot.removed"]);
const LIST_PARAMS = new Set([
  "s", "platform", "auction_type", "lot_status", "lot_sub_status", "upcoming", "make", "series", "model", "generation_id", "generation", "type", "body_style", "year_from", "year_to", "price_min", "price_max", "odometer_from", "odometer_to", "fuel_type", "transmission", "drive_type", "run_cond", "damage", "color", "engine_size_from", "engine_size_to", "engine_type", "cylinders", "has_key", "sale_document_pending", "sale_document_type", "seller_type", "zip", "radius", "units", "facility_id", "loc_state", "office_name", "auction_date_from", "auction_date_to", "today_only", "has_shipping_price", "include_total", "per_page", "cursor", "updated_within_minutes"
]);

class ProviderError extends Error {
  constructor(provider, code, status = null, retryAfter = null) {
    const messages = {
      CONFIGURATION: "Usługa danych pojazdów jest niedostępna.", INVALID_REQUEST: "Nieprawidłowe parametry zapytania.",
      TIMEOUT: "Usługa danych pojazdów nie odpowiedziała na czas.", RATE_LIMITED: "Usługa danych pojazdów chwilowo ogranicza zapytania.",
      NOT_FOUND: "Nie znaleziono danych pojazdu.", AUTH: "Usługa danych pojazdów jest niedostępna.",
      UPSTREAM: "Usługa danych pojazdów zwróciła błąd.", INVALID_RESPONSE: "Usługa danych pojazdów zwróciła nieprawidłową odpowiedź.",
      CURSOR_EXPIRED: "Punkt synchronizacji wygasł. Wymagana jest ponowna synchronizacja katalogu."
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

function changesInteger(value, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value))) {
    throw new ProviderError("apibara", "INVALID_REQUEST", 400);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ProviderError("apibara", "INVALID_REQUEST", 400);
  }
  return number;
}

function validateChangesAfter(value) { return changesInteger(value, 0, 0); }
function validateChangesLimit(value) { return changesInteger(value, 100, 1, MAX_CHANGES_LIMIT); }

// https://apibara.tech/openapi/v1.json: VehicleChangeEvent/VehicleChangesResponse.
// Events are partial patches, never full vehicles. Persist reconciliation work
// and event IDs transactionally before saving nextCursor. Do not apply an old
// patch over a newer detail response. Gaps and empty advancing batches are valid.
function parseChangesResponse(payload, {after, limit} = {}) {
  const requestedAfter = after === undefined ? undefined : validateChangesAfter(after);
  const requestedLimit = validateChangesLimit(limit);
  const invalid = () => { throw new ProviderError("apibara", "INVALID_RESPONSE", 502); };
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  // Sync Center #4948 serializes an empty patch map as [] for lot.created.
  // Only an empty array is equivalent to no keys; nonempty arrays and null
  // still fail. Explicit null VALUES inside an object remain unchanged.
  const patchMap = value => record(value) || Array.isArray(value) && value.length === 0;
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const text = value => typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f]/.test(value);
  const optionalText = value => value === undefined || value === null || text(value);
  const date = value => text(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  if (!record(payload) || payload.ok !== true || !Array.isArray(payload.data) || !record(payload.meta)) invalid();
  const meta = payload.meta;
  if (!integer(meta.after) || !integer(meta.next_cursor) || meta.next_cursor < meta.after ||
      (requestedAfter !== undefined && meta.after !== requestedAfter) ||
      meta.ordering !== "sequence_asc" || typeof meta.has_more !== "boolean" ||
      !integer(meta.count) || meta.count !== payload.data.length || payload.data.length > requestedLimit ||
      !text(meta.schema_version) || !integer(meta.retention_days) || meta.retention_days < 1 ||
      (meta.has_more && meta.next_cursor === meta.after)) invalid();
  const oldest = meta.oldest_available_sequence ?? null;
  const latest = meta.latest_available_sequence ?? null;
  if ((oldest !== null && !integer(oldest)) || (latest !== null && !integer(latest)) ||
      (oldest !== null && latest !== null && oldest > latest) ||
      (latest !== null && meta.next_cursor > Math.max(meta.after, latest))) invalid();

  let previousSequence = meta.after;
  const eventIds = new Set();
  const events = payload.data.map(event => {
    if (!record(event) || !integer(event.sequence) || event.sequence <= previousSequence ||
        event.sequence > meta.next_cursor || (latest !== null && event.sequence > latest) ||
        !text(event.event_id) || eventIds.has(event.event_id) || !CHANGE_EVENT_TYPES.has(event.event) ||
        typeof event.terminal !== "boolean" || event.terminal !== TERMINAL_CHANGE_TYPES.has(event.event) ||
        !record(event.vehicle) || !["copart", "iaai"].includes(event.vehicle.platform) ||
        !text(event.vehicle.lot_number) || !optionalText(event.vehicle.vin) || !optionalText(event.reason) ||
        !Array.isArray(event.changed_fields) || !event.changed_fields.every(text) ||
        !patchMap(event.before) || !patchMap(event.after) || !date(event.recorded_at) ||
        (event.vehicle_updated_at != null && !date(event.vehicle_updated_at))) invalid();
    previousSequence = event.sequence;
    eventIds.add(event.event_id);
    // Copy the JSON patches without interpreting dotted keys or filling absent
    // fields. Explicit null means a changed value and must be retained.
    let beforePatch, afterPatch;
    try {
      beforePatch = JSON.parse(JSON.stringify(Array.isArray(event.before) ? {} : event.before));
      afterPatch = JSON.parse(JSON.stringify(Array.isArray(event.after) ? {} : event.after));
    } catch { invalid(); }
    return {
      provider: "apibara", sequence: event.sequence, eventId: event.event_id, eventType: event.event,
      platform: event.vehicle.platform, lotNumber: event.vehicle.lot_number, vin: event.vehicle.vin ?? null,
      terminal: event.terminal, terminalOutcome: event.terminal ? event.event.slice(4) : null,
      reason: event.reason ?? null, recordedAt: event.recorded_at, vehicleUpdatedAt: event.vehicle_updated_at ?? null,
      changedFields: [...event.changed_fields], before: beforePatch, after: afterPatch,
      requiresDetail: true
    };
  });
  return {
    events, after: meta.after, nextCursor: meta.next_cursor, hasMore: meta.has_more, count: meta.count,
    schemaVersion: meta.schema_version, retentionDays: meta.retention_days,
    oldestAvailableSequence: oldest, latestAvailableSequence: latest
  };
}

function buildRequestUrl(spec) {
  if (!spec || typeof spec !== "object") throw new ProviderError("apibara", "INVALID_REQUEST", 400);
  const params = new URLSearchParams();
  let pathname;
  const identifier = String(spec.identifier ?? "");
  switch (spec.operation) {
    case 'apiUsage':
      pathname = '/usage'; break;
    case "vehicleChanges":
      pathname = "/changes";
      params.set("after", String(validateChangesAfter(spec.after)));
      params.set("limit", String(validateChangesLimit(spec.limit)));
      break;
    case "vehicleByIdentifier":
      if (!identifier || /^[a-z][a-z0-9+.-]*:\/\//i.test(identifier) || /[\u0000-\u001f]/.test(identifier)) throw new ProviderError("apibara", "INVALID_REQUEST", 400);
      pathname = `/vehicles/${encodeURIComponent(identifier)}`;
      if (spec.include !== undefined) {
        if (!['history', 'history,vin_lots'].includes(spec.include)) throw new ProviderError('apibara', 'INVALID_REQUEST', 400);
        params.set('include', spec.include);
      }
      break;
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

function providerRoute(operation) {
  if (operation === "listVehicles") return "/api/cars";
  if (operation === "searchVehicles") return "/api/cars";
  if (operation === "vehicleFilters") return "/api/filters";
  if (operation === "vehicleHistory") return "/api/car/:identifier/history";
  if (operation === "vehicleByIdentifier") return "/api/car/:identifier";
  if (operation === "vehicleChanges") return "internal/inventory-changes";
  return "unknown";
}

function providerPlatform(spec) {
  const value = String(spec?.platform || spec?.params?.platform || "").toLowerCase();
  return ["copart", "iaai", "manheim", "adesa"].includes(value) ? value : "unknown";
}

function providerErrorCode(error) {
  return ["CONFIGURATION", "AUTH", "RATE_LIMITED", "TIMEOUT", "UPSTREAM", "NOT_FOUND", "INVALID_REQUEST", "INVALID_RESPONSE", "CURSOR_EXPIRED"].includes(error?.code)
    ? error.code : "UPSTREAM";
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
    // Budget reservations may wait on D1. Start the upstream timeout only
    // when the provider fetch is about to begin, otherwise D1 latency can
    // manufacture a false timeout before any network request was sent.
    let timer = null;
    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const started = Date.now();
    const operation = typeof spec.operation === "string" && /^[A-Za-z]{1,40}$/.test(spec.operation) ? spec.operation : "unknown";
    const route = providerRoute(operation);
    const platform = providerPlatform(spec);
    let budgetReservation = null;
    let httpStatus = null;
    let outcome = "error";
    let errorCode = null;
    let upstreamRequest = false;
    const emit = () => {
      try { logger.info?.("Rex.Bid provider request", JSON.stringify({request_id: requestId, provider: "apibara",
        operation, route, platform, upstream_request: upstreamRequest, outcome, status: httpStatus,
        safe_error_code: errorCode, duration_ms: Math.max(0, Date.now() - started)})); } catch {}
    };
    try {
      if (options.requestBudget?.begin) budgetReservation = await options.requestBudget.begin(env, spec);
      else if (typeof options.requestBudget === "function") budgetReservation = await options.requestBudget(env, spec);
      timer = setTimer(() => controller.abort(), timeoutMs);
      upstreamRequest = true;
      const response = await fetchImpl(url.toString(), { method: "GET", redirect: "manual", headers: { Accept: "application/json", "X-API-Key": key }, signal: controller.signal });
      httpStatus = response.status;
      if (!response.ok) {
        const code = response.status === 410 && spec.operation === "vehicleChanges" ? "CURSOR_EXPIRED" : response.status === 404 ? "NOT_FOUND" : response.status === 401 || response.status === 403 ? "AUTH" : response.status === 429 ? "RATE_LIMITED" : "UPSTREAM";
        errorCode = providerErrorCode({code});
        const rawRetry = response.headers.get("Retry-After");
        const retryAfter = rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry) : null;
        logger.warn("Provider HTTP response error", JSON.stringify({ provider: "apibara", operation: spec.operation, status: response.status, code, contentType: response.headers.get("Content-Type") || null }));
        try { await response.body?.cancel(); } catch {}
        throw new ProviderError("apibara", code, response.status, retryAfter);
      }
      try {
        const payload = await response.json();
        // Validate this new operation before reporting success; keep request()
        // returning the original provider envelope like the existing methods.
        if (spec.operation === "vehicleChanges") parseChangesResponse(payload, {after: validateChangesAfter(spec.after), limit: spec.limit});
        outcome = "success";
        return payload;
      } catch {
        errorCode = "INVALID_RESPONSE";
        throw new ProviderError("apibara", "INVALID_RESPONSE", response.status);
      }
    } catch (error) {
      errorCode = errorCode || providerErrorCode(error);
      if (error instanceof ProviderError) throw error;
      if (error?.code === "RATE_LIMITED" || error?.code === "CONFIGURATION") {
        throw new ProviderError("apibara", error.code, error.status || (error.code === "RATE_LIMITED" ? 429 : 503));
      }
      const cause = error?.cause;
      logger.error("Provider transport diagnostic", JSON.stringify({ provider: "apibara", operation: spec.operation, stage: "fetch", errorName: safeText(error?.name, key), errorMessage: safeText(error?.message, key), causeType: typeof cause, cause: cause && typeof cause === "object" ? { name: safeText(cause.name, key), code: safeText(cause.code, key), errno: safeText(cause.errno, key), syscall: safeText(cause.syscall, key) } : safeText(cause, key) }));
      if (controller.signal.aborted || error?.name === "AbortError") throw new ProviderError("apibara", "TIMEOUT", 504);
      throw new ProviderError("apibara", "UPSTREAM");
    } finally {
      if (timer !== null) clearTimer(timer);
      try { await budgetReservation?.finish?.(); } catch {}
      emit();
    }
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
      ]) || firstValue(vehicle, ["auction_state", "auction_status", "status"])
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

  const auctionTimezone = firstValue(auction, ["timezone", "time_zone", "auction_timezone", "auctionTimeZone"]);
  const explicitScheduleStatus = firstValue(auction, ["schedule_status", "scheduleStatus", "date_status", "assignment_status"]);
  const explicitScheduleAssigned = firstValue(auction, ["is_assigned", "assigned", "date_assigned", "auction_assigned"]);
  const scheduleObservedAt = firstValue(auction, ["schedule_updated_at", "status_updated_at"])
    || firstValue(vehicle, ["schedule_updated_at", "auction_updated_at"]);
  const sourceAuctionStatus = firstValue(auction, ["formatted", "source_status", "sourceStatus", "status_label", "lot_status"])
    || firstValue(vehicle, ["auction_status", "status_label", "lot_status"])
    || auctionState;
  const schedule = contract.classifyAuctionSchedule({
    platform,
    state: auctionState,
    source_status: sourceAuctionStatus,
    auction_at: auctionAt,
    schedule_status: explicitScheduleStatus,
    assigned: booleanOrNull(explicitScheduleAssigned),
    timed: booleanOrNull(firstValue(auction, ["is_timed", "timed"])) === true,
    auction_timezone: auctionTimezone,
    timezone: auction.timezone
  });


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

  const vehicleDescription = vehicle.vehicle_description || vehicle.details?.vehicle_description || {};
  const vehicleInformation = vehicle.vehicle_information && typeof vehicle.vehicle_information === "object"
    ? vehicle.vehicle_information : vehicle.details?.vehicle_information && typeof vehicle.details.vehicle_information === "object"
      ? vehicle.details.vehicle_information : {};
  const attributes = vehicle.details?.attributes && typeof vehicle.details.attributes === "object" ? vehicle.details.attributes : {};
  const specs = vehicle.vehicle_specs && typeof vehicle.vehicle_specs === "object" ? vehicle.vehicle_specs : {};
  const exteriorColor = typeof specs.exterior_color === "string" && specs.exterior_color.trim().length <= 80
    && !/^(?:unknown|not available|n\/a|-+)$/i.test(specs.exterior_color.trim()) ? specs.exterior_color.trim() || null : null;
  const bodyStyle = firstValue(specs, ["body_style"]) || firstValue(vehicle, ["body_style", "bodyStyle", "vehicle_type"])
    || firstValue(vehicleInformation, ["BodyStyle", "BodyStyleName", "VehicleClass"])
    || firstValue(attributes, ["BodyStyle", "BodyStyleName", "VehicleClass"])
    || firstValue(vehicleDescription, ["BodyStyle", "BodyStyleName", "VehicleClass", "Vehicle"]);
  const fuelType = firstValue(specs, ["fuel_type"]) || firstValue(vehicle, ["fuel_type", "fuelType", "fuel", "powertrain"])
    || firstValue(vehicleInformation, ["FuelType", "FuelTypeDesc", "fuel_type", "Powertrain"])
    || firstValue(attributes, ["FuelType", "FuelTypeDesc", "fuel_type", "Powertrain"])
    || firstValue(vehicleDescription, ["FuelType", "FuelTypeDesc", "Powertrain"]);
  const transmission = firstValue(specs, ["transmission"]) || firstValue(vehicle, ["transmission", "transmission_type"])
    || firstValue(vehicleInformation, ["Transmission", "TransmissionType"])
    || firstValue(attributes, ["Transmission", "TransmissionType"])
    || firstValue(vehicleDescription, ["Transmission", "TransmissionType"]);
  const driveType = firstValue(specs, ["drive_type"]) || firstValue(vehicle, ["drive_type", "driveType", "drivetrain"])
    || firstValue(vehicleInformation, ["DriveLineType", "DriveType", "Drivetrain"])
    || firstValue(attributes, ["DriveLineType", "DriveType", "Drivetrain"])
    || firstValue(vehicleDescription, ["DriveLineType", "DriveType", "Drivetrain"]);
  // Copart can supply only an explicit litre value in engine.raw (e.g. "2.5L 4").
  // Accept a leading unit-qualified capacity, never a cylinder count or a guessed model value.
  const rawEngine = typeof specs.engine?.raw === "string" ? specs.engine.raw.trim() : "";
  const rawLitres = (rawEngine.match(/\d+(?:\.\d+)?\s*L\b/gi) || []).length === 1
    ? /^(\d+(?:\.\d+)?)\s*L(?=\s|$)/i.exec(rawEngine) : null;
  // Prefer explicit normalized values; reject booleans, objects and invalid capacities.
  const engineSizeLitres = [firstValue(vehicle, ["engine_size_l", "engineSizeL", "engine_liters"]),
    specs.engine?.size_l, firstValue(vehicleInformation, ["EngineSizeL", "EngineLiters"]),
    firstValue(attributes, ["EngineSizeL", "EngineLiters"]), rawLitres?.[1]].map(value =>
      (typeof value === "number" || typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()))
      && Number(value) > 0 && Number(value) <= 20 ? Number(value) : null).find(value => value !== null) ?? null;


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
  ];
  const sellerName = sellerNameCandidates.map(contract.normalizeSellerName).find(Boolean) || "";


  const sellerTypeCandidates = [
    vehicle.details?.attributes?.ProviderType,
    vehicle.details?.attributes?.ProviderTypeTimedAuction,
    getNested(vehicle, [["details", "sale_information", "SellerType"]]),
    getNested(vehicle, [["details", "sale_information", "seller_type"]]),
    getNested(vehicle, [["sale_information", "SellerType"]]),
    ...["type", "normalized_type", "seller_type", "sellerType"].map(key => seller[key])
  ];
  const sellerTypeNormalized = contract.resolveSellerType(sellerTypeCandidates) || "";


  /* SALE DOCUMENT */

  const saleDocument =
    vehicle.sale_document &&
    typeof vehicle.sale_document === "object"
      ? vehicle.sale_document
      : {};


  const documentLabels = [saleDocument.source_name, saleDocument.name, saleDocument.raw_name,
    saleDocument.document_name, saleDocument.documentName]
    .filter(value => typeof value === "string" && value.trim() && value.trim().length <= 300
      && !/^(?:unknown|not available|n\/a|-+)$/i.test(value.trim()))
    .map(value => value.trim());
  const documentName = documentLabels.find(label => !/^[A-Z]{1,4}$/.test(label)) || documentLabels[0] || "";


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
    auctionPhase: contract.auctionPhase(auction.phase),
    auctionAt: schedule.auction_at,
    scheduleStatus: schedule.status,
    schedulePrecision: schedule.precision,
    auctionTimezone: schedule.timezone,
    bodyStyle: textOrNull(bodyStyle),
    ...(exteriorColor ? {exteriorColor} : {}),
    fuelType: textOrNull(fuelType),
    transmission: textOrNull(transmission),
    driveType: textOrNull(driveType),
    engineSizeLitres,
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
    bodyStyle: textOrNull(bodyStyle),
    exteriorColor,
    fuelType: textOrNull(fuelType),
    transmission: textOrNull(transmission),
    driveType: textOrNull(driveType),
    engineSizeLitres,

    auctionState,
    auctionPhase: contract.auctionPhase(auction.phase),
    auctionAt: schedule.auction_at,
    scheduleStatus: schedule.status,
    schedulePrecision: schedule.precision,
    auctionTimezone: schedule.timezone,
    scheduleObservedAt: scheduleObservedAt && Number.isFinite(Date.parse(String(scheduleObservedAt))) ? new Date(scheduleObservedAt).toISOString() : null,
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
      platform: value.platform, vin: value.vin, lot: value.lot, auctionState: value.auctionState, auctionPhase: value.auctionPhase,
      auctionAt: value.auctionAt, scheduleStatus: value.scheduleStatus, schedulePrecision: value.schedulePrecision,
      auctionTimezone: value.auctionTimezone, bodyStyle: value.bodyStyle, ...(value.exteriorColor ? {exteriorColor:value.exteriorColor} : {}), fuelType: value.fuelType,
      transmission: value.transmission, driveType: value.driveType, engineSizeLitres: value.engineSizeLitres,
      auctionEnd: value.auctionEnd, currentBid: value.currentBid,
      buyNow: value.buyNow, lastSoldPrice: value.lastSoldPrice, locationDisplay: value.locationDisplay,
      damage: value.damage, secondaryDamage: value.secondaryDamage, mileage: value.mileage,
      sellerName: value.sellerName, sellerType: value.sellerType,
      documentName: value.documentName, documentType: value.documentType
    }));
  }

  function toCanonicalVehicle(raw, normalized) {
    const pricing = raw?.pricing || {}, auction = raw?.auction || {};
    const outcome = /^(finished|ended|closed|sold|not_sold|no_sale)$/i.test(normalized.auctionState || "")
      ? firstValue(auction, ["outcome_status", "last_sold_status"]) : null;
    const unconfirmedSale = /approval|not.?sold|no.?sale|unsold/i.test(String(outcome || ""));
    return contract.createRexVehicle({
      provider: "apibara", provider_vehicle_id: raw?.source_vehicle_id ?? raw?.vehicle_id ?? raw?.slug_vin ?? raw?.lot_number ?? raw?.vin ?? null,
      platform: normalized.platform, vin: normalized.vin, lot: normalized.lot, title: normalized.title, year: normalized.year,
      make: normalized.make, model: normalized.model, trim: textOrNull(raw?.trim ?? raw?.series),
      body_style: normalized.bodyStyle || null, fuel_type: normalized.fuelType || null,
      exterior_color: normalized.exteriorColor || null,
      transmission: normalized.transmission || null, drive_type: normalized.driveType || null,
      engine_size_l: normalized.engineSizeLitres,
    auction: contract.createRexAuction({ state: normalized.auctionState, source_status: outcome || contract.auctionPhase(auction.phase) || firstValue(auction, ["source_status", "sourceStatus", "status_label", "lot_status", "formatted"]) || firstValue(raw, ["auction_status", "status_label", "lot_status"]) || normalized.auctionState, auction_at: normalized.auctionAt, schedule_status: normalized.scheduleStatus, schedule_precision: normalized.schedulePrecision, auction_timezone: normalized.auctionTimezone, timed: auction.is_timed ?? null, timed_end_at: auction.timed_end_at ?? null, source_listing_id: normalized.lot || normalized.slugVin }),
      pricing: contract.createRexPricing({ current_bid: normalized.currentBid, current_bid_secondary: pricing.current_bid2_usd ?? null, buy_now: normalized.buyNow, final_price: unconfirmedSale ? null : normalized.lastSoldPrice, source_price: pricing.price_usd ?? pricing.price ?? (unconfirmedSale ? normalized.lastSoldPrice : null) }),
      seller: contract.createRexSeller({ name: normalized.sellerName, type: normalized.sellerType, source: normalized.sellerName ? "apibara" : null }),
      condition: contract.createRexCondition({ primary_damage: normalized.damage, secondary_damage: normalized.secondaryDamage, loss_type: normalized.lossType, run_state: normalized.runCondition, keys_present: normalized.hasKey, airbags: raw?.condition?.airbags ?? null }),
      document: contract.createRexDocument({ name: normalized.documentName, type: normalized.documentType, registration: normalized.registrationAllowed, export: normalized.exportAllowed, pending: raw?.sale_document?.pending ?? null }),
      media: contract.createRexMedia({ ...apibaraPhotoFields(raw?.media), has_video: normalized.hasVideo, has_360: normalized.has360 }),
      location: raw?.facility && typeof raw.facility === "object" ? {
        display: raw.facility.source_location_name || normalized.locationDisplay || null,
        city: raw.facility.canonical?.city || raw.facility.city || null,
        state: raw.facility.canonical?.state || raw.facility.state || null,
        postal_code: raw.facility.canonical?.zip || raw.facility.zip || null
      } : (raw?.location && typeof raw.location === "object" && (raw.location.state || raw.location.zip || raw.location.postal_code)
        ? {...raw.location, display: normalized.locationDisplay || null} : normalized.locationDisplay || null), odometer: normalized.mileage === null ? null : {value: normalized.mileage, unit: "mi"}, source_updated_at: raw?.updated_at ?? null, raw_payload: raw
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
  ];
  const seller = sellerCandidates.map(contract.normalizeSellerName).find(Boolean) || "";
  const sellerTypeCandidates = [
    getNested(record, [["details", "attributes", "ProviderType"]]),
    getNested(record, [["details", "attributes", "ProviderTypeTimedAuction"]]),
    getNested(record, [["details", "sale_information", "SellerType"]]),
    getNested(record, [["sale_information", "Seller", "type"]]),
    ...["seller_type", "sellerType"].map(key => record[key]),
    ...["type", "normalized_type", "seller_type", "sellerType"].map(key => record.seller && typeof record.seller === "object" ? record.seller[key] : null)
  ];
  const sellerType = contract.resolveSellerType(sellerTypeCandidates) || "";

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

  function publicVehicleRecord(raw) {
    if (!raw || typeof raw !== "object") return raw;
    const normalized = normalizeApibaraVehicle(raw);
    if (!normalized) return raw;
    const auction = raw.auction && typeof raw.auction === "object" ? raw.auction : {};
    const sourceStatus = auction.formatted ?? auction.source_status ?? auction.sourceStatus ?? raw.formatted ?? raw.status;
  const classified = contract.classifyAuctionSchedule({platform: raw.platform, state: auction.state ?? auction.status ?? raw.status,
      source_status: sourceStatus, auction_at: auction.auction_at ?? auction.auctionAt ?? auction.full_date ?? raw.auction_at,
      schedule_status: auction.schedule_status ?? auction.scheduleStatus, assigned: booleanOrNull(auction.is_assigned ?? auction.assigned ?? auction.date_assigned),
      timed: booleanOrNull(auction.is_timed ?? auction.timed) === true,
      auction_timezone: auction.timezone ?? auction.auction_timezone});
    const result = {...raw, auction: {...auction,
      auction_at: classified.auction_at,
      schedule_status: classified.status,
      schedule_precision: classified.precision,
      auction_timezone: classified.timezone
    }};
    if (["unassigned", "unknown", "conflict", "live", "timed", "ended"].includes(classified.status)) {
      result.auction_at = null;
      result.auction_date = null;
      result.auction.full_date = null;
    }
    return result;
  }
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
    id: "apibara", capabilities: Object.freeze(["vehicle.lookup", "vehicle.search", "vehicle.list", "vehicle.history", "vehicle.filters", "vehicle.changes"]),
    parseChangesResponse,
    request, buildRequestUrl, validatePerPage: boundedPage, normalizeVehicle, fingerprintNormalizedVehicle, toCanonicalVehicle, normalizeHistoryRecord, toCanonicalHistoryEvent, normalizeFilterMetadata, historyRecords, vehicleListRecords,
    vehicleDetailRecord, matchesIdentifier, publicVehicleRecord, publicVehicleRecords,
    publicHistoryData, historyVehicleRecord, responseMeta, listParams, filterParams,
    responseOk, publicFilterData, publicFilterMeta,
    async fetchVehicle(env, identifier) { return request(env, { operation: "vehicleByIdentifier", identifier }); },
    async fetchChanges(env, {after = 0, limit = 100, budgetClass = "discovery"} = {}) {
      const response = await request(env, {operation: "vehicleChanges", after, limit, budgetClass});
      return parseChangesResponse(response, {after, limit});
    },
    async searchVehicles(env, search, per_page = 20) { return request(env, { operation: "searchVehicles", search, per_page }); },
    async listVehicles(env, params = {}) {
      const budgetClass = params?._budgetClass;
      const apiParams = {...params};
      delete apiParams._budgetClass;
      return request(env, { operation: "listVehicles", params: apiParams, ...(budgetClass ? {budgetClass} : {}) });
    },
    async fetchHistory(env, identifier, { per_page = 20, cursor = null } = {}) {
      const response = await request(env, { operation: "vehicleHistory", identifier, per_page, cursor });
      return { response, records: historyRecords(response), nextCursor: response?.meta?.next_cursor ?? response?.data?.meta?.next_cursor ?? response?.response?.meta?.next_cursor ?? response?.response?.data?.meta?.next_cursor ?? null };
    },
    async fetchFilters(env, params = {}) { return request(env, { operation: "vehicleFilters", params }); }
  });
}

module.exports = { ProviderError, boundedPage, buildRequestUrl, createApibaraProvider, MAX_PER_PAGE,
  MAX_CHANGES_LIMIT, validateChangesAfter, validateChangesLimit, parseChangesResponse, apibaraPhotoFields };
