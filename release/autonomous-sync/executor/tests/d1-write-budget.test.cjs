'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openWriteBudget,totals,LIMITS}=require('../scripts/d1-write-budget.cjs');
const {connectD1,TARGETS,ACCOUNT}=require('../scripts/d1-operator-bridge.cjs');
const statement=[{sql:'INSERT INTO auction_events(event_id) VALUES(?)',params:['private-not-in-ledger']}];
const result=(w=4,r=10)=>[{success:true,meta:{rows_written:w,rows_read:r}}];
function setup(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rexbid-budget-'));

 let time=Date.parse('2026-10-09T10:00:00Z');
 const config={directory,now:()=>time,readUsage:async()=>({account:ACCOUNT,day:'2026-10-09',at:new Date(time).toISOString(),rowsWritten:2000,rowsRead:10000}),estimate:()=>({writes:4,reads:10}),...options};
 const guard=openWriteBudget(config);t.after(()=>{guard.close();fs.rmSync(directory,{recursive:true,force:true});});return {guard,directory,config,setTime:t=>{time=t;}};
}
test('durable reservation precedes transport; exact index-inclusive D1 meta survives reopen without values',async t=>{
 const {guard,directory,config}=setup(t);const ticket=await guard.beforeWrite(statement,'publication');
 assert.match(fs.readFileSync(path.join(directory,'ledger.ndjson'),'utf8'),/reserve/);
 guard.complete(ticket,result());guard.close();const next=openWriteBudget(config);
 const ticket2=await next.beforeWrite(statement,'publication');next.complete(ticket2,result());
 const text=fs.readFileSync(path.join(directory,'ledger.ndjson'),'utf8');assert.equal(text.includes('private-not-in-ledger'),false);assert.equal(text.includes('INSERT'),false);
 assert.equal(text.split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.kind==='complete').reduce((n,x)=>n+x.writes,0),8);next.close();
});
test('full account writes reserve stops before transport; another database contributes',async t=>{
 const {guard}=setup(t,{readUsage:async()=>({account:ACCOUNT,day:'2026-10-09',at:'2026-10-09T10:00:00Z',rowsWritten:79999,rowsRead:0})});
 await assert.rejects(guard.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);
});
test('account read reserve also stops a write batch',async t=>{
 const {guard}=setup(t,{readUsage:async()=>({account:ACCOUNT,day:'2026-10-09',at:'2026-10-09T10:00:00Z',rowsWritten:0,rowsRead:4499999})});
 await assert.rejects(guard.beforeWrite(statement,'publication'),/D1_READ_BUDGET_STOP/);
});
test('missing, stale, wrong account and future analytics fail closed',async t=>{
 for(const usage of [null,{account:'other'},{account:ACCOUNT,day:'2026-10-09',at:'2026-10-09T09:58:00Z',rowsWritten:0,rowsRead:0}]){
  const {guard}=setup(t,{readUsage:async()=>usage});await assert.rejects(guard.beforeWrite(statement,'publication'),/FRESH_ACCOUNT/);
 }
});
test('uncertain write remains reserved across restart and cannot be retried',async t=>{
 const {guard,config}=setup(t);await guard.beforeWrite(statement,'publication');guard.close();const next=openWriteBudget(config);
 await assert.rejects(next.beforeWrite(statement,'publication'),/RECONCILIATION_REQUIRED/);next.close();
});
test('only one process can hold account budget; no stale-lock auto deletion',t=>{
 const {config}=setup(t);assert.throws(()=>openWriteBudget(config),/OPERATOR_LOCKED/);
});
test('missing metadata or underestimated batch halts subsequent writes',async t=>{
 for(const output of [[{success:true,meta:{changes:1}}],result(5)]){
  const {guard}=setup(t);const ticket=await guard.beforeWrite(statement,'publication');assert.throws(()=>guard.complete(ticket,output),/METADATA_REQUIRED|ESTIMATE_EXCEEDED/);
  await assert.rejects(guard.beforeWrite(statement,'publication'),/RECONCILIATION_REQUIRED/);
 }
});
test('UTC rollover does not silently start a new running-operation budget',async t=>{
 const {guard,setTime}=setup(t);const ticket=await guard.beforeWrite(statement,'publication');guard.complete(ticket,result());setTime(Date.parse('2026-10-10T00:00:01Z'));
 await assert.rejects(guard.beforeWrite(statement,'publication'),/DAY_CHANGED/);
});
test('slow account analytics is judged against response time, without relaxing freshness',async t=>{
 let time=Date.parse('2026-10-09T10:00:00Z');
 const {guard}=setup(t,{now:()=>time,readUsage:async()=>{
  time+=20000;return{account:ACCOUNT,day:'2026-10-09',at:new Date(time).toISOString(),rowsWritten:2000,rowsRead:10000};
 }});
 const ticket=await guard.beforeWrite(statement,'publication');
 assert.equal(ticket.at,'2026-10-09T10:00:20.000Z');guard.complete(ticket,result());
});
test('analytics awaited across UTC midnight stops before reservation',async t=>{
 let time=Date.parse('2026-10-09T23:59:58Z');
 const {guard,directory}=setup(t,{now:()=>time,readUsage:async()=>{
  time+=10000;return{account:ACCOUNT,day:'2026-10-10',at:new Date(time).toISOString(),rowsWritten:0,rowsRead:0};
 }});
 await assert.rejects(guard.beforeWrite(statement,'publication'),/DAY_CHANGED/);
 assert.equal(fs.existsSync(path.join(directory,'ledger.ndjson')),false);
});
test('genuinely future account analytics still fails before reservation',async t=>{
 const {guard,directory}=setup(t,{readUsage:async()=>({account:ACCOUNT,day:'2026-10-09',at:'2026-10-09T10:00:06Z',rowsWritten:0,rowsRead:0})});
 await assert.rejects(guard.beforeWrite(statement,'publication'),/FRESH_ACCOUNT/);
 assert.equal(fs.existsSync(path.join(directory,'ledger.ndjson')),false);
});
test('bridge requires explicit budget for every mutation, including modified bound statements',async()=>{
 let calls=0;const db=await connectD1({target:'publication',token:'offline',fetchImpl:async()=>{calls++;return {ok:true,status:200,json:async()=>({success:true,result:{uuid:TARGETS.publication.id,name:TARGETS.publication.name}})}}});
 const s=db.prepare(statement[0].sql).bind('fixture');await assert.rejects(s.run(),/WRITE_BUDGET_REQUIRED/);await assert.rejects(db.batch([s]),/WRITE_BUDGET_REQUIRED/);assert.equal(calls,1);
});
test('failed bridge response leaves durable budget reservation; no retries',async t=>{
 const {guard}=setup(t);let calls=0;
 const db=await connectD1({target:'publication',token:'offline',writeBudget:guard,fetchImpl:async()=>{calls++;return calls===1?{ok:true,status:200,json:async()=>({success:true,result:{uuid:TARGETS.publication.id,name:TARGETS.publication.name}})}:{ok:false,status:503,json:async()=>({success:false})}}});
 await assert.rejects(db.batch(statement),/OPERATOR_D1_FAILED/);await assert.rejects(db.batch(statement),/RECONCILIATION_REQUIRED/);assert.equal(calls,2);
});
const paidLimits=Object.freeze({writes:2000000,reads:100000000,writeReserve:20000,readReserve:500000,maxBatchWrites:5000});

