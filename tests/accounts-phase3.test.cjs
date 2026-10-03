const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const authSource = fs.readFileSync(path.join(root, 'public/rexbid-auth.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(root, 'public/rexbid-storage.js'), 'utf8');

function makeResponse(status, body = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(), json: async () => body };
}

function setup(fetchImpl, { hostname = 'rexbid-auth-test.tedn828.workers.dev', pathname = '/konto.html', search = '', guest = [] } = {}) {
  const values = new Map();
  if (guest.length) values.set('rex_bid_local_v1', JSON.stringify({ schema:'rex-bid-local', version:1, legacy_migrated:true, favorites:guest }));
  const localStorage = { getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,String(value)), removeItem:key => values.delete(key) };
  const elements = new Map();
  class Element {
    constructor(id = '') { this._id=id; this.dataset={}; this.style={}; this.listeners={}; this.children=[]; this.value=''; this.textContent=''; this.hidden=false; this.disabled=false; this.attributes={}; this.className=''; this.parentElement=null; this.href=''; }
    get id() { return this._id; }
    set id(value) { this._id=value; if (this.map && value) this.map.set(value,this); }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    setAttribute(name,value) { this.attributes[name]=String(value); }
    append(...items) { for (const item of items) { if (item && typeof item === 'object') item.parentElement=this; this.children.push(item); } }
    replaceChildren(...items) { this.children=[]; this.append(...items); }
    after(item) { this.afterItem=item; }
    querySelector(selector) { return selector === 'button[type="submit"]' ? this.children.find(child => child.type === 'submit') || null : null; }
    async fire(name, event = {}) { for (const fn of this.listeners[name] || []) await fn({ preventDefault(){}, ...event }); }
    async click() { await this.fire('click'); }
  }
  const ids = ['name','email','password','terms','registerForm','loginForm','message','favoriteCount','resendConfirmation','accountAuthMount'];
  for (const id of ids) elements.set(id,new Element(id));
  elements.get('password').parentElement = new Element('password-group');
  const main = new Element('main'), layout = new Element('layout'), header = new Element('header-inner');
  const document = {
    readyState:'loading', body:new Element('body'),
    getElementById:id => elements.get(id) || null,
    createElement:tag => { const el = new Element(tag); el.map=elements; el.tagName=tag.toUpperCase(); return el; },
    createTextNode:text => ({ textContent:String(text) }),
    addEventListener(name,fn) { if (name === 'DOMContentLoaded') this.domReady=fn; },
    querySelector(selector) { if (selector === 'header .header-inner, header .container') return header; if (selector === 'main') return main; if (selector === 'main .layout') return layout; if (selector === '[data-rexbid-auth-nav]') return null; return null; },
    querySelectorAll() { return []; }
  };
  const listeners = {};
  const location = { hostname, pathname, search, origin:'https://'+hostname, assigned:'', assign(value){this.assigned=value;} };
  class CustomEvent { constructor(type,init={}) { this.type=type; this.detail=init.detail; } }
  let activeFetch = fetchImpl;
  const pageFetch = async (url, options) => url === '/api/auth/config'
    ? makeResponse(200, { ok:true, enabled:hostname === 'rexbid-auth-test.tedn828.workers.dev' })
    : activeFetch(url, options);
  const window = {
    location, localStorage, document, fetch:pageFetch, AbortController, setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,10)), clearTimeout, confirm:()=>true,
    dispatchEvent(event) { for (const fn of listeners[event.type] || []) fn(event); },
    addEventListener(name,fn) { (listeners[name] ||= []).push(fn); }
  };
  const context = { window, document, location, localStorage, fetch:pageFetch, CustomEvent, URL, URLSearchParams, Headers, Promise, JSON, String, Number, Date, Error, console };
  vm.runInNewContext(storageSource, context);
  vm.runInNewContext(authSource, context);
  return { window, document, elements, main, layout, header, values, location, ready:window.RexBidAuth.ready, setFetch(fn) { activeFetch=fn; } };
}

