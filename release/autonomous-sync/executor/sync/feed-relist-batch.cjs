'use strict';
const {restoreVerifiedRelist,verifiedSource}=require('./feed-copart-relist.cjs');
// Reuse every existing per-lot identity, original-row and membership guard.
// Only defer their writes into one atomic batch; a conflict rolls back all lots.
async function restoreCachedBatch({db,store,keys,now}){
 if(!Array.isArray(keys)||!keys.length)return [];
 keys=[...new Set(keys)].slice(0,20);
 const published=await db.prepare("SELECT s.committed_sequence,p.baseline_id FROM server_feed_state s JOIN feed_catalog_pointer p ON p.singleton=s.singleton WHERE s.singleton=1 AND s.active_generation IS NULL").bind().first();
 if(!published)return [];
 const tasks=(await db.prepare("SELECT * FROM automatic_refresh_tasks WHERE task_key IN (SELECT value FROM json_each(?)) AND status='pending' AND next_due_at<=?").bind(JSON.stringify(keys),new Date(now()).toISOString()).all()).results;
 const statements=[],results=[];
 const staged=Object.create(store);
 staged.guarded=async items=>{statements.push(...items);return [];};
 for(const task of tasks){
  const c=JSON.parse(task.cursor),cached=c.sourceRecord;
  if(!cached||!verifiedSource(c.platform,c.lot,c.vin,c.relist,cached.raw,cached.observedAt,now()))continue;
  const known=await db.prepare("SELECT listing_id FROM auction_listings WHERE platform=? AND lot=? LIMIT 2").bind(c.platform,c.lot).all();
  if(known.results.length!==1)continue;
  const checkpoint=(status,extra={},delay=86400000)=>{
   const at=new Date(now()).toISOString();
   const receipt='feed-relist-receipt:v1:'+c.platform+':'+c.lot+':'+c.relist.sequence;
   const {sourceRecord,...evidence}=c;
   return db.prepare("UPDATE OR REPLACE automatic_refresh_tasks SET task_key=?,cursor=?,next_due_at=?,last_attempt_at=?,last_success_at=?,status=?,last_error_code=? WHERE task_key=? AND cursor=?")
    .bind(['complete','failed'].includes(status)?receipt:task.task_key,JSON.stringify({...evidence,...extra}),new Date(now()+delay).toISOString(),at,status==='complete'?at:null,status,extra.error||null,task.task_key,task.cursor);
  };
  results.push(await restoreVerifiedRelist({db,store:staged,published,task,c,raw:cached.raw,observedAt:cached.observedAt,now,checkpoint}));
 }
 if(statements.length)await store.guarded(statements);
 return results;
}
module.exports={restoreCachedBatch};
