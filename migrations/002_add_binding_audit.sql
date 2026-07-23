-- Safe to run after 001, including when 001 was executed before audit support existed.
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
