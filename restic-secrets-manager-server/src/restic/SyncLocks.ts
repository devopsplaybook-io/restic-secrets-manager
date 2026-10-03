const chains = new Map<string, Promise<void>>();

/**
 * Serializes sync operations per project (in-process). The deployment runs
 * a single replica, so an in-process lock is sufficient; with multiple
 * replicas this must move to a DB or restic-level lock. Secret edits made
 * while a sync is queued or running are last-writer-wins: they are not
 * blocked by this lock.
 */
export function SyncLocksRun<T>(
  projectId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = chains.get(projectId) ?? Promise.resolve();
  const result = previous.then(() => task());
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
