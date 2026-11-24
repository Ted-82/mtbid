'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{gzipSync}=require('node:zlib');
const {ingestLocalFeed}=require('../scripts/apibara-feed.cjs');
const {buildFeedChangeIndex}=require('../scripts/feed-change-index.cjs');
const {readChangePages}=require('../scripts/feed-change-pages.cjs');
const {validateReceipt}=require('../sync/feed-change-import.cjs');
const event=(sequence,platform,lot)=>({sequence,event_id:`chg_${sequence}`,event:'bid.changed',terminal:false,
  vehicle:{platform,lot_number:lot,vin:'SALZP2FX8PH185647'},changed_fields:['pricing.current_bid_usd'],before:{},after:{'pricing.current_bid_usd':sequence},recorded_at:'2026-10-28T12:00:00Z'});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rexbid-change-pages-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'download.gz'),events=[event(1,'iaai','100'),event(2,'copart','200'),event(3,'iaai','100'),event(4,'copart','50'),event(5,'copart','200')];
 events[4].vehicle.vin='3\u001a6TRVDG1KE508499';
 await fs.writeFile(file,gzipSync(events.map(JSON.stringify).join('\n')));
 const directory=path.join(root,'files'),accepted=await ingestLocalFeed({directory,file,mode:'incremental',invalidVinPolicy:'quarantine'});
 const outputDirectory=path.join(root,'indexes'),manifest=await buildFeedChangeIndex({directory,outputDirectory,sources:[{generationId:1,manifest:accepted}]});
 return {directory:outputDirectory,manifest};
}
test('complete vehicle groups stay ordered and keep exact event/quarantine resume counters',async t=>{
 const options=await fixture(t),pages=[];for await(const page of readChangePages({...options,maxGroups:1}))pages.push(page);
 assert.equal(pages.length,3);assert.deepEqual(pages.map(p=>p.groups[0].platform+':'+p.groups[0].lot),['copart:200','copart:50','iaai:100']);
 assert.deepEqual(pages.map(p=>p.eventOffset),[0,2,3]);assert.deepEqual(pages.map(p=>p.quarantineOffset),[0,1,1]);
 assert.deepEqual(pages[0].groups[0].events.map(e=>e.sequence),[2,5]);assert.deepEqual(pages[0].groups[0].quarantinedSequences,[5]);
 for(const page of pages)validateReceipt(page,Date.now());
 const resumed=[];for await(const page of readChangePages({...options,startOffset:1,maxGroups:1}))resumed.push(page);
 assert.deepEqual(resumed,pages.slice(1));
 let count=0;for await(const page of readChangePages({...options,startOffset:3})){count++;}assert.equal(count,0);
});
test('changed index is rejected before yielding a receipt',async t=>{
 const options=await fixture(t);await fs.appendFile(path.join(options.directory,options.manifest.identity,'events.sqlite'),'corrupt');
 let count=0;await assert.rejects(async()=>{for await(const p of readChangePages(options)){count++;}},/FEED_CHANGE_INDEX_CHANGED/);assert.equal(count,0);
});
test('incorrect total groups are rejected before the first receipt even when stopping early or resuming',async t=>{
 const options=await fixture(t);
 for(const uniqueLots of [options.manifest.uniqueLots-1,options.manifest.uniqueLots+1]){
  for(const startOffset of [0,1]){
   let yielded=0;
   await assert.rejects(async()=>{
    for await(const page of readChangePages({...options,manifest:{...options.manifest,uniqueLots},startOffset,maxGroups:1})){
     yielded++;break;
    }
   },/FEED_CHANGE_INDEX_COUNT_INVALID/);
   assert.equal(yielded,0);
  }
 }
});
test('a stopped reader closes its SQLite handles and can safely resume',async t=>{
 const options=await fixture(t),reader=readChangePages({...options,maxGroups:1});await reader.next();await reader.return();
 const p=path.join(options.directory,options.manifest.identity,'events.sqlite');await fs.rename(p,p+'.check');await fs.rename(p+'.check',p);
 const resumed=[];for await(const page of readChangePages({...options,startOffset:1}))resumed.push(page);
 assert.equal(resumed.length,1);assert.equal(resumed[0].groups.length,2);assert.equal(resumed[0].eventOffset,2);
});
