'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {runInventoryDownload, readDownloadedPages, SCOPES} = require('../scripts/inventory-download.cjs');

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rexbid-inventory-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  let time = Date.parse('2026-10-26T12:00:00Z');
  const calls = [], progress = [];
  const config = {directory, maxRequests: 100, now: () => time,
    wait: async milliseconds => { time += milliseconds; },
    onProgress: event => progress.push(event), ...overrides};
  function quota(left = 29000) {
    return {ok: true, data: {plan: {name: 'Basic', per_page_limit: 20},
      quota: {limit: 30000, used: 30000 - left, left}}};
  }
  function page(spec, {next = null, total = 1, records = 1} = {}) {
    const params = spec.params;
    return {ok: true, data: Array.from({length: records}, (_, index) => ({
      platform: params.platform, lot_number: String(index + 100), auction: {state: params.lot_sub_status.toLowerCase()}
    })), meta: {platform: params.platform, per_page: 20, next_cursor: next,
      has_more: next !== null, total, applied_filters: {
        ...params, per_page: '20', ...(params.include_total ? {include_total: 'true'} : {}),
        lot_status: 'All', upcoming: 'all', view: 'full'
      }, unknown_filters: []}};
  }
  const obtain = async spec => {
    calls.push({spec: structuredClone(spec), at: time});
    if (spec.operation === 'apiUsage') return quota();
    if (spec.operation === 'vehicleChanges') return {ok: true, data: [], meta: {latest_available_sequence: 123456}};
    return page(spec);
  };
  return {config, directory, calls, progress, quota, page, obtain};
}
const rowsOf = directory => fs.readFileSync(path.join(directory, 'inventory-ledger.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
const writeRows = (directory, rows) => fs.writeFileSync(path.join(directory, 'inventory-ledger.ndjson'), rows.map(JSON.stringify).join('\n') + '\n');

test('captures quota and changes watermark before all four unfiltered scopes; receipts keep original dates', async t => {
  const f = fixture(t);
  const report = await runInventoryDownload({...f.config, obtain: f.obtain});
  assert.equal(report.status, 'complete'); assert.equal(report.attempts, 6);
  assert.equal(report.pages, 4); assert.equal(report.records, 4);
  assert.deepEqual(f.calls.slice(0, 2).map(call => call.spec.operation), ['apiUsage', 'vehicleChanges']);
  assert.deepEqual(f.calls[1].spec, {operation: 'vehicleChanges', after: 0, limit: 1});
  assert.deepEqual(new Set(f.calls.slice(2).map(call => `${call.spec.params.platform}:${call.spec.params.lot_sub_status}`)), new Set(SCOPES));
  for (const {spec} of f.calls.slice(2)) assert.deepEqual(Object.keys(spec.params).sort(), ['include_total', 'lot_sub_status', 'per_page', 'platform']);
  for (let index = 1; index < f.calls.length; index++) assert.ok(f.calls[index].at - f.calls[index - 1].at >= 250);
  assert.equal(report.checkpoint.sequence, 123456);
  assert.equal(f.progress.at(-1).final, true);
  const pages = readDownloadedPages(f.directory, {loadResponse: true});
  assert.equal(pages.length, 4); assert.equal(pages[0].response.ok, true);
  const resumed = await runInventoryDownload({...f.config, obtain: () => assert.fail('completed replay must use cache')});
  assert.equal(resumed.attempts, 6); assert.equal(resumed.requestsThisRun, 0);
  assert.deepEqual(readDownloadedPages(f.directory, {loadResponse: true}), pages);
});

test('paused traversal resumes stored cursors without repeating successful pages', async t => {
  const f = fixture(t, {concurrency: 1});
  const obtain = async spec => spec.operation === 'listVehicles'
    ? (f.calls.push({spec}), f.page(spec, {next: spec.params.cursor ? null : `${spec.params.platform}-${spec.params.lot_sub_status}-page2`, total: 2}))
    : f.obtain(spec);
  const first = await runInventoryDownload({...f.config, obtain, maxPagesPerRun: 3});
  assert.equal(first.status, 'paused'); assert.equal(first.pages, 3);
  const second = await runInventoryDownload({...f.config, obtain});
  assert.equal(second.status, 'complete'); assert.equal(second.pages, 8);
  const listCalls = f.calls.filter(call => call.spec.operation === 'listVehicles');
  assert.equal(new Set(listCalls.map(call => JSON.stringify(call.spec))).size, 8);
  assert.equal(listCalls.length, 8);
  assert.equal(f.calls.filter(call => call.spec.operation === 'vehicleChanges').length, 1);
  for (const {spec} of listCalls.filter(call => call.spec.params.cursor)) assert.equal(Object.hasOwn(spec.params, 'include_total'), false);
  assert.doesNotMatch(JSON.stringify(second), /page2/);
});

test('recovers a saved receipt after interrupted response and commit journal writes', async t => {
  const f = fixture(t);
  await runInventoryDownload({...f.config, obtain: f.obtain});
  const pages = readDownloadedPages(f.directory);
  const last = pages.at(-1), before = fs.readFileSync(last.path, 'utf8');
  writeRows(f.directory, rowsOf(f.directory).filter(row => !(row.number === last.id && ['response', 'commit'].includes(row.kind))));
  const report = await runInventoryDownload({...f.config, obtain: () => assert.fail('durable receipt must be reused')});
  assert.equal(report.status, 'complete'); assert.equal(report.attempts, 6);
  assert.equal(fs.readFileSync(last.path, 'utf8'), before);
  assert.equal(readDownloadedPages(f.directory).length, 4);
});

test('unknown durable attempts stop before any network request', async t => {
  const f = fixture(t);
  await runInventoryDownload({...f.config, obtain: f.obtain});
  const rows = rowsOf(f.directory), attempt = rows.filter(row => row.kind === 'attempt').at(-1);
  fs.unlinkSync(path.join(f.directory, `response-${attempt.number}.json`));
  writeRows(f.directory, rows.filter(row => !(row.number === attempt.number && ['response', 'commit'].includes(row.kind))));
  const report = await runInventoryDownload({...f.config, obtain: () => assert.fail('unknown attempt cannot retry')});
  assert.equal(report.status, 'stopped'); assert.equal(report.stopCode, 'INVENTORY_UNKNOWN_ATTEMPT');
  assert.equal(report.attempts, 6);
  const resumed = await runInventoryDownload({...f.config, resumeTransientStop: true,
    obtain: () => assert.fail('explicit transient resume cannot clear an unknown attempt')});
  assert.equal(resumed.stopCode, 'INVENTORY_UNKNOWN_ATTEMPT');
});

test('lifetime standalone cap counts quota, checkpoint and failed attempts, and persists over restart', async t => {
  const f = fixture(t, {maxRequests: 4});
  const first = await runInventoryDownload({...f.config, obtain: f.obtain});
  assert.equal(first.status, 'stopped'); assert.equal(first.stopCode, 'INVENTORY_REQUEST_LIMIT');
  assert.equal(first.attempts, 4); assert.equal(first.pages, 2);
  const second = await runInventoryDownload({...f.config, obtain: () => assert.fail('cap cannot reset on resume')});
  assert.equal(second.attempts, 4); assert.equal(second.stopCode, 'INVENTORY_REQUEST_LIMIT');
  await assert.rejects(runInventoryDownload({...f.config, obtain: f.obtain, maxRequests: 10001}), /INVENTORY_CONFIG_INVALID/);
});

test('provider quota reserve includes the usage charge and stops before spending the reserve', async t => {
  const f = fixture(t);
  let calls = 0;
  const report = await runInventoryDownload({...f.config, obtain: async spec => {
    calls++; return spec.operation === 'apiUsage' ? f.quota(1002) : f.obtain(spec);
  }});
  assert.equal(report.stopCode, 'INVENTORY_QUOTA_RESERVE'); assert.equal(calls, 2);
  assert.equal(report.attempts, 2); assert.equal(report.pages, 0);
  assert.equal(report.quota.conservativeRemaining, 1000);
});

test('invalid envelopes, incorrect echoes and oversized pages are cached but never committed', async t => {
  const mutations = [
    response => { response.ok = false; },
    response => { response.meta.applied_filters.lot_sub_status = 'Sold'; },
    response => { response.meta.platform = 'iaai'; },
    response => { response.meta.applied_filters.make = 'Ford'; },
    response => { delete response.meta.next_cursor; },
    response => { response.data = Array(21).fill(response.data[0]); },
    response => { response.data[0].auction.state = 'sold'; }
  ];
  for (const mutate of mutations) {
    const f = fixture(t, {concurrency: 1});
    const report = await runInventoryDownload({...f.config, obtain: async spec => {
      if (spec.operation !== 'listVehicles') return f.obtain(spec);
      const response = f.page(spec); mutate(response); return response;
    }});
    assert.equal(report.status, 'stopped'); assert.equal(report.pages, 0);
    assert.equal(readDownloadedPages(f.directory).length, 0);
    assert.ok(fs.existsSync(path.join(f.directory, 'response-3.json')));
  }
});

test('repeated cursors across multiple pages stop without advancing the repeated page', async t => {
  const f = fixture(t, {concurrency: 1});
  const report = await runInventoryDownload({...f.config, obtain: async spec => {
    if (spec.operation !== 'listVehicles') return f.obtain(spec);
    if (spec.params.platform !== 'copart' || spec.params.lot_sub_status !== 'Open') return f.page(spec);
    return f.page(spec, {next: spec.params.cursor === 'a' ? 'b' : 'a', total: 5});
  }});
  assert.equal(report.stopCode, 'INVENTORY_REPEATED_CURSOR');
  assert.equal(report.scopes.find(scope => scope.scope === 'copart:Open').pages, 2);
});

test('two bounded retries count against the budget; auth and 429 never retry', async t => {
  const f = fixture(t, {concurrency: 1});
  let failures = 0;
  const result = await runInventoryDownload({...f.config, obtain: async spec => {
    if (spec.operation === 'listVehicles' && failures++ < 2) throw Object.assign(Error('secret'), {code: 'UPSTREAM', status: 503});
    return f.obtain(spec);
  }});
  assert.equal(result.status, 'complete'); assert.equal(result.attempts, 8); assert.equal(result.retries, 2);
  for (const [code, status] of [['AUTH', 401], ['RATE_LIMITED', 429], ['UPSTREAM', 503]]) {
    const stop = fixture(t, {concurrency: 1}); let calls = 0;
    const report = await runInventoryDownload({...stop.config, obtain: async spec => {
      calls++;
      if (spec.operation === 'listVehicles') throw Object.assign(Error('X-API-Key=secret cursor=private'), {code, status, retryAfter: 120});
      return stop.obtain(spec);
    }});
    assert.equal(report.status, 'stopped'); assert.equal(report.stopCode, code);
    assert.equal(calls, code === 'UPSTREAM' ? 5 : 3);
    if (code === 'RATE_LIMITED') assert.ok(Date.parse(report.pauseUntil) > Date.parse('2026-10-26T12:00:00Z'));
    assert.doesNotMatch(JSON.stringify(report), /secret|private/);
    assert.doesNotMatch(fs.readFileSync(path.join(stop.directory, 'response-3.json'), 'utf8'), /secret|private/);
    await runInventoryDownload({...stop.config, obtain: () => assert.fail('stop latch prevents a new call')});
    const retry = await runInventoryDownload({...stop.config, resumeTransientStop: true,
      obtain: () => assert.fail('resume cannot clear auth/rate limits or replenish exhausted retries')});
    assert.equal(retry.stopCode, code === 'UPSTREAM' ? 'INVENTORY_TRANSIENT_RETRIES_EXHAUSTED' : code);
  }
});

test('ledger reservation exists before transport; single process lock excludes concurrent runs', async t => {
  const f = fixture(t, {concurrency: 1}); let active = 0;
  const report = await runInventoryDownload({...f.config, obtain: async spec => {
    active++;
    const attempts = rowsOf(f.directory).filter(row => row.kind === 'attempt');
    assert.equal(attempts.at(-1).operation, spec.operation);
    await assert.rejects(runInventoryDownload({...f.config, obtain: f.obtain}), /INVENTORY_LOCKED/);
    active--; return f.obtain(spec);
  }});
  assert.equal(report.status, 'complete'); assert.equal(active, 0);
  assert.equal(fs.existsSync(path.join(f.directory, 'inventory.lock')), false);
});

test('usage refresh is due after at most 500 attempts and progress emits every 50 pages', async t => {
  const f = fixture(t, {maxRequests: 600});
  let count = 0, lastUsage = 0, maximumGap = 0;
  const report = await runInventoryDownload({...f.config, obtain: async spec => {
    count++;
    if (spec.operation === 'apiUsage') {
      maximumGap = Math.max(maximumGap, count - lastUsage); lastUsage = count;
      return count > 500 ? {ok: true, data: {plan: {name: 'Pro', per_page_limit: 40},
        quota: {limit: 100000, used: count, left: 100000 - count}}} : f.quota(29000 - count);
    }
    if (spec.operation !== 'listVehicles') return f.obtain(spec);
    const number = Number(spec.params.cursor || 0);
    return f.page(spec, {next: number < 125 ? String(number + 1) : null, total: 126});
  }});
  assert.equal(report.status, 'complete'); assert.equal(report.pages, 504);
  assert.equal(report.attempts, 507); assert.ok(maximumGap <= 501);
  assert.equal(report.quota.plan, 'Pro'); assert.equal(report.quota.perPageLimit, 40);
  const progress = f.progress.filter(event => !event.final);
  assert.equal(progress.length, 10);
  assert.ok(progress.every((event, index) => event.pages === (index + 1) * 50));
});

test('corrupted receipts and truncated journal stop without transport', async t => {
  const f = fixture(t);
  await runInventoryDownload({...f.config, obtain: f.obtain});
  const file = path.join(f.directory, 'response-3.json');
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8')); receipt.observedAt = '2020-01-01T00:00:00Z';
  fs.writeFileSync(file, JSON.stringify(receipt));
  const report = await runInventoryDownload({...f.config, obtain: () => assert.fail('corruption cannot trigger API')});
  assert.equal(report.stopCode, 'INVENTORY_RECEIPT_CHANGED');
  assert.throws(() => readDownloadedPages(f.directory, {loadResponse: true}), /INVENTORY_RECEIPT_CHANGED/);
  const g = fixture(t); fs.writeFileSync(path.join(g.directory, 'inventory-ledger.ndjson'), '{"kind":"attempt"');
  const truncated = await runInventoryDownload({...g.config, obtain: () => assert.fail('truncated reservation cannot trigger API')});
  assert.equal(truncated.stopCode, 'INVENTORY_LEDGER_TRUNCATED');
});

test('project cache paths are rejected before transport', async t => {
  const f = fixture(t);
  await assert.rejects(runInventoryDownload({...f.config,
    directory: path.resolve(__dirname, '../data/not-created-inventory'), obtain: f.obtain}), /INVENTORY_DIRECTORY_INSIDE_PROJECT/);
});

test('at most two scope transports overlap and bounded timeout aborts before retry', async t => {
  const f = fixture(t);
  let active = 0, maximum = 0;
  const report = await runInventoryDownload({...f.config, obtain: async spec => {
    if (spec.operation !== 'listVehicles') return f.obtain(spec);
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--; return f.page(spec);
  }});
  assert.equal(report.status, 'complete'); assert.equal(maximum, 2); assert.equal(active, 0);
  const g = fixture(t, {concurrency: 1, timeoutMs: 10});
  let timedOut = false, aborted = false;
  const recovered = await runInventoryDownload({...g.config, obtain: async (spec, {signal}) => {
    if (spec.operation === 'listVehicles' && !timedOut) {
      timedOut = true;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        aborted = true; reject(Object.assign(Error('aborted'), {code: 'TIMEOUT', status: 504}));
      }, {once: true}));
    }
    return g.obtain(spec);
  }});
  assert.equal(recovered.status, 'complete'); assert.equal(recovered.attempts, 7);
  assert.equal(recovered.retries, 1); assert.equal(aborted, true);
});

