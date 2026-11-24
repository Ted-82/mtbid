'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'..');
const pub = path.join(root,'public');
const names = new Set(['rexbid-auth.js','rexbid-market.js','rexbid-storage.js','rexbid-auction-archive.js','rexbid-delivered-view.js','rexbid-delivered-cost.js','rexbid-compare.js','rexbid-purchase-budget.js','rexbid-vehicle.css','rexbid-catalog.css']);
for (const name of fs.readdirSync(pub).filter(name=>name.endsWith('.html'))) {
  const file=path.join(pub,name);
  const old=fs.readFileSync(file,'utf8');
  const content = old.replace(/((?:src|href)=["']\/)(rexbid-[\w-]+\.(?:js|css))(?:\?v=[^"'#]+)?(?=["'])/g,(original,before,asset)=>{
    if (!names.has(asset)) return original;
    const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(pub,asset),'utf8').replace(/\r\n/g,'\n')).digest('hex').slice(0,12);
    return before+asset+'?v='+digest;
  });
  if (content!==old) fs.writeFileSync(file,content);
}

