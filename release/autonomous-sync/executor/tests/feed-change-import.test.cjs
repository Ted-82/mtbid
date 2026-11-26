'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), {DatabaseSync} = require('node:sqlite');
const {createHash} = require('node:crypto');
const {RefreshStore} = require('../sync/automatic-refresh.cjs');
const {importChangeBatch, hashReceipt, MAX_GROUPS} = require('../sync/feed-change-import.cjs');
const {assertStatement} = require('../scripts/d1-operator-bridge.cjs');
const {BASELINE_FIELDS} = require('../sync/inventory-change-patch.cjs');
const NOW = Date.parse('2026-10-28T13:00:00.000Z'), AT = new Date(NOW).toISOString();
const OLD = '2026-10-27T12:00:00.000Z', EVENT = '2026-10-28T12:00:00.000Z';
const VIN = '1HGCM82633A004352', OTHER_VIN = 'SALZP2FX8PH185647', LOT = '10000001';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const allowedWrites = new Set(['auction_listings', 'automatic_refresh_state', 'automatic_refresh_tasks', 'automatic_refresh_guards', 'sync_batch_guards']);

function database(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0004_d1_sync_2.sql', '0008_automatic_refresh.sql'])
    sqlite.exec(fs.readFileSync(path.join(__dirname, '../docs/proposals', file), 'utf8'));
  const calls = {reads: [], batches: [], beforeBatch: null, fault: null};
  const db = {prepare(sql) {return {bind(...params) {return {sql, params,
    async all() {calls.reads.push({sql, params}); return {results: sqlite.prepare(sql).all(...params)};},
    async first() {calls.reads.push({sql, params}); return sqlite.prepare(sql).get(...params) || null;},
    async run() {return {meta: {changes: Number(sqlite.prepare(sql).run(...params).changes)}};}
  };}};}, async batch(statements) {
    assert.ok(statements.length <= 250);
    for (const statement of statements) assertStatement(statement.sql, allowedWrites);
    calls.batches.push(statements); await calls.beforeBatch?.(statements); sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => {
        if (calls.fault?.(statement)) throw Error('INJECTED_DATABASE_FAILURE');
        return {meta: {changes: Number(sqlite.prepare(statement.sql).run(...statement.params).changes)}};
      });
      sqlite.exec('COMMIT'); return results;
    } catch (error) {sqlite.exec('ROLLBACK'); throw error;}
  }};
  return {sqlite, db, calls, store: new RefreshStore(db, 'file-change-test', () => NOW)};
}
function seed(sqlite, lot = LOT, extra = {}, sourceExtra = {}) {
  const row = {listing_id: `listing-${lot}`, source_key: `source-${lot}`, platform: 'copart', lot, vin_normalized: VIN,
    identity_state: 'resolved', source_updated_at: OLD, summary_synced_at: OLD, detail_synced_at: OLD,
    first_seen_at: OLD, last_seen_at: OLD, created_at: OLD, updated_at: OLD, auction_state: 'open', source_status: 'Open',
    auction_at: '2026-10-29T12:00:00.000Z', is_timed: 0, timed_end_at: null, current_bid_usd: 100,
    current_bid2_usd: null, buy_now_usd: 15000, media_urls_json: '["https://example.test/photo.jpg"]', ...extra};
  const source = {source_key: row.source_key, provider: 'apibara', platform: row.platform, identity_state: 'resolved',
    first_seen_at: OLD, last_seen_at: OLD, created_at: OLD, updated_at: OLD, ...sourceExtra};
  sqlite.prepare(`INSERT INTO vehicle_sources(${Object.keys(source)}) VALUES(${Object.keys(source).map(() => '?')})`).run(...Object.values(source));
  sqlite.prepare(`INSERT INTO auction_listings(${Object.keys(row)}) VALUES(${Object.keys(row).map(() => '?')})`).run(...Object.values(row));
  return row;
}
function event(sequence, lot = LOT, after = {'pricing.current_bid_usd': sequence + 100}, extra = {}) {
  return {sequence, event_id: `chg_${sequence}`, event: 'bid.changed', terminal: false,
    vehicle: {platform: 'copart', lot_number: lot, vin: VIN}, changed_fields: Object.keys(after), before: {}, after,
    recorded_at: EVENT, vehicle_updated_at: EVENT, ...extra};
}
function group(events, quarantinedSequences = []) {
  return {platform: events[0].vehicle.platform, lot: events[0].vehicle.lot_number, events, quarantinedSequences};
}
function dataset(groups, changes = {}) {
  const sequences = groups.flatMap(item => item.events.map(value => value.sequence));
  const sources = [{generationId: 1234, sha256: 'a'.repeat(64), records: sequences.length,
    firstSequence: Math.min(...sequences), lastSequence: Math.max(...sequences)}];
  return {identity: hash({version: 1, sources}), databaseSha256: 'd'.repeat(64), sources, records: sequences.length,
    quarantined: groups.reduce((sum, item) => sum + item.quarantinedSequences.length, 0),
    firstSequence: Math.min(...sequences), lastSequence: Math.max(...sequences), uniqueLots: groups.length, ...changes};
}
function receipt(groups = [group([event(1)])], options = {}) {
  const result = {version: 1, dataset: dataset(groups), observedAt: AT, offset: 0, eventOffset: 0, quarantineOffset: 0, groups, ...options};
  result.batchSha256 = hashReceipt(result); return result;
}
const apply = (env, input) => importChangeBatch({db: env.db, store: env.store, receipt: input});
const listing = (sqlite, lot = LOT) => sqlite.prepare('SELECT * FROM auction_listings WHERE lot=? ORDER BY listing_id').get(lot);
const count = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
const tasks = sqlite => sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key LIKE 'reconcile:%' ORDER BY task_key").all();
const checkpoint = sqlite => sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key LIKE 'file-changes:%'").get();
function clean(sqlite) {
  assert.equal(count(sqlite, 'sync_batch_guards'), 0); assert.equal(count(sqlite, 'automatic_refresh_guards'), 0);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
}