test('provider network failures without HTTP status retry within the original counted allowance', async t => {
  const {ProviderError} = require('../providers/apibara.js');
  const f = fixture(t, {concurrency: 1}); let failures = 0;
  const report = await runInventoryDownload({...f.config, obtain: async spec => {
    if (spec.operation === 'listVehicles' && failures++ < 2) throw new ProviderError('apibara', 'UPSTREAM');
    return f.obtain(spec);
  }});
  assert.equal(report.status, 'complete'); assert.equal(report.attempts, 8); assert.equal(report.retries, 2);
  const failed = JSON.parse(fs.readFileSync(path.join(f.directory, 'response-3.json'), 'utf8'));
  assert.equal(failed.error.code, 'UPSTREAM'); assert.equal(failed.error.status, null);
});

test('httpStatus aliases are retained and authentication/throttling override conflicting fields', async t => {
  for (const failure of [
    {code: 'UPSTREAM', httpStatus: 503},
    {code: 'UPSTREAM', httpStatus: 401, status: 503},
    {code: 'UPSTREAM', httpStatus: 429, status: 503},
    {code: 'UPSTREAM', httpStatus: 400}
  ]) {
    const f = fixture(t, {concurrency: 1}); let failed = false;
    const report = await runInventoryDownload({...f.config, obtain: async spec => {
      if (spec.operation === 'listVehicles' && !failed) { failed = true; throw Object.assign(Error('private'), failure); }
      return f.obtain(spec);
    }});
    const receipt = JSON.parse(fs.readFileSync(path.join(f.directory, 'response-3.json'), 'utf8'));
    assert.equal(receipt.error.status, failure.httpStatus);
    if (failure.httpStatus === 503) { assert.equal(report.status, 'complete'); assert.equal(report.attempts, 7); }
    else { assert.equal(report.status, 'stopped'); assert.equal(report.attempts, 3); }
    if (failure.httpStatus === 401) assert.equal(report.stopCode, 'AUTH');
    if (failure.httpStatus === 429) assert.equal(report.stopCode, 'RATE_LIMITED');
  }
});

