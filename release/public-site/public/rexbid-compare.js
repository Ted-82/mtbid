(function(root){
  'use strict';
  const KEY='rexbid.compare.v1', TTL=30*60*1000, LIMIT=3;
  const ref=value=>{
    const platform=String(value?.platform||value?.comparePlatform||'').toLowerCase(),lot=String(value?.lot||value?.compareLot||'');
    return ['copart','iaai'].includes(platform)&&/^\d{1,12}$/.test(lot)&&!/[\s]/.test(lot)?{platform,lot}:null;
  };
  const id=r=>r.platform+':'+r.lot;
  const clean=list=>{const seen=new Set();return (Array.isArray(list)?list:[]).map(ref).filter(r=>r&&!seen.has(id(r))&&seen.add(id(r))).slice(0,LIMIT);};
  function parse(value){
    if(typeof value!=='string'||value.length>160||/\s/.test(value))return [];
    const parts=value.split(',');
    if(parts.length>LIMIT||parts.some(v=>!/^(copart|iaai):\d{1,12}$/.test(v)))return [];
    return clean(parts.map(v=>{const [platform,lot]=v.split(':');return {platform,lot};}));
  }
  const href=items=>'/porownaj.html?items='+encodeURIComponent(clean(items).map(id).join(','));
  function restore(storage,now=Date.now()){
    try {const state=JSON.parse(storage?.getItem(KEY)||'null');
      if(!state)return [];
      if(state.version!==1||!Number.isFinite(state.savedAt)||now<state.savedAt||now-state.savedAt>TTL){storage.removeItem(KEY);return [];}
      return clean(state.items);
    }catch{return [];}
  }
  const num=value=>((typeof value==='number'||typeof value==='string'&&value.trim())&&Number.isFinite(Number(value))&&Number(value)>=0)?Number(value):null;
  const text=value=>typeof value==='string'||typeof value==='number'?String(value):'';
  const first=(...values)=>values.find(v=>v!==null&&v!==undefined&&v!=='');
  const money=v=>num(v)===null?'Brak danych':new Intl.NumberFormat('pl-PL',{maximumFractionDigits:2}).format(Number(v))+' USD';
  const auctionClock = new Intl.DateTimeFormat('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Warsaw', timeZoneName:'longOffset' });
  function date(value, auction = false){
    if(typeof value!=='string')return 'Nieustalona';
    if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('.');
    if(!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))return 'Nieustalona';
    if (auction) {
      if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return 'Nieustalona';
      const parts = auctionClock.formatToParts(new Date(value));
      const offset = parts.find(part => part.type === 'timeZoneName')?.value.replace(/^GMT/, 'UTC');
      return parts.filter(part => part.type !== 'timeZoneName').map(part => part.value).join('').trim() + ' · Polska' + (offset ? ' (' + offset + ')' : '');
    }
    return new Intl.DateTimeFormat('pl-PL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Warsaw'}).format(new Date(value));
  }
  function facts(car){
    const a=car.auction||{},p=car.pricing||{},c=car.condition||{},s=car.seller||{},loc=car.location||{};
    const outcome=text(a.outcome_status||a.last_sold_status).toLowerCase().replace(/[_-]/g,' '),state=text(a.state).toLowerCase();
    const approval=/on approval|approval pending|pending approval|awaiting approval/.test(outcome);
    const unsold=/not.?sold|no.?sale|unsold/.test(outcome)||['not_sold','no_sale'].includes(state);
    const sold=!approval&&!unsold&&(/\bsold\b/.test(outcome)||state==='sold');
    const terminal=approval||unsold||sold||['finished','closed','ended'].includes(state)||!!a.auction_ended_at;
    const price=terminal?null:(Object.prototype.hasOwnProperty.call(p,'current_bid_usd')?[p.current_bid_usd]:[p.current_bid2_usd]).map(num).find(value=>value!==null&&value>0)??null;
    const bn=terminal?null:num(p.buy_now_usd);
    const status=approval?'Oferta warunkowa — sprzedaż niepotwierdzona':unsold?'Nie sprzedano':sold?'Sprzedano':terminal?'Zakończona — wynik niepotwierdzony':'Dostępność do potwierdzenia';
    const translate=(kind,value)=>root.RexBidVehicleLabels?.label(kind,value)||text(value)||'Brak danych';
    const damage=value=>root.RexBidMarket?.damageLabel(value)||text(value)||'Brak danych';
    const fuel={gasoline:'Benzyna',gas:'Benzyna',diesel:'Diesel',electric:'Elektryczny',bev:'Elektryczny',hybrid:'Hybryda','plug-in hybrid':'Hybryda plug-in'};
    const gear={automatic:'Automatyczna',manual:'Manualna'};
    const mileage=car.odometer&&typeof car.odometer==='object'?text(car.odometer.formatted)||
      (num(car.odometer.value)!==null?new Intl.NumberFormat('pl-PL').format(Number(car.odometer.value))+' '+text(car.odometer.unit):''):text(car.odometer);
    const sellerType=text(s.type||car.seller_type).trim().toLowerCase();
    const locationName=text(loc.display||loc.name),locationState=text(loc.state);
    const locationLabel=locationName+(locationState&&!locationName.toUpperCase().endsWith('('+locationState.toUpperCase()+')')?' ('+locationState+')':'');
    return {
      'Platforma / LOT':text(car.platform).toUpperCase()+' / '+text(car.lot_number||car.lot),
      'VIN':text(car.vin)||'Brak danych',
      'Oferta z zapisu':terminal?'Nie dotyczy zakończonej aukcji':price===null?'Brak danych o ofercie':money(price),
      'Kup teraz z zapisu':bn!==null&&bn>0?money(bn):'Brak potwierdzonej ceny',
      'Cena sprzedaży':sold?money(first(p.sale_price_usd,p.final_price_usd)):'Sprzedaż niepotwierdzona',
      'Oferta warunkowa':approval?money(first(p.source_price_usd,p.final_price_usd))+' · nie jest ceną sprzedaży':'—',
      'Wynik / dostępność':status,
      'Data obserwacji':date(first(car.read?.last_synced_at,car.read?.last_seen_at,car.last_synced_at,car.last_seen_at)),
      'Termin z zapisu':date(first(a.timed_end_at,a.auction_at,a.full_date),true),
      'Rok':text(car.year)||'Brak danych',
      'Przebieg':mileage||'Brak danych',
      'Paliwo':fuel[text(car.fuel_type||car.fuel).toLowerCase()]||text(car.fuel_type||car.fuel)||'Brak danych',
      'Skrzynia':gear[text(car.transmission).toLowerCase()]||text(car.transmission)||'Brak danych',
      'Napęd':translate('drive',car.drive_type||car.drivetrain),
      'Stan pracy':translate('run',c.run_condition),
      'Uszkodzenie główne':damage(c.primary_damage),
      'Uszkodzenie dodatkowe':damage(c.secondary_damage),
      'Dokument':text(car.sale_document?.name||car.title_document)||'Brak danych',
      'Sprzedający':text(s.name||car.seller_name)||'Brak nazwy',
      'Typ sprzedającego':['insurance','insurance company','ubezpieczyciel'].includes(sellerType)?'Ubezpieczyciel — typ akceptowany przez REXBID':sellerType==='non-insurance company'?'Poza ubezpieczycielami':'Typ niepotwierdzony',
      'Lokalizacja':locationLabel||'Brak danych'
    };
  }
  function identity(car,requested){return !!car&&text(car.platform).toLowerCase()===requested.platform&&text(car.lot_number||car.lot)===requested.lot;}
  async function read(requested,fetchImpl=root.fetch,timeout=12000){
    const target=ref(requested);if(!target)return {error:'Nieprawidłowy identyfikator.',retry:false};
    const abort=new root.AbortController();let timer;
    const expired=new Promise((_,reject)=>{timer=root.setTimeout(()=>{abort.abort();reject(new Error('timeout'));},timeout);});
    try{
      const response=await Promise.race([fetchImpl('/api/car/'+target.lot+'?platform='+target.platform,{credentials:'omit',signal:abort.signal}),expired]);
      if(!response.ok)return {error:response.status===404?'Nie znaleziono zapisu tej oferty. Nie oznacza to sprzedaży.':'Nie udało się odczytać zapisu. Pozostałe auta są dostępne.',retry:response.status!==404};
      const body=await Promise.race([response.json(),expired]);
      if(body.ok!==true||!identity(body.data,target))return {error:'Nie potwierdzono zgodności platformy i numeru LOT. Dane nie zostały pokazane.',retry:false};
      return {car:body.data};
    }catch{return {error:'Odczyt nie powiódł się lub trwał zbyt długo. Spróbuj ponownie.',retry:true};}
    finally{root.clearTimeout(timer);}
  }
  function boot(){
    const doc=root.document;if(!doc)return;
    let storage;try{storage=root.sessionStorage;}catch{}
    let items=restore(storage),bar=null;
    const page=doc.querySelector('[data-compare-page]'),explicit=new URLSearchParams(root.location.search);
    if(page&&explicit.has('items'))items=parse(explicit.get('items'));
    const values=new Map(),pending=new Set();let differenceOnly=false;
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const notice=doc.createElement('div');notice.className='rex-compare-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');doc.body.append(notice);
    const persist=()=>{try{if(!storage&&items.length)throw Error('storage unavailable');if(items.length)storage?.setItem(KEY,JSON.stringify({version:1,savedAt:Date.now(),items}));else storage?.removeItem(KEY);}catch{notice.textContent='Wybór działa na tej stronie. Przeglądarka nie pozwala go zachować po przejściu dalej.';}};
    function refresh(){
      doc.querySelectorAll('[data-compare-lot]').forEach(b=>{
        const r=ref(b.dataset);if(!r){b.hidden=true;return;}
        const selected=items.some(x=>id(x)===id(r));b.setAttribute('aria-pressed',String(selected));b.textContent=selected?'✓ W porównaniu':'Porównaj';
        b.setAttribute('aria-label',(selected?'Usuń z porównania':'Dodaj do porównania')+': '+r.platform.toUpperCase()+' LOT '+r.lot);
      });
      if(page)return;
      if(!bar){bar=doc.createElement('aside');bar.className='rex-compare-bar';bar.setAttribute('aria-label','Wybrane auta do porównania');doc.body.append(bar);}
      bar.hidden=!items.length;doc.body.classList.toggle('has-compare-bar',!!items.length);
      bar.innerHTML='<span><strong>'+items.length+' / 3 auta</strong><small>Porównaj dane i ceny z zapisu</small></span><a href="'+esc(href(items))+'">Otwórz porównanie →</a><button type="button" data-compare-clear>Wyczyść</button>';
    }
    function render(){
      if(!page)return;
      const share=doc.querySelector('[data-compare-share]'),differences=doc.querySelector('[data-compare-differences]');
      if(items.length<2)differenceOnly=false;
      if(share)share.hidden=!items.length;
      if(differences){differences.disabled=items.length<2;differences.checked=differenceOnly;}
      if(!items.length){page.innerHTML='<div class="compare-empty"><h2>Wybierz auta, które chcesz zestawić</h2><p>W katalogu lub na karcie auta wybierz „Porównaj”. Możesz wybrać do trzech pojazdów.</p><a class="compare-primary" href="/?catalog=1#results">Wybierz auta z katalogu →</a></div>';return;}
      const returnPath=href(items),columns=items.map(r=>({r,result:values.get(id(r)),facts:values.get(id(r))?.car?facts(values.get(id(r)).car):null}));
      const keys=Object.keys(columns.find(v=>v.facts)?.facts||{});
      let visible=0;
      const rows=keys.map(key=>{
        const cells=columns.map(x=>x.facts?x.facts[key]:'—');
        // Failed columns cannot establish equality or differences in vehicle data.
        if(differenceOnly&&columns.every(x=>x.facts)&&new Set(cells).size===1)return '';
        visible++;
        return '<tr><th scope="row">'+esc(key)+'</th>'+cells.map(v=>'<td'+(key==='Typ sprzedającego'&&v.startsWith('Ubezpieczyciel')?' class="compare-insurance"':'')+'>'+esc(v)+'</td>').join('')+'</tr>';
      }).join('');
      page.innerHTML='<div class="compare-scroll" tabindex="0" role="region" aria-label="Tabela porównania; na telefonie przewiń w bok"><table><caption>Porównanie '+items.length+' pojazdów — dane zapisane w REXBID</caption><thead><tr><th scope="col">Parametr</th>'+columns.map(({r,result})=>{
        const c=result?.car,loading=!result||pending.has(id(r));
        const title=text(c?.title)||r.platform.toUpperCase()+' · LOT '+r.lot;
        const image=root.RexBidStorage?.snapshotFromVehicle?.(c)?.image||root.RexBidStorage?.safeImageUrl(c?.media?.thumbs?.[0]||c?.media?.items?.[0]||'')||'';
        const detail='/car.html?lot='+r.lot+'&platform='+r.platform+'&return_to='+encodeURIComponent(returnPath);
        const photoPlaceholder = loading ? 'Ładowanie zdjęcia…' : result?.error ? 'Zdjęcie niedostępne' : 'Brak zdjęcia';
        return '<th scope="col" class="compare-vehicle">'+(image?'<div class="compare-photo"><img src="'+esc(image)+'" alt="'+esc(title)+'" loading="lazy" decoding="async"><span hidden>Zdjęcie niedostępne</span></div>':'<div class="compare-photo compare-no-photo">'+photoPlaceholder+'</div>')+'<h2>'+esc(title)+'</h2><small>'+esc(r.platform.toUpperCase()+' · LOT '+r.lot)+'</small>'+(loading?'<p role="status">Odczyt zapisu…</p>':result?.error?'<p class="compare-error">'+esc(result.error)+'</p>'+(result.retry?'<button type="button" data-compare-retry="'+esc(id(r))+'">Ponów odczyt</button>':''):'')+'<a href="'+esc(detail)+'">Karta i kalkulator →</a><button type="button" data-compare-remove="'+esc(id(r))+'">Usuń z porównania</button></th>';
      }).join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+(differenceOnly&&keys.length&&!visible?'<p>Wybrane parametry są takie same.</p>':'');
      page.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.nextElementSibling.hidden=false;},{once:true}));
    }
    async function load(r){
      if(pending.has(id(r)))return;pending.add(id(r));render();
      const result=await read(r);pending.delete(id(r));values.set(id(r),result);render();
    }
    const updatePage=()=>{if(page){root.history.replaceState(null,'',href(items));render();}refresh();};
    doc.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-compare-lot],[data-compare-clear],[data-compare-remove],[data-compare-retry],[data-compare-share]');if(!button)return;
      if(button.hasAttribute('data-compare-share')){if(!root.navigator.clipboard?.writeText){notice.textContent='Skopiuj adres porównania z paska przeglądarki.';return;}root.navigator.clipboard.writeText(root.location.origin+href(items)).then(()=>{notice.textContent='Link do porównania skopiowany.';}).catch(()=>{notice.textContent='Skopiuj adres porównania z paska przeglądarki.';});return;}
      if(button.hasAttribute('data-compare-retry')){const r=items.find(x=>id(x)===button.dataset.compareRetry);if(r)load(r);return;}
      if(button.hasAttribute('data-compare-clear'))items=[];
      else if(button.hasAttribute('data-compare-remove'))items=items.filter(r=>id(r)!==button.dataset.compareRemove);
      else {const r=ref(button.dataset);if(!r)return;
        if(items.some(x=>id(x)===id(r)))items=items.filter(x=>id(x)!==id(r));
        else if(items.length===LIMIT){notice.textContent='Możesz porównać maksymalnie 3 auta. Usuń jedno, aby dodać kolejne.';return;}
        else items.push(r);
      }
      notice.textContent=items.length?'Wybrano '+items.length+' z 3 aut.':'Porównanie wyczyszczone.';persist();updatePage();
    });
    doc.querySelector('[data-compare-differences]')?.addEventListener('change',event=>{differenceOnly=event.target.checked;render();});
    // Only added vehicle controls trigger a refresh; toolbar rendering cannot loop.
    const observer=new root.MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches('[data-compare-lot]')||n.querySelector('[data-compare-lot]')))))refresh();});
    observer.observe(doc.body,{childList:true,subtree:true});refresh();render();
    if(page){persist();items.forEach(load);}
  }
  const api={KEY,TTL,LIMIT,ref,parse,clean,href,restore,facts,identity,read,boot};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.RexBidCompare=api;
  if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();}
})(typeof window!=='undefined'?window:globalThis);
