'use strict';
const {apibaraPhotoFields}=require('../providers/apibara.js');
const {packMediaJson}=require('./catalog-media-storage.cjs');
const TASK='feed-photo-repair:v1',PAGE=1000,INTERVAL=15*60000,SCAN_INTERVAL=5*60000;
const MAX_DETAILS_PER_RUN=3;
const UPCOMING_SCAN=256;
const ACTIVE=new Set(['open','live','active','pending','upcoming','scheduled','future','pre_bid','prebid','timed','buy_now']);
const iso=n=>new Date(n).toISOString();
const errorCode=e=>/^[A-Z_]{2,80}$/.test(e?.code||e?.message||'')?e.code||e.message:'FEED_PHOTO_REQUEST_FAILED';
const eligible=r=>r.photo_active===1&&r.identity_state==='resolved'&&['copart','iaai'].includes(r.platform)
   &&/^\d{1,20}$/.test(r.lot)&&/^[A-HJ-NPR-Z0-9]{17}$/.test(r.vin_normalized)
   &&ACTIVE.has(String(r.auction_state).toLowerCase())&&r.photo_missing===1;
const photoFields=`l.rowid AS photo_rowid,l.listing_id,l.platform,l.lot,l.vin_normalized,l.auction_at,
  l.identity_state,l.auction_state,(l.media_urls_json IS NULL AND l.media_thumbs_json IS NULL) AS photo_missing,
  EXISTS(SELECT 1 FROM feed_catalog_membership m WHERE m.baseline_id=? AND m.listing_id=l.listing_id AND m.active=1) AS photo_active`;

async function nextUpcoming(db,baselineId,progress,started){
 if(Number.isFinite(progress.retryAfter)&&progress.retryAfter>started)return{candidate:null,upcoming:progress};
 const now=iso(started),end=iso(started+7*24*60*60000);
 const from=typeof progress.at==='string'&&progress.at>=now&&progress.at<=end?progress.at:now;
 const id=from===progress.at&&typeof progress.id==='string'?progress.id:'';
 const rows=(await db.prepare(`SELECT ${photoFields} FROM auction_listings l INDEXED BY idx_listings_catalog
  WHERE l.platform='copart' AND l.auction_state='open' AND l.auction_at BETWEEN ? AND ?
    AND (l.auction_at,l.listing_id)>(?,?)
  ORDER BY l.auction_at,l.listing_id LIMIT ${UPCOMING_SCAN}`)
   .bind(baselineId,from,end,from,id).all()).results;
 if(!Array.isArray(rows)||rows.length>UPCOMING_SCAN)throw Error('FEED_PHOTO_READ_INVALID');
 const candidate=rows.find(eligible);
 const last=candidate??rows.at(-1);
 return{candidate,upcoming:last?{at:last.auction_at,id:last.listing_id}:{retryAfter:started+60*60000}};
}
// Photos do not certify price/availability freshness. This task updates only
// empty media columns and its own checkpoint under the importer's shared lease.
async function repairFeedPhotos({db,store,adapter,getRequest,now}){
 const started=now(),task=await store.task(TASK);
 if(Date.parse(task?.next_due_at)>started)return null;
 const progress=task?.cursor?JSON.parse(task.cursor):{after:0};
 if(!Number.isSafeInteger(progress.after)||progress.after<0)throw Error('FEED_PHOTO_CURSOR_INVALID');
 const published=await db.prepare(`SELECT g.status,g.observed_at,s.committed_sequence,p.baseline_id
  FROM server_feed_generations g CROSS JOIN server_feed_state s CROSS JOIN feed_catalog_pointer p
  WHERE s.singleton=1 AND p.singleton=1 AND s.active_generation IS NULL AND g.last_sequence=s.committed_sequence
   AND g.generation_id=(SELECT MAX(generation_id) FROM server_feed_generations)`).bind().first();
 if(published?.status!=='complete'||typeof published.baseline_id!=='string'
   ||!Number.isSafeInteger(published.committed_sequence)||!Number.isFinite(Date.parse(published.observed_at))
   ||Date.parse(published.observed_at)>started)return null;
 // Integer primary-key range bounds physical reads even with few missing photos.
 // Descending rotation revisits the whole catalog; newly created lots lead each pass.
 const rows=(await db.prepare(`SELECT ${photoFields}
  FROM auction_listings l WHERE l.rowid<? ORDER BY l.rowid DESC LIMIT ${PAGE}`)
  .bind(published.baseline_id,progress.after||Number.MAX_SAFE_INTEGER).all()).results;
 if(!Array.isArray(rows)||rows.length>PAGE)throw Error('FEED_PHOTO_READ_INVALID');
 const {candidate:urgent,upcoming}=await nextUpcoming(db,published.baseline_id,progress.upcoming??{},started);
 const regular=rows.filter(r=>r.listing_id!==urgent?.listing_id&&eligible(r));
 const candidates=(urgent?[urgent,...regular]:regular).slice(0,MAX_DETAILS_PER_RUN);
 let after=regular.length?progress.after:(rows.length===PAGE?rows.at(-1).photo_rowid:0);
 const checkpoint=(result,delay=INTERVAL,success=false)=>store.taskStatement({key:TASK,platform:'all',
   cursor:JSON.stringify({after,upcoming,...result}),due:now()+delay,status:'scan',success});
 if(!candidates.length){
  await store.guarded([checkpoint({scanned:rows.length},SCAN_INTERVAL)]);
  return{scanned:rows.length,attempted:0};
 }
 const results=[];
 let request;
 for(const candidate of candidates){
  if(candidate!==urgent)after=candidate.photo_rowid;
  const result=await repairPhoto({candidate,db,store,adapter,getRequest:async()=>request??=await getRequest(),published,checkpoint});
  results.push(result);
  if(result.error)break;
 }
 return results.length===1?{scanned:rows.length,attempted:1,...results[0]}:
  {scanned:rows.length,attempted:results.length,filled:results.filter(x=>x.filled).length,results};
}

