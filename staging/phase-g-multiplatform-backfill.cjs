"use strict";

const {createApibaraProvider}=require("../providers/apibara.js");
const {D1SyncRepository}=require("../sync/d1-repository.js");
const {D1ReadRepository}=require("../sync/d1-read-repository.js");
const {canonicalizeDiscoveryPage}=require("../sync/discovery-page.js");
const {freshnessPolicyFromEnv,classifyScopeState}=require("../sync/backfill-policy.js");

const STAGING_HOST="rexbid-auth-test.tedn828.workers.dev";
const PLATFORMS=Object.freeze({
  copart:Object.freeze({scopeKey:"rexbid-phase-d:persistent-discovery:copart",label:"Copart"}),
  iaai:Object.freeze({scopeKey:"rexbid-phase-g:persistent-discovery:iaai",label:"IAAI"})
});
const PAGE_SIZE=20;
const MAX_PAGES_PER_RUN=2;
const DEFAULT_PAGES_PER_RUN=2;
const PER_PLATFORM_LIMIT=6;
const TOTAL_CAMPAIGN_LIMIT=12;
const BUDGET_PROVIDER="apibara-phase-g-multiplatform";
const CAMPAIGN="campaign-multiplatform-4c4e938";
function budgetKey(platform){return `${CAMPAIGN}-${platform}`;}

function json(data,status=200,id=null,extraHeaders=[]){
  const headers=new Headers({"Content-Type":"application/json; charset=UTF-8","Cache-Control":"private, no-store","Pragma":"no-cache","X-Robots-Tag":"noindex, nofollow, noarchive","Referrer-Policy":"no-referrer"});
  if(id)headers.set("X-RexBid-Request-ID",id);
  for(const [key,value] of extraHeaders)headers.append(key,value);
  return new Response(JSON.stringify(data),{status,headers});
}
function safeCode(error){return /^[a-z0-9_]{1,64}$/.test(String(error?.safeCode||""))?error.safeCode:"phase_g_failed";}
async function getBudget(db,platform){return db.prepare(`SELECT normal_limit,normal_consumed,normal_reserved,retry_limit,retry_consumed,retry_reserved
  FROM provider_request_budgets WHERE provider=? AND budget_day=?`).bind(BUDGET_PROVIDER,budgetKey(platform)).first();}