test('normal account pages enable real auth only on the exact isolated staging host', async () => {
  let productionCalls=0;
  const prod=setup(async()=>{productionCalls++;return makeResponse(401);},{hostname:'mtbid.tedn828.workers.dev'});
  assert.equal(prod.window.RexBidAuth.enabled,false); await prod.ready; assert.equal(productionCalls,0);
  const staging=setup(async()=>makeResponse(401)); await staging.ready;
  assert.equal(staging.window.RexBidAuth.enabled,true);
});

test('registration UI validates confirmation and submits only email/password to the staging BFF', async () => {
  const calls=[];
  const page=setup(async(url,options={})=>{calls.push([url,options]); return url==='/api/me' ? makeResponse(401) : makeResponse(202,{ok:true,confirmation_required:true});},{pathname:'/rejestracja.html'});
  await page.ready;
  assert.equal(page.window.RexBidAuth.enabled, true);
  page.elements.get('name').value='Test User'; page.elements.get('terms').checked=true;
  const form=page.elements.get('registerForm');
  page.elements.get('email').value='new@example.invalid'; page.elements.get('password').value='temporary-password';
  const confirm=page.elements.get('passwordConfirm'); assert.ok(confirm); confirm.value='different-password';
  await form.fire('submit'); assert.equal(calls.some(([url])=>url==='/api/auth/signup'),false);
  confirm.value='temporary-password'; await form.fire('submit');
  const signup=calls.find(([url])=>url==='/api/auth/signup'); assert.ok(signup);
  assert.deepEqual(JSON.parse(signup[1].body),{email:'new@example.invalid',password:'temporary-password'});
  assert.equal(page.elements.get('message').textContent,'Jeśli można utworzyć konto, wysłaliśmy wiadomość z potwierdzeniem.');
  assert.equal([...page.values.keys()].some(key=>/token|password/i.test(key)),false);
});

test('login page explains invalid or expired confirmation links without revealing account state', async () => {
  const page=setup(async()=>makeResponse(401),{pathname:'/logowanie.html',search:'?auth=failed'});
  assert.match(page.elements.get('message').textContent,/nieprawidłowy lub wygasł/i);
  assert.doesNotMatch(page.elements.get('message').textContent,/konto (istnieje|nie istnieje)/i);
});

test('unverified callback state exposes neutral resend action using the shared BFF client', async () => {
  const calls=[];
  const page=setup(async(url,options={})=>{calls.push([url,options]);return makeResponse(url==='/api/auth/resend-confirmation'?202:401,{ok:url==='/api/auth/resend-confirmation'});},{pathname:'/logowanie.html',search:'?auth=verify-email'});
  const resend=page.elements.get('resendConfirmation');
  assert.equal(resend.hidden,false);
  assert.match(page.elements.get('message').textContent,/przyciskiem poniżej/i);
  page.elements.get('email').value='owner@example.test';
  await resend.click();
  assert.ok(calls.some(([url,options])=>url==='/api/auth/resend-confirmation'&&options.method==='POST'));
  assert.match(page.elements.get('message').textContent,/jeśli adres jest powiązany/i);
});

test('login UI posts to BFF, verifies session via /api/me and redirects only to same-origin path', async () => {
  const calls=[]; let meCount=0;
  const page=setup(async(url,options={})=>{calls.push([url,options]); if(url==='/api/me') return ++meCount===1 ? makeResponse(401) : makeResponse(200,{ok:true,user:{id:'u-1',auth_provider:'email',email_verified:true}}); if(url==='/api/auth/login') return makeResponse(200,{ok:true}); return makeResponse(200,{ok:true,favorites:[]});},{pathname:'/logowanie.html'});
  await page.ready; page.location.search='?return_to=%2Fulubione.html';
  page.elements.get('email').value='user@example.invalid'; page.elements.get('password').value='temporary-password';
  await page.elements.get('loginForm').fire('submit');
  assert.ok(calls.some(([url,opts])=>url==='/api/auth/login'&&opts.method==='POST'));
  assert.equal(page.location.assigned,'/ulubione.html');
  assert.equal(page.values.has('access_token'),false); assert.equal(page.values.has('refresh_token'),false);
});

