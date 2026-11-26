const test=require('node:test'),assert=require('node:assert/strict');
const {validateCachedDetail}=require('../scripts/cached-detail-replay.cjs');
const {digest}=require('../scripts/catalog-improvement-campaign-20261020.cjs');
const {detailSpec}=require('../scripts/catalog-refresh-campaign.cjs');
function evidence(){const target={platform:'copart',lot:'12345678',listing_id:'test',vin_normalized:'1FMSK8DH8LGA92502'};
 const at='2026-10-20T19:53:28.992Z',attempt={number:2,operation:'vehicleByIdentifier',key:'detail:'+digest(target),specHash:digest(detailSpec(target))};
 const receipt={...attempt,observedAt:at,response:{ok:true,data:{platform:target.platform,lot_number:target.lot,vin:target.vin_normalized}}};
 const bytes=Buffer.from(JSON.stringify(receipt)),response={number:2,ok:true,at,sha256:digest(bytes)};return{target,attempt,response,bytes};}
test('cached detail keeps the original observed timestamp and exact evidence binding',()=>{const e=evidence();assert.equal(validateCachedDetail(e).observedAt,e.response.at);});
test('cached detail rejects altered bytes, identity, target and response time',()=>{
 let e=evidence();assert.throws(()=>validateCachedDetail({...e,bytes:Buffer.from(e.bytes+' ')}),/EVIDENCE/);
 e=evidence();e.response.at='2026-10-25T10:00:00Z';assert.throws(()=>validateCachedDetail(e),/RECEIPT/);
 e=evidence();e.target.lot='999';assert.throws(()=>validateCachedDetail(e),/RECEIPT/);
 e=evidence();const r=JSON.parse(e.bytes);r.response.data.vin='1FMSK8DH8LGA92503';e.bytes=Buffer.from(JSON.stringify(r));e.response.sha256=digest(e.bytes);assert.throws(()=>validateCachedDetail(e),/IDENTITY/);
});
