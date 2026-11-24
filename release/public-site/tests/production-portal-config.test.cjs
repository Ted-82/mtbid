'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {inspectActivation, buildProductionPortalConfig, EVIDENCE, PORTAL_NO_FILES_EVIDENCE, OWNER_SETUP_EVIDENCE} = require('../scripts/prepare-production-portal.cjs');
const {isAuthConfigurationComplete: configured} = require('../auth/routes.js');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../wrangler.rexbid-production.jsonc'), 'utf8'));
const PROJECT = 'productionfixtureabc';
// Configuration behavior is tested with an explicit synthetic project, never
// credentials or an activation approval for the real production project.
const plan = {...require('../config/rexbid-production-portal-plan.json'),
  production_supabase_project_ref: PROJECT, production_supabase_project_confirmed: true};
const ready = () => Object.fromEntries([...EVIDENCE.map(key => [key, true]), ['limiter_namespace_id', '900000000000001'], ['production_supabase_project_ref', PROJECT]]);

test('production portal preparation is blocked until every dependency is independently verified', () => {
  assert.equal(inspectActivation().ok, false);
  for (const key of EVIDENCE) {
    const evidence = ready(); evidence[key] = false;
    assert.ok(inspectActivation(evidence).missing.includes(key));
    assert.throws(() => buildProductionPortalConfig(base, plan, evidence), /activation_incomplete/);
  }
  for (const namespace of [null, '0', '-1', 'shared-staging', '1.5', '1234567890123456']) {
    assert.throws(() => buildProductionPortalConfig(base, plan, {...ready(), limiter_namespace_id: namespace}), /limiter_namespace_id/);
  }
});
test('complete portal profile preserves provider-backed catalog and V4; production owns its storage and limiter', () => {
  const before = JSON.stringify(base), config = buildProductionPortalConfig(base, plan, ready());
  assert.equal(JSON.stringify(base), before);
  assert.equal(config.main, './worker.js'); assert.equal(config.name, 'mtbid');
  assert.equal(config.vars.AUTH_ENABLED, 'true'); assert.equal(config.vars.REXBID_PORTAL_FILES_ENABLED, 'enabled');
  assert.equal(config.vars.AUTH_CANONICAL_ORIGIN, 'https://rexbid.pl');
  assert.equal(config.vars.AUTH_ALLOWED_ORIGINS, 'https://rexbid.pl');
  assert.equal(config.vars.AUTH_RATE_LIMITING_MODE, 'cloudflare');
  assert.equal(config.vars.AUTH_RECOVERY_MODE, 'email-token');
  assert.equal(config.vars.REXBID_PRODUCTION_SUPABASE_PROJECT_REF, PROJECT);
  assert.deepEqual(config.r2_buckets, [{binding: 'REXBID_PRIVATE_FILES', bucket_name: 'rexbid-production-private-files'}]);
  assert.deepEqual(config.ratelimits[0].simple, {limit: 30, period: 60});
  assert.deepEqual(config.d1_databases, base.d1_databases);
  for (const key of Object.keys(base.vars).filter(key => /BUDGET|CALCULATOR|D1_PRIMARY|LEGACY_SYNC/.test(key))) assert.equal(config.vars[key], base.vars[key]);
  assert.equal(config.triggers, undefined);
  assert.doesNotMatch(JSON.stringify(config), /rexbid-auth-test|staging-bypass|AUTH_TEST|AUTH_DIAGNOSTICS|MFA_PENDING|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|COOKIE_SECRET|PORTAL_DATA_KEYS/);
});
test('staging targets, disabled release wrapper and credential injection cannot produce a production portal profile', () => {
  for (const patch of [{database: 'rexbid-auth-test-db'}, {proposed_private_bucket: 'rexbid-staging-private-files'}, {bucket_class: 'InfrequentAccess'}, {public_access: true}, {copy_staging_accounts_orders_files_or_secrets: true}, {reset_existing_mfa: true}]) {
    assert.throws(() => buildProductionPortalConfig(base, {...plan, ...patch}, ready()), /invalid_activation_plan/);
  }
  assert.throws(() => buildProductionPortalConfig({...base, main: './worker.production.js'}, plan, ready()), /invalid_base_profile/);
  assert.throws(() => buildProductionPortalConfig(base, plan, {...ready(), SUPABASE_PUBLISHABLE_KEY: 'synthetic-value'}), /unknown_or_secret_input/);
});
test('planned production Auth fails closed for absent secrets or limiter and never accepts staging host', () => {
  const config = buildProductionPortalConfig(base, plan, ready());
  const env = {...config.vars, REXBID_DB: {}, SUPABASE_URL: `https://${PROJECT}.supabase.co`, SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key',
    REXBID_AUTH_COOKIE_SECRET: 'x'.repeat(43), AUTH_RATE_LIMITER: {limit: async () => ({success: true})}};
  assert.equal(configured(env, 'https://rexbid.pl/api/me'), true);
  assert.equal(configured(env, 'https://rexbid-auth-test.tedn828.workers.dev/api/me'), false);
  for (const key of ['REXBID_AUTH_COOKIE_SECRET', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'AUTH_RATE_LIMITER']) {
    assert.equal(configured({...env, [key]: undefined}, 'https://rexbid.pl/api/me'), false);
  }
});

