"use strict";

const contract = require("../providers/contract.js");

const KNOWN_PLATFORMS = Object.freeze(["copart", "iaai"]);
const MAX_PAGE_SIZE = 50;

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function numberOrNull(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
}

function booleanOrNull(value) {
  return value === null || value === undefined ? null : Number(value) === 1;
}

function encodeCursor(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  if (String(cursor).length > 512 || !/^[A-Za-z0-9_-]+$/.test(String(cursor))) throw new TypeError("Nieprawidłowy cursor D1.");
  const normalized = String(cursor).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), char => char.charCodeAt(0)))); }
  catch { throw new TypeError("Nieprawidłowy cursor D1."); }
  if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== "listing" || typeof parsed[1] !== "string" || !parsed[1]) {
    throw new TypeError("Nieprawidłowy cursor D1.");
  }
  return parsed[1];
}

function canonicalVehicle(row) {
  const provider = clean(row.provider) || "unknown";
  return contract.createRexVehicle({
    provider,
    provider_vehicle_id: clean(row.provider_vehicle_id),
    platform: clean(row.platform),
    vin: clean(row.vin_normalized),
    lot: clean(row.lot),
    title: clean(row.vehicle_title),
    year: numberOrNull(row.year),
    make: clean(row.make),
    model: clean(row.model),
    trim: clean(row.trim),
    auction: contract.createRexAuction({
      state: clean(row.auction_state), source_status: clean(row.source_status),
      auction_at: clean(row.auction_at), timed: booleanOrNull(row.is_timed),
      timed_end_at: clean(row.timed_end_at), source_listing_id: clean(row.source_listing_id)
    }),
    pricing: contract.createRexPricing({
      currency: clean(row.price_currency) || "USD", current_bid: numberOrNull(row.current_bid_usd),
      current_bid_secondary: numberOrNull(row.current_bid2_usd), buy_now: numberOrNull(row.buy_now_usd),
      final_price: numberOrNull(row.final_price_usd), source_price: numberOrNull(row.source_price_usd)
    }),
    seller: contract.createRexSeller({name: clean(row.seller_name), type: clean(row.seller_type), source: clean(row.seller_name) ? provider : null}),
    condition: contract.createRexCondition({
      primary_damage: clean(row.primary_damage), secondary_damage: clean(row.secondary_damage),
      run_state: clean(row.run_state), keys_present: booleanOrNull(row.keys_present), airbags: clean(row.airbags)
    }),
    document: contract.createRexDocument({
      name: clean(row.document_name), type: clean(row.document_type),
      registration: booleanOrNull(row.registration_allowed), export: booleanOrNull(row.export_allowed)
    }),
    media: contract.createRexMedia({items: [], thumbs: [], has_video: booleanOrNull(row.has_video), has_360: booleanOrNull(row.has_360)}),
    location: row.location_display ? {display: clean(row.location_display), state: clean(row.location_state), postal_code: clean(row.location_postal_code)} : null,
    odometer: row.odometer_value === null || row.odometer_value === undefined ? null : {
      value: numberOrNull(row.odometer_value), unit: clean(row.odometer_unit)
    },
    source_updated_at: clean(row.source_updated_at)
  });
}

function timestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

function freshnessFor(row, now, maxAgeMs) {
  const syncedAt = clean(row.summary_synced_at);
  const parsed = timestamp(syncedAt);
  const ageMs = parsed === null ? null : Math.max(0, now - parsed);
  const status = ageMs === null ? "unknown" : ageMs <= maxAgeMs ? "fresh" : "stale";
  return {status, age_ms: ageMs, last_synced_at: syncedAt, last_seen_at: clean(row.last_seen_at)};
}

function listingFromRow(row, now, maxAgeMs) {
  return {
    listing_id: row.listing_id,
    source_key: row.source_key,
    identity: {
      listing_kind: row.listing_identity_kind,
      state: row.identity_state,
      provider_listing_id: clean(row.source_listing_id),
      generation: row.listing_generation === null ? null : Number(row.listing_generation)
    },
    vehicle: canonicalVehicle(row),
    freshness: freshnessFor(row, now, maxAgeMs),
    freshness_class: row.freshness_class || "unknown",
    updated_at: clean(row.updated_at)
  };
}