test('explicit measured paid baseline above 100M keeps account reserves and defaults intact',async t=>{
 const limits={...paidLimits,reads:350000000};
 const usage=reads=>async()=>({account:ACCOUNT,day:'2026-10-09',at:'2026-10-09T10:00:00Z',rowsWritten:45893,rowsRead:reads});
 const allowed=setup(t,{limits,readUsage:usage(298943835)});
 const ticket=await allowed.guard.beforeWrite(statement,'staging');allowed.guard.complete(ticket,result());
 const blocked=setup(t,{limits,readUsage:usage(349499999)});
 await assert.rejects(blocked.guard.beforeWrite(statement,'staging'),/D1_READ_BUDGET_STOP/);
 assert.equal(LIMITS.reads,5000000);
 const ordinary=setup(t,{readUsage:usage(298943835)});
 await assert.rejects(ordinary.guard.beforeWrite(statement,'staging'),/D1_READ_BUDGET_STOP/);
});

async function committedFixture(t){
 const item=setup(t),stamp='2026-10-09T10:00:00.000Z';
 const batch=Array.from({length:60},(_,i)=>({sql:'INSERT INTO auction_listings (listing_id,platform,lot,summary_synced_at) VALUES(?,?,?,?)',params:['listing-'+i,i%2?'iaai':'copart',String(10000000+i),stamp]}));
 batch.push({sql:'INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor) VALUES(?,?,?,?)',params:['scope:copart','copart',null,'1']},
  {sql:'INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor) VALUES(?,?,?,?)',params:['scope:iaai','iaai',null,'1']},
  {sql:'INSERT INTO automatic_refresh_tasks(task_key,platform,listing_id,cursor) VALUES(?,?,?,?)',params:['scope:copart','copart',null,'2']});
 const ticket=await item.guard.beforeWrite(batch,'publication'),requestPath=path.join(item.directory,'request.json'),proofPath=path.join(item.directory,'proof.json');
 const digest=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 fs.writeFileSync(requestPath,JSON.stringify({body:{batch}}));
 const proof={outcome:'committed',target:'publication',completedAt:stamp,reservation:ticket,requestPath,
  pendingBodySha256:digest(fs.readFileSync(requestPath)),pendingHash:ticket.hash,rows:60,verifiedRows:60,
  checkpointCommitted:true,atomicTransaction:true,allIncomingMatch:true,remoteRowsWritten:0,providerCalls:0,
  checks:batch.slice(0,60).map(s=>({listingId:s.params[0],platform:s.params[1],lot:s.params[2],observedAt:stamp,
   sourceKeyMatch:true,identityMatch:true,observationMatch:true,fingerprintMatch:true,pricesMatch:true,snapshotMatch:true})),
  checkpoints:[{key:'scope:copart',expectedCursor:'2',actualCursor:'2',match:true},{key:'scope:iaai',expectedCursor:'1',actualCursor:'1',match:true}]};
 const save=value=>{fs.writeFileSync(proofPath,JSON.stringify(value));return {proofPath,proofSha256:digest(fs.readFileSync(proofPath))};};
 return {...item,ticket,batch,proof,requestPath,proofPath,save,options:save(proof)};
}

