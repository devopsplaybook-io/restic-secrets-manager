const DRAFT_STORAGE_KEY = "secretDraft";

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
}

export function saveSecretDraft(draft: SecretDraft): void {
  try {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage unavailable or full: lost-work protection is best effort
  }
}

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
      typeof parsed.savedAt !== "string"
    ) {
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
    };
  } catch {
    return null;
  }
}

export function clearSecretDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // sessionStorage unavailable: nothing to clear
  }
}
