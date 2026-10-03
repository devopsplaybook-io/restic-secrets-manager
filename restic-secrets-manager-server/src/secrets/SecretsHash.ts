import { Span } from "@opentelemetry/sdk-trace-base";
import * as crypto from "crypto";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import {
  ProjectsDataList,
  ProjectsDataUpdateCurrentContentHash,
  ProjectsDataUpdateLastSyncContentHash,
} from "../projects/ProjectsData";
import { SecretsDataListForProject } from "./SecretsData";

/**
 * SHA-256 of a canonical serialization of the project secrets (sorted by
 * name, data keys sorted): the baseline recorded at every synchronization
 * to detect local modifications that have not been pushed yet.
 */
export function computeSecretsHash(secrets: Secret[]): string {
  const canonical = secrets
    .map((secret) => ({
      name: secret.name,
      data: Object.fromEntries(
        Object.keys(secret.data)
          .sort()
          .map((key) => [key, secret.data[key]]),
      ),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sha256(canonical);
}

/**
 * Hash used before the canonical key-order fix. Kept only for the one-time
 * baseline normalization performed at startup (see SecretsHashBackfillAll):
 * a stored baseline that matches this hash for the current content proves
 * the content is unchanged.
 */
export function computeSecretsHashLegacy(secrets: Secret[]): string {
  const canonical = secrets
    .map((secret) => ({ name: secret.name, data: secret.data }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sha256(canonical);
}

function sha256(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

/**
 * True when the project secrets differ from the content of the last
 * synchronized snapshot. Projects that were never synchronized have local
 * changes as soon as they hold at least one secret. Projects synchronized
 * before content-hash tracking (no stored baseline) are assumed clean until
 * the next push or pull records the baseline hash.
 */
export function computeHasLocalChanges(
  project: Project,
  secretCount: number,
): boolean {
  if (!project.lastSyncSnapshotId) {
    return secretCount > 0;
  }
  if (!project.lastSyncContentHash) {
    return false;
  }
  if (!project.currentContentHash) {
    return true;
  }
  return project.lastSyncContentHash !== project.currentContentHash;
}

/**
 * Recomputes and stores the current content hash of a project. Called after
 * every secret edit so the stored hash always reflects the stored content.
 */
export async function SecretsHashRefreshForProject(
  context: Span | undefined,
  projectId: string,
): Promise<void> {
  const secrets = await SecretsDataListForProject(context, projectId);
  await ProjectsDataUpdateCurrentContentHash(
    context,
    projectId,
    computeSecretsHash(secrets),
  );
}

/**
 * One-time startup backfill of `currentContentHash` for projects stored
 * before the column existed, and normalization of baselines recorded with
 * the legacy (key-order sensitive) hash: when the stored baseline differs
 * from the canonical hash but matches the legacy hash of the current
 * content, the content provably did not change and the baseline is
 * rewritten canonically (avoids a false "local changes" badge after the
 * upgrade). New projects (and every secret edit) keep the column updated,
 * so only projects with an empty `currentContentHash` are processed.
 */
export async function SecretsHashBackfillAll(
  context: Span | undefined,
): Promise<void> {
  const projects = await ProjectsDataList(context);
  for (const project of projects) {
    if (project.currentContentHash) {
      continue;
    }
    const secrets = await SecretsDataListForProject(context, project.id);
    const canonical = computeSecretsHash(secrets);
    await ProjectsDataUpdateCurrentContentHash(context, project.id, canonical);
    if (
      project.lastSyncContentHash &&
      project.lastSyncContentHash !== canonical &&
      project.lastSyncContentHash === computeSecretsHashLegacy(secrets)
    ) {
      await ProjectsDataUpdateLastSyncContentHash(
        context,
        project.id,
        canonical,
      );
    }
  }
}
