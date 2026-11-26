'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {
  ImprovementJournal, planCampaign, buildDiscoverySpec, runDetailTarget,
  runDiscoveryScope, runHistoryPages, digest
} = require('../scripts/catalog-improvement-campaign-20261020.cjs');
const {createApibaraProvider} = require('../providers/apibara.js');
const {prepareObservation} = require('../sync/publication-refresh.cjs');
const {D1SyncRepository, knownObservationStatements} = require('../sync/d1-repository.js');
const {POLICY} = require('../sync/automatic-refresh.cjs');
const provider = createApibaraProvider();
const targetId = 'c8a30088-70af-43a6-9a7f-c4018279d37d';
const vin = '5YJ3E1EA4NF186754';
const at = '2026-10-20T16:00:00.000Z';
const before = '2026-10-08T10:00:00.000Z';
const fixture = require('./fixtures/apibara-discovery-page-shape.json').response.data[0];
const raw = (lot = '43806658', bid = 0) => ({...structuredClone(fixture), platform: 'iaai',
  lot_number: lot, vin, slug_vin: 'source-' + vin,
  auction: {state: 'active', formatted: 'Pre-bid', auction_at: '2026-10-21T16:00:00Z'},
  pricing: {current_bid_usd: bid, buy_now_price_usd: 2000}, history: []});
const usage = (left = 5000) => ({ok: true, data: {
  quota: {used: 30000 - left, limit: 30000, left}, plan: {name: 'Basic', per_page_limit: 20}
}});
const event = (day = 1) => ({platform: 'iaai', lot_number: '43806658',
  date: '2026-10-' + String(day).padStart(2, '0'), price: 100, status: 'Sold on Approval'});

