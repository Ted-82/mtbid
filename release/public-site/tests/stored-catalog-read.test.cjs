const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");
const {handleStoredRead, handlePrimaryRead, STAGING_HOST} = require("../staging/d1-primary-reads.cjs");

const ROOT=path.join(__dirname,"..");
const TARGET="rexbid-production-preflight-db";
const DATABASE_ID="c8a30088-70af-43a6-9a7f-c4018279d37d";
const OLD="2020-01-01T09:00:00.000Z";
const OLD_SEEN="2020-01-02T10:30:00.000Z";
const OLD_EVENT="2019-12-20T15:00:00.000Z";

class D1Fixture {
  constructor(sqlite){this.sqlite=sqlite;this.queries=[];}
  prepare(sql){
    assert.match(sql,/^\s*SELECT\b/i,"public reads never issue database mutations");
    this.queries.push(sql);
    const query=this.sqlite.prepare(sql);
    const methods=params=>({async first(){return query.get(...params)||null;},async all(){return {results:query.all(...params)};}});
    return {...methods([]),bind(...params){return methods(params);}};
  }
}

function fixture(t, {upcoming = false, mixedDates = false, session = false} = {}) {
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for(const file of ["migrations/0000_rexbid_base.sql","migrations/0001_auction_history_events.sql","migrations-staging/0003_accounts_foundation.sql","docs/proposals/0004_d1_sync_2.sql"])
    sqlite.exec(fs.readFileSync(path.join(ROOT,file),"utf8"));
  const fresh=new Date(Date.now()-60_000).toISOString();
  const auctionAt=new Date(Date.now()+86400000).toISOString();
  const timedEndAt=new Date(Date.now()+2*86400000).toISOString();
  for(const platform of ["copart","iaai"])
    sqlite.prepare(`INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,cursor,last_complete_at,updated_at)
      VALUES(?,?,?,'discovery',?,?,?,?)`).run("scope-"+platform,"apibara",platform,platform==="copart"?"complete":"partial",platform==="copart"?null:"opaque-provider-cursor",platform==="copart"?OLD:null,OLD);
  const rows=[
    {id:"copart-old",platform:"copart",lot:"62674546",vin:"1HGCM82633A004352",make:"Honda",model:"Accord",seen:OLD_SEEN,synced:OLD,bid:null,buy:null,odometer:null},
    {id:"iaai-old",platform:"iaai",lot:"45439613",vin:"WBA5R1C06MFK00001",make:"BMW",model:"330i",seen:OLD_SEEN,synced:OLD,bid:2500,buy:6000,odometer:42000},
    {id:"copart-fresh",platform:"copart",lot:"SHARED-LOT",vin:"1HGCM82633A004353",make:"Honda",model:"Civic",seen:fresh,synced:fresh,bid:1200,buy:5000,odometer:15000},
    {id:"iaai-fresh",platform:"iaai",lot:"SHARED-LOT",vin:"WBA5R1C06MFK00002",make:"BMW",model:"i4",seen:fresh,synced:fresh,bid:0,buy:7000,odometer:0}
  ];
  for(const row of rows){
    const source="source-"+row.id;
    sqlite.prepare(`INSERT INTO vehicle_sources(source_key,provider,platform,provider_vehicle_id,identity_kind,identity_state,first_seen_at,last_seen_at,last_success_at,sync_status,created_at,updated_at)
      VALUES(?,'apibara',?,?,'provider_vehicle_id','resolved',?,?,?,'idle',?,?)`).run(source,row.platform,"provider-"+row.id,OLD,row.seen,row.synced,OLD,row.seen);
    sqlite.prepare(`INSERT INTO auction_listings(listing_id,source_key,platform,listing_identity_kind,identity_state,source_listing_id,vin_normalized,lot,vehicle_title,make,model,year,body_style,fuel_type,auction_state,source_status,auction_at,is_timed,timed_end_at,current_bid_usd,buy_now_usd,odometer_value,odometer_unit,location_display,location_state,keys_present,first_seen_at,last_seen_at,summary_synced_at,freshness_class,created_at,updated_at)
      VALUES(?,?,?,'source_listing_id','resolved',?,?,?,?,?,?,2022,'Sedan','Electric','open','Open',?,1,?,?,?,?,'mi','Houston, TX','TX',NULL,?,?,?,'warm',?,?)`)
      .run(row.id,source,row.platform,row.lot,row.vin,row.lot,"2022 "+row.make+" "+row.model,row.make,row.model,auctionAt,timedEndAt,row.bid,row.buy,row.odometer,OLD,row.seen,row.synced,OLD,row.seen);
    sqlite.prepare(`INSERT INTO auction_listing_snapshots(listing_id,observed_at,auction_state,auction_at,current_bid_usd,buy_now_usd,fingerprint,normalizer_version)
      VALUES(?,?,'open',?,?,?,?,1)`).run(row.id,row.synced,auctionAt,row.bid,row.buy,"fingerprint-"+row.id);
  }
  sqlite.prepare(`INSERT INTO auction_events(event_id,listing_id,source_key,provider,platform,provider_event_id,event_key,vin_normalized,lot,auction_date,sale_date,source_status,canonical_status,final_price_usd,source_price_usd,observed_at,created_at,updated_at)
    VALUES('confirmed-old','iaai-old','source-iaai-old','apibara','iaai','provider-event','event-key','WBA5R1C06MFK00001','45439613','2019-12-20','2019-12-20','Sold','sold',2800,3300,?,?,?)`).run(OLD_EVENT,OLD_EVENT,OLD_EVENT);
  if (upcoming) {
    const firstAuction = Date.now() + 86_400_000;
    const update = sqlite.prepare(`UPDATE auction_listings SET year=2025,make='SUBARU',
      auction_at=?,is_timed=0,timed_end_at=NULL,summary_synced_at=?,media_thumbs_json=? WHERE listing_id=?`);
    rows.forEach((row, index) => update.run(new Date(firstAuction + index * 60_000).toISOString(), fresh,
      JSON.stringify(["https://images.example.net/cover.jpg"]), row.id));
  }
  if(mixedDates){
    sqlite.exec("UPDATE auction_listings SET is_timed=0,timed_end_at=NULL");
    sqlite.prepare("UPDATE auction_listings SET auction_at=NULL WHERE listing_id='copart-old'").run();
    sqlite.prepare("UPDATE auction_listings SET auction_at=? WHERE listing_id='iaai-old'").run(OLD_EVENT);
    sqlite.prepare("UPDATE auction_listings SET auction_at=? WHERE listing_id='copart-fresh'").run(new Date(Date.now()+500*86400000).toISOString());
  }
  if(session){
    sqlite.exec("UPDATE auction_listings SET auction_state='live',source_status='in_progress',is_timed=0,auction_at=NULL,timed_end_at=NULL");
    sqlite.prepare("UPDATE auction_listings SET auction_at=? WHERE listing_id='iaai-fresh'").run(fresh);
    sqlite.prepare("UPDATE auction_listings SET is_timed=1,timed_end_at=? WHERE listing_id='copart-fresh'").run(timedEndAt);
  }
  const d1=new D1Fixture(sqlite);
  const env={REXBID_RELEASE_D1_TARGET:TARGET,REXBID_RELEASE_D1_DATABASE_ID:DATABASE_ID,REXBID_PUBLIC_CATALOG_MODE:"stored",REXBID_DB:d1};
  const before=sqlite.prepare("SELECT total_changes() AS count").get().count;
  const network=t.mock.method(globalThis,"fetch",async()=>{throw new Error("external fetch is forbidden in a stored catalog read");});
  const log=t.mock.method(console,"info",()=>{});
  t.after(()=>{
    try {
      assert.equal(network.mock.callCount(),0,"no provider or other network request");
      assert.equal(sqlite.prepare("SELECT total_changes() AS count").get().count,before,"stored reads do not change timestamps or rows");
    } finally {sqlite.close();}
  });
  return {sqlite,d1,env,rows,fresh,network,log};
}

