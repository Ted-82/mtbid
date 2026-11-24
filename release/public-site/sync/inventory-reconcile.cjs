"use strict";

const HOUR = 3600000, DAY = 24 * HOUR;
const iso = value => new Date(value).toISOString();
const codeOf = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code || error?.message || "")
  ? error.code || error.message : "INVENTORY_RECONCILE_FAILED";
const IDENTITY_ERRORS = new Set(["INVENTORY_RECONCILE_IDENTITY_INVALID", "INVENTORY_RECONCILE_IDENTITY_MISMATCH",
  "AUTOMATIC_REFRESH_IDENTITY_MISMATCH", "AUTOMATIC_REFRESH_IDENTITY_INVALID", "CANONICAL_IDENTITY_INVALID",
  "AMBIGUOUS_PLATFORM_LOT", "KNOWN_TARGET_CHANGED", "PLATFORM_LOT_VIN_MISMATCH", "DETAIL_TARGET_MISMATCH",
  "NEGATIVE_PROVIDER_PRICE", "SOURCE_VERSION_TIME_INVALID"]);
const SYSTEM_ERRORS = new Set(["AUTH", "CONFIGURATION", "RATE_LIMITED", "TIMEOUT", "UPSTREAM", "INVALID_REQUEST", "INVALID_RESPONSE",
  "AUTOMATIC_REFRESH_RESPONSE_INVALID", "AUTOMATIC_REFRESH_WRITE_FAILED", "AUTOMATIC_REFRESH_BUDGET_STOP",
  "AUTOMATIC_REFRESH_RUN_LIMIT", "AUTOMATIC_REFRESH_DAY_CHANGED", "INVENTORY_RECONCILE_OBSERVATION_TIME_INVALID"]);

