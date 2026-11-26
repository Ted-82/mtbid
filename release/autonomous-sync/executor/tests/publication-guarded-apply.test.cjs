'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {applyPublicationData}=require('../scripts/apply-publication-data.cjs');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rexbid-transfer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const groups=['event1','event2'].map(id=>{const statements=[{table:'auction_events',columns:['event_id'],sql:'INSERT INTO auction_events(event_id) VALUES(?)',params:[id]}];return {statements,sha256:sha(statements),changes:[1]};});const plan={groups,manifest:{plan_sha256:sha(groups.map(x=>({statements:x.statements,sha256:x.sha256})))}};return {plan,checkpointFile:path.join(dir,'progress.json')};}
function db(){const calls=[];return {calls,identity:{id:'c8a30088-70af-43a6-9a7f-c4018279d37d',name:'rexbid-production-preflight-db'},prepare(sql){return {sql,params:[],bind(...params){return {...this,params,first:async()=>({event_id:params[0]})};}};},async batch(items){calls.push(items);return [{success:true,meta:{changes:1}}];}};}
test('budget STOP is resumable; only readback-confirmed batches are skipped',async t=>{
 const args=fixture(t),target=db(),original=target.batch;let count=0;
 target.batch=async items=>{if(++count===2)throw Error('D1_WRITE_BUDGET_STOP');return original.call(target,items);};
 const state=await applyPublicationData({...args,db:target});assert.equal(state.completed,1);assert.equal(state.inflight,null);assert.equal(state.stop,'D1_WRITE_BUDGET_STOP');
 target.batch=original;const done=await applyPublicationData({...args,db:target});assert.equal(done.completed,2);assert.equal(target.calls.length,2);assert.equal(target.calls[1][0].params[0],'event2');
});
test('uncertain transport leaves inflight marker and blocks automatic replay',async t=>{
 const args=fixture(t),target=db();target.batch=async()=>{throw Error('OPERATOR_D1_TIMEOUT');};await assert.rejects(applyPublicationData({...args,db:target}),/TIMEOUT/);
 await assert.rejects(applyPublicationData({...args,db:db()}),/RECONCILIATION_REQUIRED/);
});
test('wrong target, edited plan and mismatching row changes fail closed',async t=>{
 const args=fixture(t),target=db();target.identity.id='staging';await assert.rejects(applyPublicationData({...args,db:target}),/TARGET/);
 const edited=structuredClone(args.plan);edited.groups[0].statements[0].params[0]='other';await assert.rejects(applyPublicationData({...args,plan:edited,db:db()}),/PLAN_CHANGED/);
 const other=db();other.batch=async()=>[{meta:{changes:0}}];await assert.rejects(applyPublicationData({...args,db:other}),/CHANGES_MISMATCH/);
});
