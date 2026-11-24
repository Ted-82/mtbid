(function (root, factory) {
  const rates = factory();
  if (typeof module === "object" && module.exports) module.exports = rates;
  if (root) root.RexBidCalculatorV3Rates = rates;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const unavailable = (currency, reason) => Object.freeze({ amount: null, currency, status: "unknown", source_kind: null, source_url: null, checked_at: null, effective_from: null, notes: reason });
  return Object.freeze({
    version: "rex-calculator-v3-config-1",
    source: "Rex.Bid configuration; empty until an approved rate is entered",
    effective_from: null,
    auction: Object.freeze({
      copart: Object.freeze({ status: "configurable", profile_required: true, profile_source: "public Copart member-fee schedules; applicability depends on account, sale, vehicle, payment and bid mode", source_url: "https://www.copart.com/content/us/en/member-fees", checked_at: "2026-09-30", effective_from: null }),
      iaai: Object.freeze({ status: "unknown", profile_required: true, source_url: null, checked_at: null, effective_from: null })
    }),
    fx: Object.freeze({
      indicative_usd_pln: unavailable("PLN per USD", "Presentation only; no live/configured value."),
      indicative_eur_pln: unavailable("PLN per EUR", "Presentation only; no live/configured value."),
      customs_usd_pln: unavailable("PLN per USD", "Set from the legally applicable customs rate for the clearance period."),
      excise_usd_pln: unavailable("PLN per USD", "Set from the legally applicable excise conversion rule and event date.")
    }),
    import_costs: Object.freeze({
      port_handling: unavailable("USD", "Wymaga aktualnej oferty partnera/importera."),
      broker: unavailable("USD", "Wymaga aktualnej oferty agenta celnego."),
      unloading_container: unavailable("USD", "Wymaga aktualnej oferty partnera/importera."),
      documentation: unavailable("USD", "Wymaga aktualnej oferty partnera/importera."),
      other_import: unavailable("USD", "Wymaga jawnego kosztu lub potwierdzenia braku kosztu.")
    }),
    poland_delivery: Object.freeze({ type: "zone_or_distance", amount: null, currency: "PLN", status: "unknown", source_kind: null, source_url: null, checked_at: null, effective_from: null, notes: "Strefowy/kilometrowy cennik dostawy w Polsce nie jest jeszcze dostępny." })
  });
});
