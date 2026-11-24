'use strict';
const {relistEvidence,verifiedRelist}=require('../../copart-relisting/executor/sync/feed-copart-relist.cjs');
const sample=require('../../copart-relisting/executor/tests/fixtures/copart-dakota-relist.json');

function readReplay() {
  const change=sample.events.find(entry=>entry.generation===23248);
  const proof=relistEvidence(change.group,change.observedAt);
  // Re-run the decision at the recorded observation instant. This is a fixed audit replay.
  const projected=verifiedRelist(sample.row,sample.member,proof,sample.raw,sample.sourceObservedAt,Date.parse(sample.sourceObservedAt));
  return {vin:sample.row.vin_normalized,lot:sample.row.lot,generation:change.generation,sequence:proof?.sequence,
    previouslyVisible:sample.member.active===1,previousDate:sample.row.auction_at,observation:sample.sourceObservedAt,
    eligible:projected?.auction_state==='open',auctionAt:projected?.auction_at,bid:projected?.current_bid_usd,buyNow:projected?.buy_now_usd};
}
const formatTime=value=>new Intl.DateTimeFormat('pl-PL',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Warsaw'}).format(new Date(value));
function stagingReplay(request) {
  const model=readReplay();
  if(!model.eligible)return Response.json({error:'Ten zapis nie spełnia warunków powrotu do katalogu.'},{status:409});
  const html=`<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Próba ponownego wystawienia | REXBID</title>
  <style>body{margin:0;background:#f4f6f8;color:#142c3c;font:1rem/1.6 system-ui,sans-serif}main{max-width:45rem;margin:auto;padding:2rem 1.15rem}h1{font-size:clamp(1.65rem,5vw,2.4rem);line-height:1.15}dl{background:white;border:1px solid #d5dfe6;padding:1rem 1.25rem;border-radius:.65rem}dt{font-weight:650}dd{margin:0 0 .75rem;overflow-wrap:anywhere}dd:last-child{margin-bottom:0}a{color:#145886}</style></head>
  <body><main><p>REXBID · Audyt katalogu</p><h1>Ponowne wystawienie Dodge Dakota</h1>
  <p>Odtworzenie zmiany z 24 listopada 2026 na kopii. W chwili sprawdzenia Apibara potwierdziła aukcję otwartą.</p>
  <dl><dt>VIN i LOT</dt><dd>${model.vin} · Copart ${model.lot}</dd><dt>Przed zmianą</dt><dd>Poprzednia licytacja zakończona, brak nowego terminu w katalogu.</dd>
  <dt>Zmiana dostawcy</dt><dd>Paczka ${model.generation}, zdarzenie ${model.sequence}.</dd>
  <dt>Termin po sprawdzeniu</dt><dd>${formatTime(model.auctionAt)} czasu polskiego</dd>
  <dt>Kwoty w chwili obserwacji</dt><dd>Oferta ${model.bid} USD · Kup teraz ${model.buyNow} USD</dd>
  <dt>Chwila potwierdzenia u dostawcy</dt><dd>${formatTime(model.observation)} czasu polskiego</dd></dl>
  <p><a href="/">Wróć do strony testowej</a></p></main></body></html>`;
  return new Response(request.method==='HEAD'?null:html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}});
}
module.exports={readReplay,stagingReplay};
