'use strict';

// Detail requests for recent, identity-verified feed LOTs only. Historical
// pending tasks do not acquire eligibility merely by being imported today.
const {createHash, randomUUID} = require('node:crypto');
const {parseChangesResponse, createApibaraProvider} = require('../providers/apibara.js');
const {assertDetail} = require('./automatic-refresh.cjs');
const {readBootstrapActivation}=require('./feed-bootstrap-activation.cjs');
const {FeedBootstrapMembership}=require('./feed-bootstrap-membership.cjs');
const {availabilityOf}=require('./publication-refresh.cjs');
const {SERVER_MAX_GROUPS}=require('./feed-change-import.cjs');
const MAX_GROUPS = 100, MAX_EVENTS = 100000, FRESH_MS = 90 * 60000, HOUR = 3600000, DAY = 24 * HOUR;
const integer = n => Number.isSafeInteger(n) && n >= 0;
const fullVin = value => typeof value === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/i.test(value);
const iso = value => new Date(value).toISOString();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => {throw Error(code);};
const codeOf = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code || error?.message || '') ? error.code || error.message : 'FEED_ACTIVE_FAILED';
const ACTIVE = ['active','open','pending','upcoming','scheduled','future','pre_bid','prebid','pre bid','live','running','in_progress','in progress','started','timed','buy_now','buy now'];
const TERMINAL = ['ended','closed','finished','completed','cancelled','canceled','withdrawn','sold','not sold','removed','sold on approval'];
const STATE_FIELDS = ['auction.state','auction.lot_sub_status','auction.outcome_status'];
const IDENTITY_ERRORS = new Set(['FEED_ACTIVE_IDENTITY_INVALID','FEED_ACTIVE_IDENTITY_MISMATCH',
  'AUTOMATIC_REFRESH_IDENTITY_MISMATCH','AUTOMATIC_REFRESH_IDENTITY_INVALID','CANONICAL_IDENTITY_INVALID',
  'AMBIGUOUS_PLATFORM_LOT','KNOWN_TARGET_CHANGED','PLATFORM_LOT_VIN_MISMATCH','DETAIL_TARGET_MISMATCH',
  'NEGATIVE_PROVIDER_PRICE','SOURCE_VERSION_TIME_INVALID']);
const SYSTEM_ERRORS = new Set(['AUTH','CONFIGURATION','RATE_LIMITED','TIMEOUT','UPSTREAM','INVALID_REQUEST','INVALID_RESPONSE',
  'AUTOMATIC_REFRESH_RESPONSE_INVALID','AUTOMATIC_REFRESH_BUDGET_STOP','AUTOMATIC_REFRESH_RUN_LIMIT',
  'AUTOMATIC_REFRESH_DAY_CHANGED','AUTOMATIC_REFRESH_QUERY_LIMIT','FEED_ACTIVE_TIME_INVALID']);
