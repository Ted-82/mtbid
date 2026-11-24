const test = require("node:test");
const assert = require("node:assert/strict");
const {cachedStoredRead} = require("../sync/stored-read-cache.cjs");

const origin = "https://rexbid.pl";
const request = (path = "/api/cars", options) => new Request(origin + path, options);
const json = (body = {ok:true,data:[],meta:{read_source:"d1",provider_fallback_enabled:false}}, status = 200, headers = {}) => new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=UTF-8","Cache-Control":"private, no-store",...headers}});
const taxonomy = () => ({ok:true,data:{makes:[{value:'Honda',label:'Honda'}],models:[{make:'Honda',model:'Civic'}],years:[2025],states:['TX'],
  body_styles:['Sedan'],vehicle_types:[{value:'kind:car',label:'Samochody'}],sale_document_names:[{value:'CLEAR',label:'CLEAR'}]},
  meta:{read_source:'d1',known_rows_only:true,metadata_complete:false,catalog_complete:false,scope_status:'partial',row_count:200000,platform_coverage:[]}});
class Cache {
  constructor() {this.entries = new Map();this.reads=[];this.writes=[];}
  async match(key) {this.reads.push(key.url);return this.entries.get(key.url)?.clone();}
  async put(key,response) {this.writes.push(key.url);this.entries.set(key.url,response.clone());}
}
const options = {namespace:"publication:db-1:v1"};

test("stored-only public JSON uses cloned cache responses and safe miss/hit headers without mutating data", async () => {
  const cache = new Cache(); let loads=0;
  const body = {ok:true,data:{vin:"WBA5R1C06MFK00001",lot:"123",platform:"copart",last_seen_at:"2026-10-07T10:00:00Z"},read:{source:"d1",freshness:"stale",provider_fallback_enabled:false}};
  const load = async () => {loads++;return json(body);};
  const req = request("/api/car/WBA5R1C06MFK00001?lot=123&platform=copart");
  const miss = await cachedStoredRead(req,cache,load,options);
  assert.equal(miss.headers.get("X-RexBid-Cache"),"MISS");
  assert.equal(miss.headers.get("Cache-Control"),"public, max-age=30, s-maxage=30");
  assert.equal(miss.headers.has("X-RexBid-Stored-Cache-Time"),false);
  assert.deepEqual(await miss.json(),body);
  const hit = await cachedStoredRead(req,cache,load,options);
  assert.equal(hit.headers.get("X-RexBid-Cache"),"HIT");
  assert.deepEqual(await hit.json(),body);
  const next = await cachedStoredRead(req,cache,load,options);
  assert.deepEqual(await next.json(),body,"reading one response does not consume subsequent hits");
  assert.equal(loads,1);
  assert.equal(cache.writes.length,1);
});

test("namespace, host, encoded identifier, query ordering, LOT, platform, filter and cursor isolate cache keys", async () => {
  const cache = new Cache();let loads=0;
  const load=async () => {loads++;return json();};
  const cases = [
    [request("/api/car/vin-A?lot=123&platform=copart"),"db-a"],
    [request("/api/car/vin-A?lot=123&platform=iaai"),"db-a"],
    [request("/api/car/vin-A?lot=124&platform=copart"),"db-a"],
    [request("/api/car/vin-a?lot=123&platform=copart"),"db-a"],
    [request("/api/car/vin%2DA?lot=123&platform=copart"),"db-a"],
    [request("/api/car/vin-A?platform=copart&lot=123"),"db-a"],
    [request("/api/car/vin-A?lot=123&platform=copart"),"db-b"],
    [new Request("https://preview.rexbid.pl/api/car/vin-A?lot=123&platform=copart"),"db-a"],
    [request("/api/cars?make=BMW&cursor=a"),"db-a"],
    [request("/api/cars?make=BMW&cursor=b"),"db-a"]
  ];
  for (const [req,namespace] of cases) await cachedStoredRead(req,cache,load,{namespace});
  assert.equal(loads,cases.length);
  assert.equal(new Set(cache.writes).size,cases.length);
  for (const [req,namespace] of cases) assert.equal((await cachedStoredRead(req,cache,load,{namespace})).headers.get("X-RexBid-Cache"),"HIT");
  assert.equal(loads,cases.length);
});

