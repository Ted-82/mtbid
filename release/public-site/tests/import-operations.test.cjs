'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {webcrypto} = require('node:crypto');
const {createImportPortalHandler,STAGES} = require('../portal/operations.cjs');
const root = path.resolve(__dirname,'..');
const ORIGIN = 'https://rexbid.pl';

class LocalD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec(fs.readFileSync(path.join(root,'docs/proposals/0003_accounts_foundation.sql'),'utf8'));
    this.db.exec(fs.readFileSync(path.join(root,'docs/proposals/0006_import_operations.sql'),'utf8'));
    this.db.exec(fs.readFileSync(path.join(root,'docs/proposals/0007_portal_message_reads.sql'),'utf8'));
    for (const id of ['owner','client-a','client-b','unverified']) this.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(id,'https://provider.test',id,'email',id==='unverified'?0:1,'2026-10-06T00:00:00Z','2026-10-06T00:00:00Z');
    this.calls = [];
  }
  prepare(sql) {
    this.calls.push(sql); const statement = this.db.prepare(sql); let args=[];
    return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){const result=statement.run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {const results=[];for(const statement of statements)results.push(await statement.run());this.db.exec('COMMIT');return results;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
async function harness(options={}) {
  const db = new LocalD1(), key = await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const encoder = new TextEncoder(); let decryptions=0, resolverCalls=0;
  async function protect(clear,aad) {
    const iv=webcrypto.getRandomValues(new Uint8Array(12));
    const bytes=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,encoder.encode(clear));
    return `${Buffer.from(iv).toString('base64url')}.${Buffer.from(bytes).toString('base64url')}`;
  }
  async function unprotect(cipher,aad) {
    decryptions++;const [iv,bytes]=cipher.split('.');
    return new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url'),additionalData:encoder.encode(aad)},key,Buffer.from(bytes,'base64url')));
  }
  const env={REXBID_PORTAL_ENABLED:'enabled',REXBID_PORTAL_SCHEMA_VERSION:'0006',AUTH_ENABLED:'true',REXBID_OWNER_USER_ID:'owner',AUTH_CANONICAL_ORIGIN:ORIGIN,AUTH_ALLOWED_ORIGINS:ORIGIN,REXBID_DB:db};
  const files={uploads:[],downloads:[],removes:[],configured:()=>true,async upload({fileId,order}){this.uploads.push(fileId);return {object_key:`private/${order.id}/${fileId}`,filename:'invoice.pdf',content_type:'application/pdf',size_bytes:8,sha256:'a'.repeat(64),visibility:'client'};},async download({file}){this.downloads.push(file.id);return new Response('PRIVATE PDF',{headers:{'Content-Type':'application/pdf'}});},async remove({objectKey}){this.removes.push(objectKey);}};
  const handler=createImportPortalHandler({cryptoImpl:webcrypto,protect,unprotect,protectionConfigured:()=>true,attachmentService:files,now:()=>new Date().toISOString(),
    resolveAccount:async request=>{resolverCalls++;const user=request.headers.get('Cookie')?.match(/user=([^;]+)/)?.[1];return {user:user?{id:user,role:'owner'}:null,cookies:['__Host-test=updated; Secure; HttpOnly; Path=/'],status:user?200:401,assurance_level:request.headers.get('X-Test-AAL')||'aal2'};},
    makeReplyDraft:({kind,order})=>({subject:`REXBID ${order.title}`,body:`${kind}: ${order.status}`}),...options});
  async function call(route,body,requestOptions={}) {
    const {user='owner',method=body===undefined?'GET':'POST',origin=env.AUTH_CANONICAL_ORIGIN,aal,headers:extraHeaders={},host=env.AUTH_CANONICAL_ORIGIN}=requestOptions;
    const headers=new Headers(extraHeaders);if(user)headers.set('Cookie',`user=${user}`);if(origin)headers.set('Origin',origin);if(aal)headers.set('X-Test-AAL',aal);
    if(body!==undefined)headers.set('Content-Type','application/json');
    return handler(new Request(`${host}/api/portal${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
  }
  async function create(client='client-a',details={}) {const result=await call('/orders',{client_user_id:client,title:'2020 Tesla Model 3',lot:'62674546',platform:'copart',...details});assert.equal(result.status,201);return (await result.json()).order;}
  return {db,env,files,call,create,protect,unprotect,get decryptions(){return decryptions;},get resolverCalls(){return resolverCalls;}};
}

async function seedOrderLists(h,order,{events=0,messages=0,files=0,visibility='client',createdAt='2026-10-04T00:00:00.000Z'}={}) {
  for(let index=0;index<events;index++) {
    const id=webcrypto.randomUUID(),cipher=await h.protect(JSON.stringify({message:`${visibility} event ${index}`}),`portal:event:${order.id}:${id}`);
    h.db.db.prepare('INSERT INTO import_order_events (id,order_id,event_type,visibility,status,content_ciphertext,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,order.id,'note',visibility,'preparation',cipher,'owner',createdAt);
  }
  for(let index=0;index<messages;index++) {
    const id=webcrypto.randomUUID(),cipher=await h.protect(`Client question ${index}`,`portal:message:${order.id}:${id}`);
    h.db.db.prepare('INSERT INTO import_order_messages VALUES (?,?,?,?,?,?)').run(id,order.id,'client-a','client',cipher,createdAt);
  }
  for(let index=0;index<files;index++) {
    const id=webcrypto.randomUUID();
    h.db.db.prepare('INSERT INTO import_order_files VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,order.id,`private/${order.id}/${id}`,`${visibility}-document-${index}.pdf`,'application/pdf',10,'a'.repeat(64),visibility,'owner',createdAt);
  }
}

test('portal schema is additive and does not alter existing account tables',()=>{
  const sql=fs.readFileSync(path.join(root,'docs/proposals/0006_import_operations.sql'),'utf8');
  assert.doesNotMatch(sql,/\b(?:ALTER|DROP|DELETE|UPDATE)\s+(?:TABLE\s+)?users\b/i);
  const db=new LocalD1();assert.equal(db.db.prepare('SELECT COUNT(*) n FROM users').get().n,4);
});
test('portal is disabled without explicit schema, auth and owner configuration',async()=>{
  const h=await harness();
  for(const key of ['REXBID_PORTAL_ENABLED','REXBID_PORTAL_SCHEMA_VERSION','AUTH_ENABLED','REXBID_OWNER_USER_ID']){
    const saved=h.env[key];delete h.env[key];assert.equal((await (await h.call('/config')).json()).enabled,false);assert.equal((await h.call('/orders')).status,503);h.env[key]=saved;
  }
  assert.equal(h.resolverCalls,0);
});
test('missing encryption configuration fails closed before auth or reading private records',async()=>{
  const h=await harness({protectionConfigured:()=>false});
  assert.deepEqual(await (await h.call('/config')).json(),{ok:true,enabled:false,uploads_enabled:false});
  assert.equal((await h.call('/orders')).status,503);assert.equal(h.resolverCalls,0);
});
test('owner configuration rejects whitespace, controls and unbounded identifiers before session or SQL',async()=>{
  const h=await harness();
  for(const id of [' owner','owner ','own er','owner\n','owner\u0000','a'.repeat(81)]) {
    h.env.REXBID_OWNER_USER_ID=id;
    assert.equal((await (await h.call('/config')).json()).enabled,false);
    assert.equal((await h.call('/orders')).status,503);
  }
  assert.equal(h.resolverCalls,0);
});
test('exact HTTPS canonical origin is required; suffix and sibling hosts cannot activate portal',async()=>{
  const h=await harness();
  for(const host of ['https://evil.rexbid.pl','https://rexbid.pl.evil.test','http://rexbid.pl'])assert.equal((await h.call('/orders',undefined,{host})).status,503);
  assert.equal(h.resolverCalls,0);
});
test('anonymous requests get no order data and secure cookie updates are forwarded',async()=>{
  const h=await harness();const result=await h.call('/orders',undefined,{user:null});
  assert.equal(result.status,401);assert.equal((await result.json()).error,'unauthorized');assert.match(result.headers.get('Set-Cookie'),/HttpOnly/);
});
test('only configured owner gets administration; signed aal2 required even with staging test flags',async()=>{
  const h=await harness();
  assert.equal((await h.call('/orders',{client_user_id:'client-a',title:'T',lot:'123',platform:'copart'},{user:'client-a'})).status,403);
  assert.equal((await h.call('/orders',undefined,{aal:'aal1'})).status,403);
  h.env.REXBID_PORTAL_ALLOW_AAL1_TEST='enabled';h.env.REXBID_AUTH_TEST_UI='enabled';h.env.REXBID_AUTH_TEST_HOST='rexbid-auth-test.tedn828.workers.dev';h.env.AUTH_RATE_LIMITING_MODE='staging-bypass';
  assert.equal((await h.call('/orders',undefined,{aal:'aal1'})).status,403);
  const stage='https://rexbid-auth-test.tedn828.workers.dev';h.env.AUTH_CANONICAL_ORIGIN=stage;h.env.AUTH_ALLOWED_ORIGINS=stage;
  assert.equal((await h.call('/orders',undefined,{aal:'aal1'})).status,403);
  assert.equal((await h.call('/orders',undefined,{aal:'aal2'})).status,200);
});
test('same-origin writes reject missing/cross origin and cross-site fetch before auth or SQL',async()=>{
  const h=await harness();
  for(const options of [{origin:null},{origin:'https://evil.test'},{headers:{'Sec-Fetch-Site':'cross-site'}}])assert.equal((await h.call('/profile',{name:'Client'},options)).status,403);
  assert.equal(h.resolverCalls,0);assert.equal(h.db.db.prepare('SELECT COUNT(*) n FROM portal_customer_profiles').get().n,0);
});
test('owner creates order only for verified registered client and forbids mass-assignment',async()=>{
  const h=await harness();const base={client_user_id:'client-a',title:'T',lot:'123',platform:'copart'};
  for(const changes of [{client_user_id:'missing'},{client_user_id:'unverified'},{status:'delivered'},{created_by:'client-a'},{role:'owner'},{vin:'bad'},{platform:'other'},{lot:null}])assert.equal((await h.call('/orders',{...base,...changes})).status,400);
  const order=await h.create();assert.equal(order.status,'preparation');assert.equal(order.version,1);assert.equal(order.client_user_id,'client-a');
});
test('clients see only own orders and safe DTO without other account identifiers',async()=>{
  const h=await harness();const a=await h.create(),b=await h.create('client-b');
  const list=await (await h.call('/orders',undefined,{user:'client-a'})).json();assert.equal(list.orders.length,1);assert.equal(list.orders[0].id,a.id);assert.equal(Object.hasOwn(list.orders[0],'client_user_id'),false);
  const detail=await (await h.call(`/orders/${a.id}`,undefined,{user:'client-a'})).json();assert.equal(detail.order.id,a.id);assert.doesNotMatch(JSON.stringify(detail),/created_by|content_ciphertext|client-b|auth_subject|last_change_id/);
  const before=h.decryptions;const foreign=await h.call(`/orders/${b.id}`,undefined,{user:'client-a'}),unknown=await h.call('/orders/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',undefined,{user:'client-a'});
  assert.equal(foreign.status,404);assert.equal(unknown.status,404);assert.deepEqual(await foreign.json(),await unknown.json());assert.equal(h.decryptions,before);
});
test('pagination is bounded and SQL injection is passed only as a bound account value',async()=>{
  const h=await harness();await h.create();
  for(const route of ['/orders?limit=0','/orders?limit=51','/orders?offset=10001','/orders?limit=1%20OR%201=1'])assert.equal((await h.call(route)).status,400);
  const result=await (await h.call('/orders',undefined,{user:"client-a' OR 1=1 --"})).json();assert.equal(result.orders.length,0);
  const limit=await (await h.call('/orders?limit=1')).json();assert.equal(limit.pagination.limit,1);
});
test('optimistic update changes order and timeline atomically; stale version adds no false event',async()=>{
  const h=await harness();const order=await h.create();
  const update={expected_version:1,status:'at_sea',location:'Ocean transport',estimated_arrival_at:'2026-11-10T12:00:00Z',vessel:'REAL VESSEL',container_number:'REAL CONTAINER',event_message:'Loaded as confirmed by partner'};
  const results=await Promise.all([h.call(`/orders/${order.id}`,update,{method:'PATCH'}),h.call(`/orders/${order.id}`,update,{method:'PATCH'})]);assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  assert.equal(h.db.db.prepare('SELECT version,status FROM import_orders WHERE id=?').get(order.id).version,2);assert.equal(h.db.db.prepare('SELECT COUNT(*) n FROM import_order_events WHERE order_id=?').get(order.id).n,2);
});
test('internal notes are invisible including counts, version and updated timestamp',async()=>{
  const h=await harness();const order=await h.create();const before=await (await h.call(`/orders/${order.id}`,undefined,{user:'client-a'})).json();
  assert.equal((await h.call(`/orders/${order.id}`,{expected_version:1,event_message:'Internal cost negotiation',event_visibility:'internal'},{method:'PATCH'})).status,200);
  const after=await (await h.call(`/orders/${order.id}`,undefined,{user:'client-a'})).json();assert.deepEqual(after,before);
  const owner=await (await h.call(`/orders/${order.id}`)).json();assert.equal(owner.events.length,2);assert.ok(owner.events.some(event=>event.visibility==='internal'));
  assert.equal((await h.call(`/orders/${order.id}`,{expected_version:1,status:'delivered',event_visibility:'internal'},{method:'PATCH'})).status,400);
});
test('client cannot alter state, assign owner/client or rewrite order attributes',async()=>{
  const h=await harness();const order=await h.create();
  assert.equal((await h.call(`/orders/${order.id}`,{expected_version:1,status:'delivered'},{user:'client-a',method:'PATCH'})).status,403);
  for(const changes of [{client_user_id:'client-b'},{created_by:'client-a'},{version:10},{title:'new'},{status:'fake'},{expected_version:'1'}])assert.equal((await h.call(`/orders/${order.id}`,{expected_version:1,...changes},{method:'PATCH'})).status,400);
  assert.equal((await h.call(`/orders/${order.id}`,{expected_version:1,estimated_arrival_at:'2026-02-30T12:00:00Z'},{method:'PATCH'})).status,400);
});
test('private messages and event text are encrypted in SQLite and tied to order/id AAD',async()=>{
  const h=await harness();const order=await h.create();
  const text='<img src=x onerror=alert(1)> Private question';const sent=await h.call(`/orders/${order.id}/messages`,{text},{user:'client-a'});assert.equal(sent.status,201);
  const stored=h.db.db.prepare('SELECT * FROM import_order_messages').get();assert.doesNotMatch(stored.content_ciphertext,/Private question|img src/);assert.equal(Object.hasOwn(stored,'text'),false);
  await assert.rejects(h.unprotect(stored.content_ciphertext,`portal:message:${order.id}:wrong-id`));
  const dto=await (await h.call(`/orders/${order.id}/messages`,undefined,{user:'client-a'})).json();assert.equal(dto.messages[0].text,text);assert.equal(dto.messages[0].author,'client');assert.equal(Object.hasOwn(dto.messages[0],'author_user_id'),false);
  const event=h.db.db.prepare('SELECT * FROM import_order_events').get();assert.doesNotMatch(event.content_ciphertext,/Utworzono/);
});
test('foreign message posting is a uniform 404 and does not write or decrypt',async()=>{
  const h=await harness();const order=await h.create('client-b');const before=h.decryptions;
  assert.equal((await h.call(`/orders/${order.id}/messages`,{text:'unauthorized'},{user:'client-a'})).status,404);
  assert.equal(h.db.db.prepare('SELECT COUNT(*) n FROM import_order_messages').get().n,0);assert.equal(h.decryptions,before);
});

test('saved sender follows authenticated account across both panels and cannot be spoofed or inferred from text',async()=>{
  const h=await harness(), order=await h.create();
  const route=`/orders/${order.id}/messages`, text='REXBID Klient: ta sama treść';
  for(const [user,view,role] of [['owner','panel','owner'],['owner','administracja','owner'],['client-a','panel','client']]) {
    const response=await h.call(route,{text},{user,headers:{Referer:`${ORIGIN}/${view}`}});
    assert.equal(response.status,201);const message=(await response.json()).message;
    assert.equal(message.author,role);
    const row=h.db.db.prepare('SELECT author_user_id,author_role FROM import_order_messages WHERE id=?').get(message.id);
    assert.equal(row.author_user_id,user);assert.equal(row.author_role,role);
  }
  const before=h.db.db.prepare('SELECT COUNT(*) n FROM import_order_messages').get().n;
  for(const fields of [{author:'owner'},{author_role:'owner'},{role:'owner'},{author_user_id:'owner'}]) {
    assert.equal((await h.call(route,{text,...fields},{user:'client-a'})).status,400);
  }
  assert.equal(h.db.db.prepare('SELECT COUNT(*) n FROM import_order_messages').get().n,before);
  for(const user of ['owner','client-a']) {
    const detail=await (await h.call(`/orders/${order.id}`,undefined,{user})).json();
    assert.equal(detail.messages.filter(message=>message.author==='owner').length,2);
    assert.equal(detail.messages.filter(message=>message.author==='client').length,1);
    assert.ok(detail.messages.every(message=>message.text===text));
    assert.ok(detail.messages.every(message=>!Object.hasOwn(message,'author_user_id')));
  }
  assert.equal((await h.call(route,{text},{user:'client-b'})).status,404);
  assert.equal((await h.call('/clients',undefined,{user:'client-a'})).status,403);
  assert.equal((await h.call(`/orders/${order.id}`,{expected_version:1,event_message:'forged admin'},{user:'client-a',method:'PATCH'})).status,403);
});
test('optional profile contact details stay encrypted and cannot target another user',async()=>{
  const h=await harness();assert.equal((await h.call('/profile',{name:'Anna',email:'anna@example.test',phone:'+48 123 456 789'},{user:'client-a'})).status,200);
  const row=h.db.db.prepare('SELECT * FROM portal_customer_profiles').get();assert.equal(row.user_id,'client-a');assert.doesNotMatch(row.content_ciphertext,/Anna|anna@example|123 456/);
  const mine=await (await h.call('/profile',undefined,{user:'client-a'})).json();assert.equal(mine.profile.name,'Anna');
  assert.equal((await (await h.call('/profile',undefined,{user:'client-b'})).json()).profile,null);
  assert.equal((await h.call('/profile',{name:'hack',user_id:'client-b'},{user:'client-a'})).status,400);
  assert.equal((await h.call('/clients',undefined,{user:'client-a'})).status,403);
  const clients=await (await h.call('/clients')).json();assert.equal(clients.clients.find(client=>client.id==='client-a').profile.email,'anna@example.test');assert.equal(clients.clients.some(client=>client.id==='unverified'),false);assert.equal(clients.clients.find(client=>client.id==='owner').account_type,'owner');assert.equal(clients.clients.find(client=>client.id==='client-a').account_type,'client');
});
test('private files authorize order and visibility before storage access',async()=>{
  const h=await harness();const order=await h.create();
  const upload=await h.call(`/orders/${order.id}/files`,{test:'adapter stub'});assert.equal(upload.status,201);const file=(await upload.json()).file;
  assert.equal((await h.call(`/orders/${order.id}/files/${file.id}`,undefined,{user:'client-b'})).status,404);assert.equal(h.files.downloads.length,0);
  const allowed=await h.call(`/orders/${order.id}/files/${file.id}`,undefined,{user:'client-a'});assert.equal(allowed.status,200);assert.equal(await allowed.text(),'PRIVATE PDF');assert.match(allowed.headers.get('Cache-Control'),/no-store/);
  h.db.db.prepare("UPDATE import_order_files SET visibility='internal' WHERE id=?").run(file.id);
  const hidden=await (await h.call(`/orders/${order.id}/files`,undefined,{user:'client-a'})).json();assert.equal(hidden.files.length,0);
  const calls=h.files.downloads.length;assert.equal((await h.call(`/orders/${order.id}/files/${file.id}`,undefined,{user:'client-a'})).status,404);assert.equal(h.files.downloads.length,calls);
  assert.equal((await h.call(`/orders/${order.id}/files`,{test:'x'},{user:'client-a'})).status,403);
});
test('attachment failure cleanup receives only private object key and leaks no SQL failure',async()=>{
  const h=await harness();const order=await h.create();h.files.upload=async()=>({object_key:'duplicate',filename:'file.pdf',content_type:'application/pdf',size_bytes:9,sha256:'a'.repeat(64),visibility:'client'});
  assert.equal((await h.call(`/orders/${order.id}/files`,{test:'x'})).status,201);
  const failed=await h.call(`/orders/${order.id}/files`,{test:'x'});assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{ok:false,error:'unavailable'});assert.deepEqual(h.files.removes,['duplicate']);
});
test('reply drafts are owner only, use actual stored facts and never send email',async()=>{
  const h=await harness();const order=await h.create();
  assert.equal((await h.call(`/orders/${order.id}/reply-draft`,undefined,{user:'client-a'})).status,403);
  const result=await (await h.call(`/orders/${order.id}/reply-draft?kind=status_update`)).json();assert.match(result.draft.body,/preparation/);
  assert.equal((await h.call(`/orders/${order.id}/reply-draft?kind=unapproved`)).status,400);assert.equal(STAGES.length,11);
});
test('large streamed JSON and unexpected fields are rejected without storing data',async()=>{
  const h=await harness();const order=await h.create();
  assert.equal((await h.call(`/orders/${order.id}/messages`,{text:'a'.repeat(17000)},{user:'client-a'})).status,400);
  assert.equal((await h.call(`/orders/${order.id}/messages`,{text:'x',author_role:'owner'},{user:'client-a'})).status,400);
  assert.equal(h.db.db.prepare('SELECT COUNT(*) n FROM import_order_messages').get().n,0);
});
test('all private JSON responses deny shared caching and portal path match is exact',async()=>{
  const h=await harness();const result=await h.call('/orders');assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(result.headers.get('Vary'),'Cookie');
  const handler=createImportPortalHandler();assert.equal(await handler(new Request(`${ORIGIN}/api/portal-other/config`),{}),null);
});
test('order details announce remaining events, messages and files without decrypting lookahead rows',async()=>{
  const h=await harness(),order=await h.create();
  await seedOrderLists(h,order,{events:100,messages:51,files:51});
  await seedOrderLists(h,order,{events:120,files:60,visibility:'internal',createdAt:'2026-10-05T00:00:00.000Z'});
  const before=h.decryptions,result=await h.call(`/orders/${order.id}`,undefined,{user:'client-a'});assert.equal(result.status,200);
  const detail=await result.json();
  assert.deepEqual(detail.pagination,{events:{limit:100,offset:0,has_more:true},messages:{limit:50,offset:0,has_more:true},files:{limit:50,offset:0,has_more:true}});
  assert.equal(detail.events.length,100);assert.equal(detail.messages.length,50);assert.equal(detail.files.length,50);assert.equal(h.decryptions-before,150);
  assert.doesNotMatch(JSON.stringify(detail),/internal event|internal-document|private\//);
  const lastEvent=await (await h.call(`/orders/${order.id}/events?limit=50&offset=100`,undefined,{user:'client-a'})).json();
  assert.equal(lastEvent.events.length,1);assert.deepEqual(lastEvent.pagination,{limit:50,offset:100,has_more:false});
});
test('each list can paginate through every owned item and reports the terminal page accurately',async()=>{
  const h=await harness(),order=await h.create();
  await seedOrderLists(h,order,{events:100,messages:51,files:51});
  for(const [section,expected] of [['events',101],['messages',51],['files',51]]) {
    const ids=[];let offset=0,hasMore=true;
    while(hasMore) {
      const result=await h.call(`/orders/${order.id}/${section}?limit=50&offset=${offset}`,undefined,{user:'client-a'});assert.equal(result.status,200);
      const data=await result.json();assert.equal(data.pagination.offset,offset);assert.equal(data.pagination.limit,50);assert.ok(data[section].length<=50);
      ids.push(...data[section].map(row=>row.id));hasMore=data.pagination.has_more;offset+=data[section].length;assert.ok(offset<=expected);
    }
    assert.equal(ids.length,expected,section);assert.equal(new Set(ids).size,expected,section);
    const empty=await (await h.call(`/orders/${order.id}/${section}?limit=50&offset=${expected}`,undefined,{user:'client-a'})).json();
    assert.equal(empty[section].length,0);assert.equal(empty.pagination.has_more,false);
  }
});
test('internal records do not change client pagination, consume visible pages or leak through has_more',async()=>{
  const h=await harness(),order=await h.create();
  await seedOrderLists(h,order,{files:50});
  const beforeDetail=await (await h.call(`/orders/${order.id}`,undefined,{user:'client-a'})).json();
  const beforeEvents=await (await h.call(`/orders/${order.id}/events?limit=50`,undefined,{user:'client-a'})).json();
  const beforeFiles=await (await h.call(`/orders/${order.id}/files?limit=50`,undefined,{user:'client-a'})).json();
  assert.equal(beforeFiles.pagination.has_more,false);
  await seedOrderLists(h,order,{events:120,files:80,visibility:'internal',createdAt:'2026-10-05T00:00:00.000Z'});
  assert.deepEqual(await (await h.call(`/orders/${order.id}`,undefined,{user:'client-a'})).json(),beforeDetail);
  assert.deepEqual(await (await h.call(`/orders/${order.id}/events?limit=50`,undefined,{user:'client-a'})).json(),beforeEvents);
  assert.deepEqual(await (await h.call(`/orders/${order.id}/files?limit=50`,undefined,{user:'client-a'})).json(),beforeFiles);
  const owner=await (await h.call(`/orders/${order.id}/files?limit=50`)).json();assert.equal(owner.pagination.has_more,true);assert.equal(owner.files.length,50);assert.ok(owner.files.every(file=>file.visibility==='internal'));
});
test('all detail list routes validate pagination and preserve uniform foreign-order denial',async()=>{
  const h=await harness(),order=await h.create();
  for(const section of ['events','messages','files']) {
    for(const query of ['limit=0','limit=51','limit=1%20OR%201=1','offset=-1','offset=10001','offset=1.2']) assert.equal((await h.call(`/orders/${order.id}/${section}?${query}`,undefined,{user:'client-a'})).status,400);
    const before=h.decryptions,result=await h.call(`/orders/${order.id}/${section}?limit=50&offset=0`,undefined,{user:'client-b'});
    assert.equal(result.status,404);assert.deepEqual(await result.json(),{ok:false,error:'not_found'});assert.equal(h.decryptions,before);
    const own=await (await h.call(`/orders/${order.id}/${section}`,undefined,{user:'client-a'})).json();assert.equal(own.pagination.limit,20);assert.equal(own.pagination.offset,0);assert.equal(own.pagination.has_more,false);
  }
});
test('drafts read only client-visible sources before pagination and disclose remaining source pages',async()=>{
  let captured;
  const h=await harness({makeReplyDraft:input=>{captured=input;return {subject:'Actual order',body:'Review before sending'};}}),order=await h.create();
  await seedOrderLists(h,order,{files:51});
  await seedOrderLists(h,order,{events:150,files:80,visibility:'internal',createdAt:'2026-10-05T00:00:00.000Z'});
  const data=await (await h.call(`/orders/${order.id}/reply-draft?kind=documents_ready`)).json();
  assert.equal(captured.events.length,1);assert.equal(captured.files.length,50);assert.ok(captured.events.every(event=>event.visibility==='client'));assert.ok(captured.files.every(file=>file.visibility==='client'));
  assert.deepEqual(data.source_pagination,{events:{limit:100,offset:0,has_more:false},files:{limit:50,offset:0,has_more:true}});assert.equal(data.source_complete,false);
  assert.doesNotMatch(JSON.stringify(captured),/internal event|internal-document/);
});
test('payment draft finds an explicit older confirmation without trusting later stages or internal notes',async()=>{
  const h=await harness({makeReplyDraft:require('../portal/reply-drafts.cjs').makeReplyDraft}),order=await h.create();
  h.db.db.prepare("UPDATE import_orders SET status='at_sea' WHERE id=?").run(order.id);
  await seedOrderLists(h,order,{events:120});
  const paymentId=webcrypto.randomUUID(),internalId=webcrypto.randomUUID();
  for(const [id,visibility] of [[internalId,'internal'],[paymentId,'client']]) {
    const cipher=await h.protect(JSON.stringify({message:visibility==='client'?'Confirmed payment':'INTERNAL SECRET'}),`portal:event:${order.id}:${id}`);
    h.db.db.prepare("INSERT INTO import_order_events (id,order_id,event_type,visibility,status,content_ciphertext,created_by,created_at) VALUES (?,?,'update',?,'payment_confirmed',?,'owner','2026-01-01T00:00:00.000Z')").run(id,order.id,visibility,cipher);
    const result=await h.call(`/orders/${order.id}/reply-draft?kind=payment_received`);
    if(visibility==='internal') assert.equal(result.status,400);
    else {assert.equal(result.status,200);const data=await result.json();assert.equal(data.source_complete,false);assert.match(data.draft.body,/Płatność za pojazd została potwierdzona/);assert.doesNotMatch(JSON.stringify(data),/INTERNAL SECRET/);}
  }
});


test('read receipt migration is idempotent and preserves every existing portal row',async()=>{
  const h=await harness(),order=await h.create();await h.call('/orders/'+order.id+'/messages',{text:'Existing ciphertext'});
  const tables=['users','import_orders','import_order_events','import_order_messages','import_order_files','portal_customer_profiles'];
  const before=tables.map(table=>h.db.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
  const sql=fs.readFileSync(path.join(root,'migrations-staging/0007_portal_message_reads.sql'),'utf8');
  h.db.db.exec(sql);h.db.db.exec(sql);
  assert.deepEqual(tables.map(table=>h.db.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()),before);
  assert.equal(h.db.db.prepare('SELECT COUNT(*) n FROM import_order_message_reads').get().n,0);
  assert.deepEqual(h.db.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('unread state persists per client/team and reading does not rewrite order facts or sender history',async()=>{
  const h=await harness(),order=await h.create();
  const ownerMessage=(await (await h.call('/orders/'+order.id+'/messages',{text:'REXBID incoming'})).json()).message;
  const clientMessage=(await (await h.call('/orders/'+order.id+'/messages',{text:'Client incoming'},{user:'client-a'})).json()).message;
  const stored=h.db.db.prepare('SELECT * FROM import_orders WHERE id=?').get(order.id);
  const senderRows=h.db.db.prepare('SELECT * FROM import_order_messages ORDER BY id').all();
  for(const user of ['owner','client-a']){
    const response=await (await h.call('/orders',undefined,{user})).json();assert.equal(response.orders[0].unread_count,1);
    const detail=await (await h.call('/orders/'+order.id,undefined,{user})).json();assert.equal(detail.order.unread_count,1);
    assert.equal(detail.messages.filter(message=>message.unread).length,1);
    assert.equal(detail.messages.find(message=>message.unread).author,user==='owner'?'client':'owner');
  }
  assert.equal((await h.call('/orders/'+order.id+'/read',{message_ids:[ownerMessage.id]},{user:'client-a'})).status,200);
  assert.equal((await (await h.call('/orders/'+order.id,undefined,{user:'client-a'})).json()).order.unread_count,0);
  assert.equal((await (await h.call('/orders/'+order.id)).json()).order.unread_count,1);
  assert.equal((await h.call('/orders/'+order.id+'/read',{message_ids:[clientMessage.id]})).status,200);
  assert.equal((await (await h.call('/orders',undefined,{user:'owner'})).json()).orders[0].unread_count,0);
  assert.deepEqual(h.db.db.prepare('SELECT audience FROM import_order_message_reads ORDER BY audience').all().map(row=>row.audience),['client','team']);
  assert.deepEqual(h.db.db.prepare('SELECT * FROM import_orders WHERE id=?').get(order.id),stored);
  assert.deepEqual(h.db.db.prepare('SELECT * FROM import_order_messages ORDER BY id').all(),senderRows);
});

test('a late same-timestamp incoming message remains unread and acknowledgements are idempotent',async()=>{
  const h=await harness({now:()=> '2026-10-07T12:00:00.000Z'}),order=await h.create();
  const first=(await (await h.call('/orders/'+order.id+'/messages',{text:'First incoming'})).json()).message;
  await h.call('/orders/'+order.id,undefined,{user:'client-a'});
  const late=(await (await h.call('/orders/'+order.id+'/messages',{text:'Late incoming'})).json()).message;
  assert.equal(first.created_at,late.created_at);
  for(let attempt=0;attempt<2;attempt++){
    const response=await (await h.call('/orders/'+order.id+'/read',{message_ids:[first.id]},{user:'client-a'})).json();
    assert.equal(response.unread_count,1);assert.deepEqual(response.read_message_ids,[first.id]);
  }
  const detail=await (await h.call('/orders/'+order.id,undefined,{user:'client-a'})).json();
  assert.equal(detail.messages.find(message=>message.id===late.id).unread,true);
  assert.equal(detail.messages.find(message=>message.id===first.id).unread,false);
  assert.equal(h.db.db.prepare('SELECT COUNT(*) n FROM import_order_message_reads').get().n,1);
});

test('read receipts require owned order, incoming message, same origin and owner AAL2 without decryption',async()=>{
  const h=await harness(),a=await h.create(),b=await h.create('client-b');
  const own=(await (await h.call('/orders/'+a.id+'/messages',{text:'Owner incoming'})).json()).message;
  const foreign=(await (await h.call('/orders/'+b.id+'/messages',{text:'Other incoming'})).json()).message;
  const before=h.decryptions,route='/orders/'+a.id+'/read';
  for(const body of [{message_ids:[]},{message_ids:[own.id,own.id]},{message_ids:[foreign.id]},{message_ids:[own.id],audience:'team'},{message_ids:['bad']},{message_ids:Array.from({length:51},()=>webcrypto.randomUUID())}])assert.equal((await h.call(route,body,{user:'client-a'})).status,400);
  assert.equal((await h.call(route,{message_ids:[own.id]})).status,400);
  assert.equal((await h.call('/orders/'+b.id+'/read',{message_ids:[foreign.id]},{user:'client-a'})).status,404);
  assert.equal((await h.call(route,{message_ids:[own.id]},{user:null})).status,401);
  assert.equal((await h.call(route,{message_ids:[own.id]},{aal:'aal1'})).status,403);
  assert.equal((await h.call(route,{message_ids:[own.id]},{user:'client-a',origin:'https://evil.test'})).status,403);
  assert.equal(h.decryptions,before);assert.equal(h.db.db.prepare('SELECT COUNT(*) n FROM import_order_message_reads').get().n,0);
});

test('unread counts include older incoming pages and marking the fetched page leaves older messages unread',async()=>{
  const h=await harness(),order=await h.create();await seedOrderLists(h,order,{messages:60});
  const detail=await (await h.call('/orders/'+order.id)).json();
  assert.equal(detail.order.unread_count,60);assert.equal(detail.messages.length,50);
  const read=await (await h.call('/orders/'+order.id+'/read',{message_ids:detail.messages.map(message=>message.id)})).json();
  assert.equal(read.unread_count,10);
  const page=await (await h.call('/orders/'+order.id+'/messages?limit=50&offset=50')).json();assert.equal(page.messages.filter(message=>message.unread).length,10);
  assert.equal((await (await h.call('/orders',undefined,{user:'client-a'})).json()).orders[0].unread_count,0);
});

test('stage evidence spans old confirmed events and excludes internal notes and inferred intermediate stages',async()=>{
  const h=await harness(),order=await h.create();
  await h.call('/orders/'+order.id,{expected_version:1,status:'at_sea',event_message:'Confirmed sailing'},{method:'PATCH'});
  await seedOrderLists(h,order,{events:110,visibility:'client',createdAt:'2027-01-01T00:00:00Z'});
  const id=webcrypto.randomUUID(),cipher=await h.protect(JSON.stringify({message:'Internal only'}),'portal:event:'+order.id+':'+id);
  h.db.db.prepare("INSERT INTO import_order_events (id,order_id,event_type,visibility,status,content_ciphertext,created_by,created_at) VALUES (?,?,'update','internal','payment_confirmed',?,'owner','2025-01-01T00:00:00Z')").run(id,order.id,cipher);
  for(const user of ['owner','client-a']){
    const detail=await (await h.call('/orders/'+order.id,undefined,{user})).json();
    assert.equal(detail.pagination.events.has_more,true);assert.deepEqual(detail.confirmed_stages,['preparation','at_sea']);
    assert.equal(detail.confirmed_stages.includes('loaded'),false);assert.equal(detail.confirmed_stages.includes('payment_confirmed'),false);
  }
});

test('owner list/detail shows saved contact profiles while client DTO never exposes another profile',async()=>{
  const h=await harness(),order=await h.create();
  await h.call('/profile',{name:'Anna Klient',email:'anna@example.test',phone:'+48 123 456 789'},{user:'client-a'});
  for(const route of ['/orders','/orders/'+order.id]){
    const body=await (await h.call(route)).json(),record=body.order||body.orders[0];assert.equal(record.client_profile.name,'Anna Klient');assert.equal(record.client_profile.email,'anna@example.test');
    const client=await (await h.call(route,undefined,{user:'client-a'})).json();assert.doesNotMatch(JSON.stringify(client),/client_profile|anna@example/);
  }
});
