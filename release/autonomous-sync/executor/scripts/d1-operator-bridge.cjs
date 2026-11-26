'use strict';

// Explicit operator connection. It never opens a connection at module load.
const ACCOUNT = '7ff5a57444667c4eda2a6a7f0fc4120d';
const TARGETS = Object.freeze({
  publication: {name: 'rexbid-production-preflight-db', id: 'c8a30088-70af-43a6-9a7f-c4018279d37d'},
  staging: {name: 'rexbid-auth-test-db', id: 'acb3cb8e-69a2-459f-8a46-0f2f5b9004be'}
});
const SYNC_TABLES = new Set(['vehicle_sources','auction_listings','auction_listing_snapshots','auction_events',
  'vehicle_entities','provider_sync_scopes','sync_runs','sync_page_commits','sync_batch_guards',
  'provider_request_budgets','provider_request_reservations']);
const PUBLIC_TABLES = new Set(['vehicle_sources','auction_listings','auction_listing_snapshots','auction_events']);
const AUTOMATIC_REFRESH_TABLES = Object.freeze(['automatic_refresh_state','automatic_refresh_budgets',
  'automatic_refresh_attempts','automatic_refresh_tasks','automatic_refresh_guards']);
// File imports have no provider quota/attempt writes and cannot change clients.
// Keep this opt-in separate from the production scheduler capability.
const STAGING_SNAPSHOT_TABLES = Object.freeze(['sync_batch_guards', 'automatic_refresh_state',
  'automatic_refresh_tasks', 'automatic_refresh_guards']);
const READ_PRAGMAS = /^(?:table_info|index_list|index_info|foreign_key_list|foreign_key_check|integrity_check)$/i;
const SAFE_ERROR_CODES = new Set(['OPERATOR_D1_FAILED','OPERATOR_D1_TIMEOUT','OPERATOR_D1_TRANSPORT_FAILED',
  'OPERATOR_D1_INVALID_RESPONSE','INVALID_OPERATOR_QUERY_RESULT','INVALID_OPERATOR_BATCH_RESULT',
  'ACTUAL_DATABASE_IDENTITY_MISMATCH','REFRESH_STATE_RECOVERY_REQUIRED','REFRESH_FAILED','CAMPAIGN_STOP_LATCH',
  'BUDGET_EXHAUSTED','LEASE_CONFLICT','BUDGET_START_FAILED','BUDGET_RESERVATION_ID_COLLISION',
  'AUTH','RATE_LIMITED','TIMEOUT','UPSTREAM','NOT_FOUND','INVALID_REQUEST','INVALID_RESPONSE','CONFIGURATION',
  'INVALID_PROVIDER_ENVELOPE','INVALID_PROVIDER_LIST_SHAPE','INVALID_PROVIDER_RECORDS','DUPLICATE_PAGE_IDENTITY',
  'PAGINATION_COMPLETENESS_UNKNOWN','REPEATED_CURSOR','CANONICAL_IDENTITY_INVALID','DETAIL_TARGET_MISMATCH',
  'KNOWN_TARGET_CHANGED','AMBIGUOUS_PLATFORM_LOT','PLATFORM_LOT_VIN_MISMATCH','NEGATIVE_PROVIDER_PRICE',
  'SOURCE_VERSION_TIME_INVALID','OBSERVATION_TIME_REQUIRED','OBSERVATION_TIME_INVALID','FUTURE_OBSERVATION_REJECTED',
  'KNOWN_CHECKPOINT_INVALID','STALE_LEASE_OR_RUN','STALE_LEASE_CURSOR_OR_RUN']);
const SAFE_TRANSPORT_CODES = new Set(['ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','ENOTFOUND','EAI_AGAIN',
  'ETIMEDOUT','ERR_NETWORK','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT',
  'UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','UND_ERR_ABORTED']);
