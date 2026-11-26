const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {importTargetedHistory}=require('../scripts/targeted-history-import.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const ROOT=path.join(__dirname,'..');
function block(file,start,end){const s=fs.readFileSync(path.join(ROOT,file),'utf8');return s.slice(s.indexOf('  function '+start+'('),s.indexOf('  function '+end+'('));}
function pricing(){const context={formatMoney:x=>String(x),window:{},document:{},car:{},isEmpty:x=>x===null||x===undefined||x==='',auctionPhase:()=> 'waiting',getBuyNow:()=>null};vm.createContext(context);
 vm.runInContext(block('public/index.html','hasApprovalPendingOutcome','getAuctionStatusLabel')+block('public/index.html','marketAislePriceInfo','renderMarketAisleCard')+block('public/car.html','getCurrentBid','getAuctionBid')+block('public/ulubione.html','priceInfo','render')+';globalThis.api={getPriceInfo,marketAislePriceInfo,getCurrentBid,priceInfo};',context);return context;}
test('source zero means unavailable, positive bids and Buy Now remain distinct on Home/catalog/detail/favorites',()=>{const c=pricing();
 for(const value of [0,'0',25,null,undefined,'',' ',false,-1]){const known=value===25;c.car={auction:{state:'open'},pricing:{current_bid_usd:value}};
  assert.equal(c.api.getCurrentBid()===null,!known,String(value));assert.equal(c.api.getPriceInfo(c.car).value===null,!known,String(value));
  assert.equal(c.api.marketAislePriceInfo(c.car,'electric').value===null,!known,String(value));assert.equal(c.api.priceInfo(c.car)[1]===null,!known,String(value));}
 c.car={auction:{state:'open'},pricing:{current_bid_usd:0,current_bid2_usd:450,buy_now_usd:2000}};
 assert.equal(c.api.getCurrentBid(),null);assert.equal(c.api.getPriceInfo(c.car).value,2000);
 assert.equal(c.api.marketAislePriceInfo(c.car,'buy-now').value,2000);assert.equal(c.api.marketAislePriceInfo(c.car,'buy-now').secondary,'');
 assert.equal(c.api.priceInfo(c.car)[1],2000);
});
test('old observation with source zero keeps original date without claiming a known offer',()=>{const c=pricing();const car={read:{source:'d1',freshness:'stale',last_seen_at:'2020-01-01T12:00:00Z'},auction:{state:'open'},pricing:{current_bid_usd:0}};
 assert.equal(c.api.getPriceInfo(car).label,'Brak danych o ofercie');assert.equal(c.api.getPriceInfo(car).value,null);assert.equal(car.read.last_seen_at,'2020-01-01T12:00:00Z');});

const expected={platform:'iaai',lot:'43806658',vin:'5YJ3E1EA4NF186754'};
const response=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/owner-tesla-history.json')));
function database(t){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(fs.readFileSync(path.join(ROOT,'docs/proposals/0004_d1_sync_2.sql'),'utf8'));
 sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,provider_vehicle_id,identity_kind,identity_state,first_seen_at,last_seen_at,created_at,updated_at) VALUES('source','apibara','iaai','provider','provider_vehicle_id','resolved','2026-10-08','2026-10-08','2026-10-08','2026-10-08')`).run();
 sqlite.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,listing_identity_kind,identity_state,vin_normalized,lot,first_seen_at,last_seen_at,created_at,updated_at) VALUES('listing','source','iaai','source_listing_id','resolved',?,?,'2026-10-08','2026-10-08','2026-10-08','2026-10-08')`).run(expected.vin,expected.lot);
 const db={prepare(sql){const methods=params=>({sql,params,async first(){return sqlite.prepare(sql).get(...params)||null;},async all(){return {results:sqlite.prepare(sql).all(...params)};}});return {...methods([]),bind(...params){return methods(params);}};},async batch(items){sqlite.exec('BEGIN');try{const results=items.map(x=>/^\s*SELECT\b/i.test(x.sql)?{results:sqlite.prepare(x.sql).all(...x.params)}:{results:[],meta:{changes:Number(sqlite.prepare(x.sql).run(...x.params).changes)}});sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};t.after(()=>sqlite.close());return {sqlite,db};}
test('real saved IAAI history imports four conditional events, no sales, no listing/snapshot restamp; replay idempotent',async t=>{const {sqlite,db}=database(t),input={response,expected,observedAt:'2026-10-08T15:19:29.252Z'};
 const before=JSON.stringify(sqlite.prepare('SELECT * FROM auction_listings').all());await importTargetedHistory(db,input);await importTargetedHistory(db,input);
 const events=sqlite.prepare('SELECT auction_date,source_price_usd,final_price_usd,source_status FROM auction_events ORDER BY auction_date').all();
 assert.deepEqual(events.map(x=>[x.auction_date,x.source_price_usd]),[['2026-08-20',2050],['2026-08-27',3950],['2026-09-24',2775],['2026-10-01',2900]]);
 assert.ok(events.every(x=>x.final_price_usd===null&&x.source_status==='Sold on Approval'));assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM auction_listings').all()),before);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,0);
});
test('history importer rejects wrong VIN/platform/LOT, ambiguous event keys and failed batch without partial writes',async t=>{const {sqlite,db}=database(t);
 for(const key of ['vin','platform','lot_number']){const bad=structuredClone(response);bad.data.vehicle[key]='WRONG';await assert.rejects(importTargetedHistory(db,{response:bad,expected,observedAt:'2026-10-08'}),/IDENTITY/);}
 const duplicate=structuredClone(response);duplicate.data.history.push(duplicate.data.history[0]);await assert.rejects(importTargetedHistory(db,{response:duplicate,expected,observedAt:'2026-10-08'}),/DUPLICATE/);
 sqlite.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON auction_events WHEN NEW.auction_date='2026-09-24' BEGIN SELECT RAISE(ABORT,'fixture failure'); END`);
 await assert.rejects(importTargetedHistory(db,{response,expected,observedAt:'2026-10-08'}),/fixture failure/);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
});
test('provider zero survives canonical normalization while masked bids and unavailable zero Buy Now are never invented',()=>{const provider=createApibaraProvider();for(const bid of [0,25,null]){const raw={platform:'iaai',lot_number:expected.lot,vin:expected.vin,pricing:{current_bid_usd:bid},auction:{state:'open'}};const vehicle=provider.toCanonicalVehicle(raw,provider.normalizeVehicle(raw));assert.equal(vehicle.pricing.current_bid,bid);}
 const history=provider.normalizeHistoryRecord({platform:'iaai',lot:expected.lot,date:'2026-10-01',status:'Not Sold',price:2900,final_price_usd:2900},{...expected,provider:'apibara'});assert.equal(history.final_price,null);assert.equal(history.source_price,2900);
});

test('missing auction amount has one label across lists and favorites without altering zero or saved-date semantics',()=>{
 const c=pricing();c.car={auction:{state:'open'},pricing:{current_bid_usd:null},read:{source:'d1',freshness:'stale',last_seen_at:'2026-09-20'}};
 assert.equal(c.api.getPriceInfo(c.car).label,'Brak danych o ofercie');assert.equal(c.api.marketAislePriceInfo(c.car,'electric').label,'Brak danych o ofercie');assert.equal(c.api.priceInfo(c.car)[0],'Brak danych o ofercie');
 for(const file of ['public/index.html','public/ulubione.html','public/car.html'])assert.ok(fs.readFileSync(path.join(ROOT,file),'utf8').includes('Brak danych o ofercie'),file);
 assert.equal(c.car.read.last_seen_at,'2026-09-20');
});

test('persistent history receipt distinguishes not fetched, fetched empty and stored without changing listing clocks',async t=>{
 const {sqlite,db}=database(t),repo=new D1ReadRepository(db);const before=JSON.stringify(sqlite.prepare('SELECT * FROM auction_listings').all());
 assert.equal((await repo.getHistoryAvailability({listingId:'listing'})).state,'not_fetched');
 const empty=structuredClone(response);empty.data.history=[];
 await importTargetedHistory(db,{response:empty,expected,observedAt:'2026-10-08T12:00:00Z'});
 let availability=await repo.getHistoryAvailability({listingId:'listing'});assert.equal(availability.state,'fetched_empty');assert.equal(availability.complete,true);assert.equal(availability.fetched_at,'2026-10-08T12:00:00.000Z');
 await importTargetedHistory(db,{response,expected,observedAt:'2026-10-08T15:19:29.252Z'});
 availability=await repo.getHistoryAvailability({listingId:'listing',events:await repo.getConfirmedEvents({listingId:'listing'})});assert.equal(availability.state,'stored');assert.equal(availability.stored_event_count,4);
 assert.equal((await repo.getHistoryAvailability({listingId:'other-platform-listing'})).state,'not_fetched');assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM auction_listings').all()),before);
});

test('malformed history and failed event transaction never create a fetched-empty success receipt; partial page stays partial',async t=>{
 const {sqlite,db}=database(t),bad=structuredClone(response);delete bad.data.history;
 await assert.rejects(importTargetedHistory(db,{response:bad,expected,observedAt:'2026-10-08'}),/INVALID_ENVELOPE/);
 sqlite.exec(`CREATE TRIGGER fail_history BEFORE INSERT ON auction_events BEGIN SELECT RAISE(ABORT,'fixture failure'); END`);
 await assert.rejects(importTargetedHistory(db,{response,expected,observedAt:'2026-10-08'}),/fixture failure/);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM provider_sync_scopes').get().n,0);
 sqlite.exec('DROP TRIGGER fail_history');const partial=structuredClone(response);partial.data.history=[];partial.meta={next_cursor:'next-page'};
 await importTargetedHistory(db,{response:partial,expected,observedAt:'2026-10-08'});
 assert.equal((await new D1ReadRepository(db).getHistoryAvailability({listingId:'listing'})).complete,false);
 delete partial.meta;
 await importTargetedHistory(db,{response:partial,expected,observedAt:'2026-10-08T01:00:00Z'});
 assert.equal((await new D1ReadRepository(db).getHistoryAvailability({listingId:'listing'})).complete,false);
 assert.equal(sqlite.prepare('SELECT cursor FROM provider_sync_scopes').get().cursor,null);
});