test('explicit transient resume preserves cached pages, receipts, manifest and original retry counts', async t => {
  const f = fixture(t, {concurrency: 1});
  // Simulate the legacy stop after a durable UPSTREAM/no-response receipt, at
  // the retry wait boundary; no request or response file is fabricated/removed.
  const first = await runInventoryDownload({...f.config,
    wait: async milliseconds => {
      if (milliseconds === 500) throw Object.assign(Error('interrupted retry wait'), {code: 'UPSTREAM'});
      await f.config.wait(milliseconds);
    },
    obtain: async spec => {
      if (spec.operation !== 'listVehicles') return f.obtain(spec);
      if (spec.params.cursor) throw Object.assign(Error('network'), {code: 'UPSTREAM', status: null});
      return f.page(spec, {next: 'second-page', total: 2});
    }});
  assert.equal(first.stopCode, 'UPSTREAM'); assert.equal(first.pages, 4); assert.equal(first.attempts, 7);
  const manifestFile = path.join(f.directory, 'inventory-manifest.json');
  const manifest = fs.readFileSync(manifestFile, 'utf8');
  const receipts = new Map(Array.from({length: first.attempts}, (_, index) => {
    const name = `response-${index + 1}.json`; return [name, fs.readFileSync(path.join(f.directory, name), 'utf8')];
  }));
  const stillStopped = await runInventoryDownload({...f.config, obtain: () => assert.fail('resume must be explicit')});
  assert.equal(stillStopped.stopCode, 'UPSTREAM'); assert.equal(stillStopped.requestsThisRun, 0);
  const resumed = await runInventoryDownload({...f.config, resumeTransientStop: true, obtain: f.obtain});
  assert.equal(resumed.status, 'complete'); assert.equal(resumed.pages, 8);
  assert.equal(resumed.attempts, 12); assert.equal(resumed.requestsThisRun, 5); assert.equal(resumed.retries, 1);
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), manifest);
  for (const [name, original] of receipts) assert.equal(fs.readFileSync(path.join(f.directory, name), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(f.directory, 'inventory-stop.json')), false);
  const resume = rowsOf(f.directory).find(row => row.kind === 'resume');
  assert.deepEqual(resume.failedAttempts, [7]); assert.equal(resume.reason, 'explicit_transient_resume');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, resume.archive), 'utf8')).code, 'UPSTREAM');
  const oldAttempt = rowsOf(f.directory).find(row => row.kind === 'attempt' && row.number === 7);
  assert.equal(rowsOf(f.directory).filter(row => row.kind === 'attempt' && row.key === oldAttempt.key).length, 2);
});

