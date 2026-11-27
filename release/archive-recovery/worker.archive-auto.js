var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node-built-in-modules:node:zlib
import libDefault from "node:zlib";
var require_node_zlib = __commonJS({
  "node-built-in-modules:node:zlib"(exports, module) {
    module.exports = libDefault;
  }
});

// src/sync/catalog-media-storage.cjs
var require_catalog_media_storage = __commonJS({
  "src/sync/catalog-media-storage.cjs"(exports, module) {
    "use strict";
    var { gzipSync, gunzipSync } = require_node_zlib();
    var COMPRESSED_HEADER = "rexbid-media-v2:gzip:";
    var MAX_MEDIA_BYTES = 262144;
    var HEADER = "rexbid-media-v1:";
    var PREFIXES = [
      "https://vis.iaai.com/resizer?imageKeys=",
      "https://cs.copart.com/v1/AUTH_svc.pdoc00001/",
      "https://mediaretriever.iaai.com/api/EngineVideoRetriever?",
      "https://vis.iaai.com/Home/ThreeSixtyView?"
    ];
    var MARKER = '"~rb:';
    function packMediaJson(value) {
      if (typeof value === "string" && value.startsWith(COMPRESSED_HEADER)) return value;
      if (typeof value === "string" && (value.startsWith("[") || value.startsWith(HEADER))) {
        const raw = unpackMediaJson(value);
        const bytes = Buffer.from(raw);
        if (bytes.length <= MAX_MEDIA_BYTES) {
          const compressed = COMPRESSED_HEADER + gzipSync(bytes).toString("base64");
          const prior = packPrefixJson(raw);
          return Buffer.byteLength(compressed) < Buffer.byteLength(prior) ? compressed : prior;
        }
      }
      return packPrefixJson(value);
    }
    __name(packMediaJson, "packMediaJson");
    function packPrefixJson(value) {
      if (typeof value !== "string" || !value.startsWith("[") || value.includes(MARKER)) return value;
      let packed = value;
      for (const [index, prefix] of PREFIXES.entries()) {
        packed = packed.replaceAll('"' + prefix, MARKER + index + ":");
      }
      return packed.length + HEADER.length < value.length ? HEADER + packed : value;
    }
    __name(packPrefixJson, "packPrefixJson");
    function unpackMediaJson(value) {
      if (typeof value === "string" && value.startsWith(COMPRESSED_HEADER)) {
        const encoded = value.slice(COMPRESSED_HEADER.length);
        if (encoded.length > MAX_MEDIA_BYTES * 2 || encoded.length % 4 !== 0 || !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw Error("CATALOG_MEDIA_ENCODING");
        const raw = gunzipSync(Buffer.from(encoded, "base64"), { maxOutputLength: MAX_MEDIA_BYTES }).toString("utf8");
        if (!raw.startsWith("[") || !Array.isArray(JSON.parse(raw))) throw Error("CATALOG_MEDIA_ENCODING");
        return raw;
      }
      if (typeof value !== "string" || !value.startsWith(HEADER)) return value;
      let json = value.slice(HEADER.length);
      for (const [index, prefix] of PREFIXES.entries()) {
        json = json.replaceAll(MARKER + index + ":", '"' + prefix);
      }
      return json;
    }
    __name(unpackMediaJson, "unpackMediaJson");
    function packedColumn(column) {
      const quote = /* @__PURE__ */ __name((value) => "'" + value.replaceAll("'", "''") + "'", "quote");
      let packed = column;
      for (const [index, prefix] of PREFIXES.entries()) {
        packed = `replace(${packed},${quote('"' + prefix)},${quote(MARKER + index + ":")})`;
      }
      return `CASE WHEN substr(${column},1,1)='[' AND instr(${column},${quote(MARKER)})=0
    AND length(${packed})+${HEADER.length}<length(${column}) THEN ${quote(HEADER)}||${packed} ELSE ${column} END`;
    }
    __name(packedColumn, "packedColumn");
    module.exports = { packMediaJson, unpackMediaJson, packedColumn };
  }
});

// src/providers/contract.js
var require_contract = __commonJS({
  "src/providers/contract.js"(exports, module) {
    "use strict";
    var REX_MODEL_VERSION = 1;
    function nullableString(value) {
      if (value === null || value === void 0 || value === "" || typeof value === "object" || value === "[object Object]") return null;
      return String(value);
    }
    __name(nullableString, "nullableString");
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
    __name(createRexVehicle, "createRexVehicle");
    var AUCTION_PHASES = /* @__PURE__ */ new Set(["unscheduled", "scheduled", "awaiting_auction", "in_progress", "awaiting_result", "finished", "removed", "unknown"]);
    function auctionPhase(value) {
      return typeof value === "string" && AUCTION_PHASES.has(value) ? value : null;
    }
    __name(auctionPhase, "auctionPhase");
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
    __name(createRexAuction, "createRexAuction");
    function classifyAuctionSchedule(input = {}) {
      const platform = nullableString(input.platform)?.toLowerCase() || "";
      const state2 = nullableString(input.state)?.toLowerCase().trim() || "";
      const sourceStatus = nullableString(input.source_status)?.toLowerCase().trim() || "";
      const explicit = nullableString(input.schedule_status)?.toLowerCase().trim() || "";
      const rawAssigned = input.assigned ?? input.is_assigned ?? input.date_assigned ?? null;
      const assigned = rawAssigned === true || rawAssigned === 1 || /^(?:true|1|yes|assigned)$/i.test(String(rawAssigned ?? "")) ? true : rawAssigned === false || rawAssigned === 0 || /^(?:false|0|no|unassigned|not assigned)$/i.test(String(rawAssigned ?? "")) ? false : null;
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
        return validDay && (hour === void 0 || Number(hour) <= 23 && Number(minute) <= 59 && Number(second || 0) <= 59);
      })();
      const zoneSuffix = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(dateText);
      const sourceTimezone = input.auction_timezone || input.timezone || null;
      const validDate = validIsoCalendar && Number.isFinite(Date.parse(dateText));
      const unassignedPattern = /^(?:upcoming|future|unassigned|not assigned|not scheduled)(?:\s+lot)?$/;
      const explicitlyUnassigned = assigned === false || /^(?:unassigned|not assigned|not scheduled|termin nieustalony)$/.test(explicit) || /^(?:unassigned|not assigned|not scheduled)$/.test(sourceStatus) || /^(?:unassigned|not assigned|not scheduled)$/.test(state2);
      const explicitlyConfirmed = /^(?:scheduled|confirmed|date_only|date-only|live|timed|ended)$/.test(explicit);
      const explicitPlatformUnassigned = platform === "copart" && unassignedPattern.test(explicit) && !explicitlyConfirmed;
      const statusSaysUnassigned = unassignedPattern.test(sourceStatus) || unassignedPattern.test(state2);
      if (explicit === "conflict") return { status: "conflict", precision: "unknown", auction_at: null, timezone: null };
      if (explicitlyUnassigned) return { status: "unassigned", precision: "unknown", auction_at: null, timezone: null };
      if (/^(?:finished|sold|not[_ -]?sold|no[_ -]?sale|unsold|closed|ended|completed|cancelled|canceled|withdrawn)$/.test(state2) || /^(?:finished|sold|not[_ -]?sold|no[_ -]?sale|unsold|closed|ended|completed|cancelled|canceled|withdrawn)$/.test(sourceStatus) || explicit === "ended") {
        return { status: "ended", precision: "unknown", auction_at: null, timezone: null };
      }
      if (/^(?:live|running|in progress|started)$/.test(state2) || /^(?:live|running|in progress|started)$/.test(sourceStatus) || explicit === "live") {
        return { status: "live", precision: "unknown", auction_at: null, timezone: null };
      }
      if (input.timed === true || /^(?:timed|timed auction)$/.test(state2) || /^(?:timed|timed auction)$/.test(sourceStatus) || explicit === "timed") {
        return { status: "timed", precision: "unknown", auction_at: null, timezone: null };
      }
      if (explicitPlatformUnassigned || platform === "copart" && statusSaysUnassigned && assigned !== true && !explicitlyConfirmed) {
        return { status: "unassigned", precision: "unknown", auction_at: null, timezone: null };
      }
      if (explicitlyUnassigned) {
        return { status: "unassigned", precision: "unknown", auction_at: null, timezone: null };
      }
      if ((explicit === "date_only" || explicit === "date-only") && !dateOnly) return { status: "unknown", precision: "unknown", auction_at: null, timezone: null };
      if (explicit === "date_only" || explicit === "date-only" || dateOnly) {
        return { status: "date_only", precision: "date", auction_at: dateText.slice(0, 10), timezone: null };
      }
      if (validDate && zoneSuffix) return {
        status: "scheduled",
        precision: "datetime",
        auction_at: new Date(dateText).toISOString(),
        timezone: sourceTimezone || (/[zZ]$/.test(dateText) ? "UTC" : dateText.match(/([+-]\d{2}:?\d{2})$/)?.[1] || null)
      };
      if (validDate && sourceTimezone && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(dateText)) {
        const desired = dateText.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/).slice(1);
        const [year, month, day, hour, minute, second = "0", fraction = ""] = desired.map((value2) => value2 || "0");
        const expected = [Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second)];
        try {
          const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: sourceTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
          const localParts = /* @__PURE__ */ __name((epoch) => {
            const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map((part) => [part.type, Number(part.value)]));
            return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second];
          }, "localParts");
          const localAsUtc = /* @__PURE__ */ __name((parts) => Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]), "localAsUtc");
          const desiredEpoch = Date.UTC(expected[0], expected[1] - 1, expected[2], expected[3], expected[4], expected[5]);
          let candidate = desiredEpoch;
          for (let i = 0; i < 4; i++) candidate = desiredEpoch - (localAsUtc(localParts(candidate)) - candidate);
          const sameWallTime = /* @__PURE__ */ __name((epoch) => localParts(epoch).every((part, index) => part === expected[index]), "sameWallTime");
          if (!sameWallTime(candidate)) return { status: "unknown", precision: "unknown", auction_at: null, timezone: null };
          const alternatives = [-72e5, -36e5, 36e5, 72e5].filter((delta) => sameWallTime(candidate + delta));
          if (alternatives.length) return { status: "conflict", precision: "unknown", auction_at: null, timezone: sourceTimezone };
          const millis = Number((fraction + "000").slice(0, 3));
          return { status: "scheduled", precision: "datetime", auction_at: new Date(candidate + millis).toISOString(), timezone: sourceTimezone };
        } catch {
          return { status: "unknown", precision: "unknown", auction_at: null, timezone: null };
        }
      }
      return { status: "unknown", precision: "unknown", auction_at: null, timezone: null };
    }
    __name(classifyAuctionSchedule, "classifyAuctionSchedule");
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
    __name(createRexPricing, "createRexPricing");
    function normalizeSellerType(value) {
      if (typeof value !== "string") return null;
      const type = value.trim();
      if (!type || /^(?:unknown|n\/?a|not available|unavailable|null|none|[-—])$/i.test(type)) return null;
      if (/^(?:ins|insurance|insurance company|ubezpieczyciel)$/i.test(type)) return "insurance";
      if (/^(?:nins|non[_ -]?insurance|non[_ -]insurance company)$/i.test(type)) return "non_insurance";
      return type;
    }
    __name(normalizeSellerType, "normalizeSellerType");
    function resolveSellerType(values = []) {
      const types = values.map(normalizeSellerType).filter(Boolean);
      const classes = [...new Set(types.filter((type) => type === "insurance" || type === "non_insurance"))];
      return classes.length > 1 ? null : classes[0] || types[0] || null;
    }
    __name(resolveSellerType, "resolveSellerType");
    function createRexSeller(input = {}) {
      return { name: nullableString(input.name), type: normalizeSellerType(input.type), source: nullableString(input.source) };
    }
    __name(createRexSeller, "createRexSeller");
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
    __name(createRexCondition, "createRexCondition");
    function createRexDocument(input = {}) {
      return {
        name: nullableString(input.name),
        type: nullableString(input.type),
        registration: input.registration ?? null,
        export: input.export ?? null,
        pending: input.pending ?? null
      };
    }
    __name(createRexDocument, "createRexDocument");
    function createRexMedia(input = {}) {
      return {
        items: Array.isArray(input.items) ? input.items : [],
        thumbs: Array.isArray(input.thumbs) ? input.thumbs : [],
        has_video: input.has_video ?? null,
        has_360: input.has_360 ?? null
      };
    }
    __name(createRexMedia, "createRexMedia");
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
    __name(createRexHistoryEvent, "createRexHistoryEvent");
    function createRexFilterMetadata(input = {}) {
      return { model_version: REX_MODEL_VERSION, values: input.values || {}, provider: nullableString(input.provider), raw_payload: input.raw_payload ?? null };
    }
    __name(createRexFilterMetadata, "createRexFilterMetadata");
    var CONTRACT = Object.freeze({
      version: REX_MODEL_VERSION,
      auctionPhase,
      createRexVehicle,
      createRexAuction,
      classifyAuctionSchedule,
      createRexPricing,
      createRexSeller,
      normalizeSellerType,
      resolveSellerType,
      createRexCondition,
      createRexDocument,
      createRexMedia,
      createRexHistoryEvent,
      createRexFilterMetadata
    });
    function validateRexVehicle(vehicle) {
      const errors = [];
      if (!vehicle || typeof vehicle !== "object") return { valid: false, errors: ["vehicle_required"] };
      if (!vehicle.vin && !vehicle.lot && !vehicle.provider_vehicle_id) errors.push("vehicle_identity_required");
      if (!vehicle.auction || !vehicle.pricing || !vehicle.seller || !vehicle.condition || !vehicle.document || !vehicle.media) errors.push("vehicle_sections_required");
      return { valid: errors.length === 0, errors };
    }
    __name(validateRexVehicle, "validateRexVehicle");
    function validateRexHistoryEvent(event) {
      const errors = [];
      if (!event || typeof event !== "object") return { valid: false, errors: ["event_required"] };
      if (!event.event_key && !event.provider_event_id && !(event.vin || event.lot)) errors.push("event_identity_required");
      if (!event.pricing || !event.seller) errors.push("event_sections_required");
      return { valid: errors.length === 0, errors };
    }
    __name(validateRexHistoryEvent, "validateRexHistoryEvent");
    var PROVIDER_METHODS = Object.freeze([
      "fetchVehicle",
      "searchVehicles",
      "listVehicles",
      "fetchHistory",
      "fetchFilters",
      "normalizeVehicle",
      "toCanonicalVehicle",
      "normalizeHistoryRecord",
      "toCanonicalHistoryEvent",
      "normalizeFilterMetadata",
      "historyRecords",
      "vehicleListRecords",
      "vehicleDetailRecord",
      "matchesIdentifier",
      "publicVehicleRecord",
      "publicVehicleRecords",
      "publicHistoryData",
      "historyVehicleRecord",
      "responseMeta",
      "responseOk",
      "listParams",
      "filterParams",
      "publicFilterData",
      "publicFilterMeta",
      "validatePerPage"
    ]);
    function validateProviderAdapter(provider) {
      const errors = [];
      if (!provider || typeof provider.id !== "string" || !provider.id.trim()) errors.push("provider_id_required");
      for (const method of PROVIDER_METHODS) if (typeof provider?.[method] !== "function") errors.push(`provider_method_required:${method}`);
      return { valid: errors.length === 0, errors };
    }
    __name(validateProviderAdapter, "validateProviderAdapter");
    function createProviderRegistry(providers = []) {
      const registry = /* @__PURE__ */ new Map();
      for (const provider of providers) {
        const validation = validateProviderAdapter(provider);
        if (!validation.valid) throw new TypeError(`Invalid provider adapter: ${validation.errors.join(",")}`);
        registry.set(provider.id, provider);
      }
      return Object.freeze({
        get(id) {
          return registry.get(id) || null;
        },
        list() {
          return [...registry.keys()];
        },
        register(provider) {
          const validation = validateProviderAdapter(provider);
          if (!validation.valid) throw new TypeError(`Invalid provider adapter: ${validation.errors.join(",")}`);
          registry.set(provider.id, provider);
          return provider;
        }
      });
    }
    __name(createProviderRegistry, "createProviderRegistry");
    module.exports = { ...CONTRACT, createProviderRegistry, validateProviderAdapter, validateRexVehicle, validateRexHistoryEvent };
  }
});

