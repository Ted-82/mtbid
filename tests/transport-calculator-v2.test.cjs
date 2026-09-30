const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const transport = require("../public/rexbid-transport-engine.js");
const rates = require("../public/rexbid-transport-rates.js");
const rateImport = require("../scripts/partner-transport-rates.cjs");

// Synthetic matcher rows exercise lookup semantics only; they are not partner price data.
const matcherRows = [
  { location_name: "Houston South (Copart)", platform: "Copart", city: "Houston", state: "TX", postal_code: "77001", route_1: 111, route_2: 222, route_3: "", route_4: null, route_5: null, route_6: null },
  { location_name: "Chicago North (IAAI)", platform: "IAAI", city: "Chicago", state: "Illinois", postal_code: "60106-1234", route_1: 333, route_2: null, route_3: null, route_4: null, route_5: null, route_6: null },
  { location_name: "Los Angeles (Copart)", platform: "Copart", city: "Los Angeles", state: "California", postal_code: "90001", route_1: null, route_2: null, route_3: null, route_4: null, route_5: null, route_6: null },
  { location_name: "Miami Central (Copart)", platform: "Copart", city: "Miami", state: "Florida", postal_code: "33101", route_1: null, route_2: null, route_3: null, route_4: null, route_5: null, route_6: null },
  { location_name: "New Jersey (Adesa)", platform: "Adesa", city: "Newark", state: "NJ", postal_code: "07114", route_1: null, route_2: null, route_3: null, route_4: null, route_5: null, route_6: null }
];

test("partner rate config is separate, versioned, neutral-route and has no fabricated land rates", () => {
  assert.match(rates.version, /^rex-partner-transport-[a-f0-9]{12}-[a-f0-9]{12}$/);
  assert.deepEqual(rates.routeIds, ["route_1", "route_2", "route_3", "route_4", "route_5", "route_6"]);
  assert.equal(rates.landRates.length, 610);
  assert.equal(rates.currency, "USD");
  assert.equal(rates.landRates[0].location_name_original, "ABBOTSFORD, BC V4X-1G8");
  assert.deepEqual(rates.landRates[0].source_row, { file: "data/partner/land_transport_rates.md", line: 1 });
  assert.equal(rates.landRates[0].route_1, null, "empty source cells remain null");
  assert.equal(rates.landRates[0].route_6, 2575);
  assert.equal(rates.seaMetadata.currency, "USD");
  assert.deepEqual(rates.seaFreight40HC["1"], { route_1:1850, route_2:1850, route_3:2400, route_4:4400, route_5:2400, route_6:4200 });
  assert.deepEqual(rates.seaFreight40HC["2"], { route_1:950, route_2:950, route_3:1250, route_4:2250, route_5:1250, route_6:2100 });
  assert.deepEqual(rates.seaFreight40HC["3"], { route_1:650, route_2:650, route_3:850, route_4:1515, route_5:850, route_6:1485 });
  assert.deepEqual(rates.seaFreight40HC["4"], { route_1:575, route_2:575, route_3:675, route_4:1175, route_5:675, route_6:1050 });
});

test("exact Copart/IAAI branch matching normalizes punctuation, whitespace, case and state aliases", () => {
  const copart = transport.findLandRate({ platform:"COPART USA", location_name:"  houston, south (COPART)  ", city:"Houston", state:"Texas", zip:"77001-4421" }, matcherRows);
  assert.equal(copart.status, "exact");
  assert.equal(copart.match_type, "exact_platform_location");
  assert.deepEqual(copart.routes_available, [{ route_id:"route_1", amount:111 }, { route_id:"route_2", amount:222 }]);
  assert.equal(copart.route_selection_required, false, "scenario policy automatically selects the lowest complete combined route");
  const iaai = transport.findLandRate({ platform:"Insurance Auto Auction", location_name:"Chicago North IAAI", city:"Chicago", state:"IL", postal_code:"60106" }, matcherRows);
  assert.equal(iaai.status, "exact");
  assert.equal(iaai.match_type, "exact_platform_location");
  assert.equal(iaai.record.platform, "iaai");
});