const request=(route,{origin="https://rexbid.pl",method="GET"}={})=>new Request(origin+route,{method,headers:{Cookie:"fixture-session=ignored"}});
async function read(route,env){
  const response=await handleStoredRead(request(route),env);
  assert.ok(response,route);
  assert.equal(response.headers.get("Set-Cookie"),null,route);
  assert.equal(response.headers.get("Cache-Control"),"private, no-store",route);
  return {response,body:await response.json()};
}

test("saved catalog cards and home showcase render results instead of passing the array index as a DTO", async t => {
  const {env} = fixture(t, {upcoming: true});
  const firstPath = "/api/cars?view=cards&make=SUBARU&year_from=2025&per_page=1";
  const first = await read(firstPath, env);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.data[0].make, "SUBARU");
  assert.equal(first.body.data[0].image, "https://images.example.net/cover.jpg");
  assert.ok(first.body.meta.next_cursor);
  const next = await read(firstPath + "&cursor=" + encodeURIComponent(first.body.meta.next_cursor), env);
  assert.equal(next.response.status, 200);
  assert.notEqual(next.body.data[0].vin, first.body.data[0].vin);
  for (const params of ["view=cards&category=electric", "view=showcase&category=current&home_week=1&with_photo=1"]) {
    const {response, body} = await read("/api/cars?per_page=2&" + params, env);
    assert.equal(response.status, 200, params);
    assert.equal(body.data.length, 2, params);
    assert.equal(body.data[0].image, "https://images.example.net/cover.jpg");
  }
});

