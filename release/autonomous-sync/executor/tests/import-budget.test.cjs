const test = require("node:test");
const assert = require("node:assert/strict");
const budget = require("../public/rexbid-import-budget.js");

const complete = {
  purchasePriceUsd:10000, auctionFeeUsd:1140, transportUsd:1030, transportComplete:true,
  usdPln:3.9, customsDutyPln:0, importVatPln:10000, excisePln:0,
  portCustomsPln:2200, servicePln:2500, deliveryPln:2400
};

test("entered budget combines USD purchase, auction and transport once with entered PLN costs", () => {
  const result = budget.calculateBudget(complete);
  assert.equal(result.usdSubtotal, 12170);
  assert.equal(result.convertedUsdPln, 47463);
  assert.equal(result.additionalPln, 17100);
  assert.equal(result.knownTotalPln, 64563);
  assert.equal(result.complete, true);
  assert.deepEqual(result.missing, []);
});

test("empty prices and charges remain unknown even when a useful partial sum exists", () => {
  const result = budget.calculateBudget({transportUsd:1030, transportComplete:true, usdPln:3.9});
  assert.equal(result.knownTotalPln, 4017);
  assert.equal(result.complete, false);
  assert.equal(result.auctionFeeUsd, null);
  assert.equal(result.values.importVatPln, null);
  assert.ok(result.missing.includes("cena pojazdu"));
  assert.ok(result.missing.includes("opłaty aukcyjne"));
  assert.ok(result.missing.includes("vat importowy"));
});

test("a partial transport amount cannot complete a budget when an EV or hybrid charge is unknown", () => {
  const result = budget.calculateBudget({...complete, transportUsd:880, transportComplete:false});
  assert.equal(result.usdSubtotal, 12020);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, ["potwierdzony pełny transport USA i morski"]);
});

test("explicit zero is counted while absent amounts and zero exchange rates are not assumed", () => {
  const allZero = Object.fromEntries(Object.keys(complete).map(key => [key, 0]));
  const result = budget.calculateBudget({...allZero, transportComplete:true, usdPln:3.9});
  assert.equal(result.complete, true);
  assert.equal(result.knownTotalPln, 0);
  const withoutRate = budget.calculateBudget({...complete, usdPln:0});
  assert.equal(withoutRate.complete, false);
  assert.equal(withoutRate.convertedUsdPln, null);
  assert.equal(withoutRate.knownTotalPln, 17100, "unconverted USD is not added to a PLN total");
  assert.ok(withoutRate.missing.includes("kurs USD/PLN"));
});

test("invalid and negative amounts are excluded; Polish decimal notation remains usable", () => {
  for (const invalid of [null, undefined, "", " ", "-2", -2, "Infinity", Infinity, NaN, true, "1,000.50", "USD 25"])
    assert.equal(budget.amount(invalid), null, String(invalid));
  assert.equal(budget.amount("1 250,50"), 1250.5);
  assert.equal(budget.amount("1\u00a0250,50"), 1250.5);
  const result = budget.calculateBudget({...complete, deliveryPln:"-200"});
  assert.equal(result.complete, false);
  assert.equal(result.values.deliveryPln, null);
  assert.ok(result.missing.includes("dostawa w polsce"));
});

test("rounding keeps entered cents and currency conversion stable", () => {
  const result = budget.calculateBudget({...complete, purchasePriceUsd:10000.01,
    auctionFeeUsd:1140.02, transportUsd:1030.03, usdPln:3.9123, deliveryPln:2400.04});
  assert.equal(result.usdSubtotal, 12170.06);
  assert.equal(result.convertedUsdPln, 47612.93);
  assert.equal(result.knownTotalPln, 64712.97);
});

test("shareable breakdown retains LOT, VIN, price source and partial status without claiming a firm quote", () => {
  const context = {priceKind:"buy-now", calculation:{rate_version:"test-v4"},
    variant:{land_usd:205, sea_usd:675, ev_packing:{amount_usd:150}}};
  const result = budget.calculateBudget({purchasePriceUsd:10000, transportUsd:1030, transportComplete:true});
  const output = budget.formatBreakdown({vehicle:{year:2024, make:"Tesla", model:"Model 3", lot:"62674546", platform:"copart", vin:"5YJ3E1EA3RF866005"}, context, budget:result});
  assert.match(output, /2024 Tesla Model 3/);
  assert.match(output, /LOT: 62674546 · COPART/);
  assert.match(output, /VIN: 5YJ3E1EA3RF866005/);
  assert.match(output, /Cena pojazdu \(Kup teraz\)/);
  assert.match(output, /Budżet częściowy/);
  assert.match(output, /Nie stanowi oferty REXBID/);
  assert.match(output, /Wersja stawek transportu: test-v4/);
});

