'use strict';

// Offline planning/rehearsal plus an injected D1 executor. No connection,
// credentials, provider requests, schema migration or account-data transfer.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {buildPublicCatalogMerge, PUBLIC_COLUMNS} = require('./public-catalog-merge.cjs');
const {HISTORY_RECEIPT_SQL, HISTORY_FAILURE_SQL} = require('./targeted-history-import.cjs');
const {TARGETS, assertStatement} = require('./d1-operator-bridge.cjs');
const {atomicJson} = require('./catalog-refresh-campaign.cjs');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalized = value => String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
const when = value => value == null ? -Infinity : Date.parse(value);
const RECEIPT_COLUMNS = ['scope_key','provider','platform','operation','status','cursor',
  'last_attempt_at','last_success_at','last_complete_at','last_error_code','updated_at'];
const HEALTH_COLUMNS = ['last_attempt_at','last_success_at','last_error_code','sync_status'];
const READ_COLUMNS = {...PUBLIC_COLUMNS,
  vehicle_sources: [...PUBLIC_COLUMNS.vehicle_sources, ...HEALTH_COLUMNS],
  auction_listing_snapshots: PUBLIC_COLUMNS.auction_listing_snapshots.filter(name => name !== 'snapshot_id'),
  provider_sync_scopes: RECEIPT_COLUMNS};
const KEY_COLUMNS = {vehicle_sources:'source_key',auction_listings:'listing_id',
  auction_listing_snapshots:'listing_id',auction_events:'event_id',provider_sync_scopes:'scope_key'};
function fail(code) { throw Error(code); }
function validTime(value, capture, required = false) {
  return !required && value === null || typeof value === 'string'
    && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(capture);
}
function validateCapture(capture, target) {
  if (capture?.target !== target || capture.identity?.id !== TARGETS[target].id
      || capture.identity?.name !== TARGETS[target].name || !Array.isArray(capture.fk) || capture.fk.length
      || !Number.isFinite(Date.parse(capture.at)) || !Array.isArray(capture.receipts)
      || !Array.isArray(capture.health)) fail('STAGING_TRANSFER_CAPTURE_IDENTITY');
}
function checkLinkedIdentities(tables) {
  const listings = new Map(tables.auction_listings.map(row => [row.listing_id, row]));
  for (const event of tables.auction_events) {
    if (event.listing_id == null) continue;
    const listing = listings.get(event.listing_id);
    if (!listing || normalized(event.lot) !== normalized(listing.lot)
        || normalized(event.vin_normalized) !== normalized(listing.vin_normalized)) {
      fail('STAGING_TRANSFER_EVENT_IDENTITY_CONFLICT');
    }
  }
  const snapshots = new Set();
  for (const row of tables.auction_listing_snapshots) {
    const key = JSON.stringify([row.listing_id,row.observed_at,row.fingerprint]);
    if (snapshots.has(key)) fail('STAGING_TRANSFER_DUPLICATE_SNAPSHOT');
    snapshots.add(key);
  }
}
function valueAt(statement, field) {
  const index = statement.columns?.indexOf(field) ?? -1;
  return index < 0 ? null : statement.params[index];
}
function verification(statements) {
  const refs = new Map();
  for (const item of statements) {
    if (item.guard) continue;
    const key = item.verifyKey ?? valueAt(item, KEY_COLUMNS[item.table]);
    if (key === null || !READ_COLUMNS[item.table]) fail('STAGING_TRANSFER_VERIFY_KEY');
    if (!refs.has(item.table)) refs.set(item.table, new Set());
    refs.get(item.table).add(key);
  }
  const result = [];
  for (const [table, keys] of refs) {
    const all = [...keys].sort();
    for (let i = 0; i < all.length; i += 80) {
      const params = all.slice(i, i + 80), columns = READ_COLUMNS[table];
      const order = table === 'auction_listing_snapshots'
        ? 'listing_id,observed_at,fingerprint' : KEY_COLUMNS[table];
      result.push({sql: `SELECT ${columns.join(',')} FROM ${table} WHERE ${KEY_COLUMNS[table]} IN (${params.map(() => '?').join(',')}) ORDER BY ${order}`, params});
    }
  }
  return result;
}
function addGroup(groups, kind, statements) {
  if (!statements.length) return;
  const verify = verification(statements);
  groups.push({kind, statements, verify, sha256: sha({statements, verify})});
}
function newerReceipt(target, source) {
  const watermark = Math.max(...['last_attempt_at','last_success_at','last_complete_at','updated_at'].map(key => when(source[key])));
  return ['last_attempt_at','last_success_at','last_complete_at','updated_at'].some(key => when(target?.[key]) > watermark)
    || source.status !== 'failed' && when(target?.last_success_at) > when(source.last_success_at);
}

