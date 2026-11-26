'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), {DatabaseSync} = require('node:sqlite');
const {createHash} = require('node:crypto');
const {RefreshStore} = require('../sync/automatic-refresh.cjs');
const {repairFeedGap, MAX_RESPONSE_BYTES} = require('../sync/feed-gap-repair.cjs');
const {FeedBootstrapMembership}=require('../sync/feed-bootstrap-membership.cjs');
const NOW = Date.parse('2026-10-29T12:00:00.000Z'), AT = new Date(NOW).toISOString();
const OLD = '2026-10-28T12:00:00.000Z', EVENT = '2026-10-29T11:00:00.000Z';
const VIN = '1HGCM82633A004352', LOT = '10000001';
const sha = value => createHash('sha256').update(value).digest('hex');
function event(sequence, lot = LOT, extra = {}) {
  return {sequence, event_id: `event-${sequence}`, event: 'bid.changed', terminal: false,
    vehicle: {platform: 'copart', lot_number: lot, vin: VIN}, changed_fields: ['pricing.current_bid_usd'],
    before: {}, after: {'pricing.current_bid_usd': sequence + 1000}, recorded_at: EVENT, vehicle_updated_at: EVENT, ...extra};
}
function page(events = [event(101)], changes = {}) {
  return {ok: true, data: events, meta: {after: 100, next_cursor: events.at(-1)?.sequence ?? 100,
    has_more: true, count: events.length, ordering: 'sequence_asc', schema_version: 'gap-test', retention_days: 14,
    oldest_available_sequence: 1, latest_available_sequence: 10000, ...changes}};
}
async function harness(t, response = page()) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0004_d1_sync_2.sql', '0008_automatic_refresh.sql', '0011_d1_server_feed.sql']) {
    sqlite.exec(fs.readFileSync(path.join(__dirname, '../docs/proposals', file), 'utf8'));
  }
  sqlite.prepare('INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,100,?,?)').run('{}', OLD);
  sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('stream:changes','all','77',?,'complete')").run(OLD);
  const calls = {batches: [], request: [], gets: [], puts: [], reads: 0, sql: 0, prepared: [], beforeBatch: null, afterCommit: null, clock: NOW};
  const db = {prepare(sql) {calls.prepared.push(sql); return {bind(...params) {return {sql, params,
    async first() {calls.reads++; calls.sql++; return sqlite.prepare(sql).get(...params) || null;},
    async all() {calls.reads++; calls.sql++; return {results: sqlite.prepare(sql).all(...params)};},
    async run() {calls.sql++; return {meta: {changes: Number(sqlite.prepare(sql).run(...params).changes)}};}
  };}};}, async batch(statements) {
    assert.ok(statements.length <= 250); calls.sql += statements.length; calls.batches.push(statements);
    await calls.beforeBatch?.(statements); sqlite.exec('BEGIN IMMEDIATE'); let results;
    try {results = statements.map(s => ({meta: {changes: Number(sqlite.prepare(s.sql).run(...s.params).changes)}})); sqlite.exec('COMMIT');}
    catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    await calls.afterCommit?.(statements); return results;
  }};
  const objects = new Map();
  const bucket = {async put(key, bytes, options) {
    calls.puts.push(key); assert.deepEqual(options.onlyIf, {etagDoesNotMatch: '*'});
    if (objects.has(key)) return null; objects.set(key, Buffer.from(bytes)); return {key};
  }, async get(key) {
    calls.gets.push(key); const bytes = objects.get(key); if (!bytes) return null;
    return {size: bytes.length, body: new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(bytes)); controller.close();}})};
  }};
  const store = new RefreshStore(db, 'gap-test', () => calls.clock); await store.acquire();
  const env = {sqlite, db, store, bucket, objects, calls, response,
    async request(spec) {calls.request.push(spec); if (env.error) throw env.error; return {response: env.response, observedAt: AT};}};
  return env;
}
function seed(env, lot = LOT, changes = {}, provider = 'apibara') {
  const source = {source_key: `source-${lot}`, provider, platform: 'copart', identity_state: 'resolved',
    first_seen_at: OLD, last_seen_at: OLD, created_at: OLD, updated_at: OLD};
  env.sqlite.prepare(`INSERT INTO vehicle_sources(${Object.keys(source)}) VALUES(${Object.keys(source).map(() => '?')})`).run(...Object.values(source));
  const row = {listing_id: `listing-${lot}`, source_key: source.source_key, platform: 'copart', lot, vin_normalized: VIN,
    identity_state: 'resolved', source_updated_at: OLD, summary_synced_at: OLD, detail_synced_at: OLD,
    first_seen_at: OLD, last_seen_at: OLD, created_at: OLD, updated_at: OLD, auction_state: 'open', source_status: 'Open',
    auction_at: null, is_timed: 0, timed_end_at: null, current_bid_usd: 100, current_bid2_usd: null, buy_now_usd: 15000, ...changes};
  env.sqlite.prepare(`INSERT INTO auction_listings(${Object.keys(row)}) VALUES(${Object.keys(row).map(() => '?')})`).run(...Object.values(row));
}
const run = (env, targetFirstSequence = 102, extra = {}) => repairFeedGap({...env, targetFirstSequence, ...extra});
const cursor = env => env.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence;
const task = (env, key = 'server-feed-gap:100') => env.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(key);
const bid = (env, lot = LOT) => env.sqlite.prepare('SELECT current_bid_usd FROM auction_listings WHERE lot=?').get(lot)?.current_bid_usd;
test('compact recovery commits 500 distinct changes from one request in the active epoch',async t=>{
 const lots=Array.from({length:500},(_,i)=>String(Number(LOT)+i));
 const env=await harness(t,page(lots.map((lot,i)=>event(101+i,lot))));
 const membership=await freshMembership(env);for(const lot of lots.slice(1))seed(env,lot);
 const result=await run(env,601,{baselineId:'fresh:gap',preferCompactPages:true});
 assert.deepEqual(env.calls.request,[{operation:'vehicleChanges',after:100,limit:500,includeRecord:false}]);
 assert.equal(result.complete,true);assert.equal(result.events,500);assert.equal(cursor(env),600);
 assert.equal((await membership.read('fresh:gap')).state.replaySequence,600);
 assert.equal(bid(env,lots.at(-1)),1600);clean(env);
});
test('compact recovery retries the same cursor with creation records and verifies its prefix',async t=>{
 const created=gapCreated(101),{record,...plain}=created;
 for(const mismatch of [false,true]){
  const env=await harness(t);env.request=async spec=>{
   env.calls.request.push(spec);
   return {observedAt:AT,response:spec.includeRecord===false?page([plain,event(102)]):page([{...created,...(mismatch?{event_id:'wrong'}:{})}])};
  };
  if(mismatch){await assert.rejects(run(env,103,{preferCompactPages:true}),/FEED_GAP_HYDRATION_PREFIX_MISMATCH/);assert.equal(cursor(env),100);assert.equal(env.objects.size,0);}
  else {const result=await run(env,103,{preferCompactPages:true});assert.equal(result.through,101);assert.equal(result.complete,false);assert.equal(cursor(env),101);assert.ok(env.sqlite.prepare('SELECT listing_id FROM auction_listings WHERE lot=?').get(LOT));}
  assert.deepEqual(env.calls.request,[{operation:'vehicleChanges',after:100,limit:500,includeRecord:false},{operation:'vehicleChanges',after:100,limit:500}]);
 }
});
function clean(env) {
  assert.deepEqual(env.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  for (const name of ['sync_batch_guards', 'automatic_refresh_guards']) assert.equal(env.sqlite.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n, 0);
  assert.equal(task(env, 'stream:changes').cursor, '77');
}

async function freshMembership(env,baselineId='fresh:gap'){
 env.sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0014_feed_catalog_membership.sql'),'utf8'));seed(env);
 const membership=new FeedBootstrapMembership({db:env.db,store:env.store});await membership.begin({version:1,baselineId,scope:'staging',
  sourceEvidence:{kind:'provider-checkpoint',sha256:'d'.repeat(64),replayStartSequence:100,snapshotSha256:'b'.repeat(64)},
  capture:{sequence:100,capturedAt:OLD,responseSha256:'a'.repeat(64)},snapshot:{generationId:7001,sha256:'b'.repeat(64),records:1,
   requestStartedAt:OLD,observedAt:OLD,generatedAtKnown:false,generatedAt:null}});
 await env.store.guarded((await membership.snapshotStatements({baselineId,offset:0,endOffset:1,batchSha256:'c'.repeat(64),resolved:[{
  listingId:`listing-${LOT}`,sourceKey:`source-${LOT}`,platform:'copart',lot:LOT,vin:VIN}]})).statements);return membership;
}
test('activated epoch isolates legacy pending page and advances membership with global cursor atomically',async t=>{
 const env=await harness(t),membership=await freshMembership(env),baselineId='fresh:gap';
 env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('server-feed-gap:100','all','{}',?,'pending')").run(OLD);
 const before={...task(env)};const result=await run(env,102,{baselineId});assert.equal(result.complete,true);
 assert.equal(cursor(env),101);assert.equal((await membership.read(baselineId)).state.replaySequence,101);assert.deepEqual({...task(env)},before);
 const epochKey=`server-feed-gap-epoch:${sha(baselineId)}:100`;assert.equal(task(env,epochKey).status,'complete');
 assert.equal(JSON.parse(task(env,epochKey).cursor).baselineId,baselineId);clean(env);
});
test('epoch final checkpoint rollback retains canonical fragment and resumes without another counted request',async t=>{
 const env=await harness(t),membership=await freshMembership(env),baselineId='fresh:gap';let fired=false;
 env.calls.beforeBatch=ss=>{if(!fired&&ss.some(s=>s.sql.startsWith('UPDATE server_feed_state SET committed_sequence'))){fired=true;throw Error('INJECTED');}};
 await assert.rejects(run(env,102,{baselineId}));assert.equal(cursor(env),100);assert.equal((await membership.read(baselineId)).state.replaySequence,100);
 assert.ok((await membership.read(baselineId)).state.pendingDelta);assert.equal(bid(env),1101);
 env.calls.beforeBatch=null;env.error=Error('NO_REFETCH');await run(env,102,{baselineId});assert.equal(env.calls.request.length,1);
 assert.equal(cursor(env),101);assert.equal((await membership.read(baselineId)).state.replaySequence,101);clean(env);
});

test('one page archives raw bytes before writes, commits complete groups, and advances only file cursor', async t => {
  const env = await harness(t); seed(env);
  env.calls.beforeBatch = () => {assert.equal(env.objects.size, 1);};
  const beforeSource = env.sqlite.prepare('SELECT * FROM vehicle_sources').all();
  const result = await run(env);
  assert.deepEqual(env.calls.request, [{operation: 'vehicleChanges', after: 100, limit: 500}]);
  assert.equal(result.through, 101); assert.equal(result.complete, true); assert.equal(result.events, 1);
  assert.equal(bid(env), 1101); assert.equal(cursor(env), 101); assert.equal(task(env).status, 'complete');
  assert.equal(result.responseSha256, sha(JSON.stringify(env.response)));
  assert.equal(JSON.parse([...env.objects.values()][0]).data[0].sequence, 101);
  assert.deepEqual(env.sqlite.prepare('SELECT * FROM vehicle_sources').all(), beforeSource);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n, 0);
  const batches = env.calls.batches.length; const retry = await run(env);
  assert.equal(retry.repaired, false); assert.equal(env.calls.request.length, 1); assert.equal(env.calls.batches.length, batches); clean(env);
});

