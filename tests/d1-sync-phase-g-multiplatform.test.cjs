const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createApibaraProvider}=require('../providers/apibara.js');
const {D1SyncRepository}=require('../sync/d1-repository.js');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const {runPlatformBackfill,runProductMilestoneBackfill,handlePhaseGRequest,PLATFORMS,PER_PLATFORM_LIMIT,TOTAL_CAMPAIGN_LIMIT,BUDGET_PROVIDER,budgetKey,campaignBudgetKey}=require('../staging/phase-g-multiplatform-backfill.cjs');

const ROOT=path.join(__dirname,'..');
// Scope freshness is computed against the real clock; keep synthetic rows
// recent so this test exercises independent scope behavior, not staleness.
const NOW=Date.now();
const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8'));
const COPART_SCOPE=PLATFORMS.copart.scopeKey;
const env={APIBARA_API_KEY:'mock-only',REXBID_SYNC_HOT_INTERVAL_MS:'300000',REXBID_SYNC_WARM_INTERVAL_MS:'21600000',REXBID_SYNC_COLD_INTERVAL_MS:'604800000',REXBID_SYNC_HOT_WINDOW_MS:'7200000'};

class DisposableD1{
  constructor(sqlite){this.sqlite=sqlite;this.tail=Promise.resolve();this.failNextBatch=false;}
  prepare(sql){const db=this.sqlite;const bound=params=>({sql,params,async first(){return db.prepare(sql).get(...params)??null;},async all(){return{results:db.prepare(sql).all(...params)};},async run(){const r=db.prepare(sql).run(...params);return{success:true,meta:{changes:Number(r.changes)}};}});return{bind(...params){return bound(params);},async first(...params){return db.prepare(sql).get(...params)??null;},async all(...params){return{results:db.prepare(sql).all(...params)};},async run(...params){const r=db.prepare(sql).run(...params);return{success:true,meta:{changes:Number(r.changes)}};}};}
  batch(statements){const operation=this.tail.then(()=>{if(this.failNextBatch&&statements.some(s=>/INSERT INTO auction_listing_snapshots/i.test(s.sql))){this.failNextBatch=false;throw new Error('synthetic D1 batch failure');}this.sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>{const q=this.sqlite.prepare(s.sql);if(/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(s.sql))return{success:true,results:q.all(...s.params)};const r=q.run(...s.params);return{success:true,meta:{changes:Number(r.changes)}};});this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}});this.tail=operation.catch(()=>undefined);return operation;}
}
function database({copartCursor='copart-cursor-1'}={}){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of ['migrations/0000_rexbid_base.sql','migrations/0001_auction_history_events.sql','migrations-staging/0003_accounts_foundation.sql','docs/proposals/0004_d1_sync_2.sql'])sqlite.exec(fs.readFileSync(path.join(ROOT,file),'utf8'));
  const d1=new DisposableD1(sqlite);
  if(copartCursor!==undefined)sqlite.prepare(`INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,last_attempt_at,updated_at) VALUES(?,'apibara','copart','discovery','partial',?,?,?)`).run(COPART_SCOPE,copartCursor,new Date(NOW-1000).toISOString(),new Date(NOW-1000).toISOString());
  sqlite.prepare(`INSERT INTO users(id,auth_subject,auth_issuer,email_verified,auth_provider,created_at,updated_at) VALUES('synthetic-user','sub-1','issuer',1,'supabase',?,?)`).run(new Date(NOW).toISOString(),new Date(NOW).toISOString());
  sqlite.prepare(`INSERT INTO user_favorites(user_id,favorite_key,platform,lot,created_at,updated_at) VALUES('synthetic-user','lot:copart:SAFE-FAV','copart','SAFE-FAV',?,?)`).run(new Date(NOW).toISOString(),new Date(NOW).toISOString());
  return{sqlite,d1};
}
function providerFor({failPlatform=null,nextCursorByPlatform={},cursorSequencesByPlatform={},sameVin=false,recordsPerPage=1,withMedia=false}={}){
  const calls=[];
  const provider=createApibaraProvider({timeoutMs:500,console:{warn(){},error(){}},fetch:async(url,options)=>{
    const parsed=new URL(url),platform=parsed.searchParams.get('platform'),cursor=parsed.searchParams.get('cursor');
    calls.push({platform,cursor,method:options.method});
    if(platform===failPlatform)throw new TypeError('synthetic provider outage');
    const pageIndex=calls.filter(call=>call.platform===platform).length-1;
    const rows=Array.from({length:recordsPerPage},(_,index)=>{
      const raw=structuredClone(seed.response.data[0]);const suffix=platform==='copart'?'C':'I';
      raw.platform=platform;raw.vehicle_id=`shared-source-${platform}-${pageIndex}-${index}`;raw.lot_number=`MULTI-${suffix}-${pageIndex}-${index}`;
      raw.vin=sameVin?'SHAREDVIN00000001':`VIN-${platform}-${pageIndex}-${index}`;
      raw.media=withMedia?{items:[`https://images.example.invalid/${platform}-${pageIndex}-${index}.jpg`],thumbs:[`https://images.example.invalid/${platform}-${pageIndex}-${index}-small.jpg`]}:{items:[],thumbs:[]};return raw;
    });
    const sequence=cursorSequencesByPlatform[platform];
    const next=Array.isArray(sequence)?(sequence[pageIndex]??null):(Object.hasOwn(nextCursorByPlatform,platform)?nextCursorByPlatform[platform]:null);
    return new Response(JSON.stringify({response:{data:rows,meta:{next_cursor:next}}}),{status:200,headers:{'content-type':'application/json'}});
  }});
  return{provider,calls};
}