// src/sync/core.js
var require_core = __commonJS({
  "src/sync/core.js"(exports, module) {
    "use strict";
    var {
      validateRexVehicle,
      validateRexHistoryEvent
    } = require_contract();
    function text(value) {
      if (value === null || value === void 0) return "";
      return String(value).trim();
    }
    __name(text, "text");
    function normalizedPlatform(value) {
      const result = text(value).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(result)) {
        throw new TypeError("Nieprawid\u0142owa platforma canonical.");
      }
      return result;
    }
    __name(normalizedPlatform, "normalizedPlatform");
    function scopedKey(...parts) {
      return parts.map((value) => encodeURIComponent(text(value))).join("|");
    }
    __name(scopedKey, "scopedKey");
    function cursorKey(cursor) {
      return cursor === null || cursor === void 0 ? "<first-page>" : `cursor:${String(cursor)}`;
    }
    __name(cursorKey, "cursorKey");
    function createSyncIdentity(vehicle, options = {}) {
      if (!vehicle || typeof vehicle !== "object") throw new TypeError("Wymagany jest canonical RexVehicle.");
      const provider = text(vehicle.provider).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(provider)) throw new TypeError("Brak prawid\u0142owego providera canonical.");
      const platform = normalizedPlatform(vehicle.platform);
      const providerVehicleId = text(vehicle.provider_vehicle_id);
      const sourceListingId = text(options.sourceListingId ?? vehicle.auction?.source_listing_id);
      const lot = text(vehicle.lot).toUpperCase();
      const vin = text(vehicle.vin).toUpperCase().replace(/[\s-]+/g, "");
      const generation = options.listingGeneration === null || options.listingGeneration === void 0 ? "" : text(options.listingGeneration);
      const observationKey = text(options.observationKey);
      let sourceKey;
      let sourceIdentityKind;
      let sourceIdentityState = "resolved";
      if (providerVehicleId) {
        sourceKey = scopedKey("source", provider, platform, "vehicle", providerVehicleId);
        sourceIdentityKind = "provider_vehicle_id";
      } else if (sourceListingId) {
        sourceKey = scopedKey("source", provider, platform, "listing", sourceListingId);
        sourceIdentityKind = "source_listing_id";
      } else {
        if (!observationKey) throw new TypeError("Niejednoznaczna to\u017Csamo\u015B\u0107 \u017Ar\xF3d\u0142a wymaga observationKey.");
        sourceKey = scopedKey("source-observation", provider, platform, observationKey);
        sourceIdentityKind = "unresolved";
        sourceIdentityState = "ambiguous";
      }
      let listingId;
      let listingIdentityKind;
      let listingIdentityState = "resolved";
      if (sourceListingId) {
        listingId = generation ? scopedKey("listing", provider, platform, "source", sourceListingId, "generation", generation) : scopedKey("listing", provider, platform, "source", sourceListingId);
        listingIdentityKind = "source_listing_id";
      } else if (lot && generation) {
        listingId = scopedKey("listing", provider, platform, "lot", lot, "generation", generation);
        listingIdentityKind = "lot_generation";
      } else {
        if (!observationKey) throw new TypeError("Niejednoznaczny listing wymaga page-scoped observationKey.");
        listingId = scopedKey("listing-observation", provider, platform, observationKey);
        listingIdentityKind = "unresolved";
        listingIdentityState = "ambiguous";
      }
      const confirmedEntityId = text(options.confirmedEntityId);
      const vehicleIdentityState = confirmedEntityId ? "confirmed" : "unresolved";
      return Object.freeze({
        provider,
        platform,
        sourceKey,
        sourceIdentityKind,
        sourceIdentityState,
        entityId: confirmedEntityId || null,
        vehicleIdentityState,
        vehicleCandidateKey: providerVehicleId ? scopedKey("vehicle-candidate", provider, platform, providerVehicleId) : null,
        vinCandidate: vin || null,
        listingId,
        listingIdentityKind,
        listingIdentityState,
        sourceListingId: sourceListingId || null,
        listingGeneration: generation || null,
        lot: lot || null
      });
    }
    __name(createSyncIdentity, "createSyncIdentity");
    function createHistoryEventIdentity(event, listingIdentity, options = {}) {
      if (!event || typeof event !== "object") throw new TypeError("Wymagany jest canonical RexHistoryEvent.");
      if (!listingIdentity || !listingIdentity.provider || !listingIdentity.platform) {
        throw new TypeError("Historia wymaga scope providera/platformy.");
      }
      const eventProvider = text(event.provider).toLowerCase();
      const eventPlatform = event.platform ? normalizedPlatform(event.platform) : "";
      if (eventProvider && eventProvider !== listingIdentity.provider || eventPlatform && eventPlatform !== listingIdentity.platform) {
        throw new TypeError("Event i listing maj\u0105 r\xF3\u017Cne scope providera/platformy.");
      }
      const providerEventId = text(event.provider_event_id);
      const eventKey = text(event.event_key);
      const occurrence = text(options.occurrence);
      const observedKey = text(options.observationKey);
      const date = text(event.auction_date || event.sale_date);
      let identityKind;
      let eventId;
      let identityState = "resolved";
      if (providerEventId) {
        identityKind = "provider_event_id";
        eventId = scopedKey("event", listingIdentity.provider, listingIdentity.platform, listingIdentity.listingId, "source", providerEventId);
      } else if (eventKey) {
        identityKind = "event_key";
        eventId = scopedKey("event", listingIdentity.provider, listingIdentity.platform, listingIdentity.listingId, "key", eventKey);
      } else if (date && occurrence) {
        identityKind = "date_occurrence";
        eventId = scopedKey("event", listingIdentity.provider, listingIdentity.platform, listingIdentity.listingId, "date", date, "occurrence", occurrence);
      } else {
        if (!observedKey) throw new TypeError("Niejednoznaczny event wymaga page-scoped observationKey.");
        identityKind = "unresolved_observation";
        identityState = "ambiguous";
        eventId = scopedKey("event-observation", listingIdentity.provider, listingIdentity.platform, listingIdentity.listingId, observedKey);
      }
      return Object.freeze({ eventId, identityKind, identityState, provider: listingIdentity.provider, platform: listingIdentity.platform, listingId: listingIdentity.listingId });
    }
    __name(createHistoryEventIdentity, "createHistoryEventIdentity");
    function pathValue(object, path) {
      return path.split(".").reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : void 0, object);
    }
    __name(pathValue, "pathValue");
    function setPath(object, path, value) {
      const parts = path.split(".");
      const key = parts.pop();
      const parent = parts.reduce((node, part) => node[part], object);
      parent[key] = value;
    }
    __name(setPath, "setPath");
    function mergeCanonical(previous, patch, options = {}) {
      if (!previous || typeof previous !== "object" || !patch || typeof patch !== "object") {
        throw new TypeError("Scalanie wymaga dw\xF3ch obiekt\xF3w canonical.");
      }
      const clears = new Set(options.explicitClears || []);
      const missingFields = [];
      const nullFields = [];
      const updatedFields = [];
      const clearedFields = [];
      function mergeNode(oldValue, nextValue, path) {
        if (nextValue === void 0) {
          if (path) missingFields.push(path);
          return oldValue;
        }
        if (nextValue === null || typeof nextValue === "string" && !nextValue.trim()) {
          if (path) nullFields.push(path);
          if (path && clears.has(path)) {
            clearedFields.push(path);
            return null;
          }
          return oldValue;
        }
        if (Array.isArray(nextValue)) {
          if (nextValue.length === 0 && Array.isArray(oldValue) && oldValue.length && path && !clears.has(path)) {
            nullFields.push(path);
            return oldValue;
          }
          if (path && clears.has(path) && nextValue.length === 0) clearedFields.push(path);
          else if (path) updatedFields.push(path);
          return structuredClone(nextValue);
        }
        if (nextValue && typeof nextValue === "object") {
          const result = oldValue && typeof oldValue === "object" && !Array.isArray(oldValue) ? structuredClone(oldValue) : {};
          for (const key of /* @__PURE__ */ new Set([...Object.keys(result), ...Object.keys(nextValue)])) {
            const childPath = path ? `${path}.${key}` : key;
            if (Object.hasOwn(nextValue, key)) result[key] = mergeNode(result[key], nextValue[key], childPath);
            else missingFields.push(childPath);
          }
          return result;
        }
        if (path) updatedFields.push(path);
        return nextValue;
      }
      __name(mergeNode, "mergeNode");
      const value = mergeNode(previous, patch, "");
      for (const path of clears) {
        if (!pathValue(patch, path) && pathValue(patch, path) !== null) continue;
        if (pathValue(patch, path) === null) setPath(value, path, null);
      }
      return { value, missingFields: [...new Set(missingFields)], nullFields: [...new Set(nullFields)], updatedFields: [...new Set(updatedFields)], clearedFields: [...new Set(clearedFields)] };
    }
    __name(mergeCanonical, "mergeCanonical");
    function safeMediaReferences(items, kind = "image") {
      if (!Array.isArray(items)) return [];
      const output = [];
      const seen = /* @__PURE__ */ new Set();
      for (const item of items) {
        const candidates = typeof item === "string" ? [item] : item && typeof item === "object" ? kind === "thumb" ? [item.thumb, item.small, item.url, item.src, item.image] : [item.large, item.url, item.src, item.medium, item.image, item.thumb] : [];
        for (const candidate of candidates) {
          if (typeof candidate !== "string" || candidate.length > 2048) continue;
          try {
            const url = new URL(candidate.trim());
            if (url.protocol !== "https:" || !url.hostname || url.username || url.password) continue;
            const normalized = url.toString();
            if (seen.has(normalized)) continue;
            seen.add(normalized);
            output.push(normalized);
            break;
          } catch {
          }
        }
        if (output.length >= 24) break;
      }
      return output;
    }
    __name(safeMediaReferences, "safeMediaReferences");
    function withoutNonPersistentData(value, path = []) {
      if (Array.isArray(value)) return value.map((item) => withoutNonPersistentData(item, path));
      if (!value || typeof value !== "object") return value;
      const result = {};
      for (const [key, child] of Object.entries(value)) {
        const childPath = [...path, key];
        const pathName = childPath.join(".");
        if (["raw_payload", "raw_json", "raw"].includes(pathName)) continue;
        if (pathName === "media.items") {
          result[key] = safeMediaReferences(child, "image");
          continue;
        }
        if (pathName === "media.thumbs") {
          result[key] = safeMediaReferences(child, "thumb");
          continue;
        }
        result[key] = withoutNonPersistentData(child, childPath);
      }
      if (result.media) result.media = {
        ...result.media,
        items: safeMediaReferences(result.media.items, "image"),
        thumbs: safeMediaReferences(result.media.thumbs, "thumb")
      };
      return result;
    }
    __name(withoutNonPersistentData, "withoutNonPersistentData");
    function validTime(value, label) {
      const time = value instanceof Date ? value.getTime() : Number(value);
      if (!Number.isFinite(time)) throw new TypeError(`${label}: nieprawid\u0142owy czas.`);
      return time;
    }
    __name(validTime, "validTime");
    var InMemorySyncRepository = class {
      static {
        __name(this, "InMemorySyncRepository");
      }
      constructor() {
        this.sources = /* @__PURE__ */ new Map();
        this.listings = /* @__PURE__ */ new Map();
        this.events = /* @__PURE__ */ new Map();
        this.scopes = /* @__PURE__ */ new Map();
        this.processedPages = /* @__PURE__ */ new Map();
      }
      getScope(scopeKey) {
        const scope = this.scopes.get(scopeKey);
        return scope ? structuredClone(scope) : null;
      }
      acquireLease(scopeKey, owner, now, ttlMs) {
        if (!text(scopeKey) || !text(owner) || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("Parametry lease s\u0105 nieprawid\u0142owe.");
        const at = validTime(now, "now");
        const scope = this.scopes.get(scopeKey) || { scopeKey, cursor: null, hasStarted: false, status: "idle", lastCompleteAt: null, lastSuccessAt: null, processedCursorKeys: [], seenCursors: [], leaseOwner: null, leaseExpiresAt: null };
        if (scope.leaseOwner && scope.leaseExpiresAt > at && scope.leaseOwner !== owner) return false;
        scope.leaseOwner = owner;
        scope.leaseExpiresAt = at + ttlMs;
        scope.status = "running";
        this.scopes.set(scopeKey, scope);
        return true;
      }
      releaseLease(scopeKey, owner) {
        const scope = this.scopes.get(scopeKey);
        if (!scope || scope.leaseOwner !== owner) return false;
        scope.leaseOwner = null;
        scope.leaseExpiresAt = null;
        this.scopes.set(scopeKey, scope);
        return true;
      }
      failRun(scopeKey, owner, errorCode, now) {
        const at = validTime(now, "now");
        const scope = this.scopes.get(scopeKey);
        if (!scope) throw new Error("SCOPE_NOT_FOUND");
        scope.status = "failed";
        scope.lastAttemptAt = at;
        scope.lastErrorCode = text(errorCode) || "SYNC_FAILED";
        if (scope.leaseOwner === owner) {
          scope.leaseOwner = null;
          scope.leaseExpiresAt = null;
        }
        this.scopes.set(scopeKey, scope);
        return structuredClone(scope);
      }
      completeDiscoveryPage(input) {
        const { scopeKey, cursor = null, nextCursor = null, records = [], now, leaseOwner, crashAt = null } = input || {};
        if (!text(scopeKey) || !Array.isArray(records)) throw new TypeError("Strona discovery jest nieprawid\u0142owa.");
        const at = validTime(now, "now");
        const scope = this.scopes.get(scopeKey) || { scopeKey, cursor: null, hasStarted: false, status: "idle", lastCompleteAt: null, lastSuccessAt: null, processedCursorKeys: [], seenCursors: [], leaseOwner: null, leaseExpiresAt: null };
        if (leaseOwner && scope.leaseOwner !== leaseOwner) throw new Error("LEASE_NOT_OWNED");
        const pageKey = cursorKey(cursor);
        const pageMap = this.processedPages.get(scopeKey) || /* @__PURE__ */ new Map();
        if (pageMap.has(pageKey)) return { replayed: true, inserted: 0, updated: 0, cursor: scope.cursor, complete: scope.status === "complete" };
        const expectedCursor = scope.hasStarted ? scope.cursor : null;
        if (cursor !== expectedCursor) throw new Error("CURSOR_MISMATCH");
        if (nextCursor !== null && nextCursor !== void 0) {
          const next = String(nextCursor);
          if (!next || next === String(cursor ?? "") || scope.seenCursors.includes(next)) throw new Error("REPEATED_CURSOR");
        }
        const prepared = records.map((record) => {
          if (!record || !record.identity || !record.vehicle) throw new TypeError("Wpis strony musi zawiera\u0107 identity i canonical vehicle.");
          const validation = validateRexVehicle(record.vehicle);
          if (!validation.valid) throw new TypeError(`Nieprawid\u0142owy RexVehicle: ${validation.errors.join(",")}`);
          if (!text(record.identity.sourceKey) || !text(record.identity.listingId)) {
            throw new TypeError("Identity musi zawiera\u0107 stabilny sourceKey i listingId.");
          }
          if (record.identity.provider !== text(record.vehicle.provider).toLowerCase() || record.identity.platform !== normalizedPlatform(record.vehicle.platform)) {
            throw new TypeError("Identity nie odpowiada canonical vehicle.");
          }
          return { identity: record.identity, vehicle: withoutNonPersistentData(record.vehicle) };
        });
        let inserted = 0;
        let updated = 0;
        for (const { identity, vehicle } of prepared) {
          const prior = this.listings.get(identity.listingId);
          if (prior) {
            const merged = mergeCanonical(prior.vehicle, vehicle).value;
            this.listings.set(identity.listingId, { identity, vehicle: merged, updatedAt: at });
            updated++;
          } else {
            this.listings.set(identity.listingId, { identity, vehicle, updatedAt: at });
            inserted++;
          }
          this.sources.set(identity.sourceKey, {
            sourceKey: identity.sourceKey,
            provider: identity.provider,
            platform: identity.platform,
            entityId: identity.entityId,
            identityState: identity.sourceIdentityState,
            lastSeenAt: at,
            lastSuccessAt: at
          });
        }
        if (crashAt === "before_checkpoint") throw Object.assign(new Error("SIMULATED_CRASH_BEFORE_CHECKPOINT"), { code: "SIMULATED_CRASH" });
        pageMap.set(pageKey, { nextCursor: nextCursor ?? null, recordCount: prepared.length });
        this.processedPages.set(scopeKey, pageMap);
        scope.hasStarted = true;
        scope.lastPageAt = at;
        scope.lastAttemptAt = at;
        scope.lastErrorCode = null;
        scope.seenCursors = [.../* @__PURE__ */ new Set([...scope.seenCursors, ...cursor === null ? [] : [String(cursor)]])];
        if (nextCursor === null || nextCursor === void 0) {
          scope.cursor = null;
          scope.status = "complete";
          scope.lastCompleteAt = at;
          scope.lastSuccessAt = at;
          scope.leaseOwner = null;
          scope.leaseExpiresAt = null;
        } else {
          scope.cursor = String(nextCursor);
          scope.status = "partial";
        }
        this.scopes.set(scopeKey, scope);
        return { replayed: false, inserted, updated, cursor: scope.cursor, complete: scope.status === "complete" };
      }
      upsertHistoryEvent(identity, event, now) {
        if (!identity?.eventId || !event) throw new TypeError("Identity i event canonical s\u0105 wymagane.");
        const validation = validateRexHistoryEvent(event);
        if (!validation.valid) throw new TypeError(`Nieprawid\u0142owy RexHistoryEvent: ${validation.errors.join(",")}`);
        const at = validTime(now, "now");
        const safeEvent = withoutNonPersistentData(event);
        const previous = this.events.get(identity.eventId);
        const value = previous ? mergeCanonical(previous.event, safeEvent).value : safeEvent;
        this.events.set(identity.eventId, { identity, event: value, updatedAt: at });
        return { inserted: !previous, updated: Boolean(previous), eventId: identity.eventId };
      }
    };
    module.exports = {
      createSyncIdentity,
      createHistoryEventIdentity,
      mergeCanonical,
      safeMediaReferences,
      withoutNonPersistentData,
      InMemorySyncRepository
    };
  }
});

