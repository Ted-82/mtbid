'use strict';

const {MAX_BYTES}=require('./crypto.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TYPES={'application/pdf':['pdf'],'image/jpeg':['jpg','jpeg'],'image/png':['png']};
function invalid(code='invalid_file',status=400) { const error=new Error(code); error.code=code; error.status=status; return error; }
function filenameFrom(header,type) {
  let name;
  try { name=decodeURIComponent(header || ''); } catch { throw invalid(); }
  name=name.normalize('NFC').trim();
  if (!name || name.length > 160 || /[\u0000-\u001f\u007f/\\]/.test(name) || name.startsWith('.') || /[\u202a-\u202e\u2066-\u2069]/.test(name)) throw invalid();
  const extension=name.split('.').pop().toLowerCase();
  if (!TYPES[type]?.includes(extension)) throw invalid('unsupported_file',415);
  return name;
}
function validMagic(bytes,type) {
  if (type==='application/pdf') return bytes.length >= 8 && new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-';
  if (type==='image/jpeg') return bytes.length >= 4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  if (type==='image/png') return bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
  return false;
}
async function boundedBody(request) {
  const length=request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length)>MAX_BYTES)) throw invalid('file_too_large',413);
  if (!request.body) throw invalid();
  const reader=request.body.getReader(), chunks=[]; let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if (done) break;
      size+=value.byteLength;
      if (size>MAX_BYTES) { await reader.cancel(); throw invalid('file_too_large',413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw invalid();
  const bytes=new Uint8Array(size); let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  return bytes;
}
function fileAad(orderId,fileId) {
  if (!UUID.test(orderId || '') || !UUID.test(fileId || '')) throw invalid();
  return `portal:file:${orderId}:${fileId}`;
}
function createPrivateAttachmentService({protection,cryptoImpl=globalThis.crypto}={}) {
  function configured(env) {
    return env?.REXBID_PORTAL_FILES_ENABLED==='enabled' && protection?.configured(env)===true
      && ['put','get','delete'].every(method=>typeof env?.REXBID_PRIVATE_FILES?.[method]==='function');
  }
  function requireConfigured(env) { if (!configured(env)) throw new Error('unavailable'); }
  async function upload({request,env,order,fileId}) {
    requireConfigured(env);
    const aad=fileAad(order.id,fileId), type=(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!TYPES[type]) throw invalid('unsupported_file',415);
    const filename=filenameFrom(request.headers.get('X-File-Name'),type), visibility=request.headers.get('X-Visibility') || 'client';
    if (!['client','internal'].includes(visibility)) throw invalid();
    const bytes=await boundedBody(request);
    if (!validMagic(bytes,type)) throw invalid('unsupported_file',415);
    const sha256=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
    const object_key=`portal/${cryptoImpl.randomUUID()}`;
    const cipher=await protection.encryptBytes(bytes,aad,env);
    await env.REXBID_PRIVATE_FILES.put(object_key,cipher,{httpMetadata:{contentType:'application/octet-stream'}});
    return {object_key,filename,content_type:type,size_bytes:bytes.byteLength,sha256,visibility};
  }
  async function download({env,order,file}) {
    requireConfigured(env);
    const aad=fileAad(order.id,file.id);
    if (file.order_id!==order.id || !file.object_key?.startsWith('portal/') || !UUID.test(file.object_key.slice(7)) || !TYPES[file.content_type]
      || !Number.isSafeInteger(file.size_bytes) || file.size_bytes<1 || file.size_bytes>MAX_BYTES) throw new Error('unavailable');
    const object=await env.REXBID_PRIVATE_FILES.get(file.object_key);
    if (!object || typeof object.arrayBuffer !== 'function' || !Number.isSafeInteger(object.size) || object.size>MAX_BYTES+80) throw new Error('unavailable');
    const bytes=await protection.decryptBytes(new Uint8Array(await object.arrayBuffer()),aad,env);
    if (bytes.byteLength!==file.size_bytes || !validMagic(bytes,file.content_type)) throw new Error('unavailable');
    const hash=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
    if (hash!==file.sha256) throw new Error('unavailable');
    const filename=filenameFrom(encodeURIComponent(file.filename),file.content_type);
    const encoded=encodeURIComponent(filename).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(bytes,{headers:{
      'Content-Type':file.content_type,'Content-Length':String(bytes.byteLength),
      'Content-Disposition':`attachment; filename="document.${TYPES[file.content_type][0]}"; filename*=UTF-8''${encoded}`,
      'Cache-Control':'private, no-store',Pragma:'no-cache',Vary:'Cookie','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'none'"
    }});
  }
  async function remove({env,objectKey}) {
    requireConfigured(env);
    if (typeof objectKey !== 'string' || !objectKey.startsWith('portal/') || !UUID.test(objectKey.slice(7))) throw new Error('unavailable');
    await env.REXBID_PRIVATE_FILES.delete(objectKey);
  }
  return {configured,upload,download,remove};
}

module.exports={createPrivateAttachmentService,MAX_UPLOAD_BYTES:MAX_BYTES};
