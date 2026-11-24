'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {dispatchMessage}=require('../sync/feed-dispatch.cjs');
const body={version:1,jobKey:'feed:5331:apply:5:0'};
test('private executor dispatch awaits completion and preserves durable retry decisions',async()=>{
 for(const result of [{ok:true,bucketIndex:6},{ok:false,retry:false,errorCode:'SERVER_FEED_DAILY_BUDGET_STOP'},
  {ok:false,retry:true,retryAfter:60},{retry:true,reason:'lease_busy'},{ignored:true},{deferred:true}]){
  let completed=false;
  const env={REXBID_FEED_EXECUTION_MODE:'service',REXBID_FEED_EXECUTOR:{async fetch(request){
   assert.equal(request.url,'https://feed-sync.internal/consume');assert.equal(request.method,'POST');assert.deepEqual(await request.json(),body);
   await new Promise(resolve=>setTimeout(resolve,1));completed=true;return Response.json(result);
  }}};
  assert.deepEqual(await dispatchMessage({env,body}),result);assert.equal(completed,true);
 }
});
test('missing binding, unsuccessful HTTP and malformed executor result fail rather than acknowledge',async()=>{
 await assert.rejects(dispatchMessage({env:{REXBID_FEED_EXECUTION_MODE:'service'},body}),/EXECUTOR_MISSING/);
 for(const response of [new Response('bad',{status:500}),new Response('bad'),Response.json(null),Response.json({}),new Response('x'.repeat(16385))]){
  await assert.rejects(dispatchMessage({env:{REXBID_FEED_EXECUTION_MODE:'service',REXBID_FEED_EXECUTOR:{fetch:async()=>response}},body}),/EXECUTOR_(FAILED|RESPONSE)/);
 }
});
test('disabled inline execution retains the safe deployment state',async()=>{
 assert.deepEqual(await dispatchMessage({env:{REXBID_FEED_ENABLED:'disabled'},body}),{disabled:true});
});
