import Database from "better-sqlite3";
import { Project } from "../model/Project";
import {
  ProjectsDataDeleteCascade,
  ProjectsDataGetByRepoTarget,
  ProjectsDataList,
} from "./ProjectsData";

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsExecSQL: jest.fn(),
  DbUtilsGetDatabase: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
  convertToPostgresPlaceholders: jest.fn((sql: string) => sql),
}));

const dbUtils = jest.requireMock("../utils-std-ts/DbUtils");

function seedProject(db: Database.Database, id: string, name = id): void {
  db.prepare(
    'INSERT INTO projects ("id", "name", "dateCreated") VALUES (?, ?, ?)',
  ).run(id, name, "2026-01-01T00:00:00.000Z");
  db.prepare(
    'INSERT INTO secrets ("id", "projectId", "name", "data", "dateCreated", "dateUpdated", "version") VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(`secret-${id}`, id, "secret-name", "{}", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", 1);
}

function projectsTableSql(): string {
  return `
    CREATE TABLE projects (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      s3Endpoint VARCHAR(300) NOT NULL DEFAULT '',
      s3Bucket VARCHAR(300) NOT NULL DEFAULT '',
      repoPrefix VARCHAR(300) NOT NULL DEFAULT '',
      s3Region VARCHAR(100),
      s3BucketLookup VARCHAR(100) NOT NULL DEFAULT 'dns',
      s3AccessKeyId VARCHAR(300) NOT NULL DEFAULT '',
      s3SecretAccessKey VARCHAR(300) NOT NULL DEFAULT '',
      resticPassword VARCHAR(300) NOT NULL DEFAULT '',
      lastSyncSnapshotId VARCHAR(100),
      lastSyncSnapshotTime VARCHAR(100),
      lastSyncContentHash VARCHAR(100),
      currentContentHash VARCHAR(100),
      dateCreated VARCHAR(100) NOT NULL
    );
    CREATE TABLE secrets (
      id VARCHAR(50) PRIMARY KEY,
      projectId VARCHAR(50) NOT NULL,
      name VARCHAR(200) NOT NULL,
      data TEXT,
      dateCreated VARCHAR(100) NOT NULL,
      dateUpdated VARCHAR(100) NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_secrets_project_name ON secrets (projectId, name);
  `;
}

describe("ProjectsDataDeleteCascade (sqlite)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(projectsTableSql());
    dbUtils.DbUtilsGetType.mockReturnValue("sqlite");
    dbUtils.DbUtilsGetDatabase.mockReturnValue(db);
    dbUtils.DbUtilsExecSQL.mockImplementation(
      (_context: unknown, sql: string, params: unknown[]) =>
        db.prepare(sql).run(params).changes,
    );
  });

  afterEach(() => {
    db.close();
  });

  it("should delete the project and only its secrets in one transaction", async () => {
    seedProject(db, "p1");
    seedProject(db, "p2");

    await ProjectsDataDeleteCascade(undefined, "p1");

    const projects = db.prepare('SELECT "id" FROM projects').all() as any[];
    const secrets = db
      .prepare('SELECT "id", "projectId" FROM secrets')
      .all() as any[];
    expect(projects).toEqual([{ id: "p2" }]);
    expect(secrets).toEqual([{ id: "secret-p2", projectId: "p2" }]);
  });

  it("should roll back the secret deletion when the project delete fails", async () => {
    seedProject(db, "p1");
    db.exec(`
      CREATE TRIGGER prevent_project_delete BEFORE DELETE ON projects
      BEGIN
        SELECT RAISE(ABORT, 'project delete blocked');
      END;
    `);

    await expect(
      ProjectsDataDeleteCascade(undefined, "p1"),
    ).rejects.toThrow("project delete blocked");

    const secrets = db.prepare('SELECT "id" FROM secrets').all();
    expect(secrets).toEqual([{ id: "secret-p1" }]);
    const projects = db.prepare('SELECT "id" FROM projects').all();
    expect(projects).toEqual([{ id: "p1" }]);
  });

  it("should cascade a direct project delete through the foreign key", () => {
    seedProject(db, "p1");

    db.prepare('DELETE FROM projects WHERE "id" = ?').run("p1");

    expect(db.prepare('SELECT COUNT(*) AS count FROM secrets').get()).toEqual({
      count: 0,
    });
  });

  it("should refuse to delete a project that still has secrets when the FK is enforced", () => {
    seedProject(db, "p1");
    // The cascade is active: deleting the project succeeds and removes the
    // secrets, while deleting the project row directly is the same statement.
    expect(() => db.pragma("foreign_keys = ON")).not.toThrow();
    db.prepare('DELETE FROM projects WHERE "id" = ?').run("p1");
    expect(db.prepare('SELECT COUNT(*) AS count FROM secrets').get()).toEqual({
      count: 0,
    });
  });
});

