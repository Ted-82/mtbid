'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {FeedBootstrapMembership,canonicalPlan}=require('../sync/feed-bootstrap-membership.cjs');
const {captureChronologyCutoff}=require('../sync/feed-bootstrap-capture-time.cjs');
const AT='2026-11-01T12:00:00.000Z',NOW=Date.parse('2026-11-01T12:05:00.000Z');
function plan(extra={}){return {version:1,baselineId:'fresh-1',scope:'staging',sourceEvidence:{kind:'provider-checkpoint',sha256:'d'.repeat(64),replayStartSequence:100,snapshotSha256:'b'.repeat(64)},capture:{sequence:100,capturedAt:'2026-11-01T11:59:00.000Z',responseSha256:'a'.repeat(64)},snapshot:{generationId:7001,sha256:'b'.repeat(64),records:2,requestStartedAt:'2026-11-01T11:59:01.000Z',observedAt:AT,generatedAtKnown:false,generatedAt:null},...extra};}
function boundedPlan(){const p=plan();p.capture={sequence:100,capturedAt:null,capturedNoLaterThan:p.snapshot.requestStartedAt,timeBasis:'provider-before-start-bound',responseSha256:'a'.repeat(64)};Object.assign(p.snapshot,{generatedAtKnown:true,generatedAt:AT});return p;}
async function harness(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0014_feed_catalog_membership.sql'])sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8').replace(/^\uFEFF/,''));
 const calls={fault:null,before:null,after:null,sql:[]};
 const db={prepare(sql){calls.sql.push(sql);return {bind(...params){return {sql,params,
  async first(){return sqlite.prepare(sql).get(...params)||null;},async all(){return {results:sqlite.prepare(sql).all(...params)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}};}};},async batch(statements){
   if(calls.before){const cb=calls.before;calls.before=null;cb();}sqlite.exec('BEGIN IMMEDIATE');let result;
   try{result=statements.map(s=>{if(calls.fault?.(s))throw Error('INJECTED');return {meta:{changes:Number(sqlite.prepare(s.sql).run(...s.params).changes)}};});sqlite.exec('COMMIT');}
   catch(e){sqlite.exec('ROLLBACK');throw e;}if(calls.after){const cb=calls.after;calls.after=null;cb();}return result;
  }};
 const store=new RefreshStore(db,'membership-test',()=>NOW);assert.equal(await store.acquire(),true);
 const membership=new FeedBootstrapMembership({db,store});return {sqlite,db,store,membership,calls};
}
function row(n){return {listingId:'listing-'+n,sourceKey:'source-'+n,platform:n%2?'iaai':'copart',lot:String(100+n),vin:'1HGCM82633A004352'};}
function add(h,n){const r=row(n);h.sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,identity_state,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,'apibara',?,'resolved',?,?,?,?)`).run(r.sourceKey,r.platform,AT,AT,AT,AT);
 h.sqlite.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,identity_state,lot,vin_normalized,auction_state,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,'resolved',?,?,'open',?,?,?,?)`).run(r.listingId,r.sourceKey,r.platform,r.lot,r.vin,AT,AT,AT,AT);return r;}
const members=h=>h.sqlite.prepare('SELECT listing_id,active,last_sequence FROM feed_catalog_membership ORDER BY listing_id').all().map(r=>({...r}));
async function snapshot(h,options={}){const batch=await h.membership.snapshotStatements({baselineId:'fresh-1',offset:0,endOffset:2,batchSha256:'c'.repeat(64),resolved:[row(1),row(2)],...options});assert.equal(batch.statements.length,4);await h.store.guarded(batch.statements);return batch;}
async function ready(h){await h.membership.begin(plan());add(h,1);add(h,2);await snapshot(h);await h.store.guarded((await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:100,batchSha256:'f'.repeat(64)})).statements);await h.membership.seal({sourceProofSha256:'d'.repeat(64),baselineId:'fresh-1',through:100});}
function clean(h){assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM sync_batch_guards').get().n,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM automatic_refresh_guards').get().n,0);}

