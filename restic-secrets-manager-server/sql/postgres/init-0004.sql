-- Rebuild the users table for common-utils >= 1.8 compatibility:
-- UsersDataAdd inserts (id, name, passwordEncrypted, role, scopes) and no
-- longer provides dateCreated, so the column needs a default. The table is
-- empty at this point (user creation failed on the previous schema).
DROP TABLE IF EXISTS users;
CREATE TABLE users (
    "id" UUID PRIMARY KEY,
    "name" VARCHAR(100) NOT NULL,
    "passwordEncrypted" VARCHAR(500) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'user',
    "scopes" TEXT,
    "dateCreated" VARCHAR(100) NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
