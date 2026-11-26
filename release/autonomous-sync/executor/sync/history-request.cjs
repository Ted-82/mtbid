'use strict';
// Viewing a saved history requests bounded enrichment. No provider call in GET.
const PREFIX='feed-history:v1:',CAP=500,DAY=86400000;
const valid=x=>x&&['copart','iaai'].includes(x.platform)&&/^\d{1,20}$/.test(x.lot)&&/^[A-HJ-NPR-Z0-9]{17}$/.test(x.vin)&&typeof x.listing_id==='string'&&x.listing_id.length<=256;
async function requestHistory(db,identity,availability,now=Date.now()){
 if(!db?.prepare||!valid(identity))return null;
 const ttl=identity.ended?7*DAY:6*3600000;
 if(availability?.complete&&Date.parse(availability.fetched_at)>now-ttl)return{state:'current'};
 const at=new Date(now).toISOString(),key=PREFIX+identity.listing_id;
 await db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,status,cursor,next_due_at,last_attempt_at)
  SELECT ?,?,?,'pending',NULL,?,? WHERE EXISTS(SELECT 1 FROM auction_listings WHERE listing_id=? AND platform=? AND lot=? AND vin_normalized=?)
  AND (SELECT COUNT(*) FROM automatic_refresh_tasks WHERE task_key>=? AND task_key<? AND status='pending')<?
  ON CONFLICT(task_key) DO UPDATE SET status='pending',cursor=NULL,next_due_at=excluded.next_due_at
  WHERE automatic_refresh_tasks.status<>'pending' AND automatic_refresh_tasks.next_due_at<=excluded.next_due_at`)
  .bind(key,identity.platform,identity.listing_id,at,at,identity.listing_id,identity.platform,identity.lot,identity.vin,PREFIX,PREFIX+'~',CAP).run();
 const task=await db.prepare('SELECT status,next_due_at FROM automatic_refresh_tasks WHERE task_key=?').bind(key).first();
 return task?{state:task.status==='pending'?'queued':task.status,next_due_at:task.next_due_at}:null;
}
module.exports={requestHistory,PREFIX,CAP,valid};
