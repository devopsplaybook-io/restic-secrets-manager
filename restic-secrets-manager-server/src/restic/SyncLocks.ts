import type { Span } from "@opentelemetry/sdk-trace";
import { DbUtilsWithLock } from "../utils-std-ts/DbUtils";

const chains = new Map<string, Promise<void>>();

/**
 * Advisory-lock name of a project's synchronization section. The name is
 * deterministic so every replica of the service serialises on the same
 * PostgreSQL advisory lock (SQLite runs the callback directly).
 */
export function SyncLockName(projectId: string): string {
  return `restic-secrets-manager:project-sync:${projectId}`;
}

/**
 * Serializes sync operations per project: an in-process promise chain for
 * this process plus a PostgreSQL advisory lock across replicas. With SQLite
 * the schema is a single file and the deployment must stay single-replica,
 * so the in-process chain is the only serialization. Secret edits made
 * while a sync is queued or running are last-writer-wins: they are not
 * blocked by this lock.
 */
export function SyncLocksRun<T>(
  projectId: string,
  task: () => Promise<T>,
  context?: Span,
): Promise<T> {
  const previous = chains.get(projectId) ?? Promise.resolve();
  const result = previous.then(() =>
    DbUtilsWithLock(SyncLockName(projectId), task, context),
  );
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(projectId, tail);
  void tail.then(() => {
    if (chains.get(projectId) === tail) {
      chains.delete(projectId);
    }
  });
  return result;
}
