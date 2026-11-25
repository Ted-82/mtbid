(function(root){
  'use strict';
  const categories=Object.freeze([
    {id:'current',label:'Aktualne aukcje',query:{lot_sub_status:'Open'}},
    {id:'timed',label:'Timed Auction',query:{lot_status:'Timed'}},
    {id:'buy-now',label:'Kup teraz',query:{lot_status:'Buy Now'}},
    {id:'electric',label:'Samochody elektryczne',query:{fuel_type:'Electric'}}
  ].map(Object.freeze));
  const ended=['finished','sold','not_sold','not sold','no_sale','no sale','unsold','closed','ended','completed','cancelled','canceled','withdrawn','removed'];
  // A recent observation is not proof that a listing is available. Unknown
  // payloads remain in the saved catalog, but no Home/category advertises them
  // as active from a price, image or auxiliary future timestamp alone.
  const available=['open','active','live','running','in progress','in_progress','in-progress','prebid','pre bid','pre_bid','pre-bid','scheduled','started','upcoming','future','timed','timed auction','buy now','buy_now'];
  const uncertain=['unknown','conflict','awaiting_result'];
  const electric=['electric','bev','battery electric','battery electric vehicle','all electric','pure electric','fully electric'];
  const lower=v=>String(v??'').trim().toLowerCase();
  function normalizeSearch(value){
    const text=String(value??'').trim().replace(/\s+/g,' ').slice(0,120);
    const lot=/^(?:(?:numer|nr\.?)\s+)?lot(?:\s*[:#-]\s*|\s+)(\d{6,12})$/i.exec(text);
    const vin=/^vin(?:\s*[:#-]\s*|\s+)([A-HJ-NPR-Z0-9]{17})$/i.exec(text);
    return lot?.[1]??vin?.[1]?.toUpperCase()??text;
  }
  function damageLabel(value){
    const raw=String(value??'').trim(),key=lower(raw).replace(/[_-]+/g,' ').replace(/\s+/g,' ');
    const labels={'side':'Bok','front end':'Przód','rear end':'Tył','all over':'Cały pojazd',
      'front':'Przód','rear':'Tył','left rear':'Lewy tył','right rear':'Prawy tył','left front':'Lewy przód','right front':'Prawy przód',
      'left side':'Lewy bok','right side':'Prawy bok','front & rear':'Przód i tył','left & right side':'Lewy i prawy bok',
      'fresh water':'Zalanie wodą słodką','salt water':'Zalanie wodą słoną','roof':'Dach','interior':'Wnętrze','suspension':'Zawieszenie','theft':'Kradzież',
      'minor dent/scratches':'Drobne wgniecenia / zarysowania','minor dents/scratches':'Drobne wgniecenia / zarysowania',
      'normal wear':'Normalne zużycie','normal wear & tear':'Normalne zużycie','normal wear and tear':'Normalne zużycie','hail':'Grad','water/flood':'Woda / zalanie','flood':'Zalanie','mechanical':'Mechaniczne',
      'undercarriage':'Podwozie','top/roof':'Dach','rollover':'Dachowanie','vandalism':'Wandalizm','burn':'Pożar',
      'burn engine':'Pożar silnika','burn interior':'Pożar wnętrza','stripped':'Brak części','missing/altered vin':'Brak / zmiana VIN','unknown':'Nieokreślone przez źródło'};
    return labels[key]||raw;
  }
  function availabilityStatus(car){
    const a=car?.auction||{},state=lower(a.state||car?.status),source=lower(a.source_status||a.formatted);
    if(ended.includes(state)||ended.includes(source)||ended.includes(lower(a.outcome_status))||['finished','removed'].includes(lower(a.phase)))return 'ended';
    if(['unknown','awaiting_result'].includes(lower(a.phase)))return 'unknown';
    if(car?.read?.catalog_scope==='archival')return 'unknown';
    if(uncertain.includes(state)||uncertain.includes(source))return 'unknown';
    return available.includes(state)||available.includes(source)?'active':'unknown';
  }
  function auctionSessionLabel(car, now = Date.now()){
    const auction = car?.auction || {};
    const phase = lower(auction.phase);
    const state = lower(auction.state || car?.status);
    const schedule = lower(auction.schedule_status);
    const lotStatus = lower(auction.lot_status);

    if (phase === "removed") return "Oferta wycofana ze źródła";
    if (phase === "finished") return "Aukcja zakończona · sprawdź wynik";
    if (phase === "unscheduled") return "Termin aukcji nieustalony";
    if (phase === "unknown") return "Status aukcji do potwierdzenia";
    if (phase === "awaiting_result") return "Termin minął · wynik do potwierdzenia";
    if (auction.is_timed === true || lotStatus === "timed" || schedule === "timed" || schedule === "ended") return "";
    if (phase !== "awaiting_auction" && phase !== "in_progress" && schedule !== "live" &&
        !["live", "running", "in progress", "in_progress", "in-progress", "started"].includes(state) &&
        lower(auction.lot_sub_status) !== "live") return "";
    const scheduled = auction.auction_at || auction.full_date || auction.auctionAt || car?.auction_at;
    // The broad source window starts before the scheduled session and expires without confirming an outcome.
    const start = !["date_only", "unassigned", "unknown", "conflict"].includes(schedule) &&
      typeof scheduled === "string" && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(scheduled) ? Date.parse(scheduled) : NaN;
    if (Number.isFinite(start) && now >= start + 86_400_000) return "Termin minął · wynik do potwierdzenia";
    if (Number.isFinite(start) ? now < start : phase === "awaiting_auction") return "Oczekuje na rozpoczęcie sesji";
    return "Aktywne okno sesji · licytacja auta do potwierdzenia";
  }
  function hasConfirmedAvailability(car){return availabilityStatus(car)==='active';}
  function confirmedSale(car){
    return car?.auction?.result_confirmed===true && lower(car.auction.outcome_status)==='sold';
  }
  const polishTime = {timeZone:'Europe/Warsaw',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'};
  const snapshotTime = new Intl.DateTimeFormat('pl-PL',polishTime);
  const bidTime = new Intl.DateTimeFormat('pl-PL',{...polishTime,second:'2-digit'});
  function priceObservationLabel(car, kind='snapshot', displayedBid=null){
    const bid = kind === 'current_bid';
    const pricing = car?.pricing;
    if(!bid && kind !== 'snapshot') return '';
    if(bid && (pricing?.current_bid_source !== 'apibara_feed' || !['number','string'].includes(typeof pricing.current_bid_usd) ||
       !['number','string'].includes(typeof displayedBid) || !(Number(displayedBid) > 0) ||
       !Number.isFinite(Number(displayedBid)) || Number(displayedBid) !== Number(pricing.current_bid_usd))) return '';
    const observed = bid ? pricing.current_bid_observed_at : car?.read?.last_synced_at ?? car?.preview?.last_synced_at ?? car?.last_synced_at;
    if(typeof observed!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(observed) || !Number.isFinite(Date.parse(observed))) return bid ? '' : 'Czas zapisu danych nieustalony.';
    const date = new Date(observed);
    if(bid) return 'Odczyt kwoty licytacji z ' + bidTime.format(date) + ' (Polska).';
    return 'Zapis danych oferty: '+snapshotTime.format(date)+' (Polska).';
  }
  function resolve(value){return categories.some(c=>c.id===value)?value:'current';}
  function fromParams(params){
    if(params.has('category'))return resolve(params.get('category'));
    if(lower(params.get('lot_status'))==='buy now')return 'buy-now';
    if(lower(params.get('lot_status'))==='timed')return 'timed';
    if(electric.includes(lower(params.get('fuel_type'))))return 'electric';
    return 'current';
  }
  function returnPath(location){
    if(!location)return '/';
    const pathname=String(location.pathname||'/');
    if(!['/','/index.html'].includes(pathname))return '/';
    const params=new URLSearchParams(location.search||'');
    params.delete('cursor');
    if(params.get('catalog')!=='1'){
      const filters=['sort','view','s','category','platform','make','model','year_from','year_to','lot_status','lot_sub_status','upcoming','price_min','price_max','odometer_from','odometer_to','fuel_type','transmission','drive_type','run_cond','type','damage','seller_type','sale_document_type','sale_document_name','loc_state'];
      if(!filters.some(name=>params.get(name)))return '/';
      params.set('catalog','1');
    }
    return `${pathname}?${params.toString()}#results`;
  }
  function eligible(car,category='current',now=Date.now()){
    const a=car.auction||{},state=lower(a.state||car.status),source=lower(a.source_status||a.formatted);
    if(ended.includes(state)||ended.includes(source)||ended.includes(lower(a.outcome_status)))return false;
    if(!hasConfirmedAvailability(car))return false;
    const live=state==='live'||lower(a.lot_sub_status)==='live'||a.schedule_status==='live';
    const raw=a.timed_end_at||a.auction_at||a.full_date||car.auction_at||car.auction_date;
    const date=raw?Date.parse(raw):NaN;
    const dayOnly=typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw);
    // An explicit unassigned schedule takes precedence over auxiliary timestamps.
    const unassigned=['unassigned','unknown','conflict'].includes(a.schedule_status)
      ||(lower(car.platform)==='copart'&&['upcoming','future','unassigned'].includes(source)&&!['scheduled','date_only'].includes(a.schedule_status));
    if(!unassigned&&!live&&Number.isFinite(date)&&date+(dayOnly?86399999:0)<=now)return false;
    if(category==='electric')return electric.includes(lower(car.fuel_type||car.fuel));
    if(category==='buy-now')return Number(car.pricing?.buy_now_usd??car.pricing?.buy_now??car.buy_now_usd??a.buy_now_usd)>0;
    if(category==='timed')return a.is_timed===true||a.timed===true||a.is_timed===1||a.schedule_status==='timed'||lower(a.lot_status)==='timed';
    return true;
  }
  // Same category policy compiled to parameterized SQL, BEFORE LIMIT/cursor.
  function sql(category,nowIso){
    const placeholders=items=>items.map(()=>'?').join(',');
    const where=[`lower(trim(COALESCE(l.auction_state,''))) NOT IN (${placeholders(ended)})`,
      `lower(trim(COALESCE(l.source_status,''))) NOT IN (${placeholders(ended)})`,
      `lower(trim(COALESCE(l.auction_state,''))) NOT IN (${placeholders(uncertain)}) AND lower(trim(COALESCE(l.source_status,''))) NOT IN (${placeholders(uncertain)})`,
      `(lower(trim(COALESCE(l.auction_state,''))) IN (${placeholders(available)}) OR lower(trim(COALESCE(l.source_status,''))) IN (${placeholders(available)}))`,
      `(lower(COALESCE(l.auction_state,''))='live' OR COALESCE(l.timed_end_at,l.auction_at) IS NULL OR datetime(COALESCE(l.timed_end_at,l.auction_at))>datetime(?) OR (length(COALESCE(l.timed_end_at,l.auction_at))=10 AND date(COALESCE(l.timed_end_at,l.auction_at))>=date(?)) OR (lower(l.platform)='copart' AND lower(COALESCE(l.source_status,'')) IN ('upcoming','future','unassigned')))`];
    const values=[...ended,...ended,...uncertain,...uncertain,...available,...available,nowIso,nowIso];
    if(category==='buy-now')where.push('l.buy_now_usd>0');
    if(category==='timed')where.push('l.is_timed=1');
    if(category==='electric'){where.push(`lower(trim(COALESCE(l.fuel_type,''))) IN (${placeholders(electric)})`);values.push(...electric);}
    return {where,values};
  }
  function reconcileTimedSales(records){
   const sold=e=>e.kind==='confirmed_auction_event' && e.provider==='apibara' && e.platform && e.lot && e.vin && String(e.status).toLowerCase()==='sold' &&
    String(e.source_status).toLowerCase()==='sold' && e.result_confirmed!==false && typeof e.final_price==='number' && e.final_price>0;
   const proofs=records.filter(e=>e.timed_cycle_verified===true && sold(e));
   if(!proofs.length)return records;
   const precise=d=>typeof d==='string' && /(?:Z|[+-]\d\d:\d\d)$/i.test(d) && Number.isFinite(Date.parse(d));
   const sellerByCycle=new Map();
   const reconciled=records.flatMap(e=>{
    if(e.timed_cycle_verified===true || !sold(e))return [e];
    const matches=proofs.filter(p=>p.platform===e.platform && p.lot===e.lot && p.vin===e.vin && p.final_price===e.final_price);
    if(!matches.length)return [e];
    if(precise(e.auction_date)){
     const exact=matches.filter(p=>Date.parse(p.auction_date)===Date.parse(e.auction_date) &&
        (!e.sale_date || !p.sale_date || e.sale_date===p.sale_date));
     if(exact.length===1){
      if(e.seller && !exact[0].seller){
       const key=exact[0].event_key;
       if(!sellerByCycle.has(key)) sellerByCycle.set(key,e.seller);
       else if(JSON.stringify(sellerByCycle.get(key))!==JSON.stringify(e.seller)) sellerByCycle.set(key,null);
      }
      return [];
     }
     return exact.length>1 ? [{...e,cycle_unassigned_observation:true}] : [e];
    }
    const day=e.sale_date || e.auction_date;
    return /^\d{4}-\d{2}-\d{2}$/.test(day||'') && matches.some(p=>p.sale_date===day)
       ? [{...e,cycle_unassigned_observation:true}] : [e];
   });
   return reconciled.map(e=>!e.seller && sellerByCycle.get(e.event_key) ? {...e,seller:sellerByCycle.get(e.event_key)} : e);
  }
  const api={reconcileTimedSales,categories,resolve,fromParams,returnPath,eligible,sql,hasConfirmedAvailability,confirmedSale,priceObservationLabel,availabilityStatus,auctionSessionLabel,damageLabel,normalizeSearch};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RexBidMarket=api;
})(typeof globalThis!=='undefined'?globalThis:this);