test('bounded100/25 pages keep exact cursor, raw record hydration and original source time', async t => {
  for (const limit of [100, 25]) {
    const events = Array.from({length: limit}, (_, n) => gapCreated(101 + n, String(10000000 + n)));
    const env = await harness(t, page(events));
    let result;
    do {result = await run(env, 101 + limit, {maxChangesLimit: limit});} while (!result.complete);
    assert.deepEqual(env.calls.request, [{operation: 'vehicleChanges', after: 100, limit}]);
    assert.equal(cursor(env), 100 + limit); assert.equal(result.proof.requestLimit, limit);
    assert.equal(JSON.parse(task(env).cursor).requestLimit, limit);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, limit);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE summary_synced_at=?').get(EVENT).n, limit);
    assert.equal(JSON.parse([...env.objects.values()][0]).data.length, limit); clean(env);
  }
});

test('smaller-page hint never retries transport internally or treats HTTP500 as an empty page', async t => {
  const env = await harness(t); seed(env);
  for (const limit of [500, 100, 25]) {
    env.error = Object.assign(Error('UPSTREAM'), {code: 'UPSTREAM', status: 500});
    const previousCalls = env.calls.request.length;
    await assert.rejects(run(env, 102, {maxChangesLimit: limit}), error => error === env.error);
    assert.equal(env.calls.request.length, previousCalls + 1);
    assert.deepEqual(env.calls.request.at(-1), {operation: 'vehicleChanges', after: 100, limit});
    assert.equal(cursor(env), 100); assert.equal(task(env), undefined); assert.equal(env.objects.size, 0);
    assert.equal(env.calls.batches.length, 0); assert.equal(bid(env), 100);
  }
  env.error = null;
  const result = await run(env, 102, {maxChangesLimit: 25});
  assert.equal(result.through, 101); assert.equal(env.calls.request.length, 4); clean(env);
});

