import type { Span } from "@opentelemetry/sdk-trace";
import * as fse from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import {
  ProjectsDataGet,
  ProjectsDataUpdateSyncState,
} from "../projects/ProjectsData";
import {
  computeHasLocalChanges,
  computeSecretsHash,
} from "../secrets/SecretsHash";
import {
  SecretsDataCountForProject,
  SecretsDataListForProject,
  SecretsDataReplaceForProject,
} from "../secrets/SecretsData";
import {
  isRepoNotInitialized,
  latestSnapshot,
  ResticClient,
  ResticSnapshot,
} from "./ResticClient";
import { ResticSyncError } from "./ResticErrors";
import { resticTimeoutsFromConfig } from "./ResticTimeouts";
import { SyncLocksRun } from "./SyncLocks";
import {
  createTemporaryWorkDir,
  ensurePrivateDir,
  restrictTreePermissions,
  writePrivateJson,
} from "./TempWorkDir";

export interface PullResult {
  snapshotId: string;
  snapshotTime: string;
  secrets: number;
  keys: number;
}

export interface PushResult {
  snapshotId: string;
  snapshotTime: string;
}

export interface RestoreSnapshotResult {
  snapshotId: string;
  snapshotTime: string;
  secrets: number;
  keys: number;
}

export interface SnapshotInfo {
  id: string;
  time: string;
  /** User who pushed the snapshot (from the pushed-by restic tag). */
  pushedBy?: string;
  /** restic-reported user and host, used as fallback attribution. */
  username?: string;
  hostname?: string;
}

export interface SyncStatusResult {
  hasLocalChanges: boolean;
  lastSyncSnapshotId: string;
  lastSyncSnapshotTime: string;
  remoteLatestSnapshotId: string;
  remoteLatestSnapshotTime: string;
  needsPull: boolean;
}

/** User-facing outcome of a read-only repository connection test. */
export interface ConnectionTestResult {
  status: "empty" | "ok" | "error";
  message: string;
  snapshotCount?: number;
  latestSnapshotTime?: string;
}

export { ResticSyncError };

/**
 * Pull (restore) the pinned snapshot of the project repository and replace
 * the project secrets with its content. The snapshot must still be the
 * repository latest (otherwise the repository changed since the preview and
 * the pull is rejected with 409). Serialized per project.
 */
export async function ResticSyncPull(
  context: Span,
  config: Config,
  project: Project,
  snapshotId: string,
  dataApi: any = DataApi,
  signal?: AbortSignal,
): Promise<PullResult> {
  return SyncLocksRun(
    project.id,
    () =>
      resticSyncPullUnlocked(
        context,
        config,
        project,
        snapshotId,
        dataApi,
        signal,
      ),
    context,
  );
}

async function resticSyncPullUnlocked(
  context: Span,
  config: Config,
  project: Project,
  snapshotId: string,
  dataApi: any,
  signal?: AbortSignal,
): Promise<PullResult> {
  if (typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
    throw new ResticSyncError(
      "snapshotId is required: preview the pull and send the previewed snapshot id",
      400,
    );
  }
  // Re-read the project under the lock: a queued sync may have moved the
  // last synchronized state while this operation was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  const workDir = await createTemporaryWorkDir(config.TMP_DIR);
  const restoreDir = path.join(workDir, "restore");
  try {
    await ensurePrivateDir(restoreDir);

    const snapshots = await client.snapshots();
    const latest = latestSnapshot(snapshots);
    if (!latest) {
      throw new ResticSyncError(
        "Repository is empty: no snapshot to pull",
        404,
      );
    }
    if (latest.id !== snapshotId) {
      throw new ResticSyncError(
        `The repository changed since the preview (latest snapshot is now ${latest.id}). Preview the pull again.`,
        409,
      );
    }

    // Restore exactly the previewed snapshot, not "latest" resolved again.
    await client.restore(snapshotId, restoreDir);
    await restrictTreePermissions(restoreDir);
    const { secrets, keys } = await importPulledSecrets(
      context,
      project,
      restoreDir,
      dataApi,
    );

    await recordSyncState(context, project, dataApi, latest.id, latest.time);

    return {
      snapshotId: latest.id,
      snapshotTime: latest.time,
      secrets,
      keys,
    };
  } finally {
    await fse.remove(workDir);
  }
}

/**
 * Read all JSON secret files from a restored folder and replace the
 * project secrets in the database with them.
 */
