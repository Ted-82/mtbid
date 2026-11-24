'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), {DatabaseSync} = require('node:sqlite');
const {RefreshStore} = require('../sync/automatic-refresh.cjs');
const {countedFeedRequest, safeAdaptiveGapLimit} = require('../sync/feed-api-request.cjs');
const {parseChangesResponse} = require('../providers/apibara.js');
const NOW = Date.parse('2026-10-29T12:00:00.000Z'), AT = new Date(NOW).toISOString();
const CHECKED = '2026-10-29T11:00:00.000Z', SECRET = 'offline-only-test-key';
const changes = {operation: 'vehicleChanges', after: 100, limit: 500};
const detail = {operation: 'vehicleByIdentifier', identifier: '10000001', platform: 'copart'};
const jsonResponse = (value, options = {}) => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}, ...options});
const usage = (left = 90000) => ({ok: true, data: {quota: {used: 100000 - left, limit: 100000, left}, plan: {name: 'pro', per_page_limit: 20}}});
function rawChanges(vin = '1HGCM82633A004352') {
  return {ok: true, data: [{sequence: 101, event_id: 'gap-101', event: 'lot.created', terminal: false,
    vehicle: {platform: 'copart', lot_number: '10000001', vin}, before: {}, after: {}, changed_fields: [],
    recorded_at: CHECKED, vehicle_updated_at: CHECKED}], meta: {after: 100, next_cursor: 101, count: 1,
      has_more: true, ordering: 'sequence_asc', schema_version: 'test', retention_days: 14,
      oldest_available_sequence: 1, latest_available_sequence: 200}};
}
async function harness(t, options = {}) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  for (const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql']) sqlite.exec(fs.readFileSync(path.join(__dirname, '../docs/proposals', file), 'utf8'));
  const events = [], calls = {fetches: [], finishes: [], clock: NOW};
  const db = {prepare(sql) {return {bind(...params) {return {sql, params,
    async all() {return {results: sqlite.prepare(sql).all(...params)};},
    async first() {return sqlite.prepare(sql).get(...params) || null;},
    async run() {return {meta: {changes: Number(sqlite.prepare(sql).run(...params).changes)}};}
  };}};}, async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {const result = statements.map(s => ({meta: {changes: Number(sqlite.prepare(s.sql).run(...s.params).changes)}})); sqlite.exec('COMMIT'); return result;}
    catch (error) {sqlite.exec('ROLLBACK'); throw error;}
  }};
  // Spy on the real SQLite-backed RefreshStore so accounting and rollback are
  // exercised rather than reimplemented by a mock counter.
  const store = new RefreshStore(db, 'api-test', () => calls.clock); await store.acquire();
  sqlite.prepare(`UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=100000,quota_used=?,quota_left=?,quota_allowance=?,quota_plan='pro'`)
    .run(options.checkedAt === undefined ? CHECKED : options.checkedAt, 100000 - (options.left ?? 90000), options.left ?? 90000, options.allowance ?? 89499);
  for (const [key, limit, consumed] of [[`day:${AT.slice(0,10)}`, options.dailyLimit ?? 500, options.dailyConsumed ?? 0],
    [`month:${AT.slice(0,7)}`, options.monthlyLimit ?? 12000, options.monthlyConsumed ?? 0]]) {
    sqlite.prepare('INSERT INTO automatic_refresh_budgets(budget_key,limit_count,consumed,created_at,updated_at) VALUES(?,?,?,?,?)').run(key, limit, consumed, AT, AT);
  }
  const initialize = store.initializeBudgets.bind(store), reserve = store.reserve.bind(store), finish = store.finishAttempt.bind(store);
  store.initializeBudgets = async config => {events.push({kind: 'initialize', config}); return initialize(config);};
  store.reserve = async (...args) => {events.push({kind: 'reserve-start', spec: args[0], isUsage: args[2]}); const id = await reserve(...args); events.push({kind: 'reserve-done', id}); return id;};
  store.finishAttempt = async (id, error) => {events.push({kind: 'finish', id, code: error?.code || error?.message || null}); calls.finishes.push({id, error}); return finish(id, error);};
  const env = {APIBARA_API_KEY: SECRET};
  if (options.recovery) {
    Object.assign(env,{REXBID_FEED_API_RECOVERY_ID:'2026-10-31-gap',REXBID_FEED_API_RECOVERY_LIMIT:'12000',REXBID_FEED_API_RECOVERY_THROUGH:'51292006'});
    sqlite.exec('CREATE TABLE server_feed_state(singleton INTEGER PRIMARY KEY,committed_sequence INTEGER,active_generation INTEGER); INSERT INTO server_feed_state VALUES(1,100,NULL)');
  }
  const h = {db, sqlite, store, env, events, calls, reply: () => jsonResponse(rawChanges()),
    async fetchImpl(url, init) {
      events.push({kind: 'fetch'}); calls.fetches.push({url: String(url), init});
      const row = sqlite.prepare('SELECT * FROM automatic_refresh_attempts ORDER BY rowid DESC LIMIT 1').get();
      assert.equal(row?.outcome, 'attempted', 'durable reserve must exist before transport');
      assert.equal(init.headers['X-API-Key'], SECRET); assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
      return h.reply(url, init);
    }};
  h.create = () => countedFeedRequest({...h, now: () => calls.clock}); return h;
}
const attempts = h => h.sqlite.prepare('SELECT * FROM automatic_refresh_attempts ORDER BY rowid').all();
const state = h => h.sqlite.prepare('SELECT * FROM automatic_refresh_state').get();
const consumed = (h, prefix) => h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key LIKE ?').get(`${prefix}:%`).consumed;

