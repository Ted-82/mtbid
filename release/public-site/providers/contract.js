"use strict";

const REX_MODEL_VERSION = 1;

function nullableString(value) {
  if (value === null || value === undefined || value === "" || typeof value === "object" || value === "[object Object]") return null;
  return String(value);
}

function createRexVehicle(input = {}) {
  return {
    model_version: REX_MODEL_VERSION,
    provider: nullableString(input.provider),
    provider_vehicle_id: nullableString(input.provider_vehicle_id),
    platform: nullableString(input.platform),
    vin: nullableString(input.vin),
    lot: nullableString(input.lot),
    title: nullableString(input.title),
    year: input.year ?? null,
    make: nullableString(input.make),
    model: nullableString(input.model),
    trim: nullableString(input.trim),
    body_style: nullableString(input.body_style),
    exterior_color: nullableString(input.exterior_color),
    fuel_type: nullableString(input.fuel_type),
    transmission: nullableString(input.transmission),
    drive_type: nullableString(input.drive_type),
    engine_size_l: input.engine_size_l ?? null,
    auction: input.auction || createRexAuction(),
    pricing: input.pricing || createRexPricing(),
    seller: input.seller || createRexSeller(),
    condition: input.condition || createRexCondition(),
    document: input.document || createRexDocument(),
    media: input.media || createRexMedia(),
    location: input.location ?? null,
    odometer: input.odometer ?? null,
    source_updated_at: nullableString(input.source_updated_at),
    raw_payload: input.raw_payload ?? null
  };
}

const AUCTION_PHASES = new Set(['unscheduled','scheduled','awaiting_auction','in_progress','awaiting_result','finished','removed','unknown']);
function auctionPhase(value) { return typeof value === 'string' && AUCTION_PHASES.has(value) ? value : null; }
function createRexAuction(input = {}) {
  return {
    state: nullableString(input.state),
    source_status: nullableString(input.source_status),
    phase: auctionPhase(input.phase) || auctionPhase(input.source_status),
    auction_at: input.auction_at ?? null,
    schedule_status: nullableString(input.schedule_status),
    schedule_precision: nullableString(input.schedule_precision),
    auction_timezone: nullableString(input.auction_timezone),
    timed: input.timed ?? null,
    timed_end_at: input.timed_end_at ?? null,
    source_event_id: nullableString(input.source_event_id),
    source_listing_id: nullableString(input.source_listing_id)
  };
}

