
'use strict';

const {randomUUID} = require('node:crypto');
const {POLICY} = require('./automatic-refresh.cjs');
const {prepareInventoryPage} = require('./inventory-page.cjs');
const {commitInventoryBatch} = require('./inventory-commit.cjs');

const TASK = 'feed-open-coverage:iaai:v1';
const RECEIPT = 'feed-open-coverage:last-insert:iaai:v1';
const RETRY = 'feed-open-coverage:deferred:iaai:v1';
const PLATFORM = 'iaai';
const PAGE_SIZE = 20;
const PAGE_INTERVAL = 15 * 60_000;
const RESTART_INTERVAL = 60 * 60_000;
const SCAN_LIMIT = 96;

function isCandidate(record, now, observedAt) {
  const auction = record?.auction;
  if (record?.platform !== PLATFORM || auction?.state !== 'open' ||
      !/^\d{1,20}$/.test(String(record.lot_number ?? record.lot ?? '')) ||
      !/^[A-HJ-NPR-Z0-9]{17}$/i.test(record.vin ?? '') ||
      auction.result_confirmed || auction.lot_removed) return false;
  const updated = Date.parse(record.updated_at);
  const endText = auction.timed_end_at || auction.auction_at || auction.full_date;
  if (typeof endText !== 'string' || !/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i.test(endText)) return false;
  return Number.isFinite(updated) && updated <= observedAt && Date.parse(endText) > now;
}

