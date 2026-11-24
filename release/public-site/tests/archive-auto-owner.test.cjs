'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {gzipSync}=require('node:zlib');
const {hash}=require('../sync/auction-archive-state.cjs');
const {runArchive}=require('../sync/auction-archive-intake.cjs');
const {createOwnerArchiveHandler}=require('../portal/archive-control.cjs');
const {handleArchive}=require('../sync/auction-archive-public.cjs');

const VIN='3KPF24AD6RE719531', lot='59807226', now=Date.parse('2026-11-17T12:00:00Z');
const INDEX='v1/public/index.json';
const JPEG=new Uint8Array(80);
JPEG.set([255,216,255]); JPEG.set([255,217],78);
const sample={platform:'copart',lot_number:lot,vin:VIN};
const archiveRow={platform:'copart',lot,vin_normalized:VIN,year:2018,vehicle_title:'Kia',
  first_seen_at:'2026-11-01T12:00:00Z',last_seen_at:'2026-11-05T12:00:00Z',
  media_urls_json:JSON.stringify([1,2].map(x=>'https://cs.copart.com/v1/AUTH_svc.pdoc00001/test'+x+'.jpg'))};
function bucket(){
  const values=new Map(), revisions=new Map();
  return {values,async get(key,options){
    if(!values.has(key))return null;
    const data=values.get(key), type=revisions.get(key).contentType;
    const range=options?.range;
    const selected=range?data.slice(range.offset,range.offset+range.length):data;
    return {etag:revisions.get(key).etag,size:data.byteLength,body:new Response(selected).body,
      httpMetadata:{contentType:type},json:()=>new Response(selected).json(),arrayBuffer:()=>new Response(selected).arrayBuffer()};
  },async put(key,value,opts={}){
    if(opts.onlyIf&&opts.onlyIf.etagMatches!==revisions.get(key)?.etag)return null;
    const etag=String(Number(revisions.get(key)?.etag??0)+1);
    const data=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);
    values.set(key,data);
    revisions.set(key,{etag,contentType:opts.httpMetadata?.contentType});
    return {etag};
  },async delete(keys){for(const key of keys){values.delete(key);revisions.delete(key);}}};
}
async function fixture({row=archiveRow,legacyRows=null,terminal=true,fetchImage=async()=>new Response(JPEG,{headers:{'Content-Type':'image/jpeg'}})}={}){
  const target=bucket(),feed=bucket();
  await target.put(INDEX,JSON.stringify({version:1,entries:[]}));
  const payload=gzipSync(JSON.stringify({sequence:10,event:'lot.sold',reason:'source_outcome',
    terminal,vehicle:sample,recorded_at:'2026-11-17T11:58:20Z',
    after:{'auction.lot_sold':'1','auction.last_sold_status':'Sold','pricing.last_sold_price_usd':2200}})+'\n');
  await feed.put('raw.gz',payload);
  const generation={generation_id:17245,first_sequence:10,last_sequence:10,raw_key:'raw.gz',
    compressed_bytes:payload.length,sha256:await hash(payload)};
  const env={REXBID_AUCTION_ARCHIVE:target,REXBID_ARCHIVE_FEED:feed,AUTH_CANONICAL_ORIGIN:'https://rexbid.pl',
    REXBID_OWNER_USER_ID:'owner',REXBID_ARCHIVE_CATALOG:{prepare(query){
      return {bind(first,requestedLot){return {first:async()=>first<=generation.generation_id?generation:null,
        all:async()=>{assert.match(query,/^SELECT/);return {results:row&&(!requestedLot||requestedLot===lot)?[row]:[]};}};}};
    }}};
  if(legacyRows)env.REXBID_ARCHIVE_LEGACY={prepare(query){
    assert.match(query,/^SELECT.+\n.+JOIN vehicle_sources/s);
    return {bind(...params){
      assert.deepEqual(params,['copart',lot,VIN,lot]);
      return {all:async()=>({results:legacyRows})};
    }};
  }};
  return {env,target,run:()=>runArchive(env,{now:()=>now,fetchImage})};
}

