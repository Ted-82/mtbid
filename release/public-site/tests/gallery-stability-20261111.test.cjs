'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');
const code=html.slice(html.indexOf('  function setGalleryImage('),html.indexOf('\n  function bindPageEvents('));
function gallery(t, configure=()=>{}){
 const dom=new JSDOM('<img id="mainImage"><span id="mainImageUnavailable"></span><div id="thumbs"></div><span id="photoCount"></span><button id="openHd"></button><button id="prevPhoto"></button><button id="nextPhoto"></button>',{runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 configure(w);
 w.eval(`let photos=Array.from({length:24},(_,i)=>({large:'https://example.com/full-'+i+'.jpg',thumb:'https://example.com/thumb-'+i+'.jpg'})),photoIndex=0;
 const esc=v=>String(v),getTitle=()=> 'Test vehicle';
 ${code}
 globalThis.gallery={render:renderPhotos,select(i){photoIndex=i;renderPhotos();},setPhotos(items){photos=items;photoIndex=0;renderPhotos();},replace(){photos=photos.map(p=>({...p}));photos[4].thumb='https://example.com/updated.jpg';renderPhotos();}};`);
 w.gallery.render();return {w,d,strip:d.getElementById('thumbs'),api:w.gallery};
}
test('thirty photo changes preserve all 24 thumbnail images, scroll, failed-image state and keyboard focus',async t=>{
 const g=gallery(t),buttons=[...g.strip.querySelectorAll('button')],images=[...g.strip.querySelectorAll('img')];
 buttons[4].focus();g.strip.scrollTop=88;images[2].dispatchEvent(new g.w.Event('error'));
 const mutations=[];const observer=new g.w.MutationObserver(rows=>mutations.push(...rows));
 observer.observe(g.strip,{childList:true,subtree:true});
 for(let i=0;i<30;i++)g.api.select(i%24);
 await Promise.resolve();observer.disconnect();
 assert.equal(mutations.length,0,'switching photos does not remove, recreate or re-request thumbnails');
 assert.equal(g.d.activeElement,buttons[4]);assert.equal(g.strip.scrollTop,88);
 assert.deepEqual([...g.strip.querySelectorAll('img')],images);
 assert.equal(images[2].style.display,'none');assert.equal(buttons[2].querySelector('.thumb-unavailable').hidden,false);
 assert.equal(buttons.filter(b=>b.getAttribute('aria-pressed')==='true').length,1);
 assert.equal(buttons[5].getAttribute('aria-pressed'),'true');
 assert.match(g.d.getElementById('mainImage').src,/full-5.jpg$/);
});
test('changed source media refreshes the thumbnails once and keeps the focused thumbnail index',()=>{
 // t.after is provided below to close this minimal DOM in a synchronous test.
 const cleanup=[],g=gallery({after:fn=>cleanup.push(fn)});
 try{
  const old=g.strip.querySelectorAll('button')[4];old.focus();g.api.replace();
  const fresh=g.strip.querySelectorAll('button')[4];
  assert.notEqual(fresh,old);assert.equal(g.d.activeElement,fresh);
  assert.match(fresh.querySelector('img').src,/updated.jpg$/);
  fresh.click();assert.match(g.d.getElementById('mainImage').src,/full-4.jpg$/);
  assert.equal(g.strip.querySelectorAll('button')[4],fresh);
 }finally{cleanup.forEach(fn=>fn());}
});

for (const mobile of [true,false]) test((mobile ? "mobile" : "desktop")+" loads only intersecting thumbnails and retains the correct main resolution", t=>{
 let activeObserver;
 const g=gallery(t,w=>{
  w.matchMedia=()=>({matches:mobile});
  w.IntersectionObserver=class {
   constructor(notify,options){this.notify=notify;this.root=options.root;this.targets=new Set();activeObserver=this;}
   observe(node){this.targets.add(node);}
   unobserve(node){this.targets.delete(node);}
   disconnect(){this.targets.clear();}
  };
 });
 const buttons=[...g.strip.querySelectorAll(".thumb")];
 assert.equal(activeObserver.root,g.strip);
 assert.equal(activeObserver.targets.size,24);
 assert.equal(g.strip.querySelectorAll("img[src]").length,0);
 assert.match(g.d.getElementById("mainImage").src,mobile ? /thumb-0.jpg$/ : /full-0.jpg$/);
 assert.match(g.d.getElementById("photoCount").textContent,mobile ? /podgląd/ : /pełna rozdzielczość/);
 activeObserver.notify([{target:buttons[17],isIntersecting:true},{target:buttons[18],isIntersecting:false}],activeObserver);
 assert.match(buttons[17].querySelector("img").src,/thumb-17.jpg$/);
 assert.equal(buttons[18].querySelector("img").hasAttribute("src"),false);
 assert.equal(activeObserver.targets.has(buttons[17]),false);
 buttons[17].click();
 assert.match(g.d.getElementById("mainImage").src,mobile ? /thumb-17.jpg$/ : /full-17.jpg$/);
 assert.equal(g.strip.querySelectorAll("img[src]").length,1);
});
test("mobile can show the only image supplied without an IntersectionObserver",t=>{
 const g=gallery(t,w=>{w.matchMedia=()=>({matches:true});});
 g.api.setPhotos([{large:"https://example.com/one.jpg",thumb:"https://example.com/one.jpg"}]);
 assert.match(g.d.getElementById("mainImage").src,/one.jpg$/);
 assert.match(g.strip.querySelector("img").src,/one.jpg$/);
});

test("mobile Copart strip uses a compact source and falls back once, while the main image stays sharp",t=>{
 const g=gallery(t,w=>{w.matchMedia=()=>({matches:true});});
 const source="https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/1026/979c69392ac44e7490eb72e60ab7b043_ful.jpg";
 const small=source.replace("_ful","_thb");
 g.api.setPhotos([{thumb:source,large:source.replace("_ful","_hrs")}]);
 const thumb=g.strip.querySelector("img"),status=g.strip.querySelector(".thumb-unavailable");
 assert.equal(g.d.getElementById("mainImage").src,source);
 assert.equal(thumb.src,small);
 thumb.dispatchEvent(new g.w.Event("error"));
 assert.equal(thumb.src,source);
 assert.equal(status.hidden,true);
 thumb.dispatchEvent(new g.w.Event("error"));
 assert.equal(thumb.src,source);
 assert.equal(status.hidden,false);
 g.api.setPhotos([{thumb:source+"?opaque=1",large:source}]);
 assert.equal(g.strip.querySelector("img").src,source+"?opaque=1");
});
