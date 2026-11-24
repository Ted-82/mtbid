'use strict';
const {createPortalCrypto}=require('./crypto.cjs');
const protection=createPortalCrypto();
const enabled=env=>env?.REXBID_ORDER_REGISTER_ENABLED==='yes';
const normalize=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l');
const words=value=>normalize(value).split(/[^a-z0-9]+/).filter(Boolean).map(v=>v.slice(0,80));
const ref=n=>'RB-'+String(n).padStart(6,'0');
const indexVersion=env=>env.REXBID_PORTAL_ACTIVE_KEY_ID+'|contacts-v2';
function localDay(at){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
function day(value,at){if(value==null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value||value>localDay(at))throw Error('invalid_request');return value;}
async function keyring(env,all=false){
 if(!protection.configured(env))throw Error('unavailable');
 const entries=Object.entries(JSON.parse(env.REXBID_PORTAL_DATA_KEYS)).filter(([id])=>all||id===env.REXBID_PORTAL_ACTIVE_KEY_ID);
 return Promise.all(entries.map(async([id,value])=>[id,await crypto.subtle.importKey('raw',Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)) ,{name:'HMAC',hash:'SHA-256'},false,['sign'])]));
}
async function tokens(env,terms,all=false){const keys=await keyring(env,all),encoder=new TextEncoder();return Promise.all(terms.map(async term=>Promise.all(keys.map(async([id,key])=>{const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('portal:order-search:v1:'+term)));return id+':'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}))));}
async function profileTokens(env,p,email){
 const digits=String(p.phone||'').replace(/\D/g,''),values=[p.name,p.email,email,p.phone,digits,digits.length>9?digits.slice(-9):''].filter(Boolean).join(' '),prefixes=new Set();
 for(const word of words(values))for(let i=1;i<=word.length;i++)prefixes.add(word.slice(0,i));
 return(await tokens(env,[...prefixes])).flat();
}
async function profileIndexStatements(env,userId,profile,at,cipher){
 const db=env.REXBID_DB,row=await db.prepare('SELECT email_ciphertext,email_hash FROM portal_notification_recipients WHERE user_id=?').bind(userId).first();
 const email=row?await protection.unprotect(row.email_ciphertext,'portal:mail:recipient:'+userId,env):null,hashes=await profileTokens(env,profile,email);
 const exists='EXISTS(SELECT 1 FROM portal_customer_profiles p WHERE p.user_id=? AND p.content_ciphertext=?)';
 return[
  db.prepare('DELETE FROM portal_client_search_tokens WHERE user_id=? AND '+exists).bind(userId,userId,cipher),
  db.prepare('INSERT INTO portal_client_search_tokens(user_id,token) SELECT ?,value FROM json_each(?) WHERE '+exists).bind(userId,JSON.stringify(hashes),userId,cipher),
  db.prepare('INSERT INTO portal_client_search_state(user_id,profile_updated,email_hash,key_id) SELECT ?,?,?,? WHERE '+exists+' ON CONFLICT(user_id) DO UPDATE SET profile_updated=excluded.profile_updated,email_hash=excluded.email_hash,key_id=excluded.key_id').bind(userId,at,row?.email_hash||'',indexVersion(env),userId,cipher)
 ];
}
async function syncSearch(env){
 const db=env.REXBID_DB;
 const query=`SELECT DISTINCT u.id,p.content_ciphertext,COALESCE(p.updated_at,'') profile_updated,n.email_ciphertext,COALESCE(n.email_hash,'') email_hash FROM users u
 JOIN import_orders o ON o.client_user_id=u.id LEFT JOIN portal_customer_profiles p ON p.user_id=u.id
 LEFT JOIN portal_notification_recipients n ON n.user_id=u.id LEFT JOIN portal_client_search_state s ON s.user_id=u.id
 WHERE s.user_id IS NULL OR s.profile_updated<>COALESCE(p.updated_at,'') OR s.email_hash<>COALESCE(n.email_hash,'') OR s.key_id<>? ORDER BY u.id LIMIT 21`;
 const rows=(await db.prepare(query).bind(indexVersion(env)).all()).results||[];
 for(const row of rows.slice(0,20)){
  const p=row.content_ciphertext?JSON.parse(await protection.unprotect(row.content_ciphertext,'portal:profile:'+row.id,env)):{};
  const email=row.email_ciphertext?await protection.unprotect(row.email_ciphertext,'portal:mail:recipient:'+row.id,env):null;
  const hashes=await profileTokens(env,p,email);
  await db.batch([
   db.prepare('DELETE FROM portal_client_search_tokens WHERE user_id=?').bind(row.id),
   db.prepare('INSERT INTO portal_client_search_tokens(user_id,token) SELECT ?,value FROM json_each(?)').bind(row.id,JSON.stringify(hashes)),
   db.prepare('INSERT INTO portal_client_search_state(user_id,profile_updated,email_hash,key_id) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET profile_updated=excluded.profile_updated,email_hash=excluded.email_hash,key_id=excluded.key_id').bind(row.id,row.profile_updated,row.email_hash,indexVersion(env))
  ]);
 }
 return {ready:rows.length<=20};
}
async function decorate(env,row,owner=false){
 const r=await env.REXBID_DB.prepare('SELECT * FROM import_order_register WHERE order_id=?').bind(row.id).first();
 const out={...row};if(r)out.register={number:r.number,reference:ref(r.number),vehicle_label:r.vehicle_label,purchased_on:r.purchased_on,delivered_on:r.delivered_on,is_test:!!r.is_test};
 if(owner){const n=await env.REXBID_DB.prepare('SELECT email_ciphertext FROM portal_notification_recipients WHERE user_id=?').bind(row.client_user_id).first();out.verified_email=n?await protection.unprotect(n.email_ciphertext,'portal:mail:recipient:'+row.client_user_id,env):null;}
 return out;
}
function createStatement(db,id,at,isTest=false){return db.prepare('INSERT INTO import_order_register(order_id,number,is_test,updated_at) VALUES(?,(SELECT COALESCE(MAX(number),0)+1 FROM import_order_register),?,?)').bind(id,isTest?1:0,at);}
async function stageDates(env,order,body,at){
 const row=await env.REXBID_DB.prepare('SELECT purchased_on,delivered_on FROM import_order_register WHERE order_id=?').bind(order.id).first();if(!row)throw Error('unavailable');
 const purchased_on=Object.hasOwn(body,'purchased_on')?day(body.purchased_on,at):row.purchased_on;
 const delivered_on=Object.hasOwn(body,'delivered_on')?day(body.delivered_on,at):row.delivered_on;
 const status=body.status||order.status;
 if(status==='auction_won'&&!purchased_on||status==='delivered'&&!delivered_on||Object.hasOwn(body,'delivered_on')&&delivered_on&&status!=='delivered'||purchased_on&&delivered_on&&purchased_on>delivered_on)throw Error('invalid_request');
 return {purchased_on,delivered_on};
}
function stageStatement(db,{orderId,eventId,dates,at}){return db.prepare(`UPDATE import_order_register SET purchased_on=?,delivered_on=?,updated_at=? WHERE order_id=? AND EXISTS(SELECT 1 FROM import_orders o WHERE o.id=order_id AND o.last_change_id=?)`).bind(dates.purchased_on,dates.delivered_on,at,orderId,eventId);}
async function list(env,url,{limit,offset},unreadSql,incomingRole,audience){
 const db=env.REXBID_DB,search=await syncSearch(env),q=(url.searchParams.get('q')||'').trim(),kind=url.searchParams.get('kind')||'all',status=url.searchParams.get('status')||'';
 if(q.length>80||!['all','real','test'].includes(kind)||status&&!['preparation','auction_won','payment_confirmed','pickup_planned','at_us_terminal','loaded','at_sea','at_eu_port','customs','delivery','delivered'].includes(status))throw Error('invalid_request');
 const conditions=[],params=[];
 if(kind!=='all'){conditions.push('r.is_test=?');params.push(kind==='test'?1:0);}
 if(status){conditions.push('o.status=?');params.push(status);}
 if(q){
  const literal='%'+q.toUpperCase().replace(/[\\%_]/g,c=>'\\'+c)+'%',numeric=q.match(/^(?:RB[- ]?)?0*(\d+)$/i);
  const alternatives=["UPPER(o.title) LIKE ? ESCAPE '\\'","UPPER(COALESCE(r.vehicle_label,'')) LIKE ? ESCAPE '\\'","UPPER(COALESCE(o.vin,'')) LIKE ? ESCAPE '\\'","UPPER(COALESCE(o.lot,'')) LIKE ? ESCAPE '\\'"];
  params.push(literal,literal,literal,literal);
  if(numeric){alternatives.push('r.number=?');params.push(Number(numeric[1]));}
  const terms=[...new Set(words(q))].slice(0,8);
  if(terms.length){const variants=await tokens(env,terms,true);alternatives.push('('+variants.map(()=>`EXISTS(SELECT 1 FROM portal_client_search_tokens t WHERE t.user_id=o.client_user_id AND t.token IN(SELECT value FROM json_each(?)))`).join(' AND ')+')');params.push(...variants.map(v=>JSON.stringify(v)));}
  conditions.push('('+alternatives.join(' OR ')+')');
 }
 const from=' FROM import_orders o JOIN import_order_register r ON r.order_id=o.id',where=conditions.length?' WHERE '+conditions.join(' AND '):'';
 const rows=(await db.prepare('SELECT o.*,'+unreadSql.replace(/import_orders\.id/g,'o.id')+from+where+' ORDER BY o.updated_at DESC,o.id LIMIT ? OFFSET ?').bind(incomingRole,audience,...params,limit+1,offset).all()).results||[];
 const count=await db.prepare('SELECT COUNT(*) count'+from+where).bind(...params).first();
 const summary=await db.prepare(`SELECT COUNT(*) cases_total,SUM(r.is_test=1) test_cases,SUM(r.is_test=0) real_cases,SUM(r.is_test=0 AND r.purchased_on IS NOT NULL) purchased,SUM(r.is_test=0 AND o.status='delivered' AND r.delivered_on IS NOT NULL) delivered,SUM(r.is_test=0 AND o.status<>'delivered') ongoing`+from).first();
 return {rows:rows.slice(0,limit),pagination:{limit,offset,has_more:rows.length>limit,total:count.count},summary:Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,Number(v||0)])),search_ready:search.ready};
}
async function update({env,order,body,user,protect,now,cryptoImpl}){
 const allowed=['expected_version','vehicle_label','vin','lot','platform','purchased_on','delivered_on','is_test'];if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k))||!Number.isSafeInteger(body.expected_version)||body.expected_version<1)throw Error('invalid_request');
 const db=env.REXBID_DB,r=await db.prepare('SELECT * FROM import_order_register WHERE order_id=?').bind(order.id).first();if(!r)throw Error('unavailable');
 const at=now(),values={...r,vin:order.vin,lot:order.lot,platform:order.platform};
 if(Object.hasOwn(body,'vehicle_label')){const v=body.vehicle_label;if(v!==null&&(typeof v!=='string'||v.length>160||/[\u0000-\u001f]/.test(v)))throw Error('invalid_request');values.vehicle_label=v?.trim()||null;}
 for(const key of ['vin','lot','platform'])if(Object.hasOwn(body,key)){if(body[key]!==null&&typeof body[key]!=='string')throw Error('invalid_request');values[key]=body[key]?.trim()||null;}
 if(values.vin){values.vin=values.vin.toUpperCase();if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(values.vin))throw Error('invalid_request');}
 if(values.lot){values.lot=values.lot.toUpperCase();if(!/^[A-Z0-9-]{1,32}$/.test(values.lot))throw Error('invalid_request');}
 if(!values.vin&&!values.lot||!!values.lot!==!!values.platform||values.platform&&!['copart','iaai'].includes(values.platform))throw Error('invalid_request');
 for(const key of ['purchased_on','delivered_on'])if(Object.hasOwn(body,key))values[key]=day(body[key],at);
 if(Object.hasOwn(body,'delivered_on')&&values.delivered_on&&order.status!=='delivered')throw Error('invalid_request');
 if(values.purchased_on&&values.delivered_on&&values.purchased_on>values.delivered_on)throw Error('invalid_request');
 if(Object.hasOwn(body,'is_test')){if(typeof body.is_test!=='boolean')throw Error('invalid_request');values.is_test=body.is_test?1:0;}
 const eventId=cryptoImpl.randomUUID(),cipher=await protect(JSON.stringify({message:'Zmieniono dane ewidencyjne realizacji.',before:{...r,vin:order.vin,lot:order.lot,platform:order.platform},after:values}),'portal:event:'+order.id+':'+eventId,env);
 const results=await db.batch([
  db.prepare('UPDATE import_orders SET vin=?,lot=?,platform=?,version=version+1,last_change_id=?,updated_at=? WHERE id=? AND version=?').bind(values.vin,values.lot,values.platform,eventId,at,order.id,body.expected_version),
  db.prepare('UPDATE import_order_register SET vehicle_label=?,purchased_on=?,delivered_on=?,is_test=?,updated_at=? WHERE order_id=? AND EXISTS(SELECT 1 FROM import_orders o WHERE o.id=order_id AND o.last_change_id=?)').bind(values.vehicle_label,values.purchased_on,values.delivered_on,values.is_test,at,order.id,eventId),
  db.prepare("INSERT INTO import_order_events(id,order_id,event_type,visibility,content_ciphertext,created_by,created_at) SELECT ?,id,'note','internal',?,?,? FROM import_orders WHERE id=? AND last_change_id=?").bind(eventId,cipher,user.id,at,order.id,eventId)
 ]);
 return Number(results[0]?.meta?.changes||0)>0;
}
module.exports={enabled,normalize,words,ref,day,localDay,tokens,profileIndexStatements,syncSearch,decorate,createStatement,stageDates,stageStatement,list,update};
