"use strict";

const REX_MODEL_VERSION = 1;

function nullableString(value) {
  if (value === null || value === undefined || value === "") return null;
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

function createRexAuction(input = {}) {
  return {
    state: nullableString(input.state),
    source_status: nullableString(input.source_status),
    auction_at: input.auction_at ?? null,
    timed: input.timed ?? null,
    timed_end_at: input.timed_end_at ?? null,
    source_event_id: nullableString(input.source_event_id),
    source_listing_id: nullableString(input.source_listing_id)
  };
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

function createRexSeller(input = {}) {
  const sourceType = nullableString(input.type);
  const type = /^(?:ins|insurance)$/i.test(sourceType || "") ? "insurance"
    : /^(?:nins|non[_ -]?insurance)$/i.test(sourceType || "") ? "non_insurance" : sourceType;
  return { name: nullableString(input.name), type, source: nullableString(input.source) };
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
  createRexVehicle, createRexAuction, createRexPricing, createRexSeller,
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
