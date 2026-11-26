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
const ORDERS = Object.freeze({
 recent: null,
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
   ||!(anchor.value===null||typeof anchor.value==='number'&&Number.isFinite(anchor.value)&&anchor.value>=0))throw invalid('INVALID_CATALOG_CURSOR');
 return anchor;
}
function afterClause(order,anchor){
 const expr=order.expression;
 return anchor.value===null
  ? {sql:`(${expr} IS NULL AND l.listing_id>?)`,values:[anchor.id]}
  : {sql:`(${expr} IS NULL OR ${expr}${order.direction==='ASC'?'>':'<'}? OR (${expr}=? AND l.listing_id>?))`,values:[anchor.value,anchor.value,anchor.id]};
}
module.exports={ORDERS,parseSort,parseAnchor,afterClause,invalid};
