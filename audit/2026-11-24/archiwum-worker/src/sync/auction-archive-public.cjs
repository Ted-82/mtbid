'use strict';

const {INDEX_KEY,MAX_ENTRIES,MAX_INDEX_BYTES,MAX_PHOTO_BYTES,GALLERY_OBJECT,baseKey,minimumYear}=require('./auction-archive-state.cjs');
const {queryEntries,validateSegments}=require('./auction-archive-segments.cjs');
const PAGE_SIZE = 12;
const PHOTO_ROUTE = /^\/archiwum-zdjecie\/(copart|iaai)\/(\d{5,14})\/(\d{1,15})\/(\d{2}\.jpg)$/;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const LOT = /^\d{5,14}$/;
const HEADERS = {
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"
};

function json(request, status, body) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
    status, headers:{...HEADERS,'Content-Type':'application/json; charset=UTF-8'}
  });
}

function validEntry(item) {
  return item && ['copart','iaai'].includes(item.platform) && LOT.test(item.lot || '') &&
    VIN.test(item.vin || '') && Number.isSafeInteger(item.sequence) && item.sequence > 0 &&
    Number.isSafeInteger(item.year) && item.year < 2100 &&
    typeof item.title === 'string' && item.title.length <= 160 &&
    typeof item.recordedAt === 'string' && Number.isFinite(Date.parse(item.recordedAt)) &&
    (item.saleCents === null || Number.isSafeInteger(item.saleCents) && item.saleCents > 0) &&
    Array.isArray(item.photos) && item.photos.length > 0 && item.photos.length <= 22 &&
    item.photos.every(name=>/^\d{2}\.jpg$/.test(name)) && new Set(item.photos).size === item.photos.length &&
    (item.photoBytes===undefined || Array.isArray(item.photoBytes) && item.photoBytes.length===item.photos.length &&
      item.photoBytes.every(size=>Number.isSafeInteger(size)&&size>=32&&size<=MAX_PHOTO_BYTES));
}

function indexView(index, now) {
  if (!index || ![1,2].includes(index.version) || !Array.isArray(index.entries) || index.entries.length > MAX_ENTRIES ||
      !index.entries.every(validEntry)) throw Error('Archive index schema');
  const minYear=minimumYear(now);
  const keys = new Set();
  return index.entries.filter(item=>{
    const key=item.platform+'/'+item.lot+'/'+item.sequence;
    if(keys.has(key)) throw Error('Archive duplicate');
    keys.add(key);
    return item.year >= minYear && item.visible === true;
  });
}

async function readIndex(bucket, context) {
  const cache = context?.waitUntil ? globalThis.caches?.default : null;
  const key = 'https://rexbid.pl/.rex-archive-cache/v1/index';
  const cached = await cache?.match(key);
  if (cached) return cached.json();
  const object = await bucket.get(INDEX_KEY);
  if (!object) return {version:1,entries:[]};
  if (object.size > MAX_INDEX_BYTES) throw Error('Archive index size');
  const index = await object.json();
  if (cache) context.waitUntil(cache.put(key,new Response(JSON.stringify(index),{
    headers:{'Content-Type':'application/json','Cache-Control':'max-age=30'}
  })).catch(()=>{}));
  return index;
}

function photoUrl(entry,name) {
  return '/archiwum-zdjecie/'+entry.platform+'/'+entry.lot+'/'+entry.sequence+'/'+name;
}

function publicEntry(entry) {
  const {platform,lot,vin,year,title,sequence,recordedAt,saleCents,status}=entry;
  return {platform,lot,vin,year,title,sequence,recordedAt,saleCents,status:status??'sold',photos:entry.photos.map(name=>photoUrl(entry,name))};
}

