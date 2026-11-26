'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {CatalogJournal,detailSpec,checkDetail,historyPartition,persistObservation,persistHistory}=require('../scripts/catalog-refresh-campaign.cjs');
const {prepareObservation}=require('../sync/publication-refresh.cjs');
const {knownObservationStatements,D1SyncRepository}=require('../sync/d1-repository.js');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const {HISTORY_FAILURE_SQL}=require('../scripts/targeted-history-import.cjs');
const provider=require('../providers/apibara.js').createApibaraProvider();
const policy={hotIntervalMs:300000,warmIntervalMs:21600000,coldIntervalMs:604800000,hotWindowMs:7200000};
const observe=(...args)=>persistObservation(...args,policy);
const fixture=require('./fixtures/apibara-discovery-page-shape.json').response.data[0];
const vin='5YJ3E1EA4NF186754',at='2026-10-08T10:00:00.000Z';
const raw=(platform='iaai',lot='43806658',bid=0)=>({...structuredClone(fixture),platform,lot_number:lot,vin,slug_vin:'source-'+vin,auction:{state:'active',formatted:'Pre-bid',auction_at:'2026-10-09T16:00:00Z'},pricing:{current_bid_usd:bid,buy_now_price_usd:2000},history:[]});
const target=(platform='iaai',lot='43806658')=>({platform,lot,vin_normalized:vin,listing_id:platform+lot,provider_vehicle_id:'source-'+vin});
function database(){const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0004_d1_sync_2.sql'),'utf8'));sql.exec('PRAGMA foreign_keys=ON');const db={prepare(query){return {sql:query,params:[],bind(...params){return {...this,params};},async all(){return {results:sql.prepare(query).all(...this.params)};},async first(){return sql.prepare(query).get(...this.params)||null;}};},async batch(items){sql.exec('BEGIN');try{const rows=items.map(x=>/^\s*SELECT\b/i.test(x.sql)?{results:sql.prepare(x.sql).all(...x.params)}:{results:[],meta:{changes:Number(sql.prepare(x.sql).run(...x.params).changes)}});sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};return {db,sql};}
async function seed(db,value){const p=await prepareObservation({repo:new D1SyncRepository(db),provider,raw:value,platform:value.platform,observedAt:at,processedAt:at,freshnessPolicy:policy});const b=await knownObservationStatements(db,p.record);await db.batch(b.statements);return {...target(value.platform,String(value.lot_number)),listing_id:p.record.identity.listingId};}
function journal(maxRequests=6){return new CatalogJournal({directory:fs.mkdtempSync(path.join(__dirname,'../.codex-wrangler-cache/rex-catalog-')),baseAttempts:101,maxRequests,targetHash:'fixed'});}
test('catalog journal keeps prior attempts and counts a bounded transient retry before transport',async()=>{const j=journal();let n=0;const r=await j.request({operation:'detail'},async()=>{if(!n++)throw Object.assign(Error('UPSTREAM'),{code:'UPSTREAM',status:503});return {ok:true};},{wait:async()=>{}});assert.equal(r.number,2);assert.equal(j.attempts()[1].combined,103);assert.equal(j.attempts()[1].retry,true);});
test('catalog retry never exceeds the durable budget',async()=>{const j=journal(1);await assert.rejects(j.request({operation:'detail'},async()=>{throw Object.assign(Error('TIMEOUT'),{code:'TIMEOUT'});},{wait:async()=>{}}),/CATALOG_QUOTA/);assert.equal(j.attempts().length,1);});
test('catalog authentication, exhausted quota and not found are not retried',async()=>{for(const [code,status,quotaExhausted]of [['AUTH',401,false],['RATE_LIMITED',429,true],['NOT_FOUND',404,false]]){const j=journal();await assert.rejects(j.request({operation:'detail'},async()=>{throw Object.assign(Error(code),{code,status,quotaExhausted});}));assert.equal(j.attempts().length,1);}});
test('catalog persistence exception never retries a successful provider response',async()=>{const j=journal();let calls=0;await assert.rejects(j.request({operation:'detail'},async()=>{calls++;return {};},{onSuccess:async()=>{throw Error('WRITE_FAILED');}}),/WRITE_FAILED/);assert.equal(calls,1);assert.throws(()=>j.assertAvailable(),/INTERRUPTED/);});
test('catalog resume retains completed targets and cannot replace its manifest',()=>{const j=journal();j.finish('iaai:1',{result:'empty'});assert.equal(new CatalogJournal({directory:j.directory,baseAttempts:101,maxRequests:6,targetHash:'fixed'}).completed('iaai:1'),true);assert.throws(()=>new CatalogJournal({directory:j.directory,baseAttempts:101,maxRequests:6,targetHash:'changed'}),/RESUME_MANIFEST/);});
test('catalog uses the stored provider slug; no guessed platform identifier',()=>{assert.equal(detailSpec(target()).identifier,'source-'+vin);assert.equal(detailSpec(target()).include,'history,vin_lots');assert.equal(detailSpec(target(),{includeHistory:false}).include,undefined);});
test('catalog rejects a foreign VIN or platform or lot before write',()=>{for(const change of [{vin:'W1KCG4EB1NA018119'},{platform:'copart'},{lot_number:'99999999'}])assert.throws(()=>checkDetail({...raw(),...change},target()),/IDENTITY_MISMATCH/);});
test('VIN history keeps event lot and platform, and partitions only verified known listings',()=>{const other=target('copart','57660876');const value=raw();value.history=[{platform:'iaai',lot_number:43806658,date:'2026-08-20',price:2050,status:'Sold on Approval'},{platform:'copart',lot_number:57660876,date:'2026-09-01',price:3000,status:'Sold'}];const p=historyPartition(provider,value,target(),[target(),other]);assert.equal(p.complete,true);assert.equal(p.groups.size,2);assert.equal(p.groups.get('copart:57660876').events[0].platform,'copart');});
test('history from an unknown related lot stays partial rather than a falsely complete empty result',()=>{const value=raw();value.history=[{platform:'copart',lot_number:99999999,date:'2026-09-01',price:3000,status:'Sold'}];const p=historyPartition(provider,value,target(),[target()]);assert.equal(p.related.length,1);assert.equal(p.complete,false);assert.equal(p.groups.get('iaai:43806658').events.length,0);});
test('history missing identity and pagination end remain partial',()=>{for(const value of [{...raw(),history:[{date:'2026-09-01',price:2,status:'Sold'}]},{...raw(),history:{data:[],meta:{}}}])assert.equal(historyPartition(provider,value,target(),[target()]).complete,false);});
test('history empty is confirmed only after successful source end',()=>{assert.equal(historyPartition(provider,raw(),target(),[target()]).complete,true);assert.throws(()=>historyPartition(provider,{...raw(),history:null},target(),[target()]),/SHAPE/);});
test('paginated VIN history requires the previously verified anchor and end cursor',()=>{assert.throws(()=>historyPartition(provider,[],target(),[target()],{mode:'paginated',meta:{next_cursor:null}}),/ANCHOR/);assert.equal(historyPartition(provider,[],target(),[target()],{mode:'paginated',anchorVerified:true,meta:{next_cursor:null}}).complete,true);});
test('history foreign VIN never reaches an event partition',()=>{assert.throws(()=>historyPartition(provider,{...raw(),history:[{vin:'W1KCG4EB1NA018119',platform:'iaai',lot_number:43806658,date:'2026-09-01',price:2,status:'Sold'}]},target(),[target()]),/IDENTITY_MISMATCH/);});
test('known detail refresh preserves confirmed zero; null clears yesterday bid and adds an actual observation',async()=>{const {db,sql}=database();const t=await seed(db,raw('iaai','43806658',100));await observe(db,provider,raw(),t,'2026-10-08T11:00:00.000Z');assert.equal(sql.prepare('SELECT current_bid_usd FROM auction_listings').get().current_bid_usd,0);await observe(db,provider,raw('iaai','43806658',null),t,'2026-10-08T12:00:00.000Z');assert.equal(sql.prepare('SELECT current_bid_usd FROM auction_listings').get().current_bid_usd,null);assert.deepEqual(sql.prepare('SELECT current_bid_usd FROM auction_listing_snapshots ORDER BY observed_at').all().map(x=>x.current_bid_usd),[100,0,null]);sql.close();});
test('replay does not create a second snapshot and older observation cannot restamp a listing',async()=>{const {db,sql}=database();const t=await seed(db,raw());await observe(db,provider,raw(),t,at);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,1);const r=await observe(db,provider,raw('iaai','43806658',100),t,'2026-10-07T10:00:00Z');assert.equal(r.skipped,'older_observation');assert.equal(sql.prepare('SELECT current_bid_usd FROM auction_listings').get().current_bid_usd,0);sql.close();});
test('conditional bid stays separate from sold final price and each known lot receives its own events',async()=>{const {db,sql}=database();const t=await seed(db,raw()),other=await seed(db,raw('copart','57660876'));const value={...raw(),history:[{platform:'iaai',lot_number:43806658,date:'2026-08-20',price:2050,status:'Sold on Approval'},{platform:'copart',lot_number:57660876,date:'2026-09-01',price:3000,status:'Sold'}]};await persistHistory(db,provider,value,t,[t,other],'2026-10-08T12:00:00Z');const rows=sql.prepare('SELECT platform,lot,final_price_usd FROM auction_events ORDER BY platform').all();assert.equal(rows[0].lot,'57660876');assert.equal(rows[0].final_price_usd,3000);assert.equal(rows[1].final_price_usd,null);assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);sql.close();});
test('a partially identified source result cannot create a fetched-empty receipt',async()=>{const {db,sql}=database();const t=await seed(db,raw());await persistHistory(db,provider,{...raw(),history:[{platform:'copart',lot_number:99999999,date:'2026-09-01',price:3000,status:'Sold'}]},t,[t],'2026-10-08T12:00:00Z');const receipt=sql.prepare("SELECT status,last_complete_at FROM provider_sync_scopes WHERE operation='history_refresh'").get();assert.equal(receipt.status,'partial');assert.equal(receipt.last_complete_at,null);sql.close();});

