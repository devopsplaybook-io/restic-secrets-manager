import { Project } from "../model/Project";
import {
  isRepoNotInitialized,
  latestSnapshot,
  ResticClient,
  ResticCommandResult,
  ResticRunner,
  ResticSnapshot,
} from "./ResticClient";

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

describe("ResticClient env", () => {
  it("should pass credentials via environment variables", () => {
    const client = new ResticClient(makeProject());
    const env = client.env();
    expect(env.AWS_ACCESS_KEY_ID).toBe("key-id");
    expect(env.AWS_SECRET_ACCESS_KEY).toBe("secret-key");
    expect(env.RESTIC_PASSWORD).toBe("repo-password");
    expect(env.RESTIC_REPOSITORY).toBe("s3:https://s3.example.com/bucket/prefix");
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
  it("should back up the directory with the manager tag", async () => {
    const captured: { args: string[]; cwd?: string }[] = [];
    const runner: ResticRunner = async (_command, args, _env, cwd) => {
      captured.push({ args, cwd });
      return result({ stdout: "snapshot saved" });
    };
    const client = new ResticClient(makeProject(), runner);
    await client.backup("/tmp/secrets");
    expect(captured.length).toBe(1);
    expect(captured[0].cwd).toBe("/tmp/secrets");
    expect(captured[0].args.slice(-6)).toEqual([
      "backup",
      "--group-by",
      "paths",
      "--tag",
      "restic-secrets-manager",
      ".",
    ]);
  });

  it("should throw a safe error message on failure", async () => {
    const runner: ResticRunner = async () =>
      result({ code: 1, stderr: "lock failed" });
    const client = new ResticClient(makeProject(), runner);
    await expect(client.backup("/tmp/secrets")).rejects.toThrow(
      "Unable to push secrets to the restic repository: lock failed",
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
