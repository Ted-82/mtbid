(function (root) {
  "use strict";

  const STORAGE_KEY = "rex_bid_local_v1";
  const LEGACY_KEY = "mtbid_favorites";
  const MAX_COMPARE = 3;
  const text = (value, max = 240) => {
    if (value === null || value === undefined || typeof value === "object") return "";
    return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  };
  const first = (...values) => values.find(value => value !== null && value !== undefined && value !== "");
  const number = value => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  const pick = (obj, keys) => {
    for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
    return "";
  };
  function safeImageUrl(value) {
    const raw = text(value, 2000);
    if (!raw) return "";
    try {
      const parsed = new URL(raw, root.location && root.location.origin ? root.location.origin : "https://rex.bid");
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
    } catch (_) { return ""; }
  }
  function keyFor(vehicle) {
    if (typeof vehicle === "string") {
      const value = text(vehicle, 64).toUpperCase();
      if (value.startsWith("VIN:")) return `vin:${value.slice(4)}`;
      if (value.startsWith("LOT:")) {
        const rest = value.slice(4).split(":");
        const lot = rest.pop() || "";
        const platform = rest.join(":").toLowerCase() || "unknown";
        return lot ? `lot:${platform}:${lot}` : "";
      }
      return value ? `vin:${value}` : "";
    }
    if (!vehicle || typeof vehicle !== "object") return "";
    const vin = text(first(vehicle.vin, vehicle.VIN, vehicle.vehicle_vin), 64).toUpperCase();
    if (vin) return `vin:${vin}`;
    const lot = text(first(vehicle.lot, vehicle.lot_number, vehicle.lotNumber, vehicle.LotNumber), 80).toUpperCase();
    const platform = text(first(vehicle.platform, vehicle.auction && vehicle.auction.platform, "unknown"), 40).toLowerCase();
    return lot ? `lot:${platform}:${lot}` : "";
  }
  function snapshotFromVehicle(vehicle) {
    if (!vehicle || typeof vehicle !== "object") return null;
    const pricing = vehicle.pricing && typeof vehicle.pricing === "object" ? vehicle.pricing : {};
    const auction = vehicle.auction && typeof vehicle.auction === "object" ? vehicle.auction : {};
    const condition = vehicle.condition && typeof vehicle.condition === "object" ? vehicle.condition : {};
    const description = vehicle.vehicle_description && typeof vehicle.vehicle_description === "object" ? vehicle.vehicle_description : {};
    const odometer = vehicle.odometer && typeof vehicle.odometer === "object" ? vehicle.odometer : {};
    const loc = vehicle.location && typeof vehicle.location === "object" ? vehicle.location : {};
    const vin = text(first(vehicle.vin, vehicle.VIN, vehicle.vehicle_vin), 64).toUpperCase();
    const lot = text(first(vehicle.lot, vehicle.lot_number, vehicle.lotNumber, vehicle.LotNumber), 80);
    const platform = text(first(vehicle.platform, vehicle.auction_platform, auction.platform, typeof vehicle.auction === "string" ? vehicle.auction : ""), 40);
    const key = keyFor({ vin, lot, platform });
    if (!key) return null;
    const mediaItems = Array.isArray(vehicle.media && vehicle.media.items) ? vehicle.media.items : [];
    const mediaThumbs = Array.isArray(vehicle.media && vehicle.media.thumbs) ? vehicle.media.thumbs : [];
    const imageCandidates = [vehicle.image, vehicle.image_url, vehicle.photo, vehicle.photo_url,
      ...mediaThumbs.flatMap(item => item && typeof item === "object" ? [item.thumb, item.url, item.src, item.image] : [item]),
      ...mediaItems.flatMap(item => item && typeof item === "object" ? [item.thumb, item.url, item.large, item.src, item.medium, item.image] : [])];
    const image = imageCandidates.map(safeImageUrl).find(Boolean) || "";
    const odometerText = text(first(odometer.formatted, odometer.value, vehicle.mileage, vehicle.odometer), 80)
      || (first(odometer.mi, odometer.miles) !== undefined && first(odometer.mi, odometer.miles) !== null
        ? `${Number(first(odometer.mi, odometer.miles)).toLocaleString("en-US")} mi` : "");
    return {
      id: key,
      vin,
      lot,
      platform,
      title: text(first(vehicle.title, vehicle.YearMakeModelSeries, [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ")), 180),
      year: text(first(vehicle.year, vehicle.vehicle_year, vehicle.Year), 12),
      make: text(first(vehicle.make, vehicle.make_name, vehicle.Make), 80),
      model: text(first(vehicle.model, vehicle.model_name, vehicle.Model), 100),
      series: text(first(vehicle.series, vehicle.trim, vehicle.trim_name, vehicle.Series), 100),
      image,
      pricing: {
        current_bid_usd: number(first(pricing.current_bid_usd, pricing.current_bid, pricing.bid_usd, vehicle.current_bid_usd, vehicle.current_bid, vehicle.currentBid)),
        buy_now_usd: number(first(pricing.buy_now_usd, pricing.buy_now, vehicle.buy_now_usd, vehicle.buy_now, auction.buy_now_usd)),
        sale_price_usd: number(first(pricing.sale_price_usd, vehicle.sale_price_usd, vehicle.salePriceUsd)),
        final_price_usd: number(first(pricing.final_price_usd, vehicle.final_price_usd)),
      last_sold_price_usd: number(first(pricing.last_sold_price_usd, vehicle.last_sold_price_usd, vehicle.lastSoldPrice))
      },
      auction: {
        state: text(first(auction.state, vehicle.auction_state, vehicle.auctionState, vehicle.status, vehicle.state), 60),
        date: text(first(auction.full_date, auction.formatted, auction.auction_at, auction.date, vehicle.auction_date, vehicle.auction_at, vehicle.auctionAt), 80)
      },
      odometer: odometerText,
      primary_damage: text(first(condition.primary_damage, vehicle.primary_damage, vehicle.damage), 120),
      secondary_damage: text(first(condition.secondary_damage, vehicle.secondary_damage), 120),
      title_document: text(first(vehicle.title_document, vehicle.document, vehicle.title_status, vehicle.title_sale_doc, vehicle.TitleSaleDoc, vehicle.sale_document && pick(vehicle.sale_document, ["name", "document_name", "type"])), 120),
      engine: text(first(description.engine, vehicle.engine), 80),
      fuel: text(first(description.fuel, vehicle.fuel), 60),
      transmission: text(first(description.transmission, vehicle.transmission), 80),
      drivetrain: text(first(description.drivetrain, vehicle.drivetrain), 60),
      body_style: text(first(description.body_style, vehicle.body_style), 80),
      location: text(first(loc.display, loc.formatted, loc.name, [loc.city, loc.state].filter(Boolean).join(", "), vehicle.location_name, typeof vehicle.location === "string" ? vehicle.location : ""), 120),
      seller: text(first(vehicle.seller_name, vehicle.sellerName,
        typeof vehicle.seller === "object" ? pick(vehicle.seller, ["name", "display", "displayName", "seller_name", "companyName"]) : vehicle.seller,
        vehicle.sale_information && vehicle.sale_information.Seller && pick(vehicle.sale_information.Seller, ["name", "displayName", "seller_name", "companyName"])), 120),
      saved_at: new Date().toISOString()
    };
  }
  function sanitizeSnapshot(item) {
    if (!item || typeof item !== "object") return null;
    const clean = snapshotFromVehicle(item);
    if (!clean) return null;
    clean.saved_at = text(item.saved_at, 40) || clean.saved_at;
    return clean;
  }
  function dedupe(items, limit) {
    const out = [], seen = new Set();
    for (const raw of Array.isArray(items) ? items : []) {
      const item = sanitizeSnapshot(raw);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id); out.push(item);
      if (limit && out.length >= limit) break;
    }
    return out;
  }
  function emptyState() { return { schema: "rex-bid-local", version: 1, updated_at: "", legacy_migrated: false, favorites: [], compare: [] }; }
  function readState() {
    let state = emptyState();
    try {
      const parsed = JSON.parse(root.localStorage.getItem(STORAGE_KEY) || "null");
      if (parsed && typeof parsed === "object") {
        state = { ...state, legacy_migrated: parsed.legacy_migrated === true,
          favorites: dedupe(parsed.favorites), compare: dedupe(parsed.compare, MAX_COMPARE) };
      }
    } catch (_) {}
    if (!state.legacy_migrated) {
      try {
        const legacy = JSON.parse(root.localStorage.getItem(LEGACY_KEY) || "[]");
        if (Array.isArray(legacy)) {
          const legacyItems = legacy.filter(item => !(item && typeof item === "object" && item.is_demo))
            .map(item => typeof item === "string" ? { vin: item } : item);
          state.favorites = dedupe([...legacyItems, ...state.favorites]);
        }
      } catch (_) {}
      state.legacy_migrated = true;
      writeState(state);
    }
    return state;
  }
  function writeState(state) {
    state.schema = "rex-bid-local"; state.version = 1; state.updated_at = new Date().toISOString();
    state.favorites = dedupe(state.favorites); state.compare = dedupe(state.compare, MAX_COMPARE);
    try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { return false; }
    refreshCounts();
    return true;
  }
  function getFavorites() { return readState().favorites; }
  function getCompare() { return readState().compare; }
  function removeFrom(listName, vehicleOrKey) {
    const state = readState(), key = keyFor(vehicleOrKey);
    const before = state[listName].length;
    state[listName] = state[listName].filter(item => item.id !== key);
    writeState(state); return before !== state[listName].length;
  }
  function toggle(listName, vehicle, max) {
    const item = snapshotFromVehicle(vehicle);
    if (!item) return { ok: false, saved: false, reason: "missing_identifier" };
    const state = readState(), index = state[listName].findIndex(entry => entry.id === item.id);
    if (index >= 0) { state[listName].splice(index, 1); writeState(state); return { ok: true, saved: false, item }; }
    if (max && state[listName].length >= max) return { ok: false, saved: false, reason: "limit", limit: max };
    state[listName].unshift(item); writeState(state); return { ok: true, saved: true, item };
  }
  function detailHref(vehicle) {
    const item = typeof vehicle === "object" && vehicle ? vehicle : {};
    const vin = text(first(item.vin, item.VIN), 64);
    const lot = text(first(item.lot, item.lot_number, item.lotNumber), 80);
    if (vin) return `/car.html?vin=${encodeURIComponent(vin)}`;
    if (lot) return `/car.html?lot=${encodeURIComponent(lot)}`;
    return "/";
  }
  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
  }
  function refreshCounts() {
    if (!root.document) return;
    const favCount = getFavorites().length, compareCount = getCompare().length;
    root.document.querySelectorAll('[data-rexbid-count="favorites"]').forEach(node => { node.textContent = String(favCount); });
    root.document.querySelectorAll('[data-rexbid-count="compare"]').forEach(node => { node.textContent = String(compareCount); });
  }
  const api = {
    STORAGE_KEY, MAX_COMPARE, snapshotFromVehicle, getFavorites, getCompare,
    isFavorite(vehicle) { const key = keyFor(vehicle); return !!key && getFavorites().some(item => item.id === key); },
    toggleFavorite(vehicle) { return toggle("favorites", vehicle); },
    removeFavorite(vehicleOrKey) { return removeFrom("favorites", vehicleOrKey); },
    isCompared(vehicle) { const key = keyFor(vehicle); return !!key && getCompare().some(item => item.id === key); },
    toggleCompare(vehicle) { return toggle("compare", vehicle, MAX_COMPARE); },
    removeCompare(vehicleOrKey) { return removeFrom("compare", vehicleOrKey); },
    detailHref, escapeHtml, safeImageUrl, refreshCounts
  };
  root.RexBidStorage = api;
  refreshCounts();
  if (root.addEventListener) root.addEventListener("storage", refreshCounts);
})(typeof window !== "undefined" ? window : globalThis);
