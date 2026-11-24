'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{gzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const {prepareFeedArchivePackedStep,readFeedBucket}=require('../sync/feed-worker-archive.cjs');
const {assertStorageCapacity,STORAGE_CAP,PREPARE_RESERVE}=require('../sync/feed-capture-journal.cjs');
const {MemoryR2}=require('./fixtures/feed-capture-memory.cjs');
const sha=v=>createHash('sha256').update(v).digest('hex'),AT='2026-11-04T12:00:00.000Z';
const limits={line:1024,buffered:8192,chunk:512,records:2000,decoded:256*1024},step={spoolBytes:4096,fanoutChunks:2,fragmentBytes:2048};
const events=()=>Array.from({length:90},(_,i)=>({sequence:i+1,event_id:'event-'+i,event:'bid.changed',terminal:false,
 vehicle:{platform:i%2?'iaai':'copart',lot_number:String(10000000+i%7),vin:'1HGCM82633A004352'},changed_fields:['pricing.current_bid_usd'],
 before:{'pricing.current_bid_usd':20},after:{'pricing.current_bid_usd':i+100},recorded_at:AT}));
function fixture(){const bucket=new MemoryR2(),rows=events(),bytes=gzipSync(rows.map(JSON.stringify).join('\n')+'\n');
 bucket.objects.set('raw/input.gz',bytes);const options={bucket,rawKey:'raw/input.gz',rawSha256:sha(bytes),prefix:'prepared-packed-gzip',observedAt:AT,bucketCount:4,limits,step};
 return {bucket,rows,options,root:'prepared-packed-gzip/'+sha(bytes)+'/v1-b4'};}
async function finish(f,extra={}){for(let i=0;i<100;i++){const r=await prepareFeedArchivePackedStep({...f.options,...extra});if(!r.pending)return r;}assert.fail('bounded archive did not finish');}
async function atPhase(f,phase){if(phase==='spool')return;await prepareFeedArchivePackedStep(f.options);if(phase==='fanout')return;
 for(let i=0;i<100;i++){const r=await prepareFeedArchivePackedStep(f.options);if(r.phase==='fanout'&&r.windowsComplete===r.windowsTotal)return;}assert.fail('finalization phase not reached');}
const objectPins=f=>new Map([...f.bucket.objects].map(([k,v])=>[k,sha(v)]));

test('one full bucket census admits each phase before its first write including capture.json, preserving both original reserves',async()=>{
 const f=fixture();for(let i=0;i<2003;i++)f.bucket.objects.set('unknown-unregistered/preserved-'+String(i).padStart(5,'0'),Buffer.from('x'));
 const admissions=[],records=[];let allowed=false;
 f.bucket.beforePut=key=>{assert.equal(allowed,true,'capacity admission must precede every phase write');records.push(['put',key]);};
 const beforePhaseWrite=async info=>{assert.equal(allowed,false,'one admission per invocation');assert.ok(['spool','fanout','finalize'].includes(info.phase));
  assert.equal(info.rawSha256,f.options.rawSha256);const expected=info.phase==='spool'?limits.decoded+4*1024*1024:JSON.parse(f.bucket.objects.get(f.root+'/spool/manifest.json')).decodedBytes+4*1024*1024;
  assert.equal(info.reserveBytes,expected);const capacity=await assertStorageCapacity({bucket:f.bucket,reserveBytes:Math.max(PREPARE_RESERVE,info.reserveBytes)});
  assert.equal(capacity.capBytes,STORAGE_CAP);assert.ok(capacity.totalBytes>=2003);assert.ok(capacity.reserveBytes>=PREPARE_RESERVE);admissions.push(info.phase);records.push(['admit',info.phase]);allowed=true;};
 let ready;
 for(let i=0;i<100;i++){allowed=false;const start=f.bucket.calls.length,prior=admissions.length;const r=await prepareFeedArchivePackedStep({...f.options,beforePhaseWrite});
  assert.equal(admissions.length,prior+1);assert.equal(r.capacityChecked,true);assert.equal(f.bucket.calls.slice(start).filter(c=>c[0]==='list').length,3,'one three-page census, not two');
  if(!r.pending){ready=r;break;}}
 assert.ok(ready);assert.equal(admissions[0],'spool');assert.equal(admissions.at(-1),'finalize');assert.ok(admissions.filter(p=>p==='fanout').length>1);
 assert.equal(records[0][0],'admit');assert.equal(records[1][1],f.root+'/capture.json');assert.equal(f.bucket.calls.filter(c=>c[0]==='get'&&c[1]==='raw/input.gz').length,1);
 assert.ok([...f.bucket.objects.keys()].some(k=>k.startsWith('unknown-unregistered/')));assert.equal(f.bucket.calls.some(c=>c[0]==='delete'),false);
 const start=f.bucket.calls.length,reused=await prepareFeedArchivePackedStep({...f.options,beforePhaseWrite:async()=>assert.fail('read-only reuse cannot require capacity')});
 assert.equal(reused.reused,true);assert.equal(reused.operations,1);assert.equal(reused.manifestSha256,ready.manifestSha256);assert.equal(f.bucket.calls.slice(start).some(c=>['put','list'].includes(c[0])),false);
});

