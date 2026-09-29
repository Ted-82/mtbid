const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createApibaraProvider}=require('../providers/apibara.js');
const {D1SyncRepository}=require('../sync/d1-repository.js');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const {freshnessPolicyFromEnv,classifyScopeState}=require('../sync/backfill-policy.js');
const {runControlledBackfill,handlePhaseFRequest,PHASE_D_SCOPE,MAX_PHASE_F_REQUESTS,MAX_PAGES_PER_RUN,DEFAULT_PAGES_PER_RUN,BUDGET_PROVIDER,BUDGET_CAMPAIGN}=require('../staging/phase-f-backfill.cjs');

const ROOT=path.join(__dirname,'..');
const NOW=Date.parse('2026-09-29T20:00:00.000Z');
const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8'));

class DisposableD1{
  constructor(sqlite){this.sqlite=sqlite;this.tail=Promise.resolve();}
  prepare(sql){const db=this.sqlite;const bound=params=>({sql,params,async first(){return db.prepare(sql).get(...params)??null;},async all(){return{results:db.prepare(sql).all(...params)};},async run(){const r=db.prepare(sql).run(...params);return{success:true,meta:{changes:Number(r.changes)}};}});return{bind(...params){return bound(params);},async first(...params){return db.prepare(sql).get(...params)??null;},async all(...params){return{results:db.prepare(sql).all(...params)};},async run(...params){const r=db.prepare(sql).run(...params);return{success:true,meta:{changes:Number(r.changes)}};}};}
  batch(statements){const operation=this.tail.then(()=>{this.sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>{const q=this.sqlite.prepare(s.sql);if(/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(s.sql))return{success:true,results:q.all(...s.params)};const r=q.run(...s.params);return{success:true,meta:{changes:Number(r.changes)}};});this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}});this.tail=operation.catch(()=>undefined);return operation;}
}

function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of ['migrations/0000_rexbid_base.sql','migrations/0001_auction_history_events.sql','migrations-staging/0003_accounts_foundation.sql','docs/proposals/0004_d1_sync_2.sql'])sqlite.exec(fs.readFileSync(path.join(ROOT,file),'utf8'));
  const d1=new DisposableD1(sqlite);
  sqlite.prepare(`INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,last_attempt_at,updated_at)
    VALUES(?, 'apibara','copart','discovery','partial','saved-cursor-1',?,?)`).run(PHASE_D_SCOPE,new Date(NOW-1000).toISOString(),new Date(NOW-1000).toISOString());
  return{sqlite,d1};
}

function pageRecords(page){return Array.from({length:20},(_,i)=>{const raw=structuredClone(seed.response.data[0]);const n=page*20+i+1;raw.vehicle_id=`phase-f-listing-${n}`;raw.lot_number=`PHASEF-${n}`;raw.vin=`PHASEFVIN${String(n).padStart(8,'0')}`;return raw;});}
function providerFor(calls,{failAt=null,repeated=false,empty=false}={}){
  return createApibaraProvider({timeoutMs:500,console:{warn(){},error(){}},fetch:async(url,options)=>{
    const parsed=new URL(url);const cursor=parsed.searchParams.get('cursor');calls.push({method:options.method,cursor});
    if(calls.length===failAt)throw new TypeError('sensitive provider failure detail');
    const match=String(cursor||'saved-cursor-1').match(/saved-cursor-(\d+)/);const cursorIndex=Number(match?.[1]||1);const page=cursorIndex-1;
    const nextCursor=repeated?cursor:(page>=4?null:`saved-cursor-${page+2}`);
    const data=empty?[]:pageRecords(page);
    return new Response(JSON.stringify({response:{data,meta:{next_cursor:nextCursor}}}),{status:200,headers:{'content-type':'application/json'}});
  }});
}

