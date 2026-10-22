import { Config } from "./Config";

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
