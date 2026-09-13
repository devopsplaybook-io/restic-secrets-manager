import { Span } from "@opentelemetry/sdk-trace-base";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";
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
  ]);
}

export async function SecretsDataUpdateData(
  context: Span | undefined,
  secret: Secret,
): Promise<void> {
  await DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_DATA, [
    JSON.stringify(secret.data),
    new Date().toISOString(),
    secret.id,
  ]);
}

export async function SecretsDataDelete(
  context: Span | undefined,
  id: string,
): Promise<void> {
  await DbUtilsExecSQL(context, SQL_QUERIES.DELETE_SECRET, [id]);
}

export async function SecretsDataDeleteByProjectId(
  context: Span | undefined,
  projectId: string,
): Promise<void> {
  await DbUtilsExecSQL(context, SQL_QUERIES.DELETE_BY_PROJECT, [projectId]);
}

/**
 * Replaces all the secrets of a project with the provided list
 * (used when pulling from the restic repository).
 */
export async function SecretsDataReplaceForProject(
  context: Span | undefined,
  projectId: string,
  secrets: Secret[],
): Promise<void> {
  await SecretsDataDeleteByProjectId(context, projectId);
  for (const secret of secrets) {
    await SecretsDataAdd(context, secret);
  }
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
  INSERT_SECRET:
    'INSERT INTO secrets ("id", "projectId", "name", "data", "dateCreated", "dateUpdated") VALUES (?, ?, ?, ?, ?, ?)',
  UPDATE_DATA:
    'UPDATE secrets SET "data" = ?, "dateUpdated" = ? WHERE "id" = ?',
  DELETE_SECRET: 'DELETE FROM secrets WHERE "id" = ?',
  DELETE_BY_PROJECT: 'DELETE FROM secrets WHERE "projectId" = ?',
};