function classifyAuctionSchedule(input = {}, {readStoredSessionStart = false} = {}) {
  const platform = nullableString(input.platform)?.toLowerCase() || "";
  const state = nullableString(input.state)?.toLowerCase().trim() || "";
  const sourceStatus = nullableString(input.source_status)?.toLowerCase().trim() || "";
  const explicit = nullableString(input.schedule_status)?.toLowerCase().trim() || "";
  const rawAssigned = input.assigned ?? input.is_assigned ?? input.date_assigned ?? null;
  const assigned = rawAssigned === true || rawAssigned === 1 || /^(?:true|1|yes|assigned)$/i.test(String(rawAssigned ?? ""))
    ? true
    : rawAssigned === false || rawAssigned === 0 || /^(?:false|0|no|unassigned|not assigned)$/i.test(String(rawAssigned ?? ""))
      ? false : null;
  const value = input.auction_at ?? input.full_date ?? input.formatted ?? null;
  const dateText = String(value ?? "").trim();
  const dateOnlyMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateOnly = !!dateOnlyMatch && (() => {
    const [, year, month, day] = dateOnlyMatch;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() + 1 === Number(month) && parsed.getUTCDate() === Number(day);
  })();
  const isoParts = dateText.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i);
  const validIsoCalendar = !!isoParts && (() => {
    const [, year, month, day, hour, minute, second] = isoParts;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    const validDay = parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() + 1 === Number(month) && parsed.getUTCDate() === Number(day);
    return validDay && (hour === undefined || (Number(hour) <= 23 && Number(minute) <= 59 && Number(second || 0) <= 59));
  })();
  const zoneSuffix = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(dateText);
  const sourceTimezone = input.auction_timezone || input.timezone || null;
  const validDate = validIsoCalendar && Number.isFinite(Date.parse(dateText));
  const unassignedPattern = /^(?:upcoming|future|unassigned|not assigned|not scheduled)(?:\s+lot)?$/;
  const explicitlyUnassigned = assigned === false
    || /^(?:unassigned|not assigned|not scheduled|termin nieustalony)$/.test(explicit)
    || /^(?:unassigned|not assigned|not scheduled)$/.test(sourceStatus)
    || /^(?:unassigned|not assigned|not scheduled)$/.test(state);
  const explicitlyConfirmed = /^(?:scheduled|confirmed|date_only|date-only|live|timed|ended)$/.test(explicit);
  const explicitPlatformUnassigned = platform === "copart" && unassignedPattern.test(explicit) && !explicitlyConfirmed;
  const statusSaysUnassigned = unassignedPattern.test(sourceStatus) || unassignedPattern.test(state);
  // Assignment is a schedule fact. It invalidates stale/helper timestamps even
  // when another payload field still contains a future-looking date.
  if (explicit === "conflict") return {status: "conflict", precision: "unknown", auction_at: null, timezone: null};
  if (explicitlyUnassigned) return {status: "unassigned", precision: "unknown", auction_at: null, timezone: null};
  if (/^(?:finished|sold|not[_ -]?sold|no[_ -]?sale|unsold|closed|ended|completed|cancelled|canceled|withdrawn)$/.test(state)
      || /^(?:finished|sold|not[_ -]?sold|no[_ -]?sale|unsold|closed|ended|completed|cancelled|canceled|withdrawn)$/.test(sourceStatus)
      || explicit === "ended") {
    return {status: "ended", precision: "unknown", auction_at: null, timezone: null};
  }
  if (/^(?:live|running|in progress|started)$/.test(state) || /^(?:live|running|in progress|started)$/.test(sourceStatus) || explicit === "live") {
    // On a catalogue read the source phase and the assigned session date are
    // independent. Reuse the ordinary date validation without changing ingestion.
    const storedStart = readStoredSessionStart && input.timed !== true && (dateOnly || (validDate && zoneSuffix))
      && !["unknown","unscheduled","awaiting_result","removed","future sale","auction not assigned"].includes(sourceStatus);
    if (!storedStart) return {status: "live", precision: "unknown", auction_at: null, timezone: null};
  }
  if (input.timed === true || /^(?:timed|timed auction)$/.test(state) || /^(?:timed|timed auction)$/.test(sourceStatus) || explicit === "timed") {
    return {status: "timed", precision: "unknown", auction_at: null, timezone: null};
  }
  if (explicitPlatformUnassigned || (platform === "copart" && statusSaysUnassigned && assigned !== true && !explicitlyConfirmed)) {
    return {status: "unassigned", precision: "unknown", auction_at: null, timezone: null};
  }
  if (explicitlyUnassigned) {
    return {status: "unassigned", precision: "unknown", auction_at: null, timezone: null};
  }
  if ((explicit === "date_only" || explicit === "date-only") && !dateOnly) return {status: "unknown", precision: "unknown", auction_at: null, timezone: null};
  if (explicit === "date_only" || explicit === "date-only" || dateOnly) {
    return {status: "date_only", precision: "date", auction_at: dateText.slice(0, 10), timezone: null};
  }
  if (validDate && zoneSuffix) return {status: "scheduled", precision: "datetime", auction_at: new Date(dateText).toISOString(),
    timezone: sourceTimezone || (/[zZ]$/.test(dateText) ? "UTC" : dateText.match(/([+-]\d{2}:?\d{2})$/)?.[1] || null)};
  if (validDate && sourceTimezone && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(dateText)) {
    const desired = dateText.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/).slice(1);
    const [year, month, day, hour, minute, second = "0", fraction = ""] = desired.map(value => value || "0");
    const expected = [Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second)];
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {timeZone: sourceTimezone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"});
      const localParts = epoch => {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map(part => [part.type, Number(part.value)]));
        return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second];
      };
      const localAsUtc = parts => Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
      const desiredEpoch = Date.UTC(expected[0], expected[1] - 1, expected[2], expected[3], expected[4], expected[5]);
      let candidate = desiredEpoch;
      for (let i = 0; i < 4; i++) candidate = desiredEpoch - (localAsUtc(localParts(candidate)) - candidate);
      const sameWallTime = epoch => localParts(epoch).every((part, index) => part === expected[index]);
      if (!sameWallTime(candidate)) return {status: "unknown", precision: "unknown", auction_at: null, timezone: null};
      const alternatives = [-7_200_000, -3_600_000, 3_600_000, 7_200_000].filter(delta => sameWallTime(candidate + delta));
      if (alternatives.length) return {status: "conflict", precision: "unknown", auction_at: null, timezone: sourceTimezone};
      const millis = Number((fraction + "000").slice(0, 3));
      return {status: "scheduled", precision: "datetime", auction_at: new Date(candidate + millis).toISOString(), timezone: sourceTimezone};
    } catch {
      return {status: "unknown", precision: "unknown", auction_at: null, timezone: null};
    }
  }
  return {status: "unknown", precision: "unknown", auction_at: null, timezone: null};
}

