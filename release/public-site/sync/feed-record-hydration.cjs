'use strict';

// Complete-group full-record hydration precedes partial-event reduction under
// the caller's shared lease. Never advances a file/stream cursor. The caller
// must quarantine result.quarantined LOTs in its subsequent partial pass too.
const {createHash,randomUUID}=require('node:crypto');
const {parseChangesResponse}=require('../providers/apibara.js');
const {prepareInventoryPage}=require('./inventory-page.cjs');
const {commitInventoryBatch}=require('./inventory-commit.cjs');
const {LISTING_COLUMNS}=require('./feed-change-rollback.cjs');
const MAX_GROUPS=20,MAX_EVENTS=100000,MAX_CHECKPOINT_STATEMENTS=8;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const vin=value=>typeof value==='string'&&/^[A-HJ-NPR-Z0-9]{17}$/i.test(value);
const keyOf=value=>`${value.platform}:${value.lot}`;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Error(code);};
function zonedTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
 const date=new Date(`${value.slice(0,10)}T00:00:00Z`),time=Date.parse(value);
 if(!Number.isFinite(time)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value.slice(0,10)
   ||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)return NaN;
 return time;
}
function captureTime(value){
 const time=zonedTime(value);
 if(!Number.isFinite(time)||new Date(time).toISOString()!==value)fail('FEED_HYDRATION_CAPTURE_INVALID');
 return time;
}
function recordCandidate(raw,group,event,observedTime){
 if(!object(raw)||raw.platform!==group.platform||typeof raw.lot_number!=='string'||raw.lot_number!==group.lot
   ||!vin(raw.vin)||!vin(event.vehicle.vin)||raw.vin.toUpperCase()!==event.vehicle.vin.toUpperCase())return{identityError:true};
 const sourceTime=zonedTime(raw.updated_at);
 if(!Number.isFinite(sourceTime)||sourceTime>observedTime)return{invalid:'invalid_record_time'};
 // Missing volatile prices must not become implicit NULL clears under a newer
 // observation time. Enrichment/media may be omitted and are merged safely by
 // the existing full-observation writer. Explicit price nulls remain facts.
 if(!object(raw.auction)||!object(raw.pricing)
   ||!['current_bid_usd','current_bid2_usd','buy_now_usd'].every(key=>Object.hasOwn(raw.pricing,key)
     &&(raw.pricing[key]===null||typeof raw.pricing[key]==='number'&&Number.isFinite(raw.pricing[key])&&raw.pricing[key]>=0)))
  return{invalid:'incomplete_record'};
 const record=structuredClone(raw);
 record.vin=record.vin.toUpperCase();record.updated_at=new Date(sourceTime).toISOString();
 return{candidate:{platform:group.platform,lot:group.lot,eventSequence:event.sequence,sourceUpdatedAt:record.updated_at,
  recordSha256:hash(record),record},sourceTime};
}