test('a failed full census before spool, fanout or finalization makes zero PUTs and preserves every unfinished object',async()=>{
 for(const phase of ['spool','fanout','finalize']){const f=fixture();await atPhase(f,phase);const pins=objectPins(f),start=f.bucket.calls.length;let calls=0;
  const prior=f.bucket.list.bind(f.bucket);f.bucket.list=async options=>{f.bucket.calls.push(['list',options.prefix||'']);return {objects:[{key:'unknown-unregistered/large-object',size:STORAGE_CAP}],truncated:false};};
  await assert.rejects(prepareFeedArchivePackedStep({...f.options,beforePhaseWrite:async info=>{calls++;assert.equal(info.phase,phase);await assertStorageCapacity({bucket:f.bucket,reserveBytes:Math.max(PREPARE_RESERVE,info.reserveBytes)});}}),{code:'FEED_CAPTURE_STORAGE_BUDGET'});
  assert.equal(calls,1);assert.equal(f.bucket.calls.slice(start).some(c=>c[0]==='put'),false);assert.deepEqual(objectPins(f),pins);assert.equal(f.bucket.objects.has(f.root+'/manifest.json'),false);f.bucket.list=prior;
 }
});

test('legacy partially prepared packed archives resume with identical capture, windows, progress and final manifest hashes',async()=>{
 const legacy=fixture(),admitted=fixture();await prepareFeedArchivePackedStep(legacy.options);await prepareFeedArchivePackedStep(legacy.options);
 for(const [key,bytes]of legacy.bucket.objects)admitted.bucket.objects.set(key,Buffer.from(bytes));for(const [key,v]of legacy.bucket.versions)admitted.bucket.versions.set(key,v);
 const original=objectPins(admitted),expected=await finish(legacy,{beforeFanout:async()=>{}});let calls=0;
 const actual=await finish(admitted,{beforePhaseWrite:async()=>{calls++;}});assert.ok(calls>0);assert.equal(actual.manifestSha256,expected.manifestSha256);assert.deepEqual(actual.manifest,expected.manifest);assert.deepEqual(objectPins(admitted),objectPins(legacy));
 for(const [key,digest]of original)if(!key.endsWith('/progress.json'))assert.equal(sha(admitted.bucket.objects.get(key)),digest);
 const read=[];for(let i=0;i<4;i++){const r=await readFeedBucket({bucket:admitted.bucket,manifest:actual,bucketIndex:i});read.push(...r.groups.flatMap(g=>g.events));}assert.deepEqual(read.sort((a,b)=>a.sequence-b.sequence),admitted.rows);
});

