import type { Span } from "@opentelemetry/sdk-trace";
import { DbUtilsWithLock } from "../utils-std-ts/DbUtils";
import { SyncLocksRun } from "./SyncLocks";

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsWithLock: jest.fn(
    (_lock: string, task: () => Promise<unknown>) => task(),
  ),
}));

const dbLockMock = DbUtilsWithLock as jest.Mock;

describe("SyncLocksRun", () => {
  it("should run the task under the per-project database advisory lock", async () => {
    const context = { name: "test" } as unknown as Span;
    const task = jest.fn().mockResolvedValue("ok");

    await expect(SyncLocksRun("project-42", task, context)).resolves.toBe("ok");

    expect(dbLockMock).toHaveBeenCalledWith(
      "restic-secrets-manager:project-sync:project-42",
      task,
      context,
    );
  });

  it("should run tasks of the same project strictly in order", async () => {
    const events: string[] = [];
    const first = SyncLocksRun("p1", async () => {
      events.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("a-end");
      return "a";
    });
    const second = SyncLocksRun("p1", async () => {
      events.push("b-start");
      events.push("b-end");
      return "b";
    });

    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("b");
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("should not poison the chain when a task rejects", async () => {
    const failing = SyncLocksRun("p2", async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");

    await expect(SyncLocksRun("p2", async () => "ok")).resolves.toBe("ok");
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
      SyncLocksRun("p3", makeTask()),
      SyncLocksRun("p4", makeTask()),
    ]);
    expect(maxRunning).toBe(2);
  });

  it("should serialize a burst of tasks per project", async () => {
    const order: number[] = [];
    const tasks = [1, 2, 3, 4].map((n) =>
      SyncLocksRun("p5", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(n);
      }),
    );
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
