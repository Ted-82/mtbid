'use strict';
// Operator-only: stdin in memory, no values, ciphertexts, files, network or arguments.
const {webcrypto}=require('node:crypto');
const {createPortalCrypto}=require('../portal/crypto.cjs');
const {sealCookiePayload,openCookiePayload}=require('../auth/session.js');
function finish(ok){process.stdout.write(JSON.stringify({ok,cookie_crypto:ok?'PASS':'FAIL',full_portal_keyring_crypto:ok?'PASS':'FAIL',secret_values_printed:false})+'\n');process.exitCode=ok?0:1;}
async function verify(values){
  const ring=JSON.parse(values.REXBID_PORTAL_DATA_KEYS);
  const service=createPortalCrypto({cryptoImpl:webcrypto});
  if(!service.configured(values))throw new Error('VAULT_CRYPTO_FAILED');
  const sample='synthetic-vault-restoration-check';
  const bytes=new TextEncoder().encode(sample);
  for(const id of Object.keys(ring)){
    const env={...values,REXBID_PORTAL_ACTIVE_KEY_ID:id};
    const encrypted=await service.protect(sample,'portal:vault-check:text',env);
    if(await service.unprotect(encrypted,'portal:vault-check:text',values)!==sample)throw new Error('VAULT_CRYPTO_FAILED');
    const encryptedBytes=await service.encryptBytes(bytes,'portal:vault-check:file',env);
    const opened=await service.decryptBytes(encryptedBytes,'portal:vault-check:file',values);
    if(Buffer.compare(Buffer.from(opened),Buffer.from(bytes))!==0)throw new Error('VAULT_CRYPTO_FAILED');
    encryptedBytes.fill(0);opened.fill(0);
  }
  const payload={synthetic:true,purpose:'vault-restoration-check'};
  const cookie=await sealCookiePayload(payload,values.REXBID_AUTH_COOKIE_SECRET,webcrypto);
  if(JSON.stringify(await openCookiePayload(cookie,values.REXBID_AUTH_COOKIE_SECRET,webcrypto))!==JSON.stringify(payload))throw new Error('VAULT_CRYPTO_FAILED');
  bytes.fill(0);
}
if(require.main===module){
  let input='';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{input+=chunk;if(input.length>16384){input='';process.stdin.destroy();finish(false);}});
  process.stdin.on('error',()=>finish(false));
  process.stdin.on('end',async()=>{
    let values;
    try{values=JSON.parse(input);input='';await verify(values);finish(true);}
    catch{finish(false);}
    finally{input='';if(values)for(const name of Object.keys(values))values[name]=null;}
  });
}
module.exports={verify};
