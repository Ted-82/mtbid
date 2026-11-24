'use strict';
// One shared, memory-only coordinator. No catalogue or customer storage is used.
const ORIGIN='https://rexbid.pl', SESSION='https://apibara.tech/live/v1/session', SOCKET='wss://apibara.tech/live/v1/socket';
const MAX_CHANNELS=4,MAX_VIEWERS=50,STALE_MS=30000;
const text=(v,max=180)=>typeof v==='string'?v.slice(0,max):null;
const lot=v=>/^\d{1,20}$/.test(String(v??''))?String(v):null;
const platform=v=>['copart','iaai'].includes(v)?v:null;
const money=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9?v:null;
const time=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
function fresh(at,now=Date.now()){const n=Date.parse(at||'');return Number.isFinite(n)&&n<=now+5000&&now-n<=STALE_MS;}
function card(v){if(!v||!lot(v.lot_number))return null;return{lot_number:lot(v.lot_number),title:text(v.title),status:text(v.status,60),current_bid:money(v.current_bid),sale_price:money(v.sale_price),observed_at:time(v.observed_at),next_source:text(v.next_source,60)};}
function lane(v){if(!v||typeof v!=='object')return null;return{previous:card(v.previous),current:card(v.current),next:card(v.next),observed_at:time(v.observed_at),stale:v.stale!==false,version:text(String(v.version??v.state_version??''),100)};}
function queue(v){if(!v||!Array.isArray(v.cars))return null;return{id:text(String(v.id??''),160),platform:platform(v.platform),label:text(v.label),auction_at:time(v.auction_at),source_order_unique:v.source_order_unique===true,selected_lot_number:lot(v.selected_lot_number),cars:v.cars.slice(0,2000).map(c=>({lot_number:lot(c.lot_number),title:text(c.title),line_number:typeof c.line_number==='number'?c.line_number:text(c.line_number,30),stored_bid:money(c.stored_bid),result_status:text(c.result_status,60)})).filter(c=>c.lot_number),truncated:v.cars.length>2000};}
function snapshot(ch,now=Date.now()) {const current=ch.lane?.current,at=current?.observed_at||ch.lane?.observed_at;
const isFresh=ch.connected===true&&ch.lane?.stale===false&&fresh(at,now);
const beforeScheduledStart=Date.parse(ch.queue?.auction_at||'')>now;
return{type:'snapshot',platform:ch.platform,connection:ch.connected?'connected':'reconnecting',code:ch.code||null,lane:ch.lane||null,queue:ch.queue||null,observed_at:at||null,fresh:isFresh,before_scheduled_start:beforeScheduledStart,bidding_now:isFresh&&current?.status==='Live'&&!beforeScheduledStart,server_time:new Date(now).toISOString()};}
function input(request){const u=new URL(request.url);return{platform:platform(u.searchParams.get('platform')),lot:lot(u.searchParams.get('lot'))};}
function error(status,code){return new Response(JSON.stringify({ok:false,code}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
async function handleLive(request,env){
 if(request.method!=='GET')return error(405,'method_not_allowed');
 if(new URL(request.url).origin!==ORIGIN||request.headers.get('Origin')!==ORIGIN)return error(403,'origin_not_allowed');
 if(env.REXBID_LIVE_ENABLED!=='enabled'||!env.REXBID_LIVE||!env.APIBARA_API_KEY)return error(503,'live_unavailable');
 const p=input(request);if(!p.platform||!p.lot)return error(400,'invalid_vehicle');
 if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return error(426,'websocket_required');
 // Separate namespace/keys from login limits; no impact on account access.
 if(!env.LIVE_RATE_LIMITER)return error(503,'live_unavailable');
 for(const key of ['all',request.headers.get('CF-Connecting-IP')||'unknown'])if(!(await env.LIVE_RATE_LIMITER.limit({key})).success)return error(429,'live_busy');
 return env.REXBID_LIVE.get(env.REXBID_LIVE.idFromName('shared-live-v1')).fetch(new Request(ORIGIN+'/api/live/socket?'+new URLSearchParams(p),{headers:{Upgrade:'websocket',Origin:ORIGIN}}));
}
class RexBidLive {
 constructor(state,env){this.env=env;this.channels=new Map();this.clients=new Map();this.sessionStarts=[];this.timer=null;}
 async fetch(request){
  const p=input(request);if(!p.platform||!p.lot||request.headers.get('Origin')!==ORIGIN)return error(400,'invalid_vehicle');
  if(this.clients.size>=MAX_VIEWERS)return error(429,'live_busy');
  let ch=Array.from(this.channels.values()).find(c=>c.platform===p.platform&&(c.lot===p.lot||c.queue?.cars.some(x=>x.lot_number===p.lot)));
  if(!ch&&this.channels.size>=MAX_CHANNELS)return error(429,'live_busy');
  if(!ch){ch={key:p.platform+':'+p.lot,platform:p.platform,lot:p.lot,viewers:new Set(),attempts:0,connected:false,lane:null,queue:null,closed:false};this.channels.set(ch.key,ch);}
  const [client,server]=Object.values(new WebSocketPair());server.accept();
  this.clients.set(server,{ch,last:Date.now(),lastPing:0});ch.viewers.add(server);
  server.addEventListener('message',e=>{const c=this.clients.get(server);if(!c)return;if(e.data!=='ping'||Date.now()-c.lastPing<10000){this.remove(server,1008);return;}c.lastPing=c.last=Date.now();this.send(server,{type:'pong'});});
  server.addEventListener('close',()=>this.remove(server));server.addEventListener('error',()=>this.remove(server));
  this.send(server,snapshot(ch));if(!ch.socket&&!ch.connecting&&!ch.retry)this.connect(ch);
  if(!this.timer)this.timer=setInterval(()=>this.tick(),15000);
  return new Response(null,{status:101,webSocket:client});
 }
 send(ws,value){try{ws.send(JSON.stringify(value));}catch{this.remove(ws);}}
 broadcast(ch){const value=snapshot(ch);for(const ws of Array.from(ch.viewers))this.send(ws,value);}
 remove(ws,code=1000){const c=this.clients.get(ws);if(!c)return;this.clients.delete(ws);c.ch.viewers.delete(ws);try{ws.close(code,'Live disconnected');}catch{}
  if(!c.ch.viewers.size){const ch=c.ch;ch.closed=true;clearTimeout(ch.retry);clearTimeout(ch.renew);clearTimeout(ch.authTimer);try{ch.socket?.close(1000,'No viewers');}catch{}this.channels.delete(ch.key);}
  if(!this.clients.size){clearInterval(this.timer);this.timer=null;}
 }
 tick(){for(const [ws,c] of this.clients)if(Date.now()-c.last>75000)this.remove(ws);for(const ch of this.channels.values())this.broadcast(ch);}
 retry(ch,minimum=0){if(ch.closed||ch.retry||ch.accessDenied)return;ch.connected=false;const delay=Math.max(minimum,Math.min(60000,2000*2**Math.min(ch.attempts++,5)))+Math.floor(Math.random()*1000);ch.retry=setTimeout(()=>{ch.retry=null;this.connect(ch);},delay);this.broadcast(ch);}
 async connect(ch){if(ch.closed||ch.connecting||ch.socket||ch.accessDenied)return;ch.connecting=true;let stage='session';
  try{
   const now=Date.now();this.sessionStarts=this.sessionStarts.filter(t=>now-t<60000);if(this.sessionStarts.length>=12){this.retry(ch,60000);return;}this.sessionStarts.push(now);
   const r=await fetch(SESSION,{method:'POST',redirect:'manual',headers:{'X-API-Key':this.env.APIBARA_API_KEY,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
   if(!r.ok){
    console.warn(JSON.stringify({component:'live-auction',stage,status:r.status}));
    ch.code='source_http_'+r.status;
    if(r.status===401||r.status===403){
     ch.accessDenied=true;
     ch.connected=false;
     this.broadcast(ch);
    }else this.retry(ch,r.status===429?300000:15000);
    return;
   }
   stage='session_contract';
   const s=await r.json();if(ch.closed)return;
   const expires=Date.parse(s.expires_at||'');
   if(s.websocket_url!==SOCKET||typeof s.token!=='string'||!Number.isFinite(expires)||expires<Date.now()+1000||expires>Date.now()+360000)throw Error('session_contract');
   stage='upgrade';const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),10000);let upgrade;
   try{upgrade=await fetch(SOCKET.replace('wss:','https:'),{headers:{Upgrade:'websocket'},redirect:'manual',signal:controller.signal});}finally{clearTimeout(deadline);}
   const ws=upgrade.webSocket;if(!ws)throw Error('upgrade');if(ch.closed){ws.accept();ws.close();return;}ch.socket=ws;ws.accept();
   const ended=()=>{if(ch.socket!==ws)return;ch.socket=null;ch.connected=false;clearTimeout(ch.renew);clearTimeout(ch.authTimer);ch.code='reconnecting';this.retry(ch);};
   ws.addEventListener('close',ended);ws.addEventListener('error',()=>{try{ws.close(1011,'Connection interrupted');}catch{}ended();});
   ws.addEventListener('message',e=>{if(ch.closed||ch.socket!==ws)return;try{
    if(typeof e.data!=='string'||e.data.length>2500000)return;const m=JSON.parse(e.data);
    if(m.type==='ready'){clearTimeout(ch.authTimer);ch.connected=true;ch.attempts=0;ch.code=null;ws.send(JSON.stringify({type:'watch_lot',platform:ch.platform,lot_number:ch.lot}));this.broadcast(ch);return;}
    if(m.type==='lane'){ch.lane=lane(m.data);this.broadcast(ch);}
    if(m.type==='queue'){const q=queue(m.data);ch.queue=q&&q.platform===ch.platform?q:null;this.broadcast(ch);}
    if(m.type==='error'){ch.code='source_unavailable';ch.connected=false;this.broadcast(ch);ws.close(1000,'Source unavailable');}
   }catch{ch.code='source_unavailable';ch.connected=false;this.broadcast(ch);}});
   ch.authTimer=setTimeout(()=>{try{ws.close(1000,'Authentication timeout');}catch{}ended();},7000);
   ch.renew=setTimeout(()=>{try{ws.close(1000,'Renew session');}catch{}ended();},Math.max(1000,Date.parse(s.expires_at)-Date.now()-5000));
   ws.send(JSON.stringify({type:'auth',token:s.token}));
  }catch(e){console.warn(JSON.stringify({component:'live-auction',stage,errorName:e?.name==='TypeError'?'TypeError':e?.name==='TimeoutError'?'TimeoutError':'Error'}));ch.code='source_'+stage+'_'+(e?.name==='TypeError'?'type':e?.name==='TimeoutError'?'timeout':'error');this.retry(ch,15000);}finally{ch.connecting=false;}
 }
}
module.exports={RexBidLive,handleLive,snapshot,card,lane,queue,fresh,input,MAX_CHANNELS,MAX_VIEWERS};
