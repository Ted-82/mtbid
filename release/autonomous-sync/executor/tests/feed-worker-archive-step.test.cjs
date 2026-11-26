'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{gzipSync,gunzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const {prepareFeedArchiveStep,prepareFeedArchivePackedStep,readFeedBucket}=require('../sync/feed-worker-archive.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex'),when='2026-10-31T20:30:00.000Z';
const limits={line:1024,buffered:8192,chunk:512,records:2000},step={spoolBytes:4096,fanoutChunks:2,fragmentBytes:2048};
const event=(n,lot=String(n%9))=>({sequence:n,event_id:'opaque-'+n,event:'bid.changed',terminal:false,vehicle:{platform:n%2?'copart':'iaai',lot_number:lot,vin:'1HGCM82633A004352'},changed_fields:['pricing.current_bid_usd'],before:{'pricing.current_bid_usd':20},after:{'pricing.current_bid_usd':n},recorded_at:'2026-10-31T20:00:00Z'});
class Bucket {
 constructor(){this.objects=new Map();this.calls=[];this.afterWrite=null;this.beforeWrite=null;this.stallRaw=false;this.rawCancelled=false;}
 set(key,bytes){this.objects.set(key,Buffer.from(bytes));}
 async get(key,options){this.calls.push(['get',key,options]);const bytes=this.objects.get(key);if(!bytes)return null;const self=this;
  if(key==='raw/input.gz'&&this.stallRaw)return{size:bytes.length,etag:sha(bytes),body:new ReadableStream({cancel(){self.rawCancelled=true;}})};
  const range=options?.range,content=range?bytes.subarray(range.offset,range.offset+range.length):bytes;
  return{size:bytes.length,...(range?{range}:{}),etag:sha(bytes),body:new ReadableStream({start(c){c.enqueue(new Uint8Array(content));c.close();}})};
 }
 async put(key,bytes,options){this.calls.push(['put',key]);await this.beforeWrite?.(key,bytes,options);const old=this.objects.get(key);
  if(options?.onlyIf?.etagDoesNotMatch==='*'&&old)return null;
  if(options?.onlyIf?.etagMatches&&(!old||sha(old)!==options.onlyIf.etagMatches))return null;
  if(old&&!key.endsWith('/progress.json'))assert.equal(sha(old),sha(bytes),'immutable object changed');
  this.set(key,bytes);await this.afterWrite?.(key,bytes,options);return{key,etag:sha(bytes),size:bytes.length};
 }
}
function fixture(rows=Array.from({length:80},(_,i)=>event(i+1))){const bucket=new Bucket(),bytes=gzipSync(typeof rows==='string'?rows:rows.map(JSON.stringify).join('\n')+(rows.length?'\n':''));bucket.set('raw/input.gz',bytes);bucket.rawSha=sha(bytes);const options={bucket,rawKey:'raw/input.gz',rawSha256:sha(bytes),prefix:'bounded/test',observedAt:when,bucketCount:4,limits,step};return{bucket,bytes,options,root:'bounded/test/'+sha(bytes)+'/v1-b4'};}
async function finish(f,onResult){let result;for(let i=0;i<100;i++){result=await (f.prepare||prepareFeedArchiveStep)(f.options);assert.ok(result.operations<=950);await onResult?.(result);if(!result.pending)return result;}throw Error('NO_BOUNDED_COMPLETION');}
async function readAll(f,ready){const rows=[],quarantine=[];for(let i=0;i<ready.manifest.bucketCount;i++){const r=await readFeedBucket({bucket:f.bucket,manifest:ready,bucketIndex:i});rows.push(...r.groups.flatMap(g=>g.events));quarantine.push(...r.quarantine);}return{rows:rows.sort((a,b)=>a.sequence-b.sequence),quarantine};}
const readyExists=f=>f.bucket.objects.has(f.root+'/manifest.json');
test('bounded group materialization preserves source events and cumulative offsets when resumed',async()=>{
 const rows=Array.from({length:400},(_,i)=>event(i+1,String(i%70)));
 const f=fixture(rows),ready=await finish(f);
 for(let index=0;index<ready.manifest.bucketCount;index++){
  const args={bucket:f.bucket,manifest:ready,bucketIndex:index};
  const reference=await readFeedBucket(args);
  const partial=await readFeedBucket({...args,windowed:true,limits:{materialized:32000}});
  assert.equal(partial.bucketSha256,reference.bucketSha256);
  let start=0,steps=0;
  while(start<partial.uniqueLots){
   const end=partial.materializeWindow(start);assert.ok(end>start);
   assert.deepEqual(partial.groups.slice(start,end),reference.groups.slice(start,end));
   assert.deepEqual(partial.groups.slice(0,start).map(g=>g.events.length),reference.groups.slice(0,start).map(g=>g.events.length));
   start=end;steps++;
  }
  assert.ok(steps>1);
  const end=partial.materializeWindow(0);assert.deepEqual(partial.groups.slice(0,end),reference.groups.slice(0,end));
 }
});

