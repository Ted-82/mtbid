const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");

const publicRoot = path.join(__dirname, "../public");
const read = name => fs.readFileSync(path.join(publicRoot, name), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
const contextQuery = "lot=45439613&platform=iaai&vin=WBA5R1C06MFK00001&title=BMW+330i&purchase_usd=10000&price_kind=buy-now&budget_pln=60000&budget_status=partial&fx_usd_pln=3.9116";

// DOM behavior tests use the real HTML and real app scripts. jsdom does not
// provide browser layout, viewport rendering, clipboard permission or hosting QA.
async function contactPage(t, {query=contextQuery, email="", rejectConfig=false, reducedMotion=false, origin="https://rexbid.pl",direct=false,sendResponse=null} = {}) {
  // outside-only does not enable the HTML parser's scripting flag. Exclude the
  // no-JS fallback so its display:none cannot affect this scripted focus test.
  const html = read("kontakt.html").replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/g, "");
  const dom = new JSDOM(html, {url:origin + "/kontakt.html?" + query, runScripts:"outside-only"});
  t.after(() => dom.window.close());
  const {window:win} = dom;
  const doc = win.document;
  await new Promise(resolve => doc.addEventListener("DOMContentLoaded", resolve, {once:true}));
  const requests = [], scrolls = [];
  win.fetch = async (url, options) => {
    requests.push({url, options});
    if(url==='/api/contact/send'&&direct)return sendResponse?sendResponse(JSON.parse(options.body),options):{ok:true,json:async()=>({ok:true,id:JSON.parse(options.body).request_id,status:'queued'})};
    if (rejectConfig) throw new Error("fixture: contact configuration unavailable");
    return {ok:true, json:async () => ({email,...(direct?{mode:'direct',enabled:true}:{})})};
  };
  win.matchMedia = () => ({matches:reducedMotion});
  win.HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({node:this, options}); };
  // Native navigation is outside this unit test. Event handlers still run.
  doc.addEventListener("click", event => { if (event.target.closest("a")) event.preventDefault(); });
  win.eval(read("rexbid-mobile-nav.js"));
  win.eval(read("rexbid-car-navigation.js"));
  win.eval(read("rexbid-inquiry.js"));
  win.RexBidInquiry.mount(doc,win);
  await flush();
  const form = doc.getElementById("inquiryForm");
  form.elements.namedItem("name").value = "Klient testowy";
  form.elements.namedItem("email").value = "client@example.net";
  const set = (name, value, input=true) => {
    const field = form.elements.namedItem(name);
    field.value = value;
    if (input) field.dispatchEvent(new win.Event("input", {bubbles:true}));
    return field;
  };
  const submit = () => form.dispatchEvent(new win.Event("submit", {bubbles:true, cancelable:true}));
  return {win, doc, form, set, submit, requests, scrolls};
}

