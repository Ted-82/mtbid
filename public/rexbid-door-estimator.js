(function (root, factory) {
  const rates = typeof module === "object" && module.exports
    ? require("./rexbid-door-estimator-rates.js")
    : root && root.RexBidDoorEstimatorRates;
  const value = factory(rates);
  if (typeof module === "object" && module.exports) module.exports = value;
  if (root) root.RexBidDoorEstimator = value;
})(typeof globalThis !== "undefined" ? globalThis : this, function (RATES) {
  "use strict";

  const confidenceRank = { high: 0, medium: 1, low: 2 };
  const capConfidence = (...values) => values.filter(Boolean).reduce((lowest, value) => confidenceRank[value] > confidenceRank[lowest] ? value : lowest, "high");
  const numeric = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const roundMoney = value => Math.round(value * 100) / 100;
  const roundedDisplay = value => Math.round(value / 100) * 100;
  const normalize = value => String(value || "").trim().toLowerCase();
  const rangeComponent = (id, label, values, currency, source, confidence, assumptions = []) => ({
    id, label, low: roundMoney(values[0]), expected: roundMoney(values[1]), high: roundMoney(values[2]), currency,
    confidence: capConfidence(confidence, source && source.confidence), source: source ? [{ url: source.url || null, label: source.label || null, checked_at: source.checked_at }] : [],
    checked_at: source && source.checked_at || RATES.checked_at, effective_from: source && source.effective_from || null,
    assumptions: [...(source && source.assumptions || []), ...assumptions]
  });

  function vehicleContext(vehicle = {}) {
    const desc = vehicle.vehicle_description || vehicle.details && vehicle.details.vehicle_description || {};
    const auction = vehicle.auction || {};
    const loc = [auction.facility, auction.facility_name, auction.location, auction.location_display, auction.state, auction.zip,
      vehicle.facility, vehicle.facility_name, vehicle.location, vehicle.location_display, vehicle.state, vehicle.zip,
      vehicle.details && vehicle.details.location].filter(Boolean).join(" ");
    const zip = String(auction.zip || auction.postal_code || vehicle.zip || vehicle.postal_code || "").trim() || null;
    const state = String(auction.state_code || auction.state_abbr || vehicle.state_code || vehicle.state_abbr || "").toUpperCase()
      || ((loc.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i) || [])[1] || "").toUpperCase();
    const platform = normalize(vehicle.platform || vehicle.source || auction.platform);
    const rawRun = normalize(auction.operability || auction.run_condition || vehicle.operability || vehicle.run_condition || vehicle.condition && vehicle.condition.operability || desc.RunCondition || desc.RunsDrives).replaceAll("&", "and");
    const nonRunner = auction.is_operable === false || vehicle.is_operable === false || /non.?runner|does not run|stationary|not operational|no start/.test(rawRun);
    const operable = auction.is_operable === true || vehicle.is_operable === true || /run.?and.?drive|runs.?and.?drives|operable/.test(rawRun);
    const body = normalize(vehicle.vehicle_type || vehicle.body_type || vehicle.body_style || desc.VehicleClass || desc.Vehicle || "");
    const oversize = /oversize|heavy|truck|bus|rv|trailer|van|large/.test(body) || Number(vehicle.length_inches || desc.LengthInches) > 192;
    const engineRaw = vehicle.engine_displacement_cc ?? vehicle.engine_cc ?? vehicle.engineCc ?? desc.EngineCC ?? desc.EngineCc ?? desc.CubicCentimeters;
    let engineCc = numeric(engineRaw);
    if (!engineCc) {
      const liters = numeric(desc.DisplLiters ?? vehicle.displacement_liters);
      if (liters) engineCc = Math.round(liters * 1000);
    }
    const fuel = normalize(vehicle.fuel_type || vehicle.fuel || desc.FuelTypeDesc || desc.FuelType || "");
    const drive = normalize(vehicle.drivetrain || vehicle.drive_type || desc.DriveLineTypeDesc || desc.DriveLineType || "");
    const vehicleClass = normalize(vehicle.vehicle_class || vehicle.vehicle_type || desc.VehicleClass || "");
    const legalPassenger = /passenger|sedan|coupe|suv|sport utility|wagon|hatchback/.test(vehicleClass + " " + body);
    const powertrain = /plug.?in|phev/.test(fuel + " " + drive) ? "hybrid_plugin"
      : /hybrid|hev/.test(fuel + " " + drive) ? "hev"
      : /electric|battery|\bev\b/.test(fuel + " " + drive) ? "electric"
      : /gasoline|petrol|diesel|flex fuel|natural gas/.test(fuel) ? "combustion" : "unknown";
    const routeMiles = numeric(auction.distance_to_port_miles ?? vehicle.distance_to_port_miles ?? (vehicle.route && vehicle.route.distance_miles));
    return { platform, location: loc, zip, routeMiles, state, operable, nonRunner, runKnown: operable || nonRunner, body, oversize, engineCc, fuel, drive, vehicleClass, legalPassenger, powertrain };
  }

  function inlandForMiles(miles) {
    const bands = [
      { max: 100, values: [125, 175, 200] }, { max: 250, values: [230, 250, 290] },
      { max: 500, values: [285, 325, 375] }, { max: 800, values: [500, 525, 550] },
      { max: 1200, values: [515, 550, 600] }, { max: Infinity, values: [600, 650, 875] }
    ];
    return bands.find(band => miles <= band.max).values;
  }

  function selectRoute(context) {
    const text = normalize(context.location);
    const state = context.state;
    let route, ocean, region;
    if (state === "TX" && /dallas|fort worth|dfw/.test(text)) { route = RATES.inlandByRoute.tx_dallas_houston; ocean = RATES.ocean.gulf; region = "gulf"; }
    else if (state === "TX") { route = RATES.inlandByRoute.tx_houston_local; ocean = RATES.ocean.gulf; region = "gulf"; }
    else if (state === "NJ" || /new jersey|newark|irvington/.test(text)) { route = RATES.inlandByRoute.nj_newark_local; ocean = RATES.ocean.east; region = "east"; }
    else if (state === "CA") { route = RATES.inlandByRoute.ca_los_angeles; ocean = RATES.ocean.west; region = "west"; }
    else if (state === "WA") { route = RATES.inlandByRoute.wa_tacoma_regional; ocean = RATES.ocean.west; region = "west"; }
    if (route) {
      if (context.routeMiles !== null) route = { ...route, miles: [context.routeMiles, context.routeMiles], range: inlandForMiles(context.routeMiles) };
      return { inland: route, ocean, state: state || "NJ", region, routeDistanceProvided: context.routeMiles !== null, zip: context.zip };
    }
    const east = new Set(["CT", "DE", "FL", "GA", "ME", "MD", "MA", "NH", "NY", "NC", "PA", "RI", "SC", "VA"]);
    const west = new Set(["AK", "AZ", "HI", "ID", "NV", "OR"]);
    region = east.has(state) ? "east" : west.has(state) ? "west" : "central";
    const regionalInland = RATES.inlandByRoute[region + "_region"];
    if (context.routeMiles !== null) return {
      inland: { ...regionalInland, miles: [context.routeMiles, context.routeMiles], range: inlandForMiles(context.routeMiles) },
      ocean: RATES.ocean[region] || RATES.ocean.unknown, state: state || null, region, routeDistanceProvided: true, regionalFallback: true, zip: context.zip
    };
    return {
      inland: regionalInland, ocean: RATES.ocean[region] || RATES.ocean.unknown, state: state || null, region,
      regionalFallback: true, routeDistanceProvided: false, zip: context.zip
    };
  }

  function interpolate(anchors, bid, key) {
    if (bid <= anchors[0].bid) return anchors[0][key] * Math.max(0.25, bid / anchors[0].bid);
    for (let i = 1; i < anchors.length; i++) {
      if (bid <= anchors[i].bid) {
        const left = anchors[i - 1], right = anchors[i];
        const ratio = (bid - left.bid) / (right.bid - left.bid);
        return left[key] + (right[key] - left[key]) * ratio;
      }
    }
    const left = anchors[anchors.length - 2], right = anchors[anchors.length - 1];
    const slope = (right[key] - left[key]) / (right.bid - left.bid);
    return Math.max(right[key], right[key] + (bid - right.bid) * slope);
  }

  function estimateAuctionFee(platform, bid) {
    if (platform.includes("copart")) {
      const cfg = RATES.auction_fees.copart;
      const low = interpolate(cfg.anchors, bid, "low");
      const expected = interpolate(cfg.anchors, bid, "expected");
      const high = interpolate(cfg.anchors, bid, "high");
      return rangeComponent("auction_fee", "Opłaty aukcyjne", [low, expected, high], "USD", {
        url: cfg.source_url, checked_at: cfg.checked_at, confidence: cfg.confidence, assumptions: cfg.assumptions
      }, cfg.confidence, ["Kwoty są scenariuszem widełkowym; dokładna faktura Copart zależy od profilu, tabeli konta, metody płatności, title group i trybu licytacji."]);
    }
    if (platform.includes("iaai") || platform.includes("insurance auto auction")) {
      const cfg = RATES.auction_fees.iaai;
      const expected = interpolate(cfg.anchors, bid, "expected");
      return rangeComponent("auction_fee", "Opłaty aukcyjne", [expected * 0.75, expected, expected * 1.4], "USD", {
        url: cfg.source_url, checked_at: cfg.checked_at, confidence: cfg.confidence,
        assumptions: [...cfg.assumptions, "Nie jest to oficjalny cennik IAA."]
      }, "low");
    }
    return null;
  }

  function scaleRange(range, factors, assumptions = []) {
    return {
      low: range[0] * factors[0], expected: range[1] * factors[1], high: range[2] * factors[2], assumptions
    };
  }

  function taxScenario(context, bid, fee, inland, ocean, destination, delivery, insurance, dutyRate, exciseRate) {
    const customsBase = bid + fee + inland + ocean + insurance;
    const duty = customsBase * dutyRate;
    const excise = context.legalPassenger && context.powertrain === "combustion" && context.engineCc
      ? (customsBase + duty) * (context.engineCc <= 2000 ? RATES.tax.excise_rates.passenger_up_to_2000 : RATES.tax.excise_rates.passenger_over_2000)
      : (customsBase + duty) * exciseRate;
    const vatBase = customsBase + duty + excise + destination + delivery;
    const vat = vatBase * RATES.tax.vat_rate;
    return { purchase: bid, fee, inland, ocean, destination, delivery, insurance, duty, excise, vat, total: bid + fee + inland + ocean + destination + delivery + insurance + duty + excise + vat };
  }

  function estimate(vehicle = {}, options = {}) {
    const bid = numeric(options.purchasePriceUsd);
    if (bid === null || bid <= 0) return { ok: false, reason: "Wpisz planowaną cenę zakupu.", components: [], total: null };
    const context = vehicleContext(vehicle);
    if (!context.platform.includes("copart") && !context.platform.includes("iaai") && !context.platform.includes("insurance auto auction"))
      return { ok: false, reason: "Nie udało się ustalić Copart/IAAI; nie wyliczam opłat aukcyjnych jako $0.", components: [], total: null };
    const route = selectRoute(context);
    const fee = estimateAuctionFee(context.platform, bid);
    if (!fee) return { ok: false, reason: "Brak modelu opłat dla platformy aukcyjnej.", components: [], total: null };
    const sourceInland = route.inland.range;
    let inlandFactors = [1, 1, 1];
    const inlandAssumptions = [];
    if (!context.runKnown || context.nonRunner) {
      inlandFactors = context.nonRunner ? [1, 1.35, 1.9] : [1, 1.25, 1.75];
      inlandAssumptions.push(context.nonRunner ? "Pojazd oznaczony jako non-runner; brak potwierdzonej dopłaty, więc rozszerzono widełki. Możliwa dodatkowa opłata." : "Brak potwierdzonej operacyjności; widełki rozszerzone, możliwa dopłata.");
    }
    if (context.oversize) {
      inlandFactors = [inlandFactors[0], inlandFactors[1] * 1.1, inlandFactors[2] * 1.45];
      inlandAssumptions.push("Pojazd może wymagać sprzętu lub dopłaty gabarytowej; brak potwierdzonej stawki.");
    }
    const inlandRange = scaleRange(sourceInland, inlandFactors, inlandAssumptions);
    const oceanRange = route.ocean.range.slice();
    const oceanAssumptions = [];
    if (context.oversize) {
      oceanRange[2] *= 1.25;
      oceanAssumptions.push("Gabaryt może zmienić metodę lub koszt wysyłki; dopłata wymaga wyceny.");
    }
    if (/suv|sport utility/.test(context.body)) {
      oceanRange[2] *= 1.12;
      oceanAssumptions.push("SUV: wybrane publiczne cenniki stosują odrębną cenę lub dopłatę; wartość konkretnej trasy niepotwierdzona.");
    }
    const destinationRange = RATES.destination.range;
    const deliveryRange = RATES.poland_delivery.range;
    const insuranceRange = RATES.optional_insurance.fractions.map(fraction => bid * fraction);
    const engineTaxKnown = context.legalPassenger && context.powertrain === "combustion" && !!context.engineCc;
    const exciseScenarios = engineTaxKnown
      ? [context.engineCc <= 2000 ? 0.031 : 0.186, context.engineCc <= 2000 ? 0.031 : 0.186, context.engineCc <= 2000 ? 0.031 : 0.186]
      : [0, 0.093, 0.186];
    const low = taxScenario(context, bid, fee.low, inlandRange.low, oceanRange[0], destinationRange[0], deliveryRange[0], insuranceRange[0], RATES.customs.low_rate, exciseScenarios[0]);
    const expected = taxScenario(context, bid, fee.expected, inlandRange.expected, oceanRange[1], destinationRange[1], deliveryRange[1], insuranceRange[1], RATES.customs.expected_rate, exciseScenarios[1]);
    const high = taxScenario(context, bid, fee.high, inlandRange.high, oceanRange[2], destinationRange[2], deliveryRange[2], insuranceRange[2], RATES.customs.high_rate, exciseScenarios[2]);
    const fx = numeric(options.fxRate) || RATES.fx.rate;
    const transportConfidence = capConfidence(route.inland.source.confidence, route.ocean.source.confidence, route.regionalFallback ? "low" : null,
      context.runKnown ? null : "low", context.nonRunner || context.oversize ? "low" : null);
    const components = [
      rangeComponent("vehicle", "Auto", [bid, bid, bid], "USD", { label: "Planowana cena zakupu wpisana przez użytkownika", checked_at: RATES.checked_at, confidence: "high", assumptions: ["Nie jest automatycznie current bid ani ceną końcową."] }, "high"),
      fee,
      rangeComponent("us_inland", "Transport USA", [inlandRange.low, inlandRange.expected, inlandRange.high], "USD", route.inland.source, transportConfidence,
        [...inlandRange.assumptions, `Modelowany port: ${route.inland.port}.`, ...(route.inland.miles ? [`Pasmo trasy: ${route.inland.miles[0]}–${route.inland.miles[1]} mil.`] : []), ...(route.zip ? [`ZIP źródłowy: ${route.zip}; brak potwierdzonej taryfy per ZIP.`] : []), ...(route.routeDistanceProvided ? ["Użyto jawnej odległości facility–port w danych pojazdu i pasma rynkowego."] : []), ...(route.regionalFallback ? ["Brak dopasowania facility/ZIP; użyto szerszego regionu."] : [])]),
      rangeComponent("ocean_logistics", "Transport morski / logistyka", [oceanRange[0], oceanRange[1], oceanRange[2]], "USD", route.ocean.source, route.ocean.source.confidence,
        [`Założony port docelowy: ${route.ocean.port}.`, ...oceanAssumptions, "To zakres rynkowy z publicznych cenników, nie oferta partnera Rex.Bid."]),
      rangeComponent("poland_costs", "Podatki i opłaty", [low.destination + low.delivery + low.duty + low.excise + low.vat, expected.destination + expected.delivery + expected.duty + expected.excise + expected.vat, high.destination + high.delivery + high.duty + high.excise + high.vat], "USD", {
        url: RATES.customs.source_urls[0], checked_at: RATES.checked_at, confidence: engineTaxKnown ? "low" : "low",
        assumptions: ["Cło: LOW zakłada możliwą preferencję 0% po potwierdzeniu pochodzenia/dokumentów; EXPECTED/HIGH używa scenariusza 10% dla przykładowego CN 8703, nie stawki pewnej.", engineTaxKnown ? `Akcyza modelowana w scenariuszu ${context.engineCc <= 2000 ? "3,1%" : "18,6%"} dla auta osobowego z rozpoznanym silnikiem spalinowym; prawna klasyfikacja do potwierdzenia.` : "Nie można bezpiecznie sklasyfikować napędu/pojazdu: scenariusz akcyzy obejmuje 0%–18,6%, nie potwierdza zwolnienia.", ...RATES.tax.assumptions]
      }, "low", ["Zawiera szacunkowe koszty po stronie PL, cło, akcyzę i import VAT."])
    ];
    const sum = scenario => roundMoney(scenario.total * fx);
    const total = { low: sum(low), expected: sum(expected), high: sum(high), currency: "PLN", display: [roundedDisplay(sum(low)), roundedDisplay(sum(expected)), roundedDisplay(sum(high))], fx: { rate: fx, currency_pair: "USD/PLN", source: RATES.fx.source_url, checked_at: RATES.fx.checked_at, status: "estimated" } };
    const detailComponents = [
      rangeComponent("customs_duty_detail", "Cło — scenariusz", [low.duty * fx, expected.duty * fx, high.duty * fx], "PLN", { url: RATES.customs.source_urls[0], checked_at: RATES.customs.checked_at, confidence: "low", assumptions: RATES.customs.assumptions }, "low"),
      rangeComponent("excise_detail", "Akcyza — scenariusz", [low.excise * fx, expected.excise * fx, high.excise * fx], "PLN", { url: RATES.tax.excise_source_url, checked_at: RATES.tax.checked_at, confidence: engineTaxKnown ? "medium" : "low", assumptions: [engineTaxKnown ? "Wstępna klasyfikacja z danych paliwa, pojemności i typu auta; dokumenty prawne nie zostały zweryfikowane." : "Klasyfikacja prawna nieustalona; zakres scenariuszowy nie przesądza zwolnienia ani stawki."] }, engineTaxKnown ? "medium" : "low"),
      rangeComponent("vat_detail", "VAT importowy — scenariusz", [low.vat * fx, expected.vat * fx, high.vat * fx], "PLN", { url: RATES.tax.vat_source_url, checked_at: RATES.tax.checked_at, confidence: "low", assumptions: RATES.tax.assumptions }, "low")
    ];
    let confidence = capConfidence(...components.map(x => x.confidence), context.runKnown ? null : "low", route.regionalFallback ? "low" : null);
    if (context.platform.includes("iaai")) confidence = "low";
    Object.assign(total, {
      confidence, checked_at: RATES.checked_at, effective_from: null,
      source: [{ url: RATES.fx.source_url, checked_at: RATES.fx.checked_at }, ...components.flatMap(component => component.source)],
      assumptions: ["Wynik orientacyjny, nie oferta; końcowe widełki łączą opłaty, logistykę i scenariusze podatkowe."]
    });
    const assumptions = [
      `Platforma: ${context.platform || "nieznana"}; lokalizacja/state: ${context.location || "brak"}; wybrany port: ${route.inland.port}.`,
      context.runKnown ? (context.nonRunner ? "Pojazd non-runner; dopłata nie została potwierdzona." : "Operacyjność rozpoznana jako operable.") : "Nieznana operacyjność — szerokie widełki transportu.",
      context.engineCc ? `Pojemność źródłowa: ${context.engineCc} cm³.` : "Brak pojemności; szerszy scenariusz akcyzy.",
      "Nie doliczono warunkowych storage, late-payment, relist, podatku sprzedażowego USA, brokera ani niepotwierdzonych dopłat."
    ];
    return {
      ok: true, model_version: RATES.version, platform: context.platform || null, route: { port: route.inland.port, sea_route: route.ocean.port, state: route.state, regional_fallback: !!route.regionalFallback },
      total, confidence, components, detail_components: detailComponents, assumptions, scenarios: { low, expected, high }
    };
  }

  function formatPln(value) { return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(roundedDisplay(value)) + " PLN"; }
  function confidenceLabel(value) { return value === "high" ? "wysoka" : value === "medium" ? "średnia" : "niska"; }
  function render(root, result) {
    if (!root || !result || !result.ok) return;
    const $ = selector => root.querySelector(selector);
    const total = $("[data-est-total]");
    if (total) total.textContent = `${formatPln(result.total.display[0])} – ${formatPln(result.total.display[2])}`;
    const expected = $("[data-est-expected]");
    if (expected) expected.textContent = `Najbardziej prawdopodobnie ~${formatPln(result.total.display[1])}`;
    const confidence = $("[data-est-confidence]");
    if (confidence) confidence.textContent = `Pewność: ${confidenceLabel(result.confidence)}`;
    const rows = $("[data-est-rows]");
    if (rows) {
      rows.replaceChildren();
      for (const component of result.components) {
        const row = document.createElement("div"); row.className = "door-est-row";
        const name = document.createElement("span"); name.textContent = component.label;
        const amount = document.createElement("strong"); amount.textContent = component.id === "vehicle" ? formatUsd(component.expected) : `${formatUsd(component.low)} – ${formatUsd(component.high)}`;
        row.append(name, amount); rows.append(row);
      }
    }
    const details = $("[data-est-details]");
    if (details) {
      details.replaceChildren();
      for (const component of result.components) {
        const group = document.createElement("section"); group.className = "door-est-detail";
        const heading = document.createElement("h4"); heading.textContent = `${component.label}: ${formatUsd(component.low)} / ${formatUsd(component.expected)} / ${formatUsd(component.high)}`;
        const meta = document.createElement("p"); meta.textContent = `Pewność: ${confidenceLabel(component.confidence)} · Sprawdzono: ${component.checked_at}`;
        const assumptions = document.createElement("ul");
        for (const assumption of component.assumptions) { const li = document.createElement("li"); li.textContent = assumption; assumptions.append(li); }
        const sources = document.createElement("p"); sources.textContent = component.source.map(item => `${item.url || item.label} (${item.checked_at})`).join(" · ") || "Brak źródła stawki.";
        group.append(heading, meta, assumptions, sources); details.append(group);
      }
      for (const component of result.detail_components || []) {
        const group = document.createElement("section"); group.className = "door-est-detail";
        const heading = document.createElement("h4"); heading.textContent = `${component.label}: ${formatPln(component.low)} / ${formatPln(component.expected)} / ${formatPln(component.high)}`;
        const meta = document.createElement("p"); meta.textContent = `Pewność: ${confidenceLabel(component.confidence)} · Sprawdzono: ${component.checked_at}`;
        const assumptions = document.createElement("ul");
        for (const assumption of component.assumptions) { const li = document.createElement("li"); li.textContent = assumption; assumptions.append(li); }
        const sources = document.createElement("p"); sources.textContent = component.source.map(item => `${item.url} (${item.checked_at})`).join(" · ");
        group.append(heading, meta, assumptions, sources); details.append(group);
      }
      for (const assumption of result.assumptions) { const p = document.createElement("p"); p.textContent = assumption; details.append(p); }
      const fx = document.createElement("p"); fx.textContent = `Kurs orientacyjny: 1 USD = ${result.total.fx.rate.toFixed(4)} PLN · ${result.total.fx.checked_at}; nie jest kursem celnym ani akcyzowym.`; details.append(fx);
    }
  }
  function formatUsd(value) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
  function bind(options = {}) {
    const root = options.root || document.getElementById("estimatedDoorCalculator");
    if (!root) return null;
    const input = root.querySelector("[data-est-purchase]");
    if (input && input.value === "" && numeric(options.prefill && options.prefill.purchasePrice) !== null) input.value = String(options.prefill.purchasePrice);
    const note = root.querySelector("[data-est-purchase-note]");
    if (note && options.prefill) note.textContent = options.prefill.purchaseKind === "confirmed-sale"
      ? "Wstępnie uzupełniono potwierdzoną ceną sprzedaży. Sprawdź i zmień na planowaną kwotę, jeśli trzeba."
      : options.prefill.purchaseKind === "active-suggestion" || options.prefill.purchaseKind === "buy-now-suggestion"
        ? "Sugestia z aukcji, nie przyszła cena zakupu. Wpisz własną planowaną kwotę."
        : "Wpisz planowaną cenę zakupu.";
    const update = () => {
      const result = estimate(options.vehicle || {}, { purchasePriceUsd: input && input.value });
      if (result.ok) render(root, result);
      else {
        const total = root.querySelector("[data-est-total]"); if (total) total.textContent = result.reason || "Wpisz planowaną cenę zakupu";
        const expected = root.querySelector("[data-est-expected]"); if (expected) expected.textContent = "";
        const rows = root.querySelector("[data-est-rows]"); if (rows) rows.replaceChildren();
      }
      return result;
    };
    input && input.addEventListener("input", update);
    return update();
  }

  return Object.freeze({ rates: RATES, vehicleContext, selectRoute, estimate, bind, render, formatPln });
});
