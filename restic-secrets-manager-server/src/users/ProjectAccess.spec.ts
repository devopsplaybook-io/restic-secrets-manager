import {
  AUTH_ERROR_CODE_FORBIDDEN,
  AUTH_ERROR_CODE_UNAUTHENTICATED,
  User,
} from "@devopsplaybook.io/common-utils";
import {
  ProjectAccessCanAccess,
  ProjectAccessCanAccessMany,
  ProjectAccessEnsure,
  ProjectAccessGetUser,
} from "./ProjectAccess";

function fakeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function liveUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = "user-1";
  user.name = "user";
  user.role = "user";
  user.scopes = [];
  return Object.assign(user, overrides);
}

describe("ProjectAccessCanAccess", () => {
  it("should grant live admins access to all projects", () => {
    expect(ProjectAccessCanAccess(liveUser({ role: "admin" }), "project-1"))
      .toBe(true);
  });

  it("should grant access to users with the project scope", () => {
    expect(
      ProjectAccessCanAccess(
        liveUser({ scopes: ["project:project-1"] }),
        "project-1",
      ),
    ).toBe(true);
  });

  it("should deny users without the project scope", () => {
    expect(
      ProjectAccessCanAccess(
        liveUser({ scopes: ["project:other-project"] }),
        "project-1",
      ),
    ).toBe(false);
  });

  it("should deny users with no scopes by default", () => {
    expect(ProjectAccessCanAccess(liveUser(), "project-1")).toBe(false);
  });

  it("should deny a missing live user", () => {
    expect(ProjectAccessCanAccess(null as unknown as User, "project-1")).toBe(
      false,
    );
  });

  it("should only consider the live role, never a token claim", () => {
    // A token that still claims "admin" is irrelevant here: the helper only
    // sees the live user, whose role was demoted to "user".
    const demoted = liveUser({ role: "user", scopes: [] });
    expect(ProjectAccessCanAccess(demoted, "project-1")).toBe(false);
  });
});

describe("ProjectAccessCanAccessMany", () => {
  it("should return every project for live admins", () => {
    const visible = ProjectAccessCanAccessMany(liveUser({ role: "admin" }), [
      "p1",
      "p2",
    ]);
    expect(visible).toEqual(new Set(["p1", "p2"]));
  });

  it("should filter the projects by the live scopes", () => {
    const visible = ProjectAccessCanAccessMany(
      liveUser({ scopes: ["project:p1"] }),
      ["p1", "p2"],
    );
    expect(visible).toEqual(new Set(["p1"]));
  });

  it("should return no project without scopes", () => {
    expect(ProjectAccessCanAccessMany(liveUser(), ["p1"])).toEqual(new Set());
  });

  it("should return no project for a missing live user", () => {
    expect(
      ProjectAccessCanAccessMany(null as unknown as User, ["p1"]),
    ).toEqual(new Set());
  });
});

describe("ProjectAccessGetUser", () => {
  it("should return the live user without responding", async () => {
    const res = fakeRes();
    const user = liveUser();
    const api = { GetLiveUser: jest.fn().mockResolvedValue(user) };
    await expect(ProjectAccessGetUser({}, res, api)).resolves.toBe(user);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it("should send 401 with the UNAUTHENTICATED code for a deleted or expired user", async () => {
    const res = fakeRes();
    const api = { GetLiveUser: jest.fn().mockResolvedValue(null) };
    await expect(ProjectAccessGetUser({}, res, api)).resolves.toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({
      error: "Authentication Required",
      code: AUTH_ERROR_CODE_UNAUTHENTICATED,
    });
  });
});

describe("ProjectAccessEnsure", () => {
  it("should send 401 and return null when unauthenticated", async () => {
    const res = fakeRes();
    const api = { GetLiveUser: jest.fn().mockResolvedValue(null) };
    await expect(ProjectAccessEnsure({}, res, "project-1", api)).resolves.toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({
      error: "Authentication Required",
      code: AUTH_ERROR_CODE_UNAUTHENTICATED,
    });
  });

  it("should send 403 with the FORBIDDEN code for a live user without access", async () => {
    const res = fakeRes();
    const api = {
      GetLiveUser: jest
        .fn()
        .mockResolvedValue(liveUser({ scopes: ["project:other"] })),
    };
    await expect(ProjectAccessEnsure({}, res, "project-1", api)).resolves.toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({
      error: "Access Denied",
      code: AUTH_ERROR_CODE_FORBIDDEN,
    });
  });

  it("should return the live admin without responding", async () => {
    const res = fakeRes();
    const user = liveUser({ role: "admin" });
    const api = { GetLiveUser: jest.fn().mockResolvedValue(user) };
    await expect(ProjectAccessEnsure({}, res, "project-1", api)).resolves.toBe(user);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it("should return the live user with the project scope", async () => {
    const res = fakeRes();
    const user = liveUser({ scopes: ["project:project-1"] });
    const api = { GetLiveUser: jest.fn().mockResolvedValue(user) };
    await expect(ProjectAccessEnsure({}, res, "project-1", api)).resolves.toBe(user);
    expect(res.status).not.toHaveBeenCalled();
  });
});
