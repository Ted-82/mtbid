'use strict';

// Operator-side protection, not a Cloudflare billing cap. One shared directory
// per account, outside Git. No SQL, parameters, tokens or customer data in ledger.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {gunzipSync} = require('node:zlib');
const paidBootstrap=require('./d1-paid-bootstrap-proof.cjs');
const ACCOUNT = '7ff5a57444667c4eda2a6a7f0fc4120d';
const LIMITS = Object.freeze({writes:100000, reads:5000000, writeReserve:20000, readReserve:500000, maxBatchWrites:5000});
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer = n => Number.isSafeInteger(n) && n >= 0;
const hex = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value,keys) => value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
function stop(code) {throw Error(code);}
function validatedLimits(limits, paidContext = null) {
  if (limits === undefined) return LIMITS;
  const keys = Object.keys(LIMITS);
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)
      || Reflect.ownKeys(limits).length !== keys.length
      || keys.some(key => !Object.hasOwn(limits,key))) stop('D1_BUDGET_LIMITS_INVALID');
  // Copy data properties once; getters cannot change limits between validation
  // and use, and later caller mutations cannot change this guard's policy.
  const policy=Object.fromEntries(keys.map(key => [key,Object.getOwnPropertyDescriptor(limits,key).value]));
  if(paidBootstrap.permitsPaidBootstrap(paidContext)&&policy.reads>500000000&&keys.some(key=>policy[key]!==paidContext.pin.limits[key]))stop('D1_BUDGET_LIMITS_INVALID');
  if (keys.some(key => !integer(policy[key]))
      // A full-market bootstrap is a separate, explicitly bounded operator job.
      // Its caller must verify remaining paid monthly allowance before choosing
      // this ceiling. Defaults and per-batch / unknown-write guards stay intact.
      || policy.writes <= 0 || policy.writes > 10000000
      // This is ACCOUNT-wide usage, including the public catalogue. A measured
      // paid-plan baseline may exceed 100M reads before a small operator job.
      // Callers still verify monthly allowance and bound their own job; raising
      // this configurable maximum does not change the conservative defaults.
      || policy.reads <= 0 || policy.reads > (paidBootstrap.permitsPaidBootstrap(paidContext)?paidBootstrap.MAX_READS:500000000)
      || policy.writeReserve < LIMITS.writeReserve || policy.writeReserve >= policy.writes
      || policy.readReserve < LIMITS.readReserve || policy.readReserve >= policy.reads
      || policy.maxBatchWrites < 1 || policy.maxBatchWrites > LIMITS.maxBatchWrites
      || policy.maxBatchWrites > policy.writes-policy.writeReserve) stop('D1_BUDGET_LIMITS_INVALID');
  return Object.freeze(policy);
}
function totals(results) {
  if (!Array.isArray(results) || !results.length || results.some(x => x.success === false
    || !integer(x.meta?.rows_written) || !integer(x.meta?.rows_read))) stop('D1_BUDGET_METADATA_REQUIRED');
  const actual={writes:results.reduce((n,x)=>n+x.meta.rows_written,0), reads:results.reduce((n,x)=>n+x.meta.rows_read,0)};
  if(!integer(actual.writes)||!integer(actual.reads))stop('D1_BUDGET_METADATA_REQUIRED');
  return actual;
}
function reconciliationProof(reservation, proof) {
  if(!proof||typeof proof!=='object'||Array.isArray(proof))stop('D1_BUDGET_RECONCILIATION_PROOF_INVALID');
  const evidence=Object.fromEntries(['outcome','proofSha256','target','reservationHash',
    'checkpoint_not_committed','atomic_transaction','expected_rows','verified_rows',
    'all_rows_match_baseline'].map(key=>[key,proof[key]]));
  if(evidence.outcome!=='not_committed'||typeof evidence.proofSha256!=='string'
      || !/^[a-f0-9]{64}$/.test(evidence.proofSha256)
      || typeof reservation.target!=='string'||!reservation.target||evidence.target!==reservation.target
      || typeof reservation.hash!=='string'||!/^[a-f0-9]{64}$/.test(reservation.hash)
      || evidence.reservationHash!==reservation.hash||evidence.checkpoint_not_committed!==true
      || evidence.atomic_transaction!==true||evidence.all_rows_match_baseline!==true
      || !integer(evidence.expected_rows)||evidence.expected_rows<1
      || evidence.verified_rows!==evidence.expected_rows)stop('D1_BUDGET_RECONCILIATION_PROOF_INVALID');
  return evidence;
}
function committedReconciliationProof(reservation, proof) {
  const keys=['outcome','proofSha256','target','reservationHash','requestBodySha256','expected_rows','verified_rows',
    'checkpoint_count','checkpoint_committed','atomic_transaction','all_rows_match_incoming'];
  if(!proof||typeof proof!=='object'||Array.isArray(proof))stop('D1_BUDGET_RECONCILIATION_PROOF_INVALID');
  const evidence=Object.fromEntries(keys.map(key=>[key,proof[key]]));
  if(evidence.outcome!=='committed'||evidence.target!==reservation.target||evidence.reservationHash!==reservation.hash
      ||![evidence.proofSha256,evidence.requestBodySha256,reservation.hash].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))
      ||!integer(evidence.expected_rows)||evidence.expected_rows<1||evidence.expected_rows>60
      ||evidence.verified_rows!==evidence.expected_rows||!integer(evidence.checkpoint_count)||evidence.checkpoint_count<1
      ||evidence.checkpoint_committed!==true||evidence.atomic_transaction!==true||evidence.all_rows_match_incoming!==true)stop('D1_BUDGET_RECONCILIATION_PROOF_INVALID');
  return evidence;
}
function verifiedCommittedArtifact(reservation, options, now) {
  const invalid=()=>stop('D1_BUDGET_RECONCILIATION_PROOF_INVALID');
  if(!options||!path.isAbsolute(options.proofPath||'')||!/^[a-f0-9]{64}$/.test(options.proofSha256||''))invalid();
  let bytes,proof,requestBytes,request;
  try {
    if(fs.statSync(options.proofPath).size>1000000)invalid();
    bytes=fs.readFileSync(options.proofPath);
    if(createHash('sha256').update(bytes).digest('hex')!==options.proofSha256)invalid();
    proof=JSON.parse(bytes);
    if(!path.isAbsolute(proof.requestPath||'')||fs.statSync(proof.requestPath).size>10000000)invalid();
    requestBytes=fs.readFileSync(proof.requestPath);request=JSON.parse(requestBytes);
  } catch {invalid();}
  const statements=request?.body?.batch,completed=Date.parse(proof.completedAt);
  if(!Array.isArray(statements)||!statements.length||!Number.isFinite(completed)||completed<Date.parse(reservation.at)
      ||now-completed>600000||completed>now+5000||proof.remoteRowsWritten!==0||proof.providerCalls!==0
      ||proof.outcome!=='committed'||proof.target!==reservation.target||proof.pendingHash!==reservation.hash
      ||['id','day','target','hash','writes','reads'].some(k=>proof.reservation?.[k]!==reservation[k])
      ||sha(statements.map(s=>({sql:s.sql,params:s.params||[]})))!==reservation.hash
      ||createHash('sha256').update(requestBytes).digest('hex')!==proof.pendingBodySha256)invalid();
  const incoming=statements.filter(s=>/^INSERT INTO auction_listings\s*\(/.test(s.sql)).map(s=>{
    const columns=s.sql.match(/^INSERT INTO auction_listings\s*\(([^)]+)\)/)[1].split(',').map(x=>x.trim());
    return Object.fromEntries(columns.map((name,i)=>[name,s.params?.[i]]));
  });
  const required=['sourceKeyMatch','identityMatch','observationMatch','fingerprintMatch','pricesMatch','snapshotMatch'];
  if(incoming.length!==proof.rows||proof.verifiedRows!==proof.rows||!Array.isArray(proof.checks)
      ||proof.checks.length!==incoming.length||new Set(incoming.map(r=>r.listing_id)).size!==incoming.length
      ||new Set(proof.checks.map(r=>r.listingId)).size!==incoming.length)invalid();
  for(const row of incoming){const check=proof.checks.find(c=>c.listingId===row.listing_id);
    if(!check||check.platform!==row.platform||check.lot!==row.lot||check.observedAt!==row.summary_synced_at
        ||required.some(key=>check[key]!==true))invalid();}
  const expected=new Map();
  for(const s of statements.filter(s=>/INSERT INTO automatic_refresh_tasks/.test(s.sql)))expected.set(s.params?.[0],s.params?.[3]);
  if(!Array.isArray(proof.checkpoints)||proof.checkpoints.length!==expected.size
      ||new Set(proof.checkpoints.map(c=>c.key)).size!==expected.size)invalid();
  for(const c of proof.checkpoints)if(!expected.has(c.key)||c.expectedCursor!==expected.get(c.key)||c.actualCursor!==expected.get(c.key)||c.match!==true)invalid();
  return committedReconciliationProof(reservation,{outcome:proof.outcome,proofSha256:options.proofSha256,target:proof.target,
    reservationHash:proof.pendingHash,requestBodySha256:proof.pendingBodySha256,expected_rows:proof.rows,verified_rows:proof.verifiedRows,
    checkpoint_count:expected.size,checkpoint_committed:proof.checkpointCommitted,atomic_transaction:proof.atomicTransaction,all_rows_match_incoming:proof.allIncomingMatch});
}
const REVIEW_RESERVATION_KEYS=['id','day','target','hash','writes','reads'];
function validateEstimateReview(reservation,completion,evidence,paidContext=null) {
  const invalid=()=>stop('D1_BUDGET_ESTIMATE_REVIEW_INVALID');
  if(!exact(evidence,['proofSha256','readbackSha256','operatorReviewed','outcome','atomicReadback','verified',
      'reservation','actual','reviewedEstimate','limits']) || !hex(evidence.proofSha256)||!hex(evidence.readbackSha256)
      || evidence.operatorReviewed!==true||evidence.outcome!=='committed'||evidence.atomicReadback!==true||evidence.verified!==true
      || !exact(evidence.reservation,REVIEW_RESERVATION_KEYS)
      || REVIEW_RESERVATION_KEYS.some(key=>evidence.reservation[key]!==reservation[key])||!hex(reservation.hash)
      || typeof reservation.target!=='string'||!reservation.target
      || ![Date.parse(reservation.at),Date.parse(completion.at)].every(Number.isFinite)||Date.parse(completion.at)<Date.parse(reservation.at)
      || !exact(evidence.actual,['writes','reads'])||!exact(evidence.reviewedEstimate,['writes','reads'])
      || evidence.actual.writes!==completion.writes||evidence.actual.reads!==completion.reads
      || !(completion.writes>reservation.writes||completion.reads>reservation.reads))invalid();
  let limits;try{limits=validatedLimits(evidence.limits,paidContext);}catch{invalid();}
  if(!exact(reservation.limits,Object.keys(limits))||Object.keys(limits).some(key=>limits[key]!==reservation.limits[key])
      || !['writes','reads'].every(key=>integer(evidence.reviewedEstimate[key])
        && evidence.reviewedEstimate[key]>=Math.max(reservation[key],completion[key]))
      || evidence.reviewedEstimate.writes<1||evidence.reviewedEstimate.writes>limits.maxBatchWrites
      || evidence.reviewedEstimate.reads>limits.reads-limits.readReserve)invalid();
  return evidence;
}
function verifiedEstimateReview(reservation,completion,options,now,paidContext=null) {
  const invalid=()=>stop('D1_BUDGET_ESTIMATE_REVIEW_INVALID');
  if(!exact(options,['proofPath','proofSha256'])||!path.isAbsolute(options.proofPath||'')||!hex(options.proofSha256))invalid();
  const read=(file,max)=>{
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)invalid();
    return fs.readFileSync(file);
  };
  let proof,readback;
  try {
    const bytes=read(options.proofPath,1000000);
    if(createHash('sha256').update(bytes).digest('hex')!==options.proofSha256)invalid();
    proof=JSON.parse(bytes);
    if(!exact(proof,['version','kind','operatorReviewed','reservation','actual','reviewedEstimate','limits','readback'])
        ||proof.version!==1||proof.kind!=='d1_estimate_halt_review'||proof.operatorReviewed!==true
        ||!exact(proof.readback,['path','sha256'])||!path.isAbsolute(proof.readback.path||'')||!hex(proof.readback.sha256))invalid();
    const evidenceBytes=read(proof.readback.path,10000000);
    if(createHash('sha256').update(evidenceBytes).digest('hex')!==proof.readback.sha256)invalid();
    readback=JSON.parse(proof.readback.path.endsWith('.gz')?gunzipSync(evidenceBytes,{maxOutputLength:32000000}):evidenceBytes);
  }catch{invalid();}
  const completedAt=Date.parse(readback.completedAt),completionAt=Date.parse(completion.at),reservedAt=Date.parse(reservation.at);
  if(readback.version!==1||readback.target!==reservation.target||readback.atomicReadback!==true
      ||readback.remoteRowsWritten!==0||readback.providerCalls!==0||readback.decision?.outcome!=='committed'
      ||readback.decision.verified!==true||readback.decision.checkpoint_committed!==true
      ||readback.decision.all_rows_match_incoming!==true||readback.decision.all_tasks_match_incoming!==true
      ||!integer(readback.decision.expected_rows)||readback.decision.expected_rows>100||readback.decision.verified_rows!==readback.decision.expected_rows
      ||![completedAt,completionAt,reservedAt,now].every(Number.isFinite)||completedAt<completionAt
      ||completionAt<reservedAt||completedAt>now+5000)invalid();
  return validateEstimateReview(reservation,completion,{proofSha256:options.proofSha256,readbackSha256:proof.readback.sha256,
    operatorReviewed:true,outcome:'committed',atomicReadback:true,verified:true,
    reservation:proof.reservation,actual:proof.actual,reviewedEstimate:proof.reviewedEstimate,limits:proof.limits},paidContext);
}
function openWriteBudget({directory, readUsage, estimate, now=Date.now, limits, paidBootstrapProof}) {
  const paidContext=paidBootstrapProof===undefined?null:paidBootstrap.validatePaidBootstrapProof(paidBootstrapProof,{directory,now:now(),limits});
  const policy=validatedLimits(limits,paidContext);
  if (!path.isAbsolute(directory || '') || typeof readUsage !== 'function' || typeof estimate !== 'function') stop('D1_BUDGET_CONFIGURATION_REQUIRED');
  fs.mkdirSync(directory,{recursive:true});
  const lock=path.join(directory,'account.lock'), file=path.join(directory,'ledger.ndjson');
  let fd;try {fd=fs.openSync(lock,'wx');} catch {stop('D1_BUDGET_OPERATOR_LOCKED');}
  let closed=false, usage=null, halted=false, uncertainAppend=false;
  let estimateHalt=null,otherHalt=false,latestCompletion=null;
  const reviewedEstimates=new Map();
  // Rebuilt once from the authoritative journal. Runtime checks and accounting
  // depend only on these indexes, never on repeated scans of the event history.
  const pending=new Map(), reservedIds=new Set(), baselines=new Map(), daily=new Map();
  function prepareEvent(event) {
    if(!event||typeof event!=='object'||Array.isArray(event)
        || !['baseline','reserve','complete','read','halt','estimate_review'].includes(event.kind)
        || typeof event.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(event.day))stop('D1_BUDGET_LEDGER_INVALID');
    if(event.kind==='halt')return ()=>{
      halted=true;
      if(event.reason==='estimate_exceeded'&&estimateHalt&&!estimateHalt.explicit&&event.day===estimateHalt.reservation.day)
        estimateHalt.explicit=true;
      else otherHalt=true;
    };
    if(event.kind==='estimate_review') {
      if(!halted||otherHalt||!estimateHalt?.explicit||pending.size||latestCompletion?.id!==estimateHalt.reservation.id
          ||event.id!==estimateHalt.reservation.id||event.day!==estimateHalt.reservation.day
          ||event.reason!=='estimate_exceeded_acknowledged'||event.writes!==0||event.reads!==0
          ||!Number.isFinite(Date.parse(event.at))||Date.parse(event.at)<Date.parse(estimateHalt.completion.at)
          ||event.proofSha256!==event.review?.proofSha256)stop('D1_BUDGET_ESTIMATE_REVIEW_INVALID');
      const evidence=validateEstimateReview(estimateHalt.reservation,estimateHalt.completion,event.review,paidContext);
      const previous=reviewedEstimates.get(estimateHalt.reservation.target);
      if(previous&&['writes','reads'].some(key=>evidence.reviewedEstimate[key]<previous[key]))stop('D1_BUDGET_ESTIMATE_REVIEW_INVALID');
      const target=estimateHalt.reservation.target,cost=Object.freeze({...evidence.reviewedEstimate});
      return ()=>{reviewedEstimates.set(target,cost);estimateHalt=null;halted=false;};
    }
    if(!integer(event.writes)||!integer(event.reads))stop('D1_BUDGET_LEDGER_INVALID');
    if(event.kind==='baseline') {
      if(baselines.has(event.day))stop('D1_BUDGET_LEDGER_INVALID');
      return ()=>{baselines.set(event.day,{writes:event.writes,reads:event.reads});};
    }
    if(event.kind==='reserve') {
      if(event.paidBootstrapPolicySha256!==undefined&&(!paidContext||!hex(event.paidBootstrapPolicySha256)||event.paidBootstrapPolicySha256!==paidContext.pinSha256))stop('D1_BUDGET_LEDGER_INVALID');
      if(typeof event.id!=='string'||!event.id||reservedIds.has(event.id)||event.writes<1)stop('D1_BUDGET_LEDGER_INVALID');
      const reservation=Object.freeze({...event});
      return ()=>{reservedIds.add(event.id);pending.set(event.id,reservation);};
    }
    const reservation=event.kind==='complete'?pending.get(event.id):null;
    if(event.kind==='complete'&&(!reservation||reservation.day!==event.day))stop('D1_BUDGET_LEDGER_INVALID');
    if(event.metering!==undefined) {
      if(!reservation||event.metering!=='conservative_reservation'||!['verified_not_committed','verified_committed'].includes(event.reason)
          ||event.writes!==reservation.writes||event.reads!==reservation.reads)stop('D1_BUDGET_LEDGER_INVALID');
      const proof=event.reason==='verified_committed'?committedReconciliationProof(reservation,event.reconciliation):reconciliationProof(reservation,event.reconciliation);
      if(event.proofSha256!==proof.proofSha256)stop('D1_BUDGET_LEDGER_INVALID');
    }
    if(event.kind==='read'&&event.writes!==0)stop('D1_BUDGET_LEDGER_INVALID');
    const previous=daily.get(event.day)||{writes:0,reads:0};
    const next={writes:previous.writes+event.writes,reads:previous.reads+event.reads};
    if(!integer(next.writes)||!integer(next.reads))stop('D1_BUDGET_LEDGER_INVALID');
    return ()=>{
      daily.set(event.day,next);
      if(reservation) {
        pending.delete(event.id);
        latestCompletion={id:event.id};
        // A process may have died between an over-estimate completion and the
        // following halt record. Rebuild must still retain that stop condition.
        if(event.writes>reservation.writes||event.reads>reservation.reads){
          halted=true;
          if(estimateHalt)otherHalt=true;
          estimateHalt={reservation,completion:{...event},explicit:false};
        }
      }
    };
  }
  const append = event => {
    const commit=prepareEvent(event);
    try {
      const handle=fs.openSync(file,'a');
      try{fs.writeFileSync(handle,JSON.stringify(event)+'\n');fs.fsyncSync(handle);}
      finally{fs.closeSync(handle);}
    } catch(error) {uncertainAppend=true;throw error;}
    // Memory advances only after the journal write has been flushed. If an I/O
    // failure leaves its outcome unknown, this process cannot reserve again.
    commit();
  };
  const close = () => {if(!closed){closed=true;fs.closeSync(fd);fs.unlinkSync(lock);}};
  try {
    paidBootstrap.pinPaidBootstrap(directory,paidContext);
    const text=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
    if(text&&!text.endsWith('\n'))stop('D1_BUDGET_LEDGER_INVALID');
    for(const line of text.split('\n'))if(line)prepareEvent(JSON.parse(line))();
  } catch(error) {close();if(/^D1_PAID_BOOTSTRAP_/.test(error.message))throw error;stop('D1_BUDGET_LEDGER_INVALID');}
  function healthy() {
    if(closed)stop('D1_BUDGET_CLOSED');
    if(halted||uncertainAppend||pending.size)stop('D1_BUDGET_RECONCILIATION_REQUIRED');
  }
  async function beforeWrite(statements,target) {
    healthy();
    if(paidContext&&(target!==paidContext.pin.target||now()>=Date.parse(paidContext.expiresAt)))stop('D1_PAID_BOOTSTRAP_SCOPE_STOP');
    let time=now();
    const day=new Date(time).toISOString().slice(0,10);
    // STOP rather than silently resetting a running operation at UTC midnight.
    if(usage&&usage.day!==day)stop('D1_BUDGET_DAY_CHANGED');
    if(!usage||time-Date.parse(usage.at)>60000)usage=await readUsage();
    // Analytics can take several seconds. Compare its response timestamp with
    // the clock after awaiting it, not the earlier request-start timestamp.
    time=now();
    if(paidContext&&time>=Date.parse(paidContext.expiresAt))stop('D1_PAID_BOOTSTRAP_SCOPE_STOP');
    if(new Date(time).toISOString().slice(0,10)!==day)stop('D1_BUDGET_DAY_CHANGED');
    healthy(); // A concurrent caller may have reserved while analytics was awaited.
    if(usage?.account!==ACCOUNT||usage.day!==day||!integer(usage.rowsRead)||!integer(usage.rowsWritten)
      || !Number.isFinite(Date.parse(usage.at)) || time-Date.parse(usage.at)>60000 || Date.parse(usage.at)>time+5000)stop('D1_BUDGET_FRESH_ACCOUNT_USAGE_REQUIRED');
    const cost=estimate(statements,target);
    if(!integer(cost?.writes)||!integer(cost?.reads)||cost.writes<1||cost.writes>policy.maxBatchWrites)stop('D1_BUDGET_ESTIMATE_REQUIRED');
    if(paidContext){
      const own=[...daily.values()].reduce((total,row)=>({writes:total.writes+row.writes,reads:total.reads+row.reads}),{writes:0,reads:0});
      if(own.writes+cost.writes>paidContext.pin.job.maxWrites||own.reads+cost.reads>paidContext.pin.job.maxReads)stop('D1_PAID_BOOTSTRAP_JOB_STOP');
    }
    const reviewed=reviewedEstimates.get(target);
    if(reviewed&&['writes','reads'].some(key=>cost[key]<reviewed[key]))stop('D1_BUDGET_REVIEWED_ESTIMATE_REQUIRED');
    // Keep the first account baseline + every locally metered operation. Refresh
    // analytics too, taking the higher value. The reserve covers concurrent use
    // and reporting delay; no operator can guarantee a global Cloudflare hard cap.
    let baseline=baselines.get(day);
    if(!baseline){baseline={kind:'baseline',day,writes:usage.rowsWritten,reads:usage.rowsRead};append(baseline);}
    const own=daily.get(day)||{writes:0,reads:0};
    if(Math.max(usage.rowsWritten,baseline.writes+own.writes)+cost.writes>policy.writes-policy.writeReserve)stop('D1_WRITE_BUDGET_STOP');
    if(Math.max(usage.rowsRead,baseline.reads+own.reads)+cost.reads>policy.reads-policy.readReserve)stop('D1_READ_BUDGET_STOP');
    const ticket={kind:'reserve',id:randomUUID(),day,at:new Date(time).toISOString(),target,hash:sha(statements.map(x=>({sql:x.sql,params:x.params||[]}))),...cost,limits:policy,...(paidContext?{paidBootstrapPolicySha256:paidContext.pinSha256}:{})};
    append(ticket);return Object.freeze(ticket);
  }
  function complete(ticket,results) {
    if(closed)stop('D1_BUDGET_CLOSED');
    const reservation=ticket&&pending.get(ticket.id);
    if(!reservation||ticket.day!==reservation.day||ticket.writes!==reservation.writes
        ||ticket.reads!==reservation.reads)stop('D1_BUDGET_TICKET_INVALID');
    const actual=totals(results);append({kind:'complete',id:ticket.id,day:ticket.day,at:new Date(now()).toISOString(),...actual});
    if(actual.writes>reservation.writes||actual.reads>reservation.reads){append({kind:'halt',day:ticket.day,reason:'estimate_exceeded'});stop('D1_BUDGET_ESTIMATE_EXCEEDED');}
  }
  function recordRead(results) {
    if(closed)stop('D1_BUDGET_CLOSED');
    const actual=totals(results);if(actual.writes!==0)stop('D1_READ_ONLY_WRITE_DETECTED');
    append({kind:'read',day:new Date(now()).toISOString().slice(0,10),...actual});
  }
  // Explicit operator action only. The caller must independently verify the
  // evidence artifact, its SHA-256, the atomic checkpoint and every baseline
  // row. This API validates the attestation fields and their reservation binding;
  // it does not read that artifact or infer an outcome from an absent response.
  function reconcileUnknown(ticketId,proof) {
    if(closed)stop('D1_BUDGET_CLOSED');
    if(halted||uncertainAppend)stop('D1_BUDGET_RECONCILIATION_REQUIRED');
    const reservation=pending.get(ticketId);
    if(!reservation)stop('D1_BUDGET_TICKET_INVALID');
    const evidence=reconciliationProof(reservation,proof);
    const event={kind:'complete',id:reservation.id,day:reservation.day,at:new Date(now()).toISOString(),
      writes:reservation.writes,reads:reservation.reads,metering:'conservative_reservation',
      reason:'verified_not_committed',proofSha256:evidence.proofSha256,reconciliation:evidence};
    // Charge the full original estimate even when readback proves no mutation.
    // There is no budget refund and a second reconciliation cannot reuse the ID.
    append(event);
    return {id:event.id,day:event.day,writes:event.writes,reads:event.reads,
      metering:event.metering,proofSha256:event.proofSha256,outcome:evidence.outcome};
  }
  // A verified COMMIT must never be replayed. Read and hash the saved readback
  // artifact and original request; keep full estimated usage, not invented D1
  // telemetry. Only the local budget journal changes here; no network access.
  function reconcileCommitted(ticketId,options) {
    if(closed)stop('D1_BUDGET_CLOSED');
    if(halted||uncertainAppend)stop('D1_BUDGET_RECONCILIATION_REQUIRED');
    const reservation=pending.get(ticketId);if(!reservation)stop('D1_BUDGET_TICKET_INVALID');
    const evidence=verifiedCommittedArtifact(reservation,options,now());
    const event={kind:'complete',id:reservation.id,day:reservation.day,at:new Date(now()).toISOString(),
      writes:reservation.writes,reads:reservation.reads,metering:'conservative_reservation',reason:'verified_committed',
      proofSha256:evidence.proofSha256,reconciliation:evidence};
    append(event);
    return {id:event.id,day:event.day,writes:event.writes,reads:event.reads,metering:event.metering,proofSha256:event.proofSha256,outcome:'committed'};
  }
  // Explicit operator review of a KNOWN, actually metered completion only.
  // The immutable readback proof is inspected locally; no usage is refunded,
  // no limits change, and no unknown reservation can be cleared by this path.
  function acknowledgeEstimateHalt(ticketId,options) {
    if(closed)stop('D1_BUDGET_CLOSED');
    if(uncertainAppend||pending.size||!halted||otherHalt||!estimateHalt?.explicit
        ||latestCompletion?.id!==estimateHalt.reservation.id)stop('D1_BUDGET_ESTIMATE_REVIEW_NOT_ALLOWED');
    const {reservation,completion}=estimateHalt;
    if(ticketId!==reservation.id)stop('D1_BUDGET_TICKET_INVALID');
    if(!reservation.limits||Object.keys(policy).some(key=>policy[key]!==reservation.limits[key]))stop('D1_BUDGET_ESTIMATE_REVIEW_POLICY_MISMATCH');
    const review=verifiedEstimateReview(reservation,completion,options,now(),paidContext);
    const event={kind:'estimate_review',id:reservation.id,day:reservation.day,at:new Date(now()).toISOString(),
      writes:0,reads:0,reason:'estimate_exceeded_acknowledged',proofSha256:review.proofSha256,review};
    append(event);
    return {id:reservation.id,day:reservation.day,target:reservation.target,actual:{writes:completion.writes,reads:completion.reads},
      reviewedEstimate:{...review.reviewedEstimate},proofSha256:review.proofSha256,readbackSha256:review.readbackSha256,acknowledged:true};
  }
  return {beforeWrite,complete,recordRead,reconcileUnknown,reconcileCommitted,acknowledgeEstimateHalt,close,limits:policy};
}
module.exports={openWriteBudget,totals,LIMITS,validatedLimits};
