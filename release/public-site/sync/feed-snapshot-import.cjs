'use strict';

// One validated, immutable snapshot page. File intake owns gzip/hash/scope
// verification; this boundary owns identity checks and an atomic D1 checkpoint.
// The operator owns a bounded run, lease acquisition/renewal/release, D1 budget
// and backup. This function neither starts a schedule nor seeds /changes.
const {createHash, randomUUID} = require('node:crypto');
const {prepareInventoryPage, MAX_PAGE_RECORDS} = require('./inventory-page.cjs');
const {commitInventoryBatch} = require('./inventory-commit.cjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = code => { throw Error(code); };

function validateSnapshotMetadata(receipt, now) {
  if (![20, 60].includes(receipt?.batchSize ?? 20)) fail('FEED_IMPORT_BATCH_SIZE_INVALID');
  if (!['capture', 'source_updated_at'].includes(receipt?.observationTimeBasis ?? 'capture')) fail('FEED_IMPORT_TIME_BASIS_INVALID');
  if (!receipt || !hex(receipt.fileSha256)
      || !Number.isSafeInteger(receipt.generationId) || receipt.generationId < 1
      || !integer(receipt.totalRecords) || receipt.totalRecords < 1 || receipt.totalRecords > 1000000
      || !Number.isFinite(now)) fail('FEED_IMPORT_RECEIPT_INVALID');
  const observed = receipt.observedAt;
  if (typeof observed !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observed)
      || !Number.isFinite(Date.parse(observed)) || new Date(observed).toISOString() !== observed
      || Date.parse(observed) > now) fail('FEED_IMPORT_TIME_INVALID');
}
function validateReceipt(receipt, now) {
  validateSnapshotMetadata(receipt, now);
  const batchSize = receipt.batchSize ?? MAX_PAGE_RECORDS;
  if (!hex(receipt.batchSha256) || !integer(receipt.offset) || receipt.offset % batchSize !== 0
      || !Array.isArray(receipt.records) || !receipt.records.length
      || receipt.records.length !== Math.min(batchSize, receipt.totalRecords - receipt.offset)
      || hash(receipt.records) !== receipt.batchSha256) fail('FEED_IMPORT_RECEIPT_INVALID');
  for (const record of receipt.records) {
    if (!record || !['copart', 'iaai'].includes(record.platform)
        || !/^\d{1,20}$/.test(String(record.lot_number ?? ''))
        || !['open', 'live'].includes(String(record.auction?.state).toLowerCase())
        || 'event_id' in record || 'sequence' in record) fail('FEED_IMPORT_SCOPE_INVALID');
  }
}
function parseState(task, receipt) {
  let state;
  try {state = JSON.parse(task.cursor);} catch {fail('FEED_IMPORT_CHECKPOINT_INVALID');}
  if (task.platform !== 'all' || state?.version !== 1 || state.fileSha256 !== receipt.fileSha256
      || (state.batchSize ?? 20) !== (receipt.batchSize ?? 20)
      || (state.observationTimeBasis ?? 'capture') !== (receipt.observationTimeBasis ?? 'capture')
      || state.generationId !== receipt.generationId || state.observedAt !== receipt.observedAt
      || state.totalRecords !== receipt.totalRecords
      || !['offset', 'inserted', 'updated', 'rejected', 'skipped'].every(key => integer(state[key]))
      || state.offset > state.totalRecords || state.offset !== state.inserted + state.updated + state.rejected + state.skipped) {
    fail('FEED_IMPORT_CHECKPOINT_INVALID');
  }
  return state;
}

