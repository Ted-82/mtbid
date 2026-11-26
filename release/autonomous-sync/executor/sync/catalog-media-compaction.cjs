'use strict';

const {packedColumn} = require('./catalog-media-storage.cjs');
const TASK = 'catalog-media-v1:backfill';
const PAGE_SIZE = 384;
const FULL = packedColumn('media_urls_json');
const THUMBS = packedColumn('media_thumbs_json');

async function compactCatalogMedia({db, store, now}) {
  const saved = await db.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(TASK).first();
  const progress = saved ? JSON.parse(saved.cursor) : {after: 0, done: false};
  if (!Number.isSafeInteger(progress.after) || progress.after < 0 || typeof progress.done !== 'boolean') {
    throw Error('SERVER_FEED_MEDIA_COMPACTION_CURSOR');
  }
  if (progress.done) return null;
  const result = await db.prepare(`SELECT rowid FROM auction_listings
    WHERE rowid>? ORDER BY rowid LIMIT ${PAGE_SIZE}`).bind(progress.after).all();
  const after = result.results.at(-1)?.rowid ?? progress.after;
  const done = result.results.length < PAGE_SIZE;
  const at = new Date(now()).toISOString();
  const statements = [];
  if (after > progress.after) {
    statements.push(db.prepare(`UPDATE auction_listings
      SET media_urls_json=${FULL}, media_thumbs_json=${THUMBS}
      WHERE rowid>? AND rowid<=?
        AND (${FULL} IS NOT media_urls_json OR ${THUMBS} IS NOT media_thumbs_json)`).bind(progress.after, after));
  }
  statements.push(db.prepare(`INSERT INTO automatic_refresh_tasks
    (task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
    VALUES (?,'all',?,?,?,?,'complete') ON CONFLICT(task_key) DO UPDATE SET
    cursor=excluded.cursor,last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at`)
    .bind(TASK,JSON.stringify({after,done}),at,at,at));
  await store.guarded(statements);
  return {after, scanned: result.results.length, done};
}

module.exports = {compactCatalogMedia};
