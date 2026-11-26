'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {canonicalPlan,digest}=require('../sync/feed-bootstrap-membership.cjs');
const {D1ReadRepository,encodeCursor}=require('../sync/d1-read-repository.js');
const {CatalogMembershipRead,getCatalogMembershipRead,catalogMembershipNamespace}=require('../sync/catalog-membership-read.cjs');
const reads=require('../staging/d1-primary-reads.cjs'),{cachedStoredRead}=require('../sync/stored-read-cache.cjs');
const AT='2026-11-01T12:00:00.000Z',OLD='2020-01-01T00:00:00.000Z';
function fixture(t,{active=true}={}){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const f of ['0004_d1_sync_2.sql','0013_identifier_read_indexes.sql','0014_feed_catalog_membership.sql'])sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',f),'utf8').replace(/^\uFEFF/,''));
 const rows=[['a','copart','Toyota','open'],['b','iaai','Ford','live'],['c','copart','Historic','ended'],['d','copart','BMW','open'],['e','iaai','Audi','open']];
 for(const [i,[id,platform,make,state]]of rows.entries()){
  sql.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,identity_state,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,'apibara',?,'resolved',?,?,?,?)`).run('s'+id,platform,OLD,OLD,OLD,OLD);
  sql.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,identity_state,source_listing_id,lot,vin_normalized,make,model,year,auction_state,first_seen_at,last_seen_at,summary_synced_at,created_at,updated_at) VALUES(?,?,?,'resolved',?,?,?,?,?,2020,?,?,?,?,?,?)`).run(id,'s'+id,platform,'source-'+id,String(100+i),'1HGCM82633A00435'+i,make,'Model',state,OLD,OLD,OLD,OLD,OLD);
 }
 function baseline(id,members){
  const plan=canonicalPlan({version:1,baselineId:id,scope:'production',capture:{sequence:100,capturedAt:'2026-11-01T11:00:00.000Z',responseSha256:'a'.repeat(64)},snapshot:{generationId:7001,sha256:'b'.repeat(64),records:members.length,requestStartedAt:'2026-11-01T11:01:00.000Z',observedAt:OLD,generatedAtKnown:false,generatedAt:null},sourceEvidence:{kind:'provider-checkpoint',sha256:'c'.repeat(64),replayStartSequence:100,snapshotSha256:'b'.repeat(64)}});
  const state={version:1,status:'ready',offset:members.length,resolved:members.length,excluded:0,unresolved:0,deltaUnresolved:0,reviewedUnresolved:0,reviewSha256:null,replayVerified:true,replaySequence:200,pendingDelta:null,lastBatch:{kind:'delta',from:100,through:200,sha256:'d'.repeat(64)}};
  sql.prepare('INSERT INTO feed_catalog_baselines VALUES(?,?,?,?,0,?,?)').run(id,digest(plan),JSON.stringify(plan),JSON.stringify(state),AT,AT);
  for(const member of members)sql.prepare('INSERT INTO feed_catalog_membership VALUES(?,?,1,100)').run(id,member);
 }
 baseline('fresh-a',['a','b','c']);baseline('fresh-b',['d']);
 sql.prepare("INSERT INTO feed_catalog_membership VALUES('fresh-a','e',0,150)").run();
 const queries=[];const db={prepare(text){assert.match(text,/^\s*SELECT\b/);queries.push(text);const stmt=sql.prepare(text);const methods=p=>({async all(){return {results:stmt.all(...p)};},async first(){return stmt.get(...p)||null;}});return {...methods([]),bind(...p){return methods(p);}};}};
 const env={REXBID_CATALOG_MEMBERSHIP_ENABLED:'enabled',REXBID_RELEASE_D1_TARGET:'rexbid-production-preflight-db',REXBID_RELEASE_D1_DATABASE_ID:'c8a30088-70af-43a6-9a7f-c4018279d37d',REXBID_PUBLIC_CATALOG_MODE:'stored',REXBID_DB:db};
 const pointer=(id,rev)=>sql.prepare('UPDATE feed_catalog_pointer SET baseline_id=?,revision=?,updated_at=? WHERE singleton=1').run(id,rev,AT);
 if(active)pointer('fresh-a',1);t.mock.method(console,'info',()=>{});
 return {sql,db,env,queries,pointer};
}
const request=(p='/api/cars',options={})=>new Request('https://rexbid.pl'+p,options);
const body=async(p,env)=>{const response=await reads.handleStoredRead(request(p),env);return {response,body:await response.json()};};
class Cache{constructor(){this.data=new Map();}async match(key){return this.data.get(key.url)?.clone();}async put(key,value){this.data.set(key.url,value.clone());}}

