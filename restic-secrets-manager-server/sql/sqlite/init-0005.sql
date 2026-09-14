-- Track the content hash of the secrets at the last synchronization, to
-- detect local modifications that have not been pushed yet.
ALTER TABLE projects ADD COLUMN lastSyncContentHash VARCHAR(100);