export async function importPulledSecrets(
  context: Span,
  project: Project,
  dir: string,
  dataApi: any = DataApi,
): Promise<{ secrets: number; keys: number }> {
  const secrets = await readSnapshotSecrets(dir);
  for (const secret of secrets) {
    secret.projectId = project.id;
  }
  const keys = secrets.reduce(
    (sum, secret) => sum + Object.keys(secret.data).length,
    0,
  );
  await dataApi.SecretsDataReplaceForProject(context, project.id, secrets);
  return { secrets: secrets.length, keys };
}

/**
 * Read and validate the JSON secret files of a restored snapshot folder.
 * Invalid file names or content and snapshots holding only ignored files
 * are rejected with 422. The returned secrets carry no project id: they
 * are only the content of the snapshot.
 */
export async function readSnapshotSecrets(dir: string): Promise<Secret[]> {
  const entries = await fse.readdir(dir, { withFileTypes: true });
  const secrets: Secret[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const name = entry.name.substring(0, entry.name.length - ".json".length);
    if (!Secret.isValidName(name)) {
      throw new ResticSyncError(
        `Invalid secret file name in repository: ${entry.name}`,
        422,
      );
    }
    const raw = await fse.readFile(path.join(dir, entry.name), "utf-8");
    let data;
    try {
      data = Secret.parseFileContent(raw);
    } catch (e) {
      throw new ResticSyncError(
        `Invalid secret file '${entry.name}': ${(e as Error).message}`,
        422,
      );
    }
    const secret = new Secret();
    secret.name = name;
    secret.data = data;
    secrets.push(secret);
  }
  if (secrets.length === 0 && entries.some((entry) => entry.isFile())) {
    throw new ResticSyncError(
      "No JSON secret file found in the snapshot (files were present but ignored): refusing to replace the project secrets",
      422,
    );
  }
  return secrets;
}

/**
 * Push (backup) the project secrets to the repository, tagging the
 * snapshot with the pushing user when known.
 * Rejected with 409 when the repository contains a more recent snapshot
 * than the last one synchronized by this project. Serialized per project
 * and re-checked against the fresh project state under the lock.
 */
export async function ResticSyncPush(
  context: Span,
  config: Config,
  project: Project,
  pushedBy: string | undefined,
  dataApi: any = DataApi,
  signal?: AbortSignal,
): Promise<PushResult> {
  return SyncLocksRun(
    project.id,
    () =>
      resticSyncPushUnlocked(
        context,
        config,
        project,
        pushedBy,
        dataApi,
        signal,
      ),
    context,
  );
}

async function resticSyncPushUnlocked(
  context: Span,
  config: Config,
  project: Project,
  pushedBy: string | undefined,
  dataApi: any,
  signal?: AbortSignal,
): Promise<PushResult> {
  // Re-read the project under the lock: a queued sync may have moved the
  // last synchronized state while this operation was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  const workDir = await createTemporaryWorkDir(config.TMP_DIR);
  const secretsDir = path.join(workDir, "secrets");
  try {
    await ensurePrivateDir(secretsDir);

    const secrets = await dataApi.SecretsDataListForProject(
      context,
      project.id,
    );
    for (const secret of secrets) {
      const filePath = path.join(secretsDir, `${secret.name}.json`);
      await writePrivateJson(filePath, secret.data);
    }

    // Initialize the repository when needed
    const initialized = await client.repoInitialized();
    if (!initialized) {
      await client.init();
    }

    // Reject the push when the repository holds a snapshot we do not know
    // about (never pulled or more recent than the last synchronization)
    const snapshots = await client.snapshots();
    const knownIds = new Set(snapshots.map((snapshot) => snapshot.id));
    const latest = latestSnapshot(snapshots);
    if (latest) {
      ensureNoNewerSnapshot(project, latest);
    }

    // Record exactly the snapshot created by this backup, never another
    // writer's latest snapshot.
    const createdId = await client.backup(secretsDir, pushedBy);
    const created = await resolveCreatedSnapshot(
      client,
      createdId,
      knownIds,
    );

    await dataApi.ProjectsDataUpdateSyncState(
      context,
      project.id,
      created.id,
      created.time,
      computeSecretsHash(secrets),
    );

    return {
      snapshotId: created.id,
      snapshotTime: created.time,
    };
  } finally {
    await fse.remove(workDir);
  }
}

