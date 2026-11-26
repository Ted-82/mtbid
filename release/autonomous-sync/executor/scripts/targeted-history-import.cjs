'use strict';
// Operator-only: imports an already obtained, identity-checked history response.
// No provider transport, discovery, scope/budget reset, or listing clock updates.
const {createHash}=require('node:crypto');
const {createApibaraProvider}=require('../providers/apibara.js');
const {createHistoryEventIdentity}=require('../sync/core.js');
const provider=createApibaraProvider();
const text=value=>String(value??'').trim();
const HISTORY_FAILURE_SQL=`INSERT INTO provider_sync_scopes
 (scope_key,provider,platform,operation,status,last_attempt_at,last_error_code,updated_at)
 SELECT ?,?,?,'history_refresh','failed',?,?,? WHERE EXISTS(
  SELECT 1 FROM auction_listings WHERE listing_id=? AND platform=? AND lot=?)
 ON CONFLICT(scope_key) DO UPDATE SET status='failed',last_attempt_at=excluded.last_attempt_at,
  last_error_code=excluded.last_error_code,updated_at=excluded.updated_at
 WHERE provider_sync_scopes.operation='history_refresh' AND provider_sync_scopes.provider=excluded.provider
  AND provider_sync_scopes.platform=excluded.platform
  AND julianday(excluded.last_attempt_at)>=COALESCE(julianday(provider_sync_scopes.last_success_at),-1)`;
const HISTORY_RECEIPT_SQL=`INSERT INTO provider_sync_scopes
 (scope_key,provider,platform,operation,status,cursor,last_attempt_at,last_success_at,last_complete_at,updated_at)
 VALUES(?,?,?,'history_refresh',?,?,?,?,?,?)
 ON CONFLICT(scope_key) DO UPDATE SET status=excluded.status,cursor=excluded.cursor,
  last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,
  last_complete_at=excluded.last_complete_at,updated_at=excluded.updated_at
 WHERE provider_sync_scopes.operation='history_refresh' AND provider_sync_scopes.provider=excluded.provider
  AND provider_sync_scopes.platform=excluded.platform
  AND julianday(excluded.last_success_at)>=COALESCE(julianday(provider_sync_scopes.last_success_at),-1)`;
