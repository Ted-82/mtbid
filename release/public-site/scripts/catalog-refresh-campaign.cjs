'use strict';
// Explicit operator campaign only. No default transport, credentials or Worker route.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {prepareObservation}=require('../sync/publication-refresh.cjs');
const {D1SyncRepository,knownObservationStatements}=require('../sync/d1-repository.js');
const {importTargetedHistory,HISTORY_RECEIPT_SQL}=require('./targeted-history-import.cjs');
const fullVin=value=>/^[A-HJ-NPR-Z0-9]{17}$/.test(String(value||'').toUpperCase());
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeCode=e=>/^[A-Z][A-Z0-9_]{1,80}$/.test(e?.code||e?.message||'')?(e.code||e.message):'CAMPAIGN_FAILED';
function durable(file,row){const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function atomicJson(file,value){const next=file+'.next';const fd=fs.openSync(next,'w');try{fs.writeSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(next,file);}
class CatalogJournal {
 constructor({directory,baseAttempts,maxRequests,references=[],targetHash}){
  if(!Number.isSafeInteger(baseAttempts)||baseAttempts<0||!Number.isSafeInteger(maxRequests)||maxRequests<1||!targetHash)throw Error('CATALOG_BUDGET_INVALID');
  fs.mkdirSync(directory,{recursive:true});this.directory=directory;this.file=path.join(directory,'transport-ledger.ndjson');
  const config={baseAttempts,maxRequests,targetHash,references:references.map(file=>({file,sha256:hash(fs.readFileSync(file))}))};
  const file=path.join(directory,'campaign.json');if(fs.existsSync(file)){if(JSON.stringify(JSON.parse(fs.readFileSync(file)))!==JSON.stringify(config))throw Error('CATALOG_RESUME_MANIFEST_CHANGED');}
  else atomicJson(file,config);this.config=config;this.rows=fs.existsSync(this.file)?fs.readFileSync(this.file,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse):[];
 }
 append(row){durable(this.file,row);this.rows.push(row);}
 attempts(){return this.rows.filter(x=>x.kind==='attempt');}
 completed(key){return this.rows.some(x=>x.kind==='finished'&&x.key===key);}
 finish(key,result){this.append({kind:'finished',key,at:new Date().toISOString(),...result});}
 assertAvailable(){
  for(const ref of this.config.references)if(hash(fs.readFileSync(ref.file))!==ref.sha256)throw Error('PREVIOUS_CAMPAIGN_CHANGED');
  if(this.attempts().length>=this.config.maxRequests)throw Error('CATALOG_QUOTA_RESERVE_REACHED');
  if(this.attempts().some(x=>!this.rows.some(r=>r.kind==='response'&&r.number===x.number)))throw Error('CATALOG_INTERRUPTED_NETWORK_ATTEMPT');
 }
 async request(spec,transport,{wait=ms=>new Promise(r=>setTimeout(r,ms)),onSuccess=null}={}){
  for(let retry=0;retry<2;retry++){
   this.assertAvailable();const number=this.attempts().length+1;
   this.append({kind:'attempt',number,combined:this.config.baseAttempts+number,at:new Date().toISOString(),operation:spec.operation,platform:spec.platform||null,key:spec.key||null,retry:retry>0});
   let response;
   try{response=await transport();}
   catch(e){const code=safeCode(e);this.append({kind:'response',number,at:new Date().toISOString(),ok:false,status:e.status??null,code});
    const seconds=Number(e.retryAfter??2);if(retry===0&&['TIMEOUT','UPSTREAM','RATE_LIMITED'].includes(code)&&(!e.status||e.status>=500||e.status===429)&&Number.isFinite(seconds)&&seconds>=0&&seconds<=60){
     // A quota 429 cannot be retried. The transport marks it from documented headers.
     if(e.quotaExhausted)throw e;await wait(Math.max(1000,seconds*1000));continue;
    }throw e;
   }
   // A response is checkpointed before write; resume can replay this canonical
   // evidence without another network attempt. Persistence failure never retries transport.
   const observedAt=new Date().toISOString();if(onSuccess)await onSuccess(response,{number,observedAt});
   this.append({kind:'response',number,at:observedAt,ok:true,status:200});return {response,observedAt,number};
  }
 }
 pause(code){atomicJson(path.join(this.directory,'state.json'),{at:new Date().toISOString(),state:code==='COMPLETED'?'complete':'paused',code,attempts:this.attempts().length,combined:this.config.baseAttempts+this.attempts().length});}
}
function detailSpec(target,{includeHistory=true}={}){
 if(!['copart','iaai'].includes(target.platform)||!/^\d+$/.test(target.lot))throw Error('CATALOG_IDENTITY_INVALID');
 // A supplied slug is an actual stored provider identifier, never a fabricated prefix.
 const identifier=target.provider_vehicle_id||(fullVin(target.vin_normalized)?target.vin_normalized:target.lot);
 if(typeof identifier!=='string'||identifier.length>200)throw Error('CATALOG_IDENTITY_INVALID');
 return {operation:'vehicleByIdentifier',identifier,platform:target.platform,...(includeHistory?{include:'history,vin_lots'}:{})};
}
function checkDetail(raw,target){
 if(!raw||String(raw.platform).toLowerCase()!==target.platform||String(raw.lot_number??raw.lot)!==target.lot)throw Error('CATALOG_DETAIL_IDENTITY_MISMATCH');
 const vin=String(raw.vin||'').toUpperCase(),known=String(target.vin_normalized||'').toUpperCase();
 if(fullVin(known)&&vin!==known)throw Error('CATALOG_DETAIL_IDENTITY_MISMATCH');
 // Masked VIN is not a cross-platform reconciliation. Check every visible
 // source character as well as the exact platform/LOT before refreshing it.
 if(known&&!fullVin(known)&&(!vin||known.length!==vin.length||[...known].some((c,i)=>/[A-HJ-NPR-Z0-9]/.test(c)&&c!==vin[i])))throw Error('CATALOG_DETAIL_IDENTITY_MISMATCH');
 return vin;
}
function historyPartition(provider,raw,target,knownRows,{mode='included',meta=null,anchorVerified=false}={}){
 const parent=Array.isArray(raw)?null:raw.vehicle||raw;
 if(parent)checkDetail(parent,target);else if(!anchorVerified)throw Error('CATALOG_HISTORY_ANCHOR_REQUIRED');
 const vin=String(parent?.vin||target.vin_normalized||'').toUpperCase();if(!fullVin(vin))throw Error('CATALOG_HISTORY_VIN_UNAVAILABLE');
 const history=Array.isArray(raw)?raw:Array.isArray(raw.history)?raw.history:raw.history?.data;
 if(!Array.isArray(history)||history.length>1000)throw Error('CATALOG_HISTORY_SHAPE_INVALID');
 const pageMeta=raw?.history?.meta??meta;const hasCursor=Object.hasOwn(pageMeta||{},'next_cursor');const cursor=pageMeta?.next_cursor??null;
 if(cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw Error('CATALOG_HISTORY_CURSOR_INVALID');
 const groups=new Map(),related=[],unidentified=[];
 for(const event of history){
  if(event.vin&&String(event.vin).toUpperCase()!==vin)throw Error('CATALOG_HISTORY_IDENTITY_MISMATCH');
  const platform=String(event.platform||'').toLowerCase(),lot=String(event.lot_number??event.lot??'');
  if(!['copart','iaai'].includes(platform)||!/^\d+$/.test(lot)){unidentified.push('EVENT_IDENTITY_MISSING');continue;}
  const canonical=provider.toCanonicalHistoryEvent(event,{provider:'apibara',platform,lot,vin});
  if(!canonical||!canonical.auction_date||!/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(canonical.auction_date)||!canonical.source_status||!canonical.event_key)throw Error('CATALOG_HISTORY_EVENT_INCOMPLETE');
  const matches=knownRows.filter(row=>row.platform===platform&&row.lot===lot);
  if(matches.length>1)throw Error('CATALOG_HISTORY_AMBIGUOUS_LOT');
  if(matches.length&&matches[0].vin_normalized!==vin)throw Error('CATALOG_HISTORY_IDENTITY_MISMATCH');
  if(!matches.length){related.push(canonical);continue;}
  const key=platform+':'+lot;const group=groups.get(key)||{row:matches[0],events:[]};group.events.push(event);groups.set(key,group);
 }
 const ownKey=target.platform+':'+target.lot;if(!groups.has(ownKey))groups.set(ownKey,{row:{...target,vin_normalized:vin},events:[]});
 for(const {events}of groups.values()){
  const keys=events.map(event=>provider.toCanonicalHistoryEvent(event,{provider:'apibara',vin}).event_key);
  if(new Set(keys).size!==keys.length)throw Error('CATALOG_HISTORY_DUPLICATE_EVENT');
 }
 const sourceComplete=(mode==='included'&&Array.isArray(raw.history)&&!hasCursor||hasCursor&&(cursor===null||cursor===''));
 return {groups,related,unidentified,nextCursor:cursor||null,complete:sourceComplete&&!related.length&&!unidentified.length,sourceComplete,vin};
}
async function persistObservation(db,provider,raw,target,observedAt,freshnessPolicy){
 checkDetail(raw,target);
 const prepared=await prepareObservation({repo:new D1SyncRepository(db),provider,raw,platform:target.platform,observedAt,processedAt:new Date().toISOString(),knownTarget:{lot:target.lot,listingId:target.listing_id},freshnessPolicy});
 if(prepared.skipped)return {skipped:prepared.skipped};
 const {statements,fingerprint}=await knownObservationStatements(db,prepared.record);
 statements.push(db.prepare('UPDATE auction_listings SET detail_synced_at=? WHERE listing_id=? AND platform=? AND lot=?').bind(observedAt,target.listing_id,target.platform,target.lot));
 await db.batch(statements);
 const row=await db.prepare('SELECT * FROM auction_listings WHERE listing_id=?').bind(target.listing_id).first();
 const price=prepared.record.vehicle.pricing;
 if(row?.summary_synced_at!==observedAt||row?.detail_synced_at!==observedAt||row.current_bid_usd!==(Number.isFinite(price.current_bid)?price.current_bid:null)||row.buy_now_usd!==(Number.isFinite(price.buy_now)?price.buy_now:null))throw Error('CATALOG_DETAIL_READBACK_FAILED');
 const snap=await db.prepare('SELECT fingerprint FROM auction_listing_snapshots WHERE listing_id=? ORDER BY observed_at DESC,snapshot_id DESC LIMIT 1').bind(target.listing_id).first();
 if(snap?.fingerprint!==fingerprint)throw Error('CATALOG_SNAPSHOT_READBACK_FAILED');
 return {row,availability:prepared.availability};
}
async function persistHistory(db,provider,raw,target,knownRows,observedAt,options={}){
 const partition=historyPartition(provider,raw,target,knownRows,options);let events=0;
 if(options.priorUnresolved)partition.complete=false;
 for(const [key,{row,events:items}]of partition.groups){
  const expected={platform:row.platform,lot:row.lot,vin:partition.vin,listingId:row.listing_id};
  const response={ok:true,data:{platform:row.platform,lot_number:row.lot,vin:partition.vin,history:items},meta:{next_cursor:partition.nextCursor}};
  // Do not relabel partial VIN history as an empty complete own-listing result.
  const saved=await importTargetedHistory(db,{response,expected,observedAt,mode:'included',sourceComplete:partition.complete});events+=saved.events;
 }
 return {...partition,groups:undefined,events};
}
module.exports={CatalogJournal,detailSpec,checkDetail,historyPartition,persistObservation,persistHistory,atomicJson,safeCode,fullVin};
