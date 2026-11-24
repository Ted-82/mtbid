'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const origin = process.argv[2] || 'https://rexbid.pl';
const stem = new URL(origin).hostname === 'rexbid.pl' ? 'search-public' : 'search-staging';
const output = path.join(__dirname, stem + '.json');
const headers = {'X-RexBid-Traffic-Test': '1'};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browserOnly=process.argv.includes('--browser-only');
const report = browserOnly&&fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):{startedUtc:new Date().toISOString(), origin, api:[]};
function save() {fs.writeFileSync(output, JSON.stringify(report,null,2));}
function normalized(r) {
  return {key:[r.platform,r.lot_number||r.lot||r.lot_id].join(':'),vin:r.vin,year:r.year||r.vehicle?.year,
    make:r.make||r.vehicle?.make,fuel:r.fuel_type||r.engine?.fuel_type||r.vehicle?.fuel_type,
    auctionAt:r.auction?.timed_end_at||r.auction?.auction_at||r.auction_at||null};
}
async function request(label, filters, cursor) {
  const u = new URL('/api/cars',origin);
  for (const [k,v] of Object.entries({view:'cards',per_page:6,...filters})) u.searchParams.set(k,v);
  if (cursor) u.searchParams.set('cursor',cursor);
  const started=Date.now();
  try {
    const res=await fetch(u,{headers,signal:AbortSignal.timeout(20000)});
    const t=await res.text();let json={};try{json=JSON.parse(t);}catch{}
    const raw=Array.isArray(json.data)?json.data:(json.data?.data||json.cars||[]);
    const rows=raw.map(normalized), next=json.meta?.next_cursor||json.data?.meta?.next_cursor||null;
    const evidence={label,filters,page:cursor?2:1,startedUtc:new Date(started).toISOString(),
      durationMs:Date.now()-started,status:res.status,next:!!next,count:rows.length,error:json.error||json.message||null,fields:raw[0]?Object.keys(raw[0]):[],rows};
    report.api.push(evidence);save();return {next,rows};
  }catch(e){report.api.push({label,filters,error:e.message});save();return{};}
}
async function api(){
 const combos=[['Subaru od 2025',{make:'SUBARU',year_from:'2025'}],['Elektryczne',{fuel_type:'Electric'}],['Aktualne',{category:'current'}]];
 let r=await Promise.all(combos.map(c=>request(...c)));
 await Promise.all(combos.map((c,i)=>r[i].next?request(...c,r[i].next):null));
 await Promise.all([request('Tylko do',{year_to:'2017'}),request('Obie granice',{year_from:'2022',year_to:'2024'}),request('Bez granic',{})]);
 await Promise.all([request('Od większe niż do',{year_from:'2025',year_to:'2022'}),request('Brak dopasowań',{make:'REXBID-ZZZ-TEST-BRAK'})]);
}
async function browserJourney(){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'rexbid-search-qa-'));
 const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 let socket;
 try{
  const file=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<60&&!fs.existsSync(file);i++)await sleep(150);
  const port=fs.readFileSync(file,'utf8').split(/\r?\n/)[0];const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no;});
  let id=0;const calls=new Map();
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(calls.has(m.id)){calls.get(m.id)(m.result||{});calls.delete(m.id);}};
  const call=(method,params={})=>new Promise(resolve=>{calls.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
  const val=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true})).result?.value;
  async function wait(expression,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await val(expression))return true;await sleep(200);}return false;}
  await call('Page.enable');await call('Network.enable');await call('Network.setExtraHTTPHeaders',{headers});
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const state='(()=>{const links=Array.from(document.querySelectorAll("#cars .car-card a[href*=\\"/car?\\"]"));const rows=links.map(a=> {const p=new URL(a.href).searchParams;return {key:p.get("platform")+":"+p.get("lot"),vin:p.get("vin")}});return {url:location.href,count:rows.length,rows,make:document.querySelector("#make")?.value||"",from:document.querySelector("#yearFrom")?.value||"",to:document.querySelector("#yearTo")?.value||"",more:!!document.querySelector("#loadMoreButton")?.getClientRects().length,scrollY:Math.round(scrollY),title:document.querySelector("#catalogResultsTitle")?.innerText};})()';
  const url=origin+'/?catalog=1&make=SUBARU&year_from=2025';await call('Page.navigate',{url});
  await wait('document.querySelectorAll("#cars .car-card").length>0 && !document.querySelector("#loadMoreButton")?.disabled');
  report.browser={viewport:'390x844',first:await val(state)};save();
  const first=report.browser.first.count;
  if(!first||!report.browser.first.more)return;
  await val('document.querySelector("#loadMoreButton").scrollIntoView({block:"center"});document.querySelector("#loadMoreButton").click();true');
  await wait('document.querySelectorAll("#cars .car-card").length>'+first);report.browser.second=await val(state);save();
  if(report.browser.second.count<=first)return;
  const sel='#cars .car-card:nth-of-type('+(first+1)+') a[href*="/car?"]';
  const detail=await val('(()=>{const a=document.querySelector('+JSON.stringify(sel)+');if(!a)return null;a.scrollIntoView({block:"center"});const p=new URL(a.href).searchParams;return {href:a.href,lot:p.get("lot"),vin:p.get("vin"),scrollY:Math.round(scrollY)}})()');report.browser.selected=detail;save();
  if(!detail)return;
  await val('document.querySelector('+JSON.stringify(sel)+').click();true');
  report.browser.detailRendered=await wait('location.pathname==="/car" && document.body.innerText.includes('+JSON.stringify(detail.lot)+') && document.body.innerText.includes('+JSON.stringify(detail.vin)+')',22000);report.browser.detailUrl=await val('location.href');save();
  await val('history.back();true');
  await wait('location.pathname==="/" && document.querySelectorAll("#cars .car-card").length>0');await sleep(750);
  report.browser.afterBack=await val(state);save();
  const fromBefore=report.browser.second.rows.map(x=>x.key),after=report.browser.afterBack.rows.map(x=>x.key);
  report.browser.sameOrder=JSON.stringify(fromBefore)===JSON.stringify(after);save();
  await val('const upper=document.querySelector("#yearTo");upper.value="2022";upper.dispatchEvent(new Event("change",{bubbles:true}));true');
  await wait('!document.querySelector("#filterValidationMessage")?.hidden');
  report.browser.reversed=await val('(()=>{const n=document.querySelector("#filterValidationMessage");return {visible:!!n.getClientRects().length,text:n.innerText,invalid:document.querySelector("#yearFrom").getAttribute("aria-invalid")}})()');save();
  await val('document.querySelector("#clearFiltersButton").click();true');
  await wait('location.search.indexOf("year_from")<0 && !document.querySelector("#yearFrom").value && !document.querySelector("#yearTo").value');
  await sleep(900);report.browser.cleared=await val(state);save();
  await val('const maker=document.querySelector("#make");maker.value="REXBID-ZZZ-TEST-BRAK";document.querySelector("#filterButton").click();true');
  await wait('location.search.includes("REXBID-ZZZ-TEST-BRAK") && document.querySelectorAll("#cars .car-card").length===0');await sleep(600);
  report.browser.empty=await val('(()=>{const e=document.querySelector("#cars");return {count:e.querySelectorAll(".car-card").length,text:e.innerText,visibleMore:!!document.querySelector("#loadMoreButton")?.getClientRects().length}})()');save();
 }finally{socket?.close();browser.kill();}
}
(async()=>{try{if(!browserOnly)await api();await browserJourney();}finally{report.finishedUtc=new Date().toISOString();save();console.log(JSON.stringify({api:report.api.map(r=>[r.label,r.page,r.status,r.count,r.next]),first:report.browser?.first?.count,second:report.browser?.second?.count,detail:report.browser?.detailRendered,after:report.browser?.afterBack?.count,restored:report.browser?.sameOrder,reversed:report.browser?.reversed,empty:report.browser?.empty}));}})().catch(e=>{console.error(e.message);process.exitCode=1;});
