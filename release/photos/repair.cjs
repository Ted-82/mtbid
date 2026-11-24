'use strict';
const {auctionKey,auctionIndex,futureAuction}=require('../../inquiry-budget-20261119/site/sync/catalog-order.cjs');
const {apibaraPhotoFields}=require('../../integrity-followup-20261118/executor/providers/apibara.js');
const {packMediaJson}=require('../../integrity-followup-20261118/executor/sync/catalog-media-storage.cjs');
const {parseAccountBudget,accountWindowStart,accountAllowance,allowSupplementalWrites,STORAGE_RESERVE}=require('../executor/sync/feed-account-budget.cjs');
const KEY='copart-week-photos/v1/progress.json';
const PRIORITY_KEY='copart-week-photos/v1/priority-allowance.json';
const DAY=86400000,WINDOW=7*DAY,PAGE=160;
// Media columns have no indexes or triggers. A conditional gallery update changes at most one row.
// The importer already excludes 160,000 outside-ledger writes/day from its allowance.
const PRIORITY_DAILY_WRITES=512,PRIORITY_BATCH=4,MIN_PUBLICATION_HEADROOM=2200000;
const recentPublications='SELECT status,observed_at,updated_at,last_error_code FROM server_feed_generations ORDER BY generation_id DESC LIMIT 4';
function publicationHealthy(rows,now){
 for(const row of rows){
   if(row.last_error_code||!['complete','downloaded','prepared','applying'].includes(row.status))return false;
   const received=Date.parse(row.observed_at),updated=Date.parse(row.updated_at);
   if(!Number.isFinite(received)||!Number.isFinite(updated)||received>now+300000||updated>now+300000||now-received>2*3600000)return false;
   if(row.status==='complete')return updated>=received-300000;
 }
 return false;
}
async function reservePriority(bucket,day,slot,wanted,previouslyReserved){
 const current=await bucket.get(PRIORITY_KEY);
 if(!current&&previouslyReserved)return null;
 const previous=current?await current.json():null;
 if(current&&(!previous||!/^\d{4}-\d{2}-\d{2}$/.test(previous.day)||!Number.isSafeInteger(previous.slot)||previous.slot<0||
   !Number.isSafeInteger(previous.reserved)||previous.reserved<0||previous.reserved>PRIORITY_DAILY_WRITES))return null;
 if(previous&&(previous.day>day||previous.slot>=slot))return null;
 const used=previous?.day===day?previous.reserved:0;
 // Release credits throughout the UTC day. Unused morning credits are available for later US sessions.
 const slotsPerDay=DAY/300000;
 const released=Math.ceil((slot%slotsPerDay+1)*PRIORITY_DAILY_WRITES/slotsPerDay);
 const granted=Math.min(wanted,PRIORITY_BATCH,released-used);
 if(granted<=0)return null;
 const result=await bucket.put(PRIORITY_KEY,JSON.stringify({day,slot,reserved:used+granted}),
   {onlyIf:current?{etagMatches:current.etag}:{etagDoesNotMatch:'*'}});
 return result?{granted,exhausted:used+granted===PRIORITY_DAILY_WRITES}:null;
}
const API_RESERVE=30000, BURST_QUOTA=70000, BURST_BATCH=20, DAILY_REQUEST_LIMIT=288*BURST_BATCH;
// Increase the pace only while the provider still reports a large unused Pro allowance.
function batchSize(remaining){
 if(!Number.isSafeInteger(remaining)||remaining<=API_RESERVE)return 0;
 const target=remaining>=BURST_QUOTA?BURST_BATCH:remaining>=60000?10:4;
 return Math.min(remaining-API_RESERVE,target);
}
const empty="(l.media_urls_json IS NULL OR l.media_urls_json='[]') AND (l.media_thumbs_json IS NULL OR l.media_thumbs_json='[]')";
const member='EXISTS(SELECT 1 FROM feed_catalog_pointer p JOIN feed_catalog_membership m ON m.baseline_id=p.baseline_id WHERE p.singleton=1 AND m.active=1 AND m.listing_id=l.listing_id)';
const active="l.auction_state IN ('open','live')";
function selection(now,anchor){
 const range=futureAuction(now,{after:anchor?.time??null});
 const sql=`SELECT l.listing_id,l.lot,l.vin_normalized AS vin,(${auctionKey}) AS time,
    (${empty} AND l.identity_state='resolved' AND l.lot=l.source_listing_id AND ${member}) AS eligible
    FROM auction_listings l INDEXED BY ${auctionIndex}
    WHERE ${active} AND ${range.sql} AND (${auctionKey})<=? AND l.platform='copart'
    ${anchor?'AND (('+auctionKey+'),l.listing_id)>(?,?)':''}
    ORDER BY (${auctionKey}),l.listing_id LIMIT ${PAGE}`;
 return {sql,args:[...range.values,Math.floor((now+WINDOW)/1000),...(anchor?[anchor.time,anchor.id]:[])]};
}
function media(row,raw){
 if(raw?.platform!=='copart'||String(raw.lot_number)!==row.lot||raw.vin?.toUpperCase()!==row.vin||raw.auction?.lot_removed||raw.auction?.result_confirmed||!['open','live'].includes(raw.auction?.state))return null;
 const {items,thumbs}=apibaraPhotoFields(raw.media);
 if(!items.length&&!thumbs.length)return null;
 return [items,thumbs].map(list=>list.length?packMediaJson(JSON.stringify(list)):null);
}
async function lookupGallery(row,byVin,detail){
 const raw=await detail(byVin?row.vin:row.lot);
 const collision=!byVin && raw?.platform==='iaai' && String(raw.lot_number)===row.lot
   && /^[A-HJ-NPR-Z0-9]{17}$/i.test(raw.vin||'');
 return {pair:media(row,raw),retryByVin:collision};
}
const update=`UPDATE auction_listings AS l SET media_urls_json=?,media_thumbs_json=?
 WHERE l.listing_id=? AND l.platform='copart' AND l.lot=? AND l.source_listing_id=l.lot AND l.vin_normalized=?
 AND l.identity_state='resolved' AND ${empty} AND ${active} AND (${auctionKey})=? AND ${member}`;
