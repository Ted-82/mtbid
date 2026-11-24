const market = require("../public/rexbid-market.js");
"use strict";

const contract = require("../providers/contract.js");
const { safeMediaReferences } = require("./core.js");
const { unpackMediaJson } = require("./catalog-media-storage.cjs");
const catalogOrder = require("./catalog-order.cjs");

const KNOWN_PLATFORMS = Object.freeze(["copart", "iaai"]);
const MAX_PAGE_SIZE = 50;
// Explicit names observed in provider metadata; no fuzzy/prefix matching.
// Preserve source labels in vehicle records while grouping the search controls.
const MAKE_FAMILIES = Object.freeze([
  ['LUCID', 'LUCID MOTORS'],
  ['FISKER', 'FISKER AUTOMOTIVE'],
  ['MCLAREN', 'MCLAREN AUTOMOTIVE'],
  ['MERCEDES-BENZ', 'MERCEDES BENZ', 'MERCEDES']
]);
function makeFamily(value) {
  const key = String(value || '').trim().toUpperCase();
  return MAKE_FAMILIES.find(names => names.includes(key)) || [key];
}
// Known makes at the beginning of the search can use the existing make index.
// Unrecognised terms retain the original keyword path (including partial VIN).
const SEARCH_MAKES = [
  'MERCEDES-BENZ','MERCEDES BENZ','LAND ROVER','ALFA ROMEO','ASTON MARTIN',
  'ROLLS-ROYCE','LUCID MOTORS','FISKER AUTOMOTIVE','MCLAREN AUTOMOTIVE',
  ...'ACURA AUDI BMW BUICK CADILLAC CHEVROLET CHRYSLER DODGE FERRARI FIAT FISKER FORD GENESIS GMC HONDA HYUNDAI INFINITI JAGUAR JEEP KIA LAMBORGHINI LEXUS LINCOLN LOTUS LUCID MASERATI MAZDA MCLAREN MERCEDES MINI MITSUBISHI NISSAN POLESTAR PORSCHE RAM RIVIAN SAAB SUBARU SUZUKI TESLA TOYOTA VOLKSWAGEN VOLVO'.split(' ')
];
function indexedMakeSearch(term) {
  const upper=term.toUpperCase();
  const prefix=SEARCH_MAKES.find(name=>upper===name||upper.startsWith(name+' '));
  return prefix?{names:makeFamily(prefix),model:term.slice(prefix.length).trim()}:null;
}
function makeLabel(value) {
  const text = String(value || '').trim();
  return MAKE_FAMILIES.find(names => names.includes(text.toUpperCase()))?.[0] || text;
}
// Conservative categories from explicit source body labels; never from make/model.
// Ambiguous labels (e.g. SPORT) remain individual source options.
const VEHICLE_BODY_GROUPS = Object.freeze({
  'kind:car': {label:'Samochody', values:['sedan','sedan 4dr','sedan 4d','sedan 4 door','hatchback','hatchback 2dr','hatchback 4dr','hatchback 4 door','coupe','coupe 2 door','convertible','convertible 2 door','wagon','station wagon','wagon/hatchback','sedan/hatchback','suv','suv 2 door','suv 4 door','sport utility','sport utility vehicle','4dr sport utility','suv/crossover']},
  'kind:motorcycle': {label:'Motocykle', values:['motorcycle','cruiser']},
  'kind:atv': {label:'ATV / quady', values:['atv','quad']}
});

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

function mediaList(value, kind = "image") {
  if (typeof value !== "string" || value.length > 64_000) return [];
  const json = unpackMediaJson(value);
  if (json.length > 64_000) return [];
  try { return safeMediaReferences(JSON.parse(json), kind); } catch { return []; }
}

