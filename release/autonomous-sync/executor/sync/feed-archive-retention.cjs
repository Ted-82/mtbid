'use strict';

// Caller supplies only the dedicated private feed R2 binding and already owns
// RefreshStore's shared lease. Completed generations remain immutable. This
// module does not acquire/release a lease, advance cursors or clean orphans.
const {randomUUID,createHash}=require('node:crypto');
const {readBootstrapActivation}=require('./feed-bootstrap-activation.cjs');
const {FeedBootstrapMembership}=require('./feed-bootstrap-membership.cjs');
const {ServerFeedState}=require('./feed-server-state.cjs');
const {validateFeedArchiveManifest}=require('./feed-worker-archive.cjs');
const HOUR=3600000,DERIVED_AGE_MS=48*HOUR,RAW_AGE_MS=7*24*HOUR,MAX_OPERATIONS=500,DEFAULT_OPERATIONS=100,MAX_LIST=1000;
const integer=v=>Number.isSafeInteger(v)&&v>=0,hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=code=>{throw Object.assign(Error(code),{code});};
const ensure=(condition,code)=>{if(!condition)fail(code);};
function timestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return NaN;
 const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString()===value?n:NaN;
}
function source(row){
 ensure(integer(row?.generation_id)&&row.generation_id>0&&hex(row.sha256)&&hex(row.manifest_sha256)
  &&integer(row.archive_bytes)&&integer(row.compressed_bytes)&&integer(row.first_sequence)&&row.first_sequence>0
  &&integer(row.last_sequence)&&row.last_sequence>=row.first_sequence&&row.bucket_index===128&&row.group_offset===0
  &&row.status==='complete'&&row.retired_at===null&&Number.isFinite(timestamp(row.updated_at))
  &&Number.isFinite(timestamp(row.observed_at))&&timestamp(row.observed_at)<=timestamp(row.updated_at),'FEED_RETENTION_SOURCE_INVALID');
 return sourceLayout(row);
}
function sourceLayout(row){
 const layout=row.manifest_key===`prepared-packed-gzip/${row.sha256}/v1-b128/manifest.json`?'prepared-packed-gzip':row.manifest_key===`prepared-bounded-gzip/${row.sha256}/v1-b128/manifest.json`?'prepared-bounded-gzip':row.manifest_key===`prepared-bounded/${row.sha256}/v1-b128/manifest.json`?'prepared-bounded':'prepared';
 const prefix=`${layout}/${row.sha256}/`;
 ensure(row.manifest_key===`${prefix}v1-b128/manifest.json`,'FEED_RETENTION_MANIFEST_KEY_INVALID');
 const uuid='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
 ensure(typeof row.raw_key==='string'&&(new RegExp(`^raw/${row.generation_id}/${uuid}\\.jsonl\\.gz$`).test(row.raw_key)
  ||row.raw_key===`raw/${row.generation_id}/bootstrap-${row.sha256}.jsonl.gz`),'FEED_RETENTION_RAW_KEY_INVALID');
 return prefix;
}
function derivedKey(key,prefix){
 if(typeof key!=='string'||!key.startsWith(prefix))return false;
 if(prefix.startsWith('prepared-packed-gzip/')){
  const value=key.slice(prefix.length);
  return /^v1-b128\/(capture\.json|progress\.json|manifest\.json|spool\/manifest\.json|spool\/chunk-(?:0|[1-9]\d*)-[a-f0-9]{64}\.jsonl\.gz|windows\/(?:(?:0|[1-9]\d*)\.json|pack-(?:0|[1-9]\d*)-[a-f0-9]{64}\.bin)|buckets\/(?:0|[1-9]\d*)\/manifest-[a-f0-9]{64}\.json)$/.test(value)
   && (!value.includes('/buckets/')||Number(value.split('/')[2])<128);
 }
 if(prefix.startsWith('prepared-bounded/')||prefix.startsWith('prepared-bounded-gzip/')){
  const value=key.slice(prefix.length),gzip=prefix.startsWith('prepared-bounded-gzip/');
  if(value.includes('/buckets/')&&value.includes('/chunk-')&&gzip!==value.endsWith('.json.gz'))return false;
  return /^v1-b128\/(capture\.json|progress\.json|manifest\.json|spool\/manifest\.json|spool\/chunk-(?:0|[1-9]\d*)-[a-f0-9]{64}\.jsonl\.gz|windows\/(?:0|[1-9]\d*)\.json|buckets\/(?:0|[1-9]\d*)\/(?:chunk-(?:0|[1-9]\d*)-[a-f0-9]{64}\.json(?:\.gz)?|manifest-[a-f0-9]{64}\.json))$/.test(value)
   && (!value.includes('/buckets/')||Number(value.split('/')[2])<128);
 }

 const m=/^v1-b(1|2|4|8|16|32|64|128)\/(capture\.json|manifest\.json|buckets\/(\d+)\/(?:chunk-(?:0|[1-9]\d*)-[a-f0-9]{64}\.json|manifest-[a-f0-9]{64}\.json))$/.exec(key.slice(prefix.length));
 return Boolean(m&&(!m[3]||String(Number(m[3]))===m[3]&&Number(m[3])<Number(m[1])));
}
function condition(row){
 return{sql:`EXISTS(SELECT 1 FROM server_feed_generations g JOIN server_feed_state s ON s.singleton=1
  WHERE g.generation_id=? AND g.status='complete' AND g.retired_at IS NULL AND g.sha256=?
  AND g.raw_key=? AND g.manifest_key=? AND g.manifest_sha256=? AND g.archive_bytes IS ?
  AND g.compressed_bytes=? AND g.first_sequence=? AND g.last_sequence=? AND g.observed_at=? AND g.updated_at=?
  AND g.bucket_index=128 AND g.group_offset=0 AND s.active_generation IS NOT g.generation_id
  AND s.committed_sequence>=g.last_sequence)`,params:[row.generation_id,row.sha256,row.raw_key,row.manifest_key,row.manifest_sha256,
   row.archive_bytes,row.compressed_bytes,row.first_sequence,row.last_sequence,row.observed_at,row.updated_at]};
}
async function guarded(db,store,row,statements=[]){
 const guardId=randomUUID(),cas=condition(row);
 await store.guarded([
  db.prepare(`INSERT INTO server_feed_guards(guard_id,allowed) VALUES(?,CASE WHEN ${cas.sql} THEN 1 ELSE 0 END)`).bind(guardId,...cas.params),
  ...statements,db.prepare('DELETE FROM server_feed_guards WHERE guard_id=?').bind(guardId)
 ]);
}
function ioFor(bucket,maxOperations){
 const stats={operations:0,lists:0,deletes:0,heads:0,gets:0,requestedDeletes:0,verifiedAbsent:0};
 const take=kind=>{ensure(stats.operations<maxOperations,'FEED_RETENTION_OPERATION_LIMIT');stats.operations++;stats[kind]++;};
 return{stats,remaining:()=>maxOperations-stats.operations,
  async manifest(key,expectedHash){
   take('gets');const object=await bucket.get(key);
   ensure(object?.body?.getReader&&(!integer(object.size)||object.size<=1024*1024),'FEED_RETENTION_MANIFEST_INVALID');
   const reader=object.body.getReader(),parts=[];let bytes=0;
   try{for(;;){const next=await reader.read();if(next.done)break;ensure(next.value instanceof Uint8Array,'FEED_RETENTION_MANIFEST_INVALID');
    bytes+=next.value.length;ensure(bytes<=1024*1024,'FEED_RETENTION_MANIFEST_INVALID');parts.push(next.value);}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const content=Buffer.concat(parts,bytes);ensure(digest(content)===expectedHash,'FEED_RETENTION_MANIFEST_HASH');
   try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content));}catch{fail('FEED_RETENTION_MANIFEST_INVALID');}
  },
  async list(prefix){
   take('lists');const response=await bucket.list({prefix,limit:MAX_LIST});
   ensure(response&&Array.isArray(response.objects)&&response.objects.length<=MAX_LIST&&typeof response.truncated==='boolean'
    &&!(response.truncated&&response.objects.length===0),'FEED_RETENTION_LIST_INVALID');
   const keys=response.objects.map(object=>object?.key);
   ensure(new Set(keys).size===keys.length&&keys.every(key=>derivedKey(key,prefix)),'FEED_RETENTION_PREFIX_INVALID');return keys;
  },
  async remove(keys){
   ensure(Array.isArray(keys)&&keys.length>0&&keys.length<=MAX_LIST,'FEED_RETENTION_DELETE_INVALID');
   take('deletes');stats.requestedDeletes+=keys.length;await bucket.delete(keys);
  },
  async absent(key){
   const useHead=typeof bucket.head==='function';take(useHead?'heads':'gets');const object=await bucket[useHead?'head':'get'](key);
   if(!useHead&&object?.body?.cancel)await object.body.cancel();
   ensure(object===null||object&&typeof object==='object','FEED_RETENTION_HEAD_INVALID');
   if(object===null)stats.verifiedAbsent++;return object===null;
  },
  async original(key,bytes){
   const useHead=typeof bucket.head==='function';take(useHead?'heads':'gets');const object=await bucket[useHead?'head':'get'](key);
   if(!useHead&&object?.body?.cancel)await object.body.cancel();
   ensure(object&&object.size===bytes,'FEED_RETENTION_RAW_MISSING');
  }
 };
}
function safeCode(error){
 const code=error?.code||error?.message;
 return typeof code==='string'&&/^(FEED_RETENTION|AUTOMATIC_REFRESH)_[A-Z_]{1,70}$/.test(code)?code:'FEED_RETENTION_STORAGE_FAILED';
}
/** R2 failures return per-generation retry status and preserve outstanding
 * accounting. Config errors throw. Completion updated_at is never reset.
 * Every deleted key needs HEAD/get proof; the derived prefix must list empty.
 */
