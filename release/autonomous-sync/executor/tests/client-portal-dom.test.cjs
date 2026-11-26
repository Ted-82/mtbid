const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const flush = async () => { for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve)); };
const ORDER = '22222222-2222-4222-8222-222222222222';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const FILE = '33333333-3333-4333-8333-333333333333';
const orderFixture = () => ({id:ORDER,title:'2020 Tesla Model 3',vin:'5YJ3E1EA0LF000001',lot:'62674546',platform:'copart',status:'at_sea',location:'Port Savannah',estimated_arrival_at:'2026-10-30T12:00:00.000Z',vessel:'Vessel test',container_number:'TEST1234567',version:7,created_at:'2026-10-02T10:00:00.000Z',updated_at:'2026-10-06T10:15:00.000Z'});
const recordId = value => '00000000-0000-4000-8000-'+String(value).padStart(12,'0');
const historyFixture = () => ({order:orderFixture(),
  events:Array.from({length:100},(_,index)=>({id:recordId(100-index),status:'at_sea',message:'Aktualizacja '+(100-index),created_at:new Date(Date.UTC(2026,9,6,12)-index*1000).toISOString()})),
  messages:Array.from({length:50},(_,index)=>({id:recordId(150-index),author:'owner',text:'Wiadomość '+(50-index),created_at:new Date(Date.UTC(2026,9,6,12)-index*1000).toISOString()})),
  files:Array.from({length:50},(_,index)=>({id:recordId(250-index),filename:'material-'+(50-index)+'.pdf',content_type:'application/pdf',size_bytes:2048,created_at:new Date(Date.UTC(2026,9,6,12)-index*1000).toISOString()})),
  pagination:{events:{limit:100,offset:0,has_more:true},messages:{limit:50,offset:0,has_more:true},files:{limit:50,offset:0,has_more:true}}
});
// These tests exercise real DOM/script behavior. They do not claim browser rendering or hosting QA.
async function page(t,{owner=false,role=owner?'owner':'client',enabled=true,uploads=false,override,detail,orders,beforeReady}={}) {
  const dom = new JSDOM(read(owner?'administracja.html':'panel.html'),{url:'https://rexbid.pl/'+(owner?'administracja.html':'panel.html'),runScripts:'outside-only'});
  t.after(()=>dom.window.close()); const {window:win}=dom,doc=win.document;
  await new Promise(resolve=>doc.addEventListener('DOMContentLoaded',resolve,{once:true}));
  const requests=[]; const record=detail||{order:orderFixture(),events:[{id:'event1',status:'at_sea',message:'Statek wypłynął.',created_at:'2026-10-06T10:15:00.000Z'}],messages:[],files:[]};
  let list=orders||[record.order];
  win.Storage.prototype.getItem = () => { throw new Error('Private portal must not use web storage'); };
  win.Storage.prototype.setItem = () => { throw new Error('Private portal must not use web storage'); };
  win.fetch=async(url,options={})=>{
    requests.push({url,options}); let result;
    if(override) result=await override(url,options,{record,list,requests});
    if(result===undefined){
      if(url==='/api/portal/config') result={ok:true,enabled,uploads_enabled:uploads};
      else if(url==='/api/portal/me') result={ok:true,user:{id:CLIENT},role};
      else if(url==='/api/portal/clients') result={ok:true,role,clients:[{id:CLIENT,profile:{name:'Klient testowy',email:'client@example.net'},created_at:'2026-10-01T12:00:00Z'}]};
      else if(url==='/api/portal/profile') result={ok:true,profile:{name:'Klient testowy',email:'client@example.net',phone:null}};
      else if(url.startsWith('/api/portal/orders?')) result={ok:true,role,orders:list,pagination:{has_more:false,limit:20,offset:0}};
      else if(url==='/api/portal/orders'&&options.method==='POST') result={ok:true,order:record.order};
      else if(url==='/api/portal/orders/'+ORDER&&options.method==='PATCH') result={ok:true,order:record.order};
      else if(url==='/api/portal/orders/'+ORDER) result={ok:true,role,...record};
      else if(url==='/api/portal/orders/'+ORDER+'/messages'){record.messages.push({id:'msg1',author:role,text:JSON.parse(options.body).text,created_at:'2026-10-06T12:00:00.000Z'});result={ok:true,message:record.messages.at(-1)};}
      else if(url.includes('/reply-draft?')) result={ok:true,draft:{subject:'REXBID — aktualizacja',body:'Dzień dobry,\nPotwierdzony etap: transport morski.',warnings:['Sprawdź aktualność danych.']}};
      else if(url.endsWith('/files')&&options.method==='POST') result={ok:true,file:{id:FILE}};
      else throw new Error('Unexpected request '+url);
    }
    const status=result.status||200;return{ok:status>=200&&status<300,status,json:async()=>result.data||result};
  };
  win.eval(read('rexbid-client-portal.js'));beforeReady?.(win,doc);await win.RexBidClientPortal.ready;
  const form=name=>doc.querySelector('[data-portal-form="'+name+'"]');
  const submit=name=>{const element=form(name);assert.ok(element,'form '+name);return element.dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));};
  const set=(name,field,value)=>{const input=form(name).elements.namedItem(field);input.value=value;input.dispatchEvent(new win.Event('change',{bubbles:true}));return input;};
  return{win,doc,requests,record,form,submit,set};
}

test('empty portal describes stages and messages without promising file uploads',async t=>{
  const p=await page(t,{orders:[],uploads:false});
  assert.match(p.doc.querySelector('.portal-intro').textContent,/Etapy importu i rozmowa/);
  assert.match(p.doc.getElementById('portalDetail').textContent,/Statusy i rozmowa/);
  assert.doesNotMatch(p.doc.querySelector('.portal-intro').textContent,/zdjęcia|dokumenty/);
  assert.doesNotMatch(p.doc.getElementById('portalDetail').textContent,/dokumenty/);
  assert.equal(p.form('upload'),null);
});

