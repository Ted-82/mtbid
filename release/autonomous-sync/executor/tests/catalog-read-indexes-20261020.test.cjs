'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {DatabaseSync} = require('node:sqlite');
const {D1ReadRepository,encodeCursor} = require('../sync/d1-read-repository.js');
const ROOT = path.join(__dirname,'..');
const MIGRATION = fs.readFileSync(path.join(ROOT,'docs/proposals/0009_public_catalog_read_indexes.sql'),'utf8');
const NOW = '2026-10-20T16:00:00.000Z';
const BEFORE = '2026-10-19T16:00:00.000Z';
const FUTURE = '2026-10-21T16:00:00.000Z';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const RECENT_INDEXES = [
  'idx_listings_public_recent','idx_listings_public_platform_recent',
  'idx_listings_public_timed_recent','idx_listings_public_buy_now_recent',
  'idx_listings_public_platform_timed_recent',
  'idx_listings_public_make_recent','idx_scopes_public_coverage'
];

function fixture(count) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA temp_store=MEMORY');
  db.exec(fs.readFileSync(path.join(ROOT,'docs/proposals/0004_d1_sync_2.sql'),'utf8'));
  const source = db.prepare(`INSERT INTO vehicle_sources
    (source_key,provider,platform,provider_vehicle_id,first_seen_at,last_seen_at,last_attempt_at,last_success_at,last_error_code,created_at,updated_at)
    VALUES(?,'apibara',?,?,?,?,?,?,?,?,?)`);
  const columns = ['listing_id','source_key','platform','lot','vin_normalized','source_listing_id','vehicle_title',
    'make','model','year','fuel_type','body_style','auction_state','source_status','auction_at','timed_end_at','is_timed',
    'current_bid_usd','buy_now_usd','odometer_value','location_state','first_seen_at','last_seen_at','summary_synced_at',
    'detail_synced_at','created_at','updated_at'];
  const listing = db.prepare(`INSERT INTO auction_listings (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
  const scope = db.prepare(`INSERT INTO provider_sync_scopes
    (scope_key,provider,platform,operation,status,cursor,last_complete_at,updated_at)
    VALUES(?,'apibara',?,?,?,?,?,?)`);
  const makes = ['Honda','BMW','Ford','TOYOTA','Tesla','LUCID MOTORS','FISKER AUTOMOTIVE','MERCEDES BENZ'];
  const fuels = ['Electric',' BEV ','battery electric','Battery Electric Vehicle','all electric','pure electric','fully electric'];
  db.exec('BEGIN');
  for (let index = 0; index < count; index++) {
    const id = 'listing-' + String(index).padStart(6,'0'), key = 'source-' + index;
    const platform = index % 2 ? 'iaai' : 'copart';
    // Scrambled observation order, including ties, exercises deterministic ID
    // ordering and avoids an unrealistically already-sorted rowid table.
    const seen = new Date(Date.parse(NOW) - (index * 7919 % 600) * 60000).toISOString();
    const fresh = index % 13 !== 0, failed = index % 97 === 0;
    const state = ['open','sold','unknown','live','open','open','not_sold'][index % 7];
    const rawStatus = index % 17 === 0 ? 'conflict' : index % 19 === 0 ? 'Future' : 'Open';
    const date = index % 23 === 0 ? '2026-10-20' : index % 29 === 0 ? '2020-01-01T00:00:00Z' : FUTURE;
    const timed = index % 113 === 0 ? 1 : index % 31 === 0 ? null : 0;
    const bid = index % 5 === 0 ? 0 : index % 5 === 1 ? null : index % 100 * 100;
    const buy = index % 37 === 0 ? 8000 : index % 41 === 0 ? 0 : null;
    source.run(key,platform,String(index),BEFORE,seen,NOW,failed ? BEFORE : NOW,failed ? 'NOT_FOUND' : null,BEFORE,seen);
    const row = [id,key,platform,String(10000000+index),'1HGCM82633A' + String(index).padStart(6,'0'),
      String(10000000+index),`${2020+index%6} ${makes[index%makes.length]} Model${index%20}`,
      makes[index%makes.length],'Model'+index%20,2020+index%6,
      index % 101 === 0 ? fuels[Math.floor(index/101)%fuels.length] : index % 103 === 0 ? 'Hybrid' : 'Gasoline',
      index % 3 ? 'Sedan' : 'SUV',state,rawStatus,date,timed ? date : null,timed,bid,buy,index % 5 ? index*10 : null,
      index % 2 ? 'TX' : 'FL',BEFORE,seen,fresh ? seen : '2020-01-01T00:00:00Z',seen,BEFORE,seen];
    listing.run(...row);
    scope.run('history-import:'+id,platform,'history_refresh','partial',null,null,NOW);
  }
  for (let index = 0; index < 10; index++) {
    scope.run('discovery-'+index,index%2 ? 'iaai' : 'copart','discovery','partial',null,null,NOW);
  }
  db.exec('COMMIT');
  return db;
}

async function listQuery(options,anchor = null) {
  const captured = [];
  const db = {prepare(sql) {
    const methods = params => ({async first() {return anchor;},
      async all() {captured.push({sql,params}); return {results:[]};}});
    return {...methods([]),bind(...params) {return methods(params);}};
  }};
  await new D1ReadRepository(db,{now:()=>Date.parse(NOW)}).listCatalog({...options,nowIso:NOW});
  const result = captured.find(query => query.sql.includes('SELECT l.*'));
  assert.ok(result);
  return result;
}
function explain(db,query) {
  return db.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.params).map(row=>row.detail);
}
function fingerprint(db,query) {
  return digest(db.prepare(query.sql).all(...query.params));
}
function median(db,query,repetitions = 15) {
  const statement = db.prepare(query.sql);
  for (let index=0;index<3;index++) statement.all(...query.params);
  const times=[];
  for (let index=0;index<repetitions;index++) {
    const started=performance.now();
    statement.all(...query.params);
    times.push(performance.now()-started);
  }
  return Number(times.sort((a,b)=>a-b)[Math.floor(times.length/2)].toFixed(3));
}
function pairedTiming(before,after,query) {
  const original=[],updated=[];
  for (let round=0;round<5;round++) {
    if (round % 2) {
      updated.push(median(after,query,9)); original.push(median(before,query,9));
    } else {
      original.push(median(before,query,9)); updated.push(median(after,query,9));
    }
  }
  return {before_ms:original.sort((a,b)=>a-b)[2],after_ms:updated.sort((a,b)=>a-b)[2]};
}
function writeCost(db) {
  const update=db.prepare(`UPDATE auction_listings SET last_seen_at=?,summary_synced_at=?,
    current_bid_usd=?,updated_at=? WHERE listing_id=?`);
  const times=[];
  for (let repeat=0;repeat<7;repeat++) {
    db.exec('SAVEPOINT write_measurement');
    const started=performance.now();
    for (let index=0;index<500;index++) {
      update.run(FUTURE,FUTURE,index % 5 ? null : 0,FUTURE,'listing-'+String(index).padStart(6,'0'));
    }
    times.push(performance.now()-started);
    db.exec('ROLLBACK TO write_measurement; RELEASE write_measurement');
  }
  return {updates:500,median_ms:Number(times.sort((a,b)=>a-b)[3].toFixed(3)),
    database_bytes:db.prepare('PRAGMA page_count').get().page_count * db.prepare('PRAGMA page_size').get().page_size};
}
function publicState(db) {
  return digest(['vehicle_sources','auction_listings','provider_sync_scopes'].map(table =>
    db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()));
}
async function cases(db) {
  const category = {observedAfter:BEFORE,nowIso:NOW};
  const options = {
    all:{},platform:{platform:'copart'},make:{make:'Honda'},missing_make:{make:'DOES NOT EXIST'},
    make_family:{make:'MERCEDES-BENZ'},platform_make:{platform:'iaai',make:'BMW'},
    current:{...category,category:'current'},timed:{...category,category:'timed'},
    timed_platform:{...category,category:'timed',platform:'copart'},
    buy_now:{...category,category:'buy-now'},buy_now_platform:{...category,category:'buy-now',platform:'iaai'},
    electric:{...category,category:'electric'},electric_platform:{...category,category:'electric',platform:'copart'},
    hybrid:{fuelType:'hybrid'},zero_price:{priceMin:0,priceMax:0},bounded_price:{priceMin:100,priceMax:2000},
    nulls_and_status:{timed:false,auctionState:'Open',odometerFrom:0,odometerTo:1000},
    body_family:{bodyStyle:'kind:car',fuelType:'gasoline'},literal_search:{search:'Model1'},
    missing_search:{search:'NOT-A-STORED-IDENTIFIER'}
  };
  const anchor=db.prepare('SELECT last_seen_at,listing_id FROM auction_listings ORDER BY last_seen_at DESC,listing_id ASC LIMIT 1 OFFSET 2500').get();
  const cursor=encodeCursor(['listing',anchor.listing_id]);
  const result=Object.fromEntries(await Promise.all(Object.entries(options).map(async([key,value])=>
    [key,await listQuery(value)])));
  result.cursor=await listQuery({cursor},anchor);
  result.cursor_platform=await listQuery({cursor,platform:'copart'},anchor);
  result.coverage={sql:"SELECT provider,platform,status,cursor,last_complete_at FROM provider_sync_scopes WHERE operation='discovery' ORDER BY platform,provider",params:[]};
  return result;
}

test('candidate is seven additive non-unique indexes and can be applied twice',()=>{
  const statements=MIGRATION.replace(/--[^\r\n]*/g,'').split(';').map(value=>value.trim()).filter(Boolean);
  assert.equal(statements.length,7);
  assert.ok(statements.every(sql=>/^CREATE INDEX IF NOT EXISTS [a-z_]+ ON /i.test(sql.replace(/\s+/g,' '))));
  const db=fixture(10);
  try {
    const before=publicState(db);
    db.exec(MIGRATION); db.exec(MIGRATION);
    assert.equal(publicState(db),before,'indexes cannot change data, dates, prices or receipts');
    const indexes=db.prepare("SELECT name FROM sqlite_schema WHERE type='index'").all().map(row=>row.name);
    for (const name of RECENT_INDEXES) assert.ok(indexes.includes(name),name);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});

for (const count of [5000,10000]) test(`catalog query parity and query plans at ${count} synthetic rows`,async t=>{
  const db=fixture(count),reference=fixture(count);
  try {
    const queries=await cases(db), original=Object.fromEntries(Object.entries(queries).map(([key,query])=>
      [key,{hash:fingerprint(db,query),plan:explain(db,query)}]));
    const state=publicState(db);
    const writesBefore=writeCost(db);
    db.exec(MIGRATION);
    const updated={};
    for (const [key,query] of Object.entries(queries)) {
      assert.equal(fingerprint(db,query),original[key].hash,key+': exact ordered rows and every selected field');
      assert.equal(fingerprint(reference,query),original[key].hash,key+': benchmark reference is identical');
      const timing=pairedTiming(reference,db,query);
      original[key].ms=timing.before_ms;
      updated[key]={plan:explain(db,query),ms:timing.after_ms};
    }
    assert.equal(publicState(db),state);
    const writesAfter=writeCost(db);
    assert.equal(publicState(db),state,'write measurements roll back every value');
    t.diagnostic(JSON.stringify({count,method:'5 alternating before/after rounds, each median of 9 warm in-memory SQLite executions; no network or D1 billing inference',
      node_version:process.version,sqlite_version:db.prepare('SELECT sqlite_version() version').get().version,
      before:original,after:updated,write_measurement:{before:writesBefore,after:writesAfter}}));
    for (const key of ['all','platform','current','timed','timed_platform','buy_now']) {
      assert.ok(!updated[key].plan.some(row=>row.includes('TEMP B-TREE')),key+': no full result sort');
    }
    assert.match(updated.timed.plan.join('\n'),/idx_listings_public_timed_recent/);
    assert.match(updated.timed_platform.plan.join('\n'),/idx_listings_public_platform_timed_recent/);
    assert.match(updated.buy_now.plan.join('\n'),/idx_listings_public_buy_now_recent/);
    assert.match(updated.missing_make.plan.join('\n'),/idx_listings_public_make_recent/);
    assert.match(updated.coverage.plan.join('\n'),/SEARCH provider_sync_scopes USING INDEX idx_scopes_public_coverage/);
    assert.match(updated.buy_now_platform.plan.join('\n'),/idx_listings_buy_now/);
  } finally {db.close();reference.close();}
});

test('empty Timed retains its selective plan and electric results remain unchanged',async()=>{
  const db=fixture(10000);
  try {
    const timed=await listQuery({category:'timed',observedAfter:BEFORE});
    const electric=await listQuery({category:'electric',observedAfter:BEFORE});
    db.exec("UPDATE auction_listings SET auction_state='sold' WHERE is_timed=1 OR lower(trim(COALESCE(fuel_type,'')))<>'gasoline'");
    const before=[fingerprint(db,timed),fingerprint(db,electric)];
    db.exec(MIGRATION);
    assert.deepEqual([fingerprint(db,timed),fingerprint(db,electric)],before);
    assert.equal(db.prepare(timed.sql).all(...timed.params).length,0);
    assert.equal(db.prepare(electric.sql).all(...electric.params).length,0);
    assert.match(explain(db,timed).join('\n'),/idx_listings_public_timed_recent/);
  } finally {db.close();}
});
