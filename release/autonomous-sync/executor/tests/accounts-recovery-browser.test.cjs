const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname,'../public/reset-hasla.html'),'utf8');
const source = fs.readFileSync(path.join(__dirname,'../public/rexbid-auth.js'),'utf8');
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
async function page({ recovery=false, enabled=true, statusFail=false, authenticated=false, favoritesFail=false, changeStatus=200, query='' }={}) {
  const dom = new JSDOM(html,{url:'https://rexbid-auth-test.tedn828.workers.dev/reset-hasla'+query,runScripts:'outside-only'});
  const calls=[];
  dom.window.fetch=async(url,options={})=>{
    calls.push({url,options});
    if(url==='/api/auth/config')return json({ok:true,enabled});
    if(url==='/api/me')return authenticated ? json({ok:true,user:{id:'test-client'}}) : json({ok:false},401);
    if(url==='/api/me/favorites')return favoritesFail ? json({ok:false},503) : json({ok:true,favorites:[]});
    if(url==='/api/auth/recovery-session')return statusFail ? json({ok:false},503) : json({ok:true,recovery_ready:recovery});
    if(url==='/api/auth/password')return json(changeStatus===200 ? {ok:true,other_sessions_revoked:true} : {ok:false,code:'RECOVERY_LINK_REJECTED'},changeStatus);
    if(url==='/api/auth/recovery')return json({ok:true},202);
    throw new Error('unexpected browser request: '+url);
  };
  dom.window.eval(source);
  await dom.window.RexBidAuth.ready;
  // Mount is async after ready; wait for DOM to settle without artificial sleeps.
  for(let i=0;i<20 && dom.window.document.querySelector('form')?.hidden;i++)await new Promise(resolve=>setImmediate(resolve));
  return {dom,calls,doc:dom.window.document};
}
async function submit(p) {
  p.doc.querySelector('form').dispatchEvent(new p.dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
}
test('actual recovery HTML bootstrap renders new-password form for server grant even without a logged-in session or query hint',async()=>{
  const p=await page({recovery:true});
  try {
    assert.equal(p.doc.querySelector('#recoveryLoading'),null);
    assert.equal(p.doc.querySelector('h1').textContent,'Ustaw nowe hasło');
    const input=p.doc.querySelector('[aria-label="Nowe hasło"]'),repeat=p.doc.querySelector('[aria-label="Powtórz nowe hasło"]');
    assert.equal(input.parentElement.hidden,false);assert.equal(p.doc.querySelector('[aria-label="Adres e-mail"]').parentElement.hidden,true);
    input.value='new-safe-password';repeat.value='different-password';await submit(p);assert.equal(p.calls.filter(c=>c.url==='/api/auth/password').length,0);assert.match(p.doc.querySelector('[role=status]').textContent,/nie są takie same/);
    repeat.value=input.value;await submit(p);
    const posted=p.calls.filter(c=>c.url==='/api/auth/password');assert.equal(posted.length,1);assert.deepEqual(JSON.parse(posted[0].options.body),{password:'new-safe-password'});assert.equal(posted[0].options.credentials,'same-origin');assert.equal(posted[0].options.cache,'no-store');
    assert.equal(p.doc.querySelector('form').hidden,true);assert.equal(input.value,'');assert.match(p.doc.querySelector('[role=status]').textContent,/Hasło zmienione/);
    assert.equal(p.doc.querySelector('.account-recovery>a').hidden,false,'success must keep the login link visible');
  } finally {p.dom.window.close();}
});

test('normal account screen navigation remains visible after auth bootstrap',async()=>{
  for(const [file,url,target] of [['logowanie.html','/logowanie','.register a'],['rejestracja.html','/rejestracja','.login a']]){
    const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),{url:'https://rexbid-auth-test.tedn828.workers.dev'+url,runScripts:'outside-only'});
    dom.window.fetch=async uri=>uri==='/api/auth/config' ? json({ok:true,enabled:true}) : json({ok:false},401);
    try {dom.window.eval(source);await dom.window.RexBidAuth.ready;assert.equal(dom.window.document.querySelector(target).hidden,false);assert.equal(dom.window.document.querySelector('button[type=submit]').disabled,false);}finally{dom.window.close();}
  }
});

