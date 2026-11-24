'use strict';
const lookup=document.getElementById('ownerArchiveLookup');
const remove=document.getElementById('ownerArchiveRemove');
const vinInput=document.getElementById('ownerArchiveVin');
const confirmInput=document.getElementById('ownerArchiveConfirm');
const statusLine=document.getElementById('ownerArchiveStatus');
const entries=document.getElementById('ownerArchiveResults');
let currentVin='';
let busy=false;

const storageLine=document.getElementById('ownerArchiveStorage');
const storageRefresh=document.getElementById('ownerArchiveStorageRefresh');
const storageFeedback=document.getElementById('ownerArchiveStorageFeedback');
const storageSummary=document.getElementById('ownerArchiveStorageSummary');
let storageBusy=false;
let lastStorageMeasurement=null;
function storageMessage(text,tone){if(storageFeedback){storageFeedback.textContent=text;storageFeedback.dataset.tone=tone;}}
async function refreshStorage({userInitiated=false}={}){
  if(storageBusy||!storageLine)return;storageBusy=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  if(storageRefresh){storageRefresh.disabled=true;storageRefresh.textContent='Sprawdzam…';storageRefresh.setAttribute('aria-busy','true');}
  storageMessage('Sprawdzam ostatni zapis automatu…','loading');
  try{
    const {storage:s}=await request('/api/portal/archive?storage=1',{cache:'no-store',signal:controller.signal});
    if(!s){storageLine.textContent='Pierwszy pomiar pojawi się po automatycznym cyklu archiwum.';storageMessage('Połączenie działa. Automat nie zapisał jeszcze pierwszego pomiaru.','success');return;}
    const unchanged=s.at===lastStorageMeasurement;
    lastStorageMeasurement=s.at;
    const gb=n=>(n/1e9).toLocaleString('pl-PL',{maximumFractionDigits:2});
    const cost=s.estimatedStorageUSDMonthly.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:3});
    const warning=({capacity:'Osiągnięto pułap miejsca. Nowe galerie czekają; import ofert działa niezależnie.',near_capacity:'Uwaga: wykorzystano co najmniej 80% pułapu.',growth_warning:'Uwaga: przy zmierzonym tempie zapas może wystarczyć na mniej niż 7 dni.'})[s.warning]||'';
    const age=Date.now()-Date.parse(s.at);
    storageLine.textContent=warning+' Archiwum: '+gb(s.archiveAllocatedBytes)+' GB, '+s.galleries.toLocaleString('pl-PL')+' galerii. '+
      'Zajęcie całego magazynu z rezerwami: '+gb(s.reservedTotalBytes)+' / '+gb(s.limitBytes)+' GB. Zapas: '+gb(s.remainingBytes)+' GB. '+
      'Szacowany koszt samego miejsca przy tej wielkości przez cały miesiąc: '+cost+' USD (budżet 5 USD; operacje i podatki osobno). '+
      (s.trend?'Zmiana z '+s.trend.sampleHours.toFixed(0)+' godzin: '+gb(s.trend.bytesPerDay)+' GB/dobę. ':'Tempo będzie dostępne po co najmniej 24 godzinach pomiarów. ')+
      'Pomiar: '+new Date(s.at).toLocaleString('pl-PL')+'.'+(age>20*60000?' Uwaga: pomiar wymaga odświeżenia przez automat.':'');
    if(storageSummary)storageSummary.textContent=(warning?'Uwaga · ':'')+gb(s.archiveAllocatedBytes)+' GB zdjęć · '+gb(s.remainingBytes)+' GB zapasu';
    const card=document.getElementById('ownerStorage');if(card)card.dataset.warning=warning?'true':'false';
    const checked=new Date().toLocaleTimeString('pl-PL');
    storageMessage('Sprawdzono o '+checked+'. '+(unchanged&&userInitiated?'Brak nowszego pomiaru. ':'Dane odczytane poprawnie. ')+
      (age>20*60000?'Ostatni pomiar jest starszy niż 20 minut.':'Automat zapisuje pomiar zwykle co 5 minut.'),age>20*60000?'error':'success');
  }catch(err){storageMessage(controller.signal.aborted?'Sprawdzanie trwało zbyt długo. Spróbuj ponownie.':message(err.message),'error');}
  finally{
    clearTimeout(timer);storageBusy=false;
    if(storageRefresh){storageRefresh.disabled=false;storageRefresh.textContent='Sprawdź miejsce i budżet';storageRefresh.removeAttribute('aria-busy');}
  }
}
storageRefresh?.addEventListener('click',()=>refreshStorage({userInitiated:true}));
const ownerTools=[...document.querySelectorAll('.portal-owner-tool')];
for(const tool of ownerTools)tool.addEventListener('toggle',()=>{if(tool.open)for(const other of ownerTools)if(other!==tool)other.open=false;});
const workspace=document.getElementById('portalWorkspace');
if(workspace){const observer=new MutationObserver(()=>{if(!workspace.hidden){refreshStorage();observer.disconnect();}});observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});if(!workspace.hidden){refreshStorage();observer.disconnect();}}

