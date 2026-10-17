export interface SecretExportEntry {
  key: string;
  value: string;
}

// Serializes entries as a .env file: KEY=value per line, values that would be
// altered by the format (newline, tabs, quotes, surrounding spaces) wrapped in
// double quotes with escapes understood by the .env import.
export function secretToEnvContent(entries: SecretExportEntry[]): string {
  return (
    entries.map((entry) => `${entry.key}=${escapeEnvValue(entry.value)}`).join("\n") + "\n"
  );
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

export function secretToJsonContent(entries: SecretExportEntry[]): string {
  const data: Record<string, string> = {};
  for (const entry of entries) {
    data[entry.key] = entry.value;
  }
  return JSON.stringify(data, null, 2) + "\n";
}
