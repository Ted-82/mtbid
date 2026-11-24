'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {buildPublicCatalogMerge,PUBLIC_COLUMNS}=require('../scripts/public-catalog-merge.cjs');
const schema=fs.readFileSync(path.join(__dirname,'../docs/proposals/0004_d1_sync_2.sql'),'utf8');
const OLD='2026-10-03T10:00:00.000Z',NEW='2026-10-08T11:00:00.000Z',CAPTURED='2026-10-08T12:00:00.000Z';
function database(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');db.exec(schema);return db;}
function columns(db){return Object.fromEntries(Object.keys(PUBLIC_COLUMNS).map(table=>[table,db.prepare('PRAGMA table_info('+table+')').all()]));}
function empty(){return Object.fromEntries(Object.keys(PUBLIC_COLUMNS).map(table=>[table,[]]));}
function fixture(platform='copart',lot='12345678',when=NEW){
  const source_key='source:'+platform+':'+lot,listing_id='listing:'+platform+':'+lot;
  return {vehicle_sources:[{source_key,provider:'apibara',platform,provider_vehicle_id:'vehicle:'+lot,identity_kind:'provider_vehicle_id',identity_state:'resolved',entity_id:null,source_updated_at:when,first_seen_at:OLD,last_seen_at:when,normalizer_version:1,created_at:OLD,updated_at:when}],
    auction_listings:[{listing_id,source_key,platform,listing_identity_kind:'source_listing_id',identity_state:'resolved',source_listing_id:lot,listing_generation:null,vin_normalized:'5YJ3E1EA0LF000001',lot,vehicle_title:'Tesla Model 3',make:'Tesla',model:'Model 3',year:2020,auction_state:'open',source_status:'Open',auction_at:'2026-10-10T11:00:00.000Z',is_timed:0,timed_end_at:null,current_bid_usd:5000,current_bid2_usd:null,buy_now_usd:8000,price_currency:'USD',media_urls_json:JSON.stringify(['https://media.example/car.jpg']),media_thumbs_json:null,source_updated_at:when,first_seen_at:OLD,last_seen_at:when,summary_synced_at:when,detail_synced_at:OLD,freshness_class:'warm',normalizer_version:1,created_at:OLD,updated_at:when}],
    auction_listing_snapshots:[{snapshot_id:5,listing_id,observed_at:when,auction_state:'open',auction_at:'2026-10-10T11:00:00.000Z',timed_end_at:null,current_bid_usd:5000,buy_now_usd:8000,fingerprint:'price-'+when,normalizer_version:1}],
    auction_events:[{event_id:'event:'+platform+':'+lot,listing_id,source_key,provider:'apibara',platform,vin_normalized:'5YJ3E1EA0LF000001',lot,sale_date:'2026-10-01',source_status:'not_sold',canonical_status:'not_sold',current_bid_usd:4100,buy_now_usd:null,source_price_usd:4100,final_price_usd:null,observed_at:OLD,identity_state:'resolved',created_at:OLD,updated_at:OLD}]};
}
function combine(...inputs){return Object.fromEntries(Object.keys(PUBLIC_COLUMNS).map(table=>[table,inputs.flatMap(input=>input[table])]));}
function read(db){return Object.fromEntries(Object.keys(PUBLIC_COLUMNS).map(table=>[table,db.prepare('SELECT '+PUBLIC_COLUMNS[table].join(',')+' FROM '+table).all()]));}
function execute(db,plan){for(const group of plan.groups){db.exec('BEGIN');try{for(const item of group.statements)db.prepare(item.sql).run(...item.params);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}}
function plan(db,tables,options={}){return buildPublicCatalogMerge({tables,columns:columns(db),existingTables:read(db),capturedAt:CAPTURED,...options});}
function seed(db,tables){execute(db,plan(db,tables));}
function preserved(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('vehicle_sources','auction_listings','auction_listing_snapshots','auction_events','sqlite_sequence') ORDER BY name").all()
  .map(({name})=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]);}

test('new unconfirmed transaction clears the previous sale price; exact delta replay writes nothing',()=>{
 const db=database();try{
  seed(db,fixture('iaai','45674212',OLD));db.exec('UPDATE auction_listings SET final_price_usd=5000,source_price_usd=5000');
  const incoming=fixture('iaai','45674212',NEW);Object.assign(incoming.auction_listings[0],{final_price_usd:null,source_price_usd:null,source_status:'Sold on Approval'});
  execute(db,plan(db,incoming,{deltaOnly:true}));
  const actual=db.prepare('SELECT final_price_usd,source_price_usd,source_status FROM auction_listings').get();assert.equal(actual.final_price_usd,null);assert.equal(actual.source_price_usd,null);assert.equal(actual.source_status,'Sold on Approval');
  const replay=plan(db,read(db),{deltaOnly:true});assert.equal(replay.statements.length,0);assert.equal(replay.groups.length,0);
 }finally{db.close();}
});

test('new Copart/IAAI listings transfer atomically with prices, media and original observation times',()=>{
  const db=database();try{const source=combine(fixture(),fixture('iaai','87654321'));
    source.auction_listing_snapshots[1].snapshot_id=6;
    const before=JSON.stringify(source),transfer=plan(db,source);execute(db,transfer);
    assert.equal(JSON.stringify(source),before);assert.equal(transfer.groups.length,2);
    assert.equal(transfer.manifest.provider_requests,0);assert.equal(transfer.manifest.catalog_complete,false);
    assert.equal(transfer.manifest.accounts_included,false);assert.equal(transfer.manifest.operational_state_included,false);
    const rows=read(db);assert.equal(rows.auction_listings.length,2);assert.equal(rows.auction_listing_snapshots.length,2);
    for(const row of rows.auction_listings){assert.equal(row.current_bid_usd,5000);assert.equal(row.buy_now_usd,8000);assert.equal(row.last_seen_at,NEW);assert.equal(row.summary_synced_at,NEW);assert.equal(row.created_at,OLD);assert.equal(row.first_seen_at,OLD);}
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});

test('same platform+LOT upsert keeps entity, first seen and operational/private state while clearing missing bids',()=>{
  const db=database();try{seed(db,fixture('copart','12345678',OLD));
    db.prepare("INSERT INTO vehicle_entities(entity_id,identity_state,created_at,updated_at) VALUES('entity-kept','confirmed',?,?)").run(OLD,OLD);
    db.exec("UPDATE vehicle_sources SET entity_id='entity-kept',lease_owner='lease-kept',sync_status='failed',failure_count=3,last_error_code='error-kept',last_success_at='2001-01-01T00:00:00.000Z'");
    db.exec("UPDATE auction_listings SET next_refresh_at='2030-01-01T00:00:00.000Z'");
    db.prepare("INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,updated_at) VALUES('scope-kept','apibara','copart','discovery','partial','cursor-kept',?)").run(OLD);
    db.prepare("INSERT INTO provider_request_budgets(provider,budget_day,normal_limit,normal_consumed,retry_limit,updated_at) VALUES('apibara','kept',1000,211,0,?)").run(OLD);
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,mfa TEXT); INSERT INTO users VALUES('account','private@email','mfa-kept'); CREATE TABLE user_favorites(id INTEGER PRIMARY KEY,listing_id TEXT); INSERT INTO user_favorites VALUES(1,'listing:copart:12345678'); CREATE TABLE import_order_messages(id TEXT PRIMARY KEY,body TEXT,read_at TEXT); INSERT INTO import_order_messages VALUES('message','private body',NULL)");
    const stateBefore=JSON.stringify(preserved(db)),sourceBefore=db.prepare('SELECT * FROM vehicle_sources').get();
    const fresh=fixture();fresh.vehicle_sources[0].first_seen_at=NEW;fresh.vehicle_sources[0].created_at=NEW;
    fresh.vehicle_sources[0].entity_id='publication-unrelated';fresh.vehicle_sources[0].lease_owner='unsafe';
    fresh.auction_listings[0].first_seen_at=NEW;fresh.auction_listings[0].created_at=NEW;fresh.auction_listings[0].current_bid_usd=null;delete fresh.auction_listings[0].current_bid2_usd;fresh.auction_listings[0].buy_now_usd=null;
    fresh.users=[{email:'never include'}];fresh.provider_sync_scopes=[{scope_key:'never include'}];fresh.provider_request_budgets=[{provider:'never include'}];
    const transfer=plan(db,fresh);execute(db,transfer);
    const sourceAfter=db.prepare('SELECT * FROM vehicle_sources').get(),listing=db.prepare('SELECT * FROM auction_listings').get();
    assert.equal(sourceAfter.entity_id,'entity-kept');assert.equal(sourceAfter.first_seen_at,OLD);assert.equal(sourceAfter.created_at,OLD);
    for(const field of ['lease_owner','sync_status','failure_count','last_error_code','last_success_at'])assert.equal(sourceAfter[field],sourceBefore[field]);
    assert.equal(listing.first_seen_at,OLD);assert.equal(listing.created_at,OLD);assert.equal(listing.next_refresh_at,'2030-01-01T00:00:00.000Z');
    assert.equal(listing.current_bid_usd,null);assert.equal(listing.current_bid2_usd,null);assert.equal(listing.buy_now_usd,null);assert.equal(listing.summary_synced_at,NEW);
    assert.equal(JSON.stringify(preserved(db)),stateBefore);
    assert.ok(transfer.statements.every(item=>Object.hasOwn(PUBLIC_COLUMNS,item.table)));
  }finally{db.close();}
});

test('snapshot local IDs never replace staging history, repeated transfer is idempotent and price reversions append',()=>{
  const db=database();try{const old=fixture('copart','12345678',OLD);seed(db,old);
    const stagingId=db.prepare('SELECT snapshot_id FROM auction_listing_snapshots').get().snapshot_id;
    const fresh=fixture();fresh.auction_listing_snapshots[0].snapshot_id=stagingId;
    let transfer=plan(db,fresh);execute(db,transfer);execute(db,transfer);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM auction_events').get().n,1);
    const later='2026-10-08T11:30:00.000Z',reverted=fixture('copart','12345678',later);
    reverted.auction_listing_snapshots[0].fingerprint=old.auction_listing_snapshots[0].fingerprint;
    transfer=plan(db,reverted);execute(db,transfer);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,3);
    assert.ok(transfer.statements.filter(item=>item.table==='auction_listing_snapshots').every(item=>!item.columns.includes('snapshot_id')));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});

test('older observation or source version cannot restamp current rows, and historical observations may still append',()=>{
  const db=database();try{seed(db,fixture());const before=db.prepare('SELECT * FROM auction_listings').get();
    const older=fixture('copart','12345678',OLD);older.auction_listings[0].current_bid_usd=1;older.auction_listings[0].buy_now_usd=2;
    const transfer=plan(db,older);assert.equal(transfer.manifest.listing_updates_skipped_as_older,1);execute(db,transfer);
    assert.deepEqual(db.prepare('SELECT * FROM auction_listings').get(),before);
    assert.equal(db.prepare('SELECT last_seen_at FROM vehicle_sources').get().last_seen_at,NEW);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,2);
    const sameTime=fixture();sameTime.auction_listings[0].source_updated_at=OLD;sameTime.auction_listings[0].current_bid_usd=3;
    const versionPlan=plan(db,sameTime);execute(db,versionPlan);assert.deepEqual(db.prepare('SELECT * FROM auction_listings').get(),before);
  }finally{db.close();}
});

