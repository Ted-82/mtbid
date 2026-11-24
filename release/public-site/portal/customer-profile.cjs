'use strict';
const register=require('./order-register.cjs');
function clean(value,max){if(value==null||value==='')return null;if(typeof value!=='string')throw Error('invalid_request');const result=value.trim();if(!result||result.length>max||/[\u0000-\u001f\u007f]/.test(result))throw Error('invalid_request');return result;}
function parse(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['name','email','phone','expected_revision'].includes(k)))throw Error('invalid_request');
 const profile={name:clean(body.name,80),email:clean(body.email,320)?.toLowerCase()||null,phone:clean(body.phone,40)};
 if(profile.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)||profile.phone&&!/^[+()0-9 .-]{5,40}$/.test(profile.phone))throw Error('invalid_request');
 return profile;
}
function createCustomerProfileService({protect,unprotect,cryptoImpl=globalThis.crypto,now=()=>new Date().toISOString()}){
 async function revision(cipher){if(!cipher)return 'none';return Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(cipher))),b=>b.toString(16).padStart(2,'0')).join('');}
 async function read(env,userId){const row=await env.REXBID_DB.prepare('SELECT content_ciphertext,created_at,updated_at FROM portal_customer_profiles WHERE user_id=?').bind(userId).first();return{profile:row?JSON.parse(await unprotect(row.content_ciphertext,'portal:profile:'+userId,env)):null,revision:await revision(row?.content_ciphertext),raw:row?.content_ciphertext||null};}
 async function save(env,userId,body,{owner,order}={}){
  const profile=parse(body),old=await read(env,userId);
  if(owner&&!/^(?:none|[a-f0-9]{64})$/.test(body.expected_revision||''))throw Error('invalid_request');
  if(body.expected_revision!==undefined&&body.expected_revision!==old.revision)return{conflict:true};
  const at=now(),cipher=await protect(JSON.stringify(profile),'portal:profile:'+userId,env),db=env.REXBID_DB;
  const write=old.raw?db.prepare('UPDATE portal_customer_profiles SET content_ciphertext=?,updated_at=? WHERE user_id=? AND content_ciphertext=?').bind(cipher,at,userId,old.raw):db.prepare('INSERT INTO portal_customer_profiles(user_id,content_ciphertext,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO NOTHING').bind(userId,cipher,at,at);
  const statements=[write];
  if(owner){
   const eventId=cryptoImpl.randomUUID(),audit=await protect(JSON.stringify({message:'Właściciel zaktualizował dane kontaktowe klienta.',before:old.profile,after:profile}),'portal:event:'+order.id+':'+eventId,env);
   statements.push(db.prepare("INSERT INTO import_order_events(id,order_id,event_type,visibility,content_ciphertext,created_by,created_at) SELECT ?,id,'note','internal',?,?,? FROM import_orders WHERE id=? AND client_user_id=? AND EXISTS(SELECT 1 FROM portal_customer_profiles p WHERE p.user_id=? AND p.content_ciphertext=?)").bind(eventId,audit,owner.id,at,order.id,userId,userId,cipher));
  }
  if(register.enabled(env))statements.push(...await register.profileIndexStatements(env,userId,profile,at,cipher));
  const result=await db.batch(statements);if(Number(result[0]?.meta?.changes??result[0]?.changes??0)!==1)return{conflict:true};
  return{profile,revision:await revision(cipher)};
 }
 return{read,save};
}
module.exports={createCustomerProfileService,parse};
