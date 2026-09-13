CREATE TABLE IF NOT EXISTS users (
    "id" UUID PRIMARY KEY,
    "name" VARCHAR(100) NOT NULL,
    "passwordEncrypted" VARCHAR(500) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'user',
    "scopes" TEXT,
    "dateCreated" VARCHAR(100) NOT NULL
);
