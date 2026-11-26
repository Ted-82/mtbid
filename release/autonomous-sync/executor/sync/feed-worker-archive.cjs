'use strict';

// Worker runtime: R2 + Web Streams + node:crypto only. The caller owns the
// immutable raw object, its pinned SHA256, and the original observation time.
// No API requests, filesystem, SQLite, or catalog writes occur here.
const {createHash} = require('node:crypto');
const {parseChangesResponse} = require('../providers/apibara.js');
const MiB = 1024 * 1024;
const LIMITS = Object.freeze({compressed: 32 * MiB, decoded: 256 * MiB, line: MiB,
  bucket: 16 * MiB, buffered: 8 * MiB, chunk: 128 * 1024, records: 400000,
  operations: 950, materialized: 64 * MiB});
const LARGE_PACKED_LIMITS = Object.freeze({...LIMITS, records: 800000, decoded: 512 * MiB});
const RECOVERY_PACKED_LIMITS = Object.freeze({...LARGE_PACKED_LIMITS, compressed: 128 * MiB, decoded: 2 * 1024 * MiB, records: 3000000});
const META_LIMIT = MiB;
const encoder = new TextEncoder();
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const fail = code => {throw Object.assign(Error(code), {code});};
const ensure = (condition, code) => {if (!condition) fail(code);};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => encoder.encode(JSON.stringify(value) + '\n');
const keyValid = key => typeof key === 'string' && key.length > 0 && key.length <= 900
  && !/[\u0000-\u0020?#\\]/.test(key) && !key.startsWith('/')
  && !key.split('/').some(part => !part || part === '.' || part === '..');
function limitsOf(options = {}, ceiling = LIMITS) {
  ensure(record(options), 'FEED_ARCHIVE_LIMITS_INVALID');
  for (const [key, value] of Object.entries(options)) ensure(key in LIMITS
    && Number.isSafeInteger(value) && value > 0 && value <= ceiling[key], 'FEED_ARCHIVE_LIMITS_INVALID');
  const limits = {...LIMITS, ...options};
  // Keep room for a flush copy in addition to all pending bucket bytes.
  ensure(limits.line * 2 + limits.chunk + 2 <= limits.buffered, 'FEED_ARCHIVE_LIMITS_INVALID');
  return limits;
}
// Storage-operation counts bound one attempt, not archive bytes or layout.
// A retry may use another already permitted budget without rewriting the first
// capture policy. Every content, validation and memory limit must still match.
function sameContentLimits(stored, requested) {
  return record(stored) && Object.keys(stored).length === Object.keys(LIMITS).length
    && Number.isSafeInteger(stored.operations) && stored.operations > 0 && stored.operations <= LIMITS.operations
    && Object.keys(LIMITS).every(key => Object.hasOwn(stored, key)
      && (key === 'operations' || stored[key] === requested[key]));
}
function layout(prefix, rawSha256, bucketCount) {
  ensure(keyValid(prefix) && prefix.length <= 160 && hex(rawSha256), 'FEED_ARCHIVE_SOURCE_INVALID');
  ensure(Number.isSafeInteger(bucketCount) && bucketCount >= 1 && bucketCount <= 128
    && (bucketCount & (bucketCount - 1)) === 0, 'FEED_ARCHIVE_BUCKET_COUNT_INVALID');
  return `${prefix}/${rawSha256}/v1-b${bucketCount}`;
}
function observation(value) {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), 'FEED_ARCHIVE_TIME_INVALID');
  return new Date(value).toISOString();
}
function checkedError(error, fallback) {
  if (/^FEED_ARCHIVE_[A-Z_]+$/.test(error?.code || '')) throw error;
  fail(fallback);
}

