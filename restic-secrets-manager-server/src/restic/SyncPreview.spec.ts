import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import { Config } from "../Config";
import type { Span } from "@opentelemetry/sdk-trace";
import {
  ResticSyncPreviewDiscardLocalChanges,
  ResticSyncPreviewPull,
  ResticSyncPreviewRestoreSnapshot,
  SyncPreviewDataLayer,
} from "./SyncPreview";

jest.mock("./TempWorkDir", () => {
  const actual = jest.requireActual("./TempWorkDir");
  return {
    ...actual,
    createTemporaryWorkDir: jest.fn(actual.createTemporaryWorkDir),
    restrictTreePermissions: jest.fn(actual.restrictTreePermissions),
  };
});

jest.mock("./ResticClient", () => {
  const actual = jest.requireActual("./ResticClient");
  return {
    ...actual,
    ResticClient: jest.fn(),
  };
});

const ResticClientMock = jest.requireMock("./ResticClient").ResticClient;
const tempWorkDir = jest.requireMock("./TempWorkDir");

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

/** Stubs the ResticClient instances created by the preview service. */
function mockClient(
  overrides: Record<string, jest.Mock> = {},
): Record<string, jest.Mock> {
  const instance: Record<string, jest.Mock> = {
    snapshots: jest.fn().mockResolvedValue([]),
    // Restores a fixture secret file into the target directory
    restore: jest.fn().mockImplementation(async (_id: string, target: string) => {
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

function dataApiStub(
  current: Secret[],
): SyncPreviewDataLayer & Record<string, jest.Mock> {  return {
    ProjectsDataGet: jest.fn().mockResolvedValue(null),
    SecretsDataListForProject: jest.fn().mockResolvedValue(current),
    SecretsDataReplaceForProject: jest.fn().mockResolvedValue(undefined),
    ProjectsDataUpdateSyncState: jest.fn().mockResolvedValue(undefined),
  };
}

describe("ResticSyncPreviewPull", () => {
  it("should diff the current secrets against the latest snapshot content", async () => {
    const client = mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const dataApi = dataApiStub([makeSecret("api", { K1: "old" })]);

    const preview = await ResticSyncPreviewPull(
      span(),
      testConfig(),
      makeProject(),
      dataApi,
    );

    // The snapshots are listed once and the resolved latest is pinned
    expect(client.snapshots).toHaveBeenCalledTimes(1);
    expect(client.restore).toHaveBeenCalledWith(
      "snapshot-1",
      expect.any(String),
    );
    expect(preview.snapshotId).toBe("snapshot-1");
    expect(preview.snapshotTime).toBe("2026-01-01T10:00:00Z");
    expect(preview.summary.secretsChanged).toBe(1);
    expect(preview.secrets).toEqual([
      {
        name: "api",
        status: "changed",
        keys: [
          {
            key: "K1",
            status: "changed",
            valueLengthBefore: 3,
            valueLengthAfter: 2,
          },
        ],
      },
    ]);
  });

  it("should restrict restored files to 0600 before reading them", async () => {
    mockClient({
      snapshots: jest
        .fn()
        .mockResolvedValue([
          { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
        ]),
      restore: jest.fn().mockImplementation(async (_id: string, target: string) => {
        const file = path.join(target, "api.json");
        await fse.writeJson(file, { K1: "v1" });
        await fse.chmod(file, 0o644);
        await fse.chmod(target, 0o755);
      }),
    });
    const dataApi = dataApiStub([makeSecret("api", { K1: "v1" })]);

    await ResticSyncPreviewRestoreSnapshot(
      span(),
      testConfig(),
      makeProject(),
      "snapshot-1",
      dataApi,
    );

    expect(tempWorkDir.createTemporaryWorkDir).toHaveBeenCalledWith(
      os.tmpdir(),
    );
    expect(tempWorkDir.restrictTreePermissions).toHaveBeenCalledWith(
      expect.stringContaining("restore"),
    );
  });

  it("should not write to the database and clean up the temporary directory", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const tmpDir = path.join(os.tmpdir(), `rsm-preview-tmp-${Date.now()}`);
    await fse.ensureDir(tmpDir);
    const dataApi = dataApiStub([]);

    await ResticSyncPreviewPull(
      span(),
      { TMP_DIR: tmpDir } as unknown as Config,
      makeProject(),
      dataApi,
    );

    expect(dataApi.SecretsDataReplaceForProject).not.toHaveBeenCalled();
    expect(dataApi.ProjectsDataUpdateSyncState).not.toHaveBeenCalled();
    expect(await fse.readdir(tmpDir)).toEqual([]);
    await fse.remove(tmpDir);
  });

  it("should fail with 404 when the repository is empty", async () => {
    mockClient();
    try {
      await ResticSyncPreviewPull(span(), testConfig(), makeProject(), {
        ProjectsDataGet: jest.fn().mockResolvedValue(null),
      } as any);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as any).statusCode).toBe(404);
    }
  });

  it("should fail with 422 when the snapshot content is invalid", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
      restore: jest.fn().mockImplementation(async (_id: string, target: string) => {
        await fse.writeJson(path.join(target, "with space.json"), {
          K1: "v1",
        });
      }),
    });
    try {
      await ResticSyncPreviewPull(
        span(),
        testConfig(),
        makeProject(),
        dataApiStub([]),
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as any).statusCode).toBe(422);
    }
  });
});

