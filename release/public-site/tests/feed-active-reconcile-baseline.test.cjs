'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), {DatabaseSync} = require('node:sqlite');
const {createApibaraProvider} = require('../providers/apibara.js');
const {RefreshStore, saveAutomaticObservation, POLICY} = require('../sync/automatic-refresh.cjs');
const {D1SyncRepository} = require('../sync/d1-repository.js');
const {prepareInventoryPage} = require('../sync/inventory-page.cjs');
const {commitInventoryBatch} = require('../sync/inventory-commit.cjs');
const {recordFeedEligibility, processActiveFeedReconciliation, FRESH_MS} = require('../sync/feed-active-reconcile.cjs');
const NOW = Date.parse('2026-10-29T12:00:00.000Z'), AT = new Date(NOW).toISOString();
const OLD = '2026-10-28T12:00:00.000Z', CAPTURE = '2026-10-29T11:55:00.000Z', EVENT = '2026-10-29T11:50:00.000Z';
const VIN = '1HGCM82633A004352', OTHER_VIN = 'SALZP2FX8PH185647', LOT = '10000001';
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/apibara-discovery-page-shape.json'), 'utf8')).response.data[0];
const adapter = createApibaraProvider({fetch: async () => {throw Error('NETWORK_FORBIDDEN');}});
function raw(lot = LOT, extra = {}) {
  const record = structuredClone(fixture); Object.assign(record, {platform: 'copart', lot_number: lot, vehicle_id: `copart-${lot}`, vin: VIN, updated_at: EVENT});
  record.auction.state = 'open'; record.pricing.current_bid_usd = 999; return {...record, ...extra};
}
function event(sequence = 101, lot = LOT, extra = {}) {
  return {sequence, event_id: `event-${sequence}`, event: 'lot.created', terminal: false,
    vehicle: {platform: 'copart', lot_number: lot, vin: VIN}, changed_fields: [], before: {}, after: {},
    recorded_at: EVENT, vehicle_updated_at: EVENT, ...extra};
}
const group = (events = [event()], quarantinedSequences = []) => ({platform: events[0].vehicle.platform, lot: events[0].vehicle.lot_number, events, quarantinedSequences});
async function harness(t, records = []) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql','0012_server_feed_reconcile.sql']) {
    sqlite.exec(fs.readFileSync(path.join(__dirname, '../docs/proposals', file), 'utf8'));
  }
  const calls = {clock: NOW, reads: 0, batches: [], requests: [], beforeBatch: null, afterCommit: null};
  const db = {prepare(sql) {return {bind(...params) {return {sql, params,
    async first() {calls.reads++; return sqlite.prepare(sql).get(...params) || null;},
    async all() {calls.reads++; return {results: sqlite.prepare(sql).all(...params)};},
    async run() {return {meta: {changes: Number(sqlite.prepare(sql).run(...params).changes)}};}
  };}};}, async batch(statements) {
    assert.ok(statements.length <= 250); calls.batches.push(statements); await calls.beforeBatch?.(statements);
    sqlite.exec('BEGIN IMMEDIATE'); let result;
    try {result = statements.map(s => ({meta: {changes: Number(sqlite.prepare(s.sql).run(...s.params).changes)}})); sqlite.exec('COMMIT');}
    catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    await calls.afterCommit?.(statements); return result;
  }};
  const store = new RefreshStore(db, 'active-feed-test', () => calls.clock), repo = new D1SyncRepository(db);
  await store.acquire(); await store.initializeBudgets({daily: 500, monthly: 12000, newPerDay: 2000});
  if (records.length) {
    const prepared = await prepareInventoryPage({db, provider: adapter, records, observedAt: OLD, processedAt: AT, freshnessPolicy: POLICY});
    assert.deepEqual(prepared.rejected, []); await commitInventoryBatch({db, store, prepared: prepared.prepared});
  }
  sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('stream:changes','all','77',?,'complete')").run(OLD);
  const report = {inserted: 0, updated: 0, skipped: 0};
  const saveRecord = (...args) => saveAutomaticObservation({db, store, repo, adapter, report, now: () => calls.clock}, ...args);
  const env = {db, sqlite, store, repo, calls, report, saveRecord, adapter,
    request: async (spec, listingId) => {calls.requests.push({spec, listingId}); if (env.error) throw env.error;
      return {response: {ok: true, data: env.detail || raw(spec.identifier.replace(/^copart-/, ''))}, observedAt: AT};}};
  generation(env); calls.batches = []; calls.reads = 0; return env;
}
function generation(env, id = 1, first = 101, last = 1000, observedAt = CAPTURE) {
  env.sqlite.prepare(`INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,observed_at,status,
    first_sequence,last_sequence,bucket_index,group_offset,created_at,updated_at) VALUES(?,?,?,1,?,'applying',?,?,0,0,?,?)`)
    .run(id, String(id).padStart(64, '0'), `generation-${id}`, observedAt, first, last, observedAt, observedAt);
  env.sqlite.prepare(`INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,active_generation,updated_at)
    VALUES(1,?,'{}',?,?) ON CONFLICT(singleton) DO UPDATE SET active_generation=excluded.active_generation`)
    .run(first - 1, id, observedAt);
}
function finish(env, id = 1) {
  env.sqlite.prepare("UPDATE server_feed_generations SET status='complete',bucket_index=128,group_offset=0 WHERE generation_id=?").run(id);
  env.sqlite.prepare('UPDATE server_feed_state SET active_generation=NULL,committed_sequence=(SELECT last_sequence FROM server_feed_generations WHERE generation_id=?)').run(id);
}
function enqueue(env, lot = LOT, extra = {}) {
  const values = {task_key: `reconcile:copart:${lot}`, platform: 'copart', listing_id: null, cursor: lot,
    next_due_at: OLD, last_attempt_at: OLD, status: 'pending', ...extra};
  env.sqlite.prepare(`INSERT INTO automatic_refresh_tasks(${Object.keys(values)}) VALUES(${Object.keys(values).map(() => '?')})`).run(...Object.values(values));
}
const record = (env, groups = [group()], extra = {}) => recordFeedEligibility({...env, groups, generationId: 1, observedAt: CAPTURE, ...extra});
const run = (env, extra = {}) => processActiveFeedReconciliation({...env, ...extra});
const eligibility = (env, lot = LOT) => env.sqlite.prepare('SELECT * FROM server_feed_reconcile_eligibility WHERE platform=? AND lot=?').get('copart', lot);
const task = (env, lot = LOT) => env.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(`reconcile:copart:${lot}`);
const listing = (env, lot = LOT) => env.sqlite.prepare('SELECT * FROM auction_listings WHERE platform=? AND lot=?').get('copart', lot);
function clean(env) {
  assert.deepEqual(env.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  for (const table of ['sync_batch_guards','automatic_refresh_guards']) assert.equal(env.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  assert.equal(env.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='stream:changes'").get().cursor, '77');
}


const {canonicalPlan}=require('../sync/feed-bootstrap-membership.cjs');
const {createHash}=require('node:crypto');
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');

async function activeBaseline(env){
 env.sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0014_feed_catalog_membership.sql'),'utf8'));
 env.db.metadataVerified=true;env.db.identity={id:'c8a30088-70af-43a6-9a7f-c4018279d37d',name:'rexbid-production-preflight-db'};
 const baselineId='fresh-detail-test',activatedAt='2026-10-29T11:30:00.000Z',snapshotSha='b'.repeat(64);
 const plan=canonicalPlan({version:1,baselineId,scope:'production',capture:{sequence:100,capturedAt:'2026-10-29T10:00:00.000Z',responseSha256:'a'.repeat(64)},snapshot:{generationId:8731,sha256:snapshotSha,records:1,requestStartedAt:'2026-10-29T10:01:00.000Z',observedAt:activatedAt,generatedAtKnown:false,generatedAt:null},sourceEvidence:{kind:'provider-checkpoint',sha256:'d'.repeat(64),replayStartSequence:100,snapshotSha256:snapshotSha}});
 const checkpoint={version:1,status:'ready',offset:1,resolved:0,excluded:1,unresolved:0,replaySequence:1000,replayVerified:true,deltaUnresolved:0,reviewedUnresolved:1,reviewSha256:'e'.repeat(64),lastBatch:null};
 env.sqlite.prepare('INSERT INTO feed_catalog_baselines VALUES(?,?,?,?,1,?,?)').run(baselineId,hash(plan),JSON.stringify(plan),JSON.stringify(checkpoint),activatedAt,activatedAt);
 env.sqlite.prepare('UPDATE feed_catalog_pointer SET baseline_id=?,revision=1').run(baselineId);
 env.sqlite.prepare("INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,observed_at,status,first_sequence,last_sequence,manifest_key,manifest_sha256,bucket_index,group_offset,created_at,updated_at) VALUES(8888,?,'raw/boundary',1,?,'prepared',101,900,'manifest/boundary',?,0,0,?,?)").run('8'.repeat(64),activatedAt,'9'.repeat(64),activatedAt,activatedAt);
 const boundary=env.sqlite.prepare('SELECT * FROM server_feed_generations WHERE generation_id=8888').get();
 const receipt={version:1,kind:'feed-bootstrap-activation',baselineId,planSha256:hash(plan),sourceProofSha256:plan.sourceEvidence.sha256,sourceEvidenceSha256:hash(plan.sourceEvidence),sourceSequence:100,floorSequence:900,boundary:{generationId:8888,rawSha256:boundary.sha256,rawKey:boundary.raw_key,manifestKey:boundary.manifest_key,manifestSha256:boundary.manifest_sha256,firstSequence:101,lastSequence:900,compressedBytes:1,observedAt:activatedAt},replay:{proofSha256:'f'.repeat(64)},prior:{baselineId:null,pointerRevision:0,serverSequence:77},target:env.db.identity,activatedAt};
 env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,cursor,next_due_at) VALUES(?,'all','complete',?,?)").run('bootstrap-activation:'+baselineId,JSON.stringify({...receipt,sha256:hash(receipt)}),activatedAt);
 env.baselineId=baselineId;return env;
}
async function eligibleBaseline(t){const env=await harness(t);env.sqlite.prepare('UPDATE server_feed_generations SET first_sequence=901 WHERE generation_id=1').run();env.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=900').run();await record(env,[group([event(901)])]);enqueue(env);finish(env);await activeBaseline(env);env.detail=raw();return env;}
function oldGeneration(env,changes={}){
 const row={generation_id:2,sha256:'2'.repeat(64),raw_key:'old-private-source',compressed_bytes:1,observed_at:OLD,status:'blocked',first_sequence:1,last_sequence:99,created_at:OLD,updated_at:OLD,...changes};
 env.sqlite.prepare('INSERT INTO server_feed_generations('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
}

test('verified active baseline admits recent unknown VIN context despite covered prepared boundary and old blocked ranges',async t=>{
 const env=await eligibleBaseline(t);oldGeneration(env);const stateBefore={...env.sqlite.prepare('SELECT * FROM server_feed_state').get()},oldBefore={...env.sqlite.prepare('SELECT * FROM server_feed_generations WHERE generation_id=2').get()};
 assert.equal((await run(env)).completed,1);assert.equal(env.calls.requests.length,1);assert.equal(env.calls.requests[0].spec.identifier,VIN);assert.equal(env.calls.requests[0].spec.platform,'copart');assert.equal(listing(env).vin_normalized,VIN);assert.equal(task(env).status,'complete');
 assert.deepEqual({...env.sqlite.prepare('SELECT * FROM server_feed_state').get()},stateBefore);assert.deepEqual({...env.sqlite.prepare('SELECT * FROM server_feed_generations WHERE generation_id=2').get()},oldBefore);clean(env);
});
test('legacy NULL pointer retains strict old-generation gate rather than assuming a bootstrap floor',async t=>{
 const env=await eligibleBaseline(t);env.sqlite.prepare('UPDATE feed_catalog_pointer SET baseline_id=NULL').run();assert.equal((await run(env)).reason,'feed_not_current');assert.equal(env.calls.requests.length,0);assert.equal(listing(env),undefined);
});
test('unknown, malformed, newer, applying or pending-bootstrap work never receives covered-range exemption',async t=>{
 for(const mode of ['unknown','inverted','noninteger','newer','active','bootstrap-pending']){const env=await eligibleBaseline(t);oldGeneration(env);
  if(mode==='unknown')env.sqlite.prepare('UPDATE server_feed_generations SET first_sequence=NULL,last_sequence=NULL WHERE generation_id=2').run();
  if(mode==='inverted')env.sqlite.prepare('UPDATE server_feed_generations SET first_sequence=200,last_sequence=199 WHERE generation_id=2').run();
  if(mode==='noninteger')env.sqlite.prepare('UPDATE server_feed_generations SET first_sequence=1.5 WHERE generation_id=2').run();
  if(mode==='newer')env.sqlite.prepare('UPDATE server_feed_generations SET last_sequence=901 WHERE generation_id=2').run();
  if(mode==='active')env.sqlite.prepare('UPDATE server_feed_state SET active_generation=2').run();
  if(mode==='bootstrap-pending')env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,cursor,next_due_at) VALUES('bootstrap-archive-replay:next:1','all','pending','{}',?)").run(AT);
  assert.equal((await run(env)).reason,'feed_not_current',mode);assert.equal(env.calls.requests.length,0);assert.equal(listing(env),undefined);clean(env);
 }
});
test('missing or changed activation proof fails closed before any supplier request',async t=>{
 for(const mode of ['missing','tampered']){const env=await eligibleBaseline(t);if(mode==='missing')env.sqlite.prepare('DELETE FROM automatic_refresh_tasks WHERE task_key=?').run('bootstrap-activation:'+env.baselineId);else env.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}','bootstrap-activation:'+env.baselineId);await assert.rejects(run(env),/BASELINE_UNVERIFIED|RECEIPT_INVALID/);assert.equal(env.calls.requests.length,0);assert.equal(listing(env),undefined);}
});
test('pointer revision, proof, member cursor or uncovered-range race rejects the work guard before transport',async t=>{
 for(const mode of ['pointer','proof','member-cursor','uncovered']){const env=await eligibleBaseline(t);oldGeneration(env);let fired=false;env.calls.beforeBatch=()=>{if(fired)return;fired=true;if(mode==='pointer')env.sqlite.exec('UPDATE feed_catalog_pointer SET revision=revision+1');if(mode==='proof')env.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run('{}','bootstrap-activation:'+env.baselineId);if(mode==='member-cursor'){const row=env.sqlite.prepare('SELECT checkpoint_json FROM feed_catalog_baselines').get(),checkpoint=JSON.parse(row.checkpoint_json);checkpoint.replaySequence=999;env.sqlite.prepare('UPDATE feed_catalog_baselines SET checkpoint_json=?').run(JSON.stringify(checkpoint));}if(mode==='uncovered')env.sqlite.prepare('UPDATE server_feed_generations SET last_sequence=901 WHERE generation_id=2').run();};await assert.rejects(run(env),/AUTOMATIC_REFRESH_WRITE_FAILED/);assert.equal(env.calls.requests.length,0);assert.equal(listing(env),undefined);assert.equal(task(env).status,'pending');clean(env);}
});
test('baseline replacement after a verified-VIN response rolls back full writer, admission and completion',async t=>{
 const env=await eligibleBaseline(t),before=env.sqlite.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?").get('new:'+AT.slice(0,10)).consumed;
 env.request=async spec=>{env.calls.requests.push({spec});env.sqlite.exec('UPDATE feed_catalog_pointer SET baseline_id=NULL,revision=revision+1');return{response:{ok:true,data:raw()},observedAt:AT};};
 await assert.rejects(run(env),/AUTOMATIC_REFRESH_WRITE_FAILED/);assert.equal(env.calls.requests.length,1);assert.equal(listing(env),undefined);assert.equal(task(env).status,'pending');assert.equal(env.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get('new:'+AT.slice(0,10)).consumed,before);clean(env);
});
test('verified-VIN lookup still rejects supplier platform, LOT and VIN mismatches without inserting context',async t=>{
 for(const mode of ['platform','lot','vin']){const env=await eligibleBaseline(t);env.detail=raw();if(mode==='platform')env.detail.platform='iaai';if(mode==='lot')env.detail.lot_number='99999999';if(mode==='vin')env.detail.vin=OTHER_VIN;const result=await run(env);assert.equal(result.identityErrors,1);assert.equal(env.calls.requests[0].spec.identifier,VIN);assert.equal(listing(env),undefined);assert.equal(task(env).status,'identity_error');clean(env);}
});

const {CatalogMembershipRead}=require('../sync/catalog-membership-read.cjs');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const baselineRow=env=>env.sqlite.prepare('SELECT * FROM feed_catalog_baselines WHERE baseline_id=?').get(env.baselineId);
const member=env=>env.sqlite.prepare('SELECT * FROM feed_catalog_membership WHERE baseline_id=?').get(env.baselineId);
const confirmations=env=>env.sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key>='server-detail-confirmation:' AND task_key<'server-detail-confirmation;' ORDER BY task_key").all();
async function publicCars(env){const membership=new CatalogMembershipRead(env.db,{scope:'production'}),reader=new D1ReadRepository(env.db,{membership,now:()=>env.calls.clock});return{result:await reader.listCatalog(),membership};}
async function seedKnown(env,{updatedAt=OLD,observedAt=OLD}={}){const prepared=await prepareInventoryPage({db:env.db,provider:adapter,records:[raw(LOT,{updated_at:updatedAt})],observedAt,processedAt:AT,freshnessPolicy:POLICY});assert.equal(prepared.prepared.length,1);await commitInventoryBatch({db:env.db,store:env.store,prepared:prepared.prepared});return listing(env);}

test('real full writer, task, confirmation and active public membership commit together without changing market clocks/cursors',async t=>{
 const env=await eligibleBaseline(t),before={...baselineRow(env)},global={...env.sqlite.prepare('SELECT * FROM server_feed_state').get()};
 assert.equal((await publicCars(env)).result.records.length,0);assert.equal((await run(env)).completed,1);const cars=await publicCars(env);assert.equal(cars.result.records.length,1);assert.equal(cars.result.records[0].vehicle.lot,LOT);assert.equal(cars.result.records[0].catalog_scope,'active');
 assert.equal(member(env).active,1);assert.equal(member(env).last_sequence,1000);assert.equal(await cars.membership.listingScope(listing(env).listing_id,listing(env).auction_state),'active');
 const after=baselineRow(env);assert.equal(after.updated_at,before.updated_at);assert.equal(after.checkpoint_json,before.checkpoint_json);assert.equal(after.revision,before.revision+1);assert.deepEqual({...env.sqlite.prepare('SELECT * FROM server_feed_state').get()},global);
 const proof=JSON.parse(confirmations(env)[0].cursor);assert.equal(proof.kind,'guarded-supplier-detail-confirmation');assert.equal(proof.task.eventSequence,901);assert.equal(proof.feed.committedSequence,1000);assert.equal(proof.observedAt,AT);assert.equal(proof.sourceUpdatedAt,EVENT);assert.equal(proof.active,true);assert.equal(proof.baselineUpdatedAtPreserved,before.updated_at);assert.match(proof.supplierResponseFingerprint,/^[a-f0-9]{64}$/);
 const frozen=JSON.stringify(after);assert.equal((await run(env)).attempted,0);assert.equal(env.calls.requests.length,1);assert.equal(confirmations(env).length,1);assert.equal(JSON.stringify(baselineRow(env)),frozen);clean(env);
});
test('explicit ended supplier context creates only inactive membership and stays out of active public results',async t=>{
 const env=await eligibleBaseline(t);env.detail.auction.state='finished';const before={...baselineRow(env)};assert.equal((await run(env)).completed,1);assert.equal(member(env).active,0);assert.equal(member(env).last_sequence,1000);assert.equal((await publicCars(env)).result.records.length,0);
 assert.equal(await (await publicCars(env)).membership.listingScope(listing(env).listing_id,listing(env).auction_state),'archival');assert.equal(JSON.parse(confirmations(env)[0].cursor).availability,'ended');assert.equal(baselineRow(env).updated_at,before.updated_at);assert.equal(baselineRow(env).checkpoint_json,before.checkpoint_json);clean(env);
});
test('new supplier context may flip eligibility at the same REAL completed cursor without inventing an event',async t=>{
 for(const active of [false,true]){const env=await eligibleBaseline(t),row=await seedKnown(env);env.sqlite.prepare('INSERT INTO feed_catalog_membership VALUES(?,?,?,1000)').run(env.baselineId,row.listing_id,active?0:1);if(!active)env.detail.auction.state='finished';
  const before={...baselineRow(env)};assert.equal((await run(env)).completed,1);assert.equal(member(env).active,Number(active));assert.equal(member(env).last_sequence,1000);assert.equal(env.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,1000);assert.equal(baselineRow(env).checkpoint_json,before.checkpoint_json);assert.equal((await publicCars(env)).result.records.length,Number(active));clean(env);
 }
});
test('unknown availability or invalid/stale API observation defers before canonical/member writes without spending admission allowance',async t=>{
 for(const mode of ['unknown','upcoming','stale','missing-time','bad-time']){const env=await eligibleBaseline(t),before={...baselineRow(env)},budget=env.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get('new:'+AT.slice(0,10)).consumed;
  if(mode==='unknown')env.detail.auction.state='unknown';if(mode==='upcoming')env.detail.auction.state='upcoming';if(mode==='stale'){env.detail.updated_at=OLD;env.request=async spec=>{env.calls.requests.push({spec});return{response:{ok:true,data:env.detail},observedAt:'2026-10-29T11:49:59.000Z'};};}if(mode==='missing-time')delete env.detail.updated_at;if(mode==='bad-time')env.detail.updated_at='invalid';
  const result=await run(env);assert.equal(result.deferred,1,mode);assert.equal(listing(env),undefined);assert.equal(member(env),undefined);assert.equal(confirmations(env).length,0);assert.deepEqual({...baselineRow(env)},before);assert.equal(env.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get('new:'+AT.slice(0,10)).consumed,budget);assert.equal(task(env).status,'pending');clean(env);
 }
});
test('a stale detail version cannot roll back an already known car or its active membership',async t=>{
 const env=await eligibleBaseline(t),row=await seedKnown(env,{updatedAt:EVENT,observedAt:CAPTURE});env.sqlite.prepare('INSERT INTO feed_catalog_membership VALUES(?,?,1,900)').run(env.baselineId,row.listing_id);env.detail.updated_at=OLD;env.detail.pricing.current_bid_usd=1;
 const before={...listing(env)},baseline={...baselineRow(env)},membership={...member(env)};assert.equal((await run(env)).deferred,1);assert.deepEqual({...listing(env)},before);assert.deepEqual({...baselineRow(env)},baseline);assert.deepEqual({...member(env)},membership);assert.equal(confirmations(env).length,0);clean(env);
});
test('membership/base timestamp races reject the whole full-writer transaction without resetting unresolved counters',async t=>{
 for(const mode of ['timestamp','checkpoint','member']){const env=await eligibleBaseline(t);let original=null;if(mode==='member')original=await seedKnown(env);const before={...baselineRow(env)},rowBefore=listing(env)?JSON.stringify(listing(env)):null;let fired=false;
  env.calls.beforeBatch=statements=>{if(fired||!statements.some(s=>/^INSERT INTO auction_listings/.test(s.sql)))return;fired=true;
   if(mode==='timestamp')env.sqlite.prepare('UPDATE feed_catalog_baselines SET updated_at=?').run(AT);
   if(mode==='checkpoint'){const state=JSON.parse(baselineRow(env).checkpoint_json);state.deltaUnresolved++;state.status='replaying';env.sqlite.prepare('UPDATE feed_catalog_baselines SET checkpoint_json=?').run(JSON.stringify(state));}
   if(mode==='member')env.sqlite.prepare('INSERT INTO feed_catalog_membership VALUES(?,?,1,1000)').run(env.baselineId,original.listing_id);
  };
  await assert.rejects(run(env),/AUTOMATIC_REFRESH_WRITE_FAILED/);assert.equal(listing(env)?JSON.stringify(listing(env)):null,rowBefore);assert.equal(confirmations(env).length,0);assert.equal(task(env).status,'pending');assert.equal(env.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get('new:'+AT.slice(0,10)).consumed,0);
  if(mode==='checkpoint')assert.equal(JSON.parse(baselineRow(env).checkpoint_json).deltaUnresolved,JSON.parse(before.checkpoint_json).deltaUnresolved+1);clean(env);
 }
});
test('confirmation insert failure rolls canonical row, membership, snapshot, admission and completion back atomically',async t=>{
 const env=await eligibleBaseline(t),before={...baselineRow(env)};env.sqlite.exec("CREATE TRIGGER fail_confirmation BEFORE INSERT ON automatic_refresh_tasks WHEN NEW.task_key LIKE 'server-detail-confirmation:%' BEGIN SELECT RAISE(ABORT,'injected confirmation failure'); END");
 await assert.rejects(run(env),/AUTOMATIC_REFRESH_WRITE_FAILED/);assert.equal(listing(env),undefined);assert.equal(member(env),undefined);assert.equal(confirmations(env).length,0);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,0);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM vehicle_sources').get().n,0);assert.equal(task(env).status,'pending');assert.deepEqual({...baselineRow(env)},before);clean(env);
});
test('lost acknowledgement after atomic membership admission is recovered without another request or market timestamp change',async t=>{
 const env=await eligibleBaseline(t),before={...baselineRow(env)};env.calls.afterCommit=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO automatic_refresh_tasks')&&s.params.some(v=>typeof v==='string'&&v.startsWith('server-detail-confirmation:'))))throw Error('SIMULATED_LOST_RESPONSE');};
 await assert.rejects(run(env),/AUTOMATIC_REFRESH_WRITE_FAILED/);assert.equal(member(env).active,1);assert.equal(task(env).status,'complete');assert.equal(confirmations(env).length,1);assert.equal(baselineRow(env).updated_at,before.updated_at);assert.equal(baselineRow(env).checkpoint_json,before.checkpoint_json);env.calls.afterCommit=null;assert.equal((await run(env)).attempted,0);assert.equal(env.calls.requests.length,1);assert.equal(confirmations(env).length,1);clean(env);
});


test('actual supplier clock pattern: current API confirmation after a bid admits an older metadata version without relabelling its time',async t=>{
 const env=await harness(t),apiAt='2026-11-04T11:22:09.158Z',recordedAt='2026-11-04T09:55:28.000Z',observed='2026-11-04T09:55:54.265Z',sourceTime='2026-11-04T08:55:28.000000Z',actualLot='46811986',actualVin='JTHBE1BL0FA009256';
 env.calls.clock=Date.parse(apiAt);await env.store.acquire();await env.store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
 env.sqlite.prepare('UPDATE server_feed_generations SET first_sequence=901,observed_at=? WHERE generation_id=1').run(observed);env.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=900').run();
 const change=event(901,actualLot,{event:'bid.changed',vehicle:{platform:'copart',lot_number:actualLot,vin:actualVin},recorded_at:recordedAt,vehicle_updated_at:new Date(sourceTime).toISOString()});
 await recordFeedEligibility({db:env.db,store:env.store,groups:[group([change])],generationId:1,observedAt:observed});enqueue(env,actualLot);finish(env);await activeBaseline(env);
 const detail=raw(actualLot,{vin:actualVin,updated_at:sourceTime});env.request=async spec=>{env.calls.requests.push({spec});return{response:{ok:true,data:detail},observedAt:apiAt};};
 const before={...baselineRow(env)};assert.equal((await run(env)).completed,1);const cars=await publicCars(env);assert.equal(cars.result.records.length,1);assert.equal(cars.result.records[0].vehicle.lot,actualLot);assert.equal(cars.result.records[0].vehicle.source_updated_at,sourceTime);assert.equal(member(env).active,1);
 const receipt=JSON.parse(confirmations(env)[0].cursor);assert.equal(receipt.observedAt,apiAt);assert.equal(receipt.sourceUpdatedAt,'2026-11-04T08:55:28.000Z');assert.equal(receipt.task.eventSequence,901);assert.equal(baselineRow(env).updated_at,before.updated_at);assert.equal(baselineRow(env).checkpoint_json,before.checkpoint_json);clean(env);
});