function receiptGuard(listing, previous, capturedAt) {
  const compared = ['provider','platform','operation','status','last_attempt_at','last_success_at','last_complete_at','updated_at'];
  const scope = 'history-import:' + listing.listing_id;
  const existing = previous
    ? `EXISTS(SELECT 1 FROM provider_sync_scopes WHERE scope_key=? AND ${compared.map(key => key + ' IS ?').join(' AND ')})`
    : 'NOT EXISTS(SELECT 1 FROM provider_sync_scopes WHERE scope_key=?)';
  // The provider NOT NULL constraint is an atomic assertion. In the successful
  // branch the SELECT produces no row; a concurrent identity/state change
  // aborts the entire receipt batch without creating or changing a source.
  return {table: 'vehicle_sources', guard: true, sql: `INSERT INTO vehicle_sources
    (source_key,provider,platform,first_seen_at,last_seen_at,created_at,updated_at)
    SELECT ?,NULL,?,?,?,?,? WHERE NOT EXISTS(
      SELECT 1 FROM auction_listings WHERE listing_id=? AND source_key=? AND platform=? AND lot=? AND vin_normalized IS ?)
      OR NOT (${existing})`,
    params: ['staging-transfer-assertion',listing.platform,capturedAt,capturedAt,capturedAt,capturedAt,
      listing.listing_id,listing.source_key,listing.platform,listing.lot,listing.vin_normalized ?? null,
      scope,...(previous ? compared.map(key => previous[key] ?? null) : [])]};
}

