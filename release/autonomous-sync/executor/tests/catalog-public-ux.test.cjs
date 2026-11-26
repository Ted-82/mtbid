const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const market = require("../public/rexbid-market.js");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const inline = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(match => !/\bsrc=/.test(match[1]))[2];
const startup = inline.lastIndexOf("  restoreFiltersFromUrl();");
const flush = () => new Promise(resolve => setImmediate(resolve));

function car(lot="62674546", platform="copart", overrides={}) {
  return {title:"2022 Honda Accord",year:2022,vin:"1HGCM82633A004352",lot_number:lot,platform,
    auction:{state:"open",schedule_status:"unassigned"},pricing:{current_bid_usd:1200,buy_now_usd:5000},
    odometer:{value:42000,unit:"mi"},location:{display:"Houston, TX"},...overrides};
}

// Actual public HTML + handlers with synthetic fetch only. This verifies DOM
// behavior, not browser layout, provider data, deployment or network freshness.
function page(t, query="?catalog=1") {
  const dom = new JSDOM(html, {url:"https://rexbid.pl/"+query,runScripts:"outside-only"});
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document, requests = [], scrolls = [];
  win.RexBidMarket = market;
  win.RexBidStorage = {safeImageUrl:()=>"",isFavorite:()=>false,refreshCounts(){}};
  win.matchMedia = () => ({matches:true});
  win.scrollTo = options => scrolls.push(options);
  win.requestAnimationFrame = callback => callback();
  win.HTMLElement.prototype.scrollIntoView = function(){};
  let respond = () => ({ok:true,data:[car()],meta:{next_cursor:null}});
  win.fetch = async (url, options) => {
    requests.push({url,options});
    return new Response(JSON.stringify(await respond(url,options)), {headers:{"content-type":"application/json"}});
  };
  win.console.error = () => {};
  win.console.warn = () => {};
  win.eval(inline.slice(0,startup)+`\n;globalThis.catalogApi={load:loadCars,restore:restoreFiltersFromUrl,save:saveCatalogHistory,
    restoreHistory:restoreCatalogHistory,render:renderCars,merge:mergeCarsWithoutDuplicates,
    metadata:setMetadataOptions,indicators:updateFilterIndicators,category:()=>categoryInput.value,loadAisle:loadMarketAisle};`);
  win.catalogApi.restore();
  return {win,doc,requests,scrolls,api:win.catalogApi,node:id=>doc.getElementById(id),respond(fn){respond=fn;}};
}

test("category URLs choose Buy Now as the primary price and preserve exact card identity + return filters", async t => {
  const p=page(t,"?catalog=1&category=buy-now&platform=iaai&make=Honda");
  const record=car("LOT 7&platform=copart","iaai",{vin:"VIN/7?&LOT=999"});
  p.respond(()=>({ok:true,data:[record],meta:{next_cursor:null}}));
  await p.api.load({updateUrl:false});
  const card=p.node("cars").querySelector("article"), price=card.querySelector(".rex-card-price");
  assert.equal(price.querySelector("small").textContent,"Kup teraz");
  assert.match(price.querySelector("strong").textContent,/\$5,000/);
  assert.match(card.querySelector(".card-secondary-price").textContent,/Aktualna oferta · \$1,200/);
  const url=new URL(card.querySelector("a").href);
  assert.equal(url.searchParams.get("lot"),record.lot_number);
  assert.equal(url.searchParams.get("vin"),record.vin);
  assert.equal(url.searchParams.get("platform"),"iaai");
  assert.equal(url.searchParams.getAll("platform").length,1);
  assert.equal(url.searchParams.get("return_to"),"/?catalog=1&category=buy-now&platform=iaai&make=Honda#results");
  assert.equal(p.node("activeFilterChips").querySelector('[data-filter-id="category"]').getAttribute("aria-label"),"Usuń filtr: Kategoria — Kup teraz");
});

test("Buy Now catalog does not repeat its fallback price as an unknown current bid, while observed bids remain separate", async t => {
  for(const query of ["?catalog=1&category=buy-now&platform=iaai","?catalog=1&lot_status=Buy+Now&platform=iaai"]){
    const p=page(t,query);
    const noBid=car("45636304","iaai",{pricing:{current_bid_usd:null,current_bid2_usd:null,buy_now_usd:650}});
    const withBid=car("45636305","iaai",{pricing:{current_bid_usd:25,current_bid2_usd:25,buy_now_usd:2000}});
    const sameAmount=car("45636306","iaai",{pricing:{current_bid_usd:25,current_bid2_usd:null,buy_now_usd:25}});
    const originals=JSON.stringify([noBid,withBid,sameAmount]);
    p.respond(()=>({ok:true,data:[noBid,withBid,sameAmount],meta:{next_cursor:null}}));
    await p.api.load({updateUrl:false});
    const [first,second,third]=p.node("cars").querySelectorAll("article");
    assert.equal(first.querySelector(".rex-card-price small").textContent,"Kup teraz");
    assert.match(first.querySelector(".rex-card-price strong").textContent,/\$650/);
    assert.equal(first.querySelector(".card-secondary-price"),null,"missing bid must not borrow Buy Now through the current-price fallback");
    assert.doesNotMatch(first.textContent,/Aktualna oferta/);
    assert.equal((first.textContent.match(/\$650/g)||[]).length,1);
    assert.equal(second.querySelector(".rex-card-price small").textContent,"Kup teraz");
    assert.match(second.querySelector(".rex-card-price strong").textContent,/\$2,000/);
    assert.equal(second.querySelector(".card-secondary-price").textContent,"Aktualna oferta · $25");
    assert.equal(third.querySelector(".card-secondary-price").textContent,"Aktualna oferta · $25","equal amounts are two separately observed price types");
    assert.equal(JSON.stringify([noBid,withBid,sameAmount]),originals,"rendering preserves null bids and the source payload");
  }
});

