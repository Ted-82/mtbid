const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cost = require("../public/rexbid-delivered-cost.js");
const rates = require("../public/rexbid-delivered-rates.js");

// Fixed, dated evidence fixtures only. Production must supply observed FX.
const base = {
  purchaseUsd:5000,platform:"copart",landUsd:485,seaUsd:995,
  usdPln:3.9247,eurPln:4.3917,fxDate:"2026-10-26",
  powertrain:"PHEV",engineCc:1300,exemptionConfirmed:true,
  deliveryPln:2300,translations:true,dangerousCargo:true
};
const cases = [
  ["copart",5000,485,885,7365,45795],
  ["copart",15000,485,1170,17650,99521],
  ["copart",25000,485,1770,28250,154892],
  ["iaai",5000,275,925,7195,44907],
  ["iaai",15000,275,1210,17480,98633],
  ["iaai",25000,275,1810,28080,154004]
];
for (const [platform,purchaseUsd,landUsd,fee,cif,total] of cases) {
  test(`dated screenshot benchmark: ${platform} ${purchaseUsd} USD`, () => {
    const result = cost.calculate({...base,platform,purchaseUsd,landUsd});
    assert.equal(result.complete,true,result.missing.join(" "));
    assert.equal(result.auctionFeeUsd,fee);
    assert.equal(result.customsUsd,cif);
    assert.equal(result.discountPln,250);
    assert.equal(result.excisePln,0);
    assert.ok(Math.abs(result.totalPln - (total - 250)) <= 2);
    assert.equal(result.totalPln,result.knownTotalPln);
    assert.equal(result.ratesVersion,rates.version);
  });
}

test("browser UMD exports use the same pure calculation", () => {
  const context = vm.createContext({});
  for (const file of ["rexbid-delivered-rates.js","rexbid-delivered-cost.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../public",file),"utf8"),context);
  }
  assert.ok(context.RexBidDeliveredRates);
  assert.ok(context.RexBidDeliveredCost);
  assert.equal(context.RexBidDeliveredCost.calculate(base).totalPln,cost.calculate(base).totalPln);
});

test("configuration is deeply immutable and calculation never changes inputs", () => {
  const before = JSON.stringify(base);
  cost.calculate(base);
  assert.equal(JSON.stringify(base),before);
  assert.ok(Object.isFrozen(rates.auction.copart.buyerBrackets[0]));
  assert.ok(Object.isFrozen(rates.taxes.excise));
});

test("all official buyer bands are contiguous and the final rate has no artificial ceiling", () => {
  const bands = rates.auction.copart.buyerBrackets;
  assert.equal(bands.length,45);
  assert.equal(bands[0].min,0);
  bands.slice(0,-1).forEach((band,index) => assert.equal(band.maxExclusive,bands[index+1].min));
  assert.equal(bands.at(-1).rate,0.06);
  assert.equal(bands.at(-1).maxExclusive,null);
  assert.equal(cost.auctionFee({...base,purchaseUsd:50000}).amountUsd,3270);
});

for (const [bid,expected] of [[49.99,111],[50,111],[99.99,111],[100,185],[499.99,295],[500,320],[3999.99,775],[4000,835],[4999.99,860],[5000,885],[5499.99,885],[5500,910],[5999.99,910],[6000,955],[7999.99,1030],[8000,1070],[11499.99,1120],[11500,1130],[12000,1145],[12500,1160],[14999.99,1160],[15000,1170],[25000,1770]]) {
  test(`Copart tier boundary ${bid}`, () => {
    assert.equal(cost.auctionFee({...base,purchaseUsd:bid}).amountUsd,expected);
  });
}

test("optional document pickup is charged once only when the profile includes it", () => {
  const custom = structuredClone(rates);
  custom.auction.copart.includeTitlePickup = true;
  assert.equal(cost.auctionFee(base,custom).amountUsd,905);
  assert.equal(cost.auctionFee(base).amountUsd,885);
});

for (const bid of [1,4999.99,25000.01,50000]) {
  test(`IAAI outside benchmark range ${bid} requires an override`, () => {
    const input = {...base,platform:"iaai",purchaseUsd:bid};
    assert.equal(cost.calculate(input).complete,false);
    assert.equal(cost.calculate(input).auctionFeeUsd,null);
    const manual = cost.calculate({...input,auctionFeeOverrideUsd:999});
    assert.equal(manual.complete,true);
    assert.equal(manual.auctionFeeUsd,999);
  });
}

