'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validateProductionPreflight} = require('../scripts/validate-production-preflight.cjs');

function fixture() {
  return {
    name: 'rexbid-production-preflight', main: './worker.js', workers_dev: false, preview_urls: false, routes: [],
    assets: {directory: './public', binding: 'ASSETS', run_worker_first: true},
    vars: {
      REXBID_CANONICAL_ORIGIN: 'https://rexbid.pl', AUTH_ENABLED: 'false',
      REXBID_RELEASE_ORIGIN: 'https://rexbid.pl', REXBID_PRODUCTION_UI_ENABLED: 'enabled',
      REXBID_RELEASE_D1_TARGET: 'rexbid-production-preflight-db',
      REXBID_RELEASE_D1_DATABASE_ID: 'c8a30088-70af-43a6-9a7f-c4018279d37d',
      REXBID_D1_PRIMARY_READS: 'false', REXBID_LEGACY_SYNC_ENABLED: 'false',
      REXBID_PORTAL_ENABLED: 'disabled', REXBID_PORTAL_FILES_ENABLED: 'disabled',
      REXBID_PROVIDER_BUDGET_MODE: 'required',
      REXBID_PROVIDER_BUDGET_DAILY_LIMIT: '500', REXBID_PROVIDER_BUDGET_CATALOG_DAILY_LIMIT: '250',
      REXBID_PROVIDER_BUDGET_DETAIL_DAILY_LIMIT: '150', REXBID_PROVIDER_BUDGET_HISTORY_DAILY_LIMIT: '60',
      REXBID_PROVIDER_BUDGET_DISCOVERY_DAILY_LIMIT: '0', REXBID_PROVIDER_BUDGET_MEDIA_DAILY_LIMIT: '0',
      ...Object.fromEntries(['TRANSPORT_CALCULATOR', 'CALCULATOR_V3', 'CALCULATOR_V4'].flatMap(name => [
        [`REXBID_${name}_ENABLED`, 'enabled'], [`REXBID_${name}_ALLOWED_ORIGINS`, 'https://rexbid.pl']
      ]))
    },
    d1_databases: [{binding: 'REXBID_DB', database_name: 'rexbid-production-preflight-db', database_id: 'c8a30088-70af-43a6-9a7f-c4018279d37d'}],
    r2_buckets: [{binding: 'REXBID_PRIVATE_FILES', bucket_name: 'rexbid-production-private-files'}],
    ratelimits: [{name: 'AUTH_RATE_LIMITER', namespace_id: '2026100601', simple: {limit: 30, period: 60}}]
  };
}

test('isolated production preflight keeps current site and staging untouched and does not claim live readiness', () => {
  const config = fixture(), before = JSON.stringify(config), result = validateProductionPreflight(config);
  assert.equal(result.ok, true); assert.equal(JSON.stringify(config), before);
  assert.equal(result.public_routes, false); assert.equal(result.accounts_enabled, false);
  assert.equal(result.portal_enabled, false); assert.equal(result.launch_ready, false);
  assert.equal(result.production_runtime_verified, false);
  assert.equal(result.resource_verification, 'NOT_VERIFIED_BY_STATIC_VALIDATOR');
  assert.ok(result.required_secret_names.includes('APIBARA_API_KEY'));
  assert.ok(result.required_secret_names.includes('SUPABASE_URL'));
  assert.ok(result.pre_publication_checks.includes('smtp_confirmation_recovery_e2e_and_separate_owner_mfa'));
});

