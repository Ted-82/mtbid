'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {downloadLatest,validateFeedUrl,PART_BYTES}=require('../sync/feed-download.cjs');
const URL='https://apibara.tech/data-feeds/test-token/latest',now=()=>Date.parse('2026-10-29T12:00:00Z');
function fixture(bytes=new Uint8Array([31,139,1,2]),changes={}){
 const calls={parts:[],aborted:0,complete:0};
 const bucket={async createMultipartUpload(key,metadata){calls.key=key;calls.metadata=metadata;return {
  async uploadPart(part,data){calls.parts.push(new Uint8Array(data));return {partNumber:part,etag:String(part)};},
  async complete(parts){calls.complete++;calls.receipts=parts;},async abort(){calls.aborted++;}};}};
 const headers={'content-type':'application/gzip','content-disposition':'attachment; filename=apibara-feed-20-5331.jsonl.gz','content-length':String(bytes.length),...changes};
 const fetchImpl=async(u,options)=>{calls.url=u;calls.options=options;return new Response(bytes,{headers});};
 return {bucket,fetchImpl,calls};
}
test('streamed multipart intake verifies length/gzip/hash without exposing private URL',async()=>{
 const bytes=new Uint8Array(PART_BYTES+7);bytes.set([31,139]);const f=fixture(bytes);
 const r=await downloadLatest({...f,url:URL,now});assert.equal(r.generationId,5331);assert.equal(r.feedId,20);
 assert.equal(r.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(r.compressedBytes,bytes.length);
 assert.equal(f.calls.parts.length,2);assert.equal(f.calls.complete,1);assert.equal(f.calls.aborted,0);
 assert.equal(f.calls.options.redirect,'manual');assert.ok(!JSON.stringify(r).includes('test-token'));
});
test('rejects credential/query/redirect endpoints before any storage',async()=>{
 for(const u of ['http://apibara.tech/data-feeds/a/latest',URL+'?x=1','https://evil.test/data-feeds/a/latest','https://user:pass@apibara.tech/data-feeds/a/latest'])assert.throws(()=>validateFeedUrl(u));
 const f=fixture();f.fetchImpl=async()=>new Response('',{status:302,headers:{location:'https://evil.test/'}});
 await assert.rejects(()=>downloadLatest({...f,url:URL,now}),/FEED_DOWNLOAD_HTTP/);assert.equal(f.calls.key,undefined);
});
test('rejects invalid/truncated/oversized content and aborts uncommitted upload',async()=>{
 const bad=fixture(new Uint8Array([1,2,3]));await assert.rejects(()=>downloadLatest({...bad,url:URL,now}),/TRUNCATED/);assert.equal(bad.calls.aborted,1);assert.equal(bad.calls.complete,0);
 const short=fixture(new Uint8Array([31,139]),{'content-length':'10'});await assert.rejects(()=>downloadLatest({...short,url:URL,now}),/TRUNCATED/);assert.equal(short.calls.aborted,1);
 const large=fixture(undefined,{'content-length':String(129*1024*1024)});await assert.rejects(()=>downloadLatest({...large,url:URL,now}),/HEADERS/);assert.equal(large.calls.key,undefined);
 const interrupted=fixture(undefined,{'content-length':'93675625'});await assert.rejects(()=>downloadLatest({...interrupted,url:URL,now}),/TRUNCATED/);assert.equal(interrupted.calls.aborted,1);
});
test('unknown storage errors do not disclose URLs or credentials',async()=>{
 const f=fixture();f.bucket.createMultipartUpload=async()=>({uploadPart:async()=>{throw Error('private-key-test-token');},abort:async()=>{f.calls.aborted++;}});
 await assert.rejects(()=>downloadLatest({...f,url:URL,now}),error=>error.message==='FEED_DOWNLOAD_STORAGE');assert.equal(f.calls.aborted,1);
});
