(function(root){'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const price=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?new Intl.NumberFormat('pl-PL',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v):'Brak danych o cenie';
 const validLot=v=>/^\d{1,20}$/.test(String(v||''));
 const href=(platform,lot)=>'/car?'+new URLSearchParams({platform,lot});
 function freshness(s,now=Date.now()){const t=Date.parse(s?.lane?.current?.observed_at||s?.lane?.observed_at||'');return s?.connection==='connected'&&s?.lane?.stale===false&&Number.isFinite(t)&&t<=now+5000&&now-t<=30000;}
 function view(s,selected,now=Date.now()){
  const c=s?.lane?.current,ok=freshness(s,now),startsAt=Date.parse(s?.queue?.auction_at||''),beforeStart=Number.isFinite(startsAt)&&startsAt>now,bidding=ok&&c?.status==='Live'&&!beforeStart;
  const accessDenied=s?.code==='source_http_401'||s?.code==='source_http_403';
  const link=(x,label)=>x&&validLot(x.lot_number)?`<a href="${esc(href(s.platform,x.lot_number))}">${esc(label)}: ${esc(x.title||'LOT '+x.lot_number)} · ${esc(x.lot_number)}</a>`:'';
  const at=c?.observed_at||s?.lane?.observed_at;
  const stamp=at&&Number.isFinite(Date.parse(at))?new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(at)):null;
  if(!c)return `<p class="rex-live-status">${accessDenied?'Podgląd live jest niedostępny.':s?.connection==='connected'?'Brak bieżącej obserwacji licytowanego auta w tej sesji.':'Łączenie z podglądem live…'}</p><p class="rex-live-note">To nie oznacza zakończenia aukcji. Zapisane dane i kalkulator pozostają dostępne.</p>${queueView(s,selected)}`;
  const own=String(c.lot_number)===String(selected);
  const title=accessDenied?'Podgląd live jest niedostępny':beforeStart?'Przed planowanym startem sesji':bidding?'Licytowane teraz':ok?'Ostatnio obserwowane auto':'Dane live opóźnione';
  const scheduled=beforeStart?'<p class="rex-live-note">Planowany start sesji: '+esc(new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(startsAt)))+'. Cena może zmieniać się przed startem; nie potwierdza licytowania tego auta.</p>':'';
  return `<p class="rex-live-status${bidding?' is-live':''}">${title}</p>${scheduled}${link(c,'Auto w sesji')}<p class="rex-live-price">${esc(price(c.current_bid))}</p><p class="rex-live-note">${bidding?'Ostatnia zaobserwowana oferta':'Ostatnia zaobserwowana cena — nie jest potwierdzeniem aktualnej oferty'}${c.status&&c.status!=='Live'?' · status źródła: '+esc(c.status):''}</p><p>${own?(bidding?'To auto jest właśnie licytowane.':'To obserwacja auta z tej karty.'):'To inne auto w tej samej sesji; nie potwierdza licytacji wybranego pojazdu.'}</p>${stamp?'<p class="rex-live-note">Obserwacja: '+esc(stamp)+'</p>':''}<div class="rex-live-neighbours">${link(s.lane.previous,'Poprzednie')}${link(s.lane.next,s.lane.next?.next_source==='observed'?'Następne zaobserwowane':'Następne — podgląd kolejki')}</div>${queueView(s,selected)}`;
 }
 function queueView(s,selected){const q=s?.queue;if(!q?.cars?.length)return '';return `<details class="rex-live-queue"><summary>Kolejka sesji (${q.cars.length}${q.truncated?'+':''})</summary><p class="rex-live-note">${esc(q.label||'Sesja aukcyjna')}. Kolejność może się zmienić. Ceny w kolejce to zapis danych.</p><ol>${q.cars.filter(x=>validLot(x.lot_number)).map(x=>`<li${String(x.lot_number)===String(selected)?' class="is-selected"':''}><a href="${esc(href(s.platform,x.lot_number))}">${esc(x.title||'LOT '+x.lot_number)} · ${esc(x.lot_number)}</a>${String(x.lot_number)===String(selected)?' — wybrane auto':''}</li>`).join('')}</ol></details>`;}
 let active=null;
 function mount({vehicle,element}){
  active?.();const platform=String(vehicle?.platform||'').toLowerCase(),lot=String(vehicle?.lot_number||vehicle?.lot||'');
  if(!element||!['copart','iaai'].includes(platform)||!validLot(lot))return;
  element.innerHTML='<div class="rex-live-head"><h3>Podgląd licytacji live <small>beta</small></h3><button type="button" class="action secondary" data-live-toggle>Otwórz podgląd live</button></div><p class="rex-live-note">Zobacz auto aktualnie obserwowane w sesji i jego ofertę. Podgląd nie służy do składania ofert.</p><div data-live-body></div>';
  const button=element.querySelector('[data-live-toggle]'),body=element.querySelector('[data-live-body]');
  let desired=false,ws=null,retry=null,heartbeat=null,refresh=null,last=null,tries=0,disposed=false,lastMessageAt=0;
  const render=()=>{if(last){const html=view(last,lot);if(body.innerHTML===html)return;const open=body.querySelector('details')?.open,scroll=body.querySelector('ol')?.scrollTop;body.innerHTML=html;if(open&&body.querySelector('details'))body.querySelector('details').open=true;if(scroll&&body.querySelector('ol'))body.querySelector('ol').scrollTop=scroll;}};
  function close(){clearTimeout(retry);clearInterval(heartbeat);clearInterval(refresh);retry=heartbeat=refresh=null;const old=ws;ws=null;old?.close();}
  function connect(){if(disposed||!desired||document.hidden)return;close();body.textContent=last?'Ponowne łączenie z live…':'Łączenie z live…';
   const socket=new WebSocket('wss://rexbid.pl/api/live/socket?'+new URLSearchParams({platform,lot}));ws=socket;
   socket.onopen=()=>{if(ws!==socket)return;tries=0;lastMessageAt=Date.now();heartbeat=setInterval(()=>{if(socket.readyState===1)socket.send('ping');},30000);refresh=setInterval(()=>{
    if(Date.now()-lastMessageAt>45000){if(last)last.connection='reconnecting';close();body.textContent='Połączenie z live przerwane. Ponawiamy podgląd…';if(desired&&!disposed&&!document.hidden)retry=setTimeout(connect,5000);return;}render();
   },1000);};
   socket.onmessage=e=>{if(ws!==socket)return;let m;try{m=JSON.parse(e.data)}catch{return;}if(m.type==='snapshot'||m.type==='pong')lastMessageAt=Date.now();if(m.type==='snapshot'&&m.platform===platform){const expanded=body.querySelector('details')?.open;last=m;render();if(expanded&&body.querySelector('details'))body.querySelector('details').open=true;}};
   socket.onclose=()=>{if(ws!==socket)return;ws=null;clearInterval(heartbeat);clearInterval(refresh);if(last){last.connection='reconnecting';render();}else body.textContent='Podgląd chwilowo niedostępny lub zajęty. Spróbujemy ponownie; katalog i wycena działają niezależnie.';
    if(desired&&!disposed&&!document.hidden)retry=setTimeout(connect,Math.min(60000,5000*2**Math.min(tries++,4))+Math.random()*1500);};
   socket.onerror=()=>{};
  }
  button.onclick=()=>{desired=!desired;button.textContent=desired?'Zamknij live':'Otwórz podgląd live';if(desired)connect();else{close();body.textContent='Podgląd live zamknięty.';last=null;}};
  const visibility=()=>{if(document.hidden){close();if(last){last.connection='reconnecting';render();}}else if(desired)connect();};
  document.addEventListener('visibilitychange',visibility);const pagehide=()=>close();root.addEventListener('pagehide',pagehide);
  active=()=>{disposed=true;desired=false;close();document.removeEventListener('visibilitychange',visibility);root.removeEventListener('pagehide',pagehide);};return active;
 }
 const api={mount,view,freshness,price};root.RexBidLive=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
