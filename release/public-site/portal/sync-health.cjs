'use strict';
async function readSyncHealth(db,now=Date.now()){
 if(!db?.prepare)throw Error('unavailable');
 const at=new Date(now).toISOString(),day=at.slice(0,10);
 const statements=[
  "SELECT generation_id,status,observed_at,updated_at,last_sequence,last_error_code FROM server_feed_generations WHERE status='complete' ORDER BY generation_id DESC LIMIT 1",
  "SELECT platform,count(*) pending,min(json_extract(cursor,'$.relist.recordedAt')) oldest FROM automatic_refresh_tasks WHERE task_key>='feed-verify-relist:v1:' AND task_key<'feed-verify-relist:v1:~' AND status='pending' GROUP BY platform",
  "SELECT quota_checked_at,quota_limit,quota_used,quota_left FROM automatic_refresh_state WHERE singleton=1",
  "SELECT budget_key,limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key IN ('day:"+day+"','month:"+day.slice(0,7)+"')",
  "SELECT status,last_error_code FROM automatic_refresh_tasks WHERE task_key IN ('server-api-health','feed-relist-stream:v1')",
  "SELECT CASE WHEN task_key>='feed-verify-relist:v1:' AND task_key<'feed-verify-relist:v1:~' THEN 'Ponowne wystawienia' WHEN instr(task_key,':')=0 THEN task_key ELSE substr(task_key,1,instr(task_key,':')-1) END AS family,status,count(*) AS jobs FROM automatic_refresh_tasks WHERE status IN ('pending','error','paused','blocked','failed') GROUP BY family,status",
  "SELECT l.platform,count(*) AS listings FROM feed_catalog_membership m JOIN auction_listings l ON l.listing_id=m.listing_id WHERE m.baseline_id=(SELECT baseline_id FROM feed_catalog_pointer WHERE singleton=1) AND m.active=1 AND l.auction_state IN ('open','live') AND l.auction_at IS NOT NULL GROUP BY l.platform",
  "SELECT task_key,cursor FROM automatic_refresh_tasks WHERE task_key IN ('feed-approved-cost:v1','feed-adaptive-policy:v1','feed-supplemental-allocation:v1') AND status='complete'",
  "SELECT generation_id,status,observed_at,updated_at,last_sequence,last_error_code FROM server_feed_generations ORDER BY generation_id DESC LIMIT 1"
 ];
 const result=await db.batch(statements.map(q=>db.prepare(q)));
 if(result.some(r=>r.success===false))throw Error('unavailable');
 const [generations,queues,quotas,budgets,health]=result.map(r=>r.results||[]);
 const generation=generations[0]||null,quota=quotas[0]||null,received=result[8]?.results?.[0]||null;
 const pending=queues.reduce((sum,q)=>sum+q.pending,0);
 const delay=generation?Math.max(0,Math.floor((now-Date.parse(generation.observed_at))/60000)):null;
 const blocked=health.some(r=>r.status==='blocked');
 let status='Brak bieżącej kontroli kompletności';
 if(pending)status='Oczekujące weryfikacje katalogu';
 if(delay===null||delay>75)status='Występuje opóźnienie danych';
 if(blocked)status='Wymagana jest interwencja właściciela';
 const exhausted=budgets.some(b=>b.consumed>=b.limit_count);
 if(exhausted&&!blocked)status='Występuje ograniczenie zasobów';
 const policies={};for(const row of result[7]?.results||[]){try{policies[row.task_key]=JSON.parse(row.cursor);}catch{}}
 return {at,status,pending,queues,other_queues:result[5]?.results||[],stored_active_with_date:result[6]?.results||[],delay_minutes:delay,last_generation:generation,quota,budgets,health,
  cost_policy:policies['feed-approved-cost:v1']||null,resource_policy:policies['feed-adaptive-policy:v1']||null,supplemental_policy:policies['feed-supplemental-allocation:v1']||null,
  received_generation:received,publication_pending:!!received&&received.status!=='complete',
  completeness:'Liczba oczekujących zadań nie jest liczbą potwierdzonych braków. Publikacja paczki sama nie potwierdza kompletności katalogu.'};
}
module.exports={readSyncHealth};