test('failed refresh retains the last observation but removes it from current categories until a successful read',async()=>{
 const {db,sql}=database();const t=await seed(db,raw());
 sql.exec("UPDATE vehicle_sources SET last_error_code='NOT_FOUND',last_attempt_at='2026-10-08T11:00:00.000Z',sync_status='failed'");
 const repo=new D1ReadRepository(db,{now:()=>Date.parse('2026-10-08T11:01:00Z'),maxAgeMs:86400000});
 const saved=await repo.getListingById(t.listing_id);
 assert.equal(saved.freshness.status,'stale');assert.equal(saved.freshness.last_synced_at,at);
 assert.equal((await repo.listCatalog({category:'active'})).records.length,0);
 assert.equal((await repo.listCatalog()).records.length,1);
 await observe(db,provider,raw(),t,'2026-10-08T12:00:00.000Z');
 assert.equal(sql.prepare('SELECT last_error_code FROM vehicle_sources').get().last_error_code,null);
 assert.equal((await repo.getListingById(t.listing_id)).freshness.status,'fresh');sql.close();
});

test('history error is not empty and preserves previous events and successful receipt time',async()=>{
 const {db,sql}=database();const t=await seed(db,raw());
 const value={...raw(),history:[{platform:'iaai',lot_number:43806658,date:'2026-08-20',price:2050,status:'Sold on Approval'}]};
 await persistHistory(db,provider,value,t,[t],'2026-10-08T12:00:00Z');
 const failed='2026-10-08T13:00:00Z';
 await db.batch([db.prepare(HISTORY_FAILURE_SQL).bind('history-import:'+t.listing_id,'apibara','iaai',failed,'UPSTREAM',failed,t.listing_id,'iaai','43806658')]);
 const repo=new D1ReadRepository(db);const events=await repo.getConfirmedEvents({listingId:t.listing_id});
 const result=await repo.getHistoryAvailability({listingId:t.listing_id,events});
 assert.equal(result.state,'read_failed');assert.equal(events.length,1);
 assert.equal(sql.prepare("SELECT last_success_at FROM provider_sync_scopes WHERE operation='history_refresh'").get().last_success_at,'2026-10-08T12:00:00.000Z');sql.close();
});

