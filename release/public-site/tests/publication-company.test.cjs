'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const company='REX AUTO CARGOLOOP L.L.C';
const pages=['index.html','car.html','ulubione.html','kontakt.html','o-nas.html','jak-to-dziala.html','prywatnosc.html','warunki.html'];

test('public operator identity and footer review links are consistent across the real pages',()=>{
  for(const file of pages){const dom=new JSDOM(read('public/'+file)),doc=dom.window.document;
    assert.ok(doc.querySelector('footer .rex-operator').textContent.includes(company),file);
    for(const href of ['/o-nas.html','/kontakt.html','/warunki.html','/prywatnosc.html'])assert.ok(doc.querySelector('footer a[href="'+href+'"]'),file+': '+href);
    for(const a of doc.querySelectorAll('footer a[href^="/"]')){const target=new URL(a.getAttribute('href'),'https://rexbid.pl').pathname;if(target.endsWith('.html'))assert.ok(fs.existsSync(path.join(ROOT,'public',target)),target);}
    dom.window.close();
  }
});

test('company content retains confirmed contact and uses the newly confirmed address without inferring registry or tax data',()=>{
  for(const file of ['kontakt.html','o-nas.html','prywatnosc.html','warunki.html']){const dom=new JSDOM(read('public/'+file));
    assert.ok(dom.window.document.querySelector('main').textContent.includes(company));
    assert.match(dom.window.document.querySelector('main').textContent,/1209 Mountain Road Pl NE, Ste N/);
    assert.match(dom.window.document.querySelector('main').textContent,/Albuquerque, NM 87110, United States/);
    assert.ok(dom.window.document.querySelector('a[href="mailto:kontakt@rexbid.pl"]'));
    assert.doesNotMatch(dom.window.document.body.textContent,/\+1 \(574\)|rexautocargoloop@gmail|\bEIN\s*[:#]\s*\d|Entity ID\s*[:#]\s*\d/);
    dom.window.close();
  }
  assert.match(read('public/kontakt.html'),/Wysłanie zapytania nie zleca licytacji/);
});

test('legal review pages remain explicit drafts and describe the actual first publication scope',()=>{
  for(const file of ['prywatnosc.html','warunki.html']){const dom=new JSDOM(read('public/'+file)),doc=dom.window.document;
    assert.equal(doc.querySelector('h1').textContent,file.startsWith('prywat')?'Prywatność':'Warunki korzystania');
    assert.match(doc.querySelector('.rex-document-status').textContent,/DRAFT — REQUIRES OWNER\/LEGAL REVIEW/);
    assert.ok(doc.querySelector('meta[name="robots"]').content.includes('noindex'));
    const srcs=[...doc.querySelectorAll('script[src]')].map(n=>n.getAttribute('src'));
    assert.ok(srcs.findIndex(src=>src.includes('rexbid-storage.js'))>=0);
    assert.ok(srcs.findIndex(src=>src.includes('rexbid-storage.js'))<srcs.findIndex(src=>src.includes('rexbid-mobile-nav.js')),file+': real local favorites count before navigation bootstrap');
    assert.match(doc.querySelector('main').textContent,/konto|konta/);
    assert.match(doc.querySelector('main').textContent,/lokalnie|lokaln/);
    assert.match(doc.querySelector('main').textContent,/wymagaj/);
    dom.window.close();
  }
  assert.match(read('public/warunki.html'),/Znany subtotal.*nie pełną ceną pod dom/);
  for(const file of fs.readdirSync(path.join(ROOT,'docs/legal')).filter(f=>f.endsWith('.md'))){const source=read('docs/legal/'+file);assert.ok(source.includes(company));assert.match(source,/DRAFT — REQUIRES OWNER\/LEGAL REVIEW/);assert.match(source,/faza portal-no-files dodaje profil, przypisane realizacje, rozmowy i osobisty eksport/);assert.match(source,/odświeżane w kontrolowanym harmonogramie/);assert.match(source,/otwarcie strony nie uruchamia pobierania z providera/);}
});

test('staging still exposes its functioning Konto menu including on the new legal pages',()=>{
  // jsdom outside-only parses noscript as active markup unlike a JS browser.
  for(const file of pages){const dom=new JSDOM(read('public/'+file).replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/g,''),{url:'https://rexbid-auth-test.tedn828.workers.dev/'+file,runScripts:'outside-only'});
    dom.window.eval(read('public/rexbid-mobile-nav.js'));
    assert.ok(dom.window.document.querySelector('header a[href="/konto"]'),file);
    const nav=dom.window.document.querySelector('header nav'),button=dom.window.document.querySelector('.rex-menu-toggle');button.click();assert.equal(button.getAttribute('aria-expanded'),'true');assert.ok(nav.classList.contains('is-open'));
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(dom.window.document.activeElement,button);
    dom.window.close();
  }
});

test('partial catalog notice is understandable Polish and remains bound to staging HTML',async()=>{
  const source=read('worker.staging.js'),fn=source.match(/async function addPartialCatalogBadge[\s\S]*?(?=export default)/)[0];
  const ctx={URL,Response,Headers};vm.createContext(ctx);vm.runInContext('const REQUIRED_TEST_HOST="rexbid-auth-test.tedn828.workers.dev";'+fn+';globalThis.badge=addPartialCatalogBadge;',ctx);
  const original=()=>new Response('<html><body><main>Vehicle page</main></body></html>',{headers:{'Content-Type':'text/html','Cache-Control':'private, no-store','Content-Length':'1'}});
  const req=url=>new Request(url);
  const response=await ctx.badge(original(),req('https://rexbid-auth-test.tedn828.workers.dev/car'),{REXBID_D1_PRIMARY_READS:'true'});
  const dom=new JSDOM(await response.text()),notice=dom.window.document.querySelector('aside[role="status"]');
  assert.equal(notice.textContent,'Katalog częściowy');assert.match(notice.title,/nie obejmuje całego rynku/);assert.match(notice.title,/datę obserwacji/);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Content-Length'),null);dom.window.close();
  for(const [url,flag] of [['https://rexbid.pl/','true'],['https://mtbid.tedn828.workers.dev/','true'],['https://rexbid-auth-test.tedn828.workers.dev/','false']]){const input=original();assert.equal(await ctx.badge(input,req(url),{REXBID_D1_PRIMARY_READS:flag}),input);}
  assert.ok(!source.includes('D1 catalog: partial'));
});

test('changed shared CSS and navigation use matching versioned asset references',()=>{
  for (const asset of ['rexbid-brand.css','rexbid-mobile-nav.js']) {
    const canonical = read('public/'+asset).replace(/\r\n/g,'\n');
    const hash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0,10);
    const expected = asset==='rexbid-brand.css' && hash==='5601184417' ? '20261117-integrated' : hash;
    for(const file of fs.readdirSync(path.join(ROOT,'public')).filter(f=>f.endsWith('.html'))) {
      const doc = new JSDOM(read('public/'+file)).window.document;
      for (const node of doc.querySelectorAll('link[href],script[src]')) {
        const url=new URL(node.getAttribute('href') || node.getAttribute('src'),'https://rexbid.pl');
        if(url.pathname==='/'+asset)assert.equal(url.searchParams.get('v'),expected,file+': '+asset);
      }
      doc.defaultView.close();
    }
  }
});

