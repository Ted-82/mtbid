'use strict';

// Private local operator entry point; never imported by a Worker or mounted as a route.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {createHash, randomUUID} = require('node:crypto');
const {connectD1, TARGETS, safeHttpStatus, safeOperatorDiagnostic} = require('./d1-operator-bridge.cjs');
const {createApibaraProvider} = require('../providers/apibara.js');
const {runPublicationRefresh} = require('../sync/publication-refresh.cjs');
const CAMPAIGN = 'publication-20261008';
const APPROVAL = Object.freeze({approved: true, campaignId: CAMPAIGN, totalRequests: 1000,
  platformRequests: {copart: 650, iaai: 650}, maxAttempts: 1});
const FRESHNESS = Object.freeze({hotIntervalMs: 300000, warmIntervalMs: 21600000,
  coldIntervalMs: 604800000, hotWindowMs: 7200000});
const ARTIFACTS = 'C:/Users/nowic/Documents/Codex/REXBID_REFRESH_20261008';
const PRIVATE = ['users','user_favorites','import_orders','import_order_messages','import_order_files','import_order_message_reads'];
function sha(value) {return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function save(name, value) {fs.mkdirSync(ARTIFACTS, {recursive: true}); fs.writeFileSync(path.join(ARTIFACTS, name + '.json'), JSON.stringify(value, null, 2) + '\n');}
function safeResult(result) {return {ok: result.ok, platform: result.platform, mode: result.mode, requests: result.requests,
  retries: result.retries, pages: result.pages, inserted: result.inserted, updated: result.updated, skipped: result.skipped,
  availability: result.availability, stopReason: result.stopReason, scopeKey: result.scopeKey,
  state_recovery_required: result.stateRecoveryRequired === true,
  scope: {status: result.scope?.status, cursor_present: result.scope?.cursor !== null && result.scope?.cursor !== undefined,
    last_success_at: result.scope?.last_success_at, last_complete_at: result.scope?.last_complete_at}, budget: result.budget};}
function cloudflareToken(root) {
  const result = cp.spawnSync(process.execPath, [path.join(root,'.codex-wrangler-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js'),
    'auth','token','--json','--config',path.join(root,'wrangler.production-preflight.jsonc')],
  {cwd: root, encoding: 'utf8', windowsHide: true, env: {...process.env, WRANGLER_LOG_PATH: path.join(ARTIFACTS,'cloudflare-operator.log')}});
  if (result.status !== 0) throw Error('CLOUDFLARE_AUTH_UNAVAILABLE');
  const auth = JSON.parse(result.stdout), token = auth.token ?? auth.api_token ?? auth.oauth_token;
  if (!token) throw Error('CLOUDFLARE_AUTH_UNAVAILABLE');
  const logPath = path.join(ARTIFACTS,'cloudflare-operator.log');
  if (fs.existsSync(logPath)) fs.writeFileSync(logPath,fs.readFileSync(logPath,'utf8').split(token).join('[REDACTED]'));
  return token;
}
async function audit(db) {
  const q = async sql => (await db.prepare(sql).all()).results;
  const platforms = await q("SELECT platform,COUNT(*) AS listings,SUM(media_urls_json IS NOT NULL AND media_urls_json NOT IN ('[]','')) AS with_media,MIN(last_seen_at) AS oldest_seen,MAX(last_seen_at) AS latest_seen FROM auction_listings GROUP BY platform");
  const counts = (await q("SELECT (SELECT COUNT(*) FROM vehicle_sources) AS sources,(SELECT COUNT(*) FROM auction_listings) AS listings,(SELECT COUNT(*) FROM auction_listing_snapshots) AS snapshots,(SELECT COUNT(*) FROM auction_events) AS events,(SELECT COUNT(*) FROM vehicle_entities) AS entities"))[0];
  const duplicates = (await q('SELECT COUNT(*) AS n FROM (SELECT platform,lot FROM auction_listings GROUP BY platform,lot HAVING COUNT(*)>1)'))[0].n;
  const privateState = {};
  for (const table of PRIVATE) {
    const exists = (await q("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name='" + table + "'"))[0].n;
    if (exists) {const rows = await q('SELECT * FROM ' + table + ' ORDER BY rowid'); privateState[table] = {count: rows.length, sha256: sha(rows)};}
  }
  const budgets = await q("SELECT provider,normal_limit,normal_consumed,normal_reserved,retry_consumed FROM provider_request_budgets WHERE provider LIKE 'apibara:publication:" + CAMPAIGN + "%'");
  const scopes = await q("SELECT platform,operation,status,CASE WHEN cursor IS NULL THEN 0 ELSE 1 END AS cursor_present,last_success_at,last_complete_at FROM provider_sync_scopes WHERE scope_key LIKE 'publication:" + CAMPAIGN + "%'");
  const coverage = await q("SELECT platform,auction_state,source_status,fuel_type,COUNT(*) AS n,SUM(buy_now_usd>0) AS priced_buy_now,SUM(is_timed=1) AS timed FROM auction_listings WHERE last_seen_at>='2026-10-08T00:00:00Z' GROUP BY platform,auction_state,source_status,fuel_type");
  const foreign_keys = (await q('PRAGMA foreign_key_check')).length;
  return {at: new Date().toISOString(), database: db.identity, counts, platforms, duplicates, privateState, budgets, scopes, coverage, foreign_key_violations: foreign_keys};
}
async function main(args = process.argv.slice(2)) {
  const [mode, platform, kind = 'open', count = '4'] = args;
  if (!['preflight','gate','discovery','known','audit'].includes(mode)) throw Error('EXPLICIT_OPERATOR_MODE_REQUIRED');
  const root = path.resolve(__dirname,'..'); fs.mkdirSync(ARTIFACTS, {recursive: true});
  const backup = JSON.parse(fs.readFileSync('C:/Users/nowic/Documents/Codex/private-backups/rexbid/refresh-before-20261008/manifest.json','utf8').replace(/^\uFEFF/,''));
  if (!backup.databases.some(item => item.database_id === TARGETS.publication.id && item.roundtrip === true)) throw Error('VERIFIED_PUBLICATION_BACKUP_REQUIRED');
  let lastD1Diagnostic = null, lastUpstreamStatus = null, lastUpstreamRequest = false;
  const token = cloudflareToken(root), db = await connectD1({target: 'publication', token,
    onDiagnostic(diagnostic) {lastD1Diagnostic = diagnostic;}});
  function failureDiagnostic(error) {
    const own = safeOperatorDiagnostic(error);
    const d1 = lastD1Diagnostic ? safeOperatorDiagnostic({code: lastD1Diagnostic.safe_error_code, ...lastD1Diagnostic}) : null;
    return {...own,
      ...(d1 ? {d1_request: d1.d1_request, d1_http_status: d1.d1_http_status,
        d1_transport_stage: d1.d1_transport_stage, d1_transport_code: d1.d1_transport_code,
        d1_operation: d1.d1_operation, d1_guard_rejected: d1.d1_guard_rejected,
        ...(own.safe_error_code === 'REFRESH_STATE_RECOVERY_REQUIRED' ? {safe_error_code: d1.safe_error_code} : {})} : {}),
      upstream_request: lastUpstreamRequest || own.upstream_request,
      upstream_http_status: lastUpstreamStatus ?? own.upstream_http_status};
  }
  const before = await audit(db);
  if (before.duplicates || before.foreign_key_violations || Object.values(before.privateState).some(item => item.count)) throw Error('PUBLICATION_DATA_ISOLATION_FAILED');
  if (fs.existsSync(path.join(ARTIFACTS,'campaign-stop.json')) && !['audit','preflight'].includes(mode)) throw Error('CAMPAIGN_STOP_LATCH');
  if (mode === 'audit' || mode === 'preflight') {
    if (mode === 'preflight') {
      const guardId = 'atomic-proof-' + randomUUID(); let failed = false;
      try {await db.batch([db.prepare('INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,1)').bind(guardId),
        db.prepare('INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,0)').bind(guardId + '-invalid')]);} catch {failed = true;}
      const remains = await db.prepare('SELECT COUNT(*) AS n FROM sync_batch_guards WHERE guard_id IN (?,?)').bind(guardId,guardId+'-invalid').first();
      if (!failed || remains.n !== 0) throw Error('REMOTE_BATCH_ATOMICITY_FAILED');
      save('preflight', {...before, batch_atomicity_verified: true, approval: APPROVAL});
    } else save('audit-latest',before);
    console.log(JSON.stringify(before)); return;
  }
  const preflightPath = path.join(ARTIFACTS,'preflight.json');
  if (!fs.existsSync(preflightPath) || JSON.parse(fs.readFileSync(preflightPath,'utf8')).batch_atomicity_verified !== true) throw Error('ATOMIC_PREFLIGHT_REQUIRED');
  const gatePath = path.join(ARTIFACTS,'gate.json');
  if (mode !== 'gate' && (!fs.existsSync(gatePath) || JSON.parse(fs.readFileSync(gatePath,'utf8')).passed !== true)) throw Error('TWO_PLATFORM_GATE_REQUIRED');
  const localEnv = require('dotenv').parse(fs.readFileSync(path.join(root,'.env')));
  const apiKey = localEnv.APIBARA_API_KEY || localEnv.APIBARA_KEY;
  if (!apiKey) throw Error('PROVIDER_KEY_UNAVAILABLE');
  const receiptPath = path.join(ARTIFACTS,'transport-ledger.ndjson');
  const provider = createApibaraProvider({timeoutMs: 20000, console: {error() {}, warn() {}, info(label,value) {
    const entry = JSON.parse(value); if (entry.upstream_request === true) {
      lastUpstreamRequest = true; lastUpstreamStatus = safeHttpStatus(entry.status);
      fs.appendFileSync(receiptPath, JSON.stringify(entry)+'\n');
    }
  }}});
  const transport = {...provider, async obtain(spec) {
    if (fs.existsSync(path.join(ARTIFACTS,'campaign-stop.json'))) throw Error('CAMPAIGN_STOP_LATCH');
    const payload = await provider.request({APIBARA_API_KEY: apiKey},spec);
    if (!payload || typeof payload !== 'object' || payload.ok === false || payload.success === false || payload.error) throw Error('INVALID_PROVIDER_ENVELOPE');
    return {response: payload, observedAt: new Date().toISOString()};
  }};
  const filters = kind === 'open' ? {lot_sub_status:'Open',upcoming:'all'}
    : kind === 'buy-now' ? {lot_status:'Buy Now',lot_sub_status:'Open',upcoming:'all'}
    : kind === 'timed' ? {lot_status:'Timed',lot_sub_status:'Open',upcoming:'all'}
    : kind === 'electric' ? {fuel_type:'Electric',lot_sub_status:'Open',upcoming:'all'} : null;
  if (!filters) throw Error('UNSUPPORTED_REFRESH_CATEGORY');
  const run = async (ownPlatform, pages, knownTargets = null) => {
    lastD1Diagnostic = null; lastUpstreamStatus = null; lastUpstreamRequest = false;
    let result;
    try {
      result = await runPublicationRefresh({db,target:TARGETS.publication,provider:transport,approval:APPROVAL,
        platform:ownPlatform,mode:knownTargets ? 'known' : 'discovery',targets:knownTargets || [],filters:knownTargets ? {} : filters,maxPages:pages,freshnessPolicy:FRESHNESS});
    } catch (error) {
      save('campaign-stop',{at:new Date().toISOString(),...failureDiagnostic(error),
        state_recovery_required:true,platform:ownPlatform});
      throw Error('REFRESH_STATE_RECOVERY_REQUIRED');
    }
    const safe = safeResult(result);
    if (!result.ok || result.stateRecoveryRequired) safe.diagnostic = failureDiagnostic({code: result.stopReason});
    save('run-' + Date.now() + '-' + ownPlatform,safe); console.log(JSON.stringify(safe));
    if (!result.ok || result.stateRecoveryRequired || ['budget_exhausted','lease_conflict'].includes(result.stopReason)) {
      save('campaign-stop',{at:new Date().toISOString(),...failureDiagnostic({code: result.stopReason}),
        state_recovery_required:result.stateRecoveryRequired === true,platform:ownPlatform}); throw Error('CAMPAIGN_STOPPED');
    }
    return safe;
  };
  if (mode === 'gate') {
    if (fs.existsSync(gatePath)) throw Error('GATE_ALREADY_RECORDED');
    const results = [];
    for (const ownPlatform of ['copart','iaai']) {
      results.push(await run(ownPlatform,1));
      const readback = await audit(db);
      const ownResult = results.at(-1);
      if (readback.duplicates || readback.foreign_key_violations || Object.values(readback.privateState).some(item=>item.count)
        || ownResult.pages !== 1 || ownResult.availability.active < 1) {
        save('campaign-stop',{at:new Date().toISOString(),safe_error_code:'GATE_READBACK_FAILED',platform:ownPlatform});
        throw Error('GATE_READBACK_FAILED');
      }
    }
    save('gate',{at:new Date().toISOString(),passed:true,results,readback:await audit(db)});
  } else {
    if (!['copart','iaai'].includes(platform)) throw Error('PLATFORM_REQUIRED');
    const batches = Number(count);
    if (!Number.isSafeInteger(batches) || batches<1 || batches>25) throw Error('INVALID_BOUNDED_BATCH_COUNT');
    if (mode === 'known') {
      const manifestPath = path.join(ARTIFACTS,'known-' + platform + '-' + kind + '.json');
      const targets = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
      for(let index=0;index<batches;index++) {const result=await run(platform,4,targets); if(result.stopReason==='known_targets_complete') break;}
    } else {
      for(let index=0;index<batches;index++) {const result=await run(platform,4); if(result.stopReason==='scope_complete') break;}
    }
  }
  const after = await audit(db); save('audit-latest',after); console.log(JSON.stringify({final_audit:after}));
}
module.exports = {APPROVAL,CAMPAIGN,ARTIFACTS,PRIVATE,audit,cloudflareToken,main};
if (require.main === module) main().catch(error=>{console.error(/^[A-Z_]{3,80}$/.test(error.message)?error.message:'SAFE_OPERATOR_STOP');process.exitCode=1;});
