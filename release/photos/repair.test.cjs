const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {selection,update,media,run}=require('./repair.cjs');
const {auctionIndexSql}=require('../../inquiry-budget-20261119/site/sync/catalog-order.cjs');
const at=Date.parse('2026-11-19T10:00:00Z'),vin='1FADP5AU8DL509002';
test('kolizja LOT kieruje kolejne sprawdzenie na VIN i wymaga zgodności całej tożsamości',async()=>{
 const {lookupGallery}=require('./repair.cjs');
 const row={lot:'46087626',vin:'2C4RDGBG4HR742563'};
 const images={items:['https://example.org/correct.jpg']};
 const wrong={platform:'iaai',lot_number:row.lot,vin:'2T1BURHE5JC075043',media:images,auction:{state:'open'}};
 const right={...wrong,platform:'copart',vin:row.vin};const ids=[];
 const read=async id=>{ids.push(id);return id===row.lot?wrong:right;};
 assert.deepEqual(await lookupGallery(row,false,read),{pair:null,retryByVin:true});
 assert.ok((await lookupGallery(row,true,read)).pair);assert.deepEqual(ids,[row.lot,row.vin]);
 for(const raw of [wrong,{...right,lot_number:'99999'},null])assert.deepEqual(await lookupGallery(row,true,async()=>raw),{pair:null,retryByVin:false});
});
test('przyspieszenie zależy od zapasu Pro i zostawia co najmniej 30 tysięcy według miernika',()=>{
 const {batchSize}=require('./repair.cjs');
 for(const [remaining,wanted] of [[79700,20],[70000,20],[69999,10],[60000,10],[59999,4],[30003,3],[30000,0],[0,0],[null,0]])assert.equal(batchSize(remaining),wanted);
});
test('ostatnie zapytanie doby zachowuje kursor, a następny cykl pobiera po VIN i zapisuje właściwą galerię',async t=>{
 const now=Date.parse('2026-11-19T23:59:00Z'),lot='46087626',expectedVin='2C4RDGBG4HR742563';
 const row={listing_id:'dodge',lot,vin:expectedVin,eligible:1,time:123};
 let state={quotaAt:now,quota:75000,requestDay:'2026-11-19',requestCount:5759},writes=0;
 const ids=[];
 t.mock.method(globalThis,'fetch',async path=>{
   const id=String(path).split('/').pop();ids.push(id);
   const raw={platform:id===lot?'iaai':'copart',lot_number:lot,vin:id===lot?'2T1BURHE5JC075043':expectedVin,auction:{state:'open'},media:{items:['https://example.org/car.jpg']}};
   return Response.json({data:raw});
 });
 const policy={version:2,billingDay:6,prioritizePublication:true,measuredAt:'2026-11-19T00:00:00Z',databaseMaxBytes:8e9,days:[]};
 const env={APIBARA_KEY:'test',ACCOUNT_POLICY:JSON.stringify(policy),
   STATE:{get:async()=>({etag:'ok',json:async()=>state}),put:async(k,v)=>{state=JSON.parse(v);return {etag:'ok'};}},
   CATALOG:{prepare:sql=>({bind:()=>({
     all:async()=>sql.includes('server_feed_daily_budgets')?{results:[{reads:0,writes:0}],meta:{size_after:2e9}}:{results:writes?[]:[row]},
     run:async()=>{writes++;return {meta:{changes:1}};}
   })})}};
 assert.equal((await run(env,now)).status,'lot_collision_retry_by_vin');
 assert.deepEqual(ids,[lot]);assert.equal(writes,0);assert.equal(state.requestCount,5760);assert.equal(state.retryVinListing,'dodge');assert.equal(state.anchor,undefined);
 assert.equal((await run(env,now+300000)).status,'complete');assert.deepEqual(ids,[lot,expectedVin]);
 assert.equal(writes,1);assert.equal(state.requestCount,1);assert.equal(state.filled,1);assert.equal(state.retryVinListing,undefined);
});
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE auction_listings(listing_id TEXT PRIMARY KEY,lot TEXT,source_listing_id TEXT,vin_normalized TEXT,platform TEXT,identity_state TEXT,auction_state TEXT,source_status TEXT,is_timed INTEGER,timed_end_at TEXT,auction_at TEXT,media_urls_json TEXT,media_thumbs_json TEXT);CREATE TABLE feed_catalog_pointer(singleton INTEGER,baseline_id TEXT);CREATE TABLE feed_catalog_membership(baseline_id TEXT,listing_id TEXT,active INTEGER);INSERT INTO feed_catalog_pointer VALUES(1,'a');"+auctionIndexSql);
 for(const [id,d,platform,timed,end] of [['1','2026-11-20','copart'],['2',null,'copart'],['3','2026-11-28','copart'],['4','2026-11-20','iaai'],['5',null,'copart',1,'2026-11-21T15:00:00Z'],['6','2026-11-18','copart']]){
   db.prepare('INSERT INTO auction_listings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,id,id,vin,platform,'resolved','open','open',timed||0,end||null,d,null,null);
   db.prepare("INSERT INTO feed_catalog_membership VALUES('a',?,1)").run(id);
 }
 return db;
}
test('wyłącznie datowane Copart, termin końcowy Timed, kolejność i kontynuacja',()=>{
 const db=fixture(),q=selection(at,null);const rows=db.prepare(q.sql).all(...q.args);
 assert.deepEqual(rows.map(r=>r.lot),['1','5']);
 const next=selection(at,{time:rows[0].time,id:'1'});assert.deepEqual(db.prepare(next.sql).all(...next.args).map(r=>r.lot),['5']);
});
test('zapis tylko dla tej samej aukcji, dnia i pustych mediów',()=>{
 const db=fixture(),q=selection(at,null),[r]=db.prepare(q.sql).all(...q.args);
 const write=(v,t)=>db.prepare(update).run('["photo"]',null,r.listing_id,r.lot,v,t).changes;
 assert.equal(write('INVALID',r.time),0);assert.equal(write(vin,r.time+5),0);
 db.exec('UPDATE feed_catalog_membership SET active=0');assert.equal(write(vin,r.time),0);
 db.exec('UPDATE feed_catalog_membership SET active=1');assert.equal(write(vin,r.time),1);assert.equal(write(vin,r.time),0);
});
test('puste tablice i NULL są uzupełniane tylko jeśli obie galerie są puste, bez skanowania katalogu',()=>{
 const db=fixture(),query=selection(at,null);
 const plan=db.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.args).map(x=>x.detail);
 assert.ok(plan.some(line=>line.includes('SEARCH l USING INDEX idx_listings_public_auction_date')));
 assert.ok(!plan.some(line=>line.startsWith('SCAN l')));
 const setMedia=db.prepare("UPDATE auction_listings SET media_urls_json=?, media_thumbs_json=? WHERE listing_id='1'");
 for(const [main,thumb,expected] of [[null,null,1],['[]',null,1],[null,'[]',1],['[]','[]',1],['["https://example.org/a.jpg"]','[]',0],['[]','["https://example.org/t.jpg"]',0]]){
   setMedia.run(main,thumb);
   const row=db.prepare(query.sql).all(...query.args).find(r=>r.listing_id==='1');
   assert.equal(row.eligible,expected);
   assert.equal(db.prepare(update).run('["https://example.org/new.jpg"]',null,row.listing_id,row.lot,vin,row.time).changes,expected);
 }
 db.close();
});
test('dane szczegółowe z niezgodnym VIN, domem aukcyjnym lub statusem są pomijane',()=>{
 const r={lot:'1',vin},raw={platform:'copart',lot_number:'1',vin,auction:{state:'open'},media:{items:['https://example.org/a.jpg']}};
 assert.ok(media(r,raw)[0]);for(const changes of [{vin:'X'},{lot_number:'2'},{platform:'iaai'},{auction:{state:'sold'}},{auction:{state:'open',lot_removed:true}},{media:{}}])assert.equal(media(r,{...raw,...changes}),null);
});
test('powtórzony termin harmonogramu nie używa API ani bazy',async()=>{
 const status=await run({APIBARA_KEY:'test',STATE:{get:async()=>({json:async()=>({slot:Math.floor(at/300000)})})}},at);
 assert.equal(status.status,'already_reserved');
});
test('nadanie terminu odsłania dotychczas niedatowane auto bez nowego rekordu',()=>{
 const db=fixture(),q=selection(at,null);
 db.exec("UPDATE auction_listings SET auction_at='2026-11-22T11:00:00Z' WHERE listing_id='2'");
 assert.ok(db.prepare(q.sql).all(...q.args).some(x=>x.lot==='2'&&x.eligible===1));
 db.exec("UPDATE auction_listings SET auction_at=NULL WHERE listing_id='2'");
 assert.ok(!db.prepare(q.sql).all(...q.args).some(x=>x.lot==='2'));
});
test('dodatkowe galerie ustępują publikacji bez rezerwowania cyklu zdjęć',async()=>{
 const policy={version:2,billingDay:6,prioritizePublication:true,measuredAt:'2026-11-19T00:00:00Z',
  databaseMaxBytes:8e9,days:[{day:'2026-11-08',writes:30e6,reads:0}]};
 const env={APIBARA_KEY:'test',ACCOUNT_POLICY:JSON.stringify(policy),
  STATE:{get:async()=>null,put:async()=>assert.fail('acquired lease')},
  CATALOG:{prepare:()=>({bind:()=>({all:async()=>({
   results:[{writes:6e6,reads:0}],meta:{size_after:2e9}
  })})})}};
 assert.deepEqual(await run(env,at),{status:'publication_reserve'});
});
