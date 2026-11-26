'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {ImprovementJournal, runDetailTarget, runHistoryPages, runExactLotRecovery,
  runExactLotRecoveryHistoryPages, digest} = require('../scripts/catalog-improvement-campaign-20261020.cjs');
const {exactLotRecoveryOperation} = require('../scripts/catalog-exact-lot-request-20261020.cjs');
const {createApibaraProvider} = require('../providers/apibara.js');
const {prepareObservation} = require('../sync/publication-refresh.cjs');
const {D1SyncRepository, knownObservationStatements} = require('../sync/d1-repository.js');
const {POLICY} = require('../sync/automatic-refresh.cjs');
const provider = createApibaraProvider();
const vin = '5YJ3E1EA4NF186754', lot = '43806658';
const before = '2026-10-08T10:00:00.000Z', at = '2026-10-20T16:00:00.000Z';
const base = require('./fixtures/apibara-discovery-page-shape.json').response.data[0];
const raw = (patch = {}) => ({...structuredClone(base), platform: 'iaai', lot_number: lot,
  vin, slug_vin: 'stored-slug-' + vin, auction: {state: 'active', formatted: 'Pre-bid',
    auction_at: '2026-10-21T16:00:00Z'}, pricing: {current_bid_usd: 0, buy_now_price_usd: 2000},
  history: [], ...patch});
const event = (day = 1, eventLot = lot) => ({platform: 'iaai', lot_number: eventLot,
  date: '2026-10-' + String(day).padStart(2, '0'), price: 100, status: 'Sold on Approval'});
const beforeWrite = async () => {};

async function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rexbid-lot-recovery-'));
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(__dirname, '../docs/proposals/0004_d1_sync_2.sql'), 'utf8'));
  sql.exec('PRAGMA foreign_keys=ON');
  const metrics = {reads: 0, batches: 0};
  const db = {identity: {id: 'c8a30088-70af-43a6-9a7f-c4018279d37d'}, prepare(query) {
    return {sql: query, params: [], bind(...params) { return {...this, params}; },
      async all() { metrics.reads++; return {results: sql.prepare(query).all(...this.params)}; },
      async first() { metrics.reads++; return sql.prepare(query).get(...this.params) || null; }};
  }, async batch(items) {
    metrics.batches++; sql.exec('BEGIN');
    try {
      const result = items.map(item => /^\s*SELECT/i.test(item.sql)
        ? {results: sql.prepare(item.sql).all(...item.params), meta: {changes: 0}}
        : {meta: {changes: Number(sql.prepare(item.sql).run(...item.params).changes)}});
      sql.exec('COMMIT'); return result;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  }};
  const ctx = {directory, sql, db, metrics, time: Date.parse(at)};
  const config = {directory, campaignId: 'lot-recovery-test', targetId: db.identity.id,
    targetHash: 'immutable-targets', maxRequests: options.maxRequests || 100,
    now: () => ctx.time};
  ctx.journal = new ImprovementJournal(config);
  ctx.reopen = () => { ctx.journal.close(); ctx.journal = new ImprovementJournal(config); };
  t.after(() => {
    ctx.journal.close(); sql.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, {recursive: true, force: true});
  });
  await ctx.journal.refreshQuota(async () => ({ok: true, data: {
    quota: {used: 100, limit: 30000, left: 29900}, plan: {name: 'Basic', per_page_limit: 20}}}));
  const seeded = raw({vin: options.vin ?? vin, pricing: {current_bid_usd: 1500}});
  const prepared = await prepareObservation({repo: new D1SyncRepository(db), provider, raw: seeded,
    platform: 'iaai', observedAt: before, processedAt: before, freshnessPolicy: POLICY});
  await db.batch((await knownObservationStatements(db, prepared.record)).statements);
  ctx.target = Object.freeze({platform: 'iaai', lot, vin_normalized: seeded.vin,
    listing_id: prepared.record.identity.listingId, provider_vehicle_id: seeded.slug_vin});
  ctx.knownRows = Object.freeze([ctx.target]);
  ctx.args = extra => ({db, provider, journal: ctx.journal, target: ctx.target,
    knownRows: ctx.knownRows, beforeWrite, ...extra});
  ctx.originalKey = 'detail:' + digest(ctx.target);
  ctx.failOriginal = async (code = null) => {
    const result = await runDetailTarget(ctx.args({transport: async () => {
      if (code) throw Object.assign(Error(code), {code, status: 404});
      return {ok: true, data: raw({lot_number: '99999999'})};
    }}));
    ctx.originalOutcome = structuredClone(ctx.journal.outcome(ctx.originalKey));
    return result;
  };
  ctx.recoveryOperation = () => exactLotRecoveryOperation(ctx.target, {
    campaignId: ctx.journal.config.campaignId, key: ctx.originalKey,
    status: ctx.originalOutcome.result.status, code: ctx.originalOutcome.result.code});
  return ctx;
}

