'use strict';

const INDEX_KEY = 'v1/public/index.json';
const MAX_ENTRIES = 500_000;
const MAX_INDEX_BYTES = 8_000_000;
const {ACCOUNT_BYTES,OTHER_BUCKET_RESERVE,FEED_WORK_RESERVE}=require('./auction-archive-budget.cjs');
// Owner approved up to USD5/month for R2 storage on 18 November 2026.
// 300GB costs USD4.35 at constant occupancy; operations/tax are separate.
const MAX_ARCHIVE_BYTES = ACCOUNT_BYTES-OTHER_BUCKET_RESERVE-FEED_WORK_RESERVE;
const MAX_PHOTO_BYTES = 480_000;
const GALLERY_OBJECT = 'gallery.bin';
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const LOT = /^\d{5,14}$/;
const FIRST_GENERATION = 17229;
const LEASE_MS = 180_000;

function minimumYear(now) {
  return Math.max(2018, Number(new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'Europe/Warsaw'}).format(now))-8);
}
function baseKey(item) {
  return 'v1/auctions/'+item.platform+'/'+item.lot+'/'+item.sequence;
}
function restorableKeys(item) {
  const prefix=baseKey(item);
  const photos=item.photoBytes ? [GALLERY_OBJECT] : item.photos;
  return [...photos.map(name=>prefix+'/'+name),prefix+'/manifest.json'];
}
function parseIndex(value) {
  if (!value || ![1,2].includes(value.version) || !Array.isArray(value.entries) || value.entries.length>MAX_ENTRIES ||
      (value.hidden && !Array.isArray(value.hidden)) || (value.deletions && !Array.isArray(value.deletions))) throw Error('archive_index_invalid');
  const index={...value,segments:value.segments||[],hidden:value.hidden||[],deletions:value.deletions||[],
    generation:value.generation??FIRST_GENERATION,offset:value.offset??0,
    allocatedBytes:value.allocatedBytes??16_000_000};
  require('./auction-archive-segments.cjs').validateSegments(index);
  return index;
}
async function getIndex(bucket) {
  const object=await bucket.get(INDEX_KEY);
  if (!object || object.size>MAX_INDEX_BYTES || !object.etag) throw Error('archive_index_unavailable');
  return {index:parseIndex(await object.json()),etag:object.etag};
}
async function saveIndex(bucket,index,etag) {
  const {prepareSave,commitSave}=require('./auction-archive-segments.cjs');
  const prepared=await prepareSave(bucket,index,etag);
  const value=JSON.stringify(prepared.root);
  if (new TextEncoder().encode(value).length>MAX_INDEX_BYTES) throw Error('archive_index_limit');
  const saved=await bucket.put(INDEX_KEY,value,{onlyIf:{etagMatches:etag},
    httpMetadata:{contentType:'application/json'}});
  if (!saved) throw Error('archive_index_conflict');
  commitSave(index,prepared.root);
  return saved.etag;
}
async function hash(value) {
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function locked(index,now=Date.now()) {
  return Boolean(index.lock && index.lock.until>now);
}
async function purgeObjects(bucket, index, etag) {
  if (!index.deletions.length) return {index,etag};
  const batch=index.deletions.slice(0,100);
  await bucket.delete(batch);
  const next={...index,deletions:index.deletions.slice(batch.length)};
  return {index:next,etag:await saveIndex(bucket,next,etag)};
}
module.exports={INDEX_KEY,MAX_ENTRIES,MAX_INDEX_BYTES,MAX_ARCHIVE_BYTES,MAX_PHOTO_BYTES,GALLERY_OBJECT,VIN,LOT,LEASE_MS,minimumYear,baseKey,parseIndex,
  restorableKeys,getIndex,saveIndex,locked,purgeObjects,hash};