// src/sync/auction-archive-segments.cjs
var require_auction_archive_segments = __commonJS({
  "src/sync/auction-archive-segments.cjs"(exports, module) {
    "use strict";
    var PAGE_SIZE = 256;
    var MAX_SEGMENTS = 2048;
    var MAX_PAGE_BYTES = 1e6;
    var PREFIX = "v2/index/pages/";
    var validInt = /* @__PURE__ */ __name((n) => Number.isSafeInteger(n) && n >= 0, "validInt");
    var hash = /* @__PURE__ */ __name(async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((x) => x.toString(16).padStart(2, "0")).join(""), "hash");
    function positions(value) {
      let a = 2166136261, b = 5381;
      for (const c of value) {
        a = Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0;
        b = (Math.imul(b, 33) ^ c.charCodeAt(0)) >>> 0;
      }
      b |= 1;
      return Array.from({ length: 6 }, (_, i) => (a + Math.imul(i, b) >>> 0) % 8192);
    }
    __name(positions, "positions");
    function bloom(entries) {
      const bytes = new Uint8Array(1024);
      for (const e of entries) for (const key of ["v:" + e.vin, "l:" + e.lot]) for (const bit of positions(key)) bytes[bit >> 3] |= 1 << (bit & 7);
      return btoa(String.fromCharCode(...bytes));
    }
    __name(bloom, "bloom");
    function mayContain(page, q) {
      if (!q) return true;
      const bytes = Uint8Array.from(atob(page.bloom), (c) => c.charCodeAt(0));
      return positions((q.length === 17 ? "v:" : "l:") + q).every((bit) => bytes[bit >> 3] & 1 << (bit & 7));
    }
    __name(mayContain, "mayContain");
    function count(index) {
      return index.entries.length + (index.segments || []).reduce((s, p) => s + p.count, 0);
    }
    __name(count, "count");
    function validateSegments(index) {
      const pages = index.segments || [];
      if (!Array.isArray(pages) || pages.length > MAX_SEGMENTS || new Set(pages.map((p) => p.key)).size !== pages.length) throw Error("archive_segments_invalid");
      for (const p of pages) {
        if (!p || !new RegExp("^" + PREFIX + "[a-f0-9]{64}\\.json$").test(p.key) || !validInt(p.count) || !p.count || p.count > PAGE_SIZE || !validInt(p.min) || !validInt(p.max) || p.min > p.max || !validInt(p.bytes) || p.bytes > MAX_PAGE_BYTES || typeof p.bloom !== "string" || !/^[A-Za-z0-9+/]{1366}==$/.test(p.bloom)) throw Error("archive_segments_invalid");
      }
      if (index.version === 1 && pages.length || count(index) > 5e5) throw Error("archive_segments_invalid");
    }
    __name(validateSegments, "validateSegments");
    async function putPage(bucket, entries) {
      const ordered = [...entries].sort((a, b) => b.sequence - a.sequence), text = JSON.stringify({ version: 1, entries: ordered }), bytes = new TextEncoder().encode(text).length;
      if (!ordered.length || ordered.length > PAGE_SIZE || bytes > MAX_PAGE_BYTES) throw Error("archive_page_limit");
      const key = PREFIX + await hash(text) + ".json";
      await bucket.put(key, text, { httpMetadata: { contentType: "application/json" } });
      return { key, count: ordered.length, min: Math.min(...ordered.map((x) => x.sequence)), max: Math.max(...ordered.map((x) => x.sequence)), bytes, bloom: bloom(ordered) };
    }
    __name(putPage, "putPage");
    async function readPage(bucket, page) {
      const o = await bucket.get(page.key);
      if (!o || o.size !== page.bytes) throw Error("archive_page_missing");
      const value = await o.json(), text = JSON.stringify(value);
      if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length !== page.count || PREFIX + await hash(text) + ".json" !== page.key || value.entries.some((e) => !validInt(e.sequence) || e.sequence < page.min || e.sequence > page.max) || bloom(value.entries) !== page.bloom) throw Error("archive_page_invalid");
      return value.entries;
    }
    __name(readPage, "readPage");
    async function prepareSave(bucket, index, etag) {
      const entries = [...index.entries].sort((a, b) => a.sequence - b.sequence), segments = [...index.segments || []];
      if (entries.length > PAGE_SIZE && index.version === 1 && !segments.length) {
        const original = await bucket.get("v1/public/index.json");
        if (!original || original.etag !== etag) throw Error("archive_index_conflict");
        await bucket.put("v2/private/pre-shard/" + await hash(etag) + ".json", JSON.stringify(await original.json()), { httpMetadata: { contentType: "application/json" } });
      }
      while (entries.length > PAGE_SIZE) {
        segments.push(await putPage(bucket, entries.splice(0, PAGE_SIZE)));
      }
      if (segments.length > MAX_SEGMENTS) throw Error("archive_segments_limit");
      const root = { ...index, entries, segments };
      root.version = segments.length || index.version === 2 ? 2 : 1;
      if (root.version === 1) delete root.segments;
      validateSegments(root);
      return { root };
    }
    __name(prepareSave, "prepareSave");
    function commitSave(index, root) {
      index.entries.splice(0, index.entries.length, ...root.entries);
      index.segments ??= [];
      index.segments.splice(0, index.segments.length, ...root.segments || []);
      index.version = root.version;
    }
    __name(commitSave, "commitSave");
    async function queryEntries(bucket, index, { q = "", before = null, limit = Infinity, filter = /* @__PURE__ */ __name(() => true, "filter") } = {}) {
      const accepts = /* @__PURE__ */ __name((e) => (!q || e.vin === q || e.lot === q) && (!before || e.sequence < Number(before)) && filter(e), "accepts");
      let found = index.entries.filter(accepts);
      const pages = (index.segments || []).filter((p) => (!before || p.min < Number(before)) && mayContain(p, q)).sort((a, b) => b.max - a.max);
      for (const page of pages) {
        found.sort((a, b) => b.sequence - a.sequence);
        if (found.length >= limit && page.max < found[limit - 1].sequence) break;
        found.push(...(await readPage(bucket, page)).filter(accepts));
      }
      const keys = /* @__PURE__ */ new Set();
      for (const e of found) {
        const key = e.platform + "/" + e.lot + "/" + e.sequence;
        if (keys.has(key)) throw Error("archive_duplicate");
        keys.add(key);
      }
      return found.sort((a, b) => b.sequence - a.sequence).slice(0, limit);
    }
    __name(queryEntries, "queryEntries");
    async function withoutVin(bucket, index, vin) {
      const segments = [];
      for (const page of index.segments || []) {
        if (!mayContain(page, vin)) {
          segments.push(page);
          continue;
        }
        const entries = await readPage(bucket, page), remaining = entries.filter((e) => e.vin !== vin);
        if (remaining.length === entries.length) segments.push(page);
        else if (remaining.length) segments.push(await putPage(bucket, remaining));
      }
      return { ...index, entries: index.entries.filter((e) => e.vin !== vin), segments };
    }
    __name(withoutVin, "withoutVin");
    async function updateEntry(bucket, index, entry) {
      if (index.entries.some((e) => e === entry)) return;
      for (let i = 0; i < (index.segments || []).length; i++) {
        const p = index.segments[i];
        if (entry.sequence < p.min || entry.sequence > p.max || !mayContain(p, entry.vin)) continue;
        const entries = await readPage(bucket, p), at = entries.findIndex((e) => e.platform === entry.platform && e.lot === entry.lot && e.sequence === entry.sequence);
        if (at < 0) continue;
        entries[at] = entry;
        index.segments[i] = await putPage(bucket, entries);
        return;
      }
      throw Error("archive_entry_missing");
    }
    __name(updateEntry, "updateEntry");
    module.exports = { PAGE_SIZE, MAX_PAGE_BYTES, validateSegments, prepareSave, commitSave, readPage, queryEntries, withoutVin, updateEntry, count, mayContain };
  }
});

