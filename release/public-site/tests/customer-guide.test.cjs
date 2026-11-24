'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..', 'public');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pages = ['jak-to-dziala.html', 'o-nas.html', 'pomoc.html'];
const script = read('rexbid-customer-guide.js');
function help() {
  const dom = new JSDOM(read('pomoc.html'), { url: 'https://rexbid.pl/pomoc', runScripts: 'outside-only' });
  dom.window.fetch = () => { throw Error('Help must not call a service'); };
  for (const method of ['setItem', 'removeItem', 'clear']) dom.window.Storage.prototype[method] = () => { throw Error('Help must not change storage'); };
  dom.window.eval(script);
  return dom;
}
const visible = doc => [...doc.querySelectorAll('[data-help-answer]')].filter(item => !item.hidden);
const query = (dom, value) => { const input = dom.window.document.querySelector('[data-help-query]'); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };

test('customer pages retain operator, shared navigation and one descriptive H1', () => {
  for (const page of pages) {
    const dom = new JSDOM(read(page)), doc = dom.window.document;
    assert.equal(doc.documentElement.lang, 'pl'); assert.equal(doc.querySelectorAll('h1').length, 1);
    assert.ok(doc.querySelector('main#main')); assert.ok(doc.querySelector('a.skip-link[href="#main"]'));
    assert.equal(doc.querySelector('.customer-nav [aria-current="page"]').getAttribute('href'), '/' + page);
    assert.match(doc.querySelector('footer').textContent, /REX AUTO CARGOLOOP L.L.C/);
    assert.match(doc.querySelector('footer').textContent, /1209 Mountain Road Pl NE, Ste N/);
    for (const asset of ['rexbid-brand.css', 'rexbid-mobile-nav.js', 'rexbid-storage.js']) assert.ok(read(page).includes(asset));
    dom.window.close();
  }
});

test('customer pages use only real local routes and valid anchors', () => {
  for (const page of pages) {
    const dom = new JSDOM(read(page), { url: 'https://rexbid.pl/' + page }), doc = dom.window.document;
    const ids = [...doc.querySelectorAll('[id]')].map(node => node.id);
    assert.equal(new Set(ids).size, ids.length, page + ': unique IDs');
    for (const link of doc.querySelectorAll('a[href]')) {
      const url = new URL(link.href);
      if (url.protocol === 'mailto:') { assert.equal(url.pathname, 'kontakt@rexbid.pl'); continue; }
      assert.equal(url.hostname, 'rexbid.pl');
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1).replace(/(?<!\.html)$/, '.html');
      assert.ok(fs.existsSync(path.join(root, file)), page + ': ' + file);
      if (url.hash && file !== 'index.html') {
        const target = new JSDOM(read(file));
        assert.ok(target.window.document.getElementById(decodeURIComponent(url.hash.slice(1))), page + ': ' + url.hash);
        target.window.close();
      }
    }
    dom.window.close();
  }
});

test('new assets have matching content hashes and do not load external providers', () => {
  for (const page of pages) {
    const dom = new JSDOM(read(page));
    for (const node of dom.window.document.querySelectorAll('script[src],link[rel="stylesheet"]')) {
      const url = new URL(node.getAttribute('src') || node.getAttribute('href'), 'https://rexbid.pl');
      assert.equal(url.hostname, 'rexbid.pl');
      if (!url.pathname.includes('rexbid-customer-guide')) continue;
      const hash = crypto.createHash('sha256').update(read(url.pathname.slice(1)).replace(/\r\n/g,'\n')).digest('hex').slice(0, 10);
      assert.equal(url.searchParams.get('v'), hash, page + ': ' + url.pathname);
    }
    assert.equal(dom.window.document.querySelectorAll('iframe,form[action]').length, 0);
    dom.window.close();
  }
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\s*[.(]/);
});

test('FAQ remains complete and usable before JavaScript enhancement', () => {
  const dom = new JSDOM(read('pomoc.html')), doc = dom.window.document;
  assert.equal(doc.querySelectorAll('[data-help-answer]').length, 28);
  assert.equal(doc.querySelectorAll('[data-help-group]').length, 5);
  assert.equal(doc.querySelector('[data-help-tools]').hidden, true);
  for (const answer of doc.querySelectorAll('[data-help-answer]')) {
    assert.equal(answer.tagName, 'DETAILS'); assert.equal(answer.hidden, false);
    assert.ok(answer.querySelector('summary')); assert.ok(answer.querySelector('p').textContent.length > 60);
  }
  dom.window.close();
});

test('FAQ starts with every answer and announces a factual count', () => {
  const dom = help(), doc = dom.window.document;
  assert.equal(visible(doc).length, 28); assert.equal(doc.querySelector('[data-help-tools]').hidden, false);
  assert.equal(doc.querySelector('[data-help-count]').textContent, 'Wyświetlane odpowiedzi: 28 z 28.');
  assert.equal(doc.querySelector('[data-help-count]').getAttribute('aria-live'), 'polite');
  assert.equal(doc.querySelector('[data-help-empty]').hidden, true);
  dom.window.close();
});

