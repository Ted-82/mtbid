const test = require("node:test");
const assert = require("node:assert/strict");
const calc = require("../public/rexbid-calculator.js");

const cleanGolden = [
  { bid: 1000, expected: 473 },
  { bid: 5000, expected: 928 },
  { bid: 10000, expected: 1058 },
  { bid: 25000, expected: 2020.5 },
  { bid: 50000, expected: 3833 }
];
const noncleanGolden = [
  { bid: 1000, expected: 560 },
  { bid: 5000, expected: 995 },
  { bid: 10000, expected: 1250 },
  { bid: 25000, expected: 2125 },
  { bid: 50000, expected: 4000 }
];

test("Copart clean secured Pre-Bid matches independent published golden values", () => {
  for (const row of cleanGolden) assert.equal(calc.copartFees(row.bid, "clean_secured_prebid").amount, row.expected);
});
test("Copart non-clean secured Pre-Bid matches independent published golden values", () => {
  for (const row of noncleanGolden) assert.equal(calc.copartFees(row.bid, "nonclean_secured_prebid").amount, row.expected);
});

test("Copart published Standard Pricing bands have exact boundaries and reject adjacent unconfigured bids", () => {
  const clean = [
    [999.99, null], [1000, 473], [1199.99, 473], [1200, null],
    [4999.99, null], [5000, 928], [5499.99, 928], [5500, null],
    [9999.99, null], [10000, 1058], [14999.99, 1058], [15000, 1295.5], [15001, 1295.57]
  ];
  const nonclean = [
    [999.99, null], [1000, 560], [1199.99, 560], [1200, null],
    [4999.99, null], [5000, 995], [5499.99, 995], [5500, null],
    [9999.99, null], [10000, 1250], [14999.99, 1250], [15000, 1375], [15001, 1375.08]
  ];
  for (const [bid, expected] of clean) assert.equal(calc.copartFees(bid, "clean_secured_prebid").amount, expected, `clean $${bid}`);
  for (const [bid, expected] of nonclean) assert.equal(calc.copartFees(bid, "nonclean_secured_prebid").amount, expected, `non-clean $${bid}`);
});

