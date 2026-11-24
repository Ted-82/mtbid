'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createGunzip} = require('node:zlib');
const readline = require('node:readline');
const {pipeline} = require('node:stream/promises');
const {inspectFeedFile, LIMITS} = require('./apibara-feed.cjs');
const {hash, validateReceipt, validateSnapshotMetadata} = require('../sync/feed-snapshot-import.cjs');

/** Verify the ENTIRE saved file before yielding any page for D1. observedAt
 * is verified capture metadata, or the source-time upper bound when each
 * record retains its own updated_at. It is never the download time.
 * This reader never establishes a changes-stream checkpoint. */
async function* readSnapshotPages({directory, manifest, generationId, observedAt,
  startOffset = 0, signal, now = Date.now(), observationTimeBasis = 'capture', batchSize = 20} = {}) {
  const sha256 = manifest?.sha256;
  if (!path.isAbsolute(directory || '') || manifest?.mode !== 'snapshot'
      || !/^[a-f0-9]{64}$/.test(sha256 || '') || manifest.file !== `${sha256}/vehicles.jsonl.gz`
      || !Number.isSafeInteger(manifest.records) || manifest.records < 1
      || manifest.records > LIMITS.records || !Number.isSafeInteger(startOffset) || startOffset < 0
      || ![20, 60].includes(batchSize)
      || startOffset > manifest.records || (startOffset !== manifest.records && startOffset % batchSize !== 0)) {
    throw Error('FEED_SNAPSHOT_MANIFEST_INVALID');
  }
  validateSnapshotMetadata({fileSha256: sha256, generationId, observedAt, totalRecords: manifest.records, observationTimeBasis, batchSize}, now);
  const file = path.join(directory, manifest.file);
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size !== manifest.compressedBytes || stat.size > LIMITS.compressed) throw Error('FEED_SNAPSHOT_FILE_CHANGED');
  const checksum = createHash('sha256');
  for await (const bytes of fs.createReadStream(file, {signal})) checksum.update(bytes);
  if (checksum.digest('hex') !== sha256) throw Error('FEED_SNAPSHOT_FILE_CHANGED');
  const inspection = await inspectFeedFile(file, {mode: 'snapshot', signal});
  if (inspection.records !== manifest.records) throw Error('FEED_SNAPSHOT_COUNT_CHANGED');
  if (Object.hasOwn(manifest, 'expandedBytes') && inspection.expandedBytes !== manifest.expandedBytes) throw Error('FEED_SNAPSHOT_SIZE_CHANGED');
  if (observationTimeBasis === 'source_updated_at' && (inspection.sourceUpdatedCount !== inspection.records
      || inspection.sourceUpdatedMax !== observedAt)) throw Error('FEED_SNAPSHOT_SOURCE_TIME_INVALID');
  if (startOffset === manifest.records) return;
  const source = fs.createReadStream(file), unpacked = createGunzip();
  const completed = pipeline(source, unpacked, {signal});
  // A downstream consumer may stop early. Always observe/destroy both sides.
  completed.catch(() => {});
  const lines = readline.createInterface({input: unpacked, crlfDelay: Infinity});
  let offset = 0, page = [];
  try {
    for await (const line of lines) {
      const value = JSON.parse(line);
      if (offset + page.length < startOffset) {offset++; continue;}
      page.push(value);
      if (page.length === batchSize || offset + page.length === manifest.records) {
        const receipt = {fileSha256: sha256, generationId, observedAt, observationTimeBasis, batchSize, totalRecords: manifest.records,
          offset, records: page, batchSha256: hash(page)};
        validateReceipt(receipt, now);
        yield receipt;
        offset += page.length; page = [];
      }
    }
    await completed;
    if (offset !== manifest.records || page.length) throw Error('FEED_SNAPSHOT_COUNT_CHANGED');
  } finally {
    lines.close(); source.destroy(); unpacked.destroy();
    await completed.catch(() => {});
  }
}
module.exports = {readSnapshotPages};