/**
 * Identify the snapshot created by a backup: the summary id from
 * `restic backup --json` when present, otherwise the single snapshot that
 * appeared since the pre-push listing. Never falls back to "the latest
 * snapshot", which may belong to another writer.
 */
async function resolveCreatedSnapshot(
  client: ResticClient,
  createdId: string | null,
  knownIds: Set<string>,
): Promise<ResticSnapshot> {
  if (createdId) {
    const created = await client.snapshot(createdId);
    if (created) {
      return created;
    }
  } else {
    const snapshotsAfter = await client.snapshots();
    const newSnapshots = snapshotsAfter.filter(
      (snapshot) => !knownIds.has(snapshot.id),
    );
    if (newSnapshots.length === 1) {
      return newSnapshots[0];
    }
  }
  throw new ResticSyncError(
    "The push created a snapshot but it could not be identified; pull before pushing again",
    500,
  );
}

/**
 * Snapshot synchronization status of a project: whether the local secrets
 * differ from the last synchronized snapshot and whether the repository
 * holds a more recent snapshot (remote changes to pull).
 */
export async function ResticSyncStatus(
  context: Span,
  config: Config,
  project: Project,
  dataApi: any = DataApi,
): Promise<SyncStatusResult> {
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
  );
  const snapshots = await client.snapshots();
  const latest = latestSnapshot(snapshots);
  const secretCount = await dataApi.SecretsDataCountForProject(
    context,
    project.id,
  );
  return {
    hasLocalChanges: computeHasLocalChanges(project, secretCount),
    lastSyncSnapshotId: project.lastSyncSnapshotId,
    lastSyncSnapshotTime: project.lastSyncSnapshotTime,
    remoteLatestSnapshotId: latest ? latest.id : "",
    remoteLatestSnapshotTime: latest ? latest.time : "",
    needsPull: !!latest && latest.id !== project.lastSyncSnapshotId,
  };
}

/** Snapshot history of the project repository, most recent first. */
export async function ResticSyncListSnapshots(
  project: Project,
  config: Config,
  signal?: AbortSignal,
): Promise<SnapshotInfo[]> {
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  const snapshots = await client.snapshots();
  return snapshots
    .slice()
    .sort((a, b) => (a.time > b.time ? -1 : a.time < b.time ? 1 : 0))
    .map((snapshot) => ({
      id: snapshot.id,
      time: snapshot.time,
      ...snapshotPusherInfo(snapshot),
    }));
}

/**
 * Read-only connection test of the given (not yet created) project
 * settings: stateless, with no lock, cache, notification or database
 * side effect.
 */
export async function ResticSyncTestConnection(
  project: Project,
  config: Config,
  signal?: AbortSignal,
): Promise<ConnectionTestResult> {
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  const result = await client.testConnection();
  if (result.status === "empty") {
    return {
      status: "empty",
      message: "Repository is empty: it will be initialized on the first push",
    };
  }
  if (result.status === "ok") {
    return {
      status: "ok",
      message: `Connection successful: ${result.snapshotCount} snapshot${result.snapshotCount === 1 ? "" : "s"} found`,
      snapshotCount: result.snapshotCount,
      latestSnapshotTime: result.latestSnapshotTime,
    };
  }
  return {
    status: "error",
    message: result.message || "Unable to reach the repository",
  };
}

/**
 * Attribution of a snapshot: the pushing user from the `pushed-by:` restic
 * tag when present, falling back to the user and host reported by restic
 * itself. Older snapshots carry no attribution.
 */
function snapshotPusherInfo(snapshot: ResticSnapshot): {
  pushedBy?: string;
  username?: string;
  hostname?: string;
} {
  const username =
    typeof snapshot.username === "string" && snapshot.username.length > 0
      ? snapshot.username
      : undefined;
  const hostname =
    typeof snapshot.hostname === "string" && snapshot.hostname.length > 0
      ? snapshot.hostname
      : undefined;
  const tags = Array.isArray(snapshot.tags)
    ? snapshot.tags.filter((tag) => typeof tag === "string")
    : [];
  const pushedByTag = tags.find((tag) => tag.startsWith("pushed-by:"));
  const resticUser =
    username && hostname ? `${username}@${hostname}` : undefined;
  const pushedBy = pushedByTag
    ? pushedByTag.substring("pushed-by:".length) || resticUser
    : resticUser;
  return { pushedBy, username, hostname };
}

/**
 * Restore an arbitrary snapshot of the history and replace the project
 * secrets with its content. The restored snapshot becomes the last
 * synchronized state. Serialized per project.
 */