test('exact LOT recovery has its own dated attempt and preserves rejection, old snapshots and numeric zero', async t => {
  const ctx = await setup(t); await ctx.failOriginal();
  const snapshots = ctx.sql.prepare('SELECT * FROM auction_listing_snapshots').all();
  const value = raw({history: [event()]}); let calls = 0;
  const result = await runExactLotRecovery(ctx.args({transport: async spec => {
    calls++; assert.equal(spec.identifier, lot); assert.equal(spec.platform, 'iaai');
    return {ok: true, data: value};
  }}));
  assert.equal(result.status, 'committed'); assert.equal(result.history.complete, true);
  assert.deepEqual(ctx.journal.outcome(ctx.originalKey), ctx.originalOutcome);
  const recovery = ctx.recoveryOperation();
  assert.notEqual(recovery.key, ctx.originalKey);
  const attempt = ctx.journal.attempts().find(row => row.key === recovery.key);
  assert.equal(attempt.at, at); assert.equal(attempt.specHash, digest(recovery.spec));
  const receipt = JSON.parse(fs.readFileSync(ctx.journal.receiptPath(attempt.number), 'utf8'));
  assert.equal(receipt.observedAt, at); assert.equal(receipt.key, recovery.key);
  const row = ctx.sql.prepare('SELECT * FROM auction_listings').get();
  assert.equal(row.current_bid_usd, 0); assert.equal(row.summary_synced_at, at);
  assert.equal(row.detail_synced_at, at);
  for (const old of snapshots) assert.deepEqual(
    ctx.sql.prepare('SELECT * FROM auction_listing_snapshots WHERE snapshot_id=?').get(old.snapshot_id), old);
  assert.equal(ctx.sql.prepare('SELECT final_price_usd FROM auction_events').get().final_price_usd, null);
  const priorMetrics = {...ctx.metrics};
  const replay = await runExactLotRecovery(ctx.args({transport: async () => { calls++; throw Error('NO_FETCH'); }}));
  assert.equal(replay.replayed, true); assert.equal(calls, 1); assert.deepEqual(ctx.metrics, priorMetrics);
});

test('only the exact current journal rejection authorizes recovery; caller supplied history cannot fake it', async t => {
  const ctx = await setup(t); let calls = 0;
  const args = ctx.args({previous: {status: 'rejected', code: 'CATALOG_DETAIL_IDENTITY_MISMATCH'},
    transport: async () => { calls++; return {ok: true, data: raw()}; }});
  await assert.rejects(runExactLotRecovery(args), /LOT_RECOVERY_ORIGIN_REQUIRED/);
  await runDetailTarget(args);
  await assert.rejects(runExactLotRecovery(args), /LOT_RECOVERY_ORIGIN_INVALID/);
  assert.equal(calls, 1);
  await assert.rejects(runExactLotRecovery({...args, target: {...ctx.target, lot: '43806659'}}),
    /LOT_RECOVERY_ORIGIN_REQUIRED/);
});

