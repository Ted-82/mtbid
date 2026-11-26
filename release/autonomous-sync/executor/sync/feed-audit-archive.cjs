'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {gzipSync}=require('node:zlib');
const TASK='server-feed-audit-archive:v1', PREFIX='operator-audit/v1/';
const SUPPLEMENT_TASK='server-feed-audit-archive:supplement-v1', SUPPLEMENT_CAP=64*1024*1024;
const START='2026-11-12T10:40:00.000Z', AGE=2*3600000, MAX_ROWS=110, MAX_BYTES=850000, CAP=256*1024*1024;
const sha=x=>createHash('sha256').update(x).digest('hex');
const check=(x,code='FEED_AUDIT_ARCHIVE_PROOF')=>{if(!x)throw Error(code);};
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const pattern=/^server-feed-batch:[a-f0-9]{64}:\d+$/;
const supplementPattern=/^(?:server-feed-window:[a-f0-9]{64}:\d+|file-hydration:[a-f0-9]{64}:\d+:\d+)$/;
const empty=()=>({v:1,through:0,bytes:0,rows:0,objects:0,last:null});
const loadState=(cursor,cap)=>{
 if(cursor==null)return empty();
 const m=JSON.parse(cursor);
 check(m?.v===1&&['through','bytes','rows','objects'].every(k=>integer(m[k]))&&m.bytes<=cap);
 return m;
};
async function verifyObject(bucket,key,bytes){
 const found=await bucket.get(key);
 check(found?.size===bytes.length,'FEED_AUDIT_ARCHIVE_READBACK');
 const actual=Buffer.from(await found.arrayBuffer());
 check(actual.equals(bytes),'FEED_AUDIT_ARCHIVE_READBACK');
}
async function archiveFeedAudits({db,store,bucket,now=Date.now,writeAdmitted=()=>true,supplement=false}){
 check(db?.prepare&&store?.db===db&&bucket?.get&&bucket?.put);
 const taskKey=supplement?SUPPLEMENT_TASK:TASK,cap=supplement?SUPPLEMENT_CAP:CAP;
 const taskGuard=supplement?"(t.task_key GLOB 'server-feed-window:*' OR t.task_key GLOB 'file-hydration:*')":"t.task_key GLOB 'server-feed-batch:*'";
 const at=new Date(now()).toISOString(),cutoff=new Date(now()-AGE).toISOString();
 const read=await db.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(taskKey).first();
 const prior=read?.cursor??null,old=loadState(prior,cap);
 let after=old.through;
 if(!after){
  const start=await db.prepare('SELECT rowid AS id FROM server_feed_receipts WHERE committed_at>=? ORDER BY rowid LIMIT 1').bind(START).first();
  if(!start)return {rows:0};check(integer(start.id)&&start.id>0);after=start.id-1;
 }
 const receipts=(await db.prepare(`SELECT r.rowid AS id,r.generation_id,r.receipt_sha256,r.payload_json,g.manifest_sha256,
  g.status,g.updated_at,g.last_sequence,g.bucket_index,g.group_offset,s.active_generation,s.committed_sequence
  FROM server_feed_receipts r JOIN server_feed_generations g ON g.generation_id=r.generation_id
  JOIN server_feed_state s ON s.singleton=1 WHERE r.rowid>? ORDER BY r.rowid LIMIT ?`).bind(after,MAX_ROWS).all()).results;
 check(Array.isArray(receipts));
 const eligible=[];
 for(const p of receipts){
  if(p.status!=='complete'||p.updated_at>cutoff||p.bucket_index!==128||p.group_offset!==0||
     p.active_generation===p.generation_id||!integer(p.last_sequence)||p.last_sequence>p.committed_sequence)break;
  check(p.manifest_sha256&&sha(p.payload_json)===p.receipt_sha256);
  const proof=JSON.parse(p.payload_json);check(proof.generationId===p.generation_id&&proof.manifestSha256===p.manifest_sha256&&Array.isArray(proof.receipts));
  const refs=proof.receipts.filter(x=>(supplement?supplementPattern:pattern).test(x.taskKey));
  check(refs.length<=(supplement?17:1)&&refs.every(x=>/^[a-f0-9]{64}$/.test(x.cursorSha256)));
  eligible.push({p,refs});
 }
 if(!eligible.length||!writeAdmitted())return {rows:0};
 const keys=eligible.flatMap(e=>e.refs.map(ref=>ref.taskKey));
 check(new Set(keys).size===keys.length);
 const tasks=keys.length?(await db.prepare(`SELECT t.* FROM json_each(?) j JOIN automatic_refresh_tasks t ON t.task_key=j.value`).bind(JSON.stringify(keys)).all()).results:[];
 check(Array.isArray(tasks));
 const tasksByKey=new Map(tasks.map(x=>[x.task_key,x]));
 const items=[];let through=after,bodyBytes=0,guardBytes=0;
 for(const {p,refs} of eligible){
  const group=[];let groupBytes=0,groupGuardBytes=0;
  for(const ref of refs){
   const task=tasksByKey.get(ref.taskKey);
   check(task,'FEED_AUDIT_ARCHIVE_TASK_MISSING');
   check(task.platform==='all'&&task.status==='complete'&&task.listing_id===null&&typeof task.cursor==='string'&&sha(task.cursor)===ref.cursorSha256);
   const item={receiptId:p.id,receiptSha256:p.receipt_sha256,generation:p.generation_id,manifest:p.manifest_sha256,finishedAt:p.updated_at,task};
   const guards={k:task.task_key,c:task.cursor,i:p.id,h:p.receipt_sha256,g:p.generation_id,m:p.manifest_sha256,t:p.updated_at};
   const size=Buffer.byteLength(JSON.stringify(item))+1,guardSize=Buffer.byteLength(JSON.stringify(guards))+1;
   group.push({item,guards});groupBytes+=size;groupGuardBytes+=guardSize;
  }
  if(bodyBytes+groupBytes>MAX_BYTES||guardBytes+groupGuardBytes>MAX_BYTES){check(through>after,'FEED_AUDIT_ARCHIVE_ROW_SIZE');break;}
  items.push(...group);bodyBytes+=groupBytes;guardBytes+=groupGuardBytes;
  through=p.id;
 }
 if(through===after||!writeAdmitted())return {rows:0};
 const next={...old,through};let archive=null;
 if(items.length){
  const body=Buffer.from(JSON.stringify({v:1,items:items.map(x=>x.item)})),bytes=gzipSync(body),hash=sha(bytes);
  check(old.bytes+bytes.length<=cap,'FEED_AUDIT_ARCHIVE_CAP');
  const key=PREFIX+hash+'.json.gz';
  await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/gzip'}});
  await verifyObject(bucket,key,bytes);
  archive={key,sha256:hash,rows:items.length,bytes:bytes.length,sourceBytes:body.length};
  Object.assign(next,{rows:old.rows+archive.rows,objects:old.objects+1,bytes:old.bytes+archive.bytes,last:archive});
 }
 if(!writeAdmitted())return {rows:0};
 const id=randomUUID(),rows=JSON.stringify(items.map(x=>x.guards));
 const valid=`SELECT t.task_key FROM json_each(?) j
 JOIN automatic_refresh_tasks t ON t.task_key=json_extract(j.value,'$.k') AND t.cursor IS json_extract(j.value,'$.c')
 JOIN server_feed_receipts r ON r.rowid=json_extract(j.value,'$.i') AND r.receipt_sha256=json_extract(j.value,'$.h') AND r.generation_id=json_extract(j.value,'$.g')
 JOIN server_feed_generations g ON g.generation_id=r.generation_id AND g.manifest_sha256=json_extract(j.value,'$.m') AND g.updated_at=json_extract(j.value,'$.t')
 JOIN server_feed_state s ON s.singleton=1
 WHERE ${taskGuard} AND t.platform='all' AND t.status='complete' AND t.listing_id IS NULL
 AND g.status='complete' AND g.bucket_index=128 AND g.group_offset=0 AND g.updated_at<=?
 AND g.last_sequence<=s.committed_sequence AND s.active_generation IS NOT g.generation_id`;
 const statements=[
  db.prepare(`INSERT INTO server_feed_guards(guard_id,allowed) VALUES(?,CASE WHEN
   (SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?) IS ? AND (SELECT COUNT(*) FROM (${valid}))=? THEN 1 ELSE 0 END)`).bind(id,taskKey,prior,rows,cutoff,items.length)
 ];
 if(items.length)statements.push(db.prepare('DELETE FROM automatic_refresh_tasks WHERE task_key IN (SELECT json_extract(value,\'$.k\') FROM json_each(?))').bind(rows));
 statements.push(db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
 VALUES(?,'all',?,?,?,?,'complete') ON CONFLICT(task_key) DO UPDATE SET cursor=excluded.cursor,last_success_at=excluded.last_success_at`)
  .bind(taskKey,JSON.stringify(next),at,at,at),db.prepare('DELETE FROM server_feed_guards WHERE guard_id=?').bind(id));
 await store.guarded(statements);
 return {through,rows:items.length,bytes:archive?.bytes??0,sourceBytes:archive?.sourceBytes??0,totalRows:next.rows,totalBytes:next.bytes};
}
module.exports={archiveFeedAudits,TASK,PREFIX,START,AGE,CAP,SUPPLEMENT_TASK,SUPPLEMENT_CAP};
