import * as childProcess from "child_process";
import { Project } from "../model/Project";
import { ResticSyncError } from "./ResticErrors";
import {
  CONNECTION_TEST_TIMEOUT_MS,
  DEFAULT_RESTIC_TIMEOUTS,
  ResticTimeouts,
} from "./ResticTimeouts";

export interface ResticCommandResult {
  // number for an exit code, string for a spawn error code (e.g. "ENOENT")
  code: number | string;
  stdout: string;
  stderr: string;
  /** True when the invocation was killed after its timeout. */
  timedOut?: boolean;
  /** True when the invocation was killed because the request aborted. */
  aborted?: boolean;
}

export interface ResticRunOptions {
  /** Kills the restic process after this many milliseconds. */
  timeoutMs?: number;
  /** Delay between SIGTERM and SIGKILL when the process must be stopped. */
  killGraceMs?: number;
  /** Aborts (SIGTERM then SIGKILL) the invocation when the signal fires. */
  signal?: AbortSignal;
}

export type ResticRunner = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
  options?: ResticRunOptions,
) => Promise<ResticCommandResult>;

const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 5_000;

/**
 * Default runner: spawns the restic binary and bounds it in time. On timeout
 * or abort the process receives SIGTERM and, if it has not exited after the
 * kill grace, SIGKILL: no restic process is left behind.
 */
export function defaultResticRunner(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
  options: ResticRunOptions = {},
): Promise<ResticCommandResult> {
  return new Promise((resolve) => {
    const child = childProcess.spawn(command, args, {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
    };

    const settle = (code: number | string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, timedOut, aborted });
    };

    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      if (!killTimer) {
        killTimer = setTimeout(
          () => {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill("SIGKILL");
            }
          },
          options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
        );
        killTimer.unref?.();
      }
    };

    const onAbort = () => {
      aborted = true;
      terminate();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const timeoutTimer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            terminate();
          }, options.timeoutMs)
        : undefined;
    timeoutTimer?.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_OUTPUT_BYTES) {
        stdout += chunk.toString();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_OUTPUT_BYTES) {
        stderr += chunk.toString();
      }
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      settle(error.code ?? 1);
    });
    child.on("close", (code, signal) => {
      settle(code ?? (signal ? 1 : 0));
    });
  });
}

export interface ResticSnapshot {
  id: string;
  time: string;
  [key: string]: any;
}

export interface ResticConnectionTestResult {
  status: "empty" | "ok" | "error";
  snapshotCount?: number;
  latestSnapshotTime?: string;
  /** Sanitized error message when the status is "error". */
  message?: string;
}

export { CONNECTION_TEST_TIMEOUT_MS };

/**
 * Returns the most recent snapshot of the list (by snapshot time),
 * or null when the list is empty.
 */
export function latestSnapshot(
  snapshots: ResticSnapshot[],
): ResticSnapshot | null {
  if (snapshots.length === 0) {
    return null;
  }
  return snapshots.reduce((latest, current) =>
    current.time > latest.time ? current : latest,
  );
}

/**
 * Snapshot id reported by the summary line of `restic backup --json`, when
 * present. Status lines are ignored.
 */
export function parseBackupSnapshotId(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    let message: any;
    try {
      message = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (
      message?.message_type === "summary" &&
      typeof message.snapshot_id === "string" &&
      message.snapshot_id.length > 0
    ) {
      return message.snapshot_id;
    }
  }
  return null;
}

/**
 * Thin wrapper around the restic CLI for one project repository.
 * Every operation is bounded by its configured timeout; timeouts are mapped
 * to a 504 and client disconnects to a 499. Credentials are passed via
 * environment variables and are never logged.
 */
export class ResticClient {
  private project: Project;
  private runner: ResticRunner;
  private timeouts: ResticTimeouts;
  private signal?: AbortSignal;

  constructor(
    project: Project,
    runner: ResticRunner = defaultResticRunner,
    timeouts: ResticTimeouts = DEFAULT_RESTIC_TIMEOUTS,
    signal?: AbortSignal,
  ) {
    this.project = project;
    this.runner = runner;
    this.timeouts = timeouts;
    this.signal = signal;
  }

