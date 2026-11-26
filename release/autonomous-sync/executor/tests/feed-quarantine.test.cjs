'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {gzipSync}=require('node:zlib');
const {ingestLocalFeed}=require('../scripts/apibara-feed.cjs');
const {parseChangesResponse}=require('../providers/apibara.js');
const event=(sequence=8)=>({sequence,event_id:`chg_${sequence}`,event:'lot.created',terminal:false,reason:null,
 vehicle:{platform:'copart',lot_number:'75041876',vin:'3\u001a6TRVDG1KE508499'},changed_fields:['lot.created'],before:[],
 after:{'vehicle.vin':'3\u001a6TRVDG1KE508499','vehicle.make':'RAM'},recorded_at:'2026-10-28T16:39:23Z'});
async function input(t,events){const root=await fs.mkdtemp(path.join(os.tmpdir(),'rexbid-quarantine-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'download.gz'),bytes=gzipSync(events.map(JSON.stringify).join('\n'));await fs.writeFile(file,bytes);return{file,directory:path.join(root,'accepted'),bytes,mode:'incremental'};}
test('malformed VIN remains rejected by ordinary intake and provider parser',async t=>{
 const options=await input(t,[event()]);await assert.rejects(ingestLocalFeed(options),{code:'FEED_EVENT_INVALID'});
 assert.throws(()=>parseChangesResponse({ok:true,data:[event()],meta:{after:0,next_cursor:8,has_more:false,count:1,ordering:'sequence_asc',schema_version:'test',retention_days:14}},{after:0,limit:1}));
});
test('explicit quarantine accounts for every event and preserves original bytes',async t=>{
 const valid={...event(9),vehicle:{...event().vehicle,vin:'SALZP2FX8PH185647'},before:{},after:{}};
 const options=await input(t,[event(),valid]);const manifest=await ingestLocalFeed({...options,invalidVinPolicy:'quarantine'});
 assert.equal(manifest.records,2);assert.equal(manifest.contractValidatedRecords,1);assert.equal(manifest.quarantinedEvents.length,1);
 assert.equal(manifest.quarantinedEvents[0].sequence,8);assert.equal(manifest.quarantinedEvents[0].lotNumber,'75041876');
 assert.match(manifest.quarantinedEvents[0].rawLineSha256,/^[a-f0-9]{64}$/);
 assert.equal(manifest.databaseApplied,false);assert.equal(manifest.continuityVerified,false);
 assert.deepEqual(await fs.readFile(path.join(options.directory,manifest.file)),options.bytes);
 assert.deepEqual(await ingestLocalFeed({...options,invalidVinPolicy:'quarantine'}),manifest);
 await assert.rejects(ingestLocalFeed(options),{code:'FEED_EVENT_INVALID'});
});
test('quarantine cannot conceal other invalid fields, duplicate sequence or identities',async t=>{
 for(const events of [[{...event(),terminal:true}],[{...event(),recorded_at:'wrong'}],[{...event(),vehicle:{...event().vehicle,platform:'other'}}],
  [{...event(),vehicle:{...event().vehicle,lot_number:'bad'}}],[event(),event()], [{...event(),after:[{}]}]]){
  const options=await input(t,events);await assert.rejects(ingestLocalFeed({...options,invalidVinPolicy:'quarantine'}));
  assert.deepEqual(await fs.readdir(options.directory),[]);
 }
});
test('quarantine is limited and never applies to snapshots',async t=>{
 const options=await input(t,Array.from({length:101},(_,i)=>event(i+1)));
 await assert.rejects(ingestLocalFeed({...options,invalidVinPolicy:'quarantine'}),{code:'FEED_QUARANTINE_LIMIT'});
 await assert.rejects(ingestLocalFeed({...options,mode:'snapshot',invalidVinPolicy:'quarantine'}),{code:'FEED_QUARANTINE_POLICY_INVALID'});
 await assert.rejects(ingestLocalFeed({...options,invalidVinPolicy:'ignore'}),{code:'FEED_QUARANTINE_POLICY_INVALID'});
});
