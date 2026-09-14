import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import { Config } from "../Config";
import { Span } from "@opentelemetry/sdk-trace-base";
import { ResticSnapshot } from "./ResticClient";
import {
  computeHasLocalChanges,
  computeSecretsHash,
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
});

describe("computeSecretsHash", () => {
  it("should be deterministic and order-independent", () => {
    const a = makeSecret("api", { K1: "v1" });
    const b = makeSecret("db", { K2: "v2" });
    expect(computeSecretsHash([a, b])).toBe(computeSecretsHash([b, a]));
    expect(computeSecretsHash([a, b])).toBe(computeSecretsHash([a, b]));
  });

  it("should change when the secret data changes", () => {
    const a = makeSecret("api", { K1: "v1" });
    const changed = makeSecret("api", { K1: "v2" });
    expect(computeSecretsHash([a])).not.toBe(computeSecretsHash([changed]));
  });

  it("should change when a secret is added or removed", () => {
    const a = makeSecret("api", { K1: "v1" });
    const b = makeSecret("db", { K2: "v2" });
    expect(computeSecretsHash([a])).not.toBe(computeSecretsHash([a, b]));
  });

  it("should be stable for an empty set of secrets", () => {
    expect(computeSecretsHash([])).toBe(computeSecretsHash([]));
    expect(computeSecretsHash([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeHasLocalChanges", () => {
  it("should be true for a never-synchronized project holding secrets", () => {
    const project = makeProject({
      lastSyncSnapshotId: "",
      lastSyncSnapshotTime: "",
    });
    expect(
      computeHasLocalChanges(project, [makeSecret("api", { K1: "v1" })]),
    ).toBe(true);
  });

  it("should be false for a never-synchronized project without secrets", () => {
    const project = makeProject({
      lastSyncSnapshotId: "",
      lastSyncSnapshotTime: "",
    });
    expect(computeHasLocalChanges(project, [])).toBe(false);
  });

  it("should be false when the content matches the last sync", () => {
    const project = makeProject();
    project.lastSyncContentHash = computeSecretsHash([
      makeSecret("api", { K1: "v1" }),
    ]);
    expect(
      computeHasLocalChanges(project, [makeSecret("api", { K1: "v1" })]),
    ).toBe(false);
  });

  it("should be true when the content differs from the last sync", () => {
    const project = makeProject();
    project.lastSyncContentHash = computeSecretsHash([
      makeSecret("api", { K1: "v1" }),
    ]);
    expect(
      computeHasLocalChanges(project, [makeSecret("api", { K1: "v2" })]),
    ).toBe(true);
  });

  it("should be false for projects synchronized before hash tracking", () => {
    const project = makeProject();
    project.lastSyncContentHash = "";
    expect(computeHasLocalChanges(project, [])).toBe(false);
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
      ResticSyncPull(span(), testConfig(), makeProject(), {}),
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
        {},
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
      await ResticSyncDiscardLocalChanges(span(), testConfig(), project, {});
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
