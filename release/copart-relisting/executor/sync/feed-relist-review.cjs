'use strict';
const {readFeedBucket}=require('./feed-worker-archive.cjs');
const {prepareSparseQueue}=require('./feed-sparse-repair.cjs');
const {planInventoryChangeGroup}=require('./inventory-change-group.cjs');
const {BASELINE_FIELDS}=require('./inventory-change-patch.cjs');
const {relistEvidence}=require('./feed-copart-relist.cjs');

const WINDOW=1200,MAX_CANDIDATES=64;
// A bounded, one-off replay of a retained generation. The original receipts
// and importer cursor are immutable. Normal counted detail requests occur in
// the existing idle repair consumer after a candidate is queued.
async function reviewRetainedRelists({db,store,bucket,generationId,throughGeneration=generationId,startBucket=0,loadManifest,now,readBucket=readFeedBucket}){
 if(!Number.isSafeInteger(generationId)||generationId<1||!Number.isSafeInteger(throughGeneration)||throughGeneration<generationId||
  !Number.isInteger(startBucket)||startBucket<0||startBucket>127)throw Error('RELIST_REVIEW_CONFIG');
 const key='feed-relist-review:v1:'+generationId+':'+throughGeneration+':'+startBucket,task=await store.task(key);
 if(task?.status==='complete'||Date.parse(task?.next_due_at)>now())return null;
 const cursor=task?.cursor?JSON.parse(task.cursor):{page:0,offset:0,generationId};
 if(!Number.isInteger(cursor.page)||cursor.page<0||cursor.page>=128||!Number.isInteger(cursor.offset)||cursor.offset<0||
   !Number.isSafeInteger(cursor.generationId)||cursor.generationId<generationId||cursor.generationId>throughGeneration)throw Error('RELIST_REVIEW_CURSOR');
 const generation=await db.prepare(`SELECT g.* FROM server_feed_generations g JOIN server_feed_state s ON s.singleton=1
   WHERE g.generation_id=? AND g.status='complete' AND g.last_sequence<=s.committed_sequence AND s.active_generation IS NULL`).bind(cursor.generationId).first();
 if(!generation)return null;
 if(generation.retired_at || !generation.manifest_key || !generation.manifest_sha256){
  await store.guarded([store.taskStatement({key,platform:'all',cursor:JSON.stringify(cursor),due:now()+86400000,status:'blocked',error:'RELIST_REVIEW_MANIFEST_UNAVAILABLE'})]);
  return {available:false,reason:'manifest_unavailable'};
 }
 const manifest=await loadManifest(bucket,generation),index=(startBucket+cursor.page)%128;
 const part=await readBucket({bucket,manifest,bucketIndex:index,windowed:true,limits:{materialized:16*1024*1024}});
 if(cursor.offset>part.uniqueLots)throw Error('RELIST_REVIEW_PART_CHANGED');
 let through=cursor.offset,endAvailable=cursor.offset;const groups=[];
 while(through<part.uniqueLots && through-cursor.offset<WINDOW && groups.length<MAX_CANDIDATES){
   if(through===endAvailable)endAvailable=part.materializeWindow?.(through)??part.uniqueLots;
   if(endAvailable<=through)throw Error('RELIST_REVIEW_PART_CHANGED');
   const group=part.groups[through++],e=relistEvidence(group,generation.observed_at);
   if(e&&Date.parse(e.date)>now())groups.push(structuredClone(group));
 }
 const rows=groups.length?(await db.prepare(`SELECT ${BASELINE_FIELDS.map(field=>'l.'+field).join(',')},s.provider,s.identity_state AS source_identity_state,m.active,m.last_sequence FROM json_each(?) j CROSS JOIN auction_listings l
   LEFT JOIN vehicle_sources s ON s.source_key=l.source_key AND s.platform=l.platform
   JOIN feed_catalog_pointer p ON p.singleton=1 LEFT JOIN feed_catalog_membership m ON m.baseline_id=p.baseline_id AND m.listing_id=l.listing_id
   WHERE l.platform=json_extract(j.value,'$.platform') AND l.lot=json_extract(j.value,'$.lot')`)
   .bind(JSON.stringify(groups.map(g=>({platform:g.platform,lot:g.lot,sequence:relistEvidence(g,generation.observed_at).sequence})))).all()).results:[];
 const decisions=[];
 for(const group of groups){
   const match=rows.filter(r=>r.platform===group.platform&&r.lot===group.lot);
   const row=match[0]??null,evidence=relistEvidence(group,generation.observed_at);
   if(match.length>1||row&&(row.provider!=='apibara'||row.source_identity_state!=='resolved'||row.identity_state!=='resolved'||
    row.auction_state!=='ended'||row.active!==0||!(row.last_sequence<evidence.sequence)))continue;
   const plan=planInventoryChangeGroup({row,events:group.events,observedAt:generation.observed_at,quarantinedSequences:group.quarantinedSequences});
   if(!plan.identityError&&plan.reasons.some(reason=>['schedule_on_inactive_lot','unknown_lot'].includes(reason)))decisions.push({platform:group.platform,lot:group.lot,queued:true,identityError:false,reasons:plan.reasons});
 }
 const selected=groups.filter(g=>decisions.some(d=>d.platform===g.platform&&d.lot===g.lot));
 const prepared=selected.length?await prepareSparseQueue({db,store,groups:selected,decisions,generationId:cursor.generationId,observedAt:generation.observed_at}):{statements:[],queued:0};
 let position={...cursor,offset:through};
 if(through===part.uniqueLots){
  if(cursor.generationId===throughGeneration)position={page:cursor.page+1,offset:0,generationId};
  else{
   const next=await db.prepare('SELECT generation_id,first_sequence FROM server_feed_generations WHERE generation_id>? AND generation_id<=? ORDER BY generation_id LIMIT 1')
    .bind(cursor.generationId,throughGeneration).first();
   if(!next||next.first_sequence!==generation.last_sequence+1){
    await store.guarded([store.taskStatement({key,platform:'all',cursor:JSON.stringify(cursor),due:now()+3600000,status:'blocked',error:'RELIST_REVIEW_GAP'})]);
    return {reason:'retained_range_gap',available:false};
   }
   position={page:cursor.page,offset:0,generationId:next.generation_id};
  }
 }
 // RefreshStore.guarded fences the same executor lease used for both live import
 // and this review. A failed insert rolls back the private review position too.
 const done=position.page===128;
 const results=await store.guarded([...prepared.statements,store.taskStatement({key,platform:'all',cursor:JSON.stringify(position),due:now(),status:done?'complete':'partial',success:true})]);
 return {generationId:cursor.generationId,bucket:index,offset:through,queued:prepared.statements.length?results[1].meta.changes:0,done};
}
module.exports={reviewRetainedRelists};