async function handleArchive(request, env, now = new Date(), context) {
  const url = new URL(request.url);
  const lookup = url.pathname === '/api/archiwum';
  const photo = url.pathname.startsWith('/archiwum-zdjecie/');
  if (!lookup && !photo) return null;
  if (!['GET','HEAD'].includes(request.method)) return json(request,405,{ok:false});
  if (!env.REXBID_AUCTION_ARCHIVE?.get) return json(request,503,{ok:false});
  const match = photo ? PHOTO_ROUTE.exec(url.pathname) : null;
  if (photo && !match) return json(request,404,{ok:false});
  const q = (url.searchParams.get('q') || '').trim().toUpperCase();
  if (lookup && q && !VIN.test(q) && !LOT.test(q)) return json(request,400,{ok:false});
  const before=url.searchParams.get('before');
  if(lookup&&before&&!/^\d{1,15}$/.test(before)) return json(request,400,{ok:false});
  try {
    if (env.ARCHIVE_RATE_LIMITER?.limit) {
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip) return json(request,503,{ok:false});
      const limit = await env.ARCHIVE_RATE_LIMITER.limit({key:ip});
      if (!limit.success) return json(request,429,{ok:false});
    }
    const bucket = env.REXBID_AUCTION_ARCHIVE;
    // Photo authorization uses a fresh root so an owner's removal is enforced
    // even if JPEG bytes or the list's root are still cached at the edge.
    const index=await readIndex(bucket,photo?null:context);
    indexView(index,now);validateSegments(index);
    const visible=item=>{if(!validEntry(item))throw Error('Archive entry schema');return item.year>=minimumYear(now)&&item.visible===true;};
    if (lookup) {
      const matches=await queryEntries(bucket,index,{q,before,limit:PAGE_SIZE+1,filter:visible});
      const page=matches.slice(0,PAGE_SIZE);
      return json(request,200,{ok:true,entries:page.map(publicEntry),next:matches.length>PAGE_SIZE?String(page.at(-1).sequence):null});
    }
    const [,platform,lot,sequence,name]=match;
    const entries=await queryEntries(bucket,index,{q:lot,filter:visible});
    const entry = entries.find(item=>item.platform===platform && item.lot===lot &&
      String(item.sequence)===sequence && item.photos.includes(name));
    if (!entry) return json(request,404,{ok:false});
    const cache = context?.waitUntil ? globalThis.caches?.default : null;
    const key = 'https://rexbid.pl/.rex-archive-cache/v1/photos/'+platform+'/'+lot+'/'+sequence+'/'+name;
    const cached = await cache?.match(key);
    if (cached) {
      if (request.method==='HEAD') await cached.body?.cancel();
      return new Response(request.method==='HEAD'?null:cached.body,{
        headers:{...HEADERS,'Content-Type':'image/jpeg','Content-Length':cached.headers.get('Content-Length')}
      });
    }
    const prefix=baseKey(entry);
    const sizes=entry.photoBytes;
    const position=entry.photos.indexOf(name);
    const range=sizes?{offset:sizes.slice(0,position).reduce((sum,size)=>sum+size,0),length:sizes[position]}:null;
    const object=range
      ? await bucket.get(prefix+'/'+GALLERY_OBJECT,{range})
      : await bucket.get(prefix+'/'+name);
    const expected=range?.length ?? object?.size;
    if (!object || expected < 32 || expected > MAX_PHOTO_BYTES ||
      (range && object.size!==sizes.reduce((sum,size)=>sum+size,0))) return json(request,404,{ok:false});
    const delivered=object.httpMetadata?.contentType;
    if (delivered && !['image/jpeg','application/octet-stream'].includes(delivered)) return json(request,404,{ok:false});
    const bytes=new Uint8Array(await object.arrayBuffer());
    if (bytes.length!==expected || bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255 ||
        bytes.at(-2)!==255 || bytes.at(-1)!==217) return json(request,404,{ok:false});
    const response = new Response(request.method==='HEAD'?null:bytes,{
      headers:{...HEADERS,'Content-Type':'image/jpeg','Content-Length':String(expected)}
    });
    if (cache && request.method==='GET') {
      const copy=response.clone();
      context.waitUntil(cache.put(key,new Response(copy.body,{
        headers:{'Content-Type':'image/jpeg','Content-Length':String(expected),'Cache-Control':'max-age=3600'}
      })).catch(()=>{}));
    }
    return response;
  } catch {
    return json(request,503,{ok:false});
  }
}

module.exports = {handleArchive};