test("IAAI interpolated tiers are labelled as indicative and never an official fee table", () => {
  const result = cost.auctionFee({...base,platform:"iaai",purchaseUsd:7500});
  assert.equal(result.amountUsd,1070);
  assert.equal(result.status,"estimate");
  assert.ok(result.assumptions.some(value => /nie oficjalną taryfą/.test(value)));
});

test("the six rows are a sum, not a hard-coded market total", () => {
  const result = cost.calculate(base);
  const sum = result.lineItems.reduce((total,item) => total + item.amount * (item.currency === "USD" ? base.usdPln : item.currency === "EUR" ? base.eurPln : 1),0);
  assert.ok(Math.abs(sum - result.totalPln) < 0.03);
  assert.equal(new Set(result.lineItems.map(item => item.id)).size,result.lineItems.length);
  assert.equal(result.customsUsd,base.purchaseUsd + 885 + base.landUsd + base.seaUsd);
  assert.equal(result.commissionGrossPln,2172.32);
  assert.equal(result.beforeDiscountPln - result.totalPln,250);
});

test("commission, domestic services and hazardous cargo do not count twice", () => {
  const a = cost.calculate(base);
  const b = cost.calculate({...base,commissionUsd:0,dangerousCargo:false,translations:false,deliveryPln:0});
  const expectedDifference = 450 * base.usdPln * 1.23 - 250 + 100 * base.usdPln + 260 + 2300;
  assert.ok(Math.abs((a.totalPln - b.totalPln) - expectedDifference) < 0.02);
  assert.equal(a.customsUsd,b.customsUsd);
  assert.equal(a.dutyPln,b.dutyPln);
  assert.equal(a.vatPln,b.vatPln);
});

test("discount is capped by our own gross service and never reduces customs taxes", () => {
  const custom = structuredClone(rates);
  custom.service.discountPln = 1000000;
  const result = cost.calculate({...base,commissionUsd:10},custom);
  assert.equal(result.discountPln,result.commissionGrossPln);
  assert.ok(result.totalPln >= 0);
  const noService = cost.calculate({...base,commissionUsd:0},custom);
  assert.equal(noService.discountPln,0);
  assert.equal(result.totalPln,noService.totalPln);
  assert.equal(result.customsUsd,noService.customsUsd);
  assert.equal(result.vatPln,noService.vatPln);
});

test("route and Poznań delivery defaults need explicit selection", () => {
  const input = {...base};
  delete input.seaUsd;
  delete input.deliveryPln;
  const missing = cost.calculate(input);
  assert.equal(missing.complete,false);
  assert.equal(missing.customsUsd,null);
  const selected = cost.calculate({...input,standardRoute:true,destination:"poznan"});
  assert.equal(selected.complete,true);
  assert.equal(selected.totalPln,cost.calculate(base).totalPln);
  assert.equal(cost.calculate({...input,standardRoute:"true",destination:"warszawa"}).complete,false);
});

test("dangerous cargo is never inferred from a hybrid name or turned on silently", () => {
  const input = {...base};
  delete input.dangerousCargo;
  assert.equal(cost.calculate(input).lineItems.find(item => item.id === "dangerousCargo").amount,0);
  delete input.translations;
  assert.equal(cost.calculate(input).lineItems.find(item => item.id === "translations").amount,260);
});

test("both delivery zones and branch overrides live in the versioned configuration", () => {
  const input = {...base};
  delete input.deliveryPln;
  const poznan = cost.calculate({...input,destination:"poznan"});
  const slaskie = cost.calculate({...input,destination:"slaskie"});
  assert.equal(slaskie.complete,true);
  assert.equal(slaskie.totalPln - poznan.totalPln,200);
  assert.deepEqual(rates.transportOverrides.map(item => [item.platform,item.location,item.state,item.landUsd,item.seaUsd]),[
    ["copart","TAMPA SOUTH","FL",485,995],
    ["iaai","SAYREVILLE","NJ",275,995]
  ]);
});

for (const [type,cc,rate] of [["ICE",2000,0.031],["ICE",2001,0.186],["HEV",1300,0.0155],["HEV",2000,0.0155],["HEV",2001,0.093],["HEV",3500,0.093],["HEV",3501,0.186],["PHEV",2001,0.093],["PHEV",3500,0.093],["PHEV",3501,0.186]]) {
  test(`correct excise for ${type} ${cc}cc`, () => {
    const result = cost.calculate({...base,powertrain:type,engineCc:cc,exciseBasePln:10000});
    assert.equal(result.complete,true);
    assert.equal(result.excisePln,10000 * rate);
  });
}

