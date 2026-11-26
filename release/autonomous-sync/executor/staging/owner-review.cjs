"use strict";

const HOST = "rexbid-auth-test.tedn828.workers.dev";
const FIXTURES = Object.freeze({
  transport: Object.freeze({
    lot: "OWNER-V4-HOUSTON",
    caseLabel: "Transport bazowy · Houston",
    data: Object.freeze({
      vin: "1G1YY22G8P5100001", lot_number: "OWNER-V4-HOUSTON", platform: "copart",
      year: 2020, make: "Chevrolet", model: "Corvette Stingray", body_style: "Sedan",
      fuel_type: "Gasoline", transport_class: "sedan", status: "upcoming",
      auction: Object.freeze({state:"upcoming", schedule_status:"scheduled", schedule_precision:"date_time", auction_at:"2026-12-15T15:00:00-06:00", timezone:"America/Chicago", source_status:"Scheduled", assigned:true, facility_name:"HOUSTON 77073", current_bid_usd:1000, buy_now_usd:5000}),
      pricing: Object.freeze({current_bid_usd:1000, buy_now_usd:5000, currency:"USD"}),
      location: Object.freeze({auction_location:"HOUSTON 77073", city:"Houston", state:"TX", state_province:"TX", postal_code:"77073", country:"US"}),
      sale_document: Object.freeze({name:"TX Salvage Title", status:"Salvage"}),
      seller: Object.freeze({type:"Insurance"}),
      media_urls: Object.freeze([]), media_thumbnails: Object.freeze([]),
      observed_at:"2026-10-05T00:00:00.000Z", source_metadata:Object.freeze({fixture:true})
    })
  }),
  bev: Object.freeze({
    lot: "OWNER-V4-BEV-HOUSTON", caseLabel:"BEV · Houston · dopłata 150 USD",
    data: Object.freeze({
      vin:"5YJ3E1EA0LF000002", lot_number:"OWNER-V4-BEV-HOUSTON", platform:"copart",
      year:2022, make:"Tesla", model:"Model 3", body_style:"Sedan", fuel_type:"Electric",
      powertrain:"BEV", transport_class:"sedan", status:"upcoming",
      auction:Object.freeze({state:"upcoming",schedule_status:"scheduled",schedule_precision:"date_time",auction_at:"2026-12-16T15:00:00-06:00",timezone:"America/Chicago",source_status:"Scheduled",assigned:true,facility_name:"HOUSTON 77073"}),
      pricing:Object.freeze({current_bid_usd:5000,buy_now_usd:12000,currency:"USD"}),
      location:Object.freeze({auction_location:"HOUSTON 77073",city:"Houston",state:"TX",state_province:"TX",postal_code:"77073",country:"US"}),
      sale_document:Object.freeze({name:"TX Salvage Title",status:"Salvage"}),seller:Object.freeze({type:"Insurance"}),
      media_urls:Object.freeze([]),media_thumbnails:Object.freeze([]),observed_at:"2026-10-05T00:00:00.000Z",source_metadata:Object.freeze({fixture:true})
    })
  }),
  buyNow: Object.freeze({
    lot:"OWNER-V4-BUY-NOW", caseLabel:"Aktualna oferta + Kup teraz",
    data:Object.freeze({
      vin:"1G1YY22G8P5100003",lot_number:"OWNER-V4-BUY-NOW",platform:"copart",year:2021,make:"Chevrolet",model:"Corvette Stingray",body_style:"Sedan",fuel_type:"Gasoline",transport_class:"sedan",status:"open",
      auction:Object.freeze({state:"upcoming",schedule_status:"unassigned",schedule_precision:"unknown",auction_at:null,source_status:"Upcoming",assigned:false,facility_name:"HOUSTON 77073"}),
      pricing:Object.freeze({current_bid_usd:1550,buy_now_usd:5000,currency:"USD"}),
      location:Object.freeze({auction_location:"HOUSTON 77073",city:"Houston",state:"TX",state_province:"TX",postal_code:"77073",country:"US"}),
      sale_document:Object.freeze({name:"TX Salvage Title",status:"Salvage"}),seller:Object.freeze({type:"Insurance"}),media_urls:Object.freeze([]),media_thumbnails:Object.freeze([]),observed_at:"2026-10-05T00:00:00.000Z",source_metadata:Object.freeze({fixture:true})
    })
  }),
  hybrid: Object.freeze({
    lot:"OWNER-V4-HEV-IAAI",caseLabel:"HEV · IAAI · dopłata wymaga potwierdzenia",
    data:Object.freeze({
      vin:"4T1BF1FK5GU000004",lot_number:"OWNER-V4-HEV-IAAI",platform:"iaai",year:2017,make:"Toyota",model:"Camry Hybrid",body_style:"Sedan",fuel_type:"Hybrid",powertrain:"HEV",transport_class:"sedan",status:"upcoming",
      auction:Object.freeze({state:"upcoming",schedule_status:"scheduled",schedule_precision:"date_time",auction_at:"2026-12-18T14:00:00-05:00",timezone:"America/New_York",source_status:"Scheduled",assigned:true,facility_name:"PORTLAND - GORHAM",branch_name:"PORTLAND - GORHAM"}),
      pricing:Object.freeze({current_bid_usd:800,buy_now_usd:null,currency:"USD"}),
      location:Object.freeze({auction_location:"PORTLAND - GORHAM",city:"Gorham",state:"ME",state_province:"ME",postal_code:"04038",country:"US"}),
      sale_document:Object.freeze({name:"ME Salvage Title",status:"Salvage"}),seller:Object.freeze({type:"Insurance"}),media_urls:Object.freeze([]),media_thumbnails:Object.freeze([]),observed_at:"2026-10-05T00:00:00.000Z",source_metadata:Object.freeze({fixture:true})
    })
  }),
  unassigned:Object.freeze({
    lot:"OWNER-V4-UNASSIGNED",caseLabel:"Upcoming · termin nieustalony",
    data:Object.freeze({
      vin:"1G1YY22G8P5100005",lot_number:"OWNER-V4-UNASSIGNED",platform:"copart",year:2020,make:"Chevrolet",model:"Corvette Stingray",body_style:"Sedan",fuel_type:"Gasoline",transport_class:"sedan",status:"upcoming",
      auction:Object.freeze({state:"upcoming",schedule_status:"unassigned",schedule_precision:"unknown",auction_at:null,auction_end:null,source_status:"Upcoming",assigned:false,facility_name:"HOUSTON 77073"}),
      pricing:Object.freeze({current_bid_usd:null,buy_now_usd:null,currency:"USD"}),location:Object.freeze({auction_location:"HOUSTON 77073",city:"Houston",state:"TX",state_province:"TX",postal_code:"77073",country:"US"}),
      sale_document:Object.freeze({name:"TX Salvage Title",status:"Salvage"}),seller:Object.freeze({type:"Insurance"}),media_urls:Object.freeze([]),media_thumbnails:Object.freeze([]),observed_at:"2026-10-05T00:00:00.000Z",source_metadata:Object.freeze({fixture:true})
    })
  }),
  unmatched:Object.freeze({
    lot:"OWNER-V4-UNMATCHED",caseLabel:"Lokalizacja bez potwierdzonej stawki",
    data:Object.freeze({
      vin:"1G1YY22G8P5100006",lot_number:"OWNER-V4-UNMATCHED",platform:"copart",year:2020,make:"Chevrolet",model:"Corvette Stingray",body_style:"Sedan",fuel_type:"Gasoline",transport_class:"sedan",status:"open",
      auction:Object.freeze({state:"upcoming",schedule_status:"unassigned",schedule_precision:"unknown",auction_at:null,source_status:"Upcoming",assigned:false,facility_name:"UNLISTED TEST LOCATION"}),
      pricing:Object.freeze({current_bid_usd:750,buy_now_usd:null,currency:"USD"}),location:Object.freeze({auction_location:"UNLISTED TEST LOCATION",city:"Nowhere",state:"ZZ",state_province:"ZZ",postal_code:"00000",country:"US"}),
      sale_document:null,seller:Object.freeze({type:"Insurance"}),media_urls:Object.freeze([]),media_thumbnails:Object.freeze([]),observed_at:"2026-10-05T00:00:00.000Z",source_metadata:Object.freeze({fixture:true})
    })
  })
});