async function importSnapshotBatch({db, store, provider, receipt, freshnessPolicy, prepareCheckpointStatements} = {}) {
  if (!db?.prepare || !db?.batch || store?.db !== db || !store.owner || typeof store.guarded !== 'function'
      || typeof store.now !== 'function') fail('FEED_IMPORT_STORE_REQUIRED');
  if (prepareCheckpointStatements !== undefined && typeof prepareCheckpointStatements !== 'function') fail('FEED_IMPORT_CHECKPOINT_EXTENSION_INVALID');
  // Freeze the receipt before asynchronous reads; callers cannot change a
  // record after its checksum has been validated.
  try {receipt = structuredClone(receipt);} catch {fail('FEED_IMPORT_RECEIPT_INVALID');}
  const now = store.now();
  validateReceipt(receipt, now);
  const key = `file-snapshot:${receipt.fileSha256}`, batchKey = `file-batch:${receipt.fileSha256}:${receipt.offset}`;
  const task = await db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').bind(key).first();
  const previous = task ? parseState(task, receipt) : {version: 1, generationId: receipt.generationId,
    batchSize: receipt.batchSize ?? 20,
    observationTimeBasis: receipt.observationTimeBasis ?? 'capture',
    fileSha256: receipt.fileSha256, observedAt: receipt.observedAt, totalRecords: receipt.totalRecords,
    offset: 0, inserted: 0, updated: 0, rejected: 0, skipped: 0};
  const end = receipt.offset + receipt.records.length;
  if (receipt.offset < previous.offset) {
    const saved = await db.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(batchKey).first();
    let audit;
    try {audit = JSON.parse(saved?.cursor);} catch {fail('FEED_IMPORT_REPLAY_UNVERIFIED');}
    if (audit.batchSha256 !== receipt.batchSha256 || audit.offset !== receipt.offset || audit.end !== end
        || end > previous.offset) fail('FEED_IMPORT_REPLAY_UNVERIFIED');
    return {alreadyApplied: true, state: previous, audit};
  }
  if (receipt.offset !== previous.offset) fail('FEED_IMPORT_PAGE_GAP');
  const at = new Date(now).toISOString();
  // At most three independent baseline reads, then ONE atomic commit. The
  // existing commit validates identities across all chunks and fences every row.
  const chunks = [];
  for (let offset = 0; offset < receipt.records.length; offset += MAX_PAGE_RECORDS) {
    chunks.push(receipt.records.slice(offset, offset + MAX_PAGE_RECORDS));
  }
  const preparedPages = await Promise.all(chunks.map(records => prepareInventoryPage({db, provider,
    records, observedAt: receipt.observedAt, processedAt: at, freshnessPolicy,
    observationTimeBasis: receipt.observationTimeBasis ?? 'capture'})));
  const prepared = Object.fromEntries(['prepared', 'rejected', 'skipped']
    .map(key => [key, preparedPages.flatMap(page => page[key])]));
  if (prepared.prepared.length + prepared.rejected.length + prepared.skipped.length !== receipt.records.length) fail('FEED_IMPORT_ACCOUNTING_INVALID');
  const inserted = prepared.prepared.filter(item => item.inserted).length;
  const state = {...previous, offset: end, inserted: previous.inserted + inserted,
    updated: previous.updated + prepared.prepared.length - inserted,
    rejected: previous.rejected + prepared.rejected.length, skipped: previous.skipped + prepared.skipped.length};
  const audit = {offset: receipt.offset, end, batchSha256: receipt.batchSha256,
    inserted, updated: prepared.prepared.length - inserted, rejected: prepared.rejected, skipped: prepared.skipped};
  const guardId = randomUUID();
  const checkpointGuard = db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed)
    SELECT ?,CASE WHEN
      ((? IS NULL AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?))
        OR EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND cursor IS ?))
      AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?) THEN 1 ELSE 0 END`)
    .bind(guardId, task?.cursor ?? null, key, key, task?.cursor ?? null, batchKey);
  const status = end === receipt.totalRecords ? 'complete' : 'importing';
  const checkpoint = db.prepare(`INSERT INTO automatic_refresh_tasks
    (task_key,platform,cursor,scan_pages,scan_errors,next_due_at,last_attempt_at,last_success_at,status,last_error_code)
    VALUES(?,'all',?,1,?,?,?,?,?,?) ON CONFLICT(task_key) DO UPDATE SET cursor=excluded.cursor,
      scan_pages=automatic_refresh_tasks.scan_pages+1,scan_errors=automatic_refresh_tasks.scan_errors+excluded.scan_errors,
      last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,status=excluded.status,
      last_error_code=excluded.last_error_code`)
    .bind(key, JSON.stringify(state), prepared.rejected.length, at, at, at, status,
      state.rejected ? 'FEED_IMPORT_REJECTIONS_RECORDED' : null);
  // Rejected identities and older observations remain auditable in the SAME
  // transaction. They never silently disappear from a file's accounting.
  const auditStatement = db.prepare(`INSERT INTO automatic_refresh_tasks
    (task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
    VALUES(?,'all',?,?,?,?,'complete')`).bind(batchKey, JSON.stringify(audit), at, at, at);
  // Additive caller-owned checkpoints (for example baseline membership) must
  // share the canonical transaction. A replay returns above and never reruns
  // this factory. Isolate its data from the canonical prepared observations.
  const additional = prepareCheckpointStatements ? await prepareCheckpointStatements({db,
    ...structuredClone({receipt, prepared: prepared.prepared, rejected: prepared.rejected,
      skipped: prepared.skipped, state, audit})}) : [];
  if (!Array.isArray(additional) || additional.length > 6
      || additional.some(statement => !statement || typeof statement !== 'object')) fail('FEED_IMPORT_CHECKPOINT_EXTENSION_INVALID');
  const committed = await commitInventoryBatch({db, store, prepared: prepared.prepared,
    checkpointStatements: [checkpointGuard, auditStatement, checkpoint, ...additional,
      db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(guardId)]});
  return {alreadyApplied: false, state, audit, committed};
}
module.exports = {importSnapshotBatch, validateSnapshotMetadata, validateReceipt, hash};
