'use strict';

// Local-only rehearsal. SQL stays in memory; output contains hashes/counts only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const accountTables = ['users', 'user_favorites'];
const portalTables = ['import_orders', 'import_order_events', 'import_order_messages', 'import_order_files', 'portal_customer_profiles'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeSql = sql => String(sql || '').replace(/\s+/g, ' ').trim();
const quote = identifier => '"' + identifier.replace(/"/g, '""') + '"';

function inventory(db) {
  const objects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const counts = Object.fromEntries(objects.filter(row => row.type === 'table' && !row.name.startsWith('_cf_')).map(row => [row.name, Number(db.prepare(`SELECT COUNT(*) n FROM ${quote(row.name)}`).get().n)]));
  return {objects, counts, schema_sha256: digest(JSON.stringify(objects.map(row => ({...row, sql: normalizeSql(row.sql)})))), foreign_key_violations: db.prepare('PRAGMA foreign_key_check').all().length};
}

function oldDataFingerprint(db, tables) {
  return digest(JSON.stringify(tables.map(name => [name, db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all()])));
}

function apply(db, file, failure = false) {
  const sql = fs.readFileSync(path.join(root, 'docs/proposals', file), 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    if (failure) db.exec('SELECT * FROM __intentional_local_rehearsal_failure');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function rehearse(sql) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(sql);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'export_disabled_foreign_keys');
    const before = inventory(db);
    assert.equal(before.foreign_key_violations, 0, 'source_foreign_keys_invalid');
    const migrationNames = db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(row => row.name);
    assert.deepEqual(migrationNames, ['0000_rexbid_base.sql', '0001_auction_history_events.sql', '0002_provider_read_budgets.sql'], 'unexpected_production_baseline');
    for (const table of [...accountTables, ...portalTables, 'auction_listings']) assert.equal(table in before.counts, false, 'source_is_not_pre_accounts_production');
    const oldTables = Object.keys(before.counts);
    const originalDataHash = oldDataFingerprint(db, oldTables);

    apply(db, '0003_accounts_foundation.sql');
    const afterAccounts = inventory(db);
    assert.throws(() => apply(db, '0006_import_operations.sql', true));
    assert.equal(inventory(db).schema_sha256, afterAccounts.schema_sha256, 'failed_portal_migration_not_rolled_back');
    for (const table of portalTables) assert.equal(table in inventory(db).counts, false);
    apply(db, '0006_import_operations.sql');
    const afterPortal = inventory(db);
    apply(db, '0003_accounts_foundation.sql');
    apply(db, '0006_import_operations.sql');
    assert.equal(inventory(db).schema_sha256, afterPortal.schema_sha256, 'migration_replay_schema_drift');
    assert.equal(oldDataFingerprint(db, oldTables), originalDataHash, 'existing_data_changed');
    for (const table of [...accountTables, ...portalTables]) assert.equal(afterPortal.counts[table], 0, 'unexpected_customer_import');
    assert.equal(afterPortal.foreign_key_violations, 0, 'migrated_foreign_keys_invalid');
    for (const object of before.objects) {
      const persisted = afterPortal.objects.find(row => row.type === object.type && row.name === object.name);
      assert.deepEqual(persisted, object, 'existing_schema_changed');
    }

    // Recover a disposable partial application without copying customer rows.
    const partial = new DatabaseSync(':memory:');
    try {
      partial.exec('PRAGMA foreign_keys=ON');
      partial.exec(sql);
      apply(partial, '0003_accounts_foundation.sql');
      const portalSql = fs.readFileSync(path.join(root, 'docs/proposals/0006_import_operations.sql'), 'utf8');
      const firstCreate = portalSql.match(/CREATE TABLE IF NOT EXISTS import_orders\s*\([\s\S]*?\);/);
      assert.ok(firstCreate, 'first_portal_table_not_found');
      partial.exec(firstCreate[0]);
      apply(partial, '0006_import_operations.sql');
      assert.equal(inventory(partial).schema_sha256, afterPortal.schema_sha256, 'partial_recovery_schema_drift');
      assert.equal(oldDataFingerprint(partial, oldTables), originalDataHash, 'partial_recovery_changed_existing_data');
    } finally { partial.close(); }

    return {
      ok: true,
      kind: 'local_memory_restore_and_migration_rehearsal',
      source_sql_sha256: digest(sql),
      applied_source_migrations: migrationNames,
      before: {counts: before.counts, schema_sha256: before.schema_sha256, foreign_key_violations: before.foreign_key_violations},
      after: {counts: afterPortal.counts, schema_sha256: afterPortal.schema_sha256, foreign_key_violations: afterPortal.foreign_key_violations},
      proposal_sha256: Object.fromEntries(['0003_accounts_foundation.sql', '0006_import_operations.sql'].map(file => [file, digest(fs.readFileSync(path.join(root, 'docs/proposals', file)))])),
      existing_rows_and_schema_preserved: true,
      rollback_of_failed_0006: true,
      proposal_replay: true,
      disposable_partial_0006_recovery: true,
      accounts_portal_empty: true,
      sync2_created: false,
      remote_write: false
    };
  } finally { db.close(); }
}

if (require.main === module) {
  try {
    const sql = fs.readFileSync(0, 'utf8');
    if (!sql || Buffer.byteLength(sql) > 200 * 1024 * 1024) throw new Error('input_invalid');
    console.log(JSON.stringify(rehearse(sql), null, 2));
  } catch {
    console.error(JSON.stringify({ok: false, code: 'local_rehearsal_failed', remote_write: false}));
    process.exitCode = 1;
  }
}

module.exports = {rehearse};
