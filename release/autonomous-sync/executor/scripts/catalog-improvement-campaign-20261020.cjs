'use strict';

// Operator primitives only. The caller owns transport, D1 identity/backup checks,
// and excluding concurrent writers (including Cron). No credentials or network.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {parseUsage, POLICY} = require('../sync/automatic-refresh.cjs');
const {prepareObservation} = require('../sync/publication-refresh.cjs');
const {exactLotRecoveryOperation} = require('./catalog-exact-lot-request-20261020.cjs');
const {D1SyncRepository, knownObservationStatements} = require('../sync/d1-repository.js');
const {
  atomicJson, safeCode, detailSpec, checkDetail, historyPartition, persistHistory
} = require('./catalog-refresh-campaign.cjs');

const TARGET_IDS = new Set([
  'c8a30088-70af-43a6-9a7f-c4018279d37d',
  'acb3cb8e-69a2-459f-8a46-0f2f5b9004be'
]);
const ITEM_ERRORS = new Set([
  'CATALOG_DETAIL_IDENTITY_MISMATCH', 'CATALOG_HISTORY_IDENTITY_MISMATCH',
  'CATALOG_HISTORY_VIN_UNAVAILABLE', 'CATALOG_HISTORY_SHAPE_INVALID',
  'CATALOG_HISTORY_EVENT_INCOMPLETE', 'CATALOG_HISTORY_DUPLICATE_EVENT',
  'CATALOG_HISTORY_AMBIGUOUS_LOT', 'CANONICAL_IDENTITY_INVALID',
  'NEGATIVE_PROVIDER_PRICE', 'SOURCE_VERSION_TIME_INVALID',
  'DETAIL_TARGET_MISMATCH', 'AMBIGUOUS_PLATFORM_LOT', 'KNOWN_TARGET_CHANGED',
  'PLATFORM_LOT_VIN_MISMATCH', 'IMPROVEMENT_RECORD_INVALID'
]);
const digest = value => createHash('sha256').update(
  typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)
).digest('hex');
const iso = value => new Date(value).toISOString();

function durableAppend(file, value) {
  const fd = fs.openSync(file, 'a');
  try { fs.writeSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function readJournal(file) {
  if (!fs.existsSync(file)) return [];
  // An incomplete line is an uncertain durable reservation, never disposable.
  const text = fs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) throw Error('IMPROVEMENT_LEDGER_TRUNCATED');
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function validateEnvelope(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)
      || response.ok === false || response.success === false || response.error
      || response.response?.ok === false || response.response?.success === false
      || response.response?.error) throw Error('IMPROVEMENT_ENVELOPE_INVALID');
}
function cursorFrom(meta) {
  if (!meta || !Object.hasOwn(meta, 'next_cursor')) throw Error('IMPROVEMENT_PAGINATION_UNKNOWN');
  const cursor = meta.next_cursor;
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length > 4096)) {
    throw Error('IMPROVEMENT_CURSOR_INVALID');
  }
  return cursor || null;
}
function retryable(response) {
  return ['TIMEOUT', 'UPSTREAM'].includes(response.code)
    && (response.status === null || response.status >= 500);
}

