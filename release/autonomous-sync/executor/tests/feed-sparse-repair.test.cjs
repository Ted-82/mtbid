'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
const {queueSparseGroups,prepareSparseQueue,extendSparseRecovery,repairSparseCatalog,projectPrices,indexedLotReads,candidate,PREFIX}=require('../sync/feed-sparse-repair.cjs');
const {createHash}=require('node:crypto');
const {importChangeBatch,hashReceipt}=require('../sync/feed-change-import.cjs');
const NOW=Date.parse('2026-11-18T20:00:00.000Z'),AT=new Date(NOW).toISOString(),LOT='63264816',VIN='3C7WRNBJ6HG604231';
const raw=()=>({platform:'copart',lot_number:LOT,vin:VIN,title:'2017 RAM 5500',year:2017,make:'RAM',model:'5500',updated_at:'2026-11-18T18:55:20.000Z',pricing:{current_bid_usd:null,current_bid2_usd:null,buy_now_usd:5900},auction:{state:'open',phase:'scheduled',auction_at:'2026-11-23T20:00:00Z',is_timed:false,result_confirmed:false},seller:{name:'Seller'},sale_document:{name:'TITLE'},media:{items:['https://cs.copart.com/v1/AUTH_svc.pdoc00001/photo.jpg']}});
function event(seq,after,kind='bid.changed'){return{sequence:seq,event_id:'chg_'+seq,event:kind,terminal:false,vehicle:{platform:'copart',lot_number:LOT,vin:VIN},recorded_at:'2026-11-18T19:34:22Z',vehicle_updated_at:'2026-11-18T19:34:22Z',after,before:{},changed_fields:Object.keys(after)};}
const group=(events=[event(100,{'auction.upcoming':1,'pricing.current_bid_usd':4850})])=>({platform:'copart',lot:LOT,events,quarantinedSequences:[]});
const decisions=[{platform:'copart',lot:LOT,queued:true,identityError:false,reasons:['unknown_lot']}];
async function setup(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());for(const f of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',f),'utf8'));
 sql.exec(`CREATE TABLE server_feed_state(singleton INTEGER PRIMARY KEY,committed_sequence,active_generation);
 CREATE TABLE server_feed_generations(generation_id INTEGER PRIMARY KEY,first_sequence,last_sequence,status,observed_at);
 CREATE TABLE feed_catalog_pointer(singleton INTEGER PRIMARY KEY,baseline_id);
 CREATE TABLE feed_catalog_membership(baseline_id,listing_id,active,last_sequence,PRIMARY KEY(baseline_id,listing_id));
 INSERT INTO server_feed_state VALUES(1,100,NULL);INSERT INTO server_feed_generations VALUES(1,1,100,'complete','${AT}');INSERT INTO feed_catalog_pointer VALUES(1,'baseline');
 INSERT INTO automatic_refresh_budgets(budget_key,limit_count,consumed,created_at,updated_at) VALUES('new:2026-11-18',2000,0,'${AT}','${AT}');`);
 const db={prepare(q){const methods=p=>({q,p,async first(){return sql.prepare(q).get(...p)||null;},async all(){return{success:true,results:sql.prepare(q).all(...p)};},async run(){return{success:true,meta:{changes:Number(sql.prepare(q).run(...p).changes)}};}});return{...methods([]),bind(...p){return methods(p);}};},async batch(stmts){sql.exec('BEGIN IMMEDIATE');try{const out=stmts.map(s=>/^\s*SELECT/i.test(s.q)?{success:true,results:sql.prepare(s.q).all(...s.p)}:{success:true,results:[],meta:{changes:Number(sql.prepare(s.q).run(...s.p).changes)}});sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 let calls=0,clock=NOW,response=raw(),hook=null;const store=new RefreshStore(db,'sparse-test',()=>clock);await store.acquire();
 const h={sql,db,store,now:()=>clock,setClock:x=>clock=x,setRaw:x=>response=x,setHook:x=>hook=x,calls:()=>calls,progress:[]};
 h.queue=async events=>queueSparseGroups({db,store,groups:[group(events)],decisions,generationId:1,observedAt:AT});
 h.run=()=>repairSparseCatalog({db,store,adapter:createApibaraProvider(),now:h.now,onProgress:e=>h.progress.push(e.phase),getRequest:async()=>async spec=>{calls++;assert.equal(spec.identifier,VIN);await hook?.();return{response:{ok:true,data:response},observedAt:new Date(clock).toISOString()};}});return h;
}
test('partial price without evidence of an active lot does not cause mass historical discovery',async t=>{
 const h=await setup(t);assert.equal((await h.queue([event(100,{'pricing.current_bid_usd':4850})])).queued,0);assert.equal(await h.run(),null);assert.equal(h.calls(),0);
});
test('single missing LOT lookup uses the selective existing index despite competing recent-order indexes',async t=>{
 const h=await setup(t);h.sql.exec('CREATE INDEX idx_listings_public_platform_recent ON auction_listings(platform,last_seen_at DESC,listing_id ASC)');
 const original='SELECT * FROM auction_listings WHERE (platform=? AND lot=?) ORDER BY last_seen_at DESC,listing_id';let captured;
 const db=indexedLotReads({prepare:q=>{captured=q;return h.db.prepare(q);}});await db.prepare(original).bind('copart',LOT).all();
 assert.match(captured,/INDEXED BY idx_listings_lot_recent/);const plan=h.sql.prepare('EXPLAIN QUERY PLAN '+captured).all('copart',LOT);assert(plan.some(p=>p.detail.includes('idx_listings_lot_recent')&&p.detail.includes('lot=?')));
});
test('safe missing active record is inserted once with newer proved price and real source metadata clock',async t=>{
 const h=await setup(t);await h.queue();const result=await h.run();assert.equal(result.inserted,true);
 assert.deepEqual(h.progress,['source_received','preparing','prepared','committing','committed']);
 const row=h.sql.prepare('SELECT * FROM auction_listings').get();assert.equal(row.current_bid_usd,4850);assert.equal(row.buy_now_usd,5900);assert.equal(row.source_updated_at,'2026-11-18T18:55:20.000Z');
 assert.equal(h.sql.prepare('SELECT active,last_sequence FROM feed_catalog_membership').get().active,1);
 assert.equal(h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,100);
 assert.equal(h.sql.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='new:2026-11-18'").get().consumed,1);
 assert.equal(await h.run(),null);assert.equal(h.calls(),1);
});
test('newer full API version wins over older delta and previous_bid is never treated as current price',()=>{
 const c=candidate(group(),1,AT);const response=raw();response.updated_at='2026-11-18T19:50:00Z';response.pricing.current_bid_usd=5000;
 assert.equal(projectPrices(response,c).record.pricing.current_bid_usd,5000);
 const before=JSON.stringify(response);projectPrices(response,c);assert.equal(JSON.stringify(response),before);
 assert.equal(candidate(group([event(100,{'auction.upcoming':1,'pricing.previous_bid_usd':9999})]),1,AT).prices.current_bid_usd,undefined);
});
test('later feed sequence with older source version cannot erase a newer proved price',()=>{
 const c=candidate(group(),1,AT);
 const older={...event(101,{'pricing.current_bid_usd':0}),vehicle_updated_at:'2026-11-18T18:55:20Z'};
 const next=candidate(group([older]),2,AT,c);
 assert.equal(next.sequence,101);assert.equal(next.prices.current_bid_usd.value,4850);
 assert.equal(next.prices.current_bid_usd.sequence,100);
 assert.equal(projectPrices(raw(),next).record.pricing.current_bid_usd,4850);
 const equal={...event(102,{'pricing.current_bid_usd':4900})};
 assert.equal(candidate(group([equal]),3,AT,next).prices.current_bid_usd.value,4900);
});
test('pending recovery observes terminal-only groups even when ordinary importer does not request detail',async t=>{
 const h=await setup(t);await h.queue([event(99,{'auction.upcoming':1})]);
 await queueSparseGroups({db:h.db,store:h.store,groups:[group([event(100,{'auction.state':'ended'},'auction.ended')])],decisions:[],generationId:1,observedAt:AT});
 const c=JSON.parse(h.sql.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(PREFIX+'copart:'+LOT).cursor);assert(c.terminal);assert.equal(c.activeEvidence,false);assert.equal((await h.run()).skipped,true);assert.equal(h.calls(),0);
});
test('a late older Open observation cannot undo a newer terminal observation',()=>{
 const closed=candidate(group([event(99,{'auction.state':'ended'},'auction.ended')]),1,AT);
 const old={...event(100,{'auction.upcoming':1}),vehicle_updated_at:'2026-11-18T18:55:20Z'};
 const next=candidate(group([old]),1,AT,closed);assert(next.terminal);assert.equal(next.activeEvidence,false);
});
test('quiet pending lot remains recoverable after ninety minutes when global feed is current',async t=>{
 const h=await setup(t);await h.queue();h.setClock(NOW+91*60000);await h.store.acquire();h.sql.prepare('UPDATE server_feed_generations SET observed_at=?').run(new Date(h.now()).toISOString());
 assert.equal((await h.run()).inserted,true);
});
for(const kind of ['auction.ended','lot.removed','lot.sold'])test(kind+' never activates a missing historical record',async t=>{
 const h=await setup(t);await h.queue([event(99,{'auction.upcoming':1}),event(100,{},kind)]);await h.run();assert.equal(h.calls(),0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,0);
});
for(const what of ['platform','vin','lot'])test('source '+what+' conflict never writes a vehicle',async t=>{
 const h=await setup(t);await h.queue();const r=raw();if(what==='platform')r.platform='iaai';if(what==='vin')r.vin='WBX13EF09S5386118';if(what==='lot')r.lot_number='11111111';h.setRaw(r);assert.match((await h.run()).error,/IDENTITY/);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,0);
});
test('known row, source ended and source without confirmed future date cannot be published',async t=>{
 for(const mode of ['ended','undated']){const h=await setup(t);await h.queue();const r=raw();if(mode==='ended')r.auction.state='finished';else r.auction.auction_at=null;h.setRaw(r);await h.run();assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,0);}
});
test('lease/pointer race rolls back vehicle, membership, receipt and new-record counter together',async t=>{
 const h=await setup(t);await h.queue();h.setHook(()=>h.sql.exec("UPDATE feed_catalog_pointer SET baseline_id='other'"));const result=await h.run();assert.equal(result.inserted,undefined);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM feed_catalog_membership').get().n,0);
 assert.equal(h.sql.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='new:2026-11-18'").get().consumed,0);
});
test('queue merges later price-only evidence while rejecting changed VIN',async t=>{
 const h=await setup(t);await h.queue([event(99,{'auction.upcoming':1,'pricing.current_bid_usd':500})]);await h.queue([event(100,{'pricing.current_bid_usd':4850})]);await h.run();assert.equal(h.sql.prepare('SELECT current_bid_usd FROM auction_listings').get().current_bid_usd,4850);
 const c=candidate(group([event(99,{'auction.upcoming':1})]),1,AT);const changed=group([event(100,{'pricing.current_bid_usd':4850})]);changed.events[0].vehicle.vin='WBX13EF09S5386118';assert.equal(candidate(changed,1,AT,c).conflict,true);
});
test('queue extension commits one bounded statement with the existing checkpoint identity',async t=>{
 const h=await setup(t);const original=h.db.prepare("UPDATE automatic_refresh_budgets SET consumed=consumed WHERE budget_key='new:2026-11-18'").bind();
 const x=extendSparseRecovery({key:'existing-key',prepare:async()=>[original]},{generationId:1,observedAt:AT});assert.equal(x.key,'existing-key');assert.equal(x.sparseRepair,true);
 const statements=await x.prepare({db:h.db,store:h.store,receipt:{groups:[group()]},decisions});assert.equal(statements.length,2);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM automatic_refresh_tasks').get().n,0);await h.store.guarded(statements);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM automatic_refresh_tasks').get().n,1);
});
test('zero primary price stays unavailable even if an older secondary amount exists',async t=>{
 const h=await setup(t);await h.queue([event(100,{'auction.upcoming':1,'pricing.current_bid_usd':0})]);const r=raw();r.pricing.current_bid2_usd=9999;h.setRaw(r);await h.run();assert.equal(h.sql.prepare('SELECT current_bid_usd FROM auction_listings').get().current_bid_usd,null);
});
test('full pending queue still updates a queued price without admitting more records',async t=>{
 const h=await setup(t);await h.queue([event(99,{'auction.upcoming':1,'pricing.current_bid_usd':500})]);
 const put=h.sql.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,cursor,next_due_at) VALUES(?,'copart','pending','{}',?)");for(let i=0;i<127;i++)put.run(PREFIX+'dummy:'+i,AT);
 await h.queue([event(100,{'pricing.current_bid_usd':4850})]);
 assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM automatic_refresh_tasks WHERE status='pending'").get().n,128);
 assert.equal(JSON.parse(h.sql.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(PREFIX+'copart:'+LOT).cursor).prices.current_bid_usd.value,4850);
});
test('queue failure rolls back the associated checkpoint in the same transaction',async t=>{
 const h=await setup(t),extra=await prepareSparseQueue({db:h.db,store:h.store,groups:[group()],decisions,generationId:1,observedAt:AT});
 h.sql.exec("CREATE TRIGGER fail_sparse BEFORE INSERT ON automatic_refresh_tasks BEGIN SELECT RAISE(ABORT,'queue failure'); END");
 const checkpoint=h.db.prepare("UPDATE automatic_refresh_budgets SET consumed=1 WHERE budget_key='new:2026-11-18'").bind();
 await assert.rejects(h.store.guarded([checkpoint,...extra.statements]));
 assert.equal(h.sql.prepare("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='new:2026-11-18'").get().consumed,0);
});
test('server importer accepts the four existing membership statements plus one atomic sparse queue statement',async t=>{
 const h=await setup(t),groups=[group()],sources=[{generationId:1,sha256:'a'.repeat(64),records:1,firstSequence:100,lastSequence:100}];
 const dataset={identity:createHash('sha256').update(JSON.stringify({version:1,sources})).digest('hex'),databaseSha256:'d'.repeat(64),sources,records:1,quarantined:0,firstSequence:100,lastSequence:100,uniqueLots:1};
 const receipt={version:1,dataset,observedAt:AT,offset:0,eventOffset:0,quarantineOffset:0,groups};receipt.batchSha256=hashReceipt(receipt);
 const checkpointExtension=extendSparseRecovery({key:'membership:baseline',async prepare(){return Array.from({length:4},()=>h.db.prepare("UPDATE automatic_refresh_budgets SET consumed=consumed WHERE budget_key='new:2026-11-18'").bind());}},{generationId:1,observedAt:AT});
 const result=await importChangeBatch({db:h.db,store:h.store,receipt,namespace:'server',checkpointExtension});
 assert.equal(result.state.offset,1);assert.equal(h.sql.prepare('SELECT status FROM automatic_refresh_tasks WHERE task_key=?').get(PREFIX+'copart:'+LOT).status,'pending');
 assert.equal(h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,100);
});
