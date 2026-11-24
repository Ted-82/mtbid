'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createApibaraProvider}=require('../providers/apibara.js');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {prepareInventoryPage}=require('../sync/inventory-page.cjs');
const {commitInventoryBatch}=require('../sync/inventory-commit.cjs');
const {selectFeedRecordHydration,applyFeedRecordHydration}=require('../sync/feed-record-hydration.cjs');
const NOW=Date.parse('2026-10-29T12:00:00.000Z'),AT=new Date(NOW).toISOString(),OLD='2026-10-28T10:00:00.000Z';
const UPDATED='2026-10-29T10:00:00.000Z',VIN='1HGCM82633A004352',OTHER_VIN='SALZP2FX8PH185647',LOT='10000001';
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8')).response.data[0];
const provider=createApibaraProvider({fetch:async()=>{throw Error('NETWORK_FORBIDDEN');}});
const freshnessPolicy={hotIntervalMs:3600000,warmIntervalMs:86400000,coldIntervalMs:604800000,hotWindowMs:3600000};
const key=part=>`file-hydration:${'d'.repeat(64)}:0:${part}`;
function record(lot=LOT,updated=UPDATED){
 const raw=structuredClone(fixture);Object.assign(raw,{vehicle_id:`synthetic-${lot}`,lot_number:lot,platform:'iaai',vin:VIN,updated_at:updated});
 raw.auction.state='open';raw.pricing={current_bid_usd:200,current_bid2_usd:null,buy_now_usd:6200};return raw;
}
function event(sequence=1,raw=record(),extra={}){
 return{sequence,event_id:`chg_${sequence}`,event:'lot.created',terminal:false,vehicle:{platform:'iaai',lot_number:raw.lot_number,vin:VIN},
  changed_fields:['lot.created'],before:[],after:{'vehicle.make':raw.make},record:raw,recorded_at:'2026-10-29T09:00:00.000Z',
  vehicle_updated_at:'2026-10-29T08:00:00.000Z',...extra};
}
const group=events=>({platform:events[0].vehicle.platform,lot:events[0].vehicle.lot_number,events,quarantinedSequences:[]});
function database(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 const calls={reads:0,batches:[],beforeBatch:null,fault:null,timeoutAfterCommit:false};
 const db={prepare(sql){return{bind(...params){return{sql,params,
  async all(){calls.reads++;return{results:sqlite.prepare(sql).all(...params)};},
  async first(){calls.reads++;return sqlite.prepare(sql).get(...params)||null;},
  async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}};}};},async batch(statements){
  calls.batches.push(statements);await calls.beforeBatch?.();sqlite.exec('BEGIN IMMEDIATE');
  try{const result=statements.map(item=>{if(calls.fault?.(item))throw Error('INJECTED_DATABASE_FAILURE');return{meta:{changes:Number(sqlite.prepare(item.sql).run(...item.params).changes)}};});
   sqlite.exec('COMMIT');if(calls.timeoutAfterCommit)throw Error('SIMULATED_TRANSPORT_TIMEOUT');return result;
  }catch(error){if(!calls.timeoutAfterCommit)sqlite.exec('ROLLBACK');throw error;}
 }};
 return{sqlite,db,calls,store:new RefreshStore(db,'hydration-test',()=>NOW)};
}
async function seed(env,raw=record(LOT,OLD)){
 const plan=await prepareInventoryPage({db:env.db,provider,records:[raw],observedAt:raw.updated_at,processedAt:AT,freshnessPolicy,observationTimeBasis:'source_updated_at'});
 assert.equal(plan.rejected.length,0);await commitInventoryBatch({db:env.db,store:env.store,prepared:plan.prepared});
}
const apply=(env,groups=[group([event()])],options={})=>applyFeedRecordHydration({db:env.db,store:env.store,provider,groups,
 observedAt:AT,receiptKey:key(0),freshnessPolicy,...options});
const listing=env=>({...env.sqlite.prepare('SELECT * FROM auction_listings ORDER BY lot').get()});
const count=(env,name)=>env.sqlite.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n;
function clean(env){assert.equal(count(env,'sync_batch_guards'),0);assert.equal(count(env,'automatic_refresh_guards'),0);assert.deepEqual(env.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);}

test('newest source record wins within ordered complete group even when newer than event vehicle time',()=>{
 const old=record(LOT,OLD),latest=record(LOT,'2026-10-29T12:00:00+02:00'),middle=record(LOT,'2026-10-29T09:30:00Z');
 const groups=[group([event(1,old),event(2,latest),event(3,middle)])],original=structuredClone(groups);
 const selected=selectFeedRecordHydration({groups,observedAt:AT});assert.equal(selected.candidates.length,1);
 assert.equal(selected.candidates[0].eventSequence,2);assert.equal(selected.candidates[0].sourceUpdatedAt,UPDATED);
 assert.equal(selected.candidates[0].record.updated_at,UPDATED);assert.deepEqual(groups,original);
});

