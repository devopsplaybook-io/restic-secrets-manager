import { UserSession } from "@devopsplaybook.io/common-utils";
import { ProjectAccessCanAccess } from "./ProjectAccess";

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