function abortPreview(){
  currentVin='';
  remove.hidden=true;
  entries.replaceChildren();
  confirmInput.value='';
}
function message(error){
  return ({
    unauthorized:'Zaloguj się ponownie na konto właściciela.',
    owner_mfa_required:'Potwierdź sesję kodem z aplikacji uwierzytelniającej.',
    forbidden:'Dostęp ma tylko właściciel REXBID.',
    archive_busy:'Trwa aktualizacja archiwum. Spróbuj ponownie za chwilę.',
    invalid_vin:'Wpisz prawidłowy, 17-znakowy VIN.',
    vin_not_found:'Nie ma już wpisów dla tego VIN-u.'
  })[error] || 'Nie udało się wykonać operacji. Spróbuj ponownie.';
}
async function request(url,options){
  const r=await fetch(url,options);
  const data=await r.json();
  if(!r.ok) throw Error(data.error);
  return data;
}
vinInput.addEventListener('input',abortPreview);
lookup.addEventListener('submit',async event=>{
  event.preventDefault();
  if(busy) return;
  busy=true;
  abortPreview();
  const vin=vinInput.value.trim().toUpperCase();
  statusLine.textContent='Szukam w archiwum…';
  try {
    const data=await request('/api/portal/archive?vin='+encodeURIComponent(vin));
    if(vin!==vinInput.value.trim().toUpperCase()) return;
    for(const item of data.entries) {
      const li=document.createElement('li');
      li.textContent=item.title+' · '+item.platform.toUpperCase()+' · LOT '+item.lot+' · zdjęcia: '+item.photos;
      entries.append(li);
    }
    currentVin=data.vin;
    remove.hidden=data.entries.length===0;
    statusLine.textContent=data.entries.length?'Wpisy do usunięcia: '+data.entries.length+'.':
      data.suppressed?'Wpisy tego VIN-u zostały już usunięte z archiwum.':'Nie ma wpisów dla tego VIN-u.';
  } catch(err){statusLine.textContent=message(err.message);}
  finally {busy=false;}
});
remove.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!currentVin||busy) return;
  const confirm=confirmInput.value.trim().toUpperCase();
  if(confirm!==currentVin) {statusLine.textContent='VIN w potwierdzeniu musi być zgodny z VIN-em wyszukiwania.';return;}
  busy=true;
  const submit=remove.querySelector('button[type=submit]');
  submit.disabled=true;
  try{
    const result=await request('/api/portal/archive',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({vin:currentVin,confirm,reason:document.getElementById('ownerArchiveReason').value})
    });
    abortPreview();
    statusLine.textContent=result.purgePending?'Wpisy zdjęto z archiwum. Usunięcie plików czeka na ponowienie.':
      'Usunięto wpisy i galerie tego VIN-u. Ponowna publikacja jest zablokowana.';
  } catch(err){statusLine.textContent=message(err.message);}
  finally{busy=false;submit.disabled=false;}
});
