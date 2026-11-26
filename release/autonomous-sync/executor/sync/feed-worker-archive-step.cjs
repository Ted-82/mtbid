'use strict';

// Durable preparation in bounded R2-only steps. The source gzip is decoded once;
// validated gzip spool chunks carry fixed routing headers so fanout never
// reparses vehicle JSON. Final bucket chunks retain the original JSON lines.
// Nothing here acquires a D1 lease or advances a catalogue/global cursor.
function createBoundedArchivePreparer(p, {packed = false} = {}) {
  const {LIMITS, LARGE_PACKED_LIMITS, RECOVERY_PACKED_LIMITS, limitsOf, sameContentLimits, layout, observation, ioFor, objectJson,
    objectBytes, createOnce, putContent, lines, validateEvent, bucketFor, DigestSet,
    hashValue, seal, validateRoot, jsonBytes, digest, encoder, ensure, record, hex,
    integer, checkedError, keyValid} = p;
  const MiB = 1024 * 1024, STRATEGY = packed ? 'packed-gzip-routed-fragments-v1' : 'bounded-gzip-routed-fragments-v1', HEADER_BYTES = 14;
  const DEFAULT_STEP = Object.freeze({spoolBytes: 4 * MiB, fanoutChunks: 2, fragmentBytes: 2 * MiB});
  // Exact LOT identity storage needs only three words, not another SHA256 table.
  // Nine-digit blocks plus length/platform retain leading zeros and all20digits.
  class LotSet {
    constructor(maximum) {this.maximum = maximum; this.count = 0; this.slots = 1;
      while (this.slots * 0.8 < maximum) this.slots *= 2;
      this.words = new Uint32Array(this.slots * 3); this.occupied = new Uint8Array(this.slots);
    }
    add(platform, lot, hash) {
      const a = Number(lot.slice(-9)), b = lot.length > 9 ? Number(lot.slice(-18, -9)) : 0;
      const c = (lot.length > 18 ? Number(lot.slice(0, -18)) : 0) | (lot.length << 7) | (platform === 'iaai' ? 4096 : 0);
      let slot = new DataView(hash.buffer, hash.byteOffset, hash.byteLength).getUint32(0) & (this.slots - 1);
      while (this.occupied[slot]) {
        if (this.words[slot * 3] === a && this.words[slot * 3 + 1] === b && this.words[slot * 3 + 2] === c) return false;
        slot = (slot + 1) & (this.slots - 1);
      }
      ensure(this.count < this.maximum, 'FEED_ARCHIVE_RECORD_LIMIT');
      this.words[slot * 3] = a; this.words[slot * 3 + 1] = b; this.words[slot * 3 + 2] = c;
      this.occupied[slot] = 1; this.count++; return true;
    }
  }
  // Routing metadata follows decoded windows and records, not gzip size. A
  // highly compressible expanded delivery can be below32MiB yet exceed4MiB
  // of checked receipts/manifests. Preserve capture hashes and reuse windows;
  // the same larger bound is admitted before writes and checked at finalize.
  const metadataAllowance = limits => limits.compressed > LIMITS.compressed
    || limits.decoded > LIMITS.decoded || limits.records > LIMITS.records ? 32 * MiB : 4 * MiB;
  function stepOptions(value, limits) {
    ensure(value === undefined || record(value), 'FEED_ARCHIVE_STEP_LIMITS_INVALID');
    const step = {...DEFAULT_STEP, ...value};
    ensure(Object.keys(step).length === 3 && Object.keys(step).every(key => key in DEFAULT_STEP
      && Number.isSafeInteger(step[key]) && step[key] > 0 && step[key] <= DEFAULT_STEP[key])
      && step.spoolBytes >= limits.line * 2 && step.spoolBytes * 2 <= limits.buffered
      && step.fragmentBytes >= limits.line * 2 && step.fragmentBytes <= limits.buffered
      && step.spoolBytes * step.fanoutChunks <= 16 * MiB, 'FEED_ARCHIVE_STEP_LIMITS_INVALID');
    return step;
  }
  function verified(value, kind, capture) {
    ensure(record(value) && value.version === 1 && value.kind === kind && hex(value.sha256), 'FEED_ARCHIVE_STEP_METADATA_INVALID');
    const {sha256, ...content} = value;
    ensure(digest(jsonBytes(content)) === sha256, 'FEED_ARCHIVE_STEP_METADATA_HASH');
    if (capture) ensure(value.captureSha256 === capture.sha256, 'FEED_ARCHIVE_STEP_SOURCE_CONFLICT');
    return value;
  }
  async function readOptional(key, io) {
    const object = await io.get(key);
    return object ? {value: await objectJson(object, io), etag: object.etag} : null;
  }
  function range(count, first, last) {
    return count === 0 ? first === null && last === null
      : integer(count) && Number.isSafeInteger(first) && first > 0 && Number.isSafeInteger(last) && last >= first && count <= last - first + 1;
  }
  function validateSpool(value, capture, root) {
    verified(value, 'bounded-spool', capture);
    ensure(value.format === 'routed-jsonl-v1' && value.headerBytes === HEADER_BYTES, 'FEED_ARCHIVE_STEP_SPOOL_INVALID');
    const limits = capture.limits, step = capture.step;
    ensure(integer(value.records) && value.records <= limits.records && integer(value.quarantined) && value.quarantined <= value.records
      && integer(value.uniqueLots) && value.uniqueLots <= value.records && integer(value.decodedBytes) && value.decodedBytes <= limits.decoded
      && integer(value.spoolCompressedBytes) && value.spoolCompressedBytes <= limits.decoded
      && integer(value.spoolDecodedBytes) && value.spoolDecodedBytes <= limits.decoded + limits.records * HEADER_BYTES
      && integer(value.sourceDecodedBytes) && value.sourceDecodedBytes <= limits.decoded
      && integer(value.compressedBytes) && value.compressedBytes <= limits.compressed
      && range(value.records, value.firstSequence, value.lastSequence)
      && Array.isArray(value.chunks) && value.chunks.length <= Math.ceil(limits.decoded / (step.spoolBytes - limits.line)) + 1
      && Array.isArray(value.buckets) && value.buckets.length === capture.bucketCount, 'FEED_ARCHIVE_STEP_SPOOL_INVALID');
    let records = 0, bytes = 0, spoolBytes = 0, compressedBytes = 0, previous = 0;
    for (let index = 0; index < value.chunks.length; index++) {
      const chunk = value.chunks[index];
      ensure(record(chunk) && hex(chunk.sha256) && chunk.key === `${root}/spool/chunk-${index}-${chunk.sha256}.jsonl.gz`
        && integer(chunk.bytes) && chunk.bytes > 0 && chunk.bytes <= step.spoolBytes + 65536
        && hex(chunk.decodedSha256) && integer(chunk.decodedBytes) && chunk.decodedBytes > 0 && chunk.decodedBytes <= step.spoolBytes
        && integer(chunk.payloadBytes) && chunk.payloadBytes > 0 && chunk.payloadBytes === chunk.decodedBytes - chunk.records * HEADER_BYTES
        && integer(chunk.records) && chunk.records > 0 && range(chunk.records, chunk.firstSequence, chunk.lastSequence)
        && chunk.firstSequence > previous, 'FEED_ARCHIVE_STEP_SPOOL_INVALID');
      previous = chunk.lastSequence; records += chunk.records; bytes += chunk.payloadBytes; spoolBytes += chunk.decodedBytes; compressedBytes += chunk.bytes;
    }
    ensure(records === value.records && bytes === value.decodedBytes && spoolBytes === value.spoolDecodedBytes && compressedBytes === value.spoolCompressedBytes
      && (records ? value.chunks[0].firstSequence === value.firstSequence && previous === value.lastSequence : value.chunks.length === 0), 'FEED_ARCHIVE_STEP_SPOOL_INVALID');
    let bucketRecords = 0, bucketBytes = 0, quarantined = 0, unique = 0;
    for (let index = 0; index < capture.bucketCount; index++) {
      const bucket = value.buckets[index];
      ensure(record(bucket) && bucket.index === index && integer(bucket.records) && integer(bucket.quarantined)
        && bucket.quarantined <= bucket.records && integer(bucket.uniqueLots) && bucket.uniqueLots <= bucket.records
        && integer(bucket.decodedBytes) && bucket.decodedBytes <= limits.bucket && hex(bucket.bucketSha256)
        && range(bucket.records, bucket.firstSequence, bucket.lastSequence), 'FEED_ARCHIVE_STEP_SPOOL_INVALID');
      bucketRecords += bucket.records; bucketBytes += bucket.decodedBytes; quarantined += bucket.quarantined; unique += bucket.uniqueLots;
    }
    ensure(bucketRecords === value.records && bucketBytes === value.decodedBytes && quarantined === value.quarantined && unique === value.uniqueLots,
      'FEED_ARCHIVE_STEP_SPOOL_INVALID');
    return value;
  }
  async function spoolSource({capture, root, io, signal, sourceObject}) {
    const limits = capture.limits, step = capture.step, raw = sourceObject ?? await io.get(capture.rawKey);
    ensure(raw?.body?.pipeThrough, 'FEED_ARCHIVE_RAW_MISSING');
    if (integer(raw.size) && raw.size > limits.compressed) {await raw.body.cancel().catch(() => {}); ensure(false, 'FEED_ARCHIVE_COMPRESSED_LIMIT');}
    // Fixed-capacity tables avoid simultaneous old/new arrays during a large-source rehash.
    const recovery = limits.compressed > LIMITS.compressed;
    const identities = new LotSet(recovery ? Math.min(limits.records, 800000) : limits.records);
    // A numeric chg_ id fits exactly in one double. Other id spellings stay
    // in the original SHA256 set, so leading zeros and arbitrary ids stay distinct.
    let numericSlots = identities.slots;
    while (numericSlots * 0.8 < limits.records) numericSlots *= 2;
    const numericIds = new Float64Array(numericSlots);
    let otherIds;
    function addEventId(id) {
      const number = typeof id === 'string' && id.startsWith('chg_') ? Number(id.slice(4)) : 0;
      if (!Number.isSafeInteger(number) || number <= 0 || id !== 'chg_' + number) {
        otherIds ??= new DigestSet(recovery ? Math.min(limits.records, 400000) : limits.records, !recovery);
        return otherIds.add(hashValue(id));
      }
      // Consecutive safe integers distribute directly over the power-of-two table.
      const low = number >>> 0, high = Math.floor(number / 4294967296);
      let slot = (low ^ Math.imul(high, 2654435761)) & (numericIds.length - 1);
      while (numericIds[slot] !== 0) {
        if (numericIds[slot] === number) return false;
        slot = (slot + 1) & (numericIds.length - 1);
      }
      numericIds[slot] = number;
      return true;
    }
    const buckets = Array.from({length: capture.bucketCount}, (_, index) => ({index, records: 0, quarantined: 0, uniqueLots: 0,
      decodedBytes: 0, firstSequence: null, lastSequence: null, hash: require('node:crypto').createHash('sha256')}));
    let compressedBytes = 0, normalizedBytes = 0, previous = 0, records = 0, quarantined = 0, firstSequence = null,
      firstRecordedAt = null, lastRecordedAt = null, pendingBytes = 0, pendingPayloadBytes = 0, spoolCompressedBytes = 0, pendingRecords = 0, pendingFirst = null, pendingLast = null;
    const pending = [], chunks = [], compressedHash = require('node:crypto').createHash('sha256');
    async function flush() {
      if (!pendingBytes) return;
      const decoded = new Uint8Array(pendingBytes); let decodedOffset = 0;
      for (const part of pending) {decoded.set(part, decodedOffset); decodedOffset += part.length;}
      pending.length = 0; // Release per-record views before awaiting native compression.
      const source = new ReadableStream({start(controller) {controller.enqueue(decoded); controller.close();}});
      const compressed = new Uint8Array(await new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      ensure(compressed.length <= step.spoolBytes + 65536 && spoolCompressedBytes + compressed.length <= Math.min(limits.decoded, LIMITS.decoded),
        'FEED_ARCHIVE_STEP_SPOOL_COMPRESSED_LIMIT');
      spoolCompressedBytes += compressed.length;
      io.stats.peakBufferedBytes = Math.max(io.stats.peakBufferedBytes, pendingBytes * 2 + compressed.length * 2);
      const sha256 = digest(compressed), key = `${root}/spool/chunk-${chunks.length}-${sha256}.jsonl.gz`;
      await io.put(key, compressed, {httpMetadata: {contentType: 'application/gzip'}, customMetadata: {sha256}});
      chunks.push({key, sha256, bytes: compressed.length, decodedBytes: pendingBytes, payloadBytes: pendingPayloadBytes, decodedSha256: digest(decoded),
        records: pendingRecords, firstSequence: pendingFirst, lastSequence: pendingLast});
      pending.length = 0; pendingBytes = 0; pendingPayloadBytes = 0; pendingRecords = 0; pendingFirst = null; pendingLast = null;
      await io.progress('spool-chunk');
    }
    const meter = new TransformStream({transform(bytes, controller) {
      io.check(); ensure(bytes instanceof Uint8Array, 'FEED_ARCHIVE_STREAM_INVALID');
      compressedBytes += bytes.length; ensure(compressedBytes <= limits.compressed, 'FEED_ARCHIVE_COMPRESSED_LIMIT');
      compressedHash.update(bytes); controller.enqueue(bytes);
    }});
    const total = {bytes: 0, signal};
    // lines() owns stream cancellation on timeout/abort through io.check().
    try {
      const decoded = raw.body.pipeThrough(meter).pipeThrough(new DecompressionStream('gzip'));
      for await (const line of lines(decoded, limits, io, total)) {
        ensure(++records <= limits.records, 'FEED_ARCHIVE_RECORD_LIMIT');
        const event = JSON.parse(line), badVin = validateEvent(event, previous);
        ensure(addEventId(event.event_id), 'FEED_ARCHIVE_DUPLICATE_EVENT');
        const assigned = bucketFor(event.vehicle.platform, event.vehicle.lot_number, capture.bucketCount), state = buckets[assigned.index];
        const bytes = encoder.encode(line + '\n');
        ensure(bytes.length <= step.spoolBytes && state.decodedBytes + bytes.length <= limits.bucket, 'FEED_ARCHIVE_BUCKET_LIMIT');
        if (pendingBytes + HEADER_BYTES + bytes.length > step.spoolBytes) await flush();
        const header = new Uint8Array(HEADER_BYTES), view = new DataView(header.buffer);
        view.setUint32(0, bytes.length); view.setUint8(4, assigned.index); view.setUint8(5, badVin ? 1 : 0); view.setFloat64(6, event.sequence);
        pending.push(header, bytes); pendingBytes += HEADER_BYTES + bytes.length; pendingPayloadBytes += bytes.length;
        pendingRecords++; pendingFirst ??= event.sequence; pendingLast = event.sequence;
        normalizedBytes += bytes.length; ensure(normalizedBytes <= limits.decoded, 'FEED_ARCHIVE_DECODED_LIMIT');
        state.records++; state.decodedBytes += bytes.length; state.hash.update(bytes);
        if (identities.add(event.vehicle.platform, event.vehicle.lot_number, assigned.bytes)) state.uniqueLots++;
        if (badVin) {state.quarantined++; quarantined++;}
        state.firstSequence ??= event.sequence; state.lastSequence = event.sequence;
        firstSequence ??= event.sequence; previous = event.sequence;
        if (!firstRecordedAt || Date.parse(event.recorded_at) < Date.parse(firstRecordedAt)) firstRecordedAt = event.recorded_at;
        if (!lastRecordedAt || Date.parse(event.recorded_at) > Date.parse(lastRecordedAt)) lastRecordedAt = event.recorded_at;
      }
    } catch (error) {checkedError(error, 'FEED_ARCHIVE_GZIP_INVALID');}
    ensure(compressedHash.digest('hex') === capture.rawSha256, 'FEED_ARCHIVE_RAW_HASH_MISMATCH');
    if (integer(raw.size)) ensure(raw.size === compressedBytes, 'FEED_ARCHIVE_RAW_SIZE_MISMATCH');
    await flush();
    const value = seal({version: 1, kind: 'bounded-spool', format: 'routed-jsonl-v1', headerBytes: HEADER_BYTES, captureSha256: capture.sha256, records, quarantined,
      uniqueLots: identities.count, compressedBytes, spoolCompressedBytes, spoolDecodedBytes: chunks.reduce((n, chunk) => n + chunk.decodedBytes, 0), sourceDecodedBytes: total.bytes, decodedBytes: normalizedBytes,
      firstSequence, lastSequence: records ? previous : null, firstRecordedAt, lastRecordedAt, chunks,
      buckets: buckets.map(({hash, ...state}) => ({...state, bucketSha256: hash.digest('hex')}))});
    validateSpool(value, capture, root);
    ensure(jsonBytes(value).length <= MiB, 'FEED_ARCHIVE_STEP_METADATA_INVALID');
    await createOnce(`${root}/spool/manifest.json`, value, io);
    return value;
  }
  function initialProgress(capture, spool) {
    return {version: 1, kind: 'bounded-progress', captureSha256: capture.sha256, spoolSha256: spool.sha256,
      nextWindow: 0, chunkCounts: Array(capture.bucketCount).fill(0), receiptBytes: 0, fragmentCompressedBytes: 0};
  }
  function validateProgress(value, capture, spool) {
    verified(value, 'bounded-progress', capture);
    ensure(value.spoolSha256 === spool.sha256 && integer(value.nextWindow)
      && value.nextWindow <= Math.ceil(spool.chunks.length / capture.step.fanoutChunks)
      && Array.isArray(value.chunkCounts) && value.chunkCounts.length === capture.bucketCount && value.chunkCounts.every(integer)
      && integer(value.receiptBytes) && value.receiptBytes <= 2 * metadataAllowance(capture.limits)
      && integer(value.fragmentCompressedBytes) && value.fragmentCompressedBytes <= capture.limits.decoded + MiB, 'FEED_ARCHIVE_STEP_PROGRESS_INVALID');
    return value;
  }
  async function writeProgress(value, prior, root, io) {
    const sealed = seal(value);
    if (prior) ensure(typeof prior.etag === 'string' && prior.etag.length > 0, 'FEED_ARCHIVE_STEP_ETAG_MISSING');
    const saved = await io.put(`${root}/progress.json`, jsonBytes(sealed), {onlyIf: prior ? {etagMatches: prior.etag} : {etagDoesNotMatch: '*'},
      httpMetadata: {contentType: 'application/json'}, customMetadata: {sha256: digest(jsonBytes(sealed))}});
    ensure(saved !== null, 'FEED_ARCHIVE_STEP_PROGRESS_CONFLICT');
    return {value: sealed, etag: saved.etag};
  }
  function windowBounds(index, capture, spool) {
    const start = index * capture.step.fanoutChunks;
    return {start, end: Math.min(start + capture.step.fanoutChunks, spool.chunks.length)};
  }
  function validateWindow(value, index, before, capture, spool, root) {
    verified(value, 'bounded-window', capture);
    const {start, end} = windowBounds(index, capture, spool);
    ensure(value.index === index && value.spoolSha256 === spool.sha256 && value.start === start && value.end === end
      && JSON.stringify(value.beforeCounts) === JSON.stringify(before)
      && Array.isArray(value.chunks) && value.chunks.length === capture.bucketCount
      && Array.isArray(value.afterCounts) && value.afterCounts.length === capture.bucketCount, 'FEED_ARCHIVE_STEP_WINDOW_INVALID');
    let records = 0, bytes = 0;
    for (let bucketIndex = 0; bucketIndex < capture.bucketCount; bucketIndex++) {
      const chunks = value.chunks[bucketIndex]; ensure(Array.isArray(chunks), 'FEED_ARCHIVE_STEP_WINDOW_INVALID');
      let previous = 0;
      for (let position = 0; position < chunks.length; position++) {
        const chunk = chunks[position], number = before[bucketIndex] + position;
        ensure(record(chunk) && hex(chunk.sha256) && chunk.encoding === (packed ? 'gzip-packed' : 'gzip') && hex(chunk.storedSha256)
          && (packed ? record(value.pack) && !Object.hasOwn(chunk, 'key') && chunk.packIndex === index && integer(chunk.packOffset)
            && chunk.packOffset + chunk.storedBytes <= value.pack.bytes
            : chunk.key === `${root}/buckets/${bucketIndex}/chunk-${number}-${chunk.storedSha256}.json.gz`)
          && integer(chunk.storedBytes) && chunk.storedBytes > 0 && chunk.storedBytes <= chunk.bytes + 65536
          && integer(chunk.bytes) && chunk.bytes > 0 && chunk.bytes <= capture.step.fragmentBytes
          && integer(chunk.records) && chunk.records > 0 && integer(chunk.quarantined) && chunk.quarantined <= chunk.records
          && range(chunk.records, chunk.firstSequence, chunk.lastSequence) && chunk.firstSequence > previous
          && chunk.firstSequence >= spool.chunks[start].firstSequence && chunk.lastSequence <= spool.chunks[end - 1].lastSequence,
        'FEED_ARCHIVE_STEP_WINDOW_INVALID');
        previous = chunk.lastSequence; records += chunk.records; bytes += chunk.bytes;
      }
      ensure(value.afterCounts[bucketIndex] === before[bucketIndex] + chunks.length, 'FEED_ARCHIVE_STEP_WINDOW_INVALID');
    }
    if (packed) {
      ensure(record(value.pack) && value.pack.index === index && hex(value.pack.sha256)
        && value.pack.key === `${root}/windows/pack-${index}-${value.pack.sha256}.bin`
        && integer(value.pack.bytes) && value.pack.bytes > 0 && value.pack.bytes <= 16 * MiB, 'FEED_ARCHIVE_STEP_PACK_INVALID');
      let offset = 0;
      for (const chunk of value.chunks.flat().sort((a, b) => a.packOffset - b.packOffset)) {
        ensure(chunk.packOffset === offset, 'FEED_ARCHIVE_STEP_PACK_INVALID'); offset += chunk.storedBytes;
      }
      ensure(offset === value.pack.bytes, 'FEED_ARCHIVE_STEP_PACK_INVALID');
    }
    const source = spool.chunks.slice(start, end);
    ensure(records === source.reduce((n, chunk) => n + chunk.records, 0) && bytes === source.reduce((n, chunk) => n + chunk.payloadBytes, 0),
      'FEED_ARCHIVE_STEP_WINDOW_INVALID');
    return value;
  }
  async function fanoutWindow(index, progress, capture, spool, root, io) {
    const {start, end} = windowBounds(index, capture, spool);
    const states = Array.from({length: capture.bucketCount}, () => ({parts: [], bytes: 0, records: 0, quarantined: 0, first: null, last: null, chunks: []}));
    let buffered = 0, packBytes = 0; const packParts = [];
    async function flush(bucketIndex) {
      const state = states[bucketIndex]; if (!state.bytes) return;
      io.stats.peakBufferedBytes = Math.max(io.stats.peakBufferedBytes, buffered + state.bytes);
      const bytes = new Uint8Array(state.bytes); let offset = 0;
      for (const part of state.parts) {bytes.set(part, offset); offset += part.length;}
      const number = progress.chunkCounts[bucketIndex] + state.chunks.length;
      const source = new ReadableStream({start(controller) {controller.enqueue(bytes); controller.close();}});
      const compressed = new Uint8Array(await new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      ensure(compressed.length <= bytes.length + 65536, 'FEED_ARCHIVE_STEP_FRAGMENT_LIMIT');
      io.stats.peakBufferedBytes = Math.max(io.stats.peakBufferedBytes, buffered + state.bytes + compressed.length * 2);
      const storedSha256 = digest(compressed), key = `${root}/buckets/${bucketIndex}/chunk-${number}-${storedSha256}.json.gz`;
      if (packed) {
        ensure(packBytes + compressed.length <= 16 * MiB, 'FEED_ARCHIVE_STEP_PACK_LIMIT');
        packParts.push(compressed);
      } else await io.put(key, compressed, {httpMetadata: {contentType: 'application/gzip'}, customMetadata: {sha256: storedSha256}});
      state.chunks.push({key, encoding: packed ? 'gzip-packed' : 'gzip', ...(packed ? {packOffset: packBytes} : {}), sha256: digest(bytes), bytes: bytes.length, storedSha256, storedBytes: compressed.length,
        records: state.records, quarantined: state.quarantined, firstSequence: state.first, lastSequence: state.last});
      if (packed) packBytes += compressed.length;
      buffered -= state.bytes; state.parts = []; state.bytes = 0; state.records = 0; state.quarantined = 0; state.first = null; state.last = null;
    }
    for (let chunkIndex = start; chunkIndex < end; chunkIndex++) {
      const expected = spool.chunks[chunkIndex], compressed = await objectBytes(await io.get(expected.key), capture.step.spoolBytes + 65536, io);
      ensure(compressed.length === expected.bytes && digest(compressed) === expected.sha256, 'FEED_ARCHIVE_STEP_SPOOL_HASH');
      const source = new ReadableStream({start(controller) {controller.enqueue(compressed); controller.close();}});
      const bytes = await objectBytes({body: source.pipeThrough(new DecompressionStream('gzip'))}, expected.decodedBytes, io);
      ensure(bytes.length === expected.decodedBytes && digest(bytes) === expected.decodedSha256, 'FEED_ARCHIVE_STEP_SPOOL_HASH');
      let offset = 0, records = 0, first = null, last = null;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      while (offset < bytes.length) {
        ensure(offset + HEADER_BYTES <= bytes.length, 'FEED_ARCHIVE_STEP_SPOOL_INVALID');
        const length = view.getUint32(offset), bucketIndex = view.getUint8(offset + 4), badVin = view.getUint8(offset + 5), sequence = view.getFloat64(offset + 6);
        offset += HEADER_BYTES;
        ensure(length > 0 && length <= capture.limits.line + 1 && offset + length <= bytes.length && bucketIndex < capture.bucketCount
          && badVin <= 1 && Number.isSafeInteger(sequence) && sequence > (last ?? 0), 'FEED_ARCHIVE_STEP_SPOOL_INVALID');
        const part = bytes.subarray(offset, offset + length); offset += length;
        ensure(part[part.length - 1] === 10, 'FEED_ARCHIVE_STEP_SPOOL_INVALID');
        const state = states[bucketIndex];
        if (state.bytes + part.length > capture.step.fragmentBytes) await flush(bucketIndex);
        state.parts.push(part); state.bytes += part.length; buffered += part.length; state.records++; state.quarantined += badVin;
        state.first ??= sequence; state.last = sequence;
        first ??= sequence; last = sequence; records++;
      }
      ensure(offset === bytes.length && records === expected.records && first === expected.firstSequence && last === expected.lastSequence,
        'FEED_ARCHIVE_STEP_SPOOL_INVALID');
    }
    for (let bucketIndex = 0; bucketIndex < capture.bucketCount; bucketIndex++) await flush(bucketIndex);
    let pack;
    if (packed) {
      const bytes = new Uint8Array(packBytes); let offset = 0;
      for (const part of packParts) {bytes.set(part, offset); offset += part.length;}
      packParts.length = 0;
      const sha256 = digest(bytes), key = `${root}/windows/pack-${index}-${sha256}.bin`;
      pack = {index, key, sha256, bytes: bytes.length};
      for (const state of states) for (const chunk of state.chunks) {delete chunk.key; chunk.packIndex = index;}
      io.stats.peakBufferedBytes = Math.max(io.stats.peakBufferedBytes, packBytes * 2);
      await io.put(key, bytes, {httpMetadata: {contentType: 'application/octet-stream'}, customMetadata: {sha256}});
    }
    const value = seal({version: 1, kind: 'bounded-window', captureSha256: capture.sha256, spoolSha256: spool.sha256,
      ...(packed ? {pack} : {}), index, start, end, beforeCounts: progress.chunkCounts, chunks: states.map(state => state.chunks),
      afterCounts: states.map((state, bucketIndex) => progress.chunkCounts[bucketIndex] + state.chunks.length)});
    validateWindow(value, index, progress.chunkCounts, capture, spool, root);
    await createOnce(`${root}/windows/${index}.json`, value, io);
    return value;
  }
  async function finalize(progress, capture, spool, root, io) {
    const totalWindows = Math.ceil(spool.chunks.length / capture.step.fanoutChunks), all = Array.from({length: capture.bucketCount}, () => []);
    const packs = [];
    let counts = Array(capture.bucketCount).fill(0), receiptBytes = 0, fragmentCompressedBytes = 0, bucketManifestBytes = 0;
    for (let index = 0; index < totalWindows; index++) {
      const saved = await readOptional(`${root}/windows/${index}.json`, io); ensure(saved, 'FEED_ARCHIVE_STEP_WINDOW_MISSING');
      const value = validateWindow(saved.value, index, counts, capture, spool, root);
      if (packed) packs.push(value.pack);
      counts = value.afterCounts; receiptBytes += jsonBytes(value).length;
      fragmentCompressedBytes += value.chunks.flat().reduce((n, chunk) => n + chunk.storedBytes, 0);
      for (let bucketIndex = 0; bucketIndex < capture.bucketCount; bucketIndex++) all[bucketIndex].push(...value.chunks[bucketIndex]);
    }
    ensure(JSON.stringify(counts) === JSON.stringify(progress.chunkCounts) && receiptBytes === progress.receiptBytes && fragmentCompressedBytes === progress.fragmentCompressedBytes, 'FEED_ARCHIVE_STEP_PROGRESS_INVALID');
    const buckets = [];
    for (let index = 0; index < capture.bucketCount; index++) {
      const expected = spool.buckets[index], chunks = all[index];
      let previous = 0, records = 0, quarantined = 0, bytes = 0;
      for (const chunk of chunks) {ensure(chunk.firstSequence > previous, 'FEED_ARCHIVE_STEP_WINDOW_INVALID'); previous = chunk.lastSequence; records += chunk.records; quarantined += chunk.quarantined; bytes += chunk.bytes;}
      ensure(records === expected.records && quarantined === expected.quarantined && bytes === expected.decodedBytes
        && (records ? chunks[0].firstSequence === expected.firstSequence && previous === expected.lastSequence : !chunks.length), 'FEED_ARCHIVE_STEP_WINDOW_INVALID');
      const body = {version: 1, rawSha256: capture.rawSha256, index, bucketCount: capture.bucketCount, observedAt: capture.observedAt, ...expected, chunks};
      const stored = await putContent(root, `buckets/${index}/manifest`, jsonBytes(body), io); bucketManifestBytes += stored.bytes;
      buckets.push({...expected, manifestKey: stored.key, manifestSha256: stored.sha256, chunkCount: chunks.length});
    }
    const manifest = seal({version: 1, kind: 'apibara-feed-archive', state: 'ready', preparation: STRATEGY, preparationStep: capture.step, ...(packed ? {packs} : {}),
      prefix: capture.prefix, rawKey: capture.rawKey, rawSha256: capture.rawSha256, observedAt: capture.observedAt,
      bucketCount: capture.bucketCount, limits: capture.limits, compressedBytes: spool.compressedBytes, decodedBytes: spool.decodedBytes,
      spoolFormat: 'routed-jsonl-v1', spoolHeaderBytes: HEADER_BYTES, fragmentCompressedBytes, sourceDecodedBytes: spool.sourceDecodedBytes, spoolDecodedBytes: spool.spoolDecodedBytes, spoolCompressedBytes: spool.spoolCompressedBytes, records: spool.records, quarantined: spool.quarantined, uniqueLots: spool.uniqueLots,
      firstSequence: spool.firstSequence, lastSequence: spool.lastSequence, firstRecordedAt: spool.firstRecordedAt, lastRecordedAt: spool.lastRecordedAt,
      spoolManifestSha256: spool.sha256, buckets, databaseApplied: false, continuityVerified: false});
    const metadataBytes = jsonBytes(capture).length + jsonBytes(spool).length + jsonBytes(seal(progress)).length
      + receiptBytes + bucketManifestBytes + jsonBytes(manifest).length;
    ensure(metadataBytes <= metadataAllowance(capture.limits), 'FEED_ARCHIVE_STEP_METADATA_LIMIT');
    validateRoot(manifest); await createOnce(`${root}/manifest.json`, manifest, io); await io.progress('ready');
    return manifest;
  }
  return async function prepareFeedArchiveStep({bucket, rawKey, rawSha256, prefix = packed ? 'prepared-packed-gzip' : 'prepared-bounded-gzip', observedAt,
    bucketCount = 128, limits: options, step: stepInput, signal, onProgress, beforeFanout, beforePhaseWrite, windowsPerRun = 1, allowLargeFiles = false, compressedBytes = 0} = {}) {
    const originalLimits = limitsOf(options);
    const expand = packed && allowLargeFiles && originalLimits.records === LIMITS.records && originalLimits.decoded === LIMITS.decoded;
    ensure(integer(compressedBytes), 'FEED_ARCHIVE_SOURCE_INVALID');
    const ceiling = compressedBytes > LIMITS.compressed ? RECOVERY_PACKED_LIMITS : LARGE_PACKED_LIMITS;
    const limits = expand ? {...originalLimits, records:ceiling.records, decoded:ceiling.decoded, compressed:ceiling.compressed} : originalLimits;
    const step = stepOptions(stepInput, limits), root = layout(prefix, rawSha256, bucketCount);
    const isLegacy = stored => expand && sameContentLimits(stored, originalLimits);
    ensure(prefix !== 'prepared' && prefix !== 'prepared-bounded' && (!packed || prefix !== 'prepared-bounded-gzip') && (packed || prefix !== 'prepared-packed-gzip'), 'FEED_ARCHIVE_STEP_PREFIX_INVALID');
    ensure(keyValid(rawKey), 'FEED_ARCHIVE_SOURCE_INVALID');
    ensure(beforeFanout === undefined || typeof beforeFanout === 'function', 'FEED_ARCHIVE_STEP_CAPACITY_INVALID');
    ensure(beforePhaseWrite === undefined || typeof beforePhaseWrite === 'function', 'FEED_ARCHIVE_STEP_CAPACITY_INVALID');
    ensure(!(beforePhaseWrite && beforeFanout), 'FEED_ARCHIVE_STEP_CAPACITY_INVALID');
    ensure(Number.isInteger(windowsPerRun) && windowsPerRun >= 1 && windowsPerRun <= 3
      && (windowsPerRun === 1 || (packed && beforePhaseWrite)), 'FEED_ARCHIVE_STEP_LIMITS_INVALID');
    const capturedAt = observation(observedAt), io = ioFor(bucket, limits, signal, onProgress), manifestKey = `${root}/manifest.json`;
    try {
      const ready = await readOptional(manifestKey, io);
      if (ready) {
        const readyLimits = isLegacy(ready.value.limits) ? originalLimits : limits;
        validateRoot(ready.value, {rawKey, rawSha256, prefix, bucketCount, limits:readyLimits});
        ensure(ready.value.preparation === STRATEGY && JSON.stringify(ready.value.preparationStep) === JSON.stringify(step), 'FEED_ARCHIVE_STEP_SOURCE_CONFLICT');
        ensure(integer(ready.value.spoolCompressedBytes) && ready.value.spoolCompressedBytes <= readyLimits.decoded
          && integer(ready.value.fragmentCompressedBytes) && ready.value.fragmentCompressedBytes <= readyLimits.decoded + MiB
          && integer(ready.value.sourceDecodedBytes) && ready.value.sourceDecodedBytes <= readyLimits.decoded, 'FEED_ARCHIVE_STEP_SPOOL_INVALID');
        await io.progress('reused');
        return {pending: false, phase: 'ready', manifest: ready.value, manifestKey, manifestSha256: digest(jsonBytes(ready.value)), reused: true,
          archiveBytes: ready.value.spoolCompressedBytes + ready.value.fragmentCompressedBytes + metadataAllowance(readyLimits), ...io.stats};
      }
      const captureKey = `${root}/capture.json`, proposedCapture = seal({version: 1, kind: 'bounded-capture', strategy: STRATEGY,
        rawKey, rawSha256, prefix, bucketCount, observedAt: capturedAt, limits, step});
      // The new admission path performs only reads until the phase is known.
      // Even capture.json must follow admission. Legacy callers retain their
      // existing conditional capture write and beforeFanout contract.
      const priorCapture = beforePhaseWrite ? await readOptional(captureKey, io) : null;
      let captureSaved = !!priorCapture || !beforePhaseWrite;
      let capture = beforePhaseWrite ? priorCapture?.value ?? proposedCapture : await createOnce(captureKey, proposedCapture, io, true);
      const validateCapture = value => {
        verified(value, 'bounded-capture');
        ensure(value.strategy === STRATEGY && value.rawKey === rawKey && value.rawSha256 === rawSha256
          && value.prefix === prefix && value.bucketCount === bucketCount && (sameContentLimits(value.limits, limits) || isLegacy(value.limits))
          && JSON.stringify(value.step) === JSON.stringify(step), 'FEED_ARCHIVE_STEP_SOURCE_CONFLICT');
      };
      validateCapture(capture);
      const saveCapture = async () => {
        if (captureSaved) return;
        const saved = await createOnce(captureKey, capture, io, true); validateCapture(saved);
        ensure(saved.sha256 === capture.sha256, 'FEED_ARCHIVE_STEP_SOURCE_CONFLICT');
        capture = saved; captureSaved = true;
      };
      const admit = async (phase, spool) => {
        if (!beforePhaseWrite) return;
        // Spool bytes are bounded before source decoding; fanout/finalization
        // retain the existing conservative full decoded-size +4MiB reserve.
        const decodedBytes = spool ? spool.decodedBytes : Math.min(capture.limits.decoded, LIMITS.decoded);
        io.check(); await beforePhaseWrite({phase, prefix: root + '/', rawKey: capture.rawKey, rawSha256: capture.rawSha256,
          captureSha256: capture.sha256, decodedBytes, ...(spool ? {spoolCompressedBytes: spool.spoolCompressedBytes,
            archiveBytes: spool.decodedBytes + spool.spoolCompressedBytes + metadataAllowance(capture.limits)} : {}), reserveBytes: decodedBytes + metadataAllowance(capture.limits)}); io.check();
        await saveCapture();
      };
      const spoolSaved = await readOptional(`${root}/spool/manifest.json`, io);
      // Old capture and spool hashes are immutable. Published or partially
      // processed legacy spools retain their original manifest policy. A retry
      // of an oversized source keeps its capture hash and uses the larger bounds.
      if (isLegacy(capture.limits) && (!spoolSaved || spoolSaved.value.records > capture.limits.records
        || spoolSaved.value.sourceDecodedBytes > capture.limits.decoded || spoolSaved.value.decodedBytes > capture.limits.decoded)) {
        capture = {...capture, limits};
      }
      if (!spoolSaved) {
        let sourceObject;
        if (beforePhaseWrite) {
          sourceObject = await io.get(capture.rawKey);
          ensure(sourceObject?.body?.pipeThrough, 'FEED_ARCHIVE_RAW_MISSING');
          try {
            ensure(!integer(sourceObject.size) || sourceObject.size <= capture.limits.compressed, 'FEED_ARCHIVE_COMPRESSED_LIMIT');
            await admit('spool');
          } catch (error) {await sourceObject.body.cancel().catch(() => {}); throw error;}
        }
        const spool = await spoolSource({capture, root, io, signal, sourceObject});
        await io.progress('spool-ready');
        return {pending: true, phase: 'spool', capacityChecked: typeof beforePhaseWrite === 'function', spoolCompressedBytes: spool.spoolCompressedBytes, spoolDecodedBytes: spool.spoolDecodedBytes, records: spool.records, decodedBytes: spool.decodedBytes, windowsComplete: 0,
          windowsTotal: Math.ceil(spool.chunks.length / capture.step.fanoutChunks), archiveBytes: spool.decodedBytes + spool.spoolCompressedBytes + metadataAllowance(capture.limits), ...io.stats};
      }
      const spool = validateSpool(spoolSaved.value, capture, root);
      if (beforeFanout) {
        io.check(); await beforeFanout({prefix: root + '/', decodedBytes: spool.decodedBytes, spoolCompressedBytes: spool.spoolCompressedBytes,
          archiveBytes: spool.decodedBytes + spool.spoolCompressedBytes + metadataAllowance(capture.limits), reserveBytes: spool.decodedBytes + metadataAllowance(capture.limits)}); io.check();
      }
      let saved = await readOptional(`${root}/progress.json`, io);
      let progress = saved ? validateProgress(saved.value, capture, spool) : initialProgress(capture, spool);
      const totalWindows = Math.ceil(spool.chunks.length / capture.step.fanoutChunks);
      if (progress.nextWindow < totalWindows) {
        const start = progress.nextWindow;
        const end = Math.min(start + windowsPerRun, totalWindows);
        let receiptReused = false;
        for (let index = start; index < end; index++) {
          const existing = await readOptional(`${root}/windows/${index}.json`, io);
          const verifiedWindow = existing ? validateWindow(existing.value, index, progress.chunkCounts, capture, spool, root) : null;
          // Admission reserves the full decoded file, including the remaining
          // windows. Keep the same conditional checkpoint after each window.
          if (index === start) await admit('fanout', spool);
          const window = verifiedWindow ?? await fanoutWindow(index, progress, capture, spool, root, io);
          progress = {...initialProgress(capture, spool), nextWindow: index + 1, chunkCounts: window.afterCounts,
            receiptBytes: progress.receiptBytes + jsonBytes(window).length,
            fragmentCompressedBytes: progress.fragmentCompressedBytes + window.chunks.flat().reduce((n, chunk) => n + chunk.storedBytes, 0)};
          ensure(progress.fragmentCompressedBytes <= capture.limits.decoded + MiB, 'FEED_ARCHIVE_STEP_FRAGMENT_LIMIT');
          saved = await writeProgress(progress, saved, root, io);
          receiptReused ||= !!existing;
          await io.progress('fanout-ready');
        }
        return {pending: true, phase: 'fanout', capacityChecked: typeof beforeFanout === 'function' || typeof beforePhaseWrite === 'function', records: spool.records, decodedBytes: spool.decodedBytes,
          windowsComplete: progress.nextWindow, windowsTotal: totalWindows, receiptReused,
          archiveBytes: spool.decodedBytes + spool.spoolCompressedBytes + metadataAllowance(capture.limits), ...io.stats};
      }
      await admit('finalize', spool);
      const manifest = await finalize(progress, capture, spool, root, io);
      return {pending: false, phase: 'ready', capacityChecked: typeof beforeFanout === 'function' || typeof beforePhaseWrite === 'function', manifest, manifestKey, manifestSha256: digest(jsonBytes(manifest)), reused: false,
        archiveBytes: spool.spoolCompressedBytes + manifest.fragmentCompressedBytes + metadataAllowance(capture.limits), ...io.stats};
    } catch (error) {if (/^FEED_CAPTURE_[A-Z_]+$/.test(error?.code || '')) throw error; checkedError(error, 'FEED_ARCHIVE_STEP_FAILED');}
  };
}
module.exports = {createBoundedArchivePreparer};