class ImprovementJournal {
  constructor({directory, campaignId, targetId, targetHash, maxRequests, baseAttempts = 0,
    reserve = 500, quotaMaxAgeMs = 300000, references = [], now = () => Date.now()}) {
    if (!/^[a-z0-9-]{1,70}$/.test(campaignId || '') || !TARGET_IDS.has(targetId)
        || typeof targetHash !== 'string' || !targetHash || targetHash.length > 128
        || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 30000
        || !Number.isSafeInteger(baseAttempts) || baseAttempts < 0
        || !Number.isSafeInteger(reserve) || reserve < 500
        || !Number.isSafeInteger(quotaMaxAgeMs) || quotaMaxAgeMs < 1000 || quotaMaxAgeMs > 3600000) {
      throw Error('IMPROVEMENT_CONFIG_INVALID');
    }
    fs.mkdirSync(directory, {recursive: true});
    this.directory = directory; this.now = now;
    this.file = path.join(directory, 'improvement-ledger.ndjson');
    this.stopFile = path.join(directory, 'improvement-stop.json');
    this.lockFile = path.join(directory, 'improvement.lock');
    const config = {version: 1, campaignId, targetId, targetHash, maxRequests,
      baseAttempts, reserve, quotaMaxAgeMs,
      references: references.map(file => ({file, sha256: digest(fs.readFileSync(file))}))};
    const manifest = path.join(directory, 'improvement-manifest.json');
    // Hold an exclusive local lock until close. An interrupted process requires
    // an operator to inspect and remove its stale lock; it never steals one.
    const fd = fs.openSync(this.lockFile, 'wx');
    try { fs.writeSync(fd, JSON.stringify({pid: process.pid, at: iso(now())})); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    this.closed = false;
    try {
      if (fs.existsSync(manifest)) {
        if (JSON.stringify(JSON.parse(fs.readFileSync(manifest, 'utf8'))) !== JSON.stringify(config)) {
          throw Error('IMPROVEMENT_RESUME_MANIFEST_CHANGED');
        }
      } else atomicJson(manifest, config);
      this.config = config;
      this.rows = readJournal(this.file);
      for (const attempt of this.attempts()) {
        if (this.rows.some(row => row.kind === 'response' && row.number === attempt.number)) continue;
        const file = this.receiptPath(attempt.number);
        if (!fs.existsSync(file)) throw Error('IMPROVEMENT_UNCERTAIN_NETWORK_ATTEMPT');
        const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (receipt.key !== attempt.key || receipt.specHash !== attempt.specHash
            || receipt.number !== attempt.number || !Number.isFinite(Date.parse(receipt.observedAt))) {
          throw Error('IMPROVEMENT_RECEIPT_INVALID');
        }
        this.append({kind: 'response', number: attempt.number, ok: true, status: 200,
          at: receipt.observedAt, sha256: digest(fs.readFileSync(file)), recovered: true});
      }
    } catch (error) { this.close(); throw error; }
  }
  close() {
    if (!this.closed) { fs.unlinkSync(this.lockFile); this.closed = true; }
  }
  append(row) { durableAppend(this.file, row); this.rows.push(row); }
  attempts() { return this.rows.filter(row => row.kind === 'attempt'); }
  outcome(key) { return this.rows.findLast(row => row.kind === 'outcome' && row.key === key); }
  receiptPath(number) { return path.join(this.directory, `response-${number}.json`); }
  assertOpen() {
    if (this.closed) throw Error('IMPROVEMENT_JOURNAL_CLOSED');
    if (fs.existsSync(this.stopFile)) throw Error('IMPROVEMENT_STOP_LATCH');
    for (const ref of this.config.references) {
      if (digest(fs.readFileSync(ref.file)) !== ref.sha256) throw Error('IMPROVEMENT_REFERENCE_CHANGED');
    }
  }
  halt(code) {
    if (!fs.existsSync(this.stopFile)) atomicJson(this.stopFile, {
      at: iso(this.now()), code, attempts: this.attempts().length, targetId: this.config.targetId
    });
  }
  assertBudget(operation) {
    this.assertOpen();
    const attempts = this.attempts();
    if (attempts.length >= this.config.maxRequests) throw Error('IMPROVEMENT_REQUEST_LIMIT');
    if (operation === 'apiUsage') return;
    const quota = this.rows.findLast(row => row.kind === 'quota');
    if (!quota || this.now() - Date.parse(quota.at) > this.config.quotaMaxAgeMs
        || this.now() < Date.parse(quota.at)) throw Error('IMPROVEMENT_FRESH_QUOTA_REQUIRED');
    if (attempts.length - quota.number >= quota.allowance) throw Error('IMPROVEMENT_QUOTA_RESERVE');
  }
  counters() {
    const attempts = this.attempts(), outcomes = this.rows.filter(row => row.kind === 'outcome');
    const byOperation = {}, byPlatform = {};
    for (const item of attempts) {
      byOperation[item.operation] = (byOperation[item.operation] || 0) + 1;
      byPlatform[item.platform || 'unassigned'] = (byPlatform[item.platform || 'unassigned'] || 0) + 1;
    }
    return {attempts: attempts.length, combinedAttempts: this.config.baseAttempts + attempts.length,
      retries: attempts.filter(item => item.retry).length, byOperation, byPlatform,
      completed: outcomes.filter(item => item.result.status === 'committed').length,
      rejected: outcomes.filter(item => item.result.status === 'rejected').length,
      failed: outcomes.filter(item => item.result.status === 'failed').length,
      quota: this.rows.findLast(row => row.kind === 'quota') || null};
  }
  async refreshQuota(transport, options = {}) {
    return this.execute(`usage:${this.attempts().length + 1}`, {operation: 'apiUsage'}, transport,
      async ({response, observedAt, number}) => {
        const quota = parseUsage(response, this.config.reserve);
        this.append({kind: 'quota', at: observedAt, number, ...quota});
        return {status: 'committed', operation: 'apiUsage', ...quota};
      }, options);
  }
  async execute(key, spec, transport, consume, {wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    beforeTransport = async () => {}, maxRetries = 1} = {}) {
    this.assertOpen();
    if (this.busy) throw Error('IMPROVEMENT_CONCURRENT_OPERATION');
    if (![0, 1].includes(maxRetries) || typeof transport !== 'function' || typeof consume !== 'function'
        || typeof key !== 'string' || !key || key.length > 500) throw Error('IMPROVEMENT_OPERATION_INVALID');
    const specHash = digest(spec);
    const previous = this.rows.filter(row => row.kind === 'attempt' && row.key === key);
    if (previous.some(row => row.specHash !== specHash)) throw Error('IMPROVEMENT_REQUEST_CHANGED');
    const finished = this.outcome(key);
    if (finished) return {...finished.result, replayed: true};
    this.busy = true;
    try {
      let attempt = previous.at(-1);
      for (;;) {
        let reply = attempt && this.rows.findLast(row => row.kind === 'response' && row.number === attempt.number);
        if (attempt && !reply) throw Error('IMPROVEMENT_UNCERTAIN_NETWORK_ATTEMPT');
        if (reply && !reply.ok) {
          const retryCount = this.rows.filter(row => row.kind === 'attempt' && row.key === key && row.retry).length;
          if (retryable(reply) && retryCount < maxRetries) {
            await wait(Math.min(60000, Math.max(1000, reply.retryAfterMs || 1000)));
            attempt = null;
          } else {
            if (['AUTH', 'CONFIGURATION', 'RATE_LIMITED', 'INVALID_REQUEST', 'INVALID_RESPONSE'].includes(reply.code)
                || reply.status === 401 || reply.status === 403 || reply.status === 429) {
              this.halt(reply.code); throw Error(reply.code);
            }
            const result = {status: 'failed', code: reply.code, number: attempt.number, observedAt: reply.at};
            this.append({kind: 'outcome', key, at: iso(this.now()), result}); return result;
          }
        }
        if (!attempt) {
          this.assertBudget(spec.operation);
          await beforeTransport(spec);
          // Recheck after the injected guard because time or STOP can change.
          this.assertBudget(spec.operation);
          const number = this.attempts().length + 1;
          attempt = {kind: 'attempt', number, key, specHash, at: iso(this.now()),
            combined: this.config.baseAttempts + number, operation: spec.operation,
            platform: spec.platform || spec.params?.platform || null, retry: previous.length > 0};
          previous.push(attempt); this.append(attempt);
          let response;
          try { response = await transport(spec); }
          catch (error) {
            const status = Number.isInteger(error.status) ? error.status : null;
            const retrySeconds = Number(error.retryAfter ?? 1);
            this.append({kind: 'response', number, at: iso(this.now()), ok: false,
              code: safeCode(error), status,
              retryAfterMs: Number.isFinite(retrySeconds) && retrySeconds >= 0 && retrySeconds <= 60
                ? retrySeconds * 1000 : 60000});
            continue;
          }
          const receipt = {number, key, specHash, observedAt: iso(this.now()), response};
          // Persist the public provider response before any DB write. No headers,
          // API key, credentials or private tables are accepted by this API.
          atomicJson(this.receiptPath(number), receipt);
          reply = {kind: 'response', number, at: receipt.observedAt, ok: true, status: 200,
            sha256: digest(fs.readFileSync(this.receiptPath(number)))};
          this.append(reply);
        }
        const bytes = fs.readFileSync(this.receiptPath(attempt.number));
        if (digest(bytes) !== reply.sha256) throw Error('IMPROVEMENT_RECEIPT_CHANGED');
        const receipt = JSON.parse(bytes);
        if (receipt.specHash !== specHash || receipt.key !== key || receipt.number !== attempt.number) {
          throw Error('IMPROVEMENT_RECEIPT_INVALID');
        }
        let result;
        try {
          this.assertOpen();
          validateEnvelope(receipt.response);
          result = await consume(receipt);
        } catch (error) {
          const code = safeCode(error);
          if (!ITEM_ERRORS.has(code)) { this.halt(code); throw error; }
          result = {status: 'rejected', code, number: attempt.number, observedAt: receipt.observedAt};
        }
        this.append({kind: 'outcome', key, at: iso(this.now()), result});
        return result;
      }
    } catch (error) {
      // Limit/expired quota are resumable after an explicit fresh quota read.
      if (!['IMPROVEMENT_REQUEST_LIMIT', 'IMPROVEMENT_FRESH_QUOTA_REQUIRED',
        'IMPROVEMENT_QUOTA_RESERVE'].includes(safeCode(error))) this.halt(safeCode(error));
      throw error;
    } finally { this.busy = false; }
  }
}

function planCampaign(rows, {now = Date.now(), maxDetails = 1000, missingMakes = []} = {}) {
  if (!Array.isArray(rows) || !Number.isSafeInteger(maxDetails) || maxDetails < 0) {
    throw Error('IMPROVEMENT_PLAN_INVALID');
  }
  const seen = new Set(), targets = [];
  for (const row of rows) {
    detailSpec(row);
    if (!row.listing_id) throw Error('IMPROVEMENT_PLAN_IDENTITY_MISSING');
    const key = row.platform + ':' + row.lot;
    if (seen.has(key)) throw Error('IMPROVEMENT_PLAN_DUPLICATE');
    seen.add(key);
    const date = Date.parse(row.timed_end_at || row.auction_at);
    const active = /^(active|open|live|pending|pre.?bid|scheduled|upcoming|future|timed|buy.?now)$/i
      .test(row.source_status || row.auction_state || '');
    const priority = active && (row.is_timed === 1 || row.buy_now_usd > 0 || date >= now)
      ? 0 : active ? 1 : 2;
    targets.push({row, priority, observed: Date.parse(row.detail_synced_at || row.summary_synced_at || row.last_seen_at) || 0});
  }
  targets.sort((a, b) => a.priority - b.priority || a.observed - b.observed
    || (a.row.platform + ':' + a.row.lot).localeCompare(b.row.platform + ':' + b.row.lot));
  const discovery = [];
  for (const platform of ['copart', 'iaai']) {
    for (const category of ['open', 'timed', 'buy-now']) discovery.push({platform, category});
    for (const make of [...new Set(missingMakes)]) discovery.push({platform, category: 'open', make});
  }
  discovery.forEach(scope => buildDiscoverySpec(scope));
  const details = targets.slice(0, maxDetails).map(item => item.row);
  return {details, discovery, targetHash: digest({details, discovery}),
    estimate: {details: details.length, firstDiscoveryPages: discovery.length, usage: 1,
      minimumRequests: details.length + discovery.length + 1,
      note: 'Retries, quota rechecks and explicit history continuation consume additional attempts.'}};
}

function buildDiscoverySpec(scope, cursor = null) {
  if (!['copart', 'iaai'].includes(scope?.platform)
      || !['open', 'timed', 'buy-now'].includes(scope.category)
      || scope.make !== undefined && (typeof scope.make !== 'string' || !scope.make.trim()
        || scope.make.length > 120 || /[\x00-\x1f]/.test(scope.make))) {
    throw Error('IMPROVEMENT_DISCOVERY_INVALID');
  }
  const params = {platform: scope.platform, per_page: 20, lot_sub_status: 'Open', upcoming: 'all'};
  if (scope.category !== 'open') params.lot_status = scope.category === 'timed' ? 'Timed' : 'Buy Now';
  if (scope.make !== undefined) params.make = scope.make.trim();
  if (cursor !== null) params.cursor = cursorFrom({next_cursor: cursor});
  return {operation: 'listVehicles', params};
}
function assertTarget(db, journal) {
  if (db?.identity?.id !== journal.config.targetId) throw Error('IMPROVEMENT_DATABASE_MISMATCH');
}
async function guardedWrite(beforeWrite, operation) {
  try { await beforeWrite(); return await operation(); }
  catch (cause) { const error = Error('IMPROVEMENT_WRITE_FAILED'); error.cause = cause; throw error; }
}
async function savePrepared(db, prepared, observedAt, {detail = false, beforeWrite}) {
  if (prepared.skipped) return {skipped: prepared.skipped};
  const {record} = prepared;
  return guardedWrite(beforeWrite, async () => {
    const {statements, fingerprint} = await knownObservationStatements(db, record);
    if (detail) statements.push(db.prepare(
      'UPDATE auction_listings SET detail_synced_at=? WHERE listing_id=? AND platform=? AND lot=?'
    ).bind(observedAt, record.identity.listingId, record.vehicle.platform, record.vehicle.lot));
    // Read back within the same transaction as the observation write. Preserve
    // every check while avoiding two additional remote round trips per record.
    statements.push(db.prepare(`SELECT l.*,
      (SELECT fingerprint FROM auction_listing_snapshots WHERE listing_id=l.listing_id
        ORDER BY observed_at DESC,snapshot_id DESC LIMIT 1) AS latest_snapshot_fingerprint
      FROM auction_listings l WHERE l.listing_id=?`).bind(record.identity.listingId));
    const results = await db.batch(statements);
    const row = results.at(-1)?.results?.[0];
    if (!row || row.platform !== record.vehicle.platform || row.lot !== record.vehicle.lot
        || row.vin_normalized !== record.vehicle.vin || row.summary_synced_at !== observedAt
        || detail && row.detail_synced_at !== observedAt
        || row.current_bid_usd !== record.vehicle.pricing.current_bid
        || row.buy_now_usd !== record.vehicle.pricing.buy_now) throw Error('IMPROVEMENT_LISTING_READBACK_FAILED');
    if (row.latest_snapshot_fingerprint !== fingerprint) throw Error('IMPROVEMENT_SNAPSHOT_READBACK_FAILED');
    return {listingId: row.listing_id, vin: row.vin_normalized, inserted: prepared.inserted, availability: prepared.availability.status};
  });
}
function requireWriteGuard(beforeWrite) {
  if (typeof beforeWrite !== 'function') throw Error('IMPROVEMENT_WRITE_GUARD_REQUIRED');
}
function ownHistoryContext(target, knownRows, confirmedVin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(confirmedVin || '')) return {target, knownRows};
  const observed = {platform: target.platform, lot_number: target.lot, vin: confirmedVin};
  checkDetail(observed, target);
  // A detail proves only its own exact listing. Keep the campaign target and
  // all related LOT evidence immutable, including their masked-VIN guards.
  const rows = knownRows.map(row => {
    if (row.listing_id !== target.listing_id || row.platform !== target.platform || row.lot !== target.lot) return row;
    checkDetail(observed, row);
    return {...row, vin_normalized: confirmedVin};
  });
  return {target: {...target, vin_normalized: confirmedVin}, knownRows: rows};
}
function historyResult(result) {
  return {events: result.events, complete: result.complete, sourceComplete: result.sourceComplete,
    nextCursor: result.nextCursor, unresolved: result.related.length + result.unidentified.length};
}
async function markDetailFailure(db, journal, target, result, beforeWrite) {
  if (!['failed', 'rejected'].includes(result.status)) return;
  try {
    await guardedWrite(beforeWrite, async () => {
      await db.batch([db.prepare(`UPDATE vehicle_sources
        SET last_attempt_at=?,last_error_code=?,sync_status='failed',updated_at=?
        WHERE provider='apibara' AND platform=? AND source_key=(
          SELECT source_key FROM auction_listings WHERE listing_id=? AND platform=? AND lot=?
          AND COALESCE(vin_normalized,'')=COALESCE(?,''))
        AND julianday(?)>=COALESCE(julianday(last_success_at),-1)`)
        .bind(result.observedAt, result.code, result.observedAt, target.platform,
          target.listing_id, target.platform, target.lot, target.vin_normalized || null, result.observedAt)]);
      const row = await db.prepare(`SELECT s.last_attempt_at,s.last_error_code,s.last_success_at,s.sync_status
        FROM vehicle_sources s JOIN auction_listings l ON l.source_key=s.source_key
        WHERE l.listing_id=? AND l.platform=? AND l.lot=? AND COALESCE(l.vin_normalized,'')=COALESCE(?,'')
        AND s.provider='apibara' AND s.platform=?`)
        .bind(target.listing_id, target.platform, target.lot, target.vin_normalized || null, target.platform).first();
      if (!row || !(Date.parse(row.last_success_at) > Date.parse(result.observedAt))
          && (row.last_attempt_at !== result.observedAt || row.last_error_code !== result.code || row.sync_status !== 'failed')) {
        throw Error('IMPROVEMENT_FAILURE_READBACK_FAILED');
      }
    });
  } catch (error) { journal.halt(safeCode(error)); throw error; }
}
async function markDetailFailureOnce(db, journal, target, key, result, beforeWrite) {
  if (!['failed', 'rejected'].includes(result.status)) return;
  if (journal.rows.some(row => ['detail_failure_marked', 'recovery_failure_marked'].includes(row.kind)
      && row.key === key && row.observedAt === result.observedAt)) return;
  // Mark a first failure with the same exact identity/readback guards. Only a
  // completed marker may suppress future writes; a crash before it is appended
  // replays the idempotent marker from the original dated outcome.
  await markDetailFailure(db, journal, target, result, beforeWrite);
  journal.append({kind: 'detail_failure_marked', key, at: iso(journal.now()),
    observedAt: result.observedAt});
}

