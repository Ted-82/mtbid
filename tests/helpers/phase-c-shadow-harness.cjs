"use strict";

const {createApibaraProvider} = require("../../providers/apibara.js");
const contract = require("../../providers/contract.js");
const {createSyncIdentity} = require("../../sync/core.js");
const {D1SyncRepository} = require("../../sync/d1-repository.js");
const {canonicalizeDiscoveryPage} = require("../../sync/discovery-page.js");

// This approved Phase C pass needs one page only; make the route single-request
// by design even though the owner-approved overall ceiling is ten.
const MAX_LIVE_REQUESTS = 1;
const PAGE_SIZE = 20;
const SYNC_TABLES = Object.freeze([
  "vehicle_entities", "vehicle_sources", "auction_listings", "auction_events", "auction_listing_snapshots",
  "provider_sync_scopes", "sync_runs", "sync_page_commits", "sync_batch_guards",
  "provider_request_budgets", "provider_request_reservations"
]);
const LEGACY_TABLES = Object.freeze(["vehicles", "vehicle_snapshots", "auction_history"]);

async function countRows(db, tables) {
  const result = {};
  for (const table of tables) result[table] = Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first())?.n || 0);
  return result;
}

function sameCounts(before, after) {
  return Object.keys(before).every(key => before[key] === after[key]);
}

function identifiersFor(records) {
  return {
    listingIds: [...new Set(records.map(record => record.identity.listingId))],
    sourceKeys: [...new Set(records.map(record => record.identity.sourceKey))],
    entityIds: [...new Set(records.map(record => record.identity.entityId).filter(Boolean))]
  };
}

function placeholders(values) { return values.map(() => "?").join(","); }

async function cleanupRun(db, tracked) {
  const statements = [];
  const listingIds = [...tracked.listingIds];
  const sourceKeys = [...tracked.sourceKeys];
  const entityIds = [...tracked.entityIds];
  const scopeKeys = [...tracked.scopeKeys];
  const runIds = [...tracked.runIds];
  const reservationIds = [...tracked.reservationIds];
  if (listingIds.length) {
    const inList = placeholders(listingIds);
    statements.push(db.prepare(`DELETE FROM auction_events WHERE listing_id IN (${inList})`).bind(...listingIds));
    statements.push(db.prepare(`DELETE FROM auction_listing_snapshots WHERE listing_id IN (${inList})`).bind(...listingIds));
    statements.push(db.prepare(`DELETE FROM auction_listings WHERE listing_id IN (${inList})`).bind(...listingIds));
  }
  if (sourceKeys.length) {
    const inSources = placeholders(sourceKeys);
    statements.push(db.prepare(`DELETE FROM auction_events WHERE source_key IN (${inSources})`).bind(...sourceKeys));
    statements.push(db.prepare(`DELETE FROM vehicle_sources WHERE source_key IN (${inSources})`).bind(...sourceKeys));
  }
  if (entityIds.length) statements.push(db.prepare(`DELETE FROM vehicle_entities WHERE entity_id IN (${placeholders(entityIds)})`).bind(...entityIds));
  if (scopeKeys.length || runIds.length) {
    if (runIds.length) statements.push(db.prepare(`DELETE FROM sync_page_commits WHERE run_id IN (${placeholders(runIds)})`).bind(...runIds));
    if (scopeKeys.length) statements.push(db.prepare(`DELETE FROM sync_page_commits WHERE scope_key IN (${placeholders(scopeKeys)})`).bind(...scopeKeys));
  }
  if (runIds.length) statements.push(db.prepare(`DELETE FROM sync_runs WHERE run_id IN (${placeholders(runIds)})`).bind(...runIds));
  if (scopeKeys.length) statements.push(db.prepare(`DELETE FROM provider_sync_scopes WHERE scope_key IN (${placeholders(scopeKeys)})`).bind(...scopeKeys));
  if (reservationIds.length) statements.push(db.prepare(`DELETE FROM provider_request_reservations WHERE reservation_id IN (${placeholders(reservationIds)})`).bind(...reservationIds));
  for (const row of tracked.createdBudgetRows) statements.push(db.prepare(`DELETE FROM provider_request_budgets WHERE provider=? AND budget_day=?
      AND normal_consumed=? AND retry_consumed=0 AND normal_reserved=0 AND retry_reserved=0
      AND NOT EXISTS(SELECT 1 FROM provider_request_reservations r WHERE r.provider=? AND r.budget_day=?)`)
      .bind(row.provider,row.budgetDay,row.ownNormalRequests,row.provider,row.budgetDay));
  if (statements.length) await db.batch(statements);
}

