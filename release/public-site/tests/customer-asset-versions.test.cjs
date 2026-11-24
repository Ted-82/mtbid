'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../public');
for(const asset of ['rexbid-market.js','rexbid-delivered-view.js'])test('customer pages request current content version: '+asset,()=>{
 const expected=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,asset),'utf8').replace(/\r\n/g,'\n')).digest('hex').slice(0,12);let count=0;
 for(const file of fs.readdirSync(root).filter(x=>x.endsWith('.html'))){const html=fs.readFileSync(path.join(root,file),'utf8');for(const match of html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/g)){const url=new URL(match[1],'https://rexbid.pl');if(url.pathname==='/'+asset){count++;assert.equal(url.searchParams.get('v'),expected,file+' must invalidate the old cached script');}}}
 assert.ok(count>0);
});
