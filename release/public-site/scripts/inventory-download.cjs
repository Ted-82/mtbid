'use strict';

// Operator-only, download-only bootstrap. The caller supplies the transport;
// credentials and database connections never enter this module.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const SCOPES = Object.freeze(['copart:Open', 'iaai:Open', 'copart:Live', 'iaai:Live']);
const sha = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string'
  ? value : JSON.stringify(value)).digest('hex');
const fail = code => { const error = Error(code); error.code = code; throw error; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const date = now => new Date(now()).toISOString();
const inside = (candidate, root) => candidate === root || candidate.startsWith(root + path.sep);

function syncDirectory(directory) {
  let fd;
  try { fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); }
  catch (error) { if (!['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function atomicJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file); syncDirectory(path.dirname(file));
}
function append(file, row) {
  const existed = fs.existsSync(file);
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(row) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  if (!existed) syncDirectory(path.dirname(file));
}
function readRows(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) fail('INVENTORY_LEDGER_TRUNCATED');
  try { return text.split('\n').filter(Boolean).map(JSON.parse); }
  catch { fail('INVENTORY_LEDGER_INVALID'); }
}
function envelope(response) {
  const body = response?.response ?? response;
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.ok !== true
      || body.error || body.success === false || response?.ok === false) fail('INVENTORY_ENVELOPE_INVALID');
  return body;
}
function listSpec(scope, cursor) {
  const [platform, status] = scope.split(':');
  return {operation: 'listVehicles', params: {platform, lot_sub_status: status,
    per_page: 20, ...(cursor === null ? {include_total: true} : {cursor})}};
}
function validateInventoryPage(response, scope, cursor, seen = new Set()) {
  const body = envelope(response), meta = body.meta, filters = meta?.applied_filters;
  const [platform, status] = scope.split(':');
  if (!SCOPES.includes(scope) || !Array.isArray(body.data) || body.data.length > 20
      || !meta || meta.platform !== platform || meta.per_page !== 20
      || filters?.platform !== platform || filters?.lot_sub_status !== status
      || String(filters?.per_page) !== '20') fail('INVENTORY_SCOPE_INVALID');
  const neutral = {lot_status: 'All', upcoming: 'all', view: 'full'};
  for (const [key, value] of Object.entries(filters)) {
    if (['platform', 'lot_sub_status', 'per_page', 'include_total', 'cursor'].includes(key)) continue;
    if (value !== null && value !== '' && value !== undefined && neutral[key] !== value) fail('INVENTORY_UNEXPECTED_FILTER');
  }
  if (meta.unknown_filters !== undefined && (!Array.isArray(meta.unknown_filters) || meta.unknown_filters.length)) fail('INVENTORY_UNEXPECTED_FILTER');
  if (cursor === null && (String(filters.include_total) !== 'true'
      || !Number.isSafeInteger(meta.total) || meta.total < body.data.length)) fail('INVENTORY_TOTAL_INVALID');
  if (filters.cursor !== undefined && filters.cursor !== cursor) fail('INVENTORY_CURSOR_ECHO_INVALID');
  if (!Object.hasOwn(meta, 'next_cursor')) fail('INVENTORY_PAGINATION_UNKNOWN');
  const next = meta.next_cursor;
  if (next !== null && (typeof next !== 'string' || !next || next.length > 4096
      || /[\u0000-\u001f]/.test(next))) fail('INVENTORY_CURSOR_INVALID');
  if (next !== null && (next === cursor || seen.has(sha(next)))) fail('INVENTORY_REPEATED_CURSOR');
  if (meta.has_more !== undefined && meta.has_more !== (next !== null)) fail('INVENTORY_PAGINATION_INVALID');
  if (next !== null && !body.data.length) fail('INVENTORY_EMPTY_PAGE_WITH_CURSOR');
  for (const raw of body.data) {
    if (!raw || raw.platform !== platform || String(raw.auction?.state || '').toLowerCase() !== status.toLowerCase()) fail('INVENTORY_RECORD_SCOPE_INVALID');
  }
  return {records: body.data.length, nextCursor: next, total: cursor === null ? meta.total : null};
}
function parseQuota(response, reserve) {
  const data = envelope(response).data, quota = data?.quota, plan = data?.plan;
  const planCeiling = plan?.name === 'Basic' ? 30000 : plan?.name === 'Pro' ? 100000 : null;
  if (!quota || ![quota.limit, quota.used, quota.left].every(n => Number.isSafeInteger(n) && n >= 0)
      || planCeiling === null || quota.limit < 1 || quota.limit > planCeiling || quota.used + quota.left !== quota.limit
      || !Number.isSafeInteger(plan.per_page_limit) || plan.per_page_limit < 20
      || plan.per_page_limit > 40) fail('INVENTORY_QUOTA_INVALID');
  return {limit: quota.limit, used: quota.used, left: quota.left, plan: plan.name,
    perPageLimit: plan.per_page_limit, allowance: Math.max(0, quota.left - reserve - 1)};
}
function safeFailure(error, now) {
  const statuses = [error?.status, error?.httpStatus].filter(value => Number.isInteger(value) && value >= 100 && value <= 599);
  // Adapters may expose either spelling. Authentication and throttling always
  // win if a wrapper supplies conflicting status fields.
  const status = statuses.find(value => [401, 403, 429].includes(value)) ?? statuses[0] ?? null;
  let code = ['AUTH', 'CONFIGURATION', 'RATE_LIMITED', 'TIMEOUT', 'UPSTREAM', 'NOT_FOUND',
    'INVALID_REQUEST', 'INVALID_RESPONSE'].includes(error?.code) ? error.code : 'TRANSPORT_FAILED';
  if (error?.name === 'AbortError') code = 'TIMEOUT';
  if (status === 401 || status === 403) code = 'AUTH';
  if (status === 429) code = 'RATE_LIMITED';
  const raw = error?.retryAfter;
  let retryAfterMs = typeof raw === 'number' || /^\d+$/.test(String(raw)) ? Number(raw) * 1000 : Date.parse(raw) - now();
  if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) retryAfterMs = 60000;
  return {code, status, retryAfterMs: Math.min(retryAfterMs, 86400000)};
}
function transientFailure(failure) {
  // These are idempotent GETs with a durable reservation for every attempt.
  // ProviderError(UPSTREAM, null) means fetch failed without an HTTP response.
  const noResponse = failure?.status === null;
  const serverError = Number.isInteger(failure?.status) && failure.status >= 500 && failure.status <= 599;
  return (failure?.code === 'UPSTREAM' && (noResponse || serverError))
    || (failure?.code === 'TIMEOUT' && (noResponse || serverError || failure.status === 408));
}