test('direct contact sends from the page, includes vehicle context and confirms durable acceptance',async t=>{
 const p=await contactPage(t,{direct:true,email:'kontakt@rexbid.pl'});p.set('message','Proszę o wycenę.');p.submit();await flush();
 const posts=p.requests.filter(x=>x.url==='/api/contact/send');assert.equal(posts.length,1);const payload=JSON.parse(posts[0].options.body);assert.match(payload.request_id,/^[a-f0-9-]{36}$/);assert.match(payload.draft,/45439613/);assert.match(payload.draft,/60000|60 000/);assert.equal(posts[0].options.credentials,'same-origin');assert.match(p.doc.getElementById('inquiryStatus').textContent,/zostało przyjęte/);assert.equal(p.doc.getElementById('inquiryMail').hidden,true);assert.equal(p.win.localStorage.length,0);
});
test("contact displays the delivery and includes it in the draft without an import total", async t => {
  const query = "lot=76295566&platform=copart&purchase_usd=16300&delivery_destination=Warszawa&delivery_pln=1800";
  const page = await contactPage(t,{query});
  const summary = page.doc.getElementById("inquiryContext");
  assert.match(summary.textContent,/Miejsce dostawy: Warszawa · 1800 PLN za dostawę/);
  assert.equal(summary.querySelector("[data-inquiry-estimate]"),null);
  page.set("message","Proszę o potwierdzenie wyceny.");
  page.submit();
  assert.match(page.doc.getElementById("inquiryPreview").value,/Miejsce dostawy: Warszawa · 1800 PLN za dostawę/);
  assert.equal(page.requests.length,1);
});
test('direct contact retry preserves its request ID and input after a lost response',async t=>{
 let first=true;const p=await contactPage(t,{direct:true,email:'kontakt@rexbid.pl',sendResponse:async body=>{if(first){first=false;throw Error('timeout');}return{ok:true,json:async()=>({ok:true,id:body.request_id})};}});p.set('message','Nie zgub tej treści.');p.submit();await flush();assert.match(p.doc.getElementById('inquiryStatus').textContent,/Nie otrzymaliśmy potwierdzenia/);assert.equal(p.form.elements.message.value,'Nie zgub tej treści.');p.submit();await flush();const posts=p.requests.filter(x=>x.url==='/api/contact/send').map(x=>JSON.parse(x.options.body));assert.equal(posts.length,2);assert.equal(posts[0].request_id,posts[1].request_id);assert.match(p.doc.getElementById('inquiryStatus').textContent,/zostało przyjęte/);
});
test('direct contact quota error is visible without a false delivery confirmation',async t=>{
 const p=await contactPage(t,{direct:true,email:'kontakt@rexbid.pl',sendResponse:async()=>({ok:false,json:async()=>({error:'rate_limited'})})});p.set('message','Proszę o kontakt.');p.submit();await flush();assert.match(p.doc.getElementById('inquiryStatus').textContent,/limit formularza/);assert.doesNotMatch(p.doc.getElementById('inquiryStatus').textContent,/zostało przyjęte/);assert.equal(p.form.querySelector('button[type=submit]').disabled,false);
});

test("contact DOM preserves exact LOT/platform return link and fetches only public configuration", async t => {
  const {doc, requests} = await contactPage(t);
  assert.match(doc.querySelector("aside").textContent, /wybierz „Przygotuj zapytanie o import”/);
  assert.doesNotMatch(doc.querySelector("aside").textContent, /Zapytaj o to auto/);
  const summary = doc.getElementById("inquiryContext");
  assert.equal(summary.hidden, false);
  assert.equal(summary.querySelector("strong").textContent, "BMW 330i");
  assert.match(summary.querySelector("small").textContent, /IAAI · LOT 45439613 · WBA5R1C06MFK00001/);
  assert.equal(new URL(summary.querySelector("a").href).search, "?lot=45439613&platform=iaai");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/contact/config");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.body, undefined);
  assert.equal(doc.getElementById("inquiryOutput").hidden, true);
  assert.equal(doc.getElementById("inquiryMail").hidden, true);
});

test("required message and invalid e-mail keep the draft hidden until form validity passes", async t => {
  const page = await contactPage(t);
  page.set("name", ""); page.set("email", "");
  page.submit();
  assert.equal(page.form.checkValidity(), false);
  assert.equal(page.doc.getElementById("inquiryOutput").hidden, true);
  page.set("message", "Proszę o wycenę auta.");
  page.set("email", "incorrect-address");
  page.submit();
  assert.equal(page.doc.getElementById("inquiryOutput").hidden, true);
  page.set("email", "owner@example.net");
  assert.equal(page.form.checkValidity(), false, "sender name is required too");
  page.set("name", "Klient testowy");
  assert.equal(page.form.checkValidity(), true);
  page.submit();
  assert.equal(page.doc.getElementById("inquiryOutput").hidden, false);
});

test("prepare creates a contextual partial-budget draft and never submits entered personal data", async t => {
  const page = await contactPage(t, {reducedMotion:true});
  page.set("name", "Testowy użytkownik");
  page.set("email", "owner@example.net");
  page.set("budget", "80000");
  page.set("message", "Proszę sprawdzić dokumenty oraz możliwość importu.");
  assert.equal(page.submit(), false, "native form submission is cancelled");
  const output = page.doc.getElementById("inquiryPreview").value;
  assert.match(output, /LOT: 45439613\nAukcja: IAAI/);
  assert.match(output, /Karta auta: https:\/\/rexbid\.pl\/car\.html\?lot=45439613&platform=iaai/);
  assert.match(output, /10000 USD \(Kup teraz\)/);
  assert.match(output, /Szacunkowa wycena importu: 60000 PLN \(wycena częściowa\)/);
  assert.match(output, /Budżet łączny: 80000 PLN/);
  assert.match(output, /Kontakt: owner@example\.net/);
  assert.match(page.doc.getElementById("inquiryStatus").textContent, /Nie wysłano wiadomości/);
  assert.equal(page.requests.length, 1, "form submission does not invoke any endpoint");
  assert.equal(page.scrolls.length, 1);
  assert.equal(page.scrolls[0].node.id, "inquiryOutput");
  assert.equal(page.scrolls[0].options.behavior, "auto");
});