test("Copart published values remain configurable until their A-D account schedule is matched", () => {
  assert.equal(calc.rates.copart.clean_secured_prebid.membership_schedule, null);
  assert.equal(calc.rates.copart.clean_secured_prebid.vehicle_class, "standard_vehicle");
  assert.equal(calc.rates.copart.clean_secured_prebid.rate_status, "confirmed");
  assert.match(calc.rates.copart.clean_secured_prebid.profile_requirements, /Nie potwierdzono ich mapowania/);
  const chosen = calc.calculate({ platform: "copart", purchasePriceUsd: 5000, copartProfile: "clean_secured_prebid" });
  assert.equal(chosen.lines.find(line => line.id === "buyerFee").status, "configurable");
  assert.equal(chosen.lines.find(line => line.id === "buyerFee").source_url, calc.rates.copart.clean_secured_prebid.source_url);
  assert.equal(calc.rates.copart.clean_secured_prebid.rate_status, "confirmed");
  const unknown = calc.calculate({ platform: "copart", purchasePriceUsd: 5000 });
  assert.equal(unknown.lines.find(line => line.id === "auctionFees").amount, null);
  assert.equal(unknown.complete, false);
});
test("Unsupported Copart ranges and profiles remain unknown instead of interpolated", () => {
  assert.equal(calc.copartFees(2500, "clean_secured_prebid").amount, null);
  assert.equal(calc.copartFees(5000, "unsecured_live").amount, null);
});
test("IAA fee schedule is unknown until a confirmed schedule exists", () => {
  const result = calc.calculate({ platform: "iaai", purchasePriceUsd: 5000 });
  const fee = result.lines.find(line => line.id === "auctionFees");
  assert.equal(fee.amount, null);
  assert.match(fee.note, /aktualnego cennika IAA/i);
  assert.equal(result.label, "Kalkulacja niepełna");
});
test("blank inland, ocean freight and other costs are missing, never zero", () => {
  const result = calc.calculate({ platform: "copart", purchasePriceUsd: 5000, copartProfile: "clean_secured_prebid" });
  for (const id of ["usInland", "oceanFreight", "destinationCosts", "insurance", "customsDuty", "excise", "importVat"]) {
    const line = result.lines.find(item => item.id === id);
    assert.equal(line.amount, null, id);
    assert.equal(line.status, "unknown", id);
  }
  assert.equal(result.total, null);
  assert.ok(result.blockers.some(item => /Fracht morski/.test(item)));
});
test("explicit zero is distinct from missing input", () => {
  const result = calc.calculate({ platform: "iaai", purchasePriceUsd: 1000, auctionFeeOverrideUsd: 0, usInlandUsd: 0 });
  assert.equal(result.lines.find(line => line.id === "auctionFeeOverride").amount, 0);
  assert.equal(result.lines.find(line => line.id === "usInland").amount, 0);
  assert.equal(result.lines.find(line => line.id === "oceanFreight").amount, null);
});
test("customs duty requires both a base and a TARIC rate and carries provenance", () => {
  assert.equal(calc.calculateDuty({ customsValuePln: 10000 }).amount, null);
  const result = calc.calculateDuty({
    customsValuePln: 10000, ratePercent: 10,
    evidence: { status: "confirmed", source_url: "https://example.test/taric", checked_at: "2026-09-26", effective_from: "2026-09-01" }
  });
  assert.equal(result.amount, 1000);
  assert.equal(result.status, "confirmed");
  assert.equal(result.effective_from, "2026-09-01");
});
test("excise tiers match independent PLN basis examples", () => {
  assert.equal(calc.calculateExcise({ basePln: 10000, vehicleClass: "other_passenger", engineCc: 1500, baseEvidence: { status: "confirmed" } }).amount, 310);
  assert.equal(calc.calculateExcise({ basePln: 10000, vehicleClass: "other_passenger", engineCc: 2500, baseEvidence: { status: "confirmed" } }).amount, 1860);
  assert.equal(calc.calculateExcise({ basePln: 10000, vehicleClass: "hybrid_plugin", engineCc: 2500, baseEvidence: { status: "confirmed" } }).amount, 930);
});
test("unknown drivetrain and missing engine capacity never guess an excise rate", () => {
  assert.equal(calc.calculateExcise({ basePln: 10000, vehicleClass: "unknown", engineCc: 1800 }).amount, null);
  assert.equal(calc.calculateExcise({ basePln: 10000, vehicleClass: "other_passenger" }).amount, null);
  assert.equal(calc.calculateExcise({ basePln: 10000, vehicleClass: "hev_non_plugin", engineCc: 1800 }).amount, null);
});
test("hybrid exemption is not inferred from fuel label or vehicle class alone", () => {
  const unknown = calc.calculateExcise({ basePln: 10000, vehicleClass: "hev_non_plugin", engineCc: 1800 });
  assert.equal(unknown.amount, null);
  const exempt = calc.calculateExcise({ basePln: 10000, vehicleClass: "hev_non_plugin", engineCc: 1800, exemptionStatus: "eligible" });
  assert.equal(exempt.amount, 0);
  assert.equal(exempt.status, "configurable");
});
test("VAT uses confirmed 23 percent only when a basis is explicitly supplied", () => {
  assert.equal(calc.calculateVat({}).amount, null);
  const result = calc.calculateVat({ basePln: 12810, baseEvidence: { status: "confirmed" } });
  assert.equal(result.amount, 2946.3);
  assert.equal(result.status, "confirmed");
});
test("all rate profiles expose source, checked/effective dates and confidence status", () => {
  for (const profile of Object.values(calc.rates.copart)) {
    assert.ok(profile.source_url);
    assert.ok(profile.checked_at);
    assert.equal(Object.hasOwn(profile, "effective_from"), true);
    assert.ok(["confirmed", "configurable", "estimated", "unknown"].includes(profile.status));
  }
  assert.match(calc.rates.version, /2026-09-26/);
});
test("indicative, customs and excise FX providers are separate and unconfigured", async () => {
  const [ui, customs, excise] = await Promise.all([
    calc.fxProvider.getIndicativeRate(), calc.fxProvider.getCustomsRate(), calc.fxProvider.getExciseRate()
  ]);
  assert.equal(ui.status, "unknown");
  assert.equal(customs.provider, "MF customs FX table");
  assert.equal(excise.provider, "NBP current average rate per excise act");
  assert.equal(ui.rate, null);
  assert.equal(customs.rate, null);
});
test("mixed currency total stays unavailable without complete confirmed inputs and settlement FX", () => {
  const result = calc.calculate({ platform: "copart", purchasePriceUsd: 5000, copartProfile: "clean_secured_prebid" });
  assert.equal(result.complete, false);
  assert.equal(result.total, null);
  assert.equal(result.status, "unknown");
  assert.ok(result.blockers.some(item => item.startsWith("brak kursu orientacyjnego UI ze źródłem i datą")));
});