test('proved committed write consumes the whole reservation once without replay and survives restart',async t=>{
 const f=await committedFixture(t);await assert.rejects(f.guard.beforeWrite(statement,'publication'),/RECONCILIATION_REQUIRED/);
 const outcome=f.guard.reconcileCommitted(f.ticket.id,f.options);assert.equal(outcome.outcome,'committed');
 assert.equal(outcome.writes,f.ticket.writes);assert.equal(outcome.reads,f.ticket.reads);
 assert.throws(()=>f.guard.reconcileCommitted(f.ticket.id,f.options),/TICKET_INVALID/);
 const entries=fs.readFileSync(path.join(f.directory,'ledger.ndjson'),'utf8').trim().split('\n').map(JSON.parse),done=entries.at(-1);
 assert.equal(done.reason,'verified_committed');assert.equal(done.metering,'conservative_reservation');assert.equal(done.reconciliation.expected_rows,60);
 assert.equal(done.reconciliation.checkpoint_count,2);assert.equal(done.reconciliation.requestBodySha256,f.proof.pendingBodySha256);
 assert.equal(JSON.stringify(done).includes(f.proofPath),false);assert.equal(JSON.stringify(done).includes('listing-'),false);
 f.guard.close();const next=openWriteBudget(f.config);try{const ticket=await next.beforeWrite(statement,'publication');next.complete(ticket,result());}finally{next.close();}
});

test('committed reconciliation rejects wrong hash, missing artifact, mismatched request and unknown ticket',async t=>{
 const f=await committedFixture(t);
 for(const options of [{}, {...f.options,proofPath:'relative.json'},{...f.options,proofSha256:'a'.repeat(64)},
  {...f.options,proofPath:path.join(f.directory,'absent.json')}])assert.throws(()=>f.guard.reconcileCommitted(f.ticket.id,options),/PROOF_INVALID/);
 assert.throws(()=>f.guard.reconcileCommitted('unknown',f.options),/TICKET_INVALID/);
 fs.appendFileSync(f.requestPath,' ');assert.throws(()=>f.guard.reconcileCommitted(f.ticket.id,f.options),/PROOF_INVALID/);
 await assert.rejects(f.guard.beforeWrite(statement,'publication'),/RECONCILIATION_REQUIRED/);
});

test('committed proof requires every identity, price, timestamp, snapshot and all final cursors',async t=>{
 const f=await committedFixture(t);const variants=[
  p=>{p.outcome='unknown';},p=>{p.target='staging';},p=>{p.reservation.id='other';},p=>{p.pendingHash='a'.repeat(64);},
  p=>{p.rows=59;},p=>{p.verifiedRows=59;},p=>{p.checks.pop();},p=>{p.checks[1]=p.checks[0];},
  p=>{p.checks[0].lot='wrong';},p=>{p.checks[0].platform='unknown';},p=>{p.checks[0].observedAt='2026-10-08T10:00:00.000Z';},
  ...['sourceKeyMatch','identityMatch','observationMatch','fingerprintMatch','pricesMatch','snapshotMatch'].map(key=>p=>{p.checks[0][key]=false;}),
  p=>{p.checkpoints.pop();},p=>{p.checkpoints[1]=p.checkpoints[0];},p=>{p.checkpoints[0].actualCursor='1';},p=>{p.checkpoints[0].expectedCursor='1';},p=>{p.checkpoints[0].match=false;},
  p=>{p.checkpointCommitted=false;},p=>{p.atomicTransaction=false;},p=>{p.allIncomingMatch=false;},
  p=>{p.remoteRowsWritten=1;},p=>{p.providerCalls=1;},p=>{p.completedAt='invalid';},
  p=>{p.completedAt='2026-10-09T09:59:59.000Z';},p=>{p.completedAt='2026-10-09T10:00:06.000Z';}
 ];
 for(const mutate of variants){const p=structuredClone(f.proof);mutate(p);assert.throws(()=>f.guard.reconcileCommitted(f.ticket.id,f.save(p)),/PROOF_INVALID/);}
 f.setTime(Date.parse('2026-10-09T10:10:01Z'));assert.throws(()=>f.guard.reconcileCommitted(f.ticket.id,f.save(f.proof)),/PROOF_INVALID/);
 await assert.rejects(f.guard.beforeWrite(statement,'publication'),/RECONCILIATION_REQUIRED/);
});
test('default D1 limits remain unchanged; explicit bounded policy is copied and immutable',t=>{
 const {guard}=setup(t);
 assert.deepEqual(guard.limits,{writes:100000,reads:5000000,writeReserve:20000,readReserve:500000,maxBatchWrites:5000});
 assert.deepEqual(guard.limits,LIMITS);assert.equal(Object.isFrozen(guard.limits),true);
 const input={...paidLimits};const {guard:paid}=setup(t,{limits:input});input.writes=1;
 assert.deepEqual(paid.limits,paidLimits);assert.equal(Object.isFrozen(paid.limits),true);
 const {guard:bootstrap}=setup(t,{limits:{...paidLimits,writes:8000000}});
 assert.equal(bootstrap.limits.writes,8000000);
});
test('explicit D1 limits reject partial, malformed, unknown and unsafe values before locking',t=>{
 const {guard,config}=setup(t);guard.close();
 const invalid=[null,[],{},'paid',{writes:2000000},{...paidLimits,extra:true},
  {...paidLimits,writes:10000001},{...paidLimits,reads:500000001},
  {...paidLimits,writes:NaN},{...paidLimits,reads:1.5},{...paidLimits,writes:'2000000'},
  {...paidLimits,writeReserve:19999},{...paidLimits,readReserve:499999},
  {...paidLimits,writeReserve:2000000},{...paidLimits,readReserve:100000000},
  {...paidLimits,maxBatchWrites:0},{...paidLimits,maxBatchWrites:5001},
  {...paidLimits,writes:20001,maxBatchWrites:2}];
 for(const limits of invalid)assert.throws(()=>openWriteBudget({...config,limits}),/D1_BUDGET_LIMITS_INVALID/);
});
test('explicit D1 policy allows above default cap but stops at its own write reserve',async t=>{
 const usage=rowsWritten=>async()=>({account:ACCOUNT,day:'2026-10-09',at:'2026-10-09T10:00:00Z',rowsWritten,rowsRead:652408});
 const {guard}=setup(t,{limits:paidLimits,readUsage:usage(100000)});
 const ticket=await guard.beforeWrite(statement,'publication');guard.complete(ticket,result());
 const {guard:atBoundary}=setup(t,{limits:paidLimits,readUsage:usage(1979996)});
 const last=await atBoundary.beforeWrite(statement,'publication');atBoundary.complete(last,result());
 await assert.rejects(atBoundary.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);
 const {guard:over}=setup(t,{limits:paidLimits,readUsage:usage(1979997)});
 await assert.rejects(over.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);
});
test('explicit D1 read reserve and per-batch ceiling remain enforced',async t=>{
 const {guard}=setup(t,{limits:paidLimits,readUsage:async()=>({account:ACCOUNT,day:'2026-10-09',
  at:'2026-10-09T10:00:00Z',rowsWritten:15749,rowsRead:99499991})});
 await assert.rejects(guard.beforeWrite(statement,'publication'),/D1_READ_BUDGET_STOP/);
 const {guard:batch}=setup(t,{limits:paidLimits,estimate:()=>({writes:5001,reads:0})});
 await assert.rejects(batch.beforeWrite(statement,'publication'),/D1_BUDGET_ESTIMATE_REQUIRED/);
});
test('changing explicit D1 policy cannot erase durable account consumption or unknown writes',async t=>{
 const {guard,config}=setup(t,{limits:paidLimits,estimate:()=>({writes:5000,reads:10}),
  readUsage:async()=>({account:ACCOUNT,day:'2026-10-09',at:'2026-10-09T10:00:00Z',rowsWritten:76000,rowsRead:0})});
 const ticket=await guard.beforeWrite(statement,'publication');guard.complete(ticket,result(5000,10));guard.close();
 const defaults=openWriteBudget({...config,limits:undefined});
 await assert.rejects(defaults.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);defaults.close();
 const reopened=openWriteBudget(config);await reopened.beforeWrite(statement,'publication');reopened.close();
 const again=openWriteBudget(config);
 await assert.rejects(again.beforeWrite(statement,'publication'),/RECONCILIATION_REQUIRED/);again.close();
});

