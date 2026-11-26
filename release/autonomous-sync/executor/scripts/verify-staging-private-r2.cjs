'use strict';

// Opt-in integration check: real remote R2, disposable SQLite and synthetic
// server-side identities. No Supabase calls, owner secrets or remote D1 writes.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {webcrypto,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const {createImportPortalHandler}=require('../portal/operations.cjs');
const {createPortalCrypto}=require('../portal/crypto.cjs');
const {createPrivateAttachmentService}=require('../portal/attachments.cjs');
const {files}=require('../tests/fixtures/portal-files.cjs');
const ROOT=path.resolve(__dirname,'..');
const BUCKET='rexbid-staging-private-files';
const ORIGIN='https://rexbid-auth-test.tedn828.workers.dev';

async function main() {
  assert.deepEqual(process.argv.slice(2),['--remote-staging'],'Explicit --remote-staging is required');
  const config=JSON.parse(fs.readFileSync(path.join(ROOT,'wrangler.staging.jsonc'),'utf8'));
  assert.equal(config.name,'rexbid-auth-test');
  assert.equal(config.d1_databases.find(item=>item.binding==='REXBID_DB')?.database_id,'acb3cb8e-69a2-459f-8a46-0f2f5b9004be');
  assert.equal(config.r2_buckets.find(item=>item.binding==='REXBID_PRIVATE_FILES')?.bucket_name,BUCKET);
  const wrangler=path.resolve(ROOT,process.env.REXBID_TEST_WRANGLER || '.codex-wrangler-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js');
  assert.ok(fs.existsSync(wrangler));
  const run=webcrypto.randomUUID(), cache=path.join(ROOT,'.codex-wrangler-cache',`r2-verification-${run}`);
  fs.mkdirSync(cache,{recursive:true});
  const keys=new Set(), counts={put:0,get:0,delete:0}, checks=[];
  function journal(){fs.writeFileSync(path.join(cache,'owned-objects.json'),JSON.stringify({bucket:BUCKET,keys:[...keys]},null,2));}
  function cli(args,input) {
    const result=spawnSync(process.execPath,[wrangler,...args,'--config','wrangler.staging.jsonc'],{
      cwd:ROOT,input,encoding:null,maxBuffer:20*1024*1024,timeout:60000,
      env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'7ff5a57444667c4eda2a6a7f0fc4120d',WRANGLER_LOG_PATH:path.join(cache,'wrangler.log')}
    });
    if(result.status!==0 || result.error) throw new Error(`R2 ${args.slice(0,3).join(' ')} failed; inspect local operator log`);
    return result.stdout;
  }
  const sql=new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  for(const migration of ['0003_accounts_foundation.sql','0006_import_operations.sql']) sql.exec(fs.readFileSync(path.join(ROOT,'docs/proposals',migration),'utf8'));
  for(const id of ['synthetic-owner','synthetic-client-a','synthetic-client-b']) sql.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(id,'https://fixture.invalid',id,'email',1,'2026-10-06T00:00:00Z','2026-10-06T00:00:00Z');
  const db={prepare(query){const statement=sql.prepare(query);let values=[];return{bind(...args){values=args;return this;},async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};},async run(){return {success:true,meta:{changes:Number(statement.run(...values).changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const protection=createPortalCrypto({cryptoImpl:webcrypto}), service=createPrivateAttachmentService({protection,cryptoImpl:webcrypto});
  const env={...config.vars,REXBID_DB:db,REXBID_OWNER_USER_ID:'synthetic-owner',
    REXBID_PORTAL_ACTIVE_KEY_ID:'synthetic',REXBID_PORTAL_DATA_KEYS:JSON.stringify({synthetic:randomBytes(32).toString('base64url')}),
    REXBID_PRIVATE_FILES:{
      async put(key,bytes,options){
        assert.match(key,/^portal\/[0-9a-f-]{36}$/); assert.ok(!keys.has(key)); keys.add(key); journal();
        assert.deepEqual(options,{httpMetadata:{contentType:'application/octet-stream'}});
        assert.equal(Buffer.from(bytes).subarray(0,6).toString(),'RXBID1');
        assert.ok(files.every(file=>!Buffer.from(bytes).includes(file.bytes)));
        cli(['r2','object','put',`${BUCKET}/${key}`,'--remote','--pipe','--content-type','application/octet-stream','--storage-class','Standard'],Buffer.from(bytes)); counts.put++;
      },
      async get(key){
        assert.ok(keys.has(key),'Only objects created by this run may be read');
        const destination=path.join(cache,'ciphertext.bin');
        cli(['r2','object','get',`${BUCKET}/${key}`,'--remote','--file',destination]); counts.get++;
        const bytes=fs.readFileSync(destination); assert.equal(bytes.subarray(0,6).toString(),'RXBID1');
        return{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};
      },
      async delete(key){assert.ok(keys.has(key));cli(['r2','object','delete',`${BUCKET}/${key}`,'--remote']);keys.delete(key);counts.delete++;journal();}
    }};
  let activeUser='synthetic-owner', aal='aal2';
  const handler=createImportPortalHandler({resolveAccount:async()=>({user:activeUser?{id:activeUser}:null,status:activeUser?200:401,cookies:[],assurance_level:aal}),
    cryptoImpl:webcrypto,protect:protection.protect,unprotect:protection.unprotect,protectionConfigured:protection.configured,attachmentService:service});
  async function call(route,{user='synthetic-owner',assurance='aal2',method='GET',body,headers={}}={}) {
    activeUser=user;aal=assurance;
    return handler(new Request(ORIGIN+'/api/portal'+route,{method,headers:{Origin:ORIGIN,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),env);
  }
  let failure=null;
  try {
    assert.equal((await (await call('/config')).json()).uploads_enabled,true);
    const created=await call('/orders',{method:'POST',body:{client_user_id:'synthetic-client-a',title:'Synthetic R2 check',lot:'QA-R2-ONLY',platform:'copart'}});
    assert.equal(created.status,201); const order=(await created.json()).order, route=`/orders/${order.id}`;
    for(const file of files) {
      const response=await call(route+'/files',{method:'POST',body:file.bytes,headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name),'X-Visibility':'client'}});
      assert.equal(response.status,201);const stored=(await response.json()).file,path=stored.download_url.slice('/api/portal'.length),before=counts.get;
      for(const [user,status] of [[null,401],['synthetic-client-b',404]]) assert.equal((await call(path,{user})).status,status);
      assert.equal(counts.get,before,'Unauthorized users must not touch R2');
      const download=await call(path,{user:'synthetic-client-a'});
      assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),file.type);
      assert.match(download.headers.get('Cache-Control'),/private, no-store/);assert.match(download.headers.get('Content-Disposition'),/^attachment;/);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()),file.bytes);
      checks.push({type:file.type,upload:201,download:200,byte_equality:true,anonymous:401,other_client:404});
    }
    const internal=await call(route+'/files',{method:'POST',body:files[0].bytes,headers:{'Content-Type':files[0].type,'X-File-Name':'internal-test.pdf','X-Visibility':'internal'}});
    assert.equal(internal.status,201);const hidden=(await internal.json()).file;
    const before=counts.get;
    assert.equal((await call(hidden.download_url.slice('/api/portal'.length),{user:'synthetic-client-a'})).status,404);assert.equal(counts.get,before);
    const ownerDownload=await call(hidden.download_url.slice('/api/portal'.length));assert.equal(ownerDownload.status,200);assert.deepEqual(Buffer.from(await ownerDownload.arrayBuffer()),files[0].bytes);
    assert.equal((await call(route,{method:'PATCH',body:{expected_version:1,event_visibility:'internal',event_message:'Synthetic private note'}})).status,200);
    const client=await (await call(route,{user:'synthetic-client-a'})).json();assert.equal(client.files.length,3);assert.equal(client.events.length,1);assert.doesNotMatch(JSON.stringify(client),/Synthetic private note|internal-test|object_key/);
    for(const [user,assurance,status] of [[null,'aal1',401],['synthetic-client-a','aal1',403],['synthetic-client-b','aal1',404],['synthetic-owner','aal1',403]]) {
      assert.equal((await call(route+'/files',{user,assurance,method:'POST',body:files[0].bytes,headers:{'Content-Type':'application/pdf','X-File-Name':'test.pdf'}})).status,status);
    }
    const beforePut=counts.put;
    assert.equal((await call(route+'/files',{method:'POST',body:files[0].bytes,headers:{'Content-Type':'application/pdf','X-File-Name':'test.pdf','Content-Length':String(8*1024*1024+1)}})).status,413);
    assert.equal((await call(route+'/files',{method:'POST',body:files[0].bytes,headers:{'Content-Type':'image/png','X-File-Name':'test.png'}})).status,415);
    assert.equal(counts.put,beforePut);
    checks.push({internal_file_hidden:true,internal_note_hidden:true,upload_owner_aal2_only:true,oversize:413,wrong_magic:415});
  } catch(error) { failure=error; }
  finally {
    for(const key of [...keys]) {
      try {await env.REXBID_PRIVATE_FILES.delete(key);} catch(error) {failure ||= error;}
    }
    sql.close();
  }
  const result={ok:!failure&&keys.size===0,bucket:BUCKET,checks,operations:counts,cleanup:keys.size===0,
    remote_d1_writes:0,live_auth_requests:0,apibara_requests:0,
    limitation:'Real R2 via Wrangler; application modules, SQLite and synthetic session capability execute locally. Real owner browser upload is not verified.'};
  fs.writeFileSync(path.join(cache,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  if(failure) throw failure;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
