const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {spawnSync} = require("node:child_process");
const rates = require("../public/rexbid-calculator-v4-rates.js");
const draft = require("../config/rexbid-commercial-profile.json");
const {validateCommercialProfile, TRANSPORT_REFERENCE, FREIGHT_SERVICES} = require("../calculator/commercial-profile.cjs");
const copy = () => structuredClone(draft);
const source = {kind:"owner", ref:"test fixture only; not a commercial tariff"};
const confirmFact = value => ({value, status:"confirmed", source, confirmed_on:"2026-10-06"});
const confirmCost = (covers, overrides = {}) => ({amount:0, currency:"EUR", unit:"per_vehicle", tax_basis:"gross",
  covers, scope:"Synthetic fixture: standard vehicle on the specified test route only.", status:"confirmed",
  source, confirmed_on:"2026-10-06", effective_from:"2026-10-06", effective_until:null, ...overrides});

function stage1(profile) {
  profile.stage1.destination_port = confirmFact("TEST PORT");
  profile.stage1.clearance_country = confirmFact("NL");
  profile.stage1.freight_scope = confirmFact({
    included:["ocean_freight", "export_handling", "loading", "documentation", "marine_insurance"],
    excluded:["eu_port_handling", "unloading", "customs_brokerage"]
  });
  profile.stage1.eu_arrival_package = confirmCost(["eu_port_handling", "unloading", "customs_brokerage"]);
  return profile;
}
function stage2(profile) {
  profile.stage2.rexbid_commission = confirmCost(["import_service"], {currency:"USD"});
  profile.stage2.poland_delivery = confirmCost(["eu_to_poland_delivery"], {currency:"PLN"});
  return profile;
}
function stage3(profile) {
  for (const platform of ["copart", "iaai"]) profile.stage3[`${platform}_account_profile`] = confirmFact({
    account_profile:"synthetic licensed account", payment_method:"synthetic secured payment", bid_mode:"synthetic prebid",
    title_group_rules:"test fixture reference", fee_schedule_ref:"test fixture fee schedule, no live tariff"
  });
  return profile;
}
function complete() {
  const profile = stage3(stage2(stage1(copy())));
  profile.stage4.transport_validity = confirmFact({valid_from:"2026-10-06", valid_until:null,
    validity_ref:"test fixture only", albany_resolution_ref:"test fixture conflict resolution only"});
  profile.stage4.exception_rules = confirmFact({class_rules_ref:"test fixture", container_loading_ref:"test fixture",
    powertrain_rules_ref:"test fixture", non_running_rules_ref:"test fixture", damaged_battery_rules_ref:"test fixture"});
  return profile;
}
const validate = profile => validateCommercialProfile(profile, {asOf:"2026-10-06"});

test("the delivered profile is a valid draft with stage1 as the first request", () => {
  const result = validate(copy());
  assert.equal(result.valid, true);
  assert.equal(result.status, "review_required");
  assert.equal(result.first_missing_group.id, "stage1");
  assert.equal(result.missing_groups.length, 4);
  assert.equal(result.complete_offer, false);
  assert.equal(result.production_ready, false);
  assert.equal(draft.transport_reference.content_version, rates.version);
  assert.equal(draft.transport_reference.currency, rates.currency);
});

test("commercial intake advances through the four groups in order", () => {
  const profile = copy();
  stage1(profile); assert.equal(validate(profile).first_missing_group.id, "stage2");
  stage2(profile); assert.equal(validate(profile).first_missing_group.id, "stage3");
  stage3(profile); assert.equal(validate(profile).first_missing_group.id, "stage4");
});

test("confirmed complete commercial data never claims a complete offer or production readiness", () => {
  const result = validate(complete());
  assert.equal(result.valid, true);
  assert.equal(result.ready_for_cost_model, true);
  assert.equal(result.status, "ready_for_cost_model");
  assert.equal(result.first_missing_group, null);
  assert.equal(result.complete_offer, false);
  assert.equal(result.production_ready, false);
});

