const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const rates = require("../public/rexbid-calculator-v4-rates.js");
const calculator = require("../public/rexbid-calculator-v4.js");
const {contentVersion} = require("../scripts/build-calculator-v4-rates.cjs");

function inputFor(row, overrides = {}) {
  return {
    platform: row.platform,
    auction_location: row.auction_location,
    city: row.city,
    state: row.state_province,
    zip: row.postal_code,
    country: row.country,
    vehicleClass: "sedan",
    powertrain: "ICE",
    ...overrides
  };
}

const houston = rates.locations.find(row => row.platform === "Copart" && row.auction_location === "HOUSTON 77073");

test("V4 uses the partner-preferred terminal even where another complete route would cost less", () => {
  const candidate = rates.locations.find(row => {
    const preferredLand = row.rates[row.preferred_terminal_id];
    const preferredSea = rates.sea.find(item => item.terminal_id === row.preferred_terminal_id && item.cars_per_container === 4);
    if (preferredLand === null || !preferredSea) return false;
    const preferred = preferredLand + preferredSea.amount;
    const cheapest = Math.min(...rates.terminals.map(terminal => {
      const land = row.rates[terminal.id];
      const sea = rates.sea.find(item => item.terminal_id === terminal.id && item.cars_per_container === 4);
      return land === null || !sea ? Infinity : land + sea.amount;
    }));
    return preferred > cheapest;
  });
  assert.ok(candidate, "source rate set includes a case that distinguishes preferred from cheapest route");
  const result = calculator.calculate(rates, inputFor(candidate));
  assert.equal(result.standard.terminal.id, candidate.preferred_terminal_id);
  assert.ok(result.standard.land_base_usd + result.standard.sea_usd > 0);
  const preferredSea = rates.sea.find(item => item.terminal_id === candidate.preferred_terminal_id && item.cars_per_container === 4);
  assert.equal(result.standard.amount_usd, candidate.rates[candidate.preferred_terminal_id] + preferredSea.amount);
});

test("Houston partner example keeps per-vehicle 4-car and 3-car freight and counts BEV packing once", () => {
  const ice = calculator.calculate(rates, inputFor(houston));
  assert.equal(ice.standard.terminal.id, "houston_tx");
  assert.equal(ice.standard.land_usd, 205);
  assert.equal(ice.standard.sea_usd, 675);
  assert.equal(ice.standard.amount_usd, 880);
  assert.equal(ice.conservative.land_usd, 205);
  assert.equal(ice.conservative.sea_usd, 850);
  assert.equal(ice.conservative.amount_usd, 1055);
  assert.equal(ice.standard.terminal.id, ice.conservative.terminal.id, "standard and conservative scenarios keep the same partner-preferred terminal");

  const bev = calculator.calculate(rates, inputFor(houston, {powertrain: "BEV"}));
  assert.equal(bev.standard.ev_packing.amount_usd, 150);
  assert.equal(bev.standard.amount_usd, 1030);
  assert.equal(bev.conservative.ev_packing.amount_usd, 150);
  assert.equal(bev.conservative.amount_usd, 1205);
  assert.equal(bev.standard.amount_usd - ice.standard.amount_usd, 150);
  assert.equal(bev.conservative.amount_usd - ice.conservative.amount_usd, 150);
  const fourVehicles = Array.from({length: 4}, () => calculator.calculate(rates, inputFor(houston, {powertrain:"BEV"})).standard.ev_packing.amount_usd);
  assert.deepEqual(fourVehicles, [150, 150, 150, 150]);
  assert.equal(fourVehicles.reduce((sum, amount) => sum + amount, 0), 600, "four confirmed BEVs pay one $150 packing charge each");
});

test("oversize multiplier changes land only and never scales the confirmed BEV surcharge", () => {
  const sedan = calculator.calculate(rates, inputFor(houston, {powertrain: "BEV", vehicleClass: "sedan"})).standard;
  const largeSuv = calculator.calculate(rates, inputFor(houston, {powertrain: "BEV", vehicleClass: "suv_large"})).standard;
  assert.equal(sedan.land_usd, 205);
  assert.equal(largeSuv.land_usd, 307.5);
  assert.equal(largeSuv.sea_usd, sedan.sea_usd);
  assert.equal(largeSuv.ev_packing.amount_usd, 150);
  assert.equal(largeSuv.amount_usd - largeSuv.land_usd - largeSuv.sea_usd, 150);
});

test("hybrid and unknown powertrains require confirmation instead of assuming EV fee is zero", () => {
  for (const powertrain of ["HEV", "PHEV", "unknown"]) {
    const result = calculator.calculate(rates, inputFor(houston, {powertrain})).standard;
    assert.equal(result.ev_packing.status, "requires_confirmation", powertrain);
    assert.equal(result.amount_usd, null, powertrain);
    assert.equal(result.known_amount_usd, 880, powertrain);
    assert.ok(result.missing.includes("Potwierdzenie dopłaty dla napędu"), powertrain);
  }
});