function calculatorMount() {
  class Node {
    constructor(value = "") { this.value = value; this.textContent = ""; this.innerHTML = ""; this.options = []; this.handlers = {}; this.attributes = {}; this.focusCount = 0; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    append() {}
    focus() { this.focusCount++; }
    querySelector(selector) { return this.options.find(option => selector === "option[value=custom]" && option.value === "custom") || null; }
    insertBefore(option) { this.options.push(option); }
  }
  const nodes = new Map();
  const worksheetNodes = new Map();
  const worksheetFields = ["usdPln", ...budget.fields.map(field => field.key)].map(key => {
    const node = new Node(); node.setAttribute("data-budget-field", key); return node;
  });
  const worksheet = new Node();
  worksheet.querySelectorAll = () => worksheetFields;
  worksheet.querySelector = selector => {
    if (!worksheetNodes.has(selector)) worksheetNodes.set(selector, new Node());
    return worksheetNodes.get(selector);
  };
  nodes.set("[data-v4-budget-slot]", worksheet);
  const emitted = [];
  const mount = {innerHTML:"", querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector);
  }, dispatchEvent(event) { emitted.push(event); }};
  const priceKind = mount.querySelector("[data-v4-price-kind]");
  priceKind.value = "current";
  priceKind.options = ["current", "custom", "buy-now"].map(value => new Node(value));
  mount.querySelector("[data-v4-scenario]").value = "standard";
  mount.querySelector("[data-v4-class]").value = "sedan";
  mount.querySelector("[data-v4-powertrain]").value = "BEV";
  return {mount, nodes, worksheetFields, worksheetNodes, emitted};
}

test("missing current bid opens editable own price without moving focus or describing transport as a purchase total", () => {
  const calculator = require("../public/rexbid-calculator-v4.js");
  const dom = calculatorMount();
  const binding = calculator.bindCalculator({root:dom.mount,
    vehicle:{lot:"62674546", platform:"copart", auction:{facility_name:"HOUSTON 77073"}, body_style:"Sedan", fuel_type:"Electric"}});
  assert.equal(binding.priceKind.value, "custom");
  assert.equal(binding.priceInput.readOnly, false);
  assert.equal(binding.priceInput.focusCount, 0);
  assert.equal(dom.nodes.get("[data-v4-total-label]").textContent, "Znany transport · USD");
  assert.match(dom.nodes.get("[data-v4-price-note]").textContent, /Brak aktualnej oferty/);
  assert.equal(binding.getBudget().complete, false);
  assert.match(binding.exportBreakdown(), /Budżet częściowy/);
});

test("worksheet reflects price changes, preserves entered charges and exports the chosen price source", () => {
  const calculator = require("../public/rexbid-calculator-v4.js");
  const dom = calculatorMount();
  const binding = calculator.bindCalculator({root:dom.mount,
    vehicle:{lot:"62674546", platform:"copart", auction:{facility_name:"HOUSTON 77073"}, pricing:{current_bid_usd:10000, buy_now_usd:12000}, body_style:"Sedan", fuel_type:"Electric"}});
  binding.auctionFeeInput.value = "1140";
  binding.auctionFeeInput.handlers.input();
  for (const field of dom.worksheetFields) {
    field.value = String(complete[field.getAttribute("data-budget-field")]);
    field.handlers.input();
  }
  assert.equal(binding.getBudget().complete, true);
  assert.equal(binding.getBudget().knownTotalPln, 64563);
  binding.setPriceKind("buy-now");
  assert.match(dom.nodes.get("[data-v4-price-note]").textContent, /Cena „Kup teraz”/);
  assert.equal(binding.getBudget().knownTotalPln, 72363);
  assert.equal(binding.getBudget().values.servicePln, 2500);
  assert.match(binding.exportBreakdown(), /Cena pojazdu \(Kup teraz\)/);
  if (typeof CustomEvent === "function") {
    assert.equal(dom.emitted.at(-1).type, "rexbid:budget-update");
    assert.equal(dom.emitted.at(-1).detail.budget.knownTotalPln, 72363);
    assert.equal(dom.emitted.at(-1).detail.priceKind, "buy-now");
  }
});

function bindMarket(dom, metadata = {}) {
  return require("../public/rexbid-calculator-v4.js").bindCalculator({root:dom.mount,
    vehicle:{lot:"62674546", platform:"copart", auction:{facility_name:"HOUSTON 77073"},
      pricing:{current_bid_usd:10000, buy_now_usd:12000}, body_style:"Sedan", fuel_type:"Electric", ...metadata}});
}

test("stale and unknown D1 bid remain usable as stored prices without being called current", () => {
  for (const freshness of ["stale", "unknown", undefined]) {
    const dom = calculatorMount();
    const binding = bindMarket(dom, {read:{source:"d1", freshness, last_synced_at:"2026-10-05T21:30:00Z"}});
    assert.equal(binding.priceKind.value, "current", "existing price-kind identifier is preserved");
    assert.equal(binding.priceInput.value, 10000, "stored amount is not cleared or zeroed");
    assert.equal(binding.current().knownSubtotalUsd, 11030);
    assert.equal(binding.current().priceStatus, "snapshot");
    assert.equal(binding.priceKind.options.find(option => option.value === "current").textContent, "Ostatnia zapisana oferta");
    assert.match(dom.nodes.get("[data-v4-price-note]").textContent, /Ostatnia zapisana oferta/);
    assert.doesNotMatch(dom.nodes.get("[data-v4-price-note]").textContent, /Aktualna oferta/);
    assert.match(binding.exportBreakdown(), /Cena pojazdu \(ostatnia zapisana oferta\)/);
    assert.match(binding.exportBreakdown(), /Dane ceny zapisane: 2026-10-05T21:30:00\.000Z/);
    assert.doesNotMatch(binding.exportBreakdown(), /aktualna oferta aukcyjna/);
  }
});

