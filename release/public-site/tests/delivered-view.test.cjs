"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");

const FX = {ok:true,usdPln:3.9247,eurPln:4.3917,effectiveDate:"2026-10-26"};
const FILES = ["rexbid-market.js", "rexbid-calculator-v4-rates.js", "rexbid-calculator-v4.js", "rexbid-delivered-rates.js", "rexbid-delivered-cost.js", "rexbid-delivered-view.js"];
const BENCHMARKS = [
  ["copart",5000,45795], ["copart",15000,99521], ["copart",25000,154892],
  ["iaai",5000,44907], ["iaai",15000,98633], ["iaai",25000,154004]
];
function setup(t, {vehicle={}, fx=FX, fetchRates, profile, inquiryHref="/kontakt?lot=12345678&platform=copart&return_to=%2F%3Fmake%3DAUDI%26year_from%3D2025"}={}) {
  const dom = new JSDOM('<a data-vehicle-inquiry>Kontakt</a><section id="calculator"><div id="mount"></div></section>', {url:"https://rexbid.pl/car?lot=12345678&platform=copart",runScripts:"outside-only"});
  t.after(() => dom.window.close());
  const {window} = dom;
  const NativeDate = window.Date;
  window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ["2026-10-26T12:00:00.000Z"])); } static now() { return NativeDate.parse("2026-10-26T12:00:00.000Z"); } };
  for (const name of FILES) window.eval(fs.readFileSync(path.join(__dirname,"../public",name),"utf8"));
  const doc = window.document, mount = doc.getElementById("mount"), events = [];
  doc.querySelector("[data-vehicle-inquiry]").setAttribute("href",inquiryHref);
  mount.addEventListener("rexbid:budget-update", event => events.push(event.detail));
  const record = {year:2024,make:"ALFA ROMEO",model:"TONALE",lot:"12345678",platform:"copart",body_style:"SUV",powertrain:"PHEV",engine_capacity_cc:1300,
    location:{auction_location:"Tampa South",state:"FL",country:"US"},auction:{state:'open'},pricing:{current_bid_usd:5000,buy_now_usd:16000}, ...vehicle};
  const binding = window.RexBidDeliveredView.bindCalculator({root:mount,vehicle:record,fx,fetchRates,profile});
  const q = selector => mount.querySelector(selector);
  const input = (name,value) => {const node=q(`[data-estimate-field="${name}"]`); node.value=String(value);node.dispatchEvent(new window.Event("input",{bubbles:true}));return node;};
  const change = (selector,value) => {const node=q(selector); if(node.type==="checkbox")node.checked=Boolean(value);else node.value=value;node.dispatchEvent(new window.Event("change",{bubbles:true}));return node;};
  const qualify = () => change("[data-estimate-exemption]",true);
  return {window,doc,mount,record,binding,q,input,change,qualify,events};
}

test('a bus with manually priced transport requires its own duty and excise before a full total', t => {
  const ui=setup(t,{vehicle:{body_style:'Bus',powertrain:'ICE',engine_capacity_cc:3500}});
  ui.input('landUsd',485);ui.input('seaUsd',995);
  const partial=ui.binding.getBudget();
  assert.equal(partial.complete,false);assert.equal(partial.dutyPln,null);assert.equal(partial.excisePln,null);
  assert.match(ui.q('[data-estimate-tax-lines]').textContent,/klasyfikacji/);
  ui.input('dutyOverridePln',800);ui.input('exciseOverridePln',0);
  const quoted=ui.binding.getBudget();
  assert.equal(quoted.complete,true);assert.equal(quoted.dutyPln,800);assert.equal(quoted.excisePln,0);
});