async function cleanupImportedArchives({db,store,bucket,now,maxGenerations=1,maxOperations=DEFAULT_OPERATIONS}={}){
 ensure(db?.prepare&&db?.batch&&store?.db===db&&typeof store.owner==='string'&&store.owner
  &&typeof store.guarded==='function'&&typeof store.now==='function'&&bucket?.list&&bucket?.delete
  &&(typeof bucket.head==='function'||typeof bucket.get==='function')&&integer(maxGenerations)&&maxGenerations>=1&&maxGenerations<=10
  &&integer(maxOperations)&&maxOperations>=1&&maxOperations<=MAX_OPERATIONS,'FEED_RETENTION_CONFIG_INVALID');
 const at=now===undefined?store.now():typeof now==='function'?now():now;
 ensure(Number.isFinite(at)&&Number.isSafeInteger(at)&&at>=RAW_AGE_MS&&at<=store.now(),'FEED_RETENTION_TIME_INVALID');
 const iso=new Date(at).toISOString(),derivedCutoff=new Date(at-DERIVED_AGE_MS).toISOString(),rawCutoff=new Date(at-RAW_AGE_MS).toISOString();
 const lease=await db.prepare(`SELECT lease_owner FROM automatic_refresh_state WHERE singleton=1 AND blocked_reason IS NULL
  AND lease_owner=? AND lease_until>?`).bind(store.owner,new Date(store.now()).toISOString()).first();
 ensure(lease?.lease_owner===store.owner,'FEED_RETENTION_LEASE_REQUIRED');
 const rows=(await db.prepare(`SELECT g.* FROM server_feed_generations g JOIN server_feed_state s ON s.singleton=1
  WHERE g.status='complete' AND g.retired_at IS NULL AND g.bucket_index=128 AND g.group_offset=0
  AND s.active_generation IS NOT g.generation_id AND s.committed_sequence>=g.last_sequence
  AND g.updated_at<=? AND (g.archive_bytes>0 OR g.updated_at<=?) ORDER BY g.updated_at,g.generation_id LIMIT ?`)
  .bind(derivedCutoff,rawCutoff,maxGenerations).all()).results;
 ensure(Array.isArray(rows)&&rows.length<=maxGenerations,'FEED_RETENTION_READ_INVALID');
 const io=ioFor(bucket,maxOperations),result={selected:rows.length,derivedCleared:0,retired:0,generations:[]};
 for(const original of rows){
  const row={...original},item={generationId:row.generation_id,status:'pending'};result.generations.push(item);
  try{
   const prefix=source(row);if(timestamp(row.updated_at)>at-DERIVED_AGE_MS)fail('FEED_RETENTION_AGE_INVALID');
   await guarded(db,store,row);let empty=false;
   while(io.remaining()>0){
    const keys=await io.list(prefix);if(keys.length===0){empty=true;break;}
    // Reserve delete, one proof per key, and a subsequent list.
    const count=Math.min(keys.length,MAX_LIST,io.remaining()-2);if(count<1)break;
    const deleting=keys.slice(0,count);await guarded(db,store,row);await io.remove(deleting);let absent=true;
    for(const key of deleting)if(!await io.absent(key)){absent=false;break;}
    if(!absent){item.status='delete_pending';break;}
   }
   if(!empty){if(item.status==='pending')item.status='operation_budget';continue;}
   if(row.archive_bytes!==0){
    const cas=condition(row);
    await guarded(db,store,row,[db.prepare(`UPDATE server_feed_generations SET archive_bytes=0 WHERE generation_id=? AND ${cas.sql}`)
     .bind(row.generation_id,...cas.params)]);
    row.archive_bytes=0;result.derivedCleared++;item.derivedCleared=true;
   }
   if(timestamp(row.updated_at)>at-RAW_AGE_MS){item.status='raw_retained';continue;}
   if(io.remaining()<3){item.status='operation_budget';continue;}
   if(!await io.absent(row.raw_key)){
    await guarded(db,store,row);await io.remove([row.raw_key]);
    if(!await io.absent(row.raw_key)){item.status='delete_pending';continue;}
   }
   const cas=condition(row);
   await guarded(db,store,row,[db.prepare(`UPDATE server_feed_generations SET retired_at=? WHERE generation_id=? AND archive_bytes=0 AND ${cas.sql}`)
    .bind(iso,row.generation_id,...cas.params)]);
   result.retired++;item.status='retired';
  }catch(error){item.status='retry_required';item.errorCode=safeCode(error);}
  if(io.remaining()===0)break;
 }
 return{...result,...io.stats};
}
const digest=v=>createHash('sha256').update(v).digest('hex'),hash=v=>digest(JSON.stringify(v));
const COVERED_PREFIX='server-feed-covered-retention:';
const coveredKey=(baselineId,generationId)=>COVERED_PREFIX+baselineId+':'+generationId;
const COVERED_FIELDS=['generation_id','sha256','raw_key','compressed_bytes','observed_at','status','manifest_key','manifest_sha256',
 'first_sequence','last_sequence','bucket_groups_json','bucket_index','group_offset','last_error_code','created_at','updated_at'];
