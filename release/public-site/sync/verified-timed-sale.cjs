'use strict';

const cycleKey=/^feed-timed-result:v1:[0-9a-f]{64}$/;
const highResolutionTime=value=>typeof value==='string' && /(?:Z|[+-]\d\d:\d\d)$/i.test(value) && Number.isFinite(Date.parse(value));

async function verifiedTimedSale(row) {
  if (!cycleKey.test(row.event_key || '') || row.provider!=='apibara' || row.identity_state!=='resolved' ||
      typeof row.fingerprint!=='string' || !row.fingerprint.startsWith('feed-timed-result-proof:v1:') ||
      !['iaai','copart'].includes(row.platform) || !/^[A-HJ-NPR-Z0-9]{17}$/.test(row.vin_normalized || '') ||
      !/^\d{1,20}$/.test(row.lot || '') || !/^chg_[1-9]\d{0,15}$/.test(row.provider_event_id || '') ||
      String(row.source_status).toLowerCase()!=='sold' || String(row.canonical_status).toLowerCase()!=='sold' ||
      !highResolutionTime(row.auction_date) || !highResolutionTime(row.observed_at) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date || '') || !Number.isFinite(row.final_price_usd) || row.final_price_usd<=0) return false;
  const day = new Date(row.sale_date+'T00:00:00Z');
  if(!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10)!==row.sale_date) return false;
  const fields = [row.event_key,row.provider_event_id,row.auction_date,row.sale_date,row.observed_at,row.final_price_usd];
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields)));
  const hex=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
  return row.fingerprint==='feed-timed-result-proof:v1:'+hex;
}

module.exports={verifiedTimedSale};
