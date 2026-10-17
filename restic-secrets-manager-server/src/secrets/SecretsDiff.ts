import { Secret } from "../model/Secret";

export type SecretDiffStatus = "added" | "removed" | "changed";

export interface SecretKeyDiff {
  key: string;
  status: SecretDiffStatus;
  /** Length of the value for added/removed keys. */
  valueLength?: number;
  /** Lengths of the values for changed keys (before → after). */
  valueLengthBefore?: number;
  valueLengthAfter?: number;
}

export interface SecretDiff {
  name: string;
  status: SecretDiffStatus;
  keys: SecretKeyDiff[];
}

export interface SecretsDiffSummary {
  secretsAdded: number;
  secretsRemoved: number;
  secretsChanged: number;
  keysAdded: number;
  keysRemoved: number;
  keysChanged: number;
}

/**
 * Structural difference between two sets of secrets, safe to expose to
 * clients: it never contains secret values, only statuses and value
 * lengths. Unchanged secrets and keys are omitted; entries are sorted
 * by name for a stable display.
 */
export interface SecretsDiffResult {
  summary: SecretsDiffSummary;
  secrets: SecretDiff[];
}

/**
 * Computes which secrets and keys `incoming` (the target content of a
 * pull, restore or discard) would add, change or remove relative to
 * `current` (the secrets stored in the application).
 */
export function computeSecretsDiff(
  current: Secret[],
  incoming: Secret[],
): SecretsDiffResult {
  const currentByName = new Map(current.map((secret) => [secret.name, secret]));
  const incomingByName = new Map(
    incoming.map((secret) => [secret.name, secret]),
  );

  const secrets: SecretDiff[] = [];
  const summary: SecretsDiffSummary = {
    secretsAdded: 0,
    secretsRemoved: 0,
    secretsChanged: 0,
    keysAdded: 0,
    keysRemoved: 0,
    keysChanged: 0,
  };

  for (const secret of incoming) {
    const before = currentByName.get(secret.name);
    if (!before) {
      summary.secretsAdded += 1;
      const keys = sortedEntries(secret.data).map(([key, value]) => {
        summary.keysAdded += 1;
        return { key, status: "added" as const, valueLength: value.length };
      });
      secrets.push({ name: secret.name, status: "added", keys });
      continue;
    }
    const keys = diffSecretKeys(before, secret, summary);
    if (keys.length > 0) {
      summary.secretsChanged += 1;
      secrets.push({ name: secret.name, status: "changed", keys });
    }
  }

  for (const secret of current) {
    if (incomingByName.has(secret.name)) {
      continue;
    }
    summary.secretsRemoved += 1;
    const keys = sortedEntries(secret.data).map(([key, value]) => {
      summary.keysRemoved += 1;
      return { key, status: "removed" as const, valueLength: value.length };
    });
    secrets.push({ name: secret.name, status: "removed", keys });
  }

  secrets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { summary, secrets };
}

function diffSecretKeys(
  before: Secret,
  after: Secret,
  summary: SecretsDiffSummary,
): SecretKeyDiff[] {
  const keys: SecretKeyDiff[] = [];
  for (const [key, value] of sortedEntries(after.data)) {
    if (!(key in before.data)) {
      summary.keysAdded += 1;
      keys.push({ key, status: "added", valueLength: value.length });
    } else if (before.data[key] !== value) {
      summary.keysChanged += 1;
      keys.push({
        key,
        status: "changed",
        valueLengthBefore: before.data[key].length,
        valueLengthAfter: value.length,
      });
    }
  }
  for (const [key, value] of sortedEntries(before.data)) {
    if (!(key in after.data)) {
      summary.keysRemoved += 1;
      keys.push({ key, status: "removed", valueLength: value.length });
    }
  }
  keys.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keys;
}

function sortedEntries(data: Record<string, string>): [string, string][] {
  return Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
