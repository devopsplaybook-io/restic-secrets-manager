export interface SecretExportEntry {
  key: string;
  value: string;
}

// The .env serializer is not duplicated here: the web app downloads/copies
// .env content from the server export endpoint, which owns the escaping and
// the key validation. JSON stays local: it cannot alter any value.
export function secretToJsonContent(entries: SecretExportEntry[]): string {
  const data: Record<string, string> = {};
  for (const entry of entries) {
    data[entry.key] = entry.value;
  }
  return JSON.stringify(data, null, 2) + "\n";
}
