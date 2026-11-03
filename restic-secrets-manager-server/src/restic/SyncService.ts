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
  compareSnapshots,
  isRepoNotInitialized,
  latestSnapshot,
  ResticClient,
  ResticSnapshot,
} from "./ResticClient";
import { ResticSyncError } from "./ResticErrors";
import { resticTimeoutsFromConfig } from "./ResticTimeouts";
import { ProjectWriteLocksRun, SyncQueueRun } from "./SyncLocks";
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

/** Error code returned when the previewed secrets changed before confirming. */
export const SYNC_PREVIEW_STALE_CODE = "SYNC_PREVIEW_STALE";
export const SYNC_PREVIEW_STALE_MESSAGE =
  "Project secrets changed since the preview. Preview again and confirm the new changes.";

/** Delays between the read-after-write attempts on a freshly created snapshot. */
export const CREATED_SNAPSHOT_RETRY_DELAYS_MS = [250, 500];

type SleepFn = (ms: number) => Promise<void>;
const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pull (restore) the pinned snapshot of the project repository and replace
 * the project secrets with its content. The snapshot must still be the
 * repository latest (otherwise the repository changed since the preview and
 * the pull is rejected with 409). Rejected with 409 as well when the
 * project secrets moved since the preview content hash was taken.
 * Serialized per project.
 */
export async function ResticSyncPull(
  context: Span,
  config: Config,
  project: Project,
  snapshotId: string,
  expectedContentHash?: string,
  dataApi: any = DataApi,
  signal?: AbortSignal,
): Promise<PullResult> {
  return SyncQueueRun(project.id, () =>
    resticSyncPullUnlocked(
      context,
      config,
      project,
      snapshotId,
      expectedContentHash,
      dataApi,
      signal,
    ),
  );
}

async function resticSyncPullUnlocked(
  context: Span,
  config: Config,
  project: Project,
  snapshotId: string,
  expectedContentHash: string | undefined,
  dataApi: any,
  signal?: AbortSignal,
): Promise<PullResult> {
  if (typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
    throw new ResticSyncError(
      "snapshotId is required: preview the pull and send the previewed snapshot id",
      400,
    );
  }
  // Re-read the project under the queue: a queued sync may have moved the
  // last synchronized state while this operation was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  const expected = await resolveExpectedContentHash(
    context,
    project,
    expectedContentHash,
    dataApi,
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
    const secrets = await readSnapshotSecretsForProject(project, restoreDir);

    // The restic I/O runs outside the write lock: the compare-and-swap and
    // the replacement are the only part that must be serialized.
    await applySnapshotSecrets(
      context,
      project.id,
      expected,
      secrets,
      { snapshotId: latest.id, snapshotTime: latest.time },
      dataApi,
    );

    return {
      snapshotId: latest.id,
      snapshotTime: latest.time,
      secrets: secrets.length,
      keys: countSecretKeys(secrets),
    };
  } finally {
    await fse.remove(workDir);
  }
}

/**
 * Capture the compare-and-swap token: the hash sent by the preview when
 * provided, otherwise the hash of the current secrets captured now (older
 * clients that do not send the token keep working with a best-effort
 * check).
 */
async function resolveExpectedContentHash(
  context: Span,
  project: Project,
  expectedContentHash: string | undefined,
  dataApi: any,
): Promise<string> {
  if (typeof expectedContentHash === "string") {
    return expectedContentHash;
  }
  const secrets = await dataApi.SecretsDataListForProject(context, project.id);
  return computeSecretsHash(secrets);
}

/**
 * Read the restored snapshot content and attach it to the project.
 * Invalid content is rejected by `readSnapshotSecrets` with 422.
 */
async function readSnapshotSecretsForProject(
  project: Project,
  dir: string,
): Promise<Secret[]> {
  const secrets = await readSnapshotSecrets(dir);
  for (const secret of secrets) {
    secret.projectId = project.id;
  }
  return secrets;
}

function countSecretKeys(secrets: Secret[]): number {
  return secrets.reduce((sum, secret) => sum + Object.keys(secret.data).length, 0);
}

/**
 * Compare-and-swap of the project secrets: reject with 409 when the
 * secrets changed since the preview, otherwise replace them and record
 * the synchronization state in the same transaction.
 */
