'use strict';
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite'),test=require('node:test'),assert=require('node:assert/strict');
const {data,init,run,schemas,pageQuery}=require('./fixtures/known-bid-harness.cjs');
const {captureBid,rememberPaidBid}=require('../sync/feed-known-bid.cjs');
const {countedFeedRequest}=require('../sync/feed-api-request.cjs');
const T=Date.parse(data.at);
function adapter(sql){
 const prep=(q,p=[])=>({q,p,bind:(...args)=>prep(q,args),async first(){return sql.prepare(q).get(...p)??null;},async all(){return {results:sql.prepare(q).all(...p)};},
 async run(){return {success:true,meta:{changes:Number(sql.prepare(q).run(...p).changes)}};}});
 return {prepare:prep,async batch(a){sql.exec('BEGIN');try{const results=[];for(const x of a)results.push(await x.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
async function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const f of schemas)sql.exec(fs.readFileSync(path.resolve(__dirname,'../docs/proposals',f),'utf8'));
 const args=await init(adapter(sql),T),query=q=>sql.prepare(q).get(),price=()=>query('SELECT current_bid_usd FROM auction_listings').current_bid_usd;
 let calls=0;const transport=async url=>{calls++;assert.ok(String(url).includes(data.row.lot));return Response.json({ok:true,data:data.raw});};
 return {sql,args,query,price,transport,calls:()=>calls};
}
test('real Tesla missing bid is verified once on idle poll, without changing feed state, vehicle age or sale price',async t=>{
 const h=await fixture(t);assert.equal(h.price(),null);
 const before=h.query('SELECT committed_sequence FROM server_feed_state');
 assert.deepEqual(await run(h.args,h.transport),{saved:true,source:'counted_detail',extraDetails:1});assert.equal(h.price(),70);
 assert.equal(h.query('SELECT summary_synced_at FROM auction_listings').summary_synced_at,data.row.summary_synced_at);
 assert.equal(h.query('SELECT final_price_usd FROM auction_listings').final_price_usd,null);
 assert.equal(h.query('SELECT count(*) n FROM auction_listing_snapshots WHERE current_bid_usd=70 AND observed_at=?'.replace('?',"'"+data.at+"'")).n,1);
 assert.deepEqual(h.query('SELECT committed_sequence FROM server_feed_state'),before);
 assert.equal(h.query("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='day:2026-11-24'").consumed,1);
 await run(h.args,h.transport);assert.equal(h.calls(),1);
});
test('existing authenticated response is reused without spending a second request',async t=>{
 const h=await fixture(t);
 const call=await countedFeedRequest({...h.args,fetchImpl:h.transport});
 await call({operation:'vehicleByIdentifier',platform:'copart',identifier:data.row.lot});
 assert.deepEqual(await run(h.args,h.transport),{saved:true,source:'already_read',extraDetails:0});assert.equal(h.price(),70);assert.equal(h.calls(),1);
});
test('accepts no zero, unknown, conditional, terminal, stale, wrong platform, wrong lot, wrong VIN or different scheduled cycle',async t=>{
 const changes=[r=>r.pricing.current_bid_usd=0,r=>r.pricing.current_bid_usd=null,r=>r.auction.phase='awaiting_result',r=>r.auction.result_confirmed=true,r=>r.auction.outcome_status='Sold on Approval',r=>r.platform='iaai',r=>r.vin='1B7GG32X82S697320',r=>r.lot_number='65917836',r=>r.auction.auction_at='2026-11-25T07:00:00Z',r=>r.updated_at='2026-10-25T00:00:00Z',r=>r.pricing.current_bid_at='2036-11-25T00:00:00Z'];
 for(const mutate of changes){const h=await fixture(t),raw=structuredClone(data.raw);mutate(raw);await run(h.args,async()=>Response.json({ok:true,data:raw}));assert.equal(h.price(),null);assert.equal(h.query('SELECT count(*) n FROM auction_listing_snapshots').n,0);}
});
test('an intermediate change in state, amount, member, or global checkpoint wins and rolls the optional observation back',async t=>{
 for(const change of ["UPDATE auction_listings SET auction_state='ended',final_price_usd=100","UPDATE auction_listings SET current_bid_usd=82","UPDATE feed_catalog_membership SET last_sequence=118796735","UPDATE server_feed_state SET committed_sequence=118796736"]){
  const h=await fixture(t);await assert.rejects(run(h.args,async()=>{h.sql.exec(change);return Response.json({ok:true,data:data.raw});}));assert.notEqual(h.price(),70);assert.equal(h.query('SELECT count(*) n FROM auction_listing_snapshots').n,0);
 }
});
test('quota guard, upcoming main queue, storage and observation age protect the publishing path',async t=>{
 const h=await fixture(t);assert.equal(await run(h.args,h.transport,{result:{capturedPending:1}}),null);
 await run(h.args,h.transport,{reservation:{window:{writes:20055200,writeLimit:20055300,reads:0,readLimit:500000}}});
 h.sql.exec('UPDATE automatic_refresh_state SET quota_left=30000');
 rememberPaidBid(h.args.store,data.raw,new Date(T-31000).toISOString());
 await run(h.args,h.transport);assert.equal(h.calls(),0);assert.equal(h.price(),null);
 const plan=h.sql.prepare('EXPLAIN QUERY PLAN '+pageQuery).all('isolated',data.at,new Date(T+86400000).toISOString(),data.at,'').map(r=>r.detail);
 assert.ok(plan.some(p=>p.includes('SEARCH l USING INDEX idx_listings_catalog')));assert.ok(plan.every(p=>!p.includes('SCAN l')&&!p.includes('TEMP B-TREE')));
 assert.equal(captureBid({...data.raw,pricing:{current_bid_usd:0}},data.at),null);
});
test('stale account quota spends only the ledger refresh slot, then waits a full interval before any detail',async t=>{
 const h=await fixture(t);h.sql.prepare('UPDATE automatic_refresh_state SET quota_checked_at=?').run(new Date(T-25*3600000).toISOString());
 let calls=0;
 const actual=await run(h.args,async url=>{
  calls++;assert.ok(!String(url).includes(data.row.lot));
  return Response.json({ok:true,data:{quota:{used:24660,left:75340,limit:100000},plan:{name:'Pro',per_page_limit:100}}});
 });
 assert.equal(calls,1);assert.equal(actual.source,'quota_refreshed');assert.equal(h.price(),null);
 await run(h.args,h.transport);assert.equal(h.calls(),0);
 assert.equal(h.query("SELECT consumed FROM automatic_refresh_budgets WHERE budget_key='day:2026-11-24'").consumed,1);
});
test('a permanently missing first lot advances fairly and later candidates can be verified',async t=>{
 const h=await fixture(t),id='test:second-lot';
 const row=h.sql.prepare('SELECT * FROM auction_listings').get();
 row.listing_id=id;row.lot='65054067';row.source_listing_id=row.lot;
 const keys=Object.keys(row);h.sql.prepare('INSERT INTO auction_listings('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));
 h.sql.prepare("INSERT INTO feed_catalog_membership VALUES('isolated',?,1,75639067)").run(id);
 await assert.rejects(run(h.args,async()=>new Response(null,{status:404})));
 const task=h.query("SELECT * FROM automatic_refresh_tasks WHERE task_key='feed-known-bid:cursor:v1'");assert.equal(JSON.parse(task.cursor).id,data.row.listing_id);
 assert.equal(Date.parse(task.next_due_at)-T,300000);
 const now=T+300000;h.args.now=()=>now;h.args.store.now=()=>now;
 const result=await run(h.args,async url=>{assert.ok(String(url).includes(row.lot));return Response.json({ok:true,data:{...data.raw,lot_number:row.lot}});});
 assert.equal(result.saved,true);assert.equal(h.sql.prepare('SELECT current_bid_usd FROM auction_listings WHERE listing_id=?').get(id).current_bid_usd,70);
});
test('missing policy, missing resource measurements and future-dated quota cannot buy any detail',async t=>{
 const h=await fixture(t);
 for(const args of [{control:{databaseSizeBytes:2428416000}},{state:{...h.args.state,accountBudget:{}}},{usage:{rowsRead:1,rowsWritten:0,statements:3}},{usage:{unknown:false,rowsWritten:1,statements:3}}]){
  await run({...h.args,...args},h.transport);
 }
 h.sql.prepare('UPDATE automatic_refresh_state SET quota_checked_at=?').run(new Date(T+1000).toISOString());
 await run(h.args,h.transport);assert.equal(h.calls(),0);assert.equal(h.price(),null);
});
