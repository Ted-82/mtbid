'use strict';

const MAX_BYTES=8*1024*1024;
const MAX_EVENTS=10000;
const hex=/^[a-f0-9]{64}$/;

async function readRecoveredArchive({bucket,generation,after,pin,parseEvent,hash}){
  let permit;
  try{permit=JSON.parse(pin);}catch{throw Error('archive_recovery_required');}
  const {generationId,sha256,originalSha256,fromExclusive,through}=permit??{};
  if(!generation.retired_at||generationId!==generation.generation_id
    ||!hex.test(sha256)||originalSha256!==generation.sha256||!hex.test(originalSha256)
    ||!Number.isSafeInteger(fromExclusive)||fromExclusive<generation.first_sequence-1
    ||fromExclusive>=through||through!==generation.last_sequence
    ||!Number.isSafeInteger(after)||after<fromExclusive||after>through){
    throw Error('archive_recovery_invalid');
  }
  const key='v2/private/recovery/'+generationId+'-'+sha256+'.json';
  const object=await bucket.get(key);
  if(!object||!Number.isSafeInteger(object.size)||object.size<1||object.size>MAX_BYTES){
    throw Error('archive_recovery_unavailable');
  }
  const text=await object.text();
  if(new TextEncoder().encode(text).length!==object.size||await hash(text)!==sha256){
    throw Error('archive_recovery_checksum');
  }
  const payload=JSON.parse(text);
  if(payload.version!==1||payload.kind!=='apibara-terminal-replay'
    ||payload.generationId!==generationId||payload.originalSha256!==originalSha256
    ||payload.fromExclusive!==fromExclusive||payload.through!==through
    ||!Array.isArray(payload.events)||payload.events.length>MAX_EVENTS){
    throw Error('archive_recovery_invalid');
  }
  let previous=fromExclusive;
  const result=[];
  for(const row of payload.events){
    const event=parseEvent(row,generation);
    if(!event||event.sequence<=previous||event.sequence>through)throw Error('archive_recovery_invalid');
    previous=event.sequence;
    if(event.sequence>after)result.push(event);
  }
  return result;
}

module.exports={readRecoveredArchive};
