"use strict";

const {
  validateRexVehicle,
  validateRexHistoryEvent
} = require("../providers/contract.js");

const TERMINAL_SCOPE_STATUSES = new Set(["complete", "failed"]);

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizedPlatform(value) {
  const result = text(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(result)) {
    throw new TypeError("Nieprawidłowa platforma canonical.");
  }
  return result;
}

function scopedKey(...parts) {
  return parts.map(value => encodeURIComponent(text(value))).join("|");
}

function cursorKey(cursor) {
  return cursor === null || cursor === undefined ? "<first-page>" : `cursor:${String(cursor)}`;
}

/**
 * Creates separate source/listing/event identities. VIN is only a match hint.
 * Ambiguous observations use a page-scoped observationKey, so page replay is
 * idempotent while another discovery run does not silently overwrite them.
 */
function createSyncIdentity(vehicle, options = {}) {
  if (!vehicle || typeof vehicle !== "object") throw new TypeError("Wymagany jest canonical RexVehicle.");
  const provider = text(vehicle.provider).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(provider)) throw new TypeError("Brak prawidłowego providera canonical.");
  const platform = normalizedPlatform(vehicle.platform);
  const providerVehicleId = text(vehicle.provider_vehicle_id);
  const sourceListingId = text(options.sourceListingId ?? vehicle.auction?.source_listing_id);
  const lot = text(vehicle.lot).toUpperCase();
  const vin = text(vehicle.vin).toUpperCase().replace(/[\s-]+/g, "");
  const generation = options.listingGeneration === null || options.listingGeneration === undefined
    ? ""
    : text(options.listingGeneration);
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
    if (!observationKey) throw new TypeError("Niejednoznaczna tożsamość źródła wymaga observationKey.");
    sourceKey = scopedKey("source-observation", provider, platform, observationKey);
    sourceIdentityKind = "unresolved";
    sourceIdentityState = "ambiguous";
  }

  let listingId;
  let listingIdentityKind;
  let listingIdentityState = "resolved";
  if (sourceListingId) {
    listingId = generation
      ? scopedKey("listing", provider, platform, "source", sourceListingId, "generation", generation)
      : scopedKey("listing", provider, platform, "source", sourceListingId);
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

  // Provider/source identity is not proof of a physical vehicle entity.
  // Entity links are only accepted from an explicit trusted reconciliation.
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

function createHistoryEventIdentity(event, listingIdentity, options = {}) {
  if (!event || typeof event !== "object") throw new TypeError("Wymagany jest canonical RexHistoryEvent.");
  if (!listingIdentity || !listingIdentity.provider || !listingIdentity.platform) {
    throw new TypeError("Historia wymaga scope providera/platformy.");
  }
  const eventProvider = text(event.provider).toLowerCase();
  const eventPlatform = event.platform ? normalizedPlatform(event.platform) : "";
  if ((eventProvider && eventProvider !== listingIdentity.provider) ||
      (eventPlatform && eventPlatform !== listingIdentity.platform)) {
    throw new TypeError("Event i listing mają różne scope providera/platformy.");
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

function pathValue(object, path) {
  return path.split(".").reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined, object);
}

function setPath(object, path, value) {
  const parts = path.split(".");
  const key = parts.pop();
  const parent = parts.reduce((node, part) => node[part], object);
  parent[key] = value;
}

/**
 * Missing and null mean "no new fact". Explicit clearing requires an
 * allow-listed source-confirmed path. False and 0 are valid values.
 */
function mergeCanonical(previous, patch, options = {}) {
  if (!previous || typeof previous !== "object" || !patch || typeof patch !== "object") {
    throw new TypeError("Scalanie wymaga dwóch obiektów canonical.");
  }
  const clears = new Set(options.explicitClears || []);
  const missingFields = [];
  const nullFields = [];
  const updatedFields = [];
  const clearedFields = [];

  function mergeNode(oldValue, nextValue, path) {
    if (nextValue === undefined) {
      if (path) missingFields.push(path);
      return oldValue;
    }
    if (nextValue === null || (typeof nextValue === "string" && !nextValue.trim())) {
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
      for (const key of new Set([...Object.keys(result), ...Object.keys(nextValue)])) {
        const childPath = path ? `${path}.${key}` : key;
        if (Object.hasOwn(nextValue, key)) result[key] = mergeNode(result[key], nextValue[key], childPath);
        else missingFields.push(childPath);
      }
      return result;
    }
    if (path) updatedFields.push(path);
    return nextValue;
  }

  const value = mergeNode(previous, patch, "");
  for (const path of clears) {
    if (!pathValue(patch, path) && pathValue(patch, path) !== null) continue;
    if (pathValue(patch, path) === null) setPath(value, path, null);
  }
  return { value, missingFields: [...new Set(missingFields)], nullFields: [...new Set(nullFields)], updatedFields: [...new Set(updatedFields)], clearedFields: [...new Set(clearedFields)] };
}

function withoutNonPersistentData(value, path = []) {
  if (Array.isArray(value)) return value.map(item => withoutNonPersistentData(item, path));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    const pathName = childPath.join(".");
    if (["raw_payload", "raw_json", "raw", "media.items", "media.thumbs"].includes(pathName)) continue;
    result[key] = withoutNonPersistentData(child, childPath);
  }
  if (result.media) result.media = { ...result.media, items: [], thumbs: [] };
  return result;
}

function validTime(value, label) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(time)) throw new TypeError(`${label}: nieprawidłowy czas.`);
  return time;
}

