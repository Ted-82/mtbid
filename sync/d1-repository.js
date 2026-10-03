"use strict";

const { validateRexVehicle } = require("../providers/contract.js");
const { withoutNonPersistentData, safeMediaReferences } = require("./core.js");

const FIRST_CURSOR = JSON.stringify(["first"]);
const MAX_DISCOVERY_PAGE_RECORDS = 20;

const MUTABLE_COLUMNS = Object.freeze([
  ["source_key", "source_key"], ["platform", "platform"],
  ["listing_identity_kind", "listing_identity_kind"], ["identity_state", "identity_state"],
  ["source_listing_id", "source_listing_id"], ["listing_generation", "listing_generation"],
  ["vin_normalized", "vin_normalized"], ["lot", "lot"], ["vehicle_title", "vehicle_title"],
  ["make", "make"], ["model", "model"], ["trim", "trim"],
  ["year", "year"], ["body_style", "body_style"], ["fuel_type", "fuel_type"],
  ["transmission", "transmission"], ["drive_type", "drive_type"], ["engine_size_l", "engine_size_l"],
  ["odometer_value", "odometer_value"], ["odometer_unit", "odometer_unit"], ["auction_state", "auction_state"],
  ["source_status", "source_status"], ["auction_at", "auction_at"], ["is_timed", "is_timed"],
  ["timed_end_at", "timed_end_at"], ["current_bid_usd", "current_bid_usd"],
  ["current_bid2_usd", "current_bid2_usd"], ["buy_now_usd", "buy_now_usd"],
  ["final_price_usd", "final_price_usd"], ["source_price_usd", "source_price_usd"],
  ["price_currency", "price_currency"],
  ["seller_name", "seller_name"], ["seller_type", "seller_type"], ["primary_damage", "primary_damage"],
  ["secondary_damage", "secondary_damage"], ["run_state", "run_state"], ["keys_present", "keys_present"],
  ["airbags", "airbags"], ["document_name", "document_name"], ["document_type", "document_type"],
  ["registration_allowed", "registration_allowed"], ["export_allowed", "export_allowed"],
  ["location_display", "location_display"], ["location_state", "location_state"],
  ["location_postal_code", "location_postal_code"], ["media_urls_json", "media_urls_json"],
  ["media_thumbs_json", "media_thumbs_json"], ["has_video", "has_video"], ["has_360", "has_360"],
  ["source_updated_at", "source_updated_at"], ["last_seen_at", "last_seen_at"],
  ["summary_synced_at", "summary_synced_at"], ["freshness_class", "freshness_class"],
  ["next_refresh_at", "next_refresh_at"], ["fingerprint", "fingerprint"],
  ["normalizer_version", "normalizer_version"], ["updated_at", "updated_at"]
]);

function cleanString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function boolSql(value) {
  return value === true ? 1 : value === false ? 0 : null;
}

function mediaJson(value) {
  const items = safeMediaReferences(value, "image");
  return items.length ? JSON.stringify([...new Set(items)]) : null;
}

