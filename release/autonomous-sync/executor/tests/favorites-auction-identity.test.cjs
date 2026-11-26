const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const VIN='5YJ3E1EA3PF683202';
async function setup(t,cached){
  const dom=new JSDOM('<main><p class="device-note"></p><div id="counter"></div><div id="content"></div></main>',{url:'https://rexbid.pl/ulubione',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,calls=[];
  if(cached){w.localStorage.setItem('rex_bid_auth_cache_owner_v1','test-only-user');w.localStorage.setItem('rex_bid_cloud_favorites_v1:test-only-user',JSON.stringify([cached]));}
  w.fetch=async(url,options)=>{calls.push({url,method:options.method||'GET'});const data=url==='/api/auth/config'?{ok:true,enabled:true}:url==='/api/me'?{ok:true,user:{id:'test-only-user'}}:url==='/api/me/favorites'?{ok:true,favorites:[{vin:VIN,lot:'57660876',platform:'copart',created_at:'2026-10-20T10:00:00Z'}]}:null;assert.ok(data,'unexpected request '+url);return {ok:true,status:200,headers:new Headers(),json:async()=>data};};
  w.eval(fs.readFileSync(require.resolve('../public/rexbid-storage.js'),'utf8'));w.eval(fs.readFileSync(require.resolve('../public/rexbid-auth.js'),'utf8'));
  await w.RexBidAuth.ready;
  await w.RexBidAuth.mountFavoritesPage({content:w.document.getElementById('content'),counter:w.document.getElementById('counter'),storage:w.RexBidStorage});
  return {w,calls,link:w.document.querySelector('.cloud-favorite>a')};
}
test('cloud favorite retains VIN, exact LOT and platform in its detail link',async t=>{
  const p=await setup(t);const url=new URL(p.link.href);assert.equal(url.searchParams.get('vin'),VIN);assert.equal(url.searchParams.get('lot'),'57660876');assert.equal(url.searchParams.get('platform'),'copart');
  assert.equal(p.w.document.querySelector('[data-compare-lot]').dataset.compareLot,'57660876');assert.ok(p.calls.every(x=>x.method==='GET'));
});
test('same VIN cached under another LOT does not replace the server favorite identity or prices',async t=>{
  const p=await setup(t,{id:'vin:'+VIN,vin:VIN,lot:'99999999',platform:'iaai',title:'Wrong auction',pricing:{current_bid_usd:99999}});
  assert.equal(new URL(p.link.href).searchParams.get('lot'),'57660876');assert.doesNotMatch(p.w.document.body.textContent,/Wrong auction|99999999|99999 USD/);
  assert.equal(p.w.RexBidAuth.getFavorites()[0].platform,'copart');assert.deepEqual(Object.keys(p.w.RexBidAuth.getFavorites()[0].pricing),[]);
});
test('matching cached favorite keeps its title and observation without another detail request',async t=>{
  const p=await setup(t,{id:'vin:'+VIN,vin:VIN,lot:'57660876',platform:'copart',title:'Saved Tesla',read:{last_synced_at:'2026-10-08T10:00:00Z'}});
  assert.equal(p.link.textContent,'Saved Tesla');assert.equal(p.w.RexBidAuth.getFavorites()[0].read.last_synced_at,'2026-10-08T10:00:00Z');assert.equal(p.calls.some(x=>x.url.startsWith('/api/car/')),false);
});
