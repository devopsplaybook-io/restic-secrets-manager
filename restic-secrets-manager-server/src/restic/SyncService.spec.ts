import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import { Config } from "../Config";
import type { Span } from "@opentelemetry/sdk-trace";
import { ResticSnapshot } from "./ResticClient";
import { computeSecretsHash } from "../secrets/SecretsHash";
import {
  ensureNoNewerSnapshot,
  readSnapshotSecrets,
  resolveCreatedSnapshot,
  ResticSyncDiscardLocalChanges,
  ResticSyncError,
  ResticSyncListSnapshots,
  ResticSyncPull,
  ResticSyncPush,
  ResticSyncRestoreSnapshot,
  ResticSyncStatus,
  ResticSyncTestConnection,
  SYNC_PREVIEW_STALE_CODE,
} from "./SyncService";

jest.mock("./TempWorkDir", () => {
  const actual = jest.requireActual("./TempWorkDir");
  return {
    ...actual,
    createTemporaryWorkDir: jest.fn(actual.createTemporaryWorkDir),
    restrictTreePermissions: jest.fn(actual.restrictTreePermissions),
    writePrivateJson: jest.fn(actual.writePrivateJson),
  };
});

jest.mock("./ResticClient", () => {
  const actual = jest.requireActual("./ResticClient");
  return {
    ...actual,
    ResticClient: jest.fn(),
  };
});

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsWithLock: jest.fn(
    (_lock: string, task: () => Promise<unknown>) => task(),
  ),
}));

const ResticClientMock = jest.requireMock("./ResticClient").ResticClient;
const tempWorkDir = jest.requireMock("./TempWorkDir");

function makeProject(overrides: Partial<Project> = {}): Project {
  const project = new Project();
  project.id = "test-project";
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
    snapshot: jest.fn().mockImplementation(async (id: string) => ({
      id,
      time: "2026-02-01T10:00:00Z",
    })),
    repoInitialized: jest.fn().mockResolvedValue(true),
    init: jest.fn().mockResolvedValue(undefined),
    backup: jest.fn().mockResolvedValue("snapshot-2"),
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

/** Data layer stub with the functions used by pull/restore/discard. */
function makeDataApi(overrides: Record<string, jest.Mock> = {}) {
  return {
    ProjectsDataGet: jest.fn(async () => makeProject()),
    SecretsDataListForProject: jest.fn(async () => []),
    SecretsDataReplaceForProject: jest.fn(async () => undefined),
    ProjectsDataUpdateSyncState: jest.fn(async () => undefined),
    SecretsDataCountForProject: jest.fn(async () => 0),
    ...overrides,
  };
}

function snapshotFile(dir: string, name: string, data: unknown): Promise<void> {
  return fse.writeJson(path.join(dir, name), data);
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

describe("readSnapshotSecrets", () => {
  async function withDir(
    files: Record<string, unknown>,
    run: (dir: string) => Promise<void>,
  ): Promise<void> {
    const dir = path.join(os.tmpdir(), `rsm-test-${Date.now()}-${Math.random()}`);
    await fse.ensureDir(dir);
    try {
      for (const [name, content] of Object.entries(files)) {
        await snapshotFile(dir, name, content);
      }
      await run(dir);
    } finally {
      await fse.remove(dir);
    }
  }

  it("should parse json files into flat key/value secrets", async () => {
    await withDir(
      {
        "api-keys.json": { KEY1: "value1" },
        "db.json": { USER: "user", PORT: 5432 },
        "ignored.txt": "not json",
      },
      async (dir) => {
        const secrets = await readSnapshotSecrets(dir);
        expect(secrets.map((s) => s.name).sort()).toEqual(["api-keys", "db"]);
        expect(secrets.find((s) => s.name === "db")?.data).toEqual({
          USER: "user",
          PORT: "5432",
        });
      },
    );
  });

  it("should reject invalid secret file names", async () => {
    await withDir({ "with space.json": { KEY: "value" } }, async (dir) => {
      await expect(readSnapshotSecrets(dir)).rejects.toMatchObject({
        statusCode: 422,
      });
    });
  });

  it("should reject invalid secret file content", async () => {
    await withDir(
      { "bad.json": { KEY: { nested: 1 } } },
      async (dir) => {
        await expect(readSnapshotSecrets(dir)).rejects.toMatchObject({
          statusCode: 422,
        });
      },
    );
  });

  it("should refuse a snapshot holding only ignored files", async () => {
    await withDir({ "notes.txt": "not a json secret" }, async (dir) => {
      await expect(readSnapshotSecrets(dir)).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining("refusing to replace"),
      });
    });
  });

  it("should accept an empty snapshot directory as an empty set", async () => {
    await withDir({}, async (dir) => {
      await expect(readSnapshotSecrets(dir)).resolves.toEqual([]);
    });
  });
});

