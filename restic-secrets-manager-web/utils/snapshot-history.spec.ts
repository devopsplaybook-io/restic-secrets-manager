import { describe, expect, it } from "vitest";
import {
  mergeSnapshotPages,
  SNAPSHOT_HISTORY_PAGE_SIZE,
  snapshotHistoryParams,
} from "./snapshot-history";

function snapshot(id: string) {
  return { id, time: "2026-01-01T00:00:00Z" };
}

describe("snapshotHistoryParams", () => {
  it("should request the default page size", () => {
    expect(SNAPSHOT_HISTORY_PAGE_SIZE).toBe(50);
    expect(snapshotHistoryParams()).toEqual({ limit: 50 });
    expect(snapshotHistoryParams(null)).toEqual({ limit: 50 });
    expect(snapshotHistoryParams("")).toEqual({ limit: 50 });
  });

  it("should add the before cursor when provided", () => {
    expect(snapshotHistoryParams("snap-49")).toEqual({
      limit: 50,
      before: "snap-49",
    });
  });
});

describe("mergeSnapshotPages", () => {
  it("should append pages preserving the server order", () => {
    const page = mergeSnapshotPages(
      [snapshot("a"), snapshot("b")],
      [snapshot("c"), snapshot("d")],
      true,
      "d",
    );
    expect(page.snapshots.map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("should deduplicate by id when a page overlaps", () => {
    const page = mergeSnapshotPages(
      [snapshot("a"), snapshot("b"), snapshot("c")],
      [snapshot("c"), snapshot("d"), snapshot("b")],
      false,
      null,
    );
    expect(page.snapshots.map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("should propagate hasMore and nextBefore", () => {
    const page = mergeSnapshotPages([snapshot("a")], [snapshot("b")], true, "b");
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toBe("b");
    const last = mergeSnapshotPages(page.snapshots, [], false, null);
    expect(last.hasMore).toBe(false);
    expect(last.nextBefore).toBeNull();
  });

  it("should tolerate a missing snapshot list", () => {
    const page = mergeSnapshotPages([snapshot("a")], undefined, undefined, undefined);
    expect(page.snapshots).toEqual([snapshot("a")]);
    expect(page.hasMore).toBe(false);
    expect(page.nextBefore).toBeNull();
  });
});