test('newer target detail receipt protects the full listing even when its summary receipt is older',()=>{
  const db=database();try{seed(db,fixture('copart','12345678',OLD));
    const detailTime='2026-10-08T11:30:00.000Z';
    db.prepare('UPDATE auction_listings SET detail_synced_at=?,current_bid_usd=?,buy_now_usd=?,vehicle_title=?,media_urls_json=?')
      .run(detailTime,9700,12000,'Newer detail title',JSON.stringify(['https://media.example/newer-detail.jpg']));
    const before=db.prepare('SELECT * FROM auction_listings').get(),transfer=plan(db,fixture());
    assert.equal(transfer.manifest.listing_updates_skipped_as_older,1);execute(db,transfer);
    assert.deepEqual(db.prepare('SELECT * FROM auction_listings').get(),before);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,2);
  }finally{db.close();}
});

test('newer summary updates prices while keeping the latest actual detail receipt; null does not restamp details',()=>{
  const db=database();try{seed(db,fixture('copart','12345678',OLD));
    const detailTime='2026-10-08T10:30:00.000Z';db.prepare('UPDATE auction_listings SET detail_synced_at=?').run(detailTime);
    const newerSummary=fixture();newerSummary.auction_listings[0].detail_synced_at=OLD;
    execute(db,plan(db,newerSummary));let row=db.prepare('SELECT * FROM auction_listings').get();
    assert.equal(row.summary_synced_at,NEW);assert.equal(row.current_bid_usd,5000);assert.equal(row.detail_synced_at,detailTime);
    const withNoDetail=fixture('copart','12345678','2026-10-08T11:10:00.000Z');withNoDetail.auction_listings[0].detail_synced_at=null;
    execute(db,plan(db,withNoDetail));row=db.prepare('SELECT * FROM auction_listings').get();assert.equal(row.detail_synced_at,detailTime);
    const newerDetail=fixture('copart','12345678','2026-10-08T11:20:00.000Z');newerDetail.auction_listings[0].detail_synced_at='2026-10-08T11:15:00.000Z';
    execute(db,plan(db,newerDetail));row=db.prepare('SELECT * FROM auction_listings').get();assert.equal(row.detail_synced_at,'2026-10-08T11:15:00.000Z');
  }finally{db.close();}
});