test('every fetch follows durable shared reservation, uses exact500/12000 policy, and finishes once', async t => {
  const h = await harness(t), request = await h.create(); const result = await request(changes);
  assert.deepEqual(h.events[0], {kind: 'initialize', config: {daily: 500, monthly: 12000, newPerDay: 2000}});
  assert.deepEqual(h.events.filter(e => ['reserve-start','reserve-done','fetch','finish'].includes(e.kind)).map(e => e.kind), ['reserve-start','reserve-done','fetch','finish']);
  assert.equal(result.observedAt, AT); assert.deepEqual(result.response, rawChanges());
  assert.equal(attempts(h).length, 1); assert.equal(attempts(h)[0].outcome, 'response'); assert.equal(h.calls.finishes.length, 1);
  assert.equal(consumed(h, 'day'), 1); assert.equal(consumed(h, 'month'), 1);
});

test('100/25 changes pages retain created hydration and charge every transport in existing ordinary/recovery budgets', async t => {
  for (const recovery of [false, true]) {
    const h = await harness(t, {recovery}), request = await h.create();
    for (const limit of [100, 25]) {
      await request({...changes, limit});
      const url = new URL(h.calls.fetches.at(-1).url);
      assert.deepEqual([...url.searchParams], [['after', '100'], ['limit', String(limit)], ['include_record', 'created']]);
    }
    assert.equal(h.calls.fetches.length, 2); assert.equal(attempts(h).length, 2);
    assert.equal(h.calls.finishes.length, 2); assert.equal(consumed(h, 'day'), 2); assert.equal(consumed(h, 'month'), 2);
    if (recovery) assert.equal(h.sqlite.prepare('SELECT limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key=?').get('feed-api-recovery:2026-10-31-gap').consumed, 2);
  }
});

test('unsupported changes sizes fail before any request reservation; small pages cannot bypass exhausted budgets or provider reserve', async t => {
  const h = await harness(t), request = await h.create();
  for (const limit of [undefined, null, false, 0, 1, 24, 26, 50, 99, 101, 499, 501, 2000, '100', NaN, Infinity]) {
    await assert.rejects(request({...changes, limit}), /SERVER_FEED_API_CONFIG/);
  }
  assert.equal(h.calls.fetches.length, 0); assert.equal(attempts(h).length, 0); assert.equal(consumed(h, 'day'), 0);
  for (const limit of [100, 25]) {
    const exhausted = await harness(t, {dailyConsumed: 500});
    await assert.rejects(async () => (await exhausted.create())({...changes, limit}), /AUTOMATIC_REFRESH_BUDGET_STOP/);
    assert.equal(exhausted.calls.fetches.length, 0);
    const reserve = await harness(t, {left: 10000, allowance: 0});
    await assert.rejects(async () => (await reserve.create())({...changes, limit}), /AUTOMATIC_REFRESH_QUOTA_RESERVE/);
    assert.equal(reserve.calls.fetches.length, 0);
    const recovery = await harness(t, {recovery: true}); await recovery.create();
    recovery.sqlite.prepare('UPDATE automatic_refresh_budgets SET consumed=limit_count WHERE budget_key=?').run('feed-api-recovery:2026-10-31-gap');
    await assert.rejects(async () => (await recovery.create())({...changes, limit}), /RECOVERY_BUDGET_STOP/);
    assert.equal(recovery.calls.fetches.length, 0);
  }
});

async function adaptiveHarness(t) {
  const h = await harness(t), sql = [];
  h.sqlite.exec('CREATE TABLE server_feed_state(singleton INTEGER PRIMARY KEY,committed_sequence INTEGER,active_generation INTEGER,updated_at TEXT)');
  h.sqlite.prepare('INSERT INTO server_feed_state VALUES(1,100,NULL,?)').run(CHECKED);
  const prepare = h.db.prepare.bind(h.db); h.db.prepare = text => {sql.push(text); return prepare(text);};
  h.adapt = extra => safeAdaptiveGapLimit({db: h.db, committedSequence: 100, updatedAt: CHECKED, ...extra});
  h.seedFailure = (n, changes = {}) => {
    const row = {attempt_id: `adaptive-${n}`, operation: 'vehicleChanges', attempted_at: new Date(NOW - 10000 + n * 10).toISOString(),
      completed_at: new Date(NOW - 9999 + n * 10).toISOString(), outcome: 'error', http_status: 500, error_code: 'UPSTREAM', ...changes};
    h.sqlite.prepare(`INSERT INTO automatic_refresh_attempts(${Object.keys(row)}) VALUES(${Object.keys(row).map(() => '?')})`).run(...Object.values(row));
  };
  h.adaptiveSql = sql; return h;
}

