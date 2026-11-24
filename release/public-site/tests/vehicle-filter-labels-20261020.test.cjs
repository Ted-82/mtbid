"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const labels = require("../public/rexbid-vehicle-labels.js");

const observedRuns = ["DEFAULT", "RUNS AND DRIVES", "ENGINE START PROGRAM", "Run & Drive Verified",
  "Unknown", "ENHANCED VEHICLES", "Vehicle Starts", "STATIONARY / NO INFORMATION"];
const observedDrives = ["ALL WHEEL DRIVE", "REAR WHEEL DRIVE", "4X4 W/REAR WHEEL DRV",
  "FRONT WHEEL DRIVE", "Front-wheel Drive", "4X4 W/FRONT WHL DRV", "UNKNOWN", "Rear Wheel Drive",
  "All Wheel Drive", "FOUR BY FOUR", "Front Wheel Drive", "4X2", "Rear-wheel drive",
  "4x4 w/Front Whl Drv", "4x4 w/Rear Wheel Drv", "4X4 Drive", "4X2 Drive"];
const d1Source = {read_source:"d1",known_rows_only:true};

test("D1 drive options collapse only identical predicates, retaining raw representatives and run codes", () => {
  const actual=labels.options("drive",observedDrives.map(value=>({value})),d1Source);
  assert.deepEqual(actual.map(item=>item.value),["ALL WHEEL DRIVE","REAR WHEEL DRIVE","4X4 W/REAR WHEEL DRV",
    "FRONT WHEEL DRIVE","4X4 W/FRONT WHL DRV","UNKNOWN","FOUR BY FOUR","4X2","4X4 Drive","4X2 Drive"]);
  assert.deepEqual(labels.options("run",observedRuns.map(value=>({value})),d1Source).map(item=>item.value),observedRuns);
  const edge=["FWD","Front  Wheel Drive","ÉLECTRIQUE","électrique","4X2","4X2 Drive","4X4 Drive","FOUR BY FOUR"];
  assert.deepEqual(labels.options("drive",edge.map(value=>({value})),d1Source).map(item=>item.value),edge);
});

test("every collapsed drive option returns identical ordered rows using the actual D1 repository query",async t=>{
  const {DatabaseSync}=require("node:sqlite");
  const {D1ReadRepository}=require("../sync/d1-read-repository.js");
  const db=new DatabaseSync(":memory:");
  t.after(()=>db.close());
  db.exec(`CREATE TABLE auction_listings(listing_id TEXT,source_key TEXT,last_seen_at TEXT,drive_type TEXT);
    CREATE TABLE vehicle_sources(source_key TEXT,provider TEXT,provider_vehicle_id TEXT,last_attempt_at TEXT,last_success_at TEXT,last_error_code TEXT);`);
  const values=[...observedDrives,"AWD","FWD","RWD","4WD","front wheel drive","four wheel drive",
    "  FWD  ","Front  Wheel Drive","ÉLECTRIQUE","électrique","4x2"," 4X2 "," 4X4 Drive ",null];
  for(let i=0;i<values.length;i++){
    db.prepare("INSERT INTO auction_listings VALUES(?,?,?,?)").run(String(i).padStart(3,"0"),String(i),"2026-10-20",values[i]);
    db.prepare("INSERT INTO vehicle_sources VALUES(?,'apibara',?,NULL,NULL,NULL)").run(String(i),String(i));
  }
  const queries=new Map();
  for(const value of values.filter(value=>value!==null)){
    const fake={prepare(sql){return {bind(...params){return {async all(){queries.set(value,{sql,params});return {results:[]};}};},
      async all(){return {results:[]};}};}};
    await new D1ReadRepository(fake).listCatalog({driveType:value,limit:50});
  }
  const rows=value=>{
    const query=queries.get(value);
    return db.prepare(query.sql).all(...query.params).map(row=>row.listing_id);
  };
  for(const original of queries.keys()){
    const group=labels.options("drive",[{value:original},{value:"FWD"}],d1Source);
    if(group.length===1)assert.deepEqual(rows(original),rows("FWD"));
    for(const selected of queries.keys()){
      const result=labels.options("drive",[{value:original},{value:selected}],d1Source);
      if(result.length===1)assert.deepEqual(rows(original),rows(selected),`${original} != ${selected}`);
    }
  }
  for(const [left,right] of [["4X2","4X2 Drive"],["4X4 Drive","FOUR BY FOUR"],["FWD","Front  Wheel Drive"],
    ["ÉLECTRIQUE","électrique"]])assert.notDeepEqual(rows(left),rows(right));
});

