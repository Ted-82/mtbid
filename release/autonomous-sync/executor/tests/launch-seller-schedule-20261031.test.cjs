'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {createApibaraProvider}=require('../providers/apibara.js');
const contract=require('../providers/contract.js');
const {createSyncIdentity}=require('../sync/core.js');
const {knownObservationStatements}=require('../sync/d1-repository.js');
const {canonicalVehicle,toPublicVehicleDTO}=require('../sync/d1-read-repository.js');
const html=fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');
const inline=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!/\bsrc=/.test(m[1])).map(m=>m[2]).join('\n');
const provider=createApibaraProvider({fetch:async()=>{throw Error('NETWORK_FORBIDDEN');}});
function page(){
 const elements=new Map();const node=id=>{if(!elements.has(id))elements.set(id,{id,style:{},dataset:{},hidden:false,innerHTML:'',textContent:'',classList:{add(){},remove(){},contains(){return false;}},addEventListener(){},removeAttribute(){},setAttribute(){},querySelectorAll(){return[];}});return elements.get(id);};
 const context={window:{},document:{body:{classList:{add(){},remove(){}}},visibilityState:'visible',getElementById:node,addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];}},location:{search:'',href:'https://rexbid.pl/car.html'},navigator:{},URL,URLSearchParams,console:{warn(){},error(){}},setTimeout(){},setInterval(){},clearInterval(){},RexBidMarket:require('../public/rexbid-market.js')};
 vm.createContext(context);vm.runInContext(inline+`\nglobalThis.api={render(v){car=v;photos=[];buildPage();},refresh(v){car=v;updateAuctionUi();},format:formatAuctionDate,end:getAuctionEnd,seller(){return sellerProfile(sellerName());},sellerHtml(){return sellerDisplay(sellerProfile(sellerName()));},schedule:renderPrimaryAuctionScheduleHtml,tick:startCountdown};`,context);
 return{api:context.api,node,html:()=>node('page').innerHTML};
}
function raw(extra={}){return{vehicle_id:'source-123',platform:'iaai',vin:'1HGCM82633A004352',lot_number:'12345678',title:'2022 Honda Accord',make:'Honda',model:'Accord',year:2022,auction:{state:'open',auction_at:'2099-11-03T17:00:00Z'},pricing:{current_bid_usd:200},...extra};}
async function persist(t,source){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0004_d1_sync_2.sql'),'utf8'));
 const db={prepare(sql){return{bind(...params){return{sql,params};}};}};
 const vehicle=provider.toCanonicalVehicle(source,provider.normalizeVehicle(source)),identity=createSyncIdentity(vehicle,{observationKey:'launch-fixture'});
 const {statements}=await knownObservationStatements(db,{vehicle,identity,observedAt:'2026-10-31T12:00:00Z'});
 for(const statement of statements)sqlite.prepare(statement.sql).run(...statement.params);
 const row=sqlite.prepare('SELECT * FROM auction_listings').get();return{row,dto:toPublicVehicleDTO(canonicalVehicle(row))};
}

test('real feed 5331 IAAI seller shapes retain source classification from mapping through D1 and vehicle UI',async t=>{
 // Minimal public seller fields observed in chg_45578424, IAAI LOT 46452804.
 const mapfre=await persist(t,raw({seller:{name:'Mapfre Usa',type:'unknown'},details:{attributes:{ProviderName:'MAPFRE USA',ProviderType:'INS'},sale_information:{Seller:'MAPFRE USA',SellerType:'Insurance'}}}));
 assert.equal(mapfre.row.seller_name,'MAPFRE USA');assert.equal(mapfre.row.seller_type,'insurance');
 const view=page();view.api.render(mapfre.dto);assert.match(view.api.sellerHtml(),/rex-seller-insurance/);assert.match(view.api.sellerHtml(),/MAPFRE USA/);
 // The same feed has RCC + top seller.type=insurance for Nationwide Remarketing.
 const remarketing=await persist(t,raw({seller:{name:'Nationwide Remarketing - Mg - Ach',type:'insurance'},details:{attributes:{ProviderType:'RCC'}}}));
 assert.equal(remarketing.row.seller_type,'insurance');view.api.render(remarketing.dto);assert.equal(view.api.seller().type,'Insurance');
 // Snapshot 4548 LOT 45150235 supplies unknown + ADJ + explicit SellerType Insurance.
 const adj=await persist(t,raw({seller:{name:'unknown',type:'unknown'},details:{attributes:{ProviderType:'ADJ'},sale_information:{SellerType:'Insurance'}}}));
 assert.equal(adj.row.seller_type,'insurance');view.api.render(adj.dto);assert.equal(view.api.seller().type,'Insurance');
 // Copart LOT 70377026 carries this explicit classification in the source itself.
 const copart=await persist(t,raw({platform:'copart',seller:{name:'Non-insurance Company',type:'non_insurance'}}));
 assert.equal(copart.row.seller_type,'non_insurance');view.api.render(copart.dto);assert.equal(view.api.seller().name,'');assert.equal(view.api.seller().type,'Non-insurance');
});

