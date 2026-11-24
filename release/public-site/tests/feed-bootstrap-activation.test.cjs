'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {FeedBootstrapMembership}=require('../sync/feed-bootstrap-membership.cjs');
const {replayBootstrapPage}=require('../sync/feed-bootstrap-replay.cjs');
const NOW=Date.parse('2026-11-01T12:00:00.000Z'),AT=new Date(NOW).toISOString(),OLD='2026-10-31T12:00:00.000Z';
const EVENT='2026-11-01T11:00:00.000Z',VIN='1HGCM82633A004352',LOT='10000001';
const fullFixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8')).response.data[0];
function event(sequence=101,lot=LOT,extra={}){return {sequence,event_id:`event-${sequence}`,event:'bid.changed',terminal:false,
 vehicle:{platform:'copart',lot_number:lot,vin:VIN},changed_fields:['pricing.current_bid_usd'],before:{},
 after:{'pricing.current_bid_usd':sequence+1000},recorded_at:EVENT,vehicle_updated_at:EVENT,...extra};}
function created(sequence=101,lot=LOT,extra={}){const record=structuredClone(fullFixture);
 Object.assign(record,{vehicle_id:`bootstrap-${lot}`,platform:'copart',lot_number:lot,vin:VIN,updated_at:EVENT});
 record.auction.state='open';record.pricing={current_bid_usd:200,current_bid2_usd:null,buy_now_usd:6200};
 return event(sequence,lot,{event:'lot.created',changed_fields:['lot.created'],before:[],after:{},record,...extra});}
function page(events=[event()],meta={}){return {ok:true,data:events,meta:{after:100,next_cursor:events.at(-1)?.sequence??100,
 has_more:false,count:events.length,ordering:'sequence_asc',schema_version:'test',retention_days:14,
 oldest_available_sequence:1,latest_available_sequence:events.at(-1)?.sequence??100,...meta}};}
function baseline(){return {version:1,baselineId:'fresh-1',scope:'staging',
 sourceEvidence:{kind:'provider-checkpoint',sha256:'d'.repeat(64),replayStartSequence:100,snapshotSha256:'b'.repeat(64)},
 capture:{sequence:100,capturedAt:OLD,responseSha256:'a'.repeat(64)},snapshot:{generationId:7001,sha256:'b'.repeat(64),records:1,
 requestStartedAt:OLD,observedAt:OLD,generatedAtKnown:false,generatedAt:null}};}