test('a large valid journal rebuilds once; reservations and completions do not rescan its history',async t=>{
 const {guard,directory,config}=setup(t);guard.close();
 const day='2026-10-09',entries=[{kind:'baseline',day,writes:39996,reads:0}];
 for(let index=0;index<10000;index++) {
  const id='large-ledger-'+index;
  entries.push({kind:'reserve',id,day,writes:4,reads:10},
   {kind:'complete',id,day,writes:4,reads:10});
 }
 for(let index=0;index<100;index++)entries.push({kind:'read',day,writes:0,reads:1});
 fs.writeFileSync(path.join(directory,'ledger.ndjson'),entries.map(JSON.stringify).join('\n')+'\n');
 const next=openWriteBudget(config);
 // Detect history scans directly rather than imposing a timing threshold that
 // depends on the developer's disk. Small statement/result arrays are allowed.
 const methods=['some','find','filter'],originals=new Map(methods.map(name=>[name,Array.prototype[name]]));
 try {
  for(const name of methods)Array.prototype[name]=function(...args) {
   if(this.length>1000&&this[0]?.kind==='baseline')throw Error('D1_BUDGET_HISTORY_RESCAN');
   return Reflect.apply(originals.get(name),this,args);
  };
  const ticket=await next.beforeWrite(statement,'publication');
  next.complete(ticket,result());next.recordRead(result(0,5));
  await assert.rejects(next.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);
 } finally {for(const [name,original]of originals)Array.prototype[name]=original;next.close();}
 const reopened=openWriteBudget(config);
 try{await assert.rejects(reopened.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);}
 finally{reopened.close();}
});

test('daily read totals survive restart and do not combine separate UTC days',async t=>{
 const {guard,directory,config}=setup(t,{readUsage:async()=>({account:ACCOUNT,day:'2026-10-09',
  at:'2026-10-09T10:00:00Z',rowsWritten:0,rowsRead:0})});guard.close();
 const entries=[
  {kind:'baseline',day:'2026-10-08',writes:0,reads:0},
  {kind:'read',day:'2026-10-08',writes:0,reads:4499999},
  {kind:'baseline',day:'2026-10-09',writes:0,reads:4499970},
  {kind:'read',day:'2026-10-09',writes:0,reads:10}
 ];
 fs.writeFileSync(path.join(directory,'ledger.ndjson'),entries.map(JSON.stringify).join('\n')+'\n');
 const next=openWriteBudget(config);
 const ticket=await next.beforeWrite(statement,'publication');next.complete(ticket,result());
 next.recordRead(result(0,1));next.close();
 const reopened=openWriteBudget(config);
 try{await assert.rejects(reopened.beforeWrite(statement,'publication'),/D1_READ_BUDGET_STOP/);}
 finally{reopened.close();}
});

