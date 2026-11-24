'use strict';
const {createHash}=require('node:crypto');
const {buildPublicCatalogMerge}=require('./public-catalog-merge.cjs');
const {buildPublicHistoryTransfer}=require('./public-history-transfer.cjs');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function preparePublicationData(source,target){
 if(source.target!=='staging'||target.target!=='publication'||source.fk.length||target.fk.length)throw Error('PUBLICATION_CAPTURE_TARGET');
 const delta=buildPublicCatalogMerge({tables:source.tables,columns:source.columns,existingTables:target.tables,existingColumns:target.columns,capturedAt:source.at,deltaOnly:true});
 const extras=buildPublicHistoryTransfer({listings:source.tables.auction_listings,receipts:source.receipts,health:source.health});
 const catalog=[],events=new Map(),seen=new Set();
 for(const group of delta.groups)for(const item of group.statements){
  const hash=sha(item);if(seen.has(hash))continue;seen.add(hash);
  if(item.table==='auction_events'){const id=item.params[item.columns.indexOf('listing_id')];if(!events.has(id))events.set(id,[]);events.get(id).push(item);}
  else catalog.push(item);
 }
 const groups=[];
 const add=(kind,items)=>{for(let i=0;i<items.length;i+=100){const statements=items.slice(i,i+100);groups.push({kind,statements,sha256:sha(statements)});}};
 add('catalog',catalog);
 const beforeHealth=new Map((target.health||[]).map(x=>[x.source_key,x]));
 add('freshness',extras.healthStatements.filter(s=>{const r=beforeHealth.get(s.params[3]);return !r||r.last_attempt_at!==s.params[0]||r.last_success_at!==s.params[1]||r.last_error_code!==s.params[2];}));
 const receipts=new Map(extras.receiptStatements.map(x=>[x.listingId,x]));
 for(const [id,items]of events){add('events',items);if(receipts.has(id)){add('receipt',[receipts.get(id)]);receipts.delete(id);}}
 for(const receipt of receipts.values())add('receipt',[receipt]);
 const ordered=groups.flatMap(x=>x.statements),batches=[];
 for(let i=0;i<ordered.length;i+=100){const statements=ordered.slice(i,i+100);batches.push({statements,sha256:sha(statements)});}
 return {groups:batches,manifest:{...delta.manifest,format:'rexbid-publication-delta-v2',group_count:batches.length,statement_count:ordered.length,plan_sha256:sha(batches),receipts:source.receipts.length,provider_requests:0,private_data:false}};
}
module.exports={preparePublicationData};
