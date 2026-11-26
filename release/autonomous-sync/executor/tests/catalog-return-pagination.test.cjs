'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.REXBID_TEST_ROOT||path.resolve(__dirname,'..');
const {JSDOM}=require(root+'/node_modules/jsdom');
const market=require(root+'/public/rexbid-market.js');
const navigation=require(root+'/public/rexbid-car-navigation.js');
const html=fs.readFileSync(process.env.REXBID_HTML||root+'/public/index.html','utf8');
const inline=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(match=>!/\bsrc=/.test(match[1]))[2];
const startup=inline.lastIndexOf('  restoreFiltersFromUrl();');
const KEY='rexbid.catalog-return.v1';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function car(lot,extra={}){
 return {title:'2023 POLESTAR 2',year:2023,vin:'YSMFD3KA5PL123456',lot_number:String(lot),platform:'copart',
  auction:{state:'open',schedule_status:'unassigned'},pricing:{current_bid_usd:0,buy_now_usd:null},...extra};
}
const firstPage=()=>Array.from({length:20},(_,i)=>car(71416916+i));
const response=(data,next=null)=>({ok:true,data,meta:{next_cursor:next}});
function saved(pages=2,extra={}){
 return {version:1,route:'/?catalog=1&make=POLESTAR',pages,scrollY:2480,savedAt:Date.now(),...extra};
}
function page(t,{url='/?catalog=1&make=POLESTAR',storage=new Map(),state=null,storageBlocked=false}={}){
 const dom=new JSDOM(html,{url:'https://rexbid.pl'+url,runScripts:'outside-only'});
 t.after(()=>dom.window.close());
 const win=dom.window,doc=win.document,requests=[],scrolls=[],removed=[];
 win.RexBidMarket=market;
 win.RexBidStorage={safeImageUrl:()=>'',isFavorite:()=>false,refreshCounts(){}};
 win.matchMedia=()=>({matches:true});
 win.scrollTo=options=>{scrolls.push(options);win.scrollY=options.top;};
 win.requestAnimationFrame=callback=>callback();
 win.HTMLElement.prototype.scrollIntoView=function(){};
 Object.defineProperty(win,'localStorage',{get(){throw Error('Unexpected persistent storage access');}});
 Object.defineProperty(win,'sessionStorage',storageBlocked?{get(){throw Error('Storage unavailable');}}:{value:{
  getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),
  removeItem:key=>{removed.push(key);storage.delete(key);}
 }});
 if(state)win.history.replaceState(state,'',win.location.href);
 let respond=()=>response(firstPage(),'page-2');
 win.fetch=async(url,options)=>{
  const parsed=new URL(url,'https://rexbid.pl');
  assert.equal(parsed.origin,'https://rexbid.pl');assert.equal(parsed.pathname,'/api/cars');
  requests.push({url,options});
  return new Response(JSON.stringify(await respond(parsed,options)),{headers:{'content-type':'application/json'}});
 };
 win.console.error=()=>{};win.console.warn=()=>{};
 doc.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();});
 win.eval(inline.slice(0,startup)+'\n;globalThis.catalogApi={load:loadCars,restoreFilters:restoreFiltersFromUrl,save:saveCatalogHistory,restoreView:restoreCatalogView,restoreHistory:restoreCatalogHistory};');
 win.catalogApi.restoreFilters();
 return {win,doc,requests,scrolls,storage,removed,api:win.catalogApi,node:id=>doc.getElementById(id),respond(fn){respond=fn;}};
}
function catalogClock(p){
 const timers=new Map();let serial=0;
 p.win.setTimeout=(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});return id;};
 p.win.clearTimeout=id=>timers.delete(id);
 return {timers,expire(){assert.equal(timers.size,1);const timer=[...timers.values()][0];assert.equal(timer.delay,15000);timer.callback();}};
}
function waitForAbort(signal){
 return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
}

