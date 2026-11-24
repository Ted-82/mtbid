'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),assert=require('node:assert/strict');
const {Miniflare,convertV4MiniflareOptions,Log,LogLevel}=require('miniflare'),esbuild=require('esbuild');
const event=require('./iaai-118801774.json'),{updateEvidence}=require('../executor/sync/timed-bid-evidence.cjs');
const {normalize,KEY}=require('../../public-site/sync/timed-iaai-refresh.cjs');
const explicitDeadline='2026-11-24T23:59:00.000Z',observed='2026-11-24T20:01:32.326Z';
const lot=event.vehicle.lot_number,vin=event.vehicle.vin;
const seed={platform:'iaai',is_timed:1,auction_state:'open',vin_normalized:vin,timed_end_at:explicitDeadline,listing_generation:null,timed_bid_evidence:null};
const raw={platform:'iaai',vin,lot_number:lot,title:'2018 AUDI S5',year:2018,manufacturer:'Audi',model:'S5',auction:{state:'open',is_timed:true,timed_end_at:explicitDeadline},pricing:{current_bid_usd:event.before['pricing.current_bid_usd']},media:{}};
async function main(){
 const nodeImports={name:'worker-node-imports',setup(build){
   build.onResolve({filter:/^node:/},args=>args.kind==='require-call'?{path:args.path,namespace:'worker-node-import'}:{path:args.path,external:true});
   build.onLoad({filter:/.*/,namespace:'worker-node-import'},args=>({contents:"import builtin from '"+args.path+"'; module.exports=builtin;"}));
 }};
 const build=await esbuild.build({entryPoints:[path.join(__dirname,'local-worker.mjs')],write:false,bundle:true,format:'esm',target:'es2022',plugins:[nodeImports]});
 let externalRequests=0;
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,log:new Log(LogLevel.ERROR),cf:false,workers:[{
  name:'timed-staging',modules:true,script:build.outputFiles[0].text,compatibilityDate:'2026-11-17',compatibilityFlags:['nodejs_compat'],
  bindings:{REXBID_TIMED_IAAI_ENABLED:'enabled'},d1Databases:['REXBID_ACTIVE_CATALOG'],r2Buckets:['REXBID_AUCTION_ARCHIVE'],
  outboundService:async()=>{externalRequests++;return new Response(null,{status:403});}
 }]}));
 const results=[];
 try{
 const db=await mf.getD1Database('REXBID_ACTIVE_CATALOG'),bucket=await mf.getR2Bucket('REXBID_AUCTION_ARCHIVE');
 await db.exec('CREATE TABLE auction_listings(platform TEXT,lot TEXT,vin_normalized TEXT,listing_generation INTEGER,current_bid_usd REAL,is_timed INTEGER,auction_state TEXT,timed_end_at TEXT,timed_bid_evidence TEXT,last_seen_at TEXT);');
 await db.exec('CREATE INDEX idx_listings_lot_recent ON auction_listings(platform,lot,last_seen_at DESC);');
 const tmpl=normalize(raw,Date.parse(observed));
 await bucket.put(KEY,z.gzipSync(JSON.stringify({schema:1,observed,entries:[tmpl]})),{customMetadata:{observed}});
 const prior=await mf.dispatchFetch('http://local.test/api/car/'+vin+'?platform=iaai');assert.equal((await prior.json()).data.pricing.current_bid_usd,8000);
 const proof=updateEvidence(seed,{eventType:event.event,vin,sequence:event.sequence,recordedAt:event.recorded_at,vehicleUpdatedAt:event.vehicle_updated_at},
 {assignments:{current_bid_usd:event.after['pricing.current_bid_usd']}},null);
 await db.prepare('INSERT INTO auction_listings VALUES (?,?,?,?,?,?,?,?,?,?)').bind('iaai',lot,vin,null,event.after['pricing.current_bid_usd'],1,'open',explicitDeadline,proof,observed).run();
 const requestURLs=['/api/car/'+vin+'?platform=iaai','/api/car/'+lot+'?platform=iaai','/api/cars?category=timed&sort=bid_desc&price_min=8100','/api/cars?category=timed&view=showcase'];
 const entryPoints=[];
 for(const url of requestURLs){const r=await mf.dispatchFetch('http://local.test'+url);assert.equal(r.status,200);const obj=(await r.json()).data,car=Array.isArray(obj)?obj[0]:obj;
 assert.equal(car.pricing.current_bid_usd,8100);assert.equal(car.pricing.current_bid_observed_at,'2026-11-24T20:07:24.000Z');assert.equal(car.pricing.final_price_usd,null);
 entryPoints.push({url,bid:car.pricing.current_bid_usd,bidAt:car.pricing.current_bid_observed_at,snapshot:car.read.last_synced_at});}
 // The separate capacity scenario populates fictitious IDs in the local database only.
 await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<6000) INSERT INTO auction_listings
 SELECT 'iaai',CAST(80000000+i AS TEXT),?,NULL,8100,1,'open',?,?,? FROM n`).bind(vin,explicitDeadline,proof,observed).run();
 for(const n of [1,24,3405,4769,6000]){const sample=Array.from({length:n},(_,i)=>String(80000001+i)),data=JSON.stringify(sample);
 const start=performance.now(),resp=await mf.dispatchFetch('http://local.test/measure',{method:'POST',body:data});
 const measurement=await resp.json();assert.equal(measurement.rows,n);results.push({lots:n,paramBytes:Buffer.byteLength(data),resultBytes:measurement.bytes,rowsRead:measurement.meta.rows_read,rowsWritten:measurement.meta.rows_written,elapsedMs:Math.round(performance.now()-start)});}
 assert.equal(externalRequests,0);const out={testedAt:new Date(),entryPoints,evidenceBytes:Buffer.byteLength(proof),measurements:results,externalRequests};fs.writeFileSync(process.argv[2],JSON.stringify(out,null,2));console.log(JSON.stringify(out));
 }finally{await mf.dispose();}
}main().catch(e=>{console.error(e.stack,e.cause?.message||'');process.exitCode=1;});
