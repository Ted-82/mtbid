'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{render,links}=require('../scripts/build-navigation-shell.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pages=fs.readdirSync(path.join(root,'public')).filter(f=>f.endsWith('.html')&&read('public/'+f).includes('/rexbid-mobile-nav.js'));
for(const file of pages)test('first paint navigation is complete and reused: '+file,()=>{
 const html=read('public/'+file);assert.equal(render(html,file),html);
 // outside-only keeps noscript active in jsdom; model a scripting-enabled page.
 const dom=new JSDOM(html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/g,''),{url:'https://rexbid.pl/'+file,runScripts:'outside-only'}),d=dom.window.document;
 const before=Array.from(d.querySelectorAll('header nav.rex-primary-nav a'));
 assert.deepEqual(before.map(a=>a.getAttribute('href')),links.map(([,href])=>href));
 assert.equal(d.querySelectorAll('header .rex-menu-toggle').length,1);assert.ok(html.includes('<noscript data-rex-navigation-fallback>'));
 dom.window.eval(read('public/rexbid-mobile-nav.js'));
 const after=Array.from(d.querySelectorAll('header nav.rex-primary-nav a'));
 assert.equal(after.length,before.length);before.forEach((a,i)=>assert.equal(a,after[i],'bootstrap must retain the actual node'));
 const toggle=d.querySelector('.rex-menu-toggle');toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'true');
 d.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(d.activeElement,toggle);dom.window.close();
});
const source=read('worker.js'),fn=source.slice(source.indexOf('function renderInitialCatalogView('),source.indexOf('async function applySecurityHeaders('));
const ctx={URL};vm.createContext(ctx);vm.runInContext(fn+';globalThis.render=renderInitialCatalogView;',ctx);
test('server catalog first paint matches every supported client filter without reflecting user values',()=>{
 const html=read('public/index.html'),params=Array.from(html.matchAll(/param:\s*"([a-z_]+)"/g),m=>m[1]);assert.ok(params.length>=23);
 for(const key of ['catalog',...params]){
  const url=new URL('https://rexbid.pl/');url.searchParams.set(key,key==='catalog'?'1':'<script>injected</script>');
  const result=ctx.render(html,url),dom=new JSDOM(result),d=dom.window.document;
  assert.ok(d.body.classList.contains('rex-catalog-mode'),key);assert.equal(d.getElementById('catalogResults').hidden,false);assert.equal(d.getElementById('marketSections').hidden,true);
  assert.equal(d.getElementById('heroTitle').textContent,'Znajdź samochód. Sprawdź szczegóły.');assert.ok(!result.includes('<script>injected</script>'));dom.window.close();
 }
});
test('Home, empty filters and unrelated routes keep original markup',()=>{
 const html=read('public/index.html');for(const suffix of ['/','/?utm_source=test','/?make=','/?catalog=0','/kontakt?make=Tesla','/car?lot=123'])assert.equal(ctx.render(html,new URL('https://rexbid.pl'+suffix)),html);
 assert.match(source,/let html = renderInitialCatalogView\(await response.text\(\), url\)/);
});
