'use strict';

const {unpackMediaJson}=require('./catalog-media-storage.cjs');
const {safeMediaReferences}=require('./core.js');
const {count,queryEntries,updateEntry}=require('./auction-archive-segments.cjs');
const {
  MAX_ENTRIES,MAX_ARCHIVE_BYTES,MAX_PHOTO_BYTES,GALLERY_OBJECT,VIN,LOT,LEASE_MS,minimumYear,baseKey,restorableKeys,
  getIndex,saveIndex,locked,purgeObjects,hash
}=require('./auction-archive-state.cjs');

const platforms=['copart','iaai'];
const MAX_FEED=8_000_000;
const MAX_WORK=38;
const MAX_PUBLISHED_PER_CYCLE=10;
const MAX_GALLERY_PHOTOS=22;
const waitExpiry=2*86_400_000;
const deadlineMs=110_000;
const eventStatuses=new Map([['lot.sold','sold'],['lot.not_sold','not_sold'],['auction.ended','ended_unknown']]);

function parseEvent(value,generation) {
  const {vehicle,after}=value;
  const status=eventStatuses.get(value.event);
  if (!status || value.terminal!==true || !platforms.includes(vehicle?.platform) ||
      !VIN.test(vehicle?.vin||'') || !LOT.test(String(vehicle?.lot_number||'')) ||
      !Number.isSafeInteger(value.sequence) || value.sequence<generation.first_sequence ||
      value.sequence>generation.last_sequence || !Number.isFinite(Date.parse(value.recorded_at))) return null;
  if (status==='sold' && (value.reason!=='source_outcome'||![true,1,'1'].includes(after?.['auction.lot_sold'])||
      String(after?.['auction.last_sold_status']||'').trim().toLowerCase()!=='sold')) return null;
  if (status==='not_sold' && value.reason!=='source_outcome') return null;
  const amount=after?.['pricing.last_sold_price_usd'];
  const saleCents=status==='sold'&&typeof amount==='number'&&Number.isFinite(amount)&&amount>0&&amount<1e7
    ? Math.round(amount*100):null;
  const recordedAt=new Date(value.recorded_at).toISOString();
  const day=after?.['auction.last_sold_day'];
  return {platform:vehicle.platform,lot:String(vehicle.lot_number),vin:vehicle.vin,recordedAt,status,saleCents,
    sequence:value.sequence,generation:generation.generation_id,
    eventDay:typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)?day:recordedAt.slice(0,10)};
}

function jpeg(bytes) {
  return bytes.length>=32 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 && bytes.at(-2)===255 && bytes.at(-1)===217;
}
async function readCapped(stream,cap) {
  const reader=stream.getReader();
  const chunks=[];
  let length=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      length+=value.length;
      if(length>cap) throw Error('archive_payload_limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(()=>{}); }
  const bytes=new Uint8Array(length);
  let at=0;
  for(const chunk of chunks) {bytes.set(chunk,at);at+=chunk.length;}
  return bytes;
}

async function publishedEvents(bucket,generation) {
  const key=generation.raw_key;
  if(typeof key!=='string'||!key||!Number.isSafeInteger(generation.compressed_bytes)||generation.compressed_bytes>MAX_FEED)
    throw Error('archive_feed_limit');
  const file=await bucket.get(key);
  if(!file||file.size!==generation.compressed_bytes) throw Error('archive_feed_not_found');
  const compressed=await readCapped(file.body,MAX_FEED);
  if(await hash(compressed)!==generation.sha256) throw Error('archive_feed_checksum');
  const events=[];
  const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream()).getReader();
  let tail='', total=0;
  function append(line) {
    if(!line.trim()) return;
    const event=parseEvent(JSON.parse(line),generation);
    if(event) events.push(event);
  }
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.length;
      if(total>52_000_000) throw Error('archive_feed_decoded_limit');
      const lines=(tail+value).split('\n');
      tail=lines.pop();
      if(tail.length>1_000_000) throw Error('archive_feed_record_limit');
      for(const line of lines) append(line);
    }
    append(tail);
  } finally { await reader.cancel().catch(()=>{}); }
  return events.sort((a,b)=>a.sequence-b.sequence);
}

