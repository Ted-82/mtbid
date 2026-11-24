'use strict';

// This tool prepares a configuration; it never calls Cloudflare, Supabase or Git.
// Secrets are provisioned separately. The default invocation writes no files.
const fs = require('node:fs');
const path = require('node:path');
const {validateProductionSite} = require('./validate-production-site.cjs');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://rexbid.pl';
const BUCKET = 'rexbid-production-private-files';
const CALLBACK_ALLOWLIST = `${ORIGIN}/api/auth/callback?state=*`;
const RECOVERY_MODE = 'email-token';
const STAGING_PROJECT_REF = 'ydfsuncohsntqwmtmnhe';
const EVIDENCE = Object.freeze([
  'production_supabase_project_confirmed', 'independent_production_secrets_verified',
  'production_owner_mfa_verified', 'limiter_namespace_confirmed_unique',
  'accounts_portal_schema_verified', 'private_r2_verified', 'r2_free_usage_controls_verified',
  'smtp_confirmation_recovery_verified', 'fresh_backup_restore_verified',
  'legal_retention_reviewed', 'owner_cutover_approved'
]);
// A ready portal can operate without attachments. Only R2 evidence is omitted;
// production owner MFA and confirmation/recovery E2E remain required.
const PORTAL_NO_FILES_EVIDENCE = Object.freeze(EVIDENCE.filter(key =>
  !['private_r2_verified', 'r2_free_usage_controls_verified'].includes(key)));