test('transient resume never resets exhausted retries or the lifetime request cap', async t => {
  const f = fixture(t, {concurrency: 1});
  const stopped = await runInventoryDownload({...f.config, obtain: async spec => {
    if (spec.operation === 'listVehicles') throw Object.assign(Error('network'), {code: 'UPSTREAM', status: null});
    return f.obtain(spec);
  }});
  assert.equal(stopped.attempts, 5); assert.equal(stopped.retries, 2);
  const stopFile = path.join(f.directory, 'inventory-stop.json'), original = fs.readFileSync(stopFile, 'utf8');
  const retry = await runInventoryDownload({...f.config, resumeTransientStop: true,
    obtain: () => assert.fail('all per-request retries remain spent')});
  assert.equal(retry.stopCode, 'INVENTORY_TRANSIENT_RETRIES_EXHAUSTED'); assert.equal(retry.attempts, 5);
  assert.equal(fs.readFileSync(stopFile, 'utf8'), original);
  assert.equal(rowsOf(f.directory).filter(row => row.kind === 'resume').length, 0);
  const g = fixture(t, {concurrency: 1, maxRequests: 3});
  const capped = await runInventoryDownload({...g.config, obtain: async spec => {
    if (spec.operation === 'listVehicles') throw Object.assign(Error('network'), {code: 'UPSTREAM', status: null});
    return g.obtain(spec);
  }});
  assert.equal(capped.stopCode, 'INVENTORY_REQUEST_LIMIT'); assert.equal(capped.attempts, 3);
  const cappedAgain = await runInventoryDownload({...g.config, resumeTransientStop: true,
    obtain: () => assert.fail('standalone budget stays exhausted')});
  assert.equal(cappedAgain.stopCode, 'INVENTORY_REQUEST_LIMIT'); assert.equal(cappedAgain.attempts, 3);
});

