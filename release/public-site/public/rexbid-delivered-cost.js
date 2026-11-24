(function (root, factory) {
  "use strict";
  const rates = typeof module === "object" && module.exports
    ? require("./rexbid-delivered-rates.js") : root.RexBidDeliveredRates;
  const api = factory(rates);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RexBidDeliveredCost = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (RATES) {
  "use strict";
  const round = value => value === null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
  function amount(value, positive = false) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
    const parsed = Number(typeof value === "string" ? value.trim() : value);
    return Number.isFinite(parsed) && parsed <= Number.MAX_SAFE_INTEGER && (positive ? parsed > 0 : parsed >= 0) ? parsed : null;
  }
  function fraction(value) {
    const parsed = amount(value);
    return parsed !== null && parsed <= 1 ? parsed : null;
  }
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value ? value : null;
  }
  function product(...values) {
    if (values.some(value => value === null)) return null;
    const result = values.reduce((total, value) => total * value, 1);
    return Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER ? result : null;
  }
  function sum(values) {
    if (values.some(value => value === null)) return null;
    const total = values.reduce((subtotal,value) => subtotal + value,0);
    return Number.isFinite(total) && Math.abs(total) <= Number.MAX_SAFE_INTEGER ? total : null;
  }
  function bandFee(bid, bands) {
    if (!Array.isArray(bands)) return null;
    const matches = bands.filter(band => band && amount(band.min) !== null &&
      (band.maxExclusive === null || (amount(band.maxExclusive,true) !== null && band.maxExclusive > band.min)) &&
      bid >= band.min && (band.maxExclusive === null || bid < band.maxExclusive));
    if (matches.length !== 1) return null;
    const band = matches[0];
    if (band.rate !== undefined && band.amount !== undefined) return null;
    return band.rate !== undefined ? product(bid,fraction(band.rate)) : amount(band.amount);
  }
  function auctionFee(input = {}, profile = RATES) {
    if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
    const platform = typeof input.platform === "string" ? input.platform.trim().toLowerCase() : "";
    const bid = amount(input.purchaseUsd,true);
    const assumptions = [];
    const fail = reason => ({amountUsd:null,status:"unknown",missing:[reason],assumptions});
    if (bid === null) return fail("Podaj prawidłową cenę pojazdu w USD.");
    if (!["copart","iaai"].includes(platform)) return fail("Wybierz platformę Copart lub IAAI.");
    if (input.auctionFeeOverrideUsd !== undefined) {
      const manual = amount(input.auctionFeeOverrideUsd);
      return manual === null ? fail("Podaj prawidłową indywidualną opłatę aukcyjną.") :
        {amountUsd:manual,status:"manual_estimate",missing:[],assumptions:["Opłata aukcyjna została podana indywidualnie i wymaga potwierdzenia."]};
    }
    const copart = profile?.auction?.copart;
    if (!copart) return fail("Brak profilu opłat aukcyjnych.");
    const components = [bandFee(bid,copart.buyerBrackets),bandFee(bid,copart.liveBrackets),amount(copart.gateUsd),amount(copart.environmentalUsd)];
    const includeTitlePickup = profile.auction[platform]?.includeTitlePickup;
    if (typeof includeTitlePickup !== "boolean") return fail("Nieprawidłowe ustawienie odbioru dokumentu aukcyjnego.");
    if (includeTitlePickup) components.push(amount(copart.titlePickupUsd));
    if (platform === "iaai") {
      const iaai = profile?.auction?.iaai;
      if (!iaai || amount(iaai.minBidUsd,true) === null || amount(iaai.maxBidUsd,true) === null ||
        bid < iaai.minBidUsd || bid > iaai.maxBidUsd) return fail("Dla tej kwoty IAAI podaj indywidualną opłatę aukcyjną.");
      components.push(amount(iaai.adjustmentUsd));
      assumptions.push(...(Array.isArray(iaai.assumptions) ? iaai.assumptions : []));
    } else assumptions.push(...(Array.isArray(copart.assumptions) ? copart.assumptions : []));
    const result = sum(components);
    return result === null ? fail("Brak prawidłowej stawki opłaty aukcyjnej.") :
      {amountUsd:result,status:"estimate",missing:[],assumptions};
  }
  function excise(input = {}, profile = RATES) {
    if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
    const type = typeof input.powertrain === "string" ? input.powertrain.trim().toUpperCase() : "UNKNOWN";
    const rates = profile?.taxes?.excise;
    const base = amount(input.exciseBasePln);
    const cc = amount(input.engineCc,true);
    const confirmed = input.exemptionConfirmed === true;
    const estimatedElectric = input.exemptionBasis === "vin_electric_estimate" && ["BEV","FCEV"].includes(type);
    const fail = reason => ({amountPln:null,rate:null,missing:[reason],assumptions:[]});
    if (input.exemptionConfirmed !== undefined && typeof input.exemptionConfirmed !== "boolean") return fail("Potwierdzenie zwolnienia akcyzowego jest nieprawidłowe.");
    if (!rates) return fail("Brak konfiguracji akcyzy.");
    if (!["ICE","HEV","PHEV","BEV","FCEV"].includes(type)) return fail("Potwierdź rodzaj napędu dla akcyzy.");
    if (type === "BEV" || type === "FCEV") {
      return confirmed || estimatedElectric ? {amountPln:0,rate:0,missing:[],assumptions:[confirmed?"Przyjęto potwierdzone dokumentami zwolnienie akcyzowe pojazdu elektrycznego lub wodorowego.":"Szacunek zakłada zwolnienie pojazdu elektrycznego lub wodorowego na podstawie danych VIN. Dokumenty zwolnienia nie zostały zweryfikowane."]} : fail("Potwierdź dokumenty zwolnienia akcyzowego pojazdu elektrycznego lub wodorowego.");
    }
    if (cc === null) return fail("Podaj pojemność silnika dla akcyzy.");
    let rate = null;
    if (type === "PHEV" && cc <= 2000) {
      const taxDate = date(input.taxDate);
      const until = date(rates.phevExemptThrough);
      if (taxDate === null || until === null) return fail("Potwierdź datę kalkulacji zwolnienia akcyzowego PHEV.");
      if (taxDate <= until) {
        return confirmed ? {amountPln:0,rate:0,missing:[],assumptions:["Przyjęto potwierdzone dokumentami zwolnienie PHEV do 2000 cm³ do 31.12.2029 r."]} : fail("Potwierdź dokumenty zwolnienia akcyzowego PHEV do 2000 cm³.");
      }
      rate = fraction(rates.iceSmall);
    } else if (type === "HEV" || type === "PHEV") {
      rate = fraction(cc <= 2000 ? rates.hevSmall : cc <= 3500 ? rates.hybridMedium : rates.iceLarge);
    } else rate = fraction(cc <= 2000 ? rates.iceSmall : rates.iceLarge);
    if (base === null) return fail("Brak prawidłowej podstawy akcyzy.");
    if (base === 0) return fail("Dla pojazdu bez zwolnienia podstawa akcyzy musi być większa od zera.");
    if (rate === null) return fail("Brak prawidłowej stawki akcyzy.");
    const tax = product(base,rate);
    return tax === null ? fail("Kwota akcyzy przekracza obsługiwany zakres.") :
      {amountPln:tax,rate,missing:[],assumptions:["Akcyza jest szacowana; kwalifikacja i podstawa wymagają weryfikacji dokumentów."]};
  }
  function calculate(input = {}, profile = RATES) {
    if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
    const missing = [];
    const assumptions = Array.isArray(profile?.assumptions) ? [...profile.assumptions] : [];
    const need = (value, label, positive = false) => {
      const parsed = amount(value,positive);
      if (parsed === null) missing.push(label);
      return parsed;
    };
    const pick = (key,fallback) => input[key] === undefined ? fallback : input[key];
    const bool = (key,fallback) => {
      const value = pick(key,fallback);
      if (typeof value !== "boolean") { missing.push("Nieprawidłowa opcja: " + key + "."); return null; }
      return value;
    };
    const purchase = need(input.purchaseUsd,"Podaj prawidłową cenę pojazdu w USD.",true);
    const land = need(input.landUsd,"Potwierdź transport do portu w USA.");
    const routeSelected = input.standardRoute === true;
    const sea = need(pick("seaUsd",routeSelected ? profile?.route?.seaUsd : undefined),"Potwierdź fracht morski.");
    const selectedDestination = Array.isArray(profile?.destinations)
      ? profile.destinations.find(destination => destination.id === input.destination) : null;
    const delivery = need(pick("deliveryPln",selectedDestination?.pln),"Potwierdź koszt dostawy w Polsce.");
    const usdPln = need(input.usdPln,"Brak prawidłowego kursu USD/PLN.",true);
    const eurPln = need(input.eurPln,"Brak prawidłowego kursu EUR/PLN.",true);
    const fxDate = date(input.fxDate);
    if (fxDate === null) missing.push("Brak prawidłowej daty kursów walut.");
    const translations = bool("translations",true);
    const dangerous = bool("dangerousCargo",false);
    const translationCost = translations === false ? 0 : translations === null ? null : need(profile?.service?.translationsPln,"Brak ceny tłumaczeń.");
    const dangerousCost = dangerous === false ? 0 : dangerous === null ? null : need(profile?.service?.dangerousCargoUsd,"Brak dopłaty za ładunek niebezpieczny.");
    const port = need(pick("portEUR",profile?.service?.portEUR),"Brak kosztu odprawy i rozładunku.");
    const commissionGrossPln = need(pick("commissionGrossPln",profile?.service?.commissionGrossPln),"Brak prowizji REXBID.");
    const taxRate = (key,label) => {
      const value = fraction(profile?.taxes?.[key]);
      if (value === null) missing.push(label);
      return value;
    };
    const dutyRate = taxRate("dutyRate","Brak prawidłowej stawki cła.");
    const vatRate = taxRate("importVatRate","Brak prawidłowej stawki VAT importowego.");
    const fee = auctionFee(input,profile);
    missing.push(...fee.missing);
    assumptions.push(...fee.assumptions);
    const calculatedCustomsUsd = sum([purchase,fee.amountUsd,land,sea]);
    const customsValueManual = input.customsValueUsd !== undefined;
    const requestedCustomsUsd = customsValueManual ? amount(input.customsValueUsd) : null;
    const customsUsd = customsValueManual ? (requestedCustomsUsd > 0 ? requestedCustomsUsd : null) : calculatedCustomsUsd;
    if (customsValueManual && customsUsd === null) missing.push("Wpisz wartość celną większą od zera.");
    if (customsValueManual) assumptions.push("Wartość celna wpisana ręcznie; jej podstawę potwierdza odprawa. Cena zakupu i transport pozostają osobnymi kosztami.");
    const taxAmount = (key, automatic, label) => {
      if (input[key] === undefined) return automatic;
      const value = need(input[key], "Wpisz prawidłową kwotę " + label + ".");
      if (value !== null) assumptions.push("Ręczna kwota " + label + " wymaga potwierdzenia przed odprawą.");
      return value;
    };
    const customsPln = product(customsUsd,usdPln);
    const dutyPln = taxAmount("dutyOverridePln", product(customsPln,dutyRate), "cła");
    const dutyBase = sum([customsPln,dutyPln]);
    const vatPln = taxAmount("vatOverridePln", product(dutyBase,vatRate), "VAT");
    const base = input.exciseBasePln === undefined ? dutyBase : amount(input.exciseBasePln);
    if (input.exciseBasePln !== undefined && base === null) missing.push("Podaj prawidłową podstawę akcyzy.");
    if (input.exciseBasePln === undefined) assumptions.push("Robocza podstawa akcyzy: wartość celna powiększona o cło; wymaga potwierdzenia dla rzeczywistej ścieżki zakupu.");
    const taxDate = input.taxDate === undefined ? fxDate : date(input.taxDate);
    if (input.taxDate !== undefined && taxDate === null) missing.push("Nieprawidłowa data kalkulacji podatków.");
    const exciseResult = input.exciseOverridePln === undefined
      ? excise({...input,exciseBasePln:base,taxDate},profile)
      : {amountPln:taxAmount("exciseOverridePln", null, "akcyzy"),missing:[],assumptions:[]};
    missing.push(...exciseResult.missing);
    assumptions.push(...exciseResult.assumptions);
    if (fxDate) assumptions.push("Kursy przeliczeniowe z dnia " + fxDate + "; nie są kursem celnym ani gwarancją kursu płatności.");
    const rawLines = [
      {id:"purchase",label:"Cena pojazdu",amount:purchase,currency:"USD"},
      {id:"auction",label:"Opłaty aukcyjne",amount:fee.amountUsd,currency:"USD"},
      {id:"land",label:"Dostawa do portu w USA",amount:land,currency:"USD"},
      {id:"sea",label:"Fracht morski",amount:sea,currency:"USD"},
      {id:"duty",label:"Cło",amount:dutyPln,currency:"PLN"},
      {id:"vat",label:"VAT importowy",amount:vatPln,currency:"PLN"},
      {id:"port",label:"Odprawa i rozładunek",amount:port,currency:"EUR"},
      {id:"commission",label:"Obsługa REXBID z VAT",amount:commissionGrossPln,currency:"PLN"},
      {id:"delivery",label:"Dostawa pod dom",amount:delivery,currency:"PLN"},
      {id:"translations",label:"Tłumaczenia dokumentów",amount:translationCost,currency:"PLN"},
      {id:"dangerousCargo",label:"Ładunek niebezpieczny",amount:dangerousCost,currency:"USD"},
      {id:"excise",label:"Akcyza",amount:exciseResult.amountPln,currency:"PLN"}
    ];
    const converted = rawLines.map(line => product(line.amount,line.currency === "USD" ? usdPln : line.currency === "EUR" ? eurPln : 1));
    if (converted.some((value,index) => value === null && rawLines[index].amount !== null && usdPln !== null && eurPln !== null)) missing.push("Kwota przekracza obsługiwany zakres kalkulatora.");
    const total = sum(converted);
    const knownTotal = sum(converted.filter(value => value !== null));
    if (knownTotal === null) missing.push("Suma przekracza obsługiwany zakres kalkulatora.");
    const complete = missing.length === 0 && total !== null;
    if (!complete && missing.length === 0) missing.push("Nie wszystkie składniki mają prawidłową kwotę.");
    return {
      complete,
      missing:[...new Set(missing)],
      totalPln:complete ? round(total) : null,
      knownTotalPln:knownTotal === null ? 0 : round(knownTotal),
      customsUsd:round(customsUsd),customsPln:round(customsPln),
      calculatedCustomsUsd:round(calculatedCustomsUsd),customsValueSource:customsValueManual ? "manual" : "calculated",
      dutyPln:round(dutyPln),vatPln:round(vatPln),excisePln:round(exciseResult.amountPln),
      auctionFeeUsd:round(fee.amountUsd),commissionGrossPln:round(commissionGrossPln),
      lineItems:rawLines.map(line => ({...line,amount:round(line.amount)})),
      ratesVersion:typeof profile?.version === "string" ? profile.version : "unknown",
      assumptions:[...new Set(assumptions)]
    };
  }
  // Search the same forward calculation. Never return a bid from incomplete costs.
  function maximumBid(input = {}, profile = RATES) {
    const budget = amount(input.budgetPln, true), reserve = amount(input.reservePln ?? 0);
    const fail = (status, missing) => ({status, purchaseUsd:null, totalPln:null, missing});
    if (budget === null || reserve === null || reserve >= budget) return fail('invalid_budget',['Podaj budżet większy od rezerwy na naprawę i rejestrację.']);
    if (input.customsValueUsd !== undefined || input.exciseBasePln !== undefined || input.auctionFeeOverrideUsd !== undefined) return fail('manual_costs',['Przy wyliczaniu limitu przywróć automatyczną wartość celną, podstawę akcyzy i opłaty aukcyjne.']);
    const available = round(budget - reserve), calc = bid => calculate({...input,purchaseUsd:bid},profile);
    const first = calc(1);
    if (!first.complete) return fail('incomplete',first.missing);
    if (first.totalPln > available) return {...fail('insufficient',['Budżet nie pokrywa minimalnego zakupu, importu i wybranych usług. Przy cenie 1 USD potrzeba co najmniej '+Math.ceil(first.totalPln+reserve).toLocaleString('pl-PL')+' zł z wybraną rezerwą.']),minimumBudgetPln:round(first.totalPln+reserve)};
    let lo = 1, hi = 100000;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2), result = calc(mid);
      if (!result.complete) return fail('incomplete',result.missing);
      if (result.totalPln <= available) lo = mid; else hi = mid - 1;
    }
    const quote = calc(lo);
    return {status:lo===100000?'ceiling':'ok',purchaseUsd:lo,totalPln:quote.totalPln,remainingPln:round(budget-quote.totalPln),reservePln:reserve,quote,missing:[]};
  }
  return Object.freeze({calculate,maximumBid,auctionFee,excise,rates:RATES});
});
