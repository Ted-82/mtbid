'use strict';

// Explicit stored fields only. Auction outcomes must never substitute for a bid.
const terminal = `(lower(trim(COALESCE(l.auction_state,''))) IN ('finished','sold','not_sold','not sold','no_sale','no sale','unsold','closed','ended','completed','cancelled','canceled','withdrawn')
 OR lower(COALESCE(l.source_status,'')) LIKE '%sold%'
 OR lower(COALESCE(l.source_status,'')) LIKE '%approval%'
 OR lower(trim(COALESCE(l.source_status,''))) IN ('no sale','no_sale','closed','ended','completed','cancelled','canceled','withdrawn'))`;
const numeric = field => `typeof(${field}) IN ('integer','real') AND ${field}>=0`;
const bid = `CASE WHEN NOT ${terminal} AND ${numeric('l.current_bid_usd')} THEN l.current_bid_usd END`;
const buy = `CASE WHEN NOT ${terminal} AND ${numeric('l.buy_now_usd')} AND l.buy_now_usd>0 THEN l.buy_now_usd END`;
const year = `CASE WHEN ${numeric('l.year')} AND l.year>=1886 AND l.year<=2100 THEN l.year END`;
const mileage = `CASE WHEN ${numeric('l.odometer_value')} THEN CASE
 WHEN lower(trim(COALESCE(l.odometer_unit,''))) IN ('mi','mile','miles') THEN l.odometer_value
 WHEN lower(trim(COALESCE(l.odometer_unit,''))) IN ('km','kilometer','kilometers','kilometre','kilometres') THEN l.odometer_value/1.609344 END END`;
const auctionDate = "trim(CASE WHEN l.is_timed=1 THEN l.timed_end_at ELSE l.auction_at END)";
const sourceStatus = "lower(trim(COALESCE(l.source_status,'')))";
const warsawDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'});

function isAuctionOrder(sort) {
 return sort==='auction_next'||sort==='auction_later';
}

const assigned = `${sourceStatus} NOT IN ('unscheduled','unknown','awaiting_result','removed','unassigned','not assigned','not scheduled')
 AND (l.is_timed=1 OR (l.auction_state<>'live' AND ${sourceStatus} NOT IN ('live','running','in progress','started','timed','timed auction') AND NOT (l.platform='copart' AND ${sourceStatus} IN ('upcoming','upcoming lot','future','future lot','unassigned lot','not assigned lot','not scheduled lot'))))`;
const zoned = `(upper(substr(${auctionDate},-1))='Z' OR substr(${auctionDate},-6,1) IN ('+','-') AND substr(${auctionDate},-3,1)=':')`;
const dateOnly = `(l.is_timed IS NOT 1 AND length(${auctionDate})=10 AND date(${auctionDate})=${auctionDate})`;
const validDateKey = `CASE
  WHEN ${dateOnly} THEN unixepoch(${auctionDate})
  WHEN length(${auctionDate})>10 AND ${zoned} AND date(substr(${auctionDate},1,10))=substr(${auctionDate},1,10) THEN unixepoch(${auctionDate}) END`;
const dateShape = `${auctionDate} GLOB '[2][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'`;
const auctionKey = `CASE WHEN NOT ${terminal} AND (${assigned}) AND ${dateShape} THEN ${validDateKey} END`;
// A live session keeps its assigned date after the start. The upcoming
// expression intentionally excludes it and must keep matching its D1 index.
const assignedDateKey = `CASE WHEN ${dateShape} AND ${sourceStatus} NOT IN (
  'unscheduled','unknown','removed','unassigned','unassigned lot','not assigned','not assigned lot',
  'not scheduled','not scheduled lot','auction not assigned','future sale')
  AND (l.platform<>'copart' OR ${sourceStatus} NOT IN ('upcoming','upcoming lot','future','future lot'))
  THEN ${validDateKey} END`;
