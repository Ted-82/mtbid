'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');
const media=require('../public/rexbid-media.js');
const collectObjects=source.match(/  function collectObjects\([^]*?\r?\n  }/)?.[0];
assert.ok(collectObjects, 'Use the real vehicle object traversal');
function block(start,end){return source.slice(source.indexOf('  function '+start+'('),source.indexOf('  function '+end+'('));}
function link(car){
 const context={car,URL,window:{RexBidMedia:media},console,platformName:()=>car.platform,getLot:()=>car.lot_number};
 vm.createContext(context);
 vm.runInContext(collectObjects+'\n'+block('isHttpMediaUrl','findMediaUrl')+block('auctionLotId','valueFrom')+';globalThis.result=originalAuctionUrl();',context);
 return context.result;
}
const image=id=>`https://vis.iaai.com/resizer?imageKeys=${id}~SID~I1&width=845&height=633`;
const owner={platform:'iaai',lot_number:'45787870',vin:'SALZP2FX8PH185647',vehicle_id:'2023-land-rover-range-rover-evoque-se-SALZP2FX8PH185647',media:{items:[image('46286694')],thumbs:[image('46286694')]}};
test('owner IAAI LOT45787870 resolves official image SID46286694, never title/VIN digits',()=>{
 assert.equal(link(owner),'https://www.iaai.com/VehicleDetail/46286694~US');
});
test('generic provider identifiers, LOT and VIN cannot fabricate an IAAI VehicleDetail ID',()=>{
 for(const vehicle_id of [owner.vehicle_id,'46286694','iaai-46286694',owner.vin])
  assert.equal(link({...owner,vehicle_id,media:{},source_id:'46286694'}),null);
});
test('strict explicit salvage and item identifiers remain supported, including nested provider details',()=>{
 for(const [key,value] of [['salvageId',46286694],['salvage_id','46286694~US'],['ItemId','46286694'],['item_id','46286694']])
  assert.equal(link({...owner,media:{},details:{[key]:value}}),'https://www.iaai.com/VehicleDetail/46286694~US');
 for(const bad of ['title-46286694',-46286694,46286.694,'46286694~US~bad','<46286694>',{},'0',''])
  assert.equal(link({...owner,media:{},salvageId:bad}),null);
});
test('conflicting source identifiers produce no speculative outbound link',()=>{
 assert.equal(link({...owner,salvageId:'46286694',itemId:'46286695'}),null);
 assert.equal(link({...owner,media:{items:[image('46286694'),image('46286695')]}}),null);
});
test('only the explicit SID format on the official image host is accepted',()=>{
 for(const bad of [image('46286694').replace('vis.iaai.com','vis.iaai.com.evil.test'),image('46286694').replace('https:','http:'),image('46286694').replace('/resizer','/anything'),image('46286694').replace('~SID~','~STOCK~'),image('46286694').replace('imageKeys=','other='),image('46286694').replace('vis.iaai.com','user@vis.iaai.com'),image('46286694').replace('vis.iaai.com','vis.iaai.com:8443')])
  assert.equal(link({...owner,media:{items:[bad]}}),null,bad);
 assert.equal(link({...owner,media:{items:[image('46286694').replaceAll('~','%7E')]}}),'https://www.iaai.com/VehicleDetail/46286694~US');
});
test('concrete official IAAI URL has priority; lookalike hosts and malformed URLs are rejected',()=>{
 const direct='https://www.iaai.com/VehicleDetail/46286694~US';
 assert.equal(link({...owner,media:{},source_url:direct}),direct);
 assert.equal(link({...owner,media:{},source_url:'https://www.iaai.com/fr-ca/VehicleDetail/46286694~CA'}),'https://www.iaai.com/fr-ca/VehicleDetail/46286694~CA');
 for(const bad of [direct.replace('iaai.com','iaai.com.evil.test'),direct.replace('https:','http:'),direct.replace('46286694','some-slug'),direct.replace('www.iaai.com','user@www.iaai.com'),'https://www.iaai.com/VehicleDetail/'])
  assert.equal(link({...owner,media:{},source_url:bad}),null,bad);
});
test('Copart links preserve exact LOT matching and safe fallback',()=>{
 const car={platform:'copart',lot_number:'71416916'};
 assert.equal(link(car),'https://www.copart.com/lot/71416916');
 const direct='https://www.copart.com/lot/71416916/vehicle';
 assert.equal(link({...car,source_url:direct}),direct);
 for(const bad of [direct.replace('copart.com','copart.com.evil.test'),direct.replace('71416916','714169160'),direct.replace('71416916','11111111')+'?ref=71416916'])
  assert.equal(link({...car,source_url:bad}),'https://www.copart.com/lot/71416916');
});
