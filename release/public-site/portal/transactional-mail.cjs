'use strict';
const {createPortalCrypto}=require('./crypto.cjs');
const protection=createPortalCrypto();
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const EMAIL=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const cleanEmail=value=>typeof value==='string'&&value.length<=254&&EMAIL.test(value)?value.toLowerCase():null;
const changed=r=>Number(r?.meta?.changes??r?.changes??0);
function enabled(env){return env?.REXBID_MAIL_ENABLED==='yes'&&env.REXBID_MAIL_SCHEMA_VERSION==='0015'&&env.AUTH_CANONICAL_ORIGIN==='https://rexbid.pl'&&
 typeof env.REXBID_MAIL_API_KEY==='string'&&/^re_[A-Za-z0-9_-]{20,}$/.test(env.REXBID_MAIL_API_KEY)&&
 cleanEmail(env.REXBID_MAIL_OWNER_TO)&&cleanEmail(env.REXBID_MAIL_FROM)&&env.REXBID_MAIL_FROM.endsWith('@powiadomienia.rexbid.pl')&&
 !!env.REXBID_DB&&protection.configured(env);}
const sha=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
function messageStatement(db,row){return db.prepare(`INSERT INTO transactional_mail_outbox
 (id,dedupe_key,kind,message_id,request_hash,rate_key,payload_ciphertext,created_at,next_attempt_at)
 VALUES (?,?,?,?,?,?,?,?,?)`).bind(row.id,row.key,row.kind,row.messageId||null,row.requestHash||null,row.rateKey||null,row.cipher,row.at,row.at);}