// src/sync/auction-archive-budget.cjs
var require_auction_archive_budget = __commonJS({
  "src/sync/auction-archive-budget.cjs"(exports, module) {
    "use strict";
    var KEY = "v1/private/storage-budget.json";
    var ACCOUNT_BYTES = 3e11;
    var OTHER_BUCKET_RESERVE = 3e8;
    var FEED_WORK_RESERVE = 6e8;
    var STATUS_KEY = "v2/private/storage-status.json";
    var REFRESH_MS = 15 * 6e4;
    var HOUR = 60 * 6e4;
    var MAX_PAGES = 256;
    var FEED_BUCKET_RESERVE = 6e9;
    var valid = /* @__PURE__ */ __name((n) => Number.isSafeInteger(n) && n >= 0, "valid");
    async function ledger(db) {
      const row = await db.prepare("SELECT COALESCE(SUM(compressed_bytes+COALESCE(archive_bytes,0)),0) AS bytes FROM server_feed_generations WHERE retired_at IS NULL").first();
      if (!valid(row?.bytes)) throw Error("archive_storage_ledger");
      return row.bytes;
    }
    __name(ledger, "ledger");
    async function sourceBytes(bucket) {
      let cursor, total = 0;
      const seen = /* @__PURE__ */ new Set();
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await bucket.list({ limit: 1e3, ...cursor ? { cursor } : {} });
        if (!Array.isArray(result?.objects) || typeof result.truncated !== "boolean" || result.objects.some((o) => !valid(o.size))) throw Error("archive_storage_listing");
        total += result.objects.reduce((s, o) => s + o.size, 0);
        if (!result.truncated) return total;
        if (!result.objects.length || typeof result.cursor !== "string" || !result.cursor || seen.has(result.cursor)) throw Error("archive_storage_cursor");
        seen.add(result.cursor);
        cursor = result.cursor;
      }
      throw Error("archive_storage_page_limit");
    }
    __name(sourceBytes, "sourceBytes");
    async function archiveAllowance(env, { now = Date.now, maximum, previous = null } = {}) {
      if (!valid(maximum)) throw Error("archive_storage_config");
      const at = now(), bucket = env.REXBID_AUCTION_ARCHIVE, source = env.REXBID_ARCHIVE_FEED;
      const currentLedger = await ledger(env.REXBID_ARCHIVE_CATALOG);
      const object = await bucket.get(KEY);
      let meter = object ? await object.json() : null;
      if (meter && !(meter.version === 1 && valid(meter.at) && valid(meter.sourceBytes) && valid(meter.ledgerBytes) && meter.at <= at)) throw Error("archive_storage_meter");
      const statusAt = Date.parse(previous?.at);
      const spareCapacity = previous?.version === 1 && valid(statusAt) && statusAt <= at && at - statusAt < REFRESH_MS && valid(previous.reservedTotalBytes) && previous.reservedTotalBytes < ACCOUNT_BYTES * 0.8;
      const refreshMs = spareCapacity ? HOUR : REFRESH_MS;
      if (!meter || at - meter.at >= refreshMs) {
        meter = { version: 1, at, sourceBytes: await sourceBytes(source), ledgerBytes: currentLedger };
        await bucket.put(KEY, JSON.stringify(meter), { httpMetadata: { contentType: "application/json" } });
      }
      const sourceReserved = meter.sourceBytes + Math.max(0, currentLedger - meter.ledgerBytes);
      const admissionReserve = spareCapacity ? Math.max(sourceReserved, FEED_BUCKET_RESERVE) : sourceReserved;
      const available = Math.max(0, ACCOUNT_BYTES - OTHER_BUCKET_RESERVE - FEED_WORK_RESERVE - admissionReserve);
      return { maximumBytes: Math.min(maximum, available), sourceReserved, measuredAt: new Date(meter.at).toISOString(), feedWorkReserve: FEED_WORK_RESERVE, otherBucketReserve: OTHER_BUCKET_RESERVE };
    }
    __name(archiveAllowance, "archiveAllowance");
    function projection(points) {
      if (points.length < 2) return null;
      const last = points.at(-1), first = points.find((p) => last.at - p.at >= 864e5);
      if (!first) return null;
      const perDay = (last.bytes - first.bytes) / ((last.at - first.at) / 864e5);
      return { sampleHours: (last.at - first.at) / 36e5, bytesPerDay: perDay, daysRemaining: perDay > 0 ? Math.max(0, (ACCOUNT_BYTES - last.bytes) / perDay) : null };
    }
    __name(projection, "projection");
    function statusSnapshot(index, allowance, previous, at) {
      const { count } = require_auction_archive_segments();
      const bytes = index.allocatedBytes + allowance.sourceReserved + OTHER_BUCKET_RESERVE + FEED_WORK_RESERVE;
      const points = (previous?.points || []).filter((p) => valid(p.at) && valid(p.bytes) && p.at <= at && at - p.at < 7 * 864e5);
      if (!points.length || at - points.at(-1).at >= 36e5) points.push({ at, bytes });
      const trend = projection(points);
      const warning = bytes >= ACCOUNT_BYTES ? "capacity" : bytes >= ACCOUNT_BYTES * 0.8 ? "near_capacity" : trend?.daysRemaining !== null && trend?.daysRemaining <= 7 ? "growth_warning" : null;
      return {
        version: 1,
        at: new Date(at).toISOString(),
        limitBytes: ACCOUNT_BYTES,
        reservedTotalBytes: bytes,
        remainingBytes: Math.max(0, ACCOUNT_BYTES - bytes),
        archiveAllocatedBytes: index.allocatedBytes,
        galleries: count(index),
        estimatedStorageUSDMonthly: Math.max(0, Math.ceil(bytes / 1e9) - 10) * 0.015,
        approvedStorageUSDMonthly: 5,
        warning,
        trend,
        points,
        sourceMeasuredAt: allowance.measuredAt,
        note: "Estimate at constant current occupancy including working reserves, not an invoice. R2 operations, tax and other Cloudflare services are separate."
      };
    }
    __name(statusSnapshot, "statusSnapshot");
    async function recordStorageStatus(env, allowance, { now = Date.now, previous = null } = {}) {
      const bucket = env.REXBID_AUCTION_ARCHIVE;
      const { getIndex } = require_auction_archive_state();
      const { index } = await getIndex(bucket);
      const status = statusSnapshot(index, allowance, previous, now());
      await bucket.put(STATUS_KEY, JSON.stringify(status), { httpMetadata: { contentType: "application/json" } });
      return status;
    }
    __name(recordStorageStatus, "recordStorageStatus");
    module.exports = { archiveAllowance, sourceBytes, KEY, ACCOUNT_BYTES, OTHER_BUCKET_RESERVE, FEED_WORK_RESERVE, STATUS_KEY, projection, statusSnapshot, recordStorageStatus };
  }
});

