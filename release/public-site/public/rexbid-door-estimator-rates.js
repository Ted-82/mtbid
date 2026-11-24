(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  if (root) root.RexBidDoorEstimatorRates = value;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const checkedAt = "2026-09-27";
  const source = (url, confidence, assumptions) => ({ url, checked_at: checkedAt, confidence, assumptions });
  const inlandSource = source("https://www.y7agency.com/auction-to-port-transport", "medium", [
    "Mediany i percentyle przewozów standardowych aut, luty–wrzesień 2026; nie jest to oferta dla konkretnego lotu."
  ]);
  const oceanSource = source("https://www.polamerusa.com/cennik-auto-do-polski/", "low", [
    "Publiczne cenniki firmowe obejmują różne zakresy usług i warunki; zakres jest orientacyjny, nie jest ofertą Rex.Bid."
  ]);
  const destinationSource = source("https://lesniewskiauction.com/en/calculator", "low", [
    "Przykładowe komercyjne pozycje obsługi/odprawy; firmy różnie grupują koszty portowe, dokumenty i agenta."
  ]);
  const deliverySource = source("https://lesniewskiauction.com/en/calculator", "low", [
    "Punkt expected oparty o opublikowany przykład dostawy; pozostałe wartości są szerokimi założeniami scenariusza."
  ]);

  const inlandByRoute = Object.freeze({
    tx_houston_local: Object.freeze({ port: "Houston", miles: [0, 100], range: [125, 175, 200], source: inlandSource }),
    tx_dallas_houston: Object.freeze({ port: "Houston", miles: [101, 250], range: [225, 243, 290], source: inlandSource }),
    nj_newark_local: Object.freeze({ port: "Newark / Irvington", miles: [0, 100], range: [120, 125, 200], source: inlandSource }),
    ca_los_angeles: Object.freeze({ port: "Los Angeles", miles: [101, 500], range: [158, 225, 375], source: inlandSource }),
    wa_tacoma_regional: Object.freeze({ port: "Tacoma / Seattle", miles: null, range: [125, 250, 500], source: Object.freeze({ ...inlandSource, confidence: "low", assumptions: ["Brak odrębnej, potwierdzonej próbki Seattle–Tacoma; szeroki regionalny przedział planistyczny."] }) }),
    east_region: Object.freeze({ port: "Port wschodniego wybrzeża — do ustalenia", miles: null, range: [250, 525, 875], source: Object.freeze({ ...inlandSource, confidence: "low", assumptions: ["Brak facility/ZIP; szeroki przedział regionalny z ogólnych pasm odległości."] }) }),
    central_region: Object.freeze({ port: "Port eksportowy — do ustalenia", miles: null, range: [300, 550, 875], source: Object.freeze({ ...inlandSource, confidence: "low", assumptions: ["Brak facility/ZIP; szeroki przedział regionalny z ogólnych pasm odległości."] }) }),
    west_region: Object.freeze({ port: "Port zachodniego wybrzeża — do ustalenia", miles: null, range: [250, 525, 875], source: Object.freeze({ ...inlandSource, confidence: "low", assumptions: ["Brak facility/ZIP; szeroki przedział regionalny z ogólnych pasm odległości."] }) })
  });

  return Object.freeze({
    version: "rex-door-estimator-2026-09-27-v1",
    checked_at: checkedAt,
    inlandByRoute,
    fx: Object.freeze({
      provider: "NBP Table A",
      currency_pair: "USD/PLN",
      rate: 3.8404,
      checked_at: "2026-09-25",
      source_url: "https://nbp.pl/statystyka-i-sprawozdawczosc/kursy/archiwum-kursow-srednich-tabela-a/",
      confidence: "high",
      assumptions: ["Orientacyjny kurs UI, nie kurs celny ani akcyzowy."],
      refresh_endpoint: "https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json"
    }),
    auction_fees: Object.freeze({
      copart: Object.freeze({
        source_url: "https://www.copart.com/content/us/en/member-fees",
        checked_at: checkedAt,
        confidence: "low",
        assumptions: ["Przedział interpoluje publiczne przykłady clean/non-clean secured Pre-Bid; buyer profile, schedule A-D, title group, payment, live/pre-bid i opłaty warunkowe nie są ustalone."],
        anchors: Object.freeze([
          Object.freeze({ bid: 1000, low: 473, expected: 516.5, high: 600 }),
          Object.freeze({ bid: 5000, low: 928, expected: 961.5, high: 1095 }),
          Object.freeze({ bid: 10000, low: 1058, expected: 1154, high: 1400 }),
          Object.freeze({ bid: 25000, low: 2020.5, expected: 2072.75, high: 2375 }),
          Object.freeze({ bid: 50000, low: 3833, expected: 3916.5, high: 4500 })
        ])
      }),
      iaai: Object.freeze({
        source_url: "https://sidehus.com/fees/iaai/",
        secondary_source_url: "https://lesniewskiauction.com/en/vin/KMHD35LH5EU158563",
        checked_at: checkedAt,
        confidence: "low",
        assumptions: ["Rynkowy szacunek z publicznych kalkulatorów/przykładu transakcji; nie jest oficjalną tabelą IAA ani fee przypisanym do konta.", "Około 75%–140% krzywej orientacyjnej służy wyłącznie do poszerzenia widełek."],
        anchors: Object.freeze([
          Object.freeze({ bid: 675, expected: 445 }),
          Object.freeze({ bid: 10000, expected: 1200 }),
          Object.freeze({ bid: 40000, expected: 3000 })
        ])
      })
    }),
    ocean: Object.freeze({
      east: Object.freeze({ port: "Gdynia — trasa wschodniego wybrzeża", range: [1400, 1800, 2500], source: oceanSource }),
      gulf: Object.freeze({ port: "Gdynia — trasa Zatoki Meksykańskiej", range: [1400, 1800, 2500], source: source("https://lesniewskiauction.com/en/calculator", "low", ["Przykład Houston–Gdynia w kalkulatorze firmy; skorygowany szerokim zakresem, nie oferta."]) }),
      west: Object.freeze({ port: "Gdynia — trasa zachodniego wybrzeża", range: [1600, 2200, 3000], source: Object.freeze({ ...oceanSource, confidence: "low", assumptions: ["Brak porównywalnego publicznego, wiążącego cennika auta dla tej trasy; scenariusz ma niską pewność."] }) }),
      unknown: Object.freeze({ port: "Port do ustalenia", range: [1400, 2200, 3200], source: Object.freeze({ ...oceanSource, confidence: "low", assumptions: ["Port wyjściowy/linia i metoda transportu nieznane; szeroki zakres orientacyjny."] }) })
    }),
    destination: Object.freeze({ range: [450, 950, 1500], source: destinationSource }),
    poland_delivery: Object.freeze({ range: [300, 500, 800], source: deliverySource }),
    optional_insurance: Object.freeze({ fractions: [0, 0.0075, 0.015], source: source("https://vsbrothers.eu/pl/kalkulator", "low", ["Zakres opcjonalny; 1.5% występuje jako komercyjny przykład, nie uniwersalna taryfa."]) }),
    customs: Object.freeze({
      low_rate: 0,
      expected_rate: 0.10,
      high_rate: 0.10,
      source_urls: ["https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32026R1455", "https://trade.ec.europa.eu/access-to-markets/mt/results?destination=AT&origin=US&product=870350"],
      checked_at: checkedAt,
      confidence: "low",
      assumptions: ["0% to scenariusz preferencji tylko dla kwalifikującego się pochodzenia i wymaganych dowodów; 10% to scenariusz przykładowego CN 8703 erga omnes, nie domyślna stawka każdego auta."]
    }),
    tax: Object.freeze({
      vat_rate: 0.23,
      vat_source_url: "https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/taxable-amount_en",
      excise_source_url: "https://www.podatki.gov.pl/akcyza/stawki-podatkowe",
      excise_rates: Object.freeze({ passenger_up_to_2000: 0.031, passenger_over_2000: 0.186, hev_up_to_2000: 0.0155, hybrid_over_2000_to_3500: 0.093 }),
      checked_at: checkedAt,
      assumptions: ["VAT base is simplified for estimation and must not replace customs-agent calculation; includes estimated shipping, destination handling and Poland delivery to avoid falsely narrow range.", "For unclassified/hybrid/unknown powertrains the excise scenario spans 0%–18.6%; no exemption is asserted from a fuel label."]
    }),
    ranges: Object.freeze({
      sources: Object.freeze({ inland: inlandSource, ocean: oceanSource, destination: destinationSource, delivery: deliverySource })
    })
  });
});
