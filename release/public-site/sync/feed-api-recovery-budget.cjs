'use strict';

// One owner-authorized catch-up allowance. Uses existing tables and the same
// RefreshStore lease fence; never raises the ordinary day/month limit_count.
const {randomUUID} = require('node:crypto');
const ID = '2026-10-31-gap', THROUGH = 51292006, MAX = 12000, RESERVE = 10000;
const integer = n => Number.isSafeInteger(n) && n >= 0;
const fail = code => {throw Object.assign(Error(code), {code});};
const REFRESH_ATTEMPTS = 200;
async function recoveryAttemptCount(db, checkedAt) {
  const row=await db.prepare(`SELECT COUNT(*) AS count FROM
    (SELECT 1 FROM automatic_refresh_attempts WHERE attempted_at>=? LIMIT 201)`).bind(checkedAt).first();
  if (!integer(row?.count) || row.count>201) fail('SERVER_FEED_API_QUOTA_INVALID');
  return row.count;
}
function configuration(env) {
  const id = env?.REXBID_FEED_API_RECOVERY_ID;
  if (id === undefined || id === '') return null;
  const limit = Number(env.REXBID_FEED_API_RECOVERY_LIMIT), through = Number(env.REXBID_FEED_API_RECOVERY_THROUGH);
  if (id !== ID || !integer(limit) || limit < 1 || limit > MAX || through !== THROUGH)
    fail('SERVER_FEED_RECOVERY_CONFIG');
  return {id, limit, through, key: `feed-api-recovery:${id}`};
}
function parseReceipt(row, config) {
  let value; try {value = JSON.parse(row?.cursor);} catch {fail('SERVER_FEED_RECOVERY_RECEIPT');}
  if (!value || Object.keys(value).sort().join(',') !== 'id,startAfter,through,version'
      || value.version !== 1 || value.id !== config.id || value.through !== config.through
      || !integer(value.startAfter) || value.startAfter >= value.through
      || row.platform !== 'all' || row.listing_id !== null || !['pending','complete'].includes(row.status))
    fail('SERVER_FEED_RECOVERY_RECEIPT');
  return value;
}
async function recoveryBudget({env, db, store, now}) {
  const config = configuration(env);
  if (!config) return null;
  if (store?.db !== db || typeof store.guarded !== 'function' || !store.owner || typeof now !== 'function')
    fail('SERVER_FEED_RECOVERY_CONFIG');
  let row = await db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').bind(config.key).first();
  if (!row) {
    const state = await db.prepare('SELECT committed_sequence FROM server_feed_state WHERE singleton=1').bind().first();
    if (!integer(state?.committed_sequence)) fail('SERVER_FEED_RECOVERY_RECEIPT');
    if (state.committed_sequence >= config.through) return null;
    const at = new Date(now()).toISOString(), cursor = JSON.stringify({version:1,id:config.id,startAfter:state.committed_sequence,through:config.through});
    await store.guarded([
      db.prepare(`INSERT OR IGNORE INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,status)
        SELECT ?,'all',?,?,?,'pending' WHERE EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND committed_sequence=? AND active_generation IS NULL)`)
        .bind(config.key,cursor,at,at,state.committed_sequence),
      db.prepare(`INSERT OR IGNORE INTO automatic_refresh_budgets(budget_key,limit_count,consumed,created_at,updated_at)
        SELECT ?,?,0,?,? WHERE EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND cursor=?)`)
        .bind(config.key,config.limit,at,at,config.key,cursor)
    ]);
    row = await db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').bind(config.key).first();
  }
  const receipt = parseReceipt(row,config);
  const counter = await db.prepare('SELECT limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key=?').bind(config.key).first();
  if (!integer(counter?.limit_count) || counter.limit_count < 1 || counter.limit_count > MAX || !integer(counter.consumed))
    fail('SERVER_FEED_RECOVERY_RECEIPT');
  if (row.status==='complete') return null;
  const current=await db.prepare('SELECT committed_sequence FROM server_feed_state WHERE singleton=1').bind().first();
  if (!integer(current?.committed_sequence)) fail('SERVER_FEED_RECOVERY_RECEIPT');
  if (current.committed_sequence>=receipt.through) {
    await store.guarded([db.prepare(`UPDATE automatic_refresh_tasks SET status='complete',last_success_at=? WHERE task_key=? AND cursor=?
      AND EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND committed_sequence>=?)`)
      .bind(new Date(now()).toISOString(),config.key,row.cursor,receipt.through)]);
    return null;
  }
  // Tightening an authorized allowance is possible; restarting cannot enlarge it.
  if (config.limit < counter.limit_count) await store.guarded([
    db.prepare('UPDATE automatic_refresh_budgets SET limit_count=MIN(limit_count,?) WHERE budget_key=?').bind(config.limit,config.key)
  ]);
  async function reserve(spec) {
    if (!['vehicleChanges','apiUsage'].includes(spec?.operation)) fail('SERVER_FEED_RECOVERY_OPERATION');
    const file = await db.prepare('SELECT committed_sequence,active_generation FROM server_feed_state WHERE singleton=1').bind().first();
    if (!integer(file?.committed_sequence)) fail('SERVER_FEED_RECOVERY_RECEIPT');
    if (file.committed_sequence >= receipt.through) {
      await store.guarded([db.prepare(`UPDATE automatic_refresh_tasks SET status='complete',last_success_at=? WHERE task_key=? AND cursor=?
        AND EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND committed_sequence>=?)`)
        .bind(new Date(now()).toISOString(),config.key,row.cursor,receipt.through)]);
      fail('SERVER_FEED_RECOVERY_COMPLETE');
    }
    if (file.active_generation !== null || file.committed_sequence < receipt.startAfter
        || spec.operation === 'vehicleChanges' && (!integer(spec.after) || spec.after !== file.committed_sequence || spec.after >= receipt.through || ![500,100,25].includes(spec.limit)))
      fail('SERVER_FEED_RECOVERY_SCOPE');
    const at = new Date(now()).toISOString(), day = `day:${at.slice(0,10)}`, month = `month:${at.slice(0,7)}`, id = randomUUID();
    // Every possible fetch is durably counted in BOTH ordinary account counters
    // and the non-resetting allowance before transport, even on error/timeout.
    // Cached provider usage is debited for every attempt since its observation.
    // A normal recovery page never uses a saturated/truncated count. It must
    // refresh usage first. Usage itself may scan an older, pre-activation window
    // once to retain an exact reserve check; subsequent windows are <=200.
    const countSql=spec.operation==='apiUsage'
      ? 'SELECT COUNT(*) FROM automatic_refresh_attempts WHERE attempted_at>=s.quota_checked_at'
      : 'SELECT COUNT(*) FROM (SELECT 1 FROM automatic_refresh_attempts WHERE attempted_at>=s.quota_checked_at LIMIT 201)';
    const result = await store.guarded([
      db.prepare(`INSERT INTO automatic_refresh_attempts(attempt_id,operation,platform,attempted_at)
        SELECT ?,?,NULL,? WHERE EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key=? AND consumed<limit_count)
        AND (SELECT COUNT(*) FROM automatic_refresh_budgets WHERE budget_key IN (?,?))=2
        AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND status='pending' AND cursor=?)
        AND EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND committed_sequence=? AND active_generation IS NULL AND committed_sequence<?)
        AND EXISTS(SELECT 1 FROM automatic_refresh_state s WHERE singleton=1 AND quota_checked_at IS NOT NULL
          AND quota_allowance>0 AND quota_left-1-(${countSql})>?
          AND (?=1 OR (SELECT COUNT(*) FROM (SELECT 1 FROM automatic_refresh_attempts WHERE attempted_at>=s.quota_checked_at LIMIT 201))<200))`)
        .bind(id,spec.operation,at,config.key,day,month,config.key,row.cursor,file.committed_sequence,receipt.through,RESERVE,spec.operation==='apiUsage'?1:0),
      db.prepare(`UPDATE automatic_refresh_budgets SET consumed=consumed+1,updated_at=? WHERE budget_key IN (?,?,?)
        AND EXISTS(SELECT 1 FROM automatic_refresh_attempts WHERE attempt_id=?)`).bind(at,day,month,config.key,id),
      db.prepare(`UPDATE automatic_refresh_state SET quota_allowance=MAX(0,quota_allowance-1) WHERE singleton=1
        AND EXISTS(SELECT 1 FROM automatic_refresh_attempts WHERE attempt_id=?)`).bind(id)
    ]);
    const changes = result?.[1]?.meta?.changes ?? result?.[1]?.changes;
    if (changes !== 1) fail('SERVER_FEED_RECOVERY_BUDGET_STOP');
    return id;
  }
  return {reserve};
}
module.exports = {recoveryBudget,configuration,recoveryAttemptCount,REFRESH_ATTEMPTS};
