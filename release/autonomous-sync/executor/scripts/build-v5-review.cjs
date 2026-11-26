// Produce a review artifact from the actual V5 page code and public D1 snapshots.
// jsdom checks DOM execution only; this does not replace rendered browser QA.
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const ROOT = path.resolve(__dirname,'..');
const OUT = path.join(ROOT,'docs/qa/v5-professional-2026-10-06');
const catalog = JSON.parse(fs.readFileSync(path.join(OUT,'catalog-public-snapshot.json'),'utf8'));
const detail = JSON.parse(fs.readFileSync(path.join(OUT,'tesla-public-snapshot.json'),'utf8'));
const market = require('../public/rexbid-market.js');
const now = Date.now();
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const runs = [];

async function render(file, query = '') {
  let html=fs.readFileSync(path.join(ROOT,'public',file),'utf8');
  html=html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^\"]+)"[^>]*>/g,(match,url)=> {
    const resource=path.join(ROOT,'public',url.split('?')[0]);
    return fs.existsSync(resource) ? '<style>'+fs.readFileSync(resource,'utf8')+'</style>' : match;
  });
  const errors=[], requests=[];
  const console = new VirtualConsole();
  console.on('jsdomError',error=>{if(error.type!=='css-parsing'&&error.type!=='not-implemented')errors.push(error.message);});
  const dom = new JSDOM(html,{url:'https://preview.rexbid.pl/'+(file==='index.html'?'':file)+query,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
  const w=dom.window;
  w.scrollTo=()=>{}; w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.RexBidCalculatorV4Enabled=true; w.RexBidCalculatorV3Enabled=true;
  w.fetch=async (input)=>{
    const url=new URL(String(input),'https://preview.rexbid.pl'); requests.push(url.pathname);
    let body={ok:true}, status=200;
    if(url.pathname==='/api/cars') {
      const category=market.fromParams(url.searchParams);
      let records=catalog.data.filter(car=>market.eligible(car,category,now));
      const get=key=>url.searchParams.get(key);
      if(get('platform'))records=records.filter(car=>car.platform===get('platform'));
      if(get('make'))records=records.filter(car=>String(car.make).toLowerCase()===get('make').toLowerCase());
      if(get('model'))records=records.filter(car=>String(car.model).toLowerCase()===get('model').toLowerCase());
      const count=Math.min(50,Number(get('per_page'))||20);
      body={...catalog,data:records.slice(0,count),meta:{...catalog.meta,next_cursor:null,has_more_stored_rows:false,catalog_complete:false}};
    } else if(url.pathname.startsWith('/api/car/')) {
      body=url.pathname.endsWith('/history')?{ok:true,history:[],rex_history:{count:0,records:[],events:[],snapshots:[],kind:'empty'},meta:{next_cursor:null,history_kind:'empty'}}:detail;
    } else if(url.pathname==='/api/auth/config')body={ok:true,enabled:false};
    else if(url.pathname==='/api/contact/config')body={email:null,mode:'local_draft'};
    else if(url.pathname==='/api/me')body={ok:true,user:null};
    else {body={ok:false,error:'Niedostępne w zapisanym podglądzie.'};status=503;}
    return {ok:status===200,status,headers:{get:()=> 'application/json'},json:async()=>structuredClone(body),text:async()=>JSON.stringify(body)};
  };
  for(const script of [...w.document.querySelectorAll('script')]) {
    let source=script.textContent;
    if(script.src) {
      const resource=path.join(ROOT,'public',new URL(script.src).pathname);
      if(!fs.existsSync(resource))continue;
      source=fs.readFileSync(resource,'utf8');
    }
    try{w.eval(source);}catch(error){errors.push(error.stack||error.message);}
  }
  // All responses are local resolved promises; allow the actual page handlers to finish.
  for(let i=0;i<15;i++)await new Promise(resolve=>setTimeout(resolve,10));
  if(file==='car.html'&&!w.document.querySelector('#calculatorV4Mount #calculatorV4Heading'))errors.push('Vehicle calculator did not mount.');
  if(file==='index.html'&&!w.document.querySelector('.car-card,.market-aisle-card'))errors.push('Snapshot vehicle cards did not render.');
  if(errors.length)throw new Error(file+': '+errors.join('\n'));
  // Keep only rendered presentation, so the artifact cannot claim live bidding,
  // authentication, server filtering or submission of an inquiry.
  w.document.querySelectorAll('script').forEach(node=>node.remove());
  w.document.querySelectorAll('input,select,button,textarea').forEach(node=>{node.disabled=true;node.setAttribute('title','Zapisany podgląd wyglądu. Funkcje działają w projekcie i po wdrożeniu.');});
  w.document.querySelectorAll('a').forEach(node=>{node.removeAttribute('href');node.setAttribute('title','Zapisany podgląd wyglądu.');});
  const notice=w.document.createElement('aside');notice.textContent='Wzór V5 · zapis wyglądu z rzeczywistych plików · funkcje w tym pliku są nieaktywne';
  notice.setAttribute('style','padding:10px 20px;background:#e8eff6;color:#102436;font:13px/1.5 system-ui;border-bottom:1px solid #cbd6e2;');
  w.document.body.prepend(notice);
  const output=dom.serialize();
  runs.push({page:file+query,cards:w.document.querySelectorAll('.car-card,.market-aisle-card').length,calculator:!!w.document.querySelector('#calculatorV4Mount #calculatorV4Heading'),requests:requests.length,script_errors:errors.length});
  w.close();return output;
}

(async()=>{
  const views=[['Home',await render('index.html')],['Katalog',await render('index.html','?catalog=1')],['Karta auta',await render('car.html','?lot=62674546&platform=copart')],['Kontakt',await render('kontakt.html')]];
  const html=`<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>REXBID V5 — wzór strony</title><style>*{box-sizing:border-box}body{margin:0;background:#102436;color:#fff;font:14px/1.5 system-ui}header{padding:16px 22px;border-bottom:1px solid #31485e;display:flex;gap:20px;align-items:center;flex-wrap:wrap}strong{font-size:22px;letter-spacing:-1px}strong span{color:#ee5970}header small{color:#c3d0dd}nav{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}button{background:transparent;border:1px solid #71849a;color:white;border-radius:7px;padding:10px 18px;cursor:pointer;font:inherit;min-height:44px}button[aria-selected=true]{background:#d52c43;border-color:#d52c43}button:focus-visible{outline:3px solid #f7c0c8;outline-offset:3px}iframe{display:block;width:100%;height:calc(100vh - 96px);border:0;background:#f5f7fa}iframe[hidden]{display:none}</style></head><body><header><div><strong>REX<span>BID</span> V5</strong><br><small>Wzór strony. Zapis danych D1 z 6.10.2026; podgląd nie jest wdrożeniem.</small></div><nav role="tablist" aria-label="Widoki projektu">${views.map(([label],i)=>`<button role="tab" id="tab${i}" aria-controls="view${i}" aria-selected="${i===0}" data-view="${i}">${label}</button>`).join('')}</nav></header>${views.map(([label,view],i)=>`<iframe id="view${i}" role="tabpanel" aria-labelledby="tab${i}" title="${label} REXBID V5" sandbox="" srcdoc="${escape(view)}" ${i?'hidden':''}></iframe>`).join('')}<script>const tabs=[...document.querySelectorAll('[role=tab]')];function show(index){tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));document.getElementById('view'+i).hidden=i!==index;});}tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>show(i));tab.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const n=(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;show(n);tabs[n].focus();}});});</script></body></html>`;
  fs.writeFileSync(path.join(OUT,'REXBID_V5_WZOR_STRONY.html'),html);
  fs.writeFileSync(path.join(OUT,'dom-build-evidence.json'),JSON.stringify({built_at:new Date().toISOString(),rendered_browser_qa:false,source:'actual_v5_files_with_public_d1_snapshots',runs},null,2)+'\n');
  process.stdout.write(JSON.stringify(runs,null,2)+'\n');
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