test("calculator estimate appears by the vehicle and never fills the customer's budget", async t => {
  const page=await contactPage(t,{query:contextQuery.replace('budget_status=partial','budget_status=complete')});
  const estimate=page.doc.querySelector('[data-inquiry-estimate]');
  assert.match(estimate.textContent,/Szacunkowa wycena importu: 60000 PLN \(komplet wskazanych składników\)/);
  assert.match(estimate.textContent,/Kwotę i zakres potwierdzimy przed zakupem/);
  assert.equal(page.form.elements.namedItem('budget').value,'');
  page.set('message','Proszę o potwierdzenie otrzymanej wyceny.');page.submit();
  assert.doesNotMatch(page.doc.getElementById('inquiryPreview').value,/Budżet łączny:|arkusza|pola uzupełnione przez użytkownika/);
  page.set('budget','85000');
  assert.match(page.doc.getElementById('inquiryPreview').value,/Budżet łączny: 85000 PLN/);
  assert.match(estimate.textContent,/60000 PLN/);
  assert.equal(page.requests.length,1,'displaying or preparing the estimate never sends a message');
});

test("missing or invalid calculator estimate produces no misleading contact summary", async t => {
  for(const query of ['lot=45439613&platform=iaai', 'lot=45439613&platform=iaai&budget_pln=-1&budget_status=complete']) {
    const page=await contactPage(t,{query});
    assert.equal(page.doc.querySelector('[data-inquiry-estimate]'),null);
    assert.equal(page.form.elements.namedItem('budget').value,'');
    assert.equal(page.requests.length,1);
  }
});

test("live form edits preserve identity and literal text without HTML execution", async t => {
  const query = "lot=62674546&platform=copart&title=" + encodeURIComponent('<img src=x onerror="window.fixtureExecuted=true">');
  const page = await contactPage(t, {query});
  assert.equal(page.doc.getElementById("inquiryContext").querySelector("img"), null);
  page.set("message", "Pierwsza treść");
  page.submit();
  page.set("message", '<script>window.fixtureExecuted=true</script>\nDruga treść & pytanie?');
  assert.match(page.doc.getElementById("inquiryPreview").value, /Druga treść & pytanie\?/);
  assert.match(page.doc.getElementById("inquiryPreview").value, /LOT: 62674546\nAukcja: COPART/);
  assert.equal(page.win.fixtureExecuted, undefined);
  assert.equal(page.doc.getElementById("inquiryOutput").querySelector("script"), null);
  assert.equal(page.requests.length, 1);
});

test("clipboard success copies the current draft and explicitly reports that nothing was sent", async t => {
  const page = await contactPage(t);
  const copied = [];
  Object.defineProperty(page.win.navigator, "clipboard", {value:{writeText:async value => copied.push(value)}});
  page.set("message", "Wiadomość do skopiowania");
  page.submit();
  page.set("message", "Zaktualizowana wiadomość do skopiowania");
  page.doc.getElementById("inquiryCopy").click();
  await flush();
  assert.equal(copied.length, 1);
  assert.equal(copied[0], page.doc.getElementById("inquiryPreview").value);
  assert.match(copied[0], /Zaktualizowana wiadomość/);
  assert.match(page.doc.getElementById("inquiryStatus").textContent, /Skopiowano.*nie została wysłana/);
  assert.equal(page.requests.length, 1);
});