test("only the four public route shapes and GET can cache; accounts, mutations and credentials bypass", async () => {
  const cache = new Cache();let loads=0;
  const load=async () => {loads++;return json();};
  const denied = [request("/api/auth/me"),request("/api/portal/orders"),request("/api/contact/config"),request("/api/car/x/private"),request("/api/cars",{method:"POST"}),request("/api/cars",{method:"HEAD"}),request("/api/cars",{headers:{Authorization:"Bearer fixture"}}),request("/api/cars",{headers:{Cookie:"fixture=1"}}),request("/api/cars?access_token=fixture"),request("/api/cars",{headers:{Range:"bytes=0-10"}})];
  for (const req of denied) assert.equal((await cachedStoredRead(req,cache,load,options)).headers.get("X-RexBid-Cache"),"BYPASS");
  assert.equal(cache.reads.length,0);assert.equal(cache.writes.length,0);assert.equal(loads,denied.length);
  for (const path of ["/api/cars","/api/filters","/api/car/x","/api/car/x/history"]) assert.equal((await cachedStoredRead(request(path),cache,path==='/api/filters'?async()=>json(taxonomy()):load,options)).headers.get("X-RexBid-Cache"),"MISS");
  assert.equal(cache.writes.length,4);
});

test("404, 503, non-JSON, malformed JSON, Set-Cookie and private/provider payloads never enter shared cache", async () => {
  const forbidden = [json({ok:false,error:"missing"},404),json({ok:false,error:"unavailable"},503),new Response("<html>",{headers:{"Content-Type":"text/html"}}),new Response("{invalid",{headers:{"Content-Type":"application/json"}}),json(undefined,200,{"Set-Cookie":"fixture=1"}),json({ok:true,data:{customer_email:"fixture@example.invalid"}}),json({ok:true,data:{nested:{access_token:"fixture"}}}),json({ok:true,data:{private_fields:{note:"fixture"}}}),json({ok:true,data:[],read:{source:"provider"}}),json({ok:true,data:[],read:{provider_fallback_enabled:true}}),json(undefined,200,{Vary:"Cookie"})];
  for (const response of forbidden) {
    const cache = new Cache();
    const original = await response.clone().text();
    const result = await cachedStoredRead(request(),cache,async () => response,options);
    assert.equal(result.headers.get("X-RexBid-Cache"),"BYPASS");
    assert.equal(result.headers.get("Cache-Control"),"private, no-store");
    assert.equal(cache.writes.length,0);
    assert.equal(await result.text(),original);
  }
});

test("Cache API absence, lookup failure and write failure leave the stored loader usable", async () => {
  for (const cache of [null,{}, {match:async () => {throw new Error("cache offline");},put:async () => {throw new Error("write failed");}}]) {
    let loads=0;
    const result = await cachedStoredRead(request(),cache,async () => {loads++;return json();},options);
    assert.equal(result.status,200);assert.equal(loads,1);assert.equal((await result.json()).ok,true);
  }
  for (const namespace of [undefined,"","x".repeat(201)]) {
    const cache = new Cache();
    assert.equal((await cachedStoredRead(request(),cache,async () => json(),{namespace})).headers.get("X-RexBid-Cache"),"BYPASS");
    assert.equal(cache.reads.length,0);
  }
});

test("waitUntil receives only a cache write; hits and bypasses schedule no work", async () => {
  const cache=new Cache(),work=[];
  const opts={...options,context:{waitUntil:promise => work.push(promise)}};
  await cachedStoredRead(request(),cache,async () => json(),opts);
  assert.equal(work.length,1);await work[0];
  assert.equal(cache.writes.length,1);
  await cachedStoredRead(request(),cache,async () => {throw new Error("Must be hit");},opts);
  await cachedStoredRead(request("/api/auth/me"),cache,async () => json(),opts);
  assert.equal(work.length,1);
});

