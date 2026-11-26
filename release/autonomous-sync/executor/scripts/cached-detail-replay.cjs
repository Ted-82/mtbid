'use strict';
// Explicit recovery of one authenticated cached response. Never supplies a
// network transport and never opens/resumes the original campaign journal.
const {runDetailTarget,digest}=require('./catalog-improvement-campaign-20261020.cjs');
const {checkDetail,detailSpec}=require('./catalog-refresh-campaign.cjs');
function validateCachedDetail({target,bytes,attempt,response}) {
  if(!Buffer.isBuffer(bytes)||!target||attempt?.operation!=='vehicleByIdentifier'
    ||response?.ok!==true||response.number!==attempt.number||digest(bytes)!==response.sha256)throw Error('CACHED_REPLAY_EVIDENCE_INVALID');
  let receipt;try{receipt=JSON.parse(bytes);}catch{throw Error('CACHED_REPLAY_RECEIPT_INVALID');}
  if(receipt.number!==attempt.number||receipt.key!==attempt.key||receipt.specHash!==attempt.specHash
    ||receipt.key!=='detail:'+digest(target)||receipt.specHash!==digest(detailSpec(target))
    ||receipt.observedAt!==response.at||!Number.isFinite(Date.parse(receipt.observedAt))
    ||receipt.response?.ok!==true)throw Error('CACHED_REPLAY_RECEIPT_INVALID');
  checkDetail(receipt.response.data,target);
  return receipt;
}
async function replayCachedDetail({db,provider,target,knownRows,bytes,attempt,response,beforeWrite,now=Date.now}) {
 const receipt=validateCachedDetail({target,bytes,attempt,response});let executions=0;
 const journal={config:{targetId:db.identity.id},rows:[],now,
  async execute(key,spec,transport,consume){
   if(++executions!==1||key!==receipt.key||digest(spec)!==receipt.specHash)throw Error('CACHED_REPLAY_SCOPE_INVALID');
   return consume(receipt);
  },append(){throw Error('CACHED_REPLAY_UNEXPECTED_FAILURE');},halt(){}};
 const result=await runDetailTarget({db,provider,journal,target,knownRows,
  transport:async()=>{throw Error('CACHED_REPLAY_NETWORK_FORBIDDEN');},beforeWrite});
 if(executions!==1||result.status!=='committed'||result.observedAt!==receipt.observedAt)throw Error('CACHED_REPLAY_INCOMPLETE');
 return {...result,cachedResponse:receipt.number,providerRequests:0};
}
module.exports={validateCachedDetail,replayCachedDetail};
