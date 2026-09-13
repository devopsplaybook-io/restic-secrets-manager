import * as childProcess from "child_process";
import { Project } from "../model/Project";

export interface ResticCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ResticRunner = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
) => Promise<ResticCommandResult>;

/** Default runner: executes the restic binary with the provided env/cwd. */
export function defaultResticRunner(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<ResticCommandResult> {
  return new Promise((resolve) => {
    childProcess.execFile(
      command,
      args,
      { env, cwd, maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const code = error ? (error as any).code || 1 : 0;
        resolve({ code: code as number, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

export interface ResticSnapshot {
  id: string;
  time: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

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
 * Thin wrapper around the restic CLI for one project repository.
 * Credentials are passed via environment variables and are never logged.
 */
export class ResticClient {
  private project: Project;
  private runner: ResticRunner;

  constructor(project: Project, runner: ResticRunner = defaultResticRunner) {
    this.project = project;
    this.runner = runner;
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
  ): Promise<ResticCommandResult> {
    return this.runner("restic", args, this.env(), cwd);
  }

  /** True when the repository is initialized (has a config). */
  public async repoInitialized(): Promise<boolean> {
    const result = await this.run([...this.baseArgs(), "snapshots", "--json"]);
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
    const result = await this.run([...this.baseArgs(), "init"]);
    if (result.code !== 0 && !isRepoAlreadyInitialized(result)) {
      throw new Error(
        `Unable to initialize the restic repository: ${sanitizeResticError(result)}`,
      );
    }
  }

  /** List all snapshots of the repository ([] when the repo is not initialized). */
  public async snapshots(): Promise<ResticSnapshot[]> {
    const result = await this.run([...this.baseArgs(), "snapshots", "--json"]);
    if (result.code !== 0) {
      if (isRepoNotInitialized(result)) {
        return [];
      }
      throw new Error(
        `Unable to list restic snapshots: ${sanitizeResticError(result)}`,
      );
    }
    try {
      return JSON.parse(result.stdout) as ResticSnapshot[];
    } catch {
      throw new Error("Unable to parse restic snapshots output");
    }
  }

  /** Back up the given directory (must be run with cwd set to it). */
  public async backup(dir: string): Promise<void> {
    const result = await this.run(
      [
        ...this.baseArgs(),
        "backup",
        "--group-by",
        "paths",
        "--tag",
        "restic-secrets-manager",
        ".",
      ],
      dir,
    );
    if (result.code !== 0) {
      throw new Error(
        `Unable to push secrets to the restic repository: ${sanitizeResticError(result)}`,
      );
    }
  }

  /** Restore the latest snapshot into the target directory. */
  public async restoreLatest(target: string): Promise<void> {
    const result = await this.run(
      [...this.baseArgs(), "restore", "latest", "--target", target],
    );
    if (result.code !== 0) {
      throw new Error(
        `Unable to pull secrets from the restic repository: ${sanitizeResticError(result)}`,
      );
    }
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
  return output.includes("already initialized") || output.includes("already exists");
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
  return lines.slice(-3).join(" ").substring(0, 500);
}
