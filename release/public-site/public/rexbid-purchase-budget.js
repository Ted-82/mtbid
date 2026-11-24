(function (root) {
  "use strict";
  const page = root.document.querySelector("[data-purchase-budget]");
  if (!page) return;
  const q = selector => page.querySelector(selector);
  const form = q("[data-purchase-form]");
  const status = q("[data-purchase-status]");
  const matches = q("[data-purchase-matches]");
  const selected = q("[data-purchase-selected]");
  const title = q("#purchase-vehicle");
  const identity = q("[data-purchase-identity]");
  const original = q("[data-purchase-original]");
  const calculator = q("[data-purchase-calculator]");
  let pending;
  let vehicle;
  let binding;

  function reference(car) {
    const lot = String(car?.lot_number || "");
    const platform = car?.platform;
    const vin = String(car?.vin || "").trim().toUpperCase();
    if (!/^\d{6,12}$/.test(lot) || !["copart", "iaai"].includes(platform)) return null;
    return {lot, platform, vin};
  }

  function description(ref) {
    return ref.platform.toUpperCase() + " · LOT " + ref.lot + (ref.vin ? " · VIN " + ref.vin : "");
  }

  async function get(path, signal) {
    const response = await fetch(path, {signal, credentials:"omit", headers:{Accept:"application/json"}});
    if (!response.ok) throw new Error("Nie udało się pobrać danych oferty. Spróbuj ponownie.");
    const body = await response.json();
    if (body.ok !== true) throw new Error("Katalog jest chwilowo niedostępny. Spróbuj ponownie.");
    return body;
  }

  function clearSelection() {
    vehicle = null;
    binding = null;
    selected.hidden = true;
    calculator.replaceChildren();
  }

  async function run(message, work) {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    status.textContent = message;
    const timer = setTimeout(() => controller.abort(), 15000);
    const current = () => pending === controller;
    try {
      await work(controller.signal, current);
    } catch (error) {
      if (current()) status.textContent = error.name === "AbortError"
        ? "Pobieranie trwało zbyt długo. Spróbuj ponownie."
        : (error.message || "Nie udało się pobrać oferty. Spróbuj ponownie.");
    } finally {
      clearTimeout(timer);
      if (current()) pending = null;
    }
  }

  async function showOffer(ref, signal, current) {
    clearSelection();
    status.textContent = "Pobieram dane wybranego samochodu…";
    const detail = await get("/api/car/" + encodeURIComponent(ref.lot) + "?" + new URLSearchParams({platform:ref.platform}), signal);
    if (!current()) return;
    const exact = reference(detail.data);
    if (!exact || exact.lot !== ref.lot || exact.platform !== ref.platform || (ref.vin && exact.vin !== ref.vin)) {
      throw new Error("Katalog nie potwierdził tożsamości oferty. Sprawdź VIN, LOT i platformę.");
    }
    vehicle = {...exact, title: String(detail.data.title || "Wybrany samochód")};
    title.textContent = vehicle.title;
    identity.textContent = description(exact);
    original.href = "/car?" + new URLSearchParams({lot:exact.lot,platform:exact.platform});
    binding = root.RexBidDeliveredView.bindCalculator({root:calculator,vehicle:detail.data,mode:"budget",budgetPln:form.elements.budget.value});
    if (!binding) throw new Error("Kalkulator jest chwilowo niedostępny.");
    binding.setPriceKind("custom");
    selected.hidden = false;
    status.textContent = "";
    title.focus();
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    pending?.abort();
    pending = null;
    clearSelection();
    matches.replaceChildren();
    const identifier = form.elements.identifier.value.trim().toUpperCase();
    const platform = form.elements.platform.value;
    const vinSearch = /^[A-HJ-NPR-Z0-9]{17}$/.test(identifier);
    if (!vinSearch && !/^\d{6,12}$/.test(identifier)) {
      status.textContent = "Wpisz pełny VIN (17 znaków) albo numer LOT (6–12 cyfr).";
      return;
    }
    run("Szukam oferty w katalogu REXBID…", async (signal, current) => {
      const params = new URLSearchParams({s:identifier,view:"cards",per_page:"20"});
      if (platform) params.set("platform",platform);
      const result = await get("/api/cars?" + params, signal);
      if (!current()) return;
      const found = new Map();
      for (const car of Array.isArray(result.data) ? result.data : []) {
        const ref = reference(car);
        if (!ref || (platform && ref.platform !== platform) || (vinSearch ? ref.vin !== identifier : ref.lot !== identifier)) continue;
        found.set(ref.platform + ":" + ref.lot,{ref,car});
      }
      if (!found.size) {
        status.textContent = "Brak dokładnie pasującej oferty w katalogu. Sprawdź numer lub wybierz obie platformy.";
        return;
      }
      if (found.size === 1 && !result.meta?.next_cursor) {
        await showOffer(found.values().next().value.ref,signal,current);
        return;
      }
      status.textContent = "Wybierz ofertę, dla której chcesz policzyć koszt.";
      for (const {ref,car} of found.values()) {
        const button = root.document.createElement("button");
        button.type = "button";
        button.textContent = String(car.title || "Samochód") + " · " + description(ref);
        button.addEventListener("click", () => run("Pobieram ofertę…", (signal,current) => showOffer(ref,signal,current)));
        matches.append(button);
      }
    });
  });

  form.elements.budget.addEventListener('input',()=>{
    binding?.setBudget(form.elements.budget.value);
  });
  calculator.addEventListener("rexbid:budget-update", event => {
    const {detail} = event;
    if (!vehicle || String(detail.lot) !== vehicle.lot || detail.platform !== vehicle.platform) return;
    const link = calculator.querySelector("[data-v4-inquiry]");
    if (!link) return;
    const params = new URLSearchParams({...vehicle,source:"vehicle"});
    const values = {
      purchase_usd: detail.purchasePriceUsd, price_kind:detail.priceKind, price_status:detail.priceStatus,
      price_observed_at:detail.priceObservedAt, budget_pln:detail.budget?.knownTotalPln,
      budget_status:detail.budget?.complete ? "complete" : "partial", delivery_destination:detail.deliveryDestination,
      delivery_pln:detail.deliveryPln, fx_usd_pln:detail.budget?.usdPln
    };
    for (const [key,value] of Object.entries(values)) {
      if (value !== null && value !== undefined && value !== "") params.set(key,String(value));
    }
    link.href = "/kontakt?" + params + root.RexBidDeliveredView.customerBudgetFragment(detail);
  });
})(globalThis);