// Workers Assets redirects .html to its extensionless alias before rendering.
test('staging informational aliases retain the Worker noindex and security wrapper after asset redirects',()=>{
  const config=JSON.parse(read('wrangler.staging.jsonc'));
  for(const alias of ['/kontakt','/o-nas','/jak-to-dziala','/pomoc','/prywatnosc','/warunki']){
    assert.ok(config.assets.run_worker_first.includes(alias),alias+': extensionless asset must still traverse staging wrapper');
    assert.ok(fs.existsSync(path.join(ROOT,'public',alias+'.html')));
  }
  const source=read('worker.staging.js'),fn=source.match(/function stagingResponse[\s\S]*?(?=async function addPartialCatalogBadge)/)[0];
  const ctx={URL,Response,Headers};vm.createContext(ctx);vm.runInContext(fn+';globalThis.wrap=stagingResponse;',ctx);
  for(const alias of ['/kontakt','/o-nas','/jak-to-dziala','/pomoc','/prywatnosc','/warunki']){
    const r=ctx.wrap(new Response('<html>Info</html>',{headers:{'Content-Type':'text/html'}}),new Request('https://rexbid-auth-test.tedn828.workers.dev'+alias));
    assert.match(r.headers.get('X-Robots-Tag'),/noindex/);assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(r.headers.get('Cache-Control'),'private, no-store');
  }
});

 test('complete first-scope privacy identifies the controller, real email flow, rights and manual retention without staging internals',()=>{
  const dom=new JSDOM(read('public/prywatnosc.html')),main=dom.window.document.querySelector('main').textContent;
  for(const term of ['Administratorem danych','REX AUTO CARGOLOOP L.L.C','OVH','Gmail','12 miesięcy','kwartalnego','30 dni','localStorage','art. 6','sprzeciw','Prezes Urzędu','samodzielnym wysłaniu'])assert.ok(main.includes(term),term);
  assert.match(main,/nie wdrożono ich automatycznego usuwania/);
  assert.match(main,/Konsumencka skrzynka Gmail nie jest.*umową powierzenia/);
  assert.doesNotMatch(main,/staging|D1|DPAPI|Cron|Cloudflare NS|UUID|NM Entity ID/i);
  assert.ok(dom.window.document.querySelector('a[href="https://uodo.gov.pl/"]'));
  dom.window.close();
});

