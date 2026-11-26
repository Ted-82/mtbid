'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {allocation}=require('../sync/feed-adaptive-quota.cjs');
const now=Date.parse('2026-11-26T11:00:00Z');
const quota={quota_checked_at:new Date(now).toISOString(),quota_left:99995,quota_limit:100000,quota_allowance:89994};
test('remaining provider resources and pending work change allocation without changing consumed usage',()=>{
 const idle=allocation({quota,pending:0,now}),busy=allocation({quota,pending:26431,now});
 assert.ok(busy.daily>idle.daily);assert.equal(busy.reserve,10000);
 assert.ok(busy.daily<busy.usable);
 assert.equal(allocation({quota:{...quota,quota_left:10000},pending:500000,now}).daily,0);
 assert.equal(allocation({quota,pending:1,now:now+86400001}),null);
});
test('24-hour, 7-day and 30-day simulations never spend provider reserve under 1,2,5,10x load',()=>{
 for(const days of [1,7,30])for(const scale of [1,2,5,10])for(const initial of [10000,30000,100000,500000]){
  let left=99995,pending=initial,done=0;
  for(let d=0;d<days;d++){
   pending+=1000*scale;
   const plan=allocation({quota:{...quota,quota_left:left,quota_allowance:Math.max(0,left-10001)},pending,now});
   const used=Math.min(pending,plan.daily);left-=used;pending-=used;done+=used;
   assert.ok(left>=10000);
  }
  assert.ok(done<=89995);
 }
});
