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
const file=data.events.find(x=>x.generation===23248);
const stamp=data.sourceObservedAt,clock=Date.parse(stamp);
const evidence=relistEvidence(file.group,file.observedAt);

test('the published reducer classifies the exact source patch as an inactive reschedule needing detail',()=>{
 const p=planInventoryChangeGroup({row:data.row,events:file.group.events,observedAt:file.observedAt});
 assert.equal(p.requiresDetail,true);assert.ok(p.reasons.includes('schedule_on_inactive_lot'));assert.equal(p.statement,null);
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
 assert.equal(relistRequestCapacity({quota,budgets,now:clock+86400001}),0);assert.equal(relistRequestCapacity({quota,budgets:[{...budgets[0],consumed:400},budgets[1]],now:clock}),0);
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
  store:h.store,db:h.db,now:()=>clock,fetchImpl:async url=>{calls++;assert.ok(String(url).includes(data.raw.lot_number));return Response.json({ok:true,data:data.raw});},
  safeCode:err=>err.message};
 await maintainRelists({...args,result:{capturedPending:1}});assert.equal(calls,0);
 await maintainRelists(args);assert.equal(result.relistVerification.results[0].relisted,true);assert.equal(calls,1);
 assert.equal(h.sql.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='day:2026-11-24'").get().consumed,1);
 assert.equal(h.sql.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='month:2026-11'").get().consumed,1);
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