test('stalled catalog headers time out, release loading state, keep filters and allow manual retry',async t=>{
 const p=page(t),clock=catalogClock(p);
 p.respond((url,options)=>waitForAbort(options.signal));
 const pending=p.api.load({updateUrl:false});await flush();clock.expire();
 assert.equal(await pending,false);assert.equal(clock.timers.size,0);
 assert.equal(p.node('cars').getAttribute('aria-busy'),'false');
 assert.match(p.node('cars').textContent,/Pobieranie trwało zbyt długo/);
 assert.equal(p.node('make').value,'POLESTAR');assert.equal(p.requests.length,1,'no automatic retry');
 p.respond(()=>response(firstPage(),'page-2'));
 p.doc.querySelector('[data-catalog-retry]').click();await flush();
 assert.equal(p.node('cars').querySelectorAll('article').length,20);
 assert.equal(p.requests.length,2);assert.equal(clock.timers.size,0);
});

test('stalled response body on load more times out without losing cards or the retry cursor',async t=>{
 const p=page(t),clock=catalogClock(p);await p.api.load({updateUrl:false});
 assert.equal(clock.timers.size,0);const previousHtml=p.node('cars').innerHTML;
 const normalFetch=p.win.fetch;let usedSignal;
 p.win.fetch=async(url,options)=>{usedSignal=options.signal;return {ok:true,headers:new Headers({'content-type':'application/json'}),json:()=>waitForAbort(options.signal)};};
 const pending=p.api.load({append:true});await flush();clock.expire();await pending;
 assert.equal(usedSignal.aborted,true);assert.equal(clock.timers.size,0);
 assert.equal(p.node('cars').innerHTML,previousHtml);assert.equal(p.node('cars').getAttribute('aria-busy'),'false');
 assert.equal(p.node('loadMoreButton').disabled,false);assert.equal(p.node('loadMoreButton').hidden,false);
 assert.match(p.node('resultStatus').textContent,/Wyświetlono 20 ofert.*pobieranie trwało zbyt długo; spróbuj ponownie/);
 p.win.fetch=normalFetch;p.respond(url=>{assert.equal(url.searchParams.get('cursor'),'page-2');return response([car(71416936)]);});
 await p.api.load({append:true});assert.equal(p.node('cars').querySelectorAll('article').length,21);assert.equal(clock.timers.size,0);
});

test('superseded search is aborted and a late old timeout cannot overwrite newer successful results',async t=>{
 const p=page(t),clock=catalogClock(p);
 p.respond((url,options)=>url.searchParams.get('sort')==='year_desc'?response([car(77777777)]):waitForAbort(options.signal));
 const old=p.api.load({updateUrl:false});await flush();const lateTimeout=[...clock.timers.values()][0].callback;
 p.node('catalogSort').value='year_desc';await p.api.load();
 assert.equal(p.requests[0].options.signal.aborted,true,'obsolete request is cancelled without waiting fifteen seconds');
 assert.equal(clock.timers.size,0,'both completed and cancelled request timers are released');lateTimeout();await old;
 assert.equal(clock.timers.size,0);assert.match(p.node('cars').textContent,/77777777/);
 assert.doesNotMatch(p.node('cars').textContent,/Pobieranie trwało zbyt długo/);
 assert.equal(p.node('resultStatus').textContent,'Wyświetlono 1 ofertę');
 assert.equal(p.node('cars').getAttribute('aria-busy'),'false');
});

