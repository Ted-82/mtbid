const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {DatabaseSync}=require('node:sqlite');
const {RefreshStore,POLICY}=require('../sync/automatic-refresh.cjs');
const {createApibaraProvider}=require('../providers/apibara.js');
const {prepareInventoryPage}=require('../sync/inventory-page.cjs');
const {commitInventoryBatch}=require('../sync/inventory-commit.cjs');
const {repairFeedPhotos,TASK,PAGE,INTERVAL}=require('../sync/feed-photo-repair.cjs');
const {unpackMediaJson}=require('../sync/catalog-media-storage.cjs');
const AT='2026-11-16T14:00:00.000Z',VIN='1HGCM82633A004352',LOT='12345678',IMAGE='https://cs.copart.com/v1/AUTH_svc.pdoc00001/test.jpg';
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8')).response.data[0];
async function setup(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const f of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',f),'utf8'));
 sql.exec(`CREATE TABLE server_feed_state(singleton INTEGER PRIMARY KEY,committed_sequence,active_generation);
 CREATE TABLE server_feed_generations(generation_id INTEGER PRIMARY KEY,last_sequence,status,observed_at);
 CREATE TABLE feed_catalog_pointer(singleton INTEGER PRIMARY KEY,baseline_id);
 CREATE TABLE feed_catalog_membership(baseline_id,listing_id,active,PRIMARY KEY(baseline_id,listing_id));
 INSERT INTO server_feed_state VALUES(1,100,NULL);INSERT INTO server_feed_generations VALUES(1,100,'complete','${AT}');INSERT INTO feed_catalog_pointer VALUES(1,'baseline');`);
 const h={sql,clock:Date.parse(AT),calls:0,queries:[],fail:false,hook:null};
 const db={prepare(q){h.queries.push(q);return{bind(...params){return{q,params,async run(){return{meta:{changes:Number(sql.prepare(q).run(...params).changes)}};},async all(){return{results:sql.prepare(q).all(...params)};},async first(){return sql.prepare(q).get(...params)||null;}};}};},async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>({meta:{changes:Number(sql.prepare(s.q).run(...s.params).changes)}}));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const store=new RefreshStore(db,'photo-test',()=>h.clock);await store.acquire();const adapter=createApibaraProvider();
 const raw=structuredClone(fixture);Object.assign(raw,{vehicle_id:'photo-fixture',platform:'copart',lot_number:LOT,vin:VIN,updated_at:AT,media:{items:[],thumbs:[]}});raw.auction={...raw.auction,state:'open'};
 const plan=await prepareInventoryPage({db,provider:adapter,records:[raw],observedAt:AT,processedAt:AT,freshnessPolicy:POLICY});assert.equal(plan.prepared.length,1);await commitInventoryBatch({db,store,prepared:plan.prepared});
 h.row=()=>sql.prepare('SELECT * FROM auction_listings WHERE lot=?').get(LOT);sql.prepare('INSERT INTO feed_catalog_membership VALUES(?,?,1)').run('baseline',h.row().listing_id);
 h.extraLots=new Map();
 h.insertMore=async lot=>{
  const entry={...raw,vehicle_id:'photo-'+lot,lot_number:lot};
  const additional=await prepareInventoryPage({db,provider:adapter,records:[entry],observedAt:AT,processedAt:AT,freshnessPolicy:POLICY});
  assert.equal(additional.prepared.length,1);
  await commitInventoryBatch({db,store,prepared:additional.prepared});
  const row=sql.prepare('SELECT listing_id FROM auction_listings WHERE lot=?').get(lot);
  sql.prepare('INSERT INTO feed_catalog_membership VALUES(?,?,1)').run('baseline',row.listing_id);
  h.extraLots.set(lot,{...entry,media:{items:[IMAGE],thumbs:[IMAGE]}});
 };
 h.raw={...raw,media:{items:[{large:IMAGE}],thumbs:[IMAGE]}};h.run=()=>repairFeedPhotos({db,store,adapter,now:()=>h.clock,getRequest:async()=>async spec=>{h.calls++;assert.ok(spec.identifier===LOT||h.extraLots.has(spec.identifier));assert.equal(spec.platform,'copart');await h.hook?.();if(h.fail)throw Object.assign(Error('UPSTREAM'),{code:'UPSTREAM'});return{response:{ok:true,data:h.extraLots.get(spec.identifier)??h.raw},observedAt:AT};}});h.task=()=>sql.prepare('SELECT * FROM automatic_refresh_tasks WHERE task_key=?').get(TASK);return h;
}
test('idle cycle fills exact-lot media only, preserves price/time/history and skips next run',async t=>{
 const h=await setup(t),before={...h.row()},history=h.sql.prepare('SELECT count(*) n FROM auction_listing_snapshots').get().n;
 const r=await h.run();assert.equal(r.filled,true);assert.equal(h.calls,1);const after={...h.row()};assert.deepEqual(JSON.parse(unpackMediaJson(after.media_urls_json)),[IMAGE]);
 for(const k of Object.keys(before))if(!['media_urls_json','media_thumbs_json'].includes(k))assert.equal(after[k],before[k],k);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM auction_listing_snapshots').get().n,history);assert.equal(await h.run(),null);assert.equal(h.calls,1);
 assert.equal(h.sql.prepare('SELECT committed_sequence FROM server_feed_state').get().committed_sequence,100);
});
for(const [name,change,expected]of [
 ['wrong VIN',h=>h.raw.vin='2HGCM82633A004352','identity_mismatch'],['other LOT of same VIN',h=>h.raw.lot_number='87654321','identity_mismatch'],
 ['other platform',h=>h.raw.platform='iaai','identity_mismatch'],['source removed',h=>h.raw.auction.lot_removed=true,'source_not_active'],
 ['source ended',h=>h.raw.auction.state='ended','source_not_active'],['source empty',h=>h.raw.media={items:[],thumbs:[]},'no_images'],
 ['unsafe media',h=>h.raw.media={items:['javascript:alert(1)'],thumbs:['http://bad/image']},'no_images']]){
 test(name+' cannot publish photos or claim fresh prices',async t=>{const h=await setup(t);change(h);const before={...h.row()},r=await h.run();assert.equal(r.outcome,expected);assert.deepEqual({...h.row()},before);assert.equal(h.calls,1);assert.equal(await h.run(),null);});
}
for(const [name,query]of [['applying',"UPDATE server_feed_state SET active_generation=2"],['unpublished',"INSERT INTO server_feed_generations VALUES(2,110,'prepared','2026-11-16T14:00:00.000Z')"],['future feed',"UPDATE server_feed_generations SET observed_at='2026-11-17T14:00:00.000Z'"]]){
 test(name+' yields to feed without API requests',async t=>{const h=await setup(t);h.sql.exec(query);assert.equal(await h.run(),null);assert.equal(h.calls,0);});
}
test('a stale settled file cannot block an independent verified gallery and prices retain their original timestamps',async t=>{
 const h=await setup(t);h.sql.exec("UPDATE server_feed_generations SET observed_at='2026-11-15T14:00:00.000Z'");
 const before={...h.row()};assert.equal((await h.run()).filled,true);assert.equal(h.calls,1);
 for(const field of ['current_bid_usd','auction_at','source_updated_at','summary_synced_at','detail_synced_at'])assert.equal(h.row()[field],before[field]);
});
test('provider error reserves interval and does not block next feed publication',async t=>{const h=await setup(t);h.fail=true;const r=await h.run();assert.equal(r.error,'UPSTREAM');assert.equal(h.calls,1);assert.equal(await h.run(),null);assert.ok(Date.parse(h.task().next_due_at)>=h.clock+INTERVAL);assert.equal(h.row().media_urls_json,null);});
test('newer gallery appearing during request wins compare-and-set',async t=>{const h=await setup(t);h.hook=()=>h.sql.prepare('UPDATE auction_listings SET media_urls_json=?').run('["https://example.com/newer.jpg"]');await h.run();assert.equal(h.row().media_urls_json,'["https://example.com/newer.jpg"]');});
test('withdrawn membership during request is not updated',async t=>{const h=await setup(t);h.hook=()=>h.sql.exec('UPDATE feed_catalog_membership SET active=0');const r=await h.run();assert.equal(r.filled,false);assert.equal(h.row().media_urls_json,null);});
test('inactive or known gallery does not consume requests; bounded scan uses primary key',async t=>{const h=await setup(t);h.sql.exec('UPDATE feed_catalog_membership SET active=0');const r=await h.run();assert.equal(r.attempted,0);assert.equal(h.calls,0);const query=h.queries.find(q=>q.includes('AS photo_rowid'));assert.match(query,new RegExp('LIMIT '+PAGE));const plan=h.sql.prepare('EXPLAIN QUERY PLAN '+query).all('baseline',Number.MAX_SAFE_INTEGER).map(x=>x.detail).join('\n');assert.match(plan,/INTEGER PRIMARY KEY.*rowid</);assert.doesNotMatch(plan,/USE TEMP B-TREE/);});
test('empty first scan resets cursor and later source photos can be filled',async t=>{const h=await setup(t);h.raw.media={items:[],thumbs:[]};await h.run();h.clock+=INTERVAL+1;h.sql.prepare('UPDATE automatic_refresh_state SET lease_until=?').run(new Date(h.clock+600000).toISOString());await h.run();assert.equal(JSON.parse(h.task().cursor).after,0);h.clock+=5*60000+1;h.sql.prepare('UPDATE automatic_refresh_state SET lease_until=?').run(new Date(h.clock+600000).toISOString());h.raw.media={items:[IMAGE]};assert.equal((await h.run()).filled,true);assert.equal(h.calls,2);});
test('fills at most three and continues from the last attempted row next cycle',async t=>{
 const h=await setup(t);
 for(const lot of ['12345679','12345680','12345681'])await h.insertMore(lot);
 const result=await h.run();
 assert.equal(result.attempted,3);
 assert.equal(result.filled,3);
 assert.equal(h.row().media_urls_json,null);
 assert.equal(await h.run(),null);
 h.clock+=INTERVAL+1;
 h.sql.prepare('UPDATE automatic_refresh_state SET lease_until=?').run(new Date(h.clock+600000).toISOString());
 assert.equal((await h.run()).filled,true);
 assert.equal(h.calls,4);
});
test('reserves the first slot for an earlier Copart auction without repeating the same LOT',async t=>{
 const h=await setup(t);
 for(const lot of ['12345679','12345680','12345681'])await h.insertMore(lot);
 h.sql.prepare('UPDATE auction_listings SET auction_at=? WHERE lot=?').run('2026-11-17T13:00:00.000Z',LOT);
 const r=await h.run();
 assert.equal(r.results[0].lot,LOT);
 assert.equal(new Set(r.results.map(x=>x.lot)).size,3);
 assert.equal(JSON.parse(h.task().cursor).upcoming.at,'2026-11-17T13:00:00.000Z');
});
test('accepts the alternate photo array and full-sized image field',async t=>{
 const h=await setup(t);
 h.raw.media={items:[{full:IMAGE}],photos:[IMAGE,'https://example.com/other.jpg']};
 assert.equal((await h.run()).filled,true);
 assert.deepEqual(JSON.parse(unpackMediaJson(h.row().media_urls_json)),[IMAGE,'https://example.com/other.jpg']);
});
