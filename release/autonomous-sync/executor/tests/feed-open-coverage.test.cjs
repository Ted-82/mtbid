"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), {DatabaseSync} = require("node:sqlite");
const {createApibaraProvider} = require("../providers/apibara.js");
const {RefreshStore} = require("../sync/automatic-refresh.cjs");
const {prepareInventoryPage} = require("../sync/inventory-page.cjs");
const {commitInventoryBatch} = require("../sync/inventory-commit.cjs");

const NOW = Date.parse("2026-10-26T12:00:00.000Z"), OLD = "2026-10-25T12:00:00.000Z";
const CURRENT = "2026-10-26T11:59:00.000Z";
const policy = {hotIntervalMs: 3600000, warmIntervalMs: 86400000, coldIntervalMs: 604800000, hotWindowMs: 3600000};
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/apibara-discovery-page-shape.json"), "utf8")).response.data[0];
const adapter = createApibaraProvider({fetch: async () => {throw Error("NETWORK_FORBIDDEN");}});
function raw(platform = "copart", lot = "10000001", bid = 100) {
  const value = structuredClone(fixture);
  value.platform = platform; value.lot_number = lot; value.vehicle_id = `${platform}-${lot}`;
  value.vin = "1HGCM82633A004352"; value.pricing.current_bid_usd = bid;
  return value;
}
function database() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["0004_d1_sync_2.sql", "0008_automatic_refresh.sql", "0011_d1_server_feed.sql", "0014_feed_catalog_membership.sql"]) {
    sqlite.exec(fs.readFileSync(path.join(__dirname, "../docs/proposals", file), "utf8"));
  }
  const calls = {reads: 0, batches: []};
  const db = {prepare(sql) {return {bind(...params) {return {sql, params,
    async all() {calls.reads++; return {results: sqlite.prepare(sql).all(...params)};},
    async first() {calls.reads++; return sqlite.prepare(sql).get(...params) || null;},
    async run() {return {meta: {changes: Number(sqlite.prepare(sql).run(...params).changes)}};}
  };}};}, async batch(statements) {
    calls.batches.push(statements); sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(item => /^\s*SELECT/i.test(item.sql)
        ? {results: sqlite.prepare(item.sql).all(...item.params)}
        : {meta: {changes: Number(sqlite.prepare(item.sql).run(...item.params).changes)}});
      sqlite.exec("COMMIT"); return results;
    } catch (error) {sqlite.exec("ROLLBACK"); throw error;}
  }};
  const store = new RefreshStore(db, "inventory-commit-test", () => NOW);
  return {db, sqlite, store, calls};
}

