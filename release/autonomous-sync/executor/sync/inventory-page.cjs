"use strict";

const {prepareObservation} = require("./publication-refresh.cjs");

const PLATFORMS = new Set(["copart", "iaai"]);
const MAX_PAGE_RECORDS = 20;
const RECORD_ERRORS = new Set([
  "AUTOMATIC_REFRESH_IDENTITY_MISMATCH", "AUTOMATIC_REFRESH_IDENTITY_INVALID",
  "CANONICAL_IDENTITY_INVALID", "NEGATIVE_PROVIDER_PRICE", "SOURCE_VERSION_TIME_INVALID",
  "DETAIL_TARGET_MISMATCH", "AMBIGUOUS_PLATFORM_LOT", "KNOWN_TARGET_CHANGED",
  "PLATFORM_LOT_VIN_MISMATCH", "OBSERVATION_TIME_REQUIRED", "OBSERVATION_TIME_INVALID",
  "FUTURE_OBSERVATION_REJECTED"
]);
const keyOf = (platform, lot) => `${platform}:${lot}`;
const fullVin = value => /^[A-HJ-NPR-Z0-9]{17}$/.test(String(value || "").toUpperCase());

function identityOf(raw) {
  const platform = typeof raw?.platform === "string" ? raw.platform.toLowerCase() : "";
  const value = raw?.lot_number ?? raw?.lot;
  const lot = ["string", "number"].includes(typeof value) ? String(value) : "";
  // Only recognized public identifiers can appear in rejection diagnostics.
  return {platform: PLATFORMS.has(platform) ? platform : null,
    lot: /^\d{1,20}$/.test(lot) ? lot : null};
}

function assertExistingIdentity(raw, row) {
  // Keep the strict saved-lot VIN guard used by saveAutomaticObservation.
  // A missing or newly masked VIN cannot silently replace an identified car.
  const known = String(row.vin_normalized || "").toUpperCase();
  const vin = String(raw.vin || "").toUpperCase();
  if (known && (!vin || known.length !== vin.length || [...known]
    .some((character, index) => /[A-HJ-NPR-Z0-9]/.test(character) && character !== vin[index]))) {
    throw Error("AUTOMATIC_REFRESH_IDENTITY_MISMATCH");
  }
}

/**
 * Prepare one already-obtained Basic-plan inventory page. The only I/O is one
 * SELECT for existing platform + LOT pairs; there is no transport or persistence.
 * Existing rows match D1SyncRepository.findListingsByLot (same columns/order).
 * Callers must fence writes against concurrent changes: previous is the observed
 * database baseline, not a lock or permission to overwrite a newer observation.
 */
