'use strict';
const {randomUUID}=require('node:crypto');
const {createApibaraProvider}=require('../providers/apibara.js');
const HOUR=3600000, DAY=24*HOUR, BATCH=32, SCAN='feed-known-bid:cursor:v1';
const observed=new WeakMap();
const iso=n=>new Date(n).toISOString();
const count=n=>Number.isSafeInteger(n)&&n>=0;
const stamp=v=>typeof v==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const ACTIVE_STATES=new Set(['open','scheduled','upcoming','active','prebid','pre_bid']);
const columns=['listing_id','source_key','platform','lot','vin_normalized','listing_generation','auction_state','source_status','auction_at','is_timed','timed_end_at','identity_state','current_bid_usd','current_bid2_usd','source_price_usd','final_price_usd','buy_now_usd','source_updated_at','detail_synced_at','summary_synced_at','last_seen_at','updated_at'];
function captureBid(raw,at) {
 const a=raw?.auction,p=raw?.pricing;
 if(raw?.platform!=='copart'||typeof raw.lot_number!=='string'||!/^\d{1,20}$/.test(raw.lot_number)||!/^[A-HJ-NPR-Z0-9]{17}$/.test(raw.vin)||!a||!p)return null;
 if(a.state!=='open'||a.phase!=='scheduled'||a.lot_removed===true||a.is_timed===true||a.result_confirmed!==false||a.outcome_status!=null||a.completion_source!=null||a.auction_date_pending===true)return null;
 const bid=p.current_bid_usd;if(typeof bid!=='number'||!Number.isFinite(bid)||bid<=0)return null;
 if(!Number.isFinite(stamp(a.auction_at))||!Number.isFinite(stamp(raw.updated_at))||!Number.isFinite(stamp(at)))return null;
 return {platform:'copart',lot:raw.lot_number,vin:raw.vin,at,version:raw.updated_at,date:a.auction_at,cycle:a.auction_id??raw.auction_id??null,bid,bidAt:p.current_bid_at??null};
}
// A credentialed read is already paid for. Save only eligibility, identity and bid, for this leased call.
function rememberPaidBid(store,raw,at){
 const observation=captureBid(raw,at);if(!observation)return;
 const cache=observed.get(store)??new Map();
 const prior=cache.get(observation.lot);
 if(prior&&(stamp(prior.version)>stamp(observation.version)||stamp(prior.at)>stamp(observation.at)))return;
 if(prior||cache.size<4){cache.set(observation.lot,observation);observed.set(store,cache);}
}
function candidate(r,now){
 return r?.platform==='copart'&&r.identity_state==='resolved'&&r.provider==='apibara'&&r.source_identity_state==='resolved'&&r.active===1&&r.auction_state==='open'&&
  (r.source_status==null||ACTIVE_STATES.has(String(r.source_status).trim().toLowerCase()))&&r.is_timed===0&&r.timed_end_at==null&&
  r.current_bid_usd===null&&r.current_bid2_usd===null&&r.final_price_usd===null&&r.source_price_usd===null&&stamp(r.auction_at)>now&&stamp(r.auction_at)<=now+DAY;
}
const readColumns=columns.map(k=>'l.'+k).join(',')+',m.active,m.last_sequence,s.provider,s.identity_state AS source_identity_state';
const joins=' LEFT JOIN feed_catalog_membership m ON m.baseline_id=? AND m.listing_id=l.listing_id LEFT JOIN vehicle_sources s ON s.source_key=l.source_key AND s.platform=l.platform ';
async function readLot(db,scope,lot){
 const a=(await db.prepare('SELECT '+readColumns+' FROM auction_listings l INDEXED BY idx_listings_lot_recent '+joins+'WHERE l.platform=? AND l.lot=? LIMIT 2').bind(scope.baseline_id,'copart',lot).all()).results;
 return a.length===1?a[0]:null;
}
const pageQuery='SELECT '+readColumns+' FROM auction_listings l INDEXED BY idx_listings_catalog '+joins+
 "WHERE l.platform='copart' AND l.auction_state='open' AND l.auction_at>=? AND l.auction_at<=? AND (l.auction_at,l.listing_id)>(?,?) ORDER BY l.auction_at,l.listing_id LIMIT "+BATCH;