test('capture, spool, progress and existing-window tampering fail before admission or any new writes',async()=>{
 for(const mode of ['capture','spool','progress','window']){const f=fixture();await prepareFeedArchivePackedStep(f.options);if(mode==='progress'||mode==='window')await prepareFeedArchivePackedStep(f.options);
  const key=f.root+(mode==='capture'?'/capture.json':mode==='spool'?'/spool/manifest.json':mode==='progress'?'/progress.json':'/windows/0.json');
  if(mode==='window'){f.bucket.objects.delete(f.root+'/progress.json');f.bucket.versions.delete(f.root+'/progress.json');}
  const value=JSON.parse(f.bucket.objects.get(key));value.sha256='a'.repeat(64);f.bucket.objects.set(key,Buffer.from(JSON.stringify(value)));
  let admissions=0;const start=f.bucket.calls.length;await assert.rejects(prepareFeedArchivePackedStep({...f.options,beforePhaseWrite:async()=>{admissions++;}}),/FEED_ARCHIVE_/);
  assert.equal(admissions,0);assert.equal(f.bucket.calls.slice(start).some(c=>c[0]==='put'),false);assert.equal(f.bucket.objects.has(f.root+'/manifest.json'),false);
 }
});

test('missing and oversized raw sources do not create capture.json or receive admission',async()=>{
 for(const mode of ['missing','oversized']){const f=fixture();if(mode==='missing')f.bucket.objects.delete(f.options.rawKey);else{const get=f.bucket.get.bind(f.bucket);f.bucket.get=async(...args)=>{const r=await get(...args);if(args[0]===f.options.rawKey)r.size=33*1024*1024;return r;};}
  let calls=0;const start=f.bucket.calls.length;await assert.rejects(prepareFeedArchivePackedStep({...f.options,beforePhaseWrite:async()=>{calls++;}}),/FEED_ARCHIVE_/);
  assert.equal(calls,0);assert.equal(f.bucket.calls.slice(start).some(c=>c[0]==='put'),false);assert.equal(f.bucket.objects.has(f.root+'/capture.json'),false);
 }
});

test('admission rejection cancels the raw body and invalid mixed admission hooks fail before storage I/O',async()=>{
 const f=fixture(),get=f.bucket.get.bind(f.bucket);let cancelled=false;f.bucket.get=async key=>key===f.options.rawKey?{size:100,body:new ReadableStream({cancel(){cancelled=true;}})}:get(key);
 await assert.rejects(prepareFeedArchivePackedStep({...f.options,beforePhaseWrite:async()=>{throw Object.assign(Error('FEED_CAPTURE_STORAGE_BUDGET'),{code:'FEED_CAPTURE_STORAGE_BUDGET'});}}),{code:'FEED_CAPTURE_STORAGE_BUDGET'});assert.equal(cancelled,true);assert.equal(f.bucket.calls.some(c=>c[0]==='put'),false);
 for(const change of [{beforePhaseWrite:true},{beforePhaseWrite:async()=>{},beforeFanout:async()=>{}}]){const g=fixture();await assert.rejects(prepareFeedArchivePackedStep({...g.options,...change}),{code:'FEED_ARCHIVE_STEP_CAPACITY_INVALID'});assert.equal(g.bucket.calls.length,0);}
});

test('lost window/progress acknowledgement resumes through the same immutable receipts under phase admission',async()=>{
 for(const suffix of ['/windows/0.json','/progress.json']){const f=fixture();await prepareFeedArchivePackedStep(f.options);let fired=false;f.bucket.afterPut=key=>{if(!fired&&key===f.root+suffix){fired=true;throw Error('ACK_LOST');}};
  await assert.rejects(prepareFeedArchivePackedStep({...f.options,beforePhaseWrite:async()=>{}}),/FEED_ARCHIVE_/);f.bucket.afterPut=null;
  const prior=objectPins(f),ready=await finish(f,{beforePhaseWrite:async()=>{}});assert.equal(ready.manifest.records,f.rows.length);for(const [key,digest]of prior)if(!key.endsWith('/progress.json'))assert.equal(sha(f.bucket.objects.get(key)),digest);
 }
});

