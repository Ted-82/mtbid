'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {buildPublicCatalogMerge,PUBLIC_COLUMNS}=require('../scripts/public-catalog-merge.cjs');
const {TARGETS,connectD1}=require('../scripts/d1-operator-bridge.cjs');
const {HISTORY_RECEIPT_SQL,HISTORY_FAILURE_SQL}=require('../scripts/targeted-history-import.cjs');
const {
  prepareStagingPublicTransfer,rehearseStagingPublicTransfer,applyStagingPublicTransfer,
  buildEventReconciliation,verifyEventPreservation
}=require('../scripts/staging-public-catalog-transfer.cjs');

const OLD='2026-10-03T10:00:00.000Z',NEW='2026-10-20T11:00:00.000Z';
const LATER='2026-10-20T11:30:00.000Z',CAPTURED='2026-10-20T12:00:00.000Z';
const VIN='5YJ3E1EA0LF000001';
const schema=fs.readFileSync(path.join(__dirname,'../docs/proposals/0004_d1_sync_2.sql'),'utf8')+`
CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,mfa TEXT);
CREATE TABLE user_favorites(id INTEGER PRIMARY KEY,listing_id TEXT);
CREATE TABLE import_order_messages(id TEXT PRIMARY KEY,body TEXT,read_at TEXT);`;
const tableNames=Object.keys(PUBLIC_COLUMNS);
const empty=()=>Object.fromEntries(tableNames.map(table=>[table,[]]));
function fixture(platform='copart',lot='12345678',when=NEW){
  const source_key='source:'+platform+':'+lot,listing_id='listing:'+platform+':'+lot;
  return {
    vehicle_sources:[{source_key,provider:'apibara',platform,provider_vehicle_id:'vehicle:'+lot,
      identity_kind:'provider_vehicle_id',identity_state:'resolved',entity_id:null,
      source_updated_at:when,first_seen_at:OLD,last_seen_at:when,last_attempt_at:when,
      last_success_at:when,last_error_code:null,normalizer_version:1,created_at:OLD,updated_at:when}],
    auction_listings:[{listing_id,source_key,platform,listing_identity_kind:'source_listing_id',
      identity_state:'resolved',source_listing_id:lot,listing_generation:null,vin_normalized:VIN,lot,
      vehicle_title:'Tesla Model 3',make:'Tesla',model:'Model 3',year:2020,auction_state:'open',
      source_status:'Open',auction_at:'2026-10-21T11:00:00.000Z',is_timed:0,timed_end_at:null,
      current_bid_usd:5000,current_bid2_usd:null,buy_now_usd:8000,final_price_usd:null,
      source_price_usd:null,price_currency:'USD',media_urls_json:'["https://media.example/car.jpg"]',
      media_thumbs_json:null,source_updated_at:when,first_seen_at:OLD,last_seen_at:when,
      summary_synced_at:when,detail_synced_at:OLD,freshness_class:'warm',normalizer_version:1,
      created_at:OLD,updated_at:when}],
    auction_listing_snapshots:[{snapshot_id:5,listing_id,observed_at:when,auction_state:'open',
      auction_at:'2026-10-21T11:00:00.000Z',timed_end_at:null,current_bid_usd:5000,
      buy_now_usd:8000,fingerprint:'price-'+when,normalizer_version:1}],
    auction_events:[{event_id:'event:'+platform+':'+lot,listing_id,source_key,provider:'apibara',
      platform,event_key:'event-key:'+platform+':'+lot,vin_normalized:VIN,lot,
      auction_date:'2026-10-01',sale_date:'2026-10-01',source_status:'not_sold',
      canonical_status:'not_sold',current_bid_usd:4100,buy_now_usd:null,source_price_usd:4100,
      final_price_usd:null,observed_at:OLD,identity_state:'resolved',created_at:OLD,updated_at:OLD}]
  };
}
function combine(...inputs){
  const tables=Object.fromEntries(tableNames.map(table=>[table,inputs.flatMap(input=>input[table])]));
  tables.auction_listing_snapshots.forEach((row,index)=>row.snapshot_id=index+5);
  return tables;
}
function insertRows(sql,tables){
  for(const table of ['vehicle_sources','auction_listings','auction_listing_snapshots','auction_events']){
    for(const row of tables[table]){
      const keys=Object.keys(row);
      sql.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`)
        .run(...keys.map(key=>row[key]));
    }
  }
}
function database(t,tables=empty()){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(schema);
  insertRows(sql,tables);t.after(()=>sql.close());return sql;
}
function capture(sql,target){
  return {target,identity:{...TARGETS[target]},at:CAPTURED,
    fk:sql.prepare('PRAGMA foreign_key_check').all(),
    tables:Object.fromEntries(tableNames.map(table=>[table,sql.prepare(`SELECT * FROM ${table}`).all()])),
    columns:Object.fromEntries(tableNames.map(table=>[table,sql.prepare(`PRAGMA table_info(${table})`).all()])),
    receipts:sql.prepare("SELECT * FROM provider_sync_scopes WHERE operation='history_refresh' AND scope_key LIKE 'history-import:%'").all(),
    health:sql.prepare('SELECT source_key,provider,platform,last_attempt_at,last_success_at,last_error_code,sync_status,updated_at FROM vehicle_sources').all()};
}
function addReceipt(sql,{status='complete',at=NEW,success=at,complete=status==='complete'?success:null,cursor=null,platform='copart',lot='12345678'}={}){
  sql.prepare(`INSERT INTO provider_sync_scopes
    (scope_key,provider,platform,operation,status,cursor,last_attempt_at,last_success_at,last_complete_at,last_error_code,updated_at)
    VALUES(?,'apibara',?,'history_refresh',?,?,?,?,?,?,?)`)
    .run('history-import:listing:'+platform+':'+lot,platform,status,cursor,at,success,complete,
      status==='failed'?'PRIOR_HISTORY_FAILURE':null,at);
}
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replace(/'/g,"''")+"'";
function baseline(sql){
  const names=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  return names.flatMap(({name})=>sql.prepare(`SELECT * FROM "${name}"`).all().map(row=>{
    const keys=Object.keys(row);
    return `INSERT INTO "${name}" (${keys.map(key=>'"'+key+'"').join(',')}) VALUES (${keys.map(key=>literal(row[key])).join(',')});`;
  })).join('\n');
}
function adapter(sql){
  const state={writeBatches:0,afterCommit:null,beforeBatch:null};
  const execute=item=>{
    const statement=sql.prepare(item.sql);
    if(/^\s*(SELECT|PRAGMA|WITH)\b/i.test(item.sql))return {success:true,results:statement.all(...item.params),meta:{rows_read:0,rows_written:0}};
    const result=statement.run(...item.params);
    return {success:true,results:[],meta:{changes:Number(result.changes),rows_read:0,rows_written:Number(result.changes)}};
  };
  const db={identity:{...TARGETS.staging},metadataVerified:true,
    prepare(query){
      return {sql:query,params:[],bind(...params){return {...this,params};},
        async all(){return execute(this);},async first(column){const row=(await this.all()).results[0]||null;return column&&row?row[column]:row;},
        async run(){return execute(this);}};
    },
    async batch(statements){
      if(state.beforeBatch)await state.beforeBatch(statements);
      const writes=statements.some(item=>!/^\s*(SELECT|PRAGMA|WITH)\b/i.test(item.sql));
      if(writes)state.writeBatches++;
      sql.exec('BEGIN');let results;
      try{results=statements.map(execute);sql.exec('COMMIT');}catch(error){sql.exec('ROLLBACK');throw error;}
      if(writes&&state.afterCommit)await state.afterCommit();
      return results;
    }};
  return {db,state};
}
function directory(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rexbid-staging-transfer-'));
  t.after(()=>{
    const resolved=path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(resolved,{recursive:true,force:true});
  });return dir;
}
function prepared(source,target,options){
  return prepareStagingPublicTransfer(capture(source,'publication'),capture(target,'staging'),options);
}
function rehearse(plan,target){
  return rehearseStagingPublicTransfer({plan,schemaSql:schema,baselineSql:baseline(target)});
}
async function applied(t,source,target,options){
  const plan=prepared(source,target,options),rehearsal=await rehearse(plan,target),connection=adapter(target);
  const args={db:connection.db,plan,rehearsal,directory:directory(t),beforeWrite:async()=>{}};
  await applyStagingPublicTransfer(args);
  return {plan,rehearsal,...connection,args};
}
function privateRows(sql){
  return ['users','user_favorites','import_order_messages','provider_request_budgets','sync_runs']
    .map(table=>[table,sql.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]);
}
function seedPrivate(sql){
  sql.exec(`INSERT INTO users VALUES('account','private@example.test','private-mfa');
    INSERT INTO user_favorites VALUES(1,'listing:copart:12345678');
    INSERT INTO import_order_messages VALUES('message','private message',NULL);
    INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,updated_at)
      VALUES('unrelated-discovery','apibara','copart','discovery','partial','staging-only-cursor','${OLD}');
    INSERT INTO provider_request_budgets(provider,budget_day,normal_limit,normal_consumed,retry_limit,updated_at)
      VALUES('apibara','preserved',1000,211,0,'${OLD}');`);
}

test('only verified publication to staging captures can produce a plan',t=>{
  const source=database(t,fixture()),target=database(t);
  for(const change of [
    (a,b)=>a.identity.id=TARGETS.staging.id,
    (a,b)=>b.identity.id=TARGETS.publication.id,
    (a,b)=>a.target='staging',
    (a,b)=>b.target='publication',
    (a,b)=>b.identity.name='wrong-name',
    (a,b)=>a.fk=[{table:'auction_events',rowid:1,parent:'auction_listings',fkid:0}]
  ]){
    const a=capture(source,'publication'),b=capture(target,'staging');change(a,b);
    assert.throws(()=>prepareStagingPublicTransfer(a,b));
  }
  const plan=prepared(source,target);
  assert.ok(plan.groups.length>0);assert.match(plan.manifest.plan_sha256,/^[a-f0-9]{64}$/);
});

test('public plan is deterministic, binds data and excludes accounts and operational columns',t=>{
  const tables=fixture();tables.auction_listings[0].vehicle_title="Tesla'); DROP TABLE users; --";
  const source=database(t,tables),target=database(t);seedPrivate(source);
  source.exec("UPDATE vehicle_sources SET lease_owner='source-private-lease',failure_count=72");
  const first=prepared(source,target),second=prepared(source,target);
  assert.deepEqual(first,second);
  const statements=first.groups.flatMap(group=>group.statements);
  for(const item of statements){
    assert.equal((item.sql.match(/\?/g)||[]).length,item.params.length);
    assert.doesNotMatch(item.sql,/DROP TABLE|private@example|private-mfa|source-private-lease/);
  }
  assert.doesNotMatch(JSON.stringify(statements),/private@example|private-mfa|private message|source-private-lease/);
});

test('zero and explicit null prices transfer with original receipt timestamps',async t=>{
  const tables=fixture();Object.assign(tables.auction_listings[0],{current_bid_usd:0,current_bid2_usd:null,buy_now_usd:null});
  Object.assign(tables.auction_listing_snapshots[0],{current_bid_usd:0,buy_now_usd:null});
  const source=database(t,tables),target=database(t,fixture('copart','12345678',OLD));
  await applied(t,source,target);
  const row=target.prepare('SELECT * FROM auction_listings').get();
  assert.equal(row.current_bid_usd,0);assert.equal(row.current_bid2_usd,null);assert.equal(row.buy_now_usd,null);
  assert.equal(row.summary_synced_at,NEW);assert.equal(row.detail_synced_at,OLD);assert.equal(row.first_seen_at,OLD);
});

test('newer staging detail and source clocks retain current listing while historical snapshots append',async t=>{
  const source=database(t,fixture()),target=database(t,fixture('copart','12345678',OLD));
  target.prepare('UPDATE auction_listings SET detail_synced_at=?,current_bid_usd=?,vehicle_title=?')
    .run(LATER,9700,'newer staging detail');
  const before=target.prepare('SELECT * FROM auction_listings').get();
  await applied(t,source,target);
  assert.deepEqual(target.prepare('SELECT * FROM auction_listings').get(),before);
  assert.equal(target.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,2);
});

test('snapshot primary key collision preserves both observations and repeated apply writes nothing',async t=>{
  const source=database(t,fixture()),target=database(t,fixture('copart','12345678',OLD));
  const {args,state}=await applied(t,source,target),count=state.writeBatches;
  await applyStagingPublicTransfer(args);
  assert.equal(state.writeBatches,count);
  const rows=target.prepare('SELECT snapshot_id,observed_at FROM auction_listing_snapshots ORDER BY observed_at').all();
  assert.equal(rows.length,2);assert.notEqual(rows[0].snapshot_id,rows[1].snapshot_id);
  assert.equal(rows[0].observed_at,OLD);assert.equal(rows[1].observed_at,NEW);
});

test('history and complete receipt transfer through exact bridge SQL with no source cursor',async t=>{
  const source=database(t,fixture()),target=database(t);
  addReceipt(source,{cursor:'PRODUCTION_CURSOR_NEVER_TRANSFER'});
  const plan=prepared(source,target),statements=plan.groups.flatMap(group=>group.statements);
  const receipts=statements.filter(item=>/^\s*INSERT\s+INTO\s+provider_sync_scopes\b/i.test(item.sql));
  assert.ok(receipts.length>0);
  for(const receipt of receipts){
    assert.equal(receipt.sql,HISTORY_RECEIPT_SQL);assert.equal(receipt.params.length,9);
    assert.equal(receipt.params[4],null);
  }
  assert.doesNotMatch(JSON.stringify(statements),/PRODUCTION_CURSOR_NEVER_TRANSFER/);
  await applied(t,source,target);
  assert.equal(target.prepare('SELECT COUNT(*) n FROM auction_events').get().n,1);
  const receipt=target.prepare("SELECT * FROM provider_sync_scopes WHERE operation='history_refresh'").get();
  assert.equal(receipt.status,'complete');assert.equal(receipt.cursor,null);
  assert.equal(receipt.last_success_at,NEW);assert.equal(receipt.last_complete_at,NEW);
});

test('failed history uses exact failure SQL and preserves earlier staging success',async t=>{
  const source=database(t,fixture()),target=database(t,fixture('copart','12345678',OLD));
  addReceipt(source,{status:'failed',at:NEW,success:OLD,complete:OLD,cursor:'SOURCE_FAILED_CURSOR'});
  addReceipt(target,{at:OLD,success:OLD,complete:OLD});
  const plan=prepared(source,target);
  const failures=plan.groups.flatMap(group=>group.statements).filter(item=>item.sql===HISTORY_FAILURE_SQL);
  assert.equal(failures.length,1);assert.equal(failures[0].params.length,9);
  assert.doesNotMatch(JSON.stringify(failures),/SOURCE_FAILED_CURSOR|PRIOR_HISTORY_FAILURE/);
  await applied(t,source,target);
  const receipt=target.prepare("SELECT * FROM provider_sync_scopes WHERE operation='history_refresh'").get();
  assert.equal(receipt.status,'failed');assert.equal(receipt.last_attempt_at,NEW);
  assert.equal(receipt.last_success_at,OLD);assert.equal(receipt.last_complete_at,OLD);
});

test('masked VIN conflicts and event VIN or LOT mismatches fail before a plan is exposed',t=>{
  const source=database(t,fixture()),target=database(t,fixture('copart','12345678',OLD));
  for(const mutate of [
    value=>{value.tables.auction_listings[0].vin_normalized='5YJ3E1EA0LF******';value.tables.auction_events=[];},
    value=>value.tables.auction_events[0].vin_normalized='5YJ3E1EA0LF000002',
    value=>value.tables.auction_events[0].lot='87654321'
  ]){
    const incoming=capture(source,'publication');mutate(incoming);
    assert.throws(()=>prepareStagingPublicTransfer(incoming,capture(target,'staging')));
  }
});

test('nonfinite and missing receipt timestamps are rejected before writes',t=>{
  const source=database(t,fixture()),target=database(t);addReceipt(source);
  for(const [key,value] of [['last_attempt_at','invalid'],['last_success_at',null],
    ['last_complete_at',null],['updated_at','invalid']]){
    const incoming=capture(source,'publication');incoming.receipts[0][key]=value;
    assert.throws(()=>prepareStagingPublicTransfer(incoming,capture(target,'staging')));
  }
  const incoming=capture(source,'publication');incoming.health[0].last_attempt_at='invalid';
  assert.throws(()=>prepareStagingPublicTransfer(incoming,capture(target,'staging')));
});

test('newer staging failed receipt and source health are preserved over older source success',async t=>{
  const source=database(t,fixture()),target=database(t,fixture('copart','12345678',OLD));
  addReceipt(source);addReceipt(target,{status:'failed',at:LATER,success:OLD,complete:OLD,cursor:'LOCAL_CURSOR'});
  target.prepare("UPDATE vehicle_sources SET last_attempt_at=?,last_success_at=?,last_error_code='STAGING_FAILURE',sync_status='failed',updated_at=?")
    .run(LATER,OLD,LATER);
  const priorReceipt=target.prepare("SELECT * FROM provider_sync_scopes WHERE operation='history_refresh'").get();
  const priorHealth=target.prepare('SELECT last_attempt_at,last_success_at,last_error_code,sync_status FROM vehicle_sources').get();
  await applied(t,source,target);
  assert.deepEqual(target.prepare("SELECT * FROM provider_sync_scopes WHERE operation='history_refresh'").get(),priorReceipt);
  assert.deepEqual(target.prepare('SELECT last_attempt_at,last_success_at,last_error_code,sync_status FROM vehicle_sources').get(),priorHealth);
});

test('rehearsal and apply preserve private tables and unrelated operational scopes',async t=>{
  const source=database(t,fixture()),target=database(t);seedPrivate(source);seedPrivate(target);addReceipt(source);
  const before=privateRows(target),scope=target.prepare("SELECT * FROM provider_sync_scopes WHERE scope_key='unrelated-discovery'").get();
  const plan=prepared(source,target),rehearsal=await rehearse(plan,target);
  assert.equal(rehearsal.passed,true);assert.equal(rehearsal.plan_sha256,plan.manifest.plan_sha256);
  assert.equal(rehearsal.protected_before_sha256,rehearsal.protected_after_sha256);
  assert.equal(rehearsal.groups.length,plan.groups.length);
  for(const group of rehearsal.groups){
    assert.match(group.before_sha256,/^[a-f0-9]{64}$/);assert.match(group.after_sha256,/^[a-f0-9]{64}$/);
  }
  assert.deepEqual(privateRows(target),before);
  await applied(t,source,target);
  assert.deepEqual(privateRows(target),before);
  assert.deepEqual(target.prepare("SELECT * FROM provider_sync_scopes WHERE scope_key='unrelated-discovery'").get(),scope);
  assert.deepEqual(target.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(target.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('apply requires matching staging identity, write guard and matching successful rehearsal',async t=>{
  const source=database(t,fixture()),target=database(t),plan=prepared(source,target);
  const rehearsal=await rehearse(plan,target),{db,state}=adapter(target);
  const args={db,plan,rehearsal,directory:directory(t),beforeWrite:async()=>{}};
  await assert.rejects(applyStagingPublicTransfer({...args,db:{...db,identity:{...TARGETS.publication}}}));
  await assert.rejects(applyStagingPublicTransfer({...args,beforeWrite:undefined}));
  await assert.rejects(applyStagingPublicTransfer({...args,rehearsal:{...rehearsal,passed:false}}));
  await assert.rejects(applyStagingPublicTransfer({...args,rehearsal:{...rehearsal,plan_sha256:'0'.repeat(64)}}));
  assert.equal(state.writeBatches,0);
});

test('bounded apply resumes remaining groups without repeating earlier successful writes',async t=>{
  const source=database(t,combine(fixture(),fixture('iaai','87654321'))),target=database(t);
  const plan=prepared(source,target,{maxStatementsPerGroup:3}),rehearsal=await rehearse(plan,target);
  assert.ok(plan.groups.length>1);
  const {db,state}=adapter(target),args={db,plan,rehearsal,directory:directory(t),beforeWrite:async()=>{}};
  await applyStagingPublicTransfer({...args,maxGroups:1});const first=state.writeBatches;
  assert.equal(first,1);
  await applyStagingPublicTransfer(args);
  assert.equal(state.writeBatches,plan.groups.length);
  assert.equal(target.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,2);
});

test('committed batch with lost response latches STOP then resumes by readback without duplicate write',async t=>{
  const source=database(t,fixture()),target=database(t),plan=prepared(source,target);
  const rehearsal=await rehearse(plan,target),{db,state}=adapter(target),dir=directory(t);
  const args={db,plan,rehearsal,directory:dir,beforeWrite:async()=>{}};
  state.afterCommit=async()=>{state.afterCommit=null;throw Error('SIMULATED_LOST_COMMIT_RESPONSE');};
  await assert.rejects(applyStagingPublicTransfer(args));
  assert.equal(state.writeBatches,1);
  await assert.rejects(applyStagingPublicTransfer(args));
  assert.equal(state.writeBatches,1);
  const stops=fs.readdirSync(dir).filter(name=>/stop/i.test(name));
  assert.ok(stops.length>0);
  for(const name of stops)fs.unlinkSync(path.join(dir,name));
  await applyStagingPublicTransfer(args);
  assert.equal(state.writeBatches,plan.groups.length);
  assert.equal(target.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,1);
  assert.equal(target.prepare('SELECT COUNT(*) n FROM auction_events').get().n,1);
});

test('changed staging data after rehearsal and changed plans are rejected before any write',async t=>{
  const source=database(t,fixture()),target=database(t,fixture('copart','12345678',OLD));
  const plan=prepared(source,target),rehearsal=await rehearse(plan,target),{db,state}=adapter(target);
  const args={db,plan,rehearsal,directory:directory(t),beforeWrite:async()=>{}};
  const corrupt=structuredClone(plan);corrupt.groups[0].statements[0].params[0]='corrupted-identity';
  await assert.rejects(applyStagingPublicTransfer({...args,plan:corrupt}));
  assert.equal(state.writeBatches,0);
  target.exec('UPDATE auction_listings SET current_bid_usd=123456');
  await assert.rejects(applyStagingPublicTransfer({...args,directory:directory(t)}));
  assert.equal(state.writeBatches,0);
});

test('concurrent receipt change after precheck rolls back the whole receipt group and latches STOP',async t=>{
  const tables=combine(fixture(),fixture('iaai','87654321'));
  const source=database(t,tables);
  const target=database(t,combine(fixture('copart','12345678',OLD),fixture('iaai','87654321',OLD)));
  addReceipt(source);addReceipt(source,{platform:'iaai',lot:'87654321'});
  addReceipt(target,{at:OLD});addReceipt(target,{platform:'iaai',lot:'87654321',at:OLD});
  const plan=prepared(source,target),rehearsal=await rehearse(plan,target),{db,state}=adapter(target);
  let changed=false;
  const args={db,plan,rehearsal,directory:directory(t),beforeWrite:async group=>{
    if(group.kind!=='receipts'||changed)return;
    changed=true;
    target.prepare(`UPDATE provider_sync_scopes SET status='failed',last_attempt_at=?,
      last_error_code='CONCURRENT_STAGING_FAILURE',updated_at=? WHERE scope_key=?`)
      .run(LATER,LATER,'history-import:listing:iaai:87654321');
  }};
  await assert.rejects(applyStagingPublicTransfer(args));
  assert.equal(changed,true);
  const first=target.prepare('SELECT * FROM provider_sync_scopes WHERE scope_key=?')
    .get('history-import:listing:copart:12345678');
  const second=target.prepare('SELECT * FROM provider_sync_scopes WHERE scope_key=?')
    .get('history-import:listing:iaai:87654321');
  assert.equal(first.status,'complete');assert.equal(first.last_success_at,OLD);
  assert.equal(second.status,'failed');assert.equal(second.last_attempt_at,LATER);
  assert.equal(target.prepare("SELECT COUNT(*) n FROM vehicle_sources WHERE source_key='staging-transfer-assertion'").get().n,0);
  const writes=state.writeBatches;
  await assert.rejects(applyStagingPublicTransfer(args),/STOP_LATCH/);
  assert.equal(state.writeBatches,writes);
});

test('truncated and corrupted completion journals cannot resume writes',async t=>{
  for(const corruption of ['truncated','completed-hash']){
    const source=database(t,fixture()),target=database(t),plan=prepared(source,target,{maxStatementsPerGroup:3});
    const rehearsal=await rehearse(plan,target),{db,state}=adapter(target),dir=directory(t);
    const args={db,plan,rehearsal,directory:dir,beforeWrite:async()=>{}};
    await applyStagingPublicTransfer({...args,maxGroups:1});
    const file=path.join(dir,'transfer-progress.ndjson'),writes=state.writeBatches;
    if(corruption==='truncated')fs.appendFileSync(file,'{"kind":');
    else{
      const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
      rows.find(row=>row.kind==='complete').after_sha256='0'.repeat(64);
      fs.writeFileSync(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    }
    await assert.rejects(applyStagingPublicTransfer(args),/LEDGER_TRUNCATED|PROGRESS_INVALID/);
    assert.equal(state.writeBatches,writes);
  }
});

test('invalid or future staging health and receipt clocks fail before planning',t=>{
  const source=database(t,fixture()),target=database(t,fixture('copart','12345678',OLD));
  addReceipt(source);addReceipt(target,{at:OLD});
  for(const value of ['not-a-timestamp','2026-10-21T00:00:00.000Z']){
    for(const key of ['last_attempt_at','last_success_at','last_complete_at','updated_at']){
      const existing=capture(target,'staging');existing.receipts[0][key]=value;
      assert.throws(()=>prepareStagingPublicTransfer(capture(source,'publication'),existing),
        /TARGET_RECEIPT_INVALID/);
    }
    for(const key of ['last_attempt_at','last_success_at']){
      const existing=capture(target,'staging');existing.health[0][key]=value;
      assert.throws(()=>prepareStagingPublicTransfer(capture(source,'publication'),existing),
        /TARGET_HEALTH_INVALID/);
    }
  }
});

test('catalog packing combines whole listing groups within the configured statement ceiling',t=>{
  const tables=combine(...Array.from({length:5},(_,i)=>fixture('copart',String(10000000+i))));
  const source=database(t,tables),target=database(t),incoming=capture(source,'publication'),existing=capture(target,'staging');
  const maximum=10;
  const original=buildPublicCatalogMerge({tables:incoming.tables,columns:incoming.columns,
    existingTables:existing.tables,existingColumns:existing.columns,capturedAt:incoming.at,
    maxStatementsPerGroup:maximum,deltaOnly:true});
  const plan=prepareStagingPublicTransfer(incoming,existing,{maxStatementsPerGroup:maximum});
  const packed=plan.groups.filter(group=>group.kind==='catalog');
  assert.equal(original.groups.length,5);assert.equal(packed.length,3);
  assert.ok(packed.length<original.groups.length);
  assert.ok(plan.groups.every(group=>group.statements.length<=maximum));
  assert.deepEqual(packed.flatMap(group=>group.statements),original.groups.flatMap(group=>group.statements));
  for(const group of original.groups){
    const encoded=JSON.stringify(group.statements);
    assert.ok(packed.some(batch=>batch.statements.some((_,i)=>
      JSON.stringify(batch.statements.slice(i,i+group.statements.length))===encoded)),
    'each original atomic group remains contiguous within one batch');
  }
});

test('synthetic strict staging bridge accepts generated catalog, health, receipt and failure guards',async t=>{
  const source=database(t,combine(fixture(),fixture('iaai','87654321'))),target=database(t);
  addReceipt(source);
  addReceipt(source,{platform:'iaai',lot:'87654321',status:'failed',success:OLD,complete:OLD});
  const plan=prepared(source,target),rehearsal=await rehearse(plan,target);
  const statements=plan.groups.flatMap(group=>group.statements);
  assert.ok(statements.some(item=>item.sql===HISTORY_RECEIPT_SQL));
  assert.ok(statements.some(item=>item.sql===HISTORY_FAILURE_SQL));
  assert.ok(statements.some(item=>item.guard));
  const local=adapter(target);let reservations=0,completions=0,fetchCalls=0;
  const fetchImpl=async(_url,options)=>{
    fetchCalls++;
    const body=options.body?JSON.parse(options.body):null;
    const result=body
      ? await local.db.batch(body.batch||[{sql:body.sql,params:body.params||[]}])
      : {uuid:TARGETS.staging.id,name:TARGETS.staging.name};
    return {ok:true,status:200,async json(){return {success:true,result};}};
  };
  const db=await connectD1({target:'staging',token:'synthetic-offline-placeholder',fetchImpl,
    historyReceipts:true,writeBudget:{
      async beforeWrite(){reservations++;return {id:reservations};},
      complete(){completions++;},recordRead(){}
    }});
  await applyStagingPublicTransfer({db,plan,rehearsal,directory:directory(t),beforeWrite:async()=>{}});
  assert.equal(reservations,plan.groups.length);assert.equal(completions,reservations);
  assert.ok(fetchCalls>reservations);
  assert.equal(target.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,2);
  assert.equal(target.prepare("SELECT status FROM provider_sync_scopes WHERE scope_key='history-import:listing:copart:12345678'").get().status,'complete');
  assert.equal(target.prepare("SELECT status FROM provider_sync_scopes WHERE scope_key='history-import:listing:iaai:87654321'").get().status,'failed');
  assert.equal(target.prepare("SELECT COUNT(*) n FROM vehicle_sources WHERE source_key='staging-transfer-assertion'").get().n,0);
});

const {createHash}=require('node:crypto');
const correctionFields=['source_status','canonical_status','source_price_usd','final_price_usd'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function correctionFixture(t,{count=1}={}){
  const old=combine(...Array.from({length:count},(_,i)=>fixture('copart',String(12345678+i),OLD)));
  const incoming=structuredClone(old);
  for(const event of old.auction_events)Object.assign(event,{source_status:'Sold',canonical_status:'Sold',
    final_price_usd:4100,fingerprint:'a'.repeat(64),normalizer_version:1});
  for(const event of incoming.auction_events)Object.assign(event,{source_status:'Not Sold',canonical_status:'Not Sold',
    source_price_usd:0,final_price_usd:null,observed_at:NEW,updated_at:NEW,fingerprint:'b'.repeat(64),normalizer_version:2});
  const source=database(t,incoming),target=database(t,old);
  for(let i=0;i<count;i++){addReceipt(source,{lot:String(12345678+i)});addReceipt(target,{lot:String(12345678+i),at:OLD});}
  const a=capture(source,'publication'),b=capture(target,'staging');
  const reconciliation=buildEventReconciliation(a,b,{allowedFields:correctionFields});
  const plan=prepareStagingPublicTransfer(a,b,{eventReconciliation:reconciliation});
  return {source,target,a,b,reconciliation,plan};
}
function correctionAudit(plan,dir){
  const file=path.join(dir,'event-audit.json');
  fs.writeFileSync(file,JSON.stringify({format:'rexbid-event-reconciliation-audit-v1',
    plan_sha256:plan.manifest.plan_sha256,reconciliation_sha256:digest(plan.eventReconciliation),
    reconciliation:plan.eventReconciliation,backup_manifest_sha256:'c'.repeat(64),capture_sha256:'d'.repeat(64),
    backup:{database_id:TARGETS.staging.id,database:TARGETS.staging.name,roundtrip:true,bytes:123,
      plaintext_sha256:'e'.repeat(64),ciphertext_sha256:'f'.repeat(64)}}),{flag:'wx'});
  return file;
}
function correctionArgs(t,f){
  const connection=adapter(f.target),dir=directory(t);
  return {...connection,args:{db:connection.db,plan:f.plan,rehearsal:rehearse(f.plan,f.target),
    directory:dir,eventAuditFile:correctionAudit(f.plan,dir),beforeWrite:async()=>{}}};
}

test('event corrections require explicit evidence while generic catalog merge stays strict',t=>{
  const f=correctionFixture(t);
  assert.throws(()=>prepareStagingPublicTransfer(f.a,f.b),/PUBLIC_MERGE_EVENT_CONFLICT/);
  assert.throws(()=>buildPublicCatalogMerge({tables:f.a.tables,columns:f.a.columns,
    existingTables:f.b.tables,existingColumns:f.b.columns,capturedAt:CAPTURED}),/PUBLIC_MERGE_EVENT_CONFLICT/);
  assert.equal(f.plan.manifest.event_corrections,1);
  const item=f.reconciliation.corrections[0];
  assert.deepEqual(item.changed_fields,['source_status','canonical_status','source_price_usd','final_price_usd']);
  assert.equal(item.old_fingerprint,'a'.repeat(64));assert.equal(item.new_fingerprint,'b'.repeat(64));
  assert.equal(item.before.final_price_usd,4100);assert.equal(item.after.final_price_usd,null);
  assert.equal(item.after.source_price_usd,0);assert.equal(item.before_sha256,digest(item.before));
  assert.equal(item.after_sha256,digest(item.after));
  assert.equal(f.reconciliation.source_capture_sha256,digest(f.a));
  assert.equal(f.reconciliation.target_capture_sha256,digest(f.b));
  assert.deepEqual(buildEventReconciliation(f.a,f.b,{allowedFields:correctionFields}),f.reconciliation);
  assert.equal(f.a.tables.auction_events[0].source_status,'Not Sold','source capture was not replaced or mutated');
});

test('only explicitly listed mutable content fields can be reconciled',t=>{
  const f=correctionFixture(t);
  for(const fields of [undefined,[],['vin_normalized'],['source_status','source_status']]){
    assert.throws(()=>buildEventReconciliation(f.a,f.b,{allowedFields:fields}),/STAGING_EVENT_FIELDS_REQUIRED/);
  }
  assert.throws(()=>buildEventReconciliation(f.a,f.b,{allowedFields:['source_status','canonical_status']}),/UNAPPROVED_CHANGE/);
  for(const field of ['auction_date','event_key','provider_event_id','seller_type']){
    const incoming=structuredClone(f.a);incoming.tables.auction_events[0][field]='changed';
    assert.throws(()=>buildEventReconciliation(incoming,f.b,{allowedFields:correctionFields}),/UNAPPROVED_CHANGE/);
  }
});

test('VIN, listing, source, platform and LOT identity changes cannot enter reconciliation',t=>{
  const f=correctionFixture(t);
  for(const field of ['listing_id','source_key','platform','lot','vin_normalized','provider','identity_state']){
    const incoming=structuredClone(f.a);incoming.tables.auction_events[0][field]='different-identity';
    assert.throws(()=>buildEventReconciliation(incoming,f.b,{allowedFields:correctionFields}));
  }
});

test('corrections require newer finite observations, valid fingerprints and supported schema',t=>{
  const f=correctionFixture(t);
  for(const at of [OLD,'2026-10-01T00:00:00.000Z','invalid','2026-10-21T00:00:00.000Z']){
    const incoming=structuredClone(f.a);incoming.tables.auction_events[0].observed_at=at;
    assert.throws(()=>buildEventReconciliation(incoming,f.b,{allowedFields:correctionFields}),/OBSERVATION_NOT_NEWER/);
  }
  for(const fingerprint of [null,'invalid','a'.repeat(64)]){
    const incoming=structuredClone(f.a);incoming.tables.auction_events[0].fingerprint=fingerprint;
    assert.throws(()=>buildEventReconciliation(incoming,f.b,{allowedFields:correctionFields}),/EVIDENCE_INVALID/);
  }
  const newerTarget=structuredClone(f.b);newerTarget.tables.auction_events[0].updated_at=LATER;
  assert.throws(()=>buildEventReconciliation(f.a,newerTarget,{allowedFields:correctionFields}),/OBSERVATION_NOT_NEWER/);
  const schemaChange=structuredClone(f.b);schemaChange.columns.auction_events.push({name:'unknown_column'});
  assert.throws(()=>buildEventReconciliation(f.a,schemaChange,{allowedFields:correctionFields}),/SCHEMA_UNSUPPORTED/);
});

test('correction evidence is bound to both complete captures and exact before/after values',t=>{
  const f=correctionFixture(t);
  for(const change of [
    x=>x.source_capture_sha256='0'.repeat(64),
    x=>x.target_capture_sha256='0'.repeat(64),
    x=>x.corrections[0].after.final_price_usd=123,
    x=>x.corrections[0].before.final_price_usd=0,
    x=>x.corrections[0].changed_fields.push('seller_name'),
    x=>x.corrections.pop()
  ]){
    const evidence=structuredClone(f.reconciliation);change(evidence);
    assert.throws(()=>prepareStagingPublicTransfer(f.a,f.b,{eventReconciliation:evidence}),/RECONCILIATION_CHANGED/);
  }
});

test('approved corrections preserve zero/null, existing creation time, snapshots, private data and fresh complete receipts',async t=>{
  const f=correctionFixture(t);seedPrivate(f.target);
  const beforePrivate=privateRows(f.target);
  const beforeSnapshots=f.target.prepare('SELECT * FROM auction_listing_snapshots').all();
  const {args}=correctionArgs(t,f);
  assert.equal(args.rehearsal.event_preservation.corrected,1);
  assert.equal(args.rehearsal.event_preservation.exact_approved_delta,true);
  await applyStagingPublicTransfer(args);
  const event=f.target.prepare('SELECT * FROM auction_events').get();
  assert.equal(event.final_price_usd,null);assert.equal(event.source_price_usd,0);
  assert.equal(event.source_status,'Not Sold');assert.equal(event.created_at,OLD);
  assert.equal(event.observed_at,NEW);assert.equal(event.fingerprint,'b'.repeat(64));
  assert.deepEqual(f.target.prepare('SELECT * FROM auction_listing_snapshots').all(),beforeSnapshots);
  assert.deepEqual(privateRows(f.target),beforePrivate);
  const receipt=f.target.prepare("SELECT * FROM provider_sync_scopes WHERE operation='history_refresh'").get();
  assert.equal(receipt.status,'complete');assert.equal(receipt.last_complete_at,NEW);
  const archived=JSON.parse(fs.readFileSync(args.eventAuditFile,'utf8'));
  assert.equal(archived.reconciliation.corrections[0].before.final_price_usd,4100);
  assert.equal(archived.reconciliation.corrections[0].before.created_at,OLD);
  const correctedGroup=f.plan.groups.findIndex(x=>x.kind==='event_reconciliation');
  assert.ok(correctedGroup<f.plan.groups.findIndex(x=>x.kind==='receipts'));
});

test('source creation time differences never replace the retained event creation time',t=>{
  const f=correctionFixture(t),incoming=structuredClone(f.a);
  incoming.tables.auction_events[0].created_at=NEW;
  const evidence=buildEventReconciliation(incoming,f.b,{allowedFields:correctionFields});
  assert.equal(evidence.corrections[0].source.created_at,NEW);
  assert.equal(evidence.corrections[0].after.created_at,OLD);
  assert.ok(!evidence.corrections[0].updated_columns.includes('created_at'));
});

test('durable complete audit is required before the first write and is checked again before each write',async t=>{
  const f=correctionFixture(t),{args,state}=correctionArgs(t,f);
  await assert.rejects(applyStagingPublicTransfer({...args,eventAuditFile:undefined}),/DURABLE_AUDIT_REQUIRED/);
  assert.equal(state.writeBatches,0);
  const archive=JSON.parse(fs.readFileSync(args.eventAuditFile,'utf8'));
  archive.reconciliation.corrections[0].before.source_status='tampered';
  fs.writeFileSync(args.eventAuditFile,JSON.stringify(archive));
  await assert.rejects(applyStagingPublicTransfer(args),/DURABLE_AUDIT_CHANGED/);
  assert.equal(state.writeBatches,0);
  const g=correctionFixture(t),other=correctionArgs(t,g);
  other.args.beforeWrite=async()=>{fs.unlinkSync(other.args.eventAuditFile);};
  await assert.rejects(applyStagingPublicTransfer(other.args),/DURABLE_AUDIT_REQUIRED/);
  assert.equal(other.state.writeBatches,0);
});

test('a concurrent change to any old event column atomically rolls back all corrections and prevents fresh receipts',async t=>{
  const f=correctionFixture(t,{count:2}),{args}=correctionArgs(t,f);
  let changed=false;
  args.beforeWrite=async group=>{
    if(group.kind!=='event_reconciliation'||changed)return;changed=true;
    f.target.prepare('UPDATE auction_events SET seller_name=? WHERE lot=?').run('concurrent','12345679');
  };
  await assert.rejects(applyStagingPublicTransfer(args),/NOT NULL constraint/);
  assert.equal(changed,true);
  const events=f.target.prepare('SELECT * FROM auction_events ORDER BY lot').all();
  assert.equal(events[0].source_status,'Sold');assert.equal(events[1].source_status,'Sold');
  assert.equal(events[1].seller_name,'concurrent');
  assert.ok(f.target.prepare("SELECT * FROM provider_sync_scopes WHERE operation='history_refresh'").all()
    .every(row=>row.last_success_at===OLD));
  assert.equal(f.target.prepare("SELECT COUNT(*) n FROM vehicle_sources WHERE source_key='staging-event-reconciliation-assertion'").get().n,0);
});

test('correction lost response resumes with exact new readback and no second UPDATE',async t=>{
  const f=correctionFixture(t),{args,state}=correctionArgs(t,f);
  let correctionCommitted=false,correctionWrites=0;
  state.beforeBatch=async statements=>{
    if(statements.some(x=>/^\s*UPDATE auction_events/.test(x.sql)))correctionWrites++;
  };
  args.beforeWrite=async group=>{
    if(group.kind!=='event_reconciliation'||correctionCommitted)return;
    state.afterCommit=async()=>{state.afterCommit=null;correctionCommitted=true;throw Error('SIMULATED_LOST_CORRECTION_REPLY');};
  };
  await assert.rejects(applyStagingPublicTransfer(args),/SIMULATED_LOST_CORRECTION_REPLY/);
  assert.equal(correctionWrites,1);
  fs.unlinkSync(path.join(args.directory,'transfer-stop.json'));
  await applyStagingPublicTransfer(args);
  assert.equal(correctionWrites,1);
  assert.equal(f.target.prepare('SELECT source_status FROM auction_events').get().source_status,'Not Sold');
  assert.equal(f.target.prepare("SELECT last_complete_at FROM provider_sync_scopes WHERE operation='history_refresh'").get().last_complete_at,NEW);
  await applyStagingPublicTransfer(args);
  assert.equal(correctionWrites,1);
});

test('a correction changed after readback cannot receive the newer complete receipt',async t=>{
  const f=correctionFixture(t),{args}=correctionArgs(t,f);
  let changed=false;
  args.beforeWrite=async group=>{
    if(group.kind!=='receipts'||changed)return;changed=true;
    f.target.prepare("UPDATE auction_events SET source_price_usd=99 WHERE event_id=?")
      .run(f.reconciliation.corrections[0].event_id);
  };
  await assert.rejects(applyStagingPublicTransfer(args),/NOT NULL constraint/);
  assert.equal(changed,true);
  const receipt=f.target.prepare("SELECT * FROM provider_sync_scopes WHERE operation='history_refresh'").get();
  assert.equal(receipt.last_complete_at,OLD);
  assert.equal(f.target.prepare('SELECT source_status FROM auction_events').get().source_status,'Not Sold');
});

test('rehearsal rejects unlisted or altered event changes even if group hashes are recomputed',t=>{
  const f=correctionFixture(t);
  const corrupt=structuredClone(f.plan);
  const group=corrupt.groups.find(x=>x.kind==='event_reconciliation');
  group.statements[1].params[0]='another-status';
  group.sha256=digest({statements:group.statements,verify:group.verify});
  corrupt.manifest.plan_sha256=digest(corrupt.groups);
  assert.throws(()=>rehearse(corrupt,f.target),/RECONCILIATION_CHANGED/);
  const before=f.b.tables.auction_events,after=structuredClone(before);
  after[0].source_status='unexpected';
  assert.throws(()=>verifyEventPreservation(before,after,null),/PRESERVATION_CHANGED/);
  assert.throws(()=>verifyEventPreservation(before,[],f.reconciliation),/PRESERVATION_CHANGED/);
  assert.throws(()=>verifyEventPreservation([],[],f.reconciliation),/PRESERVATION_MISSING/);
});

test('reconciliation guard and UPDATE remain within D1 parameter limits and strict bridge accepts them',async t=>{
  const f=correctionFixture(t),{args}=correctionArgs(t,f),local=adapter(f.target);
  for(const group of f.plan.groups)for(const statement of group.statements){
    assert.ok(statement.params.length<=100);assert.equal((statement.sql.match(/\?/g)||[]).length,statement.params.length);
  }
  let budgeted=0;
  const db=await connectD1({target:'staging',token:'synthetic-offline-placeholder',historyReceipts:true,
    fetchImpl:async(_url,options)=>{
      const body=options.body?JSON.parse(options.body):null;
      const result=body?await local.db.batch(body.batch||[{sql:body.sql,params:body.params||[]}]):{uuid:TARGETS.staging.id,name:TARGETS.staging.name};
      return {ok:true,status:200,async json(){return {success:true,result};}};
    },writeBudget:{async beforeWrite(){budgeted++;return {id:budgeted};},complete(){},recordRead(){}}});
  const result=await applyStagingPublicTransfer({...args,db});
  assert.equal(budgeted,result.writtenGroups);
  assert.equal(f.target.prepare('SELECT source_status FROM auction_events').get().source_status,'Not Sold');
});