// src/sync/auction-archive-state.cjs
var require_auction_archive_state = __commonJS({
  "src/sync/auction-archive-state.cjs"(exports, module) {
    "use strict";
    var INDEX_KEY = "v1/public/index.json";
    var MAX_ENTRIES = 5e5;
    var MAX_INDEX_BYTES = 8e6;
    var { ACCOUNT_BYTES, OTHER_BUCKET_RESERVE, FEED_WORK_RESERVE } = require_auction_archive_budget();
    var MAX_ARCHIVE_BYTES = ACCOUNT_BYTES - OTHER_BUCKET_RESERVE - FEED_WORK_RESERVE;
    var MAX_PHOTO_BYTES = 48e4;
    var GALLERY_OBJECT = "gallery.bin";
    var VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
    var LOT = /^\d{5,14}$/;
    var FIRST_GENERATION = 17229;
    var LEASE_MS = 18e4;
    function minimumYear(now) {
      return Math.max(2018, Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "Europe/Warsaw" }).format(now)) - 8);
    }
    __name(minimumYear, "minimumYear");
    function baseKey(item) {
      return "v1/auctions/" + item.platform + "/" + item.lot + "/" + item.sequence;
    }
    __name(baseKey, "baseKey");
    function restorableKeys(item) {
      const prefix = baseKey(item);
      const photos = item.photoBytes ? [GALLERY_OBJECT] : item.photos;
      return [...photos.map((name) => prefix + "/" + name), prefix + "/manifest.json"];
    }
    __name(restorableKeys, "restorableKeys");
    function parseIndex(value) {
      if (!value || ![1, 2].includes(value.version) || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES || value.hidden && !Array.isArray(value.hidden) || value.deletions && !Array.isArray(value.deletions)) throw Error("archive_index_invalid");
      const index = {
        ...value,
        segments: value.segments || [],
        hidden: value.hidden || [],
        deletions: value.deletions || [],
        generation: value.generation ?? FIRST_GENERATION,
        offset: value.offset ?? 0,
        allocatedBytes: value.allocatedBytes ?? 16e6
      };
      require_auction_archive_segments().validateSegments(index);
      return index;
    }
    __name(parseIndex, "parseIndex");
    async function getIndex(bucket) {
      const object = await bucket.get(INDEX_KEY);
      if (!object || object.size > MAX_INDEX_BYTES || !object.etag) throw Error("archive_index_unavailable");
      return { index: parseIndex(await object.json()), etag: object.etag };
    }
    __name(getIndex, "getIndex");
    async function saveIndex(bucket, index, etag) {
      const { prepareSave, commitSave } = require_auction_archive_segments();
      const prepared = await prepareSave(bucket, index, etag);
      const value = JSON.stringify(prepared.root);
      if (new TextEncoder().encode(value).length > MAX_INDEX_BYTES) throw Error("archive_index_limit");
      const saved = await bucket.put(INDEX_KEY, value, {
        onlyIf: { etagMatches: etag },
        httpMetadata: { contentType: "application/json" }
      });
      if (!saved) throw Error("archive_index_conflict");
      commitSave(index, prepared.root);
      return saved.etag;
    }
    __name(saveIndex, "saveIndex");
    async function hash(value) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
    }
    __name(hash, "hash");
    function locked(index, now = Date.now()) {
      return Boolean(index.lock && index.lock.until > now);
    }
    __name(locked, "locked");
    async function purgeObjects(bucket, index, etag) {
      if (!index.deletions.length) return { index, etag };
      const batch = index.deletions.slice(0, 100);
      await bucket.delete(batch);
      const next = { ...index, deletions: index.deletions.slice(batch.length) };
      return { index: next, etag: await saveIndex(bucket, next, etag) };
    }
    __name(purgeObjects, "purgeObjects");
    module.exports = {
      INDEX_KEY,
      MAX_ENTRIES,
      MAX_INDEX_BYTES,
      MAX_ARCHIVE_BYTES,
      MAX_PHOTO_BYTES,
      GALLERY_OBJECT,
      VIN,
      LOT,
      LEASE_MS,
      minimumYear,
      baseKey,
      parseIndex,
      restorableKeys,
      getIndex,
      saveIndex,
      locked,
      purgeObjects,
      hash
    };
  }
});

