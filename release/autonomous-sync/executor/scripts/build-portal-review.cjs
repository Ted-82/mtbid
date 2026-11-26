// Build a self-contained review of the actual private portal components.
// Synthetic GET fixtures are restricted to this artifact. No real authentication,
// files, delivery tracking or mutations occur. jsdom validates DOM execution only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {JSDOM, VirtualConsole} = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--version' || !/^V[0-9]+\.[0-9]+$/.test(args[1]))) throw new Error('Expected --version V5.3');
const VERSION=args[1] || 'V5.2';
const VERSION_TAG=VERSION.toLowerCase().replace('.', '-');
const OUT = path.join(ROOT, 'docs/qa/'+VERSION_TAG+'-import-portal-2026-10-06');
const LABEL = 'Podgląd projektu • przykładowe dane • operacje i wysyłka wyłączone';
const sources = new Map();
const read = file => {
  const fullPath = path.join(ROOT, file), bytes = fs.readFileSync(fullPath);
  sources.set(file, {file,bytes:bytes.byteLength,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  return bytes.toString('utf8');
};
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inlineJS = source => source.replace(/<\/script/gi,'<\\/script');
const ORDER = '22222222-2222-4222-8222-222222222222';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const OWNER = '55555555-5555-4555-8555-555555555555';
const DATA = {
  order:{id:ORDER,title:'2020 Tesla Model 3 · przykład',vin:'5YJ3E1EA0LF000001',lot:'00000000',platform:'copart',status:'at_sea',location:'Port Savannah · przykład',estimated_arrival_at:'2026-11-02T12:00:00.000Z',vessel:'Statek demonstracyjny',container_number:'DEMO0000000',version:7,created_at:'2026-10-01T10:00:00.000Z',updated_at:'2026-10-06T11:30:00.000Z'},
  events:[
    {id:'event-3',event_type:'update',visibility:'client',status:'at_sea',message:'Przykładowa aktualizacja: kontener opuścił port w USA. Kolejny komunikat pokaże etap po dotarciu do Europy.',location:'Port Savannah · przykład',estimated_arrival_at:'2026-11-02T12:00:00.000Z',created_at:'2026-10-06T11:30:00.000Z'},
    {id:'event-2',event_type:'update',visibility:'client',status:'loaded',message:'Przykładowe potwierdzenie załadunku. Dokumenty dostępne niżej służą wyłącznie pokazaniu wyglądu panelu.',created_at:'2026-10-05T13:00:00.000Z'},
    {id:'event-internal',event_type:'note',visibility:'internal',status:null,message:'Przykładowa notatka wewnętrzna właściciela. Klient jej nie widzi.',created_at:'2026-10-04T12:30:00.000Z'},
    {id:'event-1',event_type:'update',visibility:'client',status:'payment_confirmed',message:'Przykładowy wpis potwierdzający etap płatności. Nie dotyczy rzeczywistej transakcji.',created_at:'2026-10-02T10:15:00.000Z'}
  ],
  messages:[
    {id:'message-1',author:'owner',text:'Dzień dobry. W tym miejscu klient zobaczy informacje o swoim pojeździe, historię i udostępnione dokumenty. To przykładowa rozmowa w podglądzie.',created_at:'2026-10-05T14:00:00.000Z'},
    {id:'message-2',author:'client',text:'Czy mogę sprawdzić tutaj szacowany termin przypłynięcia?',created_at:'2026-10-05T14:15:00.000Z'},
    {id:'message-3',author:'owner',text:'Tak — termin znajduje się przy samochodzie. Jest orientacyjny. W gotowym portalu zapisane aktualizacje pojawią się również w historii realizacji.',created_at:'2026-10-05T14:20:00.000Z'}
  ],
  files:[
    {id:'33333333-3333-4333-8333-333333333333',filename:'Przykładowa-faktura.pdf',content_type:'application/pdf',size_bytes:182272,visibility:'client',created_at:'2026-10-02T11:00:00.000Z'},
    {id:'44444444-4444-4444-8444-444444444444',filename:'Przykładowy-dokument-transportu.pdf',content_type:'application/pdf',size_bytes:98560,visibility:'client',created_at:'2026-10-05T13:15:00.000Z'}
  ],
  profile:{name:'Klient demonstracyjny',email:'klient@example.invalid',phone:null}
};

function fixturesScript(view) {
  // Inline-safe JSON; example data is not a fixture in the shipped public app.
  const data = JSON.stringify(DATA).replace(/</g,'\\u003c');
  return `(function(){
  "use strict";
  const data=${data},owner=${view==='owner'},orderId=${JSON.stringify(ORDER)};
  const requests=[],writes=[];
  window.__RexBidReview={requests,writes,example_data:true,read_only:true};
  const result=(body,status=200)=>Promise.resolve({ok:status>=200&&status<300,status,json:async()=>body});
  window.fetch=(input,options={})=>{
    const method=(options.method||"GET").toUpperCase(),url=new URL(String(input),"https://rexbid-preview.example.invalid"),path=url.pathname;
    requests.push({path,method});
    if(method!=="GET"){writes.push({path,method});return result({ok:false,error:"read_only_preview"},403);}
    if(path==="/api/portal/config")return result({ok:true,enabled:true,uploads_enabled:false});
    if(path==="/api/portal/me")return result({ok:true,role:owner?"owner":"client",user:{id:owner?${JSON.stringify(OWNER)}:${JSON.stringify(CLIENT)}}});
    if(path==="/api/portal/profile")return result({ok:true,profile:data.profile});
    if(path==="/api/portal/clients")return result({ok:true,role:"owner",clients:[{id:${JSON.stringify(CLIENT)},profile:data.profile,created_at:"2026-10-01T10:00:00.000Z"}],pagination:{limit:20,offset:0,has_more:false}});
    if(path==="/api/portal/orders")return result({ok:true,role:owner?"owner":"client",orders:[data.order],pagination:{limit:20,offset:0,has_more:false}});
    if(path==="/api/portal/orders/"+orderId)return result({ok:true,role:owner?"owner":"client",order:data.order,events:data.events.filter(event=>owner||event.visibility!=="internal"),messages:data.messages,files:data.files.map(file=>({...file,download_url:"/api/portal/orders/"+orderId+"/files/"+file.id})),pagination:{events:{limit:100,offset:0,has_more:false},messages:{limit:50,offset:0,has_more:false},files:{limit:50,offset:0,has_more:false}}});
    if(path==="/api/portal/security")return result({ok:false,error:"read_only_preview"},503);
    return result({ok:false,error:"read_only_preview"},403);
  };
  document.addEventListener("click",event=>{if(event.target.closest("a"))event.preventDefault();},true);
  document.addEventListener("submit",event=>event.preventDefault(),true);
  const lock=()=>{
    document.querySelectorAll("form input,form textarea,form select,form button").forEach(element=>{element.disabled=true;element.title="Podgląd: operacje i wysyłka są wyłączone.";});
    document.querySelectorAll("a").forEach(element=>{element.removeAttribute("href");element.setAttribute("aria-disabled","true");element.title="Podgląd: przejście i pobieranie są wyłączone.";});
  };
  document.addEventListener("DOMContentLoaded",()=>{
    const auth=document.getElementById("rexbid-owner-mfa");
    if(auth){const note=document.createElement("p");note.className="portal-notice";note.textContent="Podgląd właściciela: rzeczywiste logowanie i konfiguracja MFA są wyłączone. Ten widok nie potwierdza zabezpieczenia żadnego konta.";auth.append(note);}
    new MutationObserver(lock).observe(document.getElementById("portalWorkspace"),{childList:true,subtree:true});
    Promise.resolve().then(()=>window.RexBidClientPortal.ready).then(lock);
  },{once:true});
})();`;
}

function page(file, view) {
  let html=read('public/'+file);
  html=html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,(_,url)=>'<style>'+read('public/'+url.split('?')[0].replace(/^\//,''))+'</style>');
  // The MFA module needs real authentication. Its preview notice explicitly
  // marks it inactive instead of inventing enrollment or a security assurance.
  html=html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(_,url)=>{
    const filename=url.split('?')[0].replace(/^\//,'');
    if(filename==='rexbid-owner-mfa.js'){read('public/'+filename);return '';}
    return '<script defer>'+inlineJS(read('public/'+filename))+'</script>';
  });
  // Inline scripts ignore defer. Place them at body end, with fixtures installed
  // before the real portal module. DOMContentLoaded still mounts the actual UI.
  const moduleScripts=[...html.matchAll(/<script defer>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  html=html.replace(/<script defer>[\s\S]*?<\/script>/g,'');
  html=html.replace('</body>','<script>'+inlineJS(fixturesScript(view))+'</script>'+moduleScripts.map(source=>'<script>'+source+'</script>').join('')+'</body>');
  return html;
}

async function verify(view, html) {
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>{if(error.type!=='css-parsing'&&error.type!=='not-implemented')errors.push(error.message);});
  const dom=new JSDOM(html,{url:'https://rexbid-preview.example.invalid/'+(view==='owner'?'administracja.html':'panel.html'),runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
  const win=dom.window;
  await new Promise(resolve=>win.document.readyState==='complete'?resolve():win.addEventListener('load',resolve,{once:true}));
  await win.RexBidClientPortal.ready;
  for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  const doc=win.document,checks={view,vehicle_cards:doc.querySelectorAll('.portal-vehicle-card').length,stage_items:doc.querySelectorAll('.portal-stage-list li').length,timeline_items:doc.querySelectorAll('.portal-timeline li').length,messages:doc.querySelectorAll('.portal-message').length,file_links:doc.querySelectorAll('.portal-file-info a').length,create_forms:doc.querySelectorAll('[data-portal-form="create"]').length,update_forms:doc.querySelectorAll('[data-portal-form="update"]').length,mutation_controls_disabled:[...doc.querySelectorAll('form input,form select,form textarea,form button')].every(item=>item.disabled),external_resources:doc.querySelectorAll('script[src],link[href],img[src^="http"]').length,script_errors:errors};
  if(checks.vehicle_cards!==1||checks.stage_items!==11||checks.messages!==3||checks.file_links!==2||!checks.mutation_controls_disabled||checks.external_resources||errors.length)throw new Error('Preview DOM failed: '+JSON.stringify(checks));
  if(view==='client'&&doc.getElementById('portalDetail').textContent.includes('Przykładowa notatka wewnętrzna'))throw new Error('Internal example note leaked into client preview.');
  if(view==='owner'&&(checks.create_forms!==1||checks.update_forms!==1))throw new Error('Owner tools did not render.');
  const response=await win.fetch('/api/portal/orders/'+ORDER+'/messages',{method:'POST',body:'{"text":"blocked test"}'});
  const blocked=await response.json();
  if(response.status!==403||blocked.error!=='read_only_preview')throw new Error('Preview permitted a mutation.');
  checks.blocked_write_status=response.status;checks.requests=win.__RexBidReview.requests;
  win.close();return checks;
}

async function build() {
  const views=[['Panel klienta','client',page('panel.html','client')],['Panel właściciela','owner',page('administracja.html','owner')]];
  const checks=[];for(const [,view,html]of views)checks.push(await verify(view,html));
  let html=`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>REXBID ${VERSION} — podgląd panelu importów</title><style>*{box-sizing:border-box}body{margin:0;font:13px/1.5 system-ui,sans-serif;background:#f4f7fa;color:#17263a}.review-header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:16px 24px;background:#0f2030;color:white;border-bottom:1px solid #33475b}.review-brand{font-size:21px;font-weight:850;letter-spacing:-.8px}.review-brand span{color:#e43b51}.review-caption{display:block;color:#d2dce6;font-size:11px;margin-top:3px}.review-tabs{display:flex;gap:8px}button{font:inherit;cursor:pointer;color:#d8e2ed;background:transparent;min-height:44px;border:1px solid #536b80;border-radius:8px;padding:9px 16px}button[aria-selected="true"]{background:#d52c43;border-color:#d52c43;color:white}button:focus-visible{outline:3px solid #ffd3db;outline-offset:3px}iframe{display:block;width:100%;height:calc(100vh - 96px);min-height:650px;border:0;background:#f4f7fa}iframe[hidden]{display:none}@media(max-width:640px){.review-header{padding:12px 16px;gap:12px}.review-caption{font-size:10px;max-width:330px}.review-tabs{width:100%}.review-tabs button{flex:1;font-size:11px;padding-inline:9px}iframe{height:calc(100vh - 138px)}}</style></head><body><header class="review-header"><div><span class="review-brand">REX<span>BID</span> <small>${VERSION}</small></span><span class="review-caption">${LABEL}</span></div><nav class="review-tabs" role="tablist" aria-label="Widoki podglądu">${views.map(([label],index)=>`<button type="button" role="tab" id="review-tab-${index}" aria-controls="review-view-${index}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${label}</button>`).join('')}</nav></header>${views.map(([label,,html],index)=>`<iframe id="review-view-${index}" title="${label} — przykładowe dane" role="tabpanel" aria-labelledby="review-tab-${index}" sandbox="allow-scripts" srcdoc="${escape(html)}"${index?' hidden':''}></iframe>`).join('')}<script>const tabs=[...document.querySelectorAll('[role="tab"]')];const show=index=>tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;document.getElementById('review-view-'+i).hidden=i!==index;});tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>show(index));tab.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;show(next);tabs[next].focus();}});});</script></body></html>`;
  html=html.replace(/^[ \t]+$/gm,'');
  const bytes=Buffer.byteLength(html);if(bytes>2*1024*1024)throw new Error('Preview exceeds 2 MiB.');
  fs.mkdirSync(OUT,{recursive:true});const filename='REXBID_'+VERSION.replace('.', '_')+'_PANEL_PODGLAD.html';fs.writeFileSync(path.join(OUT,filename),html);
  const evidence={artifact:filename,bytes,sha256:crypto.createHash('sha256').update(html).digest('hex'),label:LABEL,synthetic_data:true,read_only_preview:true,rendered_browser_qa:false,sources:[...sources.values()].sort((a,b)=>a.file.localeCompare(b.file)),dom_checks:checks};
  fs.writeFileSync(path.join(OUT,'portal-review-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify({artifact:path.join(OUT,filename),bytes,sha256:evidence.sha256,dom_checks:checks.map(({requests,...check})=>check)},null,2)+'\n');
}
build().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
