'use strict';
// A local Workers runtime and isolated D1. No Cloudflare credentials or bindings are read.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const [workerRoot,siteRoot,toolchain]=process.argv.slice(2).map(p=>path.resolve(p));
const {Miniflare}=require(path.join(toolchain,'miniflare')),esbuild=require(path.join(toolchain,'esbuild'));
const {planInventoryChangeGroup}=require(path.join(workerRoot,'sync/inventory-change-group.cjs'));
const {extendSparseRecovery,repairSparseCatalog}=require(path.join(workerRoot,'sync/feed-sparse-repair.cjs'));
const {RefreshStore}=require(path.join(workerRoot,'sync/automatic-refresh.cjs'));
const {canonicalPlan,digest}=require(path.join(workerRoot,'sync/feed-bootstrap-membership.cjs'));
const {createApibaraProvider}=require(path.join(workerRoot,'providers/apibara.js'));
const extended=process.argv[5]==='extended';
const input=extended?require('./DAKOTA-KOPIA-ROZSZERZENIE.json'):require('./DAKOTA-KOPIA-DANE.json'),routes=input.routes||require('./DAKOTA-KOPIA-TOZSAMOSC.json');
const ident=x=>x.row?{lot:x.row.lot,platform:x.row.platform,vin:x.row.vin_normalized}:x.identity;
const later=extended?require('./DAKOTA-KOPIA-POZNIEJSZE.json'):[];
const names=['45833848','65917836','46162902'];
const source=extended?input.records:input.records.filter(r=>names.includes(ident(r).lot));assert.equal(source.length,extended?13:3);const seedCount=source.filter(x=>x.row).length;
const time=Date.parse(source.map(x=>x.observedAt).sort().at(-1));
const target=path.join(__dirname,extended?'DAKOTA-KOPIA-ROZSZERZENIE-WYNIK.json':'DAKOTA-KOPIA-WYNIK.json'), report={startedAt:new Date(),localRuntime:'workerd / Miniflare D1',environment:'local transport and source-response replay',simulatedPolls:true,sourceGeneration:input.generation,observations:[],calls:[],poll:[],searches:[],passed:false};
const save=()=>fs.writeFileSync(target,JSON.stringify(report,null,2));
async function main(){
 const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 report.code={recovery:sha(path.join(workerRoot,'sync/feed-sparse-repair.cjs')),eligibility:sha(path.join(workerRoot,'sync/feed-copart-relist.cjs')),reader:sha(path.join(siteRoot,'staging/d1-primary-reads.cjs')),miniflare:require(path.join(toolchain,'miniflare/package.json')).version};
 const build=esbuild.buildSync({stdin:{contents:"import reads from './staging/d1-primary-reads.cjs'; globalThis.fetch=()=>{throw Error('offline test has no upstream')}; export default {fetch(request,env){return reads.handleStoredRead(request,env)}}",resolveDir:siteRoot,loader:'js'},bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],target:'es2022',write:false,banner:{js:"import * as zlib from 'node:zlib'; import * as crypto from 'node:crypto'; const require=(id)=>{if(id==='node:zlib')return zlib;if(id==='node:crypto')return crypto;throw Error('Unknown builtin '+id);};"},external:['node:*']});
 const constants={REXBID_CATALOG_MEMBERSHIP_ENABLED:'enabled',REXBID_PUBLIC_CATALOG_MODE:'stored',REXBID_RELEASE_D1_TARGET:'rexbid-production-preflight-db',REXBID_RELEASE_D1_DATABASE_ID:'c8a30088-70af-43a6-9a7f-c4018279d37d'};
 const worker=new Miniflare({cf:false,workers:[{config:{name:'catalog-local',compatibilityDate:'2025-03-01',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'handler.mjs',modules:{'handler.mjs':{type:'esm',contents:build.outputFiles[0].text}}},env:{REXBID_DB:{type:'d1',id:'local-copy'},...Object.fromEntries(Object.entries(constants).map(([k,value])=>[k,{type:'text',value}]))}}}]});
 try{
 const db=await worker.getD1Database('REXBID_DB');
 const schema=new DatabaseSync(':memory:');
 try{for(const f of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0009_public_catalog_read_indexes.sql','0011_d1_server_feed.sql','0013_identifier_read_indexes.sql','0014_feed_catalog_membership.sql'])schema.exec(fs.readFileSync(path.join(siteRoot,'docs/proposals',f),'utf8'));
 const statements=schema.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(row=>db.prepare(row.sql));for(let i=0;i<statements.length;i+=40)await db.batch(statements.slice(i,i+40));
 }finally{schema.close();}
 async function insert(table,record){const names=Object.keys(record);return db.prepare('INSERT INTO '+table+'('+names.join(',')+') VALUES('+names.map(()=>'?').join(',')+')').bind(...Object.values(record)).run();}
 // The initial D1 is populated exclusively with source preimages that were already inactive in production.
 for(const x of source.filter(x=>x.row)){const row=x.row;
 await insert('vehicle_sources',{source_key:row.source_key,provider:'apibara',platform:row.platform,identity_state:row.identity_state,first_seen_at:row.last_seen_at,last_seen_at:row.last_seen_at,created_at:row.updated_at,updated_at:row.updated_at});
 await insert('auction_listings',{...row,first_seen_at:row.last_seen_at,created_at:row.updated_at});}
 const plan=canonicalPlan({version:1,baselineId:'local-proof',scope:'production',capture:{sequence:75639067,capturedAt:'2026-11-08T09:00:00.000Z',responseSha256:'a'.repeat(64)},snapshot:{generationId:10733,sha256:'b'.repeat(64),records:seedCount,requestStartedAt:'2026-11-08T09:28:33.000Z',observedAt:'2026-11-08T09:48:56.000Z',generatedAtKnown:false,generatedAt:null},sourceEvidence:{kind:'provider-checkpoint',sha256:'c'.repeat(64),replayStartSequence:75639067,snapshotSha256:'b'.repeat(64)}});
 const committed=119000000,stamp=new Date(time).toISOString();
 const state={version:1,status:'ready',offset:seedCount,resolved:seedCount,excluded:0,unresolved:0,deltaUnresolved:0,reviewedUnresolved:0,reviewSha256:null,replayVerified:true,replaySequence:committed,pendingDelta:null};
 await insert('feed_catalog_baselines',{baseline_id:plan.baselineId,plan_sha256:digest(plan),plan_json:JSON.stringify(plan),checkpoint_json:JSON.stringify(state),created_at:stamp,updated_at:stamp});
 await insert('feed_catalog_pointer',{singleton:1,baseline_id:plan.baselineId,revision:1,updated_at:stamp});
 for(const x of source.filter(x=>x.member&&x.row))await insert('feed_catalog_membership',{baseline_id:plan.baselineId,listing_id:x.row.listing_id,active:x.member.active,last_sequence:x.member.last_sequence});
 await insert('automatic_refresh_state',{singleton:1});await insert('server_feed_state',{singleton:1,committed_sequence:committed,seed_evidence_json:'{}',updated_at:stamp});
 for(const [g,f,l,when,sha] of [...[input,...later].map(packet=>[packet.generation,packet.first,packet.last,packet.observedAt,packet.sha256]),[999999,committed-5000,committed,stamp,'c'.repeat(64)]])await insert('server_feed_generations',{generation_id:g,first_sequence:f,last_sequence:l,sha256:sha,raw_key:'isolated',compressed_bytes:1,status:'complete',observed_at:when,created_at:when,updated_at:when});
 const search=async phase=>{for(const x of source){const r=await worker.dispatchFetch('https://rexbid.pl/api/cars?view=cards&per_page=20&s='+ident(x).vin);const body=await r.json();report.searches.push({phase,lot:ident(x).lot,code:r.status,error:body.error||null,cause:body.read?.fallback_reason,source:body.meta?.read_source,rows:Array.isArray(body.data)?body.data.map(y=>({platform:y.platform,vin:y.vin,lot:y.lot_number,date:y.auction?.auction_at,amount:y.pricing?.buy_now_usd})):null});save();assert.equal(r.status,200);assert.equal(body.meta?.read_source,'d1');assert(Array.isArray(body.data));}};
 await search('before');
 let clock=time;
 async function enqueue(packet=input){const store=new RefreshStore(db,'capture-copy',()=>clock);await store.acquire();try{await store.initializeBudgets({daily:60,monthly:200,newPerDay:16});const groups=[],decisions=[];for(const x of (packet===input?source:packet.records)){const id=ident(x);const row=(await db.prepare("SELECT l.*,s.platform AS source_platform,s.provider,s.identity_state AS source_identity_state FROM auction_listings l JOIN vehicle_sources s USING(source_key) WHERE l.listing_id=?").bind('listing|apibara|'+id.platform+'|source|'+id.lot).first());const group={platform:id.platform,lot:id.lot,events:x.events,quarantinedSequences:[]};groups.push(group);
 const planned=planInventoryChangeGroup({row,events:group.events,quarantinedSequences:[],observedAt:packet.observedAt});decisions.push({platform:id.platform,lot:id.lot,queued:planned.requiresDetail,identityError:planned.identityError,reasons:planned.reasons});
 }const ext=extendSparseRecovery({prepare:async()=>[]},{generationId:packet.generation,observedAt:packet.observedAt});const statements=await ext.prepare({store,db,receipt:{groups},decisions});if(statements.length)await store.guarded(statements);report.observations.push({generation:packet.generation,decisions,statements:statements.length});}finally{await require(path.join(workerRoot,'sync/feed-owned-lease-release.cjs')).releaseOwnedLease({db,owner:store.owner});}}
 await enqueue();
 async function poll(){const store=new RefreshStore(db,'idle-copy',()=>clock);await store.acquire();try{const result=await repairSparseCatalog({db,store,relistOnly:true,now:()=>clock,adapter:createApibaraProvider(),getRequest:async()=>async spec=>{const x=source.find(v=>ident(v).lot===spec.identifier||ident(v).vin===spec.identifier);assert(x);const route=routes.find(v=>v.expected===ident(x).lot).response[spec.identifier===ident(x).vin?'vin':'lot'];report.calls.push({identifier:spec.identifier,platform:spec.platform,matched:route.matched});return {response:{data:route.matched?x.raw:{platform:route.platform,lot_number:route.lot,vin:route.vin}},observedAt:new Date(clock).toISOString()};}});report.poll.push(result);}finally{await require(path.join(workerRoot,'sync/feed-owned-lease-release.cjs')).releaseOwnedLease({db,owner:store.owner});}}
 for(let i=0;i<source.length;i++){await poll();clock+=extended?1000:15*60000;}
 if(extended){await search('after23248');for(const packet of later){await enqueue(packet);for(let n=0;n<source.length;n++){await poll();clock+=1000;if(report.poll.at(-1)===null)break;}}}
 const tasks=async()=>JSON.stringify((await db.prepare("SELECT task_key,status,cursor,next_due_at,last_attempt_at,last_success_at FROM automatic_refresh_tasks ORDER BY task_key").all()).results);
 await search('after');const beforeReplay=await tasks(),callsBefore=report.calls.length;await enqueue();for(const packet of later)await enqueue(packet);await poll();await search('replay');
 report.replayPreservedTasks=(await tasks())===beforeReplay;report.replayExtraCalls=report.calls.length-callsBefore;assert.equal(report.replayPreservedTasks,true);assert.equal(report.replayExtraCalls,0);
 const cursor=await db.prepare('SELECT committed_sequence FROM server_feed_state WHERE singleton=1').first();assert.equal(cursor.committed_sequence,committed);report.feedCursorPreserved=true;
 for(const phase of ['before','after','replay']){const batch=report.searches.filter(r=>r.phase===phase);assert.equal(batch.length,source.length);for(const r of batch){const x=source.find(x=>ident(x).lot===r.lot);
 const expected=phase==='before'||x.raw.auction.state==='finished'?0:1;assert.equal(r.rows.length,expected,'wrong result '+phase+' '+r.lot);
 if(expected){assert.equal(r.rows[0].platform,ident(x).platform);assert.equal(r.rows[0].vin,x.raw.vin);assert.equal(r.rows[0].lot,ident(x).lot);assert.equal(Date.parse(r.rows[0].date),Date.parse(x.raw.auction.auction_at));}}}
 assert(report.poll.slice(-1)[0]===null);report.passed=true;
 }finally{save();await worker.dispose();}}
main().catch(e=>{report.error=e.message;save();console.error(e.stack.slice(0,2000));process.exitCode=1;});
