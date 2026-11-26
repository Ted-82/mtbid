'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {gzipSync} = require('node:zlib');
const {DatabaseSync} = require('node:sqlite');
const {createApibaraProvider} = require('../providers/apibara.js');
const {RefreshStore} = require('../sync/automatic-refresh.cjs');
const {downloadFeed} = require('../scripts/apibara-feed.cjs');
const {readSnapshotPages} = require('../scripts/feed-snapshot-pages.cjs');
const {createBootstrapPlan, runBootstrapImport, createBootstrapMembershipCheckpoint} = require('../sync/feed-bootstrap-import.cjs');
const AT = '2026-10-27T12:00:00.000Z', NOW = Date.parse('2026-10-27T12:05:00.000Z');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/apibara-discovery-page-shape.json'), 'utf8')).response.data[0];
const provider = createApibaraProvider({fetch: async () => {throw Error('PROVIDER_CALL_FORBIDDEN');}});
const freshnessPolicy = {hotIntervalMs: 3600000, warmIntervalMs: 86400000, coldIntervalMs: 604800000, hotWindowMs: 3600000};
function raw(index = 0) {
  const record = structuredClone(fixture);
  record.platform = index % 2 ? 'iaai' : 'copart'; record.lot_number = String(10000000 + index);
  record.vehicle_id = `${record.platform}-${record.lot_number}`; record.vin = '1HGCM82633A004352';
  record.auction.state = 'open'; record.updated_at = AT; record.pricing.current_bid_usd = index;
  return record;
}
function database(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0004_d1_sync_2.sql', '0008_automatic_refresh.sql']) sqlite.exec(fs.readFileSync(path.join(__dirname, '../docs/proposals', file), 'utf8'));
  let fault = null, beforeBatch = null;
  const db = {metadataVerified:true,identity:{id:'fresh_stage',name:'fresh-staging'},prepare(sql) {return {bind(...params) {return {sql, params,
    async all() {return {results: sqlite.prepare(sql).all(...params)};},
    async first() {return sqlite.prepare(sql).get(...params) || null;},
    async run() {return {meta: {changes: Number(sqlite.prepare(sql).run(...params).changes)}};}
  };}};}, async batch(statements) {
    if (beforeBatch) {const callback = beforeBatch; beforeBatch = null; callback();}
    sqlite.exec('BEGIN IMMEDIATE');
    try {const results = statements.map(statement => {
      if (fault?.(statement)) throw Error('INJECTED_DATABASE_FAILURE');
      return {meta: {changes: Number(sqlite.prepare(statement.sql).run(...statement.params).changes)}};
    }); sqlite.exec('COMMIT'); return results;} catch (error) {sqlite.exec('ROLLBACK'); throw error;}
  }};
  return {db, sqlite, store: new RefreshStore(db, 'feed-snapshot-test', () => NOW), setFault(value) {fault = value;}, beforeBatch(value) {beforeBatch = value;}};
}

const count=(e,table)=>e.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n;
async function setup(t,n=43){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rexbid-bootstrap-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const rows=Array.isArray(n)?n:Array.from({length:n},(_,i)=>raw(i)),manifest=await downloadFeed({url:'https://apibara.tech/data-feeds/fictional/latest',directory,mode:'snapshot',fetchImpl:async()=>new Response(gzipSync(rows.map(JSON.stringify).join('\n')))});const env=database(t);await env.store.acquire();env.sqlite.exec("CREATE TABLE protected_clients(id TEXT PRIMARY KEY,value TEXT); INSERT INTO protected_clients VALUES('keep','existing-client-history')");const plan=createBootstrapPlan({target:env.db.identity,manifest,generationId:9001,observedAt:AT,batchSize:20,sourceEvidence:{verified:true,fileSha256:manifest.sha256,generationId:9001,feedId:'fictional-feed',deltaStartN:12345,checkpointResponseSha256:'c'.repeat(64),deltaStartCapturedAt:'2026-10-27T11:59:00.000Z',snapshotRequestedAt:'2026-10-27T12:00:00.000Z',generatedAtKnown:false,generatedAt:null,platforms:['copart','iaai'],evidenceSha256:'d'.repeat(64)},now:NOW});return{...env,directory,manifest,rows,plan};}
const run=(f,extra={})=>runBootstrapImport({...f,provider,freshnessPolicy,maxBatches:100,beforeBatch:async()=>{},...extra});
const pinKey=f=>'bootstrap:'+f.plan.target.id+':'+f.manifest.sha256;
const checkpoint=f=>JSON.parse(f.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get('file-snapshot:'+f.manifest.sha256).cursor);