test("complete user-supplied inputs produce only an explicitly estimated UI-currency total", () => {
  const result = calc.calculate({
    platform: "copart", purchasePriceUsd: 1000, copartProfile: "clean_secured_prebid",
    usInlandUsd: 0, oceanFreightUsd: 0, destinationCostsUsd: 0, insuranceUsd: 0, otherCostsUsd: 0,
    duty: { customsValuePln: 10000, ratePercent: 10 },
    excise: { basePln: 10000, vehicleClass: "other_passenger", engineCc: 1500 },
    vat: { basePln: 12810 },
    uiFx: { rate: 4, source_url: "https://example.test/rate", checked_at: "2026-09-26", status: "estimated" }
  });
  assert.equal(result.complete, true);
  assert.equal(result.status, "estimated");
  assert.equal(result.total.status, "estimated");
  assert.equal(result.total.amount, 10148.3);
  assert.equal(result.label, "Szacunek orientacyjny — pola uzupełnione, część wymaga potwierdzenia");
});
test("car page loads calculator engine/config and no longer has inline guessed tax/total math", () => {
  const fs = require("node:fs");
  const car = fs.readFileSync(require("node:path").join(__dirname, "../public/car.html"), "utf8");
  assert.ok(car.includes('<script src="/rexbid-calculator-rates.js"></script>'));
  assert.ok(car.includes('<script src="/rexbid-calculator.js"></script>'));
  assert.ok(car.includes('id="calcUiFxRate"'));
  assert.ok(car.includes('id="calcCopartProfile"'));
  assert.ok(car.includes("Wybierz wariant tylko po potwierdzeniu profilu"));
  assert.ok(car.includes("Nie potwierdzono, czy odpowiada ona Schedule A/B/C/D"));
  assert.ok(car.includes("standardowego typu pojazdu"));
  assert.ok(!car.includes('id="calcRate"'));
  assert.ok(!car.includes("const customsBaseUsd"));
  assert.ok(!car.includes("function guessExciseRate"));
});



test("invalid or negative numeric inputs remain unknown and are never coerced to zero", () => {
  const result = calc.calculate({ platform: "copart", purchasePriceUsd: "not-a-number", copartProfile: "clean_secured_prebid" });
  const price = result.lines.find(line => line.id === "vehiclePrice");
  assert.equal(price.amount, null);
  assert.equal(price.status, "unknown");
  assert.equal(calc.calculateExcise({ basePln: 10000, vehicleClass: "other_passenger", engineCc: 0 }).amount, null);
  assert.equal(calc.calculateDuty({ customsValuePln: -1, ratePercent: 0 }).amount, null);
});

test("EV/hydrogen exemptions and small PHEV exceptions require explicit legal confirmation", () => {
  const evMissing = calc.calculateExcise({ basePln: 10000, vehicleClass: "electric" });
  const hydrogenMissing = calc.calculateExcise({ basePln: 10000, vehicleClass: "hydrogen" });
  const phevSmall = calc.calculateExcise({ basePln: 10000, vehicleClass: "hybrid_plugin", engineCc: 1800 });
  assert.equal(evMissing.amount, null);
  assert.equal(hydrogenMissing.amount, null);
  assert.equal(phevSmall.amount, null);
  const evExemption = calc.calculateExcise({ basePln: 10000, vehicleClass: "electric", exemptionStatus: "eligible" });
  assert.equal(evExemption.amount, 0);
  assert.equal(evExemption.status, "configurable");
});
test("all entered cost amounts still cannot be totalled without a sourced, dated UI FX rate", () => {
  const result = calc.calculate({
    platform: "copart", purchasePriceUsd: 1000, copartProfile: "clean_secured_prebid",
    usInlandUsd: 0, oceanFreightUsd: 0, destinationCostsUsd: 0, insuranceUsd: 0, otherCostsUsd: 0,
    duty: { customsValuePln: 10000, ratePercent: 10 }, excise: { basePln: 10000, vehicleClass: "other_passenger", engineCc: 1500 },
    vat: { basePln: 12810 }
  });
  assert.equal(result.complete, false);
  assert.equal(result.total, null);
  assert.ok(result.blockers.some(item => item.startsWith("brak kursu orientacyjnego UI ze źródłem i datą")));
});

