-- PROPOSAL ONLY — NOT DEPLOYED; NOT in Wrangler migrations directory.
-- D1 Sync 2 additive empty schema proposal.
-- Conceptually supersedes docs/proposals/0002_provider_sync_foundation.sql.
-- Do NOT apply both proposals. Do NOT run against rexbid-db/production.
--
-- This creates new empty structures only: no ALTER/DML/backfill, no legacy PK
-- changes and no raw payload/media columns. Schema creation does not grant
-- rights to populate it with Apibara/Provider B data. Provider data ingestion,
-- derived data, history, snapshots, and public redisplay remain gated on
-- written provider permission and approved retention policy.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vehicle_entities (
  entity_id TEXT PRIMARY KEY,
  vin_normalized TEXT,
  identity_state TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (identity_state IN ('unresolved', 'candidate', 'confirmed', 'conflict')),
  match_basis TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Source identity is distinct from a physical vehicle and auction listing.
-- provider_vehicle_id is deliberately not unique until its stability contract
-- is verified with that provider.
CREATE TABLE IF NOT EXISTS vehicle_sources (
  source_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider_vehicle_id TEXT,
  identity_kind TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (identity_kind IN ('provider_vehicle_id', 'source_id', 'unresolved')),
  identity_state TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (identity_state IN ('resolved', 'ambiguous', 'pending_review', 'unresolved')),
  entity_id TEXT REFERENCES vehicle_entities(entity_id),
  source_updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  normalizer_version INTEGER,
  source_fingerprint TEXT,
  sync_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle', 'running', 'partial', 'failed', 'blocked')),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  next_retry_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per auction listing lifecycle. LOT and VIN are searchable attributes,
-- not primary identity. source_listing_id uniqueness is intentionally deferred.
CREATE TABLE IF NOT EXISTS auction_listings (
  listing_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES vehicle_sources(source_key),
  platform TEXT NOT NULL,
  listing_identity_kind TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (listing_identity_kind IN ('provider_listing_id', 'source_listing_id', 'lot_generation', 'unresolved')),
  identity_state TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (identity_state IN ('resolved', 'ambiguous', 'pending_review', 'unresolved')),
  source_listing_id TEXT,
  listing_generation INTEGER,
  vin_normalized TEXT,
  lot TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  body_style TEXT,
  fuel_type TEXT,
  transmission TEXT,
  drive_type TEXT,
  engine_size_l REAL,
  odometer_value REAL,
  auction_state TEXT,
  source_status TEXT,
  auction_at TEXT,
  is_timed INTEGER CHECK (is_timed IN (0, 1) OR is_timed IS NULL),
  timed_end_at TEXT,
  current_bid_usd REAL,
  current_bid2_usd REAL,
  buy_now_usd REAL,
  final_price_usd REAL,
  source_price_usd REAL,
  seller_name TEXT,
  seller_type TEXT,
  primary_damage TEXT,
  secondary_damage TEXT,
  run_state TEXT,
  keys_present INTEGER CHECK (keys_present IN (0, 1) OR keys_present IS NULL),
  airbags TEXT,
  document_name TEXT,
  document_type TEXT,
  registration_allowed INTEGER CHECK (registration_allowed IN (0, 1) OR registration_allowed IS NULL),
  export_allowed INTEGER CHECK (export_allowed IN (0, 1) OR export_allowed IS NULL),
  location_display TEXT,
  location_state TEXT,
  location_postal_code TEXT,
  has_video INTEGER CHECK (has_video IN (0, 1) OR has_video IS NULL),
  has_360 INTEGER CHECK (has_360 IN (0, 1) OR has_360 IS NULL),
  source_updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  summary_synced_at TEXT,
  detail_synced_at TEXT,
  freshness_class TEXT NOT NULL DEFAULT 'unknown'
    CHECK (freshness_class IN ('hot', 'warm', 'cold', 'unknown')),
  next_refresh_at TEXT,
  fingerprint TEXT,
  normalizer_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Events remain separate from listing snapshots. Do not infer final price from
-- source_price_usd or copy the current listing seller into a historical event.
CREATE TABLE IF NOT EXISTS auction_events (
  event_id TEXT PRIMARY KEY,
  listing_id TEXT REFERENCES auction_listings(listing_id),
  source_key TEXT NOT NULL REFERENCES vehicle_sources(source_key),
  provider TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider_event_id TEXT,
  event_key TEXT,
  vin_normalized TEXT,
  lot TEXT,
  auction_date TEXT,
  sale_date TEXT,
  source_status TEXT,
  canonical_status TEXT,
  current_bid_usd REAL,
  buy_now_usd REAL,
  source_price_usd REAL,
  final_price_usd REAL,
  seller_name TEXT,
  seller_type TEXT,
  observed_at TEXT NOT NULL,
  fingerprint TEXT,
  normalizer_version INTEGER,
  identity_state TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (identity_state IN ('resolved', 'ambiguous', 'pending_review', 'unresolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Optional and separately retention-gated. Leave unused/disabled until written
-- permission covers snapshot storage and its retention period.
CREATE TABLE IF NOT EXISTS auction_listing_snapshots (
  snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES auction_listings(listing_id),
  observed_at TEXT NOT NULL,
  auction_state TEXT,
  auction_at TEXT,
  timed_end_at TEXT,
  current_bid_usd REAL,
  buy_now_usd REAL,
  fingerprint TEXT NOT NULL,
  normalizer_version INTEGER
);

-- Feed-level discovery state is separate from per-listing refresh state.
CREATE TABLE IF NOT EXISTS provider_sync_scopes (
  scope_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  platform TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('discovery', 'detail_refresh', 'history_refresh', 'filter_metadata')),
  scope_fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'partial', 'failed', 'blocked')),
  cursor TEXT,
  cursor_version INTEGER NOT NULL DEFAULT 1,
  cursor_updated_at TEXT,
  cursor_expires_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_complete_at TEXT,
  next_due_at TEXT,
  retry_after_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error_code TEXT,
  updated_at TEXT NOT NULL
);

-- Aggregate operational telemetry only. No VIN, LOT, email, credentials, URL,
-- request/response body, provider cursor, or raw provider error text.
CREATE TABLE IF NOT EXISTS sync_runs (
  run_id TEXT PRIMARY KEY,
  scope_key TEXT REFERENCES provider_sync_scopes(scope_key),
  provider TEXT NOT NULL,
  platform TEXT,
  operation TEXT NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'cron', 'queue', 'operator')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed', 'blocked', 'interrupted')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  pages_completed INTEGER NOT NULL DEFAULT 0 CHECK (pages_completed >= 0),
  records_received INTEGER NOT NULL DEFAULT 0 CHECK (records_received >= 0),
  records_inserted INTEGER NOT NULL DEFAULT 0 CHECK (records_inserted >= 0),
  records_updated INTEGER NOT NULL DEFAULT 0 CHECK (records_updated >= 0),
  records_skipped INTEGER NOT NULL DEFAULT 0 CHECK (records_skipped >= 0),
  upstream_requests INTEGER NOT NULL DEFAULT 0 CHECK (upstream_requests >= 0),
  upstream_429 INTEGER NOT NULL DEFAULT 0 CHECK (upstream_429 >= 0),
  latency_ms INTEGER,
  error_code TEXT
);

-- Begin with non-unique indexes. Add uniqueness only after real source-ID
-- stability and collision behavior have been contractually/empirically checked.
CREATE INDEX IF NOT EXISTS idx_vsync_provider_vehicle
  ON vehicle_sources(provider, platform, provider_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vsync_entity
  ON vehicle_sources(entity_id, provider, platform);
CREATE INDEX IF NOT EXISTS idx_vsync_due
  ON vehicle_sources(sync_status, next_retry_at, last_success_at);
CREATE INDEX IF NOT EXISTS idx_listings_vin_recent
  ON auction_listings(vin_normalized, platform, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_lot_recent
  ON auction_listings(platform, lot, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_catalog
  ON auction_listings(platform, auction_state, auction_at, listing_id);
CREATE INDEX IF NOT EXISTS idx_listings_timed
  ON auction_listings(platform, timed_end_at, listing_id)
  WHERE is_timed = 1;
CREATE INDEX IF NOT EXISTS idx_listings_buy_now
  ON auction_listings(platform, buy_now_usd, listing_id)
  WHERE buy_now_usd > 0;
CREATE INDEX IF NOT EXISTS idx_listings_refresh_due
  ON auction_listings(next_refresh_at, freshness_class, listing_id);
CREATE INDEX IF NOT EXISTS idx_events_listing_date
  ON auction_events(listing_id, auction_date DESC, event_id);
CREATE INDEX IF NOT EXISTS idx_events_provider_id
  ON auction_events(provider, platform, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_recent
  ON auction_listing_snapshots(listing_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_scopes_due
  ON provider_sync_scopes(status, next_due_at, retry_after_at);
CREATE INDEX IF NOT EXISTS idx_sync_scopes_lease
  ON provider_sync_scopes(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_sync_runs_recent
  ON sync_runs(provider, operation, started_at DESC);
