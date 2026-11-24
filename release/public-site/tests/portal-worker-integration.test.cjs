const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {webcrypto}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const ORIGIN='https://rexbid.pl';
function fixture(t) {
  const sql=new DatabaseSync(':memory:'); t.after(()=>sql.close());
  sql.exec('PRAGMA foreign_keys=ON');
  for(const file of ['0003_accounts_foundation.sql','0006_import_operations.sql','0007_portal_message_reads.sql','0017_portal_file_deletions.sql']) sql.exec(fs.readFileSync(path.join(ROOT,'docs/proposals',file),'utf8'));
  for(const id of ['owner','client-a','client-b']) sql.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(id,'https://fixture.test',id,'email',1,'2026-10-06T00:00:00Z','2026-10-06T00:00:00Z');
  const db={prepare(query){const stmt=sql.prepare(query);let params=[];return {bind(...values){params=values;return this;},async first(){return stmt.get(...params)||null;},async all(){return {results:stmt.all(...params)};},async run(){return {success:true,meta:{changes:Number(stmt.run(...params).changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const objects=new Map(), logs=[], network=[], storage=[], mfa=[];
  const env={REXBID_DB:db,AUTH_ENABLED:'true',AUTH_CANONICAL_ORIGIN:ORIGIN,AUTH_ALLOWED_ORIGINS:ORIGIN,REXBID_PORTAL_ENABLED:'enabled',REXBID_PORTAL_SCHEMA_VERSION:'0006',REXBID_OWNER_USER_ID:'owner',REXBID_PORTAL_DATA_KEYS:JSON.stringify({test:Buffer.alloc(32,9).toString('base64url')}),REXBID_PORTAL_ACTIVE_KEY_ID:'test',REXBID_PORTAL_FILES_ENABLED:'enabled',REXBID_PRIVATE_FILES:{async put(key,bytes){storage.push('put');objects.set(key,Uint8Array.from(bytes));},async get(key){storage.push('get');const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;},async delete(key){storage.push('delete');objects.delete(key);}},ASSETS:{fetch:async request=>new Response(fs.readFileSync(path.join(ROOT,'public',new URL(request.url).pathname.includes('administracja')?'administracja.html':'panel.html'),'utf8'),{headers:{'Content-Type':'text/html'}})}};
  const accounts={...require('../auth/routes.js'),createAccountSessionResolver:()=>async request=>{
    // Test capability injection; real signed-cookie resolution is covered by
    // portal-session and owner-mfa tests, not this routing/storage harness.
    const user=request.headers.get('Cookie')?.match(/fixture=([^;]+)/)?.[1];
    return {user:user?{id:user}:null,status:user?200:401,cookies:[],assurance_level:request.headers.get('X-Fixture-AAL')||'aal2'};
  },createOwnerMfaHandler:()=>async request=>{
    if(new URL(request.url).pathname==='/api/portal/security'){mfa.push('security');return new Response(JSON.stringify({ok:true,fixture:'mfa'}),{headers:{'Content-Type':'application/json'}});}return null;
  }};
  const source=fs.readFileSync(path.join(ROOT,'worker.js'),'utf8')
    .replace('import apibaraModule from "./providers/apibara.js";','const apibaraModule=globalThis.__apibara;')
    .replace('import contract from "./providers/contract.js";','const contract=globalThis.__contract;')
    .replace('import authProviderModule from "./auth/supabase.js";','const authProviderModule=globalThis.__auth;')
    .replace('import accountsModule from "./auth/routes.js";','const accountsModule=globalThis.__accounts;')
    .replace('import providerBudgetModule from "./providers/request-budget.js";','const providerBudgetModule=globalThis.__budget;')
    .replace('import("./portal/worker-router.cjs")','Promise.resolve(globalThis.__portal)')
    .replace('export default {','globalThis.__worker = {');
  const context={URL,URLSearchParams,Request,Response,Headers,AbortController,crypto:webcrypto,__apibara:require('../providers/apibara.js'),__contract:require('../providers/contract.js'),__auth:require('../auth/supabase.js'),__accounts:accounts,__budget:require('../providers/request-budget.js'),__portal:require('../portal/worker-router.cjs'),fetch:async url=>{network.push(url);throw new Error('No external transport in integration fixture');},setTimeout,clearTimeout,console:{info:(label,event)=>logs.push([label,event]),warn:()=>{},error:()=>{}}};
  vm.createContext(context);vm.runInContext(source,context);
  const worker=context.__worker;
  async function call(route,{user='owner',method='GET',body,headers={}}={}) { return worker.fetch(new Request(ORIGIN+route,{method,headers:{Origin:ORIGIN,'Sec-Fetch-Site':'same-origin',...(user?{Cookie:`fixture=${user}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:(typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body))}),env); }
  return {worker,env,sql,objects,logs,network,storage,mfa,call};
}
test('Worker portal defaults disabled with private noindex headers and zero provider/storage traffic',async t=>{
  const f=fixture(t);delete f.env.REXBID_PORTAL_ENABLED;
  const config=await f.call('/api/portal/config',{user:null});assert.deepEqual(await config.json(),{ok:true,enabled:false,uploads_enabled:false});
  assert.equal((await f.call('/api/portal/orders',{user:null})).status,503);
  assert.match(config.headers.get('Cache-Control'),/private, no-store/);assert.match(config.headers.get('X-Robots-Tag'),/noindex/);
  assert.deepEqual(f.network,[]);assert.deepEqual(f.storage,[]);
});
test('Worker dispatches owner security before AAL2-only operations and rejects missing encryption configuration',async t=>{
  const f=fixture(t);
  const security=await f.call('/api/portal/security',{headers:{'X-Fixture-AAL':'aal1'}});assert.equal((await security.json()).fixture,'mfa');assert.equal(f.mfa.length,1);
  assert.equal((await f.call('/api/portal/orders',{headers:{'X-Fixture-AAL':'aal1'}})).status,403);
  delete f.env.REXBID_PORTAL_DATA_KEYS;
  assert.deepEqual(await (await f.call('/api/portal/config')).json(),{ok:true,enabled:false,uploads_enabled:false});
  assert.equal((await f.call('/api/portal/orders')).status,503);
});
test('integrated order upload encrypts R2 and checks client scope before decrypting or reading files',async t=>{
  const f=fixture(t);
  const created=await f.call('/api/portal/orders',{method:'POST',body:{client_user_id:'client-a',title:'2020 Tesla Model 3',lot:'62674546',platform:'copart'}});assert.equal(created.status,201);
  const order=(await created.json()).order;
  const uploaded=await f.call(`/api/portal/orders/${order.id}/files`,{method:'POST',body:'%PDF-1.7\nprivate-binary-marker\n%%EOF',headers:{'Content-Type':'application/pdf','X-File-Name':'Title.pdf','X-Visibility':'client'}});assert.equal(uploaded.status,201);
  const file=(await uploaded.json()).file;
  assert.equal(Buffer.from([...f.objects.values()][0]).includes(Buffer.from('private-binary-marker')),false);
  const before=f.storage.length;
  assert.equal((await f.call(file.download_url,{user:'client-b'})).status,404);assert.equal(f.storage.length,before);
  const downloaded=await f.call(file.download_url,{user:'client-a'});assert.match(await downloaded.text(),/private-binary-marker/);
  assert.match(downloaded.headers.get('Content-Disposition'),/^attachment;/);assert.equal(downloaded.headers.get('X-Content-Type-Options'),'nosniff');
  assert.deepEqual(f.network,[]);assert.doesNotMatch(JSON.stringify(f.logs),new RegExp(`${order.id}|${file.id}|private-binary-marker|Title.pdf`));
});
test('PDF JPEG PNG roundtrip and internal files stay isolated through the integrated Worker',async t=>{
  const f=fixture(t), {files}=require('./fixtures/portal-files.cjs');
  const order=(await (await f.call('/api/portal/orders',{method:'POST',body:{client_user_id:'client-a',title:'Synthetic attachment check',lot:'QA-FILES',platform:'copart'}})).json()).order;
  for(const source of files) {
    for(const visibility of ['client','internal']) {
      const response=await f.call(`/api/portal/orders/${order.id}/files`,{method:'POST',body:source.bytes,headers:{'Content-Type':source.type,'X-File-Name':encodeURIComponent(source.name),'X-Visibility':visibility}});
      assert.equal(response.status,201); const file=(await response.json()).file;
      const before=f.storage.length;
      for(const [user,status] of [[null,401],['client-b',404],...(visibility==='internal'?[['client-a',404]]:[])]) {
        assert.equal((await f.call(file.download_url,{user})).status,status);
        assert.equal(f.storage.length,before,'authorization must run before R2');
      }
      const result=await f.call(file.download_url,{user:visibility==='internal'?'owner':'client-a'});
      assert.equal(result.status,200); assert.equal(result.headers.get('Content-Type'),source.type);
      assert.deepEqual(Buffer.from(await result.arrayBuffer()),source.bytes);
      assert.match(result.headers.get('Content-Disposition'),/^attachment;/);
      assert.match(result.headers.get('Cache-Control'),/private, no-store/);
    }
  }
  await f.call(`/api/portal/orders/${order.id}`,{method:'PATCH',body:{expected_version:1,event_message:'PRIVATE INTERNAL NOTE',event_visibility:'internal'}});
  const client=await (await f.call(`/api/portal/orders/${order.id}`,{user:'client-a'})).json();
  assert.equal(client.files.length,3); assert.equal(client.events.length,1);
  assert.doesNotMatch(JSON.stringify(client),/PRIVATE INTERNAL|object_key|internal/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM import_order_files').get().n,6);
  assert.deepEqual(f.network,[]);
});

test('file mutations reject anonymous, other clients, AAL1 and CSRF before storage access',async t=>{
  const f=fixture(t), source=require('./fixtures/portal-files.cjs').files[0];
  const order=(await (await f.call('/api/portal/orders',{method:'POST',body:{client_user_id:'client-a',title:'Synthetic limits check',lot:'QA-LIMIT',platform:'copart'}})).json()).order;
  const route=`/api/portal/orders/${order.id}/files`;
  for(const [user,extra,status] of [[null,{},401],['client-b',{},404],['client-a',{},403],['owner',{'X-Fixture-AAL':'aal1'},403],['owner',{Origin:'https://other.example','Sec-Fetch-Site':'cross-site'},403]]) {
    assert.equal((await f.call(route,{user,method:'POST',body:source.bytes,headers:{'Content-Type':source.type,'X-File-Name':'test.pdf',...extra}})).status,status);
  }
  assert.deepEqual(f.storage,[]);
  assert.equal((await f.call(route,{method:'POST',body:source.bytes,headers:{'Content-Type':source.type,'X-File-Name':'test.pdf','Content-Length':String(8*1024*1024+1)}})).status,413);
  assert.equal((await f.call(route,{method:'POST',body:source.bytes,headers:{'Content-Type':'image/png','X-File-Name':'test.png'}})).status,415);
  assert.deepEqual(f.storage,[]);
});

test('private client and administration HTML aliases have no cache/index and safe CSP',async t=>{
  const f=fixture(t);
  for(const route of ['/panel.html','/panel','/administracja.html','/administracja']){
    const response=await f.call(route,{user:null});assert.equal(response.status,200);
    assert.match(response.headers.get('Cache-Control'),/private, no-store/);assert.match(response.headers.get('X-Robots-Tag'),/noindex/);
    assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.doesNotMatch(await response.text(),/private-binary-marker/);
  }
});
test('unknown private route logs conceal user-controlled path identifiers',async t=>{
  const f=fixture(t);await f.call('/api/portal/private-email-marker@example.test');
  assert.doesNotMatch(JSON.stringify(f.logs),/private-email-marker/);assert.match(JSON.stringify(f.logs),/api\/portal\/:action/);
});
test('integrated personal export includes own import data and never becomes an owner customer dump',async t=>{
  const f=fixture(t);
  const created=await f.call('/api/portal/orders',{method:'POST',body:{client_user_id:'client-a',title:'Private export vehicle',lot:'62674546',platform:'copart'}});
  const order=(await created.json()).order;
  await f.call(`/api/portal/orders/${order.id}/messages`,{user:'client-a',method:'POST',body:{text:'Private export conversation'}});
  const response=await f.call('/api/portal/export',{user:'client-a'}),manifest=await response.json();
  assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/private, no-store/);
  assert.equal(manifest.sections.find(section=>section.section==='orders').observed_count,1);
  const section=manifest.sections.find(section=>section.section==='messages');
  const page=await f.call(`/api/portal/export?section=messages&cursor=${encodeURIComponent(section.start_cursor)}`,{user:'client-a'});
  const data=await page.json();assert.equal(data.items.length,1);assert.equal(data.items[0].text,'Private export conversation');assert.equal(data.section_complete,true);
  assert.equal((await f.call(`/api/portal/export?section=messages&cursor=${encodeURIComponent(section.start_cursor)}`,{user:'client-b'})).status,400);
  const owner=await (await f.call('/api/portal/export')).json();assert.equal(owner.sections.find(section=>section.section==='orders').observed_count,0);
  assert.deepEqual(f.network,[]);assert.doesNotMatch(JSON.stringify(f.logs),/Private export|start_cursor|rxb1\./);
});


test('owner removal permanently purges only the selected private file; stale URLs and repeated requests are safe',async t=>{
 const f=fixture(t), source=require('./fixtures/portal-files.cjs').files[1];
 const order=(await(await f.call('/api/portal/orders',{method:'POST',body:{client_user_id:'client-a',title:'Attachment removal test',lot:'QA-DELETE',platform:'copart'}})).json()).order;
 const upload=async()=> (await(await f.call('/api/portal/orders/'+order.id+'/files',{method:'POST',body:source.bytes,headers:{'Content-Type':source.type,'X-File-Name':'photo.png'}})).json()).file;
 const first=await upload(), retained=await upload();
 assert.equal(f.objects.size,2);
 const deleted=await f.call(first.download_url,{method:'DELETE'});assert.equal(deleted.status,200);assert.equal((await deleted.json()).purge_pending,false);assert.equal(f.objects.size,1);
 for(const user of ['owner','client-a','client-b',null])assert.equal((await f.call(first.download_url,{user})).status,user?404:401);
 const client=await(await f.call('/api/portal/orders/'+order.id,{user:'client-a'})).json();assert.deepEqual(client.files.map(x=>x.id),[retained.id]);
 assert.equal((await f.call(retained.download_url,{user:'client-a'})).status,200);
 const tombstone=f.sql.prepare('SELECT * FROM import_order_file_deletions WHERE file_id=?').get(first.id);assert(tombstone.purged_at);assert.equal(tombstone.object_key,null);
 assert.equal((await f.call(first.download_url,{method:'DELETE'})).status,200);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM import_order_file_deletions').get().n,1);
});
test('removal rejects client, other account, anonymous, AAL1 owner and cross-origin writes without storage access',async t=>{
 const f=fixture(t),source=require('./fixtures/portal-files.cjs').files[0];
 const order=(await(await f.call('/api/portal/orders',{method:'POST',body:{client_user_id:'client-a',title:'Removal permissions',lot:'QA-SCOPE',platform:'iaai'}})).json()).order;
 const file=(await(await f.call('/api/portal/orders/'+order.id+'/files',{method:'POST',body:source.bytes,headers:{'Content-Type':source.type,'X-File-Name':'test.pdf'}})).json()).file;
 const before=f.storage.length;
 for(const[user,headers,status]of[[null,{},401],['client-a',{},403],['client-b',{},404],['owner',{'X-Fixture-AAL':'aal1'},403],['owner',{Origin:'https://other.test','Sec-Fetch-Site':'cross-site'},403]])assert.equal((await f.call(file.download_url,{user,method:'DELETE',headers})).status,status);
 assert.equal(f.storage.length,before);assert.equal(f.objects.size,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM import_order_file_deletions').get().n,0);
});
test('storage outage hides file immediately and scheduled retry completes the durable purge',async t=>{
 const f=fixture(t),source=require('./fixtures/portal-files.cjs').files[2];
 const order=(await(await f.call('/api/portal/orders',{method:'POST',body:{client_user_id:'client-a',title:'Removal retry',lot:'QA-RETRY',platform:'copart'}})).json()).order;
 const file=(await(await f.call('/api/portal/orders/'+order.id+'/files',{method:'POST',body:source.bytes,headers:{'Content-Type':source.type,'X-File-Name':'test.jpg','X-Visibility':'internal'}})).json()).file;
 const remove=f.env.REXBID_PRIVATE_FILES.delete;f.env.REXBID_PRIVATE_FILES.delete=async()=>{throw Error('storage unavailable');};
 const response=await f.call(file.download_url,{method:'DELETE'});assert.equal(response.status,202);assert.equal((await response.json()).purge_pending,true);
 assert.equal((await f.call(file.download_url)).status,404);assert.equal(f.objects.size,1);
 assert.equal((await(await f.call('/api/portal/orders/'+order.id)).json()).files.length,0);
 f.env.REXBID_PRIVATE_FILES.delete=remove;
 const retried=await require('../portal/file-deletions.cjs').retryPending(f.env);assert.deepEqual(retried,{attempted:1,purged:1});assert.equal(f.objects.size,0);
 assert.deepEqual(await require('../portal/file-deletions.cjs').retryPending(f.env),{attempted:0,purged:0});
});
test('database failure rolls back hide and purge intent before touching R2',async t=>{
 const f=fixture(t),source=require('./fixtures/portal-files.cjs').files[0];
 const order=(await(await f.call('/api/portal/orders',{method:'POST',body:{client_user_id:'client-a',title:'Atomic removal',lot:'QA-ATOMIC',platform:'iaai'}})).json()).order;
 const file=(await(await f.call('/api/portal/orders/'+order.id+'/files',{method:'POST',body:source.bytes,headers:{'Content-Type':source.type,'X-File-Name':'test.pdf'}})).json()).file;
 f.sql.exec("CREATE TRIGGER fail_file_delete BEFORE DELETE ON import_order_files BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.equal((await f.call(file.download_url,{method:'DELETE'})).status,503);assert.equal(f.objects.size,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM import_order_file_deletions').get().n,0);assert.equal((await f.call(file.download_url,{user:'client-a'})).status,200);
});


function registeredFixture(t){const f=fixture(t);f.env.REXBID_ORDER_REGISTER_ENABLED='yes';f.sql.exec(fs.readFileSync(path.join(ROOT,'docs/proposals/0018_owner_order_register.sql'),'utf8'));f.sql.exec('CREATE TABLE IF NOT EXISTS portal_notification_recipients(user_id TEXT PRIMARY KEY,email_ciphertext TEXT,email_hash TEXT,verified_at TEXT)');return f;}
async function registeredOrder(f,client='client-a',extra={}){const response=await f.call('/api/portal/orders',{method:'POST',body:{client_user_id:client,title:'2025 BMW X1',vin:'WBX13EF09S5386118',lot:'72915826',platform:'copart',...extra}});assert.equal(response.status,201);return(await response.json()).order;}
test('register assigns stable unique references and searches names, verified email, VIN, LOT, vehicle and number beyond first page',async t=>{
 const f=registeredFixture(t);await f.call('/api/portal/profile',{user:'client-a',method:'POST',body:{name:'Łukasz Kowalski',email:'lukasz@example.test'}});
 const protection=require('../portal/crypto.cjs').createPortalCrypto();const cipher=await protection.protect('verified@example.test','portal:mail:recipient:client-a',f.env);f.sql.prepare('INSERT INTO portal_notification_recipients VALUES(?,?,?,?)').run('client-a',cipher,'opaque-hash','2026-11-18T10:00:00Z');
 const first=await registeredOrder(f);const second=await registeredOrder(f,'client-b',{title:'2024 Subaru Forester',lot:'12345678',vin:'WBX13EF09S5386119'});assert.equal(first.register.reference,'RB-000001');assert.equal(second.register.reference,'RB-000002');
 for(const q of ['kowal','lukasz','verified@example.test','WBX13EF09S5386118','72915826','BMW','RB-000001']){const r=await f.call('/api/portal/orders?limit=1&offset=0&q='+encodeURIComponent(q));assert.equal(r.status,200);const data=await r.json();assert(data.orders.some(x=>x.id===first.id),q);assert.equal(data.search_ready,true);}
 assert.equal((await(await f.call('/api/portal/orders?limit=1&offset=0&q=Kowalski')).json()).orders[0].verified_email,'verified@example.test');
 const before=f.sql.prepare('SELECT * FROM portal_client_search_tokens').all();assert(before.length>0);assert.doesNotMatch(JSON.stringify(before),/Kowalski|lukasz|example|verified/);
 const detail=(await(await f.call('/api/portal/orders/'+first.id,{user:'client-a'})).json()).order;assert.equal(detail.register.reference,'RB-000001');assert.equal(detail.verified_email,undefined);assert.equal((await f.call('/api/portal/orders/'+first.id+'/record',{user:'client-a',method:'POST',body:{expected_version:1}})).status,403);
 assert.equal((await(await f.call('/api/portal/orders/'+first.id)).json()).order.register.reference,'RB-000001');
});
test('register distinguishes real purchases and handovers from test cases and expected arrival',async t=>{
 const f=registeredFixture(t),real=await registeredOrder(f),testOrder=await registeredOrder(f,'client-b',{is_test:true});
 const update=async(order,status,version=1)=>{const response=await f.call('/api/portal/orders/'+order.id,{method:'PATCH',body:{expected_version:version,status,...(status==='auction_won'?{purchased_on:'2026-11-01'}:{}),...(status==='delivered'?{delivered_on:'2026-11-02'}:{}),estimated_arrival_at:'2027-01-01T12:00:00.000Z'}});assert.equal(response.status,200);return(await response.json()).order;};
 let active=await update(real,'auction_won');assert(active.register.purchased_on);assert.equal(active.register.delivered_on,null);
 await update(testOrder,'delivered');let list=await(await f.call('/api/portal/orders')).json();assert.deepEqual(list.summary,{cases_total:2,test_cases:1,real_cases:1,purchased:1,delivered:0,ongoing:1});
 active=await update(real,'delivered',active.version);assert(active.register.delivered_on);list=await(await f.call('/api/portal/orders')).json();assert.equal(list.summary.delivered,1);assert.equal(list.summary.ongoing,0);
 assert.equal((await(await f.call('/api/portal/orders?kind=test')).json()).orders[0].id,testOrder.id);
 assert.equal((await(await f.call('/api/portal/orders?kind=real')).json()).orders[0].id,real.id);
 const register=require('../portal/order-register.cjs');assert.equal(register.localDay('2026-11-18T23:30:00Z'),'2026-11-19');assert.throws(()=>register.day('2026-02-30','2026-11-18T12:00:00Z'),/invalid_request/);assert.throws(()=>register.day('2028-01-01','2026-11-18T12:00:00Z'),/invalid_request/);
});
test('record correction is versioned, internally audited and rejects invalid dates, identities and unauthorized access',async t=>{
 const f=registeredFixture(t),order=await registeredOrder(f);const route='/api/portal/orders/'+order.id+'/record';
 const good=await f.call(route,{method:'POST',body:{expected_version:1,vehicle_label:'2025 BMW X1 xDrive28i',purchased_on:'2026-11-01',is_test:true}});assert.equal(good.status,200);const updated=(await good.json()).order;assert.equal(updated.version,2);assert.equal(updated.register.vehicle_label,'2025 BMW X1 xDrive28i');
 assert.equal((await f.call(route,{method:'POST',body:{expected_version:1,vehicle_label:'STALE'}})).status,409);
 for(const patch of [{purchased_on:'2026-02-30'},{delivered_on:'2026-11-02'},{vin:'INVALID'},{is_test:'yes'},{number:99}])assert.equal((await f.call(route,{method:'POST',body:{expected_version:2,...patch}})).status,400);
 assert.equal((await f.call(route,{user:'client-b',method:'POST',body:{expected_version:2}})).status,404);
 assert.equal((await f.call(route,{headers:{'X-Fixture-AAL':'aal1'},method:'POST',body:{expected_version:2}})).status,403);
 const client=await(await f.call('/api/portal/orders/'+order.id,{user:'client-a'})).json();assert.equal(client.events.length,1);assert.equal(client.order.register.vehicle_label,'2025 BMW X1 xDrive28i');
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM import_order_events WHERE order_id=? AND visibility='internal'").get(order.id).n,1);
});
test('search updates changed encrypted profiles and supports retained keys without plaintext index or stale names',async t=>{
 const f=registeredFixture(t);await registeredOrder(f);await f.call('/api/portal/profile',{user:'client-a',method:'POST',body:{name:'Jan Nowak',email:'jan@example.test'}});
 assert.equal((await(await f.call('/api/portal/orders?q=Nowak')).json()).orders.length,1);
 await f.call('/api/portal/profile',{user:'client-a',method:'POST',body:{name:'Adam Zieliński',email:'adam@example.test'}});
 assert.equal((await(await f.call('/api/portal/orders?q=Nowak')).json()).orders.length,0);assert.equal((await(await f.call('/api/portal/orders?q=zielin')).json()).orders.length,1);
 f.env.REXBID_PORTAL_DATA_KEYS=JSON.stringify({...JSON.parse(f.env.REXBID_PORTAL_DATA_KEYS),second:Buffer.alloc(32,7).toString('base64url')});f.env.REXBID_PORTAL_ACTIVE_KEY_ID='second';
 assert.equal((await(await f.call('/api/portal/orders?q=zielin')).json()).orders.length,1);
 assert.equal((await f.call('/api/portal/orders?kind=wrong')).status,400);assert.equal((await f.call('/api/portal/orders?status=unknown')).status,400);
});


test('purchase and handover dates require explicit owner confirmation instead of being inferred from stage update time',async t=>{
 const f=registeredFixture(t),order=await registeredOrder(f);const route='/api/portal/orders/'+order.id;
 for(const status of ['auction_won','delivered'])assert.equal((await f.call(route,{method:'PATCH',body:{expected_version:1,status}})).status,400);
 const unchanged=(await(await f.call(route)).json()).order;assert.equal(unchanged.version,1);assert.equal(unchanged.register.purchased_on,null);assert.equal(unchanged.register.delivered_on,null);
 const response=await f.call(route,{method:'PATCH',body:{expected_version:1,status:'auction_won',purchased_on:'2026-11-01'}});assert.equal(response.status,200);assert.equal((await response.json()).order.register.purchased_on,'2026-11-01');
 assert.equal((await f.call(route,{method:'PATCH',body:{expected_version:2,status:'delivered',delivered_on:'2026-10-31'}})).status,400);
});


test('owner edits shared encrypted contact data and search immediately finds name, contact email and phone without changing verified delivery address',async t=>{
 const f=registeredFixture(t),one=await registeredOrder(f),two=await registeredOrder(f);const protection=require('../portal/crypto.cjs').createPortalCrypto();
 const verified=await protection.protect('login@example.test','portal:mail:recipient:client-a',f.env);f.sql.prepare('INSERT INTO portal_notification_recipients VALUES(?,?,?,?)').run('client-a',verified,'verified-hash','2026-11-18T10:00:00Z');
 const profile={name:'Łukasz Kowalski',email:'kontakt@example.test',phone:'+48 123 456 789',expected_revision:'none'};
 const response=await f.call('/api/portal/orders/'+one.id+'/client',{method:'POST',body:profile});assert.equal(response.status,200);const saved=await response.json();assert.match(saved.profile_revision,/^[a-f0-9]{64}$/);
 for(const q of ['Kowal','lukasz','kontakt@example.test','48123456789','123456789','login@example.test']){const data=await(await f.call('/api/portal/orders?q='+encodeURIComponent(q))).json();assert.equal(data.orders.length,2,q);assert(data.orders.every(o=>o.client_profile.name==='Łukasz Kowalski'));}
 const detail=(await(await f.call('/api/portal/orders/'+two.id)).json()).order;assert.equal(detail.client_profile.phone,profile.phone);assert.equal(detail.verified_email,'login@example.test');assert.equal(detail.profile_revision,saved.profile_revision);
 assert.equal(f.sql.prepare('SELECT email_ciphertext FROM portal_notification_recipients WHERE user_id=?').get('client-a').email_ciphertext,verified);
 const raw=f.sql.prepare('SELECT content_ciphertext FROM portal_customer_profiles WHERE user_id=?').get('client-a').content_ciphertext;assert.doesNotMatch(raw,/Kowalski|kontakt|123456789/);
 assert.doesNotMatch(JSON.stringify(f.sql.prepare('SELECT * FROM portal_client_search_tokens').all()),/Kowalski|kontakt|123456789/);
 const client=await(await f.call('/api/portal/orders/'+one.id,{user:'client-a'})).json();assert.equal(client.events.length,1);assert.equal(client.order.profile_revision,undefined);
 const self=await(await f.call('/api/portal/profile',{user:'client-a'})).json();assert.equal(self.profile.name,profile.name);assert.equal(self.revision,saved.profile_revision);
});
test('contact editing requires owner AAL2, order scope and same-origin write; invalid data cannot change profile',async t=>{
 const f=registeredFixture(t),order=await registeredOrder(f),route='/api/portal/orders/'+order.id+'/client',body={name:'TEST Owner Contact',email:'test@example.test',phone:'+48 123 456 789',expected_revision:'none'};
 for(const[user,headers,status]of[[null,{},401],['client-a',{},403],['client-b',{},404],['owner',{'X-Fixture-AAL':'aal1'},403],['owner',{Origin:'https://other.test','Sec-Fetch-Site':'cross-site'},403]])assert.equal((await f.call(route,{user,headers,method:'POST',body})).status,status);
 for(const patch of [{name:'x'.repeat(81)},{email:'invalid'},{phone:'<script>'},{user_id:'client-b'},{expected_revision:'bad'}])assert.equal((await f.call(route,{method:'POST',body:{...body,...patch}})).status,400);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM portal_customer_profiles').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM portal_client_search_tokens').get().n,0);
});
test('profile compare-and-swap rejects old owner or client forms without overwriting latest data',async t=>{
 const f=registeredFixture(t),order=await registeredOrder(f),route='/api/portal/orders/'+order.id+'/client';
 const first=await(await f.call(route,{method:'POST',body:{expected_revision:'none',name:'Pierwsza wersja',email:'first@example.test'}})).json();
 assert.equal((await f.call(route,{method:'POST',body:{expected_revision:'none',name:'STARY FORMULARZ'}})).status,409);
 const updated=await f.call('/api/portal/profile',{user:'client-a',method:'POST',body:{expected_revision:first.profile_revision,name:'Nowa wersja klienta',email:'new@example.test'}});assert.equal(updated.status,200);
 assert.equal((await f.call(route,{method:'POST',body:{expected_revision:first.profile_revision,name:'STARE DANE WŁAŚCICIELA'}})).status,409);
 const current=await(await f.call('/api/portal/profile',{user:'client-a'})).json();assert.equal(current.profile.name,'Nowa wersja klienta');
 assert.equal((await f.call('/api/portal/profile',{user:'client-a',method:'POST',body:{expected_revision:first.profile_revision,name:'STARE DANE KLIENTA'}})).status,409);
 assert.equal((await(await f.call('/api/portal/orders?q=new@example.test')).json()).orders.length,1);assert.equal((await(await f.call('/api/portal/orders?q=first@example.test')).json()).orders.length,0);
});
test('contact profile, private audit and search update roll back together on database failure',async t=>{
 const f=registeredFixture(t),order=await registeredOrder(f);
 f.sql.exec("CREATE TRIGGER fail_profile_index BEFORE INSERT ON portal_client_search_state BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 const result=await f.call('/api/portal/orders/'+order.id+'/client',{method:'POST',body:{expected_revision:'none',name:'ROLLBACK TEST',email:'rollback@example.test'}});assert.equal(result.status,503);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM portal_customer_profiles').get().n,0);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM import_order_events WHERE visibility='internal'").get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM portal_client_search_tokens').get().n,0);
});
