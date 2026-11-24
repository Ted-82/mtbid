"use strict";

// Intake validation only: this module neither calculates taxes nor loads prices.
const TRANSPORT_REFERENCE = Object.freeze({
  asset: "public/rexbid-calculator-v4-rates.js",
  content_version: "rex-partner-v4-f0a67460b203286f", currency: "USD"
});
const STAGES = Object.freeze([
  { id: "stage1", label: "Port UE, kraj odprawy i zakres frachtu oraz pakietu portowego" },
  { id: "stage2", label: "Prowizja REXBID i dostawa do Polski" },
  { id: "stage3", label: "Profile kont i właściwe tabele opłat Copart oraz IAAI" },
  { id: "stage4", label: "Wyjątki transportowe, aktualność i pokrycie pozostałych usług" }
]);
const FREIGHT_SERVICES = Object.freeze([
  "ocean_freight", "export_handling", "loading", "documentation", "marine_insurance",
  "eu_port_handling", "unloading", "customs_brokerage"
]);
const SERVICES = Object.freeze([...FREIGHT_SERVICES, "import_service", "eu_to_poland_delivery"]);
const EU_COUNTRIES = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "));
const CURRENCIES = new Set(["USD", "EUR", "PLN"]);
const STATUSES = new Set(["unknown", "draft", "confirmed"]);
const SOURCE_KINDS = new Set(["owner", "partner", "auction_operator", "official"]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;
const isDate = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function validateCommercialProfile(profile, options = {}) {
  const errors = [];
  const missing = Object.fromEntries(STAGES.map(stage => [stage.id, []]));
  const addError = (path, message) => errors.push({path, message});
  const addMissing = (stage, path) => missing[stage].push(path);
  // The public API and CLI both evaluate current UTC validity unless an explicit
  // historical date is supplied. Omitting options must never bypass time checks.
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  if (!isDate(asOf)) addError("asOf", "Use a real ISO evaluation date.");
  if (!isObject(profile)) return summary([{path:"profile", message:"Profile must be an object."}], missing);
  if (profile.schema_version !== 1) addError("schema_version", "Unsupported schema version.");
  for (const key of ["profile_id", "version"]) if (!nonEmpty(profile[key])) addError(key, "Non-empty text is required.");
  const expected = options.transportReference || TRANSPORT_REFERENCE;
  if (!isObject(profile.transport_reference)) addError("transport_reference", "Existing transport reference is required.");
  else for (const key of ["asset", "content_version", "currency"]) {
    if (profile.transport_reference[key] !== expected[key]) addError(`transport_reference.${key}`, "Reference must match the reviewed transport dataset.");
  }
  for (const stage of STAGES) if (!isObject(profile[stage.id])) addError(stage.id, "Stage must be an object.");

  function evidence(item, path) {
    if (!STATUSES.has(item.status)) addError(`${path}.status`, "Use unknown, draft or confirmed.");
    if (item.source !== null && item.source !== undefined) {
      if (!isObject(item.source) || !SOURCE_KINDS.has(item.source.kind) || !nonEmpty(item.source.ref)) {
        addError(`${path}.source`, "Source requires an allowed kind and a non-empty reference.");
      }
    }
    if (item.confirmed_on !== null && item.confirmed_on !== undefined && !isDate(item.confirmed_on)) addError(`${path}.confirmed_on`, "Use a real ISO date.");
    if (item.status === "confirmed") {
      if (!isObject(item.source) || !SOURCE_KINDS.has(item.source.kind) || !nonEmpty(item.source.ref)) addError(`${path}.source`, "Confirmed data requires source provenance.");
      if (!isDate(item.confirmed_on)) addError(`${path}.confirmed_on`, "Confirmed data requires the confirmation date.");
      else if (isDate(asOf) && item.confirmed_on > asOf) addError(`${path}.confirmed_on`, "Confirmation cannot be later than the evaluation date.");
    }
  }
  function fact(stage, key, validateValue) {
    const path = `${stage}.${key}`, item = profile[stage]?.[key];
    if (!isObject(item)) { addError(path, "Fact must be an object."); addMissing(stage, path); return null; }
    evidence(item, path);
    if (!("value" in item)) addError(`${path}.value`, "Use null for unknown data.");
    if (item.status === "unknown" && item.value !== null) addError(`${path}.value`, "Unknown data must remain null.");
    if (item.value !== null && item.value !== undefined) validateValue(item.value, `${path}.value`);
    if (item.status === "confirmed" && (item.value === null || item.value === undefined)) addError(`${path}.value`, "Confirmed data requires a value.");
    if (item.status !== "confirmed" || item.value === null || item.value === undefined) addMissing(stage, path);
    return item;
  }
  const textValue = (value, path) => { if (!nonEmpty(value)) addError(path, "Non-empty text is required."); };
  function list(value, path, allowed) {
    if (!Array.isArray(value) || value.some(item => !nonEmpty(item) || (allowed && !allowed.includes(item))) || new Set(value).size !== value.length) {
      addError(path, "Use a unique array of supported identifiers."); return false;
    }
    return true;
  }
  function objectText(value, path, keys) {
    if (!isObject(value)) { addError(path, "Use a structured object."); return; }
    for (const key of keys) textValue(value[key], `${path}.${key}`);
  }
  function cost(stage, key, item = profile[stage]?.[key], required = true) {
    const path = `${stage}.${key}`;
    if (!isObject(item)) { addError(path, "Cost must be an object."); if (required) addMissing(stage, path); return null; }
    evidence(item, path);
    const valueKeys = ["amount", "currency", "unit", "tax_basis", "covers", "scope", "effective_from", "effective_until"];
    for (const field of valueKeys) if (!(field in item)) addError(`${path}.${field}`, "Missing field; use null for unknown values.");
    if (item.status === "unknown" && valueKeys.some(field => item[field] !== null)) addError(path, "Unknown cost fields must remain null; zero is an explicit amount.");
    if (item.amount !== null && (typeof item.amount !== "number" || !Number.isFinite(item.amount) || item.amount < 0)) addError(`${path}.amount`, "Amount must be a finite non-negative number or null.");
    if (item.currency !== null && !CURRENCIES.has(item.currency)) addError(`${path}.currency`, "Supported currencies are USD, EUR and PLN.");
    if (item.unit !== null && !["per_vehicle", "percent_of_purchase", "per_km"].includes(item.unit)) addError(`${path}.unit`, "Use per_vehicle, percent_of_purchase or per_km.");
    if (item.tax_basis !== null && !["net", "gross", "not_applicable"].includes(item.tax_basis)) addError(`${path}.tax_basis`, "State net, gross or not_applicable.");
    if (item.covers !== null) list(item.covers, `${path}.covers`, SERVICES);
    if (item.scope !== null && !nonEmpty(item.scope)) addError(`${path}.scope`, "Describe the covered service, customer/route and exclusions.");
    for (const dateKey of ["effective_from", "effective_until"]) if (item[dateKey] !== null && !isDate(item[dateKey])) addError(`${path}.${dateKey}`, "Use a real ISO date or null.");
    if (isDate(item.effective_from) && isDate(item.effective_until) && item.effective_until < item.effective_from) addError(`${path}.effective_until`, "Expiry cannot precede the effective date.");
    if (item.unit === "percent_of_purchase" && (item.currency !== null || item.amount > 100)) addError(path, "Percentage commission has no currency and must be between 0 and 100.");
    if (item.status === "confirmed") {
      const required = ["amount", "unit", "tax_basis", "covers", "scope", "effective_from"];
      if (item.unit !== "percent_of_purchase") required.push("currency");
      for (const field of required) if (item[field] === null || item[field] === undefined) addError(`${path}.${field}`, "Confirmed cost requires this field.");
      if (Array.isArray(item.covers) && item.covers.length === 0 && item.amount !== 0) addError(`${path}.covers`, "A non-zero cost must identify its services.");
      if (item.unit === "percent_of_purchase" && (stage !== "stage2" || key !== "rexbid_commission")) addError(`${path}.unit`, "Percentage basis is supported only for the REXBID commission.");
      if (item.unit === "per_km" && (stage !== "stage2" || key !== "poland_delivery")) addError(`${path}.unit`, "Kilometre pricing is supported only for delivery; scope/source must define the route, distance and minimum charge rule.");
    }
    if (required && (item.status !== "confirmed" || item.amount === null)) addMissing(stage, path);
    if (item.status === "confirmed" && isDate(asOf) &&
      ((isDate(item.effective_from) && item.effective_from > asOf) ||
      (isDate(item.effective_until) && item.effective_until < asOf))) addMissing(stage, `${path}.active_period`);
    return {path, item};
  }

  fact("stage1", "destination_port", textValue);
  fact("stage1", "clearance_country", (value, path) => { if (!EU_COUNTRIES.has(value)) addError(path, "Use an EU country ISO code."); });
  const freight = fact("stage1", "freight_scope", (value, path) => {
    if (!isObject(value)) { addError(path, "Freight scope requires included and excluded service lists."); return; }
    const ok = list(value.included, `${path}.included`, FREIGHT_SERVICES) && list(value.excluded, `${path}.excluded`, FREIGHT_SERVICES);
    if (ok) {
      if (!value.included.includes("ocean_freight")) addError(`${path}.included`, "The referenced freight must include ocean_freight.");
      if (value.included.some(service => value.excluded.includes(service))) addError(path, "A service cannot be both included and excluded.");
      for (const service of FREIGHT_SERVICES) if (!value.included.includes(service) && !value.excluded.includes(service)) addError(path, `Explicitly classify ${service}; omission is not zero.`);
    }
  });
  // Arrival may be one evidenced total or separately billed evidenced components.
  const arrivalPackage = cost("stage1", "eu_arrival_package", profile.stage1?.eu_arrival_package, false);
  const costs = [arrivalPackage, cost("stage2", "rexbid_commission"), cost("stage2", "poland_delivery")].filter(Boolean);
  const arrivalCosts = profile.stage1?.eu_arrival_costs;
  if (!Array.isArray(arrivalCosts)) addError("stage1.eu_arrival_costs", "Use a list for separately billed arrival costs.");
  else arrivalCosts.forEach((item, index) => {
    const result = cost("stage1", `eu_arrival_costs[${index}]`, item);
    if (result) costs.push(result);
  });
  if (arrivalPackage?.item.status !== "confirmed" && !(Array.isArray(arrivalCosts) && arrivalCosts.some(item => item?.status === "confirmed"))) {
    addMissing("stage1", "stage1.eu_arrival_package_or_costs");
  }
  for (const platform of ["copart", "iaai"]) fact("stage3", `${platform}_account_profile`, (value, path) => {
    objectText(value, path, ["account_profile", "payment_method", "bid_mode", "title_group_rules", "fee_schedule_ref"]);
  });
  fact("stage4", "transport_validity", (value, path) => {
    objectText(value, path, ["validity_ref", "albany_resolution_ref"]);
    if (!isObject(value) || !isDate(value.valid_from)) addError(`${path}.valid_from`, "A confirmed period start is required.");
    if (isObject(value) && value.valid_until !== null && !isDate(value.valid_until)) addError(`${path}.valid_until`, "Use a real ISO date or explicit null for no stated expiry.");
    if (isObject(value) && isDate(value.valid_until) && value.valid_until < value.valid_from) addError(`${path}.valid_until`, "Expiry cannot precede the effective date.");
    if (isObject(value) && isDate(asOf) &&
      ((isDate(value.valid_from) && value.valid_from > asOf) ||
      (isDate(value.valid_until) && value.valid_until < asOf))) addMissing("stage4", "stage4.transport_validity.active_period");
  });
  fact("stage4", "exception_rules", (value, path) => {
    objectText(value, path, ["class_rules_ref", "container_loading_ref", "powertrain_rules_ref", "non_running_rules_ref", "damaged_battery_rules_ref"]);
  });
  if (!Array.isArray(profile.stage4?.additional_costs)) addError("stage4.additional_costs", "Use a list; an empty list does not confirm zero costs.");
  else profile.stage4.additional_costs.forEach((item, index) => {
    const result = cost("stage4", `additional_costs[${index}]`, item);
    if (result) costs.push(result);
  });

  // One service has one owner. An inclusive package must not be charged again.
  const ownership = new Map();
  if (freight?.status === "confirmed" && Array.isArray(freight.value?.included)) {
    for (const service of freight.value.included) ownership.set(service, "stage1.freight_scope");
  }
  for (const {path, item} of costs) if (item.status === "confirmed" && Array.isArray(item.covers)) {
    for (const service of item.covers) {
      if (ownership.has(service)) addError(`${path}.covers`, `${service} already belongs to ${ownership.get(service)}; do not charge it twice.`);
      else ownership.set(service, path);
    }
  }
  for (const service of SERVICES) if (!ownership.has(service)) addMissing(
    ["eu_port_handling", "unloading", "customs_brokerage"].includes(service) ? "stage1" : "stage4", `service_coverage.${service}`);
  return summary(errors, missing);
}

function summary(errors, missing) {
  const missingGroups = STAGES.map(stage => ({...stage, missing:[...new Set(missing[stage.id])]})).filter(group => group.missing.length);
  const valid = errors.length === 0;
  const ready = valid && missingGroups.length === 0;
  return Object.freeze({
    valid, status:valid ? ready ? "ready_for_cost_model" : "review_required" : "invalid",
    ready_for_cost_model:ready, complete_offer:false, production_ready:false,
    scope:"Commercial data intake ready to implement only, not executable pricing. Source/rule interpretation, tax, FX and individual vehicle eligibility require separate checks.",
    first_missing_group:missingGroups[0] || null, missing_groups:missingGroups, errors
  });
}

module.exports = Object.freeze({validateCommercialProfile, TRANSPORT_REFERENCE, STAGES, FREIGHT_SERVICES, SERVICES});
