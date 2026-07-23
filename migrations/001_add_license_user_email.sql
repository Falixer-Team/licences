-- Add traceable owner emails without inventing values for historical licenses.
-- Existing rows remain NULL until their real owner email is backfilled.
ALTER TABLE licenses ADD COLUMN user_email TEXT;

-- Keep redemption audit data even if its resulting license is later removed.
ALTER TABLE authorization_codes ADD COLUMN redeemed_email TEXT;

-- Every new license must include a normalized, non-empty email address.
CREATE TRIGGER IF NOT EXISTS licenses_require_email_insert
BEFORE INSERT ON licenses
FOR EACH ROW
WHEN NEW.user_email IS NULL
  OR NEW.user_email != trim(NEW.user_email)
  OR length(NEW.user_email) < 3
  OR length(NEW.user_email) > 254
  OR instr(NEW.user_email, '@') <= 1
BEGIN
  SELECT RAISE(ABORT, 'user_email is required');
END;

-- Email may be corrected, but cannot be removed from a license once set.
CREATE TRIGGER IF NOT EXISTS licenses_require_email_update
BEFORE UPDATE OF user_email ON licenses
FOR EACH ROW
WHEN NEW.user_email IS NULL
  OR NEW.user_email != trim(NEW.user_email)
  OR length(NEW.user_email) < 3
  OR length(NEW.user_email) > 254
  OR instr(NEW.user_email, '@') <= 1
BEGIN
  SELECT RAISE(ABORT, 'user_email is required');
END;

CREATE INDEX IF NOT EXISTS idx_licenses_user_email
  ON licenses(user_email COLLATE NOCASE)
  WHERE user_email IS NOT NULL;

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

-- Review this count after migration. Backfill only verified real addresses.
SELECT COUNT(*) AS licenses_missing_user_email
FROM licenses
WHERE user_email IS NULL OR trim(user_email) = '';
