'use strict';

// Static validation only. This does not contact Cloudflare/Supabase, inspect
// secret values, deploy code, change DNS or establish runtime readiness.
const fs = require('node:fs');
const path = require('node:path');
const ORIGIN = 'https://rexbid.pl';
const WORKER = 'rexbid-production-preflight';
const DATABASE = 'rexbid-production-preflight-db';
const DATABASE_ID = 'c8a30088-70af-43a6-9a7f-c4018279d37d';
const BUCKET = 'rexbid-production-private-files';
const NAMESPACE = '2026100601';
const SECRET_NAMES = Object.freeze([
  'APIBARA_API_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY',
  'REXBID_AUTH_COOKIE_SECRET', 'REXBID_OWNER_USER_ID',
  'REXBID_PORTAL_DATA_KEYS', 'REXBID_PORTAL_ACTIVE_KEY_ID'
]);

function validateProductionPreflight(config) {
  const issues = [];
  const v = config?.vars || {};
  const databases = config?.d1_databases;
  if (!config || typeof config !== 'object' || Array.isArray(config)) issues.push('invalid_config_object');
  if (config?.name !== WORKER || config?.main !== './worker.js') issues.push('isolated_working_entrypoint_required');
  if (config?.workers_dev !== false || config?.preview_urls !== false
    || !Array.isArray(config?.routes) || config.routes.length !== 0) issues.push('non_public_worker_required');
  if (!Array.isArray(databases) || databases.length !== 1
    || databases[0].binding !== 'REXBID_DB' || databases[0].database_name !== DATABASE
    || databases[0].database_id !== DATABASE_ID) issues.push('isolated_database_required');
  if (config?.assets?.directory !== './public' || config.assets.binding !== 'ASSETS'
    || config.assets.run_worker_first !== true) issues.push('asset_guards_required');
  if (v.REXBID_CANONICAL_ORIGIN !== ORIGIN) issues.push('canonical_origin_required');
  if (v.REXBID_RELEASE_ORIGIN !== ORIGIN || v.REXBID_RELEASE_D1_TARGET !== DATABASE
    || v.REXBID_RELEASE_D1_DATABASE_ID !== DATABASE_ID) issues.push('isolated_release_identity_required');
  if (v.REXBID_PRODUCTION_UI_ENABLED !== 'enabled' || v.REXBID_RELEASE_ORIGIN !== ORIGIN
    || v.REXBID_CANONICAL_ORIGIN !== ORIGIN) issues.push('production_ui_exact_origin_required');
  for (const feature of ['TRANSPORT_CALCULATOR', 'CALCULATOR_V3', 'CALCULATOR_V4']) {
    if (v[`REXBID_${feature}_ENABLED`] !== 'enabled'
      || v[`REXBID_${feature}_ALLOWED_ORIGINS`] !== ORIGIN) issues.push(`calculator_origin:${feature}`);
  }
  for (const key of ['AUTH_ENABLED', 'REXBID_D1_PRIMARY_READS', 'REXBID_LEGACY_SYNC_ENABLED']) {
    if (v[key] !== 'false') issues.push(`inactive:${key}`);
  }
  // Public project metadata may be prepared while Auth is OFF; no credentials
  // belong here and naming a project is not an activation approval.
  if (v.REXBID_PRODUCTION_SUPABASE_PROJECT_REF !== undefined
    && (!/^[a-z]{20}$/.test(v.REXBID_PRODUCTION_SUPABASE_PROJECT_REF)
      || v.REXBID_PRODUCTION_SUPABASE_PROJECT_REF === 'ydfsuncohsntqwmtmnhe')) {
    issues.push('independent_auth_project_metadata_required');
  }
  for (const key of ['AUTH_CANONICAL_ORIGIN', 'AUTH_ALLOWED_ORIGINS']) {
    if (v[key] !== undefined && v[key] !== ORIGIN) issues.push(`auth_origin:${key}`);
  }
  if (v.AUTH_RECOVERY_MODE !== undefined && v.AUTH_RECOVERY_MODE !== 'email-token') issues.push('restricted_recovery_mode_required');
  if (v.AUTH_RATE_LIMITING_MODE !== undefined && v.AUTH_RATE_LIMITING_MODE !== 'cloudflare') issues.push('production_auth_limiter_mode_required');
  for (const key of ['REXBID_PORTAL_ENABLED', 'REXBID_PORTAL_FILES_ENABLED']) {
    if (v[key] !== 'disabled') issues.push(`inactive:${key}`);
  }
  if (v.REXBID_PROVIDER_ENABLED === 'false') issues.push('provider_backed_catalog_must_be_preserved');
  if (v.REXBID_PRODUCTION_RELEASE_ENABLED !== undefined) issues.push('disabled_release_wrapper_forbidden');
  if (v.REXBID_PROVIDER_BUDGET_MODE !== 'required') issues.push('bounded_provider_budget_required');
  for (const [suffix, limit] of Object.entries({DAILY: '500', CATALOG_DAILY: '250', DETAIL_DAILY: '150',
    HISTORY_DAILY: '60', DISCOVERY_DAILY: '0', MEDIA_DAILY: '0'})) {
    if (v[`REXBID_PROVIDER_BUDGET_${suffix}_LIMIT`] !== limit) issues.push(`budget:${suffix}`);
  }
  const files = config?.r2_buckets;
  if (!Array.isArray(files) || files.length !== 1 || files[0].binding !== 'REXBID_PRIVATE_FILES'
    || files[0].bucket_name !== BUCKET || files[0].preview_bucket_name || files[0].remote === false) {
    issues.push('independent_private_files_binding_required');
  }
  const limiters = config?.ratelimits;
  if (!Array.isArray(limiters) || limiters.length !== 1 || limiters[0].name !== 'AUTH_RATE_LIMITER'
    || String(limiters[0].namespace_id) !== NAMESPACE || limiters[0].simple?.limit !== 30
    || limiters[0].simple?.period !== 60) issues.push('isolated_auth_limiter_required');
  if (config?.triggers?.crons?.length || config?.queues?.consumers?.length || config?.queues?.producers?.length) {
    issues.push('automatic_sync_must_remain_disabled');
  }
  if (SECRET_NAMES.some(key => Object.hasOwn(v, key))) issues.push('secret_values_must_not_be_in_config');
  // Do not echo configuration values: a rejected config may contain secrets.
  const serialized = JSON.stringify(config || {});
  if (/rexbid-auth-test|acb3cb8e-69a2-459f-8a46-0f2f5b9004be|ydfsuncohsntqwmtmnhe|rexbid-staging-private-files|staging-bypass|AUTH_TEST|AUTH_DIAGNOSTICS|MFA_PENDING_RESTART|__staging/.test(serialized)) {
    issues.push('staging_configuration_forbidden');
  }
  return {
    ok: issues.length === 0, issues, status: 'ISOLATED_CONFIGURATION_PREPARED_NOT_PUBLISHED',
    worker: WORKER, database: DATABASE, database_id: DATABASE_ID, origin: ORIGIN,
    public_routes: false, accounts_enabled: false, portal_enabled: false,
    provider_backed_catalog: true, calculator_v4_preserved: true,
    production_runtime_verified: false, launch_ready: false,
    resource_verification: 'NOT_VERIFIED_BY_STATIC_VALIDATOR',
    required_secret_names: SECRET_NAMES,
    pre_publication_checks: [
      'independent_production_supabase_project_and_configuration',
      'provider_key_present_in_secret_store_without_copying_staging_key',
      'independent_cookie_and_portal_keys_in_secret_store_and_protected_backup',
      'actual_d1_schema_and_counts_verified_no_test_data',
      'actual_r2_standard_class_and_public_access_disabled',
      'limiter_namespace_account_uniqueness_and_binding_verified',
      'smtp_confirmation_recovery_e2e_and_separate_owner_mfa',
      'owner_approval_for_current_production_worker_migrations_and_domain_cutover'
    ]
  };
}

if (require.main === module) {
  try {
    if (process.argv.length > 3) throw new Error('invalid_arguments');
    const file = process.argv[2] || path.resolve(__dirname, '../wrangler.production-preflight.jsonc');
    const result = validateProductionPreflight(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error('production_preflight_input_unavailable_or_invalid');
    process.exitCode = 1;
  }
}

module.exports = {validateProductionPreflight};
