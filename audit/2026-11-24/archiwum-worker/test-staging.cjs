'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),z=require('node:zlib'),assert=require('node:assert/strict');
const {Miniflare,convertV4MiniflareOptions,Log,LogLevel}=require('miniflare'),esbuild=require('esbuild');
const base=__dirname,mode=process.argv[3]||'genuine';
let src=path.resolve(process.argv[2]||path.join(base,'src'));
if(process.argv[2]==='--baseline'){
  src=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'rexbid-archive-baseline-'));
  fs.cpSync(path.join(base,'src'),src,{recursive:true});
  fs.copyFileSync(path.join(base,'wersja-odniesienia/auction-archive-intake.cjs'),path.join(src,'sync/auction-archive-intake.cjs'));
  for(const [file,expected] of Object.entries(require('./pochodzenie.json').productionDependencies)){
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(src,file))).digest('hex'),expected,file);
  }
}
const publication=mode==='synthetic'?17245:9987,vin='3KPF24AD6RE719531';
const h=val=>crypto.createHash('sha256').update(val).digest('hex');
const jpg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIAP/9k=','base64');
function sale(sequence,time,price,previous){return {sequence,terminal:true,event:'lot.sold',reason:'source_outcome',
 vehicle:{platform:'copart',lot_number:'59807226',vin},recorded_at:'2026-11-17T11:58:20Z',before:{'auction.lot_sold':previous},
 after:{'auction.lot_sold':true,'auction.last_sold_status':'Sold','auction.last_sold_day':'2026-11-17','auction.last_sold_at':time,'pricing.last_sold_price_usd':price}};}