  /** Environment for restic invocations (credentials never logged). */
  public env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      AWS_ACCESS_KEY_ID: this.project.s3AccessKeyId,
      AWS_SECRET_ACCESS_KEY: this.project.s3SecretAccessKey,
      RESTIC_PASSWORD: this.project.resticPassword,
      RESTIC_REPOSITORY: this.project.repositoryUrl(),
    };
  }

  /** Base arguments shared by all restic invocations. */
  public baseArgs(): string[] {
    const args = ["-r", this.project.repositoryUrl()];
    args.push("-o", `s3.bucket-lookup=${this.project.s3BucketLookup || "dns"}`);
    if (this.project.s3Region && this.project.s3Region.trim().length > 0) {
      args.push("-o", `s3.region=${this.project.s3Region.trim()}`);
    }
    return args;
  }

  public async run(
    args: string[],
    cwd?: string,
    options?: ResticRunOptions,
  ): Promise<ResticCommandResult> {
    return this.runner("restic", args, this.env(), cwd, options);
  }

  /**
   * Runs an operation with its timeout, kill grace and abort signal, and
   * maps timeouts (504) and client disconnects (499) to sync errors.
   */
  private async runOperation(
    args: string[],
    timeoutMs: number,
    label: string,
    cwd?: string,
  ): Promise<ResticCommandResult> {
    const result = await this.run(args, cwd, {
      timeoutMs,
      killGraceMs: this.timeouts.killGraceMs,
      signal: this.signal,
    });
    if (result.timedOut) {
      throw new ResticSyncError(
        `The restic ${label} timed out after ${Math.round(timeoutMs / 1000)} seconds: the repository endpoint may be unreachable`,
        504,
      );
    }
    if (result.aborted) {
      throw new ResticSyncError(
        `The restic ${label} was cancelled because the client disconnected`,
        499,
      );
    }
    return result;
  }

  /**
   * Read-only check of the repository settings: runs `snapshots --json`
   * with a time limit and classifies the outcome as an empty repository,
   * a reachable repository (with its snapshot count) or a failure.
   */
  public async testConnection(): Promise<ResticConnectionTestResult> {
    const timeoutMs = this.timeouts.connectionTestMs;
    const result = await this.run(
      [...this.baseArgs(), "snapshots", "--json"],
      undefined,
      {
        timeoutMs,
        killGraceMs: this.timeouts.killGraceMs,
        signal: this.signal,
      },
    );
    if (result.timedOut) {
      return {
        status: "error",
        message: `The connection test timed out after ${timeoutMs / 1000} seconds: the endpoint may be unreachable`,
      };
    }
    if (result.aborted) {
      return {
        status: "error",
        message: "The connection test was cancelled because the client disconnected",
      };
    }
    if (result.code === 0) {
      let snapshots: ResticSnapshot[];
      try {
        snapshots = JSON.parse(result.stdout) as ResticSnapshot[];
      } catch {
        return {
          status: "error",
          message: "Unable to parse restic snapshots output",
        };
      }
      const latest = latestSnapshot(snapshots);
      return {
        status: "ok",
        snapshotCount: snapshots.length,
        latestSnapshotTime: latest ? latest.time : undefined,
      };
    }
    if (isRepoNotInitialized(result)) {
      return { status: "empty" };
    }
    return { status: "error", message: sanitizeResticError(result) };
  }

  /** True when the repository is initialized (has a config). */
  public async repoInitialized(): Promise<boolean> {
    const result = await this.runOperation(
      [...this.baseArgs(), "snapshots", "--json"],
      this.timeouts.snapshotsMs,
      "repository check",
    );
    if (result.code === 0) {
      return true;
    }
    if (isRepoNotInitialized(result)) {
      return false;
    }
    throw new Error(
      `Unable to access the restic repository: ${sanitizeResticError(result)}`,
    );
  }

  public async init(): Promise<void> {
    const result = await this.runOperation(
      [...this.baseArgs(), "init"],
      this.timeouts.initMs,
      "repository initialization",
    );
    if (result.code !== 0 && !isRepoAlreadyInitialized(result)) {
      throw new Error(
        `Unable to initialize the restic repository: ${sanitizeResticError(result)}`,
      );
    }
  }

  /** List all snapshots of the repository ([] when the repo is not initialized). */
  public async snapshots(): Promise<ResticSnapshot[]> {
    const result = await this.runOperation(
      [...this.baseArgs(), "snapshots", "--json"],
      this.timeouts.snapshotsMs,
      "snapshot listing",
    );
    if (result.code !== 0) {
      if (isRepoNotInitialized(result)) {
        return [];
      }
      throw new Error(
        `Unable to list restic snapshots: ${sanitizeResticError(result)}`,
      );
    }
    return parseSnapshotsOutput(result.stdout);
  }

  /**
   * Look up one exact snapshot (full id) of the repository.
   * Returns null when restic does not know the id.
   */
  public async snapshot(id: string): Promise<ResticSnapshot | null> {
    const result = await this.runOperation(
      [...this.baseArgs(), "snapshots", id, "--json"],
      this.timeouts.snapshotsMs,
      "snapshot lookup",
    );
    if (result.code !== 0) {
      return null;
    }
    const snapshots = parseSnapshotsOutput(result.stdout);
    return snapshots.find((snapshot) => snapshot.id === id) || null;
  }

  /**
   * Back up the given directory (must be run with cwd set to it).
   * Returns the id of the snapshot reported by `restic backup --json`
   * (summary line), or null when the output carries no summary id.
   */
  public async backup(dir: string, pushedBy?: string): Promise<string | null> {
    const args = [
      ...this.baseArgs(),
      "backup",
      "--group-by",
      "paths",
      "--tag",
      "restic-secrets-manager",
    ];
    const pusherTag = sanitizePusherTag(pushedBy);
    if (pusherTag) {
      args.push("--tag", `pushed-by:${pusherTag}`);
    }
    args.push("--json", ".");
    const result = await this.runOperation(
      args,
      this.timeouts.backupMs,
      "backup",
      dir,
    );
    if (result.code !== 0) {
      throw new Error(
        `Unable to push secrets to the restic repository: ${sanitizeResticError(result)}`,
      );
    }
    return parseBackupSnapshotId(result.stdout);
  }

  /** Restore a pinned snapshot (exact id) into the target directory. */
  public async restore(snapshotId: string, target: string): Promise<void> {
    const result = await this.runOperation(
      [...this.baseArgs(), "restore", snapshotId, "--target", target],
      this.timeouts.restoreMs,
      "restore",
    );
    if (result.code !== 0) {
      throw new Error(
        `Unable to restore secrets from the restic repository: ${sanitizeResticError(result)}`,
      );
    }
  }
}

