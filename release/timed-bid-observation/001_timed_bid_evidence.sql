-- Single nullable column. No rewrite of existing offers and no new index.
ALTER TABLE auction_listings ADD COLUMN timed_bid_evidence TEXT;