test('adaptive size requires repeated completed HTTP500 evidence at unchanged cursor and reads only four indexed attempts', async t => {
  const h = await adaptiveHarness(t);
  assert.equal(await h.adapt(), 500);
  for (let n = 1; n <= 4; n++) {h.seedFailure(n); assert.equal(await h.adapt(), n < 2 ? 500 : n < 4 ? 100 : 25);}
  const sql = h.adaptiveSql.at(-1);
  assert.match(sql, /INDEXED BY automatic_refresh_attempts_time/); assert.match(sql, /ORDER BY attempted_at DESC LIMIT 4/);
  const plan = h.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(CHECKED, 100, CHECKED);
  assert.ok(plan.some(row => /SEARCH automatic_refresh_attempts USING INDEX automatic_refresh_attempts_time/.test(row.detail)));
  assert.equal(plan.some(row => /SCAN automatic_refresh_attempts/.test(row.detail)), false);
  for (let n = 5; n <= 1000; n++) h.seedFailure(n, {attempted_at: '2026-10-28T12:00:00.000Z', completed_at: '2026-10-28T12:00:01.000Z'});
  assert.equal(await h.adapt(), 25); assert.equal(h.calls.fetches.length, 0);
  assert.equal(consumed(h, 'day'), 0); assert.equal(consumed(h, 'month'), 0);
});

test('advance, different state timestamp, active generation or any success/429/unknown evidence restores500', async t => {
  for (const different of [
    {outcome: 'response', http_status: 200, error_code: null},
    {http_status: 429, error_code: 'RATE_LIMITED'}, {http_status: 503},
    {http_status: null, error_code: 'TIMEOUT'}, {completed_at: null, outcome: 'attempted', http_status: null, error_code: null},
    {operation: 'apiUsage'}, {completed_at: 'not-a-time'}, {completed_at: CHECKED}
  ]) {
    const h = await adaptiveHarness(t); for (let n = 1; n <= 3; n++) h.seedFailure(n);
    h.seedFailure(4, different); assert.equal(await h.adapt(), 500); assert.equal(h.calls.fetches.length, 0);
  }
  const h = await adaptiveHarness(t); for (let n = 1; n <= 4; n++) h.seedFailure(n);
  assert.equal(await h.adapt({committedSequence: 99}), 500);
  assert.equal(await h.adapt({updatedAt: '2026-10-29T10:00:00.000Z'}), 500);
  h.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=101,updated_at=?').run(AT);
  assert.equal(await h.adapt(), 500); assert.equal(await h.adapt({committedSequence: 101, updatedAt: AT}), 500);
  h.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=100,updated_at=?,active_generation=42').run(CHECKED);
  assert.equal(await h.adapt(), 500);
});

test('invalid adaptive inputs or malformed read result cannot enable fallback; database failure remains a system error', async t => {
  const h = await adaptiveHarness(t);
  for (const extra of [{committedSequence: -1}, {committedSequence: '100'}, {committedSequence: NaN}, {updatedAt: null}, {updatedAt: '2026-10-29'}, {updatedAt: '2026-10-29T11:00:00Z'}]) {
    assert.equal(await h.adapt(extra), 500);
  }
  assert.equal(h.adaptiveSql.length, 0);
  const db = {prepare() {return {bind() {return {all: async () => ({results: null})};}};}};
  assert.equal(await h.adapt({db}), 500);
  const failed = {prepare() {throw Error('D1_UNAVAILABLE');}};
  await assert.rejects(h.adapt({db: failed}), /D1_UNAVAILABLE/); assert.equal(h.calls.fetches.length, 0);
});

test('vehicleByIdentifier is allowed and unsupported operations do not reserve or fetch', async t => {
  const h = await harness(t); h.reply = () => jsonResponse({ok: true, data: {platform: 'copart', lot_number: '10000001'}});
  const request = await h.create(); assert.equal((await request(detail)).response.ok, true);
  assert.equal(attempts(h)[0].operation, 'vehicleByIdentifier');
  for (const operation of ['listVehicles','vehicleDetail',undefined]) await assert.rejects(request({operation}), /SERVER_FEED_API_OPERATION/);
  assert.equal(attempts(h).length, 1); assert.equal(h.calls.fetches.length, 1);
});

test('HTTP200 unsuccessful detail envelope cannot be passed to the full observation writer', async t => {
  for (const response of [{ok: false, data: {platform: 'copart', lot_number: '10000001'}},
    {ok: true, response: {ok: false, data: {platform: 'copart', lot_number: '10000001'}}}]) {
    const h = await harness(t); h.reply = () => jsonResponse(response); const request = await h.create();
    await assert.rejects(request(detail), error => ['INVALID_RESPONSE','AUTOMATIC_REFRESH_RESPONSE_INVALID','SERVER_FEED_API_RESPONSE'].includes(error.code || error.message));
    assert.equal(attempts(h)[0].outcome, 'error'); assert.equal(h.calls.finishes.length, 1);
  }
});

