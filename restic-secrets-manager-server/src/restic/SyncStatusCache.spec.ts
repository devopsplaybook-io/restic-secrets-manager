import { Span } from "@opentelemetry/sdk-trace-base";
import { Project } from "../model/Project";
import { SyncStatusResult } from "./SyncService";
import {
  SyncStatusCacheGet,
  SyncStatusCacheInvalidate,
} from "./SyncStatusCache";

function makeProject(id: string): Project {
  const project = new Project();
  project.id = id;
  project.name = id;
  return project;
}

function result(): SyncStatusResult {
  return {
    hasLocalChanges: false,
    lastSyncSnapshotId: "",
    lastSyncSnapshotTime: "",
    remoteLatestSnapshotId: "",
    remoteLatestSnapshotTime: "",
    needsPull: false,
  };
}

const context = { name: "test" } as unknown as Span;

type StatusRunner = (
  context: Span,
  project: Project,
) => Promise<SyncStatusResult>;

describe("SyncStatusCacheGet", () => {
  it("should serve the cached result within the TTL", async () => {
    const runner = jest.fn().mockResolvedValue(result());
    const project = makeProject("cache-ttl");

    await SyncStatusCacheGet(context, project, runner as StatusRunner);
    await SyncStatusCacheGet(context, project, runner as StatusRunner);

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("should re-run the status after the TTL expires", async () => {
    jest.useFakeTimers();
    try {
      const runner = jest.fn().mockResolvedValue(result());
      const project = makeProject("cache-expiry");

      await SyncStatusCacheGet(context, project, runner as StatusRunner);
      jest.advanceTimersByTime(30_001);
      await SyncStatusCacheGet(context, project, runner as StatusRunner);

      expect(runner).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("should share one run between concurrent requests of the same project", async () => {
    const runner = jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return result();
    });
    const project = makeProject("cache-dedupe");

    const [first, second] = await Promise.all([
      SyncStatusCacheGet(context, project, runner as StatusRunner),
      SyncStatusCacheGet(context, project, runner as StatusRunner),
    ]);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("should cap the concurrent status runs", async () => {
    let active = 0;
    let maxActive = 0;
    const runner = jest.fn().mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return result();
    });
    const projects = [1, 2, 3, 4, 5].map((n) => makeProject(`cache-cap-${n}`));

    await Promise.all(
      projects.map((project) =>
        SyncStatusCacheGet(context, project, runner as StatusRunner),
      ),
    );

    expect(runner).toHaveBeenCalledTimes(5);
    expect(maxActive).toBe(3);
  });

  it("should re-run the status after an invalidation", async () => {
    const runner = jest.fn().mockResolvedValue(result());
    const project = makeProject("cache-invalidate");

    await SyncStatusCacheGet(context, project, runner as StatusRunner);
    SyncStatusCacheInvalidate(project.id);
    await SyncStatusCacheGet(context, project, runner as StatusRunner);

    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("should not cache failures", async () => {
    const runner = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(result());
    const project = makeProject("cache-error");

    await expect(
      SyncStatusCacheGet(context, project, runner as StatusRunner),
    ).rejects.toThrow("boom");
    await expect(
      SyncStatusCacheGet(context, project, runner as StatusRunner),
    ).resolves.toMatchObject({ needsPull: false });
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
