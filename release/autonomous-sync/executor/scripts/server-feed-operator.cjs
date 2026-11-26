'use strict';
// Explicit operator-only metadata connection. No connection at require time,
// no catalogue/customer writes, no DDL and no automatic transport retries.
const {ACCOUNT,TARGETS,assertStatement}=require('./d1-operator-bridge.cjs');
const TABLE_KEYS=Object.freeze({server_feed_state:'singleton',server_feed_generations:'generation_id',server_feed_receipts:'receipt_key',
 server_feed_outbox:'job_key',server_feed_daily_budgets:'day_key',server_feed_reservations:'reservation_key',server_feed_guards:'guard_id',
 automatic_refresh_state:'singleton',automatic_refresh_tasks:'task_key',automatic_refresh_guards:'guard_id',sync_batch_guards:'guard_id'});
const WRITABLE=new Set(Object.keys(TABLE_KEYS));
const fail=code=>{throw Error(code);};
function masked(sql){
 // Strip quoted literals while preserving token positions. Comments/quoted
 // identifiers are unsupported so they cannot disguise a second statement.
 let out='',quoted=false;
 for(let i=0;i<sql.length;i++){
  const c=sql[i];
  if(quoted){if(c==="'"&&sql[i+1]==="'"){out+='  ';i++;}else if(c==="'"){quoted=false;out+=' ';}else out+=' ';}
  else if(c==="'"){quoted=true;out+=' ';}else out+=c;
 }
 if(quoted||/--|\/\*|\*\/|["`\[\]]/.test(out))fail('SERVER_OPERATOR_SQL_NOT_ALLOWED');
 return out;
}
function assertServerStatement(sql,readOnly=false){
 assertStatement(sql,readOnly?new Set():WRITABLE);
 const text=masked(sql).trim().replace(/;$/,'').trim();
 if(/^(SELECT|PRAGMA)\b/i.test(text))return {write:false,maxRows:0};
 const match=/^(INSERT(?:\s+OR\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK))?\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)\b/i.exec(text);
 if(!match||!Object.hasOwn(TABLE_KEYS,match[2].toLowerCase()))fail('SERVER_OPERATOR_WRITE_NOT_ALLOWED');
 const table=match[2].toLowerCase(),primary=TABLE_KEYS[table];
 if(/^INSERT/i.test(match[1])){
  const values=/\bVALUES\s*\(/i.exec(text);
  if(!values)fail('SERVER_OPERATOR_SINGLE_ROW_REQUIRED');
  let depth=1,end=values.index+values[0].length;
  for(;end<text.length&&depth;end++){if(text[end]==='(')depth++;else if(text[end]===')')depth--;}
  if(depth||!/^\s*(?:ON\s+CONFLICT\b[\s\S]*)?$/i.test(text.slice(end)))fail('SERVER_OPERATOR_SINGLE_ROW_REQUIRED');
 }else{
  const where=/\bWHERE\s+([\s\S]+)$/i.exec(text);
  if(!where||!new RegExp('^'+primary+'\\s*=\\s*(?:\\?|'+(primary==='singleton'?'1':'(?!)')+')(?:\\s+AND\\b[\\s\\S]*)?$','i').test(where[1].trim()))fail('SERVER_OPERATOR_KEY_BOUND_REQUIRED');
  let depth=0,top='';for(const c of where[1]){if(c==='('){depth++;top+=' ';}else if(c===')'){depth--;if(depth<0)fail('SERVER_OPERATOR_SQL_NOT_ALLOWED');top+=' ';}else top+=depth?' ':c;}
  if(depth||/\bOR\b/i.test(top))fail('SERVER_OPERATOR_KEY_BOUND_REQUIRED');
 }
 // Current allowed tables have a PK and at most a few indexes. Keep a large
 // reserve for index/guard accounting; this is an operator estimate, not billing.
 return {write:true,maxRows:20};
}
function assertParams(params){
 if(!Array.isArray(params)||params.length>100||params.some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number'
   ||typeof v==='number'&&!Number.isFinite(v)||typeof v==='string'&&Buffer.byteLength(v)>2000000))fail('SERVER_OPERATOR_PARAMS_INVALID');
}
async function connectServerFeed({target,token,readOnly=false,fetchImpl=globalThis.fetch,writeBudget=null}={}){
 if(!Object.hasOwn(TARGETS,target)||typeof token!=='string'||!token||typeof fetchImpl!=='function'||typeof readOnly!=='boolean')fail('SERVER_OPERATOR_TARGET_REQUIRED');
 if(!readOnly&&(!writeBudget||['beforeWrite','complete','recordRead'].some(k=>typeof writeBudget[k]!=='function')
   ||!Number.isInteger(writeBudget.limits?.maxBatchWrites)||writeBudget.limits.maxBatchWrites<1||writeBudget.limits.maxBatchWrites>5000))fail('SERVER_OPERATOR_BUDGET_REQUIRED');
 const identity=TARGETS[target],base=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${identity.id}`;
 async function request(body){
  let response,value;try{response=await fetchImpl(base+(body?'/query':''),{method:body?'POST':'GET',redirect:'error',
   headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
   value=await response.json();}catch{fail('SERVER_OPERATOR_TRANSPORT_UNCERTAIN');}
  if(!response.ok||value?.success!==true||Array.isArray(value.result)&&value.result.some(r=>r?.success===false))fail('SERVER_OPERATOR_D1_FAILED');
  return value.result;
 }
 const metadata=await request();if(metadata?.uuid!==identity.id||metadata?.name!==identity.name)fail('SERVER_OPERATOR_IDENTITY_MISMATCH');
 async function execute(statements){
  if(!Array.isArray(statements)||statements.length<1||statements.length>250)fail('SERVER_OPERATOR_BATCH_INVALID');
  let estimated=0;for(const s of statements){assertParams(s.params||[]);estimated+=assertServerStatement(s.sql,readOnly).maxRows;}
  if(estimated>5000||estimated>(writeBudget?.limits?.maxBatchWrites??5000))fail('SERVER_OPERATOR_BATCH_WRITE_LIMIT');
  const ticket=estimated?await writeBudget.beforeWrite(statements,target):null;
  if(ticket&&(!Number.isInteger(ticket.writes)||ticket.writes<estimated||ticket.writes>5000))fail('SERVER_OPERATOR_RESERVATION_INVALID');
  const body=statements.length===1?statements[0]:{batch:statements};
  const result=await request(body);
  if(!Array.isArray(result)||result.length!==statements.length||result.some(r=>!Array.isArray(r.results)))fail('SERVER_OPERATOR_RESULT_INVALID');
  if(ticket)await writeBudget.complete(ticket,result);else if(writeBudget?.recordRead)await writeBudget.recordRead(result);
  return result;
 }
 function prepare(sql){
  assertServerStatement(sql,readOnly);
  const make=params=>({sql,params,bind(...next){return make(next);},async all(){return (await execute([{sql,params}]))[0];},
   async run(){return this.all();},async first(column){const row=(await this.all()).results[0]??null;return column&&row?row[column]:row;}});
  return make([]);
 }
 return {identity:{...identity},metadataVerified:true,prepare,batch:statements=>execute(statements.map(s=>({sql:s.sql,params:s.params||[]})))};
}
module.exports={TABLE_KEYS,assertServerStatement,connectServerFeed};
