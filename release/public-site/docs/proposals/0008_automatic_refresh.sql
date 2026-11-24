-- Additive scheduler state. Apply only after backup to the explicitly selected
-- isolated publication/staging D1. Does not modify accounts, portal or history.
CREATE TABLE IF NOT EXISTS automatic_refresh_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  lease_owner TEXT, lease_until TEXT,
  blocked_reason TEXT, pause_until TEXT,
  last_started_at TEXT, last_finished_at TEXT, last_success_at TEXT,
  quota_checked_at TEXT, quota_limit INTEGER, quota_used INTEGER,
  quota_left INTEGER, quota_allowance INTEGER,
  quota_plan TEXT, last_report_json TEXT
);
INSERT OR IGNORE INTO automatic_refresh_state(singleton) VALUES(1);
CREATE TABLE IF NOT EXISTS automatic_refresh_budgets (
  budget_key TEXT PRIMARY KEY,
  limit_count INTEGER NOT NULL CHECK(limit_count>=0),
  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automatic_refresh_attempts (
  attempt_id TEXT PRIMARY KEY,
  operation TEXT NOT NULL, platform TEXT, listing_id TEXT,
  attempted_at TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'attempted' CHECK(outcome IN ('attempted','response','error')),
  http_status INTEGER, error_code TEXT, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS automatic_refresh_attempts_time ON automatic_refresh_attempts(attempted_at);
CREATE TABLE IF NOT EXISTS automatic_refresh_tasks (
  task_key TEXT PRIMARY KEY, platform TEXT NOT NULL,
  listing_id TEXT REFERENCES auction_listings(listing_id),
  cursor TEXT, scan_started_at TEXT, scan_pages INTEGER NOT NULL DEFAULT 0,
  scan_errors INTEGER NOT NULL DEFAULT 0,
  next_due_at TEXT NOT NULL,
  last_attempt_at TEXT, last_success_at TEXT,
  status TEXT NOT NULL DEFAULT 'due',
  failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT
);
CREATE INDEX IF NOT EXISTS automatic_refresh_tasks_due ON automatic_refresh_tasks(next_due_at,platform);
-- Fences every atomic catalogue/checkpoint batch against an expired lease.
CREATE TABLE IF NOT EXISTS automatic_refresh_guards (
  guard_id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1)
);
