"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const data=require("../generated/partner-rates.review.json");
function locate(platform, location) {
 const r=data.land.find(r=>r.platform===platform && r.auction_location===location);
 assert.ok(r,`${platform}/${location}`); return r;
}
function quote(r,n,m=1) {
 const sea=data.sea.find(s=>s.terminal_id===r.preferred_terminal_id && s.cars_per_container===n);
 return Math.round((r.rates[r.preferred_terminal_id]*m+sea.amount)*100)/100;
}
test("Pełna baza i zachowanie pustych komórek",()=>{
 assert.equal(data.land.length,610);
 assert.equal(Object.values(data.land[0].rates).filter(v=>v===null).length,5);
 assert.equal(data.land[0].preferred_terminal_id,"montreal_qc");
 assert.equal(data.land.filter(r=>r.rate_status==="source_conflict").length,2);
});
test("Nazwane terminale zachowują aliasy",()=>{
 assert.equal(data.terminals.find(t=>t.legacy_route_id==="route_5").display_name,"Indianapolis, IN");
 assert.equal(data.terminals.find(t=>t.legacy_route_id==="route_6").display_name,"Montreal, QC");
});
test("Preferencja partnera, nie minimum: Anchorage",()=>{
 const r=locate("IAAI","Anchorage (AK)");
 assert.equal(r.preferred_terminal_id,"los_angeles_ca");
 assert.equal(quote(r,4),4225); assert.equal(quote(r,3),4565);
});
test("Portland Gorham ME: właściwy terminal",()=>{
 const r=locate("IAAI","Portland - Gorham (ME) 04038");
 assert.equal(r.preferred_terminal_id,"elizabeth_nj");
 assert.equal(quote(r,4),1025); assert.equal(quote(r,3),1100);
});
test("Houston + mnożnik wyłącznie lądowy",()=>{
 const r=locate("Copart","HOUSTON 77073");
 assert.equal(quote(r,4),880);
 assert.equal(quote(r,4,1.5),982.5);
});
test("Denver: preferowana Savannah choć Elizabeth tańsza",()=>{
 const r=locate("Copart","DENVER CENTRAL, CO 80229");
 assert.equal(r.preferred_terminal_id,"savannah_ga");
 assert.equal(quote(r,4),1450);
});
test("Morski jest per vehicle i docelowy port jest nieustalony",()=>{
 assert.equal(data.sea.length,24);
 assert.ok(data.sea.every(r=>r.price_basis==="per_vehicle" && r.destination_terminal_id===null));
});
test("Brak ukrytej zgody na publikację / mnożnik frachtu",()=>{
 assert.equal(data.metadata.automatic_cheapest_route_selection,false);
 assert.equal(data.metadata.release_status,"review_required_before_production");
 assert.ok(data.land_classes.every(r=>r.scope==="land_only"));
 assert.equal(data.land_classes.find(r=>r.class_id==="other").land_multiplier,null);
});

// Kwota i zakres poniżej są referencyjnymi założeniami tego pakietu, nie kodem produkcyjnego silnika.
function evSurcharge(powertrain) {
 const rule=data.surcharges.find(s=>s.surcharge_id==="ev_container_packing");
 if (powertrain === "BEV") return {amount:rule.amount,status:"owner_confirmed"};
 if (powertrain === "ICE") return {amount:0,status:"not_applicable"};
 return {amount:null,status:"requires_confirmation"};
}
test("EV: 150 USD na auto, nie na kontener ani gabaryt",()=>{
 const r=data.surcharges.find(s=>s.surcharge_id==="ev_container_packing");
 assert.equal(r.amount,150);assert.equal(r.unit,"per_vehicle");
 assert.equal(r.multiply_by_land_factor,false);assert.equal(r.divide_by_container_count,false);
 assert.equal(r.status,"owner_confirmed");assert.equal(r.effective_from,null);
});
test("Houston BEV: oba warianty +150",()=>{
 const r=locate("Copart","HOUSTON 77073");
 assert.equal(quote(r,4)+evSurcharge("BEV").amount,1030);
 assert.equal(quote(r,3)+evSurcharge("BEV").amount,1205);
});
test("EV pickup: mnożnik lądu nie mnoży pakowania",()=>{
 const r=locate("Copart","HOUSTON 77073");
 assert.equal(quote(r,4,1.5)+evSurcharge("BEV").amount,1132.5);
});
test("ICE: dopłata EV nie dotyczy",()=>assert.equal(evSurcharge("ICE").status,"not_applicable"));
test("Hybrydy i napęd nieznany: nie udajemy potwierdzonego zera",()=>{
 for(const p of ["HEV","PHEV","FCEV","unknown"]){assert.equal(evSurcharge(p).amount,null);assert.equal(evSurcharge(p).status,"requires_confirmation");}
});
test("Cztery elektryki: cztery jednostki opłaty, nie jedna",()=>assert.equal(4*evSurcharge("BEV").amount,600));