test("saved Buy Now without a bid has one saved price and keeps its observation note", async t => {
  const p=page(t,"?catalog=1&category=buy-now&platform=iaai");
  const record=car("45636304","iaai",{pricing:{current_bid_usd:null,current_bid2_usd:null,buy_now_usd:650},
    read:{source:"d1",freshness:"stale",last_synced_at:"2026-10-05T09:00:00Z"}});
  p.api.render([record]);
  const card=p.node("cars").querySelector("article");
  assert.equal(card.querySelector(".rex-card-price small").textContent,"Kup teraz · zapis danych");
  assert.equal(card.querySelector(".card-secondary-price"),null);
  assert.equal((card.textContent.match(/\$650/g)||[]).length,1);
  assert.match(card.textContent,/Zapis danych z 05\.10\.2026/);
  assert.doesNotMatch(card.textContent,/Aktualna oferta|Ostatnia zapisana oferta/);
});

test("removing a make chip clears its dependent model and keeps focus on a surviving control", async t => {
  const p=page(t,"?catalog=1&make=Honda&model=Accord&platform=copart");
  const remove=p.node("activeFilterChips").querySelector('[data-filter-id="make"]');
  remove.focus(); remove.click(); await flush();
  assert.equal(p.node("make").value,"");
  assert.equal(p.node("model").value,"");
  assert.equal(p.node("model").disabled,false,"manual model selection stays usable after removing the make");
  const params=new URL(p.requests[0].url,"https://rexbid.pl").searchParams;
  assert.equal(params.has("make"),false); assert.equal(params.has("model"),false);
  assert.equal(params.get("platform"),"copart");
  assert.equal(p.doc.activeElement,p.node("activeFilterChips").querySelector("button"));
});

test("a category chip clears the category restriction instead of leaving an invisible active filter", async t => {
  const p=page(t,"?catalog=1&category=buy-now&lot_status=Buy+Now&platform=iaai");
  assert.equal(p.node("activeFilterChips").querySelector('[data-filter-id="lotStatus"]'),null,"category and its matching alias are one visible choice");
  p.node("activeFilterChips").querySelector('[data-filter-id="category"]').click(); await flush();
  const params=new URL(p.requests[0].url,"https://rexbid.pl").searchParams;
  assert.equal(params.has("category"),false); assert.equal(params.has("lot_status"),false);
  assert.equal(p.node("lotStatus").value,"");
  assert.equal(p.api.category(),"");
});

test("mobile filter panel toggles and applying filters closes it with an accessible focus target", async t => {
  const p=page(t,"?catalog=1&platform=iaai");
  const toggle=p.node("filterPanelToggle"), controls=p.node("filterControls");
  assert.equal(toggle.getAttribute("aria-expanded"),"false");
  toggle.click(); assert.equal(toggle.getAttribute("aria-expanded"),"true");
  assert.equal(controls.classList.contains("is-collapsed"),false);
  p.node("yearFrom").value="2020";
  p.node("filterButton").click(); await flush();
  assert.equal(toggle.getAttribute("aria-expanded"),"false");
  assert.equal(controls.classList.contains("is-collapsed"),true);
  assert.equal(p.doc.activeElement,toggle);
  assert.match(toggle.textContent,/\(2\)/);
  assert.equal(new URL(p.requests[0].url,"https://rexbid.pl").searchParams.get("year_from"),"2020");
});

