(function (root, factory) {
  "use strict";
  const rates = factory();
  if (typeof module === "object" && module.exports) module.exports = rates;
  if (root) root.RexBidDeliveredRates = rates;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function freeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  const buyer = [
    [0,50,1],[50,100,1],[100,200,25],[200,300,60],
    [300,350,85],[350,400,100],[400,450,125],[450,500,135],
    [500,550,145],[550,600,155],[600,700,170],[700,800,195],
    [800,900,215],[900,1000,230],[1000,1200,250],[1200,1300,270],
    [1300,1400,285],[1400,1500,300],[1500,1600,315],[1600,1700,330],
    [1700,1800,350],[1800,2000,370],[2000,2400,390],[2400,2500,425],
    [2500,3000,460],[3000,3500,505],[3500,4000,555],[4000,4500,600],
    [4500,5000,625],[5000,5500,650],[5500,6000,675],[6000,6500,700],
    [6500,7000,720],[7000,7500,755],[7500,8000,775],[8000,8500,800],
    [8500,9000,820],[9000,10000,820],[10000,10500,850],[10500,11000,850],
    [11000,11500,850],[11500,12000,860],[12000,12500,875],[12500,15000,890]
  ].map(([min, maxExclusive, amount]) => ({ min, maxExclusive, amount }));
  buyer.push({ min:15000, maxExclusive:null, rate:0.06 });
  const live = [
    [0,100,0],[100,500,50],[500,1000,65],[1000,1500,85],
    [1500,2000,95],[2000,4000,110],[4000,6000,125],
    [6000,8000,145],[8000,null,160]
  ].map(([min, maxExclusive, amount]) => ({ min, maxExclusive, amount }));
  return freeze({
    version:"rexbid-delivered-2026-10-26-v1",
    checkedAt:"2026-10-26",
    status:"owner_approved_indicative_commercial_model",
    auction:{
      copart:{
        id:"preferred_nonclean_secured_live",
        sourceUrl:"https://www.copart.com/content/us/en/member-fees-us-licensed-more",
        eligibilityUrl:"https://www.copart.com/content/us/en/member-fees-us-licensed",
        buyerBrackets:buyer,
        liveBrackets:live,
        gateUsd:95,
        environmentalUsd:15,
        titlePickupUsd:20,
        includeTitlePickup:false,
        assumptions:[
          "Szacunkowy profil Copart: Preferred, non-clean, secured, Live Bid; zastosowanie do konta wymaga potwierdzenia.",
          "Progi opłat Live zapisano jako przedziały od dolnej granicy włącznie do górnej wyłącznie.",
          "Opłata za osobisty odbiór dokumentu, magazynowanie i opóźnienia nie są wliczone."
        ]
      },
      iaai:{
        id:"owner_benchmark_copart_plus_40",
        minBidUsd:5000,
        maxBidUsd:25000,
        adjustmentUsd:40,
        anchors:[{bid:5000,fee:925},{bid:15000,fee:1210},{bid:25000,fee:1810}],
        assumptions:["Opłata IAAI jest szacunkiem według zatwierdzonych przykładów, nie oficjalną taryfą IAAI. Poza 5 000–25 000 USD wymaga indywidualnej kwoty."]
      }
    },
    route:{id:"rotterdam_standard",seaUsd:995},
    transportOverrides:[
      {platform:"copart",location:"TAMPA SOUTH",state:"FL",landUsd:485,seaUsd:995,source:"owner_supplied_benchmark_2026-10-26"},
      {platform:"iaai",location:"SAYREVILLE",state:"NJ",landUsd:275,seaUsd:995,source:"owner_supplied_benchmark_2026-10-26"}
    ],
    destinations:[
      {id:"poznan",label:"Poznań i okolice",pln:2300,source:"owner_supplied_benchmark_2026-10-26"},
      {id:"slaskie",label:"Śląskie",pln:2500,source:"owner_supplied_benchmark_2026-10-25"}
    ],
    service:{portEUR:500,commissionUsd:450,translationsPln:260,dangerousCargoUsd:100,discountPln:250},
    taxes:{
      dutyRate:0.10,
      importVatRate:0.21,
      commissionVatRate:0.23,
      excise:{iceSmall:0.031,iceLarge:0.186,hevSmall:0.0155,hybridMedium:0.093,phevExemptThrough:"2029-12-31"},
      sources:{
        duty:"https://www.kvk.nl/en/international/importing-cars-and-car-parts/",
        vat:"https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_berekenen_aan_uw_klanten/btw_berekenen/btw_tarief/btw_tarief",
        excise:"https://eli.gov.pl/api/acts/DU/2026/412/text/U/D20260412Lj.pdf"
      }
    },
    assumptions:[
      "Szacunek dla samochodu osobowego, standardowej trasy i odprawy w Holandii: cło 10%, VAT 21%.",
      "Pochodzenie, klasyfikacja pojazdu i dokumenty mogą zmienić cło. Zakup w USA ani VIN nie potwierdzają prawa do 0%.",
      "Podstawa VAT w tym modelu porównawczym obejmuje wartość celną i cło; właściwa podstawa odprawy może obejmować dodatkowe koszty.",
      "Kwoty nie obejmują napraw, dostosowania, rejestracji ani nieustalonych dopłat. Przed zakupem wymagają potwierdzenia.",
      "Rabat REXBID pomniejsza własną usługę brutto; nie zmniejsza wartości celnej ani podatków."
    ]
  });
});
