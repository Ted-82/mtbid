'use strict';

// Operator-side intake for Sync Center JSONL.gz. Download/validation only:
// a ready file is NOT a committed database cursor or a freshness assertion.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {createGunzip} = require('node:zlib');
const {pipeline} = require('node:stream/promises');
const {Readable, Transform} = require('node:stream');
const {createHash, randomUUID} = require('node:crypto');
const {parseChangesResponse} = require('../providers/apibara.js');
// Pro initial snapshot #4548 is 2.38GB expanded. Keep a bounded 3GiB stream;
// neither the compressed input nor expanded data is buffered as a whole.
const LIMITS = Object.freeze({compressed: 512 * 1024 * 1024, expanded: 3 * 1024 * 1024 * 1024,
  // The first retained incremental generation after the provider pause contains
  // 3,052,000 ordered events (1.84GB expanded). Keep a finite 4M-event ceiling.
  line: 2 * 1024 * 1024, records: 4000000, timeoutMs: 10 * 60 * 1000});
const fail = code => { const error = Error(code); error.code = code; throw error; };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function limitsOf(options = {}) {
  const limits = {...LIMITS, ...options};
  for (const key of Object.keys(limits)) if (!(key in LIMITS) || !Number.isSafeInteger(limits[key])
      || limits[key] < 1 || limits[key] > LIMITS[key]) fail('FEED_LIMIT_INVALID');
  return limits;
}
function validateFeedUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('FEED_URL_INVALID'); }
  if (url.origin !== 'https://apibara.tech' || url.username || url.password || url.search || url.hash
      || !/^\/data-feeds\/[A-Za-z0-9_-]+\/latest$/.test(url.pathname)) fail('FEED_URL_INVALID');
  return url.href;
}