test('offline configuration validation does not misreport an already deployed budget migration as missing', () => {
  const {validateWorkerConfigs} = require('../scripts/validate-worker-config.cjs');
  const report = validateWorkerConfigs();
  assert.equal(report.ok, true);
  assert.equal(report.production.runtime_schema_status, 'NOT_VERIFIED_BY_STATIC_VALIDATOR');
  assert.equal(report.production.launch_blockers, undefined);
  assert.ok(report.production.predeploy_runtime_checks.includes('confirm_remote_0002_schema_and_target'));
});

test('controlled owner setup precedes verified MFA and recovery E2E without enabling attachments', () => {
  const evidence = Object.fromEntries([...OWNER_SETUP_EVIDENCE.map(key => [key, true]), ['limiter_namespace_id', '900000000000001'], ['production_supabase_project_ref', PROJECT]]);
  const setup = buildProductionPortalConfig(base, plan, evidence, 'owner-setup');
  assert.equal(setup.vars.AUTH_ENABLED, 'true');
  // The existing owner-only MFA endpoints require the portal schema gate.
  assert.equal(setup.vars.REXBID_PORTAL_ENABLED, 'enabled');
  assert.equal(setup.vars.REXBID_PORTAL_SCHEMA_VERSION, '0006');
  assert.equal(setup.vars.REXBID_PORTAL_FILES_ENABLED, 'disabled');
  assert.equal(setup.r2_buckets, undefined);
  assert.equal(setup.vars.REXBID_D1_PRIMARY_READS, 'false');
  assert.equal(setup.triggers, undefined);
  assert.throws(() => buildProductionPortalConfig(base, plan, evidence), /production_owner_mfa_verified/);
  for (const key of OWNER_SETUP_EVIDENCE) {
    assert.throws(() => buildProductionPortalConfig(base, plan, {...evidence, [key]: false}, 'owner-setup'), /activation_incomplete/);
  }
  assert.throws(() => buildProductionPortalConfig(base, plan, evidence, 'public-bypass'), /invalid_activation_phase/);
});

