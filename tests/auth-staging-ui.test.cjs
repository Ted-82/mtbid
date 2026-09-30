const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const correlation = require('../staging/request-correlation.cjs');

const root = path.resolve(__dirname, '..');
const htmlModule = fs.readFileSync(path.join(root, 'staging/auth-test-page.js'), 'utf8');
const wrapper = fs.readFileSync(path.join(root, 'worker.staging.js'), 'utf8');
const authSource = fs.readFileSync(path.join(root, 'public/rexbid-auth.js'), 'utf8');
const html = htmlModule.match(/String\.raw`([\s\S]*?)`;\s*\n\s*export default/)[1];
const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].at(-1)?.[1] || '';

function stagingPage(auth, hostname = 'rexbid-auth-test.tedn828.workers.dev') {
  const elements = new Map();
  class Element {
    constructor(tag = 'div') { this.tagName=tag.toUpperCase();this.listeners={};this.children=[];this.dataset={};this.value='';this.checked=false;this.disabled=false;this.textContent=''; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    async click() { for(const fn of this.listeners.click||[]) await fn({preventDefault(){}}); }
    append(item) { this.children.push(item); }
    replaceChildren(...items) { this.children=[...items]; }
  }
  for(const [,id] of html.matchAll(/\bid="([^"]+)"/g)) elements.set(id,new Element());
  elements.get('phase-d-section').hidden=true;
  const document={body:new Element('body'),getElementById:id=>elements.get(id)||null,createElement:tag=>new Element(tag),querySelectorAll:()=>[],querySelector:()=>null};
  const windowListeners={};
  const window={RexBidAuth:auth,addEventListener(type,fn){(windowListeners[type] ||= []).push(fn);}};
  const context={window,document,location:{hostname},String,Promise,Error};
  vm.runInNewContext(inlineScript,context);
  return {elements,window,document};
}

function stagingPageWithRealAuth(fetchImpl, hostname = 'rexbid-auth-test.tedn828.workers.dev') {
  const elements=new Map();
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.listeners={};this.children=[];this.dataset={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.style={};this.attributes={};}
    addEventListener(type,fn){(this.listeners[type] ||= []).push(fn);}
    async click(){if(this.disabled)return;for(const fn of this.listeners.click||[])await fn({preventDefault(){}});}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=[...items];}
    setAttribute(name,value){this.attributes[name]=String(value);}
  }
  for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))elements.set(id,new Element());
  elements.get('phase-d-section').hidden=true;
  const windowListeners={};
  const location={hostname,pathname:'/auth-test.html',search:'',origin:`https://${hostname}`,hash:''};
  const storageMap=new Map();
  const localStorage={getItem:key=>storageMap.get(key)||null,setItem:(key,value)=>storageMap.set(key,String(value)),removeItem:key=>storageMap.delete(key)};
  const window={location,localStorage,fetch:fetchImpl,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,10)),clearTimeout,addEventListener(type,fn){(windowListeners[type] ||= []).push(fn);},dispatchEvent(event){for(const fn of windowListeners[event.type]||[])fn(event);},confirm:()=>false};
  const document={body:new Element('body'),getElementById:id=>elements.get(id)||null,createElement:tag=>new Element(tag),querySelectorAll:()=>[],querySelector:()=>null};window.document=document;
  class CustomEvent {constructor(type,init){this.type=type;this.detail=init?.detail;}}
  const context={window,document,location,localStorage,fetch:fetchImpl,CustomEvent,URL,URLSearchParams,Headers,Promise,Error,JSON,String,Number,Date,console};
  vm.runInNewContext(authSource,context);
  vm.runInNewContext(inlineScript,context);
  return {elements,window,document,storageMap,auth:window.RexBidAuth};
}

function jsonResponse(status,body){return {status,ok:status>=200&&status<300,headers:new Headers(),json:async()=>body};}

test('staging wrapper, test page and correlation helper parse; page loads shared Auth client', () => {
  for(const relative of ['worker.staging.js','staging/auth-test-page.js']) require('node:child_process').execFileSync(process.execPath,['--input-type=module','--check'],{input:fs.readFileSync(path.join(root,relative),'utf8'),stdio:['pipe','pipe','pipe']});
  require('node:child_process').execFileSync(process.execPath,['--check',path.join(root,'staging/request-correlation.cjs')],{stdio:['pipe','pipe','pipe']});
  assert.match(html,/<script src="\/rexbid-auth\.js"><\/script><script>/);
  assert.match(wrapper,/script-src 'self' 'unsafe-inline'/);
  assert.match(html,/<section id="phase-d-section" class="card" hidden>/);
});

