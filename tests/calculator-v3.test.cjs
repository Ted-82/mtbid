const test = require("node:test");
const assert = require("node:assert/strict");
const calc = require("../public/rexbid-calculator.js");

function fullInputs(overrides = {}) {
  return {
    platform: "copart", purchasePriceUsd: 1000, copartProfile: "clean_secured_prebid",
    partnerTransport: { land_amount: 0, sea_amount: 0, currency: "USD", source: "partner" },
    destinationCostsUsd: 0, insuranceUsd: 0, otherCostsUsd: 0,
    unloadingContainerUsd: 0, documentationUsd: 0, otherImportUsd: 0, polandDeliveryPln: 0,
    duty: { customsValuePln: 0, ratePercent: 0 },
    excise: { basePln: 0, vehicleClass: "other_passenger", engineCc: 1000 },
    vat: { basePln: 0 },
    uiFx: { rate: 4, source_url: "https://rates.example.test/ui", checked_at: "2026-09-30", status: "estimated" },
    ...overrides
  };
}

test("V3 keeps Copart fee schedules explicit/configurable and IAA unknown without a fabricated price", () => {
  const copartUnknown = calc.calculateV3({ platform: "copart", purchasePriceUsd: 5000 });
  assert.equal(copartUnknown.complete, false);
  assert.equal(copartUnknown.lines.find(x => x.id === "auctionFees").amount, null);
  const copartSelected = calc.copartFees(5000, "clean_secured_prebid");
  assert.equal(copartSelected.status, "configurable");
  assert.ok(copartSelected.lines.every(x => x.status === "configurable"));
  const iaa = calc.calculateV3({ platform: "iaai", purchasePriceUsd: 5000 });
  assert.equal(iaa.lines.find(x => x.id === "auctionFees").amount, null);
  assert.equal(iaa.complete, false);
});

test("V3 missing broker, port, paperwork, Poland delivery and FX remain unknown, never zero", () => {
  const result = calc.calculateV3({ platform: "copart", purchasePriceUsd: 5000, copartProfile: "clean_secured_prebid" });
  for (const id of ["portHandling", "customsBroker", "unloadingContainer", "documentation", "otherImport", "polandDelivery", "customsDuty", "excise", "importVat"]) {
    assert.equal(result.lines.find(x => x.id === id).amount, null, id);
  }
  assert.equal(result.total, null);
  assert.equal(result.complete, false);
  assert.ok(result.missing.some(x => x.id === "polandDelivery"));
});

test("V3 explicit zero is distinct from missing and a fully sourced input set can produce an estimated total", () => {
  const result = calc.calculateV3(fullInputs());
  assert.equal(result.complete, true);
  assert.equal(result.status, "estimated");
  assert.equal(result.total.amount, 1000 * 4 + 473 * 4);
  assert.equal(result.import_subtotal.complete, true);
  assert.equal(result.door_to_door.complete, true);
  const missing = calc.calculateV3(fullInputs({ polandDeliveryPln: null }));
  assert.equal(missing.complete, false);
  assert.equal(missing.total, null);
});

test("V3 presentation FX is required only for the UI total and remains separate from legal tax inputs", () => {
  const result = calc.calculateV3(fullInputs({ uiFx: null }));
  assert.equal(result.total, null);
  assert.equal(result.lines.find(x => x.id === "customsDuty").amount, 0);
  assert.equal(calc.v3Rates.fx.customs_usd_pln.amount, null);
  assert.equal(calc.v3Rates.fx.excise_usd_pln.amount, null);
  assert.notEqual(calc.v3Rates.fx.indicative_usd_pln, calc.v3Rates.fx.customs_usd_pln);
});

test("V3 standard and conservative scenarios use separate partner route selections without exposing route IDs", () => {
  const result = calc.calculateV3(fullInputs({
    partnerTransport: { land_amount: 205, sea_amount: 675, currency: "USD", source: "partner" },
    partnerTransportVariants: {
      expected: { land_amount: 205, sea_amount: 675, combined_transport_amount: 880, selected_route: "route_3" },
      conservative: { land_amount: 205, sea_amount: 850, combined_transport_amount: 1055, selected_route: "route_3" }
    }
  }));
  assert.equal(result.transport_estimate.standard, 880);
  assert.equal(result.transport_estimate.conservative, 1055);
  assert.equal(result.door_to_door.scenarios.standard.total.amount, (1000 + 473 + 205 + 675) * 4);
  assert.equal(result.door_to_door.scenarios.conservative.total.amount, (1000 + 473 + 205 + 850) * 4);
  assert.ok(!JSON.stringify(result).includes("route_3"));
});

