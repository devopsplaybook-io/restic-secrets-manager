import type { Span } from "@opentelemetry/sdk-trace";
import { Config } from "../Config";
import { Project } from "../model/Project";
import { ResticSyncError } from "./ResticErrors";
import { SyncStatusResult } from "./SyncService";
import {
  StatusRunner,
  SyncStatusCacheGet,
  SyncStatusCacheInvalidate,
} from "./SyncStatusCache";

function makeProject(id: string): Project {
  const project = new Project();
  project.id = id;
  project.name = id;
  return project;
}

function result(overrides: Partial<SyncStatusResult> = {}): SyncStatusResult {
  return {
    hasLocalChanges: false,
    lastSyncSnapshotId: "",
    lastSyncSnapshotTime: "",
    remoteLatestSnapshotId: "",
    remoteLatestSnapshotTime: "",
    needsPull: false,
    ...overrides,
  };
}

function configFor(overrides: Partial<Config> = {}): Config {
  return { ...overrides } as Config;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const context = { name: "test" } as unknown as Span;

describe("SyncStatusCacheGet", () => {
  it("should serve the cached result within the TTL", async () => {
    const runner = jest.fn().mockResolvedValue(result());
    const project = makeProject("cache-ttl");

    await SyncStatusCacheGet(context, project, configFor(), {
      statusRunner: runner as StatusRunner,
    });
    await SyncStatusCacheGet(context, project, configFor(), {
      statusRunner: runner as StatusRunner,
    });

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("should serve a stale result immediately and refresh it in the background", async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce(result({ remoteLatestSnapshotId: "first" }))
      .mockResolvedValueOnce(result({ remoteLatestSnapshotId: "second" }));
    const project = makeProject("cache-swr");
    const config = configFor({ SYNC_STATUS_CACHE_TTL_MS: 40 });

    const first = await SyncStatusCacheGet(context, project, config, {
      statusRunner: runner as StatusRunner,
    });
    expect(first.remoteLatestSnapshotId).toBe("first");

    await delay(80);
    const stale = await SyncStatusCacheGet(context, project, config, {
      statusRunner: runner as StatusRunner,
    });
    expect(stale.remoteLatestSnapshotId).toBe("first");

    // The background refresh completes and repopulates the cache.
    await delay(10);
    expect(runner).toHaveBeenCalledTimes(2);
    const refreshed = await SyncStatusCacheGet(context, project, config, {
      statusRunner: runner as StatusRunner,
    });
    expect(refreshed.remoteLatestSnapshotId).toBe("second");
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("should read the TTL from the configuration", async () => {
    const runner = jest.fn().mockResolvedValue(result());
    const project = makeProject("cache-config-ttl");
    const config = configFor({ SYNC_STATUS_CACHE_TTL_MS: 5 });

    await SyncStatusCacheGet(context, project, config, {
      statusRunner: runner as StatusRunner,
    });
    await delay(20);
    await SyncStatusCacheGet(context, project, config, {
      statusRunner: runner as StatusRunner,
    });
    await delay(10);

    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("should share one run between concurrent requests of the same project", async () => {
    const runner = jest.fn().mockImplementation(async () => {
      await delay(10);
      return result();
    });
    const project = makeProject("cache-dedupe");

    const [first, second] = await Promise.all([
      SyncStatusCacheGet(context, project, configFor(), {
        statusRunner: runner as StatusRunner,
      }),
      SyncStatusCacheGet(context, project, configFor(), {
        statusRunner: runner as StatusRunner,
      }),
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
      await delay(10);
      active--;
      return result();
    });
    const projects = [1, 2, 3, 4, 5].map((n) =>
      makeProject(`cache-cap-${n}`),
    );

    await Promise.all(
      projects.map((project) =>
        SyncStatusCacheGet(context, project, configFor(), {
          statusRunner: runner as StatusRunner,
        }),
      ),
    );

    expect(runner).toHaveBeenCalledTimes(5);
    expect(maxActive).toBe(3);
  });

  it("should release the concurrency slot of a failed status run", async () => {
    let active = 0;
    let maxActive = 0;
    const runner = jest
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockImplementation(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(10);
        active--;
        return result();
      });

    await expect(
      SyncStatusCacheGet(context, makeProject("cache-slot-failure"), configFor(), {
        statusRunner: runner as StatusRunner,
      }),
    ).rejects.toThrow("timeout");

    // A leaked slot would limit these three runs to two concurrent ones
    const projects = [1, 2, 3].map((n) => makeProject(`cache-slot-${n}`));
    await Promise.all(
      projects.map((project) =>
        SyncStatusCacheGet(context, project, configFor(), {
          statusRunner: runner as StatusRunner,
        }),
      ),
    );

    expect(runner).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(3);
  });

  it("should reject beyond the waiter cap with STATUS_QUEUE_FULL", async () => {
    const runner = jest.fn().mockImplementation(async () => {
      await delay(20);
      return result();
    });
    const config = configFor({ SYNC_STATUS_MAX_WAITERS: 1 });
    const projects = [1, 2, 3, 4, 5].map((n) =>
      makeProject(`cache-queue-${n}`),
    );

    const outcomes = await Promise.allSettled(
      projects.map((project) =>
        SyncStatusCacheGet(context, project, config, {
          statusRunner: runner as StatusRunner,
        }),
      ),
    );

    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      statusCode: 503,
      code: "STATUS_QUEUE_FULL",
    });
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(4);
  });

  it("should reject an already-aborted request without spawning a run", async () => {
    const runner = jest.fn().mockResolvedValue(result());
    const controller = new AbortController();
    controller.abort();

    await expect(
      SyncStatusCacheGet(context, makeProject("cache-aborted-first"), configFor(), {
        signal: controller.signal,
        statusRunner: runner as StatusRunner,
      }),
    ).rejects.toMatchObject({ statusCode: 499 });
    expect(runner).not.toHaveBeenCalled();
  });

  it("should remove a queued run when its client disconnects", async () => {
    const runner = jest.fn().mockImplementation(async () => {
      await delay(30);
      return result();
    });
    const running = [1, 2, 3].map((n) =>
      SyncStatusCacheGet(context, makeProject(`cache-queued-slot-${n}`), configFor(), {
        statusRunner: runner as StatusRunner,
      }),
    );
    const controller = new AbortController();
    const queued = SyncStatusCacheGet(
      context,
      makeProject("cache-queued"),
      configFor(),
      { signal: controller.signal, statusRunner: runner as StatusRunner },
    );
    await delay(5);
    controller.abort();

    await expect(queued).rejects.toMatchObject({ statusCode: 499 });
    await Promise.all(running);
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("should abort a running check on disconnect, free its slot and retry", async () => {
    const controller = new AbortController();
    const runner = jest.fn(
      (_context: Span, _project: Project, signal?: AbortSignal) =>
        new Promise<SyncStatusResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new ResticSyncError("cancelled", 499)),
          );
        }),
    );
    const project = makeProject("cache-abort-running");
    const pending = SyncStatusCacheGet(context, project, configFor(), {
      signal: controller.signal,
      statusRunner: runner as StatusRunner,
    });
    await delay(5);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ statusCode: 499 });
    await delay(5);

    const retryRunner = jest.fn().mockResolvedValue(result());
    await expect(
      SyncStatusCacheGet(context, project, configFor(), {
        statusRunner: retryRunner as StatusRunner,
      }),
    ).resolves.toMatchObject({ needsPull: false });
    expect(retryRunner).toHaveBeenCalledTimes(1);
  });

  it("should re-run the status after an invalidation", async () => {
    const runner = jest.fn().mockResolvedValue(result());
    const project = makeProject("cache-invalidate");

    await SyncStatusCacheGet(context, project, configFor(), {
      statusRunner: runner as StatusRunner,
    });
    SyncStatusCacheInvalidate(project.id);
    await SyncStatusCacheGet(context, project, configFor(), {
      statusRunner: runner as StatusRunner,
    });

    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("should not cache a run invalidated while in flight", async () => {
    let releaseRun: (value: SyncStatusResult) => void = () => {};
    const runner = jest.fn(
      () =>
        new Promise<SyncStatusResult>((resolve) => {
          releaseRun = resolve;
        }),
    );
    const project = makeProject("cache-invalidate-inflight");

    const pending = SyncStatusCacheGet(context, project, configFor(), {
      statusRunner: runner as StatusRunner,
    });
    await delay(5);
    SyncStatusCacheInvalidate(project.id);
    releaseRun(result());
    await expect(pending).resolves.toMatchObject({ needsPull: false });
    await delay(5);

    const retryRunner = jest.fn().mockResolvedValue(result());
    await SyncStatusCacheGet(context, project, configFor(), {
      statusRunner: retryRunner as StatusRunner,
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(retryRunner).toHaveBeenCalledTimes(1);
  });

  it("should not cache failures", async () => {
    const runner = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(result());
    const project = makeProject("cache-error");

    await expect(
      SyncStatusCacheGet(context, project, configFor(), {
        statusRunner: runner as StatusRunner,
      }),
    ).rejects.toThrow("boom");
    await expect(
      SyncStatusCacheGet(context, project, configFor(), {
        statusRunner: runner as StatusRunner,
      }),
    ).resolves.toMatchObject({ needsPull: false });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("should attach a single abort listener when projects share a request signal", async () => {
    const controller = new AbortController();
    const spy = jest.spyOn(controller.signal, "addEventListener");
    const runner = jest.fn().mockResolvedValue(result());
    const projects = Array.from({ length: 12 }, (_, index) =>
      makeProject(`cache-signal-${index}`),
    );

    await Promise.all(
      projects.map((project) =>
        SyncStatusCacheGet(context, project, configFor(), {
          signal: controller.signal,
          statusRunner: runner as StatusRunner,
        }),
      ),
    );

    const abortListeners = spy.mock.calls.filter(([type]) => type === "abort");
    expect(abortListeners).toHaveLength(1);
    spy.mockRestore();
  });
});
