import type { Span } from "@opentelemetry/sdk-trace";
import {
  convertToPostgresPlaceholders,
  DbUtilsExecSQL,
  DbUtilsGetDatabase,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils-std-ts/DbUtils";
import { Project } from "../model/Project";

export async function ProjectsDataGet(
  context: Span | undefined,
  id: string,
): Promise<Project | null> {
  const projectsRaw = await DbUtilsQuerySQL(context, SQL_QUERIES.GET_PROJECT, [
    id,
  ]);
  if (projectsRaw.length === 0) {
    return null;
  }
  return Project.fromJson(projectsRaw[0]);
}

export async function ProjectsDataGetByName(
  context: Span | undefined,
  name: string,
): Promise<Project | null> {
  const projectsRaw = await DbUtilsQuerySQL(
    context,
    SQL_QUERIES.GET_PROJECT_BY_NAME,
    [name],
  );
  if (projectsRaw.length === 0) {
    return null;
  }
  return Project.fromJson(projectsRaw[0]);
}

export async function ProjectsDataList(context?: Span): Promise<Project[]> {
  const projectsRaw = await DbUtilsQuerySQL(context, SQL_QUERIES.LIST_PROJECTS);
  const projects: Project[] = [];
  for (const projectRaw of projectsRaw) {
    const project = Project.fromJson(projectRaw);
    if (project) {
      projects.push(project);
    }
  }
  return projects;
}

/**
 * Finds the project already using a normalized repository target, if any.
 * Projects are few: the comparison runs on the loaded list so the
 * normalization stays in one place.
 */
export async function ProjectsDataGetByRepoTarget(
  context: Span | undefined,
  targetKey: string,
): Promise<Project | null> {
  const projects = await ProjectsDataList(context);
  for (const project of projects) {
    if (project.repoTargetKey() === targetKey) {
      return project;
    }
  }
  return null;
}

export async function ProjectsDataAdd(
  context: Span | undefined,
  project: Project,
): Promise<void> {
  await DbUtilsExecSQL(context, SQL_QUERIES.INSERT_PROJECT, [
    project.id,
    project.name,
    project.description,
    project.s3Endpoint,
    project.s3Bucket,
    project.effectiveRepoPrefix(),
    project.s3Region,
    project.s3BucketLookup,
    project.s3AccessKeyId,
    project.s3SecretAccessKey,
    project.resticPassword,
    project.dateCreated,
  ]);
}

/**
 * Deletes a project and its secrets in one transaction. The cascading
 * foreign key is the safety net for direct data-layer deletes; the explicit
 * secret delete keeps both dialects consistent even before the constraint
 * exists.
 */
export async function ProjectsDataDeleteCascade(
  context: Span | undefined,
  projectId: string,
): Promise<void> {
  if (DbUtilsGetType() === "sqlite") {
    // better-sqlite3 executes synchronously: do not await inside the
    // transaction callback or it would commit before the statements run.
    const db = DbUtilsGetDatabase();
    const apply = db.transaction(() => {
      DbUtilsExecSQL(context, SQL_QUERIES.DELETE_PROJECT_SECRETS, [projectId]);
      DbUtilsExecSQL(context, SQL_QUERIES.DELETE_PROJECT, [projectId]);
    });
    apply();
    return;
  }
  const pool = DbUtilsGetDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      convertToPostgresPlaceholders(SQL_QUERIES.DELETE_PROJECT_SECRETS),
      [projectId],
    );
    await client.query(
      convertToPostgresPlaceholders(SQL_QUERIES.DELETE_PROJECT),
      [projectId],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Records the snapshot synchronized by the last pull, push or restore,
 * together with the hash of the synchronized secrets content. After a
 * synchronization the baseline hash and the current content hash are the
 * same, so both columns are written in one statement.
 */
export async function ProjectsDataUpdateSyncState(
  context: Span | undefined,
  id: string,
  snapshotId: string,
  snapshotTime: string,
  contentHash: string,
): Promise<void> {
  await DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_SYNC_STATE, [
    snapshotId,
    snapshotTime,
    contentHash,
    contentHash,
    id,
  ]);
}

/** Stores the hash of the current secrets content (after a secret edit). */
export async function ProjectsDataUpdateCurrentContentHash(
  context: Span | undefined,
  id: string,
  contentHash: string,
): Promise<void> {
  await DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_CURRENT_CONTENT_HASH, [
    contentHash,
    id,
  ]);
}

/** Stores the baseline hash (used when normalizing legacy baselines). */
export async function ProjectsDataUpdateLastSyncContentHash(
  context: Span | undefined,
  id: string,
  contentHash: string,
): Promise<void> {
  await DbUtilsExecSQL(context, SQL_QUERIES.UPDATE_LAST_SYNC_CONTENT_HASH, [
    contentHash,
    id,
  ]);
}

// SQL
// Written SQLite-first with quoted identifiers (valid for both backends);
// the DbUtils facade converts `?` placeholders for Postgres.

const SQL_QUERIES = {
  GET_PROJECT: 'SELECT * FROM projects WHERE "id" = ?',
  GET_PROJECT_BY_NAME: 'SELECT * FROM projects WHERE "name" = ?',
  LIST_PROJECTS: 'SELECT * FROM projects ORDER BY "name"',
  INSERT_PROJECT:
    'INSERT INTO projects ("id", "name", "description", "s3Endpoint", "s3Bucket", "repoPrefix", "s3Region", "s3BucketLookup", "s3AccessKeyId", "s3SecretAccessKey", "resticPassword", "dateCreated") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  DELETE_PROJECT: 'DELETE FROM projects WHERE "id" = ?',
  DELETE_PROJECT_SECRETS: 'DELETE FROM secrets WHERE "projectId" = ?',
  UPDATE_SYNC_STATE:
    'UPDATE projects SET "lastSyncSnapshotId" = ?, "lastSyncSnapshotTime" = ?, "lastSyncContentHash" = ?, "currentContentHash" = ? WHERE "id" = ?',
  UPDATE_CURRENT_CONTENT_HASH:
    'UPDATE projects SET "currentContentHash" = ? WHERE "id" = ?',
  UPDATE_LAST_SYNC_CONTENT_HASH:
    'UPDATE projects SET "lastSyncContentHash" = ? WHERE "id" = ?',
};
