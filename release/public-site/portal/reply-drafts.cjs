'use strict';

// Pure, deterministic owner drafts. This module has no mail transport, recipient
// lookup or AI inference: facts come only from the authorised portal DTOs.
const KINDS = Object.freeze(['status_update', 'documents_ready', 'delay', 'payment_received']);
const STAGE_LABELS = Object.freeze({
  preparation: 'Przygotowanie importu',
  auction_won: 'Pojazd wygrany na aukcji',
  payment_confirmed: 'Płatność za pojazd potwierdzona',
  pickup_planned: 'Odbiór z aukcji zaplanowany',
  at_us_terminal: 'Pojazd na terminalu w USA',
  loaded: 'Pojazd załadowany do kontenera',
  at_sea: 'Transport morski',
  at_eu_port: 'Pojazd w porcie europejskim',
  customs: 'Odprawa celna',
  delivery: 'Dostawa do klienta',
  delivered: 'Pojazd dostarczony'
});

function invalid() { throw new Error('invalid_request'); }
function line(value, max = 240) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function isPublic(item) { return item?.visibility === 'client'; }
function warsawDate(value) {
  // Require an explicit zone; parsing a date-only/naive timestamp would silently
  // invent a time or depend on the Worker's local zone.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return null;
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', dateStyle: 'long', timeStyle: 'short'
  }).format(new Date(stamp)).replace(/\u00a0/g, ' ');
}
function makeReplyDraft({ kind = 'status_update', order, events = [], files = [], company } = {}) {
  if (!KINDS.includes(kind) || !order || typeof order !== 'object' || Array.isArray(order)
    || !Array.isArray(events) || !Array.isArray(files)) invalid();
  const title = line(order.title, 160);
  if (!title || !Object.hasOwn(STAGE_LABELS, order.status)) invalid();
  const brand = line(company?.name, 80) || 'REXBID';
  const visibleEvents = events.filter(isPublic);
  const visibleFiles = files.filter(file => isPublic(file) && line(file.filename, 180));
  // A later logistics stage is not proof of payment; an explicit confirmation
  // must exist in the client-visible order status or history.
  const paymentEvent = visibleEvents.find(event => event.status === 'payment_confirmed'
    || event.event_type === 'payment_confirmed');
  if (kind === 'payment_received' && order.status !== 'payment_confirmed' && !paymentEvent) invalid();
  if (kind === 'documents_ready' && visibleFiles.length === 0) invalid();

  const warnings = ['Przed wysłaniem sprawdź treść, odbiorcę i aktualność danych w panelu.'];
  const body = ['Dzień dobry,', '', `Przekazujemy aktualizację dotyczącą pojazdu ${title}.`, ''];
  const subjects = {
    status_update: 'Aktualizacja importu',
    documents_ready: 'Nowe pliki w panelu',
    delay: 'Aktualizacja terminu importu',
    payment_received: 'Potwierdzenie płatności za pojazd'
  };
  const status = STAGE_LABELS[order.status];
  const location = line(order.location);
  const eta = warsawDate(order.estimated_arrival_at);
  if (order.estimated_arrival_at && !eta) warnings.push('Pominięto nieprawidłowy lub niejednoznaczny termin przybycia.');
  if (kind === 'documents_ready') {
    body.push('W panelu klienta udostępniliśmy następujące pliki:', ...visibleFiles.slice(0, 50).map(file => `• ${line(file.filename, 180)}`), '');
    body.push('Pliki można otworzyć po zalogowaniu i wybraniu tego zamówienia.');
    warnings.push('Lista dotyczy udostępnionych plików; nie potwierdza kompletności dokumentów ani wysyłki oryginałów.');
  } else if (kind === 'payment_received') {
    body.push('Płatność za pojazd została potwierdzona w panelu REXBID.');
    const paymentAt = paymentEvent && warsawDate(paymentEvent.created_at);
    if (paymentAt) body.push(`Potwierdzenie zapisano: ${paymentAt} (czas w Polsce, Europe/Warsaw).`);
    warnings.push('Sprawdź potwierdzenie wpłaty; szkic nie określa kwoty, rachunku ani opłacenia innych należności.');
  }
  body.push('', `Aktualny potwierdzony etap: ${status}.`);
  if (location) body.push(`Zapisana lokalizacja: ${location}.`);
  if (eta) body.push(`Szacowany termin przybycia: ${eta} (czas w Polsce, Europe/Warsaw). Termin może ulec zmianie.`);
  else body.push('Nie mamy jeszcze potwierdzonego szacowanego terminu przybycia.');

  if (kind === 'delay') {
    // The existence of an ETA does not prove a delay, its cause or an earlier
    // promised date. Use a neutral update and require the owner to assess it.
    body.push('', 'Powyżej podajemy informacje aktualnie zapisane w zamówieniu.');
    warnings.push('Nie ustalono przyczyny ani długości opóźnienia. Uzupełnij je tylko na podstawie potwierdzonych informacji.');
  }
  if (line(order.vessel, 120)) body.push(`Statek: ${line(order.vessel, 120)}.`);
  if (line(order.container_number, 120)) body.push(`Numer kontenera: ${line(order.container_number, 120)}.`);
  body.push('', 'Aktualny przebieg importu, udostępnione pliki i wiadomości znajdą Państwo w panelu klienta. W razie pytań prosimy o wiadomość przy tym zamówieniu.', '', 'Pozdrawiamy,', `Zespół ${brand}`);

  return {
    kind,
    subject: `${brand} — ${subjects[kind]}: ${title}`,
    body: body.join('\n'),
    ready_to_send: false,
    requires_owner_review: true,
    warnings,
    facts: {
      status: order.status,
      estimated_arrival_at: eta ? order.estimated_arrival_at : null,
      payment_confirmation_present: order.status === 'payment_confirmed' || Boolean(paymentEvent),
      client_file_count: visibleFiles.length
    }
  };
}

module.exports = { makeReplyDraft, KINDS };