async function runDetailOperation({db, provider, journal, target, knownRows, transport, beforeWrite,
  freshnessPolicy = POLICY, transportOptions = {}}, {key, spec}) {
  assertTarget(db, journal); requireWriteGuard(beforeWrite);
  const result = await journal.execute(key, spec, transport, async ({response, observedAt}) => {
    const raw = provider.vehicleDetailRecord(response);
    checkDetail(raw, target);
    const prepared = await prepareObservation({repo: new D1SyncRepository(db), provider, raw,
      platform: target.platform, observedAt, processedAt: iso(journal.now()),
      knownTarget: {lot: target.lot, listingId: target.listing_id}, freshnessPolicy});
    const historyOptions = {meta: provider.responseMeta(response)};
    const context = ownHistoryContext(target, knownRows, prepared.record?.vehicle.vin);
    let history = null, historyError = null;
    try { history = historyPartition(provider, raw, context.target, context.knownRows, historyOptions); }
    catch (error) {
      if (!ITEM_ERRORS.has(safeCode(error))) throw error;
      historyError = safeCode(error);
    }
    const saved = await savePrepared(db, prepared, observedAt, {detail: true, beforeWrite});
    if (history && !saved.skipped) history = await guardedWrite(beforeWrite,
      () => persistHistory(db, provider, raw, context.target, context.knownRows, observedAt, historyOptions));
    return {status: 'committed', ...saved, observedAt,
      history: history && !saved.skipped ? historyResult(history) : null, historyError};
  }, transportOptions);
  await markDetailFailureOnce(db, journal, target, key, result, beforeWrite);
  return result;
}

