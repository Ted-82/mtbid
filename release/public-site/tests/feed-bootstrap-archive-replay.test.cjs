'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{gzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {FeedBootstrapMembership}=require('../sync/feed-bootstrap-membership.cjs');
const {prepareFeedArchive}=require('../sync/feed-worker-archive.cjs');
const {replayBootstrapArchive,verifyBootstrapArchiveReplay,taskKey,bucketKey}=require('../sync/feed-bootstrap-archive-replay.cjs');
const {MemoryR2}=require('./fixtures/feed-capture-memory.cjs');
const {replayBootstrapPage}=require('../sync/feed-bootstrap-replay.cjs');
const NOW=Date.parse('2026-11-01T12:00:00.000Z'),AT=new Date(NOW).toISOString(),OLD='2026-10-31T12:00:00.000Z';
const EVENT='2026-11-01T11:00:00.000Z',VIN='1HGCM82633A004352',LOT='10000001',BASE='fresh-1',GEN=9001;
const hash=x=>createHash('sha256').update(x).digest('hex');
const fullFixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8')).response.data[0];
function event(sequence=101,lot=LOT,extra={}){return {sequence,event_id:`event-${sequence}`,event:'bid.changed',terminal:false,
 vehicle:{platform:'copart',lot_number:lot,vin:VIN},changed_fields:['pricing.current_bid_usd'],before:{},
 after:{'pricing.current_bid_usd':sequence+1000},recorded_at:EVENT,vehicle_updated_at:EVENT,...extra};}
function created(sequence=101,lot=LOT,extra={}){const record=structuredClone(fullFixture);
 Object.assign(record,{vehicle_id:`bootstrap-${lot}`,platform:'copart',lot_number:lot,vin:VIN,updated_at:EVENT});
 record.auction.state='open';record.pricing={current_bid_usd:200,current_bid2_usd:null,buy_now_usd:6200};
 return event(sequence,lot,{event:'lot.created',changed_fields:['lot.created'],before:[],after:{},record,...extra});}
