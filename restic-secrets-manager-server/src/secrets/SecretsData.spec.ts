import Database from "better-sqlite3";
import { Secret } from "../model/Secret";
import {
  SecretsDataAdd,
  SecretsDataDelete,
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

function createProjectsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      id VARCHAR(50) PRIMARY KEY,
      lastSyncSnapshotId VARCHAR(100),
      lastSyncSnapshotTime VARCHAR(100),
      lastSyncContentHash VARCHAR(100),
      currentContentHash VARCHAR(100)
    );
  `);
}

function seedProject(
  db: Database.Database,
  id = "p1",
  state: {
    snapshotId?: string;
    snapshotTime?: string;
    lastSyncContentHash?: string;
    currentContentHash?: string;
  } = {},
): void {
  db.prepare(
    'INSERT INTO projects ("id", "lastSyncSnapshotId", "lastSyncSnapshotTime", "lastSyncContentHash", "currentContentHash") VALUES (?, ?, ?, ?, ?)',
  ).run(
    id,
    state.snapshotId ?? "",
    state.snapshotTime ?? "",
    state.lastSyncContentHash ?? "",
    state.currentContentHash ?? "",
  );
}

function projectState(db: Database.Database, id = "p1"): any {
  return db.prepare('SELECT * FROM projects WHERE "id" = ?').get(id);
}

function setupSqlite(db: Database.Database): void {
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
}

describe("SecretsDataReplaceForProject (sqlite)", () => {
  let db: Database.Database;

  beforeEach(() => {
    jest.clearAllMocks();
    db = new Database(":memory:");
    createSecretsTable(db);
    createProjectsTable(db);
    setupSqlite(db);
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

  it("should write the snapshot state and both hashes with the secrets", async () => {
    seedProject(db);

    await SecretsDataReplaceForProject(undefined, "p1", [makeSecret("c")], {
      snapshotId: "snap-1",
      snapshotTime: "2026-11-03T10:00:00Z",
      contentHash: "hash-new",
    });

    expect(projectState(db)).toEqual({
      id: "p1",
      lastSyncSnapshotId: "snap-1",
      lastSyncSnapshotTime: "2026-11-03T10:00:00Z",
      lastSyncContentHash: "hash-new",
      currentContentHash: "hash-new",
    });
  });

  it("should roll back the sync state when an insert fails", async () => {
    seedProject(db, "p1", {
      snapshotId: "snap-old",
      snapshotTime: "2026-01-01T00:00:00Z",
      lastSyncContentHash: "hash-old",
      currentContentHash: "hash-old",
    });

    await expect(
      SecretsDataReplaceForProject(undefined, "p1", [
        makeSecret("x"),
        makeSecret("x"),
      ], {
        snapshotId: "snap-new",
        snapshotTime: "2026-11-03T10:00:00Z",
        contentHash: "hash-new",
      }),
    ).rejects.toThrow();

    expect(projectState(db)).toMatchObject({
      lastSyncSnapshotId: "snap-old",
      lastSyncContentHash: "hash-old",
      currentContentHash: "hash-old",
    });
  });
});

describe("SecretsDataAdd (sqlite)", () => {
  let db: Database.Database;

  beforeEach(() => {
    jest.clearAllMocks();
    db = new Database(":memory:");
    createSecretsTable(db);
    createProjectsTable(db);
    setupSqlite(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should insert the secret and update the project hash in one transaction", async () => {
    seedProject(db);

    await SecretsDataAdd(undefined, makeSecret("a", { K: "v" }), "hash-1");

    expect(names(db)).toEqual(["a"]);
    expect(projectState(db).currentContentHash).toBe("hash-1");
  });

  it("should roll back the hash when the insert violates the unique name", async () => {
    seedProject(db, "p1", { currentContentHash: "hash-old" });
    seed(db, makeSecret("a"));

    await expect(
      SecretsDataAdd(undefined, makeSecret("a"), "hash-new"),
    ).rejects.toThrow();

    expect(projectState(db).currentContentHash).toBe("hash-old");
  });

  it("should leave the project untouched when no hash is provided", async () => {
    seedProject(db, "p1", { currentContentHash: "hash-old" });

    await SecretsDataAdd(undefined, makeSecret("a"));

    expect(projectState(db).currentContentHash).toBe("hash-old");
  });
});

describe("SecretsDataUpdate (sqlite)", () => {
  let db: Database.Database;

  beforeEach(() => {
    jest.clearAllMocks();
    db = new Database(":memory:");
    createSecretsTable(db);
    createProjectsTable(db);
    setupSqlite(db);
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

  it("should update the project hash with the successful update", async () => {
    seedProject(db, "p1", { currentContentHash: "hash-old" });
    const existing = makeSecret("old", { A: "1" });
    seed(db, existing);

    const updated = makeSecret("old", { A: "2" });
    updated.id = existing.id;
    const status = await SecretsDataUpdate(undefined, updated, 1, "hash-new");

    expect(status).toBe("updated");
    expect(projectState(db).currentContentHash).toBe("hash-new");
  });

  it("should keep the previous project hash on a version conflict", async () => {
    seedProject(db, "p1", { currentContentHash: "hash-old" });
    const existing = makeSecret("old", { A: "1" });
    seed(db, existing);

    const stale = makeSecret("old", { A: "2" });
    stale.id = existing.id;
    const status = await SecretsDataUpdate(undefined, stale, 2, "hash-new");

    expect(status).toBe("version_conflict");
    expect(projectState(db).currentContentHash).toBe("hash-old");
  });
});

describe("SecretsDataDelete (sqlite)", () => {
  let db: Database.Database;

  beforeEach(() => {
    jest.clearAllMocks();
    db = new Database(":memory:");
    createSecretsTable(db);
    createProjectsTable(db);
    setupSqlite(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should delete the secret and update the project hash", async () => {
    seedProject(db, "p1", { currentContentHash: "hash-old" });
    const existing = makeSecret("a");
    seed(db, existing);

    await SecretsDataDelete(undefined, existing.id, "p1", "hash-new");

    expect(names(db)).toEqual([]);
    expect(projectState(db).currentContentHash).toBe("hash-new");
  });

  it("should not touch the project when no hash is provided", async () => {
    seedProject(db, "p1", { currentContentHash: "hash-old" });
    const existing = makeSecret("a");
    seed(db, existing);

    await SecretsDataDelete(undefined, existing.id);

    expect(names(db)).toEqual([]);
    expect(projectState(db).currentContentHash).toBe("hash-old");
  });
});

describe("SecretsData transactions (Postgres)", () => {
  type QueryCall = [string, unknown[]?];

  function makeClient(rowCounts: number[]) {
    let queryIndex = 0;
    const client = {
      query: jest.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rowCount: null };
        }
        const rowCount = rowCounts[queryIndex++] ?? 1;
        return { rowCount };
      }),
      release: jest.fn(),
    };
    return client;
  }

  function useClient(client: { query: jest.Mock; release: jest.Mock }): void {
    dbUtils.DbUtilsGetType.mockReturnValue("postgres");
    dbUtils.DbUtilsGetDatabase.mockReturnValue({
      connect: jest.fn(async () => client),
    });
  }

  function statements(client: { query: jest.Mock }): string[] {
    return (client.query.mock.calls as QueryCall[]).map((call) => call[0]);
  }

  it("should insert the secret and the hash on a dedicated transaction", async () => {
    const client = makeClient([1, 1]);
    useClient(client);

    await SecretsDataAdd(undefined, makeSecret("a"), "hash-1");

    expect(statements(client)[0]).toBe("BEGIN");
    expect(statements(client)[1]).toContain("INSERT INTO secrets");
    expect(statements(client)[2]).toContain("UPDATE projects");
    expect(statements(client)[3]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("should roll back the insert when the hash update fails", async () => {
    const client = makeClient([1]);
    client.query.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") {
        return { rowCount: null };
      }
      if (sql.includes("UPDATE projects")) {
        throw new Error("boom");
      }
      return { rowCount: 1 };
    });
    useClient(client);

    await expect(
      SecretsDataAdd(undefined, makeSecret("a"), "hash-1"),
    ).rejects.toThrow("boom");

    expect(statements(client)).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  it("should update the row and the hash in one transaction", async () => {
    const client = makeClient([1, 1]);
    useClient(client);

    const secret = makeSecret("updated", { A: "1" });
    const status = await SecretsDataUpdate(undefined, secret, 2, "hash-1");

    expect(status).toBe("updated");
    expect(secret.version).toBe(3);
    expect(statements(client)[0]).toBe("BEGIN");
    expect(statements(client)[1]).toContain("UPDATE secrets");
    expect(statements(client)[2]).toContain("UPDATE projects");
    expect(statements(client)[3]).toBe("COMMIT");
  });

  it("should not write the hash when the update affects no row", async () => {
    const client = makeClient([0]);
    useClient(client);
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
    const status = await SecretsDataUpdate(undefined, secret, 2, "hash-1");

    expect(status).toBe("version_conflict");
    expect(statements(client).some((sql) => sql.includes("UPDATE projects"))).toBe(
      false,
    );
    const executed = statements(client);
    expect(executed[executed.length - 1]).toBe("COMMIT");
  });

  it("should delete the secret and update the hash in one transaction", async () => {
    const client = makeClient([1, 1]);
    useClient(client);

    await SecretsDataDelete(undefined, "s1", "p1", "hash-1");

    expect(statements(client)[0]).toBe("BEGIN");
    expect(statements(client)[1]).toContain("DELETE FROM secrets");
    expect(statements(client)[2]).toContain("UPDATE projects");
    expect(statements(client)[3]).toBe("COMMIT");
  });

  it("should replace the secrets and write the sync state in one transaction", async () => {
    const client = makeClient([1, 1, 1]);
    useClient(client);

    await SecretsDataReplaceForProject(undefined, "p1", [makeSecret("a")], {
      snapshotId: "snap-1",
      snapshotTime: "2026-11-03T10:00:00Z",
      contentHash: "hash-1",
    });

    const sql = statements(client);
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toContain("DELETE FROM secrets");
    expect(sql[2]).toContain("INSERT INTO secrets");
    expect(sql[3]).toContain("UPDATE projects");
    expect(sql[4]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("should roll back the replace when an insert fails", async () => {
    const client = makeClient([1]);
    client.query.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") {
        return { rowCount: null };
      }
      if (sql.includes("INSERT INTO secrets")) {
        throw new Error("insert failed");
      }
      return { rowCount: 1 };
    });
    useClient(client);

    await expect(
      SecretsDataReplaceForProject(undefined, "p1", [makeSecret("a")], {
        snapshotId: "snap-1",
        snapshotTime: "2026-11-03T10:00:00Z",
        contentHash: "hash-1",
      }),
    ).rejects.toThrow("insert failed");

    expect(statements(client)).toContain("ROLLBACK");
    expect(statements(client).some((sql) => sql.includes("UPDATE projects"))).toBe(
      false,
    );
    expect(client.release).toHaveBeenCalled();
  });
});