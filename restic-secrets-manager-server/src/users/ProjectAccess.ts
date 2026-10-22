import {
  AUTH_ERROR_CODE_FORBIDDEN,
  AUTH_ERROR_CODE_UNAUTHENTICATED,
  AuthGetLiveUser,
  User,
} from "@devopsplaybook.io/common-utils";
import { projectScope } from "../projects/ProjectScopes";

/**
 * Indirection point over the auth layer so tests can stub it.
 * The live user is resolved from the database by the guards; the role and
 * scopes carried by the JWT are display data only and must never be used
 * for authorization.
 */
export const ProjectAccessApi = {
  GetLiveUser: (req: unknown): Promise<User | null> => AuthGetLiveUser(req),
};

/**
 * Returns the live user of the request, or sends a 401 and returns null
 * when the request is unauthenticated, the user was deleted or the session
 * was invalidated.
 */
export async function ProjectAccessGetUser(
  req: any,
  res: any,
  api: any = ProjectAccessApi,
): Promise<User | null> {
  const user = await api.GetLiveUser(req);
  if (!user) {
    res.status(401).send({
      error: "Authentication Required",
      code: AUTH_ERROR_CODE_UNAUTHENTICATED,
    });
    return null;
  }
  return user;
}

/**
 * Returns true when the live user is allowed to access the project.
 * Admins can access all projects; regular users need the project scope.
 */
export function ProjectAccessCanAccess(user: User, projectId: string): boolean {
  if (!user) {
    return false;
  }
  if (user.role === "admin") {
    return true;
  }
  const scopes = user.scopes || [];
  return scopes.includes(projectScope(projectId));
}

/**
 * Returns the ids of the projects the live user is allowed to access among
 * the provided ones (list views).
 */
export function ProjectAccessCanAccessMany(
  user: User,
  projectIds: string[],
): Set<string> {
  if (!user) {
    return new Set();
  }
  if (user.role === "admin") {
    return new Set(projectIds);
  }
  const scopes = user.scopes || [];
  return new Set(
    projectIds.filter((projectId) => scopes.includes(projectScope(projectId))),
  );
}

/**
 * Ensures the current request is authenticated AND allowed to access the
 * given project. Sends 401 when unauthenticated and 403 when forbidden, then
 * returns null; callers must return without responding again. On success the
 * live user is returned.
 */
export async function ProjectAccessEnsure(
  req: any,
  res: any,
  projectId: string,
  api: any = ProjectAccessApi,
): Promise<User | null> {
  const user = await ProjectAccessGetUser(req, res, api);
  if (!user) {
    return null;
  }
  if (!ProjectAccessCanAccess(user, projectId)) {
    res.status(403).send({
      error: "Access Denied",
      code: AUTH_ERROR_CODE_FORBIDDEN,
    });
    return null;
  }
  return user;
}