test('100 complete groups use one atomic bounded batch, one UPDATE per LOT and deterministic replay', async t => {
  const env = database(t), groups = Array.from({length: MAX_GROUPS}, (_, index) => {
    const lot = String(10000000 + index); seed(env.sqlite, lot);
    return group([event(index * 2 + 1, lot), event(index * 2 + 2, lot)]);
  });
  env.sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('stream:changes','all','55',?,'complete')").run(OLD);
  const sourcesBefore = env.sqlite.prepare('SELECT * FROM vehicle_sources ORDER BY source_key').all();
  const before = listing(env.sqlite), input = receipt(groups); await env.store.acquire();
  const result = await apply(env, input);
  assert.equal(result.state.offset, 100); assert.equal(result.state.groupedEvents, 200); assert.equal(result.state.updatedGroups, 100);
  assert.equal(result.state.continuityVerified, false); assert.equal(result.state.globalCursorEstablished, false);
  assert.equal(checkpoint(env.sqlite).status, 'complete');
  assert.equal(env.calls.batches.length, 1); assert.equal(env.calls.batches[0].length, 107);
  assert.equal(env.calls.batches[0].filter(item => item.sql.startsWith('UPDATE auction_listings')).length, 100);
  assert.deepEqual({...listing(env.sqlite)}, {...before, current_bid_usd: 104});
  assert.deepEqual(env.sqlite.prepare('SELECT * FROM vehicle_sources ORDER BY source_key').all(), sourcesBefore);
  assert.equal(count(env.sqlite, 'auction_listing_snapshots'), 0); assert.equal(count(env.sqlite, 'auction_events'), 0);
  assert.equal(env.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='stream:changes'").get().cursor, '55');
  const replay = await apply(env, input); assert.equal(replay.alreadyApplied, true); assert.deepEqual(replay.audit, result.audit);
  assert.equal(env.calls.batches.length, 1); clean(env.sqlite);
});

test('multi-batch resume tracks whole groups, events, quarantine and completion without inventing continuity', async t => {
  const env = database(t); seed(env.sqlite); seed(env.sqlite, '10000002'); await env.store.acquire();
  const bad = event(3, '10000002'); bad.vehicle.vin = 'BAD\u001aVIN';
  const groups = [group([event(1), event(2)]), group([bad], [3]), group([event(4, '10000003', {}, {event: 'lot.removed', terminal: true})])];
  const all = dataset(groups);
  const first = receipt(groups.slice(0, 1), {dataset: all}); const a = await apply(env, first);
  assert.equal(a.state.offset, 1); assert.equal(checkpoint(env.sqlite).status, 'importing');
  const second = receipt(groups.slice(1), {dataset: all, offset: 1, eventOffset: 2});
  const b = await apply(env, second); assert.equal(b.state.offset, 3); assert.equal(b.state.groupedEvents, 4);
  assert.equal(b.state.quarantined, 1); assert.equal(b.state.identityErrors, 1); assert.equal(b.state.ignoredEvents, 1);
  assert.equal(checkpoint(env.sqlite).status, 'complete'); assert.equal(tasks(env.sqlite)[0].status, 'identity_error');
  assert.equal((await apply(env, first)).alreadyApplied, true); assert.equal((await apply(env, second)).alreadyApplied, true);
  assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 4); clean(env.sqlite);
});

