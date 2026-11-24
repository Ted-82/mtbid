'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {ACCOUNT, TARGETS, assertStatement, safeHttpStatus, safeOperatorDiagnostic, connectD1} = require('../scripts/d1-operator-bridge.cjs');

const TOKEN = 'offline-token-never-a-real-secret';

test('snapshot capability is explicit staging-only, has no quota/private/schema writes and preserves read-only', async () => {
  for (const settings of [{target:'publication',stagingSnapshot:true}, {target:'staging',stagingSnapshot:'true'},
    {target:'staging',stagingSnapshot:true,historyReceipts:true}]) {
    const mock=mockFetch([]);
    await assert.rejects(connectD1({...settings,token:TOKEN,fetchImpl:mock.fetchImpl}),/OPERATOR_STAGING_SNAPSHOT_TARGET_REQUIRED/);
    assert.equal(mock.calls.length,0);
  }
  const allowed=['sync_batch_guards','automatic_refresh_state','automatic_refresh_tasks','automatic_refresh_guards'];
  const forbidden=['users','user_favorites','import_orders','import_order_messages','import_order_files',
    'automatic_refresh_budgets','automatic_refresh_attempts','provider_request_budgets','sync_runs','vehicle_entities'];
  for (const readOnly of [false,true]) {
    const mock=mockFetch([metadata('staging')]);
    const db=await connectD1({target:'staging',token:TOKEN,fetchImpl:mock.fetchImpl,stagingSnapshot:true,readOnly});
    for(const table of allowed) {
      if(readOnly) assert.throws(()=>db.prepare(`DELETE FROM ${table}`),/OPERATOR_WRITE_NOT_ALLOWED/);
      else assert.doesNotThrow(()=>db.prepare(`DELETE FROM ${table}`));
    }
    for(const table of forbidden) assert.throws(()=>db.prepare(`DELETE FROM ${table}`),/OPERATOR_WRITE_NOT_ALLOWED/);
    assert.throws(()=>db.prepare('CREATE TABLE automatic_refresh_other(value TEXT)'),/OPERATOR_WRITE_NOT_ALLOWED/);
    if(!readOnly) await assert.rejects(db.prepare('UPDATE automatic_refresh_state SET lease_owner=?').bind('test').run(),/D1_WRITE_BUDGET_REQUIRED/);
    const tampered=db.prepare('SELECT 1').bind();tampered.sql='DELETE FROM users';
    await assert.rejects(db.batch([tampered]),/OPERATOR_WRITE_NOT_ALLOWED/);
    assert.equal(mock.calls.length,1);
  }
  const {db}=await connect('staging',[]);
  for(const table of allowed) assert.throws(()=>db.prepare(`DELETE FROM ${table}`),/OPERATOR_WRITE_NOT_ALLOWED/);
});

test('staging snapshot guard failure retains only its known marker and leaves budget pending', async () => {
  let reservations=0,completed=0;
  const mock=mockFetch([metadata('staging'),{ok:false,status:400,payload:{success:false,
    errors:[{message:'CHECK constraint failed: valid = 1 PRIVATE_VALUE'}]}}]);
  const db=await connectD1({target:'staging',token:TOKEN,fetchImpl:mock.fetchImpl,stagingSnapshot:true,
    writeBudget:{async beforeWrite(){reservations++;return {};},complete(){completed++;}}});
  await assert.rejects(db.batch([db.prepare('INSERT INTO automatic_refresh_guards(guard_id,valid) VALUES(?,0)').bind('test')]), e=>{
    assert.equal(e.message,'CHECK constraint failed: valid = 1');assert.equal(e.d1_guard_rejected,true);
    assert.equal(JSON.stringify(e).includes('PRIVATE_VALUE'),false);return true;
  });
  assert.equal(reservations,1);assert.equal(completed,0);assert.equal(mock.calls.length,2);
});
function success(result) {return {ok: true, status: 200, payload: {success: true, result}};}
function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    const response = responses.shift();
    if (!response) throw Error('UNEXPECTED_OFFLINE_CALL');
    if (response instanceof Error) throw response;
    return {ok: response.ok, status: response.status, async json() {
      if (response.jsonError) throw response.jsonError;
      return response.payload;
    }};
  };
  return {calls, fetchImpl};
}
function metadata(target = 'publication', overrides = {}) {
  return success({uuid: TARGETS[target].id, name: TARGETS[target].name, ...overrides});
}
async function connect(target, responses, readOnly = false) {
  const mock = mockFetch([metadata(target), ...responses]);
  const db = await connectD1({target, token: TOKEN, fetchImpl: mock.fetchImpl, readOnly, writeBudget: {beforeWrite: async()=>({}), complete() {}}});
  return {db, ...mock};
}