function flagsEnabled(url, env) {
  return url.hostname === HOST
    && env?.REXBID_AUTH_TEST_UI === "enabled"
    && env?.REXBID_AUTH_TEST_HOST === HOST
    && env?.REXBID_OWNER_REVIEW_ENABLED === "enabled"
    && env?.REXBID_CALCULATOR_V4_ENABLED === "enabled";
}

function fixtureForCase(name) { return FIXTURES[name] || null; }
function fixtureByLot(lot) { return Object.values(FIXTURES).find(item => item.lot === lot) || null; }

function previewBar(fixture) {
  const links = Object.entries(FIXTURES).map(([name, item]) => `<a href="/__staging/owner-review?case=${encodeURIComponent(name)}&amp;lot=${encodeURIComponent(item.lot)}">${item.caseLabel}</a>`).join("");
  return `<aside class="owner-review-bar" role="region" aria-label="Podgląd testowy"><strong>Podgląd testowy — nieaktualne/syntetyczne oferty</strong><span>${fixture.caseLabel}</span><nav aria-label="Przypadki testowe">${links}</nav><a class="owner-review-home" href="/">Wróć na Home</a></aside>`;
}

function injectPreview(html, response, fixture) {
  const nonce = response.headers.get("Content-Security-Policy")?.match(/'nonce-([^']+)'/)?.[1];
  const style = `<style${nonce ? ` nonce="${nonce}"` : ""}>.owner-review-bar{position:relative;z-index:1000;display:grid;grid-template-columns:auto 1fr auto;gap:8px 16px;align-items:center;padding:12px max(18px,calc((100vw - 1320px)/2));background:#10233f;color:#fff;border-bottom:3px solid #dc3347;font:600 13px/1.4 system-ui}.owner-review-bar strong{color:#fff}.owner-review-bar span{color:#ffd9de}.owner-review-bar nav{display:flex;flex-wrap:wrap;gap:6px}.owner-review-bar nav a,.owner-review-home{color:#fff;text-decoration:none;border:1px solid #65768c;border-radius:999px;padding:5px 9px;font-size:12px}.owner-review-bar a:hover{background:#dc3347}.owner-review-home{justify-self:end}@media(max-width:760px){.owner-review-bar{grid-template-columns:1fr;gap:7px;padding:12px 14px}.owner-review-bar nav{overflow:visible;flex-wrap:wrap}.owner-review-bar nav a{flex:1 1 145px;min-width:0;text-align:center}.owner-review-home{justify-self:start}}</style>`;
  const bodyBar = previewBar(fixture);
  let output = html.replace(/<\/head>/i, `${style}</head>`);
  output = output.replace(/<body\b[^>]*>/i, match => `${match}${bodyBar}`);
  return output;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {status, headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"}});
}