test('loaded count distinguishes the displayed cards from further cursor results without inventing a total',async t=>{
 const p=page(t);
 const secondPage=Array.from({length:20},(_,i)=>car(71416936+i));
 p.respond(url=>{
  const cursor=url.searchParams.get('cursor');
  const result=cursor==='page-3'?response([car(71416956)]):cursor==='page-2'
   ?response([firstPage().at(-1),...secondPage],'page-3'):response(firstPage(),'page-2');
  result.meta.total=999999;return result;
 });
 await p.api.load({updateUrl:false});
 assert.equal(p.node('resultStatus').textContent,'Wyświetlono 20 ofert. Dostępne są kolejne wyniki');
 assert.equal(p.node('resultStatus').getAttribute('role'),'status');
 assert.equal(p.node('resultStatus').getAttribute('aria-live'),'polite');
 assert.equal(p.node('loadMoreButton').hidden,false);
 assert.equal(p.node('loadMoreButton').disabled,false);
 p.node('loadMoreButton').click();await flush();
 assert.equal(p.node('cars').querySelectorAll('article').length,40);
 assert.equal(p.node('resultStatus').textContent,'Wyświetlono 40 ofert. Dostępne są kolejne wyniki');
 assert.equal(p.node('loadMoreButton').hidden,false);
 p.node('loadMoreButton').click();await flush();
 assert.equal(p.node('cars').querySelectorAll('article').length,41);
 assert.equal(p.node('resultStatus').textContent,'Wyświetlono 41 ofert');
 assert.equal(p.node('loadMoreButton').hidden,true);
 assert.equal(p.requests.length,3);
 assert.doesNotMatch(p.node('resultStatus').textContent,/999999|wszystkich|łącznie/);
});
test('20 → 21 cards → vehicle → explicit backlink restores pages, choices and scroll in a new history entry',async t=>{
 const storage=new Map(),p=page(t,{storage});
 p.respond(url=>url.searchParams.has('cursor')?response([car(71416936)]):response(firstPage(),'page-2'));
 await p.api.load({updateUrl:false});
 assert.equal(p.node('cars').querySelectorAll('article').length,20);
 p.node('loadMoreButton').click();await flush();
 assert.equal(p.node('cars').querySelectorAll('article').length,21);
 p.win.scrollY=2480;
 const link=p.node('cars').querySelectorAll('article')[20].querySelector('a');
 link.click();
 const vehicle=new URL(link.href);
 assert.equal(vehicle.pathname,'/car');
 assert.equal(vehicle.searchParams.get('lot'),'71416936');
 const returnPath=navigation.safeLocalReturnPath(vehicle.searchParams.get('return_to'));
 const descriptor=JSON.parse(storage.get(KEY));
 assert.equal(descriptor.pages,2);assert.equal(descriptor.scrollY,2480);
 assert.deepEqual(Object.keys(descriptor).sort(),['pages','route','savedAt','scrollY','version']);
 assert.doesNotMatch(storage.get(KEY),/pricing|71416936|vin|contact|email|phone/);
 const returned=page(t,{url:returnPath,storage});
 assert.equal(returned.win.history.state,null);
 returned.respond(url=>url.searchParams.has('cursor')?response([car(71416936)]):response(firstPage(),'page-2'));
 await returned.api.restoreView();
 assert.equal(returned.node('cars').querySelectorAll('article').length,21);
 assert.equal(returned.node('make').value,'POLESTAR');
 assert.equal(returned.requests.length,2);
 assert.equal(new URL(returned.requests[1].url,'https://rexbid.pl').searchParams.get('cursor'),'page-2');
 assert.equal(returned.scrolls.at(-1).top,2480);
 assert.equal(returned.node('loadMoreButton').hidden,true);
 assert.equal(returned.node('resultStatus').textContent,'Wyświetlono 21 ofert');
 assert.match(returned.node('cars').querySelector('article').textContent,/Brak danych o ofercie/);
 assert.doesNotMatch(returned.node('cars').querySelector('article').textContent,/\$0/);
 assert.doesNotMatch(returned.node('cars').querySelector('article').textContent,/Kup teraz.*\$0/);
});
test('fresh browser history snapshot remains the zero-request fast path',async t=>{
 const p=page(t);await p.api.load({updateUrl:false});
 p.win.scrollY=950;p.api.save();
 const restored=page(t,{state:p.win.history.state,storage:p.storage});
 await restored.api.restoreView();
 assert.equal(restored.requests.length,0);
 assert.equal(restored.node('cars').querySelectorAll('article').length,20);
 assert.equal(restored.scrolls.at(-1).top,950);
 assert.equal(restored.node('resultStatus').textContent,'Wyświetlono 20 ofert. Dostępne są kolejne wyniki');
 assert.equal(restored.node('loadMoreButton').hidden,false);
});