const EVENT_FIELDS = PUBLIC_COLUMNS.auction_events;
const EVENT_METADATA = new Set(['observed_at','updated_at','normalizer_version','fingerprint','created_at']);
const EVENT_CORRECTABLE = new Set(['source_status','canonical_status','source_price_usd','final_price_usd']);
const eventRow = row => Object.fromEntries(EVENT_FIELDS.map(key => [key,row[key] ?? null]));
const different = (a,b,fields = EVENT_FIELDS) => fields.filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
const hashValue = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function approvedEventFields(fields) {
  if (!Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length
      || fields.some(field => !EVENT_CORRECTABLE.has(field))) fail('STAGING_EVENT_FIELDS_REQUIRED');
  return [...fields].sort();
}
function eventCorrection(before, source, allowedFields, capturedAt) {
  before = eventRow(before); source = eventRow(source);
  const contentChanges = different(before,source).filter(key => !EVENT_METADATA.has(key));
  if (!contentChanges.length || contentChanges.some(key => !allowedFields.includes(key))) {
    fail('STAGING_EVENT_UNAPPROVED_CHANGE');
  }
  if (!before.listing_id || !before.source_key || before.provider !== 'apibara'
      || !['copart','iaai'].includes(before.platform) || !/^\d+$/.test(before.lot || '')
      || !/^[A-HJ-NPR-Z0-9]{17}$/.test(before.vin_normalized || '')
      || before.identity_state !== 'resolved'
      || !hashValue(before.fingerprint) || !hashValue(source.fingerprint)
      || before.fingerprint === source.fingerprint) fail('STAGING_EVENT_EVIDENCE_INVALID');
  if (!['observed_at','created_at','updated_at'].every(key => validTime(before[key],capturedAt,true)
        && validTime(source[key],capturedAt,true))
      || when(source.observed_at) <= when(before.observed_at)
      || when(source.observed_at) < when(before.updated_at)
      || when(source.updated_at) < when(source.observed_at)
      || !Number.isSafeInteger(source.normalizer_version) || source.normalizer_version < 1) {
    fail('STAGING_EVENT_OBSERVATION_NOT_NEWER');
  }
  // Creation time belongs to the retained staging event, even if an independent
  // source database first imported that event at a different time.
  const after = {...source,created_at:before.created_at};
  return {event_id:before.event_id,listing_id:before.listing_id,
    changed_fields:contentChanges,updated_columns:different(before,after),
    old_fingerprint:before.fingerprint,new_fingerprint:after.fingerprint,
    old_observed_at:before.observed_at,new_observed_at:after.observed_at,
    before_sha256:sha(before),source_sha256:sha(source),after_sha256:sha(after),
    before,source,after};
}
function buildEventReconciliation(source,target,{allowedFields} = {}) {
  validateCapture(source,'publication'); validateCapture(target,'staging');
  const fields = approvedEventFields(allowedFields);
  checkLinkedIdentities(source.tables); checkLinkedIdentities(target.tables);
  const existing = new Map(target.tables.auction_events.map(row => [row.event_id,row]));
  const corrections = [];
  for (const row of source.tables.auction_events) {
    const previous = existing.get(row.event_id);
    if (!previous || !different(eventRow(previous),eventRow(row)).some(key => !EVENT_METADATA.has(key))) continue;
    corrections.push(eventCorrection(previous,row,fields,source.at));
  }
  if (corrections.length) for (const capture of [source,target]) {
    const names = capture.columns.auction_events.map(column => typeof column === 'string' ? column : column.name);
    if (names.length !== EVENT_FIELDS.length || EVENT_FIELDS.some(name => !names.includes(name))) {
      fail('STAGING_EVENT_SCHEMA_UNSUPPORTED');
    }
  }
  corrections.sort((a,b) => a.event_id.localeCompare(b.event_id,'en'));
  return {format:'rexbid-event-reconciliation-v1',source_id:TARGETS.publication.id,
    target_id:TARGETS.staging.id,source_capture_sha256:sha(source),target_capture_sha256:sha(target),
    captured_at:source.at,allowed_fields:fields,corrections};
}
function validateEventReconciliation(reconciliation) {
  if (!reconciliation || reconciliation.format !== 'rexbid-event-reconciliation-v1'
      || reconciliation.source_id !== TARGETS.publication.id || reconciliation.target_id !== TARGETS.staging.id
      || !hashValue(reconciliation.source_capture_sha256) || !hashValue(reconciliation.target_capture_sha256)
      || !Number.isFinite(Date.parse(reconciliation.captured_at)) || !Array.isArray(reconciliation.corrections)) {
    fail('STAGING_EVENT_RECONCILIATION_INVALID');
  }
  const fields = approvedEventFields(reconciliation.allowed_fields), ids = new Set();
  if (JSON.stringify(fields) !== JSON.stringify(reconciliation.allowed_fields)) fail('STAGING_EVENT_RECONCILIATION_CHANGED');
  for (const item of reconciliation.corrections) {
    if (ids.has(item.event_id) || JSON.stringify(item) !== JSON.stringify(
      eventCorrection(item.before,item.source,fields,reconciliation.captured_at))) fail('STAGING_EVENT_RECONCILIATION_CHANGED');
    ids.add(item.event_id);
  }
}
function eventCorrectionStatements(item,capturedAt) {
  const row = item.before;
  const previous = EVENT_FIELDS.map(key => key + ' IS ?').join(' AND ');
  const values = EVENT_FIELDS.map(key => row[key]);
  // A NOT NULL assertion rejects any concurrent change to the complete prior
  // event, including clocks, fingerprints and nullable fields, in this batch.
  const guard = {table:'vehicle_sources',guard:true,sql:`INSERT INTO vehicle_sources
    (source_key,provider,platform,first_seen_at,last_seen_at,created_at,updated_at)
    SELECT ?,NULL,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM auction_events WHERE ${previous})
      OR NOT EXISTS(SELECT 1 FROM auction_listings l JOIN vehicle_sources s ON s.source_key=l.source_key
        WHERE l.listing_id=? AND l.source_key=? AND l.platform=? AND l.lot=? AND l.vin_normalized=?
          AND s.provider='apibara' AND s.platform=l.platform)`,
    params:['staging-event-reconciliation-assertion',row.platform,capturedAt,capturedAt,capturedAt,capturedAt,
      ...values,row.listing_id,row.source_key,row.platform,row.lot,row.vin_normalized]};
  const update = {table:'auction_events',verifyKey:row.event_id,
    sql:`UPDATE auction_events SET ${item.updated_columns.map(key => key + '=?').join(',')}
      WHERE ${previous}`,
    params:[...item.updated_columns.map(key => item.after[key]),...values]};
  return [guard,update];
}
function verifyEventPreservation(beforeRows,afterRows,reconciliation = null) {
  if (reconciliation) validateEventReconciliation(reconciliation);
  const corrections = new Map((reconciliation?.corrections || []).map(item => [item.event_id,item]));
  const before = new Map(beforeRows.map(row => [row.event_id,row]));
  const after = new Map(afterRows.map(row => [row.event_id,row]));
  if (before.size !== beforeRows.length || after.size !== afterRows.length) fail('STAGING_EVENT_PRESERVATION_DUPLICATE');
  let changed = 0;
  for (const [id,row] of before) {
    const correction = corrections.get(id), current = after.get(id);
    if (!current || correction && sha(eventRow(row)) !== correction.before_sha256) {
      fail('STAGING_EVENT_PRESERVATION_CHANGED');
    }
    const expected = correction ? {...row,...correction.after} : row;
    if (Object.keys(expected).length !== Object.keys(current).length
        || Object.keys(expected).some(key => JSON.stringify(expected[key]) !== JSON.stringify(current[key]))) {
      fail('STAGING_EVENT_PRESERVATION_CHANGED');
    }
    if (correction) changed++;
  }
  if (changed !== corrections.size) fail('STAGING_EVENT_PRESERVATION_MISSING');
  return {exact_approved_delta:true,before:before.size,after:after.size,added:after.size-before.size,
    unchanged:before.size-changed,corrected:changed,reconciliation_sha256:reconciliation ? sha(reconciliation) : null};
}
function verifyEventAudit(plan,file) {
  if (!plan.eventReconciliation?.corrections.length) return null;
  if (!path.isAbsolute(file || '')) fail('STAGING_EVENT_DURABLE_AUDIT_REQUIRED');
  let audit; try {audit = JSON.parse(fs.readFileSync(file,'utf8'));} catch {fail('STAGING_EVENT_DURABLE_AUDIT_REQUIRED');}
  if (audit.format !== 'rexbid-event-reconciliation-audit-v1'
      || audit.plan_sha256 !== plan.manifest.plan_sha256
      || audit.reconciliation_sha256 !== sha(plan.eventReconciliation)
      || sha(audit.reconciliation) !== audit.reconciliation_sha256
      || !hashValue(audit.backup_manifest_sha256) || !hashValue(audit.capture_sha256)
      || audit.backup?.database_id !== TARGETS.staging.id || audit.backup.database !== TARGETS.staging.name
      || audit.backup.roundtrip !== true || !Number.isSafeInteger(audit.backup.bytes) || audit.backup.bytes < 1
      || !hashValue(audit.backup.plaintext_sha256) || !hashValue(audit.backup.ciphertext_sha256)) {
    fail('STAGING_EVENT_DURABLE_AUDIT_CHANGED');
  }
  return sha(audit);
}

