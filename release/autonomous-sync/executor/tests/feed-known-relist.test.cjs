'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const data=require('./fixtures/copart-dakota-relist.json');
const {planInventoryChangeGroup}=require('../sync/inventory-change-group.cjs');
const {queueSparseGroups,repairSparseCatalog}=require('../sync/feed-sparse-repair.cjs');
const {relistEvidence,verifiedRelist}=require('../sync/feed-copart-relist.cjs');
const {reviewRetainedRelists}=require('../sync/feed-relist-review.cjs');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {maintainRelists}=require('../sync/feed-relist-maintenance.cjs');
const {allowSupplementalWrites}=require('../sync/feed-account-budget.cjs');
const measureFile=process.env.REXBID_TEST_RELIST_METRICS;
const file=data.events.find(x=>x.generation===23248);
const stamp=data.sourceObservedAt,clock=Date.parse(stamp);
const evidence=relistEvidence(file.group,file.observedAt);

test('exhausted internal relist allowance keeps the queued lot and cursor intact without reads of candidates or writes',async t=>{
 const h=await fixture(t); await h.queue();
 await h.store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
 h.sql.prepare("UPDATE automatic_refresh_budgets SET consumed=450 WHERE budget_key='day:2026-11-24'").run();
 h.sql.prepare("UPDATE automatic_refresh_state SET quota_checked_at=?,quota_left=10000,quota_allowance=0 WHERE singleton=1").run(stamp);
 const due=()=>h.sql.prepare("SELECT task_key,status,next_due_at,last_attempt_at,cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'feed-verify-relist:v1:%'").all();
 const snapshot=due(),before=h.sql.prepare('SELECT total_changes() AS n').get().n;
 let transport=0,clientsBuilt=0,candidateReads=0;
 const orig=h.db.prepare.bind(h.db);h.db.prepare=q=>{if(q.includes('task_key>? AND task_key<? ORDER BY task_key LIMIT 32'))candidateReads++;return orig(q);};
 const result={capturedPending:0};
 await maintainRelists({env:{REXBID_FEED_OPEN_COVERAGE:'enabled'},state:{accountBudget:{databaseMaxBytes:8e9},activation:{receipt:{kind:'feed-projected-catalog-activation'}}},
   body:{kind:'poll'},workPhase:null,result,control:{databaseSizeBytes:2428416000,limit:970},usage:{unknown:false,rowsWritten:10,rowsRead:100,statements:30},
   reservation:{window:{writes:20055200,writeLimit:29293208,reads:372772527,readLimit:19255027912}},store:h.store,db:h.db,now:()=>clock,
   fetchImpl:async()=>{transport++;throw Error('unexpected network');},
   buildRequest:async opts=>{clientsBuilt++;return require('../sync/feed-api-request.cjs').countedFeedRequest(opts);},safeCode:e=>e.message,
 });
 const writes=h.sql.prepare('SELECT total_changes() AS n').get().n-before;
 const cursor=h.sql.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key='feed-verify-relist-clock:v1'").get()?.cursor??null;
 if(measureFile) fs.writeFileSync(measureFile,JSON.stringify({writes,clientsBuilt,transport,candidateReads,cursor,after:due(),result},null,2));
 assert.deepEqual(due(),snapshot);assert.equal(transport,0);assert.equal(cursor,null);assert.equal(clientsBuilt,0);assert.equal(writes,0);assert.equal(candidateReads,0);
});

test('23956 real Subaru and Hyundai reschedules use verified values, preserve history and never move the import cursor',async t=>{
 const source=require('./fixtures/iaai-23956-reschedules.json'), h=await fixture(t);
 const observed='2026-11-25T10:01:24.000Z',time=Date.parse(observed);
 const store=new RefreshStore(h.db,'sample-23956',()=>time); assert.equal(await store.acquire(),true);
 await store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
 h.sql.prepare("INSERT INTO server_feed_generations(generation_id,first_sequence,last_sequence,sha256,raw_key,compressed_bytes,status,observed_at,created_at,updated_at) VALUES(?,?,?,?,'local',1,'complete',?,?,?)")
   .run(source.generation,source.first,source.last,'9'.repeat(64),source.received,source.received,source.received);
 h.sql.prepare('UPDATE server_feed_state SET committed_sequence=? WHERE singleton=1').run(source.last);
 const [subaru,hyundai]=source.rows,old='2026-11-17T17:30:55.120Z';
 h.sql.prepare("INSERT INTO vehicle_sources(source_key,provider,platform,identity_state,first_seen_at,last_seen_at,created_at,updated_at) VALUES('hyundai-s','apibara','iaai','resolved',?,?,?,?)").run(old,old,old,old);
 h.sql.prepare("INSERT INTO auction_listings(listing_id,source_key,platform,vin_normalized,lot,identity_state,auction_state,source_status,first_seen_at,last_seen_at,source_updated_at,created_at,updated_at) VALUES('hyundai-l','hyundai-s','iaai',?,?,'resolved','ended','Ended',?,?,?,?,?)").run(hyundai.raw.vin,hyundai.raw.lot_number,old,old,old,old,old);
 h.sql.prepare("INSERT INTO feed_catalog_membership(baseline_id,listing_id,active,last_sequence) VALUES('staging','hyundai-l',0,103579318)").run();
 for(const x of source.rows){
   const lot=x.raw.lot_number,row=h.sql.prepare("SELECT * FROM auction_listings WHERE platform='iaai' AND lot=?").get(lot)??null;
   const plan=planInventoryChangeGroup({row,events:x.events,observedAt:source.received});
   assert.ok(plan.reasons.includes(x===subaru?'unknown_lot':'schedule_on_inactive_lot'));
   const group={platform:'iaai',lot,events:x.events,quarantinedSequences:[]};
   assert.equal((await queueSparseGroups({db:h.db,store,groups:[group],decisions:[{platform:'iaai',lot,queued:true,reasons:plan.reasons}],generationId:source.generation,observedAt:source.received})).queued,1);
 }
 const history=h.sql.prepare('SELECT * FROM auction_events').all();let calls=0;
 const run=()=>repairSparseCatalog({db:h.db,store,adapter:require('../providers/apibara.js').createApibaraProvider(),now:()=>time,relistOnly:true,
   getRequest:async()=>async spec=>{calls++;const r=source.rows.find(x=>x.raw.lot_number===spec.identifier);assert.ok(r);return {response:{ok:true,data:r.raw},observedAt:r.observedAt};}});
 const first=await run(),second=await run();assert.equal(first.inserted,true);assert.equal(second.relisted,true);
 const found=h.sql.prepare("SELECT l.vin_normalized,l.lot,l.auction_at,l.buy_now_usd,l.final_price_usd,l.current_bid_usd,m.active FROM auction_listings l JOIN feed_catalog_membership m USING(listing_id) WHERE l.platform='iaai' ORDER BY l.lot").all();
 assert.equal(found.length,2);
 for(const [index,row] of found.entries()){
   assert.equal(row.vin_normalized,source.rows[index].raw.vin);assert.equal(row.auction_at,'2026-12-01T16:30:00.000Z');
   assert.equal(row.buy_now_usd,source.rows[index].raw.pricing.buy_now_usd);assert.equal(row.final_price_usd,null);assert.equal(row.current_bid_usd,null);assert.equal(row.active,1);
 }
 assert.equal(await run(),null);assert.equal(calls,2);assert.deepEqual(h.sql.prepare('SELECT * FROM auction_events').all(),history);
 assert.equal(h.sql.prepare('SELECT committed_sequence FROM server_feed_state WHERE singleton=1').get().committed_sequence,source.last);
});

