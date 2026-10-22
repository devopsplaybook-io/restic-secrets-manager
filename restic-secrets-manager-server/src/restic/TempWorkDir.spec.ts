import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  cleanupStaleWorkDirs,
  createTemporaryWorkDir,
  ensurePrivateDir,
  restrictTreePermissions,
  TEMP_WORK_DIR_PREFIX,
  writePrivateJson,
} from "./TempWorkDir";

function modeOf(filePath: string): Promise<number> {
  return fse.stat(filePath).then((stats) => stats.mode & 0o777);
}

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fse.mkdtemp(path.join(os.tmpdir(), "rsm-tempwork-"));
});

afterEach(async () => {
  await fse.remove(tmpRoot);
});

describe("createTemporaryWorkDir", () => {
  it("should create a unique directory with the application prefix and mode 0700", async () => {
    const first = await createTemporaryWorkDir(tmpRoot);
    const second = await createTemporaryWorkDir(tmpRoot);

    expect(path.dirname(first)).toBe(tmpRoot);
    expect(path.basename(first).startsWith(TEMP_WORK_DIR_PREFIX)).toBe(true);
    expect(first).not.toBe(second);
    expect(await modeOf(first)).toBe(0o700);
    expect(await modeOf(second)).toBe(0o700);
  });

  it("should create the parent directory when missing", async () => {
    const nested = path.join(tmpRoot, "nested", "tmp");
    const dir = await createTemporaryWorkDir(nested);
    expect(await fse.pathExists(dir)).toBe(true);
  });
});

describe("ensurePrivateDir / writePrivateJson", () => {
  it("should create the directory with mode 0700", async () => {
    const dir = path.join(tmpRoot, "restore");
    await ensurePrivateDir(dir);
    expect(await modeOf(dir)).toBe(0o700);
  });

  it("should tighten an existing directory to 0700", async () => {
    const dir = path.join(tmpRoot, "restore");
    await fse.ensureDir(dir);
    await fse.chmod(dir, 0o755);
    await ensurePrivateDir(dir);
    expect(await modeOf(dir)).toBe(0o700);
  });

  it("should write JSON files with mode 0600", async () => {
    const file = path.join(tmpRoot, "secret.json");
    await writePrivateJson(file, { KEY: "value" });
    expect(await modeOf(file)).toBe(0o600);
    expect(await fse.readJson(file)).toEqual({ KEY: "value" });
  });
});

describe("restrictTreePermissions", () => {
  it("should force 0700 directories and 0600 files recursively", async () => {
    const root = path.join(tmpRoot, "restore");
    const nested = path.join(root, "nested");
    const file = path.join(root, "api.json");
    const nestedFile = path.join(nested, "private.json");
    await fse.ensureDir(nested);
    await fse.writeFile(file, "{}");
    await fse.writeFile(nestedFile, "{}");
    await fse.chmod(root, 0o755);
    await fse.chmod(nested, 0o755);
    await fse.chmod(file, 0o644);
    await fse.chmod(nestedFile, 0o644);

    await restrictTreePermissions(root);

    expect(await modeOf(root)).toBe(0o700);
    expect(await modeOf(nested)).toBe(0o700);
    expect(await modeOf(file)).toBe(0o600);
    expect(await modeOf(nestedFile)).toBe(0o600);
  });

  it("should never follow symbolic links", async () => {
    const root = path.join(tmpRoot, "restore");
    const outside = path.join(tmpRoot, "outside.json");
    await fse.ensureDir(root);
    await fse.writeFile(outside, "outside");
    await fse.chmod(outside, 0o644);
    await fse.symlink(outside, path.join(root, "link.json"));

    await restrictTreePermissions(root);

    expect(await modeOf(outside)).toBe(0o644);
    expect(await fse.lstat(path.join(root, "link.json"))).toMatchObject({
      isSymbolicLink: expect.any(Function),
    });
  });
});

describe("cleanupStaleWorkDirs", () => {
  it("should remove only old directories carrying the application prefix", async () => {
    const stale = path.join(tmpRoot, `${TEMP_WORK_DIR_PREFIX}stale`);
    const fresh = path.join(tmpRoot, `${TEMP_WORK_DIR_PREFIX}fresh`);
    const unrelated = path.join(tmpRoot, "unrelated");
    const staleFile = path.join(tmpRoot, `${TEMP_WORK_DIR_PREFIX}file`);
    await fse.ensureDir(stale);
    await fse.ensureDir(fresh);
    await fse.ensureDir(unrelated);
    await fse.writeFile(staleFile, "not a directory");
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fse.utimes(stale, old, old);
    await fse.utimes(unrelated, old, old);
    await fse.utimes(staleFile, old, old);

    const removed = await cleanupStaleWorkDirs(tmpRoot);

    expect(removed).toBe(1);
    expect(await fse.pathExists(stale)).toBe(false);
    expect(await fse.pathExists(fresh)).toBe(true);
    expect(await fse.pathExists(unrelated)).toBe(true);
    expect(await fse.pathExists(staleFile)).toBe(true);
  });

  it("should respect the provided age threshold and clock", async () => {
    const dir = path.join(tmpRoot, `${TEMP_WORK_DIR_PREFIX}old`);
    await fse.ensureDir(dir);
    const mtime = Date.now() - 60 * 60 * 1000;
    await fse.utimes(dir, new Date(mtime), new Date(mtime));

    const removedEarly = await cleanupStaleWorkDirs(
      tmpRoot,
      24 * 60 * 60 * 1000,
      mtime + 30 * 60 * 1000,
    );
    expect(removedEarly).toBe(0);
    expect(await fse.pathExists(dir)).toBe(true);

    const removedLate = await cleanupStaleWorkDirs(
      tmpRoot,
      24 * 60 * 60 * 1000,
      mtime + 25 * 60 * 60 * 1000,
    );
    expect(removedLate).toBe(1);
    expect(await fse.pathExists(dir)).toBe(false);
  });

  it("should return 0 when the temporary directory does not exist", async () => {
    expect(
      await cleanupStaleWorkDirs(path.join(tmpRoot, "missing")),
    ).toBe(0);
  });
});