for (const [label, patch] of [
  ['LOT', {lot_number: '99999999'}], ['platform', {platform: 'copart'}],
  ['full VIN', {vin: '5YJ3E1EA4NF186755'}], ['partial response VIN', {vin: '5YJ3E1EA4NF******'}]
]) {
  test('recovery rejects wrong ' + label + ' once and replay performs no transport or marker writes', async t => {
    const ctx = await setup(t); await ctx.failOriginal(); let calls = 0;
    const oldListing = ctx.sql.prepare('SELECT * FROM auction_listings').get();
    const result = await runExactLotRecovery(ctx.args({transport: async () => {
      calls++; return {ok: true, data: raw({...patch, history: [event()]})};
    }}));
    assert.equal(result.status, 'rejected'); assert.equal(result.code, 'CATALOG_DETAIL_IDENTITY_MISMATCH');
    assert.deepEqual(ctx.sql.prepare('SELECT * FROM auction_listings').get(), oldListing);
    assert.equal(ctx.sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n, 0);
    const metrics = {...ctx.metrics};
    const replay = await runExactLotRecovery(ctx.args({transport: async () => { calls++; throw Error('NO_FETCH'); }}));
    assert.equal(replay.replayed, true); assert.equal(calls, 1); assert.deepEqual(ctx.metrics, metrics);
    assert.equal(ctx.journal.rows.filter(row => row.kind === 'detail_failure_marked' && row.key === ctx.recoveryOperation().key).length, 1);
    assert.deepEqual(ctx.journal.outcome(ctx.originalKey), ctx.originalOutcome);
  });
}

for (const [code, status] of [['NOT_FOUND', 404], ['UPSTREAM', 503]]) {
  test('recovery ' + code + ' is terminal after one attempt even when retry is requested', async t => {
    const ctx = await setup(t); await ctx.failOriginal('NOT_FOUND'); let calls = 0;
    const args = ctx.args({transportOptions: {maxRetries: 1, wait: async () => { throw Error('NO_WAIT'); }},
      transport: async () => { calls++; throw Object.assign(Error(code), {code, status}); }});
    const result = await runExactLotRecovery(args);
    assert.equal(result.status, 'failed'); assert.equal(result.code, code);
    ctx.reopen();
    const replay = await runExactLotRecovery({...args, journal: ctx.journal});
    assert.equal(replay.replayed, true); assert.equal(calls, 1);
    assert.equal(ctx.journal.attempts().filter(row => row.key === ctx.recoveryOperation().key).length, 1);
  });
}

test('masked own VIN upgrades through recovery; every page uses LOT and resume keeps unresolved history partial', async t => {
  const ctx = await setup(t, {vin: '5YJ3E1EA4NF******'}); await ctx.failOriginal();
  const frozen = JSON.stringify(ctx.target);
  await runExactLotRecovery(ctx.args({transport: async () => ({ok: true,
    data: raw({history: {data: [event()], meta: {next_cursor: 'cursor-a'}}})})}));
  assert.equal(ctx.sql.prepare('SELECT vin_normalized FROM auction_listings').get().vin_normalized, vin);
  let pages = 0;
  const first = await runExactLotRecoveryHistoryPages(ctx.args({maxPages: 1, transport: async spec => {
    pages++; assert.equal(spec.identifier, lot); assert.equal(spec.cursor, 'cursor-a');
    return {ok: true, data: [event(2), event(3, '99999999')], meta: {next_cursor: 'cursor-b'}};
  }}));
  assert.equal(first.history.complete, false); assert.equal(first.history.unresolved, 1);
  ctx.reopen();
  const replay = await runExactLotRecovery(ctx.args({transport: async () => { throw Error('NO_DETAIL_REFETCH'); }}));
  assert.equal(replay.replayed, true);
  const final = await runExactLotRecoveryHistoryPages(ctx.args({transport: async spec => {
    pages++; assert.equal(spec.identifier, lot); assert.equal(spec.cursor, 'cursor-b');
    return {ok: true, data: [event(4)], meta: {next_cursor: null}};
  }}));
  assert.equal(final.history.complete, false); assert.equal(final.history.sourceComplete, true);
  assert.equal(final.history.unresolved, 1); assert.equal(pages, 2);
  assert.equal(final.history.anchorKey, ctx.recoveryOperation().key);
  assert.match(final.history.scopeKey, /^history-lot-recovery:v1:/);
  assert.notEqual(final.history.scopeKey, 'history:' + digest(ctx.target));
  const metrics = {...ctx.metrics};
  assert.equal((await runExactLotRecoveryHistoryPages(ctx.args({transport: async () => {
    throw Error('NO_HISTORY_REFETCH');
  }}))).pages, 0);
  assert.deepEqual(ctx.metrics, metrics); assert.equal(JSON.stringify(ctx.target), frozen);
  await assert.rejects(runHistoryPages(ctx.args({transport: async () => { throw Error('NO_FETCH'); }})),
    /IMPROVEMENT_HISTORY_ANCHOR_REQUIRED/);
});

