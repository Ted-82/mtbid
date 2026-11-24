"use strict";

const {knownObservationStatements} = require("./d1-repository.js");

const MAX_INVENTORY_COMMIT_RECORDS = 60;
const MAX_CHECKPOINT_STATEMENTS = 10;
const BASELINE_FIELDS = Object.freeze(["listing_id", "source_key", "vin_normalized", "summary_synced_at",
  "detail_synced_at", "source_updated_at", "updated_at"]);
const validKey = value => typeof value === "string" && value.length > 0 && value.length <= 1000;
const timestamp = value => typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
const fullVin = value => typeof value === "string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(value);
const json = field => `json_extract(e.value,'$.${field}')`;
const sameLot = `l.platform IS ${json("platform")} AND l.lot IS ${json("lot")}`;

// One bound JSON array holds every baseline. IS deliberately distinguishes null
// from any non-null timestamp/VIN while matching null to null. Exactly one row
// must match an existing identity; an absent baseline requires zero LOT rows.
const CAS_SQL = `INSERT INTO sync_batch_guards(guard_id,allowed)
  SELECT ?,CASE WHEN NOT EXISTS(
    SELECT 1 FROM json_each(?) e WHERE
      (SELECT COUNT(*) FROM auction_listings l WHERE ${sameLot}) <>
        CASE WHEN ${json("previous")} IS NULL THEN 0 ELSE 1 END
      OR (${json("previous")} IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM auction_listings l WHERE ${sameLot}
          AND ${BASELINE_FIELDS.map(field => `l.${field} IS ${json(`previous.${field}`)}`).join(" AND ")}
      ))
      OR EXISTS(SELECT 1 FROM auction_listings l WHERE l.listing_id IS ${json("listingId")}
        AND NOT (${sameLot}))
      OR CASE WHEN EXISTS(SELECT 1 FROM vehicle_sources s WHERE s.source_key IS ${json("sourceKey")})
        THEN EXISTS(SELECT 1 FROM auction_listings l WHERE l.source_key IS ${json("sourceKey")}
          AND NOT (${sameLot} AND l.listing_id IS ${json("listingId")})
          AND (${json("verifiedVin")} IS NULL OR l.platform IS NOT ${json("platform")}
            OR l.vin_normalized IS NOT ${json("verifiedVin")} OR l.identity_state IS NOT 'resolved')) ELSE 0 END
      OR EXISTS(SELECT 1 FROM vehicle_sources s WHERE s.source_key IS ${json("sourceKey")}
        AND (s.platform IS NOT ${json("platform")} OR s.provider IS NOT 'apibara'))
  ) THEN 1 ELSE 0 END`;

