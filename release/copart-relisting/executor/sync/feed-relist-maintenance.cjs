'use strict';
const {reviewRetainedRelists}=require('./feed-relist-review.cjs');
const {relistWorkFits,relistRequestCapacity}=require('./feed-relist-budget.cjs');
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
     call=await buildRequest({env,db,store,now,fetchImpl});
     available=relistRequestCapacity({quota:await store.state(),budgets:await store.budgets(),now:now()});
    }
    return async spec=>{if(used>=available)throw Error('RELIST_REQUEST_RESERVE');used++;return call(spec);};
   };
   for(let i=0;i<8&&canVerifyRelists()&&now()-started<5000&&(available===undefined||used<available);i++){
    try{
     const repair=await repairSparseCatalog({db,store,adapter:createApibaraProvider(),getRequest,now,relistOnly:true});
     if(!repair)break;results.push(repair);if(repair.error)break;
    }catch(error){results.push({error:safeCode(error)});break;}
   }
   if(results.length)result.relistVerification={work:results.length,requests:used,results};
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
