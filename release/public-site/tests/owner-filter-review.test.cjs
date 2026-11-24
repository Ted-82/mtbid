const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {DatabaseSync} = require('node:sqlite');
const {createApibaraProvider} = require('../providers/apibara');
const {D1ReadRepository} = require('../sync/d1-read-repository');
const calc = require('../public/rexbid-calculator-v4');

test('IAAI description supplies drivetrain, transmission, fuel and body independently of vehicle_information', () => {
  const provider = createApibaraProvider({apiKey:'offline-test'});
  const value = provider.normalizeVehicle({platform:'iaai',lot_number:12345678,vin:'5YJXCAE20JF088685',details:{vehicle_description:{DriveLineType:'All Wheel Drive',Transmission:'Automatic Transmission',FuelType:'Electric',BodyStyle:'SPORT UTILITY'}}});
  assert.equal(value.driveType,'All Wheel Drive');
  assert.equal(value.transmission,'Automatic Transmission');
  assert.equal(value.fuelType,'Electric');
  assert.equal(value.bodyStyle,'SPORT UTILITY');
});

test('D1 metadata includes all supported advanced filters without inventing inventory', async t => {
  const rows=[{make:'HONDA',model:'CIVIC',year:2022,body_style:'SEDAN',fuel_type:'Gasoline',transmission:'Automatic',drive_type:'Front Wheel Drive',run_state:'Run & Drive',primary_damage:'Front',seller_type:'Insurance',document_type:'SALVAGE'}];
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  const columns=[...Object.keys(rows[0]),'location_state','auction_state','document_name'];
  sqlite.exec('CREATE TABLE auction_listings('+columns.map(name=>name+(name==='year'?' INTEGER':' TEXT')).join(',')+')');
  sqlite.prepare('INSERT INTO auction_listings VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(name=>rows[0][name]??null));
  const changes=sqlite.prepare('SELECT total_changes() n').get().n;
  let query;
  const repo=new D1ReadRepository({prepare(sql){query=sql;const statement=sqlite.prepare(sql);return {async all(){return {results:statement.all()}}}}});
  repo.getCoverage=async()=>({complete:false});
  const result=await repo.getFilterMetadata();
  for(const key of ['body_styles','fuel_types','transmissions','drive_types','run_conditions','damages','seller_types','sale_document_types']) assert.equal(result.values[key].length,1,key);
  assert.match(query,/drive_type/);
  assert.equal(result.read.known_rows_only,true);
  assert.equal(result.values.makes.some(item=>item.value==='POLESTAR'),false);
  assert.ok(result.values.vehicle_types.some(item=>item.value==='kind:car'));
  assert.equal(result.values.vehicle_types.some(item=>item.value==='kind:motorcycle'),false);
  assert.equal(sqlite.prepare('SELECT total_changes() n').get().n,changes);
});

test('Long Island IAAI selects partner Elizabeth, independently of another platform',()=>{
  const input=calc.terminalFrom({platform:'iaai',location:{display:'Long Island (NY)'}});
  const match=calc.matchingLocation(calc.rates,input);
  assert.equal(match.row.preferred_terminal_id,'elizabeth_nj');
  assert.equal(match.row.platform,'IAAI');
  assert.equal(match.row.rates.elizabeth_nj,295);
  const ambiguous={...calc.rates,locations:[match.row,{...match.row,row_id:'other'}]};
  assert.equal(calc.matchingLocation(ambiguous,input).status,'ambiguous');
});

test('contact requires identity but never posts guest messages to portal',()=>{
  const html=fs.readFileSync(require.resolve('../public/kontakt.html'),'utf8');
  assert.match(html,/name="name" required/);
  assert.match(html,/name="email" required/);
  assert.match(html,/nie tworzy rozmowy w panelu/);
});

test('fuel synonyms filter before pagination without mixing BEV and hybrid',async()=>{
  const queries=[];
  const repo=new D1ReadRepository({prepare(sql){const entry={sql,params:[]};queries.push(entry);const statement={bind(...params){entry.params=params;return statement;},async first(){return {total:0}},async all(){return {results:[]}}};return statement;}});
  repo.getCoverage=async()=>({complete:false});
  await repo.listCatalog({fuelType:'Gasoline'});
  assert.ok(queries.some(q=>q.params.includes('gas')&&q.params.includes('gasoline')&&q.params.includes('petrol')));
  queries.length=0;
  await repo.listCatalog({fuelType:'Electric'});
  const filter=queries.find(q=>/l\.fuel_type/.test(q.sql));
  assert.match(filter.sql,/'bev'/);
  assert.doesNotMatch(filter.sql,/'hybrid'/);
});

test('public DOM fills advanced filters and keeps selected year after metadata arrives',async()=>{
  const {JSDOM}=require('jsdom');
  const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
  const inline=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(match=>!/\bsrc=/.test(match[1]))[2];
  const dom=new JSDOM(html,{url:'https://rexbid.pl/?catalog=1',runScripts:'outside-only'});
  try {
    const win=dom.window;
    win.RexBidMarket=require('../public/rexbid-market');
    win.RexBidVehicleLabels=require('../public/rexbid-vehicle-labels');
    win.RexBidStorage={safeImageUrl:()=>'',isFavorite:()=>false,refreshCounts(){}};
    win.fetch=async()=>new Response(JSON.stringify({ok:true,data:{makes:[{value:'HONDA',label:'HONDA'}],fuel_types:['Gas','Gasoline','Diesel','Hybrid','Electric'],transmissions:['Automatic'],drive_types:['All Wheel Drive'],run_conditions:['Stationary'],body_styles:['SEDAN','Atv'],damages:['Left rear'],seller_types:['insurance','RCC'],years:[2022]}}));
    win.eval(inline.slice(0,inline.lastIndexOf('  restoreFiltersFromUrl();'))+'\nwindow.reviewMetadata=async()=>{advancedFiltersElement.open=true;await Promise.all([loadFilterMetadata(),loadAdvancedFilterMetadata()]);};');
    win.document.getElementById('yearFrom').value='2020';
    await win.reviewMetadata();
    for(const id of ['fuelType','transmission','driveType','runCond','vehicleType','damage','sellerType'])assert.ok(win.document.getElementById(id).options.length>1,id);
    const fuel=[...win.document.getElementById('fuelType').options].map(x=>x.textContent);
    assert.ok(fuel.includes('Benzyna (Gas)')&&fuel.includes('Benzyna (Gasoline)'));
    assert.deepEqual([...win.document.getElementById('fuelType').options].filter(x=>x.value).map(x=>x.value),['Gas','Gasoline','Diesel','Hybrid','Electric']);
    assert.ok(fuel.includes('Diesel')&&fuel.includes('Hybryda'));
    assert.equal(win.document.getElementById('yearFrom').value,'2020');
    assert.match(win.document.querySelector('#makeOptions option[value="POLESTAR"]').label,/Brak ofert/);
  } finally {dom.window.close();}
});
