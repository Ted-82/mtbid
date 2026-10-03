const fs = require("node:fs");
const path = require("node:path");

function loadJsonc(file) {
  // The checked-in Wrangler files are strict JSON despite the .jsonc suffix.
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateWorkerConfigs(root = path.resolve(__dirname, "..")) {
  const production = loadJsonc(path.join(root, "wrangler.jsonc"));
  const staging = loadJsonc(path.join(root, "wrangler.staging.jsonc"));
  const issues = [];
  const productionDb = production.d1_databases?.find(binding => binding.binding === "REXBID_DB");
  const stagingDb = staging.d1_databases?.find(binding => binding.binding === "REXBID_DB");
  const budgetKeys = ["CATALOG", "DETAIL", "HISTORY", "DISCOVERY", "MEDIA"];
  const validLimit = value => /^\d+$/.test(String(value ?? "")) && Number(value) > 0 && Number(value) <= 100000;
  const stagingBudgetLimits = Object.fromEntries(budgetKeys.map(key => [key.toLowerCase(), staging.vars?.[`REXBID_PROVIDER_BUDGET_${key}_DAILY_LIMIT`] ?? null]));
  const stagingGlobalBudget = staging.vars?.REXBID_PROVIDER_BUDGET_DAILY_LIMIT ?? null;
  const stagingBudgetConfigured = staging.vars?.REXBID_PROVIDER_BUDGET_MODE === "required"
    && validLimit(stagingGlobalBudget) && budgetKeys.every(key => validLimit(staging.vars?.[`REXBID_PROVIDER_BUDGET_${key}_DAILY_LIMIT`]))
    && budgetKeys.reduce((total, key) => total + Number(staging.vars[`REXBID_PROVIDER_BUDGET_${key}_DAILY_LIMIT`]), 0) <= Number(stagingGlobalBudget);
  if (!stagingBudgetConfigured) issues.push("staging_provider_budgets_invalid_or_unbounded");
  if (production.name !== "mtbid" || production.main !== "./worker.js") issues.push("production_worker_identity");
  if (productionDb?.database_name !== "rexbid-db" || productionDb?.database_id !== "971879fe-04ed-4e8c-9dc6-5306980bb872") issues.push("production_database_target");
  if (!production.assets || production.assets.directory !== "./public" || production.assets.binding !== "ASSETS") issues.push("production_assets_binding");
  if (staging.name !== "rexbid-auth-test" || staging.main !== "./worker.staging.js") issues.push("staging_worker_identity");
  if (stagingDb?.database_name !== "rexbid-auth-test-db" || stagingDb?.database_id !== "acb3cb8e-69a2-459f-8a46-0f2f5b9004be") issues.push("staging_database_target");
  if (!staging.workers_dev || !staging.assets || staging.assets.directory !== "./public") issues.push("staging_runtime_bindings");
  if (stagingDb?.database_id === productionDb?.database_id || stagingDb?.database_name === productionDb?.database_name) issues.push("database_isolation");
  const productionText = JSON.stringify(production);
  if (production.vars?.AUTH_ENABLED === "true") issues.push("production_auth_must_remain_disabled");
  if (production.vars?.REXBID_D1_PRIMARY_READS === "true") issues.push("production_d1_primary_reads_must_remain_disabled");
  if (production.triggers?.crons?.length) issues.push("production_cron_must_remain_disabled");
  for (const marker of ["AUTH_ENABLED", "AUTH_D1_SCHEMA_VERSION", "REXBID_AUTH_TEST_UI", "REXBID_AUTH_DIAGNOSTICS", "staging-bypass", "rexbid-auth-test-db"]) {
    if (productionText.includes(marker)) issues.push(`staging_flag_in_production:${marker}`);
  }
  if (productionText.includes("d1471c9") || productionText.includes("REXBID_DOOR_ESTIMATOR_PROTOTYPE")) issues.push("prototype_enabled_in_production_config");
  if (staging.vars?.REXBID_DOOR_ESTIMATOR_PROTOTYPE === "enabled") issues.push("prototype_enabled_in_staging_config");
  const publicDir = path.join(root, "public");
  if (fs.existsSync(path.join(publicDir, "auth-test.html"))) issues.push("staging_auth_ui_in_public_assets");
  const productionWorker = fs.readFileSync(path.join(root, "worker.js"), "utf8");
  for (const route of ["/__staging/d1-sync-phase-b-test", "/__staging/phase-c-shadow"]) {
    if (productionWorker.includes(route)) issues.push(`staging_route_in_production_worker:${route}`);
  }
  const productionBudgetMissing = production.vars?.REXBID_PROVIDER_BUDGET_MODE === "required"
    && (!validLimit(production.vars?.REXBID_PROVIDER_BUDGET_DAILY_LIMIT)
      || budgetKeys.some(key => !validLimit(production.vars?.[`REXBID_PROVIDER_BUDGET_${key}_DAILY_LIMIT`])));
  return { ok: issues.length === 0, issues,
    production: { worker: production.name, database: productionDb?.database_name, database_id: productionDb?.database_id,
      provider_budget_mode: production.vars?.REXBID_PROVIDER_BUDGET_MODE || "not_enabled",
      provider_budget_configured: !productionBudgetMissing,
      provider_traffic_fail_closed: production.vars?.REXBID_PROVIDER_BUDGET_MODE === "required" && productionBudgetMissing,
      d1_primary_reads_enabled: production.vars?.REXBID_D1_PRIMARY_READS === "true",
      cron_enabled: Boolean(production.triggers?.crons?.length),
      launch_blockers: productionBudgetMissing ? ["production_provider_daily_budgets_require_owner_approval"] : [] },
    staging: { worker: staging.name, database: stagingDb?.database_name, database_id: stagingDb?.database_id,
      prototype_enabled: staging.vars?.REXBID_DOOR_ESTIMATOR_PROTOTYPE === "enabled",
      provider_budget_mode: staging.vars?.REXBID_PROVIDER_BUDGET_MODE || "not_enabled",
      provider_budget_configured: stagingBudgetConfigured, provider_daily_limit: stagingGlobalBudget, provider_operation_limits: stagingBudgetLimits } };
}

if (require.main === module) {
  const result = validateWorkerConfigs();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = { validateWorkerConfigs };