test('disabled portal shows truthful unavailable state and performs no private API requests',async t=>{
  const p=await page(t,{enabled:false});assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);assert.match(p.doc.getElementById('portalGateTitle').textContent,/przygotowywany/);assert.deepEqual(p.requests.map(r=>r.url),['/api/portal/config']);assert.equal(p.doc.querySelector('.portal-order-button'),null);
});
test('signed out portal offers the correct return path and fetches no orders',async t=>{
  const p=await page(t,{override:url=>url==='/api/portal/me'?{status:401,data:{ok:false,error:'unauthorized'}}:undefined});assert.equal(p.doc.getElementById('portalLogin').hidden,false);assert.equal(new URL(p.doc.getElementById('portalLogin').href).searchParams.get('return_to'),'/panel.html');assert.equal(p.requests.length,2);assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);
});
test('ordinary client cannot activate owner controls through HTML or role in order response',async t=>{
  const p=await page(t,{owner:true,role:'client'});assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);assert.equal(p.form('create'),null);assert.equal(p.requests.length,2);assert.match(p.doc.getElementById('portalGateText').textContent,/właściciela/);
});
test('owner MFA requirement keeps all private data and mutation controls hidden',async t=>{
  const p=await page(t,{owner:true,override:url=>url==='/api/portal/me'?{status:403,data:{ok:false,error:'owner_mfa_required'}}:undefined});assert.equal(p.form('update'),null);assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);assert.match(p.doc.getElementById('portalGateText').textContent,/wieloskładnikowego/);assert.equal(p.requests.length,2);assert.ok(p.doc.getElementById('rexbid-owner-mfa'));
});
test('owner visiting the client panel can reach MFA setup without granting a local role',async t=>{
  const p=await page(t,{override:url=>url==='/api/portal/me'?{status:403,data:{ok:false,error:'owner_mfa_required'}}:undefined});assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);assert.equal(p.doc.querySelector('[data-portal-gate-action="mfa"]').getAttribute('href'),'/administracja.html');assert.equal(p.requests.length,2);assert.equal(p.form('create'),null);
});
test('client renders actual vehicle, estimated ETA and only the current stage as confirmed',async t=>{
  const p=await page(t);assert.equal(p.doc.getElementById('portalWorkspace').hidden,false);assert.match(p.doc.querySelector('.portal-vehicle-card').textContent,/Tesla Model 3/);assert.match(p.doc.querySelector('.portal-facts').textContent,/Termin orientacyjny/);assert.match(p.doc.querySelector('.portal-facts').textContent,/30 paź/);assert.equal(p.doc.querySelectorAll('[aria-current="step"]').length,1);assert.equal(p.doc.querySelectorAll('[data-state="done"]').length,0);assert.equal(p.form('update'),null);assert.equal(p.form('upload'),null);assert.equal(p.doc.getElementById('portalOwnerLink').hidden,true);
});
test('unassigned client has an honest empty state without example orders',async t=>{
  const p=await page(t,{orders:[]});assert.equal(p.doc.querySelector('.portal-order-button'),null);assert.match(p.doc.getElementById('portalOrders').textContent,/Brak przypisanych/);assert.equal(p.doc.querySelector('.portal-vehicle-card'),null);
});
test('hostile vehicle, timeline and message strings are literal text and private notes stay hidden',async t=>{
  const record={order:{...orderFixture(),title:'<img src=x onerror="window.pwned=true">'},events:[{id:'internal',visibility:'internal',message:'SECRET INTERNAL',created_at:'2026-10-06T12:00:00Z'},{id:'public',message:'<script>window.pwned=true</script>',created_at:'2026-10-06T12:00:00Z'}],messages:[{id:'m1',author:'owner',text:'<img src=x onerror="window.pwned=true">',created_at:'2026-10-06T12:00:00Z'}],files:[]};const p=await page(t,{detail:record});assert.equal(p.doc.querySelector('#portalDetail img'),null);assert.equal(p.doc.querySelector('#portalDetail script'),null);assert.equal(p.win.pwned,undefined);assert.match(p.doc.querySelector('.portal-vehicle-top h2').textContent,/<img/);assert.doesNotMatch(p.doc.getElementById('portalDetail').textContent,/SECRET INTERNAL/);
});
test('downloads and photos use exact authenticated same-origin paths, reject external paths and internal files',async t=>{
  const good='/api/portal/orders/'+ORDER+'/files/'+FILE;
  const record={order:orderFixture(),events:[],messages:[],files:[{id:FILE,filename:'title.pdf',content_type:'application/pdf',size_bytes:2048,download_url:good},{id:'photo',filename:'vehicle.jpg',content_type:'image/jpeg',size_bytes:512,download_url:'/api/portal/orders/'+ORDER+'/files/photo'},{id:'bad',filename:'bad.pdf',content_type:'application/pdf',download_url:'https://evil.example/data'},{id:'secret',filename:'internal.pdf',visibility:'internal',content_type:'application/pdf'}]};const p=await page(t,{detail:record});const links=[...p.doc.querySelectorAll('.portal-file-info a')];assert.equal(links.length,2);assert.equal(links[0].getAttribute('href'),good);assert.match(p.doc.querySelector('.portal-photo img').getAttribute('src'),/^\/api\/portal\/orders\//);assert.doesNotMatch(p.doc.getElementById('portalDetail').textContent,/internal.pdf|bad.pdf/);assert.equal(p.doc.querySelector('a[href^="https://evil"]'),null);
});

test('both portal views display the same stored client/REXBID senders regardless of viewer or message contents',async t=>{
  const messages=[
    {id:'client-message',author:'client',text:'REXBID: identyczna treść',created_at:'2026-10-06T10:00:00Z'},
    {id:'owner-message',author:'owner',text:'REXBID: identyczna treść',created_at:'2026-10-06T11:00:00Z'},
    {id:'unknown-message',text:'Klient',created_at:'2026-10-06T12:00:00Z'}
  ];
  for(const [owner,role] of [[false,'client'],[false,'owner'],[true,'owner']]) {
    const p=await page(t,{owner,role,detail:{order:orderFixture(),events:[],files:[],messages:messages.map(message=>({...message}))}});
    const bubbles=[...p.doc.querySelectorAll('.portal-message')];
    assert.deepEqual(bubbles.map(item=>item.dataset.author),['client','owner','unknown']);
    assert.deepEqual(bubbles.map(item=>item.querySelector('.portal-message-author').textContent),['Klient','REXBID','Nadawca nieustalony']);
    assert.equal(bubbles[0].getAttribute('aria-label'),'Wiadomość: Klient');
    assert.equal(bubbles[1].getAttribute('aria-label'),'Wiadomość: REXBID');
    assert.match(p.doc.querySelector('.portal-compose-sender').textContent,role==='owner'?/Wysyłasz jako REXBID z konta właściciela/:/Wysyłasz jako Klient/);
    p.set('message','text','Moja odpowiedź');p.submit('message');await flush();
    const sent=p.requests.filter(r=>r.url.endsWith('/messages')&&r.options.method==='POST');
    assert.equal(sent.length,1);assert.deepEqual(JSON.parse(sent[0].options.body),{text:'Moja odpowiedź'});
    assert.deepEqual(messages.map(message=>message.author),['client','owner',undefined]);
  }
});
test('message is sent once to this order and success appears only after server confirmation',async t=>{
  let resolve;const pending=new Promise(done=>resolve=done);const p=await page(t,{override:async(url,options)=>url.endsWith('/messages')?(await pending,{ok:true,message:{id:'confirmed'}}):undefined});p.set('message','text','Pytanie o mój pojazd');p.submit('message');p.submit('message');await flush();const posts=p.requests.filter(r=>r.options.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].url,'/api/portal/orders/'+ORDER+'/messages');assert.deepEqual(JSON.parse(posts[0].options.body),{text:'Pytanie o mój pojazd'});assert.equal(p.form('message').querySelector('button[type="submit"]').disabled,true);assert.doesNotMatch(p.doc.getElementById('portalNotice').textContent,/została zapisana/);resolve();await flush();assert.match(p.doc.getElementById('portalNotice').textContent,/została zapisana/);
});
test('failed message keeps entered text and reports uncertainty without automatic retry or fake success',async t=>{
  const p=await page(t,{override:url=>{if(url.endsWith('/messages'))throw new Error('network');}});p.set('message','text','Ważne pytanie');p.submit('message');await flush();assert.equal(p.form('message').elements.text.value,'Ważne pytanie');assert.match(p.form('message').textContent,/nie jest potwierdzony/);assert.equal(p.requests.filter(r=>r.options.method==='POST').length,1);assert.doesNotMatch(p.doc.getElementById('portalNotice').textContent,/została zapisana/);
});
test('owner creates real import for a registered client and rejects missing vehicle identity',async t=>{
  const p=await page(t,{owner:true});const select=p.form('create').elements.client_user_id;assert.equal(select.tagName,'SELECT');assert.match(select.options[1].textContent,/Klient testowy/);p.set('create','client_user_id',CLIENT);p.set('create','title','BMW 330i');p.submit('create');await flush();assert.equal(p.requests.filter(r=>r.url==='/api/portal/orders'&&r.options.method==='POST').length,0);p.set('create','lot','45439613');p.set('create','platform','iaai');p.submit('create');await flush();const request=p.requests.find(r=>r.url==='/api/portal/orders'&&r.options.method==='POST');assert.deepEqual(JSON.parse(request.options.body),{client_user_id:CLIENT,title:'BMW 330i',lot:'45439613',platform:'iaai'});assert.match(p.doc.getElementById('portalNotice').textContent,/została utworzona/);
});
test('owner can load clients beyond the first page without replacing the chosen account',async t=>{
  const second='44444444-4444-4444-8444-444444444444';
  const p=await page(t,{owner:true,override:url=>url==='/api/portal/clients'?{ok:true,clients:[{id:CLIENT,profile:{name:'Pierwszy klient'}}],pagination:{offset:0,limit:20,has_more:true}}:url==='/api/portal/clients?limit=50&offset=20'?{ok:true,clients:[{id:second,profile:{name:'Kolejny klient'}}],pagination:{offset:20,limit:50,has_more:false}}:undefined});p.set('create','client_user_id',CLIENT);const load=[...p.form('create').querySelectorAll('button')].find(item=>item.textContent==='Wczytaj kolejnych klientów');assert.equal(load.hidden,false);load.click();await flush();assert.equal(p.form('create').elements.client_user_id.value,CLIENT);assert.equal(p.form('create').elements.client_user_id.options.length,3);assert.equal(load.hidden,true);assert.equal(p.requests.filter(r=>r.url==='/api/portal/clients?limit=50&offset=20').length,1);
});
test('owner update sends version and ISO ETA, conflict disables retry until refresh',async t=>{
  const p=await page(t,{owner:true,override:(url,options)=>options.method==='PATCH'?{status:409,data:{ok:false,error:'conflict'}}:undefined});p.set('update','estimated_arrival_at','2026-11-02');p.set('update','location','Gdynia');p.submit('update');await flush();const request=p.requests.find(r=>r.options.method==='PATCH'),body=JSON.parse(request.options.body);assert.equal(body.expected_version,7);assert.equal(body.estimated_arrival_at,'2026-11-02T12:00:00.000Z');assert.equal(body.location,'Gdynia');assert.match(p.form('update').textContent,/zmienione w międzyczasie/);assert.equal(p.form('update').querySelector('button[type="submit"]').disabled,true);p.submit('update');await flush();assert.equal(p.requests.filter(r=>r.options.method==='PATCH').length,1);
});
test('internal owner note cannot change public location, ETA or current stage',async t=>{
  const p=await page(t,{owner:true});p.set('update','event_visibility','internal');p.set('update','event_message','Wewnętrzna informacja do sprawdzenia');assert.equal(p.form('update').elements.status.disabled,true);p.submit('update');await flush();const body=JSON.parse(p.requests.find(r=>r.options.method==='PATCH').options.body);assert.deepEqual(body,{expected_version:7,event_visibility:'internal',event_message:'Wewnętrzna informacja do sprawdzenia'});
});
test('draft response is previewed and can be inserted; it never sends an email or a message automatically',async t=>{
  const p=await page(t,{owner:true});p.submit('draft');await flush();assert.equal(p.doc.querySelector('.portal-draft-output').hidden,false);assert.match(p.doc.querySelector('.portal-draft-output').textContent,/Sprawdź aktualność/);assert.equal(p.requests.filter(r=>r.options.method==='POST').length,0);p.doc.querySelector('.portal-draft-output button').click();assert.match(p.form('message').elements.text.value,/Potwierdzony etap/);assert.equal(p.requests.filter(r=>r.options.method==='POST').length,0);assert.equal(p.doc.querySelector('a[href^="mailto:"]'),null);
});
test('upload needs explicit server capability and enforces local format and size',async t=>{
  const disabled=await page(t,{owner:true});assert.equal(disabled.form('upload'),null);const p=await page(t,{owner:true,uploads:true});const input=p.form('upload').elements.file;Object.defineProperty(input,'files',{configurable:true,value:[{name:'program.exe',type:'application/octet-stream',size:12}]});p.submit('upload');await flush();assert.equal(p.requests.filter(r=>r.url.endsWith('/files')&&r.options.method==='POST').length,0);assert.match(p.form('upload').textContent,/Wybierz PDF/);Object.defineProperty(input,'files',{configurable:true,value:[new p.win.File(['PDF fixture'],'title.pdf',{type:'application/pdf'})]});p.submit('upload');await flush();const request=p.requests.find(r=>r.url.endsWith('/files')&&r.options.method==='POST');assert.equal(request.options.headers['X-File-Name'],'title.pdf');assert.equal(request.options.headers['X-Visibility'],'client');assert.equal(request.options.headers['Content-Type'],'application/pdf');
});
test('client profile is posted explicitly, never saved to web storage and never changes login identity',async t=>{
  const p=await page(t);p.set('profile','name','Nowe dane');p.set('profile','email','kontakt@example.net');p.submit('profile');await flush();const request=p.requests.find(r=>r.url==='/api/portal/profile'&&r.options.method==='POST');assert.ok(request);assert.deepEqual(JSON.parse(request.options.body),{name:'Nowe dane',email:'kontakt@example.net',phone:''});assert.match(p.form('profile').textContent,/nie zmienia adresu logowania/);assert.equal(p.requests.filter(r=>r.url.startsWith('/api/auth')||r.url.includes('email/send')).length,0);
});
test('expired session clears all previously visible vehicle and message details',async t=>{
  const p=await page(t,{override:(url,options)=>options.method==='POST'&&url.endsWith('/messages')?{status:401,data:{ok:false,error:'unauthorized'}}:undefined});p.set('message','text','Nowe pytanie');p.submit('message');await flush();assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);assert.equal(p.doc.getElementById('portalDetail').textContent,'');assert.equal(p.doc.getElementById('portalOrders').textContent,'');assert.equal(p.doc.getElementById('portalCreateMount').textContent,'');
});
test('every private API call uses cookie credentials and no-store; bfcache hide clears content',async t=>{
  const p=await page(t);for(const request of p.requests){assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.cache,'no-store');assert.equal(request.options.headers.Authorization,undefined);}p.win.dispatchEvent(new p.win.Event('pagehide'));assert.equal(p.doc.getElementById('portalDetail').textContent,'');assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);
});
test('a delayed order list cannot restore private content after another request expires the session',async t=>{
  let delay=false,resolve;const pending=new Promise(done=>resolve=done);
  const p=await page(t,{override:async(url,options)=>{
    if(delay&&url.startsWith('/api/portal/orders?')){await pending;return{ok:true,role:'client',orders:[{...orderFixture(),title:'PRIVATE LATE VEHICLE'}],pagination:{has_more:false}};}
    if(options.method==='POST'&&url.endsWith('/messages'))return{status:401,data:{ok:false,error:'unauthorized'}};
  }});
  delay=true;p.doc.getElementById('portalRefresh').click();await flush();p.set('message','text','Pytanie');p.submit('message');await flush();
  const gateTitle=p.doc.getElementById('portalGateTitle').textContent;const detailsBefore=p.requests.filter(request=>request.url==='/api/portal/orders/'+ORDER).length;
  resolve();await flush();
  assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);assert.equal(p.doc.getElementById('portalOrders').textContent,'');assert.equal(p.doc.getElementById('portalSummary').textContent,'');assert.equal(p.doc.getElementById('portalDetail').textContent,'');assert.equal(p.doc.getElementById('portalCreateMount').textContent,'');assert.equal(p.doc.getElementById('portalGateTitle').textContent,gateTitle);assert.equal(p.doc.getElementById('portalNotice').textContent,'');assert.equal(p.requests.filter(request=>request.url==='/api/portal/orders/'+ORDER).length,detailsBefore);
});
test('a delayed order list cannot restore private content after pagehide',async t=>{
  let delay=false,resolve;const pending=new Promise(done=>resolve=done);
  const p=await page(t,{override:async url=>{if(delay&&url.startsWith('/api/portal/orders?')){await pending;return{ok:true,role:'client',orders:[{...orderFixture(),title:'PRIVATE AFTER HIDE'}],pagination:{has_more:false}};}}});
  delay=true;p.doc.getElementById('portalRefresh').click();await flush();p.win.dispatchEvent(new p.win.Event('pagehide'));const gateTitle=p.doc.getElementById('portalGateTitle').textContent;resolve();await flush();
  assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);for(const id of ['portalOrders','portalSummary','portalDetail','portalCreateMount'])assert.equal(p.doc.getElementById(id).textContent,'');assert.equal(p.doc.getElementById('portalGateTitle').textContent,gateTitle);assert.equal(p.doc.getElementById('portalNotice').textContent,'');
});
test('a delayed error from an invalidated request cannot replace the current access gate',async t=>{
  let delay=false,reject;const pending=new Promise((resolve,no)=>reject=no);
  const p=await page(t,{override:async(url,options)=>{
    if(delay&&url.startsWith('/api/portal/orders?'))await pending;
    if(options.method==='POST'&&url.endsWith('/messages'))return{status:401,data:{ok:false,error:'unauthorized'}};
  }});
  delay=true;p.doc.getElementById('portalRefresh').click();await flush();p.set('message','text','Pytanie');p.submit('message');await flush();const gateTitle=p.doc.getElementById('portalGateTitle').textContent;reject(new Error('late network failure'));await flush();
  assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);assert.equal(p.doc.getElementById('portalGateTitle').textContent,gateTitle);assert.equal(p.doc.getElementById('portalNotice').textContent,'');assert.equal(p.doc.getElementById('portalOrders').textContent,'');
});
test('older updates, messages and files extend the actual detail beyond initial limits and deduplicate records',async t=>{
  const detail=historyFixture();const p=await page(t,{detail,override:url=>{
    const match=url.match(/\/(events|messages|files)\?limit=50&offset=(\d+)$/);if(!match)return;
    const key=match[1],offset=Number(match[2]);let records;
    if(key==='events')records=[detail.events[0],{id:recordId(0),message:'STARSZA AKTUALIZACJA',created_at:'2026-10-01T12:00:00Z'},{id:recordId(900),visibility:'internal',message:'SECRET OLDER EVENT'}];
    if(key==='messages')records=[detail.messages[0],{id:recordId(99),author:'owner',text:'STARSZA WIADOMOŚĆ',created_at:'2026-10-01T12:00:00Z'},{id:recordId(901),visibility:'internal',text:'SECRET OLDER MESSAGE'}];
    if(key==='files')records=[detail.files[0],{id:recordId(199),filename:'STARSZY MATERIAL.pdf',content_type:'application/pdf',size_bytes:1024},{id:recordId(902),visibility:'internal',filename:'SECRET OLDER FILE.pdf',content_type:'application/pdf'}];
    return{ok:true,[key]:records,pagination:{limit:50,offset,has_more:false}};
  }});
  assert.equal(p.requests.filter(request=>/\/(events|messages|files)\?/.test(request.url)).length,0);
  for(const key of ['events','messages','files']){const more=p.doc.querySelector('[data-portal-more="'+key+'"]');assert.equal(more.hidden,false);more.click();await flush();assert.equal(more.hidden,true);}
  assert.equal(p.doc.querySelectorAll('.portal-timeline > li').length,101);assert.equal(p.doc.querySelectorAll('.portal-message').length,51);assert.equal(p.doc.querySelectorAll('.portal-files > li').length,51);
  assert.match(p.doc.getElementById('portalDetail').textContent,/STARSZA AKTUALIZACJA/);assert.match(p.doc.getElementById('portalDetail').textContent,/STARSZA WIADOMOŚĆ/);assert.match(p.doc.getElementById('portalDetail').textContent,/STARSZY MATERIAL/);assert.doesNotMatch(p.doc.getElementById('portalDetail').textContent,/SECRET OLDER/);
  for(const [key,offset] of [['events',100],['messages',50],['files',50]])assert.equal(p.requests.filter(request=>request.url==='/api/portal/orders/'+ORDER+'/'+key+'?limit=50&offset='+offset).length,1);
});
test('loading older history preserves unsent messages, owner changes and selected upload controls',async t=>{
  const detail=historyFixture();const p=await page(t,{owner:true,uploads:true,detail,override:url=>{
    const match=url.match(/\/(events|messages|files)\?limit=50&offset=(\d+)$/);if(!match)return;
    const key=match[1];return{ok:true,[key]:[],pagination:{limit:50,offset:Number(match[2]),has_more:false}};
  }});
  const message=p.set('message','text','NIEWYSŁANA WIADOMOŚĆ'),location=p.set('update','location','NIEZAPISANA LOKALIZACJA'),upload=p.form('upload'),update=p.form('update');
  for(const key of ['messages','files','events']){p.doc.querySelector('[data-portal-more="'+key+'"]').click();await flush();}
  assert.equal(p.form('message').elements.text,message);assert.equal(message.value,'NIEWYSŁANA WIADOMOŚĆ');assert.equal(p.form('update'),update);assert.equal(location.value,'NIEZAPISANA LOKALIZACJA');assert.equal(p.form('upload'),upload);assert.equal(p.requests.filter(request=>request.options.method==='POST'||request.options.method==='PATCH').length,0);
});
test('older message requests run once while pending and do not lose the current draft',async t=>{
  let resolve;const pending=new Promise(done=>resolve=done);const detail=historyFixture();
  const p=await page(t,{detail,override:async url=>{if(url.endsWith('/messages?limit=50&offset=50')){await pending;return{ok:true,messages:[{id:recordId(99),author:'owner',text:'Starsza odpowiedź'}],pagination:{limit:50,offset:50,has_more:false}};}}});
  const input=p.set('message','text','MÓJ SZKIC'),more=p.doc.querySelector('[data-portal-more="messages"]');more.click();more.click();await flush();assert.equal(more.disabled,true);assert.equal(p.requests.filter(request=>request.url.endsWith('/messages?limit=50&offset=50')).length,1);resolve();await flush();assert.equal(more.hidden,true);assert.equal(p.form('message').elements.text,input);assert.equal(input.value,'MÓJ SZKIC');assert.equal(p.doc.querySelectorAll('.portal-message').length,51);
});
test('a pending older page cannot mix another vehicle into the newly selected detail',async t=>{
  const second='44444444-4444-4444-8444-444444444444',detail=historyFixture();const other={...orderFixture(),id:second,title:'2022 BMW X3'};let resolve;const pending=new Promise(done=>resolve=done);
  const p=await page(t,{detail,orders:[detail.order,other],override:async url=>{
    if(url.endsWith('/files?limit=50&offset=50')){await pending;return{ok:true,files:[{id:recordId(199),filename:'FOREIGN LATE FILE.pdf',content_type:'application/pdf',size_bytes:1024}],pagination:{limit:50,offset:50,has_more:false}};}
    if(url==='/api/portal/orders/'+second)return{ok:true,order:other,events:[],messages:[],files:[],pagination:{events:{limit:100,offset:0,has_more:false},messages:{limit:50,offset:0,has_more:false},files:{limit:50,offset:0,has_more:false}}};
  }});
  p.doc.querySelector('[data-portal-more="files"]').click();await flush();p.doc.querySelector('[data-order-id="'+second+'"]').click();await flush();p.set('message','text','Szkic dla BMW');const title=p.doc.querySelector('.portal-vehicle-top h2').textContent;resolve();await flush();
  assert.equal(p.doc.querySelector('.portal-vehicle-top h2').textContent,title);assert.match(title,/BMW X3/);assert.doesNotMatch(p.doc.getElementById('portalDetail').textContent,/FOREIGN LATE FILE|material-50/);assert.equal(p.form('message').elements.text.value,'Szkic dla BMW');assert.equal(p.doc.querySelectorAll('.portal-files > li').length,0);
});
test('malformed page metadata does not merge records or trigger an automatic retry',async t=>{
  const detail=historyFixture();const p=await page(t,{detail,override:url=>url.endsWith('/events?limit=50&offset=100')?{ok:true,events:[{id:recordId(0),message:'INVALID PAGE CONTENT'}],pagination:{limit:50,offset:101,has_more:false}}:undefined});
  const more=p.doc.querySelector('[data-portal-more="events"]');more.click();await flush();assert.equal(p.doc.querySelectorAll('.portal-timeline > li').length,100);assert.doesNotMatch(p.doc.getElementById('portalDetail').textContent,/INVALID PAGE CONTENT/);assert.match(p.doc.querySelector('[data-portal-history="events"]').textContent,/Nie udało się potwierdzić starszych wpisów/);assert.equal(more.disabled,false);assert.equal(p.requests.filter(request=>request.url.endsWith('/events?limit=50&offset=100')).length,1);
});
test('complete or malformed initial pagination cannot trigger an older-history request',async t=>{
  const detail=historyFixture();detail.pagination.events.offset=1;detail.pagination.messages.has_more=false;detail.pagination.files.has_more=false;
  const p=await page(t,{detail});for(const key of ['events','messages','files']){const more=p.doc.querySelector('[data-portal-more="'+key+'"]');assert.equal(more.hidden,true);more.click();}await flush();
  assert.equal(p.requests.filter(request=>/\/(events|messages|files)\?/.test(request.url)).length,0);assert.match(p.doc.querySelector('[data-portal-history="events"]').textContent,/Nie udało się potwierdzić pełnej historii/);
});
test('a reply draft based on incomplete server history displays an explicit warning',async t=>{
  const p=await page(t,{owner:true,override:url=>url.includes('/reply-draft?')?{ok:true,draft:{subject:'REXBID',body:'Potwierdzony etap transportu.',warnings:[]},source_complete:false}:undefined});p.submit('draft');await flush();assert.match(p.doc.querySelector('.portal-draft-output').textContent,/Szkic korzysta z części dostępnej historii; sprawdź starsze wpisy/);assert.equal(p.requests.filter(request=>request.options.method==='POST').length,0);
});


