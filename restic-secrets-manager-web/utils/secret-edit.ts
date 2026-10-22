import type { SecretFormRow } from "./secret-keys";

export interface SecretFormState {
  name: string;
  rows: SecretFormRow[];
}

export interface SecretLike {
  id?: string;
  name: string;
  data: Record<string, string>;
  version?: number;
}

export function emptySecretForm(): SecretFormState {
  return { name: "", rows: [{ key: "", value: "" }] };
}

export function secretToForm(secret: SecretLike): SecretFormState {
  return {
    name: secret.name,
    rows: Object.keys(secret.data).map((key) => ({
      key,
      value: secret.data[key],
    })),
  };
}

export function formSnapshot(form: SecretFormState): string {
  return JSON.stringify({ name: form.name, rows: form.rows });
}

export function isFormDirty(form: SecretFormState, baseline: string): boolean {
  return formSnapshot(form) !== baseline;
}

/**
 * Snapshot of the persisted secret (or of an empty creation form). Restored
 * drafts and conflict reloads use it as the saved baseline, so the restored
 * or re-applied edits stay dirty and the unsaved-changes guard still fires.
 */
export function persistedFormBaseline(secret: SecretLike | null): string {
  return formSnapshot(secret ? secretToForm(secret) : emptySecretForm());
}

export function isSecretVersionConflict(error: unknown): boolean {
  return apiErrorCode(error) === "SECRET_VERSION_CONFLICT";
}

export function isSecretNameConflict(error: unknown): boolean {
  return apiErrorCode(error) === "SECRET_NAME_CONFLICT";
}

function apiErrorCode(error: unknown): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  const record =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : null;
  return typeof record?.code === "string" ? record.code : "";
}
