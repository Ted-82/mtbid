'use strict';
const {selectFeedRecordHydration}=require('./feed-record-hydration.cjs');
const {SERVER_MAX_GROUPS}=require('./feed-change-import.cjs');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const fullVin=s=>typeof s==='string'&&/^[A-HJ-NPR-Z0-9]{17}$/i.test(s);
const fail=()=>{throw Error('FEED_BOOTSTRAP_DELTA_INVALID');};
const validTime=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
function canonicalIdentity(row,group){
 return row&&typeof row.listing_id==='string'&&row.listing_id.length>0&&typeof row.source_key==='string'&&row.source_key.length>0
  &&row.platform===group.platform&&row.lot===group.lot&&row.identity_state==='resolved'&&fullVin(row.vin_normalized)
  &&row.provider==='apibara'&&row.source_platform===row.platform&&row.source_identity_state==='resolved';
}
function createdRecordEvidence(group,row,observedAt){
 if(!group.events.some(event=>event.event==='lot.created'&&event.record!=null))return null;
 // Reuse the existing pure complete-record selector: prices, identity, source
 // time, duplicate versions and quarantine must pass the hydration contract.
 const selected=selectFeedRecordHydration({groups:[group],observedAt});
 const candidate=selected.candidates[0];if(!candidate||selected.quarantined.length)return null;
 const record=candidate.record,state=record.auction.state?.toLowerCase?.();
 if(!['open','live'].includes(state)||row.auction_state!==state
  ||record.platform!==group.platform||record.lot_number!==group.lot
  ||record.vin!==row.vin_normalized.toUpperCase()||!validTime(row.source_updated_at)
  ||Date.parse(candidate.sourceUpdatedAt)!==Date.parse(row.source_updated_at)
  ||!validTime(row.summary_synced_at)||Date.parse(row.summary_synced_at)!==Date.parse(candidate.sourceUpdatedAt)
  ||['detail_synced_at','last_seen_at'].some(k=>row[k]!=null&&(!validTime(row[k])||Date.parse(row[k])>Date.parse(candidate.sourceUpdatedAt))))return null;
 return {sequence:candidate.eventSequence,active:true,state};
}
function createBootstrapDeltaExtension({membership,baselineId,after,through}={}){
 if(!membership?.db?.prepare||typeof membership.deltaFragmentStatements!=='function'
  ||typeof baselineId!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(baselineId)
  ||!integer(after)||!integer(through)||through<=after)fail();
 return {key:'membership:'+baselineId,async prepare({db,store,receipt,plannedRows,decisions}={}){
  if(db!==membership.db||store!==membership.store||!Array.isArray(receipt?.groups)||!receipt.groups.length
   ||receipt.groups.length>SERVER_MAX_GROUPS||!Array.isArray(plannedRows)||plannedRows.length!==receipt.groups.length
   ||!Array.isArray(decisions)||decisions.length!==receipt.groups.length
   ||typeof receipt.batchSha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.batchSha256))fail();
  // Freeze extension inputs before the one indexed lookup yields control.
  const groups=structuredClone(receipt.groups),planned=structuredClone(plannedRows),batchSha256=receipt.batchSha256,observedAt=receipt.observedAt;
  const ids=[];
  for(let i=0;i<groups.length;i++){
   const group=groups[i],p=planned[i];
   if(!p||p.platform!==group.platform||p.lot!==group.lot||typeof p.identityError!=='boolean'
    ||!Array.isArray(group.events)||!group.events.length||!group.events.every(e=>integer(e.sequence)&&e.sequence>after&&e.sequence<=through))fail();
   if(p.afterRow?.listing_id)ids.push(p.afterRow.listing_id);
  }
  const result=ids.length?await db.prepare(`SELECT listing_id,active,last_sequence FROM feed_catalog_membership
   WHERE baseline_id=? AND listing_id IN(SELECT json_extract(value,'$.listingId') FROM json_each(?))`)
   .bind(baselineId,JSON.stringify(ids.map(listingId=>({listingId})))).all():{results:[]};
  if(!Array.isArray(result?.results))fail();const prior=new Map();
  for(const row of result.results){if(!ids.includes(row.listing_id)||prior.has(row.listing_id)||![0,1].includes(row.active)||!integer(row.last_sequence))fail();prior.set(row.listing_id,row);}
  // The importer uses null for both zero and ambiguous canonical matches.
  // Prove zero rows in one indexed lookup before ignoring an absent terminal;
  // its existing atomic original-row/count guard fences this read at commit.
  const terminalMissing=groups.filter((group,index)=>planned[index].afterRow===null&&group.events.at(-1).terminal===true);
  const existingTerminalKeys=new Set();
  if(terminalMissing.length){
   const inputKeys=new Set(terminalMissing.map(group=>group.platform+':'+group.lot));
   const found=await db.prepare(`SELECT DISTINCT l.platform,l.lot FROM json_each(?) g CROSS JOIN auction_listings l
    ON l.platform=json_extract(g.value,'$.platform') AND l.lot=json_extract(g.value,'$.lot')`)
    .bind(JSON.stringify(terminalMissing.map(({platform,lot})=>({platform,lot})))).all();
   if(!Array.isArray(found?.results)||found.results.length>terminalMissing.length)fail();
   for(const row of found.results){const k=row.platform+':'+row.lot;if(!inputKeys.has(k)||existingTerminalKeys.has(k))fail();existingTerminalKeys.add(k);}
  }
  const changes=[];let unresolvedCount=0;
  for(let index=0;index<groups.length;index++){
   const group=groups[index],p=planned[index],row=p.afterRow,last=group.events.at(-1);
   if(!row){
    if(row===null&&last.terminal===true&&!existingTerminalKeys.has(group.platform+':'+group.lot))continue;
    unresolvedCount++;continue;
   }
   if(p.identityError||group.quarantinedSequences?.length){unresolvedCount++;continue;}
   if(!canonicalIdentity(row,group)){unresolvedCount++;continue;}
   const member=prior.get(row.listing_id);
   if(member&&member.last_sequence>=last.sequence)continue;
   let evidence=p.plan?.acceptedEligibility??null;
   const created=createdRecordEvidence(group,row,observedAt);
   if(created&&(!evidence||created.sequence>evidence.sequence))evidence=created;
   if(evidence){
    if(!integer(evidence.sequence)||evidence.sequence<=after||evidence.sequence>through
     ||typeof evidence.active!=='boolean'&&evidence.active!==null)fail();
    if(evidence.active===null){unresolvedCount++;continue;}
    if(row.auction_state!==evidence.state){unresolvedCount++;continue;}
    changes.push({listingId:row.listing_id,sourceKey:row.source_key,platform:row.platform,lot:row.lot,
     vin:row.vin_normalized.toUpperCase(),sequence:evidence.sequence,active:evidence.active,
     expected:{updatedAt:row.updated_at,sourceUpdatedAt:row.source_updated_at,summarySyncedAt:row.summary_synced_at,
      detailSyncedAt:row.detail_synced_at,auctionState:row.auction_state}});
   }else if(!member)unresolvedCount++;
   // Known membership survives bid-only, ignored-stale and unrelated partial
   // changes. Absent membership remains absent and must be reconciled.
  }
  const prepared=await membership.deltaFragmentStatements({baselineId,after,through,batchSha256,changes,unresolvedCount});
  if(!Array.isArray(prepared?.statements)||prepared.statements.length!==4)fail();return prepared.statements;
 }};
}
module.exports={createBootstrapDeltaExtension};