test('page size is a strict bounded enum and response count cannot exceed the requested smaller size', async t => {
  for (const limit of [null, false, 0, 1, 24, 26, 50, 99, 101, 499, 501, 2000, '100', NaN, Infinity]) {
    const env = await harness(t);
    await assert.rejects(run(env, 102, {maxChangesLimit: limit}), /FEED_GAP_CONFIG_INVALID/);
    assert.equal(env.calls.request.length, 0); assert.equal(env.calls.batches.length, 0); assert.equal(env.objects.size, 0);
  }
  for (const limit of [100, 25]) {
    const env = await harness(t, page(Array.from({length: limit + 1}, (_, n) => event(101 + n))));
    await assert.rejects(run(env, 1000, {maxChangesLimit: limit}), error => error.code === 'INVALID_RESPONSE');
    assert.equal(cursor(env), 100); assert.equal(task(env), undefined); assert.equal(env.objects.size, 0);
    assert.equal(env.calls.request.length, 1); clean(env);
  }
});

test('retained100 response resumes with its saved limit despite a later25 hint, without refetch', async t => {
  const events = Array.from({length: 100}, (_, n) => event(101 + n, String(10000000 + n)));
  const env = await harness(t, page(events)); for (const e of events) seed(env, e.vehicle.lot_number);
  env.calls.afterCommit = statements => {
    if (statements.some(s => s.sql.includes("VALUES(?,'all',?,?,?,'pending')"))) throw Error('ACK_LOST');
  };
  await assert.rejects(run(env, 201, {maxChangesLimit: 100}), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(JSON.parse(task(env).cursor).requestLimit, 100); assert.equal(cursor(env), 100);
  env.calls.afterCommit = null; env.error = Error('REFETCH_FORBIDDEN');
  const result = await run(env, 201, {maxChangesLimit: 25});
  assert.equal(result.resumed, true); assert.equal(result.through, 200); assert.equal(result.proof.requestLimit, 100);
  assert.equal(env.calls.request.length, 1); clean(env);
});

test('legacy pointer without requestLimit remains500 and retains its original hydration hash', async t => {
  const env = await harness(t, page([gapCreated()]));
  env.calls.afterCommit = statements => {
    if (statements.some(s => s.sql.includes("VALUES(?,'all',?,?,?,'pending')"))) throw Error('ACK_LOST');
  };
  await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  const pointer = JSON.parse(task(env).cursor); delete pointer.requestLimit;
  env.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(pointer), task(env).task_key);
  const expectedHash = sha(JSON.stringify({version: 1, kind: 'server-feed-gap-hydration', pointer}));
  env.calls.afterCommit = null; env.error = Error('REFETCH_FORBIDDEN');
  const result = await run(env, 102, {maxChangesLimit: 25});
  assert.equal(result.complete, true); assert.equal(result.proof.requestLimit, 500);
  assert.ok(task(env, `file-hydration:${expectedHash}:0:0`));
  assert.equal(Object.hasOwn(JSON.parse(task(env).cursor), 'requestLimit'), false);
  assert.equal(env.calls.request.length, 1); clean(env);
});