function journal(t, override = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rexbid-improvement-'));
  let j;
  t.after(() => {
    if (j) j.close();
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  const config = {directory, campaignId: 'improvement-test', targetId, targetHash: 'fixed',
    maxRequests: 50, baseAttempts: 5023, now: () => Date.parse(at), ...override};
  j = new ImprovementJournal(config);
  return {j, config, directory};
}
function database(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(__dirname, '../docs/proposals/0004_d1_sync_2.sql'), 'utf8'));
  sql.exec('PRAGMA foreign_keys=ON');
  const db = {identity: {id: targetId}, prepare(query) {
    return {sql: query, params: [], bind(...params) { return {...this, params}; },
      async all() { return {results: sql.prepare(query).all(...this.params)}; },
      async first() { return sql.prepare(query).get(...this.params) || null; }};
  }, async batch(items) {
    sql.exec('BEGIN');
    try {
      const result = items.map(item => /^\s*SELECT/i.test(item.sql)
        ? {results: sql.prepare(item.sql).all(...item.params), meta: {changes: 0}}
        : {meta: {changes: Number(sql.prepare(item.sql).run(...item.params).changes)}});
      sql.exec('COMMIT'); return result;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  }};
  t.after(() => sql.close());
  return {db, sql};
}
async function seed(db, value = raw()) {
  const prepared = await prepareObservation({repo: new D1SyncRepository(db), provider, raw: value,
    platform: value.platform, observedAt: before, processedAt: before, freshnessPolicy: POLICY});
  const statements = await knownObservationStatements(db, prepared.record);
  await db.batch(statements.statements);
  return {platform: value.platform, lot: String(value.lot_number), vin_normalized: value.vin,
    listing_id: prepared.record.identity.listingId, provider_vehicle_id: value.slug_vin};
}
async function ready(j) { await j.refreshQuota(async () => usage()); }
const transportOptions = {wait: async () => {}};
const beforeWrite = async () => {};

test('immutable manifest, exclusive lock and campaign counters survive a clean resume', async t => {
  const {j, config} = journal(t);
  assert.throws(() => new ImprovementJournal(config), /EEXIST/);
  await ready(j); j.close();
  const resumed = new ImprovementJournal(config);
  assert.equal(resumed.counters().attempts, 1);
  assert.equal(resumed.counters().combinedAttempts, 5024);
  resumed.close();
  assert.throws(() => new ImprovementJournal({...config, maxRequests: 51}), /MANIFEST_CHANGED/);
});
test('fresh quota is required, reserve includes usage uncertainty and every retry is counted', async t => {
  const {j} = journal(t); let calls = 0;
  const invoke = () => j.execute('a', {operation: 'vehicleByIdentifier'}, async () => {
    calls++; if (calls === 1) throw Object.assign(Error('TIMEOUT'), {code: 'TIMEOUT', status: 504});
    return {ok: true};
  }, async () => ({status: 'committed'}), transportOptions);
  await assert.rejects(invoke(), /FRESH_QUOTA_REQUIRED/);
  assert.equal(calls, 0);
  await j.refreshQuota(async () => usage(503));
  await invoke();
  assert.equal(j.counters().attempts, 3);
  assert.equal(j.counters().retries, 1);
  await assert.rejects(j.execute('b', {operation: 'vehicleHistory'}, async () => {
    calls++; return {ok: true};
  }, async () => ({status: 'committed'})), /QUOTA_RESERVE/);
  assert.equal(calls, 2);
});
test('expired quota blocks transport and is renewed without resetting counters', async t => {
  let now = Date.parse(at);
  const {j} = journal(t, {now: () => now, quotaMaxAgeMs: 1000});
  await ready(j); now += 1001;
  await assert.rejects(j.execute('a', {operation: 'vehicleHistory'}, async () => ({ok: true}),
    async () => ({status: 'committed'})), /FRESH_QUOTA/);
  await ready(j);
  await j.execute('a', {operation: 'vehicleHistory'}, async () => ({ok: true}),
    async () => ({status: 'committed'}));
  assert.equal(j.counters().attempts, 3);
});
test('an individual NOT_FOUND does not stop other targets; authentication and429 latch STOP', async t => {
  const {j} = journal(t); await ready(j);
  const failed = await j.execute('missing', {operation: 'vehicleByIdentifier'}, async () => {
    throw Object.assign(Error('NOT_FOUND'), {code: 'NOT_FOUND', status: 404});
  }, async () => { throw Error('must not consume'); });
  assert.equal(failed.status, 'failed');
  await j.execute('next', {operation: 'vehicleByIdentifier'}, async () => ({ok: true}),
    async () => ({status: 'committed'}));
  await assert.rejects(j.execute('throttled', {operation: 'vehicleHistory'}, async () => {
    throw Object.assign(Error('RATE_LIMITED'), {code: 'RATE_LIMITED', status: 429});
  }, async () => ({})), /RATE_LIMITED/);
  assert.equal(j.counters().attempts, 4);
  await assert.rejects(j.refreshQuota(async () => usage()), /STOP_LATCH/);
});
test('persistence failure keeps the receipt and replays its original timestamp without transport', async t => {
  const {j, config, directory} = journal(t); await ready(j); let calls = 0;
  await assert.rejects(j.execute('detail', {operation: 'vehicleByIdentifier'}, async () => {
    calls++; return {ok: true, data: {retained: true}};
  }, async () => { throw Error('IMPROVEMENT_WRITE_FAILED'); }), /WRITE_FAILED/);
  assert.equal(calls, 1); j.close();
  // Explicit operator recovery after resolving the failed write.
  fs.unlinkSync(path.join(directory, 'improvement-stop.json'));
  const resumed = new ImprovementJournal({...config, now: () => Date.parse(at) + 600000});
  const result = await resumed.execute('detail', {operation: 'vehicleByIdentifier'}, async () => {
    calls++; throw Error('must not fetch');
  }, async receipt => ({status: 'committed', observedAt: receipt.observedAt}));
  assert.equal(result.observedAt, at); assert.equal(calls, 1);
  assert.equal(resumed.counters().attempts, 2); resumed.close();
});
test('durable response file recovers a crash before receipt ledger append', async t => {
  const {j, config, directory} = journal(t); await ready(j);
  const spec = {operation: 'vehicleHistory'}, number = 2, key = 'history';
  j.append({kind: 'attempt', number, key, operation: spec.operation, specHash: digest(spec)});
  fs.writeFileSync(path.join(directory, 'response-2.json'),
    JSON.stringify({number, key, specHash: digest(spec), observedAt: at, response: {ok: true}}));
  j.close();
  const resumed = new ImprovementJournal(config); let calls = 0;
  await resumed.execute(key, spec, async () => { calls++; },
    async () => ({status: 'committed'}));
  assert.equal(calls, 0);
  assert.equal(resumed.rows.find(row => row.kind === 'response' && row.number === 2).recovered, true);
  resumed.close();
});
test('uncertain network reservation and corrupted stored response cannot silently retry', async t => {
  const {j, config} = journal(t); await ready(j);
  j.append({kind: 'attempt', number: 2, key: 'unknown', operation: 'vehicleHistory', specHash: 'x'});
  j.close(); assert.throws(() => new ImprovementJournal(config), /UNCERTAIN_NETWORK/);
});
test('finite request limit counts usage and does not permit retry number over cap', async t => {
  const {j} = journal(t, {maxRequests: 2}); await ready(j); let calls = 0;
  await assert.rejects(j.execute('a', {operation: 'vehicleHistory'}, async () => {
    calls++; throw Object.assign(Error('UPSTREAM'), {code: 'UPSTREAM', status: 503});
  }, async () => ({}), transportOptions), /REQUEST_LIMIT/);
  assert.equal(calls, 1); assert.equal(j.counters().attempts, 2);
});
test('planning prioritizes current timed and upcoming rows and explicit missing make scopes', () => {
  const rows = [{listing_id: 'old', platform: 'iaai', lot: '1', auction_state: 'finished'},
    {listing_id: 'active', platform: 'copart', lot: '2', auction_state: 'active'},
    {listing_id: 'timed', platform: 'iaai', lot: '3', auction_state: 'active', is_timed: 1}];
  const plan = planCampaign(rows, {now: Date.parse(at), missingMakes: ['BMW', 'BMW']});
  assert.deepEqual(plan.details.map(row => row.listing_id), ['timed', 'active', 'old']);
  assert.equal(plan.discovery.length, 8);
  assert.deepEqual(buildDiscoverySpec({platform: 'copart', category: 'timed', make: 'BMW'}).params,
    {platform: 'copart', per_page: 20, lot_sub_status: 'Open', upcoming: 'all', lot_status: 'Timed', make: 'BMW'});
  assert.throws(() => planCampaign([...rows, rows[0]]), /DUPLICATE/);
});
test('detail preserves numeric zero, null clears bid, included history stores conditional price safely', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const target = await seed(db, raw('43806658', 100));
  const value = raw(); value.history = [event()];
  const result = await runDetailTarget({db, provider, journal: j, target, knownRows: [target],
    transport: async () => ({ok: true, data: value}), beforeWrite});
  assert.equal(result.history.complete, true);
  assert.equal(sql.prepare('SELECT current_bid_usd FROM auction_listings').get().current_bid_usd, 0);
  assert.equal(sql.prepare('SELECT final_price_usd FROM auction_events').get().final_price_usd, null);
  assert.equal(sql.prepare('SELECT detail_synced_at FROM auction_listings').get().detail_synced_at, at);
  const other = await seed(db, raw('43806659', 100));
  await runDetailTarget({db, provider, journal: j, target: other, knownRows: [other],
    transport: async () => ({ok: true, data: raw('43806659', null)}), beforeWrite});
  assert.equal(sql.prepare("SELECT current_bid_usd FROM auction_listings WHERE lot='43806659'").get().current_bid_usd, null);
});
test('foreign detail identity skips one item, preserves dates/history, and subsequent detail proceeds', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const target = await seed(db), other = await seed(db, raw('43806659'));
  const old = JSON.stringify(sql.prepare('SELECT * FROM auction_listings WHERE lot=?').get(target.lot));
  const result = await runDetailTarget({db, provider, journal: j, target, knownRows: [target, other],
    transport: async () => ({ok: true, data: {...raw(), platform: 'copart'}}), beforeWrite});
  assert.equal(result.status, 'rejected');
  assert.equal(JSON.stringify(sql.prepare('SELECT * FROM auction_listings WHERE lot=?').get(target.lot)), old);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n, 0);
  const source = sql.prepare('SELECT last_attempt_at,last_success_at,last_error_code,sync_status FROM vehicle_sources WHERE source_key=(SELECT source_key FROM auction_listings WHERE listing_id=?)').get(target.listing_id);
  assert.equal(source.last_attempt_at, at);
  assert.equal(source.last_success_at, before);
  assert.equal(source.last_error_code, 'CATALOG_DETAIL_IDENTITY_MISMATCH');
  assert.equal(source.sync_status, 'failed');
  assert.equal((await runDetailTarget({db, provider, journal: j, target: other, knownRows: [target, other],
    transport: async () => ({ok: true, data: raw(other.lot)}), beforeWrite})).status, 'committed');
});
test('discovery applies current filters, stores20 summaries per call and resumes its exact cursor', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const cursors = [];
  const transport = async spec => {
    cursors.push(spec.params.cursor ?? null);
    return {ok: true, data: [raw(spec.params.cursor ? '43806659' : '43806658')],
      meta: {next_cursor: spec.params.cursor ? null : 'opaque+/='}};
  };
  const args = {db, provider, journal: j, scope: {platform: 'iaai', category: 'open', make: 'Tesla'},
    transport, beforeWrite, maxPages: 1};
  assert.equal((await runDiscoveryScope(args)).result.complete, false);
  assert.equal((await runDiscoveryScope(args)).result.complete, true);
  assert.equal((await runDiscoveryScope(args)).result.replayed, true);
  assert.deepEqual(cursors, [null, 'opaque+/=']);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 2);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_listings WHERE detail_synced_at IS NOT NULL').get().n, 0);
});
test('discovery keeps rejected prior pages partial within one call and across restart', async t => {
  const {j} = journal(t), {db} = database(t); await ready(j);
  const args = {db, provider, journal: j, scope: {platform: 'iaai', category: 'open'},
    beforeWrite, maxPages: 2, transport: async spec => spec.params.cursor
      ? {ok: true, data: [raw('43806659')], meta: {next_cursor: null}}
      : {ok: true, data: [{...raw(), platform: 'copart'}], meta: {next_cursor: 'p2'}}};
  const result = await runDiscoveryScope(args);
  assert.equal(result.pages, 2);
  assert.equal(result.result.complete, false);
  assert.equal((await runDiscoveryScope(args)).result.complete, false);
});
test('discovery interrupted writes retain insert cap and counts when replayed from response', async t => {
  const {j, config, directory} = journal(t), {db, sql} = database(t); await ready(j);
  let calls = 0, writes = 0;
  const transport = async () => {
    calls++; return {ok: true, data: [raw(), raw('43806659'), raw('43806660')], meta: {next_cursor: null}};
  };
  const args = {db, provider, journal: j, scope: {platform: 'iaai', category: 'open'}, maxNew: 2,
    transport, beforeWrite: async () => { if (++writes === 2) throw Error('write interruption'); }};
  await assert.rejects(runDiscoveryScope(args), /WRITE_FAILED/);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 1);
  j.close(); fs.unlinkSync(path.join(directory, 'improvement-stop.json'));
  const resumed = new ImprovementJournal(config);
  const result = await runDiscoveryScope({...args, journal: resumed, beforeWrite});
  assert.equal(result.result.inserted, 2);
  assert.equal(result.result.updated, 0);
  assert.equal(result.result.capped, 1);
  assert.equal(calls, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 2);
  await assert.rejects(runDiscoveryScope({...args, journal: resumed, maxNew: 3}), /SCOPE_LIMIT_CHANGED/);
  resumed.close();
});
test('discovery platform case variants cannot duplicate a page identity', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  await assert.rejects(runDiscoveryScope({db, provider, journal: j,
    scope: {platform: 'iaai', category: 'open'}, beforeWrite,
    transport: async () => ({ok: true, data: [raw(), {...raw(), platform: 'IAAI'}], meta: {next_cursor: null}})
  }), /DUPLICATE_PAGE_IDENTITY/);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 0);
});
test('discovery identity mismatch skips only that row and no invalid page proves completeness', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const result = await runDiscoveryScope({db, provider, journal: j,
    scope: {platform: 'iaai', category: 'open'}, beforeWrite,
    transport: async () => ({ok: true, data: [raw(), {...raw('43806659'), platform: 'copart'}],
      meta: {next_cursor: null}})});
  assert.equal(result.result.inserted, 1);
  assert.equal(result.result.rejected.length, 1);
  assert.equal(result.result.complete, false);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 1);
});
test('discovery checks every visible masked VIN character before reusing platform and LOT', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  await seed(db);
  sql.prepare('UPDATE auction_listings SET vin_normalized=?').run('5YJ3E1EA4NF18****');
  const initial = JSON.stringify(sql.prepare('SELECT * FROM auction_listings').all());
  const result = await runDiscoveryScope({db, provider, journal: j,
    scope: {platform: 'iaai', category: 'open'}, beforeWrite,
    transport: async () => ({ok: true, data: [{...raw(), vin: 'W1KCG4EB1NA018119'}], meta: {next_cursor: null}})
  });
  assert.equal(result.result.rejected[0].code, 'CATALOG_DETAIL_IDENTITY_MISMATCH');
  assert.equal(result.result.complete, false);
  assert.equal(JSON.stringify(sql.prepare('SELECT * FROM auction_listings').all()), initial);
});
test('discovery repeated cursor is systemic and rejected before any write on offending page', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const args = {db, provider, journal: j, scope: {platform: 'iaai', category: 'open'}, beforeWrite,
    transport: async spec => ({ok: true, data: [raw(spec.params.cursor ? '43806659' : '43806658')],
      meta: {next_cursor: 'repeated'}})};
  await runDiscoveryScope(args);
  await assert.rejects(runDiscoveryScope(args), /REPEATED_CURSOR/);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n, 1);
});
test('history follows only observed continuation and preserves unresolved records across pages', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const target = await seed(db);
  const detail = raw();
  detail.history = {data: [event(), {...event(2), lot_number: '99999999'}], meta: {next_cursor: 'h2'}};
  const args = {db, provider, journal: j, target, knownRows: [target], beforeWrite};
  await runDetailTarget({...args, transport: async () => ({ok: true, data: detail})});
  const result = await runHistoryPages({...args, transport: async spec => {
    assert.equal(spec.cursor, 'h2');
    return {ok: true, data: {vehicle: raw(), history: [event(3)]}, meta: {next_cursor: null}};
  }});
  assert.equal(result.pages, 1);
  assert.equal(result.history.complete, false);
  assert.equal(result.history.unresolved, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n, 2);
  assert.equal(sql.prepare("SELECT status FROM provider_sync_scopes WHERE operation='history_refresh'").get().status, 'partial');
});
test('included history obeys top-level continuation metadata rather than declaring an empty complete result', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const target = await seed(db);
  const args = {db, provider, journal: j, target, knownRows: [target], beforeWrite};
  const result = await runDetailTarget({...args,
    transport: async () => ({ok: true, data: raw(), meta: {next_cursor: 'top-level-history'}})});
  assert.equal(result.history.complete, false);
  assert.equal(result.history.nextCursor, 'top-level-history');
  assert.equal(sql.prepare("SELECT status FROM provider_sync_scopes WHERE operation='history_refresh'").get().status, 'partial');
  const continuation = await runHistoryPages({...args, transport: async spec => {
    assert.equal(spec.cursor, 'top-level-history');
    return {ok: true, data: [], meta: {next_cursor: null}};
  }});
  assert.equal(continuation.history.complete, true);
});
test('history failure cannot restamp confirmed old history or convert it to empty', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const target = await seed(db), value = raw();
  value.history = {data: [event()], meta: {next_cursor: 'h2'}};
  const args = {db, provider, journal: j, target, knownRows: [target], beforeWrite};
  await runDetailTarget({...args, transport: async () => ({ok: true, data: value})});
  const historyBefore = JSON.stringify(sql.prepare('SELECT * FROM auction_events').all());
  const result = await runHistoryPages({...args, transport: async () => ({
    ok: true, data: {vehicle: {...raw(), vin: 'W1KCG4EB1NA018119'}, history: []}, meta: {next_cursor: null}
  })});
  assert.equal(result.history.status, 'rejected');
  assert.equal(JSON.stringify(sql.prepare('SELECT * FROM auction_events').all()), historyBefore);
});
test('write failure stops all further transport and exact database and writer guards are required', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const target = await seed(db);
  const args = {db, provider, journal: j, target, knownRows: [target],
    transport: async () => ({ok: true, data: raw()})};
  await assert.rejects(runDetailTarget(args), /WRITE_GUARD_REQUIRED/);
  await assert.rejects(runDetailTarget({...args, db: {...db, identity: {id: 'wrong'}}, beforeWrite}), /DATABASE_MISMATCH/);
  sql.exec("CREATE TRIGGER deny_listing BEFORE UPDATE ON auction_listings BEGIN SELECT RAISE(ABORT,'fixture write error'); END");
  await assert.rejects(runDetailTarget({...args, beforeWrite}), /WRITE_FAILED/);
  assert.equal(sql.prepare('SELECT summary_synced_at FROM auction_listings').get().summary_synced_at, before);
  await assert.rejects(j.refreshQuota(async () => usage()), /STOP_LATCH/);
});

