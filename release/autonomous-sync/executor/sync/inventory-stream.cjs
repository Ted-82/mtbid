"use strict";

const {prepareInventoryChangePatch, BASELINE_FIELDS} = require("./inventory-change-patch.cjs");

const STREAM_KEY = "stream:changes", CHUNK_SIZE = 40, MINUTE = 60000;
const iso = value => new Date(value).toISOString();
const keyOf = event => `${event.platform}:${event.lotNumber}`;
const codeOf = error => error?.code || error?.message;
const SAFE_PATCH_ERRORS = new Set(["INVENTORY_CHANGE_PATCH_INVALID", "INVENTORY_CHANGE_IDENTITY_CONFLICT",
  "INVENTORY_CHANGE_TIME_INVALID", "INVENTORY_CHANGE_BASELINE_INVALID"]);

function cursorNumber(value) {
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw Error("INVENTORY_STREAM_CHECKPOINT_INVALID");
  return Number(value);
}
function leaseStatement(db, store, now) {
  return db.prepare(`UPDATE automatic_refresh_state SET lease_until=?
    WHERE singleton=1 AND blocked_reason IS NULL AND lease_owner=? AND lease_until>?`)
    .bind(iso(now + 10 * MINUTE), store.owner, iso(now));
}
function streamGuard(db, expectedCursor, id, baselines = []) {
  const field = name => `json_extract(e.value,'$.${name}')`;
  const identity = `l.platform IS ${field("platform")} AND l.lot IS ${field("lot")}`;
  return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND cursor IS ?
      AND status<>'rebootstrap_required') AND NOT EXISTS(
      SELECT 1 FROM json_each(?) e WHERE
        (SELECT COUNT(*) FROM auction_listings l WHERE ${identity})<>1
        OR NOT EXISTS(SELECT 1 FROM auction_listings l WHERE ${identity}
          AND ${BASELINE_FIELDS.map(name => `l.${name} IS ${field(name)}`).join(" AND ")}
          AND EXISTS(SELECT 1 FROM vehicle_sources s WHERE s.source_key=l.source_key
            AND s.provider='apibara' AND s.platform=l.platform))
    ) THEN 1 ELSE 0 END)`).bind(id, STREAM_KEY, expectedCursor, JSON.stringify(baselines));
}
function cleanupGuards(db, ids) {
  return db.prepare("DELETE FROM sync_batch_guards WHERE guard_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids));
}
function queueEntry(change, row, observedAt, now, error = null) {
  const identityError = Boolean(error), status = identityError ? "identity_error" : "pending";
  return {task_key: `reconcile:${change.platform}:${change.lotNumber}`, platform: change.platform,
    listing_id: row?.listing_id || null, cursor: change.lotNumber,
    next_due_at: iso(now + (identityError ? 7 * 24 * 60 * MINUTE : 0)), last_attempt_at: observedAt,
    status, failures: identityError ? 1 : 0, last_error_code: error};
}
function queueStatement(db, entries) {
  const columns = ["task_key", "platform", "listing_id", "cursor", "next_due_at", "last_attempt_at", "status", "failures", "last_error_code"];
  // A later change means the same LOT still needs reconciliation, not that a
  // previously failed detail read may bypass its provider/404 retry delay.
  const deferred = "automatic_refresh_tasks.status='pending' AND automatic_refresh_tasks.failures>0 AND automatic_refresh_tasks.next_due_at>excluded.next_due_at";
  return db.prepare(`INSERT INTO automatic_refresh_tasks
    (${columns.join(",")}) SELECT ${columns.map(column => `json_extract(value,'$.${column}')`).join(",")}
      FROM json_each(?) WHERE 1 ON CONFLICT(task_key) DO UPDATE SET
      listing_id=excluded.listing_id,cursor=excluded.cursor,last_attempt_at=excluded.last_attempt_at,
      next_due_at=CASE WHEN automatic_refresh_tasks.status='identity_error' OR (${deferred}) THEN automatic_refresh_tasks.next_due_at ELSE excluded.next_due_at END,
      status=CASE WHEN automatic_refresh_tasks.status='identity_error' THEN 'identity_error' ELSE excluded.status END,
      failures=automatic_refresh_tasks.failures+excluded.failures,
      last_error_code=CASE WHEN automatic_refresh_tasks.status='identity_error' OR (${deferred}) THEN automatic_refresh_tasks.last_error_code ELSE excluded.last_error_code END`)
    .bind(JSON.stringify(entries));
}
async function chunkRows(db, events) {
  if (!events.length) return new Map();
  const identities = [...new Map(events.map(event => [keyOf(event), event])).values()];
  const response = await db.prepare(`SELECT * FROM auction_listings WHERE ${identities.map(() => "(platform=? AND lot=?)").join(" OR ")}
    ORDER BY last_seen_at DESC,listing_id`).bind(...identities.flatMap(event => [event.platform, event.lotNumber])).all();
  if (!Array.isArray(response?.results)) throw Error("INVENTORY_STREAM_READ_INVALID");
  const byKey = new Map();
  for (const row of response.results) {
    const key = `${row.platform}:${row.lot}`, rows = byKey.get(key) || [];
    rows.push(row); byKey.set(key, rows);
  }
  return byKey;
}

/**
 * Consume only a previously seeded all-platform stream. Bootstrap owns the first
 * checkpoint; this module never invents one or skips forward after HTTP410.
 * The caller supplies the shared counted transport and owns quota reservations.
 * Patch/queue effects and each cursor advance share one lease-fenced transaction.
 */
async function processInventoryChanges({db, store, adapter, request, now = () => Date.now(), maxPages = 1} = {}) {
  if (!db?.prepare || !db?.batch) throw Error("INVENTORY_STREAM_DATABASE_REQUIRED");
  let task = await db.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key=?").bind(STREAM_KEY).first();
  const report = {pages: 0, events: 0, patched: 0, queued: 0, ignored: 0, cursor: null, latest: null, hasMore: false};
  if (!task) return {...report, disabled: true};
  if (task.platform !== "all") throw Error("INVENTORY_STREAM_CHECKPOINT_INVALID");
  report.cursor = cursorNumber(task.cursor);
  if (task.status === "rebootstrap_required") return {...report, rebootstrapRequired: true};
  if (store?.db !== db || typeof store?.guarded !== "function" || !store.owner
      || typeof adapter?.parseChangesResponse !== "function" || typeof request !== "function"
      || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 4) throw Error("INVENTORY_STREAM_CONFIG_INVALID");
  const sequences = new Map();
  for (let page = 0; page < maxPages; page++) {
    await store.guarded([leaseStatement(db, store, now())]);
    let obtained, parsed, observedAt;
    try {
      obtained = await request({operation: "vehicleChanges", after: report.cursor, limit: 500});
      observedAt = obtained?.observedAt;
      if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))
          || Date.parse(observedAt) > now()) throw Error("INVENTORY_STREAM_OBSERVATION_TIME_INVALID");
      observedAt = iso(Date.parse(observedAt));
      parsed = adapter.parseChangesResponse(obtained.response, {after: report.cursor, limit: 500});
    } catch (error) {
      if (codeOf(error) !== "CURSOR_EXPIRED") throw error;
      const id = crypto.randomUUID();
      await store.guarded([streamGuard(db, task.cursor, id), leaseStatement(db, store, now()),
        db.prepare(`UPDATE automatic_refresh_tasks SET status='rebootstrap_required',last_error_code='CURSOR_EXPIRED',
          failures=failures+1,scan_errors=scan_errors+1,last_attempt_at=?,next_due_at=? WHERE task_key=?`)
          .bind(iso(now()), iso(now() + 24 * 60 * MINUTE), STREAM_KEY), cleanupGuards(db, [id])]);
      return {...report, rebootstrapRequired: true};
    }
    if (parsed.events.some(event => !/^\d{1,20}$/.test(event.lotNumber))) throw Error("INVENTORY_STREAM_IDENTITY_INVALID");
    report.latest = parsed.latestAvailableSequence;
    // The parser enforces request-scoped sequence ordering. This additional
    // comparison keeps effects idempotent against an already committed cursor.
    const events = parsed.events.filter(event => event.sequence > report.cursor);
    const chunks = events.length ? Array.from({length: Math.ceil(events.length / CHUNK_SIZE)},
      (_, index) => events.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)) : [[]];
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index], final = index === chunks.length - 1;
      const rows = await chunkRows(db, chunk), initialRows = new Map(rows), pendingSequences = new Map(sequences);
      const guards = [crypto.randomUUID()], statements = [], baselines = new Map(), queueEntries = [], pendingWrites = new Map();
      const counts = {events: chunk.length, patched: 0, queued: 0, ignored: 0, errors: 0};
      for (const change of chunk) {
        const key = keyOf(change), matches = rows.get(key) || [], row = matches[0] || null;
        if (!row && change.terminal) {counts.ignored++; continue;}
        if (matches.length > 1) {
          queueEntries.push(queueEntry(change, null, observedAt, now(), "INVENTORY_CHANGE_IDENTITY_CONFLICT"));
          counts.queued++; counts.errors++; continue;
        }
        if (!row) {
          queueEntries.push(queueEntry(change, null, observedAt, now())); counts.queued++; continue;
        }
        // Omitted VINs are permitted for an established platform/LOT identity.
        // An explicitly malformed VIN is different: retain the failed identity
        // for review instead of silently applying its price or retrying it now.
        if (change.vin != null && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(change.vin)) {
          queueEntries.push(queueEntry(change, row, observedAt, now(), "INVENTORY_CHANGE_IDENTITY_CONFLICT"));
          counts.queued++; counts.errors++; continue;
        }
        let plan;
        try {plan = prepareInventoryChangePatch({row, change, observedAt, lastAppliedSequence: pendingSequences.get(key) ?? null});}
        catch (error) {
          if (!SAFE_PATCH_ERRORS.has(codeOf(error))) throw error;
          queueEntries.push(queueEntry(change, row, observedAt, now(), codeOf(error)));
          counts.queued++; counts.errors++; continue;
        }
        if (plan.status === "patch") {
          if (!plan.match?.sql || !Array.isArray(plan.match.params) || !plan.statement?.sql
              || !Array.isArray(plan.statement.params) || !plan.assignments) throw Error("INVENTORY_STREAM_PATCH_PLAN_INVALID");
          // Evaluate every event in sequence against its virtual row, then
          // write each LOT's final values once. The original CAS is retained;
          // neither an intermediate value nor a newer external write can leak.
          if (!baselines.has(key)) baselines.set(key, Object.fromEntries(BASELINE_FIELDS.map(name => [name, initialRows.get(key)[0][name]])));
          if (!pendingWrites.has(key)) pendingWrites.set(key, {match: plan.match, columns: new Set()});
          for (const column of Object.keys(plan.assignments)) pendingWrites.get(key).columns.add(column);
          rows.set(key, [{...row, ...plan.assignments}]); counts.patched++;
        } else if (plan.status === "ignored") counts.ignored++;
        else if (plan.status !== "requires_detail") throw Error("INVENTORY_STREAM_PATCH_PLAN_INVALID");
        if (plan.requiresDetail || plan.status === "requires_detail") {
          queueEntries.push(queueEntry(change, row, observedAt, now())); counts.queued++;
        }
        pendingSequences.set(key, change.sequence);
      }
      for (const [key, pending] of pendingWrites) {
        const original = initialRows.get(key)[0], finalRow = rows.get(key)[0];
        const columns = [...pending.columns].filter(column => original[column] !== finalRow[column]);
        if (!columns.length) continue;
        const prefix = "SELECT listing_id FROM auction_listings WHERE ";
        if (!pending.match.sql.startsWith(prefix) || columns.some(column => !BASELINE_FIELDS.includes(column))) throw Error("INVENTORY_STREAM_PATCH_PLAN_INVALID");
        statements.push(db.prepare(`UPDATE auction_listings SET ${columns.map(column => `${column}=?`).join(",")} WHERE ${pending.match.sql.slice(prefix.length)}`)
          .bind(...columns.map(column => finalRow[column]), ...pending.match.params));
      }
      const nextCursor = final ? parsed.nextCursor : chunk[chunk.length - 1].sequence;
      const catchingUp = !final || parsed.hasMore;
      statements.unshift(streamGuard(db, task.cursor, guards[0], [...baselines.values()]));
      if (queueEntries.length) statements.push(queueStatement(db, queueEntries));
      statements.push(leaseStatement(db, store, now()),
        db.prepare(`UPDATE automatic_refresh_tasks SET cursor=?,status=?,scan_pages=scan_pages+?,scan_errors=scan_errors+?,
          scan_started_at=?,next_due_at=?,last_attempt_at=?,last_success_at=?,failures=0,last_error_code=? WHERE task_key=?`)
          .bind(String(nextCursor), catchingUp ? "catching_up" : "complete", final ? 1 : 0, counts.errors,
            catchingUp ? task.scan_started_at || observedAt : null,
            iso(catchingUp ? now() : (Math.floor(now() / (15 * MINUTE)) + 1) * 15 * MINUTE),
            observedAt, observedAt, counts.errors ? "INVENTORY_STREAM_RECONCILIATION_REQUIRED" : null, STREAM_KEY),
        cleanupGuards(db, guards));
      if (statements.length + 2 > CHUNK_SIZE + 7) throw Error("INVENTORY_STREAM_BATCH_TOO_LARGE");
      await store.guarded(statements);
      for (const [key, sequence] of pendingSequences) sequences.set(key, sequence);
      for (const name of ["events", "patched", "queued", "ignored"]) report[name] += counts[name];
      report.cursor = nextCursor;
      task = {...task, cursor: String(nextCursor), scan_started_at: catchingUp ? task.scan_started_at || observedAt : null};
    }
    report.pages++; report.hasMore = parsed.hasMore;
    if (!parsed.hasMore) break;
  }
  return report;
}

module.exports = {STREAM_KEY, CHUNK_SIZE, processInventoryChanges};
