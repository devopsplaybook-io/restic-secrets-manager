import { SecretData } from "../model/Secret";

// Serializes secret data as a .env file: KEY=value per line, values that would
// be altered by the format (newline, tabs, quotes, surrounding spaces) wrapped
// in double quotes with escapes understood by the .env import.
export function secretDataToEnvContent(data: SecretData): string {
  const lines = Object.keys(data).map(
    (key) => `${key}=${escapeEnvValue(data[key])}`,
  );
  return lines.join("\n") + "\n";
}

function escapeEnvValue(value: string): string {
  if (
    value.includes("\n") ||
    value.includes("\t") ||
    value.includes('"') ||
    value !== value.trim()
  ) {
    return `"${value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")}"`;
  }
  return value;
}

export function secretDataToJsonContent(data: SecretData): string {
  return JSON.stringify(data, null, 2) + "\n";
}
