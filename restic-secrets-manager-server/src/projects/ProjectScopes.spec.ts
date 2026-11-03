import { User } from "@devopsplaybook.io/common-utils";
import {
  projectScope,
  PROJECT_SCOPE_PREFIX,
  ProjectScopesAdd,
  ProjectScopesPruneFromUsers,
  ProjectScopesRefresh,
  ProjectScopesRefreshStart,
  ProjectScopesRefreshStop,
  ProjectScopesRemove,
} from "./ProjectScopes";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  UsersDataList: jest.fn(),
  UsersDataUpdateUser: jest.fn(),
}));

jest.mock("./ProjectsData", () => ({
  ProjectsDataList: jest.fn(),
}));

const commonUtils = jest.requireMock("@devopsplaybook.io/common-utils");
const projectsData = jest.requireMock("./ProjectsData");
const projectsListMock = projectsData.ProjectsDataList as jest.Mock;

afterEach(() => {
  ProjectScopesRefreshStop();
  jest.restoreAllMocks();
});

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

describe("ProjectScopesRefresh", () => {
  beforeEach(() => {
    projectsListMock.mockReset();
  });

  it("should apply the database list and drop a project deleted elsewhere", async () => {
    const original = [...User.ALL_SCOPES];
    User.ALL_SCOPES = ["project:a"];

    projectsListMock.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(ProjectScopesRefresh()).resolves.toBe(true);
    expect(User.ALL_SCOPES).toEqual(["project:a", "project:b"]);

    // project:b was deleted on another replica
    projectsListMock.mockResolvedValue([{ id: "a" }]);
    await expect(ProjectScopesRefresh()).resolves.toBe(true);
    expect(User.ALL_SCOPES).toEqual(["project:a"]);

    User.ALL_SCOPES = original;
  });

  it("should keep the last good list when the database query fails", async () => {
    const original = [...User.ALL_SCOPES];
    User.ALL_SCOPES = ["project:a"];

    projectsListMock.mockRejectedValue(new Error("database unavailable"));
    await expect(ProjectScopesRefresh()).resolves.toBe(false);

    expect(User.ALL_SCOPES).toEqual(["project:a"]);
    User.ALL_SCOPES = original;
  });

  it("should share one query between concurrent refreshes", async () => {
    const original = [...User.ALL_SCOPES];
    let resolveProjects: (projects: unknown[]) => void = () => undefined;
    projectsListMock.mockReturnValue(
      new Promise((resolve) => {
        resolveProjects = resolve;
      }),
    );

    const first = ProjectScopesRefresh();
    const second = ProjectScopesRefresh();
    expect(projectsListMock).toHaveBeenCalledTimes(1);

    resolveProjects([{ id: "a" }]);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);

    User.ALL_SCOPES = original;
  });

  it("should not let an in-flight refresh undo a local write", async () => {
    const original = [...User.ALL_SCOPES];
    User.ALL_SCOPES = ["project:a"];
    let resolveProjects: (projects: unknown[]) => void = () => undefined;
    projectsListMock.mockReturnValue(
      new Promise((resolve) => {
        resolveProjects = resolve;
      }),
    );

    const refresh = ProjectScopesRefresh();
    // The create route updates the list locally before the query returns
    ProjectScopesAdd("local");
    resolveProjects([{ id: "a" }]);

    await expect(refresh).resolves.toBe(false);
    expect(User.ALL_SCOPES).toEqual(["project:a", "project:local"]);

    User.ALL_SCOPES = original;
  });

  it("should run the refresh on an unref'd interval until stopped", async () => {
    const original = [...User.ALL_SCOPES];
    projectsListMock.mockResolvedValue([]);
    const handle = { unref: jest.fn() };
    const setIntervalSpy = jest
      .spyOn(global, "setInterval")
      .mockReturnValue(handle as unknown as NodeJS.Timeout);
    const clearIntervalSpy = jest
      .spyOn(global, "clearInterval")
      .mockImplementation(() => undefined);

    ProjectScopesRefreshStart(1000);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(1000);
    expect(handle.unref).toHaveBeenCalledTimes(1);

    // A second start does not create another interval
    ProjectScopesRefreshStart(1000);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    const tick = setIntervalSpy.mock.calls[0][0] as () => void;
    tick();
    expect(projectsListMock).toHaveBeenCalledTimes(1);
    // Let the scheduled refresh settle before the next test
    await new Promise((resolve) => setImmediate(resolve));

    ProjectScopesRefreshStop();
    expect(clearIntervalSpy).toHaveBeenCalledWith(handle);

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
