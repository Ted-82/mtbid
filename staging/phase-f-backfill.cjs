"use strict";

const {createApibaraProvider} = require("../providers/apibara.js");
const {D1SyncRepository} = require("../sync/d1-repository.js");
const {D1ReadRepository} = require("../sync/d1-read-repository.js");
const {canonicalizeDiscoveryPage} = require("../sync/discovery-page.js");
const {freshnessPolicyFromEnv,classifyScopeState}=require("../sync/backfill-policy.js");

const PHASE_D_SCOPE = "rexbid-phase-d:persistent-discovery:copart";
const PAGE_SIZE = 20;
const MAX_PHASE_F_REQUESTS = 5;
const MAX_PAGES_PER_RUN = 3;
const DEFAULT_PAGES_PER_RUN = 2;
const BUDGET_PROVIDER = "apibara-phase-f";
const BUDGET_CAMPAIGN = "campaign-phase-f-controlled-backfill";
const STAGING_HOST = "rexbid-auth-test.tedn828.workers.dev";

function safeJson(data, status = 200, id = null, extraHeaders = []) {
  const headers = new Headers({"Content-Type":"application/json; charset=UTF-8","Cache-Control":"private, no-store",
    "Pragma":"no-cache","X-Robots-Tag":"noindex, nofollow, noarchive","Referrer-Policy":"no-referrer"});
  if (id) headers.set("X-RexBid-Request-ID", id);
  for (const [key,value] of extraHeaders) headers.append(key,value);
  return new Response(JSON.stringify(data), {status, headers});
}

async function budgetState(db) {
  return db.prepare(`SELECT normal_limit,normal_consumed,normal_reserved,retry_limit,retry_consumed,retry_reserved
    FROM provider_request_budgets WHERE provider=? AND budget_day=?`).bind(BUDGET_PROVIDER,BUDGET_CAMPAIGN).first();
}