async function inspectFeedFile(file, {mode, limits: options, signal, invalidVinPolicy = 'reject'} = {}) {
  if (!['snapshot', 'incremental'].includes(mode)) fail('FEED_MODE_REQUIRED');
  if (!['reject', 'quarantine'].includes(invalidVinPolicy) || mode !== 'incremental' && invalidVinPolicy !== 'reject') fail('FEED_QUARANTINE_POLICY_INVALID');
  const limits = limitsOf(options), report = {mode, records: 0, expandedBytes: 0,
    platforms: {copart: 0, iaai: 0}, unresolvedVins: 0, firstSequence: null, lastSequence: null,
    firstRecordedAt: null, lastRecordedAt: null,
    sourceUpdatedMin: null, sourceUpdatedMax: null, sourceUpdatedCount: 0};
  if (invalidVinPolicy === 'quarantine') {
    report.invalidVinPolicy = 'quarantine';
    report.quarantinedEvents = [];
    report.contractValidatedRecords = 0;
  }
  const identities = new Set(), eventIds = new Set();
  let previous = 0, pending = '';
  const decoder = new TextDecoder('utf-8', {fatal: true});
  function accept(line) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line || Buffer.byteLength(line, 'utf8') > limits.line) fail('FEED_LINE_INVALID');
    let value;
    try { value = JSON.parse(line); } catch { fail('FEED_JSON_INVALID'); }
    if (!record(value)) fail('FEED_RECORD_INVALID');
    if (++report.records > limits.records) fail('FEED_RECORD_LIMIT');
    let platform, lot, vin;
    if (mode === 'snapshot') {
      if ('sequence' in value || 'event_id' in value || 'event' in value) fail('FEED_MODE_MISMATCH');
      platform = value.platform; lot = String(value.lot_number ?? ''); vin = value.vin;
      if (!record(value.auction) || !['open', 'live'].includes(String(value.auction.state).toLowerCase())) fail('FEED_SNAPSHOT_SCOPE_INVALID');
      if (typeof value.updated_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.updated_at)
          && Number.isFinite(Date.parse(value.updated_at))) {
        const updated = new Date(value.updated_at).toISOString();
        if (updated.slice(0,19) === value.updated_at.slice(0,19)) {
          report.sourceUpdatedCount++;
          if (!report.sourceUpdatedMin || updated < report.sourceUpdatedMin) report.sourceUpdatedMin = updated;
          if (!report.sourceUpdatedMax || updated > report.sourceUpdatedMax) report.sourceUpdatedMax = updated;
        }
      }
      const identity = `${platform}:${lot}`;
      if (identities.has(identity)) fail('FEED_DUPLICATE_IDENTITY');
      identities.add(identity);
    } else {
      // Fixed-size digests keep duplicate detection bounded even if a source
      // supplies unusually long event IDs in a large file.
      const eventKey = createHash('sha256').update(typeof value.event_id === 'string' ? value.event_id : '').digest('hex');
      if (!Number.isSafeInteger(value.sequence) || value.sequence <= previous || eventIds.has(eventKey)) fail('FEED_SEQUENCE_INVALID');
      // Reuse the provider's strict event contract; this envelope only validates
      // one event. It does NOT invent a delivered range or prove no files missed.
      const validateEvent = event => parseChangesResponse({ok: true, data: [event], meta: {after: previous, next_cursor: value.sequence,
          has_more: false, count: 1, ordering: 'sequence_asc', schema_version: 'sync-center-validation',
          retention_days: 14}}, {after: previous, limit: 1});
      let quarantined = false;
      try { validateEvent(value); }
      catch {
        // Retain the ORIGINAL event/file. A malformed VIN must not be repaired,
        // dropped or applied to another vehicle. This opt-in receipt is only a
        // quarantine inventory, never permission to advance the database cursor.
        // Validate all remaining envelope fields before permitting quarantine.
        if (invalidVinPolicy !== 'quarantine' || typeof value.vehicle?.vin !== 'string'
            || !/[\u0000-\u001f]/.test(value.vehicle.vin)) fail('FEED_EVENT_INVALID');
        try { validateEvent({...value, vehicle: {...value.vehicle, vin: null}}); }
        catch { fail('FEED_EVENT_INVALID'); }
        if (report.quarantinedEvents.length >= 100) fail('FEED_QUARANTINE_LIMIT');
        report.quarantinedEvents.push({record: report.records, sequence: value.sequence, eventId: value.event_id,
          platform: value.vehicle.platform, lotNumber: value.vehicle.lot_number,
          reason: 'invalid_vin_control_character', rawLineSha256: createHash('sha256').update(line).digest('hex')});
        quarantined = true;
      }
      if (invalidVinPolicy === 'quarantine' && !quarantined) report.contractValidatedRecords++;
      previous = value.sequence; eventIds.add(eventKey);
      platform = value.vehicle.platform; lot = value.vehicle.lot_number; vin = value.vehicle.vin;
      report.firstSequence ??= value.sequence; report.lastSequence = value.sequence;
      if (!report.firstRecordedAt || Date.parse(value.recorded_at) < Date.parse(report.firstRecordedAt)) report.firstRecordedAt = value.recorded_at;
      if (!report.lastRecordedAt || Date.parse(value.recorded_at) > Date.parse(report.lastRecordedAt)) report.lastRecordedAt = value.recorded_at;
    }
    if (!['copart', 'iaai'].includes(platform) || !/^\d{1,20}$/.test(lot)) fail('FEED_IDENTITY_INVALID');
    report.platforms[platform]++;
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(String(vin ?? ''))) report.unresolvedVins++;
  }
  try {
    await pipeline(fs.createReadStream(file), createGunzip(), async source => {
      for await (const bytes of source) {
        report.expandedBytes += bytes.length;
        if (report.expandedBytes > limits.expanded) fail('FEED_EXPANDED_LIMIT');
        pending += decoder.decode(bytes, {stream: true});
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
          accept(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        }
        if (Buffer.byteLength(pending, 'utf8') > limits.line) fail('FEED_LINE_LIMIT');
      }
      pending += decoder.decode();
      // A last record without a newline is valid JSONL. Gzip verifies the CRC
      // and end marker before this point, so a truncated gzip never passes.
      if (pending) accept(pending);
    }, {signal});
  } catch (error) {
    if (/^FEED_[A-Z_]+$/.test(error.code || '')) throw error;
    fail(signal?.aborted ? 'FEED_TIMEOUT' : 'FEED_FILE_INVALID');
  }
  if (mode === 'snapshot' && !report.records) fail('FEED_EMPTY_SNAPSHOT');
  return report;
}