const sourceIdentity=row=>Object.fromEntries(COVERED_FIELDS.map(k=>[k,row[k]]));
const pendingBootstrapSql="NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key>='bootstrap-' AND task_key<'bootstrap.' AND status='pending')";
function coveredSource(row,activation){
 ensure(integer(row?.generation_id)&&row.generation_id>0&&['prepared','blocked'].includes(row.status)&&row.retired_at===null
  &&hex(row.sha256)&&integer(row.compressed_bytes)&&row.compressed_bytes>0&&(row.archive_bytes===null||integer(row.archive_bytes))
  &&integer(row.first_sequence)&&row.first_sequence>0&&integer(row.last_sequence)&&row.last_sequence>=row.first_sequence
  &&row.last_sequence<=activation.floorSequence&&row.generation_id!==activation.receipt.boundary.generationId
  &&Number.isFinite(timestamp(row.observed_at))&&Number.isFinite(timestamp(row.updated_at))
  &&timestamp(row.observed_at)<=timestamp(row.updated_at),'FEED_RETENTION_COVERED_SOURCE_INVALID');
 if(row.manifest_key!==null||row.manifest_sha256!==null){ensure(hex(row.manifest_sha256),'FEED_RETENTION_COVERED_SOURCE_INVALID');return sourceLayout(row);}
 // The one manifestless storage-list failure has a separately audited full raw
 // range classification. An arbitrary manually filled range is never enough.
 ensure(row.generation_id===8019&&row.status==='blocked'&&row.last_error_code==='FEED_CAPTURE_STORAGE_LIST_LIMIT'
  &&row.bucket_index===0&&row.group_offset===0&&(row.archive_bytes===null||row.archive_bytes===0)
  &&/^raw\/8019\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jsonl\.gz$/.test(row.raw_key),
 'FEED_RETENTION_COVERED_SOURCE_INVALID');return null;
}
function coveredCondition(row,activation){
 return {sql:`EXISTS(SELECT 1 FROM server_feed_generations g JOIN server_feed_state s ON s.singleton=1
  WHERE ${COVERED_FIELDS.map(k=>'g.'+k+' IS ?').join(' AND ')} AND g.archive_bytes IS ? AND g.retired_at IS NULL
  AND s.active_generation IS NOT g.generation_id AND g.last_sequence<=? AND g.generation_id<>?) AND ${pendingBootstrapSql}`,
 params:[...Object.values(sourceIdentity(row)),row.archive_bytes,activation.floorSequence,activation.receipt.boundary.generationId]};
}
async function verifiedManifestless(db,row,activation){
 const key='covered-range-classification:8019:'+activation.baselineId;
 const task=await db.prepare('SELECT platform,listing_id,status,cursor FROM automatic_refresh_tasks WHERE task_key=?').bind(key).first();
 let receipt;try{receipt=JSON.parse(task?.cursor);}catch{fail('FEED_RETENTION_CLASSIFICATION_INVALID');}
 const {sha256,...body}=receipt||{};
 ensure(task?.platform==='all'&&task.listing_id===null&&task.status==='complete'&&body.version===1
  &&body.kind==='covered-range-classification'&&body.generationId===8019&&body.baselineId===activation.baselineId
  &&hash(body)===sha256&&body.activationSha256===activation.receiptSha256&&body.sourceSha256===row.sha256
  &&body.compressedBytes===row.compressed_bytes&&body.firstSequence===row.first_sequence&&body.lastSequence===row.last_sequence
  &&body.before?.generation_id===8019&&body.before.raw_key===row.raw_key&&body.before.sha256===row.sha256
  &&body.before.compressed_bytes===row.compressed_bytes&&body.before.observed_at===row.observed_at
  &&body.before.manifest_key===null&&body.before.manifest_sha256===null&&body.before.first_sequence===null&&body.before.last_sequence===null
  &&body.classifiedAt===row.updated_at&&hex(body.scanSha256)&&integer(body.records)&&body.records>0,'FEED_RETENTION_CLASSIFICATION_INVALID');
 return {key,cursor:task.cursor,sha256:digest(task.cursor)};
}
/** A completed fresh bootstrap supersedes these sources; it does not pretend
 * their old imports ran. Keep their status, progress, receipts and cursors.
 * The immutable classification starts a NEW48h/7d retention window. */
