'use strict';

// Local preparation only: no network, service changes, secret reads or deploy.
const fs = require('node:fs');
const path = require('node:path');
const {validateProductionPreflight} = require('./validate-production-preflight.cjs');
const {configuration: automaticConfiguration} = require('../sync/automatic-refresh.cjs');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://rexbid.pl';
const ACCOUNT = '7ff5a57444667c4eda2a6a7f0fc4120d';
const PHASES = ['catalog', 'auth-setup', 'owner-setup', 'portal-no-files'];
const ROUTES = [{pattern: 'rexbid.pl', custom_domain: true}, {pattern: 'www.rexbid.pl', custom_domain: true}];
const BASE_EVIDENCE = Object.freeze([
  'production_supabase_project_confirmed', 'independent_production_secrets_verified',
  'provider_key_present', 'limiter_namespace_confirmed_unique', 'accounts_portal_schema_verified',
  'smtp_configuration_verified', 'fresh_backup_restore_verified', 'legal_retention_reviewed', 'owner_cutover_approved'
]);
const OWNER_EVIDENCE = Object.freeze([...BASE_EVIDENCE, 'production_owner_subject_confirmed', 'smtp_confirmation_recovery_verified']);
const PORTAL_EVIDENCE = Object.freeze([...OWNER_EVIDENCE, 'production_owner_mfa_verified']);
const VARS = Object.freeze([
  'REXBID_CANONICAL_ORIGIN', 'REXBID_PROVIDER_BUDGET_MODE', 'REXBID_PROVIDER_BUDGET_DAILY_LIMIT',
  'REXBID_PROVIDER_BUDGET_CATALOG_DAILY_LIMIT', 'REXBID_PROVIDER_BUDGET_DETAIL_DAILY_LIMIT',
  'REXBID_PROVIDER_BUDGET_HISTORY_DAILY_LIMIT', 'REXBID_PROVIDER_BUDGET_DISCOVERY_DAILY_LIMIT',
  'REXBID_PROVIDER_BUDGET_MEDIA_DAILY_LIMIT', 'REXBID_LEGACY_SYNC_ENABLED', 'REXBID_D1_PRIMARY_READS',
  'REXBID_TRANSPORT_CALCULATOR_ENABLED', 'REXBID_TRANSPORT_CALCULATOR_ALLOWED_ORIGINS',
  'REXBID_CALCULATOR_V3_ENABLED', 'REXBID_CALCULATOR_V3_ALLOWED_ORIGINS',
  'REXBID_CALCULATOR_V4_ENABLED', 'REXBID_CALCULATOR_V4_ALLOWED_ORIGINS', 'REXBID_RELEASE_ORIGIN',
  'REXBID_RELEASE_D1_TARGET', 'REXBID_RELEASE_D1_DATABASE_ID', 'REXBID_PRODUCTION_UI_ENABLED',
  'AUTH_ENABLED', 'REXBID_PORTAL_ENABLED', 'REXBID_PORTAL_FILES_ENABLED',
  'AUTH_RECOVERY_MODE', 'AUTH_RATE_LIMITING_MODE', 'REXBID_PRODUCTION_SUPABASE_PROJECT_REF',
  'AUTH_CANONICAL_ORIGIN', 'AUTH_ALLOWED_ORIGINS'
]);
const PHASE_VARS = ['REXBID_PUBLIC_CATALOG_MODE', 'REXBID_PUBLICATION_PHASE', 'AUTH_D1_SCHEMA_VERSION', 'REXBID_PORTAL_SCHEMA_VERSION', 'REXBID_PORTAL_OWNER_SETUP_ONLY'];
const AUTO_VARS = Object.freeze({
  REXBID_TAXONOMY_CACHE_ENABLED: 'disabled',
  REXBID_AUTO_REFRESH_ENABLED: 'enabled',
  REXBID_AUTO_REFRESH_TIMED_ENABLED: 'enabled',
  REXBID_AUTO_REFRESH_DATABASE_ID: 'c8a30088-70af-43a6-9a7f-c4018279d37d',
  REXBID_AUTO_REFRESH_DAILY_LIMIT: '500',
  REXBID_AUTO_REFRESH_MONTHLY_LIMIT: '12000',
  REXBID_AUTO_REFRESH_MAX_PER_RUN: '8',
  REXBID_AUTO_REFRESH_NEW_LISTINGS_DAILY_LIMIT: '2000',
  REXBID_AUTO_REFRESH_QUOTA_RESERVE: '500'
});
const AUTO_TRIGGER = Object.freeze({crons: ['*/15 * * * *']});
const CONFIG_KEYS = ['$schema', 'name', 'main', 'compatibility_date', 'account_id', 'vars', 'd1_databases',
  'assets', 'workers_dev', 'preview_urls', 'routes', 'ratelimits', 'triggers'];

