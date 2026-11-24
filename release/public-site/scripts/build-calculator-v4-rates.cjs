"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {createHash} = require("node:crypto");

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "data/partner/RexBid_Calculator_V4_2026-10-04/generated/partner-rates.review.json");
const outputPath = path.join(root, "public/rexbid-calculator-v4-rates.js");

function runtimeDataset(review) {
  const terminals = (review.terminals || []).map(item => ({
    id: item.terminal_id,
    display_name: item.display_name,
    country: item.country
  }));
  return {
    source_version: review.version,
    currency: review.metadata?.currency || "USD",
    source: review.metadata?.source_provider || "Partner Rex.Bid",
    effective_from: review.metadata?.land_prices_effective_from ?? null,
    routing_policy: review.metadata?.routing_policy || "partner_preferred_terminal",
    terminals,
    locations: (review.land || []).map(row => ({
      row_id: row.row_id,
      source_row: row.source?.amount_line ?? null,
      auction_location: row.auction_location,
      platform: row.platform,
      city: row.city,
      state_province: row.state_province,
      postal_code: row.postal_code,
      country: row.country,
      preferred_terminal_id: row.preferred_terminal_id,
      rate_status: row.rate_status,
      effective_from: row.effective_from ?? null,
      rates: row.rates
    })),
    sea: (review.sea || []).map(row => ({
      terminal_id: row.terminal_id,
      cars_per_container: row.cars_per_container,
      amount: row.amount,
      currency: row.currency,
      price_basis: row.price_basis,
      effective_from: row.effective_from ?? null
    })),
    land_classes: (review.land_classes || []).map(row => ({
      class_id: row.class_id,
      source_label: row.source_label,
      land_multiplier: row.land_multiplier,
      effective_from: row.effective_from ?? null
    })),
    surcharges: (review.surcharges || []).map(row => ({
      surcharge_id: row.surcharge_id,
      label_pl: row.label_pl,
      amount: row.amount,
      currency: row.currency,
      unit: row.unit,
      applies_to: row.applies_to,
      other_powertrains: row.other_powertrains,
      multiply_by_land_factor: row.multiply_by_land_factor,
      divide_by_container_count: row.divide_by_container_count,
      confirmed_on: row.confirmed_on,
      effective_from: row.effective_from ?? null,
      status: row.status
    }))
  };
}

function contentVersion(dataset) {
  const content = {...dataset};
  delete content.version;
  const hash = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
  return `rex-partner-v4-${hash}`;
}

function buildSource(dataset) {
  const versioned = {...dataset, version: contentVersion(dataset)};
  const json = JSON.stringify(versioned);
  return `/* Generated from the reviewed Rex.Bid partner rate set. Do not edit by hand. */\n(function(root,factory){const data=factory();if(typeof module==="object"&&module.exports)module.exports=data;if(root)root.RexBidCalculatorV4Rates=data;})(typeof globalThis!=="undefined"?globalThis:this,function(){"use strict";return Object.freeze(${json});});\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const review = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(review.land) || review.land.length !== 610 || !Array.isArray(review.sea) || review.sea.length !== 24) {
    throw new Error("Partner V4 source data failed the expected 610-location/24-ocean-rate validation.");
  }
  const output = buildSource(runtimeDataset(review));
  if (check) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== output) {
      console.error("Calculator V4 runtime rate asset is out of date. Run this generator to update it.");
      process.exitCode = 1;
      return;
    }
    console.log(`Calculator V4 rate asset verified: ${review.land.length} locations, ${review.sea.length} sea rates, ${contentVersion(runtimeDataset(review))}.`);
    return;
  }
  fs.writeFileSync(outputPath, output);
  console.log(`Wrote ${path.relative(root, outputPath)} as ${contentVersion(runtimeDataset(review))} from ${review.version}.`);
}

if (require.main === module) main();
module.exports = {runtimeDataset, contentVersion, buildSource};
