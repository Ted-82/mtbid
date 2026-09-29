"use strict";

const {createSyncIdentity} = require("./core.js");
const {planFreshness} = require("./planning.js");
const {validateRexVehicle} = require("../providers/contract.js");

/** Provider-neutral translation of one already-fetched listing page. */
function canonicalizeDiscoveryPage({provider, response, scopeKey, platform, cursor = null, now, freshnessPolicy}) {
  if (!provider || typeof provider.vehicleListRecords !== "function" || typeof provider.toCanonicalVehicle !== "function") {
    throw new TypeError("Discovery wymaga adaptera provider contract.");
  }
  if (!scopeKey || !platform || !Number.isFinite(new Date(now).getTime())) throw new TypeError("Discovery scope/platform/now są wymagane.");
  const rawRecords = provider.vehicleListRecords(response);
  const meta = provider.responseMeta(response) || {};
  const nextCursor = meta.next_cursor ?? null;
  const records = [];
  let rejected = 0;
  let ambiguous = 0;
  for (let index = 0; index < rawRecords.length; index += 1) {
    const raw = rawRecords[index];
    try {
      const normalized = provider.normalizeVehicle(raw);
      if (!normalized) { rejected += 1; continue; }
      const vehicle = provider.toCanonicalVehicle(raw, normalized);
      const validation = validateRexVehicle(vehicle);
      if (!validation.valid || vehicle.provider !== provider.id || vehicle.platform !== platform) { rejected += 1; continue; }
      const observationKey = `${scopeKey}:${cursor === null ? "first" : String(cursor)}:${index}`;
      const identity = createSyncIdentity(vehicle, {observationKey});
      if (identity.listingIdentityState === "ambiguous" || identity.sourceIdentityState === "ambiguous") ambiguous += 1;
      const freshness = planFreshness(vehicle, new Date(now).getTime(), freshnessPolicy);
      records.push({
        identity,
        vehicle,
        fingerprint: normalized.fingerprint || provider.fingerprintNormalizedVehicle?.(normalized) || null,
        freshnessClass: freshness.freshnessClass.toLowerCase(),
        nextRefreshAt: new Date(freshness.nextRefreshAt).toISOString()
      });
    } catch {
      rejected += 1;
    }
  }
  return Object.freeze({
    providerRecords: rawRecords.length,
    accepted: records.length,
    rejected,
    ambiguous,
    records,
    nextCursor
  });
}

module.exports = {canonicalizeDiscoveryPage};