test('Copart i IAAI synchronizują równolegle do niezależnych scope/cursor/lease/budget, bez VIN merge i fałszywych eventów',async()=>{
  const{sqlite,d1}=database();const upstream=providerFor({sameVin:true,nextCursorByPlatform:{copart:'copart-cursor-2',iaai:'iaai-cursor-2'}});
  const [copart,iaai]=await Promise.all([
    runPlatformBackfill({db:d1,env,requestId:'parallel-copart',platform:'copart',maxPages:1,now:()=>NOW,provider:upstream.provider}),
    runPlatformBackfill({db:d1,env,requestId:'parallel-iaai',platform:'iaai',maxPages:1,now:()=>NOW,provider:upstream.provider})
  ]);
  assert.equal(copart.ok,true,JSON.stringify(copart));assert.equal(iaai.ok,true,JSON.stringify(iaai));
  assert.deepEqual(upstream.calls.map(x=>x.platform).sort(),['copart','iaai']);
  const scopes=sqlite.prepare("SELECT platform,status,cursor,lease_owner,last_success_at,last_complete_at FROM provider_sync_scopes WHERE operation='discovery' ORDER BY platform").all();
  assert.deepEqual(scopes.map(x=>[x.platform,x.status,x.cursor,x.lease_owner,x.last_success_at,x.last_complete_at]),[
    ['copart','partial','copart-cursor-2',null,new Date(NOW).toISOString(),null],
    ['iaai','partial','iaai-cursor-2',null,new Date(NOW).toISOString(),null]
  ],'udany commit strony ustawia last_success_at nawet przy partial scope, ale nie last_complete_at');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,2);
  assert.equal(sqlite.prepare('SELECT COUNT(DISTINCT vin_normalized) n FROM auction_listings').get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(DISTINCT listing_id) n FROM auction_listings').get().n,2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM vehicle_entities').get().n,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sync_page_commits WHERE scope_key=?').get(COPART_SCOPE).n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sync_page_commits WHERE scope_key=?').get(PLATFORMS.iaai.scopeKey).n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM provider_request_budgets WHERE provider=?').get(BUDGET_PROVIDER).n,3);
  assert.equal(copart.campaignBudget.consumed,2);assert.equal(iaai.campaignBudget.consumed,2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM users').get().n,1);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM user_favorites').get().n,1);
  sqlite.close();
});

test('IAAI first page may finish its own scope while Copart remains partial; Phase E reads both canonical listings',async()=>{
  const{sqlite,d1}=database();const source=providerFor({nextCursorByPlatform:{copart:'c-next',iaai:null}});
  const c=await runPlatformBackfill({db:d1,env,requestId:'scope-c',platform:'copart',maxPages:1,now:()=>NOW,provider:source.provider});
  const i=await runPlatformBackfill({db:d1,env,requestId:'scope-i',platform:'iaai',maxPages:1,now:()=>NOW+1,provider:source.provider});
  assert.equal(c.scopeStatus,'partial');assert.equal(i.scopeStatus,'complete');assert.equal(i.nextCursorPresent,false);
  const read=new D1ReadRepository(d1,{now:()=>NOW+10});
  const copart=await read.listCatalog({platform:'copart',limit:10}),iaai=await read.listCatalog({platform:'iaai',limit:10});
  assert.equal(copart.records.length,1);assert.equal(iaai.records.length,1);assert.equal(copart.read.catalog_complete,false);assert.equal(iaai.read.catalog_complete,true);
  assert.equal((await read.getListingById(iaai.records[0].listing_id)).vehicle.platform,'iaai');
  assert.equal((await read.getCoverage()).complete,false,'combined catalog cannot claim complete while Copart scope is partial');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
  sqlite.close();
});