test('ordered immutable source capture is mandatory; begin resumes without resetting membership/checkpoints',async t=>{
 const h=await harness(t);for(const p of [plan({scope:'other'}),plan({capture:{...plan().capture,capturedAt:AT}}),plan({snapshot:{...plan().snapshot,records:0}})])assert.throws(()=>canonicalPlan(p),/PLAN_INVALID/);
 await h.membership.begin(plan());add(h,1);await snapshot(h,{endOffset:1,resolved:[row(1)]});const before=await h.membership.read('fresh-1');
 assert.deepEqual(await h.membership.begin(plan()),before);await assert.rejects(h.membership.begin(plan({snapshot:{...plan().snapshot,sha256:'d'.repeat(64)}})));
 assert.equal(members(h).length,1);clean(h);
});
test('canonical writes, membership, and checkpoint roll back together on any transaction failure',async t=>{
 const h=await harness(t);await h.membership.begin(plan());add(h,1);add(h,2);const batch=await h.membership.snapshotStatements({baselineId:'fresh-1',offset:0,endOffset:2,batchSha256:'c'.repeat(64),resolved:[row(1),row(2)]});
 h.calls.fault=s=>s.sql.startsWith('UPDATE feed_catalog_baselines');await assert.rejects(h.store.guarded([h.db.prepare("UPDATE auction_listings SET vehicle_title='changed' WHERE listing_id='listing-1'").bind(),...batch.statements]));
 assert.equal(h.sqlite.prepare("SELECT vehicle_title FROM auction_listings WHERE listing_id='listing-1'").get().vehicle_title,null);assert.deepEqual(members(h),[]);assert.equal((await h.membership.read('fresh-1')).state.offset,0);
 h.calls.fault=null;await h.store.guarded(batch.statements);assert.equal(members(h).length,2);await assert.rejects(h.store.guarded(batch.statements));assert.equal((await h.membership.read('fresh-1')).state.offset,2);clean(h);
});
test('missing, ambiguous, mismatched and raced skipped canonical identities cannot become members',async t=>{
 for(const kind of ['missing','ambiguous','vin','source','race']){const h=await harness(t);await h.membership.begin(plan());add(h,1);add(h,2);
  let rows=[row(1),row(2)];if(kind==='missing')h.sqlite.prepare("DELETE FROM auction_listings WHERE listing_id='listing-2'").run();
  if(kind==='ambiguous')h.sqlite.prepare("UPDATE auction_listings SET identity_state='ambiguous' WHERE listing_id='listing-2'").run();
  if(kind==='vin')rows[1].vin='1HGCM82633A004353';if(kind==='source')rows[1].sourceKey='source-1';
  if(kind==='race'){rows[1].expected={updatedAt:AT,sourceUpdatedAt:null,summarySyncedAt:null,detailSyncedAt:null,auctionState:'open'};}
  const b=await h.membership.snapshotStatements({baselineId:'fresh-1',offset:0,endOffset:2,batchSha256:'c'.repeat(64),resolved:rows});
  if(kind==='race')h.sqlite.prepare("UPDATE auction_listings SET auction_state='closed' WHERE listing_id='listing-2'").run();
  await assert.rejects(h.store.guarded(b.statements));assert.deepEqual(members(h),[]);clean(h);
 }
});
test('snapshot duplicates across pages reject instead of inflating verified membership coverage',async t=>{
 const h=await harness(t);await h.membership.begin(plan());add(h,1);await snapshot(h,{endOffset:1,resolved:[row(1)]});
 const b=await h.membership.snapshotStatements({baselineId:'fresh-1',offset:1,endOffset:2,batchSha256:'d'.repeat(64),resolved:[row(1)]});await assert.rejects(h.store.guarded(b.statements));assert.equal((await h.membership.read('fresh-1')).state.offset,1);clean(h);
});
test('zero unresolved default; excluded/rejected source rows require exact explicit reviewed proof',async t=>{
 const h=await harness(t);await h.membership.begin(plan());add(h,1);await snapshot(h,{resolved:[row(1)],excludedCount:1});await h.store.guarded((await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:100,batchSha256:'f'.repeat(64)})).statements);
 await assert.rejects(h.membership.seal({sourceProofSha256:'d'.repeat(64),baselineId:'fresh-1',through:100}),/NOT_READY/);await assert.rejects(h.membership.seal({sourceProofSha256:'d'.repeat(64),baselineId:'fresh-1',through:100,reviewedUnresolved:1}),/NOT_READY/);
 await h.membership.seal({sourceProofSha256:'d'.repeat(64),baselineId:'fresh-1',through:100,reviewedUnresolved:1,reviewSha256:'d'.repeat(64)});assert.equal((await h.membership.read('fresh-1')).state.status,'ready');clean(h);
});
test('delta cursor gaps are valid; creates/updates enter and terminal/exits leave in same commit',async t=>{
 const h=await harness(t);await ready(h);add(h,3);
 const b=await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:900,batchSha256:'e'.repeat(64),changes:[{...row(1),sequence:150,active:false},{...row(3),sequence:899,active:true}]});await h.store.guarded(b.statements);
 assert.deepEqual(members(h),[{listing_id:'listing-1',active:0,last_sequence:150},{listing_id:'listing-2',active:1,last_sequence:100},{listing_id:'listing-3',active:1,last_sequence:899}]);
 assert.equal((await h.membership.read('fresh-1')).state.replaySequence,900);await assert.rejects(h.store.guarded(b.statements));
 await assert.rejects(h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:901,batchSha256:'e'.repeat(64)}),/DELTA_CHECKPOINT/);clean(h);
});
test('partial unknown eligibility never revives absent members and blocks first activation until reviewed',async t=>{
 const h=await harness(t);await ready(h);const b=await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:102,batchSha256:'e'.repeat(64),unresolvedCount:1});await h.store.guarded(b.statements);
 assert.equal(members(h).length,2);await assert.rejects(h.membership.switchPointer({baselineId:'fresh-1',expectedBaselineId:null,expectedRevision:0}),/NOT_READY/);clean(h);
});
test('first activation hides absent old members only in selected view; NULL rollback preserves all canonical/history/saved refs',async t=>{
 const h=await harness(t);await ready(h);add(h,9);h.sqlite.exec("CREATE TABLE saved_refs(listing_id TEXT REFERENCES auction_listings(listing_id)); INSERT INTO saved_refs VALUES('listing-9')");
 assert.equal((await h.membership.pointer()).baseline_id,null);
 await h.membership.switchPointer({baselineId:'fresh-1',expectedBaselineId:null,expectedRevision:0});
 const visible=h.sqlite.prepare(`SELECT l.listing_id FROM auction_listings l WHERE EXISTS(SELECT 1 FROM feed_catalog_pointer p WHERE p.singleton=1 AND (p.baseline_id IS NULL OR EXISTS(SELECT 1 FROM feed_catalog_membership m WHERE m.baseline_id=p.baseline_id AND m.listing_id=l.listing_id AND m.active=1))) ORDER BY l.listing_id`);
 assert.deepEqual(visible.all().map(r=>r.listing_id),['listing-1','listing-2']);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,3);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM saved_refs').get().n,1);
 await h.membership.switchPointer({baselineId:null,expectedBaselineId:'fresh-1',expectedRevision:1});assert.equal(visible.all().length,3);assert.equal(members(h).length,2);clean(h);
});
test('pointer revision, target checkpoint and optional global cursor updates are one atomic CAS',async t=>{
 const h=await harness(t);await ready(h);h.sqlite.exec('CREATE TABLE test_cursor(n INTEGER); INSERT INTO test_cursor VALUES(100)');
 h.calls.fault=s=>s.sql==='UPDATE test_cursor SET n=900';await assert.rejects(h.membership.switchPointer({baselineId:'fresh-1',expectedBaselineId:null,expectedRevision:0,checkpointStatements:[h.db.prepare('UPDATE test_cursor SET n=900').bind()]}));assert.equal((await h.membership.pointer()).baseline_id,null);
 h.calls.fault=null;h.calls.before=()=>h.sqlite.prepare('UPDATE feed_catalog_baselines SET revision=revision+1').run();await assert.rejects(h.membership.switchPointer({baselineId:'fresh-1',expectedBaselineId:null,expectedRevision:0}));assert.equal((await h.membership.pointer()).baseline_id,null);
 await h.membership.switchPointer({baselineId:'fresh-1',expectedBaselineId:null,expectedRevision:0});await assert.rejects(h.membership.switchPointer({baselineId:null,expectedBaselineId:'fresh-1',expectedRevision:0}));clean(h);
});
test('expired shared lease cannot change membership/checkpoint/pointer; no provider or budget calls exist',async t=>{
 const h=await harness(t);await ready(h);h.sqlite.prepare("UPDATE automatic_refresh_state SET lease_owner='other'").run();
 await assert.rejects(h.membership.switchPointer({baselineId:'fresh-1',expectedBaselineId:null,expectedRevision:0}));assert.equal((await h.membership.pointer()).baseline_id,null);assert.equal(h.calls.sql.some(s=>/UPDATE .*budgets|INSERT INTO .*budgets/.test(s)),false);clean(h);
});
test('bounded public catalogue membership plan uses primary-key searches, with no canonical deletion',async t=>{
 const h=await harness(t);await ready(h);const query=`SELECT l.listing_id FROM auction_listings l WHERE EXISTS(SELECT 1 FROM feed_catalog_membership m WHERE m.baseline_id=? AND m.listing_id=l.listing_id AND m.active=1)`;
 const explain=h.sqlite.prepare('EXPLAIN QUERY PLAN '+query).all('fresh-1');assert.ok(explain.some(r=>/SEARCH m (?:EXISTS )?USING (?:COVERING INDEX|PRIMARY KEY)/.test(r.detail)),JSON.stringify(explain));assert.equal(h.calls.sql.some(s=>/DELETE FROM (auction_listings|vehicle_sources|auction_events)/.test(s)),false);clean(h);
});