test('the 100-write plus 100-reconciliation worst case fits the bridge and separates equal LOTs by platform', async t => {
  const env = database(t), groups = Array.from({length: 99}, (_, index) => {
    const lot = String(10000000 + index); seed(env.sqlite, lot);
    return group([event(index + 1, lot, {'pricing.current_bid_usd': 500, make: 'Changed'})]);
  });
  seed(env.sqlite, LOT, {listing_id: 'iaai-listing', source_key: 'iaai-source', platform: 'iaai'});
  groups.push(group([event(100, LOT, {'pricing.current_bid_usd': 900, make: 'Changed'},
    {vehicle: {platform: 'iaai', lot_number: LOT, vin: VIN}})]));
  await env.store.acquire(); const result = await apply(env, receipt(groups));
  assert.equal(env.calls.batches[0].length, 108); assert.equal(result.state.updatedGroups, 100); assert.equal(result.state.queuedGroups, 100);
  assert.equal(env.sqlite.prepare("SELECT current_bid_usd FROM auction_listings WHERE platform='copart' AND lot=?").get(LOT).current_bid_usd, 500);
  assert.equal(env.sqlite.prepare("SELECT current_bid_usd FROM auction_listings WHERE platform='iaai' AND lot=?").get(LOT).current_bid_usd, 900);
  assert.equal(tasks(env.sqlite).length, 100); clean(env.sqlite);
});

test('late checkpoint failure rolls back updates, queue, audit and lease extension; retry succeeds once', async t => {
  const env = database(t); seed(env.sqlite); await env.store.acquire();
  env.sqlite.prepare('UPDATE automatic_refresh_state SET lease_until=?').run(new Date(NOW + 60000).toISOString());
  const leaseBefore = env.sqlite.prepare('SELECT * FROM automatic_refresh_state').get();
  const input = receipt([group([event(1)]), group([event(2, '10000002')])]);
  env.calls.fault = statement => statement.sql.includes('scan_pages=automatic_refresh_tasks.scan_pages+1');
  await assert.rejects(apply(env, input), /DATABASE|FAILED|COMMIT/);
  assert.equal(listing(env.sqlite).current_bid_usd, 100); assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 0);
  assert.deepEqual(env.sqlite.prepare('SELECT * FROM automatic_refresh_state').get(), leaseBefore); clean(env.sqlite);
  env.calls.fault = null; const result = await apply(env, input);
  assert.equal(result.state.updatedGroups, 1); assert.equal(result.state.queuedGroups, 1); assert.equal(tasks(env.sqlite)[0].status, 'pending');
  assert.equal((await apply(env, input)).alreadyApplied, true); assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 3); clean(env.sqlite);
});

test('expired, stolen or blocked lease cannot apply any receipt effects', async t => {
  for (const mutation of ["lease_until='2026-10-28T12:59:00.000Z'", "lease_owner='other'", "blocked_reason='blocked'"]) {
    const env = database(t); seed(env.sqlite); await env.store.acquire(); env.sqlite.exec(`UPDATE automatic_refresh_state SET ${mutation}`);
    await assert.rejects(apply(env, receipt()), /LEASE|GUARD|FAILED|COMMIT/);
    assert.equal(listing(env.sqlite).current_bid_usd, 100); assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 0); clean(env.sqlite);
  }
});