function selectFeedRecordHydration({groups,observedAt}={}){
 const observedTime=captureTime(observedAt);
 if(!Array.isArray(groups)||!groups.length||groups.length>MAX_GROUPS)fail('FEED_HYDRATION_GROUPS_INVALID');
 const result={candidates:[],quarantined:[],skipped:[]},identities=new Set(),sequences=new Set(),ids=new Set();
 let total=0;
 for(const group of groups){
  if(!object(group)||!['copart','iaai'].includes(group.platform)||typeof group.lot!=='string'||!/^\d{1,20}$/.test(group.lot)
    ||identities.has(keyOf(group))||!Array.isArray(group.events)||!group.events.length||!Array.isArray(group.quarantinedSequences))fail('FEED_HYDRATION_GROUPS_INVALID');
  identities.add(keyOf(group));total+=group.events.length;if(total>MAX_EVENTS)fail('FEED_HYDRATION_GROUPS_INVALID');
  const quarantine=new Set(group.quarantinedSequences),eventVins=new Set(),reasons=new Set(),invalid=new Set();
  if(quarantine.size!==group.quarantinedSequences.length||group.quarantinedSequences.some(value=>!Number.isSafeInteger(value)||value<1))fail('FEED_HYDRATION_GROUPS_INVALID');
  let previous=0,newest=null;
  for(const event of group.events){
   if(!object(event)||event.vehicle?.platform!==group.platform||event.vehicle?.lot_number!==group.lot
     ||!Number.isSafeInteger(event.sequence)||event.sequence<=previous||sequences.has(event.sequence)||ids.has(event.event_id))fail('FEED_HYDRATION_GROUP_ORDER_INVALID');
   const flagged=quarantine.delete(event.sequence);
   if(flagged)reasons.add('quarantined_event');
   if(event.vehicle.vin!=null){if(!vin(event.vehicle.vin))reasons.add('invalid_event_vin');else eventVins.add(event.vehicle.vin.toUpperCase());}
   const safeEvent=flagged||event.vehicle.vin!=null&&!vin(event.vehicle.vin)?{...event,vehicle:{...event.vehicle,vin:null}}:event;
   parseChangesResponse({ok:true,data:[safeEvent],meta:{after:previous,next_cursor:event.sequence,has_more:false,count:1,
    ordering:'sequence_asc',schema_version:'file-hydration',retention_days:14}},{after:previous,limit:1});
   if(!Number.isFinite(zonedTime(event.recorded_at))||zonedTime(event.recorded_at)>observedTime)fail('FEED_HYDRATION_EVENT_TIME_INVALID');
   sequences.add(event.sequence);ids.add(event.event_id);previous=event.sequence;
   if(event.event!=='lot.created'||event.record==null)continue;
   const selected=recordCandidate(event.record,group,event,observedTime);
   if(selected.identityError){reasons.add('record_identity_conflict');continue;}
   if(selected.invalid){invalid.add(selected.invalid);continue;}
   eventVins.add(selected.candidate.record.vin);
   if(!newest||selected.sourceTime>newest.sourceTime)newest=selected;
   else if(selected.sourceTime===newest.sourceTime){
    if(selected.candidate.recordSha256!==newest.candidate.recordSha256)reasons.add('conflicting_record_version');
    else newest=selected;
   }
  }
  if(quarantine.size)fail('FEED_HYDRATION_GROUPS_INVALID');
  if(eventVins.size>1)reasons.add('group_vin_conflict');
  if(reasons.size){result.quarantined.push({platform:group.platform,lot:group.lot,reasons:[...reasons].sort()});continue;}
  if(newest)result.candidates.push(newest.candidate);
  else result.skipped.push({platform:group.platform,lot:group.lot,reason:invalid.size?[...invalid].sort().join(','):'no_full_record'});
 }
 return result;
}
function validReceiptKey(key){
 if(typeof key!=='string'||!/^file-hydration:[a-f0-9]{64}:(?:0|[1-9]\d*)(?::(?:0|[1-9]\d*))?$/.test(key))return false;
 return key.split(':').slice(2).every(value=>Number.isSafeInteger(Number(value)));
}
function validResult(result,groups,selection){
 const fields=['selected','quarantined','skipped','rejected','inserted','updated','continuityVerified','globalCursorEstablished'];
 if(!object(result)||Object.keys(result).length!==fields.length||fields.some(key=>!Object.hasOwn(result,key))
   ||!['selected','quarantined','skipped','rejected'].every(key=>Array.isArray(result[key])&&result[key].length<=groups.length)
   ||!['inserted','updated'].every(key=>Number.isSafeInteger(result[key])&&result[key]>=0)
   ||result.continuityVerified!==false||result.globalCursorEstablished!==false
   ||hash(result.selected)!==hash(selection.candidates.map(({record,...metadata})=>metadata)))return false;
 const known=new Set(groups.map(keyOf)),seen=new Set();
 for(const item of [...result.quarantined,...result.skipped,...result.rejected]){
  if(!object(item)||!known.has(keyOf(item))||seen.has(keyOf(item)))return false;
  seen.add(keyOf(item));
 }
 return result.inserted+result.updated+seen.size===groups.length;
}
function hydrationGuard(db,id,receiptKey,baselines){
 const extra=['hydration_provider','hydration_source_platform','hydration_source_identity_state'];
 const columns=baselines.some(group=>group.rows.some(row=>Object.hasOwn(row,'exterior_color')))
  ?[...LISTING_COLUMNS,'exterior_color']:LISTING_COLUMNS;
 const actual=[...columns.map(key=>`l.${key}`),'s.provider','s.platform','s.identity_state'];
 const expected=[...columns,...extra].map(key=>`json_extract(e.value,'$.${key}')`);
 const identity="l.platform IS json_extract(g.value,'$.platform') AND l.lot IS json_extract(g.value,'$.lot')";
 return db.prepare(`INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN
  NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?) AND
  NOT EXISTS(SELECT 1 FROM json_each(?) g WHERE
   (SELECT COUNT(*) FROM auction_listings l WHERE ${identity})<>json_array_length(g.value,'$.rows') OR
   EXISTS(SELECT 1 FROM json_each(g.value,'$.rows') e WHERE NOT EXISTS(
    SELECT 1 FROM auction_listings l LEFT JOIN vehicle_sources s ON s.source_key=l.source_key
     WHERE ${identity} AND (${actual.join(',')}) IS (${expected.join(',')})))) THEN 1 ELSE 0 END)`)
  .bind(id,receiptKey,JSON.stringify(baselines));
}

