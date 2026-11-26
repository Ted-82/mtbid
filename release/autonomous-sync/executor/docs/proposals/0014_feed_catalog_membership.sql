-- Additive catalogue membership. Canonical listings/history/user references remain intact.
-- Review locally; applying this file remotely is a separate authorized operation.
CREATE TABLE IF NOT EXISTS feed_catalog_baselines (
  baseline_id TEXT PRIMARY KEY,
  plan_sha256 TEXT NOT NULL CHECK(length(plan_sha256)=64),
  plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
  checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feed_catalog_membership (
  baseline_id TEXT NOT NULL REFERENCES feed_catalog_baselines(baseline_id),
  listing_id TEXT NOT NULL REFERENCES auction_listings(listing_id),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  last_sequence INTEGER NOT NULL CHECK(last_sequence>=0),
  PRIMARY KEY(baseline_id,listing_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS feed_catalog_pointer (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  baseline_id TEXT REFERENCES feed_catalog_baselines(baseline_id),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_at TEXT NOT NULL
);
INSERT INTO feed_catalog_pointer(singleton,baseline_id,revision,updated_at)
  VALUES(1,NULL,0,'1970-01-01T00:00:00.000Z') ON CONFLICT(singleton) DO NOTHING;
