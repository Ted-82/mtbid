'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const SECTIONS=['account','profile','favorites','orders','events','messages','files'];
const EXPORT_ID='11111111-1111-4111-8111-111111111111',ORDER='22222222-2222-4222-8222-222222222222',FILE='33333333-3333-4333-8333-333333333333';
const AS_OF='2026-10-06T06:00:00.000Z',EXPIRES='2026-10-06T06:30:00.000Z';
const flush=async()=>{for(let index=0;index<4;index++)await new Promise(resolve=>setImmediate(resolve));};
function response(status,body) { return {ok:status>=200 && status<300,status,json:async()=>body}; }
function items(section) {
  switch(section) {
    case 'account':return[{id:'client-a',auth_provider:'email',email_verified:true,created_at:AS_OF,auth_subject:'NEVER-EXPORT-CREDENTIAL'}];
    case 'profile':return[{name:'Private Client',email:'private@example.test',phone:null,created_at:AS_OF}];
    case 'favorites':return[{key:'lot:copart:123',lot:'123',platform:'copart'}];
    case 'orders':return[{id:ORDER,title:'Private vehicle',status:'at_sea'}];
    case 'events':return[{id:'event-1',order_id:ORDER,message:'Confirmed shipping'}];
    case 'messages':return Array.from({length:51},(_,index)=>({id:'message-'+index,order_id:ORDER,author:'owner',text:'Private message '+index,created_at:AS_OF}));
    case 'files':return[{id:FILE,order_id:ORDER,filename:'private-document.pdf',content_type:'application/pdf',size_bytes:123,created_at:AS_OF,download_url:`/api/portal/orders/${ORDER}/files/${FILE}`,object_key:'NEVER-EXPORT-R2-KEY'}];
  }
}
function manifest() { return {ok:true,schema_version:'rexbid-personal-export-v1',export_id:EXPORT_ID,scope:'authenticated_account_and_own_customer_orders',page_size:50,as_of:AS_OF,expires_at:EXPIRES,
  consistency:{mode:'created_at_cutoff_with_live_values',description:'Live values, not a database snapshot.',manifest_counts:'observed_live_when_manifest_is_read'},
  attachments:{file_bytes_included:false},sections:SECTIONS.map(section=>({section,observed_count:items(section).length,start_cursor:'rxb1.Start'+section}))}; }
function exportPage(section,{last=false,...changes}={}) {
  const rows=items(section),more=section==='messages' && !last;
  return {ok:true,schema_version:'rexbid-personal-export-v1',export_id:EXPORT_ID,scope:'authenticated_account_and_own_customer_orders',section,as_of:AS_OF,expires_at:EXPIRES,
    items:last?rows.slice(50):rows.slice(0,50),section_complete:!more,next_cursor:more?'rxb1.Nextmessages':null,...changes};
}
async function setup(t,{override,auth=false,enabled=true,portal=true,module=true}={}) {
  const dom=new JSDOM(auth?read('konto.html'):'<!doctype html><body><main></main>',{url:'https://rexbid.pl/konto.html',runScripts:'outside-only'}),win=dom.window;
  t.after(()=>win.close());await new Promise(resolve=>win.document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  let current='client-a';const calls=[],blobs=[],downloads=[],revoked=[];
  win.Storage.prototype.getItem=()=>{throw new Error('No export data in browser storage');};
  win.Storage.prototype.setItem=()=>{throw new Error('No export data in browser storage');};
  win.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:https://rexbid.pl/private-'+blobs.length;};
  win.URL.revokeObjectURL=url=>revoked.push(url);
  win.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,filename:this.download});};
  win.fetch=async(url,options={})=>{
    calls.push({url,options});const customized=await override?.(url,options,{win,calls});if(customized!==undefined)return customized;
    if(url==='/api/auth/config')return response(200,{ok:true,enabled});
    if(url==='/api/me')return response(200,{ok:true,user:{id:current,auth_provider:'email',email_verified:true}});
    if(url==='/api/me/favorites')return response(200,{ok:true,favorites:[]});
    if(url==='/api/auth/logout')return response(200,{ok:true});
    if(url==='/api/portal/config')return response(200,{ok:true,enabled:portal});
    if(url==='/api/me/export')return response(200,{ok:true,exported_at:AS_OF,profile:{id:current,auth_provider:'email',email_verified:true},favorites:[{key:'lot:copart:123',lot:'123',platform:'copart'}]});
    if(url==='/api/portal/export')return response(200,manifest());
    if(url.startsWith('/api/portal/export?')) {
      const query=new URL(url,win.location.href).searchParams,section=query.get('section');return response(200,exportPage(section,{last:query.get('cursor')==='rxb1.Nextmessages'}));
    }
    throw new Error('Unexpected fetch path');
  };
  if(module)win.eval(read('rexbid-data-export.js'));
  if(auth){win.eval(read('rexbid-auth.js'));await win.RexBidAuth.ready;await win.RexBidAuth.mountAccountPage();await flush();}
  return {win,doc:win.document,calls,blobs,downloads,revoked,getIdentity:()=>current,setIdentity:value=>{current=value;},
    collect:options=>win.RexBidDataExport.collect({getIdentity:()=>current,...options}),download:options=>win.RexBidDataExport.download({getIdentity:()=>current,...options})};
}
async function blobText(win,blob) { return new Promise((resolve,reject)=>{const reader=new win.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);}); }

