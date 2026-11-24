'use strict';

// Selection only: no source changes, normalization, SQL, or budget reservation.
// Ordinary server reservations and the measured statement ceiling stay fixed.
const LIMITS = Object.freeze({legacyGroups:100,serverGroups:300,events:100000,recordGroups:40,
 rowsWritten:5000,rowsRead:50000,statements:970,baselineGuardBytes:1500000});
const COSTS = Object.freeze({control:Object.freeze({rowsWritten:512,rowsRead:2000,statements:128}),
 final:Object.freeze({rowsWritten:32,rowsRead:100,statements:32}),
 price:Object.freeze({rowsWritten:12,rowsRead:32,statements:1}),
 complex:Object.freeze({rowsWritten:64,rowsRead:256,statements:1}),
 record:Object.freeze({rowsWritten:128,rowsRead:1024,statements:20})});
const PRICES = new Set(['pricing.current_bid_usd','pricing.current_bid2_usd','pricing.buy_now_usd']);
// Outcome/schedule/state metadata deliberately takes the conservative class.
const AUX = Object.freeze({'pricing.previous_bid_usd':'price','pricing.current_bid_at':'time',
 'auction.upcoming':'boolean','details.source_sale_type':'text'});
const KEYS = ['rowsWritten','rowsRead','statements'];
const object = v => v!==null && typeof v==='object' && !Array.isArray(v);
const integer = v => Number.isSafeInteger(v) && v>=0;
const own = (v,k) => Object.hasOwn(v,k);
const fail = code => {throw Error(code);};
function valid(value,kind){
 if(value===null)return true;
 if(kind==='price')return typeof value==='number' && Number.isFinite(value) && value>=0 && value<=Number.MAX_SAFE_INTEGER;
 if(kind==='boolean')return typeof value==='boolean'||value===0||value===1;
 if(kind==='text')return typeof value==='string'&&value.length>0&&value.length<=1000&&!/[\u0000-\u001f]/.test(value);
 if(kind==='time'){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)||!Number.isFinite(Date.parse(value)))return false;
  const day=new Date(`${value.slice(0,10)}T00:00:00Z`);
  return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===value.slice(0,10);
 }
 return false;
}
function classifyServerFeedGroup(group){
 const events=object(group)&&Array.isArray(group.events)?group.events:null;
 if(events&&events.some(e=>object(e)&&e.record!=null))return 'record';
 if(!events||events.length===0||!Array.isArray(group.quarantinedSequences)||group.quarantinedSequences.length)return 'complex';
 let hasPrice=false;
 for(const e of events){
  if(!object(e)||!['bid.changed','buy_now.changed','lot.updated'].includes(e.event)
   ||(e.terminal!==undefined&&e.terminal!==false)||!Array.isArray(e.changed_fields)||e.changed_fields.length===0
   ||!object(e.before)||!object(e.after))return 'complex';
  const fields=e.changed_fields;
  if(new Set(fields).size!==fields.length)return 'complex';
  // Extra before/after fields also take the conservative class; never infer
  // that malformed or unsupported evidence is a cheap, harmless price event.
  if([...Object.keys(e.before),...Object.keys(e.after)].some(k=>!fields.includes(k)))return 'complex';
  for(const field of fields){
   const kind=PRICES.has(field)?'price':AUX[field];
   if(!kind||!own(e.after,field)||!valid(e.after[field],kind)||(own(e.before,field)&&!valid(e.before[field],kind)))return 'complex';
   if(PRICES.has(field))hasPrice=true;
  }
 }
 return hasPrice?'price':'complex';
}
function selectServerFeedGroups({groups,offset=0,activated=false,usage={},priorWork=false}={}){
 if(!Array.isArray(groups)||!integer(offset)||offset>groups.length)fail('SERVER_FEED_BATCH_SELECTION_INVALID');
 // Preserve the historical nonactivated selection literally, including source
 // object references. Existing legacy validation/reservations remain in charge.
 if(activated!==true){const selected=groups.slice(offset,offset+100);return {groups:selected,nextOffset:offset+selected.length,
  needContinuation:false,reason:'legacy_100',estimate:null,limits:LIMITS};}
 const used={};
 for(const key of KEYS){used[key]=usage[key]===undefined?0:usage[key];if(!integer(used[key]))fail('SERVER_FEED_BATCH_USAGE_INVALID');}
 if(usage.unknown!==undefined&&typeof usage.unknown!=='boolean')fail('SERVER_FEED_BATCH_USAGE_INVALID');
 const estimate=Object.fromEntries(KEYS.map(k=>[k,COSTS.control[k]+COSTS.final[k]]));
 const selected=[];const classes={price:0,complex:0,record:0};let events=0,reason='end';
 for(let i=offset;i<groups.length&&selected.length<LIMITS.serverGroups;i++){
  const group=groups[i],kind=classifyServerFeedGroup(group),cost=COSTS[kind];
  const count=object(group)&&Array.isArray(group.events)?group.events.length:1;
  if(usage.unknown){reason='usage_unknown';break;}
  if(events+count>LIMITS.events){reason='event_limit';break;}
  if(kind==='record'&&classes.record>=LIMITS.recordGroups){reason='record_limit';break;}
  if(KEYS.some(k=>used[k]+estimate[k]+cost[k]>LIMITS[k])){reason='budget_headroom';break;}
  selected.push(group);classes[kind]++;events+=count;for(const k of KEYS)estimate[k]+=cost[k];
 }
 if(selected.length===LIMITS.serverGroups&&offset+selected.length<groups.length)reason='group_limit';
 const remaining=offset<groups.length;
 if(!selected.length&&remaining&&!priorWork)fail(usage.unknown?'SERVER_FEED_BATCH_USAGE_UNKNOWN':'SERVER_FEED_BATCH_HEADROOM_INSUFFICIENT');
 return {groups:selected,nextOffset:offset+selected.length,needContinuation:remaining&&!selected.length,
  reason,estimate,projectedUsage:Object.fromEntries(KEYS.map(k=>[k,used[k]+estimate[k]])),events,classes,limits:LIMITS};
}
module.exports={LIMITS,COSTS,classifyServerFeedGroup,selectServerFeedGroups};