test('failed IAAI page does not move, fail, spend the scope cursor of Copart; failed attempt consumes only IAAI budget',async()=>{
  const{sqlite,d1}=database();const online=providerFor({nextCursorByPlatform:{copart:'c-next'},failPlatform:'iaai'});
  const ok=await runPlatformBackfill({db:d1,env,requestId:'c-ok',platform:'copart',maxPages:1,now:()=>NOW,provider:online.provider});
  const failed=await runPlatformBackfill({db:d1,env,requestId:'i-fail',platform:'iaai',maxPages:1,now:()=>NOW+1,provider:online.provider});
  assert.equal(ok.ok,true);assert.equal(failed.ok,false);assert.equal(failed.error,'provider_unavailable');assert.equal(failed.liveRequests,1);
  const c=sqlite.prepare('SELECT status,cursor,last_success_at,last_complete_at FROM provider_sync_scopes WHERE scope_key=?').get(COPART_SCOPE);
  const i=sqlite.prepare('SELECT status,cursor,last_success_at,last_complete_at FROM provider_sync_scopes WHERE scope_key=?').get(PLATFORMS.iaai.scopeKey);
  assert.deepEqual({...c},{status:'partial',cursor:'c-next',last_success_at:new Date(NOW).toISOString(),last_complete_at:null});
  assert.deepEqual({...i},{status:'failed',cursor:null,last_success_at:null,last_complete_at:null},'nieudana, niezapisana strona nie oznacza sukcesu');
  const cBudget=sqlite.prepare('SELECT normal_consumed FROM provider_request_budgets WHERE provider=? AND budget_day=?').get(BUDGET_PROVIDER,budgetKey('copart'));
  const iBudget=sqlite.prepare('SELECT normal_consumed FROM provider_request_budgets WHERE provider=? AND budget_day=?').get(BUDGET_PROVIDER,budgetKey('iaai'));
  assert.equal(cBudget.normal_consumed,1);assert.equal(iBudget.normal_consumed,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE platform=?').get('copart').n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings WHERE platform=?').get('iaai').n,0);
  sqlite.close();
});

test('page replay is idempotent; identical canonical payload creates no second snapshot or auction event',async()=>{
  const{sqlite,d1}=database();const upstream=providerFor({nextCursorByPlatform:{copart:'c-next'}});
  const result=await runPlatformBackfill({db:d1,env,requestId:'replay',platform:'copart',maxPages:1,now:()=>NOW,provider:upstream.provider});
  assert.equal(result.replayVerified,true);assert.equal(result.duplicates,0);assert.equal(result.snapshotsCreated,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listing_snapshots').get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
  assert.equal(sqlite.prepare('SELECT pages_completed FROM sync_runs WHERE run_id=?').get(result.runId).pages_completed,1);
  sqlite.close();
});

test('persistent discovery reports stored HTTPS media references separately from raw payloads and binary images',async()=>{
  const{sqlite,d1}=database();const upstream=providerFor({nextCursorByPlatform:{copart:'media-next'},recordsPerPage:2,withMedia:true});
  const result=await runPlatformBackfill({db:d1,env,requestId:'media-reporting',platform:'copart',maxPages:1,now:()=>NOW,provider:upstream.provider});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.rawPayloadStored,false);assert.equal(result.binaryMediaStored,false);
  assert.equal(result.mediaListingsPersisted,2);assert.equal(result.mediaUrlReferencesPersisted,4);
  const rows=sqlite.prepare('SELECT media_urls_json,media_thumbs_json FROM auction_listings ORDER BY listing_id').all();
  assert.equal(rows.length,2);for(const row of rows){assert.equal(JSON.parse(row.media_urls_json).length,1);assert.equal(JSON.parse(row.media_thumbs_json).length,1);}
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auction_listings WHERE media_urls_json LIKE '%raw_payload%' OR media_urls_json LIKE '%data:image/%'").get().n,0);
  sqlite.close();
});

