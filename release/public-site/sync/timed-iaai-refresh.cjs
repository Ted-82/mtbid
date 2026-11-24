'use strict';

const {createApibaraProvider,buildRequestUrl}=require('../providers/apibara.js');
const {toPublicVehicleDTO}=require('./d1-read-repository.js');
const provider=createApibaraProvider();
const KEY='timed-iaai/v1/catalogue.json.gz';
const MAX_ROWS=6000, PAGE_SIZE=20, MAX_PAGES=MAX_ROWS/PAGE_SIZE;
const MAX_BYTES=20000000, RESERVE=35000, SCAN_INTERVAL=6*3600000, MAX_AGE=8*3600000;
const ATTEMPT_VERSION='2';
const lotPattern=/^\d{6,12}$/, vinPattern=/^[A-HJ-NPR-Z0-9]{17}$/;
const iso=at=>new Date(at).toISOString();
const fail=code=>{throw Error(code);};
const https=value=>typeof value==='string'&&/^https:\/\//i.test(value);

function compactMedia(media){
 const items=(media.items??[]).slice(0,18).map(item=>
   [item.large,item.url,item.src,item.thumb].find(https)).filter(Boolean).map(url=>({url}));
 const cover=(media.thumbs??[]).find(https);
 return {...media,items,thumbs:cover?[cover]:[]};
}

function normalize(raw, started){
 const lot=String(raw?.lot_number??''),vin=String(raw?.vin??'').toUpperCase(),a=raw?.auction;
 if(raw?.platform!=='iaai'||!lotPattern.test(lot)||!vinPattern.test(vin))return null;
 if(a?.is_timed!==true||a.state!=='open'||a.lot_removed||a.result_confirmed||
  !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(a.timed_end_at??''))return null;
 const end=Date.parse(a.timed_end_at);
 if(!Number.isFinite(end)||end<=started||end>started+365*86400000)return null;
 const normalized=provider.normalizeVehicle(raw);
 if(normalized.platform!=='iaai'||normalized.lot!==lot||normalized.vin!==vin||!normalized.title)return null;
 const dto=toPublicVehicleDTO(provider.toCanonicalVehicle(raw,normalized));
 const bid=dto.pricing.current_bid_usd;
 dto.auction={...dto.auction,state:'open',phase:null,formatted:'Timed Auction',auction_at:null,schedule_status:'timed',is_timed:true,
   outcome_status:null,timed_end_at:iso(end)};
 dto.pricing={current_bid_usd:Number.isFinite(bid)&&bid>0?bid:null,current_bid2_usd:null,buy_now_usd:null,final_price_usd:null,source_price_usd:null};
 dto.media=compactMedia(dto.media);
 const updated=Date.parse(raw.updated_at);
 const cycle=a.auction_id??raw.auction_id;
 return {...dto,...(cycle==null?{}:{timed_source_cycle:String(cycle)}),source_updated_at:Number.isFinite(updated)&&updated<=started?iso(updated):null};
}

