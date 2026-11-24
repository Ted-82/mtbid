"use strict";

const {createSyncIdentity, mergeCanonical, withoutNonPersistentData} = require("./core.js");
const {D1SyncRepository} = require("./d1-repository.js");
const {canonicalVehicle} = require("./d1-read-repository.js");
const {validateRexVehicle, classifyAuctionSchedule} = require("../providers/contract.js");
const {planFreshness} = require("./planning.js");

const PUBLICATION_DB = Object.freeze({name: "rexbid-production-preflight-db", id: "c8a30088-70af-43a6-9a7f-c4018279d37d"});
const MAX_PUBLICATION_REQUESTS = 1000;
const PLATFORMS = Object.freeze(["copart", "iaai"]);
const RETRYABLE = new Set(["RATE_LIMITED", "TIMEOUT", "UPSTREAM"]);
const ENDED = /^(sold|not[_ -]?sold|ended|finished|closed|completed|cancelled|canceled|withdrawn|unsold|no[_ -]?sale)$/i;
const ACTIVE = /^(active|open|live|running|in[_ -]?progress|started|pre[_ -]?bid|scheduled|upcoming|future|timed|timed auction|buy[_ ]now)$/i;

function stamp(value) {
  if (value === null || value === undefined || value === "") throw new Error("OBSERVATION_TIME_REQUIRED");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("OBSERVATION_TIME_INVALID");
  return date.toISOString();
}
function safeCode(error) {
  const code = String(error?.code || error?.message || "REFRESH_FAILED");
  return /^[A-Z][A-Z0-9_]{1,70}$/.test(code) ? code : "REFRESH_FAILED";
}
function availabilityOf(vehicle, raw = {}) {
  const auction = vehicle?.auction || {};
  const values = [auction.state, auction.source_status, raw.auction?.lot_status, raw.auction?.lot_sub_status,
    raw.lot_status, raw.lot_sub_status].map(value => String(value ?? "").trim());
  // A past timestamp, price or disappearance from a discovery page never proves a sale.
  if (values.some(value => ENDED.test(value))) return {status: "ended", reason: "explicit_terminal_source_status"};
  if ([auction.state, auction.source_status].some(value => /^(unknown|conflict)$/i.test(String(value || "")))) return {status: "unknown", reason: "explicit_unknown_source_status"};
  if (values.some(value => ACTIVE.test(value))) return {status: "active", reason: "explicit_available_source_status"};
  return {status: "unknown", reason: "source_did_not_confirm_availability"};
}
function assertIsolatedTarget(target) {
  if (target?.name !== PUBLICATION_DB.name || target?.id !== PUBLICATION_DB.id) throw new Error("PUBLICATION_TARGET_REQUIRED");
}
function validateApproval(approval, platform) {
  if (approval?.approved !== true || !/^[a-z0-9-]{1,70}$/.test(String(approval?.campaignId || ""))) throw new Error("OWNER_REQUEST_BUDGET_APPROVAL_REQUIRED");
  const total = approval.totalRequests;
  const own = approval.platformRequests?.[platform];
  if (!Number.isSafeInteger(total) || total < 1 || total > MAX_PUBLICATION_REQUESTS || !Number.isSafeInteger(own) || own < 1 || own > total) throw new Error("INVALID_APPROVED_BUDGET");
  const attempts = approval.maxAttempts ?? 1;
  if (![1, 2].includes(attempts)) throw new Error("INVALID_ATTEMPT_LIMIT");
  return {total, own, attempts};
}
async function targetHash(targets) {
  const bytes = new TextEncoder().encode(JSON.stringify(targets));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
function existingIdentity(row, vehicle) {
  const proposed = createSyncIdentity(vehicle, {observationKey: "publication-observation"});
  return row ? {...proposed, sourceKey: row.source_key, listingId: row.listing_id,
    sourceListingId: row.source_listing_id, listingGeneration: row.listing_generation,
    listingIdentityKind: row.listing_identity_kind, listingIdentityState: row.identity_state} : proposed;
}
function normalizedObservationVin(value) {
  // Match identity normalization, while treating the provider's explicit
  // missing-VIN sentinel as absent. Preserve masked and short source IDs.
  const vin = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "");
  return vin && vin !== "NOVIN" ? vin : null;
}
function fullVin(value) {
  const vin = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "");
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