test('budget preflight permits first-use initialization and quota refresh but preserves confirmed daily, monthly and provider reserves',async t=>{
 const h=await fixture(t),{alreadyAtRelistReserve}=require('../sync/feed-relist-budget.cjs');
 assert.equal(await alreadyAtRelistReserve(h.db,clock),false);
 await h.store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
 h.sql.prepare("UPDATE automatic_refresh_state SET quota_checked_at=?,quota_left=30000,quota_allowance=20000 WHERE singleton=1").run(stamp);
 assert.equal(await alreadyAtRelistReserve(h.db,clock),true);
 assert.equal(await alreadyAtRelistReserve(h.db,clock+86400000),false);
 h.sql.prepare("UPDATE automatic_refresh_state SET quota_left=75145,quota_allowance=64711 WHERE singleton=1").run();
 h.sql.prepare("UPDATE automatic_refresh_budgets SET consumed=11000 WHERE budget_key='month:2026-11'").run();
 assert.equal(await alreadyAtRelistReserve(h.db,clock),true);
 assert.equal(await alreadyAtRelistReserve(h.db,clock+86400000),true);
});

test('the published reducer classifies the exact source patch as an inactive reschedule needing detail',()=>{
 const p=planInventoryChangeGroup({row:data.row,events:file.group.events,observedAt:file.observedAt});
 assert.equal(p.requiresDetail,true);assert.ok(p.reasons.includes('schedule_on_inactive_lot'));assert.equal(p.statement,null);
});
test('already-paid bulk data fills media of an active lot without changing its prices, timestamps or history',async t=>{
 const h=await fixture(t),image='https://cs.copart.com/v1/AUTH_svc.pdoc00001/paid-bulk.jpg';
 h.sql.exec("UPDATE auction_listings SET auction_state='open',media_urls_json=NULL,media_thumbs_json=NULL;UPDATE feed_catalog_membership SET active=1");
 const before={...h.sql.prepare('SELECT * FROM auction_listings').get()},history=h.sql.prepare('SELECT * FROM auction_events').all();
 const raw={...data.raw,media:{items:[image],thumbs:[image]}};
 const fn=require('../sync/feed-available-media.cjs').fillAvailableMedia;
 assert.equal((await fn({db:h.db,store:h.store,records:[raw],now:clock})).filled,1);
 const after={...h.sql.prepare('SELECT * FROM auction_listings').get()};
 for(const key of Object.keys(before))if(!['media_urls_json','media_thumbs_json'].includes(key))assert.equal(after[key],before[key],key);
 assert.deepEqual(h.sql.prepare('SELECT * FROM auction_events').all(),history);
 assert.equal((await fn({db:h.db,store:h.store,records:[raw],now:clock})).filled,0);
 assert.equal(JSON.parse((await h.store.task('feed-media-availability:v1')).cursor).filled,1);
});
test('a paid verified relist response fills missing media without another request and preserves an existing gallery',async t=>{
 const h=await fixture(t);await h.queue();
 const raw=structuredClone(data.raw),image='https://cs.copart.com/v1/AUTH_svc.pdoc00001/verified-relist.jpg';raw.media={items:[image],thumbs:[image]};
 assert.equal((await h.run(()=>{},raw)).relisted,true);assert.equal(h.calls(),1);
 const {unpackMediaJson}=require('../sync/catalog-media-storage.cjs');
 const row=h.sql.prepare('SELECT media_urls_json FROM auction_listings WHERE listing_id=?').get(data.row.listing_id);
 assert.deepEqual(JSON.parse(unpackMediaJson(row.media_urls_json)),[image]);
 const second=await fixture(t);await second.queue();
 second.sql.prepare('UPDATE auction_listings SET media_urls_json=? WHERE listing_id=?').run('["https://example.test/already-present.jpg"]',data.row.listing_id);
 assert.equal((await second.run(()=>{},raw)).relisted,true);
 assert.equal(second.sql.prepare('SELECT media_urls_json FROM auction_listings WHERE listing_id=?').get(data.row.listing_id).media_urls_json,'["https://example.test/already-present.jpg"]');
});
test('the normal Copart page reuses images from the existing counted call and preserves the catalogue cursor',async t=>{
 const h=await fixture(t),image='https://cs.copart.com/v1/AUTH_svc.pdoc00001/catalogue-page.jpg';
 h.sql.exec("UPDATE auction_listings SET auction_state='open',media_urls_json=NULL,media_thumbs_json=NULL;UPDATE feed_catalog_membership SET active=1");
 await h.store.guarded([h.store.taskStatement({key:'feed-relist-pages:v1',platform:'all',status:'complete',due:clock,
  cursor:JSON.stringify({day:stamp.slice(0,10),platform:'copart'})})]);
 const before=h.sql.prepare('SELECT committed_sequence FROM server_feed_state WHERE singleton=1').get();
 const raw={...data.raw,media:{items:[image],thumbs:[image]}};
 let calls=0;
 const result=await require('../sync/feed-relist-pages.cjs').warmRelistPage({db:h.db,store:h.store,now:()=>clock,
  getRequest:async()=>async request=>{
   calls++;assert.equal(request.operation,'listVehicles');assert.equal(request.params.platform,'copart');
   return {response:{data:[raw],meta:{next_cursor:'next'}},observedAt:stamp};
  }});
 assert.equal(result.mediaFilled,1);
 assert.equal(calls,1);
 assert.equal(JSON.parse((await h.store.task('feed-relist-pages:v1')).cursor).after,'next');
 assert.deepEqual(h.sql.prepare('SELECT committed_sequence FROM server_feed_state WHERE singleton=1').get(),before);
 const prepare=h.db.prepare.bind(h.db);
 h.db.prepare=statement=>{
  if(statement.startsWith('SELECT l.listing_id,l.platform,l.lot,l.vin_normalized FROM json_each'))throw Error('media storage unavailable');
  return prepare(statement);
 };
 const deferred=await require('../sync/feed-relist-pages.cjs').warmRelistPage({db:h.db,store:h.store,now:()=>clock,
  getRequest:async()=>async request=>{
   calls++;assert.equal(request.params.cursor,'next');
   return {response:{data:[raw],meta:{next_cursor:'next-2'}},observedAt:stamp};
  }});
 assert.equal(deferred.mediaDeferred,true);
 assert.equal(calls,2);
 assert.equal(JSON.parse((await h.store.task('feed-relist-pages:v1')).cursor).after,'next-2');
});
test('owner-requested priority reorders an existing task and still uses the strict normal writer',async t=>{
 const h=await fixture(t);await h.queue();
 const task=h.sql.prepare("SELECT task_key FROM automatic_refresh_tasks WHERE task_key LIKE 'feed-verify-relist:v1:%'").get();
 await h.store.guarded([h.store.taskStatement({key:'feed-relist-priority:v1',platform:'all',status:'pending',due:clock,cursor:JSON.stringify({keys:[task.task_key]})})]);
 const chosen=await require('../sync/feed-relist-priority.cjs').requestedTask(h.store,clock);assert.equal(chosen.task_key,task.task_key);
 assert.equal((await h.run()).relisted,true);assert.equal(h.calls(),1);
 assert.equal(await require('../sync/feed-relist-priority.cjs').requestedTask(h.store,clock),null);
 assert.equal((await h.store.task('feed-relist-priority:v1')).status,'complete');
});
test('provider reserve scales with verified paid capacity instead of retaining the historical 30000 cutoff',()=>{
 const {relistRequestCapacity}=require('../sync/feed-relist-budget.cjs');
 const budgets=[{budget_key:'day:2026-11-24',limit_count:3000,consumed:400},{budget_key:'month:2026-11',limit_count:90000,consumed:2000}];
 const quota={quota_checked_at:stamp,quota_limit:100000,quota_allowance:15000,quota_left:25000};
 assert.equal(relistRequestCapacity({quota,budgets,now:clock}),8);
 assert.equal(relistRequestCapacity({quota:{...quota,quota_left:10002},budgets,now:clock}),2);
 assert.equal(relistRequestCapacity({quota:{...quota,quota_left:10000},budgets,now:clock}),0);
});
test('fresh monitoring pressure drives central allocation and the new-listing allowance without zeroing counters',async t=>{
 const h=await fixture(t);await h.store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
 h.sql.exec('CREATE TABLE sync_monitor_samples(slot INTEGER,measured_at TEXT,pending INTEGER)');
 h.sql.prepare('INSERT INTO sync_monitor_samples VALUES(1,?,26431)').run(stamp);
 h.sql.prepare('UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=100000,quota_left=99995,quota_allowance=89994').run(stamp);
 await h.store.guarded([h.store.taskStatement({key:'feed-adaptive-provider-period:v1',platform:'all',status:'complete',due:clock,cursor:JSON.stringify({subscriptionTo:'2026-12-24'})})]);
 const plan=await require('../sync/feed-adaptive-quota.cjs').configureQuota(h.store,h.db,clock);
 assert.ok(plan.daily>=3775);assert.equal(plan.pending,26431);
 const budgets=await h.store.budgets(),newAllowance=budgets.find(x=>x.budget_key==='new:2026-11-24');
 assert.ok(newAllowance.limit_count>2000);assert.equal(newAllowance.consumed,0);
 const grant=h.sql.prepare("SELECT * FROM automatic_refresh_budgets WHERE budget_key='relist-catchup:2026-12-24'").get();
 assert.equal(grant.limit_count,44997);assert.equal(grant.consumed,0);
 assert.equal(h.store.catchupBudgetKey,grant.budget_key);
 const daily=budgets.find(x=>x.budget_key==='day:2026-11-24');assert.ok(daily.limit_count>40000);
 assert.ok(await h.store.reserve({operation:'vehicleByIdentifier',platform:'copart'},null,false));
 assert.equal(h.sql.prepare('SELECT consumed FROM automatic_refresh_budgets WHERE budget_key=?').get(grant.budget_key).consumed,1);
 await require('../sync/feed-adaptive-quota.cjs').configureQuota(h.store,h.db,clock);
 assert.equal(h.sql.prepare('SELECT limit_count FROM automatic_refresh_budgets WHERE budget_key=?').get(grant.budget_key).limit_count,grant.limit_count);
 await h.store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
 assert.equal((await h.store.budgets()).find(x=>x.budget_key===newAllowance.budget_key).limit_count,newAllowance.limit_count);
});
test('a catalogue conflict rolls back a deferred batch and leaves history and checkpoint unchanged',async t=>{
 const h=await fixture(t);await h.queue();
 const task=h.sql.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key LIKE 'feed-verify-relist:v1:%'").get();
 h.sql.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify({...JSON.parse(task.cursor),sourceRecord:{raw:data.raw,observedAt:stamp}}),task.task_key);
 const before=h.sql.prepare('SELECT * FROM auction_listings').all(),history=h.sql.prepare('SELECT * FROM auction_events').all();
 const original=h.store.guarded.bind(h.store);
 h.store.guarded=async statements=>{
  h.sql.prepare('UPDATE automatic_refresh_tasks SET next_due_at=? WHERE task_key=?').run(stamp,task.task_key);
  h.sql.exec('UPDATE server_feed_state SET committed_sequence=committed_sequence+1');
  return original(statements);
 };
 await assert.rejects(require('../sync/feed-relist-batch.cjs').restoreCachedBatch({db:h.db,store:h.store,keys:[task.task_key],now:()=>clock}));
 assert.deepEqual(h.sql.prepare('SELECT * FROM auction_listings').all(),before);
 assert.deepEqual(h.sql.prepare('SELECT * FROM auction_events').all(),history);
 assert.equal(h.sql.prepare('SELECT status FROM automatic_refresh_tasks WHERE task_key=?').get(task.task_key).status,'pending');
 assert.equal(h.sql.prepare('SELECT count(*) n FROM sync_batch_guards').get().n,0);
});
test('confirmed REST and archived reschedule must agree on lot, VIN, schedule and current cycle',()=>{
 const plan=verifiedRelist(data.row,data.member,evidence,data.raw,stamp,clock);
 assert.equal(plan.auction_state,'open');assert.equal(plan.auction_at,'2026-12-01T02:00:00.000Z');assert.equal(plan.buy_now_usd,468);assert.equal(plan.current_bid_usd,225);
 for(const edit of [r=>r.auction.result_confirmed=true,r=>r.auction.state='finished',r=>r.auction.phase='awaiting_result',r=>r.auction.lot_removed=true,r=>r.vin='1B7GG32X82S697329',r=>r.auction.outcome_status='Sold on Approval',r=>r.auction.auction_at='2026-12-01T04:00:00Z',r=>r.updated_at='2026-11-20T11:00:00Z']){
   const raw=structuredClone(data.raw);edit(raw);assert.equal(verifiedRelist(data.row,data.member,evidence,raw,stamp,clock),null);
 }
 assert.equal(verifiedRelist(data.row,{...data.member,last_sequence:evidence.sequence+10},evidence,data.raw,stamp,clock),null);
 assert.equal(verifiedRelist(data.row,data.member,evidence,data.raw,stamp,clock+60001),null);
 for(const amount of [0,null]){const raw=structuredClone(data.raw);raw.pricing.current_bid_usd=amount;
   assert.equal(verifiedRelist(data.row,data.member,evidence,raw,stamp,clock).current_bid_usd,null);}
});
function localD1(sql){
 const prep=q=>{const stmt=p=>({q,p,async first(){return sql.prepare(q).get(...p)||null;},async all(){return {results:sql.prepare(q).all(...p)};},
   async run(){return {success:true,meta:{changes:Number(sql.prepare(q).run(...p).changes)}};}});return {...stmt([]),bind:(...p)=>stmt(p)};};
 return {prepare:prep,async batch(stmts){sql.exec('BEGIN IMMEDIATE');try{const result=stmts.map(s=>({success:true,meta:{changes:Number(sql.prepare(s.q).run(...s.p).changes)}}));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
async function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql','0014_feed_catalog_membership.sql'])
  sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 const row=data.row,vin=row.vin_normalized;
 const insert=(name,r)=>{const cols=Object.keys(r);return sql.prepare('INSERT INTO '+name+'('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').run(...Object.values(r));};
 insert('vehicle_sources',{source_key:row.source_key,provider:'apibara',platform:'copart',identity_state:'resolved',first_seen_at:row.last_seen_at,last_seen_at:row.last_seen_at,created_at:row.updated_at,updated_at:row.updated_at});
 const listing={...row,first_seen_at:row.last_seen_at,created_at:row.updated_at};for(const k of ['source_identity_state','source_platform','provider'])delete listing[k];insert('auction_listings',listing);
 const baseline='staging';insert('feed_catalog_baselines',{baseline_id:baseline,plan_sha256:'a'.repeat(64),plan_json:'{}',checkpoint_json:'{}',created_at:stamp,updated_at:stamp});
 sql.prepare('UPDATE feed_catalog_pointer SET baseline_id=? WHERE singleton=1').run(baseline);
 insert('feed_catalog_membership',{baseline_id:baseline,listing_id:row.listing_id,active:0,last_sequence:data.member.last_sequence});
 insert('server_feed_state',{singleton:1,committed_sequence:118680705,seed_evidence_json:'{}',updated_at:stamp});
 for(const [id,first,last,when] of [[23248,118174500,118318554,file.observedAt],[23316,118562646,118680705,'2026-11-24T19:35:56Z']]){
  insert('server_feed_generations',{generation_id:id,first_sequence:first,last_sequence:last,sha256:String(id).padStart(64,'0'),raw_key:'isolated',compressed_bytes:1,status:'complete',observed_at:when,created_at:when,updated_at:when});
 }
 insert('auction_events',{event_id:'history-test',source_key:row.source_key,listing_id:row.listing_id,provider:'apibara',platform:'copart',vin_normalized:vin,lot:row.lot,source_status:'Not Sold',source_price_usd:225,observed_at:stamp,created_at:stamp,updated_at:stamp});
 const db=localD1(sql),store=new RefreshStore(db,'local-relist',()=>clock);await store.acquire();
 const queue=()=>queueSparseGroups({db,store,groups:[file.group],decisions:[{platform:'copart',lot:row.lot,queued:true,identityError:false,reasons:['schedule_on_inactive_lot']}],generationId:file.generation,observedAt:file.observedAt});
 let calls=0;
 const run=(hook=()=>{},raw=data.raw)=>repairSparseCatalog({db,store,adapter:{vehicleDetailRecord:res=>res.data},now:()=>clock,relistOnly:true,
  getRequest:async()=>async spec=>{calls++;assert.ok([vin,row.lot].includes(spec.identifier));hook();return {response:{data:typeof raw==='function'?raw(spec.identifier):raw},observedAt:stamp};}});
 return {sql,db,store,queue,run,calls:()=>calls};
}
test('twenty cached known lots share one atomic write batch and keep source history and cursor',async t=>{
 const h=await fixture(t);await h.queue();
 const initial=h.sql.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key LIKE 'feed-verify-relist:v1:%'").get();
 const base=JSON.parse(initial.cursor);
 const listing=h.sql.prepare('SELECT * FROM auction_listings WHERE listing_id=?').get(data.row.listing_id);
 const source=h.sql.prepare('SELECT * FROM vehicle_sources WHERE source_key=?').get(listing.source_key);
 const insert=(table,row)=>{const fields=Object.keys(row);h.sql.prepare('INSERT INTO '+table+'('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...Object.values(row));};
 const keys=[];
 for(let i=1;i<=20;i++){
  const lot=String(Number(base.lot)+i),id='batch-'+i,sourceKey='batch-source-'+i,key='feed-verify-relist:v1:copart:'+lot;
  insert('vehicle_sources',{...source,source_key:sourceKey});
  insert('auction_listings',{...listing,listing_id:id,source_key:sourceKey,lot});
  insert('feed_catalog_membership',{baseline_id:'staging',listing_id:id,active:0,last_sequence:data.member.last_sequence});
  const c={...base,lot,sequence:base.sequence+i,relist:{...base.relist,sequence:base.relist.sequence+i},sourceRecord:{raw:{...data.raw,lot_number:lot},observedAt:stamp}};
  insert('automatic_refresh_tasks',{...initial,task_key:key,cursor:JSON.stringify(c)});keys.push(key);
 }
 let writes=0;const guarded=h.store.guarded.bind(h.store);
 h.store.guarded=async statements=>{writes++;return guarded(statements);};
 const before=h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence;
 const result=await require('../sync/feed-relist-batch.cjs').restoreCachedBatch({db:h.db,store:h.store,keys,now:()=>clock});
 assert.equal(result.filter(r=>r.relisted).length,20);assert.equal(writes,1);
 assert.equal(h.sql.prepare("SELECT count(*) n FROM feed_catalog_membership WHERE listing_id LIKE 'batch-%' AND active=1").get().n,20);
 assert.equal(h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,before);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM auction_events').get().n,1);
});

test('a cached successful repair schedules durable continuation with zero upstream calls',async t=>{
 const h=await fixture(t);await h.queue();
 const row=h.sql.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'feed-verify-relist:v1:%'").get();
 h.sql.prepare('UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=?').run(JSON.stringify({...JSON.parse(row.cursor),sourceRecord:{raw:data.raw,observedAt:stamp}}),row.task_key);
 await h.store.guarded([
  h.store.taskStatement({key:'feed-relist-stream:v1',platform:'all',status:'complete',due:clock,cursor:JSON.stringify({after:118174564,matchedKeys:[row.task_key]})}),
  h.store.taskStatement({key:'feed-adaptive-provider-period:v1',platform:'all',status:'complete',due:clock,cursor:JSON.stringify({subscriptionTo:'2026-12-24'})})
 ]);
 h.sql.prepare('UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=100000,quota_used=24660,quota_left=75340,quota_allowance=65339').run(stamp);
 let sent=0,network=0;
 const result={capturedPending:0};
 await maintainRelists({env:{REXBID_FEED_OPEN_COVERAGE:'enabled',APIBARA_API_KEY:'synthetic-local-only',REXBID_FEED_QUEUE:{send:async()=>{sent++;}}},
  state:{accountBudget:{databaseMaxBytes:8e9},activation:{receipt:{kind:'feed-projected-catalog-activation'}}},
  body:{kind:'poll'},result,workPhase:null,control:{databaseSizeBytes:2428416000,limit:970},usage:{unknown:false,rowsWritten:0,rowsRead:0,statements:0},
  reservation:{window:{writes:20055200,writeLimit:29293208,reads:372772527,readLimit:19255027912}},
  db:h.db,store:h.store,now:()=>clock,safeCode:e=>e.message,fetchImpl:async()=>{network++;throw Error('unexpected request');}});
 assert.equal(network,0);assert.equal(sent,1);assert.equal(result.relistVerification.continuation,true);
});

test('filtered reschedule batches persist an independent cursor and repair from the source record without another call',async t=>{
 const h=await fixture(t);await h.queue();
 const after=118174499;
 await h.store.guarded([h.store.taskStatement({key:'feed-relist-stream:v1',platform:'all',status:'complete',due:clock,cursor:JSON.stringify({after,matchedKeys:[]})})]);
 let calls=0;
 const page=await require('../sync/feed-relist-pages.cjs').warmRelistPage({db:h.db,store:h.store,now:()=>clock,getRequest:async()=>async spec=>{
  calls++;assert.equal(spec.operation,'relistChanges');assert.equal(spec.after,after);
  return {response:{data:[{event:'auction.rescheduled',sequence:118174564,record:data.raw}],meta:{next_cursor:118174564,has_more:true}},observedAt:stamp};
 }});
 assert.equal(page.matched,1);assert.equal(calls,1);
 const cursor=JSON.parse((await h.store.task('feed-relist-stream:v1')).cursor);
 assert.equal(cursor.after,118174564);
 const result=await repairSparseCatalog({db:h.db,store:h.store,adapter:{vehicleDetailRecord:r=>r.data},now:()=>clock,relistOnly:true,preferredTaskKey:page.matchedKeys[0],getRequest:async()=>{throw Error('extra request');}});
 assert.equal(result.relisted,true);
 assert.equal(h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,118680705);
});

test('one validated source page repairs its matching queued lot without another paid detail call',async t=>{
 const h=await fixture(t);await h.queue();
 await h.store.guarded([h.store.taskStatement({key:'feed-relist-pages:v1',platform:'all',status:'complete',due:clock,cursor:JSON.stringify({day:stamp.slice(0,10),platform:'copart'})})]);
 let calls=0;
 const page=await require('../sync/feed-relist-pages.cjs').warmRelistPage({db:h.db,store:h.store,now:()=>clock,getRequest:async()=>async spec=>{
  calls++;assert.equal(spec.operation,'listVehicles');return {response:{data:[data.raw],meta:{}},observedAt:stamp};
 }});
 assert.equal(page.matched,1);
 const result=await repairSparseCatalog({db:h.db,store:h.store,adapter:{vehicleDetailRecord:r=>r.data},now:()=>clock,relistOnly:true,preferredTaskKey:page.matchedKeys[0],
  getRequest:async()=>{throw Error('extra detail request');}});
 assert.equal(result.relisted,true);assert.equal(calls,1);
});

test('relist recovery tolerates a 24-hour delivery gap and persists API version against late packets',async t=>{
 const h=await fixture(t);await h.queue();
 h.sql.prepare('UPDATE server_feed_generations SET observed_at=?').run(new Date(clock-86400000).toISOString());
 const before=h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence;
 assert.equal((await h.run()).relisted,true);
 const row=h.sql.prepare('SELECT source_updated_at,detail_synced_at,last_seen_at FROM auction_listings WHERE listing_id=?').get(data.row.listing_id);
 assert.equal(row.source_updated_at,data.raw.updated_at);
 assert.equal(row.detail_synced_at,stamp);
 assert.equal(row.last_seen_at,stamp);
 assert.equal(h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,before);
});

test('idle job recovers an already committed source event, publishes by exact VIN and preserves history and feed cursor',async t=>{
 const h=await fixture(t);assert.equal((await h.queue()).queued,1);assert.equal((await h.run()).relisted,true);
 const catalog=h.sql.prepare("SELECT l.vin_normalized,l.lot,l.auction_at,l.current_bid_usd,l.buy_now_usd FROM auction_listings l JOIN feed_catalog_membership m USING(listing_id) WHERE l.vin_normalized=? AND l.auction_state='open' AND m.active=1 AND l.auction_at>?").all(data.raw.vin,stamp);
 assert.equal(catalog.length,1);assert.equal(catalog[0].lot,data.raw.lot_number);assert.equal(catalog[0].auction_at,'2026-12-01T02:00:00.000Z');
 assert.equal(h.sql.prepare('SELECT source_status FROM auction_events').get().source_status,'Not Sold');
 assert.equal(h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,118680705);
 assert.equal((await h.queue()).queued,0);assert.equal(await h.run(),null);assert.equal(h.calls(),1);
});
test('a concurrent newer terminal membership prevents activation, regardless of earlier REST data',async t=>{
 const h=await fixture(t);await h.queue();
 const result=await h.run(()=>h.sql.prepare('UPDATE feed_catalog_membership SET last_sequence=?').run(evidence.sequence+1));
 assert.equal(result.skipped,true);assert.equal(h.sql.prepare('SELECT active FROM feed_catalog_membership').get().active,0);
});
test('queuing a relisted auction looks up the exact lot in both existence checks',async t=>{
 const h=await fixture(t);let upsert;const prepare=h.db.prepare.bind(h.db);
 h.db.prepare=q=>{if(q.startsWith('INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,status,cursor,next_due_at,last_attempt_at)'))upsert=q;return prepare(q);};
 assert.equal((await h.queue()).queued,1);assert.ok(upsert);
 const plan=h.sql.prepare('EXPLAIN QUERY PLAN '+upsert).all(stamp,stamp,'[]',file.generation);
 const lookups=plan.filter(p=>/^SEARCH l /.test(p.detail));
 assert.equal(lookups.length,2);
 assert.ok(lookups.every(p=>p.detail.includes('idx_listings_lot_recent (platform=? AND lot=?)')));
});
test('a numeric LOT returned on the other platform falls back once to VIN, then checks all three identity fields',async t=>{
 const h=await fixture(t);await h.queue();
 const recovered=await h.run(()=>{},id=>id===data.raw.lot_number?{...data.raw,platform:'iaai'}:data.raw);
 assert.equal(recovered.relisted,true);assert.equal(h.calls(),2);
});
test('a later terminal result gets one operational proof and only a new reschedule can create another task',async t=>{
 const h=await fixture(t);await h.queue();
 const ended={...data.raw,auction:{...data.raw.auction,state:'finished',result_confirmed:true}};
 assert.equal((await h.run(()=>{},ended)).skipped,true);assert.equal((await h.queue()).queued,0);assert.equal(await h.run(),null);assert.equal(h.calls(),1);
 const g=structuredClone(file.group);g.events[0].sequence++;g.events[0].event_id='chg_'+g.events[0].sequence;
 const fresh=await queueSparseGroups({db:h.db,store:h.store,groups:[g],decisions:[{platform:g.platform,lot:g.lot,queued:true,reasons:['schedule_on_inactive_lot']}],generationId:file.generation,observedAt:file.observedAt});
 assert.equal(fresh.queued,1);assert.equal((await h.run()).relisted,true);assert.equal(h.calls(),2);
});
test('uncopied past result is retained in listing until its historical retention has been verified',async t=>{
 const h=await fixture(t);h.sql.prepare('UPDATE auction_listings SET final_price_usd=200').run();await h.queue();
 assert.equal((await h.run()).skipped,true);assert.equal(h.sql.prepare('SELECT final_price_usd FROM auction_listings').get().final_price_usd,200);
});
test('one-off review independently classifies a whole archived partition and advances its own cursor atomically',async t=>{
 const h=await fixture(t);h.sql.prepare('UPDATE server_feed_generations SET manifest_key=?,manifest_sha256=? WHERE generation_id=?').run('isolated-manifest','c'.repeat(64),file.generation);
 const parts=[];const args={db:h.db,store:h.store,generationId:file.generation,startBucket:72,now:()=>clock,bucket:{},
  loadManifest:async(bucket,generation)=>{assert.equal(generation.status,'complete');return {id:generation.generation_id};},
  readBucket:async({manifest,bucketIndex})=>{assert.equal(manifest.id,file.generation);parts.push(bucketIndex);const groups=bucketIndex===72?[file.group]:[];return {groups,uniqueLots:groups.length};}};
 assert.equal((await reviewRetainedRelists(args)).queued,1);assert.equal((await h.run()).relisted,true);
 assert.equal((await reviewRetainedRelists(args)).queued,0);assert.deepEqual(parts,[72,73]);
 assert.equal(h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,118680705);
 assert.equal(h.sql.prepare('SELECT a.vin_normalized FROM auction_listings a JOIN feed_catalog_membership m USING(listing_id) WHERE m.active=1').get().vin_normalized,data.raw.vin);
});
test('a saturated ordinary 128-slot queue cannot evict a relist; a restart preserves its exact pending evidence',async t=>{
 const h=await fixture(t);const stmt=h.sql.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,cursor,next_due_at) VALUES(?,'copart','pending','{}',?)");
 for(let i=0;i<128;i++)stmt.run('feed-sparse:v1:copart:'+i,stamp);
 assert.equal((await h.queue()).queued,1);const proof=h.sql.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'feed-verify-relist:v1:%'").get();
 assert.equal(JSON.parse(proof.cursor).relist.sequence,evidence.sequence);
 assert.equal((await h.queue()).queued,0);assert.equal((await h.run()).relisted,true);
 assert.equal(h.sql.prepare("SELECT count(*) n FROM automatic_refresh_tasks WHERE task_key LIKE 'feed-sparse:v1:%' AND status='pending'").get().n,128);
});
test('an error committing a review leaves both candidate and review position recoverable on another invocation',async t=>{
 const h=await fixture(t);h.sql.prepare('UPDATE server_feed_generations SET manifest_key=?,manifest_sha256=? WHERE generation_id=?').run('isolated-manifest','c'.repeat(64),file.generation);
 const args={db:h.db,store:h.store,generationId:file.generation,startBucket:72,now:()=>clock,loadManifest:async()=>({}),readBucket:async()=>({groups:[file.group],uniqueLots:1})};
 h.sql.exec("CREATE TRIGGER stop_review BEFORE INSERT ON automatic_refresh_tasks WHEN NEW.task_key LIKE 'feed-relist-review:v1:%' BEGIN SELECT RAISE(ABORT,'pause'); END");
 await assert.rejects(reviewRetainedRelists(args));assert.equal(h.sql.prepare('SELECT count(*) n FROM automatic_refresh_tasks').get().n,0);
 h.sql.exec('DROP TRIGGER stop_review');assert.equal((await reviewRetainedRelists(args)).queued,1);assert.equal((await h.run()).relisted,true);
});
test('replacement reschedule supersedes the earlier date without preserving the older proof or its quote',async t=>{
 const h=await fixture(t);await h.queue();const g=structuredClone(file.group),e=g.events[0];e.sequence++;e.event_id='chg_'+e.sequence;e.after['auction.auction_at']='2026-12-02T03:00:00Z';
 await queueSparseGroups({db:h.db,store:h.store,groups:[g],decisions:[{platform:g.platform,lot:g.lot,queued:true,reasons:['schedule_on_inactive_lot']}],generationId:file.generation,observedAt:file.observedAt});
 assert.equal((await h.run()).skipped,true);assert.equal(h.sql.prepare('SELECT active FROM feed_catalog_membership').get().active,0);
 const current=JSON.parse(h.sql.prepare("SELECT cursor FROM automatic_refresh_tasks WHERE task_key LIKE 'feed-verify-relist:v1:%'").get().cursor);
 assert.equal(current.relist.sequence,e.sequence);assert.equal(current.relist.date,e.after['auction.auction_at']);
});
test('an elapsed account reserve or scarce shared requests defer the repair, while usable measured surplus permits a bounded batch',()=>{
 const {relistWorkFits,relistRequestCapacity}=require('../sync/feed-relist-budget.cjs');
 const fit={window:{writes:20055200,writeLimit:29293208,reads:372772527,readLimit:19255027912},storageBytes:2428416000,storageLimit:8000000000,usage:{unknown:false,rowsWritten:10,rowsRead:100},remainingStatements:300};
 assert.equal(relistWorkFits(fit),true);assert.equal(relistWorkFits({...fit,window:{...fit.window,writes:29000000}}),false);
 const quota={quota_checked_at:stamp,quota_allowance:65339,quota_left:75340};
 const budgets=[{budget_key:'day:2026-11-24',limit_count:500,consumed:50},{budget_key:'month:2026-11',limit_count:12000,consumed:2086}];
 assert.equal(relistRequestCapacity({quota,budgets,now:clock}),8);assert.equal(relistRequestCapacity({quota:{...quota,quota_left:30002},budgets,now:clock}),2);
 assert.equal(relistRequestCapacity({quota,budgets,now:clock+86400001}),0);
 assert.equal(relistRequestCapacity({quota,budgets:[{...budgets[0],consumed:400},budgets[1]],now:clock}),8);
 assert.equal(relistRequestCapacity({quota,budgets:[{...budgets[0],consumed:449},budgets[1]],now:clock}),1);
 assert.equal(relistRequestCapacity({quota,budgets:[{...budgets[0],consumed:450},budgets[1]],now:clock}),0);
});
test('real maintenance entry runs after a settled poll using the existing request ledger even when ordinary supplementation is held',async t=>{
 const h=await fixture(t);await h.queue();
 const policy={databaseMaxBytes:8000000000,prioritizePublication:true,billingDay:6};
 const window={firstDay:'2026-11-06',day:'2026-11-24',writes:20055200,writeLimit:29293208,reads:372772527,readLimit:19255027912};
 assert.equal(allowSupplementalWrites(policy,window),false);
 h.sql.prepare("UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=100000,quota_used=24660,quota_left=75340,quota_allowance=65339,quota_plan='Pro' WHERE singleton=1").run(stamp);
 let calls=0;
 const result={capturedPending:0},args={env:{REXBID_FEED_OPEN_COVERAGE:'enabled',APIBARA_API_KEY:'synthetic-local-only'},
  state:{accountBudget:policy,activation:{receipt:{kind:'feed-projected-catalog-activation'}}},body:{kind:'poll'},workPhase:null,result,
  control:{databaseSizeBytes:2428416000,limit:970},usage:{unknown:false,rowsWritten:10,rowsRead:100,statements:30},reservation:{window},
  store:h.store,db:h.db,now:()=>clock,fetchImpl:async url=>{
   if(String(url).endsWith('/usage'))return Response.json({ok:true,data:{plan:{name:'Pro',per_page_limit:20},quota:{limit:100000,used:24660,left:75340},period:{subscription_to:'2026-12-24'}}});
   if(String(url).includes('/vehicles?'))return Response.json({ok:true,data:[],meta:{}});
   calls++;assert.ok(String(url).includes(data.raw.lot_number));return Response.json({ok:true,data:data.raw});},
  safeCode:err=>err.message};
 // Production's diagnostics wrapper inherits its bindings and secrets.
 args.env=Object.create(args.env);
 await maintainRelists({...args,result:{capturedPending:1}});assert.equal(calls,0);
 await maintainRelists(args);assert.equal(result.relistVerification.results[0].relisted,true);assert.equal(calls,1);
 assert.equal(h.sql.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='day:2026-11-24'").get().consumed,3);
 assert.equal(h.sql.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='month:2026-11'").get().consumed,3);
 assert.equal(h.sql.prepare("SELECT count(*) n FROM automatic_refresh_attempts WHERE operation='vehicleByIdentifier' AND outcome='response' AND http_status=200").get().n,1);
});
test('range review processes contiguous retained generations in a partition before rotating and never skips a source-sequence gap',async t=>{
 const h=await fixture(t);h.sql.prepare('UPDATE server_feed_generations SET manifest_key=?,manifest_sha256=?').run('local','b'.repeat(64));
 const nums=[23248],opts={db:h.db,store:h.store,generationId:23248,throughGeneration:23316,startBucket:72,now:()=>clock,
  loadManifest:async(b,g)=>({generation:g.generation_id}),readBucket:async x=>{nums.push(x.manifest.generation);return{groups:[],uniqueLots:0};}};
 assert.equal((await reviewRetainedRelists(opts)).reason,'retained_range_gap');
 let task=h.sql.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key LIKE 'feed-relist-review:v1:%'").get();
 assert.equal(task.status,'blocked');assert.equal(JSON.parse(task.cursor).generationId,23248);
 h.sql.prepare('UPDATE server_feed_generations SET first_sequence=118318555 WHERE generation_id=23316').run();
 h.sql.prepare("UPDATE automatic_refresh_tasks SET next_due_at=? WHERE task_key=?").run(stamp,task.task_key);
 assert.equal((await reviewRetainedRelists(opts)).generationId,23248);
 const second=await reviewRetainedRelists(opts);assert.equal(second.generationId,23316);assert.equal(second.bucket,72);
 assert.equal((await reviewRetainedRelists(opts)).bucket,73);
});