test("customer search accepts copied LOT/VIN labels and a model year at either end",async t=>{
 const f=fixture(t);
 for(const term of ['LOT 62674546','Nr LOT: 62674546','VIN: 1hgcm82633a004352','Honda  Accord  2022','2022 Honda Accord']){
   const {body}=await read('/api/cars?s='+encodeURIComponent(term),f.env);
   assert.deepEqual(body.data.map(x=>x.lot_number),['62674546'],term);
 }
 assert.equal((await read('/api/cars?s=Honda%20Accord%202021',f.env)).body.data.length,0);
 assert.equal((await read('/api/cars?s=Honda%20Accord%202022&year_from=2023',f.env)).body.data.length,0);
});
test("public results show only dated eligible auctions while exact saved histories remain readable",async t=>{
  const {env,rows}=fixture(t,{mixedDates:true});
  const list=await read('/api/cars?sort=auction_next&per_page=1',env);
  assert.equal(list.response.status,200);
  assert.deepEqual(list.body.data.map(row=>row.vin),[rows[3].vin]);
  assert.equal(list.body.meta.next_cursor,null);
  const pending=await read('/api/car/'+rows[0].vin+'?platform=copart',env);
  assert.equal(pending.response.status,404);
  assert.equal(pending.body.error,'auction_date_pending');
  for(const row of rows.slice(0,3)){
    const history=await read('/api/car/'+row.vin+'/history?platform='+row.platform,env);
    assert.equal(history.response.status,200);
    assert.equal(history.body.identity.vin,row.vin);
    assert.equal(history.body.rex_history.snapshots.length,1);
  }
});
test("public Live cards and details retain an assigned start after the session begins, while an undated lot remains history-only",async t=>{
  t.mock.method(Date,'now',()=>Date.parse('2026-11-25T18:00:00Z'));
  const {env, rows, fresh} = fixture(t,{session:true});
  const {body} = await read('/api/cars?lot_sub_status=Live&view=cards&per_page=1',env);
  const next = await read('/api/cars?lot_sub_status=Live&view=cards&per_page=1&cursor='+encodeURIComponent(body.meta.next_cursor),env);
  const offers=[...body.data,...next.body.data];
  assert.deepEqual(offers.map(car=>car.vin).sort(),[rows[2].vin,rows[3].vin].sort());
  assert.equal(next.body.meta.next_cursor,null);
  const regular=offers.find(car=>car.platform==='iaai');
  assert.equal(regular.auction.auction_at,fresh);
  assert.equal(regular.auction.state,'live');
  assert.equal(regular.auction.phase,'in_progress');
  const detail=await read('/api/car/'+regular.lot_number+'?platform=iaai',env);
  assert.equal(detail.response.status,200);
  assert.deepEqual(detail.body.data.auction,regular.auction);
  const timed=offers.find(car=>car.platform==='copart');
  for(const sort of ['auction_next','auction_later','year_desc']){
    const sorted=await read('/api/cars?lot_sub_status=Live&view=cards&sort='+sort,env);
    assert.deepEqual(sorted.body.data.map(car=>car.vin).sort(),[regular.vin,timed.vin].sort());
  }
  assert.equal(timed.auction.auction_at,null);
  assert.equal(timed.auction.is_timed,true);
  assert.ok(Date.parse(timed.auction.timed_end_at)>Date.now());
  assert.equal((await read('/api/car/'+rows[1].vin+'?platform=iaai',env)).body.error,'auction_date_pending');
  assert.equal((await read('/api/car/'+rows[1].vin+'/history?platform=iaai',env)).body.identity.vin,rows[1].vin);
});
test("indexed make candidates preserve model, platform and cursor restrictions",async t=>{
 const f=fixture(t);
 const exact=await read('/api/cars?s=BMW%20330i&platform=iaai',f.env);
 assert.deepEqual(exact.body.data.map(x=>x.lot_number),['45439613']);
 assert.ok(f.d1.queries.some(q=>q.includes('FROM auction_listings WHERE upper(trim(make)) IN (?) AND (instr(')));
 const a=await read('/api/cars?s=Honda&per_page=1',f.env);
 assert.ok(a.body.meta.next_cursor);
 const b=await read('/api/cars?s=Honda&per_page=1&cursor='+encodeURIComponent(a.body.meta.next_cursor),f.env);
 assert.equal(b.body.data.length,1);assert.equal(b.body.data[0].make,'Honda');assert.notEqual(b.body.data[0].lot_number,a.body.data[0].lot_number);
 assert.equal((await read('/api/cars?s=BMW%20330i&make=Honda',f.env)).body.data.length,0);
 assert.equal((await read('/api/cars?s=Accord',f.env)).body.data[0].lot_number,'62674546');
});

