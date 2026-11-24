'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MemoryR2}=require('./fixtures/feed-capture-memory.cjs');
const journal=require('../sync/feed-capture-journal.cjs');
const pipeline=require('../sync/feed-server-runner.cjs');
const NOW=Date.parse('2026-10-31T12:00:00Z'),URL='https://apibara.tech/data-feeds/offline-token/latest';
function harness(){const bucket=new MemoryR2(),h={bucket,clock:NOW,generation:7001,bytes:Buffer.from([31,139,1,2]),fetches:0};
 h.fetchImpl=async()=>{h.fetches++;return new Response(h.bytes,{headers:{'content-type':'application/gzip','content-length':String(h.bytes.length),
  'content-disposition':`attachment; filename=apibara-feed-20-${h.generation}.jsonl.gz`}});};
 h.run=()=>journal.captureLatest({bucket,url:URL,now:()=>h.clock,fetchImpl:h.fetchImpl});return h;}
const rawKeys=h=>[...h.bucket.objects.keys()].filter(key=>key.startsWith('raw/'));

test('capture is R2-only, deduplicates unchanged generation and retains immutable descriptor/raw after pending acknowledgement',async()=>{
 const h=harness(),first=await h.run();assert.equal(first.captured,true);assert.equal(rawKeys(h).length,1);assert.ok(first.operations<journal.MAX_CAPTURE_OPERATIONS);
 const pending=await journal.readPendingCapture(h.bucket);assert.equal(pending.ready,true);
 h.clock+=1000;const second=await h.run();assert.equal(second.reused,true);assert.equal(rawKeys(h).length,1);
 assert.equal((await journal.readPendingCapture(h.bucket)).capture.observedAt,pending.capture.observedAt);
 await journal.acknowledgeCapture(h.bucket,pending.capture);assert.equal(await journal.readPendingCapture(h.bucket),null);
 assert.ok(h.bucket.objects.has(pending.capture.rawKey));assert.ok(h.bucket.objects.has(journal.completedKey(7001)));
 assert.equal((await h.run()).reused,true);assert.equal(rawKeys(h).length,1);assert.equal(await journal.readPendingCapture(h.bucket),null);
});

test('completed raw survives descriptor failure and is recovered even when latest has moved to another generation',async()=>{
 const h=harness();h.bucket.beforePut=key=>{if(key.startsWith(journal.COMPLETED))throw Error('SIMULATED_FAILURE');};
 await assert.rejects(h.run(),/SIMULATED_FAILURE/);assert.equal(rawKeys(h).length,1);assert.equal(await journal.readPendingCapture(h.bucket),null);assert.ok(h.bucket.objects.has(journal.intentKey(h.generation)));
 h.bucket.beforePut=null;h.generation=7002;const next=await h.run();assert.equal(next.recoveredGeneration,7001);assert.equal(next.generationId,7002);
 const pending=await journal.readPendingCapture(h.bucket);assert.equal(pending.capture.generationId,7001);assert.equal(rawKeys(h).length,2);
});

test('lost completed-descriptor acknowledgement reuses archived bytes without another raw object',async()=>{
 const h=harness();let fired=false;h.bucket.afterPut=key=>{if(!fired&&key.startsWith(journal.COMPLETED)){fired=true;throw Error('LOST_ACK');}};
 await assert.rejects(h.run(),/LOST_ACK/);h.bucket.afterPut=null;assert.equal((await h.run()).reused,true);assert.equal(rawKeys(h).length,1);
 assert.equal((await journal.readPendingCapture(h.bucket)).ready,true);
});

test('truncation keeps unready intent, aborts upload and later completes the same pending raw key',async()=>{
 const h=harness();h.bytes=Buffer.from([31,139,1,2,3,4,5,6]);const normal=h.fetchImpl;
 h.fetchImpl=async()=>new Response(h.bytes.subarray(0,4),{headers:{'content-type':'application/gzip','content-length':String(h.bytes.length),
  'content-disposition':'attachment; filename=apibara-feed-20-7001.jsonl.gz'}});
 await assert.rejects(h.run(),/FEED_DOWNLOAD_TRUNCATED/);assert.equal(rawKeys(h).length,0);assert.equal(await journal.readPendingCapture(h.bucket),null);assert.ok(h.bucket.objects.has(journal.intentKey(h.generation)));
 const intent=JSON.parse(h.bucket.objects.get(journal.intentKey(7001)));
 h.fetchImpl=normal;assert.equal((await h.run()).captured,true);
 assert.equal((await journal.readPendingCapture(h.bucket)).capture.rawKey,intent.rawKey);
 assert.equal(rawKeys(h).length,1);assert.equal(h.bucket.calls.filter(call=>call[0]==='delete'&&call[1].startsWith('raw/')).length,0);
});
test('unchanged generation with changed content cannot replace original archived file or descriptor',async()=>{
 const h=harness();await h.run();const before=Buffer.from(h.bucket.objects.get(rawKeys(h)[0]));h.bytes=Buffer.from([31,139,8,9]);
 await assert.rejects(h.run(),/FEED_DOWNLOAD_GENERATION_CHANGED/);assert.deepEqual(h.bucket.objects.get(rawKeys(h)[0]),before);assert.equal(rawKeys(h).length,1);
});

