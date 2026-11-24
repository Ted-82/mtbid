'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=process.env.REXBID_TEST_ROOT||path.resolve(__dirname,'..');
const {createApibaraProvider}=require(root+'/providers/apibara.js');
const {prepareObservation}=require(root+'/sync/publication-refresh.cjs');
const {D1SyncRepository,knownObservationStatements}=require(root+'/sync/d1-repository.js');
const {POLICY,TARGETS,runAutomaticRefresh}=require(root+'/sync/automatic-refresh.cjs');
const provider=createApibaraProvider({fetch:async()=>{throw Error('NETWORK_FORBIDDEN');}});
const fixture=require(root+'/tests/fixtures/apibara-discovery-page-shape.json').response.data[0];
const observed='2026-10-20T16:44:32.912Z';
function database(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(fs.readFileSync(root+'/docs/proposals/0004_d1_sync_2.sql','utf8'));
 t.after(()=>sqlite.close());
 const db={prepare(query){return {sql:query,params:[],bind(...params){return {...this,params};},
  async run(){return {meta:{changes:Number(sqlite.prepare(query).run(...this.params).changes)}};},
  async all(){return {results:sqlite.prepare(query).all(...this.params)};},
  async first(){return sqlite.prepare(query).get(...this.params)||null;}};},
  async batch(items){sqlite.exec('BEGIN');try{const result=items.map(item=>/^\s*SELECT/i.test(item.sql)?
   {results:sqlite.prepare(item.sql).all(...item.params)}:{meta:{changes:Number(sqlite.prepare(item.sql).run(...item.params).changes)}});
   sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 return {db,sqlite};
}
function raw(vin){return {...structuredClone(fixture),platform:'iaai',lot_number:'44317677',vin,
 slug_vin:'saved-source-44317677',pricing:{current_bid_usd:0,buy_now_usd:null},
 auction:{state:'active',formatted:'Pre-bid',auction_at:'2026-10-21T12:00:00Z'}};}
async function prepare(db,vin){return prepareObservation({repo:new D1SyncRepository(db),provider,raw:raw(vin),
 platform:'iaai',observedAt:observed,processedAt:observed,freshnessPolicy:POLICY});}
for(const [label,input,expected] of [
 ['source NO VIN sentinel','NO VIN',null],
 ['source sentinel with separators',' no-vin ',null],
 ['formatted full VIN',' 1hgcm82633-a004352 ','1HGCM82633A004352'],
 ['masked VIN','1hgcm82633a******','1HGCM82633A******'],
 ['short hull identifier','HSX46991G990','HSX46991G990'],
 ['missing VIN',null,null]
]){
 test(label+' keeps vehicle and identity consistent through actual D1 persistence',async t=>{
  const {db,sqlite}=database(t),prepared=await prepare(db,input);
  assert.equal(prepared.record.vehicle.vin,expected);
  assert.equal(prepared.record.identity.vinCandidate,expected);
  assert.equal(prepared.record.identity.vehicleIdentityState,'unresolved');
  const statements=await knownObservationStatements(db,prepared.record);
  await db.batch(statements.statements);
  const saved=sqlite.prepare('SELECT vin_normalized,current_bid_usd,summary_synced_at FROM auction_listings').get();
  assert.equal(saved.vin_normalized,expected);
  assert.equal(saved.current_bid_usd,0);
  assert.equal(saved.summary_synced_at,observed);
 });
}
test('missing source VIN preserves an earlier full VIN and stable listing identity',async t=>{
 const {db,sqlite}=database(t),first=await prepare(db,'1HGCM82633A004352');
 await db.batch((await knownObservationStatements(db,first.record)).statements);
 const second=await prepare(db,'NO VIN');
 assert.equal(second.record.vehicle.vin,'1HGCM82633A004352');
 assert.equal(second.record.identity.listingId,first.record.identity.listingId);
 await db.batch((await knownObservationStatements(db,second.record)).statements);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,1);
});
test('strict identity guard still rejects a tampered canonical VIN',async t=>{
 const {db}=database(t),prepared=await prepare(db,'1HGCM82633A004352');
 prepared.record.vehicle.vin='2HGCM82633A004352';
 await assert.rejects(knownObservationStatements(db,prepared.record),/KNOWN_OBSERVATION_IDENTITY_INVALID/);
});
test('automatic refresh rejects a new NO VIN row locally and continues the next platform',async t=>{
 const {db,sqlite}=database(t);
 sqlite.exec(fs.readFileSync(root+'/docs/proposals/0008_automatic_refresh.sql','utf8'));
 const missing={...raw('NO VIN'),platform:'copart'};
 const healthy={...raw('1HGCM82633A004352'),lot_number:'44317678'};
 const replies=[
  {ok:true,data:{plan:{name:'Basic',per_page_limit:20},quota:{used:5836,limit:30000,left:24164}}},
  {ok:true,data:[missing],meta:{next_cursor:null}},
  {ok:true,data:[healthy],meta:{next_cursor:null}}
 ];
 let calls=0;
 const adapter={...provider,async request(){assert.ok(calls<replies.length);return replies[calls++];}};
 const result=await runAutomaticRefresh({db,provider:adapter,now:()=>Date.parse(observed),wait:async()=>{},
  env:{REXBID_AUTO_REFRESH_ENABLED:'enabled',REXBID_AUTO_REFRESH_DATABASE_ID:TARGETS[0]}});
 assert.equal(result.ok,true);assert.equal(result.rejected,1);assert.equal(result.inserted,1);
 assert.equal(result.listPages,2);assert.equal(calls,3);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM auction_listings').get().n,1);
 assert.equal(sqlite.prepare('SELECT vin_normalized FROM auction_listings').get().vin_normalized,healthy.vin);
 assert.equal(sqlite.prepare('SELECT blocked_reason FROM automatic_refresh_state').get().blocked_reason,null);
});
