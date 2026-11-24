const test = require('node:test');
const assert = require('node:assert/strict');
const inquiry = require('../public/rexbid-inquiry.js');

test('inquiry keeps exact LOT/platform even when a VIN is also present', () => {
  const context = inquiry.normalizeContext(new URLSearchParams('lot=45439613&platform=iaai&vin=WBA5R1C06MFK00001&title=BMW+330i&purchase_usd=10000&price_kind=buy-now'));
  assert.equal(inquiry.vehiclePath(context), '/car.html?lot=45439613&platform=iaai');
  const draft = inquiry.buildDraft(context,{message:'Proszę o wycenę.', budget:'80000'});
  assert.match(draft,/LOT: 45439613/); assert.match(draft,/Aukcja: IAAI/);
  assert.match(draft,/10000 USD \(Kup teraz\)/); assert.match(draft,/Budżet łączny: 80000 PLN/);
  assert.match(draft,/nie jest zleceniem licytacji/);
});
test('inquiry rejects invalid identities and monetary context instead of inventing zero', () => {
  const context=inquiry.normalizeContext({lot:'<script>',platform:'evil',vin:'no',purchase_usd:'Infinity',budget_pln:'-10',fx_usd_pln:'0'});
  assert.equal(inquiry.vehiclePath(context),''); assert.equal(context.purchase_usd,null);
  assert.equal(context.budget_pln,null); assert.equal(context.fx_usd_pln,null);
  assert.doesNotMatch(inquiry.buildDraft(context),/Cena do kalkulacji:|Szacunkowa wycena importu:/);
});
test('draft preserves partial budget meaning and neutral source price', () => {
  const draft=inquiry.buildDraft({lot:'62674546',platform:'copart',budget_pln:'60000',budget_status:'partial',fx_usd_pln:'3.9116',purchase_usd:'10000',price_kind:'current'});
  assert.match(draft,/Szacunkowa wycena importu: 60000 PLN \(wycena częściowa\)/); assert.match(draft,/aktualna oferta/); assert.match(draft,/Kurs użyty do wyceny: 3.9116 PLN \/ USD/);
  assert.doesNotMatch(draft,/Wysłano|potwierdzona cena pod dom/);
});

test('complete calculator estimate is neutral about input source and separate from customer budget', () => {
  const context={lot:'62674546',platform:'copart',budget_pln:'99271.25',budget_status:'complete'};
  const draft=inquiry.buildDraft(context,{budget:'110000'});
  assert.match(draft,/Szacunkowa wycena importu: 99271\.25 PLN \(komplet wskazanych składników\)/);
  assert.match(draft,/Proszę o potwierdzenie kwoty i zakresu wyceny przed zakupem\./);
  assert.match(draft,/Budżet łączny: 110000 PLN/);
  assert.doesNotMatch(draft,/arkusza|pola uzupełnione przez użytkownika|Budżet łączny: 99271/);
  assert.doesNotMatch(inquiry.buildDraft(context),/Budżet łączny:/,'calculator total must not become a customer budget');
});

test('unknown estimate status remains partial and invalid estimate cannot claim completeness', () => {
  const draft=inquiry.buildDraft({budget_pln:'25000',budget_status:'confirmed'});
  assert.match(draft,/25000 PLN \(wycena częściowa\)/);
  for(const budget_pln of [undefined,null,'','Infinity','-1','<script>']) {
    assert.doesNotMatch(inquiry.buildDraft({budget_pln,budget_status:'complete'}),/Szacunkowa wycena importu:|komplet wskazanych składników/);
  }
});
test('mailto requires configured mailbox, encodes body and prevents header injection', () => {
  assert.equal(inquiry.mailto('', 'test'),''); assert.equal(inquiry.mailto('x@example.com\r\nBcc:y@example.com','test'),'');
  const url=inquiry.mailto('office@example.com','LOT 1\nA&B <tag>');
  assert.equal(new URL(url).searchParams.get('body'),'LOT 1\nA&B <tag>');
  assert.equal(new URL(url).searchParams.get('subject'),'Zapytanie REXBID');
});
test('VIN-only fallback and literal user text are bounded, without URL injection', () => {
  const c=inquiry.normalizeContext({vin:'5yj3e1ea3rf866005',title:'<img src=x onerror=alert(1)>',purchase_usd:'1e9'});
  assert.equal(inquiry.vehiclePath(c),'/car.html?vin=5YJ3E1EA3RF866005');
  assert.equal(c.purchase_usd,null);
  const draft=inquiry.buildDraft(c,{message:'x'.repeat(5000)}); assert.ok(draft.length<3700);
  assert.match(draft,/<img src=x onerror=alert\(1\)>/,'draft is plain text, never injected HTML');
});

