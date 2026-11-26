'use strict';

// Paused-campaign variant, 2026-10-25. Portable repository implementation.
// Import and offline plan do not load the operator session or usage helpers.
// Operator library; no credentials or private rows are stored in this module. Importing and `plan` are offline. No credentials
// are loaded here. The operator supplies an exact-target connection and budget.
// `attest --target staging|publication --after-manifest ... --preservation ...
// --paused-closeout ...` consumes ONLY the final verified backup's raw SQL
// bytes on stdin and prints hashes, never private rows. Use BaseStream.Write.
// Apply API order:
// 1. attestAfterBackup / CLI attest; keep after SQL in RAM only.
// 2. openWriteBudget({...,estimate:createIndexEstimator(proof)}).
// 3. connectIndexes({target,token,writeBudget}); reconnect before four minutes.
// 4. applyIndexes({...evidence,target,db,proof,journalDirectory,assertExclusive}).
// assertExclusive must return checkExclusive({publicationDb,campaignDirectory,
// attempts:cronPause.attempts}). publicationDb can wrap the existing read bridge.
// Both targets must share journalDirectory. Publication requires stage success.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {DatabaseSync,constants} = require('node:sqlite');
const OPERATOR_BASE = path.resolve(process.env.REXBID_OPERATOR_DIRECTORY || path.join(require('node:os').homedir(),'Documents','Codex'));
const MAX_SQL_BYTES = 512*1024*1024;
const SHA256 = /^[a-f0-9]{64}$/;
const ROOT = path.resolve(__dirname,'..');
const PROPOSAL = ROOT + '/docs/proposals/0009_public_catalog_read_indexes.sql';
const ACCOUNT = '7ff5a57444667c4eda2a6a7f0fc4120d';
const TARGETS = Object.freeze({
  staging:Object.freeze({id:'acb3cb8e-69a2-459f-8a46-0f2f5b9004be',name:'rexbid-auth-test-db'}),
  publication:Object.freeze({id:'c8a30088-70af-43a6-9a7f-c4018279d37d',name:'rexbid-production-preflight-db'})
});
const INDEXES = Object.freeze([
  ['idx_listings_public_recent','auction_listings','last_seen_at DESC, listing_id ASC',''],
  ['idx_listings_public_platform_recent','auction_listings','platform, last_seen_at DESC, listing_id ASC',''],
  ['idx_listings_public_timed_recent','auction_listings','last_seen_at DESC, listing_id ASC','is_timed = 1'],
  ['idx_listings_public_platform_timed_recent','auction_listings','platform, last_seen_at DESC, listing_id ASC','is_timed = 1'],
  ['idx_listings_public_buy_now_recent','auction_listings','last_seen_at DESC, listing_id ASC','buy_now_usd > 0'],
  ['idx_listings_public_make_recent','auction_listings','upper(trim(make)), last_seen_at DESC, listing_id ASC',''],
  ['idx_scopes_public_coverage','provider_sync_scopes','operation, platform, provider','']
].map(([name,table,columns,where])=>Object.freeze({name,table,partial:Boolean(where),
  sql:`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})${where?' WHERE '+where:''}`,
  drop:`DROP INDEX IF EXISTS ${name}`})));
const ORIGINAL_DIRECTORY = path.join(OPERATOR_BASE,'REXBID_IMPROVEMENT_20261020');
const RELIABILITY_DIRECTORY = path.join(OPERATOR_BASE,'REXBID_RELIABILITY_20261025');
const PRIVATE = Object.freeze(['users','user_favorites','import_orders','import_order_events',
  'import_order_messages','import_order_files','portal_customer_profiles','import_order_message_reads']);
const PUBLIC = Object.freeze(['vehicle_sources','auction_listings','auction_listing_snapshots','auction_events','provider_sync_scopes']);
const TABLES = Object.freeze([...PUBLIC,...PRIVATE]);
const SHA = /^[a-f0-9]{64}$/;
const PAGE = 250;
const PAUSE_SQL = "SELECT blocked_reason,lease_owner,(SELECT COUNT(*) FROM automatic_refresh_attempts) attempts FROM automatic_refresh_state WHERE singleton=1";
const INDEX_SQL = `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN (${INDEXES.map(i=>"'"+i.name+"'").join(',')}) ORDER BY name`;
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const fail = code => {throw Error(code);};
const normalized = sql => sql.trim().replace(/;$/,'').replace(/\bIF NOT EXISTS\s+/gi,'').replace(/\s+/g,' ').toLowerCase();
const canonical = value => ArrayBuffer.isView(value) ? Array.from(value) : Array.isArray(value)
  ? value.map(canonical) : value && typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const fingerprintHash = value => jsonHash(canonical(value));
