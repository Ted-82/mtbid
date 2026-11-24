-- Additive proposal; outside automatic production migrations.
-- Applied ONLY to rexbid-auth-test-db on 2026-10-06 after backup/local restore.
-- Production not migrated; authenticated portal remains disabled pending configuration.
-- Apply only after the accounts 0003 schema, D1 backup, privacy/retention policy,
-- owner MFA and private storage/encryption configuration have been reviewed.
-- Credentials remain with the auth provider; no passwords or tokens are stored.
CREATE TABLE IF NOT EXISTS import_orders (
  id TEXT PRIMARY KEY NOT NULL,
  client_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  vin TEXT,
  lot TEXT,
  platform TEXT CHECK (platform IS NULL OR platform IN ('copart','iaai')),
  status TEXT NOT NULL DEFAULT 'preparation' CHECK (status IN ('preparation','auction_won','payment_confirmed','pickup_planned','at_us_terminal','loaded','at_sea','at_eu_port','customs','delivery','delivered')),
  location TEXT,
  estimated_arrival_at TEXT,
  vessel TEXT,
  container_number TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_change_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (vin IS NOT NULL OR (lot IS NOT NULL AND platform IS NOT NULL)),
  CHECK ((lot IS NULL AND platform IS NULL) OR (lot IS NOT NULL AND platform IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_import_orders_client_updated ON import_orders(client_user_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_import_orders_updated ON import_orders(updated_at DESC, id);

CREATE TABLE IF NOT EXISTS import_order_events (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES import_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','update','note')),
  visibility TEXT NOT NULL CHECK (visibility IN ('client','internal')),
  status TEXT,
  location TEXT,
  estimated_arrival_at TEXT,
  content_ciphertext TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_order_events_timeline ON import_order_events(order_id, visibility, created_at, id);

CREATE TABLE IF NOT EXISTS import_order_messages (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES import_orders(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_role TEXT NOT NULL CHECK (author_role IN ('owner','client')),
  content_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_order_messages_timeline ON import_order_messages(order_id, created_at, id);

CREATE TABLE IF NOT EXISTS import_order_files (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES import_orders(id) ON DELETE CASCADE,
  object_key TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'client' CHECK (visibility IN ('client','internal')),
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_order_files_order ON import_order_files(order_id, created_at, id);

-- Optional customer-supplied contact details; account identity remains separate.
CREATE TABLE IF NOT EXISTS portal_customer_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
