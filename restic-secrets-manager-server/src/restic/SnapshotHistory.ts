import { ResticSyncError } from "./ResticErrors";
import type { SnapshotInfo } from "./SyncService";

/** Page size served by the snapshot history endpoint. */
export const SNAPSHOT_HISTORY_DEFAULT_LIMIT = 50;
export const SNAPSHOT_HISTORY_MAX_LIMIT = 200;

export interface SnapshotPageQuery {
  limit?: unknown;
  before?: unknown;
}

export interface SnapshotPageRequest {
  limit: number;
  before?: string;
}

export interface SnapshotPage {
  snapshots: SnapshotInfo[];
  hasMore: boolean;
  /** Cursor for the next (older) page: the last id of this page. */
  nextBefore: string | null;
}

function invalidLimit(): ResticSyncError {
  return new ResticSyncError(
    `limit must be a positive integer (default ${SNAPSHOT_HISTORY_DEFAULT_LIMIT}, max ${SNAPSHOT_HISTORY_MAX_LIMIT})`,
    400,
    "INVALID_SNAPSHOT_LIMIT",
  );
}

/**
 * Parses the history page query: `limit` defaults to 50, must be a positive
 * integer and is clamped to 200; an empty `before` is treated as absent.
 */
export function parseSnapshotPageQuery(
  query: SnapshotPageQuery = {},
): SnapshotPageRequest {
  let limit = SNAPSHOT_HISTORY_DEFAULT_LIMIT;
  const rawLimit = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  if (rawLimit !== undefined && rawLimit !== null) {
    if (
      typeof rawLimit !== "string" &&
      !(typeof rawLimit === "number" && Number.isFinite(rawLimit))
    ) {
      throw invalidLimit();
    }
    const text = String(rawLimit).trim();
    if (!/^\d+$/.test(text)) {
      throw invalidLimit();
    }
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw invalidLimit();
    }
    limit = Math.min(parsed, SNAPSHOT_HISTORY_MAX_LIMIT);
  }
  const rawBefore = Array.isArray(query.before)
    ? query.before[0]
    : query.before;
  const before =
    typeof rawBefore === "string" && rawBefore.trim().length > 0
      ? rawBefore.trim()
      : undefined;
  return before ? { limit, before } : { limit };
}

/**
 * Slices one page out of the already sorted (most recent first) history.
 * `before` is the full id of the previous page's last snapshot: parsing
 * starts after it, so consecutive pages never duplicate or skip ids. Restic
 * cannot filter the listing itself, so the full list is parsed and paged
 * here (bounded by the snapshot-listing output cap).
 */
export function paginateSnapshotHistory(
  snapshots: SnapshotInfo[],
  limit: number,
  before?: string,
): SnapshotPage {
  let start = 0;
  if (before) {
    const index = snapshots.findIndex((snapshot) => snapshot.id === before);
    if (index < 0) {
      throw new ResticSyncError(
        "Unknown snapshot history cursor: reload the history",
        400,
        "INVALID_SNAPSHOT_CURSOR",
      );
    }
    start = index + 1;
  }
  const page = snapshots.slice(start, start + limit);
  const hasMore = start + page.length < snapshots.length;
  return {
    snapshots: page,
    hasMore,
    nextBefore: hasMore && page.length > 0 ? page[page.length - 1].id : null,
  };
}
