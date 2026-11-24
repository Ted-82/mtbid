'use strict';

// Operator-side coordinator only: the caller opens the isolated/budgeted D1
// connection and owns its lease. No provider requests, schedules or delta cursor
// writes occur here. Canonical rows and page receipts use the existing importer.
const {createHash} = require('node:crypto');
const {readSnapshotPages} = require('../scripts/feed-snapshot-pages.cjs');
const {LIMITS} = require('../scripts/apibara-feed.cjs');
const {importSnapshotBatch, validateSnapshotMetadata, hash} = require('./feed-snapshot-import.cjs');
const {BOUND_BASIS,canonicalCaptureTime} = require('./feed-bootstrap-capture-time.cjs');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = code => {throw Object.assign(Error(code), {code});};
const check = (value, code) => {if (!value) fail(code);};
const clone = value => {try {return structuredClone(value);} catch {fail('FEED_BOOTSTRAP_PLAN_INVALID');}};
function targetOf(value) {
  check(value && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.id)
    && typeof value.name === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.name), 'FEED_BOOTSTRAP_TARGET_INVALID');
  return {id: value.id, name: value.name};
}
function createBootstrapPlan({target, manifest, generationId, observedAt, observationTimeBasis = 'source_updated_at', batchSize = 60,
  sourceEvidence, now = Date.now()} = {}) {
  target = targetOf(target); manifest = clone(manifest);
  validateSnapshotMetadata({fileSha256: manifest?.sha256, generationId, observedAt, observationTimeBasis, batchSize,
    totalRecords: manifest?.records}, now);
  check(manifest.mode === 'snapshot' && manifest.file === `${manifest.sha256}/vehicles.jsonl.gz`
    && integer(manifest.compressedBytes) && manifest.compressedBytes > 0 && manifest.compressedBytes <= LIMITS.compressed
    && integer(manifest.expandedBytes) && manifest.expandedBytes > 0 && manifest.expandedBytes <= LIMITS.expanded,
  'FEED_BOOTSTRAP_MANIFEST_INVALID');
  const pinned = Object.fromEntries(['mode','file','sha256','records','compressedBytes','expandedBytes',
    'sourceUpdatedCount','sourceUpdatedMin','sourceUpdatedMax'].filter(key => Object.hasOwn(manifest, key)).map(key => [key, manifest[key]]));
  if (observationTimeBasis === 'source_updated_at') check(pinned.sourceUpdatedCount === pinned.records
    && pinned.sourceUpdatedMax === observedAt, 'FEED_BOOTSTRAP_SOURCE_TIME_INVALID');
  const evidence = clone(sourceEvidence);
  const canonicalTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value && Date.parse(value) <= now;
  check(evidence?.verified === true && evidence.fileSha256 === pinned.sha256 && evidence.generationId === generationId
    && typeof evidence.feedId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(evidence.feedId)
    && integer(evidence.deltaStartN) && hex(evidence.evidenceSha256) && hex(evidence.checkpointResponseSha256)
    && Array.isArray(evidence.platforms) && evidence.platforms.length === 2 && evidence.platforms.includes('copart') && evidence.platforms.includes('iaai')
    && typeof evidence.generatedAtKnown === 'boolean'
    && (evidence.generatedAtKnown ? canonicalTime(evidence.generatedAt) && Date.parse(evidence.snapshotRequestedAt) <= Date.parse(evidence.generatedAt) : evidence.generatedAt === null)
    && canonicalTime(evidence.snapshotRequestedAt), 'FEED_BOOTSTRAP_SOURCE_EVIDENCE_INVALID');
  const bound=evidence.deltaStartTimeBasis===BOUND_BASIS;
  check(evidence.deltaStartTimeBasis===undefined||bound,'FEED_BOOTSTRAP_SOURCE_EVIDENCE_INVALID');
  try{canonicalCaptureTime({capture:{sequence:evidence.deltaStartN,capturedAt:evidence.deltaStartCapturedAt,
    responseSha256:evidence.checkpointResponseSha256,...(bound?{timeBasis:evidence.deltaStartTimeBasis,capturedNoLaterThan:evidence.deltaStartCapturedNoLaterThan}
      :evidence.deltaStartCapturedNoLaterThan!==undefined?{capturedNoLaterThan:evidence.deltaStartCapturedNoLaterThan}:{})},
    snapshot:{sha256:evidence.fileSha256,requestStartedAt:evidence.snapshotRequestedAt,generatedAtKnown:evidence.generatedAtKnown,generatedAt:evidence.generatedAt},
    sourceEvidence:{kind:evidence.checkpointKind,sha256:evidence.evidenceSha256,replayStartSequence:evidence.checkpointReplayStartSequence,snapshotSha256:evidence.checkpointSnapshotSha256}});}
  catch{fail('FEED_BOOTSTRAP_SOURCE_EVIDENCE_INVALID');}
  if(!bound)check(canonicalTime(evidence.deltaStartCapturedAt),'FEED_BOOTSTRAP_SOURCE_EVIDENCE_INVALID');
  sourceEvidence = Object.fromEntries(['verified','fileSha256','generationId','feedId','deltaStartN',
    'deltaStartCapturedAt','checkpointResponseSha256','snapshotRequestedAt','generatedAtKnown','generatedAt','platforms','evidenceSha256'].map(key => [key, evidence[key]]));
  sourceEvidence.platforms = ['copart', 'iaai'];
  if(bound)Object.assign(sourceEvidence,Object.fromEntries(['deltaStartTimeBasis','deltaStartCapturedNoLaterThan','checkpointKind','checkpointReplayStartSequence','checkpointSnapshotSha256'].map(key=>[key,evidence[key]])));
  const body = {version: 1, kind: 'feed-bootstrap-plan', target, manifest: pinned, generationId, observedAt,
    observationTimeBasis, batchSize, sourceEvidence};
  return {...body, sha256: hash(body)};
}
function checkedPlan(input, now) {
  const plan = clone(input), {sha256, ...body} = plan || {};
  check(hex(sha256) && hash(body) === sha256, 'FEED_BOOTSTRAP_PLAN_HASH');
  const expected = createBootstrapPlan({...body, now});
  check(hash(expected) === hash(plan), 'FEED_BOOTSTRAP_PLAN_INVALID'); return plan;
}
function stateOf(task, plan) {
  if (!task) return null;
  let state; try {state = JSON.parse(task.cursor);} catch {fail('FEED_BOOTSTRAP_CHECKPOINT_INVALID');}
  check(task.platform === 'all' && state && state.version === 1 && state.fileSha256 === plan.manifest.sha256
    && state.generationId === plan.generationId && state.observedAt === plan.observedAt
    && (state.observationTimeBasis ?? 'capture') === plan.observationTimeBasis && (state.batchSize ?? 20) === plan.batchSize
    && state.totalRecords === plan.manifest.records && ['offset','inserted','updated','rejected','skipped'].every(key => integer(state[key]))
    && state.offset <= state.totalRecords && state.offset === state.inserted + state.updated + state.rejected + state.skipped
    && (state.offset === state.totalRecords || state.offset % plan.batchSize === 0)
    && task.status === (state.offset === state.totalRecords ? 'complete' : 'importing'), 'FEED_BOOTSTRAP_CHECKPOINT_INVALID');
  return state;
}
async function readback(db, result, receipt, fileKey) {
  const saved = await db.prepare(`SELECT
    (SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?) checkpoint,
    (SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?) audit,
    (SELECT json_group_array(json_object('listingId',l.listing_id,'sourceKey',l.source_key,
      'observedAt',l.summary_synced_at,'currentBid',l.current_bid_usd,'buyNow',l.buy_now_usd,
      'snapshotOk',EXISTS(SELECT 1 FROM auction_listing_snapshots s WHERE s.listing_id=l.listing_id
        AND s.fingerprint=json_extract(e.value,'$.fingerprint'))))
      FROM json_each(?) e JOIN auction_listings l ON l.listing_id=json_extract(e.value,'$.listingId')) actual`)
    .bind(fileKey, `file-batch:${receipt.fileSha256}:${receipt.offset}`, JSON.stringify(result.committed?.expected ?? [])).first();
  let checkpoint, audit, actual;
  try {checkpoint = JSON.parse(saved?.checkpoint); audit = JSON.parse(saved?.audit); actual = JSON.parse(saved?.actual);} catch {fail('FEED_BOOTSTRAP_READBACK_FAILED');}
  check(hash(checkpoint) === hash(result.state) && hash(audit) === hash(result.audit), 'FEED_BOOTSTRAP_READBACK_FAILED');
  const expected = result.committed?.expected ?? [];
  check(Array.isArray(actual) && actual.length === expected.length, 'FEED_BOOTSTRAP_READBACK_FAILED');
  for (const entry of expected) {
    const item = actual.find(row => row.listingId === entry.listingId);
    check(item && ['listingId','sourceKey','observedAt','currentBid','buyNow'].every(key => item[key] === entry[key])
      && item.snapshotOk === 1, 'FEED_BOOTSTRAP_READBACK_FAILED');
  }
}
async function rejectionSummary(db, fileSha256, state, signal) {
  if (!state.rejected) return {count: 0, reasonCounts: {}, sha256: createHash('sha256').digest('hex'), complete: true};
  if (state.offset !== state.totalRecords) return {count: state.rejected, reasonCounts: null, sha256: null, complete: false};
  const prefix = `file-batch:${fileSha256}:`, digest = createHash('sha256'), reasonCounts = {};
  let lastKey = '', lastOrdinal = -1, count = 0;
  for (;;) {
    if (signal?.aborted) fail('FEED_BOOTSTRAP_ABORTED');
    const response = await db.prepare(`SELECT t.task_key auditKey, CAST(j.key AS INTEGER) ordinal,
      json_extract(j.value,'$.platform') platform,json_extract(j.value,'$.lot') lot,json_extract(j.value,'$.code') code
      FROM automatic_refresh_tasks t,json_each(json_extract(t.cursor,'$.rejected')) j
      WHERE t.task_key>=? AND t.task_key<? AND (t.task_key>? OR (t.task_key=? AND CAST(j.key AS INTEGER)>?))
      ORDER BY t.task_key,CAST(j.key AS INTEGER) LIMIT 256`)
      .bind(prefix, prefix+'\uffff', lastKey, lastKey, lastOrdinal).all();
    check(Array.isArray(response?.results), 'FEED_BOOTSTRAP_AUDIT_INVALID');
    for (const row of response.results) {
      check(typeof row.auditKey === 'string' && row.auditKey.startsWith(prefix) && integer(row.ordinal)
        && ['copart','iaai'].includes(row.platform) && /^\d{1,20}$/.test(row.lot || '')
        && /^[A-Z][A-Z0-9_]{0,100}$/.test(row.code || ''), 'FEED_BOOTSTRAP_AUDIT_INVALID');
      check(++count <= state.rejected, 'FEED_BOOTSTRAP_AUDIT_INVALID');
      digest.update(JSON.stringify([row.auditKey,row.ordinal,row.platform,row.lot,row.code])+'\n');
      reasonCounts[row.code] = (reasonCounts[row.code] || 0) + 1;lastKey = row.auditKey;lastOrdinal = row.ordinal;
    }
    if (response.results.length < 256) break;
  }
  check(count === state.rejected, 'FEED_BOOTSTRAP_AUDIT_INVALID');
  return {count, reasonCounts, sha256: digest.digest('hex'), complete: true};
}
// The adapter returns SQL for the importer's existing atomic checkpoint seam.
// It does not begin/seal/switch a baseline or execute membership writes itself.
async function createBootstrapMembershipCheckpoint({membership, baselineId, plan: input, exclusionAuditCutoverOffset = null} = {}) {
  check(membership?.db && typeof membership.read === 'function' && typeof membership.snapshotStatements === 'function'
    && typeof membership.store?.now === 'function', 'FEED_BOOTSTRAP_MEMBERSHIP_INVALID');
  const plan = checkedPlan(input, membership.store.now());
  check(membership.db.metadataVerified === true && membership.db.identity?.id === plan.target.id
    && membership.db.identity?.name === plan.target.name, 'FEED_BOOTSTRAP_TARGET_MISMATCH');
  const verifyBaseline = current => {
    const baseline = current?.plan;
    check(baseline?.baselineId === baselineId && baseline.snapshot?.sha256 === plan.manifest.sha256
      && baseline.snapshot?.generationId === plan.generationId && baseline.snapshot?.records === plan.manifest.records
      && baseline.snapshot?.observedAt === plan.observedAt
      && baseline.capture?.sequence === plan.sourceEvidence.deltaStartN
      && baseline.capture?.capturedAt === plan.sourceEvidence.deltaStartCapturedAt
      && baseline.capture?.timeBasis === plan.sourceEvidence.deltaStartTimeBasis
      && baseline.capture?.capturedNoLaterThan === plan.sourceEvidence.deltaStartCapturedNoLaterThan
      && (plan.sourceEvidence.deltaStartTimeBasis===undefined||baseline.sourceEvidence?.kind===plan.sourceEvidence.checkpointKind
        &&baseline.sourceEvidence?.sha256===plan.sourceEvidence.evidenceSha256
        &&baseline.sourceEvidence?.replayStartSequence===plan.sourceEvidence.checkpointReplayStartSequence
        &&baseline.sourceEvidence?.snapshotSha256===plan.sourceEvidence.checkpointSnapshotSha256)
      && baseline.capture?.responseSha256 === plan.sourceEvidence.checkpointResponseSha256
      && baseline.snapshot?.generatedAtKnown === plan.sourceEvidence.generatedAtKnown
      && baseline.snapshot?.generatedAt === plan.sourceEvidence.generatedAt
      && baseline.snapshot?.requestStartedAt === plan.sourceEvidence.snapshotRequestedAt, 'FEED_BOOTSTRAP_MEMBERSHIP_CONFLICT');
    return current;
  };
  const initial=verifyBaseline(await membership.read(baselineId)),membershipPlanSha256=hash(initial.plan);
  const exclusionKey=offset=>`bootstrap-membership-exclusions:${plan.manifest.sha256}:${offset}`;
  const transitionKey=`bootstrap-membership-exclusions-transition:${plan.manifest.sha256}`;
  const transitionTask=await membership.db.prepare('SELECT platform,listing_id,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(transitionKey).first();
  let transitionBody,transitionPersisted=Boolean(transitionTask);
  if(transitionTask){
    let saved;try{saved=JSON.parse(transitionTask.cursor);}catch{fail('FEED_BOOTSTRAP_MEMBERSHIP_EXCLUSION_TRANSITION_INVALID');}
    const {sha256,...body}=saved||{};
    check(transitionTask.platform==='all'&&transitionTask.listing_id===null&&transitionTask.status==='complete'&&hex(sha256)&&hash(body)===sha256, 'FEED_BOOTSTRAP_MEMBERSHIP_EXCLUSION_TRANSITION_INVALID');
    transitionBody=body;
  }else transitionBody={version:1,kind:'bootstrap-membership-exclusions-transition',baselineId,bootstrapPlanSha256:plan.sha256,membershipPlanSha256,
    sourceEvidenceSha256:plan.sourceEvidence.evidenceSha256,snapshotSha256:plan.manifest.sha256,generationId:plan.generationId,
    cutoverOffset:exclusionAuditCutoverOffset??initial.state.offset};
  const cutover=transitionBody.cutoverOffset;
  check(transitionBody.version===1&&transitionBody.kind==='bootstrap-membership-exclusions-transition'&&transitionBody.baselineId===baselineId
    &&transitionBody.bootstrapPlanSha256===plan.sha256&&transitionBody.membershipPlanSha256===membershipPlanSha256
    &&transitionBody.sourceEvidenceSha256===plan.sourceEvidence.evidenceSha256&&transitionBody.snapshotSha256===plan.manifest.sha256&&transitionBody.generationId===plan.generationId
    &&integer(cutover)&&cutover<=plan.manifest.records&&(cutover===plan.manifest.records||cutover%plan.batchSize===0)
    &&(exclusionAuditCutoverOffset===null||cutover===exclusionAuditCutoverOffset), 'FEED_BOOTSTRAP_MEMBERSHIP_EXCLUSION_TRANSITION_INVALID');
  check(transitionPersisted||initial.state.offset===cutover,'FEED_BOOTSTRAP_MEMBERSHIP_EXCLUSION_TRANSITION_REQUIRED');
  const transitionSha256=hash(transitionBody),transitionCursor=JSON.stringify({...transitionBody,sha256:transitionSha256});
  const expectedExclusions=new Map();
  const checkpoint = async ({db, receipt, prepared, rejected, skipped}) => {
    check(db === membership.db && receipt.fileSha256 === plan.manifest.sha256 && receipt.generationId === plan.generationId,
      'FEED_BOOTSTRAP_MEMBERSHIP_CONFLICT');
    const resolved=[],exclusions=[];let unresolvedCount=rejected.length;
    for(const entry of prepared){
      const identity=entry.record.identity,vehicle=entry.record.vehicle,reasons=[];
      if(typeof vehicle.vin!=='string'||!/^[A-HJ-NPR-Z0-9]{17}$/.test(vehicle.vin))reasons.push('strict_vin_unresolved');
      // Vehicle-entity linkage uses confirmed/unresolved (core.js:87); it is not
      // the canonical source/listing identity checked by membership.
      for(const name of ['sourceIdentityState','listingIdentityState'])if(identity[name]!=='resolved')reasons.push(name+'_unresolved');
      if(reasons.length){
        unresolvedCount++;exclusions.push({origin:'prepared',platform:vehicle.platform,lot:String(vehicle.lot),
          listingId:identity.listingId,sourceKey:identity.sourceKey,code:'PREPARED_MEMBERSHIP_IDENTITY_UNRESOLVED',reasons});continue;
      }
      resolved.push({listingId:identity.listingId,sourceKey:identity.sourceKey,platform:vehicle.platform,lot:String(vehicle.lot),vin:vehicle.vin});
    }
    const matches = new Map();
    if (skipped.length) {
      // One indexed JSON-key join for the entire bounded page, never one D1
      // query per skipped vehicle. More than two rows per requested key is
      // already ambiguous, and the result has a finite failure-safe ceiling.
      const found = await db.prepare(`SELECT l.*,s.provider source_provider,s.platform source_platform
        FROM json_each(?) e JOIN auction_listings l ON l.platform=json_extract(e.value,'$.platform')
          AND l.lot=json_extract(e.value,'$.lot') JOIN vehicle_sources s ON s.source_key=l.source_key
        ORDER BY l.platform,l.lot,l.listing_id LIMIT 121`).bind(JSON.stringify(skipped.map(item => ({platform:item.platform,lot:item.lot})))).all();
      check(Array.isArray(found?.results), 'FEED_BOOTSTRAP_MEMBERSHIP_READ_FAILED');
      for (const row of found.results) {const key = row.platform+':'+row.lot; const entries = matches.get(key) || []; entries.push(row);matches.set(key,entries);}
    }
    for (const item of skipped) {
      const raw = receipt.records.find(row => row.platform === item.platform && String(row.lot_number) === item.lot);
      const found = matches.get(item.platform+':'+item.lot) || [], row = found.length === 1 ? found[0] : null;
      const rawVin = typeof raw?.vin === 'string' ? raw.vin.toUpperCase() : '';
      // Match the original strict saved-VIN guard: no trimming, masking or
      // source-ID inference. A newer closed/unknown listing needs review.
      if (!row || !['older_observation','older_source_version'].includes(item.code)
        || !/^[A-HJ-NPR-Z0-9]{17}$/.test(rawVin) || row.vin_normalized !== rawVin
        || row.identity_state !== 'resolved' || row.source_provider !== 'apibara' || row.source_platform !== item.platform
        || !['open','live'].includes(row.auction_state)) {
        unresolvedCount++;exclusions.push({origin:'skipped',platform:item.platform,lot:item.lot,listingId:row?.listing_id??null,
          sourceKey:row?.source_key??null,code:'SKIPPED_MEMBERSHIP_IDENTITY_UNRESOLVED',reasons:[!row?'missing_or_ambiguous_canonical':
            !/^[A-HJ-NPR-Z0-9]{17}$/.test(rawVin)?'strict_source_vin_unresolved':row.vin_normalized!==rawVin?'source_canonical_vin_mismatch':
            !['open','live'].includes(row.auction_state)?'canonical_not_open_live':'unverified_canonical_identity_or_skip']});continue;
      }
      resolved.push({listingId: row.listing_id, sourceKey: row.source_key, platform: row.platform, lot: row.lot, vin: row.vin_normalized,
        expected: {updatedAt: row.updated_at, sourceUpdatedAt: row.source_updated_at, summarySyncedAt: row.summary_synced_at,
          detailSyncedAt: row.detail_synced_at, auctionState: row.auction_state}});
    }
    const result = await membership.snapshotStatements({baselineId, offset: receipt.offset,
      endOffset: receipt.offset + receipt.records.length, batchSha256: receipt.batchSha256,
      resolved, excludedCount: 0, unresolvedCount});
    const auditBody={version:1,kind:'bootstrap-membership-exclusions',baselineId,bootstrapPlanSha256:plan.sha256,membershipPlanSha256,auditCutoverOffset:cutover,transitionSha256,
      sourceEvidenceSha256:plan.sourceEvidence.evidenceSha256,snapshotSha256:receipt.fileSha256,generationId:receipt.generationId,
      batchSha256:receipt.batchSha256,offset:receipt.offset,end:receipt.offset+receipt.records.length,
      preparedRecords:prepared.length,normalizerRejected:rejected.length,skippedRecords:skipped.length,
      normalizerRejectionsSha256:hash(rejected),skippedSha256:hash(skipped),resolvedRecords:resolved.length,unresolvedRecords:unresolvedCount,exclusions};
    const cursor=JSON.stringify({...auditBody,sha256:hash(auditBody)}),at=new Date(membership.store.now()).toISOString();
    expectedExclusions.set(receipt.offset,cursor);
    // A duplicate/conflicting key aborts the WHOLE canonical transaction.
    // Verified snapshot replay returns before this factory, so no overwrite or
    // ON CONFLICT exemption is needed for idempotency.
    const additional=[...result.statements,db.prepare(`INSERT INTO automatic_refresh_tasks
      (task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
      VALUES(?,'all',?,?,?,?,'complete')`).bind(exclusionKey(receipt.offset),cursor,at,at,at)];
    if(!transitionPersisted)additional.push(db.prepare(`INSERT INTO automatic_refresh_tasks
      (task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
      VALUES(?,'all',?,?,?,?,'complete')`).bind(transitionKey,transitionCursor,at,at,at));
    return additional;
  };
  checkpoint.verifyReceipt = async receipt => {
    const current = verifyBaseline(await membership.read(baselineId)), saved = current.state.lastBatch;
    check(current.state.offset === receipt.end && saved?.kind === 'snapshot' && saved.from === receipt.offset
      && saved.through === receipt.end && saved.sha256 === receipt.batchSha256, 'FEED_BOOTSTRAP_MEMBERSHIP_READBACK_FAILED');
    const task=await membership.db.prepare('SELECT platform,listing_id,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(exclusionKey(receipt.offset)).first();
    const transition=await membership.db.prepare('SELECT platform,listing_id,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(transitionKey).first();
    if(transition){check(transition.platform==='all'&&transition.listing_id===null&&transition.status==='complete'&&transition.cursor===transitionCursor,'FEED_BOOTSTRAP_MEMBERSHIP_EXCLUSION_TRANSITION_INVALID');transitionPersisted=true;}
    if(receipt.offset>=cutover)check(transition&&task,'FEED_BOOTSTRAP_MEMBERSHIP_EXCLUSION_READBACK_FAILED');
    if(expectedExclusions.has(receipt.offset))check(task?.cursor===expectedExclusions.get(receipt.offset),'FEED_BOOTSTRAP_MEMBERSHIP_EXCLUSION_READBACK_FAILED');
    if(task){
      let audit;try{audit=JSON.parse(task.cursor);}catch{fail('FEED_BOOTSTRAP_MEMBERSHIP_EXCLUSION_READBACK_FAILED');}
      const {sha256,...body}=audit||{};
      check(task.platform==='all'&&task.listing_id===null&&task.status==='complete'&&hex(sha256)&&hash(body)===sha256
        &&body.version===1&&body.kind==='bootstrap-membership-exclusions'&&body.baselineId===baselineId
        &&body.bootstrapPlanSha256===plan.sha256&&body.membershipPlanSha256===membershipPlanSha256&&body.auditCutoverOffset===cutover&&body.transitionSha256===transitionSha256
        &&body.sourceEvidenceSha256===plan.sourceEvidence.evidenceSha256&&body.snapshotSha256===plan.manifest.sha256
        &&body.generationId===plan.generationId&&body.offset===receipt.offset&&body.end===receipt.end&&body.batchSha256===receipt.batchSha256
        &&Array.isArray(body.exclusions)&&body.unresolvedRecords===body.normalizerRejected+body.exclusions.length
        &&body.resolvedRecords+body.unresolvedRecords===body.end-body.offset
        &&(!Array.isArray(receipt.rejected)||body.normalizerRejectionsSha256===hash(receipt.rejected))
        &&(!Array.isArray(receipt.skipped)||body.skippedSha256===hash(receipt.skipped)), 'FEED_BOOTSTRAP_MEMBERSHIP_EXCLUSION_READBACK_FAILED');
    }
  };
  checkpoint.summary = async () => {
    const current = verifyBaseline(await membership.read(baselineId));
    return {baselineId, offset: current.state.offset, resolved: current.state.resolved, excluded: current.state.excluded,
      unresolved: current.state.unresolved};
  };
  return checkpoint;
}
async function runBootstrapImport({db, store, provider, plan: input, directory, maxBatches, beforeBatch, onReceipt,
  signal, freshnessPolicy, prepareCheckpointStatements} = {}) {
  check(db?.metadataVerified === true && store?.db === db && typeof store?.guarded === 'function'
    && typeof store?.now === 'function' && typeof store?.owner === 'string' && store.owner.length > 0, 'FEED_BOOTSTRAP_STORE_REQUIRED');
  const plan = checkedPlan(input, store.now());
  check(db.identity?.id === plan.target.id && db.identity?.name === plan.target.name, 'FEED_BOOTSTRAP_TARGET_MISMATCH');
  check(Number.isSafeInteger(maxBatches) && maxBatches > 0 && maxBatches <= 1000000
    && typeof beforeBatch === 'function' && (onReceipt === undefined || typeof onReceipt === 'function')
    && (prepareCheckpointStatements === undefined || typeof prepareCheckpointStatements === 'function'), 'FEED_BOOTSTRAP_RUN_LIMIT_INVALID');
  const abort = () => {if (signal?.aborted) fail('FEED_BOOTSTRAP_ABORTED');}; abort();
  const fileKey = `file-snapshot:${plan.manifest.sha256}`, pinKey = `bootstrap:${plan.target.id}:${plan.manifest.sha256}`;
  const getTask = key => db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').bind(key).first();
  const verifyPin = task => {check(task?.platform === 'all' && task.status === 'complete' && task.cursor === JSON.stringify(plan), 'FEED_BOOTSTRAP_PLAN_CONFLICT');};
  let pin = await getTask(pinKey); if (pin) verifyPin(pin);
  let state = stateOf(await getTask(fileKey), plan);
  // Re-read the last committed page, even after a lost response. The existing
  // importer checks its exact durable receipt and performs no canonical writes.
  const offset = state?.offset ?? 0, startOffset = offset ? Math.floor((offset - 1) / plan.batchSize) * plan.batchSize : 0;
  let appliedBatches = 0, replayedBatches = 0, readbackRecords = 0;
  for await (const receipt of readSnapshotPages({directory, manifest: plan.manifest, generationId: plan.generationId,
    observedAt: plan.observedAt, observationTimeBasis: plan.observationTimeBasis, batchSize: plan.batchSize,
    startOffset, signal, now: store.now()})) {
    abort();
    // Gate metadata pin and every page attempt on the caller's explicit budget,
    // lease renewal and uncertainty journal. No default financial allowance.
    await beforeBatch({planSha256: plan.sha256, target: {...plan.target}, offset: receipt.offset,
      records: receipt.records.length, replayExpected: receipt.offset < offset, signal}); abort();
    if (!pin) {
      const at = new Date(store.now()).toISOString();
      await store.guarded([db.prepare(`INSERT INTO automatic_refresh_tasks
        (task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
        VALUES(?,'all',?,?,?,?,'complete') ON CONFLICT(task_key) DO NOTHING`)
        .bind(pinKey, JSON.stringify(plan), at, at, at)]);
      pin = await getTask(pinKey); verifyPin(pin);
    }
    const result = await importSnapshotBatch({db, store, provider, receipt, freshnessPolicy, prepareCheckpointStatements});
    await readback(db, result, receipt, fileKey); abort();
    state = result.state;
    if (result.alreadyApplied) replayedBatches++; else appliedBatches++;
    readbackRecords += result.committed?.expected.length ?? 0;
    const report = {planSha256: plan.sha256, target: {...plan.target}, offset: receipt.offset,
      end: receipt.offset + receipt.records.length, batchSha256: receipt.batchSha256, alreadyApplied: result.alreadyApplied,
      fileSha256: receipt.fileSha256, generationId: receipt.generationId, audit: clone(result.audit),
      sourceIdentities: receipt.records.map(row => ({platform: row.platform, lot: String(row.lot_number)})),
      committedListingIds: result.committed?.expected.map(row => row.listingId) ?? null, state: clone(state)};
    await prepareCheckpointStatements?.verifyReceipt?.(clone(report));
    await onReceipt?.(report); abort();
    if (appliedBatches >= maxBatches) break;
  }
  check(state, 'FEED_BOOTSTRAP_CHECKPOINT_INVALID');
  const complete = state.offset === state.totalRecords;
  const membership = await prepareCheckpointStatements?.summary?.();
  const canonicalComplete = complete && state.rejected === 0 && (!membership || membership.unresolved === 0);
  const rejections = await rejectionSummary(db, plan.manifest.sha256, state, signal);
  return {planSha256: plan.sha256, target: {...plan.target}, appliedBatches, replayedBatches, readbackRecords, state: clone(state),
    complete, rejections, membership: membership ?? null, canonicalComplete,
    handoffCandidate: canonicalComplete ? {kind: 'overlap-replay', after: plan.sourceEvidence.deltaStartN,
      ...clone(plan.sourceEvidence)} : null,
    deltaCursorChanged: false, providerRequests: 0};
}
module.exports = {createBootstrapPlan, runBootstrapImport, createBootstrapMembershipCheckpoint};
