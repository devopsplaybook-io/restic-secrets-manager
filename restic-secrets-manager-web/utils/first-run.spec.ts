import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissFirstRunChecklist,
  isFirstRunChecklistDismissed,
  isFirstRunComplete,
  isCreateProjectStepDone,
  isGrantAccessStepDone,
  isSyncSecretsStepDone,
  FIRST_RUN_CHECKLIST_DISMISS_KEY,
} from "./first-run";

const project = (overrides = {}) => ({
  id: "p1",
  lastSyncSnapshotTime: "",
  ...overrides,
});

const user = (overrides = {}) => ({
  id: "u1",
  role: "user",
  scopes: [],
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe("isCreateProjectStepDone", () => {
  it("should be undone when there is no project", () => {
    expect(isCreateProjectStepDone([])).toBe(false);
  });

  it("should be done when at least one project exists", () => {
    expect(isCreateProjectStepDone([project()])).toBe(true);
  });
});

describe("isGrantAccessStepDone", () => {
  it("should be undone when no user holds a project scope", () => {
    expect(
      isGrantAccessStepDone([user(), user({ role: "admin", scopes: ["project:p1"] })]),
    ).toBe(false);
  });

  it("should be done when a non-admin user holds a project scope", () => {
    expect(
      isGrantAccessStepDone([user({ scopes: ["project:p1"] })]),
    ).toBe(true);
  });
});

describe("isSyncSecretsStepDone", () => {
  it("should be undone when no project was ever synchronized", () => {
    expect(isSyncSecretsStepDone([project(), project({ id: "p2" })])).toBe(
      false,
    );
  });

  it("should be done when any project has a last synchronization time", () => {
    expect(
      isSyncSecretsStepDone([
        project(),
        project({ id: "p2", lastSyncSnapshotTime: "2026-10-18T10:00:00Z" }),
      ]),
    ).toBe(true);
  });
});

describe("isFirstRunComplete", () => {
  it("should be incomplete at the start", () => {
    expect(isFirstRunComplete([], [])).toBe(false);
  });

  it("should be incomplete while a step is missing", () => {
    const projects = [project({ lastSyncSnapshotTime: "2026-10-18T10:00:00Z" })];
    expect(isFirstRunComplete(projects, [])).toBe(false);
  });

  it("should be complete once every step is done", () => {
    const projects = [project({ lastSyncSnapshotTime: "2026-10-18T10:00:00Z" })];
    const users = [user({ scopes: ["project:p1"] })];
    expect(isFirstRunComplete(projects, users)).toBe(true);
  });
});

describe("checklist dismissal", () => {
  it("should not be dismissed by default", () => {
    expect(isFirstRunChecklistDismissed()).toBe(false);
  });

  it("should persist the dismissal under the shared key", () => {
    dismissFirstRunChecklist();
    expect(isFirstRunChecklistDismissed()).toBe(true);
    expect(localStorage.getItem(FIRST_RUN_CHECKLIST_DISMISS_KEY)).toBe("1");
  });
});