test("known run labels describe the source observation without diagnosing roadworthiness", () => {
  assert.equal(labels.label("run", "RUNS AND DRIVES"), "Odnotowano uruchomienie i jazdę");
  assert.equal(labels.label("run", "Run & Drive Verified"), "Odnotowano uruchomienie i jazdę");
  assert.equal(labels.label("run", "ENGINE START PROGRAM"), "Odnotowano uruchomienie");
  assert.equal(labels.label("run", "Vehicle Starts"), "Odnotowano uruchomienie");
  assert.equal(labels.label("run", "STATIONARY / NO INFORMATION"), "Uruchomienie niepotwierdzone");
  assert.equal(labels.label("run", "stationary"), "Uruchomienie niepotwierdzone");
  assert.equal(labels.label("run", "Unknown"), "Nieustalone");
});

test("only recognized whole codes are translated; ambiguous and unknown codes remain verbatim", () => {
  for (const raw of ["DEFAULT", "ENHANCED VEHICLES", "NOT RUNS AND DRIVES", "run & drive pending",
    "Vehicle Starts Sometimes", "4X4 W/FRONT WHL DRV", "4X4 W/REAR WHEEL DRV", "  NEW CODE  "]) {
    assert.equal(labels.label("run", raw), raw);
    assert.equal(labels.label("drive", raw), raw);
  }
  assert.equal(labels.label("run", true), "");
  assert.equal(labels.label("run", 1), "1", "no inferred run-and-drive from a boolean-like code");
  assert.equal(labels.label("run", 0), "0");
  assert.equal(labels.label("run", null), "");
  assert.equal(labels.label("run", {value:"Vehicle Starts"}), "");
  assert.equal(labels.label("run", "UNKNOWN NEW", "Etykieta źródła"), "Etykieta źródła");
  assert.equal(labels.label("other", "FWD"), "FWD");
  assert.equal(labels.label("__proto__", "FWD"), "FWD");
  assert.equal(labels.label("constructor", "FWD"), "FWD");
});

test("drive aliases share consistent display labels without inferring a driven axle from 4x2", () => {
  for (const raw of ["Front Wheel Drive", "Front-wheel Drive", "FWD"]) {
    assert.equal(labels.label("drive", raw), "Przedni — FWD");
  }
  for (const raw of ["REAR WHEEL DRIVE", "Rear-wheel drive", "RWD"]) {
    assert.equal(labels.label("drive", raw), "Tylny — RWD");
  }
  for (const raw of ["ALL WHEEL DRIVE", "All Wheel Drive", "AWD"]) {
    assert.equal(labels.label("drive", raw), "Na wszystkie koła — AWD");
  }
  for (const raw of ["4X2", "4X2 Drive"]) assert.equal(labels.label("drive", raw), "4×2");
  for (const raw of ["4X4 Drive", "FOUR BY FOUR", "four wheel drive", "4WD"]) {
    assert.equal(labels.label("drive", raw), "4×4");
  }
  assert.equal(labels.label("run", "  VEHICLE   STARTS  "), "Odnotowano uruchomienie");
});

test("all observed raw filter values survive translation and collision disambiguation", () => {
  for (const [kind,values] of [["run",observedRuns],["drive",observedDrives]]) {
    const source = values.map(value => Object.freeze({value,label:value,source:"fixture"}));
    Object.freeze(source);
    const actual = labels.options(kind, source);
    assert.deepEqual(actual.map(item=>item.value), values);
    assert.equal(new Set(actual.map(item=>item.label)).size, values.length);
    assert.ok(actual.every(item=>item.source==="fixture"));
    assert.equal(source[0].label, values[0], "input not mutated");
    for (const item of actual) {
      const params = new URLSearchParams({[kind==="run"?"run_cond":"drive_type"]:item.value});
      assert.equal(params.get(kind==="run"?"run_cond":"drive_type"), item.value);
    }
  }
  const two = labels.options("drive", [{value:"4X2",label:"4X2"}, {value:"4X2 Drive",label:"4X2 Drive"}]);
  assert.deepEqual(two.map(item=>item.label), ["4×2 (4X2)", "4×2 (4X2 Drive)"]);
});