test('bounded stages validate gzip once and retain all events and complete cross-window LOT groups',async()=>{
 const rows=Array.from({length:120},(_,i)=>event(i+1));rows[55].vehicle.vin='BAD\u001aVIN';const f=fixture(rows),phases=[];
 const ready=await finish(f,r=>{phases.push(r.phase);if(r.pending)assert.equal(readyExists(f),false);});
 assert.equal(phases[0],'spool');assert.ok(phases.filter(p=>p==='fanout').length>1);assert.equal(phases.at(-1),'ready');
 assert.equal(f.bucket.calls.filter(([m,k])=>m==='get'&&k==='raw/input.gz').length,1);
 const spool = JSON.parse(f.bucket.objects.get(f.root+'/spool/manifest.json'));
 assert.ok(spool.spoolCompressedBytes < spool.decodedBytes);
 for (const chunk of spool.chunks) {const compressed=f.bucket.objects.get(chunk.key),decoded=gunzipSync(compressed);assert.equal(sha(compressed),chunk.sha256);assert.equal(sha(decoded),chunk.decodedSha256);assert.equal(decoded.length,chunk.decodedBytes);assert.match(chunk.key,/\.jsonl\.gz$/);}
 assert.equal(sha(f.bucket.objects.get('raw/input.gz')),f.options.rawSha256);
 assert.equal(ready.manifest.records,rows.length);assert.equal(ready.manifest.quarantined,1);assert.equal(ready.manifest.databaseApplied,false);assert.equal(ready.manifest.continuityVerified,false);
 const read=await readAll(f,ready);assert.deepEqual(read.rows,rows);assert.deepEqual(read.quarantine.map(q=>q.sequence),[56]);
 const actualBytes=[...f.bucket.objects].filter(([k])=>k.startsWith(f.root+'/')).reduce((n,[,b])=>n+b.length,0);assert.ok(actualBytes<=ready.archiveBytes);
 const old=new Map([...f.bucket.objects].map(([k,b])=>[k,sha(b)]));const replay=await prepareFeedArchiveStep(f.options);assert.equal(replay.reused,true);assert.equal(replay.operations,1);assert.equal(replay.manifestSha256,ready.manifestSha256);
 assert.deepEqual(new Map([...f.bucket.objects].map(([k,b])=>[k,sha(b)])),old);
});

test('lost response after immutable window receipt resumes without rereading spool event chunks',async()=>{
 const f=fixture();await prepareFeedArchiveStep(f.options);let failed=false;f.bucket.afterWrite=key=>{if(!failed&&key===f.root+'/windows/0.json'){failed=true;throw Error('reply lost');}};
 await assert.rejects(prepareFeedArchiveStep(f.options),{code:'FEED_ARCHIVE_STORAGE_FAILED'});assert.equal(readyExists(f),false);const before=f.bucket.calls.length;f.bucket.afterWrite=null;
 const next=await prepareFeedArchiveStep(f.options);assert.equal(next.receiptReused,true);assert.equal(next.windowsComplete,1);
 assert.equal(f.bucket.calls.slice(before).some(([m,k])=>m==='get'&&k.includes('/spool/chunk-')),false);await finish(f);
});

