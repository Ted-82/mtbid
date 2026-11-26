"use strict";

// Source: Apibara VehicleChangeEvent, AuctionInfo and PricingInfo in
// https://apibara.tech/openapi/v1.json and the database-sync guide. This module
// plans partial UPDATEs only. It never builds a full vehicle observation.
const EVENTS = new Set(["lot.created", "lot.updated", "lot.sold", "lot.not_sold", "lot.removed",
  "auction.rescheduled", "auction.ended", "bid.changed", "buy_now.changed", "reserve.changed"]);
const TERMINAL = Object.freeze({"lot.sold": "Sold", "lot.not_sold": "Not Sold", "lot.removed": "Removed"});
const PRICES = Object.freeze({"pricing.current_bid_usd": "current_bid_usd",
  "pricing.current_bid2_usd": "current_bid2_usd", "pricing.buy_now_usd": "buy_now_usd"});
// Explicitly nonpersistent metadata: previous_bid is NOT current_bid2 or a
// final sale price. It accompanies ordinary bid events in the observed beta2
// feed. These fields never cause a detail fetch by themselves.
const IGNORED = Object.freeze({"pricing.previous_bid_usd": "price", "pricing.current_bid_at": "time",
  "auction.last_sold_day": "day", "auction.last_sold_at": "time", "auction.auction_ended_at": "time",
  "auction.outcome_observed_at": "time", "auction.sold_buy_now": "boolean", "auction.sold_timed": "boolean",
  // These auxiliary fields are not stored/consumed by REXBID. The provider's
  // upcoming selector explicitly does NOT override Open/Sold state logic.
  // source_sale_type is a raw source label, not a normalized auction state.
  // Never infer availability, a new date, or freshness from either value.
  "auction.upcoming": "boolean", "details.source_sale_type": "text"});
const BASELINE_FIELDS = Object.freeze(["listing_id", "source_key", "platform", "lot", "vin_normalized", "identity_state",
  "source_updated_at", "summary_synced_at", "detail_synced_at", "last_seen_at", "updated_at",
  "auction_state", "source_status", "auction_at", "is_timed", "timed_end_at",
  "current_bid_usd", "current_bid2_usd", "buy_now_usd"]);
const OWN = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.length > 0 && value.length <= 1000 && !/[\u0000-\u001f]/.test(value);
const fail = code => { throw new Error(code); };
const invalid = () => fail("INVENTORY_CHANGE_PATCH_INVALID");

function time(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return Date.parse(value);
}
function checkValue(value, kind) {
  if (value === null) return null;
  if (kind === "price") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) invalid();
    return value;
  }
  if (kind === "time") {
    if (!Number.isFinite(time(value))) invalid();
    return new Date(value).toISOString();
  }
  if (kind === "boolean") {
    // Actual Sync Center files serialize these flags as integer 0/1. Keep the
    // accepted domain narrow: no strings or truthy values such as 2.
    if (typeof value !== "boolean" && value !== 0 && value !== 1) invalid();
    return value ? 1 : 0;
  }
  if (kind === "day") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time(`${value}T00:00:00Z`))) invalid();
    return value;
  }
  if (!text(value)) invalid();
  return value;
}
function normalizedState(value) {
  if (value === null) return {state: null, source: null};
  const normalized = checkValue(value, "text").toLowerCase().replace(/[_-]+/g, " ").trim();
  if (["active", "open", "prebid", "pre bid", "scheduled"].includes(normalized)) return {state: "open", source: "Open"};
  if (["live", "running", "in progress", "started"].includes(normalized)) return {state: "live", source: "Live"};
  if (["ended", "closed", "finished", "completed", "cancelled", "canceled", "withdrawn"].includes(normalized)) return {state: "ended", source: "Ended"};
  if (["sold", "not sold", "removed", "sold on approval"].includes(normalized)) {
    return {state: "ended", source: {sold: "Sold", "not sold": "Not Sold", removed: "Removed", "sold on approval": "Sold on Approval"}[normalized]};
  }
  if (["upcoming", "future", "unassigned", "not assigned", "not scheduled"].includes(normalized)) return {state: normalized, source: value};
  if (["timed", "timed auction"].includes(normalized)) return {state: "timed", source: "Timed"};
  if (normalized === "unknown") return {state: "unknown", source: "unknown"};
  return undefined;
}

