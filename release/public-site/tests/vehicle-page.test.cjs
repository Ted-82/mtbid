'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {vehiclePage}=require('../sync/vehicle-page.cjs');
const car={platform:'iaai',vin:'2T3A1RFV7RW473296',lot_number:'45111614',title:'2024 Toyota RAV4',location:{display:'Portland West'},media:{thumbs:['example.jpg']}};
const id='?vin='+car.vin+'&lot='+car.lot_number+'&platform=iaai';
const savedIdentity={vin:car.vin,lot:car.lot_number,platform:car.platform};
const observed=(at,bid)=>({kind:'observed_snapshot',observed_at:at,current_bid_usd:bid});
const savedResult={ok:true,identity:savedIdentity,rex_history:{snapshots:[
  observed('2026-11-25T00:00:37.000Z',12700),observed('2026-11-25T00:42:43.000Z',12700),
  observed('2026-11-25T00:42:43+00:00',12700),observed('2026-11-25T00:43:43',22000)
]}};
async function savedPage({query=id,detailError='auction_date_pending',data=savedResult,summary=data,visible=true,status=200,method='GET'}={}) {
  const reads=[], historyOptions=[];
  const response=await vehiclePage(new Request('https://rexbid.pl/car'+query,{method}),{
    read:async (route,options)=>{
      reads.push(route);
      if(route.includes('/history?')) historyOptions.push(options);
      return route.includes('/history?')?Response.json(route.endsWith('per_page=1')?summary:data,{status}):Response.json({error:detailError},{status:404});
    },
    render:()=>{throw Error('Unsold vehicle history must not render an active card');},
    historyVisible:async vin=>{assert.equal(vin,car.vin);return visible;}
  });
  return {response,html:await response.text(),reads,historyOptions};
}
test('undated exact identity keeps its verified bid times on a distinct, non-indexed history page',async()=>{
  const {response,html,reads}=await savedPage();assert.equal(response.status,200);assert.deepEqual(reads,
    ['/api/car/'+car.lot_number+'?platform=iaai','/api/car/'+car.lot_number+'/history?platform=iaai&per_page=20']);
  const doc=new JSDOM(html).window.document;
  assert.equal(doc.querySelector('h1').textContent,'Historia ofert');assert.match(html,/Termin aukcji jest nieznany/);
  assert.match(response.headers.get('X-Robots-Tag'),/noindex/);assert.match(response.headers.get('Cache-Control'),/no-store/);
  assert.deepEqual([...doc.querySelectorAll('tbody tr')].map(tr=>tr.textContent),
    ['25.11.2026, 01:42:43$12,700Ostatnia zapisana oferta','25.11.2026, 01:00:37$12,700']);
  assert.equal(doc.querySelectorAll('form,script,button').length,0);
  const head=await savedPage({method:'HEAD'});assert.equal(head.response.status,200);assert.equal(head.html,'');
});
test('missing or withdrawn lots and mismatched VIN, platform or lot do not expose saved bids',async()=>{
  for(const entry of [{visible:false},{detailError:'vehicle_not_in_saved_catalog'},
    {data:{...savedResult,identity:{...savedIdentity,vin:'WVWZZZ1JZXW000001'}}},
    {data:{...savedResult,identity:{...savedIdentity,platform:'copart'}}},
    {data:{...savedResult,identity:{...savedIdentity,lot:'11111111'}}},
    {query:'?vin='+car.vin,data:{...savedResult,identity:{...savedIdentity,vin:'WVWZZZ1JZXW000001'}}},{query:id+'&bid_cursor=not-a-cursor'},
    {data:{...savedResult,rex_history:{snapshots:[observed('2026-11-25T00:42:43Z',null)]}}}]) {
    const r=await savedPage(entry);assert.equal(r.response.status,404);assert.ok(!r.html.includes('12,700'));
  }
  for(const status of [429,503]){
    const r=await savedPage({status});assert.equal(r.response.status,503);assert.equal(r.response.headers.get('Retry-After'),'60');
  }
});
test('real budget, Live, comparison and VIN-only card URLs recover a uniquely resolved saved identity',async()=>{
  const partial=['?lot='+car.lot_number+'&platform=iaai','?vin='+car.vin,'?vin='+car.vin+'&platform=iaai','?lot='+car.lot_number];
  for(const query of partial) {
    const r=await savedPage({query});assert.equal(r.response.status,200);assert.deepEqual(r.historyOptions,[{requireUniqueIdentity:true}]);
    assert.ok(r.html.includes('LOT '+car.lot_number) && r.html.includes('VIN '+car.vin));
    const rejected=await savedPage({query,status:409});assert.equal(rejected.response.status,409);
    assert.ok(!rejected.html.includes('$12,700'));
    const withdrawn=await savedPage({query,visible:false});assert.equal(withdrawn.response.status,404);
  }
  const lotMismatch=await savedPage({query:'?lot='+car.lot_number+'&platform=iaai',data:{...savedResult,identity:{...savedIdentity,lot:'99999999'}}});
  assert.equal(lotMismatch.response.status,404);
  const platformMismatch=await savedPage({query:'?lot='+car.lot_number+'&platform=iaai',data:{...savedResult,identity:{...savedIdentity,platform:'copart'}}});
  assert.equal(platformMismatch.response.status,404);
});
test('saved history keeps conflicting same-time bids undecided and paged bids free of a current price label',async()=>{
  const clash={...savedResult,rex_history:{snapshots:[observed('2026-11-25T00:42:43Z',100),observed('2026-11-25T00:42:43Z',200)]},
    meta:{next_cursor:'rexh1_abcdef'}};
  const r=await savedPage({data:clash});assert.equal(r.response.status,200);
  assert.match(r.html,/Pokaż starsze odczyty/);assert.ok(!r.html.includes('Ostatnia zapisana oferta'));
  const older=await savedPage({query:id+'&bid_cursor=rexh1_abcdef'});assert.equal(older.response.status,200);
  assert.ok(older.reads.at(-1).endsWith('&cursor=rexh1_abcdef'));assert.ok(!older.html.includes('Ostatnia zapisana oferta'));
});
test('a later unknown or zero snapshot retains the last positive recorded amount without inventing a bid',async()=>{
  const data={...savedResult,rex_history:{snapshots:[observed('2026-11-25T01:15:00Z',null),
    observed('2026-11-25T01:10:00Z',0),observed('2026-11-25T01:00:00Z',860)]}};
  const result=await savedPage({data});assert.equal(result.response.status,200);
  assert.deepEqual([...new JSDOM(result.html).window.document.querySelectorAll('tbody td:nth-child(2)')].map(e=>e.textContent),
    ['Brak danych','Odczyt 0 USD','$860Ostatnia zapisana oferta']);
});
const receipt={kind:'confirmed_auction_event',provider:'apibara',source_status:'Sold',status:'Sold',timed_cycle_verified:true,
  platform:car.platform,vin:car.vin,lot:car.lot_number,provider_event_id:'chg_119386159',event_key:'feed-timed-result:v1:'+'a'.repeat(64),
  auction_date:'2026-11-24T23:59:00Z',sale_date:'2026-11-24',observed_at:'2026-11-25T00:42:43Z',final_price:12700};