function iso(value, label = "now") {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} jest nieprawidłowe.`);
  return date.toISOString();
}

function epoch(value, label = "now") {
  const result = value instanceof Date ? value.getTime()
    : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(result)) throw new TypeError(`${label} jest nieprawidłowe.`);
  return result;
}

function canonicalListingValues(record, now) {
  const vehicle = withoutNonPersistentData(record.vehicle);
  const identity = record.identity;
  const location = vehicle.location && typeof vehicle.location === "object" ? vehicle.location : {};
  const odometer = vehicle.odometer && typeof vehicle.odometer === "object" ? vehicle.odometer : {};
  const generation = identity.listingGeneration === null || identity.listingGeneration === undefined
    ? null : Number(identity.listingGeneration);
  if (generation !== null && (!Number.isSafeInteger(generation) || generation < 0)) {
    throw new TypeError("listingGeneration musi być nieujemną liczbą całkowitą dla D1.");
  }
  const nowIso = iso(now);
  const values = {
    listing_id: identity.listingId,
    source_key: identity.sourceKey,
    platform: identity.platform,
    listing_identity_kind: identity.listingIdentityKind,
    identity_state: identity.listingIdentityState === "ambiguous" ? "ambiguous" : "resolved",
    source_listing_id: cleanString(identity.sourceListingId),
    listing_generation: generation,
    vin_normalized: cleanString(identity.vinCandidate),
    lot: cleanString(identity.lot),
    vehicle_title: cleanString(vehicle.title),
    make: cleanString(vehicle.make),
    model: cleanString(vehicle.model),
    trim: cleanString(vehicle.trim),
    year: Number.isSafeInteger(vehicle.year) ? vehicle.year : null,
    body_style: cleanString(vehicle.body_style),
    fuel_type: cleanString(vehicle.fuel_type),
    transmission: cleanString(vehicle.transmission),
    drive_type: cleanString(vehicle.drive_type),
    engine_size_l: Number.isFinite(vehicle.engine_size_l) ? vehicle.engine_size_l : null,
    odometer_value: Number.isFinite(odometer.value) ? odometer.value : null,
    odometer_unit: cleanString(odometer.unit),
    auction_state: cleanString(vehicle.auction?.state),
    source_status: cleanString(vehicle.auction?.source_status),
    auction_at: cleanString(vehicle.auction?.auction_at),
    is_timed: boolSql(vehicle.auction?.timed),
    timed_end_at: cleanString(vehicle.auction?.timed_end_at),
    current_bid_usd: Number.isFinite(vehicle.pricing?.current_bid) ? vehicle.pricing.current_bid : null,
    current_bid2_usd: Number.isFinite(vehicle.pricing?.current_bid_secondary) ? vehicle.pricing.current_bid_secondary : null,
    buy_now_usd: Number.isFinite(vehicle.pricing?.buy_now) ? vehicle.pricing.buy_now : null,
    final_price_usd: Number.isFinite(vehicle.pricing?.final_price) ? vehicle.pricing.final_price : null,
    source_price_usd: Number.isFinite(vehicle.pricing?.source_price) ? vehicle.pricing.source_price : null,
    price_currency: cleanString(vehicle.pricing?.currency) || "USD",
    seller_name: cleanString(vehicle.seller?.name),
    seller_type: cleanString(vehicle.seller?.type),
    primary_damage: cleanString(vehicle.condition?.primary_damage),
    secondary_damage: cleanString(vehicle.condition?.secondary_damage),
    run_state: cleanString(vehicle.condition?.run_state),
    keys_present: boolSql(vehicle.condition?.keys_present),
    airbags: cleanString(vehicle.condition?.airbags),
    document_name: cleanString(vehicle.document?.name),
    document_type: cleanString(vehicle.document?.type),
    registration_allowed: boolSql(vehicle.document?.registration),
    export_allowed: boolSql(vehicle.document?.export),
    location_display: cleanString(location.display ?? (typeof vehicle.location === "string" ? vehicle.location : null)),
    location_state: cleanString(location.state),
    location_postal_code: cleanString(location.postal_code ?? location.zip),
    media_urls_json: mediaJson(vehicle.media?.items),
    media_thumbs_json: mediaJson(vehicle.media?.thumbs),
    has_video: boolSql(vehicle.media?.has_video),
    has_360: boolSql(vehicle.media?.has_360),
    source_updated_at: cleanString(vehicle.source_updated_at),
    last_seen_at: nowIso,
    summary_synced_at: nowIso,
    freshness_class: cleanString(record.freshnessClass) || "unknown",
    next_refresh_at: record.nextRefreshAt === undefined || record.nextRefreshAt === null ? null : iso(record.nextRefreshAt, "nextRefreshAt"),
    fingerprint: cleanString(record.fingerprint),
    normalizer_version: Number.isSafeInteger(vehicle.model_version) ? vehicle.model_version : null,
    updated_at: nowIso
  };
  values.created_at = nowIso;
  values.first_seen_at = nowIso;
  return values;
}

function listingUpsertStatement(db, record, now) {
  const values = canonicalListingValues(record, now);
  const clearPaths = new Set(record.explicitClears || []);
  const pathForColumn = {
    seller_name: "seller.name", seller_type: "seller.type", document_name: "document.name",
    document_type: "document.type", registration_allowed: "document.registration", export_allowed: "document.export",
    current_bid_usd: "pricing.current_bid", current_bid2_usd: "pricing.current_bid_secondary",
    buy_now_usd: "pricing.buy_now", final_price_usd: "pricing.final_price", source_price_usd: "pricing.source_price",
    auction_at: "auction.auction_at", timed_end_at: "auction.timed_end_at", auction_state: "auction.state",
    source_status: "auction.source_status", primary_damage: "condition.primary_damage",
    secondary_damage: "condition.secondary_damage", run_state: "condition.run_state",
    keys_present: "condition.keys_present", airbags: "condition.airbags", odometer_value: "odometer.value",
    has_video: "media.has_video", has_360: "media.has_360",
    media_urls_json: "media.items", media_thumbs_json: "media.thumbs"
  };
  const columns = Object.keys(values);
  const insertSql = `INSERT INTO auction_listings (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
  const assignments = MUTABLE_COLUMNS.map(([column]) => {
    const explicitClearPath = pathForColumn[column];
    const isExplicitClear = explicitClearPath && clearPaths.has(explicitClearPath);
    const isIdentity = ["source_key", "platform", "listing_identity_kind", "identity_state", "source_listing_id", "listing_generation"].includes(column);
    if (isIdentity && column === "identity_state") {
      return `${column}=CASE WHEN excluded.identity_state='resolved' THEN 'resolved' ELSE auction_listings.identity_state END`;
    }
    if (isIdentity) return `${column}=COALESCE(excluded.${column},auction_listings.${column})`;
    return isExplicitClear
      ? `${column}=excluded.${column}`
      : `${column}=COALESCE(excluded.${column},auction_listings.${column})`;
  });
  const sql = `${insertSql} ON CONFLICT(listing_id) DO UPDATE SET ${assignments.join(",")}`;
  return db.prepare(sql).bind(...columns.map(column => values[column]));
}