async function runControlledBackfill({db,env,requestId,maxPages=DEFAULT_PAGES_PER_RUN,now=()=>Date.now(),provider=createApibaraProvider()}) {
  const started=now();
  const result={ok:false,stage:"preflight",requestId,platform:"copart",pageSize:PAGE_SIZE,pagesRequested:maxPages,
    pagesProcessed:0,liveRequests:0,maxLiveRequests:MAX_PHASE_F_REQUESTS,providerRecords:0,accepted:0,rejected:0,
    ambiguous:0,inserts:0,updates:0,duplicates:0,snapshotsCreated:0,replayVerified:true,readback:true,
    rawOrMediaStored:false,stopReason:null,elapsedMs:0};
  const repo=new D1SyncRepository(db);
  let lease=null;
  let activeRunId=null;
  try {
    if(!Number.isInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES_PER_RUN) throw Object.assign(new Error(),{safeCode:"invalid_page_limit"});
    if(provider?.id!=="apibara"||!provider?.capabilities?.includes("vehicle.list")) throw Object.assign(new Error(),{safeCode:"provider_not_allowed"});
    if(!env?.APIBARA_API_KEY) throw Object.assign(new Error(),{safeCode:"provider_configuration_missing"});
    const scope=await repo.getScope(PHASE_D_SCOPE);
    if(!scope||scope.provider!=="apibara"||scope.platform!=="copart"||scope.operation!=="discovery") throw Object.assign(new Error(),{safeCode:"resume_scope_unavailable"});
    if(scope.status==="complete"||scope.cursor===null||scope.cursor===undefined||scope.cursor==="") throw Object.assign(new Error(),{safeCode:scope.status==="complete"?"scope_complete":"resume_cursor_missing"});
    const beforeCount=Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listings").first())?.n||0);
    const owner=`phase-f-${requestId}`;
    const token=crypto.randomUUID();
    const start=now();
    result.stage="lease";
    lease=await repo.acquireLease({scopeKey:PHASE_D_SCOPE,provider:"apibara",platform:"copart",operation:"discovery",owner,token,now:start,ttlMs:20*60_000});
    if(!lease.acquired) throw Object.assign(new Error(),{safeCode:"lease_busy"});
    const runId=`phase-f-run-${requestId}`;
    activeRunId=runId;
    await repo.createRun({runId,scopeKey:PHASE_D_SCOPE,provider:"apibara",platform:"copart",operation:"discovery",triggerKind:"operator",now:start});
    lease={...lease,scopeKey:PHASE_D_SCOPE,provider:"apibara",platform:"copart",owner,token,runId};
    result.runId=runId;

    result.stage="budget";
    await repo.initializeBudget({provider:BUDGET_PROVIDER,budgetDay:BUDGET_CAMPAIGN,normalLimit:MAX_PHASE_F_REQUESTS,retryLimit:0,now:start});
    await db.prepare(`UPDATE provider_request_budgets SET normal_limit=MIN(normal_limit,?),retry_limit=0,updated_at=?
      WHERE provider=? AND budget_day=?`).bind(MAX_PHASE_F_REQUESTS,new Date(start).toISOString(),BUDGET_PROVIDER,BUDGET_CAMPAIGN).run();
    let cursor=scope.cursor;
    const seenCursors=new Set([String(cursor)]);

    for(let pageNumber=0;pageNumber<maxPages;pageNumber+=1){
      const budget=await budgetState(db);
      if(!budget||Number(budget.normal_consumed)+Number(budget.normal_reserved)>=MAX_PHASE_F_REQUESTS){
        result.stopReason="request_budget_exhausted";break;
      }
      result.stage="budget_reserve";
      const reservationId=`phase-f-reservation-${requestId}-${pageNumber+1}`;
      const reserve=await repo.reserveBudget({reservationId,provider:BUDGET_PROVIDER,budgetDay:BUDGET_CAMPAIGN,bucket:"normal",count:1,now:now()});
      if(!reserve.allowed||!await repo.startBudgetReservation({reservationId,now:now()})) { result.stopReason="request_budget_exhausted";break; }
      result.stage="provider_discovery";
      const fetchStarted=now();
      result.liveRequests+=1;
      await db.prepare("UPDATE sync_runs SET upstream_requests=upstream_requests+1 WHERE run_id=? AND status='running'").bind(runId).run();
      let providerResponse;
      try {
        providerResponse=await provider.listVehicles(env,{platform:"copart",per_page:PAGE_SIZE,cursor});
      } catch(error) {
        await repo.finishBudgetReservation({reservationId,now:now()});
        throw Object.assign(new Error(),{safeCode:error?.code==="RATE_LIMITED"?"provider_rate_limited":error?.code==="TIMEOUT"?"provider_timeout":error?.status>=500?"provider_5xx":"provider_unavailable"});
      }
      const fetchedAt=now();
      await repo.finishBudgetReservation({reservationId,now:fetchedAt});
      result.providerLatencyMs=(result.providerLatencyMs||0)+Math.max(0,fetchedAt-fetchStarted);
      result.stage="canonicalize";
      const page=canonicalizeDiscoveryPage({provider,response:providerResponse,scopeKey:PHASE_D_SCOPE,platform:"copart",cursor,now:fetchedAt,freshnessPolicy:freshnessPolicyFromEnv(env)});
      result.providerRecords+=page.providerRecords;result.accepted+=page.accepted;result.rejected+=page.rejected;result.ambiguous+=page.ambiguous;
      if(!page.accepted) throw Object.assign(new Error(),{safeCode:"no_valid_canonical_records"});
      const unique=[];const pageIds=new Set();
      for(const record of page.records){if(pageIds.has(record.identity.listingId)){result.duplicates+=1;continue;}pageIds.add(record.identity.listingId);unique.push(record);}
      const existed=[];
      for(const record of unique){
        const [listing,source]=await Promise.all([repo.getListing(record.identity.listingId),repo.getSource({provider:"apibara",platform:"copart",providerVehicleId:record.vehicle.provider_vehicle_id})]);
        existed.push(Boolean(listing||source));
      }
      const pageInput={scopeKey:PHASE_D_SCOPE,provider:"apibara",platform:"copart",runId,owner,token,leaseGeneration:lease.leaseGeneration,
        cursor,nextCursor:page.nextCursor,records:unique,now:fetchedAt,recordsReceived:page.providerRecords,
        recordsInserted:existed.filter(x=>!x).length,recordsUpdated:existed.filter(Boolean).length,
        recordsSkipped:page.rejected+page.ambiguous,latencyMs:Math.max(0,fetchedAt-fetchStarted)};
      result.stage="persist";
      const beforeSnapshots=Number((await db.prepare("SELECT COUNT(*) n FROM auction_listing_snapshots").first())?.n||0);
      let persisted;
      try{persisted=await repo.persistDiscoveryPage(pageInput);}catch(error){
        if(String(error?.message||"")==="REPEATED_CURSOR") throw Object.assign(new Error(),{safeCode:"repeated_cursor"});
        throw error;
      }
      result.pagesProcessed+=1;result.inserts+=pageInput.recordsInserted;result.updates+=pageInput.recordsUpdated;
      const replay=await repo.persistDiscoveryPage(pageInput);
      if(!replay.replayed) throw Object.assign(new Error(),{safeCode:"replay_not_idempotent"});
      result.snapshotsCreated+=Math.max(0,Number((await db.prepare("SELECT COUNT(*) n FROM auction_listing_snapshots").first())?.n||0)-beforeSnapshots);
      result.replayVerified=result.replayVerified&&replay.replayed;
      const readRepo=new D1ReadRepository(db);
      for(const record of unique){const stored=await readRepo.getListingById(record.identity.listingId);if(!stored||stored.listing_id!==record.identity.listingId||stored.vehicle.provider!=="apibara"||stored.vehicle.platform!=="copart")result.readback=false;}
      if(!result.readback) throw Object.assign(new Error(),{safeCode:"d1_readback_mismatch"});
      cursor=page.nextCursor??null;
      result.nextCursorPresent=cursor!==null&&cursor!==undefined;
      result.scopeComplete=Boolean(persisted.complete);
      if(persisted.complete){lease=null;result.stopReason="scope_complete";break;}
      if(cursor===null){lease=null;result.stopReason="scope_complete";break;}
      if(seenCursors.has(String(cursor))) throw Object.assign(new Error(),{safeCode:"repeated_cursor"});
      seenCursors.add(String(cursor));
      result.scopeStatus="partial";
    }
    if(lease){result.stage="release_partial";await repo.finishPartialRun({scopeKey:lease.scopeKey,runId:lease.runId,owner:lease.owner,token:lease.token,leaseGeneration:lease.leaseGeneration,now:now()});lease=null;}
    const scopeAfter=await repo.getScope(PHASE_D_SCOPE);
    result.scopeStatus=scopeAfter?.status||"unknown";result.scopeFreshnessState=classifyScopeState(scopeAfter,{now:now(),staleAfterMs:Number(env?.REXBID_SYNC_SCOPE_STALE_AFTER_MS||86_400_000)});
    result.nextCursorPresent=!!scopeAfter?.cursor;result.scopeComplete=scopeAfter?.status==="complete";
    result.listingsBefore=beforeCount;result.listingsAfter=Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listings").first())?.n||0);
    result.stage="complete";result.ok=true;
  }catch(error){
    result.error=/^[a-z0-9_]{1,64}$/.test(String(error?.safeCode||""))?error.safeCode:"phase_f_failed";
    result.stopReason=result.error;
    if(lease){try{await repo.failRun({scopeKey:lease.scopeKey,runId:activeRunId,owner:lease.owner,token:lease.token,leaseGeneration:lease.leaseGeneration,errorCode:result.error,now:now()});}catch{/* expiry enables later manual recovery */}}
    try{const scope=await repo.getScope(PHASE_D_SCOPE);result.scopeStatus=scope?.status||"unknown";result.nextCursorPresent=!!scope?.cursor;}catch{}
  }finally{
    result.elapsedMs=Math.max(0,now()-started);
    try{const budget=await budgetState(db);if(budget)result.campaignBudget={limit:Number(budget.normal_limit),consumed:Number(budget.normal_consumed),reserved:Number(budget.normal_reserved),retryLimit:Number(budget.retry_limit),retryConsumed:Number(budget.retry_consumed),retryReserved:Number(budget.retry_reserved)};}catch{}
  }
  return result;
}

