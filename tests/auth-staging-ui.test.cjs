const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const correlation = require('../staging/request-correlation.cjs');

const root = path.resolve(__dirname, '..');
const htmlModule = fs.readFileSync(path.join(root, 'staging/auth-test-page.js'), 'utf8');
const wrapper = fs.readFileSync(path.join(root, 'worker.staging.js'), 'utf8');
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
  const document={body:new Element('body'),getElementById:id=>elements.get(id)||null,createElement:tag=>new Element(tag)};
  const windowListeners={};
  const window={RexBidAuth:auth,addEventListener(type,fn){(windowListeners[type] ||= []).push(fn);}};
  const context={window,document,location:{hostname},String,Promise,Error};
  vm.runInNewContext(inlineScript,context);
  return {elements,window,document};
}

test('staging wrapper, test page and correlation helper parse; page loads shared Auth client', () => {
  for(const relative of ['worker.staging.js','staging/auth-test-page.js']) require('node:child_process').execFileSync(process.execPath,['--input-type=module','--check'],{input:fs.readFileSync(path.join(root,relative),'utf8'),stdio:['pipe','pipe','pipe']});
  require('node:child_process').execFileSync(process.execPath,['--check',path.join(root,'staging/request-correlation.cjs')],{stdio:['pipe','pipe','pipe']});
  assert.match(html,/<script src="\/rexbid-auth\.js"><\/script><script>/);
  assert.match(wrapper,/script-src 'self' 'unsafe-inline'/);
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
  assert.deepEqual(calls[0],['login',['test@example.invalid','test-only-password']]);
  assert.match(elements.get('signup-diagnostic').textContent,/Login #1: response HTTP 200/);
  assert.equal(elements.get('auth-state').textContent,'Authenticated');
  elements.get('favorite-lot').value='TEST-LOT';
  await elements.get('favorite-add').click();await elements.get('favorite-list').click();await elements.get('favorite-merge').click();await elements.get('favorite-delete').click();
  await elements.get('refresh').click();await elements.get('logout').click();
  assert.deepEqual(calls.map(([operation])=>operation),['login','favorite-add','favorite-list','favorite-merge','favorite-delete','refresh','logout']);
  assert.equal(elements.get('auth-state').textContent,'Anonymous');
  assert.equal(elements.get('me-facts').textContent,'');
  assert.equal(elements.get('favorite-list-output').children.length,0);
  assert.doesNotMatch(inlineScript,/\bfetch\s*\(|localStorage|sessionStorage|innerHTML|access_token|refresh_token/i);
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
