const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/car.html"), "utf8");
const inline = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(match => !/\bsrc=/.test(match[1])).map(match => match[2]).join("\n");

function decodeHtml(value) {
  return value.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function vehiclePage() {
  const elements = new Map();
  const events = new Map();
  const makeNode = id => ({
    id, style:{}, dataset:{}, textContent:"", innerHTML:"", hidden:false, disabled:false,
    classList:{add(){},remove(){},contains(){return false;}},
    addEventListener(){}, removeAttribute(){}, setAttribute(){}, focus(){}, querySelectorAll(){return [];}
  });
  const node = id => {
    if (!elements.has(id)) elements.set(id, makeNode(id));
    return elements.get(id);
  };
  const page = node("page");
  let inquiryLinks = [];
  const document = {
    body:{classList:{add(){},remove(){}}}, visibilityState:"visible",
    getElementById:node,
    addEventListener(type, callback) {
      if (!events.has(type)) events.set(type, []);
      events.get(type).push(callback);
    },
    querySelector(){return null;},
    querySelectorAll(selector) {
      if (selector !== "[data-vehicle-inquiry]") return [];
      inquiryLinks = [...page.innerHTML.matchAll(/<a\b[^>]*data-vehicle-inquiry[^>]*href="([^"]+)"/g)]
        .map(match => ({href:decodeHtml(match[1]),dataset:{},getAttribute(name){return name === "href" ? this.href : null;}}));
      return inquiryLinks;
    }
  };
  const context = {
    document, window:{}, location:{search:"",href:"https://rexbid.pl/car.html"}, navigator:{}, URL, URLSearchParams,
    console:{warn(){},error(){}}, setTimeout(){}, setInterval(){}, clearInterval(){},
    RexBidMarket:require("../public/rexbid-market.js"), fetch(){throw new Error("Unexpected network request");}
  };
  vm.createContext(context);
  vm.runInContext(inline + `\n;globalThis.vehicleApi = {
    render(vehicle) { car = vehicle; photos = []; buildPage(); },
    refresh(vehicle) { car = vehicle; updateAuctionUi(); },
    update: updateAuctionUi,
    history(records, availability={state:"stored"}, snapshots=[]) { auctionHistoryRecords=records.map(normalizeHistoryRecord); observedHistoryRecords=snapshots; auctionHistoryAvailability=availability; renderAuctionHistory(); },
    fetchHistory: fetchAuctionHistory,
    setPriceUpdater(updater) { activeV4PriceUpdater = updater; },
    describe: getDescription,
    phase: auctionPhase
  };`, context);
  return {
    context, page, node, api:context.vehicleApi,
    links:() => inquiryLinks,
    dispatch(type, detail) { for (const callback of events.get(type) || []) callback({detail}); },
    spec(label) {
      const match = [...page.innerHTML.matchAll(/<div class="spec[^\"]*">\s*<small>(.*?)<\/small>\s*<strong>([\s\S]*?)<\/strong>/g)]
        .find(match => decodeHtml(match[1]) === label);
      return match ? decodeHtml(match[2]) : null;
    }
  };
}

test('Copart Gas fuel label matches the catalog without interpreting unknown fuel codes',()=>{
 const view=vehiclePage();
 for(const fuel_type of ['Gas','GAS','gas']){view.api.render(vehicle({fuel_type}));assert.equal(view.spec('Paliwo'),'Benzyna');}
 view.api.render(vehicle({fuel_type:'Provider special fuel'}));assert.equal(view.spec('Paliwo'),'Provider special fuel');
});

function vehicle(overrides = {}) {
  return {
    title:"2022 Honda Accord", vin:"1HGCM82633A004352", lot_number:"62674546", platform:"copart",
    year:2022, make:"Honda", model:"Accord", trim:"Sport", body_style:"Sedan", fuel_type:"Gasoline",
    transmission:"Automatic", drive_type:"FWD", engine_size_l:2,
    odometer:{value:42000,unit:"mi"}, location:{display:"Houston, TX",city:"Houston",state:"TX"},
    condition:{primary_damage:"Side",run_condition:"RUNS AND DRIVES",has_key:true,airbags:"Intact"},
    sale_document:{name:"TX Salvage Title",registration:null,export:null},
    auction:{state:"open",schedule_status:"unassigned",auction_at:null},
    pricing:{current_bid_usd:1200,buy_now_usd:5000}, media:{items:[],thumbs:[]}, ...overrides
  };
}

test("normalized D1 details render vehicle specs and mileage units without losing source condition fields", () => {
  const view = vehiclePage();
  view.api.render(vehicle());
  assert.equal(view.spec("Nadwozie"), "Sedan");
  assert.equal(view.spec("Skrzynia"), "Automatyczna");
  assert.equal(view.spec("Napęd"), "Na przednie koła (FWD)");
  assert.equal(view.spec("Paliwo"), "Benzyna");
  assert.equal(view.spec("Silnik"), "2 l");
  assert.equal(view.spec("Wersja / seria"), "Sport");
  assert.match(view.spec("Przebieg"), /42\s*000 mi/);
  assert.match(view.page.innerHTML, /RUN &amp; DRIVE/);
  assert.match(view.page.innerHTML, /Poduszki<\/small><b>Niewystrzelone/);
  assert.match(view.page.innerHTML, /Kluczyki<\/small><b>Obecne/);
  assert.match(view.page.innerHTML, /TX Salvage Title/);

  view.api.render(vehicle({body_style:null,transmission:null,drive_type:null,fuel_type:null,odometer:{value:0,unit:"km"}}));
  assert.equal(view.spec("Skrzynia"), "Brak danych");
  assert.equal(view.spec("Napęd"), "Brak danych");
  assert.equal(view.spec("Przebieg"), "0 km");
  view.api.render(vehicle({transmission:"Unknown"}));
  assert.equal(view.spec("Skrzynia"), "Brak danych");
});

test("confirmed ended sale remains the primary historical price while Buy Now stays separate from missing current bid", () => {
  const view = vehiclePage();
  view.api.render(vehicle({auction:{state:"finished",outcome_status:"Sold",result_confirmed:true},pricing:{sale_price_usd:12345,buy_now_usd:5000}}));
  assert.match(view.page.innerHTML, /id="currentBidPrice">\$12,345<\/strong>/);
  view.api.update();
  assert.equal(view.node("currentBidPrice").textContent, "$12,345");
  assert.equal(view.node("bidLabel").textContent, "Cena sprzedaży");

  view.api.render(vehicle({auction:{state:"finished",outcome_status:"Sold"},pricing:{sale_price_usd:12345}}));
  view.api.update();
  assert.equal(view.node("currentBidPrice").textContent, "Brak danych o ofercie");
  assert.equal(view.node("bidLabel").textContent, "Cena sprzedaży niepotwierdzona");

  view.api.render(vehicle({pricing:{current_bid_usd:null,buy_now_usd:5000}}));
  view.api.update();
  assert.equal(view.node("bidLabel").textContent, "Aktualna oferta");
  assert.equal(view.node("currentBidPrice").textContent, "Brak danych o ofercie");
  assert.equal(view.node("buyNowPrice").textContent, "$5,000");

  view.api.render(vehicle({auction:{state:"finished",outcome_status:"Sold on Approval"},pricing:{sale_price_usd:12345}}));
  view.api.update();
  assert.equal(view.node("currentBidPrice").textContent, "Brak danych o ofercie");
  assert.equal(view.node("bidLabel").textContent, "Cena sprzedaży niepotwierdzona");
});

test("contextual inquiry preserves exact identifiers and encodes hostile source title without adding executable markup", () => {
  const view = vehiclePage();
  const title = 'Accord & </a><script>alert("x")</script>';
  const lot = "LOT 7&platform=iaai";
  const vin = "VIN/7?&LOT=999";
  view.api.render(vehicle({title,lot_number:lot,vin}));
  const query = new URL(view.links()[0].href, "https://rexbid.pl").searchParams;
  assert.equal(query.get("lot"), lot);
  assert.equal(query.get("platform"), "copart");
  assert.equal(query.get("vin"), vin);
  assert.equal(query.get("title"), title);
  assert.doesNotMatch(view.page.innerHTML, /<script>alert/);
  assert.equal(query.getAll("platform").length, 1);
});

test("inquiry carries only the current vehicle's explicit budget and retains partial status", () => {
  const view = vehiclePage();
  const auto = vehicle();
  view.api.render(auto);
  const before = view.links()[0].href;
  view.dispatch("rexbid:budget-update", {lot:"other-lot",platform:"copart",purchasePriceUsd:10000,budget:{knownTotalPln:50000,complete:true}});
  assert.equal(view.links()[0].href, before);
  view.dispatch("rexbid:budget-update", {lot:auto.lot_number,platform:"copart",priceKind:"custom",purchasePriceUsd:10000,budget:{knownTotalPln:43100.5,complete:false,usdPln:3.9}});
  let query = new URL(view.links()[0].href, "https://rexbid.pl").searchParams;
  assert.equal(query.get("purchase_usd"), "10000");
  assert.equal(query.get("price_kind"), "custom");
  assert.equal(query.get("budget_pln"), "43100.5");
  assert.equal(query.get("budget_status"), "partial");
  assert.equal(query.get("fx_usd_pln"), "3.9");
  view.dispatch("rexbid:budget-update", {lot:auto.lot_number,platform:"copart",priceKind:"<script>",purchasePriceUsd:NaN,budget:{knownTotalPln:-100,complete:true}});
  query = new URL(view.links()[0].href, "https://rexbid.pl").searchParams;
  assert.equal(query.has("purchase_usd"), false);
  assert.equal(query.has("budget_pln"), false);
  assert.equal(query.has("price_kind"), false);
});

test("read-only snapshots visibly date their data and never present an observed bid as live", () => {
  const view = vehiclePage();
  view.api.render(vehicle({auction:{state:"live",schedule_status:"live"},preview:{read_only:true,freshness:"stale",last_synced_at:"2026-10-05T09:00:00Z"}}));
  assert.match(view.page.innerHTML, /Zapis danych aukcji z 05\.10\.2026/);
  assert.match(view.page.innerHTML, /dane wymagają odświeżenia/);
  assert.match(view.page.innerHTML, /Ostatnia zapisana oferta/);
  view.api.update();
  assert.equal(view.node("bidLabel").textContent, "Ostatnia zapisana oferta");
  assert.equal(view.node("auctionStatusText").textContent, "Status do potwierdzenia");
  assert.doesNotMatch(view.node("auctionStatusHeadline").innerHTML, /Trwa|LIVE/);
});

test("production D1 freshness changes update dated price notice, labels and countdown without entering preview mode", () => {
  const view = vehiclePage();
  const auction = {state:"live",schedule_status:"live",is_timed:true,timed_end_at:"2099-12-15T15:00:00Z"};
  const fresh = vehicle({auction,read:{source:"d1",freshness:"fresh",last_synced_at:"2026-10-06T10:00:00Z"}});
  view.api.render(fresh);
  view.api.update();
  assert.equal(view.node("vehicleDataFreshness").hidden, false);
  assert.match(view.node("vehicleFreshnessDate").textContent, /Zapis danych aukcji z 06\.10\.2026/);
  assert.equal(view.node("bidLabel").textContent, "Aktualna oferta");
  assert.notEqual(view.node("auctionTimerBox").style.display, "none");

  view.api.refresh(vehicle({auction,read:{source:"d1",freshness:"stale",last_synced_at:"2026-10-05T09:00:00Z"}}));
  assert.equal(view.api.phase(), "snapshot");
  assert.equal(view.node("vehicleDataFreshness").hidden, false);
  assert.match(view.node("vehicleFreshnessDate").textContent, /Zapis danych aukcji z 05\.10\.2026/);
  assert.doesNotMatch(view.node("vehicleFreshnessHeading").textContent, /Podgląd/);
  assert.equal(view.node("bidLabel").textContent, "Ostatnia zapisana oferta");
  assert.equal(view.node("buyNowLabel").textContent, "Kup teraz · zapis danych");
  assert.equal(view.node("currentBidPrice").textContent, "$1,200");
  assert.equal(view.node("auctionStatusText").textContent, "Status do potwierdzenia");
  assert.equal(view.node("auctionTimerBox").style.display, "none");
  assert.equal(view.node("countdown").textContent, "");
  assert.equal(view.node("vehicleAuctionDate").hidden, true);

  view.api.refresh(fresh);
  assert.equal(view.node("vehicleDataFreshness").hidden, false);
  assert.match(view.node("vehicleFreshnessDate").textContent, /Zapis danych aukcji z 06\.10\.2026/);
  assert.equal(view.node("buyNowLabel").textContent, "Kup teraz");
  assert.equal(view.node("bidLabel").textContent, "Aktualna oferta");
  assert.notEqual(view.node("auctionTimerBox").style.display, "none");
  assert.equal(view.node("vehicleAuctionDate").hidden, false);
});

test("unknown D1 freshness labels a retained date as saved and suppresses the countdown", () => {
  const view = vehiclePage();
  const auction = {state:"upcoming",schedule_status:"scheduled",auction_at:"2099-12-15T15:00:00Z"};
  view.api.render(vehicle({auction,read:{source:"d1",freshness:"unknown"}}));
  view.api.update();
  assert.match(view.page.innerHTML, /Aktualność danych aukcji niepotwierdzona/);
  assert.match(view.page.innerHTML, /Zapisany termin aukcji<\/small><strong>15\.12\.2099/);
  assert.match(view.page.innerHTML, /Termin i dostępność do potwierdzenia w oryginalnej aukcji/);
  assert.equal(view.node("auctionTimerBox").style.display, "none");
  assert.match(view.node("vehicleFreshnessDate").textContent, /Data zapisu nieustalona/);
  assert.equal(view.node("currentBidPrice").textContent, "$1,200");

  view.api.refresh(vehicle({auction}));
  assert.equal(view.api.phase(), "prebid");
  assert.equal(view.node("bidLabel").textContent, "Aktualna oferta");
  assert.notEqual(view.node("auctionTimerBox").style.display, "none");
});

test("inquiry exports validated observed price status separately from the selected price kind", () => {
  const view = vehiclePage();
  const auto = vehicle({read:{source:"d1",freshness:"stale"}});
  view.api.render(auto);
  view.dispatch("rexbid:budget-update", {lot:auto.lot_number,platform:"copart",priceKind:"current",priceStatus:"snapshot",priceObservedAt:"2026-10-05T09:00:00.000Z",purchasePriceUsd:1200});
  const query = new URL(view.links()[0].href, "https://rexbid.pl").searchParams;
  assert.equal(query.get("purchase_usd"), "1200");
  assert.equal(query.get("price_kind"), "current");
  assert.equal(query.get("price_status"), "snapshot");
  assert.equal(query.get("price_observed_at"), "2026-10-05T09:00:00.000Z");
});

test("inquiry keeps the selected delivery while the calculator is still loading", () => {
  const view = vehiclePage();
  const auto = vehicle();
  view.api.render(auto);
  view.dispatch("rexbid:budget-update", {lot:auto.lot_number,platform:"copart",purchasePriceUsd:16300,
    deliveryDestination:"Warszawa",deliveryPln:1800,budget:{loading:true,knownTotalPln:null}});
  const query = new URL(view.links()[0].href, "https://rexbid.pl").searchParams;
  assert.equal(query.get("purchase_usd"), "16300");
  assert.equal(query.get("delivery_destination"), "Warszawa");
  assert.equal(query.get("delivery_pln"), "1800");
  assert.equal(query.has("budget_pln"), false);
  assert.equal(query.has("budget_status"), false);
});

test("vehicle refresh forwards observed prices and freshness to its mounted calculator together", () => {
  const view = vehiclePage();
  const updates = [];
  view.api.setPriceUpdater(packet => updates.push(JSON.parse(JSON.stringify(packet))));
  const read = {source:"d1",freshness:"fresh",last_synced_at:"2026-10-06T09:00:00Z"};
  view.api.render(vehicle({read,pricing:{current_bid_usd:3200,buy_now_usd:6000}}));
  view.api.update();
  assert.deepEqual(updates.at(-1), {currentBid:3200,buyNowPrice:6000,read});

  const stale = {...read,freshness:"stale",last_synced_at:"2026-10-05T09:00:00Z"};
  view.api.refresh(vehicle({read:stale,pricing:{current_bid_usd:3500,buy_now_usd:7000}}));
  assert.deepEqual(updates.at(-1), {currentBid:3500,buyNowPrice:7000,read:stale});
  assert.equal(view.node("bidLabel").textContent, "Ostatnia zapisana oferta");
});

test("fresh detail with unknown availability preserves prices without implying live availability or countdown", () => {
  for (const platform of ["copart","iaai"]) {
    const view=vehiclePage();
    const record=vehicle({platform,read:{source:"d1",freshness:"fresh",last_synced_at:"2026-10-07T12:00:00Z"},
      auction:{state:"unknown",source_status:"unknown",schedule_status:"scheduled",auction_at:"2099-12-15T15:00:00Z",is_timed:true,timed_end_at:"2099-12-16T15:00:00Z"}});
    view.api.render(record);
    assert.match(view.page.innerHTML,/id="bidLabel">Ostatnia zapisana oferta/);
    assert.match(view.page.innerHTML,/id="currentBidPrice">\$1,200/);
    assert.match(view.page.innerHTML,/id="buyNowLabel">Kup teraz · zapis danych/);
    assert.match(view.page.innerHTML,/Status do potwierdzenia/);
    assert.match(view.page.innerHTML,/Zapisany termin aukcji<\/small><strong>16\.12\.2099/);
    assert.match(view.page.innerHTML,/Termin i dostępność do potwierdzenia w oryginalnej aukcji/);
    view.api.update();
    assert.equal(view.node("bidLabel").textContent,"Ostatnia zapisana oferta");
    assert.equal(view.node("currentBidPrice").textContent,"$1,200");
    assert.equal(view.node("buyNowLabel").textContent,"Kup teraz · zapis danych");
    assert.equal(view.node("vehicleDataFreshness").hidden,false);
    assert.equal(view.node("auctionTimerBox").style.display,"none");
    assert.equal(view.api.phase(),"snapshot");
  }
  assert.ok(html.indexOf('<script src="/rexbid-market.js"></script>') < html.indexOf('  function buildPage()'),'shared availability policy loads before the primary renderer');
});

test("source zero is unavailable and not selectable, Buy Now remains separate, details precede calculator",()=>{
 const view=vehiclePage();view.api.render(vehicle({pricing:{current_bid_usd:0,buy_now_usd:2000}}));
 assert.match(view.page.innerHTML,/id="currentBidPrice">Brak danych o ofercie/);assert.match(view.page.innerHTML,/id="buyNowPrice">\$2,000/);
 assert.match(view.page.innerHTML,/data-calc-price-kind="current"[^>]+disabled hidden/);
 assert.ok(view.page.innerHTML.indexOf('id="vehicleKeyDetails"')<view.page.innerHTML.indexOf('id="importCalculator"'));
 view.api.render(vehicle({pricing:{current_bid_usd:null,buy_now_usd:null}}));assert.doesNotMatch(view.page.innerHTML,/id="currentBidPrice">\$0/);
});
test("owner review: green insurer type requires explicit source type, preserves name and explains limits",()=>{
 const view=vehiclePage();for(const type of ['Insurance','Insurance Company','Ubezpieczyciel']){
  view.api.render(vehicle({seller:{name:'Example Underwriter',type}}));assert.match(view.page.innerHTML,/rex-seller-insurance/);assert.match(view.page.innerHTML,/Example Underwriter/);assert.match(view.page.innerHTML,/Typ akceptowany przez REXBID/);assert.match(view.page.innerHTML,/Nie oznacza indywidualnej weryfikacji firmy/);
 }
 view.api.render(vehicle({seller:{name:'Insurance Company',type:null}}));assert.doesNotMatch(view.page.innerHTML,/class="rex-seller-insurance"/);
 view.api.render(vehicle({seller:{name:null,type:'Insurance'}}));assert.doesNotMatch(view.page.innerHTML,/Nazwa niedostępna/);
});

test("history renders unsold and conditional auction amounts separately from sales without shifting date",()=>{
 const view=vehiclePage();view.api.render(vehicle());view.api.history([
  {platform:'iaai',lot:'12345678',auction_date:'2026-10-01',status:'Not Sold',source_price:2900,final_price:2900},
  {platform:'iaai',lot:'12345678',auction_date:'2026-09-24',status:'Sold on Approval',source_price:2775,final_price:2775},
  {platform:'copart',lot:'12345679',auction_date:'2026-08-20',status:'Not Sold',current_bid:0}
 ]);
 const result=view.node('auctionHistory').innerHTML;
 for(const expected of ['01.10.2026','24.09.2026','20.08.2026','Nie sprzedano','Oferta warunkowa','$2,900','$2,775','sprzedaż niepotwierdzona'])assert.ok(result.includes(expected),expected);
 assert.doesNotMatch(result,/\$0/);
 assert.doesNotMatch(result,/Cena końcowa|Cena sprzedaży/);
});

test("historical conditional offer explains unresolved outcome, preserves raw status and calendar day",()=>{
 const view=vehiclePage();view.api.render(vehicle());view.api.history([
  {platform:'copart',lot:'DIFFERENT-LOT',auction_date:'2026-10-01T00:10:00+14:00',status:'Sold on Approval',source_price:2775},
  {platform:'iaai',lot:'ANOTHER-LOT',auction_date:'2026-09-24T23:50:00-12:00',status:'Sold',final_price:2900}
 ]);
 const result=view.node('auctionHistory').innerHTML;
 for(const phrase of ['Oferta warunkowa','Sprzedaż wymagała zatwierdzenia; końcowy wynik niepotwierdzony','Status źródłowy','Sold on Approval','01.10.2026','24.09.2026','DIFFERENT-LOT','ANOTHER-LOT'])assert.match(result,new RegExp(phrase));
 assert.doesNotMatch(result,/Oczekuje na zatwierdzenie/);
 for(const label of ['Aukcja','Data wydarzenia','LOT','Cena / oferta','Status','Sprzedający'])assert.ok(result.includes('data-label="'+label+'"'));
 assert.match(fs.readFileSync(path.join(__dirname,'../public/rexbid-vehicle.css'),'utf8'),/#auctionHistory \.history-table tr\{display:grid/);
 assert.ok(view.page.innerHTML.indexOf('id="auctionHistory"')<view.page.innerHTML.indexOf('id="observedHistory"'));
 assert.match(view.page.innerHTML,/<h3>Historia aukcji<\/h3>/);
 assert.match(view.page.innerHTML,/<details[^>]*id="observedHistoryDetails"[^>]*><summary>Zapisane obserwacje/);
 assert.doesNotMatch(view.page.innerHTML,/<details[^>]*id="observedHistoryDetails"[^>]*\bopen\b/);
});

test("history availability distinguishes never fetched, fetched empty and read failure, preserving observations",()=>{
 const view=vehiclePage();view.api.render(vehicle());
 for(const [state,text] of [['not_fetched','nie została jeszcze pobrana'],['fetched_empty','Źródło nie zwróciło wydarzeń'],['read_failed','Nie udało się odczytać historii']]){
  view.api.history([],{state,complete:true},[{kind:'observed_snapshot',snapshot_id:1,observed_at:'2026-10-08T09:00:00Z',current_bid_usd:0}]);
  assert.ok(view.node('auctionHistory').innerHTML.includes(text));assert.equal(view.node('observedHistoryDetails').hidden,false);assert.match(view.node('observedHistory').innerHTML,/Brak danych/);assert.doesNotMatch(view.node('observedHistory').innerHTML,/\$0/);
 }
 view.api.history([],{state:'fetched_empty',complete:false});assert.match(view.node('auctionHistory').innerHTML,/Pobrana strona/);
 view.api.history([{auction_date:'2026-10-01',status:'Sold on Approval',source_price:2050}],{state:'read_failed'});assert.match(view.node('auctionHistory').innerHTML,/pokazujemy zachowane wydarzenia/);
});

test("history uses exact LOT and platform for arbitrary listings, handles endpoint failure without false empty",async()=>{
 const view=vehiclePage();view.api.render(vehicle({lot_number:'GENERIC-LOT',platform:'iaai'}));let calls=0;
 view.context.fetch=async url=>{calls++;const u=new URL(url,'https://staging.invalid');assert.equal(u.pathname,'/api/car/GENERIC-LOT/history');assert.equal(u.searchParams.get('platform'),'iaai');return {ok:true,json:async()=>({history:[],meta:{history_availability:{state:'fetched_empty',complete:true}}})};};
 await view.api.fetchHistory();assert.equal(calls,1);assert.match(view.node('auctionHistory').innerHTML,/Źródło nie zwróciło wydarzeń/);
 view.context.fetch=async()=>({ok:false,status:503});await view.api.fetchHistory();assert.match(view.node('auctionHistory').innerHTML,/Nie udało się odczytać/);
});

test("stored partial auction events remain visible with their history read date, without replacing the earlier vehicle price",()=>{
 const view=vehiclePage();view.api.render(vehicle({pricing:{current_bid_usd:5000,buy_now_usd:null}}));
 const before=view.page.innerHTML;
 view.api.history([{platform:'copart',lot:'62674546',auction_date:'2026-10-08',status:'Sold',final_price:9100}],{state:'stored',complete:false,fetched_at:'2026-10-08T17:47:19.543Z'});
 const result=view.node('auctionHistory').innerHTML;
 for(const phrase of ['Zapisana historia jest częściowa','Odczyt historii:','08.10.2026','$9,100','Cena końcowa','Sprzedano'])assert.ok(result.includes(phrase),phrase);
 assert.equal(view.page.innerHTML,before,'history must not restamp the listing or replace its separate observed price');
});

test("known damage and start codes have conservative Polish labels; unknown descriptions remain unchanged",()=>{
 const view=vehiclePage();view.api.render(vehicle({condition:{primary_damage:'Left rear',run_condition:'STATIONARY',has_key:true}}));
 assert.match(view.page.innerHTML,/Lewy tył/);assert.match(view.page.innerHTML,/Uruchomienie niepotwierdzone/);assert.match(view.page.innerHTML,/Kod źródłowy: STATIONARY/);
 assert.doesNotMatch(view.page.innerHTML,/Silnik uszkodzony|Nie uruchamia się/);
 view.api.render(vehicle({condition:{primary_damage:'Unlisted provider code',run_condition:'Starts'}}));assert.match(view.page.innerHTML,/Unlisted provider code/);assert.match(view.page.innerHTML,/Odnotowano uruchomienie silnika/);
 for(const code of ['STATIONARY / NO INFORMATION','ENGINE START PROGRAM','Vehicle Starts']){
  view.api.render(vehicle({condition:{primary_damage:'Fresh water',run_condition:code}}));
  assert.match(view.page.innerHTML,/Zalanie wodą słodką/);
  assert.ok(view.page.innerHTML.includes(code));
  assert.match(view.page.innerHTML,code.startsWith('STATIONARY')?/Uruchomienie niepotwierdzone/:/Odnotowano uruchomienie silnika/);
 }
});

test("catalog and vehicle use the same exact Polish damage labels, keeping unknown source descriptions",()=>{
 const market=require('../public/rexbid-market.js');
 for(const [raw,label] of [['Left rear','Lewy tył'],['Front end','Przód'],['Fresh water','Zalanie wodą słodką'],['Normal wear & tear','Normalne zużycie'],['Normal wear and tear','Normalne zużycie'],['Unknown code','Unknown code']]){
  assert.equal(market.damageLabel(raw),label);
  const view=vehiclePage();view.api.render(vehicle({condition:{primary_damage:raw}}));assert.ok(view.page.innerHTML.includes(label));
 }
 const catalog=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 assert.match(catalog,/const damage = RexBidMarket\.damageLabel\(damageSource\)/);
 assert.match(catalog,/<strong title="\$\{escapeHtml\(damageSource\)\}">/);
});


test("archival catalogue detail stays reachable without implying current availability or a live bid",()=>{
 const view=vehiclePage();const read={source:'d1',freshness:'fresh',catalog_scope:'archival',last_synced_at:'2026-11-01T09:00:00Z'};
 const record=vehicle({read,auction:{state:'live',source_status:'Live',schedule_status:'live',is_timed:true,timed_end_at:'2099-12-15T15:00:00Z'}});
 view.api.render(record);assert.match(view.page.innerHTML,/Poza bieżącym katalogiem · zapis archiwalny/);assert.match(view.page.innerHTML,/Ten pojazd nie jest potwierdzony w bieżącym katalogu/);
 view.api.update();assert.match(view.node('vehicleFreshnessHeading').textContent,/zapis archiwalny/);assert.equal(view.api.phase(),'snapshot');assert.equal(view.node('bidLabel').textContent,'Ostatnia zapisana oferta');assert.equal(view.node('auctionTimerBox').style.display,'none');assert.equal(view.node('currentBidPrice').textContent,'$1,200');
 assert.equal(view.context.RexBidMarket.availabilityStatus(record),'unknown');
 assert.equal(view.context.RexBidMarket.availabilityStatus({...record,auction:{state:'finished',outcome_status:'Sold'}}),'ended');
 view.api.refresh(vehicle({read:{...read,catalog_scope:'current'}}));assert.doesNotMatch(view.node('vehicleFreshnessHeading').textContent,/archiwalny/);
});