function createRexPricing(input = {}) {
  return {
    currency: nullableString(input.currency) || "USD",
    current_bid: input.current_bid ?? null,
    current_bid_secondary: input.current_bid_secondary ?? null,
    buy_now: input.buy_now ?? null,
    final_price: input.final_price ?? null,
    source_price: input.source_price ?? null
  };
}

// Only explicit source classifications establish insurance/non-insurance.
// Opaque source codes remain available, but cannot override a known class.
function normalizeSellerType(value) {
  if (typeof value !== "string") return null;
  const type = value.trim();
  if (!type || /^(?:unknown|n\/?a|not available|unavailable|null|none|[-—])$/i.test(type)) return null;
  if (/^(?:ins|insurance|insurance company|ubezpieczyciel)$/i.test(type)) return "insurance";
  if (/^(?:nins|non[_ -]?insurance|non[_ -]insurance company)$/i.test(type)) return "non_insurance";
  return type;
}

function resolveSellerType(values = []) {
  const types = values.map(normalizeSellerType).filter(Boolean);
  const classes = [...new Set(types.filter(type => type === "insurance" || type === "non_insurance"))];
  // A conflicting record is unknown, never an arbitrary first-match verdict.
  return classes.length > 1 ? null : classes[0] || types[0] || null;
}