test("VAT base and customs/excise bases stay explicit; 23 percent is applied only to entered VAT base", () => {
  const result = calc.calculateV3(fullInputs({
    duty: { customsValuePln: 10000, ratePercent: 10 },
    excise: { basePln: 11000, vehicleClass: "other_passenger", engineCc: 1500 },
    vat: { basePln: 15000 }
  }));
  assert.equal(result.lines.find(x => x.id === "customsDuty").amount, 1000);
  assert.equal(result.lines.find(x => x.id === "excise").amount, 341);
  assert.equal(result.lines.find(x => x.id === "importVat").amount, 3450);
  assert.equal(result.complete, true, "fixture explicitly supplies every other required component");
  assert.equal(result.total.amount, 10683);
});

test("V3 source config is admin-ready and unknown transport/import costs do not inherit legacy market estimates", () => {
  assert.equal(calc.v3Rates.version, "rex-calculator-v3-config-1");
  assert.equal(calc.v3Rates.import_costs.port_handling.amount, null);
  assert.equal(calc.v3Rates.import_costs.broker.amount, null);
  assert.equal(calc.v3Rates.poland_delivery.type, "zone_or_distance");
  assert.equal(calc.calculateV3({ platform: "iaai", purchasePriceUsd: 25000 }).total, null);
});

test("normal card binding keeps the existing strict calculator unless V3 is explicitly enabled", () => {
  const makeNode = (value = "") => ({ value, textContent: "", hidden: false, children: [],
    append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = [...nodes]; },
    addEventListener() {}, closest() { return { hidden: false }; }
  });
  const originalDocument = global.document;
  global.document = { createElement: () => makeNode() };
  const createRoot = () => {
    const nodes = Object.fromEntries(["calcPurchasePrice", "calcCopartProfile", "calcPurchaseHint", "calcVehicleContext", "calcSummary", "calcV3Summary", "calcDetailLines", "calcDiagnostics", "calcMissingLabel", "calcMissingList"].map(id => [id, makeNode()]));
    return { nodes, querySelector(selector) { return nodes[selector.slice(1)] || null; }, addEventListener() {} };
  };
  try {
    const legacyRoot = createRoot();
    const legacy = calc.bindCalculator({ root: legacyRoot, platform: "copart" });
    assert.equal(legacy.model_version, "rex-import-cost-v1");
    const v3Root = createRoot();
    v3Root.nodes.calcPurchasePrice.value = "1150";
    v3Root.nodes.calcCopartProfile.value = "clean_secured_prebid";
    assert.equal(v3Root.querySelector("#calcCopartProfile").value, "clean_secured_prebid");
    const v3 = calc.bindCalculator({ root: v3Root, platform: "copart", enableV3: true, summaryRoot: v3Root.nodes.calcV3Summary });
    assert.equal(v3.model_version, "rex-import-cost-v3");
    assert.ok(v3.lines.some(line => line.id === "buyerFee"), JSON.stringify(v3.lines.map(line => line.id)));
    const visibleRows = v3Root.nodes.calcV3Summary.children.map(row => row.children?.[0]?.textContent).filter(Boolean);
    for (const label of ["Cena pojazdu", "Opłaty aukcyjne", "Transport lądowy USA", "Transport morski", "Cło", "VAT", "Akcyza", "Port / broker / odprawa", "Transport w Polsce", "Szacowany koszt końcowy"]) assert.ok(visibleRows.includes(label), label);
    const auctionRow = v3Root.nodes.calcV3Summary.children.find(row => row.children?.[0]?.textContent === "Opłaty aukcyjne");
    assert.ok(auctionRow.children.some(child => child.textContent === "Publiczna tabela Copart — profil konta Rex.Bid do potwierdzenia"), JSON.stringify(auctionRow.children.map(child => child.textContent)));
    assert.equal(v3Root.nodes.calcSummary.children.length, 0, "V3 summary renders in the visible customer panel, not only inside collapsed strict details");
  } finally { global.document = originalDocument; }
});

test("V3 provenance distinguishes partner, official statutory source and manual input", () => {
  const result = calc.calculateV3(fullInputs({ partnerTransport: { land_amount: 205, sea_amount: 675, currency: "USD", source: "partner", rate_version: "partner-rates-test" } }));
  assert.equal(result.lines.find(x => x.id === "usInland").source_kind, "partner");
  assert.equal(result.lines.find(x => x.id === "usInland").rate_version, "partner-rates-test");
  assert.equal(result.lines.find(x => x.id === "buyerFee").source_kind, "official");
  assert.equal(result.lines.find(x => x.id === "importVat").source_kind, "official");
  assert.equal(result.lines.find(x => x.id === "customsDuty").source_kind, "manual_input");
});