test("stored read requires the exact isolated origin, D1 name+ID and mode before any database read",async t=>{
  const f=fixture(t);
  for(const origin of ["http://rexbid.pl","https://www.rexbid.pl","https://mtbid.tedn828.workers.dev","https://rexbid.pl.evil.example","https://rexbid.pl:444"])
    assert.equal(await handleStoredRead(request("/api/cars",{origin}),f.env),null,origin);
  for(const change of [{REXBID_RELEASE_D1_TARGET:"rexbid-db"},{REXBID_RELEASE_D1_TARGET:"rexbid-auth-test-db"},{REXBID_RELEASE_D1_DATABASE_ID:"971879fe-04ed-4e8c-9dc6-5306980bb872"},{REXBID_PUBLIC_CATALOG_MODE:"provider"},{REXBID_PUBLIC_CATALOG_MODE:undefined}])
    assert.equal(await handleStoredRead(request("/api/cars"),{...f.env,...change}),null);
  assert.equal(await handleStoredRead(request("/api/cars",{method:"POST"}),f.env),null);
  assert.equal(await handleStoredRead(request("/api/private/anything"),f.env),null);
  assert.equal(f.d1.queries.length,0);
  assert.equal((await read("/api/cars",f.env)).response.status,200);
});

test("all-known lists preserve old rows, dates and missing values, whereas explicit categories select fresh rows before paging",async t=>{
  const f=fixture(t);
  const {response,body}=await read("/api/cars?per_page=10",f.env);
  assert.equal(response.status,200);assert.equal(body.data.length,4);
  assert.equal(body.meta.known_rows_only,true);assert.equal(body.meta.catalog_complete,false);
  assert.equal(body.meta.scope_status,"partial");assert.equal(body.meta.data_status,"last_known");
  assert.equal(body.meta.provider_fallback_enabled,false);assert.equal(body.meta.freshness.status,"stale");
  assert.equal(body.meta.platform_coverage.length,2);
  const old=body.data.find(row=>row.lot_number==="62674546"),fresh=body.data.find(row=>row.platform==="iaai"&&row.lot_number==="SHARED-LOT");
  assert.equal(old.last_seen_at,OLD_SEEN);assert.equal(old.last_synced_at,OLD);assert.equal(old.freshness_status,"stale");
  assert.equal(old.read.source,"d1");assert.equal(old.read.freshness,"stale");assert.equal(old.read.last_synced_at,OLD);
  assert.equal(old.pricing.current_bid_usd,null);assert.equal(old.pricing.buy_now_usd,null);
  assert.equal(old.odometer,null);assert.equal(old.condition.has_key,null);
  assert.equal(fresh.pricing.current_bid_usd,0);assert.equal(fresh.odometer.value,0);
  for(const category of ["current","timed","buy-now","electric"]){
    const result=await read("/api/cars?category="+category+"&per_page=1",f.env);
    assert.equal(result.body.data.length,1,category);
    assert.equal(result.body.data[0].freshness_status,"fresh",category);
    assert.equal(result.body.data[0].last_synced_at,f.fresh,category);
    assert.ok(result.body.meta.next_cursor,"fresh filtering occurs before page limit: "+category);
    const next=await read("/api/cars?category="+category+"&per_page=1&cursor="+encodeURIComponent(result.body.meta.next_cursor),f.env);
    assert.equal(next.body.data.length,1,category);assert.equal(next.body.data[0].freshness_status,"fresh",category);
    assert.equal(next.body.meta.next_cursor,null,category);
  }
});

