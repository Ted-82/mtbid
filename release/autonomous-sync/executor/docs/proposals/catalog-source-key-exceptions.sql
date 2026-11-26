CREATE INDEX idx_listings_source_key_exceptions ON auction_listings(source_key)
WHERE vin_normalized IS NOT substr(source_key, -17);
