-- One secret per name per project. De-duplicate defensively first:
-- keep the most recently updated row per (projectId, name).
DELETE FROM secrets WHERE "id" NOT IN (
    SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (
            PARTITION BY "projectId", "name" ORDER BY "dateUpdated" DESC, "id"
        ) AS rn
        FROM secrets
    ) AS dedup WHERE rn = 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_project_name ON secrets ("projectId", "name");
