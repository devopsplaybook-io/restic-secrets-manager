import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  SqlDbUtilsGetDatabase,
  SqlDbUtilsInit,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import type Database from "better-sqlite3";

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

function tableColumns(db: Database.Database, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column: any) => column.name);
}

function dbVersion(db: Database.Database): number {
  const version = db
    .prepare(
      "SELECT MAX(CAST(value AS INTEGER)) AS version FROM metadata WHERE type = 'db_version'",
    )
    .get() as any;
  return Number(version.version);
}

function foreignKeys(db: Database.Database, table: string): any[] {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all();
}

async function inTempDataDir(
  run: (dataDir: string) => Promise<void>,
): Promise<void> {
  const dataDir = await fse.mkdtemp(path.join(os.tmpdir(), "rsm-migrations-"));
  try {
    await run(dataDir);
  } finally {
    try {
      SqlDbUtilsGetDatabase()?.close();
    } catch {
      // already closed
    }
    await fse.remove(dataDir);
  }
}

beforeAll(() => {
  SqlDbUtilsSetOTel(
    { startSpan: () => fakeSpan() } as any,
    { createModuleLogger: () => ({ info: jest.fn(), error: jest.fn() }) } as any,
  );
});

describe("database migrations", () => {
  it("should apply every migration up to init-0011 on SQLite", async () => {
    await inTempDataDir(async (dataDir) => {
      await SqlDbUtilsInit(
        fakeSpan(),
        { DATA_DIR: dataDir } as any,
        path.join(SQL_DIR, "sqlite"),
      );
      const db = SqlDbUtilsGetDatabase();
      expect(tableColumns(db, "users")).toContain("tokenVersion");
      expect(tableColumns(db, "secrets")).toContain("version");
      expect(dbVersion(db)).toBe(11);
    });
  });

  it("should declare the cascading project foreign key and the name index", async () => {
    await inTempDataDir(async (dataDir) => {
      await SqlDbUtilsInit(
        fakeSpan(),
        { DATA_DIR: dataDir } as any,
        path.join(SQL_DIR, "sqlite"),
      );
      const db = SqlDbUtilsGetDatabase();
      expect(foreignKeys(db, "secrets")).toEqual([
        expect.objectContaining({
          table: "projects",
          from: "projectId",
          to: "id",
          on_delete: "CASCADE",
        }),
      ]);
      const indexes = db.prepare("PRAGMA index_list(secrets)").all() as any[];
      expect(
        indexes.some(
          (index) =>
            index.name === "idx_secrets_project_name" && index.unique === 1,
        ),
      ).toBe(true);
    });
  });

  it("should upgrade a version-9 database, remove orphan secrets and keep real rows", async () => {
    await inTempDataDir(async (dataDir) => {
      const sqlDir = path.join(dataDir, "sql");
      await fse.ensureDir(sqlDir);
      for (let version = 0; version <= 9; version++) {
        const file = `init-${String(version).padStart(4, "0")}.sql`;
        await fse.copy(
          path.join(SQL_DIR, "sqlite", file),
          path.join(sqlDir, file),
        );
      }
      await SqlDbUtilsInit(fakeSpan(), { DATA_DIR: dataDir } as any, sqlDir);
      const v9 = SqlDbUtilsGetDatabase();
      expect(dbVersion(v9)).toBe(9);
      const now = new Date().toISOString();
      v9.prepare(
        `INSERT INTO projects ("id", "name", "s3Endpoint", "s3Bucket", "repoPrefix", "s3AccessKeyId", "s3SecretAccessKey", "resticPassword", "dateCreated")
         VALUES ('p1', 'p1', 's3.example.com', 'bucket', 'prefix', 'key', 'secret', 'password', ?)`,
      ).run(now);
      v9.prepare(
        `INSERT INTO secrets ("id", "projectId", "name", "data", "dateCreated", "dateUpdated")
         VALUES ('s1', 'p1', 'kept', '{"A":"1"}', ?, ?)`,
      ).run(now, now);
      v9.prepare(
        `INSERT INTO secrets ("id", "projectId", "name", "data", "dateCreated", "dateUpdated")
         VALUES ('s2', 'missing', 'orphan', '{}', ?, ?)`,
      ).run(now, now);
      v9.close();

      for (const file of ["init-0010.sql", "init-0011.sql"]) {
        await fse.copy(
          path.join(SQL_DIR, "sqlite", file),
          path.join(sqlDir, file),
        );
      }
      await SqlDbUtilsInit(fakeSpan(), { DATA_DIR: dataDir } as any, sqlDir);
      const upgraded = SqlDbUtilsGetDatabase();
      expect(dbVersion(upgraded)).toBe(11);
      expect(
        upgraded
          .prepare('SELECT "id", "version" FROM secrets ORDER BY "id"')
          .all(),
      ).toEqual([{ id: "s1", version: 1 }]);
      expect(foreignKeys(upgraded, "secrets")).toEqual([
        expect.objectContaining({
          table: "projects",
          from: "projectId",
          on_delete: "CASCADE",
        }),
      ]);

      upgraded.pragma("foreign_keys = ON");
      upgraded.prepare('DELETE FROM projects WHERE "id" = ?').run("p1");
      expect(
        upgraded.prepare("SELECT COUNT(*) AS count FROM secrets").get(),
      ).toEqual({ count: 0 });
    });
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

  it("should add the secret version on both database types", async () => {
    const statement =
      'ALTER TABLE secrets ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;';
    expect(
      await fse.readFile(path.join(SQL_DIR, "sqlite/init-0010.sql"), "utf-8"),
    ).toContain(statement);
    expect(
      await fse.readFile(path.join(SQL_DIR, "postgres/init-0010.sql"), "utf-8"),
    ).toContain(statement);
  });

  it("should clean orphans and add the cascading foreign key on both database types", async () => {
    const sqliteSql = await fse.readFile(
      path.join(SQL_DIR, "sqlite/init-0011.sql"),
      "utf-8",
    );
    const postgresSql = await fse.readFile(
      path.join(SQL_DIR, "postgres/init-0011.sql"),
      "utf-8",
    );
    for (const sql of [sqliteSql, postgresSql]) {
      expect(sql).toContain("DELETE FROM secrets");
      expect(sql).toMatch(/FOREIGN KEY .*REFERENCES projects.*ON DELETE CASCADE/s);
    }
  });
});
