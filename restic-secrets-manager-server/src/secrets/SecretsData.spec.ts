import Database from "better-sqlite3";
import { Secret } from "../model/Secret";
import {
  SecretsDataReplaceForProject,
  SecretsDataUpdate,
} from "./SecretsData";

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsExecSQL: jest.fn(),
  DbUtilsGetDatabase: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
  convertToPostgresPlaceholders: jest.fn((sql: string) => sql),
}));

const dbUtils = jest.requireMock("../utils-std-ts/DbUtils");

function makeSecret(name: string, data: Record<string, string> = {}): Secret {
  const secret = new Secret();
  secret.projectId = "p1";
  secret.name = name;
  secret.data = data;
  return secret;
}

function seed(db: Database.Database, secret: Secret): void {
  db.prepare(
    'INSERT INTO secrets ("id", "projectId", "name", "data", "dateCreated", "dateUpdated", "version") VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    secret.id,
    secret.projectId,
    secret.name,
    JSON.stringify(secret.data),
    secret.dateCreated,
    secret.dateUpdated,
    secret.version,
  );
}

function names(db: Database.Database): string[] {
  return db
    .prepare('SELECT "name" FROM secrets ORDER BY "name"')
    .all()
    .map((row: any) => row.name);
}

function createSecretsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE secrets (
      id VARCHAR(50) PRIMARY KEY,
      projectId VARCHAR(50) NOT NULL,
      name VARCHAR(200) NOT NULL,
      data TEXT,
      dateCreated VARCHAR(100) NOT NULL,
      dateUpdated VARCHAR(100) NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_secrets_project_name ON secrets (projectId, name);
  `);
}

describe("SecretsDataReplaceForProject (sqlite)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSecretsTable(db);
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

  it("should replace all the project secrets in one transaction", async () => {
    seed(db, makeSecret("a"));
    seed(db, makeSecret("b"));

    await SecretsDataReplaceForProject(undefined, "p1", [
      makeSecret("c", { K: "v" }),
    ]);

    expect(names(db)).toEqual(["c"]);
  });

  it("should persist a version of 1 for replaced secrets", async () => {
    await SecretsDataReplaceForProject(undefined, "p1", [
      makeSecret("c", { K: "v" }),
    ]);

    const row = db.prepare('SELECT "version" FROM secrets').get() as any;
    expect(row.version).toBe(1);
  });

  it("should roll back the delete when an insert fails mid-replace", async () => {
    seed(db, makeSecret("a"));
    seed(db, makeSecret("b"));

    // The second insert violates the (projectId, name) unique index
    await expect(
      SecretsDataReplaceForProject(undefined, "p1", [
        makeSecret("x"),
        makeSecret("x"),
      ]),
    ).rejects.toThrow();

    // The previous secret set must be intact
    expect(names(db)).toEqual(["a", "b"]);
  });

  it("should only replace the secrets of the given project", async () => {
    const other = makeSecret("a");
    other.projectId = "p2";
    seed(db, other);
    seed(db, makeSecret("b"));

    await SecretsDataReplaceForProject(undefined, "p1", [makeSecret("c")]);

    const rows = db
      .prepare('SELECT "projectId", "name" FROM secrets ORDER BY "name"')
      .all();
    expect(rows).toEqual([
      { projectId: "p2", name: "a" },
      { projectId: "p1", name: "c" },
    ]);
  });
});

describe("SecretsDataUpdate (sqlite)", () => {
  let db: Database.Database;

  beforeEach(() => {
    jest.clearAllMocks();
    db = new Database(":memory:");
    createSecretsTable(db);
    dbUtils.DbUtilsGetType.mockReturnValue("sqlite");
    dbUtils.DbUtilsGetDatabase.mockReturnValue(db);
    dbUtils.DbUtilsExecSQL.mockImplementation(
      (_context: unknown, sql: string, params: unknown[]) =>
        db.prepare(sql).run(params).changes,
    );
    dbUtils.DbUtilsQuerySQL.mockImplementation(
      (_context: unknown, sql: string, params: unknown[]) =>
        db.prepare(sql).all(params),
    );
  });

  afterEach(() => {
    db.close();
  });

  it("should update name and data in one statement and bump the version", async () => {
    const existing = makeSecret("old", { A: "1" });
    seed(db, existing);
    db.prepare('UPDATE secrets SET "dateUpdated" = ? WHERE "id" = ?').run(
      "2020-01-01T00:00:00.000Z",
      existing.id,
    );
    const before = "2020-01-01T00:00:00.000Z";

    const updated = makeSecret("new", { A: "2", B: "3" });
    updated.id = existing.id;
    const status = await SecretsDataUpdate(undefined, updated, 1);

    expect(status).toBe("updated");
    expect(updated.version).toBe(2);
    const row = db
      .prepare('SELECT "name", "data", "version", "dateUpdated" FROM secrets WHERE "id" = ?')
      .get(existing.id) as any;
    expect(row.name).toBe("new");
    expect(JSON.parse(row.data)).toEqual({ A: "2", B: "3" });
    expect(row.version).toBe(2);
    expect(row.dateUpdated).toBe(updated.dateUpdated);
    expect(updated.dateUpdated).not.toBe(before);
  });

  it("should reject a stale version without changing the row", async () => {
    const existing = makeSecret("old", { A: "1" });
    seed(db, existing);

    const stale = makeSecret("hijacked", { A: "999" });
    stale.id = existing.id;
    const status = await SecretsDataUpdate(undefined, stale, 2);

    expect(status).toBe("version_conflict");
    expect(stale.version).toBe(1); // untouched in memory
    const row = db
      .prepare('SELECT "name", "data", "version" FROM secrets WHERE "id" = ?')
      .get(existing.id) as any;
    expect(row.name).toBe("old");
    expect(JSON.parse(row.data)).toEqual({ A: "1" });
    expect(row.version).toBe(1);
  });

  it("should report not_found for an unknown secret", async () => {
    const status = await SecretsDataUpdate(undefined, makeSecret("x"), 1);
    expect(status).toBe("not_found");
  });

  it("should report not_found when the secret belongs to another project", async () => {
    const existing = makeSecret("old");
    seed(db, existing);
    const other = makeSecret("other");
    other.id = existing.id;
    other.projectId = "p2";

    const status = await SecretsDataUpdate(undefined, other, 1);

    expect(status).toBe("not_found");
    const row = db
      .prepare('SELECT "projectId" FROM secrets WHERE "id" = ?')
      .get(existing.id) as any;
    expect(row.projectId).toBe("p1");
  });

  it("should let a unique-name violation bubble to the route", async () => {
    seed(db, makeSecret("taken"));
    const existing = makeSecret("old");
    seed(db, existing);

    const renamed = makeSecret("taken");
    renamed.id = existing.id;

    await expect(SecretsDataUpdate(undefined, renamed, 1)).rejects.toThrow();
    const row = db
      .prepare('SELECT "name" FROM secrets WHERE "id" = ?')
      .get(existing.id) as any;
    expect(row.name).toBe("old");
  });

  it("should await promise-returning exec/query helpers (Postgres)", async () => {
    dbUtils.DbUtilsGetType.mockReturnValue("postgres");
    dbUtils.DbUtilsExecSQL.mockResolvedValue(1);
    dbUtils.DbUtilsQuerySQL.mockResolvedValue([]);

    const secret = makeSecret("updated", { A: "1" });
    const status = await SecretsDataUpdate(undefined, secret, 2);

    expect(status).toBe("updated");
    expect(secret.version).toBe(3);
    expect(dbUtils.DbUtilsExecSQL).toHaveBeenCalledTimes(1);
  });

  it("should re-read the row after zero affected rows (Postgres)", async () => {
    dbUtils.DbUtilsGetType.mockReturnValue("postgres");
    dbUtils.DbUtilsExecSQL.mockResolvedValue(0);
    dbUtils.DbUtilsQuerySQL.mockResolvedValue([
      {
        id: "s1",
        projectId: "p1",
        name: "current",
        data: "{}",
        dateCreated: "2026-01-01T00:00:00.000Z",
        dateUpdated: "2026-01-02T00:00:00.000Z",
        version: 4,
      },
    ]);

    const secret = makeSecret("renamed");
    secret.id = "s1";
    const status = await SecretsDataUpdate(undefined, secret, 2);

    expect(status).toBe("version_conflict");
    expect(dbUtils.DbUtilsExecSQL).toHaveBeenCalledTimes(1);
    expect(dbUtils.DbUtilsQuerySQL).toHaveBeenCalledTimes(1);
  });
});
