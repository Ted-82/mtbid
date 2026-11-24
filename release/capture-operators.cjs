'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const sha = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const operator = {
  executor:{
    source:'large-delivery-20261124/executor', version:'a95d53bb-a169-4371-ba7c-08dae26a2431',
    files:['docs/proposals/0019_catalog_exterior_color.sql','providers/apibara.js','providers/contract.js',
      'sync/d1-read-repository.js','sync/d1-repository.js','sync/feed-account-budget.cjs',
      'sync/feed-active-reconcile.cjs','sync/feed-change-rollback.cjs','sync/feed-history-enrichment.cjs',
      'sync/feed-record-hydration.cjs','sync/listing-display-facts.cjs','sync/publication-refresh.cjs',
      'tests/feed-active-reconcile.test.cjs','tests/feed-change-rollback.test.cjs',
      'tests/feed-record-hydration.test.cjs','tests/listing-display-facts.test.cjs']
  },
  photos:{
    source:'write-priority-20261122/photos', version:'0caccbfa-67a8-41e5-bd4c-500265d6df99',
    files:['repair.cjs','repair.test.cjs','worker.mjs']
  }
};
const dependencies=[
  'inquiry-budget-20261119/site/sync/catalog-order.cjs',
  'integrity-followup-20261118/executor/providers/apibara.js',
  'integrity-followup-20261118/executor/sync/catalog-media-storage.cjs'
];
const manifestName='operators-sha256.json';
function names(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    if(entry.isDirectory())return names(path.join(dir,entry.name)).map(p=>entry.name+'/'+p);
    if(!entry.isFile())throw Error('Unsupported file type: '+entry.name);
    return [entry.name];
  }).sort();
}
function compare(actual,expected,label){
  if(actual!==expected)throw Error('SHA-256 mismatch: '+label);
}
function copy(src,dest){
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(src,dest);
}
function verifyPack(pack){
  const manifest=JSON.parse(fs.readFileSync(path.join(pack,manifestName),'utf8'));
  for(const [name,info] of Object.entries(operator)){
    const recorded=manifest.operators[name].files,allowed=[...info.files].sort();
    if(recorded.map(r=>r.path).sort().join('\n')!==allowed.join('\n'))throw Error('Unexpected manifest files: '+name);
    if(names(path.join(pack,name)).join('\n')!==allowed.join('\n'))throw Error('Unexpected release files: '+name);
    for(const file of recorded)compare(sha(path.join(pack,name,file.path)),file.after,name+'/'+file.path);
  }
  return manifest;
}
function capture(){
  const audit=path.resolve(__dirname,'..'),bootstrap=path.resolve(audit,'..'),pack=path.join(audit,'repo','release');
  const manifest={schema:1,algorithm:'SHA-256',operators:{},photosDirectDependencies:{}};
  for(const [name,info] of Object.entries(operator)){
    const candidate=path.join(audit,name),source=path.join(bootstrap,info.source);
    if(names(candidate).join('\n')!==[...info.files].sort().join('\n'))throw Error('Review changed input inventory: '+name);
    const rows=[];
    for(const rel of [...info.files].sort()){
      const beforePath=path.join(source,rel),afterPath=path.join(candidate,rel);
      const before=fs.existsSync(beforePath)?sha(beforePath):null,after=sha(afterPath);
      rows.push({path:rel,change:before===null?'add':before===after?'same':'modify',before,after});
      copy(afterPath,path.join(pack,name,rel));
    }
    manifest.operators[name]={source:info.source,version:info.version,files:rows};
  }
  for(const source of dependencies)manifest.photosDirectDependencies[source]=sha(path.join(bootstrap,source));
  fs.writeFileSync(path.join(pack,manifestName),JSON.stringify(manifest,null,2)+'\n');
  copy(__filename,path.join(pack,'capture-operators.cjs'));
  verifyPack(pack);
  return {pack,files:Object.values(manifest.operators).reduce((n,o)=>n+o.files.length,0)};
}
function assemble(bootstrap,name,pack){
  if(!bootstrap||!name||!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name))throw Error('Use --assemble <existing-bootstrap-directory> <new-directory-name>');
  const manifest=verifyPack(pack),root=fs.realpathSync(bootstrap),target=path.join(root,name);
  if(fs.existsSync(target))throw Error('Choose a new and empty output path: '+target);
  for(const [rel,hash] of Object.entries(manifest.photosDirectDependencies))compare(sha(path.join(root,rel)),hash,rel);
  for(const [key,info] of Object.entries(operator)){
    for(const file of manifest.operators[key].files){
      const src=path.join(root,info.source,file.path),before=fs.existsSync(src)?sha(src):null;
      compare(before,file.before,key+'/'+file.path+' base');
    }
  }
  fs.mkdirSync(target);
  const allowedSource=src=>!['.git','.wrangler','node_modules'].includes(path.basename(src))&&!/^\.(env|dev\.vars)(?:\.|$)/.test(path.basename(src));
  for(const [key,info] of Object.entries(operator)){
    fs.cpSync(path.join(root,info.source),path.join(target,key),{recursive:true,filter:allowedSource});
    for(const file of manifest.operators[key].files){
      const destination=path.join(target,key,file.path);
      copy(path.join(pack,key,file.path),destination);
      compare(sha(destination),file.after,key+'/'+file.path+' assembled');
    }
  }
  return {target,status:'assembled locally'};
}
const [action,...args]=process.argv.slice(2);
try {
  const pack=fs.existsSync(path.join(__dirname,manifestName))?__dirname:path.resolve(__dirname,'../repo/release');
  if(!action)console.log(JSON.stringify(capture()));
  else if(action==='--verify'){verifyPack(pack);console.log('Verified operator files');}
  else if(action==='--assemble')console.log(JSON.stringify(assemble(args[0],args[1],pack)));
  else throw Error('Use --verify or --assemble for an existing release');
}catch(error){console.error(error.message);process.exitCode=1;}
