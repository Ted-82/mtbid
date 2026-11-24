'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {prepareInventoryChangePatch}=require('../sync/inventory-change-patch.cjs');
const {planInventoryChangeGroup}=require('../sync/inventory-change-group.cjs');
const {parseChangesResponse,createApibaraProvider}=require('../providers/apibara.js');
const {RefreshStore}=require('../sync/automatic-refresh.cjs');
const {applyFeedRecordHydration,selectFeedRecordHydration}=require('../sync/feed-record-hydration.cjs');
const {importChangeBatch,hashReceipt}=require('../sync/feed-change-import.cjs');
const AT='2026-11-04T20:00:00.000Z',OLD='2026-11-03T12:00:00.000Z',UPDATED='2026-11-04T19:00:00.000Z',VIN='1HGCM82633A004352',LOT='10000001';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function row(price=null){return {listing_id:'listing-one',source_key:'source-one',platform:'copart',lot:LOT,vin_normalized:VIN,identity_state:'resolved',
 source_updated_at:OLD,summary_synced_at:OLD,detail_synced_at:OLD,last_seen_at:OLD,updated_at:OLD,auction_state:'open',source_status:'Open',auction_at:null,is_timed:0,timed_end_at:null,current_bid_usd:price,current_bid2_usd:750,buy_now_usd:2500};}
function event(sequence,price,extra={}){return {sequence,event_id:'raw-change-'+sequence,event:'bid.changed',terminal:false,vehicle:{platform:'copart',lot_number:LOT,vin:VIN},
 changed_fields:['pricing.current_bid_usd'],before:{'pricing.current_bid_usd':sequence%2?null:0},after:{'pricing.current_bid_usd':price},recorded_at:UPDATED,vehicle_updated_at:UPDATED,...extra};}
