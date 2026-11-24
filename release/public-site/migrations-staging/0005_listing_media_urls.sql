-- Staging-only additive references to provider-supplied media URLs.
-- Stores URL strings only; never downloads or archives image bytes.
-- Do not copy this migration to production without separate approval.
ALTER TABLE auction_listings ADD COLUMN media_urls_json TEXT;
ALTER TABLE auction_listings ADD COLUMN media_thumbs_json TEXT;
