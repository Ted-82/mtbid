-- Additive server-side file transport state only. Existing catalogue/client
-- tables are unchanged. Apply after backup to an explicitly selected database.
CREATE TABLE IF NOT EXISTS server_feed_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 committed_sequence INTEGER NOT NULL CHECK(committed_sequence>=0),
 seed_evidence_json TEXT NOT NULL,
 active_generation INTEGER,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS server_feed_generations (
 generation_id INTEGER PRIMARY KEY CHECK(generation_id>0),
 sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256)=64),
 raw_key TEXT NOT NULL,
 compressed_bytes INTEGER NOT NULL CHECK(compressed_bytes>=0),
 archive_bytes INTEGER CHECK(archive_bytes>=0),
 retired_at TEXT,
 observed_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('downloaded','prepared','applying','complete','blocked')),
 manifest_key TEXT, manifest_sha256 TEXT,
 first_sequence INTEGER, last_sequence INTEGER,
 bucket_groups_json TEXT,
 bucket_index INTEGER NOT NULL DEFAULT 0 CHECK(bucket_index BETWEEN 0 AND 128),
 group_offset INTEGER NOT NULL DEFAULT 0 CHECK(group_offset>=0),
 last_error_code TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS server_feed_generations_pending ON server_feed_generations(status,first_sequence,created_at);
CREATE TABLE IF NOT EXISTS server_feed_receipts (
 receipt_key TEXT PRIMARY KEY,
 generation_id INTEGER NOT NULL REFERENCES server_feed_generations(generation_id),
 receipt_sha256 TEXT NOT NULL CHECK(length(receipt_sha256)=64),
 payload_json TEXT NOT NULL,
 committed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS server_feed_outbox (
 job_key TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatched','complete','blocked')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_due_at TEXT NOT NULL,
 last_error_code TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS server_feed_outbox_due ON server_feed_outbox(status,next_due_at,job_key);
CREATE TABLE IF NOT EXISTS server_feed_daily_budgets (
 day_key TEXT PRIMARY KEY,
 write_limit INTEGER NOT NULL CHECK(write_limit BETWEEN 1 AND 1000000),
 read_limit INTEGER NOT NULL CHECK(read_limit BETWEEN 1 AND 50000000),
 reserved_writes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_writes>=0),
 reserved_reads INTEGER NOT NULL DEFAULT 0 CHECK(reserved_reads>=0),
 consumed_writes INTEGER NOT NULL DEFAULT 0 CHECK(consumed_writes>=0),
 consumed_reads INTEGER NOT NULL DEFAULT 0 CHECK(consumed_reads>=0),
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS server_feed_reservations (
 reservation_key TEXT PRIMARY KEY,
 day_key TEXT NOT NULL REFERENCES server_feed_daily_budgets(day_key),
 reserved_writes INTEGER NOT NULL CHECK(reserved_writes>=0),
 reserved_reads INTEGER NOT NULL CHECK(reserved_reads>=0),
 status TEXT NOT NULL CHECK(status IN ('reserved','settled')),
 actual_writes INTEGER, actual_reads INTEGER,
 created_at TEXT NOT NULL, settled_at TEXT
);
CREATE TABLE IF NOT EXISTS server_feed_guards (
 guard_id TEXT PRIMARY KEY,
 allowed INTEGER NOT NULL CHECK(allowed=1)
);