test('lost progress-write response advances once; current step does not rewrite the completed window',async()=>{
 const f=fixture();await prepareFeedArchiveStep(f.options);let failed=false;f.bucket.afterWrite=key=>{if(!failed&&key===f.root+'/progress.json'){failed=true;throw Error('reply lost');}};
 await assert.rejects(prepareFeedArchiveStep(f.options),{code:'FEED_ARCHIVE_STORAGE_FAILED'});f.bucket.afterWrite=null;const before=f.bucket.calls.length;
 const next=await prepareFeedArchiveStep(f.options);assert.equal(next.windowsComplete,2);assert.equal(f.bucket.calls.slice(before).some(([m,k])=>m==='put'&&k===f.root+'/windows/0.json'),false);await finish(f);
});

test('progress uses etag CAS and a losing caller cannot overwrite a newer durable cursor',async()=>{
 const f=fixture();await prepareFeedArchiveStep(f.options);await prepareFeedArchiveStep(f.options);let raced=false;
 f.bucket.beforeWrite=key=>{if(!raced&&key===f.root+'/progress.json'){raced=true;f.bucket.set(key,Buffer.concat([f.bucket.objects.get(key),Buffer.from(' ')]));}};
 await assert.rejects(prepareFeedArchiveStep(f.options),{code:'FEED_ARCHIVE_STEP_PROGRESS_CONFLICT'});assert.equal(readyExists(f),false);f.bucket.beforeWrite=null;const recovered=await prepareFeedArchiveStep(f.options);assert.equal(recovered.receiptReused,true);await finish(f);
});

test('source EOF, raw SHA, duplicate ID and sequence checks must pass before any spool readiness proof',async()=>{
 const original=Array.from({length:30},(_,i)=>event(i+1));
 for(const mode of ['duplicate','order','hash','crc','truncated']){const rows=structuredClone(original);if(mode==='duplicate')rows.at(-1).event_id=rows[0].event_id;if(mode==='order')rows.at(-1).sequence=1;const f=fixture(rows);
  if(mode==='hash')f.options.rawSha256='a'.repeat(64);
  if(mode==='crc'||mode==='truncated'){const bytes=Buffer.from(f.bytes);if(mode==='crc')bytes[bytes.length-8]^=1;const changed=mode==='truncated'?bytes.subarray(0,bytes.length-4):bytes;f.bucket.set('raw/input.gz',changed);f.options.rawSha256=sha(changed);}
  await assert.rejects(prepareFeedArchiveStep(f.options),/FEED_ARCHIVE_/);assert.equal([...f.bucket.objects.keys()].some(k=>k.endsWith('/spool/manifest.json')),false);assert.equal([...f.bucket.objects.keys()].some(k=>k.endsWith('/manifest.json')&&!k.includes('/spool/')),false);
 }
});

test('first capture time and policy survive retries; layout or step drift fails closed before fanout',async()=>{
 const f=fixture();await prepareFeedArchiveStep(f.options);const capture=Buffer.from(f.bucket.objects.get(f.root+'/capture.json'));
 for(const options of [{...f.options,limits:{...limits,decoded:100000}},{...f.options,step:{...step,fanoutChunks:1}}])await assert.rejects(prepareFeedArchiveStep(options),{code:'FEED_ARCHIVE_STEP_SOURCE_CONFLICT'});
 const ready=await finish({...f,options:{...f.options,observedAt:'2026-11-01T00:00:00Z'}});assert.equal(ready.manifest.observedAt,when);assert.deepEqual(f.bucket.objects.get(f.root+'/capture.json'),capture);
 await assert.rejects(prepareFeedArchiveStep({...f.options,step:{...step,fanoutChunks:1}}),{code:'FEED_ARCHIVE_STEP_SOURCE_CONFLICT'});
});

