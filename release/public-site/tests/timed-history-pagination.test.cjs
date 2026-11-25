'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {merge, decode} = require('../sync/catalog-history-read.cjs');

// Synthetic history fixture, including two distinct Timed cycles on the same calendar day.
const identity = {listing_id:'listing-1', platform:'iaai', lot:'99900001', vin:'1REXB1DH300000001'};
const car = fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');
const market = fs.readFileSync(path.join(__dirname,'../public/rexbid-market.js'),'utf8');
const sold = (tag,time) => ({...identity, kind:'confirmed_auction_event', provider:'apibara', status:'Sold',
  source_status:'Sold', result_confirmed:true, timed_cycle_verified:true, event_key:'feed-timed-result:v1:'+tag.repeat(64),
  auction_date:time, sale_date:'2026-11-24', final_price:12700, observed_at:'2026-11-25T00:42:43Z'});
const first = sold('a','2026-11-24T20:10:00Z');
const second = sold('b','2026-11-24T23:59:00Z');
const corroboration = {...second, event_key:'history-2026-11-24-2', timed_cycle_verified:false,
  auction_date:'2026-11-25T00:59:00+01:00', seller:'Test insurer'};
const dayOnly = {...corroboration, event_key:'history-day-only', auction_date:'2026-11-24', seller:null};
const toBody = (history,next_cursor=null) => ({ok:true,identity,history,rex_history:{snapshots:[]},
  meta:{next_cursor,history_availability:{state:'stored',complete:true}},read:{}});
const start = {a:null,b:null,ad:false,bd:false};
const block = (firstName, lastName) => car.slice(car.indexOf(firstName),car.indexOf(lastName,car.indexOf(firstName)));

async function openCard(pages) {
  const view = new JSDOM('<div id="auctionHistory"></div><button id="loadOlderAuctionHistory"></button>',
    {url:'https://test.invalid/car',runScripts:'outside-only'});
  const w = view.window, button = w.document.querySelector('button'), seen=[];
  w.eval(market);
  Object.assign(w,{car:{platform:identity.platform},getLot:()=>identity.lot,getVin:()=>identity.vin,platformName:()=>identity.platform,
    isEmpty:x=>x==null||x==='',displayValue:x=>x?.name??x,esc:s=>String(s),money:s=>'$'+s,formatDate:s=>s,API_BASE:'/api',
    auctionHistoryAvailability:{state:'stored'},auctionHistoryNextCursor:null,auctionHistoryLoading:false,
    auctionHistoryRecords:[], observedHistoryRecords:[],auctionHistorySeenCursors:new Set(),updateAuctionUi(){},updateForecastFromCalculator(){},
    fetch:async uri=>{seen.push(new URL(uri,w.location.href));assert.ok(pages.length);return Response.json(pages.shift());}});
  w.eval(block('  function historyField(','  function getAuctionDisplayDate(') +
    block('  async function fetchAuctionHistory()','  function auctionRefreshIntervalMs(') +
    '\nwindow.begin=fetchAuctionHistory; window.older=loadOlderAuctionHistory;');
  // Exercise the real load-more handler and all normalizers and renderers.
  let finished;
  button.addEventListener('click',()=>{finished=w.older();});
  await w.begin();
  return {rows:()=>[...w.document.querySelectorAll('#auctionHistory tbody tr')].map(tr=>tr.textContent),
    count:()=>w.document.querySelector('.history-count').textContent, button, seen, close:()=>w.close(),
    async more(){button.click();await finished;}};
}
for(const longer of ['active','legacy']) test('keeps two real sales on the same day when only the '+longer+' database has more snapshots',async t=>{
  const feed = toBody([first,second],longer==='active'?'current-next':null);
  const rest = toBody([corroboration,dayOnly],longer==='legacy'?'old-next':null);
  const initial = merge(feed,rest,start);
  const next = merge(longer==='active'?toBody([first,second]):null,longer==='legacy'?toBody([corroboration,dayOnly]):null,
    decode(initial.meta.next_cursor));
  const card=await openCard([initial,next]);t.after(card.close);
  assert.equal(card.rows().filter(row=>row.includes('Cena końcowa')).length,2,'two distinct auction times');
  assert.equal(card.rows().filter(row=>row.includes('Odczyt kwoty bez przypisanej aukcji')).length,1);
  assert.equal(card.button.hidden,false);
  await card.more();
  assert.equal(card.seen.length,2);
  assert.equal(card.button.hidden,true);
  assert.equal(card.rows().filter(row=>row.includes('Cena końcowa')).length,2,'REST corroboration must not become a third sale');
  assert.equal(card.rows().filter(row=>row.includes('Odczyt kwoty bez przypisanej aukcji')).length,1);
  assert.match(card.count(),/Zapisane wydarzenia aukcyjne:\s*2\b/);
  assert.match(card.count(),/Odczyty bez przypisanej aukcji:\s*1\b/);
  assert.equal(card.rows().filter(row=>row.includes('Test insurer')).length,1,'retain the corroborated seller');
  assert.match(card.rows()[0],/Test insurer/,'the later auction comes first, even on the same calendar day');
});
for(const feedFirst of [true,false]) test('reconciles delayed source availability with '+(feedFirst?'feed first':'REST first'),async t=>{
  const feed=toBody([first,second]),rest=toBody([corroboration,dayOnly]);
  const initial=merge(feedFirst?feed:null,feedFirst?null:rest,start);
  const next=merge(feedFirst?null:feed,feedFirst?rest:null,decode(initial.meta.next_cursor));
  const card=await openCard([initial,next]);t.after(card.close);
  await card.more();
  assert.equal(card.rows().filter(row=>row.includes('Cena końcowa')).length,2);
  assert.equal(card.rows().filter(row=>row.includes('Odczyt kwoty bez przypisanej aukcji')).length,1);
  assert.equal(card.rows().filter(row=>row.includes('Test insurer')).length,1);
  assert.match(card.count(),/Zapisane wydarzenia aukcyjne:\s*2\b/);
});
test('two precisely timed native results without event keys and a conditional offer survive a continuation',async t=>{
  const native = e=>({...e,event_key:null,timed_cycle_verified:false});
  const pending = {...corroboration,event_key:'conditional',status:'Sold on Approval',source_status:'Sold on Approval',result_confirmed:false};
  const card=await openCard([toBody([native(first)],'older'),toBody([native(second),pending])]);t.after(card.close);
  await card.more();
  assert.equal(card.rows().filter(row=>row.includes('Cena końcowa')).length,2);
  assert.equal(card.rows().filter(row=>row.includes('Oferta warunkowa')).length,1);
  assert.match(card.count(),/Zapisane wydarzenia aukcyjne:\s*3\b/);
});

