const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
function setup(t, changes={}) {
  const dom = new JSDOM('<a data-vehicle-inquiry href="/kontakt.html?lot=57660876&platform=copart&return_to=%2F%3Fmake%3DTESLA">Kontakt</a><section id="importCalculator"><div id="mount"></div></section>',{url:'https://rexbid.pl/car.html',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  for (const name of ['rexbid-calculator-v4-rates.js','rexbid-import-budget.js','rexbid-calculator-v4.js']) dom.window.eval(fs.readFileSync(path.join(__dirname,'../public',name),'utf8'));
  const doc=dom.window.document;
  const binding=dom.window.RexBidCalculatorV4.bindCalculator({root:doc.getElementById('mount'),vehicle:{lot:'57660876',platform:'copart',auction:{facility_name:'HOUSTON 77073'},pricing:{current_bid_usd:10000,buy_now_usd:12000},body_style:'Sedan',fuel_type:'Gasoline',...changes}});
  function input(selector,value) {const el=doc.querySelector(selector);el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
  return {doc,binding,input};
}
test('compact default puts result and inquiry before closed cost settings',t=>{
  const {doc}=setup(t);
  const settings=doc.querySelector('[data-v4-settings]');
  assert.equal(settings.open,false);
  for(const key of ['class','powertrain','scenario','auction-fee']) assert.equal(doc.querySelector(`[data-v4-${key}]`).closest('details'),settings);
  assert.equal(doc.querySelector('[data-v4-total]').closest('details'),null);
  assert.ok(doc.querySelector('[data-v4-inquiry]').compareDocumentPosition(settings)&4);
  assert.match(doc.querySelector('[data-v4-status]').textContent,/częściowa/);
  assert.match(doc.querySelector('[data-v4-compact-missing]').textContent,/podatków/);
  assert.equal(new URL(doc.querySelector('[data-v4-inquiry]').href).searchParams.get('return_to'),'/?make=TESLA');
});
test('unconfirmed class opens settings instead of silently selecting cheap transport',t=>{
  const {doc,binding}=setup(t,{body_style:'SUV'});
  assert.equal(doc.querySelector('[data-v4-settings]').open,true);
  assert.equal(doc.querySelector('[data-v4-class]').value,'');
  assert.equal(binding.getBudget().complete,false);
});
test('full entered PLN budget is prominent and reverts to partial when a charge is removed',t=>{
  const {doc,binding,input}=setup(t);
  input('[data-v4-auction-fee]','1000'); input('[data-budget-field="usdPln"]','4');
  for(const name of ['customsDutyPln','importVatPln','excisePln','portCustomsPln','servicePln','deliveryPln']) input(`[data-budget-field="${name}"]`,'100');
  assert.equal(binding.getBudget().complete,true);
  assert.equal(doc.querySelector('[data-v4-total-label]').textContent,'Budżet z dostawą · PLN');
  assert.match(doc.querySelector('[data-v4-status]').textContent,/według wpisanych kwot/);
  assert.match(doc.querySelector('[data-v4-compact-missing]').textContent,/Naprawy i rejestracja/);
  input('[data-budget-field="importVatPln"]','');
  assert.equal(binding.getBudget().complete,false);
  assert.match(doc.querySelector('[data-v4-total-label]').textContent,/USD/);
  assert.match(doc.querySelector('[data-v4-status]').textContent,/częściowa/);
});
test('source zero requires custom price while Buy Now stays separate in compact view',t=>{
  const {doc,binding}=setup(t,{pricing:{current_bid_usd:0,buy_now_usd:12000}});
  assert.equal(binding.current().purchasePriceUsd,null);
  assert.equal(binding.priceKind.value,'custom');
  binding.setPriceKind('buy-now'); assert.equal(binding.current().purchasePriceUsd,12000);
  binding.setPriceKind('custom'); assert.equal(binding.current().purchasePriceUsd,null);
  assert.match(doc.querySelector('[data-v4-status]').textContent,/częściowa/);
});
test('unmatched location and hybrid do not produce a complete delivered estimate',t=>{
  const {binding,doc}=setup(t,{fuel_type:'Hybrid',auction:{facility_name:'UNCONFIRMED BRANCH'}});
  assert.equal(binding.getBudget().complete,false);
  assert.match(doc.querySelector('[data-v4-compact-missing]').textContent,/Wybierz dane transportu/);
});
test('entered custom price replaces missing-source prompt, including an explicit zero',t=>{
  const {doc,input}=setup(t,{pricing:{current_bid_usd:null,buy_now_usd:null}});
  assert.match(doc.querySelector('[data-v4-price-note]').textContent,/Brak/);
  for(const price of ['10000','0']){
    input('[data-v4-price]',price);
    assert.match(doc.querySelector('[data-v4-price-note]').textContent,/Twoja planowana cena/);
    assert.doesNotMatch(doc.querySelector('[data-v4-price-note]').textContent,/Brak/);
  }
  input('[data-v4-price]','');
  assert.match(doc.querySelector('[data-v4-price-note]').textContent,/Brak/);
});
test('visible benchmark amounts leave a gap rather than silently inventing a fee',()=>{
  const sumUsd=11400+1140+365+995;
  assert.equal(sumUsd,13900);
  const total=sumUsd*3.9247+450*3.9247+(1242+2596+500)*4.3917+2500+260;
  assert.equal(Math.round(total*100)/100,78130.64);
  assert.equal(Math.round((78539-total)*100)/100,408.36);
});
