import { Config } from "../Config";

/** Time limits of the restic operations, in milliseconds. */
export interface ResticTimeouts {
  snapshotsMs: number;
  restoreMs: number;
  backupMs: number;
  initMs: number;
  connectionTestMs: number;
  /** Delay between SIGTERM and SIGKILL when a restic process is stopped. */
  killGraceMs: number;
}

/** Time limit of the read-only connection test invocation. */
export const CONNECTION_TEST_TIMEOUT_MS = 30_000;

export const DEFAULT_RESTIC_TIMEOUTS: ResticTimeouts = {
  snapshotsMs: 30_000,
  restoreMs: 300_000,
  backupMs: 600_000,
  initMs: 60_000,
  connectionTestMs: CONNECTION_TEST_TIMEOUT_MS,
  killGraceMs: 5_000,
};

function positiveOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/**
 * Resolve the configured restic timeouts, falling back to the defaults for
 * missing or invalid (non-positive) values.
 */
export function resticTimeoutsFromConfig(config: Config): ResticTimeouts {
  return {
    snapshotsMs: positiveOrFallback(
      config?.RESTIC_TIMEOUT_SNAPSHOTS_MS,
      DEFAULT_RESTIC_TIMEOUTS.snapshotsMs,
    ),
    restoreMs: positiveOrFallback(
      config?.RESTIC_TIMEOUT_RESTORE_MS,
      DEFAULT_RESTIC_TIMEOUTS.restoreMs,
    ),
    backupMs: positiveOrFallback(
      config?.RESTIC_TIMEOUT_BACKUP_MS,
      DEFAULT_RESTIC_TIMEOUTS.backupMs,
    ),
    initMs: positiveOrFallback(
      config?.RESTIC_TIMEOUT_INIT_MS,
      DEFAULT_RESTIC_TIMEOUTS.initMs,
    ),
    connectionTestMs: positiveOrFallback(
      config?.RESTIC_TIMEOUT_CONNECTION_TEST_MS,
      DEFAULT_RESTIC_TIMEOUTS.connectionTestMs,
    ),
    killGraceMs: positiveOrFallback(
      config?.RESTIC_KILL_GRACE_MS,
      DEFAULT_RESTIC_TIMEOUTS.killGraceMs,
    ),
  };
}
