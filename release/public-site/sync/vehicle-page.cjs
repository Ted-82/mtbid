'use strict';

const base = 'https://rexbid.pl';
const platformPattern = /^(copart|iaai)$/;
const lotPattern = /^\d{1,20}$/;
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
const {savedBidPage} = require('./vehicle-saved-bids.cjs');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function problem(request, status, message) {
  const title = status === 503 ? 'Karta chwilowo niedostępna' : status === 409 ? 'Wybierz aukcję pojazdu' : 'Oferta niedostępna';
  const page = '<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' | REXBID</title><main><h1>'+title+'</h1><p>'+message+'</p><p><a href="/?catalog=1#results">Przejdź do katalogu REXBID</a></p></main></html>';
  const headers = {'Content-Type':'text/html; charset=UTF-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, follow','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'};
  if (status === 503) headers['Retry-After'] = '60';
  return new Response(request.method === 'HEAD' ? null : page,{status,headers});
}

async function vehiclePage(request,{read,render,historyVisible}) {
  const url = new URL(request.url);
  const lot = (url.searchParams.get('lot') || '').trim(), vin = (url.searchParams.get('vin') || '').trim().toUpperCase();
  const platform = (url.searchParams.get('platform') || '').trim().toLowerCase();
  if (!lot && !vin) return problem(request,404,'Wybierz ofertę lub wyszukaj samochód po VIN albo numerze LOT.');
  // Historical links may contain partial identifiers. Preserve their existing UI support.
  if ((lot && !lotPattern.test(lot)) || (vin && !vinPattern.test(vin)) || (platform && !platformPattern.test(platform)) ||
      ['lot','vin','platform'].some(k=>url.searchParams.getAll(k).length>1)) {
    const shell=await render();const headers=new Headers(shell.headers);headers.set('X-Robots-Tag','noindex, follow');
    return new Response(request.method==='HEAD'?null:shell.body,{status:shell.status,headers});
  }
  const route='/api/car/'+encodeURIComponent(lot || vin)+(platform?'?platform='+platform:'');
  let dto;
  try {
    const response=await read(route);
    if (!response) throw Error('unavailable');
    const json=await response.json();
    if (response.status===404 && (json.error==='auction_date_pending' || json.error==='vehicle_not_in_saved_catalog')) {
      if(json.error==='auction_date_pending' && platform && lot && vin && historyVisible){
        const history=await savedBidPage(request,{platform,lot,vin,read,historyVisible,escapeHtml});
        if(history) return history;
      }
      return problem(request,404,json.error==='auction_date_pending'?'Dom aukcyjny nie wyznaczył jeszcze terminu.':'Takiej aukcji obecnie nie ma w katalogu REXBID. Możesz ją również wyszukać w archiwum.');
    }
    if(response.status===409) return problem(request,409,'Wyszukaj numer LOT i wybierz platformę aukcyjną.');
    if (!response.ok || json.ok!==true || !json.data) throw Error('unavailable');
    dto=json.data;
  } catch {
    return problem(request,503,'Spróbuj odświeżyć kartę za chwilę.');
  }
  const recordPlatform=dto.platform, recordLot=String(dto.lot_number||''), recordVin=String(dto.vin||'').trim().toUpperCase();
  if(!platformPattern.test(recordPlatform) || !lotPattern.test(recordLot) || !vinPattern.test(recordVin)){
    const shell=await render();const headers=new Headers(shell.headers);headers.set('X-Robots-Tag','noindex, follow');
    return new Response(request.method==='HEAD'?null:shell.body,{status:shell.status,headers});
  }
  if ((platform && platform!==recordPlatform) || (lot && lot!==recordLot) || (vin && vin!==recordVin)) {
    return problem(request,404,'Podany VIN, numer LOT i platforma nie wskazują tej samej aukcji.');
  }
  const shell=await render();
  if (!shell.ok || !shell.headers.get('Content-Type')?.toLowerCase().includes('text/html')) return shell;
  const title=(typeof dto.title==='string' && dto.title.trim() || [dto.year,dto.make,dto.model].filter(Boolean).join(' ')).slice(0,160);
  const brand=recordPlatform==='iaai'?'IAAI':'Copart';
  const fullTitle=title+' | '+brand+' LOT '+recordLot+' | REXBID';
  const description=[title,brand+' LOT '+recordLot,'VIN '+recordVin,dto.location?.display].filter(x=>typeof x==='string'&&x.trim()).join(' · ');
  const canonical=base+'/car?'+new URLSearchParams({platform:recordPlatform,lot:recordLot,vin:recordVin});
  const headers=new Headers(shell.headers);
  headers.delete('Content-Length');headers.delete('ETag');headers.delete('Last-Modified');headers.set('Cache-Control','private, no-store');
  const complete=Boolean(title && (dto.media?.thumbs?.length || dto.media?.items?.length));
  if(!complete)headers.set('X-Robots-Tag','noindex, follow');
  if(request.method==='HEAD')return new Response(null,{status:shell.status,headers});
  // Escaping '<' also prevents an auction title from closing this inert data element.
  const snapshot=JSON.stringify(dto).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const head='<meta name="description" content="'+escapeHtml(description)+'"><link rel="canonical" href="'+escapeHtml(canonical)+'"><meta property="og:url" content="'+escapeHtml(canonical)+'"><meta property="og:title" content="'+escapeHtml(fullTitle)+'"><meta property="og:description" content="'+escapeHtml(description)+'">';
  let html=await shell.text();
  html=html.replace(/<meta\b[^>]*(?:name=["']description["']|property=["']og:(?:url|title|description)["'])[^>]*>/gi,'')
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi,'')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i,()=>'<title>'+escapeHtml(fullTitle)+'</title>'+head)
    .replace(/<script\b/i,()=>'<script type="application/json" id="rexbid-vehicle-data">'+snapshot+'</script><script')
    .replace('<div id="page"></div>',()=>'<div id="page"><section class="panel"><h1>'+escapeHtml(title||brand+' LOT '+recordLot)+'</h1><p>'+escapeHtml(description)+'</p></section></div>');
  return new Response(html,{status:shell.status,headers});
}

module.exports={vehiclePage};
