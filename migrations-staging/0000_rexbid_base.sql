-- Initial additive schema for the dedicated, confirmed-empty rexbid-db.
-- Existing databases/tables are never dropped or rewritten by this migration.

CREATE TABLE IF NOT EXISTS vehicles (
  vehicle_key TEXT PRIMARY KEY,
  vin TEXT,
  slug_vin TEXT,
  platform TEXT,
  lot TEXT,
  title TEXT,
  year INTEGER,
  make TEXT,
  model TEXT,
  auction_state TEXT,
  auction_at TEXT,
  auction_end TEXT,
  current_bid REAL,
  buy_now REAL,
  last_sold_price REAL,
  location_display TEXT,
  damage TEXT,
  secondary_damage TEXT,
  loss_type TEXT,
  run_condition TEXT,
  has_key INTEGER,
  mileage REAL,
  seller_name TEXT,
  seller_type TEXT,
  document_name TEXT,
  document_type TEXT,
  export_allowed INTEGER,
  registration_allowed INTEGER,
  has_video INTEGER,
  has_360 INTEGER,
  auction_url TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  fingerprint TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS vehicle_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_key TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  auction_state TEXT,
  auction_at TEXT,
  auction_end TEXT,
  current_bid REAL,
  buy_now REAL,
  last_sold_price REAL,
  fingerprint TEXT NOT NULL,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS auction_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_key TEXT NOT NULL,
  platform TEXT,
  auction_date TEXT,
  price REAL,
  status TEXT,
  event_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);
CREATE INDEX IF NOT EXISTS idx_vehicles_lot ON vehicles(lot);
CREATE INDEX IF NOT EXISTS idx_vehicles_platform ON vehicles(platform);
CREATE INDEX IF NOT EXISTS idx_snapshots_vehicle ON vehicle_snapshots(vehicle_key);
CREATE INDEX IF NOT EXISTS idx_history_vehicle ON auction_history(vehicle_key);
CREATE INDEX IF NOT EXISTS idx_history_date ON auction_history(auction_date);
