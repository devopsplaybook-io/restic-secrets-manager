// Canonical .env key rule, mirroring the server export: storage accepts any
// key, but only these keys can be represented in a .env file.
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SecretFormRow {
  key: string;
  value: string;
}

export function isEnvSafeKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

export function nonEnvSafeKeys(keys: Iterable<string>): string[] {
  const invalid: string[] = [];
  for (const key of keys) {
    if (!isEnvSafeKey(key)) {
      invalid.push(key);
    }
  }
  return invalid;
}

/** Non-blocking editor warning for keys that cannot be exported as .env. */
export function envKeyWarning(invalidKeys: string[]): string {
  if (invalidKeys.length === 0) {
    return "";
  }
  return `Keys not valid in a .env file: ${invalidKeys
    .map((key) => JSON.stringify(key))
    .join(", ")}. Use the JSON export instead. Keys must match ${ENV_KEY_PATTERN.source}.`;
}

export interface BuiltSecretData {
  data: Record<string, string>;
  error: string;
  warning: string;
}

/**
 * Turns the editor rows into the secret data map: trims keys, rejects
 * duplicates and reports (without blocking) keys that the .env format cannot
 * represent.
 */
export function buildSecretData(rows: SecretFormRow[]): BuiltSecretData {
  const data: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (key.length === 0) {
      continue;
    }
    if (seen.has(key)) {
      return {
        data: {},
        error: `Duplicate key '${key}': each key must appear only once`,
        warning: "",
      };
    }
    seen.add(key);
    data[key] = row.value;
  }
  return {
    data,
    error: "",
    warning: envKeyWarning(nonEnvSafeKeys(Object.keys(data))),
  };
}