test('tampered retained requestLimit rejects unknown limits and an oversized archived page before mutations', async t => {
  for (const changedLimit of [null, '100', 50, 25]) {
    const env = await harness(t, page(Array.from({length: 26}, (_, n) => event(101 + n))));
    env.calls.afterCommit = statements => {
      if (statements.some(s => s.sql.includes("VALUES(?,'all',?,?,?,'pending')"))) throw Error('ACK_LOST');
    };
    await assert.rejects(run(env, 1000, {maxChangesLimit: 100}), /AUTOMATIC_REFRESH_WRITE_FAILED/);
    const pointer = {...JSON.parse(task(env).cursor), requestLimit: changedLimit};
    env.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(pointer), task(env).task_key);
    env.calls.afterCommit = null; env.error = Error('REFETCH_FORBIDDEN'); const before = env.calls.batches.length;
    await assert.rejects(run(env, 1000), error => changedLimit === 25 ? error.code === 'INVALID_RESPONSE' : /FEED_GAP_POINTER_INVALID/.test(error.message));
    assert.equal(cursor(env), 100); assert.equal(env.calls.request.length, 1); assert.equal(env.calls.batches.length, before);
    assert.equal(task(env).status, 'pending'); clean(env);
  }
});

test('400, 410 and 429 transport errors leave cursor and tasks unchanged', async t => {
  for (const [status, code] of [[400, 'INVALID_REQUEST'], [410, 'CURSOR_EXPIRED'], [429, 'RATE_LIMITED']]) {
    const env = await harness(t); env.error = Object.assign(Error(code), {status, code});
    await assert.rejects(run(env), error => error === env.error);
    assert.equal(cursor(env), 100); assert.equal(task(env), undefined); assert.equal(env.objects.size, 0); assert.equal(env.calls.batches.length, 0); clean(env);
  }
});

test('malformed/truncated metadata, wrong after, expired retention and target contradiction cannot advance', async t => {
  for (const meta of [{count: 2}, {after: 99}, {next_cursor: 100}, {ordering: 'descending'},
    {oldest_available_sequence: 102}, {has_more: false, latest_available_sequence: 101}, {has_more: false, latest_available_sequence: null}]) {
    const env = await harness(t, page([event(101)], meta));
    await assert.rejects(run(env)); assert.equal(cursor(env), 100); assert.equal(task(env), undefined); assert.equal(env.calls.batches.length, 0);
  }
});

test('cross-target page trims later events even for the same LOT and proves exact target boundary', async t => {
  const env = await harness(t, page([event(101), event(105), event(110)], {next_cursor: 110, has_more: false, latest_available_sequence: 110})); seed(env);
  const result = await run(env, 105);
  assert.equal(result.events, 1); assert.equal(result.proof.receivedEvents, 3); assert.equal(result.through, 104);
  assert.equal(bid(env), 1101); assert.equal(cursor(env), 104); assert.equal(result.proof.providerNextCursor, 110); clean(env);
});

test('numeric nonmaterial gaps and empty advancing pages use provider cursor, never event count', async t => {
  const env = await harness(t, page([event(103), event(107)], {next_cursor: 120})); seed(env);
  const first = await run(env, 200); assert.equal(first.through, 120); assert.equal(first.complete, false); assert.equal(bid(env), 1107);
  env.response = page([], {after: 120, next_cursor: 150});
  const second = await run(env, 200); assert.equal(second.through, 150); assert.equal(second.events, 0); assert.equal(second.batches, 0);
  assert.equal(task(env, 'server-feed-gap:120').status, 'complete');
  env.response = page([], {after: 150, next_cursor: 205, has_more: false, latest_available_sequence: 205});
  const third = await run(env, 200); assert.equal(third.through, 199); assert.equal(third.complete, true); clean(env);
});

test('empty nonadvancing page and exhausted API below target do not invent coverage', async t => {
  for (const meta of [{next_cursor: 100, has_more: false}, {next_cursor: 150, has_more: false, latest_available_sequence: 150}]) {
    const env = await harness(t, page([], meta)); await assert.rejects(run(env, 200));
    assert.equal(cursor(env), 100); assert.equal(task(env), undefined);
  }
});

test('crash after a committed partial batch resumes exact archived response without refetch or duplicate patches', async t => {
  const events = Array.from({length: 101}, (_, n) => event(101 + n, String(10000000 + n)));
  const env = await harness(t, page(events)); for (const e of events) seed(env, e.vehicle.lot_number);
  let crashed = false;
  env.calls.afterCommit = statements => {
    if (!crashed && statements.some(s => s.sql.startsWith('UPDATE auction_listings'))) {crashed = true; throw Error('TIMEOUT_AFTER_COMMIT');}
  };
  await assert.rejects(run(env, 202), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(cursor(env), 100); assert.equal(task(env).status, 'pending');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE current_bid_usd<>100').get().n, 100);
  env.sqlite.prepare('UPDATE auction_listings SET current_bid_usd=99999 WHERE lot=?').run(events[0].vehicle.lot_number);
  env.error = Error('REFETCH_FORBIDDEN'); env.calls.afterCommit = null;
  const result = await run(env, 202);
  assert.equal(result.resumed, true); assert.equal(result.batches, 2); assert.equal(env.calls.request.length, 1);
  assert.equal(cursor(env), 201); assert.equal(bid(env, events[0].vehicle.lot_number), 99999);
  assert.equal(bid(env, events[100].vehicle.lot_number), 1201); clean(env);
});

test('pending-pointer commit timeout also resumes without a second provider request', async t => {
  const env = await harness(t); seed(env); let crash = true;
  env.calls.afterCommit = statements => {
    if (crash && statements.some(s => s.sql.includes("VALUES(?,'all',?,?,?,'pending')"))) {crash = false; throw Error('TIMEOUT');}
  };
  await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/); assert.equal(task(env).status, 'pending'); assert.equal(bid(env), 100);
  env.calls.afterCommit = null; env.error = Error('REFETCH_FORBIDDEN'); await run(env); assert.equal(env.calls.request.length, 1); clean(env);
});