test("browser history restores all appended pages and opaque cursor without fetching or changing the filters", async t => {
  const p=page(t,"?catalog=1&make=Honda&loc_state=TX");
  p.respond(url=>new URL(url,"https://rexbid.pl").searchParams.has("cursor")
    ? {ok:true,data:[car("22222222")],meta:{next_cursor:"opaque-next"}}
    : {ok:true,data:[car()],meta:{next_cursor:"opaque-page-2"}});
  await p.api.load({updateUrl:false}); await p.api.load({append:true});
  assert.equal(p.node("cars").querySelectorAll("article").length,2);
  assert.equal(p.win.location.search.includes("cursor"),false,"a public bookmark preserves filters rather than a lone later page");
  assert.equal(p.win.history.state.rexBidCatalog.nextCursor,"opaque-next");
  p.node("cars").innerHTML="";
  assert.equal(p.api.restoreHistory(),true);
  assert.equal(p.node("cars").querySelectorAll("article").length,2);
  assert.equal(p.requests.length,2);
  assert.equal(p.node("make").value,"Honda");
  assert.equal(p.node("locationState").value,"TX");
  assert.equal(p.node("cars").getAttribute("aria-busy"),"false");
  assert.equal(p.doc.querySelectorAll('header a[aria-current="page"]').length,1);
  assert.equal(p.doc.querySelector('header a[aria-current="page"]').textContent,"Aukcje");
  const saved={...p.win.history.state,rexBidCatalog:{...p.win.history.state.rexBidCatalog,savedAt:Date.now()-121000}};
  p.win.history.replaceState(saved,"",p.win.location.href);
  assert.equal(p.api.restoreHistory(),false,"old result snapshots require a new read");
  p.win.history.replaceState({...saved,rexBidCatalog:{...saved.rexBidCatalog,savedAt:Date.now(),url:"/?catalog=1&make=Ford"}},"",p.win.location.href);
  assert.equal(p.api.restoreHistory(),false,"a different filter URL cannot borrow another result snapshot");
});

test("exact VIN search clears catalog restrictions and errors retain the search with a working retry", async t => {
  const p=page(t,"?catalog=1&category=electric&make=Tesla&loc_state=CA");
  p.node("searchInput").value="1HGCM82633A004352";
  let first=true;
  p.respond(()=>{if(first){first=false;throw new Error("fixture private diagnostic SQL / token");}return {ok:true,data:[],meta:{next_cursor:null}};});
  await p.api.load();
  const params=new URL(p.requests[0].url,"https://rexbid.pl").searchParams;
  assert.equal(params.get("s"),"1HGCM82633A004352");
  for(const key of ["category","make","loc_state","fuel_type"])assert.equal(params.has(key),false,key);
  assert.match(p.node("cars").textContent,/Filtry zostały zachowane/);
  assert.doesNotMatch(p.node("cars").textContent,/fixture|SQL|token/);
  assert.equal(p.node("searchInput").value,"1HGCM82633A004352");
  assert.equal(p.node("cars").getAttribute("aria-busy"),"false");
  p.node("cars").querySelector("[data-catalog-retry]").click(); await flush();
  assert.equal(p.requests.length,2);
  assert.match(p.node("cars").textContent,/Nie znaleźliśmy zapisanych ofert dla tych kryteriów/);
  p.node("cars").querySelector("[data-clear-catalog]").click(); await flush();
  assert.equal(p.node("searchInput").value,"");
});

test("malformed payload is an error instead of a misleading empty catalog, and restored metadata keeps a saved option", async t => {
  const p=page(t,"?catalog=1&loc_state=TX");
  p.respond(()=>({ok:true,meta:{next_cursor:null}}));
  await p.api.load({updateUrl:false});
  assert.match(p.node("cars").textContent,/Nie udało się pobrać ofert/);
  assert.doesNotMatch(p.node("cars").textContent,/Nie ma ofert/);
  p.api.metadata(p.node("locationState"),[{value:"CA",label:"California"}],"Dowolna","TX");
  assert.equal(p.node("locationState").value,"TX");
});

test("empty partial catalog describes the saved subset without claiming an import is running", async t => {
  for (const meta of [{catalog_complete:false}, {scope_status:"partial"}, {scope_status:"PARTIAL"}]) {
    const p=page(t,"?catalog=1&make=Honda&year_from=2025&view=list");
    p.respond(()=>({ok:true,data:[],meta:{next_cursor:null,...meta}}));
    await p.api.load({updateUrl:false});
    assert.equal(p.node("cars").querySelector("strong").textContent,"Brak dopasowań w zapisanej części katalogu");
    assert.match(p.node("cars").textContent,/Brak wyniku nie oznacza braku takich aut na aukcjach/);
    assert.doesNotMatch(p.node("cars").textContent,/Nie ma ofert|jest uzupełniany|trwa import/);
    assert.equal(p.node("resultStatus").textContent,"Wyświetlono 0 ofert");
    assert.equal(p.node("make").value,"Honda");
    assert.equal(p.node("yearFrom").value,"2025");
    assert.equal(p.node("catalogResults").classList.contains("catalog-list-view"),true);
    assert.equal(p.requests.length,1);
    assert.equal(p.node("loadMoreButton").hidden,true);
  }
});

test("nested partial coverage survives empty history restoration and rerendering without fetching", async t => {
  const p=page(t,"?catalog=1&make=Honda");
  p.respond(()=>({ok:true,data:{cars:[],meta:{next_cursor:null,catalog_complete:false,scope_status:"partial"}}}));
  await p.api.load({updateUrl:false});
  assert.equal(p.win.history.state.rexBidCatalog.catalogPartial,true);
  p.node("cars").innerHTML="";
  assert.equal(p.api.restoreHistory(),true);
  p.win.dispatchEvent(new p.win.Event("rexbid:auth-state"));
  assert.match(p.node("cars").textContent,/Brak dopasowań w zapisanej części katalogu/);
  assert.equal(p.requests.length,1);
  assert.equal(p.node("make").value,"Honda");
});

