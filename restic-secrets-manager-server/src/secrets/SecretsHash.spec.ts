import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import {
  computeHasLocalChanges,
  computeSecretsHash,
  computeSecretsHashLegacy,
} from "./SecretsHash";

function makeSecret(name: string, data: Record<string, string>): Secret {
  const secret = new Secret();
  secret.projectId = "p1";
  secret.name = name;
  secret.data = data;
  return secret;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  const project = new Project();
  project.name = "Test";
  project.lastSyncSnapshotId = "snapshot-1";
  project.lastSyncSnapshotTime = "2026-01-01T10:00:00Z";
  return Object.assign(project, overrides);
}

describe("computeSecretsHash", () => {
  it("should be invariant to the key order of the data maps", () => {
    const a = makeSecret("api", { A: "1", B: "2" });
    const b = makeSecret("api", { B: "2", A: "1" });
    expect(computeSecretsHash([a])).toBe(computeSecretsHash([b]));
  });

  it("should be invariant to the secret order (sorted by name)", () => {
    const a = makeSecret("api", { A: "1" });
    const b = makeSecret("db", { B: "2" });
    expect(computeSecretsHash([a, b])).toBe(computeSecretsHash([b, a]));
  });

  it("should change when the content changes", () => {
    expect(computeSecretsHash([makeSecret("api", { A: "1" })])).not.toBe(
      computeSecretsHash([makeSecret("api", { A: "2" })]),
    );
  });

  it("should be stable for an empty set of secrets", () => {
    expect(computeSecretsHash([])).toBe(computeSecretsHash([]));
    expect(computeSecretsHash([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeSecretsHashLegacy", () => {
  it("should differ from the canonical hash for unsorted data keys", () => {
    const secret = makeSecret("api", { B: "2", A: "1" });
    expect(computeSecretsHashLegacy([secret])).not.toBe(
      computeSecretsHash([secret]),
    );
  });

  it("should match the canonical hash for sorted data keys", () => {
    const secret = makeSecret("api", { A: "1", B: "2" });
    expect(computeSecretsHashLegacy([secret])).toBe(
      computeSecretsHash([secret]),
    );
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

  it("should be false for projects synchronized before hash tracking", () => {
    const project = makeProject();
    project.lastSyncContentHash = "";
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

  it("should be false when the same content has a different key order", () => {
    const project = makeProject();
    project.lastSyncContentHash = computeSecretsHash([
      makeSecret("api", { A: "1", B: "2" }),
    ]);
    expect(
      computeHasLocalChanges(project, [makeSecret("api", { B: "2", A: "1" })]),
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
});
