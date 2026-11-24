'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {gzipSync} = require('node:zlib');
const {inspectFeedFile, downloadFeed, validateFeedUrl, ingestLocalFeed} = require('../scripts/apibara-feed.cjs');
const URL = 'https://apibara.tech/data-feeds/test-not-a-secret/latest';
const vehicle = (platform = 'iaai', lot = '45787870') => ({platform, lot_number: lot,
  vin: 'SALZP2FX8PH185647', auction: {state: 'open'}, title: 'Przykład Żółty'});
const event = (sequence = 8) => ({sequence, event_id: `chg_${sequence}`, event: 'bid.changed', terminal: false,
  vehicle: {platform: 'iaai', lot_number: '45787870', vin: 'SALZP2FX8PH185647'}, changed_fields: ['pricing.current_bid_usd'],
  before: {'pricing.current_bid_usd': 50}, after: {'pricing.current_bid_usd': null}, recorded_at: '2026-10-27T12:00:00Z'});
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rexbid-feed-')); t.after(() => fs.rm(dir, {recursive: true, force: true})); return dir; }
function response(bytes, options = {}) { return new Response(bytes, {headers: {'content-length': String(bytes.length)}, ...options}); }
async function inspect(t, rows, mode = 'snapshot', limits) {
  const file = path.join(await temp(t), 'feed.gz');
  await fs.writeFile(file, gzipSync(typeof rows === 'string' ? rows : rows.map(JSON.stringify).join('\n')));
  return inspectFeedFile(file, {mode, limits});
}

test('snapshot intake counts both sources and uncertain VINs without pretending it was applied', async t => {
  const directory = await temp(t), bytes = gzipSync([vehicle(), {...vehicle('copart', '12345678'), vin: null}].map(JSON.stringify).join('\r\n'));
  const result = await downloadFeed({url: URL, directory, mode: 'snapshot', fetchImpl: async () => response(bytes)});
  assert.equal(result.records, 2); assert.deepEqual(result.platforms, {copart: 1, iaai: 1});
  assert.equal(result.unresolvedVins, 1); assert.equal(result.databaseApplied, false); assert.equal(result.continuityVerified, false);
  assert.equal(result.firstSequence, null); assert.deepEqual(await fs.readFile(path.join(directory, result.file)), bytes);
  assert.ok(!JSON.stringify(result).includes('test-not-a-secret'));
  const again = await downloadFeed({url: URL, directory, mode: 'snapshot', fetchImpl: async () => response(bytes)});
  assert.deepEqual(again, result); assert.equal((await fs.readdir(directory)).length, 1);
  await fs.writeFile(path.join(directory, result.file), 'corrupt existing file');
  await assert.rejects(downloadFeed({url: URL, directory, mode: 'snapshot', fetchImpl: async () => response(bytes)}), {code: 'FEED_STORED_FILE_CONFLICT'});
});

test('incremental nulls and legitimate sequence gaps validate but do not prove file continuity', async t => {
  const result = await inspect(t, [event(8), event(15)], 'incremental');
  assert.equal(result.firstSequence, 8); assert.equal(result.lastSequence, 15); assert.equal(result.records, 2);
  assert.equal((await inspect(t, '', 'incremental')).lastSequence, null);
});

test('local downloaded file uses identical validation, immutable publication and per-record source times',async t=>{
  const root=await temp(t),file=path.join(root,'download.gz'),directory=path.join(root,'accepted');
  const bytes=gzipSync([{...vehicle(),updated_at:'2026-05-20T11:20:28.123456Z'},
    {...vehicle('copart','12345678'),updated_at:'2026-10-27T16:12:55.000000Z'}].map(JSON.stringify).join('\n'));
  await fs.writeFile(file,bytes);
  const result=await ingestLocalFeed({file,directory,mode:'snapshot'});
  assert.equal(result.sourceUpdatedCount,2);assert.equal(result.sourceUpdatedMin,'2026-05-20T11:20:28.123Z');
  assert.equal(result.sourceUpdatedMax,'2026-10-27T16:12:55.000Z');assert.equal(result.databaseApplied,false);
  assert.deepEqual(await fs.readFile(file),bytes);assert.deepEqual(await fs.readFile(path.join(directory,result.file)),bytes);
  assert.deepEqual(await ingestLocalFeed({file,directory,mode:'snapshot'}),result);
  await fs.writeFile(file,'invalid');
  await assert.rejects(ingestLocalFeed({file,directory,mode:'snapshot'}),/FEED_FILE_INVALID/);
  assert.deepEqual(await fs.readdir(directory),[result.sha256]);
  await assert.rejects(ingestLocalFeed({file:'relative.gz',directory,mode:'snapshot'}),/FEED_LOCAL_FILE_REQUIRED/);
});

