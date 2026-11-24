-- Private attachment removal outbox: never auction archive media.
CREATE TABLE IF NOT EXISTS import_order_file_deletions (
 file_id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL REFERENCES import_orders(id) ON DELETE RESTRICT,
 object_key TEXT,
 requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 requested_at TEXT NOT NULL,
 purged_at TEXT
);
CREATE INDEX IF NOT EXISTS import_order_file_deletions_pending ON import_order_file_deletions(requested_at,file_id) WHERE purged_at IS NULL;
