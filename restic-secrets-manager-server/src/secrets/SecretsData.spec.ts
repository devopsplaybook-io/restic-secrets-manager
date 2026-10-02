import Database from "better-sqlite3";
import { Secret } from "../model/Secret";
import { SecretsDataReplaceForProject } from "./SecretsData";

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
    'INSERT INTO secrets ("id", "projectId", "name", "data", "dateCreated", "dateUpdated") VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    secret.id,
    secret.projectId,
    secret.name,
    JSON.stringify(secret.data),
    secret.dateCreated,
    secret.dateUpdated,
  );
}

function names(db: Database.Database): string[] {
  return db
    .prepare('SELECT "name" FROM secrets ORDER BY "name"')
    .all()
    .map((row: any) => row.name);
}

describe("SecretsDataReplaceForProject (sqlite)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE secrets (
        id VARCHAR(50) PRIMARY KEY,
        projectId VARCHAR(50) NOT NULL,
        name VARCHAR(200) NOT NULL,
        data TEXT,
        dateCreated VARCHAR(100) NOT NULL,
        dateUpdated VARCHAR(100) NOT NULL
      );
      CREATE UNIQUE INDEX idx_secrets_project_name ON secrets (projectId, name);
    `);
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