test('shared daily500 and monthly12000 ceilings survive construction of another request session', async t => {
  for (const options of [{dailyConsumed: 499, monthlyConsumed: 1000}, {dailyConsumed: 0, monthlyConsumed: 11999}]) {
    const h = await harness(t, options); const first = await h.create(); await first(changes);
    const second = await h.create(); await assert.rejects(second(changes), /AUTOMATIC_REFRESH_BUDGET_STOP/);
    assert.equal(h.calls.fetches.length, 1); assert.equal(attempts(h).length, 1);
    if (options.dailyConsumed) assert.equal(consumed(h, 'day'), 500); else assert.equal(consumed(h, 'month'), 12000);
  }
});

test('previously stricter budget caps are not raised and reservation failure prevents all transport', async t => {
  const h = await harness(t, {dailyLimit: 1, dailyConsumed: 1, monthlyLimit: 100});
  const request = await h.create(); await assert.rejects(request(changes), /AUTOMATIC_REFRESH_BUDGET_STOP/);
  assert.equal(h.sqlite.prepare("SELECT limit_count FROM automatic_refresh_budgets WHERE budget_key LIKE 'day:%'").get().limit_count, 1);
  assert.equal(h.sqlite.prepare("SELECT limit_count FROM automatic_refresh_budgets WHERE budget_key LIKE 'month:%'").get().limit_count, 100);
  assert.equal(h.calls.fetches.length, 0); assert.equal(h.calls.finishes.length, 0);
});

test('stale quota triggers a counted usage request and protects10000 plus provider-accounting margin', async t => {
  const h = await harness(t, {checkedAt: null}); h.reply = () => jsonResponse(usage(15000));
  const request = await h.create(); assert.equal(attempts(h).length, 1); assert.equal(attempts(h)[0].operation, 'apiUsage');
  assert.equal(state(h).quota_left, 15000); assert.equal(state(h).quota_allowance, 4999);
  assert.equal(h.events.find(e => e.kind === 'reserve-start').isUsage, true);
  h.reply = () => jsonResponse(rawChanges()); await request(changes); assert.equal(attempts(h).length, 2);
  assert.equal(h.calls.fetches.length, 2);
});

test('quota at10001 stops after usage; exhausted cached allowance does not fetch', async t => {
  const h = await harness(t, {checkedAt: null}); h.reply = () => jsonResponse(usage(10001));
  await assert.rejects(h.create(), /AUTOMATIC_REFRESH_QUOTA_RESERVE/); assert.equal(h.calls.fetches.length, 1); assert.equal(attempts(h)[0].outcome, 'response');
  const cached = await harness(t, {left: 10001, allowance: 0});
  await assert.rejects(async () => (await cached.create())(changes), /AUTOMATIC_REFRESH_QUOTA_RESERVE|AUTOMATIC_REFRESH_BUDGET_STOP/);
  assert.equal(cached.calls.fetches.length, 0);
});

test('fresh feed15000 and old-Cron reserve basis both honor the same10000 safety margin', async t => {
  for (const allowance of [4999, 14499]) {
    const h = await harness(t, {left: 15000, allowance}); const request = await h.create(); await request(changes);
    assert.equal(h.calls.fetches.length, 1); assert.ok(state(h).quota_allowance <= 4998);
  }
});

test('attempts since quota observation reduce old-Cron allowance before the next nonusage request', async t => {
  const h = await harness(t, {left: 10004, allowance: 9503});
  for (let n = 0; n < 3; n++) h.sqlite.prepare(`INSERT INTO automatic_refresh_attempts(attempt_id,operation,attempted_at) VALUES(?,'vehicleByIdentifier',?)`).run(`cron-${n}`, AT);
  await assert.rejects(async () => (await h.create())(changes), /AUTOMATIC_REFRESH_QUOTA_RESERVE|AUTOMATIC_REFRESH_BUDGET_STOP/);
  assert.equal(h.calls.fetches.length, 0); assert.equal(attempts(h).length, 3);
});

test('401/403 are sanitized AUTH failures, finish once and never retry transport', async t => {
  for (const status of [401, 403]) {
    const h = await harness(t); h.reply = () => new Response(`secret ${SECRET}`, {status}); const request = await h.create();
    await assert.rejects(request(changes), error => error.code === 'AUTH' && error.status === status && !error.message.includes(SECRET));
    assert.equal(h.calls.fetches.length, 1); assert.equal(h.calls.finishes.length, 1); assert.equal(h.calls.finishes[0].error.code, 'AUTH');
    assert.equal(attempts(h)[0].error_code, 'AUTH'); assert.equal(attempts(h)[0].outcome, 'error');
  }
});