function validateIdentity(vehicle,expected){
 if(!vehicle||text(vehicle.platform).toLowerCase()!==expected.platform||text(vehicle.lot_number??vehicle.lot)!==expected.lot||text(vehicle.vin).toUpperCase()!==expected.vin)throw Error('TARGETED_HISTORY_IDENTITY_MISMATCH');
}
function parseHistoryPage(response,expected,{mode='paginated'}={}){
 if(response?.ok===false||response?.response?.ok===false)throw Error('TARGETED_HISTORY_INVALID_ENVELOPE');
 const historyData=response?.response?.data??response?.data;
 const embedded=mode==='included';
 if(!['included','paginated'].includes(mode))throw Error('TARGETED_HISTORY_INVALID_INPUT');
 validateIdentity(embedded?provider.vehicleDetailRecord(response):provider.historyVehicleRecord(response),expected);
 if(!Array.isArray(historyData?.history)&&!Array.isArray(historyData?.history?.data)&&!Array.isArray(historyData))throw Error('TARGETED_HISTORY_INVALID_ENVELOPE');
 const raw=provider.historyRecords(response);
 if(raw.length>(embedded?1000:20))throw Error('TARGETED_HISTORY_PAGE_LIMIT');
 let excluded=0;
 const records=[];
 for(const record of raw){
  if(record?.vin&&text(record.vin).toUpperCase()!==expected.vin)throw Error('TARGETED_HISTORY_IDENTITY_MISMATCH');
  // VIN-wide history does not prove which listing an unidentified event belongs to.
  if(!text(record?.platform)||!text(record?.lot_number??record?.lot)){excluded++;continue;}
  const event=provider.toCanonicalHistoryEvent(record,{...expected,provider:'apibara'});
  if(!event||!['copart','iaai'].includes(event.platform)||!/^[0-9]+$/.test(text(event.lot)))throw Error('TARGETED_HISTORY_IDENTITY_MISMATCH');
  // The documented included history can contain other known lots of the same VIN.
  // Keep only this exact listing, never assign another lot/platform to it.
  if(event.platform!==expected.platform||event.lot!==expected.lot){excluded++;continue;}
  validateIdentity(event,expected);
  if(!event.auction_date||!/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(event.auction_date)||!event.source_status||!event.event_key)throw Error('TARGETED_HISTORY_EVENT_INCOMPLETE');
  records.push(event);
 }
 if(new Set(records.map(x=>x.event_key)).size!==records.length)throw Error('TARGETED_HISTORY_DUPLICATE_KEY');
 const pageMeta=historyData?.history?.meta??provider.responseMeta(response)??historyData?.meta;
 const nextCursor=pageMeta?.next_cursor??null;
 if(nextCursor!==null&&typeof nextCursor!=='string')throw Error('TARGETED_HISTORY_INVALID_CURSOR');
 // The documented include is an unpaginated array. If a pagination envelope
 // is supplied instead, its explicit end marker is required even in include mode.
 const complete=excluded===0&&(embedded&&Array.isArray(historyData.history)&&!Object.hasOwn(pageMeta||{},'next_cursor')
   ||Object.hasOwn(pageMeta||{},'next_cursor')&&(nextCursor===null||nextCursor===''));
 return {records,nextCursor:nextCursor===''?null:nextCursor,complete,excluded,mode};
}
async function resolveHistoryTarget(db,{identifier,platform}){
 const value=text(identifier).toUpperCase();
 if(!['copart','iaai'].includes(platform)||!(/^[0-9]+$/.test(value)||/^[A-HJ-NPR-Z0-9]{17}$/.test(value)))throw Error('TARGETED_HISTORY_INVALID_INPUT');
 const rows=(await db.prepare(`SELECT l.listing_id,l.platform,l.lot,l.vin_normalized,s.provider
  FROM auction_listings l JOIN vehicle_sources s ON s.source_key=l.source_key
  WHERE l.platform=? AND (l.lot=? OR l.vin_normalized=?)`).bind(platform,value,value).all()).results;
 if(rows.length!==1||rows[0].provider!=='apibara'||!/^[A-HJ-NPR-Z0-9]{17}$/.test(rows[0].vin_normalized||'')||!/^[0-9]+$/.test(rows[0].lot||''))throw Error('TARGETED_HISTORY_LISTING_MISMATCH');
 return {platform:rows[0].platform,lot:rows[0].lot,vin:rows[0].vin_normalized,listingId:rows[0].listing_id};
}
async function importTargetedHistory(db,{response,expected,observedAt,mode='paginated',sourceComplete}){
 if(!['copart','iaai'].includes(expected?.platform)||!expected.lot||!/^[A-HJ-NPR-Z0-9]{17}$/.test(expected.vin||'')||!Number.isFinite(Date.parse(observedAt)))throw Error('TARGETED_HISTORY_INVALID_INPUT');
 const parsed=parseHistoryPage(response,expected,{mode});
 const {records,nextCursor,excluded}=parsed;
 const complete=parsed.complete&&sourceComplete!==false;
 const listingRead=db.prepare(`SELECT l.listing_id,l.source_key,l.platform,l.lot,l.vin_normalized,s.provider FROM auction_listings l JOIN vehicle_sources s ON s.source_key=l.source_key WHERE l.platform=? AND l.lot=?`).bind(expected.platform,expected.lot);
 // Event IDs can be calculated before the listing read when the caller supplies
 // its verified listing ID. Query the whole platform/LOT match set as before:
 // filtering it by that supplied ID would hide ambiguous or changed listings.
 const readsForListing=listingId=>{
  const ids=records.map(event=>createHistoryEventIdentity(event,{provider:'apibara',platform:expected.platform,listingId}).eventId);
  const statements=[];
  // D1 allows at most 100 bound parameters per query, also inside a batch.
  for(let i=0;i<ids.length;i+=100){const chunk=ids.slice(i,i+100);
   // Deliberately global by event_id: a conflicting event assigned to another
   // listing must still be found and rejected before any write.
   statements.push(db.prepare(`SELECT event_id,listing_id,source_key,platform,lot,vin_normalized,fingerprint FROM auction_events WHERE event_id IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk));}
  return statements;
 };
 let matches,eventReadStatements,existingRows=[];
 if(expected.listingId!==undefined&&expected.listingId!==null){
  if(typeof expected.listingId!=='string'||!expected.listingId)throw Error('TARGETED_HISTORY_INVALID_INPUT');
  eventReadStatements=readsForListing(expected.listingId);
  const results=await db.batch([listingRead,...eventReadStatements]);
  if(!Array.isArray(results)||results.length!==eventReadStatements.length+1
   ||results.some(result=>result?.success===false||!Array.isArray(result?.results)))throw Error('TARGETED_HISTORY_PRECHECK_FAILED');
  matches=results[0].results;existingRows=results.slice(1).flatMap(result=>result.results);
 }else matches=(await listingRead.all()).results;
 if(!Array.isArray(matches)||matches.length!==1||matches[0].vin_normalized!==expected.vin||matches[0].provider!=='apibara'
  ||matches[0].platform!==expected.platform||matches[0].lot!==expected.lot
  ||expected.listingId!=null&&matches[0].listing_id!==expected.listingId)throw Error('TARGETED_HISTORY_LISTING_MISMATCH');
 const listing=matches[0], now=new Date(observedAt).toISOString();
 const rows=records.map(event=>{
  const id=createHistoryEventIdentity(event,{provider:'apibara',platform:expected.platform,listingId:listing.listing_id});
  return {event_id:id.eventId,listing_id:listing.listing_id,source_key:listing.source_key,provider:'apibara',platform:expected.platform,
   provider_event_id:event.provider_event_id??null,event_key:event.event_key,vin_normalized:expected.vin,lot:expected.lot,
   auction_date:event.auction_date,sale_date:event.sale_date??null,source_status:event.source_status,canonical_status:event.status,
   current_bid_usd:event.pricing.current_bid,buy_now_usd:event.pricing.buy_now,source_price_usd:event.pricing.source_price,final_price_usd:event.pricing.final_price,
   seller_name:event.seller.name,seller_type:event.seller.type,observed_at:now,
   fingerprint:createHash('sha256').update(JSON.stringify({...event,raw_payload:undefined})).digest('hex'),normalizer_version:event.model_version??1,identity_state:'resolved',created_at:now,updated_at:now};
 });
 // Callers without a supplied listing ID retain the sequential read fallback.
 if(!eventReadStatements){
  eventReadStatements=readsForListing(listing.listing_id);
  for(const statement of eventReadStatements){const result=await statement.all();
   if(result?.success===false||!Array.isArray(result?.results))throw Error('TARGETED_HISTORY_PRECHECK_FAILED');
   existingRows.push(...result.results);}
 }
 const requestedIds=new Set(rows.map(row=>row.event_id)),existing=new Map();
 for(const row of existingRows){
  if(!row||!requestedIds.has(row.event_id)||existing.has(row.event_id))throw Error('TARGETED_HISTORY_PRECHECK_FAILED');
  existing.set(row.event_id,row);
 }
 for(const row of rows){const old=existing.get(row.event_id);
  if(old&&['listing_id','source_key','platform','lot','vin_normalized'].some(key=>old[key]!==row[key]))throw Error('TARGETED_HISTORY_EVENT_CONFLICT');}
 const statements=rows.map(row=>{
  const keys=Object.keys(row),mutable=keys.filter(x=>!['event_id','listing_id','source_key','provider','platform','lot','vin_normalized','created_at'].includes(x));
  return db.prepare(`INSERT INTO auction_events (${keys.join(',')}) SELECT ${keys.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM auction_listings WHERE listing_id=? AND source_key=? AND platform=? AND lot=? AND vin_normalized=?)
   ON CONFLICT(event_id) DO UPDATE SET ${mutable.map(x=>x+'=excluded.'+x).join(',')}
   WHERE auction_events.listing_id=excluded.listing_id AND auction_events.source_key=excluded.source_key AND auction_events.platform=excluded.platform AND auction_events.lot=excluded.lot AND auction_events.vin_normalized=excluded.vin_normalized AND julianday(excluded.observed_at)>=julianday(auction_events.observed_at) AND auction_events.fingerprint<>excluded.fingerprint`)
   .bind(...keys.map(x=>row[x]),listing.listing_id,listing.source_key,expected.platform,expected.lot,expected.vin);
 });
 // Receipt and events commit together, including an explicitly fetched empty page.
 // This does not alter discovery scopes, listing clocks or provider budgets.
 statements.push(db.prepare(HISTORY_RECEIPT_SQL).bind(`history-import:${listing.listing_id}`,'apibara',expected.platform,complete?'complete':'partial',nextCursor===null?null:String(nextCursor),now,now,complete?now:null,now));
 // SELECTs run after the writes in the same atomic batch, so their checks do not
 // require extra remote round trips or observe an unrelated subsequent update.
 const readbackStart=statements.length;
 statements.push(...eventReadStatements,db.prepare('SELECT status,cursor,last_success_at,last_complete_at FROM provider_sync_scopes WHERE scope_key=?').bind(`history-import:${listing.listing_id}`));
 let results;
 if(statements.length<=250)results=await db.batch(statements);
 else{
  // Keep the previously supported 249-event write boundary. When adding the
  // SELECTs would exceed the bridge's batch limit, use the prior separate
  // readback path, with the same strict identity and receipt validation below.
  results=await db.batch(statements.slice(0,readbackStart));
  if(!Array.isArray(results)||results.length!==readbackStart)throw Error('TARGETED_HISTORY_READBACK_MISMATCH');
  for(const statement of statements.slice(readbackStart))results.push(await statement.all());
 }
 if(!Array.isArray(results)||results.length!==statements.length)throw Error('TARGETED_HISTORY_READBACK_MISMATCH');
 const found=[];
 for(const result of results.slice(readbackStart,-1)){
  if(result?.success===false||!Array.isArray(result?.results))throw Error('TARGETED_HISTORY_READBACK_MISMATCH');
  found.push(...result.results);
 }
 const readback=new Map(found.map(row=>[row.event_id,row]));
 if(found.length!==rows.length||readback.size!==rows.length)throw Error('TARGETED_HISTORY_READBACK_MISMATCH');
 for(const row of rows){const saved=readback.get(row.event_id);
  if(!saved||['listing_id','source_key','platform','lot','vin_normalized','fingerprint'].some(key=>saved[key]!==row[key]))throw Error('TARGETED_HISTORY_READBACK_MISMATCH');}
 const receiptResult=results.at(-1);
 if(receiptResult?.success===false||!Array.isArray(receiptResult?.results)||receiptResult.results.length!==1)throw Error('TARGETED_HISTORY_RECEIPT_READBACK_MISMATCH');
 const receipt=receiptResult.results[0];
 if(receipt?.status!==(complete?'complete':'partial')||receipt.last_success_at!==now||receipt.cursor!==nextCursor||receipt.last_complete_at!==(complete?now:null))throw Error('TARGETED_HISTORY_RECEIPT_READBACK_MISMATCH');
 return {events:rows.length,listingId:listing.listing_id,observedAt:now,nextCursor,complete,excluded,mode};
}
module.exports={importTargetedHistory,parseHistoryPage,resolveHistoryTarget,HISTORY_RECEIPT_SQL,HISTORY_FAILURE_SQL};
