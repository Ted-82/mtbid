-- Additive index for bulk identity checks; no rows, identities or permissions change.
CREATE INDEX IF NOT EXISTS idx_listings_source_identity ON auction_listings(source_key,platform,lot);
-- Rollback (only after the bulk operation has stopped):
-- DROP INDEX IF EXISTS idx_listings_source_identity;