test('persisted authentication/configuration health blocks a new session before any reserve or quota request', async t => {
  for (const config of [false, true]) {
    const h = await harness(t); h.reply = () => new Response('private response', {status: 401});
    if (config) h.env.APIBARA_API_KEY = '';
    const request = await h.create(); await assert.rejects(request(config ? detail : changes), error => ['AUTH','CONFIGURATION'].includes(error.code));
    const health = h.sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key='server-api-health'").get();
    assert.equal(health.status, 'blocked'); assert.equal(health.last_error_code, config ? 'CONFIGURATION' : 'AUTH');
    const fetches = h.calls.fetches.length, reserved = attempts(h).length, initialized = h.events.filter(e => e.kind === 'initialize').length;
    await assert.rejects(h.create(), /SERVER_FEED_API_AUTH_BLOCKED/);
    assert.equal(h.calls.fetches.length, fetches); assert.equal(attempts(h).length, reserved);
    assert.equal(h.events.filter(e => e.kind === 'initialize').length, initialized);
  }
});

test('persisted429 pause stops new sessions and becomes eligible only after its bounded deadline', async t => {
  const h = await harness(t); h.reply = () => new Response('rate limited', {status: 429, headers: {'Retry-After': '120'}});
  const request = await h.create(); await assert.rejects(request(changes), error => error.code === 'RATE_LIMITED');
  const health = h.sqlite.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key='server-api-health'").get();
  assert.equal(health.status, 'paused'); assert.equal(health.next_due_at, '2026-10-29T12:02:00.000Z');
  await assert.rejects(h.create(), /SERVER_FEED_API_RATE_PAUSED/); assert.equal(h.calls.fetches.length, 1);
  h.calls.clock += 121000; h.reply = () => jsonResponse(rawChanges()); await (await h.create())(changes);
  assert.equal(h.calls.fetches.length, 2); assert.equal(attempts(h).length, 2);
});

test('429 Retry-After is finite, nonnegative, bounded86400 and never causes an immediate retry', async t => {
  for (const header of ['9999999999999999999999','-8','Infinity','not-a-number','30']) {
    for (const spec of [changes, detail]) {
      const h = await harness(t); h.reply = () => new Response('ignored', {status: 429, headers: {'Retry-After': header}});
      const request = await h.create(); await assert.rejects(request(spec), error => {
        assert.equal(error.code, 'RATE_LIMITED'); assert.ok(Number.isSafeInteger(error.retryAfter));
        assert.ok(error.retryAfter >= 0 && error.retryAfter <= 86400); if (header === '30') assert.equal(error.retryAfter, 30); return true;
      });
      assert.equal(h.calls.fetches.length, 1); assert.equal(h.calls.finishes.length, 1);
    }
  }
});

test('raw changes transport errors expose only safe UPSTREAM/TIMEOUT and sanitized attempt evidence', async t => {
  for (const name of ['Error','AbortError','TimeoutError']) {
    const h = await harness(t); h.reply = () => {const error = Error(`private transport ${SECRET} https://private.test/token`); error.name = name; throw error;};
    const request = await h.create(); await assert.rejects(request(changes), error => {
      assert.ok(['UPSTREAM','TIMEOUT'].includes(error.code)); assert.ok(!error.message.includes(SECRET)); return true;
    });
    assert.ok(['UPSTREAM','TIMEOUT'].includes(attempts(h)[0].error_code)); assert.equal(h.calls.fetches.length, 1); assert.equal(h.calls.finishes.length, 1);
  }
});

test('changes response stream failure cannot leak raw transport details through finishAttempt or thrown error', async t => {
  const h = await harness(t); h.reply = () => ({ok: true, status: 200, headers: new Headers(),
    body: new ReadableStream({start(controller) {controller.error(Error(`private stream ${SECRET}`));}})});
  const request = await h.create(); await assert.rejects(request(changes), error => {
    assert.ok(['UPSTREAM','TIMEOUT'].includes(error.code)); assert.ok(!error.message.includes(SECRET)); return true;
  });
  assert.equal(h.calls.finishes.length, 1); assert.ok(!h.calls.finishes[0].error.message.includes(SECRET));
});

test('success finishAttempt failure is never followed by a second completion write', async t => {
  const h = await harness(t), finish = h.store.finishAttempt.bind(h.store), failure = Error('AUTOMATIC_REFRESH_WRITE_FAILED');
  h.store.finishAttempt = async (...args) => {await finish(...args); if (h.calls.finishes.length === 1) throw failure;};
  const request = await h.create(); await assert.rejects(request(changes), error => error === failure);
  assert.equal(h.calls.finishes.length, 1); assert.equal(h.calls.fetches.length, 1);
  assert.equal(attempts(h)[0].outcome, 'response'); assert.equal(attempts(h)[0].error_code, null);
});

test('4MiB changes JSON succeeds exactly at the boundary; streaming overflow is canceled and counted once', async t => {
  const maximum = 4 * 1024 * 1024;
  const base = JSON.stringify({ok: true, data: [], padding: ''});
  const text = JSON.stringify({ok: true, data: [], padding: 'x'.repeat(maximum - Buffer.byteLength(base))}); assert.equal(Buffer.byteLength(text), maximum);
  const h = await harness(t); h.reply = () => new Response(text); const request = await h.create();
  assert.equal((await request(changes)).response.padding.length, maximum - Buffer.byteLength(base));
  let canceled = false, chunks = 0;
  h.reply = () => ({ok: true, status: 200, headers: new Headers(), body: new ReadableStream({pull(controller) {
    chunks++; controller.enqueue(new Uint8Array(1024 * 1024));
  }, cancel() {canceled = true;}})});
  await assert.rejects(request(changes), error => error.code === 'SERVER_FEED_API_SIZE' || error.message === 'SERVER_FEED_API_SIZE');
  assert.equal(canceled, true); assert.ok(chunks <= 6); assert.equal(h.calls.fetches.length, 2);
  assert.equal(h.calls.finishes.length, 2); assert.equal(attempts(h)[1].outcome, 'error');
});