test("an explicit, documented zero is valid while a blank amount is missing", () => {
  const profile = complete();
  assert.equal(validate(profile).ready_for_cost_model, true);
  profile.stage2.rexbid_commission.amount = null;
  const result = validate(profile);
  assert.equal(result.valid, false);
  assert.equal(result.ready_for_cost_model, false);
  assert.ok(result.errors.some(error => error.path === "stage2.rexbid_commission.amount"));
});

test("unknown cannot hide a supplied zero or a draft price", () => {
  for (const amount of [0, 123]) {
    const profile = copy(); profile.stage1.eu_arrival_package.amount = amount;
    assert.equal(validate(profile).valid, false);
  }
});

test("values and dates without confirmed sources cannot unlock a profile", () => {
  const profile = complete();
  for (const [stage, keys] of [["stage1",["destination_port","clearance_country","freight_scope"]], ["stage3",["copart_account_profile","iaai_account_profile"]]]) {
    for (const key of keys) profile[stage][key].status = "draft";
  }
  assert.equal(validate(profile).valid, true);
  assert.equal(validate(profile).ready_for_cost_model, false);
  profile.stage1.destination_port.status = "confirmed";
  profile.stage1.destination_port.source = null;
  assert.equal(validate(profile).valid, false);
});

test("unproven or empty confirmed provenance is invalid", () => {
  for (const override of [{source:null}, {source:{kind:"competitor",ref:"benchmark"}}, {source:{kind:"partner",ref:" "}}, {confirmed_on:null}]) {
    const profile = complete(); Object.assign(profile.stage2.poland_delivery, override);
    assert.equal(validate(profile).valid, false);
  }
});

test("wrong currencies, money types and units are rejected", () => {
  for (const override of [{currency:"US$"}, {amount:"0"}, {amount:-1}, {amount:Infinity}, {unit:"per_container"}, {tax_basis:"all_in"}]) {
    const profile = complete(); Object.assign(profile.stage2.poland_delivery, override);
    assert.equal(validate(profile).valid, false);
  }
});

test("ISO dates must exist and a cost needs a validity start distinct from confirmation", () => {
  for (const override of [{effective_from:null}, {confirmed_on:"2026-02-30"}, {effective_from:"2026-2-1"}, {effective_until:"2026-01-01"}]) {
    const profile = complete(); Object.assign(profile.stage2.poland_delivery, override);
    assert.equal(validate(profile).valid, false);
  }
});

test("future or expired confirmed prices remain valid records but are not ready now", () => {
  for (const override of [{effective_from:"2026-10-07"}, {effective_from:"2026-01-01",effective_until:"2026-10-05"}]) {
    const profile = complete(); Object.assign(profile.stage2.poland_delivery, override);
    const result = validate(profile);
    assert.equal(result.valid, true);
    assert.equal(result.ready_for_cost_model, false);
    assert.equal(result.first_missing_group.id, "stage2");
  }
});

test("expired partner validity cannot disappear behind populated service prices", () => {
  const profile = complete(); Object.assign(profile.stage4.transport_validity.value,{valid_from:"2026-01-01",valid_until:"2026-10-05"});
  assert.equal(validate(profile).ready_for_cost_model, false);
  assert.equal(validate(profile).first_missing_group.id, "stage4");
});

test("the public API without options checks today's UTC validity", () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const profile = complete();
  for (const stage of ["stage1", "stage2", "stage3", "stage4"]) {
    for (const item of Object.values(profile[stage])) if (item?.status === "confirmed") item.confirmed_on = yesterday;
  }
  for (const item of [profile.stage1.eu_arrival_package, profile.stage2.rexbid_commission, profile.stage2.poland_delivery]) item.effective_from = yesterday;
  profile.stage4.transport_validity.value.valid_from = yesterday;
  assert.equal(validateCommercialProfile(profile).ready_for_cost_model, true);
  for (const override of [{effective_until:yesterday}, {effective_from:tomorrow,effective_until:null}]) {
    Object.assign(profile.stage2.poland_delivery, override);
    const defaultResult = validateCommercialProfile(profile);
    const explicitResult = validateCommercialProfile(profile, {asOf:today});
    assert.equal(defaultResult.valid, true);
    assert.equal(defaultResult.ready_for_cost_model, false);
    assert.deepEqual(defaultResult, explicitResult);
  }
  assert.equal(validateCommercialProfile(profile, {asOf:""}).valid, false);
});