// src/sync/auction-archive-intake.cjs
var require_auction_archive_intake = __commonJS({
  "src/sync/auction-archive-intake.cjs"(exports, module) {
    "use strict";
    var { unpackMediaJson } = require_catalog_media_storage();
    var { safeMediaReferences } = require_core();
    var { count, queryEntries, updateEntry } = require_auction_archive_segments();
    var {
      MAX_ENTRIES,
      MAX_ARCHIVE_BYTES,
      MAX_PHOTO_BYTES,
      GALLERY_OBJECT,
      VIN,
      LOT,
      LEASE_MS,
      minimumYear,
      baseKey,
      restorableKeys,
      getIndex,
      saveIndex,
      locked,
      purgeObjects,
      hash
    } = require_auction_archive_state();
    var platforms = ["copart", "iaai"];
    var MAX_FEED = 32 * 1024 * 1024;
    var MAX_DECODED_FEED = 256 * 1024 * 1024;
    var MAX_FEED_LINE = 1024 * 1024;
    var MAX_WORK = 38;
    var WINDOW_EVENTS = 3 * MAX_WORK + 1;
    var MAX_PUBLISHED_PER_CYCLE = 10;
    var MAX_GALLERY_PHOTOS = 22;
    var waitExpiry = 2 * 864e5;

const MAX_BYTES=8*1024*1024;
const MAX_EVENTS=10000;
const hex=/^[a-f0-9]{64}$/;

async function readRecoveredArchive({bucket,generation,after,pin,parseEvent,hash}){
  let permit;
  try{permit=JSON.parse(pin);}catch{throw Error('archive_recovery_required');}
  const {generationId,sha256,originalSha256,fromExclusive,through}=permit??{};
  if(!generation.retired_at||generationId!==generation.generation_id
    ||!hex.test(sha256)||originalSha256!==generation.sha256||!hex.test(originalSha256)
    ||!Number.isSafeInteger(fromExclusive)||fromExclusive<generation.first_sequence-1
    ||fromExclusive>=through||through!==generation.last_sequence
    ||!Number.isSafeInteger(after)||after<fromExclusive||after>through){
    throw Error('archive_recovery_invalid');
  }
  const key='v2/private/recovery/'+generationId+'-'+sha256+'.json';
  const object=await bucket.get(key);
  if(!object||!Number.isSafeInteger(object.size)||object.size<1||object.size>MAX_BYTES){
    throw Error('archive_recovery_unavailable');
  }
  const text=await object.text();
  if(new TextEncoder().encode(text).length!==object.size||await hash(text)!==sha256){
    throw Error('archive_recovery_checksum');
  }
  const payload=JSON.parse(text);
  if(payload.version!==1||payload.kind!=='apibara-terminal-replay'
    ||payload.generationId!==generationId||payload.originalSha256!==originalSha256
    ||payload.fromExclusive!==fromExclusive||payload.through!==through
    ||!Array.isArray(payload.events)||payload.events.length>MAX_EVENTS){
    throw Error('archive_recovery_invalid');
  }
  let previous=fromExclusive;
  const result=[];
  for(const row of payload.events){
    const event=parseEvent(row,generation);
    if(!event||event.sequence<=previous||event.sequence>through)throw Error('archive_recovery_invalid');
    previous=event.sequence;
    if(event.sequence>after)result.push(event);
  }
  return result;
}


const readTerminalSidecar = (()=>{

const LIMIT = 115;
const MAX_BYTES = 65536;
const hex = /^[a-f0-9]{64}$/;

async function checkedJSON(bucket, key, digest, hash, expectedBytes) {
  if (!hex.test(digest)) throw Error('archive_sidecar_checksum');
  const object = await bucket.get(key);
  if (!object || !Number.isSafeInteger(object.size) || object.size < 1 || object.size > MAX_BYTES
    || expectedBytes !== undefined && object.size !== expectedBytes) throw Error('archive_sidecar_size');
  const body = await object.text();
  if (new TextEncoder().encode(body).length !== object.size || await hash(body) !== digest) throw Error('archive_sidecar_checksum');
  return JSON.parse(body);
}

async function readTerminalSidecar({ bucket, generation, after, manifestChecksum, hash, limit=LIMIT }) {
  const { generation_id:id, sha256, first_sequence:from, last_sequence:through } = generation;
  if (!Number.isSafeInteger(id) || !hex.test(sha256) || !Number.isSafeInteger(from) || !Number.isSafeInteger(through)
    || !Number.isSafeInteger(after) || after > through || !Number.isInteger(limit) || limit < 1 || limit > LIMIT) {
    throw Error('archive_sidecar_scope');
  }
  const base = `v2/private/terminal/${id}/${sha256}/`;
  const manifest = await checkedJSON(bucket, base+'manifest.json', manifestChecksum, hash);
  if (manifest.version !== 1 || manifest.kind !== 'archive-terminal-sidecar' || manifest.generation !== id
    || manifest.rawSha256 !== sha256 || manifest.from !== from || manifest.through !== through
    || !Array.isArray(manifest.parts) || manifest.parts.length > 256) throw Error('archive_sidecar_scope');
  let prev = from - 1, count = 0;
  for (const [index, part] of manifest.parts.entries()) {
    const { name, bytes, sha256:sha, start, end, count:rows } = part;
    if (!hex.test(sha) || name !== `part-${String(index).padStart(4,'0')}-${sha}.json` || !Number.isInteger(bytes)
      || bytes < 1 || bytes > MAX_BYTES || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start <= prev || end < start || end > through || !Number.isInteger(rows) || rows<1 || rows>LIMIT
      || index < manifest.parts.length - 1 && rows !== LIMIT) throw Error('archive_sidecar_manifest');
    prev=end;
    count+=rows;
  }
  if (manifest.terminal !== count) throw Error('archive_sidecar_manifest');
  const events=[];
  let partsRead=0;
  for (const part of manifest.parts) {
    if (part.end<=after) continue;
    const payload = await checkedJSON(bucket, base+part.name, part.sha256, hash, part.bytes);
    partsRead++;
    if (!Array.isArray(payload) || payload.length!==part.count || payload[0]?.sequence!==part.start
      || payload.at(-1)?.sequence!==part.end) throw Error('archive_sidecar_event');
    prev=part.start-1;
    for (const event of payload) {
      if (event?.generation!==id || !Number.isSafeInteger(event.sequence) || event.sequence<=prev || event.sequence>part.end
        || !['copart','iaai'].includes(event.platform) || !/^[A-HJ-NPR-Z0-9]{17}$/.test(event.vin)
        || !/^\d{5,14}$/.test(event.lot) || !['sold','not_sold','ended_unknown'].includes(event.status)
        || !Number.isFinite(Date.parse(event.recordedAt)) || event.saleCents!==null
        && (event.status!=='sold' || !Number.isSafeInteger(event.saleCents) || event.saleCents<=0)) throw Error('archive_sidecar_event');
      prev=event.sequence;
      if (event.sequence>after && events.length<limit) events.push(event);
    }
    if (events.length>=limit) break;
  }
  return { events, partsRead, mayContinue: events.length>0 && events.at(-1).sequence<manifest.parts.at(-1).end };
}


return readTerminalSidecar;})();
  async function deferRecoveredEvent(bucket, event) {
    const text = JSON.stringify({ version: 1, kind: 'archive-gallery-review', reason: 'missing-verified-gallery', event });
    const key = 'v2/private/recovery-gallery-review/' + event.generation + '/' + event.sequence + '.json';
    const receipt = await bucket.put(key, text, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } });
    if (receipt) return;
    const existing = await bucket.get(key);
    if (!existing || existing.size !== new TextEncoder().encode(text).byteLength || await existing.text() !== text) {
      throw Error('archive_recovery_gallery_conflict');
    }
  }

    var deadlineMs = 11e4;
    var eventStatuses = /* @__PURE__ */ new Map([["lot.sold", "sold"], ["lot.not_sold", "not_sold"], ["auction.ended", "ended_unknown"]]);
    function parseEvent(value, generation) {
      const { vehicle, after } = value;
      const status = eventStatuses.get(value.event);
      if (!status || value.terminal !== true || !platforms.includes(vehicle?.platform) || !VIN.test(vehicle?.vin || "") || !LOT.test(String(vehicle?.lot_number || "")) || !Number.isSafeInteger(value.sequence) || value.sequence < generation.first_sequence || value.sequence > generation.last_sequence || !Number.isFinite(Date.parse(value.recorded_at))) return null;
      if (status === "sold" && (value.reason !== "source_outcome" || ![true, 1, "1"].includes(after?.["auction.lot_sold"]) || String(after?.["auction.last_sold_status"] || "").trim().toLowerCase() !== "sold")) return null;
      if (status === "not_sold" && value.reason !== "source_outcome") return null;
      const amount = after?.["pricing.last_sold_price_usd"];
      const saleCents = status === "sold" && typeof amount === "number" && Number.isFinite(amount) && amount > 0 && amount < 1e7 ? Math.round(amount * 100) : null;
      const recordedAt = new Date(value.recorded_at).toISOString();
      const day = after?.["auction.last_sold_day"];
      const timestamp = after?.["auction.last_sold_at"];
      const preciseSale = status === "sold" && typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) && Number.isFinite(Date.parse(timestamp));
      return {
        platform: vehicle.platform,
        lot: String(vehicle.lot_number),
        vin: vehicle.vin,
        recordedAt,
        status,
        saleCents,
        sequence: value.sequence,
        generation: generation.generation_id,
        ...preciseSale ? {
          sourceSoldAt: new Date(timestamp).toISOString(),
          saleTransition: [false, 0, "0"].includes(value.before?.["auction.lot_sold"])
        } : {},
        eventDay: typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : recordedAt.slice(0, 10)
      };
    }
    __name(parseEvent, "parseEvent");
    function jpeg(bytes) {
      return bytes.length >= 32 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
    }
    __name(jpeg, "jpeg");
    async function readCapped(stream, cap) {
      const reader = stream.getReader();
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > cap) throw Error("archive_payload_limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {
        });
      }
      const bytes = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      return bytes;
    }
    __name(readCapped, "readCapped");
    async function publishedEvents(bucket, generation, afterSequence = 0, limit = MAX_WORK + 1) {
      const key = generation.raw_key;
      if (typeof key !== "string" || !key || !Number.isSafeInteger(generation.compressed_bytes) || generation.compressed_bytes > MAX_FEED)
        throw Error("archive_feed_limit");
      const file = await bucket.get(key);
      if (!file || file.size !== generation.compressed_bytes) throw Error("archive_feed_not_found");
      const compressed = await readCapped(file.body, MAX_FEED);
      if (await hash(compressed) !== generation.sha256) throw Error("archive_feed_checksum");
      const events = [];
      let total = 0;
      const cap = new TransformStream({ transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > MAX_DECODED_FEED) throw Error("archive_feed_decoded_limit");
        controller.enqueue(chunk);
      } });
      const reader = new ReadableStream({ start(controller) {
        controller.enqueue(compressed);
        controller.close();
      } }).pipeThrough(new DecompressionStream("gzip")).pipeThrough(cap).pipeThrough(new TextDecoderStream()).getReader();
      let tail = "";
      function append(line) {
        if (line.length > MAX_FEED_LINE) throw Error("archive_feed_record_limit");
        if (!line.trim()) return;
        const event = parseEvent(JSON.parse(line), generation);
        if (!event || event.sequence <= afterSequence) return;
        if (events.length === limit && event.sequence >= events.at(-1).sequence) return;
        const insertion = events.findIndex((item) => item.sequence > event.sequence);
        if (insertion < 0) events.push(event);
        else events.splice(insertion, 0, event);
        if (events.length > limit) events.pop();
      }
      __name(append, "append");
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = (tail + value).split("\n");
          tail = lines.pop();
          if (tail.length > MAX_FEED_LINE) throw Error("archive_feed_record_limit");
          for (const line of lines) append(line);
        }
        append(tail);
      } finally {
        await reader.cancel().catch(() => {
        });
      }
      return events;
    }
    __name(publishedEvents, "publishedEvents");
    function photoUrl(platform, candidate) {
      const url = new URL(candidate);
      if (url.username || url.password || url.hash) return null;
      if (platform === "copart" && url.origin === "https://cs.copart.com" && url.pathname.startsWith("/v1/AUTH_svc.pdoc00001/") && !url.search) return url;
      if (platform !== "iaai" || url.origin !== "https://vis.iaai.com" || url.pathname !== "/resizer" || [...url.searchParams.keys()].some((k) => !["imageKeys", "width", "height"].includes(k)) || url.searchParams.getAll("imageKeys").length !== 1 || !/^[A-Za-z0-9~_-]{1,180}$/.test(url.searchParams.get("imageKeys") || "")) return null;
      url.searchParams.set("width", "1280");
      url.searchParams.set("height", "960");
      return url;
    }
    __name(photoUrl, "photoUrl");
    async function sourcePhoto(url, fetchImage, stats) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      try {
        const r = await fetchImage(url.href, { redirect: "manual", headers: { Accept: "image/jpeg" }, signal: controller.signal });
        stats["http_" + r.status] = (stats["http_" + r.status] || 0) + 1;
        if (!r.ok || !/^image\/jpeg\b/i.test(r.headers.get("Content-Type") || "") || Number(r.headers.get("Content-Length")) > MAX_PHOTO_BYTES) {
          await r.body?.cancel();
          return null;
        }
        const bytes = await readCapped(r.body, MAX_PHOTO_BYTES);
        if (!jpeg(bytes)) {
          stats.invalidJpeg = (stats.invalidJpeg || 0) + 1;
          return null;
        }
        return bytes;
      } catch (error) {
        const kind = controller.signal.aborted ? "timeout" : error?.message === "Illegal invocation" ? "invocation" : /^archive_[a-z_]+$/.test(error?.message) ? error.message : error?.name === "TimeoutError" ? "timeout" : "fetch_error";
        stats[kind] = (stats[kind] || 0) + 1;
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    __name(sourcePhoto, "sourcePhoto");
    async function gallery(row, fetchImage, stats) {
      const decode = /* @__PURE__ */ __name((value, kind) => safeMediaReferences(JSON.parse(unpackMediaJson(value) || "[]"), kind), "decode");
      const references = decode(row.media_urls_json, "image");
      const urls = references.map((ref) => photoUrl(row.platform, ref)).filter(Boolean);
      if (urls.length !== references.length) stats.unusableUrl = (stats.unusableUrl || 0) + references.length - urls.length;
      return (await Promise.all(urls.slice(0, MAX_GALLERY_PHOTOS).map(async (url) => {
        const image = await sourcePhoto(url, fetchImage, stats);
        if (image || row.platform !== "iaai") return image;
        url.searchParams.set("width", "800");
        url.searchParams.set("height", "600");
        return sourcePhoto(url, fetchImage, stats);
      }))).filter(Boolean);
    }
    __name(gallery, "gallery");
    var listingSql = `SELECT platform,lot,vin_normalized,year,vehicle_title,media_urls_json,first_seen_at,last_seen_at
  FROM auction_listings INDEXED BY idx_listings_lot_recent
  WHERE platform=? AND lot=? AND vin_normalized=? AND source_listing_id=? AND auction_state='ended'
  LIMIT 3`;
    var nextSql = `SELECT generation_id,raw_key,compressed_bytes,sha256,first_sequence,last_sequence,retired_at
  FROM server_feed_generations WHERE status='complete' AND generation_id>=? ORDER BY generation_id ASC LIMIT 1`;
    var legacyListingSql = `SELECT l.platform,l.lot,l.vin_normalized,l.year,l.vehicle_title,l.media_urls_json,l.first_seen_at,l.last_seen_at
  FROM auction_listings l INDEXED BY idx_listings_lot_recent JOIN vehicle_sources s ON l.source_key=s.source_key
  WHERE l.platform=? AND l.lot=? AND l.vin_normalized=? AND l.source_listing_id=? AND l.identity_state='resolved'
  AND s.provider='apibara' AND s.platform=l.platform AND s.identity_state='resolved'
  LIMIT 2`;
    async function findRow(db, event) {
      const rows = (await db.prepare(listingSql).bind(event.platform, event.lot, event.vin, event.lot).all()).results;
      const recorded = Date.parse(event.recordedAt);
      const viable = rows.filter((row) => Date.parse(row.first_seen_at) <= recorded && Math.abs(Date.parse(row.last_seen_at) - recorded) < 45 * 864e5);
      return viable.length === 1 ? viable[0] : null;
    }
    __name(findRow, "findRow");
    async function findEarlierListing(db, event) {
      const rows = (await db.prepare(legacyListingSql).bind(event.platform, event.lot, event.vin, event.lot).all()).results;
      if (rows.length !== 1) return null;
      const [row] = rows;
      const recorded = Date.parse(event.recordedAt), first = Date.parse(row.first_seen_at), last = Date.parse(row.last_seen_at);
      return first <= last && last <= recorded && recorded - last < 45 * 864e5 ? row : null;
    }
    __name(findEarlierListing, "findEarlierListing");
    function earliestPending(index) {
      if (index.offset) return { generation: index.generation, offset: index.offset };
      return { generation: index.generation + 1, offset: 0 };
    }
    __name(earliestPending, "earliestPending");
    async function terminalWindow(index, source, generation, after, target, recoveryPin, terminalPin) {
      if (terminalPin && generation.generation_id === 25281) {
        const { generationId, manifestChecksum } = JSON.parse(terminalPin);
        if (generationId !== generation.generation_id) throw Error('archive_sidecar_scope');
        delete index.terminalWindow;
        const state = await readTerminalSidecar({ bucket: target, generation, after, manifestChecksum, hash });
        return { ...state, recovered: true };
      }
      if (generation.retired_at && generation.generation_id === 18968 && recoveryPin) {
        delete index.terminalWindow;
        const events = await readRecoveredArchive({ bucket: target, generation, after, pin: recoveryPin, parseEvent, hash });
        return { events: events.slice(0, WINDOW_EVENTS), mayContinue: events.length > WINDOW_EVENTS, recovered: true };
      }
      if (generation.retired_at) {
        // A saved original must match the original production size and SHA in
        // publishedEvents. A missing backup blocks the cursor at this file.
        source = target;
        generation = { ...generation, raw_key: 'v2/private/recovery-raw/' + generation.generation_id + '-' + generation.sha256 + '.jsonl.gz' };
      }
      if (generation.compressed_bytes < 1024 * 1024) {
        delete index.terminalWindow;
        const events2 = await publishedEvents(source, generation, after);
        return { events: events2, mayContinue: events2.length === MAX_WORK + 1, recovered: Boolean(generation.retired_at) };
      }
      const cached = index.terminalWindow;
      if (cached?.version === 1 && cached.generation === generation.generation_id && cached.rawSha === generation.sha256 && cached.start <= after && Array.isArray(cached.events) && cached.events.length > 0 && cached.events.length <= WINDOW_EVENTS && cached.events.at(-1).sequence > after && cached.checksum === await hash(JSON.stringify(cached.events))) {
        const remaining = cached.events.filter((event) => event.sequence > after);
        const mayContinue = cached.events.length === WINDOW_EVENTS;
        if (!mayContinue || remaining.length > MAX_WORK) return { events: remaining, mayContinue, recovered: Boolean(generation.retired_at) };
      }
      const events = await publishedEvents(source, generation, after, WINDOW_EVENTS);
      if (events.length && JSON.stringify(events).length * 32 <= generation.compressed_bytes) {
        index.terminalWindow = {
          version: 1,
          generation: generation.generation_id,
          rawSha: generation.sha256,
          start: after,
          events,
          checksum: await hash(JSON.stringify(events))
        };
      } else delete index.terminalWindow;
      return { events, mayContinue: events.length === WINDOW_EVENTS, recovered: Boolean(generation.retired_at) };
    }
    __name(terminalWindow, "terminalWindow");
    async function runArchive(env, {
      now = /* @__PURE__ */ __name(() => Date.now(), "now"),
      fetchImage = /* @__PURE__ */ __name((input, init) => globalThis.fetch(input, init), "fetchImage"),
      maximumBytes = MAX_ARCHIVE_BYTES
    } = {}) {
      const target = env.REXBID_AUCTION_ARCHIVE, source = env.REXBID_ARCHIVE_FEED, db = env.REXBID_ARCHIVE_CATALOG;
      if (!target || !source || !db) throw Error("archive_bindings");
      if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > MAX_ARCHIVE_BYTES) throw Error("archive_storage_config");
      const started = now(), date = new Date(started);
      let { index, etag } = await getIndex(target);
      if (locked(index, started)) return { status: "locked" };
      const atCapacity = count(index) >= MAX_ENTRIES || index.allocatedBytes >= maximumBytes;
      if (atCapacity && !index.deletions.length && !index.staged?.length)
        return { status: "archive_capacity", entries: count(index), allocatedBytes: index.allocatedBytes };
      const cursor = earliestPending(index);
      const generation = atCapacity ? null : await db.prepare(nextSql).bind(cursor.generation).first();
      const waiting = Array.isArray(index.waiting) ? index.waiting.filter((item) => started - Date.parse(item.recordedAt) < waitExpiry) : [];
      if (!generation && !waiting.length && !index.deletions.length && !index.staged?.length) return { status: "idle", through: index.generation };
      if (!atCapacity && index.offset && generation?.generation_id !== cursor.generation) throw Error("archive_unfinished_generation_missing");
      const lock = { id: crypto.randomUUID(), until: started + LEASE_MS };
      index = { ...index, lock, waiting };
      etag = await saveIndex(target, index, etag);
      let saved = 0, retried = 0, ignored = 0;
      let legacy = env.REXBID_ARCHIVE_LEGACY;
      const photoDiagnostics = {};
      try {
        if (index.staged?.length) {
          index.deletions = [.../* @__PURE__ */ new Set([...index.deletions, ...index.staged])];
          delete index.staged;
          etag = await saveIndex(target, index, etag);
        }
        ({ index, etag } = await purgeObjects(target, index, etag));
        const window = generation ? await terminalWindow(index, source, generation, cursor.offset, target, env.REXBID_ARCHIVE_RECOVERY_PIN, env.REXBID_ARCHIVE_TERMINAL_PIN) : { events: [], mayContinue: false };
        const events = window.events;
        const queue = [...(atCapacity ? [] : waiting.slice(0, 2)).map((event) => ({ event, retry: true })), ...events.map((event) => ({ event, retry: false }))];
        let processed = 0, throttle = false;
        for (const { event, retry } of queue) {
          if (processed >= MAX_WORK || saved >= MAX_PUBLISHED_PER_CYCLE || now() - started > deadlineMs) {
            throttle = true;
            break;
          }
          processed++;
          const sourcePosition = { generation: index.generation, offset: index.offset };
          if (retry) index.waiting = index.waiting.filter((x) => x.sequence !== event.sequence);
          else {
            index.generation = event.generation;
            index.offset = event.sequence;
          }
          if (index.hidden.includes(await hash(event.vin))) {
            ignored++;
            continue;
          }
          const byLot = (await queryEntries(target, index, { q: event.vin })).filter((entry2) => entry2.platform === event.platform && entry2.lot === event.lot && entry2.vin === event.vin);
          const exact = byLot.find((entry2) => entry2.sequence === event.sequence || event.sourceSoldAt && entry2.sourceSoldAt === event.sourceSoldAt);
          const byDay = byLot.filter((entry2) => (entry2.eventDay || entry2.recordedAt.slice(0, 10)) === event.eventDay);
          const newSale = event.saleTransition === true && byDay.every((entry2) => entry2.sourceSoldAt && entry2.saleTransition === true);
          if (!exact && byDay.length && !newSale && (byDay.length !== 1 || event.sourceSoldAt && byDay[0].sourceSoldAt && event.sourceSoldAt !== byDay[0].sourceSoldAt)) {
            ignored++;
            continue;
          }
          const existing = exact || (!newSale && byDay.length === 1 ? byDay[0] : null);
          if (existing) {
            const confirmedOutcome = (!existing.status || existing.status === "ended_unknown") && event.status !== "ended_unknown";
            const fillSalePrice = exact && existing.status === "sold" && event.status === "sold" && event.saleCents !== null;
            if (existing.saleCents == null && (confirmedOutcome || fillSalePrice)) {
              existing.status = event.status;
              existing.saleCents = event.saleCents;
              if (event.sourceSoldAt) {
                existing.sourceSoldAt = event.sourceSoldAt;
                existing.saleTransition = existing.saleTransition === true || event.saleTransition;
              }
              await updateEntry(target, index, existing);
            }
            ignored++;
            continue;
          }
          let row = await findRow(db, event);
          if (row && (!Number.isSafeInteger(row.year) || row.year < minimumYear(date) || row.year >= 2100)) {
            ignored++;
            continue;
          }
          if (!row) photoDiagnostics.missingListing = (photoDiagnostics.missingListing || 0) + 1;
          let images = row ? await gallery(row, fetchImage, photoDiagnostics) : [];
          if (images.length < 2 && legacy) {
            const older = await findEarlierListing(legacy, event).catch(() => {
              legacy = null;
              photoDiagnostics.earlierCatalogReadFailed = 1;
              return null;
            });
            if (older && Number.isSafeInteger(older.year) && older.year >= minimumYear(date) && older.year < 2100 && (!row || row.year === older.year)) {
              const restored = await gallery(older, fetchImage, photoDiagnostics);
              if (restored.length >= 2) {
                row ??= older;
                images = restored;
                photoDiagnostics.earlierCatalog = (photoDiagnostics.earlierCatalog || 0) + 1;
              }
            }
          }
          if (images.length < 2) {
            if (!retry && (window.recovered || started - Date.parse(event.recordedAt) >= waitExpiry || index.waiting.length >= 120)) {
              await deferRecoveredEvent(target, event);
            }
            if (index.waiting.length < 120 && started - Date.parse(event.recordedAt) < waitExpiry) index.waiting.push(event);
            retried++;
            continue;
          }
          const photoBytes = images.map((image) => image.length);
          const bytes = photoBytes.reduce((total, size) => total + size, 0);
          if (count(index) >= MAX_ENTRIES || index.allocatedBytes + bytes + 2048 > maximumBytes) {
            if (retry) index.waiting.push(event);
            else {
              index.generation = sourcePosition.generation;
              index.offset = sourcePosition.offset;
            }
            throttle = true;
            break;
          }
          const entry = {
            ...event,
            year: row.year,
            title: String(row.vehicle_title || "Pojazd aukcyjny").slice(0, 160),
            visible: true,
            photos: images.map((_, i) => String(i + 1).padStart(2, "0") + ".jpg"),
            photoBytes
          };
          const prefix = baseKey(entry);
          index.allocatedBytes += bytes + 2048;
          const staged = restorableKeys(entry);
          etag = await saveIndex(target, {
            ...index,
            generation: cursor.generation - (!cursor.offset ? 1 : 0),
            offset: cursor.offset,
            waiting,
            staged
          }, etag);
          const packed = new Uint8Array(bytes);
          let position = 0;
          for (const image of images) {
            packed.set(image, position);
            position += image.length;
          }
          await target.put(prefix + "/" + GALLERY_OBJECT, packed, { httpMetadata: { contentType: "application/octet-stream" } });
          await target.put(prefix + "/manifest.json", JSON.stringify(entry), { httpMetadata: { contentType: "application/json" } });
          index.entries.push(entry);
          saved++;
        }
        if (generation && !throttle && window.mayContinue) throttle = true;
        if (generation && !throttle) {
          delete index.terminalWindow;
          index.offset = 0;
          index.generation = generation.generation_id;
        }
        delete index.lock;
        etag = await saveIndex(target, index, etag);
        return {
          status: atCapacity ? "archive_capacity" : throttle ? "partial" : "complete",
          generation: index.generation,
          offset: index.offset,
          saved,
          waiting: index.waiting.length,
          ignored,
          retried,
          photoDiagnostics,
          entries: count(index),
          allocatedBytes: index.allocatedBytes
        };
      } catch (error) {
        const current = await getIndex(target);
        if (current.index.lock?.id === lock.id) {
          delete current.index.lock;
          await saveIndex(target, current.index, current.etag).catch(() => {
          });
        }
        throw error;
      }
    }
    __name(runArchive, "runArchive");
    module.exports = { runArchive, parseEvent, photoUrl, publishedEvents, terminalWindow, deferRecoveredEvent };
  }
});