test('production preflight rejects public routing, current production or staging bindings and premature feature activation', () => {
  const invalid = [
    config => {config.name = 'mtbid';},
    config => {config.name = 'rexbid-auth-test';},
    config => {config.main = './worker.production.js';},
    config => {config.workers_dev = true;},
    config => {config.preview_urls = true;},
    config => {config.routes = [{pattern: 'rexbid.pl', custom_domain: true}];},
    config => {config.d1_databases[0].database_name = 'rexbid-db'; config.d1_databases[0].database_id = '971879fe-04ed-4e8c-9dc6-5306980bb872';},
    config => {config.d1_databases[0].database_name = 'rexbid-auth-test-db'; config.d1_databases[0].database_id = 'acb3cb8e-69a2-459f-8a46-0f2f5b9004be';},
    config => {config.r2_buckets[0].bucket_name = 'rexbid-staging-private-files';},
    config => {config.assets.run_worker_first = false;},
    config => {config.vars.AUTH_ENABLED = 'true';},
    config => {config.vars.REXBID_PORTAL_FILES_ENABLED = 'enabled';},
    config => {config.vars.REXBID_D1_PRIMARY_READS = 'true';},
    config => {config.vars.REXBID_PROVIDER_BUDGET_MODE = 'optional';},
    config => {config.vars.REXBID_PROVIDER_BUDGET_DISCOVERY_DAILY_LIMIT = '1';},
    config => {config.vars.REXBID_PROVIDER_BUDGET_MEDIA_DAILY_LIMIT = '1';},
    config => {config.vars.REXBID_CALCULATOR_V4_ALLOWED_ORIGINS = 'https://www.rexbid.pl';},
    config => {config.vars.REXBID_RELEASE_D1_TARGET = 'rexbid-db';},
    config => {config.vars.REXBID_RELEASE_D1_DATABASE_ID = '971879fe-04ed-4e8c-9dc6-5306980bb872';},
    config => {config.vars.REXBID_RELEASE_ORIGIN = 'https://www.rexbid.pl';},
    config => {config.vars.REXBID_PRODUCTION_UI_ENABLED = 'disabled';},
    config => {config.triggers = {crons: ['0 * * * *']};},
    config => {config.ratelimits[0].namespace_id = 'staging-namespace';}
  ];
  for (const change of invalid) {const config = fixture(); change(config); assert.equal(validateProductionPreflight(config).ok, false);}
});

test('production preflight errors are safe when a malformed profile includes credential material', () => {
  const config = fixture();
  config.vars.SUPABASE_URL = 'https://ydfsuncohsntqwmtmnhe.supabase.co';
  config.vars.REXBID_PORTAL_DATA_KEYS = 'private-do-not-print-fixture-marker';
  const result = validateProductionPreflight(config);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('secret_values_must_not_be_in_config'));
  assert.ok(result.issues.includes('staging_configuration_forbidden'));
  assert.doesNotMatch(JSON.stringify(result), /private-do-not-print-fixture-marker|ydfsuncohsntqwmtmnhe/);
});

test('independent production Auth metadata can be prepared without activation or staging origins', () => {
  const config = fixture();
  Object.assign(config.vars, {REXBID_PRODUCTION_SUPABASE_PROJECT_REF: 'productionfixtureabc',
    AUTH_CANONICAL_ORIGIN: 'https://rexbid.pl', AUTH_ALLOWED_ORIGINS: 'https://rexbid.pl',
    AUTH_RECOVERY_MODE: 'email-token', AUTH_RATE_LIMITING_MODE: 'cloudflare'});
  const result = validateProductionPreflight(config);
  assert.equal(result.ok, true); assert.equal(result.accounts_enabled, false); assert.equal(result.launch_ready, false);
  for (const patch of [
    {REXBID_PRODUCTION_SUPABASE_PROJECT_REF: 'ydfsuncohsntqwmtmnhe'},
    {REXBID_PRODUCTION_SUPABASE_PROJECT_REF: 'https://production.test'},
    {AUTH_ALLOWED_ORIGINS: 'https://rexbid.pl,https://www.rexbid.pl'},
    {AUTH_CANONICAL_ORIGIN: 'https://www.rexbid.pl'},
    {AUTH_RECOVERY_MODE: 'pkce'}, {AUTH_RATE_LIMITING_MODE: 'staging-bypass'}, {AUTH_ENABLED: 'true'}
  ]) assert.equal(validateProductionPreflight({...config, vars: {...config.vars, ...patch}}).ok, false);
});
