'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib');
const {normalize,collect,refresh,KEY,RESERVE}=require('../sync/timed-iaai-refresh.cjs');
const {readTimed}=require('../sync/timed-iaai-read.cjs');
const at=Date.parse('2026-11-20T21:22:00Z');
const iso=x=>new Date(x).toISOString();
const lot='46360003',vin='1FADP5AU8DL509002';
function raw(changes={}){
 return {platform:'iaai',lot_number:lot,vin,manufacturer:'Ford',make:'FORD',model:'C-MAX',title:'2025 FORD C-MAX',year:2025,
  updated_at:iso(at-1000),auction:{is_timed:true,state:'open',timed_end_at:iso(at+120000)},
  pricing:{current_bid_usd:1250,final_price_usd:7000},media:{items:[{type:'image',url:'https://vis.iaai.com/photo.jpg'}]},...changes};
}
function fakeVendor(rows,quota=76000){
 return async url=>{
  if(String(url).endsWith('/usage'))return Response.json({ok:true,data:{quota:{left:quota}}});
  const params=new URL(url).searchParams,c=params.get('cursor');
  const page=rows[c?'next':'first'];
  return Response.json({ok:true,data:page.rows,meta:{sort:'auction_soonest',view:'full',per_page:20,total:rows.total,total_is_exact:true,
   applied_filters:Object.fromEntries(params),unknown_filters:[],has_more:page.next!==null,next_cursor:page.next}});
 };
}
const entry=(id,end,year=2025)=>({...normalize(raw({lot_number:id,year}),at),auction:{...normalize(raw(),at).auction,timed_end_at:iso(end)}});
const bucketFor=s=>({get:async()=>{const z=gzipSync(JSON.stringify(s));return {size:z.length,body:new Blob([z]).stream()};}});
const sample=(entries,at0=at)=>({schema:1,observed:iso(at0),entries});
const response=x=>({response:Response.json(x)});
const req=path=>new Request('https://rexbid.pl'+path);
const env=bucket=>({REXBID_TIMED_IAAI_ENABLED:'enabled',REXBID_AUCTION_ARCHIVE:bucket});
const never=()=>{throw Error('D1 called');};