test("TTL never exceeds 30 seconds, expired cache reloads, hits do not restart expiry", async t => {
  let now=1_800_000_000_000;
  t.mock.method(Date,"now",() => now);
  const cache=new Cache();let loads=0;
  const load=async () => {loads++;return json();};
  const miss=await cachedStoredRead(request(),cache,load,{...options,maxAgeSeconds:999});
  assert.equal(miss.headers.get("Cache-Control"),"public, max-age=30, s-maxage=30");
  now+=15000;
  const hit=await cachedStoredRead(request(),cache,load,options);
  assert.equal(hit.headers.get("Cache-Control"),"public, max-age=15, s-maxage=15");
  now+=16000;
  assert.equal((await cachedStoredRead(request(),cache,load,options)).headers.get("X-RexBid-Cache"),"MISS");
  assert.equal(loads,2);
  assert.equal((await cachedStoredRead(request(),cache,load,{...options,maxAgeSeconds:0})).headers.get("X-RexBid-Cache"),"BYPASS");
});

test("freshness near the 24h boundary shortens TTL without changing age/status/observation timestamps", async t => {
  const now=1_800_000_000_000;t.mock.method(Date,"now",() => now);
  const cache=new Cache();
  const body={ok:true,data:[],meta:{read_source:"d1",freshness:{status:"fresh",age_ms:86_395_500,last_seen_at:"2026-10-01T00:00:00Z"}}};
  const response=await cachedStoredRead(request(),cache,async () => json(body),options);
  assert.equal(response.headers.get("Cache-Control"),"public, max-age=4, s-maxage=4");
  assert.deepEqual(await response.json(),body);
  const near={ok:true,data:{freshness_status:"fresh",last_synced_at:new Date(now-86_399_500).toISOString()},read:{source:"d1",freshness:"fresh"}};
  const bypass=await cachedStoredRead(request("/api/car/x"),cache,async () => json(near),options);
  assert.equal(bypass.headers.get("X-RexBid-Cache"),"BYPASS");
  assert.deepEqual(await bypass.json(),near);
  assert.equal(cache.writes.length,1);
});

test("cache hits revalidate sensitive fields and failures never run hidden provider work", async () => {
  const cache=new Cache();
  await cachedStoredRead(request(),cache,async () => json(),options);
  const key=cache.writes[0],headers=Object.fromEntries(cache.entries.get(key).headers);
  cache.entries.set(key,json({ok:true,data:{user_id:"private-fixture"}},200,headers));
  let loads=0;
  const result=await cachedStoredRead(request(),cache,async () => {loads++;return json();},options);
  assert.equal(result.headers.get("X-RexBid-Cache"),"MISS");assert.equal(loads,1);
  assert.equal((await result.json()).ok,true);
});

