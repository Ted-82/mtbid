'use strict';
// Operator-only primitives. No credentials, DB connection, Cron or public route.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {parseHistoryPage,importTargetedHistory}=require('./targeted-history-import.cjs');
const sha=value=>createHash('sha256').update(value).digest('hex');
function readLines(file){return fs.existsSync(file)?fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse):[];}
function durable(file,value){const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function buildHistoryReadSpec(expected,{mode='included',cursor=null}={}){
 if(!['copart','iaai'].includes(expected?.platform)||!/^\d+$/.test(expected?.lot||'')
  ||!/^[A-HJ-NPR-Z0-9]{17}$/.test(expected?.vin||'')||!['included','paginated'].includes(mode))throw Error('TARGETED_HISTORY_INVALID_INPUT');
 // The documented detail/history path has no platform selector. A numeric LOT
 // can collide across platforms, so use the known VIN, then still validate the
 // returned VIN + platform + LOT before any write. Never retry another identity.
 return mode==='included'
  ? {operation:'vehicleByIdentifier',identifier:expected.vin,include:'history',platform:expected.platform}
  : {operation:'vehicleHistory',identifier:expected.vin,per_page:20,cursor,platform:expected.platform};
}
class HistoryBudget {
 constructor({directory,baseAttempts,baseLedgers,maxAttempts=100,combinedLimit=1000}){
  if(!Number.isInteger(baseAttempts)||baseAttempts<0||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>100||combinedLimit!==1000)throw Error('HISTORY_BUDGET_INVALID');
  fs.mkdirSync(directory,{recursive:true});this.directory=directory;this.file=path.join(directory,'history-ledger.ndjson');this.stop=path.join(directory,'history-stop.json');
  this.manifest=path.join(directory,'history-budget.json');
  const hashes=baseLedgers.map(file=>({file,sha256:sha(fs.readFileSync(file)),attempts:readLines(file).length}));
  if(hashes.reduce((sum,x)=>sum+x.attempts,0)!==baseAttempts)throw Error('HISTORY_BASE_BUDGET_MISMATCH');
  const config={baseAttempts,maxAttempts,combinedLimit,hashes};
  if(fs.existsSync(this.manifest)){if(JSON.stringify(JSON.parse(fs.readFileSync(this.manifest)))!==JSON.stringify(config))throw Error('HISTORY_BUDGET_RESUME_MISMATCH');}
  else fs.writeFileSync(this.manifest,JSON.stringify(config),{flag:'wx'});
  this.config=config;
 }
 records(){return readLines(this.file);}
 attempts(){return this.records().filter(x=>x.kind==='attempt');}
 assertAvailable(){
  if(fs.existsSync(this.stop))throw Error('HISTORY_STOP_LATCH');
  for(const x of this.config.hashes)if(sha(fs.readFileSync(x.file))!==x.sha256)throw Error('HISTORY_BASE_LEDGER_CHANGED');
  const attempts=this.attempts();
  if(attempts.some(x=>!this.records().some(y=>y.kind==='response'&&y.attempt===x.attempt)))throw Error('HISTORY_INTERRUPTED_ATTEMPT_NO_RETRY');
  if(attempts.some(x=>x.target&&!this.records().some(y=>y.kind==='commit'&&y.attempt===x.attempt)))throw Error('HISTORY_UNCOMMITTED_ATTEMPT_NO_RETRY');
  if(attempts.length>=this.config.maxAttempts||this.config.baseAttempts+attempts.length>=this.config.combinedLimit)throw Error('HISTORY_BUDGET_EXHAUSTED');
 }
 async request(spec,transport){
  this.assertAvailable();const attempt=this.attempts().length+1;
  // Reserve durably before any network attempt, including usage, timeout and 404.
  durable(this.file,{kind:'attempt',attempt,combined:this.config.baseAttempts+attempt,at:new Date().toISOString(),operation:spec.operation,platform:spec.platform||null,target:spec.target||null,retry:false});
  try{const response=await transport();durable(this.file,{kind:'response',attempt,at:new Date().toISOString(),ok:true,status:200});return response;}
  catch(error){durable(this.file,{kind:'response',attempt,at:new Date().toISOString(),ok:false,status:Number.isInteger(error.status)?error.status:null,code:['AUTH','RATE_LIMITED','TIMEOUT','UPSTREAM','NOT_FOUND','INVALID_RESPONSE'].includes(error.code)?error.code:'TRANSPORT_FAILED'});throw error;}
 }
 checkpoint(value){durable(this.file,{kind:'commit',at:new Date().toISOString(),...value});}
 halt(code){if(!fs.existsSync(this.stop))fs.writeFileSync(this.stop,JSON.stringify({at:new Date().toISOString(),code,attempts:this.attempts().length,combined:this.config.baseAttempts+this.attempts().length}),{flag:'wx'});}
}
async function enrichHistoryTarget({db,expected,fetchPage,budget,maxPages=4,mode='included',now=()=>new Date().toISOString()}){
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>4)throw Error('HISTORY_PAGE_LIMIT_INVALID');
 buildHistoryReadSpec(expected,{mode});
 const key=expected.platform+':'+expected.lot;
 const committed=budget.records().filter(x=>x.kind==='commit'&&x.target===key);
 const last=committed.at(-1);
 if(last&&(last.complete||last.mode==='included'||!last.nextCursor))return {...last,skipped:true};
 let cursor=last?.nextCursor??null,pages=0,totalEvents=0,excluded=0,result;
 const seen=new Set(committed.map(x=>x.inputCursor).filter(Boolean));
 while(pages<maxPages){
  const requestSpec=buildHistoryReadSpec(expected,{mode,cursor});
  const response=await budget.request({operation:mode==='included'?'detail_include_history':'history',platform:expected.platform,target:key},()=>fetchPage(expected,{cursor,mode,requestSpec}));
  const observedAt=now();
  const page=parseHistoryPage(response,expected,{mode});
  if(page.nextCursor&& (page.nextCursor===cursor||seen.has(page.nextCursor)))throw Error('HISTORY_REPEATED_CURSOR');
  result=await importTargetedHistory(db,{response,expected,observedAt,mode});
  pages++;totalEvents+=result.events;excluded+=result.excluded;
  budget.checkpoint({target:key,attempt:budget.attempts().at(-1).attempt,inputCursor:cursor,...result});
  if(result.complete||!result.nextCursor||mode==='included')break;
  if(cursor)seen.add(cursor);cursor=result.nextCursor;
 }
 return {...result,pages,totalEvents,excluded};
}
module.exports={HistoryBudget,enrichHistoryTarget,buildHistoryReadSpec};