test('corrupt spool, progress or window metadata cannot publish a ready root',async()=>{
 for(const mode of ['spool','progress','window']){const f=fixture();await prepareFeedArchiveStep(f.options);
  if(mode==='spool'){const key=[...f.bucket.objects.keys()].find(k=>k.includes('/spool/chunk-'));const bytes=Buffer.from(f.bucket.objects.get(key));bytes[10]^=1;f.bucket.set(key,bytes);}
  else{await prepareFeedArchiveStep(f.options);const key=f.root+(mode==='progress'?'/progress.json':'/windows/0.json'),value=JSON.parse(f.bucket.objects.get(key));value.captureSha256='a'.repeat(64);f.bucket.set(key,Buffer.from(JSON.stringify(value)));}
  if(mode==='window'){await prepareFeedArchiveStep(f.options);await assert.rejects(finish(f),/FEED_ARCHIVE_/);}else await assert.rejects(prepareFeedArchiveStep(f.options),/FEED_ARCHIVE_/);
  assert.equal(readyExists(f),false);
 }
});

test('abort cancels a stalled raw stream; heartbeat failures stop before subsequent R2 operations',async()=>{
 const f=fixture();f.bucket.stallRaw=true;const controller=new AbortController(),pending=prepareFeedArchiveStep({...f.options,signal:controller.signal});setTimeout(()=>controller.abort(),20);await assert.rejects(pending,{code:'FEED_ARCHIVE_ABORTED'});assert.equal(f.bucket.rawCancelled,true);assert.equal(readyExists(f),false);
 const g=fixture();let atFailure;await assert.rejects(prepareFeedArchiveStep({...g.options,onProgress:async state=>{if(state.operations===2){atFailure=g.bucket.calls.length;throw Error('lease lost');}}}),{code:'FEED_ARCHIVE_PROGRESS_FAILED'});assert.equal(g.bucket.calls.length,atFailure);assert.equal(readyExists(g),false);
});

test('empty gzip and valid CRLF/missing-final-newline payloads retain source meaning',async()=>{
 for(const rows of [[],JSON.stringify(event(1))+'\r\n'+JSON.stringify(event(2))]){const f=fixture(rows),ready=await finish(f),read=await readAll(f,ready);assert.deepEqual(read.rows,Array.isArray(rows)?rows:[event(1),event(2)]);}
});

test('bounded configuration refuses legacy prefix, unsafe source key and enlarged memory/IO bounds',async()=>{
 for(const change of [{prefix:'prepared'},{rawKey:'../source'},{step:{...step,fanoutChunks:5}},{step:{...step,spoolBytes:8*1024*1024}},{limits:{...limits,operations:951}}]){const f=fixture();await assert.rejects(prepareFeedArchiveStep({...f.options,...change}),/FEED_ARCHIVE_/);assert.equal(f.bucket.calls.length,0);}
});


test('ready publication lost response reuses the immutable manifest without replaying preparation',async()=>{
 const f=fixture();let failed=false;f.bucket.afterWrite=key=>{if(!failed&&key===f.root+'/manifest.json'){failed=true;throw Error('reply lost');}};
 await assert.rejects(finish(f),{code:'FEED_ARCHIVE_STORAGE_FAILED'});assert.equal(readyExists(f),true);f.bucket.afterWrite=null;
 const ready=await prepareFeedArchiveStep(f.options);assert.equal(ready.reused,true);assert.equal(ready.operations,1);assert.equal((await readAll(f,ready)).rows.length,80);
});

test('cancellation of a stalled fanout body closes the stream and leaves no ready manifest',async()=>{
 const f=fixture();await prepareFeedArchiveStep(f.options);const original=f.bucket.get.bind(f.bucket);let cancelled=false;
 f.bucket.get=async key=>key.includes('/spool/chunk-')?{size:f.bucket.objects.get(key).length,body:new ReadableStream({cancel(){cancelled=true;}})}:original(key);
 const controller=new AbortController(),pending=prepareFeedArchiveStep({...f.options,signal:controller.signal});setTimeout(()=>controller.abort(),20);
 await assert.rejects(pending,{code:'FEED_ARCHIVE_ABORTED'});assert.equal(cancelled,true);assert.equal(readyExists(f),false);
});

