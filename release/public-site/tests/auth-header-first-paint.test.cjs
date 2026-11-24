'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pages=fs.readdirSync(path.join(root,'public')).filter(f=>f.endsWith('.html')&&read('public/'+f).includes('/rexbid-auth.js'));
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('account controls have a static empty slot before any session request on every auth page',()=>{
 for(const file of pages){const dom=new JSDOM(read('public/'+file));try{const slots=dom.window.document.querySelectorAll('header [data-rexbid-auth-nav]');assert.equal(slots.length,1,file);assert.equal(slots[0].children.length,0,file+': unknown session must not claim signed-in/out state');assert.ok(slots[0].classList.contains('rexbid-auth-nav'));}finally{dom.window.close();}}
});
test('slow session discovery reuses reserved header node and keeps private requests uncached',async()=>{
 for(const authenticated of [false,true]){
  const dom=new JSDOM(read('public/index.html'),{url:'https://rexbid.pl/',runScripts:'outside-only'}),w=dom.window,d=w.document,slot=d.querySelector('[data-rexbid-auth-nav]'),calls=[];let finish;
  w.fetch=async(url,options)=>{calls.push({url,options});if(url==='/api/auth/config')return new Promise(resolve=>{finish=()=>resolve(response({ok:true,enabled:true}));});if(url==='/api/me')return authenticated?response({ok:true,user:{id:'header-test'}}):response({ok:false},401);if(url==='/api/me/favorites')return response({ok:true,favorites:[]});throw Error('unexpected '+url);};
  try{w.eval(read('public/rexbid-auth.js'));assert.equal(d.querySelector('[data-rexbid-auth-nav]'),slot);assert.equal(slot.children.length,0);finish();await w.RexBidAuth.ready;assert.equal(d.querySelector('[data-rexbid-auth-nav]'),slot);assert.equal(slot.children.length,2);assert.equal(slot.firstElementChild.textContent,authenticated?'Moje konto':'Zaloguj');assert.equal(d.querySelectorAll('[data-rexbid-auth-nav]').length,1);for(const call of calls){assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.cache,'no-store');}assert.equal(d.querySelectorAll('body>style').length,0,'styles must exist before network settles');}finally{dom.window.close();}
 }
});
test('disabled auth never populates a misleading account control or accesses private endpoints',async()=>{
 const dom=new JSDOM(read('public/index.html'),{url:'https://rexbid.pl/',runScripts:'outside-only'}),calls=[];dom.window.fetch=async(url)=>{calls.push(url);return response({ok:true,enabled:false});};try{dom.window.eval(read('public/rexbid-auth.js'));await dom.window.RexBidAuth.ready;assert.equal(dom.window.document.querySelector('[data-rexbid-auth-nav]').children.length,0);assert.deepEqual(calls,['/api/auth/config']);}finally{dom.window.close();}
});
test('header styles reserve consistent account space and narrow phones wrap rather than overflow',()=>{
 const css=read('public/rexbid-brand.css');assert.match(css,/inline-size:190px;min-block-size:38px;flex:0 0 190px/);assert.match(css,/@media\(max-width:420px\)[\s\S]*flex-wrap:wrap/);assert.match(css,/flex:1 0 100%;inline-size:100%/);assert.match(css,/data-rexbid-publication-phase="catalog"[\s\S]*rexbid-auth-nav\{display:none\}/);
 const hash=crypto.createHash('sha256').update(read('public/rexbid-auth.js').replace(/\r\n/g,'\n')).digest('hex').slice(0,12);for(const file of pages)assert.ok(read('public/'+file).includes('/rexbid-auth.js?v='+hash),file);
});