test('resuming a failed usage read keeps its original request key and retry allowance', async t => {
  const f = fixture(t, {concurrency: 1});
  const first = await runInventoryDownload({...f.config,
    wait: async milliseconds => {
      if (milliseconds === 500) throw Object.assign(Error('retry interrupted'), {code: 'UPSTREAM'});
      await f.config.wait(milliseconds);
    }, obtain: async () => { throw Object.assign(Error('network'), {code: 'UPSTREAM', status: null}); }});
  assert.equal(first.attempts, 1); assert.equal(first.stopCode, 'UPSTREAM');
  const resumed = await runInventoryDownload({...f.config, resumeTransientStop: true, obtain: f.obtain});
  assert.equal(resumed.status, 'complete'); assert.equal(resumed.attempts, 7); assert.equal(resumed.retries, 1);
  const usageAttempts = rowsOf(f.directory).filter(row => row.kind === 'attempt' && row.operation === 'apiUsage');
  assert.equal(usageAttempts.length, 2); assert.equal(usageAttempts[0].key, usageAttempts[1].key);
});

const proQuota = () => ({ok: true, data: {plan: {name: 'Pro', per_page_limit: 40},
  quota: {limit: 100000, used: 3000, left: 97000}}});
const digest = value => createHash('sha256').update(value).digest('hex');
async function legacyPlanStop(t, response = proQuota()) {
  const f = fixture(t, {concurrency: 1, maxRequests: 9000});
  const initial = await runInventoryDownload({...f.config, maxPagesPerRun: 1, obtain: f.obtain});
  assert.equal(initial.status, 'paused');
  // Old Basic-only code saves the successful HTTP receipt before rejecting its
  // new plan metadata. Reproduce that precise durable boundary in the fixture.
  const number = initial.attempts + 1, spec = {operation: 'apiUsage'}, key = `usage/${number}`;
  const at = new Date(f.config.now()).toISOString(), specHash = digest(JSON.stringify(spec));
  const attempt = {kind: 'attempt', number, key, specHash, operation: 'apiUsage', retry: false, at};
  const receipt = {version: 1, number, key, spec, specHash, observedAt: at, kind: 'success', response};
  const bytes = JSON.stringify(receipt), file = path.join(f.directory, `response-${number}.json`);
  fs.writeFileSync(file, bytes);
  const receiptSha256 = digest(bytes);
  writeRows(f.directory, [...rowsOf(f.directory), attempt, {kind: 'response', number, sha256: receiptSha256}]);
  fs.writeFileSync(path.join(f.directory, 'inventory-stop.json'), JSON.stringify({code: 'INVENTORY_QUOTA_INVALID', at, attempts: number}));
  return {...f, receiptFile: file, receiptBytes: bytes, proof: {receiptNumber: number, receiptSha256}};
}

