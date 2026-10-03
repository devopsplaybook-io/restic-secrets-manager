-- Stored hash of the current project secrets content, maintained on every
-- secret edit and synchronization: lets the project list avoid loading the
-- secret bodies to detect local changes.
ALTER TABLE projects ADD COLUMN "currentContentHash" VARCHAR(100);
