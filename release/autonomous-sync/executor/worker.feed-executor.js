import pipeline from './sync/feed-server-runner.cjs';
import diagnostics from './sync/feed-executor-diagnostics.cjs';
export default {
 async fetch(request,env){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/consume')return new Response('Not found',{status:404});
  if(Number(request.headers.get('content-length')||0)>1024)return new Response('Too large',{status:413});
  const text=await request.text();if(text.length>1024)return new Response('Too large',{status:413});
  let body;try{body=JSON.parse(text);}catch{return new Response('Invalid request',{status:400});}
  const started=Date.now(),requestId=crypto.randomUUID();let diagnosticCount=0,diagnosticDb;
  const diagnosticEnv=Object.create(env);
  try{
   if(typeof env.REXBID_DB?.prepare==='function'&&typeof env.REXBID_DB?.batch==='function'){diagnosticDb=diagnostics.diagnosticDatabase(env.REXBID_DB,entry=>{if(diagnosticCount++<5)console.error(JSON.stringify({component:'server-feed-d1-failure',requestId,...entry}));});Object.defineProperty(diagnosticEnv,'REXBID_DB',{value:diagnosticDb,enumerable:true});}
   const result=await pipeline.runMessage({env:diagnosticEnv,body});
   console.log(JSON.stringify({component:'server-feed-executor',requestId,placement:request.headers.get('cf-placement'),colo:request.cf?.colo,
    wallMs:Date.now()-started,...result,nativeDatabaseUsage:diagnosticDb?.usageSnapshot()??null}));
   return Response.json(result);
  }catch(error){
   const result={ok:false,retry:true,retryAfter:60,errorCode:pipeline.safeCode(error)};
   console.error(JSON.stringify({component:'server-feed-executor',requestId,failure:diagnostics.summarizeFailure(error),...result,nativeDatabaseUsage:diagnosticDb?.usageSnapshot()??null}));return Response.json(result);
  }
 }
};