test('sort and list view survive explicit return including loaded pages; view switching does not fetch data',async t=>{
 const storage=new Map(),route='/?catalog=1&make=POLESTAR&sort=year_desc&view=list',p=page(t,{url:route,storage});
 p.respond(url=>url.searchParams.has('cursor')?response([car(71416936)]):response(firstPage(),'page-2'));
 await p.api.load({updateUrl:false});await p.api.load({append:true,updateUrl:false});p.api.save();
 assert.equal(p.node('catalogSort').value,'year_desc');assert.ok(p.node('catalogResults').classList.contains('catalog-list-view'));
 assert.equal(new URL(p.requests[0].url,'https://rexbid.pl').searchParams.get('sort'),'year_desc');
 assert.equal(new URL(p.requests[0].url,'https://rexbid.pl').searchParams.get('view'),null);
 const link=p.node('cars').querySelector('a');assert.ok(new URL(link.href).searchParams.get('return_to').includes('sort=year_desc'));
 const returned=page(t,{url:route,storage});returned.respond(url=>url.searchParams.has('cursor')?response([car(71416936)]):response(firstPage(),'page-2'));await returned.api.restoreView();
 assert.equal(returned.node('cars').querySelectorAll('article').length,21);assert.equal(returned.node('catalogSort').value,'year_desc');assert.equal(returned.node('catalogView').value,'list');
 const before=returned.requests.length;returned.doc.querySelector('[data-catalog-view=""]').click();
 assert.equal(returned.requests.length,before);assert.equal(new URL(returned.win.location.href).searchParams.get('view'),null);assert.equal(returned.node('catalogResults').classList.contains('catalog-list-view'),false);
 assert.ok(!returned.node('activeFilterChips').textContent.includes('year_desc'));
});

