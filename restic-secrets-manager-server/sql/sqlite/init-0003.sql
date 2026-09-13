CREATE TABLE IF NOT EXISTS secrets (
    id VARCHAR(50) PRIMARY KEY,
    projectId VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    data TEXT,
    dateCreated VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100) NOT NULL
);
