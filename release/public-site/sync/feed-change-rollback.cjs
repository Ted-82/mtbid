'use strict';

// Pure, explicit undo plan for ONE committed file batch. Both snapshots must
// contain every existing row in the receipt's LOT/task scope. Execute all
// returned statements in ONE RefreshStore.guarded transaction; never separately.
// No lease acquisition, I/O, provider calls, listing inserts/deletes or global
// stream changes. A later full observation or task change rejects the entire undo.
const {createHash} = require('node:crypto');
const {validateReceipt} = require('./feed-change-import.cjs');
const {planInventoryChangeGroup} = require('./inventory-change-group.cjs');
const LISTING_COLUMNS = Object.freeze(['listing_id','source_key','platform','listing_identity_kind','identity_state',
  'source_listing_id','listing_generation','vin_normalized','lot','vehicle_title','make','model','trim','year','body_style',
  'fuel_type','transmission','drive_type','engine_size_l','odometer_value','odometer_unit','auction_state','source_status',
  'auction_at','is_timed','timed_end_at','current_bid_usd','current_bid2_usd','buy_now_usd','final_price_usd','source_price_usd',
  'price_currency','seller_name','seller_type','primary_damage','secondary_damage','run_state','keys_present','airbags',
  'document_name','document_type','registration_allowed','export_allowed','location_display','location_state','location_postal_code',
  'has_video','has_360','media_urls_json','media_thumbs_json','source_updated_at','first_seen_at','last_seen_at',
  'summary_synced_at','detail_synced_at','freshness_class','next_refresh_at','fingerprint','normalizer_version','created_at','updated_at']);
const TASK_COLUMNS = Object.freeze(['task_key','platform','listing_id','cursor','scan_started_at','scan_pages','scan_errors',
  'next_due_at','last_attempt_at','last_success_at','status','failures','last_error_code']);
const MUTABLE_LISTING_COLUMNS = Object.freeze(['auction_state','source_status','auction_at','is_timed','timed_end_at',
  'current_bid_usd','current_bid2_usd','buy_now_usd']);
