import type { Span } from "@opentelemetry/sdk-trace";
import {
  convertToPostgresPlaceholders,
  DbUtilsExecSQL,
  DbUtilsGetDatabase,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils-std-ts/DbUtils";
import { Secret } from "../model/Secret";

export async function SecretsDataListForProject(
  context: Span | undefined,
  projectId: string,
): Promise<Secret[]> {
  const secretsRaw = await DbUtilsQuerySQL(
    context,
    SQL_QUERIES.LIST_FOR_PROJECT,
    [projectId],
  );
  const secrets: Secret[] = [];
  for (const secretRaw of secretsRaw) {
    const secret = Secret.fromJson(secretRaw);
    if (secret) {
      secrets.push(secret);
    }
  }
  return secrets;
}

export async function SecretsDataGet(
  context: Span | undefined,
  id: string,
): Promise<Secret | null> {
  const secretsRaw = await DbUtilsQuerySQL(context, SQL_QUERIES.GET_SECRET, [
    id,
  ]);
  if (secretsRaw.length === 0) {
    return null;
  }
  return Secret.fromJson(secretsRaw[0]);
}

export async function SecretsDataGetByName(
  context: Span | undefined,
  projectId: string,
  name: string,
): Promise<Secret | null> {
  const secretsRaw = await DbUtilsQuerySQL(context, SQL_QUERIES.GET_BY_NAME, [
    projectId,
    name,
  ]);
  if (secretsRaw.length === 0) {
    return null;
  }
  return Secret.fromJson(secretsRaw[0]);
}

export async function SecretsDataCountForProject(
  context: Span | undefined,
  projectId: string,
): Promise<number> {
  const resultRaw = await DbUtilsQuerySQL(
    context,
    SQL_QUERIES.COUNT_FOR_PROJECT,
    [projectId],
  );
  return resultRaw.length > 0 ? parseInt(resultRaw[0].count, 10) : 0;
}

/** Secret counts of every project, in one grouped query. */
export async function SecretsDataCountsAll(
  context: Span | undefined,
): Promise<Map<string, number>> {
  const rows = await DbUtilsQuerySQL(context, SQL_QUERIES.COUNT_ALL);
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.projectId, parseInt(row.count, 10));
  }
  return counts;
}

export async function SecretsDataAdd(
  context: Span | undefined,
  secret: Secret,
): Promise<void> {
  await DbUtilsExecSQL(context, SQL_QUERIES.INSERT_SECRET, [
    secret.id,
    secret.projectId,
    secret.name,
    JSON.stringify(secret.data),
    secret.dateCreated,
    secret.dateUpdated,
    secret.version,
  ]);
}

export type SecretsUpdateStatus = "updated" | "not_found" | "version_conflict";

/**
 * Atomically updates a secret name and data, guarded by the expected
 * version. One conditional statement makes the rename and the data write
 * indivisible; a stale version changes nothing and reports a conflict.
 */
export async function SecretsDataUpdate(
  context: Span | undefined,
  secret: Secret,
  expectedVersion: number,
): Promise<SecretsUpdateStatus> {
  const dateUpdated = new Date().toISOString();
  const affected = await DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_SECRET, [
    secret.name,
    JSON.stringify(secret.data),
    dateUpdated,
    secret.id,
    secret.projectId,
    expectedVersion,
  ]);
  if (affected === 1) {
    secret.dateUpdated = dateUpdated;
    secret.version = expectedVersion + 1;
    return "updated";
  }
  const current = await SecretsDataGet(context, secret.id);
  if (!current || current.projectId !== secret.projectId) {
    return "not_found";
  }
  return "version_conflict";
}

export async function SecretsDataDelete(
  context: Span | undefined,
  id: string,
): Promise<void> {
  await DbUtilsExecSQL(context, SQL_QUERIES.DELETE_SECRET, [id]);
}

/**
 * Replaces all the secrets of a project with the provided list
 * (used when pulling from the restic repository). The delete and the
 * inserts run in a single transaction: a failure leaves the previous
 * secret set untouched.
 */
export async function SecretsDataReplaceForProject(
  context: Span | undefined,
  projectId: string,
  secrets: Secret[],
): Promise<void> {
  if (DbUtilsGetType() === "sqlite") {
    // better-sqlite3 executes synchronously: do not await inside the
    // transaction callback or it would commit before the statements run.
    const db = DbUtilsGetDatabase();
    const apply = db.transaction(() => {
      DbUtilsExecSQL(context, SQL_QUERIES.DELETE_BY_PROJECT, [projectId]);
      for (const secret of secrets) {
        DbUtilsExecSQL(context, SQL_QUERIES.INSERT_SECRET, insertParams(secret));
      }
    });
    apply();
    return;
  }
  const pool = DbUtilsGetDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      convertToPostgresPlaceholders(SQL_QUERIES.DELETE_BY_PROJECT),
      [projectId],
    );
    for (const secret of secrets) {
      await client.query(
        convertToPostgresPlaceholders(SQL_QUERIES.INSERT_SECRET),
        insertParams(secret),
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function insertParams(secret: Secret): unknown[] {
  return [
    secret.id,
    secret.projectId,
    secret.name,
    JSON.stringify(secret.data),
    secret.dateCreated,
    secret.dateUpdated,
    secret.version,
  ];
}

// SQL
// Written SQLite-first with quoted identifiers (valid for both backends);
// the DbUtils facade converts `?` placeholders for Postgres.

const SQL_QUERIES = {
  LIST_FOR_PROJECT:
    'SELECT * FROM secrets WHERE "projectId" = ? ORDER BY "name"',
  GET_SECRET: 'SELECT * FROM secrets WHERE "id" = ?',
  GET_BY_NAME: 'SELECT * FROM secrets WHERE "projectId" = ? AND "name" = ?',
  COUNT_FOR_PROJECT:
    'SELECT COUNT(*) AS count FROM secrets WHERE "projectId" = ?',
  COUNT_ALL: 'SELECT "projectId", COUNT(*) AS count FROM secrets GROUP BY "projectId"',
  INSERT_SECRET:
    'INSERT INTO secrets ("id", "projectId", "name", "data", "dateCreated", "dateUpdated", "version") VALUES (?, ?, ?, ?, ?, ?, ?)',
  UPDATE_SECRET:
    'UPDATE secrets SET "name" = ?, "data" = ?, "dateUpdated" = ?, "version" = "version" + 1 WHERE "id" = ? AND "projectId" = ? AND "version" = ?',
  DELETE_SECRET: 'DELETE FROM secrets WHERE "id" = ?',
  DELETE_BY_PROJECT: 'DELETE FROM secrets WHERE "projectId" = ?',
};
