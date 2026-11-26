'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {nextRelist,chooseDue}=require('../sync/feed-relist-selection.cjs');
const prefix='feed-verify-relist:v1:',key='clock',start=Date.parse('2026-11-25T09:52:12Z');
function harness(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec("CREATE TABLE automatic_refresh_tasks(task_key TEXT PRIMARY KEY,platform TEXT,status TEXT,next_due_at TEXT,cursor TEXT,last_attempt_at TEXT,scan_pages INTEGER DEFAULT 0);");
 let now=start;
 const context={prepare(q){const stmt=db.prepare(q);return {bind(...p){return {async all(){return {results:stmt.all(...p)};}};}};}};
 const store={task:async k=>db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(k),taskStatement:o=>o,guarded:async arr=>{
  for(const x of arr)db.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,next_due_at,cursor,last_attempt_at,scan_pages) VALUES(?,?,'complete',?,?,?,?) ON CONFLICT(task_key) DO UPDATE SET cursor=excluded.cursor,last_attempt_at=excluded.last_attempt_at,scan_pages=excluded.scan_pages,next_due_at=excluded.next_due_at").run(x.key,x.platform,new Date(x.due).toISOString(),x.cursor,new Date(now).toISOString(),x.scanPages||0);
 }};
 const add=(p,id,days,due=start-1000)=>db.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,next_due_at,cursor) VALUES(?,?,'pending',?,?)").run(prefix+p+':'+id,p,new Date(due).toISOString(),JSON.stringify({relist:{date:new Date(start+days*86400000).toISOString()}}));
 async function next(){now+=50;const s=await nextRelist(context,store,prefix,key,await store.task(key),now);if(!s)return null;
  await store.guarded([s.mark]);db.prepare('DELETE FROM automatic_refresh_tasks WHERE task_key=?').run(s.task.task_key);return s.task;}
 return {db,add,next,store,context};
}
test('both houses receive alternating opportunities, earlier auctions preferred with one ordinary slot every four',async t=>{
 const h=harness(t);
 for(const p of ['copart','iaai']) for(const [id,days] of [[100,12],[101,7],[102,2],[103,1],[104,3],[105,20]])h.add(p,id,days);
 const results=[];for(let i=0;i<12;i++)results.push((await h.next()).task_key.replace(prefix,''));
 assert.deepEqual(results.slice(0,8),['copart:103','iaai:103','copart:102','iaai:102','copart:104','iaai:104','copart:100','iaai:100']);
 assert.equal((new Set(results)).size,12);assert.equal(await h.next(),null);
});
test('an empty house lends its whole allowance; a newly eligible house gets the next opportunity',async t=>{
 const h=harness(t);h.add('copart',100,1);h.add('copart',101,1);h.add('copart',102,1);
 assert.equal((await h.next()).platform,'copart');assert.equal((await h.next()).platform,'copart');
 h.add('iaai',900,6);assert.equal((await h.next()).platform,'iaai');assert.equal((await h.next()).platform,'copart');
});
test('existing IAAI cursor, delayed tasks, and wrapping only scan indexed source-specific windows',async t=>{
 const h=harness(t);await h.store.guarded([{key,platform:'all',cursor:prefix+'iaai:777',due:start,scanPages:0}]);
 h.add('iaai',120,4);for(let n=100;n<139;n++)h.add('copart',n,2,start+9000000);h.add('copart',141,2);
 assert.equal((await h.next()).task_key,prefix+'iaai:120');assert.equal((await h.next()).task_key,prefix+'copart:141');
 const plan=h.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM automatic_refresh_tasks WHERE task_key>? AND task_key<? ORDER BY task_key LIMIT 32').all(prefix+'iaai:',prefix+'iaai:~');
 assert.ok(plan.every(p=>!p.detail.includes('SCAN')));assert.ok(plan.some(p=>p.detail.includes('INDEX')));
});
test('the global partial index finds an imminent auction beyond the first 32 keys',async t=>{
 const h=harness(t);
 h.db.exec("CREATE INDEX idx_relist_due_date ON automatic_refresh_tasks(platform,julianday(json_extract(cursor,'$.relist.date')),task_key) WHERE status='pending' AND task_key>='feed-verify-relist:v1:' AND task_key<'feed-verify-relist:v1:~'");
 for(let n=100;n<200;n++)h.add('copart',n,12);
 h.add('copart',999,1);
 assert.equal((await h.next()).task_key,prefix+'copart:999');
});

test('unrelated malformed data does not obscure a valid urgent candidate',()=>{
 const a={status:'pending',next_due_at:new Date(start-10).toISOString(),cursor:'bad'},b={...a,cursor:JSON.stringify({relist:{date:new Date(start+3600000).toISOString()}})};
 assert.equal(chooseDue([a,b],start,0).task,b);
});