test('full original baseline CAS rejects races on every field, including net-zero and ignored groups', async t => {
  for (const [field, value] of BASELINE_FIELDS.filter(field => !['listing_id', 'source_key', 'platform', 'lot', 'identity_state', 'is_timed'].includes(field))
    .map(field => [field, ['current_bid_usd', 'current_bid2_usd', 'buy_now_usd'].includes(field) ? 777 : field === 'vin_normalized' ? OTHER_VIN : EVENT])) {
    const env = database(t); seed(env.sqlite); await env.store.acquire();
    env.calls.beforeBatch = () => env.sqlite.prepare(`UPDATE auction_listings SET ${field}=?`).run(value);
    await assert.rejects(apply(env, receipt([group([event(1), event(2, LOT, {'pricing.current_bid_usd': 100})])])), /FAILED|COMMIT|BASELINE/);
    assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 0); assert.equal(listing(env.sqlite)[field], value); clean(env.sqlite);
  }
  const env = database(t); seed(env.sqlite, LOT, {last_seen_at: AT}); await env.store.acquire();
  env.calls.beforeBatch = () => env.sqlite.exec('UPDATE auction_listings SET current_bid_usd=900');
  await assert.rejects(apply(env, receipt()), /FAILED|COMMIT|BASELINE/);
  assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 0); assert.equal(listing(env.sqlite).current_bid_usd, 900); clean(env.sqlite);
});

test('source identity change, new missing LOT and concurrent file cursor prevent the whole batch', async t => {
  for (const mutation of ['source', 'unknown', 'cursor']) {
    const env = database(t); seed(env.sqlite); await env.store.acquire();
    const groups = [group([event(1)]), group([event(2, '10000002')])], all = dataset(groups);
    if (mutation === 'cursor') await apply(env, receipt(groups.slice(0, 1), {dataset: all}));
    env.calls.beforeBatch = () => {
      if (mutation === 'source') env.sqlite.exec("UPDATE vehicle_sources SET provider='other'");
      if (mutation === 'unknown') seed(env.sqlite, '10000002');
      if (mutation === 'cursor') env.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor=cursor||' ' WHERE task_key LIKE 'file-changes:%'");
    };
    const input = mutation === 'cursor' ? receipt(groups.slice(1), {dataset: all, offset: 1, eventOffset: 1}) : receipt(groups);
    await assert.rejects(apply(env, input), /FAILED|COMMIT|BASELINE/);
    assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), mutation === 'cursor' ? 2 : 0);
    if (mutation !== 'cursor') assert.equal(listing(env.sqlite).current_bid_usd, 100); clean(env.sqlite);
  }
});

test('newer full details and freshness remain intact; net-zero final state still has no UPDATE', async t => {
  const env = database(t); seed(env.sqlite, LOT, {detail_synced_at: AT, current_bid_usd: 999}); seed(env.sqlite, '10000002');
  await env.store.acquire(); const newer = listing(env.sqlite);
  const result = await apply(env, receipt([group([event(1)]), group([event(2, '10000002'), event(3, '10000002', {'pricing.current_bid_usd': 100})])]));
  assert.deepEqual(listing(env.sqlite), newer); assert.equal(result.state.updatedGroups, 0); assert.equal(result.state.ignoredEvents, 1);
  assert.equal(env.calls.batches[0].filter(item => item.sql.startsWith('UPDATE auction_listings')).length, 0); clean(env.sqlite);
});

test('quarantine, mismatched VIN, malformed VIN and ambiguous/non-apibara source become durable identity errors with no writes', async t => {
  for (const condition of ['quarantine', 'mismatch', 'malformed', 'ambiguous', 'provider', 'sourcePlatform', 'sourceIdentity', 'unresolved']) {
    const env = database(t); seed(env.sqlite, LOT, condition === 'unresolved' ? {identity_state: 'unresolved'} : {},
      condition === 'provider' ? {provider: 'other'} : condition === 'sourcePlatform' ? {platform: 'iaai'} : condition === 'sourceIdentity' ? {identity_state: 'ambiguous'} : {});
    if (condition === 'ambiguous') seed(env.sqlite, LOT, {listing_id: 'duplicate', source_key: 'duplicate-source'});
    const bad = event(2);
    if (condition === 'quarantine') bad.vehicle.vin = 'BAD\u001aVIN';
    if (condition === 'mismatch') bad.vehicle.vin = OTHER_VIN;
    if (condition === 'malformed') bad.vehicle.vin = 'MASKED';
    const before = env.sqlite.prepare('SELECT * FROM auction_listings ORDER BY listing_id').all(); await env.store.acquire();
    const input = receipt([group([event(1), bad], condition === 'quarantine' ? [2] : [])]); const result = await apply(env, input);
    assert.deepEqual(env.sqlite.prepare('SELECT * FROM auction_listings ORDER BY listing_id').all(), before);
    assert.equal(result.state.updatedGroups, 0); assert.equal(result.state.identityErrors, 1); assert.equal(tasks(env.sqlite)[0].status, 'identity_error');
    assert.equal(tasks(env.sqlite)[0].failures, 1); assert.equal(tasks(env.sqlite)[0].next_due_at, new Date(NOW + 7 * 86400000).toISOString());
    assert.equal((await apply(env, input)).alreadyApplied, true); assert.equal(tasks(env.sqlite)[0].failures, 1); clean(env.sqlite);
  }
});