test('mixed formats, duplicate identity and unexpected snapshot scope stop the entire file', async t => {
  for (const [rows, mode, code] of [
    [[vehicle(), event()], 'snapshot', 'FEED_MODE_MISMATCH'],
    [[event(), vehicle()], 'incremental', 'FEED_SEQUENCE_INVALID'],
    [[vehicle(), vehicle()], 'snapshot', 'FEED_DUPLICATE_IDENTITY'],
    [[{...vehicle(), auction: {state: 'sold'}}], 'snapshot', 'FEED_SNAPSHOT_SCOPE_INVALID'],
    [[], 'snapshot', 'FEED_EMPTY_SNAPSHOT'],
    [[{...vehicle(), platform: 'other'}], 'snapshot', 'FEED_IDENTITY_INVALID']
  ]) await assert.rejects(inspect(t, rows, mode), {code});
});

test('unordered, repeated and malformed events are rejected before any publication', async t => {
  for (const rows of [[event(10), event(9)], [event(), event()], [event(), {...event(9), event_id: 'chg_8'}],
    [{...event(), terminal: true}], [{...event(), event: 'unknown'}], [{...event(), after: null}]]) {
    await assert.rejects(inspect(t, rows, 'incremental'), /FEED_(SEQUENCE|EVENT)_INVALID/);
  }
});

test('truncated gzip, HTML, invalid UTF8 and malformed JSON never publish a ready file', async t => {
  const gz = gzipSync(JSON.stringify(vehicle()));
  for (const bytes of [gz.subarray(0, gz.length - 5), Buffer.from('<html>Sign in</html>'), gzipSync('{invalid'), gzipSync(Buffer.from([0xff]))]) {
    const directory = await temp(t);
    await assert.rejects(downloadFeed({url: URL, directory, mode: 'snapshot', fetchImpl: async () => response(bytes)}), /FEED_(FILE|JSON)_INVALID/);
    assert.deepEqual(await fs.readdir(directory), []);
  }
});

test('bounded decompression, lines and records reject oversized input', async t => {
  await assert.rejects(inspect(t, [vehicle()], 'snapshot', {expanded: 10}), {code: 'FEED_EXPANDED_LIMIT'});
  await assert.rejects(inspect(t, [vehicle()], 'snapshot', {line: 10}), /FEED_LINE_(INVALID|LIMIT)/);
  await assert.rejects(inspect(t, [vehicle(), vehicle('copart', '1')], 'snapshot', {records: 1}), {code: 'FEED_RECORD_LIMIT'});
});

test('HTTP errors, redirects and oversized downloads never reveal the bearer address', async t => {
  assert.throws(() => validateFeedUrl(URL.replace('apibara.tech', 'apibara.tech.evil.invalid')), {code: 'FEED_URL_INVALID'});
  assert.throws(() => validateFeedUrl(URL + '?secret=x'), {code: 'FEED_URL_INVALID'});
  for (const [status, code] of [[404, 'FEED_NOT_READY'], [401, 'FEED_AUTH_REQUIRED'], [429, 'FEED_RATE_LIMITED'], [302, 'FEED_REDIRECT_REJECTED']]) {
    const directory = await temp(t);
    await assert.rejects(downloadFeed({url: URL, directory, mode: 'snapshot', fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'manual'); return response('private', {status});
    }}), {code});
    assert.deepEqual(await fs.readdir(directory), []);
  }
  await assert.rejects(downloadFeed({url: URL, directory: await temp(t), mode: 'snapshot',
    fetchImpl: async () => { throw Error(`Failed: ${URL}`); }}), {message: 'FEED_DOWNLOAD_FAILED'});
  await assert.rejects(downloadFeed({url: URL, directory: await temp(t), mode: 'snapshot', limits: {compressed: 5},
    fetchImpl: async () => response(gzipSync(JSON.stringify(vehicle())))}), {code: 'FEED_COMPRESSED_LIMIT'});
});

test('hanging body aborts and removes incomplete file without retry', async t => {
  const directory = await temp(t); let calls = 0;
  const promise = downloadFeed({url: URL, directory, mode: 'snapshot', limits: {timeoutMs: 25},
    fetchImpl: async () => { calls++; return new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array([31, 139]));}})); }});
  // Keep this test alive; AbortSignal.timeout deliberately uses an unref timer.
  const keepAlive = setInterval(() => {}, 100);
  try { await assert.rejects(promise, {code: 'FEED_TIMEOUT'}); } finally {clearInterval(keepAlive);}
  assert.equal(calls, 1); assert.deepEqual(await fs.readdir(directory), []);
});

test('oversized declared body is cancelled before reading or publishing it', async t => {
  const directory = await temp(t); let cancelled = false;
  await assert.rejects(downloadFeed({url: URL, directory, mode: 'snapshot', limits: {compressed: 5},
    fetchImpl: async () => new Response(new ReadableStream({cancel() {cancelled = true;}}),
      {headers: {'content-length': '999'}})}), {code: 'FEED_COMPRESSED_LIMIT'});
  assert.equal(cancelled, true); assert.deepEqual(await fs.readdir(directory), []);
});