test('detail write and complete listing/fingerprint readback share one atomic batch', async t => {
  const {j} = journal(t), {db, sql} = database(t); await ready(j);
  const zeroTarget = await seed(db, raw('43806658', 100));
  const nullTarget = await seed(db, raw('43806659', 100));
  const snapshotsBefore = sql.prepare('SELECT * FROM auction_listing_snapshots ORDER BY snapshot_id').all();
  const originalBatch = db.batch, originalPrepare = db.prepare, batches = [], directReads = [];
  db.prepare = function(query) {
    const statement = originalPrepare.call(db, query);
    const all = statement.all, first = statement.first;
    statement.all = async function() { directReads.push(query); return all.call(this); };
    statement.first = async function() { directReads.push(query); return first.call(this); };
    return statement;
  };
  db.batch = async items => { batches.push(items); return originalBatch(items); };
  for (const [target,bid] of [[zeroTarget,0],[nullTarget,null]]) {
    const value = raw(target.lot, bid);
    const result = await runDetailTarget({db, provider, journal:j, target, knownRows:[target],
      transport:async()=>({ok:true,data:value}), beforeWrite});
    assert.equal(result.status,'committed');
    const saved = sql.prepare('SELECT * FROM auction_listings WHERE listing_id=?').get(target.listing_id);
    assert.equal(saved.current_bid_usd,bid);
    assert.equal(saved.summary_synced_at,at); assert.equal(saved.detail_synced_at,at);
  }
  const observationBatches = batches.filter(items => items.some(item => /INSERT INTO auction_listing_snapshots/.test(item.sql)));
  assert.equal(observationBatches.length,2);
  for (const batch of observationBatches) {
    assert.equal(batch.length,5);
    assert.match(batch.at(-1).sql,/SELECT l\.\*,/);
    assert.match(batch.at(-1).sql,/AS latest_snapshot_fingerprint/);
    assert.match(batch[3].sql,/UPDATE auction_listings SET detail_synced_at/);
  }
  assert.equal(directReads.some(query => /latest_snapshot_fingerprint|SELECT fingerprint FROM auction_listing_snapshots|SELECT \* FROM auction_listings WHERE listing_id/.test(query)),false);
  for (const old of snapshotsBefore) assert.deepEqual(
    sql.prepare('SELECT * FROM auction_listing_snapshots WHERE snapshot_id=?').get(old.snapshot_id),old);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,4);
  const count=batches.length,reads=directReads.length;
  const replay=await runDetailTarget({db,provider,journal:j,target:zeroTarget,knownRows:[zeroTarget],
    transport:async()=>{throw Error('UNEXPECTED_PROVIDER_CALL');},beforeWrite});
  assert.equal(replay.replayed,true);assert.equal(batches.length,count);assert.equal(directReads.length,reads);
});