function inspectPublicationEvidence(evidence = {}, phase = 'catalog') {
  if (!PHASES.includes(phase)) throw new Error('invalid_publication_phase');
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || Object.keys(evidence).some(key => !PORTAL_EVIDENCE.includes(key) || typeof evidence[key] !== 'boolean')) {
    throw new Error('unknown_or_secret_evidence');
  }
  const required = phase === 'catalog' ? [] : phase === 'auth-setup' ? BASE_EVIDENCE : phase === 'owner-setup' ? OWNER_EVIDENCE : PORTAL_EVIDENCE;
  const missing = required.filter(key => evidence[key] !== true);
  return {ok: missing.length === 0, missing, phase, status: 'PREPARED_NOT_PUBLISHED', approval_verified: false};
}

function buildPublicationConfig(base, phase = 'catalog', evidence = {}) {
  const checked = validateProductionPreflight(base);
  if (!checked.ok) throw new Error('invalid_isolated_preflight_profile');
  const readiness = inspectPublicationEvidence(evidence, phase);
  if (!readiness.ok) throw new Error('activation_evidence_missing:' + readiness.missing.join(','));
  // Copy only known bindings/options; an --env, service binding or future
  // staging switch in the source must not change this publication target.
  const config = structuredClone(Object.fromEntries(CONFIG_KEYS.filter(key => Object.hasOwn(base, key)).map(key => [key, base[key]])));
  config.account_id = ACCOUNT;
  config.main = './worker.publication.js';
  config.routes = structuredClone(ROUTES);
  config.vars = Object.fromEntries(VARS.filter(key => Object.hasOwn(base.vars, key)).map(key => [key, base.vars[key]]));
  config.vars.REXBID_PUBLICATION_PHASE = phase;
  config.vars.REXBID_PUBLIC_CATALOG_MODE = "stored";
  // The default generator remains manually refreshed and without attachments.
  // Only the separate bounded automatic recipe adds its scheduled capability.
  delete config.r2_buckets;
  delete config.triggers;
  delete config.queues;
  delete config.durable_objects;
  delete config.migrations;
  if (phase !== 'catalog') {
    Object.assign(config.vars, {AUTH_ENABLED: 'true', AUTH_D1_SCHEMA_VERSION: '0003'});
    if (config.vars.AUTH_RECOVERY_MODE !== 'email-token' || config.vars.AUTH_RATE_LIMITING_MODE !== 'cloudflare'
      || config.vars.AUTH_CANONICAL_ORIGIN !== ORIGIN || config.vars.AUTH_ALLOWED_ORIGINS !== ORIGIN
      || config.vars.REXBID_PRODUCTION_SUPABASE_PROJECT_REF !== 'kkwbqzndildovbblbkcx') {
      throw new Error('production_auth_configuration_required');
    }
  }
  if (phase === 'owner-setup' || phase === 'portal-no-files') {
    Object.assign(config.vars, {REXBID_PORTAL_ENABLED: 'enabled', REXBID_PORTAL_SCHEMA_VERSION: '0006'});
  }
  if (phase === 'owner-setup') config.vars.REXBID_PORTAL_OWNER_SETUP_ONLY = 'true';
  const validation = validatePublicationConfig(config);
  if (!validation.ok) throw new Error('invalid_generated_publication_profile');
  return config;
}

