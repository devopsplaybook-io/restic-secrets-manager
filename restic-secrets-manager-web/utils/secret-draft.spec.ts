import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSecretDraft,
  loadSecretDraft,
  saveSecretDraft,
  type SecretDraft,
} from "./secret-draft";

function sampleDraft(): SecretDraft {
  return {
    projectId: "p1",
    secretId: "s1",
    name: "api-keys",
    rows: [
      { key: "TOKEN", value: "abc" },
      { key: "CERT", value: "line1\nline2" },
    ],
    savedAt: "2026-10-16T10:00:00.000Z",
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("secret draft round-trip", () => {
  it("should save, load and clear a draft", () => {
    const draft = sampleDraft();
    saveSecretDraft(draft);
    expect(loadSecretDraft()).toEqual(draft);
    clearSecretDraft();
    expect(loadSecretDraft()).toBeNull();
  });

  it("should return null when no draft is stored", () => {
    expect(loadSecretDraft()).toBeNull();
  });

  it("should return null for corrupt JSON", () => {
    sessionStorage.setItem("secretDraft", "{not json");
    expect(loadSecretDraft()).toBeNull();
  });

  it("should return null for a draft with an invalid shape", () => {
    sessionStorage.setItem("secretDraft", JSON.stringify({ projectId: "p1" }));
    expect(loadSecretDraft()).toBeNull();
    sessionStorage.setItem(
      "secretDraft",
      JSON.stringify({
        ...sampleDraft(),
        rows: [{ key: "A" }],
      }),
    );
    expect(loadSecretDraft()).toBeNull();
  });
});