test("a future confirmation cannot unlock a fact or cost as already confirmed", () => {
  for (const select of [profile => profile.stage1.destination_port, profile => profile.stage2.poland_delivery]) {
    const profile = complete();
    select(profile).confirmed_on = "2026-10-07";
    const result = validate(profile);
    assert.equal(result.valid, false);
    assert.equal(result.ready_for_cost_model, false);
    assert.ok(result.errors.some(error => error.path.endsWith("confirmed_on") && /evaluation date/.test(error.message)));
    assert.equal(validateCommercialProfile(profile, {asOf:"2026-10-07"}).ready_for_cost_model, true);
  }
});

test("a freight scope must classify every inclusion and exclusion", () => {
  const profile = complete(); profile.stage1.freight_scope.value.excluded.pop();
  assert.equal(validate(profile).valid, false);
  profile.stage1.freight_scope.value.excluded.push("ocean_freight");
  assert.equal(validate(profile).valid, false);
});

test("included freight services cannot be charged again in the arrival package", () => {
  const profile = complete(); profile.stage1.eu_arrival_package.covers.push("documentation");
  const result = validate(profile);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => /already belongs/.test(error.message)));
});

test("commission, delivery and extra packages cannot own the same service twice", () => {
  const profile = complete(); profile.stage4.additional_costs.push(confirmCost(["import_service"]));
  assert.equal(validate(profile).valid, false);
});

test("separately billed arrival components preserve their own sources instead of requiring a fictitious bundle", () => {
  const profile = complete();
  profile.stage1.eu_arrival_package = copy().stage1.eu_arrival_package;
  profile.stage1.eu_arrival_costs = [
    confirmCost(["eu_port_handling"], {source:{kind:"partner",ref:"synthetic port invoice"}}),
    confirmCost(["unloading"], {source:{kind:"partner",ref:"synthetic unloading quote"}}),
    confirmCost(["customs_brokerage"], {source:{kind:"partner",ref:"synthetic broker quote"}})
  ];
  assert.equal(validate(profile).ready_for_cost_model, true);
  profile.stage1.eu_arrival_costs.pop();
  assert.equal(validate(profile).first_missing_group.id, "stage1");
  profile.stage1.eu_arrival_package = confirmCost(["eu_port_handling", "unloading", "customs_brokerage"]);
  assert.equal(validate(profile).valid, false, "aggregate and its components cannot be billed together");
});

test("explicit distance delivery prices are intake data, not a calculated door quote", () => {
  const profile = complete();
  Object.assign(profile.stage2.poland_delivery, {unit:"per_km", amount:2,
    scope:"Synthetic source defines destination zone, distance and minimum charge; implementation still required."});
  const result = validate(profile);
  assert.equal(result.ready_for_cost_model, true);
  assert.equal(result.complete_offer, false);
  assert.match(result.scope, /not executable pricing/);
});

test("excluded insurance needs a separate confirmed cost rather than silently becoming zero", () => {
  const profile = complete();
  profile.stage1.freight_scope.value.included = profile.stage1.freight_scope.value.included.filter(service => service !== "marine_insurance");
  profile.stage1.freight_scope.value.excluded.push("marine_insurance");
  let result = validate(profile);
  assert.equal(result.valid, true);
  assert.equal(result.ready_for_cost_model, false);
  assert.ok(result.first_missing_group.missing.includes("service_coverage.marine_insurance"));
  profile.stage4.additional_costs.push(confirmCost(["marine_insurance"]));
  result = validate(profile);
  assert.equal(result.ready_for_cost_model, true);
});

test("a zero all-inclusive arrival balance is valid only when service coverage is explicit", () => {
  const profile = complete();
  profile.stage1.freight_scope.value = {included:[...FREIGHT_SERVICES],excluded:[]};
  profile.stage1.eu_arrival_package.covers = [];
  assert.equal(validate(profile).ready_for_cost_model, true);
  profile.stage1.eu_arrival_package.amount = 50;
  assert.equal(validate(profile).valid, false);
});