test('FAQ search matches Polish words without diacritics, case or word order', () => {
  const dom = help(), doc = dom.window.document;
  query(dom, 'OPLATA  zero');
  assert.equal(visible(doc).length, 1); assert.match(visible(doc)[0].textContent, /brakująca opłata/i);
  query(dom, 'wartoscia 0 USD');
  assert.equal(visible(doc).length, 1); assert.match(visible(doc)[0].textContent, /Potwierdzone 0 USD/);
  query(dom, '  '); assert.equal(visible(doc).length, 28);
  dom.window.close();
});

test('FAQ categories and query intersect without removing content', () => {
  const dom = help(), doc = dom.window.document;
  doc.querySelector('[data-help-category="konto"]').click();
  assert.equal(visible(doc).length, 5);
  assert.deepEqual([...doc.querySelectorAll('[data-help-group]')].filter(n => !n.hidden).map(n => n.dataset.helpGroup), ['konto']);
  query(dom, 'hasla'); assert.equal(visible(doc).length, 1);
  assert.equal(doc.querySelector('[data-help-category="konto"]').getAttribute('aria-pressed'), 'true');
  assert.equal(doc.querySelectorAll('[data-help-answer]').length, 28);
  dom.window.close();
});

test('FAQ empty result and keyboard-accessible reset restore all questions', () => {
  const dom = help(), doc = dom.window.document;
  doc.querySelector('[data-help-category="koszty"]').click(); query(dom, 'no-such-answer-27186');
  assert.equal(visible(doc).length, 0); assert.equal(doc.querySelector('[data-help-empty]').hidden, false);
  assert.match(doc.querySelector('[data-help-count]').textContent, /0 z 28/);
  doc.querySelector('[data-help-reset]').click();
  assert.equal(visible(doc).length, 28); assert.equal(doc.activeElement, doc.querySelector('[data-help-query]'));
  assert.equal(doc.querySelector('[data-help-category="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal(doc.querySelector('[data-help-empty]').hidden, true);
  dom.window.close();
});

test('FAQ treats markup-like input as text and does not inject HTML', () => {
  const dom = help(), doc = dom.window.document;
  const originalImages = [...doc.images];
  query(dom, '<img src=x onerror=alert(1)>');
  assert.equal(visible(doc).length, 0); assert.deepEqual([...doc.images], originalImages);
  assert.equal(doc.querySelectorAll('script:not([src])').length, 0);
  dom.window.close();
});

test('guide separates planned steps from guarantees and keeps costs incomplete', () => {
  const dom = new JSDOM(read('jak-to-dziala.html')), doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.customer-timeline details').length, 7);
  assert.equal(doc.querySelectorAll('.customer-timeline details[open]').length, 1);
  for (const term of ['Co przygotować do wyceny?', 'Co ustalamy przed zleceniem?', 'sumą częściową', 'Brakująca kwota nie oznacza zera', 'terminy potwierdzamy dla konkretnego zlecenia']) assert.ok(doc.querySelector('main').textContent.includes(term), term);
  assert.doesNotMatch(doc.querySelector('main').textContent, /\d+\s*[–-]\s*\d+\s*(dni|tygodni)|gwarantujemy/i);
  dom.window.close();
});

test('help truthfully describes source age, bidding, direct inquiries and current portal scope', () => {
  const dom = new JSDOM(read('pomoc.html')), text = dom.window.document.querySelector('main').textContent;
  for (const term of ['nie oznacza nowego odczytu aukcji', 'nie składają oferty', 'Wyślij zapytanie', 'Zobaczysz numer zgłoszenia', 'Zdjęcia i dokumenty do panelu dodaje administrator', 'powiadomienie na potwierdzony adres konta', 'końcowy wynik niepotwierdzony', 'nie obejmuje pełnego kosztu importu']) assert.ok(text.includes(term), term);
  assert.doesNotMatch(text, /D1|staging|Apibara|Workers|Cron/);
  dom.window.close();
});

test('about page uses confirmed identity without invented proof, phones or team', () => {
  const dom = new JSDOM(read('o-nas.html')), text = dom.window.document.querySelector('main').textContent;
  for (const term of ['REX AUTO CARGOLOOP L.L.C', '1209 Mountain Road Pl NE, Ste N', 'Albuquerque, NM 87110, United States', 'kontakt@rexbid.pl']) assert.ok(text.includes(term));
  assert.doesNotMatch(text, /BidCars|DreamBid|opinie klientów|\d+%|\bEIN\b|Entity ID|\+48|\+1/);
  assert.equal(dom.window.document.querySelectorAll('main img').length, 0);
  dom.window.close();
});

test('help enhancement safely ignores pages without its mount', () => {
  for (const page of ['jak-to-dziala.html', 'o-nas.html']) {
    const dom = new JSDOM(read(page), { runScripts: 'outside-only' });
    const before = dom.window.document.body.innerHTML;
    dom.window.eval(script); assert.equal(dom.window.document.body.innerHTML, before);
    dom.window.close();
  }
});