// Bounded exact SHA256 set: at most ~16.5 MiB for 400,000 digests, including
// occupancy, with geometric growth for ordinary smaller files. No event-ID grammar
// (such as chg_<sequence>) is assumed. Hashes are compared in all 256 bits.
class DigestSet {
  constructor(maximum, preallocate = false) {
    this.maximum = maximum; this.count = 0;
    this.maxSlots = 1; while (this.maxSlots * 0.8 < maximum) this.maxSlots *= 2;
    this.slots = preallocate ? this.maxSlots : Math.min(1024, this.maxSlots);
    this.words = new Uint32Array(this.slots * 8); this.occupied = new Uint8Array(this.slots);
  }
  add(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 32);
    let slot = view.getUint32(0) & (this.slots - 1);
    while (this.occupied[slot]) {
      let same = true;
      for (let i = 0; i < 8; i++) if (this.words[slot * 8 + i] !== view.getUint32(i * 4)) {same = false; break;}
      if (same) return false;
      slot = (slot + 1) & (this.slots - 1);
    }
    ensure(this.count < this.maximum, 'FEED_ARCHIVE_RECORD_LIMIT');
    if (this.count + 1 > this.slots * 0.8) {this.grow(); return this.add(bytes);}
    for (let i = 0; i < 8; i++) this.words[slot * 8 + i] = view.getUint32(i * 4);
    this.occupied[slot] = 1; this.count++; return true;
  }
  grow() {
    const oldWords = this.words, oldOccupied = this.occupied;
    const slots = Math.min(this.slots * 2, this.maxSlots);
    ensure(slots > this.slots, 'FEED_ARCHIVE_RECORD_LIMIT');
    this.words = new Uint32Array(slots * 8); this.occupied = new Uint8Array(slots);
    for (let old = 0; old < this.slots; old++) if (oldOccupied[old]) {
      let next = oldWords[old * 8] & (slots - 1);
      while (this.occupied[next]) next = (next + 1) & (slots - 1);
      for (let i = 0; i < 8; i++) this.words[next * 8 + i] = oldWords[old * 8 + i];
      this.occupied[next] = 1;
    }
    this.slots = slots;
  }
}
const hashValue = value => createHash('sha256').update(value).digest();
function bucketFor(platform, lot, bucketCount) {
  const bytes = hashValue(`${platform}:${lot}`);
  return {index: new DataView(bytes.buffer, bytes.byteOffset, 32).getUint32(0) & (bucketCount - 1), bytes};
}
function validateEvent(event, previous) {
  ensure(record(event) && Number.isSafeInteger(event.sequence) && event.sequence > previous, 'FEED_ARCHIVE_SEQUENCE_INVALID');
  ensure(record(event.vehicle) && typeof event.vehicle.lot_number === 'string'
    && /^\d{1,20}$/.test(event.vehicle.lot_number), 'FEED_ARCHIVE_IDENTITY_INVALID');
  if (Object.hasOwn(event, 'record')) ensure(event.record === null || record(event.record), 'FEED_ARCHIVE_RECORD_INVALID');
  const quarantined = typeof event.vehicle.vin === 'string' && /[\u0000-\u001f]/.test(event.vehicle.vin);
  // Validation-only copy. The original VIN, record, patches and JSON line are
  // retained unchanged. Hydrated record validation belongs to its consumer.
  const candidate = quarantined ? {...event, vehicle: {...event.vehicle, vin: null}} : event;
  try { parseChangesResponse({ok: true, data: [candidate], meta: {after: previous,
    next_cursor: event.sequence, has_more: false, count: 1, ordering: 'sequence_asc',
    schema_version: 'worker-feed-validation', retention_days: 14}}, {after: previous, limit: 1}); }
  catch { fail('FEED_ARCHIVE_EVENT_INVALID'); }
  return quarantined;
}