test('account form styling preserves the mobile header menu width and interactive navigation',()=>{
  for(const file of ['logowanie.html','rejestracja.html','reset-hasla.html']) {
    const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),{url:'https://rexbid-auth-test.tedn828.workers.dev/'+file,runScripts:'outside-only'});
    try {
      for(const css of ['rexbid-brand.css','rexbid-account.css']) {const style=dom.window.document.createElement('style');style.textContent=fs.readFileSync(path.join(__dirname,'../public',css),'utf8');dom.window.document.head.append(style);}
      dom.window.eval(fs.readFileSync(path.join(__dirname,'../public/rexbid-mobile-nav.js'),'utf8'));
      const menu=dom.window.document.querySelector('.rex-menu-toggle');
      assert.equal(dom.window.getComputedStyle(menu).width,'44px','form button width must not override the header menu');
      assert.equal(dom.window.getComputedStyle(menu).height,'44px');
      menu.click();assert.equal(menu.getAttribute('aria-expanded'),'true');
      menu.click();assert.equal(menu.getAttribute('aria-expanded'),'false');
    } finally {dom.window.close();}
  }
});
test('ordinary login plus forged recovery query cannot enable password form; email submit stays enumeration-neutral',async()=>{
  const p=await page({authenticated:true,query:'?recovery=ready'});
  try {
    assert.equal(p.doc.querySelector('[aria-label="Nowe hasło"]').parentElement.hidden,true);
    p.doc.querySelector('[aria-label="Adres e-mail"]').value='test-client@example.test';await submit(p);
    assert.equal(p.calls.filter(c=>c.url==='/api/auth/recovery').length,1);assert.equal(p.calls.filter(c=>c.url==='/api/auth/password').length,0);
    assert.match(p.doc.querySelector('[role=status]').textContent,/Jeśli adres jest powiązany/);
  } finally {p.dom.window.close();}
});
test('used link rejection clears password fields and switches to new recovery request without infinite loading',async()=>{
  const p=await page({recovery:true,changeStatus:401});
  try {
    p.doc.querySelector('[aria-label="Nowe hasło"]').value='new-safe-password';p.doc.querySelector('[aria-label="Powtórz nowe hasło"]').value='new-safe-password';await submit(p);
    assert.match(p.doc.querySelector('[role=status]').textContent,/wykorzystany lub stracił ważność/);assert.equal(p.doc.querySelector('[aria-label="Nowe hasło"]').value,'');assert.equal(p.doc.querySelector('[aria-label="Adres e-mail"]').parentElement.hidden,false);
  } finally {p.dom.window.close();}
});
test('disabled auth and unavailable recovery status show a bounded explicit error rather than empty page or editable password form',async()=>{
  for(const options of [{enabled:false},{statusFail:true}]) {
    const p=await page(options);
    try {assert.equal(p.doc.querySelector('#recoveryLoading'),null);assert.equal(p.doc.querySelector('form').hidden,true);assert.match(p.doc.querySelector('[role=status]').textContent,/niedostępne|Nie udało/);}finally{p.dom.window.close();}
  }
});
test('secondary favorites outage does not discard a valid identity or prevent the recovery form from rendering',async()=>{
  const p=await page({authenticated:true,favoritesFail:true,recovery:true});
  try {assert.equal(p.dom.window.RexBidAuth.status,'authenticated');assert.equal(p.doc.querySelector('h1').textContent,'Ustaw nowe hasło');assert.equal(p.doc.querySelector('form').hidden,false);}finally{p.dom.window.close();}
});