test("complete or unknown coverage does not inherit a previous partial or active-import claim", async t => {
  const p=page(t);
  p.respond(()=>({ok:true,data:[],meta:{catalog_complete:false}}));
  await p.api.load({updateUrl:false});
  for (const meta of [{catalog_complete:true,scope_status:"complete"}, {next_cursor:null}]) {
    p.respond(()=>({ok:true,data:[],meta}));
    await p.api.load({updateUrl:false});
    assert.equal(p.node("cars").querySelector("strong").textContent,"Nie znaleźliśmy zapisanych ofert dla tych kryteriów");
    assert.doesNotMatch(p.node("cars").textContent,/zapisanej części|jest uzupełniany|trwa import|Nie ma ofert/);
    assert.equal(p.win.history.state.rexBidCatalog.catalogPartial,false);
  }
});

test("clearing an empty partial catalog keeps the existing filter-reset action", async t => {
  const p=page(t,"?catalog=1&make=Honda&year_from=2025&platform=iaai");
  p.respond(()=>({ok:true,data:[],meta:{catalog_complete:false}}));
  await p.api.load({updateUrl:false});
  p.node("cars").querySelector("[data-clear-catalog]").click(); await flush();
  assert.equal(p.node("make").value,"");
  assert.equal(p.node("yearFrom").value,"");
  assert.equal(p.node("platform").value,"");
  const request=new URL(p.requests.at(-1).url,"https://rexbid.pl");
  for (const key of ["make","year_from","platform"]) assert.equal(request.searchParams.has(key),false);
});

test("list deduplication preserves repeated VIN auctions and identical LOTs across platforms", t => {
  const p=page(t);
  const first=car(), sameVinNewLot=car("77777777"), sameLotOtherPlatform=car("62674546","iaai");
  const result=p.api.merge([first],[car(),sameVinNewLot,sameLotOtherPlatform]);
  assert.equal(result.length,3);
  assert.equal(result[0],first);
  assert.equal(result[1],sameVinNewLot);
  assert.equal(result[2],sameLotOtherPlatform);
});

test("return paths accept only public catalog entry points and omit page cursors", () => {
  assert.equal(market.returnPath({pathname:"/",search:"?catalog=1&platform=copart&cursor=private-opaque"}),"/?catalog=1&platform=copart#results");
  assert.equal(market.returnPath({pathname:"/index.html",search:"?catalog=1&s=LOT%267"}),"/index.html?catalog=1&s=LOT%267#results");
  assert.equal(market.returnPath({pathname:"//foreign.example",search:"?catalog=1"}),"/");
  assert.equal(market.returnPath({pathname:"/",search:""}),"/");
  assert.equal(market.returnPath({pathname:"/",search:"?make=Honda"}),"/?make=Honda&catalog=1#results");
});

test("default catalog displays all known records honestly, while explicit Current excludes stale data", async t => {
  const p=page(t);
  const stale=car("62674546","copart",{read:{source:"d1",freshness:"stale",data_status:"last_known",last_synced_at:"2026-10-05T09:00:00Z"},
    auction:{state:"open",schedule_status:"scheduled",auction_at:"2020-01-01T10:00:00Z"}});
  p.respond(()=>({ok:true,data:[stale],meta:{next_cursor:null,catalog_complete:false,scope_status:"stale",stored_row_count:1}}));
  await p.api.load({updateUrl:false});
  assert.equal(new URL(p.requests[0].url,"https://rexbid.pl").searchParams.has("category"),false);
  assert.equal(new URL(p.requests[0].url,"https://rexbid.pl").searchParams.has("lot_sub_status"),false);
  assert.equal(p.node("lotSubStatus").selectedOptions[0].textContent,"Wszystkie statusy");
  assert.equal(p.node("catalogResultsTitle").textContent,"Katalog samochodów");
  assert.equal(p.node("cars").querySelectorAll("article").length,1);
  assert.match(p.node("cars").textContent,/Ostatnia zapisana oferta/);
  assert.match(p.node("cars").textContent,/Status do potwierdzenia/);
  assert.match(p.node("cars").textContent,/Zapis danych z 05\.10\.2026/);
  assert.match(p.node("catalogCoverage").textContent,/Katalog częściowy/);
  assert.equal(p.node("cars").querySelector(".auction-date-row"),null);
  assert.equal(p.node("marketShortcuts").querySelector('[data-market-filter="all"]').getAttribute("aria-pressed"),"true");
  p.node("marketShortcuts").querySelector('[data-market-filter="current"]').click(); await flush();
  assert.equal(new URL(p.requests[1].url,"https://rexbid.pl").searchParams.get("category"),"current");
  assert.equal(p.node("catalogResultsTitle").textContent,"Aktualne aukcje");
  assert.equal(p.node("cars").querySelectorAll("article").length,0);
  p.node("marketShortcuts").querySelector('[data-market-filter="all"]').click(); await flush();
  assert.equal(new URL(p.requests[2].url,"https://rexbid.pl").searchParams.has("category"),false);
  assert.equal(p.node("cars").querySelectorAll("article").length,1);
});

