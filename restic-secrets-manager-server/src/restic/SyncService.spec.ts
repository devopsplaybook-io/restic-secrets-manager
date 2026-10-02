import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import { Config } from "../Config";
import { Span } from "@opentelemetry/sdk-trace-base";
import { ResticSnapshot } from "./ResticClient";
import { computeSecretsHash } from "../secrets/SecretsHash";
import {
  ensureNoNewerSnapshot,
  importPulledSecrets,
  ResticSyncDiscardLocalChanges,
  ResticSyncError,
  ResticSyncPull,
  ResticSyncPush,
  ResticSyncRestoreSnapshot,
  ResticSyncStatus,
} from "./SyncService";

jest.mock("./ResticClient", () => {
  const actual = jest.requireActual("./ResticClient");
  return {
    ...actual,
    ResticClient: jest.fn(),
  };
});

const ResticClientMock = jest.requireMock("./ResticClient").ResticClient;

function makeProject(overrides: Partial<Project> = {}): Project {
  const project = new Project();
  project.name = "Test";
  project.s3Endpoint = "s3.example.com";
  project.s3Bucket = "bucket";
  project.lastSyncSnapshotId = "snapshot-1";
  project.lastSyncSnapshotTime = "2026-01-01T10:00:00Z";
  return Object.assign(project, overrides);
}

function span(): Span {
  // The span is only passed through to the (stubbed) data layer in tests
  return { name: "test" } as unknown as Span;
}

function testConfig(): Config {
  return { TMP_DIR: os.tmpdir() } as unknown as Config;
}

