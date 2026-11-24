'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {handleArchive} = require('../sync/auction-archive-public.cjs');

const archived = {platform:'copart',lot:'59807226',vin:'3KPF24AD6RE719531',year:2018,title:'KIA Forte',
  sequence:103110000,recordedAt:'2026-11-17T10:30:00Z',saleCents:350000,visible:true,photos:['01.jpg']};
const other = {...archived,sequence:103500000,year:2024};
const jpeg = new Uint8Array(64);
jpeg.set([255,216,255]);
jpeg.set([255,217],62);
const image = '/archiwum-zdjecie/copart/59807226/103110000/01.jpg';

function fixture(entries = [archived,other]) {
  const requests = [];
  const env = {REXBID_AUCTION_ARCHIVE: {async get(key) {
    requests.push(key);
    if (key==='v1/public/index.json') return {size:100,json:async()=>({version:1,entries})};
    if (key.endsWith('/01.jpg')) return {size:64,httpMetadata:{contentType:'image/jpeg'},arrayBuffer:async()=>jpeg.buffer};
    return null;
  }}};
  return {env, requests};
}
const request = (path,method='GET') => new Request('https://rexbid.pl'+path,{method});

test('VIN and LOT find two separate auctions and publish only archive URLs',async()=>{
  const {env} = fixture();
  for (const value of [archived.vin,archived.lot]) {
    const result=await handleArchive(request('/api/archiwum?q='+value),env,new Date('2026-11-17'));
    const {entries}=await result.json();
    assert.deepEqual(entries.map(e=>e.sequence),[other.sequence,archived.sequence]);
    assert.equal(entries[1].photos[0],image);
  }
});

test('both lookup and direct photo enforce visibility and model-year rollover',async()=>{
  const {env,requests}=fixture();
  assert.equal((await handleArchive(request(image),env,new Date('2027-01-01T00:00:01+01:00'))).status,404);
  const entries=(await (await handleArchive(request('/api/archiwum'),env,new Date('2027-01-01'))).json()).entries;
  assert.equal(entries.length,1);
  assert.ok(requests.every(key=>key==='v1/public/index.json'));
  const hidden=fixture([{...archived,visible:false},other]);
  assert.equal((await handleArchive(request(image),hidden.env,new Date('2026-11-17'))).status,404);
  assert.equal(hidden.requests.length,1);
});

test('serves only a registered photograph and correctly treats HEAD',async()=>{
  const {env,requests}=fixture();
  const result=await handleArchive(request(image),env,new Date('2026-11-17'));
  assert.equal(result.headers.get('Content-Type'),'image/jpeg');
  assert.equal(result.headers.get('Cache-Control'),'no-store');
  assert.equal((await result.arrayBuffer()).byteLength,64);
  const head=await handleArchive(request(image,'HEAD'),env,new Date('2026-11-17'));
  assert.equal(head.body,null);
  assert.equal(head.headers.get('Content-Length'),'64');
  const missing=await handleArchive(request(image.replace('01.jpg','02.jpg')),env,new Date('2026-11-17'));
  assert.equal(missing.status,404);
  assert.equal(requests.filter(x=>x.endsWith('/02.jpg')).length,0);
});

test('invalid queries and mutations do not hit storage',async()=>{
  const {env,requests}=fixture();
  assert.equal((await handleArchive(request('/api/archiwum?q=%3Ctag%3E'),env)).status,400);
  assert.equal((await handleArchive(request(image,'POST'),env)).status,405);
  assert.equal((await handleArchive(request('/api/cars'),env)),null);
  assert.equal(requests.length,0);
});

test('an index with 5000 galleries stays readable and paginates after the old limit',async()=>{
  const entries=Array.from({length:5000},(_,i)=>({
    ...other,sequence:103200000+i,lot:String(60000000+i),
    title:'Ą'.repeat(160),
    photoBytes:Array(22).fill(64),
    photos:Array.from({length:22},(_,k)=>String(k+1).padStart(2,'0')+'.jpg')
  }));
  const {MAX_ENTRIES,MAX_INDEX_BYTES}=require('../sync/auction-archive-state.cjs');
  assert.equal(MAX_ENTRIES,500_000);
  assert.ok(Buffer.byteLength(JSON.stringify({version:1,entries}))<MAX_INDEX_BYTES);
  const {env}=fixture(entries);
  const date=new Date('2026-11-17');
  const first=await (await handleArchive(request('/api/archiwum'),env,date)).json();
  assert.equal(first.entries.length,12);
  const next=await (await handleArchive(request('/api/archiwum?before='+first.next),env,date)).json();
  assert.equal(next.entries[0].sequence,103204987);
  const specific=await (await handleArchive(request('/api/archiwum?q=60000000'),env,date)).json();
  assert.equal(specific.entries[0].photos.length,22);
});

test('cached packed photo uses the JPEG length rather than the whole gallery length',async()=>{
 const original=globalThis.caches,stored=new Map(),pending=[];globalThis.caches={default:{match:async key=>stored.get(key)?.clone(),put:async(key,r)=>{stored.set(key,r);}}};
 try{
  const item={...archived,photos:['01.jpg','02.jpg'],photoBytes:[64,64]};
  const env={REXBID_AUCTION_ARCHIVE:{get:async key=>key==='v1/public/index.json'?{size:100,json:async()=>({version:1,entries:[item]})}:{size:128,httpMetadata:{contentType:'application/octet-stream'},arrayBuffer:async()=>jpeg.buffer}}},context={waitUntil:p=>pending.push(p)};
  let r=await handleArchive(request(image),env,new Date('2026-11-17'),context);assert.equal((await r.arrayBuffer()).byteLength,64);await Promise.all(pending);
  r=await handleArchive(request(image),env,new Date('2026-11-17'),context);assert.equal(r.headers.get('Content-Length'),'64');assert.equal((await r.arrayBuffer()).byteLength,64);
 }finally{globalThis.caches=original;}
});