test('timeout after final commit is a read-only completed retry without a duplicate request or patch', async t => {
  const env = await harness(t); seed(env);
  env.calls.afterCommit = statements => {
    if (statements.some(s => s.sql.startsWith('UPDATE server_feed_state SET committed_sequence'))) throw Error('TIMEOUT_AFTER_FINAL_COMMIT');
  };
  await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(cursor(env), 101); assert.equal(task(env).status, 'complete');
  env.calls.afterCommit = null; env.error = Error('REFETCH_FORBIDDEN');
  env.sqlite.prepare('UPDATE auction_listings SET current_bid_usd=99999 WHERE lot=?').run(LOT);
  const batches = env.calls.batches.length, result = await run(env);
  assert.equal(result.complete, true); assert.equal(result.repaired, false); assert.equal(env.calls.request.length, 1);
  assert.equal(env.calls.batches.length, batches); assert.equal(bid(env), 99999); clean(env);
});

test('concurrent cursor or generation changes roll back the final checkpoint and preserve pending proof', async t => {
  for (const sql of ['UPDATE server_feed_state SET committed_sequence=105', 'UPDATE server_feed_state SET active_generation=44']) {
    const env = await harness(t); seed(env);
    env.calls.beforeBatch = statements => {if (statements.some(s => s.sql.startsWith('UPDATE server_feed_state SET committed_sequence'))) env.sqlite.exec(sql);};
    await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/);
    assert.equal(task(env).status, 'pending'); assert.equal(bid(env), 1101);
    env.calls.beforeBatch = null; env.error = Error('REFETCH_FORBIDDEN'); await assert.rejects(run(env));
    assert.equal(env.calls.request.length, 1); clean(env);
  }
});

test('cursor change before a partial batch prevents catalogue writes; stale lease prevents pending pointer', async t => {
  const env = await harness(t); seed(env);
  env.calls.beforeBatch = statements => {if (statements.some(s => s.sql.startsWith('UPDATE auction_listings'))) env.sqlite.exec('UPDATE server_feed_state SET committed_sequence=103');};
  await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/); assert.equal(bid(env), 100); assert.equal(task(env).status, 'pending'); clean(env);
  const stale = await harness(t); stale.calls.clock = NOW + 11 * 60000;
  await assert.rejects(run(stale), /AUTOMATIC_REFRESH_WRITE_FAILED/); assert.equal(cursor(stale), 100); assert.equal(task(stale), undefined); clean(stale);
});

test('concurrent newer listing state rolls back the whole affected import batch', async t => {
  const env = await harness(t); seed(env);
  env.calls.beforeBatch = statements => {
    if (statements.some(s => s.sql.startsWith('UPDATE auction_listings'))) {
      env.sqlite.prepare('UPDATE auction_listings SET current_bid_usd=99999,detail_synced_at=? WHERE lot=?').run(AT, LOT);
    }
  };
  await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(cursor(env), 100); assert.equal(bid(env), 99999); assert.equal(task(env).status, 'pending');
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").get().n, 0); clean(env);
});

test('final audit mutation races fail all final statements', async t => {
  const env = await harness(t); seed(env);
  env.calls.beforeBatch = statements => {
    if (statements.some(s => s.sql.startsWith('UPDATE server_feed_state SET committed_sequence'))) {
      env.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key LIKE 'server-feed-batch:%'");
    }
  };
  await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(cursor(env), 100); assert.equal(task(env).status, 'pending'); clean(env);
});

test('quarantined VIN, full-record identity conflict and unknown LOT remain durable tasks without fabricated listings', async t => {
  const events = [event(101, LOT, {vehicle: {platform: 'copart', lot_number: LOT, vin: ''}}),
    event(102, '10000002', {record: {platform: 'iaai', lot_number: '10000002', vin: VIN}}), event(103, '10000003')];
  const env = await harness(t, page(events)); seed(env); seed(env, '10000002');
  const result = await run(env, 104);
  assert.equal(result.proof.quarantined, 1); assert.equal(bid(env), 100); assert.equal(bid(env, '10000002'), 100);
  assert.equal(task(env, `reconcile:copart:${LOT}`).status, 'identity_error');
  assert.equal(task(env, 'reconcile:copart:10000002').status, 'identity_error');
  assert.equal(task(env, 'reconcile:copart:10000003').status, 'pending');
  assert.equal(bid(env, '10000003'), undefined); clean(env);
});

test('newer full observations and non-apibara sources remain protected', async t => {
  const env = await harness(t, page([event(101), event(102, '10000002')]));
  seed(env, LOT, {source_updated_at: AT, summary_synced_at: AT, detail_synced_at: AT}); seed(env, '10000002', {}, 'other');
  await run(env, 103); assert.equal(bid(env), 100); assert.equal(bid(env, '10000002'), 100);
  assert.equal(task(env, 'reconcile:copart:10000002').status, 'identity_error'); clean(env);
});

test('archive corruption and changed resume target block pending page without refetch', async t => {
  const env = await harness(t); seed(env);
  env.calls.beforeBatch = statements => {if (statements.some(s => s.sql.startsWith('UPDATE auction_listings'))) throw Error('STOP');};
  await assert.rejects(run(env)); assert.equal(task(env).status, 'pending'); env.calls.beforeBatch = null;
  await assert.rejects(run(env, 103), /FEED_GAP_POINTER_CONFLICT/);
  env.objects.set([...env.objects.keys()][0], Buffer.from('{}'));
  await assert.rejects(run(env), /FEED_GAP_ARCHIVE_HASH_MISMATCH/); assert.equal(env.calls.request.length, 1); assert.equal(bid(env), 100);
});

