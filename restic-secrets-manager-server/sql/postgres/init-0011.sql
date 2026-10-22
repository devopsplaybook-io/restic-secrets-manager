-- Secrets belong to a project: clean up legacy orphan rows and add a
-- cascading foreign key (guarded so the migration is idempotent).
DELETE FROM secrets s WHERE NOT EXISTS (
    SELECT 1 FROM projects p WHERE p."id" = s."projectId"
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'fk_secrets_project'
          AND t.relname = 'secrets'
          AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE secrets ADD CONSTRAINT fk_secrets_project
            FOREIGN KEY ("projectId") REFERENCES projects ("id") ON DELETE CASCADE;
    END IF;
END $$;
