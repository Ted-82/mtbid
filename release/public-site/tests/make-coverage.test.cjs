'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const {D1ReadRepository}=require('../sync/d1-read-repository');
const {knownObservationStatements,D1SyncRepository}=require('../sync/d1-repository');
const {prepareObservation}=require('../sync/publication-refresh.cjs');
const {createApibaraProvider}=require('../providers/apibara');
const NOW='2026-10-09T13:00:00.000Z';
async function seeded(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(require.resolve('../docs/proposals/0004_d1_sync_2.sql'),'utf8'));
  const db={prepare(sql){const bound=(params=[])=>({sql,params,bind(...next){return bound(next)},async first(){return sqlite.prepare(sql).get(...params)||null},async all(){return {results:sqlite.prepare(sql).all(...params)}}});return bound()},async batch(items){sqlite.exec('BEGIN');try{for(const item of items)sqlite.prepare(item.sql).run(...item.params);sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}}};
  const provider=createApibaraProvider({fetch:()=>{throw Error('NETWORK_FORBIDDEN')}});
  const names=['LUCID','LUCID MOTORS','LUCIDITY','FISKER AUTOMOTIVE','MCLAREN AUTOMOTIVE','MERCEDES BENZ'];
  for(let i=0;i<names.length;i++){
    const raw={platform:i%2?'copart':'iaai',lot_number:String(10000000+i),vin:'5YJ3E1EA4NF186754',title:names[i]+' TEST',make:names[i],model:'TEST',year:2026,auction:{state:'open',is_timed:false,auction_at:'2026-10-10T13:00:00Z'},pricing:{current_bid_usd:0},vehicle_specs:{fuel_type:'Electric'}};
    const prepared=await prepareObservation({repo:new D1SyncRepository(db),provider,raw,platform:raw.platform,observedAt:NOW,processedAt:NOW,freshnessPolicy:{hotIntervalMs:300000,warmIntervalMs:21600000,coldIntervalMs:604800000,hotWindowMs:7200000}});
    await db.batch((await knownObservationStatements(db,prepared.record)).statements);
  }
  const repo=new D1ReadRepository(db,{now:()=>Date.parse(NOW)});repo.getCoverage=async()=>({complete:false});return{sqlite,repo};
}
test('make search joins explicit source aliases without prefix matches or changing identity',async()=>{
  const {sqlite,repo}=await seeded();try{
    for(const make of ['Lucid','LUCID MOTORS']){
      const r=await repo.listCatalog({make});assert.equal(r.records.length,2);
      assert.deepEqual(r.records.map(x=>x.vehicle.lot).sort(),['10000000','10000001']);
    }
    for(const make of ['Fisker','McLaren','Mercedes-Benz'])assert.equal((await repo.listCatalog({make})).records.length,1);
    assert.equal((await repo.listCatalog({make:'Lucidity'})).records.length,1);
    assert.equal((await repo.listCatalog({search:'10000001'})).records.length,1);
  }finally{sqlite.close()}
});
test('make/model controls use the same alias family while source names remain intact',async()=>{
  const {sqlite,repo}=await seeded();try{
    const m=await repo.getFilterMetadata();
    assert.equal(m.values.makes.filter(x=>x.value==='LUCID').length,1);
    assert.equal(m.values.makes.some(x=>x.value==='LUCID MOTORS'),false);
    assert.equal(m.values.models.filter(x=>x.make==='LUCID'&&x.model==='TEST').length,1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auction_listings WHERE make='LUCID MOTORS'").get().n,1);
    assert.equal(m.read.known_rows_only,true);
  }finally{sqlite.close()}
});
