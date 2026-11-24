'use strict';
const {runMessage}=require('./feed-server-runner.cjs');
// Service bindings are internal. No public route or network URL is exposed.
async function dispatchMessage({env,body}={}){
 if(env.REXBID_FEED_EXECUTION_MODE!=='service')return runMessage({env,body});
 if(!env.REXBID_FEED_EXECUTOR?.fetch)throw Error('SERVER_FEED_EXECUTOR_MISSING');
 const response=await env.REXBID_FEED_EXECUTOR.fetch(new Request('https://feed-sync.internal/consume',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 if(!response.ok)throw Error('SERVER_FEED_EXECUTOR_FAILED');
 const text=await response.text();if(text.length>16384)throw Error('SERVER_FEED_EXECUTOR_RESPONSE');
 let result;try{result=JSON.parse(text);}catch{throw Error('SERVER_FEED_EXECUTOR_RESPONSE');}
 if(!result||typeof result!=='object'||Array.isArray(result)||!(typeof result.ok==='boolean'||[result.retry,result.disabled,result.ignored,result.deferred].some(x=>x===true)))throw Error('SERVER_FEED_EXECUTOR_RESPONSE');
 return result;
}
module.exports={dispatchMessage};
