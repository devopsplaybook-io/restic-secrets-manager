import type { Span } from "@opentelemetry/sdk-trace";
import {
  User,
  UsersDataList,
  UsersDataUpdateUser,
} from "@devopsplaybook.io/common-utils";
import { OTelLogger } from "../OTelContext";
import { ProjectsDataList } from "./ProjectsData";

const logger = OTelLogger().createModuleLogger("project-scopes");

/** Prefix of the user scope granting access to a project. */
export const PROJECT_SCOPE_PREFIX = "project:";

/**
 * Interval of the background refresh of the known project scopes. Keeps
 * every replica aligned with project creates/deletes made by the others,
 * which common-utils cannot see because it validates against the
 * process-local `User.ALL_SCOPES`.
 */
export const PROJECT_SCOPES_REFRESH_INTERVAL_MS = 30_000;

/** Bumped by local scope writes, so an in-flight refresh cannot undo them. */
let scopesRevision = 0;
let refreshInFlight: Promise<boolean> | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

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

/**
 * Reload the known project scopes from the database. Concurrent calls share
 * the same query (single flight); a database failure keeps the last known
 * list so a transient error never clears the scopes. A local write made
 * while the query ran wins over the fetched list: the next refresh
 * reconciles with the database.
 */
export function ProjectScopesRefresh(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const revisionAtStart = scopesRevision;
  const run = (async (): Promise<boolean> => {
    try {
      const projects = await ProjectsDataList();
      if (scopesRevision !== revisionAtStart) {
        return false;
      }
      User.ALL_SCOPES = projects.map((p) => projectScope(p.id));
      return true;
    } catch (e) {
      logger.error(
        "Failed to refresh the project scopes; keeping the last known list",
        e,
      );
      return false;
    }
  })();
  refreshInFlight = run.finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Start the periodic refresh (no-op when already started). */
export function ProjectScopesRefreshStart(
  intervalMs: number = PROJECT_SCOPES_REFRESH_INTERVAL_MS,
): void {
  if (refreshTimer) {
    return;
  }
  refreshTimer = setInterval(() => {
    void ProjectScopesRefresh();
  }, intervalMs);
  // Never keep the process alive just for the refresh
  refreshTimer.unref();
  logger.info(`Project scope refresh started (every ${intervalMs} ms)`);
}

/** Stop the periodic refresh. */
export function ProjectScopesRefreshStop(): void {
  if (!refreshTimer) {
    return;
  }
  clearInterval(refreshTimer);
  refreshTimer = null;
}

/** Register a new project scope in the set of known scopes. */
export function ProjectScopesAdd(projectId: string): void {
  const scope = projectScope(projectId);
  if (!User.ALL_SCOPES.includes(scope)) {
    User.ALL_SCOPES = [...User.ALL_SCOPES, scope];
  }
  scopesRevision += 1;
}

/** Remove a deleted project scope from the set of known scopes. */
export function ProjectScopesRemove(projectId: string): void {
  const scope = projectScope(projectId);
  User.ALL_SCOPES = User.ALL_SCOPES.filter((s) => s !== scope);
  scopesRevision += 1;
}

/**
 * Remove a deleted project scope from the stored user records, so users
 * do not keep a scope pointing at a project that no longer exists.
 */
export async function ProjectScopesPruneFromUsers(
  context: Span | undefined,
  projectId: string,
): Promise<void> {
  const scope = projectScope(projectId);
  const users = await UsersDataList(context);
  for (const user of users) {
    if (user.scopes?.includes(scope)) {
      user.scopes = user.scopes.filter((s) => s !== scope);
      await UsersDataUpdateUser(context, user);
    }
  }
}
