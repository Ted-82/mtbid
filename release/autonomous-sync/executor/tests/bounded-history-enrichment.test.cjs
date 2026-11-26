'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {HistoryBudget,enrichHistoryTarget,buildHistoryReadSpec}=require('../scripts/bounded-history-enrichment.cjs');
const {parseHistoryPage,importTargetedHistory,resolveHistoryTarget,HISTORY_RECEIPT_SQL}=require('../scripts/targeted-history-import.cjs');
const {buildRequestUrl}=require('../providers/apibara.js');
const {connectD1,TARGETS}=require('../scripts/d1-operator-bridge.cjs');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const expected={platform:'copart',lot:'57660876',vin:'5YJ3E1EA3PF683202'};
function page(events=[],next=null){return {ok:true,data:{vehicle:{...expected,lot_number:expected.lot},history:events},meta:{next_cursor:next}};}
function event(day=1,status='Sold on Approval'){return {platform:expected.platform,lot_number:expected.lot,date:'2026-09-'+String(day).padStart(2,'0'),price:5000,status};}
function included(events=[]){return {ok:true,data:{...expected,lot_number:expected.lot,history:events}};}
function setup(t,maxAttempts=100){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rex-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const base=path.join(dir,'base.ndjson');fs.writeFileSync(base,Array.from({length:59},()=>'{"kind":"attempt"}').join('\n'));
 const budget=new HistoryBudget({directory:dir,baseAttempts:59,baseLedgers:[base],maxAttempts});
 const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals/0004_d1_sync_2.sql'),'utf8'));
 sql.prepare("INSERT INTO vehicle_sources(source_key,provider,platform,identity_kind,identity_state,first_seen_at,last_seen_at,created_at,updated_at) VALUES('s','apibara','copart','provider_vehicle_id','resolved','2026-01-01','2026-01-01','2026-01-01','2026-01-01')").run();
 sql.prepare("INSERT INTO auction_listings(listing_id,source_key,platform,identity_state,vin_normalized,lot,first_seen_at,last_seen_at,created_at,updated_at) VALUES('l','s','copart','resolved',?,?,'2026-01-01','2026-01-01','2026-01-01','2026-01-01')").run(expected.vin,expected.lot);
 const db={prepare(query){const methods=params=>({sql:query,params,async all(){return {results:sql.prepare(query).all(...params)};},async first(){return sql.prepare(query).get(...params)||null;}});return {...methods([]),bind(...params){return methods(params);}};},async batch(items){sql.exec('BEGIN');try{const results=items.map(x=>/^\s*SELECT\b/i.test(x.sql)?{results:sql.prepare(x.sql).all(...x.params)}:{results:[],meta:{changes:Number(sql.prepare(x.sql).run(...x.params).changes)}});sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 t.after(()=>sql.close());return {dir,base,budget,db,sql};
}
test('documented include history is opt-in; usage and history cursor URLs are exact',()=>{
 assert.equal(buildRequestUrl({operation:'vehicleByIdentifier',identifier:expected.lot,include:'history'}).searchParams.get('include'),'history');
 assert.equal(buildRequestUrl({operation:'apiUsage'}).pathname,'/api/v1/vehicle-auction/usage');
 assert.throws(()=>buildRequestUrl({operation:'vehicleByIdentifier',identifier:expected.lot,include:'anything'}),e=>e.code==='INVALID_REQUEST');
 assert.equal(buildRequestUrl({operation:'vehicleHistory',identifier:expected.lot,cursor:'opaque/+='}).searchParams.get('cursor'),'opaque/+=');
});
test('history transport uses the known VIN rather than a potentially colliding numeric LOT on either platform',()=>{
 for(const platform of ['copart','iaai']){
  const target={...expected,platform,lot:'45692906'};
  const spec=buildHistoryReadSpec(target);
  assert.equal(spec.identifier,expected.vin);assert.equal(spec.platform,platform);
  const url=buildRequestUrl(spec);assert.ok(url.pathname.endsWith('/'+expected.vin));
  assert.equal(url.searchParams.get('include'),'history');assert.equal(url.searchParams.has('platform'),false);
  const history=buildHistoryReadSpec(target,{mode:'paginated',cursor:'opaque-next'});
  assert.equal(buildRequestUrl(history).searchParams.get('cursor'),'opaque-next');
 }
 assert.throws(()=>buildHistoryReadSpec({...expected,vin:null}),/INVALID_INPUT/);
});
test('a same-number LOT from the other platform is rejected before persistence, and blocks further transport',async t=>{
 const {budget,db,sql}=setup(t);let calls=0;
 const response=included([event()]);response.data.platform='iaai';response.data.vin='SHHFK7H51JU428898';
 await assert.rejects(enrichHistoryTarget({db,expected,budget,fetchPage:async(_target,{requestSpec})=>{
  calls++;assert.equal(requestSpec.identifier,expected.vin);return response;
 }}),/IDENTITY_MISMATCH/);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM provider_sync_scopes').get().n,0);
 await assert.rejects(budget.request({operation:'history',target:'iaai:other'},async()=>{calls++;}),/UNCOMMITTED_ATTEMPT/);
 assert.equal(calls,1);assert.equal(budget.attempts().length,1);
});
test('included retained history verifies identity, supports empty and limits itself to the exact listing',()=>{
 const parsed=parseHistoryPage(included([event(),{...event(2),platform:'iaai',lot_number:'98765432'}]),expected,{mode:'included'});
 assert.equal(parsed.records.length,1);assert.equal(parsed.excluded,1);assert.equal(parsed.complete,false);
 assert.equal(parseHistoryPage(included(),expected,{mode:'included'}).complete,true);
 const unidentified=parseHistoryPage(included([{date:'2026-09-01',price:2000,status:'Sold'}]),expected,{mode:'included'});
 assert.equal(unidentified.records.length,0);assert.equal(unidentified.complete,false);assert.equal(unidentified.excluded,1);
 assert.throws(()=>parseHistoryPage({...included(),data:{...included().data,vin:'OTHER'}},expected,{mode:'included'}),/IDENTITY/);
 assert.throws(()=>parseHistoryPage(included([{...event(),vin:'OTHER'}]),expected,{mode:'included'}),/IDENTITY/);
 assert.throws(()=>parseHistoryPage({ok:false,data:{...included().data}},expected,{mode:'included'}),/ENVELOPE/);
 assert.throws(()=>parseHistoryPage({ok:true,data:{...expected,lot_number:expected.lot}},expected,{mode:'included'}),/ENVELOPE/);
});
test('bounded paginated import commits each page, keeps offer semantics and resumes without duplicate transport',async t=>{
 const {budget,db,sql}=setup(t),before=JSON.stringify(sql.prepare('SELECT * FROM auction_listings').all());let calls=0;
 const run=()=>enrichHistoryTarget({db,expected,budget,mode:'paginated',fetchPage:async(_e,{cursor})=>{calls++;return cursor?page([event(1),event(2,'Sold')]):page([event(1)],'cursor2');}});
 const result=await run();assert.equal(result.complete,true);assert.equal(calls,2);assert.equal((await run()).skipped,true);assert.equal(calls,2);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,2);
 assert.equal(sql.prepare("SELECT final_price_usd FROM auction_events WHERE source_status='Sold on Approval'").get().final_price_usd,null);
 assert.equal(sql.prepare("SELECT final_price_usd FROM auction_events WHERE source_status='Sold'").get().final_price_usd,5000);
 assert.equal(JSON.stringify(sql.prepare('SELECT * FROM auction_listings').all()),before);
 assert.equal(budget.records().filter(x=>x.kind==='commit').length,2);
});
test('completed empty is persisted; partial empty and missing pagination metadata never imply complete',async t=>{
 // Both observations need a fixed chronological order, independent of today's date.
 const {budget,db}=setup(t);await enrichHistoryTarget({db,expected,budget,fetchPage:async()=>included(),now:()=> '2026-10-09T11:00:00Z'});
 let availability=await new D1ReadRepository(db).getHistoryAvailability({listingId:'l'});assert.equal(availability.state,'fetched_empty');assert.equal(availability.complete,true);
 const partial=page([],'next');await importTargetedHistory(db,{response:partial,expected,observedAt:'2026-10-09T12:00:00Z'});
 availability=await new D1ReadRepository(db).getHistoryAvailability({listingId:'l'});assert.equal(availability.complete,false);assert.equal(availability.state,'partial');
 delete partial.meta;assert.equal(parseHistoryPage(partial,expected).complete,false);
});
test('page cap persists partial cursor and continuation completes from the committed cursor',async t=>{
 const {budget,db}=setup(t);const cursors=[];let calls=0;
 const fetchPage=async(_e,{cursor})=>{cursors.push(cursor);calls++;return page([event(calls)],calls===3?null:'p'+calls);};
 const first=await enrichHistoryTarget({db,expected,budget,mode:'paginated',maxPages:2,fetchPage});assert.equal(first.complete,false);assert.equal(first.nextCursor,'p2');
 const next=await enrichHistoryTarget({db,expected,budget,mode:'paginated',maxPages:2,fetchPage});assert.equal(next.complete,true);assert.deepEqual(cursors,[null,'p1','p2']);
});
test('budget counts failures, usage and resume against the original 59; no automatic retries',async t=>{
 const {budget,dir,base}=setup(t,2);await budget.request({operation:'usage'},async()=>({}));let calls=0;
 await assert.rejects(budget.request({operation:'usage'},async()=>{calls++;throw Object.assign(Error('safe'),{code:'TIMEOUT',status:504});}),/safe/);
 const resumed=new HistoryBudget({directory:dir,baseAttempts:59,baseLedgers:[base],maxAttempts:2});assert.equal(resumed.attempts().length,2);assert.equal(resumed.attempts()[1].combined,61);
 await assert.rejects(resumed.request({operation:'usage'},async()=>{calls++;}),/BUDGET_EXHAUSTED/);assert.equal(calls,1);
 assert.throws(()=>new HistoryBudget({directory:dir,baseAttempts:59,baseLedgers:[base],maxAttempts:100}),/RESUME_MISMATCH/);
});
test('identity and failed persistence stop safe resume without restamping existing history or claiming empty',async t=>{
 const {budget,db,sql}=setup(t);sql.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON provider_sync_scopes BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 await assert.rejects(enrichHistoryTarget({db,expected,budget,fetchPage:async()=>included([event()])}),/fixture failure/);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM provider_sync_scopes').get().n,0);
 await assert.rejects(enrichHistoryTarget({db,expected,budget,fetchPage:async()=>{throw Error('must not fetch');}}),/UNCOMMITTED_ATTEMPT/);
});
test('staging receipt capability only permits the fixed SQL with bound history identity; no discovery/accounts writes',async()=>{
 let requests=0;const transport=async()=>({ok:true,status:200,json:async()=>requests++===0?{success:true,result:{uuid:TARGETS.staging.id,name:TARGETS.staging.name}}:{success:true,result:[{success:true,results:[]}]}});
 const db=await connectD1({target:'staging',token:'offline',fetchImpl:transport,historyReceipts:true,writeBudget:{beforeWrite:async()=>({}),complete(){}}});
 const params=['history-import:l','apibara','copart','complete',null,'2026-10-08','2026-10-08','2026-10-08','2026-10-08'];
 await assert.rejects(db.batch([{sql:HISTORY_RECEIPT_SQL,params:['discovery:l',...params.slice(1)]}]),/WRITE_NOT_ALLOWED/);
 await db.batch([{sql:HISTORY_RECEIPT_SQL,params}]);
 for(const q of ['DELETE FROM provider_sync_scopes','UPDATE provider_sync_scopes SET status=\'complete\'','DELETE FROM users'])assert.throws(()=>db.prepare(q),/WRITE_NOT_ALLOWED/);
 const readonly=await connectD1({target:'staging',token:'offline',historyReceipts:true,readOnly:true,fetchImpl:async()=>({ok:true,status:200,json:async()=>({success:true,result:{uuid:TARGETS.staging.id,name:TARGETS.staging.name}})})});
 assert.throws(()=>readonly.prepare(HISTORY_RECEIPT_SQL),/WRITE_NOT_ALLOWED/);
});
test('null previous success receipt can be repaired atomically and replay is idempotent',async t=>{
 const {db,sql}=setup(t);sql.exec("INSERT INTO provider_sync_scopes(scope_key,provider,platform,operation,status,updated_at) VALUES('history-import:l','apibara','copart','history_refresh','partial','2026-01-01')");
 const input={response:included([event(3,'Not Sold')]),expected,mode:'included',observedAt:'2026-10-08T18:00:00Z'};await importTargetedHistory(db,input);await importTargetedHistory(db,input);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM auction_events').get().n,1);assert.equal(sql.prepare('SELECT final_price_usd FROM auction_events').get().final_price_usd,null);
 assert.equal(sql.prepare('SELECT last_complete_at FROM provider_sync_scopes').get().last_complete_at,input.observedAt.replace('Z','.000Z'));
});
test('history target resolves exact VIN or LOT within its platform and rejects ambiguous or incomplete identities',async t=>{
 const {db,sql}=setup(t);
 for(const identifier of [expected.lot,expected.vin,expected.vin.toLowerCase()])assert.deepEqual(await resolveHistoryTarget(db,{identifier,platform:'copart'}),{...expected,listingId:'l'});
 await assert.rejects(resolveHistoryTarget(db,{identifier:expected.lot,platform:'iaai'}),/LISTING_MISMATCH/);
 sql.prepare("INSERT INTO auction_listings(listing_id,source_key,platform,identity_state,vin_normalized,lot,first_seen_at,last_seen_at,created_at,updated_at) VALUES('l2','s','copart','resolved',?,'99999999','2026-01-01','2026-01-01','2026-01-01','2026-01-01')").run(expected.vin);
 await assert.rejects(resolveHistoryTarget(db,{identifier:expected.vin,platform:'copart'}),/LISTING_MISMATCH/);
 assert.equal((await resolveHistoryTarget(db,{identifier:expected.lot,platform:'copart'})).listingId,'l');
});
test('included pagination metadata is respected; an empty partial envelope cannot become an empty complete history',()=>{
 const response=included();response.data.history={data:[],meta:{next_cursor:'opaque-next'}};
 const partial=parseHistoryPage(response,expected,{mode:'included'});assert.equal(partial.complete,false);assert.equal(partial.nextCursor,'opaque-next');
 delete response.data.history.meta;assert.equal(parseHistoryPage(response,expected,{mode:'included'}).complete,false);
 response.data.history.meta={next_cursor:null};assert.equal(parseHistoryPage(response,expected,{mode:'included'}).complete,true);
 response.data.history.meta={next_cursor:''};assert.equal(parseHistoryPage(response,expected,{mode:'included'}).nextCursor,null);
});
test('a rejected identity cannot mutate existing confirmed events or silently continue to another target',async t=>{
 const {budget,db,sql}=setup(t);
 await importTargetedHistory(db,{response:included([event(5,'Sold')]),expected,mode:'included',observedAt:'2026-10-08T10:00:00Z'});
 const before=JSON.stringify(sql.prepare('SELECT * FROM auction_events').all());let calls=0;
 await assert.rejects(enrichHistoryTarget({db,expected,budget,fetchPage:async()=>{calls++;return {...included([event()]),data:{...included([event()]).data,lot_number:'11111111'}};}}),/IDENTITY_MISMATCH/);
 assert.equal(JSON.stringify(sql.prepare('SELECT * FROM auction_events').all()),before);
 await assert.rejects(budget.request({operation:'history',target:'iaai:22222222'},async()=>{calls++;}),/UNCOMMITTED_ATTEMPT/);
 assert.equal(calls,1);
});
