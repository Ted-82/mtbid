'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readSyncHealth}=require('../portal/sync-health.cjs');
const now=Date.parse('2026-11-26T11:00:00Z');
function db({pending=0,age=5,blocked=false,exhausted=false}={}){
 return {prepare:q=>q,batch:async()=>[
  {results:[{generation_id:24932,status:'complete',observed_at:new Date(now-age*60000).toISOString()}]},
  {results:pending?[{platform:'iaai',pending,oldest:new Date(now-86400000).toISOString()}]:[]},
  {results:[{quota_left:99900,quota_limit:100000}]},
  {results:[{limit_count:1000,consumed:exhausted?1000:10}]},
  {results:blocked?[{status:'blocked',last_error_code:'AUTH'}]:[]}
 ]};
}
test('published file with pending work cannot claim healthy completeness',async()=>{
 const r=await readSyncHealth(db({pending:12000}),now);
 assert.equal(r.pending,12000);assert.notEqual(r.status,'System działa prawidłowo');
});
test('old source, resource stop and authentication stop have explicit statuses',async()=>{
 assert.equal((await readSyncHealth(db({age:180}),now)).status,'Występuje opóźnienie danych');
 assert.equal((await readSyncHealth(db({exhausted:true}),now)).status,'Występuje ograniczenie zasobów');
 assert.equal((await readSyncHealth(db({blocked:true}),now)).status,'Wymagana jest interwencja właściciela');
});