function encodeCursor(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(cursor, maxLength = 512) {
  if (!cursor) return null;
  if (String(cursor).length > maxLength || !/^[A-Za-z0-9_-]+$/.test(String(cursor))) throw new TypeError("Nieprawidłowy cursor D1.");
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
  const schedule = contract.classifyAuctionSchedule({platform: row.platform, state: row.auction_state,
    source_status: row.source_status, auction_at: row.auction_at, timed: Number(row.is_timed) === 1});
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
    body_style: clean(row.body_style),
    fuel_type: clean(row.fuel_type),
    transmission: clean(row.transmission),
    drive_type: clean(row.drive_type),
    engine_size_l: numberOrNull(row.engine_size_l),
    auction: contract.createRexAuction({
      state: clean(row.auction_state), source_status: clean(row.source_status),
      auction_at: schedule.auction_at, schedule_status: schedule.status,
      schedule_precision: schedule.precision, auction_timezone: schedule.timezone,
      timed: booleanOrNull(row.is_timed),
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
    media: contract.createRexMedia({items: mediaList(row.media_urls_json), thumbs: mediaList(row.media_thumbs_json, "thumb"),
      has_video: booleanOrNull(row.has_video), has_360: booleanOrNull(row.has_360)}),
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
  const failedAttempt = Boolean(row.source_last_error_code && timestamp(row.source_last_attempt_at) !== null
    && timestamp(row.source_last_attempt_at) >= (timestamp(row.source_last_success_at) ?? -1));
  const status = failedAttempt ? "stale" : ageMs === null ? "unknown" : ageMs <= maxAgeMs ? "fresh" : "stale";
  return {status, age_ms: ageMs, last_synced_at: syncedAt, last_seen_at: clean(row.last_seen_at),
    ...(failedAttempt ? {latest_attempt_failed:true} : {})};
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
  constructor(db, {maxAgeMs = 86_400_000, now = () => Date.now(), cacheCoverage = false, membership = null} = {}) {
    if (!db || typeof db.prepare !== "function") throw new TypeError("Wymagany jest binding D1 read-only.");
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) throw new TypeError("maxAgeMs musi być nieujemną liczbą całkowitą.");
    this.db = db;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
    // Opt in only for repositories whose lifetime is one public request.
    this.cacheCoverage = cacheCoverage;
    this.coverageRows = null;
    this.membership = membership;
  }

  async getCoverage(platform = null) {
    const current = this.membership ? await this.membership.coverage(platform) : null;
    if(current) return current;
    let rows;
    if (this.cacheCoverage) {
      if (!this.coverageRows) {
        this.coverageRows = this.db.prepare("SELECT provider,platform,status,cursor,last_complete_at FROM provider_sync_scopes WHERE operation='discovery' ORDER BY platform,provider")
          .all().then(result => result.results || []);
      }
      rows = await this.coverageRows;
    } else {
      const query = platform
        ? this.db.prepare("SELECT provider,platform,status,cursor,last_complete_at FROM provider_sync_scopes WHERE operation='discovery' AND platform=? ORDER BY provider").bind(platform)
        : this.db.prepare("SELECT provider,platform,status,cursor,last_complete_at FROM provider_sync_scopes WHERE operation='discovery' ORDER BY platform,provider");
      rows = (await query.all()).results || [];
    }
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

  async listCatalog({category = null, withPhoto = false, homeWeek = false, platform = null, make = null, model = null, yearFrom = null, yearTo = null,
    timed = null, buyNow = false, auctionState = null, sourceStatus = null, upcoming = null, search = null,
    bodyStyle = null, fuelType = null, transmission = null, driveType = null, runCondition = null,
    damage = null, sellerType = null, saleDocumentType = null, saleDocumentName = null, locationState = null,
    priceMin = null, priceMax = null, odometerFrom = null, odometerTo = null,
    observedAfter = null, nowIso = new Date(this.now()).toISOString(),
    limit = 20, cursor = null, sort = 'recent', datedOnly = false, assignedOnly = false, homeShowcase = false} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new RangeError("D1 page size must be 1..50.");
    const view = this.membership ? await this.membership.view() : null;
    let afterId;try{afterId=decodeCursor(cursor,view?.active?2048:512);}catch(error){if(view?.active)throw catalogOrder.invalid('INVALID_CATALOG_CURSOR');throw error;}
    if(afterId && view?.active){
      let anchor;try{anchor=JSON.parse(afterId);}catch{throw catalogOrder.invalid('INVALID_CATALOG_CURSOR');}
      if(anchor?.v!==2||anchor.baselineId!==view.baselineId||anchor.revision!==view.revision||typeof anchor.anchor!=='string'||!anchor.anchor)
        throw catalogOrder.invalid('INVALID_CATALOG_CURSOR');
      afterId=anchor.anchor;
    }
    sort = catalogOrder.parseSort(sort);
    const anchor = afterId && catalogOrder.ORDERS[sort] ? catalogOrder.parseAnchor(afterId,sort) : null;
    const chronological = catalogOrder.isAuctionOrder(sort);
    const asOf = chronological || datedOnly ? anchor?.asOf ?? Date.parse(nowIso) : null;
    if (asOf !== null && (!Number.isSafeInteger(asOf) || asOf<0 || asOf>Date.parse(nowIso))) throw catalogOrder.invalid('INVALID_CATALOG_CURSOR');
    const order = chronological ? {...catalogOrder.ORDERS[sort],expression:catalogOrder.auctionKey} : catalogOrder.ORDERS[sort];
    const where = [];
    const values = [];
    let candidatePredicate = null;
    const candidateValues = [];
    if (homeWeek) {
      // Apply the listing-only date predicate before checking membership and
      // the related source row. Keep the existing date and ordering rules.
      const schedule = "CASE WHEN l.is_timed=1 THEN l.timed_end_at ELSE l.auction_at END";
      where.push(`(${schedule} IS NOT NULL AND (
        (length(${schedule})=10 AND date(${schedule})>=date(?) AND date(${schedule})<=date(?, '+7 days')) OR
        (length(${schedule})>10 AND datetime(${schedule})>datetime(?) AND datetime(${schedule})<=datetime(?, '+7 days'))
      ))`);
      values.push(nowIso, nowIso, nowIso, nowIso);
    }
    if(view?.active){where.push("l.auction_state IN ('open','live') AND EXISTS(SELECT 1 FROM feed_catalog_membership cm WHERE cm.baseline_id=? AND cm.listing_id=l.listing_id AND cm.active=1)");values.push(view.baselineId);}
    if (chronological || datedOnly) {
      const filter=catalogOrder.futureAuction(asOf, {after: chronological ? anchor?.value : null, direction: order?.direction});
      where.push(filter.sql); values.push(...filter.values);
    }
    if (assignedOnly) where.push(`(${catalogOrder.assignedDateKey}) IS NOT NULL`);
    if (saleDocumentName !== null && saleDocumentName !== '') {
      if (typeof saleDocumentName !== 'string' || saleDocumentName.length > 256 || !saleDocumentName.trim()) throw new TypeError('Nieprawidłowa nazwa dokumentu.');
      where.push("lower(trim(COALESCE(l.document_name,'')))=lower(?)");
      values.push(saleDocumentName.trim());
    }
    if (category) {
      const filter=market.sql(market.resolve(category),nowIso);where.push(...filter.where);values.push(...filter.values);
      where.push("NOT (s.last_error_code IS NOT NULL AND s.last_attempt_at IS NOT NULL AND (s.last_success_at IS NULL OR datetime(s.last_attempt_at)>=datetime(s.last_success_at)))");
    }
    if (withPhoto) {
      where.push("(length(trim(COALESCE(l.media_thumbs_json, ''))) > 2 OR length(trim(COALESCE(l.media_urls_json, ''))) > 2)");
    }
    if (observedAfter) { where.push("datetime(l.summary_synced_at)>=datetime(?)"); values.push(observedAfter); }
    if (platform) { where.push("l.platform=?"); values.push(String(platform).toLowerCase()); }
    if (make) {
      const names = makeFamily(make);
      where.push(`upper(trim(l.make)) IN (${names.map(() => '?').join(',')})`);
      values.push(...names);
    }
    if (model) { where.push("lower(l.model)=lower(?)"); values.push(String(model).trim()); }
    if (search) {
      let term = market.normalizeSearch(search);
      // Accept a model and year in either order, while keeping all explicit filters.
      const leadingYear=/^(19\d{2}|20\d{2})\s+(.+)$/.exec(term), trailingYear=/^(.+?)\s+(19\d{2}|20\d{2})$/.exec(term);
      const requestedYear=leadingYear?.[1]??trailingYear?.[2], modelWords=leadingYear?.[2]??trailingYear?.[1];
      if (requestedYear && /[a-z]/i.test(modelWords) && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(modelWords)) {
        where.push("l.year=?"); values.push(Number(requestedYear)); term=modelWords;
      }
      if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(term)) {
        // A complete VIN is an identifier lookup. Wrapping the indexed column
        // in instr/coalesce made an exact search scan the entire recent catalog.
        candidatePredicate="upper(vin_normalized)=upper(?)";candidateValues.push(term);
      } else if (/^\d{8}$/.test(term)) {
        // Preserve leading zeroes and platform/membership/status predicates.
        // Short/partial numbers and names retain the ordinary keyword path.
        candidatePredicate="upper(lot)=upper(?)";candidateValues.push(term);
      } else if (term) {
        const known=indexedMakeSearch(term);
        if(known){
          candidatePredicate=`upper(trim(make)) IN (${known.names.map(()=>'?').join(',')})`;
          candidateValues.push(...known.names);
          if(known.model){candidatePredicate+=" AND (instr(upper(COALESCE(model,'')),upper(?))>0 OR instr(upper(COALESCE(vehicle_title,'')),upper(?))>0)";candidateValues.push(known.model,known.model);}
        } else {
          where.push(`(instr(upper(COALESCE(l.vin_normalized,'')),upper(?))>0
          OR instr(upper(COALESCE(l.lot,'')),upper(?))>0
          OR instr(upper(COALESCE(l.vehicle_title,'')),upper(?))>0
          OR instr(upper(COALESCE(l.make,'')||' '||COALESCE(l.model,'')),upper(?))>0)`);
          values.push(term, term, term, term);
        }
      }
    }
    if (chronological && make && !candidatePredicate) {
      const names=makeFamily(make);
      candidatePredicate=`upper(trim(make)) IN (${names.map(()=>'?').join(',')})`;
      candidateValues.push(...names);
      if (model) {
        candidatePredicate+=' AND lower(model)=lower(?)';
        candidateValues.push(String(model).trim());
      }
    }
    if (candidatePredicate && chronological) {
      if (yearFrom !== null) { candidatePredicate += " AND year>=?"; candidateValues.push(Number(yearFrom)); }
      if (yearTo !== null) { candidatePredicate += " AND year<=?"; candidateValues.push(Number(yearTo)); }
    } else {
      if (yearFrom !== null) { where.push("l.year>=?"); values.push(Number(yearFrom)); }
      if (yearTo !== null) { where.push("l.year<=?"); values.push(Number(yearTo)); }
    }
    if (homeShowcase && timed===true) where.push("l.is_timed=1");
    else if (timed !== null) { where.push("l.is_timed=?"); values.push(timed ? 1 : 0); }
    if (buyNow) where.push("l.buy_now_usd>0");
    if (auctionState) {
      const state = String(auctionState).trim();
      if (state.toLowerCase() === 'live') {
        // SQLite can match this literal predicate to the sparse Live index.
        where.push("(lower(l.auction_state)='live' OR lower(COALESCE(l.source_status,''))='live')");
      } else {
        where.push("(lower(l.auction_state)=lower(?) OR lower(COALESCE(l.source_status,''))=lower(?))");
        values.push(state, state);
      }
    }
    if (sourceStatus) { where.push("lower(COALESCE(l.source_status,''))=lower(?)"); values.push(String(sourceStatus).trim()); }
    for (const [column, value] of [["body_style",bodyStyle],["fuel_type",fuelType],["transmission",transmission],
      ["drive_type",driveType],["run_state",runCondition],["primary_damage",damage],["seller_type",sellerType],
      ["document_type",saleDocumentType],["location_state",locationState]]) {
      if (value && column === 'body_style' && VEHICLE_BODY_GROUPS[value]) {
        const group = VEHICLE_BODY_GROUPS[value].values;
        where.push(`lower(trim(COALESCE(l.body_style,''))) IN (${group.map(()=>'?').join(',')})`);
        values.push(...group);
      } else if (value && column === "fuel_type" && /^(?:electric|bev|battery electric)$/i.test(String(value).trim())) {
        // The EV aisle includes only explicit BEV source labels. Hybrid labels
        // are deliberately excluded; rows are filtered before pagination.
        where.push("lower(trim(COALESCE(l.fuel_type,''))) IN ('electric','bev','battery electric','battery electric vehicle','all electric','pure electric','fully electric')");
      } else if (value) {
        const groups = {
          fuel_type: [['gas','gasoline','petrol'],['hybrid','hev','electric and gas hybrid','hybrid engine'],['flexible','flexible fuel','flexiblefuel','flex fuel']],
          transmission: [['automatic','automatic transmission'],['manual','manual transmission']],
          drive_type: [['all wheel drive','awd'],['front wheel drive','front-wheel drive','fwd'],['rear wheel drive','rear-wheel drive','rwd'],['four wheel drive','four by four','4wd']],
          seller_type: [['insurance','insurance company','ins','ubezpieczyciel'],['non_insurance','non-insurance','non insurance company','nins']]
        };
        const group = groups[column]?.find(items=>items.includes(String(value).trim().toLowerCase()));
        if (group) { where.push(`lower(trim(COALESCE(l.${column},''))) IN (${group.map(()=>'?').join(',')})`); values.push(...group); }
        else { where.push(`lower(COALESCE(l.${column},''))=lower(?)`); values.push(String(value).trim()); }
      }
    }
    if (priceMin !== null) { where.push("COALESCE(l.current_bid_usd,l.buy_now_usd)>=?"); values.push(Number(priceMin)); }
    if (priceMax !== null) { where.push("COALESCE(l.current_bid_usd,l.buy_now_usd)<=?"); values.push(Number(priceMax)); }
    if (odometerFrom !== null) { where.push("l.odometer_value>=?"); values.push(Number(odometerFrom)); }
    if (odometerTo !== null) { where.push("l.odometer_value<=?"); values.push(Number(odometerTo)); }
    if (upcoming === "only") { where.push("l.auction_at IS NOT NULL AND datetime(l.auction_at)>datetime(?) AND NOT (lower(l.platform)='copart' AND lower(COALESCE(l.source_status,'')) IN ('upcoming','future','unassigned'))"); values.push(nowIso); }
    if (upcoming === "without") { where.push("(l.auction_at IS NULL OR datetime(l.auction_at)<=datetime(?))"); values.push(nowIso); }
    if (afterId && order) {
      const clause = catalogOrder.afterClause(order,anchor);
      where.push(clause.sql); values.push(...clause.values);
    } else if (afterId) {
      if (afterId.startsWith('{')) throw catalogOrder.invalid('INVALID_CATALOG_CURSOR');
      const after = await this.db.prepare("SELECT last_seen_at,listing_id FROM auction_listings WHERE listing_id=?").bind(afterId).first();
      if (!after) throw new TypeError("Cursor D1 wskazuje nieznany listing.");
      where.push("(l.last_seen_at<? OR (l.last_seen_at=? AND l.listing_id>?))");
      values.push(after.last_seen_at, after.last_seen_at, after.listing_id);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const orderSql = chronological ? `(${order.expression}) ${order.direction},l.listing_id ${order.direction}`
      : order ? `(${order.expression} IS NULL) ASC,${order.expression} ${order.direction},l.listing_id ASC` : 'l.last_seen_at DESC,l.listing_id ASC';
    const useAuctionIndex = chronological && view?.active && !candidatePredicate && category!=='timed';
    // These four first pages sort by the latest observation. The date index
    // instead scans and sorts the entire eligible window before LIMIT applies.
    const showcaseIndex = homeShowcase && view?.active && sort==='recent' && !afterId &&
      (timed===true ? 'idx_listings_public_timed_recent' : buyNow ?
        'idx_listings_public_buy_now_recent' : 'idx_listings_public_recent');
    const index = useAuctionIndex ? catalogOrder.auctionIndex : showcaseIndex;
    const from = candidatePredicate ? `(SELECT * FROM auction_listings WHERE ${candidatePredicate} LIMIT -1 OFFSET 0) l`
      : `auction_listings l${index?` INDEXED BY ${index}`:''}`;
    // Keep exact candidates as a non-flattened read-only subquery: otherwise
    // extra filters can make SQLite choose a broad recent/buy-now index first.
    const result = await this.db.prepare(`SELECT l.*${order ? ','+order.expression+' AS catalog_sort_value' : ''},s.provider,s.provider_vehicle_id,s.last_attempt_at AS source_last_attempt_at,s.last_success_at AS source_last_success_at,s.last_error_code AS source_last_error_code
      FROM ${from} JOIN vehicle_sources s ON s.source_key=l.source_key
      ${whereSql} ORDER BY ${orderSql} LIMIT ?`).bind(...candidateValues, ...values, limit + 1).all();
    const rows = result.results || [];
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const coverage = await this.getCoverage(platform);
    const now = this.now();
    const records = selected.map(row => ({...listingFromRow(row, now, this.maxAgeMs),...(view?.active?{catalog_scope:"active"}:{})}));
    const last = selected.at(-1);
    const innerAnchor = last ? (order ? JSON.stringify({v:1,sort,value:last.catalog_sort_value??null,id:last.listing_id,...(chronological?{asOf}:{})}) : last.listing_id) : null;
    const nextCursor = hasMore && last ? encodeCursor(["listing", view?.active
      ? JSON.stringify({v:2,baselineId:view.baselineId,revision:view.revision,anchor:innerAnchor}) : innerAnchor]) : null;
    return {
      records,
      page: {per_page: limit, next_cursor: nextCursor, has_more_stored_rows: hasMore, sort},
      read: {source: "d1", freshness: summarizeFreshness(records), coverage,
        known_rows_only: true, catalog_complete: coverage.complete,
        servedByPrimary: result.meta?.served_by_primary}
    };
  }

  async publicListing(row) {
    if(!row)return null;
    const result=listingFromRow(row,this.now(),this.maxAgeMs);
    const scope=this.membership?await this.membership.listingScope(row.listing_id,row.auction_state):null;
    if(scope)result.catalog_scope=scope;
    return result;
  }

  async getListingById(listingId) {
    if (!listingId || String(listingId).length > 512) return null;
    const row = await this.db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id,s.last_attempt_at AS source_last_attempt_at,s.last_success_at AS source_last_success_at,s.last_error_code AS source_last_error_code FROM auction_listings l
      JOIN vehicle_sources s ON s.source_key=l.source_key WHERE l.listing_id=? LIMIT 1`).bind(String(listingId)).first();
    return this.publicListing(row);
  }

  async getListingBySource({provider, platform, providerVehicleId}) {
    if (!provider || !platform || !providerVehicleId) return null;
    const row = await this.db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id,s.last_attempt_at AS source_last_attempt_at,s.last_success_at AS source_last_success_at,s.last_error_code AS source_last_error_code FROM vehicle_sources s
      JOIN auction_listings l ON l.source_key=s.source_key WHERE s.provider=? AND s.platform=? AND s.provider_vehicle_id=?
      ORDER BY l.last_seen_at DESC,l.listing_id ASC LIMIT 2`).bind(provider, platform, providerVehicleId).all();
    const records = row.results || [];
    return records.length === 1 ? this.publicListing(records[0])
      : records.length > 1 ? {ambiguous: true, matches: records.length} : null;
  }

  async getListingByExactIdentifier({vin = null, lot = null, platform = null}) {
    if (!vin && !lot) return null;
    const where = [];
    const values = [];
    if (vin) { where.push("upper(l.vin_normalized)=upper(?)"); values.push(String(vin).trim()); }
    if (lot) { where.push("upper(l.lot)=upper(?)"); values.push(String(lot).trim()); }
    if (platform) { where.push("lower(l.platform)=lower(?)"); values.push(String(platform).trim()); }
    const rows = await this.db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id,s.last_attempt_at AS source_last_attempt_at,s.last_success_at AS source_last_success_at,s.last_error_code AS source_last_error_code FROM auction_listings l
      JOIN vehicle_sources s ON s.source_key=l.source_key WHERE ${where.join(" AND ")} ORDER BY l.last_seen_at DESC LIMIT 2`)
      .bind(...values).all();
    const matches = rows.results || [];
    if (matches.length > 1) return {ambiguous: true, matches: matches.length};
    return matches.length ? this.publicListing(matches[0]) : null;
  }

  async getListingByIdentifier(identifier, {platform = null, includeAssignedDate = false} = {}) {
    const value = clean(identifier);
    if (!value || value.length > 512) return null;
    const dateColumn = includeAssignedDate ? `,(${catalogOrder.assignedDateKey}) AS assigned_auction_epoch` : "";
    const rows = await this.db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id,s.last_attempt_at AS source_last_attempt_at,s.last_success_at AS source_last_success_at,s.last_error_code AS source_last_error_code${dateColumn} FROM auction_listings l
      JOIN vehicle_sources s ON s.source_key=l.source_key
      WHERE (upper(l.vin_normalized)=upper(?) OR upper(l.lot)=upper(?) OR upper(l.source_listing_id)=upper(?))
      ${platform ? "AND lower(l.platform)=lower(?)" : ""}
      ORDER BY l.last_seen_at DESC,l.listing_id ASC LIMIT 2`)
      .bind(...(platform ? [value,value,value,String(platform)] : [value,value,value])).all();
    const matches = rows.results || [];
    if (matches.length > 1) return {ambiguous: true, matches: matches.length};
    if (!matches.length) return null;
    const stored = await this.publicListing(matches[0]);
    if (includeAssignedDate) stored.auctionDateAssigned = Number.isFinite(matches[0].assigned_auction_epoch);
    return stored;
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

  async getHistoryAvailability({listingId, events = []} = {}) {
    if (!listingId) throw new TypeError("Wymagany listingId historii.");
    // A snapshot/detail clock is not evidence that auction history was fetched.
    // The operator importer records its successful page in this existing scope table.
    const receipt = await this.db.prepare(`SELECT status,last_success_at,last_complete_at
      FROM provider_sync_scopes WHERE scope_key=? AND operation='history_refresh'`).bind(`history-import:${listingId}`).first();
    const eventObservation = events.map(item => item.observed_at).filter(value => Number.isFinite(Date.parse(value || ""))).sort().at(-1) || null;
    const fetchedAt = receipt?.last_success_at || eventObservation;
    return {state: receipt?.status === "failed" ? "read_failed" : receipt?.status === "partial" ? "partial" : events.length ? "stored" : fetchedAt ? "fetched_empty" : "not_fetched",
      fetched_at: fetchedAt, complete: Boolean(receipt?.status === "complete" && receipt.last_complete_at),
      stored_event_count: events.length};
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
    const view=this.membership?await this.membership.view():null;
    const predicates=platform?["platform=?"]:[],parameters=platform?[platform]:[];
    if(view?.active){predicates.push("auction_state IN ('open','live') AND EXISTS(SELECT 1 FROM feed_catalog_membership cm WHERE cm.baseline_id=? AND cm.listing_id=auction_listings.listing_id AND cm.active=1)");parameters.push(view.baselineId);}
    const where=predicates.length?"WHERE "+predicates.join(" AND "):"";
    // Scan the known rows once in D1, transferring only distinct values instead
    // of fourteen fields for every listing into the Worker's memory. BINARY
    // equality preserves the original JavaScript Set's case-sensitive inputs;
    // display aliases and document-name ASCII folding still happen below.
    const fields = ["make","year","location_state","auction_state","body_style","fuel_type","transmission","drive_type","run_state","primary_damage","seller_type","document_type","document_name"];
    const aggregates = fields.map(name => `json_group_array(DISTINCT ${name === 'document_name' ? 'trim(document_name)' : name} COLLATE BINARY) AS ${name}_values`);
    const query = this.db.prepare(`SELECT COUNT(*) AS row_count,${aggregates.join(',')},
      json_group_array(DISTINCT json_object('make',make,'model',model))
        FILTER (WHERE make IS NOT NULL AND make<>'' AND model IS NOT NULL AND model<>'') AS model_pairs
      FROM auction_listings ${where}`);
    const result = parameters.length ? await query.bind(...parameters).all() : await query.all();
    const row = result.results?.[0];
    if (!row || !Number.isSafeInteger(row.row_count) || row.row_count < 0) throw new TypeError("Invalid stored filter aggregate.");
    const array = value => {const parsed = JSON.parse(value);if (!Array.isArray(parsed)) throw new TypeError("Invalid stored filter aggregate.");return parsed;};
    const values = Object.fromEntries(fields.map(name => [name,array(row[name+'_values'])]));
    const modelPairs = array(row.model_pairs);
    if (modelPairs.some(pair => !pair || typeof pair !== 'object' || Array.isArray(pair) || !Object.hasOwn(pair,'make') || !Object.hasOwn(pair,'model')))
      throw new TypeError("Invalid stored model aggregate.");
    const unique = (key, sort = (a,b) => String(a).localeCompare(String(b))) => [...new Set(values[key].filter(value => value !== null && value !== undefined && value !== ""))].sort(sort);
    const coverage = await this.getCoverage(platform);
    // Names are source facts, not colours or permission to export/register.
    // Fold ASCII only, matching SQLite lower() used by the exact predicate.
    const documentNames = new Map();
    for (const name of values.document_name) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const key = name.replace(/[A-Z]/g, char => char.toLowerCase());
      if (!documentNames.has(key)) documentNames.set(key, {value:name,label:name});
    }
    return {values: {
      makes: [...new Set(unique("make").map(makeLabel))].sort().map(value => ({value, label: value})),
      models: [...new Map(modelPairs.filter(pair => pair.make && pair.model).map(pair => [`${makeLabel(pair.make)}\u0000${pair.model}`, {make: makeLabel(pair.make), model: pair.model}])).values()],
      years: unique("year", (a,b) => Number(a) - Number(b)),
      states: unique("location_state"), auction_states: unique("auction_state"),
      body_styles: unique("body_style"), fuel_types: unique("fuel_type"),
      vehicle_types: [...Object.entries(VEHICLE_BODY_GROUPS).filter(([,group])=>values.body_style.some(value=>group.values.includes(String(value||'').trim().toLowerCase()))).map(([value,group])=>({value,label:group.label})), ...unique('body_style').map(value=>({value,label:'Nadwozie: '+value}))],
      transmissions: unique("transmission"), drive_types: unique("drive_type"),
      run_conditions: unique("run_state"), damages: unique("primary_damage"),
      seller_types: unique("seller_type"), sale_document_types: unique("document_type"),
      sale_document_names: [...documentNames.values()].sort((a,b)=>a.label.localeCompare(b.label))
    }, read: {source: "d1", coverage, metadata_complete: coverage.complete, known_rows_only: true, row_count: row.row_count}};
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
    trim: vehicle.trim, body_style: vehicle.body_style, fuel_type: vehicle.fuel_type,
    transmission: vehicle.transmission, drive_type: vehicle.drive_type, engine_size_l: vehicle.engine_size_l,
    auction: {state: vehicle.auction.state, formatted: vehicle.auction.source_status,
      phase: vehicle.auction.phase || contract.auctionPhase(vehicle.auction.source_status),
      outcome_status: /sold|approval|no.?sale/i.test(vehicle.auction.source_status || "") ? vehicle.auction.source_status : null,
      auction_at: vehicle.auction.auction_at,
      schedule_status: vehicle.auction.schedule_status, schedule_precision: vehicle.auction.schedule_precision,
      auction_timezone: vehicle.auction.auction_timezone,
      is_timed: vehicle.auction.timed, timed_end_at: vehicle.auction.timed_end_at},
    pricing: {current_bid_usd: vehicle.pricing.current_bid, current_bid2_usd: vehicle.pricing.current_bid_secondary,
      buy_now_usd: vehicle.pricing.buy_now, final_price_usd: vehicle.pricing.final_price, source_price_usd: vehicle.pricing.source_price},
    seller: {name: vehicle.seller.name, type: vehicle.seller.type},
    condition: {primary_damage: vehicle.condition.primary_damage, secondary_damage: vehicle.condition.secondary_damage,
      run_condition: vehicle.condition.run_state, has_key: vehicle.condition.keys_present, airbags: vehicle.condition.airbags},
    sale_document: {name: vehicle.document.name, type: vehicle.document.type,
      registration: vehicle.document.registration, export: vehicle.document.export},
    location: vehicle.location, odometer: vehicle.odometer,
    media: {items: vehicle.media.items, thumbs: vehicle.media.thumbs, has_video: vehicle.media.has_video, has_360: vehicle.media.has_360}
  };
}

module.exports = {D1ReadRepository, canonicalVehicle, toPublicVehicleDTO, encodeCursor, decodeCursor, MAX_PAGE_SIZE, KNOWN_PLATFORMS};
