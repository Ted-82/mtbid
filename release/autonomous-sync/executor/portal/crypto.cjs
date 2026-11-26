'use strict';

const VERSION = 'rxb1';
const MAGIC = new TextEncoder().encode('RXBID1');
const KEY_ID = /^[a-zA-Z0-9_-]{1,32}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});

function encode64(bytes) {
  let binary = '';
  for (let offset=0; offset<bytes.length; offset+=8192) binary += String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decode64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('encryption_unavailable');
  const binary = atob(value.replace(/-/g,'+').replace(/_/g,'/'));
  const result = Uint8Array.from(binary, char=>char.charCodeAt(0));
  if (encode64(result) !== value) throw new Error('encryption_unavailable');
  return result;
}
function settings(env) {
  if (typeof env?.REXBID_PORTAL_DATA_KEYS !== 'string' || env.REXBID_PORTAL_DATA_KEYS.length > 4096 || !KEY_ID.test(env?.REXBID_PORTAL_ACTIVE_KEY_ID || '')) throw new Error('encryption_unavailable');
  let keys;
  try { keys=JSON.parse(env.REXBID_PORTAL_DATA_KEYS); } catch { throw new Error('encryption_unavailable'); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Object.hasOwn(keys,env.REXBID_PORTAL_ACTIVE_KEY_ID) || Object.keys(keys).length > 16) throw new Error('encryption_unavailable');
  const parsed = new Map();
  for (const [id,value] of Object.entries(keys)) {
    if (!KEY_ID.test(id) || typeof value !== 'string' || value.length !== 43) throw new Error('encryption_unavailable');
    const raw=decode64(value);
    if (raw.byteLength !== 32) throw new Error('encryption_unavailable');
    parsed.set(id,raw);
  }
  return {keys:parsed,active:env.REXBID_PORTAL_ACTIVE_KEY_ID};
}
function aadBytes(aad, id) {
  if (typeof aad !== 'string' || !aad.startsWith('portal:') || aad.length > 512 || /[\u0000-\u001f]/.test(aad)) throw new Error('encryption_unavailable');
  return encoder.encode(`${VERSION}:${id}:${aad}`);
}
function createPortalCrypto({cryptoImpl=globalThis.crypto}={}) {
  function configured(env) {
    try { settings(env); return !!cryptoImpl?.subtle && typeof cryptoImpl.getRandomValues === 'function'; } catch { return false; }
  }
  async function encryptBytes(bytes,aad,env) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) throw new Error('encryption_unavailable');
    const {keys,active}=settings(env), id=encoder.encode(active), nonce=cryptoImpl.getRandomValues(new Uint8Array(12));
    const key=await cryptoImpl.subtle.importKey('raw',keys.get(active),'AES-GCM',false,['encrypt']);
    const cipher=new Uint8Array(await cryptoImpl.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aadBytes(aad,active),tagLength:128},key,bytes));
    const result=new Uint8Array(MAGIC.length+1+id.length+nonce.length+cipher.length);
    result.set(MAGIC); result[MAGIC.length]=id.length; result.set(id,MAGIC.length+1);
    result.set(nonce,MAGIC.length+1+id.length); result.set(cipher,MAGIC.length+1+id.length+12);
    return result;
  }
  async function decryptBytes(bytes,aad,env) {
    try {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES+80 || bytes.byteLength < MAGIC.length+1+1+12+16 || !MAGIC.every((value,index)=>bytes[index]===value)) throw new Error();
      const idLength=bytes[MAGIC.length];
      if (idLength < 1 || idLength > 32 || bytes.length < MAGIC.length+1+idLength+12+16) throw new Error();
      const id=decoder.decode(bytes.subarray(MAGIC.length+1,MAGIC.length+1+idLength)), raw=settings(env).keys.get(id);
      if (!KEY_ID.test(id) || !raw) throw new Error();
      const offset=MAGIC.length+1+idLength;
      const key=await cryptoImpl.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
      return new Uint8Array(await cryptoImpl.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(offset,offset+12),additionalData:aadBytes(aad,id),tagLength:128},key,bytes.subarray(offset+12)));
    } catch { throw new Error('encryption_unavailable'); }
  }
  async function protect(text,aad,env) {
    if (typeof text !== 'string' || text.length > 16384) throw new Error('encryption_unavailable');
    return `${VERSION}.${encode64(await encryptBytes(encoder.encode(text),aad,env))}`;
  }
  async function unprotect(cipher,aad,env) {
    if (typeof cipher !== 'string' || cipher.length > 90000 || !cipher.startsWith(`${VERSION}.`)) throw new Error('encryption_unavailable');
    return decoder.decode(await decryptBytes(decode64(cipher.slice(VERSION.length+1)),aad,env));
  }
  return {configured,protect,unprotect,encryptBytes,decryptBytes};
}

module.exports={createPortalCrypto,MAX_BYTES};
