#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const ROUTE_IDS = Object.freeze(["route_1", "route_2", "route_3", "route_4", "route_5", "route_6"]);
const DEFAULT_OUTPUT = path.join(ROOT, "public", "rexbid-transport-rates.js");
const PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
const STATE_NAMES = Object.freeze({
  AL:"ALABAMA", AK:"ALASKA", AZ:"ARIZONA", AR:"ARKANSAS", CA:"CALIFORNIA", CO:"COLORADO", CT:"CONNECTICUT", DE:"DELAWARE", FL:"FLORIDA", GA:"GEORGIA", HI:"HAWAII", ID:"IDAHO", IL:"ILLINOIS", IN:"INDIANA", IA:"IOWA", KS:"KANSAS", KY:"KENTUCKY", LA:"LOUISIANA", ME:"MAINE", MD:"MARYLAND", MA:"MASSACHUSETTS", MI:"MICHIGAN", MN:"MINNESOTA", MS:"MISSISSIPPI", MO:"MISSOURI", MT:"MONTANA", NE:"NEBRASKA", NV:"NEVADA", NH:"NEW HAMPSHIRE", NJ:"NEW JERSEY", NM:"NEW MEXICO", NY:"NEW YORK", NC:"NORTH CAROLINA", ND:"NORTH DAKOTA", OH:"OHIO", OK:"OKLAHOMA", OR:"OREGON", PA:"PENNSYLVANIA", RI:"RHODE ISLAND", SC:"SOUTH CAROLINA", SD:"SOUTH DAKOTA", TN:"TENNESSEE", TX:"TEXAS", UT:"UTAH", VT:"VERMONT", VA:"VIRGINIA", WA:"WASHINGTON", WV:"WEST VIRGINIA", WI:"WISCONSIN", WY:"WYOMING", DC:"DISTRICT OF COLUMBIA"
});

