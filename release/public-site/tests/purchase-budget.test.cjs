'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const dir=path.join(__dirname,'../public');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const vin='WBX13EF09S5386118';
const record=(platform='copart',lot='72915826')=>({platform,lot_number:lot,vin,title:'2025 BMW X1',
  engine_size_l:2,body_style:'SUV',fuel_type:'Gasoline',
  location:platform==='copart'?{auction_location:'Tampa South',state:'FL',country:'US'}:{auction_location:'Sayreville',state:'NJ',country:'US'},
  auction:{state:'open'},pricing:{current_bid_usd:8000}});
const check=async fn=>{
 for(let t=0;t<30;t++){if(fn())return;await new Promise(r=>setImmediate(r));}
 assert.ok(fn(),'UI did not reach the expected state');
};
function setup(t,list,details){
 const dom=new JSDOM(read('kalkulator-budzet.html'),{runScripts:'outside-only',url:'https://rexbid.pl/kalkulator-budzet'});
 t.after(()=>dom.window.close());
 const w=dom.window,d=w.document,requests=[];
 w.fetch=async url=>{
  requests.push(String(url));
  const route=new URL(url,w.location.href);
  const data=route.pathname==='/api/cars'?list:details[route.pathname.split('/').at(-1)];
  return {ok:true,json:async()=>route.pathname==='/api/exchange-rates'?{ok:true,usdPln:3.9247,eurPln:4.3917,effectiveDate:'2026-11-16'}:{ok:true,data}};
 };
 for(const file of ['rexbid-market.js','rexbid-powertrain.js','rexbid-calculator-v4-rates.js','rexbid-calculator-v4.js',
  'rexbid-delivered-rates.js','rexbid-delivered-cost.js','rexbid-delivered-view.js','rexbid-purchase-budget.js'])w.eval(read(file));
 const form=d.querySelector('[data-purchase-form]');
 const q=selector=>d.querySelector(selector);
 return {w,q,requests,search(value,platform=''){form.elements.identifier.value=value;form.elements.platform.value=platform;form.dispatchEvent(new w.Event('submit',{cancelable:true}));},
  price(value){const mode=q('[data-estimate-mode]');mode.value='forward';mode.dispatchEvent(new w.Event('change',{bubbles:true}));const node=q('[data-v4-price]');node.value=String(value);node.dispatchEvent(new w.Event('input',{bubbles:true}));}};
}
for(const [platform,lot,term] of [['copart','72915826','72915826'],['iaai','45152104',vin]]){
 test('the budget page loads an exact '+platform+' offer and calculates from the entered price',async t=>{
  const car=record(platform,lot),other={...record(),lot_number:'78787878',vin:'1HGCM82633A004352'};
  const u=setup(t,[other,car],{[lot]:car});
  u.search(term,platform);
  await check(()=>u.q('[data-v4-price]'));
  assert.match(u.q('[data-purchase-identity]').textContent,new RegExp(lot));
  assert.equal(u.q('[data-v4-price]').value,'');
  assert.equal(u.q('[data-v4-price-kind]').value,'custom');
  await check(()=>u.requests.includes('/api/exchange-rates'));
  u.price(12000);
  await check(()=>u.q('[data-estimate-title]').textContent==='Szacowana cena pod dom');
  const charges=u.q('[data-estimate-services-lines]').textContent.replace(/\s+/g,' ');
  assert.match(charges,/Prowizja REXBID brutto\s*2\s?500/);
  assert.doesNotMatch(u.q('[data-purchase-calculator]').textContent,/rabat/i);
  const url=new URL(u.q('[data-v4-inquiry]').href);
  assert.equal(url.searchParams.get('purchase_usd'),'12000');
  assert.equal(url.searchParams.get('lot'),lot);
  assert.equal(url.searchParams.get('platform'),platform);
  assert.equal(url.searchParams.get('budget_status'),'complete');
  assert.ok(Number(url.searchParams.get('budget_pln'))>2500);
 });
}
test('multiple lots matching one VIN require a selection, and inconsistent detail is rejected',async t=>{
 const a=record(),b=record('iaai','45152104');
 const u=setup(t,[a,b],{[b.lot_number]:{...b,vin:'1HGCM82633A004352'}});
 u.search(vin.toLowerCase());
 await check(()=>u.q('[data-purchase-matches]').children.length===2);
 assert.ok(!u.requests.some(x=>x.startsWith('/api/car/')));
 u.q('[data-purchase-matches]').lastElementChild.click();
 await check(()=>u.q('[data-purchase-status]').textContent.includes('nie potwierdził'));
 assert.ok(u.q('[data-purchase-selected]').hidden);
});
test('incorrect identifiers and unrelated search results do not open a calculator',async t=>{
 const u=setup(t,[record()],{});
 u.search('test');
 assert.match(u.q('[data-purchase-status]').textContent,/Wpisz pełny VIN/);
 assert.equal(u.requests.length,0);
 u.search('99999999');
 await check(()=>/Brak dokładnie pasującej/.test(u.q('[data-purchase-status]').textContent));
 assert.ok(u.q('[data-purchase-selected]').hidden);
});