async function snapshotFingerprint(record) {
  const vehicle = withoutNonPersistentData(record.vehicle);
  const snapshot = {
    auction_state: cleanString(vehicle.auction?.state),
    auction_at: cleanString(vehicle.auction?.auction_at),
    timed_end_at: cleanString(vehicle.auction?.timed_end_at),
    current_bid_usd: Number.isFinite(vehicle.pricing?.current_bid) ? vehicle.pricing.current_bid : null,
    buy_now_usd: Number.isFinite(vehicle.pricing?.buy_now) ? vehicle.pricing.buy_now : null
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function snapshotInsertStatement(db, record, now, fingerprint) {
  const vehicle = withoutNonPersistentData(record.vehicle);
  const values = {
    listing_id: record.identity.listingId,
    observed_at: iso(now),
    auction_state: cleanString(vehicle.auction?.state),
    auction_at: cleanString(vehicle.auction?.auction_at),
    timed_end_at: cleanString(vehicle.auction?.timed_end_at),
    current_bid_usd: Number.isFinite(vehicle.pricing?.current_bid) ? vehicle.pricing.current_bid : null,
    buy_now_usd: Number.isFinite(vehicle.pricing?.buy_now) ? vehicle.pricing.buy_now : null,
    fingerprint,
    normalizer_version: Number.isSafeInteger(vehicle.model_version) ? vehicle.model_version : null
  };
  return db.prepare(`INSERT INTO auction_listing_snapshots
    (listing_id,observed_at,auction_state,auction_at,timed_end_at,current_bid_usd,buy_now_usd,fingerprint,normalizer_version)
    SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (
      SELECT 1 FROM auction_listing_snapshots WHERE listing_id=? AND fingerprint=?
    )`).bind(values.listing_id, values.observed_at, values.auction_state, values.auction_at,
    values.timed_end_at, values.current_bid_usd, values.buy_now_usd, values.fingerprint,
    values.normalizer_version, values.listing_id, values.fingerprint);
}

function sourceUpsertStatement(db, identity, vehicle, now) {
  const nowIso = iso(now);
  const sourceIdentityKind = identity.sourceIdentityKind === "source_listing_id" ? "source_id" : identity.sourceIdentityKind;
  const sql = `INSERT INTO vehicle_sources
    (source_key,provider,platform,provider_vehicle_id,identity_kind,identity_state,entity_id,
     source_updated_at,first_seen_at,last_seen_at,last_attempt_at,last_success_at,normalizer_version,
     sync_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'idle',?,?)
    ON CONFLICT(source_key) DO UPDATE SET
      provider_vehicle_id=COALESCE(excluded.provider_vehicle_id,vehicle_sources.provider_vehicle_id),
      identity_kind=CASE WHEN excluded.identity_state='resolved' THEN excluded.identity_kind ELSE vehicle_sources.identity_kind END,
      identity_state=CASE WHEN excluded.identity_state='resolved' THEN 'resolved' ELSE vehicle_sources.identity_state END,
      entity_id=COALESCE(excluded.entity_id,vehicle_sources.entity_id),
      source_updated_at=COALESCE(excluded.source_updated_at,vehicle_sources.source_updated_at),
      last_seen_at=excluded.last_seen_at,last_attempt_at=excluded.last_attempt_at,
      last_success_at=excluded.last_success_at,normalizer_version=COALESCE(excluded.normalizer_version,vehicle_sources.normalizer_version),
      updated_at=excluded.updated_at`;
  return db.prepare(sql).bind(
    identity.sourceKey, identity.provider, identity.platform, cleanString(vehicle.provider_vehicle_id),
    sourceIdentityKind, identity.sourceIdentityState, identity.entityId,
    cleanString(vehicle.source_updated_at), nowIso, nowIso, nowIso, nowIso,
    Number.isSafeInteger(vehicle.model_version) ? vehicle.model_version : null, nowIso, nowIso
  );
}

function cursorToken(cursor) {
  return cursor === null || cursor === undefined ? FIRST_CURSOR : JSON.stringify(["cursor", String(cursor)]);
}

async function digestCursor(cursor) {
  const bytes = new TextEncoder().encode(cursorToken(cursor));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

class D1SyncRepository {
  constructor(db, options = {}) {
    if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") throw new TypeError("Wymagany jest binding zgodny z D1.");
    this.db = db;
    this.maxPageRecords = options.maxPageRecords ?? MAX_DISCOVERY_PAGE_RECORDS;
    if (!Number.isInteger(this.maxPageRecords) || this.maxPageRecords < 1 || this.maxPageRecords > MAX_DISCOVERY_PAGE_RECORDS) {
      throw new TypeError("maxPageRecords musi mieścić się w zakresie 1..20.");
    }
  }

  async ensureScope({scopeKey, provider, platform, operation = "discovery", now}) {
    if (!scopeKey || !provider || !platform) throw new TypeError("Scope wymaga klucza, providera i platformy.");
    await this.db.prepare(`INSERT OR IGNORE INTO provider_sync_scopes
      (scope_key,provider,platform,operation,status,updated_at) VALUES (?,?,?,?,'idle',?)`)
      .bind(scopeKey, provider, platform, operation, iso(now)).run();
    const scope = await this.db.prepare(`SELECT provider,platform,operation FROM provider_sync_scopes WHERE scope_key=?`)
      .bind(scopeKey).first();
    if (!scope || scope.provider !== provider || scope.platform !== platform || scope.operation !== operation) {
      throw new Error("SYNC_SCOPE_IDENTITY_MISMATCH");
    }
  }

  async acquireLease(input) {
    const {scopeKey, provider, platform, operation = "discovery", owner, token, now, ttlMs} = input || {};
    if (!owner || !token || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("Lease wymaga owner, token i dodatniego TTL.");
    const nowIso = iso(now);
    const expiresAt = iso(epoch(now) + ttlMs);
    await this.ensureScope({scopeKey, provider, platform, operation, now});
    const guardId = crypto.randomUUID();
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
          SELECT 1 FROM provider_sync_scopes WHERE scope_key=? AND (lease_owner IS NULL OR lease_expires_at<=?))
          THEN 1 ELSE 0 END)`).bind(guardId, scopeKey, nowIso),
        this.db.prepare(`UPDATE sync_runs SET status='interrupted',completed_at=?,error_code='LEASE_RECOVERED'
          WHERE scope_key=? AND status='running' AND EXISTS(
            SELECT 1 FROM provider_sync_scopes WHERE scope_key=? AND (lease_owner IS NULL OR lease_expires_at<=?))`)
          .bind(nowIso, scopeKey, scopeKey, nowIso),
        this.db.prepare(`UPDATE provider_sync_scopes SET
          lease_owner=?,lease_token=?,lease_generation=lease_generation+1,lease_expires_at=?,
          status='running',last_attempt_at=?,updated_at=?
          WHERE scope_key=? AND (lease_owner IS NULL OR lease_expires_at<=?)`)
          .bind(owner, token, expiresAt, nowIso, nowIso, scopeKey, nowIso),
        this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId)
      ]);
    } catch (error) {
      if (String(error?.message || "").includes("CHECK constraint failed") && String(error?.message || "").includes("allowed = 1")) {
        return {acquired: false};
      }
      throw error;
    }
    const row = await this.db.prepare(`SELECT lease_generation FROM provider_sync_scopes
      WHERE scope_key=? AND lease_owner=? AND lease_token=?`).bind(scopeKey, owner, token).first();
    if (!row) return {acquired: false};
    return {acquired: true, leaseGeneration: row.lease_generation, token};
  }

  async createRun({runId, scopeKey, provider, platform, operation = "discovery", triggerKind = "operator", now}) {
    if (!runId || !scopeKey || !provider) throw new TypeError("Run wymaga runId, scopeKey i provider.");
    await this.db.prepare(`INSERT INTO sync_runs
      (run_id,scope_key,provider,platform,operation,trigger_kind,status,started_at)
      VALUES (?,?,?,?,?,?,'running',?)`)
      .bind(runId, scopeKey, provider, platform ?? null, operation, triggerKind, iso(now)).run();
    return {runId, status: "running"};
  }

  async getScope(scopeKey) {
    return this.db.prepare(`SELECT * FROM provider_sync_scopes WHERE scope_key=?`).bind(scopeKey).first();
  }

  async getRun(runId) {
    return this.db.prepare(`SELECT * FROM sync_runs WHERE run_id=?`).bind(runId).first();
  }

  async getSource({provider, platform, providerVehicleId}) {
    return this.db.prepare(`SELECT * FROM vehicle_sources WHERE provider=? AND platform=? AND provider_vehicle_id=?
      ORDER BY last_seen_at DESC LIMIT 1`).bind(provider, platform, providerVehicleId).first();
  }

  async getListing(listingId) {
    return this.db.prepare(`SELECT * FROM auction_listings WHERE listing_id=?`).bind(listingId).first();
  }

  async findListingsByLot({platform, lot, limit = 10}) {
    return this.db.prepare(`SELECT * FROM auction_listings WHERE platform=? AND lot=?
      ORDER BY last_seen_at DESC,listing_id LIMIT ?`).bind(platform, lot, limit).all();
  }

  async listDiscoveryDue({provider, platform, status = "partial", now, limit = 20}) {
    if (!["idle", "partial", "complete", "failed"].includes(status)) throw new TypeError("Nieobsługiwany status discovery due.");
    const at = iso(now);
    return this.db.prepare(`SELECT * FROM provider_sync_scopes WHERE provider=? AND platform=? AND operation='discovery'
      AND status=? AND (next_due_at IS NULL OR next_due_at<=?) AND (retry_after_at IS NULL OR retry_after_at<=?)
      ORDER BY COALESCE(next_due_at,'') LIMIT ?`).bind(provider, platform, status, at, at, limit).all();
  }

  async listRefreshDue({freshnessClass, now, limit = 20}) {
    if (!["hot", "warm", "cold", "unknown"].includes(freshnessClass)) throw new TypeError("Nieobsługiwana freshness class.");
    return this.db.prepare(`SELECT * FROM auction_listings WHERE next_refresh_at<=? AND freshness_class=?
      ORDER BY next_refresh_at,listing_id LIMIT ?`).bind(iso(now), freshnessClass, limit).all();
  }

  async releaseLease({scopeKey, owner, token, leaseGeneration, now}) {
    const result = await this.db.prepare(`UPDATE provider_sync_scopes SET lease_owner=NULL,lease_token=NULL,
      lease_expires_at=NULL,updated_at=? WHERE scope_key=? AND lease_owner=? AND lease_token=? AND lease_generation=?`)
      .bind(iso(now), scopeKey, owner, token, leaseGeneration).run();
    return changes(result) === 1;
  }

  async failRun({scopeKey, runId, owner, token, leaseGeneration, errorCode, now}) {
    const nowIso = iso(now);
    const guardId = crypto.randomUUID();
    const guard = this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed)
      VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM provider_sync_scopes s JOIN sync_runs r ON r.scope_key=s.scope_key
      WHERE s.scope_key=? AND s.lease_owner=? AND s.lease_token=? AND s.lease_generation=? AND s.lease_expires_at>? AND r.run_id=? AND r.status='running') THEN 1 ELSE 0 END)`)
      .bind(guardId, scopeKey, owner, token, leaseGeneration, nowIso, runId);
    try {
      await this.db.batch([
        guard,
        this.db.prepare(`UPDATE provider_sync_scopes SET status='failed',last_error_code=?,consecutive_failures=consecutive_failures+1,
          lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_attempt_at=?,updated_at=? WHERE scope_key=?`)
          .bind(String(errorCode || "SYNC_FAILED").slice(0,80), nowIso, nowIso, scopeKey),
        this.db.prepare(`UPDATE sync_runs SET status='failed',completed_at=?,error_code=? WHERE run_id=? AND status='running'`)
          .bind(nowIso, String(errorCode || "SYNC_FAILED").slice(0,80), runId),
        this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId)
      ]);
    } catch (error) {
      if (String(error?.message || "").includes("CHECK constraint failed")) throw new Error("STALE_LEASE_OR_RUN");
      throw error;
    }
    return true;
  }

  async finishPartialRun({scopeKey, runId, owner, token, leaseGeneration, now}) {
    const nowIso = iso(now);
    const guardId = crypto.randomUUID();
    const guard = this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed)
      VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM provider_sync_scopes s JOIN sync_runs r ON r.scope_key=s.scope_key
      WHERE s.scope_key=? AND s.lease_owner=? AND s.lease_token=? AND s.lease_generation=?
        AND s.lease_expires_at>? AND r.run_id=? AND r.status='running') THEN 1 ELSE 0 END)`)
      .bind(guardId, scopeKey, owner, token, leaseGeneration, nowIso, runId);
    try {
      await this.db.batch([
        guard,
        this.db.prepare(`UPDATE provider_sync_scopes SET status='partial',lease_owner=NULL,lease_token=NULL,
          lease_expires_at=NULL,last_attempt_at=?,updated_at=? WHERE scope_key=? AND lease_owner=?
          AND lease_token=? AND lease_generation=?`).bind(nowIso, nowIso, scopeKey, owner, token, leaseGeneration),
        this.db.prepare(`UPDATE sync_runs SET status='partial',completed_at=? WHERE run_id=? AND scope_key=? AND status='running'`)
          .bind(nowIso, runId, scopeKey),
        this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId)
      ]);
    } catch (error) {
      if (String(error?.message || "").includes("CHECK constraint failed")) throw new Error("STALE_LEASE_OR_RUN");
      throw error;
    }
    const run = await this.getRun(runId);
    return run?.status === "partial";
  }

  async persistDiscoveryPage(input) {
    const {scopeKey, provider, platform, runId, owner, token, cursor = null, nextCursor = null,
      records = [], now, crashAt = null} = input || {};
    if (!scopeKey || !provider || !platform || !runId || !owner || !token || !Number.isSafeInteger(input.leaseGeneration) || !Array.isArray(records)) {
      throw new TypeError("Niekompletne dane persistDiscoveryPage.");
    }
    if (records.length > this.maxPageRecords) throw new RangeError("DISCOVERY_PAGE_TOO_LARGE");
    if (nextCursor !== null && nextCursor !== undefined && (!String(nextCursor) || String(nextCursor) === String(cursor ?? ""))) {
      throw new Error("REPEATED_CURSOR");
    }
    const nowIso = iso(now);
    const cursorHash = await digestCursor(cursor);
    const nextCursorHash = nextCursor === null || nextCursor === undefined ? null : await digestCursor(nextCursor);
    const priorCommit = await this.db.prepare(`SELECT next_cursor_hash,run_id FROM sync_page_commits
      WHERE scope_key=? AND run_id=? AND cursor_hash=?`).bind(scopeKey, runId, cursorHash).first();
    if (priorCommit) {
      if (priorCommit.next_cursor_hash !== nextCursorHash) throw new Error("CURSOR_REPLAY_MISMATCH");
      return {replayed: true, pageCount: records.length, complete: nextCursor === null || nextCursor === undefined};
    }

    const prepared = records.map(record => {
      if (!record?.identity || !record?.vehicle) throw new TypeError("Rekord discovery wymaga canonical vehicle i identity.");
      const validation = validateRexVehicle(record.vehicle);
      if (!validation.valid) throw new TypeError(`Nieprawidłowy canonical vehicle: ${validation.errors.join(",")}`);
      if (record.vehicle.provider !== provider || record.vehicle.platform !== platform ||
          record.identity.provider !== provider || record.identity.platform !== platform ||
          !record.identity.sourceKey || !record.identity.listingId) throw new TypeError("Identity nie zgadza się ze scopem discovery.");
      return record;
    });

    const guardId = crypto.randomUUID();
    const guardSql = `INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
      EXISTS(SELECT 1 FROM provider_sync_scopes s JOIN sync_runs r ON r.scope_key=s.scope_key
        WHERE s.scope_key=? AND s.provider=? AND s.platform=? AND s.operation='discovery'
          AND s.lease_owner=? AND s.lease_token=? AND s.lease_generation=? AND s.lease_expires_at>?
          AND s.cursor IS ? AND r.run_id=? AND r.status='running')
      AND NOT EXISTS(SELECT 1 FROM sync_page_commits pc WHERE pc.scope_key=? AND pc.run_id=? AND pc.cursor_hash=?)
      AND (? IS NULL OR (?<>? AND NOT EXISTS(SELECT 1 FROM sync_page_commits pc WHERE pc.scope_key=? AND pc.run_id=? AND pc.cursor_hash=?)))
      THEN 1 ELSE 0 END)`;
    const guard = this.db.prepare(guardSql).bind(
      guardId, scopeKey, provider, platform, owner, token, input.leaseGeneration, nowIso, cursor, runId,
      scopeKey, runId, cursorHash, nextCursorHash, nextCursorHash, cursorHash, scopeKey, runId, nextCursorHash
    );
    const batch = [guard];
    const snapshotFingerprints = await Promise.all(prepared.map(snapshotFingerprint));
    for (let index = 0; index < prepared.length; index += 1) {
      const record = prepared[index];
      const {identity, vehicle} = record;
      if (identity.entityId) {
        batch.push(this.db.prepare(`INSERT OR IGNORE INTO vehicle_entities(entity_id,vin_normalized,identity_state,match_basis,created_at,updated_at)
          VALUES(?,?,'confirmed','explicit_reconciliation',?,?)`).bind(identity.entityId, identity.vinCandidate ?? null, nowIso, nowIso));
      }
      batch.push(sourceUpsertStatement(this.db, identity, vehicle, now));
      batch.push(listingUpsertStatement(this.db, record, now));
      batch.push(snapshotInsertStatement(this.db, record, now, snapshotFingerprints[index]));
    }
    batch.push(this.db.prepare(`INSERT INTO sync_page_commits(scope_key,run_id,cursor_hash,next_cursor_hash,committed_at)
      VALUES(?,?,?,?,?)`).bind(scopeKey, runId, cursorHash, nextCursorHash, nowIso));
    const complete = nextCursor === null || nextCursor === undefined;
    batch.push(this.db.prepare(`UPDATE provider_sync_scopes SET cursor=?,cursor_updated_at=?,status=?,
      last_attempt_at=?,last_error_code=NULL,
      last_complete_at=CASE WHEN ?=1 THEN ? ELSE last_complete_at END,
      last_success_at=?,
      consecutive_failures=CASE WHEN ?=1 THEN 0 ELSE consecutive_failures END,
      lease_owner=CASE WHEN ?=1 THEN NULL ELSE lease_owner END,
      lease_token=CASE WHEN ?=1 THEN NULL ELSE lease_token END,
      lease_expires_at=CASE WHEN ?=1 THEN NULL ELSE lease_expires_at END,updated_at=?
      WHERE scope_key=? AND lease_owner=? AND lease_token=?`)
      .bind(nextCursor ?? null, nowIso, complete ? "complete" : "partial", nowIso,
        Number(complete), nowIso, nowIso, Number(complete), Number(complete),
        Number(complete), Number(complete), nowIso, scopeKey, owner, token));
    const recordsReceived = Number.isSafeInteger(input.recordsReceived) && input.recordsReceived >= 0 ? input.recordsReceived : prepared.length;
    const recordsInserted = Number.isSafeInteger(input.recordsInserted) && input.recordsInserted >= 0 ? input.recordsInserted : 0;
    const recordsUpdated = Number.isSafeInteger(input.recordsUpdated) && input.recordsUpdated >= 0 ? input.recordsUpdated : 0;
    const recordsSkipped = Number.isSafeInteger(input.recordsSkipped) && input.recordsSkipped >= 0 ? input.recordsSkipped : 0;
    const latencyMs = Number.isSafeInteger(input.latencyMs) && input.latencyMs >= 0 ? input.latencyMs : null;
    batch.push(this.db.prepare(`UPDATE sync_runs SET
      pages_completed=pages_completed+1,records_received=records_received+?,
      records_inserted=records_inserted+?,records_updated=records_updated+?,records_skipped=records_skipped+?,
      latency_ms=COALESCE(?,latency_ms),
      status=?,completed_at=CASE WHEN ?=1 THEN ? ELSE completed_at END
      WHERE run_id=? AND status='running'`).bind(recordsReceived, recordsInserted, recordsUpdated, recordsSkipped,
      latencyMs, complete ? "completed" : "running", Number(complete), nowIso, runId));
    if (crashAt === "before_batch") throw Object.assign(new Error("SIMULATED_CRASH_BEFORE_BATCH"), {code: "SIMULATED_CRASH"});
    if (crashAt === "inside_batch") {
      batch.splice(2, 0, this.db.prepare("INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,0)").bind(crypto.randomUUID()));
    }
    batch.push(this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId));
    try {
      await this.db.batch(batch);
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("CHECK constraint failed")) {
        // SQLite/D1 identifies the failed CHECK expression (not its table).
        // The guard row is inserted only when its lease/run/cursor preconditions hold.
        if (message.includes("allowed = 1")) throw new Error("STALE_LEASE_CURSOR_OR_RUN");
        throw error;
      }
      throw error;
    }
    return {replayed: false, pageCount: prepared.length, complete, nextCursor: nextCursor ?? null};
  }

  async initializeBudget({provider, budgetDay, normalLimit, retryLimit, now}) {
    for (const [name, value] of [["normalLimit", normalLimit], ["retryLimit", retryLimit]]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} musi być nieujemną liczbą całkowitą.`);
    }
    await this.db.prepare(`INSERT OR IGNORE INTO provider_request_budgets
      (provider,budget_day,normal_limit,retry_limit,updated_at) VALUES(?,?,?,?,?)`)
      .bind(provider, budgetDay, normalLimit, retryLimit, iso(now)).run();
    return this.db.prepare(`SELECT * FROM provider_request_budgets WHERE provider=? AND budget_day=?`)
      .bind(provider, budgetDay).first();
  }

  async initializeBudgetPair({globalProvider, operationProvider, budgetDay, globalLimit, operationLimit, now}) {
    for (const [name, value] of [["globalLimit", globalLimit], ["operationLimit", operationLimit]]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} musi być dodatnią liczbą całkowitą.`);
    }
    const timestamp = iso(now);
    await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO provider_request_budgets
        (provider,budget_day,normal_limit,retry_limit,updated_at) VALUES(?,?,?,0,?)`)
        .bind(globalProvider, budgetDay, globalLimit, timestamp),
      this.db.prepare(`INSERT OR IGNORE INTO provider_request_budgets
        (provider,budget_day,normal_limit,retry_limit,updated_at) VALUES(?,?,?,0,?)`)
        .bind(operationProvider, budgetDay, operationLimit, timestamp),
      this.db.prepare(`UPDATE provider_request_budgets SET normal_limit=MIN(normal_limit,?),updated_at=?
        WHERE provider=? AND budget_day=?`).bind(globalLimit, timestamp, globalProvider, budgetDay),
      this.db.prepare(`UPDATE provider_request_budgets SET normal_limit=MIN(normal_limit,?),updated_at=?
        WHERE provider=? AND budget_day=?`).bind(operationLimit, timestamp, operationProvider, budgetDay)
    ]);
  }

  async reserveBudgetPair({reservationId, globalProvider, operationProvider, budgetDay, now}) {
    if (!reservationId || globalProvider === operationProvider) throw new TypeError("Nieprawidłowy budżet requestu providera.");
    const globalId = `${reservationId}:all`;
    const operationId = `${reservationId}:operation`;
    const existing = await this.db.prepare(`SELECT reservation_id,provider,budget_day,state FROM provider_request_reservations
      WHERE reservation_id IN (?,?) ORDER BY reservation_id`).bind(globalId, operationId).all();
    if (existing.results?.length) {
      const byId = new Map(existing.results.map(row => [row.reservation_id, row]));
      const global = byId.get(globalId);
      const operation = byId.get(operationId);
      if (!global || !operation || global.provider !== globalProvider || operation.provider !== operationProvider
          || global.budget_day !== budgetDay || operation.budget_day !== budgetDay) throw new Error("BUDGET_RESERVATION_ID_COLLISION");
      return {allowed: global.state === "reserved" && operation.state === "reserved", replayed: true};
    }
    const guardId = crypto.randomUUID();
    const timestamp = iso(now);
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
          EXISTS(SELECT 1 FROM provider_request_budgets WHERE provider=? AND budget_day=? AND normal_consumed+normal_reserved+1<=normal_limit)
          AND EXISTS(SELECT 1 FROM provider_request_budgets WHERE provider=? AND budget_day=? AND normal_consumed+normal_reserved+1<=normal_limit)
          THEN 1 ELSE 0 END)`)
          .bind(guardId, globalProvider, budgetDay, operationProvider, budgetDay),
        this.db.prepare(`UPDATE provider_request_budgets SET normal_reserved=normal_reserved+1,updated_at=?
          WHERE provider=? AND budget_day=? AND EXISTS(SELECT 1 FROM sync_batch_guards WHERE guard_id=? AND allowed=1)`)
          .bind(timestamp, globalProvider, budgetDay, guardId),
        this.db.prepare(`UPDATE provider_request_budgets SET normal_reserved=normal_reserved+1,updated_at=?
          WHERE provider=? AND budget_day=? AND EXISTS(SELECT 1 FROM sync_batch_guards WHERE guard_id=? AND allowed=1)`)
          .bind(timestamp, operationProvider, budgetDay, guardId),
        this.db.prepare(`INSERT INTO provider_request_reservations
          (reservation_id,provider,budget_day,bucket,request_count,state,created_at,updated_at)
          SELECT ?,?,?,'normal',1,'reserved',?,? WHERE EXISTS(SELECT 1 FROM sync_batch_guards WHERE guard_id=? AND allowed=1)`)
          .bind(globalId, globalProvider, budgetDay, timestamp, timestamp, guardId),
        this.db.prepare(`INSERT INTO provider_request_reservations
          (reservation_id,provider,budget_day,bucket,request_count,state,created_at,updated_at)
          SELECT ?,?,?,'normal',1,'reserved',?,? WHERE EXISTS(SELECT 1 FROM sync_batch_guards WHERE guard_id=? AND allowed=1)`)
          .bind(operationId, operationProvider, budgetDay, timestamp, timestamp, guardId),
        this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId)
      ]);
      return {allowed: true, replayed: false};
    } catch (error) {
      if (String(error?.message || "").includes("allowed = 1")) return {allowed: false, reason: "BUDGET_EXHAUSTED"};
      throw error;
    }
  }

  async startBudgetPair({reservationId, globalProvider, operationProvider, budgetDay, now}) {
    const globalId = `${reservationId}:all`;
    const operationId = `${reservationId}:operation`;
    const guardId = crypto.randomUUID();
    const timestamp = iso(now);
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
          EXISTS(SELECT 1 FROM provider_request_reservations WHERE reservation_id=? AND provider=? AND budget_day=? AND state='reserved')
          AND EXISTS(SELECT 1 FROM provider_request_reservations WHERE reservation_id=? AND provider=? AND budget_day=? AND state='reserved')
          THEN 1 ELSE 0 END)`)
          .bind(guardId, globalId, globalProvider, budgetDay, operationId, operationProvider, budgetDay),
        this.db.prepare(`UPDATE provider_request_budgets SET normal_reserved=normal_reserved-1,normal_consumed=normal_consumed+1,updated_at=?
          WHERE provider=? AND budget_day=? AND EXISTS(SELECT 1 FROM sync_batch_guards WHERE guard_id=? AND allowed=1)`)
          .bind(timestamp, globalProvider, budgetDay, guardId),
        this.db.prepare(`UPDATE provider_request_budgets SET normal_reserved=normal_reserved-1,normal_consumed=normal_consumed+1,updated_at=?
          WHERE provider=? AND budget_day=? AND EXISTS(SELECT 1 FROM sync_batch_guards WHERE guard_id=? AND allowed=1)`)
          .bind(timestamp, operationProvider, budgetDay, guardId),
        this.db.prepare(`UPDATE provider_request_reservations SET state='started',updated_at=? WHERE reservation_id IN (?,?) AND state='reserved'`)
          .bind(timestamp, globalId, operationId),
        this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId)
      ]);
      return true;
    } catch (error) {
      if (String(error?.message || "").includes("allowed = 1")) return false;
      throw error;
    }
  }

  async finishBudgetPair({reservationId, now}) {
    const timestamp = iso(now);
    await this.db.prepare(`UPDATE provider_request_reservations SET state='finished',updated_at=?
      WHERE reservation_id IN (?,?) AND state='started'`)
      .bind(timestamp, `${reservationId}:all`, `${reservationId}:operation`).run();
  }

  async cancelBudgetPair({reservationId, globalProvider, operationProvider, budgetDay, now}) {
    const globalId = `${reservationId}:all`;
    const operationId = `${reservationId}:operation`;
    const timestamp = iso(now);
    const guardId = crypto.randomUUID();
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
          EXISTS(SELECT 1 FROM provider_request_reservations WHERE reservation_id=? AND provider=? AND budget_day=? AND state='reserved')
          AND EXISTS(SELECT 1 FROM provider_request_reservations WHERE reservation_id=? AND provider=? AND budget_day=? AND state='reserved')
          THEN 1 ELSE 0 END)`)
          .bind(guardId, globalId, globalProvider, budgetDay, operationId, operationProvider, budgetDay),
        this.db.prepare(`UPDATE provider_request_budgets SET normal_reserved=normal_reserved-1,updated_at=?
          WHERE provider=? AND budget_day=? AND EXISTS(SELECT 1 FROM sync_batch_guards WHERE guard_id=? AND allowed=1)`)
          .bind(timestamp, globalProvider, budgetDay, guardId),
        this.db.prepare(`UPDATE provider_request_budgets SET normal_reserved=normal_reserved-1,updated_at=?
          WHERE provider=? AND budget_day=? AND EXISTS(SELECT 1 FROM sync_batch_guards WHERE guard_id=? AND allowed=1)`)
          .bind(timestamp, operationProvider, budgetDay, guardId),
        this.db.prepare(`UPDATE provider_request_reservations SET state='cancelled',updated_at=?
          WHERE reservation_id IN (?,?) AND state='reserved'`).bind(timestamp, globalId, operationId),
        this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId)
      ]);
      return true;
    } catch (error) {
      if (String(error?.message || "").includes("allowed = 1")) return false;
      throw error;
    }
  }

  async reserveBudget({reservationId, provider, budgetDay, bucket = "normal", count = 1, now}) {
    if (!reservationId || !["normal", "retry"].includes(bucket) || !Number.isSafeInteger(count) || count < 1) {
      throw new TypeError("Nieprawidłowa rezerwacja request budget.");
    }
    const existing = await this.db.prepare(`SELECT * FROM provider_request_reservations WHERE reservation_id=?`).bind(reservationId).first();
    if (existing) {
      if (existing.provider !== provider || existing.budget_day !== budgetDay || existing.bucket !== bucket || existing.request_count !== count) {
        throw new Error("BUDGET_RESERVATION_ID_COLLISION");
      }
      if (existing.state !== "reserved") return {allowed: false, replayed: true, reason: "BUDGET_RESERVATION_ALREADY_USED", state: existing.state};
      return {allowed: true, replayed: true, state: "reserved"};
    }
    const guardId = crypto.randomUUID();
    const nowIso = iso(now);
    const bucketPrefix = bucket === "retry" ? "retry" : "normal";
    const allowedExpr = bucket === "retry"
      ? `b.retry_consumed+b.retry_reserved+?<=b.retry_limit`
      : `b.normal_consumed+b.normal_reserved+?<=b.normal_limit`;
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
          SELECT 1 FROM provider_request_budgets b WHERE b.provider=? AND b.budget_day=? AND ${allowedExpr}) THEN 1 ELSE 0 END)`)
          .bind(guardId, provider, budgetDay, count),
        this.db.prepare(`UPDATE provider_request_budgets SET ${bucketPrefix}_reserved=${bucketPrefix}_reserved+?,updated_at=?
          WHERE provider=? AND budget_day=?`).bind(count, nowIso, provider, budgetDay),
        this.db.prepare(`INSERT INTO provider_request_reservations
          (reservation_id,provider,budget_day,bucket,request_count,state,created_at,updated_at)
          VALUES(?,?,?,?,?,'reserved',?,?)`).bind(reservationId, provider, budgetDay, bucket, count, nowIso, nowIso),
        this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId)
      ]);
      return {allowed: true, replayed: false, state: "reserved"};
    } catch (error) {
      if (String(error?.message || "").includes("CHECK constraint failed")) return {allowed: false, reason: "BUDGET_EXHAUSTED"};
      throw error;
    }
  }

  async startBudgetReservation({reservationId, now}) {
    const row = await this.db.prepare(`SELECT provider,budget_day,bucket,request_count,state FROM provider_request_reservations WHERE reservation_id=?`)
      .bind(reservationId).first();
    if (!row || row.state !== "reserved") return false;
    const prefix = row.bucket;
    const nowIso = iso(now);
    const guardId = crypto.randomUUID();
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
          SELECT 1 FROM provider_request_reservations WHERE reservation_id=? AND state='reserved') THEN 1 ELSE 0 END)`)
          .bind(guardId, reservationId),
        this.db.prepare(`UPDATE provider_request_budgets SET ${prefix}_reserved=${prefix}_reserved-?,
          ${prefix}_consumed=${prefix}_consumed+?,updated_at=? WHERE provider=? AND budget_day=?`)
          .bind(row.request_count, row.request_count, nowIso, row.provider, row.budget_day),
        this.db.prepare(`UPDATE provider_request_reservations SET state='started',updated_at=?
          WHERE reservation_id=? AND state='reserved'`).bind(nowIso, reservationId),
        this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId)
      ]);
      return true;
    } catch (error) {
      if (String(error?.message || "").includes("CHECK constraint failed")) return false;
      throw error;
    }
  }

  async finishBudgetReservation({reservationId, now}) {
    const result = await this.db.prepare(`UPDATE provider_request_reservations SET state='finished',updated_at=?
      WHERE reservation_id=? AND state='started'`)
      .bind(iso(now), reservationId).run();
    return changes(result) === 1;
  }

  async cancelBudgetReservation({reservationId, now}) {
    const row = await this.db.prepare(`SELECT provider,budget_day,bucket,request_count FROM provider_request_reservations
      WHERE reservation_id=? AND state='reserved'`).bind(reservationId).first();
    if (!row) return false;
    const prefix = row.bucket;
    const nowIso = iso(now);
    const guardId = crypto.randomUUID();
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
          SELECT 1 FROM provider_request_reservations WHERE reservation_id=? AND state='reserved') THEN 1 ELSE 0 END)`)
          .bind(guardId, reservationId),
        this.db.prepare(`UPDATE provider_request_budgets SET ${prefix}_reserved=${prefix}_reserved-?,updated_at=?
          WHERE provider=? AND budget_day=?`).bind(row.request_count, nowIso, row.provider, row.budget_day),
        this.db.prepare(`UPDATE provider_request_reservations SET state='cancelled',updated_at=?
          WHERE reservation_id=? AND state='reserved'`).bind(nowIso, reservationId),
        this.db.prepare(`DELETE FROM sync_batch_guards WHERE guard_id=?`).bind(guardId)
      ]);
      return true;
    } catch (error) {
      if (String(error?.message || "").includes("CHECK constraint failed")) return false;
      throw error;
    }
  }
}

module.exports = { D1SyncRepository, MAX_DISCOVERY_PAGE_RECORDS, digestCursor };