for (const [label,change,expectedCode] of [
  ['missing row',rows=>rows.length=0,'IMPROVEMENT_LISTING_READBACK_FAILED'],
  ['platform',rows=>rows[0].platform='copart','IMPROVEMENT_LISTING_READBACK_FAILED'],
  ['lot',rows=>rows[0].lot='99999999','IMPROVEMENT_LISTING_READBACK_FAILED'],
  ['VIN',rows=>rows[0].vin_normalized='1HGCM82633A004352','IMPROVEMENT_LISTING_READBACK_FAILED'],
  ['observation time',rows=>rows[0].summary_synced_at=before,'IMPROVEMENT_LISTING_READBACK_FAILED'],
  ['detail time',rows=>rows[0].detail_synced_at=before,'IMPROVEMENT_LISTING_READBACK_FAILED'],
  ['current bid',rows=>rows[0].current_bid_usd=null,'IMPROVEMENT_LISTING_READBACK_FAILED'],
  ['buy now',rows=>rows[0].buy_now_usd=9999,'IMPROVEMENT_LISTING_READBACK_FAILED'],
  ['snapshot fingerprint',rows=>rows[0].latest_snapshot_fingerprint='wrong','IMPROVEMENT_SNAPSHOT_READBACK_FAILED']
]) {
  test('atomic readback still rejects incorrect '+label+' and halts before history or another provider call',async t=>{
    const {j}=journal(t),{db,sql}=database(t);await ready(j);
    const target=await seed(db,raw('43806658',100));
    const originalBatch=db.batch;
    let calls=0;
    db.batch=async items=>{
      const results=await originalBatch(items);
      if(/AS latest_snapshot_fingerprint/.test(items.at(-1).sql)) change(results.at(-1).results);
      return results;
    };
    await assert.rejects(runDetailTarget({db,provider,journal:j,target,knownRows:[target],
      transport:async()=>{calls++;return {ok:true,data:raw()};},beforeWrite}),
    error=>error.message==='IMPROVEMENT_WRITE_FAILED'&&error.cause?.message===expectedCode);
    assert.equal(calls,1);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM provider_sync_scopes WHERE operation='history_refresh'").get().n,0);
    await assert.rejects(j.refreshQuota(async()=>{calls++;return usage();}),/STOP_LATCH/);
    assert.equal(calls,1);
  });
}

