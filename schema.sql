PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY NOT NULL,
  target TEXT NOT NULL COLLATE NOCASE,
  plan TEXT NOT NULL,
  duration TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(id) BETWEEN 8 AND 64),
  CHECK (length(target) BETWEEN 3 AND 253),
  CHECK (length(plan) BETWEEN 2 AND 64),
  CHECK (length(duration) BETWEEN 2 AND 64)
) WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_target
  ON licenses(target COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_licenses_expiry
  ON licenses(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_active
  ON licenses(revoked_at, expires_at);
