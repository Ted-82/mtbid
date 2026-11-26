'use strict';
const {reviewRetainedRelists}=require('./feed-relist-review.cjs');
const {relistWorkFits,relistRequestCapacity,alreadyAtRelistReserve}=require('./feed-relist-budget.cjs');
const {repairSparseCatalog}=require('./feed-sparse-repair.cjs');
const {countedFeedRequest}=require('./feed-api-request.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
async function maintainRelists({env,state,body,workPhase,result,control,usage,reservation,store,db,now,fetchImpl,loadManifest,safeCode,buildRequest=countedFeedRequest}){
  const canVerifyRelists=()=>state.accountBudget && state.activation?.receipt?.kind==='feed-projected-catalog-activation' &&
    env.REXBID_FEED_OPEN_COVERAGE==='enabled' && relistWorkFits({window:reservation.window,storageBytes:control.databaseSizeBytes,
      storageLimit:state.accountBudget.databaseMaxBytes,usage,remainingStatements:control.limit-usage.statements});
  const idlePoll=body.kind==='poll' && result.capturedPending===0;
  const finishedWithoutNext=workPhase==='finish'&&result.complete&&result.nextCapture?.capturedPending===0;
  if((idlePoll||finishedWithoutNext)&&canVerifyRelists()){
   let call,available,used=0;
   const results=[],started=now();
   const getRequest=async()=>{
    if(!call){
     const requestEnv=Object.create(env);
     Object.defineProperty(requestEnv,'REXBID_FEED_ADAPTIVE_QUOTA',{value:'enabled',enumerable:true});
     call=await buildRequest({env:requestEnv,db,store,now,fetchImpl});
     available=relistRequestCapacity({quota:await store.state(),budgets:await store.budgets(),now:now()});
    }
    return async spec=>{if(used>=available)throw Error('RELIST_REQUEST_RESERVE');used++;return call(spec);};
   };
   try{if(!(await alreadyAtRelistReserve(db,now())&&!(await store.state())?.quota_allowance))
    result.relistPage=await require('./feed-relist-pages.cjs').warmRelistPage({db,store,getRequest,now});}
   catch(error){result.relistPage={error:safeCode(error)};}
   if(result.relistPage?.matchedKeys?.length&&canVerifyRelists()){
    try{
     const batch=await require('./feed-relist-batch.cjs').restoreCachedBatch({db,store,keys:result.relistPage.matchedKeys,now});
     results.push(...batch);
    }catch(error){results.push({error:safeCode(error)});}
   }
   for(let i=0;i<8&&!results.some(r=>r.error)&&canVerifyRelists()&&now()-started<20000&&(available===undefined||used<available);i++){
    try{
     if(i===0&&await alreadyAtRelistReserve(db,now())&&!(await store.state())?.quota_allowance){
      result.relistVerification={work:0,requests:0,reason:'request_reserve'};
      break;
     }
     const repair=await repairSparseCatalog({db,store,adapter:createApibaraProvider(),getRequest,now,relistOnly:true,
      preferredTaskKey:result.relistPage?.matchedKeys?.shift()});
     if(!repair)break;
     if(repair.deferred&&repair.error==='RELIST_REQUEST_RESERVE'){
      results.push({deferred:true,reason:'invocation_capacity'});break;
     }
     results.push(repair);if(repair.error)break;
    }catch(error){results.push({error:safeCode(error)});break;}
   }
   if(results.length){
    result.relistVerification={work:results.length,requests:used,results};
    // Continue paid, successful work on the existing durable queue. Stop on
    // errors or exhausted capacity; the scheduled poll remains the fallback.
    if((used>0||results.some(r=>r.relisted||r.inserted))&&!results.some(r=>r.error)&&env.REXBID_FEED_QUEUE?.send){
     const room=relistRequestCapacity({quota:await store.state(),budgets:await store.budgets(),now:now()});
     if(room>0){
      await env.REXBID_FEED_QUEUE.send({version:1,kind:'poll'},{delaySeconds:10});
      result.relistVerification.continuation=true;
     }
    }
   }
  }
  if(env.REXBID_FEED_RELIST_REVIEW_GENERATION && (idlePoll||finishedWithoutNext) && canVerifyRelists()){
   const pages=[],started=now();
   for(let i=0;i<3&&canVerifyRelists()&&now()-started<3500;i++){
    try{const review=await reviewRetainedRelists({db,store,bucket:env.REXBID_FEED_ARCHIVE,loadManifest,now,
     generationId:Number(env.REXBID_FEED_RELIST_REVIEW_GENERATION),throughGeneration:Number(env.REXBID_FEED_RELIST_REVIEW_THROUGH??env.REXBID_FEED_RELIST_REVIEW_GENERATION),
     startBucket:Number(env.REXBID_FEED_RELIST_REVIEW_START_BUCKET??0)});
     if(!review)break;pages.push(review);if(review.done||review.available===false)break;
    }catch(error){pages.push({error:safeCode(error)});break;}
   }
   if(pages.length)result.relistReview={pages};
  }
}
module.exports={maintainRelists};
