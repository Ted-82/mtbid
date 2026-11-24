'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {archiveAllowance,sourceBytes,KEY}=require('../sync/auction-archive-budget.cjs');
function fixture({cache=null,bytes=100,listed=200}={}){let writes=0,lists=0;const env={REXBID_ARCHIVE_CATALOG:{prepare(){return{first:async()=>({bytes})};}},REXBID_AUCTION_ARCHIVE:{get:async()=>cache?{json:async()=>cache}:null,put:async(key,value)=>{assert.equal(key,KEY);cache=JSON.parse(value);writes++;}},REXBID_ARCHIVE_FEED:{list:async()=>{lists++;return{objects:[{size:listed}],truncated:false};}}};return{env,read:()=>({cache,writes,lists})};}
test('lists all pages even when the first truncated page is short',async()=>{let n=0;const x=await sourceBytes({list:async o=>{if(n++===0){assert.equal(o.cursor,undefined);return{objects:[{size:100}],truncated:true,cursor:'a'};}assert.equal(o.cursor,'a');return{objects:[{size:200}],truncated:false};}});assert.equal(x,300);});
test('rejects repeated cursors and malformed sizes',async()=>{await assert.rejects(sourceBytes({list:async()=>({objects:[{size:1}],truncated:true,cursor:'a'})}),/archive_storage_cursor/);await assert.rejects(sourceBytes({list:async()=>({objects:[{size:-1}],truncated:false})}),/archive_storage_listing/);});
test('reserves other buckets and feed working space before archive admission',async()=>{const f=fixture({listed:3_000_000_000});const r=await archiveAllowance(f.env,{now:()=>1000000,maximum:299_100_000_000});assert.equal(r.maximumBytes,296_100_000_000);assert.equal(r.feedWorkReserve,600_000_000);assert.equal(r.otherBucketReserve,300_000_000);assert.equal(f.read().writes,1);});
test('uses the cached meter without re-listing for every pass',async()=>{const f=fixture({cache:{version:1,at:900000,sourceBytes:200,ledgerBytes:100}});await archiveAllowance(f.env,{now:()=>1000000,maximum:6400000000});assert.equal(f.read().lists,0);assert.equal(f.read().writes,0);});
test('adds ledger growth and never subtracts a ledger decrease',async()=>{for(const current of [50,200]){const f=fixture({bytes:current,cache:{version:1,at:900000,sourceBytes:3e9,ledgerBytes:100}});const r=await archiveAllowance(f.env,{now:()=>1e6,maximum:299100000000});assert.equal(r.maximumBytes,296_100_000_000-Math.max(0,current-100));}});
test('refreshes a stale meter using every source object',async()=>{const f=fixture({cache:{version:1,at:1,sourceBytes:5e9,ledgerBytes:100},listed:1000});await archiveAllowance(f.env,{now:()=>1e6,maximum:6400000000});assert.equal(f.read().lists,1);assert.equal(f.read().writes,1);});
test('invalid or future meter fails closed without writing data',async()=>{const f=fixture({cache:{version:1,at:2e6,sourceBytes:100,ledgerBytes:100}});await assert.rejects(archiveAllowance(f.env,{now:()=>1e6,maximum:6400000000}),/archive_storage_meter/);assert.equal(f.read().writes,0);});
test('no remaining account space yields zero archive allowance',async()=>{const f=fixture({listed:300e9});assert.equal((await archiveAllowance(f.env,{now:()=>1e6,maximum:6400000000})).maximumBytes,0);});

test('space released by the feed is automatically available beyond the former6.4GB ceiling',async()=>{
 const f=fixture({listed:2e9});
 const before=await archiveAllowance(f.env,{now:()=>1000000,maximum:299100000000});
 assert.equal(before.maximumBytes,297100000000);
 f.env.REXBID_ARCHIVE_FEED.list=async()=>({objects:[{size:1e9}],truncated:false});
 const after=await archiveAllowance(f.env,{now:()=>2000000,maximum:299100000000});
 assert.equal(after.maximumBytes,298100000000);
 assert.ok(after.maximumBytes+after.sourceReserved+after.feedWorkReserve+after.otherBucketReserve<=300000000000);
});

test('increasing source storage reduces archive room without changing the importer',async()=>{
 const f=fixture({listed:6e9});
 const r=await archiveAllowance(f.env,{now:()=>1000000,maximum:299100000000});
 assert.equal(r.maximumBytes,293100000000);
 assert.equal(r.maximumBytes+r.sourceReserved+r.feedWorkReserve+r.otherBucketReserve,300000000000);
});

test('approved storage ceiling keeps the full-month storage estimate below USD5',()=>{
 const {statusSnapshot}=require('../sync/auction-archive-budget.cjs');
 const s=statusSnapshot({entries:[],allocatedBytes:299100000000},{sourceReserved:0,measuredAt:'2026-11-18'},null,Date.parse('2026-11-18'));
 assert.equal(s.reservedTotalBytes,300000000000);assert.equal(s.estimatedStorageUSDMonthly,4.35);assert.equal(s.warning,'capacity');assert.equal(s.remainingBytes,0);
});
test('trend is withheld until a full day and warns well before capacity',()=>{
 const {statusSnapshot}=require('../sync/auction-archive-budget.cjs'),at=Date.parse('2026-11-18'),allowance={sourceReserved:0};
 const index={entries:[],allocatedBytes:199100000000};
 const early=statusSnapshot(index,allowance,{points:[{at:at-3600000,bytes:190e9}]},at);assert.equal(early.trend,null);
 const daily=statusSnapshot(index,allowance,{points:[{at:at-86400000,bytes:180e9}]},at);assert.equal(daily.trend.bytesPerDay,20e9);assert.equal(daily.warning,'growth_warning');assert.equal(daily.trend.daysRemaining,5);
 const near=statusSnapshot({...index,allocatedBytes:250e9},allowance,null,at);assert.equal(near.warning,'near_capacity');
});
