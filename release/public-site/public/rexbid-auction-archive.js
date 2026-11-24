'use strict';

const form=document.getElementById('archive-search');
const input=document.getElementById('archive-query');
const status=document.getElementById('archive-status');
const results=document.getElementById('archive-results');
const more=document.getElementById('archive-next');
let pending,nextCursor,query='';

function el(tag,text){
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  return node;
}
function source(entry){return entry.platform==='iaai'?'IAAI':'Copart';}
function price(entry){
  if(entry.status==='not_sold')return 'Bez sprzedaży';
  if(entry.status!=='sold')return 'Wynik niepotwierdzony';
  if(Number.isSafeInteger(entry.saleCents)&&entry.saleCents>0)return new Intl.NumberFormat('pl-PL',{style:'currency',currency:'USD'}).format(entry.saleCents/100)+' · cena sprzedaży';
  return 'Sprzedany · bez ceny';
}
function details(entry){
  const block=el('details');
  block.className='archive-gallery';
  block.append(el('summary','Zdjęcia ('+entry.photos.length+')'));
  block.addEventListener('toggle',()=>{
    if(!block.open||block.querySelector('.archive-photo'))return;
    const figure=el('figure');
    figure.className='archive-photo';
    const nav=el('div');
    nav.className='archive-photo-nav';
    const back=el('button','Wstecz'),next=el('button','Dalej'),counter=el('span');
    back.type='button';next.type='button';
    counter.setAttribute('aria-live','polite');
    const link=el('a'),image=el('img');
    link.target='_blank';link.rel='noopener noreferrer';
    image.decoding='async';image.loading='lazy';
    let position=0;
    function show(){
      const href=entry.photos[position];
      if(!href?.startsWith('/archiwum-zdjecie/'))return;
      image.src=href;link.href=href;
      image.alt='Zdjęcie '+(position+1)+' · '+source(entry)+' · LOT '+entry.lot;
      counter.textContent=(position+1)+' / '+entry.photos.length;
      back.disabled=position===0;next.disabled=position===entry.photos.length-1;
    }
    back.addEventListener('click',()=>{if(position>0){position--;show();}});
    next.addEventListener('click',()=>{if(position<entry.photos.length-1){position++;show();}});
    nav.append(back,counter,next);link.append(image);figure.append(link,nav);block.append(figure);show();
  });
  return block;
}
function card(entry){
  const item=el('article');
  item.className='archive-entry';
  const main=el('div');main.className='archive-entry-title';
  const date=new Intl.DateTimeFormat('pl-PL',{dateStyle:'short',timeZone:'Europe/Warsaw'}).format(new Date(entry.recordedAt));
  main.append(el('h2',entry.title),el('p',source(entry)+' · LOT '+entry.lot+' · Zapis z '+date));
  const info=el('div');info.className='archive-entry-info';
  info.append(el('strong',price(entry)),el('p',entry.vin));
  item.append(main,info,details(entry));
  return item;
}
async function search(q,append=false){
  pending?.abort();
  pending=new AbortController();
  const {signal}=pending;
  if(!append) {query=q;results.replaceChildren();nextCursor=null;}
  status.textContent='Wczytywanie…';
  more.hidden=true;
  more.textContent='Pokaż kolejne oferty';
  const params=new URLSearchParams();
  if(q)params.set('q',q);
  if(append&&nextCursor)params.set('before',nextCursor);
  try {
    const response=await fetch('/api/archiwum?'+params,{signal});
    if(signal.aborted)return;
    if(response.status===400){status.textContent='Wpisz poprawny VIN albo numer LOT.';return;}
    if(!response.ok)throw Error('unavailable');
    const {entries,next}=await response.json();
    if(signal.aborted)return;
    results.append(...entries.map(card));
    nextCursor=next;
    more.hidden=!next;
    status.textContent=results.children.length?'Wyświetlono: '+results.children.length:'Brak wpisów dla tego wyszukiwania.';
  } catch {
    if(signal.aborted)return;
    status.textContent=append?'Nie udało się pobrać kolejnych ofert.':'Nie udało się wczytać archiwum.';
    more.textContent='Spróbuj ponownie';
    more.hidden=false;
  }
}
form.addEventListener('submit',event=>{
  event.preventDefault();
  const q=input.value.trim();
  const url=new URL(location.href);
  if(q)url.searchParams.set('q',q);else url.searchParams.delete('q');
  history.replaceState(null,'',url);
  void search(q);
});
more.addEventListener('click',()=>{void search(query,Boolean(nextCursor));});
input.value=new URL(location.href).searchParams.get('q')||'';
void search(input.value.trim());
