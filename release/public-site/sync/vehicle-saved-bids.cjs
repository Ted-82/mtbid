'use strict';

const dates = new Intl.DateTimeFormat('pl-PL', {timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const amounts = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:2,minimumFractionDigits:0});
const cursorPattern = /^rexh1_[A-Za-z0-9_-]{1,2394}$/;

async function savedBidPage(request, {platform, lot, vin, read, historyVisible, escapeHtml, problem}) {
  const url = new URL(request.url);
  const cursor = url.searchParams.get('bid_cursor');
  if (cursor !== null && (!cursorPattern.test(cursor) || url.searchParams.getAll('bid_cursor').length !== 1)) return null;
  const search = new URLSearchParams();
  if(platform) search.set('platform',platform);
  search.set('per_page','20');
  if (cursor) search.set('cursor', cursor);
  const requireUniqueIdentity=!(platform && lot && vin);
  const response = await read('/api/car/'+(lot||vin)+'/history?'+search,{requireUniqueIdentity});
  if (!response || response.status === 429 || response.status >= 500) throw Error('saved history unavailable');
  if (response.status===409 && requireUniqueIdentity) return problem(request,409,'Ten identyfikator wskazuje więcej niż jedną aukcję. Wybierz numer LOT i platformę.');
  if (!response.ok) return null;
  const data = await response.json();
  const identity = data?.identity;
  if (!data.ok || !identity || !/^[A-HJ-NPR-Z0-9]{17}$/.test(identity.vin||'') ||
      typeof identity.lot!=='string' || !/^\d{1,20}$/.test(identity.lot) || !['copart','iaai'].includes(identity.platform) ||
      (vin && identity.vin!==vin) || (lot && identity.lot!==lot) || (platform && identity.platform!==platform)) return null;
  ({platform,lot,vin}=identity);
  const byTime = new Map();
  for (const snapshot of data.rex_history?.snapshots || []) {
    if (snapshot?.kind !== 'observed_snapshot' || typeof snapshot.observed_at !== 'string' ||
        !/(?:Z|[+-]\d\d:\d\d)$/i.test(snapshot.observed_at) || !Number.isFinite(Date.parse(snapshot.observed_at))) continue;
    const time = Date.parse(snapshot.observed_at), bid = snapshot.current_bid_usd;
    if (!byTime.has(time)) byTime.set(time, new Set());
    byTime.get(time).add(typeof bid === 'number' && Number.isFinite(bid) && bid >= 0 ? bid : null);
  }
  const observations = [...byTime.entries()].sort((a,b)=>b[0]-a[0]);
  const firstBid = observations.findIndex(([,prices])=>[...prices].some(price=>price>0));
  if ((firstBid===-1 && !cursor) || !await historyVisible(vin)) return null;
  const rows = observations.flatMap(([time,prices],index)=>[...prices].map(price=>{
    const latest = !cursor && index===firstBid && price>0 && [...prices].every(value=>value===null || value===price);
    const amount = price===null ? 'Brak danych' : price===0 ? 'Odczyt 0 USD' : amounts.format(price);
    return '<tr><td><time datetime="'+new Date(time).toISOString()+'">'+dates.format(time)+'</time></td><td>'+
      (latest ? '<strong>'+amount+'</strong><br><small>Ostatnia zapisana oferta</small>' : amount)+'</td></tr>';
  })).join('');
  const next = data.meta?.next_cursor;
  const after = new URLSearchParams({platform,lot,vin});
  const paging = typeof next==='string' && cursorPattern.test(next) && next!==cursor
    ? '<p><a href="/car?'+escapeHtml(after.toString()+'&bid_cursor='+encodeURIComponent(next))+'">Pokaż starsze odczyty</a></p>' : '';
  const brand = platform==='iaai'?'IAAI':'Copart';
  const html = '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<meta name="robots" content="noindex, follow"><title>Historia ofert · '+brand+' LOT '+lot+' | REXBID</title>'+
    '<link rel="stylesheet" href="/rexbid-brand.css?v=20261117-integrated"><link rel="stylesheet" href="/rexbid-guide.css?v=d6420d809c">'+
    '<link rel="stylesheet" href="/rexbid-saved-bids.css"></head><body class="rex-guide"><header><div class="header-inner">'+
    '<a href="/" class="logo" aria-label="REXBID — strona główna"><img class="rexbid-brand-image" src="/rexbid-logo-20261117-dark.webp" width="420" height="159" alt="REXBID"></a>'+
    '<nav aria-label="Nawigacja"><a href="/?catalog=1#results">Katalog</a></nav></div></header>'+
    '<main id="auctionHistoryPanel" class="guide-shell"><h1>Historia ofert</h1><p><strong>'+brand+' · LOT '+lot+'</strong><br>VIN '+vin+'</p>'+
    '<p>Termin aukcji jest nieznany. Poniżej znajdziesz kwoty zapisane wcześniej dla tego pojazdu.</p>'+
    '<details id="observedHistoryDetails" open><summary>Zapisane obserwacje</summary><div id="observedHistory"><table>'+
    '<thead><tr><th scope="col">Data odczytu (Polska)</th><th scope="col">Zapisana oferta</th></tr></thead><tbody>'+rows+
    '</tbody></table></div></details><p>Przy kwotach z paczek Apibary godzina oznacza odczyt oferty przez dostawcę. Cenę sprzedaży podajemy po potwierdzeniu wyniku aukcji.</p>'+paging+'</main></body></html>';
  return new Response(request.method==='HEAD'?null:html, {headers:{
    'Content-Type':'text/html; charset=UTF-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, follow',
    'Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
  }});
}

module.exports = {savedBidPage};