test('client choice uses real profile and provides secondary account identity without a UUID primary label',async t=>{
  const missing='44444444-4444-4444-8444-444444444444';
  const p=await page(t,{owner:true,override:url=>url==='/api/portal/clients'?{ok:true,clients:[{id:CLIENT,profile:{name:'Anna Klient',email:'anna@example.net',phone:'+48 123 456 789'}},{id:missing,account_type:'owner',profile:null,created_at:'2026-10-01T12:00:00Z'}]}:undefined});
  const input=p.form('create').elements.client_user_id;assert.match(input.options[1].textContent,/Anna Klient.*anna@example.net.*123 456/);assert.doesNotMatch(input.options[1].textContent,new RegExp(CLIENT));
  assert.match(input.options[2].textContent,/Konto właściciela REXBID.*Profil nieuzupełniony/);assert.doesNotMatch(input.options[2].textContent,new RegExp(missing));
  p.set('create','client_user_id',CLIENT);assert.match(p.doc.querySelector('.portal-client-preview').textContent,/Anna Klient.*anna@example.net/);assert.match(p.doc.querySelector('.portal-client-preview details').textContent,new RegExp(CLIENT));
});

test('VIN or LOT rules match their labels and reject malformed LOT before creating an import',async t=>{
  const p=await page(t,{owner:true});assert.match(p.form('create').elements.vin.parentElement.textContent,/wymagany, jeśli brak LOT/);assert.match(p.form('create').elements.lot.parentElement.textContent,/wymagany, jeśli brak VIN/);assert.equal(p.form('create').elements.lot.maxLength,32);
  p.set('create','client_user_id',CLIENT);p.set('create','title','Test');p.set('create','lot','BAD/LOT');p.set('create','platform','copart');p.submit('create');await flush();assert.equal(p.requests.filter(r=>r.url==='/api/portal/orders'&&r.options.method==='POST').length,0);
  p.set('create','lot','test-lot');p.submit('create');await flush();assert.equal(JSON.parse(p.requests.find(r=>r.url==='/api/portal/orders'&&r.options.method==='POST').options.body).lot,'TEST-LOT');
});

