-- Additive only. Existing messages, users, auctions and galleries are untouched.
CREATE TABLE IF NOT EXISTS transactional_mail_outbox (
 id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('inquiry','portal_message')),
 message_id TEXT REFERENCES import_order_messages(id) ON DELETE SET NULL,
 request_hash TEXT, rate_key TEXT,
 payload_ciphertext TEXT,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','needs_review')),
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, next_attempt_at TEXT NOT NULL,
 lease_token TEXT, lease_until TEXT, ambiguous_since TEXT,
 provider_id TEXT, submitted_at TEXT, last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_mail_ready ON transactional_mail_outbox(status,next_attempt_at,created_at);
CREATE INDEX IF NOT EXISTS idx_mail_contact_rate ON transactional_mail_outbox(kind,rate_key,created_at);
CREATE INDEX IF NOT EXISTS idx_mail_contact_day ON transactional_mail_outbox(kind,created_at);
CREATE INDEX IF NOT EXISTS idx_mail_submitted ON transactional_mail_outbox(status,submitted_at);
CREATE TABLE IF NOT EXISTS transactional_mail_daily_budget (
 day TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS portal_notification_recipients (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 email_ciphertext TEXT NOT NULL, email_hash TEXT NOT NULL, verified_at TEXT NOT NULL
);