test("shared navigation rebuilding preserves the actual catalog current-page indication", async t => {
  const p=page(t);
  p.win.eval(fs.readFileSync(path.join(__dirname,"../public/rexbid-mobile-nav.js"),"utf8"));
  p.doc.dispatchEvent(new p.win.Event("DOMContentLoaded"));
  const current=p.doc.querySelectorAll('header nav a[aria-current="page"]');
  assert.equal(current.length,1);
  assert.equal(current[0].getAttribute("href"),"/?catalog=1#results");
  assert.equal(p.doc.querySelector("#catalogResults").hidden,false);
});

test("rendered result count follows Polish singular, few and teen plural forms", t => {
  const p=page(t);
  for(const [count,noun] of [[0,"ofert"],[1,"ofertę"],[2,"oferty"],[3,"oferty"],[4,"oferty"],[5,"ofert"],[12,"ofert"],[13,"ofert"],[14,"ofert"],[21,"ofert"],[22,"oferty"],[24,"oferty"]]){
    p.api.render(Array.from({length:count},(_,index)=>car("LOT-"+index)));
    assert.equal(p.node("resultStatus").textContent,"Wyświetlono "+count+" "+noun);
  }
});

test("changing makes searches immediately and late filter metadata cannot erase the latest models", async t => {
  const p=page(t);
  const pending=new Map();
  p.respond(url=>{
    const request=new URL(url,"https://rexbid.pl");
    if(request.pathname==="/api/filters") return new Promise(resolve=>pending.set(request.searchParams.get("make"),resolve));
    return {ok:true,data:[],meta:{next_cursor:null}};
  });
  p.node("make").value="HONDA";
  p.node("make").dispatchEvent(new p.win.Event("change"));
  await flush();
  assert.ok(p.requests.some(request=>request.url.includes("/cars?") && request.url.includes("make=HONDA")),"catalog does not wait for filter metadata");
  p.node("make").value="TESLA";
  p.node("make").dispatchEvent(new p.win.Event("change"));
  await flush();
  pending.get("TESLA")({ok:true,data:{makes:["HONDA","TESLA"],models_by_make:{TESLA:["MODEL 3","MODEL Y"]}}});
  await flush();
  const options=()=>Array.from(p.node("modelOptions").options,option=>option.value);
  assert.deepEqual(options(),["MODEL 3","MODEL Y"]);
  pending.get("HONDA")({ok:true,data:{makes:["HONDA","TESLA"],models_by_make:{HONDA:["CIVIC"]}}});
  await flush();
  assert.equal(p.node("make").value,"TESLA");
  assert.deepEqual(options(),["MODEL 3","MODEL Y"],"late HONDA result is ignored");
  assert.equal(p.requests.filter(request=>request.url.includes("/cars?")).length,2,"one search per choice, no repeat after metadata arrives");
});

test("a reversed year range keeps loaded cars and URL, opens mobile filters and focuses the invalid field", async t => {
  const p=page(t,"?catalog=1&year_from=2020&year_to=2024");
  await p.api.load({updateUrl:false});
  const previousUrl=p.win.location.href;
  const previousCards=p.node("cars").innerHTML;
  p.node("yearFrom").value="2024";
  p.node("yearTo").value="2020";
  p.node("filterButton").click();
  await flush();
  assert.equal(p.requests.length,1,"invalid ranges do not send a request");
  assert.equal(p.node("cars").innerHTML,previousCards,"the last useful result stays visible");
  assert.equal(p.win.location.href,previousUrl,"invalid drafts never become bookmarked filters");
  assert.equal(p.node("filterValidationMessage").hidden,false);
  assert.match(p.node("filterValidationMessage").textContent,/Rok:.*„od”.*„do”/);
  assert.equal(p.node("yearFrom").getAttribute("aria-invalid"),"true");
  assert.equal(p.node("yearFrom").getAttribute("aria-describedby"),"filterValidationMessage");
  assert.equal(p.node("filterPanelToggle").getAttribute("aria-expanded"),"true");
  assert.equal(p.doc.activeElement,p.node("yearFrom"));
  assert.equal(p.node("cars").getAttribute("aria-busy"),"false");
});

test("price and mileage range errors open advanced controls while a corrected zero minimum remains valid", async t => {
  for(const [from,to,label] of [["priceMin","priceMax","Cena w USD"],["odometerFrom","odometerTo","Przebieg w milach"]]){
    const p=page(t);
    p.node(from).value="2000";
    p.node(to).value="1000";
    p.node("advancedFilterButton").click();
    await flush();
    assert.equal(p.requests.length,0);
    assert.equal(p.node("advancedFilters").open,true);
    assert.ok(p.node("filterValidationMessage").textContent.startsWith(label));
    assert.equal(p.doc.activeElement,p.node(from));
    p.node(from).value="0";
    p.node("advancedFilterButton").click();
    await flush();
    assert.equal(p.requests.length,1);
    assert.equal(p.node("filterValidationMessage").hidden,true);
    assert.equal(p.node(from).hasAttribute("aria-invalid"),false);
    const params=new URL(p.requests[0].url,"https://rexbid.pl").searchParams;
    assert.equal(params.get(from==="priceMin"?"price_min":"odometer_from"),"0");
  }
});

