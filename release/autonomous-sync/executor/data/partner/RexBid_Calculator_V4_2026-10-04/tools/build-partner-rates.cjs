#!/usr/bin/env node
"use strict";
// Deterministic CSV -> JSON build. No network, no dependencies, no deployment.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const check = process.argv.includes("--check");

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const records = [];
  let record = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === ";") { record.push(cell); cell = ""; }
    else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(cell); cell = "";
      if (record.some(Boolean)) records.push(record);
      record = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("Nie zamknięto cudzysłowu CSV.");
  if (cell || record.length) { record.push(cell); records.push(record); }
  if (records.length < 2) throw new Error("Brak danych CSV.");
  const headers = records.shift();
  if (new Set(headers).size !== headers.length) throw new Error("Powtórzony nagłówek CSV.");
  return records.map((cells, ix) => {
    if (cells.length !== headers.length) throw new Error(`Błędna liczba kolumn, wiersz CSV ${ix+2}.`);
    return Object.fromEntries(headers.map((key, i) => [key, cells[i]]));
  });
}
function read(name) { return fs.readFileSync(path.join(root, "data", name), "utf8"); }
function amount(s, label) {
  if (s === "") return null;
  if (!/^\d+(?:\.\d+)?$/.test(String(s))) throw new Error(`Błędna liczba ${label}: ${s}`);
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Błędna kwota ${label}`);
  return n;
}
const names = ["metadata.json","terminals.csv","land_rates.csv","sea_rates.csv","land_multipliers.csv","surcharges.csv"];
const sourceTexts = Object.fromEntries(names.map(n => [n, read(n)]));
const metadata = JSON.parse(sourceTexts["metadata.json"]);
const terminals = parseCSV(sourceTexts["terminals.csv"]).map(t => ({
  ...t, column_index: Number(t.column_index), ocean_port_confirmed: t.ocean_port_confirmed || null
}));
const terminalIds = terminals.map(t => t.terminal_id);
if (terminalIds.length !== 6 || new Set(terminalIds).size !== 6) throw new Error("Wymaganych 6 unikalnych terminali.");
const land = parseCSV(sourceTexts["land_rates.csv"]).map(r => {
  if (!r.row_id || !r.auction_location || !r.platform) throw new Error("Brak klucza/nazwy/platformy.");
  if (!terminalIds.includes(r.preferred_terminal_id)) throw new Error(`Nieznany terminal w ${r.row_id}`);
  const rates = Object.fromEntries(terminalIds.map(t => [t, amount(r[t], `${r.row_id}/${t}`)]));
  if (rates[r.preferred_terminal_id] === null) throw new Error(`Brak stawki preferowanej w ${r.row_id}`);
  if (r.currency !== metadata.currency) throw new Error(`Waluta niezgodna w ${r.row_id}`);
  const result = {
    row_id:r.row_id, auction_location:r.auction_location, platform:r.platform,
    city:r.city || null, state_province:r.state_province || null, postal_code:r.postal_code || null,
    country:r.country, currency:r.currency, effective_from:r.effective_from || null,
    preferred_terminal_id:r.preferred_terminal_id, rate_status:r.rate_status,
    rates, source:{amount_file:r.amount_source, amount_line:Number(r.amount_source_line),
    routing_image:r.preferred_source_image, routing_image_y:r.preferred_source_y},
    note:r.note || null
  };
  return result;
});
if (new Set(land.map(r => r.row_id)).size !== land.length) throw new Error("Powtórzone row_id.");
const sea = parseCSV(sourceTexts["sea_rates.csv"]).map(r => {
  if (!terminalIds.includes(r.terminal_id)) throw new Error("Nieznany terminal morski.");
  const n = Number(r.cars_per_container);
  if (![1,2,3,4].includes(n)) throw new Error("Nieznana liczba aut w 40HC.");
  if (r.price_basis !== "per_vehicle") throw new Error("Niepotwierdzona jednostka frachtu.");
  return {...r, cars_per_container:n, amount:amount(r.amount,"sea"),
    destination_terminal_id:r.destination_terminal_id || null, effective_from:r.effective_from || null};
});
if (sea.length !== 24 || new Set(sea.map(r => `${r.container}/${r.cars_per_container}/${r.terminal_id}`)).size !== sea.length)
  throw new Error("Niekompletna lub zduplikowana macierz morska.");
const classes = parseCSV(sourceTexts["land_multipliers.csv"]).map(r => {
  if (r.scope !== "land_only") throw new Error("Mnożniki dotyczą wyłącznie transportu lądowego.");
  return {...r, land_multiplier:amount(r.land_multiplier,"multiplier")};
});
const surcharges = parseCSV(sourceTexts["surcharges.csv"]).map(r => {
  if (!r.surcharge_id || r.currency !== metadata.currency || r.unit !== "per_vehicle") throw new Error("Błędna dopłata lub jednostka.");
  if (r.multiply_by_land_factor !== "false" || r.divide_by_container_count !== "false") throw new Error("Dopłata EV jest na auto, bez mnożnika i dzielenia.");
  const value = amount(r.amount, r.surcharge_id);
  if (value === null) throw new Error("Brak kwoty potwierdzonej dopłaty.");
  return {...r, amount: value, multiply_by_land_factor:false, divide_by_container_count:false, effective_from:r.effective_from || null};
});
if (new Set(surcharges.map(r => r.surcharge_id)).size !== surcharges.length) throw new Error("Zduplikowana dopłata.");
const hash = crypto.createHash("sha256");
for (const n of names) hash.update(n).update("\0").update(sourceTexts[n]).update("\0");
const digest = hash.digest("hex");
const result = {version:`partner-rates-${digest.slice(0,16)}`,content_sha256:digest,metadata,terminals,land,sea,land_classes:classes,surcharges};
const formatted = JSON.stringify(result,null,2) + "\n";
const destination = path.join(root,"generated","partner-rates.review.json");
if (check) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination,"utf8") !== formatted)
    throw new Error("Generated JSON jest nieaktualny. Uruchom generator bez --check.");
  console.log(`PASS: ${land.length} lokalizacji, ${sea.length} stawek frachtu, ${classes.length} klas, ${surcharges.length} dopłata. ${result.version}`);
} else {
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,formatted,"utf8");
  console.log(`Zapisano ${destination}. To pakiet do review, nie automatyczny deploy.`);
}