test('malformed, duplicate and orphaned ledger completions fail closed and release the lock',async t=>{
 const {guard,directory,config}=setup(t);const ticket=await guard.beforeWrite(statement,'publication');
 guard.complete(ticket,result());guard.close();
 const file=path.join(directory,'ledger.ndjson');
 const valid=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
 const reserve=valid.find(event=>event.kind==='reserve'),complete=valid.find(event=>event.kind==='complete');
 const variants=[
  [...valid,complete],
  [...valid,{...reserve}],
  [valid[0],complete],
  [valid[0],reserve,{...complete,day:'2026-10-10'}],
  [...valid,{...valid[0]}],
  [...valid,{kind:'read',day:ticket.day,writes:1,reads:0}],
  [...valid,{kind:'read',day:ticket.day,writes:0,reads:-1}],
  [...valid,{kind:'read',day:'not-a-day',writes:0,reads:1}],
  [...valid,{kind:'read',day:ticket.day,writes:0,reads:Number.MAX_SAFE_INTEGER}]
 ];
 for(const rows of variants) {
  fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');
  assert.throws(()=>openWriteBudget(config),/D1_BUDGET_LEDGER_INVALID/);
  assert.equal(fs.existsSync(path.join(directory,'account.lock')),false);
 }
 fs.writeFileSync(file,valid.map(JSON.stringify).join('\n'));
 assert.throws(()=>openWriteBudget(config),/D1_BUDGET_LEDGER_INVALID/);
 fs.writeFileSync(file,valid.map(JSON.stringify).join('\n')+'\n');
 openWriteBudget(config).close();
});

test('a crash between an underestimated completion and its halt record still stops after restart',async t=>{
 const {guard,directory,config}=setup(t);const ticket=await guard.beforeWrite(statement,'publication');
 assert.throws(()=>guard.complete(ticket,result(5)),/D1_BUDGET_ESTIMATE_EXCEEDED/);guard.close();
 const file=path.join(directory,'ledger.ndjson');
 const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse).filter(event=>event.kind!=='halt');
 fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');
 const next=openWriteBudget(config);
 try{await assert.rejects(next.beforeWrite(statement,'publication'),/D1_BUDGET_RECONCILIATION_REQUIRED/);}
 finally{next.close();}
});

test('only the pending immutable reservation can complete, and a closed guard cannot append',async t=>{
 const {guard,directory}=setup(t);const ticket=await guard.beforeWrite(statement,'publication');
 assert.equal(Object.isFrozen(ticket),true);
 for(const forged of [{...ticket,id:'unknown'},{...ticket,day:'2026-10-10'},
  {...ticket,writes:5000},{...ticket,reads:5000}]) {
  assert.throws(()=>guard.complete(forged,result()),/D1_BUDGET_TICKET_INVALID/);
 }
 guard.complete(ticket,result());assert.throws(()=>guard.complete(ticket,result()),/D1_BUDGET_TICKET_INVALID/);
 guard.close();const file=path.join(directory,'ledger.ndjson'),before=fs.readFileSync(file,'utf8');
 assert.throws(()=>guard.complete(ticket,result()),/D1_BUDGET_CLOSED/);
 assert.throws(()=>guard.recordRead(result(0,5)),/D1_BUDGET_CLOSED/);
 assert.equal(fs.readFileSync(file,'utf8'),before);
});

test('overlapping analytics awaits cannot create two outstanding reservations',async t=>{
 let release;const ready=new Promise(resolve=>{release=resolve;});
 const {guard}=setup(t,{readUsage:async()=>{await ready;return{account:ACCOUNT,day:'2026-10-09',
  at:'2026-10-09T10:00:00Z',rowsWritten:0,rowsRead:0};}});
 const first=guard.beforeWrite(statement,'publication'),second=guard.beforeWrite(statement,'staging');release();
 const results=await Promise.allSettled([first,second]);
 assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
 assert.match(results.find(item=>item.status==='rejected').reason.message,/D1_BUDGET_RECONCILIATION_REQUIRED/);
 guard.complete(results.find(item=>item.status==='fulfilled').value,result());
});

test('a failed reservation flush latches uncertainty in memory and remains pending on restart',async t=>{
 const {guard,config}=setup(t);const original=fs.fsyncSync;let flushes=0;
 try {
  fs.fsyncSync=function(...args){if(++flushes===2)throw Error('synthetic flush failure');return Reflect.apply(original,this,args);};
  await assert.rejects(guard.beforeWrite(statement,'publication'),/synthetic flush failure/);
 } finally {fs.fsyncSync=original;}
 await assert.rejects(guard.beforeWrite(statement,'publication'),/D1_BUDGET_RECONCILIATION_REQUIRED/);
 guard.close();const next=openWriteBudget(config);
 try{await assert.rejects(next.beforeWrite(statement,'publication'),/D1_BUDGET_RECONCILIATION_REQUIRED/);}
 finally{next.close();}
});

