(function (root) {
  "use strict";

  // Display text only. Values sent to /api/cars must stay exactly as received.
  // Deliberately leave DEFAULT, ENHANCED VEHICLES and unrecognised source codes
  // unchanged; none of these is evidence that a vehicle starts or can be driven.
  const dictionaries = {
    fuel: new Map([
      ["gas", "Benzyna"], ["gasoline", "Benzyna"], ["petrol", "Benzyna"],
      ["diesel", "Diesel"], ["electric", "Elektryczny — BEV"],
      ["hybrid", "Hybryda"], ["electric and gas hybrid", "Hybryda"], ["hybrid engine", "Hybryda"],
      ["hev", "Hybryda — HEV"], ["phev", "Hybryda plug-in — PHEV"],
      ["flex fuel", "Flex fuel"], ["flexible", "Flex fuel"], ["flexible fuel", "Flex fuel"], ["flexiblefuel", "Flex fuel"],
      ["compressed natural gas", "Gaz ziemny — CNG"], ["hydrogen fuel cell", "Wodorowe ogniwo paliwowe"],
      ["other", "Inne"], ["unknown", "Nieustalone"]
    ]),
    transmission: new Map([
      ["automatic", "Automatyczna"], ["automatic transmission", "Automatyczna"],
      ["manual", "Manualna"], ["manual transmission", "Manualna"],
      ["none", "Nie wskazano skrzyni biegów"], ["unknown", "Nieustalona"], ["other", "Inna"]
    ]),
    damage: new Map([
      ["all over", "Uszkodzenia na całym pojeździe"],
      ["biohazard", "Zagrożenie biologiczne"], ["biohazard/chemical", "Zagrożenie biologiczne / chemiczne"],
      ["burn", "Pożar"], ["burn - engine", "Pożar silnika"], ["engine burn", "Pożar silnika"],
      ["burn - interior", "Pożar wnętrza"], ["interior burn", "Pożar wnętrza"], ["exterior burn", "Nadpalenia zewnętrzne"],
      ["total burn", "Całkowite spalenie"], ["damage history", "Historia uszkodzeń"],
      ["electrical", "Instalacja elektryczna"], ["engine damage", "Uszkodzenie silnika"],
      ["flood", "Zalanie"], ["water/flood", "Zalanie"], ["fresh water", "Zalanie słodką wodą"], ["salt water", "Zalanie słoną wodą"],
      ["frame damage", "Uszkodzenie ramy"], ["front & rear", "Przód i tył"],
      ["front", "Przód"], ["front end", "Przód"], ["rear", "Tył"], ["rear end", "Tył"],
      ["left & right side", "Lewa i prawa strona"], ["left front", "Lewy przód"], ["left rear", "Lewy tył"],
      ["right front", "Prawy przód"], ["right rear", "Prawy tył"], ["left side", "Lewa strona"], ["right side", "Prawa strona"],
      ["side", "Bok"], ["roof", "Dach"], ["top/roof", "Dach"], ["hail", "Grad"],
      ["mechanical", "Uszkodzenia mechaniczne"], ["minor dent/scratches", "Drobne wgniecenia / zarysowania"],
      ["none", "Nie wskazano uszkodzeń"], ["normal wear", "Ślady użytkowania"], ["normal wear & tear", "Ślady użytkowania"],
      ["repossession", "Odebranie przez wierzyciela"], ["rollover", "Dachowanie"], ["storm damage", "Uszkodzenia po burzy"],
      ["strip", "Brakujące elementy"], ["stripped", "Brakujące elementy"], ["suspension", "Zawieszenie"],
      ["theft", "Kradzież"], ["transmission damage", "Uszkodzenie skrzyni biegów"], ["undercarriage", "Podwozie"],
      ["vandalism", "Wandalizm"], ["vandalized", "Wandalizm"], ["other", "Inne"], ["unknown", "Nieustalone"]
    ]),
    body: new Map([
      ["kind:car", "Samochody"], ["kind:motorcycle", "Motocykle"], ["kind:atv", "ATV / quady"],
      ["2dr sport utility", "SUV 2-drzwiowy"], ["4dr sport utility", "SUV 4-drzwiowy"],
      ["4dr ext cab pickup", "Pickup 4-drzwiowy, wydłużona kabina"],
      ["atv", "ATV / quad"], ["automobile", "Samochód"], ["boat", "Łódź"], ["bus", "Autobus"],
      ["cab chassis", "Podwozie z kabiną"], ["chassis and cab", "Podwozie z kabiną"],
      ["cargo van", "Furgon towarowy"], ["van cargo", "Furgon towarowy"], ["van passenger", "Van osobowy"],
      ["commercial truck", "Samochód ciężarowy"], ["truck", "Samochód ciężarowy"],
      ["compact car", "Samochód kompaktowy"], ["compact luxury car", "Samochód kompaktowy premium"],
      ["convertible", "Kabriolet"], ["convertible/suv", "Kabriolet / SUV"], ["convertible/truck", "Kabriolet / pojazd ciężarowy"],
      ["coupe", "Coupé"], ["coupe 3d", "Coupé 3-drzwiowe"], ["coupe 3dr", "Coupé 3-drzwiowe"],
      ["crossover", "Crossover"], ["extended cargo van", "Wydłużony furgon towarowy"],
      ["farm equipment", "Maszyny rolnicze"], ["fire truck", "Wóz strażacki"],
      ["full size car", "Duży samochód osobowy"], ["full size luxury car", "Duży samochód osobowy premium"],
      ["hatchback", "Hatchback"], ["hatchback 2dr", "Hatchback 2-drzwiowy"], ["hatchback 4dr", "Hatchback 4-drzwiowy"],
      ["hatchback/crossover", "Hatchback / crossover"], ["heavy equipment", "Ciężki sprzęt"],
      ["incomplete chassis", "Niekompletne podwozie"], ["mid size car", "Samochód klasy średniej"],
      ["mid size pickup", "Pickup średniej wielkości"], ["mini-van", "Minivan"], ["minivan", "Minivan"],
      ["motor home", "Kamper"], ["motorized home", "Kamper"], ["motorcycle", "Motocykl"], ["motorcycle - scooter", "Skuter"],
      ["personal watercraft", "Skuter wodny"], ["pickup", "Pickup"], ["sedan", "Sedan"],
      ["sedan 4 dr.", "Sedan 4-drzwiowy"], ["sedan 4d", "Sedan 4-drzwiowy"], ["sedan 4dr", "Sedan 4-drzwiowy"],
      ["sedan/hatchback", "Sedan / hatchback"], ["side by side", "UTV / side-by-side"],
      ["sport utility", "SUV"], ["sport utility vehicle", "SUV"], ["suv", "SUV"],
      ["suv/crossover", "SUV / crossover"], ["suv/wagon/crossover", "SUV / kombi / crossover"],
      ["station wagon", "Kombi"], ["wagon", "Kombi"], ["wagon/crossover", "Kombi / crossover"], ["wagon/hatchback", "Kombi / hatchback"],
      ["tractor truck", "Ciągnik siodłowy"], ["truck tractor", "Ciągnik siodłowy"],
      ["trailer", "Przyczepa"], ["travel trailer", "Przyczepa kempingowa"], ["van", "Van"],
      ["other", "Inne"], ["unknown", "Nieustalone"]
    ]),
    seller: new Map([
      ["insurance", "Ubezpieczyciel"], ["insurance company", "Ubezpieczyciel"], ["ins", "Ubezpieczyciel"],
      ["non_insurance", "Podmiot nieubezpieczeniowy"], ["non-insurance", "Podmiot nieubezpieczeniowy"], ["nins", "Podmiot nieubezpieczeniowy"],
      ["rcc", "Typ nieustalony (kod RCC)"], ["unknown", "Nieustalone"], ["other", "Inne"]
    ]),
    run: new Map([
      ["run & drive", "Odnotowano uruchomienie i jazdę"],
      ["run and drive", "Odnotowano uruchomienie i jazdę"],
      ["runs and drives", "Odnotowano uruchomienie i jazdę"],
      ["run & drive verified", "Odnotowano uruchomienie i jazdę"],
      ["starts", "Odnotowano uruchomienie"],
      ["vehicle starts", "Odnotowano uruchomienie"],
      ["engine start program", "Odnotowano uruchomienie"],
      ["stationary", "Uruchomienie niepotwierdzone"],
      ["stationary / no information", "Uruchomienie niepotwierdzone"],
      ["unknown", "Nieustalone"]
    ]),
    drive: new Map([
      ["front wheel drive", "Przedni — FWD"],
      ["front-wheel drive", "Przedni — FWD"],
      ["fwd", "Przedni — FWD"],
      ["rear wheel drive", "Tylny — RWD"],
      ["rear-wheel drive", "Tylny — RWD"],
      ["rwd", "Tylny — RWD"],
      ["all wheel drive", "Na wszystkie koła — AWD"],
      ["awd", "Na wszystkie koła — AWD"],
      ["four wheel drive", "4×4"],
      ["four by four", "4×4"],
      ["4wd", "4×4"],
      ["4x4", "4×4"],
      ["4x4 drive", "4×4"],
      ["4x2", "4×2"],
      ["4x2 drive", "4×2"],
      ["unknown", "Nieustalone"]
    ])
  };
  const text = value => typeof value === "string" || typeof value === "number" ? String(value) : "";
  const key = value => text(value).trim().toLowerCase().replace(/\s+/g, " ");
  // sale_document.type currently carries these presentation/unspecified codes.
  // Neither a colour nor "other" identifies a legal document or export right.
  const unusableDocumentTypes = new Set(["danger", "success", "warning", "info", "primary", "secondary", "default", "other", "unknown", "none"]);
  function isUnusableDocumentType(value) { return unusableDocumentTypes.has(key(value)); }

  function label(kind, value, fallback = value) {
    if (kind === "document" && isUnusableDocumentType(value)) return `Typ nieustalony (kod źródła: ${text(value)})`;
    const dictionary = Object.prototype.hasOwnProperty.call(dictionaries, kind) ? dictionaries[kind] : null;
    const translated = dictionary?.get(key(value));
    if (kind === "body" && translated && text(fallback).startsWith("Nadwozie: ")) return `Nadwozie: ${translated}`;
    return translated ?? text(fallback);
  }

  // Mirrors only drive predicates in sync/d1-read-repository.js. Internal
  // whitespace is significant; fallback SQLite lower() folds ASCII only.
  const d1DriveGroups = [
    ["all wheel drive", "awd"],
    ["front wheel drive", "front-wheel drive", "fwd"],
    ["rear wheel drive", "rear-wheel drive", "rwd"],
    ["four wheel drive", "four by four", "4wd"]
  ];
  function d1DrivePredicate(value) {
    const trimmed = value.trim();
    const group = d1DriveGroups.findIndex(items => items.includes(trimmed.toLowerCase()));
    return group >= 0 ? `group:${group}` : `equal:${trimmed.replace(/[A-Z]/g, char => char.toLowerCase())}`;
  }

  function options(kind, items, context = {}) {
    if (!Array.isArray(items)) return [];
    const unique = new Map();
    for (const item of items) {
      if (!item || typeof item.value !== "string" || !item.value.trim() || unique.has(item.value)) continue;
      if (kind === "document" && isUnusableDocumentType(item.value) && item.value !== context.selectedValue) continue;
      unique.set(item.value, {...item, label: label(kind, item.value, item.label ?? item.value)});
    }
    if (kind === "drive" && context?.read_source === "d1" && context.known_rows_only === true) {
      const selected = typeof context.selectedValue === "string" ? context.selectedValue : "";
      const selectedKey = selected.trim() ? d1DrivePredicate(selected) : null;
      const groups = new Map();
      for (const item of unique.values()) {
        const predicate = d1DrivePredicate(item.value);
        if (groups.has(predicate)) continue;
        // Keep the exact URL/current value even when metadata contains only an
        // equivalent alias. Otherwise the renderer would add a duplicate back.
        groups.set(predicate, predicate === selectedKey
          ? unique.get(selected) || {value: selected, label: label(kind, selected)}
          : item);
      }
      unique.clear();
      for (const item of groups.values()) unique.set(item.value, item);
    }
    const frequencies = new Map();
    for (const item of unique.values()) frequencies.set(item.label, (frequencies.get(item.label) || 0) + 1);
    // Equal labels alone never establish equivalent backend filters.
    return [...unique.values()].map(item => frequencies.get(item.label) > 1
      ? {...item, label: `${item.label} (${item.value})`} : item);
  }

  const api = Object.freeze({label, options, isUnusableDocumentType});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RexBidVehicleLabels = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
