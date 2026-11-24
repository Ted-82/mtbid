'use strict';
// Public Worker compatible: deliberately no Node imports or mutation methods.
const {captureChronologyCutoff}=require('./feed-bootstrap-capture-time.cjs');
const contexts=new WeakMap();
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const key=s=>typeof s==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(s);
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const time=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const fail=()=>{throw Error('CATALOG_MEMBERSHIP_UNAVAILABLE');};
function publicPath(path){return path==='/api/cars'||path==='/api/filters'||/^\/api\/car\/[^/]+(?:\/history)?$/.test(path);}
async function hash(text){return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
class CatalogMembershipRead{
 constructor(db,{scope=null}={}){if(!db?.prepare)fail();this.db=db;this.scope=scope;this.promise=null;}
 view(){if(!this.promise)this.promise=this.load();return this.promise;}
 async retryFailedView(){
  const previous=this.promise;
  try{return await this.view();}catch{
   if(this.promise===previous)this.promise=null;
   return this.view();
  }
 }
 async load(){
  const row=await this.db.prepare(`SELECT p.baseline_id,p.revision,b.plan_sha256,b.plan_json,b.checkpoint_json,b.updated_at
   FROM feed_catalog_pointer p LEFT JOIN feed_catalog_baselines b ON b.baseline_id=p.baseline_id WHERE p.singleton=1`).bind().first();
  if(!row||!integer(row.revision)||row.baseline_id!==null&&!key(row.baseline_id))fail();
  if(row.baseline_id===null)return {active:false,baselineId:null,revision:row.revision,token:'membership-null-'+row.revision};
  let plan,state;try{plan=JSON.parse(row.plan_json);state=JSON.parse(row.checkpoint_json);}catch{fail();}
  let captureCutoff;try{captureCutoff=captureChronologyCutoff(plan);}catch{fail();}
  if(!sha(row.plan_sha256)||await hash(row.plan_json)!==row.plan_sha256||plan?.version!==1||plan.baselineId!==row.baseline_id
   ||!['production','staging'].includes(plan.scope)||this.scope&&plan.scope!==this.scope
   ||!integer(plan.snapshot?.records)||plan.snapshot.records<1||!sha(plan.snapshot?.sha256)
   ||!integer(plan.capture?.sequence)||!sha(plan.capture?.responseSha256)
   ||!time(plan.snapshot?.requestStartedAt)||captureCutoff>plan.snapshot.requestStartedAt
   ||typeof plan.snapshot?.generatedAtKnown!=='boolean'||(plan.snapshot.generatedAtKnown?!time(plan.snapshot.generatedAt):plan.snapshot.generatedAt!==null)
   ||state?.version!==1||!['replaying','ready'].includes(state.status)||state.offset!==plan.snapshot.records
   ||!['resolved','excluded','unresolved','deltaUnresolved','reviewedUnresolved','replaySequence'].every(k=>integer(state[k]))
   ||state.resolved+state.excluded+state.unresolved!==state.offset||state.replaySequence<plan.capture.sequence
   ||typeof state.replayVerified!=='boolean'||!time(row.updated_at))fail();
  const e=plan.sourceEvidence,total=state.excluded+state.unresolved+state.deltaUnresolved;
  const sourceReady=sha(e?.sha256)&&(e.kind==='fresh-generation'
   ?plan.snapshot.generatedAtKnown&&plan.snapshot.generatedAt>=captureCutoff
   :e.kind==='provider-checkpoint'&&e.replayStartSequence===plan.capture.sequence&&e.snapshotSha256===plan.snapshot.sha256);
  if(!sourceReady||!integer(total)||state.reviewedUnresolved>total||state.reviewedUnresolved>0&&!sha(state.reviewSha256))fail();
  const reviewed=state.reviewedUnresolved===total;
  if(state.status==='ready'&&(!reviewed||!state.replayVerified||state.pendingDelta!=null))fail();
  if(state.pendingDelta!=null&&(!integer(state.pendingDelta.after)||state.pendingDelta.after!==state.replaySequence||!integer(state.pendingDelta.through)||state.pendingDelta.through<=state.pendingDelta.after||typeof state.pendingDelta.resumeReady!=='boolean'||state.replayVerified||state.status!=='replaying'))fail();
  const complete=reviewed&&state.replayVerified&&state.pendingDelta==null&&state.status==='ready';
  const catalog={kind:'verified_baseline',baseline_id:row.baseline_id,pointer_revision:row.revision,
   snapshot_records:plan.snapshot.records,replay_sequence:state.replaySequence,
   replay_status:state.pendingDelta!=null||!state.replayVerified?'in_progress':'verified',
   unresolved_records:total,reviewed_unresolved_records:state.reviewedUnresolved,
   coverage_status:!reviewed?'quarantine_review':complete?'verified':'replaying',
   verified_at:complete?row.updated_at:null,snapshot_generated_at:plan.snapshot.generatedAtKnown?plan.snapshot.generatedAt:null};
  return {active:true,baselineId:row.baseline_id,revision:row.revision,token:'membership-'+row.revision+'-'+row.plan_sha256,complete,catalog};
 }
 async namespace(base){const view=await this.view();return base+':'+view.token;}
 async coverage(platform=null){
  const view=await this.view();if(!view.active)return null;
  const supported=platform===null||['copart','iaai'].includes(platform);
  return {complete:view.complete&&supported,partial:!view.complete||!supported,catalog:view.catalog,
   platforms:(platform?[platform]:['copart','iaai']).map(name=>({platform:name,scope_count:['copart','iaai'].includes(name)?1:0,complete:view.complete&&['copart','iaai'].includes(name),
    status:!['copart','iaai'].includes(name)?'not_in_baseline':view.complete?'verified':view.catalog.coverage_status,next_page_available:false,last_complete_at:view.catalog.verified_at}))};
 }
 async listingScope(listingId,auctionState){
  const view=await this.view();if(!view.active)return null;
  if(!['open','live'].includes(auctionState))return 'archival';
  const row=await this.db.prepare('SELECT active FROM feed_catalog_membership WHERE baseline_id=? AND listing_id=?').bind(view.baselineId,listingId).first();
  if(row&&![0,1].includes(row.active))fail();return row?.active===1?'active':'archival';
 }
}
function getCatalogMembershipRead(request,env){
 if(env?.REXBID_CATALOG_MEMBERSHIP_ENABLED!=='enabled'||request.method!=='GET'||!publicPath(new URL(request.url).pathname))return null;
 const scope=new URL(request.url).hostname==='rexbid-auth-test.tedn828.workers.dev'?'staging':'production';
 let context=contexts.get(request);if(context){if(context.db!==env.REXBID_DB||context.scope!==scope)fail();return context;}
 context=new CatalogMembershipRead(env.REXBID_DB,{scope});contexts.set(request,context);return context;
}
async function catalogMembershipNamespace(request,env,base){const context=getCatalogMembershipRead(request,env);return context?context.namespace(base):base;}
module.exports={CatalogMembershipRead,getCatalogMembershipRead,catalogMembershipNamespace};