test('flag OFF and enabled NULL pointer retain legacy list/metadata/cursors and never add archival claims',async t=>{
 const h=fixture(t,{active:false});delete h.env.REXBID_CATALOG_MEMBERSHIP_ENABLED;let r=await body('/api/cars?per_page=2',h.env);assert.equal(r.response.status,200);assert.equal(h.queries.some(q=>q.includes('feed_catalog_')),false);const legacy=r.body.meta.next_cursor;
 h.env.REXBID_CATALOG_MEMBERSHIP_ENABLED='enabled';r=await body('/api/cars?per_page=2&cursor='+legacy,h.env);assert.equal(r.response.status,200);assert.equal(r.body.meta.catalog,undefined);assert.equal(r.body.data[0].read.catalog_scope,undefined);
 const detail=await body('/api/car/103',h.env);assert.equal(detail.body.data.read.catalog_scope,undefined);
});
test('active lists and metadata exclude absent/inactive/ended canonical rows and report verified scope independently of stale records',async t=>{
 const h=fixture(t);let r=await body('/api/cars',h.env);assert.equal(r.response.status,200);assert.deepEqual(r.body.data.map(v=>v.lot_number),['100','101']);assert.ok(r.body.data.every(v=>v.read.catalog_scope==='active'));
 assert.equal(r.body.meta.catalog_complete,true);assert.equal(r.body.meta.scope_status,'verified');assert.equal(r.body.meta.freshness.status,'stale');assert.equal(r.body.meta.catalog.kind,'verified_baseline');assert.equal(h.queries.some(q=>q.includes('provider_sync_scopes')),false);
 r=await body('/api/filters',h.env);assert.deepEqual(r.body.data.makes.map(v=>v.value),['Ford','Toyota']);assert.equal(r.body.meta.row_count,2);assert.equal(r.body.meta.metadata_complete,true);assert.equal(r.body.meta.catalog.snapshot_generated_at,null);
 const one=await body('/api/filters?platform=copart',h.env);assert.deepEqual(one.body.data.makes.map(v=>v.value),['Toyota']);
});
test('detail/history keep canonical archive reachable and never infer a Sold claim from absent membership',async t=>{
 const h=fixture(t);for(const lot of ['102','103','104']){const r=await body('/api/car/'+lot,h.env);assert.equal(r.response.status,200);assert.equal(r.body.data.read.catalog_scope,'archival');assert.notEqual(r.body.data.auction.outcome_status,'Sold');}
 const active=await body('/api/car/100',h.env);assert.equal(active.body.data.read.catalog_scope,'active');
 const history=await body('/api/car/103/history',h.env);assert.equal(history.response.status,200);assert.equal(history.body.read.catalog_scope,'archival');assert.equal(history.body.history.length,0);
});
test('active cursor binds baseline and pointer revision for all sort modes, legacy cursor only works at NULL',async t=>{
 const h=fixture(t);for(const sort of ['recent','year_asc','bid_asc']){
  const first=await body('/api/cars?per_page=1&sort='+sort,h.env),cursor=first.body.meta.next_cursor;assert.ok(cursor);
  assert.equal((await body('/api/cars?per_page=1&sort='+sort+'&cursor='+cursor,h.env)).response.status,200);
  h.pointer('fresh-a',2);assert.equal((await body('/api/cars?per_page=1&sort='+sort+'&cursor='+cursor,h.env)).response.status,400);h.pointer('fresh-a',1);
 }
 assert.equal((await body('/api/cars?cursor='+encodeCursor(['listing','a']),h.env)).response.status,400);assert.equal((await body('/api/cars?cursor=invalid***',h.env)).body.error,'invalid_catalog_cursor');
 const cursor=(await body('/api/cars?per_page=1',h.env)).body.meta.next_cursor;h.pointer('fresh-b',2);assert.equal((await body('/api/cars?cursor='+cursor,h.env)).body.error,'invalid_catalog_cursor');h.pointer(null,3);assert.equal((await body('/api/cars?cursor='+encodeCursor(['listing','a']),h.env)).response.status,200);
});
test('one request shares pointer/proof read between cache namespace and route; pointer flip/NULL rollback isolate 900s taxonomy cache',async t=>{
 const h=fixture(t),cache=new Cache();async function fetch(){const req=request('/api/filters');return cachedStoredRead(req,cache,()=>reads.handleStoredRead(req,h.env),{namespace:()=>catalogMembershipNamespace(req,h.env,'test-public'),revalidateClient:true});}
 let before=h.queries.length,r=await fetch();assert.equal(r.headers.get('X-RexBid-Cache'),'MISS');assert.match(r.headers.get('Cache-Control'),/^public, max-age=0, s-maxage=900, must-revalidate$/);assert.equal(h.queries.slice(before).filter(q=>q.includes('FROM feed_catalog_pointer')).length,1);
 before=h.queries.length;r=await fetch();assert.equal(r.headers.get('X-RexBid-Cache'),'HIT');assert.equal(h.queries.length-before,1);
 h.pointer('fresh-b',2);r=await fetch();assert.equal(r.headers.get('X-RexBid-Cache'),'MISS');assert.deepEqual((await r.json()).data.makes.map(v=>v.value),['BMW']);
 h.pointer(null,3);r=await fetch();assert.equal(r.headers.get('X-RexBid-Cache'),'MISS');assert.equal((await r.json()).meta.catalog,undefined);assert.equal(cache.data.size,3);
});
test('an overloaded initial D1 read can recover within the same public request without bypassing membership',async t=>{
 const h=fixture(t);let attempts=0;
 h.env.REXBID_DB={prepare(sql){
  if(sql.includes('FROM feed_catalog_pointer')&&++attempts===1)return{bind(){return{async first(){throw new Error('D1_ERROR: backend unavailable',{cause:new Error('D1 database overloaded')});}};}};
  return h.db.prepare(sql);
 }};
 const req=request('/api/cars'),cache=new Cache();
 const result=await cachedStoredRead(req,cache,()=>reads.handleStoredRead(req,h.env),{namespace:()=>catalogMembershipNamespace(req,h.env,'test-public')});
 assert.equal(result.status,200);
 assert.equal(attempts,2);
 assert.deepEqual((await result.json()).data.map(v=>v.lot_number),['100','101']);
 assert.equal(cache.data.size,0,'a failed namespace lookup cannot populate an unverified key');
});
test('namespace gate never calls D1 for HTML/auth/private/credential requests; proof failure cannot reuse old unversioned cache',async t=>{
 const h=fixture(t),cache=new Cache();for(const req of [request('/'),request('/api/me'),request('/api/cars',{headers:{Cookie:'session=x'}}),request('/api/cars',{headers:{Authorization:'Bearer x'}}),request('/api/cars?token=x')]){
  let lookups=0;await cachedStoredRead(req,cache,()=>new Response('{}',{headers:{'Content-Type':'application/json'}}),{namespace:()=>{lookups++;return catalogMembershipNamespace(req,h.env,'base');}});assert.equal(lookups,0);
 }assert.equal(h.queries.length,0);assert.equal(getCatalogMembershipRead(request('/api/me'),h.env),null);
 h.sql.prepare("UPDATE feed_catalog_baselines SET plan_sha256=? WHERE baseline_id='fresh-a'").run('f'.repeat(64));const req=request('/api/cars');const r=await cachedStoredRead(req,cache,()=>reads.handleStoredRead(req,h.env),{namespace:()=>catalogMembershipNamespace(req,h.env,'base')});assert.equal(r.status,503);assert.equal(r.headers.get('X-RexBid-Cache'),'BYPASS');assert.equal(cache.data.size,0);
});
test('unresolved review and replay-in-progress coverage is explicit; corrupt ready checkpoint fails closed',async t=>{
 const h=fixture(t);const get=()=>JSON.parse(h.sql.prepare("SELECT checkpoint_json FROM feed_catalog_baselines WHERE baseline_id='fresh-a'").get().checkpoint_json);const put=s=>h.sql.prepare("UPDATE feed_catalog_baselines SET checkpoint_json=? WHERE baseline_id='fresh-a'").run(JSON.stringify(s));
 let state=get();state.status='replaying';state.replayVerified=false;state.pendingDelta={after:200,through:300,resumeReady:true};put(state);let r=await body('/api/cars',h.env);assert.equal(r.body.meta.catalog_complete,false);assert.equal(r.body.meta.catalog.replay_status,'in_progress');
 state.pendingDelta=null;state.replayVerified=true;state.deltaUnresolved=1;put(state);r=await body('/api/cars',h.env);assert.equal(r.body.meta.scope_status,'quarantine_review');
 state.status='ready';put(state);r=await body('/api/cars',h.env);assert.equal(r.response.status,503);
});
test('membership read predicates use primary-key search and retain the three exact identifier expression indexes',async t=>{
 const h=fixture(t),ctx=new CatalogMembershipRead(h.db,{scope:'production'}),repo=new D1ReadRepository(h.db,{membership:ctx});await repo.listCatalog();await repo.getListingByIdentifier('103');await repo.getFilterMetadata();
 const predicates=h.queries.filter(q=>q.includes('EXISTS(SELECT 1 FROM feed_catalog_membership cm'));
 assert.equal(predicates.length,2);for(const sql of predicates){const binds=sql.includes('LIMIT ?')?['fresh-a',21]:['fresh-a'];const plans=h.sql.prepare('EXPLAIN QUERY PLAN '+sql).all(...binds);assert.ok(plans.some(p=>/SEARCH cm .*PRIMARY KEY/.test(p.detail)),JSON.stringify(plans));}
 const identifier=h.queries.find(q=>q.includes('upper(l.vin_normalized)=upper(?) OR'));const plans=h.sql.prepare('EXPLAIN QUERY PLAN '+identifier).all('103','103','103');for(const name of ['vin','lot','source_listing'])assert.ok(plans.some(p=>p.detail.includes('idx_listings_public_'+name+'_upper')));assert.equal(plans.some(p=>p.detail.includes('idx_listings_public_recent')),false);
});
test('public helper loads with standard WebCrypto only and Worker source keeps optin flag without Node compatibility',()=>{
 const filename=path.join(__dirname,'../sync/catalog-membership-read.cjs'),source=fs.readFileSync(filename,'utf8'),captureSource=fs.readFileSync(path.join(__dirname,'../sync/feed-bootstrap-capture-time.cjs'),'utf8');assert.doesNotMatch(source,/node:|Buffer\b/);assert.doesNotMatch(captureSource,/require\(|node:|Buffer\b/);assert.equal((source.match(/require\(/g)||[]).length,1);const context={module:{exports:{}},require:name=>{assert.equal(name,'./feed-bootstrap-capture-time.cjs');return require('../sync/feed-bootstrap-capture-time.cjs');},WeakMap,TextEncoder,Uint8Array,URL,crypto:globalThis.crypto,Date,JSON,Number,Error};vm.runInNewContext(source,context);assert.equal(typeof context.module.exports.CatalogMembershipRead,'function');
 for(const worker of ['worker.publication.js','worker.staging.js']){const s=fs.readFileSync(path.join(__dirname,'..',worker),'utf8');assert.match(s,/REXBID_CATALOG_MEMBERSHIP_ENABLED === "enabled"/);assert.match(s,/catalogMembershipNamespace\(request, env/);assert.match(s,/revalidateClient:/);}
});

test('long taxonomy cache accepts only the strict public catalogue metadata shape',async t=>{
 const h=fixture(t);const response=await reads.handleStoredRead(request('/api/filters'),h.env),valid=await response.json();
 for(const extra of [{pricing:{current_bid:50}},{customer_name:'private'},{unknown_field:'unexpected'}]){
  const cache=new Cache(),payload=structuredClone(valid);Object.assign(payload.meta.catalog,extra);
  const r=await cachedStoredRead(request('/api/filters'),cache,()=>new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}}),{namespace:'shape-test'});assert.equal(r.headers.get('X-RexBid-Cache'),'BYPASS');assert.equal(cache.data.size,0);
 }
});