test('malformed UTF8/JSON is rejected, while raw malformed VIN evidence reaches only the gap validation boundary', async t => {
  const h = await harness(t), request = await h.create();
  for (const body of [new Uint8Array([0xff]), '{truncated']) {
    h.reply = () => new Response(body); await assert.rejects(request(changes), error => error.code === 'SERVER_FEED_API_RESPONSE' || error.message === 'SERVER_FEED_API_RESPONSE');
  }
  const badVin = rawChanges(''); h.reply = () => jsonResponse(badVin);
  assert.throws(() => parseChangesResponse(badVin, {after: 100, limit: 500}));
  assert.deepEqual((await request(changes)).response, badVin);
  assert.equal(attempts(h).length, 3); assert.equal(attempts(h)[2].outcome, 'response');
});

test('lease loss and day change cannot reach provider; request module never retries', async t => {
  const h = await harness(t), request = await h.create(); h.sqlite.exec("UPDATE automatic_refresh_state SET lease_owner='other'");
  await assert.rejects(request(changes)); assert.equal(h.calls.fetches.length, 0);
  const day = await harness(t), next = await day.create(); day.calls.clock += 86400000;
  await assert.rejects(next(changes)); assert.equal(day.calls.fetches.length, 0);
});


test('counted server changes request asks for created records and retains raw record fields without changing other query limits', async t => {
  const h = await harness(t), raw = rawChanges();
  raw.data[0].record = {platform:'copart',lot_number:'10000001',vin:'1HGCM82633A004352',media:{items:[{url:'https://images.example/one.jpg'}]}};
  h.reply = () => jsonResponse(raw);
  const request = await h.create(), result = await request(changes);
  const url = new URL(h.calls.fetches[0].url);
  assert.equal(url.pathname, '/api/v1/vehicle-auction/changes');
  assert.deepEqual([...url.searchParams], [['after','100'],['limit','500'],['include_record','created']]);
  assert.deepEqual(result.response.data[0].record, raw.data[0].record);
  assert.equal(attempts(h).length, 1); assert.equal(attempts(h)[0].outcome, 'response');
  h.reply = () => jsonResponse({ok:true,data:{platform:'copart',lot_number:'10000001'}});
  await request(detail);
  assert.equal(new URL(h.calls.fetches[1].url).searchParams.has('include_record'), false);
});