test('known Basic and Pro quotas remain bounded and page requests stay at twenty', async t => {
  for (const [name, limit, perPage] of [['Basic', 30000, 20], ['Basic', 30000, 40], ['Pro', 100000, 40], ['Pro', 50000, 20]]) {
    const f = fixture(t, {maxRequests: 9000});
    const report = await runInventoryDownload({...f.config, obtain: async spec => {
      if (spec.operation === 'apiUsage') return {ok: true, data: {
        plan: {name, per_page_limit: perPage}, quota: {limit, used: 3000, left: limit - 3000}}};
      if (spec.operation === 'listVehicles') assert.equal(spec.params.per_page, 20);
      return f.obtain(spec);
    }});
    assert.equal(report.status, 'complete'); assert.equal(report.quota.plan, name);
    assert.equal(report.quota.limit, limit); assert.equal(report.maxRequests, 9000); assert.equal(report.reserve, 1000);
    const manifest = JSON.parse(fs.readFileSync(path.join(f.directory, 'inventory-manifest.json'), 'utf8'));
    assert.equal(manifest.perPage, 20); assert.equal(manifest.maxRequests, 9000); assert.equal(manifest.reserve, 1000);
  }
});

test('unknown plans, inconsistent quota and unsupported capabilities stop before list requests', async t => {
  const mutations = [
    value => { value.data.plan.name = 'Enterprise'; },
    value => { value.data.plan.name = 'Basic'; },
    value => { value.data.quota.limit = 100001; value.data.quota.left = 97001; },
    value => { value.data.quota.used++; },
    value => { value.data.quota.left = -1; },
    value => { value.data.quota.limit = '100000'; },
    value => { value.data.plan.per_page_limit = 19; },
    value => { value.data.plan.per_page_limit = 41; },
    value => { value.data.plan.per_page_limit = '40'; },
    value => { value.data.plan.per_page_limit = 20.5; }
  ];
  for (const mutate of mutations) {
    const f = fixture(t), response = proQuota(); mutate(response);
    const report = await runInventoryDownload({...f.config, obtain: async spec => {
      assert.equal(spec.operation, 'apiUsage'); return response;
    }});
    assert.equal(report.stopCode, 'INVENTORY_QUOTA_INVALID'); assert.equal(report.attempts, 1); assert.equal(report.pages, 0);
  }
});

