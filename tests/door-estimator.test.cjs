const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const estimator = require("../public/rexbid-door-estimator.js");
const cases = require("./fixtures/door-estimator-cases.json");

test("independent scenario fixtures produce their recorded rounded LOW/EXPECTED/HIGH", () => {
  for (const fixture of cases.cases) {
    const result = estimator.estimate(fixture.vehicle, { purchasePriceUsd: fixture.purchase_price_usd, fxRate: cases.fx_usd_pln });
    assert.equal(result.ok, true, fixture.id);
    assert.deepEqual(result.total.display, fixture.expected_pln_rounded_100, fixture.id);
    assert.equal(result.route.port, fixture.expected_port, fixture.id);
    assert.ok(result.total.low <= result.total.expected && result.total.expected <= result.total.high, fixture.id);
  }
});

test("component records expose ranges, currency, provenance, checked date and assumptions", () => {
  const result = estimator.estimate(cases.cases[0].vehicle, { purchasePriceUsd: 7500 });
  for (const item of result.components) {
    assert.ok(item.low <= item.expected && item.expected <= item.high, item.id);
    assert.equal(item.currency, "USD", item.id);
    assert.ok(["high", "medium", "low"].includes(item.confidence), item.id);
    assert.ok(item.checked_at, item.id);
    assert.ok(Array.isArray(item.source), item.id);
    assert.ok(Array.isArray(item.assumptions), item.id);
  }
  assert.ok(result.total.low <= result.total.expected && result.total.expected <= result.total.high);
  assert.equal(result.total.currency, "PLN");
  assert.equal(result.total.confidence, "low", "unknown origin/duty and market fee assumptions cap overall confidence");
  assert.ok(result.total.source.length > 0);
  assert.equal(result.total.fx.rate, cases.fx_usd_pln);
  assert.equal(result.total.fx.checked_at, "2026-09-25");
});

test("Copart TX, NJ and CA choose their researched regional port and IAA is low confidence", () => {
  const tx = estimator.estimate(cases.cases[0].vehicle, { purchasePriceUsd: 7500 });
  const nj = estimator.estimate(cases.cases[1].vehicle, { purchasePriceUsd: 10000 });
  const ca = estimator.estimate(cases.cases[2].vehicle, { purchasePriceUsd: 25000 });
  const iaa = estimator.estimate(cases.cases[3].vehicle, { purchasePriceUsd: 5000 });
  assert.equal(tx.route.port, "Houston");
  assert.equal(nj.route.port, "Newark / Irvington");
  assert.equal(ca.route.port, "Los Angeles");
  assert.equal(iaa.confidence, "low");
  assert.match(iaa.components.find(row => row.id === "auction_fee").assumptions.join(" "), /nie jest oficjalną tabelą IAA/i);
});

test("non-runner and oversize status widen ranges without inventing a fixed surcharge", () => {
  const operable = estimator.estimate({ platform: "copart", auction: { state_code: "TX", location: "Dallas, TX", is_operable: true }, vehicle_type: "sedan", fuel_type: "Gasoline", engine_cc: 2500 }, { purchasePriceUsd: 10000 });
  const fixture = cases.cases.find(row => row.id === "copart_tx_nonrunner_suv_over_2l");
  const nonrunner = estimator.estimate(fixture.vehicle, { purchasePriceUsd: fixture.purchase_price_usd });
  const normalTransport = operable.components.find(row => row.id === "us_inland");
  const uncertainTransport = nonrunner.components.find(row => row.id === "us_inland");
  assert.ok(uncertainTransport.high > normalTransport.high);
  assert.ok(uncertainTransport.assumptions.some(text => /Możliwa dodatkowa opłata/.test(text)));
  assert.ok(nonrunner.components.find(row => row.id === "ocean_logistics").high > operable.components.find(row => row.id === "ocean_logistics").high);
  assert.ok(!uncertainTransport.assumptions.some(text => /dopłata wynosi \$?\d/i.test(text)));
});

test("missing facility/ZIP uses wider regional route and lower confidence", () => {
  const result = estimator.estimate({ platform: "copart", vehicle_type: "sedan", fuel_type: "Gasoline", engine_cc: 1800 }, { purchasePriceUsd: 5000 });
  assert.equal(result.route.regional_fallback, true);
  assert.equal(result.route.port, "Port eksportowy — do ustalenia");
  assert.equal(result.confidence, "low");
  assert.ok(result.components.find(row => row.id === "us_inland").assumptions.some(text => /Brak dopasowania facility\/ZIP/.test(text)));
});

test("explicit facility-to-port distance selects a distance band", () => {
  const result = estimator.estimate({ platform: "copart", auction: { state_code: "NJ", location: "Newark, NJ", distance_to_port_miles: 300, is_operable: true }, vehicle_type: "sedan", fuel_type: "Gasoline", engine_cc: 1800 }, { purchasePriceUsd: 5000 });
  assert.deepEqual(result.components.find(row => row.id === "us_inland").low, 285);
  assert.ok(result.components.find(row => row.id === "us_inland").assumptions.some(text => /jawnej odległości/.test(text)));
});