test("HEV is not exempt even if the exemption box is true", () => {
  const result = cost.calculate({...base,powertrain:"HEV",exciseBasePln:10000});
  assert.equal(result.excisePln,155);
});

for (const type of ["PHEV","BEV","FCEV"]) {
  test(`${type} requires explicit exemption evidence`, () => {
    for (const exemptionConfirmed of [false,undefined]) {
      const result = cost.calculate({...base,powertrain:type,exemptionConfirmed});
      assert.equal(result.complete,false);
      assert.equal(result.excisePln,null);
      assert.equal(result.totalPln,null);
      assert.ok(result.knownTotalPln > 0);
    }
    const eligible = cost.calculate({...base,powertrain:type,exemptionConfirmed:true});
    assert.equal(eligible.complete,true);
    assert.equal(eligible.excisePln,0);
  });
}

test("PHEV exemption is date bounded", () => {
  const lastDay = cost.calculate({...base,taxDate:"2029-12-31"});
  assert.equal(lastDay.excisePln,0);
  const expired = cost.calculate({...base,taxDate:"2030-01-01",exciseBasePln:10000});
  assert.equal(expired.excisePln,310);
});

test("unknown powertrain and missing combustion capacity are incomplete", () => {
  for (const powertrain of [undefined,"unknown","hybrid","",true]) {
    const result = cost.calculate({...base,powertrain});
    assert.equal(result.complete,false);
    assert.equal(result.excisePln,null);
  }
  for (const engineCc of [undefined,null,0,"",true,-1]) {
    const result = cost.calculate({...base,powertrain:"ICE",engineCc});
    assert.equal(result.complete,false);
    assert.equal(result.excisePln,null);
  }
  assert.equal(cost.calculate({...base,powertrain:"BEV",engineCc:undefined}).complete,true);
});

test("missing excise base is estimated; explicit zero never fakes an exemption", () => {
  const result = cost.calculate({...base,powertrain:"ICE",engineCc:1600});
  assert.ok(Math.abs(result.excisePln - (7365 * base.usdPln * 1.1 * 0.031)) < 0.01);
  const zero = cost.calculate({...base,powertrain:"ICE",engineCc:1600,exciseBasePln:0});
  assert.equal(zero.complete,false);
  assert.equal(zero.excisePln,null);
});

const numericFields = ["purchaseUsd","landUsd","seaUsd","usdPln","eurPln","deliveryPln","portEUR","commissionUsd","auctionFeeOverrideUsd","exciseBasePln"];
const invalidNumbers = [null,""," ",true,false,NaN,Infinity,-1,"-1","1,000","0x10",{},[]];
for (const field of numericFields) {
  test(`strict numeric validation of ${field}`, () => {
    for (const value of invalidNumbers) {
      const result = cost.calculate({...base,[field]:value});
      assert.equal(result.complete,false,`${field} ${String(value)}`);
      assert.equal(result.totalPln,null);
      assert.ok(result.missing.length > 0);
      assert.ok(Number.isFinite(result.knownTotalPln));
    }
  });
}

test("required positive values reject zero; explicit priced zero is preserved", () => {
  for (const field of ["purchaseUsd","usdPln","eurPln"]) assert.equal(cost.calculate({...base,[field]:0}).complete,false);
  for (const field of ["landUsd","seaUsd","deliveryPln","portEUR","commissionUsd","auctionFeeOverrideUsd"]) assert.equal(cost.calculate({...base,[field]:0}).complete,true,field);
  assert.equal(cost.calculate({...base,auctionFeeOverrideUsd:0}).auctionFeeUsd,0);
});

test("missing and invalid manual auction fees cannot silently fall back", () => {
  const absent = cost.calculate(base);
  assert.equal(absent.auctionFeeUsd,885);
  for (const value of ["",null,false,-100,NaN]) {
    const result = cost.calculate({...base,auctionFeeOverrideUsd:value});
    assert.equal(result.auctionFeeUsd,null);
    assert.equal(result.customsUsd,null);
    assert.equal(result.dutyPln,null);
    assert.equal(result.vatPln,null);
    assert.equal(result.totalPln,null);
  }
});

test("numeric decimal strings are accepted without accepting booleans or hex", () => {
  assert.equal(cost.calculate({...base,purchaseUsd:" 5000.00 ",usdPln:"3.9247"}).totalPln,cost.calculate(base).totalPln);
});