test('plan-change resume requires the exact Pro upgrade receipt and preserves immutable campaign data', async t => {
  const f = await legacyPlanStop(t);
  const manifestFile = path.join(f.directory, 'inventory-manifest.json'), manifest = fs.readFileSync(manifestFile, 'utf8');
  const defaultResume = await runInventoryDownload({...f.config, obtain: () => assert.fail('plan recovery must be explicit')});
  assert.equal(defaultResume.stopCode, 'INVENTORY_QUOTA_INVALID');
  const wrongProof = await runInventoryDownload({...f.config,
    resumePlanChange: {...f.proof, receiptSha256: '0'.repeat(64)}, obtain: () => assert.fail('wrong digest cannot authorize recovery')});
  assert.equal(wrongProof.stopCode, 'INVENTORY_PLAN_RESUME_BLOCKED');
  const resumed = await runInventoryDownload({...f.config, resumePlanChange: f.proof, obtain: async spec => {
    if (spec.operation === 'apiUsage') return proQuota();
    if (spec.operation === 'listVehicles') assert.equal(spec.params.per_page, 20);
    return f.obtain(spec);
  }});
  assert.equal(resumed.status, 'complete'); assert.equal(resumed.pages, 4); assert.equal(resumed.attempts, 8);
  assert.equal(resumed.maxRequests, 9000); assert.equal(resumed.reserve, 1000);
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), manifest);
  assert.equal(fs.readFileSync(f.receiptFile, 'utf8'), f.receiptBytes);
  const event = rowsOf(f.directory).find(row => row.kind === 'resume');
  assert.equal(event.reason, 'explicit_plan_change_resume'); assert.equal(event.receiptNumber, f.proof.receiptNumber);
  assert.equal(event.receiptSha256, f.proof.receiptSha256); assert.equal(event.previousPlan, 'Basic'); assert.equal(event.plan, 'Pro');
  assert.equal(fs.existsSync(path.join(f.directory, event.archive)), true);
});

