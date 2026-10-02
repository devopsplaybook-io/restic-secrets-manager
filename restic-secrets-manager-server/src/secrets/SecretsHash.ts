import * as crypto from "crypto";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";

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
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * True when the project secrets differ from the content of the last
 * synchronized snapshot. Projects that were never synchronized have local
 * changes as soon as they hold at least one secret. Projects synchronized
 * before content-hash tracking (no stored hash) are assumed clean until
 * the next push or pull records the baseline hash.
 */
export function computeHasLocalChanges(
  project: Project,
  secrets: Secret[],
): boolean {
  if (!project.lastSyncSnapshotId) {
    return secrets.length > 0;
  }
  if (!project.lastSyncContentHash) {
    return false;
  }
  return project.lastSyncContentHash !== computeSecretsHash(secrets);
}
