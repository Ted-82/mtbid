'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {getIndex,saveIndex}=require('../sync/auction-archive-state.cjs');
const {queryEntries,count,withoutVin,updateEntry}=require('../sync/auction-archive-segments.cjs');
const {handleArchive}=require('../sync/auction-archive-public.cjs');
const {createOwnerArchiveHandler}=require('../portal/archive-control.cjs');
const INDEX='v1/public/index.json',VIN='3KPF24AD6RE719531';
function bucket(){let serial=0;const values=new Map(),reads=[];return{values,reads,failRoot:false,async get(key){reads.push(key);const x=values.get(key);return x?{etag:x.etag,size:Buffer.byteLength(x.text),json:async()=>JSON.parse(x.text)}:null;},async put(key,text,options={}){if(key===INDEX&&this.failRoot)return null;if(options.onlyIf&&options.onlyIf.etagMatches!==values.get(key)?.etag)return null;const etag=String(++serial);values.set(key,{text,etag});return{etag};},async delete(keys){for(const k of keys)values.delete(k);}};}
function entry(i){return{platform:i%2?'copart':'iaai',lot:String(60000000+i),vin:'3KPF24AD6RE'+String(i).padStart(6,'0'),sequence:100000+i,year:2024,title:'Archive car',recordedAt:'2026-11-18T08:00:00Z',status:'ended_unknown',saleCents:null,visible:true,photos:['01.jpg','02.jpg'],photoBytes:[64,64]};}
async function fixture(n=6200){const b=bucket(),entries=Array.from({length:n},(_,i)=>entry(i));if(entries[13])entries[13].vin=VIN;entries[n-1].vin=VIN;await b.put(INDEX,JSON.stringify({version:1,entries,allocatedBytes:n*128,hidden:[],deletions:[]}));return{b,entries};}
test('v1 to paged index keeps every gallery and the exact original backup, beyond 5000',async()=>{
 const {b,entries}=await fixture(),old=b.values.get(INDEX).text;const {index,etag}=await getIndex(b);await saveIndex(b,index,etag);const next=await getIndex(b);
 assert.equal(next.index.version,2);assert.equal(count(next.index),6200);assert.ok(next.index.entries.length<=256);assert.ok(Buffer.byteLength(b.values.get(INDEX).text)<100000);
 const backups=[...b.values].filter(([k])=>k.startsWith('v2/private/pre-shard/'));assert.equal(backups.length,1);assert.equal(backups[0][1].text,old);
 assert.deepEqual((await queryEntries(b,next.index)).map(e=>e.sequence),entries.map(e=>e.sequence).sort((a,b)=>b-a));
 b.reads.length=0;assert.equal((await queryEntries(b,next.index,{q:'60000013'})).length,1);assert.ok(b.reads.length<5,'LOT lookup must not read all pages');
 const byVin=await queryEntries(b,next.index,{q:VIN});assert.equal(byVin.length,2);
});
test('public pages and VIN search remain complete and latest-page reads are bounded',async()=>{
 const {b}=await fixture();const {index,etag}=await getIndex(b);await saveIndex(b,index,etag);const env={REXBID_AUCTION_ARCHIVE:b};const get=async suffix=>(await handleArchive(new Request('https://rexbid.pl/api/archiwum'+suffix),env,new Date('2026-11-18'))).json();
 b.reads.length=0;const first=await get('');assert.equal(first.entries.length,12);assert.equal(first.entries[0].sequence,106199);assert.ok(b.reads.length<=2);
 const next=await get('?before='+first.next);assert.equal(next.entries[0].sequence,106187);assert.equal(new Set([...first.entries,...next.entries].map(x=>x.sequence)).size,24);
 const vin=await get('?q='+VIN);assert.equal(vin.entries.length,2);
});
test('failed conditional root commit publishes no page and retry loses no entries',async()=>{
 const {b}=await fixture(800),{index,etag}=await getIndex(b),old=b.values.get(INDEX).text;b.failRoot=true;
 await assert.rejects(saveIndex(b,index,etag),/archive_index_conflict/);assert.equal(b.values.get(INDEX).text,old);assert.equal(index.entries.length,800);
 b.failRoot=false;await saveIndex(b,index,etag);assert.equal(count((await getIndex(b)).index),800);
});
test('shared staged checkpoint references survive page rollover and subsequent saves',async()=>{
 const {b}=await fixture(256),{index,etag}=await getIndex(b);index.segments??=[];index.entries.push(entry(256));
 let current=await saveIndex(b,{...index,staged:['pending']},etag);assert.equal(count(index),257);assert.equal(index.entries.length,1);
 index.entries.push(entry(257));current=await saveIndex(b,index,current);assert.equal(count((await getIndex(b)).index),258);assert.ok(current);
});
test('owner removes a VIN across sealed and hot pages with access controls intact',async()=>{
 const {b}=await fixture(800),{index,etag}=await getIndex(b);await saveIndex(b,index,etag);
 const handler=id=>createOwnerArchiveHandler(async()=>({status:200,user:{id},assurance_level:'aal2'})),env={REXBID_OWNER_USER_ID:'owner',AUTH_CANONICAL_ORIGIN:'https://rexbid.pl',REXBID_AUCTION_ARCHIVE:b};
 const request=()=>new Request('https://rexbid.pl/api/portal/archive',{method:'POST',headers:{Origin:'https://rexbid.pl','Content-Type':'application/json'},body:JSON.stringify({vin:VIN,confirm:VIN,reason:'ownership'})});
 const countRequest=new Request('https://rexbid.pl/api/portal/archive?count=1');
 assert.equal((await handler('client')(countRequest,env)).status,403);
 b.reads.length=0;
 const beforeCount=await handler('owner')(countRequest,env);
 assert.equal(beforeCount.headers.get('Cache-Control'),'private, no-store');
 assert.equal((await beforeCount.json()).archiveEntries,800);
 assert.deepEqual(b.reads,[INDEX]);
 assert.equal((await handler('client')(request(),env)).status,403);const r=await handler('owner')(request(),env);assert.equal(r.status,200);assert.equal((await r.json()).removed,2);
 const after=(await getIndex(b)).index;assert.equal(count(after),798);assert.equal((await queryEntries(b,after,{q:VIN})).length,0);assert.equal(after.hidden.length,1);
 assert.equal((await (await handler('owner')(countRequest,env)).json()).archiveEntries,798);
});
test('updates a confirmed outcome in a sealed page without replacing other auctions',async()=>{
 const {b}=await fixture(800),{index,etag}=await getIndex(b);const current=await saveIndex(b,index,etag);const [existing]=await queryEntries(b,index,{q:'60000013'});existing.status='sold';existing.saleCents=220000;await updateEntry(b,index,existing);await saveIndex(b,index,current);const after=(await getIndex(b)).index;assert.equal(count(after),800);assert.equal((await queryEntries(b,after,{q:'60000013'}))[0].saleCents,220000);
});
test('a missing or corrupt referenced page fails visibly instead of returning an incomplete VIN result',async()=>{
 const {b}=await fixture(800),{index,etag}=await getIndex(b);await saveIndex(b,index,etag);b.values.delete(index.segments[0].key);
 await assert.rejects(queryEntries(b,index,{q:'60000013'}),/archive_page_missing/);
});
test('storage report requires owner MFA and is never public',async()=>{
 const {b}=await fixture(2);await b.put('v2/private/storage-status.json',JSON.stringify({limitBytes:300e9}));const env={REXBID_AUCTION_ARCHIVE:b,REXBID_OWNER_USER_ID:'owner',AUTH_CANONICAL_ORIGIN:'https://rexbid.pl'},request=new Request('https://rexbid.pl/api/portal/archive?storage=1');
 for(const [id,aal,status]of [['client','aal2',403],['owner','aal1',403],['owner','aal2',200]]){const h=createOwnerArchiveHandler(async()=>({status:200,user:{id},assurance_level:aal}));const r=await h(request,env);assert.equal(r.status,status);if(status===200)assert.equal((await r.json()).storage.limitBytes,300e9);}
});