function validateEntry(entry, commitAt) {
  const record = entry?.record, identity = record?.identity, vehicle = record?.vehicle;
  if (!record || !identity || !vehicle || !Object.hasOwn(entry, "previous")
      || typeof entry.inserted !== "boolean" || !["copart", "iaai"].includes(vehicle.platform)
      || identity.platform !== vehicle.platform || identity.provider !== "apibara" || vehicle.provider !== "apibara"
      || !/^\d{1,20}$/.test(String(vehicle.lot)) || identity.lot !== vehicle.lot
      || identity.vinCandidate !== vehicle.vin || !validKey(identity.listingId) || !validKey(identity.sourceKey)
      || !timestamp(record.observedAt) || Date.parse(record.observedAt) > commitAt
      || record.snapshotPolicy !== "consecutive") {
    throw Error("INVENTORY_COMMIT_RECORD_INVALID");
  }
  if (vehicle.source_updated_at != null && (!timestamp(vehicle.source_updated_at)
      || Date.parse(vehicle.source_updated_at) > Date.parse(record.observedAt))) throw Error("INVENTORY_COMMIT_RECORD_INVALID");
  for (const field of ["current_bid", "current_bid_secondary", "buy_now", "final_price", "source_price"]) {
    const value = vehicle.pricing?.[field];
    if (value != null && (!Number.isFinite(value) || value < 0)) throw Error("INVENTORY_COMMIT_RECORD_INVALID");
  }
  const previous = entry.previous;
  if (previous === null) {
    if (!entry.inserted || !/^[A-HJ-NPR-Z0-9]{17}$/.test(String(vehicle.vin || "").toUpperCase())
        || identity.sourceIdentityState !== "resolved" || identity.listingIdentityState !== "resolved") {
      throw Error("INVENTORY_COMMIT_BASELINE_INVALID");
    }
  } else {
    if (!previous || typeof previous !== "object" || entry.inserted
        || previous.platform !== vehicle.platform || previous.lot !== vehicle.lot
        || previous.listing_id !== identity.listingId || previous.source_key !== identity.sourceKey
        || BASELINE_FIELDS.some(field => !Object.hasOwn(previous, field)
          || previous[field] !== null && typeof previous[field] !== "string")) {
      throw Error("INVENTORY_COMMIT_BASELINE_INVALID");
    }
    if ([previous.summary_synced_at, previous.detail_synced_at].some(value => timestamp(value)
        && Date.parse(value) > Date.parse(record.observedAt))
        || timestamp(previous.source_updated_at) && timestamp(vehicle.source_updated_at)
        && Date.parse(previous.source_updated_at) > Date.parse(vehicle.source_updated_at)) {
      throw Error("INVENTORY_COMMIT_OLDER_OBSERVATION");
    }
    const known = previous.vin_normalized;
    const observed = vehicle.vin;
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(known || "") && known !== observed) throw Error("INVENTORY_COMMIT_BASELINE_INVALID");
  }
  return {platform: vehicle.platform, lot: vehicle.lot, listingId: identity.listingId,
    sourceKey: identity.sourceKey, verifiedVin: fullVin(vehicle.vin) ? vehicle.vin : null,
    previous: previous === null ? null : Object.fromEntries(BASELINE_FIELDS.map(field => [field, previous[field]]))};
}

function commitError(error) {
  // RefreshStore wraps D1 failures. Recognize only the two known CHECK guards;
  // never turn a transport error into proof that a transaction was rolled back.
  let cause = error;
  for (let depth = 0; cause && depth < 4; depth++, cause = cause.cause) {
    const message = String(cause.message || "");
    if (/CHECK constraint failed.*\ballowed\s*=\s*1\b/i.test(message)) {
      return Object.assign(Error("INVENTORY_COMMIT_STALE_BASELINE"), {cause: error, guardRejected: true});
    }
    if (/CHECK constraint failed.*\bvalid\s*=\s*1\b/i.test(message)) {
      return Object.assign(Error("INVENTORY_COMMIT_LEASE_REJECTED"), {cause: error, guardRejected: true});
    }
  }
  return Object.assign(Error("INVENTORY_COMMIT_FAILED"), {cause: error, guardRejected: false});
}

/**
 * Persist already-prepared observations and caller checkpoints atomically.
 * Requires the same RefreshStore/database and an acquired, current global lease.
 * No provider calls, baseline reads or individual readbacks are performed here.
 * The expected array is for one caller-owned batch readback before journal commit.
 */