test('source ordering cannot be inferred from download time, generation ID, or vehicle update upper bound',async t=>{
 for(const evidence of [{kind:'unknown',sha256:null},{kind:'fresh-generation',sha256:'d'.repeat(64)},{kind:'provider-checkpoint',sha256:'d'.repeat(64),replayStartSequence:99,snapshotSha256:'b'.repeat(64)}]){
  const h=await harness(t);await h.membership.begin(plan({sourceEvidence:evidence}));add(h,1);add(h,2);await snapshot(h);
  await h.store.guarded((await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:100,batchSha256:'f'.repeat(64)})).statements);
  await assert.rejects(h.membership.seal({sourceProofSha256:'d'.repeat(64),baselineId:'fresh-1',through:100}),/SOURCE_ORDER_UNPROVEN/);assert.equal((await h.membership.pointer()).baseline_id,null);clean(h);
 }
 const h=await harness(t);await h.membership.begin(plan({sourceEvidence:{kind:'fresh-generation',sha256:'d'.repeat(64)},snapshot:{...plan().snapshot,generatedAtKnown:true,generatedAt:'2026-11-01T11:59:30.000Z',observedAt:'2026-10-27T00:00:00.000Z'}}));add(h,1);add(h,2);await snapshot(h);
 await assert.rejects(h.membership.seal({sourceProofSha256:'d'.repeat(64),baselineId:'fresh-1',through:100}),/NOT_READY/);
 await h.store.guarded((await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:100,batchSha256:'f'.repeat(64)})).statements);await h.membership.seal({sourceProofSha256:'d'.repeat(64),baselineId:'fresh-1',through:100});clean(h);
});

