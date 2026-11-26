'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {FeedBootstrapMembership}=require('../sync/feed-bootstrap-membership.cjs');
const {replayBootstrapPage}=require('../sync/feed-bootstrap-replay.cjs');
const NOW=Date.parse('2026-11-01T12:00:00.000Z'),AT=new Date(NOW).toISOString(),OLD='2026-10-31T12:00:00.000Z';
const EVENT='2026-11-01T11:00:00.000Z',VIN='1HGCM82633A004352',LOT='10000001';
const fullFixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8')).response.data[0];
function event(sequence=101,lot=LOT,extra={}){return {sequence,event_id:`event-${sequence}`,event:'bid.changed',terminal:false,
 vehicle:{platform:'copart',lot_number:lot,vin:VIN},changed_fields:['pricing.current_bid_usd'],before:{},
 after:{'pricing.current_bid_usd':sequence+1000},recorded_at:EVENT,vehicle_updated_at:EVENT,...extra};}
function created(sequence=101,lot=LOT,extra={}){const record=structuredClone(fullFixture);
 Object.assign(record,{vehicle_id:`bootstrap-${lot}`,platform:'copart',lot_number:lot,vin:VIN,updated_at:EVENT});
 record.auction.state='open';record.pricing={current_bid_usd:200,current_bid2_usd:null,buy_now_usd:6200};
 return event(sequence,lot,{event:'lot.created',changed_fields:['lot.created'],before:[],after:{},record,...extra});}
function page(events=[event()],meta={}){return {ok:true,data:events,meta:{after:100,next_cursor:events.at(-1)?.sequence??100,
 has_more:false,count:events.length,ordering:'sequence_asc',schema_version:'test',retention_days:14,
 oldest_available_sequence:1,latest_available_sequence:events.at(-1)?.sequence??100,...meta}};}
function baseline(){return {version:1,baselineId:'fresh-1',scope:'staging',
 sourceEvidence:{kind:'provider-checkpoint',sha256:'d'.repeat(64),replayStartSequence:100,snapshotSha256:'b'.repeat(64)},
 capture:{sequence:100,capturedAt:OLD,responseSha256:'a'.repeat(64)},snapshot:{generationId:7001,sha256:'b'.repeat(64),records:1,
 requestStartedAt:OLD,observedAt:OLD,generatedAtKnown:false,generatedAt:null}};}
