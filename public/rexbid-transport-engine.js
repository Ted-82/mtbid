(function(root, factory) {
  const rates = typeof module === "object" && module.exports ? require("./rexbid-transport-rates.js") : root && root.RexBidTransportRates;
  const value = factory(rates);
  if (typeof module === "object" && module.exports) module.exports = value;
  if (root) root.RexBidTransport = value;
})(typeof globalThis !== "undefined" ? globalThis : this, function(RATES) {
  "use strict";

  const STATUSES = Object.freeze({ confirmed: "confirmed", configurable: "configurable", estimated: "estimated", unknown: "unknown" });
  const STATE_ALIASES = Object.freeze({ AL:"ALABAMA", AK:"ALASKA", AZ:"ARIZONA", AR:"ARKANSAS", CA:"CALIFORNIA", CO:"COLORADO", CT:"CONNECTICUT", DE:"DELAWARE", FL:"FLORIDA", GA:"GEORGIA", HI:"HAWAII", ID:"IDAHO", IL:"ILLINOIS", IN:"INDIANA", IA:"IOWA", KS:"KANSAS", KY:"KENTUCKY", LA:"LOUISIANA", ME:"MAINE", MD:"MARYLAND", MA:"MASSACHUSETTS", MI:"MICHIGAN", MN:"MINNESOTA", MS:"MISSISSIPPI", MO:"MISSOURI", MT:"MONTANA", NE:"NEBRASKA", NV:"NEVADA", NH:"NEW HAMPSHIRE", NJ:"NEW JERSEY", NM:"NEW MEXICO", NY:"NEW YORK", NC:"NORTH CAROLINA", ND:"NORTH DAKOTA", OH:"OHIO", OK:"OKLAHOMA", OR:"OREGON", PA:"PENNSYLVANIA", RI:"RHODE ISLAND", SC:"SOUTH CAROLINA", SD:"SOUTH DAKOTA", TN:"TENNESSEE", TX:"TEXAS", UT:"UTAH", VT:"VERMONT", VA:"VIRGINIA", WA:"WASHINGTON", WV:"WEST VIRGINIA", WI:"WISCONSIN", WY:"WYOMING", DC:"DISTRICT OF COLUMBIA" });
  const PLATFORM_ALIASES = Object.freeze({ copart:"copart", iaai:"iaai", "insurance auto auction":"iaai", manheim:"manheim", adesa:"adesa" });
  const text = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[(),]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  function platformKey(value) {
    const raw = text(value);
    if (PLATFORM_ALIASES[raw]) return PLATFORM_ALIASES[raw];
    if (raw.includes("copart")) return "copart";
    if (raw.includes("iaai") || raw.includes("insurance auto auction")) return "iaai";
    if (raw.includes("manheim")) return "manheim";
    if (raw.includes("adesa")) return "adesa";
    return raw;
  }
  function stateKey(value) {
    const raw = text(value).toUpperCase();
    if (!raw) return "";
    if (STATE_ALIASES[raw]) return STATE_ALIASES[raw];
    const upper = raw.replace(/\s+/g, " ");
    return Object.values(STATE_ALIASES).includes(upper) ? upper : upper;
  }
  function postalKey(value) {
    const raw = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (/^\d{5}(\d{4})?$/.test(raw)) return raw.slice(0, 5);
    return raw;
  }
  function stateValue(value) {
    if (typeof value !== "string") return null;
    const raw = value.trim();
    const upper = raw.toUpperCase();
    return /^[A-Z]{2}$/.test(upper) || Object.values(STATE_ALIASES).includes(upper) ? raw : null;
  }
  const locationKey = value => text(value);
  function objectText(value, keys) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") return String(value).trim() || null;
    for (const key of keys) {
      const candidate = value[key];
      if (candidate !== null && candidate !== undefined && typeof candidate !== "object" && String(candidate).trim()) return String(candidate).trim();
    }
    return null;
  }
  function rowRoutes(row, rates = RATES) {
    return (rates?.routeIds || []).flatMap(routeId => {
      const raw = row?.[routeId];
      if (raw === null || raw === undefined || raw === "" || typeof raw === "string" && !raw.trim()) return [];
      const amount = Number(raw);
      return Number.isFinite(amount) && amount >= 0 ? [{ route_id: routeId, amount }] : [];
    });
  }
  function contextFromVehicle(vehicle = {}) {
    const a = vehicle.auction || {};
    const d = vehicle.details || {};
    const locationObjects = [a.location, a.facility, vehicle.location, vehicle.facility];
    const locationName = a.facility_name || a.branch_name || a.location_name || a.location_display ||
      objectText(a.location, ["display", "name", "location_name", "branch_name", "facility_name", "raw"]) ||
      objectText(a.facility, ["display", "name", "location_name", "branch_name", "facility_name", "raw"]) ||
      vehicle.facility_name || vehicle.branch_name || vehicle.location_name || vehicle.location_display ||
      objectText(vehicle.location, ["display", "name", "location_name", "branch_name", "facility_name", "raw"]) ||
      objectText(vehicle.facility, ["display", "name", "location_name", "branch_name", "facility_name", "raw"]);
    const locationField = (...keys) => locationObjects.map(item => {
      if (!item || typeof item !== "object") return null;
      for (const key of keys) if (item[key] !== null && item[key] !== undefined && item[key] !== "") return item[key];
      return null;
    }).find(value => value !== null && value !== undefined && value !== "") || null;
    const city = a.city || a.facility_city || vehicle.city || vehicle.facility_city || d.city || locationField("city", "facility_city");
    const state = a.state_code || a.state_abbr || stateValue(a.state) || vehicle.state_code || vehicle.state_abbr || stateValue(vehicle.state) || locationField("state_code", "state_abbr", "state", "province");
    const postal = a.zip || a.postal_code || vehicle.zip || vehicle.postal_code || locationField("zip", "postal_code", "postal");
    return {
      platform: platformKey(vehicle.platform || vehicle.source || a.platform || ""),
      location_name: locationName,
      city,
      state,
      postal_code: postal,
      year: vehicle.year ?? d.year ?? null,
      make: vehicle.make ?? d.make ?? null,
      model: vehicle.model ?? d.model ?? null,
      current_bid_usd: vehicle.pricing?.current_bid_usd ?? null,
      buy_now_usd: vehicle.pricing?.buy_now_usd ?? null,
      purchase_price_suggested: vehicle.pricing?.sale_price_usd ?? vehicle.pricing?.current_bid_usd ?? vehicle.pricing?.buy_now_usd ?? null,
      fuel: vehicle.fuel_type ?? d.fuel_type ?? d.FuelTypeDesc ?? null,
      engine_cc: vehicle.engine_displacement_cc ?? vehicle.engine_cc ?? d.EngineCC ?? null
    };
  }
  function normalizedRow(row = {}) {
    const rawState = row.state ?? row.state_province ?? row.province ?? "";
    return {
      ...row,
      platform_key: platformKey(row.platform),
      location_key: locationKey(row.location_name || row.auction_location_name || row.branch || ""),
      city_key: locationKey(row.city),
      state_key: stateKey(rawState),
      postal_key: postalKey(row.postal_code ?? row.zip ?? row.postal)
    };
  }
  function findLandRate(context = {}, rows = RATES?.landRates || []) {
    const input = {
      platform_key: platformKey(context.platform),
      location_key: locationKey(context.location_name || context.branch || context.auction_location_name || ""),
      city_key: locationKey(context.city),
      state_key: stateKey(context.state ?? context.state_province),
      postal_key: postalKey(context.postal_code ?? context.zip)
    };
    const candidates = (Array.isArray(rows) ? rows : []).map(normalizedRow);
    const tiers = [
      ["exact_platform_location", row => !!input.platform_key && !!input.location_key && row.platform_key === input.platform_key && row.location_key === input.location_key],
      ["platform_postal", row => !!input.platform_key && !!input.postal_key && row.platform_key === input.platform_key && row.postal_key === input.postal_key],
      ["platform_city_state", row => !!input.platform_key && !!input.city_key && !!input.state_key && row.platform_key === input.platform_key && row.city_key === input.city_key && row.state_key === input.state_key],
      ["postal", row => !!input.postal_key && row.postal_key === input.postal_key],
      ["city_state", row => !!input.city_key && !!input.state_key && row.city_key === input.city_key && row.state_key === input.state_key]
    ];
    for (const [match_type, matches] of tiers) {
      const found = candidates.filter(matches);
      if (!found.length) continue;
      if (found.length !== 1) return { status: "ambiguous", match_status: "ambiguous", reason: "ambiguous_match", match_type, routes_available: [], record: null };
      const record = found[0];
      const routes = rowRoutes(record);
      const matchStatus = match_type === "exact_platform_location" ? "exact" : (match_type === "platform_postal" || match_type === "postal" ? "fallback_zip" : "fallback_city_state");
      return {
        status: matchStatus, match_status: matchStatus, matched: true, reason: routes.length ? null : "route_unavailable", match_type,
        confidence: match_type === "exact_platform_location" ? "high" : match_type.startsWith("platform_") ? "medium" : "low",
        routes_available: routes, route_selection_required: false, route_selection_policy: "minimum_complete_land_plus_sea",
        record: { location_name: record.location_name || record.auction_location_name || record.branch || null, platform: record.platform_key, city: record.city || null, state: record.state ?? record.state_province ?? record.province ?? null, postal_code: record.postal_code ?? record.zip ?? record.postal ?? null }
      };
    }
    return { status: "unmatched", match_status: "unmatched", matched: false, reason: "no_exact_rate_match", match_type: null, routes_available: [], route_selection_required: false, record: null };
  }
  function seaFreight(routeId, rates = RATES) {
    const expected = rates?.seaFreight40HC?.["4"]?.[routeId];
    const conservative = rates?.seaFreight40HC?.["3"]?.[routeId];
    const present = value => value !== null && value !== undefined && value !== "";
    const valid = present(expected) && present(conservative) && Number.isFinite(Number(expected)) && Number.isFinite(Number(conservative));
    return {
      route_id: (rates?.routeIds || []).includes(routeId) ? routeId : null,
      expected: valid ? Number(expected) : null,
      conservative: valid ? Number(conservative) : null,
      currency: rates?.currency || null,
      source: rates?.source || null,
      status: valid && rates?.currency ? STATUSES.configurable : STATUSES.unknown,
      confidence: "low",
      assumptions: ["Expected zakłada 4 auta w kontenerze 40'HC; conservative zakłada 3 auta.", "Route ID pozostaje neutralny; nazwa portu nie została podana.", ...(rates?.currency ? [] : ["Waluta frachtu niepotwierdzona; kwoty nie mogą wejść do sumy."])]
    };
  }
  function selectTransportOptions(match, rates = RATES) {
    function choose(vehicleCount, seaCount) {
      if (!match || !match.matched || !Array.isArray(match.routes_available)) return { status: STATUSES.unknown, selected_route: null, land_amount: null, sea_amount: null, combined_transport_amount: null, currency: rates?.currency || null, source: "partner", match_status: match?.match_status || "unmatched" };
      const candidates = match.routes_available.flatMap(route => {
        const land = route.amount;
        const sea = rates?.seaFreight40HC?.[String(seaCount)]?.[route.route_id];
        if (!Number.isFinite(land) || sea === null || sea === undefined || sea === "" || !Number.isFinite(Number(sea))) return [];
        return [{ selected_route: route.route_id, land_amount: land, sea_amount: Number(sea), combined_transport_amount: land + Number(sea) }];
      }).sort((a, b) => a.combined_transport_amount - b.combined_transport_amount || String(a.selected_route).localeCompare(String(b.selected_route)));
      const best = candidates[0];
      return best ? { ...best, status: rates?.currency ? STATUSES.configurable : STATUSES.unknown, currency: rates?.currency || null, source: "partner", match_status: match.match_status, container: "40'HC", sea_vehicle_count: seaCount, assumptions: [`Stawka morska na pojazd przy ${seaCount} autach w 40'HC.`, "Wybrano trasę o najniższej sumie ląd + morze spośród kompletnych tras."] }
        : { status: STATUSES.unknown, selected_route: null, land_amount: null, sea_amount: null, combined_transport_amount: null, currency: rates?.currency || null, source: "partner", match_status: match.match_status, reason: "Brak trasy z kompletną stawką lądową i morską." };
    }
    return { expected: choose(4, 4), conservative: choose(3, 3) };
  }
  function costLine(id, amount, currency, status, meta = {}) {
    const valid = amount !== null && amount !== undefined && amount !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0;
    return { id, amount: valid ? Number(amount) : null, currency: valid ? (currency || null) : null, status: valid ? (status || STATUSES.configurable) : STATUSES.unknown, source: meta.source || null, note: meta.note || null };
  }
  function estimateTotal(input = {}) {
    const required = ["vehicle", "auctionFees", "landTransport", "seaFreight", "importCosts", "polandDelivery"];
    const lines = required.map(id => {
      const item = input[id] || {};
      return costLine(id, item.amount, item.currency, item.status, item);
    });
    const known = lines.filter(x => x.amount !== null);
    const currencies = [...new Set(known.map(x => x.currency).filter(Boolean))];
    const missing = lines.filter(x => x.amount === null || !x.currency || x.status === STATUSES.unknown).map(x => x.id);
    const currencyMismatch = currencies.length > 1;
    const complete = missing.length === 0 && !currencyMismatch && lines.every(x => [STATUSES.confirmed, STATUSES.configurable, STATUSES.estimated].includes(x.status));
    return {
      model_version: "rex-transport-cost-v2",
      complete,
      status: complete ? (lines.every(x => x.status === STATUSES.confirmed) ? STATUSES.confirmed : STATUSES.estimated) : STATUSES.unknown,
      currency: complete ? currencies[0] : null,
      total: complete ? lines.reduce((sum, item) => sum + item.amount, 0) : null,
      missing: [...new Set([...missing, ...(currencyMismatch ? ["currency_conversion"] : [])])],
      lines
    };
  }
  function formatRaw(value) { return value === null || value === undefined ? "Wymaga danych" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(value); }
  function bind(options = {}) {
    const root = options.root || globalThis.document?.getElementById("partnerTransportCalculator");
    if (!root) return null;
    const context = contextFromVehicle(options.vehicle || {});
    const match = findLandRate(context, options.landRates || RATES?.landRates || []);
    const purchase = root.querySelector("[data-transport-purchase]");
    const note = root.querySelector("[data-transport-purchase-note]");
    if (purchase && purchase.value === "" && options.prefill?.purchasePrice != null) purchase.value = String(options.prefill.purchasePrice);
    if (note) note.textContent = options.prefill?.purchaseKind === "confirmed-sale" ? "Sugestia z potwierdzonej sprzedaży; możesz ją zmienić." : options.prefill?.purchaseKind?.includes("suggestion") ? "Wartość sugerowana z aukcji, nie potwierdzona cena zakupu." : "Wprowadź planowaną cenę zakupu.";
    const location = root.querySelector("[data-transport-location]");
    if (location) location.textContent = [context.platform, context.location_name, context.city, context.state, context.postal_code].filter(Boolean).join(" · ") || "Lokalizacja aukcji niedostępna";
    const facts = root.querySelector("[data-transport-vehicle-facts]");
    if (facts) facts.textContent = [context.year, context.make, context.model, context.fuel, context.engine_cc ? `${context.engine_cc} cm³` : null].filter(Boolean).join(" · ") || "Dane techniczne niedostępne";
    const matchNode = root.querySelector("[data-transport-land-status]");
    if (matchNode) {
      const confidence = { high:"wysoka pewność", medium:"średnia pewność", low:"niska pewność" }[match.confidence];
      const matchLabel = { exact:"dopasowanie dokładne", fallback_zip:"dopasowanie po ZIP", fallback_city_state:"dopasowanie po mieście i stanie" }[match.match_status];
      matchNode.textContent = match.status === "ambiguous" ? "Kilka pasujących lokalizacji — wymaga potwierdzenia"
        : match.matched ? (match.routes_available.length ? `Partner Rex.Bid · stawka do potwierdzenia · ${matchLabel}${confidence ? ` · ${confidence}` : ""}` : "Dopasowano lokalizację; brak dostępnej stawki trasy")
        : "Brak jednoznacznej stawki partnera";
    }
    const update = () => {
      const transportOptions = selectTransportOptions(match);
      const standard = transportOptions.expected;
      const conservative = transportOptions.conservative;
      const landValue = root.querySelector("[data-transport-land-value]");
      if (landValue) landValue.textContent = standard.land_amount !== null ? `${formatRaw(standard.land_amount)} USD` : "Wymaga wyceny";
      const seaValue = root.querySelector("[data-transport-sea-value]");
      if (seaValue) seaValue.textContent = standard.sea_amount !== null ? `Standard: ${formatRaw(standard.sea_amount)} USD · Ostrożny: ${formatRaw(conservative.sea_amount)} USD` : "Wymaga kompletnej stawki trasy";
      const combined = root.querySelector("[data-transport-combined]");
      if (combined) combined.textContent = standard.combined_transport_amount !== null ? `Standard: ${formatRaw(standard.combined_transport_amount)} USD · Ostrożny: ${formatRaw(conservative.combined_transport_amount)} USD` : "Wymaga wyceny";
      const required = ["vehicle", "auctionFees", "landTransport", "seaFreight", "importCosts", "polandDelivery"];
      const costs = estimateTotal({ vehicle: { amount: purchase?.value, currency: "USD", status: STATUSES.configurable }, auctionFees: {}, landTransport: standard.land_amount !== null ? { amount: standard.land_amount, currency: standard.currency, status: standard.status, source: RATES.source } : {}, seaFreight: standard.sea_amount !== null ? { amount: standard.sea_amount, currency: standard.currency, status: standard.status, source: RATES.source } : {}, importCosts: {}, polandDelivery: {} });
      const totalNode = root.querySelector("[data-transport-total]");
      if (totalNode) totalNode.textContent = standard.combined_transport_amount !== null ? `Szacowany koszt transportu · standard ${formatRaw(standard.combined_transport_amount)} USD · ostrożny ${formatRaw(conservative.combined_transport_amount)} USD` : "Kalkulacja częściowa — wymagane dane";
      const missingNode = root.querySelector("[data-transport-missing]");
      if (missingNode) missingNode.textContent = `Brakuje ${costs.missing.length} z ${required.length} wymaganych pozycji; brak danych nie jest traktowany jako 0.`;
      const result = { context, match, options: transportOptions, standard, conservative, costs };
      options.onUpdate?.(standard);
      return result;
    };
    purchase?.addEventListener("input", update);
    return update();
  }

  return Object.freeze({ statuses: STATUSES, rates: RATES, normalizeText: text, normalizePlatform: platformKey, normalizeState: stateKey, normalizePostal: postalKey, contextFromVehicle, findLandRate, seaFreight, selectTransportOptions, estimateTotal, bind });
});
