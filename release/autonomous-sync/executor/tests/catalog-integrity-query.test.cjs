const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {RECEIPT_IDENTITY_SQL}=require('../scripts/catalog-integrity-queries.cjs');
const old=RECEIPT_IDENTITY_SQL.replace("l.listing_id=substr(p.scope_key,16)\n   AND ",'');
test('receipt audit preserves exact mismatch detection and uses indexed listing lookup',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE vehicle_sources(source_key TEXT PRIMARY KEY,provider TEXT); CREATE TABLE auction_listings(listing_id TEXT PRIMARY KEY,source_key TEXT,platform TEXT); CREATE TABLE provider_sync_scopes(scope_key TEXT,operation TEXT,platform TEXT,provider TEXT);');
  db.prepare('INSERT INTO vehicle_sources VALUES(?,?)').run('apibara:copart','apibara');
  const listing=db.prepare('INSERT INTO auction_listings VALUES(?,?,?)'),receipt=db.prepare('INSERT INTO provider_sync_scopes VALUES(?,?,?,?)');
  for(let i=0;i<3000;i++){listing.run('listing:'+i,'apibara:copart','copart');receipt.run('history-import:listing:'+i,'history_refresh','copart','apibara');}
  for(const key of ['HISTORY-IMPORT:listing:0','history-import:missing','history-import:','history-import:listing:0 ','history-import:listing:0\n'])receipt.run(key,'history_refresh','copart','apibara');
  receipt.run('history-import:listing:1','history_refresh','iaai','apibara');receipt.run('history-import:listing:2','history_refresh','copart','other');
  receipt.run(null,'history_refresh','copart','apibara');receipt.run('history-import:listing:3','discovery','wrong','wrong');
  assert.equal(db.prepare(old).get().n,7);assert.equal(db.prepare(RECEIPT_IDENTITY_SQL).get().n,7);
  const plan=db.prepare('EXPLAIN QUERY PLAN '+RECEIPT_IDENTITY_SQL).all().map(r=>r.detail).join('\n');
  assert.match(plan,/SEARCH l USING INDEX .*\(listing_id=\?\)/);assert.doesNotMatch(plan,/SCAN l\b/);
 }finally{db.close();}
});