test("clipboard rejection falls back to focused selected text for manual copying", async t => {
  const page = await contactPage(t);
  Object.defineProperty(page.win.navigator, "clipboard", {value:{writeText:async () => {throw new Error("fixture: permission denied");}}});
  page.set("message", "Wiadomość przy zablokowanym schowku");
  page.submit();
  page.doc.getElementById("inquiryCopy").click();
  await flush();
  const preview = page.doc.getElementById("inquiryPreview");
  assert.equal(page.doc.activeElement, preview);
  assert.equal(preview.selectionStart, 0);
  assert.equal(preview.selectionEnd, preview.value.length);
  assert.match(page.doc.getElementById("inquiryStatus").textContent, /Zaznaczono treść/);
  assert.equal(page.requests.length, 1);
});

test("configured mailbox opens an encoded draft with identity, user text and no extra mail headers", async t => {
  const page = await contactPage(t, {email:"office+portal@example.net"});
  page.set("message", "Pytanie: A&B?\nNowy wiersz + polskie znaki: ąę.");
  page.submit();
  const mail = page.doc.getElementById("inquiryMail");
  assert.equal(mail.hidden, false);
  const link = new URL(mail.href);
  assert.equal(link.protocol, "mailto:");
  assert.equal(link.pathname, "office+portal@example.net");
  assert.equal(link.searchParams.get("subject"), "REXBID — IAAI LOT 45439613 — Wycena importu");
  assert.equal(link.searchParams.get("body"), page.doc.getElementById("inquiryPreview").value);
  assert.deepEqual([...link.searchParams.keys()], ["subject", "body"]);
  assert.equal(page.doc.getElementById("contactEmail").textContent, "office+portal@example.net");
  assert.match(page.doc.getElementById("contactAvailability").textContent, /Twoim programie pocztowym/);
  assert.equal(page.requests.length, 1);
});

test("invalid or unavailable contact configuration retains the owner supplied mailbox and local draft", async t => {
  const page = await contactPage(t, {email:"office@example.net\r\nBcc:other@example.net"});
  page.set("message", "Zapytanie do zapisania");
  page.submit();
  assert.equal(page.doc.getElementById("inquiryOutput").hidden, false);
  assert.equal(page.doc.getElementById("inquiryMail").hidden, false);
  assert.equal(new URL(page.doc.getElementById("inquiryMail").href).pathname, "kontakt@rexbid.pl");
  assert.equal(page.doc.getElementById("contactEmail").hidden, false);
  assert.equal(page.doc.getElementById("contactEmail").textContent, "kontakt@rexbid.pl");
  const unavailable = await contactPage(t, {rejectConfig:true});
  unavailable.set("message", "Zapytanie przy braku konfiguracji");
  unavailable.submit();
  assert.equal(unavailable.doc.getElementById("inquiryOutput").hidden, false);
  assert.equal(unavailable.doc.getElementById("inquiryMail").hidden, false);
  assert.equal(new URL(unavailable.doc.getElementById("inquiryMail").href).pathname, "kontakt@rexbid.pl");
  assert.equal(page.requests.length, 1, "preparing a fallback mailto never sends form data");
});

test("download exports the current text and exact LOT filename without sending a request", async t => {
  const snapshotQuery = contextQuery.replace("price_kind=buy-now", "price_kind=current") + "&price_status=snapshot&price_observed_at=2026-10-05T21%3A30%3A00.000Z";
  const page = await contactPage(t, {query:snapshotQuery});
  const downloads = [], blobs = [], revoked = [], timers = [];
  page.win.URL.createObjectURL = blob => {blobs.push(blob); return "blob:fixture-inquiry";};
  page.win.URL.revokeObjectURL = href => revoked.push(href);
  page.win.HTMLAnchorElement.prototype.click = function () {downloads.push({href:this.href, filename:this.download});};
  page.win.setTimeout = (callback, milliseconds) => {timers.push({callback,milliseconds}); return timers.length;};
  page.set("message", "Dokument z polskimi znakami: wycena łodzi i auta.");
  page.submit();
  page.doc.getElementById("inquiryDownload").click();
  assert.deepEqual(downloads, [{href:"blob:fixture-inquiry", filename:"REXBID_zapytanie_45439613.txt"}]);
  assert.equal(blobs[0].type, "text/plain;charset=utf-8");
  const exported = await new Promise((resolve,reject) => {
    const reader = new page.win.FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blobs[0]);
  });
  assert.equal(exported, page.doc.getElementById("inquiryPreview").value);
  assert.match(exported,/10000 USD \(ostatnia zapisana oferta\)/);
  assert.match(exported,/Dane ceny zapisane: 2026-10-05T21:30:00\.000Z/);
  assert.doesNotMatch(exported,/10000 USD \(aktualna oferta\)/);
  assert.match(page.doc.getElementById("inquiryStatus").textContent, /nie została wysłana/);
  assert.equal(timers[0].milliseconds, 1000);
  timers[0].callback();
  assert.deepEqual(revoked, ["blob:fixture-inquiry"]);
  assert.equal(page.requests.length, 1);
});

