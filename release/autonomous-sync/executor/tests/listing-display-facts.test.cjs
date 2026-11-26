'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {createApibaraProvider}=require('../providers/apibara.js');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {applyFeedRecordHydration}=require('../sync/feed-record-hydration.cjs');
const {canonicalVehicle,toPublicVehicleDTO}=require('../sync/d1-read-repository.js');
const {requestHistory}=require('../sync/history-request.cjs');
const {enrichRequestedHistory}=require('../sync/feed-history-enrichment.cjs');
const NOW='2026-11-24T17:10:00.000Z';
const freshnessPolicy={hotIntervalMs:3600000,warmIntervalMs:86400000,coldIntervalMs:604800000,hotWindowMs:3600000};
const examples=[
  {platform:'copart',lot_number:'46087626',vin:'2C4RDGBG4HR742563',color:'White',name:'PERMIT SALVAGE',source:'PERMIT SALVAGE',raw:'ON - Permit Salvage'},
  {platform:'iaai',lot_number:'44103794',vin:'RLHKF4714PY100644',color:'Gray',name:'REBUILDABLE',source:'REBUILDABLE (Florida)',raw:'REBUILDABLE (Florida)'}
];
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const provider=createApibaraProvider({fetch(){throw Error('NETWORK_FORBIDDEN');}});
function record(sample,n=1) {
  return {platform:sample.platform,lot_number:sample.lot_number,vin:sample.vin,vehicle_id:sample.lot_number,
    updated_at:'2026-11-24T17:0'+n+':00.000Z',year:2021,make:'Test',model:'Source facts',
    vehicle_specs:{exterior_color:sample.color},sale_document:{name:sample.name,source_name:sample.source,raw_name:sample.raw,type:'other'},
    auction:{state:'open',auction_at:'2026-11-25T18:00:00Z'},pricing:{current_bid_usd:1200,current_bid2_usd:null,buy_now_usd:null}};
}
function database(t,{migrate=true}={}) {
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  for(const name of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sql.exec(read('docs/proposals/'+name));
  if(migrate)sql.exec(read('docs/proposals/0019_catalog_exterior_color.sql'));
  const db={prepare(q){function bound(params){return{q,params,async all(){return {results:sql.prepare(q).all(...params)};},
    async first(){return sql.prepare(q).get(...params)||null;},async run(){return {meta:{changes:Number(sql.prepare(q).run(...params).changes)}};}};}
    return{...bound([]),bind:(...params)=>bound(params)};},
    async batch(items){sql.exec('BEGIN IMMEDIATE');try {
      const result=items.map(s=>/^\s*SELECT/i.test(s.q)
        ?{success:true,results:sql.prepare(s.q).all(...s.params)}
        :{success:true,results:[],meta:{changes:Number(sql.prepare(s.q).run(...s.params).changes)}});
      sql.exec('COMMIT');return result;
    } catch(e){sql.exec('ROLLBACK');throw e;}}};
  const store=new RefreshStore(db,'display-facts-test',()=>Date.parse(NOW));return{db,sql,store};
}
async function ingest(h,records,part=0){
  const groups=records.map((raw,i)=>({platform:raw.platform,lot:raw.lot_number,quarantinedSequences:[],
    events:[{event:'lot.created',sequence:1+i+part*10,event_id:'test-'+part+'-'+i,terminal:false,
      vehicle:{platform:raw.platform,lot_number:raw.lot_number,vin:raw.vin},
      changed_fields:['lot.created'],before:[],after:{'vehicle.make':raw.make},record:raw,
      recorded_at:raw.updated_at,vehicle_updated_at:raw.updated_at}]}));
  return applyFeedRecordHydration({db:h.db,store:h.store,provider,groups,observedAt:NOW,
    receiptKey:'file-hydration:'+'d'.repeat(64)+':0:'+part,freshnessPolicy});
}
const row=(h,sample)=>h.sql.prepare('SELECT * FROM auction_listings WHERE platform=? AND lot=?').get(sample.platform,sample.lot_number);
function cardFacts(dto){
  const html=read('public/car.html');
  const start=html.indexOf('  function getTitleDocument()'),end=html.indexOf('  function platformClass()',start);
  assert.ok(start>0&&end>start);
  assert.match(html,/field\("Kolor",getExteriorColor\(\), "color"\)/);
  assert.match(html,/const titleDoc = getTitleDocument\(\)/);
  const c={car:dto,first:(...args)=>args.find(x=>x!=null&&x!==''),getInfo:()=>null,getSale:()=>null,valueFrom:()=>null,
    isEmpty:x=>x==null||x==='',displayValue:x=>x};vm.createContext(c);
  vm.runInContext(html.slice(start,end)+';globalThis.selected = [getTitleDocument(),getExteriorColor()]',c);
  return [...c.selected];
}
test('normal feed stores both platforms and the detail template reads both confirmed facts; sparse updates and replay preserve them',async t=>{
  const h=database(t);await h.store.acquire();
  const records=examples.map(s=>record(s));const first=await ingest(h,records);assert.equal(first.inserted,2);
  assert.equal((await ingest(h,records)).alreadyApplied,true);
  for(const s of examples){
    const r=row(h,s),dto=toPublicVehicleDTO(canonicalVehicle(r));
    assert.equal(r.exterior_color,s.color);assert.equal(r.document_name,s.source);
    assert.deepEqual(cardFacts(dto),[s.source,s.color]);
    assert.deepEqual(cardFacts({sale_document:{source_name:'ST',name:s.source},vehicle_specs:{exterior_color:s.color}}),[s.source,s.color]);
  }
  const sparse=examples.map((s,i)=>{const r=record(s,2);r.vehicle_specs.exterior_color=i?'Unknown':null;r.sale_document={name:i?'N/A':'  '};return r;});
  assert.equal((await ingest(h,sparse,1)).updated,2);
  for(const s of examples){const r=row(h,s);assert.equal(r.exterior_color,s.color);assert.equal(r.document_name,s.source);}
});
test('new writer continues to ingest with the old D1 schema; migration and backup restore keep the exact saved values',async t=>{
  const h=database(t,{migrate:false});await h.store.acquire();
  assert.equal((await ingest(h,[record(examples[0])])).inserted,1);
  const original=row(h,examples[0]);assert.equal(Object.hasOwn(original,'exterior_color'),false);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rexbid-color-rehearsal-')),file=path.join(dir,'before.sqlite'),restored=path.join(dir,'restored.sqlite');
  t.after(()=>{for(const f of [file,restored])if(fs.existsSync(f))fs.unlinkSync(f);fs.rmdirSync(dir);});
  h.sql.prepare('VACUUM INTO ?').run(file);
  h.sql.exec(read('docs/proposals/0019_catalog_exterior_color.sql'));
  const migrated={...row(h,examples[0])};assert.equal(migrated.exterior_color,null);delete migrated.exterior_color;assert.deepEqual(migrated,{...original});
  fs.copyFileSync(file,restored);
  const backup=new DatabaseSync(restored,{readOnly:true});try {
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(backup.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.deepEqual({...backup.prepare('SELECT * FROM auction_listings').get()},{...original});
    assert.equal(backup.prepare('SELECT count(*) n FROM auction_listing_snapshots').get().n,1);
  }finally{backup.close();}
});
test('existing history enrichment repairs legacy ST from a strictly matched vehicle, without changing its bid or its schedule',async t=>{
  const h=database(t);await h.store.acquire();const s=examples[0],initial=record(s);
  initial.sale_document={name:'ST',type:'other'};initial.vehicle_specs={};await ingest(h,[initial]);
  const before=row(h,s);const id={listing_id:before.listing_id,platform:s.platform,lot:s.lot_number,vin:s.vin,ended:false};
  await requestHistory(h.db,id,null,Date.parse(NOW));
  const upstream=record(s,2);upstream.history=[];
  const result=await enrichRequestedHistory({db:h.db,store:h.store,now:()=>Date.parse(NOW),getRequest:async()=>async spec=>{
    assert.equal(spec.identifier,s.vin);return{response:{ok:true,data:upstream},observedAt:NOW};}});
  assert.equal(result.complete,true,JSON.stringify(result));
  const after=row(h,s);assert.equal(after.document_name,s.source);assert.equal(after.exterior_color,s.color);
  for(const k of Object.keys(before))if(!['document_name','exterior_color'].includes(k))assert.equal(after[k],before[k],k);
});

test('optional schema observation is shared; its failure leaves ordinary publishing available',async()=>{
  const {supportsExteriorColor}=require('../sync/listing-display-facts.cjs');
  let probes=0;
  const unavailable={prepare(){probes++;throw Error('METADATA_UNAVAILABLE');}};
  assert.deepEqual(await Promise.all([supportsExteriorColor(unavailable),supportsExteriorColor(unavailable)]),[false,false]);
  assert.equal(await supportsExteriorColor(unavailable),false);assert.equal(probes,1);
});
