import { Secret } from "../model/Secret";
import { computeSecretsDiff } from "./SecretsDiff";

function makeSecret(name: string, data: Record<string, string>): Secret {
  const secret = new Secret();
  secret.name = name;
  secret.data = data;
  return secret;
}

describe("computeSecretsDiff", () => {
  it("should report no changes for identical secrets", () => {
    const secrets = [makeSecret("api", { K1: "v1" })];
    const diff = computeSecretsDiff(secrets, secrets);
    expect(diff.summary).toEqual({
      secretsAdded: 0,
      secretsRemoved: 0,
      secretsChanged: 0,
      keysAdded: 0,
      keysRemoved: 0,
      keysChanged: 0,
    });
    expect(diff.secrets).toEqual([]);
  });

  it("should report added secrets with all their keys added", () => {
    const diff = computeSecretsDiff(
      [],
      [makeSecret("api", { K1: "v1", K2: "22" })],
    );
    expect(diff.summary.secretsAdded).toBe(1);
    expect(diff.summary.keysAdded).toBe(2);
    expect(diff.secrets).toEqual([
      {
        name: "api",
        status: "added",
        keys: [
          { key: "K1", status: "added", valueLength: 2 },
          { key: "K2", status: "added", valueLength: 2 },
        ],
      },
    ]);
  });

  it("should report removed secrets with all their keys removed", () => {
    const diff = computeSecretsDiff([makeSecret("api", { K1: "v1" })], []);
    expect(diff.summary.secretsRemoved).toBe(1);
    expect(diff.summary.keysRemoved).toBe(1);
    expect(diff.secrets).toEqual([
      {
        name: "api",
        status: "removed",
        keys: [{ key: "K1", status: "removed", valueLength: 2 }],
      },
    ]);
  });

  it("should report changed secrets at the key level and omit unchanged keys", () => {
    const diff = computeSecretsDiff(
      [makeSecret("api", { KEEP: "same", K1: "old", GONE: "x" })],
      [makeSecret("api", { KEEP: "same", K1: "new", EXTRA: "12345" })],
    );
    expect(diff.summary).toMatchObject({
      secretsChanged: 1,
      keysAdded: 1,
      keysRemoved: 1,
      keysChanged: 1,
    });
    expect(diff.secrets).toEqual([
      {
        name: "api",
        status: "changed",
        keys: [
          { key: "EXTRA", status: "added", valueLength: 5 },
          { key: "GONE", status: "removed", valueLength: 1 },
          {
            key: "K1",
            status: "changed",
            valueLengthBefore: 3,
            valueLengthAfter: 3,
          },
        ],
      },
    ]);
  });

  it("should omit a shared secret whose content did not change", () => {
    const diff = computeSecretsDiff(
      [
        makeSecret("api", { K1: "v1" }),
        makeSecret("db", { USER: "u" }),
      ],
      [
        makeSecret("api", { K1: "v2" }),
        makeSecret("db", { USER: "u" }),
      ],
    );
    expect(diff.secrets.map((s) => s.name)).toEqual(["api"]);
  });

  it("should sort secrets by name for a stable display", () => {
    const diff = computeSecretsDiff(
      [],
      [
        makeSecret("zeta", { K: "1" }),
        makeSecret("alpha", { K: "1" }),
        makeSecret("mid", { K: "1" }),
      ],
    );
    expect(diff.secrets.map((s) => s.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("should never contain secret values, only lengths", () => {
    const current = [makeSecret("api", { TOKEN: "super-secret-value" })];
    const incoming = [makeSecret("api", { TOKEN: "another-secret", NEW: "plain" })];
    const serialized = JSON.stringify(computeSecretsDiff(current, incoming));
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("another-secret");
    expect(serialized).not.toContain("plain");
    expect(serialized).toContain("valueLengthBefore");
  });

  it("should count key changes inside added and removed secrets in the key totals", () => {
    const diff = computeSecretsDiff(
      [makeSecret("gone", { A: "1" })],
      [makeSecret("new", { B: "12", C: "345" })],
    );
    expect(diff.summary).toEqual({
      secretsAdded: 1,
      secretsRemoved: 1,
      secretsChanged: 0,
      keysAdded: 2,
      keysRemoved: 1,
      keysChanged: 0,
    });
  });
});
