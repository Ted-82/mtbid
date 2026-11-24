'use strict';

// Durable file-only cursor/outbox. Queue delivery is never evidence of commit.
// Every mutation uses the existing shared RefreshStore lease and atomic guards.
const {createHash, randomUUID} = require('node:crypto');
const {validateDataset,SERVER_MAX_GROUPS} = require('./feed-change-import.cjs');
const {D1RecoveryBudget}=require('./feed-d1-recovery-budget.cjs');
const BUCKETS = 128, SEED_SEQUENCE = 45570246;
// These two completed imports were independently audited on 29 October 2026.
// Bootstrapping cannot select arbitrary completed tasks with the same end cursor.
const LEGACY_DATASETS = Object.freeze([
  {databaseSha256:'3fda74d196098cdc94d4d21c36d40e917b231dc784ffee3f01f985d7e7019c85',
    identity:'78120012aeb609ee4b75bc6cbba316e4fb0f8cafeefbf4b49eb2700cdbcd1974',
    firstSequence:40563105,lastSequence:44267593,records:3656876,quarantined:13,uniqueLots:180435},
  {databaseSha256:'a5afcc99992ffb1a22606ded8badf0ff67c0069b3747d616ab431c9f6990f7a3',
    identity:'eb5ee43267e571bde106eba465748d54963e5919fb3e5af3bf49d1f9a68b262e',
    firstSequence:44267594,lastSequence:45570246,records:1284980,quarantined:24,uniqueLots:127807}
]);
const MAX_DAILY_WRITES = 1000000, MAX_DAILY_READS = 50000000;
const FLEX_BUDGET_DAYS = 31, FLEX_BUDGET_BURST = 3, FLEX_BUDGET_WRITES = 36000000;
const FLEX_BUDGET_SQL = `SELECT COALESCE(SUM(consumed_writes+reserved_writes),0) AS writes,
  COALESCE(SUM(consumed_reads+reserved_reads),0) AS reads FROM server_feed_daily_budgets WHERE day_key BETWEEN ? AND ?`;
const fail = code => {throw Error(code);};
const integer = n => Number.isSafeInteger(n) && n >= 0;
const hex = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const key = s => typeof s === 'string' && /^[a-zA-Z0-9_.:/-]{1,300}$/.test(s) && !s.includes('..') && !s.includes('://');
const code = s => typeof s === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(s);
const digest = value => createHash('sha256').update(value).digest('hex');
const hash = value => digest(JSON.stringify(value));
const iso = n => new Date(n).toISOString();
function time(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || iso(Date.parse(value)) !== value || Date.parse(value) > now) fail('SERVER_FEED_TIME_INVALID');
}
function id(value) {if (!integer(value) || value < 1) fail('SERVER_FEED_GENERATION_INVALID');}
function work(value) {
  if (!value || !key(value.jobKey) || !key(value.kind) || value.kind.length > 40
      || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) fail('SERVER_FEED_OUTBOX_INVALID');
  let payload; try {payload = JSON.stringify(value.payload);} catch {fail('SERVER_FEED_OUTBOX_INVALID');}
  if (Buffer.byteLength(payload) > 4096) fail('SERVER_FEED_OUTBOX_INVALID');
  return {jobKey: value.jobKey, kind: value.kind, payload};
}
const MAX_ONE_DAY_READS=100000000,ALLOWANCE_PREFIX='server-feed-read-allowance:';
function readAllowancePolicy(env,now){
 const day=env?.REXBID_FEED_READ_ALLOWANCE_DAY,limit=env?.REXBID_FEED_READ_ALLOWANCE_LIMIT;
 if(day===undefined&&limit===undefined)return null;
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00.000Z'))
  ||iso(Date.parse(day+'T00:00:00.000Z')).slice(0,10)!==day||typeof limit!=='string'||!/^\d+$/.test(limit)
  ||!Number.isSafeInteger(Number(limit))||Number(limit)<=MAX_DAILY_READS||Number(limit)>MAX_ONE_DAY_READS)fail('SERVER_FEED_READ_ALLOWANCE_CONFIG_INVALID');
 const today=iso(now).slice(0,10);if(day<today)return null;if(day!==today)fail('SERVER_FEED_READ_ALLOWANCE_CONFIG_INVALID');
 return{day,baseReadLimit:MAX_DAILY_READS,effectiveReadLimit:Number(limit)};
}
// A phase/checkpoint has exactly one durable outbox identity. Old retries must not
// suppress a later checkpoint or promote a completed job back into runnable work.
const currentJobSql=alias=>"'feed:'||"+alias+".generation_id||':'||CASE WHEN "+alias+".status='downloaded' THEN 'prepare:0:0' WHEN "+alias+".bucket_index=128 THEN 'finish:128:0' ELSE 'apply:'||"+alias+".bucket_index||':'||"+alias+".group_offset END";
const olderUnknownSql=(candidate,unknown)=>`${unknown}.retired_at IS NULL AND ${unknown}.status IN ('downloaded','blocked')
 AND (${unknown}.first_sequence IS NULL OR ${unknown}.last_sequence IS NULL)
 AND (${unknown}.created_at<${candidate}.created_at OR ${unknown}.created_at=${candidate}.created_at AND ${unknown}.generation_id<${candidate}.generation_id)`;