function buildAutomaticPublicationConfig(base, phase = 'catalog', evidence = {}, {catalogMembership = false, taxonomyCache = false} = {}) {
  if (typeof catalogMembership !== 'boolean') throw new Error('invalid_catalog_membership_opt_in');
  if (typeof taxonomyCache !== 'boolean') throw new Error('invalid_taxonomy_cache_opt_in');
  if (taxonomyCache && !catalogMembership) throw new Error('taxonomy_cache_requires_catalog_membership');
  // Automatic catalogue refresh is independent of the Auth rollout. Reuse the
  // same phase evidence gates before composing the unchanged bounded recipe.
  const config = buildPublicationConfig(base, phase, evidence);
  const {REXBID_TAXONOMY_CACHE_ENABLED: taxonomyOff, ...automaticVars} = AUTO_VARS;
  Object.assign(config.vars, automaticVars);
  if (catalogMembership) config.vars.REXBID_CATALOG_MEMBERSHIP_ENABLED = 'enabled';
  config.vars.REXBID_TAXONOMY_CACHE_ENABLED = taxonomyCache ? 'enabled' : taxonomyOff;
  config.triggers = structuredClone(AUTO_TRIGGER);
  if (!validatePublicationConfig(config).ok) throw new Error('invalid_automatic_publication_profile');
  return config;
}

