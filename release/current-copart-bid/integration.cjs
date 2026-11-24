'use strict';
const fs=require('node:fs'),path=require('node:path');
const [switchName,directory]=process.argv.slice(2);
if(switchName!=='--isolated'||!directory)throw Error('Use --isolated with a marked disposable build directory.');
const root=fs.realpathSync(directory),marker=path.join(root,'.rexbid-isolated-build');
if(!fs.existsSync(marker)||fs.readFileSync(marker,'utf8').trim()!=='REXBID isolated build')throw Error('Missing isolated-build marker.');
const hooks=[
 {name:'feed-api-request.cjs',from:' const countedRequest=spec=>request(spec);',to:` const countedRequest=async spec=>{
  const output=await request(spec);
  if(env.REXBID_FEED_OPEN_COVERAGE==='enabled'&&spec.operation==='vehicleByIdentifier'){
   try{
    const raw=adapter.vehicleDetailRecord(output.response);
    require('./feed-known-bid.cjs').rememberPaidBid(store,raw,output.observedAt);
   }catch{/* An optional observation cannot invalidate a counted upstream response. */}
  }
  return output;
 };`},
 {name:'feed-server-runner.cjs',from:'  result={ok:true,...result};return result;',to:`  try{
   await require('./feed-known-bid.cjs').maintainKnownBid({env,state,body,workPhase,result,control,usage,reservation,store,db,now,fetchImpl,buildRequest:countedFeedRequest});
  }catch(error){result.knownBid={saved:false,error:safeCode(error)};}
  result={ok:true,...result};return result;`}
];
const planned=hooks.map(h=>{
 const dest=path.join(root,'sync',h.name),before=fs.readFileSync(dest,'utf8').replace(/\r\n/g,'\n');
 const already=before.split(h.to).length-1;
 if(already===1)return {already:true,dest,before,after:before};
 if(already!==0||before.includes("require('./feed-known-bid.cjs')")||before.split(h.from).length!==2)throw Error('Unexpected base or partially applied code: '+h.name);
 return {already:false,dest,before,after:before.replace(h.from,h.to)};
});
if(planned.some(p=>p.already)!==planned.every(p=>p.already))throw Error('Partial installation. Start from a clean isolated copy.');
const source=path.join(__dirname,'executor');
const files=fs.readdirSync(source,{recursive:true}).map(f=>String(f)).filter(f=>fs.statSync(path.join(source,f)).isFile());
if(planned.every(p=>p.already)){
 for(const f of files){const target=path.join(root,f);if(!fs.existsSync(target)||!fs.readFileSync(target).equals(fs.readFileSync(path.join(source,f))))throw Error('Partial or different installed overlay: '+f);}
}else{
 // All source anchors and targets have been verified before the first write.
 for(const f of files){const target=path.join(root,f);if(fs.existsSync(target)&&!fs.readFileSync(target).equals(fs.readFileSync(path.join(source,f))))throw Error('Source conflict: '+f);}
 fs.cpSync(source,root,{recursive:true});
 for(const p of planned)fs.writeFileSync(p.dest,p.after);
}
