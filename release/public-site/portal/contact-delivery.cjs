'use strict';
const mail=require('./transactional-mail.cjs');
const ORIGIN='https://rexbid.pl';
function json(status,value){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}});}
async function bodyJson(request){const reader=request.body?.getReader();if(!reader)throw Error('invalid_request');let size=0,text='';const decoder=new TextDecoder();try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>40000)throw Error('invalid_request');text+=decoder.decode(r.value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}return JSON.parse(text+decoder.decode());}
function text(value,min,max){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('invalid_request');return value.trim();}
async function handleContact(request,env,context,{schedule=mail.schedule}={}){
 const url=new URL(request.url),send=url.pathname==='/api/contact/send',status=/^\/api\/contact\/status\/([a-f0-9-]{36})$/i.exec(url.pathname);
 if(!send&&!status&&url.pathname!=='/api/contact/config')return null;
 if(url.origin!==ORIGIN)return json(403,{ok:false,error:'forbidden'});
 if(url.pathname==='/api/contact/config'){
  if(!['GET','HEAD'].includes(request.method))return json(405,{ok:false,error:'method_not_allowed'});
  if(!mail.enabled(env))return null;
  return new Response(request.method==='HEAD'?null:JSON.stringify({email:'kontakt@rexbid.pl',mode:'direct',enabled:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }
 if(!mail.enabled(env))return null;
 if(request.method!==(send?'POST':'GET'))return json(405,{ok:false,error:'method_not_allowed'});
 if(send&&(request.headers.get('Origin')!==ORIGIN||request.headers.get('Sec-Fetch-Site')&&request.headers.get('Sec-Fetch-Site')!=='same-origin'||!/^application\/json\b/i.test(request.headers.get('Content-Type')||'')))return json(403,{ok:false,error:'forbidden'});
 try{
  const ip=request.headers.get('CF-Connecting-IP');if(!ip)return json(503,{ok:false,error:'mail_unavailable'});
  if(env.AUTH_RATE_LIMITER?.limit){const allowed=await env.AUTH_RATE_LIMITER.limit({key:'contact:'+ip});if(!allowed.success)return json(429,{ok:false,error:'rate_limited'});}
  const db=env.REXBID_DB;
  if(status){if(!mail.UUID.test(status[1]))return json(404,{ok:false,error:'not_found'});const row=await db.prepare("SELECT status FROM transactional_mail_outbox WHERE id=? AND kind='inquiry'").bind(status[1]).first();return row?json(200,{ok:true,status:row.status==='sending'?'queued':row.status}):json(404,{ok:false,error:'not_found'});}
  const body=await bodyJson(request);
  if(!body||Object.keys(body).some(k=>!['request_id','name','email','message','draft','website'].includes(k))||!mail.UUID.test(body.request_id||'')||body.website&&String(body.website).trim())throw Error('invalid_request');
  const name=text(body.name,1,80),email=mail.cleanEmail(body.email),message=text(body.message,1,4000),draft=text(body.draft,1,10000);if(!email)throw Error('invalid_request');
  const requestHash=await mail.sha(JSON.stringify({name,email,message,draft}));
  const existing=await db.prepare('SELECT request_hash,status FROM transactional_mail_outbox WHERE dedupe_key=?').bind('inquiry/'+body.request_id).first();
  if(existing)return existing.request_hash===requestHash?json(202,{ok:true,id:body.request_id,status:existing.status,replayed:true}):json(409,{ok:false,error:'conflict'});
  const at=new Date().toISOString(),hour=new Date(Date.parse(at)-3600000).toISOString(),day=at.slice(0,10)+'T00:00:00.000Z';
  const rateKey=await mail.sha(env.REXBID_AUTH_COOKIE_SECRET+':contact:'+ip);
  const row=await mail.rowFor(env,{id:body.request_id,key:'inquiry/'+body.request_id,kind:'inquiry',requestHash,rateKey,to:env.REXBID_MAIL_OWNER_TO,replyTo:email,subject:'REXBID — nowe zapytanie ze strony',text:'Zapytanie przesłane bezpośrednio przez rexbid.pl\n\n'+draft,at});
  const result=await db.prepare(`INSERT INTO transactional_mail_outbox
   (id,dedupe_key,kind,request_hash,rate_key,payload_ciphertext,created_at,next_attempt_at)
   SELECT ?,?,'inquiry',?,?,?,?,?
   WHERE (SELECT COUNT(*) FROM transactional_mail_outbox WHERE kind='inquiry' AND rate_key=? AND created_at>=?)<3
   AND (SELECT COUNT(*) FROM transactional_mail_outbox WHERE kind='inquiry' AND created_at>=?)<30`).bind(row.id,row.key,requestHash,rateKey,row.cipher,at,at,rateKey,hour,day).run();
  if(!Number(result?.meta?.changes??result?.changes))return json(429,{ok:false,error:'rate_limited'});
  schedule(env,context);return json(202,{ok:true,id:row.id,status:'queued'});
 }catch(error){return json(error.message==='invalid_request'||error instanceof SyntaxError?400:503,{ok:false,error:error.message==='invalid_request'||error instanceof SyntaxError?'invalid_request':'mail_unavailable'});}
}
module.exports={handleContact};