async function readPlatformStatus(db,platform,now=Date.now(),staleAfterMs=86_400_000){
  const config=PLATFORMS[platform];
  const [scope,budget,counts,facets,sources,snapshots,events]=await Promise.all([
    db.prepare("SELECT status,cursor,cursor_updated_at,last_attempt_at,last_success_at,last_complete_at FROM provider_sync_scopes WHERE scope_key=?").bind(config.scopeKey).first(),
    getBudget(db,platform),
    db.prepare(`SELECT COUNT(*) listings,COUNT(DISTINCT make) makes,COUNT(DISTINCT model) models,
      MIN(year) min_year,MAX(year) max_year,SUM(CASE WHEN auction_state IS NOT NULL THEN 1 ELSE 0 END) with_status,
      SUM(CASE WHEN auction_at IS NOT NULL THEN 1 ELSE 0 END) with_auction_time,
      SUM(CASE WHEN buy_now_usd>0 THEN 1 ELSE 0 END) buy_now,
      SUM(CASE WHEN is_timed=1 THEN 1 ELSE 0 END) timed,
      SUM(CASE WHEN is_timed IS NULL THEN 1 ELSE 0 END) missing_timed,
      SUM(CASE WHEN auction_at IS NOT NULL AND auction_at>=? THEN 1 ELSE 0 END) upcoming,
      SUM(CASE WHEN lower(COALESCE(auction_state,'')) IN ('sold','ended','closed','completed') THEN 1 ELSE 0 END) sold_ended,
      SUM(CASE WHEN location_postal_code IS NOT NULL AND location_postal_code<>'' THEN 1 ELSE 0 END) with_zip,
      SUM(CASE WHEN location_display IS NOT NULL AND location_display<>'' THEN 1 ELSE 0 END) with_location,
      SUM(CASE WHEN location_state IS NOT NULL AND location_state<>'' THEN 1 ELSE 0 END) with_state,
      SUM(CASE WHEN vin_normalized IS NOT NULL AND vin_normalized<>'' THEN 1 ELSE 0 END) with_vin,
      SUM(CASE WHEN make IS NULL OR make='' THEN 1 ELSE 0 END) missing_make,
      SUM(CASE WHEN model IS NULL OR model='' THEN 1 ELSE 0 END) missing_model,
      SUM(CASE WHEN year IS NULL THEN 1 ELSE 0 END) missing_year,
      SUM(CASE WHEN auction_state IS NULL OR auction_state='' THEN 1 ELSE 0 END) missing_status,
      SUM(CASE WHEN current_bid_usd IS NULL AND buy_now_usd IS NULL THEN 1 ELSE 0 END) missing_prices,
      SUM(CASE WHEN odometer_value IS NULL THEN 1 ELSE 0 END) missing_mileage,
      SUM(CASE WHEN seller_name IS NULL OR seller_name='' THEN 1 ELSE 0 END) missing_seller,
      COUNT(DISTINCT listing_id) unique_listings
      FROM auction_listings WHERE platform=?`).bind(new Date(now).toISOString(),platform).first(),
    db.prepare("SELECT auction_state,COUNT(*) AS count FROM auction_listings WHERE platform=? GROUP BY auction_state ORDER BY auction_state").bind(platform).all(),
    db.prepare("SELECT COUNT(*) AS count,COUNT(DISTINCT source_key) AS unique_count FROM vehicle_sources WHERE platform=?").bind(platform).first(),
    db.prepare("SELECT COUNT(*) AS count FROM auction_listing_snapshots s JOIN auction_listings l ON l.listing_id=s.listing_id WHERE l.platform=?").bind(platform).first(),
    db.prepare("SELECT COUNT(*) AS count FROM auction_events WHERE platform=?").bind(platform).first()
  ]);
  const platformBudgets=await Promise.all(Object.keys(PLATFORMS).map(key=>getBudget(db,key)));
  const campaignConsumed=platformBudgets.reduce((n,row)=>n+Number(row?.normal_consumed||0)+Number(row?.normal_reserved||0),0);
  const ownConsumed=Number(budget?.normal_consumed||0)+Number(budget?.normal_reserved||0);
  const readRepo=new D1ReadRepository(db,{now:()=>now});
  const readLatency={unit:"ms",sampled_at:new Date(now).toISOString()};
  const measure=async operation=>{const started=performance.now();await operation();return Math.round((performance.now()-started)*1000)/1000;};
  readLatency.catalog=await measure(()=>readRepo.listCatalog({platform,limit:1}));
  readLatency.filters=await measure(()=>readRepo.getFilterMetadata({platform}));
  const sample=await db.prepare("SELECT listing_id FROM auction_listings WHERE platform=? ORDER BY listing_id LIMIT 1").bind(platform).first();
  if(sample?.listing_id){
    readLatency.detail=await measure(()=>readRepo.getListingById(sample.listing_id));
    readLatency.history=await measure(()=>readRepo.getSnapshotPage({listingId:sample.listing_id,limit:1}));
  }else{readLatency.detail=null;readLatency.history=null;}
  return {
    platform,scope_key:config.scopeKey,scope_status:scope?.status||"not_started",
    scope_freshness:classifyScopeState(scope,{now,staleAfterMs}),cursor_present:!!scope?.cursor,
    last_attempt_at:scope?.last_attempt_at||null,last_success_at:scope?.last_success_at||null,last_complete_at:scope?.last_complete_at||null,
    catalog_complete:scope?.status==="complete"&&!scope?.cursor,
    budget:{limit:PER_PLATFORM_LIMIT,consumed:ownConsumed,reserved:Number(budget?.normal_reserved||0),retry_limit:0,retry_consumed:0},
    campaign_budget:{limit:TOTAL_CAMPAIGN_LIMIT,consumed:campaignConsumed,reserved:platformBudgets.reduce((n,row)=>n+Number(row?.normal_reserved||0),0)},
    coverage:{...counts,sources:Number(sources?.count||0),unique_sources:Number(sources?.unique_count||0),
      snapshots:Number(snapshots?.count||0),events:Number(events?.count||0),auction_statuses:facets.results||[],
      metadata_complete:scope?.status==="complete"&&!scope?.cursor},
    read_latency_ms:readLatency
  };
}