const identity=lot=>({listingId:`listing-${lot}`,sourceKey:`source-${lot}`,platform:'copart',lot,vin:VIN});
function seed(h,lot=LOT,changes={}){const row=identity(lot);
 h.sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,identity_state,first_seen_at,last_seen_at,created_at,updated_at)
  VALUES(?,'apibara','copart','resolved',?,?,?,?)`).run(row.sourceKey,OLD,OLD,OLD,OLD);
 const values={listing_id:row.listingId,source_key:row.sourceKey,platform:'copart',lot,vin_normalized:VIN,identity_state:'resolved',
  source_updated_at:OLD,summary_synced_at:OLD,detail_synced_at:OLD,first_seen_at:OLD,last_seen_at:OLD,created_at:OLD,updated_at:OLD,
  auction_state:'open',source_status:'Open',current_bid_usd:100,current_bid2_usd:null,buy_now_usd:15000,...changes};
 h.sqlite.prepare(`INSERT INTO auction_listings(${Object.keys(values)}) VALUES(${Object.keys(values).map(()=>'?')})`).run(...Object.values(values));}
async function harness(t,events=[event()]){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql','0014_feed_catalog_membership.sql'])
  sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',name),'utf8'));
 sqlite.prepare('INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,77,?,?)').run('{}',OLD);
 sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('stream:changes','all','55',?,'complete')").run(OLD);
 const calls={clock:NOW,before:null,after:null,fault:null,sql:0,maxSql:0,runs:0,maxGuardBytes:0,maxFinalGuards:0};
 const db={prepare(sql){const stmt=params=>({sql,params,bind(...values){return stmt(values);},
  async first(){calls.sql++;return sqlite.prepare(sql).get(...params)||null;},
  async all(){calls.sql++;return{results:sqlite.prepare(sql).all(...params)};},
  async run(){calls.sql++;return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}});return stmt([]);},
 async batch(statements){calls.sql+=statements.length;
  const proofGuards=statements.filter(s=>s.sql.startsWith('INSERT INTO sync_batch_guards')&&s.sql.includes('SELECT 1 FROM json_each(?) r'));
  for(const s of proofGuards)calls.maxGuardBytes=Math.max(calls.maxGuardBytes,Buffer.byteLength(s.params[1],'utf8'));
  if(statements.some(s=>s.sql.includes("SET status='complete',cursor=")))calls.maxFinalGuards=Math.max(calls.maxFinalGuards,proofGuards.length);
  await calls.before?.(statements);sqlite.exec('BEGIN IMMEDIATE');let results;
  try{results=statements.map(s=>{if(calls.fault?.(s))throw Error('INJECTED');return{meta:{changes:Number(sqlite.prepare(s.sql).run(...s.params).changes)}};});sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}await calls.after?.(statements);return results;}};
 const store=new RefreshStore(db,'archive-test',()=>calls.clock);assert.equal(await store.acquire(),true);
 const membership=new FeedBootstrapMembership({db,store}),bucket=new MemoryR2(),h={sqlite,db,store,membership,bucket,calls};
 await membership.begin({version:1,baselineId:BASE,scope:'staging',sourceEvidence:{kind:'provider-checkpoint',sha256:'d'.repeat(64),replayStartSequence:100,snapshotSha256:'b'.repeat(64)},
  capture:{sequence:100,capturedAt:OLD,responseSha256:'a'.repeat(64)},snapshot:{generationId:7001,sha256:'b'.repeat(64),records:1,
   requestStartedAt:OLD,observedAt:OLD,generatedAtKnown:false,generatedAt:null}});
 seed(h);await store.guarded((await membership.snapshotStatements({baselineId:BASE,offset:0,endOffset:1,batchSha256:'c'.repeat(64),resolved:[identity(LOT)]})).statements);
 h.prepared=await addGeneration(h,GEN,events);
 h.beforeGeneration=sqlite.prepare('SELECT * FROM server_feed_generations').get();calls.sql=0;return h;
}
async function addGeneration({sqlite,bucket},generation,events){
 const rawKey=`raw/${generation}.jsonl.gz`,bytes=gzipSync(events.map(JSON.stringify).join('\n')+'\n'),sha=hash(bytes);await bucket.put(rawKey,bytes);
 const prepared=await prepareFeedArchive({bucket,rawKey,rawSha256:sha,prefix:'prepared',observedAt:AT});
 sqlite.prepare(`INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,archive_bytes,observed_at,status,
  manifest_key,manifest_sha256,first_sequence,last_sequence,bucket_groups_json,created_at,updated_at)
  VALUES(?,?,?,?,?,?,'prepared',?,?,?,?,?,?,?)`).run(generation,sha,rawKey,bytes.length,10000,AT,prepared.manifestKey,prepared.manifestSha256,
   prepared.manifest.firstSequence,prepared.manifest.lastSequence,JSON.stringify(prepared.manifest.buckets.map(b=>b.uniqueLots)),AT,AT);
 return prepared;
}
async function run(h,extra={}){h.calls.sql=0;const r=await replayBootstrapArchive({...h,baselineId:BASE,generationId:GEN,...extra});
 h.calls.maxSql=Math.max(h.calls.maxSql,h.calls.sql);h.calls.runs++;return r;}
async function finish(h,extra){let result;for(let i=0;i<200;i++){result=await run(h,extra);if(result.complete)return result;}throw Error('DID_NOT_FINISH');}
const outer=h=>h.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(taskKey(BASE,GEN));
const progress=h=>JSON.parse(outer(h).cursor);
const bid=(h,lot=LOT)=>h.sqlite.prepare('SELECT current_bid_usd FROM auction_listings WHERE lot=?').get(lot)?.current_bid_usd;
async function clean(h){assert.equal(h.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,77);
 assert.equal(h.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='stream:changes'").get().cursor,'55');
 assert.equal((await h.membership.pointer()).baseline_id,null);assert.deepEqual(h.sqlite.prepare('SELECT * FROM server_feed_generations').get(),h.beforeGeneration);
 assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 for(const table of ['sync_batch_guards','automatic_refresh_guards'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);}

test('all 128 retained archive buckets replay without transport and establish only isolated membership cursor',async t=>{
 const h=await harness(t,[event(101),event(110)]),result=await finish(h);
 assert.equal(result.requests,0);assert.equal(result.through,110);assert.equal(result.proof.buckets.length,128);
 assert.equal(result.proof.records,2);assert.equal(bid(h),1110);assert.equal((await h.membership.read(BASE)).state.replaySequence,110);
 assert.equal(outer(h).status,'complete');assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key GLOB 'bootstrap-archive-replay:*:bucket:*'").get().n,128);
 const verified=await verifyBootstrapArchiveReplay({...h,baselineId:BASE,generationId:GEN});assert.deepEqual(verified.proof,result.proof);
 const repeated=await run(h);assert.equal(repeated.complete,true);assert.equal(repeated.newPartialBatches,0);await clean(h);
});

test('three adjacent retained files chain exact predecessors without requesting the API and detect earlier receipt changes',async t=>{
 const h=await harness(t);await finish(h);
 await addGeneration(h,9002,[event(102)]);const second=await finish(h,{generationId:9002});
 assert.equal(second.proof.prefixReplay.kind,'archive');
 assert.equal(second.proof.prefixReplay.taskKey,taskKey(BASE,GEN));
 await addGeneration(h,9003,[event(103)]);const third=await finish(h,{generationId:9003});
 assert.equal(third.proof.prefixReplay.taskKey,taskKey(BASE,9002));
 const options={...h,baselineId:BASE,generationId:9003,wholeChain:true};
 const verified=await verifyBootstrapArchiveReplay(options);
 assert.equal(verified.proof.through,103);
 assert.ok(verified.rows.some(row=>row.task_key===taskKey(BASE,GEN)));
 assert.equal(bid(h),1103);
 assert.equal((await h.membership.read(BASE)).state.replaySequence,103);
 h.sqlite.prepare("UPDATE automatic_refresh_tasks SET cursor=cursor||' ' WHERE task_key=?").run(taskKey(BASE,GEN));
 await assert.rejects(verifyBootstrapArchiveReplay(options),/PREFIX_PROOF_INVALID/);
 assert.equal((await h.membership.pointer()).baseline_id,null);
 assert.equal(h.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,77);
});

test('a completed archive receipt changed before the successor starts cannot advance the isolated cursor',async t=>{
 const h=await harness(t);await finish(h);
 await addGeneration(h,9002,[event(102)]);
 const p=progress(h);p.proof.records++;
 h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(p),taskKey(BASE,GEN));
 await assert.rejects(run(h,{generationId:9002}),/PREFIX_PROOF_INVALID/);
 assert.equal(h.sqlite.prepare('SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?').get(taskKey(BASE,9002)),undefined);
 assert.equal((await h.membership.read(BASE)).state.replaySequence,101);
 assert.equal(bid(h),1101);
});

test('source continuity, manifest binding and incomplete snapshot fail before canonical mutation',async t=>{
 for(const mode of ['gap','overlap','manifest','generation','incomplete']){
  const h=await harness(t,[event(mode==='gap'?102:mode==='overlap'?100:101)]);
  if(mode==='manifest')await h.bucket.put(h.prepared.manifestKey,Buffer.from('{}'));
  if(mode==='generation')h.sqlite.prepare('UPDATE server_feed_generations SET manifest_sha256=?').run('e'.repeat(64));
  if(mode==='incomplete'){const row=h.sqlite.prepare('SELECT checkpoint_json FROM feed_catalog_baselines').get(),s=JSON.parse(row.checkpoint_json);
   Object.assign(s,{offset:0,resolved:0,status:'building',lastBatch:null});h.sqlite.prepare('UPDATE feed_catalog_baselines SET checkpoint_json=?').run(JSON.stringify(s));}
  await assert.rejects(run(h));assert.equal(outer(h),undefined);assert.equal(bid(h),100);
 }
});

test('partial canonical writes resume by hash receipts after lost acknowledgement with no duplicate membership changes',async t=>{
 const h=await harness(t,[event()]);h.calls.after=ss=>{if(ss.some(s=>s.sql.startsWith('UPDATE auction_listings')))throw Error('ACK_LOST');};
 await assert.rejects(finish(h));assert.equal(bid(h),1101);assert.equal((await h.membership.read(BASE)).state.replaySequence,100);
 assert.ok((await h.membership.read(BASE)).state.pendingDelta);h.calls.after=null;
 const count=h.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key GLOB 'server-feed-batch:*'").get().n;
 await finish(h);assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key GLOB 'server-feed-batch:*'").get().n,count);
 assert.equal((await h.membership.read(BASE)).state.deltaUnresolved,0);await clean(h);
});

test('outer bucket acknowledgement and final completion are recoverable without replaying committed changes',async t=>{
 for(const stage of ['bucket','final']){const h=await harness(t);h.calls.after=ss=>{if(ss.some(s=>stage==='bucket'
   ?s.sql.startsWith('INSERT INTO automatic_refresh_tasks')&&s.params.some(p=>typeof p==='string'&&p.startsWith('bootstrap-archive-replay:')&&p.includes(':bucket:'))
   :s.sql.includes("SET status='complete',cursor=")))throw Error('ACK_LOST');};
  await assert.rejects(finish(h));h.calls.after=null;const result=await finish(h);assert.equal(result.complete,true);assert.equal(bid(h),1101);await clean(h);
 }
});

test('canonical update and membership fragment roll back together; final cursor and outer completion are atomic',async t=>{
 for(const stage of ['fragment','final']){const h=await harness(t);h.calls.fault=s=>stage==='fragment'
  ?s.sql.startsWith('UPDATE feed_catalog_baselines'):s.sql.includes("SET status='complete',cursor=");
  await assert.rejects(finish(h));assert.equal((await h.membership.read(BASE)).state.replaySequence,100);assert.equal(outer(h).status,'pending');
  if(stage==='fragment')assert.equal(bid(h),100);h.calls.fault=null;assert.equal((await finish(h)).complete,true);await clean(h);
 }
});

test('tampered prepared bucket or canonical proof cannot be treated as a completed archive',async t=>{
 for(const mode of ['raw','state','marker']){const h=await harness(t);if(mode==='raw'){
   const b=h.prepared.manifest.buckets.find(b=>b.records);await h.bucket.put(b.manifestKey,Buffer.from('{}'));await assert.rejects(finish(h));
  }else{await finish(h);
   if(mode==='state')h.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key GLOB 'server-feed:*'");
   if(mode==='marker')h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}',bucketKey(BASE,GEN,0));
   await assert.rejects(verifyBootstrapArchiveReplay({...h,baselineId:BASE,generationId:GEN}));
  }
 }
});

test('final audit proof CAS detects tampering between readback and commit',async t=>{
 const h=await harness(t);h.calls.before=ss=>{if(ss.some(s=>s.sql.includes("SET status='complete',cursor=")))
  h.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key GLOB 'server-feed:*'");};
 await assert.rejects(finish(h));assert.equal((await h.membership.read(BASE)).state.replaySequence,100);assert.equal(outer(h).status,'pending');
});

test('bucket marker is compact and cannot be committed after a changed batch audit',async t=>{
 const h=await harness(t);h.calls.before=ss=>{if(ss.some(s=>s.sql.startsWith('INSERT INTO automatic_refresh_tasks')
   &&s.params.some(v=>typeof v==='string'&&v.includes('"kind":"bootstrap-archive-bucket"')&&v.includes('"records":1'))))
  h.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key GLOB 'server-feed-batch:*'");};
 await assert.rejects(finish(h));assert.equal((await h.membership.read(BASE)).state.replaySequence,100);
 const other=await harness(t);await finish(other);const markers=other.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key GLOB 'bootstrap-archive-replay:*:bucket:*'").all();
 for(const row of markers){const marker=JSON.parse(row.cursor);assert.equal(Object.hasOwn(marker,'batchReceipts'),false);
  assert.ok(Number.isSafeInteger(marker.batchReceiptCount));assert.match(marker.batchReceiptsSha256,/^[a-f0-9]{64}$/);assert.ok(Buffer.byteLength(row.cursor)<3000);}
});

test('full records hydrate both platforms and unknown bid-only records remain explicitly unresolved',async t=>{
 const iaai=created(102,'10000002');iaai.vehicle.platform='iaai';iaai.record.platform='iaai';
 const h=await harness(t,[event(101),iaai,event(103,'10000003')]);const result=await finish(h);
 assert.equal(result.proof.records,3);assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM auction_listings WHERE platform='iaai' AND lot='10000002'").get().n,1);
 assert.equal(h.sqlite.prepare("SELECT active FROM feed_catalog_membership m JOIN auction_listings l ON l.listing_id=m.listing_id WHERE l.platform='iaai' AND l.lot='10000002'").get().active,1);
 assert.equal((await h.membership.read(BASE)).state.deltaUnresolved,1);assert.equal(bid(h,'10000003'),undefined);await clean(h);
});

test('new hydrations, partial batches and empty-bucket walking stay bounded per invocation',async t=>{
 const events=Array.from({length:450},(_,i)=>created(101+i,String(20000000+i))),h=await harness(t,events);
 let result;for(let i=0;i<180;i++){result=await run(h);assert.ok(result.newHydrationGroups<=40);assert.ok(result.newPartialBatches<=3);
  assert.ok(h.calls.sql<970,`SQL statements ${h.calls.sql}`);if(result.complete)break;}
 assert.equal(result.complete,true);assert.equal((await h.membership.read(BASE)).state.replaySequence,550);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,451);assert.ok(h.calls.runs>1);await clean(h);
});

test('large archive final proof stays bounded independently of thousands of per-vehicle audit decisions',async t=>{
 const h=await harness(t,Array.from({length:5000},(_,i)=>event(101+i,String(30000000+i))));const result=await finish(h);
 assert.equal(result.proof.records,5000);assert.equal(result.proof.buckets.length,128);assert.equal((await h.membership.read(BASE)).state.deltaUnresolved,5000);
 assert.ok(h.calls.maxGuardBytes<=256*1024,`guard bytes ${h.calls.maxGuardBytes}`);assert.ok(h.calls.maxFinalGuards<=16);
 assert.ok(h.calls.maxSql<970,`statements ${h.calls.maxSql}`);
 const verified=await verifyBootstrapArchiveReplay({...h,baselineId:BASE,generationId:GEN});assert.equal(verified.rows.length,257);
 assert.equal(verified.rows.filter(r=>r.task_key.startsWith('server-feed-batch:')).length,0);await clean(h);
});

test('changed outer progress, source generation, expired lease and unverified operator binding stop writes',async t=>{
 for(const mode of ['pointer','generation','lease','identity']){const h=await harness(t);await run(h,{maxBuckets:1});
  if(mode==='pointer'){const p=progress(h);p.descriptor.after=99;h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(p),taskKey(BASE,GEN));}
  if(mode==='generation')h.sqlite.exec("UPDATE server_feed_generations SET status='blocked'");
  if(mode==='lease')h.calls.clock=NOW+11*60000;
  if(mode==='identity')Object.assign(h.db,{identity:{id:'unknown',name:'unknown'},metadataVerified:false});
  await assert.rejects(finish(h));assert.equal((await h.membership.read(BASE)).state.replaySequence,100);
 }
});

test('pending API page and conflicting archive cannot overlap an independent bootstrap replay',async t=>{
 const h=await harness(t);h.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES(?,'all','{}',?,'pending')")
  .run('bootstrap-replay:'+BASE+':page:100',AT);await assert.rejects(run(h));assert.equal(outer(h),undefined);
 const other=await harness(t);other.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES(?,'all','{}',?,'pending')")
  .run('bootstrap-archive-replay:'+BASE+':9002',AT);await assert.rejects(run(other));assert.equal(outer(other),undefined);
});

test('small API-proven prefix may precede the archive but cannot be inferred from a file identifier',async t=>{
 const h=await harness(t,[event(105),event(110)]);await assert.rejects(run(h),/CONTINUITY_GAP/);
 let requests=0;await replayBootstrapPage({...h,baselineId:BASE,target:{sequence:104,observedAt:AT,responseSha256:'f'.repeat(64)},
  request:async()=>{requests++;return{observedAt:AT,response:{ok:true,data:[event(101),event(104)],meta:{after:100,next_cursor:104,has_more:false,
   count:2,ordering:'sequence_asc',schema_version:'test',retention_days:14,oldest_available_sequence:1,latest_available_sequence:104}}};}});
 const result=await finish(h);assert.equal(result.proof.after,104);assert.equal(result.proof.sourceSequence,100);assert.equal(result.through,110);await clean(h);
 assert.equal(requests,1);assert.equal(result.proof.prefixReplay.pages.length,1);
 const falseCursor=await harness(t,[event(105)]);await falseCursor.store.guarded((await falseCursor.membership.deltaStatements({
  baselineId:BASE,after:100,through:104,batchSha256:'f'.repeat(64),changes:[]})).statements);
 await assert.rejects(run(falseCursor),/PREFIX_PROOF_INVALID/);assert.equal(outer(falseCursor),undefined);
});
