'use strict';

// One bounded API page repairs only the FILE cursor. The content-addressed raw
// response and pending pointer precede catalogue writes, so a partial retry
// cannot replace its page with a different, overlapping provider response.
const {createHash, randomUUID} = require('node:crypto');
const {parseChangesResponse, createApibaraProvider} = require('../providers/apibara.js');
const {applyFeedRecordHydration} = require('./feed-record-hydration.cjs');
const {POLICY} = require('./automatic-refresh.cjs');
const {importChangeBatch, hashReceipt, changeKeys, validateReceipt} = require('./feed-change-import.cjs');
const {FeedBootstrapMembership}=require('./feed-bootstrap-membership.cjs');
const {createBootstrapDeltaExtension}=require('./feed-bootstrap-delta.cjs');
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024, PAGE_LIMIT = 500, MAX_NEW_HYDRATION_GROUPS = 80;
const REQUEST_LIMITS = [PAGE_LIMIT, 100, 25];
// Generated gap keys are lowercase; GLOB bounds their existing BINARY primary-key index.
const PREFIX = 'server-feed-gap:', iso = n => new Date(n).toISOString();
const gapPrefix=baselineId=>baselineId?`server-feed-gap-epoch:${createHash('sha256').update(baselineId).digest('hex')}:`:PREFIX;
const digest = value => createHash('sha256').update(value).digest('hex');
const hash = value => digest(JSON.stringify(value));
const integer = n => Number.isSafeInteger(n) && n >= 0;
const hex = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const fullVin = s => typeof s === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/i.test(s);
const fail = code => {throw Error(code);};
function timestamp(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || iso(Date.parse(value)) !== value || Date.parse(value) > now) fail('FEED_GAP_TIME_INVALID');
}
function rawKey(sha256) {return `server-feed/gaps/${sha256}.json`;}
async function readRaw(bucket, sha256) {
  const object = await bucket.get(rawKey(sha256));
  if (!object?.body?.getReader) fail('FEED_GAP_ARCHIVE_MISSING');
  if (integer(object.size) && object.size > MAX_RESPONSE_BYTES) {
    await object.body.cancel().catch(() => {}); fail('FEED_GAP_RESPONSE_TOO_LARGE');
  }
  const reader = object.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      if (!(value instanceof Uint8Array)) fail('FEED_GAP_ARCHIVE_INVALID');
      total += value.byteLength; if (total > MAX_RESPONSE_BYTES) fail('FEED_GAP_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
  const bytes = Buffer.concat(chunks, total);
  if (digest(bytes) !== sha256) fail('FEED_GAP_ARCHIVE_HASH_MISMATCH');
  try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));}
  catch {fail('FEED_GAP_ARCHIVE_INVALID');}
}
function pagePlan(response, {after, targetFirstSequence, observedAt, requestLimit = PAGE_LIMIT,
  requiredLatestSequence = targetFirstSequence, allowNoProgress = false}, now) {
  timestamp(observedAt, now);
  // Match the file import quarantine contract: only malformed VIN is exempted
  // from envelope parsing, and the original raw event is retained unchanged.
  const candidate = Array.isArray(response?.data) ? {...response, data: response.data.map(event =>
    event?.vehicle && event.vehicle.vin != null && !fullVin(event.vehicle.vin)
      ? {...event, vehicle: {...event.vehicle, vin: null}} : event)} : response;
  const parsed = parseChangesResponse(candidate, {after, limit: requestLimit});
  // A retained lower bound beyond after+1 cannot prove the missing prefix.
  if (parsed.oldestAvailableSequence !== null && parsed.oldestAvailableSequence > after + 1) fail('FEED_GAP_RETENTION_GAP');
  if (!parsed.hasMore && (parsed.latestAvailableSequence === null || parsed.latestAvailableSequence < requiredLatestSequence)) {
    fail('FEED_GAP_TARGET_UNAVAILABLE');
  }
  const through = Math.min(parsed.nextCursor, targetFirstSequence - 1);
  if (through < after || through === after && !allowNoProgress) fail('FEED_GAP_NO_PROGRESS');
  const events = response.data.filter(event => event.sequence < targetFirstSequence), groupsByIdentity = new Map();
  for (const event of events) {
    if (!/^\d{1,20}$/.test(event.vehicle.lot_number)) fail('FEED_GAP_IDENTITY_INVALID');
    const key = `${event.vehicle.platform}:${event.vehicle.lot_number}`;
    let group = groupsByIdentity.get(key);
    if (!group) {group = {platform: event.vehicle.platform, lot: event.vehicle.lot_number, events: [], quarantinedSequences: []}; groupsByIdentity.set(key, group);}
    group.events.push(event);
    if (event.vehicle.vin != null && !fullVin(event.vehicle.vin)) group.quarantinedSequences.push(event.sequence);
  }
  const groups = [...groupsByIdentity.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) => group);
  return {through, events, groups, parsed};
}
function receiptsFor(plan, pointer, now) {
  if (!plan.events.length) return [];
  const sources = [{generationId: pointer.after + 1, sha256: pointer.responseSha256, records: plan.events.length,
    firstSequence: plan.events[0].sequence, lastSequence: plan.events.at(-1).sequence}];
  const dataset = {identity: hash({version: 1, sources}),
    databaseSha256: hash({version: 1, kind: 'server-feed-gap', responseSha256: pointer.responseSha256,
      after: pointer.after, through: pointer.through, targetFirstSequence: pointer.targetFirstSequence,
      ...(pointer.baselineId?{baselineId:pointer.baselineId}:{})}), sources,
    records: plan.events.length, quarantined: plan.groups.reduce((n, g) => n + g.quarantinedSequences.length, 0),
    firstSequence: sources[0].firstSequence, lastSequence: sources[0].lastSequence, uniqueLots: plan.groups.length};
  const receipts = []; let eventOffset = 0, quarantineOffset = 0;
  for (let offset = 0; offset < plan.groups.length; offset += 100) {
    const groups = plan.groups.slice(offset, offset + 100);
    const receipt = {version: 1, dataset, observedAt: pointer.observedAt, offset, eventOffset, quarantineOffset, groups};
    receipt.batchSha256 = hashReceipt(receipt); validateReceipt(receipt, now); receipts.push(receipt);
    eventOffset += groups.reduce((n, group) => n + group.events.length, 0);
    quarantineOffset += groups.reduce((n, group) => n + group.quarantinedSequences.length, 0);
  }
  return receipts;
}
function guard(db, pointer, cursor, id) {
  const prefix=gapPrefix(pointer.baselineId),taskKey = `${prefix}${pointer.after}`;
  return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM server_feed_state WHERE singleton=1 AND committed_sequence=? AND active_generation IS NULL)
    AND (? IS NULL AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)
      OR EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND (platform,status,cursor,listing_id) IS ('all','pending',?,NULL)))
    AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key GLOB '${prefix}*' AND status='pending' AND task_key<>?)
    THEN 1 ELSE 0 END)`).bind(id, pointer.after, cursor, taskKey, taskKey, cursor, taskKey);
}
function cleanup(db, id) {return db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id);}
function validatePointer(task, state, targetFirstSequence, now,baselineId=null) {
  let pointer; try {pointer = JSON.parse(task.cursor);} catch {fail('FEED_GAP_POINTER_INVALID');}
  const fields = ['version', 'after', 'through', 'targetFirstSequence', 'responseSha256', 'rawKey', 'observedAt'];
  // Old immutable pointers predate the bounded fallback and always used500.
  // Do not add the default to their object: hydration hashes bind the original.
  if (pointer && Object.hasOwn(pointer, 'requestLimit')) fields.push('requestLimit');
  if(baselineId)fields.push('baselineId');
  if (!pointer || Object.keys(pointer).length !== fields.length || fields.some(key => !Object.hasOwn(pointer, key))
      || Object.hasOwn(pointer, 'requestLimit') && !REQUEST_LIMITS.includes(pointer.requestLimit)
      || pointer.version !== 1 || !integer(pointer.after) || !integer(pointer.through) || pointer.through <= pointer.after
      || !integer(pointer.targetFirstSequence) || pointer.through >= pointer.targetFirstSequence
      || !hex(pointer.responseSha256) || pointer.rawKey !== rawKey(pointer.responseSha256)
      || (pointer.baselineId??null)!==baselineId
      || task.task_key !== `${gapPrefix(baselineId)}${pointer.after}` || task.platform !== 'all' || task.listing_id !== null
      || task.status !== 'pending') fail('FEED_GAP_POINTER_INVALID');
  timestamp(pointer.observedAt, now);
  if (pointer.after !== state.committed_sequence || pointer.targetFirstSequence !== targetFirstSequence) fail('FEED_GAP_POINTER_CONFLICT');
  return pointer;
}

async function repairFeedGap({db, store, request, bucket, now = store?.now?.bind(store), targetFirstSequence,
  maxPages = 1, maxChangesLimit = PAGE_LIMIT,baselineId=null} = {}) {
  if (!db?.prepare || !db?.batch || store?.db !== db || !store.owner || typeof store.guarded !== 'function'
      || typeof store.now !== 'function' || typeof now !== 'function' || !Number.isFinite(now())
      || typeof request !== 'function' || !bucket?.get || !bucket?.put || maxPages !== 1 || !REQUEST_LIMITS.includes(maxChangesLimit)
      || !integer(targetFirstSequence) || targetFirstSequence < 1
      || baselineId!==null&&(typeof baselineId!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(baselineId))) fail('FEED_GAP_CONFIG_INVALID');
  const state = await db.prepare('SELECT * FROM server_feed_state WHERE singleton=1').bind().first();
  if (!state || !integer(state.committed_sequence) || state.active_generation !== null) fail('FEED_GAP_STATE_INVALID');
  const prefix=gapPrefix(baselineId),membership=baselineId?new FeedBootstrapMembership({db,store}):null;
  if(membership){const current=await membership.read(baselineId);if(current.state.replaySequence!==state.committed_sequence
    ||current.state.offset!==current.plan.snapshot.records)fail('FEED_GAP_MEMBERSHIP_CONFLICT');}
  const pending = (await db.prepare(`SELECT * FROM automatic_refresh_tasks WHERE task_key GLOB '${prefix}*' AND status='pending' LIMIT 2`).bind().all()).results;
  if (!Array.isArray(pending) || pending.length > 1) fail('FEED_GAP_POINTER_INVALID');
  if (!pending.length && targetFirstSequence === state.committed_sequence + 1) {
    return {repaired: false, complete: true, after: state.committed_sequence, through: state.committed_sequence, globalCursorEstablished: false};
  }
  if (targetFirstSequence <= state.committed_sequence + 1 && !pending.length) fail('FEED_GAP_TARGET_INVALID');
  let pointer, response, plan, pointerCursor, receipts; const resumed = pending.length === 1;
  if (resumed) {
    pointer = validatePointer(pending[0], state, targetFirstSequence, now(),baselineId); pointerCursor = pending[0].cursor;
    response = await readRaw(bucket, pointer.responseSha256); plan = pagePlan(response, pointer, now());
    if (plan.through !== pointer.through) fail('FEED_GAP_POINTER_CONFLICT');
    receipts = receiptsFor(plan, pointer, now());
  } else {
    // The runner selects a smaller limit only from repeated HTTP500 evidence at
    // this unchanged cursor. No internal transport retry or cursor jump occurs.
    const obtained = await request({operation: 'vehicleChanges', after: state.committed_sequence, limit: maxChangesLimit});
    timestamp(obtained?.observedAt, now());
    let encoded; try {encoded = JSON.stringify(obtained.response);} catch {fail('FEED_GAP_RESPONSE_INVALID');}
    if (typeof encoded !== 'string') fail('FEED_GAP_RESPONSE_INVALID');
    const bytes = Buffer.from(encoded);
    if (bytes.length > MAX_RESPONSE_BYTES) fail('FEED_GAP_RESPONSE_TOO_LARGE');
    response = JSON.parse(encoded);
    plan = pagePlan(response, {after: state.committed_sequence, targetFirstSequence, observedAt: obtained.observedAt,
      requestLimit: maxChangesLimit}, now());
    pointer = {version: 1, after: state.committed_sequence, through: plan.through, targetFirstSequence,
      responseSha256: digest(bytes), rawKey: rawKey(digest(bytes)), observedAt: obtained.observedAt, requestLimit: maxChangesLimit,
      ...(baselineId?{baselineId}:{})};
    receipts = receiptsFor(plan, pointer, now());
    await bucket.put(pointer.rawKey, bytes, {onlyIf: {etagDoesNotMatch: '*'},
      httpMetadata: {contentType: 'application/json'}, customMetadata: {sha256: pointer.responseSha256}});
    await readRaw(bucket, pointer.responseSha256);
    pointerCursor = JSON.stringify(pointer);
    const id = randomUUID(), at = iso(now());
    await store.guarded([guard(db, pointer, null, id),
      db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,status)
        VALUES(?,'all',?,?,?,'pending')`).bind(`${prefix}${pointer.after}`, pointerCursor, at, at), cleanup(db, id)]);
  }
  // Also fence each partial import, not just the final cursor update. A changed
  // cursor or generation must prevent any further catalogue mutation.
  const fencedStore = {db, owner: store.owner, now: store.now.bind(store), async guarded(statements) {
    const id = randomUUID(); return store.guarded([guard(db, pointer, pointerCursor, id), ...statements, cleanup(db, id)]);
  }};
  const saved = [], blockedIdentities = []; let lastResult, newHydrationGroups = 0;
  const hydrationGroups = plan.groups.filter(group => group.events.some(event => event.record != null));
  const hydrationHash = hash({version: 1, kind: 'server-feed-gap-hydration', pointer});
  const provider = createApibaraProvider();
  const markerKeys = Array.from({length: Math.ceil(hydrationGroups.length / 20)}, (_, index) => `file-hydration:${hydrationHash}:0:${index * 20}`);
  const priorMarkers = markerKeys.length ? (await db.prepare('SELECT task_key FROM automatic_refresh_tasks WHERE task_key IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(markerKeys)).all()).results : [];
  if (!Array.isArray(priorMarkers)) fail('FEED_GAP_RECEIPT_UNVERIFIED');
  const presentMarkers = new Set(priorMarkers.map(row => row.task_key));
  // Replay the immutable page rather than refetching. One invocation admits at
  // most 80 new groups in unchanged 20-group transactions; markers retain proof.
  for (let offset = 0; offset < hydrationGroups.length; offset += 20) {
    const groups = hydrationGroups.slice(offset, offset + 20), taskKey = `file-hydration:${hydrationHash}:0:${offset}`;
    if (!presentMarkers.has(taskKey) && newHydrationGroups + groups.length > MAX_NEW_HYDRATION_GROUPS) {
      return {repaired: false, complete: false, hydrating: true, phase: 'hydrate', resumed, after: pointer.after, through: pointer.after,
        groups: plan.groups.length, hydratedGroups: newHydrationGroups, hydrationGroupsCompleted: offset,
        newHydrationGroups, appliedGroups: 0, globalCursorEstablished: false};
    }
    const hydrated = await applyFeedRecordHydration({db, store: fencedStore, provider, groups,
      observedAt: pointer.observedAt, receiptKey: taskKey, freshnessPolicy: POLICY});
    if (!hydrated.alreadyApplied) newHydrationGroups += groups.length;
    blockedIdentities.push(...hydrated.quarantined.map(item => `${item.platform}:${item.lot}`));
    const row = await db.prepare('SELECT task_key,platform,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(taskKey).first();
    let marker; try {marker = JSON.parse(row?.cursor);} catch {fail('FEED_GAP_RECEIPT_UNVERIFIED');}
    if (!row || row.platform !== 'all' || row.status !== 'complete' || marker.inputHash !== hydrated.inputHash) fail('FEED_GAP_RECEIPT_UNVERIFIED');
    saved.push(row);
  }
  // Leave room for runner/settlement within its 970-SQL guard. Four new
  // hydration transactions admit at most three new partial transactions; up to
  // two hydration transactions still fit the original five partial batches.
  const partialLimit = newHydrationGroups > 40 ? 3 : 5; let newPartialBatches = 0;
  const checkpointExtension=membership?createBootstrapDeltaExtension({membership:new FeedBootstrapMembership({db,store:fencedStore}),
    baselineId,after:pointer.after,through:pointer.through}):null;
  for (const receipt of receipts) {
    if (newPartialBatches >= partialLimit && receipt.offset >= (lastResult?.state.offset ?? 0)) {
      return {repaired: false, complete: false, applying: true, phase: 'apply', resumed, after: pointer.after, through: pointer.after,
        groups: plan.groups.length, hydrationGroupsCompleted: hydrationGroups.length, newHydrationGroups,
        appliedGroups: lastResult?.state.offset ?? 0, globalCursorEstablished: false};
    }
    const blocked = blockedIdentities.filter(key => receipt.groups.some(group => key === `${group.platform}:${group.lot}`));
    lastResult = await importChangeBatch({db, store: fencedStore, receipt, namespace: 'server', blockedIdentities: blocked,checkpointExtension});
    if (!lastResult.alreadyApplied) newPartialBatches++;
    const taskKey = changeKeys(receipt.dataset.databaseSha256, 'server').batchKey(receipt.offset);
    const row = await db.prepare('SELECT task_key,platform,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(taskKey).first();
    if (!row || row.platform !== 'all' || row.status !== 'complete' || row.cursor !== JSON.stringify(lastResult.audit)) fail('FEED_GAP_RECEIPT_UNVERIFIED');
    saved.push(row);
  }
  if (receipts.length) {
    const taskKey = changeKeys(receipts[0].dataset.databaseSha256, 'server').key;
    const row = await db.prepare('SELECT task_key,platform,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(taskKey).first();
    if (!row || row.platform !== 'all' || row.status !== 'complete' || row.cursor !== JSON.stringify(lastResult.state)) fail('FEED_GAP_RECEIPT_UNVERIFIED');
    saved.push(row);
  }
  const proof = {version: 1, after: pointer.after, through: pointer.through, targetFirstSequence,
    ...(baselineId?{baselineId}:{}),
    requestLimit: pointer.requestLimit ?? PAGE_LIMIT,
    responseSha256: pointer.responseSha256, rawKey: pointer.rawKey, observedAt: pointer.observedAt,
    providerNextCursor: plan.parsed.nextCursor, providerLatestSequence: plan.parsed.latestAvailableSequence,
    providerHasMore: plan.parsed.hasMore, receivedEvents: response.data.length, appliedEvents: plan.events.length,
    groups: plan.groups.length, quarantined: plan.groups.reduce((n, g) => n + g.quarantinedSequences.length, 0),
    batchReceipts: saved.map(row => ({taskKey: row.task_key, cursorSha256: digest(row.cursor)})), globalCursorEstablished: false};
  const id = randomUUID(), evidenceId = randomUUID(), at = iso(now());
  const membershipStatements=membership?(await membership.deltaStatements({baselineId,after:pointer.after,through:pointer.through,
    batchSha256:hash(proof),changes:[],unresolvedCount:0})).statements:[];
  await store.guarded([guard(db, pointer, pointerCursor, id),
    db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN NOT EXISTS(
      SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks t
        WHERE (t.task_key,t.platform,t.status,t.cursor) IS (json_extract(r.value,'$.task_key'),'all','complete',json_extract(r.value,'$.cursor'))))
      THEN 1 ELSE 0 END)`).bind(evidenceId, JSON.stringify(saved)),
    ...membershipStatements,
    db.prepare('UPDATE server_feed_state SET committed_sequence=?,updated_at=? WHERE singleton=1').bind(pointer.through, at),
    db.prepare("UPDATE automatic_refresh_tasks SET status='complete',cursor=?,last_success_at=?,next_due_at=? WHERE task_key=?")
      .bind(JSON.stringify({...pointer, completedAt: at, proof}), at, at, `${prefix}${pointer.after}`),
    cleanup(db, evidenceId), cleanup(db, id)]);
  return {repaired: true, complete: pointer.through === targetFirstSequence - 1, phase: 'complete', resumed, after: pointer.after,
    hydrationGroupsCompleted: hydrationGroups.length, newHydrationGroups, appliedGroups: plan.groups.length,
    through: pointer.through, responseSha256: pointer.responseSha256, events: plan.events.length,
    groups: plan.groups.length, batches: receipts.length, proof, globalCursorEstablished: false};
}

// Shared pure/bounded primitives also serve the isolated fresh-bootstrap replay.
// That coordinator owns a separate cursor and never uses this module's guard.
module.exports = {repairFeedGap, MAX_RESPONSE_BYTES, PAGE_LIMIT, pagePlan, receiptsFor, readRaw, rawKey};
