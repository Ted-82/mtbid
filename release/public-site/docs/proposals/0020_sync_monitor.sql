CREATE TABLE IF NOT EXISTS sync_monitor_samples(
 slot INTEGER PRIMARY KEY, measured_at TEXT NOT NULL, pending INTEGER NOT NULL,
 status TEXT NOT NULL, data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_notification_outbox(
 id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
 message_id TEXT, request_hash TEXT, rate_key TEXT,payload_ciphertext TEXT,
 status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,next_attempt_at TEXT NOT NULL,lease_token TEXT,lease_until TEXT,
 ambiguous_since TEXT,provider_id TEXT,submitted_at TEXT,last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_notification_ready ON sync_notification_outbox(status,next_attempt_at,created_at);
CREATE TABLE IF NOT EXISTS sync_notification_daily_budget(day TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0);
