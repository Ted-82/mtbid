'use strict';
const {createHash}=require('node:crypto');
const SAFE_CODES=new Set(['D1_ERROR','D1_EXEC_ERROR','D1_TYPE_ERROR','D1_COLUMN_NOTFOUND','SQLITE_ERROR','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_FULL','SQLITE_TOOBIG','SQLITE_CONSTRAINT','SQLITE_CONSTRAINT_CHECK','SQLITE_CONSTRAINT_FOREIGNKEY','ECONNRESET','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET','AUTOMATIC_REFRESH_WRITE_FAILED','SERVER_FEED_QUERY_BUDGET']);
function category(message){
 if(/cannot perform I\/O on behalf of a different request|different request context/i.test(message))return'D1_CROSS_REQUEST_IO';
 if(/CHECK constraint failed[^\r\n]*\ballowed\s*=\s*1/i.test(message))return'ATOMIC_ALLOWED_GUARD';
 if(/CHECK constraint failed[^\r\n]*\bvalid\s*=\s*1/i.test(message))return'ATOMIC_LEASE_GUARD';
 if(/expression tree (?:is )?too large|maximum depth/i.test(message))return'SQLITE_EXPRESSION_LIMIT';
 if(/too many SQL variables|too many (?:SQL|database) queries|subrequest.*limit|query.*limit exceeded/i.test(message))return'D1_QUERY_LIMIT';
 if(/database is (?:locked|busy)|SQLITE_BUSY|SQLITE_LOCKED/i.test(message))return'SQLITE_BUSY_LOCKED';
 if(/database.*(?:full|size limit)|SQLITE_FULL/i.test(message))return'D1_STORAGE_LIMIT';
 if(/SQLITE_TOOBIG|statement too long|too big/i.test(message))return'SQLITE_SIZE_LIMIT';
 if(/no such (?:table|column)|syntax error|malformed/i.test(message))return'SQLITE_SCHEMA_OR_SYNTAX';
 if(/constraint failed|SQLITE_CONSTRAINT|FOREIGN KEY constraint/i.test(message))return'SQLITE_CONSTRAINT_OTHER';
 if(/timed?\s*out|timeout|deadline exceeded|ETIMEDOUT/i.test(message))return'D1_TIMEOUT';
 if(/network connection lost|connection reset|fetch failed|failed to fetch|socket|ECONNRESET|unavailable/i.test(message))return'D1_TRANSPORT';
 if(/unauthori[sz]ed|not authorized|authentication|forbidden/i.test(message))return'D1_AUTH';
 if(/overloaded|too many resources(?: consumed)?|resources? (?:consumed|limit).*10.?second|(?:code[=: ]+|\b)7429\b/i.test(message))return'D1_RESOURCE_OVERLOAD';
 if(/D1_ERROR|D1_EXEC_ERROR/i.test(message))return'D1_UNCLASSIFIED';
 return'UNCLASSIFIED';
}
function summarizeFailure(error){
 const causes=[],seen=new Set();let current=error;
 while(current&&causes.length<5&&!seen.has(current)){seen.add(current);const message=typeof current.message==='string'?current.message.slice(0,8192):typeof current==='string'?current.slice(0,8192):'';const code=typeof current.code==='string'&&SAFE_CODES.has(current.code)?current.code:null;causes.push({depth:causes.length,category:category(message+' '+(code||'')),code,messageSha256:createHash('sha256').update(message).digest('hex')});current=current.cause;}
 return{category:causes.find(c=>!['UNCLASSIFIED','D1_UNCLASSIFIED'].includes(c.category))?.category||causes.at(-1)?.category||'UNCLASSIFIED',causes,causeChainTruncated:Boolean(current)};
}
function diagnosticDatabase(binding,onFailure=()=>{}){
 if(typeof binding?.prepare!=='function'||typeof binding?.batch!=='function'||typeof onFailure!=='function')throw Error('EXECUTOR_DIAGNOSTICS_CONFIG_INVALID');
 const native=new WeakMap(),usage={rowsRead:0,rowsWritten:0,statements:0,unknown:false};
 const account=result=>{for(const row of Array.isArray(result)?result:[result]){if(row?.success===false||!Number.isSafeInteger(row?.meta?.rows_read)||row.meta.rows_read<0||!Number.isSafeInteger(row?.meta?.rows_written)||row.meta.rows_written<0){usage.unknown=true;continue;}usage.rowsRead+=row.meta.rows_read;usage.rowsWritten+=row.meta.rows_written;}};
 const report=(operation,error)=>{try{onFailure({operation,...summarizeFailure(error)});}catch{}};
 function wrap(stmt){const result={bind(...params){try{return wrap(stmt.bind(...params));}catch(e){report('bind',e);throw e;}}};native.set(result,stmt);
  for(const method of ['all','first','run','raw'])if(typeof stmt[method]==='function')result[method]=async(...args)=>{usage.statements++;try{const value=await stmt[method](...args);account(value);return value;}catch(e){usage.unknown=true;report(method,e);throw e;}};
  return result;
 }
 return{prepare(sql){try{return wrap(binding.prepare(sql));}catch(e){report('prepare',e);throw e;}},async batch(statements){usage.statements+=statements.length;try{const value=await binding.batch(statements.map(s=>native.get(s)||s));account(value);return value;}catch(e){usage.unknown=true;report('batch',e);throw e;}},usageSnapshot(){return{...usage};}};
}
module.exports={summarizeFailure,diagnosticDatabase};