const COUNTS = ['updatedGroups','queuedGroups','identityErrors','ignoredEvents','plannedPatches'];
const fail = code => {throw Error(code);};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1000 && !/[\u0000-\u001f]/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const scalar = value => value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const identity = row => `${row.platform}:${row.lot}`;
const statement = (sql, ...params) => ({sql, params});
const emptyTask = () => ({...Object.fromEntries(TASK_COLUMNS.map(key=>[key,null])),scan_pages:0,scan_errors:0,failures:0});
const json = value => {try {return JSON.parse(value);} catch {fail('FEED_ROLLBACK_EVIDENCE_INVALID');}};
function fullRow(row, columns) {
  if (!object(row) || Object.keys(row).length !== columns.length || columns.some(key => !Object.hasOwn(row,key) || !scalar(row[key])))
    fail('FEED_ROLLBACK_ROW_INVALID');
}
function snapshot(value, groups, taskKeys) {
  if (!object(value) || Object.keys(value).length !== 2 || !Array.isArray(value.listings) || !Array.isArray(value.tasks)
      || value.listings.length > 100 || value.tasks.length > 102) fail('FEED_ROLLBACK_SNAPSHOT_INVALID');
  const listings = new Map(), tasks = new Map(), seenLots = new Set();
  for (const row of value.listings) {
    fullRow(row, Object.hasOwn(row,'exterior_color')?[...LISTING_COLUMNS,'exterior_color']:LISTING_COLUMNS);
    if (!text(row.listing_id) || !text(row.source_key) || !groups.has(identity(row)) || listings.has(row.listing_id) || seenLots.has(identity(row)))
      fail('FEED_ROLLBACK_IDENTITY_INVALID');
    listings.set(row.listing_id,row); seenLots.add(identity(row));
  }
  for (const row of value.tasks) {
    fullRow(row,TASK_COLUMNS);
    if (!taskKeys.has(row.task_key) || tasks.has(row.task_key) || !text(row.status) || !text(row.next_due_at)
        || !['scan_pages','scan_errors','failures'].every(key => integer(row[key]))) fail('FEED_ROLLBACK_TASK_INVALID');
    const group = groups.get(row.task_key.slice('reconcile:'.length));
    if (row.task_key.startsWith('reconcile:')) {
      if (!group || row.platform !== group.platform || row.cursor !== group.lot
          || row.listing_id !== null && !value.listings.some(listing => listing.listing_id === row.listing_id && identity(listing) === identity(group)))
        fail('FEED_ROLLBACK_IDENTITY_INVALID');
    } else if (row.platform !== 'all' || row.listing_id !== null) fail('FEED_ROLLBACK_IDENTITY_INVALID');
    tasks.set(row.task_key,row);
  }
  return {listings,tasks};
}
function validateFileEvidence(receipt, before, after, checkpointKey, auditKey, totals) {
  const checkpoint = after.tasks.get(checkpointKey), auditRow = after.tasks.get(auditKey), previous = before.tasks.get(checkpointKey);
  if (!checkpoint || !auditRow || before.tasks.has(auditKey) || auditRow.status !== 'complete'
      || (receipt.offset === 0) !== !previous) fail('FEED_ROLLBACK_EVIDENCE_INVALID');
  const state = json(checkpoint.cursor), audit = json(auditRow.cursor), prior = previous ? json(previous.cursor) : null;
  const end = receipt.offset + receipt.groups.length;
  if (state?.version !== 1 || audit?.version !== 1 || !same(state.dataset,receipt.dataset) || state.observedAt !== receipt.observedAt
      || state.offset !== end || state.groupedEvents !== receipt.eventOffset + totals.events
      || state.quarantined !== receipt.quarantineOffset + totals.quarantined || state.lastIdentity !== identity(receipt.groups.at(-1))
      || checkpoint.status !== (end === receipt.dataset.uniqueLots ? 'complete' : 'importing')
      || audit.batchSha256 !== receipt.batchSha256 || audit.offset !== receipt.offset || audit.end !== end
      || audit.eventOffset !== receipt.eventOffset || audit.quarantineOffset !== receipt.quarantineOffset
      || audit.events !== totals.events || audit.quarantined !== totals.quarantined
      || !Array.isArray(audit.decisions) || audit.decisions.length !== receipt.groups.length
      || [state,audit].some(item => item.continuityVerified !== false || item.globalCursorEstablished !== false)
      || !COUNTS.every(key => integer(audit[key]) && integer(state[key]) && state[key] === (prior?.[key] ?? 0) + audit[key]))
    fail('FEED_ROLLBACK_EVIDENCE_INVALID');
  if (prior && (prior.version !== 1 || previous.status !== 'importing' || !same(prior.dataset,receipt.dataset)
      || prior.observedAt !== receipt.observedAt || prior.offset !== receipt.offset || prior.groupedEvents !== receipt.eventOffset
      || prior.quarantined !== receipt.quarantineOffset || identity(receipt.groups[0]) <= prior.lastIdentity
      || !COUNTS.every(key => integer(prior[key])) || prior.continuityVerified !== false || prior.globalCursorEstablished !== false)
      || !prior && (receipt.eventOffset !== 0 || receipt.quarantineOffset !== 0)) fail('FEED_ROLLBACK_EVIDENCE_INVALID');
  if (checkpoint.scan_pages !== (previous?.scan_pages ?? 0) + 1
      || checkpoint.scan_errors !== (previous?.scan_errors ?? 0) + audit.identityErrors) fail('FEED_ROLLBACK_EVIDENCE_INVALID');
  const committedAt=Date.parse(checkpoint.last_attempt_at);
  if (!Number.isFinite(committedAt) || new Date(committedAt).toISOString()!==checkpoint.last_attempt_at
      || committedAt<Date.parse(receipt.observedAt)) fail('FEED_ROLLBACK_EVIDENCE_INVALID');
  const checkpointExpected={...(previous??emptyTask()),task_key:checkpointKey,platform:'all',cursor:checkpoint.cursor,
    scan_pages:(previous?.scan_pages??0)+1,scan_errors:(previous?.scan_errors??0)+audit.identityErrors,
    next_due_at:checkpoint.last_attempt_at,last_attempt_at:checkpoint.last_attempt_at,last_success_at:checkpoint.last_attempt_at,
    status:end===receipt.dataset.uniqueLots?'complete':'importing',last_error_code:state.queuedGroups?'FEED_CHANGE_RECONCILIATION_REQUIRED':null};
  const auditExpected={...emptyTask(),task_key:auditKey,platform:'all',cursor:auditRow.cursor,next_due_at:checkpoint.last_attempt_at,
    last_attempt_at:checkpoint.last_attempt_at,last_success_at:checkpoint.last_attempt_at,status:'complete'};
  if (!same(checkpoint,checkpointExpected) || !same(auditRow,auditExpected)) fail('FEED_ROLLBACK_NON_IMPORT_CHANGE');
  for (let index=0; index<receipt.groups.length; index++) {
    const group=receipt.groups[index], decision=audit.decisions[index];
    if (!object(decision) || identity(decision) !== identity(group) || decision.events !== group.events.length
        || decision.firstSequence !== group.events[0].sequence || decision.lastSequence !== group.events.at(-1).sequence
        || !same(decision.quarantinedSequences,group.quarantinedSequences)
        || !['updated','queued','identityError'].every(key => typeof decision[key] === 'boolean')
        || decision.identityError && (decision.updated || !decision.queued)) fail('FEED_ROLLBACK_EVIDENCE_INVALID');
  }
  if (audit.updatedGroups !== audit.decisions.filter(item=>item.updated).length
      || audit.queuedGroups !== audit.decisions.filter(item=>item.queued).length
      || audit.identityErrors !== audit.decisions.filter(item=>item.identityError).length) fail('FEED_ROLLBACK_EVIDENCE_INVALID');
  return {audit,committedAt};
}

