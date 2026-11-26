'use strict';
const validDate=value=>typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
function currentEvidence(row,event,plan,sourceCycle){
 const changed=plan.assignments||{}, next={...row,...changed};
 if(next.platform!=='iaai'||next.is_timed!==1||next.auction_state!=='open'||!validDate(next.timed_end_at))return null;
 if(event.eventType!=='bid.changed'||!Object.hasOwn(changed,'current_bid_usd')||!validDate(event.recordedAt)||
    !validDate(event.vehicleUpdatedAt)||!event.vin||event.vin!==next.vin_normalized||
    Date.parse(event.recordedAt)>=Date.parse(next.timed_end_at))return undefined;
 if(sourceCycle!=null&&(typeof sourceCycle!=='string'&&!Number.isSafeInteger(sourceCycle)||!String(sourceCycle).trim()||String(sourceCycle).length>128))return undefined;
 // A late observation of an older source version is bounded by the earlier time.
 const stamp=Math.min(Date.parse(event.recordedAt),Date.parse(event.vehicleUpdatedAt));
 return JSON.stringify({seq:event.sequence,at:new Date(stamp).toISOString(),vin:next.vin_normalized,
  end:new Date(Date.parse(next.timed_end_at)).toISOString(),gen:next.listing_generation??null,
  cycle:sourceCycle==null?null:String(sourceCycle),bid:changed.current_bid_usd});
}
function updateEvidence(row,event,plan,prior,sourceCycle){
 if(!Object.hasOwn(row,'timed_bid_evidence'))return prior;
 if(row.platform!=='iaai')return prior;
 let prev=null;try{prev=JSON.parse(prior);}catch{}
 const changed=plan.assignments||{};
 const cycleChange=Object.hasOwn(changed,'timed_end_at')||Object.hasOwn(changed,'is_timed')||Object.hasOwn(changed,'auction_at')||Object.hasOwn(changed,'auction_state');
 if(cycleChange)prev=null;
 const evidence=currentEvidence(row,event,plan,sourceCycle);
 if(evidence===null)return null;
 if(evidence===undefined)return prev?prior:null;
 const next=JSON.parse(evidence);
 if(prev&&(next.seq<=prev.seq||Date.parse(next.at)<Date.parse(prev.at)))return prior;
 return evidence;
}
module.exports={updateEvidence};
