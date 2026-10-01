const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {createApibaraProvider} = require('../providers/apibara.js');
const contract = require('../providers/contract.js');
const {createSyncIdentity} = require('../sync/core.js');
const {D1SyncRepository} = require('../sync/d1-repository.js');
const {canonicalizeDiscoveryPage} = require('../sync/discovery-page.js');
const {runPhaseCShadow,MAX_LIVE_REQUESTS,cleanupReport} = require('./helpers/phase-c-shadow-harness.cjs');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const apibaraPage = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8'));
const providerBFixture = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/provider-b-vehicle.json'),'utf8'));

class DisposableD1 {
  constructor(database) { this.database=database; this.queue=Promise.resolve(); }
  prepare(sql) {
    const database=this.database;
    return {first:async(...params)=>database.prepare(sql).get(...params)??null,all:async(...params)=>({results:database.prepare(sql).all(...params)}),run:async(...params)=>{const result=database.prepare(sql).run(...params);return {success:true,meta:{changes:Number(result.changes)}};},bind(...params){return {
      sql,params,
      async run(){const result=database.prepare(sql).run(...params);return {success:true,meta:{changes:Number(result.changes)}};},
      async first(){return database.prepare(sql).get(...params)??null;},
      async all(){return {results:database.prepare(sql).all(...params)};}
    };}};
  }
  batch(statements) {
    const run=this.queue.then(()=>{
      this.database.exec('BEGIN IMMEDIATE');
      try {const results=statements.map(statement=>{
        const q=this.database.prepare(statement.sql);
        if(/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(statement.sql))return {success:true,results:q.all(...statement.params)};
        const out=q.run(...statement.params);return {success:true,meta:{changes:Number(out.changes)}};
      });this.database.exec('COMMIT');return results;}
      catch(error){this.database.exec('ROLLBACK');throw error;}
    });this.queue=run.catch(()=>undefined);return run;
  }
}

function dbFixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(fs.readFileSync(path.join(ROOT,'migrations/0000_rexbid_base.sql'),'utf8'));
  sqlite.exec(fs.readFileSync(path.join(ROOT,'migrations/0001_auction_history_events.sql'),'utf8'));
  sqlite.exec(fs.readFileSync(path.join(ROOT,'migrations-staging/0003_accounts_foundation.sql'),'utf8'));
  sqlite.exec(fs.readFileSync(path.join(ROOT,'docs/proposals/0004_d1_sync_2.sql'),'utf8'));
  sqlite.prepare(`INSERT INTO users(id,auth_issuer,auth_subject,auth_provider,email_verified,created_at,updated_at) VALUES('user-1','issuer','sub','email',1,'a','a')`).run();
  sqlite.prepare(`INSERT INTO user_favorites(user_id,favorite_key,vin,lot,platform,created_at,updated_at) VALUES('user-1','vin:KEEPVIN','KEEPVIN','KEEP','copart','a','a')`).run();
  return {sqlite,db:new DisposableD1(sqlite)};
}

function apibaraAdapter({response=apibaraPage, calls=null}={}) {
  return createApibaraProvider({fetch:async(url,options)=>{
    if(calls)calls.push({url:String(url),method:options.method});
    return new Response(JSON.stringify(response),{status:200,headers:{'content-type':'application/json'}});
  },timeoutMs:1000,console:{warn(){},error(){}}});
}

function freshnessPolicy(){return {hotIntervalMs:1000,warmIntervalMs:5000,coldIntervalMs:10000,hotWindowMs:1000};}

function fakeProviderBAdapter() {
  return {
    id:'provider-b',
    vehicleListRecords:response=>response.listings,
    responseMeta:response=>response.page,
    normalizeVehicle:raw=>({platform:raw.market.toLowerCase(),fingerprint:`b-${raw.vehicleRef}`}),
    toCanonicalVehicle:raw=>contract.createRexVehicle({
      provider:'provider-b',provider_vehicle_id:raw.vehicleRef,platform:raw.market.toLowerCase(),vin:raw.identity.chassis,lot:raw.identity.stock,
      year:raw.description.modelYear,make:raw.description.manufacturer,model:raw.description.nameplate,
      auction:contract.createRexAuction({state:raw.sale.phase,source_status:raw.sale.phase,auction_at:raw.sale.startsAt,timed:raw.sale.timed,timed_end_at:raw.sale.timedClose,source_listing_id:raw.vehicleRef}),
      pricing:contract.createRexPricing({currency:raw.money.currencyCode,current_bid:raw.money.leadingOffer,buy_now:raw.money.instantPurchase,final_price:raw.money.settledAmount}),
      seller:contract.createRexSeller({name:raw.sellerRecord.legalName,type:raw.sellerRecord.category}),
      condition:contract.createRexCondition({primary_damage:raw.vehicleState.mainDamage,run_state:raw.vehicleState.operation,keys_present:raw.vehicleState.keysIncluded}),
      document:contract.createRexDocument({name:raw.paperwork.display,registration:raw.paperwork.registrationPossible}),
      media:contract.createRexMedia({items:raw.images.primary,thumbs:raw.images.small}),
      location:raw.place.displayName,odometer:{value:raw.distance.miles,unit:'mi'}
    })
  };
}

