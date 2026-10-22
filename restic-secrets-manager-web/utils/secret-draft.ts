const DRAFT_STORAGE_KEY = "secretDraft";

/** Unsaved edits kept across a session expiry expire after 15 minutes. */
export const SECRET_DRAFT_TTL_MS = 15 * 60 * 1000;

export interface SecretDraftRow {
  key: string;
  value: string;
}

export interface SecretDraft {
  projectId: string;
  secretId: string | null;
  name: string;
  rows: SecretDraftRow[];
  savedAt: string;
  /** Drafts are bound to their owner: they never survive a user change. */
  userId: string;
}

export function saveSecretDraft(draft: SecretDraft): void {
  try {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage unavailable or full: lost-work protection is best effort
  }
}

/**
 * Loads the stored draft. Expired (older than {@link SECRET_DRAFT_TTL_MS})
 * or malformed drafts are removed and return null.
 */
export function loadSecretDraft(): SecretDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SecretDraft> | null;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof parsed.projectId !== "string" ||
      (parsed.secretId !== null && typeof parsed.secretId !== "string") ||
      typeof parsed.name !== "string" ||
      !Array.isArray(parsed.rows) ||
      typeof parsed.savedAt !== "string" ||
      typeof parsed.userId !== "string" ||
      parsed.userId.length === 0
    ) {
      clearSecretDraft();
      return null;
    }
    const savedAt = Date.parse(parsed.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > SECRET_DRAFT_TTL_MS) {
      clearSecretDraft();
      return null;
    }
    const rows: SecretDraftRow[] = [];
    for (const row of parsed.rows) {
      if (
        row === null ||
        typeof row !== "object" ||
        typeof row.key !== "string" ||
        typeof row.value !== "string"
      ) {
        clearSecretDraft();
        return null;
      }
      rows.push({ key: row.key, value: row.value });
    }
    return {
      projectId: parsed.projectId,
      secretId: parsed.secretId ?? null,
      name: parsed.name,
      rows,
      savedAt: parsed.savedAt,
      userId: parsed.userId,
    };
  } catch {
    clearSecretDraft();
    return null;
  }
}

/**
 * Consumes the stored draft: the storage entry is always cleared and only a
 * valid, unexpired draft belonging to `userId` is returned.
 */
export function takeSecretDraftForUser(userId: string): SecretDraft | null {
  const draft = loadSecretDraft();
  clearSecretDraft();
  if (draft && draft.userId === userId) {
    return draft;
  }
  return null;
}

export function clearSecretDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // sessionStorage unavailable: nothing to clear
  }
}
