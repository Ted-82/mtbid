'use strict';

// Only cleanup of THIS request's lease is retried. Canonical transactions,
// accounting and source requests must never be retried through this helper.
const {summarizeFailure}=require('./feed-executor-diagnostics.cjs');
const RELEASE_SQL='UPDATE automatic_refresh_state SET lease_owner=NULL,lease_until=NULL WHERE singleton=1 AND lease_owner=?';
const DELAYS=Object.freeze([1000,4000]);
async function releaseOwnedLease({db,owner,sleepImpl=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!db?.prepare||typeof owner!=='string'||!owner||typeof sleepImpl!=='function')throw Error('SERVER_FEED_LEASE_CLEANUP_INVALID');
 let lastCategory=null;
 for(let attempt=0;attempt<=DELAYS.length;attempt++){
  try{
   // A lost acknowledgement may mean the first UPDATE succeeded. This exact
   // owner predicate makes a second UPDATE harmless to any newer lease owner.
   await db.prepare(RELEASE_SQL).bind(owner).run();
   return{completed:true,attempts:attempt+1,retried:attempt>0,hadFailure:lastCategory!==null};
  }catch(error){
   lastCategory=summarizeFailure(error).category;
   if(lastCategory!=='D1_RESOURCE_OVERLOAD'||attempt===DELAYS.length)
    return{completed:false,attempts:attempt+1,retried:attempt>0,category:lastCategory,expiryFallback:true};
   await sleepImpl(DELAYS[attempt]);
  }
 }
}
module.exports={releaseOwnedLease,RELEASE_SQL,DELAYS};