/** Only translates an already obtained response. Never fetches media or history. */
async function prepareObservation({repo, provider, raw, platform, observedAt, processedAt, knownTarget = null, freshnessPolicy}) {
  const observationTime = stamp(observedAt);
  if (Date.parse(observationTime) > Date.parse(stamp(processedAt))) throw new Error("FUTURE_OBSERVATION_REJECTED");
  const normalized = provider.normalizeVehicle(raw);
  const vehicle = provider.toCanonicalVehicle(raw, normalized);
  if (!validateRexVehicle(vehicle).valid || vehicle.provider !== "apibara" || vehicle.platform !== platform || !vehicle.lot) throw new Error("CANONICAL_IDENTITY_INVALID");
  // A negative amount is an unsafe response, including untouched numeric
  // strings in enrichment fields. A genuinely observed zero is valid.
  if (["current_bid", "current_bid_secondary", "buy_now", "final_price", "source_price"].some(field => {
    const value = vehicle.pricing[field];
    return (typeof value === "number" || typeof value === "string" && value.trim() !== "")
      && Number.isFinite(Number(value)) && Number(value) < 0;
  })) throw new Error("NEGATIVE_PROVIDER_PRICE");
  if (vehicle.source_updated_at && (!Number.isFinite(Date.parse(vehicle.source_updated_at)) || Date.parse(vehicle.source_updated_at) > Date.parse(observationTime))) throw new Error("SOURCE_VERSION_TIME_INVALID");
  if (knownTarget && String(vehicle.lot).toUpperCase() !== String(knownTarget.lot).toUpperCase()) throw new Error("DETAIL_TARGET_MISMATCH");
  const rows = (await repo.findListingsByLot({platform, lot: vehicle.lot, limit: 2})).results || [];
  if (rows.length > 1) throw new Error("AMBIGUOUS_PLATFORM_LOT");
  const row = rows[0] || null;
  if (knownTarget && (!row || row.listing_id !== knownTarget.listingId)) throw new Error("KNOWN_TARGET_CHANGED");
  const knownVin = fullVin(row?.vin_normalized), observedVin = fullVin(vehicle.vin);
  // Platform + LOT is the update key, but a reused LOT must never overwrite a
  // different identified vehicle. Missing or masked VINs are partial evidence.
  if (knownVin && observedVin && knownVin !== observedVin) throw new Error("PLATFORM_LOT_VIN_MISMATCH");
  if (row && [row.summary_synced_at || row.last_seen_at, row.detail_synced_at]
    .some(value => Date.parse(value) > Date.parse(observationTime))) return {skipped: "older_observation"};
  if (row && vehicle.source_updated_at && row.source_updated_at && Date.parse(vehicle.source_updated_at) < Date.parse(row.source_updated_at)) return {skipped: "older_source_version"};
  const availability = availabilityOf(vehicle, raw);
  const explicitClears = [];
  const patch = withoutNonPersistentData(vehicle);
  if (/approval|not.?sold|no.?sale|unsold/i.test(patch.auction.source_status || "")) {
    patch.pricing.final_price = null;
    explicitClears.push("pricing.final_price");
  }
  patch.vin = knownVin && !observedVin ? knownVin : normalizedObservationVin(patch.vin);
  // These fields are volatile observations, unlike seller/specification/media
  // enrichment. Missing prices in a new response cannot be carried forward
  // under a new capture time. Their old values remain in previous snapshots.
  for (const field of ["current_bid", "current_bid_secondary", "buy_now"]) {
    // Canonical prices are numbers. In particular, an adapter's untouched
    // secondary-bid string/object must not preserve yesterday's numeric bid.
    // Zero remains an explicitly observed value; malformed values are unknown.
    if (!Number.isFinite(patch.pricing[field])) {
      patch.pricing[field] = null;
      explicitClears.push(`pricing.${field}`);
    }
  }
  if (availability.status === "active") {
    // An explicit Open/Active observation must not inherit an old Sold state
    // merely because the provider placed its status in another supported field.
    patch.auction.state ||= "active";
    patch.auction.source_status ||= String(raw.auction?.lot_status || raw.auction?.lot_sub_status || raw.lot_status || raw.lot_sub_status || patch.auction.state);
  }
  if (availability.status === "unknown") {
    // Preserve descriptive/history data, but never carry old actionable availability
    // into a newly obtained response that cannot confirm it.
    patch.auction.state = "unknown"; patch.auction.source_status = "unknown";
    patch.auction.auction_at = null; patch.auction.timed_end_at = null; patch.auction.timed = false;
    patch.pricing.buy_now = null;
    explicitClears.push("auction.auction_at", "auction.timed_end_at", "pricing.buy_now");
  } else if (availability.status === "ended") {
    patch.auction.state = ENDED.test(patch.auction.state || "") ? patch.auction.state : "ended";
    patch.auction.source_status ||= patch.auction.state;
    patch.pricing.buy_now = null;
    explicitClears.push("pricing.buy_now");
  }
  const schedule = classifyAuctionSchedule({...patch.auction, platform});
  if (["unassigned", "conflict", "live", "timed", "ended", "unknown"].includes(schedule.status)) {
    patch.auction.auction_at = null; explicitClears.push("auction.auction_at");
  }
  if (["unassigned", "conflict", "live", "ended", "unknown"].includes(schedule.status)) {
    patch.auction.timed_end_at = null; explicitClears.push("auction.timed_end_at");
  }
  const previous = row ? canonicalVehicle({...row, provider: "apibara", provider_vehicle_id: vehicle.provider_vehicle_id}) : null;
  const merged = previous ? mergeCanonical(previous, patch, {explicitClears}).value : patch;
  merged.vin = normalizedObservationVin(merged.vin);
  const freshness = planFreshness(merged, Date.parse(observationTime), freshnessPolicy);
  return {record: {identity: existingIdentity(row, merged), vehicle: merged, observedAt: observationTime,
    observedExteriorColor: Boolean(patch.exterior_color), observedDocumentName: Boolean(patch.document.name),
    snapshotPolicy: "consecutive", explicitClears, freshnessClass: freshness.freshnessClass.toLowerCase(),
    nextRefreshAt: new Date(Date.parse(observationTime) + freshness.intervalMs).toISOString()},
  inserted: !row, availability};
}

