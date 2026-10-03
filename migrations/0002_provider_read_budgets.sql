-- Minimal additive budget storage for bounded public provider reads.
-- Deliberately excludes Sync 2 scopes/listings/leases; production Sync remains disabled.
-- These table definitions match the budget tables later included in proposal 0004,
-- so the future full migration can safely use CREATE TABLE IF NOT EXISTS.

-- Required by the existing D1SyncRepository budget pair's atomic batch guard.
-- This table alone does not enable sync scopes, listings, or discovery writes.
CREATE TABLE IF NOT EXISTS sync_batch_guards (
  guard_id TEXT PRIMARY KEY,
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

CREATE TABLE IF NOT EXISTS provider_request_budgets (
  provider TEXT NOT NULL,
  budget_day TEXT NOT NULL,
  normal_limit INTEGER NOT NULL CHECK (normal_limit >= 0),
  retry_limit INTEGER NOT NULL CHECK (retry_limit >= 0),
  normal_consumed INTEGER NOT NULL DEFAULT 0 CHECK (normal_consumed >= 0),
  retry_consumed INTEGER NOT NULL DEFAULT 0 CHECK (retry_consumed >= 0),
  normal_reserved INTEGER NOT NULL DEFAULT 0 CHECK (normal_reserved >= 0),
  retry_reserved INTEGER NOT NULL DEFAULT 0 CHECK (retry_reserved >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, budget_day)
);

CREATE TABLE IF NOT EXISTS provider_request_reservations (
  reservation_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  budget_day TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('normal', 'retry')),
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'started', 'finished', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider, budget_day) REFERENCES provider_request_budgets(provider, budget_day)
);
