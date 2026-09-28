-- PROPOSAL ONLY. Do not apply to production until auth provider, cookie domain,
-- privacy/retention rules and the target D1 binding have been approved.
-- Additive application tables only. Supabase owns credentials/passwords/tokens;
-- this schema stores no passwords, email address, auth token or vehicle payload.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  auth_issuer TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  auth_provider TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (auth_issuer, auth_subject)
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  favorite_key TEXT NOT NULL,
  vin TEXT,
  lot TEXT,
  platform TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, favorite_key),
  CHECK (vin IS NOT NULL OR (lot IS NOT NULL AND platform IS NOT NULL)),
  CHECK (vin IS NULL OR length(trim(vin)) > 0),
  CHECK (lot IS NULL OR length(trim(lot)) > 0),
  CHECK (platform IS NULL OR length(trim(platform)) > 0),
  CHECK (
    (vin IS NOT NULL AND favorite_key = 'vin:' || upper(trim(vin))) OR
    (vin IS NULL AND lot IS NOT NULL AND platform IS NOT NULL AND
      favorite_key = 'lot:' || lower(trim(platform)) || ':' || upper(trim(lot)))
  )
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user_created
  ON user_favorites(user_id, created_at DESC);