async function reconcileOpenIaai({db, store, adapter, getRequest, now}) {
  const task = await store.task(TASK);
  const started = now();
  if (Date.parse(task?.next_due_at) > started) return null;

  // A backoff can make queued work invisible to the dispatcher. Read the
  // latest stored generation directly and require a settled publication.
  const published = await db.prepare('SELECT g.status,g.observed_at,s.committed_sequence,p.baseline_id FROM server_feed_generations g CROSS JOIN server_feed_state s CROSS JOIN feed_catalog_pointer p WHERE s.singleton=1 AND p.singleton=1 AND s.active_generation IS NULL AND g.last_sequence=s.committed_sequence AND g.generation_id=(SELECT MAX(generation_id) FROM server_feed_generations)').bind().first();
  const sourceAt = Date.parse(published?.observed_at);
  if (published?.status !== 'complete' || typeof published.baseline_id !== 'string' ||
      !Number.isSafeInteger(published.committed_sequence) || !Number.isFinite(sourceAt) ||
      sourceAt > started || started - sourceAt > 75 * 60_000) return null;

  const cursor = task?.cursor && task.scan_pages < SCAN_LIMIT &&
    started - Date.parse(task.scan_started_at) < 36 * 60 * 60_000 ? task.cursor : null;
  const scanStartedAt = cursor || task?.scan_pages === 0 && task.scan_started_at
    ? task.scan_started_at : new Date(started).toISOString();
  const pages = cursor ? task.scan_pages : 0;
  const checkpoint = (options) => store.taskStatement({key:TASK,platform:PLATFORM,...options});
  const priorWait = await store.task(RETRY);
  const marker = JSON.stringify([scanStartedAt,pages]);
  const waitKey = JSON.stringify([marker,published.committed_sequence]);
  const waitingForPage = priorWait?.cursor === waitKey || priorWait?.cursor?.startsWith(JSON.stringify([marker]).slice(0,-1)+',');
  if (priorWait?.cursor === waitKey && started < Date.parse(priorWait.next_due_at)) return null;
  let response, observedAt;
  try {
    const request = await getRequest();
    ({response, observedAt} = await request({operation:'listVehicles',
      params:{platform:PLATFORM,lot_sub_status:'Open',per_page:PAGE_SIZE,...(cursor ? {cursor} : {})}}));
  } catch (error) {
    const code = error.code || error.message;
    const expired = code === 'CURSOR_EXPIRED';
    const reason = typeof code === 'string' && /^[A-Z_]{2,64}$/.test(code) ? code : 'FEED_OPEN_COVERAGE_REQUEST_FAILED';
    await store.guarded([checkpoint({cursor:expired ? null : cursor,scanStartedAt:expired ? null : scanStartedAt,
      scanPages:expired ? 0 : pages,due:now()+RESTART_INTERVAL,status:'partial',error:reason})]);
    return {error:reason};
  }

  const meta = adapter.responseMeta(response);
  const next = meta?.next_cursor;
  const data = response?.response?.data ?? response?.data;
  const records = adapter.vehicleListRecords(response);
  if (!(Array.isArray(data) || Array.isArray(data?.vehicles)) ||
      meta?.applied_filters?.platform !== PLATFORM || meta.applied_filters.lot_sub_status !== 'Open' ||
      !Array.isArray(records) || records.length > PAGE_SIZE ||
      (next !== null && (typeof next !== 'string' || !next || next.length > 4096 || next === cursor))) {
    await store.guarded([checkpoint({cursor,scanStartedAt,scanPages:pages,due:now()+RESTART_INTERVAL,
      status:'partial',error:'FEED_OPEN_COVERAGE_INVALID_PAGE'})]);
    return {error:'FEED_OPEN_COVERAGE_INVALID_PAGE'};
  }

  const candidates = records.filter(record => isCandidate(record, now(), Date.parse(observedAt)));
  const newer = candidates.filter(record => Date.parse(record.updated_at) > sourceAt);
  let deferred = false;
  if (newer.length && !waitingForPage) {
    const lots = newer.map(record => String(record.lot_number ?? record.lot));
    const found = await db.prepare("SELECT l.lot FROM json_each(?) x CROSS JOIN auction_listings l ON l.platform='iaai' AND l.lot=x.value")
      .bind(JSON.stringify(lots)).all();
    if (!Array.isArray(found.results)) throw Error('FEED_OPEN_COVERAGE_READ_FAILED');
    const known = new Set(found.results.map(row => String(row.lot)));
    deferred = lots.some(lot => !known.has(lot));
  }
  // A rejected row does not affect the provider's cursor or alter known listings.
  const normalized = await prepareInventoryPage({db,provider:adapter,platform:PLATFORM,records:candidates.filter(record => Date.parse(record.updated_at) <= sourceAt),
    observedAt,processedAt:new Date(now()).toISOString(),freshnessPolicy:POLICY,observationTimeBasis:'source_updated_at'});
  const prepared = normalized.prepared.filter(item => item.inserted && item.record.vehicle.auction?.state === 'open');
  const savesCursor = checkpoint({cursor:deferred ? cursor : next,
    scanStartedAt:deferred || next ? scanStartedAt : null,scanPages:deferred ? pages : pages+1,
    scanErrors:(cursor ? task.scan_errors : 0)+normalized.rejected.length,
    due:now()+(deferred || next ? PAGE_INTERVAL : RESTART_INTERVAL),
    status:deferred || next ? 'partial' : 'complete',success:true});
  const checkpointStatements = [savesCursor];
  if (deferred) checkpointStatements.push(store.taskStatement({key:RETRY,platform:PLATFORM,cursor:waitKey,
    due:now()+RESTART_INTERVAL,status:'partial',success:true}));
  if (prepared.length) {
    const membership = db.prepare("INSERT INTO feed_catalog_membership(baseline_id,listing_id,active,last_sequence) SELECT ?,l.listing_id,1,? FROM json_each(?) x CROSS JOIN auction_listings l ON l.listing_id=x.value WHERE l.auction_state='open' AND l.identity_state='resolved'")
      .bind(published.baseline_id,published.committed_sequence,JSON.stringify(prepared.map(item=>item.record.identity.listingId)));
    const guardId = randomUUID();
    const publicationFence = db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(
      SELECT 1 FROM server_feed_state s CROSS JOIN feed_catalog_pointer p
      WHERE s.singleton=1 AND p.singleton=1 AND s.active_generation IS NULL AND s.committed_sequence=? AND p.baseline_id=?
    ) THEN 1 ELSE 0 END)`).bind(guardId,published.committed_sequence,published.baseline_id);
    const releaseFence = db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(guardId);
    const receipt = store.taskStatement({key:RECEIPT,platform:PLATFORM,
      cursor:JSON.stringify({sequence:published.committed_sequence,page:pages+1,lots:prepared.map(item=>item.record.vehicle.lot)}),
      scanPages:pages+1,due:now(),status:'complete',success:true});
    await commitInventoryBatch({db,store,prepared,checkpointStatements:[publicationFence,membership,...checkpointStatements,receipt,releaseFence]});
  } else {
    await store.guarded(checkpointStatements);
  }
  return {scanned:records.length,inserted:prepared.length,rejected:normalized.rejected.length,deferred,sequence:published.committed_sequence};
}

module.exports = {reconcileOpenIaai, TASK};