test('account page shows only safe authenticated account data and login link for anonymous user', async () => {
  const accountHtml=fs.readFileSync(path.join(root,'public/konto.html'),'utf8');
  assert.match(accountHtml,/id="accountAuthMount"/,'account content is rendered from authenticated session state');
  assert.doesNotMatch(accountHtml,/data-coming-soon|funkcja niedostępna|Użytkownik REX\.Bid|Dostęp po uruchomieniu kont/,'account page must not advertise dead or fabricated controls/data');
  const userPage=setup(async url=>url==='/api/me'?makeResponse(200,{ok:true,user:{id:'u-safe',auth_provider:'email',email_verified:true}}):makeResponse(200,{ok:true,favorites:[]}),{pathname:'/konto.html'});
  await userPage.ready; await userPage.window.RexBidAuth.mountAccountPage();
  const rendered=JSON.stringify(userPage.elements.get('accountAuthMount').children.map(child=>child.textContent));
  assert.match(rendered,/e-mail potwierdzony/); assert.match(rendered,/email/); assert.doesNotMatch(rendered,/access_token|refresh_token/);
  const anonymous=setup(async()=>makeResponse(401),{pathname:'/konto.html'}); await anonymous.ready; await anonymous.window.RexBidAuth.mountAccountPage();
  assert.ok(anonymous.elements.get('accountAuthMount').children.some(child=>child.href==='/logowanie.html?return_to=%2Fkonto.html'));
});

test('authenticated favorite add/remove use cloud API and retain account-scoped cache only', async () => {
  const calls=[]; let cloud=[];
  const page=setup(async(url,options={})=>{calls.push([url,options]); if(url==='/api/me')return makeResponse(200,{ok:true,user:{id:'acct-a',auth_provider:'email',email_verified:true}}); if(url==='/api/me/favorites'&&options.method==='GET')return makeResponse(200,{ok:true,favorites:cloud}); if(url==='/api/me/favorites'&&options.method==='POST'){const body=JSON.parse(options.body);cloud=[{...body,created_at:'now'}];return makeResponse(201,{ok:true});} if(url.includes('/api/car/'))return makeResponse(200,{ok:true,data:{vin:'1HGCM82633A004352',lot:'LOT-1',platform:'copart',year:2003,make:'Honda',model:'Accord'}}); if(options.method==='DELETE'){cloud=[];return makeResponse(200,{ok:true});} return makeResponse(200,{ok:true});});
  await page.ready;
  const vehicle={vin:'1HGCM82633A004352',lot:'LOT-1',platform:'copart',year:2003,make:'Honda',model:'Accord'};
  await page.window.RexBidAuth.toggleFavorite(vehicle);
  assert.ok(calls.some(([url,opts])=>url==='/api/me/favorites'&&opts.method==='POST'));
  assert.equal(page.window.RexBidStorage.getFavorites().length,1);
  assert.equal(calls.some(([url])=>url.startsWith('/api/car/')),false,'cached favorite avoids upstream detail fan-out');
  await page.window.RexBidAuth.removeFavorite(page.window.RexBidStorage.getFavorites()[0].id);
  assert.ok(calls.some(([url,opts])=>url.includes('/api/me/favorites/')&&opts.method==='DELETE'));
});

test('guest favorites remain local and VIN/LOT-only identity stays exact', async () => {
  const guest=[{vin:'1HGCM82633A004352',platform:'copart',title:'Honda'}, {lot:'LOT-7',platform:'iaai',title:'LOT vehicle'}];
  const page=setup(async()=>makeResponse(401),{guest}); await page.ready;
  assert.equal(page.window.RexBidStorage.getFavorites().length,2);
  assert.equal(page.window.RexBidStorage.detailHref({lot:'LOT-7'}),'/car.html?lot=LOT-7');
  assert.equal(page.window.RexBidStorage.getGuestFavorites().length,2);
});

