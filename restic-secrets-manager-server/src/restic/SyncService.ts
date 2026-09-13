import { Span } from "@opentelemetry/sdk-trace-base";
import * as fse from "fs-extra";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Config } from "../Config";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import { ProjectsDataUpdateSyncState } from "../projects/ProjectsData";
import {
  SecretsDataListForProject,
  SecretsDataReplaceForProject,
} from "../secrets/SecretsData";
import {
  isRepoNotInitialized,
  latestSnapshot,
  ResticClient,
  ResticSnapshot,
} from "./ResticClient";

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

export class ResticSyncError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Pull (restore) the latest snapshot of the project repository and replace
 * the project secrets with its content.
 */
export async function ResticSyncPull(
  context: Span,
  config: Config,
  project: Project,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataApi: any = DataApi,
): Promise<PullResult> {
  const client = new ResticClient(project);
  const workDir = path.join(config.TMP_DIR, `restic-secrets-manager-${uuidv4()}`);
  const restoreDir = path.join(workDir, "restore");
  try {
    await fse.ensureDir(restoreDir);

    const snapshots = await client.snapshots();
    const latest = latestSnapshot(snapshots);
    if (!latest) {
      throw new ResticSyncError(
        "Repository is empty: no snapshot to pull",
        404,
      );
    }

    await client.restoreLatest(restoreDir);
    const { secrets, keys } = await importPulledSecrets(
      context,
      project,
      restoreDir,
      dataApi,
    );

    await dataApi.ProjectsDataUpdateSyncState(
      context,
      project.id,
      latest.id,
      latest.time,
    );

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataApi: any = DataApi,
): Promise<{ secrets: number; keys: number }> {
  const entries = await fse.readdir(dir, { withFileTypes: true });
  const secrets: Secret[] = [];
  let keys = 0;
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
    secret.projectId = project.id;
    secret.name = name;
    secret.data = data;
    secrets.push(secret);
    keys += Object.keys(data).length;
  }
  await dataApi.SecretsDataReplaceForProject(context, project.id, secrets);
  return { secrets: secrets.length, keys };
}

/**
 * Push (backup) the project secrets to the repository.
 * Rejected with 409 when the repository contains a more recent snapshot
 * than the last one synchronized by this project.
 */
export async function ResticSyncPush(
  context: Span,
  config: Config,
  project: Project,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataApi: any = DataApi,
): Promise<PushResult> {
  const client = new ResticClient(project);
  const workDir = path.join(config.TMP_DIR, `restic-secrets-manager-${uuidv4()}`);
  const secretsDir = path.join(workDir, "secrets");
  try {
    await fse.ensureDir(secretsDir);

    const secrets = await dataApi.SecretsDataListForProject(context, project.id);
    for (const secret of secrets) {
      const filePath = path.join(secretsDir, `${secret.name}.json`);
      await fse.writeJson(filePath, secret.data, { spaces: 2 });
    }

    // Initialize the repository when needed
    const initialized = await client.repoInitialized();
    if (!initialized) {
      await client.init();
    }

    // Reject the push when the repository holds a snapshot we do not know
    // about (never pulled or more recent than the last synchronization)
    const snapshots = await client.snapshots();
    const latest = latestSnapshot(snapshots);
    if (latest) {
      ensureNoNewerSnapshot(project, latest);
    }

    await client.backup(secretsDir);

    const snapshotsAfter = await client.snapshots();
    const latestAfter = latestSnapshot(snapshotsAfter);
    if (!latestAfter) {
      throw new ResticSyncError(
        "Push completed but no snapshot was created",
        500,
      );
    }
    await dataApi.ProjectsDataUpdateSyncState(
      context,
      project.id,
      latestAfter.id,
      latestAfter.time,
    );

    return {
      snapshotId: latestAfter.id,
      snapshotTime: latestAfter.time,
    };
  } finally {
    await fse.remove(workDir);
  }
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
  ProjectsDataUpdateSyncState,
  SecretsDataListForProject,
  SecretsDataReplaceForProject,
};

// Re-export for callers checking restic error categories
export { isRepoNotInitialized };
