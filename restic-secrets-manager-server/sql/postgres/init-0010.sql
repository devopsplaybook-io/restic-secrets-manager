-- Optimistic concurrency for secret updates: every secret carries a version
-- that is echoed by reads and required by updates (stale version -> 409).
ALTER TABLE secrets ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
