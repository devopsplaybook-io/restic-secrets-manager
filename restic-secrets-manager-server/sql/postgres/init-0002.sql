CREATE TABLE IF NOT EXISTS projects (
    "id" UUID PRIMARY KEY,
    "name" VARCHAR(100) NOT NULL UNIQUE,
    "description" TEXT,
    "s3Endpoint" VARCHAR(300) NOT NULL,
    "s3Bucket" VARCHAR(300) NOT NULL,
    "repoPrefix" VARCHAR(300) NOT NULL,
    "s3Region" VARCHAR(100),
    "s3BucketLookup" VARCHAR(100) NOT NULL DEFAULT 'dns',
    "s3AccessKeyId" VARCHAR(300) NOT NULL,
    "s3SecretAccessKey" VARCHAR(300) NOT NULL,
    "resticPassword" VARCHAR(300) NOT NULL,
    "lastSyncSnapshotId" VARCHAR(100),
    "lastSyncSnapshotTime" VARCHAR(100),
    "dateCreated" VARCHAR(100) NOT NULL
);
