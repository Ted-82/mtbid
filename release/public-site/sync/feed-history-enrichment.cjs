'use strict';
const {importTargetedHistory}=require('../scripts/targeted-history-import.cjs');
const {PREFIX}=require('./history-request.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
async function enrichRequestedHistory({db,store,getRequest,now}){
 const at=new Date(now()).toISOString();
 const tasks=(await db.prepare(`SELECT task_key,platform,listing_id,cursor,failures FROM automatic_refresh_tasks
  WHERE task_key>=? AND task_key<? AND status='pending' AND next_due_at<=? ORDER BY task_key LIMIT 1`).bind(PREFIX,PREFIX+'~',at).all()).results;
 if(!tasks?.length)return null;
 const task=tasks[0];
 const saved=await db.prepare('SELECT l.platform,l.lot,l.vin_normalized,l.auction_state,s.provider FROM auction_listings l JOIN vehicle_sources s ON s.source_key=l.source_key WHERE l.listing_id=?').bind(task.listing_id).first();
 const checkpoint=(status,due,cursor=task.cursor,error=null)=>store.taskStatement({key:task.task_key,platform:task.platform,listingId:task.listing_id,status,due,cursor,error,success:status==='complete'});
 try{
  if(!saved||saved.platform!==task.platform||saved.provider!=='apibara'||!/^[A-HJ-NPR-Z0-9]{17}$/.test(saved.vin_normalized||'')||!/^\d{1,20}$/.test(saved.lot||''))throw Error('HISTORY_TARGET_CHANGED');
  const expected={platform:saved.platform,lot:saved.lot,vin:saved.vin_normalized,listingId:task.listing_id};
  const request=await getRequest();
  // VIN plus strict LOT/platform validation avoids numeric LOT collisions.
  let mode=task.cursor?'paginated':'included';
  let {response,observedAt}=await request(mode==='included'
   ?{operation:'vehicleByIdentifier',identifier:expected.vin,platform:expected.platform,include:'history'}
   :{operation:'vehicleHistory',identifier:expected.vin,platform:expected.platform,per_page:20,cursor:task.cursor});
  // Large VIN-wide histories use the documented bounded page operation.
  if(mode==='included'&&response?.data?.history?.length>100){
   mode='paginated';({response,observedAt}=await request({operation:'vehicleHistory',identifier:expected.vin,platform:expected.platform,per_page:20}));
  }
  const guardedDb={prepare:sql=>db.prepare(sql),async batch(statements){const result=await store.guarded(statements);return result.slice(1,-1);}};
  const imported=await importTargetedHistory(guardedDb,{response,expected,observedAt,mode});
  if(mode==='included'){
   const provider=createApibaraProvider(),raw=provider.vehicleDetailRecord(response),n=provider.normalizeVehicle(raw);
   const document=String(raw?.sale_document?.source_name||'').trim(),short=String(raw?.sale_document?.name||'').trim();
   const statements=[];
   // Enrich only missing/richer stable fields. Never refresh bid, sale result,
   // auction date or listing freshness from a history observation.
   if(document&&document.length<=300&&short)statements.push(db.prepare(`UPDATE auction_listings SET document_name=?
    WHERE listing_id=? AND platform=? AND lot=? AND vin_normalized=? AND (document_name IS NULL OR document_name=?)`)
    .bind(document,expected.listingId,expected.platform,expected.lot,expected.vin,short));
   if(n?.sellerName)statements.push(db.prepare(`UPDATE auction_listings SET seller_name=?
    WHERE listing_id=? AND platform=? AND lot=? AND vin_normalized=? AND seller_name IS NULL`)
    .bind(n.sellerName,expected.listingId,expected.platform,expected.lot,expected.vin));
   if(statements.length)await store.guarded(statements);
  }
  const more=!!imported.nextCursor;
  await store.guarded([checkpoint(more?'pending':'complete',now()+(more?15*60000:saved.auction_state==='open'||saved.auction_state==='live'?6*3600000:7*86400000),imported.nextCursor)]);
  return{platform:expected.platform,lot:expected.lot,events:imported.events,complete:imported.complete,hasMore:more};
 }catch(e){
  const code=/^[A-Z_]{2,80}$/.test(e.code||e.message||'')?e.code||e.message:'HISTORY_ENRICHMENT_FAILED';
  const terminal=/IDENTITY|MISMATCH|TARGET_CHANGED|INVALID_ENVELOPE|EVENT_CONFLICT/.test(code);
  await store.guarded([checkpoint(terminal?'failed':'pending',now()+Math.min(3600000,15*60000*2**Math.min(task.failures||0,2)),task.cursor,code)]);
  return{error:code};
 }
}
module.exports={enrichRequestedHistory};
