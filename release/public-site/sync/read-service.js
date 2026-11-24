"use strict";

const {mergeCanonical} = require("./core.js");
const {decideReadSource} = require("./read-policy.js");

async function readDetail({repository, listingId, now, providerFallbackEnabled = false, providerRead = null} = {}) {
  if (!repository || typeof repository.getListingById !== "function") throw new TypeError("D1 read repository is required.");
  const stored = await repository.getListingById(listingId);
  const d1Fresh = Boolean(stored && stored.freshness.status === "fresh");
  const decision = decideReadSource({kind: "detail", d1Exists: Boolean(stored), d1Fresh, providerFallbackEnabled});
  if (decision.source === "d1") return {record: stored, read: {source: "d1", freshness: stored.freshness, fallback_reason: null}};
  if (decision.useProvider && typeof providerRead === "function") {
    try {
      const providerRecord = await providerRead();
      if (providerRecord) {
        if (stored) return {record: {...stored, vehicle: mergeCanonical(stored.vehicle, providerRecord).value},
          read: {source: "hybrid", freshness: stored.freshness, fallback_reason: decision.reason}};
        return {record: {vehicle: providerRecord}, read: {source: "provider", freshness: {status: "unknown"}, fallback_reason: decision.reason}};
      }
    } catch { /* retain D1 as stale fallback below; do not erase known data */ }
  }
  if (stored) return {record: stored, read: {source: "d1", freshness: stored.freshness,
    fallback_reason: decision.useProvider ? "provider_unavailable_stale_d1_retained" : decision.reason}};
  return {record: null, read: {source: "unavailable", freshness: {status: "unknown"}, fallback_reason: decision.reason}};
}

module.exports = {readDetail};