test('unsupported field persists a pending task alongside a supported price, unknown nonterminal stays pending', async t => {
  const env = database(t); seed(env.sqlite); await env.store.acquire();
  const result = await apply(env, receipt([group([event(1, LOT, {'pricing.current_bid_usd': 200, 'make': 'Changed'})]), group([event(2, '10000002')])]));
  assert.equal(listing(env.sqlite).current_bid_usd, 200); assert.equal(result.state.queuedGroups, 2); assert.equal(result.state.identityErrors, 0);
  assert.deepEqual(tasks(env.sqlite).map(item => item.status), ['pending', 'pending']); assert.equal(count(env.sqlite, 'auction_listings'), 1); clean(env.sqlite);
});

test('reconciliation failure delay and sticky identity_error survive later imported groups', async t => {
  for (const [status, error] of [['pending', 'NOT_FOUND'], ['pending', 'TIMEOUT'], ['identity_error', 'PRIOR_IDENTITY']]) {
    const env = database(t); seed(env.sqlite); await env.store.acquire(); const due = new Date(NOW + 7 * 86400000).toISOString();
    env.sqlite.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor,next_due_at,status,failures,last_error_code)
      VALUES(?,'copart',?,?,?,?,2,?)`).run(`reconcile:copart:${LOT}`, `listing-${LOT}`, LOT, due, status, error);
    await apply(env, receipt([group([event(1, LOT, {make: 'Changed'})])]));
    const task = tasks(env.sqlite)[0]; assert.equal(task.status, status); assert.equal(task.next_due_at, due);
    assert.equal(task.last_error_code, error); assert.equal(task.failures, 2); clean(env.sqlite);
  }
});

test('receipt content, metadata, complete-group ordering, accounting and quarantine are strictly validated before writes', async t => {
  const cases = [
    input => {input.groups[0].events[0].after['pricing.current_bid_usd'] = 700;},
    input => {input.observedAt = '2026-10-29T13:00:00.000Z';},
    input => {input.extra = true;},
    input => {input.dataset.identity = 'f'.repeat(64);},
    input => {input.offset = 1; input.batchSha256 = hashReceipt(input);},
    input => {input.eventOffset = 1; input.batchSha256 = hashReceipt(input);},
    input => {input.groups[0].quarantinedSequences = [1]; input.batchSha256 = hashReceipt(input);},
    input => {input.groups[0].quarantinedSequences = [2]; input.batchSha256 = hashReceipt(input);},
    input => {input.groups[0].events[0].vehicle.platform = 'iaai'; input.batchSha256 = hashReceipt(input);},
    input => {input.groups[0].events[0].terminal = true; input.batchSha256 = hashReceipt(input);}
  ];
  for (const mutate of cases) {
    const env = database(t); seed(env.sqlite); await env.store.acquire(); const input = receipt(); mutate(input);
    await assert.rejects(apply(env, input)); assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 0);
    assert.equal(env.calls.batches.length, 0); assert.equal(listing(env.sqlite).current_bid_usd, 100);
  }
  for (const groups of [[group([event(2), event(1)])], [group([event(1)]), group([event(2)])],
    [group([event(1, '10000002')]), group([event(2)])], [group([event(1)]), group([event(1, '10000002')])]]) {
    const env = database(t); await env.store.acquire(); await assert.rejects(apply(env, receipt(groups))); assert.equal(env.calls.batches.length, 0);
  }
});

test('resume rejects changed dataset metadata, page gaps, changed replay and missing audit', async t => {
  const env = database(t); seed(env.sqlite); await env.store.acquire();
  const groups = [group([event(1)]), group([event(2, '10000002')])], all = dataset(groups);
  const first = receipt(groups.slice(0, 1), {dataset: all}); await apply(env, first);
  const changed = receipt(groups.slice(0, 1), {dataset: all, observedAt: '2026-10-28T12:30:00.000Z'});
  await assert.rejects(apply(env, changed), /CHECKPOINT_INVALID/);
  const differentDataset = structuredClone(all); differentDataset.sources[0].generationId++;
  differentDataset.identity = hash({version: 1, sources: differentDataset.sources});
  await assert.rejects(apply(env, receipt(groups.slice(1), {dataset: differentDataset, offset: 1, eventOffset: 1})), /CHECKPOINT_INVALID/);
  await assert.rejects(apply(env, receipt(groups.slice(1), {dataset: all, offset: 1, eventOffset: 0})), /GROUP_GAP/);
  await assert.rejects(apply(env, receipt([group([event(2)])], {dataset: all, offset: 1, eventOffset: 1})), /GROUP_GAP/);
  const substituted = receipt([group([event(1, LOT, {'pricing.current_bid_usd': 300})])], {dataset: all});
  await assert.rejects(apply(env, substituted), /REPLAY_UNVERIFIED/);
  env.sqlite.exec("DELETE FROM automatic_refresh_tasks WHERE task_key LIKE 'file-change-batch:%'");
  await assert.rejects(apply(env, first), /REPLAY_UNVERIFIED/); assert.equal(listing(env.sqlite).current_bid_usd, 101); clean(env.sqlite);
});

test('incomplete grouped-event or quarantine totals cannot mark a dataset complete', async t => {
  for (const kind of ['records', 'quarantine']) {
    const env = database(t); seed(env.sqlite); await env.store.acquire();
    const groups = [group([event(1), event(3)])], all = dataset(groups);
    if (kind === 'records') {all.records = 3; all.sources[0].records = 3; all.identity = hash({version: 1, sources: all.sources});}
    else all.quarantined = 1;
    await assert.rejects(apply(env, receipt(groups, {dataset: all})), /ACCOUNTING_INVALID/);
    assert.equal(listing(env.sqlite).current_bid_usd, 100); assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 0);
  }
});

test('receipt is frozen before asynchronous reads; original mutation cannot change accepted content', async t => {
  const env = database(t); seed(env.sqlite); await env.store.acquire(); const input = receipt();
  const promise = apply(env, input); input.groups[0].events[0].after['pricing.current_bid_usd'] = 999;
  await promise; assert.equal(listing(env.sqlite).current_bid_usd, 101); clean(env.sqlite);
});

test('server namespace leaves operator receipts isolated and detects replay', async t => {
  const env=database(t); seed(env.sqlite); await env.store.acquire(); const input=receipt();
  await importChangeBatch({db:env.db,store:env.store,receipt:input,namespace:'server'});
  assert.equal(checkpoint(env.sqlite),undefined);
  const again=await importChangeBatch({db:env.db,store:env.store,receipt:input,namespace:'server'});
  assert.equal(again.alreadyApplied,true); assert.equal(listing(env.sqlite).current_bid_usd,101);
  await assert.rejects(()=>importChangeBatch({db:env.db,store:env.store,receipt:input,namespace:'unknown'}),/NAMESPACE_INVALID/);
});

test('server compact decisions retain every counter and queued identity while file evidence remains complete', async t => {
  const server=database(t), file=database(t), groups=[];
  for(let index=0;index<100;index++){
    const lot=String(10000000+index);
    if(index!==96&&index!==99){seed(server.sqlite,lot);seed(file.sqlite,lot);}
    const extra=index===97?{vehicle:{platform:'copart',lot_number:lot,vin:OTHER_VIN}}
      :index===99?{event:'lot.removed',terminal:true}:{};
    const after=index===98?{'pricing.current_bid_usd':900,'details.color':'Red'}:{'pricing.current_bid_usd':900};
    groups.push(group([event(index+1,lot,after,extra)]));
  }
  await server.store.acquire();await file.store.acquire();const input=receipt(groups);
  const compact=await importChangeBatch({db:server.db,store:server.store,receipt:input,namespace:'server'});
  const full=await apply(file,input);
  assert.equal(compact.audit.decisionScope,'queued_only');assert.equal(Object.hasOwn(full.audit,'decisionScope'),false);
  assert.equal(full.audit.decisions.length,100);assert.equal(compact.audit.decisions.length,3);
  assert.deepEqual(compact.audit.decisions,full.audit.decisions.filter(decision=>decision.queued));
  const {decisionScope,decisions,...compactFields}=compact.audit,{decisions:fullDecisions,...fullFields}=full.audit;
  assert.deepEqual(compactFields,fullFields);assert.deepEqual(compact.state,full.state);
  assert.equal(compact.audit.updatedGroups,97);assert.equal(compact.audit.queuedGroups,3);
  assert.equal(compact.audit.identityErrors,1);assert.equal(compact.audit.ignoredEvents,1);
  assert.deepEqual(server.sqlite.prepare('SELECT * FROM auction_listings ORDER BY listing_id').all(),file.sqlite.prepare('SELECT * FROM auction_listings ORDER BY listing_id').all());
  assert.deepEqual(tasks(server.sqlite),tasks(file.sqlite));
  const stored=server.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").get().cursor;
  assert.equal(stored,JSON.stringify(compact.audit));
  const batches=server.calls.batches.length;
  const replay=await importChangeBatch({db:server.db,store:server.store,receipt:input,namespace:'server'});
  assert.equal(replay.alreadyApplied,true);assert.deepEqual(replay.audit,compact.audit);assert.equal(server.calls.batches.length,batches);
  const compactBytes=Buffer.byteLength(stored),fullBytes=Buffer.byteLength(JSON.stringify(full.audit));
  assert.ok(compactBytes<fullBytes/10);
  t.diagnostic(`100-group mixed audit: file=${fullBytes} bytes, server=${compactBytes} bytes, saved=${(100*(1-compactBytes/fullBytes)).toFixed(1)}%`);
  clean(server.sqlite);clean(file.sqlite);
});

test('server price-only audit is compact and legacy complete server audits still replay without rewriting', async t => {
  const env=database(t),groups=Array.from({length:100},(_,index)=>{
    const lot=String(10000000+index);seed(env.sqlite,lot);return group([event(index+1,lot)]);
  });
  await env.store.acquire();const input=receipt(groups);
  const result=await importChangeBatch({db:env.db,store:env.store,receipt:input,namespace:'server'});
  assert.deepEqual(result.audit.decisions,[]);assert.equal(result.audit.updatedGroups,100);assert.equal(result.audit.plannedPatches,100);
  assert.equal(result.audit.events,100);assert.equal(result.audit.end,100);assert.equal(result.audit.decisionScope,'queued_only');
  const bytes=Buffer.byteLength(JSON.stringify(result.audit));assert.ok(bytes<600);t.diagnostic(`100 pure-price groups: server audit=${bytes} bytes`);
  const legacy={...result.audit,decisions:groups.map((g,index)=>({platform:g.platform,lot:g.lot,events:1,firstSequence:index+1,lastSequence:index+1,
    quarantinedSequences:[],updated:true,queued:false,identityError:false,reasons:[]}))};delete legacy.decisionScope;
  const serialized=JSON.stringify(legacy);
  env.sqlite.prepare("UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key LIKE 'server-feed-batch:%'").run(serialized);
  const batches=env.calls.batches.length;
  const replay=await importChangeBatch({db:env.db,store:env.store,receipt:input,namespace:'server'});
  assert.equal(replay.alreadyApplied,true);assert.deepEqual(replay.audit,legacy);assert.equal(env.calls.batches.length,batches);
  assert.equal(env.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'server-feed-batch:%'").get().cursor,serialized);
  clean(env.sqlite);
});
test('full-record VIN conflict prevents partial price mutation and retains identity task', async t => {
  const env=database(t);seed(env.sqlite);await env.store.acquire();
  const input=receipt([group([event(1,LOT,{'pricing.current_bid_usd':900}, {record:{platform:'copart',lot_number:LOT,vin:OTHER_VIN}})])]);
  const result=await apply(env,input);assert.equal(result.audit.identityErrors,1);
  assert.equal(listing(env.sqlite).current_bid_usd,100);assert.equal(tasks(env.sqlite)[0].status,'identity_error');clean(env.sqlite);
});

function seedPendingTask(sqlite, overrides = {}, lot = LOT) {
  const value = {task_key:`reconcile:copart:${lot}`,platform:'copart',listing_id:`listing-${lot}`,cursor:lot,
    next_due_at:OLD,last_attempt_at:OLD,status:'pending',failures:0,last_error_code:null,...overrides};
  sqlite.prepare(`INSERT INTO automatic_refresh_tasks(${Object.keys(value)}) VALUES(${Object.keys(value).map(()=>'?')})`).run(...Object.values(value));
  return tasks(sqlite).find(r=>r.task_key===value.task_key);
}
function countTaskUpdates(sqlite) {
  sqlite.exec("CREATE TEMP TABLE counted_task_updates (task_key TEXT); CREATE TEMP TRIGGER count_reconcile_updates AFTER UPDATE ON automatic_refresh_tasks WHEN NEW.task_key LIKE 'reconcile:%' BEGIN INSERT INTO counted_task_updates VALUES(NEW.task_key); END;");
  return ()=>sqlite.prepare('SELECT COUNT(*) n FROM counted_task_updates').get().n;
}
for(const scenario of [
  {name:'already due',values:{},skip:true},
  {name:'failure backoff',values:{next_due_at:'2026-10-28T14:00:00.000Z',failures:2,last_error_code:'TIMEOUT'},skip:true},
  {name:'future work without backoff',values:{next_due_at:'2026-10-28T14:00:00.000Z'},skip:false},
  {name:'completed work',values:{status:'complete'},skip:false},
  {name:'newly resolved listing',values:{listing_id:null},skip:false},
  {name:'identity quarantine',values:{status:'identity_error',failures:2,last_error_code:'INVENTORY_CHANGE_IDENTITY_CONFLICT'},skip:false}
]) test(`server pending coalescing: ${scenario.name}`,async t=>{
  const env=database(t);seed(env.sqlite);const before=seedPendingTask(env.sqlite,scenario.values),updates=countTaskUpdates(env.sqlite);
  await env.store.acquire();const input=receipt([group([event(1,LOT,{'pricing.current_bid_usd':900,'details.color':'Red'})])]);
  const result=await importChangeBatch({db:env.db,store:env.store,receipt:input,namespace:'server'});
  assert.equal(listing(env.sqlite).current_bid_usd,900);assert.equal(result.audit.queuedGroups,1);assert.equal(updates(),scenario.skip?0:1);
  const after=tasks(env.sqlite)[0];
  if(scenario.skip)assert.deepEqual(after,before);
  else if(scenario.name==='identity quarantine')assert.equal(after.status,'identity_error');
  else {assert.equal(after.status,'pending');assert.equal(after.listing_id,`listing-${LOT}`);assert.equal(after.next_due_at,AT);}
  const replay=await importChangeBatch({db:env.db,store:env.store,receipt:input,namespace:'server'});
  assert.equal(replay.alreadyApplied,true);assert.equal(updates(),scenario.skip?0:1);clean(env.sqlite);
});
test('server coalesces 100 pending row rewrites while file import and prices retain their behavior',async t=>{
 const server=database(t),file=database(t),groups=[];
 for(let i=0;i<100;i++){const lot=String(10000000+i);for(const env of [server,file]){seed(env.sqlite,lot);seedPendingTask(env.sqlite,{},lot);}groups.push(group([event(i+1,lot,{'pricing.current_bid_usd':900,'details.color':'Red'})]));}
 const serverUpdates=countTaskUpdates(server.sqlite),fileUpdates=countTaskUpdates(file.sqlite);await server.store.acquire();await file.store.acquire();
 const input=receipt(groups),a=await importChangeBatch({db:server.db,store:server.store,receipt:input,namespace:'server'}),b=await apply(file,input);
 assert.equal(serverUpdates(),0);assert.equal(fileUpdates(),100);assert.equal(a.audit.queuedGroups,b.audit.queuedGroups);assert.equal(a.audit.updatedGroups,100);
 assert.deepEqual(server.sqlite.prepare('SELECT * FROM auction_listings ORDER BY listing_id').all(),file.sqlite.prepare('SELECT * FROM auction_listings ORDER BY listing_id').all());
 t.diagnostic('100 repeated pending tasks: 100 row rewrites avoided; all 100 price changes preserved. D1 index savings require production measurement.');clean(server.sqlite);clean(file.sqlite);
});