test("negative filters are explained locally and exact VIN search clears their restriction", async t => {
  const p=page(t);
  p.node("priceMin").value="-100";
  assert.equal(await p.api.load(),false);
  assert.equal(p.requests.length,0);
  assert.match(p.node("filterValidationMessage").textContent,/Cena w USD:.*0 lub większą/);
  p.node("searchInput").value="1HGCM82633A004352";
  p.node("searchForm").dispatchEvent(new p.win.Event("submit",{bubbles:true,cancelable:true}));
  await flush();
  assert.equal(p.requests.length,1);
  const params=new URL(p.requests[0].url,"https://rexbid.pl").searchParams;
  assert.equal(params.get("s"),"1HGCM82633A004352");
  assert.equal(params.has("price_min"),false);
  assert.equal(p.node("priceMin").value,"");
  assert.equal(p.node("filterValidationMessage").hidden,true);
});

test("favorite actions retain keyboard focus on the exact platform and LOT after rendering", async t => {
  const p=page(t);
  const records=[car("12345678","copart"),car("12345678","iaai")];
  const saved=new Set();
  p.win.RexBidStorage.isFavorite=record=>saved.has(record.platform+":"+record.lot_number);
  p.win.RexBidStorage.toggleFavorite=async record=>saved.add(record.platform+":"+record.lot_number);
  p.respond(()=>({ok:true,data:records,meta:{next_cursor:null}}));
  await p.api.load({updateUrl:false});
  const button=p.node("cars").querySelectorAll("[data-local-action='favorite']")[1];
  button.focus();
  button.click();
  await flush();
  const next=p.node("cars").querySelectorAll("[data-local-action='favorite']");
  assert.equal(next[0].getAttribute("aria-pressed"),"false");
  assert.equal(next[1].getAttribute("aria-pressed"),"true");
  assert.equal(p.doc.activeElement,next[1]);
  assert.equal(next[1].dataset.carKey,"iaai:12345678");
  assert.equal(p.requests.length,1,"saving a favorite does not reload catalog data");
});

test("catalog search uses its own heading and visible VIN/LOT rows preserve their full identity", async t => {
  const p=page(t);
  await p.api.load({updateUrl:false});
  assert.match(p.node("heroTitle").textContent,/Znajdź samochód/);
  assert.match(p.node("heroLead").textContent,/zapisane oferty/);
  const rows=p.node("cars").querySelectorAll(".card-identity-line");
  assert.deepEqual([...rows].map(row=>row.querySelector("strong").textContent),["62674546","1HGCM82633A004352"]);
  const url=new URL(p.node("cars").querySelector("article a").href);
  assert.equal(url.searchParams.get("lot"),"62674546");
  assert.equal(url.searchParams.get("vin"),"1HGCM82633A004352");
  p.win.history.pushState({},"","/");
  p.win.dispatchEvent(new p.win.PopStateEvent("popstate"));
  assert.match(p.node("heroTitle").textContent,/Wybierz wymarzony pojazd/);
  assert.equal(p.node("catalogResults").hidden,true);
});

