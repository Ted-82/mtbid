'use strict';
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function persist(file,value){const temp=file+'.next';const fd=fs.openSync(temp,'w');try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}
function readbackStatement(item){
 let sql,params;
 if(item.table==='provider_sync_scopes'){sql='SELECT scope_key FROM provider_sync_scopes WHERE scope_key=?';params=[item.params[0]];}
 else if(item.table==='vehicle_sources'&&!item.columns){sql='SELECT source_key FROM vehicle_sources WHERE source_key=?';params=[item.params[3]];}
 else if(item.table==='auction_listing_snapshots'){sql='SELECT listing_id FROM auction_listing_snapshots WHERE listing_id=? AND observed_at=? AND fingerprint=?';params=['listing_id','observed_at','fingerprint'].map(c=>item.params[item.columns.indexOf(c)]);}
 else {const key={vehicle_sources:'source_key',auction_listings:'listing_id',auction_events:'event_id'}[item.table];if(!key)throw Error('PUBLICATION_READBACK_TABLE');sql=`SELECT ${key} FROM ${item.table} WHERE ${key}=?`;params=[item.params[item.columns.indexOf(key)]];}
 return {sql,params};
}
async function applyPublicationData({db,plan,checkpointFile,onProgress=()=>{}}){
 if(db.identity?.id!=='c8a30088-70af-43a6-9a7f-c4018279d37d'||db.identity?.name!=='rexbid-production-preflight-db')throw Error('PUBLICATION_APPLY_TARGET');
 // Plan hash excludes rehearsal annotations; individual SQL hash is rechecked.
 if(plan.groups.some(x=>sha(x.statements)!==x.sha256||x.changes?.length!==x.statements.length))throw Error('PUBLICATION_PLAN_CHANGED');
 const identity=sha(plan.groups.map(x=>({statements:x.statements,sha256:x.sha256})));
 if(identity!==plan.manifest.plan_sha256)throw Error('PUBLICATION_PLAN_CHANGED');
 const state=fs.existsSync(checkpointFile)?JSON.parse(fs.readFileSync(checkpointFile,'utf8')):{plan:identity,completed:0,inflight:null};
 if(state.plan!==identity||state.inflight!==null)throw Error('PUBLICATION_READBACK_RECONCILIATION_REQUIRED');
 for(let i=state.completed;i<plan.groups.length;i++){
  const group=plan.groups[i];state.inflight=i;persist(checkpointFile,state);
  let results;
  try{results=await db.batch(group.statements.map(x=>db.prepare(x.sql).bind(...x.params)));}
  catch(error){
   if(['D1_WRITE_BUDGET_STOP','D1_READ_BUDGET_STOP','D1_BUDGET_FRESH_ACCOUNT_USAGE_REQUIRED','D1_BUDGET_DAY_CHANGED'].includes(error.message)){state.inflight=null;state.stop=error.message;persist(checkpointFile,state);return state;}
   throw error;
  }
  if(results.length!==group.changes.length||results.some((x,n)=>x.meta?.changes!==group.changes[n]))throw Error('PUBLICATION_D1_CHANGES_MISMATCH');
  const check=readbackStatement(group.statements.at(-1));
  if(!await db.prepare(check.sql).bind(...check.params).first())throw Error('PUBLICATION_BATCH_READBACK_FAILED');
  state.completed=i+1;state.inflight=null;state.stop=null;persist(checkpointFile,state);onProgress({completed:state.completed,total:plan.groups.length});
 }
 return state;
}
module.exports={applyPublicationData,readbackStatement};