test('elapsed timed-auction clock alone cannot become a confirmed ended status on the card',()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');
 const fn=html.slice(html.indexOf('  function auctionPhase()'),html.indexOf('  function auctionStatusLabel()'));
 const context={car:{auction:{is_timed:true,schedule_status:'timed'}},getAuctionStatus:()=> 'open',getAuctionStart:()=> '2026-01-01T10:00:00Z',getAuctionEnd:()=> '2026-01-01T11:00:00Z',getFinalBid:()=>null,isEmpty:x=>x===null};
 vm.createContext(context);vm.runInContext(fn,context);
 assert.equal(context.auctionPhase(),'unconfirmed');
 context.car.auction.schedule_status='ended';assert.equal(context.auctionPhase(),'ended');
});

test('detail outcome survives D1 and public DTO; conditional and unsold values never become sale prices',async()=>{
 const {toPublicVehicleDTO}=require('../sync/d1-read-repository.js');
 for(const status of ['Sold on Approval','Not Sold','Sold']){
  const {db,sql}=database();const t=await seed(db,raw());
  const value=raw();value.auction={...value.auction,state:'finished',outcome_status:status,last_sold_status:status};
  value.pricing={...value.pricing,last_sold_price_usd:2975,sale_price_usd:2975};
  await observe(db,provider,value,t,'2026-10-08T12:00:00.000Z');
  const dto=toPublicVehicleDTO((await new D1ReadRepository(db).getListingById(t.listing_id)).vehicle);
  assert.equal(dto.auction.outcome_status,status);
  assert.equal(dto.pricing.final_price_usd,status==='Sold'?2975:null);
  if(status!=='Sold')assert.equal(dto.pricing.source_price_usd,2975);
  sql.close();
 }
});