test('recovery history cannot borrow the original rejected detail or a failed recovery as anchor', async t => {
  const ctx = await setup(t); await ctx.failOriginal();
  const noTransport = async () => { throw Error('NO_HISTORY_TRANSPORT'); };
  await assert.rejects(runExactLotRecoveryHistoryPages(ctx.args({transport: noTransport})),
    /IMPROVEMENT_HISTORY_ANCHOR_REQUIRED/);
  await runExactLotRecovery(ctx.args({transport: async () => ({ok: true, data: raw({lot_number: '99999999'})})}));
  await assert.rejects(runExactLotRecoveryHistoryPages(ctx.args({transport: noTransport})),
    /IMPROVEMENT_HISTORY_ANCHOR_REQUIRED/);
});

test('a durable recovery response replays its original capture time after a controlled write-failure restart', async t => {
  const ctx = await setup(t); await ctx.failOriginal(); const batch = ctx.db.batch;
  let calls = 0;
  ctx.db.batch = async items => {
    if (items.some(item => /INSERT INTO auction_listing_snapshots/.test(item.sql))) throw Error('FIXTURE_WRITE_FAILURE');
    return batch(items);
  };
  await assert.rejects(runExactLotRecovery(ctx.args({transport: async () => {
    calls++; return {ok: true, data: raw()};
  }})), /IMPROVEMENT_WRITE_FAILED/);
  assert.equal(calls, 1); assert.equal(ctx.sql.prepare('SELECT summary_synced_at FROM auction_listings').get().summary_synced_at, before);
  const receiptNumber = ctx.journal.attempts().find(row => row.key === ctx.recoveryOperation().key).number;
  const receiptBefore = fs.readFileSync(ctx.journal.receiptPath(receiptNumber), 'utf8');
  ctx.db.batch = batch; ctx.time += 60000;
  // Synthetic operator review only: remove this fixture's STOP, never a live journal.
  assert.equal(path.dirname(ctx.journal.stopFile), ctx.directory); fs.unlinkSync(ctx.journal.stopFile);
  ctx.reopen();
  const result = await runExactLotRecovery(ctx.args({transport: async () => { calls++; throw Error('NO_REFETCH'); }}));
  assert.equal(result.status, 'committed'); assert.equal(result.observedAt, at); assert.equal(calls, 1);
  assert.equal(fs.readFileSync(ctx.journal.receiptPath(receiptNumber), 'utf8'), receiptBefore);
  assert.equal(ctx.sql.prepare('SELECT detail_synced_at FROM auction_listings').get().detail_synced_at, at);
  assert.deepEqual(ctx.journal.outcome(ctx.originalKey), ctx.originalOutcome);
});

test('wrong recovery history envelope cannot erase prior events or confirm fetched-empty', async t => {
  const ctx = await setup(t); await ctx.failOriginal();
  await runExactLotRecovery(ctx.args({transport: async () => ({ok: true,
    data: raw({history: {data: [event()], meta: {next_cursor: 'next'}}})})}));
  const priorEvents = ctx.sql.prepare('SELECT * FROM auction_events').all(); let calls = 0;
  const result = await runExactLotRecoveryHistoryPages(ctx.args({transport: async () => {
    calls++; return {ok: true, data: {vehicle: raw({lot_number: '99999999'}), history: []},
      meta: {next_cursor: null}};
  }}));
  assert.equal(result.history.status, 'rejected'); assert.notEqual(result.history.complete, true);
  assert.deepEqual(ctx.sql.prepare('SELECT * FROM auction_events').all(), priorEvents);
  await runExactLotRecoveryHistoryPages(ctx.args({transport: async () => { calls++; throw Error('NO_REFETCH'); }}));
  assert.equal(calls, 1);
});

