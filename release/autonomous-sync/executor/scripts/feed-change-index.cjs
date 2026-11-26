'use strict';

// Private, local preparation only. Grouping by platform/LOT preserves each
// vehicle's event order without millions of remote lookups. This file never
// writes D1, calls Apibara, or establishes a database stream checkpoint.
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {createHash, randomUUID} = require('node:crypto');
const {createGunzip} = require('node:zlib');
const {pipeline} = require('node:stream/promises');
const {Transform} = require('node:stream');
const {parseChangesResponse} = require('../providers/apibara.js');
const {LIMITS} = require('./apibara-feed.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => {throw Error(code);};

function validateSources(sources) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 96) fail('FEED_INDEX_SOURCES_INVALID');
  let previous = null;
  const seen = new Set();
  for (const item of sources) {
    const m = item?.manifest;
    if (!Number.isSafeInteger(item?.generationId) || item.generationId < 1 || !m
        || m.mode !== 'incremental' || !/^[a-f0-9]{64}$/.test(m.sha256 || '')
        || m.file !== `${m.sha256}/vehicles.jsonl.gz` || seen.has(m.sha256)
        || !Number.isSafeInteger(m.records) || m.records < 1 || m.records > LIMITS.records
        || !Number.isSafeInteger(m.compressedBytes) || m.compressedBytes < 1 || m.compressedBytes > LIMITS.compressed
        || !Number.isSafeInteger(m.firstSequence) || m.firstSequence < 1
        || !Number.isSafeInteger(m.lastSequence) || m.lastSequence < m.firstSequence
        || !['reject', 'quarantine'].includes(m.invalidVinPolicy || 'reject')
        || !Array.isArray(m.quarantinedEvents || []) || (m.quarantinedEvents || []).length > 100) fail('FEED_INDEX_SOURCES_INVALID');
    // Internal sequence gaps are valid. Missing/overlapping files at a boundary
    // require separate upstream evidence; this preparer does not invent it.
    if (previous !== null && m.firstSequence !== previous + 1) fail('FEED_INDEX_BOUNDARY_UNVERIFIED');
    previous = m.lastSequence; seen.add(m.sha256);
  }
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