async function run(env,now=Date.now()){
 if(!env.APIBARA_KEY)return {status:'disabled'};
 const slot=Math.floor(now/300000),obj=await env.STATE.get(KEY);
 const old=obj?await obj.json():{};
 if(old.slot>=slot||old.leaseUntil>now)return {status:'already_reserved'};
 const policy=parseAccountBudget({REXBID_FEED_ACCOUNT_BUDGET:env.ACCOUNT_POLICY},2);
 const day=new Date(now).toISOString().slice(0,10),from=accountWindowStart(policy,day);
 const db=env.CATALOG;
 const meter=await db.prepare('SELECT coalesce(sum(consumed_writes+reserved_writes),0) writes,coalesce(sum(consumed_reads+reserved_reads),0) reads FROM server_feed_daily_budgets WHERE day_key BETWEEN ? AND ?').bind(from,day).all();
 const used=meter.results[0],size=meter.meta.size_after;
 const allowance=accountAllowance(policy,from,day);
 if(!Number.isSafeInteger(size)||size<=0||size+STORAGE_RESERVE>policy.databaseMaxBytes||!Number.isSafeInteger(used?.writes)||!Number.isSafeInteger(used?.reads)||used.writes+50000>allowance.writeLimit||used.reads+40000000>allowance.readLimit)return {status:'capacity_guard'};
 const priority=!allowSupplementalWrites(policy,{firstDay:from,day,writeLimit:allowance.writeLimit,writes:used.writes+50000});
 const state={...old,slot,leaseUntil:now+240000};
 const cachedQuota=Number.isSafeInteger(old.quota)&&Number.isFinite(old.quotaAt)&&old.quotaAt<=now&&now-old.quotaAt<3600000;
 let priorityGrant=0;
 if(priority){
   if(allowance.writeLimit-used.writes-50000<MIN_PUBLICATION_HEADROOM)return {status:'publication_reserve'};
   if(old.priorityExhaustedDay===day)return {status:'priority_capacity'};
   const daily=old.requestDay===day?old.requestCount:0;
   if(!Number.isSafeInteger(daily)||daily<0||daily>=DAILY_REQUEST_LIMIT)return {status:'day_capacity'};
   const potential=Math.min(DAILY_REQUEST_LIMIT-daily,cachedQuota?batchSize(old.quota):PRIORITY_BATCH);
   if(!potential)return {status:'api_reserve'};
   if(!publicationHealthy((await db.prepare(recentPublications).all()).results,now))return {status:'publication_reserve'};
   const budget=await reservePriority(env.STATE,day,slot,potential,old.priorityDay===day);
   if(!budget)return {status:'priority_capacity'};
   priorityGrant=budget.granted;
   state.priorityDay=day;
   if(budget.exhausted)state.priorityExhaustedDay=day;
   // Charge before lookup. A crash or uncertain write cannot give the same slot or request back.
   state.requestDay=day;state.requestCount=daily+priorityGrant;
   state.quota=cachedQuota?old.quota-priorityGrant:null;
 }
 const reserved=await env.STATE.put(KEY,JSON.stringify(state),{onlyIf:obj?{etagMatches:obj.etag}:{etagDoesNotMatch:'*'}});
 if(!reserved)return {status:'concurrent'};
 const save=async(result)=>{
   state.last={at:new Date().toISOString(),...result};state.leaseUntil=0;
   if(!await env.STATE.put(KEY,JSON.stringify(state),{onlyIf:{etagMatches:reserved.etag}}))throw Error('PROGRESS_CHANGED');
   return result;
 };
 const headers={'X-API-Key':env.APIBARA_KEY,Accept:'application/json'};
 let stage='usage';
 const call=async(path)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const r=await fetch('https://apibara.tech/api/v1/vehicle-auction/'+path,{method:'GET',headers,redirect:'manual',signal:controller.signal});
      if(!r.ok)throw Error('SOURCE_'+r.status);
      const j=await r.json();return j.data;
    }finally{clearTimeout(timer);}
 };
 let attempted=0,current=null;const filled=[];
 try{
   if(!cachedQuota){
     const acct=await call('usage');state.quota=acct?.quota?.left;state.quotaAt=now;
   }
   const available=priority&&cachedQuota?old.quota:state.quota;
   const allowanceByQuota=batchSize(available);
   if(priority&&!cachedQuota&&Number.isSafeInteger(state.quota))state.quota=Math.max(0,state.quota-priorityGrant);
   if(!allowanceByQuota)return await save({status:'api_reserve'});
   // Limit the number of source lookups independently of any concurrent import.
   const requestDay=state.requestDay===day?state.requestCount:0;
   const batch=Math.min(allowanceByQuota,priority?priorityGrant:DAILY_REQUEST_LIMIT-requestDay);
   if(batch<=0)return await save({status:'day_capacity'});
   state.requestDay=day;state.requestCount=requestDay;
   let scanned=0;
   for(let page=0;page<8&&attempted<batch;page++){
    stage='dated_candidates';
    const q=selection(now,state.anchor);
    const rows=(await db.prepare(q.sql).bind(...q.args).all()).results;
    scanned+=rows.length;
    for(const row of rows){
     if(row.eligible&&/^\d+$/.test(row.lot)&&/^[A-HJ-NPR-Z0-9]{17}$/.test(row.vin)){
       current={id:row.listing_id,time:row.time};
       stage='vehicle_detail';
       const byVin=state.retryVinListing===row.listing_id;
       const detail=async id=>{
         if(!priority){state.requestCount++;state.quota--;}
         attempted++;
         return call('vehicles/'+encodeURIComponent(id)).catch(e=>{if(e.message==='SOURCE_404')return null;throw e;});
       };
       let lookup=await lookupGallery(row,byVin,detail);
       if(lookup.retryByVin){
         state.retryVinListing=row.listing_id;
         if(attempted===batch){
           // Keep the cursor before this row until the next slot has a request available.
           state.filled=(state.filled||0)+filled.length;
           return await save({status:'lot_collision_retry_by_vin',attempted,filled,scanned});
         }
         lookup=await lookupGallery(row,true,detail);
       }
       if(state.retryVinListing===row.listing_id)delete state.retryVinListing;
       const pair=lookup.pair;
       if(pair){
         stage='save_gallery';
         const wrote=await db.prepare(update).bind(...pair,row.listing_id,row.lot,row.vin,row.time).run();
         if(wrote.meta.changes===1)filled.push(row.lot);
       }
     }
     state.anchor={id:row.listing_id,time:row.time};current=null;
     if(attempted===batch)break;
    }
    if(!rows.length||rows.length<PAGE&&state.anchor?.id===rows.at(-1).listing_id){state.anchor=null;break;}
   }
   delete state.failedId;
   state.filled=(state.filled||0)+filled.length;
   return await save({status:'complete',attempted,filled,scanned,...(priority?{mode:'priority',reservedWrites:priorityGrant}:{})});
 }catch(e){
   state.filled=(state.filled||0)+filled.length;
   const code=/^SOURCE_[0-9]{3}$/.test(e.message)?e.message:['AbortError','TimeoutError'].includes(e.name)?'timeout':'temporary_error';
   // Keep the last completed position. One failing source record must not stall the whole week.
   if(current&&['timeout','SOURCE_500','SOURCE_502','SOURCE_503','SOURCE_504'].includes(code)){
     if(state.failedId===current.id){state.anchor=current;delete state.failedId;}else state.failedId=current.id;
   }
   const reason=String(e.message).replace(/https?:\/\/\S+/g,'[address]').replace(/[^\w .:()-]/g,'').slice(0,160);
   return await save({status:code,stage,reason,attempted,filled});
 }
}
module.exports={run,selection,media,update,KEY,batchSize,lookupGallery};
