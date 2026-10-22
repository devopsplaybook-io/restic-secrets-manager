import type { Span } from "@opentelemetry/sdk-trace";
import * as fse from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import { SecretsDataListForProject } from "../secrets/SecretsData";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  computeSecretsDiff,
  SecretsDiffResult,
} from "../secrets/SecretsDiff";
import { latestSnapshot, ResticClient, ResticSnapshot } from "./ResticClient";
import { ResticSyncError } from "./ResticErrors";
import { resticTimeoutsFromConfig } from "./ResticTimeouts";
import { SyncLocksRun } from "./SyncLocks";
import { readSnapshotSecrets } from "./SyncService";
import {
  createTemporaryWorkDir,
  ensurePrivateDir,
  restrictTreePermissions,
} from "./TempWorkDir";

/**
 * Preview of what a synchronization operation (pull, snapshot restore,
 * discard of local changes) would change: the structural diff between the
 * current project secrets and the content of the target snapshot. The
 * target snapshot content is restored from restic into a temporary
 * directory; nothing is written to the database.
 */
export interface SyncPreviewResult extends SecretsDiffResult {
  /** Snapshot whose content would be applied. */
  snapshotId: string;
  snapshotTime: string;
}

export interface SyncPreviewDataLayer {
  ProjectsDataGet: (
    context: Span | undefined,
    projectId: string,
  ) => Promise<Project | null>;
  SecretsDataListForProject: (
    context: Span | undefined,
    projectId: string,
  ) => Promise<Secret[]>;
}

/** Indirection point over the data layer so tests can stub it. */
export const SyncPreviewDataApi: SyncPreviewDataLayer = {
  ProjectsDataGet,
  SecretsDataListForProject,
};

/**
 * Preview of a pull: the diff between the current project secrets and the
 * content of the latest snapshot of the repository. The returned
 * `snapshotId` pins the snapshot the confirmed pull must apply. Rejected
 * with 404 when the repository is empty. Serialized per project.
 */
export async function ResticSyncPreviewPull(
  context: Span,
  config: Config,
  project: Project,
  dataApi: SyncPreviewDataLayer = SyncPreviewDataApi,
  signal?: AbortSignal,
): Promise<SyncPreviewResult> {
  return SyncLocksRun(
    project.id,
    () =>
      resticSyncPreviewPullUnlocked(context, config, project, dataApi, signal),
    context,
  );
}

async function resticSyncPreviewPullUnlocked(
  context: Span,
  config: Config,
  project: Project,
  dataApi: SyncPreviewDataLayer,
  signal?: AbortSignal,
): Promise<SyncPreviewResult> {
  // Re-read the project under the lock: a queued sync may have moved the
  // last synchronized state while this preview was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  // The pull preview lists the snapshots once and diffs the resolved latest.
  const snapshots = await client.snapshots();
  const latest = latestSnapshot(snapshots);
  if (!latest) {
    throw new ResticSyncError("Repository is empty: no snapshot to pull", 404);
  }
  return previewSnapshotContent(
    context,
    config,
    project,
    client,
    latest,
    dataApi,
  );
}

/**
 * Preview of a snapshot restore: the diff between the current project
 * secrets and the content of the given snapshot. Rejected with 404 when
 * the snapshot does not exist. Serialized per project.
 */
export async function ResticSyncPreviewRestoreSnapshot(
  context: Span,
  config: Config,
  project: Project,
  snapshotId: string,
  dataApi: SyncPreviewDataLayer = SyncPreviewDataApi,
  signal?: AbortSignal,
): Promise<SyncPreviewResult> {
  return SyncLocksRun(
    project.id,
    () =>
      resticSyncPreviewRestoreSnapshotUnlocked(
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

async function resticSyncPreviewRestoreSnapshotUnlocked(
  context: Span,
  config: Config,
  project: Project,
  snapshotId: string,
  dataApi: SyncPreviewDataLayer,
  signal?: AbortSignal,
): Promise<SyncPreviewResult> {
  // Re-read the project under the lock: a queued sync may have moved the
  // last synchronized state while this preview was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  const snapshots = await client.snapshots();
  const target = snapshots.find((snapshot) => snapshot.id === snapshotId);
  if (!target) {
    throw new ResticSyncError(
      `Snapshot not found in the repository: ${snapshotId}`,
      404,
    );
  }
  return previewSnapshotContent(
    context,
    config,
    project,
    client,
    target,
    dataApi,
  );
}

/**
 * Preview of a discard of the local changes: the diff between the current
 * project secrets and the content of the last synchronized snapshot.
 * Rejected with 409 when the project was never synchronized and with 404
 * when that snapshot no longer exists. Serialized per project.
 */
export async function ResticSyncPreviewDiscardLocalChanges(
  context: Span,
  config: Config,
  project: Project,
  dataApi: SyncPreviewDataLayer = SyncPreviewDataApi,
  signal?: AbortSignal,
): Promise<SyncPreviewResult> {
  return SyncLocksRun(
    project.id,
    () =>
      resticSyncPreviewDiscardLocalChangesUnlocked(
        context,
        config,
        project,
        dataApi,
        signal,
      ),
    context,
  );
}

async function resticSyncPreviewDiscardLocalChangesUnlocked(
  context: Span,
  config: Config,
  project: Project,
  dataApi: SyncPreviewDataLayer,
  signal?: AbortSignal,
): Promise<SyncPreviewResult> {
  // Re-read the project under the lock: a queued sync may have moved the
  // last synchronized state while this preview was waiting.
  project = (await dataApi.ProjectsDataGet(context, project.id)) || project;
  if (!project.lastSyncSnapshotId) {
    throw new ResticSyncError(
      "Project was never synchronized: there are no local changes to discard",
      409,
    );
  }
  const client = new ResticClient(
    project,
    undefined,
    resticTimeoutsFromConfig(config),
    signal,
  );
  const snapshots = await client.snapshots();
  const target = snapshots.find(
    (snapshot) => snapshot.id === project.lastSyncSnapshotId,
  );
  if (!target) {
    throw new ResticSyncError(
      `Snapshot not found in the repository: ${project.lastSyncSnapshotId}`,
      404,
    );
  }
  return previewSnapshotContent(
    context,
    config,
    project,
    client,
    target,
    dataApi,
  );
}

/**
 * Restores the given (already resolved) snapshot into a temporary
 * directory, reads its secret files and diffs them against the current
 * project secrets. The temporary directory is always removed; nothing is
 * written to the database.
 */
async function previewSnapshotContent(
  context: Span,
  config: Config,
  project: Project,
  client: ResticClient,
  target: ResticSnapshot,
  dataApi: SyncPreviewDataLayer,
): Promise<SyncPreviewResult> {
  const workDir = await createTemporaryWorkDir(config.TMP_DIR);
  const restoreDir = path.join(workDir, "restore");
  try {
    await ensurePrivateDir(restoreDir);

    await client.restore(target.id, restoreDir);
    await restrictTreePermissions(restoreDir);
    const incoming = await readSnapshotSecrets(restoreDir);
    const current = await dataApi.SecretsDataListForProject(
      context,
      project.id,
    );

    return {
      ...computeSecretsDiff(current, incoming),
      snapshotId: target.id,
      snapshotTime: target.time,
    };
  } finally {
    await fse.remove(workDir);
  }
}
