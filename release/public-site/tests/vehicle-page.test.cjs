'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {vehiclePage}=require('../sync/vehicle-page.cjs');
const car={platform:'iaai',vin:'2T3A1RFV7RW473296',lot_number:'45111614',title:'2024 Toyota RAV4',location:{display:'Portland West'},media:{thumbs:['example.jpg']}};
const id='?vin='+car.vin+'&lot='+car.lot_number+'&platform=iaai';
test('recorded bid context uses a source snapshot timestamp with the Polish time zone',()=>{
 const label=require('../public/rexbid-market.js').priceObservationLabel;
 assert.match(label({read:{last_synced_at:'2026-11-17T15:46:07Z'}}),/17\.11\.2026.*16:46.*(?:GMT|UTC)\+1/);
 assert.match(label({last_synced_at:'2026-07-17T15:46:07Z'}),/17:46.*(?:GMT|UTC)\+2/);
 assert.match(label({last_seen_at:'2026-11-17T15:46:07Z'}),/nieustalony/);
 assert.match(label({last_synced_at:'2026-11-17T15:46:07'}),/nieustalony/);
});
const publicShell=fs.readFileSync(require.resolve('../public/car.html'),'utf8');
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
