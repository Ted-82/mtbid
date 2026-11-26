(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RexBidImportBudget = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // These are entered amounts, not assumed rates. Blank and invalid values stay
  // unknown; an explicit zero means the user has included a zero-cost item.
  const FIELDS = Object.freeze([
    Object.freeze({key:"customsDutyPln", label:"Cło", hint:"Kwota z wyceny odprawy"}),
    Object.freeze({key:"importVatPln", label:"VAT importowy", hint:"Kwota z wyceny odprawy"}),
    Object.freeze({key:"excisePln", label:"Akcyza", hint:"Wpisz 0, jeśli potwierdzono zwolnienie"}),
    Object.freeze({key:"portCustomsPln", label:"Port i obsługa odprawy", hint:"Łączna kwota z wyceny"}),
    Object.freeze({key:"servicePln", label:"Obsługa importu", hint:"Kwota brutto z wyceny"}),
    Object.freeze({key:"deliveryPln", label:"Dostawa w Polsce", hint:"Kwota brutto do miejsca odbioru"})
  ]);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const rounded = amount => Math.round((amount + Number.EPSILON) * 100) / 100;
  const money = (amount, currency) => amount === null || amount === undefined
    ? "Do uzupełnienia" : new Intl.NumberFormat("pl-PL", {style:"currency", currency, maximumFractionDigits:2}).format(amount);

  function amount(value) {
    if (value === null || value === undefined || typeof value === "boolean") return null;
    const normalized = String(value).trim().replace(/[\s\u00a0]/g, "").replace(",", ".");
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
    const result = Number(normalized);
    return Number.isFinite(result) && result >= 0 ? result : null;
  }

  function calculateBudget(input = {}) {
    const purchasePriceUsd = amount(input.purchasePriceUsd);
    const auctionFeeUsd = amount(input.auctionFeeUsd);
    const transportUsd = amount(input.transportUsd);
    const rate = amount(input.usdPln);
    const usdPln = rate !== null && rate > 0 ? rate : null;
    const values = Object.fromEntries(FIELDS.map(field => [field.key, amount(input[field.key])]));
    const usdParts = [purchasePriceUsd, auctionFeeUsd, transportUsd].filter(value => value !== null);
    const usdSubtotal = usdParts.length ? rounded(usdParts.reduce((sum, value) => sum + value, 0)) : null;
    const enteredPln = Object.values(values).filter(value => value !== null);
    const additionalPln = enteredPln.length ? rounded(enteredPln.reduce((sum, value) => sum + value, 0)) : null;
    const convertedUsdPln = usdPln !== null && usdSubtotal !== null ? rounded(usdSubtotal * usdPln) : null;
    const knownPlnParts = [convertedUsdPln, additionalPln].filter(value => value !== null);
    const knownTotalPln = knownPlnParts.length ? rounded(knownPlnParts.reduce((sum, value) => sum + value, 0)) : null;
    const missing = [];
    if (purchasePriceUsd === null) missing.push("cena pojazdu");
    if (auctionFeeUsd === null) missing.push("opłaty aukcyjne");
    if (transportUsd === null || input.transportComplete !== true) missing.push("potwierdzony pełny transport USA i morski");
    if (usdPln === null) missing.push("kurs USD/PLN");
    for (const field of FIELDS) if (values[field.key] === null) missing.push(field.label.toLowerCase());
    return Object.freeze({purchasePriceUsd, auctionFeeUsd, transportUsd, usdPln,
      values:Object.freeze(values), usdSubtotal, additionalPln, convertedUsdPln,
      knownTotalPln, complete:missing.length === 0, missing:Object.freeze(missing)});
  }

  function formatBreakdown({vehicle = {}, context = {}, budget = calculateBudget()} = {}) {
    const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.title || "Pojazd";
    const lot = vehicle.lot_number ?? vehicle.lot ?? vehicle.auction?.lot_number ?? "";
    const platform = vehicle.platform ?? vehicle.auction?.platform ?? "";
    const variant = context.variant || {};
    const snapshot = context.priceStatus === "snapshot" || (context.priceStatus !== "current"
      && (vehicle.preview?.read_only === true || vehicle.read?.read_only === true || vehicle.read_only === true
        || (vehicle.read?.source === "d1" && vehicle.read.freshness !== "fresh")));
    const priceKind = {current:snapshot ? "ostatnia zapisana oferta" : "aktualna oferta aukcyjna",
      "buy-now":snapshot ? "Kup teraz · zapis danych" : "Kup teraz", custom:"własna planowana cena"}[context.priceKind] || "wpisana cena";
    const validObservation = value => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return "";
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime())) return "";
      const canonical = parsed.toISOString();
      return value.slice(0,19) === canonical.slice(0,19) ? canonical : "";
    };
    const observedAt = validObservation(context.priceObservedAt);
    const result = ["REXBID — zestawienie budżetu", title,
      lot ? `LOT: ${lot}${platform ? ` · ${String(platform).toUpperCase()}` : ""}` : "",
      vehicle.vin ? `VIN: ${vehicle.vin}` : "",
      `Cena pojazdu (${priceKind}): ${money(budget.purchasePriceUsd, "USD")}`,
      context.priceKind !== "custom" && observedAt ? `Dane ceny zapisane: ${observedAt}` : "",
      context.priceKind !== "custom" && snapshot ? "Cena pochodzi z zapisu danych. Bieżącą cenę i dostępność potwierdź w oryginalnej aukcji." : "",
      `Opłaty aukcyjne: ${money(budget.auctionFeeUsd, "USD")}`,
      `Transport lądowy USA: ${money(variant.land_usd ?? null, "USD")}`,
      `Fracht morski: ${money(variant.sea_usd ?? null, "USD")}`,
      `Pakowanie dla napędu: ${variant.ev_packing?.status === "not_applicable" ? "Nie dotyczy" : money(variant.ev_packing?.amount_usd ?? null, "USD")}`,
      `Znana suma USD: ${money(budget.usdSubtotal, "USD")}`,
      `Kurs wpisany przez użytkownika: ${budget.usdPln === null ? "Do uzupełnienia" : `${budget.usdPln} PLN / USD`}`,
      ...FIELDS.map(field => `${field.label}: ${money(budget.values[field.key], "PLN")}`),
      `Suma znanych kwot: ${money(budget.knownTotalPln, "PLN")}`,
      budget.complete ? "Wszystkie pola budżetu uzupełniono. Kwoty dodatkowe oraz kurs zostały wpisane przez użytkownika."
        : `Budżet częściowy. Do uzupełnienia: ${budget.missing.join(", ")}.`,
      "Zestawienie do weryfikacji przed zakupem. Nie stanowi oferty REXBID; nie obejmuje napraw ani rejestracji.",
      context.calculation?.rate_version ? `Wersja stawek transportu: ${context.calculation.rate_version}` : ""];
    return result.filter(Boolean).join("\n");
  }

  function bindBudget({root:mount, vehicle = {}, onChange = null} = {}) {
    if (!mount || typeof mount.querySelectorAll !== "function") return null;
    mount.innerHTML = `<details class="import-budget"><summary>Uzupełnij swój budżet w PLN</summary>
      <p class="import-budget-intro">Masz wycenę pozostałych kosztów? Wpisz kwoty, aby zebrać budżet w jednym miejscu. Zakup, aukcja i transport pochodzą z kalkulatora powyżej. Każdą opłatę dodaj tylko raz: sprawdź, co obejmuje pakiet portu, brokera i dokumentów.</p>
      <div class="import-budget-grid"><label>Kurs USD/PLN<input data-budget-field="usdPln" type="number" min="0.0001" step="0.0001" inputmode="decimal" placeholder="Np. 3,90"><small>Wpisz kurs, po którym planujesz rozliczyć zakup.</small></label>
      ${FIELDS.map(field => `<label>${escapeHtml(field.label)} (PLN)<input data-budget-field="${field.key}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Do uzupełnienia"><small>${escapeHtml(field.hint)}</small></label>`).join("")}</div>
      <p class="import-budget-intro">Puste pole oznacza brak kwoty. Wpisz 0 wyłącznie, gdy potwierdzono brak opłaty. Podatki wpisz według wyceny właściwej dla pojazdu i miejsca odprawy.</p>
      <div class="import-budget-result" role="status" aria-live="polite" aria-atomic="true"><span data-budget-label>Suma znanych kwot w PLN</span><strong data-budget-total>Do uzupełnienia</strong><p data-budget-missing></p></div>
      <p class="import-budget-intro">To szacunek na podstawie wpisanych kwot. Uzupełnienie pól nie potwierdza zakresu wyceny partnera. Koszty napraw i rejestracji planujesz osobno.</p>
      <div class="import-budget-actions"><button type="button" data-budget-copy>Kopiuj zestawienie</button><button type="button" data-budget-download>Pobierz zestawienie</button></div>
      <p class="import-budget-status" data-budget-action-status role="status" aria-live="polite"></p></details>`;
    const fields = [...mount.querySelectorAll("[data-budget-field]")];
    let context = {};
    let current = calculateBudget();
    const inputValues = () => Object.fromEntries(fields.map(node => [node.getAttribute("data-budget-field"), node.value]));
    function update(next = context) {
      context = next;
      current = calculateBudget({...inputValues(), purchasePriceUsd:context.purchasePriceUsd,
        auctionFeeUsd:context.auctionFeeUsd, transportUsd:context.variant?.known_amount_usd ?? context.variant?.amount_usd,
        transportComplete:context.variant?.amount_usd !== null && context.variant?.amount_usd !== undefined});
      for (const node of fields) {
        const key = node.getAttribute("data-budget-field");
        const valid = key === "usdPln" ? current.usdPln !== null : current.values[key] !== null;
        node.setAttribute("aria-invalid", String(node.value.trim() !== "" && !valid));
      }
      mount.querySelector("[data-budget-label]").textContent = current.complete ? "Budżet według wpisanych kwot" : "Suma znanych kwot w PLN · częściowo";
      mount.querySelector("[data-budget-total]").textContent = money(current.knownTotalPln, "PLN");
      mount.querySelector("[data-budget-missing]").textContent = current.complete
        ? "Wszystkie pola uzupełniono. To szacunek — potwierdź zakres usług, kwoty i kurs przed zakupem."
        : `Budżet niekompletny. Brakujące kwoty nie oznaczają 0. Do uzupełnienia: ${current.missing.join(", ")}.`;
      return current;
    }
    const exportText = () => formatBreakdown({vehicle, context, budget:current});
    fields.forEach(node => node.addEventListener("input", () => { update(); if (onChange) onChange(current); }));
    mount.querySelector("[data-budget-copy]").addEventListener("click", async () => {
      const status = mount.querySelector("[data-budget-action-status]");
      try {
        if (!globalThis.navigator?.clipboard?.writeText) throw new Error("clipboard_unavailable");
        await globalThis.navigator.clipboard.writeText(exportText());
        status.textContent = "Zestawienie skopiowane. Możesz dołączyć je do zapytania.";
      } catch (_) { status.textContent = "Nie udało się skopiować. Pobierz zestawienie jako plik tekstowy."; }
    });
    mount.querySelector("[data-budget-download]").addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([exportText()], {type:"text/plain;charset=utf-8"}));
      const link = document.createElement("a");
      const lot = String(vehicle.lot_number ?? vehicle.lot ?? "pojazd").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "pojazd";
      link.href = url; link.download = `REXBID-budzet-${lot}.txt`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      mount.querySelector("[data-budget-action-status]").textContent = "Zestawienie pobrane. Możesz dołączyć je do zapytania.";
    });
    update();
    return Object.freeze({update, current:() => current, exportText});
  }

  return Object.freeze({fields:FIELDS, amount, calculateBudget, formatBreakdown, bindBudget});
});