test('short VIN remains short and history unavailable; matching visible masked characters remain mandatory', async t => {
  const short = await setup(t, {vin: '06132068'}); await short.failOriginal();
  const result = await runExactLotRecovery(short.args({transport: async () => ({ok: true,
    data: raw({vin: '06132068'})})}));
  assert.equal(result.status, 'committed'); assert.equal(result.historyError, 'CATALOG_HISTORY_VIN_UNAVAILABLE');
  assert.equal(result.history, null);
  await assert.rejects(runExactLotRecoveryHistoryPages(short.args({transport: async () => { throw Error('NO_FETCH'); }})),
    /IMPROVEMENT_HISTORY_ANCHOR_REQUIRED/);
  const masked = await setup(t, {vin: '5YJ3E1EA4NF******'}); await masked.failOriginal();
  const rejected = await runExactLotRecovery(masked.args({transport: async () => ({ok: true,
    data: raw({vin: '5YJ3E1EA4NG186754'})})}));
  assert.equal(rejected.status, 'rejected'); assert.equal(rejected.code, 'CATALOG_DETAIL_IDENTITY_MISMATCH');
});

test('each recovery history page uses the existing durable budget and stops before excess transport', async t => {
  const ctx = await setup(t, {maxRequests: 3}); await ctx.failOriginal();
  await runExactLotRecovery(ctx.args({transport: async () => ({ok: true,
    data: raw({history: {data: [event()], meta: {next_cursor: 'next'}}})})}));
  let calls = 0;
  await assert.rejects(runExactLotRecoveryHistoryPages(ctx.args({transport: async () => {
    calls++; return {ok: true, data: [], meta: {next_cursor: null}};
  }})), /IMPROVEMENT_REQUEST_LIMIT/);
  assert.equal(calls, 0); assert.equal(ctx.journal.attempts().length, 3);
  assert.equal(ctx.sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n, 1);
});

test('an older recovery observation cannot stamp detail or serve as a history anchor', async t => {
  const ctx = await setup(t); await ctx.failOriginal();
  const later = '2026-10-20T16:01:00.000Z';
  ctx.sql.prepare('UPDATE auction_listings SET summary_synced_at=?').run(later);
  const oldListing = ctx.sql.prepare('SELECT * FROM auction_listings').get();
  const result = await runExactLotRecovery(ctx.args({transport: async () => ({ok: true,
    data: raw({history: {data: [event()], meta: {next_cursor: 'next'}}})})}));
  assert.equal(result.status, 'committed'); assert.equal(result.skipped, 'older_observation');
  assert.equal(result.history, null);
  assert.deepEqual(ctx.sql.prepare('SELECT * FROM auction_listings').get(), oldListing);
  await assert.rejects(runExactLotRecoveryHistoryPages(ctx.args({transport: async () => { throw Error('NO_FETCH'); }})),
    /IMPROVEMENT_HISTORY_ANCHOR_REQUIRED/);
});

test('recovery history stops on a repeated cursor before writing the offending page', async t => {
  const ctx = await setup(t); await ctx.failOriginal();
  await runExactLotRecovery(ctx.args({transport: async () => ({ok: true,
    data: raw({history: {data: [event()], meta: {next_cursor: 'next'}}})})}));
  const oldEvents = ctx.sql.prepare('SELECT * FROM auction_events').all(); let calls = 0;
  await assert.rejects(runExactLotRecoveryHistoryPages(ctx.args({transport: async () => {
    calls++; return {ok: true, data: [event(2)], meta: {next_cursor: 'next'}};
  }})), /IMPROVEMENT_REPEATED_CURSOR/);
  assert.equal(calls, 1); assert.deepEqual(ctx.sql.prepare('SELECT * FROM auction_events').all(), oldEvents);
  await assert.rejects(runExactLotRecoveryHistoryPages(ctx.args({transport: async () => {
    calls++; throw Error('NO_FETCH');
  }})), /IMPROVEMENT_STOP_LATCH/);
  assert.equal(calls, 1);
});

