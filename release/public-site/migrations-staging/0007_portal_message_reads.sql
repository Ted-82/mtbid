-- Staging: additive read receipts; apply after accounts 0003 and portal 0006.
-- No message, order, account, MFA or file records are rewritten.
CREATE TABLE IF NOT EXISTS import_order_message_reads (
  message_id TEXT NOT NULL REFERENCES import_order_messages(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('client','team')),
  read_at TEXT NOT NULL,
  PRIMARY KEY (message_id, audience)
);
CREATE INDEX IF NOT EXISTS idx_import_order_messages_recipient ON import_order_messages(order_id, author_role, id);
