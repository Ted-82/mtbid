"use strict";

// Provider contract verified from the saved 2026-10-26 Timed/Open responses.
// This module is scheduled-only and shares the main refresh lease and budgets.
const MINUTE = 60000, HORIZON = 24 * 60 * MINUTE, MAX_PAGES = 192;
const iso = value => new Date(value).toISOString();
const code = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code || error?.message || "")
  ? error.code || error.message : "TIMED_REFRESH_FAILED";
const RECORD_ERRORS = new Set(["AUTOMATIC_REFRESH_IDENTITY_MISMATCH", "AUTOMATIC_REFRESH_IDENTITY_INVALID",
  "CANONICAL_IDENTITY_INVALID", "NEGATIVE_PROVIDER_PRICE", "SOURCE_VERSION_TIME_INVALID", "DETAIL_TARGET_MISMATCH",
  "AMBIGUOUS_PLATFORM_LOT", "KNOWN_TARGET_CHANGED", "PLATFORM_LOT_VIN_MISMATCH"]);
const fail = suffix => {throw Error(`AUTOMATIC_REFRESH_TIMED_${suffix}`);};
const hashCursor = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
  .map(byte => byte.toString(16).padStart(2,"0")).join("");

function validateTimedPage(response, adapter, params) {
  const body = response?.response ?? response, meta = adapter.responseMeta(response);
  if (body?.ok !== true || !Array.isArray(body.data) || !meta || !Array.isArray(meta.unknown_filters)
      || meta.unknown_filters.length || meta.platform !== params.platform || meta.view !== "full" || meta.upcoming !== "all"
      || meta.per_page !== params.per_page) fail("FILTER_RESPONSE_INVALID");
  const echo = meta.applied_filters;
  const required = {platform: params.platform, lot_status: "Timed", lot_sub_status: "Open", per_page: String(params.per_page), upcoming: "all", view: "full"};
  if (!echo || Object.entries(required).some(([key,value]) => echo[key] !== value)
      || Object.keys(echo).some(key => !Object.hasOwn(required,key) && !["include_total","cursor"].includes(key))
      || Object.hasOwn(echo,"cursor") && echo.cursor !== params.cursor
      || Object.hasOwn(echo,"include_total") && echo.include_total !== String(!!params.include_total)) fail("FILTER_RESPONSE_INVALID");
  // Cursor and include_total are not echoed by continuation pages. The request
  // closure binds the received page to the exact persisted cursor and filters.
  const records = adapter.vehicleListRecords(response), next = meta.next_cursor;
  if (!Array.isArray(records) || records.length > params.per_page || !Object.hasOwn(meta,"next_cursor")
      || next !== null && (typeof next !== "string" || !next || next.length > 4096 || next === params.cursor)
      || typeof meta.has_more !== "boolean" || meta.has_more !== (next !== null)
      || next !== null && !records.length) fail("PAGE_INVALID");
  if (params.include_total && (!Number.isSafeInteger(meta.total) || meta.total < records.length || meta.total_is_exact !== true)) fail("TOTAL_INVALID");
  const identities = new Set();
  for (const raw of records) {
    const lot = String(raw?.lot_number ?? ""), auction = raw?.auction;
    if (raw?.platform !== params.platform || !/^\d+$/.test(lot) || !/^[A-HJ-NPR-Z0-9]{17}$/.test(raw?.vin || "")
        || auction?.is_timed !== true || auction?.state !== "open" || typeof auction.timed_end_at !== "string"
        || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(auction.timed_end_at) || !Number.isFinite(Date.parse(auction.timed_end_at))) fail("IDENTITY_OR_STATE_INVALID");
    const key = `${raw.platform}:${lot}`;
    if (identities.has(key)) fail("DUPLICATE_PAGE_IDENTITY");
    identities.add(key);
  }
  return {records, next, total: params.include_total ? meta.total : null};
}

