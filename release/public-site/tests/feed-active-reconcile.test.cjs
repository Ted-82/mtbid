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

test('eligibility binds complete group, real recorded time and expected VIN; exact replay and older sequence cannot replace it', async t => {
  const env = await harness(t), groups = [group([event(101), event(103)])];
  await record(env, groups); const before = eligibility(env);
  assert.equal(before.last_sequence, 103); assert.equal(before.recorded_at, EVENT); assert.equal(before.expected_vin, VIN);
  await record(env, groups); assert.deepEqual(eligibility(env), before);
  await record(env, [group([event(102, LOT, {vehicle: {platform: 'copart', lot_number: LOT, vin: OTHER_VIN}})])]);
  assert.deepEqual(eligibility(env), before); clean(env);
});

test('same-sequence conflict and optional checkpoint failure roll back every eligibility row', async t => {
  const env = await harness(t); await record(env); const before = eligibility(env);
  await assert.rejects(record(env, [group([event(101, LOT, {reason: 'different'})]), group([event(102, '10000002')])]), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  assert.deepEqual(eligibility(env), before); assert.equal(eligibility(env, '10000002'), undefined);
  await assert.rejects(record(env, [group([event(102, LOT)])], {
    checkpointStatements: [env.db.prepare('INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,0)').bind('reject')]
  }), /AUTOMATIC_REFRESH_WRITE_FAILED/); assert.deepEqual(eligibility(env), before); clean(env);
});

test('malformed VIN, within-group/cross-generation conflicts and full-record mismatch remain disabled', async t => {
  const env = await harness(t);
  const conflict = group([event(101), event(102, LOT, {vehicle: {platform: 'copart', lot_number: LOT, vin: OTHER_VIN}})]);
  const bad = group([event(103, '10000002', {vehicle: {platform: 'copart', lot_number: '10000002', vin: ''}})], [103]);
  const full = group([event(104, '10000003', {record: {platform: 'iaai', lot_number: '10000003', vin: VIN}})]);
  await record(env, [conflict, bad, full, group([event(105, '10000004')])]);
  for (const lot of [LOT, '10000002', '10000003']) assert.equal(eligibility(env, lot).identity_error, 1);
  finish(env); generation(env, 2, 1001, 2000);
  await record(env, [group([event(1001, '10000004', {vehicle: {platform: 'copart', lot_number: '10000004', vin: OTHER_VIN}})])], {generationId: 2});
  assert.equal(eligibility(env, '10000004').identity_error, 1); assert.equal(eligibility(env, '10000004').expected_vin, VIN);
  await record(env, [group([event(1002, '10000004')])], {generationId: 2}); assert.equal(eligibility(env, '10000004').identity_error, 1); clean(env);
});

test('terminal status survives later neutral events and only explicit active state reopens eligibility', async t => {
  const env = await harness(t);
  await record(env, [group([event(101), event(102, LOT, {event: 'lot.sold', terminal: true}), event(103, LOT, {event: 'bid.changed'})])]);
  assert.equal(eligibility(env).terminal, 1);
  await record(env, [group([event(104, LOT, {event: 'bid.changed'})])]); assert.equal(eligibility(env).terminal, 1);
  await record(env, [group([event(105, LOT, {event: 'lot.updated', changed_fields: ['auction.state'], after: {'auction.state': 'open'}})])]);
  assert.equal(eligibility(env).terminal, 0);
  await record(env, [group([event(106, '10000002', {record: {platform: 'copart', lot_number: '10000002', vin: VIN, auction: {state: 'sold'}}})])]);
  assert.equal(eligibility(env, '10000002').terminal, 1); clean(env);
});

test('strict group validation, generation binding and stale lease fail before eligibility changes', async t => {
  for (const groups of [[group(), group()], [group([event(102), event(101)])], [group([event(101, LOT, {recorded_at: '2026-02-30T11:50:00Z'})])],
    [group([event(101, LOT, {recorded_at: '2026-10-29T12:10:00Z'})])], [group([event(101)], [101])]]) {
    const env = await harness(t); await assert.rejects(record(env, groups)); assert.equal(eligibility(env), undefined);
  }
  const env = await harness(t); await assert.rejects(record(env, [group([event(1001)])]), /AUTOMATIC_REFRESH_WRITE_FAILED/);
  env.calls.clock = NOW + 11 * 60000; await assert.rejects(record(env), /AUTOMATIC_REFRESH_WRITE_FAILED/); assert.equal(eligibility(env), undefined); clean(env);
});

test('100 complete groups use one small atomic eligibility transaction and 101 groups are rejected', async t => {
  const env = await harness(t), groups = Array.from({length: 100}, (_, n) => group([event(n + 101, String(n + 10000000))]));
  const before = env.calls.batches.length; await record(env, groups);
  assert.equal(env.calls.batches.length, before + 1); assert.equal(env.calls.batches.at(-1).length, 5);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM server_feed_reconcile_eligibility').get().n, 100);
  await assert.rejects(record(env, [...groups, group([event(201, '10000100')])]), /FEED_ACTIVE_GROUP_INVALID/); clean(env);
});

test('new Copart LOT without record becomes a complete listing only through existing full writer and linked task transaction', async t => {
  const env = await harness(t); enqueue(env); await record(env); finish(env);
  const result = await run(env);
  assert.equal(result.completed, 1); assert.equal(env.report.inserted, 1); assert.equal(listing(env).vin_normalized, VIN);
  assert.equal(listing(env).current_bid_usd, 999); assert.equal(listing(env).detail_synced_at, AT);
  assert.equal(task(env).status, 'complete'); assert.equal(task(env).listing_id, listing(env).listing_id);
  assert.deepEqual(env.calls.requests, [{spec: {operation: 'vehicleByIdentifier', identifier: LOT, platform: 'copart'}, listingId: null}]);
  assert.equal(env.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(env.store.keys[2]).consumed, 1);
  await run(env); assert.equal(env.calls.requests.length, 1); clean(env);
});

test('a same-number cross-platform LOT retries by the verified VIN within the next run budget', async t => {
  for (const secondMatches of [true,false]) {
    const env=await harness(t);enqueue(env);await record(env);finish(env);
    env.detail=raw(LOT,{platform:'iaai',vin:OTHER_VIN});
    const first=await run(env,{maxRequests:1});
    assert.equal(first.deferred,1);assert.equal(listing(env),undefined);
    assert.equal(task(env).status,'pending');assert.equal(env.calls.requests.length,1);
    env.detail=secondMatches?raw():raw(LOT,{platform:'iaai',vin:OTHER_VIN});
    const second=await run(env,{maxRequests:1});
    assert.equal(env.calls.requests.length,2);assert.equal(env.calls.requests[1].spec.identifier,VIN);
    if(secondMatches){assert.equal(second.completed,1);assert.equal(listing(env).vin_normalized,VIN);}
    else{assert.equal(second.identityErrors,1);assert.equal(listing(env),undefined);assert.equal(task(env).status,'identity_error');}
    clean(env);
  }
});

test('consumer never requires global API stream cursor', async t => {
  const env = await harness(t); enqueue(env); await record(env); finish(env);
  env.sqlite.exec("DELETE FROM automatic_refresh_tasks WHERE task_key='stream:changes'");
  assert.equal((await run(env)).completed, 1);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE task_key='stream:changes'").get().n, 0);
});

test('stale/currently applying/incomplete feed and historical event time prevent all requests', async t => {
  for (const change of [env => {}, env => {finish(env); env.sqlite.prepare('UPDATE server_feed_generations SET observed_at=?').run(OLD);},
    env => {finish(env); generation(env, 2, 1001, 2000); env.sqlite.exec('UPDATE server_feed_state SET active_generation=NULL');},
    env => {finish(env); env.sqlite.exec('UPDATE server_feed_state SET committed_sequence=2001');}]) {
    const env = await harness(t); enqueue(env); await record(env); change(env);
    assert.equal((await run(env)).reason, 'feed_not_current'); assert.equal(env.calls.requests.length, 0);
  }
  const old = await harness(t); enqueue(old);
  await record(old, [group([event(101, LOT, {recorded_at: OLD, vehicle_updated_at: OLD})])]); finish(old);
  assert.equal((await run(old)).attempted, 0); assert.equal(old.calls.requests.length, 0);
});

test('only due pending eligible tasks run; identity errors, terminal LOTs and historical queue remain untouched', async t => {
  const env = await harness(t); const groups = [];
  for (let n = 1; n <= 6; n++) {const lot = String(10000000 + n); enqueue(env, lot); if (n < 6) groups.push(group([event(100 + n, lot)]));}
  await record(env, groups); finish(env);
  env.sqlite.exec("UPDATE automatic_refresh_tasks SET status='identity_error' WHERE cursor='10000001'");
  env.sqlite.exec("UPDATE automatic_refresh_tasks SET status='complete' WHERE cursor='10000002'");
  env.sqlite.prepare("UPDATE automatic_refresh_tasks SET next_due_at=? WHERE cursor='10000003'").run('2026-10-30T00:00:00Z');
  env.sqlite.exec("UPDATE server_feed_reconcile_eligibility SET terminal=1 WHERE lot='10000004'");
  assert.equal((await run(env)).completed, 1); assert.equal(env.calls.requests[0].spec.identifier, '10000005');
  assert.equal(task(env, '10000006').status, 'pending'); assert.equal(task(env, '10000001').status, 'identity_error'); clean(env);
});

test('at most two details per invocation and zero allowance performs no reads', async t => {
  const env = await harness(t); const groups = [1, 2, 3].map(n => {const lot = String(10000000 + n); enqueue(env, lot); return group([event(100 + n, lot)]);});
  await record(env, groups); finish(env); env.calls.reads = 0;
  assert.equal((await run(env, {maxRequests: 0})).attempted, 0); assert.equal(env.calls.reads, 0);
  await assert.rejects(run(env, {maxRequests: 3}), /FEED_ACTIVE_CONFIG_INVALID/);
  assert.equal((await run(env)).completed, 2); assert.equal(env.calls.requests.length, 2); clean(env);
});

test('known active rows use provider identifier; inactive or non-apibara rows are not requested', async t => {
  const env = await harness(t, [raw(LOT, {updated_at: OLD}), raw('10000002', {updated_at: OLD}), raw('10000003', {updated_at: OLD})]);
  const groups = [1, 2, 3].map(n => {const lot = String(10000000 + n); enqueue(env, lot, {listing_id: listing(env, lot).listing_id}); return group([event(100 + n, lot)]);});
  await record(env, groups); finish(env);
  env.sqlite.exec("UPDATE auction_listings SET auction_state='ended' WHERE lot='10000002'");
  env.sqlite.exec("UPDATE vehicle_sources SET provider='other' WHERE source_key=(SELECT source_key FROM auction_listings WHERE lot='10000003')");
  const result = await run(env); assert.equal(result.completed, 1); assert.equal(env.calls.requests[0].spec.identifier, `copart-${LOT}`);
  assert.equal(task(env, '10000002').status, 'pending'); assert.equal(task(env, '10000003').status, 'pending'); clean(env);
});

test('known active row with no eligibility or a conflicting saved VIN consumes no request', async t => {
  const env = await harness(t, [raw(LOT, {updated_at: OLD}), raw('10000002', {updated_at: OLD})]);
  enqueue(env); enqueue(env, '10000002'); await record(env); finish(env);
  env.sqlite.prepare('UPDATE auction_listings SET vin_normalized=? WHERE lot=?').run(OTHER_VIN, LOT);
  assert.equal((await run(env)).attempted, 0); assert.equal(env.calls.requests.length, 0); clean(env);
});

test('expected VIN mismatch disables eligibility and task without inserting a listing', async t => {
  const env = await harness(t); enqueue(env); await record(env); finish(env); env.detail = raw(LOT, {vin: OTHER_VIN});
  assert.equal((await run(env)).identityErrors, 1); assert.equal(task(env).status, 'identity_error');
  assert.equal(eligibility(env).identity_error, 1); assert.equal(listing(env), undefined); await run(env); assert.equal(env.calls.requests.length, 1); clean(env);
});

test('404 and timeout preserve task/backoff; exhausted admission budget avoids even the detail request', async t => {
  const missing = await harness(t); enqueue(missing); await record(missing); finish(missing);
  missing.error = Object.assign(Error('missing'), {code: 'NOT_FOUND'}); assert.equal((await run(missing)).failed, 1);
  assert.equal(task(missing).next_due_at, '2026-11-05T12:00:00.000Z'); await run(missing); assert.equal(missing.calls.requests.length, 1);
  const timeout = await harness(t); enqueue(timeout); await record(timeout); finish(timeout);
  timeout.error = Object.assign(Error('timeout'), {code: 'TIMEOUT'}); await assert.rejects(run(timeout), error => error === timeout.error);
  assert.equal(task(timeout).next_due_at, '2026-10-29T13:00:00.000Z'); assert.equal(task(timeout).status, 'pending');
  const capped = await harness(t); enqueue(capped); await record(capped); finish(capped);
  capped.sqlite.prepare('UPDATE automatic_refresh_budgets SET consumed=limit_count WHERE budget_key=?').run(capped.store.keys[2]);
  assert.equal((await run(capped)).reason, 'new_listing_budget'); assert.equal(capped.calls.requests.length, 0); assert.equal(task(capped).status, 'pending'); clean(capped);
});

test('newer local full observations cannot be overwritten or marked complete', async t => {
  const env = await harness(t, [raw(LOT, {updated_at: OLD})]);
  env.sqlite.prepare('UPDATE auction_listings SET source_updated_at=?,summary_synced_at=?,detail_synced_at=?,last_seen_at=?').run(AT, AT, AT, AT);
  enqueue(env, LOT, {listing_id: listing(env).listing_id});
  await record(env); finish(env); const before = listing(env);
  assert.equal((await run(env)).deferred, 1); assert.deepEqual(listing(env), before); assert.equal(task(env).status, 'pending'); clean(env);
});

test('eligibility/cursor/queue races and stale lease roll back full writer, snapshot, admission budget and completion', async t => {
  for (const mutate of [env => env.sqlite.exec('UPDATE server_feed_reconcile_eligibility SET terminal=1'),
    env => env.sqlite.exec('UPDATE server_feed_state SET committed_sequence=1001'),
    env => env.sqlite.exec("UPDATE automatic_refresh_tasks SET failures=failures+1 WHERE task_key LIKE 'reconcile:%'"),
    env => env.sqlite.exec("UPDATE automatic_refresh_state SET lease_owner='other'")]) {
    const env = await harness(t); enqueue(env); await record(env); finish(env);
    env.calls.beforeBatch = statements => {if (statements.some(s => /INSERT INTO auction_listings/.test(s.sql))) mutate(env);};
    await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/);
    assert.equal(listing(env), undefined); assert.equal(task(env).status, 'pending');
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n, 0);
    assert.equal(env.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(env.store.keys[2]).consumed, 0); clean(env);
  }
});

test('timeout after full transaction commit retries without fetching or duplicating snapshot', async t => {
  const env = await harness(t); enqueue(env); await record(env); finish(env);
  env.calls.afterCommit = statements => {if (statements.some(s => /INSERT INTO auction_listings/.test(s.sql))) throw Error('TIMEOUT_AFTER_COMMIT');};
  await assert.rejects(run(env), /AUTOMATIC_REFRESH_WRITE_FAILED/); assert.equal(task(env).status, 'complete');
  env.calls.afterCommit = null; await run(env); assert.equal(env.calls.requests.length, 1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n, 1); clean(env);
});

test('feed and event freshness expire at 90 minutes even when capture timestamps are recent', async t => {
  const env = await harness(t); enqueue(env);
  await record(env, [group([event(101, LOT, {recorded_at: new Date(NOW - FRESH_MS - 1).toISOString(), vehicle_updated_at: OLD})])]); finish(env);
  assert.equal((await run(env)).attempted, 0);
  const fresh = await harness(t); enqueue(fresh); await record(fresh); finish(fresh);
  fresh.calls.clock += FRESH_MS; assert.equal((await run(fresh)).reason, 'feed_not_current'); assert.equal(fresh.calls.requests.length, 0);
});
