'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {merge,decode,encode,readCatalogHistory}=require('../sync/catalog-history-read.cjs');
const {requestHistory,PREFIX}=require('../sync/history-request.cjs');
const {enrichRequestedHistory}=require('../sync/feed-history-enrichment.cjs');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const id={listing_id:'l',platform:'copart',lot:'72915826',vin:'WBX13EF09S5386118',ended:true};
const at='2026-11-18T18:00:00.000Z';
const event=(date,price,status='Sold')=>({platform:id.platform,lot:id.lot,event_key:'fallback:'+date,auction_date:date,final_price:status==='Sold'?price:null,source_price:price,status,observed_at:at});
const body=(events=[],cursor=null)=>({ok:true,identity:id,history:events,rex_history:{snapshots:[]},meta:{next_cursor:cursor,history_availability:{state:events.length?'stored':'not_fetched',complete:!!events.length,fetched_at:events.length?at:null}},read:{}});
const start={a:null,b:null,ad:false,bd:false};
test('incomplete vehicle identifiers require a single exact auction across both saved catalogs',async()=>{
 const good=body(),otherLot={...good,identity:{...id,lot:'11111111'}},wrongSource={...good,identity:{...id,platform:'iaai'}};
 const existing=data=>async()=>Response.json(data),missing=async()=>Response.json({ok:false},{status:404});
 const status=code=>async()=>Response.json({ok:false},{status:code});
 const probe=async(active,legacy)=>readCatalogHistory(new Request('https://rexbid.pl/api/car/'+id.vin+'/history'),
   {active,legacy,db:null,requireUniqueIdentity:true});
 for(const [a,b,code] of [[existing(good),existing(good),200],[existing(good),missing,200],[missing,existing(good),200],
   [existing(good),existing(otherLot),409],[existing(good),existing(wrongSource),409],[status(409),existing(good),409],
   [existing(good),status(409),409],[existing(good),status(503),503],[status(503),existing(good),503],
   [existing(good),existing({ok:true}),503],[existing(good),async()=>{throw Error('offline');},503],[missing,missing,404]]){
   const r=await probe(a,b);assert.equal(r.status,code);
   if(code===200)assert.deepEqual((await r.json()).identity,id);
 }
});
test('a REST confirmation coalesces only the same proven source, lot, VIN, exact cycle time and sale amount',()=>{
 const feed={...event('2026-11-24',12700),kind:'confirmed_auction_event',provider:'apibara',vin:id.vin,timed_cycle_verified:true,
    source_status:'Sold',sale_date:'2026-11-24',auction_date:'2026-11-24T23:59:00Z',event_key:'feed-timed-result:v1:'+'a'.repeat(64)};
 const rest={...feed,timed_cycle_verified:undefined,event_key:'history-fallback',auction_date:'2026-11-25T00:59:00+01:00'};
 const pair=(a,b)=>merge(body(a),body(b),start).history;
 assert.equal(pair([feed],[rest]).length,1);assert.equal(pair([feed],[rest])[0].timed_cycle_verified,true);
 const seller={name:'Verified seller',type:'Insurance'};assert.deepEqual(pair([feed],[{...rest,seller}])[0].seller,seller);
 const daily=pair([feed],[{...rest,auction_date:'2026-11-24'}]);
 assert.equal(daily.length,2);assert.equal(daily.filter(x=>x.cycle_unassigned_observation===true).length,1);
 for(const changes of [{vin:'WVWZZZ1JZXW000001'},{lot:'1'},{platform:'iaai'},{final_price:5000},{auction_date:'2026-11-25T12:00:00Z'},{source_status:'Sold on Approval'}]){
   const retained=pair([feed],[{...rest,...changes}]);assert.equal(retained.length,2);assert.ok(!retained.some(x=>x.cycle_unassigned_observation));
 }
 const next={...feed,event_key:'feed-timed-result:v1:'+'b'.repeat(64),auction_date:'2026-11-25T22:00:00Z'};
 assert.equal(pair([feed,next],[rest]).length,2);
});
test('current card cannot reuse a verified feed price from another Timed cycle on the same VIN and lot',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');const begin=source.indexOf('  function getCurrentAuctionHistoryFinalBid(');
 const end=source.indexOf('  async function fetchAuctionHistoryPage',begin),scope='a'.repeat(64),deadline='2026-11-24T23:59:00.000Z';
 const row={...id,event_key:'feed-timed-result:v1:'+scope,timed_cycle_verified:true,auction_date:deadline,sale_date:'2026-11-24',status:'Sold',final_price:12700};
 const c={car:{platform:id.platform,auction:{is_timed:true,timed_end_at:deadline}},getVin:()=>id.vin,getLot:()=>id.lot,getAuctionStart:()=>null,
   observedHistoryRecords:[{timed_end_at:deadline,fingerprint:'feed-timed-bid:v1:'+scope+':0000000119386158'}],historyStatusLabel:()=> 'Sprzedano',auctionHistoryRecords:[row]};
 vm.createContext(c);vm.runInContext(source.slice(begin,end)+';globalThis.price=getCurrentAuctionHistoryFinalBid;',c);
 assert.equal(c.price(),12700);
 for(const changed of [{timed_cycle_verified:false},{cycle_unassigned_observation:true},{lot:'1'},{vin:'WRONG'},{platform:'iaai'},
   {auction_date:'2026-11-25T23:59:00.000Z'},{event_key:'feed-timed-result:v1:'+'b'.repeat(64)}]){
   c.auctionHistoryRecords=[{...row,...changed}];assert.equal(c.price(),null);
 }
 c.auctionHistoryRecords=[row];c.observedHistoryRecords=[];assert.equal(c.price(),null);
});
test('active events cannot be hidden by successful empty legacy history; old events are retained',()=>{
 const active=body([event('2026-11-13',16300)]),legacy=body([event('2026-10-13',15000)]);
 const m=merge(active,legacy,start);assert.equal(m.history.length,2);assert.equal(m.history[0].final_price,16300);assert.equal(m.meta.next_cursor,null);
 assert.equal(merge(active,body(),start).history.length,1);
});
test('newer event correction wins without treating approval as a sale',()=>{
 const old=event('2026-11-13',10000),newer={...old,final_price:null,status:'Sold on Approval',observed_at:'2026-11-19T00:00:00Z'};
 const m=merge(body([newer]),body([old]),start);assert.equal(m.history.length,1);assert.equal(m.history[0].final_price,null);
});
test('same number LOT from other platform or VIN cannot merge',()=>{
 const legacy=body([event('2026-10-13',100)]);legacy.identity={...id,vin:'1HGCM82633A004352'};
 assert.equal(merge(body(),legacy,start).history.length,0);
 legacy.identity={...id,platform:'iaai'};assert.equal(merge(body(),legacy,start).history.length,0);
 assert.equal(merge(body(),legacy,start).meta.next_cursor,null);
});
test('cursor pins VIN and LOT when one database has already reached its final page',()=>{
 const cursor=decode(merge(body(),body([],'older-page'),start).meta.next_cursor);
 assert.equal(cursor.i,[id.platform,id.vin,id.lot].join('/'));assert.equal(cursor.ad,true);
 const changed=body([event('2026-11-15',400)]);changed.identity={...id,vin:'1HGCM82633A004352'};
 assert.equal(merge(null,changed,cursor),null);
});
test('changing identity between history pages returns conflict rather than another vehicle history',async()=>{
 const cursor=encode({...start,ad:true,b:'older-page',i:[id.platform,id.vin,id.lot].join('/')});
 const changed=body([event('2026-11-15',400)]);changed.identity={...id,vin:'1HGCM82633A004352'};
 const r=await readCatalogHistory(new Request('https://rexbid.pl/api/car/72915826/history?cursor='+cursor),{active:async()=>{throw Error('Already complete');},legacy:async()=>Response.json(changed),db:null});
 assert.equal(r.status,409);assert.equal((await r.json()).error,'history_identity_changed');
});
test('both database pagination cursors survive independently and malformed cursor is rejected',()=>{
 const a=body([], 'active-cursor'),b=body([], 'legacy-cursor');const first=merge(a,b,start),next=decode(first.meta.next_cursor);
 assert.equal(next.a,'active-cursor');assert.equal(next.b,'legacy-cursor');
 assert.equal(decode(merge(body(),body([], 'legacy-2'),next).meta.next_cursor).ad,true);
 assert.throws(()=>decode('rexh1_bad'),/CURSOR/);assert.deepEqual(decode('old-cursor'),{a:null,b:'old-cursor',ad:false,bd:false});
 assert.deepEqual(decode(encode(next)),next);
});
test('temporary failure of one database preserves its cursor and surviving history',async()=>{
 const r=await readCatalogHistory(new Request('https://rexbid.pl/api/car/72915826/history'),{
  active:async()=>new Response('failed',{status:503}),legacy:async()=>Response.json(body([event('2026-10-13',100)])),db:null});
 const j=await r.json();assert.equal(j.history.length,1);assert.equal(decode(j.meta.next_cursor).ad,false);
});
function setup(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const file of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',file),'utf8'));
 sql.prepare("INSERT INTO vehicle_sources(source_key,provider,platform,identity_kind,identity_state,first_seen_at,last_seen_at,created_at,updated_at) VALUES('s','apibara','copart','provider_vehicle_id','resolved',?,?,?,?)").run(at,at,at,at);
 sql.prepare("INSERT INTO auction_listings(listing_id,source_key,platform,identity_state,vin_normalized,lot,auction_state,current_bid_usd,auction_at,document_name,first_seen_at,last_seen_at,created_at,updated_at) VALUES('l','s','copart','resolved',?,?,'ended',16300,'2026-11-13T15:00:00Z','TITLE',?,?,?,?)").run(id.vin,id.lot,at,at,at,at);
 const db={prepare(q){const bound=p=>({q,p,async first(){return sql.prepare(q).get(...p)||null;},async all(){return{success:true,results:sql.prepare(q).all(...p)};},async run(){return{success:true,meta:{changes:Number(sql.prepare(q).run(...p).changes)}};}});return{...bound([]),bind(...p){return bound(p);}};},async batch(items){sql.exec('BEGIN');try{const out=items.map(s=>/^\s*SELECT/i.test(s.q)?{success:true,results:sql.prepare(s.q).all(...s.p)}:{success:true,results:[],meta:{changes:Number(sql.prepare(s.q).run(...s.p).changes)}});sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 let clock=Date.parse(at);const store=new RefreshStore(db,'history-test',()=>clock);
 return{sql,db,store,setClock:x=>clock=x,now:()=>clock};
}
test('parallel anonymous history reads coalesce to one task and fresh complete history needs no write',async t=>{
 const h=setup(t);await Promise.all(Array.from({length:8},()=>requestHistory(h.db,id,{state:'not_fetched'},h.now())));
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM automatic_refresh_tasks').get().n,1);
 const before=h.sql.totalChanges;assert.equal((await requestHistory(h.db,id,{complete:true,fetched_at:at},h.now())).state,'current');assert.equal(h.sql.totalChanges,before);
});
test('history identity mismatch and queue bound do not create new tasks',async t=>{
 const h=setup(t);await requestHistory(h.db,{...id,vin:'1HGCM82633A004352'},null,h.now());assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM automatic_refresh_tasks').get().n,0);
 const put=h.sql.prepare("INSERT INTO automatic_refresh_tasks(task_key,platform,status,next_due_at) VALUES(?,'copart','pending',?)");for(let i=0;i<500;i++)put.run(PREFIX+'queue'+i,at);
 await requestHistory(h.db,id,null,h.now());assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM automatic_refresh_tasks').get().n,500);
});
async function run(h,raw,fail=false){await h.store.acquire();return enrichRequestedHistory({db:h.db,store:h.store,now:h.now,getRequest:async()=>async spec=>{
 assert.equal(spec.identifier,id.vin);assert.equal(spec.include,'history');if(fail)throw Error('UPSTREAM');return{response:{ok:true,data:raw},observedAt:at};}});}
const raw=()=>({platform:id.platform,vin:id.vin,lot_number:id.lot,title:'2025 BMW X1',pricing:{current_bid_usd:1},auction:{state:'finished'},sale_document:{name:'TITLE',source_name:'TITLE (Florida)'},seller:{name:'Geico'},history:[{platform:id.platform,lot_number:id.lot,date:'2026-11-13',price:16300,status:'Sold'}]});
test('automatic included history writes verified event and receipt without changing bids/date/freshness',async t=>{
 const h=setup(t);await requestHistory(h.db,id,null,h.now());const before={...h.sql.prepare('SELECT * FROM auction_listings').get()};
 const r=await run(h,raw());assert.equal(r.events,1);assert.equal(r.complete,true);
 const after=h.sql.prepare('SELECT * FROM auction_listings').get();for(const k of Object.keys(before))if(!['document_name','seller_name'].includes(k))assert.equal(after[k],before[k],k);
 assert.equal(after.document_name,'TITLE (Florida)');assert.equal(after.seller_name,'Geico');
 assert.equal(h.sql.prepare('SELECT final_price_usd FROM auction_events').get().final_price_usd,16300);
 assert.equal(h.sql.prepare('SELECT status FROM automatic_refresh_tasks').get().status,'complete');
 assert.equal(await enrichRequestedHistory({db:h.db,store:h.store,now:h.now,getRequest:async()=>{throw Error('Unexpected request');}}),null);
});
test('conditional event never records confirmed sale; foreign source identity never persists',async t=>{
 const h=setup(t);await requestHistory(h.db,id,null,h.now());const source=raw();source.history[0].status='Sold on Approval';await run(h,source);
 assert.equal(h.sql.prepare('SELECT final_price_usd FROM auction_events').get().final_price_usd,null);
});
test('wrong-platform response and failed transaction cannot corrupt old history or create success receipt',async t=>{
 const h=setup(t);await requestHistory(h.db,id,null,h.now());const source=raw();source.platform='iaai';const r=await run(h,source);
 assert.match(r.error,/IDENTITY/);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM provider_sync_scopes').get().n,0);
});
test('upstream error remains queued with backoff and no deletion',async t=>{
 const h=setup(t);await requestHistory(h.db,id,null,h.now());const r=await run(h,raw(),true);assert.equal(r.error,'UPSTREAM');
 const task=h.sql.prepare('SELECT * FROM automatic_refresh_tasks').get();assert.equal(task.status,'pending');assert.ok(Date.parse(task.next_due_at)>h.now());
});
test('new conditional outcome cannot revive an older confirmed price in the card',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');const begin=source.indexOf('  function getCurrentAuctionHistoryFinalBid('),end=source.indexOf('  async function fetchAuctionHistoryPage',begin);
 const c={getLot:()=>id.lot,getAuctionStart:()=>null,historyStatusLabel:s=>s==='Sold'?'Sprzedano':'Oferta warunkowa',auctionHistoryRecords:[event('2026-11-13',16300),event('2026-11-17',900,'Sold on Approval')]};vm.createContext(c);vm.runInContext(source.slice(begin,end)+';globalThis.price=getCurrentAuctionHistoryFinalBid;',c);assert.equal(c.price(),null);c.auctionHistoryRecords=[event('2026-11-13',16300)];assert.equal(c.price(),16300);
});
