'use strict';
const mail=require('./transactional-mail.cjs'),{createPortalCrypto}=require('./crypto.cjs'),protection=createPortalCrypto();
const enabled=env=>mail.enabled(env)&&env.REXBID_ACCOUNT_NOTICES_ENABLED==='yes'&&env.REXBID_ACCOUNT_NOTICES_SCHEMA_VERSION==='0016';
const hash=(env,email)=>mail.sha(env.REXBID_AUTH_COOKIE_SECRET+':registration:'+email);
async function signupRequested(env,email,context,{now=()=>new Date().toISOString(),send=true}={}){
 if(!enabled(env)||(email=mail.cleanEmail(email))===null)return;
 const db=env.REXBID_DB,key=await hash(env,email),existing=await db.prepare('SELECT id FROM owner_registration_signals WHERE email_hash=?').bind(key).first();if(existing)return;
 const at=now(),id=crypto.randomUUID(),cipher=await protection.protect(email,'portal:registration:'+id,env);
 const row=await mail.rowFor(env,{key:'account-request/'+key,kind:'account_notice',to:env.REXBID_MAIL_OWNER_TO,subject:'REXBID — zgłoszenie rejestracji',text:'Na stronie zgłoszono rejestrację z adresem: '+email+'\n\nAdres NIE jest jeszcze potwierdzony. To zgłoszenie, nie dowód założenia konta ani tożsamości osoby. Konto nie daje dostępu do cudzych realizacji ani do licytacji.\n\nSprawdź Rejestracje i konta klientów:\nhttps://rexbid.pl/administracja?view=accounts#rejestracje',at});
 // Public registration attempts are untrusted. A fixed owner recipient,
 // dedupe and a bounded daily signal intake prevent arbitrary-recipient spam.
 await db.batch([
  db.prepare('INSERT INTO owner_registration_signals(id,email_hash,email_ciphertext,requested_at,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM owner_registration_signals WHERE requested_at>=?)<30 ON CONFLICT(email_hash) DO NOTHING').bind(id,key,cipher,at,at,at.slice(0,10)+'T00:00:00.000Z'),
  db.prepare('INSERT INTO account_notice_outbox(id,dedupe_key,kind,message_id,payload_ciphertext,created_at,next_attempt_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM owner_registration_signals WHERE id=?) ON CONFLICT(dedupe_key) DO NOTHING').bind(row.id,row.key,row.kind,id,row.cipher,at,at,id)
 ]);
 if(send)mail.schedule(env,context);
}
async function accountConfirmed(env,{user,email},context,{now=()=>new Date().toISOString(),send=true}={}){
 if(!enabled(env)||!user?.id||!user.email_verified||user.id===env.REXBID_OWNER_USER_ID||(email=mail.cleanEmail(email))===null)return;
 const db=env.REXBID_DB,key=await hash(env,email),at=now();
 await mail.rememberRecipient(env,user.id,email,at);
 const existing=await db.prepare('SELECT id,confirmed_at FROM owner_registration_signals WHERE email_hash=?').bind(key).first();if(existing?.confirmed_at)return;
 const id=existing?.id||crypto.randomUUID(),cipher=await protection.protect(email,'portal:registration:'+id,env);
 const row=await mail.rowFor(env,{key:'account-confirmed/'+key,kind:'account_notice',to:env.REXBID_MAIL_OWNER_TO,subject:'REXBID — potwierdzone konto klienta',text:'Klient potwierdził adres e-mail i korzysta z konta: '+email+'\n\nKonto jest potwierdzone. Nie oznacza to zlecenia ani wpłaty. Realizację importu przypisuje właściciel; klient widzi wyłącznie swoje dane.\n\nSprawdź Rejestracje i konta klientów:\nhttps://rexbid.pl/administracja?view=accounts#rejestracje',at});
 await db.batch([
  db.prepare('INSERT INTO owner_registration_signals(id,email_hash,email_ciphertext,confirmed_at,account_created_at,user_id,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(email_hash) DO UPDATE SET confirmed_at=COALESCE(owner_registration_signals.confirmed_at,excluded.confirmed_at),account_created_at=excluded.account_created_at,user_id=excluded.user_id,owner_seen_at=NULL').bind(id,key,cipher,at,user.created_at||at,user.id,at),
  db.prepare('INSERT INTO account_notice_outbox(id,dedupe_key,kind,message_id,payload_ciphertext,created_at,next_attempt_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM owner_registration_signals WHERE id=?) ON CONFLICT(dedupe_key) DO NOTHING').bind(row.id,row.key,row.kind,id,row.cipher,at,at,id)
 ]);
 if(send)mail.schedule(env,context);
}
async function list(env,{limit=20,offset=0}={}){
 const db=env.REXBID_DB,rows=(await db.prepare('SELECT * FROM owner_registration_signals ORDER BY created_at DESC,id LIMIT ? OFFSET ?').bind(limit+1,offset).all()).results||[],items=[];
 for(const r of rows.slice(0,limit))items.push({id:r.id,email:await protection.unprotect(r.email_ciphertext,'portal:registration:'+r.id,env),status:r.confirmed_at?'confirmed':'requested',requested_at:r.requested_at,confirmed_at:r.confirmed_at,account_created_at:r.account_created_at,user_id:r.user_id,seen:!!r.owner_seen_at});
 return{registrations:items,pagination:{limit,offset,has_more:rows.length>limit},coverage:'Zgłoszenia od włączenia tej funkcji oraz konta odnotowane po potwierdzonym logowaniu. Wcześniejsze nieukończone rejestracje są w usłudze uwierzytelniania, nie w tej liście. Zabezpieczenie zapisuje do 30 różnych niepotwierdzonych zgłoszeń dziennie; potwierdzone konta odnotowujemy niezależnie od tego progu. Poniżej do 50 najnowszych kont; pełna paginowana lista kont jest również przy dodawaniu realizacji.'};
}
module.exports={enabled,signupRequested,accountConfirmed,list};
