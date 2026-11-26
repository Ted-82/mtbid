'use strict';
const {randomUUID}=require('node:crypto'),{apibaraPhotoFields}=require('../providers/apibara.js'),{packMediaJson}=require('./catalog-media-storage.cjs');
// Reuse full records already returned by a paid bulk call. This writer changes
// only empty media columns; it cannot certify price or availability freshness.
async function fillAvailableMedia({db,store,records,now}){
 if(!Array.isArray(records)||records.length>100)return {filled:0};
 const candidates=records.filter(r=>['copart','iaai'].includes(r?.platform)&&/^\d{1,20}$/.test(String(r.lot_number))&&/^[A-HJ-NPR-Z0-9]{17}$/.test(r.vin||'')&&
  ['open','live'].includes(r.auction?.state)&&r.auction.lot_removed===false&&r.auction.result_confirmed===false);
 if(!candidates.length)return {filled:0};
 const scope=await db.prepare('SELECT s.committed_sequence,p.baseline_id FROM server_feed_state s JOIN feed_catalog_pointer p ON p.singleton=s.singleton WHERE s.singleton=1 AND s.active_generation IS NULL').bind().first();
 if(!scope)return {filled:0};
 const keys=candidates.map(r=>({platform:r.platform,lot:String(r.lot_number)}));
 const rows=(await db.prepare("SELECT l.listing_id,l.platform,l.lot,l.vin_normalized FROM json_each(?) j JOIN auction_listings l ON l.platform=json_extract(j.value,'$.platform') AND l.lot=json_extract(j.value,'$.lot') JOIN vehicle_sources s ON s.source_key=l.source_key AND s.platform=l.platform JOIN feed_catalog_membership m ON m.listing_id=l.listing_id AND m.baseline_id=? WHERE m.active=1 AND l.auction_state IN ('open','live') AND l.identity_state='resolved' AND s.identity_state='resolved' AND s.provider='apibara' AND l.media_urls_json IS NULL AND l.media_thumbs_json IS NULL")
  .bind(JSON.stringify(keys),scope.baseline_id).all()).results;
 const entries=[];
 for(const row of rows){
  if(entries.length>=20)break;
  if(rows.filter(x=>x.platform===row.platform&&x.lot===row.lot).length!==1)continue;
  const matches=candidates.filter(r=>r.platform===row.platform&&String(r.lot_number)===row.lot&&r.vin===row.vin_normalized);
  if(matches.length!==1)continue;
  const media=apibaraPhotoFields(matches[0].media);if(!media.items.length&&!media.thumbs.length)continue;
  const entry={id:row.listing_id,platform:row.platform,lot:row.lot,vin:row.vin_normalized,
   images:media.items.length?packMediaJson(JSON.stringify(media.items)):null,thumbs:media.thumbs.length?packMediaJson(JSON.stringify(media.thumbs)):null};
  if(Buffer.byteLength(JSON.stringify([...entries,entry]))>256000)break;entries.push(entry);
 }
 if(!entries.length)return {filled:0};
 const id=randomUUID(),result=await store.guarded([
  db.prepare('INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM server_feed_state s JOIN feed_catalog_pointer p ON p.singleton=s.singleton WHERE s.singleton=1 AND s.active_generation IS NULL AND s.committed_sequence=? AND p.baseline_id=?) THEN 1 ELSE 0 END)').bind(id,scope.committed_sequence,scope.baseline_id),
  db.prepare("UPDATE auction_listings AS l SET media_urls_json=json_extract(j.value,'$.images'),media_thumbs_json=json_extract(j.value,'$.thumbs') FROM json_each(?) j WHERE l.listing_id=json_extract(j.value,'$.id') AND l.platform=json_extract(j.value,'$.platform') AND l.lot=json_extract(j.value,'$.lot') AND l.vin_normalized=json_extract(j.value,'$.vin') AND l.identity_state='resolved' AND l.auction_state IN ('open','live') AND l.media_urls_json IS NULL AND l.media_thumbs_json IS NULL AND EXISTS(SELECT 1 FROM feed_catalog_membership m WHERE m.listing_id=l.listing_id AND m.baseline_id=? AND m.active=1)")
   .bind(JSON.stringify(entries),scope.baseline_id),
  db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(id)
 ]);
 const filled=Number(result?.[2]?.meta?.changes||0);
 if(filled){
  const key='feed-media-availability:v1';let prior=0;
  try{prior=JSON.parse((await store.task(key))?.cursor)?.filled||0;}catch{}
  await store.guarded([store.taskStatement({key,platform:'all',status:'complete',success:true,due:now,
   cursor:JSON.stringify({filled:prior+filled,lastBatch:filled,observedAt:new Date(now).toISOString()})})]);
 }
 return {filled};
}
module.exports={fillAvailableMedia};