test('staging stays isolated and delegates all auth/session/favorite operations to the shared RexBidAuth client', async () => {
  const calls=[]; const auth={enabled:true,status:'anonymous',user:null,ready:Promise.resolve(),getFavorites:()=>[],
    async signup(...args){calls.push(['signup',args]);return{ok:true,status:202,confirmationRequired:true};},
    async login(...args){calls.push(['login',args]);this.status='authenticated';this.user={id:'safe-id',auth_provider:'supabase',email_verified:true};return{ok:true,status:200,requestId:'request-id',setCookiePresent:true};},
    async refreshSession(){calls.push(['refresh']);return{ok:true,status:200};},
    async logout(){calls.push(['logout']);this.status='anonymous';this.user=null;},
    async addFavoriteIdentity(value){calls.push(['favorite-add',value]);return{ok:true,status:201};},
    async mergeFavoriteIdentities(value){calls.push(['favorite-merge',value]);return{ok:true,status:200,merged:1};},
    async removeFavorite(value){calls.push(['favorite-delete',value]);return true;},
    async bootstrap(){calls.push(['favorite-list']);return{status:this.status};}
  };
  const {elements}=stagingPage(auth);
  elements.get('email').value='test@example.invalid';elements.get('password').value='test-only-password';
  await elements.get('login').click();
  assert.equal(calls[0][0],'login');assert.deepEqual(calls[0][1].slice(0,2),['test@example.invalid','test-only-password']);
  assert.match(elements.get('signup-diagnostic').textContent,/Login #1: response HTTP 200/);
  assert.equal(elements.get('auth-state').textContent,'Authenticated');
  elements.get('favorite-lot').value='TEST-LOT';
  await elements.get('favorite-add').click();await elements.get('favorite-list').click();await elements.get('favorite-merge').click();await elements.get('favorite-delete').click();
  await elements.get('refresh').click();await elements.get('logout').click();
  assert.deepEqual(calls.map(([operation])=>operation),['login','favorite-add','favorite-list','favorite-merge','favorite-delete','refresh','logout']);
  assert.equal(elements.get('auth-state').textContent,'Anonymous');
  assert.equal(elements.get('me-facts').textContent,'');
  assert.equal(elements.get('favorite-list-output').children.length,0);
  const directFetches=[...inlineScript.matchAll(/\bfetch\s*\(\s*["']([^"']+)["']/g)].map(match=>match[1]);
  assert.deepEqual(directFetches,["/__staging/d1-sync-phase-d-discovery","/__staging/d1-sync-phase-g-backfill"],"test UI may call only its explicitly guarded staging sync endpoints directly");
  assert.doesNotMatch(inlineScript,/localStorage|sessionStorage|innerHTML|access_token|refresh_token/i);
  assert.match(inlineScript,/auth\.login\(/);assert.match(inlineScript,/auth\.signup\(/);assert.match(inlineScript,/auth\.refreshSession\(/);assert.match(inlineScript,/auth\.mergeFavoriteIdentities\(/);
});

test('staging test UI replaces its pending session message after anonymous bootstrap', async () => {
  const auth={enabled:true,status:'anonymous',user:null,ready:Promise.resolve(),getFavorites:()=>[]};
  const {elements}=stagingPage(auth);
  elements.get('auth-message').textContent='Sprawdzam sesję…';
  await auth.ready; await Promise.resolve();
  assert.equal(elements.get('auth-message').textContent,'Brak aktywnej sesji.');
  assert.equal(elements.get('auth-state').textContent,'Anonymous');
  assert.equal(elements.get('me-facts').textContent,'');
  assert.equal(elements.get('favorite-list-output').children.length,0);
});

test('staging UI waits for async auth bootstrap and gates Phase D on authenticated state', async()=>{
  let resolveReady;
  const auth={enabled:false,status:'anonymous',user:null,getFavorites:()=>[],ready:new Promise(resolve=>{resolveReady=resolve;})};
  const {elements}=stagingPage(auth);
  elements.get('auth-message').textContent='Sprawdzam sesję…';
  assert.equal(elements.get('phase-d-discovery').disabled,true);
  assert.equal(elements.get('auth-message').textContent,'Sprawdzam sesję…');
  auth.enabled=true;resolveReady();await auth.ready;await Promise.resolve();
  assert.equal(elements.get('phase-d-discovery').disabled,true,'an anonymous session cannot start Phase D');
  assert.equal(elements.get('phase-d-section').hidden,true,'Phase D action stays invisible to anonymous users');
  assert.equal(elements.get('login').disabled,false,'login remains available after anonymous bootstrap');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(elements.get('auth-message').textContent,'Brak aktywnej sesji.');
});

test('real Auth client + staging page bootstrap then click login, handle response and unlock Phase D only after authentication',async()=>{
  const calls=[];let meCount=0;
  const fetchImpl=async(url,options={})=>{
    calls.push([url,options.method||'GET']);
    if(url==='/api/auth/config')return jsonResponse(200,{ok:true,enabled:true});
    if(url==='/api/me')return ++meCount===1?jsonResponse(401,{ok:false}):jsonResponse(200,{ok:true,user:{id:'synthetic-user',auth_provider:'supabase',email_verified:true}});
    if(url==='/api/auth/login')return jsonResponse(200,{ok:true});
    if(url==='/api/me/favorites')return jsonResponse(200,{ok:true,favorites:[]});
    throw new Error('unexpected request');
  };
  const page=stagingPageWithRealAuth(fetchImpl);
  await page.auth.ready;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(page.elements.get('login').disabled,false);
  assert.equal(page.elements.get('phase-d-discovery').disabled,true);
  assert.equal(page.elements.get('phase-d-section').hidden,true);
  page.elements.get('email').value='test@example.invalid';page.elements.get('password').value='synthetic-password';
  await page.elements.get('login').click();
  assert.equal(calls.filter(([url,method])=>url==='/api/auth/login'&&method==='POST').length,1);
  assert.equal(page.elements.get('auth-state').textContent,'Authenticated');
  assert.equal(page.elements.get('phase-d-discovery').disabled,false);
  assert.equal(page.elements.get('phase-d-section').hidden,false);
  assert.match(page.elements.get('signup-diagnostic').textContent,/response HTTP 200/);
});

test('real staging page bootstrap settles after a hung /api/me fetch and leaves login available',async()=>{
  const calls=[];let aborted=false;
  const page=stagingPageWithRealAuth((url,options={})=>{
    calls.push(url);
    if(url==='/api/auth/config')return Promise.resolve(jsonResponse(200,{ok:true,enabled:true}));
    if(url==='/api/me'){
      options.signal?.addEventListener('abort',()=>{aborted=true;});
      return new Promise(()=>{});
    }
    throw new Error('unexpected request');
  });
  page.elements.get('auth-message').textContent='Sprawdzam sesję…';
  await Promise.race([page.auth.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('bootstrap remained pending')),250))]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['/api/auth/config','/api/me']);
  assert.equal(aborted,true,'the timed-out same-origin fetch is aborted');
  assert.equal(page.auth.enabled,true,'a failed session bootstrap does not disable configured Auth');
  assert.equal(page.elements.get('login').disabled,false,'login remains available after session lookup timeout');
  assert.equal(page.elements.get('signup').disabled,false);
  assert.equal(page.elements.get('phase-f-backfill').disabled,true,'a failed/anonymous bootstrap cannot expose backfill');
  assert.equal(page.elements.get('auth-message').textContent,'Brak aktywnej sesji.');
});

test('staging Auth login TypeError is attributed to request stage and can never unlock Phase D',async()=>{
  const calls=[];
  const page=stagingPageWithRealAuth(async(url,options={})=>{
    calls.push([url,options.method||'GET']);
    if(url==='/api/auth/config')return jsonResponse(200,{ok:true,enabled:true});
    if(url==='/api/me')return jsonResponse(401,{ok:false});
    if(url==='/api/auth/login')throw new TypeError('network failure');
    throw new Error('unexpected request');
  });
  await page.auth.ready;await new Promise(resolve=>setImmediate(resolve));
  page.elements.get('email').value='test@example.invalid';page.elements.get('password').value='synthetic-password';
  await page.elements.get('login').click();
  assert.match(page.elements.get('signup-diagnostic').textContent,/UI exception at login-request \(TypeError\)/);
  assert.equal(page.elements.get('auth-state').textContent,'Auth UI error');
  assert.equal(page.elements.get('phase-d-discovery').disabled,true);
  assert.equal(calls.filter(([url])=>url==='/__staging/d1-sync-phase-d-discovery').length,0);
});

test('staging page refuses to expose controls on production hostname', () => {
  const auth={enabled:false,status:'disabled',ready:Promise.resolve()};
  const page=stagingPage(auth,'mtbid.tedn828.workers.dev');
  assert.match(page.document.body.textContent,/wyłącznie na stagingowym Workerze/);
});

test('staging request correlation is random, round-trips safe metadata, and excludes request data', async () => {
  const id='a7f3d604-71bc-4fd5-9b07-0bb3f457c245';
  const request=new Request('https://rexbid-auth-test.tedn828.workers.dev/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'private@example.invalid',password:'private-password'})});
  const originalBody=await request.clone().text();assert.equal(correlation.authOperation(new URL(request.url).pathname),'login');
  const correlated=correlation.correlateRequest(request.clone(),'login',{randomUUID:()=>id});
  assert.equal(correlated.request.headers.get('X-RexBid-Request-ID'),id);assert.equal(await correlated.request.text(),originalBody);
  const logs=[];const response=correlation.correlateResponse(new Response(JSON.stringify({ok:true}),{status:200,headers:{'Set-Cookie':'__Host-rexbid_session=secret-cookie; HttpOnly'}}),id,'login',(...args)=>logs.push(args));
  assert.equal(response.headers.get('X-RexBid-Request-ID'),id);assert.equal(response.headers.get('X-RexBid-Set-Cookie'),'present');
  assert.deepEqual(JSON.parse(logs[0][1]),{operation:'login',stage:'response',request_id:id,http_status:200,set_cookie_present:true});
  assert.doesNotMatch(logs.flat().join(' '),/private@example|private-password|secret-cookie/);
});