test('recovery uses the same atomic fingerprint readback and stops before history on mismatch', async t => {
  const ctx = await setup(t); await ctx.failOriginal(); const batch = ctx.db.batch;
  ctx.db.batch = async items => {
    const results = await batch(items);
    if (/AS latest_snapshot_fingerprint/.test(items.at(-1).sql)) {
      results.at(-1).results[0].latest_snapshot_fingerprint = 'fixture-corruption';
    }
    return results;
  };
  await assert.rejects(runExactLotRecovery(ctx.args({transport: async () => ({ok: true,
    data: raw({history: [event()]})})})), error => error.message === 'IMPROVEMENT_WRITE_FAILED'
      && error.cause?.message === 'IMPROVEMENT_SNAPSHOT_READBACK_FAILED');
  assert.equal(ctx.sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n, 0);
  assert.deepEqual(ctx.journal.outcome(ctx.originalKey), ctx.originalOutcome);
});

test('a crash while marking rejected recovery replays the marker without fetching the source again', async t => {
  const ctx = await setup(t); await ctx.failOriginal(); const batch = ctx.db.batch; let calls = 0;
  ctx.db.batch = async items => {
    if (items.some(item => /UPDATE vehicle_sources/.test(item.sql))) throw Error('FIXTURE_MARKER_FAILURE');
    return batch(items);
  };
  await assert.rejects(runExactLotRecovery(ctx.args({transport: async () => {
    calls++; return {ok: true, data: raw({lot_number: '99999999'})};
  }})), /IMPROVEMENT_WRITE_FAILED/);
  assert.equal(ctx.journal.outcome(ctx.recoveryOperation().key).result.status, 'rejected');
  assert.equal(ctx.journal.rows.some(row => row.kind === 'detail_failure_marked' && row.key === ctx.recoveryOperation().key), false);
  ctx.db.batch = batch;
  assert.equal(path.dirname(ctx.journal.stopFile), ctx.directory); fs.unlinkSync(ctx.journal.stopFile);
  ctx.reopen();
  const replay = await runExactLotRecovery(ctx.args({transport: async () => { calls++; throw Error('NO_REFETCH'); }}));
  assert.equal(replay.replayed, true); assert.equal(calls, 1);
  assert.equal(ctx.journal.rows.filter(row => row.kind === 'detail_failure_marked' && row.key === ctx.recoveryOperation().key).length, 1);
  const metrics = {...ctx.metrics};
  await runExactLotRecovery(ctx.args({transport: async () => { calls++; throw Error('NO_REFETCH'); }}));
  assert.deepEqual(ctx.metrics, metrics); assert.equal(calls, 1);
});

test('normal wrapper replay after masked-to-full recovery performs zero transport and zero D1 writes', async t => {
  const ctx = await setup(t, {vin: '5YJ3E1EA4NF******'}); await ctx.failOriginal();
  assert.equal(ctx.journal.rows.filter(row => row.kind === 'detail_failure_marked'
    && row.key === ctx.originalKey).length, 1);
  await runExactLotRecovery(ctx.args({transport: async () => ({ok: true, data: raw()})}));
  assert.equal(ctx.sql.prepare('SELECT vin_normalized FROM auction_listings').get().vin_normalized, vin);
  ctx.reopen(); const metrics = {...ctx.metrics}; let calls = 0;
  // The real wrapper revisits its entire original immutable detail queue first.
  const originalReplay = await runDetailTarget(ctx.args({transport: async () => { calls++; throw Error('NO_FETCH'); }}));
  assert.equal(originalReplay.replayed, true); assert.equal(originalReplay.status, 'rejected');
  const recoveryReplay = await runExactLotRecovery(ctx.args({transport: async () => { calls++; throw Error('NO_FETCH'); }}));
  assert.equal(recoveryReplay.replayed, true); assert.equal(recoveryReplay.status, 'committed');
  assert.equal(calls, 0); assert.deepEqual(ctx.metrics, metrics);
  assert.equal(ctx.sql.prepare('SELECT vin_normalized FROM auction_listings').get().vin_normalized, vin);
  assert.deepEqual(ctx.journal.outcome(ctx.originalKey), ctx.originalOutcome);
});