test('stored current bid and stored Buy Now stay explicitly snapshots in contact text', () => {
  for (const [price_kind,label] of [['current','ostatnia zapisana oferta'],['buy-now','Kup teraz · zapis danych']]) {
    const context=inquiry.normalizeContext({lot:'62674546',platform:'copart',purchase_usd:'10000',price_kind,
      price_status:'snapshot',price_observed_at:'2026-10-05T21:30:00Z'});
    const draft=inquiry.buildDraft(context,{message:'Proszę o aktualną dostępność.'});
    assert.equal(context.purchase_usd,10000);
    assert.equal(context.price_status,'snapshot');
    assert.equal(context.price_observed_at,'2026-10-05T21:30:00.000Z');
    assert.ok(draft.includes('10000 USD ('+label+')'));
    assert.match(draft,/Dane ceny zapisane: 2026-10-05T21:30:00\.000Z/);
    assert.match(draft,/Cena pochodzi z zapisu danych/);
    assert.doesNotMatch(draft,/10000 USD \(aktualna oferta\)/);
  }
});

test('current and legacy price contexts retain existing labels; own price never becomes an observed auction bid', () => {
  for (const price_status of ['current',undefined]) {
    const draft=inquiry.buildDraft({purchase_usd:'10000',price_kind:'current',price_status});
    assert.match(draft,/10000 USD \(aktualna oferta\)/);
    assert.doesNotMatch(draft,/ostatnia zapisana oferta/);
  }
  const own=inquiry.buildDraft({purchase_usd:'15000',price_kind:'custom',price_status:'snapshot',price_observed_at:'2026-10-05T21:30:00Z'});
  assert.match(own,/15000 USD \(własna planowana cena\)/);
  assert.doesNotMatch(own,/Dane ceny zapisane:|Cena pochodzi z zapisu danych/);
});

test('price metadata accepts only known statuses and valid UTC dates and cannot alter monetary parsing', () => {
  for (const badDate of ['2026-02-30T12:00:00Z','2026-10-05','2026-10-05T12:00:00+02:00','2026-10-05T24:00:00Z','<img src=x>','2026-10-05T12:00:00Z\nBcc:bad@example.net']) {
    const context=inquiry.normalizeContext({purchase_usd:'10000',price_kind:'current',price_status:'LIVE<script>',price_observed_at:badDate});
    assert.equal(context.price_status,'');
    assert.equal(context.price_observed_at,'');
    assert.equal(context.purchase_usd,10000);
    assert.doesNotMatch(inquiry.buildDraft(context),/Dane ceny zapisane:|<script>|Bcc:/);
  }
  assert.equal(inquiry.normalizeContext({purchase_usd:'Infinity',price_status:'current'}).purchase_usd,null);
  assert.equal(inquiry.normalizeContext({purchase_usd:'-10000',price_status:'snapshot'}).purchase_usd,null);
});

test("inquiry return rejects external and noncatalog destinations and excludes navigation from mail",function safeReturnRegression(){
 for(const return_to of ['https://evil.test/','//evil.test/','/api/auth/callback?code=private','/\\evil.test']){
  const url=new URL(inquiry.vehiclePath({lot:'123',platform:'copart',return_to}),'https://rexbid.pl');
  assert.equal(url.searchParams.get('return_to'),'/?catalog=1#results');
 }
 const c={lot:'123',platform:'copart',return_to:'/?catalog=1&make=TESLA#results'};
 assert.doesNotMatch(inquiry.buildDraft(c),/return_to|make=TESLA/,'navigation choices are not transmitted in mail');
});

test('inquiry preserves explicit zero while missing and invalid amounts remain missing', () => {
  for(const amount of ['0',0,'0.00']) {
    const c=inquiry.normalizeContext({purchase_usd:amount,price_kind:'current',price_status:'snapshot',price_observed_at:'2026-10-09T12:52:00Z'});
    assert.equal(c.purchase_usd,0);
    const draft=inquiry.buildDraft(c);
    assert.match(draft,/0 USD \(ostatnia zapisana oferta\)/);
    assert.match(draft,/2026-10-09T12:52:00.000Z/);
  }
  for(const amount of [undefined,null,'',' ','-1','NaN','Infinity']) {
    assert.equal(inquiry.normalizeContext({purchase_usd:amount}).purchase_usd,null);
    assert.doesNotMatch(inquiry.buildDraft({purchase_usd:amount}),/Cena do kalkulacji/);
  }
});
test('draft stays on approved environment and rejects arbitrary host input', () => {
  const c={lot:'44593083',platform:'iaai',return_to:'/?catalog=1&make=HONDA'};
  for(const origin of ['https://rexbid.pl','https://www.rexbid.pl','https://rexbid-auth-test.tedn828.workers.dev']) {
    assert.ok(inquiry.buildDraft(c,{},origin).includes('Karta auta: '+origin+'/car.html?lot=44593083&platform=iaai'));
  }
  for(const bad of [undefined,'https://evil.example','https://rexbid.pl.evil.example','https://rexbid.pl@evil.example','http://rexbid.pl','https://rexbid.pl/?token=secret']) {
    const draft=inquiry.buildDraft(c,{},bad);
    assert.ok(draft.includes('Karta auta: https://rexbid.pl/car.html?'));
    assert.doesNotMatch(draft,/evil|secret|return_to/);
  }
});