test('actual module downloads every page in all seven sections and creates one cursor-free JSON file',async t=>{
  const p=await setup(t),result=await p.download();assert.equal(result.ok,true);assert.equal(result.data.complete,true);
  assert.deepEqual(Object.keys(result.data.sections),SECTIONS);assert.equal(result.data.sections.messages.length,51);assert.equal(p.downloads.length,1);assert.equal(p.blobs.length,1);assert.equal(p.revoked[0],p.downloads[0].href);
  const data=JSON.parse(await blobText(p.win,p.blobs[0]));assert.equal(data.sections.files[0].filename,'private-document.pdf');assert.equal(data.attachments.file_bytes_included,false);
  assert.doesNotMatch(JSON.stringify(data),/cursor|NEVER-EXPORT|content_ciphertext|object_key|auth_subject/);
  assert.equal(p.calls.filter(call=>call.url.startsWith('/api/portal/export?')).length,8);
  assert.equal(p.calls.some(call=>call.url.includes('/orders/')),false,'attachments are not automatically fetched');
  assert.ok(p.calls.every(call=>call.options.credentials==='same-origin' && call.options.cache==='no-store' && call.options.redirect==='error'));
  assert.match(p.downloads[0].filename,/^rexbid-dane-\d{4}-\d{2}-\d{2}\.json$/);
});
test('only a confirmed disabled portal selects legacy export and labels its limited scope',async t=>{
  const p=await setup(t,{portal:false}),result=await p.download();assert.equal(result.scope,'account_favorites_only');assert.equal(result.data.sections.favorites.length,1);
  assert.match(result.data.notices[0],/wyłącznie dane konta i ulubione/);assert.equal(result.data.sections.orders,undefined);assert.ok(result.data.excluded_sections.includes('messages'));
  assert.deepEqual(p.calls.map(call=>call.url),['/api/portal/config','/api/me/export']);assert.match(p.downloads[0].filename,/konta-i-ulubionych/);
});
test('config failure and active-portal manifest failure never fall back to a partial account-only file',async t=>{
  for(const target of ['config','manifest']) {
    const p=await setup(t,{override:url=>url===(target==='config'?'/api/portal/config':'/api/portal/export')?Promise.reject(new Error('PRIVATE-UPSTREAM-MESSAGE')):undefined});
    await assert.rejects(p.download(),error=>error.code==='EXPORT_NETWORK_FAILURE' && !error.message.includes('PRIVATE'));
    assert.equal(p.calls.some(call=>call.url==='/api/me/export'),false);assert.equal(p.blobs.length,0);assert.equal(p.downloads.length,0);
  }
});
test('a page 401 aborts the complete export without creating or downloading a partial Blob',async t=>{
  const p=await setup(t,{override:url=>url.includes('section=messages')?response(401,{ok:false,error:'unauthorized'}):undefined});
  await assert.rejects(p.download(),error=>error.code==='EXPORT_UNAUTHORIZED');assert.equal(p.calls.some(call=>call.url==='/api/me/export'),false);
  assert.equal(p.blobs.length,0);assert.equal(p.downloads.length,0);assert.equal(p.win.RexBidDataExport.busy,false);
});
test('repeated cursor and incomplete terminal markers prevent falsely complete downloads',async t=>{
  for(const mode of ['repeat','null','extra']) {
    const p=await setup(t,{override:url=>url.includes('section=messages')?response(200,exportPage('messages',mode==='repeat'?{next_cursor:'rxb1.Startmessages'}:mode==='null'?{next_cursor:null}:{section_complete:true,next_cursor:'rxb1.Extra'})):undefined});
    await assert.rejects(p.download(),error=>['EXPORT_CURSOR_REPEATED','EXPORT_RESPONSE_INVALID'].includes(error.code));assert.equal(p.blobs.length,0);assert.equal(p.downloads.length,0);
  }
});
test('export id, cutoff, section and malformed manifest identities are validated before download',async t=>{
  for(const changes of [{export_id:'44444444-4444-4444-8444-444444444444'},{as_of:'2026-10-06T06:01:00.000Z'},{section:'files'}]) {
    const p=await setup(t,{override:url=>url.includes('section=orders')?response(200,exportPage('orders',changes)):undefined});
    await assert.rejects(p.download(),error=>error.code==='EXPORT_RESPONSE_INVALID');assert.equal(p.downloads.length,0);
  }
  const p=await setup(t,{override:url=>{if(url==='/api/portal/export'){const data=manifest();data.sections[6]=data.sections[5];return response(200,data);}}});
  await assert.rejects(p.collect(),error=>error.code==='EXPORT_RESPONSE_INVALID');assert.equal(p.calls.filter(call=>call.url.includes('section=')).length,0);
});
test('file metadata cannot introduce external download URLs or an automatically fetched attachment',async t=>{
  const p=await setup(t,{override:url=>url.includes('section=files')?response(200,exportPage('files',{items:[{...items('files')[0],download_url:'https://evil.example/private.pdf'}]})):undefined});
  await assert.rejects(p.download(),error=>error.code==='EXPORT_RESPONSE_INVALID');assert.equal(p.blobs.length,0);assert.equal(p.calls.some(call=>call.url.startsWith('https://')),false);
});
test('pagehide cancels even an uncooperative late fetch and discards data before Blob creation',async t=>{
  let resolvePage,started;const waiting=new Promise(resolve=>{started=resolve;});
  const p=await setup(t,{override:url=>url.includes('section=messages')?new Promise(resolve=>{resolvePage=resolve;started();}):undefined});
  const result=p.download();await waiting;p.win.dispatchEvent(new p.win.Event('pagehide'));
  await assert.rejects(result,error=>error.code==='EXPORT_CANCELLED');resolvePage(response(200,exportPage('messages')));await flush();
  assert.equal(p.blobs.length,0);assert.equal(p.downloads.length,0);assert.equal(p.win.RexBidDataExport.busy,false);
});
test('logout and account switching cancel before a late private response can create a file',async t=>{
  for(const mode of ['logout','switch']) {
    let resolvePage,started;const waiting=new Promise(resolve=>{started=resolve;});
    const p=await setup(t,{override:url=>url.includes('section=messages')?new Promise(resolve=>{resolvePage=resolve;started();}):undefined});
    const result=p.download();await waiting;p.setIdentity(mode==='logout'?null:'client-b');p.win.dispatchEvent(new p.win.CustomEvent('rexbid:auth-state',{detail:{status:mode==='logout'?'anonymous':'authenticated'}}));
    await assert.rejects(result,error=>error.code==='EXPORT_IDENTITY_CHANGED');resolvePage(response(200,exportPage('messages')));await flush();assert.equal(p.blobs.length,0);assert.equal(p.downloads.length,0);
  }
});
test('identity changes are checked without relying on events and same-user events do not interrupt exports',async t=>{
  const p=await setup(t,{override:url=>{if(url.includes('section=orders'))p.setIdentity('client-b');}});
  await assert.rejects(p.download(),error=>error.code==='EXPORT_IDENTITY_CHANGED');assert.equal(p.blobs.length,0);
  const same=await setup(t,{override:(url,options,{win})=>{if(url.includes('section=messages'))win.dispatchEvent(new win.CustomEvent('rexbid:auth-state',{detail:{status:'authenticated'}}));}});
  assert.equal((await same.download()).ok,true);
});
test('page and byte caps fail loudly, with neither partial download nor silent truncation',async t=>{
  for(const options of [{maxPages:1},{maxBytes:1000}]) {
    const p=await setup(t);await assert.rejects(p.download(options),error=>['EXPORT_PAGE_LIMIT','EXPORT_TOO_LARGE'].includes(error.code));assert.equal(p.downloads.length,0);assert.equal(p.blobs.length,0);
  }
});
test('the real account button prevents concurrent submissions and reports successful full export',async t=>{
  let release,started,configurationReads=0;const gate=new Promise(resolve=>{started=resolve;});
  // The account screen reads this public capability once for its navigation;
  // the export must independently recheck it before choosing a download scope.
  const p=await setup(t,{auth:true,override:url=>url==='/api/portal/config' && ++configurationReads===2?new Promise(resolve=>{release=resolve;started();}):undefined});
  const button=p.doc.getElementById('accountDownload');button.click();await gate;button.dispatchEvent(new p.win.Event('click'));await flush();assert.equal(button.disabled,true);
  assert.equal(p.calls.filter(call=>call.url==='/api/portal/config').length,2);release(response(200,{ok:true,enabled:true}));await flush();
  assert.equal(p.downloads.length,1);assert.equal(p.doc.getElementById('accountDownload').disabled,false);assert.match(p.doc.getElementById('accountExportStatus').textContent,/własne importy/);
});
test('owner MFA failure displays a real administrative verification link and exports nothing',async t=>{
  const p=await setup(t,{auth:true,override:url=>url==='/api/portal/export'?response(403,{ok:false,error:'owner_mfa_required'}):undefined});
  p.doc.getElementById('accountDownload').click();await flush();assert.match(p.doc.getElementById('accountExportStatus').textContent,/2FA/);
  assert.equal([...p.doc.querySelectorAll('a')].find(link=>link.textContent==='Przejdź do potwierdzenia 2FA').getAttribute('href'),'/administracja.html');
  assert.equal(p.downloads.length,0);assert.equal(p.blobs.length,0);assert.equal(p.calls.some(call=>call.url==='/api/me/export'),false);
});
test('inactive authentication provides no export action and the original exportAccount API retains its shape',async t=>{
  const inactive=await setup(t,{auth:true,enabled:false});assert.equal(inactive.doc.getElementById('accountDownload'),null);assert.equal(inactive.calls.some(call=>call.url==='/api/portal/config'),false);
  const p=await setup(t,{auth:true}),configurationReads=p.calls.filter(call=>call.url==='/api/portal/config').length;
  const result=await p.win.RexBidAuth.exportAccount();assert.equal(result.ok,true);assert.equal(result.data.profile.id,'client-a');assert.equal(result.data.scope,undefined);
  assert.equal(configurationReads,1);assert.equal(p.calls.filter(call=>call.url==='/api/portal/config').length,configurationReads);
  const html=read('konto.html');assert.ok(html.indexOf('/rexbid-data-export.js')<html.indexOf('/rexbid-auth.js'));assert.match(html,/<script src="\/rexbid-data-export\.js(?:\?v=[A-Za-z0-9._-]+)?" defer>/);assert.match(html,/<script src="\/rexbid-auth\.js(?:\?v=[A-Za-z0-9._-]+)?" defer>/);
});
test('compatibility account button without the new module labels account and favorites only',async t=>{
  const p=await setup(t,{auth:true,module:false});p.doc.getElementById('accountDownload').click();await flush();assert.equal(p.downloads.length,1);
  const data=JSON.parse(await blobText(p.win,p.blobs[0]));assert.equal(data.scope,'account_favorites_only');assert.match(p.doc.getElementById('accountExportStatus').textContent,/nie obejmuje importów/);
});
test('request timeout and pagehide during late JSON parsing stop the export before a Blob exists',async t=>{
  const timed=await setup(t,{override:url=>url==='/api/portal/config'?new Promise(()=>{}):undefined});
  await assert.rejects(timed.download({timeoutMs:5}),error=>error.code==='EXPORT_TIMEOUT');assert.equal(timed.blobs.length,0);assert.equal(timed.win.RexBidDataExport.busy,false);
  let release,started;const waiting=new Promise(resolve=>{started=resolve;});
  const p=await setup(t,{override:url=>url.includes('section=messages')?{ok:true,status:200,json:()=>new Promise(resolve=>{release=resolve;started();})}:undefined});
  const result=p.download();await waiting;p.win.dispatchEvent(new p.win.Event('pagehide'));await assert.rejects(result,error=>error.code==='EXPORT_CANCELLED');
  release(exportPage('messages'));await flush();assert.equal(p.blobs.length,0);assert.equal(p.downloads.length,0);
});
test('the actual account logout clears the page while a pending export discards its late response',async t=>{
  let release,started;const waiting=new Promise(resolve=>{started=resolve;});
  const p=await setup(t,{auth:true,override:url=>url.includes('section=messages')?new Promise(resolve=>{release=resolve;started();}):undefined});
  p.doc.getElementById('accountDownload').click();await waiting;
  [...p.doc.querySelectorAll('button')].find(button=>button.textContent==='Wyloguj').click();await flush();
  assert.equal(p.win.RexBidAuth.status,'anonymous');assert.equal(p.doc.getElementById('accountDownload'),null);
  release(response(200,exportPage('messages')));await flush();assert.equal(p.blobs.length,0);assert.equal(p.downloads.length,0);
});
test('logout immediately cancels full and compatibility downloads while its POST is still pending',async t=>{
  for(const module of [true,false]) {
    let releaseExport,releaseLogout,exportStarted,logoutStarted;
    const exportWaiting=new Promise(resolve=>{exportStarted=resolve;}),logoutWaiting=new Promise(resolve=>{logoutStarted=resolve;});
    const p=await setup(t,{auth:true,module,override:url=>{
      if(url==='/api/auth/logout')return new Promise(resolve=>{releaseLogout=resolve;logoutStarted();});
      if(module?url.includes('section=messages'):url==='/api/me/export')return new Promise(resolve=>{releaseExport=resolve;exportStarted();});
    }});
    p.doc.getElementById('accountDownload').click();await exportWaiting;
    [...p.doc.querySelectorAll('button')].find(button=>button.textContent==='Wyloguj').click();await logoutWaiting;
    assert.equal(p.win.RexBidAuth.status,'authenticated','session lifecycle remains unchanged until the logout POST completes');
    releaseExport(response(200,module?exportPage('messages'):{ok:true,exported_at:AS_OF,profile:{id:'client-a',auth_provider:'email',email_verified:true},favorites:items('favorites')}));
    await flush();assert.equal(p.blobs.length,0,module?'full export':'compatibility export');assert.equal(p.downloads.length,0);
    assert.equal(p.calls.filter(call=>call.url==='/api/auth/logout').length,1);assert.equal(p.win.RexBidAuth.status,'authenticated');
    releaseLogout(response(200,{ok:true}));await flush();assert.equal(p.win.RexBidAuth.status,'anonymous');assert.equal(p.doc.getElementById('accountDownload'),null);
  }
});
