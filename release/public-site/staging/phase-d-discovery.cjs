"use strict";

const {createApibaraProvider} = require("../providers/apibara.js");
const {D1SyncRepository} = require("../sync/d1-repository.js");
const {canonicalizeDiscoveryPage} = require("../sync/discovery-page.js");

const PAGE_SIZE = 20;
const MAX_CAMPAIGN_REQUESTS = 5;
const SCOPE_KEY = "rexbid-phase-d:persistent-discovery:copart";
const BUDGET_PROVIDER = "apibara-phase-d";
const BUDGET_CAMPAIGN = "campaign-be03a54";
const SYNC_TABLES = Object.freeze([
  "vehicle_entities", "vehicle_sources", "auction_listings", "auction_events", "auction_listing_snapshots",
  "provider_sync_scopes", "sync_runs", "sync_page_commits", "sync_batch_guards",
  "provider_request_budgets", "provider_request_reservations"
]);
const LEGACY_TABLES = Object.freeze(["vehicles", "vehicle_snapshots", "auction_history"]);

async function countRows(db, tables) {
  const output = {};
  for (const table of tables) {
    const result = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
    output[table] = Number(result?.n || 0);
  }
  return output;
}

function sum(values) { return Object.values(values).reduce((total, value) => total + Number(value || 0), 0); }

async function readCounts(db) {
  return {
    sync: await countRows(db, SYNC_TABLES),
    users: Number((await db.prepare("SELECT COUNT(*) AS n FROM users").first())?.n || 0),
    favorites: Number((await db.prepare("SELECT COUNT(*) AS n FROM user_favorites").first())?.n || 0),
    legacy: await countRows(db, LEGACY_TABLES)
  };
}

function dedupePage(records) {
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const record of records) {
    const key = record.identity.listingId;
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    unique.push(record);
  }
  return {records: unique, duplicates};
}

