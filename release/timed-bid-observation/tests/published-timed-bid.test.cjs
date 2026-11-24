'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto'),{gzipSync}=require('node:zlib');
const source=require('./iaai-118801774.json'),root=process.env.TIMED_TEST_EXECUTOR;
const {importChangeBatch,hashReceipt}=require(path.join(root,'sync/feed-change-import.cjs'));
const {RefreshStore}=require(path.join(root,'sync/automatic-refresh.cjs'));
const {readTimed}=require('../../public-site/sync/timed-iaai-read.cjs');
const {effectiveBid,SQL}=require('../../public-site/sync/timed-bid-read.cjs');
const {normalize}=require('../../public-site/sync/timed-iaai-refresh.cjs');
const at='2026-11-24T20:47:48.616Z',baseline='2026-11-22T06:28:14.000Z',observed='2026-11-24T20:01:32.326Z',end='2026-11-24T23:59:00.000Z';
const lot=source.vehicle.lot_number,vin=source.vehicle.vin;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function receipt(event){
 const firstSequence=event.sequence,lastSequence=event.sequence;
 const sources=[{generationId:23361,sha256:'a'.repeat(64),records:1,firstSequence,lastSequence}];
 const dataset={identity:hash({version:1,sources}),databaseSha256:hash(event),sources,records:1,quarantined:0,firstSequence,lastSequence,uniqueLots:1};
 const value={version:1,dataset,observedAt:at,offset:0,eventOffset:0,quarantineOffset:0,groups:[{lot,platform:'iaai',events:[event],quarantinedSequences:[]}]};
 return {...value,batchSha256:hashReceipt(value)};
}
function fixture(t,{migration=true}={}){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sql.exec(fs.readFileSync(path.join(root,'docs/proposals',file),'utf8'));
 if(migration)sql.exec(fs.readFileSync(path.resolve(__dirname,'../001_timed_bid_evidence.sql'),'utf8'));
 const bind=(table,data)=>sql.prepare('INSERT INTO '+table+'('+Object.keys(data)+') VALUES('+Object.keys(data).map(()=>'?')+')').run(...Object.values(data));
 bind('vehicle_sources',{source_key:'s',provider:'apibara',platform:'iaai',identity_state:'resolved',first_seen_at:baseline,last_seen_at:baseline,created_at:baseline,updated_at:baseline});
 bind('auction_listings',{listing_id:'l',source_key:'s',platform:'iaai',lot,vin_normalized:vin,identity_state:'resolved',
  source_updated_at:baseline,first_seen_at:baseline,last_seen_at:baseline,summary_synced_at:baseline,created_at:baseline,updated_at:baseline,
  auction_state:'open',source_status:'Timed',is_timed:1,timed_end_at:end,current_bid_usd:8000});
 let fault=false;const queries=[],batches=[];
 const db={prepare(q){return{bind(...params){return{q,params,sql:q,all:async()=>{queries.push(q);return{results:sql.prepare(q).all(...params)};},first:async()=>sql.prepare(q).get(...params)??null,
 run:async()=>({meta:{changes:Number(sql.prepare(q).run(...params).changes)}})};}};},async batch(stmts){
 sql.exec('BEGIN');try{const result=stmts.map(s=>{if(fault&&s.sql.includes('automatic_refresh_tasks')&&s.sql.startsWith('INSERT'))throw Error('test checkpoint failure');
 return {meta:{changes:Number(sql.prepare(s.sql).run(...s.params).changes)}};});sql.exec('COMMIT');batches.push(stmts.map(s=>s.sql));return result;}catch(e){sql.exec('ROLLBACK');throw e;}
 }};
 const now=Date.parse(at),store=new RefreshStore(db,'timed-proof-test',()=>now);
 const entry=normalize({platform:'iaai',lot_number:lot,vin,manufacturer:'Audi',model:'S5',title:'2018 Audi S5',year:2018,
  updated_at:observed,auction:{state:'open',is_timed:true,timed_end_at:end},pricing:{current_bid_usd:8000},media:{}},Date.parse(observed));
 const bytes=gzipSync(JSON.stringify({schema:1,observed,entries:[entry]}));
 const bucket={get:async()=>({size:bytes.length,body:new Blob([bytes]).stream()})};
 const env={REXBID_TIMED_IAAI_ENABLED:'enabled',REXBID_AUCTION_ARCHIVE:bucket,REXBID_ACTIVE_CATALOG:db};
 const probe=async target=>{const r=await readTimed(new Request('https://local.test'+target),env,async()=>({response:new Response(null,{status:404})}),now);return(await r.response.json()).data;};
 return{sql,db,store,entry,probe,queries,batches,fault:v=>{fault=v;},row:()=>sql.prepare('SELECT * FROM auction_listings').get(),
 apply:e=>importChangeBatch({db,store,namespace:'server',receipt:receipt(e)})};
}
test('real event 118801774 moves detail by VIN and LOT plus catalog price filters, with original transaction, idempotent retry and indexed batch read',async t=>{
 const f=fixture(t);await f.store.acquire();assert.equal((await f.probe('/api/car/'+vin+'?platform=iaai')).pricing.current_bid_usd,8000);
 const first=await f.apply(source);assert.equal(first.state.updatedGroups,1);
 const written=f.row(),pr=JSON.parse(written.timed_bid_evidence);assert.equal(pr.bid,8100);assert.equal(pr.seq,118801774);assert.equal(pr.at,'2026-11-24T20:07:24.000Z');assert.equal(written.last_seen_at,baseline);
 const sameBatch=f.batches.find(batch=>batch.some(s=>s.startsWith('UPDATE auction_listings')));assert.equal(sameBatch.filter(s=>s.startsWith('UPDATE auction_listings')).length,1);assert(sameBatch.some(s=>s.includes('automatic_refresh_tasks')));
 assert.equal((await f.apply(source)).alreadyApplied,true);
 for(const id of [vin,lot]){const data=await f.probe('/api/car/'+id+'?platform=iaai');assert.equal(data.pricing.current_bid_usd,8100);assert.equal(data.pricing.final_price_usd,null);}
 f.queries.length=0;assert.equal((await f.probe('/api/cars?category=timed&price_min=8100&sort=bid_desc'))[0].pricing.current_bid_usd,8100);
 assert.equal((await f.probe('/api/cars?category=timed&price_max=8050&sort=bid_asc')).length,0);assert.equal(f.queries.filter(q=>q===SQL).length,1);
 const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+SQL).all(JSON.stringify([lot]));assert(plan.some(v=>/SEARCH l USING INDEX idx_listings_lot_recent/.test(v.detail)));
 assert.equal((await f.probe('/api/cars?category=timed&view=showcase'))[0].pricing.current_bid_usd,8100);
});
test('newer lower bid replaces higher, never the final price; missing time, new scan, changed cycle and ambiguous generation preserve snapshot',async t=>{
 const f=fixture(t);await f.store.acquire();await f.apply(source);
 const correction=structuredClone(source);correction.sequence++;correction.event_id='chg_test_down';correction.before['pricing.current_bid_usd']=8100;correction.after['pricing.current_bid_usd']=7800;
 correction.recorded_at=correction.vehicle_updated_at='2026-11-24T20:12:24Z';await f.apply(correction);
 const data=await f.probe('/api/car/'+lot+'?platform=iaai');assert.equal(data.pricing.current_bid_usd,7800);assert.equal(data.pricing.final_price_usd,null);
 const w=f.row(),now=Date.parse(at),orig=f.entry;const effective=(r,s=Date.parse(observed),e=orig)=>effectiveBid(e,r,s,now).pricing.current_bid_usd;
 assert.equal(effective(w),7800);assert.equal(effective(w,Date.parse('2026-11-24T20:15:00Z')),8000);
 assert.equal(effective({...w,timed_bid_evidence:null}),8000);assert.equal(effective({...w,timed_end_at:'2026-11-25T23:59:00Z'}),8000);
 assert.equal(effective({...w,vin_normalized:'1FADP5AU8DL509002'}),8000);assert.equal(effective({...w,listing_generation:2}),8000);
 assert.equal(effective(w,Date.parse(observed),{...orig,timed_source_cycle:'another-cycle'}),8000);
 assert.equal(effective({...w,timed_bid_evidence:JSON.stringify({...JSON.parse(w.timed_bid_evidence),at:null})}),8000);
});
test('rollback on checkpoint failure and older schemas stay operational',async t=>{
 const f=fixture(t);await f.store.acquire();f.fault(true);await assert.rejects(f.apply(source),/AUTOMATIC_REFRESH_WRITE_FAILED/);
 assert.equal(f.row().current_bid_usd,8000);assert.equal(f.row().timed_bid_evidence,null);f.fault(false);
 assert.equal((await f.apply(source)).state.updatedGroups,1);
 const old=fixture(t,{migration:false});await old.store.acquire();assert.equal((await old.apply(source)).state.updatedGroups,1);
 assert.equal(old.row().current_bid_usd,8100);assert.equal((await old.probe('/api/car/'+lot+'?platform=iaai')).pricing.current_bid_usd,8000);
});
