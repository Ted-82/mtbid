'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {gzipSync} = require('node:zlib');
const {createHash} = require('node:crypto');
const {LIMITS, prepareFeedArchive, readFeedBucket} = require('../sync/feed-worker-archive.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const when = '2026-10-29T10:30:00.000Z';
const small = {line: 2048, buffered: 8192, chunk: 512, records: 1000};
const event = (sequence, lot = '12', platform = 'iaai', extra = {}) => ({sequence, event_id: `opaque-event-${sequence}`,
  event: 'bid.changed', terminal: false, vehicle: {platform, lot_number: lot, vin: 'SALZP2FX8PH185647'},
  changed_fields: ['pricing.current_bid_usd'], before: {'pricing.current_bid_usd': 20},
  after: {'pricing.current_bid_usd': null}, recorded_at: '2026-10-29T10:00:00Z', ...extra});
class MemoryBucket {
  constructor() {this.objects = new Map(); this.calls = []; this.failOnce = null; this.sourceChunk = 11;}
  async get(key) {
    this.calls.push(['get', key]); const data = this.objects.get(key); if (!data) return null;
    let offset = 0; const chunkSize = this.sourceChunk;
    return {size: data.length, body: new ReadableStream({pull(controller) {
      if (offset === data.length) {controller.close(); return;}
      const end = Math.min(offset + chunkSize, data.length); controller.enqueue(new Uint8Array(data.subarray(offset, end))); offset = end;
    }})};
  }
  async put(key, bytes, options) {
    this.calls.push(['put', key]);
    if (this.failOnce?.(key)) {this.failOnce = null; throw Error('private-storage-detail-must-not-leak');}
    if (options?.onlyIf?.etagDoesNotMatch === '*' && this.objects.has(key)) return null;
    const data = Buffer.from(bytes);
    if (this.objects.has(key)) assert.deepEqual(data, this.objects.get(key), 'immutable key changed bytes');
    this.objects.set(key, data); return {key, size: data.length};
  }
}
function fixture(rows, extra = {}) {
  const bucket = new MemoryBucket(), bytes = gzipSync(typeof rows === 'string' ? rows : rows.map(JSON.stringify).join('\n') + (rows.length ? '\n' : ''));
  bucket.objects.set('input/feed.gz', bytes);
  return {bucket, bytes, options: {bucket, rawKey: 'input/feed.gz', rawSha256: sha(bytes), prefix: 'private/archive',
    observedAt: when, bucketCount: 4, limits: small, ...extra}};
}
function noManifest(bucket) {
  assert.ok(![...bucket.objects.keys()].some(key => /\/manifest(?:-|\.)/.test(key)), 'invalid stream published a manifest');
}
async function allBuckets(bucket, result) {
  const output = [];
  for (let bucketIndex = 0; bucketIndex < result.manifest.bucketCount; bucketIndex++) output.push(await readFeedBucket({bucket, manifest: result, bucketIndex}));
  return output;
}

test('streaming archive returns complete sorted LOT groups, raw hydrated records, gaps and explicit quarantine', async () => {
  const hydrated = {platform: 'iaai', lot_number: '2', vin: 'SALZP2FX8PH185647', updated_at: '2026-10-29T10:01:00Z',
    title: 'Żółty samochód 🚙', media: {items: [{type: 'image', url: 'https://example.com/car.jpg'}]}};
  const rows = [event(3, '2', 'iaai', {event: 'lot.created', before: [], record: hydrated}),
    event(8, '10', 'copart'), event(12, '2'), event(21, '10', 'copart', {vehicle: {platform: 'copart', lot_number: '10', vin: 'BROKEN\u001aVIN'}})];
  const f = fixture(rows), result = await prepareFeedArchive(f.options);
  assert.equal(result.manifest.state, 'ready'); assert.equal(result.manifest.records, 4);
  assert.equal(result.manifest.quarantined, 1); assert.equal(result.manifest.uniqueLots, 2);
  assert.equal(result.manifest.firstSequence, 3); assert.equal(result.manifest.lastSequence, 21);
  assert.equal(result.manifest.databaseApplied, false); assert.equal(result.manifest.continuityVerified, false);
  assert.ok(result.peakBufferedBytes <= small.buffered); assert.equal(result.operations, f.bucket.calls.length);
  const buckets = await allBuckets(f.bucket, result), groups = buckets.flatMap(x => x.groups).sort((a, b) => `${a.platform}:${a.lot}`.localeCompare(`${b.platform}:${b.lot}`));
  assert.deepEqual(groups.map(x => [x.platform, x.lot, x.events.map(e => e.sequence)]), [['copart', '10', [8, 21]], ['iaai', '2', [3, 12]]]);
  assert.deepEqual(groups[1].events[0], rows[0]); assert.deepEqual(groups[0].events[1], rows[3]);
  assert.deepEqual(groups[0].quarantinedSequences, [21]);
  assert.equal(buckets.reduce((n, x) => n + x.quarantine.length, 0), 1);
  for (let i = 0; i < buckets.length; i++) assert.equal(buckets[i].bucketSha256, result.manifest.buckets[i].bucketSha256);
});

test('replay reuses original capture time and immutable ready manifest without reprocessing raw input', async () => {
  const f = fixture([event(1), event(9)]), first = await prepareFeedArchive(f.options), before = f.bucket.calls.length;
  const second = await prepareFeedArchive({...f.options, observedAt: '2026-10-30T12:00:00Z'});
  assert.equal(second.reused, true); assert.equal(second.operations, 1);
  assert.deepEqual(second.manifest, first.manifest); assert.equal(second.manifestSha256, first.manifestSha256);
  assert.equal(second.manifest.observedAt, when); assert.equal(f.bucket.calls.length - before, 1);
});

test('async progress heartbeat is awaited after every R2 operation and before prepare, reuse and reader return', async () => {
  const f = fixture(Array.from({length: 8}, (_, i) => event(i + 1, String(i % 3))));
  let heartbeatActive = false; const phases = [];
  for (const method of ['get', 'put']) {
    const original = f.bucket[method].bind(f.bucket);
    f.bucket[method] = async (...args) => {assert.equal(heartbeatActive, false, 'R2 advanced before renewal completed'); return original(...args);};
  }
  const onProgress = async progress => {
    assert.equal(heartbeatActive, false, 'heartbeat overlapped'); heartbeatActive = true;
    await new Promise(resolve => setImmediate(resolve)); phases.push(progress.phase); heartbeatActive = false;
  };
  const prepared = await prepareFeedArchive({...f.options, onProgress});
  assert.equal(heartbeatActive, false); assert.equal(phases.at(-1), 'ready');
  assert.equal(phases.filter(phase => phase === 'get' || phase === 'put').length, prepared.operations);
  const reused = await prepareFeedArchive({...f.options, onProgress}); assert.equal(reused.reused, true);
  assert.equal(heartbeatActive, false); assert.equal(phases.at(-1), 'reused');
  const bucketIndex = prepared.manifest.buckets.find(item => item.records).index;
  await readFeedBucket({bucket: f.bucket, manifest: prepared, bucketIndex, onProgress});
  assert.equal(heartbeatActive, false); assert.equal(phases.at(-1), 'read-chunk');
});

test('rejected async heartbeat aborts before the next R2 operation and does not publish a ready manifest', async () => {
  for (const failPhase of ['get', 'put', 'chunk']) {
    const f = fixture(Array.from({length: 8}, (_, i) => event(i + 1, String(i % 3)))); let callsAtFailure;
    const onProgress = async progress => {if (progress.phase === failPhase) {
      callsAtFailure = f.bucket.calls.length; await new Promise(resolve => setImmediate(resolve));
      throw Error('private-renewal-detail');
    }};
    await assert.rejects(prepareFeedArchive({...f.options, onProgress}), {code: 'FEED_ARCHIVE_PROGRESS_FAILED'});
    assert.equal(f.bucket.calls.length, callsAtFailure); noManifest(f.bucket);
  }
});

test('partial-write retry regenerates deterministic chunks and preserves first capture timestamp', async () => {
  const f = fixture(Array.from({length: 20}, (_, i) => event(i + 1, String(i % 3))));
  f.bucket.failOnce = key => key.includes('/chunk-1-');
  await assert.rejects(prepareFeedArchive(f.options), {code: 'FEED_ARCHIVE_STORAGE_FAILED'}); noManifest(f.bucket);
  const firstArtifacts = new Map([...f.bucket.objects].filter(([key]) => key.includes('/chunk-')));
  const result = await prepareFeedArchive({...f.options, observedAt: '2026-11-01T00:00:00Z'});
  assert.equal(result.manifest.observedAt, when); assert.equal(result.manifest.records, 20);
  for (const [key, bytes] of firstArtifacts) assert.deepEqual(f.bucket.objects.get(key), bytes);
});

test('larger bounded operation budget resumes a partial legacy capture without changing its policy or artifacts', async () => {
  const rows = Array.from({length: 20}, (_, i) => event(i + 1, String(i % 3)));
  const f = fixture(rows), legacy = {...small, operations: 8};
  await assert.rejects(prepareFeedArchive({...f.options, limits: legacy}), {code: 'FEED_ARCHIVE_OPERATION_LIMIT'});
  assert.equal(f.bucket.calls.length, 8);
  const captureKey = [...f.bucket.objects.keys()].find(key => key.endsWith('/capture.json'));
  const originalCapture = Buffer.from(f.bucket.objects.get(captureKey));
  const originalChunks = new Map([...f.bucket.objects].filter(([key]) => key.includes('/chunk-')));
  const prepared = await prepareFeedArchive({...f.options, limits: {...small, operations: LIMITS.operations}, observedAt: '2026-11-01T00:00:00Z'});
  assert.equal(prepared.manifest.records, rows.length); assert.equal(prepared.manifest.observedAt, when);
  assert.equal(prepared.manifest.limits.operations, legacy.operations);
  assert.ok(prepared.operations > legacy.operations && prepared.operations <= LIMITS.operations);
  assert.deepEqual(f.bucket.objects.get(captureKey), originalCapture);
  for (const [key, bytes] of originalChunks) assert.deepEqual(f.bucket.objects.get(key), bytes);
  const readyBytes = Buffer.from(f.bucket.objects.get(prepared.manifestKey));
  const replay = await prepareFeedArchive({...f.options, limits: {...small, operations: LIMITS.operations}});
  assert.equal(replay.reused, true); assert.equal(replay.operations, 1);
  assert.equal(replay.manifestSha256, prepared.manifestSha256);
  assert.deepEqual(f.bucket.objects.get(prepared.manifestKey), readyBytes);
  assert.deepEqual((await allBuckets(f.bucket, prepared)).flatMap(bucket => bucket.groups).flatMap(group => group.events).sort((a,b) => a.sequence-b.sequence), rows);
});

test('operation-only compatibility still rejects every changed content limit and invalid or tampered policies', async () => {
  for (const change of [{chunk: 256}, {decoded: LIMITS.decoded - 1}, {records: 999}, {materialized: LIMITS.materialized - 1}]) {
    const f = fixture(Array.from({length: 20}, (_, i) => event(i + 1)));
    await assert.rejects(prepareFeedArchive({...f.options, limits: {...small, operations: 8}}), {code: 'FEED_ARCHIVE_OPERATION_LIMIT'});
    await assert.rejects(prepareFeedArchive({...f.options, limits: {...small, ...change, operations: LIMITS.operations}}), {code: 'FEED_ARCHIVE_SOURCE_CONFLICT'});
    assert.equal([...f.bucket.objects.keys()].some(key => key.endsWith('/manifest.json')), false);
  }
  const f = fixture(Array.from({length: 20}, (_, i) => event(i + 1)));
  await assert.rejects(prepareFeedArchive({...f.options, limits: {...small, operations: 8}}), {code: 'FEED_ARCHIVE_OPERATION_LIMIT'});
  const captureKey = [...f.bucket.objects.keys()].find(key => key.endsWith('/capture.json'));
  const capture = JSON.parse(f.bucket.objects.get(captureKey)); capture.limits.operations = 9;
  f.bucket.objects.set(captureKey, Buffer.from(JSON.stringify(capture)));
  await assert.rejects(prepareFeedArchive({...f.options, limits: {...small, operations: LIMITS.operations}}), {code: 'FEED_ARCHIVE_CAPTURE_HASH_MISMATCH'});
  const before = f.bucket.calls.length;
  await assert.rejects(prepareFeedArchive({...f.options, limits: {...small, operations: LIMITS.operations + 1}}), {code: 'FEED_ARCHIVE_LIMITS_INVALID'});
  assert.equal(f.bucket.calls.length, before);
});

test('empty valid gzip produces a ready archive with empty deterministic bucket digests', async () => {
  const f = fixture([]), result = await prepareFeedArchive(f.options);
  assert.equal(result.manifest.records, 0); assert.equal(result.manifest.firstSequence, null);
  for (const item of await allBuckets(f.bucket, result)) {assert.deepEqual(item.groups, []); assert.equal(item.bucketSha256, sha(''));}
});

test('UTF8 boundaries, CRLF, missing final newline, explicit null and empty patch maps survive', async () => {
  const row = event(17, '9', 'copart', {reason: 'Żółty🚙', before: [], after: {'pricing.current_bid_usd': null}, record: null});
  const f = fixture(JSON.stringify(row) + '\r\n' + JSON.stringify(event(18, '9', 'copart')));
  const result = await prepareFeedArchive(f.options), groups = (await allBuckets(f.bucket, result)).flatMap(x => x.groups);
  assert.deepEqual(groups[0].events[0], row);
});

test('strict global sequence, event-ID uniqueness and full event contract reject malformed feeds', async () => {
  const cases = [
    [event(2), event(1)], [event(2), event(2)],
    [event(1, '1', 'copart'), event(9, '2', 'iaai', {event_id: 'opaque-event-1'})],
    [event(1, 'abc')], [event(1, '1', 'other')], [event(1, '1', 'iaai', {terminal: true})],
    [event(1, '1', 'iaai', {after: null})], [event(1, '1', 'iaai', {record: []})],
    [event(1, '1', 'iaai', {recorded_at: 'not-a-date'})],
    [event(1, '1', 'iaai', {vehicle: {platform: 'iaai', lot_number: '1', vin: 'bad\nvin'}, after: null})]
  ];
  for (const rows of cases) {const f = fixture(rows); await assert.rejects(prepareFeedArchive(f.options), /FEED_ARCHIVE_/); noManifest(f.bucket);}
});

test('growing bounded digest tables preserve all LOTs and detect an old duplicate after rehashing', async () => {
  const rows = Array.from({length: 2500}, (_, i) => event(i + 1, String(i)));
  const options = {bucketCount: 1, limits: {records: 4000, line: 4096, buffered: 256 * 1024, chunk: 128 * 1024}};
  const valid = fixture(rows, options), result = await prepareFeedArchive(valid.options);
  assert.equal(result.manifest.uniqueLots, 2500);
  const read = await readFeedBucket({bucket: valid.bucket, manifest: result, bucketIndex: 0});
  assert.equal(read.records, 2500); assert.equal(read.uniqueLots, 2500);
  const duplicate = fixture([...rows, event(10000, 'new', 'copart', {vehicle: {platform: 'copart', lot_number: '9999', vin: null}, event_id: rows[0].event_id})], options);
  await assert.rejects(prepareFeedArchive(duplicate.options), {code: 'FEED_ARCHIVE_DUPLICATE_EVENT'}); noManifest(duplicate.bucket);
});

test('a modified first-capture receipt cannot change the preserved observation time', async () => {
  const f = fixture(Array.from({length: 8}, (_, i) => event(i + 1)));
  f.bucket.failOnce = key => key.includes('/chunk-0-');
  await assert.rejects(prepareFeedArchive(f.options), {code: 'FEED_ARCHIVE_STORAGE_FAILED'});
  const key = [...f.bucket.objects.keys()].find(x => x.endsWith('/capture.json'));
  const capture = JSON.parse(f.bucket.objects.get(key)); capture.observedAt = '2026-11-01T00:00:00.000Z';
  f.bucket.objects.set(key, Buffer.from(JSON.stringify(capture)));
  await assert.rejects(prepareFeedArchive(f.options), {code: 'FEED_ARCHIVE_CAPTURE_HASH_MISMATCH'}); noManifest(f.bucket);
});

test('bad CRC, truncated gzip, invalid UTF8/JSON, blank lines and raw hash mismatch publish no manifest', async () => {
  const valid = gzipSync(JSON.stringify(event(1)) + '\n'), corrupt = Buffer.from(valid); corrupt[corrupt.length - 8] ^= 1;
  const cases = [corrupt, valid.subarray(0, valid.length - 4), Buffer.from('<html>'), gzipSync(Buffer.from([0xff])),
    gzipSync('{bad-json}\n'), gzipSync(JSON.stringify(event(1)) + '\n\n')];
  for (const bytes of cases) {const f = fixture([]); f.bucket.objects.set('input/feed.gz', bytes);
    await assert.rejects(prepareFeedArchive({...f.options, rawSha256: sha(bytes)}), /FEED_ARCHIVE_/); noManifest(f.bucket);}
  const f = fixture([event(1)]);
  await assert.rejects(prepareFeedArchive({...f.options, rawSha256: 'a'.repeat(64)}), {code: 'FEED_ARCHIVE_RAW_HASH_MISMATCH'}); noManifest(f.bucket);
});

test('compressed, decoded, line, bucket, records and operation limits fail closed', async () => {
  for (const [overrides, code] of [
    [{compressed: 10}, 'FEED_ARCHIVE_COMPRESSED_LIMIT'], [{decoded: 10}, 'FEED_ARCHIVE_DECODED_LIMIT'],
    [{line: 10}, 'FEED_ARCHIVE_LINE_LIMIT'], [{bucket: 10}, 'FEED_ARCHIVE_BUCKET_LIMIT'],
    [{records: 1}, 'FEED_ARCHIVE_RECORD_LIMIT'], [{operations: 4}, 'FEED_ARCHIVE_OPERATION_LIMIT']
  ]) {
    const f = fixture([event(1), event(2)]);
    await assert.rejects(prepareFeedArchive({...f.options, limits: {...small, ...overrides}}), {code});
    assert.ok(![...f.bucket.objects.keys()].some(key => key.endsWith('/manifest.json')));
    assert.ok(f.bucket.calls.length <= (overrides.operations || LIMITS.operations));
  }
});

test('malformed configuration rejects before touching R2', async () => {
  for (const change of [{rawSha256: 'bad'}, {rawKey: '../raw'}, {prefix: 'a/../b'}, {bucketCount: 3},
    {observedAt: '2026-10-29 00:00:00'}, {limits: {buffered: LIMITS.buffered + 1}}, {limits: {unknown: 1}}]) {
    const f = fixture([event(1)]); await assert.rejects(prepareFeedArchive({...f.options, ...change}), /FEED_ARCHIVE_/);
    assert.equal(f.bucket.calls.length, 0);
  }
});

test('reader rejects corrupt shard, corrupt manifest, wrong root hash and materialization overflow', async () => {
  for (const mode of ['chunk', 'bucket-manifest', 'root', 'materialized']) {
    const f = fixture([event(1)]), result = await prepareFeedArchive(f.options);
    const selected = result.manifest.buckets.find(x => x.records), index = selected.index;
    if (mode === 'chunk') {
      const bm = JSON.parse(f.bucket.objects.get(selected.manifestKey)); const bytes = Buffer.from(f.bucket.objects.get(bm.chunks[0].key));
      bytes[0] ^= 1; f.bucket.objects.set(bm.chunks[0].key, bytes);
    } else if (mode === 'bucket-manifest') f.bucket.objects.set(selected.manifestKey, Buffer.from('{}'));
    else if (mode === 'root') result.manifest.records++;
    await assert.rejects(readFeedBucket({bucket: f.bucket, manifest: result, bucketIndex: index,
      ...(mode === 'materialized' ? {limits: {materialized: 100}} : {})}), /FEED_ARCHIVE_/);
  }
});

test('bounded buffer flush keeps all interleaved events of each LOT in one complete returned group', async () => {
  const rows = Array.from({length: 180}, (_, i) => event(i * 3 + 1, String(i % 29), i % 2 ? 'copart' : 'iaai'));
  const f = fixture(rows, {bucketCount: 128}), result = await prepareFeedArchive(f.options);
  assert.ok(result.peakBufferedBytes <= small.buffered);
  const found = (await allBuckets(f.bucket, result)).flatMap(x => x.groups);
  assert.equal(found.reduce((n, g) => n + g.events.length, 0), rows.length);
  for (const group of found) assert.deepEqual(group.events, rows.filter(row => row.vehicle.platform === group.platform && row.vehicle.lot_number === group.lot));
});

test('aborting a stalled raw stream leaves no ready manifest and closes the stream', async () => {
  const f = fixture([]), original = f.bucket.get.bind(f.bucket), controller = new AbortController(); let cancelled = false;
  f.bucket.get = async key => key === 'input/feed.gz'
    ? (f.bucket.calls.push(['get', key]), {body: new ReadableStream({cancel() {cancelled = true;}})}) : original(key);
  const pending = prepareFeedArchive({...f.options, signal: controller.signal});
  const timer = setTimeout(() => controller.abort(), 30);
  try {await assert.rejects(pending, {code: 'FEED_ARCHIVE_ABORTED'});} finally {clearTimeout(timer);}
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(cancelled, true); noManifest(f.bucket);
});

// Optional real-file replay: the caller supplies private paths through an env
// variable. No private fixtures, paths, records, URLs or identifiers enter Git.
// Disk-backed fake R2 keeps external object storage out of heap measurements.
const privateFiles = process.env.REXBID_ARCHIVE_REPLAY_FILES ? JSON.parse(process.env.REXBID_ARCHIVE_REPLAY_FILES) : [];
for (const input of privateFiles) test(`private replay ${input.label}`, async t => {
  const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const {Readable} = require('node:stream');
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'rexbid-worker-archive-'));
  t.after(async () => {
    const resolved = path.resolve(temp), intended = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(intended) && path.basename(resolved).startsWith('rexbid-worker-archive-'));
    await fsp.rm(resolved, {recursive: true, force: true});
  });
  assert.ok(path.isAbsolute(input.file)); const rawStat = await fsp.stat(input.file);
  const stored = new Map([['input/feed.gz', {file: input.file, size: rawStat.size}]]);
  const bucket = {
    async get(key) {const value = stored.get(key); return value ? {size: value.size,
      body: Readable.toWeb(fs.createReadStream(value.file, {highWaterMark: 64 * 1024}))} : null;},
    async put(key, bytes, options) {
      if (options?.onlyIf?.etagDoesNotMatch === '*' && stored.has(key)) return null;
      const hash = sha(bytes), file = path.join(temp, sha(key));
      if (stored.has(key)) assert.equal(stored.get(key).hash, hash);
      else {await fsp.writeFile(file, bytes, {flag: 'wx', mode: 0o600}); stored.set(key, {file, hash, size: bytes.length});}
      return {key, size: bytes.length};
    }
  };
  global.gc?.(); const baseline = process.memoryUsage(), peak = {...baseline};
  const measure = () => {const current = process.memoryUsage(); for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], current[key]);};
  const timer = setInterval(measure, 5), start = performance.now();
  try {
    const result = await prepareFeedArchive({bucket, rawKey: 'input/feed.gz', rawSha256: input.sha256,
      prefix: 'private/replay', observedAt: input.observedAt || when, onProgress: measure});
    const preparedMs = performance.now() - start; measure();
    assert.equal(result.manifest.records, input.records); assert.equal(result.manifest.quarantined, input.quarantined);
    assert.ok(result.operations <= 950); assert.ok(result.peakBufferedBytes <= LIMITS.buffered);
    global.gc?.(); let records = 0, hydratedCreated = 0, quarantined = 0, uniqueLots = 0, readerOperations = 0, largestMaterialized = 0;
    for (let bucketIndex = 0; bucketIndex < result.manifest.bucketCount; bucketIndex++) {
      const read = await readFeedBucket({bucket, manifest: result, bucketIndex, onProgress: measure});
      records += read.records; quarantined += read.quarantined; uniqueLots += read.uniqueLots; readerOperations += read.operations;
      largestMaterialized = Math.max(largestMaterialized, read.materializedBytes);
      for (const group of read.groups) for (const item of group.events) if (item.event === 'lot.created' && item.record) hydratedCreated++;
      measure();
    }
    assert.equal(records, input.records); assert.equal(quarantined, input.quarantined); assert.equal(uniqueLots, result.manifest.uniqueLots);
    console.log(JSON.stringify({benchmark: input.label,records,quarantined,uniqueLots,hydratedCreated,
      prepareMs: Math.round(preparedMs), totalMs: Math.round(performance.now() - start), prepareOperations: result.operations,
      readerOperations, chunks: result.manifest.buckets.reduce((n, b) => n + b.chunkCount, 0),
      largestBucketBytes: Math.max(...result.manifest.buckets.map(x => x.decodedBytes)),
      peakBufferedBytes: result.peakBufferedBytes, largestMaterializedEstimate: largestMaterialized,
      nodeMemoryBaseline: baseline, nodeMemoryPeak: peak, nodeMemoryIncrement: Object.fromEntries(Object.keys(peak).map(key => [key, peak[key] - baseline[key]]))}));
  } finally {clearInterval(timer);}
});