test('explicit source review SHA is required separately from a valid pinned descriptor',async t=>{
 const h=await harness(t);await ready(h);
 await assert.rejects(h.membership.seal({baselineId:'fresh-1',through:100}),/SOURCE_ORDER_UNPROVEN/);
 await assert.rejects(h.membership.seal({baselineId:'fresh-1',through:100,sourceProofSha256:'e'.repeat(64)}),/SOURCE_ORDER_UNPROVEN/);
 assert.throws(()=>canonicalPlan(plan({sourceEvidence:{kind:'generation-order-proof',sha256:'d'.repeat(64),acknowledged:true}})),/PLAN_INVALID/);clean(h);
});
test('uncertain committed response is resolved from durable membership/pointer state, without resetting counters',async t=>{
 const h=await harness(t);await h.membership.begin(plan());add(h,1);add(h,2);
 const b=await h.membership.snapshotStatements({baselineId:'fresh-1',offset:0,endOffset:2,batchSha256:'c'.repeat(64),resolved:[row(1),row(2)]});h.calls.after=()=>{throw Error('RESPONSE_LOST');};
 await assert.rejects(h.store.guarded(b.statements));assert.equal((await h.membership.read('fresh-1')).state.offset,2);assert.equal(members(h).length,2);
 await assert.rejects(h.store.guarded(b.statements));assert.equal(members(h).length,2);
 await h.store.guarded((await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:100,batchSha256:'f'.repeat(64)})).statements);
 await h.membership.seal({baselineId:'fresh-1',through:100,sourceProofSha256:'d'.repeat(64)});h.calls.after=()=>{throw Error('RESPONSE_LOST');};
 await assert.rejects(h.membership.switchPointer({baselineId:'fresh-1',expectedBaselineId:null,expectedRevision:0}));assert.equal((await h.membership.pointer()).baseline_id,'fresh-1');assert.equal((await h.membership.pointer()).revision,1);clean(h);
});