function runnerPrepare(f){
 const {processJob}=require('../sync/feed-server-runner.cjs'),generation={generation_id:8750,status:'downloaded',raw_key:f.options.rawKey,sha256:f.options.rawSha256,observed_at:AT};
 const calls={prepared:0,completed:0,prepareFailure:false},job={job_key:'feed:8750:prepare:0:0',kind:'feed',payload_json:JSON.stringify({generationId:8750,phase:'prepare',bucketIndex:0,groupOffset:0})};
 const state={async getGeneration(){return generation;},coveredByBaseline(){return false;},async getNextGeneration(){return generation;},async storageUsage(){return{totalBytes:0};},
  async markDispatched(){},async completeOutbox(){calls.completed++;},async prepare(input){calls.prepared++;if(calls.prepareFailure){calls.prepareFailure=false;throw Error('TEST_D1_REGISTRATION_UNCERTAIN');}Object.assign(generation,{status:'prepared',manifest_sha256:input.manifestSha256});}};
 const env={REXBID_FEED_ARCHIVE:f.bucket,REXBID_FEED_QUEUE:{async send(){}}};
 return {calls,generation,run:()=>processJob({env,state,db:{},store:{},job,usage:{},now:()=>Date.parse(AT)})};
}
test('real runner prepare branch performs one census per writing phase and none when ready archive registration is retried',async()=>{
 const f=fixture();for(let i=0;i<2003;i++)f.bucket.objects.set('unregistered/preserved-'+i,Buffer.from('x'));const h=runnerPrepare(f);
 for(let i=0;i<2;i++){const start=f.bucket.calls.length,result=await h.run();assert.equal(result.preparing,true);assert.equal(f.bucket.calls.slice(start).filter(c=>c[0]==='list').length,3);}
 h.calls.prepareFailure=true;const start=f.bucket.calls.length;await assert.rejects(h.run(),/REGISTRATION_UNCERTAIN/);assert.equal(f.bucket.calls.slice(start).filter(c=>c[0]==='list').length,3);
 const retry=f.bucket.calls.length,result=await h.run();assert.equal(result.prepared,true);assert.equal(result.archiveMetrics.reused,true);assert.equal(result.archiveMetrics.operations,1);assert.equal(f.bucket.calls.slice(retry).some(c=>c[0]==='list'||c[0]==='put'),false);assert.equal(h.calls.prepared,2);assert.equal(h.generation.status,'prepared');
});
test('runner still checks the whole R2 bucket despite a low D1 storage estimate and writes nothing on capacity denial',async()=>{
 const f=fixture(),h=runnerPrepare(f);f.bucket.list=async()=>{f.bucket.calls.push(['list','']);return{objects:[{key:'unknown-unregistered/unfinished',size:STORAGE_CAP}],truncated:false};};
 await assert.rejects(h.run(),{code:'FEED_CAPTURE_STORAGE_BUDGET'});assert.equal(f.bucket.calls.filter(c=>c[0]==='list').length,1);assert.equal(f.bucket.calls.some(c=>c[0]==='put'),false);assert.equal(h.generation.status,'downloaded');assert.equal(h.calls.prepared,0);
});
test('a corrupted routed source cannot publish a pack or readiness proof after admission',async()=>{
 const f=fixture();await prepareFeedArchivePackedStep(f.options);const spool=JSON.parse(f.bucket.objects.get(f.root+'/spool/manifest.json'));
 const source=spool.chunks[0].key,bytes=Buffer.from(f.bucket.objects.get(source));bytes[10]^=1;f.bucket.objects.set(source,bytes);
 const start=f.bucket.calls.length;let calls=0;await assert.rejects(prepareFeedArchivePackedStep({...f.options,beforePhaseWrite:async()=>{calls++;}}),/FEED_ARCHIVE_/);
 assert.equal(calls,1);assert.equal(f.bucket.calls.slice(start).some(c=>c[0]==='put'),false);assert.equal(f.bucket.objects.has(f.root+'/manifest.json'),false);assert.ok(f.bucket.objects.has(source));
});
test('cancellation during the census stops before the capture write and preserves the original raw source',async()=>{
 const f=fixture(),controller=new AbortController(),pins=objectPins(f);await assert.rejects(prepareFeedArchivePackedStep({...f.options,signal:controller.signal,beforePhaseWrite:async()=>controller.abort()}),{code:'FEED_ARCHIVE_ABORTED'});
 assert.equal(f.bucket.calls.some(c=>c[0]==='put'),false);assert.deepEqual(objectPins(f),pins);
});