test('public list accepts a provider-attested pre-start bound and rejects a mismatched bound proof',async t=>{
 const h=fixture(t),saved=JSON.parse(h.sql.prepare("SELECT plan_json FROM feed_catalog_baselines WHERE baseline_id='fresh-a'").get().plan_json);saved.capture={sequence:100,capturedAt:null,capturedNoLaterThan:saved.snapshot.requestStartedAt,timeBasis:'provider-before-start-bound',responseSha256:'a'.repeat(64)};Object.assign(saved.snapshot,{generatedAtKnown:true,generatedAt:AT});const p=canonicalPlan(saved);h.sql.prepare("UPDATE feed_catalog_baselines SET plan_json=?,plan_sha256=? WHERE baseline_id='fresh-a'").run(JSON.stringify(p),digest(p));const result=await body('/api/cars',h.env);assert.equal(result.response.status,200);assert.equal(result.body.meta.catalog_complete,true);assert.deepEqual(result.body.data.map(v=>v.lot_number),['100','101']);p.sourceEvidence.replayStartSequence=99;h.sql.prepare("UPDATE feed_catalog_baselines SET plan_json=?,plan_sha256=? WHERE baseline_id='fresh-a'").run(JSON.stringify(p),digest(p));assert.equal((await body('/api/cars',h.env)).response.status,503);
});


