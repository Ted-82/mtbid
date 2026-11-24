'use strict';
class MemoryR2{
 constructor(){this.objects=new Map();this.versions=new Map();this.calls=[];this.beforePut=null;this.afterPut=null;this.afterComplete=null;}
 async get(key,options){this.calls.push(['get',key]);const bytes=this.objects.get(key);if(!bytes)return null;const full=Buffer.from(bytes),range=options?.range;const data=range?full.subarray(range.offset,range.offset+range.length):full;let sent=false;return{
  ...(range?{range:{offset:range.offset,length:data.length}}:{}),size:full.length,etag:String(this.versions.get(key)||0),text:async()=>data.toString('utf8'),body:new ReadableStream({pull(controller){if(sent){controller.close();return;}sent=true;controller.enqueue(Uint8Array.from(data));}})};}
 async put(key,bytes,options){this.calls.push(['put',key]);await this.beforePut?.(key,bytes,options);
  const present=this.objects.has(key),etag=String(this.versions.get(key)||0),condition=options?.onlyIf;
  if(condition?.etagDoesNotMatch==='*'&&present||condition?.etagMatches!==undefined&&(!present||condition.etagMatches!==etag))return null;
  this.objects.set(key,Buffer.from(bytes));this.versions.set(key,(this.versions.get(key)||0)+1);await this.afterPut?.(key);
  return{key,size:this.objects.get(key).length,etag:String(this.versions.get(key))};}
 async delete(key){this.calls.push(['delete',key]);for(const item of Array.isArray(key)?key:[key]){this.objects.delete(item);this.versions.delete(item);}}
 async list({prefix='',limit=1000,cursor}={}){this.calls.push(['list',prefix]);const keys=[...this.objects.keys()].filter(key=>key.startsWith(prefix)).sort(),offset=cursor?Number(cursor):0;
  const objects=keys.slice(offset,offset+limit).map(key=>({key,size:this.objects.get(key).length}));const truncated=offset+limit<keys.length;
  return{objects,truncated,...(truncated?{cursor:String(offset+limit)}:{})};}
 async createMultipartUpload(key){this.calls.push(['multipart',key]);const parts=new Map(),self=this;
  return{async uploadPart(number,bytes){self.calls.push(['part',key]);parts.set(number,Buffer.from(bytes));return{partNumber:number,etag:String(number)};},
   async complete(items){await self.put(key,Buffer.concat(items.map(item=>parts.get(item.partNumber))));await self.afterComplete?.(key);},
   async abort(){self.calls.push(['abort',key]);parts.clear();}};}
}
module.exports={MemoryR2};