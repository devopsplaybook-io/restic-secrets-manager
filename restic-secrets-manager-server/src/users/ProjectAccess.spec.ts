import { UserSession } from "@devopsplaybook.io/common-utils";
import { ProjectAccessCanAccess, ProjectAccessEnsure } from "./ProjectAccess";

function fakeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function userSession(overrides: Partial<UserSession>): UserSession {
  const session: UserSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "user",
    role: "user",
    scopes: [],
  };
  return Object.assign(session, overrides);
}

describe("ProjectAccessCanAccess", () => {
  it("should grant admins access to all projects", async () => {
    const api = { GetUser: async () => null };
    expect(
      await ProjectAccessCanAccess(
        userSession({ role: "admin", scopes: [] }),
        "project-1",
        api,
      ),
    ).toBe(true);
  });

  it("should deny unauthenticated sessions", async () => {
    expect(
      await ProjectAccessCanAccess(
        userSession({ isAuthenticated: false }),
        "project-1",
        {},
      ),
    ).toBe(false);
  });

  it("should grant access to users with the project scope", async () => {
    const api = {
      GetUser: async () => ({ scopes: ["project:project-1"] }),
    };
    expect(
      await ProjectAccessCanAccess(userSession({}), "project-1", api),
    ).toBe(true);
  });

  it("should deny users without the project scope", async () => {
    const api = {
      GetUser: async () => ({ scopes: ["project:other-project"] }),
    };
    expect(
      await ProjectAccessCanAccess(userSession({}), "project-1", api),
    ).toBe(false);
  });

  it("should deny users with no scopes by default", async () => {
    const api = { GetUser: async () => ({ scopes: [] }) };
    expect(
      await ProjectAccessCanAccess(userSession({}), "project-1", api),
    ).toBe(false);
  });

  it("should deny unknown users", async () => {
    const api = { GetUser: async () => null };
    expect(
      await ProjectAccessCanAccess(userSession({}), "project-1", api),
    ).toBe(false);
  });
});

describe("ProjectAccessEnsure", () => {
  it("should send 403 and return false for unauthenticated sessions", async () => {
    const res = fakeRes();
    const api = {
      GetUserSession: async () => userSession({ isAuthenticated: false }),
    };
    await expect(
      ProjectAccessEnsure({}, res, "project-1", api),
    ).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({ error: "Access Denied" });
  });

  it("should send 403 and return false for users without the scope", async () => {
    const res = fakeRes();
    const api = {
      GetUserSession: async () => userSession({}),
      GetUser: async () => ({ scopes: ["project:other"] }),
    };
    await expect(
      ProjectAccessEnsure({}, res, "project-1", api),
    ).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("should return true for admins without responding", async () => {
    const res = fakeRes();
    const api = {
      GetUserSession: async () => userSession({ role: "admin" }),
    };
    await expect(
      ProjectAccessEnsure({}, res, "project-1", api),
    ).resolves.toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it("should return true for users with the project scope", async () => {
    const res = fakeRes();
    const api = {
      GetUserSession: async () => userSession({}),
      GetUser: async () => ({ scopes: ["project:project-1"] }),
    };
    await expect(
      ProjectAccessEnsure({}, res, "project-1", api),
    ).resolves.toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });
});
