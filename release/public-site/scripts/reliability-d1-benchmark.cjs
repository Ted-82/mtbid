'use strict';

// Read-only operator benchmark. Import and --plan are offline. Runtime loads the
// existing RAM session lazily, only after local campaign/cron/exclusivity gates.
// No private tables, provider calls, schema changes, retries or row payloads.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const indexes = require('./reliability-indexes.cjs');
const ROOT = path.resolve(__dirname,'..');
const OPERATOR_BASE = indexes.OPERATOR_BASE;
const DIRECTORY = path.join(OPERATOR_BASE,'REXBID_RELIABILITY_20261025');
const TARGETS = indexes.TARGETS;
const ATTEMPTS = 3254;
const REPEATS = 3;
const MAX_QUERIES = 27; // 21 measured SELECTs, 4 pause checks, 2 index snapshots.
const MAX_ROWS_READ = 1000000;
const PAUSE_SQL = indexes.PAUSE_SQL;
const INDEX_SQL = indexes.INDEX_SQL;
const fail = code => {throw Error(code);};
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => sha(JSON.stringify(canonical(value)));
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const safeCode = error => /^(?:BENCHMARK|INDEX)_[A-Z_]+$/.test(error?.message || '') ? error.message : 'BENCHMARK_FAILED';
function parseArgs(argv) {
  const plan = argv[0] === '--plan';
  const args = plan ? argv.slice(1) : argv;
  if (args.length !== 4 || args[0] !== '--phase' || !['before','after'].includes(args[1])
    || args[2] !== '--target' || !Object.hasOwn(TARGETS,args[3])) fail('BENCHMARK_ARGUMENTS_INVALID');
  return {plan, phase:args[1], target:args[3]};
}
async function buildQueries(asOf) {
  if (!validTime(asOf)) fail('BENCHMARK_CLOCK_INVALID');
  const {D1ReadRepository} = require(ROOT + '/sync/d1-read-repository.js');
  const {queryOptions} = require(ROOT + '/staging/d1-primary-reads.cjs');
  const observedAfter = new Date(Date.parse(asOf) - 86400000).toISOString();
  const specifications = [
    ['all',''], ['platform','platform=copart'], ['timed','category=timed'],
    ['timed_platform','category=timed&platform=iaai'],
    ['buy_now','category=buy-now'], ['make','make=Honda']
  ];
  const queries = [];
  let coverage;
  for (const [name,search] of specifications) {
    const options = queryOptions(new URL('https://rexbid.pl/api/cars?per_page=20&'+search),Date.parse(asOf));
    // The saved-read route limits observation age only for category aisles.
    if (options.category) options.observedAfter = observedAfter;
    const captured = [];
    const db = {prepare(sql) {
      const statement = {params:[],bind(...params) {return {...statement,params};},
        async all() {captured.push({sql,params:this.params});return {results:[]};}};
      return statement;
    }};
    await new D1ReadRepository(db,{now:()=>Date.parse(asOf),cacheCoverage:true}).listCatalog(options);
    const query = captured.find(item => item.sql.startsWith('SELECT l.*'));
    if (!query) fail('BENCHMARK_REPOSITORY_QUERY_MISSING');
    queries.push({name,...query});
    if (name === 'all') coverage = captured.find(item => item.sql.includes('FROM provider_sync_scopes'));
  }
  if (!coverage) fail('BENCHMARK_REPOSITORY_QUERY_MISSING');
  queries.push({name:'coverage',...coverage});
  for (const query of queries) {
    if (!/^\s*SELECT\b/.test(query.sql) || query.sql.includes(';')
      || !/\bFROM (auction_listings|provider_sync_scopes)\b/.test(query.sql)
      || /\b(users|import_orders|portal_customer_profiles|user_favorites)\b/i.test(query.sql)) {
      fail('BENCHMARK_PUBLIC_SELECT_REQUIRED');
    }
  }
  return queries;
}
function metrics(value, wallMs) {
  const meta = value?.meta;
  if (!Array.isArray(value?.results) || value.success === false
    || !Number.isSafeInteger(meta?.rows_read) || meta.rows_read < 0
    || meta.rows_written !== 0 || meta.changed_db === true
    || !Number.isFinite(meta.duration) || meta.duration < 0) fail('BENCHMARK_D1_METRICS_REQUIRED');
  const sqlMs = meta.timings?.sql_duration_ms;
  if (sqlMs !== undefined && (!Number.isFinite(sqlMs) || sqlMs < 0)) fail('BENCHMARK_D1_METRICS_REQUIRED');
  return {rows_read:meta.rows_read, rows_written:0, d1_duration_ms:meta.duration,
    ...(sqlMs === undefined ? {} : {sql_duration_ms:sqlMs}),wall_ms:Number(wallMs.toFixed(3))};
}
function createReadConnections({target,queries,token,connectD1,now=Date.now,clock=()=>performance.now()}) {
  if (!Object.hasOwn(TARGETS,target) || typeof token !== 'function' || typeof connectD1 !== 'function'
    || queries.length !== 7) fail('BENCHMARK_CONNECTION_CONFIGURATION');
  const allowed = new Set([...queries,{sql:INDEX_SQL,params:[]}].map(q => digest({sql:q.sql,params:q.params})));
  const cache = new Map();
  let calls = 0,rowsRead = 0;
  async function connection(name) {
    let item = cache.get(name);
    if (!item || now() - item.at >= 210000) {
      const db = await connectD1({target:name,token:token(),readOnly:true});
      if (db.identity?.id !== TARGETS[name].id || db.identity?.name !== TARGETS[name].name
        || db.metadataVerified !== true) fail('BENCHMARK_TARGET_MISMATCH');
      item = {at:now(),db}; cache.set(name,item);
    }
    return item.db;
  }
  async function execute(name,sql,params) {
    if (++calls > MAX_QUERIES || rowsRead >= MAX_ROWS_READ) fail('BENCHMARK_READ_LIMIT');
    const db = await connection(name),started = clock();
    const value = await db.prepare(sql).bind(...params).all();
    const measured = metrics(value,clock()-started);
    rowsRead += measured.rows_read;
    if (rowsRead > MAX_ROWS_READ) fail('BENCHMARK_READ_LIMIT');
    return {rows:value.results,metrics:measured};
  }
  return {
    async query(sql,params=[]) {
      if (!allowed.has(digest({sql,params}))) fail('BENCHMARK_QUERY_NOT_ALLOWED');
      return execute(target,sql,params);
    },
    async pause() {
      const value = await execute('publication',PAUSE_SQL,[]);
      const rows = value.rows;
      if (rows.length !== 1 || rows[0].blocked_reason !== 'OPERATOR_STOP'
        || rows[0].lease_owner || rows[0].attempts !== ATTEMPTS) fail('BENCHMARK_EXCLUSIVE_STATE_REQUIRED');
      return value.metrics;
    },
    counters() {return {queries:calls,rows_read:rowsRead,rows_written:0};}
  };
}
function readJson(file) {
  const bytes = fs.readFileSync(file);
  return {value:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),sha256:sha(bytes)};
}
function atomicJson(file,value) {
  const temp = file + '.next';
  let fd;
  try {fd=fs.openSync(temp,'wx');fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}
  finally {if(fd!==undefined)fs.closeSync(fd);}
  fs.renameSync(temp,file);
}
function localEvidence(directory,now=Date.now(),originalDirectory=indexes.ORIGINAL_DIRECTORY) {
  const closeout=readJson(path.join(directory,'paused-campaign-closeout.json'));
  const pause=readJson(path.join(originalDirectory,'cron-pause.json'));
  indexes.validatePausedCloseout(closeout.value);
  indexes.checkLocalLocks(directory,{originalDirectory});
  if (Date.parse(closeout.value.at)>now+5000 || pause.value.attempts!==ATTEMPTS
    || pause.value.after?.blocked_reason!=='OPERATOR_STOP' || pause.value.after.lease_owner
    || pause.value.after.lease_until) fail('BENCHMARK_EXCLUSIVE_STATE_REQUIRED');
  return {paused_closeout_sha256:closeout.sha256,cron_pause_sha256:pause.sha256};
}
function summarize(samples,queries,before) {
  const summaries = queries.map(query => {
    const runs = samples.filter(sample => sample.query === query.name);
    if (runs.length !== REPEATS) fail('BENCHMARK_INCOMPLETE_SAMPLES');
    const stable = runs.every(item => item.ordered_rows_sha256 === runs[0].ordered_rows_sha256
      && item.row_count === runs[0].row_count);
    const baseline = before?.summaries?.find(item => item.query === query.name);
    if (before && !baseline) fail('BENCHMARK_BASELINE_INVALID');
    const median = key => [...runs].map(run => run.metrics[key]).sort((a,b)=>a-b)[1];
    const compared = !before ? null : stable && baseline.stable
      && baseline.ordered_rows_sha256 === runs[0].ordered_rows_sha256
      && baseline.row_count === runs[0].row_count;
    return {query:query.name,stable,row_count:runs[0].row_count,
      ordered_rows_sha256:runs[0].ordered_rows_sha256,
      rows_read_median:median('rows_read'),d1_duration_ms_median:median('d1_duration_ms'),
      wall_ms_median:median('wall_ms'),ordered_rows_match_before:compared,
      ...(before ? {rows_read_delta:median('rows_read')-baseline.rows_read_median,
        d1_duration_ms_delta:median('d1_duration_ms')-baseline.d1_duration_ms_median} : {})};
  });
  return {passed:summaries.every(item=>item.stable && item.ordered_rows_match_before !== false),summaries};
}
function validateIndexes(rows,phase) {
  if (!Array.isArray(rows)) fail('BENCHMARK_INDEX_DEFINITIONS_INVALID');
  if (phase === 'before' && rows.length) fail('BENCHMARK_BEFORE_INDEXES_ALREADY_PRESENT');
  if (phase === 'after' && rows.length !== 7) fail('BENCHMARK_AFTER_INDEXES_MISSING');
  const normalized = sql => typeof sql === 'string'
    ? sql.trim().replace(/;$/,'').replace(/\bIF NOT EXISTS\s+/gi,'').replace(/\s+/g,' ').toLowerCase() : null;
  if (new Set(rows.map(row=>row.name)).size !== rows.length || rows.some(row => {
    const expected=indexes.INDEXES.find(index=>index.name===row.name);
    return !expected || row.type!=='index' || row.tbl_name!==expected.table
      || normalized(row.sql)!==normalized(expected.sql);
  })) fail('BENCHMARK_INDEX_DEFINITIONS_INVALID');
}
function runtime() {
  const session = require(path.join(OPERATOR_BASE,'rexbid-catalog-session.cjs'));
  return {token:()=>session.token(),connectD1:require(ROOT+'/scripts/d1-operator-bridge.cjs').connectD1};
}
function createRunner({directory=DIRECTORY,originalDirectory=indexes.ORIGINAL_DIRECTORY,loadRuntime=runtime,now=Date.now}={}) {
  if (!path.isAbsolute(directory) || !path.isAbsolute(originalDirectory)) fail('BENCHMARK_DIRECTORY_INVALID');
  return {async run(argv) {
    const args = parseArgs(argv);
    const stem = path.join(directory,'d1-benchmark-'+args.target+'-'+args.phase);
    const baselineFile = path.join(directory,'d1-benchmark-'+args.target+'-before.json');
    const baseline = args.phase === 'after' && !args.plan ? readJson(baselineFile) : null;
    const asOf = baseline ? baseline.value.as_of : new Date(now()).toISOString();
    const queries = await buildQueries(asOf),queryHash=digest(queries);
    if (args.plan) return {offline:true,...args,identity:TARGETS[args.target],queries,repeats:REPEATS,
      limits:{queries:MAX_QUERIES,rows_read:MAX_ROWS_READ},report:stem+'.json',
      notes:['Frozen before timestamp and exact SQL/parameters reused after indexes.',
        'Median of three runs; D1 duration and HTTP wall time are reported separately.',
        'Coverage order ties are compared exactly; any changed order fails parity.']};
    if (fs.existsSync(stem+'.json') || fs.existsSync(stem+'.progress.json')) fail('BENCHMARK_REPORT_ALREADY_EXISTS');
    const bindings = localEvidence(directory,now(),originalDirectory);
    if (baseline && (baseline.value.format !== 'rexbid-d1-benchmark-v1' || baseline.value.passed !== true
      || baseline.value.phase !== 'before' || baseline.value.target !== args.target
      || digest(baseline.value.identity) !== digest(TARGETS[args.target])
      || baseline.value.query_sha256 !== queryHash || digest(baseline.value.queries) !== queryHash
      || digest(baseline.value.bindings) !== digest(bindings))) fail('BENCHMARK_BASELINE_INVALID');
    const lock = path.join(directory,'index-run.lock');
    let fd;
    try {fd=fs.openSync(lock,'wx');} catch {fail('BENCHMARK_OPERATOR_LOCKED');}
    const report = {format:'rexbid-d1-benchmark-v1',phase:args.phase,target:args.target,
      identity:TARGETS[args.target],at:new Date(now()).toISOString(),as_of:asOf,bindings,
      query_sha256:queryHash,queries,repeats:REPEATS,samples:[],guards:[],
      ...(baseline?{before_report_sha256:baseline.sha256}:{}),
      private_rows_saved:false,row_payloads_saved:false,provider_requests:0,passed:false};
    let connections;
    const save = () => {
      if (connections) report.counters=connections.counters();
      atomicJson(stem+'.progress.json',report);
    };
    try {
      // Only now, after exact arguments and every local gate, may token load.
      const services=loadRuntime();
      connections=createReadConnections({target:args.target,queries,...services,now});
      const guard=async()=>{
        if (digest(localEvidence(directory,now(),originalDirectory))!==digest(bindings)) fail('BENCHMARK_EVIDENCE_CHANGED');
        report.guards.push(await connections.pause());save();
      };
      await guard();
      report.indexes_before=(await connections.query(INDEX_SQL)).rows;
      validateIndexes(report.indexes_before,args.phase);
      for (let round=0;round<REPEATS;round++) {
        if (round) await guard();
        for (const query of queries) {
          const result=await connections.query(query.sql,query.params);
          report.samples.push({query:query.name,round:round+1,row_count:result.rows.length,
            ordered_rows_sha256:digest(result.rows),metrics:result.metrics});
          save();
        }
      }
      report.indexes_after=(await connections.query(INDEX_SQL)).rows;
      if (digest(report.indexes_after)!==digest(report.indexes_before)) fail('BENCHMARK_INDEXES_CHANGED_DURING_RUN');
      await guard();
      Object.assign(report,summarize(report.samples,queries,baseline?.value));
      report.finished_at=new Date(now()).toISOString();
      save();
      atomicJson(stem+'.json',report);
      return {passed:report.passed,phase:args.phase,target:args.target,file:stem+'.json',
        summaries:report.summaries,counters:report.counters,provider_requests:0,row_payloads_saved:false};
    } catch(error) {
      report.code=safeCode(error);save();throw error;
    } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
  }};
}
module.exports={OPERATOR_BASE,ROOT,DIRECTORY,TARGETS,ATTEMPTS,REPEATS,MAX_QUERIES,MAX_ROWS_READ,PAUSE_SQL,INDEX_SQL,safeCode,
  parseArgs,buildQueries,metrics,createReadConnections,localEvidence,summarize,validateIndexes,createRunner,digest};
if(require.main===module) createRunner().run(process.argv.slice(2))
  .then(result=>{process.stdout.write(JSON.stringify(result)+'\n');if(!result.passed&&!result.offline)process.exitCode=1;})
  .catch(error=>{process.stdout.write(JSON.stringify({passed:false,code:safeCode(error)})+'\n');process.exitCode=1;});