test('canonical streaming upserts resume at a verified receipt and preserve protected data and delta state',async t=>{
 const f=await setup(t),progress=[];const first=await run(f,{maxBatches:1,onReceipt:r=>progress.push(r)});assert.equal(first.state.offset,20);assert.equal(first.complete,false);assert.equal(count(f,'auction_listings'),20);
 const resumed=await run(f);assert.equal(resumed.replayedBatches,1);assert.equal(resumed.appliedBatches,2);assert.equal(resumed.state.inserted,43);assert.equal(resumed.complete,true);assert.equal(resumed.handoffCandidate.after,12345);assert.equal(resumed.deltaCursorChanged,false);assert.equal(resumed.providerRequests,0);
 const replay=await run(f);assert.equal(replay.replayedBatches,1);assert.equal(replay.appliedBatches,0);assert.equal(count(f,'auction_listing_snapshots'),43);assert.equal(progress.length,1);assert.equal(progress[0].batchSha256.length,64);
 assert.equal(f.sqlite.prepare('SELECT value FROM protected_clients').get().value,'existing-client-history');assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(count(f,'sync_batch_guards'),0);
});
test('metadata-verified exact target identity is required before any D1 write',async t=>{
 for(const mode of ['id','name','metadata']){const f=await setup(t);if(mode==='metadata')f.db.metadataVerified=false;else f.db.identity[mode]='other';await assert.rejects(run(f),/FEED_BOOTSTRAP_(TARGET_MISMATCH|STORE_REQUIRED)/);assert.equal(count(f,'auction_listings'),0);assert.equal(count(f,'automatic_refresh_tasks'),0);}
});
test('whole gzip corruption or scope failure yields no metadata pin and no catalogue writes',async t=>{
 const f=await setup(t);fs.appendFileSync(path.join(f.directory,f.manifest.file),'corrupt');await assert.rejects(run(f),/FEED_SNAPSHOT_FILE_CHANGED/);assert.equal(count(f,'automatic_refresh_tasks'),0);assert.equal(count(f,'auction_listings'),0);
});
test('immutable pin refuses changed capture, time mode, batch size or baseline evidence',async t=>{
 const f=await setup(t);await run(f,{maxBatches:1});
 for(const change of [{observedAt:'2026-10-27T11:00:00.000Z',observationTimeBasis:'capture'},{batchSize:60},{sourceEvidence:{...f.plan.sourceEvidence,deltaStartN:50,evidenceSha256:'c'.repeat(64)}}]){const plan=createBootstrapPlan({...f.plan,...change,now:NOW});await assert.rejects(run(f,{plan}),/FEED_BOOTSTRAP_PLAN_CONFLICT/);assert.equal(checkpoint(f).offset,20);}
 const plan=structuredClone(f.plan);plan.generationId++;await assert.rejects(run(f,{plan}),/FEED_BOOTSTRAP_PLAN_HASH/);
});
test('a lost commit response is never retried automatically; resume verifies durable receipt without duplicate snapshots',async t=>{
 const f=await setup(t),original=f.db.batch.bind(f.db);let lost=false;f.db.batch=async statements=>{const result=await original(statements);if(!lost&&statements.some(s=>s.sql.includes('scan_pages=automatic_refresh_tasks.scan_pages+1'))){lost=true;throw Error('RESPONSE_LOST');}return result;};await assert.rejects(run(f),/INVENTORY_COMMIT_FAILED/);assert.equal(checkpoint(f).offset,20);assert.equal(count(f,'auction_listing_snapshots'),20);const resumed=await run(f);assert.equal(resumed.replayedBatches,1);assert.equal(resumed.state.offset,43);assert.equal(count(f,'auction_listing_snapshots'),43);
});
test('readback failure stops before the next page and next invocation recovers by durable audit',async t=>{
 const f=await setup(t),original=f.db.prepare.bind(f.db);let bad=true;f.db.prepare=sql=>{if(bad&&sql.includes(') checkpoint,'))return{bind(){return{async first(){return{checkpoint:'null',audit:'null',actual:'[]'};}};}};return original(sql);};await assert.rejects(run(f),/FEED_BOOTSTRAP_READBACK_FAILED/);assert.equal(checkpoint(f).offset,20);assert.equal(count(f,'auction_listings'),20);bad=false;const resumed=await run(f);assert.equal(resumed.replayedBatches,1);assert.equal(resumed.complete,true);
});
test('budget or lease callback rejection and pre-abort leave no metadata or catalogue writes',async t=>{
 for(const abort of [false,true]){const f=await setup(t),controller=new AbortController();if(abort)controller.abort();await assert.rejects(run(f,{signal:controller.signal,beforeBatch:async()=>{throw Error('BUDGET_DENIED');}}),abort?/FEED_BOOTSTRAP_ABORTED/:/BUDGET_DENIED/);assert.equal(count(f,'automatic_refresh_tasks'),0);assert.equal(count(f,'auction_listings'),0);}
 const f=await setup(t);f.sqlite.prepare('UPDATE automatic_refresh_state SET lease_until=?').run('2026-10-26T00:00:00.000Z');await assert.rejects(run(f),/REFRESH|FAILED/);assert.equal(count(f,'automatic_refresh_tasks'),0);
});
test('receipt callback failure leaves committed data recoverable and does not import another page',async t=>{
 const f=await setup(t);await assert.rejects(run(f,{onReceipt:async()=>{throw Error('JOURNAL_FAILED');}}),/JOURNAL_FAILED/);assert.equal(checkpoint(f).offset,20);const resumed=await run(f);assert.equal(resumed.replayedBatches,1);assert.equal(count(f,'auction_listing_snapshots'),43);
});
test('source evidence binds exact fresh file and generation and captures N before snapshot request',async t=>{
 const f=await setup(t),evidence=f.plan.sourceEvidence;
 for(const change of [{verified:false},{fileSha256:'b'.repeat(64)},{generationId:9002},{deltaStartN:-1},{feedId:'bad/feed'},
   {deltaStartCapturedAt:'2026-10-27T12:01:00.000Z'},{snapshotRequestedAt:'2026-10-28T00:00:00.000Z'},{platforms:['copart']},{generatedAtKnown:true,generatedAt:'2026-10-27T11:58:00.000Z'},{generatedAtKnown:false,generatedAt:AT}])assert.throws(()=>createBootstrapPlan({...f.plan,sourceEvidence:{...evidence,...change},now:NOW}),/FEED_BOOTSTRAP_SOURCE_EVIDENCE_INVALID/);
 assert.throws(()=>createBootstrapPlan({...f.plan,sourceEvidence:undefined,now:NOW}),/FEED_BOOTSTRAP_SOURCE_EVIDENCE_INVALID/);
 const first=await run(f,{maxBatches:1});assert.equal(first.handoffCandidate,null);const complete=await run(f);assert.equal(complete.handoffCandidate.after,evidence.deltaStartN);assert.equal(complete.handoffCandidate.kind,'overlap-replay');assert.equal(complete.deltaCursorChanged,false);
});
test('resumption rejects damaged checkpoint or missing receipt without another canonical write',async t=>{
 for(const mode of ['checkpoint','receipt']){const f=await setup(t);await run(f,{maxBatches:1});if(mode==='checkpoint')f.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('null','file-snapshot:'+f.manifest.sha256);else f.sqlite.prepare("DELETE FROM automatic_refresh_tasks WHERE task_key LIKE 'file-batch:%'").run();await assert.rejects(run(f),/BOOTSTRAP_CHECKPOINT_INVALID|IMPORT_REPLAY_UNVERIFIED/);assert.equal(count(f,'auction_listings'),20);}
});
test('source dates remain per-record and absent financial/run authorization fails closed',async t=>{
 const f=await setup(t);for(const extra of [{beforeBatch:undefined},{maxBatches:0},{maxBatches:undefined}])await assert.rejects(run(f,extra),/FEED_BOOTSTRAP_RUN_LIMIT_INVALID/);assert.equal(count(f,'automatic_refresh_tasks'),0);await run(f);assert.equal(f.sqlite.prepare('SELECT MIN(summary_synced_at) d FROM auction_listings').get().d,AT);
});

