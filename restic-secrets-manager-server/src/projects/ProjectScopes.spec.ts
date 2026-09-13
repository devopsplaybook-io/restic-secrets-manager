import { User } from "@devopsplaybook.io/common-utils";
import {
  projectScope,
  PROJECT_SCOPE_PREFIX,
  ProjectScopesAdd,
  ProjectScopesRemove,
} from "./ProjectScopes";

describe("projectScope", () => {
  it("should prefix the project id", () => {
    expect(projectScope("abc")).toBe("project:abc");
    expect(PROJECT_SCOPE_PREFIX).toBe("project:");
  });
});

describe("ProjectScopesAdd", () => {
  it("should add the project scope to ALL_SCOPES", () => {
    const original = [...User.ALL_SCOPES];
    ProjectScopesAdd("test-project-1");
    expect(User.ALL_SCOPES).toContain("project:test-project-1");
    User.ALL_SCOPES = original;
  });

  it("should not duplicate an existing scope", () => {
    const original = [...User.ALL_SCOPES];
    User.ALL_SCOPES = ["project:test-project-2"];
    ProjectScopesAdd("test-project-2");
    expect(User.ALL_SCOPES).toEqual(["project:test-project-2"]);
    User.ALL_SCOPES = original;
  });
});

describe("ProjectScopesRemove", () => {
  it("should remove the project scope from ALL_SCOPES", () => {
    const original = [...User.ALL_SCOPES];
    User.ALL_SCOPES = ["project:test-project-3", "project:other"];
    ProjectScopesRemove("test-project-3");
    expect(User.ALL_SCOPES).toEqual(["project:other"]);
    User.ALL_SCOPES = original;
  });
});
