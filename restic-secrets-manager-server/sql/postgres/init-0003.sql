CREATE TABLE IF NOT EXISTS secrets (
    "id" UUID PRIMARY KEY,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "data" TEXT,
    "dateCreated" VARCHAR(100) NOT NULL,
    "dateUpdated" VARCHAR(100) NOT NULL
);
