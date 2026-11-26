'use strict';
async function readSyncHealth(db,now=Date.now()){
 if(!db?.prepare)throw Error('unavailable');
 const at=new Date(now).toISOString(),day=at.slice(0,10);
 const statements=[
  "SELECT generation_id,status,observed_at,updated_at,last_sequence,last_error_code FROM server_feed_generations ORDER BY generation_id DESC LIMIT 1",
  "SELECT platform,count(*) pending,min(last_attempt_at) oldest FROM automatic_refresh_tasks WHERE task_key>='feed-verify-relist:v1:' AND task_key<'feed-verify-relist:v1:~' AND status='pending' GROUP BY platform",
  "SELECT quota_checked_at,quota_limit,quota_used,quota_left FROM automatic_refresh_state WHERE singleton=1",
  "SELECT budget_key,limit_count,consumed FROM automatic_refresh_budgets WHERE budget_key IN ('day:"+day+"','month:"+day.slice(0,7)+"')",
  "SELECT status,last_error_code FROM automatic_refresh_tasks WHERE task_key='server-api-health'"
 ];
 const result=await db.batch(statements.map(q=>db.prepare(q)));
 if(result.some(r=>r.success===false))throw Error('unavailable');
 const [generations,queues,quotas,budgets,health]=result.map(r=>r.results||[]);
 const generation=generations[0]||null,quota=quotas[0]||null;
 const pending=queues.reduce((sum,q)=>sum+q.pending,0);
 const delay=generation?Math.max(0,Math.floor((now-Date.parse(generation.observed_at))/60000)):null;
 const blocked=health.some(r=>r.status==='blocked');
 let status='Brak bieżącej kontroli kompletności';
 if(pending)status='Oczekujące weryfikacje katalogu';
 if(delay===null||delay>75)status='Występuje opóźnienie danych';
 if(blocked)status='Wymagana jest interwencja właściciela';
 const exhausted=budgets.some(b=>b.consumed>=b.limit_count);
 if(exhausted&&!blocked)status='Występuje ograniczenie zasobów';
 return {at,status,pending,queues,delay_minutes:delay,last_generation:generation,quota,budgets,health,
  completeness:'Liczba oczekujących zadań nie jest liczbą potwierdzonych braków. Publikacja paczki sama nie potwierdza kompletności katalogu.'};
}
module.exports={readSyncHealth};
