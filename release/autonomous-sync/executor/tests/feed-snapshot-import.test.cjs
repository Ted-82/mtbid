'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {gzipSync} = require('node:zlib');
const {DatabaseSync} = require('node:sqlite');
const {createApibaraProvider} = require('../providers/apibara.js');
const {RefreshStore} = require('../sync/automatic-refresh.cjs');
const {downloadFeed} = require('../scripts/apibara-feed.cjs');
const {readSnapshotPages} = require('../scripts/feed-snapshot-pages.cjs');
const {importSnapshotBatch, hash} = require('../sync/feed-snapshot-import.cjs');
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
  const db = {prepare(sql) {return {bind(...params) {return {sql, params,
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
const count = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
function receipt(records = [raw()], extra = {}) {return {fileSha256: 'a'.repeat(64), generationId: 4548,
  observedAt: AT, totalRecords: records.length, offset: 0, records, batchSha256: hash(records), ...extra};}
async function execute(env, input) {return importSnapshotBatch({...env, provider, freshnessPolicy, receipt: input});}

test('real compressed snapshot streams into guarded SQLite batches, resumes and never calls provider', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rexbid-feed-import-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const records = Array.from({length: 43}, (_, index) => raw(index));
  const bytes = gzipSync(records.map(JSON.stringify).join('\n'));
  const manifest = await downloadFeed({url: 'https://apibara.tech/data-feeds/test/latest', directory, mode: 'snapshot',
    fetchImpl: async () => new Response(bytes, {headers: {'content-length': String(bytes.length)}})});
  const env = database(t); await env.store.acquire();
  const options = {directory, manifest, generationId: 4548, observedAt: AT, now: NOW};
  let first;
  for await (const page of readSnapshotPages(options)) {first = page; await execute(env, page); break;}
  assert.equal(count(env.sqlite, 'auction_listings'), 20);
  assert.equal((await execute(env, first)).alreadyApplied, true);
  assert.equal(count(env.sqlite, 'auction_listing_snapshots'), 20);
  let result;
  for await (const page of readSnapshotPages({...options, startOffset: 20})) result = await execute(env, page);
  assert.equal(result.state.offset, 43); assert.equal(result.state.inserted, 43);
  assert.equal(count(env.sqlite, 'auction_listings'), 43); assert.equal(count(env.sqlite, 'auction_listing_snapshots'), 43);
  assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 4); // file + three atomic receipts
  assert.equal(count(env.sqlite, 'sync_batch_guards'), 0);
  assert.deepEqual(env.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(env.sqlite.prepare('SELECT MIN(summary_synced_at) d FROM auction_listings').get().d, AT);
  // Corruption of the final bytes must stop BEFORE the first batch, not after
  // most of a file has already been imported.
  fs.appendFileSync(path.join(directory, manifest.file), 'corrupt');
  let yielded = 0;
  await assert.rejects(async () => {for await (const page of readSnapshotPages(options)) yielded++;}, /FEED_SNAPSHOT_FILE_CHANGED/);
  assert.equal(yielded, 0);
});

test('source-time reader verifies the whole file and its exact upper bound before yielding', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rexbid-source-time-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  for (const missingTime of [false, true]) {
    const older = {...raw(0), updated_at: missingTime ? undefined : '2026-05-20T11:20:28.123456Z'};
    const bytes = gzipSync([older, raw(1)].map(JSON.stringify).join('\n'));
    const manifest = await downloadFeed({url: 'https://apibara.tech/data-feeds/test/latest', directory, mode: 'snapshot',
      fetchImpl: async () => new Response(bytes)});
    const options = {directory, manifest, generationId: 4548, observedAt: AT, now: NOW, observationTimeBasis: 'source_updated_at'};
    let yielded = 0;
    if (!missingTime) {
      for await (const page of readSnapshotPages(options)) {yielded++; assert.equal(page.observationTimeBasis, 'source_updated_at');}
      assert.equal(yielded, 1);
      options.observedAt = '2026-10-27T12:01:00.000Z';
    }
    yielded = 0;
    await assert.rejects(async () => {for await (const page of readSnapshotPages(options)) yielded++;}, /FEED_SNAPSHOT_SOURCE_TIME_INVALID/);
    assert.equal(yielded, 0);
  }
});

test('60-record import commits all chunks with one checkpoint and resumes its short final batch', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rexbid-batch60-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const records=Array.from({length:63},(_,i)=>raw(i));
  const manifest=await downloadFeed({url:'https://apibara.tech/data-feeds/test/latest',directory,mode:'snapshot',
    fetchImpl:async()=>new Response(gzipSync(records.map(JSON.stringify).join('\n')))});
  const options={directory,manifest,generationId:4548,observedAt:AT,now:NOW,batchSize:60};
  const env=database(t);await env.store.acquire();let first;
  for await(const page of readSnapshotPages(options)){first=page;const result=await execute(env,page);assert.equal(result.state.offset,60);break;}
  assert.equal(count(env.sqlite,'auction_listings'),60);
  assert.equal((await execute(env,first)).alreadyApplied,true);
  for await(const page of readSnapshotPages({...options,startOffset:60})){const result=await execute(env,page);assert.equal(result.state.offset,63);}
  assert.equal(count(env.sqlite,'auction_listings'),63);assert.equal(count(env.sqlite,'automatic_refresh_tasks'),3);
  assert.deepEqual(env.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  await assert.rejects(execute(env,receipt(records.slice(0,20),{fileSha256:manifest.sha256,totalRecords:63})),/CHECKPOINT_INVALID/);
});

test('large snapshot batch rolls back every chunk on failure and rejects cross-chunk conflicting source IDs',async t=>{
  const env=database(t);await env.store.acquire();const records=Array.from({length:60},(_,i)=>raw(i));
  env.setFault(statement=>statement.sql.includes('scan_pages=automatic_refresh_tasks.scan_pages+1'));
  await assert.rejects(execute(env,receipt(records,{batchSize:60})),/COMMIT|DATABASE|FAILED/);
  assert.equal(count(env.sqlite,'auction_listings'),0);assert.equal(count(env.sqlite,'automatic_refresh_tasks'),0);
  env.setFault(null);
  records[20].vehicle_id=records[0].vehicle_id;records[20].vin='SALZP2FX8PH185647';
  await assert.rejects(execute(env,receipt(records,{batchSize:60})),/DUPLICATE_IDENTITY/);
  assert.equal(count(env.sqlite,'auction_listings'),0);
  await assert.rejects(execute(env,receipt([raw()],{batchSize:100})),/BATCH_SIZE_INVALID/);
});

test('checkpoint failure rolls back all cars, snapshots and rejection audit', async t => {
  const env = database(t); await env.store.acquire();
  env.setFault(statement => statement.sql.includes('scan_pages=automatic_refresh_tasks.scan_pages+1'));
  await assert.rejects(execute(env, receipt()), /DATABASE|COMMIT|FAILED/);
  for (const table of ['vehicle_sources', 'auction_listings', 'auction_listing_snapshots', 'automatic_refresh_tasks', 'sync_batch_guards']) assert.equal(count(env.sqlite, table), 0);
  env.setFault(null); assert.equal((await execute(env, receipt())).state.offset, 1);
});

test('bad VIN is durably quarantined with its batch and never becomes a vehicle', async t => {
  const env = database(t); await env.store.acquire();
  const records = [raw(), {...raw(1), vin: 'MASKED'}];
  const result = await execute(env, receipt(records));
  assert.equal(result.state.offset, 2); assert.equal(result.state.inserted, 1); assert.equal(result.state.rejected, 1);
  assert.equal(count(env.sqlite, 'auction_listings'), 1);
  const audit = JSON.parse(env.sqlite.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'file-batch:%'").get().cursor);
  assert.equal(audit.rejected.length, 1); assert.equal(audit.rejected[0].lot, '10000001');
  assert.equal((await execute(env, receipt(records))).alreadyApplied, true);
});

test('source-time snapshot preserves each version date, never stamps all cars with the file maximum', async t => {
  const env=database(t);await env.store.acquire();
  const older={...raw(0),updated_at:'2026-05-20T11:20:28.123456Z'};
  const records=[older,raw(1)];
  const input=receipt(records,{observationTimeBasis:'source_updated_at'});
  const saved=await execute(env,input);assert.equal(saved.state.inserted,2);
  const rows=env.sqlite.prepare('SELECT lot,summary_synced_at FROM auction_listings ORDER BY lot').all();
  assert.equal(rows[0].summary_synced_at,'2026-05-20T11:20:28.123Z');assert.equal(rows[1].summary_synced_at,AT);
  assert.equal(saved.state.observationTimeBasis,'source_updated_at');
  assert.equal((await execute(env,input)).alreadyApplied,true);
  await assert.rejects(execute(env,{...input,observationTimeBasis:'capture'}),/CHECKPOINT_INVALID/);
});

test('source-time mode rejects missing, invalid and out-of-range record times without making them fresh',async t=>{
  const env=database(t);await env.store.acquire();
  const records=[undefined,'2026-02-30T12:00:00Z','2026-10-28T12:00:00Z','2026-10-27 12:00:00'].map((updated_at,i)=>({...raw(i),updated_at}));
  const saved=await execute(env,receipt(records,{observationTimeBasis:'source_updated_at'}));
  assert.equal(saved.state.rejected,4);assert.equal(count(env.sqlite,'auction_listings'),0);
  await assert.rejects(execute(env,receipt([raw()],{observationTimeBasis:'download_time'})),/TIME_BASIS_INVALID/);
});

test('unknown replay, changed metadata, changed content and skipped page are refused', async t => {
  const env = database(t); await env.store.acquire();
  const twenty = Array.from({length: 20}, (_, i) => raw(i));
  const first = receipt(twenty, {totalRecords: 40}); await execute(env, first);
  await assert.rejects(execute(env, {...first, observedAt: '2026-10-27T11:00:00.000Z'}), /CHECKPOINT_INVALID/);
  await assert.rejects(execute(env, {...first, batchSha256: 'b'.repeat(64)}), /RECEIPT_INVALID/);
  await assert.rejects(execute(env, {...first, records: [...twenty].reverse(), batchSha256: hash([...twenty].reverse())}), /REPLAY_UNVERIFIED/);
  env.sqlite.prepare("DELETE FROM automatic_refresh_tasks WHERE task_key LIKE 'file-batch:%'").run();
  await assert.rejects(execute(env, first), /REPLAY_UNVERIFIED/);
  await assert.rejects(execute(env, receipt([raw(50)], {fileSha256: 'c'.repeat(64), offset: 20, totalRecords: 21})), /PAGE_GAP/);
  assert.equal(count(env.sqlite, 'auction_listings'), 20);
});

test('lease expiry, future capture and event data cannot change the database', async t => {
  const env = database(t); await env.store.acquire();
  await assert.rejects(execute(env, receipt([raw()], {observedAt: '2026-10-28T12:00:00.000Z'})), /TIME_INVALID/);
  const withEvent = {...raw(), event_id: 'chg_1'};
  await assert.rejects(execute(env, receipt([withEvent])), /SCOPE_INVALID/);
  env.sqlite.prepare('UPDATE automatic_refresh_state SET lease_until=?').run('2026-10-26T00:00:00.000Z');
  await assert.rejects(execute(env, receipt()), /LEASE|COMMIT|GUARD|FAILED/);
  assert.equal(count(env.sqlite, 'auction_listings'), 0); assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 0);
});

test('concurrent checkpoint change cancels the whole next page', async t => {
  const env = database(t); await env.store.acquire();
  await execute(env, receipt(Array.from({length: 20}, (_, i) => raw(i)), {totalRecords: 21}));
  env.beforeBatch(() => env.sqlite.prepare("UPDATE automatic_refresh_tasks SET cursor=cursor||' ' WHERE task_key LIKE 'file-snapshot:%'").run());
  await assert.rejects(execute(env, receipt([raw(20)], {totalRecords: 21, offset: 20})), /STALE_BASELINE|COMMIT|FAILED/);
  assert.equal(count(env.sqlite, 'auction_listings'), 20);
  assert.equal(count(env.sqlite, 'automatic_refresh_tasks'), 2);
  assert.equal(count(env.sqlite, 'sync_batch_guards'), 0);
});

test('older file never overwrites a newer saved observation and records the skip', async t => {
  const env = database(t); await env.store.acquire();
  await execute(env, receipt());
  const before = {...env.sqlite.prepare('SELECT * FROM auction_listings').get()};
  const older = raw(); older.pricing.current_bid_usd = 7777; older.updated_at = '2026-10-26T00:00:00.000Z';
  const result = await execute(env, receipt([older], {fileSha256: 'b'.repeat(64), generationId: 4000, observedAt: '2026-10-26T12:00:00.000Z'}));
  assert.equal(result.state.skipped, 1); assert.equal(result.state.updated, 0);
  assert.deepEqual({...env.sqlite.prepare('SELECT * FROM auction_listings').get()}, before);
  assert.equal(count(env.sqlite, 'auction_listing_snapshots'), 1);
  assert.equal(result.audit.skipped.length, 1);
});