for (const [platform,bid,reference] of BENCHMARKS) {
  test(`delivered UI benchmark ${platform} $${bid} includes gross PLN2500 and matching auction costs`, t => {
    const location = platform === "copart" ? {auction_location:"Tampa South",state:"FL",country:"US"} : {auction_location:"Sayreville",state:"NJ",country:"US"};
    const ui = setup(t,{vehicle:{platform,location,pricing:{current_bid_usd:bid}}});
    assert.equal(ui.binding.getBudget().complete,false,"PHEV exemption must be explicitly qualified");
    ui.qualify();
    const budget = ui.binding.getBudget();
    assert.equal(budget.complete,true,JSON.stringify(budget.missing));
    const expected=reference + 2500 - 450 * FX.usdPln * 1.23 + (platform === "copart" ? 20 * FX.usdPln * 1.331 : 0);
    assert.ok(Math.abs(budget.totalPln-expected)<=2,`${budget.totalPln} vs ${expected}`);
    assert.equal(budget.commissionGrossPln,2500);
    assert.equal(budget.excisePln,0);
    assert.equal(ui.q('[data-estimate-cargo]').checked,true);
    assert.match(ui.q('[data-estimate-title]').textContent,/Szacowana cena pod dom/);
    assert.doesNotMatch(ui.mount.textContent,/rabat/i);
  });
}

test("archived BMW uses the observed Copart route and matches customs across purchase scenarios", t => {
  const ui=setup(t,{fx:{ok:true,usdPln:3.9852,eurPln:4.407,effectiveDate:"2026-11-13"},vehicle:{
    lot_number:"72915826",vin:"WBX13EF09S5386118",make:"BMW",model:"X1",powertrain:"ICE",engine_capacity_cc:null,body_style:"Sport utility vehicle",
    location:{display:"FL - PUNTA GORDA",state:"FL",postal_code:"34269"},pricing:{current_bid_usd:16300}
  }});
  ui.change('[data-estimate-destination]','warszawa');
  assert.equal(ui.q('[data-estimate-field="landUsd"]').value,'520');
  assert.equal(ui.q('[data-estimate-field="engineCc"]').value,'1998');
  for(const [bid,customs] of [[25,1671],[5000,7420],[16300,19083],[25000,28305],[100000,107805]]) {
    ui.input('purchaseUsd',bid);
    const estimate=ui.binding.getBudget();
    assert.equal(estimate.complete,true);
    assert.equal(estimate.customsUsd,customs);
    assert.equal(estimate.commissionGrossPln,2500);
  }
});