async function harness(t,response=page(),bounded=false){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql','0014_feed_catalog_membership.sql'])
  sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 sqlite.prepare('INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,77,?,?)').run('{}',OLD);
 sqlite.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,status) VALUES('stream:changes','all','55',?,'complete')").run(OLD);
 const calls={requests:[],batches:[],before:null,after:null,fault:null,clock:NOW,sql:0};
 const db={prepare(sql){return{bind(...params){return{sql,params,
  async first(){calls.sql++;return sqlite.prepare(sql).get(...params)||null;},async all(){calls.sql++;return{results:sqlite.prepare(sql).all(...params)};},
  async run(){calls.sql++;return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}};}};},async batch(statements){
   calls.sql+=statements.length;calls.batches.push(statements);await calls.before?.(statements);sqlite.exec('BEGIN IMMEDIATE');
   let out;try{out=statements.map(s=>{if(calls.fault?.(s))throw Error('INJECTED');return{meta:{changes:Number(sqlite.prepare(s.sql).run(...s.params).changes)}};});sqlite.exec('COMMIT');}
   catch(e){sqlite.exec('ROLLBACK');throw e;}await calls.after?.(statements);return out;
  }};
 const objects=new Map(),bucket={async put(key,bytes,options){assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});if(objects.has(key))return null;objects.set(key,Buffer.from(bytes));return{key};},
  async get(key){const bytes=objects.get(key);if(!bytes)return null;return{size:bytes.length,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(bytes));c.close();}})};}};
 const store=new RefreshStore(db,'replay-test',()=>calls.clock);assert.equal(await store.acquire(),true);
 const membership=new FeedBootstrapMembership({db,store});const sourcePlan=baseline();if(bounded){sourcePlan.capture={sequence:100,capturedAt:null,capturedNoLaterThan:OLD,timeBasis:'provider-before-start-bound',responseSha256:'a'.repeat(64)};Object.assign(sourcePlan.snapshot,{generatedAtKnown:true,generatedAt:EVENT});}await membership.begin(sourcePlan);
 const h={sqlite,db,store,membership,bucket,objects,calls,response,
  async request(spec){calls.requests.push(spec);if(h.error)throw h.error;return{response:h.response,observedAt:AT};}};
 seed(h);const row=identity(LOT);await store.guarded((await membership.snapshotStatements({baselineId:'fresh-1',offset:0,endOffset:1,batchSha256:'c'.repeat(64),resolved:[row]})).statements);
 calls.sql=0;calls.batches=[];return h;
}
function identity(lot){return{listingId:`listing-${lot}`,sourceKey:`source-${lot}`,platform:'copart',lot,vin:VIN};}
function seed(h,lot=LOT,changes={}){const row=identity(lot);
 h.sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,identity_state,first_seen_at,last_seen_at,created_at,updated_at)
  VALUES(?,'apibara','copart','resolved',?,?,?,?)`).run(row.sourceKey,OLD,OLD,OLD,OLD);
 const values={listing_id:row.listingId,source_key:row.sourceKey,platform:'copart',lot,vin_normalized:VIN,identity_state:'resolved',
  source_updated_at:OLD,summary_synced_at:OLD,detail_synced_at:OLD,first_seen_at:OLD,last_seen_at:OLD,created_at:OLD,updated_at:OLD,
  auction_state:'open',source_status:'Open',current_bid_usd:100,current_bid2_usd:null,buy_now_usd:15000,...changes};
 h.sqlite.prepare(`INSERT INTO auction_listings(${Object.keys(values)}) VALUES(${Object.keys(values).map(()=>'?')})`).run(...Object.values(values));}
const run=(h,sequence=101,extra={})=>replayBootstrapPage({...h,baselineId:'fresh-1',target:{sequence,observedAt:AT,responseSha256:'e'.repeat(64)},...extra});
const state=async h=>(await h.membership.read('fresh-1')).state;
const task=(h,key='bootstrap-replay:fresh-1:page:100')=>h.sqlite.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(key);
const bid=(h,lot=LOT)=>h.sqlite.prepare('SELECT current_bid_usd FROM auction_listings WHERE lot=?').get(lot)?.current_bid_usd;
function clean(h){assert.equal(h.sqlite.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,77);
 assert.equal(task(h,'stream:changes').cursor,'55');assert.equal(h.sqlite.prepare('SELECT baseline_id FROM feed_catalog_pointer').get().baseline_id,null);
 assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 for(const table of ['sync_batch_guards','automatic_refresh_guards'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);}

test('one inclusive head page advances only isolated membership cursor with durable raw and canonical proof',async t=>{
 const h=await harness(t);const result=await run(h);assert.equal(result.complete,true);assert.equal(result.through,101);
 assert.equal(bid(h),1101);assert.equal((await state(h)).replaySequence,101);assert.equal(h.objects.size,1);
 assert.deepEqual(h.calls.requests,[{operation:'vehicleChanges',after:100,limit:100}]);
 assert.equal(task(h).status,'complete');assert.equal(result.proof.batchReceipts.length,2);clean(h);
 h.error=Error('NO_REFETCH');const repeated=await run(h);assert.equal(repeated.complete,true);assert.equal(repeated.requests,0);assert.equal(h.calls.requests.length,1);clean(h);
});
test('empty confirmed head is a successful zero-event replay while no-progress below target is rejected',async t=>{
 const h=await harness(t,page([]));const done=await run(h,100);assert.equal(done.complete,true);assert.equal(done.proof.appliedEvents,0);
 assert.equal((await state(h)).replayVerified,true);assert.equal((await state(h)).replaySequence,100);clean(h);
 const other=await harness(t,page([],{has_more:true,latest_available_sequence:120}));await assert.rejects(run(other,120),e=>e.code==='INVALID_RESPONSE'||/NO_PROGRESS/.test(e.message));
 assert.equal((await state(other)).replaySequence,100);assert.equal((await state(other)).replayVerified,false);clean(other);
});
test('numeric sequence gaps and clipping at frozen target do not consume or apply later events',async t=>{
 const h=await harness(t,page([event(105),event(120)],{next_cursor:120,latest_available_sequence:120}));
 const result=await run(h,110);assert.equal(result.through,110);assert.equal(result.proof.receivedEvents,2);assert.equal(result.proof.appliedEvents,1);
 assert.equal(bid(h),1105);assert.equal((await state(h)).replaySequence,110);clean(h);
});
test('target and source plan remain immutable over multiple pages, without changing the old server cursor',async t=>{
 const h=await harness(t,page([event(101)],{has_more:true,latest_available_sequence:103}));assert.equal((await run(h,103)).complete,false);
 await assert.rejects(run(h,104),/TARGET_CONFLICT/);assert.equal(h.calls.requests.length,1);
 h.response=page([event(103)],{after:101,next_cursor:103,latest_available_sequence:103});const second=await run(h,103);
 assert.equal(second.complete,true);assert.equal((await state(h)).replaySequence,103);assert.equal(bid(h),1103);clean(h);
});
test('missing/expired source prefix and upstream errors never advance or claim empty history',async t=>{
 for(const kind of ['retention','missing-head','upstream']){const h=await harness(t);
  if(kind==='retention')h.response=page([event()],{oldest_available_sequence:102});
  if(kind==='missing-head')h.response=page([event()],{latest_available_sequence:101});
  if(kind==='upstream')h.error=Object.assign(Error('UPSTREAM'),{code:'UPSTREAM'});
  await assert.rejects(run(h,105));assert.equal((await state(h)).replaySequence,100);assert.equal(bid(h),100);assert.equal(task(h),undefined);clean(h);
 }
});
test('lost pending-pointer acknowledgement resumes raw page without a second provider request',async t=>{
 const h=await harness(t);h.calls.after=statements=>{if(statements.some(s=>s.params.includes('bootstrap-replay:fresh-1:page:100')&&s.sql.includes('INSERT INTO automatic_refresh_tasks')))throw Error('ACK_LOST');};
 await assert.rejects(run(h));assert.equal(task(h).status,'pending');assert.equal(bid(h),100);h.calls.after=null;h.error=Error('NO_REFETCH');
 const result=await run(h);assert.equal(result.resumed,true);assert.equal(h.calls.requests.length,1);assert.equal(bid(h),1101);clean(h);
});
test('canonical batch and membership fragment roll back together; completed fragment resumes without double counting',async t=>{
 const h=await harness(t);h.calls.fault=s=>s.sql.startsWith('UPDATE feed_catalog_baselines');
 await assert.rejects(run(h));assert.equal(bid(h),100);assert.equal((await state(h)).pendingDelta,null);
 h.calls.fault=null;h.calls.after=ss=>{if(ss.some(s=>s.sql.startsWith('UPDATE auction_listings')))throw Error('ACK_LOST');};
 await assert.rejects(run(h));assert.equal(bid(h),1101);assert.equal((await state(h)).replaySequence,100);assert.ok((await state(h)).pendingDelta);
 h.calls.after=null;h.error=Error('NO_REFETCH');const resumed=await run(h);assert.equal(resumed.complete,true);
 assert.equal((await state(h)).deltaUnresolved,0);assert.equal(h.calls.requests.length,1);clean(h);
});
test('lost final acknowledgement is proved complete without replay or provider request',async t=>{
 const h=await harness(t);h.calls.after=ss=>{if(ss.some(s=>s.sql.includes("SET status='complete',last_success_at")))throw Error('ACK_LOST');};
 await assert.rejects(run(h));assert.equal((await state(h)).replaySequence,101);assert.equal(task(h).status,'complete');
 h.calls.after=null;h.error=Error('NO_REFETCH');assert.equal((await run(h)).complete,true);assert.equal(h.calls.requests.length,1);clean(h);
});
test('tampering raw data, pointer or receipt stops replay without refetching or clearing pending',async t=>{
 for(const kind of ['raw','pointer','receipt']){const h=await harness(t);h.calls.after=ss=>{if(ss.some(s=>kind==='receipt'?s.sql.startsWith('UPDATE auction_listings'):s.params.includes('bootstrap-replay:fresh-1:page:100')&&s.sql.includes('INSERT INTO automatic_refresh_tasks')))throw Error('ACK_LOST');};
  await assert.rejects(run(h));h.calls.after=null;h.error=Error('NO_REFETCH');
  if(kind==='raw'){const key=[...h.objects.keys()][0];h.objects.set(key,Buffer.from('{}'));}
  if(kind==='pointer'){const p=JSON.parse(task(h).cursor);p.after=99;h.sqlite.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify(p),task(h).task_key);}
  if(kind==='receipt')h.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key GLOB 'server-feed-batch:*'");
  await assert.rejects(run(h));assert.equal((await state(h)).replaySequence,100);assert.equal(task(h).status,'pending');assert.equal(h.calls.requests.length,1);clean(h);
 }
});
test('malformed VIN and unknown LOT remain unresolved; stale bid cannot revive absent old active listing',async t=>{
 const h=await harness(t,page([event(101,LOT,{vehicle:{platform:'copart',lot_number:LOT,vin:'bad'}}),event(102,'10000002'),event(103,'10000003')]));
 seed(h,'10000002');const result=await run(h,103);assert.equal(result.complete,true);assert.ok((await state(h)).deltaUnresolved>=2);
 assert.equal(bid(h),100);assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM feed_catalog_membership WHERE listing_id='listing-10000002'").get().n,0);
 assert.equal(bid(h,'10000003'),undefined);clean(h);
});
test('validated full creation hydrates canonical listing then adds membership, without a direct fetch',async t=>{
 const h=await harness(t,page([created(101,'10000002')]));const result=await run(h);assert.equal(result.complete,true);
 const listing=h.sqlite.prepare("SELECT listing_id FROM auction_listings WHERE lot='10000002'").get();assert.ok(listing);
 assert.equal(h.sqlite.prepare('SELECT active FROM feed_catalog_membership WHERE listing_id=?').get(listing.listing_id).active,1);
 assert.equal(bid(h,'10000002'),200);assert.equal((await state(h)).deltaUnresolved,0);assert.equal(result.proof.batchReceipts.length,3);clean(h);
});
test('hydration is bounded and resumes with preserved raw pointer and no more provider calls',async t=>{
 const h=await harness(t,page(Array.from({length:81},(_,n)=>created(101+n,String(20000000+n)))));
 const one=await run(h,181);assert.equal(one.phase,'hydrate');assert.equal(one.newHydrationGroups,40);assert.equal((await state(h)).replaySequence,100);
 h.error=Error('NO_REFETCH');let result;for(let i=0;i<4;i++){result=await run(h,181);if(result.complete)break;}
 assert.equal(result.complete,true);assert.equal(h.calls.requests.length,1);assert.equal((await state(h)).replaySequence,181);clean(h);
});
test('expired lease or baseline race cannot mutate canonical rows or bootstrap cursor',async t=>{
 const h=await harness(t);h.calls.clock=NOW+11*60000;await assert.rejects(run(h));assert.equal(h.calls.requests.length,0);assert.equal(bid(h),100);clean(h);
 const raced=await harness(t);raced.calls.before=ss=>{if(ss.some(s=>s.sql.startsWith('UPDATE auction_listings'))){raced.sqlite.exec("UPDATE feed_catalog_baselines SET plan_sha256='wrong'");}};
 await assert.rejects(run(raced));assert.equal(bid(raced),100);assert.equal(task(raced).status,'pending');clean(raced);
});
test('strict one-page request bounds and incomplete snapshot fail before provider transport',async t=>{
 const h=await harness(t);for(const options of [{maxPages:2},{maxChangesLimit:1},{maxChangesLimit:2000},{target:{sequence:99,observedAt:AT,responseSha256:'e'.repeat(64)}}])await assert.rejects(run(h,101,options));
 assert.equal(h.calls.requests.length,0);clean(h);
 const incomplete=await harness(t);const row=incomplete.sqlite.prepare('SELECT checkpoint_json FROM feed_catalog_baselines').get();const s=JSON.parse(row.checkpoint_json);
 Object.assign(s,{offset:0,resolved:0,status:'building',lastBatch:null});incomplete.sqlite.prepare('UPDATE feed_catalog_baselines SET checkpoint_json=?').run(JSON.stringify(s));
 await assert.rejects(run(incomplete),/SNAPSHOT_INCOMPLETE/);assert.equal(incomplete.calls.requests.length,0);clean(incomplete);
});
test('same LOT on IAAI hydrates independently of the existing Copart vehicle and respects terminal membership',async t=>{
 const addition=created();addition.vehicle.platform='iaai';addition.record.platform='iaai';addition.record.vehicle_id='iaai-new';
 const h=await harness(t,page([addition]));await run(h);assert.equal(bid(h),100);
 const iaai=h.sqlite.prepare("SELECT * FROM auction_listings WHERE platform='iaai' AND lot=?").get(LOT);
 assert.equal(iaai.current_bid_usd,200);assert.equal(h.sqlite.prepare('SELECT active FROM feed_catalog_membership WHERE listing_id=?').get(iaai.listing_id).active,1);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE lot=?').get(LOT).n,2);clean(h);
 const closed=await harness(t,page([event(101,LOT,{event:'lot.sold',terminal:true,changed_fields:[],after:{}})]));
 await run(closed);assert.equal(closed.sqlite.prepare("SELECT active FROM feed_catalog_membership WHERE listing_id='listing-10000001'").get().active,0);
 assert.equal(closed.sqlite.prepare('SELECT auction_state FROM auction_listings WHERE lot=?').get(LOT).auction_state,'ended');clean(closed);
});
test('competing pending page and final receipt races roll back without clearing retained recovery evidence',async t=>{
 for(const kind of ['pointer','receipt']){const h=await harness(t);
  h.calls.before=ss=>{
   if(kind==='pointer'&&ss.some(s=>s.sql.startsWith('UPDATE auction_listings')))h.sqlite.prepare("INSERT OR IGNORE INTO automatic_refresh_tasks(task_key,platform,status,cursor,next_due_at) VALUES(?,'all','pending','{}',?)").run('bootstrap-replay:fresh-1:page:99',AT);
   if(kind==='receipt'&&ss.some(s=>s.sql.includes("SET status='complete',last_success_at")))h.sqlite.exec("UPDATE automatic_refresh_tasks SET cursor='{}' WHERE task_key GLOB 'server-feed-batch:*'");
  };
  await assert.rejects(run(h));assert.equal((await state(h)).replaySequence,100);assert.equal(task(h).status,'pending');
  assert.equal(bid(h),kind==='pointer'?100:1101);clean(h);
 }
});
test('maximum mixed pages remain below970 SQL per invocation and resume from one retained provider page',async t=>{
 for(const creations of [40,500]){
  const events=Array.from({length:500},(_,n)=>n<creations?created(101+n,String(20000000+n)):event(101+n,String(20000000+n)));
  const h=await harness(t,page(events));for(let n=creations;n<500;n++)seed(h,String(20000000+n));
  let result,invocations=0,maxSql=0;
  do{h.calls.sql=0;result=await run(h,600,{maxChangesLimit:500});maxSql=Math.max(maxSql,h.calls.sql);
   assert.ok(h.calls.sql<970,`${h.calls.sql} SQL at call${invocations}`);h.error=Error('NO_REFETCH');
  }while(!result.complete&&++invocations<20);
  assert.equal(result.complete,true);assert.equal(h.calls.requests.length,1);assert.equal((await state(h)).replaySequence,600);
  t.diagnostic(`${creations} full creations / ${500-creations} existing groups: ${invocations+1} calls, max${maxSql} SQL; one provider page`);clean(h);
 }
});


test('explicit provider pre-start bound preserves replay chronology checks and independent global cursor',async t=>{const h=await harness(t,page(),true);await assert.rejects(run(h,101,{target:{sequence:101,observedAt:'2026-10-31T11:59:59.000Z',responseSha256:'e'.repeat(64)}}),/TARGET_INVALID/);assert.equal(h.calls.requests.length,0);const result=await run(h);assert.equal(result.complete,true);assert.equal((await h.membership.read('fresh-1')).plan.capture.capturedAt,null);clean(h);});