test('a missing calculator module gives the customer a readable recovery action',async t=>{
  const car=record(),u=setup(t,[car],{[car.lot_number]:car});
  u.w.RexBidDeliveredView=undefined;
  u.search(car.lot_number,'copart');
  await check(()=>u.q('[data-purchase-status]').textContent.includes('Odśwież stronę'));
  assert.equal(u.q('[data-purchase-selected]').hidden,true);
});

test('a retained exact lot is reachable without advertising a bid after leaving the active list', async t=>{
  const car=record(), u=setup(t,[],{[car.lot_number]:car});
  u.search(car.lot_number,'copart');
  await check(()=>u.q('[data-purchase-matches] a'));
  const link=new URL(u.q('[data-purchase-matches] a').href);
  assert.equal(link.searchParams.get('lot'),car.lot_number);
  assert.equal(link.searchParams.get('platform'),'copart');
  assert.match(u.q('[data-purchase-status]').textContent,/nie potwierdza obecnie możliwości licytacji/);
  assert.equal(u.q('[data-purchase-selected]').hidden,true);
  assert.equal(u.requests.length,2);
});

test('ending between search and detail suppresses the suggested bid', async t=>{
  const car=record(), ended={...car,auction:{phase:'finished',state:'finished'}};
  const u=setup(t,[car],{[car.lot_number]:ended});
  u.search(car.lot_number,'copart');
  await check(()=>u.q('[data-purchase-matches] a'));
  assert.match(u.q('[data-purchase-status]').textContent,/Aukcja zakończona/);
  assert.equal(u.q('[data-purchase-selected]').hidden,true);
});

test('a listed open vehicle keeps its budget simulation with a dated notice when the saved details are stale', async t=>{
  const car=record(), old={...car,read:{source:'d1',freshness:'stale',catalog_scope:'active',last_synced_at:'2026-10-27T14:56:47Z'}};
  const u=setup(t,[old],{[car.lot_number]:old});
  u.search(car.lot_number,'copart');
  await check(()=>!u.q('[data-purchase-selected]').hidden);
  assert.match(u.q('[data-purchase-status]').textContent,/Symulacja według zapisanych danych z 27\.10\.2026/);
  assert.match(u.q('[data-purchase-status]').textContent,/potwierdzenia przed licytacją/);
});

test('the retained lookup rejects mismatched identity and missing platform without guessing', async t=>{
  const car=record(), u=setup(t,[],{[car.lot_number]:{...car,platform:'iaai'}});
  u.search(car.lot_number);
  await check(()=>/Wybierz platformę/.test(u.q('[data-purchase-status]').textContent));
  assert.equal(u.requests.length,1);
  u.search(car.lot_number,'copart');
  await check(()=>/nie potwierdził tożsamości/.test(u.q('[data-purchase-status]').textContent));
  assert.equal(u.q('[data-purchase-matches] a'),null);
  assert.equal(u.q('[data-purchase-selected]').hidden,true);
});

test('customer budget follows the selected offer separately from the estimated total and disappears in forward mode',async t=>{
  const car=record(),u=setup(t,[car],{[car.lot_number]:car});
  u.q('[name=budget]').value='100000';
  u.search(car.lot_number,'copart');
  await check(()=>u.q('[data-v4-inquiry]'));
  let link=new URL(u.q('[data-v4-inquiry]').href);
  assert.equal(link.hash,'#customer_budget_pln=100000');assert.equal(link.searchParams.has('customer_budget_pln'),false);
  u.price(10000);link=new URL(u.q('[data-v4-inquiry]').href);
  assert.equal(link.hash,'');assert.equal(link.searchParams.get('purchase_usd'),'10000');
});

test('changing the budget after choosing a car recalculates the limit without another lookup', async t => {
  const car = record(), u = setup(t, [car], {[car.lot_number]: car});
  const field = u.q('[name=budget]');
  field.value = '30000';
  u.search(car.lot_number, 'copart');
  await check(() => u.q('[data-estimate-bid]')?.textContent.match(/USD/));
  const first = u.q('[data-estimate-bid]').textContent;
  const requests = u.requests.length;
  field.value = '50000';
  field.dispatchEvent(new u.w.Event('input', {bubbles:true}));
  assert.notEqual(u.q('[data-estimate-bid]').textContent, first);
  assert.equal(u.requests.length, requests);
  assert.match(u.q('[data-v4-inquiry]').href, /#customer_budget_pln=50000$/);
});