function taskGuard(db, task, id) {
  return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform IS ? AND cursor IS ? AND listing_id IS ?
      AND last_attempt_at IS ? AND status='pending') THEN 1 ELSE 0 END)`)
    .bind(id, task.task_key, task.platform, task.cursor, task.listing_id, task.last_attempt_at);
}
function releaseGuard(db, id) {return db.prepare("DELETE FROM sync_batch_guards WHERE guard_id=?").bind(id);}
function renewLease(db, store, now) {
  return db.prepare("UPDATE automatic_refresh_state SET lease_until=? WHERE singleton=1 AND lease_owner=? AND lease_until>?")
    .bind(iso(now + 10 * 60000), store.owner, iso(now));
}
async function postpone({db, store, now}, task, code, identity = false, delay = HOUR) {
  const id = crypto.randomUUID();
  await store.guarded([taskGuard(db, task, id), renewLease(db, store, now()),
    db.prepare(`UPDATE automatic_refresh_tasks SET status=?,next_due_at=?,last_attempt_at=?,failures=failures+1,
      last_error_code=? WHERE task_key=?`)
      .bind(identity ? "identity_error" : "pending", iso(now() + delay), iso(now()), code, task.task_key), releaseGuard(db, id)]);
}
function validateTask(task) {
  if (!["copart", "iaai"].includes(task.platform) || typeof task.cursor !== "string" || !/^\d{1,20}$/.test(task.cursor)
      || task.task_key !== `reconcile:${task.platform}:${task.cursor}`) throw Error("INVENTORY_RECONCILE_IDENTITY_INVALID");
}
function validateRaw(raw, task, known) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || String(raw.platform || "").toLowerCase() !== task.platform
      || String(raw.lot_number ?? raw.lot ?? "") !== task.cursor) throw Error("INVENTORY_RECONCILE_IDENTITY_MISMATCH");
  const vin = String(raw.vin || "").toUpperCase(), previous = String(known?.vin_normalized || "").toUpperCase();
  if (previous && (!vin || previous.length !== vin.length || [...previous].some((c, index) => /[A-HJ-NPR-Z0-9]/.test(c) && c !== vin[index]))) {
    throw Error("INVENTORY_RECONCILE_IDENTITY_MISMATCH");
  }
}

/** Only full detail observations can complete reconciliation. The injected
 * saveRecord is the existing automatic-refresh writer; its extra callback is
 * committed with the actual vehicle/snapshot transaction. A skipped observation
 * never receives a completed checkpoint or a fabricated freshness timestamp.
 * request owns durable request budgets, retries and provider error handling.
 */
async function processInventoryReconciliation({db, store, adapter, request, saveRecord, now = () => Date.now(), maxRequests = 2} = {}) {
  if (!db?.prepare || !db?.batch || store?.db !== db || typeof store?.guarded !== "function" || !store.owner
      || typeof adapter?.vehicleDetailRecord !== "function" || typeof request !== "function" || typeof saveRecord !== "function"
      || !Number.isSafeInteger(maxRequests) || maxRequests < 0 || maxRequests > 2) throw Error("INVENTORY_RECONCILE_CONFIG_INVALID");
  const report = {attempted: 0, completed: 0, deferred: 0, failed: 0, identityErrors: 0};
  if (maxRequests === 0) return report;
  const tasks = (await db.prepare(`SELECT * FROM automatic_refresh_tasks
    WHERE task_key LIKE 'reconcile:%' AND status='pending' AND next_due_at<=?
    ORDER BY failures,next_due_at,last_attempt_at,task_key LIMIT ?`).bind(iso(now()), maxRequests).all()).results;
  if (!Array.isArray(tasks)) throw Error("INVENTORY_RECONCILE_READ_INVALID");
  for (const task of tasks) {
    let known = null;
    try {
      validateTask(task);
      const rows = (await db.prepare(`SELECT l.*,s.provider,s.provider_vehicle_id FROM auction_listings l
        JOIN vehicle_sources s ON s.source_key=l.source_key WHERE l.platform=? AND l.lot=? LIMIT 2`)
        .bind(task.platform, task.cursor).all()).results;
      if (!Array.isArray(rows)) throw Error("INVENTORY_RECONCILE_READ_INVALID");
      if (rows.length > 1 || rows[0]?.provider && rows[0].provider !== "apibara"
          || task.listing_id !== null && rows[0]?.listing_id !== task.listing_id) throw Error("INVENTORY_RECONCILE_IDENTITY_MISMATCH");
      known = rows[0] || null;
      // Numeric LOT is supported by the provider when no full listing exists.
      // Every response is checked against both platform and LOT before saving.
      const identifier = known?.provider_vehicle_id || task.cursor;
      if (typeof identifier !== "string" || !identifier || identifier.length > 200) throw Error("INVENTORY_RECONCILE_IDENTITY_INVALID");
      await store.guarded([renewLease(db, store, now())]);
      report.attempted++;
      const {response, observedAt} = await request({operation: "vehicleByIdentifier", identifier, platform: task.platform}, known?.listing_id || null);
      if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > now()) {
        throw Error("INVENTORY_RECONCILE_OBSERVATION_TIME_INVALID");
      }
      const raw = adapter.vehicleDetailRecord(response); validateRaw(raw, task, known);
      let completionPrepared = false;
      await saveRecord(raw, task.platform, observedAt, known, record => {
        if (record?.vehicle?.platform !== task.platform || record.vehicle.lot !== task.cursor
            || !record.identity?.listingId || known && record.identity.listingId !== known.listing_id) {
          throw Error("INVENTORY_RECONCILE_IDENTITY_MISMATCH");
        }
        const id = crypto.randomUUID(); completionPrepared = true;
        return [taskGuard(db, task, id),
          ...(!known ? [db.prepare("UPDATE auction_listings SET detail_synced_at=? WHERE listing_id=?")
            .bind(observedAt, record.identity.listingId)] : []),
          db.prepare(`UPDATE automatic_refresh_tasks SET listing_id=?,status='complete',
          next_due_at=?,last_attempt_at=?,last_success_at=?,failures=0,last_error_code=NULL WHERE task_key=?`)
          .bind(record.identity.listingId, iso(now() + DAY), observedAt, observedAt, task.task_key), releaseGuard(db, id)];
      });
      if (completionPrepared) report.completed++;
      else {
        await postpone({db, store, now}, task, "INVENTORY_RECONCILE_DEFERRED"); report.deferred++;
      }
    } catch (error) {
      const code = codeOf(error);
      // Persistence uncertainty must escape immediately: do not follow a
      // possibly committed write with a second guessed checkpoint transition.
      if (code === "AUTOMATIC_REFRESH_WRITE_FAILED" || code === "INVENTORY_RECONCILE_READ_INVALID") throw error;
      if (IDENTITY_ERRORS.has(code)) {
        await postpone({db, store, now}, task, code, true, 7 * DAY); report.identityErrors++; continue;
      }
      if (code === "NOT_FOUND") {
        await postpone({db, store, now}, task, code, false, 7 * DAY); report.failed++; continue;
      }
      if (SYSTEM_ERRORS.has(code)) {
        if (!["AUTOMATIC_REFRESH_BUDGET_STOP", "AUTOMATIC_REFRESH_RUN_LIMIT", "AUTOMATIC_REFRESH_DAY_CHANGED"].includes(code)) {
          await postpone({db, store, now}, task, code);
        }
        throw error;
      }
      throw error;
    }
  }
  return report;
}

module.exports = {processInventoryReconciliation};