test('D1 batch failure after provider response leaves cursor/page/listing uncommitted and scope recoverable',async()=>{
  const{sqlite,d1}=database();const source=providerFor({nextCursorByPlatform:{copart:'c-next'}});d1.failNextBatch=true;
  const result=await runPlatformBackfill({db:d1,env,requestId:'crash-before-page-commit',platform:'copart',maxPages:1,now:()=>NOW,provider:source.provider});
  assert.equal(source.calls.length,1);assert.equal(result.ok,false);assert.equal(result.error,'phase_g_failed');
  const scope=sqlite.prepare('SELECT status,cursor,last_complete_at,lease_owner FROM provider_sync_scopes WHERE scope_key=?').get(COPART_SCOPE);
  assert.equal(scope.cursor,'copart-cursor-1');assert.equal(scope.last_complete_at,null);assert.equal(scope.lease_owner,null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sync_page_commits').get().n,0);
  assert.equal(sqlite.prepare('SELECT normal_consumed,normal_reserved FROM provider_request_budgets WHERE provider=? AND budget_day=?').get(BUDGET_PROVIDER,budgetKey('copart')).normal_consumed,1);
  sqlite.close();
});

test('per-platform budgets enforce ten each and the campaign hard ceiling twenty without automatic provider calls',async()=>{
  const{sqlite,d1}=database();const repo=new D1SyncRepository(d1);
  for(const platform of ['copart','iaai'])await repo.initializeBudget({provider:BUDGET_PROVIDER,budgetDay:budgetKey(platform),normalLimit:PER_PLATFORM_LIMIT,retryLimit:0,now:NOW});
  await repo.initializeBudget({provider:BUDGET_PROVIDER,budgetDay:campaignBudgetKey(),normalLimit:TOTAL_CAMPAIGN_LIMIT,retryLimit:0,now:NOW});
  sqlite.prepare('UPDATE provider_request_budgets SET normal_consumed=normal_limit WHERE provider=? AND budget_day=?').run(BUDGET_PROVIDER,campaignBudgetKey());
  const source=providerFor();
  const [c,i]=await Promise.all(['copart','iaai'].map(platform=>runPlatformBackfill({db:d1,env,requestId:'cap-'+platform,platform,maxPages:2,now:()=>NOW,provider:source.provider})));
  assert.equal(PER_PLATFORM_LIMIT,10);assert.equal(TOTAL_CAMPAIGN_LIMIT,20);
  assert.equal(c.liveRequests,0);assert.equal(i.liveRequests,0);assert.equal(source.calls.length,0);
  assert.equal(c.stopReason,'request_budget_exhausted');assert.equal(i.stopReason,'request_budget_exhausted');
  assert.equal(c.campaignBudget.consumed,20);assert.equal(c.campaignBudget.reserved,0);
  assert.equal(sqlite.prepare('SELECT SUM(normal_consumed) n FROM provider_request_budgets WHERE provider=?').get(BUDGET_PROVIDER).n,20);
  assert.equal(sqlite.prepare('SELECT SUM(retry_consumed+retry_reserved) n FROM provider_request_budgets WHERE provider=?').get(BUDGET_PROVIDER).n,0);
  sqlite.close();
});

test('shared campaign reservation prevents concurrent platforms from exceeding the global hard cap',async()=>{
  const{sqlite,d1}=database();const repo=new D1SyncRepository(d1),source=providerFor();
  await repo.initializeBudget({provider:BUDGET_PROVIDER,budgetDay:campaignBudgetKey(),normalLimit:1,retryLimit:0,now:NOW});
  const [copart,iaai]=await Promise.all(['copart','iaai'].map(platform=>runPlatformBackfill({
    db:d1,env,requestId:'global-cap-'+platform,platform,maxPages:1,now:()=>NOW,provider:source.provider
  })));
  assert.equal(source.calls.length,1);
  assert.equal([copart,iaai].filter(result=>result.liveRequests===1).length,1);
  assert.equal([copart,iaai].filter(result=>result.stopReason==='request_budget_exhausted').length,1);
  const global=sqlite.prepare('SELECT normal_limit,normal_consumed,normal_reserved FROM provider_request_budgets WHERE provider=? AND budget_day=?').get(BUDGET_PROVIDER,campaignBudgetKey());
  assert.equal(global.normal_limit,1);assert.equal(global.normal_consumed,1);assert.equal(global.normal_reserved,0);
  sqlite.close();
});

test('one Product Milestone action resumes both independent scopes, max two pages each, and stays within four live requests',async()=>{
  const{sqlite,d1}=database();
  sqlite.prepare("INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,last_attempt_at,updated_at) VALUES(?,'apibara','iaai','discovery','partial','iaai-cursor-1',?,?)")
    .run(PLATFORMS.iaai.scopeKey,new Date(NOW-1000).toISOString(),new Date(NOW-1000).toISOString());
  const source=providerFor({cursorSequencesByPlatform:{copart:['copart-cursor-2','copart-cursor-3'],iaai:['iaai-cursor-2','iaai-cursor-3']}});
  const result=await runProductMilestoneBackfill({db:d1,env,requestId:'one-click-product-milestone',now:()=>NOW,provider:source.provider});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.liveRequests,4);assert.equal(result.maxLiveRequests,4);
  assert.deepEqual(source.calls.map(call=>[call.platform,call.cursor]),[['copart','copart-cursor-1'],['copart','copart-cursor-2'],['iaai','iaai-cursor-1'],['iaai','iaai-cursor-2']]);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auction_listings WHERE platform=\'copart\'').get().n,2);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auction_listings WHERE platform=\'iaai\'').get().n,2);
  const copartScope=sqlite.prepare('SELECT status,cursor FROM provider_sync_scopes WHERE scope_key=?').get(COPART_SCOPE);
  const iaaiScope=sqlite.prepare('SELECT status,cursor FROM provider_sync_scopes WHERE scope_key=?').get(PLATFORMS.iaai.scopeKey);
  assert.equal(copartScope.status,'partial');assert.equal(copartScope.cursor,'copart-cursor-3');
  assert.equal(iaaiScope.status,'partial');assert.equal(iaaiScope.cursor,'iaai-cursor-3');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auction_listing_snapshots').get().n,4);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auction_events').get().n,0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM vehicle_entities').get().n,0);
  assert.equal(result.campaignBudget.consumed,4);assert.equal(result.campaignBudget.reserved,0);
  sqlite.close();
});