test('progress marks only explicitly confirmed history including server evidence beyond the first page',async t=>{
  const p=await page(t,{detail:{order:orderFixture(),confirmed_stages:['preparation','at_sea'],events:[{id:'internal',visibility:'internal',status:'payment_confirmed'}],messages:[],files:[]}});
  assert.equal(p.doc.querySelector('[data-stage="preparation"]').dataset.state,'done');assert.equal(p.doc.querySelector('[data-stage="at_sea"]').dataset.state,'current');
  for(const stage of ['auction_won','payment_confirmed','pickup_planned','at_us_terminal','loaded'])assert.equal(p.doc.querySelector('[data-stage="'+stage+'"]').dataset.state,'upcoming');
  assert.equal(p.doc.querySelectorAll('[data-state="done"]').length,1);
});

test('unconfirmed current order status does not fabricate stage evidence',async t=>{
  const p=await page(t,{detail:{order:orderFixture(),confirmed_stages:[],events:[],messages:[],files:[]}});assert.equal(p.doc.querySelectorAll('[aria-current="step"]').length,0);assert.equal(p.doc.querySelectorAll('[data-state="done"]').length,0);
});

test('unread badge survives refresh and explicit receipt confirms only fetched incoming ids while preserving draft',async t=>{
  const incoming=recordId(501),outgoing=recordId(502);let count=2,read=false;
  const detail={order:{...orderFixture(),unread_count:2},events:[],messages:[{id:incoming,author:'owner',text:'New incoming',unread:true},{id:outgoing,author:'client',text:'Own outgoing',unread:false}],files:[]};
  const p=await page(t,{detail,override:(url,options)=>{
    if(url.endsWith('/read')){const ids=JSON.parse(options.body).message_ids;assert.deepEqual(ids,[incoming]);read=true;count=1;return{ok:true,read_message_ids:ids,unread_count:count};}
    if(url.startsWith('/api/portal/orders?'))return{ok:true,orders:[{...detail.order,unread_count:count}],pagination:{has_more:false}};
    if(url==='/api/portal/orders/'+ORDER)return{ok:true,...detail,order:{...detail.order,unread_count:count},messages:detail.messages.map(message=>({...message,unread:message.id===incoming&&!read}))};
  }});
  assert.match(p.doc.querySelector('[data-portal-unread]').textContent,/2/);assert.equal(p.requests.filter(r=>r.options.method==='POST').length,0);
  p.doc.getElementById('portalRefresh').click();await flush();assert.match(p.doc.querySelector('[data-portal-unread]').textContent,/2/);
  p.set('message','text','Unsent draft');p.doc.querySelector('[data-portal-read]').click();await flush();
  assert.equal(p.requests.filter(r=>r.url.endsWith('/read')).length,1);assert.match(p.doc.querySelector('[data-portal-unread]').textContent,/1/);assert.equal(p.form('message').elements.text.value,'Unsent draft');assert.equal(p.doc.querySelector('[data-portal-read]').hidden,true);
  p.doc.getElementById('portalRefresh').click();await flush();assert.match(p.doc.querySelector('[data-portal-unread]').textContent,/1/);assert.equal(p.requests.filter(r=>r.url.includes('email')||r.url.startsWith('/api/auth')).length,0);
});

