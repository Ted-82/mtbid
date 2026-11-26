'use strict';

const hasVin = v => typeof v === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/.test(v);
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  const day = value.slice(0, 10), midnight = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0, 10) === day ? Date.parse(value) : NaN;
}

// A dated reschedule is sufficient to request a verification. It cannot itself
// reopen an ended lot or confirm a bid. Keep the durable feed sequence separate
// from the source record's version and from the time of its later observation.
function relistEvidence(group, observedAt) {
  if (!['copart','iaai'].includes(group?.platform) || !/^\d{1,20}$/.test(group.lot) || group.quarantinedSequences?.length) return null;
  let evidence = null;
  for (const e of group.events ?? []) {
    if (e.vehicle?.platform !== group.platform || String(e.vehicle.lot_number) !== group.lot || !hasVin(e.vehicle.vin) ||
        e.terminal || ['auction.ended','lot.sold','lot.removed','lot.not_sold'].includes(e.event)) { evidence = null; continue; }
    if (e.event !== 'auction.rescheduled') continue;
    const date = e.after?.['auction.auction_at'], recorded = instant(e.recorded_at), version = instant(e.vehicle_updated_at || e.recorded_at);
    if (!Number.isSafeInteger(e.sequence) || e.sequence < 1 || !Number.isFinite(recorded) || !Number.isFinite(version) ||
        recorded > instant(observedAt) || version > instant(observedAt) ||
        !(instant(date) > instant(observedAt)) || e.after['auction.auction_date_pending'] === true ||
        e.after['auction.lot_removed'] || e.after['auction.result_confirmed']) { evidence = null; continue; }
    evidence = { sequence:e.sequence, date, recordedAt:e.recorded_at, version:new Date(version).toISOString(), vin:e.vehicle.vin };
    if(typeof e.auction_id==='string'&&e.auction_id.length<=128)evidence.auctionId=e.auction_id;
  }
  return evidence;
}