function ioFor(bucket, limits, signal, onProgress) {
  ensure(bucket && typeof bucket.get === 'function' && typeof bucket.put === 'function', 'FEED_ARCHIVE_BUCKET_INVALID');
  ensure(onProgress === undefined || typeof onProgress === 'function', 'FEED_ARCHIVE_PROGRESS_INVALID');
  const stats = {operations: 0, gets: 0, puts: 0, peakBufferedBytes: 0};
  const check = () => {if (signal?.aborted) fail('FEED_ARCHIVE_ABORTED');};
  // Await the caller's heartbeat before another storage operation. Rejected
  // lease renewal must prevent preparation from continuing under a lost lease.
  const progress = async phase => {
    check();
    if (onProgress) {try {await onProgress({phase, ...stats});}
      catch (error) {checkedError(error, 'FEED_ARCHIVE_PROGRESS_FAILED');}}
    check();
  };
  const call = async (method, ...args) => {
    check(); ensure(stats.operations < limits.operations, 'FEED_ARCHIVE_OPERATION_LIMIT');
    stats.operations++; stats[method === 'get' ? 'gets' : 'puts']++;
    let result;
    try {result = await bucket[method](...args);} catch (error) {checkedError(error, 'FEED_ARCHIVE_STORAGE_FAILED');}
    try {await progress(method);} catch (error) {
      if (method === 'get' && typeof result?.body?.cancel === 'function') await result.body.cancel().catch(() => {});
      throw error;
    }
    return result;
  };
  return {stats, check, progress, signal, get: (key, options) => call('get', key, options),
    put: (key, bytes, options) => call('put', key, bytes, options)};
}
async function objectBytes(object, maximum, io) {
  ensure(object && object.body && typeof object.body.getReader === 'function', 'FEED_ARCHIVE_OBJECT_MISSING');
  if (integer(object.size) && object.size > maximum) {
    await object.body.cancel().catch(() => {}); fail('FEED_ARCHIVE_OBJECT_LIMIT');
  }
  const reader = object.body.getReader(), chunks = []; let total = 0;
  const abort = () => {reader.cancel().catch(() => {});};
  io.signal?.addEventListener('abort', abort, {once: true});
  try {
    while (true) {io.check(); const {value, done} = await reader.read(); if (done) break;
      ensure(value instanceof Uint8Array, 'FEED_ARCHIVE_OBJECT_INVALID'); total += value.byteLength;
      ensure(total <= maximum, 'FEED_ARCHIVE_OBJECT_LIMIT'); chunks.push(value);}
  } finally {io.signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock();}
  io.check();
  const output = new Uint8Array(total); let offset = 0;
  for (const bytes of chunks) {output.set(bytes, offset); offset += bytes.length;}
  return output;
}
async function objectJson(object, io) {
  try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await objectBytes(object, META_LIMIT, io)));}
  catch (error) {checkedError(error, 'FEED_ARCHIVE_MANIFEST_INVALID');}
}
async function createOnce(key, value, io, allowExisting = false) {
  const bytes = jsonBytes(value);
  const result = await io.put(key, bytes, {onlyIf: {etagDoesNotMatch: '*'},
    httpMetadata: {contentType: 'application/json'}, customMetadata: {sha256: digest(bytes)}});
  if (result !== null) return value;
  const existing = await objectJson(await io.get(key), io);
  if (!allowExisting) ensure(digest(jsonBytes(existing)) === digest(bytes), 'FEED_ARCHIVE_IMMUTABLE_CONFLICT');
  return existing;
}
// Content-addressed objects always receive identical bytes on retry. Their
// hashes are checked again by readers. No existing logical artifact is changed.
async function putContent(root, name, bytes, io) {
  const sha256 = digest(bytes), key = `${root}/${name}-${sha256}.json`;
  await io.put(key, bytes, {httpMetadata: {contentType: 'application/octet-stream'}, customMetadata: {sha256}});
  return {key, sha256, bytes: bytes.length};
}
async function* lines(body, limits, io, total) {
  const reader = body.getReader(), parts = []; let length = 0;
  const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
  const decode = bytes => {
    try {return decoder.decode(bytes);}
    catch {fail('FEED_ARCHIVE_UTF8_INVALID');}
  };
  function finish() {
    const all = new Uint8Array(length); let offset = 0;
    for (const part of parts) {all.set(part, offset); offset += part.length;}
    parts.length = 0; length = 0;
    let line = decode(all); if (line.endsWith('\r')) line = line.slice(0, -1);
    ensure(line.length > 0, 'FEED_ARCHIVE_LINE_INVALID'); return line;
  }
  const abort = () => {reader.cancel().catch(() => {});};
  total.signal?.addEventListener('abort', abort, {once: true});
  try {
    while (true) {
      io.check(); const {done, value} = await reader.read(); if (done) break;
      ensure(value instanceof Uint8Array, 'FEED_ARCHIVE_STREAM_INVALID');
      total.bytes += value.length; ensure(total.bytes <= limits.decoded, 'FEED_ARCHIVE_DECODED_LIMIT');
      let start = 0;
      for (let i = 0; i < value.length; i++) if (value[i] === 10) {
        const part = value.subarray(start, i); length += part.length;
        ensure(length <= limits.line, 'FEED_ARCHIVE_LINE_LIMIT'); parts.push(part);
        yield finish(); start = i + 1;
      }
      if (start < value.length) {const part = value.slice(start); length += part.length;
        ensure(length <= limits.line, 'FEED_ARCHIVE_LINE_LIMIT'); parts.push(part);}
    }
    io.check(); if (length) yield finish();
  } finally {total.signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock();}
}
function parseLine(line) {try {return JSON.parse(line);} catch {fail('FEED_ARCHIVE_JSON_INVALID');}}
function seal(value) {return {...value, sha256: digest(jsonBytes(value))};}
function validRange(records, first, last) {
  return records === 0 ? first === null && last === null
    : Number.isSafeInteger(first) && first > 0 && Number.isSafeInteger(last) && last >= first
      && records <= last - first + 1;
}
function validateRoot(value, expected = {}) {
  ensure(record(value) && value.version === 1 && value.kind === 'apibara-feed-archive' && value.state === 'ready'
    && hex(value.rawSha256) && keyValid(value.rawKey) && hex(value.sha256), 'FEED_ARCHIVE_MANIFEST_INVALID');
  const {sha256, ...content} = value;
  ensure(digest(jsonBytes(content)) === sha256, 'FEED_ARCHIVE_MANIFEST_HASH_MISMATCH');
  ensure(observation(value.observedAt) === value.observedAt, 'FEED_ARCHIVE_MANIFEST_INVALID');
  const root = layout(value.prefix, value.rawSha256, value.bucketCount);
  const limits = limitsOf(value.limits, value.preparation === 'packed-gzip-routed-fragments-v1' ? RECOVERY_PACKED_LIMITS : LIMITS);
  ensure(Array.isArray(value.buckets) && value.buckets.length === value.bucketCount
    && ['records', 'quarantined', 'uniqueLots', 'decodedBytes', 'compressedBytes'].every(k => integer(value[k]))
    && value.records <= limits.records && value.quarantined <= value.records && value.uniqueLots <= value.records
    && value.decodedBytes <= limits.decoded && value.compressedBytes <= limits.compressed
    && validRange(value.records, value.firstSequence, value.lastSequence), 'FEED_ARCHIVE_MANIFEST_INVALID');
  let count = 0, quarantined = 0, unique = 0, first = null, last = null;
  for (let index = 0; index < value.bucketCount; index++) {
    const item = value.buckets[index];
    ensure(record(item) && item.index === index && keyValid(item.manifestKey)
      && item.manifestKey.startsWith(`${root}/buckets/${index}/manifest-`) && hex(item.manifestSha256)
      && hex(item.bucketSha256) && ['records', 'quarantined', 'uniqueLots', 'decodedBytes', 'chunkCount'].every(k => integer(item[k]))
      && item.decodedBytes <= limits.bucket && item.quarantined <= item.records && item.uniqueLots <= item.records
      && item.manifestKey === `${root}/buckets/${index}/manifest-${item.manifestSha256}.json`
      && validRange(item.records, item.firstSequence, item.lastSequence),
    'FEED_ARCHIVE_MANIFEST_INVALID');
    count += item.records; quarantined += item.quarantined; unique += item.uniqueLots;
    if (item.records) {first = Math.min(first ?? item.firstSequence, item.firstSequence); last = Math.max(last ?? item.lastSequence, item.lastSequence);}
  }
  ensure(count === value.records && quarantined === value.quarantined && unique === value.uniqueLots
    && first === value.firstSequence && last === value.lastSequence, 'FEED_ARCHIVE_MANIFEST_INVALID');
  for (const key of ['rawSha256', 'rawKey', 'prefix', 'bucketCount']) if (expected[key] !== undefined)
    ensure(value[key] === expected[key], 'FEED_ARCHIVE_SOURCE_CONFLICT');
  if (expected.limits) ensure(sameContentLimits(value.limits, expected.limits), 'FEED_ARCHIVE_LIMITS_CONFLICT');
  return root;
}