function partial(raw,previous){const change=parseChangesResponse({ok:true,data:[raw],meta:{after:0,next_cursor:raw.sequence,has_more:false,count:1,ordering:'sequence_asc',schema_version:'test',retention_days:14}},{after:0,limit:1}).events[0];return prepareInventoryChangePatch({row:previous,change,observedAt:AT});}
test('primary zero/unavailable normalizes only its assignment; positive clears and null noise no-op without mutating raw proof',()=>{
 for(const previous of [null,0,1250])for(const incoming of [null,0,777.25]){const raw=event(1,incoming,{before:{'pricing.current_bid_usd':previous}}),copy=structuredClone(raw),p=partial(raw,row(previous)),expected=incoming===0?null:incoming;
  assert.deepEqual(raw,copy);assert.equal(p.sequence,1);assert.equal(p.eventId,raw.event_id);assert.equal(p.requiresDetail,false);
  if(previous===expected){assert.equal(p.status,'ignored');assert.equal(p.reason,'no_material_change');assert.equal(p.statement,null);assert.deepEqual(p.assignments,{});}
  else{assert.equal(p.status,'patch');assert.deepEqual(p.assignments,{current_bid_usd:expected});assert.ok(p.statement);assert.equal(p.baseline.current_bid_usd,previous);}
 }
});
test('full original group/event order and net-state folding remain unchanged while null/zero noise stops canonical writes',()=>{
 const raw=[event(1,0),event(2,null),event(3,0)],copy=structuredClone(raw),p=planInventoryChangeGroup({row:row(),events:raw,observedAt:AT});
 assert.equal(p.eventCount,3);assert.equal(p.firstSequence,1);assert.equal(p.lastSequence,3);assert.equal(p.ignored,3);assert.equal(p.statement,null);assert.deepEqual(p.assignments,{});assert.deepEqual(raw,copy);
 const clearing=planInventoryChangeGroup({row:row(1000),events:[event(1,0,{before:{'pricing.current_bid_usd':1000}}),event(2,null)],observedAt:AT});assert.deepEqual(clearing.assignments,{current_bid_usd:null});assert.equal(clearing.patches,1);assert.equal(clearing.ignored,1);
 const net=planInventoryChangeGroup({row:row(),events:[event(1,0),event(2,250),event(3,0,{before:{'pricing.current_bid_usd':250}})],observedAt:AT});assert.equal(net.statement,null);assert.deepEqual(net.assignments,{});assert.ok(net.match);assert.equal(net.patches,2);
});
test('other price zeroes and unsupported detail signals retain their separate meanings',()=>{
 const raw=event(1,0,{changed_fields:['pricing.current_bid_usd','pricing.current_bid2_usd','pricing.buy_now_usd','details.color'],before:{},after:{'pricing.current_bid_usd':0,'pricing.current_bid2_usd':0,'pricing.buy_now_usd':0,'details.color':'Red'}}),p=partial(raw,row());
 assert.deepEqual(p.assignments,{current_bid2_usd:0,buy_now_usd:0});assert.equal(p.requiresDetail,true);assert.deepEqual(p.unsupportedFields,['details.color']);assert.equal(p.ignoredFields.includes('pricing.current_bid_usd'),false);
 const rawEvent=event(1,0),change=parseChangesResponse({ok:true,data:[rawEvent],meta:{after:0,next_cursor:1,has_more:false,count:1,ordering:'sequence_asc',schema_version:'test',retention_days:14}},{after:0,limit:1}).events[0];
 for(const invalid of ['0',-1,NaN,{},[]])assert.throws(()=>prepareInventoryChangePatch({row:row(),change:{...change,after:{'pricing.current_bid_usd':invalid}},observedAt:AT}),/INVALID/);
});
test('clearing a positive primary uses the existing exact original-row CAS and preserves unrelated facts/timestamps',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const previous=row(1400),numeric=new Set(['is_timed','current_bid_usd','current_bid2_usd','buy_now_usd']);
 db.exec('CREATE TABLE auction_listings('+Object.keys(previous).map(k=>k+' '+(numeric.has(k)?'REAL':'TEXT')).join(',')+'); CREATE TABLE vehicle_sources(source_key TEXT,provider TEXT,platform TEXT)');
 db.prepare('INSERT INTO auction_listings VALUES('+Object.keys(previous).map(()=>'?').join(',')+')').run(...Object.values(previous));db.prepare('INSERT INTO vehicle_sources VALUES(?,?,?)').run(previous.source_key,'apibara','copart');
 const p=partial(event(1,0,{before:{'pricing.current_bid_usd':1400}}),previous);assert.equal(db.prepare(p.statement.sql).run(...p.statement.params).changes,1);assert.deepEqual({...db.prepare('SELECT * FROM auction_listings').get()},{...previous,current_bid_usd:null});assert.equal(db.prepare(p.statement.sql).run(...p.statement.params).changes,0);
});
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/apibara-discovery-page-shape.json'),'utf8')).response.data[0];
const provider=createApibaraProvider({fetch:async()=>assert.fail('network forbidden')});
const policy={hotIntervalMs:3600000,warmIntervalMs:86400000,coldIntervalMs:604800000,hotWindowMs:3600000};
function full(price,secondary=750,updated=UPDATED){const record=structuredClone(fixture);Object.assign(record,{platform:'copart',lot_number:LOT,vin:VIN,vehicle_id:'full-'+LOT,updated_at:updated});record.auction.state='open';record.pricing={current_bid_usd:price,current_bid2_usd:secondary,buy_now_usd:2500};return record;}
function fullGroup(record){return [{platform:'copart',lot:LOT,quarantinedSequences:[],events:[event(1,0,{event:'lot.created',changed_fields:['lot.created'],before:[],after:{'vehicle.make':record.make},record})]}];}
async function database(t){const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());for(const f of ['0004_d1_sync_2.sql','0008_automatic_refresh.sql'])sql.exec(fs.readFileSync(path.join(__dirname,'../docs/proposals',f),'utf8'));
 const calls={batches:0,statements:[]};const db={prepare(text){return{bind(...params){return{sql:text,params,async first(){return sql.prepare(text).get(...params)||null;},async all(){return{results:sql.prepare(text).all(...params)};},async run(){return{meta:{changes:Number(sql.prepare(text).run(...params).changes)}};}};}};},async batch(ss){calls.batches++;calls.statements.push(...ss);sql.exec('BEGIN');try{const results=ss.map(s=>({meta:{changes:Number(sql.prepare(s.sql).run(...s.params).changes)}}));sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const store=new RefreshStore(db,'primary-bid-test',()=>Date.parse(AT));await store.acquire();return{sql,db,store,calls};}
const receiptKey='file-hydration:'+'d'.repeat(64)+':0:0';
const apply=(h,groups,extra={})=>applyFeedRecordHydration({...h,provider,groups,observedAt:AT,receiptKey,freshnessPolicy:policy,...extra});
test('full record canonical boundary clears only primary zero/null and preserves original hashes, raw records and secondary values',async t=>{
 for(const incoming of [0,null,333.25]){const h=await database(t),groups=fullGroup(full(incoming)),copy=structuredClone(groups),selected=selectFeedRecordHydration({groups,observedAt:AT});
  const result=await apply(h,groups),actual=h.sql.prepare('SELECT current_bid_usd,current_bid2_usd,buy_now_usd FROM auction_listings').get();assert.equal(actual.current_bid_usd,incoming===0?null:incoming);assert.equal(actual.current_bid2_usd,750);assert.equal(actual.buy_now_usd,2500);
  assert.deepEqual(groups,copy);assert.equal(selected.candidates[0].record.pricing.current_bid_usd,incoming);assert.deepEqual(result.selected,selected.candidates.map(({record,...metadata})=>metadata));assert.equal(result.inputHash,hash({version:1,receiptKey,observedAt:AT,groups}));
  const marker=JSON.parse(h.sql.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(receiptKey).cursor);assert.equal(marker.inputHash,result.inputHash);assert.equal(marker.result.selected[0].recordSha256,selected.candidates[0].recordSha256);
 }
});
test('newer zero full record clears a saved positive; marker replay never rewrites canonical data or receipt after cutover',async t=>{
 const h=await database(t);await apply(h,fullGroup(full(1000,750,OLD)));const groups=fullGroup(full(0)),nextKey='file-hydration:'+'e'.repeat(64)+':0:0';await apply(h,groups,{receiptKey:nextKey});assert.equal(h.sql.prepare('SELECT current_bid_usd FROM auction_listings').get().current_bid_usd,null);
 const marker=h.sql.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(nextKey).cursor;h.sql.exec('UPDATE auction_listings SET current_bid_usd=0');const batches=h.calls.batches,r=await apply(h,groups,{receiptKey:nextKey});assert.equal(r.alreadyApplied,true);assert.equal(h.calls.batches,batches);assert.equal(h.sql.prepare('SELECT current_bid_usd FROM auction_listings').get().current_bid_usd,0);assert.equal(h.sql.prepare('SELECT cursor FROM automatic_refresh_tasks WHERE task_key=?').get(nextKey).cursor,marker);
});
test('same-version zero and null full records remain different raw source versions for conflict detection',()=>{
 const zero=full(0),missing=full(null),events=[...fullGroup(zero)[0].events,event(2,0,{event:'lot.created',changed_fields:['lot.created'],before:[],after:{},record:missing})],groups=[{platform:'copart',lot:LOT,quarantinedSequences:[],events}],copy=structuredClone(groups),s=selectFeedRecordHydration({groups,observedAt:AT});assert.equal(s.candidates.length,0);assert.ok(s.quarantined[0].reasons.includes('conflicting_record_version'));assert.deepEqual(groups,copy);
});
test('actual no-op importer retains original batch SHA and ordered checkpoint/audit while writing no canonical listing',async t=>{
 const h=await database(t);await apply(h,fullGroup(full(0,750,OLD)));const groups=[{platform:'copart',lot:LOT,quarantinedSequences:[],events:[event(1,0),event(2,null)]}],sources=[{generationId:8750,sha256:'a'.repeat(64),records:2,firstSequence:1,lastSequence:2}];
 const dataset={identity:hash({version:1,sources}),databaseSha256:'b'.repeat(64),sources,records:2,quarantined:0,firstSequence:1,lastSequence:2,uniqueLots:1},input={version:1,dataset,observedAt:AT,offset:0,eventOffset:0,quarantineOffset:0,groups};input.batchSha256=hashReceipt(input);
 const before=structuredClone(input),start=h.calls.statements.length,result=await importChangeBatch({...h,receipt:input,namespace:'server'});
 assert.equal(result.state.updatedGroups,0);assert.equal(result.state.ignoredEvents,2);assert.equal(result.state.groupedEvents,2);assert.equal(result.state.offset,1);assert.equal(result.state.lastSequence,2);assert.equal(result.state.globalCursorEstablished,false);
 assert.equal(h.calls.statements.slice(start).some(s=>s.sql.startsWith('UPDATE auction_listings')),false);assert.deepEqual(input,before);assert.equal(hashReceipt(input),before.batchSha256);
 const batches=h.calls.batches;assert.equal((await importChangeBatch({...h,receipt:input,namespace:'server'})).alreadyApplied,true);assert.equal(h.calls.batches,batches);
});
test('explicit primary zero/null cannot fall back to secondary25; absent-primary provider fallback remains unchanged',async t=>{
 for(const incoming of [0,null]){const h=await database(t);await apply(h,fullGroup(full(incoming,25)));const saved=h.sql.prepare('SELECT current_bid_usd,current_bid2_usd FROM auction_listings').get();assert.equal(saved.current_bid_usd,null);assert.equal(saved.current_bid2_usd,25);}
 const legacy=full(0,25);delete legacy.pricing.current_bid_usd;const normalized=provider.normalizeVehicle(legacy),canonical=provider.toCanonicalVehicle(legacy,normalized);assert.equal(canonical.pricing.current_bid,25);assert.equal(canonical.pricing.current_bid_secondary,25);
 const selected=selectFeedRecordHydration({groups:fullGroup(legacy),observedAt:AT});assert.equal(selected.candidates.length,0);assert.equal(selected.skipped[0].reason,'incomplete_record','strict hydration still requires the original complete volatile-price contract');
});
test('reported Copart59093416 primary1300 survives every explicit empty-to-empty noise pair despite older canonical clocks',()=>{
 for(const before of [null,0])for(const after of [null,0]){const previous={...row(1300),lot:'59093416'},raw=event(1,after,{vehicle:{platform:'copart',lot_number:'59093416',vin:VIN},before:{'pricing.current_bid_usd':before}}),copy=structuredClone(raw),p=partial(raw,previous);
  assert.equal(p.status,'ignored');assert.equal(p.reason,'no_material_change');assert.deepEqual(p.assignments,{});assert.equal(p.statement,null);assert.ok(p.ignoredFields.includes('pricing.current_bid_usd'));assert.deepEqual(raw,copy);
  const clean=partial(event(1,after,{before:{'pricing.current_bid_usd':before}}),row(0));assert.deepEqual(clean.assignments,{current_bid_usd:null});assert.equal(partial(event(1,after,{before:{'pricing.current_bid_usd':before}}),row()).status,'ignored');
 }
});
test('material positive reset or absent-before explicit clear still removes a saved positive; true decreases remain valid',()=>{
 for(const after of [null,0])for(const before of [{'pricing.current_bid_usd':1300},{}])assert.deepEqual(partial(event(1,after,{before}),row(1300)).assignments,{current_bid_usd:null});
 assert.deepEqual(partial(event(1,1200,{before:{'pricing.current_bid_usd':1300}}),row(1300)).assignments,{current_bid_usd:1200});
 const raw=event(1,0),change=parseChangesResponse({ok:true,data:[raw],meta:{after:0,next_cursor:1,has_more:false,count:1,ordering:'sequence_asc',schema_version:'test',retention_days:14}},{after:0,limit:1}).events[0];
 for(const invalid of [-1,'0',NaN,{}])assert.throws(()=>prepareInventoryChangePatch({row:row(1300),change:{...change,before:{'pricing.current_bid_usd':invalid}},observedAt:AT}),/INVALID/);
});
test('within-file positive write survives later empty noise, then a genuine positive-to-empty reset clears it',()=>{
 const first=event(1,1200,{before:{'pricing.current_bid_usd':1300}}),noise=event(2,0,{before:{'pricing.current_bid_usd':null}}),clear=event(3,null,{before:{'pricing.current_bid_usd':1200}});
 const prefix=planInventoryChangeGroup({row:row(1300),events:[first,noise],observedAt:AT});assert.deepEqual(prefix.assignments,{current_bid_usd:1200});assert.equal(prefix.patches,1);assert.equal(prefix.ignored,1);
 const all=[first,noise,clear],copy=structuredClone(all),p=planInventoryChangeGroup({row:row(1300),events:all,observedAt:AT});assert.deepEqual(p.assignments,{current_bid_usd:null});assert.equal(p.patches,2);assert.equal(p.ignored,1);assert.equal(p.lastSequence,3);assert.deepEqual(all,copy);
});
test('empty primary noise does not suppress independent terminal/status/schedule effects or fabricate a closing price',()=>{
 const terminal=partial(event(1,0,{event:'lot.sold',terminal:true,before:{'pricing.current_bid_usd':null}}),row(1300));assert.equal(terminal.assignments.auction_state,'ended');assert.equal(terminal.assignments.source_status,'Sold');assert.equal(terminal.assignments.buy_now_usd,null);assert.equal(Object.hasOwn(terminal.assignments,'current_bid_usd'),false);assert.equal(Object.hasOwn(terminal.assignments,'final_price_usd'),false);
 const schedule=partial(event(1,0,{event:'auction.rescheduled',changed_fields:['pricing.current_bid_usd','auction.auction_at'],before:{'pricing.current_bid_usd':null},after:{'pricing.current_bid_usd':0,'auction.auction_at':'2026-11-05T12:00:00.000Z'}}),row(1300));assert.deepEqual(schedule.assignments,{auction_at:'2026-11-05T12:00:00.000Z'});
 const real=partial(event(1,0,{event:'lot.sold',terminal:true,before:{'pricing.current_bid_usd':1300}}),row(1300));assert.equal(real.assignments.current_bid_usd,null);assert.equal(real.assignments.auction_state,'ended');
});