test("a hanging Home category stops after 15 seconds, leaves other cards intact and retries only on request", async t => {
  const p=page(t,"");
  const timers=new Map(), cleared=[];
  let timerId=0;
  p.win.setTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
  p.win.clearTimeout=id=>{cleared.push(id);timers.delete(id);};
  const current=p.doc.querySelector('[data-market-aisle][data-kind="current"]');
  const buyNow=p.doc.querySelector('[data-market-aisle][data-kind="buy-now"]');
  const currentResults=current.querySelector("[data-aisle-results]");
  const buyNowResults=buyNow.querySelector("[data-aisle-results]");
  let currentAttempts=0;
  p.respond((url,options)=>{
    const category=new URL(url,"https://rexbid.pl").searchParams.get("category");
    if(category==="current" && ++currentAttempts===1) return new Promise((_resolve,reject)=>{
      options.signal.addEventListener("abort",()=>reject(new p.win.DOMException("private fixture diagnostic","AbortError")),{once:true});
    });
    return {ok:true,data:[car()],meta:{next_cursor:null}};
  });
  const hanging=p.api.loadAisle(current);
  await p.api.loadAisle(buyNow);
  const otherCard=buyNowResults.querySelector(".market-aisle-card");
  assert.ok(otherCard);
  assert.equal(timers.size,1,"successful categories release their own timeout");
  assert.deepEqual(cleared,[2]);
  assert.equal(current.dataset.loading,"true");
  assert.equal(currentResults.getAttribute("aria-busy"),"true");
  const [[firstTimerId,firstTimer]]=timers;
  assert.equal(firstTimer.delay,15_000);
  firstTimer.callback();
  await hanging;
  assert.equal(p.requests[0].options.signal.aborted,true);
  assert.equal(current.dataset.loading,"false");
  assert.notEqual(current.dataset.loaded,"true");
  assert.equal(currentResults.getAttribute("aria-busy"),"false");
  assert.match(currentResults.textContent,/Pobieranie ofert trwało zbyt długo/);
  assert.doesNotMatch(currentResults.textContent,/private fixture/);
  assert.equal(timers.size,0);
  assert.ok(cleared.includes(firstTimerId));
  assert.equal(buyNowResults.querySelector(".market-aisle-card"),otherCard);
  p.doc.dispatchEvent(new p.win.Event("visibilitychange"));
  await flush();
  assert.equal(p.requests.length,2,"page visibility does not retry or add requests");
  currentResults.querySelector(".aisle-retry").click();
  assert.equal(currentResults.querySelector(".aisle-retry").disabled,true);
  await flush();
  assert.equal(p.requests.length,3,"one explicit retry issues one request");
  assert.notEqual(p.requests[2].options.signal,p.requests[0].options.signal);
  assert.equal(p.requests[2].options.signal.aborted,false);
  assert.equal(current.dataset.loaded,"true");
  assert.equal(currentResults.querySelectorAll(".market-aisle-card").length,1);
  assert.equal(currentResults.querySelector(".aisle-retry"),null);
  assert.equal(timers.size,0,"successful retry clears its timeout too");
  assert.equal(buyNowResults.querySelector(".market-aisle-card"),otherCard);
});

test("an empty saved-D1 Home category shows dated saved cards without advertising an active auction", async t => {
  const p = page(t, "");
  const section = p.doc.querySelector('[data-market-aisle][data-kind="timed"]');
  const target = section.querySelector("[data-aisle-results]");
  p.respond(url => {
    const q = new URL(url,"https://rexbid.pl").searchParams;
    assert.equal(q.get("lot_status"), "Timed");
    const data = q.has("category") ? [] : [car("62674546", "copart", {
      auction:{state:"live", is_timed:true, timed_end_at:"2099-01-01T12:00:00Z"},
      read:{source:"d1", freshness:"stale", last_synced_at:"2026-11-06T05:20:00Z"}
    })];
    return {ok:true,data,meta:{read_source:"d1",catalog_complete:false}};
  });
  await p.api.loadAisle(section);
  assert.equal(p.requests.length,2);
  assert.equal(target.querySelectorAll(".market-aisle-card").length,1);
  assert.match(section.querySelector("h2").textContent,/Timed Auction · zapis danych/);
  assert.match(target.textContent,/Zapis danych z 06\.11\.2026/);
  assert.match(target.textContent,/Status do potwierdzenia/);
  assert.doesNotMatch(target.textContent,/Trwa|Aktualna oferta|2099/);
  const linked = new URL(section.querySelector(".aisle-more").href,"https://rexbid.pl");
  assert.equal(linked.searchParams.get("lot_status"),"Timed");
  assert.equal(linked.searchParams.has("category"),false);
});

test("failed category reads preserve existing cards and clear the timer before a manual retry", async t => {
  const p=page(t,"");
  const timers=new Set();
  let nextId=0;
  p.win.setTimeout=()=>{const id=++nextId;timers.add(id);return id;};
  p.win.clearTimeout=id=>timers.delete(id);
  const section=p.doc.querySelector('[data-market-aisle][data-kind="current"]');
  const target=section.querySelector("[data-aisle-results]");
  await p.api.loadAisle(section);
  const cardNode=target.querySelector(".market-aisle-card");
  section.dataset.loaded="false";
  p.respond(()=>{throw new Error("private upstream response");});
  await p.api.loadAisle(section);
  assert.equal(target.querySelector(".market-aisle-card"),cardNode);
  assert.equal(target.querySelectorAll(".aisle-message").length,1);
  assert.match(target.textContent,/Nie udało się pobrać ofert/);
  assert.doesNotMatch(target.textContent,/private upstream/);
  assert.equal(section.dataset.loading,"false");
  assert.equal(target.getAttribute("aria-busy"),"false");
  assert.equal(timers.size,0);
  p.respond(()=>({ok:true,data:[car()],meta:{next_cursor:null}}));
  target.querySelector(".aisle-retry").click();
  await flush();
  assert.equal(p.requests.length,3);
  assert.equal(target.querySelectorAll(".market-aisle-card").length,1);
  assert.equal(target.querySelector(".aisle-message"),null);
  assert.equal(timers.size,0);
});