const validTime = value => typeof value==='string' && Number.isFinite(Date.parse(value));
// Portable backup verification. SQL is restored only into read-only in-memory SQLite.
function manifestRecord(manifest, target, phase) {
  const expected = TARGETS[target];
  if (!expected || !['before','after'].includes(phase)
    || manifest?.mode !== `publication_and_staging_${phase}_improvement`
    || !Number.isFinite(Date.parse(manifest.created_at))
    || manifest.provider_requests !== 0 || !Array.isArray(manifest.databases)
    || manifest.databases.length !== 2) throw Error('PRESERVATION_MANIFEST_INVALID');
  for (const approved of Object.values(TARGETS)) {
    const matches = manifest.databases.filter(record => record.database_id === approved.id);
    if (matches.length !== 1 || matches[0].database !== approved.name
      || matches[0].roundtrip !== true
      || !SHA256.test(matches[0].plaintext_sha256 || '')
      || !SHA256.test(matches[0].ciphertext_sha256 || '')
      || !Number.isSafeInteger(matches[0].bytes) || matches[0].bytes < 1
      || matches[0].bytes > MAX_SQL_BYTES) throw Error('PRESERVATION_MANIFEST_INVALID');
  }
  return manifest.databases.find(record => record.database_id === expected.id);
}

function restoreInMemory(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_SQL_BYTES) throw Error('PRESERVATION_SQL_INPUT_INVALID');
  let sql;
  try { sql = new TextDecoder('utf-8', {fatal:true}).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { throw Error('PRESERVATION_SQL_ENCODING_INVALID'); }
  if (!sql.trim()) throw Error('PRESERVATION_SQL_INPUT_INVALID');
  const db = new DatabaseSync(':memory:', {enableForeignKeyConstraints:false, allowExtension:false});
  let blocked = false, readOnly = false;
  try {
    if (typeof db.setAuthorizer !== 'function') throw Error('PRESERVATION_AUTHORIZER_UNAVAILABLE');
    db.exec('PRAGMA temp_store=MEMORY');
    db.setAuthorizer((action, first, second) => {
      const pragma = String(first || '').toLowerCase();
      const prohibited = action === constants.SQLITE_ATTACH || action === constants.SQLITE_DETACH
        || action === constants.SQLITE_FUNCTION
          && [first,second].some(value => String(value || '').toLowerCase() === 'load_extension')
        || action === constants.SQLITE_PRAGMA
          && (['temp_store_directory','data_store_directory','writable_schema'].includes(pragma)
            || pragma === 'temp_store' && second !== null && !['2','memory'].includes(String(second).toLowerCase())
            || readOnly && second !== null
              && !['table_info','table_xinfo','foreign_key_list','index_list','index_info','index_xinfo'].includes(pragma));
      if (prohibited) { blocked = true; return constants.SQLITE_DENY; }
      return constants.SQLITE_OK;
    });
    db.exec(sql); sql = '';
    db.exec('PRAGMA query_only=ON');
    readOnly = true;
    return db;
  } catch (error) {
    db.close();
    throw Error(error.message === 'PRESERVATION_AUTHORIZER_UNAVAILABLE' ? error.message
      : blocked ? 'PRESERVATION_UNSAFE_SQL_BLOCKED' : 'PRESERVATION_SQL_RESTORE_FAILED');
  }
}