async function prepareFeedArchive({bucket, rawKey, rawSha256, prefix, observedAt, bucketCount = 128,
  limits: options, signal, onProgress} = {}) {
  const limits = limitsOf(options), root = layout(prefix, rawSha256, bucketCount);
  ensure(keyValid(rawKey), 'FEED_ARCHIVE_SOURCE_INVALID');
  const capturedAt = observation(observedAt), manifestKey = `${root}/manifest.json`;
  const io = ioFor(bucket, limits, signal, onProgress);
  try {
    const saved = await io.get(manifestKey);
    if (saved) {
      const manifest = await objectJson(saved, io);
      validateRoot(manifest, {rawKey, rawSha256, prefix, bucketCount, limits});
      await io.progress('reused');
      return {manifest, manifestKey, manifestSha256: digest(jsonBytes(manifest)), ...io.stats, reused: true};
    }
    const capture = await createOnce(`${root}/capture.json`, seal({version: 1, rawKey, rawSha256,
      prefix, bucketCount, observedAt: capturedAt, limits}), io, true);
    ensure(record(capture) && capture.version === 1 && capture.rawKey === rawKey && capture.rawSha256 === rawSha256
      && capture.prefix === prefix && capture.bucketCount === bucketCount
      && sameContentLimits(capture.limits, limits), 'FEED_ARCHIVE_SOURCE_CONFLICT');
    const {sha256: captureHash, ...captureContent} = capture;
    ensure(hex(captureHash) && digest(jsonBytes(captureContent)) === captureHash, 'FEED_ARCHIVE_CAPTURE_HASH_MISMATCH');
    const firstObservedAt = observation(capture.observedAt);
    const raw = await io.get(rawKey);
    ensure(raw && raw.body && typeof raw.body.pipeThrough === 'function', 'FEED_ARCHIVE_RAW_MISSING');
    if (integer(raw.size) && raw.size > limits.compressed) {
      await raw.body.cancel().catch(() => {}); fail('FEED_ARCHIVE_COMPRESSED_LIMIT');
    }
    const ids = new DigestSet(limits.records), identities = new DigestSet(limits.records);
    const states = Array.from({length: bucketCount}, (_, index) => ({index, records: 0, quarantined: 0,
      uniqueLots: 0, decodedBytes: 0, firstSequence: null, lastSequence: null, hash: createHash('sha256'),
      chunks: [], pending: [], buffered: 0, pendingRecords: 0, pendingQuarantined: 0,
      pendingFirst: null, pendingLast: null}));
    let buffered = 0, compressedBytes = 0, previous = 0, records = 0, quarantined = 0;
    let firstSequence = null, firstRecordedAt = null, lastRecordedAt = null;
    const compressedHash = createHash('sha256');
    const meter = new TransformStream({transform(bytes, controller) {
      io.check(); ensure(bytes instanceof Uint8Array, 'FEED_ARCHIVE_STREAM_INVALID');
      compressedBytes += bytes.length; ensure(compressedBytes <= limits.compressed, 'FEED_ARCHIVE_COMPRESSED_LIMIT');
      compressedHash.update(bytes); controller.enqueue(bytes);
    }});
    const total = {bytes: 0, signal};
    const pendingBudget = limits.buffered - limits.line - limits.chunk - 1;
    async function flush(state) {
      if (!state.buffered) return;
      ensure(buffered + state.buffered <= limits.buffered, 'FEED_ARCHIVE_BUFFER_LIMIT');
      io.stats.peakBufferedBytes = Math.max(io.stats.peakBufferedBytes, buffered + state.buffered);
      const data = new Uint8Array(state.buffered); let offset = 0;
      for (const bytes of state.pending) {data.set(bytes, offset); offset += bytes.length;}
      const savedChunk = await putContent(root, `buckets/${state.index}/chunk-${state.chunks.length}`, data, io);
      state.chunks.push({...savedChunk, records: state.pendingRecords, quarantined: state.pendingQuarantined,
        firstSequence: state.pendingFirst, lastSequence: state.pendingLast});
      buffered -= state.buffered; state.pending = []; state.buffered = 0; state.pendingRecords = 0;
      state.pendingQuarantined = 0; state.pendingFirst = null; state.pendingLast = null; await io.progress('chunk');
    }
    try {
      const decoded = raw.body.pipeThrough(meter).pipeThrough(new DecompressionStream('gzip'));
      for await (const line of lines(decoded, limits, io, total)) {
        ensure(++records <= limits.records, 'FEED_ARCHIVE_RECORD_LIMIT');
        const event = parseLine(line), badVin = validateEvent(event, previous);
        ensure(ids.add(hashValue(event.event_id)), 'FEED_ARCHIVE_DUPLICATE_EVENT');
        const assigned = bucketFor(event.vehicle.platform, event.vehicle.lot_number, bucketCount);
        const state = states[assigned.index], bytes = encoder.encode(line + '\n');
        ensure(state.decodedBytes + bytes.length <= limits.bucket, 'FEED_ARCHIVE_BUCKET_LIMIT');
        while (buffered + bytes.length > pendingBudget) {
          let largest = states[0]; for (const candidate of states) if (candidate.buffered > largest.buffered) largest = candidate;
          ensure(largest.buffered > 0, 'FEED_ARCHIVE_BUFFER_LIMIT'); await flush(largest);
        }
        if (identities.add(assigned.bytes)) state.uniqueLots++;
        state.pending.push(bytes); state.buffered += bytes.length; buffered += bytes.length;
        io.stats.peakBufferedBytes = Math.max(io.stats.peakBufferedBytes, buffered);
        state.records++; state.pendingRecords++; state.decodedBytes += bytes.length;
        state.firstSequence ??= event.sequence; state.lastSequence = event.sequence;
        state.pendingFirst ??= event.sequence; state.pendingLast = event.sequence;
        state.hash.update(bytes); if (badVin) {state.quarantined++; state.pendingQuarantined++; quarantined++;}
        firstSequence ??= event.sequence; previous = event.sequence;
        if (!firstRecordedAt || Date.parse(event.recorded_at) < Date.parse(firstRecordedAt)) firstRecordedAt = event.recorded_at;
        if (!lastRecordedAt || Date.parse(event.recorded_at) > Date.parse(lastRecordedAt)) lastRecordedAt = event.recorded_at;
        if (state.buffered >= limits.chunk) await flush(state);
      }
    } catch (error) {checkedError(error, 'FEED_ARCHIVE_GZIP_INVALID');}
    ensure(compressedHash.digest('hex') === rawSha256, 'FEED_ARCHIVE_RAW_HASH_MISMATCH');
    if (integer(raw.size)) ensure(raw.size === compressedBytes, 'FEED_ARCHIVE_RAW_SIZE_MISMATCH');
    for (const state of states) await flush(state);
    const buckets = [];
    // No bucket or ready manifest is published until EOF, CRC, source hash,
    // global event IDs, sequence ordering and every event have all passed.
    for (const state of states) {
      const body = {version: 1, rawSha256, index: state.index, bucketCount, observedAt: firstObservedAt,
        records: state.records, quarantined: state.quarantined, uniqueLots: state.uniqueLots,
        decodedBytes: state.decodedBytes, firstSequence: state.firstSequence, lastSequence: state.lastSequence,
        bucketSha256: state.hash.digest('hex'), chunks: state.chunks};
      const stored = await putContent(root, `buckets/${state.index}/manifest`, jsonBytes(body), io);
      buckets.push({index: state.index, manifestKey: stored.key, manifestSha256: stored.sha256,
        records: body.records, quarantined: body.quarantined, uniqueLots: body.uniqueLots,
        decodedBytes: body.decodedBytes, firstSequence: body.firstSequence, lastSequence: body.lastSequence,
        bucketSha256: body.bucketSha256, chunkCount: body.chunks.length});
    }
    const manifest = seal({version: 1, kind: 'apibara-feed-archive', state: 'ready', prefix, rawKey, rawSha256,
      observedAt: firstObservedAt, bucketCount, limits: capture.limits, compressedBytes, decodedBytes: total.bytes,
      records, quarantined, uniqueLots: identities.count, firstSequence, lastSequence: records ? previous : null,
      firstRecordedAt, lastRecordedAt, buckets, databaseApplied: false, continuityVerified: false});
    validateRoot(manifest);
    await createOnce(manifestKey, manifest, io); await io.progress('ready');
    return {manifest, manifestKey, manifestSha256: digest(jsonBytes(manifest)), ...io.stats, reused: false};
  } catch (error) {checkedError(error, 'FEED_ARCHIVE_FAILED');}
}

