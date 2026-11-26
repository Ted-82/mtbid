const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const publicRoot = path.join(__dirname, "../public");
const read = file => fs.readFileSync(path.join(publicRoot, file), "utf8");

function page(t, overrides = {}) {
  const dom = new JSDOM('<section id="importCalculator"><div id="calculatorMount"></div></section>', {runScripts:"outside-only",url:"https://rexbid.pl/car.html"});
  t.after(() => dom.window.close());
  for (const file of ["rexbid-calculator-v4-rates.js", "rexbid-import-budget.js", "rexbid-calculator-v4.js"]) dom.window.eval(read(file));
  const win = dom.window, doc = win.document;
  const vehicle = {lot:"62674546",platform:"copart",auction:{facility_name:"HOUSTON 77073"},pricing:{current_bid_usd:10000,buy_now_usd:12000},body_style:"Sedan",fuel_type:"Gasoline",...overrides};
  const binding = win.RexBidCalculatorV4.bindCalculator({root:doc.getElementById("calculatorMount"),vehicle});
  const input = (selector, value) => { const node = doc.querySelector(selector); node.value = value; node.dispatchEvent(new win.Event("input",{bubbles:true})); return node; };
  return {win,doc,binding,input};
}

test("unknown transport opens accessible settings while purchase labels remain separate", t => {
  const {doc} = page(t,{body_style:"SUV"});
  assert.equal(doc.querySelector('[data-v4-class]').closest("details").open, true);
  assert.equal(doc.querySelector('[data-v4-powertrain]').closest("details").open, true);
  assert.equal(doc.querySelector('[data-v4-class]').getAttribute("aria-invalid"), "true");
  assert.match(doc.querySelector('label[for="calculatorV4PriceKind"]').textContent, /Cena do kalkulacji/);
  assert.match(doc.querySelector('label[for="calculatorV4Price"]').textContent, /Kwota zakupu \(USD\)/);
  assert.match(doc.querySelector('[data-v4-class] option[value="suv_large"]').textContent, /Duży SUV/);
});

test("blank fee remains missing while explicit zero is included; summary stays partial", t => {
  const {doc,binding,input} = page(t);
  const row = () => [...doc.querySelectorAll("[data-v4-lines]>div")].find(node => node.textContent.includes("Opłaty aukcyjne"));
  assert.equal(row().dataset.costStatus, "missing");
  assert.equal(binding.current().auctionFeeUsd, null);
  assert.match(row().textContent, /Brak danych · poza sumą/);
  input('[data-v4-auction-fee]', "0");
  assert.equal(row().dataset.costStatus, "included");
  assert.equal(binding.current().auctionFeeUsd, 0);
  assert.match(doc.querySelector("[data-v4-status]").textContent, /Kalkulacja częściowa/);
  assert.match(doc.querySelector("[data-v4-note]").textContent, /nie oznaczają 0/);
  assert.equal(doc.querySelectorAll('[data-v4-lines] [data-cost-status="missing"]').length, 2);
});

test("BEV surcharge remains once per vehicle and HEV/PHEV remain incomplete in actual DOM", t => {
  const {doc,binding,input} = page(t,{fuel_type:"Electric"});
  let result = binding.current();
  assert.equal(result.variant.ev_packing.amount_usd, 150);
  const bevLand = result.variant.land_usd, bevSea = result.variant.sea_usd;
  input('[data-v4-class]', "pickup_oversized");
  result = binding.current();
  assert.equal(result.variant.land_usd, bevLand * 2);
  assert.equal(result.variant.sea_usd, bevSea);
  assert.equal(result.variant.ev_packing.amount_usd, 150);
  const terminal = result.variant.terminal.id;
  input('[data-v4-scenario]', "conservative");
  assert.equal(binding.current().variant.terminal.id, terminal);
  assert.equal(binding.current().variant.ev_packing.amount_usd, 150);
  for (const powertrain of ["HEV", "PHEV"]) {
    input('[data-v4-powertrain]',powertrain);
    assert.equal(binding.current().variant.amount_usd,null);
    assert.equal(binding.current().variant.ev_packing.amount_usd,null);
    assert.equal(binding.getBudget().complete,false);
    const transport = [...doc.querySelectorAll("[data-v4-lines]>div")].find(node => node.textContent.includes("Transport USA + morski"));
    assert.equal(transport.dataset.costStatus,"incomplete");
    assert.match(doc.querySelector("[data-v4-status]").textContent, /Dopłata dla napędu wymaga potwierdzenia/);
  }
});

test("fully entered PLN fields are described as an estimate pending scope verification", t => {
  const {doc,binding,input} = page(t);
  input('[data-v4-auction-fee]',"0");
  input('[data-budget-field="usdPln"]',"3.9");
  for (const field of doc.querySelectorAll('[data-budget-field]:not([data-budget-field="usdPln"])')) input(`[data-budget-field="${field.dataset.budgetField}"]`,"0");
  assert.equal(binding.getBudget().complete,true);
  assert.match(doc.querySelector("[data-budget-missing]").textContent,/To szacunek — potwierdź zakres usług/);
  assert.doesNotMatch(doc.querySelector("[data-budget-label]").textContent,/pełna cena pod dom/i);
  assert.match(doc.querySelector(".import-budget").textContent,/Każdą opłatę dodaj tylko raz/);
});

test("partner questionnaire keeps missing values explicit, exports metadata and never requests network", t => {
  const html = fs.readFileSync(path.join(__dirname,"../docs/CALCULATOR_PARTNER_FORM.html"),"utf8");
  const dom = new JSDOM(html,{runScripts:"outside-only",url:"file:///CALCULATOR_PARTNER_FORM.html"});
  t.after(() => dom.window.close());
  const requests = [];
  dom.window.fetch = (...args) => {requests.push(args);throw new Error("Network prohibited");};
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join("\n");
  dom.window.eval(script);
  const form = dom.window.document.getElementById("partnerForm");
  const submit = () => form.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  submit();
  const preview = dom.window.document.getElementById("partnerPreview");
  assert.match(preview.value,/odpowiedź niekompletna; braki nie są zerem/);
  assert.match(preview.value,/Port docelowy: BRAK DANYCH/);
  const values = {destinationPort:"Bremerhaven",customsCountry:"Niemcy",freightIncluded:"Załadunek",freightExcluded:"Port i broker",service1:"Port + broker + dokumenty",amount1:"950",currency1:"EUR",unit1:"Za pojazd",tax1:"Netto",excluded1:"Dostawa w Polsce",source:"Potwierdzenie partnera",quoteDate:"2026-10-07"};
  for (const [key,value] of Object.entries(values)) form.elements.namedItem(key).value=value;
  submit();
  assert.match(preview.value,/pola pierwszego pakietu uzupełnione/);
  for (const value of Object.values(values)) assert.ok(preview.value.includes(value));
  assert.match(preview.value,/Obowiązuje od: Nie podano/);
  assert.equal(dom.window.document.activeElement,preview);
  assert.equal(requests.length,0);
  assert.match(html,/connect-src 'none'; form-action 'none'/);
  assert.doesNotMatch(script,/fetch\(|XMLHttpRequest|localStorage|sessionStorage/);
  form.reset();
  assert.equal(dom.window.document.getElementById("partnerOutput").hidden,true);
});
