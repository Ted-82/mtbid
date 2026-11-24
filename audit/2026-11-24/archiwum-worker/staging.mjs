import scheduled from "./worker.archive-auto.js";
import publicArchive from "./sync/auction-archive-public.cjs";
const wallClock=Date.now.bind(Date);
let clockStart;
Date.now=()=>{
  const time=wallClock();
  if(time>0)clockStart??=time;
  return Date.parse("2026-11-24T12:00:00Z")+(clockStart&&time>0?time-clockStart:0);
};
export default {
  async fetch(request, env) {
    if(new URL(request.url).pathname!=="/tick") return publicArchive.handleArchive(request,env,new Date("2026-11-24T12:00Z"));
    let sourceReads=0,rootGetBytes=0,rootPutBytes=0,targetReads=0,targetWrites=0,largestRoot=0;
    const source=env.REXBID_ARCHIVE_FEED;
    const target=env.REXBID_AUCTION_ARCHIVE;
    const wrapped={...env,REXBID_AUCTION_ARCHIVE:{
      async get(k,o){targetReads++;const obj=await target.get(k,o);if(k==='v1/public/index.json'&&obj){rootGetBytes+=obj.size;largestRoot=Math.max(largestRoot,obj.size);}return obj;},
      async put(k,v,o){targetWrites++;if(k==='v1/public/index.json'){const size=new TextEncoder().encode(v).length;rootPutBytes+=size;largestRoot=Math.max(largestRoot,size);}return target.put(k,v,o);},
      delete(k){return target.delete(k);}
    },REXBID_ARCHIVE_FEED:{
      get(key,options){ sourceReads++;return source.get(key,options); },
      list(options){return source.list(options);}
    }};
    await scheduled.scheduled({cron:"*/5 * * * *"},wrapped);
    return Response.json({sourceReads,rootGetBytes,rootPutBytes,targetReads,targetWrites,largestRoot});
  }
};
