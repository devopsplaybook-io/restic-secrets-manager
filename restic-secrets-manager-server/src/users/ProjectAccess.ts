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
 * Returns the ids of the projects the session is allowed to access among
 * the provided ones, resolving the user record only once (list views).
 */
export async function ProjectAccessCanAccessMany(
  userSession: UserSession,
  projectIds: string[],
  api: any = ProjectAccessApi,
): Promise<Set<string>> {
  if (!userSession.isAuthenticated || !userSession.userId) {
    return new Set();
  }
  if (userSession.role === "admin") {
    return new Set(projectIds);
  }
  const user = await api.GetUser(userSession.userId);
  if (!user) {
    return new Set();
  }
  const scopes: string[] = user.scopes || [];
  return new Set(
    projectIds.filter((projectId) => scopes.includes(projectScope(projectId))),
  );
}

/**
 * Ensures the current request is authenticated AND allowed to access the
 * given project. Sends a 403 response and returns false when access is
 * denied; callers must return without responding again.
 */
export async function ProjectAccessEnsure(
  req: any,
  res: any,
  projectId: string,
  api: any = ProjectAccessApi,
): Promise<boolean> {
  const userSession = await api.GetUserSession(req);
  if (!(await ProjectAccessCanAccess(userSession, projectId, api))) {
    res.status(403).send({ error: "Access Denied" });
    return false;
  }
  return true;
}