export async function ResticSyncRestoreSnapshot(
  context: Span,
  config: Config,
  project: Project,
  snapshotId: string,
  dataApi: any = DataApi,
  signal?: AbortSignal,
): Promise<RestoreSnapshotResult> {
  return SyncLocksRun(
    project.id,
    () =>
      resticSyncRestoreSnapshotUnlocked(
        context,
        config,
        project,
        snapshotId,
        dataApi,
        signal,
      ),
    context,
  );
}

async function resticSyncRestoreSnapshotUnlocked(
  context: Span,
  config: Config,
  project: Project,
  snapshotId: string,
  dataApi: any,
  signal?: AbortSignal,
): Promise<RestoreSnapshotResult> {
  // Re-read the project under the lock: a queued sync may have moved the
  // last synchronized state while this operation was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  const workDir = await createTemporaryWorkDir(config.TMP_DIR);
  const restoreDir = path.join(workDir, "restore");
  try {
    await ensurePrivateDir(restoreDir);

    const snapshots = await client.snapshots();
    const target = snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (!target) {
      throw new ResticSyncError(
        `Snapshot not found in the repository: ${snapshotId}`,
        404,
      );
    }

    await client.restore(target.id, restoreDir);
    await restrictTreePermissions(restoreDir);
    const { secrets, keys } = await importPulledSecrets(
      context,
      project,
      restoreDir,
      dataApi,
    );

    await recordSyncState(context, project, dataApi, target.id, target.time);

    return {
      snapshotId: target.id,
      snapshotTime: target.time,
      secrets,
      keys,
    };
  } finally {
    await fse.remove(workDir);
  }
}

/**
 * Discard the local modifications that were not pushed: restore the last
 * synchronized snapshot. Rejected with 409 when the project was never
 * synchronized (there is nothing to restore). Serialized per project.
 */
export async function ResticSyncDiscardLocalChanges(
  context: Span,
  config: Config,
  project: Project,
  dataApi: any = DataApi,
  signal?: AbortSignal,
): Promise<RestoreSnapshotResult> {
  return SyncLocksRun(
    project.id,
    () =>
      resticSyncDiscardLocalChangesUnlocked(
        context,
        config,
        project,
        dataApi,
        signal,
      ),
    context,
  );
}

async function resticSyncDiscardLocalChangesUnlocked(
  context: Span,
  config: Config,
  project: Project,
  dataApi: any,
  signal?: AbortSignal,
): Promise<RestoreSnapshotResult> {
  // Re-read the project under the lock: a queued sync may have moved the
  // last synchronized state while this operation was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  if (!project.lastSyncSnapshotId) {
    throw new ResticSyncError(
      "Project was never synchronized: there are no local changes to discard",
      409,
    );
  }
  return resticSyncRestoreSnapshotUnlocked(
    context,
    config,
    project,
    project.lastSyncSnapshotId,
    dataApi,
    signal,
  );
}

/**
 * Conflict detection: the push is rejected when the repository's latest
 * snapshot is not the last one synchronized by this project.
 */
export function ensureNoNewerSnapshot(
  project: Project,
  repoLatest: ResticSnapshot,
): void {
  if (!project.lastSyncSnapshotId) {
    throw new ResticSyncError(
      "The repository already contains snapshots. Pull first before pushing.",
      409,
    );
  }
  if (repoLatest.id !== project.lastSyncSnapshotId) {
    throw new ResticSyncError(
      "A more recent snapshot exists in the repository. Pull first before pushing.",
      409,
    );
  }
}

/** Records the synchronized snapshot and the hash of the stored secrets. */
async function recordSyncState(
  context: Span,
  project: Project,
  dataApi: any,
  snapshotId: string,
  snapshotTime: string,
): Promise<void> {
  const secrets = await dataApi.SecretsDataListForProject(context, project.id);
  await dataApi.ProjectsDataUpdateSyncState(
    context,
    project.id,
    snapshotId,
    snapshotTime,
    computeSecretsHash(secrets),
  );
}

/** Indirection point over the data layer so tests can stub it. */
export const DataApi = {
  ProjectsDataGet,
  ProjectsDataUpdateSyncState,
  SecretsDataCountForProject,
  SecretsDataListForProject,
  SecretsDataReplaceForProject,
};

// Re-export for callers checking restic error categories
export { isRepoNotInitialized };