test('receipt error keeps unread state and late receipt response cannot modify another vehicle',async t=>{
  const message=recordId(503),other=recordId(504);let release;
  const pending=new Promise(resolve=>release=resolve);
  const detail={order:{...orderFixture(),unread_count:1},events:[],messages:[{id:message,author:'owner',text:'New',unread:true}],files:[]};
  const p=await page(t,{detail,orders:[detail.order,{...orderFixture(),id:other,title:'Second order',unread_count:4}],override:async(url,options)=>{
    if(url.endsWith('/read')){await pending;return{ok:true,read_message_ids:[message],unread_count:0};}
    if(url==='/api/portal/orders/'+other)return{ok:true,order:{...orderFixture(),id:other,title:'Second order',unread_count:4},events:[],messages:[],files:[]};
  }});
  p.doc.querySelector('[data-portal-read]').click();await flush();p.doc.querySelector('[data-order-id="'+other+'"]').click();await flush();release();await flush();
  assert.match(p.doc.querySelector('.portal-vehicle-card').textContent,/Second order/);assert.match(p.doc.querySelector('[data-portal-unread="'+other+'"]').textContent,/4/);assert.match(p.doc.querySelector('[data-portal-unread="'+ORDER+'"]').textContent,/1/);
  const failure=await page(t,{detail,override:url=>url.endsWith('/read')?{status:503,data:{ok:false,error:'unavailable'}}:undefined});failure.doc.querySelector('[data-portal-read]').click();await flush();assert.match(failure.doc.querySelector('[data-portal-unread]').textContent,/1/);assert.equal(failure.doc.querySelector('[data-portal-read]').hidden,false);
});