function syntheticProviderB(runSuffix) {
  const raw = {
    vehicleRef: `phase-c-${runSuffix}`,
    market: "COPART",
    identity: {chassis:`SYNTHETIC${runSuffix.slice(0,8)}`, stock:`PC-${runSuffix.slice(0,8)}`},
    description: {modelYear:2020, manufacturer:"Synthetic", nameplate:"Shadow Test", trimName:"Fixture"},
    sale: {phase:"upcoming", startsAt:"2026-12-01T12:00:00.000Z", timed:false, timedClose:null},
    money: {currencyCode:"USD", leadingOffer:700, instantPurchase:1200, settledAmount:null},
    sellerRecord: {legalName:"Synthetic Seller", category:"dealer"},
    vehicleState: {mainDamage:"Synthetic Damage", additionalDamage:null, operation:"run_drive", keysIncluded:true},
    paperwork: {display:"Synthetic Salvage", registrationPossible:null, exportPossible:true},
    images: {primary:["https://example.invalid/synthetic.jpg"], small:["https://example.invalid/synthetic-sm.jpg"], videoAvailable:false, rotationAvailable:false},
    place: {displayName:"Synthetic, TX"}, distance: {miles:12000}
  };
  const adapter = {
    id:"provider-b",
    vehicleListRecords: response => response.records,
    responseMeta: response => response.pageInfo,
    normalizeVehicle: value => ({platform:value.market.toLowerCase(), fingerprint:`fixture-${value.vehicleRef}`}),
    fingerprintNormalizedVehicle: value => value.fingerprint,
    toCanonicalVehicle: value => contract.createRexVehicle({
      provider:"provider-b", provider_vehicle_id:value.vehicleRef, platform:value.market.toLowerCase(),
      vin:value.identity.chassis, lot:value.identity.stock, year:value.description.modelYear,
      make:value.description.manufacturer, model:value.description.nameplate, trim:value.description.trimName,
      auction:contract.createRexAuction({state:value.sale.phase,source_status:value.sale.phase,auction_at:value.sale.startsAt,timed:value.sale.timed,timed_end_at:value.sale.timedClose,source_listing_id:value.vehicleRef}),
      pricing:contract.createRexPricing({currency:value.money.currencyCode,current_bid:value.money.leadingOffer,buy_now:value.money.instantPurchase,final_price:value.money.settledAmount}),
      seller:contract.createRexSeller({name:value.sellerRecord.legalName,type:value.sellerRecord.category}),
      condition:contract.createRexCondition({primary_damage:value.vehicleState.mainDamage,secondary_damage:value.vehicleState.additionalDamage,run_state:value.vehicleState.operation,keys_present:value.vehicleState.keysIncluded}),
      document:contract.createRexDocument({name:value.paperwork.display,registration:value.paperwork.registrationPossible,export:value.paperwork.exportPossible}),
      media:contract.createRexMedia({items:value.images.primary,thumbs:value.images.small,has_video:value.images.videoAvailable,has_360:value.images.rotationAvailable}),
      location:value.place.displayName,odometer:{value:value.distance.miles,unit:"mi"}
    })
  };
  return {adapter, response:{records:[raw],pageInfo:{next_cursor:null}}, raw};
}