function photoUrl(platform,candidate) {
  const url=new URL(candidate);
  if(url.username||url.password||url.hash) return null;
  if(platform==='copart'&&url.origin==='https://cs.copart.com'&&
      url.pathname.startsWith('/v1/AUTH_svc.pdoc00001/')&&!url.search) return url;
  if(platform!=='iaai'||url.origin!=='https://vis.iaai.com'||url.pathname!=='/resizer'||
      [...url.searchParams.keys()].some(k=>!['imageKeys','width','height'].includes(k))||
      url.searchParams.getAll('imageKeys').length!==1||!/^[A-Za-z0-9~_-]{1,180}$/.test(url.searchParams.get('imageKeys')||'')) return null;
  url.searchParams.set('width','1280');
  url.searchParams.set('height','960');
  return url;
}

async function sourcePhoto(url,fetchImage,stats) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6500);
  try {
    const r=await fetchImage(url.href,{redirect:'manual',headers:{Accept:'image/jpeg'},signal:controller.signal});
    stats['http_'+r.status]=(stats['http_'+r.status]||0)+1;
    if(!r.ok||!/^image\/jpeg\b/i.test(r.headers.get('Content-Type')||'')||
        Number(r.headers.get('Content-Length'))>MAX_PHOTO_BYTES) {
      await r.body?.cancel();
      return null;
    }
    const bytes=await readCapped(r.body,MAX_PHOTO_BYTES);
    if(!jpeg(bytes)) {stats.invalidJpeg=(stats.invalidJpeg||0)+1;return null;}
    return bytes;
  } catch(error) {
    const kind=controller.signal.aborted?'timeout':error?.message==='Illegal invocation'?'invocation':/^archive_[a-z_]+$/.test(error?.message)?error.message:
      error?.name==='TimeoutError'?'timeout':'fetch_error';
    stats[kind]=(stats[kind]||0)+1;
    return null;
  } finally { clearTimeout(timer); }
}

async function gallery(row,fetchImage,stats) {
  const decode=(value,kind)=>safeMediaReferences(JSON.parse(unpackMediaJson(value)||'[]'),kind);
  const references=decode(row.media_urls_json,'image');
  const urls=references.map(ref=>photoUrl(row.platform,ref)).filter(Boolean);
  if(urls.length!==references.length)stats.unusableUrl=(stats.unusableUrl||0)+references.length-urls.length;
  return (await Promise.all(urls.slice(0,MAX_GALLERY_PHOTOS).map(async url=>{
    const image=await sourcePhoto(url,fetchImage,stats);
    if(image||row.platform!=='iaai') return image;
    url.searchParams.set('width','800');
    url.searchParams.set('height','600');
    return sourcePhoto(url,fetchImage,stats);
  }))).filter(Boolean);
}

const listingSql=`SELECT platform,lot,vin_normalized,year,vehicle_title,media_urls_json,first_seen_at,last_seen_at
  FROM auction_listings INDEXED BY idx_listings_lot_recent
  WHERE platform=? AND lot=? AND vin_normalized=? AND source_listing_id=? AND auction_state='ended'
  LIMIT 3`;
const nextSql=`SELECT generation_id,raw_key,compressed_bytes,sha256,first_sequence,last_sequence
  FROM server_feed_generations WHERE status='complete' AND generation_id>=? ORDER BY generation_id ASC LIMIT 1`;
const legacyListingSql=`SELECT l.platform,l.lot,l.vin_normalized,l.year,l.vehicle_title,l.media_urls_json,l.first_seen_at,l.last_seen_at
  FROM auction_listings l INDEXED BY idx_listings_lot_recent JOIN vehicle_sources s ON l.source_key=s.source_key
  WHERE l.platform=? AND l.lot=? AND l.vin_normalized=? AND l.source_listing_id=? AND l.identity_state='resolved'
  AND s.provider='apibara' AND s.platform=l.platform AND s.identity_state='resolved'
  LIMIT 2`;

