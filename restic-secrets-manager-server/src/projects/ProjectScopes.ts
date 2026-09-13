import { User } from "@devopsplaybook.io/common-utils";
import { ProjectsDataList } from "./ProjectsData";

/** Prefix of the user scope granting access to a project. */
export const PROJECT_SCOPE_PREFIX = "project:";

/** Scope identifier granting a user access to a project. */
export function projectScope(projectId: string): string {
  return `${PROJECT_SCOPE_PREFIX}${projectId}`;
}

/**
 * Synchronize the common-utils User.ALL_SCOPES set with the existing
 * project scopes. This keeps scope filtering in the shared user
 * management routes (create/update user) aligned with the projects that
 * actually exist.
 */
export async function ProjectScopesSync(): Promise<void> {
  const projects = await ProjectsDataList();
  User.ALL_SCOPES = projects.map((p) => projectScope(p.id));
}

/** Register a new project scope in the set of known scopes. */
export function ProjectScopesAdd(projectId: string): void {
  const scope = projectScope(projectId);
  if (!User.ALL_SCOPES.includes(scope)) {
    User.ALL_SCOPES = [...User.ALL_SCOPES, scope];
  }
}

/** Remove a deleted project scope from the set of known scopes. */
export function ProjectScopesRemove(projectId: string): void {
  const scope = projectScope(projectId);
  User.ALL_SCOPES = User.ALL_SCOPES.filter((s) => s !== scope);
}
