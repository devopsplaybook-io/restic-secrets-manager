import type { Span } from "@opentelemetry/sdk-trace";
import {
  convertToPostgresPlaceholders,
  DbUtilsExecSQL,
  DbUtilsGetDatabase,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils-std-ts/DbUtils";
import { Secret } from "../model/Secret";

/** Sync state written in the same transaction as a replaced secret set. */
export interface ProjectSyncState {
  snapshotId: string;
  snapshotTime: string;
  contentHash: string;
}

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

/**
 * Inserts a secret. When `currentContentHash` is provided, the project's
 * current content hash is written in the same transaction, so the stored
 * hash always matches the stored content.
 */
export async function SecretsDataAdd(
  context: Span | undefined,
  secret: Secret,
  currentContentHash?: string,
): Promise<void> {
  if (DbUtilsGetType() === "sqlite") {
    // better-sqlite3 executes synchronously: do not await inside the
    // transaction callback or it would commit before the statements run.
    const db = DbUtilsGetDatabase();
    const apply = db.transaction(() => {
      DbUtilsExecSQL(context, SQL_QUERIES.INSERT_SECRET, insertParams(secret));
      if (currentContentHash !== undefined) {
        DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_PROJECT_CURRENT_HASH, [
          currentContentHash,
          secret.projectId,
        ]);
      }
    });
    apply();
    return;
  }
  if (currentContentHash === undefined) {
    await DbUtilsExecSQL(
      context,
      SQL_QUERIES.INSERT_SECRET,
      insertParams(secret),
    );
    return;
  }
  await postgresTransaction(async (client) => {
    await client.query(
      convertToPostgresPlaceholders(SQL_QUERIES.INSERT_SECRET),
      insertParams(secret),
    );
    await client.query(
      convertToPostgresPlaceholders(SQL_QUERIES.UPDATE_PROJECT_CURRENT_HASH),
      [currentContentHash, secret.projectId],
    );
  });
}

export type SecretsUpdateStatus = "updated" | "not_found" | "version_conflict";

/**
 * Atomically updates a secret name and data, guarded by the expected
 * version. One conditional statement makes the rename and the data write
 * indivisible; a stale version changes nothing and reports a conflict.
 * When `currentContentHash` is provided it is written in the same
 * transaction, only when the conditional update actually changed the row.
 */
export async function SecretsDataUpdate(
  context: Span | undefined,
  secret: Secret,
  expectedVersion: number,
  currentContentHash?: string,
): Promise<SecretsUpdateStatus> {
  const dateUpdated = new Date().toISOString();
  const params = [
    secret.name,
    JSON.stringify(secret.data),
    dateUpdated,
    secret.id,
    secret.projectId,
    expectedVersion,
  ];
  let affected: number;
  if (DbUtilsGetType() === "sqlite") {
    const db = DbUtilsGetDatabase();
    const apply = db.transaction(() => {
      const changes = DbUtilsExecSQL(
        context,
        SQL_QUERIES.UPDATE_SECRET,
        params,
      ) as number;
      if (changes === 1 && currentContentHash !== undefined) {
        DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_PROJECT_CURRENT_HASH, [
          currentContentHash,
          secret.projectId,
        ]);
      }
      return changes;
    });
    affected = apply() as number;
  } else if (currentContentHash === undefined) {
    affected = await DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_SECRET, params);
  } else {
    affected = await postgresTransaction(async (client) => {
      const result = await client.query(
        convertToPostgresPlaceholders(SQL_QUERIES.UPDATE_SECRET),
        params,
      );
      if (result.rowCount === 1) {
        await client.query(
          convertToPostgresPlaceholders(
            SQL_QUERIES.UPDATE_PROJECT_CURRENT_HASH,
          ),
          [currentContentHash, secret.projectId],
        );
      }
      return result.rowCount as number;
    });
  }
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

/**
 * Deletes a secret. When the project id and the new content hash are
 * provided, the project's current content hash is written in the same
 * transaction.
 */
export async function SecretsDataDelete(
  context: Span | undefined,
  id: string,
  projectId?: string,
  currentContentHash?: string,
): Promise<void> {
  if (DbUtilsGetType() === "sqlite") {
    const db = DbUtilsGetDatabase();
    const apply = db.transaction(() => {
      DbUtilsExecSQL(context, SQL_QUERIES.DELETE_SECRET, [id]);
      if (projectId && currentContentHash !== undefined) {
        DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_PROJECT_CURRENT_HASH, [
          currentContentHash,
          projectId,
        ]);
      }
    });
    apply();
    return;
  }
  if (!projectId || currentContentHash === undefined) {
    await DbUtilsExecSQL(context, SQL_QUERIES.DELETE_SECRET, [id]);
    return;
  }
  await postgresTransaction(async (client) => {
    await client.query(
      convertToPostgresPlaceholders(SQL_QUERIES.DELETE_SECRET),
      [id],
    );
    await client.query(
      convertToPostgresPlaceholders(SQL_QUERIES.UPDATE_PROJECT_CURRENT_HASH),
      [currentContentHash, projectId],
    );
  });
}

/**
 * Replaces all the secrets of a project with the provided list
 * (used when pulling from or restoring a restic snapshot). The delete, the
 * inserts and, when provided, the project sync state run in a single
 * transaction: a failure leaves the previous secret set and sync state
 * untouched, and no window exists between the written secrets and the
 * recorded baseline hash.
 */
export async function SecretsDataReplaceForProject(
  context: Span | undefined,
  projectId: string,
  secrets: Secret[],
  syncState?: ProjectSyncState,
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
      if (syncState) {
        DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_PROJECT_SYNC_STATE, [
          syncState.snapshotId,
          syncState.snapshotTime,
          syncState.contentHash,
          syncState.contentHash,
          projectId,
        ]);
      }
    });
    apply();
    return;
  }
  await postgresTransaction(async (client) => {
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
    if (syncState) {
      await client.query(
        convertToPostgresPlaceholders(SQL_QUERIES.UPDATE_PROJECT_SYNC_STATE),
        [
          syncState.snapshotId,
          syncState.snapshotTime,
          syncState.contentHash,
          syncState.contentHash,
          projectId,
        ],
      );
    }
  });
}

async function postgresTransaction<T>(
  work: (client: any) => Promise<T>,
): Promise<T> {
  const pool = DbUtilsGetDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
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
  UPDATE_PROJECT_SYNC_STATE:
    'UPDATE projects SET "lastSyncSnapshotId" = ?, "lastSyncSnapshotTime" = ?, "lastSyncContentHash" = ?, "currentContentHash" = ? WHERE "id" = ?',
  UPDATE_PROJECT_CURRENT_HASH:
    'UPDATE projects SET "currentContentHash" = ? WHERE "id" = ?',
};
