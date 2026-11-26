const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const review = path.resolve(__dirname, '..');
const Module = require('node:module');
const baselineSource = fs.readFileSync(path.join(review, 'docs/qa/v5-professional-2026-10-06/calculator-v4-baseline.js'), 'utf8');
const candidateSource = fs.readFileSync(path.join(review, 'public/rexbid-calculator-v4.js'), 'utf8');
const begin = source => source.indexOf('  function bindCalculator(');
const end = source => source.lastIndexOf('\n  return Object.freeze({rates: RATES');
assert.equal(candidateSource.slice(0, begin(candidateSource)), baselineSource.slice(0, begin(baselineSource)), 'Numeric, location, class and formatting helpers must remain unchanged');
assert.equal(candidateSource.slice(end(candidateSource)), baselineSource.slice(end(baselineSource)), 'Public exports must remain unchanged');
const fixture = new Module(path.join(review, 'public/__v4baseline.js'), module);
fixture.filename = fixture.id; fixture.paths = module.paths;
fixture._compile(baselineSource, fixture.filename);
const baseline = fixture.exports;
const candidate = require(path.join(review, 'public/rexbid-calculator-v4.js'));
const rates = baseline.rates;
assert.deepEqual(Object.keys(candidate), Object.keys(baseline));
assert.equal(candidate.rates, baseline.rates);
let locationComparisons = 0;
let variantComparisons = 0;
let completeComparisons = 0;
const powertrains = ['ICE', 'BEV', 'HEV', 'PHEV', 'FCEV', 'unknown'];
for (const row of rates.locations) {
  const input = {platform: row.platform, auction_location: row.auction_location, country: row.country,
    city: row.city, state_province: row.state_province, postal_code: row.postal_code};
  const originalMatch = baseline.matchingLocation(rates, input);
  const changedMatch = candidate.matchingLocation(rates, input);
  assert.deepEqual(changedMatch, originalMatch);
  locationComparisons++;
  for (const vehicleClass of [...rates.land_classes.map(item => item.class_id), null]) {
    for (const powertrain of powertrains) {
      for (const cars of [3, 4]) {
        const args = {vehicleClass, powertrain, cars};
        assert.deepEqual(candidate.calculateVariant(rates, changedMatch, args), baseline.calculateVariant(rates, originalMatch, args));
        variantComparisons++;
      }
    }
  }
  const fullInput = {...input, vehicleClass: 'sedan', powertrain: 'BEV'};
  assert.deepEqual(candidate.calculate(rates, fullInput), baseline.calculate(rates, fullInput));
  completeComparisons++;
}
for (const input of [{}, {platform: 'copart', auction_location: 'UNLISTED TEST BRANCH'}, {platform:'iaai', postal_code:'90248'}]) {
  assert.deepEqual(candidate.calculate(rates, input), baseline.calculate(rates, input));
  completeComparisons++;
}
console.log(JSON.stringify({status:'PASS', unchangedOutsideBindCalculator:true, unchangedRateObject:true,
  locations: rates.locations.length, locationComparisons, variantComparisons, completeComparisons, totalComparisons: locationComparisons + variantComparisons + completeComparisons}, null, 2));