test('review documents explain source auction events separately from saved observations and conditional bids',()=>{
  const dom=new JSDOM(read('public/warunki.html')),main=dom.window.document.querySelector('main').textContent;
  for(const term of ['Historia aukcji zawiera wydarzenia przekazane przez źródło','Oferta warunkowa nie potwierdza','Oddzielna historia obserwacji','Niepobrana, częściowa lub błędnie odczytana historia'])assert.ok(main.includes(term),term);
  assert.match(main,/nie jest potwierdzoną ceną transakcji/);
  assert.match(main,/Brak ceny nie oznacza zera/);
  dom.window.close();
});

test('privacy matches the actual required inquiry fields and direct submission',()=>{
  const contact=new JSDOM(read('public/kontakt.html')),privacy=new JSDOM(read('public/prywatnosc.html'));
  for(const field of ['name','email','message'])assert.equal(contact.window.document.querySelector('[name="'+field+'"]').required,true,field);
  assert.equal(contact.window.document.querySelector('[name="budget"]').required,false);
  const main=privacy.window.document.querySelector('main').textContent;
  assert.match(main,/formularz wymaga imienia, adresu e-mail do odpowiedzi i wiadomości\. Budżet pozostaje opcjonalny/);
  assert.match(main,/Wybrane filtry i kontekst powrotu mogą znajdować się w adresie strony/);
  assert.match(main,/Numer zgłoszenia potwierdza przyjęcie zapytania/);
  contact.window.close();privacy.window.close();
});

test('HTML and retained Markdown review copies describe the same updated first-scope date and history',()=>{
  for(const pair of [['public/prywatnosc.html','docs/legal/PRIVACY_POLICY_DRAFT.md'],['public/warunki.html','docs/legal/TERMS_OF_SERVICE_DRAFT.md']]){
    for(const file of pair){const s=read(file);assert.ok(s.includes('15 października 2026'),file);assert.match(s,/histori[ęa] aukcji|obserwacj/,file);assert.ok(s.includes('DRAFT — REQUIRES OWNER/LEGAL REVIEW'),file);}
  }
});

test('portal privacy distinguishes stored conversations from public form submissions and preserves manual retention',()=>{
  for(const file of ['public/prywatnosc.html','docs/legal/PRIVACY_POLICY_DRAFT.md']){
    const s=read(file);
    for(const value of ['są zapisywane na serwerze','drugiego składnika logowania','O nowej wiadomości panelu wysyłamy powiadomienie e-mail','możesz pobrać materiały udostępnione Ci w tej realizacji','12 miesięcy od zamknięcia sprawy','ręcznie podczas comiesięcznego przeglądu','Sam status realizacji nie uruchamia automatycznego usuwania','Dane przesyłane przez formularz kontaktowy'])assert.ok(s.includes(value),file+': '+value);
    assert.doesNotMatch(s,/Panel realizacji i prywatne załączniki nie są jeszcze dostępne publicznie/);
  }
});

test('privacy distinguishes active Zimbra mailbox from retained Gmail archive',()=>{
  for(const file of ['public/prywatnosc.html','docs/legal/PRIVACY_POLICY_DRAFT.md']){
    const content=read(file);
    assert.match(content,/jest obsługiwana przez skrzynkę Zimbra w OVHcloud/);
    assert.match(content,/Wcześniejsza korespondencja otrzymana przez przekierowanie pozostaje w skrzynce Gmail projektu/);
    assert.match(content,/Nowe wiadomości nie są automatycznie przekierowywane do Gmaila/);
    assert.doesNotMatch(content,/jest obsługiwana przez usługę przekierowania OVH do skrzynki Gmail projektu/);
    assert.match(content,/nie wdrożono ich automatycznego usuwania/);
  }
});


test('publication mobile menu retains local favorites and guide links after account removal',()=>{
  const source=read('public/index.html');
  assert.doesNotMatch(source,/\.nav a:nth-child\(2\), \.nav a:nth-child\(3\)\s*\{\s*display:\s*none/);
  const dom=new JSDOM(source,{url:'https://rexbid.pl/?catalog=1',runScripts:'outside-only'});
  dom.window.document.documentElement.dataset.rexbidPublicationPhase='catalog';
  dom.window.eval(read('public/rexbid-mobile-nav.js'));
  const doc=dom.window.document,nav=doc.querySelector('header nav');
  assert.deepEqual(Array.from(nav.querySelectorAll('a'),a=>a.getAttribute('href')),['/?catalog=1#results','/jak-to-dziala','/ulubione','/pomoc','/kontakt']);
  doc.querySelector('.rex-menu-toggle').click();
  assert.equal(nav.classList.contains('is-open'),true);
  assert.equal(doc.querySelector('.rex-menu-toggle').getAttribute('aria-expanded'),'true');
  dom.window.close();
});
