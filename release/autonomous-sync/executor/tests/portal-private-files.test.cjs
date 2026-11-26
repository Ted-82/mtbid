const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {createPortalCrypto}=require('../portal/crypto.cjs');
const {createPrivateAttachmentService,MAX_UPLOAD_BYTES}=require('../portal/attachments.cjs');
const ORDER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FILE='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORIGIN='https://rexbid.pl';
const PDF=new TextEncoder().encode('%PDF-1.7\nprivate-customer-document-marker\n%%EOF');
function fixture() {
  const protection=createPortalCrypto({cryptoImpl:webcrypto}), objects=new Map(), calls=[];
  const env={REXBID_PORTAL_DATA_KEYS:JSON.stringify({k1:Buffer.alloc(32,71).toString('base64url')}),REXBID_PORTAL_ACTIVE_KEY_ID:'k1',REXBID_PORTAL_FILES_ENABLED:'enabled',REXBID_PRIVATE_FILES:{
    async put(key,bytes,options) { calls.push(['put',key,options]); objects.set(key,Uint8Array.from(bytes)); },
    async get(key) { calls.push(['get',key]); const bytes=objects.get(key); return bytes ? {size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)} : null; },
    async delete(key) { calls.push(['delete',key]); objects.delete(key); }
  }};
  return {protection,env,objects,calls,service:createPrivateAttachmentService({protection,cryptoImpl:webcrypto})};
}
function uploadRequest(bytes=PDF,headers={}) { return new Request(`${ORIGIN}/api/portal/orders/${ORDER}/files`,{method:'POST',headers:{'Content-Type':'application/pdf','X-File-Name':encodeURIComponent('Dokument pojazdu.pdf'),'X-Visibility':'client',...headers},body:bytes}); }
async function upload(f,request=uploadRequest()) { return f.service.upload({request,env:f.env,order:{id:ORDER},fileId:FILE,user:{id:'owner'}}); }
test('AES-GCM messages bind ciphertext to exact order, message, version and key ID',async()=>{
  const f=fixture(), aad=`portal:message:${ORDER}:${FILE}`;
  const first=await f.protection.protect('private-contact-marker',aad,f.env), second=await f.protection.protect('private-contact-marker',aad,f.env);
  assert.notEqual(first,second); assert.ok(!first.includes('private-contact-marker'));
  assert.equal(await f.protection.unprotect(first,aad,f.env),'private-contact-marker');
  await assert.rejects(f.protection.unprotect(first,`portal:message:${ORDER}:${OTHER}`,f.env),/encryption_unavailable/);
  await assert.rejects(f.protection.unprotect(first,'portal:profile:other-client',f.env),/encryption_unavailable/);
  const bytes=Buffer.from(first.split('.')[1],'base64url'); bytes[bytes.length-1]^=1;
  await assert.rejects(f.protection.unprotect(`rxb1.${bytes.toString('base64url')}`,aad,f.env),/encryption_unavailable/);
});
test('key rotation decrypts retained keys and fails closed if old key is lost or keyring invalid',async()=>{
  const f=fixture(), aad='portal:profile:client-a', cipher=await f.protection.protect('encrypted profile',aad,f.env);
  const rotated={...f.env,REXBID_PORTAL_ACTIVE_KEY_ID:'k2',REXBID_PORTAL_DATA_KEYS:JSON.stringify({...JSON.parse(f.env.REXBID_PORTAL_DATA_KEYS),k2:Buffer.alloc(32,83).toString('base64url')})};
  assert.equal(await f.protection.unprotect(cipher,aad,rotated),'encrypted profile');
  rotated.REXBID_PORTAL_DATA_KEYS=JSON.stringify({k2:Buffer.alloc(32,83).toString('base64url')});
  await assert.rejects(f.protection.unprotect(cipher,aad,rotated),/encryption_unavailable/);
  for (const env of [{},{...f.env,REXBID_PORTAL_DATA_KEYS:'{}'},{...f.env,REXBID_PORTAL_DATA_KEYS:'["bad"]'},{...f.env,REXBID_PORTAL_ACTIVE_KEY_ID:'unsafe.id'},{...f.env,REXBID_PORTAL_DATA_KEYS:JSON.stringify({k1:'short'})}]) assert.equal(f.protection.configured(env),false);
});
test('private upload stores opaque encrypted binary without filename or plaintext R2 metadata',async()=>{
  const f=fixture(), file=await upload(f);
  assert.equal(file.size_bytes,PDF.byteLength); assert.equal(file.visibility,'client'); assert.equal(file.sha256.length,64);
  assert.match(file.object_key,/^portal\/[a-f0-9-]{36}$/);
  const stored=f.objects.get(file.object_key);
  assert.equal(Buffer.from(stored).includes(Buffer.from('private-customer-document-marker')),false);
  assert.deepEqual(f.calls[0][2],{httpMetadata:{contentType:'application/octet-stream'}});
  assert.doesNotMatch(JSON.stringify(f.calls),/Dokument|private-customer/);
});
test('authorized download decrypts correct object, verifies hash, and sends private attachment headers',async()=>{
  const f=fixture(), file={...await upload(f),id:FILE,order_id:ORDER};
  const response=await f.service.download({env:f.env,order:{id:ORDER},file});
  assert.equal(response.status,200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()),PDF);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store'); assert.equal(response.headers.get('Vary'),'Cookie');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff'); assert.match(response.headers.get('Content-Disposition'),/^attachment;/);
  assert.match(response.headers.get('Content-Security-Policy'),/sandbox/);
  await assert.rejects(f.service.download({env:f.env,order:{id:OTHER},file}),/unavailable|invalid_file/);
  await assert.rejects(f.service.download({env:f.env,order:{id:ORDER},file:{...file,id:OTHER}}),/encryption_unavailable/);
  await assert.rejects(f.service.download({env:f.env,order:{id:ORDER},file:{...file,sha256:'0'.repeat(64)}}),/unavailable/);
});
test('file type, magic, extension, unsafe names and visibility are rejected before R2 writes',async()=>{
  for (const [bytes,headers,status] of [
    [PDF,{'Content-Type':'image/svg+xml','X-File-Name':'vehicle.svg'},415],
    [new TextEncoder().encode('<html>injected</html>'),{},415],
    [PDF,{'X-File-Name':'report.jpg'},415],
    [PDF,{'X-File-Name':encodeURIComponent('../report.pdf')},400],
    [PDF,{'X-File-Name':encodeURIComponent('bad\r\nheader.pdf')},400],
    [PDF,{'X-File-Name':'%ZZ'},400],
    [PDF,{'X-Visibility':'public'},400]
  ]) {
    const f=fixture(); await assert.rejects(upload(f,uploadRequest(bytes,headers)),error=>error.status===status); assert.equal(f.calls.length,0);
  }
});
test('8 MiB bound applies to actual streamed bytes even if Content-Length lies',async()=>{
  const f=fixture();
  await assert.rejects(upload(f,uploadRequest(PDF,{'Content-Length':String(MAX_UPLOAD_BYTES+1)})),error=>error.code==='file_too_large'&&error.status===413);
  let sent=0;
  const stream=new ReadableStream({pull(controller){ if(sent++ < 9) controller.enqueue(new Uint8Array(1024*1024)); else controller.close(); }});
  const request=new Request(`${ORIGIN}/upload`,{method:'POST',duplex:'half',body:stream,headers:{'Content-Type':'application/pdf','X-File-Name':'report.pdf','Content-Length':'12'}});
  await assert.rejects(upload(f,request),error=>error.code==='file_too_large'&&error.status===413); assert.equal(f.calls.length,0);
});
test('private object tampering, missing storage and disabled files fail without plaintext response',async()=>{
  const f=fixture(), file={...await upload(f),id:FILE,order_id:ORDER};
  const stored=f.objects.get(file.object_key); stored[stored.length-1]^=1;
  await assert.rejects(f.service.download({env:f.env,order:{id:ORDER},file}),/encryption_unavailable/);
  for(const env of [{...f.env,REXBID_PORTAL_FILES_ENABLED:'disabled'},{...f.env,REXBID_PRIVATE_FILES:null},{...f.env,REXBID_PORTAL_DATA_KEYS:''}]) {
    assert.equal(f.service.configured(env),false);
    await assert.rejects(f.service.upload({request:uploadRequest(),env,order:{id:ORDER},fileId:FILE}),/unavailable/);
  }
});

test('exactly 8 MiB is accepted and zero bytes are rejected without a stored object',async()=>{
  const f=fixture(), bytes=new Uint8Array(MAX_UPLOAD_BYTES); bytes.set(PDF);
  const file={...await upload(f,uploadRequest(bytes)),id:FILE,order_id:ORDER};
  assert.equal(file.size_bytes,MAX_UPLOAD_BYTES);
  const result=await f.service.download({env:f.env,order:{id:ORDER},file});
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()),bytes);
  const before=f.calls.length;
  await assert.rejects(upload(f,uploadRequest(new Uint8Array())),error=>error.code==='invalid_file');
  assert.equal(f.calls.length,before);
});