/**
 * obtain(spec, {signal}) returns the unmodified JSON provider payload. It must
 * abort its underlying request when signal aborts; no credentials belong in spec.
 * The lifetime budget includes usage, checkpoint, unsuccessful calls and retries.
 * An unknown durable attempt is never retried. A stale lock requires inspection.
 * resumeTransientStop explicitly archives a known transient stop only when its
 * original per-request retry allowance remains. It never resets any counter.
 * resumePlanChange binds an explicit Basic-to-Pro recovery to the original
 * successful usage receipt's number and SHA-256; request/page budgets stay fixed.
 */
async function runInventoryDownload({directory, obtain, maxRequests = 9000, reserve = 1000,
  concurrency = 2, requestsPerSecond = 4, timeoutMs = 20000, maxRetries = 2,
  maxPagesPerRun = Number.MAX_SAFE_INTEGER, onProgress = () => {}, signal,
  now = Date.now, wait = sleep, projectRoot = path.resolve(__dirname, '..'),
  resumeTransientStop = false, resumePlanChange = null} = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof obtain !== 'function'
      || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 10000
      || !Number.isSafeInteger(reserve) || reserve < 1000 || ![1, 2].includes(concurrency)
      || !Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0 || requestsPerSecond > 4
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000
      || ![0, 1, 2].includes(maxRetries) || !Number.isSafeInteger(maxPagesPerRun) || maxPagesPerRun < 1
      || typeof onProgress !== 'function' || typeof now !== 'function' || typeof wait !== 'function'
      || typeof resumeTransientStop !== 'boolean'
      || (resumePlanChange !== null && (!resumePlanChange || typeof resumePlanChange !== 'object'
        || Array.isArray(resumePlanChange) || !Number.isSafeInteger(resumePlanChange.receiptNumber)
        || resumePlanChange.receiptNumber < 1 || typeof resumePlanChange.receiptSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(resumePlanChange.receiptSha256)))) fail('INVENTORY_CONFIG_INVALID');
  const root = fs.realpathSync(projectRoot).toLowerCase();
  let ancestor = path.resolve(directory);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (inside(path.resolve(directory).toLowerCase(), root) || inside(fs.realpathSync(ancestor).toLowerCase(), root)) fail('INVENTORY_DIRECTORY_INSIDE_PROJECT');
  fs.mkdirSync(directory, {recursive: true}); directory = fs.realpathSync(directory);
  if (inside(directory.toLowerCase(), root)) fail('INVENTORY_DIRECTORY_INSIDE_PROJECT');
  const journalFile = path.join(directory, 'inventory-ledger.ndjson');
  const lockFile = path.join(directory, 'inventory.lock');
  const stopFile = path.join(directory, 'inventory-stop.json');
  const receiptPath = number => path.join(directory, `response-${number}.json`);
  const lockToken = randomUUID();
  let lock;
  try { lock = fs.openSync(lockFile, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('INVENTORY_LOCKED'); throw error; }
  try { fs.writeFileSync(lock, JSON.stringify({pid: process.pid, token: lockToken, at: date(now)})); fs.fsyncSync(lock); }
  finally { fs.closeSync(lock); }
  const states = Object.fromEntries(SCOPES.map(scope => [scope, {scope, pages: 0, records: 0,
    cursor: null, complete: false, total: null, seen: new Set()}]));
  let rows = [], attempts = [], replies = new Map(), committed = new Map(), quota = null;
  let checkpoint = null, stopCode = null, status = 'running', firstAttempts = 0, firstPages = 0;
  let nextStart = 0, startQueue = Promise.resolve(), pendingStop = null, progressAt = 0;
  const progressQueue = [];
  let sessionQuota = false;
  const add = row => { append(journalFile, row); rows.push(row); };
  const pageCount = () => Object.values(states).reduce((n, state) => n + state.pages, 0);
  const report = () => ({version: 1, status, stopCode, attempts: attempts.length,
    requestsThisRun: attempts.length - firstAttempts, maxRequests, reserve,
    retries: attempts.filter(attempt => attempt.retry).length, pages: pageCount(),
    records: Object.values(states).reduce((n, state) => n + state.records, 0),
    checkpoint, quota: quota && {...quota,
      conservativeRemaining: Math.max(0, quota.left - 1 - (attempts.length - quota.number))},
    scopes: Object.values(states).map(({scope, pages, records, complete, total}) => ({scope, pages, records, complete, total})),
    ...(pendingStop?.pauseUntil ? {pauseUntil: pendingStop.pauseUntil} : {})});
  const notify = async final => {
    while (progressQueue.length) await onProgress(progressQueue.shift());
    if (final) await onProgress({...report(), final: true});
  };
  function saveStop(code, pauseUntil = null) {
    if (!pendingStop) {
      pendingStop = {code, at: date(now), attempts: attempts.length, ...(pauseUntil ? {pauseUntil} : {})};
      atomicJson(stopFile, pendingStop);
    }
  }
  function receiptFor(attempt) {
    const reply = replies.get(attempt.number);
    if (!reply) fail('INVENTORY_UNKNOWN_ATTEMPT');
    const bytes = fs.readFileSync(receiptPath(attempt.number));
    if (sha(bytes) !== reply.sha256) fail('INVENTORY_RECEIPT_CHANGED');
    const receipt = JSON.parse(bytes);
    if (receipt.number !== attempt.number || receipt.key !== attempt.key || receipt.specHash !== attempt.specHash
        || !Number.isFinite(Date.parse(receipt.observedAt)) || !['success', 'error'].includes(receipt.kind)) fail('INVENTORY_RECEIPT_INVALID');
    if (receipt.spec && sha(receipt.spec) !== attempt.specHash) fail('INVENTORY_RECEIPT_INVALID');
    return receipt;
  }
  function consume(attempt, receipt, replay = false) {
    if (receipt.kind !== 'success') return;
    let commit;
    if (attempt.operation === 'apiUsage') {
      quota = {...parseQuota(receipt.response, reserve), number: attempt.number, observedAt: receipt.observedAt};
      commit = {operation: attempt.operation};
    } else if (attempt.operation === 'vehicleChanges') {
      const sequence = envelope(receipt.response).meta?.latest_available_sequence;
      if (!Number.isSafeInteger(sequence) || sequence < 0 || checkpoint !== null) fail('INVENTORY_CHECKPOINT_INVALID');
      checkpoint = {sequence, observedAt: receipt.observedAt, number: attempt.number};
      commit = {operation: attempt.operation, sequence};
    } else if (attempt.operation === 'listVehicles') {
      const state = states[attempt.scope];
      if (!checkpoint || !state || state.complete || attempt.page !== state.pages + 1
          || attempt.key !== `${state.scope}/${attempt.page}` || sha(listSpec(state.scope, state.cursor)) !== attempt.specHash) fail('INVENTORY_PAGE_ORDER_INVALID');
      const page = validateInventoryPage(receipt.response, state.scope, state.cursor, state.seen);
      commit = {operation: attempt.operation, scope: state.scope, page: attempt.page,
        records: page.records, total: page.total, nextCursorHash: page.nextCursor === null ? null : sha(page.nextCursor)};
      if (state.cursor !== null) state.seen.add(sha(state.cursor));
      state.cursor = page.nextCursor; state.complete = page.nextCursor === null;
      state.pages++; state.records += page.records;
      if (page.total !== null) state.total = page.total;
    } else fail('INVENTORY_OPERATION_INVALID');
    const event = {kind: 'commit', number: attempt.number, key: attempt.key,
      observedAt: receipt.observedAt, ...commit};
    if (committed.has(attempt.number)) {
      if (JSON.stringify(committed.get(attempt.number)) !== JSON.stringify(event)) fail('INVENTORY_COMMIT_CHANGED');
    } else { add(event); committed.set(attempt.number, event); }
    if (!replay && attempt.operation === 'apiUsage') sessionQuota = true;
    if (!replay && attempt.operation === 'listVehicles' && pageCount() - progressAt >= 50) {
      progressAt = pageCount(); progressQueue.push({...report(), final: false});
    }
  }
  async function reserveAttempt(key, spec, descriptor, retry, begin) {
    const task = startQueue.then(async () => {
      if (pendingStop) fail(pendingStop.code);
      if (signal?.aborted) fail('INVENTORY_PAUSED');
      const delay = Math.max(0, nextStart - now());
      if (delay) await wait(delay);
      if (pendingStop) fail(pendingStop.code);
      if (signal?.aborted) fail('INVENTORY_PAUSED');
      if (attempts.length >= maxRequests) fail('INVENTORY_REQUEST_LIMIT');
      if (quota && attempts.length - quota.number >= quota.allowance) fail('INVENTORY_QUOTA_RESERVE');
      if (spec.operation !== 'apiUsage' && (!sessionQuota || !quota || attempts.length - quota.number >= 500)) fail('INVENTORY_USAGE_REFRESH_REQUIRED');
      const attempt = {kind: 'attempt', number: attempts.length + 1, key, specHash: sha(spec),
        operation: spec.operation, ...descriptor, retry, at: date(now)};
      add(attempt); attempts.push(attempt);
      nextStart = now() + 1000 / requestsPerSecond;
      begin();
      return attempt;
    });
    startQueue = task.catch(() => {});
    return task;
  }
  async function execute(key, spec, descriptor = {}) {
    const previous = attempts.filter(attempt => attempt.key === key);
    if (previous.some(attempt => attempt.specHash !== sha(spec))) fail('INVENTORY_REQUEST_CHANGED');
    for (;;) {
      const last = previous.at(-1);
      if (last) {
        const receipt = receiptFor(last);
        if (receipt.kind === 'success') { consume(last, receipt); return; }
        const failure = receipt.error;
        if (failure.code === 'RATE_LIMITED') {
          const pauseUntil = new Date(Date.parse(receipt.observedAt) + failure.retryAfterMs).toISOString();
          saveStop('RATE_LIMITED', pauseUntil); fail('RATE_LIMITED');
        }
        if (['AUTH', 'CONFIGURATION'].includes(failure.code)) { saveStop(failure.code); fail(failure.code); }
        if (!transientFailure(failure) || previous.length > maxRetries) { saveStop(failure.code); fail(failure.code); }
        await wait(Math.min(2000, 500 * previous.length));
      }
      let receipt;
      const controller = new AbortController();
      let timer, transport;
      const attempt = await reserveAttempt(key, spec, descriptor, previous.length > 0, () => {
        const timeout = new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort(); reject(Object.assign(Error('TIMEOUT'), {code: 'TIMEOUT', status: 504}));
          }, timeoutMs);
        });
        let pending;
        try { pending = Promise.resolve(obtain(spec, {signal: controller.signal})); }
        catch (error) { pending = Promise.reject(error); }
        transport = Promise.race([pending, timeout]);
        // The serial start gate may yield before execute attaches its handler.
        transport.catch(() => {});
      });
      previous.push(attempt);
      try {
        const response = await transport;
        receipt = {version: 1, number: attempt.number, key, spec, specHash: attempt.specHash,
          observedAt: date(now), kind: 'success', response};
      } catch (error) {
        receipt = {version: 1, number: attempt.number, key, spec, specHash: attempt.specHash,
          observedAt: date(now), kind: 'error', error: safeFailure(error, now)};
      } finally { clearTimeout(timer); }
      // The receipt and its original observation time are durable before the
      // cursor can advance. An interrupted receipt write leaves an unknown call.
      atomicJson(receiptPath(attempt.number), receipt);
      const reply = {kind: 'response', number: attempt.number,
        sha256: sha(fs.readFileSync(receiptPath(attempt.number)))};
      add(reply); replies.set(attempt.number, reply);
      if (receipt.kind === 'success') { consume(attempt, receipt); return; }
    }
  }
  try {
    const manifestFile = path.join(directory, 'inventory-manifest.json');
    const manifest = {version: 1, maxRequests, reserve, maxRetries, scopes: SCOPES, perPage: 20};
    if (fs.existsSync(manifestFile)) {
      if (JSON.stringify(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))) !== JSON.stringify(manifest)) fail('INVENTORY_RESUME_CONFIG_CHANGED');
    } else atomicJson(manifestFile, manifest);
    rows = readRows(journalFile); attempts = rows.filter(row => row.kind === 'attempt');
    firstAttempts = attempts.length;
    for (const row of rows) {
      if (row.kind === 'response') { if (replies.has(row.number)) fail('INVENTORY_LEDGER_INVALID'); replies.set(row.number, row); }
      if (row.kind === 'commit') { if (committed.has(row.number)) fail('INVENTORY_LEDGER_INVALID'); committed.set(row.number, row); }
    }
    for (const [index, attempt] of attempts.entries()) {
      if (attempt.number !== index + 1) fail('INVENTORY_LEDGER_INVALID');
      if (!replies.has(attempt.number)) {
        if (!fs.existsSync(receiptPath(attempt.number))) fail('INVENTORY_UNKNOWN_ATTEMPT');
        const reply = {kind: 'response', number: attempt.number, sha256: sha(fs.readFileSync(receiptPath(attempt.number)))};
        add(reply); replies.set(attempt.number, reply);
      }
      consume(attempt, receiptFor(attempt), true);
    }
    firstPages = pageCount(); progressAt = firstPages;
    if (fs.existsSync(stopFile)) {
      pendingStop = JSON.parse(fs.readFileSync(stopFile, 'utf8'));
      const latest = new Map(), counts = new Map();
      for (const attempt of attempts) {
        latest.set(attempt.key, attempt); counts.set(attempt.key, (counts.get(attempt.key) || 0) + 1);
      }
      const unfinished = [...latest.values()].filter(attempt => receiptFor(attempt).kind === 'error');
      let resumeEvent;
      if (pendingStop.code === 'INVENTORY_QUOTA_INVALID' && resumePlanChange !== null) {
        const attempt = attempts.find(item => item.number === resumePlanChange.receiptNumber);
        if (!attempt || attempt.operation !== 'apiUsage' || attempt.specHash !== sha({operation: 'apiUsage'})
            || attempt.number !== pendingStop.attempts || attempt.number !== attempts.length
            || replies.get(attempt.number)?.sha256 !== resumePlanChange.receiptSha256
            || unfinished.length) fail('INVENTORY_PLAN_RESUME_BLOCKED');
        const receipt = receiptFor(attempt);
        const previous = attempts.findLast(item => item.operation === 'apiUsage' && item.number < attempt.number
          && receiptFor(item).kind === 'success');
        const before = previous && parseQuota(receiptFor(previous).response, reserve);
        const after = receipt.kind === 'success' && parseQuota(receipt.response, reserve);
        if (before?.plan !== 'Basic' || after?.plan !== 'Pro' || after.limit !== 100000) fail('INVENTORY_PLAN_RESUME_BLOCKED');
        resumeEvent = {reason: 'explicit_plan_change_resume', receiptNumber: attempt.number,
          receiptSha256: resumePlanChange.receiptSha256, previousPlan: before.plan, plan: after.plan,
          quotaLimit: after.limit, perPage: 20};
      } else {
        if (!resumeTransientStop || !['TIMEOUT', 'UPSTREAM'].includes(pendingStop.code)) fail(pendingStop.code || 'INVENTORY_STOP_LATCH');
        if (!Number.isSafeInteger(pendingStop.attempts) || pendingStop.attempts < 1 || pendingStop.attempts > attempts.length
            || !unfinished.length || !unfinished.some(attempt => receiptFor(attempt).error?.code === pendingStop.code)
            || unfinished.some(attempt => !transientFailure(receiptFor(attempt).error))) fail('INVENTORY_TRANSIENT_RESUME_BLOCKED');
        if (unfinished.some(attempt => counts.get(attempt.key) > maxRetries)) fail('INVENTORY_TRANSIENT_RETRIES_EXHAUSTED');
        resumeEvent = {reason: 'explicit_transient_resume', failedAttempts: unfinished.map(attempt => attempt.number)};
      }
      const archive = `inventory-stop-resumed-${attempts.length}-${randomUUID()}.json`;
      add({kind: 'resume', at: date(now), ...resumeEvent, code: pendingStop.code, attempts: attempts.length,
        stopSha256: sha(fs.readFileSync(stopFile)), archive});
      // Keep the original stop as evidence. The process lock and fully verified
      // receipts precede this explicit transition; no manifest or receipt changes.
      fs.renameSync(stopFile, path.join(directory, archive)); syncDirectory(directory);
      pendingStop = null;
    }
    const refresh = () => {
      const previous = attempts.findLast(attempt => attempt.operation === 'apiUsage');
      // A stopped usage read is the same logical request on resume; allocating a
      // fresh key here would silently replenish that request's retry allowance.
      const key = previous && receiptFor(previous).kind === 'error'
        ? previous.key : `usage/${attempts.length + 1}`;
      return execute(key, {operation: 'apiUsage'});
    };
    if (!Object.values(states).every(state => state.complete)) {
      await refresh();
      if (!checkpoint) await execute('checkpoint', {operation: 'vehicleChanges', after: 0, limit: 1});
    }
    let rotation = 0;
    while (!Object.values(states).every(state => state.complete)) {
      if (pageCount() - firstPages >= maxPagesPerRun || signal?.aborted) { status = 'paused'; break; }
      if (attempts.length - quota.number >= 500) await refresh();
      const available = SCOPES.filter(scope => !states[scope].complete);
      const capacity = Math.min(concurrency, 500 - (attempts.length - quota.number),
        maxPagesPerRun - (pageCount() - firstPages), available.length);
      const selected = Array.from({length: capacity}, (_, index) => available[(rotation + index) % available.length]);
      rotation = (rotation + capacity) % available.length;
      const results = await Promise.allSettled(selected.map(scope => {
        const state = states[scope], page = state.pages + 1;
        return execute(`${scope}/${page}`, listSpec(scope, state.cursor), {scope, page});
      }));
      await notify(false);
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      const fatal = failures.find(error => error.code !== 'INVENTORY_USAGE_REFRESH_REQUIRED');
      if (fatal) throw fatal;
      if (failures.length) await refresh();
    }
    if (status === 'running') status = 'complete';
  } catch (error) {
    stopCode = /^[A-Z][A-Z0-9_]{1,70}$/.test(error?.code || '') ? error.code : 'INVENTORY_LOCAL_FAILURE';
    status = stopCode === 'INVENTORY_PAUSED' ? 'paused' : 'stopped';
    if (!['INVENTORY_REQUEST_LIMIT', 'INVENTORY_QUOTA_RESERVE', 'INVENTORY_PAUSED',
      'INVENTORY_RESUME_CONFIG_CHANGED'].includes(stopCode)) saveStop(stopCode);
  } finally {
    try { atomicJson(path.join(directory, 'inventory-report.json'), report()); await notify(true); }
    finally {
      if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).token === lockToken) fs.unlinkSync(lockFile);
    }
  }
  return report();
}