// Conservative retained-object estimate, additional to the hard raw bucket
// limit. It bounds materialization before keeping another parsed event/group.
function objectWeight(value) {
  let result = 0; const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') result += 32 + item.length * 2;
    else if (Array.isArray(item)) {result += 64 + item.length * 16; for (const child of item) pending.push(child);}
    else if (record(item)) {result += 64; for (const [key, child] of Object.entries(item)) {result += 64 + key.length * 2; pending.push(child);}}
    else result += 16;
  }
  return result;
}
async function readFeedBucket({bucket, manifest: supplied, bucketIndex, signal, onProgress, limits: overrides, windowed = false} = {}) {
  const manifest = supplied?.manifest ?? supplied, root = validateRoot(manifest);
  if (supplied?.manifest) ensure(supplied.manifestSha256 === digest(jsonBytes(manifest)), 'FEED_ARCHIVE_MANIFEST_HASH_MISMATCH');
  const limits = limitsOf({...manifest.limits, ...overrides}, manifest.preparation === 'packed-gzip-routed-fragments-v1' ? RECOVERY_PACKED_LIMITS : LIMITS);
  ensure(Number.isSafeInteger(bucketIndex) && bucketIndex >= 0 && bucketIndex < manifest.bucketCount, 'FEED_ARCHIVE_BUCKET_INDEX_INVALID');
  const io = ioFor(bucket, limits, signal, onProgress), expected = manifest.buckets[bucketIndex];
  const bytes = await objectBytes(await io.get(expected.manifestKey), META_LIMIT, io);
  ensure(digest(bytes) === expected.manifestSha256, 'FEED_ARCHIVE_BUCKET_MANIFEST_HASH_MISMATCH');
  let saved; try {saved = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));}
  catch {fail('FEED_ARCHIVE_MANIFEST_INVALID');}
  ensure(record(saved) && saved.version === 1 && saved.rawSha256 === manifest.rawSha256
    && saved.index === bucketIndex && saved.bucketCount === manifest.bucketCount && saved.observedAt === manifest.observedAt
    && Array.isArray(saved.chunks) && saved.chunks.length === expected.chunkCount, 'FEED_ARCHIVE_BUCKET_MANIFEST_INVALID');
  for (const key of ['records', 'quarantined', 'uniqueLots', 'decodedBytes', 'firstSequence', 'lastSequence', 'bucketSha256'])
    ensure(saved[key] === expected[key], 'FEED_ARCHIVE_BUCKET_MANIFEST_INVALID');
  ensure(expected.decodedBytes <= limits.bucket && expected.records <= limits.records, 'FEED_ARCHIVE_BUCKET_LIMIT');
  const encoded = windowed ? new Map() : null;
  const groups = new Map(), ids = new DigestSet(Math.max(1, expected.records)), quarantine = [];
  let records = 0, previous = 0, firstSequence = null, decodedBytes = 0, materializedBytes = 0;
  const completeHash = createHash('sha256');
  async function readChunk(chunkIndex) {
    const chunk = saved.chunks[chunkIndex];
    const packed = chunk?.encoding === 'gzip-packed', gzip = chunk?.encoding === 'gzip' || packed;
    ensure(record(chunk) && (packed ? !Object.hasOwn(chunk, 'key') : keyValid(chunk.key)) && hex(chunk.sha256)
      && (!Object.hasOwn(chunk, 'encoding') || gzip)
      && integer(chunk.bytes) && chunk.bytes > 0 && chunk.bytes <= limits.buffered && integer(chunk.records)
      && chunk.records > 0 && integer(chunk.quarantined), 'FEED_ARCHIVE_CHUNK_INVALID');
    let content;
    if (gzip) {
      ensure(hex(chunk.storedSha256) && integer(chunk.storedBytes) && chunk.storedBytes > 0
        && chunk.storedBytes <= chunk.bytes + 65536, 'FEED_ARCHIVE_CHUNK_INVALID');
      let compressed;
      if (packed) {
        ensure(manifest.preparation === 'packed-gzip-routed-fragments-v1' && integer(chunk.packIndex)
          && Array.isArray(manifest.packs) && manifest.packs.length <= LIMITS.operations && chunk.packIndex < manifest.packs.length, 'FEED_ARCHIVE_CHUNK_INVALID');
        const pack = manifest.packs[chunk.packIndex];
        ensure(record(pack) && pack.index === chunk.packIndex && hex(pack.sha256)
          && pack.key === `${root}/windows/pack-${chunk.packIndex}-${pack.sha256}.bin`
          && integer(pack.bytes) && pack.bytes > 0 && pack.bytes <= 16 * MiB
          && integer(chunk.packOffset) && chunk.packOffset + chunk.storedBytes <= pack.bytes, 'FEED_ARCHIVE_CHUNK_INVALID');
        const object = await io.get(pack.key, {range: {offset: chunk.packOffset, length: chunk.storedBytes}});
        if (!object || object.size !== pack.bytes || object.range?.offset !== chunk.packOffset || object.range?.length !== chunk.storedBytes) {
          await object?.body?.cancel().catch(() => {}); fail('FEED_ARCHIVE_CHUNK_RANGE_INVALID');
        }
        compressed = await objectBytes({body: object.body, size: chunk.storedBytes}, chunk.storedBytes, io);
      } else {
        ensure(manifest.preparation === 'bounded-gzip-routed-fragments-v1'
          && chunk.key === `${root}/buckets/${bucketIndex}/chunk-${chunkIndex}-${chunk.storedSha256}.json.gz`, 'FEED_ARCHIVE_CHUNK_INVALID');
        compressed = await objectBytes(await io.get(chunk.key), chunk.bytes + 65536, io);
      }
      ensure(compressed.length === chunk.storedBytes && digest(compressed) === chunk.storedSha256, 'FEED_ARCHIVE_CHUNK_HASH_MISMATCH');
      try {
        const source = new ReadableStream({start(controller) {controller.enqueue(compressed); controller.close();}});
        content = await objectBytes({body: source.pipeThrough(new DecompressionStream('gzip'))}, chunk.bytes, io);
      } catch (error) {checkedError(error, 'FEED_ARCHIVE_CHUNK_GZIP_INVALID');}
    } else {
      ensure(chunk.key === `${root}/buckets/${bucketIndex}/chunk-${chunkIndex}-${chunk.sha256}.json`, 'FEED_ARCHIVE_CHUNK_INVALID');
      content = await objectBytes(await io.get(chunk.key), Math.min(limits.buffered, limits.bucket), io);
    }
    return content;
  }
  let preparedChunks = [];
  for (let chunkIndex = 0; chunkIndex < saved.chunks.length; chunkIndex++) {
    const chunk = saved.chunks[chunkIndex];
    if (!preparedChunks.length) {
      // Packed fragments are independent ranges. Read a small group together,
      // then parse and hash it in manifest order using the existing checks.
      let count = 1, groupBytes = chunk?.bytes;
      while (count < 4 && Number.isSafeInteger(groupBytes) && groupBytes > 0 && chunk?.encoding === "gzip-packed") {
        const next = saved.chunks[chunkIndex + count];
        if (next?.encoding !== "gzip-packed" || !Number.isSafeInteger(next.bytes)
          || next.bytes < 1 || groupBytes + next.bytes > limits.buffered) break;
        groupBytes += next.bytes;
        count++;
      }
      const reads = await Promise.allSettled(Array.from({length: count}, (_, index) => readChunk(chunkIndex + index)));
      for (const read of reads) {
        if (read.status === "rejected") throw read.reason;
        preparedChunks.push(read.value);
      }
    }
    const content = preparedChunks.shift();
    ensure(content.length === chunk.bytes && digest(content) === chunk.sha256, 'FEED_ARCHIVE_CHUNK_HASH_MISMATCH');
    ensure(content.length && content[content.length - 1] === 10, 'FEED_ARCHIVE_CHUNK_INVALID');
    decodedBytes += content.length; ensure(decodedBytes <= limits.bucket, 'FEED_ARCHIVE_BUCKET_LIMIT');
    completeHash.update(content); let count = 0, bad = 0, first = null, last = null, offset = 0;
    for (let at = 0; at < content.length; at++) if (content[at] === 10) {
      const lineOffset = offset;
      ensure(at - offset <= limits.line, 'FEED_ARCHIVE_LINE_LIMIT');
      let line; try {line = new TextDecoder('utf-8', {fatal: true}).decode(content.subarray(offset, at));}
      catch {fail('FEED_ARCHIVE_UTF8_INVALID');} offset = at + 1;
      const event = parseLine(line), quarantined = validateEvent(event, previous);
      ensure(ids.add(hashValue(event.event_id)), 'FEED_ARCHIVE_DUPLICATE_EVENT');
      ensure(bucketFor(event.vehicle.platform, event.vehicle.lot_number, manifest.bucketCount).index === bucketIndex,
        'FEED_ARCHIVE_BUCKET_IDENTITY_MISMATCH');
      ensure(++records <= limits.records, 'FEED_ARCHIVE_RECORD_LIMIT');
      const weight = objectWeight(event) + 160;
      if (!encoded) {materializedBytes += weight; ensure(materializedBytes <= limits.materialized, 'FEED_ARCHIVE_MATERIALIZED_LIMIT');}
      const identity = `${event.vehicle.platform}:${event.vehicle.lot_number}`;
      if (!groups.has(identity)) groups.set(identity, {platform: event.vehicle.platform,
        lot: event.vehicle.lot_number, events: [], quarantinedSequences: []});
      const group = groups.get(identity);
      if (encoded) {
        let saved = encoded.get(group);
        if (!saved) {saved = {lines: [], weight: 0}; encoded.set(group, saved);}
        saved.lines.push(content.subarray(lineOffset, at));
        saved.weight += weight;
        group.events.length = saved.lines.length;
      } else group.events.push(event);
      if (quarantined) {bad++; group.quarantinedSequences.push(event.sequence); quarantine.push({sequence: event.sequence,
        eventId: event.event_id, platform: group.platform, lot: group.lot,
        reason: 'invalid_vin_control_character', rawLineSha256: digest(encoder.encode(line))});}
      firstSequence ??= event.sequence; previous = event.sequence; first ??= event.sequence; last = event.sequence; count++;
    }
    ensure(count === chunk.records && bad === chunk.quarantined && first === chunk.firstSequence && last === chunk.lastSequence,
      'FEED_ARCHIVE_CHUNK_COUNTS_INVALID'); await io.progress('read-chunk');
  }
  const bucketSha256 = completeHash.digest('hex');
  ensure(records === expected.records && quarantine.length === expected.quarantined && groups.size === expected.uniqueLots
    && decodedBytes === expected.decodedBytes && firstSequence === expected.firstSequence
    && (records ? previous : null) === expected.lastSequence && bucketSha256 === expected.bucketSha256,
  'FEED_ARCHIVE_BUCKET_COUNTS_INVALID');
  const ordered = [...groups.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([, group]) => group);
  // A large delivery can have far more decoded events per bucket than a safe
  // transaction can retain. Keep the validated UTF-8 bytes and materialize an
  // offset-stable prefix only. Counts of earlier groups remain available for
  // receipt checksums. No database or object-store state is changed here.
  let loaded = [];
  function materializeWindow(offset) {
    ensure(integer(offset) && offset <= ordered.length, 'FEED_ARCHIVE_BUCKET_INDEX_INVALID');
    for (const group of loaded) group.events = new Array(encoded.get(group).lines.length);
    loaded = [];
    let end = offset, weight = 0;
    while (end < ordered.length && end - offset < 300) {
      const group = ordered[end], saved = encoded.get(group);
      if (weight + saved.weight > limits.materialized) break;
      weight += saved.weight;
      group.events = saved.lines.map(bytes => JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)));
      loaded.push(group); end++;
    }
    ensure(end > offset || offset === ordered.length, 'FEED_ARCHIVE_MATERIALIZED_LIMIT');
    return end;
  }
  return {...(encoded ? {materializeWindow} : {}), groups: ordered, records, quarantined: quarantine.length, quarantine, uniqueLots: groups.size,
    firstSequence, lastSequence: records ? previous : null, bucketSha256, decodedBytes, materializedBytes, ...io.stats};
}
// Share the established source/reader validation with the opt-in bounded writer.
const archiveStepDependencies = {
  LIMITS, LARGE_PACKED_LIMITS, RECOVERY_PACKED_LIMITS, limitsOf, sameContentLimits, layout, observation, ioFor, objectJson,
  objectBytes, createOnce, putContent, lines, validateEvent, bucketFor, DigestSet,
  hashValue, seal, validateRoot, jsonBytes, digest, encoder, ensure, record, hex,
  integer, checkedError, keyValid
};
const {createBoundedArchivePreparer} = require('./feed-worker-archive-step.cjs');
const prepareFeedArchiveStep = createBoundedArchivePreparer(archiveStepDependencies);
const prepareFeedArchivePackedStep = createBoundedArchivePreparer(archiveStepDependencies, {packed: true});
module.exports = {validateFeedArchiveManifest: validateRoot, LIMITS, prepareFeedArchive, prepareFeedArchiveStep, prepareFeedArchivePackedStep, readFeedBucket};