test('explicit proved reconciliation consumes the full unknown reservation and survives restart',async t=>{
 const {guard,directory,config}=setup(t,{readUsage:async()=>({account:ACCOUNT,day:'2026-10-09',
  at:'2026-10-09T10:00:00Z',rowsWritten:79996,rowsRead:0})});
 const ticket=await guard.beforeWrite(statement,'publication');guard.close();
 const next=openWriteBudget(config);
 const proof={outcome:'not_committed',proofSha256:'a'.repeat(64),target:ticket.target,
  reservationHash:ticket.hash,checkpoint_not_committed:true,atomic_transaction:true,
  expected_rows:59,verified_rows:59,all_rows_match_baseline:true};
 await assert.rejects(next.beforeWrite(statement,'publication'),/D1_BUDGET_RECONCILIATION_REQUIRED/);
 const reconciled=next.reconcileUnknown(ticket.id,proof);
 assert.equal(reconciled.writes,4);assert.equal(reconciled.reads,10);
 assert.equal(reconciled.metering,'conservative_reservation');
 assert.throws(()=>next.reconcileUnknown(ticket.id,proof),/D1_BUDGET_TICKET_INVALID/);
 await assert.rejects(next.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);next.close();
 const row=fs.readFileSync(path.join(directory,'ledger.ndjson'),'utf8').trim().split('\n').map(JSON.parse).at(-1);
 assert.equal(row.kind,'complete');assert.equal(row.reason,'verified_not_committed');
 assert.equal(row.proofSha256,proof.proofSha256);assert.deepEqual(row.reconciliation,proof);
 const reopened=openWriteBudget(config);
 try{await assert.rejects(reopened.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);}
 finally{reopened.close();}
});

test('reconciliation requires every proof assertion and an exact pending reservation binding',async t=>{
 const {guard,directory}=setup(t);const ticket=await guard.beforeWrite(statement,'publication');
 const proof={outcome:'not_committed',proofSha256:'b'.repeat(64),target:ticket.target,
  reservationHash:ticket.hash,checkpoint_not_committed:true,atomic_transaction:true,
  expected_rows:59,verified_rows:59,all_rows_match_baseline:true};
 const file=path.join(directory,'ledger.ndjson'),before=fs.readFileSync(file,'utf8');
 const variants=[null,{},...Object.keys(proof).map(key=>{const copy={...proof};delete copy[key];return copy;}),
  {...proof,outcome:'committed'},{...proof,proofSha256:'not-a-digest'},
  {...proof,target:'staging'},{...proof,reservationHash:'c'.repeat(64)},
  {...proof,checkpoint_not_committed:false},{...proof,atomic_transaction:false},
  {...proof,all_rows_match_baseline:false},{...proof,expected_rows:0,verified_rows:0},
  {...proof,verified_rows:58},{...proof,expected_rows:1.5,verified_rows:1.5}];
 for(const invalid of variants)assert.throws(()=>guard.reconcileUnknown(ticket.id,invalid),/D1_BUDGET_RECONCILIATION_PROOF_INVALID/);
 assert.throws(()=>guard.reconcileUnknown('unknown',proof),/D1_BUDGET_TICKET_INVALID/);
 assert.equal(fs.readFileSync(file,'utf8'),before);
 await assert.rejects(guard.beforeWrite(statement,'publication'),/D1_BUDGET_RECONCILIATION_REQUIRED/);
 guard.reconcileUnknown(ticket.id,proof);
 const following=await guard.beforeWrite(statement,'publication');guard.complete(following,result());
});

test('replay rejects forged reconciliation metadata and refunds',async t=>{
 const {guard,directory,config}=setup(t);const ticket=await guard.beforeWrite(statement,'publication');
 const proof={outcome:'not_committed',proofSha256:'d'.repeat(64),target:ticket.target,
  reservationHash:ticket.hash,checkpoint_not_committed:true,atomic_transaction:true,
  expected_rows:59,verified_rows:59,all_rows_match_baseline:true};
 guard.reconcileUnknown(ticket.id,proof);guard.close();
 const file=path.join(directory,'ledger.ndjson');
 const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
 for(const change of [row=>{row.writes=0;},row=>{row.reads=0;},
  row=>{row.reconciliation.verified_rows=58;},row=>{row.proofSha256='e'.repeat(64);},
  row=>{row.reason='cleared_without_proof';}]) {
  const altered=structuredClone(rows);change(altered.at(-1));
  fs.writeFileSync(file,altered.map(JSON.stringify).join('\n')+'\n');
  assert.throws(()=>openWriteBudget(config),/D1_BUDGET_LEDGER_INVALID/);
 }
 fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');openWriteBudget(config).close();
});

async function estimateReviewFixture(t,options={}){
 const cost={writes:300,reads:50000};
 const f=setup(t,{estimate:()=>({...cost}),...options});
 const ticket=await f.guard.beforeWrite(statement,'publication');
 assert.throws(()=>f.guard.complete(ticket,result(308,228)),/D1_BUDGET_ESTIMATE_EXCEEDED/);
 const digest=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const readbackPath=path.join(f.directory,'independent-readback.json.gz'),proofPath=path.join(f.directory,'estimate-review.json');
 const readback={version:1,target:'publication',completedAt:'2026-10-09T10:00:00.000Z',atomicReadback:true,
  remoteRowsWritten:0,providerCalls:0,decision:{outcome:'committed',verified:true,checkpoint_committed:true,
   all_rows_match_incoming:true,all_tasks_match_incoming:true,expected_rows:2,verified_rows:2}};
 const saveReadback=value=>{fs.writeFileSync(readbackPath,require('node:zlib').gzipSync(JSON.stringify(value)));return digest(fs.readFileSync(readbackPath));};
 const proof={version:1,kind:'d1_estimate_halt_review',operatorReviewed:true,
  reservation:Object.fromEntries(['id','day','target','hash','writes','reads'].map(key=>[key,ticket[key]])),
  actual:{writes:308,reads:228},reviewedEstimate:{writes:5000,reads:50000},limits:{...f.guard.limits},
  readback:{path:readbackPath,sha256:saveReadback(readback)}};
 const save=value=>{fs.writeFileSync(proofPath,JSON.stringify(value));return{proofPath,proofSha256:digest(fs.readFileSync(proofPath))};};
 return{...f,ticket,cost,proof,readback,readbackPath,proofPath,saveReadback,save,options:save(proof),
  ledger:path.join(f.directory,'ledger.ndjson')};
}