describe("ResticSyncPreviewRestoreSnapshot", () => {
  it("should diff the current secrets against the requested snapshot", async () => {
    const client = mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
        { id: "snapshot-2", time: "2026-02-01T10:00:00Z" },
      ]),
      restore: jest.fn().mockImplementation(async (id: string, target: string) => {
        await fse.writeJson(
          path.join(target, id === "snapshot-2" ? "new.json" : "api.json"),
          { K1: "v1" },
        );
      }),
    });
    const dataApi = dataApiStub([makeSecret("api", { K1: "v1" })]);

    const preview = await ResticSyncPreviewRestoreSnapshot(
      span(),
      testConfig(),
      makeProject(),
      "snapshot-2",
      dataApi,
    );

    expect(client.restore).toHaveBeenCalledWith(
      "snapshot-2",
      expect.any(String),
    );
    expect(preview.snapshotId).toBe("snapshot-2");
    expect(preview.summary.secretsAdded).toBe(1);
    expect(preview.summary.secretsRemoved).toBe(1);
  });

  it("should fail with 404 for an unknown snapshot id", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    try {
      await ResticSyncPreviewRestoreSnapshot(
        span(),
        testConfig(),
        makeProject(),
        "unknown-id",
        dataApiStub([]),
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as any).statusCode).toBe(404);
    }
  });
});

describe("ResticSyncPreviewDiscardLocalChanges", () => {
  it("should diff the current secrets against the last synchronized snapshot", async () => {
    const client = mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    const dataApi = dataApiStub([makeSecret("api", { K1: "local-edit" })]);

    const preview = await ResticSyncPreviewDiscardLocalChanges(
      span(),
      testConfig(),
      makeProject(),
      dataApi,
    );

    expect(client.restore).toHaveBeenCalledWith(
      "snapshot-1",
      expect.any(String),
    );
    expect(preview.snapshotId).toBe("snapshot-1");
    expect(preview.summary.secretsChanged).toBe(1);
  });

  it("should fail with 409 when the project was never synchronized", async () => {
    mockClient();
    const project = makeProject({
      lastSyncSnapshotId: "",
      lastSyncSnapshotTime: "",
    });
    try {
      await ResticSyncPreviewDiscardLocalChanges(
        span(),
        testConfig(),
        project,
        dataApiStub([]),
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as any).statusCode).toBe(409);
    }
  });

  it("should fail with 404 when the last synchronized snapshot no longer exists", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-other", time: "2026-01-01T10:00:00Z" },
      ]),
    });
    try {
      await ResticSyncPreviewDiscardLocalChanges(
        span(),
        testConfig(),
        makeProject(),
        dataApiStub([]),
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as any).statusCode).toBe(404);
    }
  });
});

describe("preview serialization", () => {
  it("should serialize concurrent previews per project", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const client = mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
      restore: jest
        .fn()
        .mockImplementationOnce(async (_id: string, target: string) => {
          await gate;
          await fse.writeJson(path.join(target, "api.json"), { K1: "v1" });
        })
        .mockImplementation(async (_id: string, target: string) => {
          await fse.writeJson(path.join(target, "api.json"), { K1: "v1" });
        }),
    });
    const dataApi = dataApiStub([]);

    // Same project instance: the previews are serialized per project id
    const project = makeProject();
    const first = ResticSyncPreviewPull(span(), testConfig(), project, dataApi);
    const second = ResticSyncPreviewPull(
      span(),
      testConfig(),
      project,
      dataApi,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.restore).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([first, second]);
    expect(client.restore).toHaveBeenCalledTimes(2);
  });
});

describe("preview diff safety", () => {
  it("should never expose secret values in the preview result", async () => {
    mockClient({
      snapshots: jest.fn().mockResolvedValue([
        { id: "snapshot-1", time: "2026-01-01T10:00:00Z" },
      ]),
      restore: jest.fn().mockImplementation(async (_id: string, target: string) => {
        await fse.writeJson(path.join(target, "api.json"), {
          TOKEN: "incoming-clear-value",
        });
      }),
    });
    const dataApi = dataApiStub([
      makeSecret("api", { TOKEN: "current-clear-value" }),
    ]);

    const preview = await ResticSyncPreviewPull(
      span(),
      testConfig(),
      makeProject(),
      dataApi,
    );
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain("incoming-clear-value");
    expect(serialized).not.toContain("current-clear-value");
    expect(serialized).not.toContain("clear-value");
  });
});
