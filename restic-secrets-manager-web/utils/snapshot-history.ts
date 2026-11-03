/** Snapshots requested per history page (server caps the value at 200). */
export const SNAPSHOT_HISTORY_PAGE_SIZE = 50;

export interface SnapshotPageParams {
  limit: number;
  before?: string;
}

export interface SnapshotHistoryPage<T> {
  snapshots: T[];
  hasMore: boolean;
  nextBefore: string | null;
}

/** Query parameters of the next snapshot history page. */
export function snapshotHistoryParams(
  before?: string | null,
): SnapshotPageParams {
  const params: SnapshotPageParams = { limit: SNAPSHOT_HISTORY_PAGE_SIZE };
  if (before) {
    params.before = before;
  }
  return params;
}

/**
 * Appends one page to the loaded history without duplicates, preserving the
 * server order (most recent first). Also carries the page's `hasMore` and
 * `nextBefore` so the modal knows whether an older page exists.
 */
export function mergeSnapshotPages<T extends { id: string }>(
  current: T[],
  incoming: T[] | null | undefined,
  hasMore = false,
  nextBefore: string | null = null,
): SnapshotHistoryPage<T> {
  const snapshots = [...current];
  const seen = new Set(snapshots.map((snapshot) => snapshot.id));
  for (const snapshot of incoming || []) {
    if (!seen.has(snapshot.id)) {
      seen.add(snapshot.id);
      snapshots.push(snapshot);
    }
  }
  return {
    snapshots,
    hasMore: Boolean(hasMore),
    nextBefore: nextBefore || null,
  };
}