test('operator connection verifies both the database UUID and name before exposing a query interface', async () => {
  for (const override of [{uuid: 'another-database'}, {name: 'mtbid-production'}]) {
    const mock = mockFetch([metadata('publication', override)]);
    await assert.rejects(connectD1({target: 'publication', token: TOKEN, fetchImpl: mock.fetchImpl}), /ACTUAL_DATABASE_IDENTITY_MISMATCH/);
    assert.equal(mock.calls.length, 1); assert.equal(mock.calls[0].options.method, 'GET');
  }
  for (const args of [{target: 'mtbid', token: TOKEN}, {target: 'publication', token: ''}]) {
    const mock = mockFetch([]);
    await assert.rejects(connectD1({...args, fetchImpl: mock.fetchImpl}), /OPERATOR_TARGET_REQUIRED/);
    assert.equal(mock.calls.length, 0);
  }
});

test('publication and staging writes are restricted to their declared tables; readOnly blocks all table mutations', async () => {
  const {db: publication, calls: publicationCalls} = await connect('publication', []);
  for (const sql of ['INSERT INTO provider_request_budgets(provider) VALUES(?)', 'UPDATE sync_runs SET status=?',
    'DELETE FROM sync_batch_guards WHERE guard_id=?', 'INSERT OR IGNORE INTO vehicle_entities(entity_id) VALUES(?)']) {
    assert.doesNotThrow(() => publication.prepare(sql));
  }
  for (const sql of ['DELETE FROM users', 'UPDATE user_favorites SET user_id=?', 'DROP TABLE auction_listings',
    'ALTER TABLE auction_listings ADD COLUMN private TEXT', 'CREATE TRIGGER copy_private AFTER INSERT ON auction_listings BEGIN SELECT 1; END']) {
    assert.throws(() => publication.prepare(sql), /OPERATOR_WRITE_NOT_ALLOWED|SINGLE_STATEMENT_REQUIRED/);
  }
  assert.equal(publicationCalls.length, 1);
  const {db: staging, calls: stagingCalls} = await connect('staging', []);
  assert.doesNotThrow(() => staging.prepare('INSERT INTO auction_listings(listing_id) VALUES(?)'));
  for (const table of ['users', 'user_favorites', 'import_orders', 'import_order_messages', 'import_order_files',
    'import_order_message_reads', 'vehicle_entities', 'sync_runs', 'provider_request_budgets']) {
    assert.throws(() => staging.prepare('DELETE FROM ' + table), /OPERATOR_WRITE_NOT_ALLOWED/);
  }
  assert.equal(stagingCalls.length, 1);
  const {db: readOnly, calls: readOnlyCalls} = await connect('publication', [], true);
  for (const sql of ['INSERT INTO auction_listings(listing_id) VALUES(?)', 'UPDATE vehicle_sources SET platform=?',
    'DELETE FROM sync_runs']) assert.throws(() => readOnly.prepare(sql), /OPERATOR_WRITE_NOT_ALLOWED/);
  assert.doesNotThrow(() => readOnly.prepare('SELECT * FROM users ORDER BY rowid'));
  assert.equal(readOnlyCalls.length, 1);
});