function buildChangeRollback({receipt, before, after} = {}) {
  // The builder has no clock: receipt capture time is the validation bound.
  // Commit/lease time and execution authorization remain with the operator.
  let input;
  try {input=structuredClone({receipt,before,after});} catch {fail('FEED_ROLLBACK_INPUT_INVALID');}
  ({receipt,before,after}=input);
  const totals=validateReceipt(receipt,Date.parse(receipt?.observedAt));
  const groups=new Map(receipt.groups.map(group=>[identity(group),group]));
  const checkpointKey=`file-changes:${receipt.dataset.databaseSha256}`;
  const auditKey=`file-change-batch:${receipt.dataset.databaseSha256}:${receipt.offset}`;
  const taskKeys=new Set([...groups.keys()].map(key=>`reconcile:${key}`).concat(checkpointKey,auditKey));
  const old=snapshot(before,groups,taskKeys), expected=snapshot(after,groups,taskKeys);
  const {audit,committedAt}=validateFileEvidence(receipt,old,expected,checkpointKey,auditKey,totals);
  if (old.listings.size !== expected.listings.size) fail('FEED_ROLLBACK_IDENTITY_INVALID');
  const changes=[], expectedRows=[];
  for (const [id,row] of expected.listings) {
    const previous=old.listings.get(id);
    if (!previous || identity(previous)!==identity(row)) fail('FEED_ROLLBACK_IDENTITY_INVALID');
    if(Object.hasOwn(previous,'exterior_color')!==Object.hasOwn(row,'exterior_color')
       ||previous.exterior_color!==row.exterior_color)fail('FEED_ROLLBACK_NON_IMPORT_CHANGE');
    const columns=LISTING_COLUMNS.filter(key=>previous[key]!==row[key]);
    if (columns.some(key=>!MUTABLE_LISTING_COLUMNS.includes(key))) fail('FEED_ROLLBACK_NON_IMPORT_CHANGE');
    const decision=audit.decisions.find(item=>identity(item)===identity(row));
    if (Boolean(columns.length)!==decision.updated || columns.length && (row.identity_state!=='resolved'
        || !/^[A-HJ-NPR-Z0-9]{17}$/.test(row.vin_normalized || ''))) fail('FEED_ROLLBACK_IDENTITY_INVALID');
    if (columns.length) {
      const group=groups.get(identity(row));
      const plan=planInventoryChangeGroup({row:previous,events:group.events,quarantinedSequences:group.quarantinedSequences,observedAt:receipt.observedAt});
      if (plan.identityError || group.quarantinedSequences.length || group.events.some(event=>event.vehicle.vin!=null
          && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(event.vehicle.vin)) || !same({...previous,...plan.assignments},row)) fail('FEED_ROLLBACK_NON_IMPORT_CHANGE');
      changes.push(statement(`UPDATE auction_listings SET ${columns.map(key=>`${key}=?`).join(',')} WHERE listing_id=?`,
        ...columns.map(key=>previous[key]),id));
    }
    expectedRows.push({row,restore:columns.length?1:0});
  }
  for (const decision of audit.decisions) {
    const row=after.listings.find(item=>identity(item)===identity(decision));
    if (decision.updated && !row) fail('FEED_ROLLBACK_IDENTITY_INVALID');
    const key=`reconcile:${identity(decision)}`, previous=old.tasks.get(key), current=expected.tasks.get(key);
    if (previous && !current || decision.queued && !current || !decision.queued && !same(previous,current)) fail('FEED_ROLLBACK_EVIDENCE_INVALID');
    if (decision.queued) {
      const entry={task_key:key,platform:decision.platform,listing_id:row?.listing_id??null,cursor:decision.lot,
        next_due_at:new Date(committedAt+(decision.identityError?7*86400000:0)).toISOString(),last_attempt_at:receipt.observedAt,
        status:decision.identityError?'identity_error':'pending',failures:decision.identityError?1:0,
        last_error_code:decision.identityError?'INVENTORY_CHANGE_IDENTITY_CONFLICT':null};
      const sticky=previous?.status==='identity_error';
      const deferred=previous?.status==='pending' && previous.failures>0 && previous.next_due_at>entry.next_due_at;
      const taskExpected=previous?{...previous,listing_id:entry.listing_id,cursor:entry.cursor,last_attempt_at:entry.last_attempt_at,
        next_due_at:sticky||deferred?previous.next_due_at:entry.next_due_at,status:sticky?'identity_error':entry.status,
        failures:previous.failures+entry.failures,last_error_code:sticky||deferred?previous.last_error_code:entry.last_error_code}
        :{...emptyTask(),...entry};
      if (!same(current,taskExpected)) fail('FEED_ROLLBACK_NON_IMPORT_CHANGE');
    }
  }
  let restoredTasks=0,deletedTasks=0;
  const expectedTasks=[...taskKeys].sort().map(key=>({key,row:expected.tasks.get(key)??null}));
  for (const key of [...taskKeys].sort()) {
    const previous=old.tasks.get(key), current=expected.tasks.get(key);
    if (previous && !current) fail('FEED_ROLLBACK_EVIDENCE_INVALID');
    if (same(previous,current)) continue;
    if (previous) {
      changes.push(statement(`UPDATE automatic_refresh_tasks SET ${TASK_COLUMNS.filter(key=>'task_key'!==key).map(key=>`${key}=?`).join(',')} WHERE task_key=?`,
        ...TASK_COLUMNS.filter(key=>'task_key'!==key).map(key=>previous[key]),key)); restoredTasks++;
    } else {changes.push(statement('DELETE FROM automatic_refresh_tasks WHERE task_key=?',key)); deletedTasks++;}
  }
  const guardId='file-rollback:'+createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
  const groupCounts=receipt.groups.map(group=>({platform:group.platform,lot:group.lot,count:after.listings.filter(row=>identity(row)===identity(group)).length}));
  const columns=expectedRows.some(item=>Object.hasOwn(item.row,'exterior_color'))?[...LISTING_COLUMNS,'exterior_color']:LISTING_COLUMNS;
  const rowTuple=columns.map(key=>`l.${key}`).join(',');
  const expectedTuple=columns.map(key=>`json_extract(e.value,'$.row.${key}')`).join(',');
  const taskTuple=TASK_COLUMNS.map(key=>`t.${key}`).join(',');
  const taskExpected=TASK_COLUMNS.map(key=>`json_extract(e.value,'$.row.${key}')`).join(',');
  // NULL-safe row-value IS avoids D1's expression-depth ceiling of 100.
  const guard=statement(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
    NOT EXISTS(SELECT 1 FROM json_each(?) g WHERE (SELECT COUNT(*) FROM auction_listings l
      WHERE l.platform IS json_extract(g.value,'$.platform') AND l.lot IS json_extract(g.value,'$.lot'))<>json_extract(g.value,'$.count'))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM auction_listings l
      WHERE (${rowTuple}) IS (${expectedTuple}) AND (json_extract(e.value,'$.restore')=0 OR EXISTS(
        SELECT 1 FROM vehicle_sources s WHERE s.source_key=l.source_key AND (s.provider,s.platform,s.identity_state) IS ('apibara',l.platform,'resolved')))))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE
      (json_extract(e.value,'$.row') IS NULL AND EXISTS(SELECT 1 FROM automatic_refresh_tasks t WHERE t.task_key=json_extract(e.value,'$.key')))
      OR (json_extract(e.value,'$.row') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks t
        WHERE (${taskTuple}) IS (${taskExpected})))) THEN 1 ELSE 0 END)`,
    guardId,JSON.stringify(groupCounts),JSON.stringify(expectedRows),JSON.stringify(expectedTasks));
  const statements=[guard,...changes,statement('DELETE FROM sync_batch_guards WHERE guard_id=?',guardId)];
  if (statements.length>204) fail('FEED_ROLLBACK_BATCH_TOO_LARGE');
  return {statements,restoredListings:expectedRows.filter(item=>item.restore).length,restoredTasks,deletedTasks};
}

module.exports={buildChangeRollback,LISTING_COLUMNS,TASK_COLUMNS,MUTABLE_LISTING_COLUMNS};
