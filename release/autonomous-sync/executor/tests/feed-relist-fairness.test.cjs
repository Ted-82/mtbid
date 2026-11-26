'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{weights,choose}=require('../sync/feed-relist-fairness.cjs');
const now=Date.parse('2026-11-26T15:00:00Z');
test('durable deficit shares opportunities by load and age rather than a fixed 50/50 split',()=>{
 const w=weights([{platform:'copart',pending:30000},{platform:'iaai',pending:10000}],now);
 let credits={},copart=0,iaai=0,lastIAAI=-1;
 for(let i=0;i<100;i++){
  const pick=choose(w,credits);credits=pick.credits;credits[pick.platform]-=pick.total;
  if(pick.platform==='copart')copart++;else{iaai++;assert.ok(i-lastIAAI<=5);lastIAAI=i;}
 }
 assert.equal(copart,75);assert.equal(iaai,25);
 const aged=weights([{platform:'copart',pending:10000},{platform:'iaai',pending:10000,oldest:'2026-11-23T15:00:00Z'}],now);
 assert.ok(aged.iaai>aged.copart);
});
test('extremely uneven load preserves minimum source service and credit is bounded after changing weights',()=>{
 const w=weights([{platform:'copart',pending:500000},{platform:'iaai',pending:1}],now);
 assert.equal(w.copart,80);assert.equal(Math.round(w.iaai),20);
 const pick=choose(w,{copart:1e9,iaai:-1e9});assert.ok(Math.abs(pick.credits.copart)<=180);
});