test('accept only matching dated open IAAI and never copy historic price into current bid',()=>{
 const dto=normalize(raw(),at);
 assert.equal(dto.lot_number,lot);assert.equal(dto.pricing.final_price_usd,null);
 assert.equal(dto.pricing.current_bid_usd,1250);assert.equal(dto.auction.auction_at,null);
 assert.equal(dto.media.items.length,1);
 for(const input of [raw({platform:'copart'}),raw({auction:{...raw().auction,state:'finished'}}),
  raw({auction:{...raw().auction,result_confirmed:true}}),raw({auction:{...raw().auction,timed_end_at:'2026-11-20T23:40:00'}}),
  raw({auction:{...raw().auction,timed_end_at:iso(at-1)}})])assert.equal(normalize(input,at),null);
});
test('complete cursor scan only and quotas fail closed',async()=>{
 const vendor=fakeVendor({total:2,first:{rows:[raw()],next:'second'},next:{rows:[raw({lot_number:'46360004'})],next:null}});
 const res=await collect({key:'test',fetchImpl:vendor,now:()=>at});
 assert.equal(res.pages,2);assert.equal(res.entries.length,2);
 await assert.rejects(collect({key:'test',fetchImpl:fakeVendor({},RESERVE),now:()=>at}),/TIMED_QUOTA_RESERVE/);
 await assert.rejects(collect({key:'test',fetchImpl:fakeVendor({total:100,first:{rows:[raw()],next:null}}),now:()=>at}),/TIMED_SOURCE_INCOMPLETE/);
 await assert.rejects(collect({key:'test',fetchImpl:fakeVendor({total:2,first:{rows:[raw()],next:'again'},next:{rows:[raw()],next:'again'}}),now:()=>at}),/TIMED_SOURCE_CURSOR/);
});
test('the Worker sends authenticated Timed requests without following a redirect',async()=>{
 let calls=0;
 const denyRedirect=async(url,options)=>{
  calls++;
  assert.equal(new URL(url).origin,'https://apibara.tech');
  assert.equal(options.redirect,'manual');
  assert.equal(options.headers['X-API-Key'],'test');
  return new Response(null,{status:302,headers:{Location:'https://example.invalid/other'}});
 };
 await assert.rejects(collect({key:'test',fetchImpl:denyRedirect,now:()=>at}),/TIMED_SOURCE_302/);
 assert.equal(calls,1);
});
test('failed scan never replaces current snapshot and triggers bounded retry',async()=>{
 const writes=[];
 const bucket={head:async()=>null,put:async(...a)=>{writes.push(a);return {};}};
 await assert.rejects(refresh({...env(bucket),APIBARA_API_KEY:'test'},{now:()=>at,fetchImpl:fakeVendor({},RESERVE)}),/TIMED_QUOTA_RESERVE/);
 assert.deepEqual(writes.map(x=>x[0]),[KEY+'.attempt']);
});
test('the scheduled refresh replaces an old failed-attempt marker once and keeps the cooldown',async()=>{
 let marker={etag:'previous',customMetadata:{until:iso(at+3600000)}};
 let calls=0;
 const bucket={
  head:async key=>key===KEY+'.attempt'?marker:null,
  put:async(key,_body,options)=>{
   assert.equal(key,KEY+'.attempt');
   assert.equal(options.onlyIf.etagMatches,marker.etag);
   marker={etag:'current',customMetadata:options.customMetadata};
   return marker;
  },
 };
 const limited=async()=>{calls++;return Response.json({ok:true,data:{quota:{left:RESERVE}}});};
 await assert.rejects(refresh({...env(bucket),APIBARA_API_KEY:'test'},{now:()=>at,fetchImpl:limited}),/TIMED_QUOTA_RESERVE/);
 assert.equal(calls,1);
 assert.deepEqual(await refresh({...env(bucket),APIBARA_API_KEY:'test'},{now:()=>at+1000,fetchImpl:limited}),{status:'retry_delay'});
 assert.equal(calls,1);
});
test('catalogue applies dates, year, covers and keyset pagination without repeats',async()=>{
 const b=bucketFor(sample([entry(lot,at+120000),entry('46360004',at+130000,2024),entry('46360005',at+140000,2023),entry('46360006',at-1)]));
 const path='/api/cars?category=timed&view=cards&per_page=1';
 const r=await (await readTimed(req(path+'&year_from=2024'),env(b),never,at)).response.json();
 assert.equal(r.data[0].lot_number,lot);assert.ok(r.data[0].image);assert.ok(r.meta.next_cursor);
 const p=await (await readTimed(req(path+'&year_from=2024&cursor='+encodeURIComponent(r.meta.next_cursor)),env(b),never,at)).response.json();
 assert.equal(p.data[0].lot_number,'46360004');assert.equal(p.meta.next_cursor,null);
 const home=await (await readTimed(req('/api/cars?category=timed&view=showcase&home_week=1&with_photo=1'),env(b),never,at)).response.json();
 assert.equal(home.data.length,3);assert.equal(home.data[0].media,undefined);
 assert.equal(await readTimed(req('/api/cars?category=timed&platform=copart'),env(b),never,at),null);
 assert.equal(await readTimed(req('/api/cars?category=electric'),env(b),never,at),null);
});
test('expired entries and stale or missing snapshot fall back; newer ended data takes precedence',async()=>{
 const old=sample([entry(lot,at+2*60e3)],at-9*3600000);
 assert.equal(await readTimed(req('/api/cars?category=timed'),env(bucketFor(old)),never,at),null);
 const data=env(bucketFor(sample([entry(lot,at+120000)])));
 const path='/api/car/'+lot+'?platform=iaai';
 const result=await readTimed(req(path),data,()=>({response:new Response(null,{status:404})}),at);
 assert.equal((await result.response.json()).data.auction.is_timed,true);
 assert.equal(await readTimed(req(path),data,never,at+130000),null);
 const ended={data:{lot_number:lot,vin,platform:'iaai',last_seen_at:iso(at+1900),auction:{state:'ended'}}};
 const kept=await readTimed(req(path),data,()=>response(ended),at+2000);
 assert.deepEqual(await kept.response.json(),ended);
});
test('expired snapshot metadata skips decompression on the timed list and IAAI card',async()=>{
 const expired=iso(at-9*3600000),current=iso(at-1000),path='/api/cars?category=timed';
 for(const metadata of [{customMetadata:{observed:expired},uploaded:current},{uploaded:new Date(expired)}]){
  let cancelled=0,gets=0;
  const bucket={get:async()=>{gets++;return{...metadata,size:1024,body:{
   pipeThrough(){assert.fail('expired body must not be decompressed');},
   cancel(){cancelled++;},
  }};}};
  assert.equal(await readTimed(req(path),env(bucket),never,at),null);
  assert.equal(await readTimed(req('/api/car/'+lot+'?platform=iaai'),env(bucket),never,at),null);
  assert.equal(cancelled,1);
  assert.equal(gets,1);
 }
 const fresh=bucketFor(sample([entry(lot,at+120000)]));
 const result=await readTimed(req(path),env({get:async()=>({
  ...await fresh.get(),uploaded:current,customMetadata:{observed:current},
 })}),never,at);
 assert.equal((await result.response.json()).data[0].lot_number,lot);
});
