-- Additive, bounded detail eligibility for completed server feed generations.
-- Proposal only; requires 0011 and an explicitly selected backed-up database.
CREATE TABLE IF NOT EXISTS server_feed_reconcile_eligibility (
 platform TEXT NOT NULL CHECK(platform IN ('copart','iaai')),
 lot TEXT NOT NULL,
 generation_id INTEGER NOT NULL REFERENCES server_feed_generations(generation_id),
 last_sequence INTEGER NOT NULL CHECK(last_sequence>0),
 recorded_at TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 expected_vin TEXT,
 terminal INTEGER NOT NULL CHECK(terminal IN (0,1)),
 identity_error INTEGER NOT NULL CHECK(identity_error IN (0,1)),
 group_sha256 TEXT NOT NULL CHECK(length(group_sha256)=64),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(platform,lot)
);
CREATE INDEX IF NOT EXISTS server_feed_reconcile_recent ON server_feed_reconcile_eligibility(identity_error,terminal,recorded_at);