async function main(){
 const real=require('./przyklad-9987.json');const records=mode==='synthetic'?[sale(10,'2026-11-17T09:00:00Z',null,false),sale(11,'2026-11-17T10:00:00Z',3200,false),sale(12,'2026-11-17T10:00:00+01:00',2200,true)]:real;
 const zip=mode==='full'?fs.readFileSync(process.argv[5]):z.gzipSync(records.map(x=>JSON.stringify(x)).join('\n')+'\n');
 if(mode==='full')assert.equal(h(zip),require('./pochodzenie.json').rawFixtureSha256);
 const sequences=mode==='full'?z.gunzipSync(zip).toString('utf8').trim().split('\n').map(l=>JSON.parse(l).sequence):records.map(e=>e.sequence);
 const shim={name:'worker-node-zlib',setup(build){build.onResolve({filter:/^node:zlib$/},args=>args.kind==='require-call'?{path:'node:zlib',namespace:'shim'}:{path:'node:zlib',external:true});build.onLoad({filter:/.*/,namespace:'shim'},()=>({contents:"import zlib from 'node:zlib'; module.exports=zlib;",loader:'js'}));}};
 const bundle=await esbuild.build({stdin:{contents:fs.readFileSync(path.join(base,'staging.mjs'),'utf8'),resolveDir:src,sourcefile:'staging.mjs'},write:false,bundle:true,format:'esm',target:'es2022',plugins:[shim]});
 let imageRequests=0,unexpected=0;
 const compatibilityDate=process.env.REXBID_TEST_PROD_COMPAT==='yes'?'2026-11-17':'2026-10-01';
 const flags=process.env.REXBID_TEST_PROD_COMPAT==='yes'?[]:['nodejs_compat'];
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,log:new Log(LogLevel.ERROR),cf:false,workers:[{name:'archive-staging',modules:true,script:bundle.outputFiles[0].text,
   compatibilityDate,compatibilityFlags:flags,bindings:{ARCHIVE_ENABLED:'yes'},d1Databases:['REXBID_ARCHIVE_CATALOG'],
   r2Buckets:['REXBID_AUCTION_ARCHIVE','REXBID_ARCHIVE_FEED'],
   outboundService:async request=>{if(/^https:\/\/cs\.copart\.com\/v1\/AUTH_svc\.pdoc00001\/test\d+\.jpg$/.test(request.url)){imageRequests++;return new Response(jpg,{headers:{'Content-Type':'image/jpeg'}});}unexpected++;return new Response(null,{status:403});}}]}));
 try{
 const db=await mf.getD1Database('REXBID_ARCHIVE_CATALOG'),target=await mf.getR2Bucket('REXBID_AUCTION_ARCHIVE'),from=await mf.getR2Bucket('REXBID_ARCHIVE_FEED');
 await db.exec("CREATE TABLE server_feed_generations(generation_id INTEGER PRIMARY KEY,raw_key TEXT,compressed_bytes INTEGER,sha256 TEXT,first_sequence INTEGER,last_sequence INTEGER,status TEXT,retired_at TEXT,archive_bytes INTEGER);");
 await db.exec("CREATE TABLE auction_listings(platform TEXT,lot TEXT,vin_normalized TEXT,year INTEGER,vehicle_title TEXT,media_urls_json TEXT,first_seen_at TEXT,last_seen_at TEXT,source_listing_id TEXT,auction_state TEXT);");
 await db.exec("CREATE INDEX idx_listings_lot_recent ON auction_listings(platform,lot);");
 await db.prepare("INSERT INTO server_feed_generations VALUES (?,?,?,?,?,?,'complete',NULL,0)").bind(publication,'sample.gz',zip.length,h(zip),Math.min(...sequences),Math.max(...sequences)).run();
 const seen=new Set(),years='JKLMNPRST';
 for(const e of records){const v=e.vehicle;if(seen.has(v.lot_number))continue;seen.add(v.lot_number);
   const year=mode==='synthetic'?2018:2018+years.indexOf(v.vin[9]);
   await db.prepare("INSERT INTO auction_listings VALUES(?,?,?,?,?,?,?,?,?,'ended')").bind(v.platform,v.lot_number,v.vin,year,'Pojazd do testu',JSON.stringify([1,2].map(n=>'https://cs.copart.com/v1/AUTH_svc.pdoc00001/test'+n+'.jpg')),'2026-11-01T00:00:00Z',e.recorded_at,v.lot_number).run();}
 await target.put('v1/public/index.json',JSON.stringify({version:1,entries:[],generation:publication-1,offset:0}));
 await from.put('sample.gz',zip);
 let rawReads=0,index;const passes=[];
 for(let n=0;n<40;n++){
  const started=performance.now(),resp=await mf.dispatchFetch('http://archive.local/tick');assert.equal(resp.status,200);const q=await resp.json();rawReads+=q.sourceReads;
  index=await(await target.get('v1/public/index.json')).json();
  passes.push({galleries:index.entries.length,offset:index.offset??0,generation:index.generation??0,reads:q.sourceReads,rootGetBytes:q.rootGetBytes,rootPutBytes:q.rootPutBytes,targetReads:q.targetReads,targetWrites:q.targetWrites,largestRoot:q.largestRoot,elapsedMs:Math.round(performance.now()-started)});
  if(index.generation===publication&&index.offset===0)break;
 }
 assert.equal(index.generation,publication);assert.equal(index.offset,0);assert.equal(unexpected,0);
 const lastVin=mode==='synthetic'?vin:real.at(-1).vehicle.vin,publicData=await(await mf.dispatchFetch('http://archive.local/api/archiwum?q='+lastVin)).json();assert.ok(publicData.entries?.length);
 for(const e of publicData.entries){const r=await mf.dispatchFetch('http://archive.local'+e.photos[0]);assert.equal(r.status,200);assert.equal(h(Buffer.from(await r.arrayBuffer())),h(jpg));}
 if(mode!=='synthetic'){assert.equal(index.entries.length,real.length);for(const source of real){const e=index.entries.find(x=>x.sequence===source.sequence);assert.equal(e.vin,source.vehicle.vin);assert.equal(e.saleCents,Math.round(source.after['pricing.last_sold_price_usd']*100));assert.equal(e.photos.length,2);}}
 else assert.deepEqual(publicData.entries.map(e=>[e.sequence,e.saleCents]),[[11,320000],[10,220000]]);
 const quick=await mf.dispatchFetch('http://archive.local/tick');const idle=await quick.json();assert.equal(idle.sourceReads,0);
 const sum=k=>passes.reduce((s,p)=>s+p[k],0);
 const report={mode,at:new Date().toISOString(),runtime:require('miniflare/package.json').version,engine:'workerd',compatibilityDate,flags,sourceRows:sequences.length,realEvents:mode==='synthetic'?0:sequences.length,syntheticEvents:mode==='synthetic'?records.length:0,
   rawReads,rawObjectTransferBytes:rawReads*zip.length,sampleGzipBytes:zip.length,galleries:index.entries.length,verifiedGalleriesAndPrices:mode!=='synthetic'?real.length:publicData.entries.length,simulatedSourceJpegRequests:imageRequests,unexpectedOutboundRequests:unexpected,lookupPhotoBytesVerified:true,completed:true,idleReads:idle.sourceReads,
   rootGetBytes:sum('rootGetBytes'),rootPutBytes:sum('rootPutBytes'),targetReads:sum('targetReads'),targetWrites:sum('targetWrites'),maxRootBytes:Math.max(...passes.map(p=>p.largestRoot)),measuredMetadataBytes:sum('rootGetBytes')+sum('rootPutBytes')+rawReads*zip.length,passes};
 if(process.argv[4])fs.writeFileSync(process.argv[4],JSON.stringify(report,null,2)+'\n');
 console.log('REXBID_STAGING_RESULT '+JSON.stringify(report));
 }finally{await mf.dispose();}
}
main().catch(e=>{console.error(e.stack,e.cause?.message??'');process.exitCode=1;});
