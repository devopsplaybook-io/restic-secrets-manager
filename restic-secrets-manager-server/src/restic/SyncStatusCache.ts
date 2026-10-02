import { Span } from "@opentelemetry/sdk-trace-base";
import { Project } from "../model/Project";
import { ResticSyncStatus, SyncStatusResult } from "./SyncService";

const TTL_MS = 30_000;
const MAX_CONCURRENT = 3;

interface CacheEntry {
  expiresAt: number;
  result: SyncStatusResult;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SyncStatusResult>>();

// The status check spawns a restic process: cap the concurrent runs to
// protect the deployment's CPU/memory limits.
let activeRuns = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeRuns < MAX_CONCURRENT) {
    activeRuns++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      activeRuns++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRuns--;
  const next = waiters.shift();
  if (next) {
    next();
  }
}

/**
 * Synchronization status of a project, cached for a short TTL (restic is
 * spawned for each check). Concurrent requests for the same project share
 * one run; failures are never cached. Sync operations must invalidate the
 * entry through {@link SyncStatusCacheInvalidate}.
 */
export async function SyncStatusCacheGet(
  context: Span,
  project: Project,
  statusRunner: (
    context: Span,
    project: Project,
  ) => Promise<SyncStatusResult> = ResticSyncStatus,
): Promise<SyncStatusResult> {
  const cached = cache.get(project.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  const pending = inFlight.get(project.id);
  if (pending) {
    return pending;
  }
  const run = (async () => {
    await acquireSlot();
    try {
      const result = await statusRunner(context, project);
      cache.set(project.id, { expiresAt: Date.now() + TTL_MS, result });
      return result;
    } finally {
      releaseSlot();
    }
  })();
  inFlight.set(project.id, run);
  try {
    return await run;
  } finally {
    inFlight.delete(project.id);
  }
}

/** Drops the cached status of a project (after a sync operation). */
export function SyncStatusCacheInvalidate(projectId: string): void {
  cache.delete(projectId);
}