test('unordered file fragments hold cursor and prevent seal until one verified empty final checkpoint',async t=>{
 const h=await harness(t);await ready(h);add(h,3);
 const first=await h.membership.deltaFragmentStatements({baselineId:'fresh-1',after:100,through:900,batchSha256:'a'.repeat(64),changes:[{...row(3),sequence:899,active:true}]});assert.equal(first.statements.length,4);await h.store.guarded(first.statements);
 let current=await h.membership.read('fresh-1');assert.equal(current.state.replaySequence,100);assert.equal(current.state.replayVerified,false);assert.equal(current.state.lastBatch.kind,'delta-fragment');assert.deepEqual(current.state.pendingDelta,{after:100,through:900,resumeReady:true});
 await assert.rejects(h.membership.seal({baselineId:'fresh-1',through:100,sourceProofSha256:'d'.repeat(64)}),/NOT_READY/);
 const second=await h.membership.deltaFragmentStatements({baselineId:'fresh-1',after:100,through:900,batchSha256:'b'.repeat(64),changes:[{...row(1),sequence:150,active:false}]});await h.store.guarded(second.statements);
 assert.equal((await h.membership.read('fresh-1')).state.replaySequence,100);assert.equal(members(h).find(r=>r.listing_id==='listing-1').active,0);
 await assert.rejects(h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:901,batchSha256:'c'.repeat(64)}),/DELTA_CHECKPOINT/);
 await assert.rejects(h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:900,batchSha256:'c'.repeat(64),changes:[{...row(2),sequence:800,active:false}]}),/DELTA_CHECKPOINT/);
 await h.store.guarded((await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:900,batchSha256:'c'.repeat(64)})).statements);
 current=await h.membership.read('fresh-1');assert.equal(current.state.replaySequence,900);assert.equal(current.state.pendingDelta,null);assert.equal(current.state.replayVerified,true);assert.equal(current.state.status,'ready');clean(h);
});
test('fragment membership is monotonic per identity and preserves unresolved accounting until final proof',async t=>{
 const h=await harness(t);await ready(h);
 const newer=await h.membership.deltaFragmentStatements({baselineId:'fresh-1',after:100,through:900,batchSha256:'a'.repeat(64),changes:[{...row(1),sequence:800,active:false}],unresolvedCount:1});await h.store.guarded(newer.statements);
 const older=await h.membership.deltaFragmentStatements({baselineId:'fresh-1',after:100,through:900,batchSha256:'b'.repeat(64),changes:[{...row(1),sequence:200,active:true}],unresolvedCount:2});await h.store.guarded(older.statements);
 assert.deepEqual(members(h).find(r=>r.listing_id==='listing-1'),{listing_id:'listing-1',active:0,last_sequence:800});assert.equal((await h.membership.read('fresh-1')).state.deltaUnresolved,3);
 await assert.rejects(h.store.guarded(newer.statements));assert.equal((await h.membership.read('fresh-1')).state.deltaUnresolved,3);
 await h.store.guarded((await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:900,batchSha256:'c'.repeat(64)})).statements);
 const current=await h.membership.read('fresh-1');assert.equal(current.state.status,'replaying');assert.equal(current.state.deltaUnresolved,3);
 await assert.rejects(h.membership.seal({baselineId:'fresh-1',through:900,sourceProofSha256:'d'.repeat(64)}),/NOT_READY/);clean(h);
});
test('fragment failure rolls back canonical writes and rejects mixed file bounds',async t=>{
 const h=await harness(t);await ready(h);
 const b=await h.membership.deltaFragmentStatements({baselineId:'fresh-1',after:100,through:900,batchSha256:'a'.repeat(64),changes:[{...row(1),sequence:150,active:false}]});
 h.calls.fault=s=>s.sql.startsWith('UPDATE feed_catalog_baselines');await assert.rejects(h.store.guarded([h.db.prepare("UPDATE auction_listings SET vehicle_title='changed' WHERE listing_id='listing-1'").bind(),...b.statements]));
 assert.equal((await h.membership.read('fresh-1')).state.pendingDelta,null);assert.equal(members(h)[0].active,1);assert.equal(h.sqlite.prepare("SELECT vehicle_title FROM auction_listings WHERE listing_id='listing-1'").get().vehicle_title,null);
 h.calls.fault=null;await h.store.guarded(b.statements);
 await assert.rejects(h.membership.deltaFragmentStatements({baselineId:'fresh-1',after:100,through:950,batchSha256:'b'.repeat(64)}),/DELTA_CHECKPOINT/);
 await assert.rejects(h.membership.deltaFragmentStatements({baselineId:'fresh-1',after:150,through:900,batchSha256:'b'.repeat(64)}),/DELTA_CHECKPOINT/);clean(h);
});