for(const inventoryPages of [70,128])test(`capture completes a ${inventoryPages}-page all-bucket inventory and releases its lease`,async()=>{
 const h=harness(),original=h.bucket.list.bind(h.bucket);let pages=0;
 h.bucket.list=async options=>{
  if(options?.prefix)return original(options);
  assert.equal(options.limit,journal.LIST_LIMIT);
  const index=options.cursor?Number(options.cursor):0;
  assert.equal(index,pages++);
  h.bucket.calls.push(['list','']);
  return{objects:Array.from({length:1000},(_,i)=>({key:`existing/${index*1000+i}`,size:16})),
   truncated:index<inventoryPages-1,...(index<inventoryPages-1?{cursor:String(index+1)}:{})};
 };
 h.bucket.beforePut=key=>{if(key.startsWith('raw/'))assert.equal(pages,inventoryPages);};
 const captured=await h.run();assert.equal(captured.captured,true);assert.equal(pages,inventoryPages);
 assert.equal(captured.lists,inventoryPages+1);assert.ok(captured.operations<journal.MAX_CAPTURE_OPERATIONS);
 if(inventoryPages===128)assert.ok(captured.operations>128,'the full capture includes operations beyond inventory listing');
 assert.equal(rawKeys(h).length,1);assert.equal(h.bucket.versions.get(journal.LOCK),2);
 const released=JSON.parse(h.bucket.objects.get(journal.LOCK));assert.ok(Date.parse(released.expiresAt)<h.clock);
 assert.equal(h.bucket.calls.at(-1)[0],'put');assert.equal(h.bucket.calls.at(-1)[1],journal.LOCK);
 assert.equal((await journal.readPendingCapture(h.bucket)).ready,true);
 h.clock+=1000;assert.equal((await h.run()).reused,true);assert.equal(rawKeys(h).length,1);
 assert.equal(pages,inventoryPages,'deduplication does not enumerate/upload the same completed generation again');
});

test('actual R2 capacity and bounded 128-page enumeration ceiling stop intake without a raw upload',async()=>{
 const h=harness(),original=h.bucket.list.bind(h.bucket);h.bucket.list=options=>options?.prefix?original(options):Promise.resolve({objects:[{key:'existing',size:journal.STORAGE_CAP-journal.RAW_RESERVE+1}],truncated:false});
 await assert.rejects(h.run(),/FEED_CAPTURE_STORAGE_BUDGET/);assert.equal(rawKeys(h).length,0);assert.equal(h.bucket.calls.some(call=>call[0]==='multipart'),false);
 let lists=0;await assert.rejects(journal.assertStorageCapacity({bucket:{async list(){lists++;return{objects:[{key:'x',size:1}],truncated:true,cursor:String(lists)};}}}),/FEED_CAPTURE_STORAGE_LIST_LIMIT/);
 assert.equal(journal.MAX_LIST_PAGES,128);assert.equal(lists,journal.MAX_LIST_PAGES);
 assert.ok(journal.MAX_CAPTURE_OPERATIONS>journal.MAX_LIST_PAGES&&journal.MAX_CAPTURE_OPERATIONS<950);
});

test('all-bucket cursor cycles fail before raw upload and still release the capture lease',async()=>{
 const h=harness(),original=h.bucket.list.bind(h.bucket);let pages=0;
 h.bucket.list=async options=>{
  if(options?.prefix)return original(options);
  pages++;return{objects:[{key:`existing/${pages}`,size:1}],truncated:true,cursor:'repeated-cursor'};
 };
 await assert.rejects(h.run(),/FEED_CAPTURE_STORAGE_LIST_INVALID/);
 assert.equal(pages,2);assert.equal(rawKeys(h).length,0);
 assert.equal(h.bucket.calls.some(call=>call[0]==='multipart'),false);
 assert.ok(Date.parse(JSON.parse(h.bucket.objects.get(journal.LOCK)).expiresAt)<h.clock);
});

test('larger enumeration allowance does not relax the 5GiB cap or upload reserve',async()=>{
 let pages=0;
 const withinFirstPages=journal.STORAGE_CAP-journal.RAW_RESERVE-16384;
 await assert.rejects(journal.assertStorageCapacity({bucket:{async list(){
  pages++;return{objects:[{key:`existing/${pages}`,size:pages===1?withinFirstPages:1}],
   truncated:true,cursor:String(pages)};
 }}}),/FEED_CAPTURE_STORAGE_BUDGET/);
 assert.equal(journal.STORAGE_CAP,5*1024*1024*1024);assert.equal(pages,2);
});