async function saveBid({db,store,scope,row,obs,now}){
 const at=now();if(!candidate(row,at)||!obs||row.vin_normalized!==obs.vin||row.lot!==obs.lot||stamp(row.auction_at)!==stamp(obs.date)||
   (row.listing_generation!=null&&String(row.listing_generation)!==String(obs.cycle))||stamp(obs.at)>at||at-stamp(obs.at)>30000||stamp(obs.version)>stamp(obs.at))return false;
 if(stamp(obs.at)-stamp(obs.version)>DAY||obs.bidAt!=null&&(!Number.isFinite(stamp(obs.bidAt))||stamp(obs.bidAt)>stamp(obs.at)))return false;
 const rowClocks=['source_updated_at','detail_synced_at','summary_synced_at','last_seen_at','updated_at'];
 if(rowClocks.some(k=>row[k]!=null&&(!Number.isFinite(stamp(row[k]))||stamp(row[k])>stamp(obs.version))))return false;
 const ctxExpr="EXISTS(SELECT 1 FROM server_feed_state f JOIN feed_catalog_pointer p ON f.singleton=p.singleton WHERE f.singleton=1 AND f.active_generation IS NULL AND f.committed_sequence=? AND p.baseline_id=?)";
 const conditions=columns.map(k=>'l.'+k+' IS ?').join(' AND ');
 const guardKey=randomUUID(),guard=db.prepare('INSERT INTO sync_batch_guards(guard_id,allowed) VALUES(?,CASE WHEN '+ctxExpr+' AND EXISTS(SELECT 1 FROM auction_listings l JOIN vehicle_sources s ON s.source_key=l.source_key AND s.provider=? AND s.identity_state=? JOIN feed_catalog_membership m ON m.listing_id=l.listing_id AND m.baseline_id=? AND m.active=1 AND m.last_sequence=? WHERE '+conditions+') THEN 1 ELSE 0 END)')
 .bind(guardKey,scope.committed_sequence,scope.baseline_id,'apibara','resolved',scope.baseline_id,row.last_sequence,...columns.map(k=>row[k]));
 await store.guarded([guard,db.prepare('UPDATE auction_listings SET current_bid_usd=? WHERE listing_id=?').bind(obs.bid,row.listing_id),
   db.prepare('INSERT INTO auction_listing_snapshots(listing_id,observed_at,auction_state,auction_at,current_bid_usd,fingerprint) VALUES(?,?,?,?,?,?)')
    .bind(row.listing_id,obs.at,'open',row.auction_at,obs.bid,'rest-primary-bid:'+obs.version),
   db.prepare('DELETE FROM sync_batch_guards WHERE guard_id=?').bind(guardKey)]);
 return true;
}
async function availableBudget(store,now,permitQuotaRefresh){
 const quota=await store.state(),time=now(),day=iso(time).slice(0,10);
 // Create missing daily ledger only for a real candidate. The same lifetime lease
 // protects the ordinary request ledger and its pre-transport amount reservation.
 if(store.keys?.[0]!=='day:'+day)await store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
 const budgets=await store.budgets(),left=k=>{const r=budgets.find(x=>x.budget_key===k);return r?r.limit_count-r.consumed:0;};
 if(left('day:'+day)<=102||left('month:'+day.slice(0,7))<=1002)return false;
 const quotaTime=stamp(quota?.quota_checked_at);
 if(!Number.isFinite(quotaTime)||quotaTime<=time-DAY)return permitQuotaRefresh;
 return quotaTime<=time&&count(quota.quota_left)&&quota.quota_left>30002&&count(quota.quota_allowance)&&quota.quota_allowance>2;
}
async function maintainKnownBid({env,state,body,workPhase,result,control,usage,reservation,store,db,now,fetchImpl,buildRequest}){
 if(env.REXBID_FEED_OPEN_COVERAGE!=='enabled'||state.activation?.receipt?.kind!=='feed-projected-catalog-activation'||
   !((body.kind==='poll'&&result.capturedPending===0)||(workPhase==='finish'&&result.complete&&result.nextCapture?.capturedPending===0)))return;
 const policy=state.accountBudget,w=reservation.window;
 if(!w||!policy||![w.writeLimit,w.writes,w.readLimit,w.reads,control?.databaseSizeBytes,policy.databaseMaxBytes,control?.limit,usage?.statements,usage?.rowsWritten,usage?.rowsRead].every(count)||
   w.writeLimit-w.writes<2205000||w.readLimit-w.reads<100000||control.databaseSizeBytes<=0||policy.databaseMaxBytes-control.databaseSizeBytes<64000000||
   usage.unknown!==false||usage.rowsWritten>720||usage.rowsRead>11000||control.limit-usage.statements<160)return;
 const t=now(),scope=await db.prepare('SELECT f.committed_sequence,g.status,g.observed_at,p.baseline_id FROM server_feed_state f JOIN feed_catalog_pointer p ON f.singleton=p.singleton JOIN server_feed_generations g ON g.last_sequence=f.committed_sequence WHERE f.singleton=1 AND f.active_generation IS NULL AND g.generation_id=(SELECT MAX(generation_id) FROM server_feed_generations)').first();
 if(scope?.status!=='complete'||!scope.baseline_id||!(stamp(scope.observed_at)<=t&&stamp(scope.observed_at)>=t-75*60000))return;
 const cached=observed.get(store);observed.delete(store);
 if(cached)for(const observation of cached.values()){
  const row=await readLot(db,scope,observation.lot);
  if(await saveBid({db,store,scope,row,obs:observation,now})){result.knownBid={saved:true,source:'already_read',extraDetails:0};return;}
 }
 const task=await store.task(SCAN);if(stamp(task?.next_due_at)>t)return;
 const cursor=task?.cursor?JSON.parse(task.cursor):null,from=iso(t),to=iso(t+DAY);
 const position=cursor?.at>=from?cursor:{at:from,id:''};
 const page=(await db.prepare(pageQuery).bind(scope.baseline_id,from,to,position.at,position.id).all()).results;
 const start=page.find(r=>candidate(r,t));const end=start??page.at(-1),more=!!start||page.length===BATCH;
 const cursorWrite=(p,delay)=>store.taskStatement({key:SCAN,platform:'copart',cursor:p?JSON.stringify({at:p.auction_at,id:p.listing_id}):null,due:t+delay,status:'partial',success:true});
 if(!start){await store.guarded([cursorWrite(more?end:null,more?0:30*60000)]);return;}
 if(!await availableBudget(store,now,true)){result.knownBid={saved:false,source:'budget_reserve'};return;}
 // A single durable transport slot covers either the shared quota check or the
 // detail itself. Manual retries/finish callbacks obey the same five minutes.
 const delay=5*60000, prior=cursor?{auction_at:cursor.at,listing_id:cursor.id}:null;
 await store.guarded([cursorWrite(prior,delay)]);
 let upstream=0;
 const checkedFetch=(...args)=>{if(upstream>=1)throw Error('KNOWN_BID_TRANSPORT_LIMIT');upstream++;return fetchImpl(...args);};
 const request=await buildRequest({env,db,store,now,fetchImpl:checkedFetch});
 if(upstream){result.knownBid={saved:false,source:'quota_refreshed',extraDetails:0};return;}
 if(!await availableBudget(store,now,false)){result.knownBid={saved:false,source:'budget_reserve'};return;}
 // A permanently unavailable lot must not starve the next candidates. Every
 // examined position gets another opportunity on a later pass of the index.
 await store.guarded([cursorWrite(end,delay)]);
 const response=await request({operation:'vehicleByIdentifier',platform:'copart',identifier:start.lot});
 const raw=createApibaraProvider().vehicleDetailRecord(response.response),obs=captureBid(raw,response.observedAt);
 const saved=await saveBid({db,store,scope,row:start,obs,now});
 result.knownBid={saved,source:'counted_detail',extraDetails:1};
}
module.exports={captureBid,rememberPaidBid,saveBid,maintainKnownBid,pageQuery};
