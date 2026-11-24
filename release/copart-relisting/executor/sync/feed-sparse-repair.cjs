'use strict';
const {randomUUID}=require('node:crypto');
const {prepareInventoryPage}=require('./inventory-page.cjs');
const {commitInventoryBatch}=require('./inventory-commit.cjs');
const {POLICY}=require('./automatic-refresh.cjs');
const {relistEvidence,verifiedSource,restoreVerifiedRelist}=require('./feed-copart-relist.cjs');
const PREFIX='feed-sparse:v1:',CLOCK='feed-sparse:clock:v1',CAP=128,INTERVAL=15*60000;
const RELIST_PREFIX='feed-verify-relist:v1:',RELIST_CLOCK='feed-verify-relist-clock:v1';
const fields={'pricing.current_bid_usd':'current_bid_usd','pricing.current_bid2_usd':'current_bid2_usd','pricing.buy_now_usd':'buy_now_usd'};
const fullVin=v=>typeof v==='string'&&/^[A-HJ-NPR-Z0-9]{17}$/.test(v);
const iso=t=>new Date(t).toISOString();
function candidate(group,generationId,observedAt,prior=null){
 if(!['copart','iaai'].includes(group?.platform)||!/^\d{1,20}$/.test(group.lot||'')||group.quarantinedSequences?.length)return null;
 const events=group.events||[],vins=new Set(events.map(e=>e.vehicle?.vin).filter(fullVin));
 if(vins.size!==1||events.some(e=>e.vehicle?.vin&&!fullVin(e.vehicle.vin)))return null;
 const vin=[...vins][0];if(prior&&prior.vin!==vin){
  const last=events.at(-1)?.sequence||0;return last>prior.sequence?{...prior,conflict:true,generationId,observedAt,sequence:last}:null;
 }
 const result=prior?structuredClone(prior):{platform:group.platform,lot:group.lot,vin,activeEvidence:false,terminal:false,prices:{}};
 let sequence=result.sequence||0;
 for(const e of events){
  if(e.vehicle?.platform!==group.platform||String(e.vehicle.lot_number)!==group.lot||e.sequence<=sequence)continue;
  const recorded=Date.parse(e.recorded_at),version=Date.parse(e.vehicle_updated_at||e.recorded_at);
  if(!Number.isFinite(recorded)||!Number.isFinite(version)||recorded>Date.parse(observedAt)||version>Date.parse(observedAt))return null;
  const a=e.after||{};
  const terminal=e.terminal||['auction.ended','lot.sold','lot.not_sold','lot.removed'].includes(e.event)
   ||/^(ended|finished|closed|sold|removed|not_sold)$/i.test(a['auction.state']||'');
  const active=['open','live'].includes(a['auction.state'])||a['auction.upcoming']===1||a['auction.upcoming']===true
   ||a['auction.is_buy_now']===1||a['auction.is_buy_now']===true
   ||Date.parse(a['auction.auction_at'])>Date.parse(observedAt);
  if((terminal||active)&&(!result.eligibilityVersion||version>=Date.parse(result.eligibilityVersion))){
   result.eligibilityVersion=iso(version);
   result.terminal=Boolean(terminal);result.activeEvidence=!terminal;
  }
  for(const [k,column]of Object.entries(fields))if(Object.hasOwn(a,k)){
   if(a[k]!==null&&(typeof a[k]!=='number'||!Number.isFinite(a[k])||a[k]<0))return null;
   const previous=result.prices[column];
   if(!previous||version>Date.parse(previous.version)||version===Date.parse(previous.version)&&e.sequence>previous.sequence)
    result.prices[column]={value:a[k],version:iso(version),sequence:e.sequence};
  }
  sequence=e.sequence;
 }
 return{...result,generationId,observedAt,sequence};
}
async function prepareSparseQueue({db,store,groups,decisions,generationId,observedAt}){
 const missing=new Set(decisions.filter(x=>x.queued&&!x.identityError&&x.reasons?.includes('unknown_lot')).map(x=>x.platform+':'+x.lot));
 const rescheduled=new Set(decisions.filter(x=>x.queued&&!x.identityError&&x.reasons?.includes('schedule_on_inactive_lot')).map(x=>x.platform+':'+x.lot));
 const keys=groups.flatMap(g=>[PREFIX+g.platform+':'+g.lot,RELIST_PREFIX+g.platform+':'+g.lot]);
 if(!keys.length)return{statements:[],queued:0};
 const priorRows=(await db.prepare('SELECT task_key,cursor,status FROM automatic_refresh_tasks WHERE task_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all()).results;
 const old=new Map(priorRows.map(r=>[r.task_key,r]));
 const relevant=groups.filter(g=>missing.has(g.platform+':'+g.lot)||rescheduled.has(g.platform+':'+g.lot)||
   [PREFIX,RELIST_PREFIX].some(prefix=>old.get(prefix+g.platform+':'+g.lot)?.status==='pending'));
 if(!relevant.length)return{statements:[],queued:0};
 const pending=missing.size?await db.prepare("SELECT COUNT(*) AS n FROM automatic_refresh_tasks WHERE task_key>=? AND task_key<? AND status='pending'").bind(PREFIX,PREFIX+'~').first():{n:0};
 let slots=Math.max(0,CAP-pending.n);const entries=[];
 for(const group of relevant){
  const identity=group.platform+':'+group.lot;
  const relist=(rescheduled.has(identity)||missing.has(identity))?relistEvidence(group,observedAt):null;
  if(relist&&missing.has(identity))relist.missing=true;
  const trackRelist=Boolean(relist)||old.get(RELIST_PREFIX+identity)?.status==='pending';
  const key=(trackRelist?RELIST_PREFIX:PREFIX)+identity,prior=old.has(key)?JSON.parse(old.get(key).cursor):null;
  if(trackRelist&&!relist&&!group.events.some(e=>e.terminal||e.event==='auction.ended'||e.event==='auction.rescheduled'||
    Object.keys(e.after||{}).some(k=>Object.hasOwn(fields,k)||k==='auction.state'||k==='auction.lot_removed')))continue;
  const identityChanged=Boolean(relist&&prior&&relist.vin!==prior.vin);
  const next=candidate(group,generationId,observedAt,relist&&!identityChanged?null:prior);
  if(relist&&next&&!identityChanged)next.relist=relist;
  if(next?.relist&&group.events.some(e=>e.sequence>next.relist.sequence &&
   (e.terminal||e.event==='auction.ended'||e.event==='auction.rescheduled'||
   ['lot.sold','lot.not_sold','lot.removed'].includes(e.event)))){
   next.terminal=true;next.activeEvidence=false;
  }
  if(!next||!next.activeEvidence&&!prior||prior?.sequence>=next.sequence)continue;
  const alreadyPending=old.get(key)?.status==='pending';if(!trackRelist&&!alreadyPending&&!slots)continue;if(!trackRelist&&!alreadyPending)slots--;
  entries.push({key,platform:group.platform,lot:group.lot,cursor:JSON.stringify(next),sequence:next.sequence,relist:next.relist!=null});
 }
 if(!entries.length)return{statements:[],queued:0};
 const at=iso(store.now()),statement=db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,status,cursor,next_due_at,last_attempt_at)
  SELECT json_extract(x.value,'$.key'),json_extract(x.value,'$.platform'),NULL,'pending',json_extract(x.value,'$.cursor'),?,? FROM json_each(?) x
  WHERE (((json_extract(x.value,'$.relist')=0 OR json_extract(json_extract(x.value,'$.cursor'),'$.relist.missing')=1) AND NOT EXISTS(SELECT 1 FROM auction_listings l INDEXED BY idx_listings_lot_recent WHERE l.platform=json_extract(x.value,'$.platform') AND l.lot=json_extract(x.value,'$.lot')))
   OR (json_extract(x.value,'$.relist')=1 AND EXISTS(SELECT 1 FROM auction_listings l INDEXED BY idx_listings_lot_recent WHERE l.platform=json_extract(x.value,'$.platform') AND l.lot=json_extract(x.value,'$.lot')
    AND l.auction_state='ended' AND l.identity_state='resolved' AND l.vin_normalized=json_extract(json_extract(x.value,'$.cursor'),'$.vin'))))
   AND EXISTS(SELECT 1 FROM server_feed_generations g WHERE g.generation_id=? AND g.status IN ('applying','complete')
    AND json_extract(x.value,'$.sequence') BETWEEN g.first_sequence AND g.last_sequence)
   AND (json_extract(x.value,'$.relist')=0 OR NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks proof WHERE proof.task_key=
    'feed-relist-receipt:v1:'||json_extract(x.value,'$.platform')||':'||json_extract(x.value,'$.lot')||':'||
    json_extract(json_extract(x.value,'$.cursor'),'$.relist.sequence')))
  ON CONFLICT(task_key) DO UPDATE SET cursor=excluded.cursor,status='pending',next_due_at=excluded.next_due_at
   WHERE json_extract(automatic_refresh_tasks.cursor,'$.sequence')<json_extract(excluded.cursor,'$.sequence')`)
  .bind(at,at,JSON.stringify(entries),generationId);
 return{statements:[statement],queued:entries.length};
}
async function queueSparseGroups(options){const p=await prepareSparseQueue(options);if(!p.statements.length)return{queued:0};
 const results=await options.store.guarded(p.statements);return{queued:results[1].meta.changes};}
function extendSparseRecovery(extension,{generationId,observedAt}){
 return{...extension,sparseRepair:true,async prepare(context){
  const original=await extension.prepare(context),extra=await prepareSparseQueue({db:context.db,store:context.store,groups:context.receipt.groups,decisions:context.decisions,generationId,observedAt});
  return[...original,...extra.statements];
 }};
}
function projectPrices(raw,c){
 const copy=structuredClone(raw),sourceAt=Date.parse(raw.updated_at),applied=[];
 if(!Number.isFinite(sourceAt))throw Error('FEED_SPARSE_SOURCE_TIME');
 copy.pricing={...copy.pricing};
 for(const [field,p]of Object.entries(c.prices))if(fields['pricing.'+field]&&Date.parse(p.version)>sourceAt){
  copy.pricing[field]=p.value;applied.push({field,value:p.value,sequence:p.sequence,version:p.version});
 }
 // Keep the real metadata source clock; price evidence has its own receipt.
 return{record:copy,applied};
}
function indexedLotReads(db){return{prepare(sql){
 if(sql.startsWith('SELECT * FROM auction_listings WHERE '))sql=sql.replace('FROM auction_listings WHERE ','FROM auction_listings INDEXED BY idx_listings_lot_recent WHERE ');
 return db.prepare(sql);
}};}
async function repairSparseCatalog({db,store,getRequest,adapter,now,onProgress=()=>{},relistOnly=false}){
 const prefix=relistOnly?RELIST_PREFIX:PREFIX,clockKey=relistOnly?RELIST_CLOCK:CLOCK;
 const started=now(),clock=await store.task(clockKey);if(Date.parse(clock?.next_due_at)>started)return null;
 const published=await db.prepare(`SELECT g.generation_id,g.status,g.observed_at,s.committed_sequence,p.baseline_id
  FROM server_feed_generations g CROSS JOIN server_feed_state s CROSS JOIN feed_catalog_pointer p
  WHERE s.singleton=1 AND p.singleton=1 AND s.active_generation IS NULL AND g.generation_id=(SELECT MAX(generation_id) FROM server_feed_generations)
   AND g.last_sequence=s.committed_sequence`).bind().first();
 if(published?.status!=='complete'||typeof published.baseline_id!=='string'||!Number.isSafeInteger(published.committed_sequence)
  ||!Number.isFinite(Date.parse(published.observed_at))||Date.parse(published.observed_at)>started||started-Date.parse(published.observed_at)>75*60000)return null;
 const tasks=relistOnly?await dueRelists(db,store,clock,started):(await db.prepare(`SELECT * FROM automatic_refresh_tasks WHERE task_key>=? AND task_key<? AND status='pending' AND next_due_at<=? ORDER BY last_attempt_at,task_key LIMIT 1`).bind(prefix,prefix+'~',iso(started)).all()).results;
 if(!tasks?.length)return null;
 const task=tasks[0],c=JSON.parse(task.cursor);
 const known=relistOnly?await db.prepare(`SELECT l.listing_id,l.auction_state,l.vin_normalized,m.active,m.last_sequence FROM auction_listings l
   LEFT JOIN feed_catalog_membership m ON m.baseline_id=? AND m.listing_id=l.listing_id WHERE l.platform=? AND l.lot=?`)
   .bind(published.baseline_id,c.platform,c.lot).first():await db.prepare('SELECT listing_id FROM auction_listings WHERE platform=? AND lot=?').bind(c.platform,c.lot).first();
 const progress=phase=>{try{onProgress({phase,platform:c.platform,lot:c.lot,at:iso(now())});}catch{}};
 if(task.task_key!==prefix+c.platform+':'+c.lot||task.platform!==c.platform||!fullVin(c.vin)||!Number.isSafeInteger(c.sequence)||relistOnly!==Boolean(c.relist))throw Error('FEED_SPARSE_CURSOR');
 const checkpoint=(status,extra={},delay=86400000)=>{
  if(relistOnly&&['complete','failed'].includes(status)){
   const at=iso(now()),receipt='feed-relist-receipt:v1:'+c.platform+':'+c.lot+':'+c.relist.sequence;
   return db.prepare(`UPDATE OR REPLACE automatic_refresh_tasks SET task_key=?,cursor=?,next_due_at=?,last_attempt_at=?,
    last_success_at=?,status=?,last_error_code=? WHERE task_key=? AND cursor=?`).bind(receipt,JSON.stringify({...c,...extra}),iso(now()+delay),at,
     status==='complete'?at:null,status,extra.error||null,task.task_key,task.cursor);
  }
  return store.taskStatement({key:task.task_key,platform:c.platform,cursor:JSON.stringify({...c,...extra}),due:now()+delay,status,error:extra.error||null,success:status==='complete'});
 };
 // Pending identities observe every later group, including terminal-only groups.
 // A quiet lot need not emit a fresh event merely to remain eligible; the global
 // published boundary and a current detail response establish continuity.
 const checkingRelist=c.relist!=null&&Boolean(known);
 if(checkingRelist&&(known.active!==0||known.auction_state!=='ended'||known.last_sequence>=c.relist.sequence||known.vin_normalized!==c.vin)){
  await store.guarded([checkpoint('complete',{outcome:'superseded_in_catalog'})]);return{skipped:true};
 }
 if((c.relist?!known&&!c.relist.missing:known)||c.conflict||c.terminal||!c.activeEvidence||c.sequence>published.committed_sequence){await store.guarded([checkpoint('complete',{outcome:known?'already_known':'not_current'})]);return{skipped:true};}
 // Reserve cooldown before transport, so retries cannot create a request storm.
 await store.guarded([store.taskStatement({key:clockKey,platform:'all',cursor:relistOnly?task.task_key:null,due:relistOnly?started:started+INTERVAL,status:'complete',success:true})]);
 try{
  const request=await getRequest(),byId=identifier=>request({operation:'vehicleByIdentifier',identifier,platform:c.platform});
  let response,observedAt;
  if(relistOnly){
   try{({response,observedAt}=await byId(c.lot));}
   catch(error){if((error.code||error.message)!=='NOT_FOUND')throw error;}
   const first=response&&adapter.vehicleDetailRecord(response);
   if(!first || first.platform!==c.platform || String(first.lot_number)!==c.lot || first.vin!==c.vin){
    ({response,observedAt}=await byId(c.vin));
   }
  }else ({response,observedAt}=await byId(c.vin));
  const raw=adapter.vehicleDetailRecord(response);
  progress('source_received');
  if(raw?.platform!==c.platform||String(raw.lot_number)!==c.lot||raw.vin!==c.vin)throw Error('FEED_SPARSE_IDENTITY');
  if(checkingRelist)return await restoreVerifiedRelist({db,store,published,task,c,raw,observedAt,now,checkpoint});
  if(relistOnly&&!verifiedSource(c.platform,c.lot,c.vin,c.relist,raw,observedAt,now())){
   const ended=raw.auction?.result_confirmed===true||raw.auction?.lot_removed===true||Date.parse(c.relist.date)<=now();
   await store.guarded([checkpoint(ended?'complete':'pending',{outcome:ended?'source_not_active':'source_unconfirmed'},3600000)]);
   return {platform:c.platform,lot:c.lot,skipped:true};
  }
  const end=raw.auction?.timed_end_at||raw.auction?.auction_at||raw.auction?.full_date;
  if(!['open','live'].includes(raw.auction?.state)||raw.auction?.lot_removed||raw.auction?.result_confirmed||!(Date.parse(end)>now())){
   await store.guarded([checkpoint('complete',{outcome:'source_not_active'})]);return{platform:c.platform,lot:c.lot,skipped:true};
  }
  const {record,applied}=projectPrices(raw,c);
  progress('preparing');
  const plan=await prepareInventoryPage({db:indexedLotReads(db),provider:{...adapter,toCanonicalVehicle(raw,n){const vehicle=adapter.toCanonicalVehicle(raw,n);return raw.pricing?.current_bid_usd===0||raw.pricing?.current_bid_usd===null?{...vehicle,pricing:{...vehicle.pricing,current_bid:null}}:vehicle;}},records:[record],platform:c.platform,observedAt,processedAt:iso(now()),freshnessPolicy:POLICY});
  const prepared=plan.prepared.filter(x=>x.inserted&&['open','live'].includes(x.record.vehicle.auction.state));
  progress('prepared');
  if(prepared.length!==1)throw Error('FEED_SPARSE_NOT_INSERTABLE');
  const item=prepared[0],guardId=randomUUID(),newKey='new:'+iso(now()).slice(0,10);
  const guard=db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
   EXISTS(SELECT 1 FROM server_feed_state s JOIN feed_catalog_pointer p ON p.singleton=s.singleton WHERE s.singleton=1
    AND s.active_generation IS NULL AND s.committed_sequence=? AND p.baseline_id=?)
   AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND cursor=? AND status='pending')
   AND EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key=? AND consumed<limit_count)
   THEN 1 ELSE 0 END)`).bind(guardId,published.committed_sequence,published.baseline_id,task.task_key,task.cursor,newKey);
  progress('committing');
  await commitInventoryBatch({db,store,prepared,checkpointStatements:[guard,
   db.prepare('INSERT INTO feed_catalog_membership(baseline_id,listing_id,active,last_sequence) VALUES(?,?,1,?)').bind(published.baseline_id,item.record.identity.listingId,published.committed_sequence),
   db.prepare('UPDATE automatic_refresh_budgets SET consumed=consumed+1 WHERE budget_key=?').bind(newKey),
   checkpoint('complete',{outcome:'inserted',listingId:item.record.identity.listingId,sourceUpdatedAt:raw.updated_at,observedAt,feedSequence:published.committed_sequence,projectedPrices:applied}),
   db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(guardId)]});
  progress('committed');
  return{platform:c.platform,lot:c.lot,inserted:true,projectedPrices:applied.length};
 }catch(e){
  const code=/^[A-Z_]{2,80}$/.test(e.code||e.message||'')?e.code||e.message:'FEED_SPARSE_FAILED';
  if(/COMMIT_FAILED|WRITE_FAILED/.test(code))throw e;
  if(relistOnly&&['RELIST_REQUEST_RESERVE','AUTOMATIC_REFRESH_BUDGET_STOP','AUTOMATIC_REFRESH_QUOTA_RESERVE','SERVER_FEED_API_RATE_PAUSED','SERVER_FEED_API_AUTH_BLOCKED'].includes(code))
   return {error:code,deferred:true};
  await store.guarded([checkpoint(code.includes('IDENTITY')?'failed':'pending',{error:code},3600000)]);return{error:code};
 }
}
async function dueRelists(db,store,clock,started){
 const after=clock?.cursor?.startsWith(RELIST_PREFIX)?clock.cursor:RELIST_PREFIX;
 const read=async start=>(await db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key>? AND task_key<? ORDER BY task_key LIMIT 32')
   .bind(start,RELIST_PREFIX+'~').all()).results;
 let rows=await read(after);if(!rows.length&&after!==RELIST_PREFIX)rows=await read(RELIST_PREFIX);
 const due=rows.find(row=>row.status==='pending'&&Date.parse(row.next_due_at)<=started);
 if(due)return [due];
 if(rows.length)await store.guarded([store.taskStatement({key:RELIST_CLOCK,platform:'all',cursor:rows.at(-1).task_key,due:started,status:'complete',success:true})]);
 return [];
}
module.exports={queueSparseGroups,prepareSparseQueue,extendSparseRecovery,repairSparseCatalog,projectPrices,indexedLotReads,candidate,PREFIX,CAP,CLOCK,RELIST_PREFIX};
