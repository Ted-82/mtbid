'use strict';

const {KEY,MAX_ROWS,MAX_BYTES,MAX_AGE}=require('./timed-iaai-refresh.cjs');
const {queryOptions,homeCardDTO,catalogCardDTO}=require('../staging/d1-primary-reads.cjs');
const {parseSort}=require('./catalog-order.cjs');

const memo=new WeakMap(), day=86400000;
const low=v=>String(v??'').trim().toLowerCase();
const num=(value)=>typeof value==='number'&&Number.isFinite(value)?value:null;
const deadline=r=>Date.parse(r.auction.timed_end_at);
const isLot=v=>/^\d{6,12}$/.test(v);
const isVin=v=>/^[A-HJ-NPR-Z0-9]{17}$/i.test(v);
const active=(r,now)=>r?.platform==='iaai'&&r.auction?.is_timed===true&&r.auction.state==='open'&&deadline(r)>now;

async function snapshot(bucket,now){
 let state=memo.get(bucket);
 if(!state||now>=state.until){
  state={until:now+60000,promise:bucket.get(KEY).then(async object=>{
   if(!object)return null;
   const declared=Date.parse(object.customMetadata?.observed);
   const uploaded=object.uploaded==null?NaN:new Date(object.uploaded).getTime();
   const expired=Number.isFinite(declared) ? declared>now||now-declared>MAX_AGE :
     Number.isFinite(uploaded)&&now-uploaded>MAX_AGE;
   if(expired||object.size>MAX_BYTES){
    await object.body?.cancel();
    return null;
   }
   const payload=await new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).text();
   if(payload.length>MAX_BYTES)return null;
   const saved=JSON.parse(payload),stamp=Date.parse(saved.observed);
   if(saved.schema!==1||!Number.isFinite(stamp)||!Array.isArray(saved.entries)||saved.entries.length>MAX_ROWS)return null;
   const index=new Map();
   for(const entry of saved.entries){
    if(!active(entry,-Infinity)||!isLot(entry.lot_number)||!isVin(entry.vin))continue;
    index.set(entry.lot_number,entry);
   }
   return {saved,index,stamp};
  }).catch(()=>null)};
  memo.set(bucket,state);
 }
 const data=await state.promise;
 return data&&data.stamp<=now&&now-data.stamp<=MAX_AGE?data:null;
}

const aliases=[
 ['mercedes','mercedes-benz','mercedes benz'],['lucid','lucid motors'],['fisker','fisker automotive'],
 ['automatic','automatic transmission'],['manual','manual transmission'],
 ['electric','bev','battery electric','battery electric vehicle','all electric','pure electric','fully electric'],
 ['gas','gasoline','petrol'],['hybrid','electric and gas hybrid','hybrid engine','hev'],
 ['flexible','flexible fuel','flexiblefuel','flex fuel'],['all wheel drive','awd'],
 ['front wheel drive','front-wheel drive','fwd'],['rear wheel drive','rear-wheel drive','rwd'],
 ['four wheel drive','four by four','4wd'],['insurance','insurance company','ins','ubezpieczyciel'],
 ['non_insurance','non-insurance','non insurance company','nins']
];
function matches(target,value){
 const v=low(value),t=low(target);
 return !t||t===v||aliases.some(group=>group.includes(t)&&group.includes(v));
}
function inRange(value,lower,upper){
 const n=num(value);
 return (lower===null||(n!==null&&n>=lower))&&(upper===null||(n!==null&&n<=upper));
}
function hasPhoto(r){
 return Boolean(r.media?.thumbs?.length||r.media?.items?.length);
}
function filter(r,p,now){
 const condition=r.condition??{}, sale=r.sale_document??{}, q=low(p.search);
 if(!active(r,now)||p.timed===false||p.buyNow||
   p.homeWeek&&deadline(r)>now+7*day||p.withPhoto&&!hasPhoto(r)||
   !inRange(r.year,p.yearFrom,p.yearTo)||!inRange(r.odometer?.value,p.odometerFrom,p.odometerTo)||
   !inRange(r.pricing?.current_bid_usd,p.priceMin,p.priceMax))return false;
 const fields=[[p.platform,r.platform],[p.make,r.make],[p.model,r.model],[p.bodyStyle,r.body_style],[p.fuelType,r.fuel_type],
  [p.transmission,r.transmission],[p.driveType,r.drive_type],[p.runCondition,condition.run_condition],
  [p.damage,condition.primary_damage],[p.sellerType,r.seller?.type],[p.saleDocumentType,sale.type],
  [p.saleDocumentName,sale.name],[p.locationState,r.location?.state],[p.auctionState,r.auction.state],
  [p.sourceStatus,r.auction.formatted]];
 if(!fields.every(([term,value])=>matches(term,value)))return false;
 if(!q)return true;
 if(isVin(q)||isLot(q))return low(r.vin)===q||r.lot_number===q;
 return q.split(/\s+/).every(word=>low([r.year,r.make,r.model,r.title,r.vin,r.lot_number].join(' ')).includes(word));
}
const sorters={
 auction_next:[deadline,1],auction_later:[deadline,-1],recent:[r=>Date.parse(r.source_updated_at)||null,-1],
 year_desc:[r=>num(r.year),-1],year_asc:[r=>num(r.year),1],
 mileage_asc:[r=>num(r.odometer?.value),1],bid_asc:[r=>num(r.pricing?.current_bid_usd),1],
 bid_desc:[r=>num(r.pricing?.current_bid_usd),-1],buy_now_asc:[()=>null,1]
};
function anchor(sort,row){return {value:sorters[sort][0](row),lot:row.lot_number};}
function compare(sort,a,b){
 if(a.value===null&&b.value!==null)return 1;
 if(a.value!==null&&b.value===null)return -1;
 return (a.value-b.value)*sorters[sort][1]||a.lot.localeCompare(b.lot);
}
function cursor(value,sort){
 if(!value)return null;
 try{
  if(!value.startsWith('ti1.')||value.length>250)throw Error();
  const data=JSON.parse(atob(value.slice(4)));
  if(data.sort!==sort||!isLot(data.lot)||(data.value!==null&&!Number.isFinite(data.value)))throw Error();
  return data;
 }catch{throw Error('invalid_catalog_cursor');}
}
function decorate(row,observed){
 return {...row,media:{...row.media},last_seen_at:observed,last_synced_at:observed,freshness_status:'fresh',
  read:{source:'apibara_timed_snapshot',catalog_scope:'active',freshness:'fresh',data_status:'observed',last_seen_at:observed,last_synced_at:observed}};
}
function listRow(row,view,observed){
 const dto=decorate(row,observed);
 if(view==='showcase')return homeCardDTO(null,dto);
 if(view==='cards')return catalogCardDTO(null,dto);
 return dto;
}
function response(body,status=200){
 return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=UTF-8',
  'Cache-Control':'private, no-store','X-RexBid-Read-Source':'apibara_timed_snapshot'}});
}

