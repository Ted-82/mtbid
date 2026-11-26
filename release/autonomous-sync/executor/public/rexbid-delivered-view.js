(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RexBidDeliveredView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '' ? null
    : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const money = (value, currency = 'PLN') => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? 'Do wyceny' : new Intl.NumberFormat('pl-PL', {style:'currency',currency,maximumFractionDigits:currency === 'PLN' ? 0 : 2}).format(Number(value));
  function contextFor(vehicle, transport, profile) {
    const ctx = transport.terminalFrom(vehicle), match = transport.matchingLocation(transport.rates, ctx);
    const row = match.row?.rate_status === 'source_conflict' ? null : match.row;
    const rawState = transport.normalizeState(ctx.state_province || row?.state_province);
    const state = /^[A-Z]{2}$/.test(rawState) ? rawState : '';
    const norm = transport.normalizeLocation(ctx.auction_location).replace(/\s+\d{5}$/, '').replace(new RegExp('^' + (state || 'ZZ') + '\\s*-?\\s*'), '').replace(new RegExp('\\s+' + (state || 'ZZ') + '$'), '');
    const override = profile.transportOverrides?.find(r => r.platform === transport.normalizePlatform(ctx.platform) && r.location === norm && r.state === state);
    const description = vehicle.vehicle_description || vehicle.details?.vehicle_description || {};
    const rawBody = String(vehicle.body_style || vehicle.bodyStyle || vehicle.vehicle_type || description.BodyStyle || description.BodyStyleName || description.VehicleClass || '').toLowerCase();
    const explicitClass = [vehicle.transport_class,vehicle.vehicle_class,vehicle.body_style_class].filter(Boolean).join(' ').toLowerCase();
    const standard = !/large|oversiz|pickup|truck|heavy|bus|motorcycle/.test(explicitClass)
      && /sedan|suv|sport utility|crossover|hatchback|coupe|convertible|wagon|automobile|passenger/.test(rawBody)
      && !/pickup|truck|oversiz|bus|motorcycle|heavy/.test(rawBody);
    const isUS = /^(us|usa|united states)$/i.test(ctx.country || 'US')
      && (!row?.country || /^(us|usa|united states)$/i.test(row.country))
      && !/^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/.test(state);
    const desc=vehicle.vehicle_description||vehicle.details?.vehicle_description||{};
    const explicit=[vehicle.powertrain,desc.Powertrain,desc.powertrain,vehicle.engine_type].map(transport.normalizePowertrain).filter(x=>x!=='unknown');
    const specific=[...new Set(explicit)];
    const genericHybrid = /^(hybrid|hybrid electric|electric and gas hybrid)$/i.test(String(vehicle.fuel_type||vehicle.fuel||desc.FuelType||'').trim());
    const land = override?.landUsd ?? (row?.preferred_terminal_id ? row.rates?.[row.preferred_terminal_id] : null);
    return {platform:transport.normalizePlatform(ctx.platform), standard:standard && isUS,
      landUsd:standard && isUS ? number(land) : null, seaUsd:standard && isUS && number(land) !== null ? number(override?.seaUsd ?? profile.route?.seaUsd) : null,
      location:String(ctx.auction_location || ''), source:override ? 'Stawka REXBID' : row ? 'Tabela transportu REXBID' : 'Wycena trasy',
      batteryCargo:genericHybrid,
      powertrain:specific.length>1?'unknown':specific[0]||(genericHybrid?'unknown':transport.matchPowertrain(vehicle))};
  }
  function bindCalculator({root:mount,vehicle={},prefill={},profile=root.RexBidDeliveredRates,fx=null,fetchRates=null}={}) {
    const engine = root.RexBidDeliveredCost, transport = root.RexBidCalculatorV4;
    if (!mount || !engine || !transport || !profile) return null;
    const doc = mount.ownerDocument, route = contextFor(vehicle,transport,profile);
    const engineCc = prefill.engineCc ?? vehicle.engine_capacity_cc ?? vehicle.engine_displacement_cc ?? vehicle.engine_cc
      ?? (number(vehicle.engine_size_l)>0?Math.round(Number(vehicle.engine_size_l)*1000):'');
    const currentSource = [[vehicle.pricing || {}, 'current_bid_usd'], [vehicle, 'current_bid_usd'], [vehicle.auction || {}, 'current_bid_usd']].find(([object, key]) => Object.prototype.hasOwnProperty.call(object, key));
    let currentPrice = number(currentSource ? currentSource[0][currentSource[1]] : vehicle.pricing?.current_bid2_usd);
    if (!(currentPrice > 0)) currentPrice = null;
    let buyNow = number(vehicle.pricing?.buy_now_usd ?? vehicle.buy_now_usd ?? vehicle.auction?.buy_now_usd);
    let metadata = vehicle.read || {}, preview = vehicle.preview || {}, result, userPrice = null, exchange = fx;
    const stored = () => preview.read_only === true || metadata.read_only === true || vehicle.read_only === true || (metadata.source === 'd1' && metadata.freshness !== 'fresh') || metadata.catalog_scope === 'archival' || root.RexBidMarket?.availabilityStatus({...vehicle,read:metadata}) === 'unknown';
    const observationDate = () => {const dataRead=preview.read_only===true?preview:metadata;return dataRead.last_synced_at||dataRead.last_seen_at||null;};
    const lot = String(vehicle.lot_number ?? vehicle.lot ?? vehicle.auction?.lot_number ?? '');
    const existingHref = doc.querySelector('[data-vehicle-inquiry]')?.getAttribute('href');
    const fallbackHref = '/kontakt?' + new URLSearchParams({lot,platform:route.platform,source:'vehicle'});
    const href = /^\/kontakt(?:\.html)?\?/.test(existingHref || '') ? existingHref : fallbackHref;
    const field = (key,label,value='',extra='') => `<label>${label}<input data-estimate-field="${key}" type="number" min="0" step="${key === 'usdPln' || key === 'eurPln' ? '0.0001' : '0.01'}" inputmode="decimal" value="${esc(value ?? '')}" ${extra}></label>`;
    mount.innerHTML = `<div class="delivered-calculator"><div class="delivered-heading"><span class="delivered-kicker">TWÓJ BUDŻET IMPORTU</span><h2 id="calculatorV4Heading">Cena pod dom</h2></div>
      <div class="delivered-price"><label>Cena do kalkulacji<select data-v4-price-kind><option value="current">${stored()?'Ostatnia zapisana oferta':'Aktualna oferta'}</option>${buyNow>0?'<option value="buy-now">Kup teraz</option>':''}<option value="custom">Własna kwota</option></select></label>
      <label>Planowana cena zakupu · USD<input data-v4-price data-estimate-field="purchaseUsd" type="number" min="0.01" step="0.01" inputmode="decimal" value="${esc(currentPrice ?? '')}"></label><small data-estimate-price-note></small></div>
      <div class="delivered-result" role="status" aria-live="polite" aria-atomic="true"><span data-estimate-title>Szacowana cena z dostawą</span><strong data-estimate-total>Obliczanie…</strong><small data-estimate-discount></small></div>
      <label class="delivered-destination">Miejsce dostawy<select data-estimate-destination>${(profile.destinations||[]).map(d=>`<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('')}<option value="custom">Inny adres · własna wycena</option></select></label>
      <p class="delivered-note" data-estimate-status></p><a class="delivered-inquiry" data-vehicle-inquiry data-v4-inquiry href="${esc(href)}">Potwierdź wycenę tego auta <span aria-hidden="true">→</span></a>
      <p class="delivered-note">Szacunek przed zakupem. Naprawa, dostosowanie i rejestracja są poza wyceną.</p>
      <details class="delivered-section"><summary><span>01</span> Zakup i transport</summary><div data-estimate-purchase-lines></div>
        <div class="delivered-fields">${field('auctionFeeOverrideUsd','Opłaty aukcyjne · USD (opcjonalna wycena)','', 'placeholder="Obliczane automatycznie"')}${field('landUsd','Dostawa do portu w USA · USD',route.landUsd)}${field('seaUsd','Fracht do Rotterdamu · USD',route.seaUsd)}</div>
        <p class="delivered-note" data-estimate-route></p><p class="delivered-note" data-estimate-fee-note></p></details>
      <details class="delivered-section"><summary><span>02</span> Odprawa i podatki</summary><div class="delivered-fields delivered-customs">
        ${field('customsValueUsd','Wartość celna · USD','','placeholder="Wyliczana automatycznie" aria-describedby="deliveredCustomsNote"')}
        <button type="button" class="delivered-customs-reset" data-estimate-customs-reset>Przywróć automatyczne wyliczenie</button>
        <small class="delivered-note" id="deliveredCustomsNote" data-estimate-customs-note></small></div><div data-estimate-tax-lines></div><div class="delivered-fields">
        <label>Rodzaj napędu<select data-estimate-powertrain><option value="unknown">Wybierz napęd</option><option value="ICE">Benzyna / diesel</option><option value="HEV">Hybryda bez ładowania (HEV)</option><option value="PHEV">Hybryda plug-in (PHEV)</option><option value="BEV">Elektryczny (BEV)</option><option value="FCEV">Wodorowy</option></select></label>
        ${field('engineCc','Pojemność silnika · cm³',engineCc)}
        <label class="delivered-check" data-estimate-exemption-row><input type="checkbox" data-estimate-exemption>Potwierdzona kwalifikacja do zwolnienia z akcyzy</label>
        ${field('exciseBasePln','Własna podstawa akcyzy · PLN (opcjonalnie)','', 'placeholder="Szacowana z wartości pojazdu i cła"')}
        ${field('usdPln','Kurs USD / PLN',fx?.usdPln ?? '')}${field('eurPln','Kurs EUR / PLN',fx?.eurPln ?? '')}</div>
        <p class="delivered-note">Scenariusz odprawy: Rotterdam, cło 10%, VAT 21%. Kwalifikację celną, podstawy i zwolnienia potwierdza odprawa. Cena w USA nie potwierdza pochodzenia auta. Kursy służą do szacunku.</p></details>
      <details class="delivered-section"><summary><span>03</span> Dostawa i usługi</summary><div data-estimate-services-lines></div><div class="delivered-fields">
        ${field('deliveryPln','Dostawa pod wskazany adres · PLN',profile.destinations?.[0]?.pln)}
        <label class="delivered-check"><input data-estimate-translations type="checkbox" checked>Tłumaczenie dokumentów · ${esc(money(profile.service.translationsPln))}</label>
        <label class="delivered-check"><input data-estimate-cargo type="checkbox">Dopłata za ładunek niebezpieczny · ${esc(money(profile.service.dangerousCargoUsd,'USD'))}</label>
        <label class="delivered-check"><input data-estimate-oversize type="checkbox">Pojazd ponadgabarytowy — indywidualna wycena transportu</label></div>
        <p class="delivered-note">Standardowy transport auta. Dodatkowe opłaty za postój, opóźnioną płatność, nietypowy załadunek i ubezpieczenie poza standardowym zakresem wymagają osobnej wyceny.</p></details>
      <div class="delivered-footer"><p data-estimate-fx></p><button type="button" data-estimate-copy>Kopiuj wycenę</button><span data-estimate-copy-status role="status"></span></div></div>`;
    const q = s => mount.querySelector(s), fields = Object.fromEntries([...mount.querySelectorAll('[data-estimate-field]')].map(n=>[n.dataset.estimateField,n]));
    const priceKind=q('[data-v4-price-kind]'), powertrain=q('[data-estimate-powertrain]');
    powertrain.value=route.powertrain;
    q('[data-estimate-cargo]').checked=route.batteryCargo||['HEV','PHEV','BEV'].includes(route.powertrain);
    if (currentPrice === null) priceKind.value='custom';
    let fxManual = false, fxFailed = false;
    const manuallyEditedFx=new Set();
    const rows = values => values.map(([label,value,currency])=>`<div class="delivered-line"><span>${esc(label)}</span><strong>${esc(money(value,currency))}</strong></div>`).join('');
    const priceNote = () => {
      priceKind.querySelector('option[value="current"]').disabled=currentPrice===null;
      const observation = observationDate();
      const date = typeof observation==='string' && Number.isFinite(Date.parse(observation)) ? ' Zapis: '+new Date(observation).toLocaleString('pl-PL',{timeZone:'Europe/Warsaw'})+'.' : '';
      q('[data-estimate-price-note]').textContent=priceKind.value==='custom'?'Twoja planowana kwota. Możesz ją swobodnie zmieniać.':stored()?'Cena z ostatnio zapisanych danych.'+date+' Dostępność wymaga potwierdzenia.':priceKind.value==='buy-now'?'Cena „Kup teraz” nie obejmuje opłat i transportu.':'Aktualna oferta nie jest końcową ceną zakupu.';
    };
    function update() {
      const values=Object.fromEntries(Object.entries(fields).map(([k,n])=>[k,n.value]));
      for(const optional of ['auctionFeeOverrideUsd','exciseBasePln','customsValueUsd'])if(values[optional]==='')delete values[optional];
      const oversized=q('[data-estimate-oversize]').checked;
      if(oversized){values.landUsd=null;values.seaUsd=null;}
      result=engine.calculate({...values,platform:route.platform,powertrain:powertrain.value,
        exemptionConfirmed:q('[data-estimate-exemption]').checked,translations:q('[data-estimate-translations]').checked,
        dangerousCargo:q('[data-estimate-cargo]').checked,fxDate:fxManual?new Date().toISOString().slice(0,10):exchange?.effectiveDate,
        taxDate:new Date().toISOString().slice(0,10)},profile);
      const missing=[...(result.missing||[])];
      if(oversized) missing.push('indywidualny transport pojazdu ponadgabarytowego');
      const complete=result.complete&&!oversized;
      q('[data-estimate-title]').textContent=complete?'Szacowana cena pod dom':'Suma znanych kosztów · częściowo';
      q('[data-estimate-total]').textContent=money(complete?result.totalPln:result.knownTotalPln);
      q('[data-estimate-discount]').textContent=result.discountPln>0?`W tym rabat REXBID: −${money(result.discountPln)}`:'';
      q('[data-estimate-status]').textContent=complete?'Zakup, transport, podatki i wybrane usługi. Kwotę oraz zakres potwierdzimy przed zleceniem.':'Do pełnej ceny uzupełnij: '+[...new Set(missing)].map(message=>message.replace(/\.+$/,'')).join('; ')+'. Brakujące kwoty nie są wliczone.';
      q('[data-estimate-purchase-lines]').innerHTML=rows([['Cena pojazdu',number(values.purchaseUsd),'USD'],['Opłaty aukcyjne',result.auctionFeeUsd,'USD'],['Transport w USA',number(values.landUsd),'USD'],['Fracht do Rotterdamu',number(values.seaUsd),'USD'],['Zakup i transport łącznie',result.calculatedCustomsUsd,'USD']]);
      q('[data-estimate-tax-lines]').innerHTML=rows([[result.customsValueSource==='manual'?'Wartość celna · wpisana ręcznie':'Wartość celna · wyliczona',result.customsUsd,'USD'],['Cło · scenariusz 10%',result.dutyPln,'PLN'],['VAT importowy · Holandia 21%',result.vatPln,'PLN'],['Akcyza w Polsce',result.excisePln,'PLN'],['Agencja celna i rozładunek',profile.service.portEUR,'EUR']]);
      q('[data-estimate-customs-note]').textContent=`Wyliczenie z zakupu i transportu: ${money(result.calculatedCustomsUsd,'USD')}. ${result.customsValueSource==='manual'?'Do podatków stosujesz własną wartość; potwierdź ją do odprawy.':'Możesz wpisać własną kwotę do oszacowania podatków.'}`;
      q('[data-estimate-customs-reset]').disabled=result.customsValueSource!=='manual';
      fields.customsValueUsd.setAttribute('placeholder',money(result.calculatedCustomsUsd,'USD'));
      q('[data-estimate-services-lines]').innerHTML=rows([['Prowizja REXBID z VAT',result.commissionGrossPln,'PLN'],['Rabat REXBID',-result.discountPln,'PLN'],['Dostawa w Polsce',number(values.deliveryPln),'PLN']]);
      q('[data-estimate-route]').textContent=route.location?`${route.location} → port w USA → Rotterdam. ${route.source}; stawki szacunkowe dla standardowego auta.`:'Trasa wymaga wskazania i wyceny.';
      q('[data-estimate-fee-note]').textContent=route.platform==='iaai'?'Opłaty IAAI są szacunkiem REXBID dla kwot 5–25 tys. USD. Dla innych kwot podaj wycenę opłat.':'Opłaty szacowane według profilu Copart Preferred, secured, non-clean, Live. Właściwa taryfa zależy od konta i pojazdu.';
      q('[data-estimate-exemption-row]').hidden=!['PHEV','BEV','FCEV'].includes(powertrain.value);
      q('[data-estimate-fx]').textContent=fxManual?`Kursy do wyceny: USD ${fields.usdPln.value||'brak'}, EUR ${fields.eurPln.value||'brak'}. ${manuallyEditedFx.size===2?'Oba kursy wpisane ręcznie.':`${manuallyEditedFx.has('usdPln')?'USD':'EUR'} wpisany ręcznie; drugi kurs ${exchange?'NBP z '+exchange.effectiveDate:'do uzupełnienia'}.`} Sprawdź przed zakupem.`:exchange?`Kursy NBP z ${exchange.effectiveDate}: USD ${exchange.usdPln}, EUR ${exchange.eurPln}.${exchange.stale?' Starsza tabela — potwierdź kurs przed zakupem.':''}`:fxFailed?'Kursy NBP są chwilowo niedostępne. Wpisz kursy w sekcji „Odprawa i podatki”.':'Pobieranie kursów NBP…';
      for(const [key,node] of Object.entries(fields)) node.setAttribute('aria-invalid',String(node.value!==''&&(number(node.value)===null||(['purchaseUsd','usdPln','eurPln','engineCc'].includes(key)&&number(node.value)===0))));
      priceNote();
      const budget={...result,complete,knownTotalPln:complete?result.totalPln:result.knownTotalPln};
      const detail={lot,platform:route.platform,priceKind:priceKind.value,priceStatus:stored()?'snapshot':'current',priceObservedAt:observationDate(),purchasePriceUsd:number(values.purchaseUsd),knownSubtotalUsd:result.customsUsd,budget,breakdownText:exportBreakdown()};
      mount.dispatchEvent(new doc.defaultView.CustomEvent('rexbid:budget-update',{bubbles:true,detail}));
      return detail;
    }
    function exportBreakdown() {
      if(!result)return '';
      const title=[vehicle.year,vehicle.make,vehicle.model].filter(Boolean).join(' ')||vehicle.title||'Pojazd';
      return ['REXBID — szacunkowa wycena',title,`LOT: ${lot} · ${route.platform}`,`Cena zakupu: ${money(fields.purchaseUsd.value,'USD')}`,
        ...[...mount.querySelectorAll('.delivered-line')].map(n=>n.textContent),
        `Tłumaczenia: ${q('[data-estimate-translations]').checked?money(profile.service.translationsPln):'niewybrane'}`,
        `Ładunek niebezpieczny: ${q('[data-estimate-cargo]').checked?money(profile.service.dangerousCargoUsd,'USD'):'niewybrane'}`,
        `Wynik: ${money(result.complete?result.totalPln:result.knownTotalPln)}${result.complete?' · szacunek':' · częściowo'}`,
        q('[data-estimate-price-note]').textContent,q('[data-estimate-fx]').textContent,
        `Wersja stawek: ${result.ratesVersion}. Naprawy i rejestracja poza zakresem. Potwierdź wycenę przed zakupem.`].join('\n');
    }
    function selectPreset() {
      priceKind.querySelector('option[value="current"]').disabled=currentPrice===null;
      if(priceKind.value==='current'&&currentPrice===null)priceKind.value='custom';
      fields.purchaseUsd.value=priceKind.value==='current'?(currentPrice??''):priceKind.value==='buy-now'?(buyNow??''):(userPrice??'');
      update();
    }
    priceKind.addEventListener('change',selectPreset);
    q('[data-estimate-customs-reset]').addEventListener('click',()=>{fields.customsValueUsd.value='';update();});
    fields.purchaseUsd.addEventListener('input',()=>{priceKind.value='custom';userPrice=fields.purchaseUsd.value;});
    for(const key of ['usdPln','eurPln'])fields[key].addEventListener('input',()=>{fxManual=true;manuallyEditedFx.add(key);});
    q('[data-estimate-destination]').addEventListener('change',event=>{fields.deliveryPln.value=profile.destinations.find(d=>d.id===event.target.value)?.pln??'';update();});
    fields.deliveryPln.addEventListener('input',()=>{q('[data-estimate-destination]').value='custom';});
    powertrain.addEventListener('change',()=>{q('[data-estimate-exemption]').checked=false;q('[data-estimate-cargo]').checked=['HEV','PHEV','BEV'].includes(powertrain.value);update();});
    mount.querySelectorAll('input,select').forEach(n=>{n.addEventListener('input',update);n.addEventListener('change',update);});
    q('[data-estimate-copy]').addEventListener('click',async()=>{try{await doc.defaultView.navigator.clipboard.writeText(exportBreakdown());q('[data-estimate-copy-status]').textContent='Skopiowano wycenę.';}catch{q('[data-estimate-copy-status]').textContent='Kopiowanie niedostępne. Zaznacz i skopiuj wycenę.';}});
    update();
    const loader=fetchRates||(()=>root.fetch('/api/exchange-rates',{credentials:'omit'}).then(r=>{if(!r.ok)throw Error('FX');return r.json();}));
    const ready=fx?Promise.resolve():Promise.resolve().then(loader).then(value=>{
      if(value?.ok!==true||!(number(value.usdPln)>0)||!(number(value.eurPln)>0)||!/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate||''))throw Error('FX');
      exchange=value;for(const key of ['usdPln','eurPln'])if(!manuallyEditedFx.has(key))fields[key].value=value[key];update();
    }).catch(()=>{fxFailed=true;update();});
    return {ready,current:update,update,getBudget:()=>result,exportBreakdown,priceInput:fields.purchaseUsd,priceKind,
      setPriceKind(kind){if(['current','custom','buy-now'].includes(kind)&&(kind!=='buy-now'||buyNow>0)){priceKind.value=kind;selectPreset();}},
      updateMarketPrices({currentBid,buyNowPrice,read,preview:nextPreview}={}){
        if(currentBid!==undefined)currentPrice=number(currentBid)>0?number(currentBid):null;if(buyNowPrice!==undefined)buyNow=number(buyNowPrice);
        if(read!==undefined)metadata=read||{};if(nextPreview!==undefined)preview=nextPreview||{};
        priceKind.querySelector('[value="current"]').textContent=stored()?'Ostatnia zapisana oferta':'Aktualna oferta';
        let option=priceKind.querySelector('[value="buy-now"]');
        if(buyNow>0&&!option){option=doc.createElement('option');option.value='buy-now';option.textContent='Kup teraz';priceKind.insertBefore(option,priceKind.querySelector('[value="custom"]'));}
        if(!(buyNow>0)&&option){if(priceKind.value==='buy-now')priceKind.value='custom';option.remove();}
        if(priceKind.value!=='custom')selectPreset();else update();
      }};
  }
  return Object.freeze({bindCalculator,contextFor});
});
