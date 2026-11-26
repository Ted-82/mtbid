'use strict';
const fs=require('node:fs'),path=require('node:path'),{test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../public/administracja.html'),'utf8'),script=fs.readFileSync(path.join(__dirname,'../public/rexbid-archive-owner.js'),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,15));
test('archive management opens with the current count and reads again when reopened',async()=>{
 const d=new JSDOM(html,{url:'https://rexbid.pl/administracja',runScripts:'outside-only',pretendToBeVisual:true});
 try{
  let count=812,calls=0;
  d.window.fetch=async(url,options)=>{
   assert.equal(url,'/api/portal/archive?count=1');
   assert.equal(options.cache,'no-store');
   calls++;
   return {ok:true,json:async()=>({archiveEntries:count})};
  };
  d.window.eval(script);
  const panel=d.window.document.getElementById('ownerArchive');
  const label=d.window.document.getElementById('ownerArchiveCount');
  assert.equal(calls,0);
  panel.open=true;
  await tick();
  assert.match(label.textContent,/812/);
  panel.open=false;
  await tick();
  count=813;
  panel.open=true;
  await tick();
  assert.match(label.textContent,/813/);
  assert.equal(calls,2);
 }finally{d.window.close();}
});
test('owner panel displays budget, reserve and warning after the existing access gate opens',async()=>{
 const d=new JSDOM(html,{url:'https://rexbid.pl/administracja',runScripts:'outside-only'}),errors=[];d.window.addEventListener('error',e=>errors.push(e.message));let calls=0;
 d.window.fetch=async url=>{calls++;assert.equal(url,'/api/portal/archive?storage=1');return{ok:true,json:async()=>({storage:{at:new Date().toISOString(),archiveAllocatedBytes:249e9,galleries:80000,reservedTotalBytes:252e9,limitBytes:300e9,remainingBytes:48e9,estimatedStorageUSDMonthly:3.63,warning:'near_capacity',trend:null}})};};
 d.window.eval(script);assert.equal(calls,0);d.window.document.getElementById('portalWorkspace').hidden=false;await tick();
 const text=d.window.document.getElementById('ownerArchiveStorage').textContent;assert.match(text,/80%/);assert.match(text,/300 GB/);assert.match(text,/48 GB/);assert.match(text,/3,63 USD/);assert.match(text,/operacje i podatki osobno/);assert.equal(calls,1);assert.deepEqual(errors,[]);
 d.window.document.getElementById('ownerArchiveStorageRefresh').click();await tick();assert.equal(calls,2);d.window.close();
});
test('a failed owner check displays no private storage figures',async()=>{
 const d=new JSDOM(html,{url:'https://rexbid.pl/administracja',runScripts:'outside-only'});d.window.fetch=async()=>({ok:false,json:async()=>({error:'owner_mfa_required'})});d.window.eval(script);d.window.document.getElementById('ownerArchiveStorageRefresh').click();await tick();assert.match(d.window.document.getElementById('ownerArchiveStorageFeedback').textContent,/Potwierdź sesję/);d.window.close();
});

const storage=()=>({at:new Date().toISOString(),archiveAllocatedBytes:7e9,galleries:2275,reservedTotalBytes:10.24e9,limitBytes:300e9,remainingBytes:289.76e9,estimatedStorageUSDMonthly:.015,warning:null,trend:null});
test('refresh acknowledges unchanged measurements, disables while pending and sends an uncached read',async()=>{
 const d=new JSDOM(html,{url:'https://rexbid.pl/administracja',runScripts:'outside-only'}),s=storage();let finish,calls=0;
 d.window.fetch=(url,options)=>{calls++;assert.equal(options.cache,'no-store');assert.ok(options.signal);return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({storage:s})});});};d.window.eval(script);
 const button=d.window.document.getElementById('ownerArchiveStorageRefresh'),feedback=d.window.document.getElementById('ownerArchiveStorageFeedback');
 button.click();assert.equal(button.disabled,true);assert.equal(button.textContent,'Sprawdzam…');assert.match(feedback.textContent,/Sprawdzam/);button.click();assert.equal(calls,1);
 finish();await tick();assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);assert.match(feedback.textContent,/Sprawdzono o/);assert.match(d.window.document.getElementById('ownerArchiveStorage').textContent,/0,015 USD/);
 button.click();finish();await tick();assert.match(feedback.textContent,/Brak nowszego pomiaru/);assert.match(feedback.textContent,/co 5 minut/);d.window.close();
});
test('failed refresh preserves the previous measurement and makes retry available',async()=>{
 const d=new JSDOM(html,{url:'https://rexbid.pl/administracja',runScripts:'outside-only'});let fail=false;d.window.fetch=async()=>{if(fail)throw Error('offline');return{ok:true,json:async()=>({storage:storage()})};};d.window.eval(script);
 const button=d.window.document.getElementById('ownerArchiveStorageRefresh');button.click();await tick();const original=d.window.document.getElementById('ownerArchiveStorage').textContent;fail=true;button.click();await tick();
 assert.equal(d.window.document.getElementById('ownerArchiveStorage').textContent,original);assert.equal(d.window.document.getElementById('ownerArchiveStorageFeedback').dataset.tone,'error');assert.equal(button.disabled,false);d.window.close();
});
test('a timed out refresh exits its loading state and reports the timeout',async()=>{
 const d=new JSDOM(html,{url:'https://rexbid.pl/administracja',runScripts:'outside-only'}),schedule=d.window.setTimeout.bind(d.window);d.window.setTimeout=(fn,ms)=>schedule(fn,ms===12000?1:ms);
 d.window.fetch=(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));d.window.eval(script);const button=d.window.document.getElementById('ownerArchiveStorageRefresh');button.click();await tick();assert.equal(button.disabled,false);assert.match(d.window.document.getElementById('ownerArchiveStorageFeedback').textContent,/trwało zbyt długo/);d.window.close();
});
test('tools start collapsed and opening another tool preserves a compact exclusive view',async()=>{
 const d=new JSDOM(html,{url:'https://rexbid.pl/administracja',runScripts:'outside-only'});
 try {
  d.window.fetch=async()=>({ok:true,json:async()=>({storage:storage()})});
  d.window.eval(script);
  const grid=d.window.document.querySelector('.portal-owner-tools-grid');
  const cards=[...grid.querySelectorAll('details.portal-owner-tool')];
  for(const id of ['ownerRegistrations','ownerStorage','portalTraffic','ownerArchive']){
   assert.ok(cards.some(card=>card.id===id),id);
  }
  assert.ok(cards.every(card=>!card.open));
  assert.ok(d.window.document.getElementById('ownerRegistrations').hidden);
  for(const card of cards.filter(card=>!card.hidden)){
   card.open=true;
   await tick();
   assert.deepEqual(cards.filter(other=>other.open),[card]);
  }
  assert.equal(grid.nextElementSibling.id,'portalSummary');
 } finally { d.window.close(); }
});