/** Pure plan. Caller must commit EXISTS(match.sql), statement, event ID, any
 * required detail job and stream checkpoint in ONE guarded transaction.
 * A zero-row conditional UPDATE alone is not permission to commit a cursor.
 * Update a batch's in-memory row with assignments before planning its next event.
 */
function prepareInventoryChangePatch({row, change, observedAt, lastAppliedSequence = null} = {}) {
  if (!object(change) || change.provider !== "apibara" || !EVENTS.has(change.eventType)
      || !Number.isSafeInteger(change.sequence) || change.sequence < 1 || !text(change.eventId)
      || !["copart", "iaai"].includes(change.platform) || typeof change.lotNumber !== "string" || !/^\d{1,20}$/.test(change.lotNumber)
      || typeof change.terminal !== "boolean" || change.terminal !== OWN(TERMINAL, change.eventType)
      || !Array.isArray(change.changedFields) || !change.changedFields.every(text)
      || !object(change.before) || !object(change.after)
      || change.vin != null && !text(change.vin)) invalid();
  const observedTime = time(observedAt), recordedTime = time(change.recordedAt);
  const sourceTime = change.vehicleUpdatedAt == null ? null : time(change.vehicleUpdatedAt);
  if (!Number.isFinite(observedTime) || !Number.isFinite(recordedTime) || recordedTime > observedTime
      || sourceTime !== null && (!Number.isFinite(sourceTime) || sourceTime > observedTime)) fail("INVENTORY_CHANGE_TIME_INVALID");
  if (lastAppliedSequence !== null && (!Number.isSafeInteger(lastAppliedSequence) || lastAppliedSequence < 0)) invalid();
  const base = {eventId: change.eventId, sequence: change.sequence, platform: change.platform, lotNumber: change.lotNumber,
    status: "ignored", reason: null, requiresDetail: false, unsupportedFields: [], ignoredFields: [],
    assignments: {}, statement: null, match: null, baseline: null};
  const detail = reason => ({...base, status: "requires_detail", reason, requiresDetail: true});
  if (lastAppliedSequence !== null && change.sequence <= lastAppliedSequence) return {...base, reason: "already_applied_sequence"};
  if (row === null || row === undefined) return detail("unknown_lot");
  if (!object(row) || !text(row.listing_id) || !text(row.source_key) || BASELINE_FIELDS.some(field => !OWN(row, field))) fail("INVENTORY_CHANGE_BASELINE_INVALID");
  if (row.platform !== change.platform || row.lot !== change.lotNumber || row.provider != null && row.provider !== "apibara") fail("INVENTORY_CHANGE_IDENTITY_CONFLICT");
  if (row.identity_state !== "resolved") return detail("unresolved_listing_identity");
  const vin = value => typeof value === "string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(value.toUpperCase()) ? value.toUpperCase() : null;
  const knownVin = vin(row.vin_normalized), eventVin = vin(change.vin);
  if (knownVin && eventVin && knownVin !== eventVin) fail("INVENTORY_CHANGE_IDENTITY_CONFLICT");
  if (!knownVin || change.vin != null && !eventVin) return detail("unverified_vin");
  for (const field of ["source_updated_at", "summary_synced_at", "detail_synced_at", "last_seen_at", "updated_at"]) {
    if (row[field] !== null && !Number.isFinite(time(row[field]))) fail("INVENTORY_CHANGE_BASELINE_INVALID");
  }
  if ([row.summary_synced_at, row.detail_synced_at, row.last_seen_at].some(value => value !== null && time(value) >= recordedTime)) {
    return {...base, reason: "older_observation"};
  }
  if (sourceTime !== null && row.source_updated_at !== null && time(row.source_updated_at) > sourceTime) {
    return {...base, reason: "older_source_version"};
  }

  const values = {}, unsupported = new Set(), ignored = new Set(), states = [];
  let explicitMode = false, scheduleChanged = false, buyNowDisabled = false, datePending = null;
  const fields = new Set([...change.changedFields, ...Object.keys(change.after)]);
  for (const field of fields) {
    if (OWN(IGNORED, field)) {
      if (OWN(change.before, field)) checkValue(change.before[field], IGNORED[field]);
      if (OWN(change.after, field)) checkValue(change.after[field], IGNORED[field]);
      ignored.add(field); continue;
    }
    if (!OWN(change.after, field)) { unsupported.add(field); continue; }
    const value = change.after[field];
    if (OWN(PRICES, field)) {
      const hasBefore = OWN(change.before, field);
      const beforePrice = hasBefore ? checkValue(change.before[field], "price") : undefined;
      const price = checkValue(value, "price");
      // Apibara PricingInfo defines an unavailable/zero primary bid as NULL.
      // Preserve the raw event and its proof; normalize only this assignment.
      // Explicit empty->empty source noise is not a reset of a saved positive
      // bid. A positive->empty transition (or absent before) remains a clear.
      if (field === "pricing.current_bid_usd" && hasBefore && (beforePrice === null || beforePrice === 0)
          && (price === null || price === 0) && row.current_bid_usd !== 0) {
        ignored.add(field); continue;
      }
      values[PRICES[field]] = field === "pricing.current_bid_usd" && price === 0 ? null : price;
    } else if (["auction.state", "auction.lot_sub_status", "auction.outcome_status"].includes(field)) {
      const status = normalizedState(value);
      if (status === undefined) unsupported.add(field);
      else if (field === "auction.outcome_status" && value === null) {
        // Clearing an outcome is not sufficient evidence of a reopened lot.
        unsupported.add(field);
      } else states.push({...status, field});
    } else if (field === "auction.lot_removed") {
      const removed = checkValue(value, "boolean");
      if (removed === 1) states.push({state: "ended", source: "Removed", field});
      else if (removed !== 0) invalid();
      else ignored.add(field); // false alone does not prove an active auction.
    } else if (field === "auction.is_buy_now") {
      if (OWN(change.before, field)) checkValue(change.before[field], "boolean");
      const enabled = checkValue(value, "boolean");
      if (enabled === 0) buyNowDisabled = true;
      else if (enabled === 1) ignored.add(field); // a flag alone supplies no price or proof of reopening.
      else unsupported.add(field);
    } else if (field === "auction.lot_status") {
      checkValue(value, "text");
      if (value === "Timed") { values.is_timed = 1; explicitMode = true; }
      else if (value === "Buy Now" || value === "All") { values.is_timed = 0; explicitMode = true; }
      else unsupported.add(field);
    } else if (field === "auction.is_timed") {
      values.is_timed = checkValue(value, "boolean"); explicitMode = true;
    } else if (field === "auction.auction_date_pending" && change.eventType === "auction.rescheduled") {
      datePending = checkValue(value, "boolean");
    } else if (field === "auction.auction_at" || field === "auction.timed_end_at") {
      // The file's local-looking time has no offset. Keep the known date and
      // queue reconciliation; other independently valid fields may still apply.
      // Appending Z here validates the calendar only, never assigns a timezone.
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)
          && Number.isFinite(time(value.replace(' ', 'T') + 'Z'))) {unsupported.add(field); continue;}
      values[field === "auction.auction_at" ? "auction_at" : "timed_end_at"] = checkValue(value, "time");
      scheduleChanged = true;
    } else unsupported.add(field);
  }
  if (buyNowDisabled) values.buy_now_usd = null;
  base.unsupportedFields = [...unsupported].sort();
  base.ignoredFields = [...ignored].sort();
  if (change.terminal) states.push({state: "ended", source: TERMINAL[change.eventType], field: "terminal"});
  else if (change.eventType === "auction.ended") states.push({state: "ended", source: "Ended", field: "event"});
  if (new Set(states.filter(entry => entry.state !== null).map(entry => entry.state)).size > 1) return detail("conflicting_auction_state");
  const terminalStates = states.filter(entry => ["Sold", "Not Sold", "Removed", "Sold on Approval"].includes(entry.source));
  if (new Set(terminalStates.map(entry => entry.source)).size > 1) return detail("conflicting_auction_outcome");
  const state = terminalStates.at(-1) || states.find(entry => entry.field === "auction.outcome_status")
    || states.find(entry => entry.field === "auction.lot_sub_status") || states.at(-1);
  if (state) {
    values.auction_state = state.state;
    values.source_status = state.source;
    if (!explicitMode && state.state !== null) values.is_timed = state.state === "timed" ? 1 : 0;
  }
  const nextState = OWN(values, "auction_state") ? values.auction_state : row.auction_state;
  if (nextState === "ended" && (state || change.terminal)) {
    values.buy_now_usd = null; values.auction_at = null; values.timed_end_at = null; values.is_timed = 0;
  } else if (state?.state === "live") {
    values.auction_at = null; values.timed_end_at = null;
  } else if (values.is_timed === 1) values.auction_at = null;
  else if (state && change.platform === "copart" && ["upcoming", "future", "unassigned", "not assigned", "not scheduled"].includes(state.state)) {
    values.auction_at = null; values.timed_end_at = null;
  } else if (scheduleChanged && ["ended", "sold", "not_sold", "removed", "closed"].includes(nextState)) {
    return detail("schedule_on_inactive_lot");
  }
  if (change.eventType === "auction.rescheduled" && !change.terminal && nextState === "open" && !state) {
    // A date-only event can leave the old source label "unscheduled" in place.
    // Promote only an explicit, valid date assignment for the same open lot.
    if (datePending === 0 && values.auction_at && Date.parse(values.auction_at) >= recordedTime
        && /^(?:unscheduled|unassigned|upcoming|future|not assigned|not scheduled|auction not assigned)(?: lot| sale)?$/i.test(row.source_status || "")) {
      values.source_status = "Open";
    } else if (datePending === 1 && values.auction_at === null && !row.is_timed) {
      values.source_status = "unscheduled";
    } else if (datePending !== null && (datePending === 0 ? !values.auction_at : values.auction_at !== null)) {
      unsupported.add("auction.auction_date_pending");
    }
  }
  // No record freshness/source/fingerprint timestamps are changed by an event.
  // The stream consumer separately persists its sequence and recordedAt.
  const assignments = Object.fromEntries(Object.entries(values).filter(([column, value]) => row[column] !== value));
  const columns = Object.keys(assignments);
  base.unsupportedFields = [...unsupported].sort();
  base.requiresDetail = unsupported.size > 0;
  if (columns.length === 0) return {...base, status: base.requiresDetail ? "requires_detail" : "ignored",
    reason: base.requiresDetail ? "unsupported_fields" : "no_material_change"};
  const baseline = Object.fromEntries(BASELINE_FIELDS.map(field => [field, row[field]]));
  const where = `${BASELINE_FIELDS.map(field => `${field} IS ?`).join(" AND ")}
    AND (SELECT COUNT(*) FROM auction_listings candidate WHERE candidate.platform=? AND candidate.lot=?)=1
    AND EXISTS(SELECT 1 FROM vehicle_sources source WHERE source.source_key=auction_listings.source_key
      AND source.provider='apibara' AND source.platform=auction_listings.platform)`;
  const whereParams = [...Object.values(baseline), change.platform, change.lotNumber];
  return {...base, status: "patch", reason: base.requiresDetail ? "partial_patch_requires_detail" : "supported_fields",
    assignments, baseline,
    match: {sql: `SELECT listing_id FROM auction_listings WHERE ${where}`, params: [...whereParams]},
    statement: {sql: `UPDATE auction_listings SET ${columns.map(column => `${column}=?`).join(",")} WHERE ${where}`,
      params: [...Object.values(assignments), ...whereParams]}};
}

module.exports = {prepareInventoryChangePatch, BASELINE_FIELDS};