test('owner material visibility and summary show customer-facing facts without hiding the distinction',async t=>{
  const p=await page(t,{owner:true,detail:{order:{...orderFixture(),client_profile:{name:'Anna',email:'anna@example.net',phone:'+48 123 456 789'}},events:[],messages:[],files:[{id:FILE,filename:'Client.pdf',visibility:'client',content_type:'application/pdf'},{id:recordId(505),filename:'Internal.pdf',visibility:'internal',content_type:'application/pdf'}]}});
  assert.match(p.doc.querySelector('.portal-assigned-client').textContent,/Anna.*anna@example.net/);assert.match(p.doc.querySelector('.portal-order-location').textContent,/Savannah/);assert.match(p.doc.querySelector('.portal-order-updated').textContent,/Aktualizacja/);assert.match(p.doc.querySelector('.portal-order-eta').textContent,/orientacyjny/);
  assert.match(p.doc.querySelector('.portal-client-visible').textContent,/Widoczny dla klienta/);assert.match(p.doc.querySelector('.portal-files .portal-internal').textContent,/Tylko zespół/);
});


test('session banner identifies owner on the client route and persists independently of transient notices',async t=>{
 const p=await page(t,{role:'owner'}),banner=p.doc.getElementById('portalSessionRole');
 assert.equal(p.win.location.pathname,'/panel.html');assert.equal(banner.hidden,false);assert.equal(banner.dataset.role,'owner');assert.equal(banner.getAttribute('aria-label'),'Bieżąca sesja konta');
 assert.match(banner.textContent,/Sesja właściciela REXBID/);assert.match(banner.textContent,/wyloguj się i zaloguj na konto klienta/);assert.doesNotMatch(banner.textContent,/@|Sesja klienta/);
 assert.equal(banner.nextElementSibling.id,'portalNotice');assert.equal(p.doc.getElementById('portalNotice').hidden,true);
 p.doc.getElementById('portalRefresh').click();await flush();assert.equal(banner.hidden,false);assert.match(banner.textContent,/Sesja właściciela/);
 assert.equal(p.form('update'),null);assert.equal(p.form('create'),null);
});