test('publishes a completed sale with two actual objects, exact VIN lookup and no repeat write',async()=>{
  const {env,run,target}=await fixture();
  const first=await run();
  assert.equal(first.saved,1);
  assert.equal(first.generation,17245);
  assert.equal(target.values.size,3);
  const before=(await target.get(INDEX)).etag;
  assert.equal((await run()).status,'idle');
  assert.equal((await target.get(INDEX)).etag,before);
  const request=new Request('https://rexbid.pl/api/archiwum?q='+VIN);
  const {entries}=await (await handleArchive(request,env,new Date(now))).json();
  assert.equal(entries[0].saleCents,220000);
  assert.equal(entries[0].photos.length,2);
});
test('packed galleries return exactly one JPEG, with its original bytes and public URL',async()=>{
  const second=JPEG.slice();
  second[4]=123;
  const {env,run,target}=await fixture({fetchImage:async url=>new Response(url.endsWith('2.jpg')?second:JPEG,
    {headers:{'Content-Type':'image/jpeg'}})});
  await run();
  const keys=[...target.values.keys()];
  assert.equal(keys.filter(key=>key.endsWith('/gallery.bin')).length,1);
  assert.equal(keys.filter(key=>key.endsWith('.jpg')).length,0);
  const path='/archiwum-zdjecie/copart/'+lot+'/10/02.jpg';
  const request=(method='GET')=>new Request('https://rexbid.pl'+path,{method});
  const response=await handleArchive(request(),env,new Date(now));
  assert.equal(response.status,200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),second);
  const head=await handleArchive(request('HEAD'),env,new Date(now));
  assert.equal(head.headers.get('Content-Length'),String(second.length));
  assert.equal(head.body,null);
});
test('a lot with missing JPEGs waits without publishing or inventing a result',async()=>{
  const {run,target}=await fixture({fetchImage:async()=>new Response(null,{status:404})});
  assert.equal((await run()).saved,0);
  assert.equal((await (await target.get(INDEX)).json()).waiting.length,1);
  assert.equal(target.values.size,1);
});
test('source galleries longer than the archive limit keep up to 22 allowlisted photos',async()=>{
  const origin='https://cs.copart.com/v1/AUTH_svc.pdoc00001/';
  const photos=['https://other.example/skip.jpg',...Array.from({length:23},(_,i)=>origin+i+'.jpg')];
  const downloaded=[];
  const {run,target}=await fixture({
    row:{...archiveRow,media_urls_json:JSON.stringify(photos)},
    fetchImage:async url=>{
      downloaded.push(url);
      return new Response(JPEG,{headers:{'Content-Type':'image/jpeg'}});
    }
  });
  assert.equal((await run()).saved,1);
  assert.deepEqual(downloaded,photos.slice(1,23));
  const index=await (await target.get(INDEX)).json();
  assert.equal(index.entries[0].photos.length,22);
  assert.equal(index.waiting.length,0);
});
test('older models and non-terminal changes stay out',async()=>{
  for(const opts of [{row:{...archiveRow,year:2017}},{terminal:false}]){
    const {run,target}=await fixture(opts);
    assert.equal((await run()).saved,0);
    assert.equal(target.values.size,1);
  }
});
test('recovers a missing gallery from a unique earlier listing and uses the sale from the current feed',async()=>{
  for(const row of [null,{...archiveRow,media_urls_json:'[]'}]){
    const {env,run}=await fixture({row,legacyRows:[archiveRow]});
    const result=await run();
    assert.equal(result.saved,1);
    assert.equal(result.photoDiagnostics.earlierCatalog,1);
    const query=new Request('https://rexbid.pl/api/archiwum?q='+VIN);
    const {entries}=await (await handleArchive(query,env,new Date(now))).json();
    assert.equal(entries[0].saleCents,220000);
    assert.equal(entries[0].photos.length,2);
  }
});
test('never recovers from a later or ambiguous listing',async()=>{
  for(const legacyRows of [
    [{...archiveRow,last_seen_at:'2026-11-18T00:00:00Z'}],
    [archiveRow,archiveRow]
  ]){
    const {run}=await fixture({row:null,legacyRows});
    assert.equal((await run()).saved,0);
  }
});
test('temporary failure of the earlier catalog keeps the event queued',async()=>{
  const {env,run,target}=await fixture({row:null});
  env.REXBID_ARCHIVE_LEGACY={prepare(){throw Error('offline');}};
  const result=await run();
  assert.equal(result.status,'complete');
  assert.equal(result.photoDiagnostics.earlierCatalogReadFailed,1);
  assert.equal((await (await target.get(INDEX)).json()).waiting.length,1);
});
test('owner requires identity, MFA, local origin and repeated VIN, removes JPEG and blocks reimport',async()=>{
  const {env,run,target}=await fixture();
  await run();
  const original=await (await target.get(INDEX)).json();
  const account=(id,assurance)=>createOwnerArchiveHandler(async()=>({status:200,user:{id},assurance_level:assurance}));
  const owner=account('owner','aal2');
  const post=(origin,confirm=VIN)=>new Request('https://rexbid.pl/api/portal/archive',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({vin:VIN,confirm,reason:'ownership'})});
  assert.equal((await account('client','aal2')(post('https://rexbid.pl'),env)).status,403);
  assert.equal((await account('owner','aal1')(post('https://rexbid.pl'),env)).status,403);
  assert.equal((await owner(post('https://example.com'),env)).status,403);
  assert.equal((await owner(post('https://rexbid.pl','WRONG'),env)).status,400);
  assert.equal((await owner(post('https://rexbid.pl'),env)).status,200);
  const removed=await (await target.get(INDEX)).json();
  assert.equal(removed.entries.length,0);
  assert.equal(removed.hidden.length,1);
  assert.equal(target.values.size,1);
  await target.put(INDEX,JSON.stringify({...removed,generation:17229,offset:0}));
  assert.equal((await run()).saved,0);
  assert.equal(target.values.size,1);
  assert.equal(original.entries.length,1);
});