test('record/event VIN, platform, LOT, malformed later VIN or quarantine suppress every candidate in the group',()=>{
 for(const kind of ['record-vin','record-platform','record-lot','later-vin','malformed-vin','quarantine','same-version']){
  const first=event(),second=event(2);const groups=[group([first,second])];
  if(kind==='record-vin')second.record.vin=OTHER_VIN;
  if(kind==='record-platform')second.record.platform='copart';
  if(kind==='record-lot')second.record.lot_number='99999999';
  if(kind==='later-vin')second.vehicle.vin=OTHER_VIN;
  if(kind==='malformed-vin')second.vehicle.vin=123;
  if(kind==='quarantine'){second.vehicle.vin='BAD\u001aVIN';groups[0].quarantinedSequences=[2];}
  if(kind==='same-version')second.record.pricing.current_bid_usd=300;
  const selected=selectFeedRecordHydration({groups,observedAt:AT});assert.equal(selected.candidates.length,0);assert.equal(selected.quarantined.length,1);
 }
});

test('naive, future and invalid calendar times and incomplete prices cannot become full observations',()=>{
 for(const updated of ['2026-10-29 10:00:00','2026-10-30T10:00:00Z','2026-02-30T10:00:00Z']){
  const selected=selectFeedRecordHydration({groups:[group([event(1,record(LOT,updated))])],observedAt:AT});
  assert.equal(selected.candidates.length,0);assert.equal(selected.skipped[0].reason,'invalid_record_time');
 }
 const incomplete=record();delete incomplete.pricing.current_bid2_usd;
 const selected=selectFeedRecordHydration({groups:[group([event(1,incomplete)])],observedAt:AT});
 assert.equal(selected.candidates.length,0);assert.equal(selected.skipped[0].reason,'incomplete_record');
 const ordinary=event(1,record(),{event:'bid.changed',changed_fields:['pricing.current_bid_usd'],before:{},after:{'pricing.current_bid_usd':500}});
 assert.equal(selectFeedRecordHydration({groups:[group([ordinary])],observedAt:AT}).candidates.length,0);
});

test('20 full records use bounded existing writer plus one immutable marker and never establish a stream cursor',async t=>{
 const env=database(t);await env.store.acquire();const groups=Array.from({length:20},(_,i)=>group([event(i+1,record(String(10000000+i)))]));
 const result=await apply(env,groups);assert.equal(result.inserted,20);assert.equal(result.updated,0);assert.equal(result.committed.statementCount,67);
 assert.equal(env.calls.batches.length,1);assert.equal(env.calls.batches[0].length,67);assert.equal(count(env,'auction_listings'),20);
 assert.equal(count(env,'auction_listing_snapshots'),20);assert.equal(count(env,'automatic_refresh_tasks'),1);
 assert.equal(listing(env).source_updated_at,UPDATED);assert.equal(listing(env).summary_synced_at,UPDATED);assert.equal(result.globalCursorEstablished,false);
 clean(env);await assert.rejects(apply(env,[...groups,group([event(21,record('10000021'))])]),/GROUPS_INVALID/);
});

test('same marker retry is one read and no mutation after later partial price changes',async t=>{
 const env=database(t);await env.store.acquire();const groups=[group([event()])];await apply(env,groups);
 env.sqlite.exec('UPDATE auction_listings SET current_bid_usd=999');const before=listing(env),batches=env.calls.batches.length,reads=env.calls.reads;
 const replay=await apply(env,groups);assert.equal(replay.alreadyApplied,true);assert.equal(env.calls.reads-reads,1);
 assert.equal(env.calls.batches.length,batches);assert.deepEqual(listing(env),before);assert.equal(count(env,'auction_listing_snapshots'),1);
 const other=await apply(env,groups,{receiptKey:key(1)});assert.equal(other.updated,0);assert.equal(other.skipped[0].reason,'source_version_already_observed');
 assert.deepEqual(listing(env),before);assert.equal(count(env,'auction_listing_snapshots'),1);clean(env);
});

test('timeout after successful commit is safely retried through the durable hydration marker',async t=>{
 const env=database(t);await env.store.acquire();env.calls.timeoutAfterCommit=true;
 await assert.rejects(apply(env),/COMMIT_FAILED/);assert.equal(count(env,'auction_listings'),1);assert.equal(count(env,'automatic_refresh_tasks'),1);
 env.calls.timeoutAfterCommit=false;env.sqlite.exec('UPDATE auction_listings SET current_bid_usd=777');
 const batches=env.calls.batches.length;assert.equal((await apply(env)).alreadyApplied,true);assert.equal(env.calls.batches.length,batches);
 assert.equal(listing(env).current_bid_usd,777);assert.equal(count(env,'auction_listing_snapshots'),1);clean(env);
});