const BUDGET_ERRORS = new Set(['AUTOMATIC_REFRESH_BUDGET_STOP','AUTOMATIC_REFRESH_RUN_LIMIT','AUTOMATIC_REFRESH_DAY_CHANGED','AUTOMATIC_REFRESH_QUERY_LIMIT']);
function validateStore(db, store) {
  if (!db?.prepare || !db?.batch || store?.db !== db || !store.owner || typeof store.guarded !== 'function' || typeof store.now !== 'function') fail('FEED_ACTIVE_STORE_REQUIRED');
}
function time(value, upper) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
      || !Number.isFinite(Date.parse(value)) || Date.parse(value) > upper) fail('FEED_ACTIVE_TIME_INVALID');
  const local = value.slice(0,19), calendar = Date.parse(`${local}Z`);
  if (!Number.isFinite(calendar) || iso(calendar).slice(0,19) !== local) fail('FEED_ACTIVE_TIME_INVALID');
  return iso(Date.parse(value));
}
function prepareEligibility(groups, generationId, observedAt, now, namespace) {
  observedAt = time(observedAt, now);
  if (!['file','server'].includes(namespace)) fail('FEED_ACTIVE_GROUP_INVALID');
  const maxGroups = namespace === 'server' ? SERVER_MAX_GROUPS : MAX_GROUPS;
  if (!integer(generationId) || generationId < 1 || !Array.isArray(groups) || !groups.length || groups.length > maxGroups) fail('FEED_ACTIVE_GROUP_INVALID');
  const identities = new Set(), sequences = new Set(), ids = new Set(); let total = 0;
  return groups.map(group => {
    if (!group || !['copart','iaai'].includes(group.platform) || typeof group.lot !== 'string' || !/^\d{1,20}$/.test(group.lot)
        || !Array.isArray(group.events) || !group.events.length || !Array.isArray(group.quarantinedSequences)) fail('FEED_ACTIVE_GROUP_INVALID');
    const key = `${group.platform}:${group.lot}`;
    if (identities.has(key)) fail('FEED_ACTIVE_GROUP_INVALID'); identities.add(key);
    total += group.events.length; if (total > MAX_EVENTS) fail('FEED_ACTIVE_GROUP_INVALID');
    const quarantined = new Set(group.quarantinedSequences), vins = new Set();
    if (quarantined.size !== group.quarantinedSequences.length) fail('FEED_ACTIVE_GROUP_INVALID');
    let previous = 0, identityError = false, signal = 0, recordedAt;
    for (const event of group.events) {
      if (event?.vehicle?.platform !== group.platform || event.vehicle.lot_number !== group.lot || !integer(event.sequence)
          || event.sequence <= previous || sequences.has(event.sequence) || ids.has(event.event_id)) fail('FEED_ACTIVE_GROUP_INVALID');
      const badVin = event.vehicle.vin != null && !fullVin(event.vehicle.vin), quarantine = quarantined.delete(event.sequence);
      if (quarantine && !badVin) fail('FEED_ACTIVE_GROUP_INVALID');
      const candidate = badVin ? {...event, vehicle: {...event.vehicle, vin: null}} : event;
      parseChangesResponse({ok: true, data: [candidate], meta: {after: previous, next_cursor: event.sequence,
        has_more: false, count: 1, ordering: 'sequence_asc', schema_version: 'active-feed', retention_days: 14}}, {after: previous, limit: 1});
      recordedAt = time(event.recorded_at, Date.parse(observedAt));
      if (event.vehicle_updated_at != null) time(event.vehicle_updated_at, Date.parse(observedAt));
      if (fullVin(event.vehicle.vin)) vins.add(event.vehicle.vin.toUpperCase());
      if (badVin || quarantine) identityError = true;
      if (event.record != null) {
        if (event.record.platform !== group.platform || String(event.record.lot_number ?? '') !== group.lot || !fullVin(event.record.vin)) identityError = true;
        if (fullVin(event.record.vin)) vins.add(event.record.vin.toUpperCase());
      }
      const states = STATE_FIELDS.filter(field => Object.hasOwn(event.after, field)).map(field =>
        typeof event.after[field] === 'string' ? event.after[field].toLowerCase().replace(/[_-]+/g, ' ').trim() : null);
      if (typeof event.record?.auction?.state === 'string') states.push(event.record.auction.state.toLowerCase().replace(/[_-]+/g, ' ').trim());
      const terminal = event.terminal || event.event === 'auction.ended' || states.some(value => TERMINAL.includes(value));
      const active = states.some(value => ACTIVE.includes(value));
      if (terminal) signal = -1; else if (active || event.event === 'lot.created') signal = 1;
      if (terminal && active) identityError = true;
      sequences.add(event.sequence); ids.add(event.event_id); previous = event.sequence;
    }
    if (quarantined.size) fail('FEED_ACTIVE_GROUP_INVALID');
    if (vins.size !== 1) identityError = true;
    return {platform: group.platform, lot: group.lot, generation_id: generationId, first_sequence: group.events[0].sequence,
      last_sequence: previous, recorded_at: recordedAt, observed_at: observedAt, expected_vin: vins.size === 1 ? [...vins][0] : null,
      terminal: signal === -1 ? 1 : 0, state_signal: signal, identity_error: identityError ? 1 : 0,
      group_sha256: hash(group), updated_at: iso(now)};
  });
}
const cleanup = (db, id) => db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id);
async function recordFeedEligibility({db, store, groups, generationId, observedAt, checkpointStatements = [], namespace = 'file'} = {}) {
  validateStore(db, store);
  if (!Array.isArray(checkpointStatements) || checkpointStatements.length > 8) fail('FEED_ACTIVE_CHECKPOINT_INVALID');
  try {groups = structuredClone(groups);} catch {fail('FEED_ACTIVE_GROUP_INVALID');}
  const rows = prepareEligibility(groups, generationId, observedAt, store.now(), namespace), json = JSON.stringify(rows), id = randomUUID();
  const columns = ['platform','lot','generation_id','last_sequence','recorded_at','observed_at','expected_vin','terminal','identity_error','group_sha256','updated_at'];
  await store.guarded([
    db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
      SELECT 1 FROM server_feed_state f JOIN server_feed_generations g ON g.generation_id=f.active_generation
      WHERE f.singleton=1 AND g.generation_id=? AND g.status='applying' AND g.retired_at IS NULL AND g.observed_at=?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE json_extract(r.value,'$.first_sequence')<g.first_sequence
        OR json_extract(r.value,'$.last_sequence')>g.last_sequence))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) r JOIN server_feed_reconcile_eligibility e
        ON e.platform=json_extract(r.value,'$.platform') AND e.lot=json_extract(r.value,'$.lot')
        WHERE e.last_sequence=json_extract(r.value,'$.last_sequence') AND
          (e.group_sha256,e.generation_id,e.observed_at) IS NOT (json_extract(r.value,'$.group_sha256'),json_extract(r.value,'$.generation_id'),json_extract(r.value,'$.observed_at')))
      THEN 1 ELSE 0 END)`).bind(id, generationId, rows[0].observed_at, json, json),
    db.prepare(`INSERT INTO server_feed_reconcile_eligibility(${columns.join(',')})
      SELECT ${columns.map(column => `json_extract(value,'$.${column}')`).join(',')} FROM json_each(?) WHERE 1
      ON CONFLICT(platform,lot) DO UPDATE SET generation_id=excluded.generation_id,last_sequence=excluded.last_sequence,
        recorded_at=excluded.recorded_at,observed_at=excluded.observed_at,
        expected_vin=COALESCE(server_feed_reconcile_eligibility.expected_vin,excluded.expected_vin),
        terminal=CASE WHEN (SELECT json_extract(value,'$.state_signal') FROM json_each(?)
          WHERE json_extract(value,'$.platform')=excluded.platform AND json_extract(value,'$.lot')=excluded.lot)=0
          THEN server_feed_reconcile_eligibility.terminal ELSE excluded.terminal END,
        identity_error=MAX(server_feed_reconcile_eligibility.identity_error,excluded.identity_error,
          CASE WHEN server_feed_reconcile_eligibility.expected_vin IS NOT NULL AND excluded.expected_vin IS NOT NULL
            AND server_feed_reconcile_eligibility.expected_vin<>excluded.expected_vin THEN 1 ELSE 0 END),
        group_sha256=excluded.group_sha256,updated_at=excluded.updated_at
      WHERE excluded.last_sequence>server_feed_reconcile_eligibility.last_sequence`).bind(json, json),
    ...checkpointStatements, cleanup(db, id)]);
  return {groups: rows.length, identityErrors: rows.filter(row => row.identity_error).length,
    terminalGroups: rows.filter(row => row.terminal).length, globalCursorEstablished: false};
}

const activeSql = ACTIVE.map(state => `'${state}'`).join(',');
// Retained archives below a verified fresh bootstrap floor are already covered.
// Unknown/malformed boundaries and any newer work still prevent detail requests.
async function detailCoverage(db){
 const schema=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feed_catalog_pointer'").bind().first();if(!schema)return null;
 const pointer=await db.prepare('SELECT baseline_id,revision FROM feed_catalog_pointer WHERE singleton=1').bind().first();if(!pointer||pointer.baseline_id===null)return null;
 const activation=await readBootstrapActivation({db,baselineId:pointer.baseline_id});if(!activation||!integer(pointer.revision))fail('FEED_ACTIVE_BASELINE_UNVERIFIED');
 return {...activation,pointerRevision:pointer.revision};
}
const coverageParams=c=>c?[c.baselineId,c.pointerRevision,c.receiptKey,c.receiptCursor,c.baselineId,c.planSha256]:[];
function currentSql(coverage){
 const uncovered=coverage?`(pending.first_sequence IS NULL OR pending.last_sequence IS NULL
  OR typeof(pending.first_sequence)<>'integer' OR typeof(pending.last_sequence)<>'integer'
  OR pending.first_sequence<1 OR pending.last_sequence<pending.first_sequence OR pending.last_sequence>${coverage.floorSequence})`:'1=1';
 return `f.singleton=1 AND f.active_generation IS NULL AND g.status='complete' AND g.retired_at IS NULL
  AND g.last_sequence=f.committed_sequence AND julianday(g.observed_at) BETWEEN julianday(?) AND julianday(?)
  AND NOT EXISTS(SELECT 1 FROM server_feed_generations pending WHERE pending.retired_at IS NULL AND pending.status<>'complete' AND ${uncovered})
  ${coverage?`AND EXISTS(SELECT 1 FROM feed_catalog_pointer WHERE singleton=1 AND baseline_id=? AND revision=?)
   AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='complete' AND cursor=?)
   AND EXISTS(SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND plan_sha256=? AND json_extract(checkpoint_json,'$.replaySequence')=f.committed_sequence)
   AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key>='bootstrap-' AND task_key<'bootstrap.' AND status='pending')`:''}`;
}

function workGuard(db, task, scope, now, id) {
  const taskFields = ['task_key','platform','listing_id','cursor','next_due_at','last_attempt_at','failures','last_error_code'];
  const fields = ['platform','lot','generation_id','last_sequence','recorded_at','observed_at','expected_vin','terminal','identity_error','group_sha256'];
  return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM server_feed_state f JOIN server_feed_generations g ON g.generation_id=?
    WHERE ${currentSql(scope.coverage)} AND f.committed_sequence=?) AND EXISTS(SELECT 1 FROM automatic_refresh_tasks t
      WHERE (${taskFields.map(key => `t.${key}`).join(',')}) IS (${taskFields.map(() => '?').join(',')}) AND t.status='pending')
    AND EXISTS(SELECT 1 FROM server_feed_reconcile_eligibility e
      WHERE (${fields.map(key => `e.${key}`).join(',')}) IS (${fields.map(() => '?').join(',')})
      AND julianday(e.recorded_at) BETWEEN julianday(?) AND julianday(?)
      AND EXISTS(SELECT 1 FROM server_feed_generations eg WHERE eg.generation_id=e.generation_id AND eg.status='complete'
        AND eg.retired_at IS NULL AND eg.observed_at=e.observed_at AND e.last_sequence BETWEEN eg.first_sequence AND eg.last_sequence))
    THEN 1 ELSE 0 END)`).bind(id, scope.generation_id, iso(now - FRESH_MS), iso(now), ...coverageParams(scope.coverage), scope.committed_sequence,
      ...taskFields.map(key => task[key]), ...fields.map(key => task[key]), iso(now - FRESH_MS), iso(now));
}
function renew(db, store, now) {
  return db.prepare('UPDATE automatic_refresh_state SET lease_until=? WHERE singleton=1 AND lease_owner=? AND lease_until>?')
    .bind(iso(now + 10 * 60000), store.owner, iso(now));
}
async function postpone({db, store, now}, task, scope, code, identity = false, delay = HOUR) {
  const id = randomUUID();
  await store.guarded([workGuard(db, task, scope, now(), id), renew(db, store, now()),
    db.prepare(`UPDATE automatic_refresh_tasks SET status=?,next_due_at=?,last_attempt_at=?,failures=failures+1,last_error_code=? WHERE task_key=?`)
      .bind(identity ? 'identity_error' : 'pending', iso(now() + delay), iso(now()), code, task.task_key),
    ...(identity ? [db.prepare('UPDATE server_feed_reconcile_eligibility SET identity_error=1,updated_at=? WHERE platform=? AND lot=?')
      .bind(iso(now()), task.platform, task.lot)] : []), cleanup(db, id)]);
}