async function rowFor(env,{id=crypto.randomUUID(),key,kind,messageId,requestHash,rateKey,to,replyTo,subject,text,at=new Date().toISOString()}){
 if(!enabled(env)||!UUID.test(id)||!cleanEmail(to)||replyTo&&!cleanEmail(replyTo))throw Error('mail_configuration');
 const payload={from:'REXBID <'+env.REXBID_MAIL_FROM+'>',to:[cleanEmail(to)],subject,text,reply_to:replyTo?cleanEmail(replyTo):'kontakt@rexbid.pl'};
 return {id,key,kind,messageId,requestHash,rateKey,at,cipher:await protection.protect(JSON.stringify(payload),'portal:mail:outbox:'+id,env)};
}
async function rememberRecipient(env,userId,email,at=new Date().toISOString()){
 email=cleanEmail(email);if(!email)return;
 const fingerprint=await sha(env.REXBID_AUTH_COOKIE_SECRET+':mail:'+email);
 const existing=await env.REXBID_DB.prepare('SELECT verified_at,email_hash FROM portal_notification_recipients WHERE user_id=?').bind(userId).first();
 if(existing&&existing.email_hash===fingerprint&&Date.parse(at)-Date.parse(existing.verified_at)<3600000)return;
 const cipher=await protection.protect(email,'portal:mail:recipient:'+userId,env);
 await env.REXBID_DB.prepare('INSERT INTO portal_notification_recipients(user_id,email_ciphertext,email_hash,verified_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_ciphertext=excluded.email_ciphertext,email_hash=excluded.email_hash,verified_at=excluded.verified_at').bind(userId,cipher,fingerprint,at).run();
}
async function portalNotice(env,{messageId,order,owner,at}){
 let to=env.REXBID_MAIL_OWNER_TO;
 if(owner){const r=await env.REXBID_DB.prepare('SELECT email_ciphertext FROM portal_notification_recipients WHERE user_id=?').bind(order.client_user_id).first();if(!r)return null;to=await protection.unprotect(r.email_ciphertext,'portal:mail:recipient:'+order.client_user_id,env);}
 if(!UUID.test(order.id||''))throw Error('mail_order_unavailable');
 const url=(owner?'https://rexbid.pl/panel':'https://rexbid.pl/administracja')+'?order='+encodeURIComponent(order.id)+'#rozmowa';
 return rowFor(env,{id:messageId,key:'message/'+messageId,kind:'portal_message',messageId,to,at,
  subject:owner?'REXBID — nowa odpowiedź w sprawie Twojego importu':'REXBID — nowa wiadomość od klienta',
  text:(owner?'Masz nową odpowiedź od REXBID.':'Klient przesłał nową wiadomość w panelu REXBID.')+'\n\n'+String(order.title).slice(0,180)+'\n'+String(order.platform||'').toUpperCase()+' · LOT '+String(order.lot||'do uzupełnienia')+'\n\nOtwórz panel, aby przeczytać i odpowiedzieć:\n'+url+'\n\nTo automatyczne powiadomienie. Treść rozmowy jest dostępna po zalogowaniu do REXBID.'});
}
function schedule(env,context){if(!enabled(env))return;const task=dispatchAll(env).catch(()=>console.warn('REXBID mail delivery unavailable'));if(context?.waitUntil)context.waitUntil(task);return task;}
async function dispatchAll(env){if(env.REXBID_ACCOUNT_NOTICES_ENABLED!=='yes')return dispatch(env);const messages=await dispatch(env,{maximum:1});const accounts=await dispatch(env,{maximum:1,queue:'accounts'});return{sent:messages.sent+accounts.sent};}
async function dispatch(env,{fetchImpl=(url,init)=>fetch(url,init),now=()=>new Date(),maximum=2,queue='messages'}={}){
 if(!enabled(env))return {status:'disabled',sent:0};
 if(!['messages','accounts'].includes(queue))throw Error('invalid_mail_queue');
 if(queue==='accounts'&&(env.REXBID_ACCOUNT_NOTICES_ENABLED!=='yes'||env.REXBID_ACCOUNT_NOTICES_SCHEMA_VERSION!=='0016'))return{status:'disabled',sent:0};
 const table=queue==='accounts'?'account_notice_outbox':'transactional_mail_outbox',baseDb=env.REXBID_DB;
 const db={prepare:sql=>baseDb.prepare(sql.replace(/\btransactional_mail_outbox\b/g,table)),batch:items=>baseDb.batch(items)},at=now().toISOString(),day=at.slice(0,10);
 // Only this new technical email copy expires. Authoritative portal messages,
 // existing customer files, auction history and all photographs are untouched.
 await db.prepare("UPDATE transactional_mail_outbox SET payload_ciphertext=NULL WHERE status='sent' AND kind='inquiry' AND submitted_at<? AND payload_ciphertext IS NOT NULL").bind(new Date(Date.parse(at)-30*86400000).toISOString()).run();
 await db.prepare("UPDATE transactional_mail_outbox SET rate_key=NULL WHERE kind='inquiry' AND created_at<? AND rate_key IS NOT NULL").bind(new Date(Date.parse(at)-86400000).toISOString()).run();
 const candidates=(await db.prepare("SELECT id FROM transactional_mail_outbox WHERE (status='queued' AND next_attempt_at<=?) OR (status='sending' AND lease_until<?) ORDER BY created_at LIMIT ?").bind(at,at,Math.min(maximum,5)).all()).results||[];let sent=0;
 for(const candidate of candidates){
  const token=crypto.randomUUID(),until=new Date(Date.parse(at)+90000).toISOString();
  const results=await db.batch([
   db.prepare('INSERT INTO transactional_mail_daily_budget(day,attempts) VALUES(?,0) ON CONFLICT(day) DO NOTHING').bind(day),
   db.prepare("UPDATE transactional_mail_outbox SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND ((status='queued' AND next_attempt_at<=?) OR (status='sending' AND lease_until<?))").bind(token,until,candidate.id,at,at),
   db.prepare('UPDATE transactional_mail_daily_budget SET attempts=attempts+1 WHERE day=? AND attempts<80 AND EXISTS(SELECT 1 FROM transactional_mail_outbox WHERE id=? AND lease_token=?)').bind(day,candidate.id,token)
  ]);
  if(!changed(results[1]))continue;
  const row=await db.prepare('SELECT * FROM transactional_mail_outbox WHERE id=? AND lease_token=?').bind(candidate.id,token).first();
  if(['portal_message','account_notice'].includes(row.kind)&&!row.message_id){await finish('failed','message_removed');continue;}
  if(!changed(results[2])){const tomorrow=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString();await retry('daily_reserve',tomorrow,false);continue;}
  if(row.ambiguous_since&&Date.parse(at)-Date.parse(row.ambiguous_since)>23*3600000){await finish('needs_review','ambiguous_expired');continue;}
  let payload;try{payload=JSON.parse(await protection.unprotect(row.payload_ciphertext,'portal:mail:outbox:'+row.id,env));}catch{await finish('failed','payload_unavailable');continue;}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  let stage='attempt_marker';
  try{
   // A durable attempt marker precedes the HTTP request. Retries use the same
   // immutable payload/key; uncertain requests are not blindly retried >24h.
   await db.prepare('UPDATE transactional_mail_outbox SET ambiguous_since=COALESCE(ambiguous_since,?) WHERE id=? AND lease_token=?').bind(at,row.id,token).run();
   stage='provider_request';
   const r=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+env.REXBID_MAIL_API_KEY,'Content-Type':'application/json','Idempotency-Key':'rexbid/'+row.id},body:JSON.stringify(payload),signal:controller.signal});
   let value;try{value=await r.json();}catch{value={};}
   if(r.ok&&UUID.test(value.id||'')){
    stage='acceptance_record';
    await db.prepare("UPDATE transactional_mail_outbox SET status='sent',provider_id=?,submitted_at=?,payload_ciphertext=CASE WHEN kind IN ('portal_message','account_notice') THEN NULL ELSE payload_ciphertext END,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=? AND lease_token=?").bind(value.id,at,row.id,token).run();sent++;
   }else if(r.status===429){await retry('provider_quota',new Date(Date.parse(at)+3600000).toISOString(),!!row.ambiguous_since);}
   else if(r.status>=500){await retry('provider_unavailable',backoff(row.attempts),true);}
   else if(r.status===409){await finish('needs_review','provider_conflict');}
   else{await finish('failed','provider_rejected');}
  }catch(error){console.warn('REXBID mail attempt uncertain',JSON.stringify({stage,error:['TypeError','AbortError','TimeoutError'].includes(error?.name)?error.name:'Error'}));await retry('delivery_uncertain',backoff(row.attempts),true);}
  finally{clearTimeout(timer);}
  function backoff(attempts){return new Date(Date.parse(at)+Math.min(6*3600000,60000*Math.pow(3,Math.min(attempts,6)))).toISOString();}
  async function finish(status,error){await db.prepare('UPDATE transactional_mail_outbox SET status=?,last_error=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').bind(status,error,candidate.id,token).run();}
  async function retry(code,next,ambiguous){await db.prepare("UPDATE transactional_mail_outbox SET status='queued',last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,ambiguous_since=CASE WHEN ? THEN COALESCE(ambiguous_since,?) ELSE NULL END WHERE id=? AND lease_token=?").bind(code,next,ambiguous?1:0,at,candidate.id,token).run();}
 }
 return {status:'complete',sent};
}
module.exports={enabled,cleanEmail,UUID,sha,rowFor,messageStatement,rememberRecipient,portalNotice,schedule,dispatch,dispatchAll};