test("deduplication is by exact raw value only, not case, trim or translated text", () => {
  const actual=labels.options("run", [{value:"Vehicle Starts"}, {value:"vehicle starts"},
    {value:" Vehicle Starts "}, {value:"Vehicle Starts",label:"second duplicate"}, {value:""}, null]);
  assert.deepEqual(actual.map(item=>item.value), ["Vehicle Starts", "vehicle starts", " Vehicle Starts "]);
  assert.equal(new Set(actual.map(item=>item.label)).size, 3);
  assert.deepEqual(labels.options("drive", null), []);
  assert.deepEqual(labels.options("drive", [{value:0}, {value:{}}]), []);
});

test("module is usable in the browser without DOM, network or persistent storage", () => {
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve("../public/rexbid-vehicle-labels.js"),"utf8"),context);
  assert.equal(context.RexBidVehicleLabels.label("drive","4X2 Drive"),"4×2");
  assert.equal(Object.isFrozen(context.RexBidVehicleLabels),true);
});

const {JSDOM} = require("jsdom");
const html=fs.readFileSync(require.resolve("../public/index.html"),"utf8");
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const inline=scripts.find(match=>!/\bsrc=/.test(match[1]))[2];
const startup=inline.lastIndexOf("  restoreFiltersFromUrl();");
assert.ok(startup>0);
function page(t,{route="/?catalog=1",helper=true,runs=observedRuns,drives=observedDrives,metadata=null}={}) {
  const dom=new JSDOM(html,{url:"https://rexbid.pl"+route,runScripts:"outside-only"});
  t.after(()=>dom.window.close());
  const win=dom.window,requests=[],node=id=>win.document.getElementById(id);
  win.RexBidMarket=require("../public/rexbid-market");
  win.RexBidStorage={safeImageUrl:()=>"",isFavorite:()=>false,refreshCounts(){}};
  win.matchMedia=()=>({matches:false});
  win.scrollTo=()=>{};
  win.requestAnimationFrame=callback=>callback();
  win.HTMLElement.prototype.scrollIntoView=function(){};
  win.fetch=async(url,options)=>{
    const parsed=new URL(url,"https://rexbid.pl");
    assert.equal(parsed.origin,"https://rexbid.pl");
    assert.equal(options?.method||"GET","GET");
    requests.push(parsed);
    assert.ok(["/api/filters","/api/cars"].includes(parsed.pathname));
    const body=parsed.pathname==="/api/filters"
      ? metadata ? metadata() : {ok:true,data:{run_conditions:runs,drive_types:drives},meta:d1Source}
      : {ok:true,data:[],meta:{next_cursor:null}};
    return new Response(JSON.stringify(body),{headers:{"content-type":"application/json"}});
  };
  if(helper)win.eval(fs.readFileSync(require.resolve("../public/rexbid-vehicle-labels.js"),"utf8"));
  win.eval(inline.slice(0,startup)+"\nwindow.filterLabelsApi={metadata:()=>{advancedFiltersElement.open=true;return loadAdvancedFilterMetadata();},restore:restoreFiltersFromUrl,load:loadCars,remove:removeCatalogFilter};");
  win.filterLabelsApi.restore();
  return {win,node,requests,api:win.filterLabelsApi,
    options(id){return [...node(id).options].filter(option=>option.value).map(option=>({value:option.value,label:option.textContent}));}};
}