/**
 * Prepared operator mechanism, intentionally not mounted on any Worker route.
 * Caller must inject a provider transport and explicit owner approval. All tests
 * inject saved/synthetic responses; this module has no default network transport.
 * Transport returns {response, observedAt} where observedAt is actual receipt time,
 * or the original capture time when replaying saved data.
 */
async function runPublicationRefresh({db, target, provider, approval, platform, mode, targets = [], filters = {}, maxPages = 1,
  freshnessPolicy, now = () => Date.now(), retryWait = null, crashAt = null}) {
  assertIsolatedTarget(target);
  if (!PLATFORMS.includes(platform) || !["discovery", "known"].includes(mode)) throw new Error("INVALID_REFRESH_SCOPE");
  const budget = validateApproval(approval, platform);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 4) throw new Error("INVALID_PAGE_LIMIT");
  if (!provider || provider.id !== "apibara" || typeof provider.obtain !== "function") throw new Error("EXPLICIT_TRANSPORT_REQUIRED");
  if (mode === "known" && (!targets.length || targets.length > 200 || targets.some(item => !item.lot || !item.listingId || item.platform !== platform))) throw new Error("INVALID_KNOWN_TARGETS");
  if (mode === "known" && new Set(targets.map(item => `${item.platform}:${item.lot}`)).size !== targets.length) throw new Error("DUPLICATE_KNOWN_TARGETS");
  const allowedFilters = new Set(["lot_status", "lot_sub_status", "fuel_type", "updated_within_minutes", "today_only", "upcoming"]);
  if (!filters || typeof filters !== "object" || Array.isArray(filters) || Object.entries(filters).some(([key, value]) =>
    !allowedFilters.has(key) || !["string", "number", "boolean"].includes(typeof value) || String(value).length > 120)) throw new Error("INVALID_DISCOVERY_FILTERS");
  const stableFilters = Object.fromEntries(Object.entries(filters).sort(([left], [right]) => left.localeCompare(right)));
  const repo = new D1SyncRepository(db);
  const operation = mode === "known" ? "detail_refresh" : "discovery";
  const manifest = mode === "known" ? await targetHash(targets.map(item => [item.platform, item.lot, item.listingId])) : await targetHash(stableFilters);
  const scopeKey = `publication:${approval.campaignId}:${mode}:${platform}:${manifest}`;
  const globalProvider = `apibara:publication:${approval.campaignId}`;
  const operationProvider = `${globalProvider}:${platform}`;
  const budgetDay = "campaign";
  const runId = crypto.randomUUID(), owner = `publication-${runId}`, token = crypto.randomUUID();
  const result = {ok: false, requests: 0, retries: 0, pages: 0, inserted: 0, updated: 0, skipped: 0,
    availability: {active: 0, ended: 0, unknown: 0}, ledger: [], stopReason: null, scopeKey, mode, platform};
  await repo.ensureScope({scopeKey, provider: "apibara", platform, operation, now: now()});
  const before = await repo.getScope(scopeKey);
  if (before.status === "complete" && before.cursor === null) return {...result, ok: true, stopReason: "scope_complete"};
  const lease = await repo.acquireLease({scopeKey, provider: "apibara", platform, operation, owner, token, now: now(), ttlMs: 600_000});
  if (!lease.acquired) return {...result, stopReason: "lease_conflict"};
  const run = {scopeKey, runId, owner, token, leaseGeneration: lease.leaseGeneration};
  let completed = false;
  try {
    await repo.createRun({runId, scopeKey, provider: "apibara", platform, operation, now: now()});
    await repo.initializeBudgetPair({globalProvider, operationProvider, budgetDay, globalLimit: budget.total, operationLimit: budget.own, now: now()});
    let cursor = (await repo.getScope(scopeKey)).cursor;
    const seen = new Set([cursor]);
    for (let pageNo = 0; pageNo < maxPages; pageNo++) {
      const index = mode === "known" ? cursor === null ? 0 : Number(cursor) : null;
      if (mode === "known" && (!Number.isSafeInteger(index) || index < 0 || index >= targets.length)) throw new Error("KNOWN_CHECKPOINT_INVALID");
      const item = mode === "known" ? targets[index] : null;
      const spec = mode === "known" ? {operation: "vehicleByIdentifier", identifier: item.identifier || item.lot, platform}
        : {operation: "listVehicles", params: {...stableFilters, platform, per_page: 20, ...(cursor !== null ? {cursor} : {})}, budgetClass: "discovery"};
      let obtained;
      for (let attempt = 0; attempt < budget.attempts; attempt++) {
        const reservationId = crypto.randomUUID();
        const reserved = await repo.reserveBudgetPair({reservationId, globalProvider, operationProvider, budgetDay, now: now()});
        if (!reserved.allowed) {result.stopReason = "budget_exhausted"; break;}
        if (!await repo.startBudgetPair({reservationId, globalProvider, operationProvider, budgetDay, now: now()})) throw new Error("BUDGET_START_FAILED");
        result.requests++; if (attempt) result.retries++;
        // This safe ledger contains no identifier, cursor, query, API key or response.
        const entry = {number: result.requests, platform, operation, attempt: attempt + 1, status: "attempted"};
        result.ledger.push(entry);
        await db.prepare("UPDATE sync_runs SET upstream_requests=upstream_requests+1 WHERE run_id=?").bind(runId).run();
        try {obtained = await provider.obtain(spec); entry.status = "response_received";}
        catch (error) {
          entry.status = safeCode(error);
          const retryable = RETRYABLE.has(error?.code) && attempt + 1 < budget.attempts;
          if (!retryable || typeof retryWait !== "function") throw error;
          // Explicit injected bounded backoff only; no default automatic retry.
          const retrySeconds = Number(error.retryAfter || 1);
          if (!Number.isFinite(retrySeconds) || retrySeconds > 60 || retrySeconds < 0) throw error;
          const delay = Math.max(1000, retrySeconds * 1000);
          await retryWait(delay);
        } finally {await repo.finishBudgetPair({reservationId, now: now()});}
        if (obtained) break;
      }
      if (!obtained) break;
      if (!provider.responseOk(obtained.response)) throw new Error("INVALID_PROVIDER_ENVELOPE");
      const observedAt = stamp(obtained.observedAt), processedAt = stamp(now());
      if (mode === "discovery") {
        // Adapter extraction deliberately returns [] for unknown shapes; that
        // convenience must never turn a malformed response into pagination end.
        const data = obtained.response?.response?.data ?? obtained.response?.data;
        if (!Array.isArray(data) && !(data && typeof data === "object" && Array.isArray(data.vehicles))) throw new Error("INVALID_PROVIDER_LIST_SHAPE");
      }
      const rawRecords = mode === "known" ? [provider.vehicleDetailRecord(obtained.response)] : provider.vehicleListRecords(obtained.response);
      if (!Array.isArray(rawRecords) || rawRecords.length > 20 || rawRecords.some(raw => !raw)) throw new Error("INVALID_PROVIDER_RECORDS");
      const records = [], keys = new Set(); let inserted = 0, updated = 0;
      for (const raw of rawRecords) {
        const prepared = await prepareObservation({repo, provider, raw, platform, observedAt, processedAt, knownTarget: item, freshnessPolicy});
        if (prepared.skipped) {result.skipped++; continue;}
        const key = prepared.record.identity.listingId;
        if (keys.has(key)) throw new Error("DUPLICATE_PAGE_IDENTITY");
        keys.add(key); records.push(prepared.record); result.availability[prepared.availability.status]++;
        if (prepared.inserted) inserted++; else updated++;
      }
      const meta = provider.responseMeta(obtained.response);
      if (mode === "discovery" && (!meta || !Object.hasOwn(meta, "next_cursor"))) throw new Error("PAGINATION_COMPLETENESS_UNKNOWN");
      const nextCursor = mode === "known" ? index + 1 < targets.length ? String(index + 1) : null : meta.next_cursor ?? null;
      if (nextCursor !== null && seen.has(String(nextCursor))) throw new Error("REPEATED_CURSOR");
      const persisted = await repo.persistDiscoveryPage({...run, provider: "apibara", platform, operation,
        cursor, nextCursor, records, now: processedAt, recordsReceived: rawRecords.length,
        recordsInserted: inserted, recordsUpdated: updated, recordsSkipped: rawRecords.length - records.length, crashAt});
      result.pages++; result.inserted += inserted; result.updated += updated;
      if (persisted.complete) {completed = true; result.stopReason = mode === "known" ? "known_targets_complete" : "scope_complete"; break;}
      cursor = nextCursor; seen.add(String(cursor));
    }
    if (!completed) await repo.finishPartialRun({...run, now: now()});
    result.ok = true; result.stopReason ||= "page_limit";
  } catch (error) {
    result.stopReason = safeCode(error);
    try {await repo.failRun({...run, errorCode: result.stopReason, now: now()});} catch {result.stateRecoveryRequired = true;}
  }
  result.scope = await repo.getScope(scopeKey);
  result.budget = await db.prepare("SELECT normal_limit,normal_consumed,normal_reserved FROM provider_request_budgets WHERE provider=? AND budget_day=?").bind(globalProvider, budgetDay).first();
  return result;
}

module.exports = {PUBLICATION_DB, MAX_PUBLICATION_REQUESTS, availabilityOf, assertIsolatedTarget, validateApproval, prepareObservation, runPublicationRefresh};
