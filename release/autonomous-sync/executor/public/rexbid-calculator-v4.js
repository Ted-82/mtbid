(function (root, factory) {
  const api = factory(root.RexBidCalculatorV4Rates || (typeof module === "object" && module.exports ? require("./rexbid-calculator-v4-rates.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RexBidCalculatorV4 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (RATES) {
  "use strict";

  const STATE_ABBR = Object.freeze({ALABAMA:"AL",ALASKA:"AK",ARIZONA:"AZ",ARKANSAS:"AR",CALIFORNIA:"CA",COLORADO:"CO",CONNECTICUT:"CT",DELAWARE:"DE",FLORIDA:"FL",GEORGIA:"GA",HAWAII:"HI",IDAHO:"ID",ILLINOIS:"IL",INDIANA:"IN",IOWA:"IA",KANSAS:"KS",KENTUCKY:"KY",LOUISIANA:"LA",MAINE:"ME",MARYLAND:"MD",MASSACHUSETTS:"MA",MICHIGAN:"MI",MINNESOTA:"MN",MISSISSIPPI:"MS",MISSOURI:"MO",MONTANA:"MT",NEBRASKA:"NE",NEVADA:"NV","NEW HAMPSHIRE":"NH","NEW JERSEY":"NJ","NEW MEXICO":"NM","NEW YORK":"NY","NORTH CAROLINA":"NC","NORTH DAKOTA":"ND","OHIO":"OH","OKLAHOMA":"OK","OREGON":"OR","PENNSYLVANIA":"PA","RHODE ISLAND":"RI","SOUTH CAROLINA":"SC","SOUTH DAKOTA":"SD","TENNESSEE":"TN","TEXAS":"TX","UTAH":"UT","VERMONT":"VT","VIRGINIA":"VA","WASHINGTON":"WA","WEST VIRGINIA":"WV","WISCONSIN":"WI","WYOMING":"WY"});
  const PLATFORMS = Object.freeze({COPART:"copart",IAAI:"iaai",MANHEIM:"manheim",ADESA:"adesa"});
  const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
  const text = value => value === null || value === undefined ? "" : String(value).trim();
  const positive = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const nonNegative = value => value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

  // Partner answers received 2026-10-14, workbook B28/B31:B33/B58.
  // Reference only: do not silently replace the versioned V4 rate set or add
  // charges to its subtotal before their full scope has been reconciled.
  const PARTNER_REFERENCE = Object.freeze({
    received_on: "2026-10-14", source_kind: "partner_answers",
    destination_port: "Rotterdam", customs_country: "Holandia",
    handling_usd_per_vehicle: 180, packing_usd_per_vehicle: 150,
    packing_powertrains: Object.freeze(["BEV", "HEV", "PHEV"]),
    optional_inspection_usd: 250
  });

  function normalizeState(value) {
    const raw = text(value).toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
    return STATE_ABBR[raw] || raw;
  }

  function normalizeLocation(value) {
    return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
      .replace(/\b(\d{5})-\d{4}\b/g, "$1")
      .replace(/\b(ALABAMA|ALASKA|ARIZONA|ARKANSAS|CALIFORNIA|COLORADO|CONNECTICUT|DELAWARE|FLORIDA|GEORGIA|HAWAII|IDAHO|ILLINOIS|INDIANA|IOWA|KANSAS|KENTUCKY|LOUISIANA|MAINE|MARYLAND|MASSACHUSETTS|MICHIGAN|MINNESOTA|MISSISSIPPI|MISSOURI|MONTANA|NEBRASKA|NEVADA|NEW HAMPSHIRE|NEW JERSEY|NEW MEXICO|NEW YORK|NORTH CAROLINA|NORTH DAKOTA|OHIO|OKLAHOMA|OREGON|PENNSYLVANIA|RHODE ISLAND|SOUTH CAROLINA|SOUTH DAKOTA|TENNESSEE|TEXAS|UTAH|VERMONT|VIRGINIA|WASHINGTON|WEST VIRGINIA|WISCONSIN|WYOMING)\b/g, state => STATE_ABBR[state] || state)
      .replace(/[(),.]/g, " ").replace(/[^A-Z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeZip(value, country = "US") {
    let raw = text(value).toUpperCase().replace(/\s+/g, "");
    if (!raw) return "";
    if (/^(?:US|USA|UNITED STATES)$/.test(text(country).toUpperCase())) raw = raw.slice(0, 5);
    return raw.replace(/[^A-Z0-9]/g, "");
  }

  function normalizePlatform(value) {
    const raw = text(value).toUpperCase().replace(/[^A-Z]/g, "");
    return PLATFORMS[raw] || raw.toLowerCase();
  }

  function rowKey(row) { return [normalizePlatform(row.platform), normalizeLocation(row.auction_location)].join("|"); }

  function matchingLocation(dataset, input = {}) {
    if (!dataset || !Array.isArray(dataset.locations)) return {status: "unmatched", reason: "rate_data_unavailable", candidates: []};
    const platform = normalizePlatform(input.platform);
    const zip = normalizeZip(input.postal_code ?? input.zip, input.country || "US");
    const names = [input.auction_location, input.branch, input.location, input.facility].map(normalizeLocation).filter(Boolean);
    // The partner labels often include the ZIP. Combine only a supplied exact
    // branch name + supplied ZIP; this is deterministic formatting, not fuzzy matching.
    const locationNames = [...new Set(names.flatMap(name => zip ? [name, `${name} ${zip}`] : [name]))];
    const eligible = dataset.locations.filter(row => !platform || normalizePlatform(row.platform) === platform);
    // Compare exact branch labels independently of their ZIP suffix. A state and
    // platform are mandatory and ambiguous branches never select a route.
    const suppliedState = normalizeState(input.state_province ?? input.state);
    const branchName = name => {
      const normalized = normalizeLocation(name).replace(/\s+\d{5}(?:-\d{4})?$/, "").trim();
      return suppliedState && normalized.endsWith(" " + suppliedState) ? normalized.slice(0, -suppliedState.length).trim() : normalized;
    };
    if (!zip && platform && suppliedState && names.length) {
      const found = eligible.filter(row => normalizeState(row.state_province) === suppliedState && names.some(name => branchName(name) === branchName(row.auction_location)));
      if (found.length === 1) return {status: "exact_branch_state", row: found[0], candidates: found};
      if (found.length > 1) return {status: "ambiguous", reason: "multiple_branch_state_locations", candidates: found};
    }
    for (const name of locationNames) {
      const found = eligible.filter(row => normalizeLocation(row.auction_location) === name);
      if (found.length === 1) return {status: "exact", row: found[0], candidates: found};
      if (found.length > 1) return {status: "ambiguous", reason: "multiple_exact_locations", candidates: found};
    }
    if (zip) {
      const found = eligible.filter(row => normalizeZip(row.postal_code, row.country) === zip);
      if (found.length === 1) return {status: "fallback_zip", row: found[0], candidates: found};
      if (found.length > 1) {
        // One ZIP can serve multiple branches. Require both explicit city and
        // state to narrow within that exact ZIP; never pick a cheaper row.
        const city = normalizeLocation(input.city);
        const state = normalizeState(input.state_province ?? input.state);
        const narrowed = city && state ? found.filter(row => normalizeLocation(row.city) === city && normalizeState(row.state_province) === state) : [];
        if (narrowed.length === 1) return {status: "fallback_zip", reason: "zip_city_state_confirmed", row: narrowed[0], candidates: narrowed};
        return {status: "ambiguous", reason: "multiple_zip_locations", candidates: found};
      }
    }
    const city = normalizeLocation(input.city);
    const state = normalizeState(input.state_province ?? input.state);
    if (city && state) {
      const found = eligible.filter(row => normalizeLocation(row.city) === city && normalizeState(row.state_province) === state);
      if (found.length === 1) return {status: "fallback_city_state", row: found[0], candidates: found};
      if (found.length > 1) return {status: "ambiguous", reason: "multiple_city_state_locations", candidates: found};
    }
    return {status: "unmatched", reason: "no_confident_location_match", candidates: []};
  }

  function normalizePowertrain(value) {
    if (isRecord(value)) {
      value = value.value ?? value.name ?? value.label ?? value.display ?? value.description ?? value.code ?? "";
    }
    const raw = text(value).toLowerCase().replace(/[_.-]+/g, " ").replace(/\s+/g, " ").trim();
    if (/^(?:bev|electric|battery electric|battery electric vehicle|all electric|pure electric|fully electric)$/.test(raw)) return "BEV";
    if (/^(?:phev|plug in hybrid|plug-in hybrid|plug in hybrid electric)$/.test(raw)) return "PHEV";
    if (/^(?:hev|hybrid|hybrid electric|electric and gas hybrid|mild hybrid)$/.test(raw)) return "HEV";
    if (/^(?:fcev|hydrogen|fuel cell|fuel cell electric)$/.test(raw)) return "FCEV";
    if (/^(?:ice|gas|gasoline|petrol|diesel|flex fuel|flexfuel|natural gas|cng|lpg|combustion)$/.test(raw)) return "ICE";
    return "unknown";
  }

  function matchPowertrain(vehicle = {}) {
    const desc = vehicle.vehicle_description || vehicle.details?.vehicle_description || vehicle.details?.vehicleInformation || {};
    const values = [vehicle.fuel_type, vehicle.fuel, vehicle.powertrain, vehicle.engine_type,
      desc.FuelTypeDesc, desc.FuelType, desc.fuel_type, desc.Powertrain, desc.powertrain,
      vehicle.details?.attributes?.FuelType, vehicle.details?.attributes?.FuelTypeDesc];
    for (const value of values) {
      const normalized = normalizePowertrain(value);
      if (normalized !== "unknown") return normalized;
    }
    return "unknown";
  }

  function seaRate(dataset, terminalId, cars) {
    return dataset.sea.find(row => row.terminal_id === terminalId && Number(row.cars_per_container) === Number(cars) && row.price_basis === "per_vehicle") || null;
  }

  function calculateVariant(dataset, match, {vehicleClass, powertrain = "unknown", cars = 4} = {}) {
    const scenario = cars === 4 ? "standard" : cars === 3 ? "conservative" : null;
    if (!scenario) throw new RangeError("Supported V4 scenarios are 3 or 4 cars per 40'HC.");
    if (match.status === "ambiguous") return {scenario, status: "ambiguous", amount_usd: null, missing: ["Jednoznaczna lokalizacja aukcji"]};
    if (!match.row) return {scenario, status: "unmatched", amount_usd: null, missing: ["Stawka partnera dla lokalizacji"]};
    const row = match.row;
    if (row.rate_status === "source_conflict") return {scenario, status: "requires_confirmation", match_status: match.status, row_id: row.row_id, source_row: row.source_row, amount_usd: null, missing: ["Potwierdzenie spornej stawki partnera"]};
    const terminal = dataset.terminals.find(item => item.id === row.preferred_terminal_id);
    if (!terminal) return {scenario, status: "requires_confirmation", match_status: match.status, row_id: row.row_id, amount_usd: null, missing: ["Preferowany terminal partnera"]};
    const size = dataset.land_classes.find(item => item.class_id === vehicleClass);
    if (!size || size.land_multiplier === null || size.land_multiplier === undefined) return {scenario, status: "incomplete", match_status: match.status, row_id: row.row_id, terminal, land_usd: null, sea_usd: null, amount_usd: null, missing: ["Potwierdzona klasa transportowa"]};
    const landBase = row.rates?.[terminal.id];
    const land = landBase === null || landBase === undefined ? null : Math.round((Number(landBase) * Number(size.land_multiplier) + Number.EPSILON) * 100) / 100;
    const sea = seaRate(dataset, terminal.id, cars);
    if (land === null || !sea || sea.amount === null || sea.amount === undefined) return {scenario, status: "unknown", match_status: match.status, row_id: row.row_id, source_row: row.source_row, terminal, land_base_usd: landBase ?? null, land_multiplier: size.land_multiplier, land_usd: land, sea_usd: sea?.amount ?? null, amount_usd: null, missing: [land === null ? "Stawka lądowa na preferowany terminal" : null, !sea || sea.amount == null ? "Fracht morski na preferowany terminal" : null].filter(Boolean)};
    const pt = typeof powertrain === "string" ? normalizePowertrain(powertrain) : "unknown";
    const surcharge = dataset.surcharges.find(item => item.surcharge_id === "ev_container_packing");
    let evPacking = {amount_usd: null, status: "requires_confirmation"};
    if (pt === "BEV" && surcharge?.status === "owner_confirmed") evPacking = {amount_usd: Number(surcharge.amount), status: "confirmed", source: "owner_confirmed", confirmed_on: surcharge.confirmed_on};
    else if (pt === "ICE") evPacking = {amount_usd: 0, status: "not_applicable"};
    const transportUsd = land + Number(sea.amount);
    const amount = evPacking.amount_usd === null ? null : transportUsd + evPacking.amount_usd;
    return {scenario, status: amount === null ? "incomplete" : "known_subtotal", match_status: match.status,
      row_id: row.row_id, source_row: row.source_row, terminal, vehicle_class: size.class_id,
      currency: "USD", rate_version: dataset.version, source: "Partner REXBID",
      land_base_usd: Number(landBase), land_multiplier: Number(size.land_multiplier), land_usd: land,
      sea_usd: Number(sea.amount), sea_cars_per_container: cars, sea_price_basis: sea.price_basis,
      ev_packing: evPacking, transport_before_ev_usd: transportUsd,
      known_amount_usd: amount === null ? transportUsd : amount, amount_usd: amount,
      missing: amount === null ? ["Potwierdzenie dopłaty dla napędu"] : []};
  }

  function calculate(dataset, input = {}) {
    const match = matchingLocation(dataset, input);
    const powertrain = input.powertrain || matchPowertrain(input.vehicle || {});
    return {rate_version: dataset.version, currency: dataset.currency || "USD", source: "Partner REXBID", match,
      powertrain: normalizePowertrain(powertrain), preferred_terminal_id: match.row?.preferred_terminal_id || null,
      standard: calculateVariant(dataset, match, {vehicleClass: input.vehicleClass, powertrain, cars: 4}),
      conservative: calculateVariant(dataset, match, {vehicleClass: input.vehicleClass, powertrain, cars: 3})};
  }

  function escapeHtml(value) { return text(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
  function money(value, currency = "USD") { return value === null || value === undefined || !Number.isFinite(Number(value)) ? "Do potwierdzenia" : new Intl.NumberFormat("pl-PL", {style:"currency",currency,maximumFractionDigits:2}).format(Number(value)); }
  function partnerReferenceHtml(variant = {}, powertrain = "unknown") {
    const reference = PARTNER_REFERENCE;
    const pt = normalizePowertrain(powertrain);
    const packingIncluded = pt === "BEV" && variant.ev_packing?.status === "confirmed"
      && variant.ev_packing.amount_usd === reference.packing_usd_per_vehicle;
    const packing = packingIncluded
      ? `Pakowanie BEV: ${money(reference.packing_usd_per_vehicle)} za auto jest już wliczone w transport powyżej. Nie doliczaj tej kwoty drugi raz.`
      : reference.packing_powertrains.includes(pt)
        ? `Pakowanie ${pt === "HEV" ? "hybrydy (również mild hybrid)" : pt === "PHEV" ? "hybrydy plug-in" : "BEV"}: ${money(reference.packing_usd_per_vehicle)} za auto według nowych ustaleń. Ta pozycja pozostaje poza obecną sumą; uwzględnimy ją w indywidualnej wycenie.`
        : pt === "ICE"
          ? "Dopłata za pakowanie napędu elektrycznego lub hybrydowego nie dotyczy wybranego auta spalinowego."
          : "Dopłata za pakowanie dla wybranego lub nieustalonego napędu wymaga indywidualnego potwierdzenia. Nie przyjmujemy zera.";
    return `<p class="calc-v4-note"><strong>Port docelowy i odprawa: ${escapeHtml(reference.destination_port)}, ${escapeHtml(reference.customs_country)}.</strong> Ustalenia wspólnika przyjęte 14.10.2026.</p>
      <p class="calc-v4-note">Obsługa załadunku, rozładunku i materiały: <strong>${escapeHtml(money(reference.handling_usd_per_vehicle))} za auto</strong>. Kwota jest poza powyższą sumą; zakres potwierdzimy w indywidualnej wycenie.</p>
      <p class="calc-v4-note" data-v4-reference-packing>${escapeHtml(packing)}</p>
      <p class="calc-v4-note">Opcjonalne oględziny przed zakupem: <strong>${escapeHtml(money(reference.optional_inspection_usd))}</strong>, poza obecną sumą. Zakres ustalamy przed zamówieniem.</p>
      <p class="calc-v4-note">Opłaty portowe, podatki, ubezpieczenie, prowizja i dostawa w Polsce wymagają jeszcze kompletnej wyceny. Kwot w różnych walutach nie sumujemy bez kursu. Przygotuj zapytanie, aby potwierdzić pełny zakres i uniknąć podwójnego naliczenia usług.</p>`;
  }
  function terminalFrom(value) {
    const loc = value?.location;
    const stateFromLabel = text(isRecord(loc) ? loc.display : loc).match(/(?:\(([A-Z]{2})\)|,\s*([A-Z]{2}))\s*$/);
    const platform = value?.platform || value?.auction?.platform || value?.details?.platform || value?.details?.auction?.platform || "";
    return {platform, auction_location: value?.auction?.facility_name || value?.auction?.branch_name || value?.auction?.location || (isRecord(loc) ? loc.auction_location || loc.branch || loc.display || loc.name : loc) || value?.branch || value?.facility || value?.details?.sale_information?.SellingBranch || value?.details?.sale_information?.SellingBranchName || "",
      branch: value?.auction?.branch || value?.auction?.facility_name || value?.details?.sale_information?.SellingBranch || value?.details?.sale_information?.SellingBranchName || "",
      city: isRecord(loc) ? loc.city : value?.city || "", state_province: (isRecord(loc) ? loc.state_province || loc.state || loc.province : value?.state_province || value?.state) || stateFromLabel?.[1] || stateFromLabel?.[2] || "", postal_code: isRecord(loc) ? loc.postal_code || loc.zip : value?.postal_code || value?.zip || "", country: isRecord(loc) ? loc.country : value?.country || "US"};
  }

  function vehicleClassFrom(vehicle = {}, rates = RATES) {
    const explicit = text(vehicle.transport_class || vehicle.vehicle_class || vehicle.body_style_class);
    if (rates?.land_classes?.some(item => item.class_id === explicit && item.land_multiplier !== null)) return explicit;
    const normalizedClass = normalizeLocation(explicit).toLowerCase().replace(/\s+/g, "_");
    const sourceClass = rates?.land_classes?.find(item => normalizeLocation(item.source_label).toLowerCase().replace(/\s+/g, "_") === normalizedClass && item.land_multiplier !== null);
    if (sourceClass) return sourceClass.class_id;
    const desc = vehicle.vehicle_description || vehicle.details?.vehicle_description || vehicle.details?.vehicleInformation || {};
    const raw = text(vehicle.body_style || vehicle.bodyStyle || vehicle.vehicle_type || desc.BodyStyle || desc.BodyStyleName || desc.VehicleClass || desc.Vehicle).toLowerCase().trim();
    const exact = new Map([[
      "sedan", "sedan"], ["motorcycle", "motorcycle"], ["atv", "atv"], ["lawn mower", "lawn_mower"],
      ["golf cart", "golf_cart"], ["snowmobile", "snowmobile"], ["jet ski", "jet_ski"],
      ["side by side", "muv_side_by_side"], ["muv side by side", "muv_side_by_side"]
    ]);
    return exact.get(raw) || "";
  }

  function bindCalculator({root: mount, vehicle = {}, rates = RATES, strictCalculator = null, onUpdate = null} = {}) {
    if (!mount || !rates) return null;
    const budgetApi = typeof globalThis !== "undefined" && globalThis.RexBidImportBudget
      || (typeof module === "object" && module.exports ? require("./rexbid-import-budget.js") : null);
    let budgetBinding = null;
    let readMetadata = isRecord(vehicle.read) ? {...vehicle.read} : null;
    let previewMetadata = isRecord(vehicle.preview) ? {...vehicle.preview} : null;
    const storedMarketPrice = () => previewMetadata?.read_only === true || readMetadata?.read_only === true
      || vehicle.read_only === true || (text(readMetadata?.source).toLowerCase() === "d1" && readMetadata?.freshness !== "fresh");
    const currentPriceLabel = () => storedMarketPrice() ? "Ostatnia zapisana oferta" : "Aktualna oferta";
    const buyNowPriceLabel = () => storedMarketPrice() ? "Kup teraz · zapis danych" : "Kup teraz";
    const validObservation = value => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return "";
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime())) return "";
      const canonical = parsed.toISOString();
      return value.slice(0,19) === canonical.slice(0,19) ? canonical : "";
    };
    const priceObservedAt = () => {
      const source = previewMetadata?.read_only === true ? previewMetadata : readMetadata;
      return validObservation(source?.last_synced_at) || validObservation(source?.last_seen_at);
    };
    const currentSource = [[vehicle.pricing || {}, 'current_bid_usd'], [vehicle.pricing || {}, 'current_bid'], [vehicle, 'current_bid_usd'], [vehicle.auction || {}, 'current_bid_usd']].find(([object, key]) => Object.prototype.hasOwnProperty.call(object, key));
    const prefillPrice = positive(currentSource ? currentSource[0][currentSource[1]] : vehicle.pricing?.current_bid2_usd) ?? "";
    let currentMarketPrice = prefillPrice;
    let buyNow = positive(vehicle.pricing?.buy_now_usd ?? vehicle.pricing?.buy_now ?? vehicle.buy_now_usd ?? vehicle.auction?.buy_now_usd);
    const ctx = terminalFrom(vehicle);
    const match = matchingLocation(rates, ctx);
    const classes = rates.land_classes.filter(item => item.land_multiplier !== null);
    const disclosedClass = vehicleClassFrom(vehicle, rates);
    const classLabels = {sedan:"Sedan",suv_standard:"SUV standardowy",van_standard:"Van standardowy",muv_side_by_side:"Pojazd terenowy side-by-side",golf_cart:"Wózek golfowy",snowmobile:"Skuter śnieżny",jet_ski:"Skuter wodny",motorcycle:"Motocykl",atv:"Quad / ATV",lawn_mower:"Kosiarka",suv_large:"Duży SUV",pickup_standard:"Pickup standardowy",pickup_large:"Duży pickup",van_large:"Duży van",pickup_oversized:"Pickup ponadgabarytowy"};
    const classOptions = classes.map(item => `<option value="${escapeHtml(item.class_id)}"${disclosedClass === item.class_id ? " selected" : ""}>${escapeHtml(classLabels[item.class_id] || item.source_label)} (×${item.land_multiplier})</option>`).join("");
    const bevPackingAmount = rates.surcharges.find(item => item.surcharge_id === "ev_container_packing")?.amount;
    const existingInquiry = typeof mount.ownerDocument?.querySelector === "function"
      ? mount.ownerDocument.querySelector("[data-vehicle-inquiry]")?.getAttribute("href") : null;
    const fallbackInquiry = `/kontakt.html?${new URLSearchParams({lot:text(vehicle.lot_number ?? vehicle.lot ?? vehicle.auction?.lot_number), platform:normalizePlatform(vehicle.platform ?? vehicle.auction?.platform), source:"vehicle"})}`;
    const inquiryHref = existingInquiry?.startsWith("/kontakt.html?") ? existingInquiry : fallbackInquiry;
    mount.innerHTML = `<div class="calc-v4-head"><div><span class="calc-v4-kicker">Twój budżet</span><h2 id="calculatorV4Heading">Ile będzie kosztować import?</h2></div></div>
      <p class="calc-v4-intro">Wpisz planowaną cenę zakupu. Szczegóły możesz rozwinąć poniżej.</p>
      <div class="calc-v4-price-grid"><div class="calc-v4-price-choice"><label for="calculatorV4PriceKind">Cena do kalkulacji<select id="calculatorV4PriceKind" data-v4-price-kind aria-describedby="calculatorV4PriceNote"><option value="current">${escapeHtml(currentPriceLabel())}</option>${buyNow ? `<option value="buy-now">${escapeHtml(buyNowPriceLabel())}</option>` : ""}<option value="custom">Własna cena</option></select></label><label for="calculatorV4Price">Kwota zakupu (USD)<input id="calculatorV4Price" data-v4-price type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(prefillPrice)}" aria-describedby="calculatorV4PriceNote"></label><small id="calculatorV4PriceNote" data-v4-price-note>${storedMarketPrice() ? "Oferta z zapisu danych. Potwierdź cenę i dostępność w oryginalnej aukcji." : "Aktualna oferta nie jest ceną sprzedaży ani prognozą wygranej."}</small></div>
      </div>
      <div class="calc-v4-result" role="status" aria-live="polite" aria-atomic="true"><small data-v4-total-label>Znane składniki · USD</small><strong data-v4-total>Obliczanie…</strong><span data-v4-status></span></div>
      <p class="calc-v4-compact-missing" data-v4-compact-missing></p>
      <a class="calc-v4-inquiry" data-vehicle-inquiry data-v4-inquiry href="${escapeHtml(inquiryHref)}">Zapytaj o pełną cenę z dostawą <span aria-hidden="true">→</span></a>
      <small class="calc-v4-contact-note">Przygotujesz zapytanie z danymi tego auta. Bez zobowiązań do zakupu.</small>
      <details class="calc-v4-details calc-v4-settings" data-v4-settings${!disclosedClass || matchPowertrain(vehicle) === "unknown" ? " open" : ""}><summary>Koszty i ustawienia wyceny</summary>
      <span class="calc-v4-source">Stawki transportu: Partner REXBID</span>
      <div class="calc-v4-detail-grid">
        <label>Opłata aukcyjna (USD, jeśli znana)<input data-v4-auction-fee type="number" min="0" step="0.01" inputmode="decimal" placeholder="Do potwierdzenia"><small>Wpisz kwotę dla właściwego konta i sposobu zakupu. Puste pole oznacza brak danych.</small></label>
      </div>
      <div class="calc-v4-detail-grid calc-v4-required-fields" aria-label="Dane do wyceny transportu">
        <label>Klasa transportowa<select data-v4-class aria-required="true" aria-describedby="calculatorV4ClassNote"><option value="">Wybierz potwierdzoną klasę</option>${classOptions}<option value="other">Inny / do indywidualnej wyceny</option></select><small id="calculatorV4ClassNote">Mnożnik klasy dotyczy transportu lądowego.</small></label>
        <label>Typ napędu<select data-v4-powertrain aria-describedby="calculatorV4PowertrainNote"><option value="unknown">Nieustalony — wymaga potwierdzenia</option><option value="BEV">BEV — elektryczny bateryjny</option><option value="ICE">Spalinowy</option><option value="HEV">HEV — hybryda (także mild hybrid)</option><option value="PHEV">PHEV — hybryda plug-in</option><option value="FCEV">FCEV — ogniwo paliwowe</option></select><small id="calculatorV4PowertrainNote">BEV: pakowanie ${escapeHtml(money(bevPackingAmount))} za auto. Nowe ustalenia dla hybryd opisano poniżej, poza obecną sumą.</small></label>
        <label>Załadunek<select data-v4-scenario><option value="standard">Standardowy · 4 auta / 40'HC</option><option value="conservative">Ostrożny · 3 auta / 40'HC</option></select><small>Fracht morski jest stawką za jeden pojazd.</small></label>
      </div>
      <div class="calc-v4-legend" aria-label="Znaczenie statusów"><span>W sumie — kwota uzupełniona</span><span>Szacunek — cena lub stawka do weryfikacji</span><span>Brak danych — poza sumą</span></div>
      <div class="calc-v4-lines" data-v4-lines></div><p class="calc-v4-note" data-v4-note></p>
      <details class="calc-v4-details" data-v4-partner-reference><summary>Zakres usług i trasa</summary><div data-v4-partner-updates></div></details>
      <details class="calc-v4-details"><summary>Pełna rozpiska kosztów i trasy</summary><div data-v4-component-lines></div><div data-v4-route-details></div><p class="calc-v4-note">Mnożnik dotyczy tylko transportu lądowego. Fracht jest stawką za pojazd. Port docelowy: Rotterdam, Holandia. Pełny zakres frachtu i opłaty odprawy wymagają potwierdzenia. Cło wymaga aktualnej weryfikacji TARIC i dokumentów pochodzenia — zakup w USA ani VIN nie potwierdzają prawa do 0%.</p><div data-v4-strict-slot></div></details></details><div data-v4-budget-slot></div>`;
    const calculatorRegion = typeof mount.closest === "function" ? mount.closest("#importCalculator") : null;
    if (calculatorRegion) {
      calculatorRegion.removeAttribute("aria-label");
      calculatorRegion.setAttribute("aria-labelledby", "calculatorV4Heading");
    }
    const priceKind = mount.querySelector("[data-v4-price-kind]");
    const priceInput = mount.querySelector("[data-v4-price]");
    const scenarioInput = mount.querySelector("[data-v4-scenario]");
    const classInput = mount.querySelector("[data-v4-class]");
    const powertrainInput = mount.querySelector("[data-v4-powertrain]");
    const feeInput = mount.querySelector("[data-v4-auction-fee]");
    const slot = mount.querySelector("[data-v4-strict-slot]");
    if (strictCalculator) slot.append(strictCalculator);
    if (disclosedClass && classes.some(item => item.class_id === disclosedClass)) classInput.value = disclosedClass;
    const rawFuel = matchPowertrain(vehicle);
    if (rawFuel !== "unknown") powertrainInput.value = rawFuel;
    let userPrice = null;
    if (positive(currentMarketPrice) === null) priceKind.value = "custom";
    const describePriceSource = () => {
      const currentOption = [...priceKind.options].find(option => option.value === "current");
      const buyNowOption = [...priceKind.options].find(option => option.value === "buy-now");
      if (currentOption) { currentOption.textContent = currentPriceLabel(); currentOption.disabled = positive(currentMarketPrice) === null; }
      if (buyNowOption) buyNowOption.textContent = buyNowPriceLabel();
      const date = priceObservedAt();
      const observation = date ? ` Zapis z ${new Intl.DateTimeFormat("pl-PL", {dateStyle:"medium", timeStyle:"short", timeZone:"Europe/Warsaw"}).format(new Date(date))}.` : "";
      mount.querySelector("[data-v4-price-note]").textContent = priceKind.value === "current"
        ? storedMarketPrice()
          ? `Ostatnia zapisana oferta.${observation} Potwierdź cenę i dostępność w oryginalnej aukcji.`
          : "Aktualna oferta nie jest ceną sprzedaży ani prognozą wygranej."
        : priceKind.value === "buy-now"
          ? storedMarketPrice()
            ? `Cena „Kup teraz” z zapisu danych.${observation} Dostępność wymaga potwierdzenia w oryginalnej aukcji. Nie obejmuje opłat ani transportu.`
            : "Cena „Kup teraz” podana przy tej ofercie. Nie obejmuje opłat ani transportu."
          : nonNegative(priceInput.value) === null && nonNegative(currentMarketPrice) === null
            ? storedMarketPrice() ? "Brak ceny w zapisie danych. Wpisz planowaną cenę zakupu w USD." : "Brak aktualnej oferty. Wpisz planowaną cenę zakupu w USD."
            : "Twoja planowana cena zakupu w USD. Zmień ją, aby porównać koszty.";
    };
    const readInput = () => {
      describePriceSource();
      const chosen = scenarioInput.value === "standard" ? "standard" : "conservative";
      const calc = calculate(rates, {...ctx, vehicle, vehicleClass: classInput.value || null, powertrain: powertrainInput.value});
      const variant = calc[chosen];
      const typedPrice = nonNegative(priceInput.value);
      const fee = nonNegative(feeInput.value);
      const knownTransport = variant.known_amount_usd ?? variant.amount_usd;
      const subtotalParts = [typedPrice, knownTransport, fee].filter(value => value !== null && value !== undefined);
      const knownSubtotal = subtotalParts.length ? subtotalParts.reduce((sum, value) => sum + value, 0) : null;
      const missing = [];
      if (typedPrice === null) missing.push("cena zakupu");
      if (variant.amount_usd === null) missing.push(...variant.missing);
      if (fee === null) missing.push("opłaty aukcyjne");
      missing.push("cło, VAT i akcyza", "obsługa/import i port", "transport w Polsce");
      const hasTransport = knownTransport !== null && knownTransport !== undefined;
      const totalLabel = !hasTransport ? "Znane składniki · USD"
        : typedPrice === null ? fee === null ? "Znany transport · USD" : "Transport i opłaty aukcyjne · USD"
        : fee === null ? "Zakup i znany transport · USD" : "Znane koszty zakupu i transportu · USD";
      const statusParts = ["Kalkulacja częściowa · nie jest ceną pod dom."];
      if (storedMarketPrice() && priceKind.value !== "custom") statusParts.push("Cena pochodzi z zapisu danych; bieżącą cenę i dostępność potwierdź w oryginalnej aukcji.");
      if (!hasTransport) statusParts.push("Brak potwierdzonego transportu.");
      if (variant.ev_packing?.status === "requires_confirmation") statusParts.push("Dopłata dla napędu wymaga potwierdzenia.");
      const partnerReference = mount.querySelector("[data-v4-partner-updates]");
      if (partnerReference) partnerReference.innerHTML = partnerReferenceHtml(variant, powertrainInput.value);
      mount.querySelector("[data-v4-total-label]").textContent = totalLabel;
      mount.querySelector("[data-v4-total]").textContent = knownSubtotal === null ? "Wymaga danych" : money(knownSubtotal);
      mount.querySelector("[data-v4-status]").textContent = statusParts.join(" ");
      classInput.setAttribute?.("aria-invalid", String(!classes.some(item => item.class_id === classInput.value)));
      [priceInput, feeInput].forEach(node => node.setAttribute?.("aria-invalid", String(String(node.value).trim() !== "" && nonNegative(node.value) === null)));
      const rows = [
        ["Cena pojazdu", typedPrice], ["Opłaty aukcyjne", fee], ["Transport lądowy USA", variant.land_usd],
        ["Pakowanie EV", variant.ev_packing?.amount_usd], ["Fracht morski", variant.sea_usd],
        ["Obsługa/import", null], ["Cło", null], ["VAT", null], ["Akcyza", null], ["Port/odprawa", null], ["Transport w Polsce", null]
      ];
      const visibleRows = [
        ["Cena pojazdu", typedPrice !== null ? money(typedPrice) : "Wpisz cenę", typedPrice === null ? "missing" : "estimated"],
        ["Opłaty aukcyjne", fee !== null ? money(fee) : "Do potwierdzenia", fee === null ? "missing" : "included"],
        ["Transport USA + morski", variant.amount_usd != null ? money(variant.amount_usd) : knownTransport != null ? `${money(knownTransport)} · częściowo` : "Do potwierdzenia", !hasTransport ? "missing" : variant.amount_usd === null ? "incomplete" : "estimated"],
        ["Odprawa i podatki", "Do potwierdzenia", "missing"],
        ["Obsługa i dostawa w Polsce", "Do potwierdzenia", "missing"],
        [typedPrice !== null && hasTransport ? "Suma zakupu i znanego transportu" : totalLabel.replace(" · USD", ""), knownSubtotal !== null ? money(knownSubtotal) : "Do potwierdzenia", "incomplete"]
      ];
      const statusLabel = {included:"W sumie", estimated:"W sumie · szacunek", missing:"Brak danych · poza sumą", incomplete:"Suma częściowa", not_applicable:"Nie dotyczy"};
      const renderLine = (label, formattedAmount, status) => `<div data-cost-status="${status}"><span>${escapeHtml(label)}<small class="calc-v4-cost-status">${statusLabel[status]}</small></span><strong>${escapeHtml(formattedAmount)}</strong></div>`;
      mount.querySelector("[data-v4-lines]").innerHTML = visibleRows.map(([label, amount, status]) => renderLine(label, amount, status)).join("");
      mount.querySelector("[data-v4-component-lines]").innerHTML = rows.map(([label, amount]) => {
        const notApplicable = label === "Pakowanie EV" && variant.ev_packing?.status === "not_applicable";
        const status = notApplicable ? "not_applicable" : amount === null || amount === undefined ? "missing" : ["Cena pojazdu", "Transport lądowy USA", "Fracht morski"].includes(label) ? "estimated" : "included";
        return renderLine(label, notApplicable ? "Nie dotyczy" : money(amount), status);
      }).join("");
      const groupedMissing = [];
      if (typedPrice === null) groupedMissing.push("cenę pojazdu");
      if (fee === null) groupedMissing.push("opłaty aukcyjne");
      if (variant.amount_usd === null) groupedMissing.push(...(variant.missing || ["pełny transport"]));
      groupedMissing.push("odprawę i podatki", "obsługę oraz dostawę w Polsce");
      const phrase = `Wynik obejmuje tylko uzupełnione składniki. Brakujące kwoty nie są wliczone i nie oznaczają 0. Do ustalenia: ${[...new Set(groupedMissing)].join(", ")}.`;
      mount.querySelector("[data-v4-note]").textContent = phrase;
      const compactMissing = mount.querySelector("[data-v4-compact-missing]");
      compactMissing.textContent = !hasTransport ? "Wybierz dane transportu w ustawieniach. Pełną cenę z dostawą potwierdzimy w wycenie."
        : "Do pełnej ceny brakuje " + (fee === null ? "opłat aukcyjnych, " : "") + "odprawy, podatków i kosztów obsługi oraz dostawy.";
      const terminalNode = mount.querySelector("[data-v4-route-details]");
      terminalNode.innerHTML = variant.terminal ? `<p>Preferowany terminal partnera: <strong>${escapeHtml(variant.terminal.display_name)}</strong>. Dopasowanie: ${escapeHtml(({exact:"dokładne",fallback_zip:"po kodzie pocztowym",fallback_city_state:"po mieście i stanie"})[variant.match_status] || "wymaga potwierdzenia")} · stawki ${escapeHtml(calc.rate_version)}.</p>` : `<p>${variant.status === "ambiguous" ? "Lokalizacja niejednoznaczna." : variant.status === "unmatched" ? "Nie znaleziono pewnej stawki dla placu." : "Brak potwierdzonego terminalu/stawki."} Nie wybieramy zastępczej trasy automatycznie.</p>`;
      const snapshot = {calculation: calc, variant, variants: {standard: calc.standard, conservative: calc.conservative}, knownSubtotalUsd: knownSubtotal, purchasePriceUsd: typedPrice, auctionFeeUsd: fee, priceKind:priceKind.value,
        priceStatus:storedMarketPrice() ? "snapshot" : "current", priceObservedAt:priceObservedAt(), missing};
      if (budgetBinding) {
        snapshot.budget = budgetBinding.update(snapshot);
        snapshot.breakdownText = budgetBinding.exportText();
        // User-entered totals remain estimates, never a confirmed service quote.
        if (snapshot.budget.complete) {
          mount.querySelector("[data-v4-total-label]").textContent = "Budżet z dostawą · PLN";
          mount.querySelector("[data-v4-total]").textContent = money(snapshot.budget.knownTotalPln, "PLN");
          mount.querySelector("[data-v4-status]").textContent = "Szacunek według wpisanych kwot. Potwierdź zakres i stawki przed zakupem.";
          compactMissing.textContent = "Obejmuje wpisane koszty dostawy. Naprawy i rejestracja są poza wyliczeniem.";
        }
      }
      if (onUpdate) onUpdate(snapshot);
      if (typeof mount.dispatchEvent === "function" && typeof CustomEvent === "function") {
        mount.dispatchEvent(new CustomEvent("rexbid:budget-update", {bubbles:true, detail:{
          lot:String(vehicle.lot_number ?? vehicle.lot ?? vehicle.auction?.lot_number ?? ""),
          platform:String(vehicle.platform ?? vehicle.auction?.platform ?? ""),
          priceKind:snapshot.priceKind, priceStatus:snapshot.priceStatus, priceObservedAt:snapshot.priceObservedAt, purchasePriceUsd:typedPrice, knownSubtotalUsd:knownSubtotal,
          budget:snapshot.budget || null, breakdownText:snapshot.breakdownText || ""
        }}));
      }
      return snapshot;
    };
    function selectPreset(focusCustom = true) {
      if (priceKind.value === "current" && positive(currentMarketPrice) === null) priceKind.value = "custom";
      if (priceKind.value === "current") { priceInput.value = currentMarketPrice ?? ""; priceInput.readOnly = true; }
      else if (priceKind.value === "buy-now") { priceInput.value = buyNow ?? ""; priceInput.readOnly = true; }
      else { priceInput.readOnly = false; priceInput.value = userPrice ?? ""; if (focusCustom) priceInput.focus(); }
      readInput();
    }
    priceKind.addEventListener("change", selectPreset);
    priceInput.addEventListener("input", () => { if (priceKind.value === "custom") userPrice = priceInput.value; readInput(); });
    [scenarioInput, classInput, powertrainInput, feeInput].forEach(node => node.addEventListener("input", readInput));
    [scenarioInput, classInput, powertrainInput, feeInput].forEach(node => node.addEventListener("change", readInput));
    if (budgetApi?.bindBudget) budgetBinding = budgetApi.bindBudget({root:mount.querySelector("[data-v4-budget-slot]"), vehicle, onChange:readInput});
    selectPreset(false);
    const updateMarketPrices = ({currentBid, buyNowPrice, read, preview} = {}) => {
      if (currentBid !== undefined) currentMarketPrice = positive(currentBid) ?? "";
      if (buyNowPrice !== undefined) buyNow = positive(buyNowPrice);
      if (read !== undefined) readMetadata = isRecord(read) ? {...read} : null;
      if (preview !== undefined) previewMetadata = isRecord(preview) ? {...preview} : null;
      const buyNowOption = [...priceKind.options].find(option => option.value === "buy-now");
      if (buyNow && !buyNowOption) priceKind.insertBefore(Object.assign(document.createElement("option"), {value:"buy-now", textContent:buyNowPriceLabel()}), priceKind.querySelector("option[value=custom]"));
      if (!buyNow && buyNowOption) buyNowOption.remove();
      if (priceKind.value === "current" || priceKind.value === "buy-now") selectPreset();
      else readInput();
    };
    return Object.freeze({update: readInput, setPriceKind(kind) { if (["current", "buy-now", "custom"].includes(kind) && (kind !== "buy-now" || buyNow)) { priceKind.value = kind; selectPreset(); } }, updateMarketPrices, ratesVersion: rates.version, current: readInput, getBudget:() => budgetBinding?.current() || null, exportBreakdown:() => budgetBinding?.exportText() || "", priceInput, priceKind, auctionFeeInput: feeInput});
  }

  return Object.freeze({rates: RATES, partnerReference: PARTNER_REFERENCE, normalizeState, normalizeLocation, normalizeZip, normalizePlatform, matchingLocation, normalizePowertrain, matchPowertrain, vehicleClassFrom, calculateVariant, calculate, terminalFrom, bindCalculator});
});