test('Phase F resumes saved cursor in bounded pages; checkpoints are readable by Phase E and scope stays partial until provider end',async()=>{
  const{sqlite,d1}=database();const calls=[];const provider=providerFor(calls);const env={APIBARA_API_KEY:'mock-only'};
  const first=await runControlledBackfill({db:d1,env,requestId:'phase-f-first',maxPages:2,now:()=>NOW,provider});
  assert.equal(first.ok,true);assert.equal(first.liveRequests,2);assert.equal(first.pagesProcessed,2);assert.equal(first.scopeStatus,'partial');assert.equal(first.nextCursorPresent,true);assert.equal(first.scopeComplete,false);
  assert.equal(first.providerRecords,40);assert.equal(first.inserts,40);assert.equal(first.snapshotsCreated,40);assert.equal(first.replayVerified,true);assert.equal(first.readback,true);
  assert.deepEqual(calls.map(x=>x.cursor),['saved-cursor-1','saved-cursor-2']);
  assert.equal(sqlite.prepare('SELECT cursor FROM provider_sync_scopes WHERE scope_key=?').get(PHASE_D_SCOPE).cursor,'saved-cursor-3');
  let listed=await new D1ReadRepository(d1,{now:()=>NOW}).listCatalog({platform:'copart',limit:50});
  assert.equal(listed.records.length,40);assert.equal(listed.read.catalog_complete,false);assert.equal(listed.read.coverage.platforms[0].next_page_available,true);
  const second=await runControlledBackfill({db:d1,env,requestId:'phase-f-second',maxPages:3,now:()=>NOW+1000,provider});
  assert.equal(second.ok,true,JSON.stringify(second));assert.equal(second.liveRequests,3,JSON.stringify(second));assert.equal(second.pagesProcessed,3);assert.equal(second.scopeStatus,'complete');assert.equal(second.scopeComplete,true);assert.equal(second.nextCursorPresent,false);
  assert.equal(calls.length,5);assert.equal(second.campaignBudget.consumed,5);assert.equal(second.campaignBudget.reserved,0);assert.equal(second.campaignBudget.retryLimit,0);
  listed=await new D1ReadRepository(d1,{now:()=>NOW+1000}).listCatalog({platform:'copart',limit:50});
  assert.equal(listed.records.length,50);assert.equal(listed.page.has_more_stored_rows,true);assert.equal(listed.read.catalog_complete,true);assert.equal(sqlite.prepare('SELECT COUNT(DISTINCT listing_id) n FROM auction_listings').get().n,100);
  const blocked=await runControlledBackfill({db:d1,env,requestId:'phase-f-over-budget',maxPages:1,now:()=>NOW+2000,provider});
  assert.equal(blocked.ok,false);assert.equal(blocked.error,'scope_complete');assert.equal(calls.length,5,'hard campaign cap is never exceeded');
  sqlite.close();
});