test('only stored public taxonomy gets900seconds; offer routes retain30seconds and explicit lower TTL remains respected',async t=>{
 let now=1_800_000_000_000;t.mock.method(Date,'now',()=>now);
 const cache=new Cache();
 for(const path of ['/api/cars','/api/car/x','/api/car/x/history']){
  const response=await cachedStoredRead(request(path),cache,async()=>json(),{...options,maxAgeSeconds:99999});
  assert.equal(response.headers.get('Cache-Control'),'public, max-age=30, s-maxage=30');
  assert.equal(response.headers.has('X-RexBid-Metadata-Generated-At'),false);
 }
 const body=taxonomy(),response=await cachedStoredRead(request('/api/filters'),cache,async()=>json(body),{...options,maxAgeSeconds:99999});
 assert.equal(response.headers.get('Cache-Control'),'public, max-age=900, s-maxage=900');assert.deepEqual(await response.json(),body);
 assert.equal(response.headers.get('X-RexBid-Metadata-Generated-At'),new Date(now).toISOString());
 assert.equal(response.headers.get('X-RexBid-Metadata-Expires-At'),new Date(now+900000).toISOString());
 assert.equal(response.headers.get('X-RexBid-Metadata-Max-Age'),'900');
 assert.ok(cache.writes.some(key=>key.includes('/v2-taxonomy/')));assert.ok(cache.writes.some(key=>key.includes('/v1/')));
 const lower=await cachedStoredRead(request('/api/filters?platform=iaai'),cache,async()=>json(taxonomy()),{...options,maxAgeSeconds:20});
 assert.equal(lower.headers.get('Cache-Control'),'public, max-age=20, s-maxage=20');
});
test('taxonomy remains cached beyond30seconds but expires900seconds after original generation and hits never extend its age',async t=>{
 let now=1_800_000_000_000;t.mock.method(Date,'now',()=>now);const started=now,cache=new Cache();let loads=0;
 const load=async()=>{loads++;return json(taxonomy());},req=request('/api/filters?platform=copart');
 const miss=await cachedStoredRead(req,cache,load,options);const expiry=miss.headers.get('X-RexBid-Metadata-Expires-At');
 now+=31000;const hit=await cachedStoredRead(req,cache,load,options);
 assert.equal(hit.headers.get('X-RexBid-Cache'),'HIT');assert.equal(hit.headers.get('Cache-Control'),'public, max-age=869, s-maxage=869');
 assert.equal(hit.headers.get('X-RexBid-Metadata-Generated-At'),new Date(started).toISOString());assert.equal(hit.headers.get('X-RexBid-Metadata-Expires-At'),expiry);
 now=started+899000;assert.equal((await cachedStoredRead(req,cache,load,options)).headers.get('Cache-Control'),'public, max-age=1, s-maxage=1');
 now=started+900000;const renewed=await cachedStoredRead(req,cache,load,options);assert.equal(renewed.headers.get('X-RexBid-Cache'),'MISS');assert.equal(loads,2);
 assert.equal(renewed.headers.get('X-RexBid-Metadata-Generated-At'),new Date(now).toISOString());
});
test('long taxonomy policy preserves exact query/platform/namespace keys and bypasses credentials, private routes and unsafe response shapes',async()=>{
 const cache=new Cache(),load=async()=>json(taxonomy());
 for(const req of [request('/api/filters',{headers:{Cookie:'session=fixture'}}),request('/api/filters',{headers:{Authorization:'Bearer fixture'}}),
  request('/api/filters?email=fixture'),request('/api/filters',{headers:{Range:'bytes=0-1'}}),request('/api/filters',{method:'POST'}),request('/api/filters/private')]){
  const r=await cachedStoredRead(req,cache,load,options);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(r.headers.get('X-RexBid-Cache'),'BYPASS');
 }
 const unsafe=[{...taxonomy(),data:[]},{...taxonomy(),data:{pricing:[1000]}},{...taxonomy(),data:{models:[{make:'Honda',model:'Civic',price:5000}]}},
  {...taxonomy(),data:{makes:[{value:'Honda',label:'Honda',account_id:'fixture'}]}},{...taxonomy(),source:'provider'},
  {...taxonomy(),meta:{...taxonomy().meta,known_rows_only:false}},{...taxonomy(),meta:{...taxonomy().meta,read_source:'provider'}}];
 for(const body of unsafe)assert.equal((await cachedStoredRead(request('/api/filters'),cache,async()=>json(body),options)).headers.get('X-RexBid-Cache'),'BYPASS');
 for(const headers of [{'Set-Cookie':'fixture=1'},{Vary:'Cookie'}])assert.equal((await cachedStoredRead(request('/api/filters'),cache,async()=>json(taxonomy(),200,headers),options)).headers.get('X-RexBid-Cache'),'BYPASS');
 assert.equal(cache.writes.length,0);
 for(const [path,namespace] of [['/api/filters?platform=copart','db-1'],['/api/filters?platform=iaai','db-1'],['/api/filters?make=Honda&platform=copart','db-1'],['/api/filters?platform=copart&make=Honda','db-1'],['/api/filters?platform=copart','db-2']])
  assert.equal((await cachedStoredRead(request(path),cache,load,{namespace})).headers.get('X-RexBid-Cache'),'MISS');
 assert.equal(new Set(cache.writes).size,5);
});
test('cached taxonomy is revalidated and future-dated cache timestamps cannot restart a15minute window',async t=>{
 let now=1_800_000_000_000;t.mock.method(Date,'now',()=>now);const cache=new Cache(),req=request('/api/filters');let loads=0;
 const load=async()=>{loads++;return json(taxonomy());};await cachedStoredRead(req,cache,load,options);
 const key=cache.writes[0],headers=Object.fromEntries(cache.entries.get(key).headers);
 cache.entries.set(key,json({...taxonomy(),data:{models:[{make:'Honda',model:'Civic',pricing:{current_bid_usd:5000}}]}},200,headers));
 assert.equal((await cachedStoredRead(req,cache,load,options)).headers.get('X-RexBid-Cache'),'MISS');assert.equal(loads,2);
 now-=1000;assert.equal((await cachedStoredRead(req,cache,load,options)).headers.get('X-RexBid-Cache'),'MISS');assert.equal(loads,3);
});
test('taxonomy policy still shortens a real freshness boundary and never rewrites coverage or freshness JSON',async t=>{
 const now=1_800_000_000_000;t.mock.method(Date,'now',()=>now);const body=taxonomy();
 body.meta.freshness={status:'fresh',age_ms:86_395_500,last_synced_at:new Date(now-86_395_500).toISOString()};
 const response=await cachedStoredRead(request('/api/filters'),new Cache(),async()=>json(body),options);
 assert.equal(response.headers.get('Cache-Control'),'public, max-age=4, s-maxage=4');
 assert.equal(response.headers.get('X-RexBid-Metadata-Expires-At'),new Date(now+4000).toISOString());
 assert.deepEqual(await response.json(),body);
});
test('actual stored filter response is eligible for taxonomy policy and cached hit avoids all repeated D1 work',async t=>{
 const {DatabaseSync}=require('node:sqlite'),{handleStoredRead}=require('../staging/d1-primary-reads.cjs');
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());t.mock.method(console,'info',()=>{});
 const network=t.mock.method(globalThis,'fetch',async()=>{throw Error('NO_PROVIDER');});
 const fields=['make','model','year','location_state','auction_state','body_style','fuel_type','transmission','drive_type','run_state','primary_damage','seller_type','document_type','document_name'];
 sqlite.exec('CREATE TABLE auction_listings(platform TEXT,'+fields.map(f=>f+' TEXT').join(',')+'); CREATE TABLE provider_sync_scopes(provider TEXT,platform TEXT,status TEXT,cursor TEXT,last_complete_at TEXT,operation TEXT)');
 sqlite.prepare('INSERT INTO auction_listings VALUES('+Array(15).fill('?').join(',')+')').run('copart','Honda','Civic','2025','TX','open','Sedan','Gasoline','Automatic','FWD','Runs','Rear','Insurance','Clear','CLEAR');
 let queries=0;const db={prepare(sql){assert.match(sql,/^SELECT\b/);queries++;const statement=sqlite.prepare(sql),methods=params=>({async all(){return{results:statement.all(...params)};},async first(){return statement.get(...params)||null;}});return{...methods([]),bind(...params){return methods(params);}};}};
 const env={REXBID_DB:db,REXBID_RELEASE_D1_TARGET:'rexbid-production-preflight-db',REXBID_RELEASE_D1_DATABASE_ID:'c8a30088-70af-43a6-9a7f-c4018279d37d',REXBID_PUBLIC_CATALOG_MODE:'stored'};
 const req=request('/api/filters'),cache=new Cache(),load=()=>handleStoredRead(req,env);
 const first=await cachedStoredRead(req,cache,load,options),body=await first.json(),count=queries;
 assert.equal(first.headers.get('Cache-Control'),'public, max-age=900, s-maxage=900');assert.equal(body.meta.known_rows_only,true);assert.equal(body.meta.row_count,1);
 const hit=await cachedStoredRead(req,cache,load,options);assert.equal(hit.headers.get('X-RexBid-Cache'),'HIT');assert.equal(queries,count);
 assert.deepEqual(await hit.json(),body);assert.equal(network.mock.callCount(),0);
});

test('projected filter responses bypass old full payloads for the same request URLs',async()=>{
 const cache=new Cache(),base=request('/api/filters?view=options&platform=copart');
 const honda=request('/api/filters?view=models&make=HONDA&platform=copart');
 const bmw=request('/api/filters?view=models&make=BMW&platform=copart');
 await cachedStoredRead(base,cache,()=>json(taxonomy()),options);
 await cachedStoredRead(honda,cache,()=>json(taxonomy()),options);
 const projected={...options,storedTaxonomy:true};
 const load=async(req,data)=>(await cachedStoredRead(req,cache,()=>json({...taxonomy(),data}),projected)).json();
 const makes={makes:taxonomy().data.makes};
 const civic={models:[{make:'Honda',model:'Civic'}]};
 const x5={models:[{make:'BMW',model:'X5'}]};
 assert.deepEqual((await load(base,makes)).data,makes);
 assert.deepEqual((await load(honda,civic)).data,civic);
 assert.deepEqual((await load(bmw,x5)).data,x5);
 assert.deepEqual((await load(honda,x5)).data,civic);
});
