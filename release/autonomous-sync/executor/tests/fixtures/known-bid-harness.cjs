'use strict';
const data=require('./known-bid-tesla.json');
const {RefreshStore}=require('../../sync/automatic-refresh.cjs');
const {maintainKnownBid,pageQuery}=require('../../sync/feed-known-bid.cjs');
const {countedFeedRequest}=require('../../sync/feed-api-request.cjs');
const schemas=['0004_d1_sync_2.sql','0008_automatic_refresh.sql','0011_d1_server_feed.sql','0014_feed_catalog_membership.sql'];
async function init(db,clock){
 const insert=async(table,row)=>{const k=Object.keys(row);await db.prepare('INSERT INTO '+table+'('+k.join(',')+') VALUES('+k.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();};
 const row=data.row,at=data.at;
 await insert('vehicle_sources',{source_key:row.source_key,platform:'copart',provider:'apibara',identity_state:'resolved',first_seen_at:at,last_seen_at:at,created_at:at,updated_at:at});
 // Only unmeasured schema requirements have test setup values; the observed price, date,
 // source version, empty detail, VIN, LOT and baseline membership come from the production reads.
 await insert('auction_listings',{...row,identity_state:'resolved',listing_identity_kind:'source_listing_id',first_seen_at:row.last_seen_at,created_at:row.last_seen_at});
 await insert('feed_catalog_baselines',{baseline_id:'isolated',plan_sha256:'a'.repeat(64),plan_json:'{}',checkpoint_json:'{}',created_at:at,updated_at:at});
 await db.prepare("UPDATE feed_catalog_pointer SET baseline_id='isolated' WHERE singleton=1").run();
 await insert('feed_catalog_membership',{baseline_id:'isolated',listing_id:row.listing_id,active:1,last_sequence:data.member.last_sequence});
 const seq=118796735;
 await insert('server_feed_state',{singleton:1,committed_sequence:seq,seed_evidence_json:'{}',updated_at:at});
 await insert('server_feed_generations',{generation_id:23338,first_sequence:118680706,last_sequence:seq,sha256:'b'.repeat(64),raw_key:'isolated-archive',compressed_bytes:1,status:'complete',observed_at:'2026-11-24T20:05:53.318Z',created_at:at,updated_at:at});
 await db.prepare('UPDATE automatic_refresh_state SET quota_checked_at=?,quota_limit=100000,quota_left=75340,quota_allowance=65339,quota_used=24660 WHERE singleton=1').bind(at).run();
 const store=new RefreshStore(db,'isolated-known-bid',()=>clock);await store.acquire();
 return {store,db,env:{REXBID_FEED_OPEN_COVERAGE:'enabled',APIBARA_API_KEY:'synthetic-local-only'},state:{accountBudget:{databaseMaxBytes:8000000000},activation:{receipt:{kind:'feed-projected-catalog-activation'}}},
  usage:{unknown:false,rowsWritten:0,rowsRead:0,statements:0},control:{databaseSizeBytes:2428416000,limit:970},
  reservation:{window:{writeLimit:29293208,writes:20055200,readLimit:19255027912,reads:372772527}},now:()=>clock,body:{kind:'poll'},workPhase:null,buildRequest:countedFeedRequest};
}
async function run(args,fetchImpl,flags={}){
 const result={capturedPending:0};await maintainKnownBid({...args,result,fetchImpl,...flags});return result.knownBid??null;
}
module.exports={data,init,run,schemas,pageQuery};
