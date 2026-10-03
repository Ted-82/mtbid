"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");
const {createProviderRequestBudget, ProviderBudgetError} = require("../providers/request-budget.js");
const {D1SyncRepository} = require("../sync/d1-repository.js");

const ROOT = path.join(__dirname, "..");

class DisposableD1 {
  constructor(database) { this.database = database; this.tail = Promise.resolve(); }
  prepare(sql) {
    const db = this.database;
    return {bind(...params) {
      return {
        sql, params,
        async run() { const result = db.prepare(sql).run(...params); return {success: true, meta: {changes: Number(result.changes)}}; },
        async first() { return db.prepare(sql).get(...params) ?? null; },
        async all() { return {results: db.prepare(sql).all(...params)}; }
      };
    }};
  }
  batch(statements) {
    const run = this.tail.then(() => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(statement => {
          const result = this.database.prepare(statement.sql).run(...statement.params);
          return {success: true, meta: {changes: Number(result.changes)}};
        });
        this.database.exec("COMMIT");
        return results;
      } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["migrations/0000_rexbid_base.sql", "migrations/0001_auction_history_events.sql", "docs/proposals/0004_d1_sync_2.sql"]) {
    sqlite.exec(fs.readFileSync(path.join(ROOT, file), "utf8"));
  }
  return {sqlite, d1: new DisposableD1(sqlite)};
}

function minimalReadBudgetDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["migrations/0000_rexbid_base.sql", "migrations/0001_auction_history_events.sql", "migrations/0002_provider_read_budgets.sql"]) {
    sqlite.exec(fs.readFileSync(path.join(ROOT, file), "utf8"));
  }
  return {sqlite, d1: new DisposableD1(sqlite)};
}

function env(db, {global = 3, catalog = 2, detail = 2} = {}) {
  return {REXBID_DB: db, REXBID_PROVIDER_BUDGET_MODE: "required",
    REXBID_PROVIDER_BUDGET_DAILY_LIMIT: String(global),
    REXBID_PROVIDER_BUDGET_CATALOG_DAILY_LIMIT: String(catalog),
    REXBID_PROVIDER_BUDGET_DETAIL_DAILY_LIMIT: String(detail),
    REXBID_PROVIDER_BUDGET_HISTORY_DAILY_LIMIT: "1",
    REXBID_PROVIDER_BUDGET_DISCOVERY_DAILY_LIMIT: "1",
    REXBID_PROVIDER_BUDGET_MEDIA_DAILY_LIMIT: "1"};
}

test("provider budget atomically counts global and operation caps and blocks before upstream", async () => {
  const {sqlite, d1} = database();
  let id = 0;
  const budget = createProviderRequestBudget({now: () => Date.parse("2026-10-03T12:00:00Z"), uuid: () => `reservation-${++id}`});
  const settings = env(d1, {global: 3, catalog: 2});
  const first = await budget.begin(settings, {operation: "listVehicles"});
  await first.finish();
  const second = await budget.begin(settings, {operation: "listVehicles"});
  await second.finish();
  await assert.rejects(budget.begin(settings, {operation: "listVehicles"}), error => error instanceof ProviderBudgetError && error.status === 429 && error.code === "RATE_LIMITED");
  const rows = sqlite.prepare("SELECT provider,normal_consumed,normal_reserved,normal_limit FROM provider_request_budgets ORDER BY provider").all();
  assert.deepEqual(rows.map(row => [row.provider, row.normal_consumed, row.normal_reserved, row.normal_limit]), [
    ["apibara:all", 2, 0, 3], ["apibara:catalog", 2, 0, 2]
  ]);
  sqlite.close();
});