test('plan-change recovery never clears bad quota, changed receipts, unrelated plans or protected stop reasons', async t => {
  for (const alter of [
    response => { response.data.quota.used++; },
    response => { response.data.plan.name = 'Unknown'; },
    response => { response.data.quota.limit = 90000; response.data.quota.left = 87000; },
    response => { response.data.plan.name = 'Basic'; response.data.quota.limit = 30000; response.data.quota.left = 27000; }
  ]) {
    const response = proQuota(); alter(response); const f = await legacyPlanStop(t, response);
    const report = await runInventoryDownload({...f.config, resumePlanChange: f.proof,
      obtain: () => assert.fail('only the exact verified Basic to Pro100k change is recoverable')});
    assert.equal(report.status, 'stopped'); assert.equal(report.requestsThisRun, 0);
    assert.equal(fs.existsSync(path.join(f.directory, 'inventory-stop.json')), true);
    assert.equal(rowsOf(f.directory).some(row => row.kind === 'resume'), false);
  }
  for (const code of ['AUTH', 'RATE_LIMITED', 'INVENTORY_UNKNOWN_ATTEMPT']) {
    const f = await legacyPlanStop(t), file = path.join(f.directory, 'inventory-stop.json');
    const original = {...JSON.parse(fs.readFileSync(file, 'utf8')), code};fs.writeFileSync(file, JSON.stringify(original));
    const report = await runInventoryDownload({...f.config, resumePlanChange: f.proof,
      obtain: () => assert.fail('protected stop reason cannot be replaced by plan proof')});
    assert.equal(report.stopCode, code);assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
  }
  const f = await legacyPlanStop(t);fs.writeFileSync(f.receiptFile, f.receiptBytes + ' ');
  const corrupted = await runInventoryDownload({...f.config, resumePlanChange: f.proof,
    obtain: () => assert.fail('changed receipt is not a valid plan-change proof')});
  assert.equal(corrupted.stopCode, 'INVENTORY_RECEIPT_CHANGED');
});
