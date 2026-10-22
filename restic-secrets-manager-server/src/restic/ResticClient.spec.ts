import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Project } from "../model/Project";
import {
  CONNECTION_TEST_TIMEOUT_MS,
  defaultResticRunner,
  isRepoNotInitialized,
  latestSnapshot,
  parseBackupSnapshotId,
  ResticClient,
  ResticCommandResult,
  ResticRunner,
  ResticSnapshot,
  sanitizePusherTag,
  sanitizeResticError,
} from "./ResticClient";
import { ResticSyncError } from "./ResticErrors";
import { DEFAULT_RESTIC_TIMEOUTS, ResticTimeouts } from "./ResticTimeouts";

function makeProject(): Project {
  const project = new Project();
  project.name = "Test";
  project.s3Endpoint = "s3.example.com";
  project.s3Bucket = "bucket";
  project.repoPrefix = "prefix";
  project.s3Region = "eu-west-1";
  project.s3BucketLookup = "dns";
  project.s3AccessKeyId = "key-id";
  project.s3SecretAccessKey = "secret-key";
  project.resticPassword = "repo-password";
  return project;
}

function result(overrides: Partial<ResticCommandResult>): ResticCommandResult {
  return { code: 0, stdout: "", stderr: "", ...overrides };
}

const TEST_TIMEOUTS: ResticTimeouts = {
  snapshotsMs: 11,
  restoreMs: 22,
  backupMs: 33,
  initMs: 44,
  connectionTestMs: 55,
  killGraceMs: 66,
};

interface CapturedCall {
  args: string[];
  cwd?: string;
  options?: unknown;
}

/** Runner that records the invocation options and returns the given result. */
function capturingRunner(
  captured: CapturedCall[],
  response: Partial<ResticCommandResult> = { stdout: "[]" },
): ResticRunner {
  return async (_command, args, _env, cwd, options) => {
    captured.push({ args, cwd, options });
    return result(response);
  };
}

describe("ResticClient env", () => {
  it("should pass credentials via environment variables", () => {
    const client = new ResticClient(makeProject());
    const env = client.env();
    expect(env.AWS_ACCESS_KEY_ID).toBe("key-id");
    expect(env.AWS_SECRET_ACCESS_KEY).toBe("secret-key");
    expect(env.RESTIC_PASSWORD).toBe("repo-password");
    expect(env.RESTIC_REPOSITORY).toBe(
      "s3:https://s3.example.com/bucket/prefix",
    );
  });
});

describe("ResticClient baseArgs", () => {
  it("should include the repository and the bucket lookup option", () => {
    const client = new ResticClient(makeProject());
    expect(client.baseArgs()).toEqual([
      "-r",
      "s3:https://s3.example.com/bucket/prefix",
      "-o",
      "s3.bucket-lookup=dns",
      "-o",
      "s3.region=eu-west-1",
    ]);
  });

  it("should omit the region option when not set", () => {
    const project = makeProject();
    project.s3Region = "";
    const client = new ResticClient(project);
    expect(client.baseArgs()).toEqual([
      "-r",
      "s3:https://s3.example.com/bucket/prefix",
      "-o",
      "s3.bucket-lookup=dns",
    ]);
  });
});

describe("ResticClient repoInitialized", () => {
  it("should return true when snapshots succeeds", async () => {
    const runner: ResticRunner = async () => result({ stdout: "[]" });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.repoInitialized()).toBe(true);
  });

  it("should return false when the repository is not initialized", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 10, stderr: "Fatal: unable to open config file" });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.repoInitialized()).toBe(false);
  });

  it("should throw on unexpected failures", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 1, stderr: "access denied" });
    const client = new ResticClient(makeProject(), runner);
    await expect(client.repoInitialized()).rejects.toThrow("access denied");
  });
});

describe("ResticClient snapshots", () => {
  it("should parse the snapshots json output", async () => {
    const snapshots: ResticSnapshot[] = [
      { id: "aaaaaaaaaa", time: "2026-01-01T10:00:00Z" },
      { id: "bbbbbbbbbb", time: "2026-02-01T10:00:00Z" },
    ];
    const runner: ResticRunner = async () =>
      result({ stdout: JSON.stringify(snapshots) });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.snapshots()).toEqual(snapshots);
  });

  it("should return [] when the repository is not initialized", async () => {
    const runner: ResticRunner = async () => result({ code: 10 });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.snapshots()).toEqual([]);
  });

  it("should throw when the output cannot be parsed", async () => {
    const runner: ResticRunner = async () => result({ stdout: "not json" });
    const client = new ResticClient(makeProject(), runner);
    await expect(client.snapshots()).rejects.toThrow(
      "Unable to parse restic snapshots output",
    );
  });
});

