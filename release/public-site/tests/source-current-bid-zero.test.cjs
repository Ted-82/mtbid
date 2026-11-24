'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function block(source,name){const start=source.indexOf(`  function ${name}(`);assert.ok(start>=0,name);const next=/\n  (?:async )?function \w+\(/.exec(source.slice(start+1));assert.ok(next);return source.slice(start,start+1+next.index);}
test('catalog and homepage reject legacy source0 while preserving positive25 and secondary bids',()=>{
 const source=read('public/index.html'),ctx={formatMoney:value=>'$'+value};vm.createContext(ctx);vm.runInContext(['hasApprovalPendingOutcome','getPriceInfo','marketAislePriceInfo'].map(name=>block(source,name)).join('\n')+';globalThis.api={price:getPriceInfo,aisle:marketAislePriceInfo};',ctx);
 for(const zero of [0,'0','0.00',null]){const car={auction:{state:'open'},pricing:{current_bid_usd:zero,current_bid2_usd:950}};assert.equal(ctx.api.price(car).value,null);assert.equal(ctx.api.aisle(car,'current').value,null);assert.equal(ctx.api.aisle(car,'buy-now').secondary,'');}
 for(const pricing of [{current_bid_usd:25},{current_bid2_usd:25}])assert.equal(Number(ctx.api.price({auction:{state:'open'},pricing}).value),25);
 assert.equal(ctx.api.price({auction:{state:'sold'},pricing:{current_bid_usd:0,sale_price_usd:1200}}).value,1200);
});
test('vehicle source bid selector returns unavailable0 and never steals final price or positive alternate',()=>{
 for(const page of ['public/car.html','car.html']){const ctx={car:{pricing:{current_bid_usd:0}}};vm.createContext(ctx);vm.runInContext(block(read(page),'getCurrentBid')+';globalThis.bid=getCurrentBid;',ctx);assert.equal(ctx.bid(),null,page);ctx.car.pricing={current_bid_usd:0,current_bid2_usd:25};assert.equal(ctx.bid(),null);ctx.car.pricing={current_bid_usd:null,current_bid2_usd:25};assert.equal(ctx.bid(),null);ctx.car.pricing={current_bid2_usd:25};assert.equal(Number(ctx.bid()),25);ctx.car.pricing={current_bid_usd:null,final_price_usd:5000};assert.equal(ctx.bid(),null);}
});
test('comparison and favorites never format source0 as free car; mileage0 and positive prices stay valid',()=>{
 const saved=require('../public/rexbid-saved-vehicles.js'),compare=require('../public/rexbid-compare.js');const car={auction:{state:'open'},pricing:{current_bid_usd:0},odometer:{value:0,unit:'mi'}};
 assert.equal(saved.facts(car).amount,null);assert.doesNotMatch(JSON.stringify(compare.facts(car)),/"0 USD"/);assert.match(JSON.stringify(compare.facts(car)),/0 mi/);
 car.pricing.current_bid2_usd=25;assert.equal(saved.facts(car).amount,null);delete car.pricing.current_bid_usd;assert.equal(saved.facts(car).amount,25);assert.match(JSON.stringify(compare.facts(car)),/25 USD/);
});
test('calculator source0 disables current preset but user custom0 survives source refresh and positive25 restores current',t=>{
 const dom=new JSDOM('<section id="importCalculator"><div id="mount"></div></section>',{url:'https://rexbid.pl/car',runScripts:'outside-only'});t.after(()=>dom.window.close());const win=dom.window;for(const name of ['rexbid-calculator-v4-rates.js','rexbid-calculator-v4.js'])win.eval(read('public/'+name));
 const bind=win.RexBidCalculatorV4.bindCalculator({root:win.document.getElementById('mount'),vehicle:{platform:'copart',pricing:{current_bid_usd:0,current_bid2_usd:950}}}),option=bind.priceKind.querySelector('[value="current"]');
 assert.equal(bind.priceKind.value,'custom');assert.equal(bind.priceInput.value,'');assert.equal(option.disabled,true);
 bind.priceInput.value='0';bind.priceInput.dispatchEvent(new win.Event('input'));bind.updateMarketPrices({currentBid:0});assert.equal(bind.priceKind.value,'custom');assert.equal(bind.priceInput.value,'0');
 bind.updateMarketPrices({currentBid:25});assert.equal(option.disabled,false);bind.setPriceKind('current');assert.equal(bind.priceInput.value,'25');bind.updateMarketPrices({currentBid:0});assert.equal(option.disabled,true);assert.equal(bind.priceKind.value,'custom');
});
