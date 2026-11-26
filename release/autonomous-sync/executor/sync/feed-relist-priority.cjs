'use strict';
const KEY='feed-relist-priority:v1',PREFIX='feed-verify-relist:v1:';
// Bounded operator requests only reorder existing work. They cannot insert a
// vehicle, change its evidence, bypass verification or replenish any budget.
async function requestedTask(store,now){
 const row=await store.task(KEY);if(row?.status!=='pending')return null;
 let value;try{value=JSON.parse(row.cursor);}catch{return null;}
 if(!Array.isArray(value.keys)||value.keys.length>20||value.keys.some(x=>typeof x!=='string'||!/^feed-verify-relist:v1:(copart|iaai):\d{1,20}$/.test(x)))return null;
 let waiting=false;
 for(const key of [...new Set(value.keys)]){
  const task=await store.task(key);
  if(task?.status==='pending'){
   waiting=true;if(Date.parse(task.next_due_at)<=now)return task;
  }
 }
 if(!waiting)await store.guarded([store.taskStatement({key:KEY,platform:'all',status:'complete',success:true,due:now,cursor:row.cursor})]);
 return null;
}
module.exports={requestedTask};