test('canonical discovery page Apibara-shaped → actual repository D1 schema, replay and storage minimization',async()=>{
  const {sqlite,db}=dbFixture();
  const provider=apibaraAdapter();
  const page=canonicalizeDiscoveryPage({provider,response:apibaraPage,scopeKey:'phase-c-unit:apibara',platform:'copart',now:NOW,freshnessPolicy:freshnessPolicy()});
  assert.deepEqual([page.providerRecords,page.accepted,page.rejected,page.ambiguous],[1,1,0,0]);
  const repo=new D1SyncRepository(db),scopeKey='phase-c-unit:apibara',runId='phase-c-run-a';
  const lease=await repo.acquireLease({scopeKey,provider:'apibara',platform:'copart',operation:'discovery',owner:'o',token:'t',now:NOW,ttlMs:60000});
  await repo.createRun({runId,scopeKey,provider:'apibara',platform:'copart',now:NOW});
  const input={scopeKey,provider:'apibara',platform:'copart',runId,owner:'o',token:'t',leaseGeneration:lease.leaseGeneration,cursor:null,nextCursor:null,records:page.records,now:NOW};
  assert.equal((await repo.persistDiscoveryPage(input)).complete,true);
  assert.equal((await repo.persistDiscoveryPage(input)).replayed,true);
  const identity=page.records[0].identity,row=await repo.getListing(identity.listingId);
  assert.equal(row.current_bid_usd,4100);assert.equal(row.platform,'copart');assert.equal(row.seller_name,'Synthetic Seller');
  assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n),1);
  const cols=sqlite.prepare('PRAGMA table_info(auction_listings)').all().map(x=>x.name);
  assert.equal(cols.some(name=>/raw_payload|raw_json|media_items|photo_binary|image_binary|binary/i.test(name)),false);
  assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM users').get().n),1);
  assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM user_favorites').get().n),1);
  sqlite.close();
});

test('provider B o innych polach przechodzi tę samą canonicalizację, repository i zachowuje partial fields',async()=>{
  const {sqlite,db}=dbFixture();
  const adapter=fakeProviderBAdapter(),raw=providerBFixture;
  const response={listings:[raw],page:{next_cursor:null}};
  const platform=raw.market.toLowerCase();
  const page=canonicalizeDiscoveryPage({provider:adapter,response,scopeKey:'phase-c-unit:b',platform,now:NOW,freshnessPolicy:freshnessPolicy()});
  const repo=new D1SyncRepository(db),scopeKey='phase-c-unit:b';
  const lease=await repo.acquireLease({scopeKey,provider:'provider-b',platform,owner:'b1',token:'btoken',now:NOW,ttlMs:60000});
  await repo.createRun({runId:'b-run-1',scopeKey,provider:'provider-b',platform,now:NOW});
  const first={scopeKey,provider:'provider-b',platform,runId:'b-run-1',owner:'b1',token:'btoken',leaseGeneration:lease.leaseGeneration,cursor:null,nextCursor:null,records:page.records,now:NOW};
  await repo.persistDiscoveryPage(first);
  const id=page.records[0].identity;
  const old=await repo.getListing(id.listingId);
  const lease2=await repo.acquireLease({scopeKey,provider:'provider-b',platform,owner:'b2',token:'btoken2',now:NOW+1,ttlMs:60000});
  await repo.createRun({runId:'b-run-2',scopeKey,provider:'provider-b',platform,now:NOW+1});
  const next=structuredClone(page.records[0]);next.vehicle.pricing.current_bid=250;next.vehicle.auction.state='updated';next.vehicle.auction.source_status='updated';next.vehicle.seller.name=null;next.vehicle.document.name=null;next.vehicle.odometer=null;
  await repo.persistDiscoveryPage({...first,runId:'b-run-2',owner:'b2',token:'btoken2',leaseGeneration:lease2.leaseGeneration,records:[next],now:NOW+1});
  const updated=await repo.getListing(id.listingId);
  assert.equal(updated.current_bid_usd,250);assert.equal(updated.auction_state,'updated');
  assert.equal(updated.seller_name,old.seller_name);assert.equal(updated.document_name,old.document_name);assert.equal(updated.odometer_value,old.odometer_value);
  assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n),1);
  sqlite.close();
});

