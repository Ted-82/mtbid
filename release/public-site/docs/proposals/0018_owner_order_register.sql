CREATE TABLE IF NOT EXISTS import_order_register (
 order_id TEXT PRIMARY KEY NOT NULL REFERENCES import_orders(id) ON DELETE CASCADE,
 number INTEGER NOT NULL UNIQUE CHECK(number>0),
 vehicle_label TEXT,
 purchased_on TEXT,
 delivered_on TEXT,
 is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN(0,1)),
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS import_order_register_real_dates ON import_order_register(is_test,purchased_on,delivered_on,number);
CREATE TABLE IF NOT EXISTS portal_client_search_state (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 profile_updated TEXT NOT NULL,
 email_hash TEXT NOT NULL,
 key_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_client_search_tokens (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token TEXT NOT NULL,
 PRIMARY KEY(token,user_id)
);
CREATE INDEX IF NOT EXISTS portal_client_search_user ON portal_client_search_tokens(user_id);
