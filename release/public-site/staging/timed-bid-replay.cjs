'use strict';

const {effectiveBid} = require('../sync/timed-bid-read.cjs');
const {updateEvidence} = require('../../timed-bid-observation/executor/sync/timed-bid-evidence.cjs');
const change = require('../../timed-bid-observation/tests/iaai-118801774.json');

// Times from the Timed inventory, the published delivery and the simultaneous detail check.
const snapshotAt = '2026-11-24T20:01:32.326Z';
const checkedAt = '2026-11-24T20:48:34.300Z';
const deadline = '2026-11-24T23:59:00.000Z';

function replayBid() {
  const bidField = 'pricing.current_bid_usd';
  const car = change.vehicle;
  const before = change.before[bidField];
  const after = change.after[bidField];
  const initialRow = {
    platform: car.platform, lot: car.lot_number, vin_normalized: car.vin,
    listing_generation: null, timed_bid_evidence: null, current_bid_usd: before,
    auction_state: 'open', is_timed: 1, timed_end_at: deadline
  };
  const entry = {
    platform: car.platform, lot_number: car.lot_number, vin: car.vin,
    auction: {timed_end_at: deadline}, pricing: {current_bid_usd: before, final_price_usd: null}
  };
  const event = {
    eventType: change.event, sequence: change.sequence, vin: car.vin,
    recordedAt: change.recorded_at, vehicleUpdatedAt: change.vehicle_updated_at
  };
  const assignments = {current_bid_usd: after};
  const evidence = updateEvidence(initialRow, event, {assignments}, null, null);
  const updated = {...initialRow, ...assignments, timed_bid_evidence: evidence};
  const shown = effectiveBid(entry, updated, Date.parse(snapshotAt), Date.parse(checkedAt));
  return {vin: car.vin, lot: car.lot_number, sequence: change.sequence, before,
    bid: shown.pricing.current_bid_usd, observedAt: shown.pricing.current_bid_observed_at,
    finalPrice: shown.pricing.final_price_usd};
}

function timedBidReplay(request) {
  const model = replayBid();
  if (!model.observedAt) return Response.json({error:'Brak potwierdzonego odczytu ceny.'},{status:409});
  const time = new Intl.DateTimeFormat('pl-PL', {timeStyle:'medium',timeZone:'Europe/Warsaw'});
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Historia odczytu ceny Audi | REXBID</title>
  <style>body{margin:0;background:#f4f6f8;color:#142c3c;font:1rem/1.6 system-ui,sans-serif}main{max-width:42rem;margin:auto;padding:2rem 1rem}h1{line-height:1.15}ol{background:white;border:1px solid #d5dfe6;border-radius:.65rem;padding:1rem 1rem 1rem 2.5rem}li+li{margin-top:.65rem}a{color:#145886}</style></head>
  <body><main><p>REXBID · Audyt ceny</p><h1>Audi S5 · oferta licytacji czasowej</h1>
  <p>Odtworzenie na kopii z 24 listopada 2026. Godziny podano dla Polski.</p>
  <p>IAAI LOT ${model.lot}<br>VIN ${model.vin}</p>
  <ol><li>${time.format(new Date(snapshotAt))} · W spisie aukcji zapisano <strong>${model.before} USD</strong>.</li>
  <li>${time.format(new Date(model.observedAt))} · W paczce 23361 Apibara przekazała nową ofertę.</li>
  <li>${time.format(new Date(checkedAt))} · Po zastosowaniu zmiany karta na kopii pokazuje <strong>${model.bid} USD</strong>.</li></ol>
  <p>Cena sprzedaży w tej obserwacji pozostaje niepotwierdzona.</p>
  <p><a href="/">Wróć do strony testowej</a></p></main></body></html>`;
  return new Response(request.method==='HEAD'?null:html, {headers:{
    'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
  }});
}
module.exports = {replayBid,timedBidReplay};