const DETAIL_RECEIPT_PREFIX='server-detail-confirmation:';
const BASELINE_CONTEXT_UPDATE='UPDATE feed_catalog_baselines SET checkpoint_json=?,revision=revision+1,updated_at=? WHERE baseline_id=? AND revision=?';
async function detailMembershipContext({db,store,scope,task,raw,response,observedAt,adapter}){
 const vehicle=adapter.toCanonicalVehicle(raw,adapter.normalizeVehicle(raw)),availability=availabilityOf(vehicle,raw);
 const state=String(vehicle.auction?.state||'').toLowerCase();
 if(availability.status==='unknown'||availability.status==='active'&&!['open','live'].includes(state))return {deferred:'FEED_ACTIVE_CONTEXT_UNCONFIRMED'};
 let sourceUpdatedAt;try{sourceUpdatedAt=time(typeof raw.updated_at==='string'?raw.updated_at.replace(/(\.\d{3})\d{1,3}(?=Z|[+-]\d{2}:\d{2}$)/,'$1'):raw.updated_at,Date.parse(observedAt));}catch{return {deferred:'FEED_ACTIVE_CONTEXT_SOURCE_TIME'};}
 // Event ingestion and whole-vehicle metadata versions are distinct clocks.
 // Require a genuinely later API observation; the existing full writer still
 // rejects a source version older than a KNOWN canonical vehicle version.
 if(Date.parse(observedAt)<Date.parse(task.recorded_at))return {deferred:'FEED_ACTIVE_CONTEXT_STALE'};
 const membership=new FeedBootstrapMembership({db,store}),current=await membership.read(scope.coverage.baselineId);
 if(current.state.replaySequence!==scope.committed_sequence||current.state.pendingDelta!=null||!current.state.replayVerified)fail('FEED_ACTIVE_BASELINE_UNVERIFIED');
 const saved=await db.prepare('SELECT updated_at FROM feed_catalog_baselines WHERE baseline_id=? AND revision=? AND checkpoint_json=?')
  .bind(scope.coverage.baselineId,current.revision,current.checkpointJson).first();
 if(!saved||!Number.isFinite(Date.parse(saved.updated_at)))fail('FEED_ACTIVE_BASELINE_UNVERIFIED');
 const known=(await db.prepare(`SELECT m.listing_id,m.active,m.last_sequence FROM feed_catalog_membership m JOIN auction_listings l ON l.listing_id=m.listing_id
  WHERE m.baseline_id=? AND l.platform=? AND l.lot=? LIMIT 2`).bind(scope.coverage.baselineId,task.platform,task.lot).all()).results;
 if(!Array.isArray(known)||known.length>1||known.some(r=>![0,1].includes(r.active)||!integer(r.last_sequence)||r.last_sequence>scope.committed_sequence))fail('FEED_ACTIVE_BASELINE_UNVERIFIED');
 const prior=known[0]||null,active=availability.status==='active',responseFingerprint=hash(response);let confirmation=null;
 return {deferred:null,statements(record){
  const canonicalState=String(record.vehicle?.auction?.state||'').toLowerCase(),canonicalAvailability=availabilityOf(record.vehicle,raw);
  if(record.vehicle?.platform!==task.platform||String(record.vehicle.lot)!==task.lot||record.vehicle.vin?.toUpperCase()!==task.expected_vin
   ||!record.identity?.listingId||!record.identity.sourceKey||canonicalAvailability.status!==availability.status
   ||active&&!['open','live'].includes(canonicalState)||!active&&canonicalAvailability.status!=='ended'
   ||prior&&prior.listing_id!==record.identity.listingId)fail('FEED_ACTIVE_IDENTITY_MISMATCH');
  const body={version:1,kind:'guarded-supplier-detail-confirmation',baselineId:scope.coverage.baselineId,activationSha256:scope.coverage.receiptSha256,
   identity:{platform:task.platform,lot:task.lot,vin:task.expected_vin,listingId:record.identity.listingId,sourceKey:record.identity.sourceKey},
   task:{taskKey:task.task_key,generationId:task.generation_id,eventSequence:task.last_sequence,groupSha256:task.group_sha256},
   feed:{generationId:scope.generation_id,committedSequence:scope.committed_sequence},observedAt,sourceUpdatedAt,
   supplierResponseFingerprint:responseFingerprint,availability:availability.status,canonicalAuctionState:record.vehicle.auction.state,active,
   baselineUpdatedAtPreserved:saved.updated_at,baselineCheckpointSha256:createHash('sha256').update(current.checkpointJson).digest('hex')};
  const cursor=JSON.stringify({...body,sha256:hash(body)}),key=DETAIL_RECEIPT_PREFIX+hash(body),guardId=randomUUID();
  const row={listingId:record.identity.listingId,sourceKey:record.identity.sourceKey,platform:task.platform,lot:task.lot,vin:task.expected_vin,
   sequence:scope.committed_sequence,active:active?1:0,expected:{updatedAt:observedAt,sourceUpdatedAt:record.vehicle.source_updated_at??null,
    summarySyncedAt:observedAt,detailSyncedAt:observedAt,auctionState:record.vehicle.auction.state}};
  let preserved=0;const buildDb={batch:(...args)=>db.batch(...args),prepare(sql){return {bind(...params){
   if(sql===BASELINE_CONTEXT_UPDATE){if(params.length!==4||params[0]!==JSON.stringify(current.state)||params[2]!==scope.coverage.baselineId||params[3]!==current.revision)fail('FEED_ACTIVE_MEMBERSHIP_BUILDER_CHANGED');
    params=[current.checkpointJson,saved.updated_at,params[2],params[3]];preserved++;}
   return db.prepare(sql).bind(...params);
  }};}};
  const builder=new FeedBootstrapMembership({db:buildDb,store:{db:buildDb,now:store.now.bind(store),guarded:statements=>store.guarded(statements)}});
  const mutation=builder.mutation(current,current.state,[row]);if(mutation.length!==4||preserved!==1)fail('FEED_ACTIVE_MEMBERSHIP_BUILDER_CHANGED');
  const priorSql=prior?'EXISTS(SELECT 1 FROM feed_catalog_membership WHERE baseline_id=? AND listing_id=? AND active=? AND last_sequence=?)'
   :'NOT EXISTS(SELECT 1 FROM feed_catalog_membership WHERE baseline_id=? AND listing_id=?)';
  const statements=[db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
   EXISTS(SELECT 1 FROM feed_catalog_baselines WHERE baseline_id=? AND updated_at=? AND revision=? AND checkpoint_json=?)
   AND ${priorSql} AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?) THEN 1 ELSE 0 END)`)
   .bind(guardId,scope.coverage.baselineId,saved.updated_at,current.revision,current.checkpointJson,scope.coverage.baselineId,record.identity.listingId,
    ...(prior?[prior.active,prior.last_sequence]:[]),key),...mutation];
  // Supplier confirmation at the same REAL completed feed checkpoint may flip
  // eligibility, but must never manufacture a later sequence to force an upsert.
  if(prior&&prior.last_sequence===scope.committed_sequence&&prior.active!==Number(active))statements.push(db.prepare(`UPDATE feed_catalog_membership SET active=?
   WHERE baseline_id=? AND listing_id=? AND last_sequence=? AND active=?`).bind(Number(active),scope.coverage.baselineId,record.identity.listingId,scope.committed_sequence,prior.active));
  statements.push(db.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,status,cursor,next_due_at,last_attempt_at,last_success_at) VALUES(?,'all',?,'complete',?,?,?,?)")
   .bind(key,record.identity.listingId,cursor,observedAt,observedAt,observedAt),cleanup(db,guardId));
  confirmation={listingId:record.identity.listingId,key,cursor,active:Number(active)};return statements;
 },async verify(){
  if(!confirmation)fail('FEED_ACTIVE_MEMBERSHIP_READBACK');
  const result=await db.prepare(`SELECT
   (SELECT active FROM feed_catalog_membership WHERE baseline_id=? AND listing_id=?) active,
   (SELECT last_sequence FROM feed_catalog_membership WHERE baseline_id=? AND listing_id=?) last_sequence,
   (SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?) receipt,
   (SELECT updated_at FROM feed_catalog_baselines WHERE baseline_id=?) updated_at,
   (SELECT checkpoint_json FROM feed_catalog_baselines WHERE baseline_id=?) checkpoint_json`).bind(scope.coverage.baselineId,confirmation.listingId,
    scope.coverage.baselineId,confirmation.listingId,confirmation.key,scope.coverage.baselineId,scope.coverage.baselineId).first();
  if(result?.active!==confirmation.active||result.last_sequence!==scope.committed_sequence||result.receipt!==confirmation.cursor
   ||result.updated_at!==saved.updated_at||result.checkpoint_json!==current.checkpointJson)fail('FEED_ACTIVE_MEMBERSHIP_READBACK');
 }};
}

async function processActiveFeedReconciliation({db, store, request, saveRecord, adapter = createApibaraProvider(),
  now = store?.now?.bind(store), maxRequests = 2} = {}) {
  validateStore(db, store);
  if (typeof request !== 'function' || typeof saveRecord !== 'function' || typeof adapter?.vehicleDetailRecord !== 'function'
      || typeof now !== 'function' || !integer(maxRequests) || maxRequests > 2) fail('FEED_ACTIVE_CONFIG_INVALID');
  const report = {attempted: 0, completed: 0, deferred: 0, failed: 0, identityErrors: 0, reason: null};
  if (!maxRequests) return report;
  const at = iso(now()), cutoff = iso(now() - FRESH_MS), coverage=await detailCoverage(db);
  const scopes = (await db.prepare(`SELECT f.committed_sequence,g.generation_id FROM server_feed_state f
    JOIN server_feed_generations g ON g.last_sequence=f.committed_sequence WHERE ${currentSql(coverage)} LIMIT 2`).bind(cutoff, at, ...coverageParams(coverage)).all()).results;
  if (!Array.isArray(scopes)) fail('FEED_ACTIVE_READ_INVALID');
  if (scopes.length !== 1) return {...report, reason: 'feed_not_current'};
  const scope = {...scopes[0],coverage};
  const tasks = (await db.prepare(`SELECT t.*,e.lot,e.generation_id,e.last_sequence,e.recorded_at,e.observed_at,e.expected_vin,
      e.terminal,e.identity_error,e.group_sha256 FROM automatic_refresh_tasks t
    JOIN server_feed_reconcile_eligibility e ON t.task_key='reconcile:'||e.platform||':'||e.lot AND t.platform=e.platform AND t.cursor=e.lot
    JOIN server_feed_generations g ON g.generation_id=e.generation_id
    WHERE t.status='pending' AND t.next_due_at<=? AND e.identity_error=0 AND e.terminal=0 AND e.expected_vin IS NOT NULL
      AND g.status='complete' AND g.retired_at IS NULL AND e.observed_at=g.observed_at
      AND e.last_sequence BETWEEN g.first_sequence AND g.last_sequence AND e.last_sequence<=?
      AND julianday(e.observed_at) BETWEEN julianday(?) AND julianday(?) AND julianday(e.recorded_at) BETWEEN julianday(?) AND julianday(e.observed_at)
      AND (SELECT COUNT(*) FROM auction_listings l WHERE l.platform=e.platform AND l.lot=e.lot)<=1
      AND NOT EXISTS(SELECT 1 FROM auction_listings l LEFT JOIN vehicle_sources s ON s.source_key=l.source_key
        WHERE l.platform=e.platform AND l.lot=e.lot AND (s.provider IS NOT 'apibara' OR s.platform IS NOT e.platform
          OR s.identity_state IS NOT 'resolved' OR l.identity_state IS NOT 'resolved' OR upper(l.vin_normalized) IS NOT e.expected_vin
          OR lower(COALESCE(l.auction_state,'')) NOT IN (${activeSql})))
      AND (t.listing_id IS NULL OR EXISTS(SELECT 1 FROM auction_listings l WHERE l.platform=e.platform AND l.lot=e.lot AND l.listing_id=t.listing_id))
    ORDER BY t.failures,e.recorded_at DESC,t.next_due_at,t.task_key LIMIT ?`)
    .bind(at, scope.committed_sequence, cutoff, at, cutoff, maxRequests).all()).results;
  if (!Array.isArray(tasks)) fail('FEED_ACTIVE_READ_INVALID');
  for (const task of tasks) {
    try {
      if (!fullVin(task.expected_vin) || !/^\d{1,20}$/.test(task.lot) || task.task_key !== `reconcile:${task.platform}:${task.lot}`) fail('FEED_ACTIVE_IDENTITY_INVALID');
      const rows = (await db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id,s.platform AS source_platform,s.identity_state AS source_identity_state
        FROM auction_listings l LEFT JOIN vehicle_sources s ON s.source_key=l.source_key WHERE l.platform=? AND l.lot=? LIMIT 2`)
        .bind(task.platform, task.lot).all()).results;
      if (!Array.isArray(rows)) fail('FEED_ACTIVE_READ_INVALID');
      const known = rows[0] || null;
      if (rows.length > 1 || known && (known.provider !== 'apibara' || known.source_platform !== task.platform
          || known.source_identity_state !== 'resolved' || known.identity_state !== 'resolved'
          || known.vin_normalized?.toUpperCase() !== task.expected_vin || !ACTIVE.includes(String(known.auction_state).toLowerCase()))
          || task.listing_id !== null && task.listing_id !== known?.listing_id) fail('FEED_ACTIVE_IDENTITY_MISMATCH');
      if (!known) {
        const budget = await db.prepare('SELECT limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key=?')
          .bind(`new:${iso(now()).slice(0,10)}`).first();
        if (!budget || budget.consumed >= budget.limit_count) {report.deferred++; report.reason = 'new_listing_budget'; continue;}
      }
      const identifier = known?.provider_vehicle_id || (scope.coverage&&!known?task.expected_vin:task.lot);
      if (typeof identifier !== 'string' || !identifier || identifier.length > 200) fail('FEED_ACTIVE_IDENTITY_INVALID');
      const id = randomUUID(); await store.guarded([workGuard(db, task, scope, now(), id), renew(db, store, now()), cleanup(db, id)]);
      report.attempted++;
      const obtained = await request({operation: 'vehicleByIdentifier', identifier, platform: task.platform}, known?.listing_id || null);
      const observedAt = time(obtained?.observedAt, now()), raw = adapter.vehicleDetailRecord(obtained.response);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.platform !== task.platform
          || String(raw.lot_number ?? raw.lot ?? '') !== task.lot || !fullVin(raw.vin) || raw.vin.toUpperCase() !== task.expected_vin) fail('FEED_ACTIVE_IDENTITY_MISMATCH');
      if (known) assertDetail(raw, known);
      const membershipWork=scope.coverage?await detailMembershipContext({db,store,scope,task,raw,response:obtained.response,observedAt,adapter}):null;
      if(membershipWork?.deferred){await postpone({db,store,now},task,scope,membershipWork.deferred);report.deferred++;continue;}
      let completionPrepared = false;
      await saveRecord(raw, task.platform, observedAt, known, record => {
        if (record?.vehicle?.platform !== task.platform || record.vehicle.lot !== task.lot
            || record.vehicle.vin?.toUpperCase() !== task.expected_vin || !record.identity?.listingId
            || known && record.identity.listingId !== known.listing_id) fail('FEED_ACTIVE_IDENTITY_MISMATCH');
        const id = randomUUID(); completionPrepared = true;
        return [workGuard(db, task, scope, now(), id),
          ...(!known ? [db.prepare('UPDATE auction_listings SET detail_synced_at=? WHERE listing_id=?').bind(observedAt, record.identity.listingId)] : []),
          ...(membershipWork?membershipWork.statements(record):[]),
          db.prepare(`UPDATE automatic_refresh_tasks SET listing_id=?,status='complete',next_due_at=?,last_attempt_at=?,last_success_at=?,failures=0,last_error_code=NULL WHERE task_key=?`)
            .bind(record.identity.listingId, iso(now() + DAY), observedAt, observedAt, task.task_key), cleanup(db, id)];
      });
      if (completionPrepared) {if(membershipWork)await membershipWork.verify();report.completed++;}
      else {await postpone({db, store, now}, task, scope, 'FEED_ACTIVE_DEFERRED'); report.deferred++;}
    } catch (error) {
      const code = codeOf(error);
      if (code === 'AUTOMATIC_REFRESH_WRITE_FAILED' || code === 'FEED_ACTIVE_READ_INVALID' || code === 'FEED_ACTIVE_MEMBERSHIP_READBACK') throw error;
      if (IDENTITY_ERRORS.has(code)) {await postpone({db, store, now}, task, scope, code, true, 7 * DAY); report.identityErrors++; continue;}
      if (code === 'NOT_FOUND') {await postpone({db, store, now}, task, scope, code, false, 7 * DAY); report.failed++; continue;}
      if (SYSTEM_ERRORS.has(code) && !BUDGET_ERRORS.has(code)) await postpone({db, store, now}, task, scope, code);
      throw error;
    }
  }
  return report;
}

module.exports = {recordFeedEligibility, processActiveFeedReconciliation, MAX_GROUPS, FRESH_MS};