async function handleOwnerReviewRequest(request, env, renderCarPage) {
  const url = new URL(request.url);
  const isPreviewPath = url.pathname === "/__staging/owner-review";
  const detailMatch = url.pathname.match(/^\/api\/car\/([^/]+)$/);
  const historyMatch = url.pathname.match(/^\/api\/car\/([^/]+)\/history$/);
  if (!isPreviewPath && !detailMatch && !historyMatch) return null;
  if (!flagsEnabled(url, env)) return null;
  if (request.method !== "GET") return jsonResponse({ok:false,error:"method_not_allowed"},405);
  if (isPreviewPath) {
    const caseName = url.searchParams.get("case") || "transport";
    const fixture = fixtureForCase(caseName);
    if (!fixture) return new Response("Nie znaleziono przypadku testowego.",{status:404,headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"}});
    const suppliedLot = url.searchParams.get("lot");
    if (suppliedLot !== fixture.lot) {
      const redirect = new URL(url);
      redirect.searchParams.set("lot", fixture.lot);
      return Response.redirect(redirect.toString(), 302);
    }
    const response = await renderCarPage(request);
    if (!response?.ok || !response.headers.get("Content-Type")?.toLowerCase().includes("text/html")) return response;
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(injectPreview(await response.text(), response, fixture), {status:response.status,headers});
  }
  if (detailMatch || historyMatch) {
    const referer = request.headers.get("Referer");
    if (!referer) return null;
    let source;
    try { source = new URL(referer); } catch { return null; }
    if (source.hostname !== HOST || source.pathname !== "/__staging/owner-review") return null;
    let requestedLot;
    try { requestedLot = decodeURIComponent((detailMatch || historyMatch)[1]); } catch { return null; }
    const fixture = fixtureByLot(requestedLot);
    if (!fixture || source.searchParams.get("lot") !== fixture.lot) return null;
    if (historyMatch) return jsonResponse({ok:true,history:[],meta:{next_cursor:null},data:{history:[],meta:{next_cursor:null}}});
    return jsonResponse({ok:true,match:"exact",data:fixture.data});
  }
  return null;
}

module.exports = { HOST, FIXTURES, flagsEnabled, fixtureForCase, fixtureByLot, handleOwnerReviewRequest };