test('rejected records remain durably counted with exact reason-set digest and block canonical handoff',async t=>{
 const rows=Array.from({length:43},(_,i)=>raw(i));rows[1].vin='MASKED';rows[35].vin=null;const f=await setup(t,rows),first=await run(f,{maxBatches:1});assert.equal(first.rejections.count,1);assert.equal(first.rejections.complete,false);assert.equal(first.rejections.sha256,null);const completed=await run(f);assert.equal(completed.complete,true);assert.equal(completed.canonicalComplete,false);assert.equal(completed.handoffCandidate,null);assert.equal(completed.rejections.count,2);assert.deepEqual(completed.rejections.reasonCounts,{AUTOMATIC_REFRESH_IDENTITY_INVALID:2});assert.match(completed.rejections.sha256,/^[a-f0-9]{64}$/);assert.equal(count(f,'auction_listings'),41);assert.deepEqual((await run(f)).rejections,completed.rejections);
});
test('known generation time must follow snapshot request; unknown provider time stays explicitly unknown',async t=>{
 const f=await setup(t),known=createBootstrapPlan({...f.plan,sourceEvidence:{...f.plan.sourceEvidence,generatedAtKnown:true,generatedAt:AT},now:NOW});assert.equal(known.sourceEvidence.generatedAt,AT);assert.equal(f.plan.sourceEvidence.generatedAt,null);assert.equal(f.plan.sourceEvidence.generatedAtKnown,false);
});