test('response size bound, active generation and page bound stop before any catalogue writes', async t => {
  const env = await harness(t); env.response.padding = 'x'.repeat(MAX_RESPONSE_BYTES);
  await assert.rejects(run(env), /FEED_GAP_RESPONSE_TOO_LARGE/); assert.equal(task(env), undefined);
  const active = await harness(t); active.sqlite.exec('UPDATE server_feed_state SET active_generation=5');
  await assert.rejects(run(active), /FEED_GAP_STATE_INVALID/); assert.equal(active.calls.request.length, 0);
  const bounded = await harness(t); await assert.rejects(run(bounded, 102, {maxPages: 2}), /FEED_GAP_CONFIG_INVALID/);
  assert.equal(bounded.calls.request.length, 0);
});

test('500 distinct complete groups stay within one Worker query allowance and five bounded import batches', async t => {
  const events = Array.from({length: 500}, (_, n) => event(n + 101, String(10000000 + n), {
    changed_fields: ['pricing.current_bid_usd', 'details.color'],
    after: {'pricing.current_bid_usd': n + 1101, 'details.color': 'Red'}
  }));
  const env = await harness(t, page(events)); for (const e of events) seed(env, e.vehicle.lot_number);
  const result = await run(env, 601);
  assert.equal(result.groups, 500); assert.equal(result.batches, 5); assert.equal(cursor(env), 600);
  const gapQueries = env.calls.prepared.filter(sql => sql.includes("task_key GLOB 'server-feed-gap:*'"));
  assert.equal(gapQueries.length, 8, 'one pending lookup and seven guards use bounded namespace searches per 500-group page');
  for (const sql of gapQueries) {
    const placeholders = [...sql.matchAll(/\?/g)].length;
    const plan = env.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...Array(placeholders).fill(null)).map(row => row.detail);
    assert.ok(plan.some(detail => /SEARCH automatic_refresh_tasks USING INDEX sqlite_autoindex_automatic_refresh_tasks_1 \(task_key>\? AND task_key<\?\)/.test(detail)), plan.join('\n'));
    assert.equal(plan.some(detail => /^SCAN automatic_refresh_tasks\b/.test(detail)), false, plan.join('\n'));
  }
  assert.ok(env.calls.sql < 600, `actual SQL count ${env.calls.sql}`);
  t.diagnostic(`500 updates + 500 durable reconcile tasks: ${env.calls.sql} SQL statements including reads and initial lease acquisition`);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key LIKE 'reconcile:%' AND status='pending'").get().n, 500);
  assert.equal(env.calls.batches.filter(batch => batch.some(s => s.sql.startsWith('UPDATE auction_listings'))).length, 5);
  clean(env);
});


test('gap namespace lookup uses its primary-key range and ignores other controlled task namespaces', async t => {
  const env = await harness(t); seed(env);
  const unrelated = ['server-feed-gap-other:100', 'server-feed-batch:100', 'SERVER-FEED-GAP:100'];
  const insert = env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,next_due_at,status) VALUES(?,'all',?,'pending')");
  for (const key of unrelated) insert.run(key, OLD);
  const original = "SELECT * FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-gap:%' AND status='pending' LIMIT 2";
  const originalPlan = env.sqlite.prepare('EXPLAIN QUERY PLAN ' + original).all().map(row => row.detail);
  assert.ok(originalPlan.some(detail => /^SCAN automatic_refresh_tasks\b/.test(detail)), originalPlan.join('\n'));
  const result = await run(env);
  assert.equal(result.complete, true); assert.equal(cursor(env), 101); assert.equal(bid(env), 1101);
  for (const key of unrelated) assert.equal(task(env, key).status, 'pending', 'other namespaces remain untouched');
  clean(env);
});

test('a malformed pending canonical gap pointer blocks before fetching or catalog writes', async t => {
  const env = await harness(t); seed(env);
  env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('server-feed-gap:99','all','{}',?,'pending')").run(OLD);
  await assert.rejects(run(env), /FEED_GAP_POINTER_INVALID/);
  assert.equal(cursor(env), 100); assert.equal(bid(env), 100); assert.equal(env.calls.request.length, 0);
  assert.equal(task(env, 'server-feed-gap:99').status, 'pending'); clean(env);
});

test('a competing canonical gap pointer appearing before partial import still rolls back the whole batch', async t => {
  const env = await harness(t); seed(env);
  env.calls.beforeBatch = statements => {
    if (statements.some(statement => statement.sql.startsWith('UPDATE auction_listings'))) {
      env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('server-feed-gap:99','all','{}',?,'pending')").run(OLD);
    }
  };
  await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(cursor(env), 100); assert.equal(bid(env), 100);
  assert.equal(task(env).status, 'pending'); assert.equal(task(env, 'server-feed-gap:99').status, 'pending');
  assert.equal(env.calls.request.length, 1); clean(env);
});
const fullFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/apibara-discovery-page-shape.json'), 'utf8')).response.data[0];
function gapCreated(sequence = 101, lot = LOT, extra = {}) {
  const record = structuredClone(fullFixture);
  Object.assign(record, {vehicle_id: `gap-full-${lot}`, platform: 'copart', lot_number: lot, vin: VIN, updated_at: EVENT});
  record.auction.state = 'open'; record.pricing = {current_bid_usd: 200, current_bid2_usd: null, buy_now_usd: 6200};
  return event(sequence, lot, {event: 'lot.created', changed_fields: ['lot.created'], before: [], after: {}, record, ...extra});
}