async function repairPhoto({candidate,db,store,adapter,getRequest,published,checkpoint}){
 const identity={lot:candidate.lot,platform:candidate.platform};
 // Reserve the interval BEFORE API access: restart, failure or lost response
 // cannot cause a request storm. countedFeedRequest enforces existing shared caps.
 await store.guarded([checkpoint({...identity,outcome:'reserved'})]);
 let raw;
 try{const request=await getRequest();const response=await request({operation:'vehicleByIdentifier',identifier:candidate.lot,platform:candidate.platform});
   raw=adapter.vehicleDetailRecord(response.response);
 }catch(e){const code=errorCode(e);await store.guarded([checkpoint({...identity,outcome:'request_failed',error:code})]);return{...identity,error:code};}
 let outcome='no_images',images=[],thumbs=[];
 if(raw?.platform!==candidate.platform||String(raw?.lot_number||'')!==candidate.lot||raw?.vin?.toUpperCase()!==candidate.vin_normalized)outcome='identity_mismatch';
 else if(!ACTIVE.has(String(raw.auction?.state||'').toLowerCase())||raw.auction?.lot_removed||raw.auction?.result_confirmed)outcome='source_not_active';
 else{const media=apibaraPhotoFields(raw.media);images=media.items;thumbs=media.thumbs;if(images.length||thumbs.length)outcome='filled';}
 const statements=[];
 if(outcome==='filled')statements.push(db.prepare(`UPDATE auction_listings SET media_urls_json=?,media_thumbs_json=?
  WHERE listing_id=? AND platform=? AND lot=? AND vin_normalized=? AND identity_state='resolved'
   AND media_urls_json IS NULL AND media_thumbs_json IS NULL AND auction_state IS ?
   AND EXISTS(SELECT 1 FROM feed_catalog_pointer p JOIN feed_catalog_membership m ON m.baseline_id=p.baseline_id
    WHERE p.singleton=1 AND p.baseline_id=? AND m.listing_id=auction_listings.listing_id AND m.active=1)`)
  .bind(images.length?packMediaJson(JSON.stringify(images)):null,thumbs.length?packMediaJson(JSON.stringify(thumbs)):null,
   candidate.listing_id,candidate.platform,candidate.lot,candidate.vin_normalized,candidate.auction_state,published.baseline_id));
 statements.push(checkpoint({...identity,outcome,images:images.length,thumbs:thumbs.length},INTERVAL,true));
 await store.guarded(statements);
 // Conditional UPDATE can lose a race to a newer writer; never claim it filled
 // unless the stored row now has a gallery with the same verified identity.
 const found=outcome==='filled'?await db.prepare('SELECT media_urls_json,media_thumbs_json FROM auction_listings WHERE listing_id=? AND vin_normalized=?').bind(candidate.listing_id,candidate.vin_normalized).first():null;
 return{...identity,outcome,
   filled:!!(found?.media_urls_json||found?.media_thumbs_json)};
}
module.exports={repairFeedPhotos,TASK,PAGE,INTERVAL};