function verifiedRelist(row, member, evidence, raw, observedAt, now) {
  const sourceTime = instant(raw?.updated_at), observed = instant(observedAt), nowTime = Number(now);
  if (!row || !['copart','iaai'].includes(row.platform) || !hasVin(row.vin_normalized) || row.identity_state !== 'resolved' ||
      row.auction_state !== 'ended' || !member || member.active !== 0 || !Number.isSafeInteger(member.last_sequence) ||
      !evidence || !Number.isSafeInteger(evidence.sequence) || member.last_sequence >= evidence.sequence) return null;
  for(const stamp of [row.source_updated_at])
    if(stamp != null && !(instant(stamp) <= sourceTime)) return null;
  for(const stamp of [row.summary_synced_at,row.detail_synced_at,row.last_seen_at])
    if(stamp != null && !(instant(stamp) <= observed)) return null;
  return verifiedSource(row.platform,row.lot,row.vin_normalized,evidence,raw,observedAt,nowTime);
}
function verifiedSource(platform,lot,vin,evidence,raw,observedAt,nowTime) {
  const auction=raw?.auction,price=raw?.pricing,sourceTime=instant(raw?.updated_at),observed=instant(observedAt);
  const date=instant(auction?.auction_at),signal=instant(evidence?.date);
  const cycle=auction?.auction_id??raw?.auction_id;
  if(evidence?.auctionId!=null && cycle!==evidence.auctionId)return null;
  if(!['copart','iaai'].includes(platform)||!hasVin(vin)||!evidence||raw?.platform!==platform||String(raw.lot_number)!==lot||raw.vin!==vin||
      raw.vin !== evidence.vin || !Number.isFinite(nowTime) || !Number.isFinite(observed) || observed > nowTime || nowTime-observed>60000 || !Number.isFinite(sourceTime) ||
      !(sourceTime >= instant(evidence.version)) || sourceTime > observed || !(instant(auction?.auction_at) > nowTime) ||
      date !== signal || auction.state !== 'open' || auction.phase !== 'scheduled' ||
      auction.result_confirmed !== false || auction.lot_removed !== false || auction.is_timed !== false ||
      auction.auction_date_pending !== false || auction.outcome_status != null || auction.completion_source != null) return null;
  const priceValue = x => x == null || (typeof x === 'number' && Number.isFinite(x) && x >= 0);
  if(!price || ![price.current_bid_usd,price.current_bid2_usd,price.buy_now_usd].every(priceValue)) return null;
  return { auction_at:new Date(instant(auction.auction_at)).toISOString(), auction_state:'open', source_status:'Open',
    current_bid_usd:price.current_bid_usd > 0 ? price.current_bid_usd : null, current_bid2_usd:price.current_bid2_usd > 0 ? price.current_bid2_usd : null,
    buy_now_usd:auction.is_buy_now === true && price.buy_now_usd > 0 ? price.buy_now_usd : null };
}
async function restoreVerifiedRelist({db,store,published,task,c,raw,observedAt,now,checkpoint}){
  const found=(await db.prepare(`SELECT l.*,s.provider,s.identity_state AS source_identity_state,
   m.active AS member_active,m.last_sequence AS member_sequence
   FROM auction_listings l JOIN vehicle_sources s ON s.source_key=l.source_key AND s.platform=l.platform
   JOIN feed_catalog_membership m ON m.listing_id=l.listing_id AND m.baseline_id=?
   WHERE l.platform=? AND l.lot=? LIMIT 2`).bind(published.baseline_id,c.platform,c.lot).all()).results;
  const row=found.length===1 ? found[0] : null;
  const member=row?{active:row.member_active,last_sequence:row.member_sequence}:null;
  const patch=verifiedRelist(row,member,c.relist,raw,observedAt,now());
  if(!patch || row.provider!=='apibara'||row.source_identity_state!=='resolved'||
      row.final_price_usd!=null||row.source_price_usd!=null){
    const permanent=!row || member?.active===1 || member?.last_sequence>=c.relist.sequence ||
      raw.auction?.result_confirmed===true || raw.auction?.lot_removed===true || instant(c.relist.date)<=now();
    const retry=3600000;
    await store.guarded([checkpoint(permanent?'complete':'pending',{outcome:permanent?'superseded_or_ended':'relist_unconfirmed'},retry)]);
    return {platform:c.platform,lot:c.lot,skipped:true};
  }
  // Retain a newer documented price received in the same journal cycle after
  // the reschedule. For an initial/recovered hint no old-cycle bid is promoted.
  for(const name of ['current_bid_usd','current_bid2_usd','buy_now_usd']){
    const entry=c.prices?.[name];
    if(instant(raw.auction.auction_at)===instant(c.relist.date) && entry && entry.sequence>=c.relist.sequence && instant(entry.version)>instant(raw.updated_at) &&
      (name!=='buy_now_usd'||raw.auction.is_buy_now===true)){
      patch[name]=typeof entry.value==='number'&&entry.value>0 ? entry.value : null;
    }
  }
  const id=require('node:crypto').randomUUID(), columns=Object.keys(patch);
  // Publish the API source version with its fields. The incremental reducer
  // rejects older source versions when delayed files arrive.
  patch.source_updated_at=raw.updated_at;
  patch.detail_synced_at=observedAt;
  patch.last_seen_at=observedAt;
  columns.push('source_updated_at','detail_synced_at','last_seen_at');
  // A complete, identity-verified response already paid for during relisting
  // can also fill an empty gallery. Do not spend a second request for its URLs.
  if(row.media_urls_json==null&&row.media_thumbs_json==null){
    const media=require('../providers/apibara.js').apibaraPhotoFields(raw.media);
    const {packMediaJson}=require('./catalog-media-storage.cjs');
    if(media.items.length){patch.media_urls_json=packMediaJson(JSON.stringify(media.items));columns.push('media_urls_json');}
    if(media.thumbs.length){patch.media_thumbs_json=packMediaJson(JSON.stringify(media.thumbs));columns.push('media_thumbs_json');}
  }
  const oldColumns=['vin_normalized','auction_state','source_status','auction_at','source_updated_at','summary_synced_at',
     'detail_synced_at','last_seen_at','updated_at','current_bid_usd','current_bid2_usd','buy_now_usd','final_price_usd','source_price_usd','media_urls_json','media_thumbs_json'];
  const guard=db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
     EXISTS(SELECT 1 FROM server_feed_state s JOIN feed_catalog_pointer p ON s.singleton=p.singleton
       WHERE s.singleton=1 AND s.active_generation IS NULL AND s.committed_sequence=? AND p.baseline_id=?) AND
     EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND cursor=? AND status='pending') AND
     EXISTS(SELECT 1 FROM feed_catalog_membership WHERE baseline_id=? AND listing_id=? AND active=0 AND last_sequence=?) AND
     EXISTS(SELECT 1 FROM auction_listings WHERE listing_id=? AND ${oldColumns.map(k=>k+' IS ?').join(' AND ')})
     THEN 1 ELSE 0 END)`).bind(id,published.committed_sequence,published.baseline_id,task.task_key,task.cursor,
       published.baseline_id,row.listing_id,member.last_sequence,row.listing_id,...oldColumns.map(k=>row[k]));
  await store.guarded([guard,
    db.prepare(`UPDATE auction_listings SET ${columns.map(k=>k+'=?').join(',')},is_timed=0,timed_end_at=NULL WHERE listing_id=?`).bind(...Object.values(patch),row.listing_id),
    db.prepare('UPDATE feed_catalog_membership SET active=1,last_sequence=? WHERE baseline_id=? AND listing_id=?').bind(c.relist.sequence,published.baseline_id,row.listing_id),
    checkpoint('complete',{outcome:'relisted',sourceVersion:raw.updated_at,verifiedAt:observedAt,
     verifiedFields:['auction_at','auction_state','source_status','current_bid_usd','current_bid2_usd','buy_now_usd'],verifiedThrough:published.committed_sequence}),
    db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id)]);
  return {platform:c.platform,lot:c.lot,relisted:true};
}
module.exports = { relistEvidence, verifiedRelist, verifiedSource, restoreVerifiedRelist };
