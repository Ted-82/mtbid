const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const api=require('../public/rexbid-compare.js'),navigation=require('../public/rexbid-car-navigation.js');
const source=fs.readFileSync(require.resolve('../public/rexbid-compare.js'),'utf8');
const flush=()=>new Promise(r=>setImmediate(r));
const ref=(lot='123',platform='copart')=>({lot,platform});
const car=(lot='123',platform='copart',extra={})=>({lot_number:lot,platform,title:'Test samochodu',vin:'5YJ3E1EA3PF683202',pricing:{current_bid_usd:0},auction:{state:'open'},read:{source:'d1',freshness:'stale',last_synced_at:'2026-10-20T12:00:00.000Z'},...extra});
const response=(data,status=200)=>({ok:status===200,status,json:async()=>({ok:true,data})});
function page(t,html='',query='',fetchImpl=async url=>{const u=new URL(url,'https://rexbid.pl');return response(car(u.pathname.split('/').pop(),u.searchParams.get('platform')));}){
  const dom=new JSDOM('<body>'+html+'</body>',{url:'https://rexbid.pl/porownaj.html'+query,runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;Object.defineProperty(w.document,'readyState',{value:'complete'});const calls=[];
  w.fetch=async(...args)=>{calls.push(args);return fetchImpl(...args);};w.eval(source);
  return {w,d:w.document,calls};
}
test('comparison identifiers validate platforms, numeric LOT and a strict maximum of three',()=>{
  assert.deepEqual(api.parse('copart:123,iaai:456,copart:123'),[ref(),ref('456','iaai')]);
  for(const s of ['copart:123\n','copart:123,iaai:456,copart:789,iaai:12','javascript:123','copart:../x','copart:123&url=https://evil.test',''])assert.deepEqual(api.parse(s),[]);
  assert.deepEqual(api.clean([ref(),ref(),ref('1'),ref('2'),ref('3')]),[ref(),ref('1'),ref('2')]);
});
test('stored comparison expires, rejects future/invalid state and leaves unrelated storage untouched',()=>{
  const m=new Map([['favorites','preserved']]),storage={getItem:k=>m.get(k),removeItem:k=>m.delete(k)};
  for(const savedAt of [0,100000000]){m.set(api.KEY,JSON.stringify({version:1,savedAt,items:[ref()]}));assert.deepEqual(api.restore(storage,api.TTL+1),[]);assert.equal(m.has(api.KEY),false);}
  m.set(api.KEY,JSON.stringify({version:1,savedAt:1000,items:[ref()]}));assert.deepEqual(api.restore(storage,1500),[ref()]);assert.equal(m.get('favorites'),'preserved');
  assert.deepEqual(api.restore({getItem(){throw Error('blocked');}}),[]);
});
test('zero, missing, Buy Now, sale and conditional amounts never substitute for each other',()=>{
  assert.equal(api.facts(car())['Oferta z zapisu'],'Brak danych o ofercie');
  assert.equal(api.facts(car('123','copart',{pricing:{current_bid_usd:null,buy_now_usd:1200}}))['Oferta z zapisu'],'Brak danych o ofercie');
  const conditional=api.facts(car('123','iaai',{auction:{state:'finished',outcome_status:'Sold on Approval'},pricing:{current_bid_usd:2900,final_price_usd:2900}}));
  assert.equal(conditional['Cena sprzedaży'],'Sprzedaż niepotwierdzona');assert.match(conditional['Oferta warunkowa'],/2900 USD.*nie jest/);
  const stored=api.facts(car('123','iaai',{auction:{state:'finished',outcome_status:'Sold on Approval'},pricing:{current_bid_usd:25,source_price_usd:2975,final_price_usd:null}}));
  assert.match(stored['Oferta warunkowa'],/^2975 USD/);
  assert.equal(api.facts(car('123','iaai',{auction:{state:'finished',outcome_status:'Sold on Approval'},pricing:{current_bid_usd:25}}))['Oferta warunkowa'],'Brak danych · nie jest ceną sprzedaży');
  const sold=api.facts(car('123','copart',{auction:{state:'finished',outcome_status:'Sold'},pricing:{current_bid_usd:9100,final_price_usd:9100}}));
  assert.equal(sold['Cena sprzedaży'],'9100 USD');assert.match(sold['Oferta z zapisu'],/Nie dotyczy/);
  assert.equal(api.facts(car('123','copart',{auction:{state:'finished',outcome_status:'Not sold'},pricing:{final_price_usd:9000}}))['Cena sprzedaży'],'Sprzedaż niepotwierdzona');
});
test('dates preserve a date-only auction and the actual observation rather than now',()=>{
  const f=api.facts(car('123','copart',{auction:{auction_at:'2026-10-01'}}));assert.equal(f['Termin z zapisu'],'01.10.2026');assert.match(f['Data obserwacji'],/20\.10\.2026/);
  assert.equal(api.facts(car('123','copart',{read:{}}))['Data obserwacji'],'Nieustalona');
});
test('insurance is source type only, and RCC is not promoted to an accepted insurer',()=>{
  assert.match(api.facts(car('123','iaai',{seller:{name:'Company',type:'Insurance Company'}}))['Typ sprzedającego'],/Ubezpieczyciel/);
  assert.equal(api.facts(car('123','iaai',{seller:{type:'RCC'}}))['Typ sprzedającego'],'Typ niepotwierdzony');
});

test('location shows the state once, whether the source display already includes it',()=>{
  for(const display of ['Baltimore East','Baltimore East (MD)'])assert.equal(api.facts(car('123','copart',{location:{display,state:'MD'}}))['Lokalizacja'],'Baltimore East (MD)');
});
test('read uses only the local stored endpoint and rejects a different LOT or platform without retry',async()=>{
  let count=0;const result=await api.read(ref(),async(url,options)=>{count++;assert.equal(url,'/api/car/123?platform=copart');assert.equal(options.credentials,'omit');return response(car('456'));});
  assert.equal(count,1);assert.match(result.error,/zgodności/);assert.equal(result.retry,false);
  assert.equal(api.identity(car('123','iaai'),ref()),false);
});
test('404 and temporary failure are distinct; timeout is bounded and does not retry',async()=>{
  assert.equal((await api.read(ref(),async()=>response(null,404))).retry,false);
  assert.equal((await api.read(ref(),async()=>response(null,503))).retry,true);
  let calls=0;const result=await api.read(ref(),async(_,options)=>{calls++;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('abort'))));},5);
  assert.equal(result.retry,true);assert.equal(calls,1);
});
test('selection has no network requests, max three, reversible pressed state and safe stored schema',async t=>{
  const p=page(t,[1,2,3,4].map(lot=>`<button data-compare-lot="${lot}" data-compare-platform="copart">Porównaj</button>`).join(''));
  p.w.sessionStorage.setItem('unrelated','preserved');
  for(const b of p.d.querySelectorAll('[data-compare-lot]'))b.click();await flush();
  assert.equal(p.calls.length,0);assert.match(p.d.querySelector('[role=status]').textContent,/maksymalnie 3/);
  const saved=JSON.parse(p.w.sessionStorage.getItem(api.KEY));assert.equal(saved.items.length,3);assert.deepEqual(Object.keys(saved.items[0]).sort(),['lot','platform']);
  p.d.querySelector('[data-compare-lot]').click();assert.equal(p.d.querySelector('[data-compare-lot]').getAttribute('aria-pressed'),'false');
  p.d.querySelector('[data-compare-clear]').click();assert.equal(p.w.sessionStorage.getItem(api.KEY),null);assert.equal(p.w.sessionStorage.getItem('unrelated'),'preserved');
});
test('new dynamically rendered vehicle buttons get pressed state without an observer loop',async t=>{
  const p=page(t,'<button data-compare-lot="123" data-compare-platform="copart"></button>');p.d.querySelector('button').click();
  const b=p.d.createElement('button');b.dataset.compareLot='123';b.dataset.comparePlatform='copart';p.d.body.append(b);await flush();
  assert.equal(b.getAttribute('aria-pressed'),'true');assert.equal(p.d.querySelectorAll('.rex-compare-bar').length,1);assert.equal(p.calls.length,0);
});
test('empty or invalid comparison does not read any vehicle',async t=>{
  for(const query of ['', '?items=copart:../bad']){const p=page(t,'<div data-compare-page></div>',query);await flush();assert.equal(p.calls.length,0);assert.match(p.d.querySelector('[data-compare-page]').textContent,/Wybierz auta/);}
});
test('comparison loads once per item, preserves healthy columns and retries only the failed one on demand',async t=>{
  let failed=true;const p=page(t,'<input type="checkbox" data-compare-differences><div data-compare-page></div>','?items=copart:123,iaai:456',async url=>url.includes('456')&&failed?response(null,503):response(car(url.includes('456')?'456':'123',url.includes('456')?'iaai':'copart')));
  await flush();assert.equal(p.calls.length,2);assert.match(p.d.body.textContent,/Test samochodu/);assert.match(p.d.body.textContent,/Nie udało/);
  p.d.querySelector('[data-compare-differences]').click();await flush();assert.equal(p.calls.length,2);
  failed=false;p.d.querySelector('[data-compare-retry]').click();await flush();assert.equal(p.calls.length,3);assert.equal(p.d.querySelector('[data-compare-retry]'),null);
  p.d.querySelector('[data-compare-remove]').click();await flush();assert.equal(p.calls.length,3);assert.match(p.w.location.search,/iaai/);
});
test('source text is escaped and hostile titles do not create markup',async t=>{
  const p=page(t,'<div data-compare-page></div>','?items=copart:123',async()=>response(car('123','copart',{title:'<img src=x onerror=alert(1)>',seller:{name:'<script>bad</script>'}})));
  await flush();assert.equal(p.d.querySelector('script'),null);assert.equal(p.d.querySelector('img'),null);assert.match(p.d.body.textContent,/<img/);
});
test('safe comparison return survives contact and rejects external and malformed redirects',()=>{
  const good=api.href([ref(),ref('456','iaai')]);assert.equal(navigation.safeLocalReturnPath(good),good);
  const inquiry=require('../public/rexbid-inquiry.js');assert.equal(inquiry.normalizeContext({return_to:good}).return_to,good);
  for(const path of ['//evil.test/porownaj?items=copart:1','/porownaj?items=copart:1&next=https://evil.test','/porownaj?items=copart:1&items=iaai:2','/porownaj?items=copart:1,iaai:2,copart:3,iaai:4','/porownaj?items=copart:1#bad'])assert.equal(navigation.safeLocalReturnPath(path),'/?catalog=1#results');
});