describe("ResticSyncPull", () => {
  it("should replace the secrets and record the pinned snapshot atomically", async () => {
    const snapshots: ResticSnapshot[] = [
      { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
    ];
    const client = mockClient({
      snapshots: jest.fn().mockResolvedValue(snapshots),
    });

    const current = [makeSecret("api", { K1: "v1" })];
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest.fn(async () => current),
    });

    const result = await ResticSyncPull(
      span(),
      testConfig(),
      dbProject,
      "snapshot-1",
      undefined,
      dataApi,
    );

    expect(client.restore).toHaveBeenCalledWith(
      "snapshot-1",
      expect.stringContaining("restore"),
    );
    expect(result).toMatchObject({
      snapshotId: "snapshot-1",
      snapshotTime: "2026-01-01T10:00:00Z",
      secrets: 1,
      keys: 1,
    });
    const replaceArgs = dataApi.SecretsDataReplaceForProject.mock
      .calls[0] as unknown as [
      unknown,
      string,
      Secret[],
      { snapshotId: string; snapshotTime: string; contentHash: string },
    ];
    expect(replaceArgs[0]).toEqual(expect.anything());
    expect(replaceArgs[1]).toBe("test-project");
    expect(replaceArgs[2].map((s: Secret) => s.name)).toEqual(["api"]);
    expect(replaceArgs[3]).toEqual({
      snapshotId: "snapshot-1",
      snapshotTime: "2026-01-01T10:00:00Z",
      contentHash: computeSecretsHash(replaceArgs[2]),
    });
    // The state is written inside the replace transaction, never separately.
    expect(dataApi.ProjectsDataUpdateSyncState).not.toHaveBeenCalled();
  });

  it("should list the snapshots only once per pull", async () => {
    const snapshots = jest
      .fn()
      .mockResolvedValue([{ id: "snapshot-1", time: "2026-01-01T10:00:00Z" }]);
    mockClient({ snapshots });
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
    });

    await ResticSyncPull(
      span(),
      testConfig(),
      dbProject,
      "snapshot-1",
      undefined,
      dataApi,
    );

    expect(snapshots).toHaveBeenCalledTimes(1);
  });

  it("should reject a pull without a snapshot id with 400", async () => {
    const client = mockClient();
    await expect(
      ResticSyncPull(span(), testConfig(), makeProject(), "", undefined, makeDataApi()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(client.restore).not.toHaveBeenCalled();
  });

  it("should reject a pull when the repository moved past the pinned snapshot", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
        { id: "snapshot-2", time: "2026-02-01T10:00:00Z" },
      ]),
    });
    const dataApi = makeDataApi();

    await expect(
      ResticSyncPull(
        span(),
        testConfig(),
        makeProject(),
        "snapshot-1",
        undefined,
        dataApi,
      ),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("snapshot-2") });

    expect(dataApi.SecretsDataReplaceForProject).not.toHaveBeenCalled();
    expect(dataApi.ProjectsDataUpdateSyncState).not.toHaveBeenCalled();
  });

  it("should reject a pull with 409 when the previewed content changed", async () => {
    mockClient({
      snapshots: jest
        .fn()
        .mockResolvedValue([
          { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
        ]),
    });
    const current = [makeSecret("api", { K1: "edited-during-preview" })];
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest.fn(async () => current),
    });

    // The token captured by the preview; secrets moved since then.
    const previewHash = computeSecretsHash([
      makeSecret("api", { K1: "previewed" }),
    ]);

    try {
      await ResticSyncPull(
        span(),
        testConfig(),
        dbProject,
        "snapshot-1",
        previewHash,
        dataApi,
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(409);
      expect((e as ResticSyncError).code).toBe(SYNC_PREVIEW_STALE_CODE);
    }
    expect(dataApi.SecretsDataReplaceForProject).not.toHaveBeenCalled();
  });

  it("should capture the current hash before the restore when no token is sent", async () => {
    mockClient({
      snapshots: jest
        .fn()
        .mockResolvedValue([
          { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
        ]),
    });
    const current = [makeSecret("api", { K1: "v1" })];
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest.fn(async () => current),
    });

    await ResticSyncPull(
      span(),
      testConfig(),
      dbProject,
      "snapshot-1",
      undefined,
      dataApi,
    );

    expect(dataApi.SecretsDataReplaceForProject).toHaveBeenCalled();
  });

  it("should return 404 when the project was deleted during the restore", async () => {
    mockClient({
      snapshots: jest
        .fn()
        .mockResolvedValue([
          { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
        ]),
    });
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest
        .fn()
        .mockResolvedValueOnce(dbProject)
        .mockResolvedValueOnce(null),
    });

    await expect(
      ResticSyncPull(
        span(),
        testConfig(),
        dbProject,
        "snapshot-1",
        undefined,
        dataApi,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(dataApi.SecretsDataReplaceForProject).not.toHaveBeenCalled();
  });

  it("should restrict restored files to 0600 before reading them", async () => {
    mockClient({
      snapshots: jest
        .fn()
        .mockResolvedValue([
          { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
        ]),
      restore: jest
        .fn()
        .mockImplementation(async (_id: string, target: string) => {
          const file = path.join(target, "api.json");
          await fse.writeJson(file, { K1: "v1" });
          await fse.chmod(file, 0o644);
          await fse.chmod(target, 0o755);
        }),
    });
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
    });

    await ResticSyncPull(
      span(),
      testConfig(),
      dbProject,
      "snapshot-1",
      undefined,
      dataApi,
    );

    expect(tempWorkDir.createTemporaryWorkDir).toHaveBeenCalledWith(
      os.tmpdir(),
    );
    expect(tempWorkDir.restrictTreePermissions).toHaveBeenCalledWith(
      expect.stringContaining("restore"),
    );
  });

  it("should fail when the repository is empty", async () => {
    mockClient();
    await expect(
      ResticSyncPull(
        span(),
        testConfig(),
        makeProject(),
        "snapshot-1",
        undefined,
        makeDataApi(),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ResticSyncPush", () => {
  it("should record the pushed snapshot and the pushed content hash", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
      backup: jest.fn().mockResolvedValue("snapshot-2"),
      snapshot: jest.fn().mockResolvedValue({
        id: "snapshot-2",
        time: "2026-02-01T10:00:00Z",
      }),
    });

    const secrets = [makeSecret("api", { K1: "v1" })];
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest.fn(async () => secrets),
    });

    const result = await ResticSyncPush(
      span(),
      testConfig(),
      dbProject,
      undefined,
      dataApi,
    );

    expect(result.snapshotId).toBe("snapshot-2");
    expect(dataApi.ProjectsDataUpdateSyncState).toHaveBeenCalledWith(
      expect.anything(),
      "test-project",
      "snapshot-2",
      "2026-02-01T10:00:00Z",
      computeSecretsHash(secrets),
      computeSecretsHash(secrets),
    );
  });

  it("should keep an edit made during the backup visible as a local change", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
      backup: jest.fn().mockResolvedValue("snapshot-2"),
      snapshot: jest.fn().mockResolvedValue({
        id: "snapshot-2",
        time: "2026-02-01T10:00:00Z",
      }),
    });

    const pushed = [makeSecret("api", { K1: "v1" })];
    const fresh = [makeSecret("api", { K1: "edited-during-backup" })];
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest
        .fn()
        .mockResolvedValueOnce(pushed)
        .mockResolvedValueOnce(fresh),
    });

    await ResticSyncPush(
      span(),
      testConfig(),
      dbProject,
      undefined,
      dataApi,
    );

    expect(dataApi.ProjectsDataUpdateSyncState).toHaveBeenCalledWith(
      expect.anything(),
      "test-project",
      "snapshot-2",
      "2026-02-01T10:00:00Z",
      computeSecretsHash(pushed),
      computeSecretsHash(fresh),
    );
  });

  it("should abort with 409 when another synchronization moved the state", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
      backup: jest.fn().mockResolvedValue("snapshot-2"),
      snapshot: jest.fn().mockResolvedValue({
        id: "snapshot-2",
        time: "2026-02-01T10:00:00Z",
      }),
    });

    const observed = makeProject();
    const moved = makeProject({ lastSyncSnapshotId: "snapshot-9" });
    const dataApi = makeDataApi({
      ProjectsDataGet: jest
        .fn()
        .mockResolvedValueOnce(observed)
        .mockResolvedValueOnce(moved),
    });

    try {
      await ResticSyncPush(span(), testConfig(), observed, undefined, dataApi);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(409);
      expect((e as Error).message).toContain(
        "Another synchronization completed while pushing",
      );
    }
    expect(dataApi.ProjectsDataUpdateSyncState).not.toHaveBeenCalled();
  });

  it("should record the snapshot reported by the backup, not a concurrent latest", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
      backup: jest.fn().mockResolvedValue("snapshot-2"),
      snapshot: jest.fn().mockResolvedValue({
        id: "snapshot-2",
        time: "2026-02-01T10:00:00Z",
      }),
    });
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
    });

    const result = await ResticSyncPush(
      span(),
      testConfig(),
      dbProject,
      "alice",
      dataApi,
    );

    expect(result.snapshotId).toBe("snapshot-2");
  });

  it("should fall back to the single new snapshot when the summary id is missing", async () => {
    const s1: ResticSnapshot = {
      id: "snapshot-1",
      time: "2026-01-01T10:00:00Z",
    };
    const s2: ResticSnapshot = {
      id: "snapshot-2",
      time: "2026-02-01T10:00:00Z",
    };
    const client = mockClient({
      snapshots: jest
        .fn()
        .mockResolvedValueOnce([s1])
        .mockResolvedValueOnce([s1, s2]),
      backup: jest.fn().mockResolvedValue(null),
    });
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
    });

    const result = await ResticSyncPush(
      span(),
      testConfig(),
      dbProject,
      undefined,
      dataApi,
    );

    expect(client.snapshot).not.toHaveBeenCalled();
    expect(result.snapshotId).toBe("snapshot-2");
  });

  it("should fail without recording state when the created snapshot cannot be identified", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
      backup: jest.fn().mockResolvedValue(null),
    });
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
    });

    try {
      await ResticSyncPush(span(), testConfig(), dbProject, undefined, dataApi);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(500);
      expect((e as Error).message).toContain("could not be identified");
    }
    expect(dataApi.ProjectsDataUpdateSyncState).not.toHaveBeenCalled();
  });

  it("should forward the pushing user to the restic backup", async () => {
    const client = mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const dbProject = makeProject();
    await ResticSyncPush(
      span(),
      testConfig(),
      dbProject,
      "alice",
      makeDataApi({ ProjectsDataGet: jest.fn(async () => dbProject) }),
    );
    expect(client.backup).toHaveBeenCalledWith(
      expect.stringContaining("secrets"),
      "alice",
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
    // Push A (running first under the queue) lists [s1] and creates s2;
    // push B lists [s1, s2] and creates s3.
    mockClient({
      snapshots: jest
        .fn()
        .mockResolvedValueOnce([s1])
        .mockResolvedValueOnce([s1, s2]),
      backup: jest
        .fn()
        .mockResolvedValueOnce("snapshot-2")
        .mockResolvedValueOnce("snapshot-3"),
      snapshot: jest.fn().mockImplementation(async (id: string) => {
        return id === "snapshot-2" ? s2 : s3;
      }),
    });

    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest
        .fn()
        .mockResolvedValue([makeSecret("api", { K1: "v1" })]),
      ProjectsDataUpdateSyncState: jest.fn(
        async (
          _context,
          _id,
          snapshotId: string,
          snapshotTime: string,
        ) => {
          dbProject.lastSyncSnapshotId = snapshotId;
          dbProject.lastSyncSnapshotTime = snapshotTime;
        },
      ),
    });

    const [first, second] = await Promise.all([
      ResticSyncPush(span(), testConfig(), dbProject, undefined, dataApi),
      ResticSyncPush(
        span(),
        testConfig(),
        makeProject({ id: dbProject.id }),
        undefined,
        dataApi,
      ),
    ]);

    // Project read at the start of each push and again in its write section
    expect(dataApi.ProjectsDataGet).toHaveBeenCalledTimes(4);
    expect(first.snapshotId).toBe("snapshot-2");
    expect(second.snapshotId).toBe("snapshot-3");
    expect(dbProject.lastSyncSnapshotId).toBe("snapshot-3");
  });

  it("should re-check the conflict against the fresh project state under the queue", async () => {
    const s1: ResticSnapshot = {
      id: "snapshot-1",
      time: "2026-01-01T10:00:00Z",
    };
    const s2: ResticSnapshot = {
      id: "snapshot-2",
      time: "2026-02-01T10:00:00Z",
    };
    mockClient({ snapshots: jest.fn().mockResolvedValue([s1, s2]) });

    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => makeProject()),
    });
    // Stale copy from before the queue: it believes the project never synced
    const stale = makeProject({
      lastSyncSnapshotId: "",
      lastSyncSnapshotTime: "",
    });

    try {
      await ResticSyncPush(span(), testConfig(), stale, undefined, dataApi);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResticSyncError);
      expect((e as ResticSyncError).statusCode).toBe(409);
      // The fresh state (snapshot-1) was used, not the stale copy
      expect((e as Error).message).toContain("more recent snapshot");
    }
  });
});