test('production preflight rejects undeclared or staging Auth project and outdated recovery mode before upstream access', async () => {
  const {createAccountsHandler} = require('../auth/routes.js');
  let calls = 0;
  const handler = createAccountsHandler({provider: {verifyIdentity: async () => {calls++; throw new Error('must not reach provider');}}});
  const config = buildProductionPortalConfig(base, plan, ready());
  const env = {...config.vars, REXBID_DB: {}, SUPABASE_URL: `https://${PROJECT}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key', REXBID_AUTH_COOKIE_SECRET: 'x'.repeat(43),
    AUTH_RATE_LIMITER: {limit: async () => ({success: true})}};
  for (const patch of [
    {REXBID_PRODUCTION_SUPABASE_PROJECT_REF: undefined},
    {SUPABASE_URL: 'https://ydfsuncohsntqwmtmnhe.supabase.co'},
    {REXBID_PRODUCTION_SUPABASE_PROJECT_REF: 'ydfsuncohsntqwmtmnhe', SUPABASE_URL: 'https://ydfsuncohsntqwmtmnhe.supabase.co'},
    {AUTH_RECOVERY_MODE: undefined}, {AUTH_RECOVERY_MODE: 'pkce'},
    {AUTH_CANONICAL_ORIGIN: 'https://www.rexbid.pl'},
    {AUTH_ALLOWED_ORIGINS: 'https://www.rexbid.pl'},
    {AUTH_ALLOWED_ORIGINS: 'https://rexbid.pl,https://rexbid-auth-test.tedn828.workers.dev'}
  ]) {
    const response = await handler(new Request('https://rexbid.pl/api/me'), {...env, ...patch});
    assert.equal(response.status, 503);
  }
  assert.equal(calls, 0);
  for (const ref of [undefined, 'ydfsuncohsntqwmtmnhe', 'https://production.test', 'UPPERCASEUPPERCASEUPP']) {
    assert.throws(() => buildProductionPortalConfig(base, plan, {...ready(), production_supabase_project_ref: ref}), /production_supabase_project_ref/);
  }
});

test('production email templates preserve PKCE confirmation and cross-browser restricted recovery without staging URLs', () => {
  assert.deepEqual(plan.supabase_redirect_allowlist, ['https://rexbid.pl/api/auth/callback?state=*']);
  assert.equal(plan.supabase_site_url, 'https://rexbid.pl');
  assert.equal(plan.smtp.sender, 'no-reply@powiadomienia.rexbid.pl');
  const confirmation = fs.readFileSync(path.join(__dirname, '..', plan.supabase_email_templates.confirmation), 'utf8');
  const recovery = fs.readFileSync(path.join(__dirname, '..', plan.supabase_email_templates.recovery), 'utf8');
  assert.match(confirmation, /\{\{ \.ConfirmationURL \}\}/);
  assert.match(recovery, /\{\{ \.SiteURL \}\}\/api\/auth\/recovery\/confirm\?token_hash=\{\{ \.TokenHash \}\}&amp;type=recovery/);
  assert.doesNotMatch(recovery, /ConfirmationURL|access_token|refresh_token|code_verifier|type=signup/);
  for (const html of [confirmation, recovery]) {
    assert.match(html, /<html lang="pl">/); assert.match(html, /REX.*BID/);
    assert.doesNotMatch(html, /rexbid-auth-test|ydfsuncohsntqwmtmnhe|www\.rexbid\.pl|<script|<iframe/);
  }
  for (const patch of [
    {supabase_site_url: 'https://rexbid-auth-test.tedn828.workers.dev'},
    {supabase_redirect_allowlist: ['https://rexbid.pl/**']},
    {auth_variables_after_approval: {...plan.auth_variables_after_approval, AUTH_RECOVERY_MODE: 'pkce'}}
  ]) assert.throws(() => buildProductionPortalConfig(base, {...plan, ...patch}, ready()), /invalid_activation_plan/);
});

test('a confirmed production Auth project cannot be silently replaced by new activation evidence', () => {
  assert.equal(buildProductionPortalConfig(base, plan, ready()).vars.REXBID_PRODUCTION_SUPABASE_PROJECT_REF, PROJECT);
  assert.throws(() => buildProductionPortalConfig(base, plan, {...ready(), production_supabase_project_ref: 'b'.repeat(20)}), /confirmed_production_project_mismatch/);
  assert.equal(inspectActivation({...ready(), owner_cutover_approved: false}).ok, false);
});

test('private R2 verification cannot enable attachments without verified global free-usage controls', () => {
  const evidence = {...ready(), private_r2_verified: true, r2_free_usage_controls_verified: false};
  const before = JSON.stringify(base);
  assert.ok(inspectActivation(evidence).missing.includes('r2_free_usage_controls_verified'));
  assert.throws(() => buildProductionPortalConfig(base, plan, evidence), /activation_incomplete:r2_free_usage_controls_verified/);
  assert.equal(JSON.stringify(base), before);
  assert.equal(base.vars.REXBID_PORTAL_FILES_ENABLED, 'disabled');
  // A private, empty bucket and an alert do not establish an enforceable cost
  // cap. Owner setup does not enable files and does not need that evidence.
  const setupEvidence = Object.fromEntries([...OWNER_SETUP_EVIDENCE.map(key => [key, true]),
    ['limiter_namespace_id', '900000000000001'], ['production_supabase_project_ref', PROJECT]]);
  assert.equal(inspectActivation(setupEvidence, 'owner-setup').ok, true);
  const setup = buildProductionPortalConfig(base, plan, setupEvidence, 'owner-setup');
  assert.equal(setup.vars.REXBID_PORTAL_FILES_ENABLED, 'disabled');
  assert.equal(setup.r2_buckets, undefined);
});

test('ready portal without files omits only R2 evidence and preserves production identity and provider budgets', () => {
  const evidence = ready();
  delete evidence.private_r2_verified;
  delete evidence.r2_free_usage_controls_verified;
  const before = JSON.stringify(base), planBefore = JSON.stringify(plan);
  assert.equal(inspectActivation(evidence, 'portal-no-files').ok, true);
  const config = buildProductionPortalConfig(base, plan, evidence, 'portal-no-files');
  assert.equal(config.name, 'mtbid');
  assert.equal(config.main, './worker.js');
  assert.deepEqual(config.d1_databases, base.d1_databases);
  assert.deepEqual(config.routes, base.routes);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.vars.AUTH_ENABLED, 'true');
  assert.equal(config.vars.REXBID_PORTAL_ENABLED, 'enabled');
  assert.equal(config.vars.REXBID_PORTAL_SCHEMA_VERSION, '0006');
  assert.equal(config.vars.REXBID_PORTAL_FILES_ENABLED, 'disabled');
  assert.equal(config.r2_buckets, undefined);
  assert.equal(config.vars.AUTH_CANONICAL_ORIGIN, 'https://rexbid.pl');
  assert.equal(config.vars.AUTH_ALLOWED_ORIGINS, 'https://rexbid.pl');
  assert.equal(config.vars.AUTH_RATE_LIMITING_MODE, 'cloudflare');
  assert.equal(config.vars.AUTH_RECOVERY_MODE, 'email-token');
  assert.equal(config.vars.REXBID_PRODUCTION_SUPABASE_PROJECT_REF, PROJECT);
  assert.deepEqual(config.ratelimits[0].simple, {limit: 30, period: 60});
  for (const key of Object.keys(base.vars).filter(key => /BUDGET|CALCULATOR|D1_PRIMARY|LEGACY_SYNC/.test(key))) assert.equal(config.vars[key], base.vars[key]);
  assert.equal(config.triggers, undefined);
  assert.equal(JSON.stringify(base), before);
  assert.equal(JSON.stringify(plan), planBefore);
  assert.throws(() => buildProductionPortalConfig(base, plan, evidence, 'portal'), /private_r2_verified.*r2_free_usage_controls_verified/);
  for (const r2Evidence of [false, true]) {
    const noFiles = buildProductionPortalConfig({...base, r2_buckets: []}, plan,
      {...evidence, private_r2_verified: r2Evidence, r2_free_usage_controls_verified: r2Evidence}, 'portal-no-files');
    assert.equal(noFiles.vars.REXBID_PORTAL_FILES_ENABLED, 'disabled');
    assert.equal(noFiles.r2_buckets, undefined);
  }
});

test('portal without files still requires every full portal gate other than R2 and rejects unsafe targets or credentials', () => {
  const required = EVIDENCE.filter(key => !['private_r2_verified', 'r2_free_usage_controls_verified'].includes(key));
  assert.deepEqual(PORTAL_NO_FILES_EVIDENCE, required);
  for (const key of required) {
    for (const value of [undefined, false, 'true']) {
      const evidence = {...ready(), [key]: value};
      assert.ok(inspectActivation(evidence, 'portal-no-files').missing.includes(key));
      assert.throws(() => buildProductionPortalConfig(base, plan, evidence, 'portal-no-files'), /activation_incomplete/);
    }
  }
  for (const patch of [{database: 'rexbid-auth-test-db'}, {worker: 'rexbid-production-preflight'}, {origin: 'https://www.rexbid.pl'}, {copy_staging_accounts_orders_files_or_secrets: true}, {reset_existing_mfa: true}]) {
    assert.throws(() => buildProductionPortalConfig(base, {...plan, ...patch}, ready(), 'portal-no-files'), /invalid_activation_plan/);
  }
  assert.throws(() => buildProductionPortalConfig({...base, main: './worker.production.js'}, plan, ready(), 'portal-no-files'), /invalid_base_profile/);
  assert.throws(() => buildProductionPortalConfig({...base, r2_buckets: [{binding: 'REXBID_PRIVATE_FILES', bucket_name: 'rexbid-staging-private-files'}]}, plan, ready(), 'portal-no-files'), /invalid_base_profile/);
  assert.throws(() => buildProductionPortalConfig(base, plan, {...ready(), SUPABASE_PUBLISHABLE_KEY: 'synthetic-value'}, 'portal-no-files'), /unknown_or_secret_input/);
  assert.throws(() => buildProductionPortalConfig(base, plan, {...ready(), production_supabase_project_ref: 'ydfsuncohsntqwmtmnhe'}, 'portal-no-files'), /production_supabase_project_ref/);
  assert.throws(() => buildProductionPortalConfig(base, plan, {...ready(), production_supabase_project_ref: 'b'.repeat(20)}, 'portal-no-files'), /confirmed_production_project_mismatch/);
  assert.throws(() => buildProductionPortalConfig(base, plan, {...ready(), limiter_namespace_id: '0'}, 'portal-no-files'), /limiter_namespace_id/);
});

test('portal without files CLI check reports remaining production gates without writing a profile', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/prepare-production-portal.cjs'), '--phase', 'portal-no-files', '--check'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.phase, 'portal-no-files');
  assert.equal(report.ok, false);
  assert.equal(report.auth_portal_activated, false);
  assert.equal(report.production_deploy_performed, false);
  assert.equal(report.plan_metadata_is_not_activation_approval, true);
  assert.ok(report.missing.includes('production_owner_mfa_verified'));
  assert.ok(report.missing.includes('smtp_confirmation_recovery_verified'));
  assert.equal(report.missing.includes('private_r2_verified'), false);
  assert.equal(report.missing.includes('r2_free_usage_controls_verified'), false);
});