test("stored-price contact draft keeps snapshot meaning in copied text and configured email", async t => {
  const query = contextQuery.replace("price_kind=buy-now", "price_kind=current") + "&price_status=snapshot&price_observed_at=2026-10-05T21%3A30%3A00Z";
  const page = await contactPage(t, {query,email:"office@example.net"});
  const copied = [];
  Object.defineProperty(page.win.navigator,"clipboard",{value:{writeText:async value => copied.push(value)}});
  page.set("message","Proszę potwierdzić bieżącą dostępność zapisanej oferty.");
  page.submit();
  page.doc.getElementById("inquiryCopy").click();
  await flush();
  assert.match(copied[0],/10000 USD \(ostatnia zapisana oferta\)/);
  assert.match(copied[0],/Cena pochodzi z zapisu danych/);
  assert.doesNotMatch(copied[0],/10000 USD \(aktualna oferta\)/);
  assert.equal(new URL(page.doc.getElementById("inquiryMail").href).searchParams.get("body"),copied[0]);
  assert.match(copied[0],/LOT: 45439613\nAukcja: IAAI/);
  assert.equal(page.requests.length,1);
});

test("reset followed by copying rebuilds a draft without retaining cleared personal fields", async t => {
  const page = await contactPage(t);
  const copied = [];
  Object.defineProperty(page.win.navigator, "clipboard", {value:{writeText:async value => copied.push(value)}});
  page.set("name", "Użytkownik przed resetem"); page.set("email", "before-reset@example.net");
  page.set("message", "Treść przed resetem"); page.submit();
  page.form.reset();
  page.doc.getElementById("inquiryCopy").click();
  await flush();
  assert.doesNotMatch(copied[0], /przed resetem|before-reset@example\.net/);
  assert.match(copied[0], /LOT: 45439613\nAukcja: IAAI/);
});