test('a verified full VIN upgrades only the immutable own target and anchors every continuation page', async t => {
  const {j}=journal(t),{db,sql}=database(t);await ready(j);
  const masked='5YJ3E1EA4NF******';
  const seedValue={...raw('43806658',100),vin:masked};
  const target=Object.freeze({...await seed(db,seedValue),provider_vehicle_id:null});
  const knownRows=Object.freeze([Object.freeze({...target})]);
  const originalTarget=JSON.stringify(target),originalRows=JSON.stringify(knownRows);
  const oldSnapshots=sql.prepare('SELECT * FROM auction_listing_snapshots').all();
  const value=raw();value.history={data:[event()],meta:{next_cursor:'own-history-page-2'}};
  let calls=0;
  const args={db,provider,journal:j,target,knownRows,beforeWrite};
  const detail=await runDetailTarget({...args,transport:async spec=>{
    calls++;assert.equal(spec.identifier,target.lot);return {ok:true,data:value};
  }});
  assert.equal(detail.status,'committed');assert.equal(detail.vin,vin);
  assert.equal(detail.historyError,null);assert.equal(detail.history.events,1);
  assert.equal(detail.history.nextCursor,'own-history-page-2');
  assert.equal(sql.prepare('SELECT vin_normalized FROM auction_listings').get().vin_normalized,vin);
  const continued=await runHistoryPages({...args,transport:async spec=>{
    calls++;assert.equal(spec.identifier,vin);assert.equal(spec.cursor,'own-history-page-2');
    return {ok:true,data:[event(2)],meta:{next_cursor:null}};
  }});
  assert.equal(continued.history.complete,true);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,2);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events WHERE vin_normalized=? AND final_price_usd IS NULL').get(vin).n,2);
  assert.equal(sql.prepare("SELECT status FROM provider_sync_scopes WHERE operation='history_refresh'").get().status,'complete');
  for(const old of oldSnapshots)assert.deepEqual(sql.prepare('SELECT * FROM auction_listing_snapshots WHERE snapshot_id=?').get(old.snapshot_id),old);
  const replay=await runDetailTarget({...args,transport:async()=>{throw Error('UNEXPECTED_PROVIDER_CALL');}});
  assert.equal(replay.replayed,true);
  assert.equal((await runHistoryPages({...args,transport:async()=>{throw Error('UNEXPECTED_PROVIDER_CALL');}})).pages,0);
  assert.equal(calls,2);assert.equal(JSON.stringify(target),originalTarget);assert.equal(JSON.stringify(knownRows),originalRows);
});

