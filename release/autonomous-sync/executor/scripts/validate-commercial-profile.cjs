"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {validateCommercialProfile, TRANSPORT_REFERENCE} = require("../calculator/commercial-profile.cjs");

function main(args = process.argv.slice(2)) {
  const requireReady = args.includes("--require-ready");
  const paths = args.filter(arg => arg !== "--require-ready");
  if (paths.length > 1 || paths.some(arg => arg.startsWith("--"))) {
    console.error("Usage: node scripts/validate-commercial-profile.cjs [profile.json] [--require-ready]");
    return 1;
  }
  const file = paths[0] ? path.resolve(paths[0]) : path.join(__dirname, "../config/rexbid-commercial-profile.json");
  try {
    const rates = require("../public/rexbid-calculator-v4-rates.js");
    const profile = JSON.parse(fs.readFileSync(file, "utf8"));
    // CLI readiness evaluates prices for today's UTC date, independently of confirmation dates.
    const result = validateCommercialProfile(profile, {transportReference:{
      ...TRANSPORT_REFERENCE, content_version:rates.version, currency:rates.currency
    }, asOf:new Date().toISOString().slice(0, 10)});
    console.log(JSON.stringify(result, null, 2));
    return result.valid && (!requireReady || result.ready_for_cost_model) ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({valid:false, status:"invalid", error:error.message}));
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = {main};