test("any read-only preview labels bid and Buy Now as stored data even when its snapshot is fresh", () => {
  const dom = calculatorMount();
  const binding = bindMarket(dom, {read:{source:"d1",freshness:"fresh"},
    preview:{read_only:true,freshness:"fresh",last_seen_at:"2026-10-05T21:30:00.1Z"}});
  assert.equal(binding.current().priceStatus, "snapshot");
  assert.equal(binding.priceKind.options.find(option => option.value === "buy-now").textContent, "Kup teraz · zapis danych");
  binding.setPriceKind("buy-now");
  assert.equal(binding.priceInput.value, 12000);
  assert.match(binding.exportBreakdown(), /Cena pojazdu \(Kup teraz · zapis danych\)/);
  assert.match(dom.nodes.get("[data-v4-price-note]").textContent, /Dostępność wymaga potwierdzenia/);
  binding.setPriceKind("custom");
  binding.priceInput.value = "15000"; binding.priceInput.handlers.input();
  assert.match(binding.exportBreakdown(), /Cena pojazdu \(własna planowana cena\)/);
  assert.doesNotMatch(binding.exportBreakdown(), /Dane ceny zapisane:|Cena pochodzi z zapisu danych/);
});

test("metadata-only market refresh updates labels and exports without changing amounts or entered price", () => {
  const dom = calculatorMount();
  const binding = bindMarket(dom, {read:{source:"d1",freshness:"fresh"}});
  assert.equal(binding.current().priceStatus, "current");
  const subtotal = binding.current().knownSubtotalUsd;
  binding.updateMarketPrices({read:{source:"d1",freshness:"stale",last_seen_at:"2026-10-05T21:30:00Z"}});
  assert.equal(binding.priceInput.value, 10000);
  assert.equal(binding.current().knownSubtotalUsd, subtotal);
  assert.equal(binding.current().priceStatus, "snapshot");
  assert.match(binding.exportBreakdown(), /ostatnia zapisana oferta/);
  binding.setPriceKind("custom");
  binding.priceInput.value = "15000"; binding.priceInput.handlers.input();
  binding.updateMarketPrices({read:{source:"d1",freshness:"unknown"}});
  assert.equal(binding.priceInput.value, "15000");
  assert.match(binding.exportBreakdown(), /własna planowana cena/);
  binding.setPriceKind("current");
  binding.updateMarketPrices({read:{source:"d1",freshness:"fresh"},preview:null});
  assert.equal(binding.current().priceStatus, "current");
  assert.equal(binding.priceKind.options.find(option => option.value === "current").textContent, "Aktualna oferta");
  assert.equal(binding.priceInput.value, 10000);
  assert.equal(binding.current().knownSubtotalUsd, subtotal);
  assert.match(binding.exportBreakdown(), /aktualna oferta aukcyjna/);
  assert.doesNotMatch(binding.exportBreakdown(), /ostatnia zapisana oferta/);
  if (typeof CustomEvent === "function") {
    assert.equal(dom.emitted.at(-1).detail.priceStatus, "current");
    assert.equal(dom.emitted.at(-1).detail.priceObservedAt, "");
  }
});

test("legacy and fresh data retain current bid behavior while invalid observation dates are rejected", () => {
  for (const metadata of [{}, {read:{source:"d1",freshness:"fresh"}}, {read:{source:"provider",freshness:"unknown"}}]) {
    const binding = bindMarket(calculatorMount(), metadata);
    assert.equal(binding.current().priceStatus, "current");
    assert.equal(binding.priceKind.options.find(option => option.value === "current").textContent, "Aktualna oferta");
    assert.equal(binding.current().knownSubtotalUsd, 11030);
  }
  const binding = bindMarket(calculatorMount(), {read:{source:"d1",freshness:"stale",last_synced_at:"2026-02-30T21:30:00Z",last_seen_at:"<script>"}});
  assert.equal(binding.current().priceObservedAt, "");
  assert.doesNotMatch(binding.exportBreakdown(), /Dane ceny zapisane:|<script>|2026-02-30/);
});

test("standalone budget text falls back to vehicle freshness but explicit refreshed context takes precedence", () => {
  const entered = budget.calculateBudget(complete);
  const vehicle = {read:{source:"d1",freshness:"stale"}};
  const stored = budget.formatBreakdown({vehicle,context:{priceKind:"current"},budget:entered});
  assert.match(stored, /ostatnia zapisana oferta/);
  const refreshed = budget.formatBreakdown({vehicle,context:{priceKind:"current",priceStatus:"current"},budget:entered});
  assert.match(refreshed, /aktualna oferta aukcyjna/);
  assert.doesNotMatch(refreshed, /ostatnia zapisana oferta/);
});