const {reconcileOpenIaai,TASK}=require('../sync/feed-open-coverage.cjs');
async function setup(t) {
 const {db,sqlite,store}=database();
 t.after(()=>sqlite.close());
 assert.equal(await store.acquire(),true);
 sqlite.prepare("INSERT INTO feed_catalog_baselines(baseline_id,plan_sha256,plan_json,checkpoint_json,created_at,updated_at) VALUES('proof',?,'{}','{}',?,?)").run('a'.repeat(64),CURRENT,CURRENT);
 sqlite.prepare("UPDATE feed_catalog_pointer SET baseline_id='proof'").run();
 sqlite.prepare("INSERT INTO server_feed_generations(generation_id,sha256,raw_key,compressed_bytes,observed_at,status,created_at,updated_at,first_sequence,last_sequence) VALUES(15048,?,'raw.jsonl.gz',100,?,'complete',?,?,1,100)").run('b'.repeat(64),CURRENT,CURRENT,CURRENT);
 sqlite.prepare("INSERT INTO server_feed_state(singleton,committed_sequence,seed_evidence_json,updated_at) VALUES(1,100,'{}',?)").run(CURRENT);
 const requestCalls=[];
 const response=records=>({ok:true,data:records,meta:{applied_filters:{platform:'iaai',lot_sub_status:'Open'},next_cursor:'next'}});
 const open=(lot,overrides={})=>{
  const candidate=raw('iaai',lot,100);
  candidate.updated_at='2026-10-26T11:55:00.000Z';
  candidate.auction={...candidate.auction,state:'open',schedule_status:'scheduled',timed_end_at:null,auction_at:'2026-10-27T12:00:00.000Z'};
  return Object.assign(candidate,overrides);
 };
 const run=(handler,stamp=NOW)=>reconcileOpenIaai({db,store,adapter,now:()=>stamp,getRequest:async()=>async spec=>{
  requestCalls.push(spec);
  return {observedAt:new Date(stamp).toISOString(),response:await handler(spec)};
 }});
 return {sqlite,store,run,response,open,requestCalls};
}
test('opens the missing IAAI lot and advances its inventory cursor in the same transaction',async t=>{
 const h=await setup(t);
 const rows=[h.open('20000001'),h.open('20000002',{vin:'BAD'}),h.open('20000003',{updated_at:'2026-10-26T12:01:00Z'}),h.open('20000004',{auction:{state:'open',auction_at:'2026-10-25T12:00:00Z'}})];
 const result=await h.run(()=>h.response(rows));
 assert.equal(result.inserted,1);
 const stored=h.sqlite.prepare("SELECT l.lot,m.active,m.last_sequence FROM auction_listings l JOIN feed_catalog_membership m USING(listing_id)").all();
 assert.deepEqual(stored.map(x=>[x.lot,x.active,x.last_sequence]),[['20000001',1,100]]);
 assert.equal((await h.store.task(TASK)).cursor,'next');
 assert.equal(await h.run(()=>{throw Error('UNEXPECTED_FETCH');}),null);
 assert.equal(h.requestCalls.length,1);
});
test('leaves pending packages and a changed publication untouched',async t=>{
 const h=await setup(t);
 h.sqlite.prepare("UPDATE server_feed_generations SET status='downloaded'").run();
 assert.equal(await h.run(()=>{throw Error('UNEXPECTED_FETCH');}),null);
 h.sqlite.prepare("UPDATE server_feed_generations SET status='complete'").run();
 await assert.rejects(h.run(()=>{
  h.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=110').run();
  return h.response([h.open('20000001')]);
 }));
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) count FROM auction_listings').get().count,0);
 assert.equal(await h.store.task(TASK),null);
});
test('rejects unexpected filter scope and leaves the inventory retryable',async t=>{
 const h=await setup(t);
 const wrong=h.response([h.open('20000001')]); wrong.meta.applied_filters.platform='copart';
 assert.equal((await h.run(()=>wrong)).error,'FEED_OPEN_COVERAGE_INVALID_PAGE');
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) count FROM auction_listings').get().count,0);
 assert.equal((await h.store.task(TASK)).cursor,null);
});

test('holds a page until a newer file is published and records the LOT only with its automatic insert',async t=>{
 const h=await setup(t);
 const raw=h.open('20000011',{updated_at:'2026-10-26T11:59:30.000Z'});
 const first=await h.run(()=>h.response([raw]));
 assert.equal(first.deferred,true);
 assert.equal(first.inserted,0);
 assert.equal((await h.store.task(TASK)).scan_pages,0);
 assert.equal(await h.run(()=>{throw Error('UNEXPECTED_FETCH');},NOW+16*60000),null);
 assert.equal(h.requestCalls.length,1);
 h.sqlite.prepare("UPDATE server_feed_generations SET last_sequence=120,observed_at='2026-10-26T12:05:00.000Z'").run();
 h.sqlite.prepare('UPDATE server_feed_state SET committed_sequence=120').run();
 const result=await h.run(()=>h.response([raw]),NOW+16*60000);
 assert.equal(result.inserted,1);
 assert.equal(result.deferred,false);
 assert.equal((await h.store.task(TASK)).cursor,'next');
 const receipt=JSON.parse((await h.store.task('feed-open-coverage:last-insert:iaai:v1')).cursor);
 assert.deepEqual(receipt,{sequence:120,page:1,lots:['20000011']});
});