test("concurrent operation reservations cannot over-issue the shared daily budget", async () => {
  const {sqlite, d1} = database();
  let id = 0;
  const budget = createProviderRequestBudget({now: () => Date.parse("2026-10-03T12:00:00Z"), uuid: () => `parallel-${++id}`});
  const settings = env(d1, {global: 1, catalog: 1, detail: 1});
  const outcomes = await Promise.allSettled([
    budget.begin(settings, {operation: "listVehicles"}),
    budget.begin(settings, {operation: "vehicleByIdentifier"})
  ]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(result => result.status === "rejected" && result.reason?.code === "RATE_LIMITED").length, 1);
  const global = sqlite.prepare("SELECT normal_consumed,normal_reserved FROM provider_request_budgets WHERE provider='apibara:all'").get();
  assert.deepEqual({...global}, {normal_consumed: 1, normal_reserved: 0});
  for (const result of outcomes) if (result.status === "fulfilled") await result.value.finish();
  sqlite.close();
});

test("required provider budgets fail closed when configuration or D1 schema is absent", async () => {
  const budget = createProviderRequestBudget({now: () => Date.now(), uuid: () => "missing-config"});
  await assert.rejects(budget.begin({REXBID_PROVIDER_BUDGET_MODE: "required"}, {operation: "listVehicles"}), error => error.code === "CONFIGURATION" && error.status === 503);
  const disabled = await budget.begin({}, {operation: "listVehicles"});
  assert.equal(disabled.enforced, false);
  await disabled.finish();
});

test("minimal pre-Sync migration durably budgets public reads while discovery/media and Sync writes stay fail-closed", async () => {
  const {sqlite, d1} = minimalReadBudgetDatabase();
  const budget = createProviderRequestBudget({now: () => Date.parse("2026-10-03T12:00:00Z"), uuid: () => "pre-sync-read-1"});
  const settings = {
    REXBID_DB: d1,
    REXBID_PROVIDER_BUDGET_MODE: "required",
    REXBID_PROVIDER_BUDGET_DAILY_LIMIT: "500",
    REXBID_PROVIDER_BUDGET_CATALOG_DAILY_LIMIT: "250",
    REXBID_PROVIDER_BUDGET_DETAIL_DAILY_LIMIT: "150",
    REXBID_PROVIDER_BUDGET_HISTORY_DAILY_LIMIT: "60",
    REXBID_PROVIDER_BUDGET_DISCOVERY_DAILY_LIMIT: "0",
    REXBID_PROVIDER_BUDGET_MEDIA_DAILY_LIMIT: "0"
  };
  const read = await budget.begin(settings, {operation: "listVehicles"});
  assert.equal(read.enforced, true);
  await read.finish();
  assert.equal(sqlite.prepare("SELECT normal_consumed FROM provider_request_budgets WHERE provider='apibara:all'").get().normal_consumed, 1);
  assert.equal(sqlite.prepare("SELECT normal_consumed FROM provider_request_budgets WHERE provider='apibara:catalog'").get().normal_consumed, 1);
  await assert.rejects(budget.begin(settings, {budgetClass: "discovery"}), error => error instanceof ProviderBudgetError && error.code === "CONFIGURATION");
  await assert.rejects(budget.begin(settings, {budgetClass: "media_enrichment"}), error => error instanceof ProviderBudgetError && error.code === "CONFIGURATION");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM provider_request_reservations WHERE state='finished' AND provider='apibara:all'").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sync_batch_guards").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('provider_sync_scopes','auction_listings','sync_runs')").get().n, 0);
  await assert.rejects(new D1SyncRepository(d1).ensureScope({scopeKey:"should-not-exist",provider:"apibara",platform:"copart",now:Date.now()}), /no such table: provider_sync_scopes/);
  // The later Sync proposal is additive and accepts the already-installed shared budget primitives.
  sqlite.exec(fs.readFileSync(path.join(ROOT, "docs/proposals/0004_d1_sync_2.sql"), "utf8"));
  assert.equal(sqlite.prepare("SELECT normal_consumed FROM provider_request_budgets WHERE provider='apibara:all'").get().normal_consumed, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM provider_request_budgets WHERE provider='apibara:all'").get().n, 1);
  sqlite.close();
});
