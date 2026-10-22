import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSecretDraft,
  loadSecretDraft,
  saveSecretDraft,
  SECRET_DRAFT_TTL_MS,
  takeSecretDraftForUser,
  type SecretDraft,
} from "./secret-draft";
import { isFormDirty, persistedFormBaseline } from "./secret-edit";

function sampleDraft(overrides: Partial<SecretDraft> = {}): SecretDraft {
  return {
    projectId: "p1",
    secretId: "s1",
    name: "api-keys",
    rows: [
      { key: "TOKEN", value: "abc" },
      { key: "CERT", value: "line1\nline2" },
    ],
    savedAt: new Date().toISOString(),
    userId: "user-1",
    ...overrides,
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

  it("should return null for corrupt JSON and remove the entry", () => {
    sessionStorage.setItem("secretDraft", "{not json");
    expect(loadSecretDraft()).toBeNull();
    expect(sessionStorage.getItem("secretDraft")).toBeNull();
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

describe("secret draft TTL", () => {
  it("should accept a draft saved within the TTL", () => {
    const draft = sampleDraft({
      savedAt: new Date(Date.now() - SECRET_DRAFT_TTL_MS + 60_000).toISOString(),
    });
    saveSecretDraft(draft);
    expect(loadSecretDraft()).toEqual(draft);
  });

  it("should drop and remove a draft older than the TTL", () => {
    saveSecretDraft(
      sampleDraft({
        savedAt: new Date(Date.now() - SECRET_DRAFT_TTL_MS - 60_000).toISOString(),
      }),
    );
    expect(loadSecretDraft()).toBeNull();
    expect(sessionStorage.getItem("secretDraft")).toBeNull();
  });

  it("should drop a draft with an unparseable savedAt", () => {
    saveSecretDraft(sampleDraft({ savedAt: "not-a-date" }));
    expect(loadSecretDraft()).toBeNull();
    expect(sessionStorage.getItem("secretDraft")).toBeNull();
  });
});

describe("secret draft user binding", () => {
  it("should drop a draft without a userId", () => {
    saveSecretDraft(sampleDraft({ userId: "" }));
    expect(loadSecretDraft()).toBeNull();
    expect(sessionStorage.getItem("secretDraft")).toBeNull();
  });

  it("should return a matching draft and always clear the storage", () => {
    const draft = sampleDraft({ userId: "user-1" });
    saveSecretDraft(draft);
    expect(takeSecretDraftForUser("user-1")).toEqual(draft);
    expect(sessionStorage.getItem("secretDraft")).toBeNull();
  });

  it("should drop another user's draft", () => {
    saveSecretDraft(sampleDraft({ userId: "user-2" }));
    expect(takeSecretDraftForUser("user-1")).toBeNull();
    expect(sessionStorage.getItem("secretDraft")).toBeNull();
  });

  it("should return null without a stored draft", () => {
    expect(takeSecretDraftForUser("user-1")).toBeNull();
  });
});

describe("expiry -> restore -> close flow (L7)", () => {
  it("should not offer an expired draft: there is nothing to restore", () => {
    saveSecretDraft(
      sampleDraft({
        savedAt: new Date(Date.now() - SECRET_DRAFT_TTL_MS - 60_000).toISOString(),
      }),
    );
    expect(takeSecretDraftForUser("user-1")).toBeNull();
    expect(sessionStorage.getItem("secretDraft")).toBeNull();
  });

  it("should restore a valid draft as an unsaved edit so closing asks for confirmation", () => {
    saveSecretDraft(sampleDraft());
    const draft = takeSecretDraftForUser("user-1");
    expect(draft).not.toBeNull();
    const form = {
      name: draft!.name,
      rows: draft!.rows.map((row) => ({ key: row.key, value: row.value })),
    };
    // The persisted secret differs from the restored draft
    const persisted = {
      name: "api-keys",
      data: { TOKEN: "saved-value", CERT: "saved-cert" },
    };
    expect(isFormDirty(form, persistedFormBaseline(persisted))).toBe(true);
    // Closing the editor now goes through the unsaved-changes confirmation
  });
});