/** Stubs the ResticClient instances created by the sync service. */
function mockClient(
  overrides: Record<string, jest.Mock> = {},
): Record<string, jest.Mock> {
  const instance: Record<string, jest.Mock> = {
    snapshots: jest.fn().mockResolvedValue([]),
    // Restores a fixture secret file into the target directory
    restore: jest.fn().mockImplementation(async (_id: string, target: string) => {
      await fse.writeJson(path.join(target, "api.json"), { K1: "v1" });
    }),
    restoreLatest: jest.fn().mockImplementation(async (target: string) => {
      await fse.writeJson(path.join(target, "api.json"), { K1: "v1" });
    }),
    repoInitialized: jest.fn().mockResolvedValue(true),
    init: jest.fn().mockResolvedValue(undefined),
    backup: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  ResticClientMock.mockImplementation(() => instance);
  return instance;
}

function makeSecret(name: string, data: Record<string, string>): Secret {
  const secret = new Secret();
  secret.projectId = "test-project";
  secret.name = name;
  secret.data = data;
  return secret;
}

describe("ensureNoNewerSnapshot", () => {
  it("should accept a push when the repository matches the last sync", () => {
    const repoLatest: ResticSnapshot = {
      id: "snapshot-1",
      time: "2026-01-01T10:00:00Z",
    };
    expect(() =>
      ensureNoNewerSnapshot(makeProject(), repoLatest),
    ).not.toThrow();
  });

  it("should reject a push when the project never synchronized", () => {
    const repoLatest: ResticSnapshot = {
      id: "snapshot-1",
      time: "2026-01-01T10:00:00Z",
    };
    const project = makeProject({
      lastSyncSnapshotId: "",
      lastSyncSnapshotTime: "",
    });
    try {
      ensureNoNewerSnapshot(project, repoLatest);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(409);
      expect((e as Error).message).toContain("Pull first");
    }
  });

  it("should reject a push when the repository holds a different snapshot", () => {
    const repoLatest: ResticSnapshot = {
      id: "snapshot-2",
      time: "2026-02-01T10:00:00Z",
    };
    try {
      ensureNoNewerSnapshot(makeProject(), repoLatest);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(409);
      expect((e as Error).message).toContain("more recent snapshot");
    }
  });
});

describe("importPulledSecrets", () => {
  it("should import json files as project secrets", async () => {
    const dir = path.join(os.tmpdir(), `rsm-test-${Date.now()}`);
    await fse.ensureDir(dir);
    await fse.writeJson(path.join(dir, "api-keys.json"), { KEY1: "value1" });
    await fse.writeJson(path.join(dir, "db.json"), {
      USER: "user",
      PORT: 5432,
    });
    await fse.writeFile(path.join(dir, "ignored.txt"), "not json");

    let replaced: Secret[] | null = null;
    const dataApi = {
      SecretsDataReplaceForProject: async (
        _context: Span,
        projectId: string,
        secrets: Secret[],
      ) => {
        expect(projectId).toBe("test-project");
        replaced = secrets;
      },
    };

    const project = makeProject();
    project.id = "test-project";
    const summary = await importPulledSecrets(span(), project, dir, dataApi);

    await fse.remove(dir);

    expect(summary.secrets).toBe(2);
    expect(summary.keys).toBe(3);
    expect(replaced).not.toBeNull();
    const secrets = replaced as unknown as Secret[];
    expect(secrets.map((s) => s.name).sort()).toEqual(["api-keys", "db"]);
    expect(secrets.find((s) => s.name === "db")?.data).toEqual({
      USER: "user",
      PORT: "5432",
    });
  });

  it("should reject invalid secret file names", async () => {
    const dir = path.join(os.tmpdir(), `rsm-test-${Date.now()}-bad`);
    await fse.ensureDir(dir);
    await fse.writeJson(path.join(dir, "with space.json"), { KEY: "value" });
    const project = makeProject();
    try {
      await importPulledSecrets(span(), project, dir, {
        SecretsDataReplaceForProject: async () => undefined,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(422);
      expect((e as Error).message).toContain("Invalid secret file name");
    } finally {
      await fse.remove(dir);
    }
  });

  it("should reject invalid secret file content", async () => {
    const dir = path.join(os.tmpdir(), `rsm-test-${Date.now()}-bad-content`);
    await fse.ensureDir(dir);
    await fse.writeFile(
      path.join(dir, "bad.json"),
      JSON.stringify({ KEY: { nested: 1 } }),
    );
    const project = makeProject();
    try {
      await importPulledSecrets(span(), project, dir, {
        SecretsDataReplaceForProject: async () => undefined,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(422);
    } finally {
      await fse.remove(dir);
    }
  });

  it("should refuse to replace the secrets when the snapshot holds only ignored files", async () => {
    const dir = path.join(os.tmpdir(), `rsm-test-${Date.now()}-ignored`);
    await fse.ensureDir(dir);
    await fse.writeFile(path.join(dir, "notes.txt"), "not a json secret");
    const replace = jest.fn().mockResolvedValue(undefined);
    const project = makeProject();
    try {
      await importPulledSecrets(span(), project, dir, {
        SecretsDataReplaceForProject: replace,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(422);
      expect((e as Error).message).toContain("refusing to replace");
      expect(replace).not.toHaveBeenCalled();
    } finally {
      await fse.remove(dir);
    }
  });

  it("should replace with an empty set when the snapshot directory is empty", async () => {
    const dir = path.join(os.tmpdir(), `rsm-test-${Date.now()}-empty`);
    await fse.ensureDir(dir);
    const replace = jest.fn().mockResolvedValue(undefined);
    const project = makeProject();
    project.id = "test-project";
    const summary = await importPulledSecrets(span(), project, dir, {
      SecretsDataReplaceForProject: replace,
    });
    await fse.remove(dir);

    expect(summary.secrets).toBe(0);
    expect(replace).toHaveBeenCalledWith(
      expect.anything(),
      "test-project",
      [],
    );
  });
});

describe("ResticSyncPull", () => {
  it("should record the synchronized snapshot and the content hash", async () => {
    const snapshots: ResticSnapshot[] = [
      { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
    ];
    const client = mockClient({ snapshots: jest.fn().mockResolvedValue(snapshots) });

    const secrets = [makeSecret("api", { K1: "v1" })];
    const dataApi = {
      ProjectsDataGet: jest.fn().mockResolvedValue(null),
      SecretsDataReplaceForProject: jest.fn().mockResolvedValue(undefined),
      SecretsDataListForProject: jest.fn().mockResolvedValue(secrets),
      ProjectsDataUpdateSyncState: jest.fn().mockResolvedValue(undefined),
    };

    const result = await ResticSyncPull(span(), testConfig(), makeProject(), dataApi);

    expect(client.restoreLatest).toHaveBeenCalled();
    expect(result.snapshotId).toBe("snapshot-1");
    expect(result.secrets).toBe(1);
    expect(dataApi.ProjectsDataUpdateSyncState).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "snapshot-1",
      "2026-01-01T10:00:00Z",
      computeSecretsHash(secrets),
    );
  });

  it("should fail when the repository is empty", async () => {
    mockClient();
    await expect(
      ResticSyncPull(span(), testConfig(), makeProject(), {
        ProjectsDataGet: jest.fn().mockResolvedValue(null),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ResticSyncPush", () => {
  it("should record the pushed snapshot and the content hash", async () => {
    const before: ResticSnapshot[] = [
      { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
    ];
    const after: ResticSnapshot[] = [
      { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      { id: "snapshot-2", time: "2026-02-01T10:00:00Z" },
    ];
    const client = mockClient({
      snapshots: jest
        .fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
    });

    const secrets = [makeSecret("api", { K1: "v1" })];
    const dataApi = {
      ProjectsDataGet: jest.fn().mockResolvedValue(null),
      SecretsDataListForProject: jest.fn().mockResolvedValue(secrets),
      ProjectsDataUpdateSyncState: jest.fn().mockResolvedValue(undefined),
    };

    const project = makeProject();
    const result = await ResticSyncPush(span(), testConfig(), project, dataApi);

    expect(client.backup).toHaveBeenCalled();
    expect(result.snapshotId).toBe("snapshot-2");
    expect(dataApi.ProjectsDataUpdateSyncState).toHaveBeenCalledWith(
      expect.anything(),
      project.id,
      "snapshot-2",
      "2026-02-01T10:00:00Z",
      computeSecretsHash(secrets),
    );
  });

  it("should serialize concurrent pushes and use the fresh project state", async () => {
    const s1: ResticSnapshot = {
      id: "snapshot-1",
      time: "2026-01-01T10:00:00Z",
    };
    const s2: ResticSnapshot = {
      id: "snapshot-2",
      time: "2026-02-01T10:00:00Z",
    };
    const s3: ResticSnapshot = {
      id: "snapshot-3",
      time: "2026-03-01T10:00:00Z",
    };
    // Push A lists [s1] then [s1, s2]; push B (running after A under the
    // lock) lists [s1, s2] then [s1, s2, s3].
    mockClient({
      snapshots: jest
        .fn()
        .mockResolvedValueOnce([s1])
        .mockResolvedValueOnce([s1, s2])
        .mockResolvedValueOnce([s1, s2])
        .mockResolvedValueOnce([s1, s2, s3]),
    });

    const dbProject = makeProject();
    const dataApi = {
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest
        .fn()
        .mockResolvedValue([makeSecret("api", { K1: "v1" })]),
      ProjectsDataUpdateSyncState: jest.fn(
        async (_context, _id, snapshotId: string, snapshotTime: string) => {
          dbProject.lastSyncSnapshotId = snapshotId;
          dbProject.lastSyncSnapshotTime = snapshotTime;
        },
      ),
    };

    // Both routes read the project before acquiring the sync lock
    const [first, second] = await Promise.all([
      ResticSyncPush(span(), testConfig(), makeProject(), dataApi),
      ResticSyncPush(span(), testConfig(), makeProject(), dataApi),
    ]);

    expect(dataApi.ProjectsDataGet).toHaveBeenCalledTimes(2);
    expect(first.snapshotId).toBe("snapshot-2");
    expect(second.snapshotId).toBe("snapshot-3");
    expect(dbProject.lastSyncSnapshotId).toBe("snapshot-3");
  });

  it("should re-check the conflict against the fresh project state under the lock", async () => {
    const s1: ResticSnapshot = {
      id: "snapshot-1",
      time: "2026-01-01T10:00:00Z",
    };
    const s2: ResticSnapshot = {
      id: "snapshot-2",
      time: "2026-02-01T10:00:00Z",
    };
    mockClient({ snapshots: jest.fn().mockResolvedValue([s1, s2]) });

    const dataApi = {
      ProjectsDataGet: jest.fn(async () => makeProject()),
      SecretsDataListForProject: jest.fn().mockResolvedValue([]),
      ProjectsDataUpdateSyncState: jest.fn().mockResolvedValue(undefined),
    };
    // Stale copy from before the lock: it believes the project never synced
    const stale = makeProject({
      lastSyncSnapshotId: "",
      lastSyncSnapshotTime: "",
    });

    try {
      await ResticSyncPush(span(), testConfig(), stale, dataApi);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(409);
      // The fresh state (snapshot-1) was used, not the stale copy
      expect((e as Error).message).toContain("more recent snapshot");
    }
    expect(dataApi.ProjectsDataGet).toHaveBeenCalled();
  });
});

describe("ResticSyncStatus", () => {
  it("should report needsPull when the repository holds another snapshot", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-2", time: "2026-02-01T10:00:00Z" },
      ]),
    });
    const secrets = [makeSecret("api", { K1: "v1" })];
    const dataApi = {
      SecretsDataListForProject: jest.fn().mockResolvedValue(secrets),
    };

    const project = makeProject();
    project.lastSyncContentHash = computeSecretsHash(secrets);
    const status = await ResticSyncStatus(span(), project, dataApi);

    expect(status.needsPull).toBe(true);
    expect(status.remoteLatestSnapshotId).toBe("snapshot-2");
    expect(status.hasLocalChanges).toBe(false);
  });

  it("should report no changes when the repository matches the last sync", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const secrets = [makeSecret("api", { K1: "v1" })];
    const dataApi = {
      SecretsDataListForProject: jest.fn().mockResolvedValue(secrets),
    };

    const project = makeProject();
    project.lastSyncContentHash = computeSecretsHash(secrets);
    const status = await ResticSyncStatus(span(), project, dataApi);

    expect(status.needsPull).toBe(false);
    expect(status.hasLocalChanges).toBe(false);
  });

  it("should report local changes when the content hash differs", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const dataApi = {
      SecretsDataListForProject: jest
        .fn()
        .mockResolvedValue([makeSecret("api", { K1: "v2" })]),
    };

    const project = makeProject();
    project.lastSyncContentHash = computeSecretsHash([
      makeSecret("api", { K1: "v1" }),
    ]);
    const status = await ResticSyncStatus(span(), project, dataApi);

    expect(status.needsPull).toBe(false);
    expect(status.hasLocalChanges).toBe(true);
  });

  it("should report an empty repository as up to date", async () => {
    mockClient();
    const dataApi = {
      SecretsDataListForProject: jest.fn().mockResolvedValue([]),
    };
    const status = await ResticSyncStatus(span(), makeProject(), dataApi);
    expect(status.needsPull).toBe(false);
    expect(status.remoteLatestSnapshotId).toBe("");
  });
});

describe("ResticSyncRestoreSnapshot", () => {
  it("should restore the requested snapshot and record the new sync state", async () => {
    const snapshots: ResticSnapshot[] = [
      { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      { id: "snapshot-2", time: "2026-02-01T10:00:00Z" },
    ];
    const client = mockClient({ snapshots: jest.fn().mockResolvedValue(snapshots) });

    const secrets = [makeSecret("api", { K1: "v1" })];
    const dataApi = {
      ProjectsDataGet: jest.fn().mockResolvedValue(null),
      SecretsDataReplaceForProject: jest.fn().mockResolvedValue(undefined),
      SecretsDataListForProject: jest.fn().mockResolvedValue(secrets),
      ProjectsDataUpdateSyncState: jest.fn().mockResolvedValue(undefined),
    };

    const project = makeProject();
    const result = await ResticSyncRestoreSnapshot(
      span(),
      testConfig(),
      project,
      "snapshot-1",
      dataApi,
    );

    expect(client.restore).toHaveBeenCalledWith(
      "snapshot-1",
      expect.stringContaining("restore"),
    );
    expect(result.snapshotId).toBe("snapshot-1");
    expect(result.secrets).toBe(1);
    expect(dataApi.ProjectsDataUpdateSyncState).toHaveBeenCalledWith(
      expect.anything(),
      project.id,
      "snapshot-1",
      "2026-01-01T10:00:00Z",
      computeSecretsHash(secrets),
    );
  });

  it("should reject an unknown snapshot id with 404", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    try {
      await ResticSyncRestoreSnapshot(
        span(),
        testConfig(),
        makeProject(),
        "unknown-id",
        { ProjectsDataGet: jest.fn().mockResolvedValue(null) },
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(404);
    }
  });
});

describe("ResticSyncDiscardLocalChanges", () => {
  it("should reject a never-synchronized project with 409", async () => {
    const project = makeProject({
      lastSyncSnapshotId: "",
      lastSyncSnapshotTime: "",
    });
    try {
      await ResticSyncDiscardLocalChanges(span(), testConfig(), project, {
        ProjectsDataGet: jest.fn().mockResolvedValue(null),
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(409);
    }
  });

  it("should restore the last synchronized snapshot", async () => {
    const client = mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const secrets = [makeSecret("api", { K1: "v1" })];
    const dataApi = {
      ProjectsDataGet: jest.fn().mockResolvedValue(null),
      SecretsDataReplaceForProject: jest.fn().mockResolvedValue(undefined),
      SecretsDataListForProject: jest.fn().mockResolvedValue(secrets),
      ProjectsDataUpdateSyncState: jest.fn().mockResolvedValue(undefined),
    };

    const project = makeProject();
    const result = await ResticSyncDiscardLocalChanges(
      span(),
      testConfig(),
      project,
      dataApi,
    );

    expect(client.restore).toHaveBeenCalledWith(
      "snapshot-1",
      expect.any(String),
    );
    expect(result.snapshotId).toBe("snapshot-1");
  });
});