test('detail receipt protection also applies when another writer advances detail after the offline plan',()=>{
  const db=database();try{seed(db,fixture('copart','12345678',OLD));const transfer=plan(db,fixture());
    db.prepare('UPDATE auction_listings SET detail_synced_at=?,current_bid_usd=?').run('2026-10-08T11:30:00.000Z',9700);
    const before=db.prepare('SELECT * FROM auction_listings').get();execute(db,transfer);
    assert.deepEqual(db.prepare('SELECT * FROM auction_listings').get(),before);
  }finally{db.close();}
});

test('identity conflicts and divergent snapshots/events stop offline before any statement executes',()=>{
  const db=database();try{seed(db,fixture());
    for(const [mutate,expected] of [
      [input=>{input.auction_listings[0].listing_id='other';input.auction_listing_snapshots[0].listing_id='other';input.auction_events[0].listing_id='other';},/LISTING_IDENTITY_MISMATCH/],
      [input=>{input.auction_listings[0].lot='99999999';input.auction_events[0].lot='99999999';},/LISTING_IDENTITY_MISMATCH/],
      [input=>input.auction_listings[0].vin_normalized='5YJ3E1EA0LF000002',/VIN_MISMATCH/],
      [input=>input.auction_listing_snapshots[0].current_bid_usd=999,/SNAPSHOT_CONFLICT/],
      [input=>input.auction_events[0].final_price_usd=999,/EVENT_CONFLICT/]
    ]){const input=fixture(),before=JSON.stringify(read(db));mutate(input);assert.throws(()=>plan(db,input),expected);assert.equal(JSON.stringify(read(db)),before);}
    const duplicate=combine(fixture(),fixture());duplicate.auction_listings[1].listing_id='different';duplicate.vehicle_sources=[];
    assert.throws(()=>plan(db,duplicate),/publiczny snapshot/);
  }finally{db.close();}
});