function identity(target,value) {
  if (!Object.hasOwn(TARGETS,target) || value?.id!==TARGETS[target].id || value?.name!==TARGETS[target].name) fail('INDEX_TARGET_MISMATCH');
}
function exactKeys(value,keys) {
  return value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
}
function statementsFromProposal(source=fs.readFileSync(PROPOSAL,'utf8')) {
  const statements=source.replace(/--[^\r\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
  if (statements.length!==7 || statements.some((sql,index)=>normalized(sql)!==normalized(INDEXES[index].sql))) fail('INDEX_PROPOSAL_CHANGED');
  return INDEXES.map(index=>index.sql);
}
const PROPOSAL_HASH = jsonHash(INDEXES.map(index=>index.sql));
function createIndexEstimator(proof) {
  identity(proof?.target,proof?.identity);
  if (proof.passed!==true || proof.proposal_sha256!==PROPOSAL_HASH
    || !Number.isSafeInteger(proof.fingerprints?.tables?.auction_listings?.count)
    || !Number.isSafeInteger(proof.fingerprints?.tables?.provider_sync_scopes?.count)) fail('INDEX_BACKUP_ATTESTATION_REQUIRED');
  const counts=Object.freeze(Object.fromEntries(['auction_listings','provider_sync_scopes'].map(table=>[table,proof.fingerprints.tables[table].count])));
  const target=proof.target;
  return (statements,actualTarget) => {
    if (actualTarget!==target || !Array.isArray(statements) || statements.length!==1
      || !Array.isArray(statements[0].params||[]) || (statements[0].params||[]).length) fail('INDEX_ESTIMATE_STATEMENT_INVALID');
    const index=INDEXES.find(item=>item.sql===statements[0].sql);
    if (!index) fail('INDEX_ESTIMATE_STATEMENT_INVALID');
    const count=counts[index.table];
    // Whole table, including nonmatching rows for a partial index. Keep the
    // existing 5000-operation cap; never split or understate one index build.
    if (!Number.isSafeInteger(count) || count<0 || count>=5000 || count+64>5000) fail('INDEX_BUILD_ROW_LIMIT');
    return {writes:count+64,reads:count*3+128};
  };
}
function readSql(table,kind) {
  if (!TABLES.includes(table)) fail('INDEX_TABLE_NOT_ALLOWED');
  if (kind==='schema') return `PRAGMA table_info(${table})`;
  if (kind==='count') return `SELECT COUNT(*) n FROM ${table}`;
  if (kind==='first') return `SELECT rowid AS __rx_index_rowid,* FROM ${table} ORDER BY rowid LIMIT ${PAGE}`;
  if (kind==='next') return `SELECT rowid AS __rx_index_rowid,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT ${PAGE}`;
  fail('INDEX_READ_NOT_ALLOWED');
}
async function buildProbes() {
  const {D1ReadRepository}=require(ROOT+'/sync/d1-read-repository.js');
  const now='2026-10-20T16:00:00.000Z',observedAfter='2026-10-19T16:00:00.000Z';
  const options=[['all',{},INDEXES[0].name],['platform',{platform:'copart'},INDEXES[1].name],
    ['timed',{category:'timed'},INDEXES[2].name],['timed_platform',{category:'timed',platform:'iaai'},INDEXES[3].name],
    ['buy_now',{category:'buy-now'},INDEXES[4].name],['make',{make:'Honda'},INDEXES[5].name]];
  const probes=[];
  for (const [name,optionsForQuery,expectedIndex] of options) {
    const captured=[];
    const db={prepare(sql) {
      const statement={sql,params:[],bind(...params){return {...statement,params};},
        async all(){captured.push({sql:this.sql,params:this.params});return {results:[]};},async first(){return null;}};
      return statement;
    }};
    await new D1ReadRepository(db,{now:()=>Date.parse(now)}).listCatalog({...optionsForQuery,observedAfter,nowIso:now});
    const query=captured.find(item=>item.sql.includes('SELECT l.*'));
    if (!query || !/^\s*SELECT\b/.test(query.sql) || query.sql.includes(';')) fail('INDEX_PROBE_INVALID');
    probes.push({name,sql:'EXPLAIN QUERY PLAN '+query.sql,params:query.params,expectedIndex});
  }
  probes.push({name:'coverage',sql:"EXPLAIN QUERY PLAN SELECT provider,platform,status,cursor,last_complete_at FROM provider_sync_scopes WHERE operation='discovery' ORDER BY platform,provider",params:[],expectedIndex:INDEXES[6].name});
  return probes;
}
// A paused campaign is deliberately NOT declared complete. Bind the original
// stopped transport to its one separately verified cached replay and readback.
function validatePausedCloseout(value) {
  if (value?.format!=='rexbid-paused-campaign-closeout-v1' || value.passed!==true
    || value.campaignComplete!==false || !validTime(value.at)
    || value.automatic_attempts!==3254 || value.manual_attempts!==2262 || value.combined_attempts!==7293
    || value.pending_before!==1 || value.pending_after!==0 || value.provider_requests!==0
    || !exactKeys(value.files,['ledger','stop','recovery','readback'])) fail('INDEX_PAUSED_CLOSEOUT_REQUIRED');
  const bound={};
  for (const name of ['ledger','stop','recovery','readback']) {
    const file=value.files[name],expected=value[name+'_sha256'];
    if (!path.isAbsolute(file||'') || !SHA.test(expected||'')) fail('INDEX_PAUSED_BINDING_INVALID');
    let bytes;
    try {
      const stat=fs.statSync(file);
      if (!stat.isFile() || stat.size<1 || stat.size>16*1024*1024) fail('INDEX_PAUSED_BINDING_INVALID');
      bytes=fs.readFileSync(file);
      if (hash(bytes)!==expected) fail('INDEX_PAUSED_BINDING_CHANGED');
      bound[name]=name==='ledger' ? bytes.toString('utf8').trim().split(/\r?\n/).map(row=>JSON.parse(row))
        : JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    } catch(error) {
      if (/^INDEX_/.test(error.message)) throw error;
      fail('INDEX_PAUSED_BINDING_INVALID');
    }
  }
  const {stop,recovery,readback,ledger}=bound;
  const attempts=ledger.filter(row=>row.kind==='attempt'),lastAttempt=attempts.at(-1);
  const response=ledger.filter(row=>row.kind==='response' && row.number===2262).at(-1);
  if (attempts.length!==2262 || attempts.some((row,i)=>row.number!==i+1)
    || lastAttempt?.combined!==7293 || !validTime(lastAttempt?.at)
    || response?.ok!==true || response.status!==200 || !SHA.test(response.sha256||'')
    || !validTime(response.at) || Date.parse(response.at)<Date.parse(lastAttempt.at)
    || stop.code!=='IMPROVEMENT_WRITE_FAILED' || stop.attempts!==2262
    || stop.targetId!==TARGETS.publication.id || !validTime(stop.at)
    || Date.parse(stop.at)<Date.parse(response.at)
    || recovery.passed!==true || recovery.result?.status!=='committed'
    || recovery.result.cachedResponse!==2262 || recovery.result.providerRequests!==0 || recovery.apibaraRequests!==0
    || recovery.response_sha256!==response.sha256 || !SHA.test(recovery.backup_sha256||'')
    || !validTime(recovery.at) || Date.parse(recovery.at)<Date.parse(stop.at)
    || readback.passed!==true || readback.provider_requests!==0
    || !validTime(readback.at) || Date.parse(readback.at)<Date.parse(recovery.at)
    || Date.parse(value.at)<Date.parse(readback.at)
    || readback.state?.blocked_reason!=='OPERATOR_STOP' || readback.state.lease_owner
    || readback.state.lease_until || readback.state.attempts!==3254
    || readback.listing?.listing_id!==recovery.result.listingId
    || readback.listing?.vin_normalized!==recovery.result.vin
    || readback.listing?.detail_synced_at!==recovery.result.observedAt
    || readback.receipt?.status!=='complete' || readback.receipt.last_complete_at!==recovery.result.observedAt) {
    fail('INDEX_PAUSED_RECOVERY_INVALID');
  }
  return {passed:true,campaignComplete:false,provider_requests:0};
}
function checkLocalLocks(directory,{originalDirectory=ORIGINAL_DIRECTORY}={}) {
  if (!path.isAbsolute(directory||'') || !path.isAbsolute(originalDirectory||'')) fail('INDEX_CAMPAIGN_DIRECTORY_REQUIRED');
  const forbidden=[path.join(originalDirectory,'campaign/improvement.lock'),
    path.join(originalDirectory,'transfer-operator.lock'),path.join(originalDirectory,'index-run.lock'),
    path.join(directory,'campaign/improvement.lock'),path.join(directory,'transfer-operator.lock'),
    path.join(directory,'recovery.lock'),path.join(directory,'cached-replay.lock')];
  if (forbidden.some(file=>fs.existsSync(file))) fail('INDEX_CAMPAIGN_RUNNING');
  // index-run.lock is owned by the current single-flight wrapper, and the
  // inner index journal lock is held by applyIndexes. Other new writers stop us.
  if (fs.existsSync(directory) && fs.readdirSync(directory).some(name=>name.endsWith('.lock') && name!=='index-run.lock')) fail('INDEX_CAMPAIGN_RUNNING');
  return true;
}
function validateEvidence({target,afterManifest,preservation,pausedCloseout}) {
  identity(target,TARGETS[target]);
  validatePausedCloseout(pausedCloseout);
  const record=manifestRecord(afterManifest,target,'after');
  if (preservation?.passed!==true || preservation.mode!=='offline_before_after_backup_preservation'
    || !validTime(preservation.at) || Date.parse(preservation.at)<Date.parse(afterManifest.created_at)
    || Date.parse(afterManifest.created_at)<Date.parse(pausedCloseout.at)) fail('INDEX_FINAL_BACKUP_AND_PRESERVATION_REQUIRED');
  for (const name of Object.keys(TARGETS)) {
    const report=preservation.targets?.[name],backup=manifestRecord(afterManifest,name,'after');
    identity(name,report?.database);
    if (report.passed!==true || report.after_created_at!==afterManifest.created_at
      || report.plaintext_hashes?.verified!==true || report.plaintext_hashes.after!==backup.plaintext_sha256
      || report.ciphertext_hashes?.verified!==true || report.ciphertext_hashes.after!==backup.ciphertext_sha256
      || report.health?.after?.integrity!==true || report.health.after.foreign_key_violations!==0
      || report.preservation?.passed!==true || !exactKeys(report.protected_tables,PRIVATE)
      || PRIVATE.some(table=>report.protected_tables[table].matches!==true
        || !SHA.test(report.protected_tables[table].after_sha256||''))) fail('INDEX_PRESERVATION_PROOF_INVALID');
  }
  return {record,evidence_sha256:fingerprintHash({afterManifest,preservation,pausedCloseout})};
}
async function rows(db,sql,params=[]) {
  const result=await db.query(sql,params);
  if (!Array.isArray(result)) fail('INDEX_READ_RESULT_INVALID');
  return result;
}
async function captureFingerprints(db) {
  const tables={};
  for (const table of TABLES) {
    const schema=await rows(db,readSql(table,'schema'));
    if (!schema.length || schema.some(column=>column.name==='__rx_index_rowid')) fail('INDEX_SCHEMA_INVALID');
    const count=(await rows(db,readSql(table,'count')))[0]?.n;
    if (!Number.isSafeInteger(count) || count<0) fail('INDEX_COUNT_INVALID');
    const digest=createHash('sha256');
    let seen=0,last;
    for (;;) {
      const page=await rows(db,readSql(table,last===undefined?'first':'next'),last===undefined?[]:[last]);
      if (page.length>PAGE) fail('INDEX_PAGE_INVALID');
      if (!page.length) break;
      for (const raw of page) {
        const {__rx_index_rowid:rowid,...row}=raw;
        if (!Number.isSafeInteger(rowid) || last!==undefined && rowid<=last) fail('INDEX_ROWID_INVALID');
        digest.update(JSON.stringify(canonical(row))+'\n');
        last=rowid;seen++;
      }
      if (seen>count) fail('INDEX_DATA_CHANGED_DURING_CAPTURE');
      if (page.length<PAGE) break;
    }
    if (seen!==count || (await rows(db,readSql(table,'count')))[0]?.n!==count) fail('INDEX_DATA_CHANGED_DURING_CAPTURE');
    tables[table]={count,sha256:digest.digest('hex'),schema_sha256:fingerprintHash(schema)};
  }
  if ((await rows(db,'PRAGMA foreign_key_check')).length) fail('INDEX_FOREIGN_KEY_FAILURE');
  return {tables,sha256:fingerprintHash(tables)};
}
async function attestAfterBackup({target,bytes,afterManifest,preservation,pausedCloseout}) {
  const evidence=validateEvidence({target,afterManifest,preservation,pausedCloseout});
  if (!Buffer.isBuffer(bytes) || bytes.length!==evidence.record.bytes || hash(bytes)!==evidence.record.plaintext_sha256) fail('INDEX_BACKUP_BYTES_MISMATCH');
  const sqlite=restoreInMemory(bytes);
  try {
    const adapter={query:async(sql,params=[])=>sqlite.prepare(sql).all(...params)};
    const integrity=sqlite.prepare('PRAGMA integrity_check').all();
    if (integrity.length!==1 || integrity[0].integrity_check!=='ok') fail('INDEX_BACKUP_INTEGRITY_FAILURE');
    const fingerprints=await captureFingerprints(adapter);
    for (const table of PRIVATE) {
      const actual=sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      const expected=preservation.targets[target].protected_tables[table];
      if (actual.length!==expected.after_count || jsonHash(actual)!==expected.after_sha256) fail('INDEX_BACKUP_PRIVATE_MISMATCH');
    }
    return {format:'rexbid-index-after-backup-v1',target,identity:TARGETS[target],at:new Date().toISOString(),
      proposal_sha256:PROPOSAL_HASH,evidence_sha256:evidence.evidence_sha256,
      backup_plaintext_sha256:evidence.record.plaintext_sha256,fingerprints,passed:true,private_rows_saved:false};
  } finally {sqlite.close();}
}
function validateProof(proof,evidence) {
  const verified=validateEvidence(evidence);
  if (proof?.format!=='rexbid-index-after-backup-v1' || proof.passed!==true || proof.target!==evidence.target
    || proof.proposal_sha256!==PROPOSAL_HASH || proof.evidence_sha256!==verified.evidence_sha256
    || proof.backup_plaintext_sha256!==verified.record.plaintext_sha256 || proof.private_rows_saved!==false
    || !exactKeys(proof.fingerprints?.tables,TABLES)
    || TABLES.some(table=>!Number.isSafeInteger(proof.fingerprints.tables[table].count)
      || proof.fingerprints.tables[table].count<0 || !SHA.test(proof.fingerprints.tables[table].sha256||'')
      || !SHA.test(proof.fingerprints.tables[table].schema_sha256||''))
    || proof.fingerprints.sha256!==fingerprintHash(proof.fingerprints.tables)) fail('INDEX_BACKUP_ATTESTATION_REQUIRED');
  identity(evidence.target,proof.identity);
}
function equalData(actual,expected) {
  if (actual.sha256!==expected.sha256 || fingerprintHash(actual.tables)!==fingerprintHash(expected.tables)) fail('INDEX_TABLE_PRESERVATION_FAILED');
}
async function readIndexes(db,required=false) {
  const found=await rows(db,INDEX_SQL);
  const byName=new Map(found.map(row=>[row.name,row]));
  if (byName.size!==found.length || required && found.length!==7) fail('INDEX_READBACK_MISSING');
  for (const row of found) {
    const expected=INDEXES.find(item=>item.name===row.name);
    if (!expected || row.type!=='index' || row.tbl_name!==expected.table
      || typeof row.sql!=='string' || normalized(row.sql)!==normalized(expected.sql)) fail('INDEX_EXISTING_DEFINITION_CONFLICT');
  }
  for (const table of ['auction_listings','provider_sync_scopes']) {
    const list=await rows(db,`PRAGMA index_list(${table})`);
    for (const index of INDEXES.filter(item=>item.table===table && byName.has(item.name))) {
      const actual=list.find(row=>row.name===index.name);
      if (!actual || actual.unique!==0 || actual.origin!=='c' || actual.partial!==Number(index.partial)) fail('INDEX_READBACK_ATTRIBUTES_INVALID');
    }
  }
  return found;
}
async function explain(db,probes) {
  const result={};
  for (const probe of probes) {
    const plan=await rows(db,probe.sql,probe.params);
    if (!plan.length || plan.some(row=>typeof row.detail!=='string')) fail('INDEX_EXPLAIN_INVALID');
    result[probe.name]={query_sha256:jsonHash({sql:probe.sql,params:probe.params}),plan:plan.map(row=>row.detail),
      expected_index:probe.expectedIndex,expected_index_used:plan.some(row=>row.detail.includes(probe.expectedIndex))};
  }
  return result;
}
function saveAtomic(file,value) {
  const temporary=file+'.next';
  let fd;
  try {fd=fs.openSync(temporary,'wx');fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}
  finally {if (fd!==undefined) fs.closeSync(fd);}
  fs.renameSync(temporary,file);
}
function readJson(file) {return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function journalFile(directory,target) {
  if (!path.isAbsolute(directory||'')) fail('INDEX_JOURNAL_DIRECTORY_REQUIRED');
  identity(target,TARGETS[target]);
  return path.join(directory,'indexes-'+target+'.json');
}
function validComplete(report,target,evidenceHash) {
  if (report?.format!=='rexbid-index-apply-v1' || report.target!==target || report.proposal_sha256!==PROPOSAL_HASH
    || report.evidence_sha256!==evidenceHash || report.passed!==true || report.phase!=='complete'
    || report.pending || report.before?.sha256!==report.after?.sha256 || !SHA.test(report.before?.sha256||'')
    || !Array.isArray(report.indexes) || report.indexes.length!==7 || !exactKeys(report.explain_after,['all','platform','timed','timed_platform','buy_now','make','coverage'])
    || Object.values(report.explain_after).some(item=>!Array.isArray(item.plan)||!item.plan.length)) fail('INDEX_STAGING_SUCCESS_REQUIRED');
  identity(target,report.identity);
}
async function checkExclusive({publicationDb,campaignDirectory,attempts,originalDirectory=ORIGINAL_DIRECTORY,evidenceDirectory=RELIABILITY_DIRECTORY}) {
  identity('publication',publicationDb?.identity);
  if (!path.isAbsolute(campaignDirectory||'') || fs.existsSync(path.join(campaignDirectory,'improvement.lock'))
    || !Number.isSafeInteger(attempts) || attempts<0) fail('INDEX_CAMPAIGN_RUNNING');
  if (path.resolve(campaignDirectory)!==path.resolve(originalDirectory,'campaign')) fail('INDEX_CAMPAIGN_DIRECTORY_REQUIRED');
  checkLocalLocks(evidenceDirectory,{originalDirectory});
  const state=await rows(publicationDb,PAUSE_SQL);
  if (state.length!==1 || state[0].blocked_reason!=='OPERATOR_STOP' || state[0].lease_owner
    || state[0].attempts!==attempts) fail('INDEX_EXCLUSIVE_WRITER_REQUIRED');
  return true;
}
async function applyIndexes({target,db,proof,afterManifest,preservation,pausedCloseout,journalDirectory,assertExclusive}) {
  identity(target,db?.identity);
  if (typeof db.executeIndex!=='function' || typeof assertExclusive!=='function') fail('INDEX_OPERATOR_CALLBACK_REQUIRED');
  statementsFromProposal();
  const evidence={target,afterManifest,preservation,pausedCloseout};
  validateProof(proof,evidence);
  const estimate=createIndexEstimator(proof);
  const file=journalFile(journalDirectory,target),probes=await buildProbes();
  fs.mkdirSync(journalDirectory,{recursive:true});
  const lock=path.join(journalDirectory,'indexes.lock');
  let descriptor;
  try {descriptor=fs.openSync(lock,'wx');} catch {fail('INDEX_OPERATOR_LOCKED');}
  try {
    if (target==='publication') validComplete(readJson(journalFile(journalDirectory,'staging')),'staging',proof.evidence_sha256);
    if (await assertExclusive()!==true) fail('INDEX_EXCLUSIVE_WRITER_REQUIRED');
    const before=await captureFingerprints(db);
    equalData(before,proof.fingerprints);
    const existing=await readIndexes(db);
    let report=fs.existsSync(file)?readJson(file):null;
    if (report) {
      if (report.target!==target || report.proposal_sha256!==PROPOSAL_HASH || report.evidence_sha256!==proof.evidence_sha256
        || report.before?.sha256!==before.sha256) fail('INDEX_JOURNAL_MISMATCH');
      if (report.pending) fail('INDEX_PENDING_RECONCILIATION_REQUIRED');
      if (report.phase==='complete') {
        validComplete(report,target,proof.evidence_sha256);await readIndexes(db,true);
        return report;
      }
      if (report.phase!=='applying' || !Array.isArray(report.applied)) fail('INDEX_JOURNAL_INVALID');
    } else {
      report={format:'rexbid-index-apply-v1',target,identity:TARGETS[target],proposal_sha256:PROPOSAL_HASH,
        evidence_sha256:proof.evidence_sha256,at:new Date().toISOString(),phase:'applying',passed:false,
        before,existing_names:existing.map(row=>row.name),applied:[],pending:null,
        explain_before:await explain(db,probes),private_rows_saved:false};
      saveAtomic(file,report);
    }
    for (const index of INDEXES) {
      const actual=await readIndexes(db);
      if (actual.some(row=>row.name===index.name)) continue;
      if (await assertExclusive()!==true) fail('INDEX_EXCLUSIVE_WRITER_REQUIRED');
      try {estimate([{sql:index.sql,params:[]}],target);}
      catch (error) {
        if (error.message==='INDEX_BUILD_ROW_LIMIT') {
          report.stopped_reason=error.message;report.stopped_before=index.name;
          report.indexes=actual;report.completed_indexes=actual.length;
          report.after=await captureFingerprints(db);equalData(report.after,report.before);
          saveAtomic(file,report);
        }
        throw error;
      }
      report.pending=index.name;saveAtomic(file,report); // durable before sending
      await db.executeIndex(index.name);
      const readback=await readIndexes(db);
      if (!readback.some(row=>row.name===index.name)) fail('INDEX_READBACK_MISSING');
      report.applied.push(index.name);report.pending=null;saveAtomic(file,report);
    }
    if (await assertExclusive()!==true) fail('INDEX_EXCLUSIVE_WRITER_REQUIRED');
    report.indexes=await readIndexes(db,true);
    report.explain_after=await explain(db,probes);
    report.after=await captureFingerprints(db);
    equalData(report.after,report.before);
    if (await assertExclusive()!==true) fail('INDEX_EXCLUSIVE_WRITER_REQUIRED');
    report.phase='complete';report.passed=true;report.completed_indexes=7;report.completed_at=new Date().toISOString();
    saveAtomic(file,report);
    return report;
  } finally {fs.closeSync(descriptor);fs.unlinkSync(lock);}
}
// Read-only reconciliation. The operator must separately reconcile any budget
// ticket; this function never declares unobserved D1 billing metadata complete.
async function reconcilePending({target,db,proof,afterManifest,preservation,pausedCloseout,journalDirectory,assertExclusive}) {
  identity(target,db?.identity);validateProof(proof,{target,afterManifest,preservation,pausedCloseout});
  const file=journalFile(journalDirectory,target),lock=path.join(journalDirectory,'indexes.lock');
  let descriptor;
  try {descriptor=fs.openSync(lock,'wx');} catch {fail('INDEX_OPERATOR_LOCKED');}
  try {
    const report=readJson(file);
    if (report.target!==target || report.phase!=='applying' || !INDEXES.some(item=>item.name===report.pending)
      || report.proposal_sha256!==PROPOSAL_HASH || report.evidence_sha256!==proof.evidence_sha256) fail('INDEX_JOURNAL_INVALID');
    if (typeof assertExclusive!=='function' || await assertExclusive()!==true) fail('INDEX_EXCLUSIVE_WRITER_REQUIRED');
    equalData(await captureFingerprints(db),proof.fingerprints);
    const present=(await readIndexes(db)).some(row=>row.name===report.pending),name=report.pending;
    if (await assertExclusive()!==true) fail('INDEX_EXCLUSIVE_WRITER_REQUIRED');
    report.reconciliations ||= [];
    report.reconciliations.push({name,present,at:new Date().toISOString(),budget_reconciliation_still_required:true});
    if (present && !report.applied.includes(name)) report.applied.push(name);
    report.pending=null;saveAtomic(file,report);
    return {name,present,writes:0,budget_reconciliation_still_required:true};
  } finally {fs.closeSync(descriptor);fs.unlinkSync(lock);}
}
function rollbackPlan(report) {
  identity(report?.target,report?.identity);
  if (report.proposal_sha256!==PROPOSAL_HASH || !Array.isArray(report.existing_names)
    || !Array.isArray(report.applied) || report.pending) fail('INDEX_ROLLBACK_REPORT_INVALID');
  const removable=INDEXES.filter(index=>report.applied.includes(index.name) && !report.existing_names.includes(index.name));
  if (report.applied.some(name=>!INDEXES.some(index=>index.name===name))) fail('INDEX_ROLLBACK_REPORT_INVALID');
  return {target:report.target,identity:report.identity,automatic_execution:false,
    statements:removable.slice().reverse().map(index=>index.drop),
    note:'Operator only: verify exact definitions and unchanged tables, keep writers stopped, drop only names created by this journal, then repeat table hashes and EXPLAIN. Preexisting indexes are excluded. No table or data rollback.'};
}
async function connectIndexes({target,token,writeBudget,fetchImpl=globalThis.fetch}) {
  identity(target,TARGETS[target]);
  if (typeof token!=='string' || !token || typeof fetchImpl!=='function') fail('INDEX_CONNECTION_REQUIRED');
  if (!writeBudget || ['beforeWrite','complete','recordRead'].some(method=>typeof writeBudget[method]!=='function')) fail('INDEX_WRITE_BUDGET_REQUIRED');
  const probes=await buildProbes(),reads=new Set([INDEX_SQL,PAUSE_SQL,'PRAGMA foreign_key_check',
    'PRAGMA index_list(auction_listings)','PRAGMA index_list(provider_sync_scopes)',
    ...TABLES.flatMap(table=>['schema','count','first','next'].map(kind=>readSql(table,kind))),
    ...probes.map(probe=>probe.sql)]);
  const base=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${TARGETS[target].id}`;
  async function api(body) {
    let response,value;
    try {
      response=await fetchImpl(base+(body?'/query':''),{method:body?'POST':'GET',redirect:'error',
        headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
      value=await response.json();
    } catch {fail('INDEX_TRANSPORT_UNCERTAIN');}
    if (!response.ok || value?.success!==true) fail('INDEX_D1_REQUEST_FAILED');
    return value.result;
  }
  const metadata=await api();
  if (metadata?.uuid!==TARGETS[target].id || metadata.name!==TARGETS[target].name) fail('INDEX_LIVE_IDENTITY_MISMATCH');
  const connectedAt=Date.now();
  function fresh() {if (Date.now()-connectedAt>=240000) fail('INDEX_CONNECTION_REFRESH_REQUIRED');}
  async function execute(sql,params,write) {
    fresh();
    const statements=[{sql,params}],ticket=write?await writeBudget.beforeWrite(statements,target):null;
    const result=await api({sql,params});
    if (!Array.isArray(result) || result.length!==1 || result[0]?.success===false
      || !Array.isArray(result[0]?.results)) fail('INDEX_D1_RESULT_INVALID');
    if (ticket) await writeBudget.complete(ticket,result);else await writeBudget.recordRead(result);
    return result[0].results;
  }
  return {identity:TARGETS[target],
    async query(sql,params=[]) {
      if (!reads.has(sql) || !Array.isArray(params)) fail('INDEX_READ_NOT_ALLOWED');
      const probe=probes.find(item=>item.sql===sql);
      if (probe ? JSON.stringify(params)!==JSON.stringify(probe.params)
        : sql.includes('rowid>?') ? params.length!==1 || !Number.isSafeInteger(params[0]) : params.length!==0) fail('INDEX_READ_PARAMETERS_INVALID');
      return execute(sql,params,false);
    },
    async executeIndex(name) {
      const index=INDEXES.find(item=>item.name===name);
      if (!index) fail('INDEX_WRITE_NOT_ALLOWED');
      return execute(index.sql,[],true);
    }};
}
async function main(argv=process.argv.slice(2),input=process.stdin) {
  if (argv.length===1 && argv[0]==='plan') {
    statementsFromProposal();
    return {offline:true,proposal_sha256:PROPOSAL_HASH,targets:TARGETS,
      statements:INDEXES.map(item=>item.sql),required_order:['staging','publication'],
      apply_api:'applyIndexes({target,db,proof,afterManifest,preservation,pausedCloseout,journalDirectory,assertExclusive})'};
  }
  if (argv[0]!=='attest' || argv.length!==9) fail('INDEX_LIBRARY_USE_EXPLICIT_TARGET_API');
  const args={},allowed=['--target','--after-manifest','--preservation','--paused-closeout'];
  for (let index=1;index<argv.length;index+=2) {
    if (!allowed.includes(argv[index]) || !argv[index+1] || args[argv[index]]) fail('INDEX_ATTEST_ARGUMENTS_INVALID');
    args[argv[index]]=argv[index+1];
  }
  if (Object.keys(args).length!==4) fail('INDEX_ATTEST_ARGUMENTS_INVALID');
  const evidence={target:args['--target'],afterManifest:readJson(args['--after-manifest']),
    preservation:readJson(args['--preservation']),pausedCloseout:readJson(args['--paused-closeout'])};
  const {record}=validateEvidence(evidence),chunks=[];
  let bytes,size=0;
  try {
    for await (const chunk of input) {
      if (!Buffer.isBuffer(chunk)) fail('INDEX_RAW_BACKUP_BYTES_REQUIRED');
      chunks.push(chunk);size+=chunk.length;
      if (size>record.bytes) fail('INDEX_BACKUP_BYTES_MISMATCH');
    }
    bytes=Buffer.concat(chunks);
    return await attestAfterBackup({...evidence,bytes});
  } finally {chunks.forEach(chunk=>chunk.fill(0));bytes?.fill(0);}
}
module.exports={ROOT,OPERATOR_BASE,manifestRecord,restoreInMemory,ORIGINAL_DIRECTORY,RELIABILITY_DIRECTORY,validatePausedCloseout,checkLocalLocks,TARGETS,INDEXES,PUBLIC,PRIVATE,TABLES,PROPOSAL_HASH,PAUSE_SQL,INDEX_SQL,
  statementsFromProposal,createIndexEstimator,buildProbes,validateEvidence,captureFingerprints,attestAfterBackup,validateProof,
  readIndexes,explain,checkExclusive,applyIndexes,reconcilePending,rollbackPlan,connectIndexes,main};
if (require.main===module) {
  main().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{
    process.stderr.write(/^INDEX_[A-Z_]+$/.test(error.message)?error.message+'\n':'INDEX_OPERATOR_FAILED\n');process.exitCode=1;
  });
}