function prepareStagingPublicTransfer(source, target, {maxStatementsPerGroup = 80,eventReconciliation = null} = {}) {
  validateCapture(source, 'publication'); validateCapture(target, 'staging');
  if (!Number.isSafeInteger(maxStatementsPerGroup) || maxStatementsPerGroup < 3 || maxStatementsPerGroup > 100) {
    fail('STAGING_TRANSFER_GROUP_LIMIT');
  }
  checkLinkedIdentities(source.tables); checkLinkedIdentities(target.tables);
  const targetListings = new Map(target.tables.auction_listings.map(row => [row.listing_id,row]));
  const targetSources = new Map(target.tables.vehicle_sources.map(row => [row.source_key,row]));
  const targetHealthSeen = new Set();
  for (const row of target.health) {
    if (!targetSources.has(row.source_key) || targetHealthSeen.has(row.source_key)
        || !validTime(row.last_attempt_at,target.at) || !validTime(row.last_success_at,target.at)) {
      fail('STAGING_TRANSFER_TARGET_HEALTH_INVALID');
    }
    targetHealthSeen.add(row.source_key);
  }
  for (const row of source.tables.auction_listings) {
    const other = targetListings.get(row.listing_id);
    // The merge SQL requires equality of non-null VINs. Do not allow a masked
    // identity to silently skip data and subsequently receive a complete receipt.
    if (row.vin_normalized && other?.vin_normalized
        && normalized(row.vin_normalized) !== normalized(other.vin_normalized)) fail('STAGING_TRANSFER_VIN_CONFLICT');
  }
  if (eventReconciliation && JSON.stringify(eventReconciliation) !== JSON.stringify(
    buildEventReconciliation(source,target,{allowedFields:eventReconciliation.allowed_fields}))) {
    fail('STAGING_EVENT_RECONCILIATION_CHANGED');
  }
  const corrections = new Map((eventReconciliation?.corrections || []).map(item => [item.event_id,item]));
  // The generic merge still rejects every conflicting event. Only exact
  // evidence-bound corrections use the separate guarded UPDATE path below.
  const mergeTables = {...source.tables,auction_events:source.tables.auction_events.map(row =>
    corrections.get(row.event_id)?.before || row)};
  const delta = buildPublicCatalogMerge({tables: mergeTables, columns: source.columns,
    existingTables: target.tables, existingColumns: target.columns, capturedAt: source.at,
    maxStatementsPerGroup, deltaOnly: true});
  const groups = [];
  // Pack whole atomic listing/history groups to reduce remote round trips;
  // an original group is never split across batches.
  let catalog = [];
  for (const group of delta.groups) {
    if (catalog.length + group.statements.length > maxStatementsPerGroup) {
      addGroup(groups,'catalog',catalog); catalog = [];
    }
    catalog.push(...group.statements);
  }
  addGroup(groups,'catalog',catalog);
  let eventBatch = [];
  for (const item of corrections.values()) {
    if (eventBatch.length + 2 > maxStatementsPerGroup) {
      addGroup(groups,'event_reconciliation',eventBatch); eventBatch = [];
    }
    eventBatch.push(...eventCorrectionStatements(item,source.at));
  }
  addGroup(groups,'event_reconciliation',eventBatch);
  const known = new Map(source.tables.auction_listings.map(row => [row.listing_id,row]));
  const sourceRows = new Map(source.tables.vehicle_sources.map(row => [row.source_key,row]));
  const health = [], healthSeen = new Set();
  let healthSkipped = 0, receiptSkipped = 0;
  for (const row of source.health) {
    const own = sourceRows.get(row.source_key);
    if (!own || healthSeen.has(row.source_key)
        || !validTime(row.last_attempt_at, source.at) || !validTime(row.last_success_at, source.at)
        || when(row.last_success_at) > when(row.last_attempt_at)) fail('STAGING_TRANSFER_HEALTH_IDENTITY');
    healthSeen.add(row.source_key);
    if (!row.last_attempt_at || !row.last_error_code && (!row.last_success_at
        || when(row.last_success_at) !== when(row.last_attempt_at))) { healthSkipped++; continue; }
    const code = row.last_error_code ? 'PUBLIC_SOURCE_REFRESH_FAILED' : null;
    health.push({table:'vehicle_sources',verifyKey:row.source_key,sql:`UPDATE vehicle_sources
      SET last_attempt_at=?,last_success_at=CASE WHEN ? IS NOT NULL
        AND julianday(?)>=COALESCE(julianday(last_success_at),-1) THEN ? ELSE last_success_at END,
        last_error_code=?,sync_status=?
      WHERE source_key=? AND provider='apibara' AND platform=?
        AND julianday(?)>=MAX(COALESCE(julianday(last_attempt_at),-1),COALESCE(julianday(last_success_at),-1),COALESCE(julianday(last_seen_at),-1))`,
      params:[row.last_attempt_at,row.last_success_at,row.last_success_at,row.last_success_at,code,
        code ? 'failed' : 'idle',row.source_key,own.platform,row.last_attempt_at]});
  }
  for (let i = 0; i < health.length; i += maxStatementsPerGroup) addGroup(groups, 'health', health.slice(i, i + maxStatementsPerGroup));
  const previousReceipts = new Map();
  for (const row of target.receipts) {
    const id = row.scope_key?.startsWith('history-import:') ? row.scope_key.slice(15) : null;
    const listing = targetListings.get(id);
    if (previousReceipts.has(row.scope_key)) fail('STAGING_TRANSFER_DUPLICATE_RECEIPT');
    if (!listing || row.provider !== 'apibara' || row.platform !== listing.platform
        || row.operation !== 'history_refresh' || !['complete','partial','failed'].includes(row.status)
        || !['last_attempt_at','last_success_at','last_complete_at','updated_at'].every(key =>
          validTime(row[key],target.at,key === 'updated_at'))) fail('STAGING_TRANSFER_TARGET_RECEIPT_INVALID');
    previousReceipts.set(row.scope_key,row);
  }
  const seen = new Set(), receipts = [], affectedScopes = [];
  for (const row of source.receipts) {
    const id = row.scope_key?.startsWith('history-import:') ? row.scope_key.slice(15) : null;
    const listing = known.get(id);
    if (!listing || seen.has(row.scope_key) || row.provider !== 'apibara' || row.platform !== listing.platform
        || row.operation !== 'history_refresh' || !['complete','partial','failed'].includes(row.status)
        || !validTime(row.last_attempt_at,source.at,true) || !validTime(row.updated_at,source.at,true)
        || !validTime(row.last_success_at,source.at) || !validTime(row.last_complete_at,source.at)
        || when(row.last_success_at) > when(row.last_attempt_at) || when(row.last_attempt_at) > when(row.updated_at)
        || when(row.last_complete_at) > when(row.last_success_at)
        || row.status === 'complete' && (!row.last_success_at || !row.last_complete_at)) {
      fail('STAGING_TRANSFER_RECEIPT_INVALID');
    }
    seen.add(row.scope_key);
    const previous = previousReceipts.get(row.scope_key);
    if (previous && (previous.provider !== 'apibara' || previous.platform !== listing.platform
        || previous.operation !== 'history_refresh')) fail('STAGING_TRANSFER_RECEIPT_IDENTITY');
    if (newerReceipt(previous,row) || row.status === 'partial' && !row.last_success_at) { receiptSkipped++; continue; }
    const statement = row.status === 'failed'
      ? {sql:HISTORY_FAILURE_SQL,params:[row.scope_key,'apibara',row.platform,row.last_attempt_at,
        'PUBLIC_HISTORY_READ_FAILED',row.updated_at,id,row.platform,listing.lot]}
      : {sql:HISTORY_RECEIPT_SQL,params:[row.scope_key,'apibara',row.platform,row.status,null,
        row.last_attempt_at,row.last_success_at,row.status === 'complete' ? row.last_complete_at : null,row.updated_at]};
    // Reassert the corrected rows in the receipt transaction too: a writer
    // changing one after correction readback must not receive our fresh receipt.
    const correctedEventGuards = [...corrections.values()].filter(item => item.listing_id === id)
      .map(item => eventCorrectionStatements({...item,before:item.after},source.at)[0]);
    if (correctedEventGuards.length + 2 > maxStatementsPerGroup) fail('STAGING_TRANSFER_RECEIPT_GROUP_LIMIT');
    receipts.push([...correctedEventGuards,receiptGuard(listing,previous,source.at),
      {table:'provider_sync_scopes',verifyKey:row.scope_key,...statement}]);
    affectedScopes.push(row.scope_key);
  }
  let pending = [];
  for (const pair of receipts) {
    if (pending.length + pair.length > maxStatementsPerGroup) { addGroup(groups,'receipts',pending); pending = []; }
    pending.push(...pair);
  }
  addGroup(groups,'receipts',pending);
  return {groups,eventReconciliation, manifest:{...delta.manifest,format:'rexbid-staging-public-transfer-v1',
    source:TARGETS.publication,target:TARGETS.staging,group_count:groups.length,
    statement_count:groups.reduce((sum,group) => sum + group.statements.length,0),
    plan_sha256:sha(groups),affected_history_scopes:affectedScopes,
    health_skipped_unconfirmed:healthSkipped,receipts_skipped_older_or_unconfirmed:receiptSkipped,
    provider_requests:0,accounts_included:false,operational_state_included:false,
    history_receipts_included:true,event_corrections:corrections.size,
    event_reconciliation_sha256:eventReconciliation ? sha(eventReconciliation) : null}};
}

