-- Additive candidate migration for the saved public catalog, 2026-10-20.
-- Apply explicitly only after verifying the intended database and its backup.
-- This file is outside automatic Wrangler migration directories.
-- No observation, price, status, source identity or receipt is changed.
--
-- Keep the recent and selective Timed/Buy Now indexes together: a recent-only
-- index can make SQLite scan every listing to find a sparse category.
CREATE INDEX IF NOT EXISTS idx_listings_public_recent
  ON auction_listings(last_seen_at DESC, listing_id ASC);
CREATE INDEX IF NOT EXISTS idx_listings_public_platform_recent
  ON auction_listings(platform, last_seen_at DESC, listing_id ASC);
CREATE INDEX IF NOT EXISTS idx_listings_public_timed_recent
  ON auction_listings(last_seen_at DESC, listing_id ASC)
  WHERE is_timed = 1;
CREATE INDEX IF NOT EXISTS idx_listings_public_platform_timed_recent
  ON auction_listings(platform, last_seen_at DESC, listing_id ASC)
  WHERE is_timed = 1;
CREATE INDEX IF NOT EXISTS idx_listings_public_buy_now_recent
  ON auction_listings(last_seen_at DESC, listing_id ASC)
  WHERE buy_now_usd > 0;

-- Match the existing normalized predicates exactly. Expression indexes retain
-- original labels and NULL values; they do not rewrite catalog data.
CREATE INDEX IF NOT EXISTS idx_listings_public_make_recent
  ON auction_listings(upper(trim(make)), last_seen_at DESC, listing_id ASC);

-- Every saved public request reads discovery coverage. History receipts share
-- this table, so select discovery before ordering its few rows.
CREATE INDEX IF NOT EXISTS idx_scopes_public_coverage
  ON provider_sync_scopes(operation, platform, provider);
