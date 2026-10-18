export const FIRST_RUN_CHECKLIST_DISMISS_KEY = "firstRunChecklistDismissed";

export interface FirstRunProject {
  id: string;
  lastSyncSnapshotTime?: string;
}

export interface FirstRunUser {
  id?: string;
  role?: string;
  scopes?: string[];
}

/** Scope prefix granting a user access to one project. */
export const PROJECT_SCOPE_PREFIX = "project:";

export function isCreateProjectStepDone(projects: FirstRunProject[]): boolean {
  return projects.length > 0;
}

export function isGrantAccessStepDone(users: FirstRunUser[]): boolean {
  return users.some(
    (user) =>
      user.role !== "admin" &&
      (user.scopes || []).some((scope) =>
        scope.startsWith(PROJECT_SCOPE_PREFIX),
      ),
  );
}

export function isSyncSecretsStepDone(projects: FirstRunProject[]): boolean {
  return projects.some(
    (project) => !!project.lastSyncSnapshotTime,
  );
}

export function isFirstRunComplete(
  projects: FirstRunProject[],
  users: FirstRunUser[],
): boolean {
  return (
    isCreateProjectStepDone(projects) &&
    isGrantAccessStepDone(users) &&
    isSyncSecretsStepDone(projects)
  );
}

export function isFirstRunChecklistDismissed(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_CHECKLIST_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissFirstRunChecklist(): void {
  try {
    localStorage.setItem(FIRST_RUN_CHECKLIST_DISMISS_KEY, "1");
  } catch {
    // localStorage unavailable: dismissal is best effort
  }
}