async function runPersistentDiscovery({db, env, requestId, now = () => Date.now(), provider = createApibaraProvider()}) {
  const started = now();
  const startedAt = new Date(started).toISOString();
  const result = {
    ok: false, stage: "preflight", requestId, liveRequests: 0, maxLiveRequests: MAX_CAMPAIGN_REQUESTS,
    pageSize: PAGE_SIZE, providerRecords: 0, accepted: 0, rejected: 0, ambiguous: 0,
    inserts: 0, updates: 0, duplicates: 0, nextCursorPresent: false, snapshotsCreated: 0,
    eventsCreated: 0, replayVerified: false, rawOrMediaStored: false, cleanup: "not_performed_by_design", elapsedMs: 0
  };
  const repo = new D1SyncRepository(db);
  let lease = null;
  let reservationId = null;
  try {
    if (provider?.id !== "apibara" || !provider?.capabilities?.includes("vehicle.list")) {
      throw Object.assign(new Error(), {safeCode: "phase_d_provider_not_allowed"});
    }
    if (!env?.APIBARA_API_KEY) throw Object.assign(new Error(), {safeCode: "provider_configuration_missing"});
    const campaignAlreadyUsed = await db.prepare(`SELECT normal_consumed+normal_reserved AS used
      FROM provider_request_budgets WHERE provider=? AND budget_day=?`).bind(BUDGET_PROVIDER, BUDGET_CAMPAIGN).first();
    if (Number(campaignAlreadyUsed?.used || 0) > 0) {
      throw Object.assign(new Error(), {safeCode: "phase_d_single_page_already_attempted"});
    }
    const priorScope = await repo.getScope(SCOPE_KEY);
    if (priorScope?.status === "complete" || priorScope?.status === "partial" || priorScope?.cursor) {
      throw Object.assign(new Error(), {safeCode: "discovery_scope_already_advanced"});
    }
    const cursor = null;
    const before = await readCounts(db);
    result.before = before;

    result.stage = "lease";
    const owner = `phase-d-${requestId}`;
    const token = crypto.randomUUID();
    lease = await repo.acquireLease({scopeKey: SCOPE_KEY, provider: provider.id, platform: "copart",
      operation: "discovery", owner, token, now: started, ttlMs: 15 * 60 * 1000});
    if (!lease.acquired) throw Object.assign(new Error(), {safeCode: "lease_busy"});
    const runId = `phase-d-run-${requestId}`;
    await repo.createRun({runId, scopeKey: SCOPE_KEY, provider: provider.id, platform: "copart",
      operation: "discovery", triggerKind: "operator", now: started});
    lease = {...lease, scopeKey: SCOPE_KEY, provider: provider.id, platform: "copart", owner, token, runId};
    result.runId = runId;

    result.stage = "budget_reserve";
    await repo.initializeBudget({provider: BUDGET_PROVIDER, budgetDay: BUDGET_CAMPAIGN,
      normalLimit: MAX_CAMPAIGN_REQUESTS, retryLimit: 0, now: started});
    await db.prepare(`UPDATE provider_request_budgets SET normal_limit=MIN(normal_limit,?),retry_limit=0,updated_at=?
      WHERE provider=? AND budget_day=?`).bind(MAX_CAMPAIGN_REQUESTS, startedAt, BUDGET_PROVIDER, BUDGET_CAMPAIGN).run();
    const budget = await db.prepare(`SELECT normal_limit,normal_consumed,normal_reserved,retry_limit,retry_consumed,retry_reserved
      FROM provider_request_budgets WHERE provider=? AND budget_day=?`).bind(BUDGET_PROVIDER, BUDGET_CAMPAIGN).first();
    if (!budget || Number(budget.normal_consumed) + Number(budget.normal_reserved) >= MAX_CAMPAIGN_REQUESTS) {
      throw Object.assign(new Error(), {safeCode: "phase_d_request_cap_reached"});
    }
    reservationId = `phase-d-reservation-${requestId}`;
    const reservation = await repo.reserveBudget({reservationId, provider: BUDGET_PROVIDER,
      budgetDay: BUDGET_CAMPAIGN, bucket: "normal", count: 1, now: started});
    if (!reservation.allowed || !await repo.startBudgetReservation({reservationId, now: started})) {
      throw Object.assign(new Error(), {safeCode: "phase_d_request_budget_exhausted"});
    }

    result.stage = "provider_discovery";
    const fetchStarted = now();
    result.liveRequests = 1;
    await db.prepare("UPDATE sync_runs SET upstream_requests=upstream_requests+1 WHERE run_id=? AND status='running'")
      .bind(lease.runId).run();
    const providerResponse = await provider.listVehicles(env, {platform: "copart", per_page: PAGE_SIZE, _budgetClass: "discovery", ...(cursor ? {cursor} : {})});
    const fetchedAt = now();
    result.providerLatencyMs = Math.max(0, fetchedAt - fetchStarted);
    await repo.finishBudgetReservation({reservationId, now: fetchedAt});

    result.stage = "canonicalize";
    const page = canonicalizeDiscoveryPage({provider, response: providerResponse, scopeKey: SCOPE_KEY,
      platform: "copart", cursor, now: fetchedAt, freshnessPolicy: {
        hotIntervalMs: 60_000, warmIntervalMs: 3_600_000, coldIntervalMs: 86_400_000, hotWindowMs: 3_600_000
      }});
    result.providerRecords = page.providerRecords;
    result.accepted = page.accepted;
    result.rejected = page.rejected;
    result.ambiguous = page.ambiguous;
    if (!page.accepted) throw Object.assign(new Error(), {safeCode: "no_valid_canonical_records"});
    const deduped = dedupePage(page.records);
    result.duplicates = deduped.duplicates;

    const existed = [];
    for (const record of deduped.records) {
      const [listing, source] = await Promise.all([
        repo.getListing(record.identity.listingId),
        repo.getSource({provider: record.identity.provider, platform: record.identity.platform,
          providerVehicleId: record.vehicle.provider_vehicle_id})
      ]);
      existed.push(Boolean(listing || source));
    }
    result.inserts = existed.filter(value => !value).length;
    result.updates = existed.filter(Boolean).length;

    result.stage = "persist";
    const pageInput = {scopeKey: SCOPE_KEY, provider: provider.id, platform: "copart", runId: lease.runId,
      owner: lease.owner, token: lease.token, leaseGeneration: lease.leaseGeneration,
      cursor, nextCursor: page.nextCursor, records: deduped.records, now: fetchedAt,
      recordsReceived: page.providerRecords,
      recordsInserted: result.inserts, recordsUpdated: result.updates,
      recordsSkipped: result.rejected + result.ambiguous + result.duplicates,
      latencyMs: result.providerLatencyMs};
    const persisted = await repo.persistDiscoveryPage(pageInput);
    result.nextCursorPresent = page.nextCursor !== null && page.nextCursor !== undefined;
    result.scopeComplete = persisted.complete;

    result.stage = "replay_check";
    const replay = await repo.persistDiscoveryPage(pageInput);
    if (!replay.replayed) throw Object.assign(new Error(), {safeCode: "page_replay_not_idempotent"});
    result.replayVerified = true;

    if (!persisted.complete) {
      await repo.finishPartialRun({scopeKey: lease.scopeKey, runId: lease.runId, owner: lease.owner,
        token: lease.token, leaseGeneration: lease.leaseGeneration, now: now()});
      lease = null;
    } else lease = null; // persistDiscoveryPage closes the successful complete lease in its atomic batch.

    result.stage = "readback";
    const snapshotsAfter = Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_listing_snapshots").first())?.n || 0);
    const readbacks = [];
    for (const record of deduped.records) {
      const stored = await repo.getListing(record.identity.listingId);
      const source = await repo.getSource({provider: record.identity.provider, platform: record.identity.platform,
        providerVehicleId: record.vehicle.provider_vehicle_id});
      readbacks.push(!!stored && stored.source_key === record.identity.sourceKey
        && stored.platform === record.vehicle.platform && stored.lot === (record.vehicle.lot || null)
        && stored.vin_normalized === (record.vehicle.vin || null)
        && stored.auction_state === (record.vehicle.auction?.state || null)
        && stored.current_bid_usd === (Number.isFinite(record.vehicle.pricing?.current_bid) ? record.vehicle.pricing.current_bid : null)
        && !!source && source.provider === provider.id && source.platform === "copart");
    }
    const scope = await repo.getScope(SCOPE_KEY);
    const columns = (await db.prepare("PRAGMA table_info(auction_listings)").all()).results.map(row => row.name);
    // HTTPS media URL references are allowed; raw payloads and binary media are not.
    const rawMediaExcluded = !columns.some(name => /raw_payload|raw_json|media_items|photo_binary|image_binary|binary/i.test(name));
    if (!readbacks.every(Boolean) || !rawMediaExcluded || scope?.cursor !== (page.nextCursor ?? null)) {
      throw Object.assign(new Error(), {safeCode: "d1_readback_mismatch"});
    }
    result.readback = true;
    result.after = await readCounts(db);
    result.snapshotsCreated = Math.max(0, snapshotsAfter - before.sync.auction_listing_snapshots);
    result.eventsCreated = Number((await db.prepare("SELECT COUNT(*) AS n FROM auction_events").first())?.n || 0)
      - before.sync.auction_events;
    result.rawOrMediaStored = false;
    result.stage = "complete";
    result.ok = true;
  } catch (error) {
    result.error = /^[a-z0-9_]{1,64}$/.test(String(error?.safeCode || "")) ? error.safeCode : "phase_d_failed";
    if (lease) {
      try {
        await repo.failRun({scopeKey: lease.scopeKey, runId: lease.runId, owner: lease.owner,
          token: lease.token, leaseGeneration: lease.leaseGeneration, errorCode: result.error, now: now()});
      } catch { /* expiry allows a future bounded manual recovery */ }
    }
    try { result.after = await readCounts(db); } catch { /* D1 readback can fail independently */ }
  } finally {
    result.elapsedMs = Math.max(0, now() - started);
    try {
      const budget = await db.prepare(`SELECT normal_limit,normal_consumed,normal_reserved,retry_limit,retry_consumed,retry_reserved
        FROM provider_request_budgets WHERE provider=? AND budget_day=?`).bind(BUDGET_PROVIDER, BUDGET_CAMPAIGN).first();
      if (budget) result.campaignBudget = {
        limit: Number(budget.normal_limit), consumed: Number(budget.normal_consumed), reserved: Number(budget.normal_reserved),
        retryLimit: Number(budget.retry_limit), retryConsumed: Number(budget.retry_consumed), retryReserved: Number(budget.retry_reserved)
      };
    } catch { /* keep diagnostic safe and bounded */ }
  }
  return result;
}