async function runDetailTarget(args) {
  return runDetailOperation(args, {key: 'detail:' + digest(args.target), spec: detailSpec(args.target)});
}

function exactLotOperationFor(journal, target) {
  journal.assertOpen();
  const key = 'detail:' + digest(target), previous = journal.outcome(key);
  if (!previous) throw Error('LOT_RECOVERY_ORIGIN_REQUIRED');
  // Only the actual terminal outcome in this immutable campaign can authorize
  // recovery. A caller cannot supply an eligible-looking prior result.
  return exactLotRecoveryOperation(target, {campaignId: journal.config.campaignId, key,
    status: previous.result.status, code: previous.result.code});
}

async function runExactLotRecovery(args) {
  assertTarget(args.db, args.journal); requireWriteGuard(args.beforeWrite);
  const operation = exactLotOperationFor(args.journal, args.target);
  // Journals from the older module have no original failure marker. Confirm it
  // before recovery can upgrade a masked VIN, so a later normal-loop replay
  // does not try to mark the superseded masked identity again.
  const original = args.journal.outcome(operation.origin.key);
  await markDetailFailureOnce(args.db, args.journal, args.target, operation.origin.key,
    original.result, args.beforeWrite);
  return runDetailOperation({...args, transportOptions: {...args.transportOptions, maxRetries: 0}}, operation);
}

