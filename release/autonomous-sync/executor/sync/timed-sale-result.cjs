'use strict';
const {timedCycleId}=require('./timed-bid-history.cjs');
const {createHash}=require('node:crypto');
const PREFIX='feed-timed-result:v1:';
const FIELDS=['details.sale_status','auction.lot_sold','auction.has_status','auction.sold_timed',
  'auction.last_sold_day','auction.last_sold_status','pricing.last_sold_price_usd','pricing.sold_price_usd'];
const timestamp=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)?Date.parse(x):NaN;
const flag=(x,n)=>x===n||x===String(n)||x===Boolean(n);
function price(x){
  if(typeof x!=='number'&&!(typeof x==='string'&&/^\d+(?:\.\d{1,2})?$/.test(x)))return null;
  const n=Number(x);return Number.isFinite(n)&&n>0&&n<=Number.MAX_SAFE_INTEGER/100?n:null;
}
function confirmedTimedSale(row,raw){
  if(row?.platform!=='iaai'||row.is_timed!==1||!['open','live','timed'].includes(row.auction_state)||
    row.identity_state!=='resolved'||!row.listing_id||!row.source_key||!/^\d+$/.test(row.lot)||
    !/^[A-HJ-NPR-Z0-9]{17}$/.test(row.vin_normalized)||raw?.vehicle?.vin!==row.vin_normalized||
    raw.vehicle.platform!==row.platform||raw.vehicle.lot_number!==row.lot||raw.event!=='lot.sold'||
    raw.terminal!==true||raw.reason!=='source_outcome'||!Number.isSafeInteger(raw.sequence)||raw.sequence<1||
    raw.event_id!=='chg_'+raw.sequence)return null;
  const a=raw.after,b=raw.before,fields=raw.changed_fields;
  if(!a||!b||!Array.isArray(fields)||!FIELDS.every(f=>fields.includes(f)&&Object.hasOwn(a,f))||
    [...fields,...Object.keys(a),...Object.keys(b)].some(f=>!FIELDS.includes(f)))return null;
  if(a['details.sale_status']!=='IAAI direct check: Sold via Timed Auction'||a['auction.last_sold_status']!=='Sold'||
    !['auction.lot_sold','auction.sold_timed','auction.has_status'].every(f=>flag(a[f],1)&&flag(b[f],0))||
    b['auction.last_sold_status']!==null||b['auction.last_sold_day']!==null||b['pricing.last_sold_price_usd']!==null||
    ![null,0,'0'].includes(b['pricing.sold_price_usd']))return null;
  const amount=price(a['pricing.sold_price_usd']),day=a['auction.last_sold_day'];
  const end=timestamp(row.timed_end_at),at=timestamp(raw.recorded_at),sourceAt=timestamp(raw.vehicle_updated_at);
  if(!amount||amount!==price(a['pricing.last_sold_price_usd'])||!Number.isFinite(end)||!Number.isFinite(at)||
    !Number.isFinite(sourceAt)||sourceAt<end||sourceAt>at||typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day))return null;
  const deadline=new Date(end).toISOString();
  // The upstream day is a calendar date, not the timestamp of an executed sale.
  const usDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(end);
  if(day!==deadline.slice(0,10)&&day!==usDay)return null;
  const id=raw.auction_id??raw.record?.auction?.auction_id??null;
  if(id!==null&&(!(typeof id==='string'||Number.isSafeInteger(id))||!String(id).trim()||String(id).length>128))return null;
  const cycle=id===null?null:String(id);let prior=null;
  try{prior=JSON.parse(row.timed_bid_evidence??'null');}catch{return null;}
  if(cycle===null&&row.listing_generation!=null||cycle!==null&&(prior?.cycle==null||String(prior.cycle)!==cycle))return null;
  if(prior&&(prior.vin!==row.vin_normalized||timestamp(prior.end)!==end||(prior.gen??null)!==(row.listing_generation??null)||
    (prior.cycle??null)!==cycle||!Number.isSafeInteger(prior.seq)||raw.sequence<=prior.seq||timestamp(prior.at)>at))return null;
  const key=PREFIX+timedCycleId(row,cycle,deadline),observed=new Date(at).toISOString();
  const fingerprint='feed-timed-result-proof:v1:'+createHash('sha256')
    .update(JSON.stringify([key,raw.event_id,deadline,day,observed,amount])).digest('hex');
  return {event_id:'event|apibara|'+row.platform+'|'+encodeURIComponent(row.listing_id)+'|key|'+encodeURIComponent(key),
    event_key:key,fingerprint,listing_id:row.listing_id,source_key:row.source_key,platform:row.platform,lot:row.lot,vin_normalized:row.vin_normalized,
    provider_event_id:raw.event_id,auction_date:deadline,sale_date:day,observed_at:observed,final_price_usd:amount};
}
// Only source identity or an identical precise time and result can corroborate
// the same sale. A calendar day shared by two different cycles is insufficient.
const SALE_SQL=`WITH input AS (SELECT value AS j FROM json_each(?))
  INSERT INTO auction_events(event_id,listing_id,source_key,provider,platform,provider_event_id,event_key,vin_normalized,lot,
    auction_date,sale_date,source_status,canonical_status,final_price_usd,fingerprint,observed_at,identity_state,created_at,updated_at)
  SELECT j->>'$.event_id',l.listing_id,l.source_key,'apibara',l.platform,j->>'$.provider_event_id',j->>'$.event_key',
    l.vin_normalized,l.lot,j->>'$.auction_date',j->>'$.sale_date','Sold','Sold',j->>'$.final_price_usd',j->>'$.fingerprint',j->>'$.observed_at',
    'resolved',j->>'$.observed_at',j->>'$.observed_at' FROM input
    JOIN auction_listings l ON l.listing_id=j->>'$.listing_id' AND l.source_key=j->>'$.source_key'
      AND l.platform=j->>'$.platform' AND l.lot=j->>'$.lot' AND l.vin_normalized=j->>'$.vin_normalized' AND l.identity_state='resolved'
    WHERE NOT EXISTS(SELECT 1 FROM auction_events e WHERE e.event_id=j->>'$.event_id')
      AND NOT EXISTS(SELECT 1 FROM auction_events e INDEXED BY idx_events_provider_id
        WHERE e.provider='apibara' AND e.platform=l.platform AND e.provider_event_id=j->>'$.provider_event_id')
      AND NOT EXISTS(SELECT 1 FROM auction_events e INDEXED BY idx_events_listing_date
        WHERE e.listing_id=l.listing_id AND e.auction_date=j->>'$.auction_date' AND e.provider='apibara'
          AND e.vin_normalized=l.vin_normalized AND e.lot=l.lot AND lower(e.canonical_status)='sold'
          AND e.final_price_usd=j->>'$.final_price_usd' AND coalesce(e.event_key,'') NOT LIKE 'feed-timed-result:v1:%')
  ON CONFLICT(event_id) DO NOTHING`;
function saleStatement(db,rows){return db.prepare(SALE_SQL).bind(JSON.stringify(rows));}
module.exports={confirmedTimedSale,saleStatement,SALE_SQL};