function safeJson(data, status = 200, extraHeaders = []) {
  const headers = new Headers({"Content-Type": "application/json; charset=UTF-8", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"});
  for (const [key, value] of extraHeaders) headers.append(key, value);
  return new Response(JSON.stringify(data), {status, headers});
}

async function handlePhaseDRequest(request, env, executionContext, dispatch, provider = createApibaraProvider()) {
  const url = new URL(request.url);
  const id = crypto.randomUUID();
  const path = "/__staging/d1-sync-phase-d-discovery";
  if (url.pathname !== path) return null;
  const hostAllowed = url.protocol === "https:" && url.hostname === "rexbid-auth-test.tedn828.workers.dev"
    && env?.REXBID_AUTH_TEST_UI === "enabled"
    && env?.REXBID_AUTH_TEST_HOST === "rexbid-auth-test.tedn828.workers.dev"
    && env?.REXBID_PHASE_D_DISCOVERY === "enabled";
  if (!hostAllowed) return safeJson({ok: false, error: "not_found"}, 404);
  if (request.method !== "POST") return safeJson({ok: false, error: "method_not_allowed"}, 405);
  if (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") !== "same-origin") {
    return safeJson({ok: false, error: "request_rejected"}, 403);
  }
  const cookie = request.headers.get("Cookie");
  if (!cookie) return safeJson({ok: false, error: "authentication_required"}, 401);
  const authHeaders = new Headers({Cookie: cookie, Origin: url.origin, "Sec-Fetch-Site": "same-origin"});
  let authResponse;
  try {
    authResponse = await dispatch(new Request(`${url.origin}/api/me`, {method: "GET", headers: authHeaders}), env, executionContext);
  } catch { return safeJson({ok: false, error: "authentication_unavailable"}, 503); }
  let authBody = null;
  try { authBody = await authResponse.json(); } catch { /* auth failure is generic */ }
  if (authResponse.status !== 200 || !authBody?.user?.id) {
    return safeJson({ok: false, error: "authentication_required"}, 401);
  }
  const setCookies = typeof authResponse.headers.getSetCookie === "function"
    ? authResponse.headers.getSetCookie().map(value => ["Set-Cookie", value]) : [];
  let body;
  try { body = await request.json(); } catch { return safeJson({ok: false, error: "invalid_request"}, 400, setCookies); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
    return safeJson({ok: false, error: "invalid_request"}, 400, setCookies);
  }
  const db = env?.REXBID_DB;
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    return safeJson({ok: false, error: "database_unavailable"}, 503, setCookies);
  }
  console.info("Rex.Bid staging discovery", JSON.stringify({request_id: id, operation: "persistent_discovery", stage: "started"}));
  const result = await runPersistentDiscovery({db, env, requestId: id, provider});
  console.info("Rex.Bid staging discovery", JSON.stringify({request_id: id, operation: "persistent_discovery", stage: result.stage,
    http_status: result.ok ? 200 : 503, live_requests: result.liveRequests, provider_records: result.providerRecords,
    accepted: result.accepted, rejected: result.rejected, ambiguous: result.ambiguous, inserts: result.inserts,
    updates: result.updates, duplicates: result.duplicates, readback: result.readback === true,
    raw_or_media_stored: result.rawOrMediaStored === true}));
  const response = safeJson(result, result.ok ? 200 : 503, setCookies);
  response.headers.set("X-RexBid-Request-ID", id);
  return response;
}

module.exports = {PAGE_SIZE, MAX_CAMPAIGN_REQUESTS, SCOPE_KEY, BUDGET_PROVIDER, BUDGET_CAMPAIGN,
  runPersistentDiscovery, handlePhaseDRequest, readCounts};
