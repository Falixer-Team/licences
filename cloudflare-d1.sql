CREATE TABLE IF NOT EXISTS licenses (
  id TEXT NOT NULL PRIMARY KEY,
  target TEXT NOT NULL COLLATE NOCASE,
  user_email TEXT NOT NULL COLLATE NOCASE,
  plan TEXT NOT NULL,
  duration TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(id) BETWEEN 8 AND 64),
  CHECK (length(target) BETWEEN 3 AND 253),
  CHECK (length(user_email) BETWEEN 3 AND 254),
  CHECK (instr(user_email, '@') > 1),
  CHECK (length(plan) BETWEEN 2 AND 64),
  CHECK (length(duration) BETWEEN 2 AND 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_target
  ON licenses(target COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_licenses_user_email
  ON licenses(user_email COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_licenses_expiry
  ON licenses(expires_at);

CREATE INDEX IF NOT EXISTS idx_licenses_active
  ON licenses(revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_licenses_created
  ON licenses(created_at);

CREATE TABLE IF NOT EXISTS authorization_codes (
  id TEXT NOT NULL PRIMARY KEY,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(id) BETWEEN 8 AND 64),
  CHECK (length(code_hash) = 64),
  CHECK (length(code_prefix) BETWEEN 4 AND 16),
  CHECK (length(plan) BETWEEN 2 AND 64),
  CHECK (length(duration) BETWEEN 2 AND 64),
  CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 36500)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_authorization_codes_hash
  ON authorization_codes(code_hash);

CREATE INDEX IF NOT EXISTS idx_authorization_codes_created
  ON authorization_codes(created_at);

CREATE INDEX IF NOT EXISTS idx_authorization_codes_available
  ON authorization_codes(redeemed_at, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_authorization_codes_license
  ON authorization_codes(redeemed_license_id);

CREATE INDEX IF NOT EXISTS idx_authorization_codes_email
  ON authorization_codes(redeemed_email COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS license_binding_audit (
  id TEXT NOT NULL PRIMARY KEY,
  license_id TEXT NOT NULL,
  code_id TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL COLLATE NOCASE,
  user_email TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(id) BETWEEN 8 AND 64),
  CHECK (length(license_id) BETWEEN 8 AND 64),
  CHECK (action IN ('redeemed', 'unbound')),
  CHECK (length(target) BETWEEN 3 AND 253),
  CHECK (length(user_email) BETWEEN 3 AND 254)
);

CREATE INDEX IF NOT EXISTS idx_license_binding_audit_license
  ON license_binding_audit(license_id, created_at);

CREATE INDEX IF NOT EXISTS idx_license_binding_audit_code
  ON license_binding_audit(code_id, created_at);

CREATE INDEX IF NOT EXISTS idx_license_binding_audit_target
  ON license_binding_audit(target COLLATE NOCASE, created_at);

CREATE INDEX IF NOT EXISTS idx_license_binding_audit_email
  ON license_binding_audit(user_email COLLATE NOCASE, created_at);
