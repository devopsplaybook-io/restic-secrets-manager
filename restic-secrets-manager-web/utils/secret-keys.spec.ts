import { describe, expect, it } from "vitest";
import {
  ENV_KEY_PATTERN,
  buildSecretData,
  envKeyWarning,
  isEnvSafeKey,
  nonEnvSafeKeys,
} from "./secret-keys";

describe("isEnvSafeKey", () => {
  it("should accept portable environment variable names", () => {
    for (const key of ["A", "_A", "A_1", "a.b".replace(".", "_"), "KEY123"]) {
      expect(isEnvSafeKey(key)).toBe(true);
    }
  });

  it("should reject keys that a .env file cannot represent", () => {
    for (const key of ["", "1KEY", "A-B", "A B", "A=B", "A#B", "A.B", "Ä"]) {
      expect(isEnvSafeKey(key)).toBe(false);
    }
  });
});

describe("nonEnvSafeKeys", () => {
  it("should preserve the input order", () => {
    expect(nonEnvSafeKeys(["OK", "A B", "B-C", "_X"])).toEqual(["A B", "B-C"]);
  });

  it("should return an empty list when every key is safe", () => {
    expect(nonEnvSafeKeys(["A", "B_2"])).toEqual([]);
  });
});

describe("envKeyWarning", () => {
  it("should return no warning for no invalid key", () => {
    expect(envKeyWarning([])).toBe("");
  });

  it("should quote the invalid keys and point at the JSON export", () => {
    const warning = envKeyWarning(["A B", "B-C"]);
    expect(warning).toContain('"A B", "B-C"');
    expect(warning).toContain(ENV_KEY_PATTERN.source);
    expect(warning).toContain("Use the JSON export instead");
  });
});

describe("buildSecretData", () => {
  it("should trim keys, keep values as-is and skip empty keys", () => {
    expect(
      buildSecretData([
        { key: " A ", value: "1" },
        { key: "   ", value: "ignored" },
        { key: "B", value: "  spaced  " },
      ]),
    ).toEqual({
      data: { A: "1", B: "  spaced  " },
      error: "",
      warning: "",
    });
  });

  it("should reject duplicate keys after trimming", () => {
    expect(
      buildSecretData([
        { key: "A", value: "1" },
        { key: " A ", value: "2" },
      ]),
    ).toEqual({
      data: {},
      error: "Duplicate key 'A': each key must appear only once",
      warning: "",
    });
  });

  it("should warn but not block non-env-safe keys", () => {
    const built = buildSecretData([{ key: "A B", value: "1" }]);
    expect(built.data).toEqual({ "A B": "1" });
    expect(built.error).toBe("");
    expect(built.warning).toContain('"A B"');
  });
});