async function request(key,url,fetchImpl){
 // Workers supports manual redirects. An unexpected 3xx fails the status
 // check below, without forwarding the API key to another destination.
 const r=await fetchImpl(url,{headers:{'X-API-Key':key,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(12000)});
 if(!r.ok)fail('TIMED_SOURCE_'+r.status);
 const j=await r.json();
 if(j?.ok!==true)fail('TIMED_SOURCE_RESPONSE');
 return j;
}
async function collect({key,fetchImpl=fetch,now=Date.now}){
 const started=now(),inventory=new Map(),cursorSeen=new Set();
 const account=(await request(key,buildRequestUrl({operation:'apiUsage'}),fetchImpl)).data;
 const left=account?.quota?.left;
 if(!Number.isSafeInteger(left)||left<RESERVE+MAX_PAGES+1)fail('TIMED_QUOTA_RESERVE');
 let skipped=0, total=null,cursor=null;
 for(let page=0;page<MAX_PAGES;page++){
  if(now()-started>11*60000)fail('TIMED_TIME_LIMIT');
  const filters={platform:'iaai',lot_status:'Timed',lot_sub_status:'Open',upcoming:'all',per_page:PAGE_SIZE,view:'full'};
  const url=new URL(buildRequestUrl({operation:'listVehicles',params:{...filters,
    ...(page===0?{include_total:true}:{cursor})}}));
  url.searchParams.set('view','full');
  url.searchParams.set('sort','auction_soonest');
  const j=await request(key,url,fetchImpl), meta=j?.meta, rows=j?.data;
  if(!Array.isArray(rows)||rows.length>PAGE_SIZE||meta?.sort!=='auction_soonest'||meta.view!=='full'||meta.per_page!==PAGE_SIZE||
    !Array.isArray(meta.unknown_filters)||meta.unknown_filters.length||
    !Object.entries(filters).every(([k,v])=>meta.applied_filters?.[k]===String(v)))fail('TIMED_SOURCE_FILTERS');
  if(page===0){
   total=meta.total;
   if(meta.total_is_exact!==true||!Number.isSafeInteger(total)||total<rows.length||total>MAX_ROWS)fail('TIMED_SOURCE_TOTAL');
  }
  for(const raw of rows){
   const row=normalize(raw,started);
   if(!row){skipped++;continue;}
   const old=inventory.get(row.lot_number);
   if(old&&old.vin!==row.vin)fail('TIMED_SOURCE_IDENTITY_CONFLICT');
   if(!old||String(row.source_updated_at??'')>String(old.source_updated_at??''))inventory.set(row.lot_number,row);
  }
  cursor=meta.next_cursor;
  if(meta.has_more!==(cursor!==null)||
    cursor!==null&&(typeof cursor!=='string'||!rows.length||cursor.length>4096||cursorSeen.has(cursor)))fail('TIMED_SOURCE_CURSOR');
  if(cursor===null){
   if(inventory.size>total+PAGE_SIZE*2||inventory.size+skipped<total-PAGE_SIZE*2)fail('TIMED_SOURCE_INCOMPLETE');
   const finished=now(),entries=[...inventory.values()].filter(r=>Date.parse(r.auction.timed_end_at)>finished);
   return {schema:1,started:iso(started),observed:iso(finished),total,pages:page+1,skipped,entries};
  }
  cursorSeen.add(cursor);
 }
 fail('TIMED_PAGE_LIMIT');
}
async function refresh(env,{now=Date.now,fetchImpl=fetch}={}){
 const bucket=env.REXBID_AUCTION_ARCHIVE,key=env.APIBARA_API_KEY;
 if(!bucket||!key)return {status:'disabled'};
 const previous=await bucket.head(KEY), at=now();
 const last=Date.parse(previous?.customMetadata?.observed??previous?.uploaded);
 if(Number.isFinite(last)&&at-last<SCAN_INTERVAL)return {status:'current'};
 const block=await bucket.head(KEY+'.attempt');
 // Attempts made before the redirect fix could not reach Apibara. Retry on
 // the next scheduled run while keeping the one-hour delay for new attempts.
 if(block?.customMetadata?.version===ATTEMPT_VERSION&&Date.parse(block.customMetadata.until)>at)
  return {status:'retry_delay'};
 const lock=await bucket.put(KEY+'.attempt','',{customMetadata:{version:ATTEMPT_VERSION,until:iso(at+3600000)},
   onlyIf:block?{etagMatches:block.etag}:{etagDoesNotMatch:'*'}});
 if(!lock)return {status:'concurrent'};
 const record=await collect({key,now,fetchImpl}),data=JSON.stringify(record);
 if(new TextEncoder().encode(data).length>MAX_BYTES)fail('TIMED_SIZE_LIMIT');
 const packed=await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
 const saved=await bucket.put(KEY,packed,{customMetadata:{observed:record.observed},
   onlyIf:previous?{etagMatches:previous.etag}:{etagDoesNotMatch:'*'}});
 if(!saved)fail('TIMED_SNAPSHOT_CHANGED');
 return {status:'complete',count:record.entries.length,pages:record.pages,observed:record.observed};
}
module.exports={KEY,MAX_ROWS,MAX_BYTES,MAX_AGE,RESERVE,normalize,collect,refresh,compactMedia};
