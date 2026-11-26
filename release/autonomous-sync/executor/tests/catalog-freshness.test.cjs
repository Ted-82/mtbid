const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function functionBlock(name) {
  let start = source.indexOf(`  function ${name}(`);
  if (start < 0) start = source.indexOf(`  async function ${name}(`);
  assert.ok(start >= 0, `Page function ${name} is present`);
  const next = /\n  (?:async )?function \w+\(/.exec(source.slice(start + 1));
  assert.ok(next);
  return source.slice(start, start + 1 + next.index);
}

function catalog() {
  const cars = {innerHTML:""};
  const status = {textContent:""};
  const notices = new Map(["catalogCoverage","homeCatalogCoverage"].map(id=>[id,{textContent:"",hidden:true,style:{display:"none"}}]));
  const context = {
    carsContainer:cars, resultStatus:status, lotStatus:{value:""},
    document:{getElementById:id=>notices.get(id)}, API_BASE:"/api",
    RexBidMarket:require("../public/rexbid-market.js"),
    localStorageApi:{safeImageUrl:()=>"",isFavorite:()=>false},
    getCarImage:()=>"", getTitle:car=>car.title, getVin:car=>car.vin, getLot:car=>car.lot_number,
    getPlatform:car=>car.platform, getMileage:()=>"42 000 mi", getLocation:()=>"Houston, TX", getDamage:()=>"Side",
    formatMoney:amount=>"$"+Number(amount).toLocaleString("en-US"),
    escapeHtml:value=>String(value??"").replace(/[&<>"']/g, char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]),
    Date, URLSearchParams
  };
  vm.createContext(context);
  const functions = ["hasApprovalPendingOutcome","getPriceInfo","getAuctionStatusLabel","parseConfirmedAuctionDate",
    "getConfirmedUpcomingDate","getAuctionDate","marketAislePriceInfo","renderMarketAisleCard","marketAisleCars","updateCatalogCoverage","loadMarketAisle","formatOfferCount","renderCars"];
  vm.runInContext(functions.map(functionBlock).join("\n")+`\n;globalThis.api={price:getPriceInfo,status:getAuctionStatusLabel,date:getAuctionDate,upcomingDate:getConfirmedUpcomingDate,home:marketAisleCars,render:renderCars,homeCard:renderMarketAisleCard,aislePrice:marketAislePriceInfo,coverage:updateCatalogCoverage,loadAisle:loadMarketAisle};`,context);
  return {api:context.api,context,cars,notices};
}

function car(overrides = {}) {
  return {title:"2022 Honda Accord",vin:"1HGCM82633A004352",lot_number:"62674546",platform:"copart",year:2022,
    auction:{state:"live",schedule_status:"live",auction_at:"2099-12-15T15:00:00Z"},
    pricing:{current_bid_usd:1200,buy_now_usd:5000}, ...overrides};
}

test("catalog dates saved bids and Buy Now independently while stale or unknown D1 cannot advertise a live auction", () => {
  for (const freshness of ["stale", "unknown"]) {
    const view = catalog();
    const record = car({read:{source:"d1",freshness,last_synced_at:"2026-10-05T09:00:00Z"}});
    assert.equal(view.api.status(record), "Status do potwierdzenia");
    assert.equal(view.api.price(record).value, 1200);
    assert.equal(view.api.price(record).label, "Ostatnia zapisana oferta");
    assert.equal(view.api.aislePrice(record,"buy-now").label, "Kup teraz · zapis danych");
    assert.equal(view.api.date(record), "");
    view.api.render([record]);
    assert.match(view.cars.innerHTML, /Zapis danych z 05\.10\.2026/);
    assert.match(view.cars.innerHTML, /Cena i dostępność do potwierdzenia/);
    assert.match(view.cars.innerHTML, /Ostatnia zapisana oferta/);
    assert.match(view.cars.innerHTML, /Kup teraz · zapis danych/);
    assert.doesNotMatch(view.cars.innerHTML, />Trwa<|Aktualna oferta|15\.12\.2099/);

    view.context.lotStatus.value="Buy Now";
    view.api.render([record]);
    assert.match(view.cars.innerHTML, /\$5,000/);
    assert.match(view.cars.innerHTML, /Ostatnia zapisana oferta · \$1,200/);
  }
});

test("Home categories exclude stale and unknown records despite retained active source status and price", () => {
  const view = catalog();
  const now = Date.now();
  for (const kind of ["current","timed","buy-now","electric","upcoming"]) {
    const base = car({fuel_type:"Electric",auction:{state:"open",schedule_status:"scheduled",auction_at:new Date(now+86400000).toISOString(),is_timed:true,timed_end_at:new Date(now+172800000).toISOString()}});
    const records=[{...base,lot_number:"FRESH",read:{source:"d1",freshness:"fresh"}}, {...base,lot_number:"STALE",read:{source:"d1",freshness:"stale"}}, {...base,lot_number:"UNKNOWN",read:{source:"d1",freshness:"unknown"}}, {...base,lot_number:"LEGACY"}];
    const result=view.api.home({data:records},kind,now);
    assert.equal(result.some(record=>record.lot_number==="STALE"),false,kind);
    assert.equal(result.some(record=>record.lot_number==="UNKNOWN"),false,kind);
    assert.deepEqual(Array.from(result,record=>record.lot_number),["FRESH","LEGACY"],kind);
  }
  const upcoming=car({auction:{state:"upcoming",schedule_status:"scheduled",auction_at:new Date(now+86400000).toISOString()},read:{source:"d1",freshness:"unknown"}});
  assert.equal(view.api.upcomingDate(upcoming), "");
});

test("freshly observed unknown availability does not make a retained bid, Buy Now or auxiliary date current", () => {
  for (const platform of ["copart", "iaai"]) {
    const view=catalog();
    const record=car({platform,read:{source:"d1",freshness:"fresh",last_synced_at:"2026-10-07T12:00:00Z"},
      auction:{state:"unknown",source_status:"unknown",schedule_status:"scheduled",auction_at:"2099-12-15T15:00:00Z",is_timed:true}});
    assert.equal(view.api.price(record).value,1200,"retained observation is not erased");
    assert.equal(view.api.price(record).label,"Ostatnia zapisana oferta");
    assert.equal(view.api.aislePrice(record,"buy-now").value,5000);
    assert.equal(view.api.aislePrice(record,"buy-now").label,"Kup teraz · zapis danych");
    assert.equal(view.api.status(record),"Status do potwierdzenia");
    assert.equal(view.api.date(record),"");
    for (const kind of ["current","timed","buy-now","electric"]) assert.equal(view.api.home({data:[{...record,fuel_type:"Electric"}]},kind).length,0,kind);
    view.api.render([record]);
    assert.match(view.cars.innerHTML,/Ostatnia zapisana oferta/);
    assert.doesNotMatch(view.cars.innerHTML,/Aktualna oferta|15\.12\.2099/);
  }
});

test("fresh D1 and legacy provider records preserve live pricing while previews remain explicitly saved data", () => {
  const view=catalog();
  for (const read of [undefined,{source:"d1",freshness:"fresh"}]) {
    const record=car({read});
    assert.equal(view.api.price(record).label,"Aktualna oferta");
    assert.equal(view.api.status(record),"Trwa");
    view.api.render([record]);
    assert.doesNotMatch(view.cars.innerHTML,/Zapis danych z/);
  }
  const preview=car({preview:{read_only:true,freshness:"fresh",last_synced_at:"2026-10-05T09:00:00Z"}});
  assert.equal(view.api.price(preview).label,"Ostatnia zapisana oferta");
  assert.equal(view.api.status(preview),"Podgląd zapisanej aukcji");
  assert.match(view.api.homeCard(preview,"buy-now"),/Kup teraz · zapis danych/);
});

test("fresh Home and catalog records retain observation time while source zero means unavailable bid", () => {
  const view=catalog();
  const record=car({pricing:{current_bid_usd:0,buy_now_usd:null},read:{source:"d1",freshness:"fresh",last_synced_at:"2026-10-14T08:05:00Z"}});
  view.api.render([record]);
  assert.match(view.cars.innerHTML,/Odczyt źródła z 14\.10\.2026, 10:05/);
  assert.match(view.cars.innerHTML,/Aktualna oferta/);
  assert.match(view.cars.innerHTML,/Brak danych o ofercie/);
  assert.doesNotMatch(view.cars.innerHTML,/\$0/);
  assert.match(view.api.homeCard(record,"current"),/Odczyt źródła z 14\.10\.2026, 10:05/);
  assert.equal(record.read.last_synced_at,"2026-10-14T08:05:00Z");
  const undated=car({read:{source:"d1",freshness:"fresh"}});
  assert.match(view.api.homeCard(undated,"current"),/data nieustalona/);
});

test("catalog coverage uses current completeness instead of a historical completed snapshot and validates stored counts", () => {
  const view=catalog();
  view.api.coverage({meta:{catalog_complete:false,stored_catalog_complete:true,scope_status:"partial",stored_row_count:9876,platform_coverage:[{platform:"copart",complete:false,status:"partial",freshness:"fresh"}]}});
  const notice=view.notices.get("catalogCoverage");
  assert.equal(notice.hidden,false);
  assert.match(notice.textContent,/Katalog częściowy/);
  assert.match(notice.textContent,/9\s*876 zapisanych ofert/);
  assert.doesNotMatch(notice.textContent,/Katalog zaktualizowany/);
  assert.equal(view.notices.get("homeCatalogCoverage").textContent,notice.textContent);

  for (const stored_row_count of ["9876",-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
    view.api.coverage({meta:{catalog_complete:false,scope_status:"partial",stored_row_count}});
    assert.doesNotMatch(notice.textContent,/zapisanych ofert/);
  }
  view.api.coverage({meta:{stored_catalog_complete:true}});
  assert.doesNotMatch(notice.textContent,/Katalog zaktualizowany/);
  view.api.coverage({meta:{catalog_complete:"true",stored_row_count:9876}});
  assert.equal(notice.hidden,true,"malformed metadata cannot claim full coverage");
});

test("current full coverage is displayed only with consistent scope metadata, while stale and unknown are explicit", () => {
  const view=catalog();
  const complete={catalog_complete:true,scope_status:"complete",stored_row_count:0,platform_coverage:[{platform:"copart",complete:true,status:"complete",scope_freshness:"fresh"},{platform:"iaai",complete:true,status:"complete",freshness:"fresh"}]};
  view.api.coverage({meta:complete});
  const notice=view.notices.get("catalogCoverage");
  assert.match(notice.textContent,/Katalog zaktualizowany · 0 zapisanych ofert/);
  view.api.coverage({meta:{...complete,catalog_complete:false}});
  assert.match(notice.textContent,/Katalog częściowy/);
  for (const freshness of ["stale","unknown"]) {
    view.api.coverage({meta:{...complete,scope_status:freshness,platform_coverage:[{platform:"copart",complete:false,status:freshness,scope_freshness:freshness}]}});
    assert.match(notice.textContent,/Katalog częściowy/);
    assert.match(notice.textContent,freshness==="stale"?/wymagają odświeżenia/:/Aktualność danych niepotwierdzona/);
    view.api.coverage({meta:{...complete,freshness:{status:freshness}}});
    assert.doesNotMatch(notice.textContent,/Katalog zaktualizowany/,"record freshness cannot contradict a current-catalog claim");
    assert.match(notice.textContent,freshness==="stale"?/wymagają odświeżenia/:/Aktualność danych niepotwierdzona/);
  }
  for (const scope_status of ["failed","missing"]) {
    view.api.coverage({meta:{...complete,scope_status}});
    assert.doesNotMatch(notice.textContent,/Katalog zaktualizowany/);
  }
  view.api.coverage({meta:{...complete,platform_coverage:[{platform:"copart",complete:true,status:"failed",scope_freshness:"fresh"}]}});
  assert.doesNotMatch(notice.textContent,/Katalog zaktualizowany/);
  view.api.coverage({data:[car()],meta:{next_cursor:null}});
  assert.equal(notice.hidden,true,"legacy cursor metadata does not fabricate source coverage");
});

test("Home consumes coverage from its existing aisle response without any additional API requests", async () => {
  const view=catalog();
  const requests=[];
  view.context.fetch=async url=>{
    requests.push(url);
    return {ok:true,json:async()=>({ok:true,data:[car()],meta:{catalog_complete:false,stored_row_count:37,scope_status:"unknown"}})};
  };
  const target={innerHTML:""};
  const section={dataset:{kind:"current"},querySelector:()=>target};
  await view.api.loadAisle(section);
  assert.equal(requests.length,1);
  assert.match(target.innerHTML,/Honda Accord/);
  assert.match(view.notices.get("homeCatalogCoverage").textContent,/37 zapisanych ofert/);
  assert.match(view.notices.get("homeCatalogCoverage").textContent,/Aktualność danych niepotwierdzona/);
});

test("catalog result fetch surfaces API coverage without changing result count or issuing a separate metadata request", async () => {
  const script=[...source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(match=>!/\bsrc=/.test(match[1]))[2];
  const startup=script.lastIndexOf("  restoreFiltersFromUrl();");
  assert.ok(startup>0);
  const elements=new Map();
  const node=id=>{
    if(!elements.has(id))elements.set(id,{id,value:"",textContent:"",innerHTML:"",hidden:false,disabled:false,style:{},dataset:{},addEventListener(){},querySelectorAll(){return [];},getAttribute(){return null;},replaceChildren(){},setAttribute(){}});
    return elements.get(id);
  };
  const requests=[];
  const context={document:{getElementById:node,querySelectorAll:()=>[]},window:{location:{href:"https://rexbid.pl/?catalog=1",pathname:"/",search:"?catalog=1",hash:""},addEventListener(){}},URL,URLSearchParams,Response,console:{error(){},warn(){}},RexBidMarket:require("../public/rexbid-market.js"),fetch:async url=>{
    requests.push(url);
    return new Response(JSON.stringify({ok:true,data:[car()],meta:{next_cursor:null,catalog_complete:false,stored_catalog_complete:true,scope_status:"stale",stored_row_count:823}}),{headers:{"content-type":"application/json"}});
  }};
  vm.createContext(context);
  vm.runInContext(script.slice(0,startup)+"\n;globalThis.loadCatalog=loadCars;",context);
  await context.loadCatalog({updateUrl:false});
  assert.equal(requests.length,1);
  assert.equal(node("resultStatus").textContent,"Wyświetlono 1 ofertę");
  assert.match(node("catalogCoverage").textContent,/Katalog częściowy · 823 zapisanych ofert/);
  assert.match(node("catalogCoverage").textContent,/wymagają odświeżenia/);
  assert.equal(node("catalogCoverage").hidden,false);
});
