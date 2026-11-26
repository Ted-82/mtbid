'use strict';
const schemas = new WeakMap();
// Older catalogue copies remain writable. Retry an unavailable or unmigrated
// schema after a minute without interrupting bids, prices or publication.
async function supportsExteriorColor(db) {
  const cached = schemas.get(db);
  if (cached && Date.now() < cached.retryAt) return cached.value;
  const entry = {retryAt: Infinity};
  entry.value = Promise.resolve().then(async () => {
    try {
      const {results} = await db.prepare("PRAGMA table_info(auction_listings)").bind().all();
      if (results.some(column => column.name === "exterior_color")) return true;
    } catch {
      console.warn("CATALOG_OPTIONAL_SCHEMA_READ_UNAVAILABLE");
    }
    entry.retryAt = Date.now() + 60000;
    return false;
  });
  schemas.set(db, entry);
  return entry.value;
}
module.exports = {supportsExteriorColor};
