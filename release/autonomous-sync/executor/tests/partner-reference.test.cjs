const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");

test("partner reference distinguishes already included BEV from new uncounted costs and preserves missing hybrid totals", t => {
  const dom = new JSDOM('<div id="mount"></div>', {runScripts:"outside-only", url:"https://rexbid.pl/car"});
  t.after(() => dom.window.close());
  const calls = [];
  dom.window.fetch = (...args) => {calls.push(args); throw new Error("No network in local calculation");};
  for (const file of ["rexbid-calculator-v4-rates.js", "rexbid-calculator-v4.js"]) {
    dom.window.eval(fs.readFileSync(path.join(__dirname,"../public",file),"utf8"));
  }
  const api = dom.window.RexBidCalculatorV4;
  const binding = api.bindCalculator({root:dom.window.document.getElementById("mount"),vehicle:{
    lot:"62674546", platform:"copart", auction:{facility_name:"HOUSTON 77073"},
    pricing:{current_bid_usd:10000}, body_style:"Sedan", fuel_type:"Electric"
  }});
  const doc = dom.window.document;
  const reference = doc.querySelector("[data-v4-partner-reference]");
  assert.match(reference.textContent,/Rotterdam, Holandia/);
  assert.match(reference.textContent,/14\.10\.2026/);
  assert.match(reference.textContent,/180/);
  assert.match(reference.textContent,/250/);
  assert.match(doc.querySelector("[data-v4-reference-packing]").textContent,/już wliczone.*Nie doliczaj/);
  assert.equal(binding.current().knownSubtotalUsd,11030,"the new reference must not silently add handling/inspection or duplicate BEV");
  for (const value of ["HEV","PHEV","FCEV","unknown"]) {
    const control=doc.querySelector("[data-v4-powertrain]"); control.value=value;
    control.dispatchEvent(new dom.window.Event("input",{bubbles:true}));
    assert.equal(binding.current().variant.amount_usd,null);
    assert.equal(binding.current().knownSubtotalUsd,10880);
    assert.match(doc.querySelector("[data-v4-status]").textContent,/Kalkulacja częściowa/);
    const packing=doc.querySelector("[data-v4-reference-packing]").textContent;
    if (["HEV","PHEV"].includes(value)) assert.match(packing,/150.*poza obecną sumą/);
    else assert.match(packing,/wymaga indywidualnego potwierdzenia/);
  }
  assert.equal(calls.length,0);
  assert.equal(api.partnerReference.received_on,"2026-10-14");
  assert.doesNotMatch(reference.textContent,/19%|3,2%|1,6%|2500|625/);
});