class InMemorySyncRepository {
  constructor() {
    this.sources = new Map();
    this.listings = new Map();
    this.events = new Map();
    this.scopes = new Map();
    this.processedPages = new Map();
  }

  getScope(scopeKey) {
    const scope = this.scopes.get(scopeKey);
    return scope ? structuredClone(scope) : null;
  }

  acquireLease(scopeKey, owner, now, ttlMs) {
    if (!text(scopeKey) || !text(owner) || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("Parametry lease są nieprawidłowe.");
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
    if (!text(scopeKey) || !Array.isArray(records)) throw new TypeError("Strona discovery jest nieprawidłowa.");
    const at = validTime(now, "now");
    const scope = this.scopes.get(scopeKey) || { scopeKey, cursor: null, hasStarted: false, status: "idle", lastCompleteAt: null, lastSuccessAt: null, processedCursorKeys: [], seenCursors: [], leaseOwner: null, leaseExpiresAt: null };
    if (leaseOwner && scope.leaseOwner !== leaseOwner) throw new Error("LEASE_NOT_OWNED");

    const pageKey = cursorKey(cursor);
    const pageMap = this.processedPages.get(scopeKey) || new Map();
    if (pageMap.has(pageKey)) return { replayed: true, inserted: 0, updated: 0, cursor: scope.cursor, complete: scope.status === "complete" };
    const expectedCursor = scope.hasStarted ? scope.cursor : null;
    if (cursor !== expectedCursor) throw new Error("CURSOR_MISMATCH");
    if (nextCursor !== null && nextCursor !== undefined) {
      const next = String(nextCursor);
      if (!next || next === String(cursor ?? "") || scope.seenCursors.includes(next)) throw new Error("REPEATED_CURSOR");
    }

    const prepared = records.map(record => {
      if (!record || !record.identity || !record.vehicle) throw new TypeError("Wpis strony musi zawierać identity i canonical vehicle.");
      const validation = validateRexVehicle(record.vehicle);
      if (!validation.valid) throw new TypeError(`Nieprawidłowy RexVehicle: ${validation.errors.join(",")}`);
      if (!text(record.identity.sourceKey) || !text(record.identity.listingId)) {
        throw new TypeError("Identity musi zawierać stabilny sourceKey i listingId.");
      }
      if (record.identity.provider !== text(record.vehicle.provider).toLowerCase() || record.identity.platform !== normalizedPlatform(record.vehicle.platform)) {
        throw new TypeError("Identity nie odpowiada canonical vehicle.");
      }
      return { identity: record.identity, vehicle: withoutNonPersistentData(record.vehicle) };
    });

    // This fake repository models a crash after row writes but before the
    // cursor commit. Replaying the same opaque page must upsert, not duplicate.
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
    scope.seenCursors = [...new Set([...scope.seenCursors, ...(cursor === null ? [] : [String(cursor)])])];
    if (nextCursor === null || nextCursor === undefined) {
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
    if (!identity?.eventId || !event) throw new TypeError("Identity i event canonical są wymagane.");
    const validation = validateRexHistoryEvent(event);
    if (!validation.valid) throw new TypeError(`Nieprawidłowy RexHistoryEvent: ${validation.errors.join(",")}`);
    const at = validTime(now, "now");
    const safeEvent = withoutNonPersistentData(event);
    const previous = this.events.get(identity.eventId);
    const value = previous ? mergeCanonical(previous.event, safeEvent).value : safeEvent;
    this.events.set(identity.eventId, { identity, event: value, updatedAt: at });
    return { inserted: !previous, updated: Boolean(previous), eventId: identity.eventId };
  }
}

module.exports = {
  createSyncIdentity,
  createHistoryEventIdentity,
  mergeCanonical,
  withoutNonPersistentData,
  InMemorySyncRepository
};