function list(request,data,now){
 const url=new URL(request.url),opts=queryOptions(url,now,true),q=url.searchParams;
 let sort,after;
 try{
  sort=parseSort(q.get('sort')&&opts.sort||'auction_next');
  after=cursor(opts.cursor,sort);
 }catch(e){return response({ok:false,error:e.message.includes('cursor')?'invalid_catalog_cursor':'invalid_catalog_sort'},400);}
 if(opts.yearFrom!==null&&opts.yearTo!==null&&opts.yearFrom>opts.yearTo)return response({ok:false,error:'invalid_year_range'},400);
 const rows=[...data.index.values()].filter(r=>filter(r,opts,now)).sort((a,b)=>compare(sort,anchor(sort,a),anchor(sort,b)));
 const page=rows.filter(r=>!after||compare(sort,anchor(sort,r),after)>0).slice(0,opts.limit+1);
 const more=page.length>opts.limit;
 if(more)page.pop();
 const next=more?'ti1.'+btoa(JSON.stringify({sort,...anchor(sort,page.at(-1))})):null;
 return response({ok:true,data:page.map(r=>listRow(r,q.get('view'),data.saved.observed)),meta:{
  per_page:opts.limit,next_cursor:next,has_more_stored_rows:more,sort,metadata_complete:false,
  read_source:'apibara_timed_snapshot',known_rows_only:true,data_status:'observed',snapshot_observed_at:data.saved.observed,
  freshness:{status:'fresh',last_seen_at:data.saved.observed,last_synced_at:data.saved.observed}
 }});
}

async function readTimed(request,env,readNormal,now=Date.now()){
 if(env.REXBID_TIMED_IAAI_ENABLED!=='enabled'||request.method!=='GET'||!env.REXBID_AUCTION_ARCHIVE?.get)return null;
 const url=new URL(request.url), p=url.searchParams,platform=low(p.get('platform'));
 if(platform&&platform!=='iaai')return null;
 const id=url.pathname.match(/^\/api\/car\/([A-HJ-NPR-Z0-9]+)$/i)?.[1];
 const home=url.pathname==='/api/cars'&&p.get('category')==='timed';
 const timedList=url.pathname==='/api/cars'&&(home||low(p.get('lot_status'))==='timed'||p.get('timed')==='true');
 if(!timedList&&(!id||(!isLot(id)&&!isVin(id))||isLot(id)&&!platform))return null;
 const data=await snapshot(env.REXBID_AUCTION_ARCHIVE,now);
 if(!data)return null;
 if(timedList)return {response:list(request,data,now),active:true};
 const identifier=id;
 const candidates=isLot(identifier)?[data.index.get(identifier)]:[...data.index.values()].filter(r=>low(r.vin)===low(identifier));
 const matches=candidates.filter(r=>active(r,now));
 if(matches.length!==1)return null;
 const result=await readNormal();
 const row=matches[0], observed=data.saved.observed, dto=decorate(row,observed);
 if(result.response?.ok){
  const saved=await result.response.clone().json().catch(()=>null),old=saved?.data;
  if(old?.platform!=='iaai'||String(old.lot_number)!==row.lot_number||low(old.vin)!==low(row.vin))return result;
  const ended=['ended','sold','finished','removed','closed','not_sold'].includes(low(old.auction?.state))||Boolean(old.auction?.outcome_status);
  if(ended&&Date.parse(old.last_seen_at??saved.read?.last_seen_at)>=data.stamp)return result;
  for(const key of ['engine_size_l','trim'])if(dto[key]==null)dto[key]=old[key]??null;
  for(const key of ['items','thumbs'])if(!dto.media[key]?.length&&Array.isArray(old.media?.[key]))dto.media[key]=old.media[key];
  if(!dto.seller?.name&&old.seller?.name)dto.seller=old.seller;
 }else if(result.response&&result.response.status!==404&&result.response.status<500)return result;
 return {response:response({ok:true,data:dto,source:'apibara_timed_snapshot',read_source:'apibara_timed_snapshot',
  match:'exact',read:dto.read,fallback_reason:null}),active:true};
}

module.exports={readTimed,list,filter};
