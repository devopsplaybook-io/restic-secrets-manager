import * as fse from "fs-extra";
import * as path from "path";

/** Name prefix of every restic working directory created by the server. */
export const TEMP_WORK_DIR_PREFIX = "restic-secrets-manager-";

/** Working directories older than this are removed at startup. */
export const STALE_WORK_DIR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Create a private (0700) working directory under `tmpDir`, holding secret
 * material while restic runs. `mkdtemp` atomically reserves a unique name.
 */
export async function createTemporaryWorkDir(tmpDir: string): Promise<string> {
  await fse.ensureDir(tmpDir);
  const workDir = await fse.mkdtemp(path.join(tmpDir, TEMP_WORK_DIR_PREFIX));
  await fse.chmod(workDir, 0o700);
  return workDir;
}

/** Create (if needed) a directory readable only by the current user. */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await fse.ensureDir(dir, { mode: 0o700 });
  await fse.chmod(dir, 0o700);
}

/** Write a JSON file readable only by the current user (0600). */
export async function writePrivateJson(
  filePath: string,
  data: unknown,
): Promise<void> {
  await fse.writeJson(filePath, data, { spaces: 2, mode: 0o600 });
  await fse.chmod(filePath, 0o600);
}

/**
 * Force 0700 on every directory and 0600 on every file of a tree (e.g. the
 * output of a restic restore). Symbolic links are never followed.
 */
export async function restrictTreePermissions(rootDir: string): Promise<void> {
  await fse.chmod(rootDir, 0o700);
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    const entries = await fse.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const entryPath = path.join(current, entry.name);
      const stats = await fse.lstat(entryPath);
      if (stats.isDirectory()) {
        await fse.chmod(entryPath, 0o700);
        pending.push(entryPath);
      } else if (stats.isFile()) {
        await fse.chmod(entryPath, 0o600);
      }
    }
  }
}

/**
 * Remove working directories left behind by a crash (SIGKILL, OOM): only
 * directories carrying the application prefix and older than `maxAgeMs`.
 * Errors are ignored per entry; returns the number of removed directories.
 */
export async function cleanupStaleWorkDirs(
  tmpDir: string,
  maxAgeMs: number = STALE_WORK_DIR_MAX_AGE_MS,
  now: number = Date.now(),
): Promise<number> {
  let entries: fse.Dirent[];
  try {
    entries = await fse.readdir(tmpDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_WORK_DIR_PREFIX)) {
      continue;
    }
    const entryPath = path.join(tmpDir, entry.name);
    try {
      const stats = await fse.lstat(entryPath);
      if (!stats.isDirectory() || now - stats.mtimeMs <= maxAgeMs) {
        continue;
      }
      await fse.remove(entryPath);
      removed++;
    } catch {
      // Best effort: an unreadable entry is left for the next start
    }
  }
  return removed;
}