function validatePlan(plan) {
  if (plan?.manifest?.format !== 'rexbid-staging-public-transfer-v1'
      || plan.manifest.source?.id !== TARGETS.publication.id || plan.manifest.target?.id !== TARGETS.staging.id
      || !Array.isArray(plan.groups) || sha(plan.groups) !== plan.manifest.plan_sha256
      || plan.groups.some(group => sha({statements:group.statements,verify:group.verify}) !== group.sha256)) {
    fail('STAGING_TRANSFER_PLAN_CHANGED');
  }
  const publicTables = new Set(Object.keys(PUBLIC_COLUMNS));
  if (plan.eventReconciliation) validateEventReconciliation(plan.eventReconciliation);
  if ((plan.manifest.event_corrections || 0) !== (plan.eventReconciliation?.corrections.length || 0)
      || (plan.manifest.event_reconciliation_sha256 || null) !== (plan.eventReconciliation ? sha(plan.eventReconciliation) : null)) {
    fail('STAGING_EVENT_RECONCILIATION_CHANGED');
  }
  const approved = (plan.eventReconciliation?.corrections || []).flatMap(item =>
    eventCorrectionStatements(item,plan.eventReconciliation.captured_at));
  const planned = plan.groups.filter(group => group.kind === 'event_reconciliation').flatMap(group => group.statements);
  if (JSON.stringify(approved) !== JSON.stringify(planned)
      || plan.groups.some(group => group.kind !== 'event_reconciliation'
        && group.statements.some(item => /^\s*UPDATE\s+auction_events\b/i.test(item.sql)))) {
    fail('STAGING_EVENT_RECONCILIATION_CHANGED');
  }
  for (const group of plan.groups) for (const item of group.statements) {
    if (item.sql === HISTORY_RECEIPT_SQL || item.sql === HISTORY_FAILURE_SQL) {
      if (item.params?.length !== 9 || !plan.manifest.affected_history_scopes.includes(item.params[0])
          || item.params[1] !== 'apibara' || !['copart','iaai'].includes(item.params[2])
          || item.sql === HISTORY_RECEIPT_SQL && (!['complete','partial'].includes(item.params[3]) || item.params[4] !== null)
          || item.sql === HISTORY_FAILURE_SQL && (item.params[0] !== 'history-import:' + item.params[6]
            || item.params[2] !== item.params[7] || !/^\d+$/.test(item.params[8])
            || item.params[4] !== 'PUBLIC_HISTORY_READ_FAILED')) fail('STAGING_TRANSFER_RECEIPT_STATEMENT_INVALID');
    } else assertStatement(item.sql,publicTables);
  }
}
function localRead(sqlite, queries) {
  return queries.map(query => sqlite.prepare(query.sql).all(...query.params));
}
function protectedState(sqlite, affectedScopes, originalKeys) {
  const omitted = new Set([...Object.keys(PUBLIC_COLUMNS),'sqlite_sequence']);
  const result = [];
  for (const {name} of sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) fail('STAGING_TRANSFER_SCHEMA_INVALID');
    if (omitted.has(name)) continue;
    const rows = sqlite.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()
      .filter(row => name !== 'provider_sync_scopes' || !affectedScopes.includes(row.scope_key));
    result.push([name,rows]);
  }
  for (const [table,key,allowed] of [['vehicle_sources','source_key',new Set([...PUBLIC_COLUMNS.vehicle_sources,...HEALTH_COLUMNS])],
    ['auction_listings','listing_id',new Set(PUBLIC_COLUMNS.auction_listings)]]) {
    result.push([table + ':protected-columns',sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY ' + key).all()
      .filter(row => originalKeys[table].has(row[key])).map(row => Object.fromEntries(
        Object.entries(row).filter(([column]) => column === key || !allowed.has(column))))]);
  }
  return sha(result);
}
function rehearseStagingPublicTransfer({plan, schemaSql, baselineSql = ''}) {
  validatePlan(plan);
  if (typeof schemaSql !== 'string' || typeof baselineSql !== 'string') fail('STAGING_TRANSFER_SCHEMA_REQUIRED');
  const {DatabaseSync} = require('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON'); sqlite.exec(schemaSql); if (baselineSql) sqlite.exec(baselineSql);
    if (sqlite.prepare('PRAGMA table_info(vehicle_sources)').all().find(column => column.name === 'provider')?.notnull !== 1) {
      fail('STAGING_TRANSFER_ATOMIC_GUARD_SCHEMA');
    }
    const originalKeys = Object.fromEntries(['vehicle_sources','auction_listings'].map(table => [table,
      new Set(sqlite.prepare('SELECT ' + KEY_COLUMNS[table] + ' FROM ' + table).all().map(row => row[KEY_COLUMNS[table]]))]));
    const before = protectedState(sqlite,plan.manifest.affected_history_scopes,originalKeys), groups = [];
    const priorEvents = sqlite.prepare('SELECT * FROM auction_events ORDER BY event_id').all();
    const priorSnapshots = sqlite.prepare('SELECT * FROM auction_listing_snapshots ORDER BY snapshot_id').all();
    for (const group of plan.groups) {
      const beforeHash = sha(localRead(sqlite,group.verify));
      sqlite.exec('BEGIN');
      try { for (const item of group.statements) sqlite.prepare(item.sql).run(...item.params); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      groups.push({sha256:group.sha256,before_sha256:beforeHash,after_sha256:sha(localRead(sqlite,group.verify))});
    }
    const after = protectedState(sqlite,plan.manifest.affected_history_scopes,originalKeys);
    if (before !== after) fail('STAGING_TRANSFER_PROTECTED_STATE_CHANGED');
    const eventPreservation = verifyEventPreservation(priorEvents,
      sqlite.prepare('SELECT * FROM auction_events ORDER BY event_id').all(),plan.eventReconciliation);
    const snapshotGet = sqlite.prepare('SELECT * FROM auction_listing_snapshots WHERE snapshot_id=?');
    for (const row of priorSnapshots) if (sha(row) !== sha(snapshotGet.get(row.snapshot_id))) {
      fail('STAGING_TRANSFER_SNAPSHOT_CHANGED');
    }
    if (sqlite.prepare('PRAGMA foreign_key_check').all().length
        || sqlite.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) fail('STAGING_TRANSFER_REHEARSAL_INTEGRITY');
    return {passed:true,plan_sha256:plan.manifest.plan_sha256,groups,
      protected_before_sha256:before,protected_after_sha256:after,event_preservation:eventPreservation};
  } finally { sqlite.close(); }
}
function append(file, row) {
  const fd = fs.openSync(file,'a');
  try { fs.writeSync(fd,JSON.stringify(row) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
async function remoteRead(db, queries) {
  if (!queries.length) return [];
  const results = await db.batch(queries.map(query => db.prepare(query.sql).bind(...query.params)));
  if (!Array.isArray(results) || results.length !== queries.length || results.some(row => !Array.isArray(row.results))) {
    fail('STAGING_TRANSFER_READBACK_INVALID');
  }
  return results.map(row => row.results);
}
async function applyStagingPublicTransfer({db, plan, directory, rehearsal, beforeWrite, maxGroups = Infinity,eventAuditFile = null}) {
  validatePlan(plan);
  if (db?.identity?.id !== TARGETS.staging.id || db.identity.name !== TARGETS.staging.name
      || typeof beforeWrite !== 'function' || !path.isAbsolute(directory || '')
      || maxGroups !== Infinity && (!Number.isSafeInteger(maxGroups) || maxGroups < 1)) fail('STAGING_TRANSFER_TARGET_REQUIRED');
  if (rehearsal?.passed !== true || rehearsal.plan_sha256 !== plan.manifest.plan_sha256
      || rehearsal.groups?.length !== plan.groups.length
      || rehearsal.protected_before_sha256 !== rehearsal.protected_after_sha256
      || rehearsal.groups.some((group,index) => group.sha256 !== plan.groups[index].sha256)) {
    fail('STAGING_TRANSFER_REHEARSAL_REQUIRED');
  }
  if (plan.eventReconciliation && (rehearsal.event_preservation?.exact_approved_delta !== true
      || rehearsal.event_preservation.corrected !== plan.eventReconciliation.corrections.length
      || rehearsal.event_preservation.reconciliation_sha256 !== sha(plan.eventReconciliation))) {
    fail('STAGING_TRANSFER_REHEARSAL_REQUIRED');
  }
  const auditHash = verifyEventAudit(plan,eventAuditFile);
  fs.mkdirSync(directory,{recursive:true});
  const lock = path.join(directory,'transfer.lock'), stop = path.join(directory,'transfer-stop.json');
  const ledger = path.join(directory,'transfer-progress.ndjson'), manifest = path.join(directory,'transfer-manifest.json');
  const fd = fs.openSync(lock,'wx'); fs.closeSync(fd);
  try {
    if (fs.existsSync(stop)) fail('STAGING_TRANSFER_STOP_LATCH');
    const config = {plan_sha256:plan.manifest.plan_sha256,rehearsal_sha256:sha(rehearsal),
      source_id:TARGETS.publication.id,target_id:TARGETS.staging.id,event_audit_sha256:auditHash};
    if (fs.existsSync(manifest)) {
      if (JSON.stringify(JSON.parse(fs.readFileSync(manifest,'utf8'))) !== JSON.stringify(config)) fail('STAGING_TRANSFER_RESUME_CHANGED');
    } else atomicJson(manifest,config);
    const text = fs.existsSync(ledger) ? fs.readFileSync(ledger,'utf8') : '';
    if (text && !text.endsWith('\n')) fail('STAGING_TRANSFER_LEDGER_TRUNCATED');
    const progress = text.split('\n').filter(Boolean).map(JSON.parse);
    let next = 0, processed = 0, written = 0, recovered = 0;
    for (const row of progress.filter(row => row.kind === 'complete')) {
      if (row.index !== next || row.sha256 !== plan.groups[next]?.sha256
          || row.after_sha256 !== rehearsal.groups[next]?.after_sha256) fail('STAGING_TRANSFER_PROGRESS_INVALID');
      next++;
    }
    while (next < plan.groups.length && processed < maxGroups) {
      const group = plan.groups[next], expected = rehearsal.groups[next];
      const actual = sha(await remoteRead(db,group.verify));
      if (actual !== expected.before_sha256 && actual !== expected.after_sha256) fail('STAGING_TRANSFER_TARGET_CHANGED');
      if (actual !== expected.after_sha256) {
        await beforeWrite(group,next);
        if (verifyEventAudit(plan,eventAuditFile) !== auditHash) fail('STAGING_EVENT_DURABLE_AUDIT_CHANGED');
        append(ledger,{kind:'attempt',index:next,sha256:group.sha256,at:new Date().toISOString()});
        await db.batch(group.statements.map(item => db.prepare(item.sql).bind(...item.params)));
        if (sha(await remoteRead(db,group.verify)) !== expected.after_sha256) fail('STAGING_TRANSFER_READBACK_MISMATCH');
        written++;
      } else recovered++;
      append(ledger,{kind:'complete',index:next,sha256:group.sha256,
        after_sha256:expected.after_sha256,recovered:actual === expected.after_sha256,at:new Date().toISOString()});
      next++; processed++;
    }
    return {complete:next === plan.groups.length,completedGroups:next,totalGroups:plan.groups.length,
      processedGroups:processed,writtenGroups:written,recoveredGroups:recovered,plan_sha256:plan.manifest.plan_sha256};
  } catch (error) {
    if (!fs.existsSync(stop)) atomicJson(stop,{at:new Date().toISOString(),code:
      /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message || '') ? error.message : 'STAGING_TRANSFER_FAILED',
    plan_sha256:plan.manifest.plan_sha256});
    throw error;
  } finally { fs.unlinkSync(lock); }
}

module.exports = {prepareStagingPublicTransfer,rehearseStagingPublicTransfer,applyStagingPublicTransfer,
  buildEventReconciliation,verifyEventPreservation,verifyEventAudit};
