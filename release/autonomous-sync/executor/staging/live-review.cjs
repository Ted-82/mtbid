"use strict";
// Temporary operator-only runner. Never imported by the production Worker.
const {createApibaraProvider}=require('../providers/apibara.js');
const {createProviderRequestBudget}=require('../providers/request-budget.js');
const {runPlatformBackfill}=require('./phase-g-multiplatform-backfill.cjs');
const {categories}=require('../public/rexbid-market.js');
const CAMPAIGN=Object.freeze({id:'v4-live-20261005',platformLimit:60,totalLimit:120});
const HOST='rexbid-auth-test.tedn828.workers.dev';
async function authorized(request,env){
  if(new URL(request.url).hostname!==HOST||env.REXBID_D1_READ_TARGET!=='rexbid-auth-test-db'
    ||env.REXBID_LIVE_REVIEW!=='enabled'||request.method!=='POST'||!env.REXBID_LIVE_REVIEW_TOKEN)return false;
  const actual=request.headers.get('Authorization')||'';
  const expected=`Bearer ${env.REXBID_LIVE_REVIEW_TOKEN}`;
  const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b]=await Promise.all([hash(actual),hash(expected)]);let diff=0;
  for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});}
async function handle(request,env){
  if(new URL(request.url).pathname!=='/__staging/live-review')return null;
  if(!await authorized(request,env))return json({ok:false,error:'not_found'},404);
  let input;try{input=await request.json();}catch{return json({ok:false,error:'invalid_input'},400);}
  const {platform,category='current',identifier=null,pages=1}=input;
  if(!['copart','iaai'].includes(platform)||!categories.some(c=>c.id===category)
    ||!Number.isInteger(pages)||pages<1||pages>4||identifier&&!/^[A-Za-z0-9_-]{1,80}$/.test(identifier))return json({ok:false,error:'invalid_input'},400);
  if(identifier&&pages!==1)return json({ok:false,error:'detail_single_request_only'},400);
  const api=createApibaraProvider({requestBudget:createProviderRequestBudget()});
  const selection=categories.find(c=>c.id===category);
  let sample=[];
  const provider={...api,async listVehicles(innerEnv,params){
    let response;
    if(identifier){
      const detail=await api.request(innerEnv,{operation:'vehicleByIdentifier',identifier,budgetClass:'media_enrichment'});
      const raw=api.vehicleDetailRecord(detail);
      if(!raw||String(raw.platform).toLowerCase()!==platform)throw Object.assign(new Error(),{safeCode:'detail_platform_mismatch'});
      response={response:{data:[raw],meta:{next_cursor:null}}};
    }else response=await api.listVehicles(innerEnv,{...params,...selection.query});
    // Public identifiers and media counts only; no raw payload retained.
    sample=api.vehicleListRecords(response).map(raw=>{const n=api.normalizeVehicle(raw),c=api.toCanonicalVehicle(raw,n);return {
      id:c.provider_vehicle_id,lot:c.lot,platform:c.platform,title:c.title,state:c.auction.state,source_status:c.auction.source_status,
      auction_at:c.auction.auction_at,media:c.media.items.length,thumbs:c.media.thumbs.length,fuel:c.fuel_type};});
    return response;
  }};
  const requestId=crypto.randomUUID();
  const scopeKey=`${CAMPAIGN.id}:${platform}:${identifier?'detail-v2-'+identifier:category+'-normalized-v2'}`;
  const result=await runPlatformBackfill({db:env.REXBID_DB,env,requestId,platform,maxPages:pages,scopeKeyOverride:scopeKey,campaign:CAMPAIGN,provider});
  return json({...result,sample});
}
module.exports={handle,authorized,CAMPAIGN};
