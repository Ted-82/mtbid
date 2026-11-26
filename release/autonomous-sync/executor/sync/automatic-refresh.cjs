"use strict";

// Scheduled backend only. No route, public-read fallback or implicit transport.
// API contract reviewed 2026-10-14: https://apibara.tech/en/products/vehicle-auction-data-api/docs
const {createApibaraProvider} = require("../providers/apibara.js");
const {D1SyncRepository, knownObservationStatements} = require("./d1-repository.js");
const {prepareObservation} = require("./publication-refresh.cjs");
const {processInventoryChanges} = require("./inventory-stream.cjs");
const {processInventoryReconciliation} = require("./inventory-reconcile.cjs");
const {processTimedRefresh} = require("./timed-refresh.cjs");

const TARGETS = Object.freeze(["c8a30088-70af-43a6-9a7f-c4018279d37d", "acb3cb8e-69a2-459f-8a46-0f2f5b9004be"]);
const HOUR = 3600000, DAY = 24 * HOUR;
const POLICY = Object.freeze({hotIntervalMs: 30 * 60000, warmIntervalMs: 6 * HOUR, coldIntervalMs: 7 * DAY, hotWindowMs: 2 * HOUR});
const CODE = value => /^[A-Z][A-Z0-9_]{1,80}$/.test(value?.code || value?.message || "") ? value.code || value.message : "AUTOMATIC_REFRESH_FAILED";
const iso = value => new Date(value).toISOString();
const changed = result => Number(result?.meta?.changes || 0);
const fullVin = value => /^[A-HJ-NPR-Z0-9]{17}$/.test(String(value || "").toUpperCase());
const RECORD_ERRORS = new Set(["AUTOMATIC_REFRESH_IDENTITY_MISMATCH", "AUTOMATIC_REFRESH_IDENTITY_INVALID", "CANONICAL_IDENTITY_INVALID", "NEGATIVE_PROVIDER_PRICE",
  "SOURCE_VERSION_TIME_INVALID", "DETAIL_TARGET_MISMATCH", "AMBIGUOUS_PLATFORM_LOT", "KNOWN_TARGET_CHANGED", "PLATFORM_LOT_VIN_MISMATCH"]);
function persistenceError(error) {
  if (CODE(error) === "AUTOMATIC_REFRESH_QUERY_LIMIT") return error;
  const failed = Error("AUTOMATIC_REFRESH_WRITE_FAILED"); failed.cause = error; return failed;
}

// D1 counts each SQL statement in a batch against the Worker's invocation
// ceiling. Count actual statements (including guards/accounting), not provider
// requests, and retain a separate finalization reserve before releasing lease.
function queryBudgetDatabase(database) {
  const native = new WeakMap(), budget = {used: 0, limit: 970};
  const take = count => {
    if (budget.used + count > budget.limit) throw Error("AUTOMATIC_REFRESH_QUERY_LIMIT");
    budget.used += count;
  };
  const wrap = statement => {
    const wrapped = {...statement}; native.set(wrapped, statement);
    if (typeof statement.bind === "function") wrapped.bind = (...args) => wrap(statement.bind(...args));
    for (const method of ["all", "first", "run", "raw"]) if (typeof statement[method] === "function") {
      wrapped[method] = (...args) => {take(1); return statement[method](...args);};
    }
    return wrapped;
  };
  return {budget, db: {prepare: sql => wrap(database.prepare(sql)), batch: statements => {
    take(statements.length); return database.batch(statements.map(statement => native.get(statement) || statement));
  }}};
}

