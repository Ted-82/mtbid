-- Additive only: existing users, messages, outbox and auctions are unchanged.
CREATE TABLE IF NOT EXISTS owner_registration_signals (
 id TEXT PRIMARY KEY,
 email_hash TEXT NOT NULL UNIQUE,
 email_ciphertext TEXT NOT NULL,
 requested_at TEXT,
 confirmed_at TEXT,
 account_created_at TEXT,
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 owner_seen_at TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_registration_created ON owner_registration_signals(created_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_owner_registration_user ON owner_registration_signals(user_id);
CREATE TABLE IF NOT EXISTS account_notice_outbox (
 id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind='account_notice'),
 message_id TEXT REFERENCES owner_registration_signals(id) ON DELETE SET NULL, request_hash TEXT, rate_key TEXT,
 payload_ciphertext TEXT,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','needs_review')),
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, next_attempt_at TEXT NOT NULL,
 lease_token TEXT, lease_until TEXT, ambiguous_since TEXT,
 provider_id TEXT, submitted_at TEXT, last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_mail_ready ON account_notice_outbox(status,next_attempt_at,created_at);
