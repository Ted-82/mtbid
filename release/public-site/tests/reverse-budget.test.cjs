'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const cost=require('../public/rexbid-delivered-cost.js'),profile=require('../public/rexbid-delivered-rates.js');
const {vehicleSpecsResponse,normalize}=require('../providers/vehicle-specs.cjs');
const {JSDOM}=require('jsdom');
const vin='1FADP5AU8DL509002';
const input={platform:'iaai',landUsd:610,seaUsd:995,deliveryPln:2300,usdPln:3.9852,eurPln:4.407,fxDate:'2026-11-13',engineCc:2000,powertrain:'HEV',dangerousCargo:true};
const rows=[[25,151,16817],[525,360,20577],[1000,485,23760],[2000,650,29939],[5000,925,47310],[15000,1210,101864],[25000,1810,158088],[100000,6310,579770]];
for(const [purchaseUsd,fee,bidcars] of rows)test('Ford benchmark reconciles taxes and commission at $'+purchaseUsd,()=>{
 const result=cost.calculate({...input,purchaseUsd});assert.ok(result.complete);assert.equal(result.auctionFeeUsd,fee);
 // BidCars default excise base is zero. Keep our estimated excise and reconcile the stated gross commission.
 const comparable=result.totalPln-result.excisePln-2500+450*1.23*input.usdPln
   -result.dutyPln-result.vatPln+result.customsUsd*0.331*0.9042*input.eurPln;
 assert.ok(Math.abs(comparable-bidcars)<3,comparable+' vs '+bidcars);assert.ok(result.excisePln>0);
});
for(const platform of ['copart','iaai'])for(const budgetPln of [20000,30000,80000,150000,600000])test('reverse '+platform+' budget '+budgetPln+' is maximal and covered',()=>{
 const x={...input,platform,budgetPln,reservePln:1000};const result=cost.maximumBid(x);assert.ok(result.purchaseUsd>=1);
 assert.ok(result.totalPln<=budgetPln-1000);assert.equal(cost.calculate({...x,purchaseUsd:result.purchaseUsd}).totalPln,result.totalPln);
 if(result.purchaseUsd<100000)assert.ok(cost.calculate({...x,purchaseUsd:result.purchaseUsd+1}).totalPln>budgetPln-1000);
});
test('reverse rejects missing costs, invalid budgets, low budgets and manual tax bases',()=>{
 for(const budgetPln of ['',null,-1,0,Infinity])assert.equal(cost.maximumBid({...input,budgetPln}).purchaseUsd,null);
 assert.equal(cost.maximumBid({...input,budgetPln:500}).status,'insufficient');
 assert.equal(cost.maximumBid({...input,budgetPln:30000,landUsd:null}).status,'incomplete');
 assert.equal(cost.maximumBid({...input,budgetPln:30000,customsValueUsd:500}).status,'manual_costs');
 for(const field of ['dutyOverridePln','vatOverridePln','exciseOverridePln']){
   for(const amount of [0,500]){
     const fixed={...input,[field]:amount};
     assert.equal(cost.maximumBid({...fixed,budgetPln:50000}).status,'manual_costs');
     assert.equal(cost.calculate({...fixed,purchaseUsd:5000}).complete,true);
   }
 }
 assert.equal(cost.maximumBid({...input,budgetPln:30000,reservePln:30000}).status,'invalid_budget');
});
const row={VIN:vin,Make:'FORD',Model:'C-Max',ModelYear:'2013',DisplacementCC:'2000.0',ElectrificationLevel:'Strong HEV (Hybrid Electric Vehicle)',FuelTypePrimary:'Gasoline',FuelTypeSecondary:'Electric',ErrorCode:'0'};
const url='https://rexbid.pl/api/vehicle-specs?vin='+vin+'&year=2013';
test('VIN lookup uses fixed official URL, keeps no credentials and caches normalized data',async()=>{
 let calls=0,saved;const cache={match:async()=>saved?.clone(),put:async(k,r)=>{saved=r.clone();}};
 const opts={cache,fetchImpl:async(u,o)=>{calls++;assert.equal(u,'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/'+vin+'?format=json&modelyear=2013');assert.equal(o.headers.Authorization,undefined);assert.equal(o.redirect,'manual');return Response.json({Results:[row]});}};
 const a=await vehicleSpecsResponse(new Request(url,{headers:{Cookie:'private-session'}}),opts);assert.equal(a.status,200);const body=await a.json();assert.equal(body.engineCc,2000);assert.equal(body.powertrain,'HEV');
 await vehicleSpecsResponse(new Request(url),opts);assert.equal(calls,1);assert.match(a.headers.get('Cache-Control'),/2592000/);
});
test('VIN errors, identity mismatches, missing engine and uncertain hybrid are not invented',async()=>{
 for(const patch of [{VIN:'WAUDACF58SA018436'},{ModelYear:'2014'},{ErrorCode:'1'}])assert.throws(()=>normalize({Results:[{...row,...patch}]},vin,'2013'));
 const result=normalize({Results:[{...row,DisplacementCC:'',ElectrificationLevel:'',FuelTypeSecondary:'Electric'}]},vin,'2013');assert.equal(result.engineCc,null);assert.equal(result.powertrain,null);
 const bad=await vehicleSpecsResponse(new Request(url.replace(vin,'bad')),{fetchImpl:()=>{throw Error('should not call');},cache:null});assert.equal(bad.status,400);
 const timeout=await vehicleSpecsResponse(new Request(url),{fetchImpl:()=>new Promise(()=>{}),cache:null,timeoutMs:5});assert.equal(timeout.status,503);
});
function ui(t,{fetchSpecs,mode='budget',engine=null}={}){
 const dom=new JSDOM('<div id="mount"></div>',{url:'https://rexbid.pl/kalkulator-budzet',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
 for(const f of ['rexbid-calculator-v4-rates.js','rexbid-calculator-v4.js','rexbid-delivered-rates.js','rexbid-delivered-cost.js','rexbid-delivered-view.js'])w.eval(fs.readFileSync(path.join(__dirname,'../public',f),'utf8'));
 const vehicle={vin,year:2013,make:'FORD',title:'2013 FORD C-MAX HYBRID SE',lot_number:'46552401',platform:'iaai',body_style:'Hatchback',fuel_type:'Hybrid',engine_cc:engine,location:{display:'Buckhannon',state:'WV',postal_code:'26201'}};
 const binding=w.RexBidDeliveredView.bindCalculator({root:w.document.querySelector('#mount'),vehicle,fx:{ok:true,...input,effectiveDate:'2026-11-13'},mode,budgetPln:30000,fetchSpecs:fetchSpecs||(async()=>normalize({Results:[row]},vin,'2013'))});
 const q=x=>w.document.querySelector(x);const edit=(selector,value,event='input')=>{const node=q(selector);node.value=value;node.dispatchEvent(new w.Event(event,{bubbles:true}));};return {w,q,binding,edit};
}
test('Ford automatically fills engine and hybrid and converts PLN budget to a complete bid',async t=>{
 const a=ui(t);await a.binding.ready;assert.equal(a.q('[data-estimate-field="engineCc"]').value,'2000');assert.equal(a.q('[data-estimate-powertrain]').value,'HEV');assert.equal(a.q('[data-estimate-field="landUsd"]').value,'610');
 assert.ok(a.binding.getBudget().complete);const first=a.binding.getMaximumBid();assert.ok(first.totalPln<=30000);assert.ok(first.purchaseUsd>1000&&first.purchaseUsd<2000);
 a.binding.setBudget(40000);assert.ok(a.binding.getMaximumBid().purchaseUsd>first.purchaseUsd);
 assert.match(a.q('[data-estimate-budget]').textContent,/40\s*000/);
 a.edit('[data-estimate-mode]','forward','change');a.edit('[data-estimate-field="purchaseUsd"]',2000);assert.equal(a.binding.getBudget().totalPln,cost.calculate({...input,purchaseUsd:2000}).totalPln);
});
test('async specifications never overwrite user edits and failed lookup leaves honest partial result',async t=>{
 let done;const a=ui(t,{fetchSpecs:()=>new Promise(r=>done=r)});await new Promise(r=>setImmediate(r));a.edit('[data-estimate-field="engineCc"]',1998);a.edit('[data-estimate-powertrain]','ICE','change');done(normalize({Results:[row]},vin,'2013'));await a.binding.ready;assert.equal(a.q('[data-estimate-field="engineCc"]').value,'1998');assert.equal(a.q('[data-estimate-powertrain]').value,'ICE');
 const b=ui(t,{fetchSpecs:async()=>{throw Error('unavailable');}});await b.binding.ready;assert.equal(b.binding.getMaximumBid().status,'incomplete');assert.equal(b.q('[data-estimate-bid]').textContent,'—');
});
test('unknown or conflicting route cannot become a complete reverse result',async t=>{
 const a=ui(t);await a.binding.ready;a.edit('[data-estimate-field="landUsd"]','');assert.equal(a.binding.getMaximumBid().status,'incomplete');a.edit('[data-estimate-field="landUsd"]',610);a.edit('[data-estimate-field="customsValueUsd"]',1);assert.equal(a.binding.getMaximumBid().status,'manual_costs');
});
