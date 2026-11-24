const test=require('node:test'),assert=require('node:assert/strict');
const transport=require('../public/rexbid-calculator-v4.js'),rates=require('../public/rexbid-calculator-v4-rates.js');
const cost=require('../public/rexbid-delivered-cost.js');
test('Copart state prefix disambiguates Sacramento shared ZIP without selecting another branch',()=>{
 const x={platform:'copart',auction_location:'CA - SACRAMENTO',state:'CA',postal_code:'95828'};
 const matched=transport.matchingLocation(rates,x);assert.equal(matched.status,'exact_branch_state_zip');assert.match(matched.row.auction_location,/^SACRAMENTO/);assert.equal(matched.row.rates[matched.row.preferred_terminal_id],455);
 assert.notEqual(transport.matchingLocation(rates,{...x,auction_location:'CA - UNKNOWN'}).status,'exact_branch_state_zip');
 assert.notEqual(transport.matchingLocation(rates,{...x,postal_code:'90001'}).status,'exact_branch_state_zip');
 assert.notEqual(transport.matchingLocation(rates,{...x,state:'FL'}).status,'exact_branch_state_zip');
});
test('VIN electric estimate is explicitly distinguished from verified paperwork and cannot exempt hybrid',()=>{
 const x={powertrain:'BEV',exemptionBasis:'vin_electric_estimate',exciseBasePln:10000,taxDate:'2026-11-16'};
 assert.equal(cost.excise(x,cost.rates).amountPln,0);assert.match(cost.excise(x,cost.rates).assumptions.join(),/Dokumenty zwolnienia nie zostały zweryfikowane/);
 assert.equal(cost.excise({...x,exemptionBasis:undefined},cost.rates).amountPln,null);
 assert.equal(cost.excise({...x,powertrain:'HEV',engineCc:1800},cost.rates).amountPln,155);
});
test('insufficient budget includes actual minimum with reserve and commission stays 2500',()=>{
 const x={platform:'iaai',landUsd:475,seaUsd:995,deliveryPln:2300,usdPln:3.9852,eurPln:4.407,fxDate:'2026-11-13',engineCc:1500,powertrain:'ICE',budgetPln:5000,reservePln:1000};
 const result=cost.maximumBid(x);assert.equal(result.status,'insufficient');assert.equal(result.minimumBudgetPln,cost.calculate({...x,purchaseUsd:1}).totalPln+1000);assert.equal(cost.calculate({...x,purchaseUsd:1}).commissionGrossPln,2500);
});