function parseSnapshotsOutput(stdout: string): ResticSnapshot[] {
  try {
    return JSON.parse(stdout) as ResticSnapshot[];
  } catch {
    throw new Error("Unable to parse restic snapshots output");
  }
}

/**
 * Detects the "repository does not exist / not initialized" condition,
 * which restic reports with exit code 10 or a config-file error message.
 */
export function isRepoNotInitialized(result: ResticCommandResult): boolean {
  if (result.code === 10) {
    return true;
  }
  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    output.includes("unable to open config file") ||
    output.includes("is there a repository at the following location") ||
    output.includes("does not exist")
  );
}

/** Detects "a repository already exists" during init. */
export function isRepoAlreadyInitialized(result: ResticCommandResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    output.includes("already initialized") || output.includes("already exists")
  );
}

/**
 * Extracts a user-safe error message from a restic failure.
 * Restic error output does not contain credentials (they are passed via
 * environment variables), only the last error lines are surfaced.
 */
export function sanitizeResticError(result: ResticCommandResult): string {
  const output = `${result.stderr}\n${result.stdout}`.trim();
  if (output.length === 0) {
    return `restic exited with code ${result.code}`;
  }
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  return lines.slice(-10).join(" ").substring(0, 1000);
}

/**
 * Restic tags cannot contain commas or whitespace (they are list
 * separators and are normalized away): they are replaced with dashes and
 * the result is trimmed and capped to 100 characters. An empty result
 * means no pusher tag should be added.
 */
export function sanitizePusherTag(pushedBy?: string): string {
  if (!pushedBy) {
    return "";
  }
  const sanitized = pushedBy
    .replace(TAG_SEPARATOR_PATTERN, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100)
    .replace(/^-+|-+$/g, "");
  return sanitized;
}

// Whitespace, commas and control characters cannot be part of a restic tag
// (commas separate tag lists): they are normalized to dashes.
// eslint-disable-next-line no-control-regex
const TAG_SEPARATOR_PATTERN = /[\s,\u0000-\u001f\u007f]+/g;