test('lease conflict and expired-owner race fail closed before another capture can overwrite raw bytes',async()=>{
 const h=harness(),put=h.bucket.put.bind(h.bucket);h.bucket.put=(key,...args)=>key===journal.LOCK?Promise.resolve(null):put(key,...args);
 const busy=await h.run();assert.equal(busy.reason,'capture_busy');assert.equal(h.fetches,0);
 const late=harness();late.bucket.afterPut=key=>{if(key.startsWith(journal.INTENTS))late.clock+=6*60000;};
 await assert.rejects(late.run(),/FEED_CAPTURE_LEASE_LOST/);assert.equal(rawKeys(late).length,0);assert.equal(await journal.readPendingCapture(late.bucket),null);assert.ok(late.bucket.objects.has(journal.intentKey(7001)));
});

test('unfinished A intent does not block newer B ready capture and remains retained as gap evidence',async()=>{
 const h=harness();h.bucket.beforePut=key=>{if(key.startsWith('raw/'))throw Error('WRITE_FAILED');};
 await assert.rejects(h.run());h.bucket.beforePut=null;h.generation=7002;await h.run();
 const pending=await journal.readPendingCapture(h.bucket);assert.equal(pending.ready,true);assert.equal(pending.generationId,undefined);
 assert.equal(pending.capture.generationId,7002);assert.ok(h.bucket.objects.has(journal.intentKey(7001)));
 assert.equal(h.bucket.objects.has(journal.pendingKey(7001)),false);
 assert.equal(rawKeys(h).length,1);assert.ok(h.bucket.objects.has(journal.completedKey(7002)));
});

test('descriptor committed before ready-pointer failure is repaired from intent after latest advances',async()=>{
 const h=harness();h.bucket.beforePut=key=>{if(key.startsWith(journal.PENDING))throw Error('READY_POINTER_FAILURE');};
 await assert.rejects(h.run());assert.ok(h.bucket.objects.has(journal.completedKey(7001)));assert.ok(h.bucket.objects.has(journal.intentKey(7001)));
 assert.equal(await journal.readPendingCapture(h.bucket),null);h.bucket.beforePut=null;h.generation=7002;
 await h.run();assert.equal((await journal.readPendingCapture(h.bucket)).capture.generationId,7001);
 assert.equal(h.bucket.objects.has(journal.intentKey(7001)),false);assert.equal(rawKeys(h).length,2);
});

test('bounded rotating intent recovery cannot be starved by four older missing raw files',async()=>{
 const h=harness();h.bucket.beforePut=key=>{if(key.startsWith('raw/'))throw Error('WRITE_FAILED');};
 for(let generation=7001;generation<=7005;generation++){h.generation=generation;await assert.rejects(h.run());}
 h.bucket.beforePut=null;await h.bucket.put(journal.RECOVERY,JSON.stringify({version:1,cursor:''}));
 const fifth=JSON.parse(h.bucket.objects.get(journal.intentKey(7005)));await h.bucket.put(fifth.rawKey,h.bytes);
 h.generation=7006;await h.run();assert.equal((await journal.readPendingCapture(h.bucket)).capture.generationId,7006);
 await h.run();assert.equal((await journal.readPendingCapture(h.bucket)).capture.generationId,7005);
 assert.ok(h.bucket.objects.has(journal.intentKey(7001)));assert.equal(h.bucket.objects.has(journal.intentKey(7005)),false);
});
test('scheduled capture ignores exhausted D1 limits and always enqueues existing poll, with sanitized operational result',async t=>{
 const workerSource=fs.readFileSync(path.join(__dirname,'../worker.feed-sync.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const worker=new Function('pipeline','dispatcher','captureJournal',workerSource)(pipeline,{},journal),h=harness();
 const dbCalls=[];const env={REXBID_FEED_ENABLED:'enabled',REXBID_FEED_TARGET:'staging',REXBID_FEED_DATABASE_ID:'acb3cb8e-69a2-459f-8a46-0f2f5b9004be',
  REXBID_FEED_ID:'20',REXBID_FEED_URL:URL,REXBID_DB:{prepare(){dbCalls.push(1);throw Error('D1_MUST_NOT_BE_USED');}},REXBID_FEED_ARCHIVE:h.bucket,
  REXBID_FEED_QUEUE:{async send(body){h.sent=body;}}};
 env.REXBID_FEED_READ_ALLOWANCE_DAY='invalid-day';env.REXBID_FEED_READ_ALLOWANCE_LIMIT='100000001';
 t.mock.method(globalThis,'fetch',h.fetchImpl);t.mock.method(console,'log',()=>{});
 const result=await worker.scheduled({cron:'*/5 * * * *'},env);assert.equal(result.captured,true);assert.deepEqual(dbCalls,[]);
 assert.deepEqual(h.sent,{version:1,kind:'poll'});assert.equal(rawKeys(h).length,1);assert.equal(JSON.stringify(result).includes('offline-token'),false);
 env.REXBID_FEED_URL='private-invalid-url';const failed=await worker.scheduled({cron:'*/5 * * * *'},env);
 assert.equal(failed.captured,false);assert.equal(failed.reason,'FEED_URL_INVALID');assert.deepEqual(h.sent,{version:1,kind:'poll'});assert.deepEqual(dbCalls,[]);
});
