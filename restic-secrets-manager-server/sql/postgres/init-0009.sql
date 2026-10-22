-- Token version used by the opt-in JWT revocation (JWT_REVOCATION_ENABLED):
-- role, scope and password changes bump it, invalidating issued sessions.
ALTER TABLE users ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
