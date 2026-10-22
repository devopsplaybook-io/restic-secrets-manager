import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  SqlDbUtilsGetDatabase,
  SqlDbUtilsInit,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";

const SQL_DIR = path.join(__dirname, "../sql");

function fakeSpan(): any {
  return {
    end: jest.fn(),
    setStatus: jest.fn(),
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
    addEvent: jest.fn(),
    recordException: jest.fn(),
    updateName: jest.fn(),
    addLink: jest.fn(),
  };
}

beforeAll(() => {
  SqlDbUtilsSetOTel(
    { startSpan: () => fakeSpan() } as any,
    { createModuleLogger: () => ({ info: jest.fn(), error: jest.fn() }) } as any,
  );
});

describe("database migrations", () => {
  it("should apply init-0009 and expose users.tokenVersion on SQLite", async () => {
    const dataDir = await fse.mkdtemp(path.join(os.tmpdir(), "rsm-migrations-"));
    try {
      await SqlDbUtilsInit(
        fakeSpan(),
        { DATA_DIR: dataDir } as any,
        path.join(SQL_DIR, "sqlite"),
      );
      const db = SqlDbUtilsGetDatabase();
      const columns = db
        .prepare("PRAGMA table_info(users)")
        .all()
        .map((column: any) => column.name);
      expect(columns).toContain("tokenVersion");
      const version = db
        .prepare(
          "SELECT MAX(CAST(value AS INTEGER)) AS version FROM metadata WHERE type = 'db_version'",
        )
        .get() as any;
      expect(Number(version.version)).toBe(9);
    } finally {
      try {
        SqlDbUtilsGetDatabase()?.close();
      } catch {
        // already closed
      }
      await fse.remove(dataDir);
    }
  });

  it("should ship the same additive migration for PostgreSQL", async () => {
    const sqliteSql = await fse.readFile(
      path.join(SQL_DIR, "sqlite/init-0009.sql"),
      "utf-8",
    );
    const postgresSql = await fse.readFile(
      path.join(SQL_DIR, "postgres/init-0009.sql"),
      "utf-8",
    );
    const statement =
      'ALTER TABLE users ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;';
    expect(sqliteSql).toContain(statement);
    expect(postgresSql).toContain(statement);
  });
});