test('a fully written but incorrectly described decoded spool cannot be accepted merely from its gzip hash',async()=>{
 const f=fixture();await prepareFeedArchiveStep(f.options);const key=f.root+'/spool/manifest.json',value=JSON.parse(f.bucket.objects.get(key));
 value.chunks[0].decodedSha256='a'.repeat(64);const {sha256,...content}=value;value.sha256=sha(Buffer.from(JSON.stringify(content)+'\n'));f.bucket.set(key,Buffer.from(JSON.stringify(value)+'\n'));
 await assert.rejects(prepareFeedArchiveStep(f.options),{code:'FEED_ARCHIVE_STEP_SPOOL_HASH'});assert.equal(readyExists(f),false);
});


test('capacity callback fences every fanout/finalization attempt before any derived writes',async()=>{
 const f=fixture(),spooled=await prepareFeedArchiveStep(f.options);assert.equal(spooled.capacityChecked,false);let checks=0;
 const before=new Map([...f.bucket.objects].map(([key,bytes])=>[key,sha(bytes)]));
 const blocked={...f.options,beforeFanout:async info=>{checks++;assert.equal(info.reserveBytes,spooled.decodedBytes+4*1024*1024);assert.equal(info.archiveBytes,spooled.archiveBytes);throw Object.assign(Error('FEED_CAPTURE_STORAGE_BUDGET'),{code:'FEED_CAPTURE_STORAGE_BUDGET'});}};
 await assert.rejects(prepareFeedArchiveStep(blocked),{code:'FEED_CAPTURE_STORAGE_BUDGET'});assert.deepEqual(new Map([...f.bucket.objects].map(([key,bytes])=>[key,sha(bytes)])),before);assert.equal(checks,1);
 const passed=[];const ready=await finish({...f,options:{...f.options,beforeFanout:async info=>{passed.push(info);}}},result=>assert.equal(result.capacityChecked,true));
 assert.ok(passed.length>1);assert.equal(ready.capacityChecked,true);assert.equal(readyExists(f),true);
});


function replaceBucketMetadata(f,ready,selected,body) {
 const bytes=Buffer.from(JSON.stringify(body)+'\n'),h=sha(bytes),key=f.root+'/buckets/'+selected.index+'/manifest-'+h+'.json';f.bucket.set(key,bytes);selected.manifestKey=key;selected.manifestSha256=h;
 const {sha256,...content}=ready.manifest;ready.manifest.sha256=sha(Buffer.from(JSON.stringify(content)+'\n'));ready.manifestSha256=sha(Buffer.from(JSON.stringify(ready.manifest)+'\n'));
}

test('gzip bucket fragments preserve decoded hashes and account compressed retained storage only',async()=>{
 const f=fixture(Array.from({length:120},(_,i)=>event(i+1))),ready=await finish(f),spool=JSON.parse(f.bucket.objects.get(f.root+'/spool/manifest.json'));let storedBytes=0,decodedBytes=0;
 for(const selected of ready.manifest.buckets){const body=JSON.parse(f.bucket.objects.get(selected.manifestKey));for(const chunk of body.chunks){const compressed=f.bucket.objects.get(chunk.key),decoded=gunzipSync(compressed);assert.equal(chunk.encoding,'gzip');assert.match(chunk.key,/\.json\.gz$/);assert.equal(sha(compressed),chunk.storedSha256);assert.equal(compressed.length,chunk.storedBytes);assert.equal(sha(decoded),chunk.sha256);assert.equal(decoded.length,chunk.bytes);storedBytes+=chunk.storedBytes;decodedBytes+=chunk.bytes;}}
 assert.equal(decodedBytes,ready.manifest.decodedBytes);assert.equal(storedBytes,ready.manifest.fragmentCompressedBytes);assert.ok(storedBytes<decodedBytes);
 assert.equal(ready.archiveBytes,spool.spoolCompressedBytes+storedBytes+4*1024*1024);assert.deepEqual((await readAll(f,ready)).rows.length,120);
});

