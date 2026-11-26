'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildPublicHistoryTransfer}=require('../scripts/public-history-transfer.cjs');
const when='2026-10-08T12:00:00Z';
function input(){return {listings:[{listing_id:'abc',source_key:'src',platform:'iaai',lot:'12345678',vin_normalized:'5YJ3E1EA4NF186754'}],health:[{source_key:'src',last_attempt_at:when,last_success_at:null,last_error_code:'UNTRUSTED MESSAGE'}],receipts:[{scope_key:'history-import:abc',provider:'apibara',platform:'iaai',operation:'history_refresh',status:'complete',cursor:'DO_NOT_COPY',last_attempt_at:when,last_success_at:when,last_complete_at:when,updated_at:when}]};}
test('public fetch outcomes preserve clocks, sanitize diagnostics and exclude cursors/leases',()=>{
 const p=buildPublicHistoryTransfer(input());assert.equal(p.receiptStatements.length,1);assert.equal(p.healthStatements.length,1);
 assert.ok(p.receiptStatements[0].params.includes(when));assert.ok(p.healthStatements[0].params.includes('PUBLIC_SOURCE_REFRESH_FAILED'));
 assert.doesNotMatch(JSON.stringify(p),/UNTRUSTED MESSAGE|DO_NOT_COPY|lease_owner/);
});
test('wrong receipt platform, missing confirmed timestamp and duplicate receipt are rejected',()=>{
 for(const mutate of [x=>x.receipts[0].platform='copart',x=>x.receipts[0].last_success_at=null,x=>x.receipts.push(x.receipts[0])]){const x=input();mutate(x);assert.throws(()=>buildPublicHistoryTransfer(x),/RECEIPT_INVALID/);}
});
test('failed and partial reads keep their state; empty is not fabricated',()=>{
 for(const status of ['failed','partial']){const x=input();Object.assign(x.receipts[0],{status,last_success_at:null,last_complete_at:null});const p=buildPublicHistoryTransfer(x);assert.equal(p.receiptStatements[0].params[3],status);assert.equal(p.receiptStatements[0].params[5],null);}
});
