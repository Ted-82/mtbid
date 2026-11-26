'use strict';
const SECONDARY_CLOCK='feed-verify-relist-second-clock:v1';
const WEEK=7*86400000;

function chooseDue(rows,now,served) {
 const due=rows.filter(r=>r.status==='pending'&&Date.parse(r.next_due_at)<=now);
 if(!due.length)return null;
 // Reserve every fourth opportunity for ordinary key order. Select urgent work only
 // in this indexed window, and keep the unserved earlier positions reachable.
 let selected=due[0],earliest=Infinity;
 if(served%4!==3){
  for(const candidate of due){
   let date;
   try{date=Date.parse(JSON.parse(candidate.cursor)?.relist?.date);}catch{continue;}
   if(date>now&&date<=now+WEEK&&date<earliest){earliest=date;selected=candidate;}
  }
 }
 return {task:selected,atFront:selected===due[0]};
}

async function nextRelist(db,store,prefix,primaryKey,primary,now){
 const primaryPlatform=primary?.cursor?.startsWith(prefix+'iaai:')?'iaai':'copart';
 const secondary=await store.task(SECONDARY_CLOCK);
 const streams=[
  {key:primaryKey,platform:primaryPlatform,clock:primary},
  {key:SECONDARY_CLOCK,platform:primaryPlatform==='copart'?'iaai':'copart',clock:secondary}
 ];
 const attempted=s=>Date.parse(s.clock?.last_attempt_at)||0;
 streams.sort((a,b)=>attempted(a)-attempted(b)||(a.clock?.scan_pages||0)-(b.clock?.scan_pages||0));
 const fairMark=await require('./feed-relist-fairness.cjs').order(db,store,streams,now);
 for(const stream of streams){
  if(Date.parse(stream.clock?.next_due_at)>now)continue;
  const floor=prefix+stream.platform+':',ceiling=floor+'~';
  const initial=stream.clock?.cursor?.startsWith(floor)?stream.clock.cursor:floor;
  const served=stream.clock?.scan_pages||0;
  if(served%4!==3){
   const index=await db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name='idx_relist_due_date'").bind().all();
   if(index.results.length){
    const urgent=await db.prepare("SELECT * FROM automatic_refresh_tasks INDEXED BY idx_relist_due_date WHERE status='pending' AND task_key>='feed-verify-relist:v1:' AND task_key<'feed-verify-relist:v1:~' AND platform=? AND julianday(json_extract(cursor,'$.relist.date'))>julianday(?) AND julianday(json_extract(cursor,'$.relist.date'))<=julianday(?) AND next_due_at<=? ORDER BY julianday(json_extract(cursor,'$.relist.date')),task_key LIMIT 1")
     .bind(stream.platform,new Date(now).toISOString(),new Date(now+WEEK).toISOString(),new Date(now).toISOString()).all();
    if(urgent.results[0])return {task:urgent.results[0],extraMarks:[fairMark(stream.platform)],mark:{key:stream.key,platform:'all',cursor:initial,scanPages:served+1,due:now,status:'complete',success:true}};
   }
  }
  const read=start=>db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key>? AND task_key<? ORDER BY task_key LIMIT 32').bind(start,ceiling).all();
  let start=initial,rows=(await read(start)).results,choice=chooseDue(rows,now,served);
  if(!choice&&rows.length<32&&start!==floor){
   start=floor; rows=(await read(start)).results;choice=chooseDue(rows,now,served);
  }
  if(choice)return {task:choice.task,extraMarks:[fairMark(stream.platform)],mark:{key:stream.key,platform:'all',cursor:choice.atFront?choice.task.task_key:start,scanPages:served+1,due:now,status:'complete',success:true}};
  if(rows.length===32&&rows.at(-1).task_key!==initial){
   await store.guarded([store.taskStatement({key:stream.key,platform:'all',cursor:rows.at(-1).task_key,scanPages:served,due:now,status:'complete',success:true})]);
  }
 }
 return null;
}
module.exports={nextRelist,chooseDue};