test('staging shadow runner uses exactly one mocked upstream call, validates D1, exercises failure recovery and cleans exact rows',async()=>{
  const {sqlite,db}=dbFixture();
  const calls=[];
  const provider=apibaraAdapter({calls});
  const result=await runPhaseCShadow({db,env:{APIBARA_API_KEY:'test-only-never-logged'},provider,requestId:'test-phase-c-001',now:()=>NOW});
  assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.match(calls[0].url,/per_page=20/);assert.match(calls[0].url,/platform=copart/);
  assert.equal(MAX_LIVE_REQUESTS,1);assert.equal(result.ok,true);assert.equal(result.liveRequests,1);
  assert.equal(result.providerMetrics.providerRecords,1);assert.equal(result.providerMetrics.accepted,1);assert.equal(result.persistMetrics.inserts,1);assert.equal(result.persistMetrics.duplicates,1);
  assert.equal(result.readbackPass,true);assert.equal(result.syntheticChecks.fakeProviderB,true);assert.equal(result.syntheticChecks.partialUpdate,true);
  assert.equal(result.syntheticChecks.failureRecovery,true);assert.equal(result.syntheticChecks.budgetFailure,true);
  assert.equal(result.cleanupPass,true);assert.equal(result.endState.users,1);assert.equal(result.endState.favorites,1);
  assert.equal(cleanupReport(result).verified,true);
  assert.ok(Object.values(result.endState.sync).every(count=>count===0));
  assert.deepEqual(result.endState.legacy,{vehicles:0,vehicle_snapshots:0,auction_history:0});
  sqlite.close();
});

test('shadow cleanup preserves a pre-existing source/listing even when discovery returns the same identity',async()=>{
  const {sqlite,db}=dbFixture();
  const seedProvider=apibaraAdapter();
  const seedPage=canonicalizeDiscoveryPage({provider:seedProvider,response:apibaraPage,scopeKey:'existing-scope',platform:'copart',now:NOW,freshnessPolicy:freshnessPolicy()});
  const repo=new D1SyncRepository(db),scopeKey='existing-scope',owner='existing-owner',token='existing-token',runId='existing-run';
  const lease=await repo.acquireLease({scopeKey,provider:'apibara',platform:'copart',operation:'discovery',owner,token,now:NOW,ttlMs:60000});
  await repo.createRun({runId,scopeKey,provider:'apibara',platform:'copart',now:NOW});
  await repo.persistDiscoveryPage({scopeKey,provider:'apibara',platform:'copart',runId,owner,token,leaseGeneration:lease.leaseGeneration,cursor:null,nextCursor:null,records:seedPage.records,now:NOW});
  const existingId=seedPage.records[0].identity.listingId;
  const expanded=structuredClone(apibaraPage);
  const newRaw=structuredClone(expanded.response.data[0]);
  newRaw.vehicle_id='synthetic-provider-listing-002';newRaw.vin='SYNTHETICVIN000002';newRaw.lot_number='PHASEC-002';
  expanded.response.data.push(newRaw);
  const calls=[],provider=apibaraAdapter({response:expanded,calls});
  const result=await runPhaseCShadow({db,env:{APIBARA_API_KEY:'test-only-never-logged'},provider,requestId:'phase-c-existing-protection',now:()=>NOW});
  assert.equal(calls.length,1);assert.equal(result.ok,true);assert.equal(result.cleanupPass,true);
  assert.equal(result.persistMetrics.inserts,1);assert.equal(result.persistMetrics.duplicates,2);
  assert.ok(await repo.getListing(existingId));
  assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n),1);
  assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM vehicle_sources').get().n),1);
  assert.equal(result.endState.users,1);assert.equal(result.endState.favorites,1);
  sqlite.close();
});

test('clean staging wrapper no longer exposes Phase C route, flag or button',()=>{
  const worker=fs.readFileSync(path.join(ROOT,'worker.staging.js'),'utf8');
  const config=fs.readFileSync(path.join(ROOT,'wrangler.staging.jsonc'),'utf8');
  const page=fs.readFileSync(path.join(ROOT,'staging/auth-test-page.js'),'utf8');
  assert.doesNotMatch(worker,/phase-c-shadow|d1-sync-phase-c-shadow/i);
  assert.doesNotMatch(config,/REXBID_PHASE_C_SHADOW/);
  assert.doesNotMatch(page,/phase-c-shadow|d1-sync-phase-c-shadow/i);
});
