const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

test('staging media URL migration is additive and preserves existing listing rows', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE auction_listings (listing_id TEXT PRIMARY KEY, lot TEXT, vehicle_title TEXT);
      INSERT INTO auction_listings VALUES ('legacy-listing','OLD-LOT','Legacy Vehicle');`);
    const before = db.prepare('SELECT * FROM auction_listings').get();
    const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations-staging', '0005_listing_media_urls.sql'), 'utf8');
    db.exec(migration);
    const after = db.prepare('SELECT * FROM auction_listings').get();
    assert.equal(after.listing_id,before.listing_id);assert.equal(after.lot,before.lot);assert.equal(after.vehicle_title,before.vehicle_title);
    assert.equal(after.media_urls_json,null);assert.equal(after.media_thumbs_json,null);
    assert.deepEqual(db.prepare('PRAGMA table_info(auction_listings)').all().filter(row => row.name.startsWith('media_')).map(row => row.name),
      ['media_urls_json', 'media_thumbs_json']);
  } finally { db.close(); }
});
