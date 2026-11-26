'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {cachedStoredRead}=require('../sync/stored-read-cache.cjs');
const request=(query='',headers={})=>new Request('https://rexbid.pl/api/filters'+query,{headers});
const payload={ok:true,data:{makes:[{value:'AUDI',label:'AUDI'}],models:[{make:'AUDI',model:'A4'}],years:[2025]},meta:{read_source:'d1',known_rows_only:true,metadata_complete:false,row_count:215000}};
const response=()=>new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
class Cache{constructor(){this.entries=new Map();}async match(key){return this.entries.get(key.url)?.clone();}async put(key,value){this.entries.set(key.url,value.clone());}}
const opts={namespace:'publication:production-db:membership-1-plan',storedTaxonomy:true};
test('stored D1 make changes reuse identical taxonomy instead of repeating whole-catalog aggregation',async()=>{
 const cache=new Cache();let loads=0;const load=async()=>{loads++;return response();};
 for(const query of ['?make=AUDI','?make=VOLVO&model=XC60','?make=SUBARU','?platform=']){
  const result=await cachedStoredRead(request(query),cache,load,opts);assert.deepEqual(await result.json(),payload);
 }
 assert.equal(loads,1);assert.equal(cache.entries.size,1);assert.match([...cache.entries.keys()][0],/v3-stored-taxonomy/);
});
test('platform, database, baseline namespace and malformed platform semantics remain isolated',async()=>{
 const cache=new Cache();let loads=0;const load=async()=>{loads++;return response();};
 for(const [query,namespace]of [['?make=AUDI',opts.namespace],['?make=AUDI&platform=copart',opts.namespace],['?make=VOLVO&platform=iaai',opts.namespace],['?make=AUDI','other-db:membership-1'],['?make=AUDI','production-db:membership-2'],['?platform=COPART&make=AUDI',opts.namespace],['?platform=COPART&make=VOLVO',opts.namespace],['?platform=copart&platform=iaai',opts.namespace]])await cachedStoredRead(request(query),cache,load,{...opts,namespace});
 assert.equal(loads,8);assert.equal(cache.entries.size,8);
 const equivalent=await cachedStoredRead(request('?model=A4&make=AUDI&platform=%63opart'),cache,load,opts);assert.equal(equivalent.headers.get('X-RexBid-Cache'),'HIT');assert.equal(loads,8);
});
test('Cookie, Authorization and secret query gates still bypass every cache lookup and storage',async()=>{
 const cache=new Cache();let loads=0,lookups=0;const load=async()=>{loads++;return response();};
 for(const req of [request('?make=AUDI',{Cookie:'session=private'}),request('?make=AUDI',{Authorization:'Bearer private'}),request('?make=AUDI&token=private')]){
  const result=await cachedStoredRead(req,cache,load,{...opts,namespace:async()=>{lookups++;return opts.namespace;}});
  assert.equal(result.headers.get('X-RexBid-Cache'),'BYPASS');assert.equal(result.headers.get('Cache-Control'),'private, no-store');
 }
 assert.equal(loads,3);assert.equal(lookups,0);assert.equal(cache.entries.size,0);
});
test('provider-compatible taxonomy and all non-filter routes preserve exact query keys',async()=>{
 const cache=new Cache();let loads=0;const load=async()=>{loads++;return response();};
 for(const query of ['?make=AUDI','?make=VOLVO'])await cachedStoredRead(request(query),cache,load,{namespace:opts.namespace});
 assert.equal(loads,2);assert.ok([...cache.entries.keys()].every(key=>key.includes('v2-taxonomy')));
 const catalog=async()=>new Response(JSON.stringify({ok:true,data:[],meta:{read_source:'d1',provider_fallback_enabled:false}}),{headers:{'Content-Type':'application/json'}});
 await cachedStoredRead(new Request('https://rexbid.pl/api/cars?make=AUDI'),cache,catalog,opts);await cachedStoredRead(new Request('https://rexbid.pl/api/cars?make=VOLVO'),cache,catalog,opts);
 assert.equal(cache.entries.size,4);
});
test('provider payloads remain rejected even when stored-taxonomy mode was explicitly selected',async()=>{
 const cache=new Cache();const result=await cachedStoredRead(request('?make=AUDI'),cache,async()=>new Response(JSON.stringify({ok:true,data:[],meta:{read_source:'provider'}}),{headers:{'Content-Type':'application/json'}}),opts);
 assert.equal(result.headers.get('X-RexBid-Cache'),'BYPASS');assert.equal(cache.entries.size,0);
});
test('unknown, validation-shaped and repeated parameters retain their complete exact keys',async()=>{
 const cache=new Cache();let loads=0;const load=async()=>{loads++;return response();};
 for(const query of ['?make=AUDI&year_from=bad','?make=VOLVO&year_from=bad','?make=AUDI&cursor=invalid','?make=VOLVO&cursor=invalid','?make=AUDI&make=VOLVO','?make=VOLVO&make=AUDI'])await cachedStoredRead(request(query),cache,load,opts);
 assert.equal(loads,6);assert.ok([...cache.entries.keys()].every(key=>key.includes('v2-taxonomy')));
});
