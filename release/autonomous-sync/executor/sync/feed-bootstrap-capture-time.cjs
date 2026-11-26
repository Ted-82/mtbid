'use strict';

// Shared by the public Worker and private operators. No Node dependencies.
// A provider's pre-start bound is deliberately distinct from an exact clock
// reading; it is usable only with an exact snapshot/checkpoint attestation.
const BOUND_BASIS='provider-before-start-bound';
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const time=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
function captureTime(plan){
 const c=plan?.capture,s=plan?.snapshot,e=plan?.sourceEvidence;
 const fail=()=>{throw Error('FEED_CAPTURE_TIME_INVALID');};
 if(!integer(c?.sequence)||!sha(c?.responseSha256)||!time(s?.requestStartedAt))fail();
 if(c.timeBasis===undefined){
  if(!time(c.capturedAt)||c.capturedAt>s.requestStartedAt||c.capturedNoLaterThan!==undefined)fail();
  return {capture:{sequence:c.sequence,capturedAt:c.capturedAt,responseSha256:c.responseSha256},cutoff:c.capturedAt,bound:false};
 }
 if(c.timeBasis!==BOUND_BASIS||c.capturedAt!==null||!time(c.capturedNoLaterThan)
  ||c.capturedNoLaterThan!==s.requestStartedAt||s.generatedAtKnown!==true||!time(s.generatedAt)||s.generatedAt<s.requestStartedAt
  ||e?.kind!=='provider-checkpoint'||!sha(e.sha256)||e.replayStartSequence!==c.sequence
  ||!sha(s.sha256)||e.snapshotSha256!==s.sha256)fail();
 return {capture:{sequence:c.sequence,capturedAt:null,capturedNoLaterThan:c.capturedNoLaterThan,timeBasis:BOUND_BASIS,responseSha256:c.responseSha256},
  cutoff:c.capturedNoLaterThan,bound:true};
}
const canonicalCaptureTime=plan=>captureTime(plan).capture;
const captureChronologyCutoff=plan=>captureTime(plan).cutoff;
const isProviderCaptureBound=plan=>captureTime(plan).bound;
module.exports={BOUND_BASIS,canonicalCaptureTime,captureChronologyCutoff,isProviderCaptureBound};