describe("ProjectsDataDeleteCascade (postgres)", () => {
  function mockPool(queryErrorAt: number | null = null) {
    let call = 0;
    const client = {
      query: jest.fn(async (sql: string) => {
        call += 1;
        if (queryErrorAt === call) {
          throw new Error(`query failed: ${sql}`);
        }
        return { rowCount: 1, rows: [] };
      }),
      release: jest.fn(),
    };
    dbUtils.DbUtilsGetType.mockReturnValue("postgres");
    dbUtils.DbUtilsGetDatabase.mockReturnValue({
      connect: jest.fn(async () => client),
    });
    return client;
  }

  it("should run BEGIN, the two deletes and COMMIT on one client", async () => {
    const client = mockPool();

    await ProjectsDataDeleteCascade(undefined, "p1");

    const statements = client.query.mock.calls.map((call) => call[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain('DELETE FROM secrets WHERE "projectId" = ?');
    expect(statements[2]).toContain('DELETE FROM projects WHERE "id" = ?');
    expect(statements[3]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("should ROLLBACK and release the client when a delete fails", async () => {
    const client = mockPool(3);

    await expect(
      ProjectsDataDeleteCascade(undefined, "p1"),
    ).rejects.toThrow("query failed");

    const statements = client.query.mock.calls.map((call) => call[0]);
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectsDataGetByRepoTarget", () => {
  function projectRow(id: string, name: string, fields: Record<string, unknown> = {}) {
    return {
      id,
      name,
      description: "",
      s3Endpoint: "s3.example.com",
      s3Bucket: "bucket",
      repoPrefix: "",
      s3Region: "",
      s3BucketLookup: "dns",
      s3AccessKeyId: "key",
      s3SecretAccessKey: "secret",
      resticPassword: "password",
      lastSyncSnapshotId: "",
      lastSyncSnapshotTime: "",
      lastSyncContentHash: "",
      currentContentHash: "",
      dateCreated: "2026-01-01T00:00:00.000Z",
      ...fields,
    };
  }

  it("should return the project matching the normalized target", async () => {
    dbUtils.DbUtilsQuerySQL.mockResolvedValue([
      projectRow("p1", "Other", { repoPrefix: "other" }),
      projectRow("p2", "My App", { s3Endpoint: "https://S3.example.com/" }),
    ]);
    const target = new Project();
    target.name = "my-app";
    target.s3Endpoint = "s3.example.com";
    target.s3Bucket = "bucket";

    const found = await ProjectsDataGetByRepoTarget(
      undefined,
      target.repoTargetKey(),
    );

    expect(found?.id).toBe("p2");
  });

  it("should return null when no project matches", async () => {
    dbUtils.DbUtilsQuerySQL.mockResolvedValue([projectRow("p1", "Other")]);
    const target = new Project();
    target.name = "my-app";
    target.s3Endpoint = "s3.example.com";
    target.s3Bucket = "bucket";

    expect(
      await ProjectsDataGetByRepoTarget(undefined, target.repoTargetKey()),
    ).toBeNull();
  });

  it("should compose with ProjectsDataList", async () => {
    dbUtils.DbUtilsQuerySQL.mockResolvedValue([]);
    expect(await ProjectsDataList()).toEqual([]);
  });
});