test('verified attached creation inserts a missing full car and binds its hydration marker into final proof', async t => {
  const env = await harness(t, page([gapCreated()]));
  const result = await run(env);
  assert.equal(cursor(env), 101); assert.equal(bid(env), 200);
  const listing = env.sqlite.prepare('SELECT * FROM auction_listings WHERE lot=?').get(LOT);
  assert.equal(listing.vin_normalized, VIN); assert.equal(listing.source_updated_at, EVENT);
  assert.equal(listing.summary_synced_at, EVENT, 'full source time is preserved instead of stamping page capture');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n, 1);
  assert.equal(task(env, `reconcile:copart:${LOT}`), undefined, 'verified creation does not remain a missing-car need');
  const proofs = result.proof.batchReceipts.filter(row => row.taskKey.startsWith('file-hydration:'));
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].cursorSha256, sha(task(env, proofs[0].taskKey).cursor));
  assert.deepEqual(JSON.parse([...env.objects.values()][0]).data[0].record, env.response.data[0].record);
  clean(env);
});

test('crash after full hydration resumes the same archive without duplicate writes or provider refetch', async t => {
  const env = await harness(t, page([gapCreated()])); let crashed = false;
  env.calls.afterCommit = statements => {
    if (!crashed && statements.some(statement => statement.sql.startsWith('INSERT INTO auction_listings'))) {
      crashed = true; throw Error('TIMEOUT_AFTER_HYDRATION');
    }
  };
  await assert.rejects(run(env), /INVENTORY_COMMIT_FAILED/);
  assert.equal(cursor(env), 100); assert.equal(task(env).status, 'pending'); assert.equal(bid(env), 200);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n, 1);
  env.sqlite.prepare('UPDATE auction_listings SET current_bid_usd=99999 WHERE lot=?').run(LOT);
  env.calls.afterCommit = null; env.error = Error('REFETCH_FORBIDDEN');
  const result = await run(env);
  assert.equal(result.resumed, true); assert.equal(cursor(env), 101); assert.equal(bid(env), 99999);
  assert.equal(env.calls.request.length, 1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n, 1);
  clean(env);
});

test('full-record identity quarantine blocks every partial price in the same gap group', async t => {
  const created = gapCreated(); created.record.vin = 'SALZP2FX8PH185647';
  const env = await harness(t, page([created, event(102)])); seed(env);
  const result = await run(env, 103);
  assert.equal(cursor(env), 102); assert.equal(bid(env), 100);
  assert.equal(task(env, `reconcile:copart:${LOT}`).status, 'identity_error');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n, 0);
  assert.equal(result.proof.batchReceipts.filter(row => row.taskKey.startsWith('file-hydration:')).length, 1);
  clean(env);
});

test('missing, null and incomplete attached records preserve durable needs without fabricating full cars', async t => {
  for (const kind of ['missing', 'null', 'incomplete']) {
    const created = gapCreated();
    if (kind === 'missing') delete created.record;
    else if (kind === 'null') created.record = null;
    else delete created.record.pricing.current_bid2_usd;
    const env = await harness(t, page([created]));
    const result = await run(env);
    assert.equal(cursor(env), 101); assert.equal(bid(env), undefined);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 0);
    assert.equal(task(env, `reconcile:copart:${LOT}`).status, 'pending');
    assert.equal(result.proof.batchReceipts.filter(row => row.taskKey.startsWith('file-hydration:')).length, kind === 'incomplete' ? 1 : 0);
    clean(env);
  }
});

test('81 full creations hydrate at most 80 new groups per call and resume without moving cursor early', async t => {
  const events = Array.from({length: 81}, (_, index) => gapCreated(101 + index, String(10000000 + index)));
  const env = await harness(t, page(events));
  let sqlBefore = env.calls.sql;
  const first = await run(env, 182);
  assert.equal(first.hydrating, true); assert.equal(first.repaired, false); assert.equal(first.complete, false);
  assert.equal(first.through, 100); assert.equal(cursor(env), 100); assert.equal(task(env).status, 'pending');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 80);
  assert.ok(env.calls.sql - sqlBefore < 970);
  env.error = Error('REFETCH_FORBIDDEN'); sqlBefore = env.calls.sql;
  const second = await run(env, 182);
  assert.equal(second.complete, true); assert.equal(second.resumed, true); assert.equal(cursor(env), 181);
  assert.equal(env.calls.request.length, 1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 81);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n, 81);
  assert.ok(env.calls.sql - sqlBefore < 970);
  assert.equal(second.proof.batchReceipts.filter(row => row.taskKey.startsWith('file-hydration:')).length, 5);
  clean(env);
});

test('changed pointer before hydration rolls back the full car and leaves its marker absent', async t => {
  const env = await harness(t, page([gapCreated()]));
  env.calls.beforeBatch = statements => {
    if (statements.some(statement => statement.sql.startsWith('INSERT INTO auction_listings'))) {
      env.sqlite.exec('UPDATE server_feed_state SET committed_sequence=103');
    }
  };
  await assert.rejects(run(env), /INVENTORY_COMMIT_STALE_BASELINE/);
  assert.equal(bid(env), undefined); assert.equal(task(env).status, 'pending');
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key GLOB 'file-hydration:*'").get().n, 0);
  clean(env);
});

test('final hydration marker mutation cannot commit the file cursor or complete its pending page', async t => {
  const env = await harness(t, page([gapCreated()]));
  env.calls.beforeBatch = statements => {
    if (statements.some(statement => statement.sql.startsWith('UPDATE server_feed_state SET committed_sequence'))) {
      env.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key GLOB 'file-hydration:*'");
    }
  };
  await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(cursor(env), 100); assert.equal(task(env).status, 'pending'); assert.equal(bid(env), 200);
  assert.equal(env.calls.request.length, 1); clean(env);
});

