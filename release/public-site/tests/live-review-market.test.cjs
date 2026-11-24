const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const market=require('../public/rexbid-market.js');
const {authorized,CAMPAIGN}=require('../staging/live-review.cjs');
test('observed provider vehicle_specs and physical facility survive canonical normalization for the calculator',()=>{
 const provider=require('../providers/apibara.js').createApibaraProvider();
 const raw={platform:'copart',vehicle_id:'fixture',trim:{name:'L Eco'},odometer:{mi:25000},lot_number:'fixture-lot',vehicle_specs:{fuel_type:'Electric and gas hybrid',body_style:'Hatchback'},facility:{source_location_name:'CA - RANCHO CUCAMONGA',canonical:{city:'RANCHO CUCAMONGA',state:'CA',zip:'91739'}},auction:{state:'open'},location:{display:'Virtual sale'}};
 const car=provider.toCanonicalVehicle(raw,provider.normalizeVehicle(raw));
 assert.equal(car.trim,'L Eco');assert.deepEqual(car.odometer,{value:25000,unit:'mi'});
 assert.equal(require('../providers/contract.js').createRexVehicle({trim:'[object Object]'}).trim,null);
 assert.equal(car.fuel_type,'Electric and gas hybrid');assert.equal(car.body_style,'Hatchback');
 assert.equal(car.location.postal_code,'91739');assert.equal(car.location.state,'CA');
 const calc=require('../public/rexbid-calculator-v4.js');
 const input=calc.terminalFrom(car);assert.equal(calc.matchingLocation(calc.rates,input).status,'exact_branch_state_zip');
 assert.equal(calc.matchPowertrain(car),'HEV');assert.equal(require('../public/rexbid-powertrain.js').isConfirmedBev(car),false);
});
test('four shared categories filter the entire SQL population before paging and agree with browser predicates',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE auction_listings(id,platform,auction_state,source_status,auction_at,is_timed,buy_now_usd,fuel_type,timed_end_at)');
 const rows=[];for(let i=0;i<25;i++)rows.push([i,'copart','open','Open','2020-01-01',0,900,'Electric']);
 rows.push([25,'iaai','open','Open','2099-01-01',1,2000,'Electric'],[26,'copart','sold','Sold',null,1,999,'Electric'],[27,'copart','open','Open','2099-01-02',0,null,'Hybrid']);
 for(const row of rows)db.prepare('INSERT INTO auction_listings(id,platform,auction_state,source_status,auction_at,is_timed,buy_now_usd,fuel_type) VALUES(?,?,?,?,?,?,?,?)').run(...row);
 const now=Date.parse('2026-10-05T12:00:00Z');
 for(const cat of market.categories){
  const filter=market.sql(cat.id,new Date(now).toISOString());
  const sql=db.prepare(`SELECT id FROM auction_listings l WHERE ${filter.where.join(' AND ')} ORDER BY id LIMIT 20`).all(...filter.values).map(x=>x.id);
  const client=rows.filter(r=>market.eligible({platform:r[1],auction:{state:r[2],formatted:r[3],auction_at:r[4],is_timed:!!r[5]},pricing:{buy_now_usd:r[6]},fuel_type:r[7]},cat.id,now)).map(r=>r[0]);
  assert.deepEqual(sql,client,cat.id);assert.ok(sql.includes(25));assert.ok(!sql.includes(26));
 }
 assert.equal(market.categories.length,4);assert.equal(market.fromParams(new URLSearchParams('upcoming=only')),'current');db.close();
});
test('operator runner is exact-host, staging DB, POST and secret gated, with a fixed campaign cap',async()=>{
 const env={REXBID_D1_READ_TARGET:'rexbid-auth-test-db',REXBID_LIVE_REVIEW:'enabled',REXBID_LIVE_REVIEW_TOKEN:'synthetic-secret-not-deployed'};
 const request=(host='rexbid-auth-test.tedn828.workers.dev',method='POST',token='synthetic-secret-not-deployed')=>new Request(`https://${host}/__staging/live-review`,{method,headers:{Authorization:`Bearer ${token}`}});
 assert.equal(await authorized(request(),env),true);
 for(const req of [request('mtbid.tedn828.workers.dev'),request(undefined,'GET'),request(undefined,'POST','wrong')])assert.equal(await authorized(req,env),false);
 assert.equal(await authorized(request(),{...env,REXBID_D1_READ_TARGET:'rexbid-db'}),false);
 assert.equal(CAMPAIGN.totalLimit,120);assert.equal(CAMPAIGN.platformLimit,60);
});

test('recent but unconfirmed availability stays out of all Home categories in both SQL and browser predicates',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE auction_listings(id,platform,auction_state,source_status,auction_at,is_timed,buy_now_usd,fuel_type,timed_end_at)');
 const rows=[
  [1,'copart','unknown','unknown','2099-01-01',1,2000,'Electric'],
  [2,'iaai','','','2099-01-01',1,2000,'Electric'],
  [3,'copart','conflict','Open','2099-01-01',1,2000,'Electric'],
  [4,'iaai','open','Open','2099-01-01',1,2000,'Electric'],
  [5,'copart','upcoming','Upcoming',null,1,2000,'Electric'],
  [6,'iaai','open','Sold',null,1,2000,'Electric'],
  [7,'copart','unknown','Open',null,1,2000,'Electric'],
  [8,'iaai','open','unknown',null,1,2000,'Electric'],
  [9,'iaai',' Open ',' Sold ',null,1,2000,'Electric']
 ];
 for(const row of rows)db.prepare('INSERT INTO auction_listings(id,platform,auction_state,source_status,auction_at,is_timed,buy_now_usd,fuel_type) VALUES(?,?,?,?,?,?,?,?)').run(...row);
 const now=Date.parse('2026-10-07T12:00:00Z');
 for(const category of market.categories){
  const filter=market.sql(category.id,new Date(now).toISOString());
  const found=db.prepare(`SELECT id FROM auction_listings l WHERE ${filter.where.join(' AND ')} ORDER BY id`).all(...filter.values).map(row=>row.id);
  const client=rows.filter(row=>market.eligible({platform:row[1],auction:{state:row[2],source_status:row[3],auction_at:row[4],is_timed:!!row[5]},pricing:{buy_now_usd:row[6]},fuel_type:row[7]},category.id,now)).map(row=>row[0]);
  assert.deepEqual(found,[4,5],category.id);
  assert.deepEqual(client,found,category.id+' matches SQL');
 }
 assert.equal(db.prepare('SELECT count(*) AS count FROM auction_listings').get().count,9,'unknown observations remain in the unfiltered saved catalog');
 db.close();
});