async function prepareInventoryPage({db, provider, records, platform = null,
  observedAt, processedAt, freshnessPolicy, observationTimeBasis = 'capture'} = {}) {
  if (!['capture', 'source_updated_at'].includes(observationTimeBasis)) throw Error('INVENTORY_PAGE_TIME_BASIS_INVALID');
  if (!Array.isArray(records) || records.length > MAX_PAGE_RECORDS) throw Error("INVENTORY_PAGE_SIZE_INVALID");
  if (platform !== null && !PLATFORMS.has(platform)) throw Error("INVENTORY_PAGE_PLATFORM_INVALID");
  if (!db?.prepare || typeof provider?.normalizeVehicle !== "function"
      || typeof provider?.toCanonicalVehicle !== "function") throw Error("INVENTORY_PAGE_DEPENDENCY_INVALID");
  const result = {prepared: [], rejected: [], skipped: []};
  const entries = records.map(raw => ({raw, ...identityOf(raw)}));
  const counts = new Map();
  for (const entry of entries) {
    if (entry.platform && entry.lot && (!platform || platform === entry.platform)) {
      const key = keyOf(entry.platform, entry.lot);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const candidates = entries.filter(entry => entry.platform && entry.lot
    && (!platform || platform === entry.platform) && counts.get(keyOf(entry.platform, entry.lot)) === 1);
  const rowsByKey = new Map();
  if (candidates.length) {
    let response;
    try {
      response = await db.prepare(`SELECT * FROM auction_listings WHERE ${candidates.map(() => "(platform=? AND lot=?)").join(" OR ")}
        ORDER BY last_seen_at DESC,listing_id`).bind(...candidates.flatMap(entry => [entry.platform, entry.lot])).all();
    } catch {
      // A failed read is not an empty database and must never create new rows.
      throw Error("INVENTORY_PAGE_READ_FAILED");
    }
    if (!Array.isArray(response?.results)) throw Error("INVENTORY_PAGE_READ_FAILED");
    for (const row of response.results) {
      const key = keyOf(row.platform, row.lot);
      const matches = rowsByKey.get(key) || [];
      matches.push(row); rowsByKey.set(key, matches);
    }
  }
  const repo = {async findListingsByLot({platform: selectedPlatform, lot, limit = 2}) {
    return {results: (rowsByKey.get(keyOf(selectedPlatform, lot)) || []).slice(0, limit)};
  }};
  for (const entry of entries) {
    const diagnostic = {platform: entry.platform, lot: entry.lot};
    if (!entry.platform || !entry.lot) {
      result.rejected.push({...diagnostic, code: "AUTOMATIC_REFRESH_IDENTITY_INVALID"}); continue;
    }
    if (platform && entry.platform !== platform) {
      result.rejected.push({...diagnostic, code: "AUTOMATIC_REFRESH_IDENTITY_MISMATCH"}); continue;
    }
    if (counts.get(keyOf(entry.platform, entry.lot)) > 1) {
      // Reject every copy, including the first: conflicting duplicate prices
      // must not be resolved by whichever duplicate happens to appear first.
      result.rejected.push({...diagnostic, code: "AUTOMATIC_REFRESH_DUPLICATE_PAGE_IDENTITY"}); continue;
    }
    const matches = rowsByKey.get(keyOf(entry.platform, entry.lot)) || [];
    try {
      if (matches.length > 1) throw Error("AMBIGUOUS_PLATFORM_LOT");
      const previous = matches[0] || null;
      if (previous) assertExistingIdentity(entry.raw, previous);
      let recordObservedAt = observedAt;
      if (observationTimeBasis === 'source_updated_at') {
        const sourceTime = entry.raw.updated_at;
        if (typeof sourceTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(sourceTime)
            || !Number.isFinite(Date.parse(sourceTime)) || !Number.isFinite(Date.parse(observedAt))) throw Error('OBSERVATION_TIME_INVALID');
        recordObservedAt = new Date(sourceTime).toISOString();
        if (recordObservedAt.slice(0,19) !== sourceTime.slice(0,19)) throw Error('OBSERVATION_TIME_INVALID');
        // A file without capture metadata can conservatively retain EACH
        // source version's time. The file maximum is only an upper bound.
        if (Date.parse(recordObservedAt) > Date.parse(observedAt)) throw Error('FUTURE_OBSERVATION_REJECTED');
      }
      const prepared = await prepareObservation({repo, provider, raw: entry.raw,
        platform: entry.platform, observedAt: recordObservedAt, processedAt, freshnessPolicy});
      if (prepared.skipped) {
        result.skipped.push({...diagnostic, code: prepared.skipped}); continue;
      }
      if (String(prepared.record.vehicle.lot) !== entry.lot) throw Error("CANONICAL_IDENTITY_INVALID");
      if (prepared.inserted && (!fullVin(prepared.record.vehicle.vin)
          || prepared.record.identity.sourceIdentityState !== "resolved"
          || prepared.record.identity.listingIdentityState !== "resolved")) {
        throw Error("AUTOMATIC_REFRESH_IDENTITY_INVALID");
      }
      result.prepared.push({...prepared, previous});
    } catch (error) {
      const code = error?.code || error?.message;
      result.rejected.push({...diagnostic, code: RECORD_ERRORS.has(code) ? code : "INVENTORY_OBSERVATION_INVALID"});
    }
  }
  // A source identifies the provider's vehicle, while each LOT is a separate
  // auction. Relists may share a source only with matching complete VINs.
  // Conflicting/unknown identity evidence must not depend on write order.
  const sourceKeys = new Map(), listingKeys = new Map();
  for (const item of result.prepared) {
    const {sourceKey, listingId} = item.record.identity;
    sourceKeys.set(sourceKey, [...(sourceKeys.get(sourceKey) || []), item]);
    listingKeys.set(listingId, (listingKeys.get(listingId) || 0) + 1);
  }
  result.prepared = result.prepared.filter(item => {
    const identity = item.record.identity;
    const shared = sourceKeys.get(identity.sourceKey), vehicle = item.record.vehicle;
    const conflictingSource = shared.length > 1 && (!fullVin(vehicle.vin)
      || shared.some(other => other.record.vehicle.platform !== vehicle.platform || other.record.vehicle.vin !== vehicle.vin));
    if (conflictingSource || listingKeys.get(identity.listingId) > 1) {
      result.rejected.push({platform: item.record.vehicle.platform, lot: item.record.vehicle.lot,
        code: "INVENTORY_PAGE_CANONICAL_IDENTITY_COLLISION"});
      return false;
    }
    return true;
  });
  return result;
}

module.exports = {MAX_PAGE_RECORDS, prepareInventoryPage};
