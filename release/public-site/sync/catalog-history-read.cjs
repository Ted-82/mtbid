'use strict';
const {reconcileTimedSales}=require('../public/rexbid-market.js');
const {requestHistory}=require('./history-request.cjs');
const PREFIX='rexh1_';
function encode(x){return PREFIX+btoa(JSON.stringify(x)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
function decode(cursor){
 if(!cursor)return{a:null,b:null,ad:false,bd:false};
 if(!cursor.startsWith(PREFIX))return{a:null,b:cursor,ad:false,bd:false};
 try{
  if(cursor.length>2400||!/^rexh1_[A-Za-z0-9_-]+$/.test(cursor))throw Error();
  const s=cursor.slice(PREFIX.length).replace(/-/g,'+').replace(/_/g,'/'),x=JSON.parse(atob(s+'='.repeat((4-s.length%4)%4)));
  if(!['a,ad,b,bd','a,ad,b,bd,i'].includes(Object.keys(x).sort().join(','))||typeof x.ad!=='boolean'||typeof x.bd!=='boolean'
   ||x.i!==undefined&&!/^(copart|iaai)\/[A-HJ-NPR-Z0-9]{17}\/\d{1,20}$/.test(x.i)
   ||[x.a,x.b].some(v=>v!==null&&(typeof v!=='string'||v.length>800||!v)))throw Error();
  return x;
 }catch{throw Error('INVALID_HISTORY_CURSOR');}
}
const identity=x=>x?.identity&&[x.identity.platform,x.identity.vin,x.identity.lot].join('/');
function unique(items,key){const rows=new Map();for(const x of items){const k=key(x),old=rows.get(k);if(!old||Date.parse(x.observed_at||'')>=Date.parse(old.observed_at||''))rows.set(k,x);}return[...rows.values()];}
const eventKey=x=>[x.platform,x.lot,x.event_key||x.source_event_id||[x.auction_date,x.sale_date].join('/')].join('/');
const snapshotKey=x=>JSON.stringify([x.observed_at,x.auction_state,x.auction_at,x.timed_end_at,x.current_bid_usd,x.buy_now_usd]);
function merge(active,legacy,state){
 state={...state};
 if(state.i&&active&&identity(active)!==state.i){active=null;state.ad=true;}
 if(state.i&&legacy&&identity(legacy)!==state.i){legacy=null;state.bd=true;}
 if(active&&legacy&&identity(active)!==identity(legacy)){legacy=null;state.bd=true;}
 const base=active||legacy;if(!base)return null;
 const records=reconcileTimedSales(unique([...(legacy?.history||[]),...(active?.history||[])],eventKey)).sort((a,b)=>String(b.sale_date||b.auction_date||'').localeCompare(String(a.sale_date||a.auction_date||'')));
 const snapshots=unique([...(legacy?.rex_history?.snapshots||[]),...(active?.rex_history?.snapshots||[])],snapshotKey).sort((a,b)=>String(b.observed_at).localeCompare(String(a.observed_at)));
 const a=active?.meta?.next_cursor??state.a,b=legacy?.meta?.next_cursor??state.b;
 const next={a:active?active.meta?.next_cursor??null:a,b:legacy?legacy.meta?.next_cursor??null:b,i:identity(base),
  ad:state.ad||!!active&&!active.meta?.next_cursor,bd:state.bd||!!legacy&&!legacy.meta?.next_cursor};
 const nextCursor=next.ad&&next.bd?null:encode(next);
 const kind=records.length&&snapshots.length?'events_and_snapshots':records.length?'confirmed_events':snapshots.length?'snapshots_only':'empty';
 const av=[active?.meta?.history_availability,legacy?.meta?.history_availability].filter(Boolean).sort((a,b)=>(Date.parse(b.fetched_at)||0)-(Date.parse(a.fetched_at)||0))[0]||{state:'not_fetched',complete:false};
 return{...base,history:records,rex_history:{count:records.length,records,events:records,snapshots,kind},
  meta:{...base.meta,next_cursor:nextCursor,has_more_stored_rows:!!nextCursor,history_kind:kind,history_availability:{...av,stored_event_count:records.length}},
  read:{...base.read,history_kind:kind,confirmed_event_count:records.length,observed_snapshot_count:snapshots.length,history_databases:active&&legacy?'active_and_legacy':active?'active':'legacy'}};
}
async function readCatalogHistory(request,{active,legacy,db,requireUniqueIdentity=false}){
 const url=new URL(request.url);let cursor;
 try{cursor=decode(url.searchParams.get('cursor'));}catch{return new Response(JSON.stringify({ok:false,error:'invalid_history_cursor'}),{status:400,headers:{'Content-Type':'application/json'}});}
 const read=async(fn,value,done)=>{
  if(done)return null;const u=new URL(url);u.searchParams.delete('cursor');if(value)u.searchParams.set('cursor',value);
  try{const response=await fn(new Request(u,request));if(response.status!==200)return{response};const data=await response.clone().json();return{response,body:data?.ok===true&&identity(data)?data:null};}catch{return null;}
 };
 const [a,b]=await Promise.all([read(active,cursor.a,cursor.ad),read(legacy,cursor.b,cursor.bd)]);
 if(requireUniqueIdentity){
  if([a,b].some(r=>r?.response?.status===409) || (a?.body && b?.body && identity(a.body)!==identity(b.body)))
   return Response.json({ok:false,error:'ambiguous_history_identity'},{status:409});
  if([a,b].some(r=>!r?.body && r?.response?.status!==404))
   return Response.json({ok:false,error:'history_identity_unavailable'},{status:503});
 }
 const state={...cursor,ad:cursor.ad||a?.response?.status===404,bd:cursor.bd||b?.response?.status===404};
 const body=merge(a?.body,b?.body,state);
 if(!body&&cursor.i)return new Response(JSON.stringify({ok:false,error:'history_identity_changed'}),{status:409,headers:{'Content-Type':'application/json'}});
 if(!body)return a?.response?.status!==404&&a?.response?a.response:b?.response||a?.response||new Response(JSON.stringify({ok:false,error:'saved_history_temporarily_unavailable'}),{status:503});
 if(a?.body){try{const refresh=await requestHistory(db,a.body.identity,a.body.meta?.history_availability);if(refresh)body.meta.history_refresh=refresh;}catch{body.meta.history_refresh={state:'unavailable'};}}
 return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json; charset=UTF-8','Cache-Control':'private, no-store','X-RexBid-History':'saved-merged-v1'}});
}
module.exports={readCatalogHistory,decode,encode,merge};