test('changing sorting resets pagination and prevents a late old page from appending',async t=>{
 const p=page(t);await p.api.load({updateUrl:false});let finish;
 p.respond(url=>url.searchParams.has('cursor')?new Promise(resolve=>{finish=resolve;}):response([car(77777777)]));
 const old=p.api.load({append:true});await flush();p.node('catalogSort').value='year_asc';await p.api.load();
 finish(response([car(88888888)]));await old;
 assert.equal(p.node('cars').querySelectorAll('article').length,1);assert.match(p.node('cars').textContent,/77777777/);assert.doesNotMatch(p.node('cars').textContent,/88888888/);
 const current=new URL(p.requests.at(-1).url,'https://rexbid.pl');assert.equal(current.searchParams.get('sort'),'year_asc');assert.equal(current.searchParams.has('cursor'),false);
});
test('another filter choice clears the old return descriptor and loads only its first page',async t=>{
 const storage=new Map([[KEY,JSON.stringify(saved())]]);
 const p=page(t,{url:'/?catalog=1&make=TOYOTA',storage});
 await p.api.restoreView();
 assert.equal(p.requests.length,1);assert.ok(p.removed.includes(KEY));
 assert.equal(p.scrolls.length,0);
 assert.equal(JSON.parse(storage.get(KEY)).route,'/?catalog=1&make=TOYOTA');
});
test('malformed, expired, oversized, foreign and unbounded descriptors are ignored safely',async t=>{
 const variants=['{',JSON.stringify([]),'x'.repeat(8193),
  ...[saved(0),saved(11),saved(2,{savedAt:Date.now()-1800001}),saved(2,{savedAt:Date.now()+60000}),
   saved(2,{scrollY:-1}),saved(2,{scrollY:Infinity}),saved(2,{route:'https://evil.test/?catalog=1'}),
   saved(2,{route:'//evil.test/'}),saved(2,{contact:'private marker'})].map(JSON.stringify)];
 for(const text of variants){
  const p=page(t,{storage:new Map([[KEY,text]])});
  await p.api.restoreView();
  assert.equal(p.requests.length,1);assert.equal(p.scrolls.length,0);
  assert.ok(p.removed.includes(KEY));
 }
});
test('route storage allowlists filters and treats index.html, encoding and parameter order consistently',async t=>{
 const p=page(t,{url:'/index.html?email=private%40example.test&token=private-token&make=POLESTAR&catalog=1#results'});
 await p.api.load({updateUrl:false});p.win.scrollY=780;p.api.save();
 assert.equal(JSON.parse(p.storage.get(KEY)).route,'/?catalog=1&make=POLESTAR');
 assert.doesNotMatch(p.storage.get(KEY),/private|email|token/);
 const returned=page(t,{url:'/?catalog=1&make=POLESTAR#results',storage:p.storage});
 await returned.api.restoreView();assert.equal(returned.scrolls.at(-1).top,780);
 for(const url of ['/?catalog=1&make=POLESTAR&make=TOYOTA','/?catalog=1&make=POLESTAR%5C','/?catalog=1&make=POLESTAR%0A']){
  const invalid=page(t,{url});await invalid.api.load({updateUrl:false});assert.equal(invalid.storage.has(KEY),false);
 }
});
test('unavailable tab storage cannot prevent normal catalogue reads or browser history saving',async t=>{
 const p=page(t,{storageBlocked:true});
 await p.api.restoreView();
 assert.equal(p.requests.length,1);assert.equal(p.node('cars').querySelectorAll('article').length,20);
 assert.equal(p.win.history.state.rexBidCatalog.cars.length,20);
});
test('replay stops at end, repeated cursor, malformed cursor, or a failed appended request',async t=>{
 for(const mode of ['end','repeat','malformed','failure']){
  const p=page(t,{storage:new Map([[KEY,JSON.stringify(saved(10))]])});
  p.respond(url=>{
   if(!url.searchParams.has('cursor'))return response(firstPage(),mode==='end'?null:'page-2');
   if(mode==='failure')throw Error('synthetic read failure');
   return response([car(71416936)],mode==='repeat'?'page-2':{bad:true});
  });
  await p.api.restoreView();
  assert.equal(p.requests.length,mode==='end'?1:2,mode);
  assert.equal(p.node('cars').querySelectorAll('article').length,mode==='repeat'?21:20,mode);
  if(mode==='failure'){
   assert.equal(p.node('resultStatus').textContent,'Wyświetlono 20 ofert. Dostępne są kolejne wyniki — nie udało się pobrać kolejnej strony');
   p.respond(()=>response([car(71416936)]));
   p.node('loadMoreButton').click();await flush();
   assert.equal(p.node('cars').querySelectorAll('article').length,21);
  }
 }
});
test('page replay has a hard ten-page ceiling even if every response contains another cursor',async t=>{
 const p=page(t,{storage:new Map([[KEY,JSON.stringify(saved(10))]])});
 let number=0;p.respond(()=>response([car(90000000+number)],'page-'+(++number)));
 await p.api.restoreView();assert.equal(p.requests.length,10);
});
test('a changed filter during pending replay prevents old append and scroll restoration',async t=>{
 const p=page(t,{storage:new Map([[KEY,JSON.stringify(saved())]])});
 let release;const pending=new Promise(resolve=>{release=resolve;});
 p.respond(url=>url.searchParams.get('make')==='TOYOTA'?response([car(80000000,{title:'TOYOTA'})]):
  url.searchParams.has('cursor')?pending:response(firstPage(),'page-2'));
 const restore=p.api.restoreView();await flush();
 p.node('make').insertAdjacentHTML('beforeend','<option value="TOYOTA">TOYOTA</option>');
 p.node('make').value='TOYOTA';await p.api.load();
 release(response([car(71416936)]));await restore;
 assert.equal(p.node('cars').querySelectorAll('article').length,1);
 assert.match(p.node('cars').textContent,/TOYOTA/);assert.equal(p.scrolls.length,0);
 assert.equal(JSON.parse(p.storage.get(KEY)).route,'/?catalog=1&make=TOYOTA');
});
test('returning Home during pending replay cancels its render and scroll restoration',async t=>{
 const p=page(t,{storage:new Map([[KEY,JSON.stringify(saved())]])});
 let release;const pending=new Promise(resolve=>{release=resolve;});
 p.respond(url=>url.searchParams.has('cursor')?pending:response(firstPage(),'page-2'));
 const restore=p.api.restoreView();await flush();
 p.win.history.pushState({},'', '/');
 p.win.dispatchEvent(new p.win.PopStateEvent('popstate'));
 release(response([car(71416936)]));await restore;
 assert.equal(p.node('cars').querySelectorAll('article').length,20);
 assert.equal(p.scrolls.length,0);
 assert.equal(p.node('cars').getAttribute('aria-busy'),'false');
 assert.notEqual(p.win.history.state?.rexBidCatalog?.url,'/');
});