const auctionIndex='idx_listings_public_auction_date';
const auctionIndexPredicate=`l.auction_state IN ('open','live') AND (${auctionKey}) IS NOT NULL`;
const auctionIndexSql=`CREATE INDEX ${auctionIndex} ON auction_listings((${auctionKey}),listing_id) WHERE ${auctionIndexPredicate}`.replaceAll('l.','');
// Allow a full year of bookings while keeping out source anomalies years ahead.
const MAX_BOOKING_HORIZON_SECONDS = 365 * 86400;
function futureAuction(asOfMs, {after = null, direction = "ASC"} = {}) {
 const day = warsawDay.format(asOfMs);
 const cutoff = Math.floor(asOfMs/1000);
 const dayStart=Date.parse(day)/1000;
 const end = cutoff + MAX_BOOKING_HORIZON_SECONDS;
 // Include the cursor timestamp in the index range; afterClause handles ties.
 const start = Math.min(dayStart,cutoff);
 const lower = after !== null && direction === "ASC" ? Math.max(start,after) : start;
 const upper = after !== null && direction === "DESC" ? Math.min(end,after) : end;
 return {sql:`(${auctionKey}) IS NOT NULL AND (${auctionKey}) BETWEEN ? AND ? AND ((NOT ${dateOnly} AND (${auctionKey})>=?) OR (${dateOnly} AND (${auctionKey})>=?))`,values:[lower,upper,cutoff,dayStart]};
}
const ORDERS = Object.freeze({
 recent: null,
 auction_next: {direction:'ASC'},
 auction_later: {direction:'DESC'},
 year_desc: {expression:year,direction:'DESC'},
 year_asc: {expression:year,direction:'ASC'},
 mileage_asc: {expression:mileage,direction:'ASC'},
 bid_asc: {expression:bid,direction:'ASC'},
 bid_desc: {expression:bid,direction:'DESC'},
 buy_now_asc: {expression:buy,direction:'ASC'}
});
function invalid(code){const error=new TypeError(code);error.code=code;return error;}
function parseSort(value){
 const sort=value===null||value===undefined||value===''?'recent':value;
 if(typeof sort!=='string'||!Object.hasOwn(ORDERS,sort))throw invalid('INVALID_CATALOG_SORT');
 return sort;
}
function parseAnchor(decoded,sort){
 let anchor;try{anchor=JSON.parse(decoded);}catch{throw invalid('INVALID_CATALOG_CURSOR');}
 if(!anchor||anchor.v!==1||anchor.sort!==sort||typeof anchor.id!=='string'||!anchor.id||anchor.id.length>256
   ||!(anchor.value===null||typeof anchor.value==='number'&&Number.isFinite(anchor.value)&&anchor.value>=0)
   ||isAuctionOrder(sort)&&(!Number.isSafeInteger(anchor.asOf)||anchor.asOf<0||anchor.asOf>253402300799000))throw invalid('INVALID_CATALOG_CURSOR');
 return anchor;
}
function afterClause(order,anchor){
 const expr=order.expression;
 if (isAuctionOrder(anchor.sort)) {
  if (anchor.value===null) throw invalid('INVALID_CATALOG_CURSOR');
  const comparison=order.direction==='ASC'?'>':'<';
  return {sql:`((${expr}),l.listing_id) ${comparison} (?,?)`,values:[anchor.value,anchor.id]};
 }
 return anchor.value===null
  ? {sql:`(${expr} IS NULL AND l.listing_id>?)`,values:[anchor.id]}
  : {sql:`(${expr} IS NULL OR ${expr}${order.direction==='ASC'?'>':'<'}? OR (${expr}=? AND l.listing_id>?))`,values:[anchor.value,anchor.value,anchor.id]};
}
module.exports={ORDERS,parseSort,parseAnchor,afterClause,invalid,isAuctionOrder,auctionKey,assignedDateKey,futureAuction,auctionIndex,auctionIndexSql};