async function stageSyntheticRecord({repo,tracked,record,provider,platform,scopeKey,now}) {
  tracked.scopeKeys.add(scopeKey);
  tracked.listingIds.add(record.identity.listingId);
  tracked.sourceKeys.add(record.identity.sourceKey);
  if (record.identity.entityId) tracked.entityIds.add(record.identity.entityId);
  const run=await acquireRun(repo,tracked,{scopeKey,provider,platform,now,ttlMs:120000});
  const input={scopeKey,provider,platform,runId:run.runId,owner:run.owner,token:run.token,leaseGeneration:run.leaseGeneration,cursor:null,nextCursor:null,records:[record],now};
  const saved=await repo.persistDiscoveryPage(input);
  return {run,input,saved};
}

async function runSyntheticD1Checks({db, repo, tracked, now, suffix}) {
  const fake = syntheticProviderB(suffix);
  const scopeKey = `phase-c-shadow:provider-b:${suffix}`;
  const page = canonicalizeDiscoveryPage({provider:fake.adapter,response:fake.response,scopeKey,platform:"copart",now,freshnessPolicy:{hotIntervalMs:1000,warmIntervalMs:5000,coldIntervalMs:10000,hotWindowMs:1000}});
  if (page.accepted !== 1 || page.rejected !== 0) throw new Error("FAKE_PROVIDER_B_CANONICALIZATION_FAILED");
  const record = page.records[0];
  const staged = await stageSyntheticRecord({repo,tracked,record,provider:"provider-b",platform:"copart",scopeKey,now});
  const persisted = staged.saved;
  const replay = await repo.persistDiscoveryPage(staged.input);
  const before = await repo.getListing(record.identity.listingId);
  const changedVehicle = structuredClone(record.vehicle);
  changedVehicle.auction.state = "phase_c_synthetic_status_changed";
  changedVehicle.auction.source_status = "phase_c_synthetic_status_changed";
  changedVehicle.pricing.current_bid = 701;
  changedVehicle.seller = {name:null,type:null,source:null};
  changedVehicle.document = {name:null,type:null,registration:null,export:null,pending:null};
  changedVehicle.odometer = null;
  const updateScope = `${scopeKey}:partial-update`;
  tracked.scopeKeys.add(updateScope);
  const updateLease = await acquireRun(repo, tracked, {scopeKey:updateScope,provider:"provider-b",platform:"copart",now:now+1000,ttlMs:120000});
  const updatedRecord = {...record,vehicle:changedVehicle};
  const updatedInput = {scopeKey:updateScope,provider:"provider-b",platform:"copart",runId:updateLease.runId,owner:updateLease.owner,token:updateLease.token,leaseGeneration:updateLease.leaseGeneration,cursor:null,nextCursor:null,records:[updatedRecord],now:now+1000};
  const updated = await repo.persistDiscoveryPage(updatedInput);
  const after = await repo.getListing(record.identity.listingId);

  // Failure after lease acquisition, followed by lease recovery by a new generation.
  const failureScope = `${scopeKey}:failure`; tracked.scopeKeys.add(failureScope);
  const failedLease = await acquireRun(repo, tracked, {scopeKey:failureScope,provider:"provider-b",platform:"copart",now:now+2000,ttlMs:120000});
  await repo.failRun({...failedLease,errorCode:"PHASE_C_INJECTED_AFTER_ACQUIRE",now:now+2001});
  const failedState = await repo.getScope(failureScope);
  const recovery = await repo.acquireLease({scopeKey:failureScope,provider:"provider-b",platform:"copart",operation:"discovery",owner:`owner-recovery-${suffix}`,token:`token-recovery-${suffix}`,now:now+2002,ttlMs:120000});
  if (!recovery.acquired || recovery.leaseGeneration <= failedLease.leaseGeneration) throw new Error("LEASE_RECOVERY_FAILED");
  const recoveryRunId = `phase-c-recovery-${suffix}`; tracked.runIds.add(recoveryRunId);
  await repo.createRun({runId:recoveryRunId,scopeKey:failureScope,provider:"provider-b",platform:"copart",now:now+2002});
  await repo.failRun({scopeKey:failureScope,runId:recoveryRunId,owner:`owner-recovery-${suffix}`,token:`token-recovery-${suffix}`,leaseGeneration:recovery.leaseGeneration,errorCode:"PHASE_C_TEST_COMPLETE",now:now+2003});

  // Reservation failure path: reservation is cancelled before any request can start.
  const budgetProvider = `phase-c-${suffix}`;
  const budgetDay = new Date(now).toISOString().slice(0,10);
  const existed = await db.prepare("SELECT 1 FROM provider_request_budgets WHERE provider=? AND budget_day=?").bind(budgetProvider,budgetDay).first();
  await repo.initializeBudget({provider:budgetProvider,budgetDay,normalLimit:1,retryLimit:1,now});
  if (!existed) { tracked.createdBudgetRows.push({provider:budgetProvider,budgetDay,ownNormalRequests:0}); }
  const reservationId = `phase-c-reservation-${suffix}`; tracked.reservationIds.add(reservationId);
  const reserved = await repo.reserveBudget({reservationId,provider:budgetProvider,budgetDay,bucket:"retry",count:1,now});
  const cancelled = reserved.allowed && await repo.cancelBudgetReservation({reservationId,now:now+1});
  const budget = await db.prepare("SELECT retry_reserved,retry_consumed FROM provider_request_budgets WHERE provider=? AND budget_day=?").bind(budgetProvider,budgetDay).first();

  // Failure before persist must keep checkpoint untouched; a new run can replay safely.
  const prePersistScope = `${scopeKey}:pre-persist`; tracked.scopeKeys.add(prePersistScope);
  const preFake=syntheticProviderB(`${suffix}-failure`);
  const prePage=canonicalizeDiscoveryPage({provider:preFake.adapter,response:preFake.response,scopeKey:prePersistScope,platform:"copart",now:now+3000,freshnessPolicy:{hotIntervalMs:1000,warmIntervalMs:5000,coldIntervalMs:10000,hotWindowMs:1000}});
  const preRecord=prePage.records[0];
  tracked.listingIds.add(preRecord.identity.listingId);tracked.sourceKeys.add(preRecord.identity.sourceKey);
  const prePersistLease = await acquireRun(repo, tracked, {scopeKey:prePersistScope,provider:"provider-b",platform:"copart",now:now+3000,ttlMs:120000});
  await repo.failRun({...prePersistLease,errorCode:"PHASE_C_INJECTED_BEFORE_PERSIST",now:now+3001});
  const prePersistState = await repo.getScope(prePersistScope);
  const noAdvancedCheckpoint = prePersistState.cursor === null && prePersistState.last_complete_at === null;
  const acquiredFailureNoFreshness = failedState.last_complete_at === null && failedState.lease_owner === null;
  const replayLease=await repo.acquireLease({scopeKey:prePersistScope,provider:"provider-b",platform:"copart",operation:"discovery",owner:`owner-replay-${suffix}`,token:`token-replay-${suffix}`,now:now+3002,ttlMs:120000});
  if (!replayLease.acquired) throw new Error("PRE_PERSIST_RECOVERY_FAILED");
  const replayRunId=`phase-c-replay-${suffix}`;tracked.runIds.add(replayRunId);
  await repo.createRun({runId:replayRunId,scopeKey:prePersistScope,provider:"provider-b",platform:"copart",now:now+3002});
  const replayInput={scopeKey:prePersistScope,provider:"provider-b",platform:"copart",runId:replayRunId,owner:`owner-replay-${suffix}`,token:`token-replay-${suffix}`,leaseGeneration:replayLease.leaseGeneration,cursor:null,nextCursor:null,records:[preRecord],now:now+3002};
  const recoverySave=await repo.persistDiscoveryPage(replayInput);
  const recoveryReplay=await repo.persistDiscoveryPage(replayInput);
  const replayCount=Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listings WHERE listing_id=?").bind(preRecord.identity.listingId).first())?.n||0);
  return {
    fakeProviderB: page.accepted===1 && persisted.complete===true && replay.replayed===true,
    partialUpdate: updated.complete===true && after.current_bid_usd===701 && after.auction_state==="phase_c_synthetic_status_changed"
      && after.seller_name===before.seller_name && after.document_name===before.document_name && after.odometer_value===before.odometer_value,
    failureRecovery: acquiredFailureNoFreshness && noAdvancedCheckpoint && recovery.acquired,
    replayAfterFailure: recoverySave.complete && recoveryReplay.replayed && replayCount===1,
    budgetFailure: !!cancelled && Number(budget?.retry_reserved)===0 && Number(budget?.retry_consumed)===0,
    syntheticListingCount: Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listings WHERE listing_id=?").bind(record.identity.listingId).first())?.n||0)
  };
}

