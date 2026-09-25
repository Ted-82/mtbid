const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/auction-history.json'), 'utf8'));
const workerSource = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const carSource = fs.readFileSync(path.join(root, 'public/car.html'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

function loadWorker(fetchImpl = async () => { throw new Error('Unexpected network request'); }, timer = {}) {
  const source = workerSource.replace('export default {', 'globalThis.__worker = {');
  assert.notEqual(source, workerSource, 'Worker module export marker should exist');
  const context = {
    URL, URLSearchParams, Request, Response, Headers, AbortController, console: timer.console || console,
    fetch: fetchImpl,
    setTimeout: timer.setTimeout || setTimeout,
    clearTimeout: timer.clearTimeout || clearTimeout,
    setInterval, clearInterval,
    caches: { default: { match: async () => null, put: async () => {} } }
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__history = { normalizeHistoryRecord, normalizeApibaraHistory, normalizeApibaraVehicleList, historyEventHash, saveOfficialHistory, saveVehicle, saveApiVehicle, syncVehicle, syncVehicleList, getSavedAuctionHistory, requestApibara, fetchApibaraVehicle, searchApibaraVehicles, fetchApibaraHistory, fetchApibaraVehicles, buildApibaraUrl, ApibaraRequestError, apibaraErrorResponse };`, context);
  return context;
}

class MemoryD1 {
  constructor(rows = []) { this.rows = rows; this.nextId = rows.reduce((n, row) => Math.max(n, row.id || 0), 0) + 1; }
  prepare(sql) {
    const db = this;
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return null; },
      async all() {
        if (!/FROM\s+auction_history/i.test(sql)) return { results: [] };
        return { results: db.rows.filter(row => row.vehicle_key === args[0]).map(row => ({ ...row })) };
      },
      async run() {
        if (/^\s*UPDATE\s+auction_history/i.test(sql)) {
          const row = db.rows.find(item => item.id === args[17] && item.vehicle_key === args[18]);
          if (row) {
            const keys = ['event_key','source_event_id','vin','platform','lot','auction_date','sale_date','current_bid'];
            keys.forEach((key, i) => { if (args[i] !== null && args[i] !== undefined) row[key] = args[i]; });
            if (args[8] === 1) row.final_price = null;
            else if (args[9] !== null && args[9] !== undefined) row.final_price = args[9];
            if (args[10] !== null && args[10] !== undefined) row.buy_now = args[10];
            if (args[11] !== null && args[11] !== undefined) row.price = args[11];
            if (args[12] !== null && args[12] !== undefined) row.seller = args[12];
            if (args[13] !== null && args[13] !== undefined) row.status = args[13];
            row.event_hash = args[14]; row.captured_at = args[15]; row.raw_json = args[16];
          }
          return { success: true };
        }
        if (/^\s*INSERT\s+INTO\s+auction_history/i.test(sql)) {
          const keys = ['vehicle_key','event_key','source_event_id','vin','platform','lot','auction_date','sale_date','current_bid','final_price','buy_now','price','seller','status','event_hash','captured_at','raw_json'];
          const row = { id: db.nextId++ };
          keys.forEach((key, i) => { row[key] = args[i]; });
          db.rows.push(row);
        }
        return { success: true };
      }
    };
  }
}

class SyncMemoryD1 {
  constructor() { this.vehicles = []; this.snapshots = []; this.history = []; this.statements = []; }
  prepare(sql) {
    const db = this;
    let args = [];
    db.statements.push(sql);
    return {
      bind(...values) { args = values; return this; },
      async first() {
        if (/FROM\s+vehicles/i.test(sql) && /WHERE\s+vehicle_key/i.test(sql)) return db.vehicles.find(row => row.vehicle_key === args[0]) || null;
        if (/COUNT\(\*\)/i.test(sql) && /vehicle_snapshots/i.test(sql)) return { count: db.snapshots.length };
        return null;
      },
      async all() {
        if (/FROM\s+auction_history/i.test(sql)) return { results: db.history.filter(row => row.vehicle_key === args[0]).map(row => ({ ...row })) };
        if (/FROM\s+vehicle_snapshots/i.test(sql)) return { results: db.snapshots.filter(row => row.vehicle_key === args[0]).map(row => ({ ...row })) };
        return { results: [] };
      },
      async run() {
        if (/^\s*CREATE\s/i.test(sql)) return { success: true };
        const insertMatch = sql.match(/^\s*INSERT\s+INTO\s+(vehicles|vehicle_snapshots)\s*\(([\s\S]*?)\)\s*VALUES/i);
        if (insertMatch) {
          const table = insertMatch[1];
          const columns = insertMatch[2].split(',').map(column => column.trim());
          const row = Object.fromEntries(columns.map((column, index) => [column, args[index]]));
          if (table === 'vehicles') {
            const old = db.vehicles.find(item => item.vehicle_key === row.vehicle_key);
            if (old) Object.assign(old, row);
            else db.vehicles.push(row);
          } else {
            row.id = db.snapshots.length + 1;
            db.snapshots.push(row);
          }
          return { success: true };
        }
        if (/^\s*UPDATE\s+auction_history/i.test(sql)) {
          const row = db.history.find(item => item.id === args[17] && item.vehicle_key === args[18]);
          if (row) {
            const keys = ['event_key','source_event_id','vin','platform','lot','auction_date','sale_date','current_bid'];
            keys.forEach((key, i) => { if (args[i] !== null && args[i] !== undefined) row[key] = args[i]; });
            if (args[8] === 1) row.final_price = null;
            else if (args[9] !== null && args[9] !== undefined) row.final_price = args[9];
            if (args[10] !== null && args[10] !== undefined) row.buy_now = args[10];
            if (args[11] !== null && args[11] !== undefined) row.price = args[11];
            if (args[12] !== null && args[12] !== undefined) row.seller = args[12];
            if (args[13] !== null && args[13] !== undefined) row.status = args[13];
            row.event_hash = args[14]; row.captured_at = args[15]; row.raw_json = args[16];
          }
          return { success: true };
        }
        if (/^\s*INSERT\s+INTO\s+auction_history/i.test(sql)) {
          const keys = ['vehicle_key','event_key','source_event_id','vin','platform','lot','auction_date','sale_date','current_bid','final_price','buy_now','price','seller','status','event_hash','captured_at','raw_json'];
          const row = { id: db.history.length + 1 };
          keys.forEach((key, i) => { row[key] = args[i]; });
          db.history.push(row);
        }
        return { success: true };
      }
    };
  }
}

class ReadOnlyD1 {
  constructor({ vehicle = null, history = [], snapshots = [] } = {}) {
    this.statements = []; this.vehicle = vehicle; this.history = history; this.snapshots = snapshots;
  }
  prepare(sql) {
    const db = this;
    this.statements.push(sql);
    assert.match(sql.trim(), /^(SELECT|PRAGMA)\b/i, 'GET attempted non-read-only D1 SQL');
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() {
        if (/COUNT\(\*\)/i.test(sql)) return { count: 0 };
        if (/FROM\s+vehicles/i.test(sql)) return db.vehicle;
        return null;
      },
      async all() {
        if (/FROM\s+auction_history/i.test(sql)) return { results: db.history.filter(row => row.vehicle_key === args[0]) };
        if (/FROM\s+vehicle_snapshots/i.test(sql)) return { results: db.snapshots.filter(row => row.vehicle_key === args[0]) };
        return { results: [] };
      }
    };
  }
}

function extractFunctionBlock(source, name, nextName) {
  const start = source.search(new RegExp(`(?:async\\s+)?function ${name}\\(`));
  const end = source.search(new RegExp(`(?:async\\s+)?function ${nextName}\\(`, 'g'));
  const nextStart = end > start ? end : -1;
  assert.ok(start >= 0 && nextStart > start, `Could not locate ${name} block`);
  return source.slice(start, nextStart);
}

test('canonical normalization keeps prices separate, preserves raw JSON, and accepts missing price', () => {
  const { __history } = loadWorker();
  const sold = __history.normalizeHistoryRecord(fixtures.single, fixtures.vehicle);
  assert.equal(sold.vin, fixtures.vehicle.vin);
  assert.equal(sold.platform, 'copart');
  assert.equal(sold.lot, 'LOT-123');
  assert.equal(sold.auction_date, '2025-01-10T14:30:00-05:00');
  assert.equal(sold.current_bid, 500);
  assert.equal(sold.final_price, 5200);
  assert.equal(sold.buy_now, 7000);
  assert.equal(sold.source_price, 5200);
  assert.equal(sold.seller, 'Copart Direct');
  assert.deepEqual(JSON.parse(JSON.stringify(sold.raw_json)), fixtures.single);
  assert.ok(sold.event_key);

  const genericPrice = __history.normalizeHistoryRecord(fixtures.genericPriceOnly);
  assert.equal(genericPrice.source_price, 5200);
  assert.equal(genericPrice.final_price, null, 'generic price must not become final price');
  const noPrice = __history.normalizeHistoryRecord(fixtures.notSold);
  assert.equal(noPrice.status, 'not sold');
  assert.equal(noPrice.final_price, null);
  assert.equal(noPrice.current_bid, 1800);
  assert.ok(noPrice.event_key, 'an event without a price must be retained');
});

test('requestApibara builds only approved endpoints, uses only the named secret, and forwards cursor opaquely', async () => {
  let requestUrl;
  let requestOptions;
  let calls = 0;
  const { __history } = loadWorker(async (url, options) => {
    calls++;
    requestUrl = new URL(url);
    requestOptions = options;
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
  await __history.requestApibara({ APIBARA_API_KEY: 'fixture-secret', APIBARA_KEY: 'ignored-secret' }, {
    operation: 'vehicleHistory', identifier: 'VIN/1', per_page: 999,
    cursor: 'opaque A+/='
  });
  assert.equal(calls, 1, 'one client invocation makes exactly one upstream request');
  assert.equal(requestUrl.pathname, '/api/v1/vehicle-auction/vehicles/VIN%2F1/history');
  assert.equal(requestUrl.searchParams.get('per_page'), '20');
  assert.equal(requestUrl.searchParams.get('cursor'), 'opaque A+/=');
  assert.equal(requestOptions.headers['X-API-Key'], 'fixture-secret');
  assert.equal(requestOptions.redirect, 'manual', 'the API key is not sent to redirect targets');
  assert.equal(requestOptions.signal.aborted, false);
  assert.throws(() => __history.buildApibaraUrl({ operation: 'https://attacker.invalid' }), error => error.code === 'INVALID_REQUEST');

  await assert.rejects(
    __history.requestApibara({ APIBARA_KEY: 'fallback-is-not-accepted' }, { operation: 'vehicleByIdentifier', identifier: 'VIN' }),
    error => error.code === 'CONFIGURATION' && !error.message.includes('fallback-is-not-accepted')
  );
});

test('Apibara read helpers make no D1 access and keep endpoint persistence outside the read layer', async () => {
  const requests = [];
  const { __history } = loadWorker(async url => {
    requests.push(new URL(url));
    return new Response(JSON.stringify({
      data: { history: [{ source_event_id: 'EV-1', vin: fixtures.vehicle.vin, lot_number: 'LOT-123' }] },
      meta: { next_cursor: 'cursor-next' }
    }), { status: 200 });
  });
  const env = {
    APIBARA_API_KEY: 'fixture-secret',
    get REXBID_DB() { throw new Error('read helpers must not access D1'); }
  };

  await __history.fetchApibaraVehicle(env, fixtures.vehicle.vin);
  await __history.searchApibaraVehicles(env, 'LOT-123', 20);
  const page = await __history.fetchApibaraHistory(env, fixtures.vehicle.vin, {
    per_page: 20,
    cursor: 'opaque-cursor'
  });
  await __history.fetchApibaraVehicles(env, { per_page: '20' });

  assert.equal(requests.length, 4);
  assert.equal(requests[2].searchParams.get('cursor'), 'opaque-cursor');
  assert.equal(page.nextCursor, 'cursor-next');
  assert.equal(page.records.length, 1);
  assert.equal(page.records[0].source_event_id, 'EV-1');
});

test('production GET routes use D1 SELECT only and preserve vehicle/history responses', async () => {
  const rawVehicle = { vin: 'VIN-1', platform: 'copart', lot_number: 'LOT-1', title: 'Test car' };
  const { __worker } = loadWorker(async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/history')) {
      return new Response(JSON.stringify({ data: { history: [fixtures.eventFirst] }, meta: { next_cursor: null } }));
    }
    if (parsed.pathname.endsWith('/VIN-1')) return new Response(JSON.stringify({ data: rawVehicle }));
    return new Response(JSON.stringify({ data: [rawVehicle], meta: { next_cursor: null } }));
  });
  const db = new ReadOnlyD1();
  const env = { APIBARA_API_KEY: 'fixture-key', REXBID_DB: db, ASSETS: { fetch: async () => new Response('asset') } };

  const car = await __worker.fetch(new Request('https://rex.bid/api/car/VIN-1'), env);
  assert.equal(car.status, 200);
  assert.equal((await car.json()).data.vin, 'VIN-1');

  const history = await __worker.fetch(new Request('https://rex.bid/api/car/VIN-1/history?per_page=20'), env);
  const historyJson = await history.json();
  assert.equal(history.status, 200);
  assert.equal(historyJson.history[0].source_event_id, 'ABC');
  assert.equal(historyJson.meta.next_cursor, null);

  const cars = await __worker.fetch(new Request('https://rex.bid/api/cars?per_page=20'), env);
  assert.equal(cars.status, 200);
  assert.equal((await cars.json()).data[0].vin, 'VIN-1');

  const dbStatus = await __worker.fetch(new Request('https://rex.bid/api/database'), env);
  assert.equal(dbStatus.status, 200);
  assert.ok(db.statements.length > 0);
  assert.ok(db.statements.every(sql => /^\s*(SELECT|PRAGMA)\b/i.test(sql)));
});

test('manual synchronization trigger is authenticated, explicit, and persists only on authorized POST', async () => {
  let upstreamCalls = 0;
  const rawVehicle = { vin: 'VIN-1', platform: 'copart', lot_number: 'LOT-123' };
  const db = new SyncMemoryD1();
  const { __worker } = loadWorker(async url => {
    upstreamCalls++;
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/history')) {
      return new Response(JSON.stringify({ data: { history: [fixtures.eventFirst] }, meta: { next_cursor: null } }));
    }
    return new Response(JSON.stringify({ data: rawVehicle }));
  });
  const env = {
    APIBARA_API_KEY: 'fixture-key',
    REXBID_SYNC_TOKEN: 's'.repeat(40),
    REXBID_DB: db,
    ASSETS: { fetch: async () => new Response('asset') }
  };

  const path = 'https://rex.bid/api/sync/vehicle/VIN-1';
  const noAuth = await __worker.fetch(new Request(path, { method: 'POST' }), env);
  assert.equal(noAuth.status, 401);
  assert.equal(upstreamCalls, 0);
  assert.equal(db.statements.length, 0);

  const wrongAuth = await __worker.fetch(new Request(path, {
    method: 'POST', headers: { Authorization: 'Bearer wrong-token' }
  }), env);
  assert.equal(wrongAuth.status, 401);
  assert.equal(upstreamCalls, 0);

  const get = await __worker.fetch(new Request(path), env);
  assert.equal(get.status, 405);
  assert.equal(upstreamCalls, 0);

  const response = await __worker.fetch(new Request(path, {
    method: 'POST', headers: { Authorization: `Bearer ${env.REXBID_SYNC_TOKEN}` }
  }), env);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(result.completed, true);
  assert.equal(upstreamCalls, 2);
  assert.equal(db.vehicles.length, 1);
  assert.equal(db.snapshots.length, 1);
  assert.equal(db.history.length, 1);
  assert.ok(db.statements.some(sql => /^\s*INSERT\s+INTO\s+vehicles/i.test(sql)));
});

test('GET local fallback remains readable without schema creation or writes', async () => {
  const vehicle = {
    vehicle_key: 'copart:VIN-1', vin: 'VIN-1', slug_vin: null, platform: 'copart', lot: 'LOT-1',
    raw_json: JSON.stringify({ vin: 'VIN-1', platform: 'copart', lot_number: 'LOT-1' })
  };
  const historyRecord = { ...fixtures.eventFirst, vin: 'VIN-1', raw_json: JSON.stringify({ ...fixtures.eventFirst, vin: 'VIN-1' }) };
  const db = new ReadOnlyD1({ vehicle, history: [{
    vehicle_key: 'copart:VIN-1', event_key: 'source:copart:ABC', source_event_id: 'ABC',
    vin: 'VIN-1', platform: 'copart', lot: 'LOT-123', auction_date: '2025-01-10', sale_date: null,
    current_bid: 500, final_price: null, buy_now: null, price: 500, seller: 'Copart Direct',
    status: 'pre-bid', captured_at: '2025-01-10T00:00:00Z', raw_json: historyRecord.raw_json
  }] });
  const { __worker } = loadWorker(async () => new Response(JSON.stringify({ error: 'upstream unavailable' }), { status: 503 }));
  const env = { APIBARA_API_KEY: 'fixture-key', REXBID_DB: db, ASSETS: { fetch: async () => new Response('asset') } };

  const car = await __worker.fetch(new Request('https://rex.bid/api/car/VIN-1'), env);
  assert.equal((await car.json()).source, 'rexbid-database');
  const history = await __worker.fetch(new Request('https://rex.bid/api/car/VIN-1/history'), env);
  const result = await history.json();
  assert.equal(result.source, 'd1');
  assert.equal(result.history[0].source_event_id, 'ABC');
  assert.equal(result.history[0].final_price, null, 'legacy price remains source-only');
  assert.ok(db.statements.every(sql => /^\s*(SELECT|PRAGMA)\b/i.test(sql)));
});

test('syncVehicle upserts vehicles/history idempotently and snapshots only on fingerprint changes', async () => {
  const rawVehicle = { vin: 'VIN-1', platform: 'copart', lot_number: 'LOT-123', pricing: { current_bid_usd: 500 } };
  const calls = [];
  const db = new SyncMemoryD1();
  const { __history } = loadWorker(async url => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname.endsWith('/history')) {
      const cursor = parsed.searchParams.get('cursor');
      return new Response(JSON.stringify(cursor
        ? { data: { history: [fixtures.eventOther] }, meta: { next_cursor: null } }
        : { data: { history: [fixtures.eventFirst] }, meta: { next_cursor: 'CURSOR-A' } }));
    }
    return new Response(JSON.stringify({ data: rawVehicle }));
  });
  const env = { APIBARA_API_KEY: 'fixture-key', REXBID_DB: db };

  const first = await __history.syncVehicle(env, 'VIN-1');
  assert.equal(first.completed, true);
  assert.equal(first.historyPages, 2);
  assert.equal(db.vehicles.length, 1);
  assert.equal(db.snapshots.length, 1);
  assert.equal(db.history.length, 2, 'same LOT/date with different explicit IDs remains two events');
  assert.deepEqual(calls.filter(url => url.pathname.endsWith('/history')).map(url => url.searchParams.get('cursor')), [null, 'CURSOR-A']);

  const second = await __history.syncVehicle(env, 'VIN-1');
  assert.equal(second.completed, true);
  assert.equal(db.vehicles.length, 1, 'vehicle is upserted, not duplicated');
  assert.equal(db.snapshots.length, 1, 'unchanged fingerprint does not create a snapshot');
  assert.equal(db.history.length, 2, 'repeated sync updates existing events');

  rawVehicle.pricing.current_bid_usd = 650;
  const changed = await __history.syncVehicle(env, 'VIN-1');
  assert.equal(changed.completed, true);
  assert.equal(db.vehicles.length, 1);
  assert.equal(db.snapshots.length, 2, 'changed fingerprint adds exactly one snapshot');
  assert.equal(db.history.length, 2);
});

test('incomplete history pagination does not persist or report a completed sync', async () => {
  const db = new SyncMemoryD1();
  const { __history } = loadWorker(async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/history')) {
      if (!parsed.searchParams.has('cursor')) {
        return new Response(JSON.stringify({ data: { history: [fixtures.eventFirst] }, meta: { next_cursor: 'CURSOR-A' } }));
      }
      return new Response(JSON.stringify({ error: 'upstream failure' }), { status: 503 });
    }
    return new Response(JSON.stringify({ data: { vin: 'VIN-1', platform: 'copart', lot_number: 'LOT-123' } }));
  });
  const result = await __history.syncVehicle({ APIBARA_API_KEY: 'fixture-key', REXBID_DB: db }, 'VIN-1');
  assert.equal(result.ok, false);
  assert.equal(result.completed, false);
  assert.equal(result.pagesFetched, 1);
  assert.equal(db.vehicles.length, 0);
  assert.equal(db.snapshots.length, 0);
  assert.equal(db.history.length, 0);
  assert.equal(db.statements.length, 0, 'D1 is not touched until all history pages are fetched');
});

test('requestApibara maps upstream errors without exposing response bodies and does not retry', async () => {
  let calls = 0;
  const { __history } = loadWorker(async () => {
    calls++;
    return new Response(JSON.stringify({ message: 'UPSTREAM_BODY_SECRET_MARKER' }), {
      status: 429, headers: { 'Retry-After': '12' }
    });
  });
  let caught;
  await assert.rejects(__history.requestApibara({ APIBARA_API_KEY: 'fixture-secret' }, {
    operation: 'searchVehicles', search: 'VIN', per_page: 20
  }), error => {
    caught = error;
    return error.code === 'RATE_LIMITED' && error.status === 429 && error.retryAfter === 12;
  });
  assert.equal(calls, 1, '429 response is not retried');
  assert.ok(!caught.message.includes('UPSTREAM_BODY_SECRET_MARKER'));
  const response = __history.apibaraErrorResponse(caught);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '12');
  assert.ok(!(await response.text()).includes('UPSTREAM_BODY_SECRET_MARKER'));
});

test('requestApibara logs safe fetch diagnostics and redacts secrets and upstream bodies', async () => {
  const logs = [];
  const logger = {
    warn(...parts) { logs.push(parts.join(' ')); },
    error(...parts) { logs.push(parts.join(' ')); }
  };
  const { __history } = loadWorker(async () => {
    throw Object.assign(new TypeError('fetch failed PRIVATE_API_KEY'), {
      cause: Object.assign(new Error('socket failure PRIVATE_API_KEY'), {
        code: 'ECONNRESET', errno: -104, syscall: 'connect'
      })
    });
  }, { console: logger });

  await assert.rejects(__history.requestApibara({ APIBARA_API_KEY: 'PRIVATE_API_KEY' }, {
    operation: 'vehicleByIdentifier', identifier: 'VIN'
  }), error => error.code === 'UPSTREAM' && error.status === null);

  assert.equal(logs.length, 1);
  assert.match(logs[0], /Apibara request diagnostic/);
  assert.match(logs[0], /"stage":"fetch"/);
  assert.match(logs[0], /"errorName":"TypeError"/);
  assert.match(logs[0], /"errorMessage":"fetch failed \[REDACTED\]"/);
  assert.match(logs[0], /"causeType":"object"/);
  assert.match(logs[0], /ECONNRESET/);
  assert.match(logs[0], /"syscall":"connect"/);
  assert.doesNotMatch(logs[0], /PRIVATE_API_KEY/);
});

test('requestApibara identifies URL-stage failures without logging credentials', async () => {
  const logs = [];
  const logger = {
    warn(...parts) { logs.push(parts.join(' ')); },
    error(...parts) { logs.push(parts.join(' ')); }
  };
  const { __history } = loadWorker(async () => {
    throw new Error('URL stage should not call fetch');
  }, { console: logger });

  await assert.rejects(__history.requestApibara({ APIBARA_API_KEY: 'PRIVATE_API_KEY' }, {
    operation: 'unsupportedOperation'
  }), error => error.code === 'INVALID_REQUEST');

  assert.equal(logs.length, 1);
  assert.match(logs[0], /"stage":"URL"/);
  assert.match(logs[0], /"causeType":"undefined"/);
  assert.doesNotMatch(logs[0], /PRIVATE_API_KEY/);
});

test('requestApibara timeout aborts the one request without retry', async () => {
  let calls = 0;
  const { __history } = loadWorker(async (_url, options) => {
    calls++;
    assert.equal(options.signal.aborted, true);
    throw Object.assign(new Error('abort'), { name: 'AbortError' });
  }, {
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {}
  });
  await assert.rejects(__history.requestApibara({ APIBARA_API_KEY: 'fixture-secret' }, {
    operation: 'vehicleByIdentifier', identifier: 'VIN'
  }), error => error.code === 'TIMEOUT');
  assert.equal(calls, 1);
});

test('fallback keys distinguish separate auctions for the same VIN and LOT', () => {
  const { __history } = loadWorker();
  const first = __history.normalizeHistoryRecord({ ...fixtures.genericPriceOnly, date: '2025-01-10' });
  const second = __history.normalizeHistoryRecord({ ...fixtures.genericPriceOnly, date: '2025-02-15' });
  assert.notEqual(first.event_key, second.event_key);
  assert.equal(__history.normalizeHistoryRecord(fixtures.eventFirst).event_key, 'source:copart:ABC');
  assert.notEqual(
    __history.normalizeHistoryRecord(fixtures.eventFirst).event_key,
    __history.normalizeHistoryRecord(fixtures.eventOther).event_key
  );
});

test('explicit event_key values remain distinct and stable across mutable fields', () => {
  const { __history } = loadWorker();
  const first = __history.normalizeHistoryRecord({ ...fixtures.eventFirst, source_event_id: undefined, event_key: 'EV-ONE' });
  const other = __history.normalizeHistoryRecord({ ...fixtures.eventFirst, source_event_id: undefined, event_key: 'EV-TWO', status: 'sold', price: 9000 });
  const changed = __history.normalizeHistoryRecord({ ...fixtures.eventFirst, source_event_id: undefined, event_key: 'EV-ONE', status: 'sold', price: 9000 });
  assert.notEqual(first.event_key, other.event_key);
  assert.equal(first.event_key, changed.event_key);
});

test('auction history migration is additive and does not infer final price or delete legacy data', () => {
  const migration = fs.readFileSync(path.join(root, 'migrations/0001_auction_history_events.sql'), 'utf8');
  assert.match(migration, /ALTER\s+TABLE\s+auction_history\s+ADD\s+COLUMN\s+event_key/i);
  assert.match(migration, /ALTER\s+TABLE\s+auction_history\s+ADD\s+COLUMN\s+final_price/i);
  assert.match(migration, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
  assert.doesNotMatch(migration, /\b(DROP|DELETE|UPDATE|INSERT|REPLACE)\b/i);
  assert.doesNotMatch(migration, /CREATE\s+UNIQUE\s+INDEX/i);
  assert.match(migration, /price[\s\S]*?not copied to final_price/i);
});
test('same event ID updates one D1 record when status and price change', async () => {
  const { __history } = loadWorker();
  const db = new MemoryD1();
  const env = { REXBID_DB: db };
  await __history.saveOfficialHistory(env, 'copart:VIN-1', __history.normalizeApibaraHistory({ data: [fixtures.eventFirst] }, fixtures.vehicle));
  await __history.saveOfficialHistory(env, 'copart:VIN-1', __history.normalizeApibaraHistory({ data: [fixtures.eventUpdated] }, fixtures.vehicle));
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].status, 'sold');
  assert.equal(db.rows[0].final_price, 5200);
  assert.equal(JSON.parse(db.rows[0].raw_json).status, 'sold');
  assert.equal(db.rows[0].seller, 'Copart Direct');
  await __history.saveOfficialHistory(env, 'copart:VIN-1', __history.normalizeApibaraHistory({ data: [fixtures.eventOther] }, fixtures.vehicle));
  assert.equal(db.rows.length, 2, 'different source event IDs stay separate');
  assert.equal(db.rows[0].source_event_id, 'ABC');
  assert.equal(db.rows[1].source_event_id, 'DEF', 'different IDs with the same LOT and date remain separate');
});

test('legacy D1 rows remain readable and generic price is not backfilled as final price', async () => {
  const { __history } = loadWorker();
  const legacyRaw = fixtures.genericPriceOnly;
  const db = new MemoryD1([{
    id: 7, vehicle_key: 'copart:VIN-1', platform: 'copart', auction_date: '2025-01-11',
    price: 5200, status: 'sold', event_hash: 'old-hash', captured_at: '2025-01-12T00:00:00Z',
    raw_json: JSON.stringify(legacyRaw)
  }]);
  const history = await __history.getSavedAuctionHistory({ REXBID_DB: db }, 'copart:VIN-1');
  assert.equal(history.length, 1);
  assert.equal(history[0].source_price, 5200);
  assert.equal(history[0].final_price, null);
  assert.equal(history[0].raw_json.price, 5200);
  assert.equal(db.rows[0].raw_json, JSON.stringify(legacyRaw), 'read path does not rewrite legacy raw_json');
});

test('history endpoint forwards an opaque cursor and returns canonical history with no-store', async () => {
  let requested;
  const page = { data: [fixtures.single], meta: { per_page: 20, next_cursor: 'NEXT/+=opaque' } };
  const context = loadWorker(async url => {
    requested = new URL(url);
    return new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const response = await context.__worker.fetch(
    new Request('https://rex.bid/api/car/1HGCM82633A123456/history?per_page=88&cursor=opaque%2F%2B%3D'),
    { APIBARA_API_KEY: 'fixture-key' }
  );
  const body = await response.json();
  assert.equal(requested.searchParams.get('per_page'), '20', 'Apibara history max per_page is 20');
  assert.equal(requested.searchParams.get('cursor'), 'opaque/+=');
  assert.equal(body.meta.next_cursor, 'NEXT/+=opaque');
  assert.equal(body.meta.has_more, true);
  assert.equal(body.history.length, 1);
  assert.equal(body.history[0].final_price, 5200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('history endpoint validates per_page and ends pagination when cursor is null', async () => {
  let calls = 0;
  const context = loadWorker(async () => {
    calls++;
    return new Response(JSON.stringify({ data: [], meta: { next_cursor: null } }), { status: 200 });
  });
  const invalid = await context.__worker.fetch(new Request('https://rex.bid/api/car/VIN/history?per_page=abc'), { APIBARA_API_KEY: 'fixture-key' });
  assert.equal(invalid.status, 400);
  const response = await context.__worker.fetch(new Request('https://rex.bid/api/car/VIN/history?per_page=0'), { APIBARA_API_KEY: 'fixture-key' });
  const body = await response.json();
  assert.equal(calls, 1);
  assert.equal(body.meta.per_page, 1);
  assert.equal(body.meta.next_cursor, null);
  assert.equal(body.meta.has_more, false);
});

test('frontend follows three real cursors and collects 47 events without repeats', async () => {
  const pages = [
    Array.from({ length: 20 }, (_, i) => ({ event_key: `E${i}`, platform: 'copart', lot: `L${i}`, auction_date: `2025-01-${String(i + 1).padStart(2,'0')}` })),
    Array.from({ length: 20 }, (_, i) => ({ event_key: `E${i + 20}`, platform: 'copart', lot: `L${i + 20}`, auction_date: `2025-02-${String(i + 1).padStart(2,'0')}` })),
    Array.from({ length: 7 }, (_, i) => ({ event_key: `E${i + 40}`, platform: 'iaai', lot: `L${i + 40}`, auction_date: `2025-03-${String(i + 1).padStart(2,'0')}` }))
  ];
  const byCursor = new Map([[null, {history: pages[0], meta:fixtures.pages[0].meta}],
    ['CURSOR-A', {history: pages[1], meta:fixtures.pages[1].meta}],
    ['CURSOR-B', {history: pages[2], meta:fixtures.pages[2].meta}]]);
  const requests = [];
  const renderFunctions = extractFunctionBlock(carSource, 'historyRecordKey', 'renderAuctionHistory');
  const helperBlock = extractFunctionBlock(carSource, 'fetchAuctionHistoryPages', 'fetchAuctionHistory');
  const context = { API_BASE:'https://rex.bid/api', URLSearchParams,
    normalizeHistoryRecord: record => record, auctionHistoryRecords:[],
    isEmpty: value => value === null || value === undefined || value === '' };
  vm.createContext(context);
  vm.runInContext(`${renderFunctions}${helperBlock}\nglobalThis.loadPages = fetchAuctionHistoryPages;`, context);
  const result = await context.loadPages('VIN-1', () => {}, async url => {
    const parsed = new URL(url);
    const cursor = parsed.searchParams.get('cursor');
    requests.push(cursor);
    return new Response(JSON.stringify(byCursor.get(cursor)), {status:200});
  });
  assert.deepEqual(requests, [null, 'CURSOR-A', 'CURSOR-B']);
  assert.equal(result.length, 47);
  assert.equal(new Set(result.map(item => item.event_key)).size, 47);
});

test('frontend stops on a repeated cursor, deduplicates overlap, and retains completed pages on later failure', async () => {
  const renderFunctions = extractFunctionBlock(carSource, 'historyRecordKey', 'renderAuctionHistory');
  const helperBlock = extractFunctionBlock(carSource, 'fetchAuctionHistoryPages', 'fetchAuctionHistory');
  const context = { API_BASE:'https://rex.bid/api', URLSearchParams, normalizeHistoryRecord: record => record,
    auctionHistoryRecords:[], isEmpty: value => value === null || value === undefined || value === '' };
  vm.createContext(context);
  vm.runInContext(`${renderFunctions}${helperBlock}\nglobalThis.loadPages = fetchAuctionHistoryPages;`, context);

  const duplicatePageRecord = {event_key:'E1',platform:'copart',lot:'L1',auction_date:'2025-01-01'};
  let calls = 0;
  const returned = await context.loadPages('VIN-1', () => {}, async () => {
    calls++;
    return new Response(JSON.stringify({history:[duplicatePageRecord],meta:{next_cursor:'CURSOR-A'}}), {status:200});
  });
  assert.equal(calls, 2, 'the repeated cursor does not trigger a third request');
  assert.equal(returned.length, 1, 'same event on later page is removed');
  assert.equal(new Set(returned.map(item=>item.event_key)).size, 1);

  let completed = [];
  let failCall = 0;
  await assert.rejects(context.loadPages('VIN-1', page => { completed = page.slice(); }, async () => {
    failCall++;
    if (failCall === 1) return new Response(JSON.stringify({history:[duplicatePageRecord],meta:{next_cursor:'CURSOR-A'}}), {status:200});
    return new Response('{}', {status:502});
  }));
  assert.equal(completed.length, 1, 'successfully fetched records remain available to the caller');
});

test('frontend history code consumes canonical pages, caps requests, guards cursor loops, and preserves date-only values', () => {
  const scripts = [...carSource.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]) && (!/\btype\s*=/.test(match[1]) || /type\s*=\s*["']?(?:text\/javascript|module)/i.test(match[1])));
  assert.ok(scripts.length > 0, 'inline frontend script exists');
  scripts.forEach((match, index) => new vm.Script(match[2], {filename:`public/car.html:inline-${index+1}`}));

  assert.match(carSource, /json\?\.history/);
  assert.match(carSource, /json\?\.meta\?\.next_cursor/);
  assert.match(carSource, /const maxPages = 20/);
  assert.match(carSource, /seenCursors\.has\(next\)/);
  assert.match(carSource, /cache: "no-store"/);
  assert.match(carSource, /item\.final_price/);

  const formatBlock = extractFunctionBlock(carSource, 'formatHistoryDate', 'getCurrentAuctionHistoryFinalBid');
  const dateContext = { isEmpty: value => value === null || value === undefined || value === '' };
  vm.createContext(dateContext);
  vm.runInContext(`${formatBlock}\nglobalThis.format = formatHistoryDate;`, dateContext);
  assert.equal(dateContext.format('2026-09-20'), '2026-09-20');
  assert.equal(dateContext.format('2026-09-20T00:30:00+02:00'), '2026-09-20');

  const renderBlock = extractFunctionBlock(carSource, 'historyRecordKey', 'renderAuctionHistory');
  const renderContext = { auctionHistoryRecords: [], isEmpty: value => value === null || value === undefined || value === '' };
  vm.createContext(renderContext);
  vm.runInContext(`${renderBlock}\nglobalThis.dedupe = historyRecordsForRender;`, renderContext);
  const a = { event_key: 'source:copart:ABC', status: 'pre-bid', current_bid: 500 };
  const updated = { event_key: 'source:copart:ABC', status: 'sold', final_price: 5200 };
  const b = { event_key: 'source:copart:DEF', status: 'not sold' };
  assert.equal(renderContext.dedupe([a, updated, b]).length, 2);
  const overlap = renderContext.dedupe([
    ...Array.from({length:20}, (_,i)=>({event_key:`P${i}`,auction_date:'2025-01-01'})),
    {event_key:'P19',auction_date:'2025-01-01'},
    ...Array.from({length:19}, (_,i)=>({event_key:`Q${i}`,auction_date:'2025-02-01'})),
    ...Array.from({length:7}, (_,i)=>({event_key:`R${i}`,auction_date:'2025-03-01'}))
  ]);
  assert.equal(overlap.length, 46, 'one overlapping event is removed while unique events remain');
});

test('index list pagination appends by cursor, resets filters, deduplicates by VIN/LOT, and preserves links on failure', async () => {
  const scripts = [...indexSource.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]));
  assert.ok(scripts.length > 0, 'inline index script exists');

  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, value: '', innerHTML: '', textContent: '', hidden: false, disabled: false,
        style: {}, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; },
        scrollIntoView() {}
      });
    }
    return elements.get(id);
  };

  const requests = [];
  let nextFetch;
  const fetchImpl = url => {
    requests.push(new URL(url, 'https://rex.bid'));
    return new Promise((resolve, reject) => { nextFetch = { resolve, reject }; });
  };
  const context = {
    document: { getElementById: element },
    URLSearchParams,
    Response,
    fetch: fetchImpl,
    console: { error() {}, warn() {}, log() {} }
  };
  vm.createContext(context);

  const script = scripts[0][2].replace(/\n\s*loadCars\((?:\{\s*updateUrl:\s*false\s*\})?\);\s*$/, '\n  globalThis.initialLoad = loadCars();');
  assert.notEqual(script, scripts[0][2], 'initial list load can be awaited by the test');
  vm.runInContext(`${script}\nglobalThis.testLoadCars = loadCars;`, context);

  const response = (data, nextCursor) => new Response(JSON.stringify({
    ok: true, data, meta: { next_cursor: nextCursor }
  }), { status:  200, headers: { 'Content-Type': 'application/json' } });
  const loadMore = element('loadMoreButton');
  const car = (vin, lot) => ({ vin, lot_number: lot, make: 'Toyota', model: 'Test' });

  nextFetch.resolve(response([car('VIN-A', 'LOT-A'), car('VIN-B', 'LOT-B')], 'opaque/+cursor'));
  await context.initialLoad;
  assert.equal(requests[0].searchParams.get('per_page'), '20');
  assert.equal(requests[0].searchParams.has('cursor'), false);
  assert.equal(loadMore.hidden, false);

  const deferredPage = loadMore.listeners.click();
  assert.equal(loadMore.disabled, true, 'load more disables while its request is pending');
  assert.equal(requests[1].searchParams.get('cursor'), 'opaque/+cursor');
  nextFetch.resolve(response([car('VIN-B', 'LOT-B'), car('VIN-C', 'LOT-C'), car('', 'LOT-D')], null));
  await deferredPage;
  assert.equal((element('cars').innerHTML.match(/<article class="car-card">/g) || []).length, 4);
  assert.match(element('cars').innerHTML, /car\.html\?vin=VIN-C/);
  assert.match(element('cars').innerHTML, /car\.html\?lot=LOT-D/);
  assert.equal(loadMore.hidden, true, 'no next cursor hides the button');
  assert.equal(loadMore.disabled, false);

  element('platform').value = 'copart';
  const filterLoad = element('platform').listeners.change();
  assert.equal(requests[2].searchParams.get('platform'), 'copart');
  assert.equal(requests[2].searchParams.has('cursor'), false, 'platform change starts at page one');
  nextFetch.resolve(response([car('VIN-COPART', 'LOT-COPART')], 'copart-next'));
  await filterLoad;
  assert.equal((element('cars').innerHTML.match(/<article class="car-card">/g) || []).length, 1);

  element('searchInput').value = 'Toyota';
  const searchLoad = element('searchForm').listeners.submit({ preventDefault() {} });
  assert.equal(requests[3].searchParams.get('s'), 'Toyota');
  assert.equal(requests[3].searchParams.has('cursor'), false, 'changed search starts at page one');
  nextFetch.resolve(response([car('VIN-SEARCH', 'LOT-SEARCH')], 'search-next'));
  await new Promise(resolve => setImmediate(resolve));

  const retryablePage = loadMore.listeners.click();
  nextFetch.reject(new Error('temporary failure'));
  await retryablePage;
  assert.equal((element('cars').innerHTML.match(/<article class="car-card">/g) || []).length, 1,
    'previously loaded cards remain after a later page fails');
  assert.equal(loadMore.disabled, false, 'load more can be retried after failure');
  assert.equal(loadMore.hidden, false, 'failed cursor remains available for retry');
});

test('index exposes only Worker-supported advanced filters and restores shareable filter URL state', async () => {
  const scripts = [...indexSource.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]));
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, value: '', innerHTML: '', textContent: '', hidden: false, disabled: false,
        style: {}, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; },
        scrollIntoView() {}
      });
    }
    return elements.get(id);
  };

  const location = { href: 'https://rex.bid/', pathname: '/', search: '', hash: '' };
  const historyCalls = [];
  const window = {
    location,
    history: {
      pushState(_state, _title, nextUrl) {
        historyCalls.push(nextUrl);
        const parsed = new URL(nextUrl, location.href);
        Object.assign(location, { href: parsed.href, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash });
      }
    },
    listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; }
  };
  const requests = [];
  let nextFetch;
  const context = {
    document: { getElementById: element },
    URL, URLSearchParams, Response, window,
    fetch(url) {
      requests.push(new URL(url, 'https://rex.bid'));
      return new Promise((resolve, reject) => { nextFetch = { resolve, reject }; });
    },
    console: { error() {}, warn() {}, log() {} }
  };
  vm.createContext(context);
  const script = scripts[0][2].replace(/\n\s*loadCars\((?:\{\s*updateUrl:\s*false\s*\})?\);\s*$/, '\n  globalThis.initialLoad = loadCars();');
  assert.notEqual(script, scripts[0][2]);
  vm.runInContext(`${script}\nglobalThis.testLoadCars = loadCars;`, context);

  const response = (data, nextCursor) => new Response(JSON.stringify({
    ok: true, data, meta: { next_cursor: nextCursor }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  nextFetch.resolve(response([{ vin: 'VIN-FILTER', lot_number: 'LOT-FILTER' }], 'cursor-filtered'));
  await context.initialLoad;

  const selected = {
    searchInput: 'Toyota', platform: 'copart', make: 'Toyota', model: 'Camry', yearFrom: '2018', yearTo: '2024',
    lotStatus: 'Buy Now', lotSubStatus: 'Open', upcoming: 'only', priceMin: '1000', priceMax: '15000',
    odometerFrom: '0', odometerTo: '120000', fuelType: 'Gasoline', transmission: 'Automatic',
    driveType: 'AWD', runCond: 'RUNS AND DRIVES'
  };
  for (const [id, value] of Object.entries(selected)) {
    const control = element(id);
    control.value = value;
    control.listeners.input?.();
  }
  assert.equal(element('advancedFilterCount').textContent, '11');
  assert.match(element('activeFilterChips').innerHTML, /Przebieg od/);

  const filteredLoad = element('advancedFilterButton').listeners.click();
  const expected = {
    s: 'Toyota', platform: 'copart', make: 'Toyota', model: 'Camry', year_from: '2018', year_to: '2024',
    lot_status: 'Buy Now', lot_sub_status: 'Open', upcoming: 'only', price_min: '1000', price_max: '15000',
    odometer_from: '0', odometer_to: '120000', fuel_type: 'Gasoline', transmission: 'Automatic',
    drive_type: 'AWD', run_cond: 'RUNS AND DRIVES'
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(requests[1].searchParams.get(name), value, name);
  assert.equal(requests[1].searchParams.has('cursor'), false, 'filter apply starts at page one');
  const shareUrl = new URL(location.href);
  for (const [name, value] of Object.entries(expected)) assert.equal(shareUrl.searchParams.get(name), value, `URL ${name}`);
  assert.equal(historyCalls.length, 1);
  nextFetch.resolve(response([{ vin: 'VIN-FILTER', lot_number: 'LOT-FILTER' }], 'cursor-filtered'));
  await filteredLoad;

  const nextPage = element('loadMoreButton').listeners.click();
  assert.equal(requests[2].searchParams.get('cursor'), 'cursor-filtered');
  assert.equal(requests[2].searchParams.get('price_min'), '1000', 'active filters carry to the next cursor page');
  nextFetch.resolve(response([{ vin: 'VIN-FILTER', lot_number: 'LOT-FILTER' }, { vin: 'VIN-NEXT', lot_number: 'LOT-NEXT' }], null));
  await nextPage;
  assert.equal((element('cars').innerHTML.match(/<article class="car-card">/g) || []).length, 2);

  const reset = element('clearFiltersButton').listeners.click();
  assert.equal(requests[3].searchParams.has('cursor'), false);
  for (const name of Object.keys(expected)) assert.equal(requests[3].searchParams.has(name), false, `cleared ${name}`);
  assert.equal(location.search, '');
  assert.equal(element('advancedFilterCount').textContent, '0');
  nextFetch.resolve(response([], null));
  await reset;

  Object.assign(location, { href: 'https://rex.bid/?platform=iaai&fuel_type=Electric', search: '?platform=iaai&fuel_type=Electric' });
  window.listeners.popstate();
  assert.equal(element('platform').value, 'iaai', 'back/forward restores the platform filter');
  assert.equal(element('fuelType').value, 'Electric', 'back/forward restores advanced filters');
  assert.equal(requests[4].searchParams.get('platform'), 'iaai');
  assert.equal(requests[4].searchParams.get('fuel_type'), 'Electric');
  assert.equal(requests[4].searchParams.has('cursor'), false, 'restoring URL state starts at page one');
  nextFetch.resolve(response([], null));
  await new Promise(resolve => setImmediate(resolve));
});

test('listing and detail price labels preserve price meaning and finished overrides a future auction date', () => {
  const listingBlock = extractFunctionBlock(indexSource, 'getPriceInfo', 'getMileage');
  const listingContext = {};
  vm.createContext(listingContext);
  vm.runInContext(`${listingBlock}\nglobalThis.priceInfo = getPriceInfo;`, listingContext);
  const soldListingPrice = listingContext.priceInfo({ pricing: { sale_price_usd: 2025, current_bid_usd: 1800 } });
  const buyNowListingPrice = listingContext.priceInfo({ pricing: { current_bid_usd: null, buy_now_usd: 2925 } });
  assert.deepEqual(JSON.parse(JSON.stringify(soldListingPrice)), { value: 2025, label: 'Cena sprzedaży' });
  assert.deepEqual(JSON.parse(JSON.stringify(buyNowListingPrice)), { value: 2925, label: 'Kup teraz' });
  assert.equal(listingContext.priceInfo({ price: 1000, estimated_cost: { from: 500, to: 1500 } }).value, null);

  const phaseBlock = extractFunctionBlock(carSource, 'auctionPhase', 'auctionStatusLabel');
  const phaseContext = {
    getAuctionStatus: () => 'finished',
    getAuctionStart: () => '2099-12-28T17:30:00Z',
    getAuctionEnd: () => null,
    getFinalBid: () => null,
    isEmpty: value => value === null || value === undefined || value === ''
  };
  vm.createContext(phaseContext);
  vm.runInContext(`${phaseBlock}\nglobalThis.phase = auctionPhase;`, phaseContext);
  assert.equal(phaseContext.phase(), 'ended');

  const detailBlock = extractFunctionBlock(carSource, 'getAuctionPriceInfo', 'getBuyNow');
  const detailContext = {
    car: { pricing: { sale_price_usd: 2025, last_sold_price_usd: 2025, buy_now_usd: 2925 } },
    auctionPhase: phaseContext.phase,
    getCurrentBid: () => null,
    getBuyNow: () => 2925,
    first: (...values) => values.find(value => value !== null && value !== undefined && value !== ''),
    isEmpty: value => value === null || value === undefined || value === ''
  };
  vm.createContext(detailContext);
  vm.runInContext(`${detailBlock}\nglobalThis.priceInfo = getAuctionPriceInfo;`, detailContext);
  assert.deepEqual(JSON.parse(JSON.stringify(detailContext.priceInfo())), { value: 2025, label: 'Cena sprzedaży' });
  detailContext.car = { pricing: { last_sold_price_usd: 12500 } };
  assert.deepEqual(JSON.parse(JSON.stringify(detailContext.priceInfo())), { value: 12500, label: 'Ostatnia cena sprzedaży' });
});

test('Car 2.0 keeps vehicle actions and media controls explicit without implying unavailable features work', () => {
  for (const id of ['mainPhoto', 'mainImage', 'thumbs', 'photoCount', 'prevPhoto', 'nextPhoto', 'openHd', 'openVideo', 'open360', 'lightbox', 'viewerModal', 'auctionHistory', 'importCalculator', 'copyVin', 'copyLink']) {
    assert.match(carSource, new RegExp(`id="${id}"`), `preserved detail-page control ${id}`);
  }
  for (const fn of ['fetchVehicle', 'getVin', 'getLot', 'originalAuctionUrl', 'renderPhotos', 'openLightbox', 'setZoom', 'openViewer', 'startCountdown', 'initImportCalculator', 'fetchAuctionHistoryPages', 'updateAuctionUi']) {
    assert.match(carSource, new RegExp(`function ${fn}\\(`), `preserved detail-page function ${fn}`);
  }
  assert.match(carSource, /Otwórz aukcję/);
  assert.match(carSource, /id="toggleFavorite"/);
  assert.match(carSource, /id="toggleCompare"/);
  assert.match(carSource, /Ulubione zapisane na tym urządzeniu/);
  assert.match(carSource, /klasyfikacją nazwy\/typu sprzedawcy/);
  assert.match(carSource, /nie ocena prawna/);
  assert.match(carSource, /\.main-column,\.right-column\{display:contents\}/);
  assert.match(carSource, /#auctionHistoryPanel\{order:9\}/);
});

test('car detail keeps exact VIN and LOT selection and never falls back to the first list item', () => {
  const exactMatchBlock = extractFunctionBlock(carSource, 'normalizeIdentifier', 'fetchVehicle');
  const context = {
    VIN: 'VIN-TARGET', LOT: '',
    collectObjects: data => Array.isArray(data) ? data : [data]
  };
  vm.createContext(context);
  vm.runInContext(`${exactMatchBlock}\nglobalThis.unwrap = unwrapResult;`, context);
  const results = [{ vin: 'VIN-OTHER', lot_number: 'LOT-1' }, { vin: 'VIN-TARGET', lot_number: 'LOT-2' }];
  assert.equal(context.unwrap({ data: results }).vin, 'VIN-TARGET');
  assert.equal(context.unwrap({ data: [{ vin: 'VIN-OTHER' }] }), null, 'does not use the first result if no exact VIN exists');

  context.VIN = '';
  context.LOT = 'LOT-TARGET';
  assert.equal(context.unwrap({ data: [{ lot_number: 'LOT-OTHER' }, { lot_number: 'LOT-TARGET', vin: 'VIN-2' }] }).vin, 'VIN-2');
  assert.equal(context.unwrap({ data: [{ lot_number: 'LOT-OTHER' }] }), null, 'does not use the first result if no exact LOT exists');
});

test('detail price facts stay distinct and updateable, and missing final price labels history bid correctly', () => {
  const priceBlock = extractFunctionBlock(carSource, 'getAuctionPriceFacts', 'getBuyNow');
  let phase = 'live';
  const priceContext = {
    car: { pricing: { current_bid_usd: 1700, buy_now_usd: 2900, sale_price_usd: 2025, last_sold_price_usd: 2025 } },
    auctionPhase: () => phase,
    getCurrentBid: () => 1700,
    getBuyNow: () => 2900,
    getAuctionPriceInfo: () => ({ value: 1700 }),
    first: (...values) => values.find(value => value !== null && value !== undefined && value !== ''),
    isEmpty: value => value === null || value === undefined || value === '',
    esc: value => String(value),
    money: value => `$${value}`
  };
  vm.createContext(priceContext);
  vm.runInContext(`${priceBlock}\nglobalThis.priceFacts = getAuctionPriceFacts; globalThis.priceFactsHtml = renderAuctionPriceFactsHtml;`, priceContext);
  assert.deepEqual(JSON.parse(JSON.stringify(priceContext.priceFacts({ value: 1700, label: 'Aktualna oferta' }))), [{ label: 'Kup teraz', value: 2900 }, { label: 'Cena sprzedaży', value: 2025 }]);
  phase = 'ended';
  assert.deepEqual(JSON.parse(JSON.stringify(priceContext.priceFacts({ value: 2025, label: 'Cena sprzedaży' }))), []);

  const historyBlock = extractFunctionBlock(carSource, 'renderAuctionHistory', 'formatHistoryDate');
  const historyBox = { innerHTML: '' };
  const historyContext = {
    document: { getElementById: () => historyBox },
    historyRecordsForRender: () => [{ final_price: undefined, current_bid: 700, buy_now: null, sale_date: '2026-09-20', lot: 'LOT-7', platform: 'copart', status: 'live', seller: 'Example Seller' }],
    isEmpty: value => value === null || value === undefined || value === '',
    money: value => `$${value}`,
    historyStatusLabel: () => 'W trakcie',
    historyStatusClass: () => 'live',
    platformName: () => 'COPART',
    formatHistoryDate: value => value,
    esc: value => String(value)
  };
  vm.createContext(historyContext);
  vm.runInContext(`${historyBlock}\nglobalThis.render = renderAuctionHistory;`, historyContext);
  historyContext.render();
  assert.match(historyBox.innerHTML, /Aktualna oferta/);
  assert.doesNotMatch(historyBox.innerHTML, /Cena końcowa/);
  assert.match(historyBox.innerHTML, /Example Seller/);
  assert.match(historyBox.innerHTML, /<th>Aukcja<\/th>/, 'platform is explicit even for a single-platform history');
  assert.match(historyBox.innerHTML, /snapshoty Rex\.Bid nie są mieszane z historią aukcji/);
  assert.match(carSource, /oddzielne wydarzenia aukcyjne/);
});
