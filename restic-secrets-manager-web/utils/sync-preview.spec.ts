import { describe, expect, it } from "vitest";
import {
  keyValueHint,
  MASKED_VALUE,
  pusherLabel,
  statusIcon,
  statusLabel,
  summarizePreview,
} from "./sync-preview";

function preview(overrides = {}) {
  return {
    summary: {
      secretsAdded: 0,
      secretsRemoved: 0,
      secretsChanged: 0,
      keysAdded: 0,
      keysRemoved: 0,
      keysChanged: 0,
    },
    secrets: [],
    snapshotId: "abc12345",
    snapshotTime: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

describe("summarizePreview", () => {
  it("should report no change for an empty diff", () => {
    expect(summarizePreview(preview())).toBe(
      "No change: the secrets already match the target content.",
    );
  });

  it("should summarize added, changed and removed secrets with key counts", () => {
    const result = summarizePreview(
      preview({
        summary: {
          secretsAdded: 2,
          secretsRemoved: 1,
          secretsChanged: 1,
          keysAdded: 3,
          keysRemoved: 1,
          keysChanged: 2,
        },
      }),
    );
    expect(result).toBe("2 secrets added, 1 changed, 1 secret removed — 6 keys affected.");
  });

  it("should use the singular for a single secret or key", () => {
    const result = summarizePreview(
      preview({
        summary: {
          secretsAdded: 1,
          secretsRemoved: 0,
          secretsChanged: 0,
          keysAdded: 1,
          keysRemoved: 0,
          keysChanged: 0,
        },
      }),
    );
    expect(result).toBe("1 secret added — 1 key affected.");
  });

  it("should report unchanged secrets with affected keys", () => {
    const result = summarizePreview(
      preview({
        summary: {
          secretsAdded: 0,
          secretsRemoved: 0,
          secretsChanged: 0,
          keysAdded: 0,
          keysRemoved: 2,
          keysChanged: 0,
        },
      }),
    );
    expect(result).toBe("Secrets unchanged, 2 keys affected.");
  });
});

describe("keyValueHint", () => {
  it("should show the before → after lengths of a changed key", () => {
    expect(
      keyValueHint({ key: "K1", status: "changed", valueLengthBefore: 24, valueLengthAfter: 31 }),
    ).toBe("length 24 → 31");
  });

  it("should show the value length of an added or removed key", () => {
    expect(keyValueHint({ key: "K1", status: "added", valueLength: 12 })).toBe("length 12");
    expect(keyValueHint({ key: "K1", status: "removed", valueLength: 7 })).toBe("length 7");
  });

  it("should return an empty hint when no length is available", () => {
    expect(keyValueHint({ key: "K1", status: "changed" })).toBe("");
  });
});

describe("status labels and icons", () => {
  it("should label the diff statuses", () => {
    expect(statusLabel("added")).toBe("Added");
    expect(statusLabel("removed")).toBe("Removed");
    expect(statusLabel("changed")).toBe("Changed");
  });

  it("should pick an icon per status", () => {
    expect(statusIcon("added")).toBe("bi-plus-circle");
    expect(statusIcon("removed")).toBe("bi-dash-circle");
    expect(statusIcon("changed")).toBe("bi-pencil-fill");
  });
});

describe("pusherLabel", () => {
  it("should use the pushed-by attribution when known", () => {
    expect(pusherLabel({ pushedBy: "alice" })).toBe("alice");
    expect(pusherLabel({ pushedBy: "bob@laptop" })).toBe("bob@laptop");
  });

  it("should degrade to unknown pusher", () => {
    expect(pusherLabel({})).toBe("unknown pusher");
    expect(pusherLabel({ pushedBy: "" })).toBe("unknown pusher");
  });
});

describe("MASKED_VALUE", () => {
  it("should be a placeholder that is not empty", () => {
    expect(MASKED_VALUE.length).toBeGreaterThan(0);
  });
});