function validatePublicationConfig(config) {
  const issues = [], vars = config?.vars || {}, phase = vars.REXBID_PUBLICATION_PHASE;
  if (!PHASES.includes(phase)) issues.push('publication_phase_required');
  if (vars.REXBID_PUBLIC_CATALOG_MODE !== 'stored') issues.push('stored_public_catalog_required');
  if (Object.keys(config || {}).some(key => !CONFIG_KEYS.includes(key))) issues.push('unknown_binding_or_environment_forbidden');
  if (config?.account_id !== ACCOUNT) issues.push('exact_cloudflare_account_required');
  if (config?.main !== './worker.publication.js' || JSON.stringify(config?.routes) !== JSON.stringify(ROUTES)
    || config?.workers_dev !== false || config?.preview_urls !== false) issues.push('isolated_exact_apex_www_entrypoint_required');
  if (Object.keys(vars).some(key => !VARS.includes(key) && !PHASE_VARS.includes(key) && !Object.hasOwn(AUTO_VARS, key) && key !== 'REXBID_CATALOG_MEMBERSHIP_ENABLED')) issues.push('unknown_or_secret_variable');
  if (config?.r2_buckets?.length || config?.queues || config?.durable_objects || config?.migrations) issues.push('storage_or_automation_forbidden');
  if (Object.hasOwn(vars, 'REXBID_CATALOG_MEMBERSHIP_ENABLED') && vars.REXBID_CATALOG_MEMBERSHIP_ENABLED !== 'enabled') issues.push('invalid_catalog_membership_opt_in');
  if (Object.hasOwn(vars, 'REXBID_TAXONOMY_CACHE_ENABLED') && !['disabled','enabled'].includes(vars.REXBID_TAXONOMY_CACHE_ENABLED)) issues.push('invalid_taxonomy_cache_opt_in');
  const automatic = vars.REXBID_AUTO_REFRESH_ENABLED === 'enabled';
  if (vars.REXBID_TAXONOMY_CACHE_ENABLED === 'enabled' && (!automatic || vars.REXBID_CATALOG_MEMBERSHIP_ENABLED !== 'enabled'
    || vars.REXBID_PUBLIC_CATALOG_MODE !== 'stored' || vars.REXBID_RELEASE_D1_TARGET !== 'rexbid-production-preflight-db'
    || vars.REXBID_RELEASE_D1_DATABASE_ID !== 'c8a30088-70af-43a6-9a7f-c4018279d37d')) issues.push('taxonomy_cache_requires_isolated_membership_recipe');
  if (Object.hasOwn(vars, 'REXBID_CATALOG_MEMBERSHIP_ENABLED') && !automatic) issues.push('catalog_membership_requires_automatic_recipe');
  const hasAutomaticFields = Object.keys(AUTO_VARS).some(key => Object.hasOwn(vars, key));
  if (automatic) {
    if (!PHASES.includes(phase) || JSON.stringify(config?.triggers) !== JSON.stringify(AUTO_TRIGGER)
      || vars.REXBID_AUTO_REFRESH_DATABASE_ID !== AUTO_VARS.REXBID_AUTO_REFRESH_DATABASE_ID
      || Object.keys(AUTO_VARS).some(key => !Object.hasOwn(vars, key))) issues.push('isolated_automatic_refresh_recipe_required');
    try {
      const limit = automaticConfiguration(vars);
      if (limit.daily > 500 || limit.monthly > 12000 || limit.perRun > 8 || limit.newPerDay > 2000 || limit.quotaReserve < 500) issues.push('automatic_refresh_budget_exceeds_recipe');
    } catch {issues.push('automatic_refresh_configuration_invalid');}
  } else if (config?.triggers || hasAutomaticFields) issues.push('automatic_refresh_requires_explicit_recipe');
  const copy = structuredClone(config || {});
  // The prepared public shape is checked against the same isolated resource
  // validator. This conversion only validates; no binding is retargeted.
  copy.main = './worker.js'; copy.routes = [];
  copy.r2_buckets = [{binding: 'REXBID_PRIVATE_FILES', bucket_name: 'rexbid-production-private-files'}];
  copy.vars = {...vars, AUTH_ENABLED: 'false', REXBID_PORTAL_ENABLED: 'disabled'};
  delete copy.vars.REXBID_PUBLIC_CATALOG_MODE;
  delete copy.triggers;
  delete copy.vars.REXBID_CATALOG_MEMBERSHIP_ENABLED;
  for (const key of Object.keys(AUTO_VARS)) delete copy.vars[key];
  const base = validateProductionPreflight(copy);
  issues.push(...base.issues);
  if (phase === 'catalog') {
    if (vars.AUTH_ENABLED !== 'false' || vars.REXBID_PORTAL_ENABLED !== 'disabled'
      || ['AUTH_D1_SCHEMA_VERSION', 'REXBID_PORTAL_SCHEMA_VERSION', 'REXBID_PORTAL_OWNER_SETUP_ONLY'].some(key => Object.hasOwn(vars, key))) issues.push('catalog_features_must_remain_off');
  } else {
    if (vars.AUTH_ENABLED !== 'true' || vars.AUTH_D1_SCHEMA_VERSION !== '0003'
      || vars.AUTH_RECOVERY_MODE !== 'email-token' || vars.AUTH_RATE_LIMITING_MODE !== 'cloudflare'
      || vars.AUTH_CANONICAL_ORIGIN !== ORIGIN || vars.AUTH_ALLOWED_ORIGINS !== ORIGIN
      || vars.REXBID_PRODUCTION_SUPABASE_PROJECT_REF !== 'kkwbqzndildovbblbkcx') issues.push('independent_auth_configuration_required');
    if (phase === 'auth-setup') {
      if (vars.REXBID_PORTAL_ENABLED !== 'disabled' || Object.hasOwn(vars, 'REXBID_PORTAL_SCHEMA_VERSION')
        || Object.hasOwn(vars, 'REXBID_PORTAL_OWNER_SETUP_ONLY')) issues.push('auth_setup_keeps_portal_closed');
    } else if (vars.REXBID_PORTAL_ENABLED !== 'enabled' || vars.REXBID_PORTAL_SCHEMA_VERSION !== '0006'
      || (phase === 'owner-setup' ? vars.REXBID_PORTAL_OWNER_SETUP_ONLY !== 'true' : Object.hasOwn(vars, 'REXBID_PORTAL_OWNER_SETUP_ONLY'))) {
      issues.push('owner_setup_or_verified_portal_gate_required');
    }
  }
  return {ok: issues.length === 0, issues: [...new Set(issues)], phase: PHASES.includes(phase) ? phase : null,
    status: 'PREPARED_NOT_PUBLISHED', worker: 'rexbid-production-preflight', database: 'rexbid-production-preflight-db',
    current_production_modified: false, production_runtime_verified: false, approval_verified: false, files_enabled: false,
    secret_presence_verified: false, automatic_refresh_enabled: automatic,
    required_secret_names: phase === 'catalog' ? ['APIBARA_API_KEY'] : [
      'APIBARA_API_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'REXBID_AUTH_COOKIE_SECRET',
      ...(phase === 'owner-setup' || phase === 'portal-no-files' ? ['REXBID_OWNER_USER_ID', 'REXBID_PORTAL_DATA_KEYS', 'REXBID_PORTAL_ACTIVE_KEY_ID'] : [])
    ]};
}

