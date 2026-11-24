const test = require("node:test");
const assert = require("node:assert/strict");
const ownerReview = require("../staging/owner-review.cjs");
const calculator = require("../public/rexbid-calculator-v4.js");
const rates = require("../public/rexbid-calculator-v4-rates.js");

const host = `https://${ownerReview.HOST}`;
const env = Object.freeze({
  REXBID_AUTH_TEST_UI:"enabled",
  REXBID_AUTH_TEST_HOST:ownerReview.HOST,
  REXBID_OWNER_REVIEW_ENABLED:"enabled",
  REXBID_CALCULATOR_V4_ENABLED:"enabled"
});

test("owner review preview serves the real car page only on the exact guarded staging host", async()=>{
  let assetCalls=0;
  const request=new Request(`${host}/__staging/owner-review?case=transport&lot=${ownerReview.FIXTURES.transport.lot}`);
  const response=await ownerReview.handleOwnerReviewRequest(request,env,async()=>{
    assetCalls++;
    return new Response('<!doctype html><html><head><title>Car</title></head><body><main id="page"></main><script src="/rexbid-calculator-v4.js"></script></body></html>',{headers:{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"style-src \'self\' \'unsafe-inline\'"}});
  });
  assert.equal(response.status,200);
  const html=await response.text();
  assert.equal(assetCalls,1);
  assert.match(html,/Podgląd testowy — nieaktualne\/syntetyczne oferty/);
  assert.match(html,/id="page"/);
  assert.match(html,/rexbid-calculator-v4\.js/);
  assert.match(html,/case=bev/);
  assert.match(response.headers.get("Cache-Control")||"",/no-store/);
  assert.equal(await ownerReview.handleOwnerReviewRequest(new Request(`https://mtbid.tedn828.workers.dev/__staging/owner-review?case=transport&lot=${ownerReview.FIXTURES.transport.lot}`),env,async()=>new Response("unexpected")),null);
  assert.equal(await ownerReview.handleOwnerReviewRequest(request,{...env,REXBID_OWNER_REVIEW_ENABLED:"disabled"},async()=>new Response("unexpected")),null);
  assert.equal(await ownerReview.handleOwnerReviewRequest(request,{...env,REXBID_AUTH_TEST_HOST:"other.example"},async()=>new Response("unexpected")),null);
});

test("synthetic detail/history are fixture-only, read-only, and require preview referrer",async()=>{
  const lot=ownerReview.FIXTURES.transport.lot;
  const detail=new Request(`${host}/api/car/${lot}`,{headers:{Referer:`${host}/__staging/owner-review?case=transport&lot=${lot}`}});
  const result=await ownerReview.handleOwnerReviewRequest(detail,env);
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.ok,true);
  assert.equal(body.data.lot_number,lot);
  assert.equal(body.data.location.auction_location,"HOUSTON 77073");
  assert.equal((await ownerReview.handleOwnerReviewRequest(new Request(`${host}/api/car/${lot}`),env)),null);
  assert.equal((await ownerReview.handleOwnerReviewRequest(new Request(`${host}/api/car/${lot}`,{headers:{Referer:`${host}/?catalog=1`}}),env)),null);
  const history=await ownerReview.handleOwnerReviewRequest(new Request(`${host}/api/car/${lot}/history?per_page=20`,{headers:{Referer:`${host}/__staging/owner-review?case=transport&lot=${lot}`}}),env);
  assert.deepEqual(await history.json(),{ok:true,history:[],meta:{next_cursor:null},data:{history:[],meta:{next_cursor:null}}});
});

test("owner fixtures prove partner transport math without provider reads or guessed rates",()=>{
  const input=(fixture,powertrain)=>({
    ...calculator.terminalFrom(fixture.data),vehicle:fixture.data,
    vehicleClass:"sedan",powertrain
  });
  const base=calculator.calculate(rates,input(ownerReview.FIXTURES.transport,"ICE"));
  assert.equal(base.standard.amount_usd,880);
  assert.equal(base.conservative.amount_usd,1055);
  const bev=calculator.calculate(rates,input(ownerReview.FIXTURES.bev,"BEV"));
  assert.equal(bev.standard.amount_usd,1030);
  assert.equal(bev.conservative.amount_usd,1205);
  const hev=calculator.calculate(rates,input(ownerReview.FIXTURES.hybrid,"HEV"));
  assert.equal(hev.standard.ev_packing.status,"requires_confirmation");
  assert.equal(hev.standard.ev_packing.amount_usd,null);
  assert.equal(hev.standard.amount_usd,null);
  assert.equal(hev.standard.known_amount_usd,1025);
  const unknown=calculator.calculate(rates,input(ownerReview.FIXTURES.unmatched,"ICE"));
  assert.equal(unknown.standard.status,"unmatched");
  assert.equal(unknown.standard.amount_usd,null);
});

test("Buy Now and unassigned schedule fixtures keep price/date semantics separate",()=>{
  const buyNow=ownerReview.FIXTURES.buyNow.data;
  assert.equal(buyNow.pricing.current_bid_usd,1550);
  assert.equal(buyNow.pricing.buy_now_usd,5000);
  assert.equal(buyNow.auction.schedule_status,"unassigned");
  assert.equal(buyNow.auction.auction_at,null);
  assert.equal(ownerReview.FIXTURES.unassigned.data.pricing.current_bid_usd,null);
  assert.equal(ownerReview.FIXTURES.unassigned.data.auction.auction_at,null);
});
