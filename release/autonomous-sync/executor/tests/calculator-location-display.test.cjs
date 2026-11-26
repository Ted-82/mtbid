"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const calc = require("../public/rexbid-calculator.js");
const source = fs.readFileSync(path.join(__dirname, "../public/car.html"), "utf8");
const start = source.indexOf("  function calculatorLocationLabel(");
const end = source.indexOf("    let auctionRefreshTimer", start);
assert.ok(start > 0 && end > start);
function render(location, fallback = null) {
  let bound;
  const mount = {}, strict = {}, root = {querySelector: selector => selector === "#calculatorV4Mount" ? mount : selector === ".strict-estimate-mode" ? strict : null};
  const vehicle = {platform:"copart", location, fuel_type:"Gas", pricing:{current_bid_usd:5000}, auction:{state:"open"}};
  const prefill = calc.prefillFromVehicle(vehicle);
  const originalPrefillLocation = prefill.location;
  const context = {car:vehicle, document:{getElementById:()=>root}, window:{RexBidCalculator:{prefillFromVehicle:()=>prefill, bindCalculator:options=>{bound=options;return {};}}},
    platformName:()=>"COPART", auctionPhase:()=>"open", getLocation:()=>fallback, isEmpty:value=>value===null||value===undefined||value==="", console};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end)+"\ninitImportCalculator();",context);
  assert.equal(bound.prefill,prefill,"display formatting does not replace calculation input");
  assert.equal(bound.prefill.location,originalPrefillLocation,"original prefill location stays intact");
  assert.match(bound.context,/Paliwo: Gas/,"fuel is not interpreted by this fix");
  assert.doesNotMatch(bound.context,/\[object Object\]/);
  return bound.context;
}
test("strict calculator context renders scalar and known object location fields",()=>{
  for(const [location,label] of [
    ["  Orlando (FL)  ","Orlando (FL)"],
    [{display:"Orlando (FL)",city:"Ignored",state:"TX"},"Orlando (FL)"],
    [{label:"Orlando North"},"Orlando North"],
    [{name:"Jacksonville"},"Jacksonville"],
    [{city:"Orlando",state:"FL"},"Orlando (FL)"],
    [{city:"Orlando"},"Orlando"], [{state:"FL"},"FL"], [{raw:"Orlando North"},"Orlando North"]
  ]) assert.ok(render(location).includes("Lokalizacja: "+label));
});
test("strict calculator omits null and unknown object locations without inventing a label",()=>{
  for(const location of [null,undefined,{},[],42,{display:{name:"Nested"},city:{name:"Nested"},raw:{unknown:true}}]) {
    assert.doesNotMatch(render(location),/Lokalizacja:/);
  }
  assert.match(render({unknown:true},{name:"Known fallback"}),/Lokalizacja: Known fallback/);
});