test("location fallback order is platform+ZIP, platform+city/state, ZIP, then city/state", () => {
  const platformZip = transport.findLandRate({ platform:"copart", postal_code:"77001" }, matcherRows);
  assert.equal(platformZip.status, "fallback_zip");
  assert.equal(platformZip.match_type, "platform_postal");
  const platformCity = transport.findLandRate({ platform:"iaai", city:"Chicago", state:"Illinois" }, matcherRows);
  assert.equal(platformCity.status, "fallback_city_state");
  assert.equal(platformCity.match_type, "platform_city_state");
  const zipOnly = transport.findLandRate({ platform:"manheim", zip:"77001" }, matcherRows);
  assert.equal(zipOnly.status, "fallback_zip");
  assert.equal(zipOnly.match_type, "postal");
  assert.equal(zipOnly.confidence, "low");
  const cityState = transport.findLandRate({ platform:"manheim", city:"Chicago", state:"IL" }, matcherRows);
  assert.equal(cityState.status, "fallback_city_state");
  assert.equal(cityState.match_type, "city_state");
});

test("normalization supports state spellings, ZIP formats, city punctuation and the requested sample locations", () => {
  assert.equal(transport.normalizeState("TX"), transport.normalizeState("Texas"));
  assert.equal(transport.normalizePostal("77001-1234"), "77001");
  assert.equal(transport.normalizePostal("07114"), "07114");
  for (const city of ["Houston", "Chicago", "Los Angeles", "Miami", "New Jersey"]) assert.ok(transport.normalizeText(city));
  assert.equal(transport.normalizeText(" Los Angeles, (South)  "), "los angeles south");
});

test("ambiguous or unmatched locations never select a guessed rate; blank route is unavailable, not zero", () => {
  const duplicate = [...matcherRows, { ...matcherRows[0] }];
  const ambiguous = transport.findLandRate({ platform:"copart", location_name:"Houston South Copart", zip:"77001" }, duplicate);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.reason, "ambiguous_match");
  const empty = transport.findLandRate({ platform:"copart", location_name:"Los Angeles Copart" }, matcherRows);
  assert.equal(empty.status, "exact");
  assert.equal(empty.reason, "route_unavailable");
  assert.deepEqual(empty.routes_available, []);
  const missing = transport.findLandRate({ platform:"copart", city:"Unknown", state:"TX", zip:"00000" }, matcherRows);
  assert.equal(missing.status, "unmatched");
  assert.equal(missing.routes_available.length, 0);
});

test("partner sea expected uses 4-car 40HC and conservative uses 3-car rate in source currency", () => {
  const route = transport.seaFreight("route_4");
  assert.equal(route.expected, 1175);
  assert.equal(route.conservative, 1515);
  assert.equal(route.currency, "USD");
  assert.equal(route.status, "configurable");
  assert.equal(transport.seaFreight("route_2").expected, 575);
  assert.equal(transport.seaFreight("route_2").conservative, 650);
  assert.equal(transport.seaFreight("route_9").expected, null);
});

test("full-cost estimate distinguishes partial from complete and never treats missing fees as zero", () => {
  const partial = transport.estimateTotal({ vehicle:{ amount:10000, currency:"USD", status:"confirmed" }, landTransport:{ amount:0, currency:"USD", status:"confirmed" } });
  assert.equal(partial.complete, false);
  assert.equal(partial.total, null);
  assert.ok(partial.missing.includes("auctionFees"));
  assert.equal(partial.lines.find(x => x.id === "landTransport").amount, 0, "explicit zero stays zero");
  const complete = transport.estimateTotal(Object.fromEntries(["vehicle", "auctionFees", "landTransport", "seaFreight", "importCosts", "polandDelivery"].map(id => [id, { amount: 10, currency:"USD", status:"confirmed" }])));
  assert.equal(complete.complete, true);
  assert.equal(complete.total, 60);
  assert.equal(complete.currency, "USD");
  const mismatch = transport.estimateTotal({ ...Object.fromEntries(["vehicle", "auctionFees", "landTransport", "seaFreight", "importCosts", "polandDelivery"].map(id => [id, { amount: 10, currency:"USD", status:"confirmed" }])), seaFreight:{ amount:10, currency:"EUR", status:"confirmed" } });
  assert.equal(mismatch.complete, false);
  assert.ok(mismatch.missing.includes("currency_conversion"));
});

test("vehicle context auto-prefills auction location, platform, listing facts and price context", () => {
  const context = transport.contextFromVehicle({ platform:"Copart", year:2020, make:"Honda", model:"Accord", pricing:{ current_bid_usd:2300, buy_now_usd:5000 }, auction:{ facility_name:"Houston South", city:"Houston", state:"TX", zip:"77001" }, fuel_type:"Gasoline", engine_cc:1998 });
  assert.equal(context.platform, "copart");
  assert.equal(context.location_name, "Houston South");
  assert.equal(context.city, "Houston");
  assert.equal(context.state, "TX");
  assert.equal(context.postal_code, "77001");
  assert.equal(context.purchase_price_suggested, 2300);
  assert.equal(context.year, 2020);
  assert.equal(context.engine_cc, 1998);
});

