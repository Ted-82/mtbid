'use strict';

const {VIN,getIndex,saveIndex,restorableKeys,locked,purgeObjects,hash}=require('../sync/auction-archive-state.cjs');
const {queryEntries,withoutVin,count}=require('../sync/auction-archive-segments.cjs');
const PATH='/api/portal/archive';
const reasons=new Set(['ownership','request','correction']);
const MAX_SUPPRESSIONS=1200;

function response(body,status,cookies=[]) {
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
    'X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff',Vary:'Cookie'});
  for(const cookie of cookies) headers.append('Set-Cookie',cookie);
  return new Response(JSON.stringify(body),{status,headers});
}

function createOwnerArchiveHandler(resolveAccount) {
  return async (request,env)=>{
    const url=new URL(request.url);
    if(url.pathname!==PATH) return null;
    const fail=(error,status,cookies)=>response({ok:false,error},status,cookies);
    if(!['GET','POST'].includes(request.method)) return fail('method_not_allowed',405);
    const origin=request.headers.get('Origin');
    if(url.origin!==env.AUTH_CANONICAL_ORIGIN || (origin&&origin!==url.origin) ||
       ['cross-site','same-site'].includes(request.headers.get('Sec-Fetch-Site')) ||
       request.method==='POST'&&(origin!==url.origin||!/^application\/json\b/i.test(request.headers.get('Content-Type')||'')))
      return fail('forbidden',403);
    let cookies=[];
    try {
      const account=await resolveAccount(request,env);
      cookies=account?.cookies||[];
      if(account?.status!==200||!account?.user?.id) return fail('unauthorized',401,cookies);
      if(!env.REXBID_OWNER_USER_ID||account.user.id!==env.REXBID_OWNER_USER_ID) return fail('forbidden',403,cookies);
      if(account.assurance_level!=='aal2') return fail('owner_mfa_required',403,cookies);

      if(request.method==='GET'&&url.searchParams.get('storage')==='1'){
        const object=await env.REXBID_AUCTION_ARCHIVE.get('v2/private/storage-status.json');
        return response({ok:true,storage:object?await object.json():null},200,cookies);
      }
      if(request.method==='GET'&&url.searchParams.get('count')==='1'){
        const {index}=await getIndex(env.REXBID_AUCTION_ARCHIVE);
        return response({ok:true,archiveEntries:count(index)},200,cookies);
      }

      let body;
      if(request.method==='POST') {
        if(Number(request.headers.get('content-length'))>1024||!request.body) return fail('invalid_request',400,cookies);
        const reader=request.body.getReader();
        const decoder=new TextDecoder();
        let raw='', size=0;
        try {
          while(true){
            const {done,value}=await reader.read();
            if(done)break;
            size+=value.length;
            if(size>1024)return fail('invalid_request',400,cookies);
            raw+=decoder.decode(value,{stream:true});
          }
        } finally {await reader.cancel().catch(()=>{});}
        try{body=JSON.parse(raw+decoder.decode());}catch{return fail('invalid_request',400,cookies);}
        if(!body||typeof body.vin!=="string"||body.vin!==body.confirm||!reasons.has(body.reason)) return fail('invalid_request',400,cookies);
      }
      const vin=(body?.vin??url.searchParams.get('vin')??'').trim().toUpperCase();
      if(!VIN.test(vin)) return fail('invalid_vin',400,cookies);
      const bucket=env.REXBID_AUCTION_ARCHIVE;
      const {index,etag}=await getIndex(bucket);
      const suppressed=await hash(vin);
      const entries=await queryEntries(bucket,index,{q:vin});
      if(request.method==='GET') return response({ok:true,vin,suppressed:index.hidden.includes(suppressed),
        entries:entries.map(({platform,lot,year,title,photos})=>({platform,lot,year,title,photos:photos.length}))},200,cookies);
      if(locked(index)) return fail('archive_busy',409,cookies);
      if(index.hidden.includes(suppressed)&&!entries.length) return response({ok:true,removed:0,blocked:true},200,cookies);
      if(!entries.length) return fail('vin_not_found',404,cookies);
      if(index.hidden.length>=MAX_SUPPRESSIONS) return fail('unavailable',503,cookies);
      const lock={id:crypto.randomUUID(),until:Date.now()+180_000};
      const deletions=[...new Set([...index.deletions,...entries.flatMap(restorableKeys)])];
      const updated={...await withoutVin(bucket,index,vin),lock,deletions,hidden:[...new Set([...index.hidden,suppressed])]};
      let current=await saveIndex(bucket,updated,etag);
      try {
        let next=updated;
        while(next.deletions.length) ({index:next,etag:current}=await purgeObjects(bucket,next,current));
        delete next.lock;
        await saveIndex(bucket,next,current);
      } catch {
        return response({ok:true,removed:entries.length,blocked:true,purgePending:true},202,cookies);
      }
      return response({ok:true,removed:entries.length,blocked:true},200,cookies);
    } catch(error) {
      if(error.message==='archive_index_conflict') return fail('archive_busy',409,cookies);
      return fail('unavailable',503,cookies);
    }
  };
}

module.exports={createOwnerArchiveHandler};

