-- Additive auction-history event fields.
-- Existing rows and raw_json are preserved. Legacy `price` remains source data
-- and is intentionally not copied to final_price.
--
-- Do not add a UNIQUE index until existing data has been checked for computed
-- event_key collisions. This migration creates only a non-unique lookup index.

ALTER TABLE auction_history ADD COLUMN event_key TEXT;
ALTER TABLE auction_history ADD COLUMN source_event_id TEXT;
ALTER TABLE auction_history ADD COLUMN vin TEXT;
ALTER TABLE auction_history ADD COLUMN lot TEXT;
ALTER TABLE auction_history ADD COLUMN sale_date TEXT;
ALTER TABLE auction_history ADD COLUMN current_bid REAL;
ALTER TABLE auction_history ADD COLUMN final_price REAL;
ALTER TABLE auction_history ADD COLUMN buy_now REAL;
ALTER TABLE auction_history ADD COLUMN seller TEXT;

CREATE INDEX IF NOT EXISTS idx_history_event_lookup
ON auction_history(vehicle_key, event_key);