async function runDiscoveryScope({db, provider, journal, scope, transport, beforeWrite,
  maxPages = 1, maxNew = 100, freshnessPolicy = POLICY, transportOptions = {}}) {
  assertTarget(db, journal); requireWriteGuard(beforeWrite);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100
      || !Number.isSafeInteger(maxNew) || maxNew < 0) throw Error('IMPROVEMENT_PAGE_LIMIT');
  const baseSpec = buildDiscoverySpec(scope), scopeKey = 'discovery:' + digest(baseSpec);
  const scopeConfig = journal.rows.find(row => row.kind === 'scope' && row.scopeKey === scopeKey);
  if (scopeConfig && scopeConfig.maxNew !== maxNew) throw Error('IMPROVEMENT_SCOPE_LIMIT_CHANGED');
  if (!scopeConfig) journal.append({kind: 'scope', scopeKey, maxNew});
  const previous = journal.rows.filter(row => row.kind === 'outcome' && row.result.scopeKey === scopeKey);
  if (previous.at(-1)?.result.sourceEnd || previous.at(-1)?.result.capped) {
    return {scopeKey, pages: 0, insertedThisRun: 0, result: {...previous.at(-1).result, replayed: true}};
  }
  let cursor = previous.at(-1)?.result.nextCursor ?? null, result = null;
  const seen = new Set(previous.map(row => row.result.inputCursor));
  const alreadyInserted = previous.reduce((sum, row) => sum + row.result.inserted, 0);
  let priorRejected = previous.reduce((sum, row) => sum + row.result.rejected.length + row.result.capped, 0);
  let inserted = alreadyInserted, pages = 0;
  while (pages < maxPages && inserted < maxNew) {
    const spec = buildDiscoverySpec(scope, cursor);
    result = await journal.execute(scopeKey + ':' + digest(cursor), spec, transport,
      async ({response, observedAt, number}) => {
        const data = response?.response?.data ?? response?.data;
        if (!Array.isArray(data) && !(data && Array.isArray(data.vehicles))) throw Error('IMPROVEMENT_LIST_SHAPE_INVALID');
        const records = provider.vehicleListRecords(response);
        if (records.length > 20) throw Error('IMPROVEMENT_LIST_SHAPE_INVALID');
        const nextCursor = cursorFrom(provider.responseMeta(response));
        if (nextCursor !== null && (nextCursor === cursor || seen.has(nextCursor))) throw Error('IMPROVEMENT_REPEATED_CURSOR');
        const prepared = [], rejected = [], pageKeys = new Set();
        for (const raw of records) {
          try {
            if (!raw || String(raw.platform).toLowerCase() !== scope.platform
                || !/^\d+$/.test(String(raw.lot_number ?? raw.lot ?? ''))) throw Error('IMPROVEMENT_RECORD_INVALID');
            const ownKey = scope.platform + ':' + String(raw.lot_number ?? raw.lot);
            if (pageKeys.has(ownKey)) throw Error('IMPROVEMENT_DUPLICATE_PAGE_IDENTITY');
            pageKeys.add(ownKey);
            const repository = new D1SyncRepository(db);
            const repo = {async findListingsByLot(input) {
              const found = await repository.findListingsByLot(input);
              if (found.results?.length === 1) checkDetail(raw, found.results[0]);
              return found;
            }};
            prepared.push(await prepareObservation({repo, provider, raw,
              platform: scope.platform, observedAt, processedAt: iso(journal.now()), freshnessPolicy}));
          } catch (error) {
            if (!ITEM_ERRORS.has(safeCode(error))) throw error;
            rejected.push({code: safeCode(error)});
          }
        }
        // Preserve insert decisions before any write. If D1 committed some or
        // all records before interruption, replay still counts those inserts
        // against this scope's original cap instead of relabeling them updates.
        let plan = journal.rows.find(row => row.kind === 'page-plan' && row.number === number);
        if (!plan) {
          let planned = inserted;
          plan = {kind: 'page-plan', number, items: prepared.map(item => ({
            listingId: item.record?.identity.listingId || null,
            skipped: item.skipped || null, inserted: item.inserted === true,
            capped: item.inserted === true && planned++ >= maxNew
          }))};
          journal.append(plan);
        }
        if (plan.items.length !== prepared.length
            || plan.items.some((item, i) => item.listingId !== (prepared[i].record?.identity.listingId || null)
              || item.skipped !== (prepared[i].skipped || null))) throw Error('IMPROVEMENT_REPLAY_PLAN_CHANGED');
        let added = 0, updated = 0, skipped = 0, capped = 0;
        for (let i = 0; i < prepared.length; i++) {
          const item = prepared[i], decision = plan.items[i];
          if (decision.capped) { capped++; continue; }
          const saved = await savePrepared(db, item, observedAt, {beforeWrite});
          if (saved.skipped) skipped++; else if (decision.inserted) added++; else updated++;
        }
        return {status: 'committed', scopeKey, observedAt, inputCursor: cursor, nextCursor,
          complete: nextCursor === null && !capped && !rejected.length && !priorRejected,
          sourceEnd: nextCursor === null, inserted: added, updated, skipped, capped, rejected};
      }, transportOptions);
    if (result.status !== 'committed') break;
    pages++; inserted += result.inserted; priorRejected += result.rejected.length + result.capped;
    if (result.sourceEnd || result.capped) break;
    seen.add(cursor); cursor = result.nextCursor;
  }
  return {scopeKey, pages, insertedThisRun: inserted - alreadyInserted, result};
}