test('gzip fragment storage SHA, CRC, decoded SHA, decode bound and opt-in codec all fail closed',async()=>{
 for(const mode of ['stored-sha','crc','decoded-sha','decode-bound','codec','legacy']){const f=fixture(),ready=await finish(f),selected=ready.manifest.buckets.find(b=>b.records),body=JSON.parse(f.bucket.objects.get(selected.manifestKey)),chunk=body.chunks[0];
  if(mode==='stored-sha'){const bytes=Buffer.from(f.bucket.objects.get(chunk.key));bytes[8]^=1;f.bucket.set(chunk.key,bytes);}
  if(mode==='crc'||mode==='decode-bound'){const bytes=mode==='crc'?Buffer.from(f.bucket.objects.get(chunk.key)):gzipSync(Buffer.alloc(chunk.bytes+1));if(mode==='crc')bytes[bytes.length-8]^=1;const h=sha(bytes);chunk.key=f.root+'/buckets/'+selected.index+'/chunk-0-'+h+'.json.gz';chunk.storedSha256=h;chunk.storedBytes=bytes.length;f.bucket.set(chunk.key,bytes);replaceBucketMetadata(f,ready,selected,body);}
  if(mode==='decoded-sha'){chunk.sha256='a'.repeat(64);replaceBucketMetadata(f,ready,selected,body);}
  if(mode==='codec'){chunk.encoding='unknown';replaceBucketMetadata(f,ready,selected,body);}
  if(mode==='legacy'){delete ready.manifest.preparation;const {sha256,...content}=ready.manifest;ready.manifest.sha256=sha(Buffer.from(JSON.stringify(content)+'\n'));ready.manifestSha256=sha(Buffer.from(JSON.stringify(ready.manifest)+'\n'));}
  await assert.rejects(readFeedBucket({bucket:f.bucket,manifest:ready,bucketIndex:selected.index}),/FEED_ARCHIVE_/);
 }
});

test('compact LOT identity set preserves full20digits, leading zeros and platform distinctions exactly',async()=>{
 const identities=[['copart','1'],['copart','01'],['copart','00000000000000000001'],['copart','99999999999999999999'],['iaai','1'],['iaai','01'],['iaai','00000000000000000001'],['iaai','99999999999999999999']];
 const rows=identities.flatMap(([platform,lot],i)=>[0,1].map(n=>({...event(i*2+n+1,lot),vehicle:{platform,lot_number:lot,vin:'1HGCM82633A004352'}}))),f=fixture(rows),ready=await finish(f);
 assert.equal(ready.manifest.uniqueLots,identities.length);assert.deepEqual((await readAll(f,ready)).rows,rows);
});