function serialize(config) {return JSON.stringify(config, null, 2) + '\n';}
function generatedProfileConsistent(text, config) {
  // Git may check out CRLF on Windows; line endings do not change the profile.
  return typeof text === 'string' && text.replace(/\r\n/g, '\n') === serialize(config);
}
function main(args) {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'wrangler.production-preflight.jsonc'), 'utf8'));
  const trackedOutput = path.join(ROOT, 'wrangler.production-publication.jsonc');
  if ((args.length === 1 && ['--check', '--write'].includes(args[0]))
    || (args.length === 3 && args[0] === '--check' && args[1] === '--evidence')) {
    const existing = args[0] === '--check' ? JSON.parse(fs.readFileSync(trackedOutput, 'utf8')) : null;
    const phase = existing?.vars?.REXBID_PUBLICATION_PHASE || 'catalog';
    const evidence = args.length === 3 ? JSON.parse(fs.readFileSync(args[2], 'utf8')) : {};
    const expected = serialize(existing?.vars?.REXBID_AUTO_REFRESH_ENABLED === 'enabled'
      ? buildAutomaticPublicationConfig(base, phase, evidence, {catalogMembership: existing?.vars?.REXBID_CATALOG_MEMBERSHIP_ENABLED === 'enabled', taxonomyCache: existing?.vars?.REXBID_TAXONOMY_CACHE_ENABLED === 'enabled'}) : buildPublicationConfig(base, phase, evidence));
    if (args[0] === '--write') fs.writeFileSync(trackedOutput, expected, {flag: 'wx'});
    else if (!generatedProfileConsistent(fs.readFileSync(trackedOutput, 'utf8'), JSON.parse(expected))) throw new Error('publication_profile_out_of_date');
    console.log(JSON.stringify({...validatePublicationConfig(JSON.parse(expected)), generated_file_consistent: true}));
    return;
  }
  if (args.length === 3 && args[0] === '--automatic-refresh' && args[1] === '--output') {
    const config = buildAutomaticPublicationConfig(base);
    fs.writeFileSync(path.resolve(args[2]), serialize(config), {flag: 'wx'});
    console.log(JSON.stringify({...validatePublicationConfig(config), output_written: true, secrets_written: false}));
    return;
  }
  const withAutomaticRefresh = args.length === 7 && args[6] === '--automatic-refresh';
  if ((!withAutomaticRefresh && args.length !== 6) || args[0] !== '--phase' || args[2] !== '--evidence' || args[4] !== '--output') {
    throw new Error('usage: --check [--evidence evidence.json] OR --write OR --automatic-refresh --output new-profile.jsonc OR --phase auth-setup|owner-setup|portal-no-files --evidence evidence.json --output new-profile.jsonc [--automatic-refresh]');
  }
  const output = path.resolve(args[5]);
  const evidence = JSON.parse(fs.readFileSync(args[3], 'utf8'));
  const config = withAutomaticRefresh ? buildAutomaticPublicationConfig(base, args[1], evidence) : buildPublicationConfig(base, args[1], evidence);
  fs.writeFileSync(output, serialize(config), {flag: 'wx'});
  console.log(JSON.stringify({...validatePublicationConfig(config), output_written: true, secrets_written: false}));
}
if (require.main === module) {
  try {main(process.argv.slice(2));}
  catch (error) {
    console.error(error instanceof SyntaxError ? 'invalid_json_input' : error.code ? 'file_operation_failed' : error.message);
    process.exitCode = 1;
  }
}
module.exports = {buildPublicationConfig, buildAutomaticPublicationConfig, validatePublicationConfig, inspectPublicationEvidence, generatedProfileConsistent, BASE_EVIDENCE, OWNER_EVIDENCE, PORTAL_EVIDENCE, AUTO_VARS};