class D1ReadRepository {
  constructor(db, {maxAgeMs = 86_400_000, now = () => Date.now()} = {}) {
    if (!db || typeof db.prepare !== "function") throw new TypeError("Wymagany jest binding D1 read-only.");
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) throw new TypeError("maxAgeMs musi być nieujemną liczbą całkowitą.");
    this.db = db;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
  }

  async getCoverage(platform = null) {
    const query = platform
      ? this.db.prepare("SELECT provider,platform,status,cursor,last_complete_at FROM provider_sync_scopes WHERE operation='discovery' AND platform=? ORDER BY provider").bind(platform)
      : this.db.prepare("SELECT provider,platform,status,cursor,last_complete_at FROM provider_sync_scopes WHERE operation='discovery' ORDER BY platform,provider");
    const rows = (await query.all()).results || [];
    const platforms = platform ? [platform] : KNOWN_PLATFORMS;
    const summaries = platforms.map(name => {
      const matching = rows.filter(row => row.platform === name);
      const complete = matching.length > 0 && matching.every(row => row.status === "complete" && row.cursor === null);
      return {platform: name, scope_count: matching.length, complete,
        status: matching.length ? matching.every(row => row.status === "complete") ? "complete" : "partial" : "not_synced",
        next_page_available: matching.some(row => row.cursor !== null),
        last_complete_at: matching.length && matching.every(row => row.last_complete_at)
          ? matching.map(row => row.last_complete_at).sort().at(-1) : null};
    });
    return {complete: summaries.length > 0 && summaries.every(item => item.complete), partial: summaries.some(item => !item.complete), platforms: summaries};
  }

  async listCatalog({platform = null, make = null, model = null, yearFrom = null, yearTo = null,
    timed = null, buyNow = false, auctionState = null, upcoming = null, nowIso = new Date(this.now()).toISOString(),
    limit = 20, cursor = null} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new RangeError("D1 page size must be 1..50.");
    const afterId = decodeCursor(cursor);
    const where = [];
    const values = [];
    if (platform) { where.push("l.platform=?"); values.push(String(platform).toLowerCase()); }
    if (make) { where.push("lower(l.make)=lower(?)"); values.push(String(make).trim()); }
    if (model) { where.push("lower(l.model)=lower(?)"); values.push(String(model).trim()); }
    if (yearFrom !== null) { where.push("l.year>=?"); values.push(Number(yearFrom)); }
    if (yearTo !== null) { where.push("l.year<=?"); values.push(Number(yearTo)); }
    if (timed !== null) { where.push("l.is_timed=?"); values.push(timed ? 1 : 0); }
    if (buyNow) where.push("l.buy_now_usd>0");
    if (auctionState) { where.push("lower(l.auction_state)=lower(?)"); values.push(String(auctionState).trim()); }
    if (upcoming === "only") { where.push("l.auction_at IS NOT NULL AND datetime(l.auction_at)>datetime(?)"); values.push(nowIso); }
    if (upcoming === "without") { where.push("(l.auction_at IS NULL OR datetime(l.auction_at)<=datetime(?))"); values.push(nowIso); }
    if (afterId) {
      const after = await this.db.prepare("SELECT last_seen_at,listing_id FROM auction_listings WHERE listing_id=?").bind(afterId).first();
      if (!after) throw new TypeError("Cursor D1 wskazuje nieznany listing.");
      where.push("(l.last_seen_at<? OR (l.last_seen_at=? AND l.listing_id>?))");
      values.push(after.last_seen_at, after.last_seen_at, after.listing_id);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await this.db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id
      FROM auction_listings l JOIN vehicle_sources s ON s.source_key=l.source_key
      ${whereSql} ORDER BY l.last_seen_at DESC,l.listing_id ASC LIMIT ?`).bind(...values, limit + 1).all();
    const rows = result.results || [];
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const coverage = await this.getCoverage(platform);
    const now = this.now();
    const records = selected.map(row => listingFromRow(row, now, this.maxAgeMs));
    const nextCursor = hasMore && selected.length ? encodeCursor(["listing", selected.at(-1).listing_id]) : null;
    return {
      records,
      page: {per_page: limit, next_cursor: nextCursor, has_more_stored_rows: hasMore},
      read: {source: "d1", freshness: summarizeFreshness(records), coverage,
        known_rows_only: true, catalog_complete: coverage.complete}
    };
  }

  async getListingById(listingId) {
    if (!listingId || String(listingId).length > 512) return null;
    const row = await this.db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id FROM auction_listings l
      JOIN vehicle_sources s ON s.source_key=l.source_key WHERE l.listing_id=? LIMIT 1`).bind(String(listingId)).first();
    return row ? listingFromRow(row, this.now(), this.maxAgeMs) : null;
  }

  async getListingBySource({provider, platform, providerVehicleId}) {
    if (!provider || !platform || !providerVehicleId) return null;
    const row = await this.db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id FROM vehicle_sources s
      JOIN auction_listings l ON l.source_key=s.source_key WHERE s.provider=? AND s.platform=? AND s.provider_vehicle_id=?
      ORDER BY l.last_seen_at DESC,l.listing_id ASC LIMIT 2`).bind(provider, platform, providerVehicleId).all();
    const records = row.results || [];
    return records.length === 1 ? listingFromRow(records[0], this.now(), this.maxAgeMs)
      : records.length > 1 ? {ambiguous: true, matches: records.length} : null;
  }

  async getListingByExactIdentifier({vin = null, lot = null, platform = null}) {
    if (!vin && !lot) return null;
    const where = [];
    const values = [];
    if (vin) { where.push("upper(vin_normalized)=upper(?)"); values.push(String(vin).trim()); }
    if (lot) { where.push("upper(lot)=upper(?)"); values.push(String(lot).trim()); }
    if (platform) { where.push("lower(platform)=lower(?)"); values.push(String(platform).trim()); }
    const rows = await this.db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id FROM auction_listings l
      JOIN vehicle_sources s ON s.source_key=l.source_key WHERE ${where.join(" AND ")} ORDER BY l.last_seen_at DESC LIMIT 2`)
      .bind(...values).all();
    const matches = rows.results || [];
    if (matches.length > 1) return {ambiguous: true, matches: matches.length};
    return matches.length ? listingFromRow(matches[0], this.now(), this.maxAgeMs) : null;
  }

  async getListingByIdentifier(identifier, {platform = null} = {}) {
    const value = clean(identifier);
    if (!value || value.length > 512) return null;
    const rows = await this.db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id FROM auction_listings l
      JOIN vehicle_sources s ON s.source_key=l.source_key
      WHERE (upper(l.vin_normalized)=upper(?) OR upper(l.lot)=upper(?) OR upper(l.source_listing_id)=upper(?))
      ${platform ? "AND lower(l.platform)=lower(?)" : ""}
      ORDER BY l.last_seen_at DESC,l.listing_id ASC LIMIT 2`)
      .bind(...(platform ? [value,value,value,String(platform)] : [value,value,value])).all();
    const matches = rows.results || [];
    if (matches.length > 1) return {ambiguous: true, matches: matches.length};
    return matches.length ? listingFromRow(matches[0], this.now(), this.maxAgeMs) : null;
  }

  async getConfirmedEvents({listingId, limit = 50} = {}) {
    if (!listingId || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Nieprawidłowe parametry event history.");
    const result = await this.db.prepare(`SELECT event_id,provider,provider_event_id,event_key,vin_normalized,platform,lot,
      auction_date,sale_date,source_status,canonical_status,current_bid_usd,buy_now_usd,source_price_usd,final_price_usd,
      seller_name,seller_type,observed_at FROM auction_events WHERE listing_id=?
      ORDER BY COALESCE(sale_date,auction_date,observed_at) DESC,event_id ASC LIMIT ?`).bind(listingId,limit).all();
    return (result.results || []).map(row => ({
      kind: "confirmed_auction_event", event_id: row.event_id, provider: row.provider,
      provider_event_id: clean(row.provider_event_id), event_key: clean(row.event_key),
      vin: clean(row.vin_normalized), platform: clean(row.platform), lot: clean(row.lot),
      auction_date: clean(row.auction_date), sale_date: clean(row.sale_date),
      source_status: clean(row.source_status), status: clean(row.canonical_status),
      current_bid: numberOrNull(row.current_bid_usd), buy_now: numberOrNull(row.buy_now_usd),
      source_price: numberOrNull(row.source_price_usd), final_price: numberOrNull(row.final_price_usd),
      seller: row.seller_name ? {name: row.seller_name, type: clean(row.seller_type)} : null,
      observed_at: clean(row.observed_at)
    }));
  }

  async getSnapshotPage({listingId, limit = 20, cursor = null} = {}) {
    if (!listingId || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new TypeError("Nieprawidłowe parametry snapshot history.");
    let after = null;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      const [observedAt, snapshotId] = decoded.split("\u001f");
      if (!observedAt || !/^\d+$/.test(snapshotId || "")) throw new TypeError("Nieprawidłowy cursor snapshotów.");
      after = {observedAt, snapshotId: Number(snapshotId)};
    }
    const rows = await this.db.prepare(`SELECT snapshot_id,listing_id,observed_at,auction_state,auction_at,timed_end_at,
      current_bid_usd,buy_now_usd,fingerprint,normalizer_version FROM auction_listing_snapshots
      WHERE listing_id=? ${after ? "AND (observed_at<? OR (observed_at=? AND snapshot_id<?))" : ""}
      ORDER BY observed_at DESC,snapshot_id DESC LIMIT ?`).bind(...(after ? [listingId, after.observedAt, after.observedAt, after.snapshotId, limit + 1] : [listingId, limit + 1])).all();
    const selected = (rows.results || []).slice(0, limit);
    const hasMore = (rows.results || []).length > limit;
    const last = selected.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(["listing", `${last.observed_at}\u001f${last.snapshot_id}`]) : null;
    const coverage = await this.getCoverage();
    return {events: [], snapshots: selected.map(row => ({
      kind: "observed_snapshot", snapshot_id: row.snapshot_id, observed_at: row.observed_at,
      auction_state: row.auction_state, auction_at: row.auction_at, timed_end_at: row.timed_end_at,
      current_bid_usd: row.current_bid_usd, buy_now_usd: row.buy_now_usd,
      fingerprint: row.fingerprint, normalizer_version: row.normalizer_version
    })), page: {per_page: limit, next_cursor: nextCursor, has_more_stored_rows: hasMore},
    read: {source: "d1", history_kind: "snapshots_only", confirmed_event_count: 0, coverage}};
  }

  async getFilterMetadata({platform = null} = {}) {
    const where = platform ? "WHERE platform=?" : "";
    const query = this.db.prepare(`SELECT make,model,year,location_state,auction_state FROM auction_listings ${where}`);
    const result = platform ? await query.bind(platform).all() : await query.all();
    const rows = result.results || [];
    const unique = (key, sort = (a,b) => String(a).localeCompare(String(b))) => [...new Set(rows.map(row => row[key]).filter(value => value !== null && value !== undefined && value !== ""))].sort(sort);
    const coverage = await this.getCoverage(platform);
    return {values: {
      makes: unique("make").map(value => ({value, label: value})),
      models: [...new Map(rows.filter(row => row.make && row.model).map(row => [`${row.make}\u0000${row.model}`, {make: row.make, model: row.model}])).values()],
      years: unique("year", (a,b) => Number(a) - Number(b)),
      states: unique("location_state"), auction_states: unique("auction_state")
    }, read: {source: "d1", coverage, metadata_complete: coverage.complete, known_rows_only: true, row_count: rows.length}};
  }
}

function summarizeFreshness(records) {
  const statuses = records.map(record => record.freshness.status);
  return {status: !statuses.length ? "unknown" : statuses.every(status => status === "fresh") ? "fresh"
    : statuses.some(status => status === "stale") ? "stale" : "unknown",
  last_seen_at: records.map(record => record.freshness.last_seen_at).filter(Boolean).sort().at(-1) || null,
  last_synced_at: records.map(record => record.freshness.last_synced_at).filter(Boolean).sort().at(-1) || null};
}

function toPublicVehicleDTO(vehicle) {
  return {
    vehicle_id: vehicle.provider_vehicle_id, platform: vehicle.platform, vin: vehicle.vin, slug_vin: vehicle.vin,
    lot_number: vehicle.lot, title: vehicle.title, year: vehicle.year, make: vehicle.make, model: vehicle.model,
    trim: vehicle.trim, body_style: null, fuel_type: null, transmission: null, drive_type: null, engine_size_l: null,
    auction: {state: vehicle.auction.state, formatted: vehicle.auction.source_status, auction_at: vehicle.auction.auction_at,
      is_timed: vehicle.auction.timed, timed_end_at: vehicle.auction.timed_end_at},
    pricing: {current_bid_usd: vehicle.pricing.current_bid, current_bid2_usd: vehicle.pricing.current_bid_secondary,
      buy_now_usd: vehicle.pricing.buy_now, final_price_usd: vehicle.pricing.final_price, source_price_usd: vehicle.pricing.source_price},
    seller: {name: vehicle.seller.name, type: vehicle.seller.type},
    condition: {primary_damage: vehicle.condition.primary_damage, secondary_damage: vehicle.condition.secondary_damage,
      run_condition: vehicle.condition.run_state, has_key: vehicle.condition.keys_present, airbags: vehicle.condition.airbags},
    sale_document: {name: vehicle.document.name, type: vehicle.document.type,
      registration: vehicle.document.registration, export: vehicle.document.export},
    location: vehicle.location, odometer: vehicle.odometer,
    media: {items: [], thumbs: [], has_video: vehicle.media.has_video, has_360: vehicle.media.has_360}
  };
}

module.exports = {D1ReadRepository, canonicalVehicle, toPublicVehicleDTO, encodeCursor, decodeCursor, MAX_PAGE_SIZE, KNOWN_PLATFORMS};