test("stale exact detail and history remain stored, with observed snapshots separate from confirmed sales",async t=>{
  const f=fixture(t);
  for(const row of f.rows.filter(row=>row.synced===OLD)){
    const detail=await read("/api/car/"+row.vin+"?platform="+row.platform,f.env);
    assert.equal(detail.response.status,200);assert.equal(detail.body.data.lot_number,row.lot);
    assert.equal(detail.body.match,"exact");assert.equal(detail.body.read_source,"d1");
    assert.equal(detail.body.read.freshness,"stale");assert.equal(detail.body.read.data_status,"last_known");
    assert.equal(detail.body.read.provider_fallback_enabled,false);assert.equal(detail.body.read.last_synced_at,OLD);
    const history=await read("/api/car/"+row.lot+"/history?platform="+row.platform,f.env);
    assert.equal(history.response.status,200);assert.equal(history.body.read_source,"d1");
    assert.equal(history.body.read.freshness,"stale");assert.equal(history.body.read.provider_fallback_enabled,false);
    assert.equal(history.body.rex_history.snapshots[0].observed_at,OLD);
    assert.equal(history.body.rex_history.snapshots[0].kind,"observed_snapshot");
    if(row.platform==="copart"){
      assert.deepEqual(history.body.history,[]);assert.equal(history.body.rex_history.kind,"snapshots_only");
      assert.equal(history.body.rex_history.snapshots[0].current_bid_usd,null);
    }else{
      assert.equal(history.body.rex_history.kind,"events_and_snapshots");
      assert.equal(history.body.history[0].kind,"confirmed_auction_event");
      assert.equal(history.body.history[0].final_price,2800);assert.equal(history.body.history[0].source_price,3300);
      assert.equal(history.body.history[0].observed_at,OLD_EVENT);
    }
  }
  let calls=0;
  const stagingEnv={...f.env,REXBID_AUTH_TEST_UI:"enabled",REXBID_AUTH_TEST_HOST:STAGING_HOST,REXBID_D1_READ_TARGET:"rexbid-auth-test-db",REXBID_D1_PRIMARY_READS:"true",REXBID_D1_PROVIDER_FALLBACK:"disabled"};
  const delegated=await handlePrimaryRead(request("/api/car/62674546",{origin:"https://"+STAGING_HOST}),stagingEnv,null,async()=>{calls++;throw new Error("must not delegate");});
  assert.equal(delegated.status,200);assert.equal(calls,0,"staging disabled-fallback mode also retains old detail");
});