test('provider pre-start bound is explicit, hash-bound and never represented as exact capture time',async t=>{
 const exact=plan();assert.deepEqual(canonicalPlan(exact).capture,exact.capture);
 const p=canonicalPlan(boundedPlan());assert.equal(p.capture.capturedAt,null);assert.equal(p.capture.capturedNoLaterThan,p.snapshot.requestStartedAt);assert.equal(captureChronologyCutoff(p),p.snapshot.requestStartedAt);assert.notEqual(JSON.stringify(p),JSON.stringify(exact));
 const h=await harness(t);await h.membership.begin(p);add(h,1);add(h,2);await snapshot(h);await h.store.guarded((await h.membership.deltaStatements({baselineId:'fresh-1',after:100,through:101,batchSha256:'e'.repeat(64)})).statements);await h.membership.seal({baselineId:'fresh-1',through:101,sourceProofSha256:p.sourceEvidence.sha256});await h.membership.switchPointer({baselineId:'fresh-1',expectedBaselineId:null,expectedRevision:0});assert.equal((await h.membership.pointer()).baseline_id,'fresh-1');clean(h);
});

test('bound capture refuses mixed exact values, unknown start, unrelated source proof and changed N or snapshot',()=>{
 for(const mode of ['exact','tag','bound','unknownReady','beforeStart','kind','N','SHA','missingProof']){const p=boundedPlan();if(mode==='exact')p.capture.capturedAt=p.snapshot.requestStartedAt;if(mode==='tag')delete p.capture.timeBasis;if(mode==='bound')p.capture.capturedNoLaterThan='2026-11-01T11:59:00.000Z';if(mode==='unknownReady'){p.snapshot.generatedAtKnown=false;p.snapshot.generatedAt=null;}if(mode==='beforeStart')p.snapshot.generatedAt='2026-11-01T11:59:00.000Z';if(mode==='kind')p.sourceEvidence={kind:'fresh-generation',sha256:'d'.repeat(64)};if(mode==='N')p.sourceEvidence.replayStartSequence=99;if(mode==='SHA')p.sourceEvidence.snapshotSha256='f'.repeat(64);if(mode==='missingProof')delete p.sourceEvidence;assert.throws(()=>canonicalPlan(p),/PLAN_INVALID/);}
});


test('snapshot duplicate guard probes each bounded page identity by the full membership key',async t=>{
 const h=await harness(t);await h.membership.begin(plan({snapshot:{...plan().snapshot,records:900}}));
 for(let n=1;n<=900;n++)add(h,n);
 for(let offset=0;offset<840;offset+=60){
  const batch=await h.membership.snapshotStatements({baselineId:'fresh-1',offset,endOffset:offset+60,batchSha256:'c'.repeat(64),resolved:Array.from({length:60},(_,i)=>row(offset+i+1))});
  await h.store.guarded(batch.statements);
 }
 const valid=await h.membership.snapshotStatements({baselineId:'fresh-1',offset:840,endOffset:900,batchSha256:'e'.repeat(64),resolved:Array.from({length:60},(_,i)=>row(841+i))});
 const guard=valid.statements[0],explain=h.sqlite.prepare('EXPLAIN QUERY PLAN '+guard.sql).all(...guard.params);
 const membershipReads=explain.filter(r=>/\bm\b/.test(r.detail));
 assert.ok(membershipReads.some(r=>/SEARCH m USING PRIMARY KEY \(baseline_id=\? AND listing_id=\?\)/.test(r.detail)),JSON.stringify(explain));
 assert.equal(membershipReads.some(r=>/SEARCH m USING PRIMARY KEY \(baseline_id=\?\)/.test(r.detail)),false,JSON.stringify(explain));
 const duplicate=await h.membership.snapshotStatements({baselineId:'fresh-1',offset:840,endOffset:900,batchSha256:'f'.repeat(64),resolved:[row(840),...Array.from({length:59},(_,i)=>row(841+i))]});
 await assert.rejects(h.store.guarded(duplicate.statements),error=>/CHECK constraint/.test(error.cause?.message));
 assert.equal((await h.membership.read('fresh-1')).state.offset,840);
 await h.store.guarded(valid.statements);
 assert.equal((await h.membership.read('fresh-1')).state.offset,900);assert.equal(members(h).length,900);
 await assert.rejects(h.store.guarded(valid.statements),error=>/CHECK constraint/.test(error.cause?.message));
 assert.equal((await h.membership.read('fresh-1')).state.offset,900);clean(h);
});
