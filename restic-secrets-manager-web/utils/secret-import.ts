export interface SecretImportRow {
  key: string;
  value: string;
}

export interface SecretImportResult {
  rows: SecretImportRow[];
  warnings: string[];
}

// Parses pasted content as JSON (flat object of scalar values) or as a .env
// file, into key/value rows. Throws an Error with a user-safe message when the
// input cannot be parsed.
export function parseSecretImport(text: string): SecretImportResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("Nothing to import: paste .env or JSON content first");
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonImport(trimmed);
  }
  return parseEnvImport(text);
}

function parseJsonImport(trimmed: string): SecretImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Invalid JSON: the pasted content is not valid JSON");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error("Invalid JSON import: a flat JSON object is expected");
  }
  const rows: SecretImportRow[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key.length === 0) {
      throw new Error("Invalid JSON import: empty key");
    }
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new Error(
        `Invalid JSON import: value for key '${key}' must be a scalar`,
      );
    }
    rows.push({ key, value: String(value) });
  }
  return { rows, warnings: [] };
}

function parseEnvImport(text: string): SecretImportResult {
  const rows: SecretImportRow[] = [];
  const warnings: string[] = [];
  const byKey = new Map<string, SecretImportRow>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) {
      throw new Error(`Invalid .env line ${i + 1}: expected KEY=value`);
    }
    const key = withoutExport.slice(0, eq).trim();
    if (key.length === 0) {
      throw new Error(`Invalid .env line ${i + 1}: the key is empty`);
    }
    let value = withoutExport.slice(eq + 1).trim();
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = unescapeDoubleQuoted(value.slice(1, -1));
    }
    if (byKey.has(key)) {
      warnings.push(`Duplicate key '${key}': the last value wins`);
      const existing = byKey.get(key)!;
      existing.value = value;
    } else {
      const row: SecretImportRow = { key, value };
      byKey.set(key, row);
      rows.push(row);
    }
  }
  if (rows.length === 0) {
    throw new Error("Nothing to import: no KEY=value line found");
  }
  return { rows, warnings };
}

// Single pass so that an escaped backslash never turns into an escape prefix
function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(.)/g, (match, ch: string) => {
    switch (ch) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case '"':
        return '"';
      case "\\":
        return "\\";
      default:
        return match;
    }
  });
}
