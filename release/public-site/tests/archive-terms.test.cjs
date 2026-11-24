const assert = require('node:assert/strict');
const fs = require('node:fs');
const {test} = require('node:test');
const {JSDOM} = require('jsdom');
function load(name) {
  return new JSDOM(fs.readFileSync(require('node:path').join(__dirname, '..', 'public', name),'utf8')).window.document;
}
test('archive terms link is present and the Polish page has core terms and accessible contact', () => {
  const page = load('regulamin-archiwum.html');
  const index = load('index.html');
  assert.equal(page.documentElement.lang,'pl');
  assert.equal(page.querySelectorAll('h1').length,1);
  assert.equal(page.querySelector('main h1').textContent,'Regulamin archiwum aukcji');
  const archive=load("archiwum.html");
  assert.ok(index.querySelector('footer a[href="/archiwum"]'));
  assert.equal(index.querySelector('footer a[href="/regulamin-archiwum"]'),null);
  assert.ok(archive.querySelector('footer a[href="/regulamin-archiwum"]'));
  assert.equal(archive.querySelector("#archive-results").children.length,0);
  assert.ok(page.querySelector('a[href^="mailto:kontakt@rexbid.pl"]'));
  assert.ok(page.querySelector('a[href="/prywatnosc"]'));
  assert.match(page.getElementById('scope').parentElement.textContent,/2018/);
  assert.match(page.getElementById('reports').parentElement.textContent,/bezpłatnie/);
  assert.equal(page.querySelectorAll('script').length,0);
});