async function findRow(db,event) {
  const rows=(await db.prepare(listingSql).bind(event.platform,event.lot,event.vin,event.lot).all()).results;
  const recorded=Date.parse(event.recordedAt);
  const viable=rows.filter(row=>Date.parse(row.first_seen_at)<=recorded &&
    Math.abs(Date.parse(row.last_seen_at)-recorded)<45*86_400_000);
  return viable.length===1?viable[0]:null;
}

async function findEarlierListing(db,event) {
  const rows=(await db.prepare(legacyListingSql).bind(event.platform,event.lot,event.vin,event.lot).all()).results;
  if(rows.length!==1)return null;
  const [row]=rows;
  const recorded=Date.parse(event.recordedAt), first=Date.parse(row.first_seen_at), last=Date.parse(row.last_seen_at);
  return first<=last&&last<=recorded&&recorded-last<45*86_400_000?row:null;
}

function earliestPending(index) {
  if(index.offset) return {generation:index.generation,offset:index.offset};
  return {generation:index.generation+1,offset:0};
}

async function runArchive(env,{
  now=()=>Date.now(),fetchImage=(input,init)=>globalThis.fetch(input,init),maximumBytes=MAX_ARCHIVE_BYTES
}={}) {
  const target=env.REXBID_AUCTION_ARCHIVE,source=env.REXBID_ARCHIVE_FEED,db=env.REXBID_ARCHIVE_CATALOG;
  if(!target||!source||!db) throw Error('archive_bindings');
  if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0||maximumBytes>MAX_ARCHIVE_BYTES)throw Error('archive_storage_config');
  const started=now(), date=new Date(started);
  let {index,etag}=await getIndex(target);
  if(locked(index,started)) return {status:'locked'};
  const atCapacity=count(index)>=MAX_ENTRIES||index.allocatedBytes>=maximumBytes;
  if(atCapacity&&!index.deletions.length&&!index.staged?.length)
    return {status:'archive_capacity',entries:count(index),allocatedBytes:index.allocatedBytes};
  const cursor=earliestPending(index);
  const generation=atCapacity?null:await db.prepare(nextSql).bind(cursor.generation).first();
  const waiting=Array.isArray(index.waiting)?index.waiting.filter(item=>started-Date.parse(item.recordedAt)<waitExpiry):[];
  if(!generation&&!waiting.length&&!index.deletions.length&&!index.staged?.length) return {status:'idle',through:index.generation};
  if(!atCapacity && index.offset && generation?.generation_id!==cursor.generation) throw Error('archive_unfinished_generation_missing');
  const lock={id:crypto.randomUUID(),until:started+LEASE_MS};
  index={...index,lock,waiting};
  etag=await saveIndex(target,index,etag);
  let saved=0,retried=0,ignored=0;
  let legacy=env.REXBID_ARCHIVE_LEGACY;
  const photoDiagnostics={};
  try {
    if(index.staged?.length){
      index.deletions=[...new Set([...index.deletions,...index.staged])];
      delete index.staged;
      etag=await saveIndex(target,index,etag);
    }
    ({index,etag}=await purgeObjects(target,index,etag));
    const events=generation?(await publishedEvents(source,generation)).filter(x=>x.sequence>cursor.offset):[];
    const queue=[...(atCapacity?[]:waiting.slice(0,2)).map(event=>({event,retry:true})),...events.map(event=>({event,retry:false}))];
    let processed=0, throttle=false;
    for(const {event,retry} of queue){
      if(processed>=MAX_WORK||saved>=MAX_PUBLISHED_PER_CYCLE||now()-started>deadlineMs){throttle=true;break;}
      processed++;
      const sourcePosition={generation:index.generation,offset:index.offset};
      if(retry) index.waiting=index.waiting.filter(x=>x.sequence!==event.sequence);
      else {index.generation=event.generation;index.offset=event.sequence;}
      if(index.hidden.includes(await hash(event.vin))){ignored++;continue;}
      const existing=(await queryEntries(target,index,{q:event.vin})).find(entry=>entry.platform===event.platform&&entry.lot===event.lot&&entry.vin===event.vin&&
        (entry.eventDay||entry.recordedAt.slice(0,10))===event.eventDay);
      if(existing) {
        if((!existing.status||existing.status==='ended_unknown')&&event.status!=='ended_unknown'&&existing.saleCents===null){
          existing.status=event.status;
          existing.saleCents=event.saleCents;
          await updateEntry(target,index,existing);
        }
        ignored++;
        continue;
      }
      let row=await findRow(db,event);
      if(row&&(!Number.isSafeInteger(row.year)||row.year<minimumYear(date)||row.year>=2100)){
        ignored++;
        continue;
      }
      if(!row) photoDiagnostics.missingListing=(photoDiagnostics.missingListing||0)+1;
      let images=row?await gallery(row,fetchImage,photoDiagnostics):[];
      if(images.length<2&&legacy){
        const older=await findEarlierListing(legacy,event).catch(()=>{
          legacy=null;
          photoDiagnostics.earlierCatalogReadFailed=1;
          return null;
        });
        if(older&&Number.isSafeInteger(older.year)&&older.year>=minimumYear(date)&&older.year<2100&&(!row||row.year===older.year)){
          const restored=await gallery(older,fetchImage,photoDiagnostics);
          if(restored.length>=2){
            row??=older;
            images=restored;
            photoDiagnostics.earlierCatalog=(photoDiagnostics.earlierCatalog||0)+1;
          }
        }
      }
      if(images.length<2) {
        if(index.waiting.length<120&&started-Date.parse(event.recordedAt)<waitExpiry) index.waiting.push(event);
        retried++;
        continue;
      }
      const photoBytes=images.map(image=>image.length);
      const bytes=photoBytes.reduce((total,size)=>total+size,0);
      if(count(index)>=MAX_ENTRIES||index.allocatedBytes+bytes+2048>maximumBytes) {
        // Storage deferral must never acknowledge an unpublished event. The
        // waiting queue may already be full; leave the durable source cursor
        // BEFORE this event so it is reconsidered once space is available.
        if(retry) index.waiting.push(event);
        else {index.generation=sourcePosition.generation;index.offset=sourcePosition.offset;}
        throttle=true;
        break;
      }
      // Preserve byte reservations if a run ends after an object write.
      const entry={...event,year:row.year,title:String(row.vehicle_title||'Pojazd aukcyjny').slice(0,160),
        visible:true,photos:images.map((_,i)=>String(i+1).padStart(2,'0')+'.jpg'),photoBytes};
      const prefix=baseKey(entry);
      index.allocatedBytes+=bytes+2048;
      const staged=restorableKeys(entry);
      etag=await saveIndex(target,{...index,generation:cursor.generation-(!cursor.offset?1:0),offset:cursor.offset,
        waiting,staged},etag);
      const packed=new Uint8Array(bytes);
      let position=0;
      for(const image of images) {
        packed.set(image,position);
        position+=image.length;
      }
      await target.put(prefix+'/'+GALLERY_OBJECT,packed,{httpMetadata:{contentType:'application/octet-stream'}});
      await target.put(prefix+'/manifest.json',JSON.stringify(entry),{httpMetadata:{contentType:'application/json'}});
      index.entries.push(entry);
      saved++;
    }
    if(generation&&!throttle) {index.offset=0;index.generation=generation.generation_id;}
    delete index.lock;
    etag=await saveIndex(target,index,etag);
    return {status:atCapacity?'archive_capacity':throttle?'partial':'complete',generation:index.generation,offset:index.offset,
      saved,waiting:index.waiting.length,ignored,retried,photoDiagnostics,entries:count(index),allocatedBytes:index.allocatedBytes};
  } catch(error) {
    const current=await getIndex(target);
    if(current.index.lock?.id===lock.id) {
      delete current.index.lock;
      await saveIndex(target,current.index,current.etag).catch(()=>{});
    }
    throw error;
  }
}

module.exports={runArchive,parseEvent,photoUrl};

