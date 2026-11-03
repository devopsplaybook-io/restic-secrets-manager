import type { Span } from "@opentelemetry/sdk-trace";
import { Config } from "../Config";
import { Project } from "../model/Project";
import { ResticSyncError } from "./ResticErrors";
import { ResticSyncStatus, SyncStatusResult } from "./SyncService";

const DEFAULT_TTL_MS = 30_000;
const MAX_CONCURRENT = 3;
const DEFAULT_MAX_WAITERS = 100;

export type StatusRunner = (
  context: Span,
  project: Project,
  signal?: AbortSignal,
) => Promise<SyncStatusResult>;

export interface SyncStatusCacheOptions {
  /** Aborts the caller's interest when the HTTP client disconnects. */
  signal?: AbortSignal;
  /** Test seam: replaces the real restic status runner. */
  statusRunner?: StatusRunner;
}

interface CacheEntry {
  expiresAt: number;
  result: SyncStatusResult;
}

interface StatusRun {
  controller: AbortController;
  promise: Promise<SyncStatusResult>;
  /** Requests still interested in the result (even those without a signal). */
  tokens: Set<object>;
  /** A background refresh warms the cache and is never cancelled. */
  background: boolean;
  generation: number;
}

interface Waiter {
  grant: () => void;
  cancel: () => void;
}

interface SignalHub {
  callbacks: Set<() => void>;
  listener: () => void;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, StatusRun>();
const generations = new Map<string, number>();

// The abort listener hub: the `/status` fan-out passes the same request
// signal to every project, so one native listener per signal is attached
// and fanned out instead of one listener per project (which would trigger
// Node's max-listeners warning above ten projects).
const signalHubs = new WeakMap<AbortSignal, SignalHub>();

// The status check spawns a restic process: cap the concurrent runs to
// protect the deployment's CPU/memory limits.
let activeRuns = 0;
const waiters: Waiter[] = [];

function subscribeAbort(signal: AbortSignal, callback: () => void): () => void {
  if (signal.aborted) {
    callback();
    return () => {};
  }
  let hub = signalHubs.get(signal);
  if (!hub) {
    const callbacks = new Set<() => void>();
    const listener = () => {
      signalHubs.delete(signal);
      for (const current of Array.from(callbacks)) {
        current();
      }
      callbacks.clear();
    };
    hub = { callbacks, listener };
    signalHubs.set(signal, hub);
    signal.addEventListener("abort", listener, { once: true });
  }
  hub.callbacks.add(callback);
  return () => {
    const current = signalHubs.get(signal);
    if (!current) {
      return;
    }
    current.callbacks.delete(callback);
    if (current.callbacks.size === 0) {
      signal.removeEventListener("abort", current.listener);
      signalHubs.delete(signal);
    }
  };
}

function positiveOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function ttlMs(config: Config): number {
  return positiveOrFallback(config?.SYNC_STATUS_CACHE_TTL_MS, DEFAULT_TTL_MS);
}

function maxWaiters(config: Config): number {
  return positiveOrFallback(
    config?.SYNC_STATUS_MAX_WAITERS,
    DEFAULT_MAX_WAITERS,
  );
}

function clientDisconnectedError(): ResticSyncError {
  return new ResticSyncError(
    "The status check was cancelled because the client disconnected",
    499,
  );
}

function queueFullError(): ResticSyncError {
  return new ResticSyncError(
    "Too many status checks are queued: retry shortly",
    503,
    "STATUS_QUEUE_FULL",
  );
}

function generationOf(projectId: string): number {
  return generations.get(projectId) ?? 0;
}

/**
 * Acquires a concurrency slot. An abort while queued removes the waiter and
 * rejects with 499; a full queue rejects with 503 before spawning anything.
 */
function acquireSlot(
  signal: AbortSignal,
  waiterLimit: number,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(clientDisconnectedError());
  }
  if (activeRuns < MAX_CONCURRENT) {
    activeRuns++;
    return Promise.resolve();
  }
  if (waiters.length >= waiterLimit) {
    return Promise.reject(queueFullError());
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const waiter: Waiter = {
      grant: () => {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe();
        activeRuns++;
        resolve();
      },
      cancel: () => {
        if (settled) {
          return;
        }
        settled = true;
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        unsubscribe();
        reject(clientDisconnectedError());
      },
    };
    unsubscribe = subscribeAbort(signal, () => waiter.cancel());
    if (!settled) {
      waiters.push(waiter);
    }
  });
}

