'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {importTargetedHistory}=require('../scripts/targeted-history-import.cjs');
const expected={platform:'iaai',lot:'43806658',vin:'5YJ3E1EA4NF186754'};
const observedAt='2026-10-20T16:00:00.000Z';
const event=(number=1)=>({platform:expected.platform,lot_number:expected.lot,
 date:new Date(Date.UTC(2026,0,number)).toISOString().slice(0,10),
 price:number===1?0:number*100,status:number%2?'Sold on Approval':'Sold'});
const included=events=>({ok:true,data:{...expected,lot_number:expected.lot,history:events}});
const input=events=>({response:included(events),expected,observedAt,mode:'included'});
function database(t,{changeResults,failReceiptSelect=false}={}){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON');
 sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0004_d1_sync_2.sql'),'utf8'));
 sql.exec("INSERT INTO vehicle_sources(source_key,provider,platform,identity_kind,identity_state,first_seen_at,last_seen_at,created_at,updated_at) VALUES('source','apibara','iaai','provider_vehicle_id','resolved','2026-01-01','2026-01-01','2026-01-01','2026-01-01')");
 sql.prepare("INSERT INTO auction_listings(listing_id,source_key,platform,identity_state,vin_normalized,lot,first_seen_at,last_seen_at,created_at,updated_at) VALUES('listing','source','iaai','resolved',?,?,'2026-01-01','2026-01-01','2026-01-01','2026-01-01')").run(expected.vin,expected.lot);
 const calls=[];
 const db={prepare(query){
  return {sql:query,params:[],bind(...params){return {...this,params};},
   async all(){assert.ok(this.params.length<=100,'D1 maximum 100 bound parameters per query');calls.push({kind:'all',sql:query,params:this.params});return {results:sql.prepare(query).all(...this.params)};},
   async first(){calls.push({kind:'first',sql:query,params:this.params});return sql.prepare(query).get(...this.params)||null;}};
 },async batch(statements){
  assert.ok(statements.length<=250,'operator bridge maximum 250 statements per batch');
  assert.ok(statements.every(statement=>statement.params.length<=100),'D1 maximum 100 bound parameters per query');
  calls.push({kind:'batch',statements});
  sql.exec('BEGIN');
  try{
   const results=statements.map(statement=>{
    if(failReceiptSelect&&/^SELECT status,cursor,/.test(statement.sql))throw Error('fixture receipt SELECT failure');
    return /^\s*SELECT\b/i.test(statement.sql)
     ?{success:true,results:sql.prepare(statement.sql).all(...statement.params)}
     :{success:true,results:[],meta:{changes:Number(sql.prepare(statement.sql).run(...statement.params).changes)}};
   });
   sql.exec('COMMIT');
   return changeResults?changeResults(results,statements):results;
  }catch(error){sql.exec('ROLLBACK');throw error;}
 }};
 t.after(()=>sql.close());
 return {sql,db,calls};
}
test('events and receipt readback are returned by the one write batch, with no subsequent queries',async t=>{
 const {db,sql,calls}=database(t),before=JSON.stringify(sql.prepare('SELECT * FROM auction_listings').all());
 const result=await importTargetedHistory(db,input([event(1),event(2)]));
 assert.equal(result.events,2);assert.equal(result.complete,true);
 assert.deepEqual(calls.map(call=>call.kind),['all','all','batch']);
 const statements=calls.at(-1).statements;
 assert.equal(statements.length,5);
 assert.match(statements[2].sql,/INSERT INTO provider_sync_scopes/);
 assert.match(statements[3].sql,/SELECT event_id,listing_id,source_key,platform,lot,vin_normalized,fingerprint/);
 assert.match(statements[4].sql,/SELECT status,cursor,last_success_at,last_complete_at/);
 assert.equal(JSON.stringify(sql.prepare('SELECT * FROM auction_listings').all()),before);
 const events=sql.prepare('SELECT source_status,source_price_usd,final_price_usd FROM auction_events ORDER BY auction_date').all();
 assert.deepEqual(events.map(row=>[row.source_status,row.source_price_usd,row.final_price_usd]),[
  ['Sold on Approval',0,null],['Sold',200,200]]);
 assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('201 included events respect D1 chunks of 100 for both conflict check and atomic readback',async t=>{
 const {db,sql,calls}=database(t);
 await importTargetedHistory(db,input(Array.from({length:201},(_,i)=>event(i+1))));
 assert.deepEqual(calls.map(call=>call.kind),['all','all','all','all','batch']);
 assert.deepEqual(calls.slice(1,-1).map(call=>call.params.length),[100,100,1]);
 const selects=calls.at(-1).statements.filter(statement=>/^SELECT event_id/.test(statement.sql));
 assert.deepEqual(selects.map(statement=>statement.params.length),[100,100,1]);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,201);
});
test('245 events fill exactly 250 statements while 249 preserve the prior separate-readback fallback',async t=>{
 for(const count of [245,249]){
  const {db,sql,calls}=database(t);
  const result=await importTargetedHistory(db,input(Array.from({length:count},(_,i)=>event(i+1))));
  assert.equal(result.events,count);
  const batchIndex=calls.findIndex(call=>call.kind==='batch'),batch=calls[batchIndex];
  assert.equal(batch.statements.length,250);
  if(count===245)assert.equal(batchIndex,calls.length-1);
  else{
   assert.ok(batch.statements.every(statement=>/^INSERT/.test(statement.sql)));
   assert.deepEqual(calls.slice(batchIndex+1).map(call=>call.params.length),[100,100,49,1]);
   assert.match(calls.at(-1).sql,/SELECT status,cursor,last_success_at,last_complete_at/);
  }
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,count);
  assert.equal(sql.prepare('SELECT last_success_at FROM provider_sync_scopes').get().last_success_at,observedAt);
 }
});
test('249-event fallback retains strict event identity and receipt checks',async t=>{
 for(const corrupt of ['event','receipt']){
  const {db}=database(t),prepare=db.prepare.bind(db);
  let committed=false;
  const batch=db.batch.bind(db);
  db.batch=async statements=>{const result=await batch(statements);committed=true;return result;};
  db.prepare=query=>{
   const statement=prepare(query),bind=statement.bind.bind(statement);
   statement.bind=(...params)=>{
    const bound=bind(...params),all=bound.all.bind(bound);
    bound.all=async()=>{
     const result=await all();
     if(committed&&corrupt==='event'&&/^SELECT event_id/.test(query))result.results[0].lot='wrong';
     if(committed&&corrupt==='receipt'&&/^SELECT status,cursor/.test(query))result.results[0].cursor='wrong';
     return result;
    };
    return bound;
   };
   return statement;
  };
  await assert.rejects(importTargetedHistory(db,input(Array.from({length:249},(_,i)=>event(i+1)))),
   corrupt==='event'?/TARGETED_HISTORY_READBACK_MISMATCH/:/TARGETED_HISTORY_RECEIPT_READBACK_MISMATCH/);
 }
});
test('complete empty, partial empty and forced incomplete receipts retain exact cursor and timestamps',async t=>{
 const variants=[
  {response:included([]),mode:'included',status:'complete',cursor:null,complete:observedAt},
  {response:{ok:true,data:{vehicle:{...expected,lot_number:expected.lot},history:[]},meta:{next_cursor:'next/+='}},
   mode:'paginated',status:'partial',cursor:'next/+=',complete:null},
  {response:included([]),mode:'included',sourceComplete:false,status:'partial',cursor:null,complete:null}
 ];
 for(const variant of variants){
  const {db,sql,calls}=database(t);
  const result=await importTargetedHistory(db,{...variant,expected,observedAt});
  assert.equal(result.complete,variant.status==='complete');
  assert.deepEqual(calls.map(call=>call.kind),['all','batch']);
  assert.equal(calls.at(-1).statements.length,2);
  const receipt=sql.prepare('SELECT status,cursor,last_success_at,last_complete_at FROM provider_sync_scopes').get();
  assert.deepEqual({...receipt},{status:variant.status,cursor:variant.cursor,last_success_at:observedAt,last_complete_at:variant.complete});
 }
});
test('final SELECT failure rolls back events and receipt in the same transaction',async t=>{
 const {db,sql}=database(t,{failReceiptSelect:true});
 await assert.rejects(importTargetedHistory(db,input([event()])),/fixture receipt SELECT failure/);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM provider_sync_scopes').get().n,0);
});
test('identity conflicts are still rejected before a write batch',async t=>{
 const {db,sql,calls}=database(t);
 await importTargetedHistory(db,input([event()]));
 sql.prepare("UPDATE auction_events SET vin_normalized='SHHFK7H51JU428898'").run();
 calls.length=0;
 await assert.rejects(importTargetedHistory(db,input([event()])),/TARGETED_HISTORY_EVENT_CONFLICT/);
 assert.equal(calls.some(call=>call.kind==='batch'),false);
});
test('missing, malformed, duplicate and altered event readback fail closed',async t=>{
 const alterations=[
  results=>undefined,
  results=>results.slice(1),
  results=>{results.at(-2).results=[];return results;},
  results=>{results.at(-2).results=null;return results;},
  results=>{results.at(-2).success=false;return results;},
  results=>{results.at(-2).results.push({...results.at(-2).results[0]});return results;},
  ...['event_id','listing_id','source_key','platform','lot','vin_normalized','fingerprint'].map(key=>results=>{
   results.at(-2).results[0][key]='wrong';return results;
  })
 ];
 for(const changeResults of alterations){
  const {db}=database(t,{changeResults});
  await assert.rejects(importTargetedHistory(db,input([event()])),/TARGETED_HISTORY_READBACK_MISMATCH/);
 }
});
test('all receipt fields and its result shape remain mandatory',async t=>{
 const alterations=[
  results=>{results.at(-1).results=[];return results;},
  results=>{results.at(-1).results=null;return results;},
  results=>{results.at(-1).success=false;return results;},
  results=>{results.at(-1).results.push({...results.at(-1).results[0]});return results;},
  ...['status','cursor','last_success_at','last_complete_at'].map(key=>results=>{
   results.at(-1).results[0][key]='wrong';return results;
  })
 ];
 for(const changeResults of alterations){
  const {db}=database(t,{changeResults});
  await assert.rejects(importTargetedHistory(db,input([event()])),/TARGETED_HISTORY_RECEIPT_READBACK_MISMATCH/);
 }
});
test('older differing events and receipts cannot be accepted as a new successful import',async t=>{
 const {db,sql}=database(t);
 await importTargetedHistory(db,input([event()]));
 const before=JSON.stringify(sql.prepare('SELECT * FROM auction_events').all());
 await assert.rejects(importTargetedHistory(db,{...input([{...event(),price:999}]),observedAt:'2026-10-19T16:00:00.000Z'}),/TARGETED_HISTORY_READBACK_MISMATCH/);
 assert.equal(JSON.stringify(sql.prepare('SELECT * FROM auction_events').all()),before);
 await assert.rejects(importTargetedHistory(db,{...input([event()]),observedAt:'2026-10-19T16:00:00.000Z'}),/TARGETED_HISTORY_RECEIPT_READBACK_MISMATCH/);
 assert.equal(sql.prepare('SELECT last_success_at FROM provider_sync_scopes').get().last_success_at,observedAt);
});
test('verified listing ID combines both prechecks in a read-only batch and preserves identical stored data',async t=>{
 const fast=database(t),fallback=database(t);
 const request=input([event(1),event(2)]);
 await importTargetedHistory(fast.db,{...request,expected:{...expected,listingId:'listing'}});
 await importTargetedHistory(fallback.db,request);
 assert.deepEqual(fast.calls.map(call=>call.kind),['batch','batch']);
 assert.equal(fast.calls[0].statements.length,2);
 assert.ok(fast.calls[0].statements.every(statement=>/^SELECT/.test(statement.sql)));
 assert.match(fast.calls[0].statements[0].sql,/WHERE l.platform=\? AND l.lot=\?$/);
 assert.match(fast.calls[0].statements[1].sql,/FROM auction_events WHERE event_id IN/);
 for(const table of ['auction_listings','auction_events','provider_sync_scopes']){
  assert.deepEqual(fast.sql.prepare('SELECT * FROM '+table).all(),fallback.sql.prepare('SELECT * FROM '+table).all());
 }
});
test('combined precheck verifies supplied listing ID, source, VIN, platform/LOT ambiguity before any write',async t=>{
 for(const variant of ['wrong-id','wrong-vin','wrong-provider','ambiguous']){
  const {db,sql,calls}=database(t);
  if(variant==='wrong-vin')sql.exec("UPDATE auction_listings SET vin_normalized='SHHFK7H51JU428898'");
  if(variant==='wrong-provider')sql.exec("UPDATE vehicle_sources SET provider='other'");
  if(variant==='ambiguous')sql.exec(`INSERT INTO auction_listings(listing_id,source_key,platform,identity_state,vin_normalized,lot,first_seen_at,last_seen_at,created_at,updated_at)
   SELECT 'another','source',platform,identity_state,vin_normalized,lot,first_seen_at,last_seen_at,created_at,updated_at FROM auction_listings`);
  await assert.rejects(importTargetedHistory(db,{...input([event()]),expected:{
   ...expected,listingId:variant==='wrong-id'?'wrong':'listing'}}),/TARGETED_HISTORY_LISTING_MISMATCH/);
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'batch');
  assert.ok(calls[0].statements.every(statement=>/^SELECT/.test(statement.sql)));
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM provider_sync_scopes').get().n,0);
 }
});
test('combined precheck detects a globally conflicting event ID even when attached to another listing',async t=>{
 const {db,sql,calls}=database(t),request={...input([event()]),expected:{...expected,listingId:'listing'}};
 await importTargetedHistory(db,request);
 sql.exec(`INSERT INTO auction_listings(listing_id,source_key,platform,identity_state,vin_normalized,lot,first_seen_at,last_seen_at,created_at,updated_at)
  SELECT 'another','source',platform,identity_state,vin_normalized,'99999999',first_seen_at,last_seen_at,created_at,updated_at FROM auction_listings`);
 sql.exec("UPDATE auction_events SET listing_id='another',lot='99999999'");
 const before=JSON.stringify(sql.prepare('SELECT * FROM auction_events').all());calls.length=0;
 await assert.rejects(importTargetedHistory(db,request),/TARGETED_HISTORY_EVENT_CONFLICT/);
 assert.equal(calls.length,1);assert.ok(calls[0].statements.every(statement=>/^SELECT/.test(statement.sql)));
 assert.equal(JSON.stringify(sql.prepare('SELECT * FROM auction_events').all()),before);
 assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('malformed combined precheck results fail closed before any write',async t=>{
 const changes=[
  results=>undefined,results=>results.slice(1),
  results=>{results[0].success=false;return results;},
  results=>{results[1].results=null;return results;},
  results=>{results[1].results=[{event_id:'unexpected-global-id'}];return results;}
 ];
 for(const changeResults of changes){
  const {db,sql,calls}=database(t,{changeResults});
  await assert.rejects(importTargetedHistory(db,{...input([event()]),expected:{...expected,listingId:'listing'}}),
   /TARGETED_HISTORY_PRECHECK_FAILED/);
  assert.equal(calls.length,1);assert.ok(calls[0].statements.every(statement=>/^SELECT/.test(statement.sql)));
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM provider_sync_scopes').get().n,0);
 }
});
test('combined prechecks retain 100-parameter chunks and the 245/249-event write boundary',async t=>{
 for(const count of [0,201,245,249]){
  const {db,sql,calls}=database(t);
  await importTargetedHistory(db,{...input(Array.from({length:count},(_,i)=>event(i+1))),
   expected:{...expected,listingId:'listing'}});
  const precheck=calls[0];
  assert.equal(precheck.kind,'batch');assert.ok(precheck.statements.every(statement=>/^SELECT/.test(statement.sql)));
  assert.deepEqual(precheck.statements.slice(1).map(statement=>statement.params.length),
   count===0?[]:count===201?[100,100,1]:count===245?[100,100,45]:[100,100,49]);
  const writes=calls[1];
  assert.equal(writes.kind,'batch');
  assert.equal(writes.statements.length,count===0?2:count===201?206:250);
  if(count===249)assert.deepEqual(calls.slice(2).map(call=>call.params.length),[100,100,49,1]);
  else assert.equal(calls.length,2);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,count);
 }
});
