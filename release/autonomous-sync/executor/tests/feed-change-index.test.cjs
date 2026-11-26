'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const {gzipSync} = require('node:zlib');
const {createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {ingestLocalFeed} = require('../scripts/apibara-feed.cjs');
const {buildFeedChangeIndex} = require('../scripts/feed-change-index.cjs');
const event = (sequence, platform = 'iaai', lot = '45787870') => ({sequence, event_id: `chg_${sequence}`,
  event: 'bid.changed', terminal: false, vehicle: {platform, lot_number: lot, vin: 'SALZP2FX8PH185647'},
  changed_fields: ['pricing.current_bid_usd'], before: {'pricing.current_bid_usd': 50},
  after: {'pricing.current_bid_usd': sequence === 12 ? null : sequence * 10}, recorded_at: '2026-10-28T12:00:00Z'});
async function setup(t, groups) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rexbid-change-index-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const directory = path.join(root, 'accepted'), outputDirectory = path.join(root, 'indexes'), sources = [];
  for (let i = 0; i < groups.length; i++) {
    const file = path.join(root, `${i}.gz`); await fs.writeFile(file, gzipSync(groups[i].map(JSON.stringify).join('\r\n')));
    sources.push({generationId: i + 1, manifest: await ingestLocalFeed({file, directory, mode: 'incremental', invalidVinPolicy: 'quarantine'})});
  }
  return {directory, outputDirectory, sources};
}

test('indexes actual event order per platform/LOT, preserves nulls and publishes no database cursor', async t => {
  const options = await setup(t, [[event(8), event(10, 'copart'), event(11)], [event(12), event(15, 'copart')]]);
  const manifest = await buildFeedChangeIndex(options);
  assert.equal(manifest.records, 5); assert.equal(manifest.uniqueLots, 2); assert.equal(manifest.quarantined, 0);
  assert.equal(manifest.databaseApplied, false); assert.equal(manifest.continuityVerified, false); assert.equal(manifest.globalCursorEstablished, false);
  const file = path.join(options.outputDirectory, manifest.identity, 'events.sqlite');
  assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'), manifest.databaseSha256);
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    assert.deepEqual(db.prepare('SELECT sequence FROM events WHERE platform=? AND lot=? ORDER BY sequence').all('iaai', '45787870').map(x => x.sequence), [8, 11, 12]);
    assert.equal(JSON.parse(db.prepare('SELECT raw FROM events WHERE sequence=12').get().raw).after['pricing.current_bid_usd'], null);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  } finally {db.close();}
  await assert.rejects(buildFeedChangeIndex(options), /FEED_INDEX_ALREADY_EXISTS/);
});

test('missing, overlapping or reordered files require evidence instead of silently skipping events', async t => {
  const options = await setup(t, [[event(8), event(10)], [event(12)]]);
  await assert.rejects(buildFeedChangeIndex(options), /FEED_INDEX_BOUNDARY_UNVERIFIED/);
  await assert.rejects(buildFeedChangeIndex({...options, sources: options.sources.toReversed()}), /FEED_INDEX_BOUNDARY_UNVERIFIED/);
});

test('quarantine preserves the original invalid VIN and ties it to the exact source line', async t => {
  const bad = event(8); bad.vehicle.vin = '3\u001a6TRVDG1KE508499';
  const options = await setup(t, [[bad, event(9)]]), manifest = await buildFeedChangeIndex(options);
  assert.equal(manifest.quarantined, 1);
  const db = new DatabaseSync(path.join(options.outputDirectory, manifest.identity, 'events.sqlite'), {readOnly: true});
  try {const row = db.prepare('SELECT raw,quarantine FROM events WHERE sequence=8').get();
    assert.equal(row.quarantine, 'invalid_vin_control_character'); assert.equal(JSON.parse(row.raw).vehicle.vin, bad.vehicle.vin);
  } finally {db.close();}
  const tampered = structuredClone(options); tampered.outputDirectory = path.join(options.outputDirectory, 'bad');
  tampered.sources[0].manifest.quarantinedEvents[0].rawLineSha256 = '0'.repeat(64);
  await assert.rejects(buildFeedChangeIndex(tampered), /FEED_INDEX_QUARANTINE_INVALID/);
  assert.deepEqual(await fs.readdir(tampered.outputDirectory), []);
});

test('corrupt source and count mismatch never publish a partial index', async t => {
  const options = await setup(t, [[event(8)]]);
  const mismatched = structuredClone(options); mismatched.sources[0].manifest.records = 2;
  await assert.rejects(buildFeedChangeIndex(mismatched), /FEED_INDEX_SOURCE_CHANGED/);
  assert.deepEqual(await fs.readdir(options.outputDirectory), []);
  const file = path.join(options.directory, options.sources[0].manifest.file), bytes = await fs.readFile(file);
  bytes[bytes.length - 5] ^= 1; await fs.writeFile(file, bytes);
  await assert.rejects(buildFeedChangeIndex(options));
  assert.deepEqual(await fs.readdir(options.outputDirectory), []);
});

test('event ID reuse across individually valid files fails atomically', async t => {
  const repeated = {...event(9), event_id: 'chg_8'};
  const options = await setup(t, [[event(8)], [repeated]]);
  await assert.rejects(buildFeedChangeIndex(options), /UNIQUE constraint/);
  assert.deepEqual(await fs.readdir(options.outputDirectory), []);
});

test('aborted work cleans only its new temporary directory and keeps input intact', async t => {
  const options = await setup(t, [[event(8)]]), controller = new AbortController();
  controller.abort();
  await assert.rejects(buildFeedChangeIndex({...options, signal: controller.signal}), /abort/i);
  assert.deepEqual(await fs.readdir(options.outputDirectory), []);
  assert.ok((await fs.stat(path.join(options.directory, options.sources[0].manifest.file))).size > 0);
});