test('a first original failure is never skipped and its interrupted marker resumes without refetch', async t => {
  const ctx = await setup(t, {vin: '5YJ3E1EA4NF******'}); const batch = ctx.db.batch; let calls = 0;
  ctx.db.batch = async items => {
    if (items.some(item => /UPDATE vehicle_sources/.test(item.sql))) throw Error('FIXTURE_ORIGINAL_MARKER_FAILURE');
    return batch(items);
  };
  await assert.rejects(runDetailTarget(ctx.args({transport: async () => {
    calls++; return {ok: true, data: raw({lot_number: '99999999'})};
  }})), /IMPROVEMENT_WRITE_FAILED/);
  assert.equal(calls, 1);
  assert.equal(ctx.journal.outcome(ctx.originalKey).result.status, 'rejected');
  assert.equal(ctx.journal.rows.some(row => row.kind === 'detail_failure_marked'), false);
  ctx.db.batch = batch;
  assert.equal(path.dirname(ctx.journal.stopFile), ctx.directory); fs.unlinkSync(ctx.journal.stopFile);
  ctx.reopen();
  const replay = await runDetailTarget(ctx.args({transport: async () => { calls++; throw Error('NO_REFETCH'); }}));
  assert.equal(replay.replayed, true); assert.equal(calls, 1);
  const source = ctx.sql.prepare('SELECT sync_status,last_error_code,last_attempt_at FROM vehicle_sources').get();
  assert.equal(source.sync_status, 'failed'); assert.equal(source.last_attempt_at, at);
  assert.equal(source.last_error_code, 'CATALOG_DETAIL_IDENTITY_MISMATCH');
  assert.equal(ctx.journal.rows.filter(row => row.kind === 'detail_failure_marked'
    && row.key === ctx.originalKey).length, 1);
  const metrics = {...ctx.metrics};
  await runDetailTarget(ctx.args({transport: async () => { calls++; throw Error('NO_REFETCH'); }}));
  assert.deepEqual(ctx.metrics, metrics); assert.equal(calls, 1);
});

test('standalone recovery first confirms an old-module original failure marker before upgrading VIN', async t => {
  const ctx = await setup(t, {vin: '5YJ3E1EA4NF******'});
  const {detailSpec, checkDetail} = require('../scripts/catalog-refresh-campaign.cjs');
  // Model an older journal: its response/outcome exists but no marker was
  // recorded. No fake success or relaxed identity is supplied to recovery.
  await ctx.journal.execute(ctx.originalKey, detailSpec(ctx.target),
    async () => ({ok: true, data: raw({lot_number: '99999999'})}),
    async ({response}) => checkDetail(response.data, ctx.target));
  ctx.originalOutcome = structuredClone(ctx.journal.outcome(ctx.originalKey));
  assert.equal(ctx.journal.rows.some(row => row.kind === 'detail_failure_marked'), false);
  await runExactLotRecovery(ctx.args({transport: async () => {
    assert.equal(ctx.journal.rows.filter(row => row.kind === 'detail_failure_marked'
      && row.key === ctx.originalKey).length, 1);
    assert.equal(ctx.sql.prepare('SELECT sync_status FROM vehicle_sources').get().sync_status, 'failed');
    return {ok: true, data: raw()};
  }}));
  ctx.reopen(); const metrics = {...ctx.metrics};
  const replay = await runDetailTarget(ctx.args({transport: async () => { throw Error('NO_FETCH'); }}));
  assert.equal(replay.replayed, true); assert.deepEqual(ctx.metrics, metrics);
  assert.equal(ctx.sql.prepare('SELECT vin_normalized FROM auction_listings').get().vin_normalized, vin);
});