describe("ResticClient backup", () => {
  it("should back up the directory with the manager tag and --json", async () => {
    const captured: { args: string[]; cwd?: string }[] = [];
    const runner: ResticRunner = async (_command, args, _env, cwd) => {
      captured.push({ args, cwd });
      return result({ stdout: "snapshot saved" });
    };
    const client = new ResticClient(makeProject(), runner);
    await client.backup("/tmp/secrets");
    expect(captured.length).toBe(1);
    expect(captured[0].cwd).toBe("/tmp/secrets");
    expect(captured[0].args.slice(-7)).toEqual([
      "backup",
      "--group-by",
      "paths",
      "--tag",
      "restic-secrets-manager",
      "--json",
      ".",
    ]);
  });

  it("should return the snapshot id of the json summary line", async () => {
    const stdout = [
      JSON.stringify({ message_type: "status", percent_done: 0.5 }),
      JSON.stringify({
        message_type: "summary",
        files_new: 1,
        snapshot_id: "abc123def456",
      }),
    ].join("\n");
    const runner: ResticRunner = async () => result({ stdout });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.backup("/tmp/secrets")).toBe("abc123def456");
  });

  it("should return null when the summary line carries no snapshot id", async () => {
    const runner: ResticRunner = async () =>
      result({ stdout: JSON.stringify({ message_type: "summary" }) });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.backup("/tmp/secrets")).toBeNull();
  });

  it("should throw a safe error message on failure", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 1, stderr: "lock failed" });
    const client = new ResticClient(makeProject(), runner);
    await expect(client.backup("/tmp/secrets")).rejects.toThrow(
      "Unable to push secrets to the restic repository: lock failed",
    );
  });

  it("should tag the snapshot with the pushing user", async () => {
    const captured: { args: string[] }[] = [];
    const runner: ResticRunner = async (_command, args) => {
      captured.push({ args });
      return result({ stdout: "snapshot saved" });
    };
    const client = new ResticClient(makeProject(), runner);
    await client.backup("/tmp/secrets", "alice");
    expect(captured[0].args.slice(-9)).toEqual([
      "backup",
      "--group-by",
      "paths",
      "--tag",
      "restic-secrets-manager",
      "--tag",
      "pushed-by:alice",
      "--json",
      ".",
    ]);
  });

  it("should sanitize the pushing user tag", async () => {
    const captured: { args: string[] }[] = [];
    const runner: ResticRunner = async (_command, args) => {
      captured.push({ args });
      return result({ stdout: "snapshot saved" });
    };
    const client = new ResticClient(makeProject(), runner);
    await client.backup("/tmp/secrets", "alice smith, jr\n");
    expect(captured[0].args).toContain("pushed-by:alice-smith-jr");
  });

  it("should add no pusher tag when the user sanitizes to an empty tag", async () => {
    const captured: { args: string[] }[] = [];
    const runner: ResticRunner = async (_command, args) => {
      captured.push({ args });
      return result({ stdout: "snapshot saved" });
    };
    const client = new ResticClient(makeProject(), runner);
    await client.backup("/tmp/secrets", " , ");
    expect(captured[0].args.join(" ")).not.toContain("pushed-by:");
  });
});

describe("sanitizePusherTag", () => {
  it("should return an empty tag for an undefined or empty user", () => {
    expect(sanitizePusherTag(undefined)).toBe("");
    expect(sanitizePusherTag("")).toBe("");
  });

  it("should keep a plain user name untouched", () => {
    expect(sanitizePusherTag("alice")).toBe("alice");
    expect(sanitizePusherTag("alice.smith-2")).toBe("alice.smith-2");
  });

  it("should replace whitespace, commas and control characters with dashes", () => {
    expect(sanitizePusherTag("alice bob,carol")).toBe("alice-bob-carol");
    expect(sanitizePusherTag("  alice  ")).toBe("alice");
    expect(sanitizePusherTag("alice\nsmith")).toBe("alice-smith");
    expect(sanitizePusherTag("alice\u0000smith")).toBe("alice-smith");
  });

  it("should cap the tag to 100 characters without trailing dash", () => {
    const tag = sanitizePusherTag("a".repeat(120));
    expect(tag).toHaveLength(100);
    expect(tag).toBe("a".repeat(100));
    const dashed = sanitizePusherTag(`${"a".repeat(99)}-`);
    expect(dashed).toHaveLength(99);
  });
});