test('missing media and descriptive enrichment cannot erase an existing full listing',async t=>{
 const env=database(t);await env.store.acquire();await seed(env);const previous=listing(env);
 const sparse=record();delete sparse.media;delete sparse.seller;delete sparse.condition;delete sparse.sale_document;
 sparse.pricing.current_bid_usd=300;const result=await apply(env,[group([event(1,sparse)])]);assert.equal(result.updated,1);
 const actual=listing(env);for(const key of ['media_urls_json','media_thumbs_json','seller_name','seller_type','primary_damage','document_name'])assert.equal(actual[key],previous[key]);
 assert.equal(actual.current_bid_usd,300);assert.equal(actual.summary_synced_at,UPDATED);clean(env);
});

test('older full records and newer detail observations never regress local data',async t=>{
 for(const kind of ['full','detail']){
  const env=database(t);await env.store.acquire();await seed(env,record(LOT,kind==='full'?'2026-10-29T11:00:00.000Z':OLD));
  if(kind==='detail')env.sqlite.prepare('UPDATE auction_listings SET detail_synced_at=?,current_bid_usd=900').run(AT);
  const previous=listing(env),snapshots=count(env,'auction_listing_snapshots');const result=await apply(env);
  assert.equal(result.updated,0);assert.equal(result.skipped.length,1);assert.deepEqual(listing(env),previous);
  assert.equal(count(env,'auction_listing_snapshots'),snapshots);clean(env);
 }
});

test('conflicting existing VIN or non-apibara source is durably quarantined without replacing the listing',async t=>{
 for(const kind of ['vin','source']){
  const env=database(t);await env.store.acquire();await seed(env);
  if(kind==='vin')env.sqlite.prepare('UPDATE auction_listings SET vin_normalized=?').run(OTHER_VIN);
  else env.sqlite.exec("UPDATE vehicle_sources SET provider='other'");
  const before=listing(env),result=await apply(env);assert.equal(result.updated,0);assert.equal(result.quarantined.length,1);
  assert.deepEqual(listing(env),before);const marker=JSON.parse(env.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(key(0)).cursor);
  assert.equal(marker.result.quarantined.length,1);clean(env);
 }
});

test('a concurrent exterior color observation invalidates the upgraded hydration baseline',async t=>{
 const env=database(t);
 env.sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0019_catalog_exterior_color.sql'),'utf8'));
 await env.store.acquire();await seed(env);
 env.calls.beforeBatch=()=>env.sqlite.prepare('UPDATE auction_listings SET exterior_color=?').run('Gray');
 await assert.rejects(apply(env),/STALE_BASELINE/);assert.equal(listing(env).exterior_color,'Gray');clean(env);
});

test('a concurrent partial-price or media update cancels hydration despite unchanged full-record timestamps',async t=>{
 for(const [field,value] of [['current_bid_usd',999],['media_urls_json','["https://example.invalid/newer.jpg"]']]){
  const env=database(t);await env.store.acquire();await seed(env);const snapshots=count(env,'auction_listing_snapshots');
  env.calls.beforeBatch=()=>env.sqlite.prepare(`UPDATE auction_listings SET ${field}=?`).run(value);
  await assert.rejects(apply(env),/STALE_BASELINE/);assert.equal(listing(env)[field],value);assert.equal(listing(env).summary_synced_at,OLD);
  assert.equal(count(env,'automatic_refresh_tasks'),0);assert.equal(count(env,'auction_listing_snapshots'),snapshots);clean(env);
 }
});

test('caller checkpoint failure and stale lease roll back source, listing, snapshot and receipt together',async t=>{
 const env=database(t);await env.store.acquire();
 const checkpoint=env.db.prepare("INSERT INTO sync_batch_guards(guard_id,allowed) VALUES('caller',0)").bind();
 await assert.rejects(apply(env,undefined,{checkpointStatements:[checkpoint]}),/STALE_BASELINE/);
 for(const table of ['vehicle_sources','auction_listings','auction_listing_snapshots','automatic_refresh_tasks'])assert.equal(count(env,table),0);clean(env);
 env.sqlite.exec("UPDATE automatic_refresh_state SET lease_owner='other'");await assert.rejects(apply(env),/LEASE_REJECTED/);
 assert.equal(count(env,'auction_listings'),0);assert.equal(count(env,'automatic_refresh_tasks'),0);clean(env);
});

test('changed receipt input, unsafe keys, duplicated groups and out-of-order events fail closed',async t=>{
 const env=database(t);await env.store.acquire();await apply(env);const changed=record();changed.pricing.current_bid_usd=900;
 await assert.rejects(apply(env,[group([event(1,changed)])]),/RECEIPT_INVALID/);
 await assert.rejects(apply(env,undefined,{receiptKey:'stream:changes'}),/CONFIG_INVALID/);
 for(const groups of [[group([event(2),event(1)])],[group([event()]),group([event(2)])]])assert.throws(()=>selectFeedRecordHydration({groups,observedAt:AT}),/GROUP.*INVALID/);
 const marker=JSON.parse(env.sqlite.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(key(0)).cursor);
 marker.result.inserted=0;env.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(marker),key(0));
 await assert.rejects(apply(env),/RECEIPT_INVALID/);
 assert.equal(listing(env).current_bid_usd,200);clean(env);
});
