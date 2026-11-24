'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {rehearse} = require('../scripts/rehearse-production-migrations.cjs');
const root = path.resolve(__dirname, '..');
function baseline() {
  return "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL);\n" +
    ['0000_rexbid_base.sql', '0001_auction_history_events.sql', '0002_provider_read_budgets.sql'].map((file, index) => fs.readFileSync(path.join(root, 'migrations', file), 'utf8') + `\nINSERT INTO d1_migrations(id,name) VALUES(${index + 1},'${file}');\n`).join('\n') +
    "INSERT INTO provider_request_budgets(provider,budget_day,normal_limit,retry_limit,normal_consumed,updated_at) VALUES('apibara','2026-10-06',500,0,17,'2026-10-06T00:00:00Z');";
}
test('local production backup rehearsal preserves existing rows and checks atomic failure, replay and partial portal recovery', () => {
  const report = rehearse(baseline());
  assert.equal(report.ok, true);
  assert.equal(report.before.counts.provider_request_budgets, 1);
  assert.equal(report.after.counts.provider_request_budgets, 1);
  for (const key of ['existing_rows_and_schema_preserved', 'rollback_of_failed_0006', 'proposal_replay', 'disposable_partial_0006_recovery', 'accounts_portal_empty']) assert.equal(report[key], true);
  assert.equal(report.after.counts.users, 0);
  assert.equal(report.after.counts.import_orders, 0);
  assert.equal(report.after.foreign_key_violations, 0);
  assert.equal(report.remote_write, false);
  assert.equal(report.sync2_created, false);
  assert.equal(report.source_sql, undefined, 'report must not include backup data');
});
test('production rehearsal rejects a staging/customer schema or unexpected migration baseline', () => {
  assert.throws(() => rehearse(baseline() + fs.readFileSync(path.join(root, 'docs/proposals/0003_accounts_foundation.sql'), 'utf8')), /source_is_not_pre_accounts_production/);
  assert.throws(() => rehearse(baseline() + "INSERT INTO d1_migrations(id,name) VALUES(4,'unexpected.sql');"), /unexpected_production_baseline/);
});