test('client session banner uses the authenticated role without owner wording or account identifiers',async t=>{
 const p=await page(t),banner=p.doc.getElementById('portalSessionRole');
 assert.equal(banner.hidden,false);assert.equal(banner.dataset.role,'client');assert.match(banner.textContent,/Sesja klienta/);assert.match(banner.textContent,/przypisane do Twojego konta klienta/);assert.doesNotMatch(banner.textContent,/właściciel|@|11111111/);
});

test('role banner stays empty while access loads and for anonymous, denied, MFA, invalid or failed sessions',async t=>{
 const outcomes=[{status:401,data:{ok:false,error:'unauthorized'}},{status:403,data:{ok:false,error:'forbidden'}},{status:403,data:{ok:false,error:'owner_mfa_required'}},{ok:true,role:'unknown'},'network'];
 for(const outcome of outcomes){
  const p=await page(t,{override:url=>{if(url==='/api/portal/me'){if(outcome==='network')throw Error('network');return outcome;}},beforeReady(win,doc){const banner=doc.getElementById('portalSessionRole');assert.equal(banner.hidden,true);assert.equal(banner.textContent,'');assert.equal(banner.dataset.role,undefined);}});
  const banner=p.doc.getElementById('portalSessionRole');assert.equal(banner.hidden,true);assert.equal(banner.textContent,'');assert.equal(banner.dataset.role,undefined);assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);
 }
 const denied=await page(t,{owner:true,role:'client'});assert.equal(denied.doc.getElementById('portalSessionRole').hidden,true);assert.equal(denied.doc.getElementById('portalSessionRole').textContent,'');
});