test('audited estimate review preserves measured completion and requires the reviewed estimator across restart',async t=>{
 const f=await estimateReviewFixture(t),before=fs.readFileSync(f.ledger,'utf8');
 const acknowledged=f.guard.acknowledgeEstimateHalt(f.ticket.id,f.options);
 assert.equal(acknowledged.acknowledged,true);assert.deepEqual(acknowledged.actual,{writes:308,reads:228});
 assert.equal(fs.readFileSync(f.ledger,'utf8').startsWith(before),true);
 const rows=fs.readFileSync(f.ledger,'utf8').trim().split('\n').map(JSON.parse),review=rows.at(-1);
 assert.equal(review.kind,'estimate_review');assert.equal(review.writes,0);assert.equal(review.reads,0);
 assert.deepEqual(rows.find(row=>row.kind==='complete'),JSON.parse(before.trim().split('\n').find(line=>JSON.parse(line).kind==='complete')));
 assert.equal(JSON.stringify(review).includes(f.proofPath),false);assert.equal(JSON.stringify(review).includes('private-not-in-ledger'),false);
 assert.equal(JSON.stringify(review).includes('INSERT'),false);
 assert.throws(()=>f.guard.acknowledgeEstimateHalt(f.ticket.id,f.options),/REVIEW_NOT_ALLOWED/);
 await assert.rejects(f.guard.beforeWrite(statement,'publication'),/REVIEWED_ESTIMATE_REQUIRED/);
 f.cost.writes=5000;f.cost.reads=49999;
 await assert.rejects(f.guard.beforeWrite(statement,'publication'),/REVIEWED_ESTIMATE_REQUIRED/);
 f.cost.reads=50000;f.guard.close();
 const next=openWriteBudget(f.config);
 try{const ticket=await next.beforeWrite(statement,'publication');assert.equal(ticket.writes,5000);assert.equal(ticket.reads,50000);next.complete(ticket,result());}
 finally{next.close();}
 const oldEstimator=openWriteBudget({...f.config,estimate:()=>({writes:300,reads:50000})});
 try{await assert.rejects(oldEstimator.beforeWrite(statement,'publication'),/REVIEWED_ESTIMATE_REQUIRED/);}finally{oldEstimator.close();}
});

test('estimate review never refunds the overrun or raises daily/account limits',async t=>{
 const f=await estimateReviewFixture(t,{readUsage:async()=>({account:ACCOUNT,day:'2026-10-09',at:'2026-10-09T10:00:00Z',rowsWritten:74700,rowsRead:0})});
 f.guard.acknowledgeEstimateHalt(f.ticket.id,f.options);f.cost.writes=5000;
 await assert.rejects(f.guard.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);
 assert.deepEqual(f.guard.limits,LIMITS);f.guard.close();const next=openWriteBudget(f.config);
 try{await assert.rejects(next.beforeWrite(statement,'publication'),/D1_WRITE_BUDGET_STOP/);}finally{next.close();}
});

test('estimate review rejects wrong ticket, changed policy, unsafe costs and altered proof fields without appending',async t=>{
 const f=await estimateReviewFixture(t),before=fs.readFileSync(f.ledger,'utf8');
 assert.throws(()=>f.guard.acknowledgeEstimateHalt('other',f.options),/TICKET_INVALID/);
 const variants=[
  p=>{p.operatorReviewed=false;},p=>{p.kind='clear_halt';},p=>{p.reservation.id='wrong';},p=>{p.reservation.hash='a'.repeat(64);},
  p=>{p.reservation.target='staging';},p=>{p.reservation.writes++;},p=>{p.reservation.day='2026-10-08';},
  p=>{p.actual.writes=300;},p=>{p.actual.reads=229;},p=>{p.reviewedEstimate.writes=307;},p=>{p.reviewedEstimate.writes=5001;},
  p=>{p.reviewedEstimate.reads=49999;},p=>{p.reviewedEstimate.reads=4500001;},p=>{p.reviewedEstimate.writes=NaN;},
  p=>{p.limits.writes=200000;},p=>{p.readback.sha256='b'.repeat(64);},p=>{p.readback.path='relative.json';},p=>{p.extra=true;}
 ];
 for(const mutate of variants){const proof=structuredClone(f.proof);mutate(proof);assert.throws(()=>f.guard.acknowledgeEstimateHalt(f.ticket.id,f.save(proof)),/ESTIMATE_REVIEW_INVALID/);}
 assert.throws(()=>f.guard.acknowledgeEstimateHalt(f.ticket.id,{...f.options,proofSha256:'c'.repeat(64)}),/ESTIMATE_REVIEW_INVALID/);
 assert.equal(fs.readFileSync(f.ledger,'utf8'),before);f.guard.close();
 const changed=openWriteBudget({...f.config,limits:{...LIMITS,writes:200000}});
 try{assert.throws(()=>changed.acknowledgeEstimateHalt(f.ticket.id,f.save(f.proof)),/POLICY_MISMATCH/);}finally{changed.close();}
});

