'use strict';

// Atomic import of COMPLETE, sorted vehicle groups from an already verified
// immutable local index. The reader owns index-file SHA and complete-group
// verification. This boundary binds that identity to a file-only checkpoint;
// it neither fetches provider data nor establishes upstream stream continuity.
const {createHash, randomUUID} = require('node:crypto');
const {planInventoryChangeGroup} = require('./inventory-change-group.cjs');
const {BASELINE_FIELDS} = require('./inventory-change-patch.cjs');
const {parseChangesResponse} = require('../providers/apibara.js');
const MAX_GROUPS = 100, SERVER_MAX_GROUPS = 300, MAX_EVENTS = 100000, MINUTE = 60000;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => {throw Error(code);};
const integer = value => Number.isSafeInteger(value) && value >= 0;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const vin = value => typeof value === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/i.test(value);
const iso = value => new Date(value).toISOString();
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identity = value => `${value.platform}:${value.lot}`;
const DATASET_KEYS = ['identity', 'databaseSha256', 'sources', 'records', 'quarantined', 'firstSequence', 'lastSequence', 'uniqueLots'];
const SOURCE_KEYS = ['generationId', 'sha256', 'records', 'firstSequence', 'lastSequence'];
const RECEIPT_KEYS = ['version', 'dataset', 'observedAt', 'offset', 'eventOffset', 'quarantineOffset', 'groups', 'batchSha256'];