test('session expiry and explicit logout immediately clear the previously authenticated role badge',async t=>{
 for(const role of ['owner','client']){
  const p=await page(t,{role,override:(url,options)=>options.method==='POST'&&url.endsWith('/messages')?{status:401,data:{ok:false,error:'unauthorized'}}:undefined}),banner=p.doc.getElementById('portalSessionRole');
  assert.equal(banner.dataset.role,role);p.set('message','text','Sprawdzam sesję');p.submit('message');await flush();assert.equal(banner.hidden,true);assert.equal(banner.textContent,'');assert.equal(banner.dataset.role,undefined);
  const logout=await page(t,{role}),logoutBanner=logout.doc.getElementById('portalSessionRole');logout.win.dispatchEvent(new logout.win.CustomEvent('rexbid:logout-start'));
  assert.equal(logoutBanner.hidden,true);assert.equal(logoutBanner.textContent,'');assert.equal(logoutBanner.dataset.role,undefined);assert.equal(logout.doc.getElementById('portalWorkspace').hidden,true);assert.equal(logout.doc.getElementById('portalLogin').hidden,false);
 }
});

test('delayed authenticated session cannot restore a role banner after logout begins',async t=>{
 let resolve,logoutOnSession;const pending=new Promise(done=>resolve=done);
 const p=await page(t,{role:'owner',override:async url=>{
  if(url!=='/api/portal/me')return undefined;
  logoutOnSession();await pending;return{ok:true,role:'owner'};
 },beforeReady(win,doc){
  logoutOnSession=()=>{win.dispatchEvent(new win.CustomEvent('rexbid:logout-start'));assert.equal(doc.getElementById('portalSessionRole').hidden,true);resolve();};
 }});
 assert.equal(p.requests.some(request=>request.url==='/api/portal/me'),true);assert.equal(p.doc.getElementById('portalSessionRole').hidden,true);assert.equal(p.doc.getElementById('portalSessionRole').textContent,'');assert.equal(p.doc.getElementById('portalWorkspace').hidden,true);assert.equal(p.requests.some(request=>request.url.startsWith('/api/portal/orders')),false);
});
