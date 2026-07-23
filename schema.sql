PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY NOT NULL,
  target TEXT NOT NULL COLLATE NOCASE,
  user_email TEXT NOT NULL COLLATE NOCASE,
  plan TEXT NOT NULL,
  duration TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(id) BETWEEN 8 AND 64),
  CHECK (length(target) BETWEEN 3 AND 253),
  CHECK (
    length(user_email) BETWEEN 3 AND 254
    AND user_email = trim(user_email)
    AND instr(user_email, '@') > 1
  ),
  CHECK (length(plan) BETWEEN 2 AND 64),
  CHECK (length(duration) BETWEEN 2 AND 64)
) WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_target
  ON licenses(target COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_licenses_user_email
  ON licenses(user_email COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_licenses_expiry
  ON licenses(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_active
  ON licenses(revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS authorization_codes (
  id TEXT PRIMARY KEY NOT NULL,
  code_hash TEXT NOT NULL,
  code_prefix TEXT NOT NULL,
  plan TEXT NOT NULL,
  duration TEXT NOT NULL,
  duration_days INTEGER,
  expires_at TEXT,
  redeemed_at TEXT,
  redeemed_target TEXT COLLATE NOCASE,
  redeemed_email TEXT COLLATE NOCASE,
  redeemed_license_id TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(id) BETWEEN 8 AND 64),
  CHECK (length(code_hash) = 64),
  CHECK (length(plan) BETWEEN 2 AND 64),
  CHECK (length(duration) BETWEEN 2 AND 64),
  CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 36500),
  FOREIGN KEY (redeemed_license_id) REFERENCES licenses(id)
) WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_authorization_codes_hash
  ON authorization_codes(code_hash);

CREATE INDEX IF NOT EXISTS idx_authorization_codes_created
  ON authorization_codes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_authorization_codes_available
  ON authorization_codes(redeemed_at, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS license_binding_audit (
  id TEXT PRIMARY KEY NOT NULL,
  license_id TEXT NOT NULL,
  code_id TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL COLLATE NOCASE,
  user_email TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(id) BETWEEN 8 AND 64),
  CHECK (action IN ('redeemed', 'unbound')),
  CHECK (length(target) BETWEEN 3 AND 253),
  CHECK (length(user_email) BETWEEN 3 AND 254)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_license_binding_audit_license
  ON license_binding_audit(license_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_license_binding_audit_email
  ON license_binding_audit(user_email COLLATE NOCASE, created_at DESC);