async function validationPage(t,kind='login') {
  const file=kind==='signup'?'rejestracja.html':'logowanie.html';
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),{url:'https://rexbid-auth-test.tedn828.workers.dev/'+file,runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const calls=[];
  dom.window.fetch=async(url,options={})=>{
    calls.push({url,options});
    if(url==='/api/auth/config')return json({ok:true,enabled:true});
    if(url==='/api/me')return json({ok:false},401);
    if(url==='/api/auth/signup')return json({ok:true,confirmation_required:true},202);
    if(url==='/api/auth/login')return json({ok:false},401);
    throw new Error('unexpected synthetic route: '+url);
  };
  dom.window.eval(source);
  await dom.window.RexBidAuth.ready;
  await new Promise(resolve=>setImmediate(resolve));
  const doc=dom.window.document;
  return {dom,doc,calls,node:id=>doc.getElementById(id),async submit(){const button=doc.querySelector('button[type=submit]');button.focus();button.click();await new Promise(resolve=>setImmediate(resolve));}};
}

test('actual login/signup empty email focuses and describes the invalid field, then clears only the validation association after editing',async t=>{
  for(const kind of ['login','signup']){
    const p=await validationPage(t,kind),email=p.node('email');
    const hint=p.doc.createElement('p');hint.id='emailHint';hint.textContent='Użyj adresu swojego konta.';email.after(hint);
    email.setAttribute('aria-describedby','emailHint');
    await p.submit();
    assert.equal(p.doc.activeElement,email,kind);
    assert.equal(email.getAttribute('aria-invalid'),'true',kind);
    assert.equal(email.getAttribute('aria-describedby'),'emailHint message',kind);
    assert.equal(p.node('message').getAttribute('role'),'status');
    assert.equal(p.node('message').textContent,'Wpisz adres e-mail.');
    assert.equal(p.calls.some(call=>/\/api\/auth\/(?:login|signup)$/.test(call.url)),false,'invalid data makes no credential request');
    email.value='client@example.test';email.dispatchEvent(new p.dom.window.Event('input',{bubbles:true}));
    assert.equal(email.hasAttribute('aria-invalid'),false,kind);
    assert.equal(email.getAttribute('aria-describedby'),'emailHint','existing help text association is retained');
    assert.equal(p.node('message').hidden,true,kind);
  }
});

test('short login/signup password focuses its field; corrected signup succeeds without stale invalid marks, while login server failure stays a general status',async t=>{
  for(const kind of ['login','signup']){
    const p=await validationPage(t,kind);
    p.node('email').value='client@example.test';
    if(kind==='signup'){assert.equal(p.node('name'),null);p.node('terms').checked=true;p.node('passwordConfirm').value='too';}
    p.node('password').value='too';
    await p.submit();
    assert.equal(p.doc.activeElement,p.node('password'),kind);
    assert.equal(p.node('password').getAttribute('aria-invalid'),'true',kind);
    assert.equal(p.node('password').getAttribute('aria-describedby'),'message',kind);
    assert.equal(p.node('email').hasAttribute('aria-invalid'),false,kind);
    assert.match(p.node('message').textContent,/co najmniej 8 znaków/);
    p.node('password').value='corrected-fixture-password';p.node('password').dispatchEvent(new p.dom.window.Event('input',{bubbles:true}));
    if(kind==='signup')p.node('passwordConfirm').value='corrected-fixture-password';
    assert.equal(p.node('password').hasAttribute('aria-invalid'),false,kind);
    assert.equal(p.node('password').hasAttribute('aria-describedby'),false,kind);
    await p.submit();
    assert.equal(p.calls.filter(call=>call.url==='/api/auth/'+kind).length,1,kind);
    assert.equal(p.doc.querySelector('[aria-invalid=true]'),null,kind);
    assert.equal(p.node('password').value,'',kind);
    assert.match(p.node('message').textContent,kind==='signup'?/wiadomość z potwierdzeniem/:/Nie udało się zalogować/);
  }
});
