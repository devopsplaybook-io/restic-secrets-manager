export type SyncPreviewStatus = "added" | "removed" | "changed";

export interface SyncPreviewKey {
  key: string;
  status: SyncPreviewStatus;
  valueLength?: number;
  valueLengthBefore?: number;
  valueLengthAfter?: number;
}

export interface SyncPreviewSecret {
  name: string;
  status: SyncPreviewStatus;
  keys: SyncPreviewKey[];
}

export interface SyncPreviewSummary {
  secretsAdded: number;
  secretsRemoved: number;
  secretsChanged: number;
  keysAdded: number;
  keysRemoved: number;
  keysChanged: number;
}

/**
 * Server-computed preview of what a pull, snapshot restore or discard
 * would change: statuses and value lengths only, never secret values.
 */
export interface SyncPreview {
  summary: SyncPreviewSummary;
  secrets: SyncPreviewSecret[];
  snapshotId?: string;
  snapshotTime?: string;
}

export const MASKED_VALUE = "••••••••";

const STATUS_LABELS = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function statusIcon(status) {
  return { added: "bi-plus-circle", removed: "bi-dash-circle", changed: "bi-pencil-fill" }[status] || "bi-circle";
}

/**
 * Human-readable summary of a preview, e.g. "2 secrets added, 1 changed —
 * 4 keys affected."
 */
export function summarizePreview(preview) {
  const { summary } = preview;
  const parts = [];
  if (summary.secretsAdded) {
    parts.push(`${summary.secretsAdded} secret${summary.secretsAdded === 1 ? "" : "s"} added`);
  }
  if (summary.secretsChanged) {
    parts.push(`${summary.secretsChanged} changed`);
  }
  if (summary.secretsRemoved) {
    parts.push(`${summary.secretsRemoved} secret${summary.secretsRemoved === 1 ? "" : "s"} removed`);
  }
  const keys = summary.keysAdded + summary.keysRemoved + summary.keysChanged;
  if (parts.length === 0 && keys === 0) {
    return "No change: the secrets already match the target content.";
  }
  const keySentence = keys === 0 ? "no key affected" : `${keys} key${keys === 1 ? "" : "s"} affected`;
  return parts.length === 0 ? `Secrets unchanged, ${keySentence}.` : `${parts.join(", ")} — ${keySentence}.`;
}

/**
 * Length hint of a key value, the only quantitative signal exposed by the
 * preview (e.g. "length 24 → 31" for a changed key).
 */
export function keyValueHint(key) {
  if (key.status === "changed" && key.valueLengthBefore !== undefined && key.valueLengthAfter !== undefined) {
    return `length ${key.valueLengthBefore} → ${key.valueLengthAfter}`;
  }
  if (key.valueLength !== undefined) {
    return `length ${key.valueLength}`;
  }
  return "";
}

/**
 * Pusher label of a snapshot history entry: the pushed-by attribution
 * when known, otherwise "unknown pusher" for older snapshots.
 */
export function pusherLabel(snapshot) {
  return snapshot.pushedBy || "unknown pusher";
}

/**
 * Short display form of a restic snapshot id (ids are 64 hex characters).
 */
export function shortSnapshotId(snapshotId) {
  return typeof snapshotId === "string" ? snapshotId.substring(0, 8) : "";
}

/**
 * Request executing a previewed synchronization operation. A pull always
 * carries the snapshot id pinned by its preview: the server rejects it
 * with 409 when the repository moved since the preview.
 */
export function buildSyncExecutionRequest(mode, projectId, snapshotId) {
  const base = `/projects/${projectId}`;
  if (mode === "pull") {
    return { url: `${base}/pull`, body: { snapshotId } };
  }
  if (mode === "discard") {
    return { url: `${base}/discard` };
  }
  return { url: `${base}/snapshots/${snapshotId}/restore` };
}