test('same VIN across distinct lots and same LOT across platforms retain separate identities',()=>{
  const db=database();try{const input=combine(fixture(),fixture('iaai','12345678'),fixture('copart','87654321'));
    input.auction_listing_snapshots.forEach((row,index)=>row.snapshot_id=index+100);
    execute(db,plan(db,input));assert.equal(db.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,3);
    assert.equal(db.prepare('SELECT COUNT(DISTINCT vin_normalized) n FROM auction_listings').get().n,1);
  }finally{db.close();}
});

test('a failing atomic group leaves no partial source, listing or history and can be retried',()=>{
  const db=database();try{const transfer=plan(db,fixture()),broken=structuredClone(transfer);
    broken.groups[0].statements.splice(2,0,{sql:'INSERT INTO missing_table VALUES(1)',params:[]});
    assert.throws(()=>execute(db,broken),/no such table/);
    assert.deepEqual(Object.fromEntries(Object.entries(read(db)).map(([table,rows])=>[table,rows.length])),{vehicle_sources:0,auction_listings:0,auction_listing_snapshots:0,auction_events:0});
    execute(db,transfer);assert.equal(db.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,1);
  }finally{db.close();}
});

test('long histories split into bounded repeatable atomic groups and bound all SQL values',()=>{
  const db=database();try{const input=fixture();input.auction_listings[0].vehicle_title="Tesla'); DROP TABLE users; --";
    input.auction_listing_snapshots=Array.from({length:12},(_,index)=>({...input.auction_listing_snapshots[0],snapshot_id:index+1,observed_at:new Date(Date.parse(OLD)+index*1000).toISOString(),fingerprint:'history-'+index}));
    const transfer=plan(db,input,{maxStatementsPerGroup:5});assert.ok(transfer.groups.length>1);assert.ok(transfer.groups.every(group=>group.statements.length<=5));
    for(const statement of transfer.statements){assert.equal((statement.sql.match(/\?/g)||[]).length,statement.params.length);assert.doesNotMatch(statement.sql,/DROP TABLE/);}
    execute(db,transfer);execute(db,transfer);assert.equal(db.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,12);
    assert.equal(db.prepare('SELECT vehicle_title FROM auction_listings').get().vehicle_title,input.auction_listings[0].vehicle_title);
  }finally{db.close();}
});

test('offline plan requires full source/target table sets, has stable hashes and never fetches or copies scopes',()=>{
  const db=database(),saved=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw new Error('network forbidden');};
  try{const input=fixture(),first=plan(db,input),second=plan(db,input);assert.deepEqual(first,second);assert.equal(calls,0);
    assert.equal(first.groups[0].sha256.length,64);assert.equal(first.manifest.plan_sha256.length,64);
    assert.throws(()=>buildPublicCatalogMerge({tables:input,columns:columns(db),capturedAt:CAPTURED}),/FOUR_TABLES_REQUIRED/);
    assert.throws(()=>plan(db,input,{maxStatementsPerGroup:2}),/INVALID_GROUP_LIMIT/);
    const clear=plan(db,empty());assert.equal(clear.groups.length,0);assert.equal(clear.manifest.catalog_complete,false);
    assert.doesNotMatch(JSON.stringify(first),/INSERT INTO provider_sync_scopes|provider_request_budgets|sync_runs|lease_owner/);
  }finally{globalThis.fetch=saved;db.close();}
});
