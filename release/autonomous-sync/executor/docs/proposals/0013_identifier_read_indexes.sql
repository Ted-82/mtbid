-- Additive saved-detail/history lookup candidate, 31 October 2026.
-- Apply explicitly to the verified target after backup and measured cost review.
-- These expressions exactly match getListingByIdentifier's existing OR, so
-- mixed-case matches, source identifiers and LIMIT 2 ambiguity stay unchanged.
-- Non-unique: no identity assumptions, row rewrites or uniqueness enforcement.
CREATE INDEX IF NOT EXISTS idx_listings_public_vin_upper
  ON auction_listings(upper(vin_normalized));
CREATE INDEX IF NOT EXISTS idx_listings_public_lot_upper
  ON auction_listings(upper(lot));
CREATE INDEX IF NOT EXISTS idx_listings_public_source_listing_upper
  ON auction_listings(upper(source_listing_id));

-- Cost: three index entries per existing listing (including SQLite NULL keys),
-- plus storage. Future VIN/LOT/source-ID inserts/changes maintain these indexes;
-- price/status-only changes do not add indexed columns to this candidate.
-- This is separate from any feed budget exception and activates no paid service.
-- Selective rollback, only if these exact new indexes were added by this stage:
-- DROP INDEX IF EXISTS idx_listings_public_vin_upper;
-- DROP INDEX IF EXISTS idx_listings_public_lot_upper;
-- DROP INDEX IF EXISTS idx_listings_public_source_listing_upper;
