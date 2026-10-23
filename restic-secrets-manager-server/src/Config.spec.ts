import * as fse from "fs-extra";
import * as os from "os";
import path from "path";
import { Config, ResolveAppVersion } from "./Config";

describe("Config", () => {
  it("should keep sessions valid for 1 hour", () => {
    const config = new Config();
    expect(config.JWT_VALIDITY_DURATION).toBe(3600);
  });

  it("should default TMP_DIR to /tmp", () => {
    const config = new Config();
    expect(config.TMP_DIR).toBe("/tmp");
  });

  it("should default the notifications integration to disabled", () => {
    const config = new Config();
    expect(config.NOTIFICATIONS_API_ENDPOINT).toBe("");
    expect(config.NOTIFICATIONS_API_TOKEN).toBe("");
  });

  it("should enable JWT revocation (sessions die on role/scope/password changes and user deletion)", () => {
    expect(new Config().JWT_REVOCATION_ENABLED).toBe(true);
  });

  it("should not trust proxies by default", () => {
    expect(new Config().TRUST_PROXY).toBe(false);
  });

  it("should expose the login/refresh rate-limit defaults", () => {
    const config = new Config();
    expect(config.AUTH_RATE_LIMIT_LOGIN_MAX).toBe(10);
    expect(config.AUTH_RATE_LIMIT_REFRESH_MAX).toBe(60);
    expect(config.AUTH_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
  });

  it("should default every restic operation timeout", () => {
    const config = new Config();
    expect(config.RESTIC_TIMEOUT_SNAPSHOTS_MS).toBe(30_000);
    expect(config.RESTIC_TIMEOUT_RESTORE_MS).toBe(300_000);
    expect(config.RESTIC_TIMEOUT_BACKUP_MS).toBe(600_000);
    expect(config.RESTIC_TIMEOUT_INIT_MS).toBe(60_000);
    expect(config.RESTIC_TIMEOUT_CONNECTION_TEST_MS).toBe(30_000);
    expect(config.RESTIC_KILL_GRACE_MS).toBe(5_000);
  });

  it("should allow overriding a restic timeout through the environment", async () => {
    process.env.RESTIC_TIMEOUT_SNAPSHOTS_MS = "1234";
    try {
      const config = new Config();
      await config.reload();
      expect(config.RESTIC_TIMEOUT_SNAPSHOTS_MS).toBe(1234);
    } finally {
      delete process.env.RESTIC_TIMEOUT_SNAPSHOTS_MS;
    }
  });
});

describe("application version", () => {
  it("should report the root package.json version in development", () => {
    const rootPackage = fse.readJsonSync(
      path.resolve(__dirname, "../../package.json"),
    );
    expect(new Config().VERSION).toBe(rootPackage.version);
  });

  it("should resolve the root manifest copied next to dist in the container", () => {
    const tmpDir = fse.mkdtempSync(path.join(os.tmpdir(), "rsm-version-"));
    try {
      const distDir = path.join(tmpDir, "app", "dist");
      fse.ensureDirSync(distDir);
      fse.writeJsonSync(path.join(tmpDir, "app", "package.json"), {
        name: "restic-secrets-manager",
        version: "9.9.9",
      });
      expect(ResolveAppVersion(distDir)).toBe("9.9.9");
    } finally {
      fse.removeSync(tmpDir);
    }
  });

  it("should ignore a server-only manifest and fall back to 0.0.0", () => {
    const tmpDir = fse.mkdtempSync(path.join(os.tmpdir(), "rsm-version-"));
    try {
      const distDir = path.join(tmpDir, "app", "dist");
      fse.ensureDirSync(distDir);
      fse.writeJsonSync(path.join(tmpDir, "app", "package.json"), {
        name: "restic-secrets-manager-server",
        version: "0.2.0",
      });
      expect(ResolveAppVersion(distDir)).toBe("0.0.0");
    } finally {
      fse.removeSync(tmpDir);
    }
  });
});