async function buildFeedChangeIndex({directory, outputDirectory, sources, signal, onProgress} = {}) {
  if (!path.isAbsolute(directory || '') || !path.isAbsolute(outputDirectory || '')) fail('FEED_INDEX_DIRECTORY_INVALID');
  validateSources(sources);
  const sourceSet = sources.map(({generationId, manifest: m}) => ({generationId, sha256: m.sha256,
    records: m.records, firstSequence: m.firstSequence, lastSequence: m.lastSequence}));
  const identity = sha(JSON.stringify({version: 1, sources: sourceSet}));
  await fs.promises.mkdir(outputDirectory, {recursive: true, mode: 0o700});
  const destination = path.join(outputDirectory, identity);
  // Never replace a published or in-progress index, even on retry.
  if (fs.existsSync(destination)) fail('FEED_INDEX_ALREADY_EXISTS');
  const temporary = path.join(outputDirectory, `.partial-${randomUUID()}`);
  await fs.promises.mkdir(temporary, {mode: 0o700});
  const database = path.join(temporary, 'events.sqlite');
  let db, complete = false;
  try {
    db = new DatabaseSync(database);
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE events(sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL CHECK(platform IN ('copart','iaai')), lot TEXT NOT NULL,
        generation_id INTEGER NOT NULL, quarantine TEXT, raw TEXT NOT NULL);
      BEGIN IMMEDIATE;`);
    const insert = db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)');
    let total = 0, quarantined = 0;
    for (const {generationId, manifest: m} of sources) {
      signal?.throwIfAborted();
      const file = path.join(directory, m.file), stat = await fs.promises.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== m.compressedBytes) fail('FEED_INDEX_SOURCE_CHANGED');
      let count = 0, first = null, previous = 0, pending = '', expanded = 0, quarantineCount = 0;
      const expected = new Map((m.quarantinedEvents || []).map(q => [q.sequence, q]));
      if (expected.size !== (m.quarantinedEvents || []).length) fail('FEED_INDEX_QUARANTINE_INVALID');
      const compressedHash = createHash('sha256'), decoder = new TextDecoder('utf-8', {fatal: true});
      const meter = new Transform({transform(bytes, _, callback) {compressedHash.update(bytes); callback(null, bytes);}});
      const accept = line => {
        signal?.throwIfAborted();
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line || Buffer.byteLength(line) > LIMITS.line) fail('FEED_INDEX_LINE_INVALID');
        const raw = JSON.parse(line);
        if (++count > m.records || !Number.isSafeInteger(raw.sequence) || raw.sequence <= previous) fail('FEED_INDEX_SEQUENCE_INVALID');
        let quarantine = null;
        const q = expected.get(raw.sequence);
        const validate = value => parseChangesResponse({ok: true, data: [value], meta: {
          after: previous, next_cursor: raw.sequence, has_more: false, count: 1,
          ordering: 'sequence_asc', schema_version: 'local-file-index', retention_days: 14}}, {after: previous, limit: 1});
        if (q) {
          if (m.invalidVinPolicy !== 'quarantine' || q.record !== count || q.rawLineSha256 !== sha(line)
              || q.eventId !== raw.event_id || q.platform !== raw.vehicle?.platform || q.lotNumber !== raw.vehicle?.lot_number
              || q.reason !== 'invalid_vin_control_character' || typeof raw.vehicle?.vin !== 'string'
              || !/[\u0000-\u001f]/.test(raw.vehicle.vin)) fail('FEED_INDEX_QUARANTINE_INVALID');
          // Validate all other fields; store the ORIGINAL line, not this copy.
          validate({...raw, vehicle: {...raw.vehicle, vin: null}});
          quarantine = q.reason; quarantineCount++; quarantined++;
        } else validate(raw);
        insert.run(raw.sequence, raw.event_id, raw.vehicle.platform, raw.vehicle.lot_number, generationId, quarantine, line);
        first ??= raw.sequence; previous = raw.sequence; total++;
      };
      await pipeline(fs.createReadStream(file), meter, createGunzip(), async source => {
        for await (const bytes of source) {
          expanded += bytes.length;
          if (expanded > LIMITS.expanded) fail('FEED_INDEX_EXPANDED_LIMIT');
          pending += decoder.decode(bytes, {stream: true});
          let newline;
          while ((newline = pending.indexOf('\n')) !== -1) {
            accept(pending.slice(0, newline)); pending = pending.slice(newline + 1);
          }
          if (Buffer.byteLength(pending) > LIMITS.line) fail('FEED_INDEX_LINE_INVALID');
        }
        pending += decoder.decode(); if (pending) accept(pending);
      }, {signal});
      if (compressedHash.digest('hex') !== m.sha256 || count !== m.records || first !== m.firstSequence
          || previous !== m.lastSequence || quarantineCount !== expected.size) fail('FEED_INDEX_SOURCE_CHANGED');
      onProgress?.({generationId, records: count, total, quarantined});
    }
    signal?.throwIfAborted();
    db.exec('CREATE INDEX event_vehicle_sequence ON events(platform,lot,sequence); COMMIT;');
    const summary = db.prepare(`SELECT COUNT(*) records, SUM(quarantine IS NOT NULL) quarantined,
      MIN(sequence) firstSequence,MAX(sequence) lastSequence FROM events`).get();
    if (summary.records !== total || summary.quarantined !== quarantined) fail('FEED_INDEX_COUNT_INVALID');
    const lots = db.prepare('SELECT COUNT(*) n FROM (SELECT platform,lot FROM events GROUP BY platform,lot)').get().n;
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('FEED_INDEX_INTEGRITY_INVALID');
    db.close(); db = null;
    const manifest = {version: 1, identity, sources: sourceSet, ...summary, uniqueLots: lots,
      database: 'events.sqlite', databaseSha256: await hashFile(database), createdAt: new Date().toISOString(),
      databaseApplied: false, continuityVerified: false, globalCursorEstablished: false};
    await fs.promises.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    await fs.promises.rename(temporary, destination); complete = true;
    return manifest;
  } finally {
    db?.close();
    if (!complete) {
      // The exact freshly-created random child is the only cleanup target.
      if (path.dirname(temporary) !== path.resolve(outputDirectory) || !path.basename(temporary).startsWith('.partial-')) fail('FEED_INDEX_CLEANUP_PATH_INVALID');
      await fs.promises.rm(temporary, {recursive: true, force: true});
    }
  }
}

module.exports = {buildFeedChangeIndex, validateSources};