test("incomplete scenarios identify missing IAA schedule, freight, FX, tax basis and vehicle classification", () => {
  const iaa = calc.calculate({ platform: "iaai", purchasePriceUsd: 5000 });
  assert.equal(iaa.total, null);
  assert.match(iaa.lines.find(line => line.id === "auctionFees").note, /aktualnego cennika IAA/i);

  const copart = calc.calculate({ platform: "copart", purchasePriceUsd: 5000, copartProfile: "clean_secured_prebid", usInlandUsd: 0 });
  assert.equal(copart.lines.find(line => line.id === "oceanFreight").amount, null);
  assert.match(copart.lines.find(line => line.id === "oceanFreight").note, /Wymaga oferty/);
  assert.equal(copart.lines.find(line => line.id === "customsDuty").amount, null);
  assert.match(calc.calculateDuty({ customsValuePln: 10000 }).reason, /stawka TARIC/);
  assert.match(calc.calculateVat({}).reason, /podstawy import VAT/);
  assert.match(calc.calculateExcise({ basePln: 10000, vehicleClass: "unknown" }).reason, /Nieznana prawna kategoria/);
  assert.match(calc.calculateExcise({ basePln: 10000, vehicleClass: "other_passenger" }).reason, /pojemności silnika/);

  const noFx = calc.calculate({ platform: "copart", purchasePriceUsd: 5000, copartProfile: "clean_secured_prebid", usInlandUsd: 0, oceanFreightUsd: 0, destinationCostsUsd: 0, insuranceUsd: 0, otherCostsUsd: 0, duty: { customsValuePln: 10000, ratePercent: 0 }, excise: { basePln: 10000, vehicleClass: "other_passenger", engineCc: 1500 }, vat: { basePln: 10000 }, uiFx: null });
  assert.equal(noFx.total, null);
  assert.ok(noFx.blockers.some(item => /brak kursu orientacyjnego UI/.test(item)));
});

test("vehicle prefill uses active bid only as an editable suggestion and carries known vehicle facts", () => {
  const result = calc.prefillFromVehicle({
    platform: "copart", location: "Houston, TX", auction: { state: "upcoming", location: "Houston, TX" },
    pricing: { current_bid_usd: 12500, sale_price_usd: 9000, buy_now_usd: 15000 },
    vehicle_description: { FuelTypeDesc: "Gasoline", DriveLineTypeDesc: "AWD", EngineCC: 1998, VehicleClass: "SUV" }
  });
  assert.equal(result.purchasePrice, 12500);
  assert.equal(result.purchaseKind, "active-suggestion");
  assert.equal(result.platform, "copart");
  assert.equal(result.location, "Houston, TX");
  assert.equal(result.fuel, "Gasoline");
  assert.equal(result.drivetrain, "AWD");
  assert.equal(result.engineCc, 1998);
  assert.equal(result.vehicleType, "SUV");
});

test("confirmed finished sale may prefill; historical sale is not used for an active auction", () => {
  const finished = calc.prefillFromVehicle({ auction: { state: "finished" }, pricing: { sale_price_usd: 8400, current_bid_usd: 7900 } });
  assert.equal(finished.purchasePrice, 8400);
  assert.equal(finished.purchaseKind, "confirmed-sale");
  const active = calc.prefillFromVehicle({ auction: { state: "upcoming" }, pricing: { sale_price_usd: 8400, current_bid_usd: null, buy_now_usd: 9100 } });
  assert.equal(active.purchasePrice, 9100);
  assert.equal(active.purchaseKind, "buy-now-suggestion");
  const noPrice = calc.prefillFromVehicle({ auction: { state: "upcoming" }, pricing: { sale_price_usd: 8400 } });
  assert.equal(noPrice.purchasePrice, null);
  assert.equal(noPrice.purchaseKind, "none");
});

test("calculator main view is compact and keeps itemized diagnostics behind progressive disclosure", () => {
  const fs = require("node:fs");
  const car = fs.readFileSync(require("node:path").join(__dirname, "../public/car.html"), "utf8");
  const start = car.indexOf('<section class="panel import-calc" id="importCalculator">');
  const end = car.indexOf("</section>", start);
  const markup = car.slice(start, end);
  assert.ok(markup.indexOf('id="calcPurchasePrice"') < markup.indexOf('<details class="calc-details"'));
  assert.ok(markup.includes('id="calcSummary"'));
  assert.ok(markup.includes('id="calcDetailLines"'));
  assert.ok(markup.includes('id="calcDiagnostics"'));
  assert.ok(!markup.includes('id="calcWarning"'));
  assert.ok(!markup.includes("Dlaczego wynik jest niepełny"));
  assert.ok(markup.includes("Uzupełnij / pokaż szczegóły kalkulacji"));
  assert.match(car, /@media\(max-width:600px\)\{\.calc-primary\{grid-template-columns:1fr/);
});

test("incomplete result has no total, so UI cannot show a complete sum", () => {
  const result = calc.calculate({ platform: "iaai", purchasePriceUsd: 10000 });
  assert.equal(result.complete, false);
  assert.equal(result.total, null);
  assert.equal(result.label, "Kalkulacja niepełna");
});