async function receiveFeed({directory, mode, openInput, limits: options, invalidVinPolicy = 'reject'}) {
  const limits = limitsOf(options);
  if (!['snapshot', 'incremental'].includes(mode)) fail('FEED_MODE_REQUIRED');
  if (!path.isAbsolute(directory || '')) fail('FEED_DIRECTORY_REQUIRED');
  await fsp.mkdir(directory, {recursive: true, mode: 0o700});
  const temporaryDirectory = path.join(directory, `.partial-${randomUUID()}`);
  await fsp.mkdir(temporaryDirectory, {mode: 0o700});
  const temporary = path.join(temporaryDirectory, 'vehicles.jsonl.gz');
  const temporaryManifest = path.join(temporaryDirectory, 'manifest.json');
  const signal = AbortSignal.timeout(limits.timeoutMs);
  let received = 0, result, input;
  try {
    const {source, declared} = await openInput(signal);
    input = source;
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))
        || Number(declared) > limits.compressed)) fail('FEED_COMPRESSED_LIMIT');
    const hash = createHash('sha256');
    const meter = new Transform({transform(chunk, encoding, done) {
      received += chunk.length;
      if (received > limits.compressed) return done(Object.assign(Error('FEED_COMPRESSED_LIMIT'), {code: 'FEED_COMPRESSED_LIMIT'}));
      hash.update(chunk); done(null, chunk);
    }});
    await pipeline(source, meter, fs.createWriteStream(temporary, {flags: 'wx', mode: 0o600}), {signal});
    if (declared !== null && received !== Number(declared)) fail('FEED_LENGTH_MISMATCH');
    const inspected = await inspectFeedFile(temporary, {mode, limits, signal, invalidVinPolicy});
    const sha256 = hash.digest('hex'), destination = path.join(directory, sha256);
    result = {...inspected, sha256, compressedBytes: received, file: `${sha256}/vehicles.jsonl.gz`, receivedAt: new Date().toISOString(),
      databaseApplied: false, continuityVerified: false};
    await fsp.writeFile(temporaryManifest, JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    for (const file of [temporary, temporaryManifest]) {
      const handle = await fsp.open(file, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
    }
    // Publish the pair in one directory rename. A previously completed,
    // nonempty destination cannot be overwritten, including on Windows.
    try { await fsp.rename(temporaryDirectory, destination); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      let saved;
      try {
        saved = JSON.parse(await fsp.readFile(path.join(destination, 'manifest.json'), 'utf8'));
        if ((await fsp.stat(path.join(destination, 'vehicles.jsonl.gz'))).size !== received) fail('FEED_STORED_FILE_CONFLICT');
        const existingHash = createHash('sha256');
        for await (const bytes of fs.createReadStream(path.join(destination, 'vehicles.jsonl.gz'), {signal})) existingHash.update(bytes);
        if (existingHash.digest('hex') !== sha256 || saved.sha256 !== sha256 || saved.mode !== mode
            || saved.records !== inspected.records
            || (saved.invalidVinPolicy || 'reject') !== invalidVinPolicy
            || JSON.stringify(saved.quarantinedEvents || []) !== JSON.stringify(inspected.quarantinedEvents || [])) fail('FEED_STORED_FILE_CONFLICT');
      } catch { fail('FEED_STORED_FILE_CONFLICT'); }
      result = saved;
    }
  } catch (error) {
    // Transport errors can include the bearer URL. Return only an allowlisted
    // internal code, never a remote body, exception message or Location header.
    fail(/^FEED_[A-Z_]+$/.test(error.code || '') ? error.code : signal.aborted ? 'FEED_TIMEOUT' : 'FEED_DOWNLOAD_FAILED');
  } finally {
    // Also close a response rejected before pipeline starts (e.g. declared
    // size over the cap); no unread network body may continue in background.
    input?.destroy();
    for (const file of [temporary, temporaryManifest]) {
      await fsp.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw Error('FEED_CLEANUP_FAILED'); });
    }
    await fsp.rmdir(temporaryDirectory).catch(error => { if (error.code !== 'ENOENT') throw Error('FEED_CLEANUP_FAILED'); });
  }
  return result;
}
async function downloadFeed({url, directory, mode, fetchImpl = fetch, limits, invalidVinPolicy = 'reject'} = {}) {
  const address = validateFeedUrl(url);
  return receiveFeed({directory, mode, limits, invalidVinPolicy, openInput: async signal => {
    const response = await fetchImpl(address, {redirect: 'manual', signal, headers: {'Accept-Encoding': 'identity'}});
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      fail([401, 403].includes(response.status) ? 'FEED_AUTH_REQUIRED'
        : response.status === 404 ? 'FEED_NOT_READY' : response.status === 429 ? 'FEED_RATE_LIMITED'
          : response.status >= 300 && response.status < 400 ? 'FEED_REDIRECT_REJECTED' : 'FEED_DOWNLOAD_FAILED');
    }
    if (!response.body) fail('FEED_BODY_MISSING');
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') {
      await response.body.cancel().catch(() => {}); fail('FEED_HTTP_ENCODING_UNSUPPORTED');
    }
    return {source: Readable.fromWeb(response.body), declared: response.headers.get('content-length')};
  }});
}

// Browser/operator downloads use the exact same bounded validation and atomic
// publication as HTTP intake. No network request and no database mutation.
async function ingestLocalFeed({file, directory, mode, limits, invalidVinPolicy = 'reject'} = {}) {
  if (!path.isAbsolute(file || '')) fail('FEED_LOCAL_FILE_REQUIRED');
  const maximum = limitsOf(limits);
  return receiveFeed({directory, mode, limits, invalidVinPolicy, openInput: async signal => {
    const stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('FEED_LOCAL_FILE_REQUIRED');
    if (stat.size > maximum.compressed) fail('FEED_COMPRESSED_LIMIT');
    return {source: fs.createReadStream(file, {signal}), declared: String(stat.size)};
  }});
}
module.exports = {LIMITS, validateFeedUrl, inspectFeedFile, downloadFeed, ingestLocalFeed};
