'use strict';
const {createHash}=require('node:crypto');

const PRIMARY='pricing.current_bid_usd';
const BID_FIELDS=new Set([PRIMARY,'pricing.previous_bid_usd']);
const PREFIX='feed-timed-bid:v1:';
const timestamp=value=>typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;
const validVin=value=>typeof value==='string'&&/^[A-HJ-NPR-Z0-9]{17}$/.test(value);
function timedCycleId(row,sourceCycle,deadline){
  const identity=[row.listing_id,row.platform,row.lot,row.vin_normalized,row.listing_generation??null,sourceCycle,deadline];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

// This is an observation of an amount received after an explicit Timed deadline.
// It says nothing about a completed sale, or when the customer placed the bid.
function lateBidObservation(row,event,sourceCycle=null){
  if(!row||!event||!['copart','iaai'].includes(row.platform)||row.is_timed!==1||
    !['open','live','timed'].includes(row.auction_state)||typeof row.listing_id!=='string'||
    row.identity_state!=='resolved'||!validVin(row.vin_normalized)||row.vin_normalized!==event.vin||
    row.platform!==event.platform||row.lot!==event.lotNumber||event.eventType!=='bid.changed'||
    event.terminal!==false||!Number.isSafeInteger(event.sequence)||event.sequence<1)return null;
  // Mixed events can close or reschedule the very auction that the price
  // appears to describe. Let the usual canonical import reconcile those.
  const fields=[...(event.changedFields??[]),...Object.keys(event.after??{}),...Object.keys(event.before??{})];
  if(fields.some(field=>!BID_FIELDS.has(field)))return null;
  const bid=event.after?.[PRIMARY],before=event.before?.[PRIMARY];
  if(typeof bid!=='number'||!Number.isFinite(bid)||bid<=0||bid>Number.MAX_SAFE_INTEGER||
    !Object.hasOwn(event.before||{},PRIMARY)||(before!==null&&(!Number.isFinite(before)||before<0))||
    (before===0?null:before)!==(row.current_bid_usd===0?null:row.current_bid_usd)||before===bid)return null;
  const end=timestamp(row.timed_end_at),at=timestamp(event.recordedAt),version=timestamp(event.vehicleUpdatedAt);
  if(!Number.isFinite(end)||!Number.isFinite(at)||!Number.isFinite(version)||at<end||version>at)return null;
  if(sourceCycle!=null&&(typeof sourceCycle!=='string'&&!Number.isSafeInteger(sourceCycle)||
    !String(sourceCycle).trim()||String(sourceCycle).length>128))return null;
  const cycle=sourceCycle==null?null:String(sourceCycle);
  // If the feed provides no auction ID, require the source vehicle version to
  // have reached this deadline and the event's previous balance to match.
  if(cycle===null&&(row.listing_generation!=null||version<end))return null;
  let previous=null;
  try {previous=JSON.parse(row.timed_bid_evidence??'null');}
  catch {return null;}
  // An upstream auction ID is opaque. A local listing generation is a
  // different identifier. Bind them only through earlier evidence for this
  // exact listing, deadline and generation, including when a relist repeats VIN.
  if(cycle!==null&&(previous?.cycle==null||String(previous.cycle)!==cycle))return null;
  if(previous&&(previous.vin!==row.vin_normalized||timestamp(previous.end)!==end||
    (previous.gen??null)!==(row.listing_generation??null)||previous.cycle!=null&&String(previous.cycle)!==cycle||
    !Number.isSafeInteger(previous.seq)||event.sequence<=previous.seq||at<timestamp(previous.at)))return null;
  const deadline=new Date(end).toISOString();
  const slot=PREFIX+timedCycleId(row,cycle,deadline)+':';
  return {listingId:row.listing_id,platform:row.platform,lot:row.lot,vin:row.vin_normalized,
    end:deadline,at:new Date(at).toISOString(),bid,sequence:event.sequence,
    slot,fingerprint:slot+String(event.sequence).padStart(16,'0')};
}

// Normal snapshots and earlier source observations are immutable. Replaying a
// source observation has zero effect. The lookup binds both columns of the
// existing index, including when a second bid is observed in the same second.
const SQL=`INSERT INTO auction_listing_snapshots
    (listing_id,observed_at,timed_end_at,current_bid_usd,fingerprint)
  SELECT json_extract(j.value,'$.listingId'),json_extract(j.value,'$.at'),json_extract(j.value,'$.end'),
    json_extract(j.value,'$.bid'),json_extract(j.value,'$.fingerprint')
  FROM json_each(?) j WHERE NOT EXISTS(
    SELECT 1 FROM auction_listing_snapshots s INDEXED BY idx_listing_snapshots_recent
    WHERE s.listing_id=json_extract(j.value,'$.listingId') AND s.observed_at=json_extract(j.value,'$.at')
      AND s.fingerprint=json_extract(j.value,'$.fingerprint'))`;
function historyStatement(db,observations){
  const rows=observations.map(({listingId,at,end,bid,fingerprint})=>({listingId,at,end,bid,fingerprint}));
  return db.prepare(SQL).bind(JSON.stringify(rows));
}
module.exports={lateBidObservation,historyStatement,timedCycleId,SQL};