test("unknown class and missing preferred-route data remain incomplete rather than zero", () => {
  const unknownClass = calculator.calculate(rates, inputFor(houston, {vehicleClass: ""})).standard;
  assert.equal(unknownClass.status, "incomplete");
  assert.equal(unknownClass.land_usd, null);
  const noLocation = calculator.calculate(rates, {platform: "Copart", auction_location: "No such branch", powertrain: "ICE", vehicleClass: "sedan"}).standard;
  assert.equal(noLocation.status, "unmatched");
  assert.equal(noLocation.amount_usd, null);
});

test("the unresolved Albany partner rate conflict remains blocked in V4 instead of falling back to another route", () => {
  const conflict = rates.locations.find(row => row.platform === "Copart" && row.rate_status === "source_conflict");
  assert.ok(conflict, "fixture package preserves the documented partner conflict");
  const result = calculator.calculate(rates, inputFor(conflict, {vehicleClass:"sedan",powertrain:"ICE"}));
  assert.equal(result.standard.status, "requires_confirmation");
  assert.equal(result.standard.amount_usd, null);
  assert.ok(result.standard.missing.includes("Potwierdzenie spornej stawki partnera"));
});

test("V4 rate-set version fingerprints rates, routing, class multipliers and EV surcharge", () => {
  const baseline = contentVersion(rates);
  for (const mutate of [
    clone => { clone.locations[0].rates[clone.locations[0].preferred_terminal_id] += 1; },
    clone => { clone.sea[0].amount += 1; },
    clone => { clone.locations[0].preferred_terminal_id = clone.terminals.find(item => item.id !== clone.locations[0].preferred_terminal_id).id; },
    clone => { clone.land_classes[0].land_multiplier += 0.1; },
    clone => { clone.surcharges[0].amount += 1; }
  ]) {
    const changed = JSON.parse(JSON.stringify(rates));
    mutate(changed);
    assert.notEqual(contentVersion(changed), baseline);
  }
});

test("custom purchase price survives market refresh while current and Buy Now presets follow the listing", () => {
  class Node {
    constructor(value = "") { this.value = value; this.textContent = ""; this.innerHTML = ""; this.children = []; this.options = []; this.handlers = {}; this.readOnly = false; }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = [...items]; }
    focus() {}
    querySelector(selector) { return this.options.find(option => selector === "option[value=custom]" && option.value === "custom") || null; }
    insertBefore(option) { this.options.push(option); }
  }
  const nodes = new Map();
  const mount = {
    set innerHTML(value) { this.markup = value; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector); }
  };
  const priceKind = mount.querySelector("[data-v4-price-kind]");
  priceKind.value = "current";
  priceKind.options = ["current", "custom", "buy-now"].map(value => Object.assign(new Node(), {value}));
  mount.querySelector("[data-v4-scenario]").value = "standard";
  mount.querySelector("[data-v4-class]").value = "sedan";
  mount.querySelector("[data-v4-powertrain]").value = "ICE";
  const binding = calculator.bindCalculator({
    root: mount,
    rates,
    vehicle: {platform: "Copart", auction: {facility_name: houston.auction_location, city: houston.city, state: houston.state_province, zip: houston.postal_code}, pricing: {current_bid_usd: 1000, buy_now_usd: 5000}, body_style: "Sedan", fuel_type: "Gasoline"}
  });
  const visibleBreakdown = mount.querySelector("[data-v4-lines]").innerHTML;
  for (const label of ["Cena pojazdu", "Opłaty aukcyjne", "Transport USA + morski", "Odprawa i podatki", "Obsługa i dostawa w Polsce", "Suma zakupu i znanego transportu"]) {
    assert.ok(visibleBreakdown.includes(label), `visible breakdown includes ${label}`);
  }
  assert.doesNotMatch(visibleBreakdown, /Obsługa\/import|Cło|VAT|Akcyza|Port\/odprawa|Transport w Polsce|Pakowanie EV/,
    "the primary summary stays compact and does not list irrelevant/unknown detail rows");
  const detailBreakdown = mount.querySelector("[data-v4-component-lines]").innerHTML;
  for (const label of ["Transport lądowy USA", "Fracht morski", "Obsługa/import", "Cło", "VAT", "Akcyza", "Port/odprawa", "Transport w Polsce"]) {
    assert.ok(detailBreakdown.includes(label), `expanded calculation details include ${label}`);
  }
  assert.match(visibleBreakdown, /Do potwierdzenia/, "unknown components are not rendered as zero");
  binding.setPriceKind("custom");
  binding.priceInput.value = "2500";
  binding.priceInput.handlers.input();
  binding.updateMarketPrices({currentBid: 3200, buyNowPrice: 6000});
  assert.equal(binding.priceKind.value, "custom");
  assert.equal(binding.priceInput.value, "2500");
  binding.setPriceKind("current");
  binding.updateMarketPrices({currentBid: 3500, buyNowPrice: 7000});
  assert.equal(binding.priceInput.value, 3500);
  binding.setPriceKind("buy-now");
  assert.equal(binding.priceInput.value, 7000);
});