test("real vehicle location objects are rendered as safe text and structured fields, never [object Object]", () => {
  const context = transport.contextFromVehicle({
    platform:"Copart",
    auction:{ state:"open", location:{ display:"Long Island (NY)", city:"Long Island", state:"NY", zip:"11719" } },
    year:2020, make:"Nissan", model:"Maxima"
  });
  assert.equal(context.location_name,"Long Island (NY)");
  assert.equal(context.city,"Long Island");
  assert.equal(context.state,"NY");
  assert.equal(context.postal_code,"11719");
  assert.doesNotMatch(String(context.location_name), /\[object Object\]/i);
  const match = transport.findLandRate(context);
  assert.notEqual(match.status,"unmatched", "ZIP fallback can match when supplied by the real location object");
});

test("staging vehicle page uses partner V2 UI and production asset guard remains explicit", () => {
  const car = fs.readFileSync(path.join(__dirname, "../public/car.html"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "../worker.js"), "utf8");
  const staging = fs.readFileSync(path.join(__dirname, "../wrangler.staging.jsonc"), "utf8");
  assert.match(car, /id="partnerTransportCalculator"/);
  assert.match(car, /rexbid-transport-rates\.js/);
  assert.match(car, /rexbid-transport-engine\.js/);
  assert.doesNotMatch(car, /rexbid-door-estimator(?:-rates)?\.js/);
  assert.match(worker, /REXBID_TRANSPORT_CALCULATOR_ENABLED !== "enabled"/);
  assert.match(worker, /rexbid-transport-(?:rates|engine)/);
  assert.match(staging, /"REXBID_TRANSPORT_CALCULATOR_ENABLED": "enabled"/);
  assert.match(car, /id="importCalculator"/, "strict calculator stays separate");
});

test("source importer audits full land and sea tables and generated dataset is reproducible", () => {
  const fs = require("node:fs");
  const land = fs.readFileSync(path.join(__dirname, "../data/partner/land_transport_rates.md"), "utf8");
  const sea = fs.readFileSync(path.join(__dirname, "../data/partner/sea_transport_rates.md"), "utf8");
  const data = rateImport.buildDataset(land, sea, { landSource:"data/partner/land_transport_rates.md", seaSource:"data/partner/sea_transport_rates.md" });
  assert.equal(data.landRates.length, 610);
  assert.deepEqual(data.audit.platforms, { copart:252, iaai:202, manheim:90, adesa:66 });
  assert.equal(data.audit.usa, 585);
  assert.equal(data.audit.canada, 25);
  assert.equal(data.audit.missing_zip, 14);
  assert.equal(data.audit.missing_city, 14);
  assert.equal(data.audit.no_route_values, 0);
  assert.equal(data.audit.empty_route_cells, 718);
  assert.equal(data.audit.amount_cells_nonempty, 2942);
  assert.equal(data.audit.amount_cells_with_dollar, 2942);
  assert.deepEqual(data.audit.duplicate_normalized_keys, { platform_location:0, platform_zip:14, platform_city_state:21, zip:61, city_state:84 });
  assert.deepEqual(data.seaMetadata.rows.map(x => x.vehicle_count), [1,2,3,4]);
  assert.equal(data.seaMetadata.rows.reduce((n, x) => n + Object.values(x.routes).filter(Number.isFinite).length, 0), 24);
  assert.equal(rateImport.parseLandTable("loc\tCopart\tcity\tTX\t77001\t$1\t\t\t\t\t$6")[0].route_2, null);
  assert.throws(() => rateImport.parseLandTable("loc\tCopart\tcity\tTX\t77001\t$1"), /oczekiwano 11/);
  assert.equal(rateImport.renderModule(data).includes('"currency": "USD"'), true);
  assert.equal(rateImport.generate({ output:"--check" }).dataset.landRates.length, 610);
});

test("partner route matrix selects the lowest complete land plus sea option per scenario", () => {
  const matrix = transport.selectTransportOptions({ matched:true, match_status:"exact", routes_available:[
    {route_id:"route_1",amount:1000},{route_id:"route_2",amount:1200},{route_id:"route_6",amount:400}
  ]});
  assert.deepEqual([matrix.expected.selected_route,matrix.expected.land_amount,matrix.expected.sea_amount,matrix.expected.combined_transport_amount], ["route_6",400,1050,1450]);
  assert.deepEqual([matrix.conservative.selected_route,matrix.conservative.land_amount,matrix.conservative.sea_amount,matrix.conservative.combined_transport_amount], ["route_1",1000,650,1650]);
  const incomplete = transport.selectTransportOptions({ matched:true, match_status:"exact", routes_available:[{route_id:"route_1",amount:500}] }, { ...rates, seaFreight40HC:{ "3":{route_1:null}, "4":{route_1:null} } });
  assert.equal(incomplete.expected.status,"unknown");
  assert.equal(incomplete.expected.combined_transport_amount,null);
});