test('continues above the old byte limit and protects the new byte limit',async()=>{
  const {MAX_ARCHIVE_BYTES}=require('../sync/auction-archive-state.cjs');
  assert.equal(MAX_ARCHIVE_BYTES,299_100_000_000);
  const accept=await fixture();
  await accept.target.put(INDEX,JSON.stringify({version:1,entries:[],allocatedBytes:2_000_000_000}));
  assert.equal((await accept.run()).saved,1);

  const protect=await fixture();
  await protect.target.put(INDEX,JSON.stringify({version:1,entries:[],allocatedBytes:MAX_ARCHIVE_BYTES-1}));
  assert.equal((await protect.run()).saved,0);
  const state=await (await protect.target.get(INDEX)).json();
  assert.equal(state.allocatedBytes,MAX_ARCHIVE_BYTES-1);
  assert.equal(protect.target.values.size,1);
});

test('a full retry queue and low storage never acknowledge the unpublished next source event',async()=>{
  const {MAX_ARCHIVE_BYTES}=require('../sync/auction-archive-state.cjs');
  const f=await fixture();
  const waiting=Array.from({length:120},(_,i)=>({platform:'copart',lot:String(80000000+i),vin:VIN,
    sequence:1000+i,recordedAt:'2026-11-17T11:58:20Z',generation:17229,status:'ended_unknown',saleCents:null,eventDay:'2026-11-17'}));
  await f.target.put(INDEX,JSON.stringify({version:1,entries:[],generation:17229,offset:0,
    allocatedBytes:MAX_ARCHIVE_BYTES-1,waiting}));
  assert.equal((await f.run()).saved,0);
  const blocked=await (await f.target.get(INDEX)).json();
  assert.equal(blocked.generation,17229);
  assert.equal(blocked.offset,0);
  assert.equal(blocked.waiting.length,120);
  await f.target.put(INDEX,JSON.stringify({...blocked,allocatedBytes:16_000_000}));
  assert.equal((await f.run()).saved,1);
  const recovered=await (await f.target.get(INDEX)).json();
  assert.equal(recovered.entries.length,1);
  assert.equal(recovered.entries[0].sequence,10);
});
