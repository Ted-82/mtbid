'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verifiedTimedSale}=require('../sync/verified-timed-sale.cjs');
const {D1ReadRepository}=require('../sync/d1-read-repository.js');
const row={listing_id:'listing|apibara|iaai|source|46410658',identity_state:'resolved',provider:'apibara',platform:'iaai',lot:'46410658',vin_normalized:'WAUC4DF58JA064291',
  event_key:'feed-timed-result:v1:642ba24cca724cd8ddb5168439b0456b69b908777e6bd5fc9bdaffb74187875a',provider_event_id:'chg_119386159',source_status:'Sold',canonical_status:'Sold',
  auction_date:'2026-11-24T23:59:00.000Z',sale_date:'2026-11-24',observed_at:'2026-11-25T00:42:43.000Z',final_price_usd:12700,
  fingerprint:'feed-timed-result-proof:v1:3b880118e0c7fa5455509cafbfc5f3659873c3fa841413dbef6d1b06a424e73f'};
test('Audi source sale receipt verifies independently of the bid and rejects changes of price, date, evidence or status',async()=>{
  assert.equal(await verifiedTimedSale(row),true);
  assert.equal(await verifiedTimedSale({...row,current_bid_usd:1}),true);
  for(const changed of [{final_price_usd:12701},{final_price_usd:null},{observed_at:row.auction_date},{sale_date:'2026-11-25'},
    {auction_date:'2026-11-24T23:59:00'},{provider_event_id:'chg_119386158'},{source_status:'Sold on Approval'},
    {canonical_status:'not_sold'},{identity_state:'ambiguous'},{fingerprint:null},{provider:'other'}])
    assert.equal(await verifiedTimedSale({...row,...changed}),false);
});
test('D1 reader keeps valid receipts with their price, drops damaged feed receipts, and preserves ordinary history',async()=>{
  const rows=[row,{...row,final_price_usd:27000},{...row,event_key:'rest-other',source_status:'Sold on Approval',canonical_status:'pending',fingerprint:null,final_price_usd:null}];
  const db={prepare:()=>({bind:()=>({all:async()=>({results:rows})})})};
  const records=await new D1ReadRepository(db).getConfirmedEvents({listingId:row.listing_id});
  assert.equal(records.length,2);assert.equal(records[0].final_price,12700);assert.equal(records[0].timed_cycle_verified,true);
  assert.equal(records[1].event_key,'rest-other');assert.equal(records[1].timed_cycle_verified,undefined);assert.equal(records[1].final_price,null);
});
