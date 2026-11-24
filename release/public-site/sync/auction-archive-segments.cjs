'use strict';
// Immutable pages are written before one conditional root update. A failed
// update can leave an unreferenced page, never a partly published catalogue.
const PAGE_SIZE=256,MAX_SEGMENTS=2048,MAX_PAGE_BYTES=1_000_000;
const PREFIX='v2/index/pages/';
const validInt=n=>Number.isSafeInteger(n)&&n>=0;
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
function positions(value){let a=2166136261,b=5381;for(const c of value){a=Math.imul(a^c.charCodeAt(0),16777619)>>>0;b=(Math.imul(b,33)^c.charCodeAt(0))>>>0;}b|=1;return Array.from({length:6},(_,i)=>(a+Math.imul(i,b)>>>0)%8192);}
function bloom(entries){const bytes=new Uint8Array(1024);for(const e of entries)for(const key of ['v:'+e.vin,'l:'+e.lot])for(const bit of positions(key))bytes[bit>>3]|=1<<(bit&7);return btoa(String.fromCharCode(...bytes));}
function mayContain(page,q){if(!q)return true;const bytes=Uint8Array.from(atob(page.bloom),c=>c.charCodeAt(0));return positions((q.length===17?'v:':'l:')+q).every(bit=>bytes[bit>>3]&(1<<(bit&7)));}
function count(index){return index.entries.length+(index.segments||[]).reduce((s,p)=>s+p.count,0);}
function validateSegments(index){
 const pages=index.segments||[];
 if(!Array.isArray(pages)||pages.length>MAX_SEGMENTS||new Set(pages.map(p=>p.key)).size!==pages.length)throw Error('archive_segments_invalid');
 for(const p of pages){if(!p||!new RegExp('^'+PREFIX+'[a-f0-9]{64}\\.json$').test(p.key)||!validInt(p.count)||!p.count||p.count>PAGE_SIZE||!validInt(p.min)||!validInt(p.max)||p.min>p.max||!validInt(p.bytes)||p.bytes>MAX_PAGE_BYTES||typeof p.bloom!=='string'||!/^[A-Za-z0-9+/]{1366}==$/.test(p.bloom))throw Error('archive_segments_invalid');}
 if(index.version===1&&pages.length||count(index)>500_000)throw Error('archive_segments_invalid');
}
async function putPage(bucket,entries){
 const ordered=[...entries].sort((a,b)=>b.sequence-a.sequence),text=JSON.stringify({version:1,entries:ordered}),bytes=new TextEncoder().encode(text).length;
 if(!ordered.length||ordered.length>PAGE_SIZE||bytes>MAX_PAGE_BYTES)throw Error('archive_page_limit');
 const key=PREFIX+await hash(text)+'.json';
 await bucket.put(key,text,{httpMetadata:{contentType:'application/json'}});
 return {key,count:ordered.length,min:Math.min(...ordered.map(x=>x.sequence)),max:Math.max(...ordered.map(x=>x.sequence)),bytes,bloom:bloom(ordered)};
}
async function readPage(bucket,page){
 const o=await bucket.get(page.key);if(!o||o.size!==page.bytes)throw Error('archive_page_missing');
 const value=await o.json(),text=JSON.stringify(value);
 if(value.version!==1||!Array.isArray(value.entries)||value.entries.length!==page.count||PREFIX+await hash(text)+'.json'!==page.key||value.entries.some(e=>!validInt(e.sequence)||e.sequence<page.min||e.sequence>page.max)||bloom(value.entries)!==page.bloom)throw Error('archive_page_invalid');
 return value.entries;
}
async function prepareSave(bucket,index,etag){
 const entries=[...index.entries].sort((a,b)=>a.sequence-b.sequence),segments=[...(index.segments||[])];
 if(entries.length>PAGE_SIZE&&index.version===1&&!segments.length){
  // Preserve the exact last v1 root remotely before the first format switch.
  const original=await bucket.get('v1/public/index.json');
  if(!original||original.etag!==etag)throw Error('archive_index_conflict');
  await bucket.put('v2/private/pre-shard/'+await hash(etag)+'.json',JSON.stringify(await original.json()),{httpMetadata:{contentType:'application/json'}});
 }
 while(entries.length>PAGE_SIZE){segments.push(await putPage(bucket,entries.splice(0,PAGE_SIZE)));}
 if(segments.length>MAX_SEGMENTS)throw Error('archive_segments_limit');
 const root={...index,entries,segments};root.version=segments.length||index.version===2?2:1;
 if(root.version===1)delete root.segments;
 validateSegments(root);
 return {root};
}
function commitSave(index,root){
 // Preserve array references shared by the intake's staged-write checkpoint.
 index.entries.splice(0,index.entries.length,...root.entries);
 index.segments??=[];index.segments.splice(0,index.segments.length,...(root.segments||[]));index.version=root.version;
}
async function queryEntries(bucket,index,{q='',before=null,limit=Infinity,filter=()=>true}={}){
 const accepts=e=>(!q||e.vin===q||e.lot===q)&&(!before||e.sequence<Number(before))&&filter(e);
 let found=index.entries.filter(accepts);
 const pages=(index.segments||[]).filter(p=>(!before||p.min<Number(before))&&mayContain(p,q)).sort((a,b)=>b.max-a.max);
 for(const page of pages){
  found.sort((a,b)=>b.sequence-a.sequence);
  if(found.length>=limit&&page.max<found[limit-1].sequence)break;
  found.push(...(await readPage(bucket,page)).filter(accepts));
 }
 const keys=new Set();for(const e of found){const key=e.platform+'/'+e.lot+'/'+e.sequence;if(keys.has(key))throw Error('archive_duplicate');keys.add(key);}
 return found.sort((a,b)=>b.sequence-a.sequence).slice(0,limit);
}
async function withoutVin(bucket,index,vin){
 const segments=[];
 for(const page of index.segments||[]){if(!mayContain(page,vin)){segments.push(page);continue;}const entries=await readPage(bucket,page),remaining=entries.filter(e=>e.vin!==vin);if(remaining.length===entries.length)segments.push(page);else if(remaining.length)segments.push(await putPage(bucket,remaining));}
 return {...index,entries:index.entries.filter(e=>e.vin!==vin),segments};
}
async function updateEntry(bucket,index,entry){
 if(index.entries.some(e=>e===entry))return;
 for(let i=0;i<(index.segments||[]).length;i++){
  const p=index.segments[i];if(entry.sequence<p.min||entry.sequence>p.max||!mayContain(p,entry.vin))continue;
  const entries=await readPage(bucket,p),at=entries.findIndex(e=>e.platform===entry.platform&&e.lot===entry.lot&&e.sequence===entry.sequence);
  if(at<0)continue;entries[at]=entry;index.segments[i]=await putPage(bucket,entries);return;
 }
 throw Error('archive_entry_missing');
}
module.exports={PAGE_SIZE,MAX_PAGE_BYTES,validateSegments,prepareSave,commitSave,readPage,queryEntries,withoutVin,updateEntry,count,mayContain};