// Stable commit descriptors for a separate importer. The receipt's response is
// the original JSON; observation time is never changed by replay or import.
function readDownloadedPages(directory, {loadResponse = false} = {}) {
  const rows = readRows(path.join(directory, 'inventory-ledger.ndjson'));
  const replies = new Map(rows.filter(row => row.kind === 'response').map(row => [row.number, row]));
  return rows.filter(row => row.kind === 'commit' && row.operation === 'listVehicles')
    .sort((a, b) => a.number - b.number).map(row => {
      const file = path.join(directory, `response-${row.number}.json`);
      const [platform, status] = row.scope.split(':');
      const descriptor = {id: row.number, scope: row.scope, platform, status, page: row.page,
        path: file, observedAt: row.observedAt, records: row.records,
        sha256: replies.get(row.number)?.sha256};
      if (loadResponse) {
        const bytes = fs.readFileSync(file);
        if (sha(bytes) !== descriptor.sha256) fail('INVENTORY_RECEIPT_CHANGED');
        const receipt = JSON.parse(bytes);
        if (receipt.kind !== 'success' || receipt.observedAt !== descriptor.observedAt) fail('INVENTORY_RECEIPT_INVALID');
        descriptor.response = receipt.response;
      }
      return descriptor;
    });
}

module.exports = {SCOPES, runInventoryDownload, readDownloadedPages, validateInventoryPage};