test('file scheduler authority remains exclusive during a verified baseline and its pending delta',async t=>{
 const f=fixture(t);const authority=await reads.scheduledCatalogAuthority(f.env);assert.equal(authority.kind,'file_feed');assert.equal(authority.baselineId,'fresh-a');assert.equal(authority.replaySequence,200);
 const row=f.sql.prepare("SELECT checkpoint_json FROM feed_catalog_baselines WHERE baseline_id='fresh-a'").get(),state=JSON.parse(row.checkpoint_json);Object.assign(state,{status:'replaying',replayVerified:false,pendingDelta:{after:200,through:300,resumeReady:true}});f.sql.prepare("UPDATE feed_catalog_baselines SET checkpoint_json=? WHERE baseline_id='fresh-a'").run(JSON.stringify(state));
 assert.equal((await reads.scheduledCatalogAuthority(f.env)).baselineId,'fresh-a');assert.ok(f.queries.every(q=>/^\s*SELECT\b/.test(q)));
});

function publicationSchedulerForAuthority(env,run){
 const root=path.join(__dirname,'..'),actual=require('../sync/automatic-refresh.cjs'),context={URL,Request,Response,Headers,console:{info(){},error(){}},HTMLRewriter:class{},__shared:{},__cache:{},__accounts:{},__stored:reads,__automatic:{configuration:actual.configuration,runAutomaticRefresh:run}};vm.createContext(context);
 let source=fs.readFileSync(path.join(root,'worker.publication.js'),'utf8');for(const [line,replacement]of [
 ['import rexWorker from "./worker.js";','const rexWorker=globalThis.__shared;'],['import storedReads from "./staging/d1-primary-reads.cjs";','const storedReads=globalThis.__stored;'],['import savedReadCache from "./sync/stored-read-cache.cjs";','const savedReadCache=globalThis.__cache;'],['import automaticRefreshModule from "./sync/automatic-refresh.cjs";','const automaticRefreshModule=globalThis.__automatic;'],['import accountsReadinessModule from "./auth/routes.js";','const accountsReadinessModule=globalThis.__accounts;']])source=source.replace(line,replacement);vm.runInContext(source.replace('export default {','globalThis.__worker={'),context);
 const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.production-publication.jsonc'),'utf8'));return{worker:context.__worker,env:{...config.vars,REXBID_DB:env.REXBID_DB}};
}