test("real partner examples retain source route costs and calculate standard/conservative totals", () => {
  const examples = [
    {label:"Houston",line:255,expected:["route_3",205,675,880],conservative:["route_3",205,850,1055]},
    {label:"Chicago",line:94,expected:["route_5",295,675,970],conservative:["route_5",295,850,1145]},
    {label:"Los Angeles",line:316,expected:["route_4",220,1175,1395],conservative:["route_4",220,1515,1735]},
    {label:"Miami",line:346,expected:["route_1",415,575,990],conservative:["route_1",415,650,1065]},
    {label:"New Jersey",line:384,expected:["route_2",230,575,805],conservative:["route_2",230,650,880]},
    {label:"Texas",line:257,expected:["route_3",205,675,880],conservative:["route_3",205,850,1055]},
    {label:"California",line:75,expected:["route_4",250,1175,1425],conservative:["route_4",250,1515,1765]},
    {label:"Alaska",line:19,expected:["route_5",3150,675,3825],conservative:["route_5",3150,850,4000]},
    {label:"Hawaii",line:236,expected:["route_3",2850,675,3525],conservative:["route_3",2850,850,3700]},
    {label:"Canada",line:1,expected:["route_6",2575,1050,3625],conservative:["route_6",2575,1485,4060]}
  ];
  for (const example of examples) {
    const row = rates.landRates[example.line - 1];
    const match = transport.findLandRate({ platform:row.platform, location_name:row.location_name_original, city:row.city, state:row.state_province, postal_code:row.postal_code });
    assert.equal(match.status,"exact",`${example.label}: exact source branch match`);
    const result = transport.selectTransportOptions(match);
    assert.deepEqual([result.expected.selected_route,result.expected.land_amount,result.expected.sea_amount,result.expected.combined_transport_amount], example.expected, `${example.label} expected`);
    assert.deepEqual([result.conservative.selected_route,result.conservative.land_amount,result.conservative.sea_amount,result.conservative.combined_transport_amount], example.conservative, `${example.label} conservative`);
    assert.equal(result.expected.currency,"USD");
  }
});

test("vehicle-card binding renders partner cost variants and passes standard transport to strict calculator", () => {
  const nodes = new Map();
  const makeNode = (value = "") => ({ value, textContent:"", hidden:false, handlers:{}, addEventListener(type, handler) { this.handlers[type]=handler; } });
  const selectors = ["[data-transport-purchase]","[data-transport-purchase-note]","[data-transport-location]","[data-transport-vehicle-facts]","[data-transport-land-status]","[data-transport-land-value]","[data-transport-sea-value]","[data-transport-combined]","[data-transport-total]","[data-transport-missing]"];
  for (const selector of selectors) nodes.set(selector,makeNode());
  const root = { querySelector(selector) { return nodes.get(selector) || null; } };
  const row = rates.landRates[254];
  let strictPartnerInput = null;
  const bound = transport.bind({ root, vehicle:{ platform:row.platform, auction:{ location:row.location_name, city:row.city, state:row.state_province, zip:row.postal_code }, year:2020, make:"Honda", model:"Civic" }, prefill:{ purchasePrice:2500, purchaseKind:"active-suggestion" }, onUpdate(value) { strictPartnerInput=value; } });
  assert.equal(nodes.get("[data-transport-purchase]").value,"2500");
  assert.match(nodes.get("[data-transport-land-value]").textContent,/205 USD/);
  assert.match(nodes.get("[data-transport-land-status]").textContent,/stawka do potwierdzenia/);
  assert.match(nodes.get("[data-transport-sea-value]").textContent,/Standard: 675 USD · Ostrożny: 850 USD/);
  assert.match(nodes.get("[data-transport-combined]").textContent,/880 USD · Ostrożny: 1055 USD/);
  assert.match(nodes.get("[data-transport-total]").textContent,/standard 880 USD · ostrożny 1055 USD/);
  assert.equal(bound.standard.source,"partner");
  assert.equal(strictPartnerInput.land_amount,205);
  assert.equal(strictPartnerInput.sea_amount,675);
  assert.equal(bound.costs.complete,false);
  assert.equal(bound.costs.total,null);
});