test('maximum 500 attached creations resume within unchanged per-invocation query and raw-size bounds', async t => {
  const events = Array.from({length: 500}, (_, index) => gapCreated(101 + index, String(10000000 + index)));
  const env = await harness(t, page(events));
  assert.ok(Buffer.byteLength(JSON.stringify(env.response)) <= MAX_RESPONSE_BYTES);
  let result, invocations = 0, maxSql = 0;
  do {
    const previousSql = env.calls.sql;
    result = await run(env, 601); invocations++;
    maxSql = Math.max(maxSql, env.calls.sql - previousSql);
    assert.ok(env.calls.sql - previousSql < 800, `invocation ${invocations}: ${env.calls.sql - previousSql} statements`);
    if (!result.complete) assert.equal(cursor(env), 100);
    env.error = Error('REFETCH_FORBIDDEN');
    assert.ok(invocations <= 7);
  } while (!result.complete);
  assert.ok(env.calls.sql < 2874, "less SQL than measured former 25-invocation baseline");
  assert.equal(invocations, 7); assert.equal(env.calls.request.length, 1); assert.equal(cursor(env), 600);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 500);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n, 500);
  assert.equal(result.proof.batchReceipts.filter(row => row.taskKey.startsWith('file-hydration:')).length, 25);
  t.diagnostic(`500 full creations: ${invocations} invocations, one provider page, max ${maxSql} SQL statements per invocation; total ${env.calls.sql} SQL statements`);
  clean(env);
});

function mixedGapEvents(newCount){
  return Array.from({length:500},(_,index)=>{
    const sequence=101+index,lot=String(10000000+index);
    const extra={changed_fields:['pricing.current_bid_usd','details.color'],after:{'pricing.current_bid_usd':1101+index,'details.color':'Red'}};
    if(index>=newCount)return event(sequence,lot,extra);
    const created=gapCreated(sequence,lot,extra);created.record.updated_at=OLD;return created;
  });
}

test('mixed500-group pages keep every price and durable need while measured work stays below800 SQL and5000 table writes per invocation',async t=>{
  for(const newCount of [40,80,500]){
    const events=mixedGapEvents(newCount),env=await harness(t,page(events));
    for(const source of events.slice(newCount))seed(env,source.vehicle.lot_number);
    let result,calls=0,maxSql=0,maxWrites=0;
    do{
      const priorSql=env.calls.sql,priorWrites=env.sqlite.prepare('SELECT total_changes() n').get().n;
      result=await run(env,601);calls++;
      const sql=env.calls.sql-priorSql,writes=env.sqlite.prepare('SELECT total_changes() n').get().n-priorWrites;
      maxSql=Math.max(maxSql,sql);maxWrites=Math.max(maxWrites,writes);
      assert.ok(sql<800,'gap module keeps more than170 SQL slots for runner and settlement');
      assert.ok(writes<5000,'SQLite table mutations fit the unchanged5000-row reservation; not a D1 index-billing measurement');
      if(!result.complete){assert.equal(result.phase,newCount===500?'hydrate':'apply');if(result.phase==='apply')assert.equal(result.appliedGroups,300);assert.equal(cursor(env),100);}
      env.error=Error('REFETCH_FORBIDDEN');assert.ok(calls<=(newCount===500?7:2));
    }while(!result.complete);
    assert.equal(calls,newCount===40?1:newCount===80?2:7);assert.equal(result.phase,'complete');assert.equal(result.appliedGroups,500);assert.equal(cursor(env),600);
    assert.equal(env.calls.request.length,1);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,500);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE current_bid_usd BETWEEN 1101 AND 1600').get().n,500);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key GLOB 'reconcile:*' AND status='pending'").get().n,500);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,newCount);
    const bulk=env.calls.prepared.find(sql=>sql.includes('task_key IN (SELECT value FROM json_each(?))'));
    const plan=env.sqlite.prepare('EXPLAIN QUERY PLAN '+bulk).all('[]').map(row=>row.detail);
    assert.ok(plan.some(detail=>/SEARCH automatic_refresh_tasks USING COVERING INDEX sqlite_autoindex_automatic_refresh_tasks_1/.test(detail)),plan.join('\n'));
    assert.equal(plan.some(detail=>/^SCAN automatic_refresh_tasks\b/.test(detail)),false);
    t.diagnostic(newCount+' full creations + '+(500-newCount)+' known groups;500 price changes +500 queued needs: '+calls+' invocations, max '+maxSql+' SQL and '+maxWrites+' SQLite table mutations');
    clean(env);
  }
});

test('mixed page hydration and an interrupted partial receipt replay preserve old markers without refetch or duplicate full writes',async t=>{
  const events=mixedGapEvents(80),env=await harness(t,page(events));for(const source of events.slice(80))seed(env,source.vehicle.lot_number);
  let crashed=false;
  env.calls.afterCommit=statements=>{if(!crashed&&statements.some(statement=>statement.sql.startsWith('UPDATE auction_listings'))){crashed=true;throw Error('LOST_PARTIAL_ACK');}};
  await assert.rejects(run(env,601),/AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.equal(cursor(env),100);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,80);
  const markers=env.sqlite.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key GLOB 'file-hydration:*' ORDER BY task_key").all();
  assert.equal(markers.length,4);env.calls.afterCommit=null;env.error=Error('REFETCH_FORBIDDEN');
  const priorSql=env.calls.sql,result=await run(env,601);assert.equal(result.complete,true);assert.equal(cursor(env),600);assert.equal(env.calls.request.length,1);
  assert.ok(env.calls.sql-priorSql<800);assert.deepEqual(env.sqlite.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key GLOB 'file-hydration:*' ORDER BY task_key").all(),markers);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,80);clean(env);
});