test('actual publication scheduler never starts the old API cursor beside an activated or replaying file catalogue',async t=>{
 const f=fixture(t);let legacy=0,pending=0;const w=publicationSchedulerForAuthority(f.env,async()=>{legacy++;throw Error('OLD_CURSOR_MUST_NOT_RUN');});const run=()=>w.worker.scheduled({cron:'*/15 * * * *'},w.env,{waitUntil(){pending++;}});
 assert.equal((await run()).stopReason,'server_feed_owns_updates');
 const row=f.sql.prepare("SELECT checkpoint_json FROM feed_catalog_baselines WHERE baseline_id='fresh-a'").get(),state=JSON.parse(row.checkpoint_json);Object.assign(state,{status:'replaying',replayVerified:false,pendingDelta:{after:200,through:300,resumeReady:true}});f.sql.prepare("UPDATE feed_catalog_baselines SET checkpoint_json=? WHERE baseline_id='fresh-a'").run(JSON.stringify(state));assert.equal((await run()).stopReason,'server_feed_owns_updates');assert.equal(legacy,0);assert.equal(pending,0);
});

test('null file pointer preserves the prior bounded scheduler; an invalid active proof fails closed',async t=>{
 const f=fixture(t,{active:false});let legacy=0;const w=publicationSchedulerForAuthority(f.env,async()=>{legacy++;return{ok:true,stopReason:'bounded-legacy-before-activation'};});assert.equal(await reads.scheduledCatalogAuthority({...f.env,REXBID_CATALOG_MEMBERSHIP_ENABLED:'disabled'}),null);assert.equal(await reads.scheduledCatalogAuthority(f.env),null);
 const pending=[];let result=await w.worker.scheduled({cron:'*/15 * * * *'},w.env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);assert.equal(result.stopReason,'bounded-legacy-before-activation');assert.equal(legacy,1);
 f.pointer('fresh-a',1);f.sql.prepare("UPDATE feed_catalog_baselines SET plan_sha256='0000000000000000000000000000000000000000000000000000000000000000' WHERE baseline_id='fresh-a'").run();result=await w.worker.scheduled({cron:'*/15 * * * *'},w.env,{waitUntil(){throw Error('NO_LEGACY_FALLBACK');}});assert.equal(result.stopReason,'publication_scheduler_unavailable');assert.equal(legacy,1);
});