async function applySnapshotSecrets(
  context: Span,
  projectId: string,
  expectedContentHash: string,
  secrets: Secret[],
  snapshot: { snapshotId: string; snapshotTime: string },
  dataApi: any,
): Promise<void> {
  await ProjectWriteLocksRun(
    projectId,
    async () => {
      const project = await dataApi.ProjectsDataGet(context, projectId);
      if (!project) {
        throw new ResticSyncError(`Project not found: ${projectId}`, 404);
      }
      const current = await dataApi.SecretsDataListForProject(
        context,
        projectId,
      );
      if (computeSecretsHash(current) !== expectedContentHash) {
        throw new ResticSyncError(
          SYNC_PREVIEW_STALE_MESSAGE,
          409,
          SYNC_PREVIEW_STALE_CODE,
        );
      }
      await dataApi.SecretsDataReplaceForProject(context, projectId, secrets, {
        snapshotId: snapshot.snapshotId,
        snapshotTime: snapshot.snapshotTime,
        contentHash: computeSecretsHash(secrets),
      });
    },
    context,
  );
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
  return SyncQueueRun(project.id, () =>
    resticSyncPushUnlocked(
      context,
      config,
      project,
      pushedBy,
      dataApi,
      signal,
    ),
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
  // Re-read the project under the queue: a queued sync may have moved the
  // last synchronized state while this operation was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  const observedLastSyncSnapshotId = project.lastSyncSnapshotId;
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
    const pushedHash = computeSecretsHash(secrets);
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

    // Finalize under the write lock: a concurrent edit must not be
    // recorded as synchronized by this push.
    await ProjectWriteLocksRun(
      project.id,
      async () => {
        const fresh = await dataApi.ProjectsDataGet(context, project.id);
        if (!fresh) {
          throw new ResticSyncError(
            `Project not found: ${project.id}`,
            404,
          );
        }
        if (fresh.lastSyncSnapshotId !== observedLastSyncSnapshotId) {
          throw new ResticSyncError(
            "Another synchronization completed while pushing. Pull and push again.",
            409,
          );
        }
        // The hash of what was pushed is the baseline; the hash of the
        // current secrets tells whether edits arrived during the push.
        const freshSecrets = await dataApi.SecretsDataListForProject(
          context,
          project.id,
        );
        await dataApi.ProjectsDataUpdateSyncState(
          context,
          project.id,
          created.id,
          created.time,
          pushedHash,
          computeSecretsHash(freshSecrets),
        );
      },
      context,
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
 * appeared since the pre-push listing. The metadata read right after the
 * backup may lag behind (eventual consistency): retry with a short backoff
 * before falling back to the listing. Never falls back to "the latest
 * snapshot", which may belong to another writer.
 */
export async function resolveCreatedSnapshot(
  client: ResticClient,
  createdId: string | null,
  knownIds: Set<string>,
  sleep: SleepFn = defaultSleep,
): Promise<ResticSnapshot> {
  if (createdId) {
    for (const delay of [0, ...CREATED_SNAPSHOT_RETRY_DELAYS_MS]) {
      if (delay > 0) {
        await sleep(delay);
      }
      const created = await client.snapshot(createdId);
      if (created) {
        return created;
      }
    }
    // Propagated to the listing fallback below: the id may not be
    // readable yet while the listing already contains it.
    const snapshotsAfter = await client.snapshots();
    const exact = snapshotsAfter.find((snapshot) => snapshot.id === createdId);
    if (exact) {
      return exact;
    }
    const newSnapshots = snapshotsAfter.filter(
      (snapshot) => !knownIds.has(snapshot.id),
    );
    if (newSnapshots.length === 1) {
      return newSnapshots[0];
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
    .sort((a, b) => compareSnapshots(b, a))
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
  expectedContentHash?: string,
  dataApi: any = DataApi,
  signal?: AbortSignal,
): Promise<RestoreSnapshotResult> {
  return SyncQueueRun(project.id, () =>
    resticSyncRestoreSnapshotUnlocked(
      context,
      config,
      project,
      snapshotId,
      expectedContentHash,
      dataApi,
      signal,
    ),
  );
}

async function resticSyncRestoreSnapshotUnlocked(
  context: Span,
  config: Config,
  project: Project,
  snapshotId: string,
  expectedContentHash: string | undefined,
  dataApi: any,
  signal?: AbortSignal,
): Promise<RestoreSnapshotResult> {
  // Re-read the project under the queue: a queued sync may have moved the
  // last synchronized state while this operation was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  const expected = await resolveExpectedContentHash(
    context,
    project,
    expectedContentHash,
    dataApi,
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
    const secrets = await readSnapshotSecretsForProject(project, restoreDir);

    await applySnapshotSecrets(
      context,
      project.id,
      expected,
      secrets,
      { snapshotId: target.id, snapshotTime: target.time },
      dataApi,
    );

    return {
      snapshotId: target.id,
      snapshotTime: target.time,
      secrets: secrets.length,
      keys: countSecretKeys(secrets),
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
  expectedContentHash?: string,
  dataApi: any = DataApi,
  signal?: AbortSignal,
): Promise<RestoreSnapshotResult> {
  return SyncQueueRun(project.id, () =>
    resticSyncDiscardLocalChangesUnlocked(
      context,
      config,
      project,
      expectedContentHash,
      dataApi,
      signal,
    ),
  );
}

async function resticSyncDiscardLocalChangesUnlocked(
  context: Span,
  config: Config,
  project: Project,
  expectedContentHash: string | undefined,
  dataApi: any,
  signal?: AbortSignal,
): Promise<RestoreSnapshotResult> {
  // Re-read the project under the queue: a queued sync may have moved the
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
    expectedContentHash,
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
