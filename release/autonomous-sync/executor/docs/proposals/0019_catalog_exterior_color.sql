-- Apply once to the catalogue D1 database only, before releasing the new writer.
-- Existing rows remain NULL. No history, photos or records are rewritten.
ALTER TABLE auction_listings ADD COLUMN exterior_color TEXT;
