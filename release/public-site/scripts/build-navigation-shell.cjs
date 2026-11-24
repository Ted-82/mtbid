'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const links=[['Aukcje','/?catalog=1#results'],['Jak to działa','/jak-to-dziala'],['Ulubione','/ulubione'],['Konto','/konto'],['Pomoc','/pomoc'],['Kontakt','/kontakt']];
const fallback='<noscript data-rex-navigation-fallback><style>header .rex-menu-toggle{display:none!important}header .header-inner,header .header,header .bar{flex-wrap:wrap}header nav.rex-primary-nav{display:flex!important;position:static;flex-wrap:wrap;width:auto;box-shadow:none}</style></noscript>';
function render(source,file){
 if(!source.includes('/rexbid-mobile-nav.js'))return source;
 const current='/'+file.replace(/\.html$/,'');
 const menu='<button class="rex-menu-toggle" type="button" aria-label="Otwórz menu główne" aria-expanded="false" aria-controls="rexPrimaryNav">☰</button><nav class="rex-primary-nav" id="rexPrimaryNav" aria-label="Nawigacja główna">'+links.map(([name,href])=>'<a href="'+href+'"'+(href===current?' aria-current="page"':'')+'>'+name+(name==='Ulubione'?' <span data-rexbid-count="favorites">0</span>':'')+'</a>').join('')+'</nav>';
 return source.replace(/<header\b[^>]*>[\s\S]*?<\/header>/i,header=>{
  header=header.replace(/<div\b[^>]*data-rexbid-auth-nav[^>]*>[\s\S]*?<\/div>/g,'');
  const authSlot=source.includes('/rexbid-auth.js')?'<div class="rexbid-auth-nav" data-rexbid-auth-nav aria-label="Konto użytkownika"></div>':'';
  if(authSlot){const end=header.lastIndexOf('</div>');if(end<0)throw Error('Auth header wrapper missing: '+file);header=header.slice(0,end)+authSlot+header.slice(end);}
  header=header.replace(/<button\b[^>]*class="[^"]*rex-menu-toggle[^"]*"[^>]*>[\s\S]*?<\/button>/g,'');
  if(/<nav\b/i.test(header))return header.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/i,menu);
  const end=header.lastIndexOf('</div>');if(end<0)throw Error('Header wrapper missing: '+file);
  return header.slice(0,end)+menu+header.slice(end);
 }).replace(/<noscript data-rex-navigation-fallback>[\s\S]*?<\/noscript>/g,'').replace('</head>',fallback+'</head>');
}
function main(){const check=process.argv.includes('--check');let changed=0,count=0;for(const file of fs.readdirSync(path.join(root,'public')).filter(f=>f.endsWith('.html'))){const target=path.join(root,'public',file),before=fs.readFileSync(target,'utf8');if(!before.includes('/rexbid-mobile-nav.js'))continue;count++;const after=render(before,file);if(before!==after){changed++;if(!check)fs.writeFileSync(target,after);}}if(check&&changed)throw Error('Navigation shells out of date: '+changed);console.log(JSON.stringify({pages:count,changed,check}));}
if(require.main===module)main();module.exports={render,links};