test('guest favorites merge with identifiers only and are retained after merge failure', async () => {
  let mergeStatus=500; const calls=[];
  const guest=[{vin:'1HGCM82633A004352',platform:'copart',title:'Honda'}];
  const page=setup(async(url,options={})=>{calls.push([url,options]); if(url==='/api/me')return makeResponse(200,{ok:true,user:{id:'acct-a',auth_provider:'email',email_verified:true}}); if(url==='/api/me/favorites'&&options.method==='GET')return makeResponse(200,{ok:true,favorites:[]}); if(url.endsWith('/merge'))return makeResponse(mergeStatus,{ok:mergeStatus<300}); return makeResponse(200,{ok:true});},{guest});
  await page.ready;
  assert.equal(await page.window.RexBidAuth.mergeGuestFavorites(),false);
  assert.equal(page.window.RexBidStorage.getGuestFavorites().length,1);
  const merge=calls.find(([url])=>url.endsWith('/merge'));
  assert.deepEqual(JSON.parse(merge[1].body),{favorites:[{vin:'1HGCM82633A004352',platform:'copart'}]});
  mergeStatus=200; assert.equal(await page.window.RexBidAuth.mergeGuestFavorites(),true);
  assert.equal(page.window.RexBidStorage.getGuestFavorites().length,0);
});

test('401 and logout clear account cache and rendered favorite source before anonymous state', async () => {
  let force401=false; const page=setup(async(url,options={})=>{
    if(url==='/api/me')return force401?makeResponse(401):makeResponse(200,{ok:true,user:{id:'acct-a',auth_provider:'email',email_verified:true}});
    if(url==='/api/me/favorites'&&options.method==='GET')return makeResponse(200,{ok:true,favorites:[{vin:'1HGCM82633A004352',platform:'copart'}]});
    if(url==='/api/auth/logout')return makeResponse(200,{ok:true});
    if(url.startsWith('/api/car/'))return makeResponse(200,{ok:true,data:{vin:'1HGCM82633A004352',platform:'copart',year:2003,make:'Honda',model:'Accord'}});
    return makeResponse(401,{ok:false});
  });
  await page.ready; await page.window.RexBidAuth.mountAccountPage();
  assert.equal(page.window.RexBidAuth.getFavorites().length,1);
  const accountHost=page.elements.get('accountAuthMount');
  assert.match(accountHost.children.map(item=>item.textContent).join(' '),/Status: zalogowano/);
  force401=true; await page.window.RexBidAuth.removeFavorite('vin:1HGCM82633A004352');
  assert.equal(page.window.RexBidAuth.status,'anonymous'); assert.equal(page.window.RexBidAuth.getFavorites().length,0);
  const accountText=JSON.stringify(accountHost.children.map(item=>item.textContent));
  assert.doesNotMatch(accountText,/Status: zalogowano|Ulubione w chmurze/);
  assert.match(accountText,/Zaloguj się do konta/);
  force401=false; await page.window.RexBidAuth.bootstrap?.();
  await page.window.RexBidAuth.logout();
  assert.equal(page.window.RexBidAuth.status,'anonymous');
});

test('switching account discards the prior account cache before loading new favorites', async () => {
  const page=setup(async()=>makeResponse(401));
  page.values.set('rex_bid_auth_cache_owner_v1','acct-old'); page.values.set('rex_bid_cloud_favorites_v1:acct-old','[{"id":"vin:OLD"}]');
  // Simulate the account response changing on a subsequent bootstrap.
  page.setFetch(async url=>url==='/api/me'?makeResponse(200,{ok:true,user:{id:'acct-new',auth_provider:'email',email_verified:true}}):makeResponse(200,{ok:true,favorites:[]}));
  await page.window.RexBidAuth.bootstrap();
  assert.equal(page.values.has('rex_bid_cloud_favorites_v1:acct-old'),false);
  assert.equal(page.values.get('rex_bid_auth_cache_owner_v1'),'acct-new');
});

test('normal public HTML references the same gated auth client on the four account surfaces', () => {
  for (const page of ['rejestracja.html','logowanie.html','konto.html','ulubione.html','index.html','car.html']) {
    assert.match(fs.readFileSync(path.join(root,'public',page),'utf8'),/<script src="\/rexbid-auth\.js"><\/script>/,page);
  }
  assert.match(authSource,/\/api\/auth\/config/);
  assert.doesNotMatch(authSource,/STAGING_HOST/);
  assert.match(authSource,/cache:\s*"no-store"/);
  assert.doesNotMatch(authSource,/access_token|refresh_token|sessionStorage|innerHTML/);
});