async function applyFeedRecordHydration({db,store,provider,groups,observedAt,receiptKey,freshnessPolicy,checkpointStatements=[]}={}){
 if(!db?.prepare||!db?.batch||store?.db!==db||!store.owner||typeof store.guarded!=='function'||typeof store.now!=='function'
   ||!validReceiptKey(receiptKey)||!Array.isArray(checkpointStatements)||checkpointStatements.length>MAX_CHECKPOINT_STATEMENTS)
  fail('FEED_HYDRATION_CONFIG_INVALID');
 try{groups=structuredClone(groups);}catch{fail('FEED_HYDRATION_GROUPS_INVALID');}
 const now=store.now();if(!Number.isFinite(now)||captureTime(observedAt)>now)fail('FEED_HYDRATION_CAPTURE_INVALID');
 const selection=selectFeedRecordHydration({groups,observedAt}),inputHash=hash({version:1,receiptKey,observedAt,groups});
 const saved=await db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').bind(receiptKey).first();
 if(saved){
  let marker;try{marker=JSON.parse(saved.cursor);}catch{fail('FEED_HYDRATION_RECEIPT_INVALID');}
  if(saved.platform!=='all'||saved.listing_id!==null||saved.status!=='complete'||marker?.version!==1||marker.inputHash!==inputHash
    ||marker.observedAt!==observedAt||!validResult(marker.result,groups,selection))fail('FEED_HYDRATION_RECEIPT_INVALID');
  return{alreadyApplied:true,inputHash,...marker.result};
 }
 const obtained=await db.prepare(`SELECT l.*,s.provider AS hydration_provider,s.platform AS hydration_source_platform,
  s.identity_state AS hydration_source_identity_state FROM json_each(?) g JOIN auction_listings l
   ON l.platform=json_extract(g.value,'$.platform') AND l.lot=json_extract(g.value,'$.lot')
  LEFT JOIN vehicle_sources s ON s.source_key=l.source_key ORDER BY l.platform,l.lot,l.listing_id`)
  .bind(JSON.stringify(groups.map(({platform,lot})=>({platform,lot})))).all();
 if(!Array.isArray(obtained?.results)||obtained.results.length>100
   ||obtained.results.some(row=>LISTING_COLUMNS.some(key=>!Object.hasOwn(row,key))))fail('FEED_HYDRATION_READ_INVALID');
 const rowsByKey=new Map();
 for(const row of obtained.results){const rows=rowsByKey.get(keyOf(row))||[];rows.push(row);rowsByKey.set(keyOf(row),rows);}
 const baselines=groups.map(group=>({platform:group.platform,lot:group.lot,rows:rowsByKey.get(keyOf(group))||[]}));
 const eligible=[],quarantined=[...selection.quarantined],skipped=[...selection.skipped];
 for(const candidate of selection.candidates){
  const rows=rowsByKey.get(keyOf(candidate))||[],row=rows[0];
  if(rows.length>1||row&&(!vin(row.vin_normalized)||row.identity_state!=='resolved'||row.vin_normalized.toUpperCase()!==candidate.record.vin
    ||row.hydration_provider!=='apibara'||row.hydration_source_platform!==row.platform||row.hydration_source_identity_state!=='resolved')){
   quarantined.push({platform:candidate.platform,lot:candidate.lot,reasons:['existing_identity_conflict']});continue;
  }
  const dates=row?['source_updated_at','summary_synced_at','detail_synced_at','last_seen_at'].map(key=>row[key]):[];
  if(dates.some(value=>value!==null&&!Number.isFinite(zonedTime(value)))){
   quarantined.push({platform:candidate.platform,lot:candidate.lot,reasons:['invalid_existing_time']});continue;
  }
  if(dates.some(value=>value!==null&&zonedTime(value)>=Date.parse(candidate.sourceUpdatedAt))){
   skipped.push({platform:candidate.platform,lot:candidate.lot,reason:'source_version_already_observed'});continue;
  }
  eligible.push(candidate);
 }
 // Reuse the one captured baseline in the existing full-observation planner.
 // The aggregate original-row guard below also fences prices/media that the
 // existing inventory commit's timestamp baseline does not include.
 const eligibleKeys=new Set(eligible.map(keyOf));
 const capturedDb={prepare(){return{bind(){return{async all(){return{results:obtained.results.filter(row=>eligibleKeys.has(keyOf(row)))};}};}};}};
 // Normalize only the canonical primary bid, after source selection/hashing.
 // Original records, group hashes and existing hydration receipts stay intact.
 // An explicit unavailable primary must not inherit a secondary bid fallback.
 const canonicalProvider=typeof provider?.toCanonicalVehicle==='function'?{...provider,toCanonicalVehicle(raw,normalized){
  const vehicle=provider.toCanonicalVehicle(raw,normalized);
  return raw.pricing?.current_bid_usd===0||raw.pricing?.current_bid_usd===null
   ?{...vehicle,pricing:{...vehicle.pricing,current_bid:null}}:vehicle;
 }}:provider;
 const prepared=await prepareInventoryPage({db:capturedDb,provider:canonicalProvider,records:eligible.map(item=>item.record),observedAt,
  processedAt:new Date(now).toISOString(),freshnessPolicy,observationTimeBasis:'source_updated_at'});
 const result={selected:selection.candidates.map(({record,...metadata})=>metadata),quarantined,skipped:[...skipped,...prepared.skipped],
  rejected:prepared.rejected,inserted:prepared.prepared.filter(item=>item.inserted).length,
  updated:prepared.prepared.filter(item=>!item.inserted).length,continuityVerified:false,globalCursorEstablished:false};
 if(!validResult(result,groups,selection))fail('FEED_HYDRATION_ACCOUNTING_INVALID');
 const at=new Date(now).toISOString(),marker={version:1,inputHash,observedAt,result};
 const receiptStatement=db.prepare(`INSERT INTO automatic_refresh_tasks
  (task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
  VALUES(?,'all',?,?,?,?,'complete')`).bind(receiptKey,JSON.stringify(marker),at,at,at);
 const guardId=randomUUID(),guard=hydrationGuard(db,guardId,receiptKey,baselines);
 const guardedStore={db,owner:store.owner,now:()=>store.now(),guarded:statements=>store.guarded([guard,...statements,
  db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(guardId)])};
 const committed=await commitInventoryBatch({db,store:guardedStore,prepared:prepared.prepared,
  checkpointStatements:[receiptStatement,...checkpointStatements]});
 return{alreadyApplied:false,inputHash,...result,committed:{...committed,statementCount:committed.statementCount+2}};
}

module.exports={MAX_GROUPS,MAX_CHECKPOINT_STATEMENTS,selectFeedRecordHydration,applyFeedRecordHydration};
