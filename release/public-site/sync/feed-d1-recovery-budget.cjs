'use strict';
// Local candidate: runtime OFF until the exact owner-approved opt-in is supplied.
// All mutations are returned to ServerFeedState for its existing atomic batch.
const {createHash,randomUUID}=require('node:crypto');
const ID='2026-10-31-gap',WRITE_LIMIT=12000000,READ_LIMIT=200000000,THROUGH=51573763;
const EXPIRES_AT='2026-11-03T00:00:00.000Z',FROZEN_GENERATION=6698,BASE_WRITES=1000000,BASE_READS=50000000;
const PREFIX='feed-d1-recovery:'+ID,PLAN_KEY=PREFIX+':plan',LEDGER_KEY=PREFIX+':ledger';
const STARTS_AT='2026-10-31T00:00:00.000Z';
const integer=n=>Number.isSafeInteger(n)&&n>=0,iso=n=>new Date(n).toISOString();
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=code=>{throw Error(code);};
const signed=payload=>JSON.stringify({...payload,sha256:hash(payload)});
const task=(db,key)=>db.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').bind(key).first();
const counterKeys=day=>[PREFIX+':writes',PREFIX+':reads',PREFIX+':day:'+day+':writes',PREFIX+':day:'+day+':reads'];
const dayKey=day=>PREFIX+':day:'+day;
const bindingKey=key=>PREFIX+':reservation:'+hash(key);
function configuration(env){
 const names=['REXBID_FEED_D1_RECOVERY_ID','REXBID_FEED_D1_RECOVERY_WRITE_LIMIT','REXBID_FEED_D1_RECOVERY_READ_LIMIT','REXBID_FEED_D1_RECOVERY_THROUGH'];
 if(names.every(name=>env?.[name]===undefined))return false;
 const wanted=[ID,String(WRITE_LIMIT),String(READ_LIMIT),String(THROUGH)];
 if(names.some((name,index)=>env?.[name]!==wanted[index]))fail('SERVER_FEED_D1_RECOVERY_CONFIG');return true;
}
function parse(row,fields){
 let value;try{value=JSON.parse(row?.cursor);}catch{fail('SERVER_FEED_D1_RECOVERY_RECEIPT');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
 const {sha256,...payload}=value;
 if(typeof sha256!=='string'||sha256!==hash(payload)||Object.keys(payload).sort().join(',')!==[...fields].sort().join(','))fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
 return{payload,sha256,cursor:row.cursor};
}
function complete(row){return row?.platform==='all'&&row.listing_id===null&&row.status==='complete';}
function insertTask(db,key,cursor,at,status='complete'){
 return db.prepare(`INSERT INTO automatic_refresh_tasks(task_key,platform,cursor,next_due_at,last_attempt_at,last_success_at,status)
  VALUES(?,'all',?,?,?,?,?)`).bind(key,cursor,at,at,status==='complete'?at:null,status);
}
class D1RecoveryBudget{
 constructor({db,store,now=store?.now?.bind(store)}={}){
  if(!db?.prepare||!db?.batch||store?.db!==db||!store.owner||typeof store.guarded!=='function'||typeof now!=='function')fail('SERVER_FEED_D1_RECOVERY_CONFIG');
  Object.assign(this,{db,store,now,enabled:false,plan:null,latest:null,contexts:new Map()});
 }
 async load(env={}){
  this.enabled=configuration(env);let row=await task(this.db,PLAN_KEY);
  if(!row&&this.enabled&&this.now()>=Date.parse(STARTS_AT)&&this.now()<Date.parse(EXPIRES_AT)){
   const state=await this.db.prepare('SELECT committed_sequence FROM server_feed_state WHERE singleton=1').bind().first();
   if(!integer(state?.committed_sequence))fail('SERVER_FEED_D1_RECOVERY_SCOPE');
   if(state.committed_sequence>=THROUGH)return null;
   const frozen=await this.db.prepare('SELECT generation_id,last_sequence,status,retired_at FROM server_feed_generations WHERE generation_id=?').bind(FROZEN_GENERATION).first();
   if(frozen?.last_sequence!==THROUGH||!['prepared','applying'].includes(frozen.status)||frozen.retired_at!==null)fail('SERVER_FEED_D1_RECOVERY_SCOPE');
   const payload={version:1,id:ID,startFileCursor:state.committed_sequence,through:THROUGH,expiresAt:EXPIRES_AT,
    writeLimit:WRITE_LIMIT,readLimit:READ_LIMIT,frozenGenerationId:FROZEN_GENERATION,activatedAt:iso(this.now())};
   const cursor=signed(payload),keys=counterKeys('initial').slice(0,2),guardId=randomUUID(),at=payload.activatedAt;
   await this.store.guarded([
    this.db.prepare(`INSERT INTO server_feed_guards(guard_id,allowed) VALUES(?,CASE WHEN
     julianday('now')<julianday(?) AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)
     AND NOT EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key IN (?,?))
     AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)
     AND EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND committed_sequence=?)
     AND EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND last_sequence=? AND status=? AND retired_at IS NULL)
     THEN 1 ELSE 0 END)`).bind(guardId,EXPIRES_AT,PLAN_KEY,...keys,LEDGER_KEY,state.committed_sequence,FROZEN_GENERATION,THROUGH,frozen.status),
    insertTask(this.db,PLAN_KEY,cursor,at),
    insertTask(this.db,LEDGER_KEY,signed({version:1,planHash:hash(payload),revision:0,chargedWrites:0,chargedReads:0,days:{}}),at),
    ...keys.map((key,index)=>this.db.prepare('INSERT INTO automatic_refresh_budgets(budget_key,limit_count,consumed,created_at,updated_at) VALUES(?,?,0,?,?)')
     .bind(key,index===0?WRITE_LIMIT:READ_LIMIT,at,at)),
    this.db.prepare('DELETE FROM server_feed_guards WHERE guard_id=?').bind(guardId)]);
   row=await task(this.db,PLAN_KEY);
  }
  if(!row)return null;
  const receipt=parse(row,['version','id','startFileCursor','through','expiresAt','writeLimit','readLimit','frozenGenerationId','activatedAt']),p=receipt.payload;
  if(!complete(row)||p.version!==1||p.id!==ID||!integer(p.startFileCursor)||p.startFileCursor>=THROUGH||p.through!==THROUGH||p.expiresAt!==EXPIRES_AT
   ||p.writeLimit!==WRITE_LIMIT||p.readLimit!==READ_LIMIT||p.frozenGenerationId!==FROZEN_GENERATION
   ||typeof p.activatedAt!=='string'||!Number.isFinite(Date.parse(p.activatedAt))||iso(Date.parse(p.activatedAt))!==p.activatedAt||Date.parse(p.activatedAt)>this.now()||p.activatedAt<STARTS_AT||p.activatedAt>=EXPIRES_AT)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
  this.plan={...p,hash:receipt.sha256,cursor:receipt.cursor};await this.context(iso(this.now()).slice(0,10));return this.status();
 }
 async context(day){
  if(!this.plan)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||iso(Date.parse(day+'T00:00:00Z')).slice(0,10)!==day)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
  const ledgerRow=await task(this.db,LEDGER_KEY),ledgerReceipt=parse(ledgerRow,['version','planHash','revision','chargedWrites','chargedReads','days']),ledger=ledgerReceipt.payload;
  if(!complete(ledgerRow)||ledger.version!==1||ledger.planHash!==this.plan.hash||!integer(ledger.revision)||!integer(ledger.chargedWrites)||!integer(ledger.chargedReads)
   ||!ledger.days||typeof ledger.days!=='object'||Array.isArray(ledger.days)||Object.keys(ledger.days).length>3)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
  let sumWrites=0,sumReads=0;
  for(const [key,value]of Object.entries(ledger.days)){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||key<this.plan.activatedAt.slice(0,10)||key>=EXPIRES_AT.slice(0,10)
    ||!value||Object.keys(value).sort().join(',')!=='createdAt,reads,writes'||!integer(value.writes)||!integer(value.reads)
    ||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||iso(Date.parse(value.createdAt))!==value.createdAt||value.createdAt.slice(0,10)!==key)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
   sumWrites+=value.writes;sumReads+=value.reads;
  }
  if(sumWrites!==ledger.chargedWrites||sumReads!==ledger.chargedReads)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
  const keys=counterKeys(day),rows=(await this.db.prepare('SELECT budget_key,limit_count,consumed,created_at,updated_at FROM automatic_refresh_budgets WHERE budget_key IN (?,?,?,?)').bind(...keys).all()).results;
  if(!Array.isArray(rows))fail('SERVER_FEED_D1_RECOVERY_RECEIPT');const map=new Map(rows.map(row=>[row.budget_key,row]));
  for(let index=0;index<2;index++){const row=map.get(keys[index]);if(!row||row.limit_count!==(index===0?WRITE_LIMIT:READ_LIMIT)
   ||row.consumed!==(index===0?ledger.chargedWrites:ledger.chargedReads)||row.created_at!==this.plan.activatedAt)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');}
  const daily=await task(this.db,dayKey(day));let dailyCursor=null,dayCreatedAt=null;
  if(daily){const receipt=parse(daily,['version','planHash','day','createdAt']),p=receipt.payload;dailyCursor=receipt.cursor;dayCreatedAt=p.createdAt;
   if(!complete(daily)||p.version!==1||p.planHash!==this.plan.hash||p.day!==day||typeof dayCreatedAt!=='string'||!Number.isFinite(Date.parse(dayCreatedAt))||iso(Date.parse(dayCreatedAt))!==dayCreatedAt||dayCreatedAt.slice(0,10)!==day)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
   for(let index=2;index<4;index++){const row=map.get(keys[index]);if(!row||row.limit_count!==(index===2?WRITE_LIMIT:READ_LIMIT)||row.created_at!==dayCreatedAt
    ||row.consumed!==(index===2?ledger.days[day]?.writes||0:ledger.days[day]?.reads||0))fail('SERVER_FEED_D1_RECOVERY_RECEIPT');}
   if(ledger.days[day]&&ledger.days[day].createdAt!==dayCreatedAt)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
  }else if(map.has(keys[2])||map.has(keys[3])||ledger.days[day])fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
  const condition=["EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='complete' AND cursor=?)",
   "EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='complete' AND cursor=?)"],params=[PLAN_KEY,this.plan.cursor,LEDGER_KEY,ledgerReceipt.cursor];
  keys.forEach(key=>{const row=map.get(key);if(row){
   if(!integer(row.consumed)||typeof row.updated_at!=='string'||!Number.isFinite(Date.parse(row.updated_at))||iso(Date.parse(row.updated_at))!==row.updated_at||row.updated_at<row.created_at)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
   condition.push('EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key=? AND (limit_count,consumed,created_at,updated_at) IS (?,?,?,?))');params.push(key,row.limit_count,row.consumed,row.created_at,row.updated_at);}
   else{condition.push('NOT EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key=?)');params.push(key);}});
  if(daily){condition.push("EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='complete' AND cursor=?)");params.push(dayKey(day),dailyCursor);}
  else{condition.push('NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)');params.push(dayKey(day));}
  if(daily&&(map.get(keys[2]).consumed>map.get(keys[0]).consumed||map.get(keys[3]).consumed>map.get(keys[1]).consumed))fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
  const ctx={day,keys,map,daily:!!daily,dailyCursor,dayCreatedAt,ledger,ledgerCursor:ledgerReceipt.cursor,condition:condition.join(' AND '),params,
   dayWrites:map.get(keys[2])?.consumed||0,dayReads:map.get(keys[3])?.consumed||0,
   lifetimeWrites:map.get(keys[0]).consumed,lifetimeReads:map.get(keys[1]).consumed};this.latest=ctx;this.contexts.set(day,ctx);return ctx;
 }

 status(){
  if(!this.plan)return{enabled:false};const c=this.latest,day=iso(this.now()).slice(0,10),current=this.contexts.get(day);
  return{id:ID,enabled:this.enabled,through:THROUGH,expiresAt:EXPIRES_AT,planHash:this.plan.hash,
   lifetimeWriteLimit:WRITE_LIMIT,lifetimeReadLimit:READ_LIMIT,chargedWrites:c?.lifetimeWrites||0,chargedReads:c?.lifetimeReads||0,
   day,dayCreditWrites:current?.dayWrites||0,dayCreditReads:current?.dayReads||0};
 }
 initDay(ctx,at){if(ctx.daily)return[];ctx.dayCreatedAt=at;ctx.dailyCursor=signed({version:1,planHash:this.plan.hash,day:ctx.day,createdAt:at});return[
  ...ctx.keys.slice(2).map((key,index)=>this.db.prepare('INSERT INTO automatic_refresh_budgets(budget_key,limit_count,consumed,created_at,updated_at) VALUES(?,?,0,?,?)')
   .bind(key,index===0?WRITE_LIMIT:READ_LIMIT,at,at)),insertTask(this.db,dayKey(ctx.day),ctx.dailyCursor,at)];}
 // A constant-size checkpoint detects accidental in-place resets as well as missing/recreated counters.
 // It is an integrity receipt, not protection against an administrator rewriting the entire ledger.
 ledgerDelta(ctx,w,r,at){
  const next=structuredClone(ctx.ledger);next.revision++;next.chargedWrites+=w;next.chargedReads+=r;
  const prior=next.days[ctx.day]||{writes:0,reads:0,createdAt:ctx.dayCreatedAt};
  next.days[ctx.day]={...prior,writes:prior.writes+w,reads:prior.reads+r};
  if(!integer(next.chargedWrites)||!integer(next.chargedReads)||!integer(next.days[ctx.day].writes)||!integer(next.days[ctx.day].reads)||Object.keys(next.days).length>3)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
  return this.db.prepare("UPDATE automatic_refresh_tasks SET cursor=?,last_success_at=?,last_attempt_at=? WHERE task_key=? AND cursor=? AND status='complete'")
   .bind(signed(next),at,at,LEDGER_KEY,ctx.ledgerCursor);
 }
 async prepareReservation({reservationKey,rowsWritten,rowsRead,day,at,scope,dailyWrites,dailyReads}){
  if(!this.plan)return null;
  if(typeof reservationKey!=='string'||!integer(rowsWritten)||!integer(rowsRead)||rowsWritten+rowsRead===0||typeof at!=='string'||!Number.isFinite(Date.parse(at))||iso(Date.parse(at))!==at||at.slice(0,10)!==day)fail('SERVER_FEED_D1_RECOVERY_CONFIG');
  try{scope=scope?structuredClone(scope):null;}catch{fail('SERVER_FEED_D1_RECOVERY_SCOPE');}
  const ctx=await this.context(day),key=bindingKey(reservationKey);
  if(await task(this.db,key))fail('SERVER_FEED_D1_RECOVERY_BINDING');
  let credited=false,generation=null,state=null;
  if(this.enabled&&this.now()<Date.parse(EXPIRES_AT)&&scope&&integer(scope.generationId)&&integer(scope.lastSequence)&&scope.lastSequence<=THROUGH&&['prepared','applying'].includes(scope.status)){
   state=await this.db.prepare('SELECT committed_sequence FROM server_feed_state WHERE singleton=1').bind().first();
   generation=await this.db.prepare('SELECT generation_id,last_sequence,status,retired_at FROM server_feed_generations WHERE generation_id=?').bind(scope.generationId).first();
   credited=integer(state?.committed_sequence)&&state.committed_sequence>=this.plan.startFileCursor&&state.committed_sequence<THROUGH
    &&generation?.last_sequence===scope.lastSequence&&generation.status===scope.status&&generation.retired_at===null;
  }
  if(credited&&(dailyWrites!==BASE_WRITES||dailyReads!==BASE_READS))fail('SERVER_FEED_D1_RECOVERY_POLICY_CONFLICT');
  if(credited&&(ctx.lifetimeWrites+rowsWritten>WRITE_LIMIT||ctx.lifetimeReads+rowsRead>READ_LIMIT))fail('SERVER_FEED_D1_RECOVERY_BUDGET_STOP');
  const payload={version:1,planHash:this.plan.hash,reservationKey,day,estimatedWrites:rowsWritten,estimatedReads:rowsRead,credited,createdAt:at,scope:credited?{generationId:scope.generationId,lastSequence:scope.lastSequence,status:scope.status}:null},cursor=signed(payload);
  let condition=ctx.condition+" AND date('now')=? AND NOT EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=?)",params=[...ctx.params,day,key];
  if(credited){condition+=` AND date('now')=? AND julianday('now')<julianday(?)
   AND EXISTS(SELECT 1 FROM server_feed_state WHERE singleton=1 AND committed_sequence=? AND committed_sequence<?)
   AND EXISTS(SELECT 1 FROM server_feed_generations WHERE generation_id=? AND last_sequence=? AND last_sequence<=? AND status=? AND retired_at IS NULL)
   AND EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key=? AND consumed+?<=limit_count)
   AND EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key=? AND consumed+?<=limit_count)`;
   params.push(day,EXPIRES_AT,state.committed_sequence,THROUGH,scope.generationId,scope.lastSequence,THROUGH,scope.status,ctx.keys[0],rowsWritten,ctx.keys[1],rowsRead);}
  const statements=this.initDay(ctx,at);
  if(credited)ctx.keys.forEach((counter,index)=>statements.push(this.db.prepare('UPDATE automatic_refresh_budgets SET consumed=consumed+?,updated_at=? WHERE budget_key=?')
   .bind(index%2===0?rowsWritten:rowsRead,at,counter)));
  if(credited)statements.push(this.ledgerDelta(ctx,rowsWritten,rowsRead,at));
  statements.push(insertTask(this.db,key,cursor,at,'reserved'));
  return{ctx,condition,params,statements,dayWrites:ctx.dayWrites+(credited?rowsWritten:0),dayReads:ctx.dayReads+(credited?rowsRead:0),credited,
   after:()=>{ctx.dayWrites+=credited?rowsWritten:0;ctx.dayReads+=credited?rowsRead:0;ctx.lifetimeWrites+=credited?rowsWritten:0;ctx.lifetimeReads+=credited?rowsRead:0;this.latest=ctx;}};
 }
 async binding(prior){
  if(!this.plan)return null;const plan=await task(this.db,PLAN_KEY);if(!complete(plan)||plan.cursor!==this.plan.cursor)fail('SERVER_FEED_D1_RECOVERY_RECEIPT');
  const row=await task(this.db,bindingKey(prior.reservation_key));
  if(!row){if(typeof prior.created_at==='string'&&Number.isFinite(Date.parse(prior.created_at))&&iso(Date.parse(prior.created_at))===prior.created_at&&Date.parse(prior.created_at)<Date.parse(this.plan.activatedAt))return null;fail('SERVER_FEED_D1_RECOVERY_BINDING');}
  const receipt=parse(row,['version','planHash','reservationKey','day','estimatedWrites','estimatedReads','credited','createdAt','scope']),p=receipt.payload;
  if(row.platform!=='all'||row.listing_id!==null||row.status!==(prior.status==='settled'?'settled':'reserved')||p.version!==1||p.planHash!==this.plan.hash
   ||p.reservationKey!==prior.reservation_key||p.day!==prior.day_key||p.estimatedWrites!==prior.reserved_writes||p.estimatedReads!==prior.reserved_reads
   ||typeof p.credited!=='boolean'||p.createdAt!==prior.created_at
   ||p.credited&&(!p.scope||!integer(p.scope.generationId)||!integer(p.scope.lastSequence)||p.scope.lastSequence>THROUGH||!['prepared','applying'].includes(p.scope.status))
   ||!p.credited&&p.scope!==null)fail('SERVER_FEED_D1_RECOVERY_BINDING');
  return{row,payload:p};
 }
 async prepareSettlement(prior,usage){
  if(!usage||!integer(usage.rowsWritten)||!integer(usage.rowsRead)||usage.rowsWritten>1e12||usage.rowsRead>1e12)fail('SERVER_FEED_D1_RECOVERY_CONFIG');
  const binding=await this.binding(prior);if(!binding)return null;const ctx=await this.context(prior.day_key);
  if(prior.status==='settled')return{ctx,statements:[],condition:'1=1',params:[],after:()=>{this.latest=ctx;}};
  const w=binding.payload.credited?usage.rowsWritten-prior.reserved_writes:0,r=binding.payload.credited?usage.rowsRead-prior.reserved_reads:0;
  let condition=ctx.condition+` AND EXISTS(SELECT 1 FROM automatic_refresh_tasks WHERE task_key=? AND platform='all' AND listing_id IS NULL AND status='reserved' AND cursor=?)
   AND EXISTS(SELECT 1 FROM server_feed_reservations WHERE reservation_key=? AND (day_key,reserved_writes,reserved_reads,status,created_at,actual_writes,actual_reads) IS (?,?,?,'reserved',?,NULL,NULL))`;
  const params=[...ctx.params,binding.row.task_key,binding.row.cursor,prior.reservation_key,prior.day_key,prior.reserved_writes,prior.reserved_reads,prior.created_at];
  const statements=[];
  if(binding.payload.credited){ctx.keys.forEach((key,index)=>{const delta=index%2===0?w:r;condition+=' AND EXISTS(SELECT 1 FROM automatic_refresh_budgets WHERE budget_key=? AND consumed+?>=0)';params.push(key,delta);
   if(delta!==0)statements.push(this.db.prepare('UPDATE automatic_refresh_budgets SET consumed=consumed+?,updated_at=? WHERE budget_key=?').bind(delta,iso(this.now()),key));});}
  if(binding.payload.credited)statements.push(this.ledgerDelta(ctx,w,r,iso(this.now())));
  statements.push(this.db.prepare("UPDATE automatic_refresh_tasks SET status='settled',last_success_at=?,next_due_at=? WHERE task_key=?")
   .bind(iso(this.now()),iso(this.now()),binding.row.task_key));
  return{ctx,condition,params,statements,after:()=>{ctx.dayWrites+=w;ctx.dayReads+=r;ctx.lifetimeWrites+=w;ctx.lifetimeReads+=r;this.latest=ctx;}};
 }
}
module.exports={D1RecoveryBudget,configuration,ID,WRITE_LIMIT,READ_LIMIT,THROUGH,EXPIRES_AT,FROZEN_GENERATION,PLAN_KEY,LEDGER_KEY,PREFIX,counterKeys,dayKey,bindingKey};