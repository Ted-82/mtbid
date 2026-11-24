'use strict';

const missingSchemaUntil = new WeakMap();
const catalogPriceCache = new WeakMap();
const CACHE_MS = 60_000;

// A relisted or duplicated LOT should only be merged when it has one unambiguous D1 row.
const SQL = `SELECT lot, vin_normalized, listing_generation, current_bid_usd, is_timed, auction_state,
    timed_end_at, timed_bid_evidence
  FROM auction_listings AS l INDEXED BY idx_listings_lot_recent
  WHERE platform = 'iaai' AND lot IN (SELECT value FROM json_each(?))
  GROUP BY lot
  HAVING COUNT(*) = 1 AND length(timed_bid_evidence) BETWEEN 2 AND 512`;

function timestamp(value) {
  return typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
}

async function selectEvidence(database, entries, now) {
  if (now < (missingSchemaUntil.get(database) || 0)) return new Map();
  try {
    const lots = entries.map(entry => entry.lot_number);
    const {results} = await database.prepare(SQL).bind(JSON.stringify(lots)).all();
    return new Map(results.map(row => [row.lot, row]));
  } catch (error) {
    if (/no such (?:column|index)/i.test(String(error?.message))) {
      missingSchemaUntil.set(database, now + CACHE_MS);
    }
    return new Map();
  }
}

function effectiveBid(entry, row, snapshotTime, now) {
  if (!row || row.is_timed !== 1 || row.auction_state !== 'open' ||
      row.vin_normalized !== entry.vin || entry.platform !== 'iaai') return entry;
  let evidence;
  try { evidence = JSON.parse(row.timed_bid_evidence); }
  catch { return entry; }
  if (!evidence || !Number.isSafeInteger(evidence.seq) || evidence.seq < 1) return entry;

  const deadline = timestamp(entry.auction?.timed_end_at);
  const observed = timestamp(evidence.at);
  const sameCycle = evidence.vin === entry.vin && evidence.gen === row.listing_generation &&
    (evidence.cycle ?? null) === (entry.timed_source_cycle ?? null) &&
    (row.listing_generation == null || evidence.cycle != null) &&
    deadline === timestamp(row.timed_end_at) && deadline === timestamp(evidence.end);
  const newer = observed > snapshotTime && observed <= now && now < deadline;
  const validBid = evidence.bid === null || (Number.isFinite(evidence.bid) && evidence.bid > 0);
  if (!sameCycle || !newer || !validBid || evidence.bid !== row.current_bid_usd) return entry;

  return {...entry, pricing: {...entry.pricing, current_bid_usd: evidence.bid,
    current_bid_observed_at: evidence.at, current_bid_source: 'apibara_feed'}};
}

async function priceRows(database, entries, snapshot, now, wholeCatalog = false) {
  if (!database?.prepare || !entries.length) return entries;
  let observations;
  if (wholeCatalog) {
    // All price filters share identical observations while this snapshot and minute are current.
    let cached = catalogPriceCache.get(snapshot);
    if (!cached || cached.database !== database || now >= cached.expiresAt) {
      cached = {database, expiresAt: now + CACHE_MS, observations: selectEvidence(database, entries, now)};
      catalogPriceCache.set(snapshot, cached);
    }
    observations = await cached.observations;
  } else {
    observations = await selectEvidence(database, entries, now);
  }
  return entries.map(entry => effectiveBid(entry, observations.get(entry.lot_number), snapshot.stamp, now));
}

module.exports = {priceRows, effectiveBid, SQL};
