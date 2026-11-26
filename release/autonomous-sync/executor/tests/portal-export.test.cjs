'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {webcrypto}=require('node:crypto');
const {createPortalExportHandler,SECTIONS,PAGE_SIZE,CURSOR_TTL_MS}=require('../portal/export.cjs');
const {createPortalCrypto}=require('../portal/crypto.cjs');
const ROOT=path.resolve(__dirname,'..'), ORIGIN='https://rexbid.pl';
const T0='2026-10-06T05:00:00.000Z', START='2026-10-06T06:00:00.000Z';
function id(number) { return `00000000-0000-4000-8000-${number.toString(16).padStart(12,'0')}`; }

class LocalD1 {
  constructor() {
    this.db=new DatabaseSync(':memory:'); this.calls=[];
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec(fs.readFileSync(path.join(ROOT,'docs/proposals/0003_accounts_foundation.sql'),'utf8'));
    this.db.exec(fs.readFileSync(path.join(ROOT,'docs/proposals/0006_import_operations.sql'),'utf8'));
  }
  prepare(sql) {
    const statement=this.db.prepare(sql);let args=[]; const calls=this.calls;
    return {bind(...values){args=values;return this;},async first(){calls.push({sql,args});return statement.get(...args)||null;},async all(){calls.push({sql,args});return {results:statement.all(...args)};}};
  }
}
async function fixture(count=2,options={}) {
  const db=new LocalD1(), underlying=createPortalCrypto({cryptoImpl:webcrypto}), decryptions=[];
  const protection={...underlying,async unprotect(cipher,aad,env){decryptions.push(aad);return underlying.unprotect(cipher,aad,env);}};
  const env={REXBID_PORTAL_ENABLED:'enabled',REXBID_PORTAL_SCHEMA_VERSION:'0006',AUTH_ENABLED:'true',AUTH_CANONICAL_ORIGIN:ORIGIN,AUTH_ALLOWED_ORIGINS:ORIGIN,
    REXBID_OWNER_USER_ID:'owner',REXBID_DB:db,REXBID_PORTAL_ACTIVE_KEY_ID:'k1',REXBID_PORTAL_DATA_KEYS:JSON.stringify({k1:Buffer.alloc(32,7).toString('base64url')})};
  let now=START, resolverCalls=0;
  for(const user of ['client-a','client-b','owner']) db.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(user,'https://private.auth.test',`auth-subject-private-${user}`,'email',1,T0,T0);
  const profile=await underlying.protect(JSON.stringify({name:'Client A',email:'private-a@example.test',phone:'+48123456789',role:'SECRET-NOT-EXPORTED'}),'portal:profile:client-a',env);
  db.db.prepare('INSERT INTO portal_customer_profiles VALUES (?,?,?,?)').run('client-a',profile,T0,T0);
  async function seed(user,index,created=T0) {
    const orderId=id(index), marker=user==='client-b'?'FOREIGN-CLIENT-SECRET':'A';
    db.db.prepare('INSERT INTO import_orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderId,user,`${marker} vehicle ${index}`,null,String(index),'copart','at_sea','Port USA','2026-11-10T12:00:00Z','Verified Vessel','TEST-CONTAINER',1,id(index+200000),'owner',created,created);
    db.db.prepare('INSERT INTO user_favorites VALUES (?,?,?,?,?,?,?)').run(user,`lot:copart:${index}`,null,String(index),'copart',created,created);
    for(const visibility of ['client','internal']) {
      const eventId=id(index+(visibility==='client'?10000:20000));
      const eventCipher=await underlying.protect(JSON.stringify({message:visibility==='client'?`${marker} confirmed event ${index}`:'INTERNAL-NOTE-NEVER-EXPORT'}),`portal:event:${orderId}:${eventId}`,env);
      db.db.prepare('INSERT INTO import_order_events VALUES (?,?,?,?,?,?,?,?,?,?)').run(eventId,orderId,'update',visibility,'at_sea','Port USA',null,eventCipher,'owner',created);
      const fileId=id(index+(visibility==='client'?30000:40000));
      db.db.prepare('INSERT INTO import_order_files VALUES (?,?,?,?,?,?,?,?,?,?)').run(fileId,orderId,`PRIVATE-R2-KEY/${user}/${fileId}`,visibility==='client'?`${marker}-document-${index}.pdf`:'INTERNAL-FILENAME.pdf','application/pdf',123,'a'.repeat(64),visibility,'owner',created);
    }
    const messageId=id(index+50000), messageCipher=await underlying.protect(`${marker} message ${index}`,`portal:message:${orderId}:${messageId}`,env);
    db.db.prepare('INSERT INTO import_order_messages VALUES (?,?,?,?,?,?)').run(messageId,orderId,'owner','owner',messageCipher,created);
    return orderId;
  }
  for(let index=1;index<=count;index++) await seed('client-a',index);
  await seed('client-b',1000); await seed('owner',2000);
  const handler=createPortalExportHandler({resolveAccount:async request=>{
    resolverCalls++; const user=request.headers.get('Cookie')?.match(/user=([^;]+)/)?.[1];
    return {status:user?200:401,user:user?{id:user,role:'owner'}:null,assurance_level:request.headers.get('X-Test-AAL') || 'aal2',cookies:['__Host-test=updated; Secure; HttpOnly; Path=/']};
  },protection,cryptoImpl:webcrypto,now:()=>now,...options});
  async function call(query='',{user='client-a',origin=ORIGIN,host=ORIGIN,method='GET',headers={}}={}) {
    const h=new Headers(headers);if(user)h.set('Cookie',`user=${user}`);if(origin)h.set('Origin',origin);
    return handler(new Request(`${host}/api/portal/export${query}`,{method,headers:h}),env);
  }
  async function manifest(user='client-a') { const result=await call('',{user});assert.equal(result.status,200);return result.json(); }
  async function page(section,cursor,user='client-a') { return call(`?section=${section}&cursor=${encodeURIComponent(cursor)}`,{user}); }
  async function collect(section,manifestResult,user='client-a') {
    let cursor=manifestResult.sections.find(row=>row.section===section).start_cursor, items=[],pages=0;
    do {const result=await page(section,cursor,user);assert.equal(result.status,200);const data=await result.json();assert.equal(data.section_complete,data.next_cursor===null);assert.equal(data.as_of,manifestResult.as_of);assert.equal(data.export_id,manifestResult.export_id);assert.ok(data.items.length<=PAGE_SIZE);items.push(...data.items);cursor=data.next_cursor;pages++;} while(cursor && pages<100);
    assert.equal(cursor,null);return {items,pages};
  }
  return {db,env,protection,decryptions,call,manifest,page,collect,seed,setNow:value=>{now=value;},get resolverCalls(){return resolverCalls;}};
}

test('personal export manifest explicitly states every section, attachment scope and live-value cutoff',async()=>{
  const h=await fixture(), data=await h.manifest();
  assert.deepEqual(data.sections.map(row=>row.section),SECTIONS);assert.equal(data.page_size,50);
  assert.equal(data.scope,'authenticated_account_and_own_customer_orders');assert.equal(data.as_of,START);
  assert.equal(Date.parse(data.expires_at)-Date.parse(data.as_of),CURSOR_TTL_MS);
  assert.equal(data.consistency.mode,'created_at_cutoff_with_live_values');assert.match(data.consistency.description,/not a point-in-time/);
  assert.equal(data.attachments.file_bytes_included,false);assert.equal(data.sections.find(row=>row.section==='orders').observed_count,2);
  assert.doesNotMatch(JSON.stringify(data),/auth-subject|FOREIGN-CLIENT-SECRET|PRIVATE-R2-KEY|INTERNAL/);
});
test('keyset pagination returns all 123 owned rows once, including rows with identical timestamps',async()=>{
  const h=await fixture(123), data=await h.manifest();
  for(const section of ['favorites','orders','events','messages','files']) {
    const {items,pages}=await h.collect(section,data);assert.equal(items.length,123,section);assert.equal(pages,3,section);
    assert.equal(new Set(items.map(item=>item.id || item.key)).size,123,section);
    assert.doesNotMatch(JSON.stringify(items),/FOREIGN-CLIENT-SECRET|INTERNAL|PRIVATE-R2-KEY|content_ciphertext|auth_subject|author_user_id|uploaded_by|created_by|client_user_id/);
  }
  assert.ok(h.db.calls.some(call=>call.sql.includes('LIMIT ?') && call.args.at(-1)===51));
  assert.ok(h.db.calls.filter(call=>call.sql.includes('LIMIT ?')).every(call=>!call.sql.includes('OFFSET')));
  assert.ok(h.decryptions.filter(aad=>aad.startsWith('portal:event:')).every(aad=>!aad.endsWith(id(20001))));
});
test('account and encrypted profile expose allowlisted personal fields, never credentials or embedded roles',async()=>{
  const h=await fixture(), data=await h.manifest();
  const account=(await h.collect('account',data)).items, profile=(await h.collect('profile',data)).items;
  assert.deepEqual(account,[{id:'client-a',auth_provider:'email',created_at:T0,updated_at:T0,email_verified:true}]);
  assert.deepEqual(profile,[{name:'Client A',email:'private-a@example.test',phone:'+48123456789',created_at:T0,updated_at:T0}]);
  assert.doesNotMatch(JSON.stringify({account,profile}),/auth_issuer|auth_subject|SECRET-NOT-EXPORTED|role|ciphertext|token|password/);
});
test('messages contain the whole own conversation and files contain only authenticated metadata links',async()=>{
  const h=await fixture(), data=await h.manifest();
  const messages=(await h.collect('messages',data)).items, files=(await h.collect('files',data)).items;
  assert.equal(messages[0].author,'owner');assert.equal(messages[0].text,'A message 1');
  assert.equal(files[0].download_url,`/api/portal/orders/${id(1)}/files/${id(30001)}`);
  assert.doesNotMatch(JSON.stringify(files),/object_key|PRIVATE-R2|https:\/\/|sha256|visibility|uploaded_by/);
  assert.equal(files[0].filename,'A-document-1.pdf');
});
test('the owner export is personal and cannot collect all customers through an administrative role',async()=>{
  const h=await fixture(3), data=await h.manifest('owner');
  const orders=(await h.collect('orders',data,'owner')).items;
  assert.equal(orders.length,1);assert.equal(orders[0].id,id(2000));
  for(const section of ['events','messages','files','favorites']) assert.equal((await h.collect(section,data,'owner')).items.length,1);
  assert.equal((await h.call('',{user:'owner',headers:{'X-Test-AAL':'aal1'}})).status,403);
});
test('all client scopes apply before decoding private data, including zero matching rows',async()=>{
  const h=await fixture(), data=await h.manifest('client-b');
  for(const section of ['orders','events','messages','files']) {
    const {items}=await h.collect(section,data,'client-b');assert.equal(items.length,1);
    assert.equal(section==='orders'?items[0].id:items[0].order_id,id(1000));
  }
  assert.equal((await h.collect('profile',data,'client-b')).items.length,0);
  assert.ok(h.decryptions.every(aad=>!aad.includes(`:${id(1)}:`) && !aad.includes('profile:client-a')));
});
test('another account cannot replay a cursor and no export SELECT is issued for the rejected token',async()=>{
  const h=await fixture(), data=await h.manifest(), token=data.sections.find(row=>row.section==='messages').start_cursor;
  const before=h.db.calls.length, result=await h.page('messages',token,'client-b');
  assert.equal(result.status,400);assert.equal((await result.json()).error,'invalid_cursor');assert.equal(h.db.calls.length,before);
});
test('tampering, section swaps, malformed cursors and unknown parameters are rejected without reading rows',async()=>{
  const h=await fixture(), data=await h.manifest(), token=data.sections.find(row=>row.section==='orders').start_cursor;
  const before=h.db.calls.length;
  const changed=token.slice(0,30)+(token[30]==='A'?'B':'A')+token.slice(31);
  assert.equal((await h.page('orders',changed)).status,400);
  assert.equal((await h.page('files',token)).status,400);
  for(const query of ['?section=orders','?cursor=bad','?section=orders&cursor=bad','?section=ALL&cursor=bad','?user_id=client-b','?limit=500','?offset=0','?section=orders&section=files&cursor=bad','?cursor=bad&cursor=bad','?cursor='+'a'.repeat(9000)]) assert.equal((await h.call(query)).status,400,query.slice(0,80));
  assert.equal(h.db.calls.length,before);
});
test('cursor binding rejects a forged user, session times and unbounded last keys even with a valid test key',async()=>{
  const h=await fixture(), data=await h.manifest(), start=data.sections.find(row=>row.section==='orders').start_cursor;
  const original=JSON.parse(await h.protection.unprotect(start,'portal:export:client-a',h.env));
  const modifications=[{user_id:'client-b'},{section:'files'},{export_id:'external'},{as_of:'2027-01-01T00:00:00.000Z'},
    {expires_at:'2026-10-07T00:00:00.000Z'},{last_key:{created_at:T0,id:'a'.repeat(257)}},{last_key:{created_at:T0,id:'a\u0000'}}];
  const before=h.db.calls.length;
  for(const changes of modifications) {
    const token=await h.protection.protect(JSON.stringify({...original,...changes}),'portal:export:client-a',h.env);
    assert.equal((await h.page('orders',token)).status,400);
  }
  assert.equal(h.db.calls.length,before);
});
test('an injected cursor key is a bound SQL value and cannot escape ownership conditions',async()=>{
  const h=await fixture(), data=await h.manifest(), start=data.sections.find(row=>row.section==='orders').start_cursor;
  const original=JSON.parse(await h.protection.unprotect(start,'portal:export:client-a',h.env));
  const injection="' OR 1=1 --", token=await h.protection.protect(JSON.stringify({...original,last_key:{created_at:T0,id:injection}}),'portal:export:client-a',h.env);
  const result=await h.page('orders',token);assert.equal(result.status,200);const rows=(await result.json()).items;
  assert.ok(rows.every(row=>row.id===id(1) || row.id===id(2)));
  assert.ok(h.db.calls.at(-1).args.includes(injection));assert.ok(!h.db.calls.at(-1).sql.includes(injection));
});
test('pagination retains the original cutoff and expiry rather than including newly created records',async()=>{
  const h=await fixture(51), data=await h.manifest(), start=data.sections.find(row=>row.section==='orders').start_cursor;
  const first=await (await h.page('orders',start)).json();assert.equal(first.items.length,50);
  h.setNow('2026-10-06T06:05:00.000Z');await h.seed('client-a',500,'2026-10-06T06:04:00.000Z');
  const second=await (await h.page('orders',first.next_cursor)).json();assert.equal(second.items.length,1);assert.equal(second.items[0].id,id(51));
  assert.equal(second.as_of,data.as_of);assert.equal(second.expires_at,data.expires_at);assert.equal(second.section_complete,true);
  h.setNow(data.expires_at);const expired=await h.page('orders',start);assert.equal(expired.status,410);assert.equal((await expired.json()).error,'export_expired');
});
test('existing edits remain visible and the response declares this instead of claiming a frozen snapshot',async()=>{
  const h=await fixture(), data=await h.manifest();
  h.db.db.prepare('UPDATE import_orders SET location=?,updated_at=? WHERE id=?').run('New verified port','2026-10-06T06:05:00.000Z',id(1));
  const orders=(await h.collect('orders',data)).items;assert.equal(orders[0].location,'New verified port');
  assert.equal(orders[0].updated_at,'2026-10-06T06:05:00.000Z');assert.match(data.consistency.description,/edits/i);
});
test('corrupt encrypted private records fail closed with no partial export or cryptographic details',async()=>{
  const h=await fixture(), data=await h.manifest();
  h.db.db.prepare('UPDATE import_order_messages SET content_ciphertext=? WHERE id=?').run('invalid-private-cipher',id(50002));
  const result=await h.page('messages',data.sections.find(row=>row.section==='messages').start_cursor);
  assert.equal(result.status,503);assert.deepEqual(await result.json(),{ok:false,error:'unavailable'});
});
test('inactive portal, schema, auth, crypto and canonical origins fail closed before sessions or SQL',async()=>{
  const h=await fixture(), original={...h.env};
  for(const key of ['REXBID_PORTAL_ENABLED','REXBID_PORTAL_SCHEMA_VERSION','AUTH_ENABLED','REXBID_OWNER_USER_ID','REXBID_PORTAL_DATA_KEYS','REXBID_PORTAL_ACTIVE_KEY_ID','REXBID_DB','AUTH_CANONICAL_ORIGIN','AUTH_ALLOWED_ORIGINS']) {
    delete h.env[key];assert.equal((await h.call()).status,503,key);Object.assign(h.env,original);
  }
  for(const host of ['https://evil.rexbid.pl','https://rexbid.pl.evil.test','http://rexbid.pl']) assert.equal((await h.call('',{host})).status,503);
  assert.equal(h.resolverCalls,0);assert.equal(h.db.calls.length,0);
});
test('same-origin reads refuse cross-origin or cross-site fetches and mutating methods before authentication',async()=>{
  const h=await fixture();
  for(const options of [{origin:'https://evil.test'},{headers:{'Sec-Fetch-Site':'cross-site'}},{headers:{'Sec-Fetch-Site':'same-site'}}]) assert.equal((await h.call('',options)).status,403);
  for(const method of ['POST','PATCH','DELETE','HEAD','OPTIONS']) assert.equal((await h.call('',{method})).status,405);
  assert.equal(h.resolverCalls,0);assert.equal(h.db.calls.length,0);
  assert.equal((await h.call('',{origin:null,headers:{'Sec-Fetch-Site':'none'}})).status,200);
});
test('unauthenticated export preserves cookie rotation and enforces private/noindex response headers',async()=>{
  const h=await fixture(), result=await h.call('',{user:null});
  assert.equal(result.status,401);assert.equal(h.db.calls.length,0);assert.match(result.headers.get('Set-Cookie'),/Secure; HttpOnly/);
  assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal(result.headers.get('X-Robots-Tag'),'noindex, nofollow, noarchive');
  assert.equal(result.headers.get('Vary'),'Cookie');assert.equal(result.headers.get('Cross-Origin-Resource-Policy'),'same-origin');assert.equal(result.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(await createPortalExportHandler()(new Request(`${ORIGIN}/other`),{}),null);
});