test("missing and ambiguous identities, unavailable binding and mismatched schema return explicit errors without delegation",async t=>{
  const f=fixture(t);
  for(const route of ["/api/car/NOT-STORED","/api/car/NOT-STORED/history","/api/car/1HGCM82633A00435?platform=copart"]){
    const result=await read(route,f.env);
    assert.equal(result.response.status,404,route);assert.equal(result.body.error,"vehicle_not_in_saved_catalog");
    assert.equal(result.body.read.provider_fallback_enabled,false);
  }
  for(const suffix of ["","/history"]){
    const ambiguous=await read("/api/car/SHARED-LOT"+suffix,f.env);
    assert.equal(ambiguous.response.status,409);assert.equal(ambiguous.body.error,"ambiguous_identifier_choose_platform");
  }
  const exact=await read("/api/car/SHARED-LOT?platform=iaai",f.env);
  assert.equal(exact.response.status,200);assert.equal(exact.body.data.vin,"WBA5R1C06MFK00002");
  const unavailable=await read("/api/cars",{...f.env,REXBID_DB:undefined});
  assert.equal(unavailable.response.status,503);assert.equal(unavailable.body.error,"saved_catalog_temporarily_unavailable");
  const brokenSchema={prepare(){throw new Error("fixture private schema diagnostic");}};
  const mismatch=await read("/api/filters",{...f.env,REXBID_DB:brokenSchema});
  assert.equal(mismatch.response.status,503);assert.equal(mismatch.body.error,"saved_catalog_temporarily_unavailable");
  assert.doesNotMatch(JSON.stringify(mismatch.body),/fixture private schema/);
});

test("known-row filters stay partial across platform scopes and expose only actual stored options",async t=>{
  const f=fixture(t);
  const all=await read("/api/filters",f.env),copart=await read("/api/filters?platform=copart",f.env);
  assert.equal(all.body.meta.metadata_complete,false);assert.equal(all.body.meta.known_rows_only,true);
  assert.equal(all.body.meta.row_count,4);assert.equal(all.body.meta.catalog_complete,false);
  assert.equal(copart.body.meta.row_count,2);assert.equal(copart.body.meta.catalog_complete,false,"one complete platform cannot claim a complete global catalog");
  assert.equal(copart.body.meta.platform_coverage.length,2);
  assert.deepEqual(copart.body.data.makes,[{value:"Honda",label:"Honda"}]);
  assert.deepEqual(copart.body.data.models.sort((a,b)=>a.model.localeCompare(b.model)),[{make:"Honda",model:"Accord"},{make:"Honda",model:"Civic"}]);
  assert.deepEqual(copart.body.data.states,["TX"]);
  assert.equal(copart.body.data.price_ranges,undefined,"a missing metadata range is not fabricated as zero");
});

test("public reads scan coverage once per request and a later request sees changed coverage",async t=>{
  const f=fixture(t);
  let completed=false;
  f.env.REXBID_DB={prepare(sql){
    const statement=f.d1.prepare(sql);
    if (!sql.includes("operation='discovery'")) return statement;
    return {...statement, async all(){
      const result=await statement.all();
      return {results:result.results.map(row=>completed?{...row,status:'complete',cursor:null}:row)};
    }};
  }};
  for(const route of ["/api/cars", "/api/filters", "/api/car/62674546?platform=copart", "/api/car/62674546/history?platform=copart"]){
    const before=f.d1.queries.length;
    const result=await read(route,f.env);
    assert.equal(result.response.status,200);
    assert.equal(f.d1.queries.slice(before).filter(sql=>sql.includes("operation='discovery'")).length,1);
  }
  const previous=await read("/api/cars",f.env);
  assert.equal(previous.body.meta.catalog_complete,false);
  completed=true;
  const current=await read("/api/cars",f.env);
  assert.equal(current.body.meta.catalog_complete,true,"coverage is not cached across public requests");
});


test('reversed year bounds return a clear error before touching D1 or a provider',async t=>{
 const f=fixture(t);const invalid=await read('/api/cars?year_from=2025&year_to=2022',f.env);
 assert.equal(invalid.response.status,400);assert.equal(invalid.body.ok,false);assert.equal(invalid.body.error,'invalid_year_range');assert.match(invalid.body.message,/Rok od/);assert.equal(f.d1.queries.length,0);
 for(const query of ['year_from=2022','year_to=2022','year_from=2022&year_to=2022','']){const result=await read('/api/cars?'+query,f.env);assert.equal(result.response.status,200);assert.ok(result.body.data.length>0);}
});
