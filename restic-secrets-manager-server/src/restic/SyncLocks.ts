import type { Span } from "@opentelemetry/sdk-trace";
import { DbUtilsWithLock } from "../utils-std-ts/DbUtils";

/**
 * Serialization of project operations is split in two mechanisms so that a
 * database advisory lock is never held across a multi-minute restic
 * restore or backup:
 *
 * - `SyncQueueRun` keeps the whole synchronization operations (pull, push,
 *   restore, discard and their previews) of one project ordered inside this
 *   process. It takes no database lock: replicas are only ordered by the
 *   short write lock below.
 * - `ProjectWriteLocksRun` serializes the short database-visible sections
 *   (the replace transaction and its sync state, the push state write, a
 *   secret edit, a project deletion and the compare-and-swap check). It is
 *   an in-process chain plus a PostgreSQL advisory lock per project, so
 *   write sections of every replica are mutually exclusive.
 *
 * Secret edits therefore can no longer be silently overwritten by a
 * concurrent pull/restore: both take the write lock, and the confirmation
 * token comparison happens under it. Never nest a `ProjectWriteLocksRun`
 * inside another one.
 */

const syncChains = new Map<string, Promise<void>>();
const writeChains = new Map<string, Promise<void>>();

/**
 * Advisory-lock name of a project's write section. The name is
 * deterministic so every replica of the service serialises on the same
 * PostgreSQL advisory lock (SQLite runs the callback directly).
 */
export function ProjectWriteLockName(projectId: string): string {
  return `restic-secrets-manager:project-write:${projectId}`;
}

function runInChain<T>(
  chains: Map<string, Promise<void>>,
  projectId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = chains.get(projectId) ?? Promise.resolve();
  const result = previous.then(task);
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

/** Orders whole sync/preview operations of one project (in-process only). */
export function SyncQueueRun<T>(
  projectId: string,
  task: () => Promise<T>,
): Promise<T> {
  return runInChain(syncChains, projectId, task);
}

/**
 * Serializes a short database-visible write section of one project: an
 * in-process promise chain plus a PostgreSQL advisory lock across replicas.
 * Held only around DB work, never across restic I/O.
 */
export function ProjectWriteLocksRun<T>(
  projectId: string,
  task: () => Promise<T>,
  context?: Span,
): Promise<T> {
  return runInChain(writeChains, projectId, () =>
    DbUtilsWithLock(ProjectWriteLockName(projectId), task, context),
  );
}