test('one Product Milestone action stops after the first platform failure and does not call the second provider scope',async()=>{
  const{sqlite,d1}=database();const source=providerFor({failPlatform:'copart'});
  const result=await runProductMilestoneBackfill({db:d1,env,requestId:'stop-after-error',now:()=>NOW,provider:source.provider});
  assert.equal(result.ok,false);assert.equal(result.liveRequests,1);assert.equal(result.stopReason,'platform_run_failed');
  assert.deepEqual(source.calls.map(call=>call.platform),['copart']);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM provider_request_budgets WHERE provider=? AND budget_day=?').get(BUDGET_PROVIDER,budgetKey('iaai')).n,0);
  sqlite.close();
});

test('page cap, invalid platform, cursor repetition and provider failures do not create hidden retries',async()=>{
  const{sqlite,d1}=database();const source=providerFor({nextCursorByPlatform:{copart:'copart-cursor-1'}});
  const invalid=await runPlatformBackfill({db:d1,env,requestId:'bad',platform:'manheim',now:()=>NOW,provider:source.provider});
  assert.equal(invalid.error,'invalid_platform');assert.equal(source.calls.length,0);
  const tooMany=await runPlatformBackfill({db:d1,env,requestId:'pages',platform:'copart',maxPages:5,now:()=>NOW,provider:source.provider});
  assert.equal(tooMany.error,'invalid_page_limit');assert.equal(source.calls.length,0);
  const repeated=await runPlatformBackfill({db:d1,env,requestId:'repeated',platform:'copart',maxPages:2,now:()=>NOW,provider:source.provider});
  assert.equal(repeated.error,'repeated_cursor');assert.equal(repeated.liveRequests,1);assert.equal(source.calls.length,1);
  assert.equal(sqlite.prepare('SELECT cursor FROM provider_sync_scopes WHERE scope_key=?').get(COPART_SCOPE).cursor,'copart-cursor-1');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM auction_listings').get().n,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sync_page_commits').get().n,0);
  sqlite.close();
});