async function runHistoryOperation({db, provider, journal, target, knownRows, transport, beforeWrite,
  maxPages = 20, transportOptions = {}}, {anchorKey, scopeKey, identifier, recovery = false}) {
  assertTarget(db, journal); requireWriteGuard(beforeWrite);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) throw Error('IMPROVEMENT_PAGE_LIMIT');
  const detail = journal.outcome(anchorKey);
  if (detail?.result.status !== 'committed' || !detail.result.history
      || recovery && (detail.result.skipped || detail.result.listingId !== target.listing_id)) {
    throw Error('IMPROVEMENT_HISTORY_ANCHOR_REQUIRED');
  }
  const context = ownHistoryContext(target, knownRows, detail.result.vin);
  const previous = journal.rows.filter(row => row.kind === 'outcome' && row.result.scopeKey === scopeKey);
  let state = previous.at(-1)?.result || detail.result.history;
  if (!state.nextCursor) return {pages: 0, history: state};
  let cursor = state.nextCursor, unresolved = state.unresolved || 0, pages = 0;
  const seen = new Set(previous.map(row => row.result.inputCursor));
  while (pages < maxPages && cursor) {
    const spec = {operation: 'vehicleHistory', identifier: identifier ?? (context.target.provider_vehicle_id || context.target.vin_normalized),
      platform: target.platform, per_page: 20, cursor};
    state = await journal.execute(scopeKey + ':' + digest(cursor), spec, transport,
      async ({response, observedAt}) => {
        const data = response?.response?.data ?? response?.data;
        const meta = data?.history?.meta ?? provider.responseMeta(response) ?? data?.meta;
        const nextCursor = cursorFrom(meta);
        if (nextCursor !== null && (nextCursor === cursor || seen.has(nextCursor))) throw Error('IMPROVEMENT_REPEATED_CURSOR');
        const events = provider.historyRecords(response);
        if (events.length > 20 || !(Array.isArray(data) || Array.isArray(data?.history) || Array.isArray(data?.history?.data))) {
          throw Error('IMPROVEMENT_HISTORY_SHAPE_INVALID');
        }
        // Retained arrays lack a repeated vehicle envelope; only the successful
        // detail in this exact immutable campaign establishes their anchor.
        const raw = data;
        if (!Array.isArray(data)) checkDetail(data.vehicle, context.target);
        const options = {mode: 'paginated', meta, anchorVerified: true, priorUnresolved: unresolved > 0};
        const partition = historyPartition(provider, raw, context.target, context.knownRows, options);
        const saved = await guardedWrite(beforeWrite,
          () => persistHistory(db, provider, raw, context.target, context.knownRows, observedAt, options));
        return {status: 'committed', scopeKey, ...(recovery ? {anchorKey} : {}),
          inputCursor: cursor, ...historyResult(saved),
          unresolved: unresolved + partition.related.length + partition.unidentified.length};
      }, transportOptions);
    if (state.status !== 'committed') break;
    pages++; unresolved = state.unresolved; seen.add(cursor); cursor = state.nextCursor;
  }
  return {pages, history: state};
}

async function runHistoryPages(args) {
  return runHistoryOperation(args, {anchorKey: 'detail:' + digest(args.target),
    scopeKey: 'history:' + digest(args.target)});
}

async function runExactLotRecoveryHistoryPages(args) {
  const operation = exactLotOperationFor(args.journal, args.target);
  return runHistoryOperation({...args, transportOptions: {...args.transportOptions, maxRetries: 0}},
    {anchorKey: operation.key, scopeKey: 'history-lot-recovery:v1:' + digest(operation.key),
      identifier: operation.spec.identifier, recovery: true});
}

module.exports = {ImprovementJournal, planCampaign, buildDiscoverySpec, runDetailTarget,
  runDiscoveryScope, runHistoryPages, runExactLotRecovery, runExactLotRecoveryHistoryPages, digest};