function feedJobIdentity(row){
 let p;try{p=JSON.parse(row?.payload_json);}catch{return null;}
 if(row.kind!=='feed'||!integer(p?.generationId)||p.generationId<1||!['prepare','apply','finish'].includes(p.phase)
  ||!integer(p.bucketIndex)||p.bucketIndex>128||!integer(p.groupOffset)
  ||row.job_key!==`feed:${p.generationId}:${p.phase}:${p.bucketIndex}:${p.groupOffset}`)return null;
 return p;
}
const precedingArchiveSql=(candidate,other)=>`(${olderUnknownSql(candidate,other)} OR ${other}.retired_at IS NULL AND ${other}.status IN ('prepared','applying','blocked') AND ${other}.first_sequence IS NOT NULL AND (${other}.first_sequence<${candidate}.first_sequence OR ${other}.first_sequence=${candidate}.first_sequence AND ${other}.generation_id<${candidate}.generation_id))`;
class ServerFeedState {
  constructor({db, store, dailyWrites = MAX_DAILY_WRITES, dailyReads = MAX_DAILY_READS} = {}) {
    if (!db?.prepare || !db?.batch || store?.db !== db || !store.owner || typeof store.guarded !== 'function'
        || typeof store.now !== 'function') fail('SERVER_FEED_STORE_REQUIRED');
    if (!integer(dailyWrites) || dailyWrites < 1 || dailyWrites > MAX_DAILY_WRITES
        || !integer(dailyReads) || dailyReads < 1 || dailyReads > MAX_DAILY_READS) fail('SERVER_FEED_BUDGET_INVALID');
    Object.assign(this, {db, store, dailyWrites, dailyReads});
  }
  at() {return iso(this.store.now());}
  configureMembership({membership,activation}={}) {
    if(membership?.db!==this.db||membership.store!==this.store||typeof membership.deltaStatements!=='function'
      ||typeof activation?.baselineId!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(activation.baselineId)
      ||!integer(activation.floorSequence)||!hex(activation.planSha256)||!key(activation.receiptKey)
      ||typeof activation.receiptCursor!=='string'||!hex(activation.receiptSha256)
      ||digest(activation.receiptCursor)!==activation.receiptSha256)fail('SERVER_FEED_MEMBERSHIP_INVALID');
    this.membership=membership;this.activation={...activation};
  }
  uncoveredSql(alias) {return this.activation?`(${alias}.first_sequence IS NULL OR ${alias}.last_sequence IS NULL OR ${alias}.last_sequence>${this.activation.floorSequence})`:'1=1';}
  precedingSql(candidate,other) {return `(${precedingArchiveSql(candidate,other)}) AND ${this.uncoveredSql(other)}`;}
  coveredByBaseline(row) {return !!this.activation&&integer(row?.first_sequence)&&integer(row?.last_sequence)
    &&row.first_sequence>0&&row.last_sequence>=row.first_sequence&&row.last_sequence<=this.activation.floorSequence;}
  canonicalStore() {
    if(!this.activation)return this.store;
    return {db:this.db,owner:this.store.owner,now:this.store.now.bind(this.store),guarded:statements=>this.guarded('1=1',[],statements)};
  }
  getState() {return this.db.prepare('SELECT * FROM server_feed_state WHERE singleton=1').bind().first();}
  getGeneration(generationId) {id(generationId); return this.db.prepare('SELECT * FROM server_feed_generations WHERE generation_id=?').bind(generationId).first();}
  getNextGeneration({readyOnly = false,includeJobKey = null} = {}) {
    if(typeof readyOnly!=='boolean'||includeJobKey!==null&&!key(includeJobKey))fail('SERVER_FEED_OUTBOX_INVALID');
    const at=this.at();
    // After verified activation, a healthy canonical job already delivered to
    // the queue retains its place while that delivery lease is outstanding.
    // Failed/pending jobs and the one-hour budget backoff remain due-gated.
    const deliveryPriority=this.activation?`OR (o.status='dispatched' AND o.attempts=0 AND o.last_error_code IS NULL AND o.kind='feed'
      AND o.updated_at<=? AND julianday(o.next_due_at)>julianday(o.updated_at)
      AND julianday(o.next_due_at)<=julianday(o.updated_at,'+300 seconds')
      AND CASE WHEN json_valid(o.payload_json) THEN
        json_extract(o.payload_json,'$.generationId')=g.generation_id AND typeof(json_extract(o.payload_json,'$.generationId'))='integer'
        AND json_extract(o.payload_json,'$.phase')=CASE WHEN g.status='downloaded' THEN 'prepare' WHEN g.bucket_index=128 THEN 'finish' ELSE 'apply' END
        AND json_extract(o.payload_json,'$.bucketIndex')=CASE WHEN g.status='downloaded' THEN 0 ELSE g.bucket_index END
        AND typeof(json_extract(o.payload_json,'$.bucketIndex'))='integer'
        AND json_extract(o.payload_json,'$.groupOffset')=CASE WHEN g.status='downloaded' THEN 0 ELSE g.group_offset END
        AND typeof(json_extract(o.payload_json,'$.groupOffset'))='integer'
      ELSE 0 END)` : '';
    const priority=this.activation?`CASE WHEN g.status='applying' THEN 0
      WHEN g.status='prepared' AND g.first_sequence=(SELECT committed_sequence+1 FROM server_feed_state WHERE singleton=1) THEN 1
      WHEN g.status='downloaded' THEN 2 ELSE 3 END` : "CASE g.status WHEN 'applying' THEN 0 WHEN 'downloaded' THEN 1 ELSE 2 END";
    return this.db.prepare(`SELECT g.* FROM server_feed_generations g
      LEFT JOIN server_feed_outbox o ON o.job_key=${currentJobSql('g')}
      WHERE g.retired_at IS NULL AND g.status IN ('downloaded','prepared','applying')
        AND ${this.uncoveredSql('g')}
        AND (g.status<>'prepared' OR NOT EXISTS(SELECT 1 FROM server_feed_state WHERE active_generation IS NOT NULL))
        AND (g.status<>'prepared' OR NOT EXISTS(SELECT 1 FROM server_feed_generations u WHERE ${this.precedingSql('g','u')}))
        AND (o.job_key IS NULL AND ?=0 OR o.status IN ('pending','dispatched')
          AND (o.next_due_at<=? OR o.status='dispatched' AND o.job_key=? ${deliveryPriority}))
      ORDER BY ${priority},
        CASE WHEN g.status='downloaded' THEN g.created_at END,
        CASE WHEN g.status='prepared' THEN g.first_sequence END,
        g.created_at,g.generation_id LIMIT 1`).bind(readyOnly?1:0,at,includeJobKey,...(this.activation?[at]:[])).first();
  }
  getBlockingGeneration(generationId) {
    id(generationId);
    return this.db.prepare(`SELECT u.* FROM server_feed_generations g JOIN server_feed_generations u
      ON ${this.precedingSql('g','u')} WHERE g.generation_id=? AND g.status='prepared'
      ORDER BY u.created_at,u.generation_id LIMIT 1`).bind(generationId).first();
  }
  async storageUsage() {
    const row = await this.db.prepare(`SELECT COUNT(*) AS generations,COALESCE(SUM(compressed_bytes),0) AS compressed_bytes,
      COALESCE(SUM(COALESCE(archive_bytes,0)),0) AS archive_bytes FROM server_feed_generations WHERE retired_at IS NULL`).bind().first();
    const result = {generations: row?.generations, compressedBytes: row?.compressed_bytes, archiveBytes: row?.archive_bytes,
      totalBytes: row?.compressed_bytes + row?.archive_bytes};
    if (!Object.values(result).every(integer)) fail('SERVER_FEED_STORAGE_ACCOUNTING_INVALID');
    return result;
  }
  async guarded(condition, params, statements) {
    const guardId = randomUUID();
    if(this.activation){
      const a=this.activation;
      condition=`(${condition}) AND EXISTS(SELECT 1 FROM feed_catalog_pointer WHERE singleton=1 AND baseline_id=?)
        AND EXISTS(SELECT 1 FROM feed_catalog_baselines b JOIN server_feed_state s ON s.singleton=1
          WHERE b.baseline_id=? AND b.plan_sha256=? AND json_extract(b.checkpoint_json,'$.replaySequence')=s.committed_sequence
          AND s.committed_sequence>=?)
        AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='complete' AND cursor=?)`;
      params=[...params,a.baselineId,a.baselineId,a.planSha256,a.floorSequence,a.receiptKey,a.receiptCursor];
    }
    return this.store.guarded([
      this.db.prepare(`INSERT INTO server_feed_guards(guard_id,allowed) VALUES(?,CASE WHEN ${condition} THEN 1 ELSE 0 END)`).bind(guardId, ...params),
      ...statements,
      this.db.prepare('DELETE FROM server_feed_guards WHERE guard_id=?').bind(guardId)
    ]);
  }
  outboxStatements(entries = []) {
    if (!Array.isArray(entries) || entries.length > 4) fail('SERVER_FEED_OUTBOX_INVALID');
    const statements = [], at = this.at();
    for (const entry of entries) {
      const item = work(entry), guardId = randomUUID();
      statements.push(this.db.prepare(`INSERT INTO server_feed_guards(guard_id,allowed) VALUES(?,CASE WHEN NOT EXISTS(
        SELECT 1 FROM server_feed_outbox WHERE job_key=? AND (kind<>? OR payload_json<>?)) THEN 1 ELSE 0 END)`)
        .bind(guardId, item.jobKey, item.kind, item.payload),
      this.db.prepare(`INSERT OR IGNORE INTO server_feed_outbox(job_key,kind,payload_json,next_due_at,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
        .bind(item.jobKey, item.kind, item.payload, at, at, at),
      this.db.prepare('DELETE FROM server_feed_guards WHERE guard_id=?').bind(guardId));
    }
    return statements;
  }
  async readReceipts(receipts, seed = false) {
    if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > 8
        || new Set(receipts.map(r => r?.taskKey)).size !== receipts.length) fail('SERVER_FEED_RECEIPT_INVALID');
    const result = [];
    for (const receipt of receipts) {
      if (!key(receipt?.taskKey) || !hex(receipt.cursorSha256)) fail('SERVER_FEED_RECEIPT_INVALID');
      const row = await this.db.prepare('SELECT task_key,platform,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(receipt.taskKey).first();
      if (!row || row.platform !== 'all' || row.status !== 'complete' || typeof row.cursor !== 'string'
          || digest(row.cursor) !== receipt.cursorSha256) fail('SERVER_FEED_RECEIPT_UNVERIFIED');
      if (seed && !row.task_key.startsWith('file-changes:')) fail('SERVER_FEED_SEED_INVALID');
      result.push(row);
    }
    return result;
  }
  receiptCondition(rows) {
    return {sql: `NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(
      SELECT 1 FROM automatic_refresh_tasks t WHERE t.task_key=json_extract(r.value,'$.task_key')
      AND t.platform='all' AND t.status='complete' AND t.cursor IS json_extract(r.value,'$.cursor')))`, params: [JSON.stringify(rows)]};
  }
  async seed({sequence, evidenceId, legacyReceipts} = {}) {
    if (sequence !== SEED_SEQUENCE || !key(evidenceId) || legacyReceipts?.length !== 2) fail('SERVER_FEED_SEED_INVALID');
    const rows = await this.readReceipts(legacyReceipts, true), states = rows.map(row => {
      try {return JSON.parse(row.cursor);} catch {fail('SERVER_FEED_SEED_INVALID');}
    });
    for (const [index, state] of states.entries()) {
      try {validateDataset(state.dataset);} catch {fail('SERVER_FEED_SEED_INVALID');}
      const expected = LEGACY_DATASETS[index];
      if (rows[index].task_key !== `file-changes:${expected.databaseSha256}`
          || Object.entries(expected).some(([name,value]) => state.dataset[name] !== value)
          || state.version !== 1 || state.offset !== state.dataset.uniqueLots || state.groupedEvents !== state.dataset.records
          || state.quarantined !== state.dataset.quarantined || state.firstSequence !== state.dataset.firstSequence
          || state.lastSequence !== state.dataset.lastSequence || state.continuityVerified !== false || state.globalCursorEstablished !== false
          || !['updatedGroups','queuedGroups','identityErrors','ignoredEvents','plannedPatches'].every(name => integer(state[name]))
          || state.updatedGroups > state.offset || state.queuedGroups > state.offset || state.identityErrors > state.queuedGroups
          || state.ignoredEvents + state.plannedPatches > state.groupedEvents || !/^(copart|iaai):\d{1,20}$/.test(state.lastIdentity || '')) fail('SERVER_FEED_SEED_INVALID');
      time(state.observedAt, this.store.now());
    }
    if (states[1].dataset.firstSequence !== states[0].dataset.lastSequence + 1 || states[1].dataset.lastSequence !== sequence) fail('SERVER_FEED_SEED_INVALID');
    const evidence = JSON.stringify({sequence, evidenceId, legacyReceipts}), existing = await this.getState();
    if (existing) {
      if (existing.seed_evidence_json !== evidence) fail('SERVER_FEED_SEED_CONFLICT');
      return {alreadyApplied: true, state: existing};
    }
    const proof = this.receiptCondition(rows);
    await this.guarded(`NOT EXISTS(SELECT 1 FROM server_feed_state) AND ${proof.sql}`, proof.params,
      [this.db.prepare('INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,?,?,?)').bind(sequence, evidence, this.at())]);
    return {alreadyApplied: false, state: await this.getState()};
  }
  async register({generationId, sha256, rawKey, compressedBytes, observedAt, outbox = []} = {}) {
    id(generationId); if (!hex(sha256) || !key(rawKey) || !integer(compressedBytes)) fail('SERVER_FEED_GENERATION_INVALID'); time(observedAt, this.store.now());
    const current = await this.getGeneration(generationId);
    if (current) {
      if (current.sha256 !== sha256 || current.raw_key !== rawKey || current.compressed_bytes !== compressedBytes || current.observed_at !== observedAt) fail('SERVER_FEED_GENERATION_CONFLICT');
      return {alreadyApplied: true, generation: current};
    }
    const at = this.at();
    await this.guarded('NOT EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? OR sha256=?)', [generationId, sha256],
      [this.db.prepare(`INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,observed_at,status,created_at,updated_at) VALUES(?,?,?,?,?,'downloaded',?,?)`)
        .bind(generationId, sha256, rawKey, compressedBytes, observedAt, at, at), ...this.outboxStatements(outbox)]);
    return {alreadyApplied: false, generation: await this.getGeneration(generationId)};
  }
  async prepare({generationId, manifestKey, manifestSha256, archiveBytes, firstSequence, lastSequence, bucketGroups, outbox = []} = {}) {
    id(generationId);
    if (!key(manifestKey) || !hex(manifestSha256) || !integer(archiveBytes) || !integer(firstSequence) || firstSequence < 1 || !integer(lastSequence) || lastSequence < firstSequence
        || !Array.isArray(bucketGroups) || bucketGroups.length !== BUCKETS || bucketGroups.some(n => !integer(n))
        || !Number.isSafeInteger(bucketGroups.reduce((a,b) => a+b,0)) || bucketGroups.reduce((a,b) => a+b,0) < 1) fail('SERVER_FEED_MANIFEST_INVALID');
    const row = await this.getGeneration(generationId), counts = JSON.stringify(bucketGroups);
    if (!row) fail('SERVER_FEED_GENERATION_MISSING');
    if (row.manifest_sha256 !== null) {
      if (row.manifest_key !== manifestKey || row.manifest_sha256 !== manifestSha256 || row.archive_bytes !== archiveBytes || row.first_sequence !== firstSequence
          || row.last_sequence !== lastSequence || row.bucket_groups_json !== counts) fail('SERVER_FEED_MANIFEST_CONFLICT');
      return {alreadyApplied: true, generation: row};
    }
    if (row.status !== 'downloaded') fail('SERVER_FEED_STATE_INVALID');
    await this.guarded("EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND status='downloaded' AND manifest_sha256 IS NULL)", [generationId],
      [this.db.prepare(`UPDATE server_feed_generations SET status='prepared',manifest_key=?,manifest_sha256=?,archive_bytes=?,first_sequence=?,last_sequence=?,bucket_groups_json=?,updated_at=? WHERE generation_id=?`)
        .bind(manifestKey, manifestSha256, archiveBytes, firstSequence, lastSequence, counts, this.at(), generationId), ...this.outboxStatements(outbox)]);
    return {alreadyApplied: false, generation: await this.getGeneration(generationId)};
  }
  async completeEmpty({generationId, manifestKey, manifestSha256, archiveBytes, manifest} = {}) {
    id(generationId);
    if (!key(manifestKey) || !hex(manifestSha256) || !integer(archiveBytes)
        || !manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('SERVER_FEED_EMPTY_MANIFEST_INVALID');
    let encoded, contentEncoded;
    try {const {sha256, ...content} = manifest; encoded = JSON.stringify(manifest) + '\n'; contentEncoded = JSON.stringify(content) + '\n';}
    catch {fail('SERVER_FEED_EMPTY_MANIFEST_INVALID');}
    if (Buffer.byteLength(encoded) > 1024 * 1024 || archiveBytes < Buffer.byteLength(encoded)
        || digest(encoded) !== manifestSha256 || !hex(manifest.sha256) || digest(contentEncoded) !== manifest.sha256
        || manifest.version !== 1 || manifest.kind !== 'apibara-feed-archive' || manifest.state !== 'ready'
        || !key(manifest.prefix) || manifest.prefix.length > 160 || !hex(manifest.rawSha256) || !key(manifest.rawKey)
        || manifest.bucketCount !== BUCKETS || !integer(manifest.compressedBytes) || manifest.compressedBytes < 1
        || !['records','quarantined','uniqueLots','decodedBytes'].every(name => manifest[name] === 0)
        || !['firstSequence','lastSequence','firstRecordedAt','lastRecordedAt'].every(name => manifest[name] === null)
        || manifest.databaseApplied !== false || manifest.continuityVerified !== false
        || !Array.isArray(manifest.buckets) || manifest.buckets.length !== BUCKETS) fail('SERVER_FEED_EMPTY_MANIFEST_INVALID');
    time(manifest.observedAt, this.store.now());
    const root = `${manifest.prefix}/${manifest.rawSha256}/v1-b${BUCKETS}`, emptyHash = digest('');
    if (manifestKey !== `${root}/manifest.json` || manifest.buckets.some((bucket, index) => !bucket || bucket.index !== index
        || !['records','quarantined','uniqueLots','decodedBytes','chunkCount'].every(name => bucket[name] === 0)
        || bucket.firstSequence !== null || bucket.lastSequence !== null || bucket.bucketSha256 !== emptyHash
        || !hex(bucket.manifestSha256) || bucket.manifestKey !== `${root}/buckets/${index}/manifest-${bucket.manifestSha256}.json`)) fail('SERVER_FEED_EMPTY_MANIFEST_INVALID');
    const row = await this.getGeneration(generationId), state = await this.getState(), counts = JSON.stringify(Array(BUCKETS).fill(0));
    if (!row || !state) fail('SERVER_FEED_STATE_INVALID');
    if (row.sha256 !== manifest.rawSha256 || row.raw_key !== manifest.rawKey || row.compressed_bytes !== manifest.compressedBytes
        || row.observed_at !== manifest.observedAt) fail('SERVER_FEED_MANIFEST_CONFLICT');
    if (row.status === 'complete') {
      if (row.manifest_key !== manifestKey || row.manifest_sha256 !== manifestSha256 || row.archive_bytes !== archiveBytes
          || row.first_sequence !== null || row.last_sequence !== null || row.bucket_groups_json !== counts
          || row.bucket_index !== BUCKETS || row.group_offset !== 0) fail('SERVER_FEED_MANIFEST_CONFLICT');
      return {alreadyApplied: true, generation: row, state};
    }
    if (row.status !== 'downloaded' || row.manifest_sha256 !== null || state.active_generation !== null) fail('SERVER_FEED_STATE_INVALID');
    await this.guarded(`EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND active_generation IS NULL AND committed_sequence=?)
      AND EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND status='downloaded' AND manifest_sha256 IS NULL
        AND sha256=? AND raw_key=? AND compressed_bytes=? AND observed_at=?)`,
      [state.committed_sequence, generationId, row.sha256, row.raw_key, row.compressed_bytes, row.observed_at], [
        this.db.prepare(`UPDATE server_feed_generations SET status='complete',manifest_key=?,manifest_sha256=?,archive_bytes=?,
          first_sequence=NULL,last_sequence=NULL,bucket_groups_json=?,bucket_index=128,group_offset=0,updated_at=? WHERE generation_id=?`)
          .bind(manifestKey, manifestSha256, archiveBytes, counts, this.at(), generationId)
      ]);
    // A valid empty archive has no sequence evidence. Even the server cursor's
    // updated_at stays unchanged; processing completion is not market freshness.
    return {alreadyApplied: false, generation: await this.getGeneration(generationId), state: await this.getState()};
  }
  async start(generationId, outbox = []) {
    const row = await this.getGeneration(generationId), state = await this.getState();
    if (!row || !state) fail('SERVER_FEED_STATE_INVALID');
    if (row.status === 'complete' || row.status === 'applying' && state.active_generation === generationId) return {alreadyApplied: true, generation: row};
    if (row.status !== 'prepared' || state.active_generation !== null || row.first_sequence !== state.committed_sequence + 1) fail('SERVER_FEED_CONTINUITY_GAP');
    const preceding=await this.getBlockingGeneration(generationId);if(preceding)fail(preceding.first_sequence===null?'SERVER_FEED_UNKNOWN_ARCHIVE_BLOCKED':'SERVER_FEED_PRECEDING_ARCHIVE_BLOCKED');
    await this.guarded(`EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND active_generation IS NULL AND committed_sequence=?)
      AND EXISTS(SELECT 1 FROM server_feed_generations g WHERE generation_id=? AND status='prepared' AND first_sequence=? AND manifest_sha256=?
        AND NOT EXISTS(SELECT 1 FROM server_feed_generations u WHERE ${this.precedingSql('g','u')}))`,
      [state.committed_sequence, generationId, state.committed_sequence + 1, row.manifest_sha256], [
        this.db.prepare("UPDATE server_feed_generations SET status='applying',updated_at=? WHERE generation_id=?").bind(this.at(), generationId),
        this.db.prepare('UPDATE server_feed_state SET active_generation=?,updated_at=? WHERE singleton=1').bind(generationId, this.at()), ...this.outboxStatements(outbox)]);
    return {alreadyApplied: false, generation: await this.getGeneration(generationId)};
  }
  async checkpoint({generationId, bucketIndex, groupOffset, nextOffset, receipts = [], outbox = [], completeJobKey = null} = {}) {
    id(generationId);
    if (!Array.isArray(receipts) || !integer(bucketIndex) || bucketIndex >= BUCKETS || !integer(groupOffset) || !integer(nextOffset) || nextOffset < groupOffset
        || nextOffset - groupOffset > SERVER_MAX_GROUPS) fail('SERVER_FEED_CHECKPOINT_INVALID');
    if (completeJobKey !== null && completeJobKey !== `feed:${generationId}:apply:${bucketIndex}:${groupOffset}`) {
      fail('SERVER_FEED_OUTBOX_INVALID');
    }
    const jobGuard = completeJobKey === null ? '' : `AND EXISTS(SELECT 1 FROM server_feed_outbox
      WHERE job_key=? AND kind='feed' AND status IN ('pending','dispatched'))`;
    const row = await this.getGeneration(generationId);
    if (!row?.bucket_groups_json) fail('SERVER_FEED_STATE_INVALID');
    let counts; try {counts = JSON.parse(row.bucket_groups_json);} catch {fail('SERVER_FEED_STATE_INVALID');}
    const empty = counts[bucketIndex] === 0;
    if (empty ? groupOffset !== 0 || nextOffset !== 0 || receipts.length !== 0
      : nextOffset <= groupOffset || nextOffset > counts[bucketIndex] || receipts.length < 1) fail('SERVER_FEED_CHECKPOINT_INVALID');
    const payload = {generationId, manifestSha256: row.manifest_sha256, bucketIndex, groupOffset, nextOffset, receipts};
    const receiptKey = `${generationId}:${bucketIndex}:${groupOffset}`, sha256 = hash(payload);
    const previous = await this.db.prepare('SELECT * FROM server_feed_receipts WHERE receipt_key=?').bind(receiptKey).first();
    if (previous) {
      if (previous.receipt_sha256 !== sha256) fail('SERVER_FEED_CHECKPOINT_CONFLICT');
      return {alreadyApplied: true, generation: row};
    }
    if (row.status !== 'applying' || row.bucket_index !== bucketIndex || row.group_offset !== groupOffset) fail('SERVER_FEED_CHECKPOINT_GAP');
    const rows = empty ? [] : await this.readReceipts(receipts), proof = this.receiptCondition(rows), bucketDone = nextOffset === counts[bucketIndex];
    await this.guarded(`EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND active_generation=?)
      AND EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND status='applying' AND bucket_index=? AND group_offset=? AND manifest_sha256=?)
      AND NOT EXISTS(SELECT 1 FROM server_feed_receipts WHERE receipt_key=?) AND ${proof.sql} ${jobGuard}`,
      [generationId, generationId, bucketIndex, groupOffset, row.manifest_sha256, receiptKey, ...proof.params,
        ...(completeJobKey === null ? [] : [completeJobKey])], [
        this.db.prepare('INSERT INTO server_feed_receipts(receipt_key,generation_id,receipt_sha256,payload_json,committed_at) VALUES(?,?,?,?,?)')
          .bind(receiptKey, generationId, sha256, JSON.stringify(payload), this.at()),
        this.db.prepare('UPDATE server_feed_generations SET bucket_index=?,group_offset=?,updated_at=? WHERE generation_id=?')
          .bind(bucketDone ? bucketIndex + 1 : bucketIndex, bucketDone ? 0 : nextOffset, this.at(), generationId),
        ...this.outboxStatements(outbox),
        ...(completeJobKey === null ? [] : [this.db.prepare(
          "UPDATE server_feed_outbox SET status='complete',updated_at=? WHERE job_key=?"
        ).bind(this.at(), completeJobKey)])]);
    return {alreadyApplied: false, generation: await this.getGeneration(generationId)};
  }
  async finish(generationId, outbox = []) {
    const row = await this.getGeneration(generationId), state = await this.getState();
    if (!row || !state) fail('SERVER_FEED_STATE_INVALID');
    if (row.status === 'complete') return {alreadyApplied: true, state};
    if (row.status !== 'applying' || row.bucket_index !== BUCKETS || row.group_offset !== 0
        || state.active_generation !== generationId || row.first_sequence !== state.committed_sequence + 1) fail('SERVER_FEED_INCOMPLETE');
    const membershipStatements=this.membership?(await this.membership.deltaStatements({baselineId:this.activation.baselineId,
      after:state.committed_sequence,through:row.last_sequence,batchSha256:hash({kind:'server-file-finish',generationId,
        rawSha256:row.sha256,manifestSha256:row.manifest_sha256,after:state.committed_sequence,through:row.last_sequence}),changes:[],unresolvedCount:0})).statements:[];
    await this.guarded(`EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND status='applying' AND bucket_index=128 AND group_offset=0)
      AND EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND active_generation=? AND committed_sequence=?)`,
      [generationId, generationId, state.committed_sequence], [
        ...membershipStatements,
        this.db.prepare("UPDATE server_feed_generations SET status='complete',updated_at=? WHERE generation_id=?").bind(this.at(), generationId),
        this.db.prepare('UPDATE server_feed_state SET committed_sequence=?,active_generation=NULL,updated_at=? WHERE singleton=1').bind(row.last_sequence, this.at()),
        ...this.outboxStatements(outbox)]);
    return {alreadyApplied: false, state: await this.getState()};
  }
  async block(generationId, errorCode) {
    id(generationId); if (!code(errorCode)) fail('SERVER_FEED_ERROR_CODE_INVALID');
    await this.guarded("EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND status<>'complete')", [generationId],
      [this.db.prepare("UPDATE server_feed_generations SET status='blocked',last_error_code=?,updated_at=? WHERE generation_id=?").bind(errorCode, this.at(), generationId)]);
  }
  async enqueue(entry) {await this.guarded('1=1', [], this.outboxStatements([entry]));}
  async pendingOutbox(limit = 25) {
    if (!integer(limit) || limit < 1 || limit > 100) fail('SERVER_FEED_OUTBOX_INVALID');
    const result = await this.db.prepare("SELECT * FROM server_feed_outbox WHERE status IN ('pending','dispatched') AND next_due_at<=? ORDER BY next_due_at,job_key LIMIT ?").bind(this.at(), limit).all();
    return result.results;
  }
  async markDispatched(jobKey, delayMs = 300000) {
    if (!key(jobKey) || !integer(delayMs) || delayMs < 1000 || delayMs > 86400000) fail('SERVER_FEED_OUTBOX_INVALID');
    await this.guarded("EXISTS(SELECT 1 FROM server_feed_outbox WHERE job_key=? AND status IN ('pending','dispatched'))", [jobKey],
      [this.db.prepare("UPDATE server_feed_outbox SET status='dispatched',next_due_at=?,updated_at=? WHERE job_key=?").bind(iso(this.store.now() + delayMs), this.at(), jobKey)]);
  }
  async retry(jobKey, errorCode, delayMs = 60000, maxAttempts = 8) {
    if (!key(jobKey) || !code(errorCode) || !integer(delayMs) || delayMs < 1000 || delayMs > 86400000
        || (maxAttempts===null?!['UPSTREAM','TIMEOUT'].includes(errorCode):!integer(maxAttempts) || maxAttempts < 1 || maxAttempts > 20)) fail('SERVER_FEED_OUTBOX_INVALID');
    const prior=await this.db.prepare('SELECT * FROM server_feed_outbox WHERE job_key=?').bind(jobKey).first();
    if(!prior||!['pending','dispatched'].includes(prior.status))fail('SERVER_FEED_OUTBOX_INVALID');
    const attempts=prior.attempts+1,blocked=maxAttempts!==null&&attempts>=maxAttempts,p=feedJobIdentity(prior),at=this.at();
    const statements=[maxAttempts===null?this.db.prepare("UPDATE server_feed_outbox SET attempts=attempts+1,status='pending',last_error_code=?,next_due_at=?,updated_at=? WHERE job_key=?").bind(errorCode,iso(this.store.now()+delayMs),at,jobKey):this.db.prepare(`UPDATE server_feed_outbox SET attempts=attempts+1,status=CASE WHEN attempts+1>=? THEN 'blocked' ELSE 'pending' END,
      last_error_code=?,next_due_at=?,updated_at=? WHERE job_key=?`).bind(maxAttempts,errorCode,iso(this.store.now()+delayMs),at,jobKey)];
    if(blocked&&p)statements.push(this.db.prepare(`UPDATE server_feed_generations AS g SET status='blocked',last_error_code=?,updated_at=?
      WHERE generation_id=? AND status IN ('downloaded','prepared','applying') AND ${currentJobSql('g')}=?
      AND EXISTS(SELECT 1 FROM server_feed_outbox WHERE job_key=? AND kind='feed' AND status='blocked' AND attempts=? AND payload_json=?)`)
      .bind(errorCode,at,p.generationId,jobKey,jobKey,attempts,prior.payload_json));
    await this.guarded(`EXISTS(SELECT 1 FROM server_feed_outbox WHERE job_key=? AND (status,attempts,payload_json) IS (?,?,?))`,
      [jobKey,prior.status,prior.attempts,prior.payload_json],statements);
    const generation=blocked&&p?await this.getGeneration(p.generationId):null;
    return{attempts,blocked,generationBlocked:generation?.status==='blocked',generationId:p?.generationId||null};
  }

  async completeOutbox(jobKey) {
    if (!key(jobKey)) fail('SERVER_FEED_OUTBOX_INVALID');
    await this.guarded('EXISTS(SELECT 1 FROM server_feed_outbox WHERE job_key=?)', [jobKey],
      [this.db.prepare("UPDATE server_feed_outbox SET status='complete',updated_at=? WHERE job_key=?").bind(this.at(), jobKey)]);
  }
  async completeCoveredOutbox(jobKey,generation) {
    if(!key(jobKey)||!this.coveredByBaseline(generation))fail('SERVER_FEED_MEMBERSHIP_INVALID');
    const job=await this.db.prepare('SELECT * FROM server_feed_outbox WHERE job_key=?').bind(jobKey).first();
    if(feedJobIdentity(job)?.generationId!==generation.generation_id||!['pending','dispatched'].includes(job.status))fail('SERVER_FEED_OUTBOX_INVALID');
    await this.guarded(`EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND sha256=? AND first_sequence=? AND last_sequence=? AND last_sequence<=?)
      AND EXISTS(SELECT 1 FROM server_feed_outbox WHERE job_key=? AND payload_json=? AND status IN ('pending','dispatched'))`,
      [generation.generation_id,generation.sha256,generation.first_sequence,generation.last_sequence,this.activation.floorSequence,jobKey,job.payload_json],
      [this.db.prepare("UPDATE server_feed_outbox SET status='complete',updated_at=? WHERE job_key=?").bind(this.at(),jobKey)]);
  }
  async configureD1Recovery(env={}){
    this.d1RecoveryLoaded=false;this.d1Recovery=new D1RecoveryBudget({db:this.db,store:this.store});
    const policy=await this.d1Recovery.load(env);this.d1RecoveryLoaded=true;return policy||{enabled:false};
  }
  async recoveryBudget(){if(!this.d1RecoveryLoaded)await this.configureD1Recovery({});return this.d1Recovery;}
  configureFlexibleBudget(env={}) {
    this.flexibleBudget=false;
    const mode=env.REXBID_FEED_D1_BUDGET_MODE;
    if(mode===undefined||mode==='daily')return;
    if(mode!=='rolling-31d-v1'||this.dailyWrites!==MAX_DAILY_WRITES||this.dailyReads!==MAX_DAILY_READS
      ||this.readAllowance||this.d1Recovery?.status().enabled
      ||env.REXBID_FEED_D1_RECOVERY_ID!==undefined)fail('SERVER_FEED_FLEX_BUDGET_CONFIG');
    this.flexibleBudget=true;
  }
  async flexibleBudgetUsage(day=this.at().slice(0,10)) {
    if(!this.flexibleBudget)return null;
    const firstDay=iso(Date.parse(day+'T00:00:00Z')-(FLEX_BUDGET_DAYS-1)*86400000).slice(0,10);
    const {writes,reads}=await this.db.prepare(FLEX_BUDGET_SQL).bind(firstDay,day).first()||{};
    if(!integer(writes)||!integer(reads))fail('SERVER_FEED_FLEX_BUDGET_INVALID');
    return {firstDay,day,writes,reads,writeLimit:FLEX_BUDGET_WRITES,
      readLimit:MAX_DAILY_READS*FLEX_BUDGET_DAYS,burstWrites:MAX_DAILY_WRITES*(FLEX_BUDGET_BURST-1),
      burstReads:MAX_DAILY_READS*(FLEX_BUDGET_BURST-1)};
  }
  d1RecoveryPolicy(){
    const policy=this.d1Recovery?.status()||{enabled:false};
    return policy.id?{...policy,baseDailyWriteLimit:this.dailyWrites,effectiveDailyWriteLimit:this.dailyWrites+policy.dayCreditWrites,
      effectiveDailyReadLimit:this.readPolicy().effectiveReadLimit}:policy;
  }
  readPolicy(){
    const day=this.at().slice(0,10),active=this.readAllowance?.day===day;
    const recovery=this.d1Recovery?.status(),credit=recovery?.day===day?recovery.dayCreditReads:0;
    return{day,baseReadLimit:this.dailyReads,effectiveReadLimit:(active?this.readAllowance.effectiveReadLimit:this.dailyReads)+credit,allowanceActive:active,
      ...(recovery?.id?{d1RecoveryCreditReads:credit}:{})};
  }
  async applyReadAllowance(env){
    this.readAllowance=null;const policy=readAllowancePolicy(env,this.store.now());
    if(!policy)return this.readPolicy();
    if(this.dailyReads!==MAX_DAILY_READS)fail('SERVER_FEED_READ_ALLOWANCE_POLICY_CONFLICT');
    const taskKey=ALLOWANCE_PREFIX+policy.day;
    const task=await this.db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').bind(taskKey).first();
    const budget=await this.db.prepare('SELECT * FROM server_feed_daily_budgets WHERE day_key=?').bind(policy.day).first();
    if(budget&&budget.read_limit!==MAX_DAILY_READS)fail('SERVER_FEED_READ_ALLOWANCE_POLICY_CONFLICT');
    const fields=['write_limit','read_limit','reserved_writes','reserved_reads','consumed_writes','consumed_reads','updated_at'];
    let cursor;
    if(task){
      let receipt;try{receipt=JSON.parse(task.cursor);}catch{fail('SERVER_FEED_READ_ALLOWANCE_RECEIPT_CONFLICT');}
      const {sha256,...payload}=receipt||{};
      if(task.platform!=='all'||task.listing_id!==null||task.status!=='complete'||!budget||!hex(sha256)||sha256!==hash(payload)
        ||Object.keys(payload).sort().join(',')!=='appliedAt,baseReadLimit,before,day,effectiveReadLimit,version,writeLimit'
        ||payload.version!==1||payload.day!==policy.day||payload.baseReadLimit!==MAX_DAILY_READS||payload.effectiveReadLimit!==policy.effectiveReadLimit
        ||payload.writeLimit!==budget.write_limit||!integer(payload.writeLimit)||payload.writeLimit<1||payload.writeLimit>MAX_DAILY_WRITES
        ||!Number.isFinite(Date.parse(payload.appliedAt))||payload.appliedAt.slice(0,10)!==policy.day)fail('SERVER_FEED_READ_ALLOWANCE_RECEIPT_CONFLICT');
      cursor=task.cursor;
    }else{
      const before=budget?Object.fromEntries(fields.map(field=>[field,budget[field]])):null;
      const payload={version:1,...policy,writeLimit:budget?.write_limit??this.dailyWrites,appliedAt:this.at(),before};
      cursor=JSON.stringify({...payload,sha256:hash(payload)});
      const condition=`date('now')=? AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?) AND
        (?=0 AND NOT EXISTS(SELECT 1 FROM server_feed_daily_budgets WHERE day_key=?) OR EXISTS(
          SELECT 1 FROM server_feed_daily_budgets WHERE day_key=? AND (${fields.join(',')}) IS (${fields.map(()=>'?').join(',')})))`;
      await this.guarded(condition,[policy.day,taskKey,budget?1:0,policy.day,policy.day,...fields.map(field=>budget?.[field]??null)],[
        this.db.prepare(`INSERT INTO server_feed_daily_budgets(day_key,write_limit,read_limit,updated_at) VALUES(?,?,?,?) ON CONFLICT(day_key) DO NOTHING`)
          .bind(policy.day,this.dailyWrites,this.dailyReads,this.at()),
        this.db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
          VALUES(?,'all',?,?,?,?,'complete')`).bind(taskKey,cursor,this.at(),this.at(),this.at())]);
      const saved=await this.db.prepare('SELECT platform,listing_id,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(taskKey).first();
      if(saved?.platform!=='all'||saved.listing_id!==null||saved.status!=='complete'||saved.cursor!==cursor)fail('SERVER_FEED_READ_ALLOWANCE_RECEIPT_CONFLICT');
    }
    this.readAllowance={...policy,taskKey,cursor};return this.readPolicy();
  }
  async reserveBudget(reservationKey, {rowsWritten, rowsRead, recoveryScope = null} = {}) {
    if (!key(reservationKey) || !integer(rowsWritten) || !integer(rowsRead) || rowsWritten > this.dailyWrites || rowsRead > this.dailyReads
        || rowsWritten + rowsRead === 0) fail('SERVER_FEED_BUDGET_INVALID');
    const prior = await this.db.prepare('SELECT * FROM server_feed_reservations WHERE reservation_key=?').bind(reservationKey).first();
    if (prior) {
      if (prior.reserved_writes !== rowsWritten || prior.reserved_reads !== rowsRead) fail('SERVER_FEED_RESERVATION_CONFLICT');
      const helper=await this.recoveryBudget();if(await helper.binding(prior))await helper.context(prior.day_key);
      return {alreadyReserved: true, reservation: prior};
    }
    const at = this.at(), day = at.slice(0,10), guardId = randomUUID();
    const allowance=this.readAllowance?.day===day?this.readAllowance:null,extra=allowance?allowance.effectiveReadLimit-MAX_DAILY_READS:0;
    if(allowance){
      const audit=await this.db.prepare('SELECT platform,listing_id,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(allowance.taskKey).first();
      if(audit?.platform!=='all'||audit.listing_id!==null||audit.status!=='complete'||audit.cursor!==allowance.cursor)fail('SERVER_FEED_READ_ALLOWANCE_RECEIPT_CONFLICT');
    }
    const helper=await this.recoveryBudget();
    const credit=await helper.prepareReservation({reservationKey,rowsWritten,rowsRead,day,at,scope:recoveryScope,dailyWrites:this.dailyWrites,dailyReads:this.dailyReads});
    const flex=await this.flexibleBudgetUsage(day);
    if(flex&&(allowance||credit?.credited))fail('SERVER_FEED_FLEX_BUDGET_CONFIG');
    const dayWrites=credit?.dayWrites||0,dayReads=credit?.dayReads||0;
    const budget = await this.db.prepare('SELECT * FROM server_feed_daily_budgets WHERE day_key=?').bind(day).first();
    // An explicitly lower persisted daily cap still applies. Flexible mode
    // shares a 31-day allowance; it never stacks with credits.
    const burstWrites=flex&&(!budget||budget.write_limit===MAX_DAILY_WRITES)&&(!budget||budget.read_limit===MAX_DAILY_READS)?flex.burstWrites:0;
    const burstReads=burstWrites?flex.burstReads:0;
    if(credit?.credited&&budget&&(budget.write_limit!==MAX_DAILY_WRITES||budget.read_limit!==MAX_DAILY_READS))fail('SERVER_FEED_D1_RECOVERY_POLICY_CONFLICT');
    if(allowance&&budget?.read_limit!==MAX_DAILY_READS)fail('SERVER_FEED_READ_ALLOWANCE_POLICY_CONFLICT');
    if(flex&&(flex.writes+rowsWritten>flex.writeLimit||flex.reads+rowsRead>flex.readLimit))fail('SERVER_FEED_ROLLING_BUDGET_STOP');
    if (budget && (budget.consumed_writes + budget.reserved_writes + rowsWritten > Math.min(budget.write_limit, this.dailyWrites)+dayWrites+burstWrites
        || budget.consumed_reads + budget.reserved_reads + rowsRead > Math.min(budget.read_limit, this.dailyReads)+extra+dayReads+burstReads)) fail('SERVER_FEED_DAILY_BUDGET_STOP');
    // A budget stop is a failed atomic guard: initialization and reservation both
    // roll back. Retries never refund a possibly committed/unknown operation.
    await this.guarded(`NOT EXISTS(SELECT 1 FROM server_feed_reservations WHERE reservation_key=?) ${allowance?`AND date('now')=? AND EXISTS(
      SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='complete' AND cursor=?
        AND json_extract(cursor,'$.day')=? AND json_extract(cursor,'$.baseReadLimit')=50000000 AND json_extract(cursor,'$.effectiveReadLimit')=?)`:''} ${credit?'AND ('+credit.condition+')':''} ${flex?"AND date('now')=?":''}`,
      [reservationKey,...(allowance?[day,allowance.taskKey,allowance.cursor,day,allowance.effectiveReadLimit]:[]),...(credit?.params||[]),...(flex?[day]:[])], [
      this.db.prepare(`INSERT INTO server_feed_daily_budgets(day_key,write_limit,read_limit,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(day_key) DO UPDATE SET write_limit=MIN(write_limit,excluded.write_limit),read_limit=MIN(read_limit,excluded.read_limit)`)
        .bind(day, this.dailyWrites, this.dailyReads, at),
      ...(credit?.statements||[]),
      this.db.prepare(`INSERT INTO server_feed_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM server_feed_daily_budgets WHERE day_key=?
        AND consumed_writes+reserved_writes+?<=write_limit+${credit?'COALESCE((SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?),0)':'0'}${burstWrites?'+CASE WHEN write_limit=1000000 AND read_limit=50000000 THEN ? ELSE 0 END':''}
        AND consumed_reads+reserved_reads+?<=read_limit+?+${credit?'COALESCE((SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?),0)':'0'}${burstReads?'+CASE WHEN write_limit=1000000 AND read_limit=50000000 THEN ? ELSE 0 END':''}
        AND (?=0 OR read_limit=50000000) ${credit?.credited?'AND write_limit=1000000 AND read_limit=50000000':''})
        ${flex?`AND EXISTS(SELECT 1 FROM (${FLEX_BUDGET_SQL}) WHERE writes+?<=? AND reads+?<=?)`:''} THEN 1 ELSE 0 END)`)
        .bind(guardId,day,rowsWritten,...(credit?[credit.ctx.keys[2]]:[]),...(burstWrites?[burstWrites]:[]),
          rowsRead,extra,...(credit?[credit.ctx.keys[3]]:[]),...(burstReads?[burstReads]:[]),extra,
          ...(flex?[flex.firstDay,day,rowsWritten,flex.writeLimit,rowsRead,flex.readLimit]:[])),
      this.db.prepare("INSERT INTO server_feed_reservations(reservation_key,day_key,reserved_writes,reserved_reads,status,created_at) VALUES(?,?,?,?,'reserved',?)")
        .bind(reservationKey, day, rowsWritten, rowsRead, at),
      this.db.prepare('UPDATE server_feed_daily_budgets SET reserved_writes=reserved_writes+?,reserved_reads=reserved_reads+?,updated_at=? WHERE day_key=?')
        .bind(rowsWritten, rowsRead, at, day),
      this.db.prepare('DELETE FROM server_feed_guards WHERE guard_id=?').bind(guardId)]);
    credit?.after();
    return {alreadyReserved: false, reservation: await this.db.prepare('SELECT * FROM server_feed_reservations WHERE reservation_key=?').bind(reservationKey).first()};
  }
  async settleBudget(reservationKey, usage) {
    if (!key(reservationKey)) fail('SERVER_FEED_BUDGET_INVALID');
    if (usage == null) return {settled: false, reason: 'unknown_usage_keeps_reservation'};
    const {rowsWritten, rowsRead} = usage;
    if (!integer(rowsWritten) || !integer(rowsRead) || rowsWritten > 1e12 || rowsRead > 1e12) fail('SERVER_FEED_BUDGET_INVALID');
    const prior = await this.db.prepare('SELECT * FROM server_feed_reservations WHERE reservation_key=?').bind(reservationKey).first();
    if (!prior) fail('SERVER_FEED_RESERVATION_MISSING');
    const helper=await this.recoveryBudget(),credit=await helper.prepareSettlement(prior,usage);
    if (prior.status === 'settled') {
      if (prior.actual_writes !== rowsWritten || prior.actual_reads !== rowsRead) fail('SERVER_FEED_SETTLEMENT_CONFLICT');
      return {settled: true, alreadySettled: true};
    }
    // Actual overrun is recorded, never clipped to the estimate: subsequent
    // reservations stop. Include control/index overhead in caller's totals.
    await this.guarded("EXISTS(SELECT 1 FROM server_feed_reservations WHERE reservation_key=? AND status='reserved')"+(credit?' AND ('+credit.condition+')':''), [reservationKey,...(credit?.params||[])], [
      this.db.prepare(`UPDATE server_feed_daily_budgets SET reserved_writes=reserved_writes-?,reserved_reads=reserved_reads-?,
        consumed_writes=consumed_writes+?,consumed_reads=consumed_reads+?,updated_at=? WHERE day_key=?`)
        .bind(prior.reserved_writes, prior.reserved_reads, rowsWritten, rowsRead, this.at(), prior.day_key),
      this.db.prepare("UPDATE server_feed_reservations SET status='settled',actual_writes=?,actual_reads=?,settled_at=? WHERE reservation_key=?")
        .bind(rowsWritten, rowsRead, this.at(), reservationKey),...(credit?.statements||[])]);
    credit?.after();
    return {settled: true, alreadySettled: false};
  }
}
module.exports = {ServerFeedState, BUCKETS, SEED_SEQUENCE, LEGACY_DATASETS, MAX_DAILY_WRITES, MAX_DAILY_READS, MAX_ONE_DAY_READS, readAllowancePolicy, digest};
