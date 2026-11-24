"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ORIGIN = "https://rexbid.pl";
const DATABASE = "rexbid-db";
const DATABASE_ID = "971879fe-04ed-4e8c-9dc6-5306980bb872";

function validateProductionReleaseConfig(config) {
  const issues = [];
  const vars = config?.vars || {};
  const databases = config?.d1_databases || [];
  if (config?.name !== "mtbid" || config?.main !== "./worker.production.js") issues.push("release_worker_identity");
  if (config?.workers_dev !== false || config?.preview_urls !== false) issues.push("release_alternate_hosts_disabled");
  if (JSON.stringify(config?.routes) !== JSON.stringify([{pattern: "rexbid.pl", custom_domain: true}])) issues.push("release_exact_domain");
  if (databases.length !== 1 || databases[0]?.binding !== "REXBID_DB" || databases[0]?.database_name !== DATABASE
      || databases[0]?.database_id !== DATABASE_ID) issues.push("release_production_database_only");
  if (databases.some(db => Object.hasOwn(db, "migrations_dir"))) issues.push("release_has_no_automatic_migration_directory");
  if (config?.assets?.directory !== "./public" || config?.assets?.binding !== "ASSETS" || config?.assets?.run_worker_first !== true) {
    issues.push("release_all_paths_require_guard");
  }
  if (vars.REXBID_PRODUCTION_RELEASE_ENABLED !== "disabled") issues.push("release_candidate_must_remain_inactive");
  if (vars.REXBID_RELEASE_INDEXING !== "disabled") issues.push("release_candidate_must_remain_noindex");
  if (vars.REXBID_RELEASE_ORIGIN !== ORIGIN || vars.REXBID_CANONICAL_ORIGIN !== ORIGIN) issues.push("release_exact_origins");
  if (vars.REXBID_RELEASE_D1_TARGET !== DATABASE || vars.REXBID_RELEASE_D1_DATABASE_ID !== DATABASE_ID) issues.push("release_runtime_database_declarations");
  if (vars.AUTH_ENABLED !== "false" || vars.REXBID_LEGACY_SYNC_ENABLED !== "false" || vars.REXBID_PROVIDER_ENABLED !== "false") {
    issues.push("release_auth_provider_and_sync_disabled");
  }
  const limits = ["DAILY_LIMIT", "CATALOG_DAILY_LIMIT", "DETAIL_DAILY_LIMIT", "HISTORY_DAILY_LIMIT", "DISCOVERY_DAILY_LIMIT", "MEDIA_DAILY_LIMIT"];
  if (vars.REXBID_PROVIDER_BUDGET_MODE !== "required" || limits.some(name => vars[`REXBID_PROVIDER_BUDGET_${name}`] !== "0")) {
    issues.push("release_provider_budgets_zero");
  }
  const age = Number(vars.REXBID_RELEASE_MAX_AGE_MS);
  if (!Number.isSafeInteger(age) || age < 0 || age > 7 * 86400000) issues.push("release_max_age_bounded");
  for (const feature of ["CALCULATOR_V4", "CALCULATOR_V3", "TRANSPORT_CALCULATOR"]) {
    if (vars[`REXBID_${feature}_ENABLED`] !== "enabled" || vars[`REXBID_${feature}_ALLOWED_ORIGINS`] !== ORIGIN) {
      issues.push(`release_feature_exact_origin:${feature.toLowerCase()}`);
    }
  }
  if (config?.triggers?.crons?.length || config?.queues || config?.durable_objects) issues.push("release_background_work_disabled");
  const serialized = JSON.stringify(config);
  for (const marker of ["rexbid-auth-test", "acb3cb8e", "staging-bypass", "REXBID_AUTH_TEST_UI", "REXBID_AUTH_DIAGNOSTICS",
    "REXBID_PUBLIC_PREVIEW_ENABLED", "APIBARA_API_KEY", "SUPABASE", "REXBID_AUTH_COOKIE_SECRET"]) {
    if (serialized.includes(marker)) issues.push(`release_forbidden_configuration:${marker}`);
  }
  return {ok: issues.length === 0, issues, status: "inactive_release_candidate", launch_ready: false,
    worker: config?.name || null, origin: ORIGIN, database: DATABASE, database_id: DATABASE_ID,
    read_only: true, provider_fallback: false, accounts_enabled: false, sync_enabled: false,
    required_before_activation: ["authenticated_target_and_D1_schema_audit", "backup_and_restore_rehearsal",
      "production_catalog_population_and_freshness_review", "staging_and_final_domain_real_browser_QA",
      "verified_contact_channel_and_business_information", "controlled_release_and_indexing_activation"]};
}

function validateProductionRelease(root = path.resolve(__dirname, "..")) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "wrangler.release.jsonc"), "utf8"));
  const result = validateProductionReleaseConfig(config);
  for (const filename of ["worker.production.js", "sync/public-read-utils.cjs"]) {
    if (!fs.existsSync(path.join(root, filename))) result.issues.push(`release_source_missing:${filename}`);
  }
  result.ok = result.issues.length === 0;
  return result;
}

if (require.main === module) {
  const result = validateProductionRelease();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {validateProductionRelease, validateProductionReleaseConfig};