test("known <=2.0L and >2.0L combustion engines use different excise scenarios; unknown legal class remains wide", () => {
  const small = estimator.estimate(cases.cases[0].vehicle, { purchasePriceUsd: 7500 });
  const large = estimator.estimate(cases.cases[2].vehicle, { purchasePriceUsd: 25000 });
  const unknown = estimator.estimate({ platform: "iaai", auction: { state_code: "WA" }, vehicle_type: "sedan", fuel_type: "Hybrid" }, { purchasePriceUsd: 10000 });
  assert.ok(small.scenarios.expected.exciseRate === undefined, "scenario does not claim a legal rate field");
  assert.ok(small.detail_components.find(row => row.id === "excise_detail").expected < large.detail_components.find(row => row.id === "excise_detail").expected);
  const unknownExcise = unknown.detail_components.find(row => row.id === "excise_detail");
  assert.ok(unknownExcise.low < unknownExcise.expected && unknownExcise.expected < unknownExcise.high);
  assert.ok(unknownExcise.assumptions.some(text => /Klasyfikacja prawna nieustalona/.test(text)));
});

test("unknown customs origin is explicitly a scenario, not a confirmed zero or ten percent", () => {
  const result = estimator.estimate(cases.cases[1].vehicle, { purchasePriceUsd: 10000 });
  const duty = result.detail_components.find(row => row.id === "customs_duty_detail");
  assert.equal(duty.low, 0);
  assert.ok(duty.expected > 0 && duty.high > 0);
  assert.equal(duty.confidence, "low");
  assert.ok(duty.assumptions.some(text => /pochodzenia/i.test(text)));
});

test("higher planned purchase price does not lower total EXPECTED with the same vehicle facts", () => {
  for (const fixture of cases.cases.filter(row => ["copart_tx_operable_under_2l", "iaai_wa_unknown_origin_fee_profile"].includes(row.id))) {
    const prices = [1000, 5000, 10000, 25000, 50000];
    const values = prices.map(price => estimator.estimate(fixture.vehicle, { purchasePriceUsd: price }).total.expected);
    for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1], `${fixture.id}: ${prices[i]} should not reduce total`);
  }
});

test("missing/invalid price and unknown auction platform never become a zero-cost estimate", () => {
  assert.equal(estimator.estimate({ platform: "copart" }, {}).ok, false);
  const unknown = estimator.estimate({ platform: "other" }, { purchasePriceUsd: 5000 });
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /nie wyliczam opłat aukcyjnych jako \$0/i);
});

test("door estimate prefills the planned price input and renders safely with vehicle metadata", () => {
  class Node {
    constructor(value = "") { this.value = value; this.textContent = ""; this.children = []; this.className = ""; this.listeners = {}; }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
  }
  const nodes = {
    "[data-est-purchase]": new Node(), "[data-est-purchase-note]": new Node(), "[data-est-total]": new Node(),
    "[data-est-expected]": new Node(), "[data-est-confidence]": new Node(), "[data-est-rows]": new Node(), "[data-est-details]": new Node()
  };
  const root = { querySelector(selector) { return nodes[selector] || null; } };
  const original = global.document;
  global.document = { createElement: () => new Node() };
  try {
    const result = estimator.bind({ root, vehicle: cases.cases[0].vehicle, prefill: { purchasePrice: 7500, purchaseKind: "active-suggestion" } });
    assert.equal(nodes["[data-est-purchase]"].value, "7500");
    assert.match(nodes["[data-est-purchase-note]"].textContent, /Sugestia z aukcji, nie przyszła cena zakupu/);
    assert.equal(result.total.display[1], 63600);
    assert.match(nodes["[data-est-total]"].textContent, /PLN/);
    assert.equal(nodes["[data-est-rows]"].children.length, 5);
    assert.ok(nodes["[data-est-details]"].children.length > 5);
  } finally { global.document = original; }
});

test("legacy market estimator remains isolated from the partner V2 UI and strict calculator", () => {
  const car = fs.readFileSync(path.join(__dirname, "../public/car.html"), "utf8");
  assert.ok(car.includes('<script src="/rexbid-transport-rates.js"></script>'));
  assert.ok(car.includes('<script src="/rexbid-transport-engine.js"></script>'));
  assert.ok(car.includes('id="partnerTransportCalculator"'));
  assert.ok(car.includes('data-transport-purchase'));
  assert.ok(!car.includes('<script src="/rexbid-door-estimator.js"></script>'));
  assert.ok(!car.includes('id="estimatedDoorCalculator"'));
  assert.ok(car.includes('id="importCalculator"'), "strict/confirmed calculator remains available");
});