function releaseSlot(): void {
  if (activeRuns > 0) {
    activeRuns--;
  }
  const next = waiters.shift();
  if (next) {
    next.grant();
  }
}

function startRun(
  context: Span,
  project: Project,
  config: Config,
  runner: StatusRunner,
  background: boolean,
): StatusRun {
  const controller = new AbortController();
  const generation = generationOf(project.id);
  const run = {
    controller,
    tokens: new Set<object>(),
    background,
    generation,
    promise: undefined as unknown as Promise<SyncStatusResult>,
  };
  run.promise = (async () => {
    let acquired = false;
    try {
      await acquireSlot(controller.signal, maxWaiters(config));
      acquired = true;
      const result = await runner(context, project, controller.signal);
      // Never cache an aborted run, nor one invalidated while in flight.
      if (
        !controller.signal.aborted &&
        run.generation === generationOf(project.id)
      ) {
        cache.set(project.id, {
          expiresAt: Date.now() + ttlMs(config),
          result,
        });
      }
      return result;
    } finally {
      if (acquired) {
        releaseSlot();
      }
      // Identity check: a newer run may already have replaced this one.
      if (inFlight.get(project.id) === run) {
        inFlight.delete(project.id);
      }
    }
  })();
  // A background refresh may fail with nobody waiting for it.
  run.promise.catch(() => {});
  inFlight.set(project.id, run);
  return run;
}

/**
 * Waits for a run on behalf of one caller. The caller's token keeps the run
 * alive; when the last interested caller disconnects, a foreground run is
 * aborted (a background refresh keeps warming the cache). An abort rejects
 * this caller only, with 499.
 */
function joinRun(
  run: StatusRun,
  signal?: AbortSignal,
): Promise<SyncStatusResult> {
  const token = {};
  run.tokens.add(token);
  return new Promise<SyncStatusResult>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (settle: (value: any) => void, value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      run.tokens.delete(token);
      settle(value);
    };
    if (signal) {
      unsubscribe = subscribeAbort(signal, () => {
        finish(reject, clientDisconnectedError());
        if (run.tokens.size === 0 && !run.background) {
          run.controller.abort();
        }
      });
    }
    run.promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

/**
 * Synchronization status of a project, cached with a configurable TTL
 * (restic is spawned for each check). A fresh entry is served directly; a
 * stale entry is served immediately while a single background refresh warms
 * the cache (stale-while-revalidate). Concurrent callers share one run, at
 * most {@link MAX_CONCURRENT} runs execute and the waiter queue is finite.
 * Failures are never cached. A client disconnect aborts the run once no
 * interested caller remains, releasing its concurrency slot. Sync
 * operations must invalidate the entry through
 * {@link SyncStatusCacheInvalidate}: an in-flight run is aborted and can no
 * longer repopulate the cache.
 */
export async function SyncStatusCacheGet(
  context: Span,
  project: Project,
  config: Config,
  options: SyncStatusCacheOptions = {},
): Promise<SyncStatusResult> {
  const signal = options.signal;
  if (signal?.aborted) {
    throw clientDisconnectedError();
  }
  const cached = cache.get(project.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  if (cached) {
    if (!inFlight.has(project.id)) {
      startRun(context, project, config, runnerFor(config, options), true);
    }
    return cached.result;
  }
  const existing = inFlight.get(project.id);
  if (existing) {
    return joinRun(existing, signal);
  }
  const run = startRun(
    context,
    project,
    config,
    runnerFor(config, options),
    false,
  );
  return joinRun(run, signal);
}

function runnerFor(
  config: Config,
  options: SyncStatusCacheOptions,
): StatusRunner {
  return (
    options.statusRunner ??
    ((contextIn, projectIn, signalIn) =>
      ResticSyncStatus(contextIn, config, projectIn, undefined, signalIn))
  );
}

/** Drops the cached status of a project (after a sync operation). */
export function SyncStatusCacheInvalidate(projectId: string): void {
  cache.delete(projectId);
  generations.set(projectId, generationOf(projectId) + 1);
  const run = inFlight.get(projectId);
  if (run) {
    inFlight.delete(projectId);
    run.controller.abort();
  }
}