const RECOVERY_KEY='feed-api-recovery:2026-10-31-gap';
test('authorized recovery alone bypasses exhausted ordinary caps while counting every attempt in all ledgers',async t=>{
 const h=await harness(t,{recovery:true,dailyConsumed:500,monthlyConsumed:12000}),request=await h.create();
 await request(changes);
 assert.equal(consumed(h,'day'),501);assert.equal(consumed(h,'month'),12001);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(RECOVERY_KEY).consumed,1);
 assert.equal(attempts(h).length,1);assert.equal(attempts(h)[0].outcome,'response');
 assert.ok(h.sqlite.prepare("SELECT limit_count FROM automatic_refresh_budgets WHERE budget_key LIKE 'day:%'").get().limit_count<=500);
 await assert.rejects(request(detail),/AUTOMATIC_REFRESH_BUDGET_STOP/);assert.equal(h.calls.fetches.length,1);
 await assert.rejects(request({operation:'apiUsage'}),/AUTOMATIC_REFRESH_BUDGET_STOP/);assert.equal(h.calls.fetches.length,1);
 delete h.env.REXBID_FEED_API_RECOVERY_ID;
 await assert.rejects(async()=> (await h.create())(changes),/AUTOMATIC_REFRESH_BUDGET_STOP/);
 assert.equal(h.calls.fetches.length,1);
});
test('recovery cumulative12000 allowance cannot reset on session restart or UTC day/month rollover',async t=>{
 const h=await harness(t,{recovery:true}),request=await h.create();await request(changes);
 h.sqlite.prepare('UPDATE automatic_refresh_budgets SET consumed=11999 WHERE budget_key=?').run(RECOVERY_KEY);
 await (await h.create())(changes);assert.equal(h.calls.fetches.length,2);
 h.calls.clock=Date.parse('2026-11-01T00:00:01Z');
 h.sqlite.prepare('UPDATE automatic_refresh_state SET lease_until=?,quota_checked_at=?').run('2026-11-01T00:10:00.000Z','2026-11-01T00:00:00.000Z');
 await assert.rejects(async()=> (await h.create())(changes),/SERVER_FEED_RECOVERY_BUDGET_STOP/);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(RECOVERY_KEY).consumed,12000);
 assert.equal(h.calls.fetches.length,2);assert.equal(attempts(h).length,2);
});
test('recovery hard-frozen target, wrong ID, extension and rewind fail before transport',async t=>{
 const h=await harness(t,{recovery:true}),request=await h.create();await request(changes);
 for(const changesEnv of [{REXBID_FEED_API_RECOVERY_ID:'other'},{REXBID_FEED_API_RECOVERY_LIMIT:'12001'},
  {REXBID_FEED_API_RECOVERY_THROUGH:'51292007'}]){
  const before={...h.env};Object.assign(h.env,changesEnv);await assert.rejects(h.create(),/SERVER_FEED_RECOVERY_CONFIG/);Object.assign(h.env,before);
 }
 await assert.rejects(request({...changes,after:99}),/SERVER_FEED_RECOVERY_SCOPE/);
 h.sqlite.exec('UPDATE server_feed_state SET committed_sequence=51292006');
 await assert.rejects(request({...changes,after:51292006}),/SERVER_FEED_RECOVERY_COMPLETE/);
 assert.equal(h.sqlite.prepare('SELECT status FROM automatic_refresh_tasks WHERE task_key=?').get(RECOVERY_KEY).status,'complete');
 h.sqlite.exec('UPDATE server_feed_state SET committed_sequence=100');
 await (await h.create())(changes);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(RECOVERY_KEY).consumed,1);
 assert.equal(h.calls.fetches.length,2);
});
test('recovery preserves provider10000 reserve and counts necessary usage and transport failure',async t=>{
 const h=await harness(t,{recovery:true,checkedAt:null});
 // No reliable previous quota observation: fail closed rather than make an uncounted lookup.
 await assert.rejects(h.create(),/SERVER_FEED_RECOVERY_BUDGET_STOP/);assert.equal(h.calls.fetches.length,0);
 const stale=await harness(t,{recovery:true,checkedAt:'2026-10-27T00:00:00.000Z'});
 stale.reply=()=>jsonResponse(usage(15000));const request=await stale.create();
 assert.equal(attempts(stale)[0].operation,'apiUsage');
 stale.reply=()=>{throw Error(SECRET);};await assert.rejects(request(changes),e=>e.code==='UPSTREAM'&&!e.message.includes(SECRET));
 assert.equal(attempts(stale).length,2);assert.equal(attempts(stale)[1].outcome,'error');
 assert.equal(stale.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(RECOVERY_KEY).consumed,2);
 const near=await harness(t,{recovery:true,left:10004,allowance:9503});
 for(let i=0;i<3;i++)near.sqlite.prepare("INSERT INTO automatic_refresh_attempts(attempt_id,operation,attempted_at) VALUES(?,'apiUsage',?)").run(`other-${i}`,AT);
 await assert.rejects(async()=> (await near.create())(changes),/QUOTA_RESERVE|RECOVERY_BUDGET_STOP/);assert.equal(near.calls.fetches.length,0);
});
test('recovery does not refund a lost success acknowledgement or repeat a completion write',async t=>{
 const h=await harness(t,{recovery:true}),finish=h.store.finishAttempt.bind(h.store);
 h.store.finishAttempt=async(...args)=>{await finish(...args);throw Error('AUTOMATIC_REFRESH_WRITE_FAILED');};
 await assert.rejects(async()=> (await h.create())(changes),/AUTOMATIC_REFRESH_WRITE_FAILED/);
 assert.equal(h.calls.finishes.length,1);assert.equal(attempts(h)[0].outcome,'response');
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(RECOVERY_KEY).consumed,1);
});

