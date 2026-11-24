'use strict';
// This guard is private to the photo archive. It never alters the catalogue
// importer, its limits, cursor, queue, retention policy, or database records.
const KEY='v1/private/storage-budget.json';
// USD5/month storage approved by the owner; 300GB costs USD4.35/month
// at constant occupancy, leaving USD0.65 outside the storage calculation.
const ACCOUNT_BYTES=300_000_000_000,OTHER_BUCKET_RESERVE=300_000_000,FEED_WORK_RESERVE=600_000_000;
const STATUS_KEY='v2/private/storage-status.json';
const REFRESH_MS=15*60_000,HOUR=60*60_000,MAX_PAGES=256;
// Both feed jobs cap the bucket at 5 GiB. Allow for simultaneous reservations
// and small auxiliary files while reusing a recent measurement.
const FEED_BUCKET_RESERVE=6_000_000_000;
const valid=n=>Number.isSafeInteger(n)&&n>=0;
async function ledger(db){
 const row=await db.prepare('SELECT COALESCE(SUM(compressed_bytes+COALESCE(archive_bytes,0)),0) AS bytes FROM server_feed_generations WHERE retired_at IS NULL').first();
 if(!valid(row?.bytes))throw Error('archive_storage_ledger');return row.bytes;
}
async function sourceBytes(bucket){
 let cursor,total=0;const seen=new Set();
 for(let page=0;page<MAX_PAGES;page++){
  const result=await bucket.list({limit:1000,...(cursor?{cursor}:{})});
  if(!Array.isArray(result?.objects)||typeof result.truncated!=='boolean'||result.objects.some(o=>!valid(o.size)))throw Error('archive_storage_listing');
  total+=result.objects.reduce((s,o)=>s+o.size,0);
  if(!result.truncated)return total;
  if(!result.objects.length||typeof result.cursor!=='string'||!result.cursor||seen.has(result.cursor))throw Error('archive_storage_cursor');
  seen.add(result.cursor);cursor=result.cursor;
 }
 throw Error('archive_storage_page_limit');
}
async function archiveAllowance(env,{now=Date.now,maximum,previous=null}={}){
 if(!valid(maximum))throw Error('archive_storage_config');
 const at=now(),bucket=env.REXBID_AUCTION_ARCHIVE,source=env.REXBID_ARCHIVE_FEED;
 const currentLedger=await ledger(env.REXBID_ARCHIVE_CATALOG);
 const object=await bucket.get(KEY);let meter=object?await object.json():null;
 if(meter&&!(meter.version===1&&valid(meter.at)&&valid(meter.sourceBytes)&&valid(meter.ledgerBytes)&&meter.at<=at))throw Error('archive_storage_meter');
 const statusAt=Date.parse(previous?.at);
 const spareCapacity=previous?.version===1&&valid(statusAt)&&statusAt<=at&&at-statusAt<REFRESH_MS
   &&valid(previous.reservedTotalBytes)&&previous.reservedTotalBytes<ACCOUNT_BYTES*.8;
 const refreshMs=spareCapacity?HOUR:REFRESH_MS;
 if(!meter||at-meter.at>=refreshMs){
  // List EVERY page, including short truncated pages. Snapshot the ledger first:
  // changes during the list are conservatively counted again, never subtracted.
  meter={version:1,at,sourceBytes:await sourceBytes(source),ledgerBytes:currentLedger};
  await bucket.put(KEY,JSON.stringify(meter),{httpMetadata:{contentType:'application/json'}});
 }
 const sourceReserved=meter.sourceBytes+Math.max(0,currentLedger-meter.ledgerBytes);
 const admissionReserve=spareCapacity?Math.max(sourceReserved,FEED_BUCKET_RESERVE):sourceReserved;
 const available=Math.max(0,ACCOUNT_BYTES-OTHER_BUCKET_RESERVE-FEED_WORK_RESERVE-admissionReserve);
 return {maximumBytes:Math.min(maximum,available),sourceReserved,measuredAt:new Date(meter.at).toISOString(),feedWorkReserve:FEED_WORK_RESERVE,otherBucketReserve:OTHER_BUCKET_RESERVE};
}
function projection(points){
 if(points.length<2)return null;
 const last=points.at(-1),first=points.find(p=>last.at-p.at>=86400000);
 if(!first)return null;
 const perDay=(last.bytes-first.bytes)/((last.at-first.at)/86400000);
 return {sampleHours:(last.at-first.at)/3600000,bytesPerDay:perDay,daysRemaining:perDay>0?Math.max(0,(ACCOUNT_BYTES-last.bytes)/perDay):null};
}
function statusSnapshot(index,allowance,previous,at){
 const {count}=require('./auction-archive-segments.cjs');
 const bytes=index.allocatedBytes+allowance.sourceReserved+OTHER_BUCKET_RESERVE+FEED_WORK_RESERVE;
 const points=(previous?.points||[]).filter(p=>valid(p.at)&&valid(p.bytes)&&p.at<=at&&at-p.at<7*86400000);
 if(!points.length||at-points.at(-1).at>=3600000)points.push({at,bytes});
 const trend=projection(points);
 const warning=bytes>=ACCOUNT_BYTES?'capacity':bytes>=ACCOUNT_BYTES*.8?'near_capacity':trend?.daysRemaining!==null&&trend?.daysRemaining<=7?'growth_warning':null;
 return {version:1,at:new Date(at).toISOString(),limitBytes:ACCOUNT_BYTES,reservedTotalBytes:bytes,remainingBytes:Math.max(0,ACCOUNT_BYTES-bytes),
  archiveAllocatedBytes:index.allocatedBytes,galleries:count(index),estimatedStorageUSDMonthly:Math.max(0,Math.ceil(bytes/1e9)-10)*.015,
  approvedStorageUSDMonthly:5,warning,trend,points,sourceMeasuredAt:allowance.measuredAt,
  note:'Estimate at constant current occupancy including working reserves, not an invoice. R2 operations, tax and other Cloudflare services are separate.'};
}
async function recordStorageStatus(env,allowance,{now=Date.now,previous=null}={}){
 const bucket=env.REXBID_AUCTION_ARCHIVE;
 const {getIndex}=require('./auction-archive-state.cjs');
 const {index}=await getIndex(bucket);
 const status=statusSnapshot(index,allowance,previous,now());
 await bucket.put(STATUS_KEY,JSON.stringify(status),{httpMetadata:{contentType:'application/json'}});
 return status;
}
module.exports={archiveAllowance,sourceBytes,KEY,ACCOUNT_BYTES,OTHER_BUCKET_RESERVE,FEED_WORK_RESERVE,STATUS_KEY,projection,statusSnapshot,recordStorageStatus};