test('only inspection PRAGMAs are permitted, including in readOnly mode; assignments and mutating commands fail before transport', async () => {
  const {db, calls} = await connect('publication', [], true);
  for (const sql of ['PRAGMA table_info(auction_listings)', "PRAGMA table_info('auction_listings')",
    'PRAGMA main.index_list(auction_listings)', 'PRAGMA index_info("listing_index")',
    'PRAGMA foreign_key_list(auction_listings)', 'PRAGMA foreign_key_check', 'PRAGMA integrity_check', 'PRAGMA integrity_check(1);']) {
    assert.doesNotThrow(() => db.prepare(sql), sql);
  }
  for (const sql of ['PRAGMA foreign_keys=OFF', 'PRAGMA writable_schema=ON', 'PRAGMA journal_mode(WAL)',
    'PRAGMA user_version=42', 'PRAGMA table_info=auction_listings', 'PRAGMA optimize', 'PRAGMA wal_checkpoint(TRUNCATE)',
    "PRAGMA table_info('auction_listings=unexpected')", 'PRAGMA table_info(auction_listings) DELETE FROM users']) {
    assert.throws(() => db.prepare(sql), /OPERATOR_PRAGMA_NOT_ALLOWED/, sql);
  }
  assert.equal(calls.length, 1);
});

test('the bridge permits one SQL statement per request and rejects multi-statement mutations', () => {
  const writable = new Set(['auction_listings']);
  for (const sql of ['SELECT 1; DELETE FROM users', 'UPDATE auction_listings SET lot=?; DELETE FROM users',
    'PRAGMA integrity_check; PRAGMA writable_schema=ON', '', null]) {
    assert.throws(() => assertStatement(sql, writable), /SINGLE_STATEMENT_REQUIRED/);
  }
  assert.doesNotThrow(() => assertStatement('SELECT 1;', writable));
  assert.doesNotThrow(() => assertStatement('DELETE FROM auction_listings WHERE lot=?;', writable));
});

test('changing a bound SQL statement cannot bypass the table or readOnly write guards', async () => {
  for (const readOnly of [false, true]) {
    const {db, calls} = await connect('publication', [], readOnly);
    const statement = db.prepare('SELECT 1').bind();
    statement.sql = readOnly ? 'DELETE FROM auction_listings' : 'DELETE FROM users';
    await assert.rejects(statement.all(), /OPERATOR_WRITE_NOT_ALLOWED/);
    await assert.rejects(statement.run(), /OPERATOR_WRITE_NOT_ALLOWED/);
    await assert.rejects(db.batch([statement]), /OPERATOR_WRITE_NOT_ALLOWED/);
    assert.equal(calls.length, 1);
  }
});

