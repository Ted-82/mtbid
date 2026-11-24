'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const site = path.resolve(process.argv[2]);
const pw = require(process.argv[3]);
const {replayBid} = require(path.join(site,'staging/timed-bid-replay.cjs'));
const {vehiclePage} = require(path.join(site,'sync/vehicle-page.cjs'));
const target = 'https://rexbid-lokalna-proba.invalid';
const evidence = replayBid();
const car = {platform:'iaai',lot_number:evidence.lot,vin:evidence.vin,title:'2018 AUDI S5',year:2018,make:'AUDI',model:'S5',
  auction:{state:'open',lot_status:'Timed',is_timed:true,phase:'scheduled',timed_end_at:'2026-11-24T23:59:00Z'},
  pricing:{current_bid_usd:evidence.bid,current_bid_source:'apibara_feed',current_bid_observed_at:evidence.observedAt,final_price_usd:evidence.finalPrice},
  read:{source:'d1',freshness:'fresh',last_synced_at:'2026-11-24T20:01:32.326Z'},media:{thumbs:[],items:[]}};
const payload = {ok:true,data:car};
const detail = async () => vehiclePage(new Request('https://rexbid.pl/car?platform=iaai&lot='+car.lot_number+'&vin='+car.vin),{
  read:async()=>Response.json(payload),
  render:async()=>new Response(fs.readFileSync(path.join(site,'public/car.html'),'utf8'),{headers:{'Content-Type':'text/html'}})
});
(async()=>{
 const browser=await pw.chromium.launch({channel:'chrome',headless:true});
 const results={clock:'2026-11-24T20:48:34.300Z',kind:'Lokalne odtworzenie rekordu i odpowiedzi. Interfejs kandydata. Bez ruchu zewnętrznego.',source:evidence,runs:[]};
 try {
  for(const size of [{width:390,height:844},{width:1366,height:768}]){
   const ctx=await browser.newContext({viewport:size,locale:'pl-PL',timezoneId:'Europe/Warsaw'});
   await ctx.route('**/*',async r=>{
    const url=new URL(r.request().url()),p=url.pathname;
    if(url.origin!==target||r.request().method()!=='GET')return r.abort();
    if(p==='/car')return r.fulfill({contentType:'text/html',body:await (await detail()).text()});
    if(p.startsWith('/api/car/')&&p.endsWith('/history'))return r.fulfill({json:{ok:true,data:[],meta:{}}});
    if(p.startsWith('/api/car/'))return r.fulfill({json:payload});
    if(p.startsWith('/api/cars'))return r.fulfill({json:{ok:true,data:[car],meta:{}}});
    if(p.startsWith('/api/'))return r.fulfill({json:{ok:true,enabled:false,data:{},meta:{}}});
    const publicRoot=path.join(site,'public'), filename=path.resolve(publicRoot,'.'+(p==='/'?'/index.html':p));
    if(!filename.startsWith(publicRoot+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return r.fulfill({status:404,body:''});
    const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
    return r.fulfill({contentType:types[path.extname(filename)]||'application/octet-stream',body:fs.readFileSync(filename)});
   });
   const p=await ctx.newPage();await p.clock.setFixedTime(new Date(results.clock));
   await p.goto(target+'/car?platform=iaai&lot='+car.lot_number+'&vin='+car.vin);
   const item={size};results.runs.push(item);
   const timing=p.locator('#bidObservation');
   await timing.waitFor({timeout:15000});
   item.card={bid:await p.locator('#currentBidPrice').innerText(),observed:await timing.innerText(),snapshot:await p.locator('#auctionPriceNote').innerText(),title:await p.locator('h1:visible').first().innerText()};
   assert.match(item.card.bid,/8,100/);assert.match(item.card.observed,/21:07:24/);assert.match(item.card.snapshot,/21:01/);
   await p.goto(target+'/?catalog=1&lot_status=Timed');
   const listed=p.locator('#cars .car-card').filter({hasText:car.lot_number}).first();await listed.waitFor();
   item.list={observation:await listed.locator('small.card-secondary-price').innerText(),bid:await listed.locator('.car-bottom').innerText(),snapshot:await listed.locator('.card-saved-note').innerText()};
   assert.match(item.list.observation,/21:07:24/);assert.match(item.list.snapshot,/21:01/);
   await ctx.close();
  }
 }finally{await browser.close();fs.writeFileSync(path.join(__dirname,'TIMED-CZAS-INTERFEJS.json'),JSON.stringify(results,null,2)+'\n');}
 console.log(JSON.stringify(results.runs));
})().catch(err=>{console.error(err.message);process.exitCode=1;});