// Fixed metadata ordering makes the binding independent of object key order.
function datasetPayload(dataset) {
  return Object.fromEntries(DATASET_KEYS.map(key => [key, key === 'sources'
    ? dataset.sources.map(source => Object.fromEntries(SOURCE_KEYS.map(name => [name, source[name]]))) : dataset[key]]));
}
function hashReceipt(receipt) {
  return hash({version: receipt.version, dataset: datasetPayload(receipt.dataset), observedAt: receipt.observedAt,
    offset: receipt.offset, eventOffset: receipt.eventOffset, quarantineOffset: receipt.quarantineOffset,
    groups: receipt.groups.map(group => ({platform: group.platform, lot: group.lot,
      events: group.events, quarantinedSequences: group.quarantinedSequences}))});
}
function validateDataset(dataset) {
  if (!exact(dataset, DATASET_KEYS) || !hex(dataset.identity) || !hex(dataset.databaseSha256)
      || !Array.isArray(dataset.sources) || !dataset.sources.length || dataset.sources.length > 96
      || !['records', 'quarantined', 'firstSequence', 'lastSequence', 'uniqueLots'].every(key => integer(dataset[key]))
      || dataset.records < 1 || dataset.uniqueLots < 1 || dataset.uniqueLots > dataset.records
      || dataset.quarantined > dataset.records || dataset.firstSequence < 1
      || dataset.lastSequence < dataset.firstSequence) fail('FEED_CHANGE_DATASET_INVALID');
  let previous = null, records = 0;
  const seen = new Set();
  for (const source of dataset.sources) {
    if (!exact(source, SOURCE_KEYS) || !hex(source.sha256) || seen.has(source.sha256)
        || !['generationId', 'records', 'firstSequence', 'lastSequence'].every(key => integer(source[key]) && source[key] > 0)
        || source.lastSequence < source.firstSequence || source.records > source.lastSequence - source.firstSequence + 1
        || previous !== null && source.firstSequence !== previous + 1) fail('FEED_CHANGE_DATASET_INVALID');
    records += source.records; previous = source.lastSequence; seen.add(source.sha256);
  }
  if (!Number.isSafeInteger(records) || records !== dataset.records
      || dataset.sources[0].firstSequence !== dataset.firstSequence || previous !== dataset.lastSequence
      || hash({version: 1, sources: datasetPayload(dataset).sources}) !== dataset.identity) fail('FEED_CHANGE_DATASET_INVALID');
}
function validateReceipt(receipt, now, namespace = 'file') {
  if (!['file','server'].includes(namespace)) fail('FEED_CHANGE_NAMESPACE_INVALID');
  const maxGroups = namespace === 'server' ? SERVER_MAX_GROUPS : MAX_GROUPS;
  if (!exact(receipt, RECEIPT_KEYS) || receipt.version !== 1 || !Number.isFinite(now)) fail('FEED_CHANGE_RECEIPT_INVALID');
  validateDataset(receipt.dataset);
  if (typeof receipt.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.observedAt)
      || !Number.isFinite(Date.parse(receipt.observedAt)) || iso(Date.parse(receipt.observedAt)) !== receipt.observedAt
      || Date.parse(receipt.observedAt) > now) fail('FEED_CHANGE_TIME_INVALID');
  if (!['offset', 'eventOffset', 'quarantineOffset'].every(key => integer(receipt[key]))
      || !Array.isArray(receipt.groups) || !receipt.groups.length || receipt.groups.length > maxGroups
      || !hex(receipt.batchSha256) || receipt.offset + receipt.groups.length > receipt.dataset.uniqueLots
      || receipt.eventOffset > receipt.dataset.records || receipt.quarantineOffset > receipt.dataset.quarantined) fail('FEED_CHANGE_RECEIPT_INVALID');
  let previousIdentity = '', events = 0, quarantined = 0, firstSequence = Infinity, lastSequence = 0;
  const sequences = new Set(), ids = new Set();
  for (const group of receipt.groups) {
    if (!exact(group, ['platform', 'lot', 'events', 'quarantinedSequences'])
        || !['copart', 'iaai'].includes(group.platform) || typeof group.lot !== 'string' || !/^\d{1,20}$/.test(group.lot)
        || identity(group) <= previousIdentity || !Array.isArray(group.events) || !group.events.length
        || !Array.isArray(group.quarantinedSequences)) fail('FEED_CHANGE_GROUP_INVALID');
    previousIdentity = identity(group);
    events += group.events.length; quarantined += group.quarantinedSequences.length;
    if (events > MAX_EVENTS) fail('FEED_CHANGE_BATCH_TOO_LARGE');
    let previous = 0, previousQuarantine = 0;
    const quarantine = new Set(group.quarantinedSequences);
    for (const sequence of group.quarantinedSequences) {
      if (!integer(sequence) || sequence <= previousQuarantine) fail('FEED_CHANGE_QUARANTINE_INVALID');
      previousQuarantine = sequence;
    }
    for (const event of group.events) {
      if (!event || event.vehicle?.platform !== group.platform || event.vehicle?.lot_number !== group.lot
          || !integer(event.sequence) || event.sequence <= previous || sequences.has(event.sequence) || ids.has(event.event_id)
          || !receipt.dataset.sources.some(source => event.sequence >= source.firstSequence && event.sequence <= source.lastSequence)) fail('FEED_CHANGE_GROUP_INVALID');
      const isQuarantined = quarantine.delete(event.sequence);
      if (isQuarantined && (event.vehicle.vin == null || vin(event.vehicle.vin))) fail('FEED_CHANGE_QUARANTINE_INVALID');
      // Quarantine only exempts the invalid VIN. Every other event field remains
      // subject to the provider parser, including its event/terminal agreement.
      const candidate = isQuarantined ? {...event, vehicle: {...event.vehicle, vin: null}} : event;
      parseChangesResponse({ok: true, data: [candidate], meta: {after: previous, next_cursor: event.sequence,
        has_more: false, count: 1, ordering: 'sequence_asc', schema_version: 'local-group', retention_days: 14}},
      {after: previous, limit: 1});
      sequences.add(event.sequence); ids.add(event.event_id); previous = event.sequence;
      firstSequence = Math.min(firstSequence, event.sequence); lastSequence = Math.max(lastSequence, event.sequence);
    }
    if (quarantine.size) fail('FEED_CHANGE_QUARANTINE_INVALID');
  }
  if (receipt.eventOffset + events > receipt.dataset.records || receipt.quarantineOffset + quarantined > receipt.dataset.quarantined
      || hashReceipt(receipt) !== receipt.batchSha256) fail('FEED_CHANGE_RECEIPT_INVALID');
  return {events, quarantined, firstSequence, lastSequence};
}
const COUNTS = ['offset', 'groupedEvents', 'quarantined', 'updatedGroups', 'queuedGroups', 'identityErrors', 'ignoredEvents', 'plannedPatches'];
function parseState(task, receipt) {
  let state;
  try {state = JSON.parse(task.cursor);} catch {fail('FEED_CHANGE_CHECKPOINT_INVALID');}
  if (task.platform !== 'all' || !['importing', 'complete'].includes(task.status) || state?.version !== 1
      || JSON.stringify(state.dataset) !== JSON.stringify(datasetPayload(receipt.dataset)) || state.observedAt !== receipt.observedAt
      || !COUNTS.every(key => integer(state[key])) || state.offset < 1 || state.offset > receipt.dataset.uniqueLots
      || state.groupedEvents < state.offset || state.groupedEvents > receipt.dataset.records
      || state.quarantined > receipt.dataset.quarantined || state.quarantined > state.groupedEvents
      || state.updatedGroups > state.offset || state.queuedGroups > state.offset || state.identityErrors > state.queuedGroups
      || state.ignoredEvents > state.groupedEvents || state.plannedPatches > state.groupedEvents
      || state.ignoredEvents + state.plannedPatches > state.groupedEvents
      || !/^(copart|iaai):\d{1,20}$/.test(state.lastIdentity || '')
      || !integer(state.firstSequence) || state.firstSequence < receipt.dataset.firstSequence
      || !integer(state.lastSequence) || state.lastSequence < state.firstSequence || state.lastSequence > receipt.dataset.lastSequence
      || state.continuityVerified !== false || state.globalCursorEstablished !== false
      || (task.status === 'complete') !== (state.offset === receipt.dataset.uniqueLots)
      || state.offset === receipt.dataset.uniqueLots && (state.groupedEvents !== receipt.dataset.records
        || state.quarantined !== receipt.dataset.quarantined || state.firstSequence !== receipt.dataset.firstSequence
        || state.lastSequence !== receipt.dataset.lastSequence)) fail('FEED_CHANGE_CHECKPOINT_INVALID');
  return state;
}
function queueStatement(db, entries, coalescePending = false) {
  const columns = ['task_key', 'platform', 'listing_id', 'cursor', 'next_due_at', 'last_attempt_at', 'status', 'failures', 'last_error_code'];
  const deferred = "automatic_refresh_tasks.status='pending' AND automatic_refresh_tasks.failures>0 AND automatic_refresh_tasks.next_due_at>excluded.next_due_at";
  // A pending detail job already covers another unsupported-field observation.
  // Keep its earlier due time and failure backoff; advancing a timestamp alone
  // needlessly rewrites the row and due-time index for every feed generation.
  // Resolved identities, completed work, urgent rescheduling and quarantine
  // retain the original update path. Operator/file receipts keep old behavior.
  const redundantPending = coalescePending ? ` WHERE NOT (
    automatic_refresh_tasks.status='pending' AND excluded.status='pending'
    AND automatic_refresh_tasks.platform IS excluded.platform
    AND automatic_refresh_tasks.listing_id IS excluded.listing_id
    AND automatic_refresh_tasks.cursor IS excluded.cursor
    AND excluded.failures=0 AND excluded.last_error_code IS NULL
    AND (automatic_refresh_tasks.next_due_at<=excluded.next_due_at OR automatic_refresh_tasks.failures>0))` : '';
  return db.prepare(`INSERT INTO automatic_refresh_tasks (${columns.join(',')})
    SELECT ${columns.map(column => `json_extract(value,'$.${column}')`).join(',')} FROM json_each(?) WHERE 1
    ON CONFLICT(task_key) DO UPDATE SET listing_id=excluded.listing_id,cursor=excluded.cursor,last_attempt_at=excluded.last_attempt_at,
      next_due_at=CASE WHEN automatic_refresh_tasks.status='identity_error' OR (${deferred}) THEN automatic_refresh_tasks.next_due_at ELSE excluded.next_due_at END,
      status=CASE WHEN automatic_refresh_tasks.status='identity_error' THEN 'identity_error' ELSE excluded.status END,
      failures=automatic_refresh_tasks.failures+excluded.failures,
      last_error_code=CASE WHEN automatic_refresh_tasks.status='identity_error' OR (${deferred}) THEN automatic_refresh_tasks.last_error_code ELSE excluded.last_error_code END${redundantPending}`)
    .bind(JSON.stringify(entries));
}
function transactionGuard(db, id, key, batchKey, task, baselines) {
  const rowField = name => `json_extract(b.value,'$.${name}')`;
  // D1 limits expression depth to 100. A nested correlated guard with a long
  // left-associated AND chain exceeds that limit even for a single vehicle.
  // Row-value IS keeps the same NULL-safe comparison without the deep chain.
  const sourceFields = ['provider', 'source_platform', 'source_identity_state'];
  const actualFields = [...BASELINE_FIELDS.map(name => `l.${name}`), 's.provider', 's.platform', 's.identity_state'];
  const expectedFields = [...BASELINE_FIELDS, ...sourceFields].map(rowField);
  const lotMatch = "l.platform IS json_extract(g.value,'$.platform') AND l.lot IS json_extract(g.value,'$.lot')";
  return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
    ((? IS NULL AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)) OR
      EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND cursor IS ? AND status IS ?))
    AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)
    AND NOT EXISTS(SELECT 1 FROM json_each(?) g WHERE
      (SELECT COUNT(*) FROM auction_listings l WHERE ${lotMatch})<>json_array_length(g.value,'$.rows') OR
      EXISTS(SELECT 1 FROM json_each(g.value,'$.rows') b WHERE NOT EXISTS(
        SELECT 1 FROM auction_listings l LEFT JOIN vehicle_sources s ON s.source_key=l.source_key WHERE ${lotMatch}
          AND (${actualFields.join(',')}) IS (${expectedFields.join(',')}))))
    THEN 1 ELSE 0 END)`).bind(id, task?.cursor ?? null, key, key, task?.cursor ?? null, task?.status ?? null, batchKey, JSON.stringify(baselines));
}

function changeKeys(datasetHash, namespace = 'file') {
  if (!hex(datasetHash) || !['file', 'server'].includes(namespace)) fail('FEED_CHANGE_NAMESPACE_INVALID');
  return {key: namespace === 'file' ? `file-changes:${datasetHash}` : `server-feed:${datasetHash}`,
    batchKey: offset => `${namespace === 'file' ? 'file-change-batch' : 'server-feed-batch'}:${datasetHash}:${offset}`};
}
async function importChangeBatch({db, store, receipt, namespace = 'file', blockedIdentities = [], checkpointExtension = null} = {}) {
  if (!db?.prepare || !db?.batch || store?.db !== db || !store.owner || typeof store.guarded !== 'function'
      || typeof store.now !== 'function') fail('FEED_CHANGE_STORE_REQUIRED');
  if(checkpointExtension!==null&&(!checkpointExtension||typeof checkpointExtension.key!=='string'||!/^[a-zA-Z0-9:_-]{1,200}$/.test(checkpointExtension.key)||typeof checkpointExtension.prepare!=='function'))fail('FEED_CHANGE_EXTENSION_INVALID');
  if(checkpointExtension?.sparseRepair!==undefined&&(checkpointExtension.sparseRepair!==true||namespace!=='server'))fail('FEED_CHANGE_EXTENSION_INVALID');
  try {receipt = structuredClone(receipt);} catch {fail('FEED_CHANGE_RECEIPT_INVALID');}
  const now = store.now(), totals = validateReceipt(receipt, now, namespace), dataset = datasetPayload(receipt.dataset);
  if (!Array.isArray(blockedIdentities) || blockedIdentities.length > receipt.groups.length
      || new Set(blockedIdentities).size !== blockedIdentities.length
      || blockedIdentities.some(key => !receipt.groups.some(group => identity(group) === key))) fail('FEED_CHANGE_BLOCKED_GROUPS_INVALID');
  blockedIdentities = [...blockedIdentities].sort();
  const keys = changeKeys(dataset.databaseSha256, namespace), key = keys.key, batchKey = keys.batchKey(receipt.offset);
  const task = await db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').bind(key).first();
  const previous = task ? parseState(task, receipt) : {version: 1, dataset, observedAt: receipt.observedAt,
    ...Object.fromEntries(COUNTS.map(name => [name, 0])), lastIdentity: '', firstSequence: null, lastSequence: null,
    continuityVerified: false, globalCursorEstablished: false};
  const end = receipt.offset + receipt.groups.length;
  if (receipt.offset < previous.offset) {
    const saved = await db.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key=?").bind(batchKey).first();
    let audit;
    try {audit = JSON.parse(saved?.cursor);} catch {fail('FEED_CHANGE_REPLAY_UNVERIFIED');}
    if (JSON.stringify(audit?.blockedIdentities || []) !== JSON.stringify(blockedIdentities) || saved.platform !== 'all' || saved.status !== 'complete' || audit?.version !== 1
        || audit.batchSha256 !== receipt.batchSha256 || audit.offset !== receipt.offset || audit.end !== end
        || audit.eventOffset !== receipt.eventOffset || audit.quarantineOffset !== receipt.quarantineOffset
        || audit.events !== totals.events || audit.quarantined !== totals.quarantined || end > previous.offset
        || receipt.eventOffset + totals.events > previous.groupedEvents
        || receipt.quarantineOffset + totals.quarantined > previous.quarantined) fail('FEED_CHANGE_REPLAY_UNVERIFIED');
    if(checkpointExtension&&JSON.stringify(audit.checkpointExtension)!==JSON.stringify({version:1,key:checkpointExtension.key,batchSha256:receipt.batchSha256}))fail('FEED_CHANGE_REPLAY_EXTENSION_MISMATCH');
    return {alreadyApplied: true, state: previous, audit};
  }
  if (receipt.offset !== previous.offset || receipt.eventOffset !== previous.groupedEvents
      || receipt.quarantineOffset !== previous.quarantined || identity(receipt.groups[0]) <= previous.lastIdentity) fail('FEED_CHANGE_GROUP_GAP');
  const response = await db.prepare(`SELECT l.*,s.provider,s.platform AS source_platform,s.identity_state AS source_identity_state FROM json_each(?) g
    JOIN auction_listings l ON l.platform=json_extract(g.value,'$.platform') AND l.lot=json_extract(g.value,'$.lot')
    LEFT JOIN vehicle_sources s ON s.source_key=l.source_key
    ORDER BY l.platform,l.lot,l.listing_id`).bind(JSON.stringify(receipt.groups.map(({platform, lot}) => ({platform, lot})))).all();
  if (!Array.isArray(response?.results)) fail('FEED_CHANGE_READ_INVALID');
  const byKey = new Map();
  for (const row of response.results) {const rows = byKey.get(identity(row)) || []; rows.push(row); byKey.set(identity(row), rows);}
  const baselines = [], statements = [], queue = [], decisions = [], plannedRows = [];
  const counts = {updatedGroups: 0, queuedGroups: 0, identityErrors: 0, ignoredEvents: 0, plannedPatches: 0};
  for (const group of receipt.groups) {
    const rows = byKey.get(identity(group)) || [], row = rows.length === 1 ? rows[0] : null;
    baselines.push({platform: group.platform, lot: group.lot,
      rows: rows.map(item => Object.fromEntries([...BASELINE_FIELDS, 'provider', 'source_platform', 'source_identity_state'].map(name => [name, item[name]])))});
    const plan = planInventoryChangeGroup({row, events: group.events, quarantinedSequences: group.quarantinedSequences, observedAt: receipt.observedAt, trackTimedBid: namespace==='server'});
    const eventVins = new Set(group.events.filter(event => vin(event.vehicle.vin)).map(event => event.vehicle.vin.toUpperCase()));
    const sourceError = row && (row.provider !== 'apibara' || row.source_platform !== row.platform || row.source_identity_state !== 'resolved');
    // A complete record can disagree with its event envelope. Never apply the
    // price-only half of such a group after hydration has quarantined it.
    const recordVins = new Set(group.events.filter(event => event.record != null && vin(event.record?.vin)).map(event => event.record.vin.toUpperCase()));
    const recordIdentityError = group.events.some(event => event.record != null &&
      (event.record.platform !== group.platform || String(event.record.lot_number ?? '') !== group.lot || !vin(event.record.vin)
        || vin(event.vehicle.vin) && event.record.vin.toUpperCase() !== event.vehicle.vin.toUpperCase()))
      || recordVins.size > 1 || row && [...recordVins].some(value => value !== row.vin_normalized?.toUpperCase());
    const identityError = blockedIdentities.includes(identity(group)) || recordIdentityError || rows.length > 1 || sourceError || row && (row.identity_state !== 'resolved' || !vin(row.vin_normalized))
      || group.events.some(event => event.vehicle.vin != null && !vin(event.vehicle.vin)) || eventVins.size > 1 || plan.identityError;
    const reasons = [...new Set([...plan.reasons, ...(identityError ? ['INVENTORY_CHANGE_IDENTITY_CONFLICT'] : [])])].sort();
    if (!identityError && plan.statement) {statements.push(db.prepare(plan.statement.sql).bind(...plan.statement.params)); counts.updatedGroups++;}
    counts.plannedPatches += plan.patches; counts.ignoredEvents += plan.ignored;
    if (identityError || plan.requiresDetail) {
      counts.queuedGroups++; if (identityError) counts.identityErrors++;
      queue.push({task_key: `reconcile:${identity(group)}`, platform: group.platform, listing_id: row?.listing_id ?? null, cursor: group.lot,
        next_due_at: iso(now + (identityError ? 7 * 24 * 60 * MINUTE : 0)), last_attempt_at: receipt.observedAt,
        status: identityError ? 'identity_error' : 'pending', failures: identityError ? 1 : 0,
        last_error_code: identityError ? 'INVENTORY_CHANGE_IDENTITY_CONFLICT' : null});
    }
    if(checkpointExtension)plannedRows.push({platform:group.platform,lot:group.lot,row:row?structuredClone(row):null,afterRow:row?{...row,...(!identityError?plan.assignments:{})}:null,identityError:Boolean(identityError),requiresDetail:Boolean(identityError||plan.requiresDetail),plan:structuredClone(plan)});
    decisions.push({platform: group.platform, lot: group.lot, events: group.events.length,
      firstSequence: plan.firstSequence, lastSequence: plan.lastSequence, quarantinedSequences: group.quarantinedSequences,
      updated: !identityError && Boolean(plan.statement), queued: Boolean(identityError || plan.requiresDetail), identityError: Boolean(identityError), reasons});
  }
  const state = {...previous, offset: end, groupedEvents: previous.groupedEvents + totals.events,
    quarantined: previous.quarantined + totals.quarantined, lastIdentity: identity(receipt.groups.at(-1)),
    firstSequence: Math.min(previous.firstSequence ?? Infinity, totals.firstSequence), lastSequence: Math.max(previous.lastSequence ?? 0, totals.lastSequence),
    ...Object.fromEntries(Object.keys(counts).map(name => [name, previous[name] + counts[name]]))};
  const complete = end === dataset.uniqueLots;
  if (complete && (state.groupedEvents !== dataset.records || state.quarantined !== dataset.quarantined
      || state.firstSequence !== dataset.firstSequence || state.lastSequence !== dataset.lastSequence)
      || !complete && state.groupedEvents + dataset.uniqueLots - end > dataset.records) fail('FEED_CHANGE_ACCOUNTING_INVALID');
  const audit = {version: 1, batchSha256: receipt.batchSha256, offset: receipt.offset, end,
    eventOffset: receipt.eventOffset, quarantineOffset: receipt.quarantineOffset, events: totals.events, quarantined: totals.quarantined,
    ...counts, decisions: namespace === 'server' ? decisions.filter(decision => decision.queued) : decisions,
    ...(namespace === 'server' ? {decisionScope: 'queued_only'} : {}),
    blockedIdentities, continuityVerified: false, globalCursorEstablished: false,
    ...(checkpointExtension?{checkpointExtension:{version:1,key:checkpointExtension.key,batchSha256:receipt.batchSha256}}:{})};
  const guardId = randomUUID(), at = iso(now);
  statements.unshift(transactionGuard(db, guardId, key, batchKey, task, baselines));
  if (queue.length) statements.push(queueStatement(db, queue, namespace === 'server'));
  if(checkpointExtension){
    const extra=await checkpointExtension.prepare({db,store,...structuredClone({receipt,decisions,plannedRows,audit,state})});
    if(!Array.isArray(extra)||extra.length>4+(checkpointExtension.sparseRepair===true?1:0)||extra.some(statement=>!statement||typeof statement!=='object'))fail('FEED_CHANGE_EXTENSION_INVALID');
    statements.push(...extra);
  }
  statements.push(db.prepare(`UPDATE automatic_refresh_state SET lease_until=? WHERE singleton=1
    AND blocked_reason IS NULL AND lease_owner=? AND lease_until>?`).bind(iso(now + 10 * MINUTE), store.owner, at),
  db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
    VALUES(?,'all',?,?,?,?,'complete')`).bind(batchKey, JSON.stringify(audit), at, at, at),
  db.prepare(`INSERT INTO automatic_refresh_tasks
    (task_key,platform,cursor,scan_pages,scan_errors,next_due_at,last_attempt_at,last_success_at,status,last_error_code)
    VALUES(?,'all',?,1,?,?,?,?,?,?) ON CONFLICT(task_key) DO UPDATE SET cursor=excluded.cursor,
      scan_pages=automatic_refresh_tasks.scan_pages+1,scan_errors=automatic_refresh_tasks.scan_errors+excluded.scan_errors,
      next_due_at=excluded.next_due_at,last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,
      status=excluded.status,last_error_code=excluded.last_error_code`)
    .bind(key, JSON.stringify(state), counts.identityErrors, at, at, at, complete ? 'complete' : 'importing',
      state.queuedGroups ? 'FEED_CHANGE_RECONCILIATION_REQUIRED' : null),
  db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(guardId));
  // Each group contributes at most one canonical UPDATE. Aggregate original-row
  // guard/queue plus lease/audit/checkpoint/cleanup retain the same fixed reserve.
  // File/operator calls keep108/112; only explicit server calls allow308/312.
  const statementLimit = (namespace === 'server' ? SERVER_MAX_GROUPS : MAX_GROUPS) + (checkpointExtension ? 12 : 8)+(checkpointExtension?.sparseRepair===true?1:0);
  if (statements.length + 2 > statementLimit) fail('FEED_CHANGE_BATCH_TOO_LARGE');
  await store.guarded(statements);
  return {alreadyApplied: false, state, audit};
}

module.exports = {MAX_GROUPS, SERVER_MAX_GROUPS, MAX_EVENTS, hashReceipt, validateDataset, validateReceipt, changeKeys, importChangeBatch};
