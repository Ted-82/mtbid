'use strict';
const {verifiedSource}=require('./feed-copart-relist.cjs');
const PREFIX='feed-verify-relist:v1:',CLOCK='feed-relist-pages:v1';
const STREAM='feed-relist-stream:v1';
async function warmRescheduled({db,store,getRequest,now,prior}){
 const state=JSON.parse(prior.cursor);
 if(!Number.isSafeInteger(state.after)||state.after<0)throw Error('RELIST_STREAM_CURSOR');
 await getRequest();
 if(Array.isArray(state.matchedKeys)&&state.matchedKeys.length){
  const pending=(await db.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key IN (SELECT value FROM json_each(?)) AND status='pending' AND next_due_at<=?").bind(JSON.stringify(state.matchedKeys),new Date(now()).toISOString()).all()).results;
  if(pending.length){
   const fresh=pending.every(r=>{const cached=JSON.parse(r.cursor)?.sourceRecord;return cached&&now()-Date.parse(cached.observedAt)<60000;});
   if(fresh)return {stream:true,matched:pending.length,matchedKeys:pending.map(r=>r.task_key),cached:true};
   if(Number.isSafeInteger(state.batchFrom))state.after=state.batchFrom;
  }
 }
 const request=await getRequest(),{response,observedAt}=await request({operation:'relistChanges',after:state.after,limit:100});
 const events=response?.response?.data??response?.data,meta=response?.response?.meta??response?.meta;
 const next=meta?.next_cursor??(Array.isArray(events)&&events.length===0?state.after:null);
 if(!Array.isArray(events)||events.length>100||!Number.isSafeInteger(next)||next<state.after||
  events.some(e=>e.event!=='auction.rescheduled'||!Number.isSafeInteger(e.sequence)||e.sequence<=state.after||e.sequence>next))throw Error('RELIST_STREAM_RESPONSE');
 const records=events.map(e=>e.record).filter(r=>r&&['copart','iaai'].includes(r.platform)&&/^\d{1,20}$/.test(String(r.lot_number)));
 const media=await require('./feed-available-media.cjs').fillAvailableMedia({db,store,records,now:now()});
 const keys=[...new Set(records.map(r=>PREFIX+r.platform+':'+r.lot_number))];
 const tasks=keys.length?(await db.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key IN (SELECT value FROM json_each(?)) AND status='pending'").bind(JSON.stringify(keys)).all()).results:[];
 const writes=[],matchedKeys=[];
 for(const task of tasks){
  const c=JSON.parse(task.cursor),raw=records.find(r=>r.platform===c.platform&&String(r.lot_number)===c.lot&&verifiedSource(c.platform,c.lot,c.vin,c.relist,r,observedAt,now()));
  if(!raw)continue;
  const value=JSON.stringify({...c,sourceRecord:{raw,observedAt}});
  if(value.length>200000)continue;
  writes.push(db.prepare("UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=? AND cursor=? AND status='pending'").bind(value,task.task_key,task.cursor));matchedKeys.push(task.task_key);
 }
 writes.push(store.taskStatement({key:STREAM,platform:'all',status:'complete',success:true,due:now(),cursor:JSON.stringify({after:next,batchFrom:state.after,matchedKeys,checkedAt:observedAt})}));
 await store.guarded(writes);
 return {stream:true,records:records.length,matched:matchedKeys.length,matchedKeys,mediaFilled:media.filled,more:meta.has_more===true,after:next};
}
async function warmRelistPage({db,store,getRequest,now}){
 const stream=await store.task(STREAM);
 if(stream?.status==='complete'){
  try{return await warmRescheduled({db,store,getRequest,now,prior:stream});}
  catch(error){
   if((error.code||error.message)==='CURSOR_EXPIRED')
    await store.guarded([store.taskStatement({key:STREAM,platform:'all',status:'blocked',error:'CURSOR_EXPIRED',due:now()+3600000,cursor:stream.cursor})]);
   throw error;
  }
 }
 const previous=await store.task(CLOCK);
 let cursor;
 try{cursor=JSON.parse(previous?.cursor);}catch{}
 const day=new Date(now()).toISOString().slice(0,10);
 const dateTo=new Date(now()+7*86400000).toISOString().slice(0,10);
 const platform=cursor?.day===day&&['iaai','copart'].includes(cursor.platform)?cursor.platform:'iaai';
 const params={platform,lot_sub_status:'Open',per_page:20,auction_date_from:day,auction_date_to:dateTo,sort:'auction_soonest'};
 if(cursor?.day===day&&cursor.platform===platform&&typeof cursor.after==='string')params.cursor=cursor.after;
 const request=await getRequest(),{response,observedAt}=await request({operation:'listVehicles',params});
 const data=response?.response?.data??response?.data,meta=response?.response?.meta??response?.meta;
 if(!Array.isArray(data)||data.length>20)throw Error('RELIST_PAGE_RESPONSE');
 const rows=data.filter(r=>r.platform===platform&&/^\d{1,20}$/.test(String(r.lot_number)));
 const keys=rows.map(r=>PREFIX+platform+':'+r.lot_number);
 const tasks=keys.length?(await db.prepare("SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key IN (SELECT value FROM json_each(?)) AND status='pending'").bind(JSON.stringify(keys)).all()).results:[];
 const writes=[],matchedKeys=[];let matched=0;
 for(const task of tasks){
  const state=JSON.parse(task.cursor),raw=rows.find(r=>String(r.lot_number)===state.lot);
  if(!raw||!verifiedSource(platform,state.lot,state.vin,state.relist,raw,observedAt,now()))continue;
  const next=JSON.stringify({...state,sourceRecord:{raw,observedAt}});
  if(next.length>200000)continue;
  writes.push(db.prepare("UPDATE automatic_refresh_tasks SET cursor=? WHERE task_key=? AND cursor=? AND status='pending'").bind(next,task.task_key,task.cursor));matched++;matchedKeys.push(task.task_key);
 }
 const after=meta?.next_cursor??meta?.pagination?.next_cursor;
 if(after!=null&&(typeof after!=='string'||after.length>4096))throw Error('RELIST_PAGE_CURSOR');
 const state={day,platform:after?platform:platform==='iaai'?'copart':'iaai',...(after?{after}:{})};
 writes.push(store.taskStatement({key:CLOCK,platform:'all',status:'complete',success:true,due:now(),cursor:JSON.stringify(state)}));
 await store.guarded(writes);
 const result={platform,records:rows.length,matched,more:!!after,matchedKeys};
 // The page has already been counted. Gallery recovery must be independent
 // of the page cursor and must not block a verified relist.
 try{
  const media=await require('./feed-available-media.cjs').fillAvailableMedia({db,store,records:rows,now:now()});
  result.mediaFilled=media.filled;
 }catch{result.mediaDeferred=true;}
 return result;
}
module.exports={warmRelistPage,warmRescheduled};