test("mobile navigation reflects open state, Escape restores toggle focus and outside clicks close it", async t => {
  const {win,doc} = await contactPage(t);
  const toggle = doc.querySelector(".rex-menu-toggle"), nav = doc.getElementById("rexPrimaryNav");
  assert.equal(doc.querySelectorAll("header nav").length, 1);
  assert.equal(toggle.getAttribute("aria-controls"), nav.id);
  assert.equal(nav.querySelector('[aria-current="page"]').textContent, "Kontakt");
  toggle.click();
  assert.equal(nav.classList.contains("is-open"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  doc.dispatchEvent(new win.KeyboardEvent("keydown", {key:"Escape",bubbles:true}));
  assert.equal(nav.classList.contains("is-open"), false);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, toggle);
  toggle.click();
  doc.querySelector("main h1").click();
  assert.equal(nav.classList.contains("is-open"), false);
  toggle.click();
  nav.querySelector("a").click();
  assert.equal(nav.classList.contains("is-open"), false);
});

test("contact preserves validated catalog context through both return links",async function returnRegression(t){
 const returnTo='/?catalog=1&platform=copart&make=TESLA&s=57660876#results';
 const {doc}=await contactPage(t,{query:contextQuery+'&return_to='+encodeURIComponent(returnTo)});
 const back=new URL(doc.querySelector('#inquiryContext a').href);
 assert.equal(back.searchParams.get('lot'),'45439613');
 assert.equal(back.searchParams.get('platform'),'iaai');
 assert.equal(back.searchParams.get('return_to'),returnTo);
 assert.equal(new URL(doc.getElementById('inquiryCatalogReturn').href).search,'?catalog=1&platform=copart&make=TESLA&s=57660876');
});

test('staging contact draft and mail body keep staging link and zero without sending data', async t => {
  const page=await contactPage(t,{origin:'https://rexbid-auth-test.tedn828.workers.dev',query:'lot=44593083&platform=iaai&purchase_usd=0&price_kind=current&price_status=snapshot'});
  page.set('message','Test lokalnego przygotowania zapytania.'); page.submit();
  const draft=page.doc.getElementById('inquiryPreview').value;
  assert.ok(draft.includes('https://rexbid-auth-test.tedn828.workers.dev/car.html?lot=44593083&platform=iaai'));
  assert.match(draft,/0 USD \(ostatnia zapisana oferta\)/);
  assert.equal(new URL(page.doc.getElementById('inquiryMail').href).searchParams.get('body'),draft);
  assert.equal(page.requests.length,1);
  assert.equal(page.requests[0].url,'/api/contact/config');
});

test('question shortcuts preserve existing text, avoid duplicates and update only the local draft', async t => {
  const page=await contactPage(t);page.set('message','Moje własne pytanie.');page.submit();
  const button=page.doc.querySelector('[data-inquiry-question="budget"]');button.click();
  const message=page.form.elements.namedItem('message');
  assert.match(message.value,/^Moje własne pytanie\.\n\nProszę o pełną wycenę/);
  assert.ok(page.doc.getElementById('inquiryPreview').value.includes(message.value));
  assert.equal(page.doc.activeElement,message);
  const before=message.value;button.click();assert.equal(message.value,before);
  assert.match(page.doc.getElementById('inquiryQuestionStatus').textContent,/już w wiadomości/);
  assert.equal(page.requests.length,1);
});

test('question shortcuts never silently truncate a long message', async t => {
  const page=await contactPage(t);page.set('message','x'.repeat(2990));
  page.doc.querySelector('[data-inquiry-question="condition"]').click();
  assert.equal(page.form.elements.namedItem('message').value,'x'.repeat(2990));
  assert.match(page.doc.getElementById('inquiryQuestionStatus').textContent,/Brak miejsca/);
  assert.equal(page.requests.length,1);
});

test('contact channels distinguish local inquiry, existing portal and searchable help', async t => {
  const page=await contactPage(t);
  const routes=page.doc.querySelector('.contact-routes');
  assert.deepEqual([...routes.querySelectorAll('a')].map(x=>x.getAttribute('href')),['#inquiryHeading','/panel','/pomoc']);
  assert.match(routes.textContent,/Po zalogowaniu/);
  assert.doesNotMatch(routes.textContent,/czat na żywo|\d+\s*minut|24\/7/i);
  page.set('message','Pytanie');page.set('topic','support');page.submit();
  assert.equal(new URL(page.doc.getElementById('inquiryMail').href).searchParams.get('subject'),'REXBID — IAAI LOT 45439613 — Pomoc w serwisie');
});

test('whitespace-only required fields are rejected and editing clears the exact field error',async t=>{
 const p=await contactPage(t);p.set('name',' \t ');p.set('message',' \n ');p.submit();
 assert.equal(p.doc.getElementById('inquiryOutput').hidden,true);assert.equal(p.doc.activeElement,p.form.elements.namedItem('name'));assert.equal(p.form.checkValidity(),false);
 p.set('name','Anna');assert.equal(p.form.elements.namedItem('name').validity.customError,false);p.submit();assert.equal(p.doc.activeElement,p.form.elements.namedItem('message'));
 p.set('message','Proszę sprawdzić auto.');p.submit();assert.equal(p.doc.getElementById('inquiryOutput').hidden,false);assert.equal(p.requests.length,1);
});
test('email action rechecks and rebuilds the current form including autofill without input events',async t=>{
 const p=await contactPage(t);p.set('message','Pierwotne pytanie.');p.submit();const mail=p.doc.getElementById('inquiryMail');
 p.set('email','autofill@example.net',false);p.set('message','Najnowsze pytanie bez zdarzenia input.',false);
 mail.dispatchEvent(new p.win.MouseEvent('click',{bubbles:false,cancelable:true}));
 assert.match(new URL(mail.href).searchParams.get('body'),/autofill@example.net/);assert.match(new URL(mail.href).searchParams.get('body'),/Najnowsze pytanie/);
 p.set('name','   ',false);const accepted=mail.dispatchEvent(new p.win.MouseEvent('click',{bubbles:false,cancelable:true}));assert.equal(accepted,false);assert.equal(p.doc.activeElement,p.form.elements.namedItem('name'));assert.equal(p.requests.length,1);
});
test('reset immediately clears the preview and email href containing previous personal data',async t=>{
 const p=await contactPage(t);p.set('name','Poprzedni nadawca');p.set('email','previous@example.net');p.set('message','Prywatna poprzednia wiadomość');p.submit();
 p.form.reset();assert.equal(p.doc.getElementById('inquiryOutput').hidden,true);assert.equal(p.doc.getElementById('inquiryPreview').value,'');const mail=p.doc.getElementById('inquiryMail');assert.equal(mail.hidden,true);assert.equal(mail.getAttribute('href'),null);assert.equal(p.doc.getElementById('inquiryStatus').textContent,'');assert.equal(p.requests.length,1);
});
test('change-only select updates both draft subject and body',async t=>{
 const p=await contactPage(t);p.set('message','Pytanie o usługę.');p.submit();const topic=p.form.elements.namedItem('topic');topic.value='support';topic.dispatchEvent(new p.win.Event('change',{bubbles:true}));
 assert.match(p.doc.getElementById('inquiryPreview').value,/Temat: Pytanie o serwis/);assert.match(new URL(p.doc.getElementById('inquiryMail').href).searchParams.get('subject'),/Pomoc w serwisie/);assert.equal(p.requests.length,1);
});

test('copying an accepted inquiry retains its receipt and edits are distinguished from it', async t => {
  const p = await contactPage(t, {direct:true, email:'kontakt@rexbid.pl'});
  Object.defineProperty(p.win.navigator,'clipboard',{value:{writeText:async()=>{}}});
  p.set('message','Pierwsze zapytanie.'); p.submit(); await flush();
  const receipt = p.doc.getElementById('inquiryStatus').textContent;
  p.doc.getElementById('inquiryCopy').click(); await flush();
  assert.equal(p.doc.getElementById('inquiryStatus').textContent, receipt);
  assert.equal(p.doc.getElementById('inquiryMail').hidden,true);
  p.submit(); await flush();
  assert.equal(p.requests.filter(x=>x.url==='/api/contact/send').length,1);
  p.set('message','Drugie zapytanie.');
  assert.doesNotMatch(p.doc.getElementById('outputHeading').textContent,/przyjęte/);
  assert.doesNotMatch(p.doc.getElementById('inquiryStatus').textContent,/zostało przyjęte/);
  p.submit(); await flush();
  assert.equal(p.requests.filter(x=>x.url==='/api/contact/send').length,2);
});
test('editing during send never marks an unsent edit accepted', async t => {
  let finish;
  const p=await contactPage(t,{direct:true,email:'kontakt@rexbid.pl',sendResponse:body=>new Promise(resolve=>{
    finish=()=>resolve({ok:true,json:async()=>({ok:true,id:body.request_id})});
  })});
  p.set('message','Pierwsza treść.');p.submit();p.set('message','Zmieniona treść.');
  finish();await flush();
  assert.doesNotMatch(p.doc.getElementById('outputHeading').textContent,/Zapytanie przyjęte/);
  assert.match(p.doc.getElementById('inquiryStatus').textContent,/zmian|Zmienion/);
  assert.match(p.doc.getElementById('inquiryPreview').value,/Zmieniona treść/);
});

test('explicit customer budget in the fragment pre-fills the editable field and keeps the quote separate',async t=>{
  const p=await contactPage(t,{query:contextQuery+'#customer_budget_pln=100000'});
  assert.equal(p.form.elements.budget.value,'100000');
  p.set('message','Sprawdzenie budżetu');p.set('budget','95000');p.submit();
  assert.match(p.doc.getElementById('inquiryPreview').value,/Budżet łączny: 95000 PLN/);
  assert.match(p.doc.getElementById('inquiryPreview').value,/Szacunkowa wycena importu: 60000 PLN/);
  const invalid=await contactPage(t,{query:contextQuery+'#customer_budget_pln=-5'});
  assert.equal(invalid.form.elements.budget.value,'');
});