async function runPlatformBackfill({db,env,requestId,platform,maxPages=DEFAULT_PAGES_PER_RUN,now=()=>Date.now(),provider=createApibaraProvider()}){
  const started=now();
  const config=PLATFORMS[platform];
  const result={ok:false,stage:"preflight",requestId,platform,pageSize:PAGE_SIZE,pagesRequested:maxPages,pagesProcessed:0,
    liveRequests:0,maxLiveRequests:PER_PLATFORM_LIMIT,totalCampaignLimit:TOTAL_CAMPAIGN_LIMIT,providerRecords:0,accepted:0,
    rejected:0,ambiguous:0,inserts:0,updates:0,duplicates:0,snapshotsCreated:0,eventsCreated:0,replayVerified:true,
    readback:true,rawOrMediaStored:false,stopReason:null,elapsedMs:0};
  const repo=new D1SyncRepository(db);let lease=null;let runId=null;
  try{
    if(!config)throw Object.assign(new Error(),{safeCode:"invalid_platform"});
    if(!Number.isInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES_PER_RUN)throw Object.assign(new Error(),{safeCode:"invalid_page_limit"});
    if(provider?.id!=="apibara"||!provider?.capabilities?.includes("vehicle.list"))throw Object.assign(new Error(),{safeCode:"provider_not_allowed"});
    if(!env?.APIBARA_API_KEY)throw Object.assign(new Error(),{safeCode:"provider_configuration_missing"});
    const start=now();
    await repo.ensureScope({scopeKey:config.scopeKey,provider:"apibara",platform,operation:"discovery",now:start});
    let scope=await repo.getScope(config.scopeKey);
    if(scope.status==="complete"&&scope.cursor==null)throw Object.assign(new Error(),{safeCode:"scope_complete"});
    // null cursor is valid only as an initial page (new IAAI scope or explicit replay after a failed first page).
    if(scope.cursor===undefined)throw Object.assign(new Error(),{safeCode:"scope_state_invalid"});
    const beforeCount=Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listings WHERE platform=?").bind(platform).first())?.n||0);
    const owner=`phase-g-${platform}-${requestId}`,token=crypto.randomUUID();
    result.stage="lease";
    lease=await repo.acquireLease({scopeKey:config.scopeKey,provider:"apibara",platform,operation:"discovery",owner,token,now:start,ttlMs:20*60_000});
    if(!lease.acquired)throw Object.assign(new Error(),{safeCode:"lease_busy"});
    runId=`phase-g-${platform}-${requestId}`;
    await repo.createRun({runId,scopeKey:config.scopeKey,provider:"apibara",platform,operation:"discovery",triggerKind:"operator",now:start});
    lease={...lease,scopeKey:config.scopeKey,provider:"apibara",platform,owner,token,runId};
    result.runId=runId;
    result.stage="budget";
    const campaignBudgetDay=budgetKey(platform);
    await repo.initializeBudget({provider:BUDGET_PROVIDER,budgetDay:campaignBudgetDay,normalLimit:PER_PLATFORM_LIMIT,retryLimit:0,now:start});
    await db.prepare(`UPDATE provider_request_budgets SET normal_limit=MIN(normal_limit,?),retry_limit=0,updated_at=? WHERE provider=? AND budget_day=?`)
      .bind(PER_PLATFORM_LIMIT,new Date(start).toISOString(),BUDGET_PROVIDER,campaignBudgetDay).run();
    scope=await repo.getScope(config.scopeKey);
    let cursor=scope.cursor??null;
    const seenCursors=new Set([cursor===null?"<first>":String(cursor)]);
    for(let pageNo=0;pageNo<maxPages;pageNo+=1){
      const budget=await getBudget(db,platform);
      const total=await Promise.all(Object.keys(PLATFORMS).map(key=>getBudget(db,key)));
      const totalUsed=total.reduce((n,row)=>n+Number(row?.normal_consumed||0)+Number(row?.normal_reserved||0),0);
      if(totalUsed>=TOTAL_CAMPAIGN_LIMIT||!budget||Number(budget.normal_consumed)+Number(budget.normal_reserved)>=PER_PLATFORM_LIMIT){result.stopReason="request_budget_exhausted";break;}
      const reservationId=`phase-g-${platform}-${requestId}-${pageNo+1}`;
      result.stage="budget_reserve";
      const reserve=await repo.reserveBudget({reservationId,provider:BUDGET_PROVIDER,budgetDay:campaignBudgetDay,bucket:"normal",count:1,now:now()});
      if(!reserve.allowed||!await repo.startBudgetReservation({reservationId,now:now()})){result.stopReason="request_budget_exhausted";break;}
      result.stage="provider_discovery";
      const fetchStarted=now();result.liveRequests+=1;
      await db.prepare("UPDATE sync_runs SET upstream_requests=upstream_requests+1 WHERE run_id=? AND status='running'").bind(runId).run();
      let upstream;
      try{upstream=await provider.listVehicles(env,{platform,per_page:PAGE_SIZE,...(cursor!==null?{cursor}:{})});}
      catch(error){await repo.finishBudgetReservation({reservationId,now:now()});throw Object.assign(new Error(),{safeCode:error?.code==="RATE_LIMITED"?"provider_rate_limited":error?.code==="TIMEOUT"?"provider_timeout":error?.status>=500?"provider_5xx":"provider_unavailable"});}
      const fetchedAt=now();await repo.finishBudgetReservation({reservationId,now:fetchedAt});
      result.providerLatencyMs=(result.providerLatencyMs||0)+Math.max(0,fetchedAt-fetchStarted);
      result.stage="canonicalize";
      const page=canonicalizeDiscoveryPage({provider,response:upstream,scopeKey:config.scopeKey,platform,cursor,now:fetchedAt,freshnessPolicy:freshnessPolicyFromEnv(env)});
      result.providerRecords+=page.providerRecords;result.accepted+=page.accepted;result.rejected+=page.rejected;result.ambiguous+=page.ambiguous;
      if(!page.accepted)throw Object.assign(new Error(),{safeCode:"no_valid_canonical_records"});
      const unique=[],pageIds=new Set();
      for(const record of page.records){if(pageIds.has(record.identity.listingId)){result.duplicates+=1;continue;}pageIds.add(record.identity.listingId);unique.push(record);}
      const existed=[];
      for(const record of unique){const [listing,source]=await Promise.all([repo.getListing(record.identity.listingId),repo.getSource({provider:"apibara",platform,providerVehicleId:record.vehicle.provider_vehicle_id})]);existed.push(Boolean(listing||source));}
      const pageInput={scopeKey:config.scopeKey,provider:"apibara",platform,runId,owner,token,leaseGeneration:lease.leaseGeneration,cursor,
        nextCursor:page.nextCursor,records:unique,now:fetchedAt,recordsReceived:page.providerRecords,recordsInserted:existed.filter(x=>!x).length,
        recordsUpdated:existed.filter(Boolean).length,recordsSkipped:page.rejected+page.ambiguous,latencyMs:Math.max(0,fetchedAt-fetchStarted)};
      const beforeSnapshots=Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listing_snapshots s JOIN auction_listings l ON l.listing_id=s.listing_id WHERE l.platform=?").bind(platform).first())?.n||0);
      result.stage="persist";
      let persisted;
      try{persisted=await repo.persistDiscoveryPage(pageInput);}catch(error){if(String(error?.message||"")==="REPEATED_CURSOR")throw Object.assign(new Error(),{safeCode:"repeated_cursor"});throw error;}
      result.pagesProcessed+=1;result.inserts+=pageInput.recordsInserted;result.updates+=pageInput.recordsUpdated;
      const replay=await repo.persistDiscoveryPage(pageInput);
      if(!replay.replayed)throw Object.assign(new Error(),{safeCode:"replay_not_idempotent"});
      result.snapshotsCreated+=Math.max(0,Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listing_snapshots s JOIN auction_listings l ON l.listing_id=s.listing_id WHERE l.platform=?").bind(platform).first())?.n||0)-beforeSnapshots);
      result.replayVerified=result.replayVerified&&replay.replayed;
      const readRepo=new D1ReadRepository(db);
      for(const record of unique){const saved=await readRepo.getListingById(record.identity.listingId);if(!saved||saved.vehicle.platform!==platform||saved.vehicle.provider!=="apibara")result.readback=false;}
      if(!result.readback)throw Object.assign(new Error(),{safeCode:"d1_readback_mismatch"});
      cursor=page.nextCursor??null;result.nextCursorPresent=cursor!==null;result.scopeComplete=Boolean(persisted.complete);
      if(persisted.complete){lease=null;result.stopReason="scope_complete";break;}
      const cursorKey=cursor===null?"<first>":String(cursor);
      if(cursor!==null&&seenCursors.has(cursorKey))throw Object.assign(new Error(),{safeCode:"repeated_cursor"});
      seenCursors.add(cursorKey);result.scopeStatus="partial";
    }
    if(lease){result.stage="release_partial";await repo.finishPartialRun({scopeKey:lease.scopeKey,runId,owner:lease.owner,token:lease.token,leaseGeneration:lease.leaseGeneration,now:now()});lease=null;}
    const scopeAfter=await repo.getScope(config.scopeKey);
    result.scopeStatus=scopeAfter?.status||"unknown";
    result.scopeFreshnessState=classifyScopeState(scopeAfter,{now:now(),staleAfterMs:Number(env?.REXBID_SYNC_SCOPE_STALE_AFTER_MS||86_400_000)});
    result.nextCursorPresent=!!scopeAfter?.cursor;result.scopeComplete=scopeAfter?.status==="complete";
    result.listingsBefore=beforeCount;result.listingsAfter=Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listings WHERE platform=?").bind(platform).first())?.n||0);
    result.eventsCreated=0;
    result.platformStatus=await readPlatformStatus(db,platform,now());
    result.stage="complete";result.ok=true;
  }catch(error){
    result.error=safeCode(error);result.stopReason=result.error;
    if(lease){try{await repo.failRun({scopeKey:lease.scopeKey,runId,owner:lease.owner,token:lease.token,leaseGeneration:lease.leaseGeneration,errorCode:result.error,now:now()});}catch{}}
    try{const scope=await repo.getScope(config.scopeKey);result.scopeStatus=scope?.status||"unknown";result.nextCursorPresent=!!scope?.cursor;}catch{}
  }finally{
    result.elapsedMs=Math.max(0,now()-started);
    try{result.platformBudget=await getBudget(db,platform);}catch{}
    try{const budgets=await Promise.all(Object.keys(PLATFORMS).map(key=>getBudget(db,key)));result.campaignBudget={limit:TOTAL_CAMPAIGN_LIMIT,consumed:budgets.reduce((n,row)=>n+Number(row?.normal_consumed||0),0),reserved:budgets.reduce((n,row)=>n+Number(row?.normal_reserved||0),0),retryLimit:0};}catch{}
  }
  return result;
}

async function authorized(request,env,executionContext,dispatch,url){
  if(url.protocol!=="https:"||url.hostname!==STAGING_HOST||env?.REXBID_AUTH_TEST_UI!=="enabled"||env?.REXBID_AUTH_TEST_HOST!==STAGING_HOST
    ||env?.REXBID_PHASE_G_MULTIPLATFORM!=="enabled"||env?.REXBID_D1_READ_TARGET!=="rexbid-auth-test-db")return false;
  const origin=request.headers.get("Origin");
  if(request.headers.get("Sec-Fetch-Site")!=="same-origin"||(request.method==="POST"&&origin!==url.origin)||(origin&&origin!==url.origin))return false;
  const cookie=request.headers.get("Cookie");if(!cookie)return false;
  try{
    const response=await dispatch(new Request(`${url.origin}/api/me`,{method:"GET",headers:{Cookie:cookie,Origin:url.origin,"Sec-Fetch-Site":"same-origin"}}),env,executionContext);
    if(response.status!==200)return false;
    const body=await response.json();
    const setCookies=typeof response.headers.getSetCookie==="function"?response.headers.getSetCookie().map(value=>["Set-Cookie",value]):[];
    return body?.user?.id?{ok:true,setCookies}:false;
  }catch{return false;}
}
async function handlePhaseGRequest(request,env,executionContext,dispatch,provider=createApibaraProvider()){
  const url=new URL(request.url);
  if(url.pathname!=="/__staging/d1-sync-multiplatform"&&url.pathname!=="/__staging/d1-sync-multiplatform/status")return null;
  const requestId=crypto.randomUUID(),statusRoute=url.pathname.endsWith("/status");
  const session=await authorized(request,env,executionContext,dispatch,url);
  if(!session)return json({ok:false,error:"not_found_or_unauthorized"},404,requestId);
  if(statusRoute){if(request.method!=="GET")return json({ok:false,error:"method_not_allowed"},405,requestId);}
  else if(request.method!=="POST")return json({ok:false,error:"method_not_allowed"},405,requestId);
  const db=env?.REXBID_DB;if(!db||typeof db.prepare!=="function"||typeof db.batch!=="function")return json({ok:false,error:"database_unavailable"},503,requestId);
  if(statusRoute){
    const now=Date.now(),staleAfterMs=Number(env?.REXBID_SYNC_SCOPE_STALE_AFTER_MS||86_400_000);const platforms={};for(const platform of Object.keys(PLATFORMS))platforms[platform]=await readPlatformStatus(db,platform,now,staleAfterMs);
    return json({ok:true,requestId,platforms,campaign_budget:{limit:TOTAL_CAMPAIGN_LIMIT,consumed:Object.values(platforms).reduce((n,p)=>n+p.budget.consumed,0),reserved:Object.values(platforms).reduce((n,p)=>n+p.budget.reserved,0)}},200,requestId,session.setCookies);
  }
  let body;try{body=await request.json();}catch{return json({ok:false,error:"invalid_request"},400,requestId);}
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(key=>!["platform","max_pages"].includes(key))
    ||!Object.prototype.hasOwnProperty.call(PLATFORMS,String(body.platform))||(body.max_pages!==undefined&&(!Number.isInteger(body.max_pages)||body.max_pages<1||body.max_pages>MAX_PAGES_PER_RUN)))return json({ok:false,error:"invalid_request"},400,requestId,session.setCookies);
  const result=await runPlatformBackfill({db,env,requestId,platform:body.platform,maxPages:body.max_pages??DEFAULT_PAGES_PER_RUN,provider});
  console.info("Rex.Bid staging multi-platform sync",JSON.stringify({request_id:requestId,operation:"discovery",platform:body.platform,stage:result.stage,http_status:result.ok?200:503,live_requests:result.liveRequests,pages:result.pagesProcessed,accepted:result.accepted,scope_status:result.scopeStatus,error_code:result.error||null}));
  return json(result,result.ok?200:503,requestId,session.setCookies);
}

module.exports={STAGING_HOST,PLATFORMS,PAGE_SIZE,MAX_PAGES_PER_RUN,DEFAULT_PAGES_PER_RUN,PER_PLATFORM_LIMIT,TOTAL_CAMPAIGN_LIMIT,BUDGET_PROVIDER,CAMPAIGN,budgetKey,readPlatformStatus,runPlatformBackfill,handlePhaseGRequest};