function bounded(env, name, fallback, min, max) {
  const text = String(env?.[name] ?? fallback);
  if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) throw Error("AUTOMATIC_REFRESH_CONFIG_INVALID");
  return Number(text);
}
function configuration(env) {
  if (env?.REXBID_AUTO_REFRESH_ENABLED !== "enabled") return {enabled: false};
  if (!TARGETS.includes(env.REXBID_AUTO_REFRESH_DATABASE_ID)) throw Error("AUTOMATIC_REFRESH_TARGET_INVALID");
  if (env.REXBID_RELEASE_D1_DATABASE_ID && env.REXBID_RELEASE_D1_DATABASE_ID !== env.REXBID_AUTO_REFRESH_DATABASE_ID) throw Error("AUTOMATIC_REFRESH_TARGET_INVALID");
  const config = {
    enabled: true,
    timedEnabled: env.REXBID_AUTO_REFRESH_TIMED_ENABLED === "enabled",
    daily: bounded(env, "REXBID_AUTO_REFRESH_DAILY_LIMIT", 500, 1, 1000),
    monthly: bounded(env, "REXBID_AUTO_REFRESH_MONTHLY_LIMIT", 12000, 1, 30000),
    perRun: bounded(env, "REXBID_AUTO_REFRESH_MAX_PER_RUN", 8, 1, 10),
    newPerDay: bounded(env, "REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT", 2000, 0, 2000),
    quotaReserve: bounded(env, "REXBID_AUTO_REFRESH_QUOTA_RESERVE", 500, 10, 10000)
  };
  if (config.daily > config.monthly) throw Error("AUTOMATIC_REFRESH_CONFIG_INVALID");
  return config;
}

// Keep capacity for later 15-minute ticks instead of spending the whole daily
// allowance in the morning. Reservations remain the authoritative hard limit.
function pacedRunLimit(config, budgets, now) {
  const date = new Date(now), dayKey = `day:${date.toISOString().slice(0,10)}`;
  const daily = budgets.find(row => row.budget_key === dayKey);
  const remaining = Math.max(0, (daily?.limit_count ?? 0) - (daily?.consumed ?? 0));
  const end = Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1);
  const ticks = Math.max(1,Math.ceil((end-now)/(15*60000)));
  return Math.min(config.perRun,Math.max(1,Math.floor(remaining/ticks)));
}

// This exact shape was obtained from authenticated /usage on 2026-10-14.
// period.to is the reporting date, NOT a renewal date. It is deliberately unused.
function parseUsage(response, reserve) {
  const data = response?.response?.data ?? response?.data;
  const q = data?.quota, plan = data?.plan;
  if (response?.ok === false || response?.response?.ok === false || !q || !plan
      || ![q.used, q.limit, q.left].every(n => Number.isSafeInteger(n) && n >= 0)
      || q.limit < 1 || q.used + q.left !== q.limit || !Number.isSafeInteger(plan.per_page_limit)
      || plan.per_page_limit < 20 || typeof plan.name !== "string" || !/^[a-z0-9 +_-]{1,40}$/i.test(plan.name)) {
    throw Error("AUTOMATIC_REFRESH_QUOTA_RESPONSE_INVALID");
  }
  // One extra request is reserved because the provider may account for /usage
  // before or after returning its body. All our calls are counted separately.
  return {limit: q.limit, used: q.used, left: q.left, allowance: Math.max(0, q.left - reserve - 1), plan: plan.name};
}

function detailSpec(row) {
  const identifier = row.provider_vehicle_id || (fullVin(row.vin_normalized) ? row.vin_normalized : row.lot);
  if (!identifier || typeof identifier !== "string" || identifier.length > 200 || !/^\d+$/.test(row.lot)
      || !["copart", "iaai"].includes(row.platform)) throw Error("AUTOMATIC_REFRESH_IDENTITY_INVALID");
  return {operation: "vehicleByIdentifier", identifier, platform: row.platform};
}
function assertDetail(raw, row) {
  if (!raw || String(raw.platform || "").toLowerCase() !== row.platform || String(raw.lot_number ?? raw.lot ?? "") !== row.lot) throw Error("AUTOMATIC_REFRESH_IDENTITY_MISMATCH");
  const known = String(row.vin_normalized || "").toUpperCase(), vin = String(raw.vin || "").toUpperCase();
  if (known && (!vin || known.length !== vin.length || [...known].some((c, i) => /[A-HJ-NPR-Z0-9]/.test(c) && c !== vin[i]))) throw Error("AUTOMATIC_REFRESH_IDENTITY_MISMATCH");
}