test('multi-platform staging endpoints require exact staging target, same-origin session, platform allowlist, and expose no cursor value',async()=>{
  const{sqlite,d1}=database();const stageEnv={...env,REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev',REXBID_PHASE_G_MULTIPLATFORM:'enabled',REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_DB:d1};
  let providerCalls=0;const source=providerFor();const wrapped={...source.provider,listVehicles:(...args)=>{providerCalls++;return source.provider.listVehicles(...args);}};
  const dispatch=async()=>new Response('{"user":{"id":"verified-user"}}',{status:200});
  const make=(path,method='GET',host='rexbid-auth-test.tedn828.workers.dev',origin=`https://${host}`,site='same-origin',body)=>new Request(`https://${host}${path}`,{method,headers:{Cookie:'session-cookie','Sec-Fetch-Site':site,...(origin?{Origin:origin}:{}),...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  assert.equal((await handlePhaseGRequest(make('/__staging/d1-sync-multiplatform/status','GET','evil.invalid'),stageEnv,null,dispatch,wrapped)).status,404);
  const noOrigin=await handlePhaseGRequest(make('/__staging/d1-sync-multiplatform','POST','rexbid-auth-test.tedn828.workers.dev','https://attacker.invalid','cross-site',{platform:'iaai',max_pages:1}),stageEnv,null,dispatch,wrapped);
  assert.equal(noOrigin.status,404);
  const noSession=await handlePhaseGRequest(new Request('https://rexbid-auth-test.tedn828.workers.dev/__staging/d1-sync-multiplatform/status',{headers:{'Sec-Fetch-Site':'same-origin'}}),stageEnv,null,dispatch,wrapped);
  assert.equal(noSession.status,404);
  const status=await handlePhaseGRequest(make('/__staging/d1-sync-multiplatform/status'),stageEnv,null,dispatch,wrapped);
  const statusBody=await status.json();assert.equal(status.status,200);assert.equal(statusBody.platforms.iaai.scope_status,'not_started');
  assert.equal(statusBody.platforms.copart.scope_freshness,'partial');assert.equal(statusBody.platforms.iaai.scope_freshness,'stale');
  assert.equal(JSON.stringify(statusBody).includes('copart-cursor-1'),false);assert.equal(providerCalls,0);
  const badPlatform=await handlePhaseGRequest(make('/__staging/d1-sync-multiplatform','POST',undefined,undefined,'same-origin',{platform:'manheim',max_pages:1}),stageEnv,null,dispatch,wrapped);
  assert.equal(badPlatform.status,400);assert.equal(providerCalls,0);
  const disabled=await handlePhaseGRequest(make('/__staging/d1-sync-multiplatform/status'),{...stageEnv,REXBID_PHASE_G_MULTIPLATFORM:'disabled'},null,dispatch,wrapped);
  assert.equal(disabled.status,404);sqlite.close();
});

test('single Product Milestone endpoint is authenticated, exact-host guarded, one POST, and caps provider calls at four',async()=>{
  const{sqlite,d1}=database();
  const stageEnv={...env,REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev',REXBID_PHASE_G_MULTIPLATFORM:'enabled',REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_DB:d1};
  const source=providerFor({cursorSequencesByPlatform:{copart:['c-next','c-more'],iaai:['i-next','i-more']}});
  const dispatch=async()=>new Response('{"user":{"id":"verified-user"}}',{status:200});
  const make=(host='rexbid-auth-test.tedn828.workers.dev',origin=`https://${host}`,body={})=>new Request(`https://${host}/__staging/d1-sync-product-milestone`,{method:'POST',headers:{Cookie:'synthetic-session','Sec-Fetch-Site':'same-origin',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const denied=await handlePhaseGRequest(make('production.example'),stageEnv,null,dispatch,source.provider);
  assert.equal(denied.status,404);assert.equal(source.calls.length,0);
  const badBody=await handlePhaseGRequest(make(undefined,undefined,{max_pages:20}),stageEnv,null,dispatch,source.provider);
  assert.equal(badBody.status,400);assert.equal(source.calls.length,0);
  const response=await handlePhaseGRequest(make(),stageEnv,null,dispatch,source.provider);
  const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.liveRequests,4);assert.equal(body.maxLiveRequests,4);
  assert.deepEqual(body.platforms.map(item=>item.platform),['copart','iaai']);
  assert.deepEqual(source.calls.map(call=>call.platform),['copart','copart','iaai','iaai']);
  sqlite.close();
});
