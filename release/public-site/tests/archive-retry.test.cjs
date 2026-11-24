'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('archive retry resumes the same cursor and keeps the first page and its gallery collapsed',async t=>{
  const dom=new JSDOM(read('archiwum.html'),{url:'https://rexbid.pl/archiwum',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window, urls=[];
  const row={platform:'iaai',lot:'12345678',title:'Test',vin:'AAAAAAAAAAAAAAAAA',status:'ended_unknown',recordedAt:'2026-11-18T10:00:00Z',saleCents:null,photos:['/archiwum-zdjecie/iaai/12345678/1/01.jpg']};
  w.fetch=async url=>{
    urls.push(url);
    if(urls.length===2)return {status:503,ok:false};
    return {status:200,ok:true,json:async()=>({entries:[{...row,lot:String(12345677+urls.length)}],next:urls.length===1?'1234':null})};
  };
  w.eval(read('rexbid-auction-archive.js'));await settle();
  const by=id=>w.document.getElementById(id),more=by('archive-next');
  assert.equal(by('archive-results').children.length,1);
  more.click();await settle();
  assert.equal(more.hidden,false,'retry is reachable');assert.equal(by('archive-results').children.length,1);
  more.click();await settle();
  assert.equal(urls[2],urls[1]);assert.equal(by('archive-results').children.length,2);
  assert.equal(more.hidden,true);assert.equal(by('archive-results').querySelectorAll('img').length,0);
});
