'use strict';

const KEY='catalog-read-backup/v1/offers.json';
const MAX_BYTES=1500000, DAY=86400000, MIN_INTERVAL=12*60000;
const ORIGIN='https://rexbid.pl';
const categories={
 current:{lot_sub_status:'Open'}, timed:{lot_status:'Timed'},
 'buy-now':{lot_status:'Buy Now'}, electric:{fuel_type:'Electric'}
};
const filterPlatforms=['','copart','iaai'];
const identityPattern=/^(?:[A-HJ-NPR-Z0-9]{17}|\d{6,12})$/i;
const backupEnabled=env=>env.REXBID_PUBLIC_CATALOG_BACKUP==='enabled'&&env.REXBID_AUCTION_ARCHIVE;
const date=value=>typeof value==='string'?Date.parse(value):NaN;

function identify(request,now){
 if(request.method!=='GET')return null;
 const url=new URL(request.url),q=url.searchParams;
 const input=Object.fromEntries(q);
 if(url.origin!==ORIGIN||q.size!==Object.keys(input).length)return null;
 if(url.pathname==='/api/filters'){
  if(input.view==='basic'&&filterPlatforms.includes(input.platform??'')&&Object.keys(input).every(k=>k==='view'||k==='platform'))
   return {key:'filters:'+(input.platform??''),cursor:null};
  return null;
 }
 const detail=/^\/api\/car\/([A-Z0-9]+)$/i.exec(url.pathname);
 if(detail&&identityPattern.test(detail[1])&&filterPlatforms.includes(input.platform??'')&&Object.keys(input).every(k=>k==='platform'))
  return {identity:detail[1].toUpperCase(),platform:input.platform??'',detail:true};
 if(url.pathname!=='/api/cars')return null;
 if(identityPattern.test(input.s??'')&&input.view==='cards'&&(input.per_page??'20')==='20'&&
  Object.keys(input).every(k=>['s','view','per_page'].includes(k)))
  return {identity:input.s.toUpperCase(),platform:'',detail:false};
 const category=input.category??'',extras=Object.hasOwn(categories,category)?categories[category]:{};
 if(category&&!Object.hasOwn(categories,category))return null;
 if(input.view==='showcase'){
  const expected={...extras,category,home_week:'1',with_photo:'1',view:'showcase',per_page:'24',year_from:String(new Date(now).getUTCFullYear()-5)};
  if(category&&Object.keys(input).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>input[k]===v))
   return {key:'home:'+category,cursor:null};
  return null;
 }
 for(const [k,v] of Object.entries(extras))if(input[k]===v)delete input[k];
 if(input.view!=='cards'||(input.per_page??'20')!=='20'||(input.sort!==undefined&&input.sort!=='auction_next'))return null;
 const cursor=input.cursor??null;
 if(cursor!==null&&(!cursor||cursor.length>2048))return null;
 if(Object.keys(input).some(k=>!['category','view','per_page','cursor','sort','platform','make','year_from'].includes(k)))return null;
 const platform=input.platform??'';
 if(!filterPlatforms.includes(platform)||category&&platform)return null;
 if(input.make!==undefined||input.year_from!==undefined){
  if(category||platform||input.make?.toLowerCase()!=='subaru'||input.year_from!=='2025')return null;
  return {key:'list:subaru2025',cursor};
 }
 return {key:'list:'+(category||platform||'all'),cursor};
}

function profiles(now){
 const list=(key,params={})=>({key,path:'/api/cars?'+new URLSearchParams({view:'cards',per_page:'20',...params}),paginate:true});
 return [
  ...Object.entries(categories).map(([category,extras])=>({key:'home:'+category,path:'/api/cars?'+new URLSearchParams({
   ...extras,category,home_week:'1',with_photo:'1',view:'showcase',per_page:'24',year_from:String(new Date(now).getUTCFullYear()-5)
  })})),
  list('list:all'),...Object.keys(categories).map(category=>list('list:'+category,{category})),
  ...['copart','iaai'].map(platform=>list('list:'+platform,{platform})),list('list:subaru2025',{make:'subaru',year_from:'2025'}),
  ...filterPlatforms.map(platform=>({key:'filters:'+platform,path:'/api/filters?view=basic'+(platform?'&platform='+platform:'')}))
 ];
}

