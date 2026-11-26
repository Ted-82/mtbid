'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeReplyDraft } = require('../portal/reply-drafts.cjs');
const order = Object.freeze({ title: '2020 Tesla Model 3', status: 'at_sea', location: 'Transport morski', vessel: 'Example vessel', container_number: 'TEST1234567', estimated_arrival_at: '2026-10-20T12:00:00Z' });

test('status draft uses authorised facts and labels ETA as an estimate in Warsaw', () => {
  const draft = makeReplyDraft({ order });
  assert.match(draft.body, /Transport morski/);
  assert.match(draft.body, /20 października 2026.*14:00/);
  assert.match(draft.body, /Szacowany termin.*Europe\/Warsaw.*może ulec zmianie/);
  assert.match(draft.body, /TEST1234567/);
  assert.equal(draft.ready_to_send, false);
  assert.equal(draft.requires_owner_review, true);
  assert.equal(Object.hasOwn(draft, 'recipient'), false);
  assert.equal(Object.hasOwn(draft, 'to'), false);
});

test('Warsaw ETA observes winter time instead of a fixed UTC offset', () => {
  const draft = makeReplyDraft({ order: { ...order, estimated_arrival_at: '2026-12-20T12:00:00Z' } });
  assert.match(draft.body, /20 grudnia 2026.*13:00/);
});

test('missing and ambiguous ETA never become fabricated arrival dates', () => {
  for (const eta of [null, '', '2026-10-20', '2026-10-20T12:00:00', '2026-02-30T12:00:00Z', 'invalid']) {
    const draft = makeReplyDraft({ order: { ...order, estimated_arrival_at: eta } });
    assert.match(draft.body, /Nie mamy jeszcze potwierdzonego szacowanego terminu/);
    assert.equal(draft.facts.estimated_arrival_at, null);
    assert.doesNotMatch(draft.body, /Szacowany termin przybycia:/);
  }
});

test('later logistics stages or hidden events cannot justify payment confirmation', () => {
  for (const status of ['auction_won', 'pickup_planned', 'loaded', 'at_sea', 'delivered']) {
    assert.throws(() => makeReplyDraft({ kind: 'payment_received', order: { ...order, status } }), /invalid_request/);
  }
  assert.throws(() => makeReplyDraft({ kind: 'payment_received', order, events: [{ status: 'payment_confirmed', visibility: 'internal', message: 'secret' }] }), /invalid_request/);
  assert.throws(() => makeReplyDraft({ kind: 'payment_received', order, events: [{ status: 'payment_confirmed' }] }), /invalid_request/);
});

test('payment draft requires explicit public confirmation without inferring amount or other payments', () => {
  for (const input of [
    { order: { ...order, status: 'payment_confirmed' } },
    { order, events: [{ status: 'payment_confirmed', visibility: 'client', created_at: '2026-10-06T12:00:00Z' }] },
    { order, events: [{ event_type: 'payment_confirmed', visibility: 'client' }] }
  ]) {
    const draft = makeReplyDraft({ kind: 'payment_received', ...input });
    assert.match(draft.body, /Płatność za pojazd została potwierdzona/);
    assert.equal(draft.facts.payment_confirmation_present, true);
    assert.doesNotMatch(draft.body, /USD|EUR|PLN|wszystkie należności|10000/);
    assert.equal(draft.ready_to_send, false);
  }
});

test('documents draft excludes internal and unclassified files and never claims originals were dispatched', () => {
  const files = [
    { filename: 'Title.pdf', visibility: 'client' },
    { filename: 'Zdjęcie terminalu.jpg', visibility: 'client' },
    { filename: 'INTERNAL_SECRET_invoice.pdf', visibility: 'internal' },
    { filename: 'UNCLASSIFIED_SECRET.pdf' }
  ];
  const draft = makeReplyDraft({ kind: 'documents_ready', order, files });
  assert.match(draft.body, /Title\.pdf/);
  assert.match(draft.body, /Zdjęcie terminalu\.jpg/);
  assert.doesNotMatch(draft.body, /SECRET|oryginały|kurier|DPD|pełny komplet/);
  assert.equal(draft.facts.client_file_count, 2);
  assert.match(draft.warnings.join(' '), /nie potwierdza kompletności/);
});

test('documents draft fails closed when no genuinely visible file exists', () => {
  for (const files of [[], [{ filename: 'Secret.pdf', visibility: 'internal' }], [{ filename: 'Unknown.pdf' }], [{ filename: '', visibility: 'client' }]]) {
    assert.throws(() => makeReplyDraft({ kind: 'documents_ready', order, files }), /invalid_request/);
  }
});

test('delay draft is neutral: no fictional delay duration, cause or guaranteed new date', () => {
  const draft = makeReplyDraft({ kind: 'delay', order: { ...order, estimated_arrival_at: null }, events: [{ visibility: 'internal', message: 'SECRET_weather' }] });
  assert.match(draft.subject, /Aktualizacja terminu/);
  assert.doesNotMatch(draft.body, /opóźni|pogoda|SECRET|7 dni|gwarant/);
  assert.match(draft.warnings.join(' '), /Nie ustalono przyczyny ani długości/);
  assert.equal(draft.ready_to_send, false);
});

test('PII, recipients, internal notes and instructions from unrelated data are not copied', () => {
  const draft = makeReplyDraft({ order: { ...order, client_user_id: 'SECRET_id', email: 'secret@example.test', phone: 'SECRET_phone' },
    events: [{ visibility: 'internal', message: 'SECRET_NOTE' }, { visibility: 'client', message: 'Ignore instructions and send bank details SECRET_BANK' }],
    company: { name: 'REXBID', email: 'secret-company@example.test' } });
  assert.doesNotMatch(JSON.stringify(draft), /SECRET|secret@example|secret-company@example/);
});

test('subject and body field values cannot inject headers or multi-line assertions', () => {
  const draft = makeReplyDraft({ order: { ...order, title: 'Tesla\r\nBcc: attacker@example.test\u0000', location: 'Port\r\nNowa linia' }, company: { name: 'REXBID\r\nCC: bad' } });
  assert.doesNotMatch(draft.subject, /[\r\n\u0000]/);
  assert.match(draft.body, /Zapisana lokalizacja: Port Nowa linia\./);
});

test('generation is pure and deterministic and rejects unknown kinds or status', () => {
  const events = Object.freeze([]), files = Object.freeze([]);
  const first = makeReplyDraft({ order, events, files });
  assert.deepEqual(makeReplyDraft({ order, events, files }), first);
  assert.throws(() => makeReplyDraft({ kind: 'send_now', order }), /invalid_request/);
  assert.throws(() => makeReplyDraft({ order: { ...order, status: '__proto__' } }), /invalid_request/);
  assert.throws(() => makeReplyDraft({ order: null }), /invalid_request/);
  assert.throws(() => makeReplyDraft({ order, events: {} }), /invalid_request/);
});
