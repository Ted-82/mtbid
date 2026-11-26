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
  for(const file of ['0003_accounts_foundation.sql','0006_import_operations.sql','0007_portal_message_reads.sql']) sql.exec(fs.readFileSync(path.join(ROOT,'docs/proposals',file),'utf8'));
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