async function boundary(db){
 const row=await db.prepare(`SELECT s.committed_sequence AS seq,s.active_generation AS active,g.generation_id AS id,
  g.observed_at AS observed,g.updated_at AS published FROM server_feed_state s
  LEFT JOIN server_feed_generations g ON g.generation_id=(
    SELECT generation_id FROM server_feed_generations WHERE status='complete' ORDER BY generation_id DESC LIMIT 1
  ) AND g.last_sequence=s.committed_sequence WHERE s.singleton=1`).first();
 return row?.active===null&&Number.isSafeInteger(row.id)&&Number.isSafeInteger(row.seq)&&Number.isFinite(date(row.observed))&&Number.isFinite(date(row.published))?row:null;
}

function valid(bundle,now){
 return bundle?.v===1&&Number.isSafeInteger(bundle.generation)&&Number.isSafeInteger(bundle.sequence)
  &&Number.isFinite(date(bundle.observed))&&date(bundle.observed)<=date(bundle.created)
  &&date(bundle.created)<=now+30000&&date(bundle.created)>now-2*DAY&&bundle.pages&&typeof bundle.pages==='object';
}

async function refresh(env,read,now=Date.now){
 if(!backupEnabled(env)||!env.REXBID_ACTIVE_CATALOG?.prepare)return {status:'disabled'};
 const bucket=env.REXBID_AUCTION_ARCHIVE,db=env.REXBID_ACTIVE_CATALOG,started=now();
 const old=await bucket.get(KEY),previous=old&&old.size<=MAX_BYTES?await old.json().catch(()=>null):null;
 if(valid(previous,started)&&started-date(previous.created)<MIN_INTERVAL)return {status:'recent',generation:previous.generation};
 const before=await boundary(db);
 if(!before)return {status:'import_active'};
 if(valid(previous,started)&&previous.sequence>=before.seq)return {status:'current',generation:previous.generation};
 const pages={};let bytes=0;
 async function request(path){
  const response=await read(new Request(ORIGIN+path));
  if(response?.status!==200)throw Error('catalog_backup_read');
  const text=await response.text();bytes+=new TextEncoder().encode(text).byteLength;
  if(bytes>MAX_BYTES)throw Error('catalog_backup_size');
  const body=JSON.parse(text);
  if(body.ok!==true||!body.data)throw Error('catalog_backup_payload');
  return body;
 }
 // Keep the snapshot load bounded and avoid sending the entire batch to D1 at once.
 const selected=profiles(started);
 for(let i=0;i<selected.length;i+=3){
  await Promise.all(selected.slice(i,i+3).map(async ({key,path,paginate})=>{
   const first=await request(path);
   if(!key.startsWith('filters:')&&!Array.isArray(first.data))throw Error('catalog_backup_list');
   if(!paginate||!first.meta?.next_cursor){pages[key]={first};return;}
   const cursor=first.meta.next_cursor;
   if(typeof cursor!=='string'||cursor.length>2048)throw Error('catalog_backup_cursor');
   const second=await request(path+'&cursor='+encodeURIComponent(cursor));
   const keys=new Set(first.data.map(x=>x.platform+':'+x.lot_number));
   if(!Array.isArray(second.data)||second.data.some(x=>keys.has(x.platform+':'+x.lot_number)))throw Error('catalog_backup_pagination');
   pages[key]={first,second};
  }));
 }
 if(!pages['list:all']?.first?.data?.length)throw Error('catalog_backup_empty');
 const after=await boundary(db);
 if(!after||after.seq!==before.seq||after.id!==before.id)return {status:'catalog_changed'};
 const bundle={v:1,generation:before.id,sequence:before.seq,observed:before.observed,published:before.published,created:new Date(now()).toISOString(),pages};
 const payload=JSON.stringify(bundle),size=new TextEncoder().encode(payload).byteLength;
 if(size>MAX_BYTES)throw Error('catalog_backup_size');
 const stored=await bucket.put(KEY,payload,{onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 return stored?{status:'saved',generation:bundle.generation,bytes:size,profiles:Object.keys(pages).length}:{status:'concurrent'};
}

async function fallback(request,env,now=Date.now){
 if(!backupEnabled(env))return null;
 const lookup=identify(request,now());
 if(!lookup)return null;
 try{
  const obj=await env.REXBID_AUCTION_ARCHIVE.get(KEY);
  if(!obj||obj.size>MAX_BYTES)return null;
  const bundle=await obj.json();
  if(!valid(bundle,now()))return null;
  const readState=car=>({...car.read,source:'r2-backup',catalog_scope:'active',data_status:'last_known',freshness:'stale',snapshot_at:bundle.observed});
  const headers={'Cache-Control':'no-store','X-RexBid-Read-Source':'r2-backup','X-RexBid-Backup-Generation':String(bundle.generation)};
  const metadata={read_source:'r2-backup',data_status:'last_known',catalog_complete:false,scope_status:'stale',stored_row_count:null,
   metadata_complete:false,backup_generation:bundle.generation,backup_observed_at:bundle.observed,
   freshness:{status:'stale',last_synced_at:bundle.observed},next_cursor:null};
  if(lookup.identity){
   const matches=new Map();
   for(const [key,page] of Object.entries(bundle.pages).filter(([key])=>key.startsWith('list:'))){
    for(const car of [...(page.first?.data??[]),...(page.second?.data??[])]){
     if(!['copart','iaai'].includes(car.platform)||!/^\d{6,12}$/.test(car.lot_number)||
      (lookup.platform&&car.platform!==lookup.platform))continue;
     if(car.lot_number===lookup.identity||car.vin?.toUpperCase()===lookup.identity)
      matches.set(car.platform+':'+car.lot_number,{...car,read:readState(car)});
    }
   }
   if(!matches.size||lookup.detail&&matches.size!==1)return null;
   if(!lookup.detail)return Response.json({ok:true,data:[...matches.values()],meta:metadata},{headers});
   const [card]=matches.values(),image=typeof card.image==='string'?card.image:null;
   const preview={read_only:true,freshness:'stale',last_synced_at:bundle.observed};
   const data={...card,preview,media:{items:image?[{type:'image',url:image,large:image}]:[],thumbs:image?[image]:[]}};
   return Response.json({ok:true,data,source:'r2-backup',match:'exact',read:data.read,meta:metadata},{headers});
  }
  const page=bundle.pages[lookup.key];
  const body=lookup.cursor===null?page?.first:lookup.cursor===page?.first?.meta?.next_cursor?page?.second:null;
  if(body?.ok!==true)return null;
  const rows=Array.isArray(body.data)?body.data.map(car=>({...car,read:readState(car)})):body.data;
  return Response.json({...body,data:rows,meta:{...body.meta,...metadata,
   next_cursor:lookup.cursor===null&&page.second?body.meta?.next_cursor??null:null}},{headers});
 }catch{return null;}
}

async function readWithFallback(request,env,read,delay=3500){
 if(!backupEnabled(env)||!identify(request,Date.now()))return read();
 const primary=Promise.resolve().then(read);
 let timer;
 const waiting=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),delay);});
 let first;
 try{first=await Promise.race([primary.then(response=>({response})),waiting]);}
 finally{clearTimeout(timer);}
 if(first?.response&&first.response.status<500)return first.response;
 const saved=await fallback(request,env);
 if(!saved)return primary;
 primary.then(response=>response?.body?.cancel()).catch(()=>{});
 return saved;
}

module.exports={KEY,MAX_BYTES,identify,profiles,refresh,fallback,readWithFallback};