test("year selections apply each bound immediately, preserve inclusive values, and clear old paging", async t => {
  const p=page(t);
  p.respond(url=>{
    const q=new URL(url,"https://rexbid.pl").searchParams;
    const from=q.has("year_from")?Number(q.get("year_from")):-Infinity;
    const to=q.has("year_to")?Number(q.get("year_to")):Infinity;
    const records=[2019,2020,2024,2025].filter(year=>year>=from && year<=to)
      .map(year=>car(String(year),"copart",{year,title:year+" Honda Accord"}));
    return {ok:true,data:records,meta:{next_cursor:q.has("cursor")?null:"old-page-2"}};
  });
  await p.api.load({updateUrl:false});
  await p.api.load({append:true});
  const change=async(id,value)=>{
    p.node(id).value=value;
    p.node(id).dispatchEvent(new p.win.Event("change"));
    await flush();
    const q=new URL(p.requests.at(-1).url,"https://rexbid.pl").searchParams;
    assert.equal(q.has("cursor"),false,"a year change always starts the first page");
    return q;
  };
  let q=await change("yearFrom","2020");
  assert.equal(q.get("year_from"),"2020"); assert.equal(q.has("year_to"),false);
  assert.equal(p.node("cars").querySelectorAll("article").length,3);
  assert.match(p.node("cars").textContent,/2020 Honda Accord/);
  assert.doesNotMatch(p.node("cars").textContent,/2019 Honda Accord/);
  q=await change("yearTo","2024");
  assert.equal(q.get("year_from"),"2020"); assert.equal(q.get("year_to"),"2024");
  assert.equal(p.node("cars").querySelectorAll("article").length,2);
  assert.match(p.node("cars").textContent,/2024 Honda Accord/);
  assert.doesNotMatch(p.node("cars").textContent,/2025 Honda Accord/);
  q=await change("yearFrom","");
  assert.equal(q.has("year_from"),false); assert.equal(q.get("year_to"),"2024");
  assert.equal(p.node("cars").querySelectorAll("article").length,3);
  assert.match(p.node("cars").textContent,/2019 Honda Accord/);
  q=await change("yearTo","");
  assert.equal(q.has("year_from"),false); assert.equal(q.has("year_to"),false);
  assert.equal(p.node("cars").querySelectorAll("article").length,4);
  assert.equal(new URL(p.win.location.href).searchParams.has("year_to"),false);
  assert.equal(p.requests.length,6,"one new request per year choice");
});

test("new year choices supersede pending first and appended responses without restoring old cards", async t => {
  for(const append of [false,true]){
    const p=page(t);
    p.respond(()=>({ok:true,data:[car("20190001","copart",{year:2019,title:"2019 Honda Accord"})],meta:{next_cursor:"old-page-2"}}));
    await p.api.load({updateUrl:false});
    let release;
    p.respond(url=>{
      const q=new URL(url,"https://rexbid.pl").searchParams;
      if(!q.has("year_from")) return new Promise(resolve=>{release=resolve;});
      return {ok:true,data:[car("20250001","copart",{year:2025,title:"2025 Honda Accord"})],meta:{next_cursor:null}};
    });
    const old=p.api.load({append});
    await flush();
    p.node("yearFrom").value="2025";
    p.node("yearFrom").dispatchEvent(new p.win.Event("change"));
    await flush();
    release({ok:true,data:[car("20180001","copart",{year:2018,title:"2018 Honda Accord"})],meta:{next_cursor:"late-page"}});
    await old; await flush();
    assert.equal(p.node("cars").querySelectorAll("article").length,1);
    assert.match(p.node("cars").textContent,/2025 Honda Accord/);
    assert.doesNotMatch(p.node("cars").textContent,/201[89] Honda Accord/);
    assert.equal(p.node("loadMoreButton").hidden,true,"late response cannot restore the old cursor");
    assert.equal(p.node("cars").getAttribute("aria-busy"),"false");
    const last=new URL(p.requests.at(-1).url,"https://rexbid.pl").searchParams;
    assert.equal(last.get("year_from"),"2025"); assert.equal(last.has("cursor"),false);
  }
});

test("reversed year choices show an actionable error and recover when the upper bound is cleared", async t => {
  const p=page(t,"?catalog=1&year_from=2020&year_to=2024");
  await p.api.load({updateUrl:false});
  const previousCards=p.node("cars").innerHTML, previousUrl=p.win.location.href;
  p.node("yearFrom").value="2025";
  p.node("yearFrom").dispatchEvent(new p.win.Event("change"));
  await flush();
  assert.equal(p.requests.length,1);
  assert.equal(p.node("filterValidationMessage").hidden,false);
  assert.match(p.node("filterValidationMessage").textContent,/Rok:.*„od”.*„do”/);
  assert.equal(p.node("cars").innerHTML,previousCards);
  assert.equal(p.win.location.href,previousUrl);
  p.node("yearTo").value="";
  p.node("yearTo").dispatchEvent(new p.win.Event("change"));
  await flush();
  assert.equal(p.requests.length,2);
  assert.equal(p.node("filterValidationMessage").hidden,true);
  assert.equal(p.node("yearFrom").hasAttribute("aria-invalid"),false);
  const q=new URL(p.requests[1].url,"https://rexbid.pl").searchParams;
  assert.equal(q.get("year_from"),"2025"); assert.equal(q.has("year_to"),false);
});