async function cleanupBaselineCoveredArchives({db,store,bucket,now,maxGenerations=1,maxOperations=DEFAULT_OPERATIONS}={}){
 ensure(db?.prepare&&db?.batch&&store?.db===db&&store.owner&&typeof store.guarded==='function'&&typeof store.now==='function'
  &&bucket?.get&&bucket?.list&&bucket?.delete&&integer(maxGenerations)&&maxGenerations>=1&&maxGenerations<=10
  &&integer(maxOperations)&&maxOperations>=1&&maxOperations<=MAX_OPERATIONS,'FEED_RETENTION_CONFIG_INVALID');
 const at=now===undefined?store.now():typeof now==='function'?now():now;
 ensure(Number.isSafeInteger(at)&&at>=RAW_AGE_MS&&at<=store.now(),'FEED_RETENTION_TIME_INVALID');
 const result={selected:0,classified:0,derivedCleared:0,retired:0,generations:[]},io=ioFor(bucket,maxOperations);
 const schema=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feed_catalog_pointer'").bind().first();
 if(!schema)return {...result,...io.stats};
 const pointer=await db.prepare('SELECT baseline_id FROM feed_catalog_pointer WHERE singleton=1').bind().first();
 if(!pointer?.baseline_id)return {...result,...io.stats};
 const activation=await readBootstrapActivation({db,baselineId:pointer.baseline_id});ensure(activation,'FEED_RETENTION_ACTIVATION_REQUIRED');
 ensure(Number.isFinite(timestamp(activation.receipt.activatedAt))&&timestamp(activation.receipt.activatedAt)<=at,'FEED_RETENTION_TIME_INVALID');
 const membership=new FeedBootstrapMembership({db,store}),state=new ServerFeedState({db,store});state.configureMembership({membership,activation});
 const lease=await db.prepare('SELECT lease_owner FROM automatic_refresh_state WHERE singleton=1 AND blocked_reason IS NULL AND lease_owner=? AND lease_until>?')
  .bind(store.owner,new Date(store.now()).toISOString()).first();ensure(lease?.lease_owner===store.owner,'FEED_RETENTION_LEASE_REQUIRED');
 const iso=new Date(at).toISOString(),derivedCutoff=new Date(at-DERIVED_AGE_MS).toISOString(),rawCutoff=new Date(at-RAW_AGE_MS).toISOString();
 const prefix=COVERED_PREFIX+activation.baselineId+':';
 const rows=(await db.prepare(`SELECT g.*,t.cursor AS covered_cursor FROM server_feed_generations g JOIN server_feed_state s ON s.singleton=1
  LEFT JOIN automatic_refresh_tasks t ON t.task_key=?||g.generation_id
  WHERE g.status IN ('prepared','blocked') AND g.retired_at IS NULL AND g.first_sequence>0 AND g.last_sequence>=g.first_sequence
  AND g.last_sequence<=? AND g.generation_id<>? AND s.active_generation IS NOT g.generation_id AND ${pendingBootstrapSql}
  AND (t.task_key IS NULL OR json_valid(t.cursor)=0 OR
   json_extract(t.cursor,'$.classifiedAt')<=? AND (g.archive_bytes>0 OR json_extract(t.cursor,'$.classifiedAt')<=?))
  ORDER BY CASE WHEN t.task_key IS NULL THEN 0 ELSE 1 END,g.created_at,g.generation_id LIMIT ?`)
  .bind(prefix,activation.floorSequence,activation.receipt.boundary.generationId,derivedCutoff,rawCutoff,maxGenerations).all()).results;
 ensure(Array.isArray(rows)&&rows.length<=maxGenerations,'FEED_RETENTION_READ_INVALID');result.selected=rows.length;
 for(const original of rows){const {covered_cursor,...row}=original,item={generationId:row.generation_id,status:'pending'};result.generations.push(item);
  try{
   const sourcePrefix=coveredSource(row,activation),key=coveredKey(activation.baselineId,row.generation_id),pendingKey='intake/v1/pending/'+String(row.generation_id).padStart(20,'0')+'.json';
   if(!await io.absent(pendingKey)){item.status='intake_pending';continue;}
   let cursor=covered_cursor,receipt;
   if(cursor===null){
    await io.original(row.raw_key,row.compressed_bytes);
    let sourceProof;
    if(sourcePrefix){const manifest=await io.manifest(row.manifest_key,row.manifest_sha256);
     const root=validateFeedArchiveManifest(manifest,{rawSha256:row.sha256,rawKey:row.raw_key,bucketCount:128});
     ensure(root+'/manifest.json'===row.manifest_key&&manifest.records>0&&manifest.firstSequence===row.first_sequence
      &&manifest.lastSequence===row.last_sequence&&manifest.compressedBytes===row.compressed_bytes&&manifest.observedAt===row.observed_at,
     'FEED_RETENTION_MANIFEST_CONFLICT');sourceProof={kind:'verified-prepared-manifest',sha256:row.manifest_sha256};
    }else sourceProof={kind:'strict-raw-range-classification',...await verifiedManifestless(db,row,activation)};
    const body={version:1,kind:'baseline-superseded-source-retention',baselineId:activation.baselineId,activationSha256:activation.receiptSha256,
     floorSequence:activation.floorSequence,source:sourceIdentity(row),initialArchiveBytes:row.archive_bytes,sourceProof,classifiedAt:iso,
     derivedAgeMs:DERIVED_AGE_MS,rawAgeMs:RAW_AGE_MS,databaseApplied:false};receipt={...body,sha256:hash(body)};cursor=JSON.stringify(receipt);
    const cas=coveredCondition(row,activation);
    let proofSql='',proofParams=[];if(sourceProof.key){proofSql=" AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='complete' AND cursor=?)";proofParams=[sourceProof.key,sourceProof.cursor];}
    await state.guarded(cas.sql+' AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)'+proofSql,[...cas.params,key,...proofParams],[
     db.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,status,cursor,next_due_at,last_success_at) VALUES(?,'all',NULL,'complete',?,?,?)").bind(key,cursor,iso,iso)]);
    result.classified++;item.status='classified_retained';continue;
   }
   try{receipt=JSON.parse(cursor);}catch{fail('FEED_RETENTION_CLASSIFICATION_INVALID');}
   const {sha256,...body}=receipt||{};
   ensure(body.version===1&&body.kind==='baseline-superseded-source-retention'&&hash(body)===sha256
    &&body.baselineId===activation.baselineId&&body.activationSha256===activation.receiptSha256&&body.floorSequence===activation.floorSequence
    &&JSON.stringify(body.source)===JSON.stringify(sourceIdentity(row))&&(row.archive_bytes===body.initialArchiveBytes||row.archive_bytes===0)
    &&timestamp(body.classifiedAt)>=timestamp(activation.receipt.activatedAt)&&timestamp(body.classifiedAt)<=at
    &&body.derivedAgeMs===DERIVED_AGE_MS&&body.rawAgeMs===RAW_AGE_MS&&body.databaseApplied===false,'FEED_RETENTION_CLASSIFICATION_INVALID');
   ensure(sourcePrefix?body.sourceProof?.kind==='verified-prepared-manifest'&&body.sourceProof.sha256===row.manifest_sha256
    :body.sourceProof?.kind==='strict-raw-range-classification'&&body.sourceProof.key==='covered-range-classification:8019:'+activation.baselineId
     &&typeof body.sourceProof.cursor==='string'&&digest(body.sourceProof.cursor)===body.sourceProof.sha256,'FEED_RETENTION_CLASSIFICATION_INVALID');
   if(timestamp(body.classifiedAt)>at-DERIVED_AGE_MS){item.status='classified_retained';continue;}
   if(row.archive_bytes>0)await io.original(row.raw_key,row.compressed_bytes);
   const fence=async(statements=[])=>{ensure(await io.absent(pendingKey),'FEED_RETENTION_INTAKE_PENDING');const cas=coveredCondition(row,activation);
    const rawProof=body.sourceProof.key?" AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='complete' AND cursor=?)":'';
    return state.guarded(cas.sql+
    " AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='complete' AND cursor=?)"+rawProof,
    [...cas.params,key,cursor,...(body.sourceProof.key?[body.sourceProof.key,body.sourceProof.cursor]:[])],statements);};
   await fence();let empty=sourcePrefix===null;
   while(!empty&&io.remaining()>0){const keys=await io.list(sourcePrefix);if(keys.length===0){empty=true;break;}
    const count=Math.min(keys.length,MAX_LIST,io.remaining()-3);if(count<1)break;
    const deleting=keys.slice(0,count);await fence();await io.remove(deleting);let absent=true;
    for(const key of deleting)if(!await io.absent(key)){absent=false;break;}
    if(!absent){item.status='delete_pending';break;}}
   if(!empty){if(item.status==='pending')item.status='operation_budget';continue;}
   if(row.archive_bytes!==0&&row.archive_bytes!==null){await fence([db.prepare('UPDATE server_feed_generations SET archive_bytes=0 WHERE generation_id=?').bind(row.generation_id)]);row.archive_bytes=0;result.derivedCleared++;item.derivedCleared=true;}
   if(timestamp(body.classifiedAt)>at-RAW_AGE_MS){item.status='raw_retained';continue;}
   if(io.remaining()<3){item.status='operation_budget';continue;}
   if(!await io.absent(row.raw_key)){await fence();await io.remove([row.raw_key]);if(!await io.absent(row.raw_key)){item.status='delete_pending';continue;}}
   await fence([db.prepare('UPDATE server_feed_generations SET retired_at=? WHERE generation_id=?').bind(iso,row.generation_id)]);result.retired++;item.status='retired';
  }catch(error){item.status='retry_required';item.errorCode=safeCode(error);}
  if(io.remaining()===0)break;
 }
 return {...result,...io.stats};
}
async function cleanupCompletedArchives(options={}){
 const complete=await cleanupImportedArchives(options),remaining=(options.maxOperations??DEFAULT_OPERATIONS)-complete.operations;
 if(remaining<1)return complete;
 const covered=await cleanupBaselineCoveredArchives({...options,maxOperations:remaining});
 if(covered.selected===0&&covered.operations===0)return complete;
 const combined={...complete,baselineCovered:covered};for(const name of ['operations','lists','deletes','heads','gets','requestedDeletes','verifiedAbsent'])combined[name]=complete[name]+covered[name];
 return combined;
}
module.exports={DERIVED_AGE_MS,RAW_AGE_MS,MAX_OPERATIONS,cleanupCompletedArchives,cleanupBaselineCoveredArchives,coveredKey};