function normalizedText(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[(),]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function normalizedPlatform(value) {
  const key = normalizedText(value);
  if (key === "copart") return "copart";
  if (key === "iaai" || key === "insurance auto auction") return "iaai";
  if (key === "manheim") return "manheim";
  if (key === "adesa") return "adesa";
  throw new Error(`Nieobsługiwana platforma w tabeli: ${String(value)}`);
}
function normalizedState(value) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (STATE_NAMES[raw]) return raw;
  const abbrev = Object.entries(STATE_NAMES).find(([, full]) => full === raw)?.[0];
  if (abbrev) return abbrev;
  if (PROVINCES.has(raw)) return raw;
  throw new Error(`Nieznany stan/prowincja w tabeli: ${String(value)}`);
}
function normalizedPostal(value) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^\d{5}(\d{4})?$/.test(raw) ? raw.slice(0, 5) : raw;
}
function parseMoney(value, where) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\$\s*\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error(`Nieprawidłowa kwota ${where}: ${raw}`);
  }
  const amount = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Nieprawidłowa kwota ${where}: ${raw}`);
  return amount;
}
function resolveSource(root, requested) {
  const exact = path.resolve(root, requested);
  if (fs.existsSync(exact)) return exact;
  if (!requested.toLowerCase().endsWith(".txt") && fs.existsSync(`${exact}.txt`)) return `${exact}.txt`;
  throw new Error(`Brak źródłowego cennika: ${requested}`);
}
function readLines(file) {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
}

function parseLandTable(text, sourceFile = "data/partner/land_transport_rates.md") {
  const records = [];
  for (const [index, line] of String(text).replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const columns = line.split("\t");
    if (columns.length !== 11) throw new Error(`Tabela lądowa: wiersz ${index + 1} ma ${columns.length} kolumn; oczekiwano 11 (5 pól + 6 tras).`);
    const [locationOriginal, platformRaw, cityOriginal, stateOriginal, postalOriginal, ...values] = columns;
    if (!locationOriginal.trim() || !platformRaw.trim() || !stateOriginal.trim()) {
      throw new Error(`Tabela lądowa: brak nazwy aukcji, platformy lub stanu/prowincji w wierszu ${index + 1}.`);
    }
    const platform = normalizedPlatform(platformRaw);
    const state = normalizedState(stateOriginal);
    const routeValues = values.map((value, routeIndex) => parseMoney(value, `wiersz ${index + 1}, route_${routeIndex + 1}`));
    records.push({
      location_name: locationOriginal.trim(),
      location_name_original: locationOriginal.trim(),
      location_name_normalized: normalizedText(locationOriginal),
      platform,
      city: cityOriginal.trim() || null,
      city_normalized: normalizedText(cityOriginal),
      state_province: stateOriginal.trim(),
      state_normalized: state,
      postal_code: postalOriginal.trim() || null,
      postal_normalized: normalizedPostal(postalOriginal),
      ...Object.fromEntries(ROUTE_IDS.map((route, i) => [route, routeValues[i]])),
      currency: "USD",
      source: "partner",
      source_row: { file: sourceFile.replace(/\\/g, "/"), line: index + 1 }
    });
  }
  return records;
}

function parseSeaTable(text, sourceFile = "data/partner/sea_transport_rates.md") {
  const rows = [];
  for (const [index, line] of String(text).replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(x => x.trim());
    if (cells.length !== 8 || /^:?-{2,}/.test(cells[0])) continue;
    const count = Number(cells[0].match(/\*\*(\d+)\s+car/i)?.[1]);
    if (![1, 2, 3, 4].includes(count)) continue;
    const routeValues = cells.slice(2).map((value, routeIndex) => parseMoney(value, `tabela morska, wiersz ${index + 1}, route_${routeIndex + 1}`));
    if (routeValues.length !== ROUTE_IDS.length || routeValues.some(value => value === null)) {
      throw new Error(`Tabela morska: niekompletna macierz dla ${count} aut w wierszu ${index + 1}.`);
    }
    rows.push({ vehicle_count: count, container: "40'HC", unit: "per_vehicle", currency: "USD", source: "partner", source_row: { file: sourceFile.replace(/\\/g, "/"), line: index + 1 }, routes: Object.fromEntries(ROUTE_IDS.map((route, i) => [route, routeValues[i]])) });
  }
  if (rows.length !== 4 || new Set(rows.map(x => x.vehicle_count)).size !== 4) throw new Error(`Tabela morska: oczekiwano czterech wierszy 1–4 aut, znaleziono ${rows.length}.`);
  return rows.sort((a, b) => a.vehicle_count - b.vehicle_count);
}

function duplicateKeys(records, keyOf) {
  const groups = new Map();
  for (const record of records) {
    const key = keyOf(record);
    if (!key.replace(/[| ]/g, "")) continue;
    const group = groups.get(key) || [];
    group.push(record.source_row.line);
    groups.set(key, group);
  }
  return [...groups].filter(([, lines]) => lines.length > 1).map(([key, lines]) => ({ key, lines }));
}
function auditLand(records) {
  const platforms = Object.fromEntries(["copart", "iaai", "manheim", "adesa"].map(key => [key, records.filter(r => r.platform === key).length]));
  const collisions = {
    platform_location: duplicateKeys(records, r => `${r.platform}|${r.location_name_normalized}`),
    platform_zip: duplicateKeys(records.filter(r => r.postal_normalized), r => `${r.platform}|${r.postal_normalized}`),
    platform_city_state: duplicateKeys(records.filter(r => r.city_normalized && r.state_normalized), r => `${r.platform}|${r.city_normalized}|${r.state_normalized}`),
    zip: duplicateKeys(records.filter(r => r.postal_normalized), r => r.postal_normalized),
    city_state: duplicateKeys(records.filter(r => r.city_normalized && r.state_normalized), r => `${r.city_normalized}|${r.state_normalized}`)
  };
  const canada = records.filter(r => PROVINCES.has(r.state_normalized)).length;
  return {
    total_records: records.length,
    platforms,
    usa: records.length - canada,
    canada,
    missing_zip: records.filter(r => !r.postal_normalized).length,
    missing_city: records.filter(r => !r.city || !r.city.trim()).length,
    no_route_values: records.filter(r => ROUTE_IDS.every(route => r[route] === null)).length,
    empty_route_cells: records.reduce((n, r) => n + ROUTE_IDS.filter(route => r[route] === null).length, 0),
    amount_cells_nonempty: records.reduce((n, r) => n + ROUTE_IDS.filter(route => r[route] !== null).length, 0),
    amount_cells_with_dollar: records.reduce((n, r) => n + ROUTE_IDS.filter(route => r[route] !== null).length, 0),
    duplicate_normalized_keys: Object.fromEntries(Object.entries(collisions).map(([key, value]) => [key, value.length])),
    duplicate_examples: Object.fromEntries(Object.entries(collisions).map(([key, value]) => [key, value.slice(0, 8)])),
    currency_markers: { USD: "all non-empty amounts carried $ in the source" }
  };
}
function buildDataset(landText, seaText, metadata = {}) {
  const parsedLand = parseLandTable(landText, metadata.landSource || "data/partner/land_transport_rates.md");
  const parsedSea = parseSeaTable(seaText, metadata.seaSource || "data/partner/sea_transport_rates.md");
  const version = metadata.version || (metadata.landHash && metadata.seaHash
    ? `rex-partner-transport-${metadata.landHash.slice(0, 12)}-${metadata.seaHash.slice(0, 12)}`
    : "rex-partner-transport-v2");
  const land = parsedLand.map(row => ({ ...row, rate_set_version: version, effective_from: null, status: "configurable", notes: "Data partnera; brak daty obowiązywania w źródle." }));
  const sea = parsedSea.map(row => ({ ...row, rate_set_version: version, effective_from: null, status: "configurable", notes: "Data obowiązywania i nazwa trasy nie występują w źródle." }));
  return {
    version,
    source: { kind: "partner", label: "Partner Rex.Bid", currency: "USD", effective_from: null, generated_at: metadata.generatedAt || null, notes: ["Kwoty źródłowe oznaczone $; partner potwierdził USD.", "Route IDs są neutralne; nazwy portów i mapowanie nie zostały dostarczone.", "effective_from nie występuje w źródłach i pozostaje null."] },
    routeIds: ROUTE_IDS,
    currency: "USD",
    landRates: land,
    seaFreight40HC: Object.fromEntries(sea.map(row => [String(row.vehicle_count), row.routes])),
    seaMetadata: { container: "40'HC", unit: "per_vehicle", rows: sea, source: "partner", currency: "USD" },
    audit: auditLand(land),
    provenance: {
      land: { file: metadata.landSource || "data/partner/land_transport_rates.md", sha256: metadata.landHash || null },
      sea: { file: metadata.seaSource || "data/partner/sea_transport_rates.md", sha256: metadata.seaHash || null }
    }
  };
}
function renderModule(dataset) {
  return `"use strict";\n\n(function(root, factory) {\n  const value = factory();\n  if (typeof module === "object" && module.exports) module.exports = value;\n  if (root) root.RexBidTransportRates = value;\n})(typeof globalThis !== "undefined" ? globalThis : this, function() {\n  return deepFreeze(${JSON.stringify(dataset, null, 2)});\n  function deepFreeze(value) {\n    if (value && typeof value === "object" && !Object.isFrozen(value)) {\n      Object.freeze(value);\n      for (const child of Object.values(value)) deepFreeze(child);\n    }\n    return value;\n  }\n});\n`;
}
function generate({ root = ROOT, output = DEFAULT_OUTPUT, generatedAt = null } = {}) {
  const landRequested = "data/partner/land_transport_rates.md";
  const seaRequested = "data/partner/sea_transport_rates.md";
  const landPath = resolveSource(root, landRequested);
  const seaPath = resolveSource(root, seaRequested);
  const landBytes = fs.readFileSync(landPath);
  const seaBytes = fs.readFileSync(seaPath);
  const relative = file => path.relative(root, file).replace(/\\/g, "/");
  const dataset = buildDataset(landBytes.toString("utf8"), seaBytes.toString("utf8"), {
    landSource: relative(landPath), seaSource: relative(seaPath),
    landHash: crypto.createHash("sha256").update(landBytes).digest("hex"),
    seaHash: crypto.createHash("sha256").update(seaBytes).digest("hex"), generatedAt
  });
  const outputText = renderModule(dataset);
  if (output === "--check") {
    const existing = fs.readFileSync(DEFAULT_OUTPUT, "utf8");
    if (existing !== outputText) throw new Error("Wygenerowany zestaw stawek jest nieaktualny; uruchom node scripts/partner-transport-rates.cjs --write.");
  } else {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, outputText, "utf8");
  }
  return { dataset, sources: { landPath, seaPath }, outputText };
}

if (require.main === module) {
  try {
    const mode = process.argv[2] || "--write";
    if (!new Set(["--write", "--check", "--audit"]).has(mode)) throw new Error("Użycie: node scripts/partner-transport-rates.cjs [--write|--check|--audit]");
    const { dataset, sources } = generate({ output: mode === "--check" ? "--check" : DEFAULT_OUTPUT });
    if (mode === "--audit") console.log(JSON.stringify({ sources: { land: path.relative(ROOT, sources.landPath), sea: path.relative(ROOT, sources.seaPath) }, audit: dataset.audit, sea: dataset.seaMetadata }, null, 2));
    else console.log(`${mode === "--check" ? "OK" : "Wygenerowano"}: ${dataset.landRates.length} lokalizacji lądowych, ${dataset.seaMetadata.rows.length} poziomy frachtu; waluta USD.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { ROUTE_IDS, normalizedText, normalizedPlatform, normalizedState, normalizedPostal, parseMoney, parseLandTable, parseSeaTable, duplicateKeys, auditLand, buildDataset, renderModule, generate };