async function commitInventoryBatch({db, store, prepared, checkpointStatements = []} = {}) {
  if (!db?.prepare || !db?.batch || store?.db !== db || typeof store?.guarded !== "function"
      || !validKey(store.owner)) throw Error("INVENTORY_COMMIT_STORE_REQUIRED");
  if (!Array.isArray(prepared) || prepared.length > MAX_INVENTORY_COMMIT_RECORDS
      || !Array.isArray(checkpointStatements) || checkpointStatements.length > MAX_CHECKPOINT_STATEMENTS
      || checkpointStatements.some(statement => !statement || typeof statement !== "object")) {
    throw Error("INVENTORY_COMMIT_BATCH_INVALID");
  }
  // Fingerprinting is asynchronous; retain one immutable-in-practice input
  // snapshot if the caller updates its page objects while that work is pending.
  try {prepared = structuredClone(prepared);}
  catch {throw Error("INVENTORY_COMMIT_RECORD_INVALID");}
  const commitAt = typeof store.now === "function" ? Number(store.now()) : Date.now();
  if (!Number.isFinite(commitAt)) throw Error("INVENTORY_COMMIT_STORE_REQUIRED");
  const baselines = prepared.map(entry => validateEntry(entry, commitAt));
  if (new Set(baselines.map(row => row.listingId)).size !== baselines.length) throw Error("INVENTORY_COMMIT_DUPLICATE_IDENTITY");
  const sources = new Map();
  for (const row of baselines) {
    const prior = sources.get(row.sourceKey);
    // A provider vehicle ID can persist across separate relisted LOTs. Keep
    // their listing IDs and CAS baselines distinct; require a complete VIN.
    if (prior && (!row.verifiedVin || prior.verifiedVin !== row.verifiedVin || prior.platform !== row.platform)) {
      throw Error("INVENTORY_COMMIT_DUPLICATE_IDENTITY");
    }
    sources.set(row.sourceKey, row);
  }
  if (new Set(baselines.map(row => `${row.platform}:${row.lot}`)).size !== baselines.length) throw Error("INVENTORY_COMMIT_DUPLICATE_IDENTITY");
  const built = [];
  // Relisted LOTs share a vehicle source. An older captured auction page may
  // create its own listing, but cannot roll that shared source's timestamps or
  // provider metadata back after a newer observation of another LOT.
  const sourceSafeDb = {prepare(sql) {
    if (/^\s*INSERT INTO vehicle_sources\b/.test(sql)) sql += `
      WHERE julianday(excluded.last_seen_at)>=COALESCE(julianday(vehicle_sources.last_seen_at),-1)
        AND (excluded.source_updated_at IS NULL OR vehicle_sources.source_updated_at IS NULL
          OR julianday(excluded.source_updated_at)>=julianday(vehicle_sources.source_updated_at))`;
    return db.prepare(sql);
  }};
  // Build and validate every record before entering the one database transaction.
  for (const entry of prepared) {
    let item;
    try {item = await knownObservationStatements(sourceSafeDb, entry.record);}
    catch {throw Error("INVENTORY_COMMIT_RECORD_INVALID");}
    if (item.statements.length !== 3) throw Error("INVENTORY_COMMIT_STATEMENT_COUNT_INVALID");
    built.push(item);
  }
  const guardId = crypto.randomUUID();
  const statements = [db.prepare(CAS_SQL).bind(guardId, JSON.stringify(baselines)),
    ...built.flatMap(item => item.statements), ...checkpointStatements,
    db.prepare("DELETE FROM sync_batch_guards WHERE guard_id=?").bind(guardId)];
  const statementCount = statements.length + 2; // RefreshStore lease guard + cleanup.
  if (statementCount > 250) throw Error("INVENTORY_COMMIT_STATEMENT_COUNT_INVALID");
  try {await store.guarded(statements);}
  catch (error) {throw commitError(error);}
  const expected = prepared.map((entry, index) => ({platform: entry.record.vehicle.platform,
    lot: entry.record.vehicle.lot, listingId: entry.record.identity.listingId, sourceKey: entry.record.identity.sourceKey,
    observedAt: entry.record.observedAt, fingerprint: built[index].fingerprint,
    currentBid: entry.record.vehicle.pricing.current_bid ?? null, buyNow: entry.record.vehicle.pricing.buy_now ?? null}));
  const inserted = prepared.filter(entry => entry.inserted).length;
  return {committed: prepared.length, inserted, updated: prepared.length - inserted, expected, statementCount};
}

module.exports = {MAX_INVENTORY_COMMIT_RECORDS, MAX_CHECKPOINT_STATEMENTS, commitInventoryBatch};
