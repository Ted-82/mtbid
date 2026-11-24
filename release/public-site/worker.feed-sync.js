import pipeline from './sync/feed-server-runner.cjs';
import dispatcher from './sync/feed-dispatch.cjs';
import captureJournal from './sync/feed-capture-journal.cjs';
export default {
 async fetch(){return new Response('Not found',{status:404});},
 async scheduled(controller,env){
  if(controller.cron!=='*/5 * * * *'||!pipeline.configuration(env).enabled)return;
  let capture;
  try{
   const result=await captureJournal.captureLatest({bucket:env.REXBID_FEED_ARCHIVE,url:env.REXBID_FEED_URL,feedId:Number(env.REXBID_FEED_ID)});
   capture={component:'server-feed-capture',captured:result.captured,reused:result.reused,
    ...(result.generationId?{generationId:result.generationId,bytes:result.bytes}:{}),...(result.reason?{reason:result.reason}:{})};
  }catch(error){capture={component:'server-feed-capture',captured:false,reused:false,reason:captureJournal.safeCaptureCode(error)};}
  console.log(JSON.stringify(capture));
  await env.REXBID_FEED_QUEUE.send({version:1,kind:'poll'});
  return capture;
 },
 async queue(batch,env){
  for(const message of batch.messages){
   const result=await dispatcher.dispatchMessage({env,body:message.body});
   console.log(JSON.stringify({component:'server-feed',...result}));
   if(result.retry)message.retry({delaySeconds:Math.min(3600,result.retryAfter||60)});else message.ack();
  }
 }
};
