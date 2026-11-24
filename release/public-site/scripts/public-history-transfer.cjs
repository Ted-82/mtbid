'use strict';
// Public fetch outcomes only; excludes leases, budgets, credentials and clients.
// Receipt is scheduled after its listing's complete event group.
function stamp(value){return value===null||typeof value==='string'&&Number.isFinite(Date.parse(value));}
function buildPublicHistoryTransfer({listings,receipts,health}){
 const known=new Map(listings.map(x=>[x.listing_id,x]));
 const healthStatements=[];const receiptStatements=[];const seen=new Set();
 for(const row of health){
  const listing=listings.find(x=>x.source_key===row.source_key);
  if(!listing||!stamp(row.last_attempt_at)||!stamp(row.last_success_at))throw Error('PUBLIC_SOURCE_HEALTH_IDENTITY');
  // No free-form provider diagnostics copied into publication storage.
  const code=row.last_error_code?'PUBLIC_SOURCE_REFRESH_FAILED':null;
  healthStatements.push({table:'vehicle_sources',sql:`UPDATE vehicle_sources SET last_attempt_at=?,last_success_at=?,last_error_code=? WHERE source_key=? AND platform=?`,params:[row.last_attempt_at,row.last_success_at,code,row.source_key,listing.platform]});
 }
 for(const row of receipts){
  const listingId=row.scope_key?.startsWith('history-import:')?row.scope_key.slice(15):null;
  const listing=known.get(listingId);
  if(!listing||seen.has(listingId)||row.provider!=='apibara'||row.platform!==listing.platform||row.operation!=='history_refresh'
    ||!['complete','partial','failed'].includes(row.status)||![row.last_attempt_at,row.last_success_at,row.last_complete_at,row.updated_at].every(stamp)
    ||row.status==='complete'&&(!row.last_success_at||!row.last_complete_at))throw Error('PUBLIC_HISTORY_RECEIPT_INVALID');
  seen.add(listingId);
  // A source cursor is not transplanted into an independently operated target.
  const code=row.status==='failed'?'PUBLIC_HISTORY_READ_FAILED':null;
  receiptStatements.push({listingId,table:'provider_sync_scopes',sql:`INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,last_attempt_at,last_success_at,last_complete_at,last_error_code,updated_at)
    SELECT ?,? ,?,'history_refresh',?,NULL,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM auction_listings WHERE listing_id=? AND platform=? AND lot=? AND vin_normalized IS ?)
    ON CONFLICT(scope_key) DO UPDATE SET status=excluded.status,cursor=NULL,last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,last_complete_at=excluded.last_complete_at,last_error_code=excluded.last_error_code,updated_at=excluded.updated_at`,
  params:[row.scope_key,row.provider,row.platform,row.status,row.last_attempt_at,row.last_success_at,row.last_complete_at,code,row.updated_at,listingId,listing.platform,listing.lot,listing.vin_normalized]});
 }
 return {healthStatements,receiptStatements};
}
module.exports={buildPublicHistoryTransfer};