describe("resolveCreatedSnapshot", () => {
  function clientWith(snapshotResults: (ResticSnapshot | null)[], listings: ResticSnapshot[][] = []) {
    return {
      snapshot: jest
        .fn()
        .mockImplementation(async () => snapshotResults.shift() ?? null),
      snapshots: jest
        .fn()
        .mockImplementation(async () => listings.shift() ?? []),
    } as any;
  }

  it("should retry a lagging metadata read and return the snapshot", async () => {
    const created: ResticSnapshot = {
      id: "snapshot-2",
      time: "2026-02-01T10:00:00Z",
    };
    const client = clientWith([null, null, created]);
    const sleep = jest.fn(async () => undefined);

    const result = await resolveCreatedSnapshot(
      client,
      "snapshot-2",
      new Set(["snapshot-1"]),
      sleep,
    );

    expect(result).toBe(created);
    expect(client.snapshot).toHaveBeenCalledTimes(3);
    expect(
      (sleep.mock.calls as unknown[][]).map((call) => call[0]),
    ).toEqual([250, 500]);
  });

  it("should fall back to the post listing for the exact created id", async () => {
    const created: ResticSnapshot = {
      id: "snapshot-2",
      time: "2026-02-01T10:00:00Z",
    };
    const client = clientWith(
      [null, null, null],
      [[{ id: "snapshot-1", time: "2026-01-01T10:00:00Z" }, created]],
    );

    const result = await resolveCreatedSnapshot(
      client,
      "snapshot-2",
      new Set(["snapshot-1"]),
      jest.fn(async () => undefined),
    );

    expect(result).toBe(created);
  });

  it("should accept the single newly appeared snapshot when the id is not readable", async () => {
    const created: ResticSnapshot = {
      id: "snapshot-2",
      time: "2026-02-01T10:00:00Z",
    };
    const client = clientWith(
      [null, null, null],
      [[{ id: "snapshot-1", time: "2026-01-01T10:00:00Z" }, created]],
    );

    const result = await resolveCreatedSnapshot(
      client,
      "snapshot-other",
      new Set(["snapshot-1"]),
      jest.fn(async () => undefined),
    );

    expect(result).toBe(created);
  });

  it("should fail with 500 when no new snapshot can be identified", async () => {
    const client = clientWith(
      [null, null, null],
      [[{ id: "snapshot-1", time: "2026-01-01T10:00:00Z" }]],
    );

    await expect(
      resolveCreatedSnapshot(
        client,
        "snapshot-2",
        new Set(["snapshot-1"]),
        jest.fn(async () => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe("ResticSyncStatus", () => {
  it("should report needsPull when the repository holds another snapshot", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-2", time: "2026-02-01T10:00:00Z" },
      ]),
    });
    const dataApi = {
      SecretsDataCountForProject: jest.fn().mockResolvedValue(1),
    };

    const project = makeProject();
    project.lastSyncContentHash = computeSecretsHash([
      makeSecret("api", { K1: "v1" }),
    ]);
    project.currentContentHash = project.lastSyncContentHash;
    const status = await ResticSyncStatus(span(), testConfig(), project, dataApi);

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
    const dataApi = {
      SecretsDataCountForProject: jest.fn().mockResolvedValue(1),
    };

    const project = makeProject();
    project.lastSyncContentHash = computeSecretsHash([
      makeSecret("api", { K1: "v1" }),
    ]);
    project.currentContentHash = project.lastSyncContentHash;
    const status = await ResticSyncStatus(span(), testConfig(), project, dataApi);

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
      SecretsDataCountForProject: jest.fn().mockResolvedValue(1),
    };

    const project = makeProject();
    project.lastSyncContentHash = computeSecretsHash([
      makeSecret("api", { K1: "v1" }),
    ]);
    project.currentContentHash = computeSecretsHash([
      makeSecret("api", { K1: "v2" }),
    ]);
    const status = await ResticSyncStatus(span(), testConfig(), project, dataApi);

    expect(status.needsPull).toBe(false);
    expect(status.hasLocalChanges).toBe(true);
  });

  it("should report an empty repository as up to date", async () => {
    mockClient();
    const dataApi = {
      SecretsDataCountForProject: jest.fn().mockResolvedValue(0),
    };
    const status = await ResticSyncStatus(span(), testConfig(), makeProject(), dataApi);
    expect(status.needsPull).toBe(false);
    expect(status.remoteLatestSnapshotId).toBe("");
  });
});

describe("ResticSyncTestConnection", () => {
  it("should map an empty repository", async () => {
    mockClient({
      testConnection: jest.fn().mockResolvedValue({ status: "empty" }),
    });
    expect(await ResticSyncTestConnection(makeProject(), testConfig())).toEqual({
      status: "empty",
      message: "Repository is empty: it will be initialized on the first push",
    });
  });

  it("should map a successful connection with its snapshot count", async () => {
    mockClient({
      testConnection: jest.fn().mockResolvedValue({
        status: "ok",
        snapshotCount: 3,
        latestSnapshotTime: "2026-02-01T10:00:00Z",
      }),
    });
    expect(await ResticSyncTestConnection(makeProject(), testConfig())).toEqual({
      status: "ok",
      message: "Connection successful: 3 snapshots found",
      snapshotCount: 3,
      latestSnapshotTime: "2026-02-01T10:00:00Z",
    });
  });

  it("should map a single snapshot without pluralization", async () => {
    mockClient({
      testConnection: jest.fn().mockResolvedValue({
        status: "ok",
        snapshotCount: 1,
        latestSnapshotTime: "2026-01-01T10:00:00Z",
      }),
    });
    const result = await ResticSyncTestConnection(makeProject(), testConfig());
    expect(result.message).toBe("Connection successful: 1 snapshot found");
  });

  it("should map an error with its sanitized message", async () => {
    mockClient({
      testConnection: jest.fn().mockResolvedValue({
        status: "error",
        message: "unable to access bucket: access denied",
      }),
    });
    expect(await ResticSyncTestConnection(makeProject(), testConfig())).toEqual({
      status: "error",
      message: "unable to access bucket: access denied",
    });
  });

  it("should fall back to a generic message when the error has none", async () => {
    mockClient({
      testConnection: jest.fn().mockResolvedValue({ status: "error" }),
    });
    const result = await ResticSyncTestConnection(makeProject(), testConfig());
    expect(result.status).toBe("error");
    expect(result.message).toBe("Unable to reach the repository");
  });
});

describe("ResticSyncRestoreSnapshot", () => {
  it("should restore the requested snapshot and record the new sync state", async () => {
    const snapshots: ResticSnapshot[] = [
      { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      { id: "snapshot-2", time: "2026-02-01T10:00:00Z" },
    ];
    const client = mockClient({
      snapshots: jest.fn().mockResolvedValue(snapshots),
    });

    const current = [makeSecret("api", { K1: "v1" })];
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest.fn(async () => current),
    });

    const result = await ResticSyncRestoreSnapshot(
      span(),
      testConfig(),
      dbProject,
      "snapshot-1",
      undefined,
      dataApi,
    );

    expect(client.restore).toHaveBeenCalledWith(
      "snapshot-1",
      expect.stringContaining("restore"),
    );
    expect(result).toMatchObject({
      snapshotId: "snapshot-1",
      secrets: 1,
      keys: 1,
    });
    const replaceArgs = dataApi.SecretsDataReplaceForProject.mock
      .calls[0] as unknown as [
      unknown,
      string,
      Secret[],
      { snapshotId: string; snapshotTime: string; contentHash: string },
    ];
    expect(replaceArgs[3]).toEqual({
      snapshotId: "snapshot-1",
      snapshotTime: "2026-01-01T10:00:00Z",
      contentHash: computeSecretsHash(replaceArgs[2]),
    });
  });

  it("should reject an unknown snapshot id with 404", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    await expect(
      ResticSyncRestoreSnapshot(
        span(),
        testConfig(),
        makeProject(),
        "unknown-id",
        undefined,
        makeDataApi(),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("should reject a restore with 409 when the previewed content changed", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest
        .fn()
        .mockResolvedValue([makeSecret("api", { K1: "edited" })]),
    });

    await expect(
      ResticSyncRestoreSnapshot(
        span(),
        testConfig(),
        dbProject,
        "snapshot-1",
        "stale-preview-hash",
        dataApi,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: SYNC_PREVIEW_STALE_CODE,
    });
    expect(dataApi.SecretsDataReplaceForProject).not.toHaveBeenCalled();
  });
});

