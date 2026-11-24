-- PROPOSAL ONLY — not in Wrangler's configured migrations directory.
-- Do not apply until provider retention/data-rights review, collision review,
-- and the final sync orchestration design have been approved.
--
-- Additive only: no existing rows are updated/deleted, no PK is changed,
-- and no provider payload, history body, or image URL is copied into new tables.

ALTER TABLE vehicle_snapshots ADD COLUMN source_key TEXT;
ALTER TABLE auction_history ADD COLUMN provider TEXT;
ALTER TABLE auction_history ADD COLUMN source_key TEXT;

CREATE TABLE IF NOT EXISTS vehicle_sources (
  source_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  platform TEXT NOT NULL,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('provider_id', 'lot', 'vin')),
  provider_vehicle_id TEXT,
  source_listing_id TEXT,
  vehicle_key TEXT NOT NULL REFERENCES vehicles(vehicle_key),
  vin TEXT,
  lot TEXT,
  provider_updated_at TEXT,
  last_attempt_at TEXT,
  last_synced_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle', 'running', 'partial', 'failed', 'blocked')),
  next_retry_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  lease_token TEXT,
  lease_expires_at TEXT,
  normalizer_version INTEGER,
  source_fingerprint TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (provider_vehicle_id IS NOT NULL OR lot IS NOT NULL OR vin IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  run_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES vehicle_sources(source_key),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'scheduled', 'queue', 'backfill')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed', 'blocked')),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  pages_completed INTEGER NOT NULL DEFAULT 0 CHECK (pages_completed >= 0),
  records_received INTEGER NOT NULL DEFAULT 0 CHECK (records_received >= 0),
  next_cursor TEXT,
  error_code TEXT
);

-- Deliberately non-unique: first audit possible duplicate source/event rows.
CREATE INDEX IF NOT EXISTS idx_vehicle_sources_vehicle
  ON vehicle_sources(vehicle_key, provider, platform);
CREATE INDEX IF NOT EXISTS idx_vehicle_sources_due
  ON vehicle_sources(sync_status, next_retry_at, last_synced_at);
CREATE INDEX IF NOT EXISTS idx_sync_runs_source_started
  ON sync_runs(source_key, started_at);
CREATE INDEX IF NOT EXISTS idx_history_provider_event
  ON auction_history(provider, vehicle_key, event_key);
CREATE INDEX IF NOT EXISTS idx_snapshots_source_captured
  ON vehicle_snapshots(source_key, captured_at);
