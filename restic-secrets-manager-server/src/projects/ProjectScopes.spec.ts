import { User } from "@devopsplaybook.io/common-utils";
import {
  projectScope,
  PROJECT_SCOPE_PREFIX,
  ProjectScopesAdd,
  ProjectScopesPruneFromUsers,
  ProjectScopesRemove,
} from "./ProjectScopes";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  UsersDataList: jest.fn(),
  UsersDataUpdateUser: jest.fn(),
}));

const commonUtils = jest.requireMock("@devopsplaybook.io/common-utils");

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

describe("ProjectScopesPruneFromUsers", () => {
  beforeEach(() => {
    commonUtils.UsersDataList.mockReset();
    commonUtils.UsersDataUpdateUser.mockReset();
  });

  it("should rewrite only the users holding the deleted project scope", async () => {
    const holder = { id: "u1", scopes: ["project:dead", "project:other"] };
    const untouched = { id: "u2", scopes: ["project:other"] };
    const withoutScopes = { id: "u3" };
    commonUtils.UsersDataList.mockResolvedValue([
      holder,
      untouched,
      withoutScopes,
    ]);
    commonUtils.UsersDataUpdateUser.mockResolvedValue(undefined);

    await ProjectScopesPruneFromUsers(undefined, "dead");

    expect(holder.scopes).toEqual(["project:other"]);
    expect(untouched.scopes).toEqual(["project:other"]);
    expect(commonUtils.UsersDataUpdateUser).toHaveBeenCalledTimes(1);
    expect(commonUtils.UsersDataUpdateUser).toHaveBeenCalledWith(
      undefined,
      holder,
    );
  });

  it("should not write anything when no user holds the scope", async () => {
    commonUtils.UsersDataList.mockResolvedValue([
      { id: "u1", scopes: ["project:other"] },
    ]);

    await ProjectScopesPruneFromUsers(undefined, "dead");

    expect(commonUtils.UsersDataUpdateUser).not.toHaveBeenCalled();
  });
});