test('missing, masked, opaque and conflicting seller values never become non-insurance or a named company',async t=>{
 for(const seller of [undefined,{name:'******',type:'unknown'},{name:'No insurance',type:null},{name:'No insurance',type:'No insurance'},{name:'Insurance Company',type:null}]){
  const source=raw({seller}),stored=await persist(t,source),view=page();view.api.render(stored.dto);
  assert.notEqual(stored.row.seller_type,'non_insurance');assert.equal(view.api.seller().name,'');assert.doesNotMatch(view.api.sellerHtml(),/Podmiot nieubezpieczeniowy|rex-seller-insurance|No insurance/);
 }
 const conflicting=raw({seller:{name:'Known seller',type:'insurance'},details:{attributes:{ProviderType:'non_insurance'}}});
 assert.equal(provider.toCanonicalVehicle(conflicting,provider.normalizeVehicle(conflicting)).seller.type,null);
 const view=page();view.api.render(conflicting);assert.equal(view.api.seller().type,'');assert.doesNotMatch(view.api.sellerHtml(),/rex-seller-insurance|Podmiot nieubezpieczeniowy/);
 const opaque=await persist(t,raw({seller:{name:'Known seller',type:'RCC'}}));view.api.render(opaque.dto);assert.match(view.api.sellerHtml(),/Typ sprzedawcy nieustalony/);
 const explicit=await persist(t,raw({seller:{name:'Known seller',type:'NINS'}}));view.api.render(explicit.dto);assert.equal(explicit.row.seller_type,'non_insurance');assert.match(view.api.sellerHtml(),/Podmiot nieubezpieczeniowy/);
});

test('auction formatter states Poland CET/CEST and numeric offsets across DST and date rollover',()=>{
 const view=page();assert.match(view.api.format('2026-01-10T17:00:00Z'),/10\.01\.2026, 18:00 · Polska: CET \(UTC\+01:00\)/);
 assert.match(view.api.format('2026-07-10T17:00:00Z'),/10\.07\.2026, 19:00 · Polska: CEST \(UTC\+02:00\)/);
 assert.match(view.api.format('2026-10-25T00:30:00Z'),/02:30 · Polska: CEST \(UTC\+02:00\)/);
 assert.match(view.api.format('2026-10-25T01:30:00Z'),/02:30 · Polska: CET \(UTC\+01:00\)/);
 assert.match(view.api.format('2026-12-31T23:30:00Z'),/01\.01\.2027, 00:30/);
 assert.equal(view.api.format('2026-11-03 17:00:00'),'Termin niepotwierdzony');assert.equal(view.api.format('2026-02-30T12:00:00Z'),'Termin niepotwierdzony');
 assert.equal(view.api.format('2026-11-03'),'03.11.2026');assert.equal(view.api.format('2026-02-30'),'Termin niepotwierdzony');
});

test('primary vehicle schedule keeps exact time visible beside countdown and refreshes future, unknown, ended and stale states',()=>{
 const view=page(),future=raw({auction:{state:'open',schedule_status:'scheduled',auction_at:'2099-11-03T17:00:00Z'}});view.api.render(future);
 assert.match(view.html(),/id="primaryAuctionSchedule"[^>]*><small>Termin licytacji<\/small><strong>03\.11\.2099, 18:00 · Polska: CET \(UTC\+01:00\)/);
 view.api.tick();assert.match(view.api.schedule(),/03\.11\.2099, 18:00/);
 view.api.refresh(raw({auction:{state:'open',schedule_status:'date_only',auction_at:'2099-11-03'}}));assert.match(view.node('primaryAuctionSchedule').innerHTML,/03\.11\.2099/);assert.match(view.node('primaryAuctionSchedule').innerHTML,/Godzina niepotwierdzona/);assert.doesNotMatch(view.node('primaryAuctionSchedule').innerHTML,/00:00|UTC/);
 view.api.refresh(raw({auction:{state:'open',schedule_status:'unknown',auction_at:'2099-11-03 17:00:00'}}));assert.match(view.node('primaryAuctionSchedule').innerHTML,/Termin nieustalony/);
 view.api.refresh(raw({auction:{state:'finished',auction_at:'2099-11-03T17:00:00Z'}}));assert.match(view.node('primaryAuctionSchedule').innerHTML,/Aukcja zakończona/);assert.doesNotMatch(view.node('primaryAuctionSchedule').innerHTML,/2099/);
 view.api.refresh(raw({auction:{state:'finished',is_timed:true,timed_end_at:'2099-11-03T17:00:00Z'}}));assert.equal(view.node('vehicleAuctionDate').hidden,true);assert.doesNotMatch(view.api.schedule(),/2099/);
 view.api.refresh({...future,read:{source:'d1',freshness:'stale'}});assert.match(view.node('primaryAuctionSchedule').innerHTML,/Bieżący termin do potwierdzenia/);assert.doesNotMatch(view.node('primaryAuctionSchedule').innerHTML,/2099/);
 view.api.refresh(raw({auction:{state:'open',schedule_status:'scheduled',auction_at:'2020-11-03T17:00:00Z'}}));assert.match(view.node('primaryAuctionSchedule').innerHTML,/Termin minął · wynik do potwierdzenia/);
});

test('timed auction does not assign a timezone or countdown to offsetless source end time',()=>{
 const view=page();view.api.render(raw({auction:{state:'open',is_timed:true,schedule_status:'timed',timed_end_at:'2099-11-03 17:00:00'}}));assert.equal(view.api.end(),null);assert.match(view.api.schedule(),/Termin nieustalony/);assert.doesNotMatch(view.api.schedule(),/2099/);
 view.api.refresh(raw({auction:{state:'open',is_timed:true,schedule_status:'timed',timed_end_at:'2099-11-03T17:00:00+00:00'}}));assert.match(view.api.schedule(),/Koniec aukcji czasowej/);assert.match(view.api.schedule(),/18:00 · Polska: CET \(UTC\+01:00\)/);
});