for(const [label,initialVin]of [['masked','5YJ3E1EA4NF******'],['full',vin]]){
  test('a conflicting full VIN cannot upgrade or import history for a '+label+' own target',async t=>{
    const {j}=journal(t),{db,sql}=database(t);await ready(j);
    const target=await seed(db,{...raw(),vin:initialVin});
    const beforeRows=sql.prepare('SELECT * FROM auction_listings').all();
    const beforeSnapshots=sql.prepare('SELECT * FROM auction_listing_snapshots').all();
    const value={...raw(),vin:'1HGCM82633A004352',history:[event()]};
    const result=await runDetailTarget({db,provider,journal:j,target,knownRows:[target],beforeWrite,
      transport:async()=>({ok:true,data:value})});
    assert.equal(result.status,'rejected');assert.equal(result.code,'CATALOG_DETAIL_IDENTITY_MISMATCH');
    assert.deepEqual(sql.prepare('SELECT * FROM auction_listings').all(),beforeRows);
    assert.deepEqual(sql.prepare('SELECT * FROM auction_listing_snapshots').all(),beforeSnapshots);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
  });
}

test('own VIN confirmation does not relax a related masked LOT or change the frozen queue',async t=>{
  const {j}=journal(t),{db,sql}=database(t);await ready(j);
  const masked='5YJ3E1EA4NF******';
  const target=await seed(db,{...raw(),vin:masked});
  const related=await seed(db,{...raw('43806659'),vin:masked});
  const knownRows=Object.freeze([Object.freeze({...target}),Object.freeze({...related})]);
  const originalRows=JSON.stringify(knownRows);
  const value=raw();value.history=[event(),{...event(2),lot_number:related.lot}];
  const result=await runDetailTarget({db,provider,journal:j,target,knownRows,beforeWrite,
    transport:async()=>({ok:true,data:value})});
  assert.equal(result.status,'committed');assert.equal(result.history,null);
  assert.equal(result.historyError,'CATALOG_HISTORY_IDENTITY_MISMATCH');
  assert.equal(sql.prepare('SELECT vin_normalized FROM auction_listings WHERE listing_id=?').get(related.listing_id).vin_normalized,masked);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
  assert.equal(JSON.stringify(knownRows),originalRows);
});
