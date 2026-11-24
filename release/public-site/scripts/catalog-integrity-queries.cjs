'use strict';
// The inverse key lookup adds an indexable predicate. The original equality is
// retained so malformed/case-variant receipt prefixes cannot acquire a match.
// This is a read-only audit query, not a schema migration or data correction.
const RECEIPT_IDENTITY_SQL = `SELECT COUNT(*) n FROM provider_sync_scopes p
 LEFT JOIN auction_listings l ON l.listing_id=substr(p.scope_key,16)
   AND p.scope_key='history-import:'||l.listing_id
 LEFT JOIN vehicle_sources s ON s.source_key=l.source_key
 WHERE p.operation='history_refresh' AND p.scope_key LIKE 'history-import:%'
 AND (l.listing_id IS NULL OR p.platform IS NOT l.platform OR p.provider IS NOT s.provider)`;
module.exports={RECEIPT_IDENTITY_SQL};
