'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {KEY,identify,profiles,refresh,fallback,readWithFallback}=require('../sync/catalog-backup.cjs');
const at=Date.parse('2026-11-22T13:15:00Z');
const request=path=>new Request('https://rexbid.pl'+path);
const state={id:42,seq:100,active:null,observed:'2026-11-22T12:30:00.000Z',published:'2026-11-22T13:12:00.000Z'};
function fixture(){
 let data,etag=0;
 const x={at,first:{...state},after:{...state},readCount:0,puts:0};
 const bucket={async get(key){
  assert.equal(key,KEY);
  return data?{size:Buffer.byteLength(data),etag:String(etag),json:async()=>JSON.parse(data)}:null;
 },async put(key,value,options){
  assert.equal(key,KEY);assert.deepEqual(options.onlyIf,data?{etagMatches:String(etag)}:{etagDoesNotMatch:'*'});
  x.puts++;data=value;return {etag:String(++etag)};
 }};
 x.env={REXBID_PUBLIC_CATALOG_BACKUP:'enabled',REXBID_AUCTION_ARCHIVE:bucket,REXBID_ACTIVE_CATALOG:{prepare(){
  return {first:async()=>x.readCount===0?x.first:x.after};
 }}};
 x.read=async req=>{
  x.readCount++;
  const url=new URL(req.url),second=url.searchParams.has('cursor');
  if(url.pathname.endsWith('/filters'))return Response.json({ok:true,data:{makes:['Subaru'],years:[2025]}});
  return Response.json({ok:true,data:[{platform:'copart',lot_number:second?'12345679':'12345678'}],
   meta:{next_cursor:second?'native-third':'native-second'}});
 };
 x.publish=()=>refresh(x.env,x.read,()=>x.at);
 x.fallback=path=>fallback(request(path),x.env,()=>x.at);
 return x;
}

test('the configured public homepage and list requests have exact matching backup profiles',()=>{
 for(const p of profiles(at)){
  assert.deepEqual(identify(request(p.path),at),{key:p.key,cursor:null});
 }
 assert.deepEqual(identify(request('/api/cars?category=timed&view=cards&per_page=20&lot_status=Timed&sort=auction_next'),at),{key:'list:timed',cursor:null});
 for(const q of ['view=cards&make=Volvo','view=cards&sort=recent','view=cards&category=timed&lot_status=Buy+Now','view=cards&view=cards','view=cards&platform=copart&category=current']){
  assert.equal(identify(request('/api/cars?'+q),at),null);
 }
});
test('copies complete published observations and preserves native second-page continuity during an outage',async()=>{
 const f=fixture(),saved=await f.publish();
 assert.equal(saved.generation,42);assert.equal(saved.profiles,15);assert.equal(f.puts,1);
 const path='/api/cars?category=timed&view=cards';
 const first=await f.fallback(path),body=await first.json();
 assert.equal(first.status,200);assert.equal(first.headers.get('X-RexBid-Read-Source'),'r2-backup');
 assert.equal(body.meta.backup_observed_at,state.observed);assert.equal(body.meta.catalog_complete,false);
 assert.equal(body.data[0].read.freshness,'stale');assert.equal(body.data[0].read.data_status,'last_known');
 const next=await (await f.fallback(path+'&cursor='+body.meta.next_cursor)).json();
 assert.equal(next.data[0].lot_number,'12345679');assert.equal(next.meta.next_cursor,null);
 assert.equal(await f.fallback(path+'&cursor=other'),null);
 assert.equal(await f.fallback('/api/portal/orders'),null);
 assert.equal(await f.fallback('/api/cars?view=cards&make=volvo'),null);
 f.at+=2*86400000;
 assert.equal(await f.fallback(path),null);
});
test('refuses active or changed generations and incomplete reads without replacing the verified copy',async()=>{
 const f=fixture();
 f.first.active=43;
 assert.equal((await f.publish()).status,'import_active');assert.equal(f.puts,0);
 f.first.active=null;f.after.seq=101;
 assert.equal((await f.publish()).status,'catalog_changed');assert.equal(f.puts,0);
 f.after.seq=100;f.readCount=0;await f.publish();
 f.at+=13*60000;f.readCount=0;f.first.id=f.after.id=43;f.first.seq=f.after.seq=101;
 f.read=async()=>new Response(null,{status:503});
 await assert.rejects(f.publish(),/catalog_backup_read/);
 assert.equal(f.puts,1);
 assert.equal((await f.fallback('/api/cars?view=cards')).headers.get('X-RexBid-Backup-Generation'),'42');
});
test('a slow D1 query gives way to the verified copy, while a quick valid response keeps priority',async()=>{
 const f=fixture();f.at=Date.now();await f.publish();
 const route=request('/api/cars?category=electric&view=cards');
 const live=Response.json({ok:true,data:[]});
 assert.equal(await readWithFallback(route,f.env,()=>live,5),live);
 let finish;
 const slow=new Promise(resolve=>{finish=resolve;});
 const saved=await readWithFallback(route,f.env,()=>slow,5);
 assert.equal(saved.headers.get('X-RexBid-Read-Source'),'r2-backup');
 finish(new Response(null,{status:503}));
});
test('an exact copied offer opens read-only while unavailable identities and ambiguous platforms fail closed',async()=>{
 const f=fixture();await f.publish();
 const response=await f.fallback('/api/car/12345678?platform=copart'),body=await response.json();
 assert.equal(body.match,'exact');assert.equal(body.data.lot_number,'12345678');
 assert.equal(body.data.preview.read_only,true);assert.equal(body.data.preview.last_synced_at,state.observed);
 assert.equal(await f.fallback('/api/car/12345678?platform=iaai'),null);
 assert.equal(await f.fallback('/api/car/12345678/history'),null);
 assert.equal(await f.fallback('/api/car/87654321'),null);
 const search=await (await f.fallback('/api/cars?view=cards&s=12345678')).json();
 assert.equal(search.data.length,1);
});
