'use strict';

// This is only a filter on revival of EXISTING detail eligibility, called AFTER
// the core importer. It never skips source events, receipts, identity checks,
// canonical patches, membership changes, queued work, or sequence checkpoints.
const {parseChangesResponse}=require('../providers/apibara.js');
const PRIMARY='pricing.current_bid_usd';
const EMPTY_BUY_NOW='pricing.buy_now_usd';
// Intentionally narrower than the planner's full IGNORED list: outcome-related
// metadata and other price transitions are not admitted by this optimization.
const AUX=Object.freeze({'pricing.previous_bid_usd':'price','auction.upcoming':'boolean','details.source_sale_type':'text'});
const own=(o,k)=>Object.hasOwn(o,k),object=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const vin=v=>typeof v==='string'&&/^[A-HJ-NPR-Z0-9]{17}$/i.test(v);
const empty=v=>v===0||v===null;
function validAux(value,kind){
 if(value===null)return true;
 if(kind==='price')return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
 if(kind==='boolean')return value===true||value===false||value===0||value===1;
 return typeof value==='string'&&value.length>0&&value.length<=1000&&!/[\u0000-\u001f]/.test(value);
}
function isProvenReconcileNoise(group,{queued}={}){
 // Absence of a decision is not permission to bypass newly queued work. The
 // caller must explicitly establish that core import queued nothing for LOT.
 if(queued!==false||!group||!['copart','iaai'].includes(group.platform)||typeof group.lot!=='string'
  ||!/^\d{1,20}$/.test(group.lot)||!Array.isArray(group.events)||!group.events.length||group.events.length>100000
  ||!Array.isArray(group.quarantinedSequences)||group.quarantinedSequences.length)return false;
 let previous=0,expectedVin=null,hasPriceNoop=false;const ids=new Set();
 try{
  for(const event of group.events){
   if(!event||!['bid.changed','lot.updated','buy_now.changed'].includes(event.event)||event.terminal!==false||event.record!=null
    ||event.vehicle?.platform!==group.platform||event.vehicle.lot_number!==group.lot||!vin(event.vehicle.vin)
    ||!object(event.before)||!object(event.after)||!Array.isArray(event.changed_fields)
    ||!Number.isSafeInteger(event.sequence)||event.sequence<=previous||ids.has(event.event_id))return false;
   const eventVin=event.vehicle.vin.toUpperCase();if(expectedVin!==null&&eventVin!==expectedVin)return false;expectedVin=eventVin;
   parseChangesResponse({ok:true,data:[event],meta:{after:previous,next_cursor:event.sequence,has_more:false,count:1,
    ordering:'sequence_asc',schema_version:'eligibility-noise',retention_days:14}},{after:previous,limit:1});
   const fields=new Set([...event.changed_fields,...Object.keys(event.before),...Object.keys(event.after)]);
   if(!fields.size)return false;
   for(const field of fields){
    if(field===PRIMARY){
     if(!own(event.before,field)||!own(event.after,field)||!empty(event.before[field])||!empty(event.after[field]))return false;
     hasPriceNoop=true;
    }else if(field===EMPTY_BUY_NOW){
     // Explicit NULL->NULL is source initialization noise, never a price clear.
     // Before-absent, zero, positive, and buy-now availability flags stay out.
     if(!own(event.before,field)||!own(event.after,field)||event.before[field]!==null||event.after[field]!==null)return false;
     hasPriceNoop=true;
    }else{
     if(!own(AUX,field)||!own(event.after,field))return false;
     for(const side of [event.before,event.after])if(own(side,field)&&!validAux(side[field],AUX[field]))return false;
    }
   }
   ids.add(event.event_id);previous=event.sequence;
  }
 }catch{return false;}
 return hasPriceNoop;
}
module.exports={isProvenReconcileNoise};