test('Phase F failed provider request is consumed once, never retried, preserves cursor and does not complete scope',async()=>{
  const{sqlite,d1}=database();const calls=[];const provider=providerFor(calls,{failAt:1});
  const result=await runControlledBackfill({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-f-provider-fail',maxPages:2,now:()=>NOW,provider});
  assert.equal(result.ok,false);assert.equal(result.error,'provider_unavailable');assert.equal(result.liveRequests,1);assert.equal(calls.length,1);
  assert.equal(sqlite.prepare('SELECT cursor,status,last_complete_at FROM provider_sync_scopes WHERE scope_key=?').get(PHASE_D_SCOPE).cursor,'saved-cursor-1');
  assert.equal(sqlite.prepare('SELECT status FROM provider_sync_scopes WHERE scope_key=?').get(PHASE_D_SCOPE).status,'failed');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,0);
  const budget=sqlite.prepare('SELECT normal_consumed,normal_reserved,retry_limit,retry_consumed FROM provider_request_budgets WHERE provider=? AND budget_day=?').get(BUDGET_PROVIDER,BUDGET_CAMPAIGN);
  assert.equal(budget.normal_consumed,1);assert.equal(budget.normal_reserved,0);assert.equal(budget.retry_limit,0);assert.equal(budget.retry_consumed,0);
  sqlite.close();
});

test('Phase F stops on empty/invalid page before checkpoint; max-pages and request cap are bounded',async()=>{
  const{sqlite,d1}=database();const calls=[];const provider=providerFor(calls,{empty:true});
  const failed=await runControlledBackfill({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-f-empty',maxPages:3,now:()=>NOW,provider});
  assert.equal(failed.ok,false);assert.equal(failed.error,'no_valid_canonical_records');assert.equal(failed.liveRequests,1);assert.equal(calls.length,1);
  assert.equal(sqlite.prepare('SELECT cursor FROM provider_sync_scopes WHERE scope_key=?').get(PHASE_D_SCOPE).cursor,'saved-cursor-1');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sync_page_commits').get().n,0);
  assert.equal(MAX_PHASE_F_REQUESTS,5);assert.equal(MAX_PAGES_PER_RUN,3);assert.equal(DEFAULT_PAGES_PER_RUN,2);
  const invalid=await runControlledBackfill({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-f-invalid-limit',maxPages:4,now:()=>NOW+1,provider});
  assert.equal(invalid.error,'invalid_page_limit');assert.equal(calls.length,1);
  sqlite.close();
});

test('Phase F lease conflict and repeated cursor stop without another page or cursor loop',async()=>{
  const{sqlite,d1}=database();const repo=new D1SyncRepository(d1);const lease=await repo.acquireLease({scopeKey:PHASE_D_SCOPE,provider:'apibara',platform:'copart',operation:'discovery',owner:'other-owner',token:'other-token',now:NOW,ttlMs:60_000});
  assert.equal(lease.acquired,true);const blockedCalls=[];const blocked=await runControlledBackfill({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-f-lease-blocked',maxPages:1,now:()=>NOW+1,provider:providerFor(blockedCalls)});
  assert.equal(blocked.error,'lease_busy');assert.equal(blockedCalls.length,0);
  await repo.releaseLease({scopeKey:PHASE_D_SCOPE,owner:'other-owner',token:'other-token',leaseGeneration:lease.leaseGeneration,now:NOW+2});
  const loopCalls=[];const loop=await runControlledBackfill({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-f-loop',maxPages:3,now:()=>NOW+3,provider:providerFor(loopCalls,{repeated:true})});
  assert.equal(loop.ok,false);assert.equal(loop.error,'repeated_cursor');assert.equal(loop.liveRequests,1);assert.equal(loopCalls.length,1);
  assert.equal(sqlite.prepare('SELECT cursor FROM provider_sync_scopes WHERE scope_key=?').get(PHASE_D_SCOPE).cursor,'saved-cursor-1');
  assert.equal(sqlite.prepare('SELECT last_complete_at FROM provider_sync_scopes WHERE scope_key=?').get(PHASE_D_SCOPE).last_complete_at,null);
  sqlite.close();
});

test('Phase F manual endpoint is staging-host, flag, POST, same-origin and authenticated only',async()=>{
  const{sqlite,d1}=database();const env={REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev',REXBID_PHASE_F_BACKFILL:'enabled',REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_DB:d1,APIBARA_API_KEY:'mock-only'};
  let providerCalls=0;const provider=providerFor([]);const wrapped={...provider,listVehicles:async(...args)=>{providerCalls++;return provider.listVehicles(...args);}};
  const dispatch=async()=>new Response('{"user":{"id":"synthetic-auth-user"}}',{status:200});
  const request=(host='rexbid-auth-test.tedn828.workers.dev',method='POST',origin=`https://${host}`,site='same-origin')=>new Request(`https://${host}/__staging/d1-sync-phase-f-backfill`,{method,headers:{Origin:origin,'Sec-Fetch-Site':site,Cookie:'opaque',"Content-Type":"application/json"},body:method==='POST'?'{"max_pages":1}':undefined});
  assert.equal((await handlePhaseFRequest(request('evil.invalid'),env,null,dispatch,wrapped)).status,404);
  assert.equal((await handlePhaseFRequest(request(undefined,'GET',undefined,undefined),env,null,dispatch,wrapped)).status,405);
  assert.equal((await handlePhaseFRequest(request('rexbid-auth-test.tedn828.workers.dev','POST','https://attacker.invalid'),env,null,dispatch,wrapped)).status,403);
  assert.equal((await handlePhaseFRequest(request(),{...env,REXBID_PHASE_F_BACKFILL:'disabled'},null,dispatch,wrapped)).status,404);
  assert.equal((await handlePhaseFRequest(request(),env,null,async()=>new Response('{}',{status:401}),wrapped)).status,401);
  assert.equal(providerCalls,0);sqlite.close();
});

test('Phase F authorized staging route calls the manual runner once and returns safe bounded metrics',async()=>{
  const{sqlite,d1}=database();const env={REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev',REXBID_PHASE_F_BACKFILL:'enabled',REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_DB:d1,APIBARA_API_KEY:'mock-only'};
  let providerCalls=0;const provider=providerFor([]);const wrapped={...provider,listVehicles:async(...args)=>{providerCalls++;return provider.listVehicles(...args);}};
  const response=await handlePhaseFRequest(new Request('https://rexbid-auth-test.tedn828.workers.dev/__staging/d1-sync-phase-f-backfill',{method:'POST',headers:{Origin:'https://rexbid-auth-test.tedn828.workers.dev','Sec-Fetch-Site':'same-origin',Cookie:'opaque-session','Content-Type':'application/json'},body:'{"max_pages":1}'}),env,null,
    async()=>new Response('{"user":{"id":"synthetic-user"}}',{status:200}),wrapped);
  const body=await response.json();
  assert.equal(response.status,200);assert.match(response.headers.get('X-RexBid-Request-ID'),/^[0-9a-f-]{36}$/);
  assert.equal(body.ok,true);assert.equal(body.liveRequests,1);assert.equal(body.pagesProcessed,1);assert.equal(body.scopeStatus,'partial');assert.equal(body.nextCursorPresent,true);
  assert.equal(providerCalls,1);assert.equal(body.rawOrMediaStored,false);assert.equal(JSON.stringify(body).includes('opaque-session'),false);assert.equal(JSON.stringify(body).includes('mock-only'),false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,20);sqlite.close();
});

test('Phase F scope stale state and HOT/WARM/COLD refresh intervals are explicit and configurable',()=>{
  assert.deepEqual(freshnessPolicyFromEnv({}),{hotIntervalMs:300000,warmIntervalMs:21600000,coldIntervalMs:604800000,hotWindowMs:7200000});
  assert.equal(freshnessPolicyFromEnv({REXBID_SYNC_HOT_INTERVAL_MS:'120000'}).hotIntervalMs,120000);
  assert.throws(()=>freshnessPolicyFromEnv({REXBID_SYNC_COLD_INTERVAL_MS:'never'}),/REXBID_SYNC_COLD_INTERVAL_MS/);
  assert.equal(classifyScopeState({status:'partial',cursor:'opaque',cursor_updated_at:new Date(NOW-1000).toISOString()},{now:NOW,staleAfterMs:60000}),'partial');
  assert.equal(classifyScopeState({status:'partial',cursor:'opaque',cursor_updated_at:new Date(NOW-120000).toISOString()},{now:NOW,staleAfterMs:60000}),'stale');
  assert.equal(classifyScopeState({status:'complete',last_complete_at:new Date(NOW-120000).toISOString()},{now:NOW,staleAfterMs:60000}),'stale');
  assert.equal(classifyScopeState({status:'failed'},{now:NOW,staleAfterMs:60000}),'failed');
  assert.equal(classifyScopeState({status:'complete',last_complete_at:new Date(NOW-1000).toISOString()},{now:NOW,staleAfterMs:60000}),'complete');
});

test('Phase F exhausted persistent budget schedules zero new provider calls',async()=>{
  const{sqlite,d1}=database();const repo=new D1SyncRepository(d1);
  await repo.initializeBudget({provider:BUDGET_PROVIDER,budgetDay:BUDGET_CAMPAIGN,normalLimit:MAX_PHASE_F_REQUESTS,retryLimit:0,now:NOW});
  sqlite.prepare(`UPDATE provider_request_budgets SET normal_consumed=?,normal_limit=?,retry_limit=0 WHERE provider=? AND budget_day=?`)
    .run(MAX_PHASE_F_REQUESTS,MAX_PHASE_F_REQUESTS,BUDGET_PROVIDER,BUDGET_CAMPAIGN);
  const calls=[];const result=await runControlledBackfill({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-f-exhausted',maxPages:2,now:()=>NOW,provider:providerFor(calls)});
  assert.equal(result.ok,true);assert.equal(result.liveRequests,0);assert.equal(result.stopReason,'request_budget_exhausted');assert.equal(calls.length,0);
  assert.equal(sqlite.prepare('SELECT cursor FROM provider_sync_scopes WHERE scope_key=?').get(PHASE_D_SCOPE).cursor,'saved-cursor-1');
  assert.equal(sqlite.prepare('SELECT normal_consumed,normal_reserved FROM provider_request_budgets WHERE provider=? AND budget_day=?').get(BUDGET_PROVIDER,BUDGET_CAMPAIGN).normal_consumed,MAX_PHASE_F_REQUESTS);
  sqlite.close();
});

test('Phase F 429 and 5xx consume one attempt and never retry automatically',async()=>{
  for(const [status,error] of [[429,'provider_rate_limited'],[503,'provider_5xx']]){
    const{sqlite,d1}=database();let calls=0;
    const provider=createApibaraProvider({timeoutMs:500,console:{warn(){},error(){}},fetch:async()=>{calls+=1;return new Response('{}',{status,headers:{'content-type':'application/json'}});}});
    const result=await runControlledBackfill({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:`phase-f-${status}`,maxPages:2,now:()=>NOW,provider});
    assert.equal(result.ok,false);assert.equal(result.error,error);assert.equal(result.liveRequests,1);assert.equal(calls,1);
    assert.equal(sqlite.prepare('SELECT cursor FROM provider_sync_scopes WHERE scope_key=?').get(PHASE_D_SCOPE).cursor,'saved-cursor-1');
    assert.equal(sqlite.prepare('SELECT normal_consumed,normal_reserved,retry_limit,retry_consumed FROM provider_request_budgets WHERE provider=? AND budget_day=?').get(BUDGET_PROVIDER,BUDGET_CAMPAIGN).normal_consumed,1);
    sqlite.close();
  }
});