describe("ResticSyncDiscardLocalChanges", () => {
  it("should reject a never-synchronized project with 409", async () => {
    const project = makeProject({
      lastSyncSnapshotId: "",
      lastSyncSnapshotTime: "",
    });
    await expect(
      ResticSyncDiscardLocalChanges(
        span(),
        testConfig(),
        project,
        undefined,
        makeDataApi({ ProjectsDataGet: jest.fn(async () => project) }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("should restore the last synchronized snapshot", async () => {
    const client = mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const current = [makeSecret("api", { K1: "v1" })];
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest.fn(async () => current),
    });

    const result = await ResticSyncDiscardLocalChanges(
      span(),
      testConfig(),
      dbProject,
      undefined,
      dataApi,
    );

    expect(client.restore).toHaveBeenCalledWith(
      "snapshot-1",
      expect.any(String),
    );
    expect(result.snapshotId).toBe("snapshot-1");
  });

  it("should reject a discard with 409 when the previewed content changed", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const dbProject = makeProject();
    const dataApi = makeDataApi({
      ProjectsDataGet: jest.fn(async () => dbProject),
      SecretsDataListForProject: jest
        .fn()
        .mockResolvedValue([makeSecret("api", { K1: "edited" })]),
    });

    await expect(
      ResticSyncDiscardLocalChanges(
        span(),
        testConfig(),
        dbProject,
        "stale-preview-hash",
        dataApi,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: SYNC_PREVIEW_STALE_CODE,
    });
  });
});

describe("ResticSyncListSnapshots", () => {
  it("should return the snapshots most recent first with the pusher attribution", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        {
          id: "snapshot-1",
          time: "2026-01-01T10:00:00Z",
          tags: ["restic-secrets-manager", "pushed-by:alice"],
          username: "root",
          hostname: "old-host",
        },
        {
          id: "snapshot-2",
          time: "2026-02-01T10:00:00Z",
          username: "bob",
          hostname: "laptop",
        },
        { id: "snapshot-3", time: "2026-03-01T10:00:00Z" },
      ]),
    });

    const snapshots = await ResticSyncListSnapshots(makeProject(), testConfig());

    expect(snapshots.map((s) => s.id)).toEqual([
      "snapshot-3",
      "snapshot-2",
      "snapshot-1",
    ]);
    expect(snapshots[2].pushedBy).toBe("alice");
    expect(snapshots[1].pushedBy).toBe("bob@laptop");
    expect(snapshots[0].pushedBy).toBeUndefined();
    expect(snapshots[2].username).toBe("root");
    expect(snapshots[2].hostname).toBe("old-host");
  });
});