test("no FX or date defaults are invented", () => {
  for (const field of ["usdPln","eurPln","fxDate"]) {
    const input = {...base}; delete input[field];
    assert.equal(cost.calculate(input).complete,false);
  }
  for (const fxDate of ["2026-02-30","2026-13-01","26-10-2026","today",true,null,""]) {
    assert.equal(cost.calculate({...base,fxDate}).complete,false);
  }
  assert.equal(cost.calculate({...base,fxDate:"2028-02-29"}).complete,true);
});

test("option values require booleans", () => {
  for (const field of ["translations","dangerousCargo","exemptionConfirmed"]) {
    for (const value of ["true","false",1,0,null,""]) assert.equal(cost.calculate({...base,[field]:value}).complete,false,field);
  }
});

test("invalid profiles produce a missing estimate rather than NaN or a plausible total", () => {
  assert.equal(cost.calculate(base,null).complete,false);
  for (const mutate of [
    p => { p.taxes.importVatRate = true; },
    p => { p.taxes.dutyRate = -0.1; },
    p => { p.service.discountPln = -250; },
    p => { p.auction.copart.gateUsd = ""; },
    p => { p.auction.copart.buyerBrackets.push({min:5000,maxExclusive:5500,amount:1}); },
    p => { p.auction.copart.buyerBrackets.find(b => b.min === 5000).amount = null; }
  ]) {
    const custom = structuredClone(rates); mutate(custom);
    const result = cost.calculate(base,custom);
    assert.equal(result.complete,false);
    assert.equal(result.totalPln,null);
    assert.ok(Number.isFinite(result.knownTotalPln));
  }
});

test("unknown platform cannot be priced even with an arbitrary override", () => {
  for (const platform of [undefined,"",true,"manheim"]) assert.equal(cost.calculate({...base,platform,auctionFeeOverrideUsd:900}).complete,false);
  assert.equal(cost.calculate({...base,platform:" COPART "}).complete,true);
});

test("large arithmetic cannot return Infinity as a completed quote", () => {
  const result = cost.calculate({...base,purchaseUsd:Number.MAX_SAFE_INTEGER,usdPln:Number.MAX_SAFE_INTEGER});
  assert.equal(result.complete,false);
  assert.equal(result.totalPln,null);
  assert.ok(Number.isFinite(result.knownTotalPln));
});

test("empty or malformed inputs return an incomplete result without throwing", () => {
  for (const input of [undefined,null,false,"",[],42]) {
    assert.equal(cost.calculate(input).complete,false);
    assert.equal(cost.auctionFee(input).amountUsd,null);
    assert.equal(cost.excise(input).amountPln,null);
  }
});

test('manual customs value changes tax bases without changing purchase or transport costs',()=>{
 const input={...base,powertrain:'ICE',engineCc:2000,exemptionConfirmed:false};
 const automatic=cost.calculate(input),manual=cost.calculate({...input,customsValueUsd:6000});
 assert.equal(manual.complete,true);assert.equal(manual.customsUsd,6000);assert.equal(manual.customsValueSource,'manual');
 assert.equal(manual.calculatedCustomsUsd,automatic.customsUsd);
 assert.equal(manual.dutyPln,Math.round(6000*input.usdPln*.1*100)/100);
 assert.equal(manual.vatPln,Math.round(6000*input.usdPln*1.1*.21*100)/100);
 assert.ok(manual.excisePln<automatic.excisePln);
 for(const id of ['purchase','auction','land','sea','commission','delivery'])assert.deepEqual(manual.lineItems.find(x=>x.id===id),automatic.lineItems.find(x=>x.id===id));
 assert.ok(manual.assumptions.some(x=>x.includes('wpisana ręcznie')));
 assert.equal(cost.calculate(input).totalPln,automatic.totalPln);
});
test('invalid manual customs value stays incomplete rather than using zero tax or silently reverting',()=>{
 for(const value of ['',null,-1,0,'bad',Infinity]){
  const r=cost.calculate({...base,customsValueUsd:value});assert.equal(r.complete,false);assert.equal(r.customsUsd,null);assert.equal(r.dutyPln,null);assert.equal(r.vatPln,null);assert.equal(r.customsValueSource,'manual');assert.ok(r.missing.some(x=>x.includes('wartość celną')));
 }
 const missing=cost.calculate({...base,landUsd:''});const overridden=cost.calculate({...base,landUsd:'',customsValueUsd:6000});
 assert.equal(missing.customsUsd,null);assert.equal(overridden.complete,false);assert.ok(overridden.missing.some(x=>x.includes('transport')));assert.equal(overridden.customsUsd,6000);
});