async function acquireRun(repo, tracked, {scopeKey,provider,platform,now,ttlMs}) {
  const owner = `phase-c-owner-${crypto.randomUUID()}`;
  const token = crypto.randomUUID();
  const lease = await repo.acquireLease({scopeKey,provider,platform,operation:"discovery",owner,token,now,ttlMs});
  if (!lease.acquired) throw new Error("LEASE_ACQUIRE_FAILED");
  const runId = `phase-c-run-${crypto.randomUUID()}`;
  tracked.runIds.add(runId);
  await repo.createRun({runId,scopeKey,provider,platform,operation:"discovery",triggerKind:"operator",now});
  return {...lease,scopeKey,provider,platform,owner,token,runId};
}

async function runPhaseCShadow({db, env, requestId = crypto.randomUUID(), now = () => Date.now(), provider = createApibaraProvider()}) {
  const repo = new D1SyncRepository(db);
  const timestamp = now();
  const timestampIso = new Date(timestamp).toISOString();
  const baseline = {
    sync: await countRows(db,SYNC_TABLES),
    users: Number((await db.prepare("SELECT COUNT(*) AS n FROM users").first())?.n||0),
    favorites: Number((await db.prepare("SELECT COUNT(*) AS n FROM user_favorites").first())?.n||0),
    legacy: await countRows(db,LEGACY_TABLES)
  };
  const tracked = {listingIds:new Set(),sourceKeys:new Set(),entityIds:new Set(),scopeKeys:new Set(),runIds:new Set(),reservationIds:new Set(),createdBudgetRows:[]};
  let stage = "preflight";
  let liveRequests = 0;
  let providerMetrics = {providerRecords:0,accepted:0,rejected:0,ambiguous:0};
  let persistMetrics = {inserts:0,updates:0,duplicates:0,replayStable:false};
  let readbackPass = false;
  let syntheticChecks = {fakeProviderB:false,partialUpdate:false,failureRecovery:false,budgetFailure:false};
  let cleanupPass = false;
  let endState = null;
  let result = null;
  try {
    if (!env?.APIBARA_API_KEY) throw Object.assign(new Error("MISSING_PROVIDER_CONFIGURATION"),{safeCode:"provider_configuration_missing"});
    const scopeKey = `phase-c-shadow:${requestId}`; tracked.scopeKeys.add(scopeKey);
    const run = await acquireRun(repo,tracked,{scopeKey,provider:provider.id,platform:"copart",now:timestamp,ttlMs:120000});
    stage = "budget_reserve";
    const budgetDay = timestampIso.slice(0,10);
    const existed = await db.prepare("SELECT 1 FROM provider_request_budgets WHERE provider=? AND budget_day=?").bind(provider.id,budgetDay).first();
    await repo.initializeBudget({provider:provider.id,budgetDay,normalLimit:MAX_LIVE_REQUESTS,retryLimit:0,now:timestamp});
    if (!existed) tracked.createdBudgetRows.push({provider:provider.id,budgetDay,ownNormalRequests:1});
    const reservationId = `phase-c-reservation:${requestId}`; tracked.reservationIds.add(reservationId);
    const reservation = await repo.reserveBudget({reservationId,provider:provider.id,budgetDay,bucket:"normal",count:1,now:timestamp});
    if (!reservation.allowed) throw Object.assign(new Error("REQUEST_BUDGET_EXHAUSTED"),{safeCode:"request_budget_exhausted"});
    if (!await repo.startBudgetReservation({reservationId,now:timestamp})) throw Object.assign(new Error("REQUEST_RESERVATION_START_FAILED"),{safeCode:"request_budget_start_failed"});
    stage = "provider_fetch";
    if (liveRequests >= MAX_LIVE_REQUESTS) throw Object.assign(new Error("LIVE_REQUEST_HARD_CAP"),{safeCode:"live_request_hard_cap"});
    liveRequests += 1;
    // Exactly one live Apibara request. No retry, filters, detail or history calls.
    const providerResponse = await provider.listVehicles(env,{platform:"copart",per_page:PAGE_SIZE});
    await repo.finishBudgetReservation({reservationId,now:now()});
    stage = "canonicalization";
    const page = canonicalizeDiscoveryPage({provider,response:providerResponse,scopeKey,platform:"copart",cursor:null,now:timestamp,freshnessPolicy:{hotIntervalMs:60000,warmIntervalMs:3600000,coldIntervalMs:86400000,hotWindowMs:3600000}});
    providerMetrics = {providerRecords:page.providerRecords,accepted:page.accepted,rejected:page.rejected,ambiguous:page.ambiguous};
    if (!page.accepted) throw Object.assign(new Error("NO_ACCEPTED_CANONICAL_RECORDS"),{safeCode:"no_accepted_records"});
    // Do not mutate or later clean up identities already present before this
    // run. Both source and listing must be new; shared VINs are not ownership.
    const writeRecords=[];
    for (const record of page.records) {
      const [priorListing, priorSource] = await Promise.all([
        repo.getListing(record.identity.listingId),
        repo.getSource({provider:record.identity.provider,platform:record.identity.platform,providerVehicleId:record.vehicle.provider_vehicle_id})
      ]);
      if (priorListing || priorSource) { persistMetrics.duplicates += 1; continue; }
      writeRecords.push(record);
    }
    if (!writeRecords.length) throw Object.assign(new Error("ALL_LISTINGS_PREEXIST"),{safeCode:"all_listings_preexisting"});
    const ids = identifiersFor(writeRecords);
    for (const id of ids.listingIds) tracked.listingIds.add(id);
    for (const id of ids.sourceKeys) tracked.sourceKeys.add(id);
    for (const id of ids.entityIds) tracked.entityIds.add(id);
    const listingCountBefore=Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listings").first())?.n||0);
    stage = "persist";
    const pageInput={scopeKey,provider:provider.id,platform:"copart",runId:run.runId,owner:run.owner,token:run.token,leaseGeneration:run.leaseGeneration,cursor:null,nextCursor:page.nextCursor,records:writeRecords,now:now()};
    const persisted=await repo.persistDiscoveryPage(pageInput);
    persistMetrics.inserts=writeRecords.length;
    stage = "replay";
    const replay=await repo.persistDiscoveryPage(pageInput);
    if (!replay.replayed) throw Object.assign(new Error("REPLAY_NOT_IDEMPOTENT"),{safeCode:"replay_mismatch"});
    persistMetrics.duplicates += replay.pageCount;
    const listingCountAfterReplay=Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listings").first())?.n||0);
    persistMetrics.replayStable=listingCountAfterReplay===listingCountBefore+writeRecords.length;
    if (!persisted.complete) {
      await repo.finishPartialRun({scopeKey,runId:run.runId,owner:run.owner,token:run.token,leaseGeneration:run.leaseGeneration,now:now()});
    }
    stage = "readback";
    const columns=(await db.prepare("PRAGMA table_info(auction_listings)").all()).results.map(row=>row.name);
    const hasNoRawOrMediaUrls=!columns.some(name=>/raw|media_items|media_thumbs|photo_url|image_url/i.test(name));
    const readbacks=[];
    for (const record of writeRecords) {
      const stored=await repo.getListing(record.identity.listingId);
      const source=await repo.getSource({provider:record.identity.provider,platform:record.identity.platform,providerVehicleId:record.vehicle.provider_vehicle_id});
      readbacks.push(!!stored && stored.source_key===record.identity.sourceKey && stored.platform===record.vehicle.platform
        && stored.vin_normalized===(record.vehicle.vin||null) && stored.lot===(record.vehicle.lot||null)
        && stored.auction_state===(record.vehicle.auction?.state||null)
        && stored.current_bid_usd===(Number.isFinite(record.vehicle.pricing?.current_bid)?record.vehicle.pricing.current_bid:null)
        && stored.buy_now_usd===(Number.isFinite(record.vehicle.pricing?.buy_now)?record.vehicle.pricing.buy_now:null)
        && stored.summary_synced_at===new Date(pageInput.now).toISOString()
        && ["hot","warm","cold","unknown"].includes(stored.freshness_class)
        && !!source && source.provider===record.identity.provider && source.platform===record.identity.platform
        && source.source_key===record.identity.sourceKey);
    }
    const scopeReadback=await repo.getScope(scopeKey);
    const cursorReadback=(scopeReadback?.cursor??null)===(page.nextCursor??null)
      && scopeReadback?.status===(persisted.complete?"complete":"partial");
    readbackPass=hasNoRawOrMediaUrls&&readbacks.every(Boolean)&&cursorReadback&&persistMetrics.replayStable;
    if (!readbackPass) throw Object.assign(new Error("D1_READBACK_MISMATCH"),{safeCode:"readback_mismatch"});
    stage = "synthetic_provider_b";
    syntheticChecks=await runSyntheticD1Checks({db,repo,tracked,now:timestamp+5000,suffix:requestId.replace(/-/g,"").slice(0,12)});
    if (Object.values(syntheticChecks).some(value=>value!==true && typeof value!="number")) throw Object.assign(new Error("SYNTHETIC_CHECK_FAILED"),{safeCode:"synthetic_check_failed"});
    persistMetrics.updates=syntheticChecks.partialUpdate?1:0;
    stage = "complete";
    result={ok:true,stage,requestId,startedAt:timestampIso,liveRequests,maxLiveRequests:MAX_LIVE_REQUESTS,pageSize:PAGE_SIZE,providerMetrics,persistMetrics,cursorReturned:page.nextCursor!==null,scopeComplete:persisted.complete,readbackPass,storedRecords:writeRecords.length,syntheticChecks,baseline};
  } catch (error) {
    const safeCode=/^[a-z0-9_]{1,64}$/.test(String(error?.safeCode||""))?error.safeCode:"phase_c_failed";
    result={ok:false,stage,requestId,liveRequests,maxLiveRequests:MAX_LIVE_REQUESTS,error:safeCode,providerMetrics,persistMetrics,readbackPass,syntheticChecks,baseline};
  } finally {
    try {
      for (const row of tracked.createdBudgetRows) {
        const count=await db.prepare("SELECT normal_consumed,retry_consumed,normal_reserved,retry_reserved FROM provider_request_budgets WHERE provider=? AND budget_day=?").bind(row.provider,row.budgetDay).first();
        row.ownNormalRequests=count ? Number(count.normal_consumed) : 0;
      }
      await cleanupRun(db,tracked);
      const after={
        sync:await countRows(db,SYNC_TABLES),
        users:Number((await db.prepare("SELECT COUNT(*) AS n FROM users").first())?.n||0),
        favorites:Number((await db.prepare("SELECT COUNT(*) AS n FROM user_favorites").first())?.n||0),
        legacy:await countRows(db,LEGACY_TABLES)
      };
      cleanupPass=sameCounts(baseline.sync,after.sync)&&baseline.users===after.users&&baseline.favorites===after.favorites&&sameCounts(baseline.legacy,after.legacy);
      endState={sync:after.sync,users:after.users,favorites:after.favorites,legacy:after.legacy,cleanupPass};
    } catch {
      cleanupPass=false;
      endState={cleanupPass:false};
    }
    result.cleanupPass=cleanupPass;
    result.endState=endState;
    result.elapsedMs=Math.max(0,now()-timestamp);
  }
  return result;
}

function cleanupReport(result) {
  const endState=result?.endState;
  return endState ? {verified:endState.cleanupPass===true,...endState} : {verified:false};
}

module.exports={MAX_LIVE_REQUESTS,PAGE_SIZE,SYNC_TABLES,LEGACY_TABLES,canonicalizeDiscoveryPage,runPhaseCShadow,cleanupReport};