async function processTimedRefresh({store, adapter, request, saveRecord, now, queryBudget, canRequest, onRejected = () => {}}) {
  const report = {pages: 0, received: 0, saved: 0, skipped: 0, rejected: 0, capDeferred: 0, restarted: 0, completed: [], sourceTotals: {}, stopReason: null};
  const queue = [];
  for (const platform of ["copart","iaai"]) {
    const task = await store.task(`timed:${platform}`);
    if (!task || task.next_due_at <= iso(now())) queue.push({platform,task});
  }
  queue.sort((a,b) => String(a.task?.last_attempt_at || "").localeCompare(String(b.task?.last_attempt_at || "")));
  while (queue.length && report.pages < 2) {
    if (!canRequest()) {report.stopReason = "request_reserve"; break;}
    // A full 20-record page must be writable before transport. The reserve also
    // covers readback, cursors, request accounting and lease finalization.
    if (queryBudget.limit - queryBudget.used < 600) {report.stopReason = "sql_reserve"; break;}
    const {platform,task} = queue.shift(), key = `timed:${platform}`, seenKey = `timed-seen:${platform}`;
    const expired = task?.cursor && (!task.scan_started_at || !Number.isFinite(Date.parse(task.scan_started_at))
      || now() - Date.parse(task.scan_started_at) >= HORIZON || task.scan_pages >= MAX_PAGES);
    if (expired) report.restarted++;
    const cursor = expired ? null : task?.cursor || null, started = cursor ? task.scan_started_at : iso(now());
    const scanPages = cursor ? task.scan_pages : 0, priorErrors = cursor ? task.scan_errors : 0;
    let seen = [];
    if (cursor) {
      const receipt = await store.task(seenKey);
      try {seen = JSON.parse(receipt?.cursor || "null");} catch {fail("CURSOR_STATE_INVALID");}
      if (receipt?.scan_started_at !== started || !Array.isArray(seen) || seen.length !== scanPages
          || seen.some(value => !/^[0-9a-f]{64}$/.test(value)) || new Set(seen).size !== seen.length
          || !seen.includes(await hashCursor(cursor))) fail("CURSOR_STATE_INVALID");
    }
    const budget = (await store.budgets()).find(row => row.budget_key === store.keys[2]);
    const remainingNew = Math.max(0,(budget?.limit_count || 0) - (budget?.consumed || 0));
    // At zero allowance known records still refresh. Unknown rows hold this
    // page's cursor so the next UTC window can admit them without data loss.
    const pageSize = remainingNew > 0 ? Math.min(20,remainingNew) : 20;
    const params = {platform,lot_status:"Timed",lot_sub_status:"Open",per_page:pageSize,
      ...(cursor ? {cursor} : {include_total:true})};
    let next, observedAt, records, total, nextHash;
    try {
      const result = await request({operation:"listVehicles",params}); observedAt = result.observedAt;
      ({records,next,total} = validateTimedPage(result.response,adapter,params));
      if (next) {nextHash = await hashCursor(next); if (seen.includes(nextHash)) fail("CURSOR_CYCLE");}
    } catch (error) {
      if (!/WRITE_FAILED|QUERY_LIMIT/.test(code(error))) await store.guarded([store.taskStatement({key,platform,cursor,
        scanStartedAt: cursor ? started : null,scanPages,scanErrors:priorErrors,due:now()+60*MINUTE,status:"error",error:code(error)})]);
      throw error;
    }
    report.pages++; report.received += records.length;
    if (total !== null) report.sourceTotals[platform] = {total,observedAt};
    let rejected = 0, capDeferred = 0;
    for (const raw of records) {
      try {
        const saved = await saveRecord(raw,platform,observedAt);
        if (saved?.saved) report.saved++;
        else {report.skipped++; if (saved?.reason === "new_listing_budget") capDeferred++;}
      } catch (error) {
        if (!RECORD_ERRORS.has(code(error))) throw error;
        rejected++; report.rejected++; onRejected();
      }
    }
    report.capDeferred += capDeferred;
    const held = capDeferred > 0, continued = held || next !== null;
    const completedPages = held ? scanPages : scanPages+1, errors = priorErrors+rejected;
    const nextTask = {key,platform,cursor:held ? cursor : next,scanStartedAt:continued ? started : null,
      scanPages:completedPages,scanErrors:errors,due:now()+(continued?15:30)*MINUTE,
      status:continued || errors ? "partial" : "complete",
      error:held?"AUTOMATIC_REFRESH_TIMED_NEW_CAP":rejected?"AUTOMATIC_REFRESH_RECORD_REJECTED":null,success:!held};
    // Both cursors commit together after all accepted observations read back.
    // Hashes record all continuation cursors without logging their raw values.
    await store.guarded([store.taskStatement(nextTask),store.taskStatement({key:seenKey,platform,
      cursor:JSON.stringify(held?seen:next?[...seen,nextHash]:[]),scanStartedAt:continued?started:null,
      scanPages:completedPages,scanErrors:errors,due:nextTask.due,status:nextTask.status,success:!held})]);
    if (!continued && !errors) report.completed.push(platform);
    if (next && !held) queue.push({platform,task:{cursor:next,scan_started_at:started,scan_pages:completedPages,scan_errors:errors}});
  }
  return report;
}

module.exports = {validateTimedPage, processTimedRefresh, HORIZON, MAX_PAGES};