// The owner must enroll MFA after Auth is usable. The setup profile exposes
// the existing owner-only MFA flow; administrative operations still need AAL2.
const OWNER_SETUP_EVIDENCE = Object.freeze([
  'production_supabase_project_confirmed', 'independent_production_secrets_verified',
  'limiter_namespace_confirmed_unique', 'accounts_portal_schema_verified',
  'smtp_configuration_verified', 'fresh_backup_restore_verified',
  'legal_retention_reviewed', 'owner_cutover_approved'
]);
function inspectActivation(input = {}, phase = 'portal') {
  if (!['portal', 'portal-no-files', 'owner-setup'].includes(phase)) throw new Error('invalid_activation_phase');
  const required = phase === 'owner-setup' ? OWNER_SETUP_EVIDENCE
    : phase === 'portal-no-files' ? PORTAL_NO_FILES_EVIDENCE : EVIDENCE;
  const missing = required.filter(key => input[key] !== true);
  if (!/^[1-9][0-9]{0,14}$/.test(String(input.limiter_namespace_id || ''))) missing.push('limiter_namespace_id');
  // The project reference is public metadata, not a key. Requiring an explicit
  // production reference makes a staging-secret copy detectable at preflight.
  if (!/^[a-z]{20}$/.test(String(input.production_supabase_project_ref || ''))
    || input.production_supabase_project_ref === STAGING_PROJECT_REF) missing.push('production_supabase_project_ref');
  return {ok: missing.length === 0, missing, status: 'PREPARED_NOT_DEPLOYED'};
}
function buildProductionPortalConfig(base, plan, input = {}, phase = 'portal') {
  const baseCheck = validateProductionSite(base);
  if (!baseCheck.ok) throw new Error('invalid_base_profile:' + baseCheck.issues.join(','));
  if (plan.base_profile !== 'wrangler.rexbid-production.jsonc' || plan.origin !== ORIGIN
    || plan.worker !== 'mtbid' || plan.database !== 'rexbid-db'
    || plan.database_id !== base.d1_databases[0].database_id
    || plan.proposed_private_bucket !== BUCKET || plan.public_access !== false
    || plan.bucket_binding !== 'REXBID_PRIVATE_FILES' || plan.bucket_class !== 'Standard'
    || plan.copy_staging_accounts_orders_files_or_secrets !== false || plan.reset_existing_mfa !== false
    || plan.supabase_site_url !== ORIGIN
    || JSON.stringify(plan.supabase_redirect_allowlist) !== JSON.stringify([CALLBACK_ALLOWLIST])
    || plan.auth_variables_after_approval?.AUTH_RECOVERY_MODE !== RECOVERY_MODE) {
    throw new Error('invalid_activation_plan');
  }
  // Configuration input is evidence and a namespace ID only, never credentials.
  const allowed = new Set([...EVIDENCE, ...OWNER_SETUP_EVIDENCE, 'limiter_namespace_id', 'production_supabase_project_ref']);
  if (!input || Array.isArray(input) || typeof input !== 'object'
    || Object.keys(input).some(key => !allowed.has(key))) throw new Error('unknown_or_secret_input');
  const activation = inspectActivation(input, phase);
  if (!activation.ok) throw new Error('activation_incomplete:' + activation.missing.join(','));
  // Once the production project has been independently confirmed, evidence
  // for a different project cannot silently retarget the generated profile.
  if (plan.production_supabase_project_confirmed === true
    && plan.production_supabase_project_ref !== input.production_supabase_project_ref) {
    throw new Error('confirmed_production_project_mismatch');
  }
  const config = structuredClone(base);
  Object.assign(config.vars, {
    AUTH_ENABLED: 'true', AUTH_D1_SCHEMA_VERSION: '0003',
    AUTH_CANONICAL_ORIGIN: ORIGIN, AUTH_ALLOWED_ORIGINS: ORIGIN,
    AUTH_RATE_LIMITING_MODE: 'cloudflare', AUTH_RECOVERY_MODE: RECOVERY_MODE,
    REXBID_PRODUCTION_SUPABASE_PROJECT_REF: input.production_supabase_project_ref,
    REXBID_PORTAL_ENABLED: 'enabled', REXBID_PORTAL_SCHEMA_VERSION: '0006',
    REXBID_PORTAL_FILES_ENABLED: phase === 'portal' ? 'enabled' : 'disabled'
  });
  // Coarse 30/minute per operation and actor; provider limits are independent.
  // namespace_id is account-scoped: require an explicitly checked unused ID.
  config.ratelimits = [{name: 'AUTH_RATE_LIMITER', namespace_id: String(input.limiter_namespace_id), simple: {limit: 30, period: 60}}];
  if (phase === 'portal') config.r2_buckets = [{binding: 'REXBID_PRIVATE_FILES', bucket_name: BUCKET}];
  else delete config.r2_buckets;
  return config;
}
function main(args) {
  let phase = 'portal';
  if (args[0] === '--phase') { phase = args[1]; args = args.slice(2); }
  inspectActivation({}, phase);
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'wrangler.rexbid-production.jsonc'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rexbid-production-portal-plan.json'), 'utf8'));
  if (args.length === 0 || (args.length === 1 && args[0] === '--check')) {
    const result = {base_valid: validateProductionSite(base).ok, ...inspectActivation({}, phase), phase, secret_values_in_config: false,
      auth_portal_activated: false, production_deploy_performed: false,
      required_secret_names: plan.required_secret_names,
      recovery_mode: RECOVERY_MODE, callback_allowlist: CALLBACK_ALLOWLIST,
      template_files: plan.supabase_email_templates,
      www_policy: plan.www_policy,
      activation_evidence_status: 'NO_ACTIVATION_EVIDENCE_INPUT_PROVIDED',
      recorded_plan_metadata: {
        production_supabase_project_confirmed: plan.production_supabase_project_confirmed === true,
        production_supabase_project_ref: plan.production_supabase_project_ref || null,
        smtp_configuration_recorded: plan.smtp?.configured_verified === true
      },
      plan_metadata_is_not_activation_approval: true};
    console.log(JSON.stringify(result, null, 2));
    if (!result.base_valid) process.exitCode = 1;
    return;
  }
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') throw new Error('usage: [--phase portal|portal-no-files|owner-setup] --check OR --input evidence.json --output prepared-profile.jsonc');
  const config = buildProductionPortalConfig(base, plan, JSON.parse(fs.readFileSync(args[1], 'utf8')), phase);
  const output = path.resolve(args[3]);
  if (['wrangler.jsonc', 'wrangler.staging.jsonc', 'wrangler.release.jsonc', 'wrangler.rexbid-production.jsonc'].includes(path.basename(output))) throw new Error('cannot_overwrite_existing_profile');
  fs.writeFileSync(output, JSON.stringify(config, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: 'PREPARED_NOT_DEPLOYED', phase, output, secrets_written: false}));
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    // A malformed input could contain credentials; never echo JSON snippets.
    console.error(error instanceof SyntaxError ? 'invalid_json_input' : error.code ? 'file_operation_failed' : error.message);
    process.exitCode = 1;
  }
}
module.exports = {inspectActivation, buildProductionPortalConfig, EVIDENCE, PORTAL_NO_FILES_EVIDENCE, OWNER_SETUP_EVIDENCE};