const SAFE_STAGES = new Set(['fetch','json','response','result','identity']);
const SAFE_OPERATIONS = new Set(['metadata','query','batch']);
function safeHttpStatus(value) {return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;}
function safeOperatorDiagnostic(error, fallback = 'REFRESH_STATE_RECOVERY_REQUIRED') {
  const candidates = [error?.code, error?.message].filter(value => typeof value === 'string').map(value => value.toUpperCase());
  const d1 = error?.d1_request === true, upstream = error?.upstream_request === true || error?.provider === 'apibara';
  return {safe_error_code: candidates.find(value => SAFE_ERROR_CODES.has(value)) || (SAFE_ERROR_CODES.has(fallback) ? fallback : 'REFRESH_STATE_RECOVERY_REQUIRED'),
    d1_request: d1, d1_http_status: safeHttpStatus(error?.d1_http_status ?? (d1 ? error?.status : null)),
    upstream_request: upstream, upstream_http_status: safeHttpStatus(error?.upstream_http_status ?? (upstream ? error?.status : null)),
    d1_transport_stage: SAFE_STAGES.has(error?.d1_transport_stage) ? error.d1_transport_stage : null,
    d1_transport_code: SAFE_TRANSPORT_CODES.has(error?.d1_transport_code) ? error.d1_transport_code : null,
    d1_operation: SAFE_OPERATIONS.has(error?.d1_operation) ? error.d1_operation : null,
    d1_guard_rejected: error?.d1_guard_rejected === true};
}
function assertStatement(sql, writable) {
  if (typeof sql !== 'string' || !sql.trim() || /;\s*\S/.test(sql)) throw Error('SINGLE_STATEMENT_REQUIRED');
  if (/^\s*SELECT\b/i.test(sql)) return;
  if (/^\s*PRAGMA\b/i.test(sql)) {
    const pragma = sql.match(/^\s*PRAGMA\s+(?:main\.)?([a-z_][a-z0-9_]*)(?:\s*\(\s*(?:[a-z_][a-z0-9_]*|"[^"\r\n]*"|'[^'\r\n]*'|\d+)\s*\))?\s*;?\s*$/i);
    if (!pragma || !READ_PRAGMAS.test(pragma[1]) || sql.includes('=')) throw Error('OPERATOR_PRAGMA_NOT_ALLOWED');
    return;
  }
  const match = sql.match(/^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)\b/i);
  if (!match || !writable.has(match[1].toLowerCase())) throw Error('OPERATOR_WRITE_NOT_ALLOWED');
}
async function connectD1({target, token, fetchImpl = fetch, readOnly = false, historyReceipts = false, automaticRefresh = false, stagingSnapshot = false, bootstrapCatalog = false, onDiagnostic = null, writeBudget = null}) {
  if (!Object.hasOwn(TARGETS, target) || !token) throw Error('OPERATOR_TARGET_REQUIRED');
  if (typeof automaticRefresh !== 'boolean' || automaticRefresh && target !== 'publication') throw Error('OPERATOR_AUTOMATIC_REFRESH_TARGET_REQUIRED');
  if (typeof stagingSnapshot !== 'boolean' || stagingSnapshot && (target !== 'staging' || automaticRefresh || historyReceipts)) throw Error('OPERATOR_STAGING_SNAPSHOT_TARGET_REQUIRED');
  if(typeof bootstrapCatalog!=='boolean'||bootstrapCatalog&&(!automaticRefresh&&!stagingSnapshot||readOnly))throw Error('OPERATOR_BOOTSTRAP_TARGET_REQUIRED');
  const identity = TARGETS[target];
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${identity.id}`;
  function failure(code, {status = null, stage, operation, transportCode = null, guard = false, guardField = 'allowed'} = {}) {
    const error = Error(guard ? `CHECK constraint failed: ${guardField === 'valid' ? 'valid' : 'allowed'} = 1` : code);
    Object.assign(error, {code, status: safeHttpStatus(status), d1_request: true, d1_http_status: safeHttpStatus(status),
      d1_transport_stage: stage, d1_operation: operation, d1_transport_code: SAFE_TRANSPORT_CODES.has(transportCode) ? transportCode : null,
      d1_guard_rejected: guard === true});
    try {if (typeof onDiagnostic === 'function') onDiagnostic(safeOperatorDiagnostic(error));} catch {}
    return error;
  }
  async function api(path, body) {
    const operation = !path ? 'metadata' : body?.batch ? 'batch' : 'query';
    const statements = body ? body.batch || [{sql:body.sql,params:body.params||[]}] : [];
    const writes = statements.some(item => !/^\s*(?:SELECT|PRAGMA)\b/i.test(item.sql));
    if (writes && (!writeBudget || typeof writeBudget.beforeWrite !== 'function' || typeof writeBudget.complete !== 'function')) throw Error('D1_WRITE_BUDGET_REQUIRED');
    // Reservation is durable before sending. An uncertain response leaves it
    // pending and blocks all later writes until operator readback/reconciliation.
    const ticket = writes ? await writeBudget.beforeWrite(statements,target) : null;
    let response;
    try {
      response = await fetchImpl(base + path, {method: body ? 'POST' : 'GET', redirect: 'error',
        headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(60000)});
    } catch (error) {
      const transportCode = SAFE_TRANSPORT_CODES.has(error?.code) ? error.code : SAFE_TRANSPORT_CODES.has(error?.cause?.code) ? error.cause.code : null;
      const timeout = ['TimeoutError','AbortError'].includes(error?.name) || ['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(transportCode);
      throw failure(timeout ? 'OPERATOR_D1_TIMEOUT' : 'OPERATOR_D1_TRANSPORT_FAILED', {stage: 'fetch', operation, transportCode});
    }
    let value;
    try {value = await response.json();}
    catch {throw failure('OPERATOR_D1_INVALID_RESPONSE', {status: response.status, stage: 'json', operation});}
    if (!response.ok || !value || typeof value !== 'object' || value.success !== true
      || Array.isArray(value.result) && value.result.some(item => item?.success === false)) {
      // Preserve only the known CHECK marker needed by atomic budget/lease guards.
      const errors = [...(Array.isArray(value?.errors) ? value.errors : []),
        ...(Array.isArray(value?.result) ? value.result.flatMap(item => [
          ...(Array.isArray(item?.errors) ? item.errors : []), item?.error
        ]) : [])];
      const guardField = errors.map(item => /CHECK constraint failed.*\b(allowed|valid)\s*=\s*1\b/i.exec(
        typeof item === 'string' ? item : item?.message || '')?.[1]?.toLowerCase())
        .find(field => field === 'allowed' || (automaticRefresh || stagingSnapshot) && field === 'valid');
      throw failure('OPERATOR_D1_FAILED', {status: response.status, stage: 'response', operation, guard: Boolean(guardField), guardField});
    }
    if (ticket) writeBudget.complete(ticket,value.result);
    else if (body && writeBudget?.recordRead) writeBudget.recordRead(value.result);
    return {result: value.result, status: safeHttpStatus(response.status)};
  }
  const metadata = await api(''), meta = metadata.result;
  if (meta?.uuid !== identity.id || meta?.name !== identity.name) throw failure('ACTUAL_DATABASE_IDENTITY_MISMATCH', {status: metadata.status, stage: 'identity', operation: 'metadata'});
  const writable = readOnly ? new Set() : new Set(target === 'staging' ? PUBLIC_TABLES : SYNC_TABLES);
  if (automaticRefresh && !readOnly) AUTOMATIC_REFRESH_TABLES.forEach(table => writable.add(table));
  if (stagingSnapshot && !readOnly) STAGING_SNAPSHOT_TABLES.forEach(table => writable.add(table));
  if(bootstrapCatalog)['feed_catalog_baselines','feed_catalog_membership','feed_catalog_pointer','server_feed_state'].forEach(table=>writable.add(table));
  const receiptSql=historyReceipts && target==='staging' && !readOnly
    ? require('./targeted-history-import.cjs').HISTORY_RECEIPT_SQL : null;
  const failureSql=historyReceipts && target==='staging' && !readOnly
    ? require('./targeted-history-import.cjs').HISTORY_FAILURE_SQL : null;
  function assertOperatorStatement(sql,params=[],preparing=false){
    if(failureSql&&sql===failureSql){
      if(!preparing&&(params.length!==9||params[0]!==`history-import:${params[6]}`||params[1]!=='apibara'
        ||!['copart','iaai'].includes(params[2])||params[2]!==params[7]||!/^[A-Z][A-Z0-9_]{1,80}$/.test(params[4])
        ||!/^\d+$/.test(params[8])))throw Error('OPERATOR_WRITE_NOT_ALLOWED');
      return;
    }
    if(receiptSql&&sql===receiptSql){
      if(!preparing&&(params.length!==9||!/^history-import:.+/.test(params[0])||params[1]!=='apibara'
        ||!['copart','iaai'].includes(params[2])||!['complete','partial'].includes(params[3])))throw Error('OPERATOR_WRITE_NOT_ALLOWED');
      return;
    }
    assertStatement(sql,writable);
  }
  function prepare(sql) {
    assertOperatorStatement(sql,[],true);
    const statement = {sql, params: [], bind(...params) {return {...statement, params};},
      async all() {
        assertOperatorStatement(this.sql,this.params);
        const response = await api('/query', {sql: this.sql, params: this.params}), result = response.result;
        if (!Array.isArray(result) || result.length !== 1) throw failure('INVALID_OPERATOR_QUERY_RESULT', {status: response.status, stage: 'result', operation: 'query'});
        return result[0];
      },
      async run() {return this.all();},
      async first(column) {const row = (await this.all()).results?.[0] ?? null; return column && row ? row[column] : row;}
    };
    return statement;
  }
  return {identity: {...identity}, metadataVerified: true, prepare,
    async batch(statements) {
      if (!Array.isArray(statements) || !statements.length || statements.length > 250) throw Error('INVALID_OPERATOR_BATCH');
      for (const item of statements) assertOperatorStatement(item.sql,item.params);
      const response = await api('/query', {batch: statements.map(item => ({sql: item.sql, params: item.params || []}))}), result = response.result;
      if (!Array.isArray(result) || result.length !== statements.length) throw failure('INVALID_OPERATOR_BATCH_RESULT', {status: response.status, stage: 'result', operation: 'batch'});
      return result;
    }};
}
module.exports = {ACCOUNT, TARGETS, assertStatement, safeHttpStatus, safeOperatorDiagnostic, connectD1};
