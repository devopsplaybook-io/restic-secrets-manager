import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import { Span } from "@opentelemetry/sdk-trace-base";
import { ResticSnapshot } from "./ResticClient";
import {
  ensureNoNewerSnapshot,
  importPulledSecrets,
  ResticSyncError,
} from "./SyncService";

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