test('membership checkpoint statements share canonical rollback and are omitted on verified replay',async t=>{
 const f=await setup(t);f.sqlite.exec('CREATE TABLE membership_proof(page_offset INTEGER PRIMARY KEY,batch_sha TEXT,listing_count INTEGER)');let calls=0;const extension=async context=>{calls++;assert.equal(context.receipt.batchSha256.length,64);assert.equal(context.prepared.length,context.receipt.records.length);const statement=context.db.prepare('INSERT INTO membership_proof VALUES(?,?,?)').bind(context.receipt.offset,context.receipt.batchSha256,context.prepared.length);context.prepared[0].record.vehicle.pricing.current_bid=999;context.receipt.records[0].pricing.current_bid_usd=999;return[statement];};
 f.setFault(s=>s.sql.startsWith('INSERT INTO membership_proof'));await assert.rejects(run(f,{prepareCheckpointStatements:extension}),/INVENTORY_COMMIT_FAILED/);assert.equal(count(f,'auction_listings'),0);assert.equal(count(f,'membership_proof'),0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key LIKE 'file-snapshot:%'").get().n,0);
 f.setFault(null);await run(f,{prepareCheckpointStatements:extension,maxBatches:1});assert.equal(count(f,'membership_proof'),1);assert.equal(f.sqlite.prepare('SELECT current_bid_usd bid FROM auction_listings WHERE lot=?').get('10000000').bid,0);const before=calls;const done=await run(f,{prepareCheckpointStatements:extension});assert.equal(done.replayedBatches,1);assert.equal(calls-before,2);assert.equal(count(f,'membership_proof'),3);assert.equal(count(f,'auction_listing_snapshots'),43);
});
test('oversized or malformed checkpoint extension fails before canonical commit',async t=>{
 for(const result of [null,[null],Array(7).fill({})]){const f=await setup(t);await assert.rejects(run(f,{prepareCheckpointStatements:async()=>result}),/FEED_IMPORT_CHECKPOINT_EXTENSION_INVALID/);assert.equal(count(f,'auction_listings'),0);}
});
test('pinned expanded-byte count is checked against full decoded source before metadata pin',async t=>{
 const f=await setup(t),plan=createBootstrapPlan({...f.plan,manifest:{...f.manifest,expandedBytes:f.manifest.expandedBytes+1},now:NOW});await assert.rejects(run(f,{plan}),/FEED_SNAPSHOT_SIZE_CHANGED/);assert.equal(count(f,'automatic_refresh_tasks'),0);assert.equal(count(f,'auction_listings'),0);
});
test('rejection report streams more than one bounded audit page and remains deterministic',async t=>{
 const rows=Array.from({length:270},(_,i)=>({...raw(i),vin:'MASKED'})),f=await setup(t,rows),result=await run(f);assert.equal(result.rejections.count,270);assert.equal(result.rejections.complete,true);assert.deepEqual(result.rejections.reasonCounts,{AUTOMATIC_REFRESH_IDENTITY_INVALID:270});assert.equal(result.canonicalComplete,false);assert.equal(result.handoffCandidate,null);assert.equal(count(f,'auction_listings'),0);assert.deepEqual((await run(f)).rejections,result.rejections);
});

async function membershipAdapter(f){f.sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0014_feed_catalog_membership.sql'),'utf8'));const {FeedBootstrapMembership}=require('../sync/feed-bootstrap-membership.cjs'),membership=new FeedBootstrapMembership({db:f.db,store:f.store}),e=f.plan.sourceEvidence;await membership.begin({version:1,baselineId:'fresh-test-baseline',scope:'staging',capture:{sequence:e.deltaStartN,capturedAt:e.deltaStartCapturedAt,responseSha256:e.checkpointResponseSha256},snapshot:{generationId:f.plan.generationId,sha256:f.manifest.sha256,records:f.manifest.records,requestStartedAt:e.snapshotRequestedAt,observedAt:f.plan.observedAt,generatedAtKnown:e.generatedAtKnown,generatedAt:e.generatedAt}});return{membership,adapter:await createBootstrapMembershipCheckpoint({membership,baselineId:'fresh-test-baseline',plan:f.plan})};}
async function seedNewer(f,records=f.rows){const {importSnapshotBatch,hash}=require('../sync/feed-snapshot-import.cjs');await importSnapshotBatch({...f,provider,freshnessPolicy,receipt:{fileSha256:'e'.repeat(64),generationId:8000,observedAt:new Date(NOW).toISOString(),observationTimeBasis:'capture',batchSize:60,totalRecords:records.length,offset:0,records,batchSha256:hash(records)}});}
test('real membership commits atomically with canonical pages and verifies replay without activation',async t=>{
 const f=await setup(t),{membership,adapter}=await membershipAdapter(f);const first=await run(f,{prepareCheckpointStatements:adapter,maxBatches:1});assert.equal(first.membership.offset,20);assert.equal(count(f,'feed_catalog_membership'),20);const result=await run(f,{prepareCheckpointStatements:adapter});assert.equal(result.replayedBatches,1);assert.equal(result.membership.resolved,43);assert.equal(result.membership.unresolved,0);assert.equal(result.canonicalComplete,true);assert.equal((await membership.read('fresh-test-baseline')).state.status,'replaying');assert.equal((await membership.pointer()).baseline_id,null);const revision=(await membership.read('fresh-test-baseline')).revision;await run(f,{prepareCheckpointStatements:adapter});assert.equal((await membership.read('fresh-test-baseline')).revision,revision);
});
test('safe newer skipped records enter membership without overwriting canonical prices or dates',async t=>{
 const f=await setup(t),newer=f.rows.slice(0,20).map(row=>({...row,pricing:{...row.pricing,current_bid_usd:888}}));await seedNewer(f,newer);const {adapter}=await membershipAdapter(f),result=await run(f,{prepareCheckpointStatements:adapter});assert.equal(result.state.skipped,20);assert.equal(result.membership.resolved,43);assert.equal(result.membership.unresolved,0);assert.equal(f.sqlite.prepare('SELECT current_bid_usd bid,summary_synced_at at FROM auction_listings WHERE lot=?').get('10000000').bid,888);assert.equal(f.sqlite.prepare('SELECT summary_synced_at at FROM auction_listings WHERE lot=?').get('10000000').at,new Date(NOW).toISOString());
});
test('skipped canonical row changing after resolution rolls back both snapshot and membership checkpoints',async t=>{
 const f=await setup(t,20);await seedNewer(f);const {membership,adapter}=await membershipAdapter(f);const raced=async context=>{const statements=await adapter(context);f.beforeBatch(()=>f.sqlite.prepare('UPDATE auction_listings SET updated_at=? WHERE lot=?').run('2026-10-27T12:04:59.000Z','10000000'));return statements;};await assert.rejects(run(f,{prepareCheckpointStatements:raced}),/INVENTORY_COMMIT_STALE_BASELINE|INVENTORY_COMMIT_FAILED/);assert.equal((await membership.read('fresh-test-baseline')).state.offset,0);assert.equal(count(f,'feed_catalog_membership'),0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key=?').get('file-snapshot:'+f.manifest.sha256).n,0);
});
test('newer closed skipped canonical identity stays unresolved and prevents a handoff candidate',async t=>{
 const f=await setup(t,1);await seedNewer(f);f.sqlite.prepare("UPDATE auction_listings SET auction_state='ended'").run();const {adapter}=await membershipAdapter(f),result=await run(f,{prepareCheckpointStatements:adapter});assert.equal(result.state.skipped,1);assert.equal(result.state.rejected,0);assert.equal(result.membership.unresolved,1);assert.equal(result.canonicalComplete,false);assert.equal(result.handoffCandidate,null);assert.equal(count(f,'feed_catalog_membership'),0);
});


function boundSource(f){return {...f.plan.sourceEvidence,deltaStartCapturedAt:null,deltaStartCapturedNoLaterThan:f.plan.sourceEvidence.snapshotRequestedAt,deltaStartTimeBasis:'provider-before-start-bound',checkpointKind:'provider-checkpoint',checkpointReplayStartSequence:f.plan.sourceEvidence.deltaStartN,checkpointSnapshotSha256:f.manifest.sha256,generatedAtKnown:true,generatedAt:AT};}
test('provider bound source imports with canonical membership while preserving null exact capture',async t=>{
 const f=await setup(t),e=boundSource(f);f.plan=createBootstrapPlan({...f.plan,sourceEvidence:e,now:NOW});assert.equal(f.plan.sourceEvidence.deltaStartCapturedAt,null);
 f.sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0014_feed_catalog_membership.sql'),'utf8'));const {FeedBootstrapMembership}=require('../sync/feed-bootstrap-membership.cjs'),membership=new FeedBootstrapMembership({db:f.db,store:f.store});await membership.begin({version:1,baselineId:'bounded-source',scope:'staging',capture:{sequence:e.deltaStartN,capturedAt:null,capturedNoLaterThan:e.deltaStartCapturedNoLaterThan,timeBasis:e.deltaStartTimeBasis,responseSha256:e.checkpointResponseSha256},snapshot:{generationId:f.plan.generationId,sha256:f.manifest.sha256,records:f.manifest.records,requestStartedAt:e.snapshotRequestedAt,observedAt:f.plan.observedAt,generatedAtKnown:true,generatedAt:AT},sourceEvidence:{kind:'provider-checkpoint',sha256:e.evidenceSha256,replayStartSequence:e.deltaStartN,snapshotSha256:f.manifest.sha256}});const adapter=await createBootstrapMembershipCheckpoint({membership,baselineId:'bounded-source',plan:f.plan});const result=await run(f,{prepareCheckpointStatements:adapter});assert.equal(result.complete,true);assert.equal(result.membership.resolved,43);assert.equal((await membership.read('bounded-source')).plan.capture.capturedAt,null);
});
test('bound coordinator source rejects unknown ordering, mixed clocks and mismatched checkpoint pins',async t=>{
 const f=await setup(t),e=boundSource(f);for(const change of [{deltaStartCapturedAt:AT},{deltaStartCapturedNoLaterThan:'2026-10-27T11:59:00.000Z'},{deltaStartTimeBasis:'guess'},{checkpointKind:'fresh-generation'},{checkpointReplayStartSequence:1},{checkpointSnapshotSha256:'f'.repeat(64)},{generatedAtKnown:false,generatedAt:null}])assert.throws(()=>createBootstrapPlan({...f.plan,sourceEvidence:{...e,...change},now:NOW}),/SOURCE_EVIDENCE_INVALID/);assert.equal(count(f,'auction_listings'),0);
});

async function legacyNullVinPage(t){
 const rows=Array.from({length:60},(_,i)=>raw(i));rows[59]={...rows[59],platform:'iaai',lot_number:'44317677',vin:'NO VIN'};
 const f=await setup(t,rows);f.plan=createBootstrapPlan({...f.plan,batchSize:60,now:NOW});
 const {importSnapshotBatch,hash}=require('../sync/feed-snapshot-import.cjs'),old='2026-10-26T12:00:00.000Z';
 const legacy={...rows[59],vin:'1HGCM82633A004352',updated_at:old,pricing:{...rows[59].pricing,current_bid_usd:333}};
 await importSnapshotBatch({...f,provider,freshnessPolicy,receipt:{fileSha256:'e'.repeat(64),generationId:8000,observedAt:old,observationTimeBasis:'capture',batchSize:60,totalRecords:1,offset:0,records:[legacy],batchSha256:hash([legacy])}});
 f.sqlite.prepare("UPDATE auction_listings SET vin_normalized=NULL WHERE platform='iaai' AND lot='44317677'").run();
 return {...f,...await membershipAdapter(f)};
}
const exclusionTask=f=>f.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get('bootstrap-membership-exclusions:'+f.manifest.sha256+':0');
test('legacy NULL VIN canonical update remains saved while exact59+1 membership exclusion is atomic and replayable',async t=>{
 const f=await legacyNullVinPage(t),result=await run(f,{prepareCheckpointStatements:f.adapter});
 assert.equal(result.state.offset,60);assert.equal(result.state.inserted,59);assert.equal(result.state.updated,1);assert.equal(result.state.rejected,0);
 assert.equal(result.membership.resolved,59);assert.equal(result.membership.unresolved,1);assert.equal(count(f,'auction_listings'),60);assert.equal(count(f,'feed_catalog_membership'),59);
 const legacy=f.sqlite.prepare("SELECT vin_normalized,current_bid_usd,identity_state FROM auction_listings WHERE platform='iaai' AND lot='44317677'").get();assert.equal(legacy.vin_normalized,null);assert.equal(legacy.current_bid_usd,59);assert.equal(legacy.identity_state,'resolved');
 const task=exclusionTask(f),audit=JSON.parse(task.cursor),{sha256,...body}=audit;assert.equal(sha256,require('../sync/feed-snapshot-import.cjs').hash(body));
 assert.equal(audit.snapshotSha256,f.manifest.sha256);assert.equal(audit.bootstrapPlanSha256,f.plan.sha256);assert.equal(audit.batchSha256,result.state.fileSha256&&JSON.parse(f.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get('file-batch:'+f.manifest.sha256+':0').cursor).batchSha256);
 assert.equal(audit.resolvedRecords,59);assert.equal(audit.unresolvedRecords,1);assert.equal(audit.exclusions.length,1);assert.equal(audit.exclusions[0].platform,'iaai');assert.equal(audit.exclusions[0].lot,'44317677');assert.ok(audit.exclusions[0].reasons.includes('strict_vin_unresolved'));
 const beforeSnapshots=count(f,'auction_listing_snapshots'),cursor=task.cursor,replayed=await run(f,{prepareCheckpointStatements:f.adapter});assert.equal(replayed.replayedBatches,1);assert.equal(count(f,'auction_listing_snapshots'),beforeSnapshots);assert.equal(exclusionTask(f).cursor,cursor);assert.equal((await f.membership.read('fresh-test-baseline')).state.unresolved,1);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('membership exclusion audit failure rolls back canonical updates, memberships and both checkpoints',async t=>{
 const f=await legacyNullVinPage(t);f.setFault(s=>s.sql.startsWith('INSERT INTO automatic_refresh_tasks')&&s.params[0]?.startsWith('bootstrap-membership-exclusions:'));
 await assert.rejects(run(f,{prepareCheckpointStatements:f.adapter}),/INVENTORY_COMMIT_FAILED/);assert.equal(count(f,'auction_listings'),1);assert.equal(count(f,'feed_catalog_membership'),0);assert.equal((await f.membership.read('fresh-test-baseline')).state.offset,0);assert.equal(exclusionTask(f),undefined);assert.equal(f.sqlite.prepare("SELECT current_bid_usd bid FROM auction_listings WHERE lot='44317677'").get().bid,333);
 f.setFault(null);await run(f,{prepareCheckpointStatements:f.adapter});assert.equal(count(f,'feed_catalog_membership'),59);
});
test('exclusion audit is immutable and tampered readback blocks verified replay',async t=>{
 const f=await legacyNullVinPage(t);await run(f,{prepareCheckpointStatements:f.adapter});const task=exclusionTask(f),bad={...JSON.parse(task.cursor),exclusions:[]};f.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(bad),task.task_key);
 await assert.rejects(run(f,{prepareCheckpointStatements:f.adapter}),/MEMBERSHIP_EXCLUSION_READBACK_FAILED/);assert.equal((await f.membership.read('fresh-test-baseline')).state.offset,60);assert.equal(count(f,'feed_catalog_membership'),59);
});

test('explicit audit cutover replays legacy pre-transition page but never accepts a deleted new-page audit',async t=>{
 const f=await setup(t),{membership,adapter}=await membershipAdapter(f);await run(f,{prepareCheckpointStatements:adapter,maxBatches:1});
 // Isolated fixture simulates the exact old committed-page state before rollout.
 f.sqlite.prepare("DELETE FROM automatic_refresh_tasks WHERE task_key LIKE 'bootstrap-membership-exclusions:%' OR task_key LIKE 'bootstrap-membership-exclusions-transition:%'").run();
 const updated=await createBootstrapMembershipCheckpoint({membership,baselineId:'fresh-test-baseline',plan:f.plan,exclusionAuditCutoverOffset:20}),result=await run(f,{prepareCheckpointStatements:updated,maxBatches:1});assert.equal(result.replayedBatches,1);assert.equal(result.membership.offset,40);
 const marker=f.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get('bootstrap-membership-exclusions-transition:'+f.manifest.sha256);assert.equal(JSON.parse(marker.cursor).cutoverOffset,20);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key=?').get('bootstrap-membership-exclusions:'+f.manifest.sha256+':0').n,0);
 f.sqlite.prepare('DELETE FROM automatic_refresh_tasks WHERE task_key=?').run('bootstrap-membership-exclusions:'+f.manifest.sha256+':20');
 const fresh=await createBootstrapMembershipCheckpoint({membership,baselineId:'fresh-test-baseline',plan:f.plan,exclusionAuditCutoverOffset:20});await assert.rejects(run(f,{prepareCheckpointStatements:fresh}),/MEMBERSHIP_EXCLUSION_READBACK_FAILED/);assert.equal((await membership.read('fresh-test-baseline')).state.offset,40);assert.equal(count(f,'auction_listings'),40);
 f.sqlite.prepare('DELETE FROM automatic_refresh_tasks WHERE task_key=?').run('bootstrap-membership-exclusions-transition:'+f.manifest.sha256);await assert.rejects(createBootstrapMembershipCheckpoint({membership,baselineId:'fresh-test-baseline',plan:f.plan,exclusionAuditCutoverOffset:20}),/EXCLUSION_TRANSITION_REQUIRED/);
});
test('transition receipt failure rolls back its first page and remains absent',async t=>{
 const f=await legacyNullVinPage(t);f.setFault(s=>s.sql.startsWith('INSERT INTO automatic_refresh_tasks')&&s.params[0]?.startsWith('bootstrap-membership-exclusions-transition:'));await assert.rejects(run(f,{prepareCheckpointStatements:f.adapter}),/INVENTORY_COMMIT_FAILED/);assert.equal((await f.membership.read('fresh-test-baseline')).state.offset,0);assert.equal(count(f,'feed_catalog_membership'),0);assert.equal(exclusionTask(f),undefined);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key LIKE 'bootstrap-membership-exclusions-transition:%'").get().n,0);
});
