import type { Span } from "@opentelemetry/sdk-trace";
import { DbUtilsWithLock } from "../utils-std-ts/DbUtils";
import {
  ProjectWriteLockName,
  ProjectWriteLocksRun,
  SyncQueueRun,
} from "./SyncLocks";

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsWithLock: jest.fn(
    (_lock: string, task: () => Promise<unknown>) => task(),
  ),
}));

const dbLockMock = DbUtilsWithLock as jest.Mock;

describe("SyncQueueRun", () => {
  it("should run the task without taking a database lock", async () => {
    const task = jest.fn().mockResolvedValue("ok");

    await expect(SyncQueueRun("project-42", task)).resolves.toBe("ok");

    expect(task).toHaveBeenCalledTimes(1);
    expect(dbLockMock).not.toHaveBeenCalled();
  });

  it("should run tasks of the same project strictly in order", async () => {
    const events: string[] = [];
    const first = SyncQueueRun("p1", async () => {
      events.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("a-end");
      return "a";
    });
    const second = SyncQueueRun("p1", async () => {
      events.push("b-start");
      events.push("b-end");
      return "b";
    });

    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("b");
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("should not poison the chain when a task rejects", async () => {
    const failing = SyncQueueRun("p2", async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");

    await expect(SyncQueueRun("p2", async () => "ok")).resolves.toBe("ok");
  });

  it("should run tasks of different projects concurrently", async () => {
    let running = 0;
    let maxRunning = 0;
    const makeTask = () => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
    };

    await Promise.all([
      SyncQueueRun("p3", makeTask()),
      SyncQueueRun("p4", makeTask()),
    ]);
    expect(maxRunning).toBe(2);
  });

  it("should serialize a burst of tasks per project", async () => {
    const order: number[] = [];
    const tasks = [1, 2, 3, 4].map((n) =>
      SyncQueueRun("p5", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(n);
      }),
    );
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});

describe("ProjectWriteLocksRun", () => {
  beforeEach(() => {
    dbLockMock.mockClear();
  });

  it("should run the task under the project-write advisory lock", async () => {
    const context = { name: "test" } as unknown as Span;
    const task = jest.fn().mockResolvedValue("ok");

    await expect(
      ProjectWriteLocksRun("project-42", task, context),
    ).resolves.toBe("ok");

    expect(dbLockMock).toHaveBeenCalledTimes(1);
    expect(dbLockMock).toHaveBeenCalledWith(
      "restic-secrets-manager:project-write:project-42",
      task,
      context,
    );
  });

  it("should use a deterministic lock name per project", () => {
    expect(ProjectWriteLockName("p1")).toBe(
      "restic-secrets-manager:project-write:p1",
    );
    expect(ProjectWriteLockName("p1")).not.toBe(ProjectWriteLockName("p2"));
  });

  it("should serialize write sections of the same project", async () => {
    const events: string[] = [];
    const first = ProjectWriteLocksRun("p6", async () => {
      events.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 15));
      events.push("a-end");
    });
    const second = ProjectWriteLocksRun("p6", async () => {
      events.push("b-start");
      events.push("b-end");
    });

    await Promise.all([first, second]);
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("should not poison the write chain when a task rejects", async () => {
    await expect(
      ProjectWriteLocksRun("p7", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(
      ProjectWriteLocksRun("p7", async () => "ok"),
    ).resolves.toBe("ok");
  });
});