test('removing to one vehicle exits differences-only mode and restores its parameter rows',async t=>{
 const p=page(t,'<input type="checkbox" data-compare-differences><div data-compare-page></div>','?items=copart:123,iaai:456');await flush();
 const differences=p.d.querySelector('[data-compare-differences]');differences.click();await flush();assert.equal(differences.checked,true);
 p.d.querySelector('[data-compare-remove]').click();await flush();assert.equal(differences.disabled,true);assert.equal(differences.checked,false);assert.ok(p.d.querySelector('tbody').textContent.includes('Przebieg'));assert.ok(p.d.querySelector('tbody').textContent.includes('Platforma / LOT'));assert.equal(p.calls.length,2);
});
test('comparison thumbnails reuse the storage image parser for canonical image objects and safe fallback',async t=>{
 const p=page(t,'<div data-compare-page></div>','?items=copart:123',async()=>response(car('123','copart',{media:{thumbs:[{url:'javascript:bad'}],items:[{type:'image',url:'https://example.invalid/car.jpg',thumb:'https://example.invalid/car-small.jpg'}]}})));
 p.w.eval(fs.readFileSync(require.resolve('../public/rexbid-storage.js'),'utf8'));await flush();const img=p.d.querySelector('.compare-photo img');assert.ok(img,'a supported object image must not become Brak zdjęcia');assert.equal(img.src,'https://example.invalid/car-small.jpg');img.dispatchEvent(new p.w.Event('error'));assert.equal(img.hidden,true);assert.equal(img.nextElementSibling.hidden,false);assert.match(img.nextElementSibling.textContent,/niedostępne/);assert.equal(p.calls.length,1);
});
test('comparison deadline settles even when an adapter ignores abort before headers or in the body',async()=>{
 for(const stalledBody of [false,true]){
  let observedSignal,calls=0;
  const result=await Promise.race([api.read(ref(),async(_,options)=>{calls++;observedSignal=options.signal;return stalledBody?{ok:true,status:200,json:()=>new Promise(()=>{})}:new Promise(()=>{});},5),new Promise(resolve=>{const timer=setTimeout(()=>resolve({testDeadlineExceeded:true}),200);timer.unref?.();})]);
  assert.equal(result.testDeadlineExceeded,undefined);assert.equal(result.retry,true);assert.equal(observedSignal.aborted,true);assert.equal(calls,1);
 }
});
