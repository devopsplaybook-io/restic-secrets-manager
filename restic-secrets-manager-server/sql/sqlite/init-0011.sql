-- Secrets belong to a project: clean up legacy orphan rows and rebuild the
-- table with a cascading foreign key (SQLite cannot add a constraint in
-- place). The rebuild preserves every column, including the version added
-- in init-0010, and recreates the unique (projectId, name) index.
DELETE FROM secrets WHERE "projectId" NOT IN (SELECT "id" FROM projects);

DROP TABLE IF EXISTS secrets_new;
CREATE TABLE secrets_new (
    id VARCHAR(50) PRIMARY KEY,
    projectId VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    data TEXT,
    dateCreated VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
INSERT INTO secrets_new ("id", "projectId", "name", "data", "dateCreated", "dateUpdated", "version")
    SELECT "id", "projectId", "name", "data", "dateCreated", "dateUpdated", "version" FROM secrets;
DROP TABLE secrets;
ALTER TABLE secrets_new RENAME TO secrets;
CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_project_name ON secrets (projectId, name);
