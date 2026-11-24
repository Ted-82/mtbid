'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {hashReceipt, validateReceipt} = require('../sync/feed-change-import.cjs');
const MAX_GROUP_BYTES = 16 * 1024 * 1024, MAX_BATCH_BYTES = 32 * 1024 * 1024;

// Reads a private immutable index, never D1. No group is divided between
// receipts: all events for a vehicle must reach its reducer in original order.
async function* readChangePages({directory, manifest, startOffset = 0, maxGroups = 100, signal} = {}) {
  if (!path.isAbsolute(directory || '') || !/^[a-f0-9]{64}$/.test(manifest?.identity || '')
      || !/^[a-f0-9]{64}$/.test(manifest?.databaseSha256 || '') || manifest.database !== 'events.sqlite'
      || !Number.isSafeInteger(startOffset) || startOffset < 0 || startOffset > manifest.uniqueLots
      || !Number.isSafeInteger(maxGroups) || maxGroups < 1 || maxGroups > 100
      || !Number.isFinite(Date.parse(manifest.createdAt))) throw Error('FEED_CHANGE_READER_INVALID');
  const file = path.join(directory, manifest.identity, manifest.database), stat = await fs.promises.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('FEED_CHANGE_INDEX_CHANGED');
  const checksum = createHash('sha256');
  for await (const bytes of fs.createReadStream(file, {signal})) checksum.update(bytes);
  if (checksum.digest('hex') !== manifest.databaseSha256) throw Error('FEED_CHANGE_INDEX_CHANGED');
  const dataset = Object.fromEntries(['identity','databaseSha256','sources','records','quarantined','firstSequence','lastSequence','uniqueLots'].map(key => [key, manifest[key]]));
  const db = new DatabaseSync(file, {readOnly: true});
  let iterator;
  try {
    const totals = db.prepare('SELECT COUNT(*) records,SUM(quarantine IS NOT NULL) quarantined,MIN(sequence) firstSequence,MAX(sequence) lastSequence FROM events').get();
    for (const key of Object.keys(totals)) if (totals[key] !== dataset[key]) throw Error('FEED_CHANGE_INDEX_COUNT_INVALID');
    // A bounded operator may stop after its first receipt, so validate the
    // complete group count before any yield, not only after exhausting rows.
    const {uniqueLots} = db.prepare('SELECT COUNT(*) uniqueLots FROM (SELECT platform,lot FROM events GROUP BY platform,lot)').get();
    if (uniqueLots !== dataset.uniqueLots) throw Error('FEED_CHANGE_INDEX_COUNT_INVALID');
    let offset = 0, eventOffset = 0, quarantineOffset = 0, groupCount = 0, page = [], bytes = 0, batchEvents = 0;
    const events = db.prepare('SELECT sequence,raw,quarantine FROM events WHERE platform=? AND lot=? ORDER BY sequence');
    iterator = db.prepare('SELECT platform,lot,COUNT(*) records,SUM(quarantine IS NOT NULL) quarantined FROM events GROUP BY platform,lot ORDER BY platform,lot').iterate();
    const receipt = () => {
      const value = {version: 1, dataset, observedAt: manifest.createdAt, offset, eventOffset, quarantineOffset, groups: page};
      const prepared = {...value, batchSha256: hashReceipt(value)};
      validateReceipt(prepared, Date.now()); return prepared;
    };
    const advance = () => {
      offset += page.length; eventOffset += page.reduce((n, g) => n + g.events.length, 0);
      quarantineOffset += page.reduce((n, g) => n + g.quarantinedSequences.length, 0); page = []; bytes = 0; batchEvents = 0;
    };
    for (const group of iterator) {
      signal?.throwIfAborted(); groupCount++;
      if (offset < startOffset) {offset++; eventOffset += group.records; quarantineOffset += group.quarantined; continue;}
      if (group.records > 100000) throw Error('FEED_CHANGE_GROUP_TOO_LARGE');
      // Read raw strings first; refuse an oversized group before JSON expansion.
      const records = events.all(group.platform, group.lot);
      const size = records.reduce((n, row) => n + Buffer.byteLength(row.raw), 0);
      if (size > MAX_GROUP_BYTES) throw Error('FEED_CHANGE_GROUP_TOO_LARGE');
      if (page.length && (page.length === maxGroups || bytes + size > MAX_BATCH_BYTES || batchEvents + records.length > 100000)) {yield receipt(); advance();}
      page.push({platform: group.platform, lot: group.lot, events: records.map(row => JSON.parse(row.raw)),
        quarantinedSequences: records.filter(row => row.quarantine !== null).map(row => row.sequence)});
      bytes += size; batchEvents += records.length;
    }
    if (page.length) {yield receipt(); advance();}
    if (groupCount !== dataset.uniqueLots || offset !== dataset.uniqueLots || eventOffset !== dataset.records
        || quarantineOffset !== dataset.quarantined) throw Error('FEED_CHANGE_INDEX_COUNT_INVALID');
  } finally {iterator?.return?.(); db.close();}
}
module.exports = {readChangePages};