test('a verified Timed outcome is separate from the bid, and does not depend on observing the same bid, a first page or sale-time guesses',async()=>{
  for(const query of [id,id+'&bid_cursor=rexh1_abcdef']){
    const r=await savedPage({query,data:{...savedResult,history:[receipt],rex_history:{snapshots:[]}}});
    assert.equal(r.response.status,200);const doc=new JSDOM(r.html).window.document;
    const result=doc.querySelector('#confirmedAuctionResult');assert.match(result.textContent,/Cena sprzedaży \(USD\)\$12,700/);
    assert.match(result.textContent,/Dzień sprzedaży wg źródła24\.11\.2026/);assert.match(result.textContent,/Termin zakończenia Timed \(Polska\)25\.11\.2026, 00:59:00/);
    assert.match(result.textContent,/Odczyt wyniku \(Polska\)25\.11\.2026, 01:42:43/);assert.equal(doc.querySelector('#observedHistory'),null);
  }
  const singleSource={...savedResult,history:[],read:{history_databases:'legacy'},rex_history:{snapshots:[]}};
  const continued=await savedPage({query:id+'&bid_cursor=rexh1_abcdef',data:singleSource,summary:{...savedResult,history:[receipt]}});
  assert.equal(continued.reads.length,3);assert.match(continued.html,/id="confirmedAuctionResult"/);assert.ok(!continued.html.includes('id="observedHistory"'));
  const incompatible=await savedPage({query:id+'&bid_cursor=rexh1_abcdef',data:singleSource,summary:{...savedResult,history:[receipt],identity:{...savedIdentity,lot:'99999999'}}});
  assert.ok(!incompatible.html.includes('id="confirmedAuctionResult"'));assert.match(incompatible.html,/Wróć do najnowszych/);
  const other={...receipt,event_key:'feed-timed-result:v1:'+'b'.repeat(64),auction_date:'2026-10-24T15:00:00Z',final_price:11900};
  const r=await savedPage({data:{...savedResult,history:[other,receipt]}});
  const doc=new JSDOM(r.html).window.document;assert.equal(doc.querySelectorAll('#confirmedAuctionResult article').length,2);
  assert.match(doc.querySelector('#observedHistory').textContent,/\$12,700Ostatnia zapisana oferta/);
  assert.ok(!doc.querySelector('#observedHistory').textContent.includes('$11,900'));
  for(const change of [{timed_cycle_verified:false},{kind:'observed_snapshot'},{status:'Sold on Approval'},
     {platform:'copart'},{lot:'1'},{vin:'WVWZZZ1JZXW000001'},{final_price:null},{sale_status:'approved',source_status:'Approved'}]){
     const r=await savedPage({data:{...savedResult,history:[{...receipt,...change}]}});assert.ok(!r.html.includes('id="confirmedAuctionResult"'));
  }
  const removed=await savedPage({visible:false,data:{...savedResult,history:[receipt]}});assert.equal(removed.response.status,404);
});
test('recorded bid context uses a source snapshot timestamp with the Polish time zone',()=>{
 const label=require('../public/rexbid-market.js').priceObservationLabel;
 assert.match(label({read:{last_synced_at:'2026-11-17T15:46:07Z'}}),/17\.11\.2026.*16:46.*(?:GMT|UTC)\+1/);
 assert.match(label({last_synced_at:'2026-07-17T15:46:07Z'}),/17:46.*(?:GMT|UTC)\+2/);
 assert.match(label({last_seen_at:'2026-11-17T15:46:07Z'}),/nieustalony/);
 assert.match(label({last_synced_at:'2026-11-17T15:46:07'}),/nieustalony/);
});
const publicShell=fs.readFileSync(require.resolve('../public/car.html'),'utf8');
test('a provider bid timestamp is bound to the displayed current amount and includes seconds in Warsaw',()=>{
 const label=require('../public/rexbid-market.js').priceObservationLabel;
 const input={read:{last_synced_at:'2026-11-24T20:01:32.326Z'},pricing:{current_bid_usd:8100,current_bid_source:'apibara_feed',current_bid_observed_at:'2026-11-24T20:07:24.000Z'}};
 assert.match(label(input,'current_bid',8100),/24\.11\.2026.*21:07:24.*(?:GMT|UTC)\+1/);
 assert.match(label(input),/21:01/);
 assert.equal(label(input,'current_bid',8000),'');
 assert.equal(label(input,'buy_now',8100),'');
 for(const override of [{current_bid_source:'other'}, {current_bid_usd:null},{current_bid_usd:true},{current_bid_observed_at:'2026-11-24T20:07:24'},{current_bid_observed_at:null}])
   assert.equal(label({...input,pricing:{...input.pricing,...override}},'current_bid',8100),'');
});
const fixture=async(query=id,{status=200,json={ok:true,data:car},method='GET',offline=false}={})=>{
 let calls=0;
 const r=await vehiclePage(new Request('https://rexbid.pl/car'+query,{method}),{
  read:async route=>{calls++;assert.ok(route.startsWith('/api/car/'));if(offline)throw Error('offline');return Response.json(json,{status});},
  render:async()=>new Response(publicShell,{headers:{'Content-Type':'text/html','ETag':'old-version'}})
 });
 return {r,body:await r.text(),calls};
};
test('exact source identity produces a stable canonical, truthful text, and a single lookup shared with the browser',async t=>{
 const before=await fixture(id+'&return_to=%2F%3Ffoo');const after=await fixture('?platform=iaai&lot='+car.lot_number);
 assert.equal(before.calls,1);const dom=new JSDOM(before.body,{runScripts:'outside-only',url:'https://rexbid.pl/car'+id});t.after(()=>dom.window.close());
 const w=dom.window,d=w.document;const c=d.querySelector('link[rel=canonical]').href;assert.equal(c,'https://rexbid.pl/car?platform=iaai&lot='+car.lot_number+'&vin='+car.vin);
 assert.ok(after.body.includes(c.replaceAll('&','&amp;')));assert.match(d.title,/2024 Toyota RAV4/);assert.equal(d.querySelector('#page h1').textContent,car.title);
 assert.ok(d.querySelector('[name=description]').content.includes(car.vin));assert.equal(before.r.headers.get('etag'),null);
 let browserCalls=0;w.fetch=async()=>{browserCalls++;throw Error('unnecessary detail call');};
 const boot=[...d.scripts].find(s=>s.textContent.includes('const initialVehicleRequest'));
 const record=await w.eval(boot.textContent+'\ninitialVehicleRequest;');
 assert.equal(record.vin,car.vin);assert.equal(browserCalls,0);assert.equal(d.getElementById('rexbid-vehicle-data'),null);
});
test('inert snapshot and metadata encode source-controlled strings',async t=>{
 const title='X </script><img src=x> $& " &';const {body}=await fixture(id,{json:{ok:true,data:{...car,title}}});
 const dom=new JSDOM(body);t.after(()=>dom.window.close());const d=dom.window.document;
 assert.equal(d.querySelector('#page h1').textContent,title);assert.equal(d.querySelectorAll('#page img').length,0);
 assert.equal(JSON.parse(d.getElementById('rexbid-vehicle-data').textContent).title,title);
});
test('confirmed absences have real 404, outages have 503 and unknown IDs keep the public legacy lookup',async()=>{
 for(const error of ['vehicle_not_in_saved_catalog','auction_date_pending']){const f=await fixture(id,{status:404,json:{error}});assert.equal(f.r.status,404);assert.match(f.r.headers.get('X-Robots-Tag'),/noindex/);}
 for(const opts of [{offline:true},{status:503,json:{error:'unavailable'}},{status:404,json:{error:'unexpected'}}]){const f=await fixture(id,opts);assert.equal(f.r.status,503);assert.equal(f.r.headers.get('Retry-After'),'60');}
 assert.equal((await fixture(id,{status:409,json:{error:'ambiguous'}})).r.status,409);
 assert.equal((await fixture('?vin=partial')).calls,0);assert.equal((await fixture('')).r.status,404);
 assert.equal((await fixture(id.replace('iaai','copart'))).r.status,404);
 const noPhotos=await fixture(id,{json:{ok:true,data:{...car,media:{}}}});assert.match(noPhotos.r.headers.get('X-Robots-Tag'),/noindex/);
 const head=await fixture(id,{method:'HEAD'});assert.equal(head.r.status,200);assert.equal(head.body,'');assert.equal(head.calls,1);
});
