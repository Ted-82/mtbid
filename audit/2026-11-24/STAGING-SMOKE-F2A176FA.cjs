'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const pw = require(process.argv[2]);
const output = process.argv[3];
const origin = 'https://rexbid-audit-staging.tedn828.workers.dev';
const car = {lot:'46294903', platform:'iaai', vin:'JF2SLDTC5SH513294'};
const name = process.argv[4];
const liveBudgetOnly = process.argv[5] === 'budget-input';
const options = {headless:true};
if (name === 'chromium') options.channel = 'chrome';
const out = {origin, requestedRelease:'f2a176fa', started:new Date().toISOString(), name, runs:[]};
const cleaned = str => str.replace(/\s+/g,' ').trim();
const showBid = '[data-estimate-bid]';
const outputFile = path.join(output,'STAGING-SMOKE-F2A176FA-'+name+(liveBudgetOnly?'-input':'')+'.json');
const persist = () => fs.writeFileSync(outputFile,JSON.stringify(out,null,2)+'\n');
const waitForCar = async p => p.waitForFunction(({vin,lot}) => {
  const b=document.body.innerText;
  return b.includes(vin)&&b.includes(lot)&&/SUBARU/i.test(b)&&/FORESTER/i.test(b)
},car,{timeout:25000});
async function openHome(p) {
 const response = await p.goto(origin+'/?rex_traffic_test=1',{waitUntil:'domcontentloaded'});
 assert.equal(response.status(),200);
 assert.equal(response.headers()['x-rexbid-environment'],'read-only-staging');
}
async function budget(p,r) {
 await openHome(p);
 await p.locator('.budget-hero-card').click();
 await p.waitForURL('**/kalkulator-budzet');
 assert.equal(new URL(p.url()).origin,origin);
 await p.locator('[name=identifier]').fill(car.lot); await p.locator('[name=platform]').selectOption(car.platform);
 r.budgets=[];
 for(const threshold of [30000,100000]){
  await p.locator('[name=budget]').fill(String(threshold));
  const submitted = !liveBudgetOnly || !r.budgets.length;
  if(submitted) await p.getByRole('button',{name:'Oblicz limit licytacji'}).click();
  const previous = r.budgets.at(-1)?.bid || '';
  await p.waitForFunction(old=>{
   const area=document.querySelector('[data-purchase-selected]'), bid=document.querySelector('[data-estimate-bid]'), note=document.querySelector('[data-estimate-bid-note]');
   return area && !area.hidden && bid && /\d/.test(bid.innerText)&&bid.innerText.trim()!==old && /pozostaje|budżet|limit/i.test(note?.innerText||'');
  },previous,{timeout:25000});
  const bid = (await p.locator(showBid).first().innerText()).trim();
  const note = cleaned(await p.locator('[data-estimate-bid-note]').first().innerText());
  const state = cleaned(await p.locator('[data-purchase-status]').innerText());
  const value = Number(bid.replace(/\s+/g,'').replace(/USD|\$/gi,'').replace(',','.'));
  assert.ok(Number.isFinite(value)&&value>0);
  r.budgets.push({budgetPLN:threshold,bid,value,note,state,submitted});
 }
 assert.ok(r.budgets[1].value>r.budgets[0].value);
}
async function identifiers(p,r) {
 r.identifiers=[];
 for(const input of [car.lot,car.vin.toLowerCase()]){
  await openHome(p);
  await p.locator('#searchInput').fill(input);
  await p.locator('#searchForm button[type=submit]').click();
  const hit=p.locator('#cars .car-card').filter({hasText:car.lot});
  await hit.first().waitFor({timeout:25000});
  const keys=await p.locator('#cars .car-card a[href*="/car?"]').evaluateAll(anchors=>Array.from(new Set(anchors.map(a=>{const s=new URL(a.href).searchParams;return s.get('platform')+':'+s.get('lot')+':'+s.get('vin')}))));
  assert.deepEqual(keys,[car.platform+':'+car.lot+':'+car.vin]);
  await hit.first().locator('a[href*="/car?"]').first().click();
  await p.waitForURL('**/car?**'); await waitForCar(p);
  const title=cleaned(await p.locator('h1:visible').first().innerText());
  const date=await p.evaluate(()=>document.body.innerText.split('\n').map(l=>l.trim()).filter(l=>/UTC[+-]|czas polski|Polska \(/i.test(l)).slice(0,4));
  const canonical=new URL(p.url());
  assert.equal(canonical.searchParams.get('vin'),car.vin);assert.equal(canonical.searchParams.get('lot'),car.lot);
  assert.match(title,/2025.*SUBARU.*FORESTER/i);
  assert.ok(date.some(x=>/Polska|czas polski|UTC/i.test(x)));
  r.identifiers.push({input,keys,title,timeLabels:date,detail:canonical.pathname+'?platform='+car.platform+'&lot='+car.lot+'&vin='+car.vin});
 }
}
async function filters(p,r) {
 await openHome(p);
 const jump=p.locator('.search-hint a[href*="catalog=1"]'); await jump.click();
 await p.waitForURL(u=>u.pathname==='/'&&u.searchParams.get('catalog')==='1');
 await p.locator('#cars .car-card').first().waitFor({timeout:30000});
 await p.waitForLoadState('load');
 if(!await p.locator('#make').isVisible()){await p.locator('#filterPanelToggle').click();}
 await p.locator('#make').fill('Subaru');await p.locator('#make').press('Tab');
 await p.waitForFunction(()=>new URL(location.href).searchParams.get('make')?.toUpperCase()==='SUBARU' && document.querySelector('#cars')?.getAttribute('aria-busy')!=='true');
 if(!await p.locator('#yearFrom').isVisible()) await p.locator('#filterPanelToggle').click();
 await p.locator('#yearFrom').selectOption('2025');
 if(await p.locator('#filterButton').isVisible()) await p.locator('#filterButton').click();
 const selector='#cars .car-card a[href*="/car?"]';
 await p.waitForFunction(lot=>new URL(location.href).searchParams.get('make')?.toUpperCase()==='SUBARU' && new URL(location.href).searchParams.get('year_from')==='2025' && Array.from(document.querySelectorAll('#cars .car-card')).some(c=>c.innerText.includes(lot)),car.lot, {timeout:30000});
 const state=()=>p.evaluate(({s,lot})=>({make:document.querySelector('#make').value,from:document.querySelector('#yearFrom').value,results:document.querySelectorAll('#cars .car-card').length,keys:Array.from(new Set([...document.querySelectorAll(s)].map(a=>{const u=new URL(a.href);return u.searchParams.get('platform')+':'+u.searchParams.get('lot')}))), url:location.pathname+location.search}),{s:selector,lot:car.lot});
 r.filteredBefore=await state();
 await p.locator('#cars .car-card').filter({hasText:car.lot}).first().locator('a[href*="/car?"]').first().click();
 await p.waitForURL('**/car?**');await waitForCar(p);
 const back=p.locator('#vehicleCatalogReturn');
 r.returnHref=await back.getAttribute('href');
 await back.click();
 await p.waitForFunction(lot=>location.pathname==='/'&&Array.from(document.querySelectorAll('#cars .car-card')).some(c=>c.innerText.includes(lot)),car.lot,{timeout:20000});
 r.filteredAfter=await state();
 assert.equal(r.filteredAfter.make.toUpperCase(),'SUBARU'); assert.equal(r.filteredAfter.from,'2025');
 assert.equal(r.filteredBefore.results,r.filteredAfter.results); assert.deepEqual(r.filteredAfter.keys,r.filteredBefore.keys);
}
(async()=>{
 const browser=await pw[name].launch(options);
 try{
  out.version=browser.version();
  for(const size of [{width:390,height:844},{width:1366,height:768}]){
   const ctx=await browser.newContext({viewport:size,hasTouch:size.width<500,locale:'pl-PL',timezoneId:'Europe/Warsaw',extraHTTPHeaders:{'X-RexBid-Traffic-Test':'1'}});
   await ctx.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
   const p=await ctx.newPage(); p.setDefaultTimeout(15000);
   const item={size,checks:{}};out.runs.push(item);
   for(const [key, fn] of Object.entries(liveBudgetOnly ? {budget} : {budget,identifiers,filters})){
    const evidence={passed:false};item.checks[key]=evidence;
    try{await fn(p,evidence);evidence.passed=true;}
    catch(e){evidence.error=e.message.slice(0,1000);evidence.lastPath=new URL(p.url()).pathname;const text=await p.locator('body').innerText({timeout:3000}).catch(()=>null);evidence.lastHeadings=await p.locator('h1:visible,h2:visible').allTextContents().catch(()=>[]);if(text)evidence.feedback=text.split('\n').filter(l=>/brak|błęd|szukam|niestety|ponown|ofert|PLN/i.test(l)).slice(-8);}
    persist();
   }
   await ctx.close();
  }
 }finally{await browser.close();out.finished=new Date().toISOString();persist();}
 console.log(name,JSON.stringify(out.runs.map(r=>Object.fromEntries(Object.entries(r.checks).map(([k,v])=>[k,v.passed||v.error])))));
})().catch(e=>{out.fatal=e.message;persist();console.error(e.message);process.exitCode=1;});
