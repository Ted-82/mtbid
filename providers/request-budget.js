"use strict";

const {D1SyncRepository} = require("../sync/d1-repository.js");

const OPERATION_CLASS = Object.freeze({
  listVehicles: "catalog",
  vehicleFilters: "catalog",
  vehicleByIdentifier: "detail",
  searchVehicles: "detail",
  vehicleHistory: "history"
});
const LIMIT_ENV = Object.freeze({
  catalog: "REXBID_PROVIDER_BUDGET_CATALOG_DAILY_LIMIT",
  detail: "REXBID_PROVIDER_BUDGET_DETAIL_DAILY_LIMIT",
  history: "REXBID_PROVIDER_BUDGET_HISTORY_DAILY_LIMIT",
  discovery: "REXBID_PROVIDER_BUDGET_DISCOVERY_DAILY_LIMIT",
  media_enrichment: "REXBID_PROVIDER_BUDGET_MEDIA_DAILY_LIMIT"
});
const HARD_MAX_PER_DAY = 100_000;

class ProviderBudgetError extends Error {
  constructor(code) {
    super(code === "RATE_LIMITED" ? "Dzienny limit zapytań do dostawcy został osiągnięty." : "Budżet zapytań do dostawcy jest niedostępny.");
    this.name = "ProviderBudgetError";
    this.code = code;
    this.status = code === "RATE_LIMITED" ? 429 : 503;
  }
}

function safeClass(spec) {
  const requested = spec?.budgetClass;
  if (requested !== undefined) return Object.hasOwn(LIMIT_ENV, requested) ? requested : null;
  return OPERATION_CLASS[spec?.operation] || null;
}

function positiveLimit(env, name) {
  const raw = env?.[name];
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  if (!/^\d+$/.test(String(raw))) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= HARD_MAX_PER_DAY ? value : null;
}

function createProviderRequestBudget({now = () => Date.now(), uuid = () => crypto.randomUUID()} = {}) {
  return {
    async begin(env, spec) {
      if (env?.REXBID_PROVIDER_BUDGET_MODE !== "required") return {enforced: false, finish: async () => {}};
      const operationClass = safeClass(spec);
      const globalLimit = positiveLimit(env, "REXBID_PROVIDER_BUDGET_DAILY_LIMIT");
      const operationLimit = operationClass ? positiveLimit(env, LIMIT_ENV[operationClass]) : null;
      const db = env?.REXBID_DB;
      if (!operationLimit || !globalLimit || operationLimit > globalLimit || !db || typeof db.prepare !== "function") {
        throw new ProviderBudgetError("CONFIGURATION");
      }
      const budgetDay = new Date(now()).toISOString().slice(0, 10);
      const globalProvider = "apibara:all";
      const operationProvider = `apibara:${operationClass}`;
      const reservationId = uuid();
      const repo = new D1SyncRepository(db);
      try {
        await repo.initializeBudgetPair({globalProvider, operationProvider, budgetDay, globalLimit, operationLimit, now: now()});
        const reservation = await repo.reserveBudgetPair({reservationId, globalProvider, operationProvider, budgetDay, now: now()});
        if (!reservation.allowed) {
          throw new ProviderBudgetError("RATE_LIMITED");
        }
        if (!await repo.startBudgetPair({reservationId, globalProvider, operationProvider, budgetDay, now: now()})) {
          await repo.cancelBudgetPair({reservationId, globalProvider, operationProvider, budgetDay, now: now()});
          throw new ProviderBudgetError("RATE_LIMITED");
        }
      } catch (error) {
        if (error instanceof ProviderBudgetError) throw error;
        throw new ProviderBudgetError("CONFIGURATION");
      }
      return {
        enforced: true,
        operationClass,
        reservationId,
        async finish() {
          try { await repo.finishBudgetPair({reservationId, now: now()}); }
          catch { /* the request was already durably counted at start; never turn a provider result into success telemetry */ }
        }
      };
    }
  };
}

module.exports = {OPERATION_CLASS, LIMIT_ENV, HARD_MAX_PER_DAY, ProviderBudgetError, safeClass, positiveLimit, createProviderRequestBudget};
