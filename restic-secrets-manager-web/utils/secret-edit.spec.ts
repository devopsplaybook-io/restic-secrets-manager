import { describe, expect, it } from "vitest";
import {
  emptySecretForm,
  formSnapshot,
  isFormDirty,
  isSecretNameConflict,
  isSecretVersionConflict,
  persistedFormBaseline,
  secretToForm,
} from "./secret-edit";

describe("secretToForm", () => {
  it("should expose the secret name and its keys in storage order", () => {
    expect(
      secretToForm({ name: "app", data: { B: "2", A: "1" } }),
    ).toEqual({
      name: "app",
      rows: [
        { key: "B", value: "2" },
        { key: "A", value: "1" },
      ],
    });
  });
});

describe("isFormDirty", () => {
  it("should be false for an untouched form", () => {
    const form = emptySecretForm();
    expect(isFormDirty(form, formSnapshot(form))).toBe(false);
  });

  it("should be true when the form differs from its baseline", () => {
    const form = emptySecretForm();
    form.rows[0].value = "edited";
    expect(isFormDirty(form, formSnapshot(emptySecretForm()))).toBe(true);
  });
});

describe("persistedFormBaseline", () => {
  it("should provide the persisted state of an existing secret", () => {
    const secret = { name: "app", data: { A: "1" } };
    expect(persistedFormBaseline(secret)).toBe(
      formSnapshot({
        name: "app",
        rows: [{ key: "A", value: "1" }],
      }),
    );
  });

  it("should provide an empty creation form when the secret no longer exists", () => {
    expect(persistedFormBaseline(null)).toBe(formSnapshot(emptySecretForm()));
  });

  it("should keep a restored draft dirty so the close guard fires (L7)", () => {
    const secret = { name: "app", data: { A: "persisted" } };
    const restoredForm = {
      name: "app",
      rows: [{ key: "A", value: "unsaved draft value" }],
    };
    const baseline = persistedFormBaseline(secret);
    expect(isFormDirty(restoredForm, baseline)).toBe(true);
  });

  it("should keep a restored draft of a deleted secret dirty (L7)", () => {
    const restoredForm = {
      name: "gone",
      rows: [{ key: "A", value: "unsaved draft value" }],
    };
    expect(isFormDirty(restoredForm, persistedFormBaseline(null))).toBe(true);
  });

  it("should not report a draft identical to the persisted secret as dirty", () => {
    const secret = { name: "app", data: { A: "same" } };
    const restoredForm = { name: "app", rows: [{ key: "A", value: "same" }] };
    expect(isFormDirty(restoredForm, persistedFormBaseline(secret))).toBe(false);
  });
});

describe("conflict detection", () => {
  it("should detect a secret version conflict", () => {
    expect(
      isSecretVersionConflict({
        response: { data: { code: "SECRET_VERSION_CONFLICT" } },
      }),
    ).toBe(true);
    expect(
      isSecretVersionConflict({ response: { data: { code: "OTHER" } } }),
    ).toBe(false);
    expect(isSecretVersionConflict(new Error("boom"))).toBe(false);
  });

  it("should detect a secret name conflict", () => {
    expect(
      isSecretNameConflict({
        response: { data: { code: "SECRET_NAME_CONFLICT" } },
      }),
    ).toBe(true);
    expect(isSecretNameConflict(null)).toBe(false);
  });
});