async function handlePhaseFRequest(request,env,executionContext,dispatch,provider=createApibaraProvider()){
  const url=new URL(request.url);const path="/__staging/d1-sync-phase-f-backfill";
  if(url.pathname!==path)return null;
  const id=crypto.randomUUID();
  const hostAllowed=url.protocol==="https:"&&url.hostname===STAGING_HOST&&env?.REXBID_AUTH_TEST_UI==="enabled"
    &&env?.REXBID_AUTH_TEST_HOST===STAGING_HOST&&env?.REXBID_PHASE_F_BACKFILL==="enabled"
    &&env?.REXBID_D1_READ_TARGET==="rexbid-auth-test-db";
  if(!hostAllowed)return safeJson({ok:false,error:"not_found"},404,id);
  if(request.method!=="POST")return safeJson({ok:false,error:"method_not_allowed"},405,id);
  if(request.headers.get("Origin")!==url.origin||request.headers.get("Sec-Fetch-Site")!=="same-origin")return safeJson({ok:false,error:"request_rejected"},403,id);
  const cookie=request.headers.get("Cookie");if(!cookie)return safeJson({ok:false,error:"authentication_required"},401,id);
  let authResponse;
  try{authResponse=await dispatch(new Request(`${url.origin}/api/me`,{method:"GET",headers:{Cookie:cookie,Origin:url.origin,"Sec-Fetch-Site":"same-origin"}}),env,executionContext);}catch{return safeJson({ok:false,error:"authentication_unavailable"},503,id);}
  let authBody=null;try{authBody=await authResponse.json();}catch{}
  if(authResponse.status!==200||!authBody?.user?.id)return safeJson({ok:false,error:"authentication_required"},401,id);
  const setCookies=typeof authResponse.headers.getSetCookie==="function"?authResponse.headers.getSetCookie().map(value=>["Set-Cookie",value]):[];
  let body;try{body=await request.json();}catch{return safeJson({ok:false,error:"invalid_request"},400,id);}
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(key=>key!=="max_pages")
    ||(body.max_pages!==undefined&&(!Number.isInteger(body.max_pages)||body.max_pages<1||body.max_pages>MAX_PAGES_PER_RUN)))return safeJson({ok:false,error:"invalid_request"},400,id,setCookies);
  const db=env?.REXBID_DB;if(!db||typeof db.prepare!=="function"||typeof db.batch!=="function")return safeJson({ok:false,error:"database_unavailable"},503,id);
  console.info("Rex.Bid staging backfill",JSON.stringify({request_id:id,operation:"controlled_backfill",stage:"started",requested_pages:body.max_pages||DEFAULT_PAGES_PER_RUN}));
  const result=await runControlledBackfill({db,env,requestId:id,maxPages:body.max_pages||DEFAULT_PAGES_PER_RUN,provider});
  console.info("Rex.Bid staging backfill",JSON.stringify({request_id:id,operation:"controlled_backfill",stage:result.stage,http_status:result.ok?200:503,
    live_requests:result.liveRequests,pages:result.pagesProcessed,accepted:result.accepted,scope_status:result.scopeStatus,error_code:result.error||null}));
  return safeJson(result,result.ok?200:503,id,setCookies);
}

module.exports={PHASE_D_SCOPE,PAGE_SIZE,MAX_PHASE_F_REQUESTS,MAX_PAGES_PER_RUN,DEFAULT_PAGES_PER_RUN,BUDGET_PROVIDER,BUDGET_CAMPAIGN,runControlledBackfill,handlePhaseFRequest};