function packedFixture(rows){const f=fixture(rows);f.options.prefix='prepared-packed-gzip';f.root='prepared-packed-gzip/'+f.options.rawSha256+'/v1-b4';f.prepare=prepareFeedArchivePackedStep;return f;}
test('expanded packed policy preserves an old spool and reuses the exact completed manifest',async()=>{
 const f=packedFixture([event(1)]);delete f.options.limits;delete f.options.step;
 const first=await f.prepare(f.options);assert.equal(first.phase,'spool');
 const capture=Buffer.from(f.bucket.objects.get(f.root+'/capture.json'));
 const ready=await finish({...f,options:{...f.options,allowLargeFiles:true}});
 assert.equal(ready.manifest.limits.records,400000);
 assert.deepEqual(f.bucket.objects.get(f.root+'/capture.json'),capture);
 for(const allowLargeFiles of [false,true]){
   const replay=await f.prepare({...f.options,allowLargeFiles});assert.equal(replay.manifestSha256,ready.manifestSha256);
 }
});
test('packed source ids preserve numeric boundaries, alternative spellings and duplicates across lots',async()=>{
 const ids=['chg_1','chg_01','chg_9007199254740991','chg_9007199254740992','chg_0','opaque-1'];
 const rows=ids.map((event_id,i)=>({...event(i+1),event_id}));
 const f=packedFixture(rows);const result=await finish(f);
 assert.deepEqual((await readAll(f,result)).rows,rows);
 for(const event_id of ids){
   const duplicate=packedFixture([...rows,{...event(20),event_id}]);
   await assert.rejects(duplicate.prepare(duplicate.options),{code:'FEED_ARCHIVE_DUPLICATE_EVENT'});
   assert.equal(readyExists(duplicate),false);
 }
});
test('packed windows retain every event with range-only bucket reads and one binary object per window',async()=>{
 const rows=Array.from({length:180},(_,i)=>event(i+1));rows[70].vehicle.vin='BAD\u001aVIN';const f=packedFixture(rows),ready=await finish(f);
 assert.equal(ready.manifest.preparation,'packed-gzip-routed-fragments-v1');assert.equal(ready.manifest.databaseApplied,false);
 const windows=[...f.bucket.objects.keys()].filter(k=>/\/windows\/[0-9]+\.json$/.test(k)),packs=[...f.bucket.objects.keys()].filter(k=>k.endsWith('.bin'));
 assert.equal(windows.length,packs.length);assert.equal([...f.bucket.objects.keys()].some(k=>k.includes('/buckets/')&&k.endsWith('.json.gz')),false);
 let stored=0;for(const key of windows){const receipt=JSON.parse(f.bucket.objects.get(key)),pack=f.bucket.objects.get(receipt.pack.key);assert.equal(sha(pack),receipt.pack.sha256);assert.equal(pack.length,receipt.pack.bytes);stored+=pack.length;}
 assert.equal(stored,ready.manifest.fragmentCompressedBytes);assert.equal(ready.archiveBytes,ready.manifest.spoolCompressedBytes+stored+4*1024*1024);
 const get=f.bucket.get.bind(f.bucket);let inFlight=0,peak=0;
 f.bucket.get=async(key,options)=>{
  if(!options?.range)return get(key,options);
  peak=Math.max(peak,++inFlight);
  try{await new Promise(resolve=>setImmediate(resolve));return await get(key,options);}
  finally{inFlight--;}
 };
 const before=f.bucket.calls.length,read=await readAll(f,ready);assert.deepEqual(read.rows,rows);assert.deepEqual(read.quarantine.map(q=>q.sequence),[71]);
 assert.ok(peak>=2&&peak<=4);
 assert.equal(f.bucket.calls.slice(before).filter(([method,key])=>method==='get'&&key.endsWith('.bin')).length,
  ready.manifest.buckets.reduce((total,bucket)=>total+bucket.chunkCount,0));
 for(const [method,key,options] of f.bucket.calls.slice(before))if(method==='get'&&key.endsWith('.bin')){assert.ok(options.range.length<f.bucket.objects.get(key).length);assert.ok(options.range.offset>=0);}
 const replay=await f.prepare(f.options);assert.equal(replay.operations,1);assert.equal(replay.manifestSha256,ready.manifestSha256);
});
test('packed reader rejects ignored, short, oversized, corrupt and wrong-metadata ranges',async()=>{
 for(const mode of ['ignored','short','oversized','corrupt','metadata']){const f=packedFixture(),ready=await finish(f),selected=ready.manifest.buckets.find(b=>b.records),original=f.bucket.get.bind(f.bucket);
  f.bucket.get=async(key,options)=>{const object=await original(key,options);if(!key.endsWith('.bin'))return object;
   if(mode==='ignored')return original(key);
   if(mode==='metadata')return{...object,range:{...object.range,offset:object.range.offset+1}};
   const data=Buffer.from(await new Response(object.body).arrayBuffer());let changed=mode==='short'?data.subarray(0,data.length-1):mode==='oversized'?Buffer.concat([data,Buffer.from('x')]):Buffer.from(data);if(mode==='corrupt')changed[0]^=1;
   return{...object,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(changed));c.close();}})};};
  await assert.rejects(readFeedBucket({bucket:f.bucket,manifest:ready,bucketIndex:selected.index}),/FEED_ARCHIVE_/);
 }
});
test('packed receipt replay after lost response avoids rewriting packs and validates offsets',async()=>{
 const f=packedFixture();await f.prepare(f.options);let failed=false;f.bucket.afterWrite=key=>{if(!failed&&key===f.root+'/windows/0.json'){failed=true;throw Error('lost');}};
 await assert.rejects(f.prepare(f.options),/FEED_ARCHIVE_/);f.bucket.afterWrite=null;const before=f.bucket.calls.length,result=await f.prepare(f.options);assert.equal(result.receiptReused,true);assert.equal(f.bucket.calls.slice(before).some(([m,k])=>m==='put'&&k.endsWith('.bin')),false);await finish(f);
 const g=packedFixture();await g.prepare(g.options);await g.prepare(g.options);const key=g.root+'/windows/0.json',value=JSON.parse(g.bucket.objects.get(key));value.chunks.flat()[0].packOffset++;const {sha256,...content}=value;value.sha256=sha(Buffer.from(JSON.stringify(content)+'\n'));g.bucket.set(key,Buffer.from(JSON.stringify(value)+'\n'));await assert.rejects(finish(g),/FEED_ARCHIVE_/);assert.equal(readyExists(g),false);
});
test('packed layout stays separate and refuses invalid range bounds even with sealed manifests',async()=>{
 const f=packedFixture(),ready=await finish(f),selected=ready.manifest.buckets.find(b=>b.records),body=JSON.parse(f.bucket.objects.get(selected.manifestKey));body.chunks[0].packOffset=ready.manifest.packs[body.chunks[0].packIndex].bytes;replaceBucketMetadata(f,ready,selected,body);await assert.rejects(readFeedBucket({bucket:f.bucket,manifest:ready,bucketIndex:selected.index}),{code:'FEED_ARCHIVE_CHUNK_INVALID'});
 for(const prefix of ['prepared','prepared-bounded','prepared-bounded-gzip'])await assert.rejects(f.prepare({...f.options,prefix}),{code:'FEED_ARCHIVE_STEP_PREFIX_INVALID'});
});

