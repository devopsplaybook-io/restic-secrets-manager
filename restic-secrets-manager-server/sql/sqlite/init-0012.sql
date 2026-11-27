-- Cross-device login with a code (common-utils LOGIN_CODES_DDL_SQLITE):
-- single-use requests approved by an interactive user; codes and request
-- tokens are stored only as hashes. No FK on approvedByUserId: a deleted
-- approver must neither cascade nor block, and redemption fails closed.
CREATE TABLE IF NOT EXISTS "users_login_codes" (
  "id" TEXT PRIMARY KEY,
  "requestTokenHash" TEXT NOT NULL UNIQUE,
  "codeHash" TEXT NOT NULL,
  "previousCodeHash" TEXT,
  "codeExpiresAt" TEXT NOT NULL,
  "previousCodeExpiresAt" TEXT,
  "status" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "approvedAt" TEXT,
  "approvedByUserId" TEXT,
  "consumedAt" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "requestUserAgent" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_login_codes_code_hash" ON "users_login_codes" ("codeHash");
CREATE INDEX IF NOT EXISTS "users_login_codes_status_expires" ON "users_login_codes" ("status", "expiresAt");
