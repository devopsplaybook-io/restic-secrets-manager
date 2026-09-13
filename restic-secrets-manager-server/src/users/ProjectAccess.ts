import {
  AuthGetUserSession,
  UserSession,
  UsersDataGet,
} from "@devopsplaybook.io/common-utils";
import { projectScope } from "../projects/ProjectScopes";

/**
 * Indirection points over the data/auth layers so tests can stub them.
 */
export const ProjectAccessApi = {
  GetUserSession: (req: unknown): Promise<UserSession> =>
    AuthGetUserSession(req),
  GetUser: (id: string) => UsersDataGet(undefined, id),
};

/**
 * Returns true when the user session is allowed to access the project.
 * Admins can access all projects; regular users need the project scope.
 * Authorization is checked against the database so access changes take
 * effect immediately without requiring a new session.
 */
export async function ProjectAccessCanAccess(
  userSession: UserSession,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any = ProjectAccessApi,
): Promise<boolean> {
  if (!userSession.isAuthenticated || !userSession.userId) {
    return false;
  }
  if (userSession.role === "admin") {
    return true;
  }
  const user = await api.GetUser(userSession.userId);
  if (!user) {
    return false;
  }
  const scopes: string[] = user.scopes || [];
  return scopes.includes(projectScope(projectId));
}

/**
 * Ensures the current request is authenticated AND allowed to access the
 * given project. Sends a 403 response and throws otherwise.
 */
export async function ProjectAccessEnsure(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any = ProjectAccessApi,
): Promise<void> {
  const userSession = await api.GetUserSession(req);
  if (!(await ProjectAccessCanAccess(userSession, projectId, api))) {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
}
