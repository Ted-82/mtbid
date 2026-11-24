"use strict";

/** Decide a source without performing any provider request. The caller owns the
 * explicit provider callback/budget. Incomplete catalog coverage is never
 * labelled complete D1 data. */
function decideReadSource({kind, d1Exists = false, d1Fresh = false, scopeComplete = false,
  providerFallbackEnabled = false} = {}) {
  if (!new Set(["catalog", "detail", "history", "filters"]).has(kind)) throw new TypeError("Nieznany typ odczytu.");
  if (kind === "catalog" || kind === "filters") {
    if (d1Exists && scopeComplete) return {source: "d1", useD1: true, useProvider: false, complete: true, reason: null};
    if (providerFallbackEnabled) return {source: "provider", useD1: false, useProvider: true, complete: null,
      reason: d1Exists ? "d1_scope_partial" : "d1_scope_missing"};
    return {source: d1Exists ? "d1" : "unavailable", useD1: d1Exists, useProvider: false,
      complete: false, reason: d1Exists ? "d1_scope_partial" : "d1_unavailable"};
  }
  if (d1Exists && d1Fresh) return {source: "d1", useD1: true, useProvider: false, complete: null, reason: null};
  if (providerFallbackEnabled) return {source: "provider", useD1: false, useProvider: true, complete: null,
    reason: d1Exists ? "d1_stale" : "d1_record_missing"};
  return {source: d1Exists ? "d1" : "unavailable", useD1: d1Exists, useProvider: false,
    complete: null, reason: d1Exists ? "provider_fallback_disabled_stale_d1" : "d1_record_missing"};
}

function labelHybridRead({d1Used, providerUsed}) {
  if (d1Used && providerUsed) return "hybrid";
  if (d1Used) return "d1";
  if (providerUsed) return "provider";
  return "unavailable";
}

module.exports = {decideReadSource, labelHybridRead};