test('estimate review reads independent immutable proof and requires committed atomic full readback',async t=>{
 const f=await estimateReviewFixture(t),before=fs.readFileSync(f.ledger,'utf8');
 for(const mutate of [p=>{p.decision.outcome='not_committed';},p=>{p.decision.verified=false;},
  p=>{p.decision.checkpoint_committed=false;},p=>{p.decision.all_rows_match_incoming=false;},p=>{p.decision.all_tasks_match_incoming=false;},
  p=>{p.decision.verified_rows=1;},p=>{p.atomicReadback=false;},p=>{p.target='staging';},p=>{p.remoteRowsWritten=1;},p=>{p.providerCalls=1;},
  p=>{p.completedAt='2026-10-09T09:59:59.000Z';},p=>{p.completedAt='2026-10-09T10:00:06.000Z';}]){
  const readback=structuredClone(f.readback);mutate(readback);const proof=structuredClone(f.proof);proof.readback.sha256=f.saveReadback(readback);
  assert.throws(()=>f.guard.acknowledgeEstimateHalt(f.ticket.id,f.save(proof)),/ESTIMATE_REVIEW_INVALID/);
 }
 fs.unlinkSync(f.readbackPath);assert.throws(()=>f.guard.acknowledgeEstimateHalt(f.ticket.id,f.save(f.proof)),/ESTIMATE_REVIEW_INVALID/);
 assert.equal(fs.readFileSync(f.ledger,'utf8'),before);
});

test('other halts, missing or duplicate halt marker and outstanding reservations cannot be acknowledged',async t=>{
 const f=await estimateReviewFixture(t);f.guard.close();
 const original=fs.readFileSync(f.ledger,'utf8').trim().split('\n').map(JSON.parse);
 const variants=[
  original.filter(row=>row.kind!=='halt'),
  original.map(row=>row.kind==='halt'?{...row,reason:'manual_stop'}:row),
  [...original,{kind:'halt',day:f.ticket.day,reason:'estimate_exceeded'}],
  [...original,{kind:'halt',day:f.ticket.day,reason:'unknown'}],
  [...original,{...original.find(row=>row.kind==='reserve'),id:'still-pending'}],
  [...original,{...original.find(row=>row.kind==='reserve'),id:'newer'},
   {...original.find(row=>row.kind==='complete'),id:'newer',writes:1,reads:1}]
 ];
 for(const rows of variants){fs.writeFileSync(f.ledger,rows.map(JSON.stringify).join('\n')+'\n');const guard=openWriteBudget(f.config);
  try{assert.throws(()=>guard.acknowledgeEstimateHalt(f.ticket.id,f.options),/REVIEW_NOT_ALLOWED/);await assert.rejects(guard.beforeWrite(statement,'publication'),/RECONCILIATION_REQUIRED/);}
  finally{guard.close();}
 }
});

test('reloading reviewed journals rejects duplicate acknowledgements, tampered bindings and refunds',async t=>{
 const f=await estimateReviewFixture(t);f.guard.acknowledgeEstimateHalt(f.ticket.id,f.options);f.guard.close();
 const original=fs.readFileSync(f.ledger,'utf8').trim().split('\n').map(JSON.parse);
 const variants=[rows=>{rows.push(rows.at(-1));},rows=>{rows.at(-1).id='wrong';},rows=>{rows.at(-1).writes=-308;},
  rows=>{rows.at(-1).reads=1;},rows=>{rows.at(-1).proofSha256='f'.repeat(64);},rows=>{rows.at(-1).review.actual.writes=300;},
  rows=>{rows.at(-1).review.reservation.hash='f'.repeat(64);},rows=>{rows.at(-1).review.reviewedEstimate.writes=5001;},
  rows=>{rows.at(-1).review.limits.writes=200000;},rows=>{rows.find(row=>row.kind==='complete').writes=309;},
  rows=>{rows.find(row=>row.kind==='complete').at='invalid';},rows=>{rows.at(-2).reason='manual_stop';}];
 for(const mutate of variants){const rows=structuredClone(original);mutate(rows);fs.writeFileSync(f.ledger,rows.map(JSON.stringify).join('\n')+'\n');
  assert.throws(()=>openWriteBudget(f.config),/LEDGER_INVALID/);assert.equal(fs.existsSync(path.join(f.directory,'account.lock')),false);
 }
 fs.writeFileSync(f.ledger,original.map(JSON.stringify).join('\n')+'\n');openWriteBudget(f.config).close();
});

test('uncertain append blocks acknowledgement and a failed acknowledgement flush cannot continue in memory',async t=>{
 for(const kind of ['earlier-read','review']){
  const f=await estimateReviewFixture(t),original=fs.fsyncSync;
  try{fs.fsyncSync=()=>{throw Error('synthetic review flush failure');};
   if(kind==='earlier-read')assert.throws(()=>f.guard.recordRead(result(0,1)),/flush failure/);
   else assert.throws(()=>f.guard.acknowledgeEstimateHalt(f.ticket.id,f.options),/flush failure/);
  }finally{fs.fsyncSync=original;}
  assert.throws(()=>f.guard.acknowledgeEstimateHalt(f.ticket.id,f.options),/REVIEW_NOT_ALLOWED/);
  await assert.rejects(f.guard.beforeWrite(statement,'publication'),/RECONCILIATION_REQUIRED/);
 }
});