test("percentage commission is explicit and cannot acquire a currency or exceed 100", () => {
  const profile = complete(); Object.assign(profile.stage2.rexbid_commission,{amount:2,unit:"percent_of_purchase",currency:null});
  assert.equal(validate(profile).ready_for_cost_model, true);
  profile.stage2.rexbid_commission.currency = "USD"; assert.equal(validate(profile).valid, false);
  profile.stage2.rexbid_commission.currency = null; profile.stage2.rexbid_commission.amount = 101;
  assert.equal(validate(profile).valid, false);
});

test("unsupported country, malformed rules and changed transport references are rejected", () => {
  const mutations = [
    profile => {profile.stage1.clearance_country.value = "US";},
    profile => {profile.stage4.exception_rules.value.damaged_battery_rules_ref = "";},
    profile => {profile.stage3.iaai_account_profile.value = "a filled worksheet";},
    profile => {profile.transport_reference.content_version = "different-rate-set";},
    profile => {profile.transport_reference.currency = "EUR";}
  ];
  for (const mutate of mutations) {const profile = complete(); mutate(profile); assert.equal(validate(profile).valid, false);}
  assert.equal(TRANSPORT_REFERENCE.content_version, rates.version);
});

test("CLI validates a draft without treating it as ready and require-ready blocks it", () => {
  const command = path.join(__dirname, "../scripts/validate-commercial-profile.cjs");
  const normal = spawnSync(process.execPath, [command], {encoding:"utf8"});
  assert.equal(normal.status, 0, normal.stderr);
  assert.equal(JSON.parse(normal.stdout).status, "review_required");
  const strict = spawnSync(process.execPath, [command, "--require-ready"], {encoding:"utf8"});
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).first_missing_group.id, "stage1");
  const absent = spawnSync(process.execPath, [command, path.join(__dirname,"no-commercial-profile.json")], {encoding:"utf8"});
  assert.equal(absent.status, 1);
  assert.equal(JSON.parse(absent.stderr).status, "invalid");
  assert.equal(fs.existsSync(command), true);
});

test("CLI require-ready checks current UTC validity rather than only populated fields", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rexbid-profile-test-"));
  const file = path.join(dir, "synthetic-profile.json");
  const command = path.join(__dirname, "../scripts/validate-commercial-profile.cjs");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const profile = complete();
  for (const stage of ["stage1", "stage2", "stage3", "stage4"]) {
    for (const item of Object.values(profile[stage])) if (item?.status === "confirmed") item.confirmed_on = yesterday;
  }
  for (const item of [profile.stage1.eu_arrival_package, profile.stage2.rexbid_commission, profile.stage2.poland_delivery]) {
    item.effective_from = yesterday;
    item.confirmed_on = yesterday;
  }
  profile.stage4.transport_validity.value.valid_from = yesterday;
  try {
    fs.writeFileSync(file, JSON.stringify(profile));
    const baseline = spawnSync(process.execPath, [command, file, "--require-ready"], {encoding:"utf8"});
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    for (const override of [{effective_until:yesterday}, {effective_from:tomorrow,effective_until:null}]) {
      Object.assign(profile.stage2.poland_delivery, override);
      fs.writeFileSync(file, JSON.stringify(profile));
      const result = spawnSync(process.execPath, [command, file, "--require-ready"], {encoding:"utf8"});
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).first_missing_group.id, "stage2");
    }
    Object.assign(profile.stage2.poland_delivery,{effective_from:today,effective_until:null});
    profile.stage4.transport_validity.value.valid_until = yesterday;
    fs.writeFileSync(file, JSON.stringify(profile));
    const transport = spawnSync(process.execPath, [command, file, "--require-ready"], {encoding:"utf8"});
    assert.equal(transport.status, 1);
    assert.equal(JSON.parse(transport.stdout).first_missing_group.id, "stage4");
  } finally {
    fs.rmSync(dir, {recursive:true, force:true});
  }
});