test('bound statements preserve parameters and expose the D1 all/first/run result contract without opening other databases', async () => {
  const results = [{results: [{lot: 'TEST-001', platform: 'copart'}], success: true, meta: {changes: 0}}];
  const {db, calls} = await connect('publication', [success(results), success(results), success(results),
    success([{results: [], success: true, meta: {changes: 1}}])]);
  const sql = 'SELECT lot,platform FROM auction_listings WHERE lot=?';
  const statement = db.prepare(sql).bind('TEST-001');
  assert.deepEqual(await statement.all(), results[0]);
  assert.deepEqual(await statement.first(), {lot: 'TEST-001', platform: 'copart'});
  assert.equal(await statement.first('lot'), 'TEST-001');
  assert.deepEqual(await db.prepare('DELETE FROM auction_listings WHERE lot=?').bind('TEST-001').run(),
    {results: [], success: true, meta: {changes: 1}});
  assert.equal(db.metadataVerified, true); assert.deepEqual(db.identity, TARGETS.publication);
  for (const call of calls) {
    assert.ok(call.url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${TARGETS.publication.id}`));
    assert.equal(call.options.redirect, 'error'); assert.equal(call.options.headers.Authorization, 'Bearer ' + TOKEN);
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), {sql, params: ['TEST-001']});
  assert.equal(calls[1].options.method, 'POST');
});

test('an atomic batch is sent as one bounded request with ordered SQL and separate parameters', async () => {
  const outputs = [{success: true, results: [], meta: {changes: 1}}, {success: true, results: [], meta: {changes: 1}}];
  const {db, calls} = await connect('publication', [success(outputs)]);
  const statements = [db.prepare('INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,1)').bind('guard-1'),
    db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind('guard-1')];
  assert.deepEqual(await db.batch(statements), outputs);
  assert.equal(calls.length, 2); assert.equal(calls[1].url.endsWith('/query'), true);
  assert.deepEqual(JSON.parse(calls[1].options.body), {batch: statements.map(item => ({sql: item.sql, params: item.params}))});
  await assert.rejects(db.batch([]), /INVALID_OPERATOR_BATCH/);
  await assert.rejects(db.batch(Array(251).fill(statements[0])), /INVALID_OPERATOR_BATCH/);
  await assert.rejects(db.batch([{sql: 'DELETE FROM users', params: []}]), /OPERATOR_WRITE_NOT_ALLOWED/);
  await assert.rejects(db.batch([{sql: 'PRAGMA writable_schema=ON', params: []}]), /OPERATOR_PRAGMA_NOT_ALLOWED/);
  assert.equal(calls.length, 2);
});

test('failed top-level or per-statement CHECK responses preserve only the atomic guard marker', async () => {
  const unsafe = 'private diagnostics and token value must not escape';
  const failures = [
    {ok: false, status: 400, payload: {success: false, errors: [{message: 'CHECK constraint failed: allowed = 1 ' + unsafe}]}},
    {ok: true, status: 200, payload: {success: true, result: [{success: false, error: 'CHECK constraint failed: allowed = 1 ' + unsafe}]}},
    {ok: true, status: 200, payload: {success: true, result: [{success: false, errors: [{message: 'CHECK constraint failed: allowed = 1 ' + unsafe}]}]}}
  ];
  for (const failure of failures) {
    const {db, calls} = await connect('publication', [failure]);
    await assert.rejects(db.batch([db.prepare('INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,0)').bind('guard-invalid')]), error => {
      assert.equal(error.message, 'CHECK constraint failed: allowed = 1'); assert.equal(error.code, 'OPERATOR_D1_FAILED');
      assert.equal(error.status, failure.status); assert.equal(JSON.stringify(error).includes(unsafe), false); return true;
    });
    assert.equal(calls.length, 2);
  }
});

test('ordinary Cloudflare failures are sanitized and never retried automatically', async () => {
  const {db, calls} = await connect('publication', [{ok: false, status: 429,
    payload: {success: false, errors: [{message: 'secret provider authorization text'}]}}]);
  await assert.rejects(db.prepare('SELECT 1').all(), error => {
    assert.equal(error.message, 'OPERATOR_D1_FAILED'); assert.equal(error.code, 'OPERATOR_D1_FAILED');
    assert.equal(error.status, 429); return true;
  });
  assert.equal(calls.length, 2);
});

test('successful but incomplete D1 result shapes fail closed rather than claiming a committed query or batch', async () => {
  for (const result of [undefined, {}, [], [{success: true}, {success: true}]]) {
    const {db, calls} = await connect('publication', [success(result)]);
    await assert.rejects(db.prepare('SELECT 1').all(), /INVALID_OPERATOR_QUERY_RESULT/);
    assert.equal(calls.length, 2);
  }
  for (const result of [undefined, {}, [], [{success: true}]]) {
    const {db, calls} = await connect('publication', [success(result)]);
    await assert.rejects(db.batch([db.prepare('SELECT 1'), db.prepare('SELECT 2')]), /INVALID_OPERATOR_BATCH_RESULT/);
    assert.equal(calls.length, 2);
  }
});

test('optional D1 diagnostics retain HTTP status and guard stage without exposing raw errors, SQL, parameters or tokens', async () => {
  const diagnostics = [];
  const unsafe = 'SECRET_TOKEN SELECT private_customer_value FROM users';
  const mock = mockFetch([metadata(), {ok: false, status: 503, payload: {success: false,
    errors: [{code: 999999, message: unsafe}]}}]);
  const db = await connectD1({target: 'publication', token: TOKEN, fetchImpl: mock.fetchImpl,
    onDiagnostic(value) {diagnostics.push(value);}});
  await assert.rejects(db.prepare('SELECT * FROM auction_listings WHERE lot=?').bind('PRIVATE_LOT').all(), error => {
    assert.equal(error.message, 'OPERATOR_D1_FAILED'); assert.equal(error.d1_http_status, 503);
    assert.equal(error.d1_transport_stage, 'response'); assert.equal(error.d1_operation, 'query');
    assert.equal(JSON.stringify(error).includes(unsafe), false); return true;
  });
  assert.deepEqual(diagnostics, [{safe_error_code: 'OPERATOR_D1_FAILED', d1_request: true, d1_http_status: 503,
    upstream_request: false, upstream_http_status: null, d1_transport_stage: 'response', d1_transport_code: null,
    d1_operation: 'query', d1_guard_rejected: false}]);
  for (const forbidden of [TOKEN, unsafe, 'PRIVATE_LOT', 'auction_listings', 'SELECT']) assert.equal(JSON.stringify(diagnostics).includes(forbidden), false);
  assert.equal(mock.calls.length, 2);
});

test('fetch timeout, connection reset and invalid JSON produce distinct sanitized diagnostics and never retry', async () => {
  const cases = [
    {response: Object.assign(new Error('PRIVATE_URL_AND_TOKEN'), {name: 'TimeoutError', cause: {code: 'ETIMEDOUT'}}),
      code: 'OPERATOR_D1_TIMEOUT', stage: 'fetch', status: null, transportCode: 'ETIMEDOUT'},
    {response: Object.assign(new Error('PRIVATE_URL_AND_TOKEN'), {cause: {code: 'ECONNRESET', message: 'PRIVATE_SQL'}}),
      code: 'OPERATOR_D1_TRANSPORT_FAILED', stage: 'fetch', status: null, transportCode: 'ECONNRESET'},
    {response: {ok: true, status: 200, jsonError: new SyntaxError('PRIVATE_RESPONSE_AND_TOKEN')},
      code: 'OPERATOR_D1_INVALID_RESPONSE', stage: 'json', status: 200, transportCode: null}
  ];
  for (const scenario of cases) {
    const diagnostics = [], mock = mockFetch([metadata(), scenario.response]);
    const db = await connectD1({target: 'publication', token: TOKEN, fetchImpl: mock.fetchImpl,
      onDiagnostic(value) {diagnostics.push(value);}});
    await assert.rejects(db.prepare('SELECT 1').all(), error => {
      assert.equal(error.code, scenario.code); assert.equal(error.message, scenario.code);
      assert.equal(error.d1_transport_stage, scenario.stage); assert.equal(error.d1_http_status, scenario.status);
      assert.equal(error.d1_transport_code, scenario.transportCode); assert.equal(error.cause, undefined); return true;
    });
    assert.equal(diagnostics.length, 1); assert.equal(mock.calls.length, 2);
    assert.equal(JSON.stringify(diagnostics).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(diagnostics).includes(TOKEN), false);
  }
});

test('diagnostic allowlists reject arbitrary codes, stages, status strings and truthy payload values', () => {
  const diagnostic = safeOperatorDiagnostic({code: 'SECRET_QUERY_VALUE', message: 'SELECT SECRET_TOKEN', d1_request: 'true',
    upstream_request: 1, d1_http_status: '503', upstream_http_status: 700, d1_transport_stage: 'PRIVATE_SQL',
    d1_transport_code: 'SECRET_TOKEN', d1_operation: 'SELECT_PRIVATE_VALUES', d1_guard_rejected: 'yes'});
  assert.deepEqual(diagnostic, {safe_error_code: 'REFRESH_STATE_RECOVERY_REQUIRED', d1_request: false,
    d1_http_status: null, upstream_request: false, upstream_http_status: null, d1_transport_stage: null,
    d1_transport_code: null, d1_operation: null, d1_guard_rejected: false});
  assert.equal(safeHttpStatus(200), 200); assert.equal(safeHttpStatus(429), 429);
  for (const status of [0, 99, 600, '200', true, NaN, Infinity, {}]) assert.equal(safeHttpStatus(status), null);
  assert.equal(safeOperatorDiagnostic({provider: 'apibara', code: 'AUTH', status: 403}).upstream_http_status, 403);
});

test('automatic refresh opt-in admits exactly the five scheduler tables on publication only', async () => {
  const tables=['automatic_refresh_state','automatic_refresh_budgets','automatic_refresh_attempts','automatic_refresh_tasks','automatic_refresh_guards'];
  const {db:ordinary}=await connect('publication',[]);
  for(const table of tables) assert.throws(()=>ordinary.prepare(`DELETE FROM ${table}`),/OPERATOR_WRITE_NOT_ALLOWED/);
  for(const settings of [{target:'staging',automaticRefresh:true},{target:'publication',automaticRefresh:'true'}]){
    const mock=mockFetch([]);
    await assert.rejects(connectD1({...settings,token:TOKEN,fetchImpl:mock.fetchImpl}),/OPERATOR_AUTOMATIC_REFRESH_TARGET_REQUIRED/);
    assert.equal(mock.calls.length,0);
  }
  for(const readOnly of [false,true]){
    const mock=mockFetch([metadata()]);
    const db=await connectD1({target:'publication',token:TOKEN,fetchImpl:mock.fetchImpl,automaticRefresh:true,readOnly});
    for(const table of tables){
      if(readOnly) assert.throws(()=>db.prepare(`DELETE FROM ${table}`),/OPERATOR_WRITE_NOT_ALLOWED/);
      else assert.doesNotThrow(()=>db.prepare(`DELETE FROM ${table}`));
    }
    for(const table of ['users','user_favorites','import_orders','import_order_messages','import_order_files','automatic_refresh_other'])
      assert.throws(()=>db.prepare(`UPDATE ${table} SET value=?`),/OPERATOR_WRITE_NOT_ALLOWED/);
    assert.throws(()=>db.prepare('CREATE TABLE automatic_refresh_other(value TEXT)'),/OPERATOR_WRITE_NOT_ALLOWED/);
    assert.equal(mock.calls.length,1);
  }
  // Per-connection opt-in must never mutate the ordinary publication allowlist.
  const {db:after}=await connect('publication',[]);
  for(const table of tables) assert.throws(()=>after.prepare(`DELETE FROM ${table}`),/OPERATOR_WRITE_NOT_ALLOWED/);
});

test('automatic scheduler writes still require a write budget before any remote mutation', async () => {
  const mock=mockFetch([metadata()]);
  const db=await connectD1({target:'publication',token:TOKEN,fetchImpl:mock.fetchImpl,automaticRefresh:true});
  const statement=db.prepare('UPDATE automatic_refresh_state SET lease_owner=? WHERE singleton=1').bind('offline-owner');
  await assert.rejects(statement.run(),/D1_WRITE_BUDGET_REQUIRED/);
  await assert.rejects(db.batch([statement]),/D1_WRITE_BUDGET_REQUIRED/);
  assert.equal(mock.calls.length,1);
});

test('automatic refresh atomic lease guard retains valid=1 marker without exposing SQL or parameters', async () => {
  const unsafe='SECRET_TOKEN SELECT PRIVATE_DATA';
  const failures=[
    {ok:false,status:400,payload:{success:false,errors:[{message:'CHECK constraint failed: valid = 1 '+unsafe}]}},
    {ok:true,status:200,payload:{success:true,result:[{success:false,error:'CHECK constraint failed: valid=1 '+unsafe}]}}
  ];
  for(const failed of failures){
    const mock=mockFetch([metadata(),failed]);let reserved=0,completed=0;
    const db=await connectD1({target:'publication',token:TOKEN,fetchImpl:mock.fetchImpl,automaticRefresh:true,
      writeBudget:{async beforeWrite(){reserved++;return {};},complete(){completed++;}}});
    await assert.rejects(db.batch([db.prepare('INSERT INTO automatic_refresh_guards(guard_id,valid) VALUES(?,0)').bind('private-guard')]),error=>{
      assert.equal(error.message,'CHECK constraint failed: valid = 1');
      assert.equal(error.code,'OPERATOR_D1_FAILED');
      assert.equal(error.d1_guard_rejected,true);
      assert.equal(JSON.stringify(error).includes(unsafe),false);
      assert.equal(JSON.stringify(error).includes('private-guard'),false);
      return true;
    });
    assert.equal(reserved,1);assert.equal(completed,0);assert.equal(mock.calls.length,2);
  }
});

test('budgeted automatic refresh batch keeps ordering, parameters and actual row metadata', async () => {
  const results=[{success:true,results:[],meta:{changes:1,rows_written:1,rows_read:1}},
    {success:true,results:[],meta:{changes:1,rows_written:1,rows_read:1}}];
  const mock=mockFetch([metadata(),success(results)]);const calls=[];
  const db=await connectD1({target:'publication',token:TOKEN,fetchImpl:mock.fetchImpl,automaticRefresh:true,
    writeBudget:{async beforeWrite(statements,target){calls.push({statements,target});return {id:'ticket'};},complete(ticket,result){calls.push({ticket,result});}}});
  const statements=[db.prepare('INSERT INTO automatic_refresh_guards(guard_id,valid) VALUES(?,1)').bind('offline-guard'),
    db.prepare('DELETE FROM automatic_refresh_guards WHERE guard_id=?').bind('offline-guard')];
  assert.deepEqual(await db.batch(statements),results);
  assert.equal(calls[0].target,'publication');assert.deepEqual(calls[1],{ticket:{id:'ticket'},result:results});
  assert.deepEqual(JSON.parse(mock.calls[1].options.body).batch,statements.map(item=>({sql:item.sql,params:item.params})));
});


test('bootstrap catalogue writes require exact existing operator mode and never grant private or schema writes',async()=>{
 for(const args of [{target:'staging',bootstrapCatalog:true},{target:'publication',bootstrapCatalog:true},{target:'staging',stagingSnapshot:true,bootstrapCatalog:'true'},{target:'publication',automaticRefresh:true,bootstrapCatalog:true,readOnly:true}]){
  const mock=mockFetch([]);await assert.rejects(connectD1({...args,token:TOKEN,fetchImpl:mock.fetchImpl}),/OPERATOR_BOOTSTRAP_TARGET_REQUIRED/);assert.equal(mock.calls.length,0);
 }
 for(const target of ['staging','publication']){const mock=mockFetch([metadata(target)]),db=await connectD1({target,token:TOKEN,fetchImpl:mock.fetchImpl,bootstrapCatalog:true,...(target==='staging'?{stagingSnapshot:true}:{automaticRefresh:true})});
  for(const table of ['feed_catalog_baselines','feed_catalog_membership','feed_catalog_pointer','server_feed_state'])assert.doesNotThrow(()=>db.prepare('UPDATE '+table+' SET singleton=1'));
  for(const table of ['users','user_favorites','import_orders','import_order_messages','auth_sessions'])assert.throws(()=>db.prepare('DELETE FROM '+table),/OPERATOR_WRITE_NOT_ALLOWED/);
  assert.throws(()=>db.prepare('DROP TABLE feed_catalog_membership'),/OPERATOR_WRITE_NOT_ALLOWED/);
 }
});