describe("sanitizeResticError", () => {
  it("should keep the last 10 lines of the output", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line-${i + 1}`);
    const message = sanitizeResticError(
      result({ code: 1, stderr: lines.join("\n") }),
    );
    expect(message).toContain("line-15");
    expect(message).toContain("line-6");
    expect(message).not.toContain("line-5");
  });

  it("should cap the message to 1000 characters", () => {
    const message = sanitizeResticError(
      result({ code: 1, stderr: "x".repeat(2000) }),
    );
    expect(message).toHaveLength(1000);
  });

  it("should report the exit code when there is no output", () => {
    expect(sanitizeResticError(result({ code: 3 }))).toBe(
      "restic exited with code 3",
    );
  });
});

describe("ResticClient init", () => {
  it("should succeed on a normal init", async () => {
    const runner: ResticRunner = async () => result({ stdout: "created" });
    const client = new ResticClient(makeProject(), runner);
    await expect(client.init()).resolves.toBeUndefined();
  });

  it("should tolerate an already initialized repository", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 1, stderr: "a repository already exists" });
    const client = new ResticClient(makeProject(), runner);
    await expect(client.init()).resolves.toBeUndefined();
  });

  it("should throw on other failures", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 1, stderr: "connection refused" });
    const client = new ResticClient(makeProject(), runner);
    await expect(client.init()).rejects.toThrow("connection refused");
  });
});

describe("ResticClient restore", () => {
  it("should restore the given snapshot into the target directory", async () => {
    const captured: { args: string[] }[] = [];
    const runner: ResticRunner = async (_command, args) => {
      captured.push({ args });
      return result({ stdout: "restored" });
    };
    const client = new ResticClient(makeProject(), runner);
    await client.restore("abcd1234", "/tmp/restore");
    expect(captured.length).toBe(1);
    expect(captured[0].args.slice(-4)).toEqual([
      "restore",
      "abcd1234",
      "--target",
      "/tmp/restore",
    ]);
  });

  it("should throw a safe error message on failure", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 1, stderr: "no snapshot" });
    const client = new ResticClient(makeProject(), runner);
    await expect(client.restore("abcd1234", "/tmp/restore")).rejects.toThrow(
      "Unable to restore secrets from the restic repository: no snapshot",
    );
  });
});

describe("ResticClient snapshot lookup", () => {
  it("should return the matching snapshot", async () => {
    const snapshots: ResticSnapshot[] = [
      { id: "aaaaaaaaaa", time: "2026-01-01T10:00:00Z" },
    ];
    const captured: CapturedCall[] = [];
    const client = new ResticClient(
      makeProject(),
      capturingRunner(captured, { stdout: JSON.stringify(snapshots) }),
    );
    expect(await client.snapshot("aaaaaaaaaa")).toEqual(snapshots[0]);
    expect(captured[0].args.slice(-3)).toEqual([
      "snapshots",
      "aaaaaaaaaa",
      "--json",
    ]);
  });

  it("should return null when restic does not know the id", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 1, stderr: "no matching ID found" });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.snapshot("unknown")).toBeNull();
  });
});

describe("ResticClient operation timeouts", () => {
  function clientWith(runner: ResticRunner): ResticClient {
    return new ResticClient(makeProject(), runner, TEST_TIMEOUTS);
  }

  it("should bound snapshots, repo check and snapshot lookup by the snapshots timeout", async () => {
    const captured: CapturedCall[] = [];
    const client = clientWith(
      capturingRunner(captured, { stdout: "[]" }),
    );
    await client.snapshots();
    await client.repoInitialized();
    await client.snapshot("aaaaaaaaaa");

    for (const call of captured) {
      expect(call.options).toEqual({
        timeoutMs: TEST_TIMEOUTS.snapshotsMs,
        killGraceMs: TEST_TIMEOUTS.killGraceMs,
        signal: undefined,
      });
    }
  });

  it("should bound init by the init timeout", async () => {
    const captured: CapturedCall[] = [];
    await clientWith(capturingRunner(captured, { stdout: "created" })).init();
    expect((captured[0].options as any).timeoutMs).toBe(
      TEST_TIMEOUTS.initMs,
    );
  });

  it("should bound restore by the restore timeout", async () => {
    const captured: CapturedCall[] = [];
    await clientWith(
      capturingRunner(captured, { stdout: "restored" }),
    ).restore("abcd1234", "/tmp/restore");
    expect((captured[0].options as any).timeoutMs).toBe(
      TEST_TIMEOUTS.restoreMs,
    );
  });

  it("should bound backup by the backup timeout", async () => {
    const captured: CapturedCall[] = [];
    await clientWith(capturingRunner(captured)).backup("/tmp/secrets");
    expect((captured[0].options as any).timeoutMs).toBe(
      TEST_TIMEOUTS.backupMs,
    );
  });

  it("should bound the connection test by its own timeout", async () => {
    const captured: CapturedCall[] = [];
    await clientWith(capturingRunner(captured)).testConnection();
    expect((captured[0].options as any).timeoutMs).toBe(
      TEST_TIMEOUTS.connectionTestMs,
    );
  });

  it("should pass the client abort signal to every invocation", async () => {
    const controller = new AbortController();
    const captured: CapturedCall[] = [];
    const client = new ResticClient(
      makeProject(),
      capturingRunner(captured),
      TEST_TIMEOUTS,
      controller.signal,
    );
    await client.snapshots();
    expect((captured[0].options as any).signal).toBe(controller.signal);
  });

  it("should map a timeout to a 504 sync error", async () => {
    const runner: ResticRunner = async () => result({ timedOut: true });
    const client = clientWith(runner);
    try {
      await client.snapshots();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(504);
      expect((e as Error).message).toContain("timed out after");
      expect((e as Error).message).toContain("snapshot listing");
    }
  });

  it("should map an abort to a 499 sync error", async () => {
    const runner: ResticRunner = async () => result({ aborted: true });
    const client = clientWith(runner);
    try {
      await client.restore("abcd1234", "/tmp/restore");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(499);
    }
  });

  it("should default to the built-in timeouts", async () => {
    const captured: CapturedCall[] = [];
    const client = new ResticClient(makeProject(), capturingRunner(captured));
    await client.snapshots();
    expect((captured[0].options as any).timeoutMs).toBe(
      DEFAULT_RESTIC_TIMEOUTS.snapshotsMs,
    );
  });
});

describe("defaultResticRunner process control", () => {
  const hangingScript = (pidFile: string) => `
    process.on("SIGTERM", () => {});
    require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    setInterval(() => {}, 1000);
  `;

  it("should SIGKILL a process ignoring SIGTERM and leave no orphan", async () => {
    const pidFile = path.join(
      os.tmpdir(),
      `rsm-restic-hang-${Date.now()}-${Math.random()}.pid`,
    );
    const startedAt = Date.now();
    try {
      const outcome = await defaultResticRunner(
        process.execPath,
        ["-e", hangingScript(pidFile)],
        process.env,
        undefined,
        { timeoutMs: 500, killGraceMs: 200 },
      );
      expect(outcome.timedOut).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(5_000);

      const pid = Number(await fse.readFile(pidFile, "utf-8"));
      expect(Number.isInteger(pid)).toBe(true);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await fse.remove(pidFile);
    }
  });

  it("should kill the process when the abort signal fires", async () => {
    const pidFile = path.join(
      os.tmpdir(),
      `rsm-restic-abort-${Date.now()}-${Math.random()}.pid`,
    );
    const controller = new AbortController();
    try {
      const pending = defaultResticRunner(
        process.execPath,
        ["-e", hangingScript(pidFile)],
        process.env,
        undefined,
        { timeoutMs: 10_000, killGraceMs: 200, signal: controller.signal },
      );
      setTimeout(() => controller.abort(), 500);
      const outcome = await pending;
      expect(outcome.aborted).toBe(true);

      const pid = Number(await fse.readFile(pidFile, "utf-8"));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await fse.remove(pidFile);
    }
  });
});

describe("parseBackupSnapshotId", () => {
  it("should extract the summary snapshot id", () => {
    const stdout = [
      JSON.stringify({ message_type: "status", percent_done: 1 }),
      JSON.stringify({ message_type: "summary", snapshot_id: "abc123" }),
    ].join("\n");
    expect(parseBackupSnapshotId(stdout)).toBe("abc123");
  });

  it("should return null when there is no summary id", () => {
    expect(parseBackupSnapshotId("")).toBeNull();
    expect(parseBackupSnapshotId("not json")).toBeNull();
    expect(
      parseBackupSnapshotId(
        JSON.stringify({ message_type: "summary", snapshot_id: "" }),
      ),
    ).toBeNull();
  });
});

describe("ResticClient testConnection", () => {
  it("should report an empty repository", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 10, stderr: "Fatal: unable to open config file" });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.testConnection()).toEqual({ status: "empty" });
  });

  it("should report the snapshot count and latest snapshot time", async () => {
    const snapshots: ResticSnapshot[] = [
      { id: "aaaaaaaaaa", time: "2026-01-01T10:00:00Z" },
      { id: "bbbbbbbbbb", time: "2026-02-01T10:00:00Z" },
    ];
    const runner: ResticRunner = async () =>
      result({ stdout: JSON.stringify(snapshots) });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.testConnection()).toEqual({
      status: "ok",
      snapshotCount: 2,
      latestSnapshotTime: "2026-02-01T10:00:00Z",
    });
  });

  it("should report a single snapshot without pluralization", async () => {
    const snapshots: ResticSnapshot[] = [
      { id: "aaaaaaaaaa", time: "2026-01-01T10:00:00Z" },
    ];
    const runner: ResticRunner = async () =>
      result({ stdout: JSON.stringify(snapshots) });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.testConnection()).toEqual({
      status: "ok",
      snapshotCount: 1,
      latestSnapshotTime: "2026-01-01T10:00:00Z",
    });
  });

  it("should report a sanitized error on credential failure", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 1, stderr: "unable to access bucket: access denied" });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.testConnection()).toEqual({
      status: "error",
      message: "unable to access bucket: access denied",
    });
  });

  it("should report a timeout as an error", async () => {
    const runner: ResticRunner = async () => result({ timedOut: true });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.testConnection()).toEqual({
      status: "error",
      message:
        "The connection test timed out after 30 seconds: the endpoint may be unreachable",
    });
  });

  it("should report an unparsable snapshots output as an error", async () => {
    const runner: ResticRunner = async () => result({ stdout: "not json" });
    const client = new ResticClient(makeProject(), runner);
    expect(await client.testConnection()).toEqual({
      status: "error",
      message: "Unable to parse restic snapshots output",
    });
  });

  it("should invoke snapshots with the connection test timeout", async () => {
    const captured: { args: string[]; options?: unknown }[] = [];
    const runner: ResticRunner = async (_command, args, _env, _cwd, options) => {
      captured.push({ args, options });
      return result({ stdout: "[]" });
    };
    const client = new ResticClient(makeProject(), runner);
    await client.testConnection();
    expect(captured.length).toBe(1);
    expect(captured[0].args.slice(-2)).toEqual(["snapshots", "--json"]);
    expect(captured[0].options).toEqual({
      timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
      killGraceMs: DEFAULT_RESTIC_TIMEOUTS.killGraceMs,
      signal: undefined,
    });
    expect(CONNECTION_TEST_TIMEOUT_MS).toBe(30_000);
  });
});

describe("latestSnapshot", () => {
  it("should return null for an empty list", () => {
    expect(latestSnapshot([])).toBeNull();
  });

  it("should return the most recent snapshot", () => {
    const snapshots = [
      { id: "aaaa", time: "2026-01-01T10:00:00Z" },
      { id: "cccc", time: "2026-03-01T10:00:00Z" },
      { id: "bbbb", time: "2026-02-01T10:00:00Z" },
    ];
    expect(latestSnapshot(snapshots)?.id).toBe("cccc");
  });
});

describe("isRepoNotInitialized", () => {
  it("should detect exit code 10", () => {
    expect(isRepoNotInitialized(result({ code: 10 }))).toBe(true);
  });

  it("should detect the config file error message", () => {
    expect(
      isRepoNotInitialized(
        result({ code: 1, stderr: "Fatal: unable to open config file" }),
      ),
    ).toBe(true);
  });

  it("should not match other errors", () => {
    expect(isRepoNotInitialized(result({ code: 1, stderr: "denied" }))).toBe(
      false,
    );
  });
});
