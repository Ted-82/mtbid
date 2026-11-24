import timed from '../../public-site/sync/timed-iaai-read.cjs';
import evidence from '../../public-site/sync/timed-bid-read.cjs';

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    const now=Date.parse('2026-11-24T20:47:48.616Z');
    if(url.pathname==='/measure') {
      const lots=await request.json();
      const result=await env.REXBID_ACTIVE_CATALOG.prepare(evidence.SQL).bind(JSON.stringify(lots)).all();
      return Response.json({rows:result.results.length,bytes:new TextEncoder().encode(JSON.stringify(result.results)).length,meta:result.meta});
    }
    const result=await timed.readTimed(request,env,async()=>({response:new Response(null,{status:404})}),now);
    return result?.response||new Response(null,{status:404});
  }
};