test("catalog loads the shared label script synchronously before its inline controller",()=>{
  const helperIndex=scripts.findIndex(match=>/src="\/rexbid-vehicle-labels\.js\?v=/.test(match[1]));
  const controllerIndex=scripts.findIndex(match=>!/\bsrc=/.test(match[1]));
  assert.ok(helperIndex>=0 && helperIndex<controllerIndex);
  assert.doesNotMatch(scripts[helperIndex][1],/\b(?:defer|async)\b/);
});

test("provider DOM retains every raw value even when Polish labels match",async t=>{
  const p=page(t,{metadata:()=>({ok:true,data:{run_conditions:observedRuns,drive_types:observedDrives},
    meta:{read_source:"provider",known_rows_only:true}})});
  await p.api.metadata();
  for(const [id,values] of [["runCond",observedRuns],["driveType",observedDrives]]) {
    const actual=p.options(id);
    assert.deepEqual(actual.map(item=>item.value),values);
    assert.equal(new Set(actual.map(item=>item.label)).size,values.length);
  }
  assert.equal(p.options("runCond").find(item=>item.value==="DEFAULT").label,"DEFAULT");
  assert.equal(p.options("runCond").find(item=>item.value==="ENHANCED VEHICLES").label,"ENHANCED VEHICLES");
  assert.equal(p.options("driveType").find(item=>item.value==="4X2").label,"4×2 (4X2)");
  assert.equal(p.options("driveType").find(item=>item.value==="4X2 Drive").label,"4×2 (4X2 Drive)");
});

test("DOM groups confirmed D1 options, including cached metadata, and preserves selected aliases in URL and requests",async t=>{
  for(const drive of ["Front-wheel Drive","FWD","4x4 w/Front Whl Drv"]){
    const p=page(t,{route:"/?"+new URLSearchParams({catalog:"1",drive_type:drive})});
    await p.api.metadata();
    await p.api.metadata();
    assert.equal(p.requests.filter(url=>url.pathname==="/api/filters").length,1);
    assert.equal(p.options("driveType").length,10);
    assert.equal(p.node("driveType").value,drive);
    assert.equal(p.options("driveType").filter(item=>item.label==="Przedni — FWD").length,1);
    assert.deepEqual(p.options("runCond").map(item=>item.value),observedRuns);
    await p.api.load();
    assert.equal(p.requests.find(url=>url.pathname==="/api/cars").searchParams.get("drive_type"),drive);
    assert.equal(new URL(p.win.location.href).searchParams.get("drive_type"),drive);
  }
});

test("unknown or unconfirmed provenance preserves all drive options",async t=>{
  for(const [ok,meta] of [[true,null],[true,{read_source:"hybrid",known_rows_only:true}],
    [true,{read_source:"d1",known_rows_only:false}],[true,{read_source:"d1",known_rows_only:"true"}],
    [undefined,d1Source]]){
    const p=page(t,{metadata:()=>({ok,data:{drive_types:observedDrives},meta})});
    await p.api.metadata();
    assert.deepEqual(p.options("driveType").map(item=>item.value),observedDrives);
  }
});

test("expired D1 provenance is not reused by a subsequent provider response",async t=>{
  let source=d1Source,now=100000;
  const p=page(t,{metadata:()=>({ok:true,data:{drive_types:observedDrives},meta:source})});
  p.win.Date.now=()=>now;
  await p.api.metadata();
  assert.equal(p.options("driveType").length,10);
  source={read_source:"provider",known_rows_only:true};
  now+=31000;
  await p.api.metadata();
  assert.deepEqual(p.options("driveType").map(item=>item.value),observedDrives);
  assert.equal(p.requests.filter(url=>url.pathname==="/api/filters").length,2);
});

test("URL selection survives metadata translation and requests keep original run/drive values",async t=>{
  const run="Vehicle Starts",drive="4X2 Drive";
  const params=new URLSearchParams({catalog:"1",run_cond:run,drive_type:drive});
  const p=page(t,{route:"/?"+params});
  assert.equal(p.node("runCond").value,run);
  assert.equal(p.node("driveType").value,drive);
  await p.api.metadata();
  assert.equal(p.node("runCond").value,run);
  assert.equal(p.node("driveType").value,drive);
  assert.match(p.node("runCond").selectedOptions[0].textContent,/Odnotowano uruchomienie/);
  assert.equal(await p.api.load(),true);
  const request=p.requests.find(item=>item.pathname==="/api/cars");
  assert.equal(request.searchParams.get("run_cond"),run);
  assert.equal(request.searchParams.get("drive_type"),drive);
  assert.equal(new URL(p.win.location.href).searchParams.get("run_cond"),run);
  assert.equal(new URL(p.win.location.href).searchParams.get("drive_type"),drive);
  assert.match(p.node("activeFilterChips").textContent,/4×2 \(4X2 Drive\)/);
  assert.doesNotMatch(request.href,/Odnotowano|4%C3%972/);
});

test("selected URL values missing from current metadata stay selectable and are never guessed",async t=>{
  const run="UNRECOGNIZED RUN CODE",drive="4X4 W/REAR WHEEL DRV";
  const p=page(t,{route:"/?"+new URLSearchParams({catalog:"1",run_cond:run,drive_type:drive}),
    runs:["Vehicle Starts"],drives:["4X4 Drive"]});
  await p.api.metadata();
  assert.equal(p.node("runCond").value,run);
  assert.equal(p.node("driveType").value,drive);
  assert.equal(p.node("runCond").selectedOptions[0].textContent,run);
  assert.equal(p.node("driveType").selectedOptions[0].textContent,drive);
  await p.api.load();
  const request=p.requests.find(item=>item.pathname==="/api/cars");
  assert.equal(request.searchParams.get("run_cond"),run);
  assert.equal(request.searchParams.get("drive_type"),drive);
});

test("missing helper still preserves distinct raw choices; unknown text is escaped by the DOM renderer",async t=>{
  const raw='<img src=x onerror="throw 1">';
  const p=page(t,{helper:false,runs:[{value:"CODE A",label:"Same label"},{value:"CODE B",label:"Same label"},raw]});
  await p.api.metadata();
  assert.deepEqual(p.options("runCond").map(item=>item.value),["CODE A","CODE B",raw]);
  assert.equal(p.node("runCond").querySelector("img"),null);
  assert.equal(p.node("runCond").querySelector('option[value="CODE A"]').textContent,"Same label");
  assert.equal(p.node("runCond").querySelector('option[value="CODE B"]').textContent,"Same label");
});

test("recognized damage, fuel, transmission and body codes have Polish labels without changing their meaning",()=>{
  for(const [kind,value,expected] of [
    ["damage","Left rear","Lewy tył"],["damage","Front end","Przód"],
    ["damage","Minor dent/scratches","Drobne wgniecenia / zarysowania"],
    ["damage","None","Nie wskazano uszkodzeń"],["damage","Repossession","Odebranie przez wierzyciela"],
    ["damage","Water/flood","Zalanie"],["damage","Undercarriage","Podwozie"],
    ["fuel","Compressed natural gas","Gaz ziemny — CNG"],["fuel","Hydrogen fuel cell","Wodorowe ogniwo paliwowe"],
    ["transmission","Automatic","Automatyczna"],["transmission","None","Nie wskazano skrzyni biegów"],
    ["body","Station wagon","Kombi"],["body","4dr sport utility","SUV 4-drzwiowy"],
    ["body","Motor Home","Kamper"],["body","kind:atv","ATV / quady"],
    ["seller","RCC","Typ nieustalony (kod RCC)"],["seller","insurance","Ubezpieczyciel"]
  ]) assert.equal(labels.label(kind,value),expected,`${kind}:${value}`);
  assert.equal(labels.label("body","Station wagon","Nadwozie: Station wagon"),"Nadwozie: Kombi");
  for(const value of ["4dr spor","Sports v","Motorize","Full Size 3qtr to 1 Ton Pickup"])
    assert.equal(labels.label("body",value),value,"ambiguous or truncated codes must stay original");
  for(const value of ["ADJ","COR","DLR","SDS","SAL","FIN"])
    assert.equal(labels.label("seller",value),value,"no unverified interpretation of seller codes");
});

test("translation never removes a different raw fuel/body/damage/transmission predicate",()=>{
  for(const [kind,values] of [
    ["fuel",["Gas","Gasoline","Hybrid","Electric and gas hybrid","Flexible","Flexible fuel","Flexiblefuel"]],
    ["damage",["Front","Front end","Rear","Rear end","Flood","Water/flood"]],
    ["body",["Coupe","COUPE","Station wagon","Wagon","Sedan 4d","Sedan 4dr"]],
    ["transmission",["Automatic","Automatic transmission"]]
  ]) {
    const input=values.map(value=>Object.freeze({value,label:value}));
    const result=labels.options(kind,Object.freeze(input),d1Source);
    assert.deepEqual(result.map(item=>item.value),values);
    assert.equal(new Set(result.map(item=>item.label)).size,values.length);
    assert.deepEqual(input.map(item=>item.label),values);
  }
});

test("catalog DOM translates observed metadata while raw choices survive requests and URL round trips",async t=>{
  const selections={fuel_type:"Gasoline",transmission:"Automatic",type:"Station wagon",damage:"Front end",seller_type:"insurance"};
  const p=page(t,{route:"/?"+new URLSearchParams({catalog:"1",...selections}),metadata:()=>({ok:true,meta:d1Source,data:{
    fuel_types:["Gas","Gasoline","Diesel","Electric"],transmissions:["Automatic","Manual","None"],
    vehicle_types:[{value:"kind:car",label:"Samochody"},{value:"Station wagon",label:"Nadwozie: Station wagon"},{value:"Wagon",label:"Nadwozie: Wagon"}],
    damages:["Front","Front end","Left rear"],seller_types:["insurance","RCC"],sale_document_types:["danger","other","success"]
  }})});
  await p.api.metadata();
  assert.deepEqual(p.options("fuelType").map(x=>x.value),["Gas","Gasoline","Diesel","Electric"]);
  assert.deepEqual(p.options("damage").map(x=>x.value),["Front","Front end","Left rear"]);
  assert.equal(p.node("fuelType").selectedOptions[0].textContent,"Benzyna (Gasoline)");
  assert.equal(p.node("vehicleType").selectedOptions[0].textContent,"Nadwozie: Kombi (Station wagon)");
  assert.equal(p.node("damage").selectedOptions[0].textContent,"Przód (Front end)");
  assert.equal(p.node("transmission").selectedOptions[0].textContent,"Automatyczna");
  assert.equal(await p.api.load(),true);
  const request=p.requests.find(x=>x.pathname==="/api/cars");
  for(const [name,value] of Object.entries(selections)) {
    assert.equal(request.searchParams.get(name),value);
    assert.equal(new URL(p.win.location.href).searchParams.get(name),value);
  }
});

test("document colour codes are never presented as legal document types or eligibility",async t=>{
  const values=["danger","other","success"];
  assert.deepEqual(labels.options("document",values.map(value=>({value}))),[]);
  const p=page(t,{metadata:()=>({ok:true,meta:d1Source,data:{sale_document_types:values}})});
  await p.api.metadata();
  assert.deepEqual(p.options("saleDocument"),[]);
  assert.equal(p.node("saleDocument").disabled,true);
  assert.equal(p.node("saleDocument").options[0].textContent,"Dokument — sprawdź kartę auta");
  assert.match(p.node("saleDocumentNote").textContent,/Brak nazw dokumentów/);
  assert.equal(p.node("saleDocument").getAttribute("aria-describedby"),"saleDocumentNote");
  assert.doesNotMatch(p.node("saleDocument").textContent,/danger|success|other/);
});

test("legacy selected document code remains exact and removable without inventing a document type",async t=>{
  for(const selected of ["danger","success","other","UNKNOWN LEGACY"]){
    const p=page(t,{route:"/?"+new URLSearchParams({catalog:"1",sale_document_type:selected}),
      metadata:()=>({ok:true,meta:d1Source,data:{sale_document_types:["danger","other","success"]}})});
    await p.api.metadata();
    assert.equal(p.node("saleDocument").disabled,true);
    assert.equal(p.node("saleDocument").value,"");
    assert.match(p.node("activeFilterChips").textContent,/Starszy kod dokumentu/);
    assert.ok(p.node("activeFilterChips").textContent.includes(selected));
    await p.api.load();
    assert.equal(p.requests.find(x=>x.pathname==="/api/cars").searchParams.get("sale_document_type"),selected);
    assert.equal(new URL(p.win.location.href).searchParams.get("sale_document_type"),selected);
    assert.equal(p.api.remove("legacyDocument"),true);
    await p.api.load();
    assert.equal(new URL(p.win.location.href).searchParams.has("sale_document_type"),false);
    await p.api.metadata();
    assert.equal(p.node("saleDocument").disabled,true);
    assert.equal(p.options("saleDocument").length,0);
  }
});

test("source document names stay selectable independently of colour types; empty metadata clears stale choices",async t=>{
  let values=["SALVAGE","CLEAR"];
  const p=page(t,{metadata:()=>({ok:true,meta:d1Source,data:{sale_document_names:values,sale_document_types:["danger","success"]}})});
  let now=100000; p.win.Date.now=()=>now;
  await p.api.metadata();
  assert.deepEqual(p.options("saleDocument"),[{value:"SALVAGE",label:"SALVAGE"},{value:"CLEAR",label:"CLEAR"}]);
  assert.equal(p.node("saleDocument").disabled,false);
  values=[];now+=31000;
  await p.api.metadata();
  assert.equal(p.options("saleDocument").length,0);
  assert.equal(p.node("saleDocument").disabled,true);
});

test("source names do not depend on the label helper or turn a legacy code into a name",async t=>{
  const p=page(t,{helper:false,route:"/?catalog=1&sale_document_type=danger",metadata:()=>({ok:true,meta:d1Source,data:{sale_document_names:["SALVAGE"],sale_document_types:["danger","success"]}})});
  await p.api.metadata();
  assert.deepEqual(p.options("saleDocument"),[{value:"SALVAGE",label:"SALVAGE"}]);
  assert.match(p.node("saleDocumentNote").textContent,/Nazwa nie potwierdza możliwości rejestracji/);
  assert.equal(p.node("saleDocument").disabled,false);
  await p.api.load();
  assert.equal(p.requests.at(-1).searchParams.get("sale_document_type"),"danger");
  assert.equal(p.requests.at(-1).searchParams.get("sale_document_name"),null);
});

test("document name and old code remain independent through URL restore, requests and removal",async t=>{
  const selected="BILL OF SALE - PARTS ONLY";
  const p=page(t,{route:"/?"+new URLSearchParams({catalog:"1",platform:"iaai",sale_document_name:selected,sale_document_type:"danger"}),
    metadata:()=>({ok:true,meta:d1Source,data:{sale_document_names:[selected,"CLEAR"],sale_document_types:["danger"]}})});
  await p.api.metadata();await p.api.load();
  assert.equal(p.node("saleDocument").value,selected);
  const request=p.requests.find(url=>url.pathname==="/api/cars");
  assert.equal(request.searchParams.get("sale_document_name"),selected);
  assert.equal(request.searchParams.get("sale_document_type"),"danger");
  assert.ok(p.node("activeFilterChips").textContent.includes(selected));
  p.api.remove("legacyDocument");await p.api.load();
  assert.equal(new URL(p.win.location.href).searchParams.get("sale_document_name"),selected);
  assert.equal(new URL(p.win.location.href).searchParams.has("sale_document_type"),false);
});

test("unknown explicit document names stay escaped, selectable and exact after empty metadata",async t=>{
  const selected='<img src=x onerror="alert(1)">';
  const p=page(t,{route:"/?"+new URLSearchParams({catalog:"1",sale_document_name:selected}),metadata:()=>({ok:true,meta:d1Source,data:{sale_document_names:[]}})});
  await p.api.metadata();await p.api.load();
  assert.deepEqual(p.options("saleDocument"),[{value:selected,label:selected}]);
  assert.equal(p.node("saleDocument").querySelector("img"),null);
  assert.match(p.node("saleDocumentNote").textContent,/wynik może być pusty/);
  assert.equal(p.requests.find(url=>url.pathname==="/api/cars").searchParams.get("sale_document_name"),selected);
});
