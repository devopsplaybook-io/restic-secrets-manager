import { ResticSyncError } from "./ResticErrors";
import {
  paginateSnapshotHistory,
  parseSnapshotPageQuery,
  SNAPSHOT_HISTORY_DEFAULT_LIMIT,
  SNAPSHOT_HISTORY_MAX_LIMIT,
} from "./SnapshotHistory";
import type { SnapshotInfo } from "./SyncService";

function history(count: number): SnapshotInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `snap-${String(index).padStart(4, "0")}`,
    time: new Date(Date.UTC(2026, 0, 1, 0, 0, count - index)).toISOString(),
  }));
}

describe("parseSnapshotPageQuery", () => {
  it("should default to 50", () => {
    expect(parseSnapshotPageQuery()).toEqual({
      limit: SNAPSHOT_HISTORY_DEFAULT_LIMIT,
    });
    expect(SNAPSHOT_HISTORY_DEFAULT_LIMIT).toBe(50);
    expect(SNAPSHOT_HISTORY_MAX_LIMIT).toBe(200);
  });

  it("should accept an explicit positive integer", () => {
    expect(parseSnapshotPageQuery({ limit: "25" })).toEqual({ limit: 25 });
    expect(parseSnapshotPageQuery({ limit: "25", before: "snap-1" })).toEqual({
      limit: 25,
      before: "snap-1",
    });
  });

  it("should clamp a limit above the maximum", () => {
    expect(parseSnapshotPageQuery({ limit: "500" }).limit).toBe(200);
  });

  it("should treat an empty before cursor as absent", () => {
    expect(parseSnapshotPageQuery({ before: "" })).toEqual({ limit: 50 });
    expect(parseSnapshotPageQuery({ before: "   " })).toEqual({ limit: 50 });
  });

  it.each(["0", "-1", "1.5", "abc", ""])(
    "should reject the invalid limit %p",
    (limit) => {
      expect(() => parseSnapshotPageQuery({ limit })).toThrow(ResticSyncError);
      try {
        parseSnapshotPageQuery({ limit });
      } catch (e) {
        expect((e as ResticSyncError).statusCode).toBe(400);
        expect((e as ResticSyncError).code).toBe("INVALID_SNAPSHOT_LIMIT");
      }
    },
  );
});

describe("paginateSnapshotHistory", () => {
  it("should page the sorted history without duplicates or gaps", () => {
    const all = history(120);
    const first = paginateSnapshotHistory(all, 50);
    expect(first.snapshots.map((entry) => entry.id)).toEqual(
      all.slice(0, 50).map((entry) => entry.id),
    );
    expect(first.hasMore).toBe(true);
    expect(first.nextBefore).toBe("snap-0049");

    const second = paginateSnapshotHistory(all, 50, first.nextBefore);
    expect(second.snapshots.map((entry) => entry.id)).toEqual(
      all.slice(50, 100).map((entry) => entry.id),
    );
    expect(second.hasMore).toBe(true);
    expect(second.nextBefore).toBe("snap-0099");

    const third = paginateSnapshotHistory(all, 50, second.nextBefore);
    expect(third.snapshots.map((entry) => entry.id)).toEqual(
      all.slice(100).map((entry) => entry.id),
    );
    expect(third.hasMore).toBe(false);
    expect(third.nextBefore).toBeNull();

    const paged = [
      ...first.snapshots,
      ...second.snapshots,
      ...third.snapshots,
    ].map((entry) => entry.id);
    expect(paged).toEqual(all.map((entry) => entry.id));
    expect(new Set(paged).size).toBe(all.length);
  });

  it("should return an empty page after the last item", () => {
    const all = history(3);
    const page = paginateSnapshotHistory(all, 50, "snap-0002");
    expect(page.snapshots).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextBefore).toBeNull();
  });

  it("should reject an unknown cursor", () => {
    try {
      paginateSnapshotHistory(history(3), 50, "unknown");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(400);
      expect((e as ResticSyncError).code).toBe("INVALID_SNAPSHOT_CURSOR");
    }
  });
});