function normalizeSellerName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || /^(?:[*#•\s—–-]+|unknown(?: seller)?|seller unknown|n\/?a|not available|name unavailable|nazwa niedostępna|brak danych|unavailable|null|none|masked)$/i.test(name)) return null;
  if (/^(?:other sellers?|insurance company|non[-_ ]insurance company)\s*\(name not disclosed\)$/i.test(name)
      || /^(?:insurance(?: company)?|non[-_ ]insurance(?: company)?|no insurance)$/i.test(name)
      || /\.(?:jpe?g|png|webp|gif|svg|bmp|avif)(?:[?#].*)?$/i.test(name)
      || /^pick[ -]?ups? (?:are )?by appointment only[.!]?$/i.test(name)) return null;
  return name;
}

function createRexSeller(input = {}) {
  const name = normalizeSellerName(input.name);
  return { name, type: normalizeSellerType(input.type), source: name ? nullableString(input.source) : null };
}

function createRexCondition(input = {}) {
  return {
    primary_damage: nullableString(input.primary_damage),
    secondary_damage: nullableString(input.secondary_damage),
    loss_type: nullableString(input.loss_type),
    run_state: nullableString(input.run_state),
    keys_present: input.keys_present ?? null,
    airbags: nullableString(input.airbags)
  };
}

function createRexDocument(input = {}) {
  return {
    name: nullableString(input.name), type: nullableString(input.type),
    registration: input.registration ?? null, export: input.export ?? null,
    pending: input.pending ?? null
  };
}

function createRexMedia(input = {}) {
  return {
    items: Array.isArray(input.items) ? input.items : [],
    thumbs: Array.isArray(input.thumbs) ? input.thumbs : [],
    has_video: input.has_video ?? null,
    has_360: input.has_360 ?? null
  };
}

function createRexHistoryEvent(input = {}) {
  return {
    model_version: REX_MODEL_VERSION,
    provider: nullableString(input.provider),
    provider_event_id: nullableString(input.provider_event_id),
    event_key: nullableString(input.event_key),
    vin: nullableString(input.vin),
    platform: nullableString(input.platform),
    lot: nullableString(input.lot),
    auction_date: input.auction_date ?? null,
    sale_date: input.sale_date ?? null,
    status: nullableString(input.status),
    source_status: nullableString(input.source_status),
    pricing: input.pricing || createRexPricing(),
    seller: input.seller || createRexSeller(),
    raw_payload: input.raw_payload ?? null
  };
}

function createRexFilterMetadata(input = {}) {
  return { model_version: REX_MODEL_VERSION, values: input.values || {}, provider: nullableString(input.provider), raw_payload: input.raw_payload ?? null };
}

const CONTRACT = Object.freeze({
  version: REX_MODEL_VERSION,
  auctionPhase, createRexVehicle, createRexAuction, classifyAuctionSchedule, createRexPricing, createRexSeller, normalizeSellerName, normalizeSellerType, resolveSellerType,
  createRexCondition, createRexDocument, createRexMedia, createRexHistoryEvent,
  createRexFilterMetadata
});

function validateRexVehicle(vehicle) {
  const errors = [];
  if (!vehicle || typeof vehicle !== "object") return { valid: false, errors: ["vehicle_required"] };
  if (!vehicle.vin && !vehicle.lot && !vehicle.provider_vehicle_id) errors.push("vehicle_identity_required");
  if (!vehicle.auction || !vehicle.pricing || !vehicle.seller || !vehicle.condition || !vehicle.document || !vehicle.media) errors.push("vehicle_sections_required");
  return { valid: errors.length === 0, errors };
}

function validateRexHistoryEvent(event) {
  const errors = [];
  if (!event || typeof event !== "object") return { valid: false, errors: ["event_required"] };
  if (!event.event_key && !event.provider_event_id && !(event.vin || event.lot)) errors.push("event_identity_required");
  if (!event.pricing || !event.seller) errors.push("event_sections_required");
  return { valid: errors.length === 0, errors };
}

const PROVIDER_METHODS = Object.freeze([
  "fetchVehicle", "searchVehicles", "listVehicles", "fetchHistory", "fetchFilters",
  "normalizeVehicle", "toCanonicalVehicle", "normalizeHistoryRecord", "toCanonicalHistoryEvent",
  "normalizeFilterMetadata", "historyRecords", "vehicleListRecords", "vehicleDetailRecord",
  "matchesIdentifier", "publicVehicleRecord", "publicVehicleRecords", "publicHistoryData",
  "historyVehicleRecord", "responseMeta", "responseOk", "listParams", "filterParams",
  "publicFilterData", "publicFilterMeta", "validatePerPage"
]);

function validateProviderAdapter(provider) {
  const errors = [];
  if (!provider || typeof provider.id !== "string" || !provider.id.trim()) errors.push("provider_id_required");
  for (const method of PROVIDER_METHODS) if (typeof provider?.[method] !== "function") errors.push(`provider_method_required:${method}`);
  return { valid: errors.length === 0, errors };
}

function createProviderRegistry(providers = []) {
  const registry = new Map();
  for (const provider of providers) {
    const validation = validateProviderAdapter(provider);
    if (!validation.valid) throw new TypeError(`Invalid provider adapter: ${validation.errors.join(",")}`);
    registry.set(provider.id, provider);
  }
    return Object.freeze({
      get(id) { return registry.get(id) || null; },
    list() { return [...registry.keys()]; },
    register(provider) {
      const validation = validateProviderAdapter(provider);
      if (!validation.valid) throw new TypeError(`Invalid provider adapter: ${validation.errors.join(",")}`);
      registry.set(provider.id, provider);
      return provider;
    }
  });
}

module.exports = { ...CONTRACT, createProviderRegistry, validateProviderAdapter, validateRexVehicle, validateRexHistoryEvent };