test("calculator presents three closed details with result/contact first and no container internals", t => {
  const ui = setup(t);
  const details = [...ui.mount.querySelectorAll("details")];
  assert.equal(details.length,3);
  assert.ok(details.every(node=>!node.open));
  assert.equal(ui.mount.querySelector('header,footer'),null,'isolated calculator sections do not inherit global page header/footer styles');
  assert.equal(ui.q('[data-estimate-mode]'),null,'vehicle details expose only the USD purchase calculator');
  assert.ok(ui.q('[data-estimate-total]').compareDocumentPosition(details[0])&4);
  assert.ok(ui.q('[data-v4-inquiry]').compareDocumentPosition(details[0])&4);
  assert.doesNotMatch(ui.mount.textContent,/40\s*['’]?\s*HC|kontener|container|mnożnik|multiplier|liczba aut|cars_per_container/i);
  assert.deepEqual(details.map(node=>node.querySelector('summary').textContent.trim()),["01 Zakup i transport","02 Odprawa i podatki","03 Dostawa i usługi"]);
});

test("at 2000 USD duty includes fees and transport, and manual tax values affect the full total", t => {
  const ui = setup(t,{vehicle:{powertrain:"ICE"}});
  ui.input('purchaseUsd',2000);
  const quote = ui.binding.getBudget();
  const round = n => Math.round(n * 100) / 100;
  assert.equal(quote.complete,true, JSON.stringify(quote.missing));
  assert.equal(quote.customsUsd,2000 + quote.auctionFeeUsd
    + Number(ui.q('[data-estimate-field=landUsd]').value) + Number(ui.q('[data-estimate-field=seaUsd]').value));
  assert.equal(quote.dutyPln,round(quote.customsUsd * FX.usdPln * 0.1));
  assert.equal(quote.vatPln,round(quote.customsUsd * FX.usdPln * 1.1 * 0.21));
  ui.input('dutyOverridePln',900);
  assert.equal(ui.binding.getBudget().dutyPln,900);
  assert.equal(ui.binding.getBudget().vatPln,round((quote.customsUsd * FX.usdPln + 900) * 0.21));
  ui.input('vatOverridePln',2600);
  ui.input('exciseOverridePln',100);
  assert.equal(ui.binding.getBudget().vatPln,2600);
  assert.equal(ui.binding.getBudget().excisePln,100);
  assert.equal(ui.binding.getBudget().totalPln,
    round(quote.totalPln - quote.dutyPln - quote.vatPln - quote.excisePln + 900 + 2600 + 100));
  for (const key of ['dutyOverridePln','vatOverridePln','exciseOverridePln']) ui.input(key,'');
  assert.equal(ui.binding.getBudget().totalPln,quote.totalPln);
});

test("market refresh preserves manually typed custom purchase price, selected route and explicit fees", t => {
  const ui = setup(t);
  ui.qualify();
  ui.input("purchaseUsd",12345);
  ui.input("auctionFeeOverrideUsd",1100);
  ui.input("landUsd",550);
  ui.binding.updateMarketPrices({currentBid:9999,buyNowPrice:17000,read:{source:"d1",freshness:"fresh",last_synced_at:"2026-10-26T11:50:00.000Z"}});
  assert.equal(ui.binding.priceKind.value,"custom");
  assert.equal(ui.binding.priceInput.value,"12345");
  assert.equal(ui.binding.getBudget().auctionFeeUsd,1100);
  assert.equal(ui.q('[data-estimate-field="landUsd"]').value,"550");
  assert.match(ui.q('[data-estimate-price-note]').textContent,/Twoja planowana kwota/);
  ui.binding.setPriceKind("current");
  assert.equal(ui.binding.priceInput.value,"9999");
  ui.binding.setPriceKind("custom");
  assert.equal(ui.binding.priceInput.value,"12345");
});

test("removed Buy Now falls back to custom without falsely retaining a market Buy Now option", t => {
  const ui=setup(t);
  ui.binding.setPriceKind("buy-now");
  assert.equal(ui.binding.priceInput.value,"16000");
  ui.binding.updateMarketPrices({buyNowPrice:null,currentBid:7000});
  assert.equal(ui.binding.priceKind.value,"custom");
  assert.equal(ui.q('[data-v4-price-kind] option[value="buy-now"]'),null);
  assert.match(ui.q('[data-estimate-price-note]').textContent,/Twoja planowana kwota/);
  ui.binding.setPriceKind("buy-now");
  assert.equal(ui.binding.priceKind.value,"custom");
});

test("zero and missing source bids require a custom price and never produce a complete budget", t => {
  for(const current_bid_usd of [0,null]) {
    const ui=setup(t,{vehicle:{pricing:{current_bid_usd,buy_now_usd:null}}});
    ui.qualify();
    assert.equal(ui.binding.priceInput.value,"");
    assert.equal(ui.binding.priceKind.value,"custom");
    assert.equal(ui.q('[data-v4-price-kind] option[value="current"]').disabled,true);
    assert.equal(ui.binding.getBudget().complete,false);
    assert.equal(ui.binding.getBudget().totalPln,null);
    assert.match(ui.q('[data-estimate-title]').textContent,/częściowo/);
    assert.match(ui.q('[data-estimate-status]').textContent,/cenę pojazdu/);
    ui.input("purchaseUsd",5000);
    assert.equal(ui.binding.getBudget().complete,true);
  }
});

test("unknown route, unsupported large body and explicit Canada require transport quotes", t => {
  const variants=[
    {location:{auction_location:"Unconfirmed Branch",state:"FL",country:"US"}},
    {body_style:"Heavy Duty Truck"},
    {location:{auction_location:"ABBOTSFORD, BC V4X-1G8",state:"BC",country:"CA"}}
  ];
  for(const vehicle of variants) {
    const ui=setup(t,{vehicle});ui.qualify();
    assert.equal(ui.q('[data-estimate-field="landUsd"]').value,"");
    assert.equal(ui.q('[data-estimate-field="seaUsd"]').value,"");
    assert.equal(ui.binding.getBudget().complete,false);
    assert.match(ui.q('[data-estimate-status]').textContent,/transport|fracht/i);
  }
});

test("standard pickups use the branch tariff with the existing pickup factor", t => {
  const examples = [
    {make:"TOYOTA",model:"TACOMA HYBRID",platform:"iaai",body_style:"Truck",powertrain:"HEV",engine_capacity_cc:2400,
      location:{display:"Avenel New Jersey",state:"NJ",postal_code:"07001"}},
    {make:"FORD",model:"RANGER",platform:"copart",body_style:"Pickup",powertrain:"ICE",engine_capacity_cc:2300,
      location:{display:"AKRON (OH) 44203",state:"OH",postal_code:"44203"}}
  ];
  for (const vehicle of examples) {
    const ui=setup(t,{vehicle});
    ui.input("purchaseUsd",1100);
    const quote=ui.binding.getBudget();
    assert.equal(quote.complete,true,JSON.stringify(quote.missing));
    assert(quote.dutyPln>0);
    assert.equal(ui.q('[data-estimate-field="landUsd"]').value,vehicle.platform==="iaai"?"255":"787.5");
    assert.equal(ui.q('[data-estimate-field="seaUsd"]').value,"995");
    assert.match(ui.q('[data-estimate-route]').textContent,/standardowy pickup/);
  }
  const heavy=setup(t,{vehicle:{make:"TOYOTA",model:"TACOMA",body_style:"Truck",transport_class:"pickup_oversized"}});
  assert.equal(heavy.q('[data-estimate-field="landUsd"]').value,"");
});

test("Canada inferred from a matched rate row cannot silently use the standard US route", t => {
  const ui=setup(t,{vehicle:{location:{auction_location:"ABBOTSFORD, BC V4X-1G8",state:"BC"}}});
  ui.qualify();
  assert.equal(ui.q('[data-estimate-field="landUsd"]').value,"");
  assert.equal(ui.q('[data-estimate-field="seaUsd"]').value,"");
  assert.equal(ui.binding.getBudget().complete,false);
});

test("oversize selection makes both display, exported text and emitted budget partial", t => {
  const ui=setup(t);ui.qualify();
  assert.equal(ui.binding.getBudget().complete,true);
  ui.change('[data-estimate-oversize]',true);
  assert.equal(ui.binding.getBudget().complete,false);
  assert.equal(ui.events.at(-1).budget.complete,false);
  assert.match(ui.binding.exportBreakdown(),/częściowo/);
  assert.match(ui.q('[data-estimate-status]').textContent,/ponadgabarytowego/);
  ui.change('[data-estimate-oversize]',false);
  assert.equal(ui.binding.getBudget().complete,true);
});

test("NBP failure keeps costs partial and allows manual FX recovery", async t => {
  const ui=setup(t,{fx:null,fetchRates:async()=>{throw Error('private upstream details');}});
  ui.qualify();await ui.binding.ready;
  assert.equal(ui.binding.getBudget().complete,false);
  assert.match(ui.q('[data-estimate-fx]').textContent,/chwilowo niedostępne/);
  assert.doesNotMatch(ui.mount.textContent,/private upstream/);
  assert.equal(ui.q('[data-estimate-field="usdPln"]').value,"");
  ui.input('usdPln',4);ui.input('eurPln',4.5);
  assert.equal(ui.binding.getBudget().complete,true);
  assert.match(ui.q('[data-estimate-fx]').textContent,/wpisane ręcznie/);
});

test("async official rates fill untouched fields without overwriting a manually typed USD rate", async t => {
  let finish;
  const deferred=new Promise(resolve=>{finish=resolve;});
  const ui=setup(t,{fx:null,fetchRates:()=>deferred});
  ui.qualify();ui.input('usdPln',4.2);
  finish(FX);await ui.binding.ready;
  assert.equal(ui.q('[data-estimate-field="usdPln"]').value,'4.2');
  assert.equal(ui.q('[data-estimate-field="eurPln"]').value,'4.3917');
  assert.equal(ui.binding.getBudget().complete,true);
});

test("async success never overwrites either manually typed FX value", async t => {
  let finish;
  const deferred=new Promise(resolve=>{finish=resolve;});
  const ui=setup(t,{fx:null,fetchRates:()=>deferred});
  ui.input('usdPln',4.2);ui.input('eurPln',4.6);
  finish(FX);await ui.binding.ready;
  assert.equal(ui.q('[data-estimate-field="usdPln"]').value,'4.2');
  assert.equal(ui.q('[data-estimate-field="eurPln"]').value,'4.6');
  assert.match(ui.q('[data-estimate-fx]').textContent,/wpisane ręcznie/);
});

test("contact keeps return_to and budget event carries complete result with vehicle context", t => {
  const ui=setup(t);ui.qualify();
  const url=new URL(ui.q('[data-v4-inquiry]').href);
  assert.equal(url.pathname,'/kontakt');
  assert.equal(url.searchParams.get('return_to'),'/?make=AUDI&year_from=2025');
  assert.equal(url.searchParams.get('lot'),'12345678');
  const detail=ui.events.at(-1);
  assert.equal(detail.lot,'12345678');
  assert.equal(detail.platform,'copart');
  assert.equal(detail.purchasePriceUsd,5000);
  assert.equal(detail.budget.complete,true);
  assert.equal(detail.budget.totalPln,ui.binding.getBudget().totalPln);
  assert.equal(detail.breakdownText,ui.binding.exportBreakdown());
  assert.match(detail.breakdownText,/ALFA ROMEO/);
  assert.match(detail.breakdownText,/Prowizja REXBID brutto/);
  assert.doesNotMatch(detail.breakdownText,/rabat/i);
});

test("hostile vehicle text and contact URL cannot create executable HTML or links", t => {
  const payload='<img src=x onerror="window.pwned=true">';
  const ui=setup(t,{inquiryHref:'javascript:alert(1)',vehicle:{make:payload,model:'<script>window.pwned=true</script>',lot:'123" onmouseover="alert(1)',location:{auction_location:payload,state:'FL',country:'US'}}});
  assert.equal(ui.mount.querySelector('img'),null);
  assert.equal(ui.mount.querySelector('script'),null);
  assert.equal(ui.window.pwned,undefined);
  assert.equal(new URL(ui.q('[data-v4-inquiry]').href).pathname,'/kontakt');
  assert.equal(new URL(ui.q('[data-v4-inquiry]').href).searchParams.get('lot'),'123" onmouseover="alert(1)');
  assert.match(ui.q('[data-estimate-route]').textContent,/<img/);
  assert.ok([...ui.mount.querySelectorAll('*')].every(node=>[...node.attributes].every(attr=>!/^on/i.test(attr.name))));
});

test("malformed state data is displayed safely without regular-expression crashes", t => {
  assert.doesNotThrow(()=>setup(t,{vehicle:{location:{auction_location:'Unknown branch',state:'[',country:'US'}}}));
});

test("custom destination clears delivery until quoted; manual delivery selects custom and predefined changes recalculate", t => {
  const ui=setup(t);ui.qualify();const before=ui.binding.getBudget().totalPln;
  ui.change('[data-estimate-destination]','custom');
  assert.equal(ui.q('[data-estimate-field="deliveryPln"]').value,'');
  assert.equal(ui.binding.getBudget().complete,false);
  ui.input('deliveryPln',3100);
  assert.equal(ui.q('[data-estimate-destination]').value,'custom');
  assert.equal(ui.binding.getBudget().complete,true);
  assert.equal(ui.binding.getBudget().totalPln,Math.round((before+800)*100)/100);
  ui.change('[data-estimate-destination]','slaskie');
  assert.equal(ui.q('[data-estimate-field="deliveryPln"]').value,'2500');
  assert.equal(ui.binding.getBudget().totalPln,Math.round((before+200)*100)/100);
});

test("repeated UI updates apply gross commission exactly once without changing customs or taxes", t => {
  const ui=setup(t);ui.qualify();
  const start=JSON.parse(JSON.stringify(ui.binding.getBudget()));
  for(let i=0;i<10;i++)ui.binding.update();
  const result=ui.binding.getBudget();
  assert.equal(result.commissionGrossPln,2500);
  assert.equal(result.totalPln,start.totalPln);
  assert.equal(result.customsUsd,start.customsUsd);
  assert.equal(result.dutyPln,start.dutyPln);
  assert.equal(result.vatPln,start.vatPln);
  assert.equal(result.lineItems.filter(line=>line.id==='commission').length,1);
});

test("unknown auction status stays a snapshot even after a fresh database observation", t => {
  const ui=setup(t,{vehicle:{auction:{state:'unknown'},read:{source:'d1',freshness:'fresh',last_synced_at:'2026-10-26T12:00:00.000Z'}}});
  assert.match(ui.q('[data-v4-price-kind] option[value="current"]').textContent,/Ostatnia zapisana/);
  assert.equal(ui.events.at(-1).priceStatus,'snapshot');
});

test("read-only preview uses its own observation date including last_seen_at", t => {
  const ui=setup(t,{vehicle:{preview:{read_only:true,last_seen_at:'2026-10-20T12:00:00.000Z'},read:{source:'d1',freshness:'fresh',last_synced_at:'2026-10-26T12:00:00.000Z'}}});
  assert.equal(ui.events.at(-1).priceObservedAt,'2026-10-20T12:00:00.000Z');
  assert.match(ui.q('[data-estimate-price-note]').textContent,/20\.10\.2026/);
});

test("generic Hybrid fuel alone does not choose HEV taxation for a possible PHEV", t => {
  const ui=setup(t,{vehicle:{powertrain:undefined,fuel_type:'Hybrid'}});
  assert.equal(ui.q('[data-estimate-powertrain]').value,'unknown');
  assert.equal(ui.q('[data-estimate-cargo]').checked,true);
  assert.equal(ui.binding.getBudget().complete,false);
});

test("normalized sport utility body and engine liters prefill a standard vehicle", t => {
  const ui=setup(t,{vehicle:{body_style:'Sport utility vehicle',powertrain:'ICE',engine_capacity_cc:null,engine_size_l:2.3}});
  assert.equal(ui.q('[data-estimate-field="landUsd"]').value,'485');
  assert.equal(ui.q('[data-estimate-field="engineCc"]').value,'2300');
  assert.equal(ui.binding.getBudget().complete,true);
});

test("explicit large transport classes override a generic SUV body", t => {
  for(const classField of ['transport_class','vehicle_class','body_style_class']) {
    const ui=setup(t,{vehicle:{[classField]:'suv_large'}});ui.qualify();
    assert.equal(ui.q('[data-estimate-field="landUsd"]').value,'');
    assert.equal(ui.q('[data-estimate-field="seaUsd"]').value,'');
    assert.equal(ui.binding.getBudget().complete,false);
  }
});

test("snapshot prices retain dated, unconfirmed availability wording after market update", t => {
  const ui=setup(t,{vehicle:{read:{source:'d1',freshness:'stale',last_synced_at:'2026-10-20T12:00:00.000Z'}}});
  assert.match(ui.q('[data-v4-price-kind] option[value="current"]').textContent,/Ostatnia zapisana/);
  assert.match(ui.q('[data-estimate-price-note]').textContent,/Dostępność wymaga potwierdzenia/);
  assert.equal(ui.events.at(-1).priceStatus,'snapshot');
  ui.binding.updateMarketPrices({currentBid:6000,read:{source:'d1',freshness:'fresh',last_synced_at:'2026-10-26T11:00:00.000Z'}});
  assert.equal(ui.binding.priceInput.value,'6000');
  assert.equal(ui.events.at(-1).priceStatus,'current');
  assert.match(ui.q('[data-v4-price-kind] option[value="current"]').textContent,/Aktualna oferta/);
});

test('customs value is editable, persists while bid changes, exports its source and resets to automatic',t=>{
 const ui=setup(t);ui.qualify();const initial=ui.binding.getBudget();
 const field=ui.q('[data-estimate-field="customsValueUsd"]'),reset=ui.q('[data-estimate-customs-reset]');
 assert.equal(field.value,'');assert.equal(reset.disabled,true);
 ui.input('customsValueUsd',6000);let r=ui.binding.getBudget();assert.equal(r.customsUsd,6000);assert.equal(r.customsValueSource,'manual');assert.equal(reset.disabled,false);
 assert.match(ui.q('[data-estimate-tax-lines]').textContent,/wpisana ręcznie/);assert.match(ui.binding.exportBreakdown(),/Wartość celna · wpisana ręcznie/);
 assert.equal(r.lineItems.find(x=>x.id==='purchase').amount,5000);
 ui.input('purchaseUsd',15000);r=ui.binding.getBudget();assert.equal(field.value,'6000');assert.equal(r.customsUsd,6000);assert.notEqual(r.calculatedCustomsUsd,initial.customsUsd);
 reset.click();r=ui.binding.getBudget();assert.equal(field.value,'');assert.equal(r.customsUsd,r.calculatedCustomsUsd);assert.equal(r.customsValueSource,'calculated');assert.equal(reset.disabled,true);
 ui.input('customsValueUsd',0);assert.equal(ui.binding.getBudget().complete,false);assert.equal(ui.binding.getBudget().dutyPln,null);
 ui.input('customsValueUsd','');assert.equal(ui.binding.getBudget().customsValueSource,'calculated');
});


test("valid purchase cents and four-decimal exchange rates satisfy native input constraints",t=>{
 const ui=setup(t);ui.qualify();
 for(const [field,value]of [['purchaseUsd',5000],['purchaseUsd',12345.67],['usdPln',3.9247],['eurPln',4.3917]]){const node=ui.input(field,value);assert.equal(node.validity.stepMismatch,false,field+': '+value);assert.equal(node.checkValidity(),true,field+': '+value);assert.equal(node.getAttribute('aria-invalid'),'false');}
 assert.equal(ui.binding.getBudget().complete,true);assert.equal(ui.q('[data-estimate-field="usdPln"]').getAttribute('step'),'0.0001');
 ui.input('usdPln',0);assert.equal(ui.binding.getBudget().complete,false);assert.equal(ui.q('[data-estimate-field="usdPln"]').getAttribute('aria-invalid'),'true');
});

test("freshness-only archive refresh updates calculator price context and preserves manually entered costs",t=>{
 const ui=setup(t,{vehicle:{read:{source:'d1',freshness:'fresh',catalog_scope:'active',last_synced_at:'2026-10-26T11:00:00.000Z'}}});ui.qualify();ui.input('landUsd',550);ui.input('customsValueUsd',7500);
 ui.binding.updateMarketPrices({read:{source:'d1',freshness:'fresh',catalog_scope:'archival',last_synced_at:'2026-10-26T11:30:00.000Z'}});
 assert.match(ui.q('[data-v4-price-kind] option[value="current"]').textContent,/Ostatnia zapisana oferta/);assert.match(ui.q('[data-estimate-price-note]').textContent,/ostatnio zapisanych|Dostępność wymaga potwierdzenia/);assert.equal(ui.events.at(-1).priceStatus,'snapshot');assert.equal(ui.q('[data-estimate-field="landUsd"]').value,'550');assert.equal(ui.q('[data-estimate-field="customsValueUsd"]').value,'7500');
 ui.binding.updateMarketPrices({read:{source:'d1',freshness:'fresh',catalog_scope:'active'}});assert.equal(ui.q('[data-v4-price-kind] option[value="current"]').textContent,'Aktualna oferta');assert.equal(ui.events.at(-1).priceStatus,'current');
});

test('ambiguous hybrid has a shortcut to the tax fields and keeps the powertrain unconfirmed', t=>{
 const p=setup(t,{vehicle:{powertrain:null,engine_capacity_cc:null,fuel_type:'Electric and gas hybrid'}});
 const help=p.q('[data-estimate-hybrid-help]');
 assert.ok(help);
 const doc=help.ownerDocument;
 assert.equal(help.hidden,false);
 assert.equal(doc.querySelector('[data-estimate-powertrain]').value,'unknown');
 help.querySelector('button').click();
 assert.equal(doc.querySelector('[data-estimate-tax-section]').open,true);
 assert.equal(doc.activeElement,doc.querySelector('[data-estimate-powertrain]'));
});


test('auction engine liters avoid extra VIN request when powertrain is known',async t=>{
 const ui=setup(t,{vehicle:{vin:'2HKRW2H89NH645557',engine_capacity_cc:null,engine_size_l:1.5,powertrain:'ICE'}});let calls=0;ui.window.fetch=()=>{calls++;throw Error('unexpected');};await ui.binding.ready;assert.equal(calls,0);assert.equal(ui.q('[data-estimate-field="engineCc"]').value,'1500');assert.match(ui.q('[data-estimate-specs]').textContent,/Apibara/);
});
test('loading quote hides temporary subtotal and only publishes settled amount after FX',async t=>{
 let release;const wait=new Promise(resolve=>release=resolve);const ui=setup(t,{fx:null,fetchRates:()=>wait});assert.equal(ui.q('[data-estimate-total]').textContent,'—');assert.equal(ui.events.at(-1).budget.loading,true);assert.equal(ui.events.at(-1).budget.knownTotalPln,null);assert.equal(ui.q('[data-estimate-copy]').disabled,true);release(FX);await ui.binding.ready;assert.notEqual(ui.q('[data-estimate-total]').textContent,'—');assert.equal(ui.events.at(-1).budget.loading,false);assert.equal(ui.q('[data-estimate-copy]').disabled,false);
});