test('packed decoded SHA, gzip CRC, decode expansion and codec mismatches fail closed',async()=>{
 for(const mode of ['decoded-sha','crc','decode-bound','codec']){const f=packedFixture(),ready=await finish(f),selected=ready.manifest.buckets.find(b=>b.records),body=JSON.parse(f.bucket.objects.get(selected.manifestKey)),chunk=body.chunks[0];
  if(mode==='decoded-sha')chunk.sha256='a'.repeat(64);
  if(mode==='codec')chunk.encoding='unknown';
  if(mode==='crc'||mode==='decode-bound'){const pack=ready.manifest.packs[chunk.packIndex],old=f.bucket.objects.get(pack.key),bytes=mode==='crc'?Buffer.from(old.subarray(chunk.packOffset,chunk.packOffset+chunk.storedBytes)):gzipSync(Buffer.alloc(chunk.bytes+1));if(mode==='crc')bytes[bytes.length-8]^=1;chunk.packOffset=0;chunk.storedSha256=sha(bytes);chunk.storedBytes=bytes.length;const h=sha(bytes),key=f.root+'/windows/pack-'+chunk.packIndex+'-'+h+'.bin';Object.assign(pack,{key,sha256:h,bytes:bytes.length});f.bucket.set(key,bytes);}
  replaceBucketMetadata(f,ready,selected,body);await assert.rejects(readFeedBucket({bucket:f.bucket,manifest:ready,bucketIndex:selected.index}),/FEED_ARCHIVE_/);
 }
});
test('packed preparation keeps capacity and source validation fences before derived publication',async()=>{
 const f=packedFixture(),first=await f.prepare(f.options),before=f.bucket.calls.length;assert.equal(first.phase,'spool');await assert.rejects(f.prepare({...f.options,beforeFanout:async()=>{throw Object.assign(Error('budget'),{code:'FEED_CAPTURE_STORAGE_BUDGET'});}}),{code:'FEED_CAPTURE_STORAGE_BUDGET'});assert.equal(f.bucket.calls.slice(before).some(([m,k])=>m==='put'&&!k.endsWith('/capture.json')),false);assert.equal(readyExists(f),false);
 const rows=Array.from({length:40},(_,i)=>event(i+1));rows.at(-1).event_id=rows[0].event_id;const g=packedFixture(rows);await assert.rejects(g.prepare(g.options),{code:'FEED_ARCHIVE_DUPLICATE_EVENT'});assert.equal(readyExists(g),false);assert.equal([...g.bucket.objects.keys()].some(k=>k.endsWith('.bin')),false);
});
