import { SecretData } from "../model/Secret";

// Canonical .env key rule: environment variable names are portable only when
// they match this pattern. Storage stays permissive; the .env export/import
// boundary enforces it and points at the JSON export as a fallback.
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isEnvSafeKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

/** Raised when secret data cannot be represented as a valid .env file. */
export class SecretEnvError extends Error {
  public readonly invalidKeys: string[];

  constructor(invalidKeys: string[]) {
    super(
      `Cannot export as .env: invalid key(s) ${invalidKeys
        .map((key) => JSON.stringify(key))
        .join(", ")}. Keys must match ${ENV_KEY_PATTERN.source}. Use the JSON export instead.`,
    );
    this.name = "SecretEnvError";
    this.invalidKeys = invalidKeys;
  }
}

/**
 * Serializes secret data as a .env file: KEY=value per line. Values that the
 * format would alter (empty, whitespace, quotes, backslashes, `#`, `=`, or
 * control characters) are wrapped in double quotes with escapes understood
 * by the .env import (\\, \", \n, \r, \t and \uXXXX for other control
 * characters). Unicode passes through unchanged. Invalid keys are rejected so
 * an invalid file is never emitted silently.
 */
export function secretDataToEnvContent(data: SecretData): string {
  const keys = Object.keys(data);
  const invalidKeys = keys.filter((key) => !isEnvSafeKey(key));
  if (invalidKeys.length > 0) {
    throw new SecretEnvError(invalidKeys);
  }
  if (keys.length === 0) {
    return "";
  }
  return keys.map((key) => `${key}=${escapeEnvValue(data[key])}`).join("\n") + "\n";
}

function escapeEnvValue(value: string): string {
  if (!needsQuoting(value)) {
    return value;
  }
  let escaped = "";
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    switch (char) {
      case "\\":
        escaped += "\\\\";
        break;
      case '"':
        escaped += '\\"';
        break;
      case "\n":
        escaped += "\\n";
        break;
      case "\r":
        escaped += "\\r";
        break;
      case "\t":
        escaped += "\\t";
        break;
      default:
        if (code <= 0x1f || code === 0x7f) {
          escaped += `\\u${code.toString(16).padStart(4, "0")}`;
        } else {
          escaped += char;
        }
    }
  }
  return `"${escaped}"`;
}

function needsQuoting(value: string): boolean {
  if (value.length === 0) {
    return true;
  }
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
    if (
      char === '"' ||
      char === "'" ||
      char === "\\" ||
      char === "#" ||
      char === "="
    ) {
      return true;
    }
  }
  return false;
}

export function secretDataToJsonContent(data: SecretData): string {
  return JSON.stringify(data, null, 2) + "\n";
}