test("expanded V4 cost rows are styled through the data attributes actually emitted by the calculator", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/car.html"), "utf8");
  assert.match(html, /data-v4-component-lines/);
  assert.match(html, /\[data-v4-component-lines\]>div\{display:flex/);
  assert.match(html, /\[data-v4-route-details\] p\{/);
  assert.doesNotMatch(html, /\.calc-v4-component-lines>div/);
});


test("real IAAI physical facility disambiguates shared ZIP only with confirmed city and state", () => {
  const input = {platform:"iaai", auction_location:"Los Angeles", postal_code:"90248", city:"Gardena", state:"CA", vehicleClass:"sedan", powertrain:"ICE"};
  const result = calculator.calculate(rates, input);
  assert.equal(result.match.status, "exact");
  assert.equal(calculator.calculate(rates, {...input, city:""}).standard.land_usd, 220, "public D1 DTO branch + ZIP suffices without a city column");
  assert.equal(result.standard.land_usd, 220);
  assert.equal(result.standard.sea_usd, 1175);
  assert.equal(result.standard.amount_usd, 1395);
  assert.equal(calculator.calculate(rates, {...input, auction_location:"Virtual branch", city:""}).match.status, "ambiguous");
  assert.equal(calculator.calculate(rates, {...input, auction_location:"Virtual branch", city:"Unknown"}).match.status, "ambiguous");
});

test("real calculator DOM changes freshness labels and outgoing context without changing observed prices", t => {
  const {JSDOM} = require("jsdom");
  const dom = new JSDOM('<section id="importCalculator"><div id="calculatorMount"></div></section>', {url:"https://rexbid.pl/car.html?lot=62674546&platform=copart",runScripts:"outside-only"});
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document;
  for (const file of ["rexbid-calculator-v4-rates.js", "rexbid-import-budget.js", "rexbid-calculator-v4.js"])
    win.eval(fs.readFileSync(path.join(__dirname,"../public",file),"utf8"));
  const updates = [];
  doc.addEventListener("rexbid:budget-update", event => updates.push(event.detail));
  const binding = win.RexBidCalculatorV4.bindCalculator({root:doc.getElementById("calculatorMount"),
    vehicle:{lot:"62674546",platform:"copart",auction:{facility_name:"HOUSTON 77073"},
      pricing:{current_bid_usd:10000,buy_now_usd:12000},body_style:"Sedan",fuel_type:"Electric",read:{source:"d1",freshness:"fresh"}}});
  const currentOption = doc.querySelector('[data-v4-price-kind] option[value="current"]');
  assert.equal(currentOption.textContent,"Aktualna oferta");
  assert.equal(updates.at(-1).priceStatus,"current");
  const initialTotal = doc.querySelector("[data-v4-total]").textContent;
  binding.updateMarketPrices({read:{source:"d1",freshness:"stale",last_synced_at:"2026-10-05T21:30:00Z"}});
  assert.equal(currentOption.textContent,"Ostatnia zapisana oferta");
  assert.equal(binding.priceKind.value,"current");
  assert.equal(binding.priceInput.value,"10000");
  assert.equal(doc.querySelector("[data-v4-total]").textContent,initialTotal);
  assert.match(doc.querySelector("[data-v4-price-note]").textContent,/23:30/,'UI observation time follows Europe/Warsaw');
  assert.equal(updates.at(-1).priceStatus,"snapshot");
  assert.equal(updates.at(-1).priceObservedAt,"2026-10-05T21:30:00.000Z");
  assert.match(updates.at(-1).breakdownText,/ostatnia zapisana oferta/);
  assert.doesNotMatch(updates.at(-1).breakdownText,/aktualna oferta aukcyjna/);
  const kind = doc.querySelector("[data-v4-price-kind]");
  kind.value="buy-now"; kind.dispatchEvent(new win.Event("change",{bubbles:true}));
  assert.equal(binding.priceInput.value,"12000");
  assert.match(binding.exportBreakdown(),/Kup teraz · zapis danych/);
  binding.updateMarketPrices({read:{source:"d1",freshness:"fresh"}});
  assert.equal(currentOption.textContent,"Aktualna oferta");
  assert.equal(doc.querySelector('[data-v4-price-kind] option[value="buy-now"]').textContent,"Kup teraz");
  assert.equal(binding.priceInput.value,"12000");
  assert.equal(updates.at(-1).priceStatus,"current");
});