// src/worker.archive-auto.js
var import_auction_archive_intake = __toESM(require_auction_archive_intake());
var import_auction_archive_budget = __toESM(require_auction_archive_budget());
var import_auction_archive_state = __toESM(require_auction_archive_state());
var worker_archive_auto_default = {
  async scheduled(controller, env) {
    if (controller.cron !== "*/5 * * * *" || env.ARCHIVE_ENABLED !== "yes") return;
    try {
      const started = Date.now();
      const status = await env.REXBID_AUCTION_ARCHIVE.get(import_auction_archive_budget.default.STATUS_KEY);
      const previous = status ? await status.json() : null;
      const allowance = await import_auction_archive_budget.default.archiveAllowance(env, { maximum: import_auction_archive_state.default.MAX_ARCHIVE_BYTES, previous });
      for (let pass = 0; pass < 1 && Date.now() - started < 7e4; pass++) {
        const result = await import_auction_archive_intake.default.runArchive(env, { maximumBytes: allowance.maximumBytes });
        console.info("REXBID archive", JSON.stringify({ ...result, storageBudget: allowance }));
        if (!["partial", "complete"].includes(result.status) || !result.saved && result.retried > 0) break;
      }
      const storage = await import_auction_archive_budget.default.recordStorageStatus(env, allowance, { previous });
      if (storage.warning) console.warn("REXBID archive storage", JSON.stringify({ warning: storage.warning, remainingBytes: storage.remainingBytes, trend: storage.trend }));
    } catch (err) {
      const code = String(err?.message || "");
      console.warn("REXBID archive", /^archive_[a-z_]+$/.test(code) ? code : "archive_run_failed");
    }
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  }
};
export {
  worker_archive_auto_default as default
};
//# sourceMappingURL=worker.archive-auto.js.map
