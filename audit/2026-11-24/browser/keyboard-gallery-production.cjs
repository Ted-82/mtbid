'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(__dirname, '../../../../evidence/browser/qa-browsers');
const browserTests = path.resolve(__dirname, '../../../../evidence/browser/qa-tools/node_modules/playwright');
const {chromium, webkit} = require(browserTests);
const target = 'https://rexbid.pl/car?platform=copart&lot=48332546&vin=5TDKK3DC8ES447415';
async function attempt(engine,name,size) {
 const browser = await engine.launch(name==='Chrome'?{channel:'chrome',headless:true}:{headless:true});
 try {
  const page = await browser.newPage({viewport:size,locale:'pl-PL',timezoneId:'Europe/Warsaw'});
  await page.route('**/*',route=>{
   const req=route.request(),u=new URL(req.url());
   if(!['GET','HEAD'].includes(req.method()) || u.hostname==='rexbid.pl'&&/^\/api\/(traffic|auth|portal|live)(\/|$)/.test(u.pathname))return route.abort();
   return u.hostname==='rexbid.pl'?route.continue({headers:{...req.headers(),'X-RexBid-Traffic-Test':'1'}}):route.continue();
  });
  const result={engine:name,version:browser.version(),viewport:size,started:new Date().toISOString(),checks:[]};
  const check=(test,seen,expected)=>result.checks.push({test,seen,expected,pass:seen===expected});
  const response=await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  check('Publiczna karta',response.status(),200);
  const trigger=page.getByRole('button',{name:'Otwórz pełną galerię zdjęć pojazdu'});
  await trigger.waitFor({state:'visible',timeout:15000});
  const focus=()=>page.evaluate(()=>document.activeElement?.id||null);
  const inside=()=>page.evaluate(()=>document.querySelector('#lightbox').contains(document.activeElement));
  let steps=0;while(await focus()!=='mainImage'&&steps++<90)await page.keyboard.press('Tab');
  check('Dojście do przycisku głównego zdjęcia tylko klawiszem Tab',await focus(),'mainImage');result.stepsToGallery=steps;
  await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Galeria zdjęć pojazdu'});await dialog.waitFor({state:'visible',timeout:4500});
  check('Fokus po otwarciu jest w dialogu',await inside(),true);
  const names=['Pomniejsz zdjęcie','Dopasuj zdjęcie','Powiększ zdjęcie','Zamknij galerię','Poprzednie zdjęcie','Następne zdjęcie'];
  let named=0;for(const label of names)if(await dialog.getByRole('button',{name:label,exact:true}).isVisible())named++;
  check('Podstawowe kontrolki mają polskie nazwy dostępności',named,6);
  const info=()=>page.locator('#lbInfo').innerText();result.first=await info();
  await page.keyboard.press('ArrowRight');result.second=await info();
  check('Strzałka w prawo wybiera drugie zdjęcie',/2\s*\/\s*14/.test(result.second),true);
  await page.keyboard.press('ArrowLeft');
  check('Strzałka w lewo wraca do pierwszego',/1\s*\/\s*14/.test(await info()),true);
  const tabseq=[],backseq=[];let escaped=false;
  for(let i=0;i<32;i++){await page.keyboard.press('Tab');if(!await inside())escaped=true;tabseq.push(await focus());}
  for(let i=0;i<32;i++){await page.keyboard.press('Shift+Tab');if(!await inside())escaped=true;backseq.push(await focus());}
  check('Fokus pozostaje wewnątrz przy przejściu Tab i Shift+Tab',escaped,false);
  result.forwardFocusIds=[...new Set(tabseq)].filter(Boolean);
  result.backwardFocusIds=[...new Set(backseq)].filter(Boolean);
  await page.keyboard.press('Escape');
  check('Escape zamyka dialog',await dialog.isVisible(),false);
  check('Po zamknięciu fokus wraca do tego samego zdjęcia',await focus(),'mainImage');
  return result;
 } finally {await browser.close();}
}
(async()=>{
 const results=[];
 for(const [engine,name] of [[chromium,'Chrome'],[webkit,'WebKit']])for(const viewport of [{width:390,height:844},{width:1366,height:768}]){
  try{const row=await attempt(engine,name,viewport);results.push(row);console.log(name,viewport.width,row.checks.map(x=>[x.test,x.pass]));}
  catch(err){results.push({engine:name,viewport,error:String(err.message).slice(0,250)});console.log(name,viewport.width,String(err.message).slice(0,180));}
 }
 fs.writeFileSync(path.join(__dirname,'keyboard-gallery-production.json'),JSON.stringify({target,at:new Date(),results},null,2)+'\n');
 assert.ok(results.every(x=>x.checks?.every(y=>y.pass)));
})().catch(err=>{console.error(err.message);process.exitCode=1;});
