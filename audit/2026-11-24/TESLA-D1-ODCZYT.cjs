'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const [workerRoot,siteRoot,tools]=process.argv.slice(2).map(p=>path.resolve(p));
const {Miniflare}=require(path.join(tools,'miniflare')),esbuild=require(path.join(tools,'esbuild'));
const {data,init,run,schemas}=require(path.join(workerRoot,'tests/fixtures/known-bid-harness.cjs'));
const {canonicalPlan,digest}=require(path.join(workerRoot,'sync/feed-bootstrap-membership.cjs'));
const {RefreshStore}=require(path.join(workerRoot,'sync/automatic-refresh.cjs'));
const at=Date.parse(data.at);
const report={runtime:require(path.join(tools,'miniflare/package.json')).version,method:'Lokalny workerd + D1; rzeczywisty kod czytnika i wykonawcy. Uwierzytelniony transport źródła odtwarza zachowane pola, bez ruchu zewnętrznego.',start:new Date(),scenarios:[],hash:createHash('sha256').update(fs.readFileSync(path.join(workerRoot,'sync/feed-known-bid.cjs'))).digest('hex')};
const target=path.join(__dirname,'TESLA-D1-ODCZYT-WYNIK.json');
const save=()=>fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
const config=['0009_public_catalog_read_indexes.sql','0010_inventory_source_index.sql','0013_identifier_read_indexes.sql','0019_catalog_exterior_color.sql'];
function meter(db){
 let rows=[];
 function log(sql,mode,m){
   if(!Number.isSafeInteger(m.rows_read)||!Number.isSafeInteger(m.rows_written))throw Error('Missing local D1 real row counters');
   rows.push({mode,sql:sql.replace(/\s+/g,' ').slice(0,110),r:m.rows_read,w:m.rows_written});
 }
 const prepare=(sql,stmt=db.prepare(sql))=>({inner:stmt,sql,bind:(...p)=>prepare(sql,stmt.bind(...p)),
  async run(){const r=await stmt.run();log(sql,'run',r.meta);return r;},
  async all(){const r=await stmt.all();log(sql,'all',r.meta);return r;},
  async first(key){const r=await stmt.all();log(sql,'first',r.meta);const row=r.results[0]??null;return key&&row?row[key]:row;}});
 const wrapped={prepare,async batch(a){const rs=await db.batch(a.map(s=>s.inner));rs.forEach((v,i)=>log(a[i].sql,'batch',v.meta));return rs;}};
 return {wrapped,reset(){rows=[];},total(){return {statements:rows.length,rowsRead:rows.reduce((n,r)=>n+r.r,0),rowsWritten:rows.reduce((n,r)=>n+r.w,0),detail:rows.slice()};}};
}
async function schema(db){
 const sql=new DatabaseSync(':memory:');
 try{
  for(const name of [...new Set([...schemas,...config])].sort())sql.exec(fs.readFileSync(path.join(workerRoot,'docs/proposals',name),'utf8'));
  const objects=sql.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  const statements=objects.map(o=>db.prepare(o.sql));
  for(let i=0;i<statements.length;i+=40)await db.batch(statements.slice(i,i+40));
  for(const obj of objects.filter(o=>o.type==='table')){
    for(const row of sql.prepare('SELECT * FROM '+obj.name).all()){
     const keys=Object.keys(row);
     await db.prepare('INSERT INTO '+obj.name+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();
    }
  }
  report.schemas=[...new Set([...schemas,...config])].sort();report.indexes=objects.filter(o=>o.type==='index').map(o=>o.name);
 }finally{sql.close();}
}
async function verifiedPointer(db){
 const plan=canonicalPlan({version:1,baselineId:'isolated',scope:'production',capture:{sequence:75639067,capturedAt:'2026-11-08T09:00:00.000Z',responseSha256:'a'.repeat(64)},snapshot:{generationId:10733,sha256:'b'.repeat(64),records:1,requestStartedAt:'2026-11-08T09:28:33.000Z',observedAt:'2026-11-08T09:48:56.000Z',generatedAtKnown:false,generatedAt:null},sourceEvidence:{kind:'provider-checkpoint',sha256:'c'.repeat(64),replayStartSequence:75639067,snapshotSha256:'b'.repeat(64)}});
 const ck={version:1,status:'ready',offset:1,resolved:1,excluded:0,unresolved:0,deltaUnresolved:0,reviewedUnresolved:0,reviewSha256:null,replayVerified:true,replaySequence:118796735,pendingDelta:null};
 await db.prepare('UPDATE feed_catalog_baselines SET plan_json=?,checkpoint_json=?,plan_sha256=? WHERE baseline_id=?').bind(JSON.stringify(plan),JSON.stringify(ck),digest(plan),'isolated').run();
 await db.prepare("UPDATE feed_catalog_pointer SET revision=1 WHERE singleton=1").run();
}
const build=esbuild.buildSync({stdin:{contents:"import reads from './staging/d1-primary-reads.cjs';globalThis.fetch=()=>{throw Error('offline test has no upstream')};export default {fetch(r,env){return reads.handleStoredRead(r,env)}}",resolveDir:siteRoot,loader:'js'},bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],target:'es2022',write:false,banner:{js:"import * as zlib from 'node:zlib';import * as crypto from 'node:crypto';const require=id=>{if(id==='node:zlib')return zlib;if(id==='node:crypto')return crypto;throw Error('Unknown builtin '+id);};"},external:['node:*']});
async function scenario(id){
 const r={id,steps:{},publicReads:[]};report.scenarios.push(r);save();
 const vars={REXBID_CATALOG_MEMBERSHIP_ENABLED:'enabled',REXBID_PUBLIC_CATALOG_MODE:'stored',REXBID_RELEASE_D1_TARGET:'rexbid-production-preflight-db',REXBID_RELEASE_D1_DATABASE_ID:'c8a30088-70af-43a6-9a7f-c4018279d37d'};
 const worker=new Miniflare({cf:false,workers:[{config:{name:'tesla-local',compatibilityDate:'2025-03-01',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'handler.mjs',modules:{'handler.mjs':{type:'esm',contents:build.outputFiles[0].text}}},env:{REXBID_DB:{type:'d1',id:'local-tesla'},...Object.fromEntries(Object.entries(vars).map(([k,value])=>[k,{type:'text',value}]))}}}]});
 try{
  const db=await worker.getD1Database('REXBID_DB');await schema(db);
  const met=meter(db),args=await init(met.wrapped,at);await verifiedPointer(db);
  if(id.startsWith('fresh-warm')){
   await args.store.initializeBudgets({daily:500,monthly:12000,newPerDay:2000});
   if(id==='fresh-warm-new-store')args.store=new RefreshStore(met.wrapped,args.store.owner,()=>at);
  }
  let calls=0;
  const fetchImpl=async url=>{calls++;assert.ok(String(url).includes(data.row.lot));return Response.json({ok:true,data:data.raw});};
  async function publicRead(phase){
   for(const [kind,route] of [['detail','/api/car/'+data.row.lot+'?platform=copart'],['search','/api/cars?view=cards&per_page=20&s='+data.row.vin_normalized],['history','/api/car/'+data.row.lot+'/history?platform=copart']]){
    const response=await worker.dispatchFetch('https://rexbid.pl'+route),b=await response.json();
    const card=kind==='detail'?b.data:kind==='search'?b.data?.[0]:null,snaps=b.rex_history?.snapshots??[];
    r.publicReads.push({phase,kind,code:response.status,error:b.error??null,path:route,rootKeys:kind==='history'?Object.keys(b):undefined,dataType:kind==='history'?Object.keys(b.data||{}).slice(0,12):undefined,vin:card?.vin,lot:card?.lot_number,current:card?.pricing?.current_bid_usd??null,final:card?.pricing?.final_price_usd??null,
     snapshot:card?.read?.last_synced_at??null,bidObserved:card?.pricing?.current_bid_observed_at??null,bidSource:card?.pricing?.current_bid_source??null,snapshots:snaps.map(s=>({kind:s.kind,price:s.current_bid_usd,at:s.observed_at}))});
   }
   save();
  }
  await publicRead('before');
  const metrics=async(label,f)=>{met.reset();const prev=calls;const v=await f();r.steps[label]={result:v??null,api:calls-prev,...met.total()};save();return v};
  if(id==='paid'){
   await metrics('alreadyPaidCall',async()=>{const call=await args.buildRequest({...args,fetchImpl});await call({operation:'vehicleByIdentifier',platform:'copart',identifier:data.row.lot});});
  }
  const done=await metrics('maintenance',()=>run(args,fetchImpl));assert.equal(done?.saved,true);
  await publicRead('after');
  const snapshot=await db.prepare("SELECT observed_at,current_bid_usd,fingerprint FROM auction_listing_snapshots WHERE listing_id=?").bind(data.row.listing_id).all();
  r.snapshots=snapshot.results;
  r.feed=await db.prepare('SELECT committed_sequence FROM server_feed_state WHERE singleton=1').first();
  r.finalDb=await db.prepare('SELECT current_bid_usd,final_price_usd,summary_synced_at FROM auction_listings WHERE listing_id=?').bind(data.row.listing_id).first();
  await metrics('repeat',()=>run(args,fetchImpl));
  assert.equal(calls,1);assert.equal(r.snapshots.length,1);assert.equal(r.snapshots[0].observed_at,data.at);assert.equal(r.snapshots[0].current_bid_usd,70);assert.equal(r.finalDb.current_bid_usd,70);assert.equal(r.finalDb.final_price_usd,null);assert.equal(r.finalDb.summary_synced_at,data.row.summary_synced_at);assert.equal(r.feed.committed_sequence,118796735);
  for(const o of r.publicReads.filter(x=>x.kind!=='history')){assert.equal(o.code,200,JSON.stringify(o));assert.equal(o.lot,data.row.lot,JSON.stringify(o));assert.equal(o.current,o.phase==='after'?70:null,JSON.stringify(o));assert.equal(o.final,null);}
  const history=r.publicReads.filter(x=>x.kind==='history');
  assert.equal(history[0].snapshots.length,0);
  assert.equal(history[1].code,200);
  assert.deepEqual(history[1].snapshots,[{kind:'observed_snapshot',price:70,at:data.at}]);
  r.pass=true;save();
 }finally{await worker.dispose();}
}
(async()=>{for(const scenarioId of ['paid','fresh-cold','fresh-warm-new-store','fresh-warm-reused-store'])await scenario(scenarioId);report.passed=true;save();console.log(JSON.stringify(report.scenarios.map(s=>[s.id,Object.entries(s.steps).map(([k,v])=>[k,v.api,v.rowsRead,v.rowsWritten])])));})().catch(err=>{report.error=err.stack.slice(0,2400);save();console.error(report.error);process.exitCode=1;});
