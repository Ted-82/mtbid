'use strict';
// R2-only intake; never acquires a D1 lease or advances a catalogue cursor.
const {randomUUID,createHash}=require('node:crypto');
const {downloadLatest,MAX_BYTES,validateFeedUrl}=require('./feed-download.cjs');
const PREFIX='intake/v1/',PENDING=PREFIX+'pending/',INTENTS=PREFIX+'intents/',COMPLETED=PREFIX+'completed/',LOCK=PREFIX+'lease.json',RECOVERY=PREFIX+'recovery.json';
// Bound object enumeration separately from retained bytes: small prepared-file
// fragments can exceed 64k objects while remaining well below the 5GiB cap.
const STORAGE_CAP=5*1024*1024*1024,MAX_LIST_PAGES=128,LIST_LIMIT=1000,LEASE_MS=5*60000;
const MAX_CAPTURE_OPERATIONS=192;
const RAW_RESERVE=290*1024*1024,PREPARE_RESERVE=258*1024*1024;
const integer=n=>Number.isSafeInteger(n)&&n>=0,hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const fail=code=>{throw Object.assign(Error(code),{code});};
const iso=n=>new Date(n).toISOString();
function timestamp(s){const n=Date.parse(s);return typeof s==='string'&&Number.isFinite(n)&&iso(n)===s?n:NaN;}
function suffix(generationId){if(!integer(generationId)||generationId<1)fail('FEED_CAPTURE_DESCRIPTOR_INVALID');return String(generationId).padStart(20,'0')+'.json';}
const pendingKey=id=>PENDING+suffix(id),intentKey=id=>INTENTS+suffix(id),completedKey=id=>COMPLETED+suffix(id);
function validate(value,complete=false){
 if(!value||value.version!==1||!integer(value.generationId)||value.generationId<1||!integer(value.feedId)||value.feedId<1
  ||!Number.isFinite(timestamp(value.observedAt))||!integer(value.compressedBytes)||value.compressedBytes<1||value.compressedBytes>MAX_BYTES
  ||typeof value.rawKey!=='string'||!value.rawKey.startsWith(`raw/${value.generationId}/`)
  ||!/^raw\/\d+\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jsonl\.gz$/.test(value.rawKey)
  ||complete&&!hex(value.sha256))fail('FEED_CAPTURE_DESCRIPTOR_INVALID');
 return value;
}
function ioFor(bucket){
 if(!bucket?.get||!bucket?.put||!bucket?.list||!bucket?.delete||!bucket?.createMultipartUpload)fail('FEED_CAPTURE_CONFIG_INVALID');
 const stats={operations:0,gets:0,puts:0,lists:0,multipart:0,deletes:0};
 const take=kind=>{if(stats.operations>=MAX_CAPTURE_OPERATIONS)fail('FEED_CAPTURE_OPERATION_LIMIT');stats.operations++;stats[kind]++;};
 return{stats,get:async key=>{take('gets');return bucket.get(key);},put:async(...args)=>{take('puts');return bucket.put(...args);},
  list:async options=>{take('lists');return bucket.list(options);},delete:async key=>{take('deletes');return bucket.delete(key);},
  createMultipartUpload:async(...args)=>{take('multipart');const upload=await bucket.createMultipartUpload(...args);return{
   uploadPart:async(...params)=>{take('multipart');return upload.uploadPart(...params);},
   complete:async(...params)=>{take('multipart');return upload.complete(...params);},
   abort:async()=>{take('multipart');return upload.abort();}};}};
}
async function jsonObject(bucket,key){
 const object=await bucket.get(key);if(!object)return null;
 if(!integer(object.size)||object.size>4096){await object.body?.cancel?.();fail('FEED_CAPTURE_METADATA_INVALID');}
 let value;try{const text=await object.text();if(Buffer.byteLength(text)>4096)fail('FEED_CAPTURE_METADATA_INVALID');value=JSON.parse(text);}catch{fail('FEED_CAPTURE_METADATA_INVALID');}
 return{value,etag:object.etag};
}
async function immutable(bucket,key,value){
 const text=JSON.stringify(value),saved=await bucket.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 const checked=await jsonObject(bucket,key);
 if(!checked||JSON.stringify(checked.value)!==text)fail('FEED_CAPTURE_IMMUTABLE_CONFLICT');
 return{value:checked.value,created:!!saved};
}
async function assertStorageCapacity({bucket,reserveBytes=RAW_RESERVE}={}){
 if(!bucket?.list||!integer(reserveBytes)||reserveBytes<1||reserveBytes>RAW_RESERVE)fail('FEED_CAPTURE_CONFIG_INVALID');
 let totalBytes=0,cursor,lists=0;const cursors=new Set();
 do{
  if(lists>=MAX_LIST_PAGES)fail('FEED_CAPTURE_STORAGE_LIST_LIMIT');
  const response=await bucket.list({limit:LIST_LIMIT,...(cursor?{cursor}:{})});lists++;
  if(!response||!Array.isArray(response.objects)||response.objects.length>LIST_LIMIT||typeof response.truncated!=='boolean')fail('FEED_CAPTURE_STORAGE_LIST_INVALID');
  for(const object of response.objects){if(typeof object.key!=='string'||!integer(object.size))fail('FEED_CAPTURE_STORAGE_LIST_INVALID');totalBytes+=object.size;if(!integer(totalBytes))fail('FEED_CAPTURE_STORAGE_LIST_INVALID');}
  if(totalBytes+reserveBytes+16384>STORAGE_CAP)fail('FEED_CAPTURE_STORAGE_BUDGET');
  if(!response.truncated)break;
  if(typeof response.cursor!=='string'||!response.cursor||cursors.has(response.cursor))fail('FEED_CAPTURE_STORAGE_LIST_INVALID');
  cursor=response.cursor;cursors.add(cursor);
 }while(true);
 return{totalBytes,reserveBytes,lists,capBytes:STORAGE_CAP};
}
async function takeLease(bucket,now){
 const previous=await jsonObject(bucket,LOCK),owner=randomUUID();
 if(previous){if(typeof previous.value?.owner!=='string'||!Number.isFinite(timestamp(previous.value.expiresAt))||typeof previous.etag!=='string')fail('FEED_CAPTURE_LEASE_INVALID');
  if(timestamp(previous.value.expiresAt)>now())return null;}
 const value={version:1,owner,expiresAt:iso(now()+LEASE_MS)};
 const written=await bucket.put(LOCK,JSON.stringify(value),{onlyIf:previous?{etagMatches:previous.etag}:{etagDoesNotMatch:'*'}});
 if(!written)return null;if(typeof written.etag!=='string')fail('FEED_CAPTURE_LEASE_INVALID');
 return{...value,etag:written.etag};
}
async function assertLease(bucket,lease,now){
 const current=await jsonObject(bucket,LOCK);
 if(!current||current.etag!==lease.etag||current.value.owner!==lease.owner||timestamp(current.value.expiresAt)<=now())fail('FEED_CAPTURE_LEASE_LOST');
}
async function recover(bucket,intent,lease,now){
 validate(intent);const existing=await jsonObject(bucket,completedKey(intent.generationId));
 if(existing){validate(existing.value,true);for(const key of ['generationId','feedId','rawKey','observedAt','compressedBytes'])if(existing.value[key]!==intent[key])fail('FEED_CAPTURE_IMMUTABLE_CONFLICT');await publishReady(bucket,intent,existing.value,lease,now);return existing.value;}
 const object=await bucket.get(intent.rawKey);if(!object)return null;
 if(object.size!==intent.compressedBytes||!object.body?.getReader){await object.body?.cancel?.();fail('FEED_CAPTURE_RAW_INVALID');}
 const digest=createHash('sha256'),reader=object.body.getReader();let size=0,magic=[];
 try{while(true){const{value,done}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||(size+=value.byteLength)>MAX_BYTES||size>intent.compressedBytes)fail('FEED_CAPTURE_RAW_INVALID');
  for(let i=0;i<value.length&&magic.length<2;i++)magic.push(value[i]);digest.update(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(size!==intent.compressedBytes||magic[0]!==31||magic[1]!==139)fail('FEED_CAPTURE_RAW_INVALID');
 await assertLease(bucket,lease,now);const capture={...intent,sha256:digest.digest('hex')};
 await immutable(bucket,completedKey(intent.generationId),capture);await publishReady(bucket,intent,capture,lease,now);return capture;
}
async function publishReady(bucket,intent,capture,lease,now){
 await assertLease(bucket,lease,now);validate(intent);validate(capture,true);
 await immutable(bucket,pendingKey(capture.generationId),capture);
 // Only reconstructible metadata is removed. Unfinished intents/raw persist.
 await assertLease(bucket,lease,now);await bucket.delete(intentKey(intent.generationId));
}
async function recoverIntents(bucket,lease,now){
 const checkpoint=await jsonObject(bucket,RECOVERY);
 if(checkpoint&&(checkpoint.value?.version!==1||typeof checkpoint.value.cursor!=='string'||checkpoint.value.cursor.length>2048))fail('FEED_CAPTURE_RECOVERY_INVALID');
 const cursor=checkpoint?.value.cursor||'';
 const listed=await bucket.list({prefix:INTENTS,limit:4,...(cursor?{cursor}:{})});
 if(!listed||!Array.isArray(listed.objects)||listed.objects.length>4||typeof listed.truncated!=='boolean'
  ||listed.truncated&&(typeof listed.cursor!=='string'||!listed.cursor||listed.cursor===cursor))fail('FEED_CAPTURE_RECOVERY_INVALID');
 const recovered=[];
 for(const object of listed.objects){
  if(typeof object.key!=='string'||!object.key.startsWith(INTENTS)||!/^\d{20}\.json$/.test(object.key.slice(INTENTS.length)))fail('FEED_CAPTURE_RECOVERY_INVALID');
  const saved=await jsonObject(bucket,object.key);if(!saved)continue;
  const intent=validate(saved.value);if(object.key!==intentKey(intent.generationId))fail('FEED_CAPTURE_RECOVERY_INVALID');
  const capture=await recover(bucket,intent,lease,now);if(capture)recovered.push(capture.generationId);
 }
 await assertLease(bucket,lease,now);
 await bucket.put(RECOVERY,JSON.stringify({version:1,cursor:listed.truncated?listed.cursor:''}),{httpMetadata:{contentType:'application/json'}});
 return recovered;
}
async function oldestPending(bucket){
 const listed=await bucket.list({prefix:PENDING,limit:1});
 if(!listed||!Array.isArray(listed.objects)||listed.objects.length>1)fail('FEED_CAPTURE_PENDING_INVALID');
 const key=listed.objects[0]?.key;if(!key)return null;
 if(!new RegExp('^'+PENDING+'[0-9]{20}\\.json$').test(key))fail('FEED_CAPTURE_PENDING_INVALID');
 const object=await jsonObject(bucket,key);if(!object)fail('FEED_CAPTURE_PENDING_INVALID');
 const intent=validate(object.value);if(key!==pendingKey(intent.generationId))fail('FEED_CAPTURE_PENDING_INVALID');
 return{key,intent};
}
async function captureLatest({bucket,url,feedId=20,fetchImpl=fetch,now=Date.now}={}){
 validateFeedUrl(url);if(!integer(feedId)||feedId<1||typeof now!=='function'||!Number.isFinite(now()))fail('FEED_CAPTURE_CONFIG_INVALID');
 const io=ioFor(bucket),lease=await takeLease(io,now);if(!lease)return{captured:false,reused:false,reason:'capture_busy',...io.stats};
 let recoveredGeneration=null;
 try{
  const recovered=await recoverIntents(io,lease,now);recoveredGeneration=recovered[0]||null;
  const capture=await downloadLatest({bucket:io,url,fetchImpl,now,beforeUpload:async meta=>{
   if(meta.feedId!==feedId)fail('FEED_CAPTURE_SOURCE_MISMATCH');await assertLease(io,lease,now);
   const existing=await jsonObject(io,completedKey(meta.generationId));
   if(existing){const saved=validate(existing.value,true);if(saved.feedId!==feedId)fail('FEED_CAPTURE_SOURCE_MISMATCH');
    const intent=await jsonObject(io,intentKey(meta.generationId));if(intent)await publishReady(io,validate(intent.value),saved,lease,now);
    return{rawKey:saved.rawKey,observedAt:saved.observedAt,existingCapture:saved};}
   const prior=await jsonObject(io,intentKey(meta.generationId));
   if(prior){const intent=validate(prior.value);if(intent.feedId!==feedId||intent.compressedBytes!==meta.compressedBytes)fail('FEED_CAPTURE_IMMUTABLE_CONFLICT');
    const recovered=await recover(io,intent,lease,now);return{rawKey:intent.rawKey,observedAt:intent.observedAt,...(recovered?{existingCapture:recovered}:{})};}
   await assertStorageCapacity({bucket:io});await assertLease(io,lease,now);
   const intent={version:1,...meta,rawKey:`raw/${meta.generationId}/${randomUUID()}.jsonl.gz`};
   await immutable(io,intentKey(meta.generationId),intent);return{rawKey:intent.rawKey,observedAt:intent.observedAt};
  },beforeComplete:async()=>assertLease(io,lease,now)});
  const completed={version:1,generationId:capture.generationId,feedId:capture.feedId,observedAt:capture.observedAt,
   compressedBytes:capture.compressedBytes,rawKey:capture.rawKey,sha256:capture.sha256};
  if(!capture.reused){await assertLease(io,lease,now);await immutable(io,completedKey(capture.generationId),completed);await publishReady(io,completed,completed,lease,now);}
  return{captured:!capture.reused,reused:!!capture.reused,generationId:capture.generationId,bytes:capture.compressedBytes,
   ...(recoveredGeneration?{recoveredGeneration}:{}),...io.stats,
   operations:io.stats.operations+(io.stats.operations<MAX_CAPTURE_OPERATIONS?1:0),puts:io.stats.puts+(io.stats.operations<MAX_CAPTURE_OPERATIONS?1:0)};
 }finally{
  if(io.stats.operations<MAX_CAPTURE_OPERATIONS)await io.put(LOCK,JSON.stringify({version:1,owner:lease.owner,expiresAt:iso(now()-1)}),{onlyIf:{etagMatches:lease.etag}}).catch(()=>{});
 }
}
async function readPendingCapture(bucket){
 const pending=await oldestPending(bucket);if(!pending)return null;
 const completed=await jsonObject(bucket,completedKey(pending.intent.generationId));if(!completed)return{ready:false,generationId:pending.intent.generationId};
 const capture=validate(completed.value,true);for(const key of ['generationId','feedId','rawKey','observedAt','compressedBytes'])if(capture[key]!==pending.intent[key])fail('FEED_CAPTURE_IMMUTABLE_CONFLICT');
 const object=await bucket.get(capture.rawKey);if(!object||object.size!==capture.compressedBytes){await object?.body?.cancel?.();fail('FEED_CAPTURE_RAW_MISSING');}
 await object.body?.cancel?.();return{ready:true,capture,pendingKey:pending.key};
}
async function acknowledgeCapture(bucket,capture){
 validate(capture,true);const pending=await readPendingCapture(bucket);
 if(!pending||!pending.ready||JSON.stringify(pending.capture)!==JSON.stringify(capture))fail('FEED_CAPTURE_ACK_INVALID');
 await bucket.delete(intentKey(capture.generationId));await bucket.delete(pending.pendingKey);return{acknowledged:true,generationId:capture.generationId};
}
function safeCaptureCode(error){const value=error?.code||error?.message;return typeof value==='string'&&/^(?:FEED_CAPTURE|FEED_DOWNLOAD|FEED_URL)_[A-Z_]{1,70}$/.test(value)?value:'FEED_CAPTURE_FAILED';}
module.exports={captureLatest,readPendingCapture,acknowledgeCapture,assertStorageCapacity,safeCaptureCode,STORAGE_CAP,MAX_LIST_PAGES,MAX_CAPTURE_OPERATIONS,LIST_LIMIT,
 RAW_RESERVE,PREPARE_RESERVE,PREFIX,PENDING,INTENTS,COMPLETED,LOCK,RECOVERY,pendingKey,intentKey,completedKey};