function seedQuotaAttempts(h,count){for(let n=0;n<count;n++)h.sqlite.prepare("INSERT INTO automatic_refresh_attempts(attempt_id,operation,attempted_at) VALUES(?,'vehicleChanges',?)").run(`quota-window-${n}`,CHECKED);}
test('recovery refreshes quota exactly at200 attempts, charges usage to allowance, then resumes changes',async t=>{
 const h=await harness(t,{recovery:true});seedQuotaAttempts(h,199);
 h.reply=url=>jsonResponse(new URL(String(url)).pathname.endsWith('/usage')?usage(88917):rawChanges());
 const request=await h.create();assert.equal(h.calls.fetches.length,0);
 await request(changes);assert.equal(h.calls.fetches.length,1);
 h.calls.clock+=1;await request(changes);
 assert.deepEqual(h.calls.fetches.map(call=>new URL(call.url).pathname.split('/').at(-1)),['changes','usage','changes']);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(RECOVERY_KEY).consumed,3);
 assert.equal(consumed(h,'day'),3);assert.equal(consumed(h,'month'),3);
 assert.equal(attempts(h).at(-2).operation,'apiUsage');assert.equal(attempts(h).at(-2).outcome,'response');
});
test('constructor refreshes a saturated200 window once; normal operation does not gain periodic recovery requests',async t=>{
 const h=await harness(t,{recovery:true});seedQuotaAttempts(h,200);h.reply=()=>jsonResponse(usage(88917));
 await h.create();assert.equal(h.calls.fetches.length,1);assert.equal(attempts(h).at(-1).operation,'apiUsage');
 const normal=await harness(t);seedQuotaAttempts(normal,200);await normal.create();assert.equal(normal.calls.fetches.length,0);
});
test('periodic usage cannot bypass lifetime cap, provider10000 reserve or a failed quota response',async t=>{
 const exhausted=await harness(t,{recovery:true});await exhausted.create();seedQuotaAttempts(exhausted,200);
 exhausted.sqlite.prepare('UPDATE automatic_refresh_budgets SET consumed=12000 WHERE budget_key=?').run(RECOVERY_KEY);
 await assert.rejects(exhausted.create(),/RECOVERY_BUDGET_STOP/);assert.equal(exhausted.calls.fetches.length,0);
 const reserve=await harness(t,{recovery:true,left:10500,allowance:9999});seedQuotaAttempts(reserve,1000);
 await assert.rejects(reserve.create(),/RECOVERY_BUDGET_STOP/);assert.equal(reserve.calls.fetches.length,0);
 const failed=await harness(t,{recovery:true});seedQuotaAttempts(failed,200);failed.reply=()=>new Response('unavailable',{status:503});
 await assert.rejects(failed.create());assert.equal(failed.calls.fetches.length,1);assert.equal(attempts(failed).at(-1).operation,'apiUsage');
 assert.equal(attempts(failed).at(-1).outcome,'error');assert.equal(failed.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(RECOVERY_KEY).consumed,1);
});
test('construction after frozen target completes receipt and automatically restores normal policy without flag removal',async t=>{
 const h=await harness(t,{recovery:true}),request=await h.create();await request(changes);
 const before=h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(RECOVERY_KEY).cursor;
 h.sqlite.exec('UPDATE server_feed_state SET committed_sequence=51292006');
 const normal=await h.create();await normal({...changes,after:51292006});
 assert.equal(h.calls.fetches.length,2);
 assert.equal(h.sqlite.prepare('SELECT status FROM automatic_refresh_tasks WHERE task_key=?').get(RECOVERY_KEY).status,'complete');
 assert.equal(h.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(RECOVERY_KEY).cursor,before);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(RECOVERY_KEY).consumed,1);
 h.sqlite.exec("UPDATE automatic_refresh_budgets SET consumed=limit_count WHERE budget_key LIKE 'day:%'");
 await assert.rejects(async()=> (await h.create())({...changes,after:51292006}),/AUTOMATIC_REFRESH_BUDGET_STOP/);
 assert.equal(h.calls.fetches.length,2);
});
test('counted closure exposes only an immutable nonsecret recoveryActive boolean for validated active recovery',async t=>{
 const ordinary=await harness(t),normal=await ordinary.create();assert.equal(normal.recoveryActive,false);
 const h=await harness(t,{recovery:true}),active=await h.create();assert.equal(active.recoveryActive,true);
 assert.deepEqual(Object.keys(active),['recoveryActive']);
 assert.deepEqual(Object.getOwnPropertyDescriptor(active,'recoveryActive'),{value:true,writable:false,enumerable:true,configurable:false});
 assert.throws(()=>{active.recoveryActive=false;},TypeError);assert.equal(active.recoveryActive,true);
 assert.throws(()=>Object.defineProperty(active,'recoveryActive',{value:false}),TypeError);
 assert.equal(JSON.stringify(active.recoveryActive),'true');assert.ok(!Object.keys(active).some(key=>/id|key|token|secret/i.test(key)));
 h.sqlite.exec('UPDATE server_feed_state SET committed_sequence=51292006');
 const completed=await h.create();assert.equal(completed.recoveryActive,false);
 const invalid=await harness(t,{recovery:true});invalid.env.REXBID_FEED_API_RECOVERY_THROUGH='51292007';
 await assert.rejects(invalid.create(),/SERVER_FEED_RECOVERY_CONFIG/);assert.equal(invalid.calls.fetches.length,0);
});


test('checkpoint-only transport counts exactly one head request and cannot use old recovery or other operations',async t=>{
 const h=await harness(t,{recovery:true});const create=()=>countedFeedRequest({...h,now:()=>h.calls.clock,checkpointOnly:true});const request=await create();assert.equal(request.recoveryActive,false);
 for(const spec of [{operation:'vehicleChanges',after:100,limit:1},{operation:'vehicleChanges',after:0,limit:500},detail])await assert.rejects(request(spec),/SERVER_FEED_API_CONFIG/);
 assert.equal(h.calls.fetches.length,0);await request({operation:'vehicleChanges',after:0,limit:1});assert.equal(h.calls.fetches.length,1);
 const url=new URL(h.calls.fetches[0].url);assert.equal(url.searchParams.get('after'),'0');assert.equal(url.searchParams.get('limit'),'1');assert.equal(consumed(h,'day'),1);
 assert.equal(h.sqlite.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(RECOVERY_KEY),undefined);
 await assert.rejects(countedFeedRequest({...h,now:()=>h.calls.clock,checkpointOnly:'true'}),/SERVER_FEED_API_CONFIG/);
});