async function harness(t,response=page(),scope='staging',bounded=false){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql','0014_feed_catalog_membership.sql'])
  sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 sqlite.prepare('INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,77,?,?)').run('{}',OLD);
 sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('stream:changes','all','55',?,'complete')").run(OLD);
 const calls={requests:[],batches:[],before:null,after:null,fault:null,clock:NOW,sql:0};
 const db={prepare(sql){return{bind(...params){return{sql,params,
  async first(){calls.sql++;return sqlite.prepare(sql).get(...params)||null;},async all(){calls.sql++;return{results:sqlite.prepare(sql).all(...params)};},
  async run(){calls.sql++;return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}};}};},async batch(statements){
   calls.sql+=statements.length;calls.batches.push(statements);await calls.before?.(statements);sqlite.exec('BEGIN IMMEDIATE');
   let out;try{out=statements.map(s=>{if(calls.fault?.(s))throw Error('INJECTED');return{meta:{changes:Number(sqlite.prepare(s.sql).run(...s.params).changes)}};});sqlite.exec('COMMIT');}
   catch(e){sqlite.exec('ROLLBACK');throw e;}await calls.after?.(statements);return out;
  }};
 const objects=new Map(),bucket={async put(key,bytes,options){assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});if(objects.has(key))return null;objects.set(key,Buffer.from(bytes));return{key};},
  async get(key){const bytes=objects.get(key);if(!bytes)return null;return{size:bytes.length,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(bytes));c.close();}})};}};
 const store=new RefreshStore(db,'replay-test',()=>calls.clock);assert.equal(await store.acquire(),true);
 const membership=new FeedBootstrapMembership({db,store});const plan=baseline();plan.scope=scope;if(bounded){plan.capture={sequence:100,capturedAt:null,capturedNoLaterThan:plan.snapshot.requestStartedAt,timeBasis:'provider-before-start-bound',responseSha256:'a'.repeat(64)};Object.assign(plan.snapshot,{generatedAtKnown:true,generatedAt:EVENT});}await membership.begin(plan);
 const h={sqlite,db,store,membership,bucket,objects,calls,response,
  async request(spec){calls.requests.push(spec);if(h.error)throw h.error;return{response:h.response,observedAt:AT};}};
 seed(h);const row=identity(LOT);await store.guarded((await membership.snapshotStatements({baselineId:'fresh-1',offset:0,endOffset:1,batchSha256:'c'.repeat(64),resolved:[row]})).statements);
 calls.sql=0;calls.batches=[];return h;
}
function identity(lot){return{listingId:`listing-${lot}`,sourceKey:`source-${lot}`,platform:'copart',lot,vin:VIN};}
function seed(h,lot=LOT,changes={}){const row=identity(lot);
 h.sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,identity_state,first_seen_at,last_seen_at,created_at,updated_at)
  VALUES(?,'apibara','copart','resolved',?,?,?,?)`).run(row.sourceKey,OLD,OLD,OLD,OLD);
 const values={listing_id:row.listingId,source_key:row.sourceKey,platform:'copart',lot,vin_normalized:VIN,identity_state:'resolved',
  source_updated_at:OLD,summary_synced_at:OLD,detail_synced_at:OLD,first_seen_at:OLD,last_seen_at:OLD,created_at:OLD,updated_at:OLD,
  auction_state:'open',source_status:'Open',current_bid_usd:100,current_bid2_usd:null,buy_now_usd:15000,...changes};
 h.sqlite.prepare(`INSERT INTO auction_listings(${Object.keys(values)}) VALUES(${Object.keys(values).map(()=>'?')})`).run(...Object.values(values));}
const run=(h,sequence=101,extra={})=>replayBootstrapPage({...h,baselineId:'fresh-1',target:{sequence,observedAt:AT,responseSha256:'e'.repeat(64)},...extra});
const state=async h=>(await h.membership.read('fresh-1')).state;
const task=(h,key='bootstrap-replay:fresh-1:page:100')=>h.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(key);
const bid=(h,lot=LOT)=>h.sqlite.prepare('SELECT current_bid_usd FROM auction_listings WHERE lot=?').get(lot)?.current_bid_usd;
function clean(h){assert.equal(h.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,77);
 assert.equal(task(h,'stream:changes').cursor,'55');assert.equal(h.sqlite.prepare('SELECT baseline_id FROM feed_catalog_pointer').get().baseline_id,null);
 assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 for(const table of ['sync_batch_guards','automatic_refresh_guards'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);}


const {activateBootstrap,readBootstrapActivation}=require('../sync/feed-bootstrap-activation.cjs');
const {prepareFeedArchive}=require('../sync/feed-worker-archive.cjs');
const {gzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const hash=v=>createHash('sha256').update(v).digest('hex');
const {replayBootstrapArchive,bucketKey,taskKey:archiveTaskKey}=require('../sync/feed-bootstrap-archive-replay.cjs');
const STAGING={id:'acb3cb8e-69a2-459f-8a46-0f2f5b9004be',name:'rexbid-auth-test-db'};
async function ready(t,{archive=false,events=[event(101),event(110)],reviewRejected=false,scope='staging',bounded=false}={}){
 const h=await harness(t,page(events),scope,bounded),objects=h.objects;h.bucket={async put(k,b,o){if(o?.onlyIf?.etagDoesNotMatch==='*'&&objects.has(k))return null;objects.set(k,Buffer.from(b));return{key:k};},async get(k){const b=objects.get(k);return b?{size:b.length,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(b));c.close();}})}:null;}};
 h.db.identity=scope==='production'?{id:'c8a30088-70af-43a6-9a7f-c4018279d37d',name:'rexbid-production-preflight-db'}:{...STAGING};h.db.metadataVerified=true;
 if(!archive){await run(h,events.at(-1).sequence);await h.membership.seal({baselineId:'fresh-1',through:events.at(-1).sequence,sourceProofSha256:'d'.repeat(64)});}
 const rawKey='raw/boundary.jsonl.gz',bytes=gzipSync(events.map(JSON.stringify).join('\n')+'\n'),sha=hash(bytes);objects.set(rawKey,bytes);
 const prepared=await prepareFeedArchive({bucket:h.bucket,rawKey,rawSha256:sha,prefix:'prepared',observedAt:AT});
 h.sqlite.prepare(`INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,archive_bytes,observed_at,status,
   manifest_key,manifest_sha256,first_sequence,last_sequence,bucket_groups_json,created_at,updated_at)
  VALUES(9001,?,?,?,?,?,'prepared',?,?,?,?,?,?,?)`).run(sha,rawKey,bytes.length,10000,AT,prepared.manifestKey,prepared.manifestSha256,prepared.manifest.firstSequence,prepared.manifest.lastSequence,JSON.stringify(prepared.manifest.buckets.map(b=>b.uniqueLots)),AT,AT);
 if(archive){let replay;for(let i=0;i<300;i++){replay=await replayBootstrapArchive({...h,baselineId:'fresh-1',generationId:9001});if(replay.complete)break;}assert.equal(replay.complete,true);const count=(await h.membership.read('fresh-1')).state.deltaUnresolved;
  await h.membership.seal({baselineId:'fresh-1',through:prepared.manifest.lastSequence,sourceProofSha256:'d'.repeat(64),reviewedUnresolved:reviewRejected?count:0,reviewSha256:reviewRejected&&count?'f'.repeat(64):null});}
 h.sqlite.prepare('INSERT INTO server_feed_daily_budgets VALUES(?,?,?,?,?,?,?,?)').run('2026-11-01',1000,10000,80,800,70,700,AT);return {...h,prepared};
}
const activate=(h,extra={})=>activateBootstrap({...h,baselineId:'fresh-1',expectedBaselineId:null,expectedPointerRevision:0,expectedServerSequence:77,boundaryGenerationId:9001,...extra});
const activationTask=h=>task(h,'bootstrap-activation:fresh-1');
function unchanged(h){assert.equal(h.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,77);assert.equal(h.sqlite.prepare('SELECT baseline_id FROM feed_catalog_pointer').get().baseline_id,null);assert.equal(activationTask(h),undefined);}
test('activation atomically switches sealed membership and server floor at the verified prepared file end',async t=>{
 const h=await ready(t),before=h.sqlite.prepare('SELECT * FROM server_feed_generations').get(),result=await activate(h);assert.equal(result.alreadyApplied,false);assert.equal(result.receiptSha256,hash(result.receiptCursor));assert.equal(result.floorSequence,110);assert.equal(result.receipt.prior.serverSequence,77);assert.equal(result.receipt.boundary.rawSha256,before.sha256);assert.equal(result.receipt.boundary.manifestSha256,h.prepared.manifestSha256);assert.equal((await h.membership.pointer()).baseline_id,'fresh-1');assert.equal(h.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,110);assert.deepEqual(h.sqlite.prepare('SELECT * FROM server_feed_generations').get(),before);assert.equal(h.sqlite.prepare('SELECT consumed_writes n FROM server_feed_daily_budgets').get().n,70);assert.equal(h.sqlite.prepare('SELECT consumed_reads n FROM server_feed_daily_budgets').get().n,700);assert.equal(h.sqlite.prepare('SELECT reserved_writes n FROM server_feed_daily_budgets').get().n,80);assert.equal(task(h,'stream:changes').cursor,'55');assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);for(const table of ['sync_batch_guards','automatic_refresh_guards'])assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 const repeated=await activate(h);assert.equal(repeated.alreadyApplied,true);assert.equal(repeated.receiptCursor,result.receiptCursor);assert.equal((await h.membership.pointer()).revision,1);
});
test('activation receipt remains a validated floor after continuous cursor and baseline progress',async t=>{
 const h=await ready(t);await activate(h);await h.store.guarded((await h.membership.deltaStatements({baselineId:'fresh-1',after:110,through:120,batchSha256:'f'.repeat(64),changes:[]})).statements);h.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=120,active_generation=9001').run();const result=await readBootstrapActivation({db:h.db,baselineId:'fresh-1'});assert.equal(result.floorSequence,110);assert.equal((await h.membership.read('fresh-1')).state.replaySequence,120);assert.equal(result.receiptKey,'bootstrap-activation:fresh-1');
});
test('production replacement keeps the previous catalogue until the new boundary matches a recent source head',async t=>{
 const h=await ready(t,{archive:true,scope:'production'});
 const fresh=await h.membership.read('fresh-1');
 await h.membership.begin({...fresh.plan,baselineId:'previous'});
 await h.store.guarded((await h.membership.snapshotStatements({baselineId:'previous',offset:0,endOffset:1,batchSha256:'c'.repeat(64),resolved:[identity(LOT)]})).statements);
 await h.store.guarded((await h.membership.deltaStatements({baselineId:'previous',after:100,through:100,batchSha256:'e'.repeat(64),changes:[]})).statements);
 await h.membership.seal({baselineId:'previous',through:100,sourceProofSha256:'d'.repeat(64)});
 await h.membership.switchPointer({baselineId:'previous',expectedBaselineId:null,expectedRevision:0});
 const options={expectedBaselineId:'previous',expectedPointerRevision:1};
 const expectedSourceHead={generationId:9001,sha256:h.prepared.manifest.rawSha256,observedAt:AT};
 for(const head of [undefined,{...expectedSourceHead,generationId:9002},{...expectedSourceHead,sha256:'f'.repeat(64)}]){
  await assert.rejects(activate(h,{...options,expectedSourceHead:head}),/REBASE_SOURCE_HEAD_UNVERIFIED/);
  assert.equal((await h.membership.pointer()).baseline_id,'previous');
 }
 h.calls.clock=NOW+61*60000;
 await assert.rejects(activate(h,{...options,expectedSourceHead}),/REBASE_SOURCE_HEAD_UNVERIFIED/);
 h.calls.clock=NOW;
 await activate(h,{...options,expectedSourceHead});
 assert.equal((await h.membership.pointer()).baseline_id,'fresh-1');
 assert.equal((await h.membership.read('previous')).state.status,'ready');
 assert.equal(h.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,110);
});
test('wrong expected cursor or pointer and active generation roll back all handoff writes',async t=>{
 for(const mode of ['cursor','pointer','active']){const h=await ready(t);if(mode==='active')h.sqlite.prepare('UPDATE server_feed_state SET active_generation=9001').run();await assert.rejects(activate(h,mode==='cursor'?{expectedServerSequence:78}:mode==='pointer'?{expectedPointerRevision:1}:{}));unchanged(h);}
});
test('incomplete, unsealed or pending replay cannot activate',async t=>{
 for(const mode of ['unsealed','unverified','pending']){const h=await ready(t),row=h.sqlite.prepare('SELECT checkpoint_json FROM feed_catalog_baselines').get(),s=JSON.parse(row.checkpoint_json);if(mode==='unsealed')s.status='replaying';if(mode==='unverified')s.replayVerified=false;if(mode==='pending'){s.status='replaying';s.replayVerified=false;s.pendingDelta={after:110,through:120,resumeReady:true};s.lastBatch={kind:'delta-fragment',from:110,through:120,sha256:'f'.repeat(64)};}h.sqlite.prepare('UPDATE feed_catalog_baselines SET checkpoint_json=?').run(JSON.stringify(s));await assert.rejects(activate(h));unchanged(h);}
});
test('corrupt manifest or mismatched prepared generation boundary fails before pointer switch',async t=>{
 for(const mode of ['manifest','boundary','status','retired']){const h=await ready(t);if(mode==='manifest')h.objects.set(h.prepared.manifestKey,Buffer.from('{}'));if(mode==='boundary')h.sqlite.prepare('UPDATE server_feed_generations SET last_sequence=109').run();if(mode==='status')h.sqlite.prepare("UPDATE server_feed_generations SET status='downloaded'").run();if(mode==='retired')h.sqlite.prepare('UPDATE server_feed_generations SET retired_at=?').run(AT);await assert.rejects(activate(h));unchanged(h);}
});
test('missing or tampered canonical replay receipts, raw response and target proofs prevent activation',async t=>{
 for(const mode of ['receipt','raw','target','page']){const h=await ready(t);if(mode==='receipt')h.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key GLOB 'server-feed-batch:*'");if(mode==='raw'){const raw=[...h.objects.keys()].find(k=>k.startsWith('server-feed/gaps/'));h.objects.set(raw,Buffer.from('{}'));}if(mode==='target')h.sqlite.prepare("UPDATE automatic_refresh_tasks SET status='pending' WHERE task_key='bootstrap-replay:fresh-1'").run();if(mode==='page')h.sqlite.prepare("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key='bootstrap-replay:fresh-1:page:100'").run();await assert.rejects(activate(h));unchanged(h);}
});
test('receipt insertion failure and generation, canonical receipt or baseline races roll back pointer and server cursor',async t=>{
 for(const mode of ['insert','generation','receipt','baseline']){const h=await ready(t);if(mode==='insert')h.calls.fault=s=>s.sql.startsWith('INSERT INTO automatic_refresh_tasks')&&s.params.includes('bootstrap-activation:fresh-1');else h.calls.before=ss=>{if(ss.some(s=>s.sql.startsWith('UPDATE feed_catalog_pointer'))){if(mode==='generation')h.sqlite.prepare("UPDATE server_feed_generations SET status='blocked'").run();if(mode==='receipt')h.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key GLOB 'server-feed-batch:*'");if(mode==='baseline')h.sqlite.prepare('UPDATE feed_catalog_baselines SET revision=revision+1').run();}};await assert.rejects(activate(h));unchanged(h);}
});
test('lost activation acknowledgement reads immutable receipt without switching twice or reading provider',async t=>{
 const h=await ready(t);h.calls.after=ss=>{if(ss.some(s=>s.sql.startsWith('UPDATE feed_catalog_pointer')))throw Error('ACK_LOST');};await assert.rejects(activate(h));assert.equal((await h.membership.pointer()).revision,1);assert.equal(h.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,110);h.calls.after=null;const result=await activate(h);assert.equal(result.alreadyApplied,true);assert.equal((await h.membership.pointer()).revision,1);await assert.rejects(activate(h,{boundaryGenerationId:9002}),/RECEIPT_CONFLICT/);
});
test('receipt read rejects altered proof, wrong selected baseline, regressed global cursor and unverified target identity',async t=>{
 for(const mode of ['hash','pointer','cursor','target']){const h=await ready(t);await activate(h);if(mode==='hash'){const receipt=JSON.parse(activationTask(h).cursor);receipt.floorSequence=109;h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(receipt),'bootstrap-activation:fresh-1');}if(mode==='pointer')h.sqlite.prepare('UPDATE feed_catalog_pointer SET baseline_id=NULL').run();if(mode==='cursor')h.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=109').run();if(mode==='target')h.db.metadataVerified=false;await assert.rejects(readBootstrapActivation({db:h.db,baselineId:'fresh-1'}));}
});

test('operator activation requires actual verified exact database identity for the baseline scope',async t=>{
 for(const mode of ['raw','binding-only','unverified','wrong-id','wrong-name','production']){const h=await ready(t);if(mode==='raw'||mode==='binding-only'){delete h.db.identity;delete h.db.metadataVerified;}if(mode==='binding-only'){h.db.bindingIdentityVerified=true;h.db.bindingIdentity={...STAGING};}if(mode==='unverified')h.db.metadataVerified=false;if(mode==='wrong-id')h.db.identity.id='wrong';if(mode==='wrong-name')h.db.identity.name='wrong';if(mode==='production')h.db.identity={id:'c8a30088-70af-43a6-9a7f-c4018279d37d',name:'rexbid-production-preflight-db'};await assert.rejects(activate(h),/TARGET_UNVERIFIED|TARGET_MISMATCH/);unchanged(h);}
});
test('operator receipt permits trusted opaque Worker read binding but never binding-only operator activation',async t=>{
 const h=await ready(t),saved=await activate(h);h.db.bindingIdentityVerified=true;h.db.bindingIdentity={...STAGING};delete h.db.identity;delete h.db.metadataVerified;const read=await readBootstrapActivation({db:h.db,baselineId:'fresh-1'});assert.equal(read.receiptCursor,saved.receiptCursor);assert.equal(read.receiptSha256,hash(saved.receiptCursor));await assert.rejects(activate(h),/TARGET_UNVERIFIED/);h.db.identity={...STAGING};h.db.metadataVerified=false;await assert.rejects(readBootstrapActivation({db:h.db,baselineId:'fresh-1'}),/TARGET_UNVERIFIED/);
});
test('complete archive replay proof activates at its prepared file end without an API replay task',async t=>{
 const h=await ready(t,{archive:true});assert.equal(task(h,'bootstrap-replay:fresh-1'),undefined);assert.equal(h.calls.requests.length,0);const original=h.sqlite.prepare('SELECT * FROM server_feed_generations').get(),result=await activate(h);assert.equal(result.floorSequence,110);assert.equal(result.receipt.replay.kind,'archive');assert.equal(result.receipt.replay.bucketProofCount,128);assert.equal(result.receipt.replay.descriptorKey,archiveTaskKey('fresh-1',9001));assert.equal(result.receipt.replay.proofSha256,(await h.membership.read('fresh-1')).state.lastBatch.sha256);assert.deepEqual(h.sqlite.prepare('SELECT * FROM server_feed_generations').get(),original);assert.equal((await activate(h)).alreadyApplied,true);
});
test('archive marker, canonical state, outer proof and source tampering prevent activation',async t=>{
 for(const mode of ['marker','state','outer','generation']){const h=await ready(t,{archive:true});if(mode==='marker')h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}',bucketKey('fresh-1',9001,0));if(mode==='state')h.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key GLOB 'server-feed:*'");if(mode==='outer')h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}',archiveTaskKey('fresh-1',9001));if(mode==='generation')h.sqlite.prepare('UPDATE server_feed_generations SET sha256=?').run('e'.repeat(64));await assert.rejects(activate(h));unchanged(h);}
});
test('archive proof races and lost activation acknowledgement preserve atomic recovery',async t=>{
 const raced=await ready(t,{archive:true});raced.calls.before=ss=>{if(ss.some(s=>s.sql.startsWith('UPDATE feed_catalog_pointer')))raced.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}',bucketKey('fresh-1',9001,0));};await assert.rejects(activate(raced));unchanged(raced);
 const h=await ready(t,{archive:true});h.calls.after=ss=>{if(ss.some(s=>s.sql.startsWith('UPDATE feed_catalog_pointer')))throw Error('ACK_LOST');};await assert.rejects(activate(h));h.calls.after=null;const result=await activate(h);assert.equal(result.alreadyApplied,true);assert.equal((await h.membership.pointer()).revision,1);
});
test('large archive activation guards all compact proof rows with bounded JSON parameters in one atomic switch',async t=>{
 const h=await ready(t,{archive:true,events:Array.from({length:5000},(_,i)=>event(101+i,String(30000000+i))),reviewRejected:true});let values=0,total=0;h.calls.before=ss=>{if(ss.some(s=>s.sql.startsWith('UPDATE feed_catalog_pointer')))for(const stmt of ss)if(stmt.sql.includes('SELECT 1 FROM json_each(?) r'))for(const param of stmt.params)if(typeof param==='string'&&param.startsWith('[{')){assert.ok(Buffer.byteLength(param)<=256*1024);const rows=JSON.parse(param);total+=rows.length;values++;}};const result=await activate(h);assert.equal(result.floorSequence,5100);assert.equal(result.receipt.replay.kind,'archive');assert.equal(total,257);assert.ok(values>=2);assert.equal((await h.membership.pointer()).revision,1);
});

test('pending alternate replay work prevents handoff even when the selected proof is complete',async t=>{
 for(const archive of [false,true]){const h=await ready(t,{archive});h.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES(?,'all','{}',?,'pending')").run(archive?'bootstrap-replay:fresh-1:page:110':'bootstrap-archive-replay:fresh-1:9002',AT);await assert.rejects(activate(h));unchanged(h);}
});

test('verified production operator identity matches production plan and its opaque Worker binding',async t=>{
 const h=await ready(t,{archive:true,scope:'production'}),result=await activate(h);assert.equal(result.receipt.target.id,'c8a30088-70af-43a6-9a7f-c4018279d37d');h.db.bindingIdentity={...h.db.identity};h.db.bindingIdentityVerified=true;delete h.db.identity;delete h.db.metadataVerified;assert.equal((await readBootstrapActivation({db:h.db,baselineId:'fresh-1'})).floorSequence,110);
});


test('explicit pre-start bound survives verified API and archive replay activation without inventing exact time',async t=>{for(const archive of [false,true]){const h=await ready(t,{archive,bounded:true}),before=(await h.membership.read('fresh-1')).plan;assert.equal(before.capture.capturedAt,null);const result=await activate(h);assert.equal(result.floorSequence,110);assert.equal((await h.membership.read('fresh-1')).plan.capture.capturedAt,null);assert.equal((await readBootstrapActivation({db:h.db,baselineId:'fresh-1'})).floorSequence,110);}});