class RefreshStore {
  constructor(db, owner, now) {this.db = db; this.owner = owner; this.now = now;}
  async state() {return this.db.prepare("SELECT * FROM automatic_refresh_state WHERE singleton=1").bind().first();}
  async acquire() {
    const at = iso(this.now());
    return changed(await this.db.prepare(`UPDATE automatic_refresh_state SET lease_owner=?,lease_until=?,last_started_at=?
      WHERE singleton=1 AND blocked_reason IS NULL AND (pause_until IS NULL OR pause_until<=?)
        AND (lease_owner IS NULL OR lease_until<=?)`).bind(this.owner, iso(this.now() + 10 * 60000), at, at, at).run()) === 1;
  }
  async guarded(statements) {
    const id = crypto.randomUUID();
    try {return await this.db.batch([
      this.db.prepare(`INSERT INTO automatic_refresh_guards(guard_id,valid) VALUES(?,CASE WHEN EXISTS(
        SELECT 1 FROM automatic_refresh_state WHERE singleton=1 AND blocked_reason IS NULL AND lease_owner=? AND lease_until>?) THEN 1 ELSE 0 END)`).bind(id, this.owner, iso(this.now())),
      ...statements,
      this.db.prepare("DELETE FROM automatic_refresh_guards WHERE guard_id=?").bind(id)
    ]);} catch(error) {throw persistenceError(error);}
  }
  async initializeBudgets(config) {
    const at = iso(this.now());
    this.keys = [`day:${at.slice(0, 10)}`, `month:${at.slice(0, 7)}`, `new:${at.slice(0, 10)}`];
    const current = await this.budgets();
    // All consumers share the controller's persisted decision. A legacy
    // initializer must not shrink today's admitted account pool back to 500.
    let centrallyManaged=false;
    try {
      const policy=await this.task('feed-adaptive-policy:v1');
      const value=JSON.parse(policy?.cursor);
      centrallyManaged=policy?.status==='complete'&&value?.version===1&&value.day===at.slice(0,10)
        &&Number.isSafeInteger(value.daily)&&value.daily>=0&&Number.isSafeInteger(value.monthly)&&value.monthly>=0
        &&Date.parse(value.checkedAt)<=this.now()&&this.now()-Date.parse(value.checkedAt)<DAY;
    } catch { /* No verified central policy: preserve the conservative initializer. */ }
    const month = current.find(row => row.budget_key === this.keys[1]);
    const day = current.find(row => row.budget_key === this.keys[0]);
    const date = new Date(this.now()), daysRemaining = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate() - date.getUTCDate() + 1;
    const monthlyRemainingAtDayStart = Math.max(0, Math.min(config.monthly, month?.limit_count ?? config.monthly) - (month?.consumed ?? 0) + (day?.consumed ?? 0));
    // Pace our own calendar-month ceiling; this does not infer the provider's
    // subscription renewal from its reporting period.to field.
    const daily = Math.min(config.daily, Math.max(1, Math.floor(monthlyRemainingAtDayStart / daysRemaining)));
    await this.guarded(this.keys.flatMap((key, i) => centrallyManaged&&!config.adaptiveProvider?[]:[this.db.prepare(`INSERT INTO automatic_refresh_budgets(budget_key,limit_count,created_at,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(budget_key) DO UPDATE SET limit_count=${config.adaptiveProvider&&i<2 ? 'MAX' : 'MIN'}(limit_count,excluded.limit_count),updated_at=excluded.updated_at`)
      .bind(key, [daily, config.monthly, config.newPerDay][i], at, at)]));
  }
  async reserve(spec, listingId, isUsage) {
    const id = crypto.randomUUID(), at = iso(this.now());
    const catchup=this.catchupBudgetKey||null;
    if(catchup!==null&&!/^relist-catchup:\d{4}-\d\d-\d\d$/.test(catchup))throw Error('AUTOMATIC_REFRESH_CATCHUP_INVALID');
    if (this.keys[0] !== `day:${at.slice(0, 10)}`) throw Error("AUTOMATIC_REFRESH_DAY_CHANGED");
    // INSERT and both increments commit together. A crash after this transaction
    // still counts the attempted call and cannot recover budget by restarting.
    const statements = [this.db.prepare(`INSERT INTO automatic_refresh_attempts(attempt_id,operation,platform,listing_id,attempted_at)
      SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM automatic_refresh_budgets WHERE budget_key IN (?,?) AND consumed<limit_count)=2
      AND EXISTS(SELECT 1 FROM automatic_refresh_state WHERE singleton=1 AND blocked_reason IS NULL AND lease_owner=? AND lease_until>?
        AND (?=1 OR (quota_checked_at>? AND quota_allowance>0)))
      AND (? IS NULL OR EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key=? AND consumed<limit_count))`)
      .bind(id, spec.operation, spec.platform || null, listingId, at, this.keys[0], this.keys[1], this.owner, at, isUsage ? 1 : 0, iso(this.now() - DAY),catchup,catchup),
      this.db.prepare(`UPDATE automatic_refresh_budgets SET consumed=consumed+1,updated_at=? WHERE budget_key IN (?,?,?)
        AND EXISTS(SELECT 1 FROM automatic_refresh_attempts WHERE attempt_id=?)`).bind(at, this.keys[0], this.keys[1], catchup,id),
      this.db.prepare(`UPDATE automatic_refresh_state SET quota_allowance=MAX(0,quota_allowance-1) WHERE singleton=1
        AND EXISTS(SELECT 1 FROM automatic_refresh_attempts WHERE attempt_id=?)`).bind(id)];
    const result = await this.guarded(statements);
    return changed(result[1]) === 1 ? id : null;
  }
  async finishAttempt(id, error = null) {
    await this.guarded([this.db.prepare("UPDATE automatic_refresh_attempts SET outcome=?,http_status=?,error_code=?,completed_at=? WHERE attempt_id=?")
      .bind(error ? "error" : "response", error?.status || (error ? null : 200), error ? CODE(error) : null, iso(this.now()), id)]);
  }
  async task(key) {return this.db.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key=?").bind(key).first();}
  taskStatement({key, platform, listingId = null, cursor = null, scanStartedAt = null, scanPages = 0, scanErrors = 0, due, status, error = null, success = false}) {
    const at = iso(this.now());
    return this.db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor,scan_started_at,scan_pages,scan_errors,next_due_at,last_attempt_at,last_success_at,status,failures,last_error_code)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_key) DO UPDATE SET cursor=excluded.cursor,
      scan_started_at=excluded.scan_started_at,scan_pages=excluded.scan_pages,scan_errors=excluded.scan_errors,
      next_due_at=excluded.next_due_at,last_attempt_at=excluded.last_attempt_at,status=excluded.status,
      last_success_at=COALESCE(excluded.last_success_at,automatic_refresh_tasks.last_success_at),
      failures=CASE WHEN excluded.failures=0 THEN 0 ELSE automatic_refresh_tasks.failures+1 END,last_error_code=excluded.last_error_code`)
      .bind(key, platform, listingId, cursor, scanStartedAt, scanPages, scanErrors, iso(due), at, success ? at : null, status, error ? 1 : 0, error);
  }
  async failTask(row, error) {
    const code = CODE(error), at = iso(this.now());
    const terminalIssue = code.includes("IDENTITY") || code.includes("MISMATCH") || code === "NOT_FOUND";
    await this.guarded([
      this.taskStatement({key: `detail:${row.listing_id}`, platform: row.platform, listingId: row.listing_id,
        due: this.now() + (terminalIssue ? 7 * DAY : HOUR), status: "error", error: code}),
      this.db.prepare(`UPDATE vehicle_sources SET last_attempt_at=?,last_error_code=?,sync_status='failed',updated_at=? WHERE source_key=?`)
        .bind(at, code, at, row.source_key)
    ]);
  }
  async budgets() {
    return (await this.db.prepare("SELECT budget_key,limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key IN (?,?,?)")
      .bind(...this.keys).all()).results;
  }
}

async function saveAutomaticObservation({store, repo, adapter, db, report, now}, raw, platform, observedAt, known = null, extra = []) {
    let prepared, built;
    try {
      if (known) assertDetail(raw, known);
      else {
        // A masked/conflicting VIN must not bypass the guard simply because it
        // cannot be normalized as a complete 17-character VIN.
        const lot = String(raw?.lot_number ?? raw?.lot ?? "");
        const matches = (await repo.findListingsByLot({platform, lot, limit: 2})).results || [];
        if (matches.length > 1) throw Error("AMBIGUOUS_PLATFORM_LOT");
        if (matches[0]) assertDetail(raw, matches[0]);
      }
      prepared = await prepareObservation({repo, provider: adapter, raw, platform, observedAt, processedAt: iso(now()),
        knownTarget: known ? {lot: known.lot, listingId: known.listing_id} : null, freshnessPolicy: POLICY});
      if (!prepared.skipped) built = await knownObservationStatements(db, prepared.record);
    } catch(error) {if (RECORD_ERRORS.has(CODE(error))) throw error; throw persistenceError(error);}
    if (prepared.skipped) {
      if (known) await store.guarded([store.taskStatement({key: `detail:${known.listing_id}`, platform: known.platform, listingId: known.listing_id,
        due: now() + POLICY.warmIntervalMs, status: "older_source_ignored"})]);
      report.skipped++; return {saved: false, reason: prepared.skipped};
    }
    // New VIN-less/ambiguous entries cannot receive a guessed identity.
    if (prepared.inserted && (!/^\d+$/.test(String(prepared.record.vehicle.lot)) || !fullVin(prepared.record.vehicle.vin))) throw Error("AUTOMATIC_REFRESH_IDENTITY_INVALID");
    if (prepared.inserted) {
      let budget;
      try {budget = (await store.budgets()).find(row => row.budget_key === store.keys[2]);}
      catch (error) {throw persistenceError(error);}
      if (!budget || budget.consumed >= budget.limit_count) {report.skipped++; return {saved: false, reason: "new_listing_budget"};}
    }
    const {statements, fingerprint} = built;
    if (known) statements.push(db.prepare("UPDATE auction_listings SET detail_synced_at=? WHERE listing_id=?").bind(observedAt, known.listing_id));
    if (prepared.inserted) statements.push(db.prepare("UPDATE automatic_refresh_budgets SET consumed=consumed+1,updated_at=? WHERE budget_key=?")
      .bind(iso(now()), store.keys[2]));
    statements.push(...(typeof extra === "function" ? extra(prepared.record) : extra));
    try {
      await store.guarded(statements);
      const readback = await repo.getListing(prepared.record.identity.listingId);
      const price = prepared.record.vehicle.pricing;
      if (readback?.summary_synced_at !== observedAt || readback.platform !== platform || readback.lot !== prepared.record.vehicle.lot
          || readback.current_bid_usd !== (Number.isFinite(price.current_bid) ? price.current_bid : null)
          || readback.buy_now_usd !== (Number.isFinite(price.buy_now) ? price.buy_now : null)) throw Error("AUTOMATIC_REFRESH_READBACK_FAILED");
      const snapshot = await db.prepare("SELECT fingerprint FROM auction_listing_snapshots WHERE listing_id=? ORDER BY observed_at DESC,snapshot_id DESC LIMIT 1")
        .bind(readback.listing_id).first();
      if (snapshot?.fingerprint !== fingerprint) throw Error("AUTOMATIC_REFRESH_READBACK_FAILED");
    } catch (error) {throw persistenceError(error);}
    if (prepared.inserted) report.inserted++; else report.updated++;
    return {saved: true, inserted: prepared.inserted, listingId: prepared.record.identity.listingId};
}

/** Called only from scheduled() or an explicitly authenticated operator runner.
 * provider must be a normal adapter with request(env,spec), or injected offline
 * provider for tests. Do not attach the public request-budget wrapper: this
 * scheduler has its own atomic daily/monthly/account allowance guard.
 */
async function runAutomaticRefresh({env, db = env?.REXBID_DB, provider = null, now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const config = configuration(env);
  const report = {ok: true, enabled: config.enabled, attempts: 0, responses: 0, retries: 0, inserted: 0, updated: 0, skipped: 0,
    rejected: 0, detailFailures: 0, listPages: 0, providerUsage: null, stopReason: null};
  if (!config.enabled) return {...report, stopReason: "disabled"};
  if (!db?.prepare || !db?.batch) throw Error("AUTOMATIC_REFRESH_DATABASE_REQUIRED");
  const counted = queryBudgetDatabase(db), queryBudget = counted.budget; db = counted.db;
  const store = new RefreshStore(db, crypto.randomUUID(), now), repo = new D1SyncRepository(db);
  if (!await store.acquire()) return {...report, stopReason: "lease_or_pause"};
  const adapter = provider || createApibaraProvider();
  let pauseUntil = null, blockedReason = null;
  const request = async (spec, listingId = null, options = {}) => {
    const ceiling = Math.max(0, config.perRun - (options.reserveRequests || 0));
    for (let retry = 0; retry < 2; retry++) {
      if (report.attempts >= ceiling) throw Error("AUTOMATIC_REFRESH_RUN_LIMIT");
      const id = await store.reserve(spec, listingId, spec.operation === "apiUsage");
      if (!id) throw Error("AUTOMATIC_REFRESH_BUDGET_STOP");
      report.attempts++; if (retry) report.retries++;
      let response;
      try {response = await adapter.request(env, spec);}
      catch (error) {
        await store.finishAttempt(id, error);
        if (retry === 0 && ["TIMEOUT", "UPSTREAM"].includes(error?.code) && (!error.status || error.status >= 500)) {
          const delay = Number(error.retryAfter ?? 2);
          if (Number.isFinite(delay) && delay >= 0 && delay <= 30 && report.attempts < ceiling) {await wait(Math.max(1000, delay * 1000)); continue;}
        }
        throw error;
      }
      await store.finishAttempt(id); report.responses++;
      if (!adapter.responseOk(response) || response?.response?.ok === false) throw Error("AUTOMATIC_REFRESH_RESPONSE_INVALID");
      return {response, observedAt: iso(now())};
    }
  };
  const systemError = error => ["AUTH", "CONFIGURATION", "RATE_LIMITED", "TIMEOUT", "UPSTREAM", "INVALID_REQUEST", "INVALID_RESPONSE", "AUTOMATIC_REFRESH_RESPONSE_INVALID",
    "AUTOMATIC_REFRESH_BUDGET_STOP", "AUTOMATIC_REFRESH_RUN_LIMIT", "AUTOMATIC_REFRESH_DAY_CHANGED", "AUTOMATIC_REFRESH_QUERY_LIMIT"].includes(CODE(error));
  const saveRecord = (...args) => saveAutomaticObservation({store, repo, adapter, db, report, now}, ...args);
  try {
    await store.initializeBudgets(config);
    config.perRun = pacedRunLimit(config, await store.budgets(), now());
    const state = await store.state();
    if (!state.quota_checked_at || Date.parse(state.quota_checked_at) <= now() - DAY) {
      const {response, observedAt} = await request({operation: "apiUsage"});
      const quota = parseUsage(response, config.quotaReserve);
      await store.guarded([db.prepare(`UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=?,quota_used=?,quota_left=?,quota_allowance=?,quota_plan=? WHERE singleton=1`)
        .bind(observedAt, quota.limit, quota.used, quota.left, quota.allowance, quota.plan)]);
      report.providerUsage = {checkedAt: observedAt, used: quota.used, limit: quota.limit, left: quota.left, plan: quota.plan};
      if (!quota.allowance) throw Error("AUTOMATIC_REFRESH_QUOTA_RESERVE");
    }
    // The full-inventory operator seeds this cursor only after its checkpoint
    // is durable. An absent seed keeps the previously tested scheduler behavior.
    const changes = await processInventoryChanges({db,store,adapter,request,now,maxPages:1});
    if (!changes.disabled) report.changes = changes;
    // Timed is a separate provider inventory: an ordinary Open list does not
    // include it. Its page cursors and completion never stand for the market.
    if (config.timedEnabled) report.timed = await processTimedRefresh({store,adapter,saveRecord,now,queryBudget,
      request: spec => request(spec, null, {reserveRequests: 1}),
      canRequest: () => report.attempts < config.perRun - 1,
      onRejected: () => report.rejected++});
    if (!changes.disabled && !changes.rebootstrapRequired && report.attempts < config.perRun) {
      report.reconciliation = await processInventoryReconciliation({db,store,adapter,request,saveRecord,now,
        maxRequests: Math.min(2,config.perRun-report.attempts)});
    }
    // Bootstrap Open inventory across all makes before incremental recent changes.
    // Separate keys keep opaque cursors tied to their original query.
    for (const platform of ["copart", "iaai"]) {
      if (report.attempts >= config.perRun) break;
      // Catch up before scanning ordinary list pages. Even a final stream page
      // can have 500 events, so reserve enough SQL for an entire 20-record list.
      if (changes.hasMore || changes.rebootstrapRequired || queryBudget.limit-queryBudget.used < (config.timedEnabled ? 600 : 280)) break;
      // Once the admitted-new-listing budget is used, further discovery pages
      // mostly discard new results. Leave their cursors untouched and spend
      // remaining calls on known due LOTs until the next UTC daily window.
      const newBudget = (await store.budgets()).find(row => row.budget_key === store.keys[2]);
      if (!newBudget || newBudget.consumed >= newBudget.limit_count) break;
      const inventory = await store.task(`inventory:${platform}`);
      const bootstrap = !(inventory?.scan_pages > 0 && !inventory.cursor && !inventory.scan_started_at);
      if (inventory?.next_due_at > iso(now())) continue;
      const key = `${bootstrap ? "inventory" : "list"}:${platform}`, task = bootstrap ? inventory : await store.task(key);
      if (task?.next_due_at > iso(now())) continue;
      // A full inventory can take several days. Never restart its cursor at midnight.
      const scanExpired = !bootstrap && task?.scan_started_at && now() - Date.parse(task.scan_started_at) > DAY;
      const cursor = scanExpired ? null : task?.cursor || null;
      const scanStarted = cursor ? task.scan_started_at : iso(now());
      const scanPages = cursor ? task.scan_pages : 0;
      const priorErrors = cursor ? task.scan_errors : 0;
      // Do not consume a page whose new rows cannot all be admitted. A short
      // final page preserves the next cursor without dropping rows at the cap.
      const pageSize = Math.min(20, newBudget.limit_count - newBudget.consumed);
      const {response, observedAt} = await request({operation: "listVehicles", params: {platform, lot_sub_status: "Open", ...(!bootstrap ? {updated_within_minutes: 1440} : {}), per_page: pageSize, ...(cursor ? {cursor} : {})}});
      const data = response?.response?.data ?? response?.data, meta = adapter.responseMeta(response);
      if ((!Array.isArray(data) && !Array.isArray(data?.vehicles)) || !meta || !Object.hasOwn(meta, "next_cursor")) throw Error("AUTOMATIC_REFRESH_LIST_SHAPE_INVALID");
      const records = adapter.vehicleListRecords(response), next = meta.next_cursor;
      if (!Array.isArray(records) || records.length > pageSize || next !== null && (typeof next !== "string" || !next || next.length > 4096 || next === cursor)) throw Error("AUTOMATIC_REFRESH_LIST_SHAPE_INVALID");
      const keys = new Set(); let rejected = 0;
      for (const raw of records) {
        try {
          const key = `${String(raw?.platform).toLowerCase()}:${raw?.lot_number ?? raw?.lot}`;
          if (keys.has(key)) throw Error("AUTOMATIC_REFRESH_DUPLICATE_PAGE_IDENTITY");
          keys.add(key); await saveRecord(raw, platform, observedAt);
        } catch (error) {
          if (!RECORD_ERRORS.has(CODE(error)) && CODE(error) !== "AUTOMATIC_REFRESH_DUPLICATE_PAGE_IDENTITY") throw error;
          rejected++; report.rejected++;
        }
      }
      await store.guarded([store.taskStatement({key, platform, cursor: next, scanStartedAt: next ? scanStarted : null,
        scanPages: scanPages + 1, scanErrors: priorErrors + rejected, due: now() + (next ? 15 : 30) * 60000,
        status: next || rejected || priorErrors ? "partial" : "complete", error: rejected ? "AUTOMATIC_REFRESH_RECORD_REJECTED" : null, success: true})]);
      report.listPages++;
    }
    const due = (await db.prepare(`SELECT l.*,s.provider_vehicle_id FROM auction_listings l JOIN vehicle_sources s ON s.source_key=l.source_key
      LEFT JOIN automatic_refresh_tasks t ON t.task_key='detail:'||l.listing_id
      WHERE s.provider='apibara' AND l.platform IN ('copart','iaai') AND l.identity_state='resolved'
        AND (l.next_refresh_at IS NULL OR l.next_refresh_at<=?)
        AND (t.next_due_at IS NULL OR t.next_due_at<=? OR (t.status='complete' AND t.last_error_code IS NULL
          AND julianday(l.summary_synced_at)>julianday(t.last_attempt_at)))
      ORDER BY CASE WHEN lower(l.auction_state) IN ('live','running','in_progress')
          OR (julianday(COALESCE(l.timed_end_at,l.auction_at)) BETWEEN julianday(?) AND julianday(?)) THEN 0
        WHEN lower(l.auction_state) IN ('sold','not_sold','ended','finished','closed','cancelled') THEN 3
        WHEN lower(l.auction_state) IN ('active','open','pending','upcoming','scheduled','future','pre_bid','prebid','timed','buy_now','buy now') THEN 1 ELSE 2 END,
        CASE WHEN s.last_error_code IS NULL THEN 0 ELSE 1 END,
        CASE WHEN julianday(COALESCE(l.timed_end_at,l.auction_at))>julianday(?) THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(l.timed_end_at,l.auction_at) IS NULL THEN 0 ELSE 1 END,
        CASE WHEN l.detail_synced_at IS NOT NULL THEN 0 ELSE 1 END,
        COALESCE(l.summary_synced_at,l.last_seen_at,''),l.listing_id LIMIT ?`)
      .bind(iso(now()), iso(now()), iso(now()), iso(now() + POLICY.hotWindowMs), iso(now()), config.perRun).all()).results;
    for (const row of due) {
      if (report.attempts >= config.perRun) break;
      if (queryBudget.limit-queryBudget.used < 40) break;
      try {
        const {response, observedAt} = await request(detailSpec(row), row.listing_id);
        const raw = adapter.vehicleDetailRecord(response);
        await saveRecord(raw, row.platform, observedAt, row, record => [store.taskStatement({key: `detail:${row.listing_id}`, platform: row.platform,
          listingId: row.listing_id, due: Date.parse(record.nextRefreshAt), status: "complete", success: true})]);
      } catch (error) {
        if (systemError(error) || CODE(error) === "AUTOMATIC_REFRESH_WRITE_FAILED") {
          if (["AUTH", "TIMEOUT", "UPSTREAM", "RATE_LIMITED"].includes(CODE(error))) await store.failTask(row, error);
          throw error;
        }
        await store.failTask(row, error); report.detailFailures++;
      }
    }
    report.stopReason = report.attempts >= config.perRun ? "run_limit"
      : queryBudget.limit-queryBudget.used < 40 ? "AUTOMATIC_REFRESH_QUERY_LIMIT" : "due_work_complete";
  } catch (error) {
    const code = CODE(error); report.stopReason = code;
    report.ok = ["AUTOMATIC_REFRESH_RUN_LIMIT", "AUTOMATIC_REFRESH_BUDGET_STOP", "AUTOMATIC_REFRESH_QUOTA_RESERVE", "AUTOMATIC_REFRESH_DAY_CHANGED", "AUTOMATIC_REFRESH_QUERY_LIMIT"].includes(code);
    if (["AUTH", "CONFIGURATION", "AUTOMATIC_REFRESH_WRITE_FAILED", "AUTOMATIC_REFRESH_QUOTA_RESPONSE_INVALID"].includes(code)) blockedReason = code;
    else if (code === "RATE_LIMITED" || code === "AUTOMATIC_REFRESH_QUOTA_RESERVE") pauseUntil = iso(now() + DAY);
    else if (!report.ok) pauseUntil = iso(now() + HOUR);
  }
  try {
    queryBudget.limit = 1000;
    report.budgets = await store.budgets();
    if (report.stopReason === "run_limit" && report.budgets.some(row => /^(day|month):/.test(row.budget_key) && row.consumed >= row.limit_count)) report.stopReason = "AUTOMATIC_REFRESH_BUDGET_STOP";
    report.d1Queries = queryBudget.used + 3;
    await store.guarded([db.prepare(`UPDATE automatic_refresh_state SET lease_owner=NULL,lease_until=NULL,last_finished_at=?,
      last_success_at=CASE WHEN ?=1 THEN ? ELSE last_success_at END,blocked_reason=?,pause_until=?,last_report_json=? WHERE singleton=1`)
      .bind(iso(now()), report.ok && report.updated + report.inserted + (report.changes?.patched || 0) > 0 ? 1 : 0, iso(now()), blockedReason, pauseUntil, JSON.stringify(report))]);
  } catch {report.ok = false; report.stopReason = "AUTOMATIC_REFRESH_STATE_WRITE_FAILED";}
  report.d1Queries = queryBudget.used;
  return report;
}

module.exports = {TARGETS, POLICY, configuration, pacedRunLimit, parseUsage, detailSpec, assertDetail, RefreshStore,
  queryBudgetDatabase, saveAutomaticObservation, runAutomaticRefresh};
